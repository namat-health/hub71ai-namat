// The model chooses the interpretation. Code validates references and applies
// ordering policy afterwards; there is no predefined pattern/candidate menu.
export const INTERPRETER_SCHEMA_VERSION = "namat-interpretation-v3";
const text = (maxLength) => ({ type: "string", minLength: 1, maxLength });
const object = (properties) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const array = (items, maxItems) => ({ type: "array", items, maxItems });
const choice = (...values) => ({ type: "string", enum: values });
const refs = () => array(text(200), 12);
export const interpreterSchema = object({
  caseFingerprint: text(64),
  summaryShort: text(240),
  summaryLong: text(600),
  reportEvidence: array(
    object({
      id: text(80),
      reportId: text(200),
      page: { type: "integer", minimum: 1, maximum: 50 },
      quote: text(600),
    }),
    40,
  ),
  findings: array(
    object({
      id: text(80),
      title: text(80),
      kind: choice("observation", "possible_explanation"),
      priority: choice("review", "routine"),
      evidenceIds: refs(),
      contraryEvidenceIds: refs(),
      claimIds: refs(),
      reasonShort: text(240),
      reasonLong: text(600),
      uncertainties: array(text(240), 6),
    }),
    16,
  ),
  actionLedger: array(
    object({
      knowledgeId: {
        ...text(200),
        description:
          "Exact catalogue knowledgeId including marker: or screening: prefix.",
      },
      intent: choice("new", "repeat"),
      decision: choice(
        "propose",
        "defer",
        "already_available",
        "not_indicated",
      ),
      findingIds: refs(),
      evidenceIds: refs(),
      claimIds: refs(),
      reason: text(160),
    }),
    40,
  ),
  questions: array(object({ text: text(240), evidenceIds: refs() }), 20),
  observationCoverage: array(
    object({
      observationId: text(200),
      disposition: choice("addressed", "no_followup_signal", "uncertain"),
      findingIds: refs(),
      reason: text(160),
    }),
    500,
  ),
  reportCoverage: array(
    object({
      reportId: text(200),
      page: { type: "integer", minimum: 1, maximum: 50 },
      status: choice("reviewed", "unreadable", "not_clinical"),
      reason: text(160),
    }),
    150,
  ),
});
export function matchesSchema(value, schema = interpreterSchema) {
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === "object")
    return (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === schema.required.length &&
      schema.required.every(
        (key) =>
          Object.hasOwn(value, key) &&
          matchesSchema(value[key], schema.properties[key]),
      )
    );
  if (schema.type === "array")
    return (
      Array.isArray(value) &&
      value.length <= schema.maxItems &&
      value.every((item) => matchesSchema(item, schema.items))
    );
  if (schema.type === "integer")
    return (
      Number.isInteger(value) &&
      value >= schema.minimum &&
      value <= schema.maximum
    );
  if (schema.type === "string")
    return (
      typeof value === "string" &&
      value.trim().length >= (schema.minLength || 0) &&
      value.length <= (schema.maxLength ?? Infinity)
    );
  return false;
}
