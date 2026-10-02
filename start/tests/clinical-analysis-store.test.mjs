import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createClinicalAnalysisStore,AnalysisStoreError,ANALYSIS_BUDGET_MICROS} from '../services/clinical-analysis/store.mjs';
import {analysisStoreResponse,MAX_ANALYSIS_STORE_BYTES} from '../services/clinical-analysis/http.mjs';
import {portalRoute} from '../src/hackathon/server/shared-api.mjs';

// A query-script double checks transaction boundaries and locks; native
// concurrency/constraints run separately only on an explicit loopback database.
function scripted(steps) {
  let released=0;
  const queries=[];
  const query=async(sql,params=[])=>{
    queries.push({sql,params});
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
    const next=steps.shift();assert.ok(next,`Unexpected query: ${sql}`);assert.match(sql,next.match);
    next.inspect?.(sql,params);
    if(next.error)throw next.error;
    return {rows:next.rows??[]};
  };
  const store=createClinicalAnalysisStore({query,connect:async()=>({query,release(){released++;}})});
  return {store,queries,done(){assert.equal(steps.length,0);assert.ok(released>0);}};
}
const lock={match:/SELECT limit_micros.+FOR UPDATE/,rows:[{limit_micros:20000000}]};
const totals=(spent=0,reserved=0)=>({match:/SUM\(actual_micros\)/,rows:[{spent,reserved}]});
const ledger=(reservationId,amount,actual=null)=>({id:reservationId,reserved_micros:String(amount),actual_micros:actual===null?null:String(actual)});

test('analysis budget reserves the full upper bound before dispatch and refuses cumulative overflow',async()=>{
  const reservationId=randomUUID(),fixture=scripted([lock,{match:/namat_analysis_spend WHERE id/,rows:[]},totals(19000000),
    {match:/INSERT INTO public.namat_analysis_spend/,rows:[ledger(reservationId,1000000)],inspect:(_,args)=>assert.deepEqual(args,[reservationId,'hackathon-2026',1000000])},totals(19000000,1000000),
    lock,{match:/namat_analysis_spend WHERE id/,rows:[]},totals(19000000,1000000)]);
  const first=await fixture.store.reserve({reservationId,amountMicros:1000000});
  assert.equal(first.budget.remainingMicros,0);assert.equal(first.status,'reserved');
  await assert.rejects(fixture.store.reserve({reservationId:randomUUID(),amountMicros:1}),error=>error.code==='analysis_budget_exhausted'&&error.status===402);
  assert.equal(fixture.queries.at(-1).sql,'ROLLBACK');fixture.done();
});

test('uncertain spend remains reserved and reservation replay never doubles the ledger',async()=>{
  const reservationId=randomUUID(),saved=ledger(reservationId,90000),fixture=scripted([lock,{match:/namat_analysis_spend WHERE id/,rows:[saved]},totals(0,90000),
    lock,{match:/namat_analysis_spend WHERE id/,rows:[saved]}]);
  assert.equal((await fixture.store.reserve({reservationId,amountMicros:90000})).budget.reservedMicros,90000);
  await assert.rejects(fixture.store.reserve({reservationId,amountMicros:80000}),{code:'reservation_conflict'});
  assert.equal(fixture.queries.some(query=>query.sql.startsWith('INSERT')),false);fixture.done();
});

test('known usage settles once, frees unused reservation, and conflicting retries fail',async()=>{
  const reservationId=randomUUID(),fixture=scripted([lock,{match:/namat_analysis_spend WHERE id.+FOR UPDATE/,rows:[ledger(reservationId,100000)]},
    {match:/UPDATE public.namat_analysis_spend/,rows:[ledger(reservationId,100000,30000)]},totals(30000),
    lock,{match:/namat_analysis_spend WHERE id.+FOR UPDATE/,rows:[ledger(reservationId,100000,30000)]},totals(30000),
    lock,{match:/namat_analysis_spend WHERE id.+FOR UPDATE/,rows:[ledger(reservationId,100000,30000)]}]);
  const settled=await fixture.store.settle({reservationId,actualMicros:30000});
  assert.equal(settled.budget.remainingMicros,ANALYSIS_BUDGET_MICROS-30000);
  assert.equal((await fixture.store.settle({reservationId,actualMicros:30000})).status,'settled');
  await assert.rejects(fixture.store.settle({reservationId,actualMicros:0}),{code:'settlement_conflict'});fixture.done();
});

test('actual overrun is recorded honestly and stops future work',async()=>{
  const reservationId=randomUUID(),fixture=scripted([lock,{match:/namat_analysis_spend WHERE id.+FOR UPDATE/,rows:[ledger(reservationId,100)]},
    {match:/UPDATE public.namat_analysis_spend/,rows:[ledger(reservationId,100,200)]},totals(20000100)]);
  const saved=await fixture.store.settle({reservationId,actualMicros:200});assert.equal(saved.budget.overrun,true);assert.equal(saved.budget.remainingMicros,0);fixture.done();
});

