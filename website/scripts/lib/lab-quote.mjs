// Lab quotes: where a doctor-approved set of biomarkers can be done in the patient's emirate,
// and the listed total. Rules (db/lab-catalog/README.md, "Quotes"):
// - Every option is one provider, collecting in the patient's emirate (and area, for home visits).
// - Exact cover: the chosen offerings together contain every approved biomarker. A biomarker
//   calculated from others (eGFR from creatinine) counts when those are covered, and says so.
// - The lowest listed total for that provider: offerings plus one visit fee per visit. An offering
//   that could be dropped is never kept, so nothing is added just to reach free collection.
// - Packages with tests that weren't ordered are allowed and counted ("+N not ordered").
// - sort-v1: options that cover every test first, then listed total, turnaround, home collection, provider.
// - If no provider covers everything, the ones that cover the most are listed with what's missing.
import {EMIRATES, assertSchema} from './lab-catalog.mjs';

export const QUOTE_RULES = {solver: 'exact-cover-v1', sort: 'sort-v1'};
export const CALCULATED_FROM = {'egfr': ['creatinine'], 'non-hdl-cholesterol': ['total-cholesterol','hdl-cholesterol']};
export const SORT_LABEL = 'Sorted by listed total, visit fees included';
const MAX_BIOMARKERS = 30;   // one bit each
const NODE_LIMIT = 200000;   // search steps per provider and visit type
const MODES = ['home','walk_in'];
const cents = value => Math.round(value * 100) / 100;

export function visitFee(option, subtotal) {
  if (option.fee_rule === 'none' || option.fee_rule === 'all_inclusive') return 0;
  if (option.fee_rule === 'flat') return option.fee_aed;
  if (option.fee_rule === 'free_above') return subtotal >= option.free_above_aed ? 0 : option.fee_aed ?? null;
  return null;   // not stated
}

// The lowest total cover of `full` (a bit mask), trying every combination with pruning.
// A cover in which an offering could be dropped is rejected. `price` returns {fee, total} or null.
function cheapestCover(usable, full, price) {
  const byBit = Array.from({length: MAX_BIOMARKERS}, (_, bit) => usable.filter(o => o.mask & (1 << bit)));
  let best = null, steps = 0, limited = false;
  const better = (a, b) => !b || a.total < b.total - 1e-9 || (Math.abs(a.total - b.total) < 1e-9
    && (a.items.length - b.items.length || a.extras - b.extras || a.key.localeCompare(b.key)) < 0);
  (function search(mask, items, subtotal) {
    if (++steps > NODE_LIMIT) { limited = true; return; }
    if (mask === full) {
      const removable = items.some((_, i) => items.reduce((m, o, j) => j === i ? m : m | o.mask, 0) === full);
      const priced = removable ? null : price(subtotal);
      if (!priced) return;
      const candidate = {items, subtotal, ...priced, extras: items.reduce((n, o) => n + o.extras, 0),
        key: items.map(o => String(o.id).padStart(12, '0')).sort().join(',')};
      if (better(candidate, best)) best = candidate;
      return;
    }
    if (best && subtotal > best.total + 1e-9) return;
    const need = full & ~mask, bit = 31 - Math.clz32(need & -need);
    for (const o of byBit[bit]) search(mask | o.mask, [...items, o], subtotal + o.price);
  })(0, [], 0);
  return {best, limited};
}

