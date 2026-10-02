import assert from "node:assert/strict";
import test from "node:test";
import {
  assertNarrativeBoundaries,
  narrativeCheckInstructions,
  narrativeCheckSchema,
  validateNarrativeCheck,
} from "../lib/clinical/narrative-check.mjs";

const draft = (text) => ({
  summaryShort: text,
  summaryLong: "Interpret the observed pattern with the supplied limitations.",
  findings: [],
  actionLedger: [],
});
const context = { questionnaire: { facts: [] }, observations: [] };

test("explicit diagnosis certainty and prescription imperatives fail closed", () => {
  for (const text of [
    "Cancer is confirmed. Begin warfarin.",
    "The finding confirms diabetes.",
    "Iron deficiency has been confirmed.",
    "The results are diagnostic of chronic kidney disease.",
    "The patient definitely has hypothyroidism.",
    "Prescribe oral iron.",
    "The patient should start levothyroxine.",
    "Start warfarin.",
    "Increase the dose.",
    "Continue metformin.",
    "Recommend starting oral iron.",
    "This report is an all-clear.",
  ]) {
    assert.throws(
      () => assertNarrativeBoundaries(draft(text), context),
      {
        code: "invalid_analysis",
      },
      text,
    );
  }
});

test("unknown pregnancy, fasting and bleeding are not converted into facts", () => {
  for (const text of [
    "The patient is pregnant.",
    "Known pregnancy explains this pattern.",
    "Pregnancy is confirmed.",
    "The sample was fasting.",
    "Known fasting explains the result.",
    "The patient was fasting.",
    "Fasting status is established.",
    "The patient reports heavy periods.",
    "Chronic blood loss explains the results.",
    "Recent blood loss explains the result, but its cause is unknown.",
    "The pattern is caused by bleeding.",
  ]) {
    assert.throws(
      () => assertNarrativeBoundaries(draft(text), context),
      {
        code: "invalid_analysis",
      },
      text,
    );
  }
  const cycleOnly = {
    questionnaire: {
      facts: [
        { kind: "answer", key: "cycle", status: "reported", value: "changes" },
      ],
    },
  };
  assert.throws(
    () =>
      assertNarrativeBoundaries(
        draft("The patient has heavy periods."),
        cycleOnly,
      ),
    { code: "invalid_analysis" },
  );
});

test("qualifications and ordinary clinician review instructions remain usable", () => {
  for (const text of [
    "This pattern does not confirm diabetes.",
    "Whether the patient is pregnant remains unknown.",
    "Confirm whether the sample was fasting.",
    "If the patient reports heavy periods, clarify the history.",
    "Iron deficiency is possible and requires clinical review.",
    "Bleeding could contribute, but no history is recorded.",
    "Do not prescribe treatment from this report alone.",
    "Start by reviewing the source report.",
    "Take a medication history.",
    "Continue reviewing the evidence.",
    "The biotin dose is unknown and needs clarification.",
    "Iron depletion, haemoglobin variants, recent blood loss and transfusion history are unresolved.",
    "Propose documented fasting plasma glucose to clarify glycaemia.",
    "Clarify glycaemia using plasma glucose with documented fasting status.",
  ]) {
    assert.doesNotThrow(
      () => assertNarrativeBoundaries(draft(text), context),
      text,
    );
  }
});

test("explicit structured context permits the corresponding factual assertion only", () => {
  const known = {
    questionnaire: {
      facts: [
        { kind: "answer", key: "pregnancy", status: "reported", value: "yes" },
        {
          kind: "answer",
          key: "heavy_periods",
          status: "reported",
          value: "yes",
        },
      ],
    },
    observations: [{ current: { fastingStatus: "fasting" } }],
  };
  for (const text of [
    "The patient is pregnant.",
    "The sample was fasting.",
    "The patient reports heavy periods.",
  ]) {
    assert.doesNotThrow(() => assertNarrativeBoundaries(draft(text), known));
  }
  assert.throws(
    () => assertNarrativeBoundaries(draft("Begin warfarin."), known),
    {
      code: "invalid_analysis",
    },
  );
});

test("tripwires inspect action rationales and uncertainties, not only summaries", () => {
  const raw = draft("The findings need review.");
  raw.findings = [
    {
      title: "Review the source result",
      reasonShort: "Review the result.",
      reasonLong: "Review its source.",
      uncertainties: ["The patient is pregnant."],
    },
  ];
  assert.throws(() => assertNarrativeBoundaries(raw, context), {
    code: "invalid_analysis",
  });
  raw.findings = [];
  raw.actionLedger = [{ reason: "Start oral iron." }];
  assert.throws(() => assertNarrativeBoundaries(raw, context), {
    code: "invalid_analysis",
  });
});

test("tripwires inspect titles, questions and every coverage reason", () => {
  for (const change of [
    {
      findings: [
        {
          title: "Cancer is confirmed.",
          reasonShort: "Review the source.",
          reasonLong: "Review the source context.",
          uncertainties: [],
        },
      ],
    },
    { questions: [{ text: "Start oral iron." }] },
    { observationCoverage: [{ reason: "This result is an all-clear." }] },
    {
      reportCoverage: [
        { reason: "The patient definitely has hypothyroidism." },
      ],
    },
  ]) {
    assert.throws(
      () =>
        assertNarrativeBoundaries(
          { ...draft("Review the findings."), ...change },
          context,
        ),
      { code: "invalid_analysis" },
    );
  }
});

