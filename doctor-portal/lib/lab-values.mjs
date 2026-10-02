// Turns the report engine's draft extraction into the lab values shown on the
// review screen. Values stay as printed. A flag compares a value only with the
// range printed beside it on the same report, never with clinical targets.
// Pure module: used by API routes and the browser.

const BLOOD_COUNT = "Blood count";

// [normalised printed name, id, name, short, panel]. IDs follow the clinical
// knowledge base where it has the marker.
const MARKERS = [
  [/^ha?emoglobin$/, "haemoglobin", "Haemoglobin", "Hb", BLOOD_COUNT],
  [/^ha?ematocrit$/, "haematocrit", "Haematocrit", "Hct", BLOOD_COUNT],
  [/^rbc$/, "red-cell-count", "Red cell count", "RBC", BLOOD_COUNT],
  [/^wbc$/, "white-cell-count", "White cell count", "WBC", BLOOD_COUNT],
  [/^platelets?$/, "platelets", "Platelets", "Platelets", BLOOD_COUNT],
  [/^mcv$/, "mcv", "MCV", "MCV", BLOOD_COUNT],
  [/^mch$/, "mch", "MCH", "MCH", BLOOD_COUNT],
  [/^mchc$/, "mchc", "MCHC", "MCHC", BLOOD_COUNT],
  [/^rdw$/, "rdw", "RDW", "RDW", BLOOD_COUNT],
  [/^neutrophils?$/, "neutrophils", "Neutrophils", "Neutrophils", BLOOD_COUNT],
  [/^lymphocytes?$/, "lymphocytes", "Lymphocytes", "Lymphocytes", BLOOD_COUNT],
  [/^monocytes?$/, "monocytes", "Monocytes", "Monocytes", BLOOD_COUNT],
  [/^eosinophils?$/, "eosinophils", "Eosinophils", "Eosinophils", BLOOD_COUNT],
  [/^basophils?$/, "basophils", "Basophils", "Basophils", BLOOD_COUNT],
  [/^(hba1c|glycated ha?emoglobin)$/, "hba1c", "HbA1c", "HbA1c", "Glycaemic"],
  [/^fasting glucose$/, "glucose", "Glucose, fasting", "Glucose", "Glycaemic"],
  [/^glucose$/, "glucose", "Glucose", "Glucose", "Glycaemic"],
  [/^insulin$/, "insulin", "Insulin", "Insulin", "Glycaemic"],
  [
    /^total cholesterol$/,
    "total-cholesterol",
    "Cholesterol, total",
    "Total cholesterol",
    "Lipids",
  ],
  [
    /^cholesterol$/,
    "total-cholesterol",
    "Cholesterol",
    "Total cholesterol",
    "Lipids",
  ],
  [
    /^hdl( cholesterol)?$/,
    "hdl-cholesterol",
    "HDL cholesterol",
    "HDL",
    "Lipids",
  ],
  [
    /^ldl( cholesterol)?$/,
    "ldl-cholesterol",
    "LDL cholesterol",
    "LDL",
    "Lipids",
  ],
  [/^triglycerides?$/, "triglycerides", "Triglycerides", "TG", "Lipids"],
  [/^creatinine$/, "creatinine", "Creatinine", "Creatinine", "Kidney"],
  [/^egfr$/, "egfr", "eGFR", "eGFR", "Kidney"],
  [/^urea$/, "urea", "Urea", "Urea", "Kidney"],
  [/^bun$/, "bun", "BUN", "BUN", "Kidney"],
  [/^uric acid$/, "uric-acid", "Uric acid", "Uric acid", "Kidney"],
  [/^sodium$/, "sodium", "Sodium", "Sodium", "Electrolytes"],
  [/^potassium$/, "potassium", "Potassium", "Potassium", "Electrolytes"],
  [/^chloride$/, "chloride", "Chloride", "Chloride", "Electrolytes"],
  [
    /^bicarbonate$/,
    "bicarbonate",
    "Bicarbonate",
    "Bicarbonate",
    "Electrolytes",
  ],
  [/^calcium$/, "calcium", "Calcium", "Calcium", "Electrolytes"],
  [/^magnesium$/, "magnesium", "Magnesium", "Magnesium", "Electrolytes"],
  [/^phosph(ate|orus)$/, "phosphate", "Phosphate", "Phosphate", "Electrolytes"],
  [/^alt$/, "alt", "ALT", "ALT", "Liver"],
  [/^ast$/, "ast", "AST", "AST", "Liver"],
  [/^alp$/, "alp", "ALP", "ALP", "Liver"],
  [/^ggt$/, "ggt", "GGT", "GGT", "Liver"],
  [/^total bilirubin$/, "bilirubin", "Bilirubin, total", "Bilirubin", "Liver"],
  [/^bilirubin$/, "bilirubin", "Bilirubin", "Bilirubin", "Liver"],
  [/^albumin$/, "albumin", "Albumin", "Albumin", "Liver"],
  [/^total protein$/, "total-protein", "Total protein", "Protein", "Liver"],
  [/^tsh$/, "tsh", "TSH", "TSH", "Thyroid"],
  [/^(free t4|ft4)$/, "free-t4", "Free T4", "Free T4", "Thyroid"],
  [/^(free t3|ft3)$/, "free-t3", "Free T3", "Free T3", "Thyroid"],
  [/^ferritin$/, "ferritin", "Ferritin", "Ferritin", "Iron & vitamins"],
  [/^iron$/, "serum-iron", "Iron", "Iron", "Iron & vitamins"],
  [
    /^transferrin$/,
    "transferrin",
    "Transferrin",
    "Transferrin",
    "Iron & vitamins",
  ],
  [
    /^25 ?oh vitamin d$/,
    "vitamin-d-25-oh",
    "Vitamin D, 25-OH",
    "Vitamin D",
    "Iron & vitamins",
  ],
  [
    /^vitamin d$/,
    "vitamin-d-25-oh",
    "Vitamin D",
    "Vitamin D",
    "Iron & vitamins",
  ],
  [/^(vitamin )?b12$/, "vitamin-b12", "Vitamin B12", "B12", "Iron & vitamins"],
  [/^folate$/, "folate", "Folate", "Folate", "Iron & vitamins"],
  [/^hs ?crp$/, "hs-crp", "hs-CRP", "hs-CRP", "Inflammation"],
  [/^(crp|c ?reactive protein)$/, "crp", "CRP", "CRP", "Inflammation"],
  [/^esr$/, "esr", "ESR", "ESR", "Inflammation"],
  [
    /^testosterone$/,
    "total-testosterone",
    "Testosterone",
    "Testosterone",
    "Hormones",
  ],
  [/^psa$/, "psa", "PSA", "PSA", "Other"],
];

