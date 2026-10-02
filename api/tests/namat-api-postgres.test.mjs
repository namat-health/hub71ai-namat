// Explicit local-only integration suite. Isolated schema, deleted at teardown.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {readApiConfig, QUESTIONNAIRE_REVISION} from '../services/namat-api/config.mjs';
import {createDatabase,initializeDatabase} from '../services/namat-api/database.mjs';
import {createNamatApiServer} from '../services/namat-api/server.mjs';
import {simulateConfirmationBatch} from '../services/namat-api/worker.mjs';
import {createHackathonStore} from '../src/hackathon/server/store.mjs';
import {validateHackathonSubmission} from '../src/hackathon/server/api.mjs';
import {input,answers,file,png} from './hackathon-fixtures.mjs';
const url=process.env.NAMAT_API_TEST_DATABASE_URL;
const schema=`namat_api_test_${randomUUID().replaceAll('-','')}`;
const env={NAMAT_API_DATABASE_URL:url||'',NAMAT_API_SCHEMA:schema,NAMAT_API_ALLOWED_ORIGINS:'http://127.0.0.1:4324'};
const config=readApiConfig(env); // Reject a remote database even if tests would skip.
let database,server,base;
before(async()=>{
  if(!url)return;
  await initializeDatabase(config);database=createDatabase(config);
  assert.equal(await database.store.ready(),true);
  server=createNamatApiServer({env,store:database.store});server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{
  if(server)await new Promise(resolve=>{server.close(resolve);server.closeIdleConnections();});
  if(database){await database.native.query(`DROP SCHEMA ${schema} CASCADE`);await database.close();}
});
const check=(name,fn)=>test(name,{skip:!url},fn);
const validated=overrides=>validateHackathonSubmission(input(overrides)).value;
const submit=body=>fetch(`${base}/v1/submissions`,{method:'POST',headers:{Origin:env.NAMAT_API_ALLOWED_ORIGINS,'Content-Type':'application/json'},body:JSON.stringify({...body,questionnaireRevision:QUESTIONNAIRE_REVISION})});

check('Namat API PostgreSQL: HTTP saves one durable revision and queued confirmation, replay reuses receipt',async()=>{
  const body=input();const first=await submit(body);assert.equal(first.status,201);const saved=await first.json();
  assert.equal(saved.confirmationEmail,'pending');
  const again=await submit(body);assert.equal(again.status,201);assert.equal((await again.json()).receiptId,saved.receiptId);
  assert.equal((await submit({...body,email:'changed@example.invalid'})).status,409);
  const {rows:[row]}=await database.pool.query(`SELECT id,questionnaire_revision,answers FROM public.hackathon_welcome_submissions WHERE receipt_id=$1`,[saved.receiptId]);
  assert.equal(row.questionnaire_revision,QUESTIONNAIRE_REVISION);assert.equal(row.answers.bloodwork,'no');
  const {rows}=await database.pool.query('SELECT status,attempts,provider_message_id FROM public.hackathon_email_outbox WHERE submission_id=$1',[row.id]);
  assert.deepEqual(rows,[{status:'queued',attempts:0,provider_message_id:null}]);
});
check('Namat API PostgreSQL: 12 simultaneous identical saves create one submission and one outbox',async()=>{
  const value=validated();const saved=await Promise.all(Array.from({length:12},()=>database.store.save(value)));
  assert.equal(new Set(saved.map(x=>x.receiptId)).size,1);assert.equal(saved.filter(x=>!x.repeated).length,1);
  const {rows:[count]}=await database.pool.query(`SELECT count(*)::int AS n FROM public.hackathon_email_outbox WHERE reference=$1`,[saved[0].receiptId]);assert.equal(count.n,1);
});
check('Namat API PostgreSQL: report bytes and metadata survive independent API submission',async()=>{
  const body=input({answers:answers({bloodwork:'yes'}),reports:[file(),file(png(),'sample.png','image/png')]});
  const response=await submit(body);assert.equal(response.status,201);const receipt=(await response.json()).receiptId;
  const {rows:[row]}=await database.pool.query('SELECT report_files,report_metadata FROM public.hackathon_welcome_submissions WHERE receipt_id=$1',[receipt]);
  assert.equal(row.report_files.length,2);assert.equal(row.report_files[1].equals(png()),true);assert.equal(row.report_metadata[1].type,'image/png');
});
check('Namat API PostgreSQL: failed outbox write rolls back intake',async()=>{
  const value=validated();const failing={connect:async()=>{const c=await database.pool.connect();return {query:(sql,params)=>{if(sql.includes('INSERT INTO public.hackathon_email_outbox'))throw new Error('injected');return c.query(sql,params);},release:()=>c.release()};}};
  await assert.rejects(createHackathonStore(failing).save(value));
  assert.equal((await database.pool.query('SELECT id FROM public.hackathon_welcome_submissions WHERE request_id=$1',[value.requestId])).rowCount,0);
});
check('Namat API PostgreSQL: missing revision constraint blocks readiness and writes',async()=>{
  await database.native.query(`ALTER TABLE ${schema}.hackathon_welcome_submissions DROP CONSTRAINT questionnaire_revision_fixed`);
  try{assert.equal(await database.store.ready(),false);await assert.rejects(initializeDatabase(config));await assert.rejects(database.store.save(validated()));assert.equal((await submit(input())).status,503);}
  finally{await database.native.query(`ALTER TABLE ${schema}.hackathon_welcome_submissions ADD CONSTRAINT questionnaire_revision_fixed CHECK (questionnaire_revision='${QUESTIONNAIRE_REVISION}')`);}
});
check('Namat API PostgreSQL: local simulation claims once and never sets provider acceptance',async()=>{
  const body=input();const value=validateHackathonSubmission(body).value;const saved=await database.store.save(value);
  const counts=await simulateConfirmationBatch({database});assert.ok(counts.simulated>=1);
  const {rows:[row]}=await database.pool.query('SELECT status,attempts,provider_message_id FROM public.hackathon_email_outbox WHERE reference=$1',[saved.receiptId]);
  assert.deepEqual(row,{status:'local',attempts:1,provider_message_id:null});
  const replay=await submit(body);assert.equal(replay.status,201);assert.equal((await replay.json()).confirmationEmail,'simulated');
  const again=await simulateConfirmationBatch({database});assert.equal(again.examined,0);
});
check('Namat API PostgreSQL: initialization repeats without replacing saved records',async()=>{
  const saved=await database.store.save(validated());await initializeDatabase(config);
  assert.equal(await database.store.ready(),true);
  assert.equal((await database.pool.query('SELECT id FROM public.hackathon_welcome_submissions WHERE receipt_id=$1',[saved.receiptId])).rowCount,1);
});
