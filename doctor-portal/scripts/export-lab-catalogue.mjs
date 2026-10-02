// Refreshes data/lab-catalogue/: the lab price catalogue snapshot read by lib/blood-draw.mjs.
//   node scripts/export-lab-catalogue.mjs <path to a namat-website checkout> [--demo]
// It uses that checkout's catalogue code and Azure settings (JOURNEY_DATABASE_* in its .env,
// as `scripts/lab-catalog.mjs --target=azure` does), reads in a read-only transaction and never
// prints connection settings. One file per emirate keeps each email build to one small read.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const site = resolve(process.argv[2] || "");
const schema = process.argv.includes("--demo")
  ? "lab_catalog_demo"
  : "lab_catalog";
const out = join(import.meta.dirname, "..", "data", "lab-catalogue");
const pg = createRequire(join(site, "package.json"))("pg");
const { loadQuoteData } = await import(
  join(site, "scripts", "lib", "lab-quote.mjs")
);
const { EMIRATES } = await import(
  join(site, "scripts", "lib", "lab-catalog.mjs")
);

process.loadEnvFile(join(site, ".env"));
const {
  JOURNEY_DATABASE_HOST: host,
  JOURNEY_DATABASE_USER: user,
  JOURNEY_DATABASE_PASSWORD: password,
  JOURNEY_DATABASE_NAME: database,
} = process.env;
const pool = new pg.Pool({
  host,
  user,
  password,
  database,
  port: 5432,
  max: 2,
  connectionTimeoutMillis: 8000,
  ssl: {
    rejectUnauthorized: true,
    ...(process.env.JOURNEY_DATABASE_CA
      ? { ca: process.env.JOURNEY_DATABASE_CA }
      : {}),
  },
});

// Only what quote() and the email read.
const slim = (provider) => ({
  ...provider,
  offerings: provider.offerings.map((offering) => ({
    id: offering.id,
    slug: offering.slug,
    name: offering.name,
    kind: offering.kind,
    url: offering.url,
    contents_complete: offering.contents_complete,
    turnaround_hours: offering.turnaround_hours,
    turnaround_text: offering.turnaround_text,
    price: offering.price,
    list_price_aed: offering.list_price_aed,
    price_type: offering.price_type,
    checked_on: offering.checked_on,
    items: offering.items.map((item) =>
      item.biomarker_id
        ? {
            biomarker_id: item.biomarker_id,
            ...(item.calculated ? { calculated: true } : {}),
          }
        : { printed_name: item.printed_name },
    ),
  })),
});

const client = await pool.connect();
try {
  await client.query("BEGIN READ ONLY");
  const exportedAt = new Date().toISOString();
  const fictional = schema === "lab_catalog_demo";
  const { rows: biomarkers } = await client.query(
    `SELECT id, name FROM ${schema}.biomarkers ORDER BY id`,
  );
  mkdirSync(out, { recursive: true });
  for (const emirate of EMIRATES) {
    const data = await loadQuoteData(client, schema, {
      biomarkers: biomarkers.map((item) => item.id),
      emirate,
    });
    const { rows: branches } = await client.query(
      `SELECT p.slug AS provider, b.name, b.address, b.area, b.hours
       FROM ${schema}.branches b JOIN ${schema}.providers p ON p.id = b.provider_id
       WHERE b.emirate = $1 ORDER BY p.slug, b.area NULLS LAST, b.name NULLS LAST`,
      [emirate],
    );
    writeFileSync(
      join(out, `${emirate}.json`),
      `${JSON.stringify({ schema, exportedAt, fictional, emirate, providers: data.providers.map(slim), branches })}\n`,
    );
    console.log(
      `${emirate}: ${data.providers.length} providers, ${branches.length} branches`,
    );
  }
  writeFileSync(
    join(out, "biomarkers.json"),
    `${JSON.stringify({ schema, exportedAt, biomarkers: Object.fromEntries(biomarkers.map((item) => [item.id, item.name])) })}\n`,
  );
  await client.query("ROLLBACK");
} finally {
  client.release();
  await pool.end();
}
