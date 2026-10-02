// Operator CLI for the lab catalogue (db/lab-catalog). Never prints connection settings.
//   node scripts/lab-catalog.mjs <command> --target=local|azure
//     migrate               create or update both schemas (lab_catalog, lab_catalog_demo)
//     seed-biomarkers       load db/lab-catalog/biomarkers.json into both schemas
//     seed-demo             load the fictional providers in db/lab-catalog/demo.json into lab_catalog_demo
//     load [--dir=DIR] [--only=a.json,b.json] [--no-prune]  load collected provider files (*.json, not _*.json) into lab_catalog, then prune
//     prune [--dry-run]     remove from lab_catalog what can't be quoted (rules in db/lab-catalog/README.md, settings in prune.json)
//     status                row counts for both schemas
//     unmapped [--limit=N]  most common printed names in lab_catalog not yet matched to a biomarker
//     quote --emirate=E --tests=a,b,c [--mode=home|walk_in] [--area=NAME] [--demo] [--limit=N] [--json]
//                           where those biomarkers can be done, one provider per option, sorted by listed total
//                           (shortcuts: lipid = the four lipid results, core = the 16 core biomarkers in prune.json)
//   --verbose prints every data warning.
// local: HACKATHON_DATABASE_URL in .env.hackathon.local (loopback only). azure: JOURNEY_DATABASE_* in .env.
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {SCHEMAS, buildIndex, checkProviderFile, loadProvider, migrate, normalize, prune, seedBiomarkers} from './lib/lab-catalog.mjs';
import {quoteFor} from './lib/lab-quote.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const [command = 'status', ...flags] = process.argv.slice(2);
const flag = (name, fallback) => {
  const found = flags.find(value => value === `--${name}` || value.startsWith(`--${name}=`));
  return found === undefined ? fallback : found.includes('=') ? found.slice(found.indexOf('=') + 1) : true;
};
const read = file => JSON.parse(readFileSync(join(root, 'db/lab-catalog', file), 'utf8'));
const makeIndex = () => buildIndex(read('biomarkers.json').biomarkers, read('aliases.json').aliases);

function poolFor(target) {
  if (target === 'local') {
    try {process.loadEnvFile(join(root, '.env.hackathon.local'));} catch {/* may come from the shell */}
    const url = process.env.HACKATHON_DATABASE_URL;
    if (!url) throw new Error('HACKATHON_DATABASE_URL is not set (values are not shown).');
    if (!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)) throw new Error('--target=local must be a loopback database.');
    return new pg.Pool({connectionString: url, max: 2});
  }
  if (target === 'azure') {
    try {process.loadEnvFile(join(root, '.env'));} catch {/* may come from the shell */}
    const {JOURNEY_DATABASE_HOST: host, JOURNEY_DATABASE_USER: user, JOURNEY_DATABASE_PASSWORD: password, JOURNEY_DATABASE_NAME: database} = process.env;
    if (!host || !user || !password || !database) throw new Error('JOURNEY_DATABASE_* settings are incomplete (values are not shown).');
    return new pg.Pool({host, user, password, database, port: 5432, max: 2, connectionTimeoutMillis: 8000,
      ssl: {rejectUnauthorized: true, ...(process.env.JOURNEY_DATABASE_CA ? {ca: process.env.JOURNEY_DATABASE_CA} : {})}});
  }
  throw new Error('Choose --target=local or --target=azure.');
}

async function inTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {client.release();}
}

async function loadFile(pool, schema, input, index, options) {
  const checked = checkProviderFile(input, options);
  const stats = await inTransaction(pool, client => loadProvider(client, schema, checked, index, options));
  console.log(`  ${checked.provider.name}: ${stats.offerings} offerings, ${stats.matched}/${stats.items} items matched, ${stats.prices} prices`
    + (stats.removed ? `, ${stats.removed} no longer listed removed` : '') + (checked.warnings.length ? `, ${checked.warnings.length} warnings` : ''));
  if (flag('verbose', false)) for (const warning of checked.warnings) console.log(`    - ${warning}`);
  return stats;
}

const counts = async client => (await client.query(`SELECT (SELECT count(*) FROM ${SCHEMAS.real}.providers)::int AS providers,
  (SELECT count(*) FROM ${SCHEMAS.real}.offerings)::int AS offerings, (SELECT count(*) FROM ${SCHEMAS.real}.offering_prices)::int AS prices`)).rows[0];

