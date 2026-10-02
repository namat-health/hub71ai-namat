// Browser-safe reference resolution. A click can navigate only to evidence
// carried by the current saved analysis, never to a model-supplied URL.
export function evidenceLink(analysis, reference) {
  const evidence = analysis?.evidence;
  if (!evidence) return null;
  const id = typeof reference === "string" ? reference : null;
  const observation = (evidence.observations || []).find(
    (item) =>
      (id && item.id === id) ||
      (reference?.type === "lab" && item.uiLabId === reference.labId),
  );
  if (observation) {
    const current = observation.current || observation.asRecorded || {};
    return {
      id: observation.id,
      type: "lab",
      labId: observation.uiLabId,
      reportId: observation.reportId,
      page: observation.page,
      bbox: observation.bounds || null,
      label: [observation.name || "Report result", current.value, current.unit]
        .filter(
          (value) => value !== null && value !== undefined && value !== "",
        )
        .join(" "),
    };
  }
  const citation = (evidence.reportEvidence || []).find(
    (item) => id && item.id === id,
  );
  if (citation) {
    return {
      id: citation.id,
      type: "report",
      reportId: citation.reportId,
      page: citation.page,
      bbox: null,
      label: `Report page ${citation.page}`,
      quote: citation.quote,
      verification: citation.verification,
    };
  }
  const page = (evidence.reportPages || []).find(
    (item) =>
      (id && item.id === id) ||
      (reference?.type === "report" &&
        item.reportId === reference.reportId &&
        item.page === reference.page),
  );
  if (page) {
    return {
      id: page.id,
      type: "report",
      reportId: page.reportId,
      page: page.page,
      bbox: null,
      label:
        reference?.type === "report" && reference.label
          ? reference.label
          : `Report page ${page.page}`,
    };
  }
  const fact = (evidence.facts || []).find(
    (item) =>
      (id && item.id === id) ||
      (reference?.type === "questionnaire" && item.key === reference.key),
  );
  return fact
    ? {
        id: fact.id,
        type: "questionnaire",
        key: fact.key,
        label:
          reference?.type === "questionnaire" && reference.label
            ? reference.label
            : fact.text || String(fact.key).replaceAll("_", " "),
      }
    : null;
}
