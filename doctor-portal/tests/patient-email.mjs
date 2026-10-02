import assert from "node:assert/strict";
import test from "node:test";
import {
  closestBloodDraws,
  patientEmirate,
  testBiomarker,
} from "../lib/blood-draw.mjs";
import {
  OWNER_EMAIL,
  patientEmailIdempotencyKey,
  renderPatientEmail,
  sendPatientEmail,
} from "../lib/patient-email.mjs";

const UUID_V5 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const content = (extra = {}) => ({
  firstName: "Lucía",
  doctorName: "Dr Fictional",
  reviewedAt: "2026-10-02T10:00:00Z",
  summary: "Low iron stores are one possible explanation for the fatigue.",
  findings: [
    {
      title: "Low haemoglobin",
      reason: "Below the range on the April report.",
    },
  ],
  labs: [
    {
      name: "Haemoglobin",
      display: "11.2",
      unit: "g/dL",
      refText: "12.0 - 15.5",
      flag: "low",
    },
    {
      name: "HbA1c",
      display: "5.2",
      unit: "%",
      refText: "4.0 - 5.6",
      flag: null,
    },
  ],
  tests: [
    { name: "Ferritin", reason: "This wasn't in the reports you shared." },
  ],
  draws: closestBloodDraws({ location: "abu-dhabi", biomarkers: ["ferritin"] }),
  reference: "11111111-1111-4111-8111-111111111111",
  ...extra,
});

test("the email carries the doctor's summary, results, chosen tests and nearby options", () => {
  const email = renderPatientEmail(
    content({ message: "Call me if <anything> changes." }),
  );
  assert.equal(email.subject, "Your Namat doctor has reviewed your results");
  assert.deepEqual(email.sender, {
    name: "Borja at Namat",
    email: "borja@updates.namat.health",
  });
  // Plain-text section headings are upper case.
  for (const part of [
    "Hi Lucía.",
    "Dr Fictional",
    "Low iron stores",
    "Haemoglobin: 11.2 g/dL (range on your report: 12.0 - 15.5). Below the range printed on your report",
    "Ferritin",
    "Where to have your blood drawn in Abu Dhabi",
    "listed total",
    "Labs never pay Namat",
    "Prototype: Namat is not yet a licensed service.",
  ])
    assert.ok(email.text.toLowerCase().includes(part.toLowerCase()), part);
  for (const part of [
    "Lucía, your doctor has reviewed your results.",
    "Dr Fictional",
    "Low iron stores",
    "Haemoglobin",
    "Below printed range",
    "Within range",
    "Ferritin",
    "Where to have your blood drawn in Abu Dhabi",
    "Listed total",
    "Labs never pay Namat",
    "https://namat.health/assets/archivo-original-latin.woff2",
  ])
    assert.ok(email.html.includes(part), part);
  // Removed on 2 Oct to declutter: the cover intro and numbers, the "you choose where"
  // lead and sort note, the request button and reply paragraph, and "Good to know".
  for (const gone of [
    "read your questionnaire and the reports you shared",
    "Results read",
    "You choose where",
    "Sorted by listed total",
    "Request these tests",
    "Good to know",
  ])
    assert.ok(!email.html.includes(gone) && !email.text.includes(gone), gone);
  assert.ok(
    email.html.indexOf("Haemoglobin") < email.html.indexOf("HbA1c"),
    "results outside the printed range come first",
  );
  assert.match(email.html, /Call me if &lt;anything&gt; changes\./);
  assert.doesNotMatch(email.html, /<anything>/);
  for (const body of [email.html, email.text]) {
    assert.doesNotMatch(body, /\bbook/i);
    assert.doesNotMatch(body, /best price|cheapest|health-authority/i);
  }
  assert.ok(
    !email.text.includes("Above the range"),
    "only flagged values say so",
  );
});

test("no tests and no catalogue match still produce a careful email", () => {
  const email = renderPatientEmail(content({ tests: [], draws: null }));
  assert.ok(email.text.includes("isn't recommending any further blood tests"));
  assert.ok(!email.text.includes("Where to have your blood drawn"));
  assert.throws(() => renderPatientEmail(content({ reference: "../x" })));
  assert.throws(() =>
    renderPatientEmail(content({ message: "x".repeat(1001) })),
  );
});

