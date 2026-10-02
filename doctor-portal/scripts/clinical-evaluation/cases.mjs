import { createHash } from "node:crypto";
import { buildCaseContext } from "../../lib/clinical/case-context.mjs";
import { applyInventoryReviews } from "../../lib/clinical/interpreter.mjs";
import {
  report as baseReport,
  submission as baseSubmission,
} from "../../tests/fixtures/clinical-case.mjs";

// Valid, simple one-page PDF with ASCII text. All case data is authored fiction.
function reportPdf(lines) {
  const escapePdf = (s) =>
    s.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const stream = `BT /F1 11 Tf 40 800 Td 16 TL ${lines.map((line, i) => `${i ? "T* " : ""}(${escapePdf(line)}) Tj`).join("\n")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n",
    offsets = [0];
  for (const [i, obj] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  }
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(pdf);
}
const rows = {
  iron_glycemia: [
    ["Haemoglobin", "110", "g/L", "120-160"],
    ["MCV", "74", "fL", "80-100"],
    ["HbA1c", "6.1", "%", "4.0-5.6"],
  ],
  medicine_context: [
    ["Ferritin", "14", "ng/mL", "15-150"],
    ["Magnesium", "0.6", "mmol/L", "0.7-1.0"],
  ],
  recent_ferritin: [
    ["Haemoglobin", "110", "g/L", "120-160"],
    ["MCV", "74", "fL", "80-100"],
    ["Ferritin", "130", "ng/mL", "15-150"],
  ],
  critical_potassium: [["Potassium", "7.1", "mmol/L", "3.5-5.1", "CRITICAL"]],
};
export const caseNames = Object.keys(rows);
export function evaluationCase(name, now = Date.now()) {
  if (!rows[name]) throw new Error("Choose a named fictional case.");
  const patient = structuredClone(baseSubmission),
    report = structuredClone(baseReport);
  patient.id = createHash("sha256")
    .update(`fictional-evaluation-${name}`)
    .digest("hex")
    .slice(0, 32)
    .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
  patient.notes.medicines =
    name === "medicine_context"
      ? "Patient reports long-term proton-pump inhibitor use; exact agent, dose and duration are unknown."
      : "Patient reports biotin use; dose is unknown.";
  // Pregnancy status is deliberately unrecorded in this fixture.
  const date = "2026-09-20",
    dateSourceText = `Specimen collected: ${date}`;
  const observations = rows[name].map(
    ([name, value, unit, referenceRange, flag]) => ({
      name,
      value,
      unit,
      referenceRange,
      date,
      dateKind: "collection",
      dateSourceText,
      dateSourcePage: 1,
      page: 1,
      sourceText: [name, value, unit, referenceRange, flag]
        .filter(Boolean)
        .join(" "),
      bounds: null,
    }),
  );
  const lines = [
    "FICTIONAL CASE - DEVELOPMENT ONLY",
    dateSourceText,
    "Test | Result | Units | Printed reference range",
    ...observations.map((x) => x.sourceText),
    "End of fictional report",
  ];
  const bytes = reportPdf(lines),
    sha256 = createHash("sha256").update(bytes).digest("hex");
  report.extraction.observations = observations;
  report.extraction.inputSha256 = sha256;
  report.extraction.pages = [
    {
      number: 1,
      unit: "pt",
      text: lines.join("\n"),
      lines: lines.map((text, i) => ({
        id: `page:1:line:${i}`,
        text,
        bounds: null,
      })),
    },
  ];
  report.evidenceVersion = "namat-report-evidence-v1";
  const context = applyInventoryReviews(
    buildCaseContext(patient, [report], { now }),
    [
      {
        reportId: report.report.id,
        extractionId: report.extraction.id,
        reviewRevision: 0,
        createdAt: "2026-09-21T00:00:00.000Z",
        actor: "Fictional evaluation inventory attestation",
      },
    ],
  );
  const originals = [
    {
      reportId: report.report.id,
      filename: "report-1.pdf",
      mime: "application/pdf",
      bytes,
      pageCount: 1,
      sha256,
    },
  ];
  return {
    name,
    originals,
    input: {
      caseContext: context,
      submissionId: patient.id,
      inputSnapshot: {
        questionnaireVersion: patient.questionnaire_version,
        answers: patient.answers,
        notes: patient.notes,
        reports: [
          {
            reportId: report.report.id,
            extractionId: report.extraction.id,
            reviewRevision: 0,
          },
        ],
      },
      expiresAt: new Date(now + 86400000).toISOString(),
      loadReportInputs: async () => originals,
    },
  };
}
