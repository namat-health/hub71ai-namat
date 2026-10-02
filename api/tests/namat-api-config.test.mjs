import test from 'node:test';
import assert from 'node:assert/strict';
import {readApiConfig} from '../services/namat-api/config.mjs';

const localDatabase='postgresql://tester:fictional@127.0.0.1:5432/namat_hackathon';

test('shared API has explicit synthetic local defaults and no implicit database',()=>{
  const config=readApiConfig({});
  assert.equal(config.host,'127.0.0.1');
  assert.equal(config.port,4340);
  assert.equal(config.mode,'synthetic-local');
  assert.equal(config.databaseUrl,null);
  assert.equal(config.schema,'namat_api_dev');
  const configured=readApiConfig({NAMAT_API_DATABASE_URL:localDatabase,NAMAT_API_SCHEMA:'namat_api_test',NAMAT_API_ALLOWED_ORIGINS:'http://127.0.0.1:4324'});
  assert.equal(configured.databaseUrl,localDatabase);
  assert.equal(configured.schema,'namat_api_test');
});

test('shared API cannot pick up the existing production or demo database configuration',()=>{
  const config=readApiConfig({DATABASE_URL:'postgresql://user:secret@remote.example/production',
    HACKATHON_DATABASE_URL:'postgresql://user:secret@remote.example/demo',HACKATHON_EMAIL_MODE:'participants',BREVO_API_KEY:'not-a-real-secret'});
  assert.equal(config.databaseUrl,null);
  assert.equal(config.mode,'synthetic-local');
});

test('shared API rejects invalid or nonlocal explicit configuration',()=>{
  const invalid=[
    {NAMAT_API_MODE:'production'},
    {NAMAT_API_MODE:'synthetic'},
    {NAMAT_API_HOST:'0.0.0.0'},
    {NAMAT_API_HOST:'example.com'},
    {NAMAT_API_PORT:'not-a-number'},
    {NAMAT_API_PORT:'-1'},
    {NAMAT_API_PORT:'65536'},
    {NAMAT_API_DATABASE_URL:'postgresql://tester:fictional@remote.example:5432/namat_hackathon'},
    {NAMAT_API_DATABASE_URL:'postgresql://tester:fictional@127.0.0.1.evil.example:5432/namat_hackathon'},
    {NAMAT_API_DATABASE_URL:'https://tester:fictional@127.0.0.1/namat_hackathon'},
    {NAMAT_API_DATABASE_URL:'postgresql://127.0.0.1/namat_hackathon'},
    {NAMAT_API_DATABASE_URL:'not-a-url'},
    {NAMAT_API_SCHEMA:'public'},
    {NAMAT_API_SCHEMA:'namat_api_test; DROP SCHEMA public'},
    {NAMAT_API_SCHEMA:'namat_api_test.child'},
    {NAMAT_API_ALLOWED_ORIGINS:'*'},
    {NAMAT_API_ALLOWED_ORIGINS:'http://evil.example'},
    {NAMAT_API_ALLOWED_ORIGINS:'http://127.0.0.1:4324/path'},
    {NAMAT_API_ALLOWED_ORIGINS:'http://user:pass@127.0.0.1:4324'},
    {NAMAT_API_ALLOWED_ORIGINS:'http://127.0.0.1:4324,invalid'},
  ];
  for(const env of invalid)assert.throws(()=>readApiConfig(env),undefined,Object.keys(env)[0]+'='+Object.values(env)[0]);
});
