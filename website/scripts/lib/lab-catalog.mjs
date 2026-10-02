// Lab catalogue helpers: matching printed test names to biomarkers, checking
// collected provider files, and writing them into a lab catalogue schema.
import {readFileSync, readdirSync} from 'node:fs';

export const SCHEMAS = {real: 'lab_catalog', demo: 'lab_catalog_demo'};
export const EMIRATES = ['abu_dhabi','dubai','sharjah','ajman','umm_al_quwain','ras_al_khaimah','fujairah'];
const PROVIDER_TYPES = ['lab','home_collection_service','hospital_clinic'];
const KINDS = ['single_test','panel','package'];
const FEE_RULES = ['none','flat','free_above','all_inclusive','not_stated'];
const SPECIMENS = ['venous_blood','finger_prick','urine','stool','saliva'];
const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
const UAE_WIDE = /\b(across|anywhere in|throughout|all over|all of) (the )?uae\b|\buae[- ]wide\b|\ball (seven |7 )?emirates\b/i;
const MIGRATIONS = new URL('../../db/lab-catalog/', import.meta.url);

// Words that don't change which biomarker a name means.
const FILLER = new Set(['test','tests','level','levels','serum','plasma','blood','assay','of','the','and','or','in','calculated','calc']);
const FOLDS = [[/ß/g,'ss'],[/β/g,' beta '],[/[µμ]/g,'u'],[/aem/g,'em'],[/oest/g,'est'],[/faec/g,'fec'],[/leuco/g,'leuko'],
  [/coeliac/g,'celiac'],[/glycosylated/g,'glycated'],[/sulphate/g,'sulfate'],[/isation/g,'ization'],[/ised\b/g,'ized'],[/ising\b/g,'izing']];

export function normalize(text) {
  let value = String(text).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  for (const [from, to] of FOLDS) value = value.replace(from, to);
  const tokens = value.replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter(token => token && !FILLER.has(token));
  return [...new Set(tokens)].sort().join(' ');
}

export function buildIndex(biomarkers, extra = {}) {
  const index = new Map();
  const add = (name, id) => {
    const key = normalize(name);
    if (!key) return;
    if (index.has(key) && index.get(key) !== id) throw new Error(`"${name}" would match both ${index.get(key)} and ${id}.`);
    index.set(key, id);
  };
  for (const marker of biomarkers) for (const name of [marker.name, ...marker.aliases]) add(name, marker.id);
  for (const [id, names] of Object.entries(extra)) {
    if (!biomarkers.some(marker => marker.id === id)) throw new Error(`Alias file names unknown biomarker ${id}.`);
    for (const name of names) add(name, id);
  }
  return index;
}

// One name, or a slash list of synonyms that all name the same biomarker ("AST/SGOT").
function lookup(index, text) {
  const whole = index.get(normalize(text));
  if (whole) return {id: whole, synonyms: 1};
  const ids = String(text).split('/').map(name => index.get(normalize(name)));
  return ids.length > 1 && ids[0] && ids.every(id => id === ids[0]) ? {id: ids[0], synonyms: ids.length} : null;
}

// Exact match after normalising. "Name (Synonym)" matches when both halves name the same biomarker,
// or when the part outside the bracket is itself a slash list of synonyms and the bracket names
// nothing else. A single name with a qualifier, such as "Testosterone (Free)", never matches.
export function matchName(index, printed) {
  const whole = lookup(index, printed);
  if (whole) return whole.id;
  const parts = /^(.*?)\(([^()]*)\)\s*$/.exec(String(printed).trim());
  if (!parts) return null;
  const outside = lookup(index, parts[1]), inside = lookup(index, parts[2]);
  if (outside && inside) return outside.id === inside.id ? outside.id : null;
  return outside?.synonyms > 1 ? outside.id : null;
}

