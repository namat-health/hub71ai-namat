import { knowledge } from "./knowledge.mjs";

// Fictional-demo rules, not a clinically approved or autonomous ordering system.
// Deliberately narrower than the source catalogue: prose triggers are not executed.
export const RULES_VERSION = "namat-demo-rules-2026-10-02.1";
const DOMAIN_MARKERS = {
  lipids: [
    "total-cholesterol",
    "ldl-cholesterol",
    "hdl-cholesterol",
    "triglycerides",
    "non-hdl-cholesterol",
    "apob",
    "lipoprotein-a",
  ],
  glucose: ["hba1c", "glucose"],
  "bloodcount-iron": [
    "haemoglobin",
    "haematocrit",
    "mcv",
    "white-cell-count",
    "neutrophils",
    "lymphocytes",
    "platelets",
    "blasts",
    "ferritin",
    "serum-iron",
    "tibc",
    "transferrin-saturation",
    "vitamin-b12",
    "folate",
  ],
  kidney: [
    "creatinine",
    "egfr",
    "cystatin-c",
    "urine-acr",
    "urea",
    "sodium",
    "potassium",
    "chloride",
    "bicarbonate",
  ],
  liver: [
    "alt",
    "ast",
    "alp",
    "ggt",
    "bilirubin",
    "albumin",
    "prothrombin-time",
    "inr",
  ],
  thyroid: ["tsh", "free-t4", "free-t3", "tpo-antibodies"],
};
export const RULE_KNOWLEDGE_IDS = Object.freeze(
  [...new Set(Object.values(DOMAIN_MARKERS).flat())].map(
    (id) => `marker:${id}`,
  ),
);
const registry = new Map(
  knowledge.markers.map((record) => [record.id, record]),
);
const domainFor = (id) =>
  Object.entries(DOMAIN_MARKERS).find(([, ids]) => ids.includes(id))?.[0] ||
  "outside_scope";
const unique = (items) => [...new Set(items.filter(Boolean))];
const unitKey = (unit) =>
  String(unit || "")
    .trim()
    .toLowerCase()
    .replaceAll("μ", "µ")
    .replace(/\s/g, "");
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const effective = (observation) =>
  observation.current || observation.asRecorded || {};
const claimsFor = (id) => {
  const record = registry.get(id);
  return (record?.claimIds || []).filter((claim) =>
    /:(doctor_note_if_outside_range|evidence_note)$/.test(claim),
  );
};
const number = "[-+]?\\d+(?:\\.\\d+)?";
function reading(observation) {
  const raw = effective(observation);
  const match = String(raw.value ?? "")
    .trim()
    .match(new RegExp(`^([<>≤≥])?\\s*(${number})$`));
  const value = match ? Number(match[2]) : null;
  const comparator = match?.[1] || null;
  const unit = raw.unit;
  const sourceReady = Boolean(
    raw.sourceText &&
      Number.isInteger(observation.page) &&
      observation.page > 0,
  );
  const parsedDisagrees =
    finite(observation.parsed?.value) && observation.parsed.value !== value;
  const numberReady =
    finite(value) &&
    Boolean(unit) &&
    !observation.parsed?.unitInferred &&
    !observation.issue &&
    !parsedDisagrees &&
    sourceReady;
  const rangeText = String(raw.referenceRange || "")
    .trim()
    .replace(/[–−]/g, "-");
  const pair = rangeText.match(new RegExp(`^(${number})\\s*-\\s*(${number})$`));
  const single = rangeText.match(new RegExp(`^([<>≤≥])\\s*(${number})$`));
  let low = null,
    high = null,
    strictLow = false,
    strictHigh = false;
  if (pair && Number(pair[1]) <= Number(pair[2])) {
    low = Number(pair[1]);
    high = Number(pair[2]);
  } else if (single) {
    if ([">", "≥"].includes(single[1])) {
      low = Number(single[2]);
      strictLow = single[1] === ">";
    } else {
      high = Number(single[2]);
      strictHigh = single[1] === "<";
    }
  }
  let flag = "unknown";
  if (numberReady && (finite(low) || finite(high))) {
    if (!comparator) {
      flag =
        finite(low) && (strictLow ? value <= low : value < low)
          ? "low"
          : finite(high) && (strictHigh ? value >= high : value > high)
            ? "high"
            : "inside";
    } else if (
      ["<", "≤"].includes(comparator) &&
      finite(low) &&
      (value < low || (value === low && (comparator === "<" || strictLow)))
    )
      flag = "low";
    else if (
      [">", "≥"].includes(comparator) &&
      finite(high) &&
      (value > high || (value === high && (comparator === ">" || strictHigh)))
    )
      flag = "high";
  }
  return { value, comparator, unit, numberReady, sourceReady, flag, low, high };
}

