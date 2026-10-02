import assert from "node:assert/strict";
import test from "node:test";
import {
  createOpenAIProvider,
  MAX_INPUT_TOKENS,
  reservationForTokens,
  usageMicros,
} from "../lib/clinical/openai-provider.mjs";
import { config } from "./fixtures/interpreter.mjs";

const reports = [
  {
    reportId: "fictional-pdf",
    filename: "report-1.pdf",
    mime: "application/pdf",
    bytes: Buffer.from("fictional-pdf-bytes"),
    pageCount: 2,
    sha256: "a".repeat(64),
  },
  {
    reportId: "fictional-scan",
    filename: "report-2.png",
    mime: "image/png",
    bytes: Buffer.from("fictional-image-bytes"),
    pageCount: 1,
    sha256: "b".repeat(64),
  },
];
function harness(tokens = 85000) {
  const calls = [],
    counts = [];
  const provider = createOpenAIProvider(
    { NAMAT_ANALYSIS_ENABLED: "true", OPENAI_API_KEY: "fixture-not-a-key" },
    {
      responses: {
        inputTokens: {
          async count(body) {
            counts.push(body);
            return { input_tokens: tokens };
          },
        },
        async create(body) {
          calls.push(body);
          return {
            status: "completed",
            output_text: '{"fixture":true}',
            usage: { input_tokens: tokens, output_tokens: 500 },
            model: config.model,
            id: "fictional-response",
          };
        },
      },
    },
  );
  return { provider, calls, counts };
}
test("token count and inference use identical PDF/image inputs and structured schema", async () => {
  const h = harness();
  const amount = await h.provider.estimate("fictional case", reports);
  await h.provider.synthesize("fictional case", reports);
  assert.deepEqual(h.counts[0].input, h.calls[0].input);
  assert.deepEqual(h.counts[0].text, h.calls[0].text);
  assert.equal(amount, reservationForTokens(86024, config));
  const content = h.calls[0].input[0].content;
  assert.equal(content.filter((c) => c.type === "input_file").length, 1);
  assert.equal(content.filter((c) => c.type === "input_image").length, 1);
  assert.match(
    content.find((c) => c.type === "input_file").file_data,
    /^data:application\/pdf;base64,/,
  );
  assert.equal(h.calls[0].store, false);
  assert.equal(h.calls[0].service_tier, "default");
  assert.equal(h.calls[0].tools, undefined);
  assert.doesNotMatch(JSON.stringify(h.calls), /fixture-not-a-key/);
  await h.provider.estimate("fictional verification", reports, true);
  await h.provider.verify("fictional verification", reports);
  assert.deepEqual(h.counts[1].input, h.calls[1].input);
  assert.deepEqual(h.counts[1].text, h.calls[1].text);
  assert.equal(h.calls[1].max_output_tokens, 2000);
});
test("oversized or invalid multimodal counts stop before paid inference", async () => {
  for (const tokens of [MAX_INPUT_TOKENS, NaN, -1025, Infinity]) {
    const h = harness(tokens);
    await assert.rejects(() => h.provider.estimate("fictional", reports), {
      code: "analysis_too_large",
    });
    assert.equal(h.calls.length, 0);
  }
});
test("actual usage accounts for cached tokens and the long-context pricing tier", () => {
  assert.equal(
    usageMicros(
      {
        input_tokens: 77708,
        output_tokens: 2666,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 77705 },
      },
      config,
    ),
    220929,
  );
  assert.equal(
    usageMicros(
      {
        input_tokens: 100,
        output_tokens: 1,
        input_tokens_details: { cached_tokens: 60, cache_write_tokens: 50 },
      },
      config,
    ),
    null,
  );
  assert.ok(
    reservationForTokens(77708, config) >=
      usageMicros(
        {
          input_tokens: 77708,
          output_tokens: config.maxOutputTokens,
          input_tokens_details: { cache_write_tokens: 77708 },
        },
        config,
      ),
  );
  assert.equal(
    usageMicros(
      {
        input_tokens: 300000,
        output_tokens: 1000,
        input_tokens_details: { cached_tokens: 100000 },
      },
      config,
    ),
    835000,
  );
  assert.equal(
    usageMicros(
      {
        input_tokens: 10,
        output_tokens: 1,
        input_tokens_details: { cached_tokens: 11 },
      },
      config,
    ),
    null,
  );
  assert.throws(() => reservationForTokens(MAX_INPUT_TOKENS + 1, config), {
    code: "analysis_too_large",
  });
});
