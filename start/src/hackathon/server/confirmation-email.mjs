import {createHash} from 'node:crypto';
import {escapeEmailHtml} from '../../../server/journey-email-layout.mjs';

export const HACKATHON_CONFIRMATION_VERSION = 'namat-hackathon-confirmation-v1';
export const HACKATHON_OWNER_EMAIL = 'fborja@martinez-laredo.com';
export const HACKATHON_EMAIL_SENDER = Object.freeze({name: 'Borja at Namat', email: 'borja@updates.namat.health'});
export const HACKATHON_EMAIL_REPLY_TO = Object.freeze({name: 'Borja at Namat', email: 'borja.laredo@namat.health'});
const NOTICE = 'Demo · Fictional health information';
const EMAIL = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;
const only = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => keys.includes(key));
const SAFE_PROVIDER_CODES = new Set(['invalid_parameter', 'missing_parameter', 'out_of_range', 'duplicate_parameter',
  'unauthorized', 'permission_denied', 'not_enough_credits', 'account_under_validation', 'document_not_found']);

function confirmationIdempotencyKey(reference) {
  // RFC 9562 UUIDv5 using the standard URL namespace. Brevo requires a UUID,
  // not a bare digest; retries of the same immutable receipt reuse this value.
  const namespace = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex');
  const name = `https://namat.health/hackathon/confirmation/${HACKATHON_CONFIRMATION_VERSION}/${reference}`;
  const bytes = createHash('sha1').update(namespace).update(name, 'utf8').digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function providerRejectionDetails(response) {
  // Only a known machine code may leave the provider response. Never return
  // the message, request payload, recipient, credentials or arbitrary code.
  let providerCode;
  try {
    const error = await response.json();
    if (error && SAFE_PROVIDER_CODES.has(error.code)) providerCode = error.code;
  } catch {/* Missing or unreadable diagnostics do not change the outcome. */}
  return {httpStatus: response.status, ...(providerCode ? {providerCode} : {})};
}

function validateContent(input) {
  if (!only(input, ['firstName', 'hasReports', 'reference'])
    || typeof input.hasReports !== 'boolean'
    || typeof input.reference !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(input.reference)) {
    throw new Error('Confirmation accepts a first name, report-presence flag and opaque submission reference only.');
  }
  if (input.firstName !== undefined && (typeof input.firstName !== 'string' || input.firstName.length > 80
    || /[\x00-\x1f\x7f\u2028\u2029]/.test(input.firstName))) {
    throw new Error('First name must be text of up to 80 characters without control characters.');
  }
}

/** No report contents, answers, test recommendations or attachments cross this boundary. */
export function renderHackathonConfirmation(input) {
  validateContent(input);
  const firstName = input.firstName?.trim() || '';
  const subject = 'We’ve received your questionnaire';
  const paragraphs = [
    firstName ? `Hi ${firstName}.` : 'Hi.',
    input.hasReports ? 'We’ve received your questionnaire and blood results.' : 'We’ve received your questionnaire.',
    'A doctor is working through your personalised diagnostic plan.',
    'We’ll email you with the recommended tests once your doctor has reviewed and approved the plan.',
    'Best,\nBorja.',
  ];
  // Match the existing founder letters while keeping this demonstration's
  // visible notice independent of the customer-facing email renderers.
  const body = paragraphs.map((paragraph, index) => `<p style="margin:0 0 22px;color:#143f3c;font-family:Arial,Helvetica,sans-serif;font-size:${index === 0 ? '25' : '16'}px;line-height:28px;overflow-wrap:anywhere">${escapeEmailHtml(paragraph).replaceAll('\n', '<br>')}</p>`).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeEmailHtml(subject)}</title></head><body style="margin:0;padding:0;background:#f0ede3;color:#143f3c;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#f0ede3;border-collapse:collapse"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#f9f7f0;border-collapse:collapse;border-top:3px solid #143f3c"><tr><td style="padding:12px 32px;background:#e5e2d8;color:#566a65;font-size:12px;line-height:18px">${NOTICE}</td></tr><tr><td style="padding:28px 32px 24px;font-size:31px;line-height:36px;letter-spacing:-1.9px;font-weight:600">namat</td></tr><tr><td style="padding:28px 32px 12px;border-top:1px solid #e5e2d8">${body}</td></tr><tr><td style="padding:0 32px 30px;color:#566a65;font-size:12px;line-height:20px;overflow-wrap:anywhere">Submission reference: ${escapeEmailHtml(input.reference)}</td></tr></table></td></tr></table></body></html>`;
  return {
    version: HACKATHON_CONFIRMATION_VERSION, sender: HACKATHON_EMAIL_SENDER, replyTo: HACKATHON_EMAIL_REPLY_TO,
    subject, text: `${NOTICE}\n\n${paragraphs.join('\n\n')}\n\nSubmission reference: ${input.reference}`, html,
  };
}

