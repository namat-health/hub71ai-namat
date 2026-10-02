// Start-journey attribution and entry-link contract (milestone 3).
//
// acquisition: how the visitor reached Namat. Approved utm_* codes only.
// entry: which Namat page and button opened the journey. itm_* codes only.
// The two never overwrite each other. Values outside these lists are dropped,
// so answers, identity, click IDs (gclid, fbclid…) and linker parameters (_gl)
// cannot enter the contract. Add a code here before using it in a campaign.
export const ACQUISITION_OPTIONS = Object.freeze({
  source: Object.freeze(['google','instagram','facebook','tiktok','snapchat','linkedin','youtube','whatsapp','newsletter','partner','referral']),
  medium: Object.freeze(['cpc','paid-social','social','email','sms','referral','affiliate','display','qr']),
  campaign: Object.freeze(['launch','founder']),
});
export const ENTRY_OPTIONS = Object.freeze({
  page: Object.freeze(['homepage','how-it-works','privacy']),
  placement: Object.freeze(['hero','header','menu','explainer','membership','footer','inline']),
});
const ACQUISITION_PARAMS = {source:'utm_source',medium:'utm_medium',campaign:'utm_campaign'};
const ENTRY_PARAMS = {page:'itm_page',placement:'itm_placement'};

export const SITE_ORIGIN = 'https://namat.health';
// Provisional subdomain. Confirm spelling and ownership before any DNS change.
export const START_HOSTS = Object.freeze(['start.namat.health']);

const allowed = (options, value) => {
  if (typeof value !== 'string' || value.length > 64) return undefined;
  const code = value.trim().toLowerCase();
  return options.includes(code) ? code : undefined;
};
function pick(options, read) {
  const picked = {};
  for (const [key, list] of Object.entries(options)) {
    const code = allowed(list, read(key));
    if (code) picked[key] = code;
  }
  return picked;
}
const params = search => search instanceof URLSearchParams ? search : new URLSearchParams(typeof search === 'string' ? search : '');
const plain = raw => raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

export const readAcquisition = search => { const query = params(search); return pick(ACQUISITION_OPTIONS, key => query.get(ACQUISITION_PARAMS[key])); };
export const readEntry = search => { const query = params(search); return pick(ENTRY_OPTIONS, key => query.get(ENTRY_PARAMS[key])); };
export const readAttribution = search => ({acquisition:readAcquisition(search),entry:readEntry(search)});

export const sanitizeAcquisition = raw => pick(ACQUISITION_OPTIONS, key => plain(raw)[key]);
export const sanitizeEntry = raw => pick(ENTRY_OPTIONS, key => plain(raw)[key]);
export const sanitizeAttribution = raw => ({acquisition:sanitizeAcquisition(plain(raw).acquisition),entry:sanitizeEntry(plain(raw).entry)});

// Build-time: `/start/` locally, or the start subdomain root once configured.
export function resolveStartUrl(value) {
  if (value === undefined || value === null || value === '' || value === '/start/') return '/start/';
  let url;
  try { url = new URL(value); } catch { url = null; }
  const loopback = url?.protocol === 'http:' && ['127.0.0.1','localhost'].includes(url.hostname);
  const approved = url?.protocol === 'https:' && START_HOSTS.includes(url.hostname) && !url.port;
  if (!url || !(approved || loopback) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error(`PUBLIC_START_URL must be /start/ or https://${START_HOSTS[0]}/`);
  }
  return `${url.origin}/`;
}
export const startCanonical = startUrl => new URL(startUrl, `${SITE_ORIGIN}/`).href;

// Internal CTA link: placement only. Acquisition is appended in the browser.
export function entryHref(startUrl, page, placement) {
  if (!ENTRY_OPTIONS.page.includes(page) || !ENTRY_OPTIONS.placement.includes(placement)) {
    throw new Error(`Unknown start entry: ${page}/${placement}`);
  }
  return `${startUrl}?${ENTRY_PARAMS.page}=${page}&${ENTRY_PARAMS.placement}=${placement}`;
}

export function withAcquisition(href, acquisition) {
  const codes = sanitizeAcquisition(acquisition);
  const url = new URL(href, 'https://relative.invalid');
  for (const [key, param] of Object.entries(ACQUISITION_PARAMS)) {
    url.searchParams.delete(param);
    if (codes[key]) url.searchParams.set(param, codes[key]);
  }
  return /^https?:\/\//i.test(href) ? url.href : `${url.pathname}${url.search}${url.hash}`;
}