// Options for one provider: one per visit type it offers in the emirate.
function providerOptions(provider, order, target, {mode, area}) {
  const bit = new Map(target.map((id, i) => [id, 1 << i])), full = (1 << target.length) - 1;
  const inOrder = new Set([...order, ...target]);
  const candidates = provider.offerings.map(o => {
    let mask = 0;
    for (const item of o.items) if (bit.has(item.biomarker_id)) mask |= bit.get(item.biomarker_id);
    const extras = new Set(o.items.filter(item => !item.calculated && !inOrder.has(item.biomarker_id))
      .map(item => item.biomarker_id ?? item.printed_name.toLowerCase())).size;
    return {...o, mask, extras};
  }).filter(o => o.mask);
  // An offering is never needed when another covers at least as much for less (or the same, with fewer extras).
  const usable = candidates.filter(a => !candidates.some(b => b !== a && (b.mask | a.mask) === b.mask
    && (b.price < a.price || (b.price === a.price && (b.mask !== a.mask || b.extras < a.extras || (b.extras === a.extras && b.id < a.id))))))
    .sort((a, b) => a.price - b.price || a.id - b.id);
  const coverable = usable.reduce((m, o) => m | o.mask, 0);
  const options = [], notListed = [];
  for (const option of provider.options.filter(o => !mode || o.mode === mode)) {
    if (option.mode === 'home' && area && option.areas?.length
      && !option.areas.some(a => a.toLowerCase().includes(area.toLowerCase()) || area.toLowerCase().includes(a.toLowerCase()))) {
      notListed.push({provider: provider.slug, mode: option.mode, reason: `doesn't list ${area} for home visits`});
      continue;
    }
    const price = subtotal => {
      if (option.minimum_order_aed && subtotal < option.minimum_order_aed) return null;
      const fee = visitFee(option, subtotal);
      return {fee, total: subtotal + (fee ?? 0)};
    };
    const goal = coverable === full ? full : coverable;
    const {best, limited} = goal ? cheapestCover(usable, goal, price) : {best: null, limited: false};
    if (!best) {
      notListed.push({provider: provider.slug, mode: option.mode, reason: !goal ? 'no listed price here for these tests'
        : limited ? 'too many combinations to search' : `below the minimum order of AED ${option.minimum_order_aed}`});
      continue;
    }
    const chosen = best.items, listed = new Set(chosen.flatMap(o => o.items.map(item => item.biomarker_id)).filter(Boolean));
    const covers = id => listed.has(id) || (id in CALCULATED_FROM && CALCULATED_FROM[id].every(source => listed.has(source)));
    const extras = new Set(chosen.flatMap(o => o.items.filter(item => !item.calculated && !inOrder.has(item.biomarker_id))
      .map(item => item.biomarker_id ?? item.printed_name.toLowerCase())));
    const hours = chosen.map(o => o.turnaround_hours).filter(Boolean);
    const slowest = hours.length ? chosen.find(o => o.turnaround_hours === Math.max(...hours)) : null;
    options.push({
      provider: {slug: provider.slug, name: provider.name, type: provider.type, website: provider.website,
        booking_url: provider.booking_url, booking_phone: provider.booking_phone, booking_whatsapp: provider.booking_whatsapp},
      mode: option.mode,
      covers_all: order.every(covers),
      covered: order.filter(covers),
      missing: order.filter(id => !covers(id)),
      calculated: order.filter(id => !listed.has(id) && covers(id)).map(id => ({biomarker: id, from: CALCULATED_FROM[id]})),
      offerings: chosen.map(o => ({id: o.id, slug: o.slug, name: o.name, kind: o.kind, price_aed: o.price, list_price_aed: o.list_price_aed,
        price_type: o.price_type, includes_other: o.includes_other ?? [], url: o.url, checked_on: o.checked_on})),
      subtotal_aed: cents(best.subtotal),
      visit_fee_aed: best.fee === null ? null : cents(best.fee),
      fee_rule: option.fee_rule,
      total_aed: cents(best.total),
      not_ordered: extras.size,
      not_ordered_complete: chosen.every(o => o.contents_complete),
      turnaround_hours: slowest?.turnaround_hours ?? option.turnaround_hours ?? null,
      turnaround_text: slowest?.turnaround_text ?? option.turnaround_text ?? null,
      ...(limited ? {search_limited: true} : {}),
    });
  }
  return {options, notListed};
}

const sortV1 = (a, b) => (b.covers_all - a.covers_all) || (b.covered.length - a.covered.length) || (a.total_aed - b.total_aed)
  || ((a.visit_fee_aed === null) - (b.visit_fee_aed === null)) || ((a.turnaround_hours ?? Infinity) - (b.turnaround_hours ?? Infinity))
  || (MODES.indexOf(a.mode) - MODES.indexOf(b.mode)) || a.provider.slug.localeCompare(b.provider.slug);

// The biomarkers that must be found in offerings: calculated ones are replaced by what they're calculated from.
export function quoteTargets(biomarkers) {
  return [...new Set(biomarkers.flatMap(id => CALCULATED_FROM[id] ?? [id]))];
}

function checkRequest({biomarkers, emirate, mode, area}) {
  const order = [...new Set((biomarkers ?? []).map(id => String(id).trim()).filter(Boolean))];
  if (!order.length) throw new Error('A quote needs at least one biomarker.');
  if (quoteTargets(order).length > MAX_BIOMARKERS) throw new Error(`A quote can cover at most ${MAX_BIOMARKERS} biomarkers.`);
  if (!EMIRATES.includes(emirate)) throw new Error(`Unknown emirate "${emirate}"; use one of ${EMIRATES.join(', ')}.`);
  if (mode != null && !MODES.includes(mode)) throw new Error(`Unknown visit type "${mode}"; use home or walk_in.`);
  if (area != null && (typeof area !== 'string' || !area.trim())) throw new Error('Area must be a place name.');
  return {order, emirate, mode: mode ?? null, area: area?.trim() ?? null};
}

