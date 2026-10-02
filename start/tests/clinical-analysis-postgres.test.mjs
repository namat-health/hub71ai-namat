// Native checks are opt-in on a loopback database, in an isolated schema.
// They never connect to the application database or to a model provider.
import {after,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import {createClinicalAnalysisStore} from '../services/clinical-analysis/store.mjs';

const url=process.env.ANALYSIS_TEST_DATABASE_URL;
if(url&&!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw new Error('Analysis tests require a loopback database.');
const enabled=Boolean(url),schema=`analysis_test_${randomUUID().replaceAll('-','')}`;
const runtimeRole=`analysis_runtime_${randomUUID().replaceAll('-','')}`;
const scoped=sql=>sql.replaceAll('public.',`${schema}.`).replaceAll('namat_hackathon_runtime',runtimeRole);
let admin,native,pool,store,restrictedNative,restrictedPool,initialBudget;
before(async()=>{
  if(!enabled)return;
  admin=new pg.Pool({connectionString:url,max:1});
  await admin.query(`CREATE ROLE ${runtimeRole} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE`);
  await admin.query(`CREATE SCHEMA ${schema}`);
  native=new pg.Pool({connectionString:url,max:12});
  pool={query:(sql,params)=>native.query(scoped(sql),params),connect:async()=>{const client=await native.connect();return {query:(sql,params)=>client.query(scoped(sql),params),release:()=>client.release()};}};
  for(const path of ['../src/hackathon/db/001_welcome_submissions.sql','../services/report-processing/db/002_report_processing.sql','../src/hackathon/db/003_questionnaire_v2.sql','../services/clinical-analysis/db/004_clinical_analysis.sql'])await pool.query(readFileSync(new URL(path,import.meta.url),'utf8'));
  // Existing report/intake read and row-lock privileges; the new migration
  // supplies its own analysis grants and the additional submission row lock.
  await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO ${runtimeRole}`);
  await pool.query(`GRANT SELECT ON public.hackathon_welcome_submissions,public.namat_reports,public.namat_report_extractions,public.namat_report_reviews TO ${runtimeRole}`);
  await pool.query(`GRANT UPDATE (status) ON public.namat_reports TO ${runtimeRole}`);
  restrictedNative=new pg.Pool({connectionString:url,max:4,options:`-c role=${runtimeRole}`});
  restrictedPool={query:(sql,params)=>restrictedNative.query(scoped(sql),params),connect:async()=>{const client=await restrictedNative.connect();return {query:(sql,params)=>client.query(scoped(sql),params),release:()=>client.release()};}};
  store=createClinicalAnalysisStore(pool);
  initialBudget=await store.budget();
});
beforeEach(async()=>{
  if(!enabled)return;
  await pool.query('TRUNCATE public.namat_analysis_spend,public.hackathon_welcome_submissions,public.namat_report_sessions CASCADE');
  await pool.query("UPDATE public.namat_analysis_budget SET limit_micros=20000000 WHERE id='hackathon-2026'");
});
after(async()=>{await restrictedNative?.end();await native?.end();if(admin){await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.query(`DROP ROLE IF EXISTS ${runtimeRole}`);await admin.end();}});
const check=(name,fn)=>test(`analysis native: ${name}`,{skip:!enabled},fn);
const digest=value=>createHash('sha256').update(value).digest('hex');

async function fixture() {
  const submissionId=randomUUID(),reportId=randomUUID(),sessionId=randomUUID(),jobId=randomUUID(),extractionId=randomUUID();
  const answers={age:'45'},notes={};
  await pool.query(`INSERT INTO public.hackathon_welcome_submissions
    (id,request_id,receipt_id,questionnaire_version,data_class,fictional_confirmed,answers,notes,fingerprint,email,first_name,report_metadata,report_files,report_total_size)
    VALUES ($1,$2,$3,'namat-hackathon-welcome-v2','synthetic',true,$4::jsonb,'{}',$5,'fictional@example.invalid','Fictional','[]',ARRAY[]::bytea[],0)`,
  [submissionId,randomUUID(),randomUUID(),JSON.stringify(answers),digest(submissionId)]);
  await pool.query('INSERT INTO public.namat_report_sessions(id,token_hash) VALUES ($1,$2)',[sessionId,digest(sessionId)]);
  await pool.query(`INSERT INTO public.namat_reports(id,session_id,submission_id,name,mime,size,sha256,blob_key,status)
    VALUES ($1,$2,$3,'fictional.pdf','application/pdf',100,$4,$5,'ready')`,[reportId,sessionId,submissionId,digest(reportId),`reports/${reportId}`]);
  await pool.query("INSERT INTO public.namat_report_jobs(id,report_id,status) VALUES ($1,$2,'succeeded')",[jobId,reportId]);
  await pool.query(`INSERT INTO public.namat_report_extractions(id,report_id,job_id,processor_version,input_sha256,pages,observations)
    VALUES ($1,$2,$3,'fictional-v1',$4,'[{"number":1,"text":"Glucose 90 mg/dL"}]','[]')`,[extractionId,reportId,jobId,digest(reportId)]);
  const inputSnapshot={questionnaireVersion:'namat-hackathon-welcome-v2',answers,notes,reports:[{reportId,extractionId,reviewRevision:0}]};
  const caseFingerprint=digest(randomUUID()),now=Date.now();
  const value={id:randomUUID(),submissionId,cacheKey:digest(randomUUID()),caseFingerprint,inputSnapshot,
    analysis:{caseFingerprint,plan:{tests:[{id:'test:ferritin'}]},grounding:{evidenceIds:['observation:1']}},metadata:{model:'offline'},evaluatedAt:new Date(now).toISOString(),expiresAt:new Date(now+3600000).toISOString()};
  return {submissionId,reportId,extractionId,value};
}
const approve=value=>({submissionId:value.submissionId,runId:value.id,caseFingerprint:value.caseFingerprint,actor:'doctor@example.invalid',selectedTestIds:['test:ferritin'],decision:'approved'});

check('initial production budget excludes the ring-fenced five-dollar development allocation',async()=>{
  assert.deepEqual(initialBudget,{limitMicros:20000000,spentMicros:0,reservedMicros:5000000,remainingMicros:15000000,overrun:false});
});

check('concurrent reservations cannot cross the shared cap',async()=>{
  await pool.query("UPDATE public.namat_analysis_budget SET limit_micros=5 WHERE id='hackathon-2026'");
  const results=await Promise.allSettled(Array.from({length:20},()=>store.reserve({reservationId:randomUUID(),amountMicros:1})));
  assert.equal(results.filter(result=>result.status==='fulfilled').length,5);
  assert.ok(results.filter(result=>result.status==='rejected').every(result=>result.reason.code==='analysis_budget_exhausted'));
  assert.equal((await store.budget()).reservedMicros,5);
});

check('concurrent reservation and settlement retries are idempotent',async()=>{
  const reservationId=randomUUID();
  await Promise.all(Array.from({length:8},()=>store.reserve({reservationId,amountMicros:1000})));
  assert.equal((await store.budget()).reservedMicros,1000);
  await Promise.all(Array.from({length:8},()=>store.settle({reservationId,actualMicros:100})));
  assert.deepEqual(await store.budget(),{limitMicros:20000000,spentMicros:100,reservedMicros:0,remainingMicros:19999900,overrun:false});
});

check('run and decision are immutable and patient retention never restores spend',async()=>{
  const {value}=await fixture();await store.saveRun(value);
  const saved=await store.saveDecision(approve(value));
  assert.deepEqual(saved.selectedTestIds,['test:ferritin']);
  await assert.rejects(pool.query("UPDATE public.namat_analysis_runs SET metadata='{}' WHERE id=$1",[value.id]),/immutable/);
  await assert.rejects(pool.query("UPDATE public.namat_analysis_decisions SET notes='changed' WHERE id=$1",[saved.id]),/immutable/);
  const reservationId=randomUUID();await store.reserve({reservationId,amountMicros:100});await store.settle({reservationId,actualMicros:80});
  await pool.query('DELETE FROM public.hackathon_welcome_submissions WHERE id=$1',[value.submissionId]);
  assert.equal((await pool.query('SELECT count(*)::integer AS n FROM public.namat_analysis_runs')).rows[0].n,0);
  assert.equal((await store.budget()).spentMicros,80);
});

check('a review that commits while approval waits invalidates the old run',async()=>{
  const {value,reportId,extractionId}=await fixture();await store.saveRun(value);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');await client.query('SELECT id FROM public.namat_reports WHERE id=$1 FOR UPDATE',[reportId]);
    const pending=store.saveDecision(approve(value));
    await client.query(`INSERT INTO public.namat_report_reviews(id,report_id,extraction_id,revision,observations,decision,actor)
      VALUES ($1,$2,$3,1,'[]','needs_changes','doctor@example.invalid')`,[randomUUID(),reportId,extractionId]);
    await client.query('COMMIT');await assert.rejects(pending,{code:'stale_analysis'});
    assert.equal(await store.findRun({submissionId:value.submissionId,cacheKey:value.cacheKey}),null);
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
});

check('expired runs and changed questionnaire inputs cannot be approved',async()=>{
  const {value}=await fixture();value.expiresAt=new Date(Date.now()+500).toISOString();await store.saveRun(value);
  // Advancing the cache lookup clock never extends cache validity.
  assert.equal(await store.findRun({submissionId:value.submissionId,cacheKey:value.cacheKey,now:Date.now()+1000}),null);
  await pool.query('UPDATE public.hackathon_welcome_submissions SET answers=$2::jsonb WHERE id=$1',[value.submissionId,JSON.stringify({age:'46'})]);
  await assert.rejects(store.saveDecision(approve(value)),error=>['stale_analysis','analysis_not_found'].includes(error.code));
});

check('inventory confirmations are immutable and disappear from eligibility after any correction',async()=>{
  const {submissionId,reportId,extractionId}=await fixture();
  const input={submissionId,reportId,extractionId,reviewRevision:0,actor:'doctor@example.invalid'};
  const saved=await store.saveInventoryReview(input);
  assert.equal((await store.saveInventoryReview(input)).id,saved.id);
  assert.equal((await store.getInventoryReviews({submissionId})).length,1);
  await assert.rejects(pool.query("UPDATE public.namat_analysis_inventory_reviews SET actor='changed' WHERE id=$1",[saved.id]),/immutable/);
  await pool.query(`INSERT INTO public.namat_report_reviews(id,report_id,extraction_id,revision,observations,decision,actor)
    VALUES ($1,$2,$3,1,'[]','needs_changes','doctor@example.invalid')`,[randomUUID(),reportId,extractionId]);
  assert.deepEqual(await store.getInventoryReviews({submissionId}),[]);
  await assert.rejects(store.saveInventoryReview(input),{code:'stale_inventory_review'});
});

check('restricted runtime can reserve, save and decide but cannot reset the budget or rewrite history',async()=>{
  const restricted=createClinicalAnalysisStore(restrictedPool),{value,submissionId,reportId,extractionId}=await fixture();
  const identity=(await restrictedPool.query('SELECT current_user AS name')).rows[0];
  assert.equal(identity.name,runtimeRole);
  const reservationId=randomUUID();
  await restricted.reserve({reservationId,amountMicros:1000});
  await restricted.settle({reservationId,actualMicros:100});
  await restricted.saveInventoryReview({submissionId,reportId,extractionId,reviewRevision:0,actor:'doctor@example.invalid'});
  assert.equal((await restricted.getInventoryReviews({submissionId})).length,1);
  await restricted.saveRun(value);
  const saved=await restricted.saveDecision(approve(value));
  assert.equal((await restricted.getRun({submissionId,runId:value.id})).latestDecision.id,saved.id);
  assert.equal((await restricted.budget()).spentMicros,100);
  for(const sql of [
    'UPDATE public.namat_analysis_budget SET limit_micros=20000000',
    'DELETE FROM public.namat_analysis_spend',
    'UPDATE public.namat_analysis_spend SET reserved_micros=1',
    "UPDATE public.namat_analysis_runs SET metadata='{}'",
    "UPDATE public.namat_analysis_decisions SET notes='changed'",
    "UPDATE public.hackathon_welcome_submissions SET answers='{}'",
  ])await assert.rejects(restrictedPool.query(sql),error=>error.code==='42501');
});
