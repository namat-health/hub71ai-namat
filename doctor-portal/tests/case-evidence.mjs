import assert from "node:assert/strict";
import test from "node:test";
import { buildCaseContext } from "../lib/clinical/case-context.mjs";
import { report, submission } from "./fixtures/clinical-case.mjs";

test("an explicit needs-changes review blocks interpretation even with ordinary draft values", () => {
  const r = structuredClone(report);
  r.review = {
    decision: "needs_changes",
    createdAt: "2026-10-02T10:00:00Z",
    observations: [],
  };
  r.reviewRevision = 1;
  const c = buildCaseContext(submission, [r]);
  assert.equal(c.readyForInterpretation, false);
  assert.ok(
    c.blockers.some((item) => item.code === "report_review_needs_changes"),
  );
});

test("case dates preserve kind; an issue date never becomes a collection date", () => {
  const r = structuredClone(report);
  Object.assign(r.extraction.observations[0], {
    date: "02/10/2026",
    dateKind: "report",
    dateSourceText: "Report date: 02/10/2026",
    dateSourcePage: 1,
  });
  const c = buildCaseContext(submission, [r]);
  assert.equal(c.observations[0].current.reportDate, "02/10/2026");
  assert.equal(c.observations[0].current.collectionDate, null);
  assert.ok(
    c.limitations.some((item) => item.code === "collection_date_unverified"),
  );
  assert.deepEqual(c.assumptions, []);
});

test("source corrections retain immutable original rows and do not upgrade changed dates", () => {
  const r = structuredClone(report),
    original = r.extraction.observations[0];
  Object.assign(original, {
    date: "01/10/2026",
    dateKind: "collection",
    dateSourceText: "Collection date: 01/10/2026",
    dateSourcePage: 1,
  });
  const revised = {
    ...original,
    value: "41",
    date: "02/10/2026",
    confirmed: true,
  };
  delete revised.dateKind;
  delete revised.dateSourceText;
  delete revised.dateSourcePage;
  r.review = { decision: "corrected", observations: [revised] };
  r.reviewRevision = 1;
  const c = buildCaseContext(submission, [r]);
  assert.equal(c.observations[0].asRecorded.value, "14");
  assert.equal(c.observations[0].current.value, "41");
  assert.equal(c.observations[0].asRecorded.collectionDate, "01/10/2026");
  assert.equal(c.observations[0].current.dateKind, "unknown");
  assert.equal(c.observations[0].current.collectionDate, null);
  assert.equal(
    c.observations[0].asRecorded.sourceText,
    "Ferritin 14 ng/mL 15-150",
  );
});

test("a correction with no uniquely matching original source blocks source-grounded interpretation", () => {
  const r = structuredClone(report);
  r.review = {
    decision: "corrected",
    observations: [
      {
        ...r.extraction.observations[0],
        sourceText: "An edited quotation",
        confirmed: true,
      },
    ],
  };
  r.reviewRevision = 1;
  const c = buildCaseContext(submission, [r]);
  assert.equal(c.readyForInterpretation, false);
  assert.ok(c.blockers.some((item) => item.code === "unmatched_review_source"));
  assert.equal(c.observations[0].asRecorded.sourceText, null);
});

test("source coverage is partial even with full page text and changes invalidate fingerprints", () => {
  const r = structuredClone(report);
  r.evidenceVersion = "namat-report-evidence-v1";
  r.extraction.pages[0].lines = [
    {
      id: "page:1:line:0",
      text: "An unsupported assay 42 units",
      bounds: null,
    },
  ];
  const c = buildCaseContext(submission, [r]);
  assert.equal(c.reports[0].coverage.status, "partial");
  assert.equal(c.reports[0].coverage.sourcePagesAvailable, true);
  assert.ok(c.reports[0].pages[0].lines[0].id.endsWith("page:1:line:0"));
  r.extraction.pages[0].lines[0].text = "An unsupported assay 43 units";
  assert.notEqual(
    buildCaseContext(submission, [r]).caseFingerprint,
    c.caseFingerprint,
  );
  delete r.extraction.pages[0].text;
  const incomplete = buildCaseContext(submission, [r]);
  assert.ok(
    incomplete.limitations.some(
      (item) => item.code === "source_pages_unavailable",
    ),
  );
});
