// Doctor-facing labels for saved v1 and v2 questionnaires.
// Patients answer in the first person ("Changes in my periods"); the portal
// shows short third-person labels instead of raw keys like "uae_move".
// Pure module: used by API routes and the browser.

const AGE = {
  "18-30": "18–30",
  "31-40": "31–40",
  "41-50": "41–50",
  "51-60": "51–60",
  "61-70": "61–70",
  "71-plus": "71+",
};
const SEX = { female: "Female", male: "Male" };
const LOCATION = {
  "abu-dhabi": "Abu Dhabi",
  dubai: "Dubai",
  sharjah: "Sharjah",
  ajman: "Ajman",
  "umm-al-quwain": "Umm Al Quwain",
  "ras-al-khaimah": "Ras Al Khaimah",
  fujairah: "Fujairah",
  "outside-uae": "Outside the UAE",
};
const REASONS = {
  prevention: "Prevention",
  history: "Past health problems",
  symptoms: "Symptoms",
  lifestyle: "Healthier habits",
  performance: "Performance",
  weight: "Weight",
  hormones: "Hormones",
  checkup: "Full health picture",
};

// Rows in display order. `other` options are followed by the patient's note.
export const QUESTIONNAIRE_GROUPS = [
  {
    group: "About",
    rows: [
      { key: "age", label: "Age", options: AGE },
      { key: "height_cm", label: "Height", unit: "cm" },
      { key: "weight_kg", label: "Weight", unit: "kg" },
      { key: "sex", label: "Sex", options: SEX },
      { key: "location", label: "Lives in", options: LOCATION },
      {
        key: "weight",
        label: "Weight",
        options: {
          stable: "Stable over 12 months",
          gained: "Up over 12 months",
          lost: "Down over 12 months",
        },
      },
      { key: "email", label: "Email" },
    ],
  },
  {
    group: "Why Namat",
    rows: [
      {
        key: "goals",
        label: "Goal",
        options: {
          checkup: "Complete check-up",
          prevention: "Finding risks early",
          symptoms: "Understanding symptoms",
          performance: "Health and performance",
          uae_move: "Settling into life in the UAE",
          curiosity: "Exploring options",
          history: "Past health problems",
          lifestyle: "Healthier habits",
          hormones: "Symptoms that may relate to hormones",
        },
      },
      { key: "priority", label: "Priority", options: REASONS },
      { key: "motivation", label: "Motivation", options: REASONS },
      {
        key: "checkup",
        label: "Looking for",
        options: {
          risks: "Health risks",
          measurements: "Results explained",
          guidance: "A doctor’s advice",
          priorities: "Clear priorities",
          plan: "A long-term plan",
          reassurance: "Peace of mind",
        },
      },
      {
        key: "curiosity",
        label: "Curious about",
        options: {
          metabolism: "Weight & metabolism",
          reproductive: "Reproductive health",
          heart: "Heart health",
          energy: "Energy",
          clarity: "Focus & memory",
          risks: "General health risks",
          other: "Something else",
          unsure: "Not sure where to start",
        },
      },
      {
        key: "performance",
        label: "Performance",
        options: {
          energy: "Energy",
          clarity: "Clearer thinking",
          strength: "Strength & fitness",
          sleep: "Sleep",
          recovery: "Recovery",
          mood: "Mood",
          injury: "Injury recovery",
          other: "Something else",
        },
      },
    ],
  },
  {
    group: "How they feel",
    rows: [
      {
        key: "symptoms",
        label: "Symptoms",
        options: {
          energy: "Low energy",
          weight: "Weight changes",
          "focus-mood": "Focus & mood",
          sleep: "Sleep problems",
          recovery: "Slow recovery",
          "skin-hair": "Skin or hair",
          digestion: "Digestion",
          movement: "Joint pain or stiffness",
          other: "Other",
          none: "None",
        },
      },
      {
        key: "sleep",
        label: "Sleep",
        options: {
          unrested: "Often wakes unrefreshed",
          snore: "Snores",
          none: "No concerns",
        },
      },
      {
        key: "hormones",
        label: "Hormones",
        options: {
          cycle: "Period changes",
          menopause: "Menopause symptoms",
          "energy-mood": "Low energy or mood",
          libido: "Low libido",
          body: "Weight or muscle changes",
          "skin-hair": "Skin or hair changes",
          check: "Wants them checked",
          other: "Something else",
        },
      },
    ],
  },
  {
    group: "History",
    rows: [
      {
        key: "history",
        label: "Medical history",
        options: {
          cholesterol: "High cholesterol",
          "blood-pressure": "High blood pressure",
          "blood-sugar": "High blood sugar",
          hormones: "Hormone problems",
          reproductive: "Reproductive problems",
          autoimmune: "Autoimmune",
          "stress-anxiety": "Stress or anxiety",
          injury: "Past injuries",
          other: "Other",
          none: "None",
        },
      },
      {
        key: "family",
        label: "Family history",
        options: {
          heart: "Heart disease",
          stroke: "Stroke",
          metabolic: "Diabetes, cholesterol or weight",
          cancer: "Cancer",
          "bone-joint": "Bone & joint",
          hormonal: "Hormonal",
          neurological: "Neurological",
          autoimmune: "Autoimmune",
          inherited: "Genetic conditions",
          reproductive: "Fertility",
          early: "Death before 60",
          none: "None known",
        },
      },
      {
        key: "prevention",
        label: "Prevention focus",
        options: {
          heart: "Heart & blood pressure",
          metabolism: "Blood sugar",
          hormones: "Hormones",
          brain: "Brain & memory",
          cancer: "Cancer",
          reproductive: "Reproductive health",
          inherited: "Family conditions",
          broad: "General overview",
          other: "Something else",
        },
      },
      {
        key: "bloodwork",
        label: "Bloodwork",
        options: { yes: "Tested in the last 6 months", no: "None in 6 months" },
      },
    ],
  },
];

