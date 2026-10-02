// All database suites create isolated schemas and accept only loopback hosts.
// This runner never opens cloud databases or enables external provider calls.
import {spawn} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {readApiConfig} from '../services/namat-api/config.mjs';

try {
  const config=readApiConfig();
  if(config.mode!=='synthetic-local'||!config.databaseUrl)throw new Error('Local configuration required.');
  const files=readdirSync(new URL('../tests/',import.meta.url)).filter(name=>name.endsWith('.test.mjs')).sort().map(name=>`tests/${name}`);
  const env={...process.env};
  for(const name of ['NAMAT_API_TEST_DATABASE_URL','HACKATHON_TEST_DATABASE_URL','REPORT_TEST_DATABASE_URL']) {
    env[name] ||= config.databaseUrl;
    if(!['localhost','127.0.0.1','[::1]'].includes(new URL(env[name]).hostname))throw new Error('Loopback databases required.');
  }
  const child=spawn(process.execPath,['--test',...files],{cwd:new URL('../',import.meta.url),stdio:'inherit',env});
  child.on('error',()=>{console.error('Could not start backend tests.');process.exitCode=1;});
  child.on('exit',code=>{process.exitCode=code??1;});
} catch {
  console.error('Supply dedicated local API database configuration before running integration tests.');
  process.exitCode=1;
}