// Prunes lab_catalog in one transaction; a dry run reports the same numbers and rolls back.
async function pruneReal(pool, {dryRun = false} = {}) {
  const {core_biomarkers: coreBiomarkers, min_core_biomarkers: minCoreBiomarkers, excluded_providers: excludedProviders,
    stale_offerings: staleOfferings} = read('prune.json');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await counts(client);
    const removed = await prune(client, SCHEMAS.real, {coreBiomarkers, minCoreBiomarkers, excludedProviders, staleOfferings});
    const after = await counts(client);
    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
    const list = slugs => slugs.length ? ` (${slugs.join(', ')})` : '';
    console.log(`${SCHEMAS.real} prune${dryRun ? ' (dry run, nothing changed)' : ''}:`);
    console.log(`  providers ${before.providers} → ${after.providers}: ${removed.excludedProviders.length} excluded in prune.json${list(removed.excludedProviders)}; `
      + `${removed.emptyProviders.length} with nothing left to quote; ${removed.narrowProviders.length} pricing fewer than ${minCoreBiomarkers} of the ${coreBiomarkers.length} core biomarkers in any emirate${list(removed.narrowProviders)}`);
    console.log(`  offerings ${before.offerings} → ${after.offerings} (including those of removed providers): ${removed.unpriced} without a firm current price, `
      + `${removed.noBiomarker} without any known biomarker, ${removed.notForAdults} for children or pregnancy, ${removed.staleOfferings} on out-of-date pages named in prune.json`);
    console.log(`  prices ${before.prices} → ${after.prices}: ${removed.stalePrices} expired or "from" prices, ${removed.pricesOutsideArea} for an emirate the provider doesn't collect in`);
    if (flag('verbose', false)) console.log(`  nothing left to quote: ${removed.emptyProviders.join(', ')}`);
    return removed;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {client.release();}
}

const EMIRATE_NAMES = {abu_dhabi: 'Abu Dhabi', dubai: 'Dubai', sharjah: 'Sharjah', ajman: 'Ajman', umm_al_quwain: 'Umm Al Quwain',
  ras_al_khaimah: 'Ras Al Khaimah', fujairah: 'Fujairah'};
const VISIT = {home: 'home visit', walk_in: 'walk-in'};
const aed = value => `AED ${Number.isInteger(value) ? value : value.toFixed(2)}`;

function printQuote(result, limit) {
  console.log(`${EMIRATE_NAMES[result.emirate]}${result.mode ? `, ${VISIT[result.mode]} only` : ''}${result.area ? `, ${result.area}` : ''}: `
    + `${result.order.length} biomarker${result.order.length > 1 ? 's' : ''} (${result.order.join(', ')})`);
  if (!result.options.length) {console.log('No provider in the catalogue sells any of these tests here.'); return;}
  const providers = new Set(result.options.map(o => o.provider.slug)).size;
  console.log(`${result.sort_label}. ${result.option_count} option${result.option_count > 1 ? 's' : ''} from ${providers} provider${providers > 1 ? 's' : ''} `
    + `${result.covers_all ? 'cover every test' : 'cover the most tests; none covers all'}${result.option_count > limit ? `; the first ${limit} are shown` : ''}.`);
  result.options.slice(0, limit).forEach((o, i) => {
    const fee = o.visit_fee_aed === null ? ' + visit fee not stated' : o.visit_fee_aed ? ` (tests ${aed(o.subtotal_aed)} + visit ${aed(o.visit_fee_aed)})` : '';
    console.log(`${String(i + 1).padStart(2)}. ${o.provider.name}, ${VISIT[o.mode]}: ${aed(o.total_aed)}${fee}`);
    const extras = o.not_ordered ? `+${o.not_ordered}${o.not_ordered_complete ? '' : ' or more'} not ordered` : 'nothing extra';
    console.log(`    ${o.offerings.map(x => `${x.name} ${aed(x.price_aed)}`).join(' + ')} · ${extras}${o.turnaround_hours ? ` · results within ${o.turnaround_hours < 48 ? `${o.turnaround_hours} h` : `${Math.round(o.turnaround_hours / 24)} days`}` : ''}`);
    for (const c of o.calculated) console.log(`    ${c.biomarker} is calculated from ${c.from.join(' and ')}: confirm the lab reports it`);
    if (o.missing.length) console.log(`    missing: ${o.missing.join(', ')}`);
    const link = o.offerings.length === 1 && o.offerings[0].url ? o.offerings[0].url : o.provider.booking_url ?? o.provider.website;
    if (link) console.log(`    ${link}`);
  });
  if (result.not_listed.length) console.log(`Not listed: ${result.not_listed.slice(0, 6).map(n => `${n.provider} ${VISIT[n.mode]} (${n.reason})`).join('; ')}`
    + `${result.not_listed.length > 6 ? `; and ${result.not_listed.length - 6} more` : ''}.`);
}

