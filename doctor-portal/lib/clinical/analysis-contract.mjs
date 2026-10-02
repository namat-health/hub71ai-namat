import { validatePlan } from "../plan.mjs";

const str = (maxLength) => ({ type: "string", maxLength, minLength: 1 });
const choice = (values) => ({ type: "string", enum: values });
const obj = (properties) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const arr = (items, maxItems, minItems = 0) => ({
  type: "array",
  items,
  maxItems,
  minItems,
});
const strings = arr(str(200), 12, 1);
const evidence = {
  anyOf: [
    obj({ type: choice(["lab"]), labId: str(80) }),
    obj({ type: choice(["questionnaire"]), key: str(40), label: str(60) }),
  ],
};
// Use as the Responses API JSON Schema format tomorrow. All citations refer to
// this exact server-built case; the model cannot choose arbitrary external URLs.
export const analysisSchema = obj({
  caseFingerprint: str(64),
  plan: obj({
    summaryShort: str(240),
    summaryLong: str(600),
    findings: arr(
      obj({
        title: str(80),
        severity: choice(["act", "monitor"]),
        keyValues: { type: "string", maxLength: 80 },
        reasonShort: str(240),
        reasonLong: str(600),
        evidence: arr(evidence, 8, 1),
      }),
      8,
    ),
    tests: arr(
      obj({
        id: str(64),
        name: str(60),
        group: choice(["now", "consider"]),
        reason: str(160),
        includes: { type: "string", maxLength: 160 },
        prep: { type: "string", maxLength: 32 },
        locationType: choice(["lab", "clinic"]),
      }),
      16,
    ),
    followUps: arr(obj({ what: str(100), when: str(40) }), 6),
    sources: { type: "integer", minimum: 0, maximum: 999 },
  }),
  grounding: obj({
    findings: arr(
      obj({
        index: { type: "integer", minimum: 0, maximum: 7 },
        kind: choice(["observation", "possible_explanation"]),
        evidenceIds: strings,
        claimIds: strings,
        uncertainties: arr(str(240), 6),
      }),
      8,
    ),
    tests: arr(
      obj({
        testId: str(64),
        knowledgeId: str(200),
        evidenceIds: strings,
        claimIds: strings,
        missingInformation: arr(str(240), 6),
      }),
      16,
    ),
    existingResults: arr(
      obj({
        knowledgeId: str(200),
        evidenceIds: strings,
        decision: choice(["reuse", "retest", "uncertain"]),
        reason: str(240),
      }),
      81,
    ),
    questionsForDoctor: arr(str(240), 10),
  }),
});
function conforms(value, schema) {
  if (schema.anyOf)
    return schema.anyOf.some((option) => conforms(value, option));
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === "object")
    return (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).every((key) =>
        Object.hasOwn(schema.properties, key),
      ) &&
      schema.required.every(
        (key) =>
          Object.hasOwn(value, key) &&
          conforms(value[key], schema.properties[key]),
      )
    );
  if (schema.type === "array")
    return (
      Array.isArray(value) &&
      value.length >= schema.minItems &&
      value.length <= schema.maxItems &&
      value.every((item) => conforms(item, schema.items))
    );
  if (schema.type === "string")
    return (
      typeof value === "string" &&
      value.length <= (schema.maxLength ?? Infinity) &&
      value.length >= (schema.minLength ?? 0)
    );
  if (schema.type === "integer")
    return (
      Number.isInteger(value) &&
      value >= schema.minimum &&
      value <= schema.maximum
    );
  return false;
}
/** Structural/reference checks only; medical correctness still needs the doctor. */
export function validateGroundedAnalysis(result, context) {
  if (
    !context.readyForInterpretation ||
    result?.caseFingerprint !== context.caseFingerprint ||
    !conforms(result, analysisSchema)
  )
    return null;
  const plan = validatePlan(result.plan);
  if (!plan) return null;
  const facts = new Map(
    [...context.questionnaire.facts, ...context.observations].map((fact) => [
      fact.id,
      fact,
    ]),
  );
  const claims = new Map(
    context.knowledge.claims.map((claim) => [claim.id, claim]),
  );
  const records = new Set([
    ...context.knowledge.markers.map((item) => `marker:${item.id}`),
    ...context.knowledge.screening.map((item) => `screening:${item.id}`),
    ...context.knowledge.bundles.map((item) => `bundle:${item.id}`),
  ]);
  const refs = (item) =>
    item.evidenceIds.every((id) => facts.has(id)) &&
    item.claimIds.every((id) => claims.has(id));
  const { grounding } = result;
  if (
    grounding.findings.length !== plan.findings.length ||
    new Set(grounding.findings.map((item) => item.index)).size !==
      plan.findings.length
  )
    return null;
  if (
    grounding.tests.length !== plan.tests.length ||
    new Set(grounding.tests.map((item) => item.testId)).size !==
      plan.tests.length
  )
    return null;
  for (const item of grounding.findings)
    if (!plan.findings[item.index] || !refs(item)) return null;
  for (const item of grounding.tests)
    if (
      !plan.tests.some((test) => test.id === item.testId) ||
      !records.has(item.knowledgeId) ||
      !refs(item)
    )
      return null;
  for (const item of grounding.existingResults)
    if (
      !records.has(item.knowledgeId) ||
      !item.evidenceIds.every((id) =>
        context.observations.some((observation) => observation.id === id),
      )
    )
      return null;
  for (const finding of plan.findings)
    for (const evidence of finding.evidence) {
      if (
        evidence.type === "lab" &&
        !context.observations.some((item) => item.uiLabId === evidence.labId)
      )
        return null;
      if (
        evidence.type === "questionnaire" &&
        !context.questionnaire.facts.some(
          (item) => item.key === evidence.key && item.status === "reported",
        )
      )
        return null;
    }
  const usedClaims = [...grounding.findings, ...grounding.tests].flatMap(
    (item) => item.claimIds,
  );
  plan.sources = new Set(
    usedClaims.flatMap((id) => claims.get(id).sourceIds),
  ).size;
  return { ...result, plan };
}
