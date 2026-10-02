// Tomorrow's server-side OpenAI integration starts here. caseContext contains
// stored questionnaire facts, parsed/reviewed reports and selected clinical records.
// No API call or clinical inference is implemented in this foundation release.
export async function generatePlan(_input) {
  const error = new Error("Personalised analysis is not connected.");
  error.code = "analysis_not_connected";
  throw error;
}
