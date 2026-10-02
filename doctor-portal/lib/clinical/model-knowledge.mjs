// Preserve clinical content while avoiding repeated bibliography and policy
// tables in paid model input. The complete attributed KB stays on the server.
const withoutBibliography = (value) => {
  if (Array.isArray(value)) return value.map(withoutBibliography);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key, item]) =>
          !["sourceIds", "claimIds"].includes(key) &&
          !(key === "source" && /^https?:\/\//.test(item)),
      )
      .map(([key, item]) => [key, withoutBibliography(item)]),
  );
};
export function compactKnowledge(knowledge) {
  const policies = {},
    policyIds = new Map();
  const records = (rows, kind) =>
    [...rows]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((row) => {
        const record = withoutBibliography(row);
        record.knowledgeId = `${kind}:${row.id}`;
        if (record.baseline_policy) {
          const encoded = JSON.stringify(record.baseline_policy);
          let id = policyIds.get(encoded);
          if (!id) {
            id = `baseline-${policyIds.size + 1}`;
            policyIds.set(encoded, id);
            policies[id] = record.baseline_policy;
          }
          record.baseline_policy = { policyId: id };
        }
        return record;
      });
  const markers = records(knowledge.markers, "marker");
  const screening = records(knowledge.screening, "screening");
  return {
    version: knowledge.version,
    attribution:
      "Claims have record-level attribution, not sentence-level verification. Full bibliography is retained by the application. Clinical content is unchanged; baseline_policy.policyId resolves in baselinePolicies. Claim IDs contain their record ID prefix. All catalogue records are included, not recommendations.",
    governance: knowledge.governance,
    interpretationPolicy: knowledge.interpretationPolicy,
    evidenceScale: knowledge.evidenceScale,
    basisLabels: knowledge.basisLabels,
    rangePolicy: knowledge.rangePolicy,
    unitsPolicy: knowledge.unitsPolicy,
    dispositions: knowledge.dispositions,
    baselinePolicies: policies,
    markers,
    screening,
    claims: [...knowledge.claims]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(({ id, text, evidenceGrade }) => ({ id, text, evidenceGrade })),
    notOffered: withoutBibliography(knowledge.notOffered),
  };
}
