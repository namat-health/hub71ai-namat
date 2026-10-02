// Native integration evidence only: explicit loopback database, isolated random
// schema, no provider/storage network calls and no application records changed.
import {after,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import {createReportStore} from '../services/report-processing/store.mjs';

const url=process.env.REPORT_TEST_DATABASE_URL;
if (url&&!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)) throw new Error('Report tests require a loopback database.');
const enabled=Boolean(url),schema=`report_test_${randomUUID().replaceAll('-','')}`;
const scoped=sql=>sql.replaceAll('public.',`${schema}.`);
let admin,native,pool,store;
before(async()=>{
  if (!enabled) return;
  admin=new pg.Pool({connectionString:url,max:1});await admin.query(`CREATE SCHEMA ${schema}`);
  native=new pg.Pool({connectionString:url,max:12});
  pool={query:(sql,params)=>native.query(scoped(sql),params),connect:async()=>{
    const client=await native.connect();return {query:(sql,params)=>client.query(scoped(sql),params),release:()=>client.release()};
  }};
  await pool.query(readFileSync(new URL('../src/hackathon/db/001_welcome_submissions.sql',import.meta.url),'utf8'));
  await pool.query(readFileSync(new URL('../services/report-processing/db/002_report_processing.sql',import.meta.url),'utf8'));
  store=createReportStore(pool);
});
beforeEach(async()=>{
  if (enabled) await pool.query(`TRUNCATE public.namat_report_reviews,public.namat_report_extractions,public.namat_report_jobs,
    public.namat_reports,public.namat_report_sessions,public.namat_report_ocr_budget,public.hackathon_email_outbox,public.hackathon_welcome_submissions CASCADE`);
});
after(async()=>{
  await native?.end();
  if (admin) { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end(); }
});
const check=(name,fn)=>test(`report processing native: ${name}`,{skip:!enabled},fn);
const digest=value=>createHash('sha256').update(value).digest('hex');
async function session() {
  const token=randomUUID(),tokenHash=digest(token),result=await store.createSession(tokenHash);
  return {...result,token,tokenHash};
}
async function uploaded(owner=undefined,overrides={}) {
  owner??=await session();
  const meta={name:`fictional-${randomUUID()}.pdf`,mime:'application/pdf',size:123,sha256:digest(randomUUID()),...overrides};
  const row=await store.createReport(owner.id,meta);
  return {owner,report:await store.markUploaded(row.id,owner.id,{...row,blobKey:`reports/${row.id}`})};
}
async function submission(client=pool) {
  const submissionId=randomUUID();
  await client.query(`INSERT INTO public.hackathon_welcome_submissions
    (id,request_id,receipt_id,questionnaire_version,data_class,fictional_confirmed,answers,notes,fingerprint,email,first_name,report_metadata,report_files,report_total_size)
    VALUES ($1,$2,$3,'namat-hackathon-welcome-v1','synthetic',true,'{}','{}',$4,'fictional@example.invalid','Fictional','[]',ARRAY[]::bytea[],0)`,
  [submissionId,randomUUID(),randomUUID(),digest(submissionId)]);
  return submissionId;
}
async function link(upload,submissionId=undefined) {
  submissionId??=await submission();const client=await pool.connect();
  try { await client.query('BEGIN');await store.linkReports(client,submissionId,upload.owner.id,[upload.report.id]);await client.query('COMMIT'); }
  catch(error) { await client.query('ROLLBACK');throw error; }
  finally { client.release(); }
  return submissionId;
}
const output={processorVersion:'synthetic-parser-v1',pages:[{number:1,text:'Glucose 90 mg/dL'}],
  observations:[{name:'Glucose',value:'90',unit:'mg/dL',referenceRange:null,date:null,page:1,sourceText:'Glucose 90 mg/dL'}],warnings:[]};
async function ready() {
  const upload=await uploaded(),submissionId=await link(upload),job=await store.claimJob();
  const result=await store.completeJob(job,output);
  return {...upload,submissionId,job,extraction:result.extraction};
}

check('session authorization does not expose uploads to another session or an expired token',async()=>{
  const a=await session(),b=await session(),upload=await uploaded(a);
  assert.equal(await store.authorizeSession(a.id,a.tokenHash),true);
  assert.equal(await store.authorizeSession(a.id,b.tokenHash),false);
  assert.equal(await store.authorizeSession('not-an-id',a.tokenHash),false);
  assert.equal(await store.getReport(upload.report.id,b.id),null);
  await assert.rejects(store.markUploaded(upload.report.id,b.id,upload.report),{code:'report_not_found'});
  await pool.query("UPDATE public.namat_report_sessions SET created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE id=$1",[a.id]);
  assert.equal(await store.authorizeSession(a.id,a.tokenHash),false);
  assert.equal(await store.getReport(upload.report.id,a.id),null);
  await assert.rejects(store.createReport(a.id,{name:'another.pdf',mime:'application/pdf',size:2,sha256:digest('two')}),{code:'session_expired'});
});

