import { interpretCase } from "./clinical/interpreter.mjs";

// Server-only entry point; injection is used by the offline evaluation harness.
export async function generatePlan(input, options) {
  return interpretCase(input, options);
}