// One printed line naming several tests: "Vitamin D & B12", "SGOT (AST) and SGPT (ALT)", "AST/ALT",
// or "Diabetic Screen (Glucose, HbA1c)". Split only when every part is a known name on its own,
// so "Testosterone, Free" or "LDL/HDL ratio" stay unmatched. Returns [{part, id}] or null.
export function joinedNames(index, printed) {
  const text = String(printed).trim(), bracket = /^(.*?)\(([^()]*)\)\s*$/.exec(text);
  for (const list of bracket ? [bracket[2], text] : [text]) {
    const parts = list.split(/\s*(?:&|\+|;|,|\/|\band\b)\s*/i).filter(Boolean);
    if (parts.length < 2) continue;
    const ids = parts.map(part => matchName(index, part));
    if (!ids.every(Boolean)) continue;
    const seen = new Set();
    return parts.map((part, i) => ({part, id: ids[i]})).filter(({id}) => !seen.has(id) && seen.add(id));
  }
  return null;
}

// Two panels are reported the same way by every lab, so an unlisted "CBC" or "Lipid Profile" stands
// for its core results. Recorded as mapped_by 'standard-panel-v1': an assumption until verified.
const STANDARD_PANELS = [
  {name: 'cbc', applies: tokens => tokens.includes('cbc') || (tokens.includes('count') && (tokens.includes('complete') || tokens.includes('full'))),
    markers: tokens => ['haemoglobin','haematocrit','mcv','white-cell-count','platelets',
      ...(tokens.some(token => /^diff/.test(token)) ? ['neutrophils','lymphocytes'] : [])]},
  {name: 'lipid', applies: tokens => tokens.includes('lipid') && (tokens.includes('profile') || tokens.includes('panel')),
    markers: () => ['total-cholesterol','ldl-cholesterol','hdl-cholesterol','triglycerides']},
];
export function standardPanel(printed) {
  const tokens = normalize(printed).split(' ');
  const panel = STANDARD_PANELS.find(candidate => candidate.applies(tokens));
  return panel ? panel.markers(tokens) : null;
}

// "Lipid Profile (Cholesterol, LDL, HDL, Triglycerides)" lists its contents; use them as the items.
function splitListedContents(printed) {
  const listed = /^(.*\S)\s*\(([^()]+)\)\s*$/.exec(printed);
  const names = listed ? listed[2].split(',').map(name => name.trim()).filter(Boolean) : [];
  return names.length >= 3 && names.every(name => /[a-z]/i.test(name)) ? names : [printed];
}

export const isCalculated = printed => /\bcalc(ulated)?\b|\bestimated\b|\begfr\b|\bratio\b|\bnon[- ]?hdl\b|\bhoma\b/i.test(printed);

// Panels and packages sold for children or for pregnancy care. Namat's patients are adults;
// single tests (a pregnancy test, for example) and packages that also name adults stay.
const NOT_FOR_ADULTS = /\b(kids?|child(ren)?|paediatric|pediatric|bab(y|ies)|infants?|neonat\w*|new-?borns?|toddlers?|teens?|teenagers?|adolescents?|school)\b|ante-?natal|pre-?natal|pregnan|maternity|\bnipt\b/i;
export const notForAdults = (name, kind) => kind !== 'single_test' && NOT_FOR_ADULTS.test(name) && !/\b(men|women|adults?)\b/i.test(name);

export const slugify = text => String(text).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/g, '') || 'item';

export function hoursFrom(text) {
  if (!text) return null;
  const unit = word => /day/i.test(word) ? 24 : 1;
  const range = /(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*(hours?|hrs?|h\b|days?|working days?)/i.exec(text);
  if (range) return Math.round(Number(range[2]) * unit(range[3]));
  const single = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h\b|days?|working days?)/i.exec(text);
  return single ? Math.round(Number(single[1]) * unit(single[2])) : null;
}

const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const money = value => {
  const number = typeof value === 'string' ? Number(value.replace(/[^0-9.]/g, '')) : value;
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : null;
};
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
const strings = value => Array.isArray(value) ? [...new Set(value.map(text).filter(Boolean))] : [];
const oneOf = (value, allowed) => allowed.includes(value) ? value : null;

