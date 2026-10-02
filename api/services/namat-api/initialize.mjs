import {readApiConfig} from './config.mjs';
import {assertSourceRevision} from './revision.mjs';
import {initializeDatabase} from './database.mjs';
try {
  assertSourceRevision();
  await initializeDatabase(readApiConfig());
  console.log('The separate local API schema is ready. Existing application tables were not changed.');
} catch {
  console.error('Local API initialization failed. Check its explicit local configuration and schema permissions.');
  process.exitCode = 1;
}