test("blood draws come from the patient's emirate and say when it was assumed", () => {
  assert.deepEqual(patientEmirate("ras-al-khaimah"), {
    emirate: "ras_al_khaimah",
    assumed: false,
  });
  assert.deepEqual(patientEmirate("outside-uae"), {
    emirate: "abu_dhabi",
    assumed: true,
  });
  assert.equal(
    testBiomarker(
      { id: "marker-ferritin" },
      {
        tests: [{ testId: "marker-ferritin", knowledgeId: "marker:ferritin" }],
      },
    ),
    "ferritin",
  );
  assert.equal(testBiomarker({ id: "screening-dexa" }, null), null);
  const dubai = closestBloodDraws({ location: "dubai", biomarkers: ["hba1c"] });
  assert.equal(dubai.emirateName, "Dubai");
  assert.ok(dubai.options.length > 0 && dubai.options.length <= 3);
  assert.ok(dubai.options.every((option) => option.coversAll));
  assert.ok(
    dubai.options.every(
      (option, index, all) =>
        index === 0 || all[index - 1].totalAed <= option.totalAed,
    ),
  );
  const unknown = closestBloodDraws({
    location: null,
    biomarkers: ["ferritin"],
  });
  assert.equal(unknown.assumed, true);
  assert.equal(
    closestBloodDraws({ location: "dubai", biomarkers: ["not-a-marker"] }),
    null,
  );
});

test("sending follows the questionnaire email modes and deduplicates per decision", async () => {
  const email = renderPatientEmail(content());
  const reference = "11111111-1111-4111-8111-111111111111";
  const envelope = {
    recipientEmail: "lucia.demo@example.com",
    email,
    reference,
  };
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    return Response.json({ messageId: "<fixture@brevo>" }, { status: 201 });
  };
  const run = (env, input = envelope) =>
    sendPatientEmail(input, { env, fetcher });
  assert.deepEqual(await run({}), { state: "simulated", provider: "local" });
  assert.equal(
    (await run({ HACKATHON_EMAIL_MODE: "other" })).reason,
    "email-mode-not-enabled",
  );
  assert.equal(
    (await run({ HACKATHON_EMAIL_MODE: "participants", BREVO_API_KEY: "k" }))
      .reason,
    "participant-email-not-approved",
  );
  assert.equal(
    (await run({ HACKATHON_EMAIL_MODE: "owner-test", BREVO_API_KEY: "k" }))
      .reason,
    "recipient-not-approved",
  );
  assert.equal(
    (
      await run({
        HACKATHON_EMAIL_MODE: "participants",
        HACKATHON_PARTICIPANT_EMAIL_APPROVED: "true",
      })
    ).reason,
    "api-key-required",
  );
  assert.equal(calls.length, 0);
  const env = {
    HACKATHON_EMAIL_MODE: "participants",
    HACKATHON_PARTICIPANT_EMAIL_APPROVED: "true",
    BREVO_API_KEY: "fixture-brevo-key",
  };
  assert.deepEqual(await run(env), {
    state: "accepted",
    provider: "brevo",
    messageId: "<fixture@brevo>",
  });
  assert.equal(
    (
      await run(
        { HACKATHON_EMAIL_MODE: "owner-test", BREVO_API_KEY: "k" },
        { ...envelope, recipientEmail: OWNER_EMAIL },
      )
    ).state,
    "accepted",
  );
  assert.equal(calls[0].url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(calls[0].init.headers["api-key"], "fixture-brevo-key");
  assert.equal(calls[0].init.redirect, "error");
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.to, [{ email: "lucia.demo@example.com" }]);
  assert.equal(body.subject, email.subject);
  assert.equal(
    body.headers.idempotencyKey,
    patientEmailIdempotencyKey(reference),
  );
  assert.match(body.headers.idempotencyKey, UUID_V5);
  assert.notEqual(
    patientEmailIdempotencyKey(reference),
    patientEmailIdempotencyKey("22222222-2222-4222-8222-222222222222"),
  );
  const reply = (status, json) => async () => Response.json(json, { status });
  const outcome = async (respond) =>
    sendPatientEmail(envelope, { env, fetcher: respond });
  assert.equal((await outcome(reply(429, {}))).state, "retry");
  assert.equal((await outcome(reply(503, {}))).state, "unknown");
  assert.deepEqual(
    await outcome(reply(400, { code: "unauthorized", message: "secret" })),
    {
      state: "failed",
      reason: "provider-rejected",
      httpStatus: 400,
      providerCode: "unauthorized",
    },
  );
  assert.equal(
    (await outcome(reply(400, { code: "duplicate_parameter" }))).state,
    "unknown",
  );
  await assert.rejects(
    sendPatientEmail(
      { ...envelope, recipientEmail: "not an email" },
      { env, fetcher },
    ),
  );
});