const pool = poolFor(flag('target'));
try {
  const {rows: [where]} = await pool.query('SELECT current_database() AS database');
  (flag('json', false) ? console.error : console.log)(`Target: ${flag('target')}, database "${where.database}".`);
  if (command === 'migrate') {
    for (const schema of Object.values(SCHEMAS)) {
      const applied = await migrate(pool, schema);
      console.log(`${schema}: ${applied.length ? `applied ${applied.join(', ')}` : 'already up to date'}`);
    }
  } else if (command === 'seed-biomarkers') {
    const data = read('biomarkers.json');
    for (const schema of Object.values(SCHEMAS)) {
      const result = await inTransaction(pool, client => seedBiomarkers(client, schema, data));
      console.log(`${schema}: ${result.biomarkers} biomarkers and ${result.groups} groups from knowledge base ${data.meta.version}.`);
    }
  } else if (command === 'seed-demo') {
    const index = makeIndex();
    console.log(`${SCHEMAS.demo} (fictional):`);
    for (const input of read('demo.json').providers) await loadFile(pool, SCHEMAS.demo, input, index, {source: 'price_list', mappedBy: 'demo-seed'});
  } else if (command === 'load') {
    const dir = resolve(root, flag('dir', '../research/lab-catalog-2026-10-01/raw'));
    const only = flag('only', '') ? String(flag('only')).split(',') : null;
    const files = readdirSync(dir).filter(name => name.endsWith('.json') && !name.startsWith('_') && (!only || only.includes(name))).sort();
    const index = makeIndex(), failed = [];
    console.log(`${SCHEMAS.real}: ${files.length} provider files from ${dir}`);
    for (const name of files) {
      try {
        await loadFile(pool, SCHEMAS.real, JSON.parse(readFileSync(join(dir, name), 'utf8')), index, {source: 'website', mappedBy: 'alias-v1'});
      } catch (error) {failed.push(name); console.log(`  ${name}: NOT LOADED (${error.message})`);}
    }
    // Discovery sweeps (_discovery*.json) only list providers to contact; they are not loaded.
    if (!flag('no-prune', false)) await pruneReal(pool);
    if (failed.length) process.exitCode = 1;
  } else if (command === 'prune') {
    await pruneReal(pool, {dryRun: Boolean(flag('dry-run', false))});
  } else if (command === 'quote') {
    const shortcuts = {lipid: ['total-cholesterol','ldl-cholesterol','hdl-cholesterol','triglycerides'], core: read('prune.json').core_biomarkers};
    const biomarkers = String(flag('tests', '')).split(',').map(id => id.trim()).filter(Boolean).flatMap(id => shortcuts[id] ?? [id]);
    const text = name => typeof flag(name) === 'string' ? flag(name) : undefined;
    const client = await pool.connect();
    let result;
    try {
      result = await quoteFor(client, flag('demo', false) ? SCHEMAS.demo : SCHEMAS.real,
        {biomarkers, emirate: text('emirate'), mode: text('mode'), area: text('area')});
    } finally {client.release();}
    if (flag('json', false)) console.log(JSON.stringify(result, null, 2));
    else printQuote(result, Number(flag('limit', 5)));
  } else if (command === 'status') {
    for (const schema of Object.values(SCHEMAS)) {
      const {rows: [exists]} = await pool.query('SELECT to_regclass($1) IS NOT NULL AS ok', [`${schema}.offerings`]);
      if (!exists.ok) {console.log(`${schema}: not created`); continue;}
      const {rows: [c]} = await pool.query(`SELECT
        (SELECT count(*) FROM ${schema}.providers)::int AS providers,
        (SELECT count(*) FROM ${schema}.offerings)::int AS offerings,
        (SELECT count(*) FROM ${schema}.offerings WHERE kind='single_test')::int AS singles,
        (SELECT count(*) FROM ${schema}.offerings WHERE kind='panel')::int AS panels,
        (SELECT count(*) FROM ${schema}.offerings WHERE kind='package')::int AS packages,
        (SELECT count(*) FROM ${schema}.offering_biomarkers)::int AS items,
        (SELECT count(*) FROM ${schema}.offering_biomarkers WHERE biomarker_id IS NOT NULL)::int AS matched,
        (SELECT count(*) FROM ${schema}.offering_prices)::int AS prices,
        (SELECT count(*) FROM ${schema}.biomarkers)::int AS biomarkers`);
      console.log(`${schema}: ${c.providers} providers; ${c.offerings} offerings (${c.singles} single tests, ${c.panels} panels, ${c.packages} packages); `
        + `${c.matched}/${c.items} items matched; ${c.prices} prices; ${c.biomarkers} biomarkers`);
    }
  } else if (command === 'unmapped') {
    const {rows} = await pool.query(`SELECT b.printed_name, o.provider_id FROM ${SCHEMAS.real}.offering_biomarkers b
      JOIN ${SCHEMAS.real}.offerings o ON o.id = b.offering_id WHERE b.biomarker_id IS NULL`);
    const groups = new Map();
    for (const row of rows) {
      const key = normalize(row.printed_name), group = groups.get(key) ?? {count: 0, providers: new Set(), spellings: new Set()};
      group.count++; group.providers.add(row.provider_id); group.spellings.add(row.printed_name);
      groups.set(key, group);
    }
    const limit = Number(flag('limit', 40));
    console.log(`${rows.length} unmatched items, ${groups.size} distinct names. Most common:`);
    for (const group of [...groups.values()].sort((a, b) => b.count - a.count).slice(0, limit)) {
      console.log(`  ${String(group.count).padStart(4)} × ${[...group.spellings].slice(0, 3).join(' | ')} (${group.providers.size} providers)`);
    }
  } else throw new Error(`Unknown command "${command}".`);
} finally {await pool.end();}
