import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import {
  loadReportInputs,
  MAX_REPORT_INPUT_BYTES,
} from "../lib/clinical/report-inputs.mjs";
import { planResponse, savedPlanResponse } from "../lib/portal-backend.mjs";
import { SHARED_API_ORIGIN } from "../lib/shared-api.mjs";
import { report, submission } from "./fixtures/clinical-case.mjs";

const serviceKey = "fictional-source-service-key-0123456789";
const owner = "11111111-1111-4111-8111-111111111111";
const tenant = "33333333-3333-4333-8333-333333333333";
const host = "doctor-test.azurewebsites.net";
const env = {
  NAMAT_SHARED_API_ENABLED: "true",
  NAMAT_SHARED_API_ORIGIN: SHARED_API_ORIGIN,
  NAMAT_SHARED_API_PORTAL_TOKEN: serviceKey,
  NAMAT_PORTAL_AUTH_MODE: "azure-easy-auth",
  NAMAT_PORTAL_TENANT_ID: tenant,
  NAMAT_PORTAL_ALLOWED_USER_IDS: owner,
  WEBSITE_SITE_NAME: "doctor-test",
  WEBSITE_HOSTNAME: host,
  WEBSITE_INSTANCE_ID: "fictional-instance-id",
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function pdf(pages = 1) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(" ")}] /Count ${pages} >>`,
    ...Array.from(
      { length: pages },
      () => "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
    ),
  ];
  let content = "%PDF-1.7\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(content));
    content += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(content);
  content += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  content += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  content += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(content);
}
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY4cAAAAASUVORK5CYII=",
  "base64",
);
function fixture(
  files = [{ mime: "application/pdf", bytes: pdf(2), pages: 2 }],
) {
  const fetches = [];
  const attachedReports = files.map((file, index) => {
    const id = index === 0 ? report.report.id : randomUUID();
    return {
      id,
      name: "PRIVATE PATIENT NAME - do not send.pdf",
      mime: file.mime,
      size: file.bytes.length,
      status: "ready",
      sourceUrl: `/api/submissions/${submission.id}/reports/${id}/source`,
    };
  });
  const reports = attachedReports.map((attachment, index) => ({
    report: {
      id: attachment.id,
      status: "ready",
      pageCount: files[index].pages,
    },
    extraction: { inputSha256: hash(files[index].bytes) },
  }));
  const input = { submissionId: submission.id, attachedReports, reports };
  const options = {
    env,
    async fetchImpl(url, init) {
      fetches.push({ url, init });
      const index = attachedReports.findIndex(
        (item) =>
          url ===
          `${SHARED_API_ORIGIN}/v1/demo/submissions/${submission.id}/reports/${item.id}`,
      );
      assert.notEqual(index, -1, "No external or sourceUrl fetches");
      const file = files[index];
      return new Response(file.bytes, {
        headers: {
          "Content-Type": file.mime,
          "Content-Length": String(file.bytes.length),
          "X-Namat-Content-Sha256": hash(file.bytes),
          "Content-Disposition": 'inline; filename="PRIVATE NAME.pdf"',
        },
      });
    },
  };
  return { input, options, fetches };
}
const hasCode = (code) => (error) => error.code === code;

test("original PDFs and images retain every byte with anonymous names and fixed authenticated source routes", async () => {
  const files = [
    { mime: "application/pdf", bytes: pdf(2), pages: 2 },
    { mime: "image/png", bytes: png, pages: 1 },
  ];
  const h = fixture(files);
  const inputs = await loadReportInputs(h.input, h.options);
  assert.equal(inputs.length, 2);
  for (const [index, input] of inputs.entries()) {
    assert.deepEqual(Object.keys(input), [
      "reportId",
      "filename",
      "mime",
      "bytes",
      "pageCount",
      "sha256",
    ]);
    assert.deepEqual(input.bytes, files[index].bytes);
    assert.equal(input.sha256, hash(files[index].bytes));
    assert.equal(input.pageCount, files[index].pages);
    const { bytes: _bytes, ...metadata } = input;
    assert.ok(!JSON.stringify(metadata).includes("PRIVATE"));
    const request = h.fetches[index];
    assert.equal(request.init.headers["X-Namat-Service-Key"], serviceKey);
    assert.equal(request.init.redirect, "error");
    assert.equal(request.init.credentials, "omit");
    assert.equal(request.init.headers.Cookie, undefined);
  }
  assert.deepEqual(
    inputs.map((input) => input.filename),
    ["report-1.pdf", "report-2.png"],
  );
});

test("failed text extraction can use complete originals and count PDF pages independently", async () => {
  const h = fixture();
  h.input.attachedReports[0].status = "failed";
  h.input.reports[0].report.status = "failed";
  h.input.reports[0].report.pageCount = null;
  h.input.reports[0].extraction = null;
  const [input] = await loadReportInputs(h.input, h.options);
  assert.equal(input.pageCount, 2);
  assert.equal(input.sha256, hash(input.bytes));
});

test("missing, duplicate, mismatched, unavailable and external attachment references fail before download", async () => {
  const changes = [
    (h) => {
      h.input.reports = [];
    },
    (h) => {
      h.input.attachedReports.push(h.input.attachedReports[0]);
    },
    (h) => {
      h.input.reports[0].report.id = randomUUID();
    },
    (h) => {
      h.input.reports.push(h.input.reports[0]);
    },
    (h) => {
      h.input.attachedReports[0].sourceUrl = "https://external.invalid/report";
    },
    (h) => {
      h.input.attachedReports[0].sourceUrl = null;
    },
    (h) => {
      h.input.attachedReports[0].status = "uploading";
    },
    (h) => {
      h.input.reports[0].extraction.inputSha256 = "bad";
    },
  ];
  for (const change of changes) {
    const h = fixture();
    change(h);
    await assert.rejects(
      loadReportInputs(h.input, h.options),
      hasCode("case_not_ready"),
    );
    assert.equal(h.fetches.length, 0);
  }
});

test("mismatched content hashes, attachment metadata and recorded page count cannot mix evidence revisions", async () => {
  for (const change of [
    (h) => {
      h.input.reports[0].extraction.inputSha256 = "a".repeat(64);
    },
    (h) => {
      h.input.attachedReports[0].mime = "image/png";
    },
    (h) => {
      h.input.reports[0].report.pageCount = 1;
    },
  ]) {
    const h = fixture();
    change(h);
    await assert.rejects(
      loadReportInputs(h.input, h.options),
      hasCode("conflict"),
    );
  }
  const h = fixture();
  h.input.attachedReports[0].size += 1;
  await assert.rejects(
    loadReportInputs(h.input, h.options),
    hasCode("case_not_ready"),
  );
});

test("accepts the existing three by ten MiB allowance without silently truncating", async () => {
  const bytes = Buffer.alloc(MAX_REPORT_INPUT_BYTES);
  png.copy(bytes);
  const files = Array.from({ length: 3 }, () => ({
    mime: "image/png",
    bytes,
    pages: 1,
  }));
  const h = fixture(files);
  const inputs = await loadReportInputs(h.input, h.options);
  assert.equal(inputs.length, 3);
  assert.ok(
    inputs.every((item) => item.bytes.length === MAX_REPORT_INPUT_BYTES),
  );
  assert.ok(inputs.every((item) => item.sha256 === hash(bytes)));
  for (const mutate of [
    (input) => input.attachedReports.push(input.attachedReports[0]),
    (input) => {
      input.attachedReports[0].size += 1;
    },
    (input) => {
      input.reports[0].report.pageCount = 51;
    },
  ]) {
    const extra = fixture(files);
    mutate(extra.input);
    await assert.rejects(
      loadReportInputs(extra.input, extra.options),
      hasCode("analysis_too_large"),
    );
    assert.equal(extra.fetches.length, 0);
  }
});

test("rejects missing original sources, invalid or over-limit PDFs and wrong source hashes", async () => {
  for (const bytes of [Buffer.from("%PDF-1.7\ntruncated"), pdf(51)]) {
    const h = fixture([{ mime: "application/pdf", bytes, pages: null }]);
    await assert.rejects(
      loadReportInputs(h.input, h.options),
      hasCode(bytes.length < 100 ? "case_not_ready" : "analysis_too_large"),
    );
  }
  const missing = fixture();
  missing.options.fetchImpl = async () => new Response(null, { status: 404 });
  await assert.rejects(
    loadReportInputs(missing.input, missing.options),
    hasCode("case_not_ready"),
  );
  const changed = fixture();
  changed.options.fetchImpl = async () =>
    new Response(pdf(2), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf(2).length),
        "X-Namat-Content-Sha256": "0".repeat(64),
      },
    });
  await assert.rejects(loadReportInputs(changed.input, changed.options));
  assert.deepEqual(
    await loadReportInputs(
      { submissionId: submission.id, attachedReports: [], reports: [] },
      fixture([]).options,
    ),
    [],
  );
});

function portalRequest(method = "POST") {
  return new Request(`https://${host}/api/plan`, {
    method,
    headers: {
      Origin: `https://${host}`,
      "X-MS-CLIENT-PRINCIPAL": Buffer.from(
        JSON.stringify({
          auth_typ: "aad",
          claims: [
            { typ: "oid", val: owner },
            { typ: "tid", val: tenant },
          ],
        }),
      ).toString("base64"),
    },
  });
}

