import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {renderHackathonConfirmation, sendHackathonConfirmation, getHackathonEmailReadiness, HACKATHON_OWNER_EMAIL} from '../src/hackathon/server/confirmation-email.mjs';

const content = {firstName: 'Alex', hasReports: true, reference: randomUUID()};
const envelope = overrides => ({...content, recipientEmail: HACKATHON_OWNER_EMAIL, ...overrides});
const env = {HACKATHON_EMAIL_MODE: 'owner-test', BREVO_API_KEY: 'fake-not-a-real-key'};

test('confirmation states the fictional context and separates received reports from doctor-approved tests', () => {
  const rendered = renderHackathonConfirmation(content);
  assert.match(rendered.text, /^Demo · Fictional health information\n\nHi Alex\./);
  assert.match(rendered.html, /Demo · Fictional health information/);
  assert.match(rendered.text, /We’ve received your questionnaire and blood results\./);
  assert.match(rendered.text, /A doctor is working through your personalised diagnostic plan\./);
  assert.match(rendered.text, /once your doctor has reviewed and approved the plan\./);
  assert.equal(rendered.sender.email, 'borja@updates.namat.health');
  assert.equal(rendered.replyTo.email, 'borja.laredo@namat.health');
  assert.doesNotMatch(rendered.html, /<img|<script|https?:\/\//);
  const withoutReports = renderHackathonConfirmation({...content, firstName: undefined, hasReports: false});
  assert.match(withoutReports.text, /\n\nHi\.\n\nWe’ve received your questionnaire\./);
  assert.doesNotMatch(withoutReports.text, /blood results/);
});

test('renderer escapes names and rejects sensitive payloads or malformed content', () => {
  assert.match(renderHackathonConfirmation({...content, firstName: '<b>Alex</b>'}).html, /&lt;b&gt;Alex&lt;\/b&gt;/);
  for (const input of [null, {...content, answers: {health: true}}, {...content, attachments: []}, {...content, hasReports: 'yes'},
    {...content, firstName: 'Alex\r\nBcc: private@example.com'}, {...content, reference: 'reference\nsecret'}, {...content, reference: ''}]) {
    assert.throws(() => renderHackathonConfirmation(input));
  }
});

test('local mode never sends and readiness exposes only key presence', async () => {
  let requests = 0;
  const fetcher = async () => { requests++; throw new Error('never called'); };
  assert.deepEqual(await sendHackathonConfirmation(envelope(), {env: {}, fetcher}), {state: 'simulated', provider: 'local'});
  assert.deepEqual(getHackathonEmailReadiness({env: {HACKATHON_EMAIL_MODE: 'owner-test'}}), {
    mode: 'owner-test', apiKeyConfigured: false, apiKeyRequired: true, participantsApproved: false,
  });
  assert.doesNotMatch(JSON.stringify(getHackathonEmailReadiness({env})), /fake-not-a-real-key/);
  assert.equal(requests, 0);
});

test('owner restriction, participant approval and missing key block before network', async () => {
  let requests = 0;
  const fetcher = async () => { requests++; throw new Error('never called'); };
  assert.equal((await sendHackathonConfirmation(envelope({recipientEmail: 'participant@example.com'}), {env, fetcher})).reason, 'recipient-not-approved');
  assert.equal((await sendHackathonConfirmation(envelope(), {env: {HACKATHON_EMAIL_MODE: 'owner-test'}, fetcher})).apiKeyRequired, true);
  assert.equal((await sendHackathonConfirmation(envelope(), {env: {...env, HACKATHON_EMAIL_MODE: 'participants'}, fetcher})).reason, 'participant-email-not-approved');
  assert.equal((await sendHackathonConfirmation(envelope(), {env: {...env, HACKATHON_EMAIL_MODE: 'live'}, fetcher})).state, 'blocked');
  await assert.rejects(sendHackathonConfirmation(envelope({answers: {health: true}}), {env, fetcher}));
  await assert.rejects(sendHackathonConfirmation(envelope({recipientEmail: 'a@example.com\r\nBcc: secret@example.com'}), {env, fetcher}));
  assert.equal(requests, 0);
});

test('provider receives only allowed email fields and a stable idempotency key', async () => {
  const requests = [];
  const fetcher = async (url, options) => { requests.push({url, options}); return {status: 201, json: async () => ({messageId: '<synthetic@provider.invalid>'})}; };
  assert.deepEqual(await sendHackathonConfirmation(envelope(), {env, fetcher}), {state: 'accepted', provider: 'brevo', messageId: '<synthetic@provider.invalid>'});
  await sendHackathonConfirmation(envelope(), {env, fetcher});
  const payload = JSON.parse(requests[0].options.body);
  assert.equal(requests[0].url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(requests[0].options.redirect, 'error');
  assert.deepEqual(Object.keys(payload).sort(), ['headers', 'htmlContent', 'replyTo', 'sender', 'subject', 'textContent', 'to'].sort());
  assert.deepEqual(payload.to, [{email: HACKATHON_OWNER_EMAIL}]);
  assert.equal(payload.headers.idempotencyKey, JSON.parse(requests[1].options.body).headers.idempotencyKey);
  assert.match(payload.headers.idempotencyKey, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.doesNotMatch(requests[0].options.body, /fake-not-a-real-key|attachment|answers|healthPriority/);
  const participantEnv = {...env, HACKATHON_EMAIL_MODE: 'participants', HACKATHON_PARTICIPANT_EMAIL_APPROVED: 'true'};
  await sendHackathonConfirmation(envelope({recipientEmail: 'participant@example.com'}), {env: participantEnv, fetcher});
  assert.deepEqual(JSON.parse(requests[2].options.body).to, [{email: 'participant@example.com'}]);
  await sendHackathonConfirmation(envelope({reference: randomUUID()}), {env, fetcher});
  assert.notEqual(payload.headers.idempotencyKey, JSON.parse(requests[3].options.body).headers.idempotencyKey);
});

test('uncertain delivery remains unknown and provider diagnostics never leak', async () => {
  for (const fetcher of [
    async () => { throw new Error('private server data'); }, async () => ({status: 500}), async () => ({status: 408}),
    async () => ({status: 202}), async () => ({status: 201, json: async () => ({})}),
    async () => ({status: 201, json: async () => ({messageId: 'bad\r\nvalue'})}),
  ]) assert.deepEqual(await sendHackathonConfirmation(envelope(), {env, fetcher}), {state: 'unknown', reason: 'provider-result-unknown'});
  assert.deepEqual(await sendHackathonConfirmation(envelope(), {env, fetcher: async () => ({status: 401})}), {state: 'failed', reason: 'provider-rejected', httpStatus: 401});
  assert.deepEqual(await sendHackathonConfirmation(envelope(), {env, fetcher: async () => ({status: 429, headers: new Headers({'retry-after': '120'})})}),
    {state: 'retry', reason: 'provider-rate-limited', retryAfterSeconds: 120});
});

test('rejection diagnostics expose HTTP status and known codes without provider messages or arbitrary data', async () => {
  const fetcher = async () => ({status: 400, json: async () => ({code: 'out_of_range', message: 'private recipient and key contents',
    recipient: 'private@example.com', key: 'secret-value'})});
  assert.deepEqual(await sendHackathonConfirmation(envelope(), {env, fetcher}),
    {state: 'failed', reason: 'provider-rejected', httpStatus: 400, providerCode: 'out_of_range'});
  const unsafe = await sendHackathonConfirmation(envelope(), {env, fetcher: async () => ({status: 400,
    json: async () => ({code: 'private@example.com', message: 'secret-value'})})});
  assert.deepEqual(unsafe, {state: 'failed', reason: 'provider-rejected', httpStatus: 400});
  const duplicate = await sendHackathonConfirmation(envelope(), {env, fetcher: async () => ({status: 400,
    json: async () => ({code: 'duplicate_parameter', message: 'private provider message'})})});
  assert.deepEqual(duplicate, {state: 'unknown', reason: 'provider-result-unknown', httpStatus: 400, providerCode: 'duplicate_parameter'});
});
