import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  caseNames,
  evaluationCase,
} from "../scripts/clinical-evaluation/cases.mjs";
import {
  createEvaluationStore,
  EVALUATION_LIMIT_MICROS,
} from "../scripts/clinical-evaluation/store.mjs";

test("evaluation budget persists uncertainty, caps reservations and cannot silently reset", async () => {
  const dir = await mkdtemp(join(tmpdir(), "namat-eval-budget-"));
  try {
    await assert.rejects(() => createEvaluationStore(dir), {
      code: "evaluation_ledger_unavailable",
    });
    const a = await createEvaluationStore(dir, { initialize: true });
    await a.reserve({ reservationId: "one", amountMicros: 3_000_000 });
    const b = await createEvaluationStore(dir);
    await assert.rejects(
      () => b.reserve({ reservationId: "two", amountMicros: 3_000_000 }),
      { code: "budget_exhausted" },
    );
    await assert.rejects(
      () => createEvaluationStore(dir, { initialize: true }),
      { code: "EEXIST" },
    );
    await a.settle({ reservationId: "one", actualMicros: 250000 });
    assert.equal(
      (await b.budget()).remainingMicros,
      EVALUATION_LIMIT_MICROS - 250000,
    );
    await writeFile(join(dir, "ledger.lock"), "active");
    await assert.rejects(
      () => b.reserve({ reservationId: "two", amountMicros: 1 }),
      { code: "evaluation_ledger_locked" },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("live evaluation cases contain complete fictional original PDFs and prepared source evidence", () => {
  for (const name of caseNames) {
    const c = evaluationCase(name);
    assert.equal(c.input.caseContext.readyForInterpretation, true, name);
    assert.equal(c.input.caseContext.reportCoverageComplete, true);
    assert.ok(
      !c.input.caseContext.limitations.some(
        (x) => x.code === "parser_inventory_unverified",
      ),
    );
    assert.match(c.originals[0].bytes.toString(), /^%PDF/);
    assert.ok(c.input.caseContext.observations.length);
  }
});