test("backend generation exposes only a lazy original loader; cached generation and GET reload download nothing", async () => {
  const h = fixture([{ mime: "application/pdf", bytes: pdf(), pages: 1 }]);
  const patient = {
    ...structuredClone(submission),
    receipt_id: randomUUID(),
    data_class: "synthetic",
    fictional_confirmed: true,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    attached_reports: h.input.attachedReports,
  };
  const evidence = structuredClone(report);
  evidence.evidenceVersion = "namat-report-evidence-v1";
  evidence.extraction.inputSha256 = h.input.reports[0].extraction.inputSha256;
  evidence.extraction.pages[0].lines = [
    {
      id: "page:1:line:0",
      text: evidence.extraction.pages[0].text,
      bounds: null,
    },
  ];
  for (const row of evidence.extraction.observations)
    Object.assign(row, {
      dateKind: "unknown",
      dateSourceText: null,
      dateSourcePage: null,
    });
  const sourceFetch = h.options.fetchImpl;
  h.options.fetchImpl = async (url, init) => {
    if (url.endsWith("/v1/demo/submissions"))
      return Response.json({ submissions: [patient] });
    if (url.endsWith("/evidence-v1")) return Response.json(evidence);
    return sourceFetch(url, init);
  };
  h.options.analysisStore = {
    getInventoryReviews: async () => [],
    findRun: async () => null,
  };
  h.options.getPool = () => {
    throw new Error("No local DB");
  };
  const plan = {
    summaryShort: "Offline transport test.",
    summaryLong: "This fixture does not supply medical analysis.",
    findings: [],
    tests: [],
    followUps: [],
    sources: 0,
  };
  let shouldLoad = false;
  h.options.generatePlan = async (input) => {
    assert.equal(typeof input.loadReportInputs, "function");
    assert.equal(input.reportInputs, undefined);
    assert.ok(!JSON.stringify(input.inputSnapshot).includes("bytes"));
    assert.ok(!JSON.stringify(input.inputSnapshot).includes("PRIVATE"));
    assert.equal(h.fetches.length, 0);
    if (shouldLoad) {
      const files = await input.loadReportInputs();
      assert.deepEqual(files[0].bytes, pdf());
      assert.equal(files[0].filename, "report-1.pdf");
    }
    return { plan, cached: !shouldLoad };
  };
  const params = { submissionId: submission.id };
  const cached = await planResponse(portalRequest(), params, h.options);
  assert.equal(cached.status, 200, await cached.clone().text());
  assert.equal(h.fetches.length, 0);
  const saved = await savedPlanResponse(
    portalRequest("GET"),
    params,
    h.options,
  );
  assert.equal(saved.status, 200, await saved.clone().text());
  assert.equal(h.fetches.length, 0);
  shouldLoad = true;
  const fresh = await planResponse(portalRequest(), params, h.options);
  assert.equal(fresh.status, 200, await fresh.clone().text());
  const body = await fresh.json();
  assert.equal(h.fetches.length, 1);
  assert.equal(body.reportInputs, undefined);
  assert.ok(!JSON.stringify(body).includes("bytes"));
});
