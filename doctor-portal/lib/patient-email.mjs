import { createHash } from "node:crypto";
import { renderPatientEmailHtml } from "./patient-email-template.mjs";

// The doctor-reviewed results email: after a doctor approves the clinical assessment,
// the patient receives the approved summary, the results their doctor used, the tests
// the doctor chose and where to have them drawn. It follows the questionnaire
// confirmation in start.namat.health (src/hackathon/server/confirmation-email.mjs):
// same sender, layout, demo notice, Brevo call, idempotency key and email modes.
export const PATIENT_EMAIL_VERSION = "namat-doctor-review-email-v1";
export const OWNER_EMAIL = "fborja@martinez-laredo.com";
export const EMAIL_SENDER = Object.freeze({
  name: "Borja at Namat",
  email: "borja@updates.namat.health",
});
export const EMAIL_REPLY_TO = Object.freeze({
  name: "Borja at Namat",
  email: "borja.laredo@namat.health",
});
export const MAX_MESSAGE = 1000;
const NOTICE = "Demo · Fictional health information";
const EMAIL =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;
// Control characters and the two Unicode line separators.
const CONTROL = new RegExp(
  `[\\x00-\\x08\\x0b-\\x1f\\x7f${String.fromCharCode(0x2028, 0x2029)}]`,
);
const SAFE_PROVIDER_CODES = new Set([
  "invalid_parameter",
  "missing_parameter",
  "out_of_range",
  "duplicate_parameter",
  "unauthorized",
  "permission_denied",
  "not_enough_credits",
  "account_under_validation",
  "document_not_found",
]);

export const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const httpsUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
};
const aed = (value) =>
  `AED ${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const day = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Dubai",
      })
    : null;
};

export function patientEmailIdempotencyKey(reference) {
  // RFC 9562 UUIDv5 in the URL namespace, as the confirmation email does. One key per
  // approved decision, so a repeated send of the same review reaches Brevo only once.
  const namespace = Buffer.from("6ba7b8119dad11d180b400c04fd430c8", "hex");
  const name = `https://namat.health/hackathon/doctor-review/${PATIENT_EMAIL_VERSION}/${reference}`;
  const bytes = createHash("sha1")
    .update(namespace)
    .update(name, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// The printed value against the range printed on the patient's own report.
function resultStatus(lab) {
  if (lab.flag === "high") return "Above the range printed on your report";
  if (lab.flag === "low") return "Below the range printed on your report";
  return lab.refText ? "Within the range printed on your report" : "";
}

function feeText(option) {
  if (option.feeRule === "all_inclusive") return "home visit included";
  if (option.visitFeeAed === null) return "visit fee not stated";
  if (option.visitFeeAed === 0)
    return option.mode === "home" ? "no home visit fee" : "no visit fee";
  return `includes an ${aed(option.visitFeeAed)} ${option.mode === "home" ? "home visit" : "visit"} fee`;
}

function validate(input) {
  const text = (value, max) =>
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.length <= max && !CONTROL.test(value));
  if (
    !input ||
    typeof input !== "object" ||
    !text(input.firstName, 80) ||
    !text(input.message, MAX_MESSAGE) ||
    !text(input.doctorName, 120) ||
    typeof input.reference !== "string" ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(input.reference) ||
    !Array.isArray(input.tests) ||
    !Array.isArray(input.labs) ||
    !Array.isArray(input.findings)
  )
    throw new Error("Invalid patient email content.");
}

const NO_TESTS =
  "Your doctor isn't recommending any further blood tests right now. That isn't an all-clear: if anything changes, reply to this email.";
const PROTOTYPE = "Prototype: Namat is not yet a licensed service.";
const capitalize = (value) => value.charAt(0).toUpperCase() + value.slice(1);
function feeDetail(option) {
  if (option.feeRule === "all_inclusive") return "Included in the listed total";
  if (option.visitFeeAed === null) return "Not stated by the provider";
  if (option.visitFeeAed === 0) return "None";
  return `${aed(option.visitFeeAed)}, included in the listed total`;
}

