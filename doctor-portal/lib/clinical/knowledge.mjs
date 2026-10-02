import knowledge from "./knowledge-base.json" with { type: "json" };
export { knowledge };
const canonical = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const markerNames = new Map();
for (const marker of knowledge.markers)
  for (const name of [marker.id, marker.name, ...marker.aliases]) {
    const key = canonical(name);
    markerNames.set(
      key,
      markerNames.has(key) && markerNames.get(key) !== marker.id
        ? null
        : marker.id,
    );
  }
export const markerId = (name) => markerNames.get(canonical(name)) || null;
export const recordId = (kind, id) => `${kind}:${id}`;

// Reference retrieval only. A matching record is not an indication to order a test.
export function selectKnowledge({ facts, observations, version }) {
  const answers = Object.fromEntries(
    facts.filter((f) => f.kind === "answer").map((f) => [f.key, f.value]),
  );
  const selected = (key, value) =>
    Array.isArray(answers[key])
      ? answers[key].includes(value)
      : answers[key] === value;
  const mappings = knowledge.questionnaireMap
    .filter((row) => {
      // v2 merged the motivation screen into goals. New context fields have no inherited rule.
      const key =
        version === "namat-hackathon-welcome-v2" &&
        row.question === "motivation"
          ? "goals"
          : row.question;
      return selected(key, row.option);
    })
    .map((row) => ({
      ...row,
      id: `questionnaire:${row.question}:${row.option}`,
    }));
  const markerIds = new Set(
    observations.map((o) => o.markerId).filter(Boolean),
  );
  const bundleIds = new Set(["hlmcs-baseline-bloods"]);
  const screeningIds = new Set();
  const add = (id) => {
    if (knowledge.bundles.some((item) => item.id === id)) bundleIds.add(id);
    if (knowledge.markers.some((item) => item.id === id)) markerIds.add(id);
    if (knowledge.screening.some((item) => item.id === id))
      screeningIds.add(id);
  };
  for (const row of mappings)
    for (const id of [...(row.proposes || []), ...(row.considers || [])])
      add(id);
  const bundles = knowledge.bundles.filter((item) => bundleIds.has(item.id));
  for (const bundle of bundles)
    if (bundle.id !== "hlmcs-baseline-bloods")
      for (const id of bundle.markers || []) markerIds.add(id);
  const markers = knowledge.markers.filter((item) => markerIds.has(item.id));
  const screening = knowledge.screening.filter((item) =>
    screeningIds.has(item.id),
  );
  const claimIds = new Set(
    [...markers, ...screening].flatMap((item) => item.claimIds),
  );
  const claims = knowledge.claims.filter((item) => claimIds.has(item.id));
  const sourceIds = new Set(
    [...markers, ...screening].flatMap((item) => item.sourceIds),
  );
  return {
    version: knowledge.version,
    sourceSha256: knowledge.sourceSha256,
    governance: knowledge.governance,
    interpretationPolicy: knowledge.interpretationPolicy,
    evidenceScale: knowledge.evidenceScale,
    basisLabels: knowledge.basisLabels,
    rangePolicy: knowledge.rangePolicy,
    unitsPolicy: knowledge.unitsPolicy,
    dispositions: knowledge.dispositions,
    markers,
    screening,
    bundles,
    questionnaireMap: mappings,
    claims,
    sources: knowledge.sources.filter((item) => sourceIds.has(item.id)),
    // Available records are an index, not a list of missing or recommended tests.
    catalogue: [
      ...knowledge.markers.map((item) => ({
        id: recordId("marker", item.id),
        name: item.name,
        detailIncluded: markerIds.has(item.id),
      })),
      ...knowledge.screening.map((item) => ({
        id: recordId("screening", item.id),
        name: item.name,
        detailIncluded: screeningIds.has(item.id),
      })),
    ],
    notOffered: knowledge.notOffered,
    retrievalNote:
      "Selected records preserve source rules and exclusions. Catalogue entries with detailIncluded=false require getKnowledgeRecords before a clinical recommendation. Demographic eligibility, symptom interpretation, consent and clinical decisions have not been evaluated.",
  };
}

// Server-only, bounded catalogue lookup for tomorrow's interpreter. No network or clinical decisions.
export function getKnowledgeRecords(ids) {
  if (
    !Array.isArray(ids) ||
    ids.length > 20 ||
    ids.some((id) => typeof id !== "string")
  )
    throw new Error("Choose up to 20 knowledge record IDs.");
  const records = ids.map((id) => {
    const [kind, key] = id.split(":");
    const rows = {
      marker: knowledge.markers,
      screening: knowledge.screening,
      bundle: knowledge.bundles,
    }[kind];
    const record = rows?.find((row) => row.id === key);
    if (!record || `${kind}:${key}` !== id)
      throw new Error("Unknown knowledge record.");
    return { id, record };
  });
  const claimIds = new Set(
    records.flatMap((item) => item.record.claimIds || []),
  );
  const sourceIds = new Set(
    records.flatMap((item) => item.record.sourceIds || []),
  );
  return {
    version: knowledge.version,
    records,
    claims: knowledge.claims.filter((item) => claimIds.has(item.id)),
    sources: knowledge.sources.filter((item) => sourceIds.has(item.id)),
  };
}
