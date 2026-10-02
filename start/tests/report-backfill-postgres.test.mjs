// Loopback-only database tests in a disposable schema. Blob writes are an
// in-memory adapter; these tests cannot upload a report or send an email.
import {after,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import {backfillLegacyReports} from '../services/report-processing/backfill.mjs';
import {createReportStore} from '../services/report-processing/store.mjs';
import {inspectDocument} from '../services/report-processing/document.mjs';
import {pdf,png} from './hackathon-fixtures.mjs';

const url=process.env.REPORT_TEST_DATABASE_URL;
if(url&&!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw new Error('Report backfill tests require a loopback database.');
const enabled=Boolean(url),schema=`backfill_test_${randomUUID().replaceAll('-','')}`;
const scoped=sql=>sql.replaceAll('public.',`${schema}.`),digest=bytes=>createHash('sha256').update(bytes).digest('hex');
let admin,native,pool,store,objects,blobs;
before(async()=>{
  if(!enabled)return;
  admin=new pg.Pool({connectionString:url,max:1});await admin.query(`CREATE SCHEMA ${schema}`);
  native=new pg.Pool({connectionString:url,max:12});
  pool={query:(sql,params)=>native.query(scoped(sql),params),connect:async()=>{
    const client=await native.connect();return {query:(sql,params)=>client.query(scoped(sql),params),release:()=>client.release()};
  }};
  await pool.query(readFileSync(new URL('../src/hackathon/db/001_welcome_submissions.sql',import.meta.url),'utf8'));
  await pool.query(readFileSync(new URL('../src/hackathon/db/003_questionnaire_v2.sql',import.meta.url),'utf8'));
  await pool.query(readFileSync(new URL('../services/report-processing/db/002_report_processing.sql',import.meta.url),'utf8'));
  store=createReportStore(pool);
});
beforeEach(async()=>{
  if(!enabled)return;
  await pool.query('TRUNCATE public.namat_report_sessions,public.hackathon_welcome_submissions CASCADE');
  objects=new Map();blobs={async promote(id,bytes){const key=`reports/${id}`;objects.set(key,Buffer.from(bytes));return key;}};
});
after(async()=>{
  await native?.end();
  if(admin){await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
});
const check=(name,fn)=>test(`legacy report backfill native: ${name}`,{skip:!enabled},fn);
async function legacy(files=[{name:'fictional.pdf',type:'application/pdf',bytes:pdf()}]){
  const id=randomUUID(),receiptId=randomUUID(),fingerprint=digest(id);
  const metadata=files.map(({name,type,bytes})=>({name,type,size:bytes.length,sha256:digest(bytes)}));
  await pool.query(`INSERT INTO public.hackathon_welcome_submissions
    (id,request_id,receipt_id,questionnaire_version,data_class,fictional_confirmed,answers,notes,fingerprint,email,first_name,report_metadata,report_files,report_total_size)
    VALUES($1,$2,$3,'namat-hackathon-welcome-v1','synthetic',true,'{}','{}',$4,'fictional@example.invalid','Fictional',$5,$6,$7)`,
  [id,randomUUID(),receiptId,fingerprint,JSON.stringify(metadata),files.map(file=>file.bytes),files.reduce((sum,file)=>sum+file.bytes.length,0)]);
  await pool.query(`INSERT INTO public.hackathon_email_outbox
    (id,submission_id,reference,data_class,recipient_email,first_name,has_reports,status)
    VALUES($1,$2,$3,'synthetic','fictional@example.invalid','Fictional',true,'sent')`,[randomUUID(),id,receiptId]);
  return {id,receiptId,fingerprint,files,metadata};
}
const run=overrides=>backfillLegacyReports({pool,store,blobs,...overrides});
const rows=table=>pool.query(`SELECT * FROM public.${table}`).then(result=>result.rows);

check('preserves exact original bytes, receipt, fingerprint and email state and schedules one job once',async()=>{
  const input=await legacy(),before=(await rows('hackathon_welcome_submissions'))[0],emailBefore=await rows('hackathon_email_outbox');
  assert.deepEqual(await run(),{migrated:1,skipped:0,failed:0});
  assert.deepEqual((await rows('hackathon_welcome_submissions'))[0],before);
  assert.deepEqual(await rows('hackathon_email_outbox'),emailBefore);
  const reports=await rows('namat_reports');assert.equal(reports.length,1);assert.equal(reports[0].submission_id,input.id);
  assert.equal(reports[0].sha256,digest(input.files[0].bytes));assert.ok(objects.get(reports[0].blob_key).equals(input.files[0].bytes));
  assert.equal((await rows('namat_report_jobs')).length,1);
  assert.deepEqual(await run(),{migrated:0,skipped:0,failed:0});
  assert.equal((await rows('namat_report_jobs')).length,1);assert.equal(objects.size,1);
});

check('hash disagreement fails before parsing or creating any new state',async()=>{
  const input=await legacy();
  await pool.query("UPDATE public.hackathon_welcome_submissions SET report_metadata=jsonb_set(report_metadata,'{0,sha256}',to_jsonb($2::text)) WHERE id=$1",[input.id,'0'.repeat(64)]);
  let inspections=0;
  assert.deepEqual(await run({inspect:async()=>{inspections++;}}),{migrated:0,skipped:0,failed:1});
  assert.equal(inspections,0);assert.equal(objects.size,0);assert.equal((await rows('namat_reports')).length,0);
  assert.equal((await rows('namat_report_sessions')).length,0);
});

check('identical legacy duplicates retain their original array and share one processing job',async()=>{
  const original={name:'duplicate.pdf',type:'application/pdf',bytes:pdf()},input=await legacy([original,original]);
  assert.deepEqual(await run(),{migrated:1,skipped:0,failed:0});
  const row=(await rows('hackathon_welcome_submissions'))[0];
  assert.equal(row.report_files.length,2);assert.ok(row.report_files.every(bytes=>bytes.equals(original.bytes)));
  assert.deepEqual(row.report_metadata,input.metadata);
  assert.equal((await rows('namat_report_jobs')).length,1);assert.equal(objects.size,1);
});

check('all report links and jobs roll back together if queue insertion fails',async()=>{
  const input=await legacy([{name:'one.pdf',type:'application/pdf',bytes:pdf()},{name:'two.png',type:'image/png',bytes:png()}]);
  const broken={...store,async linkReports(client,...args){let jobs=0;return store.linkReports({query(sql,params){
    if(sql.startsWith('INSERT INTO public.namat_report_jobs')&&++jobs===2)throw new Error('Injected queue failure');
    return client.query(sql,params);
  }},...args);}};
  assert.deepEqual(await run({store:broken}),{migrated:0,skipped:0,failed:1});
  assert.equal((await rows('namat_report_jobs')).length,0);
  const reports=await rows('namat_reports');assert.equal(reports.length,2);assert.ok(reports.every(report=>report.submission_id===null));
  assert.equal(objects.size,2,'detached copies remain eligible for existing expiry cleanup');
  assert.ok((await rows('hackathon_welcome_submissions'))[0].report_files.every((file,index)=>file.equals(input.files[index].bytes)));
});

check('racing backfills publish one linked report and one job',async()=>{
  await legacy();let inspected=0,release;
  const both=new Promise(resolve=>{release=resolve;});
  const inspect=async(...args)=>{await inspectDocument(...args);if(++inspected===2)release();await both;};
  const results=await Promise.all([run({inspect}),run({inspect})]);
  assert.equal(results.reduce((sum,result)=>sum+result.migrated,0),1);
  assert.equal(results.reduce((sum,result)=>sum+result.skipped,0),1);
  assert.equal(results.reduce((sum,result)=>sum+result.failed,0),0);
  assert.equal((await rows('namat_reports')).filter(report=>report.submission_id!==null).length,1);
  assert.equal((await rows('namat_report_jobs')).length,1);
});

check('expired originals are excluded and the batch limit is honored',async()=>{
  const expired=await legacy();
  await pool.query("UPDATE public.hackathon_welcome_submissions SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1",[expired.id]);
  await legacy();await legacy();
  assert.deepEqual(await run({limit:1}),{migrated:1,skipped:0,failed:0});
  assert.deepEqual(await run({limit:1}),{migrated:1,skipped:0,failed:0});
  assert.deepEqual(await run({limit:1}),{migrated:0,skipped:0,failed:0});
  assert.equal((await rows('namat_report_jobs')).length,2);
});
