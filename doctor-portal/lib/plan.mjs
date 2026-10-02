// The personalised plan contract shared by the plan API and the review screen.
// Copy stays short: one-sentence short fields, two-sentence long fields.

export const SEVERITIES = ["act", "monitor"];
export const TEST_GROUPS = ["now", "consider"];
export const LOCATION_TYPES = ["lab", "clinic"];

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function text(value, max, { optional = false } = {}) {
  if (typeof value !== "string") return optional && value == null ? "" : null;
  const clean = value
    // biome-ignore lint/suspicious/noControlCharactersInRegex: strip controls from generated text.
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if ((!clean && !optional) || clean.length > max) return null;
  return clean;
}

function list(value, max, map) {
  if (!Array.isArray(value) || value.length > max) return null;
  const items = value.map(map);
  return items.every((item) => item !== null) ? items : null;
}

function evidence(item) {
  if (item?.type === "lab") {
    const labId = text(item.labId, 80);
    return labId && ID.test(labId) ? { type: "lab", labId } : null;
  }
  if (item?.type === "questionnaire") {
    const key = text(item.key, 40);
    const label = text(item.label, 60);
    return key && label ? { type: "questionnaire", key, label } : null;
  }
  return null;
}

function finding(item) {
  const value = {
    title: text(item?.title, 80),
    severity: SEVERITIES.includes(item?.severity) ? item.severity : null,
    keyValues: text(item?.keyValues, 80, { optional: true }),
    reasonShort: text(item?.reasonShort, 240),
    reasonLong: text(item?.reasonLong, 600),
    evidence: list(item?.evidence, 8, evidence),
  };
  return Object.values(value).every((field) => field !== null) ? value : null;
}

function test(item) {
  const value = {
    id: typeof item?.id === "string" && ID.test(item.id) ? item.id : null,
    name: text(item?.name, 60),
    group: TEST_GROUPS.includes(item?.group) ? item.group : null,
    reason: text(item?.reason, 160),
    includes: text(item?.includes, 160, { optional: true }),
    prep: text(item?.prep, 32, { optional: true }),
    locationType: LOCATION_TYPES.includes(item?.locationType)
      ? item.locationType
      : null,
  };
  return Object.values(value).every((field) => field !== null) ? value : null;
}

function followUp(item) {
  const value = { what: text(item?.what, 100), when: text(item?.when, 40) };
  return value.what && value.when ? value : null;
}

/**
 * Returns the plan reduced to the contract's fields, or null when any part is
 * missing, malformed or too long. Unknown fields are dropped.
 */
export function validatePlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return null;
  const value = {
    summaryShort: text(plan.summaryShort, 240),
    summaryLong: text(plan.summaryLong, 600),
    findings: list(plan.findings, 8, finding),
    tests: list(plan.tests, 16, test),
    followUps: list(plan.followUps, 6, followUp),
    sources:
      Number.isInteger(plan.sources) && plan.sources >= 0 && plan.sources < 1000
        ? plan.sources
        : null,
  };
  if (Object.values(value).some((field) => field === null)) return null;
  if (new Set(value.tests.map((item) => item.id)).size !== value.tests.length)
    return null;
  return value;
}

// Where each kind of test is done, for the email preview. Placeholder until
// the send step resolves real partner locations from the lab catalogue.
export const PREVIEW_LOCATIONS = {
  lab: {
    name: "Partner laboratory",
    address: "Your nearest branch",
    hours: "Daily 7:00 – 14:00",
  },
  clinic: {
    name: "Partner imaging centre",
    address: "Your nearest branch",
    hours: "By appointment",
  },
};