// Pure: `data.providers` are the providers collecting in the emirate, each with its collection
// `options` there and its `offerings` priced there (price, items), as loadQuoteData returns them.
export function quote(data, request) {
  const {order, emirate, mode, area} = checkRequest(request);
  const target = quoteTargets(order);
  const all = [], notListed = [];
  for (const provider of data.providers) {
    const result = providerOptions(provider, order, target, {mode, area});
    all.push(...result.options);
    notListed.push(...result.notListed);
  }
  const coversAll = all.some(o => o.covers_all);
  const most = Math.max(0, ...all.map(o => o.covered.length));
  const options = all.filter(o => coversAll ? o.covers_all : o.covered.length === most && most > 0).sort(sortV1);
  for (const o of all.filter(o => !options.includes(o))) notListed.push({provider: o.provider.slug, mode: o.mode, reason: `missing ${o.missing.join(', ')}`});
  return {rules: {...QUOTE_RULES, calculated_from: CALCULATED_FROM}, emirate, mode, area, order, sort_label: SORT_LABEL,
    covers_all: coversAll, options: request.limit ? options.slice(0, request.limit) : options, option_count: options.length,
    not_listed: notListed.sort((a, b) => a.provider.localeCompare(b.provider) || a.mode.localeCompare(b.mode))};
}

// Reads what a quote needs from a lab catalogue schema: providers collecting in the emirate, and
// their offerings that contain at least one of the biomarkers, priced for that emirate
// (an emirate's own price beats a UAE-wide one).
export async function loadQuoteData(client, schema, {biomarkers, emirate}) {
  assertSchema(schema);
  const target = quoteTargets(biomarkers);
  const {rows: options} = await client.query(`SELECT p.id, p.slug, p.name, p.type, p.website, p.booking_url, p.booking_phone, p.booking_whatsapp,
      c.mode, c.fee_rule, c.fee_aed::float8, c.free_above_aed::float8, c.minimum_order_aed::float8, c.areas, c.turnaround_hours, c.turnaround_text
    FROM ${schema}.providers p JOIN ${schema}.collection_options c ON c.provider_id = p.id AND c.emirate = $1 ORDER BY p.slug, c.mode`, [emirate]);
  const providers = new Map();
  for (const {id, slug, name, type, website, booking_url, booking_phone, booking_whatsapp, ...option} of options) {
    if (!providers.has(id)) providers.set(id, {slug, name, type, website, booking_url, booking_phone, booking_whatsapp, options: [], offerings: []});
    providers.get(id).options.push(option);
  }
  const {rows: offerings} = await client.query(`SELECT DISTINCT ON (o.id) o.id::int, o.provider_id, o.slug, o.name, o.kind, o.url, o.includes_other,
      o.contents_complete, o.turnaround_hours, o.turnaround_text, cp.price_aed::float8 AS price, cp.list_price_aed::float8, cp.price_type, cp.checked_on::text
    FROM ${schema}.offerings o JOIN ${schema}.current_prices cp ON cp.offering_id = o.id AND (cp.emirate = $1 OR cp.emirate IS NULL)
    WHERE o.provider_id = ANY($2)
      AND EXISTS (SELECT 1 FROM ${schema}.offering_biomarkers b WHERE b.offering_id = o.id AND b.biomarker_id = ANY($3))
    ORDER BY o.id, cp.emirate IS NULL`, [emirate, [...providers.keys()], target]);
  const {rows: items} = await client.query(`SELECT offering_id::int, printed_name, biomarker_id, calculated
    FROM ${schema}.offering_biomarkers WHERE offering_id = ANY($1)`, [offerings.map(o => o.id)]);
  const itemsOf = new Map();
  for (const {offering_id, ...item} of items) (itemsOf.get(offering_id) ?? itemsOf.set(offering_id, []).get(offering_id)).push(item);
  for (const {provider_id, ...o} of offerings) providers.get(provider_id).offerings.push({...o, items: itemsOf.get(o.id) ?? []});
  return {emirate, providers: [...providers.values()]};
}

// Checks the biomarkers against the catalogue, loads what's needed and returns the quote.
export async function quoteFor(client, schema, request) {
  const {order, emirate} = checkRequest(request);
  const {rows} = await client.query(`SELECT id FROM ${assertSchema(schema)}.biomarkers WHERE id = ANY($1)`, [order]);
  const unknown = order.filter(id => !rows.some(row => row.id === id));
  if (unknown.length) throw new Error(`Unknown biomarker${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}.`);
  return quote(await loadQuoteData(client, schema, {biomarkers: order, emirate}), request);
}
