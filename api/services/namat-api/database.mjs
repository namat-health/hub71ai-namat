import {readFileSync} from 'node:fs';
import pg from 'pg';
import {createHackathonStore, poolOptions} from '../../src/hackathon/server/store.mjs';
import {QUESTIONNAIRE_REVISION, readApiConfig} from './config.mjs';

export function scopePool(native, schema) {
  if (!/^namat_api_[a-z0-9_]{1,40}$/.test(schema)) throw new Error('Invalid API schema.');
  const scoped = sql => sql.replaceAll('public.', `${schema}.`);
  return {
    query: (sql, params) => native.query(scoped(sql), params),
    connect: async () => {
      const client = await native.connect();
      return {query:(sql, params) => client.query(scoped(sql), params), release:() => client.release()};
    },
  };
}
export function createDatabase(config) {
  // Revalidate every field even for callers bypassing the HTTP server. Hosted
  // access is restricted to the approved staging role, database, and schema.
  const validated = readApiConfig({NAMAT_API_MODE:config.mode, NAMAT_API_DATABASE_URL:config.databaseUrl || '',
    NAMAT_API_SCHEMA:config.schema, NAMAT_API_HOST:config.host, NAMAT_API_PORT:config.port?.toString(),
    NAMAT_API_ALLOWED_ORIGINS:config.origins ? [...config.origins].join(',') : undefined,
    NAMAT_API_PUBLIC_ORIGIN:config.publicOrigin, NAMAT_API_STAGING_TOKEN:config.stagingToken,
    NAMAT_API_STAGING_APPROVED:config.stagingApproved === true ? 'true' : undefined});
  if (!validated.databaseUrl) return null;
  const options = poolOptions(validated);
  if (options.host === '[::1]') options.host = '::1';
  const native = new pg.Pool(options);
  native.on('error', () => {}); // Request/readiness errors remain generic, without leaking connection details.
  const pool = scopePool(native, validated.schema);
  const legacy = createHackathonStore(pool);
  const store = {
    async ready() {
      if (!await legacy.ready()) return false;
      const {rows} = await pool.query(`SELECT revision FROM public.api_schema_version WHERE singleton = true`);
      const {rows:columns} = await native.query(`SELECT is_nullable, column_default FROM information_schema.columns
        WHERE table_schema=$1 AND table_name='hackathon_welcome_submissions' AND column_name='questionnaire_revision'`, [validated.schema]);
      const {rows:constraints} = await native.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conrelid=to_regclass($1) AND conname='questionnaire_revision_fixed' AND contype='c' AND convalidated`,
      [`${validated.schema}.hackathon_welcome_submissions`]);
      return rows.length === 1 && rows[0].revision === QUESTIONNAIRE_REVISION && columns.length === 1
        && columns[0].is_nullable === 'NO' && columns[0].column_default === `'${QUESTIONNAIRE_REVISION}'::text`
        && constraints.length === 1 && constraints[0].definition === `CHECK ((questionnaire_revision = '${QUESTIONNAIRE_REVISION}'::text))`;
    },
    async save(value) {
      if (!await store.ready()) throw new Error('The API schema is not ready.');
      const saved = await legacy.save(value);
      if (!saved?.receiptId) return saved;
      const {rows:[outbox]} = await pool.query('SELECT status FROM public.hackathon_email_outbox WHERE reference=$1', [saved.receiptId]);
      const states = {queued:'pending',sending:'pending',local:'simulated',sent:'accepted',failed:'failed',unknown:'unknown'};
      return {...saved, confirmationEmail:states[outbox?.status] || 'unknown'};
    },
  };
  return {native, pool, store, close:() => native.end()};
}

// Applies only to a separate, explicitly named local schema. Does not mutate
// existing public hackathon or journey records. No migration runs on startup.
export async function initializeDatabase(config) {
  if (config.mode && config.mode !== 'synthetic-local') throw new Error('Database initialization is local-only. Hosted schemas require a separate reviewed migration.');
  config = readApiConfig({NAMAT_API_DATABASE_URL:config.databaseUrl || '', NAMAT_API_SCHEMA:config.schema});
  const database = createDatabase(config);
  if (!database) throw new Error('Configure the local database before initialization.');
  let client;
  try {
    client = await database.native.connect();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`namat-api-init:${config.schema}`]);
    const {rows:[existing]} = await client.query('SELECT to_regnamespace($1) AS schema', [config.schema]);
    if (existing.schema) {
      const {rows} = await client.query(`SELECT revision FROM ${config.schema}.api_schema_version WHERE singleton = true`);
      if (rows.length !== 1 || rows[0].revision !== QUESTIONNAIRE_REVISION) throw new Error('Existing schema needs an explicit migration.');
    } else {
      await client.query(`CREATE SCHEMA ${config.schema}`);
      const sql = readFileSync(new URL('../../src/hackathon/db/001_welcome_submissions.sql', import.meta.url), 'utf8');
      await client.query(sql.replaceAll('public.', `${config.schema}.`));
      await client.query(`ALTER TABLE ${config.schema}.hackathon_welcome_submissions
        ADD COLUMN questionnaire_revision text NOT NULL DEFAULT '${QUESTIONNAIRE_REVISION}'
        CONSTRAINT questionnaire_revision_fixed CHECK (questionnaire_revision = '${QUESTIONNAIRE_REVISION}')`);
      await client.query(`CREATE TABLE ${config.schema}.api_schema_version (
        singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton), revision text NOT NULL)`);
      await client.query(`INSERT INTO ${config.schema}.api_schema_version (revision) VALUES ($1)`, [QUESTIONNAIRE_REVISION]);
    }
    await client.query('COMMIT');
    // Release before readiness acquires a connection; this also works for a
    // caller that later reduces the local pool size to one.
    client.release(); client = null;
    if (!await database.store.ready()) throw new Error('Existing API schema is incomplete. Use an explicit migration.');
  } catch (error) { await client?.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client?.release(); await database.close(); }
}
