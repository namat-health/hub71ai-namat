import assert from "node:assert/strict";
import test from "node:test";
import { knowledge } from "../lib/clinical/knowledge.mjs";
import { compactKnowledge } from "../lib/clinical/model-knowledge.mjs";

test("compact input preserves every claim and clinical record field, including exclusions and unresolved governance", () => {
  const compact = compactKnowledge(knowledge);
  assert.equal(compact.claims.length, knowledge.claims.length);
  for (const claim of knowledge.claims)
    assert.deepEqual(
      compact.claims.find((row) => row.id === claim.id),
      {
        id: claim.id,
        text: claim.text,
        evidenceGrade: claim.evidenceGrade,
      },
    );
  assert.deepEqual(compact.governance, knowledge.governance);
  for (const kind of ["markers", "screening"]) {
    assert.equal(compact[kind].length, knowledge[kind].length);
    for (const original of knowledge[kind]) {
      const restored = structuredClone(
        compact[kind].find((row) => row.id === original.id),
      );
      assert.equal(
        restored.knowledgeId,
        `${kind === "markers" ? "marker" : "screening"}:${original.id}`,
      );
      delete restored.knowledgeId;
      if (original.baseline_policy)
        restored.baseline_policy =
          compact.baselinePolicies[restored.baseline_policy.policyId];
      // Only bibliography links/IDs move to the server. No clinical text, scope,
      // consent, reuse, urgent bands or demographic policies may disappear.
      const expected = JSON.parse(
        JSON.stringify(original, (key, value) =>
          ["sourceIds", "claimIds"].includes(key) ||
          (key === "source" && /^https?:\/\//.test(value))
            ? undefined
            : value,
        ),
      );
      assert.deepEqual(restored, expected, original.id);
    }
  }
  assert.ok(
    JSON.stringify(compact).length < JSON.stringify(knowledge).length * 0.65,
  );
});

test("shared knowledge is stable across retrieval order for prompt caching", () => {
  const reordered = structuredClone(knowledge);
  for (const kind of ["markers", "screening", "claims"])
    reordered[kind].reverse();
  assert.equal(
    JSON.stringify(compactKnowledge(knowledge)),
    JSON.stringify(compactKnowledge(reordered)),
  );
});
