// Local, fictional evaluation only. Production migration 004 reserves this
// entire $5 allocation inside the shared $20 cap before production is enabled.
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
export const EVALUATION_ALLOCATION_ID = "4d2d22a0-4339-4a7a-9a50-09d3a76f1505";
export const EVALUATION_LIMIT_MICROS = 5_000_000;
const failure = (code) => Object.assign(new Error(code), { code });
export async function createEvaluationStore(
  directory,
  { initialize = false } = {},
) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = join(directory, "ledger.json"),
    lockname = join(directory, "ledger.lock");
  if (initialize) {
    const file = await open(filename, "wx", 0o600);
    try {
      await file.writeFile(
        JSON.stringify({
          allocationId: EVALUATION_ALLOCATION_ID,
          limitMicros: EVALUATION_LIMIT_MICROS,
          closed: false,
          reservations: {},
          runs: [],
        }),
      );
      await file.sync();
    } finally {
      await file.close();
    }
  }
  const load = async () => {
    let data;
    try {
      data = JSON.parse(await readFile(filename, "utf8"));
    } catch {
      throw failure("evaluation_ledger_unavailable");
    }
    if (
      data.allocationId !== EVALUATION_ALLOCATION_ID ||
      data.limitMicros !== EVALUATION_LIMIT_MICROS ||
      !data.reservations ||
      !Array.isArray(data.runs)
    )
      throw failure("evaluation_ledger_invalid");
    return data;
  };
  await load(); // Never silently create/reset a missing or damaged ledger.
  const budget = (data) => {
    const entries = Object.values(data.reservations);
    const spentMicros = entries.reduce(
      (sum, row) => sum + (row.actualMicros ?? 0),
      0,
    );
    const reservedMicros = entries.reduce(
      (sum, row) => sum + (row.actualMicros == null ? row.amountMicros : 0),
      0,
    );
    return {
      limitMicros: data.limitMicros,
      spentMicros,
      reservedMicros,
      remainingMicros: Math.max(
        0,
        data.limitMicros - spentMicros - reservedMicros,
      ),
    };
  };
  const mutate = async (fn) => {
    let lock;
    try {
      lock = await open(lockname, "wx", 0o600);
    } catch {
      throw failure("evaluation_ledger_locked");
    }
    try {
      const data = await load(),
        result = fn(data);
      const temporary = join(directory, `ledger.${process.pid}.tmp`),
        file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify(data, null, 2));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, filename);
      const dir = await open(directory, "r");
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
      return result;
    } finally {
      await lock.close();
      await unlink(lockname);
    }
  };
  return {
    budget: async () => budget(await load()),
    reserve: (input) =>
      mutate((data) => {
        if (data.closed) throw failure("evaluation_closed");
        if (
          !Number.isSafeInteger(input.amountMicros) ||
          input.amountMicros <= 0
        )
          throw failure("invalid_reservation");
        const previous = data.reservations[input.reservationId];
        if (previous) {
          if (previous.amountMicros !== input.amountMicros)
            throw failure("reservation_conflict");
          return;
        }
        if (budget(data).remainingMicros < input.amountMicros)
          throw failure("budget_exhausted");
        data.reservations[input.reservationId] = {
          ...input,
          createdAt: new Date().toISOString(),
        };
      }),
    settle: (input) =>
      mutate((data) => {
        const row = data.reservations[input.reservationId];
        if (
          !row ||
          !Number.isSafeInteger(input.actualMicros) ||
          input.actualMicros < 0
        )
          throw failure("invalid_settlement");
        if (row.actualMicros != null && row.actualMicros !== input.actualMicros)
          throw failure("settlement_conflict");
        row.actualMicros = input.actualMicros;
        row.settledAt ||= new Date().toISOString();
      }),
    findRun: async ({ submissionId, cacheKey, now }) =>
      (await load()).runs.find(
        (row) =>
          row.submissionId === submissionId &&
          row.cacheKey === cacheKey &&
          Date.parse(row.expiresAt) > Date.parse(now),
      ) || null,
    getRun: async ({ submissionId, runId }) =>
      (await load()).runs.find(
        (row) => row.submissionId === submissionId && row.id === runId,
      ) || null,
    saveRun: (input) =>
      mutate((data) => {
        if (data.runs.some((row) => row.id === input.id))
          throw failure("run_exists");
        data.runs.push(input);
        return input;
      }),
  };
}