const submissionId=randomUUID(),reportId=randomUUID(),extractionId=randomUUID(),runId=randomUUID();
const fingerprint='a'.repeat(64),cacheKey='b'.repeat(64),answers={age:'45',history:['none']};
const inputSnapshot={questionnaireVersion:'namat-hackathon-welcome-v2',answers,notes:{},reports:[{reportId,extractionId,reviewRevision:0}]};
const submission={id:submissionId,questionnaire_version:inputSnapshot.questionnaireVersion,answers,notes:{},legacy_report_count:0,report_metadata:[],expires_at:new Date(Date.now()+86400_000)};
const analysis={caseFingerprint:fingerprint,plan:{tests:[{id:'test:ferritin'}]},grounding:{evidenceIds:['source:1']}};
const row={id:runId,submission_id:submissionId,cache_key:cacheKey,case_fingerprint:fingerprint,input_snapshot:inputSnapshot,analysis,metadata:{model:'offline'},evaluated_at:new Date(),expires_at:new Date(Date.now()+3600_000)};
const live={match:/hackathon_welcome_submissions.+/s,rows:[submission],inspect:sql=>{assert.match(sql,/data_class='synthetic'/);assert.match(sql,/fictional_confirmed=TRUE/);assert.match(sql,/FOR UPDATE/);}};
const reports={match:/SELECT id,status,sha256 FROM public.namat_reports.+FOR UPDATE/,rows:[{id:reportId,status:'ready'}]};
const extraction={match:/SELECT e.id,/,rows:[{id:extractionId,revision:0}]};
const get={match:/SELECT \* FROM public.namat_analysis_runs WHERE submission_id/,rows:[row]};

test('clinician decisions reject changed report revisions even with the old fingerprint echoed',async()=>{
  const fixture=scripted([live,get,reports,{...extraction,rows:[{id:extractionId,revision:1}]}]);
  await assert.rejects(fixture.store.saveDecision({submissionId,runId,caseFingerprint:fingerprint,actor:'doctor@example.invalid',selectedTestIds:['test:ferritin'],decision:'approved'}),{code:'stale_analysis'});
  assert.equal(fixture.queries.some(query=>query.sql.startsWith('INSERT')),false);fixture.done();
});

test('clinician decisions reject invented tests and never treat an unselected test as approved',async()=>{
  const fixture=scripted([live,get,reports,extraction,live,get,reports,extraction,
    {match:/INSERT INTO public.namat_analysis_decisions/,inspect:(_,params)=>assert.equal(params[5],'[]'),rows:[{id:randomUUID(),run_id:runId,submission_id:submissionId,case_fingerprint:fingerprint,actor:'doctor@example.invalid',selected_test_ids:[],decision:'approved',notes:''}]}]);
  await assert.rejects(fixture.store.saveDecision({submissionId,runId,caseFingerprint:fingerprint,actor:'doctor@example.invalid',selectedTestIds:['invented'],decision:'approved'}),{code:'invalid_selection'});
  const saved=await fixture.store.saveDecision({submissionId,runId,caseFingerprint:fingerprint,actor:'doctor@example.invalid',selectedTestIds:[],decision:'approved'});
  assert.deepEqual(saved.selectedTestIds,[]);fixture.done();
});

test('changed questionnaire data and cross-submission run access fail before decisions are written',async()=>{
  const fixture=scripted([{...live,rows:[{...submission,answers:{age:'46'}}]},get,live,{...get,rows:[]}]);
  const value={submissionId,runId,caseFingerprint:fingerprint,actor:'doctor@example.invalid',selectedTestIds:[],decision:'approved'};
  await assert.rejects(fixture.store.saveDecision(value),{code:'stale_analysis'});
  await assert.rejects(fixture.store.saveDecision(value),{code:'analysis_not_found'});fixture.done();
});

test('cache hits are time bounded and stale inputs produce a cache miss',async()=>{
  const fixture=scripted([live,{...get,inspect:sql=>assert.match(sql,/expires_at>GREATEST\(now\(\),\$3::timestamptz\)/)},reports,{...extraction,rows:[{id:extractionId,revision:2}]}]);
  assert.equal(await fixture.store.findRun({submissionId,cacheKey}),null);fixture.done();
});

test('inventory attestation binds the exact current extraction and review and is idempotent',async()=>{
  const stored={id:randomUUID(),submission_id:submissionId,report_id:reportId,extraction_id:extractionId,review_revision:0,actor:'doctor@example.invalid',created_at:new Date()};
  const report={match:/SELECT id FROM public.namat_reports.+FOR UPDATE/,rows:[{id:reportId}]};
  const fixture=scripted([live,report,extraction,{match:/SELECT \* FROM public.namat_analysis_inventory_reviews/,rows:[]},
    {match:/INSERT INTO public.namat_analysis_inventory_reviews/,rows:[stored],inspect:(_,params)=>assert.deepEqual(params.slice(1),[submissionId,reportId,extractionId,0,'doctor@example.invalid'])},
    live,report,extraction,{match:/SELECT \* FROM public.namat_analysis_inventory_reviews/,rows:[stored]}]);
  const value={submissionId,reportId,extractionId,reviewRevision:0,actor:'doctor@example.invalid'};
  const first=await fixture.store.saveInventoryReview(value),retry=await fixture.store.saveInventoryReview(value);
  assert.equal(first.id,retry.id);assert.equal(first.reviewRevision,0);assert.equal(first.extractionId,extractionId);fixture.done();
});

