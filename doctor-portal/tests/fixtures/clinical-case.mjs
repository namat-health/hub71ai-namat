// Fictional data only. No generated clinical interpretation is included.
export const submission = {
  id: "8deb6350-ccb3-4644-a751-87ac104c5db2",
  questionnaire_version: "namat-hackathon-welcome-v2",
  first_name: "Do not send this field",
  email: "fixture@example.invalid",
  created_at: "2026-10-01T12:00:00Z",
  answers: {
    age: "42",
    sex: "female",
    height_cm: "168",
    weight_kg: "65",
    goals: ["symptoms"],
    symptoms: ["energy"],
    history: ["none"],
    medicines: "yes",
    tobacco: "never",
    alcohol: "declined",
    family: ["unsure"],
  },
  notes: { medicines: "Biotin, dose unknown" },
  attached_reports: [
    {
      id: "d4c2d7d1-39c6-4c01-a988-98248dd2513a",
      status: "ready",
      sourceUrl: "/fixture/source",
    },
  ],
};
export const report = {
  report: {
    id: submission.attached_reports[0].id,
    status: "ready",
    pageCount: 1,
  },
  extraction: {
    id: "f6e4f9f3-5be8-4e23-8c1a-bb46aff4735c",
    processorVersion: "fixture:native",
    createdAt: "2026-10-01T10:00:00Z",
    pages: [
      {
        number: 1,
        unit: "pt",
        text: "Fictional report. Ferritin 14 ng/mL 15-150",
        lines: [],
      },
    ],
    observations: [
      {
        name: "Ferritin",
        value: "14",
        unit: "ng/mL",
        referenceRange: "15-150",
        date: null,
        page: 1,
        sourceText: "Ferritin 14 ng/mL 15-150",
        bounds: { x: 10, y: 20, width: 100, height: 10 },
      },
    ],
    warnings: [],
  },
  review: null,
  reviewRevision: 0,
};