check('concurrent metadata retries produce one upload and concurrent distinct files cannot bypass quota',async()=>{
  const owner=await session(),meta={name:'repeat.pdf',mime:'application/pdf',size:10,sha256:digest('same')};
  const identical=await Promise.all(Array.from({length:12},()=>store.createReport(owner.id,meta)));
  assert.equal(new Set(identical.map(row=>row.id)).size,1);
  const distinct=await Promise.allSettled(Array.from({length:8},(_,i)=>store.createReport(owner.id,{...meta,name:`file-${i}.pdf`,sha256:digest(String(i))})));
  assert.equal(distinct.filter(result=>result.status==='fulfilled').length,2);
  assert.ok(distinct.filter(result=>result.status==='rejected').every(result=>result.reason.code==='report_limit'));
  assert.equal((await pool.query('SELECT count(*)::integer AS n FROM public.namat_reports')).rows[0].n,3);
  await assert.rejects(store.createReport((await session()).id,{...meta,size:10485761}),{code:'invalid_report'});
});

check('upload completion verifies fixed bytes and remains repeat-safe without scheduling unsubmitted work',async()=>{
  const owner=await session(),row=await store.createReport(owner.id,{name:'sample.pdf',mime:'application/pdf',size:10,sha256:digest('same')});
  const completed={...row,blobKey:`reports/${row.id}`};
  await assert.rejects(store.markUploaded(row.id,owner.id,{...completed,size:11}),{code:'upload_mismatch'});
  await assert.rejects(store.markUploaded(row.id,owner.id,{...completed,sha256:digest('changed')}),{code:'upload_mismatch'});
  await assert.rejects(store.markUploaded(row.id,owner.id,{...row,blobKey:'different'}),{code:'upload_mismatch'});
  const saved=await store.markUploaded(row.id,owner.id,completed);
  assert.equal(saved.status,'queued');assert.equal(saved.blobKey,`reports/${row.id}`);assert.deepEqual(await store.markUploaded(row.id,owner.id,completed),saved);
  assert.equal((await pool.query('SELECT 1 FROM public.namat_report_jobs')).rowCount,0);
  assert.equal(await store.claimJob(),null);
  const invalid=await store.createReport(owner.id,{name:'bad.pdf',mime:'application/pdf',size:20,sha256:digest('bad')});
  assert.equal((await store.markRejected(invalid.id,owner.id,'invalid_pdf')).status,'rejected');
  await assert.rejects(store.markUploaded(invalid.id,owner.id,{...invalid,blobKey:`reports/${invalid.id}`}),{code:'upload_not_available'});
});

check('submission links and jobs are invisible until commit and all roll back after a queue failure',async()=>{
  const upload=await uploaded(),client=await pool.connect();let created;
  try {
    await client.query('BEGIN');created=await submission(client);
    await store.linkReports(client,created,upload.owner.id,[upload.report.id]);
    assert.equal((await pool.query('SELECT 1 FROM public.namat_report_jobs')).rowCount,0);
    assert.equal(await store.claimJob(),null);
    await client.query('ROLLBACK');
    assert.equal((await pool.query('SELECT 1 FROM public.hackathon_welcome_submissions WHERE id=$1',[created])).rowCount,0);
    assert.equal((await store.getReport(upload.report.id)).submissionId,null);
    await client.query('BEGIN');created=await submission(client);
    const failing={query(sql,params){if (sql.startsWith('INSERT INTO public.namat_report_jobs')) throw new Error('injected job failure');return client.query(sql,params);}};
    await assert.rejects(store.linkReports(failing,created,upload.owner.id,[upload.report.id]),/injected/);
    await client.query('ROLLBACK');
    assert.equal((await pool.query('SELECT 1 FROM public.hackathon_welcome_submissions WHERE id=$1',[created])).rowCount,0);
    assert.equal((await store.getReport(upload.report.id)).submissionId,null);
  } finally { client.release(); }
  const committed=await link(upload);
  assert.equal((await store.claimJob()).reportId,upload.report.id);
  await link(upload,committed); // Existing receipt replay neither creates another job nor changes ownership.
  assert.equal((await pool.query('SELECT 1 FROM public.namat_report_jobs')).rowCount,1);
  await assert.rejects(link(upload,await submission()),{code:'reports_not_available'});
});

