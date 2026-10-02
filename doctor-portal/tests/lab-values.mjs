import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmObservation,
  correctObservation,
  displayUnit,
  labLabel,
  labReport,
  labSection,
  mergeReportLabs,
  rangePosition,
  reviewedList,
} from "../lib/lab-values.mjs";

const reportId = "d4c2d7d1-39c6-4c01-a988-98248dd2513a";
const otherReportId = "e5d3e8e2-4ad7-4d12-b099-a9359ee3624b";

// Observations in the report engine's projection: values as printed.
function observation(name, value, extra = {}) {
  return {
    name,
    value,
    unit: null,
    referenceRange: null,
    date: null,
    sourceText: `${name} ${value}`,
    page: 1,
    bounds: null,
    ...extra,
  };
}

function report(
  observations,
  {
    pages = [{ number: 1, unit: "pt" }],
    id = reportId,
    version = "namat-lab-draft-2026-10-01.1:native",
  } = {},
) {
  return labReport({
    report: { id, status: "ready", pageCount: pages.length },
    extraction: {
      id: "f6e4f9f3-5be8-4e23-8c1a-bb46aff4735c",
      processorVersion: version,
      createdAt: "2026-10-01T10:00:00.000Z",
      pages,
      observations,
      warnings: ["Draft values require comparison with the source report."],
    },
  });
}

test("printed names map to knowledge-base IDs, display names and panels", () => {
  const { extraction } = report([
    observation("Haemoglobin", "11.4", {
      unit: "g/dL",
      referenceRange: "12.0 - 15.5",
    }),
    observation("Fasting Glucose", "94", { unit: "mg/dL" }),
    observation("25-OH Vitamin D", "18", { unit: "ng/mL" }),
    observation("hs-CRP", "2.4", { unit: "mg/L" }),
    observation("C-Reactive Protein", "4", { unit: "mg/L" }),
    observation("LDL Cholesterol", "138", { unit: "mg/dL" }),
    observation("FT4", "1.1", { unit: "ng/dL" }),
    observation("Unlisted assay", "7", { unit: "U/L" }),
  ]);
  assert.deepEqual(
    extraction.labs.map(({ id, name, short, panel }) => [
      id,
      name,
      short,
      panel,
    ]),
    [
      ["haemoglobin", "Haemoglobin", "Hb", "Blood count"],
      ["glucose", "Glucose, fasting", "Glucose", "Glycaemic"],
      ["vitamin-d-25-oh", "Vitamin D, 25-OH", "Vitamin D", "Iron & vitamins"],
      ["hs-crp", "hs-CRP", "hs-CRP", "Inflammation"],
      ["crp", "CRP", "CRP", "Inflammation"],
      ["ldl-cholesterol", "LDL cholesterol", "LDL", "Lipids"],
      ["free-t4", "Free T4", "Free T4", "Thyroid"],
      ["unlisted-assay", "Unlisted assay", "Unlisted assay", "Other"],
    ],
  );
  assert.equal(labSection(extraction.labs[0]), "Blood count");
  assert.equal(labSection(extraction.labs[1]), "Chemistry");
  assert.equal(labLabel(extraction.labs[0]), "Hb 11.4");
  assert.equal(extraction.ocr, false);
});

test("flags compare only with the printed range, including one-sided ranges and comparators", () => {
  const { extraction } = report([
    observation("Ferritin", "14", {
      unit: "ng/mL",
      referenceRange: "15 - 150",
    }),
    observation("TSH", "3.9", { unit: "mIU/L", referenceRange: "0.4 - 4.5" }),
    observation("Cholesterol", "214", {
      unit: "mg/dL",
      referenceRange: "<200",
    }),
    observation("HbA1c", "5.7", { unit: "%", referenceRange: "< 5.7" }),
    observation("HDL", "58", { unit: "mg/dL", referenceRange: "> 50" }),
    observation("CRP", "<5", { unit: "mg/L", referenceRange: "<5" }),
    observation("Glucose", "<50", { unit: "mg/dL", referenceRange: "70 - 99" }),
    observation("ALT", ">200", { unit: "U/L", referenceRange: "7 - 56" }),
    observation("AST", "30", { unit: "U/L", referenceRange: "see note" }),
  ]);
  const byId = Object.fromEntries(extraction.labs.map((lab) => [lab.id, lab]));
  assert.equal(byId.ferritin.flag, "low");
  assert.equal(byId.ferritin.value, 14);
  assert.equal(byId.ferritin.refText, "15 – 150");
  assert.equal(byId.tsh.flag, null);
  assert.equal(byId["total-cholesterol"].flag, "high");
  assert.deepEqual(
    [byId["total-cholesterol"].refLow, byId["total-cholesterol"].refHigh],
    [null, 200],
  );
  assert.equal(byId["total-cholesterol"].refText, "< 200");
  assert.equal(byId.hba1c.flag, "high");
  assert.equal(byId["hdl-cholesterol"].flag, null);
  assert.equal(byId.crp.flag, null);
  assert.equal(byId.crp.comparator, "<");
  assert.equal(byId.crp.display, "<5");
  assert.equal(byId.glucose.flag, "low");
  assert.equal(byId.alt.flag, "high");
  assert.equal(byId.ast.flag, null);
  assert.equal(byId.ast.refText, "see note");
});

