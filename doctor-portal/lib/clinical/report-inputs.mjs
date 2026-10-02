import { createHash } from "node:crypto";
import { validReportReference, verifyBytes } from "../report-files.mjs";
import { sharedReportSource } from "../shared-api.mjs";

export const MAX_REPORT_INPUTS = 3;
export const MAX_REPORT_INPUT_BYTES = 10 * 1024 * 1024;
export const MAX_REPORT_INPUT_PAGES = 50;
const EXTENSIONS = new Map([
  ["application/pdf", "pdf"],
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
]);
const AVAILABLE = new Set(["queued", "processing", "ready", "failed"]);
const HASH = /^[a-f0-9]{64}$/;

export class ReportInputError extends Error {
  constructor(code = "case_not_ready") {
    super(code);
    this.name = "ReportInputError";
    this.code = code;
  }
}

async function pdfPageCount(bytes) {
  let task;
  try {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    task = getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useWorkerFetch: false,
      disableFontFace: true,
      useSystemFonts: false,
      stopAtErrors: true,
      verbosity: 0,
    });
    const document = await task.promise;
    return document.numPages;
  } catch {
    throw new ReportInputError();
  } finally {
    if (task) await task.destroy();
  }
}

async function readOriginal(response, expectedSize) {
  if (
    response.status !== 200 ||
    response.headers.get("content-length") !== String(expectedSize)
  )
    throw new ReportInputError();
  const reader = response.body?.getReader();
  if (!reader) throw new ReportInputError();
  const chunks = [];
  let total = 0,
    complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        break;
      }
      total += value.byteLength;
      if (total > expectedSize || total > MAX_REPORT_INPUT_BYTES)
        throw new ReportInputError();
      chunks.push(Buffer.from(value));
    }
    if (total !== expectedSize) throw new ReportInputError();
    return Buffer.concat(chunks, total);
  } finally {
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// This function is deliberately invoked only after the interpreter's cache
// lookup. Original bytes remain in request memory and never enter case metadata,
// saved snapshots or browser responses. Source URLs and patient filenames are
// never used as model inputs or fetch destinations.
export async function loadReportInputs(
  { submissionId, attachedReports, reports },
  options = {},
) {
  if (!Array.isArray(attachedReports) || !Array.isArray(reports))
    throw new ReportInputError();
  if (attachedReports.length > MAX_REPORT_INPUTS)
    throw new ReportInputError("analysis_too_large");
  const ids = new Set();
  const selected = attachedReports.map((attachment) => {
    if (
      !validReportReference(submissionId, attachment?.id) ||
      ids.has(attachment.id) ||
      !EXTENSIONS.has(attachment.mime) ||
      !Number.isInteger(attachment.size) ||
      attachment.size < 1 ||
      !AVAILABLE.has(attachment.status) ||
      attachment.sourceUrl !==
        `/api/submissions/${encodeURIComponent(submissionId)}/reports/${encodeURIComponent(attachment.id)}/source`
    )
      throw new ReportInputError();
    if (attachment.size > MAX_REPORT_INPUT_BYTES)
      throw new ReportInputError("analysis_too_large");
    ids.add(attachment.id);
    const matches = reports.filter(
      (item) => item?.report?.id === attachment.id,
    );
    if (matches.length !== 1) throw new ReportInputError();
    const evidence = matches[0];
    const hash = evidence.extraction?.inputSha256 ?? null;
    const pageCount = evidence.report.pageCount;
    if (
      (hash !== null && !HASH.test(hash)) ||
      (pageCount !== null &&
        pageCount !== undefined &&
        (!Number.isInteger(pageCount) || pageCount < 1))
    )
      throw new ReportInputError();
    if (pageCount > MAX_REPORT_INPUT_PAGES)
      throw new ReportInputError("analysis_too_large");
    return {
      id: attachment.id,
      mime: attachment.mime,
      size: attachment.size,
      hash,
      pageCount,
    };
  });
  if (reports.some((item) => !ids.has(item?.report?.id)))
    throw new ReportInputError();
  const result = [];
  for (const [index, expected] of selected.entries()) {
    let response;
    try {
      response = await sharedReportSource(
        new Request("https://doctor.namat.health/api/report-input"),
        { submissionId, reportId: expected.id },
        options,
      );
    } catch (error) {
      if (error?.code === "not_found") throw new ReportInputError();
      throw error;
    }
    if (response.headers.get("content-type") !== expected.mime)
      throw new ReportInputError("conflict");
    const bytes = await readOriginal(response, expected.size);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (expected.hash && sha256 !== expected.hash)
      throw new ReportInputError("conflict");
    if (!verifyBytes(bytes, { ...expected, sha256 }))
      throw new ReportInputError();
    const pageCount =
      expected.mime === "application/pdf" ? await pdfPageCount(bytes) : 1;
    if (!Number.isInteger(pageCount) || pageCount < 1)
      throw new ReportInputError();
    if (pageCount > MAX_REPORT_INPUT_PAGES)
      throw new ReportInputError("analysis_too_large");
    if (expected.pageCount != null && pageCount !== expected.pageCount)
      throw new ReportInputError("conflict");
    result.push({
      reportId: expected.id,
      filename: `report-${index + 1}.${EXTENSIONS.get(expected.mime)}`,
      mime: expected.mime,
      bytes,
      pageCount,
      sha256,
    });
  }
  return result;
}