QUESTIONNAIRE_GROUPS.push({
  group: "Medicines and habits",
  rows: [
    {
      key: "medicines",
      label: "Medicines and supplements",
      options: { yes: "Yes", none: "None", unsure: "Not sure" },
    },
    {
      key: "tobacco",
      label: "Tobacco and nicotine",
      options: {
        never: "Never used regularly",
        former: "Former use",
        current: "Current use",
        declined: "Prefer not to say",
      },
    },
    {
      key: "alcohol",
      label: "Alcohol",
      options: {
        never: "Never",
        monthly: "Monthly or less",
        weekly: "Some days each week",
        "most-days": "Most days",
        declined: "Prefer not to say",
      },
    },
  ],
});
const familyRow = QUESTIONNAIRE_GROUPS.flatMap((group) => group.rows).find(
  (row) => row.key === "family",
);
familyRow.options.unsure = "Not sure";
const ROWS = new Map(
  QUESTIONNAIRE_GROUPS.flatMap((group) =>
    group.rows.map((row) => [row.key, row]),
  ),
);

function selected(value) {
  if (Array.isArray(value))
    return value.filter((item) => typeof item === "string");
  return typeof value === "string" && value ? [value] : [];
}

// "Focus & mood, slow recovery": the first label keeps its capital.
function sentenceList(labels) {
  return labels
    .map((label, index) =>
      index === 0 ? label : label.charAt(0).toLowerCase() + label.slice(1),
    )
    .join(", ");
}

function noteText(value) {
  return typeof value === "string"
    ? value
        // biome-ignore lint/suspicious/noControlCharactersInRegex: strip controls from patient-typed notes.
        .replace(/[\u0000-\u001f\u007f<>]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200)
    : "";
}