test("uncertain readings carry a short confirmation note", () => {
  const { extraction } = report([
    observation("25-OH Vitamin D", "18", {
      referenceRange: "30 - 100",
      sourceText: "25-OH Vitamin D 18 30 - 100 ng/mL",
    }),
    observation("Glucose", "5,2", {
      unit: "mmol/L",
      referenceRange: "3,9 - 5,5",
    }),
    observation("WBC", "6,500", { unit: "/uL" }),
    observation("Ferritin", "2000", {
      unit: "ng/mL",
      referenceRange: "15 - 150",
    }),
    observation("TSH", "2.1"),
    observation("Sodium", "140", {
      unit: "mmol/L",
      referenceRange: "135 - 145",
    }),
  ]);
  const byId = Object.fromEntries(extraction.labs.map((lab) => [lab.id, lab]));
  assert.equal(byId["vitamin-d-25-oh"].unit, "ng/mL");
  assert.equal(
    byId["vitamin-d-25-oh"].note,
    "No unit printed. Read as ng/mL. Please confirm.",
  );
  assert.equal(byId.glucose.value, 5.2);
  assert.equal(byId.glucose.flag, null);
  assert.equal(byId.glucose.note, "Read 5,2 as 5.2. Please confirm.");
  assert.equal(byId["white-cell-count"].value, 6500);
  assert.equal(
    byId["white-cell-count"].note,
    "Read 6,500 as 6500. Please confirm.",
  );
  assert.equal(
    byId.ferritin.note,
    "Far outside the printed range. Please confirm.",
  );
  assert.equal(byId.tsh.note, "No unit printed. Please confirm.");
  assert.equal(byId.tsh.unit, null);
  assert.equal(byId.sodium.note, null);
  assert.equal(byId.sodium.confidence, null);
});

test("a marker printed twice with different values keeps both rows, unique IDs and a note", () => {
  const { extraction } = report(
    [
      observation("Glucose", "94", { unit: "mg/dL" }),
      observation("Glucose", "101", { unit: "mg/dL", page: 2 }),
    ],
    {
      pages: [
        { number: 1, unit: "pt" },
        { number: 2, unit: "pt" },
      ],
    },
  );
  assert.deepEqual(
    extraction.labs.map((lab) => lab.id),
    ["glucose", "glucose-2"],
  );
  assert.equal(extraction.labs[0].note, "Also printed as 101. Please confirm.");
  assert.equal(extraction.labs[1].note, "Also printed as 94. Please confirm.");
});

test("bounds become page boxes: PDF points, OCR inches converted, image pixels kept", () => {
  const native = report([
    observation("Ferritin", "14", {
      unit: "ng/mL",
      bounds: { x: 44.5, y: 120.25, width: 300, height: 11 },
    }),
  ]);
  assert.deepEqual(native.extraction.labs[0].bbox, [44.5, 120.25, 300, 11]);
  const ocrPdf = report(
    [
      observation("Ferritin", "14", {
        unit: "ng/mL",
        bounds: [1, 2, 4, 2, 4, 2.25, 1, 2.25],
      }),
    ],
    {
      pages: [{ number: 1, unit: "inch" }],
      version: "namat-lab-draft-2026-10-01.1:azure-layout",
    },
  );
  assert.deepEqual(ocrPdf.extraction.labs[0].bbox, [72, 144, 216, 18]);
  assert.equal(ocrPdf.extraction.ocr, true);
  const image = report(
    [
      observation("Ferritin", "14", {
        unit: "ng/mL",
        bounds: [100, 400, 900, 400, 900, 430, 100, 430],
      }),
    ],
    {
      pages: [{ number: 1, unit: "pixel" }],
      version: "namat-lab-draft-2026-10-01.1:azure-layout",
    },
  );
  assert.deepEqual(image.extraction.labs[0].bbox, [100, 400, 800, 30]);
  assert.equal(
    report([observation("Ferritin", "14", { bounds: [1, 2, 3] })]).extraction
      .labs[0].bbox,
    null,
  );
});

