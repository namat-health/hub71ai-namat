// A one-shot LOCAL simulator for exercising the outbox. This does not import an
// email provider, read a Brevo key, or claim that a message has been delivered.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHackathonStore} from '../../src/hackathon/server/store.mjs';
import {createDatabase} from './database.mjs';
import {readApiConfig} from './config.mjs';
import {assertSourceRevision} from './revision.mjs';

export async function simulateConfirmationBatch({database, limit=25}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid batch size.');
  if (!database || !await database.store.ready()) throw new Error('Local API storage is not ready.');
  const {rows} = await database.pool.query(`SELECT reference FROM public.hackathon_email_outbox
    WHERE status='queued' AND expires_at>now() AND available_at<=now() ORDER BY created_at, id LIMIT $1`, [limit]);
  const store = createHackathonStore(database.pool);
  const counts = {examined:rows.length, simulated:0, held:0};
  for (const row of rows) {
    const result = await store.deliverReceiptConfirmation(row.reference, async () => ({state:'simulated'}));
    if (result.status === 'local') counts.simulated++;
    else counts.held++;
  }
  return counts;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let database;
  try {
    assertSourceRevision();
    database=createDatabase(readApiConfig());
    console.log(JSON.stringify(await simulateConfirmationBatch({database})));
  } catch {
    console.error('Local confirmation simulation failed. No external messages were sent.');process.exitCode=1;
  } finally {await database?.close();}
}
