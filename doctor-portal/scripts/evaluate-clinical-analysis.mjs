// Explicit live runner; npm test never imports or executes this script.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { interpretCase } from "../lib/clinical/interpreter.mjs";
import { createOpenAIProvider } from "../lib/clinical/openai-provider.mjs";
import { caseNames, evaluationCase } from "./clinical-evaluation/cases.mjs";
import { createEvaluationStore } from "./clinical-evaluation/store.mjs";

const directory = fileURLToPath(
  new URL("../.clinical-evaluation/", import.meta.url),
);
const args = process.argv.slice(2);
const initialize = args.includes("--initialize-budget");
const selected = args.filter((arg) => !arg.startsWith("--"));
if (
  !args.includes("--live") ||
  !selected.length ||
  selected.some((name) => !caseNames.includes(name))
) {
  console.error(
    "Usage: node --env-file=.env.local scripts/evaluate-clinical-analysis.mjs --live [--initialize-budget] " +
      caseNames.join(" "),
  );
  process.exitCode = 1;
} else {
  const store = await createEvaluationStore(directory, { initialize });
  const real = createOpenAIProvider();
  for (const name of selected) {
    const start = Date.now(),
      c = evaluationCase(name, start),
      attempt = {
        case: name,
        fictional: true,
        startedAt: new Date(start).toISOString(),
        stages: [],
      };
    const provider = {
      config: real.config,
      estimate: async (...args) => {
        const amountMicros = await real.estimate(...args);
        console.log(
          JSON.stringify({
            case: name,
            phase: args[2] ? "verification" : "interpretation",
            reservationMicros: amountMicros,
          }),
        );
        return amountMicros;
      },
      synthesize: async (...args) => {
        const result = await real.synthesize(...args);
        attempt.stages.push({ phase: "interpretation", ...result });
        return result;
      },
      verify: async (...args) => {
        const result = await real.verify(...args);
        attempt.stages.push({ phase: "verification", ...result });
        return result;
      },
    };
    try {
      attempt.analysis = await interpretCase(c.input, {
        store,
        provider,
        now: start,
      });
      // Reopening the identical case must be free, including original fetches.
      const reopened = await interpretCase(
        {
          ...c.input,
          loadReportInputs: () => {
            throw new Error("cache_fetched_original");
          },
        },
        {
          store,
          provider: {
            config: real.config,
            synthesize: () => {
              throw new Error("cache_called_provider");
            },
          },
          now: start + 1,
        },
      );
      attempt.cacheVerified =
        reopened.cached && reopened.runId === attempt.analysis.runId;
      if (!attempt.cacheVerified)
        throw Object.assign(new Error("cache_failed"), {
          code: "cache_failed",
        });
      attempt.passed = true;
    } catch (error) {
      // Do not print SDK request/headers/body or any key. Fixture outputs are kept
      // in the ignored local artifact for inspection, including rejected drafts.
      attempt.passed = false;
      attempt.error = {
        code: error.code || "request_failed",
        status: error.status || null,
      };
      process.exitCode = 1;
    }
    attempt.durationMs = Date.now() - start;
    attempt.budget = await store.budget();
    const artifactDir = join(directory, "results", `${start}-${name}`);
    await mkdir(artifactDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(artifactDir, "result.json"),
      JSON.stringify(attempt, null, 2),
      { mode: 0o600 },
    );
    await writeFile(join(artifactDir, "report.pdf"), c.originals[0].bytes, {
      mode: 0o600,
    });
    if (name === "iron_glycemia" && attempt.passed)
      await writeFile(
        join(directory, "preview.json"),
        JSON.stringify({
          case: name,
          fictional: true,
          passed: true,
          analysis: attempt.analysis,
        }),
        { mode: 0o600 },
      );
    console.log(
      JSON.stringify({
        case: name,
        passed: attempt.passed,
        error: attempt.error,
        seconds: Math.round(attempt.durationMs / 1000),
        budget: attempt.budget,
        artifact: artifactDir,
      }),
    );
    if (!attempt.passed) break; // inspect a failure before paying for more cases
  }
}