// Only explicit specimen dates control chronology. Old `date` fields are ambiguous.
function collectionTime(observation) {
  const raw = effective(observation);
  const kind = raw.dateKind || observation.dateKind;
  const value =
    raw.collectionDate ||
    (["collection", "collected", "specimen_collection"].includes(kind)
      ? raw.date
      : null);
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value))
    return null;
  const time = Date.parse(value);
  if (
    !Number.isFinite(time) ||
    new Date(time).toISOString().slice(0, 10) !== value.slice(0, 10)
  )
    return null;
  return time;
}
function addMonths(time, months) {
  const date = new Date(time),
    day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.getTime();
}
function meetsThreshold(read, comparator, threshold) {
  if (!finite(read.value) || !finite(threshold)) return false;
  if (!read.comparator)
    return (
      {
        "<": read.value < threshold,
        "<=": read.value <= threshold,
        ">": read.value > threshold,
        ">=": read.value >= threshold,
      }[comparator] === true
    );
  if ([">", "≥"].includes(read.comparator) && [">", ">="].includes(comparator))
    return (
      read.value > threshold ||
      (read.value === threshold &&
        (read.comparator === ">" || comparator === ">="))
    );
  if (["<", "≤"].includes(read.comparator) && ["<", "<="].includes(comparator))
    return (
      read.value < threshold ||
      (read.value === threshold &&
        (read.comparator === "<" || comparator === "<="))
    );
  return false;
}
function criticalFlag(observation) {
  const raw = effective(observation);
  const flag = String(raw.flag || observation.labFlag || "").trim();
  return (
    observation.critical === true ||
    /^(?:HH|LL|critical|panic)$/i.test(flag) ||
    /\b(?:CRITICAL|PANIC|results?\s+(?:was\s+|were\s+)?phoned)\b/i.test(
      String(raw.sourceText || "").replace(/\b(?:not|non)[ -]critical\b/gi, ""),
    )
  );
}