test("rows follow reading order on each page when every row has bounds", () => {
  const { extraction } = report(
    [
      observation("TSH", "2.1", {
        unit: "mIU/L",
        bounds: { x: 40, y: 300, width: 200, height: 10 },
      }),
      observation("Ferritin", "14", {
        unit: "ng/mL",
        page: 2,
        bounds: { x: 40, y: 100, width: 200, height: 10 },
      }),
      observation("Glucose", "94", {
        unit: "mg/dL",
        bounds: { x: 40, y: 120, width: 200, height: 10 },
      }),
    ],
    {
      pages: [
        { number: 1, unit: "pt" },
        { number: 2, unit: "pt" },
      ],
    },
  );
  assert.deepEqual(
    extraction.labs.map((lab) => lab.id),
    ["glucose", "tsh", "ferritin"],
  );
});

test("labs from several reports keep stable, unique IDs in report order", () => {
  const first = report([observation("Ferritin", "14", { unit: "ng/mL" })])
    .extraction.labs;
  const second = report(
    [
      observation("Ferritin", "22", { unit: "ng/mL" }),
      observation("TSH", "2", { unit: "mIU/L" }),
    ],
    { id: otherReportId },
  ).extraction.labs;
  const merged = mergeReportLabs([first, second]);
  assert.deepEqual(
    merged.map((lab) => [lab.id, lab.reportId]),
    [
      ["ferritin", reportId],
      ["ferritin-2", otherReportId],
      ["tsh", otherReportId],
    ],
  );
});

test("a report still being read returns its status without values", () => {
  assert.deepEqual(
    labReport({
      report: { id: reportId, status: "processing", pageCount: null },
      extraction: null,
    }),
    {
      reportId,
      status: "processing",
      pageCount: null,
      revision: 0,
      extraction: null,
    },
  );
});

test("range bar position places the printed range in the middle half", () => {
  const position = (value, refLow, refHigh) =>
    rangePosition({ value, refLow, refHigh });
  assert.equal(position(15, 15, 150), 25);
  assert.equal(position(150, 15, 150), 75);
  assert.equal(position(82.5, 15, 150), 50);
  assert.equal(position(14, 15, 150), 24.62962962962963);
  assert.equal(position(1000, 15, 150), 96);
  assert.equal(position(-50, 15, 150), 4);
  assert.equal(position(100, null, 200), 50);
  assert.equal(position(75, 50, null), 50);
  assert.equal(position(5, null, null), null);
  assert.equal(position(null, 1, 2), null);
});

test("count units read naturally on screen without changing the data", () => {
  assert.equal(displayUnit("10^9/L"), "×10⁹/L");
  assert.equal(displayUnit("x10^12/L"), "×10¹²/L");
  assert.equal(displayUnit("×10⁹/L"), "×10⁹/L");
  assert.equal(displayUnit("mg/dL"), "mg/dL");
  assert.equal(displayUnit(null), null);
});

const FIELDS = [
  "name",
  "value",
  "unit",
  "referenceRange",
  "date",
  "sourceText",
  "page",
];
const fields = (observation) =>
  Object.fromEntries(FIELDS.map((field) => [field, observation[field]]));
const vitaminD = observation("25-OH Vitamin D", "18", {
  referenceRange: "30 - 100",
  sourceText: "25-OH Vitamin D 18 30 - 100 ng/mL",
  bounds: { x: 52, y: 300, width: 400, height: 11 },
});
const ferritin = observation("Ferritin", "14", {
  unit: "ng/mL",
  referenceRange: "15 - 150",
  sourceText: "Ferritin 14 ng/mL 15 - 150",
  bounds: { x: 52, y: 280, width: 400, height: 11 },
});
const tsh = observation("TSH", "2.1", {
  sourceText: "TSH 2.1",
  bounds: { x: 52, y: 320, width: 400, height: 11 },
});

function reviewed(reviewObservations, decision = "corrected") {
  return labReport({
    report: { id: reportId, status: "ready", pageCount: 1 },
    extraction: {
      id: "f6e4f9f3-5be8-4e23-8c1a-bb46aff4735c",
      processorVersion: "namat-lab-draft-2026-10-01.1:native",
      createdAt: "2026-10-01T10:00:00.000Z",
      pages: [{ number: 1, unit: "pt" }],
      observations: [vitaminD, ferritin, tsh],
      warnings: [],
    },
    review: {
      revision: 2,
      decision,
      createdAt: "2026-10-01T11:00:00.000Z",
      observations: reviewObservations,
    },
    reviewRevision: 3,
  });
}