test("supported clinician hypotheses and conditional questions remain valid across v3 surfaces", () => {
  const raw = {
    ...draft("Iron deficiency is possible and needs clinician review."),
    findings: [
      {
        title: "Possible iron deficiency",
        reasonShort: "This may explain the reported fatigue.",
        reasonLong:
          "A possible explanation requires review alongside competing causes.",
        uncertainties: ["Bleeding history is unknown."],
      },
    ],
    questions: [
      { text: "Could heavy menstrual bleeding contribute, if reported?" },
    ],
    observationCoverage: [
      { reason: "Discussed with the associated red-cell findings." },
    ],
    reportCoverage: [
      { reason: "Source results reviewed; extraction uncertainty remains." },
    ],
  };
  assert.doesNotThrow(() => assertNarrativeBoundaries(raw, context));
});

test("unstructured source context routes premise checks to semantic verification without proving them", () => {
  const sources = [
    {
      reports: [
        { pages: [{ text: "Patient reports heavy menstrual bleeding." }] },
      ],
    },
    {
      questionnaire: {
        facts: [
          {
            kind: "note",
            status: "reported",
            text: "Heavy menstrual bleeding reported.",
          },
        ],
      },
    },
  ];
  for (const supplied of sources)
    assert.doesNotThrow(() =>
      assertNarrativeBoundaries(
        draft("The patient reports heavy periods."),
        supplied,
      ),
    );
  const raw = {
    ...draft("The sample was fasting."),
    reportEvidence: [{ quote: "Fasting status recorded on sample form." }],
  };
  assert.doesNotThrow(() => assertNarrativeBoundaries(raw, context));
  // Mentioning a term in source prose is intentionally not semantic approval.
  assert.doesNotThrow(() =>
    assertNarrativeBoundaries(draft("The sample was fasting."), {
      reports: [{ pages: [{ text: "Fasting status is unknown." }] }],
    }),
  );
  assert.equal(
    validateNarrativeCheck({
      supported: false,
      issues: [
        {
          scope: "finding",
          index: 0,
          reason: "The source says fasting status is unknown.",
        },
      ],
    }),
    false,
  );
});

test("verifier accepts only an exact affirmative verdict without issues", () => {
  assert.equal(validateNarrativeCheck({ supported: true, issues: [] }), true);
  const issue = {
    scope: "finding",
    index: 0,
    reason: "The patient-specific claim lacks evidence.",
  };
  for (const value of [
    null,
    {},
    { supported: "true", issues: [] },
    { supported: false, issues: [] },
    { supported: false, issues: [issue] },
    { supported: true, issues: [issue] },
    { supported: true, issues: [], extra: true },
    { supported: true, issues: [{ ...issue, index: -1 }] },
    { supported: true, issues: [{ ...issue, index: 0.5 }] },
    { supported: true, issues: [{ ...issue, scope: "summary", index: 2 }] },
    { supported: true, issues: [{ ...issue, scope: "omission", index: 1 }] },
    { supported: true, issues: [{ ...issue, scope: "anything" }] },
    { supported: true, issues: [{ ...issue, reason: " " }] },
    { supported: true, issues: [{ ...issue, extra: "instruction" }] },
  ])
    assert.equal(validateNarrativeCheck(value), false);
});

test("verifier contract is strict and separates data from instructions", () => {
  assert.equal(narrativeCheckSchema.additionalProperties, false);
  assert.equal(
    narrativeCheckSchema.properties.issues.items.additionalProperties,
    false,
  );
  assert.match(narrativeCheckInstructions, /untrusted data/);
  assert.match(narrativeCheckInstructions, /false high\/low\/normal polarity/);
  assert.match(narrativeCheckInstructions, /unsupported premise also fails/);
  assert.match(narrativeCheckInstructions, /not a claim-level validation/);
  assert.match(
    narrativeCheckInstructions,
    /no predefined pattern or candidate membership requirement/,
  );
  assert.match(
    narrativeCheckInstructions,
    /original attachments as well as extracted text/,
  );
  assert.match(narrativeCheckInstructions, /parser omitted their rows/);
  assert.match(
    narrativeCheckInstructions,
    /conditional extended reuse intervals/,
  );
  assert.match(
    narrativeCheckInstructions,
    /contraindications, consent\/shared-decision/,
  );
  assert.match(narrativeCheckInstructions, /omitted salient abnormalities/);
  assert.match(
    narrativeCheckInstructions,
    /may remain visible as a conditional doctor consideration/,
  );
  assert.match(
    narrativeCheckInstructions,
    /Honor current clinician corrections/,
  );
  const scopes =
    narrativeCheckSchema.properties.issues.items.properties.scope.enum;
  for (const scope of [
    "question",
    "source",
    "observation_coverage",
    "page_coverage",
    "omission",
  ])
    assert.ok(scopes.includes(scope));
});

test("reportCoverage reasons receive the same narrative boundary checks", () => {
  const raw = draft("The report needs review.");
  raw.reportCoverage = [
    {
      reportId: "fictional",
      page: 1,
      status: "reviewed",
      reason: "Cancer is confirmed.",
    },
  ];
  assert.throws(() => assertNarrativeBoundaries(raw, context), {
    code: "invalid_analysis",
  });
  raw.reportCoverage[0].reason =
    "The source page was reviewed with the recorded limitations.";
  assert.doesNotThrow(() => assertNarrativeBoundaries(raw, context));
});