// The units the parser recognises, searched elsewhere on the line when none
// was printed in the unit position (for example inside the reference column).
const UNIT =
  /(?:^|[\s(|])(mmol\/L|[munpµμ]?g\/(?:dL|L|mL)|IU\/L|U\/L|mIU\/L|[µμu]IU\/mL|pmol\/L|nmol\/L|mL\/min(?:\/1\.73\s?m[²2])?|(?:x\s?)?10\^?(?:3|6|9|12)\/L|×?10[³⁶⁹]\/L|×10¹²\/L|%|fL|mm\/hr)(?=$|[\s),;|])/i;

const COMPARATORS = new Set(["<", ">", "≤", "≥"]);

function normalisedName(name) {
  return name.toLowerCase().replace(/[-–‐]/g, " ").replace(/\s+/g, " ").trim();
}

function marker(printed) {
  const text = normalisedName(printed);
  const known = MARKERS.find(([pattern]) => pattern.test(text));
  if (known) {
    const [, id, name, short, panel] = known;
    return { id, name, short, panel };
  }
  const name = printed.replace(/\s+/g, " ").trim().slice(0, 80) || "Value";
  return {
    id:
      text
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60) || "value",
    name: name.charAt(0).toUpperCase() + name.slice(1),
    short: name,
    panel: "Other",
  };
}

