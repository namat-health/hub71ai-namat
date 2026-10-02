// The local and hosted staging runtimes use separate, explicit configuration.
// Neither runtime loads legacy .env files or enables external mail or AI calls.
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
export const QUESTIONNAIRE_REVISION = 'uae-arrival-2026-09-30';
export const DEFAULT_SCHEMA = 'namat_api_dev';
export const STAGING_ORIGIN = 'https://namat-api-staging-uaen-001.azurewebsites.net';
const STAGING_DATABASE_HOST = 'namat-pg-test-uaen-001.postgres.database.azure.com';
const STAGING_ORIGINS = new Set([STAGING_ORIGIN, 'https://start.namat.health']);

function readStagingConfig(env) {
  if (env.NAMAT_API_STAGING_APPROVED !== 'true') throw new Error('Explicit synthetic staging approval is required.');
  if (env.NAMAT_API_PUBLIC_ORIGIN !== STAGING_ORIGIN) throw new Error('Use the approved HTTPS staging origin.');
  if (env.NAMAT_API_SCHEMA !== 'namat_api_staging') throw new Error('Use the dedicated staging schema.');
  if (env.NAMAT_API_HOST && env.NAMAT_API_HOST !== '0.0.0.0') throw new Error('Invalid staging listener.');
  if ((env.PORT && env.PORT !== '8080') || (env.NAMAT_API_PORT && env.NAMAT_API_PORT !== '8080')) throw new Error('Staging uses port 8080.');
  // A 32-byte cryptographically random token is generated during provisioning.
  // Requiring its canonical encoding rejects accidentally copied placeholders.
  if (typeof env.NAMAT_API_STAGING_TOKEN !== 'string' || !/^[a-f0-9]{64}$/.test(env.NAMAT_API_STAGING_TOKEN)
      || new Set(env.NAMAT_API_STAGING_TOKEN).size < 8) throw new Error('Configure a random 32-byte staging token encoded as lowercase hex.');
  const origins = new Set();
  for (const raw of (env.NAMAT_API_ALLOWED_ORIGINS || STAGING_ORIGIN).split(',')) {
    const origin = raw.trim();
    if (!STAGING_ORIGINS.has(origin)) throw new Error('Use an approved HTTPS staging client origin.');
    origins.add(origin);
  }
  let url;
  try { url = new URL(env.NAMAT_API_DATABASE_URL); } catch { throw new Error('An explicit staging database configuration is required.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== STAGING_DATABASE_HOST
      || decodeURIComponent(url.username) !== 'namat_api_staging_runtime' || !url.password
      || url.pathname !== '/namat_journey' || (url.port && url.port !== '5432') || url.search || url.hash) {
    throw new Error('Use the approved staging database and restricted runtime login without query parameters.');
  }
  return Object.freeze({mode:'synthetic-staging', host:'0.0.0.0', port:8080, schema:'namat_api_staging', origins,
    publicOrigin:STAGING_ORIGIN, stagingApproved:true, stagingToken:env.NAMAT_API_STAGING_TOKEN, databaseUrl:url.href});
}

export function readApiConfig(env = process.env) {
  const mode = env.NAMAT_API_MODE || 'synthetic-local';
  if (mode === 'synthetic-staging') return readStagingConfig(env);
  if (mode !== 'synthetic-local') throw new Error('Only explicitly configured synthetic local or staging modes are implemented.');
  const host = env.NAMAT_API_HOST || '127.0.0.1';
  if (!LOOPBACK.has(host)) throw new Error('The development API requires a loopback listener.');
  const rawPort = env.NAMAT_API_PORT || '4340';
  if (!/^\d{1,5}$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) throw new Error('Invalid API port.');
  const port = Number(rawPort);
  const schema = env.NAMAT_API_SCHEMA || DEFAULT_SCHEMA;
  if (!/^namat_api_[a-z0-9_]{1,40}$/.test(schema)) throw new Error('A dedicated namat_api_ development schema is required.');
  const origins = new Set();
  const originHost = ['::1','[::1]'].includes(host) ? '[::1]' : '127.0.0.1';
  for (const raw of (env.NAMAT_API_ALLOWED_ORIGINS || `http://${originHost}:${port}`).split(',')) {
    let url;
    try { url = new URL(raw.trim()); } catch { throw new Error('Invalid allowed origin.'); }
    if (!['http:', 'https:'].includes(url.protocol) || !LOOPBACK.has(url.hostname)
        || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Only explicit loopback origins are supported in this milestone.');
    origins.add(url.origin);
  }
  let databaseUrl = null;
  if (env.NAMAT_API_DATABASE_URL) {
    let url;
    try { url = new URL(env.NAMAT_API_DATABASE_URL); } catch { throw new Error('Invalid local database configuration.'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOOPBACK.has(url.hostname)
        || !url.username || !url.password || !/^\/[a-zA-Z_][a-zA-Z0-9_]*$/.test(url.pathname)
        || url.search || url.hash || (url.port && (!/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535))) {
      throw new Error('The API requires an explicit loopback PostgreSQL URL without query parameters.');
    }
    if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
    databaseUrl = url.href;
  }
  return Object.freeze({mode, host:host === 'localhost' ? '127.0.0.1' : host === '[::1]' ? '::1' : host, port, schema, origins, databaseUrl});
}