/** Pure, bounded rules for a physician-reviewed fictional case. No network/LLM. */
export function evaluateCase(context, { now = Date.now() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs))
    throw new TypeError("A valid evaluation time is required.");
  const observations = context.observations || [];
  const facts = context.questionnaire?.facts || [];
  const fact = (key) =>
    facts.find((item) => item.kind === "answer" && item.key === key);
  const selected = (key, option) => {
    const item = fact(key);
    return (
      ["reported", "explicitly_reported"].includes(item?.status) &&
      (Array.isArray(item.value)
        ? item.value.includes(option)
        : item.value === option)
    );
  };
  const out = {
    version: RULES_VERSION,
    evaluatedAt: new Date(nowMs).toISOString(),
    nextRecomputeAt: null,
    coverage: [],
    patterns: [],
    candidates: [],
    questions: [],
    limitations: [],
    blockers: [],
  };
  const reads = new Map(observations.map((item) => [item.id, reading(item)]));
  const groups = new Map();
  for (const observation of observations) {
    if (!groups.has(observation.markerId)) groups.set(observation.markerId, []);
    groups.get(observation.markerId).push(observation);
  }
  const question = (id, text, evidenceIds) => {
    if (!out.questions.some((item) => item.id === id))
      out.questions.push({ id, text, evidenceIds: unique(evidenceIds) });
  };
  const limitation = (code, reference, reason) => {
    if (
      !out.limitations.some(
        (item) => item.code === code && item.reference === reference,
      )
    )
      out.limitations.push({ code, reference, reason });
  };
  const block = (code, reference, reason) =>
    out.blockers.push({ code, reference, reason, blocks: "test_proposals" });
  const latest = (id) => {
    const rows = groups.get(id) || [];
    if (rows.length <= 1) return rows[0] || null;
    if (rows.some((row) => collectionTime(row) === null)) return null;
    const sorted = [...rows].sort(
      (a, b) => collectionTime(b) - collectionTime(a),
    );
    const newest = sorted.filter(
      (row) => collectionTime(row) === collectionTime(sorted[0]),
    );
    // Conflicting duplicate readings need review, including different printed units.
    if (
      new Set(
        newest.map((row) =>
          JSON.stringify([
            effective(row).value,
            effective(row).unit,
            effective(row).referenceRange,
          ]),
        ),
      ).size > 1
    )
      return null;
    return sorted[0];
  };
  const current = (id) => {
    const row = latest(id);
    return row && reads.get(row.id)?.numberReady ? row : null;
  };
  const flag = (id) => {
    const row = current(id);
    return row ? reads.get(row.id).flag : "unknown";
  };
  const sameEpisode = (left, right) => {
    const a = collectionTime(left),
      b = collectionTime(right);
    if (a !== null && b !== null)
      return (
        new Date(a).toISOString().slice(0, 10) ===
        new Date(b).toISOString().slice(0, 10)
      );
    return (
      left.reportId === right.reportId &&
      Boolean(left.reportId) &&
      (effective(left).date || null) === (effective(right).date || null)
    );
  };
  const pattern = (
    id,
    title,
    rows,
    markerIds,
    uncertainties = [],
    requiredReview = false,
    evidenceIds = [],
  ) => {
    const rowIds = unique(rows.map((row) => row.id));
    if (!rowIds.length && !evidenceIds.length) return;
    const unknowns = [...uncertainties];
    if (rows.some((row) => row.reviewStatus !== "confirmed"))
      unknowns.push(
        "Source-backed extraction is still a draft for the reviewing doctor to verify.",
      );
    if (rows.some((row) => collectionTime(row) === null))
      unknowns.push(
        "Specimen collection date is not verified; current persistence and trends are not established.",
      );
    out.patterns.push({
      id: `pattern:${id}`,
      title,
      evidenceIds: unique([...rowIds, ...evidenceIds]),
      claimIds: unique(markerIds.flatMap(claimsFor)),
      knowledgeIds: unique(markerIds.map((key) => `marker:${key}`)),
      observationIds: rowIds,
      uncertainties: unique(unknowns),
      requiredReview,
    });
  };
  const reports = context.reports || [];
  const coverageComplete =
    context.reportCoverageComplete === true ||
    (reports.length > 0 &&
      reports.every(
        (report) =>
          report.coverageStatus === "complete" ||
          report.coverage?.complete === true ||
          report.inventoryComplete === true,
      ));
  if (reports.length && !coverageComplete)
    limitation(
      "report_coverage_unverified",
      "reports",
      "A missing parsed marker is not proof it was never tested; verify the complete report inventory before proposing a new test.",
    );
  if (!reports.length)
    limitation(
      "no_uploaded_reports",
      "reports",
      "Questionnaire-only assessment; prior testing must be established before new tests are selected.",
    );
  const adult =
    Number.isInteger(context.questionnaire?.exactAge) &&
    context.questionnaire.exactAge >= 18;
  if (!adult)
    limitation(
      "adult_eligibility_unconfirmed",
      "answer:age",
      "These demonstration patterns are for adults; confirm exact age before test proposals.",
    );
  if (selected("pregnancy", "yes") || selected("treatment", "yes"))
    block(
      "outside_demo_population",
      "questionnaire",
      "Pregnancy or active serious treatment needs an individual clinician assessment outside these demonstration actions.",
    );

  for (const observation of observations) {
    const read = reads.get(observation.id),
      domain = domainFor(observation.markerId);
    let status =
      domain === "outside_scope"
        ? "outside_scope"
        : read.numberReady && read.flag !== "unknown"
          ? "reviewed"
          : "limited";
    let reason =
      domain === "outside_scope"
        ? "Preserved for the doctor; outside the six evaluated demonstration domains."
        : !read.numberReady
          ? "Value, unit, source location or extraction needs verification; not used for test eligibility."
          : read.flag === "unknown"
            ? "Printed range or a bounded result does not establish an inside/outside comparison."
            : "Compared only with the printed reference interval; this is not a diagnosis or an all-clear.";
    const marker = registry.get(observation.markerId);
    const urgent = (marker?.urgent_bands || []).some((band) =>
      (band.thresholds || []).some((threshold) => {
        if (!read.numberReady) return false;
        if (threshold.multiple_of_upper_limit)
          return (
            finite(read.high) &&
            meetsThreshold(
              read,
              threshold.comparator,
              threshold.multiple_of_upper_limit * read.high,
            )
          );
        return (
          unitKey(threshold.unit) === unitKey(read.unit) &&
          meetsThreshold(read, threshold.comparator, threshold.value)
        );
      }),
    );
    if (criticalFlag(observation) || urgent) {
      status = "blocked";
      reason =
        "A printed critical flag or explicit draft-KB alert band requires clinician verification. Collection date and current condition determine the response.";
      block(
        criticalFlag(observation) ? "lab_critical_flag" : "draft_kb_alert_band",
        observation.id,
        reason,
      );
    }
    if (
      collectionTime(observation) !== null &&
      collectionTime(observation) > nowMs
    ) {
      status = "blocked";
      reason = "Specimen date is in the future and requires correction.";
      block("future_collection_date", observation.id, reason);
    }
    if (
      (groups.get(observation.markerId)?.length || 0) > 1 &&
      !latest(observation.markerId)
    ) {
      status = status === "blocked" ? status : "limited";
      limitation(
        "ambiguous_latest_result",
        observation.markerId,
        "Conflicting or undated duplicate results prevent selecting the current result.",
      );
      question(
        `resolve-${observation.markerId}`,
        `Which ${observation.name} result and collection date should be used for this assessment?`,
        groups.get(observation.markerId).map((row) => row.id),
      );
    }
    out.coverage.push({
      observationId: observation.id,
      domain,
      status,
      reason,
    });
  }

  const alertRows = observations.filter((row) =>
    out.blockers.some(
      (item) =>
        item.reference === row.id &&
        ["lab_critical_flag", "draft_kb_alert_band"].includes(item.code),
    ),
  );
  if (alertRows.length)
    pattern(
      "verify-laboratory-alerts",
      "Verify laboratory alerts before routine test proposals",
      alertRows,
      alertRows.map((row) => row.markerId).filter((id) => registry.has(id)),
      [
        "Historical reports do not establish the patient's current clinical condition.",
      ],
      true,
    );

  function candidate(
    markerId,
    evidenceIds,
    reason,
    {
      requiredReview = false,
      allowRepeat = false,
      fastingRequired = false,
      claimMarkers = [markerId],
    } = {},
  ) {
    const marker = registry.get(markerId);
    if (!marker) return;
    const present = groups.get(markerId) || [],
      result = latest(markerId);
    let decisions = ["propose", "defer", "not_indicated"];
    const refs = unique([...evidenceIds, ...present.map((row) => row.id)]);
    let explanation = reason;
    if (present.length) {
      const usable = result && reads.get(result.id).numberReady;
      const date = result && collectionTime(result);
      const months = marker.reuse_window_months;
      const expiry =
        usable && date !== null && Number.isFinite(months)
          ? addMonths(date, months)
          : null;
      if (
        expiry !== null &&
        expiry > nowMs &&
        (!out.nextRecomputeAt || expiry < Date.parse(out.nextRecomputeAt))
      )
        out.nextRecomputeAt = new Date(expiry).toISOString();
      if (!usable) {
        decisions = ["defer"];
        explanation +=
          " An existing reading is ambiguous; verify it before ordering or reusing.";
      } else if (marker.frequency === "once_in_lifetime") {
        decisions = ["already_available", "defer"];
        explanation +=
          " A readable existing result is documented; this rule does not propose routine repetition.";
      } else if (date === null || date > nowMs) {
        decisions = ["defer"];
        explanation +=
          " The existing result's specimen date is not verified; reuse/repeat timing is undecided.";
      } else if (
        fastingRequired &&
        !["fasting", "yes", true].includes(effective(result).fastingStatus)
      ) {
        decisions = ["defer"];
        explanation +=
          " An existing glucose value is present, but specimen fasting status needs confirmation.";
      } else if (
        reads.get(result.id).flag === "inside" &&
        expiry !== null &&
        expiry > nowMs
      ) {
        decisions = ["already_available", "defer"];
        explanation +=
          " An in-window result is already available; its clinical adequacy remains the doctor's decision.";
      } else if (reads.get(result.id).flag !== "inside" && !allowRepeat) {
        decisions = ["defer"];
        explanation +=
          " An existing result needs contextual review rather than an automatic duplicate test.";
      } else {
        explanation +=
          " Consider a clinician-directed repeat; the doctor determines timing.";
      }
    } else if (!coverageComplete) {
      decisions = ["defer"];
      explanation +=
        " First establish whether a usable result exists in complete reports or other records.";
      question(
        `prior-${markerId}`,
        `Is there already a usable ${marker.name} result, including testing outside these uploads?`,
        evidenceIds,
      );
    }
    if (decisions.includes("propose") && !coverageComplete)
      decisions = ["defer"];
    if (!adult || out.blockers.length) decisions = ["defer"];
    const item = {
      id: `test:${markerId}`,
      knowledgeId: `marker:${markerId}`,
      evidenceIds: refs,
      claimIds: unique(claimMarkers.flatMap(claimsFor)),
      allowedDecisions: decisions,
      requiredReview,
      reason: explanation,
    };
    const previous = out.candidates.find((entry) => entry.id === item.id);
    if (previous) {
      previous.evidenceIds = unique([...previous.evidenceIds, ...refs]);
      previous.claimIds = unique([...previous.claimIds, ...item.claimIds]);
      previous.requiredReview ||= requiredReview;
      // Different indications cannot broaden an earlier hold or bypass reuse.
      previous.allowedDecisions = previous.allowedDecisions.filter((decision) =>
        decisions.includes(decision),
      );
      if (!previous.allowedDecisions.length)
        previous.allowedDecisions = ["defer"];
      previous.reason += ` ${reason}`;
    } else out.candidates.push(item);
  }

  // General domain summaries preserve ordinary and out-of-range observations.
  // They authorize no disease label and never imply all unobserved tests were normal.
  for (const [domain, ids] of Object.entries(DOMAIN_MARKERS)) {
    const rows = ids.map(current).filter(Boolean);
    if (rows.length)
      pattern(
        `domain-${domain}`,
        `${domain === "bloodcount-iron" ? "Blood count and iron" : domain.charAt(0).toUpperCase() + domain.slice(1)} results in context`,
        rows,
        rows.map((row) => row.markerId),
        [
          "Printed reference intervals describe these observations; screening eligibility and diagnoses are separate decisions.",
        ],
        rows.some((row) => ["low", "high"].includes(reads.get(row.id).flag)),
      );
  }

  const hb = current("haemoglobin"),
    mcv = current("mcv"),
    ferritin = current("ferritin"),
    a1c = current("hba1c");
  const lowIronSignals = [
    flag("haemoglobin") === "low" ? hb : null,
    flag("mcv") === "low" ? mcv : null,
  ].filter(Boolean);
  const fatigue = selected("symptoms", "energy") || selected("energy", "low");
  if (lowIronSignals.length || fatigue) {
    const answerIds = [
      selected("symptoms", "energy") ? fact("symptoms")?.id : null,
      selected("energy", "low") ? fact("energy")?.id : null,
    ].filter(Boolean);
    pattern(
      "iron-assessment",
      "Assess the blood-count pattern and possible iron-related explanation",
      lowIronSignals,
      ["haemoglobin", "ferritin"],
      [
        "Bleeding, diet and medicine context is not inferred from cycle changes, sex or age.",
        "This pattern does not establish iron deficiency.",
      ],
      lowIronSignals.length > 0,
      answerIds,
    );
    candidate(
      "ferritin",
      [...lowIronSignals.map((row) => row.id), ...answerIds],
      "Low haemoglobin, small red-cell indices or explicitly reported fatigue supports clinician consideration of iron-store assessment.",
      { claimMarkers: ["ferritin", "haemoglobin"] },
    );
    question(
      "iron-context",
      "Is there relevant bleeding, dietary restriction, recent blood donation or iron use, and when did the symptoms begin?",
      [...lowIronSignals.map((row) => row.id), ...answerIds],
    );
  }
  if (flag("haemoglobin") === "high")
    pattern(
      "high-haemoglobin",
      "Raised haemoglobin needs a different review from low haemoglobin",
      [hb],
      ["haemoglobin"],
      [
        "Hydration, smoking, altitude and testosterone use are possible context to establish; none is assumed.",
      ],
      true,
    );
  if (flag("mcv") === "high") {
    pattern(
      "macrocytic-context",
      "Review a raised red-cell volume with nutrient and other context",
      [mcv],
      ["vitamin-b12", "folate"],
      ["Raised MCV alone does not establish a vitamin deficiency."],
      true,
    );
    for (const id of ["vitamin-b12", "folate"])
      candidate(
        id,
        [mcv.id],
        "MCV above its printed range supports targeted clinician consideration of B12 and folate assessment.",
        { claimMarkers: ["vitamin-b12", "folate"] },
      );
  }
  const redCellSignals = [hb, mcv, ferritin].filter(
    (row) =>
      row &&
      (row.markerId === "ferritin"
        ? reads.get(row.id).flag === "low"
        : ["low", "high"].includes(reads.get(row.id).flag)),
  );
  if (a1c && redCellSignals.length) {
    const paired = redCellSignals.filter((row) => sameEpisode(a1c, row));
    if (paired.length) {
      pattern(
        "hba1c-reliability",
        "Review HbA1c reliability alongside red-cell findings",
        [a1c, ...paired],
        ["hba1c", "glucose"],
        [
          "The direction or size of any HbA1c effect is not calculated.",
          "Confirm specimen context and laboratory method before choosing a glucose-based assessment.",
        ],
        true,
      );
      candidate(
        "glucose",
        [a1c.id, ...paired.map((row) => row.id)],
        "The reviewed HbA1c reliability rule supports consideration of a glucose-based assessment; an existing result and fasting status must be checked.",
        { fastingRequired: true, claimMarkers: ["hba1c", "glucose"] },
      );
    } else
      question(
        "hba1c-chronology",
        "Were the red-cell findings present when the HbA1c sample was collected?",
        [a1c.id, ...redCellSignals.map((row) => row.id)],
      );
  }
  if (a1c && flag("hba1c") === "high")
    candidate(
      "hba1c",
      [a1c.id],
      "HbA1c above its printed range needs clinician review and possible confirmation; this does not establish a diagnosis.",
      { allowRepeat: true },
    );
  const glucose = current("glucose");
  if (glucose)
    question(
      "glucose-fasting",
      "Was this glucose specimen fasting, and was there an acute illness or processing issue around the draw?",
      [glucose.id],
    );

  const familyHeart =
    selected("family", "heart") ||
    selected("family", "stroke") ||
    selected("family", "early");
  if (familyHeart || selected("history", "cholesterol")) {
    const ids = [
      familyHeart ? fact("family")?.id : null,
      selected("history", "cholesterol") ? fact("history")?.id : null,
    ].filter(Boolean);
    pattern(
      "lipid-risk-context",
      "Use reported family and cholesterol history in lipid review",
      [],
      ["ldl-cholesterol", "lipoprotein-a"],
      [
        "A family-history category does not establish the relative, diagnosis or age at an event.",
      ],
      false,
      ids,
    );
    candidate(
      "lipoprotein-a",
      ids,
      "The source KB supports once-in-adulthood Lp(a) assessment; reported family or cholesterol history makes previous measurement worth checking.",
    );
    if (familyHeart)
      question(
        "family-heart-detail",
        "Which relative had which cardiovascular event, and approximately how old were they?",
        ids,
      );
  }
  if (selected("history", "cholesterol") || selected("history", "blood-sugar"))
    candidate(
      "apob",
      [fact("history").id],
      "Reported cholesterol or blood-sugar history supports selective clinician consideration of ApoB; it is not a default advanced panel.",
    );

  const kidneySignals = [
    flag("creatinine") === "high" ? current("creatinine") : null,
    flag("egfr") === "low" ? current("egfr") : null,
  ].filter(Boolean);
  if (kidneySignals.length) {
    pattern(
      "kidney-context",
      "Review kidney markers with specimen and muscle context",
      kidneySignals,
      ["creatinine", "egfr", "urine-acr"],
      [
        "A single result does not establish chronic kidney disease.",
        "Muscle mass, creatine use, hydration and medicines are context to ask about, not facts inferred from lifestyle goals.",
      ],
      true,
    );
    candidate(
      "urine-acr",
      kidneySignals.map((row) => row.id),
      "The source kidney-assessment notes support considering urine ACR alongside an unexpected creatinine/eGFR result.",
      { claimMarkers: ["creatinine", "urine-acr"] },
    );
    question(
      "kidney-context",
      "What were the hydration, recent exercise, creatine/protein intake and medicines around this sample, and is a previous kidney result available?",
      kidneySignals.map((row) => row.id),
    );
  }

  const liverSignals = ["alt", "ast", "alp", "ggt", "bilirubin"]
    .map(current)
    .filter((row) => row && reads.get(row.id).flag === "high");
  if (liverSignals.length) {
    pattern(
      "liver-context",
      "Review liver findings with timing and potential confounders",
      liverSignals,
      liverSignals.map((row) => row.markerId),
      [
        "An enzyme elevation alone does not establish fatty liver or its cause.",
        "Exercise, illness, alcohol and medicine exposure at the draw need verification.",
      ],
      true,
    );
    question(
      "liver-context",
      "Were there recent illness, strenuous exercise, alcohol or medicine/supplement changes, and have these liver findings persisted on dated samples?",
      liverSignals.map((row) => row.id),
    );
    for (const row of liverSignals.filter((item) =>
      ["alt", "ast"].includes(item.markerId),
    ))
      candidate(
        row.markerId,
        [row.id],
        "An elevated aminotransferase supports a clinician-directed confirmation decision after checking sample context and previous results.",
        { allowRepeat: true },
      );
  }

  const tsh = current("tsh"),
    ft4 = current("free-t4");
  if (tsh && ["low", "high"].includes(flag("tsh"))) {
    const paired = ft4 && sameEpisode(tsh, ft4) ? [tsh, ft4] : [tsh];
    pattern(
      "thyroid-pair",
      "Interpret TSH with related thyroid results and clinical context",
      paired,
      ["tsh", "free-t4", ...(flag("tsh") === "low" ? ["free-t3"] : [])],
      [
        "Symptoms, acute illness, biotin and other medicines can change interpretation; their presence is not inferred.",
      ],
      true,
    );
    candidate(
      "free-t4",
      [tsh.id],
      "TSH outside its printed range supports free T4 assessment when an appropriate existing result is unavailable.",
      { claimMarkers: ["tsh", "free-t4"] },
    );
    if (flag("tsh") === "low")
      candidate(
        "free-t3",
        [tsh.id],
        "The source thyroid pathway includes free T3 when TSH is below its printed range; this is not routine hormone screening.",
        { claimMarkers: ["tsh", "free-t3"] },
      );
    question(
      "thyroid-context",
      "What symptoms, acute illness, biotin or thyroid-related medicines were present at the draw, and are paired thyroid results available?",
      paired.map((row) => row.id),
    );
  }
  if (ft4 && flag("free-t4") === "low")
    pattern(
      "low-free-t4-review",
      "Low free T4 needs clinician review with TSH",
      [ft4, ...(tsh && sameEpisode(ft4, tsh) ? [tsh] : [])],
      ["tsh", "free-t4"],
      [
        "Timing and clinical assessment are needed; no automatic treatment or waiting interval is assigned.",
      ],
      true,
    );
  return out;
}