function toNumber(text) {
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

// "6,500" on a count is a thousands separator; "5,2" is a decimal comma.
// Either way the reading is shown and the doctor is asked to confirm it.
function printedNumber(text) {
  if (!text.includes(",")) return { number: toNumber(text), note: null };
  const thousands = /^[-+]?[1-9]\d{0,2},\d{3}$/.test(text);
  const number = toNumber(
    thousands ? text.replace(",", "") : text.replace(",", "."),
  );
  return {
    number,
    note: number === null ? null : `Read ${text} as ${number}.`,
  };
}

function parseValue(printed) {
  const text = printed.replace(/\s+/g, " ").trim();
  const match = text.match(
    /^([<>≤≥])?\s*([-+]?\d+(?:[.,]\d+)?)(?:\s*[-–]\s*(\d+(?:[.,]\d+)?))?$/,
  );
  if (!match || match[3]) return { value: null, comparator: null, note: null };
  const { number, note } = printedNumber(match[2]);
  return { value: number, comparator: match[1] || null, note };
}

function parseRange(printed) {
  const text = printed.replace(/\s+/g, " ").trim();
  let match = text.match(/^([<>≤≥])\s*(\d+(?:[.,]\d+)?)$/);
  if (match) {
    const bound = toNumber(match[2].replace(",", "."));
    if (bound === null) return null;
    const below = match[1] === "<" || match[1] === "≤";
    return {
      low: below ? null : bound,
      high: below ? bound : null,
      strict: match[1] === "<" || match[1] === ">",
      text: `${match[1]} ${match[2]}`,
    };
  }
  match = text.match(/^(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)$/);
  if (!match) return null;
  const low = toNumber(match[1].replace(",", "."));
  const high = toNumber(match[2].replace(",", "."));
  if (low === null || high === null || low > high) return null;
  return { low, high, strict: false, text: `${match[1]} – ${match[2]}` };
}

// A value printed with a comparator ("<5") is flagged only when every value it
// could stand for lies outside the printed range.
function flagFor(value, comparator, range) {
  if (value === null || !range) return null;
  const { low, high, strict } = range;
  if (comparator === "<" || comparator === "≤")
    return low !== null && value <= low ? "low" : null;
  if (comparator === ">" || comparator === "≥")
    return high !== null && value >= high ? "high" : null;
  if (low !== null && (strict ? value <= low : value < low)) return "low";
  if (high !== null && (strict ? value >= high : value > high)) return "high";
  return null;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

// Bounds become [x, y, width, height] from the page's top-left corner: PDF
// points for PDFs (OCR inches are converted) and pixels for images.
function bbox(bounds, unit) {
  if (Array.isArray(bounds)) {
    if (bounds.length !== 8 || !bounds.every(Number.isFinite)) return null;
    const scale = unit === "inch" ? 72 : 1;
    const xs = [bounds[0], bounds[2], bounds[4], bounds[6]];
    const ys = [bounds[1], bounds[3], bounds[5], bounds[7]];
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return [
      round(x * scale),
      round(y * scale),
      round((Math.max(...xs) - x) * scale),
      round((Math.max(...ys) - y) * scale),
    ];
  }
  if (!bounds || typeof bounds !== "object") return null;
  const box = [bounds.x, bounds.y, bounds.width, bounds.height];
  return box.every(Number.isFinite) ? box.map(round) : null;
}

function inferredUnit(sourceText, display) {
  if (typeof sourceText !== "string") return null;
  const at = sourceText.indexOf(display);
  if (at < 0) return null;
  return sourceText.slice(at + display.length).match(UNIT)?.[1] || null;
}

function labValue(observation, unit, reportId, { index, checked }) {
  const printedName = observation.name || "";
  const { id, name, short, panel } = marker(printedName);
  const display = (observation.value || "").replace(/\s+/g, " ").trim();
  const parsed = parseValue(display);
  const range = observation.referenceRange
    ? parseRange(observation.referenceRange)
    : null;
  const notes = [];
  let printedUnit = observation.unit || null;
  if (!printedUnit) {
    printedUnit = inferredUnit(observation.sourceText, display);
    notes.push(
      printedUnit
        ? `No unit printed. Read as ${printedUnit}.`
        : "No unit printed.",
    );
  }
  if (parsed.note) notes.push(parsed.note);
  if (
    parsed.value !== null &&
    range &&
    ((range.high !== null &&
      range.high > 0 &&
      parsed.value > range.high * 10) ||
      (range.low !== null && range.low > 0 && parsed.value < range.low / 10))
  )
    notes.push("Far outside the printed range.");
  return {
    id,
    marker: id,
    name,
    short,
    value: parsed.value,
    display: display || "—",
    comparator: COMPARATORS.has(parsed.comparator) ? parsed.comparator : null,
    unit: printedUnit,
    refLow: range ? range.low : null,
    refHigh: range ? range.high : null,
    refText: range
      ? range.text
      : (observation.referenceRange || "").trim() || null,
    flag: flagFor(parsed.value, parsed.comparator, range),
    panel,
    page: observation.page,
    bbox: bbox(observation.bounds, unit),
    // The draft parser reports no confidence score; notes carry uncertainty.
    confidence: null,
    note: null,
    notes: checked ? [] : notes,
    // A doctor explicitly confirmed or corrected this value.
    confirmed: observation.confirmed === true,
    observationIndex: index,
    reportId,
  };
}

const REVIEW_FIELDS = [
  "name",
  "value",
  "unit",
  "referenceRange",
  "date",
  "sourceText",
  "page",
];

function reviewFields(observation) {
  return Object.fromEntries(
    REVIEW_FIELDS.map((field) => [field, observation[field] ?? null]),
  );
}

/**
 * The values a doctor works from: the latest approved or corrected review of
 * the draft, otherwise the draft itself. A review without any per-value marks
 * comes from the operator review page, whose reviewer attests every value.
 */
export function currentObservations({ extraction, review }) {
  if (!extraction)
    return { observations: [], reviewed: false, attested: false };
  if (!review || !["approved", "corrected"].includes(review.decision))
    return {
      observations: extraction.observations,
      reviewed: false,
      attested: false,
    };
  return {
    observations: review.observations,
    reviewed: true,
    attested: !review.observations.some(
      (observation) => observation.confirmed === true,
    ),
  };
}

// Reviews store no page bounds: reuse the draft line with the same page and
// printed text, so a checked value can still be found in the report.
function withDraftBounds(observations, draft) {
  const used = new Set();
  return observations.map((observation) => {
    const index = draft.findIndex(
      (candidate, position) =>
        !used.has(position) &&
        candidate.page === observation.page &&
        candidate.sourceText === observation.sourceText,
    );
    if (index < 0) return { ...observation, bounds: null };
    used.add(index);
    return { ...observation, bounds: draft[index].bounds };
  });
}

/** "Looks right": the reading as shown, with any inferred unit made explicit. */
export function confirmObservation(observation) {
  const display = (observation.value || "").replace(/\s+/g, " ").trim();
  const match = display.match(/^([<>≤≥])?\s*([-+]?\d+(?:[.,]\d+)?)$/);
  let value = display || null;
  if (match?.[2].includes(",")) {
    const { number } = printedNumber(match[2]);
    if (number !== null) value = `${match[1] || ""}${number}`;
  }
  return {
    ...reviewFields(observation),
    value,
    unit: observation.unit || inferredUnit(observation.sourceText, display),
    confirmed: true,
  };
}

const EDIT_LIMITS = { value: 40, unit: 30, referenceRange: 60 };

/** "Fix": the doctor's value, unit and range replace the reading. */
export function correctObservation(observation, edits) {
  if (!edits || typeof edits !== "object") return null;
  const clean = {};
  for (const [field, max] of Object.entries(EDIT_LIMITS)) {
    const raw = edits[field];
    if (raw !== undefined && raw !== null && typeof raw !== "string")
      return null;
    const text = (raw || "")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: corrections are one plain line.
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length > max) return null;
    clean[field] = text || null;
  }
  if (!clean.value) return null;
  return { ...reviewFields(observation), ...clean, confirmed: true };
}

/** The full list to save as the next review, with one value replaced. */
export function reviewedList(current, index, replacement) {
  return current.observations.map((observation, position) =>
    position === index
      ? replacement
      : {
          ...reviewFields(observation),
          ...(current.attested || observation.confirmed === true
            ? { confirmed: true }
            : {}),
        },
  );
}

// Unique IDs across every report of a submission: the first ferritin keeps
// "ferritin", later ones become "ferritin-2". Plan evidence uses these IDs.
export function mergeReportLabs(groups) {
  const counts = new Map();
  return groups.flat().map((lab) => {
    const count = (counts.get(lab.marker) || 0) + 1;
    counts.set(lab.marker, count);
    return { ...lab, id: count === 1 ? lab.marker : `${lab.marker}-${count}` };
  });
}

function readingOrder(labs) {
  const pages = new Map();
  for (const lab of labs) {
    if (!pages.has(lab.page)) pages.set(lab.page, []);
    pages.get(lab.page).push(lab);
  }
  return [...pages.keys()]
    .sort((a, b) => a - b)
    .flatMap((page) => {
      const rows = pages.get(page);
      return rows.every((lab) => lab.bbox)
        ? [...rows].sort(
            (a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0],
          )
        : rows;
    });
}

/**
 * Maps one report's extraction response ({report, extraction, review,
 * reviewRevision}) to {reportId, status, pageCount, revision, extraction:
 * {…, labs} | null}. Checked values carry no note.
 */
export function labReport({
  report,
  extraction,
  review = null,
  reviewRevision = 0,
}) {
  const result = {
    reportId: report.id,
    status: report.status,
    pageCount: report.pageCount,
    revision: reviewRevision,
    extraction: null,
  };
  if (!extraction) return result;
  const units = new Map(
    extraction.pages.map((page) => [page.number, page.unit]),
  );
  const current = currentObservations({ extraction, review });
  const observations = current.reviewed
    ? withDraftBounds(current.observations, extraction.observations)
    : current.observations;
  const labs = readingOrder(
    observations
      .map((observation, index) => ({ observation, index }))
      .filter(({ observation }) => observation.name && observation.value)
      .map(({ observation, index }) =>
        labValue(observation, units.get(observation.page) || "pt", report.id, {
          index,
          checked: current.attested || observation.confirmed === true,
        }),
      ),
  );
  for (const lab of labs) {
    if (lab.confirmed || current.attested) continue;
    const others = labs.filter(
      (other) => other.marker === lab.marker && other.display !== lab.display,
    );
    if (others.length)
      lab.notes.push(
        `Also printed as ${others.map((other) => other.display).join(", ")}.`,
      );
  }
  return {
    ...result,
    extraction: {
      id: extraction.id,
      processorVersion: extraction.processorVersion,
      extractedAt: extraction.createdAt,
      reviewedAt: current.reviewed ? review.createdAt : null,
      ocr: /:azure-layout$/.test(extraction.processorVersion),
      warnings: extraction.warnings,
      labs: mergeReportLabs([labs]).map(({ notes, ...lab }) => ({
        ...lab,
        note: notes.length ? `${notes.join(" ")} Please confirm.` : null,
      })),
    },
  };
}

/** Coarse grouping used on screen: the blood count, then everything else. */
export function labSection(lab) {
  return lab.panel === BLOOD_COUNT ? "Blood count" : "Chemistry";
}

/**
 * Dot position on the 72px range bar, in percent. The printed range fills the
 * middle half; a one-sided range starts at zero ("< X") or spans to 2X ("> X").
 */
export function rangePosition(lab) {
  if (lab.value === null || (lab.refLow === null && lab.refHigh === null))
    return null;
  const low = lab.refLow ?? 0;
  const high = lab.refHigh ?? low * 2;
  if (!(high > low)) return null;
  return Math.min(
    96,
    Math.max(4, 25 + (50 * (lab.value - low)) / (high - low)),
  );
}

const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹";

/** Display only: "10^9/L" and "x10^9/L" read as "×10⁹/L". Data keeps the print. */
export function displayUnit(unit) {
  if (!unit) return unit;
  return unit.replace(
    /^(?:[x×]\s?)?10\^(\d{1,2})\/L$/i,
    (_, power) =>
      `×10${[...power].map((digit) => SUPERSCRIPT[digit]).join("")}/L`,
  );
}

/** "Ferritin 14", as used on evidence chips and key values. */
export function labLabel(lab) {
  return `${lab.short} ${lab.display}`;
}