// Checks one collected provider file and returns clean rows plus warnings. Never invents values.
export function checkProviderFile(input, {source = 'website'} = {}) {
  const warnings = [];
  const raw = input?.provider ?? {};
  const name = text(raw.name);
  if (!name) throw new Error('Provider file has no provider name.');
  const type = oneOf(raw.type, PROVIDER_TYPES);
  if (!type) throw new Error(`${name}: provider type "${raw.type}" is not one of ${PROVIDER_TYPES.join(', ')}.`);
  const checkedOn = date(input.collected_on) ?? new Date().toISOString().slice(0, 10);
  const contact = raw.price_list_contact && typeof raw.price_list_contact === 'object'
    ? Object.fromEntries(Object.entries(raw.price_list_contact).filter(([, value]) => text(value))) : {};
  const provider = {
    slug: /^[a-z0-9]+(-[a-z0-9]+)*$/.test(raw.slug ?? '') ? raw.slug : slugify(name), name, type,
    website: text(raw.website), booking_phone: text(raw.booking_phone), booking_whatsapp: text(raw.booking_whatsapp), booking_url: text(raw.booking_url),
    licence_authority: oneOf(String(raw.licence_authority ?? '').toLowerCase(), ['doh','dha','mohap']), licence_number: text(raw.licence_number),
    accreditation: strings(raw.accreditation), performing_lab_note: text(raw.performing_lab_note),
    price_list_contact: Object.keys(contact).length ? contact : null,
    notes: [text(raw.notes), text(input.notes)].filter(Boolean).join('\n') || null,
  };

  // An option without an emirate counts only when its supporting quote claims the whole UAE;
  // it is then recorded for every emirate, as the provider states.
  const uaeWide = option => option.emirate == null && UAE_WIDE.test(`${option.quote ?? ''} ${option.areas ?? ''}`);
  const expanded = (input.collection_options ?? []).flatMap(option => uaeWide(option)
    ? (warnings.push(`${option.mode} collection recorded for all emirates from a UAE-wide claim`), EMIRATES.map(emirate => ({...option, emirate})))
    : [option]);
  const collectionOptions = [], seen = new Set();
  for (const option of expanded) {
    const emirate = oneOf(option.emirate, EMIRATES), mode = oneOf(option.mode, ['home','walk_in']);
    if (!emirate || !mode) { warnings.push(`collection option skipped: emirate "${option.emirate}", mode "${option.mode}"`); continue; }
    if (seen.has(`${emirate}/${mode}`)) { warnings.push(`duplicate collection option ${emirate}/${mode} skipped`); continue; }
    seen.add(`${emirate}/${mode}`);
    let feeRule = oneOf(option.fee_rule, FEE_RULES) ?? 'not_stated';
    let fee = money(option.fee_aed), freeAbove = money(option.free_above_aed);
    if (feeRule === 'flat' && fee === null) { warnings.push(`${emirate}/${mode}: flat fee without an amount, set to not_stated`); feeRule = 'not_stated'; }
    if (feeRule === 'free_above' && !freeAbove) { warnings.push(`${emirate}/${mode}: free_above without a threshold, set to not_stated`); feeRule = 'not_stated'; }
    if (!['flat','free_above'].includes(feeRule)) fee = null;
    if (feeRule !== 'free_above') freeAbove = null;
    collectionOptions.push({emirate, mode, fee_rule: feeRule, fee_aed: fee, free_above_aed: freeAbove, minimum_order_aed: money(option.minimum_order_aed) || null,
      areas: Array.isArray(option.areas) ? strings(option.areas) : null, turnaround_hours: hoursFrom(option.turnaround_text), turnaround_text: text(option.turnaround_text),
      source_url: text(option.source_url), checked_on: checkedOn});
  }

  const branches = [];
  for (const branch of input.branches ?? []) {
    const emirate = oneOf(branch.emirate, EMIRATES), address = text(branch.address);
    if (!emirate || !address) { warnings.push(`branch skipped: "${branch.name ?? branch.address}" (emirate "${branch.emirate}")`); continue; }
    branches.push({name: text(branch.name), address, area: text(branch.area), emirate, hours: text(branch.hours), source_url: text(branch.source_url), checked_on: checkedOn});
  }

  const offerings = [], slugs = new Map();
  for (const item of input.offerings ?? []) {
    const offeringName = text(item.name);
    if (!offeringName) { warnings.push('offering without a name skipped'); continue; }
    let contents = [], truncated = false;
    for (const entry of item.biomarkers_as_printed ?? []) {
      const printed = text(typeof entry === 'string' ? entry : entry?.name);
      if (!printed) continue;
      if (/^(and\s+)?(\d+\s+)?more\b|^\+\s*\d+(\s+more)?$|^…$/i.test(printed)) { truncated = true; continue; }
      const id = typeof entry === 'object' ? text(entry.id) : null;
      for (const name of id ? [printed] : splitListedContents(printed)) {
        if (!contents.some(existing => existing.printed === name)) contents.push({printed: name, id});
      }
    }
    if (truncated) warnings.push(`${offeringName}: list ends with "and more", marked incomplete`);
    let kind = oneOf(item.kind, KINDS);
    if (!kind) { kind = contents.length > 1 ? 'package' : 'single_test'; warnings.push(`${offeringName}: kind "${item.kind}" replaced with ${kind}`); }
    // A single test, or a panel whose page lists nothing, is described by its own name.
    if (kind !== 'package' && !contents.length) contents = [{printed: offeringName, id: null}];
    const base = slugify(offeringName), count = (slugs.get(base) ?? 0) + 1;
    slugs.set(base, count);
    const prices = [], priced = new Set();
    for (const price of item.prices ?? []) {
      const amount = money(price.price_aed), emirate = price.emirate == null ? null : oneOf(price.emirate, EMIRATES);
      if (!amount) { warnings.push(`${offeringName}: price "${price.price_aed}" skipped`); continue; }
      if (price.emirate != null && !emirate) { warnings.push(`${offeringName}: price for unknown emirate "${price.emirate}" skipped`); continue; }
      if (priced.has(emirate)) { warnings.push(`${offeringName}: second price for ${emirate ?? 'all emirates'} skipped`); continue; }
      priced.add(emirate);
      const listPrice = money(price.list_price_aed);
      prices.push({emirate, price_aed: amount, list_price_aed: listPrice > amount ? listPrice : null,
        price_type: oneOf(price.price_type, ['list','promo','contracted','indicative']) ?? 'list',
        vat: oneOf(price.vat, ['included','excluded','not_stated']) ?? 'not_stated',
        source: oneOf(price.source, ['website','price_list','quote']) ?? source,
        source_url: text(price.source_url) ?? text(item.url), checked_on: checkedOn, valid_until: date(price.valid_until)});
    }
    const statedCount = Number.isInteger(item.stated_biomarker_count) && item.stated_biomarker_count > 0 ? item.stated_biomarker_count : null;
    offerings.push({slug: count > 1 ? `${base}-${count}` : base, name: offeringName, kind, description: text(item.description),
      includes_other: strings(item.includes_other), specimen: strings(item.specimen).filter(value => SPECIMENS.includes(value)),
      fasting: oneOf(item.fasting, ['required','not_required','not_stated']) ?? 'not_stated',
      turnaround_hours: hoursFrom(item.turnaround_text), turnaround_text: text(item.turnaround_text), stated_biomarker_count: statedCount,
      contents_complete: item.contents_complete === true && !truncated, url: text(item.url), checked_on: checkedOn, notes: text(item.notes), contents, prices});
  }
  return {provider, collectionOptions, branches, offerings, warnings};
}