/** Safe for status screens: values and credential contents are never returned. */
export function getHackathonEmailReadiness({env = process.env} = {}) {
  const mode = env.HACKATHON_EMAIL_MODE || 'local';
  const sendsEmail = mode === 'owner-test' || mode === 'participants';
  const apiKeyConfigured = typeof env.BREVO_API_KEY === 'string' && Boolean(env.BREVO_API_KEY.trim());
  return {
    mode,
    apiKeyConfigured,
    apiKeyRequired: sendsEmail && !apiKeyConfigured,
    participantsApproved: env.HACKATHON_PARTICIPANT_EMAIL_APPROVED === 'true',
  };
}

/** A stable reference deduplicates provider requests; the outbox owns retry timing. */
export async function sendHackathonConfirmation(input, {env = process.env, fetcher = fetch} = {}) {
  if (!only(input, ['recipientEmail', 'firstName', 'hasReports', 'reference'])
    || typeof input.recipientEmail !== 'string' || input.recipientEmail.length > 254
    || input.recipientEmail !== input.recipientEmail.trim().toLowerCase() || !EMAIL.test(input.recipientEmail)) {
    throw new Error('A valid confirmation envelope is required.');
  }
  const email = renderHackathonConfirmation({firstName: input.firstName, hasReports: input.hasReports, reference: input.reference});
  const readiness = getHackathonEmailReadiness({env});
  if (readiness.mode === 'local') return {state: 'simulated', provider: 'local'};
  if (!['owner-test', 'participants'].includes(readiness.mode)) return {state: 'blocked', reason: 'email-mode-not-enabled'};
  if (readiness.mode === 'participants' && !readiness.participantsApproved) return {state: 'blocked', reason: 'participant-email-not-approved'};
  if (readiness.mode === 'owner-test' && input.recipientEmail !== HACKATHON_OWNER_EMAIL) return {state: 'blocked', reason: 'recipient-not-approved'};
  if (readiness.apiKeyRequired) return {state: 'blocked', reason: 'api-key-required', apiKeyRequired: true};

  const body = {
    sender: email.sender, to: [{email: input.recipientEmail}], replyTo: email.replyTo,
    subject: email.subject, htmlContent: email.html, textContent: email.text,
    headers: {idempotencyKey: confirmationIdempotencyKey(input.reference)},
  };
  let response;
  try {
    response = await fetcher('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', headers: {'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json'},
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000), redirect: 'error',
    });
  } catch {
    return {state: 'unknown', reason: 'provider-result-unknown'};
  }
  if (response.status === 429) {
    const raw = response.headers?.get?.('retry-after');
    const seconds = raw && /^\d+$/.test(raw) ? Number(raw) : 60;
    return {state: 'retry', reason: 'provider-rate-limited', retryAfterSeconds: Math.min(86400, Math.max(60, seconds))};
  }
  if (response.status >= 500 || response.status === 408) return {state: 'unknown', reason: 'provider-result-unknown'};
  if (response.status >= 400) {
    const diagnostics = await providerRejectionDetails(response);
    // A duplicate key can indicate a prior accepted request whose response
    // was lost. Hold it for reconciliation rather than calling it rejected.
    if (diagnostics.providerCode === 'duplicate_parameter') return {state: 'unknown', reason: 'provider-result-unknown', ...diagnostics};
    return {state: 'failed', reason: 'provider-rejected', ...diagnostics};
  }
  if (response.status !== 201) return {state: 'unknown', reason: 'provider-result-unknown'};
  let receipt;
  try {receipt = await response.json();} catch {return {state: 'unknown', reason: 'provider-result-unknown'};}
  if (!receipt || typeof receipt.messageId !== 'string' || !receipt.messageId || receipt.messageId.length > 512
    || /[\x00-\x1f\x7f]/.test(receipt.messageId)) return {state: 'unknown', reason: 'provider-result-unknown'};
  return {state: 'accepted', provider: 'brevo', messageId: receipt.messageId};
}
