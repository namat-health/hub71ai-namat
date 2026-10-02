// Uses only an explicitly supplied local database. The suite creates and drops
// a random namat_api_test_ schema; it cannot use the public or demo schema.
import {spawn} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {readApiConfig} from '../services/namat-api/config.mjs';
try {
  const config=readApiConfig();
  if (!config.databaseUrl) throw new Error('Local database required.');
  const files=readdirSync(new URL('../tests/',import.meta.url)).filter(name=>/^namat-api.*\.test\.mjs$/.test(name)).sort().map(name=>`tests/${name}`);
  const child=spawn(process.execPath,['--test',...files],{cwd:new URL('../',import.meta.url),stdio:'inherit',env:{...process.env,NAMAT_API_TEST_DATABASE_URL:config.databaseUrl}});
  child.on('error',()=>{console.error('Could not start local API tests.');process.exitCode=1;});
  child.on('exit',code=>{process.exitCode=code??1;});
} catch {
  console.error('Supply the dedicated local API database configuration before running integration tests.');process.exitCode=1;
}
