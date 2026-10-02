// Authored fictional UI fixture. Never used by the analysis API or a provider.
import { knowledge } from "./knowledge.mjs";

const rows = [
  {
    id: "preview-hb",
    uiLabId: "hb",
    name: "Haemoglobin",
    value: "110",
    unit: "g/L",
    referenceRange: "120–160",
  },
  {
    id: "preview-mcv",
    uiLabId: "mcv",
    name: "MCV",
    value: "74",
    unit: "fL",
    referenceRange: "80–100",
  },
  {
    id: "preview-a1c",
    uiLabId: "a1c",
    name: "HbA1c",
    value: "6.1",
    unit: "%",
    referenceRange: "4.0–5.6",
  },
];
const claimIds = [
  "marker:ferritin:evidence_note",
  "marker:haemoglobin:doctor_note_if_outside_range",
  "marker:hba1c:doctor_note_if_outside_range",
];
const claims = knowledge.claims.filter((item) => claimIds.includes(item.id));
export const offlinePreview = {
  preview: true,
  clinicalStatus: "draft_rules_not_clinically_validated",
  evaluatedAt: "2026-10-02T09:00:00Z",
  plan: {
    summaryShort:
      "Connect the blood-count pattern, fatigue and HbA1c before deciding the next tests.",
    summaryLong:
      "The low haemoglobin and small red-cell indices merit review alongside the reported fatigue. Iron deficiency is one possible explanation that needs confirmation. Red-cell factors may also affect how HbA1c should be interpreted. This is an authored fictional interface example, not a live AI assessment.",
    findings: [
      {
        title: "Review the blood-count pattern",
        severity: "act",
        keyValues: "Hb 110 g/L · MCV 74 fL",
        reasonShort:
          "Low haemoglobin and small red-cell indices make iron-store assessment worth considering with the clinical history.",
        reasonLong:
          "Confirm the readings and establish bleeding, dietary and medicine context. The pattern does not establish iron deficiency; ferritin would help the doctor evaluate that possibility if no usable prior result exists.",
        evidence: [
          { type: "lab", labId: "hb" },
          { type: "lab", labId: "mcv" },
          { type: "questionnaire", key: "symptoms", label: "Reported fatigue" },
        ],
      },
      {
        title: "Check HbA1c reliability",
        severity: "act",
        keyValues: "HbA1c 6.1%",
        reasonShort:
          "The red-cell findings may affect HbA1c interpretation; review the assay and consider a glucose-based assessment.",
        reasonLong:
          "The same report contains HbA1c and red-cell findings that deserve a reliability check. Their relationship does not establish a cause or justify adjusting the HbA1c number. The doctor decides whether an appropriate glucose-based test is needed.",
        evidence: [
          { type: "lab", labId: "a1c" },
          { type: "lab", labId: "hb" },
        ],
      },
    ],
    tests: [
      {
        id: "ferritin",
        name: "Ferritin",
        group: "consider",
        reason:
          "Consider iron-store assessment after checking for a usable existing result.",
        includes: "",
        prep: "Clinician to confirm",
        locationType: "lab",
      },
      {
        id: "glucose",
        name: "Glucose-based assessment",
        group: "consider",
        reason:
          "Consider if the clinician judges HbA1c unreliable and no suitable result is available.",
        includes: "",
        prep: "Confirm fasting plan",
        locationType: "lab",
      },
    ],
    followUps: [],
    sources: new Set(claims.flatMap((claim) => claim.sourceIds)).size,
  },
  grounding: {
    findings: [
      {
        index: 0,
        kind: "possible_explanation",
        evidenceIds: ["preview-hb", "preview-mcv", "answer:symptoms"],
        claimIds: claimIds.slice(0, 2),
        uncertainties: [
          "Bleeding history and recent iron use are not recorded.",
          "The possible iron-related explanation needs confirmation.",
        ],
      },
      {
        index: 1,
        kind: "possible_explanation",
        evidenceIds: ["preview-a1c", "preview-hb"],
        claimIds: [claimIds[2]],
        uncertainties: [
          "Laboratory method and fasting status are not established.",
        ],
      },
    ],
    tests: [],
    questionsForDoctor: [
      "Is there relevant bleeding, dietary restriction, blood donation or iron use?",
      "Is a usable ferritin or glucose result available outside these uploads?",
    ],
  },
  coverage: rows.map((row) => ({
    observationId: row.id,
    domain: row.id === "preview-a1c" ? "glucose" : "bloodcount-iron",
    status: "reviewed",
    reason:
      "Accounted for in this fictional assessment against the printed range.",
  })),
  actionLedger: [],
  limitations: [
    {
      code: "fictional_preview",
      reason:
        "Fictional authored example for interface review. No model has analysed this case and no clinical decision can be saved.",
    },
  ],
  reviewAlerts: [],
  evidence: {
    observations: rows.map((row) => ({
      ...row,
      reportId: "fictional-report",
      page: 1,
      current: {
        value: row.value,
        unit: row.unit,
        referenceRange: row.referenceRange,
        date: "2026-09-20",
        sourceText: `${row.name} ${row.value} ${row.unit} ${row.referenceRange}`,
      },
    })),
    facts: [
      {
        id: "answer:symptoms",
        key: "symptoms",
        value: ["energy"],
        text: "Low energy or tiredness",
        status: "reported",
      },
    ],
    claims,
    sources: knowledge.sources.filter((item) =>
      claims.some((claim) => claim.sourceIds.includes(item.id)),
    ),
  },
};