// Said only when the questionnaire had no emirate and the options default to Abu Dhabi.
const drawsNote = (draws) =>
  draws.assumed
    ? `Your questionnaire didn't say which emirate you live in, so these are in ${draws.emirateName}.`
    : "";
const finePrint = (draws) =>
  `A listed total is a quote to confirm with the provider, not an appointment.${draws.fictional ? " These providers and prices are fictional." : " Prices are copied from each provider's website."} Labs never pay Namat and can't pay to be ranked.`;
const noOptions = (draws) =>
  `We couldn't find a listed price for these tests in ${draws.emirateName} yet. Reply to this email and we'll help you find a place.`;

function describeOption(option, index, draws) {
  const count = draws.requested.length;
  const turnaround = option.turnaround
    ? capitalize(option.turnaround.replace(/^results\s+(are\s+)?/i, ""))
    : "";
  return {
    rank: index + 1,
    provider: option.provider,
    mode: option.mode === "home" ? "Home visit" : "Walk-in",
    total: aed(option.totalAed),
    fee: feeText(option),
    feeDetail: feeDetail(option),
    covers: option.coversAll
      ? `${count === 1 ? "This test" : `All ${count} tests`}${option.notOrdered ? ` · the package adds ${option.notOrdered} ${option.notOrdered === 1 ? "test" : "tests"} your doctor didn't order` : ""}`
      : `${option.covered} of ${count} · not listed here: ${option.missing.join(", ")}`,
    turnaround,
    places: option.places.map((place) => ({
      area: place.area || place.name || "",
      address: place.address || "",
      hours: place.hours || "",
    })),
    homeAreas:
      option.mode === "home" && option.homeAreas?.length
        ? capitalize(option.homeAreas.slice(0, 6).join(", "))
        : "",
    sources: option.prices
      .map((price) => ({ name: price.name, href: httpsUrl(price.url) }))
      .filter((source) => source.href),
    checked: day(option.prices.find((price) => price.checkedOn)?.checkedOn),
  };
}

/**
 * Renders the email: a plain-text version and, through patient-email-template.mjs, the
 * branded HTML. Every value is escaped here; links are kept only when they are https.
 * Input: {firstName?, doctorName?, reviewedAt?, message?, summary?, findings[], labs[],
 * tests[], draws (closestBloodDraws result or null), reference (the decision ID)}.
 */