check('concurrent workers claim once; crashed lease is reclaimed and stale worker output is rejected',async()=>{
  const upload=await uploaded();await link(upload);
  const claimed=(await Promise.all(Array.from({length:8},()=>store.claimJob()))).filter(Boolean);
  assert.equal(claimed.length,1);assert.equal(claimed[0].attempts,1);
  await pool.query("UPDATE public.namat_report_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",[claimed[0].id]);
  const restarted=createReportStore(pool),replacement=await restarted.claimJob();
  assert.equal(replacement.id,claimed[0].id);assert.notEqual(replacement.leaseToken,claimed[0].leaseToken);assert.equal(replacement.attempts,2);
  assert.deepEqual(await store.completeJob(claimed[0],output),{completed:false});
  assert.deepEqual(await store.failJob(claimed[0],'processing_failed'),{updated:false});
  const finished=await restarted.completeJob(replacement,output);assert.equal(finished.completed,true);
  assert.deepEqual(await restarted.completeJob(replacement,output),{completed:false});
  const row=await store.getReport(upload.report.id);assert.equal(row.status,'ready');assert.equal(row.pageCount,1);
  assert.equal((await pool.query('SELECT 1 FROM public.namat_report_extractions')).rowCount,1);
  assert.equal((await pool.query('SELECT 1 FROM public.namat_report_reviews')).rowCount,0); // Ready is not approved.
});

check('retry delay prevents a hot loop and a final crashed attempt becomes visible as failed',async()=>{
  const upload=await uploaded();await link(upload);
  const first=await store.claimJob();assert.deepEqual(await store.failJob(first,'ocr_unavailable',{retryable:true}),{updated:true,status:'queued'});
  assert.equal(await store.claimJob(),null);
  await pool.query("UPDATE public.namat_report_jobs SET available_at=now()-interval '1 second' WHERE id=$1",[first.id]);
  const second=await store.claimJob();assert.equal(second.attempts,2);
  await pool.query("UPDATE public.namat_report_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",[second.id]);
  const third=await store.claimJob();assert.equal(third.attempts,3);
  await pool.query("UPDATE public.namat_report_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",[third.id]);
  assert.equal(await store.claimJob(),null);
  assert.equal((await store.getReport(upload.report.id)).status,'failed');
  assert.equal((await store.getReport(upload.report.id)).errorCode,'attempts_exhausted');
});

check('review requires the exact latest extraction and revision, preserves corrections, and does not mutate source output',async()=>{
  const completed=await ready(),base={extractionId:completed.extraction.id,observations:output.observations,decision:'approved',expectedReviewRevision:0};
  await assert.rejects(store.saveReview(completed.report.id,{...base,extractionId:randomUUID()},'reviewer-a'),{code:'stale_extraction'});
  const corrected=[{...output.observations[0],value:'91'}];
  const first=await store.saveReview(completed.report.id,{...base,observations:corrected,decision:'corrected'},'reviewer-a');assert.equal(first.revision,1);
  await assert.rejects(store.saveReview(completed.report.id,base,'reviewer-b'),{code:'stale_review'});
  const second=await store.saveReview(completed.report.id,{...base,observations:corrected,expectedReviewRevision:1},'reviewer-b');assert.equal(second.revision,2);
  const caseRecord=await store.getCase(completed.submissionId);
  assert.deepEqual(caseRecord.reports[0].extractions[0].observations,output.observations);
  assert.equal(caseRecord.reports[0].reviews.length,2);assert.equal(caseRecord.reports[0].reviews[0].decision,'approved');
  await assert.rejects(pool.query("UPDATE public.namat_report_extractions SET observations='[]' WHERE id=$1",[completed.extraction.id]),{code:'23514'});
  await assert.rejects(pool.query("UPDATE public.namat_report_reviews SET decision='approved' WHERE id=$1",[first.id]),{code:'23514'});
});

