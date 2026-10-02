// Fixed design fixture, used only by tests. Never call from a patient route.
const PLACEHOLDER = {
  summaryShort:
    "Low iron and vitamin D likely explain the low focus and slow recovery.",
  summaryLong:
    "The results point to iron deficiency and low vitamin D, which likely explain the low focus and slow recovery reported. Lipids and thyroid need a closer look, and routine screening is due.",
  findings: [
    {
      title: "Iron deficiency",
      severity: "act",
      keyValues: "Ferritin 14 · Hb 11.4",
      reasonShort:
        "Low ferritin with small red cells. Fits the low focus and slow recovery.",
      reasonLong:
        "Ferritin is below range, with small, pale red cells and a raised RDW. Together these point to iron deficiency, which fits the low focus and slow recovery reported.",
      evidence: [
        { type: "lab", labId: "ferritin" },
        { type: "lab", labId: "haemoglobin" },
        { type: "lab", labId: "mcv" },
        { type: "questionnaire", key: "symptoms", label: "Symptoms" },
      ],
    },
    {
      title: "Low vitamin D",
      severity: "act",
      keyValues: "18 ng/mL",
      reasonShort:
        "Well under the 30 ng/mL target, with bone conditions in the family.",
      reasonLong:
        "At 18 ng/mL, vitamin D is well under the 30 ng/mL target. With bone and joint conditions in the family, bone health should be assessed now rather than later.",
      evidence: [
        { type: "lab", labId: "vitamin-d-25-oh" },
        { type: "questionnaire", key: "family", label: "Family history" },
      ],
    },
    {
      title: "LDL above target",
      severity: "monitor",
      keyValues: "138 mg/dL",
      reasonShort:
        "Total cholesterol is also high. Inflammation is within range.",
      reasonLong:
        "LDL and total cholesterol are above range. hs-CRP is inside the lab range but above the 1.0 mg/L longevity target, so particle count and Lp(a) will sharpen the picture.",
      evidence: [
        { type: "lab", labId: "ldl-cholesterol" },
        { type: "lab", labId: "total-cholesterol" },
        { type: "lab", labId: "hs-crp" },
      ],
    },
    {
      title: "Borderline thyroid",
      severity: "monitor",
      keyValues: "TSH 3.9",
      reasonShort:
        "High-normal TSH, period changes and hormonal conditions in the family.",
      reasonLong:
        "TSH sits near the top of the range. Combined with period changes and hormonal conditions in the family, a full thyroid panel is worth running.",
      evidence: [
        { type: "lab", labId: "tsh" },
        { type: "questionnaire", key: "hormones", label: "Hormones" },
      ],
    },
    {
      title: "Screening due",
      severity: "monitor",
      keyValues: "Cancer · reproductive",
      reasonShort:
        "Cancer and reproductive health are the stated prevention focus.",
      reasonLong:
        "Cancer and reproductive health are the stated prevention focus. Age-appropriate screening for both is due.",
      evidence: [
        { type: "questionnaire", key: "prevention", label: "Prevention focus" },
      ],
    },
  ],
  tests: [
    {
      id: "iron-studies",
      name: "Iron studies",
      group: "now",
      reason: "Confirms deficiency and sets a baseline",
      includes: "Serum iron, TIBC, transferrin saturation",
      prep: "Fasting",
      locationType: "lab",
    },
    {
      id: "b12-folate",
      name: "B12 & folate",
      group: "now",
      reason: "Rules out a mixed deficiency",
      includes: "Active B12, serum folate",
      prep: "Same draw",
      locationType: "lab",
    },
    {
      id: "thyroid-panel",
      name: "Thyroid panel",
      group: "now",
      reason: "Borderline TSH and family history",
      includes: "Free T4, free T3, TPO antibodies",
      prep: "Same draw",
      locationType: "lab",
    },
    {
      id: "apob-lpa",
      name: "ApoB & Lp(a)",
      group: "now",
      reason: "Sharper cardiovascular risk than LDL alone",
      includes: "Lp(a) only needs testing once",
      prep: "Same draw",
      locationType: "lab",
    },
    {
      id: "dexa",
      name: "DEXA scan",
      group: "now",
      reason: "Low vitamin D and family bone history",
      includes: "Hip and lumbar spine",
      prep: "15 min",
      locationType: "clinic",
    },
    {
      id: "hormone-panel",
      name: "Hormone panel",
      group: "consider",
      reason: "Period changes at 41–50",
      includes: "FSH, LH, oestradiol on cycle day 3",
      prep: "Cycle day 3",
      locationType: "lab",
    },
    {
      id: "fasting-insulin",
      name: "Fasting insulin",
      group: "consider",
      reason: "HbA1c at the edge of range",
      includes: "With HOMA-IR",
      prep: "Fasting",
      locationType: "lab",
    },
    {
      id: "mammogram",
      name: "Mammogram",
      group: "consider",
      reason: "Due for age and prevention focus",
      includes: "Bilateral screening",
      prep: "20 min",
      locationType: "clinic",
    },
  ],
  followUps: [
    { what: "Results consult with your doctor", when: "Within 2 weeks" },
    { what: "Coach check-ins", when: "Every 2 weeks" },
    { what: "Retest iron and vitamin D", when: "In 12 weeks" },
  ],
  sources: 9,
};

/**
 * The plan generator. Input: {questionnaire: {version, answers, notes}, labs}
 * with no name or email. Output: {plan, source}.
 *
 * Not built yet: this returns the placeholder above so the screen can be
 * reviewed. Replace the body with the knowledge-base call; the API route
 * already validates whatever it returns against the contract.
 */
export async function generatePlan(_input) {
  return { plan: structuredClone(PLACEHOLDER), source: "placeholder" };
}