export function assertSchema(schema) {
  if (!SCHEMA_NAME.test(schema)) throw new Error(`Invalid schema name "${schema}".`);
  return schema;
}

export function migrationFiles() {
  return readdirSync(MIGRATIONS).filter(name => /^\d{3}_[\w-]+\.sql$/.test(name)).sort();
}

export async function migrate(pool, schema) {
  assertSchema(schema);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`lab-catalog:${schema}`]);
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await client.query(`CREATE TABLE IF NOT EXISTS ${schema}.schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = [];
    for (const file of migrationFiles()) {
      const {rows} = await client.query(`SELECT 1 FROM ${schema}.schema_migrations WHERE version=$1`, [file]);
      if (rows[0]) continue;
      await client.query(readFileSync(new URL(file, MIGRATIONS), 'utf8').replaceAll('__SCHEMA__', schema));
      await client.query(`INSERT INTO ${schema}.schema_migrations(version) VALUES($1)`, [file]);
      applied.push(file);
    }
    await client.query('COMMIT');
    return applied;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {client.release();}
}

export async function seedBiomarkers(client, schema, {biomarkers, groups}) {
  assertSchema(schema);
  for (const marker of biomarkers) {
    await client.query(`INSERT INTO ${schema}.biomarkers (id,name,aliases,category,specimens,hlmcs_tier,restriction,source)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'kb')
      ON CONFLICT (id) DO UPDATE SET name=excluded.name, aliases=excluded.aliases, category=excluded.category,
        specimens=excluded.specimens, hlmcs_tier=excluded.hlmcs_tier, restriction=excluded.restriction`,
    [marker.id, marker.name, marker.aliases, marker.category, marker.specimens, marker.hlmcs_tier, marker.restriction]);
  }
  for (const group of groups) {
    await client.query(`INSERT INTO ${schema}.biomarker_groups (id,name) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET name=excluded.name`, [group.id, group.name]);
    await client.query(`DELETE FROM ${schema}.biomarker_group_members WHERE group_id=$1`, [group.id]);
    for (const member of group.members) await client.query(`INSERT INTO ${schema}.biomarker_group_members (group_id,biomarker_id) VALUES ($1,$2)`, [group.id, member]);
  }
  return {biomarkers: biomarkers.length, groups: groups.length};
}

// Replaces one provider's collection options, branches and offering contents, and adds
// prices for the file's checked date. Earlier prices stay as history. Run inside a transaction.
export async function loadProvider(client, schema, checked, index, {mappedBy = 'alias-v1'} = {}) {
  assertSchema(schema);
  const {provider: p} = checked;
  const {rows: [{id: providerId}]} = await client.query(`INSERT INTO ${schema}.providers
    (slug,name,type,website,booking_phone,booking_whatsapp,booking_url,licence_authority,licence_number,accreditation,performing_lab_note,price_list_contact,notes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    ON CONFLICT (slug) DO UPDATE SET name=excluded.name, type=excluded.type, website=excluded.website, booking_phone=excluded.booking_phone,
      booking_whatsapp=excluded.booking_whatsapp, booking_url=excluded.booking_url, licence_authority=excluded.licence_authority,
      licence_number=excluded.licence_number, accreditation=excluded.accreditation, performing_lab_note=excluded.performing_lab_note,
      price_list_contact=excluded.price_list_contact, notes=excluded.notes
    RETURNING id`,
  [p.slug, p.name, p.type, p.website, p.booking_phone, p.booking_whatsapp, p.booking_url, p.licence_authority, p.licence_number,
    p.accreditation, p.performing_lab_note, p.price_list_contact, p.notes]);
  await client.query(`DELETE FROM ${schema}.collection_options WHERE provider_id=$1`, [providerId]);
  for (const o of checked.collectionOptions) {
    await client.query(`INSERT INTO ${schema}.collection_options
      (provider_id,emirate,mode,fee_rule,fee_aed,free_above_aed,minimum_order_aed,areas,turnaround_hours,turnaround_text,source_url,checked_on)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [providerId, o.emirate, o.mode, o.fee_rule, o.fee_aed, o.free_above_aed, o.minimum_order_aed, o.areas, o.turnaround_hours, o.turnaround_text, o.source_url, o.checked_on]);
  }
  await client.query(`DELETE FROM ${schema}.branches WHERE provider_id=$1`, [providerId]);
  for (const b of checked.branches) {
    await client.query(`INSERT INTO ${schema}.branches (provider_id,name,address,area,emirate,hours,source_url,checked_on) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [providerId, b.name, b.address, b.area, b.emirate, b.hours, b.source_url, b.checked_on]);
  }
  // A provider file is its whole current catalogue: offerings it no longer lists are removed.
  const {rowCount: removed} = await client.query(`DELETE FROM ${schema}.offerings WHERE provider_id=$1 AND slug <> ALL($2)`,
    [providerId, checked.offerings.map(o => o.slug)]);
  const stats = {offerings: checked.offerings.length, items: 0, matched: 0, prices: 0, removed};
  if (!checked.offerings.length) return stats;
  // Offerings, contents and prices are written a provider at a time, so a large catalogue
  // costs a handful of statements rather than one round trip per row.
  const {rows: saved} = await client.query(`INSERT INTO ${schema}.offerings
      (provider_id,slug,name,kind,description,includes_other,specimen,fasting,turnaround_hours,turnaround_text,stated_biomarker_count,contents_complete,url,checked_on,notes)
    SELECT $1, o.slug, o.name, o.kind, o.description, ARRAY(SELECT jsonb_array_elements_text(o.includes_other)),
      ARRAY(SELECT jsonb_array_elements_text(o.specimen)), o.fasting, o.turnaround_hours, o.turnaround_text, o.stated_biomarker_count,
      o.contents_complete, o.url, o.checked_on, o.notes
    FROM jsonb_to_recordset($2::jsonb) AS o(slug text, name text, kind text, description text, includes_other jsonb, specimen jsonb, fasting text,
      turnaround_hours int, turnaround_text text, stated_biomarker_count int, contents_complete boolean, url text, checked_on date, notes text)
    ON CONFLICT (provider_id,slug) DO UPDATE SET name=excluded.name, kind=excluded.kind, description=excluded.description,
      includes_other=excluded.includes_other, specimen=excluded.specimen, fasting=excluded.fasting, turnaround_hours=excluded.turnaround_hours,
      turnaround_text=excluded.turnaround_text, stated_biomarker_count=excluded.stated_biomarker_count,
      contents_complete=excluded.contents_complete, url=excluded.url, checked_on=excluded.checked_on, notes=excluded.notes
    RETURNING id, slug`,
  [providerId, JSON.stringify(checked.offerings.map(({contents, prices, ...offering}) => offering))]);
  const idOf = new Map(saved.map(row => [row.slug, row.id])), items = [], prices = [];
  for (const o of checked.offerings) {
    const rows = new Map();
    for (const item of o.contents) {
      const id = item.id ?? matchName(index, item.printed), panel = id ? null : standardPanel(item.printed);
      const joined = id || panel ? null : joinedNames(index, item.printed);
      if (panel) for (const marker of panel) rows.set(`${item.printed} › ${marker}`, [marker, false, 'standard-panel-v1']);
      else if (joined) for (const {part, id: marker} of joined) rows.set(`${item.printed} › ${part}`, [marker, isCalculated(part), mappedBy]);
      else rows.set(item.printed, [id, isCalculated(item.printed), id ? (item.id ? 'explicit' : mappedBy) : null]);
    }
    for (const [printed, [id, calculated, how]] of rows) {
      items.push({offering_id: idOf.get(o.slug), printed_name: printed, biomarker_id: id, calculated, mapped_by: how});
      if (id) stats.matched++;
    }
    for (const price of o.prices) prices.push({offering_id: idOf.get(o.slug), ...price});
  }
  stats.items = items.length;
  stats.prices = prices.length;
  const ids = saved.map(row => row.id);
  await client.query(`DELETE FROM ${schema}.offering_biomarkers WHERE offering_id = ANY($1)`, [ids]);
  if (items.length) await client.query(`INSERT INTO ${schema}.offering_biomarkers (offering_id,printed_name,biomarker_id,calculated,mapped_by)
    SELECT x.offering_id, x.printed_name, x.biomarker_id, x.calculated, x.mapped_by
    FROM jsonb_to_recordset($1::jsonb) AS x(offering_id bigint, printed_name text, biomarker_id text, calculated boolean, mapped_by text)`, [JSON.stringify(items)]);
  // Prices from the same check date are replaced; other dates stay as history.
  await client.query(`DELETE FROM ${schema}.offering_prices WHERE offering_id = ANY($1) AND checked_on = $2`, [ids, checked.offerings[0].checked_on]);
  if (prices.length) await client.query(`INSERT INTO ${schema}.offering_prices
      (offering_id,emirate,price_aed,list_price_aed,price_type,vat,source,source_url,checked_on,valid_until)
    SELECT x.offering_id, x.emirate, x.price_aed, x.list_price_aed, x.price_type, x.vat, x.source, x.source_url, x.checked_on, x.valid_until
    FROM jsonb_to_recordset($1::jsonb) AS x(offering_id bigint, emirate text, price_aed numeric, list_price_aed numeric, price_type text, vat text,
      source text, source_url text, checked_on date, valid_until date)`, [JSON.stringify(prices)]);
  return stats;
}

// Keeps only what can be quoted for a doctor-approved plan (rules in db/lab-catalog/README.md).
// Run inside a transaction; running it again removes nothing. Returns what each rule removed.
export async function prune(client, schema, {coreBiomarkers, minCoreBiomarkers, excludedProviders = {}, staleOfferings = []}) {
  assertSchema(schema);
  const run = async (sql, params) => (await client.query(sql, params)).rowCount;
  const slugs = async (sql, params) => (await client.query(sql, params)).rows.map(row => row.slug).sort();
  const removed = {};
  removed.excludedProviders = await slugs(`DELETE FROM ${schema}.providers WHERE slug = ANY($1) RETURNING slug`, [Object.keys(excludedProviders)]);
  // Pages that are still online but out of date, named in the settings by provider and a piece of text.
  removed.staleOfferings = 0;
  for (const rule of staleOfferings) {
    const fields = ['name','url','notes'].filter(key => typeof rule[key] === 'string' && rule[key].trim());
    if (fields.length !== 1) throw new Error(`Stale offering rule for "${rule.provider}" needs exactly one of name, url or notes.`);
    removed.staleOfferings += await run(`DELETE FROM ${schema}.offerings o USING ${schema}.providers p
      WHERE p.id = o.provider_id AND p.slug = $1 AND strpos(lower(coalesce(o.${fields[0]}, '')), lower($2)) > 0`, [rule.provider, rule[fields[0]].trim()]);
  }
  removed.stalePrices = await run(`DELETE FROM ${schema}.offering_prices WHERE valid_until < current_date OR price_type = 'indicative'`);
  removed.pricesOutsideArea = await run(`DELETE FROM ${schema}.offering_prices pr USING ${schema}.offerings o
    WHERE o.id = pr.offering_id AND pr.emirate IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM ${schema}.collection_options c WHERE c.provider_id = o.provider_id AND c.emirate = pr.emirate)`);
  const {rows: grouped} = await client.query(`SELECT id, name, kind FROM ${schema}.offerings WHERE kind <> 'single_test'`);
  removed.notForAdults = await run(`DELETE FROM ${schema}.offerings WHERE id = ANY($1)`,
    [grouped.filter(o => notForAdults(o.name, o.kind)).map(o => o.id)]);
  removed.unpriced = await run(`DELETE FROM ${schema}.offerings o WHERE NOT EXISTS (SELECT 1 FROM ${schema}.offering_prices pr WHERE pr.offering_id = o.id)`);
  removed.noBiomarker = await run(`DELETE FROM ${schema}.offerings o
    WHERE NOT EXISTS (SELECT 1 FROM ${schema}.offering_biomarkers b WHERE b.offering_id = o.id AND b.biomarker_id IS NOT NULL)`);
  removed.emptyProviders = await slugs(`DELETE FROM ${schema}.providers p
    WHERE NOT EXISTS (SELECT 1 FROM ${schema}.offerings o WHERE o.provider_id = p.id) RETURNING slug`);
  // Too narrow: in no emirate it collects in can the provider price enough of the core biomarkers.
  removed.narrowProviders = await slugs(`DELETE FROM ${schema}.providers p WHERE NOT EXISTS (
      SELECT 1 FROM ${schema}.collection_options c
      JOIN ${schema}.offerings o ON o.provider_id = c.provider_id
      JOIN ${schema}.current_prices pr ON pr.offering_id = o.id AND (pr.emirate IS NULL OR pr.emirate = c.emirate)
      JOIN ${schema}.offering_biomarkers b ON b.offering_id = o.id AND b.biomarker_id = ANY($1)
      WHERE c.provider_id = p.id GROUP BY c.emirate HAVING count(DISTINCT b.biomarker_id) >= $2)
    RETURNING slug`, [coreBiomarkers, minCoreBiomarkers]);
  return removed;
}