export function renderPatientEmail(input) {
  validate(input);
  const e = escapeHtml;
  const firstName = input.firstName?.trim() || "";
  const doctorName = input.doctorName?.trim() || "";
  const reviewer = doctorName || "Your Namat doctor";
  const reviewedOn = day(input.reviewedAt);
  const message = input.message?.trim() || "";
  const summary = input.summary?.trim() || "";
  const subject = "Your Namat doctor has reviewed your results";
  const outside = (lab) => lab.flag === "high" || lab.flag === "low";
  // Results outside the printed range first; otherwise in report order.
  const labs = [
    ...input.labs.filter(outside),
    ...input.labs.filter((lab) => !outside(lab)),
  ];
  const draws = input.draws;
  const options = draws
    ? draws.options.map((option, index) => describeOption(option, index, draws))
    : [];

  const text = [
    firstName ? `Hi ${firstName}.` : "Hi.",
    `${reviewer} has reviewed your questionnaire and blood results${reviewedOn ? ` (${reviewedOn})` : ""}.`,
  ];
  const heading = (value) => text.push(`\n${value.toUpperCase()}`);
  if (message) {
    heading("A note from your doctor");
    text.push(message);
  }
  if (summary || input.findings.length) {
    heading("What your doctor found");
    if (summary) text.push(summary);
    for (const finding of input.findings)
      text.push(
        `- ${finding.title}${finding.reason ? `: ${finding.reason}` : ""}`,
      );
  }
  if (labs.length) {
    heading("Your results");
    text.push(
      "As printed on the reports you shared, with the range printed by the lab that ran each test.",
    );
    for (const lab of labs)
      text.push(
        `- ${lab.name}: ${[lab.display, lab.unit].filter(Boolean).join(" ")}${lab.refText ? ` (range on your report: ${lab.refText})` : ""}${outside(lab) ? `. ${resultStatus(lab)}` : ""}`,
      );
  }
  heading("Tests your doctor recommends");
  if (input.tests.length)
    input.tests.forEach((item, index) => {
      text.push(
        `${index + 1}. ${item.name}${item.reason ? `: ${item.reason}` : ""}`,
      );
    });
  else text.push(NO_TESTS);
  if (draws) {
    heading(`Where to have your blood drawn in ${draws.emirateName}`);
    if (drawsNote(draws)) text.push(drawsNote(draws));
    for (const option of options)
      text.push(
        [
          `Option ${option.rank}: ${option.provider} (${option.mode.toLowerCase()})`,
          `${option.total} listed total · ${option.fee}`,
          `Covers: ${option.covers}`,
          option.turnaround ? `Results: ${option.turnaround}` : "",
          ...option.places.map((place) =>
            [place.area, place.address, place.hours]
              .filter(Boolean)
              .join(" · "),
          ),
          option.homeAreas ? `Home visits: ${option.homeAreas}` : "",
          option.sources.length
            ? `Prices: ${option.sources.map((source) => `${source.name} ${source.href}`).join(" ; ")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    text.push(options.length ? finePrint(draws) : noOptions(draws));
  }
  text.push(
    "If you have a question, just reply. I read every message.\n\nBest,\nBorja.",
  );

  const html = renderPatientEmailHtml({
    subject: e(subject),
    preheader: e(
      `${reviewer} reviewed your results${input.tests.length ? ` and recommends ${input.tests.length === 1 ? "1 test" : `${input.tests.length} tests`}` : ""}${options.length ? `, with places near you in ${draws.emirateName}` : ""}.`,
    ),
    notice: e(NOTICE),
    coverEyebrow: e(
      `Your results${reviewedOn ? ` · reviewed ${reviewedOn}` : ""}`,
    ),
    headline: e(
      firstName
        ? `${firstName}, your doctor has reviewed your results.`
        : "Your doctor has reviewed your results.",
    ),
    message: message ? e(message).replaceAll("\n", "<br>") : "",
    doctorName: e(doctorName),
    summary: e(summary),
    findings: input.findings.map((finding) => ({
      title: e(finding.title),
      reason: e(finding.reason || ""),
    })),
    labs: labs.map((lab) => ({
      name: e(lab.name),
      value: e(lab.display || "—"),
      unit: e(lab.unit || ""),
      range: e(lab.refText || ""),
      chip: outside(lab) ? lab.flag : lab.refText ? "within" : "",
    })),
    tests: input.tests.map((item) => ({
      name: e(item.name),
      reason: e(item.reason || ""),
    })),
    draws: draws
      ? {
          title: e(`Where to have your blood drawn in ${draws.emirateName}`),
          note: e(drawsNote(draws)),
          finePrint: e(finePrint(draws)),
          empty: e(noOptions(draws)),
          options: options.map((option) => ({
            rank: option.rank,
            mode: e(option.mode),
            provider: e(option.provider),
            total: e(option.total),
            covers: e(option.covers),
            fee: e(option.feeDetail),
            turnaround: e(option.turnaround),
            places: option.places.map((place) => ({
              area: e(place.area),
              address: e(place.address),
              hours: e(place.hours),
            })),
            homeAreas: e(option.homeAreas),
            sources: option.sources.map((source) => ({
              name: e(source.name),
              href: e(source.href),
            })),
            checked: e(option.checked || ""),
          })),
        }
      : null,
    prototype: e(PROTOTYPE),
    reference: e(input.reference),
  });
  return {
    version: PATIENT_EMAIL_VERSION,
    sender: EMAIL_SENDER,
    replyTo: EMAIL_REPLY_TO,
    subject,
    html,
    text: `${NOTICE}\n\n${text.join("\n\n").replace(/\n{3,}/g, "\n\n")}\n\nReview reference: ${input.reference}\n${PROTOTYPE}\n`,
  };
}

/** The same modes as the questionnaire confirmation; values are never returned. */
export function patientEmailReadiness({ env = process.env } = {}) {
  const mode = env.HACKATHON_EMAIL_MODE || "local";
  const sendsEmail = mode === "owner-test" || mode === "participants";
  const apiKeyConfigured =
    typeof env.BREVO_API_KEY === "string" && Boolean(env.BREVO_API_KEY.trim());
  return {
    mode,
    apiKeyConfigured,
    apiKeyRequired: sendsEmail && !apiKeyConfigured,
    participantsApproved: env.HACKATHON_PARTICIPANT_EMAIL_APPROVED === "true",
  };
}

async function providerRejectionDetails(response) {
  // Only a known machine code may leave the provider response.
  let providerCode;
  try {
    const error = await response.json();
    if (error && SAFE_PROVIDER_CODES.has(error.code)) providerCode = error.code;
  } catch {
    /* Missing or unreadable diagnostics do not change the outcome. */
  }
  return {
    httpStatus: response.status,
    ...(providerCode ? { providerCode } : {}),
  };
}

/** Sends one rendered email. `reference` (the decision ID) deduplicates it at Brevo. */
export async function sendPatientEmail(
  { recipientEmail, email, reference },
  { env = process.env, fetcher = fetch } = {},
) {
  if (
    typeof recipientEmail !== "string" ||
    recipientEmail.length > 254 ||
    !EMAIL.test(recipientEmail) ||
    !email?.subject ||
    !email?.html ||
    !email?.text ||
    typeof reference !== "string" ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(reference)
  )
    throw new Error("A valid patient email envelope is required.");
  const to = recipientEmail.trim().toLowerCase();
  const readiness = patientEmailReadiness({ env });
  if (readiness.mode === "local")
    return { state: "simulated", provider: "local" };
  if (!["owner-test", "participants"].includes(readiness.mode))
    return { state: "blocked", reason: "email-mode-not-enabled" };
  if (readiness.mode === "participants" && !readiness.participantsApproved)
    return { state: "blocked", reason: "participant-email-not-approved" };
  if (readiness.mode === "owner-test" && to !== OWNER_EMAIL)
    return { state: "blocked", reason: "recipient-not-approved" };
  if (readiness.apiKeyRequired)
    return { state: "blocked", reason: "api-key-required" };

  let response;
  try {
    response = await fetcher("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": env.BREVO_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        sender: email.sender,
        to: [{ email: to }],
        replyTo: email.replyTo,
        subject: email.subject,
        htmlContent: email.html,
        textContent: email.text,
        headers: { idempotencyKey: patientEmailIdempotencyKey(reference) },
      }),
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    });
  } catch {
    return { state: "unknown", reason: "provider-result-unknown" };
  }
  if (response.status === 429)
    return { state: "retry", reason: "provider-rate-limited" };
  if (response.status >= 500 || response.status === 408)
    return { state: "unknown", reason: "provider-result-unknown" };
  if (response.status >= 400) {
    const diagnostics = await providerRejectionDetails(response);
    if (diagnostics.providerCode === "duplicate_parameter")
      return {
        state: "unknown",
        reason: "provider-result-unknown",
        ...diagnostics,
      };
    return { state: "failed", reason: "provider-rejected", ...diagnostics };
  }
  if (response.status !== 201)
    return { state: "unknown", reason: "provider-result-unknown" };
  let receipt;
  try {
    receipt = await response.json();
  } catch {
    return { state: "unknown", reason: "provider-result-unknown" };
  }
  if (
    !receipt ||
    typeof receipt.messageId !== "string" ||
    !receipt.messageId ||
    receipt.messageId.length > 512
  )
    return { state: "unknown", reason: "provider-result-unknown" };
  return { state: "accepted", provider: "brevo", messageId: receipt.messageId };
}
