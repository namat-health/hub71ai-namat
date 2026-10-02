// Explicit loopback-only integration tests. All objects live in a random
// schema, removed afterward. No Azure connection or external email is allowed.
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createHackathonStore} from '../src/hackathon/server/store.mjs';
import {processHackathonRequest,validateHackathonSubmission} from '../src/hackathon/server/api.mjs';
import {env,input,request,answers,file,png} from './hackathon-fixtures.mjs';

const url=process.env.HACKATHON_TEST_DATABASE_URL;
if(url&&!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw new Error('Hackathon tests require a loopback database.');
const schema=`hackathon_test_${randomUUID().replaceAll('-','')}`,enabled=Boolean(url);
let native,admin,pool,store;
const scopedSql=sql=>sql.replaceAll('public.',`${schema}.`);
const scopedClient=client=>({query:(sql,params)=>client.query(scopedSql(sql),params),release:()=>client.release()});
before(async()=>{
  if(!enabled)return;
  admin=new pg.Pool({connectionString:url,max:1});await admin.query(`CREATE SCHEMA ${schema}`);
  native=new pg.Pool({connectionString:url,max:8});
  pool={query:(sql,params)=>native.query(scopedSql(sql),params),connect:async()=>scopedClient(await native.connect())};
  await pool.query(readFileSync(new URL('../src/hackathon/db/001_welcome_submissions.sql',import.meta.url),'utf8'));
  await pool.query(readFileSync(new URL('../src/hackathon/db/003_questionnaire_v2.sql',import.meta.url),'utf8'));
  store=createHackathonStore(pool);
});
after(async()=>{await native?.end();if(admin){await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}});
const check=(name,fn)=>test(name,{skip:!enabled},fn);
const value=overrides=>validateHackathonSubmission(input(overrides)).value;

check('hackathon native: concurrent retries persist one answer row and one atomic confirmation',async()=>{
  const submission=value();
  const saved=await Promise.all(Array.from({length:12},()=>store.save(submission)));
  assert.equal(new Set(saved.map(r=>r.receiptId)).size,1);assert.equal(saved.filter(r=>!r.repeated).length,1);
  assert.deepEqual(await store.save({...submission,email:'changed@example.invalid'}),{conflict:true});
  const {rows:[row]}=await pool.query('SELECT * FROM public.hackathon_welcome_submissions WHERE request_id=$1',[submission.requestId]);
  assert.deepEqual(row.answers,submission.answers);assert.deepEqual(row.notes,submission.notes);assert.equal(row.data_class,'synthetic');
  assert.equal(row.expires_at-row.created_at,30*86400000);
  const {rows}=await pool.query('SELECT * FROM public.hackathon_email_outbox WHERE submission_id=$1',[row.id]);
  assert.equal(rows.length,1);assert.equal(rows[0].status,'queued');assert.equal(rows[0].recipient_email,submission.email);
  assert.equal(rows[0].answers,undefined);assert.equal(rows[0].report_files,undefined);
});

check('hackathon native: multiple binary reports retain matching metadata and enforce synthetic scope',async()=>{
  const submission=value({answers:answers({bloodwork:'yes'}),reports:[file(),file(png(),'report.png','image/png')]});
  const saved=await store.save(submission);
  const {rows:[row]}=await pool.query('SELECT * FROM public.hackathon_welcome_submissions WHERE receipt_id=$1',[saved.receiptId]);
  assert.equal(row.report_files.length,2);assert.ok(row.report_files.every((bytes,i)=>bytes.equals(submission.reports[i].bytes)));
  assert.deepEqual(row.report_metadata,submission.reports.map(({name,type,size,sha256})=>({name,type,size,sha256})));
  assert.equal(row.report_total_size,submission.reports.reduce((sum,r)=>sum+r.size,0));
  await assert.rejects(pool.query("UPDATE public.hackathon_welcome_submissions SET data_class='live' WHERE id=$1",[row.id]),{code:'23514'});
  await assert.rejects(pool.query("UPDATE public.hackathon_welcome_submissions SET fictional_confirmed=false WHERE id=$1",[row.id]),{code:'23514'});
  await assert.rejects(pool.query("UPDATE public.hackathon_welcome_submissions SET report_total_size=1 WHERE id=$1",[row.id]),{code:'23514'});
});

check('hackathon native: queue failure rolls back the submission',async()=>{
  const submission=value();
  const failing={connect:async()=>{const c=await pool.connect();return {query(sql,params){if(sql.startsWith('INSERT INTO public.hackathon_email_outbox'))throw new Error('injected queue failure');return c.query(sql,params);},release:()=>c.release()};}};
  await assert.rejects(createHackathonStore(failing).save(submission));
  assert.equal((await pool.query('SELECT 1 FROM public.hackathon_welcome_submissions WHERE request_id=$1',[submission.requestId])).rowCount,0);
});

check('hackathon native: delivery commits its claim before sender and concurrent calls send only once',async()=>{
  const submission=value(),saved=await store.save(submission);let calls=0;
  const sender=async message=>{
    calls+=1;assert.deepEqual(Object.keys(message).sort(),['firstName','hasReports','recipientEmail','reference']);
    assert.equal((await pool.query('SELECT status FROM public.hackathon_email_outbox WHERE reference=$1',[saved.receiptId])).rows[0].status,'sending');
    return {state:'accepted',messageId:'fictional-provider-id'};
  };
  await Promise.all(Array.from({length:6},()=>store.deliverReceiptConfirmation(saved.receiptId,sender)));
  assert.equal(calls,1);assert.equal((await store.deliverReceiptConfirmation(saved.receiptId,sender)).status,'sent');assert.equal(calls,1);
});

check('hackathon native: ambiguous provider or final database failure stays held without automatic resend',async()=>{
  const saved=await store.save(value());let calls=0;
  const sender=async()=>{calls+=1;throw new Error('private provider error');};
  assert.equal((await store.deliverReceiptConfirmation(saved.receiptId,sender)).status,'unknown');
  assert.equal((await store.deliverReceiptConfirmation(saved.receiptId,sender)).status,'unknown');assert.equal(calls,1);
  const other=await store.save(value());
  const failing={query(sql,params){if(sql.includes('provider_message_id=$4'))throw new Error('database unavailable after acceptance');return pool.query(sql,params);}};
  assert.equal((await createHackathonStore(failing).deliverReceiptConfirmation(other.receiptId,async()=>({state:'accepted',messageId:'fictional'}))).status,'unknown');
  assert.equal((await store.deliverReceiptConfirmation(other.receiptId,sender)).status,'sending');assert.equal(calls,1);
});

check('hackathon native: blocked mail remains queued; rate limits back off; no health payload reaches sender',async()=>{
  const first=await store.save(value());
  assert.deepEqual(await store.deliverReceiptConfirmation(first.receiptId,async()=>({state:'blocked'})),{status:'queued',blocked:true});
  const second=await store.save(value());let calls=0;
  const sender=async()=>{calls+=1;return{state:'retry',retryAfterSeconds:60};};
  assert.equal((await store.deliverReceiptConfirmation(second.receiptId,sender)).status,'queued');
  assert.equal((await store.deliverReceiptConfirmation(second.receiptId,sender)).status,'queued');assert.equal(calls,1);
});

check('hackathon native: API keeps saved receipt when delivery fails, and reports provider acceptance accurately',async()=>{
  assert.equal((await processHackathonRequest({method:'GET'},{env,pool})).status,200);
  const submission=input();
  const saved=await processHackathonRequest(request(submission),{env,pool,sender:async()=>{throw new Error('provider secret');}});
  assert.equal(saved.status,201);assert.equal(saved.body.confirmationEmail,'unknown');
  const repeated=await processHackathonRequest(request(submission),{env,pool});assert.equal(repeated.body.receiptId,saved.body.receiptId);
  assert.equal((await processHackathonRequest(request({...submission,email:'different@example.invalid'}),{env,pool})).status,409);
  const accepted=await processHackathonRequest(request(input()),{env,pool,sender:async()=>({state:'accepted',messageId:'fictional'})});
  assert.equal(accepted.body.confirmationEmail,'sent');
  const blocked=await processHackathonRequest(request(input()),{env,pool,sender:async()=>({state:'blocked'})});assert.equal(blocked.body.confirmationEmail,'disabled');
});