test('inventory confirmation rejects a corrected source and reads only current active signatures',async()=>{
  const fixture=scripted([live,{match:/SELECT id FROM public.namat_reports.+FOR UPDATE/,rows:[{id:reportId}]},{...extraction,rows:[{id:extractionId,revision:1}]},
    live,{match:/SELECT i\.\* FROM public.namat_analysis_inventory_reviews/,rows:[],inspect:sql=>{assert.match(sql,/latest.id=i.extraction_id/);assert.match(sql,/i.review_revision=\(SELECT COALESCE\(MAX\(revision\),0\)/);assert.match(sql,/r.expires_at>now\(\)/);}}]);
  await assert.rejects(fixture.store.saveInventoryReview({submissionId,reportId,extractionId,reviewRevision:0,actor:'doctor@example.invalid'}),{code:'stale_inventory_review'});
  assert.deepEqual(await fixture.store.getInventoryReviews({submissionId}),[]);fixture.done();
});

test('run persistence retains full analysis and provenance without an update path',async()=>{
  const fixture=scripted([live,reports,extraction,{match:/SELECT \* FROM public.namat_analysis_runs WHERE id/,rows:[]},
    {match:/INSERT INTO public.namat_analysis_runs/,rows:[row],inspect:(_,params)=>{assert.deepEqual(JSON.parse(params[5]),analysis);assert.deepEqual(JSON.parse(params[4]),inputSnapshot);}}]);
  const saved=await fixture.store.saveRun({id:runId,submissionId,cacheKey,caseFingerprint:fingerprint,inputSnapshot,analysis,metadata:row.metadata,evaluatedAt:row.evaluated_at.toISOString(),expiresAt:row.expires_at.toISOString()});
  assert.deepEqual(saved.analysis.grounding,analysis.grounding);fixture.done();
  const sql=readFileSync(new URL('../services/clinical-analysis/db/004_clinical_analysis.sql',import.meta.url),'utf8');
  assert.match(sql,/CREATE TRIGGER namat_analysis_runs_immutable BEFORE UPDATE/);assert.match(sql,/CREATE TRIGGER namat_analysis_decisions_immutable BEFORE UPDATE/);
  assert.match(sql,/FOREIGN KEY \(run_id,submission_id\)/);assert.match(sql,/limit_micros BETWEEN 0 AND 20000000/);
});

test('invalid amounts, snapshots and oversized payloads fail before accessing the database',async()=>{
  const store=createClinicalAnalysisStore({connect(){assert.fail('Database access not expected');}});
  for(const amountMicros of [0,-1,0.5,NaN,Number.MAX_SAFE_INTEGER+1])await assert.rejects(store.reserve({reservationId:randomUUID(),amountMicros}),{code:'invalid_amount'});
  await assert.rejects(store.saveDecision({submissionId,runId,caseFingerprint:fingerprint,actor:'fake\nactor',selectedTestIds:[],decision:'approved'}),{code:'invalid_decision'});
  await assert.rejects(store.saveRun({id:runId,submissionId,cacheKey,caseFingerprint:fingerprint,inputSnapshot:{...inputSnapshot,reports:[{...inputSnapshot.reports[0],reviewRevision:-1}]}}),{code:'invalid_snapshot'});
});

const request=body=>new Request('https://service.invalid/analysis-store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
test('internal HTTP uses a fixed operation set, overrides actor when supplied, and masks database details',async()=>{
  const store={async saveDecision(value){assert.equal(value.actor,'verified');return {id:runId};},async budget(){throw new Error('private database secret');}};
  const saved=await analysisStoreResponse(request({operation:'saveDecision',input:{actor:'forged'}}),{store,actor:'verified'});
  assert.equal(saved.status,200);assert.deepEqual(await saved.json(),{result:{id:runId}});
  assert.equal((await analysisStoreResponse(request({operation:'query',input:{}}),{store})).status,400);
  const failed=await analysisStoreResponse(request({operation:'budget',input:{}}),{store});assert.equal(failed.status,503);assert.deepEqual(await failed.json(),{error:'analysis_store_unavailable'});
  assert.deepEqual(portalRoute('/api/namat-portal/analysis-store','POST'),{kind:'analysis-store'});assert.equal(portalRoute('/api/namat-portal/analysis-store','GET'),null);
});

test('HTTP bounds chunked input and preserves typed conflict errors',async()=>{
  const store={async budget(){throw new AnalysisStoreError('stale_analysis');}};
  const stale=await analysisStoreResponse(request({operation:'budget',input:{}}),{store});assert.equal(stale.status,409);
  const large=new Request('https://service.invalid/store',{method:'POST',headers:{'Content-Type':'application/json'},body:'x'.repeat(MAX_ANALYSIS_STORE_BYTES+1)});
  assert.equal((await analysisStoreResponse(large,{store})).status,413);
});