test("checked values replace the draft, keep their place in the report and lose their note", () => {
  const result = reviewed([
    { ...fields(vitaminD), unit: "ng/mL", confirmed: true },
    { ...fields(ferritin), confirmed: false },
    { ...fields(tsh), confirmed: false },
  ]);
  assert.equal(result.revision, 3);
  assert.equal(result.extraction.reviewedAt, "2026-10-01T11:00:00.000Z");
  const byId = Object.fromEntries(
    result.extraction.labs.map((lab) => [lab.id, lab]),
  );
  assert.equal(byId["vitamin-d-25-oh"].note, null);
  assert.equal(byId["vitamin-d-25-oh"].confirmed, true);
  assert.equal(byId["vitamin-d-25-oh"].unit, "ng/mL");
  assert.deepEqual(byId["vitamin-d-25-oh"].bbox, [52, 300, 400, 11]);
  assert.equal(byId["vitamin-d-25-oh"].observationIndex, 0);
  assert.equal(byId.tsh.note, "No unit printed. Please confirm.");
  assert.equal(byId.tsh.confirmed, false);
  assert.equal(byId.tsh.observationIndex, 2);
});

test("an operator review attests every value; one that needs changes leaves the draft in place", () => {
  const attested = reviewed([
    { ...fields(vitaminD), confirmed: false },
    { ...fields(ferritin), confirmed: false },
    { ...fields(tsh), confirmed: false },
  ]);
  assert.ok(attested.extraction.labs.every((lab) => lab.note === null));
  assert.ok(attested.extraction.labs.every((lab) => lab.confirmed === false));
  const needsChanges = reviewed(
    [{ ...fields(ferritin), confirmed: false }],
    "needs_changes",
  );
  assert.equal(needsChanges.extraction.labs.length, 3);
  assert.equal(needsChanges.extraction.reviewedAt, null);
  assert.equal(
    needsChanges.extraction.labs.filter((lab) => lab.note).length,
    2,
  );
});

test("looks right makes the reading explicit; fix replaces it; both are marked confirmed", () => {
  assert.deepEqual(confirmObservation(vitaminD), {
    ...fields(vitaminD),
    unit: "ng/mL",
    confirmed: true,
  });
  assert.equal(confirmObservation({ ...ferritin, value: "5,8" }).value, "5.8");
  assert.equal(
    confirmObservation({ ...ferritin, value: "6,500" }).value,
    "6500",
  );
  assert.equal(confirmObservation({ ...ferritin, value: "< 5,0" }).value, "<5");
  assert.equal(confirmObservation(tsh).unit, null);
  assert.equal(confirmObservation(vitaminD).bounds, undefined);
  assert.deepEqual(
    correctObservation(vitaminD, {
      value: " 19 ",
      unit: "ng/mL",
      referenceRange: "30 – 100",
    }),
    {
      ...fields(vitaminD),
      value: "19",
      unit: "ng/mL",
      referenceRange: "30 – 100",
      confirmed: true,
    },
  );
  assert.equal(
    correctObservation(vitaminD, { value: "19", unit: "ng/\nmL" }).unit,
    "ng/ mL",
  );
  for (const edits of [
    null,
    { value: "" },
    { value: 19 },
    { value: "x".repeat(41) },
    { value: "19", unit: "u".repeat(31) },
  ])
    assert.equal(correctObservation(vitaminD, edits), null);
});

test("the saved list keeps earlier checks and an operator's attestation", () => {
  const replacement = confirmObservation(vitaminD);
  assert.deepEqual(
    reviewedList(
      { observations: [ferritin, vitaminD], attested: false },
      1,
      replacement,
    ),
    [fields(ferritin), replacement],
  );
  assert.deepEqual(
    reviewedList(
      {
        observations: [{ ...ferritin, confirmed: true }, vitaminD],
        attested: false,
      },
      1,
      replacement,
    ),
    [{ ...fields(ferritin), confirmed: true }, replacement],
  );
  assert.deepEqual(
    reviewedList(
      { observations: [ferritin, vitaminD], attested: true },
      1,
      replacement,
    ),
    [{ ...fields(ferritin), confirmed: true }, replacement],
  );
});
