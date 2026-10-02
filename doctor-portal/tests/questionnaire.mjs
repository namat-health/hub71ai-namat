import assert from "node:assert/strict";
import test from "node:test";
import {
  answerText,
  contextSentence,
  hasQuestionnaireRow,
  profileLine,
  questionnaireGroups,
} from "../lib/questionnaire.mjs";

const submission = {
  email: "fictional@example.invalid",
  answers: {
    goals: ["prevention", "uae_move"],
    age: "41-50",
    sex: "female",
    location: "dubai",
    motivation: ["prevention", "symptoms"],
    priority: "prevention",
    symptoms: ["focus-mood", "recovery", "other"],
    family: ["bone-joint", "hormonal"],
    hormones: ["cycle"],
    sleep: ["unrested"],
    bloodwork: "yes",
    weight: "",
    curiosity: [],
  },
  notes: { symptoms: "  Headaches\nafter <work>  " },
  attached_reports: [{ id: "legacy-0" }],
};

test("raw answer keys become short doctor-facing labels", () => {
  assert.equal(
    answerText("goals", submission),
    "Finding risks early, settling into life in the UAE",
  );
  assert.equal(answerText("location", submission), "Dubai");
  assert.equal(answerText("motivation", submission), "Prevention, symptoms");
  assert.equal(
    answerText("symptoms", submission),
    "Focus & mood, slow recovery, other: Headaches after work",
  );
  assert.equal(answerText("family", submission), "Bone & joint, hormonal");
  assert.equal(answerText("hormones", submission), "Period changes");
  assert.equal(answerText("sleep", submission), "Often wakes unrefreshed");
  assert.equal(answerText("email", submission), "fictional@example.invalid");
  assert.equal(answerText("bloodwork", submission), "1 report uploaded");
  assert.equal(
    answerText("bloodwork", { ...submission, attached_reports: [] }),
    "Tested in the last 6 months",
  );
  assert.equal(answerText("weight", submission), "");
  assert.equal(answerText("curiosity", submission), "");
  assert.equal(answerText("unknown", submission), "");
  assert.equal(
    answerText("goals", { answers: { goals: ["not-an-option"] } }),
    "",
  );
});

test("the drawer shows every group and row, with blanks for unanswered questions", () => {
  const groups = questionnaireGroups(submission);
  assert.deepEqual(
    groups.map((group) => group.group),
    ["About", "Why Namat", "How they feel", "History", "Medicines and habits"],
  );
  assert.deepEqual(
    groups[0].rows.map((row) => row.key),
    ["age", "height_cm", "weight_kg", "sex", "location", "weight", "email"],
  );
  assert.equal(groups[0].rows[5].text, "");
  assert.ok(hasQuestionnaireRow("family"));
  assert.ok(!hasQuestionnaireRow("answers"));
});

test("profile line and context sentence stay short", () => {
  assert.equal(profileLine(submission.answers), "41–50 · Female · Dubai");
  assert.equal(profileLine({ age: "71-plus" }), "71+");
  assert.equal(
    contextSentence(submission.answers),
    "Here for prevention. Reports low focus or mood and slow recovery.",
  );
  assert.equal(
    contextSentence({ motivation: ["weight"], symptoms: ["none"] }),
    "Here about weight. No symptoms reported.",
  );
  assert.equal(
    contextSentence({ goals: ["curiosity"] }),
    "Here out of curiosity.",
  );
  assert.equal(
    contextSentence({
      goals: ["checkup"],
      symptoms: ["energy", "sleep", "digestion", "movement"],
    }),
    "Here for a complete check-up. Reports low energy, poor sleep and 2 more symptoms.",
  );
  assert.equal(contextSentence({}), "");
});