/** One answer as display text, or "" when unanswered. */
export function answerText(key, submission) {
  const row = ROWS.get(key);
  if (!row) return "";
  if (key === "email")
    return typeof submission.email === "string" ? submission.email : "";
  const reports = Array.isArray(submission.attached_reports)
    ? submission.attached_reports.length
    : 0;
  if (key === "bloodwork" && reports)
    return `${reports} ${reports === 1 ? "report" : "reports"} uploaded`;
  const answers = submission.answers || {};
  if (
    key === "bloodwork" &&
    submission.questionnaire_version === "namat-hackathon-welcome-v2"
  )
    return answers.bloodwork === "yes"
      ? "Tested in the last 12 months"
      : answers.bloodwork === "no"
        ? "None in 12 months"
        : "";
  const note = noteText(submission.notes?.[key]);
  if (key === "age" && /^\d+$/.test(answers.age || ""))
    return `${answers.age} years`;
  if (row.unit && /^\d+(?:\.\d)?$/.test(answers[key] || ""))
    return `${answers[key]} ${row.unit}`;
  const labels = selected(answers[key])
    .map((option) => {
      const label = row.options?.[option];
      if (!label) return null;
      return option === "other" && note ? `${label}: ${note}` : label;
    })
    .filter(Boolean);
  const result = sentenceList(labels);
  return ["medicines", "tobacco", "alcohol", "family"].includes(key) && note
    ? `${result}: ${note}`
    : result;
}

/** Drawer groups: [{group, rows: [{key, label, text}]}]. */
export function questionnaireGroups(submission) {
  return QUESTIONNAIRE_GROUPS.map((group) => ({
    group: group.group,
    rows: group.rows.map((row) => ({
      key: row.key,
      label: row.label,
      text: answerText(row.key, submission),
    })),
  }));
}

export function hasQuestionnaireRow(key) {
  return ROWS.has(key);
}

/** "41–50 · Female · Dubai" */
export function profileLine(answers = {}) {
  return [
    AGE[answers.age] ||
      (/^\d+$/.test(answers.age || "") ? `${answers.age} years` : null),
    SEX[answers.sex],
    LOCATION[answers.location],
  ]
    .filter(Boolean)
    .join(" · ");
}

const FOCUS = {
  prevention: "Here for prevention.",
  history: "Here to follow up on past health problems.",
  symptoms: "Here to understand symptoms.",
  lifestyle: "Here to build healthier habits.",
  performance: "Here to feel and perform better.",
  weight: "Here about weight.",
  hormones: "Here about hormones.",
  checkup: "Here for a full picture of their health.",
};
const GOAL_FOCUS = {
  checkup: "Here for a complete check-up.",
  prevention: "Here to find risks early.",
  symptoms: "Here to understand symptoms.",
  performance: "Here to improve health and performance.",
  uae_move: "Here after moving to the UAE.",
  curiosity: "Here out of curiosity.",
};
const SYMPTOM_PHRASES = {
  energy: "low energy",
  weight: "weight changes",
  "focus-mood": "low focus or mood",
  sleep: "poor sleep",
  recovery: "slow recovery",
  "skin-hair": "skin or hair changes",
  digestion: "digestive problems",
  movement: "joint pain",
};

function phraseList(phrases) {
  if (phrases.length <= 1) return phrases.join("");
  return `${phrases.slice(0, -1).join(", ")} and ${phrases.at(-1)}`;
}

/**
 * One short sentence from the priority and symptoms, for example
 * "Here for prevention. Reports low focus or mood and slow recovery."
 */
export function contextSentence(answers = {}) {
  const motivations = selected(answers.motivation);
  const focus =
    FOCUS[answers.priority] ||
    (motivations.length === 1 ? FOCUS[motivations[0]] : null) ||
    GOAL_FOCUS[selected(answers.goals)[0]] ||
    "";
  const symptoms = selected(answers.symptoms);
  const phrases = symptoms
    .map((symptom) => SYMPTOM_PHRASES[symptom])
    .filter(Boolean);
  let reports = "";
  if (symptoms.includes("none")) reports = "No symptoms reported.";
  else if (phrases.length > 3)
    reports = `Reports ${phrases.slice(0, 2).join(", ")} and ${phrases.length - 2} more symptoms.`;
  else if (phrases.length) reports = `Reports ${phraseList(phrases)}.`;
  else if (symptoms.includes("other")) reports = "Reports other symptoms.";
  return [focus, reports].filter(Boolean).join(" ");
}