check('simultaneous reviews cannot both approve the same stale revision',async()=>{
  const completed=await ready(),input={extractionId:completed.extraction.id,observations:output.observations,decision:'approved',expectedReviewRevision:0};
  const results=await Promise.allSettled([store.saveReview(completed.report.id,input,'reviewer-a'),store.saveReview(completed.report.id,input,'reviewer-b')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.code,'stale_review');
});

check('only linked cases appear; expiry finds orphans and removes all derived records while preserving other cases',async()=>{
  const orphan=await uploaded(),completed=await ready();
  assert.equal((await store.listCases()).length,1);
  assert.equal(await store.deleteExpiredReport(completed.report.id),false);
  assert.equal((await store.expiredReports()).length,0);
  await pool.query("UPDATE public.namat_report_sessions SET created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE id=$1",[orphan.owner.id]);
  assert.deepEqual((await store.expiredReports()).map(r=>r.id),[orphan.report.id]);
  await assert.rejects(link(orphan),{code:'session_expired'});
  assert.equal(await store.deleteExpiredReport(orphan.report.id),true);
  assert.equal((await store.listCases()).length,1);
  await store.saveReview(completed.report.id,{extractionId:completed.extraction.id,observations:output.observations,decision:'approved',expectedReviewRevision:0},'reviewer');
  await pool.query("UPDATE public.namat_reports SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1",[completed.report.id]);
  assert.equal((await store.expiredReports())[0].id,completed.report.id);
  assert.equal(await store.deleteExpiredReport(completed.report.id),true);
  for (const table of ['namat_report_extractions','namat_report_reviews','namat_report_jobs']) assert.equal((await pool.query(`SELECT 1 FROM public.${table}`)).rowCount,0);
  assert.equal(await store.getCase(completed.submissionId),null);
});

check('parallel OCR reservations and a restarted worker share one enforced UTC daily cap',async()=>{
  const reserved=await Promise.all(Array.from({length:12},()=>store.reserveOcrPages(25,200)));
  assert.equal(reserved.filter(Boolean).length,8);
  assert.equal((await pool.query('SELECT pages FROM public.namat_report_ocr_budget')).rows[0].pages,200);
  assert.equal(await createReportStore(pool).reserveOcrPages(1,200),false);
  assert.equal(await store.reserveOcrPages(1,0),false);
  await assert.rejects(store.reserveOcrPages(51,200),{code:'invalid_ocr_budget'});
});

check('an explicit retry reuses a failed report and job, preserves the failure, and lets a restarted worker finish',async()=>{
  const upload=await uploaded();await link(upload);
  const failed=await store.claimJob();await store.failJob(failed,'ocr_unavailable');
  const retry=await createReportStore(pool).retryReport(upload.report.id);
  assert.equal(retry.id,upload.report.id);assert.equal(retry.status,'queued');assert.equal(retry.errorCode,null);
  const {rows:[row]}=await pool.query('SELECT * FROM public.namat_report_jobs WHERE id=$1',[failed.id]);
  assert.equal(row.attempts,0);assert.equal(row.manual_retries,1);assert.equal(row.last_failure_code,'ocr_unavailable');
  assert.ok(row.last_retry_at);assert.equal(row.completed_at,null);assert.equal(row.lease_token,null);
  const recovered=await createReportStore(pool).claimJob();assert.equal(recovered.id,failed.id);assert.equal(recovered.attempts,1);
  assert.equal((await store.completeJob(recovered,output)).completed,true);
  assert.equal((await pool.query('SELECT 1 FROM public.namat_reports')).rowCount,1);
  assert.equal((await pool.query('SELECT 1 FROM public.namat_report_jobs')).rowCount,1);
  assert.equal((await pool.query('SELECT 1 FROM public.namat_report_extractions')).rowCount,1);
  await assert.rejects(store.retryReport(upload.report.id),{code:'retry_not_available'});
});

check('simultaneous operator retries queue once and no more than three manual cycles are allowed',async()=>{
  const upload=await uploaded();await link(upload);
  let job=await store.claimJob();await store.failJob(job,'processing_unavailable');
  const attempts=await Promise.allSettled(Array.from({length:6},()=>store.retryReport(upload.report.id)));
  assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);
  assert.ok(attempts.filter(result=>result.status==='rejected').every(result=>result.reason.code==='retry_not_available'));
  for(let manual=1;manual<=3;manual++){
    job=await store.claimJob();assert.equal(job.attempts,1);await store.failJob(job,'ocr_unavailable');
    assert.equal((await pool.query('SELECT manual_retries FROM public.namat_report_jobs WHERE id=$1',[job.id])).rows[0].manual_retries,manual);
    if(manual<3)await store.retryReport(upload.report.id);
  }
  await assert.rejects(createReportStore(pool).retryReport(upload.report.id),{code:'retry_limit'});
  assert.equal((await store.getReport(upload.report.id)).status,'failed');assert.equal(await store.claimJob(),null);
});

check('retry rejects unsubmitted, queued, processing, successful and expired reports without changing their work',async()=>{
  const upload=await uploaded();await assert.rejects(store.retryReport(upload.report.id),{code:'retry_not_available'});
  await link(upload);await assert.rejects(store.retryReport(upload.report.id),{code:'retry_not_available'});
  const active=await store.claimJob();await assert.rejects(store.retryReport(upload.report.id),{code:'retry_not_available'});
  await store.completeJob(active,output);await assert.rejects(store.retryReport(upload.report.id),{code:'retry_not_available'});
  const expired=await uploaded();await link(expired);
  const failed=await store.claimJob();await store.failJob(failed,'ocr_unavailable');
  await pool.query("UPDATE public.namat_reports SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1",[expired.report.id]);
  await assert.rejects(store.retryReport(expired.report.id),{code:'retry_not_available'});
  assert.equal((await pool.query('SELECT manual_retries FROM public.namat_report_jobs WHERE id=$1',[failed.id])).rows[0].manual_retries,0);
});
