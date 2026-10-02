import {randomUUID} from 'node:crypto';

export const ANALYSIS_BUDGET_MICROS = 20_000_000;
const BUDGET = 'hackathon-2026';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
export class AnalysisStoreError extends Error {
  constructor(code,status=409) { super(code); this.name='AnalysisStoreError'; this.code=code; this.status=status; }
}
const fail=(code,status)=>{throw new AnalysisStoreError(code,status);};
const id=value=>{if(typeof value!=='string'||!UUID.test(value))fail('invalid_id',400);return value;};
const hash=value=>{if(typeof value!=='string'||!HASH.test(value))fail('invalid_hash',400);return value;};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const micros=(value,min=0)=>{if(!Number.isSafeInteger(value)||value<min)fail('invalid_amount',400);return value;};
const stamp=value=>{const ms=typeof value==='string'?Date.parse(value):NaN;if(!Number.isFinite(ms))fail('invalid_time',400);return new Date(ms).toISOString();};
const canonical=value=>Array.isArray(value)?value.map(canonical):object(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
function json(value,maxBytes) {
  if(!object(value))fail('invalid_payload',400);
  let text;try{text=JSON.stringify(value);}catch{fail('invalid_payload',400);}
  if(Buffer.byteLength(text)>maxBytes)fail('payload_too_large',413);
  return text;
}
function snapshot(value) {
  json(value,500_000);
  if(typeof value.questionnaireVersion!=='string'||value.questionnaireVersion.length>100||!object(value.answers)||!object(value.notes)||!Array.isArray(value.reports)||value.reports.length>3)fail('invalid_snapshot',400);
  const seen=new Set();
  for(const report of value.reports){
    id(report.reportId);id(report.extractionId);
    if(seen.has(report.reportId)||!Number.isInteger(report.reviewRevision)||report.reviewRevision<0)fail('invalid_snapshot',400);
    seen.add(report.reportId);
  }
  return value;
}
function reservation(row) {
  return {reservationId:row.id,amountMicros:Number(row.reserved_micros),actualMicros:row.actual_micros===null?null:Number(row.actual_micros),status:row.actual_micros===null?'reserved':'settled'};
}
function run(row) {
  return row?{id:row.id,submissionId:row.submission_id,cacheKey:row.cache_key,caseFingerprint:row.case_fingerprint,
    inputSnapshot:row.input_snapshot,analysis:row.analysis,metadata:row.metadata,evaluatedAt:row.evaluated_at,expiresAt:row.expires_at,createdAt:row.created_at}:null;
}
function decision(row) {
  return {id:row.id,submissionId:row.submission_id,runId:row.run_id,caseFingerprint:row.case_fingerprint,actor:row.actor,
    selectedTestIds:row.selected_test_ids,decision:row.decision,notes:row.notes,createdAt:row.created_at};
}
function inventoryReview(row) {
  return {id:row.id,reportId:row.report_id,extractionId:row.extraction_id,reviewRevision:row.review_revision,actor:row.actor,createdAt:row.created_at};
}

// This service is the only owner of analysis writes. The HTTP boundary must
// authenticate the portal service, and the portal must derive actor from login.
export function createClinicalAnalysisStore(pool) {
  async function transaction(fn) {
    const client=await pool.connect();
    try{await client.query('BEGIN');const value=await fn(client);await client.query('COMMIT');return value;}
    catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
    finally{client.release();}
  }
  async function lockBudget(client) {
    const {rows:[row]}=await client.query('SELECT limit_micros FROM public.namat_analysis_budget WHERE id=$1 FOR UPDATE',[BUDGET]);
    if(!row)fail('analysis_store_not_ready',503);
    const limit=Number(row.limit_micros);
    if(!Number.isSafeInteger(limit)||limit<0||limit>ANALYSIS_BUDGET_MICROS)fail('invalid_budget',503);
    return limit;
  }
  async function usage(client,limit) {
    const {rows:[row]}=await client.query(`SELECT COALESCE(SUM(actual_micros),0) AS spent,
      COALESCE(SUM(reserved_micros) FILTER(WHERE actual_micros IS NULL),0) AS reserved
      FROM public.namat_analysis_spend WHERE budget_id=$1`,[BUDGET]);
    const spentMicros=Number(row.spent),reservedMicros=Number(row.reserved);
    if(!Number.isSafeInteger(spentMicros)||!Number.isSafeInteger(reservedMicros))fail('invalid_budget',503);
    return {limitMicros:limit,spentMicros,reservedMicros,remainingMicros:Math.max(0,limit-spentMicros-reservedMicros),overrun:spentMicros+reservedMicros>limit};
  }
  async function liveSubmission(client,submissionId) {
    const {rows:[row]}=await client.query(`SELECT id,questionnaire_version,answers,notes,expires_at,report_metadata,cardinality(report_files) AS legacy_report_count
      FROM public.hackathon_welcome_submissions WHERE id=$1 AND data_class='synthetic' AND fictional_confirmed=TRUE AND expires_at>now() FOR UPDATE`,[id(submissionId)]);
    if(!row)fail('submission_not_found',404);
    return row;
  }
  async function assertCurrent(client,submission,inputSnapshot) {
    if(submission.questionnaire_version!==inputSnapshot.questionnaireVersion||!same(submission.answers,inputSnapshot.answers)||!same(submission.notes,inputSnapshot.notes))fail('stale_analysis');
    // saveReview locks the same report rows, so a correction cannot slip between
    // this comparison and inserting the clinician decision.
    const {rows:reports}=await client.query('SELECT id,status,sha256 FROM public.namat_reports WHERE submission_id=$1 AND expires_at>now() ORDER BY id FOR UPDATE',[submission.id]);
    if(reports.length!==inputSnapshot.reports.length||reports.some(report=>report.status!=='ready'))fail('stale_analysis');
    // Legacy originals are not accepted unless migrated into the report pipeline.
    const migratedHashes=new Set(reports.map(report=>report.sha256));
    if(submission.legacy_report_count>0&&(!Array.isArray(submission.report_metadata)||submission.report_metadata.slice(0,submission.legacy_report_count).some(report=>!migratedHashes.has(report.sha256))))fail('unprocessed_reports');
    for(const report of reports){
      const expected=inputSnapshot.reports.find(item=>item.reportId===report.id);
      if(!expected)fail('stale_analysis');
      const {rows:[latest]}=await client.query(`SELECT e.id,(SELECT COALESCE(MAX(revision),0)::integer FROM public.namat_report_reviews WHERE report_id=$1) AS revision
        FROM public.namat_report_extractions e WHERE e.report_id=$1 ORDER BY e.created_at DESC,e.id DESC LIMIT 1`,[report.id]);
      if(!latest||latest.id!==expected.extractionId||latest.revision!==expected.reviewRevision)fail('stale_analysis');
    }
  }
  async function liveRun(client,submissionId,runId) {
    const {rows:[row]}=await client.query('SELECT * FROM public.namat_analysis_runs WHERE submission_id=$1 AND id=$2 AND expires_at>now()',[id(submissionId),id(runId)]);
    if(!row)fail('analysis_not_found',404);
    return row;
  }
  return {
    async saveInventoryReview({submissionId,reportId,extractionId,reviewRevision,actor}={}) {
      id(submissionId);id(reportId);id(extractionId);
      if(!Number.isInteger(reviewRevision)||reviewRevision<0||typeof actor!=='string'||!actor.trim()||actor.length>256||/[\u0000-\u001f\u007f]/.test(actor))fail('invalid_inventory_review',400);
      return transaction(async client=>{
        await liveSubmission(client,submissionId);
        const {rows:[report]}=await client.query("SELECT id FROM public.namat_reports WHERE id=$1 AND submission_id=$2 AND status='ready' AND expires_at>now() FOR UPDATE",[reportId,submissionId]);
        if(!report)fail('report_not_ready');
        const {rows:[latest]}=await client.query(`SELECT e.id,(SELECT COALESCE(MAX(revision),0)::integer FROM public.namat_report_reviews WHERE report_id=$1) AS revision
          FROM public.namat_report_extractions e WHERE e.report_id=$1 ORDER BY e.created_at DESC,e.id DESC LIMIT 1`,[reportId]);
        if(!latest||latest.id!==extractionId||latest.revision!==reviewRevision)fail('stale_inventory_review');
        const {rows:[existing]}=await client.query('SELECT * FROM public.namat_analysis_inventory_reviews WHERE report_id=$1 AND extraction_id=$2 AND review_revision=$3',[reportId,extractionId,reviewRevision]);
        if(existing)return inventoryReview(existing);
        const {rows:[saved]}=await client.query(`INSERT INTO public.namat_analysis_inventory_reviews(id,submission_id,report_id,extraction_id,review_revision,actor)
          VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,[randomUUID(),submissionId,reportId,extractionId,reviewRevision,actor.trim()]);
        return inventoryReview(saved);
      });
    },
    async getInventoryReviews({submissionId}={}) {
      id(submissionId);
      return transaction(async client=>{
        await liveSubmission(client,submissionId);
        const {rows}=await client.query(`SELECT i.* FROM public.namat_analysis_inventory_reviews i
          JOIN public.namat_reports r ON r.id=i.report_id AND r.submission_id=i.submission_id
          JOIN LATERAL (SELECT e.id FROM public.namat_report_extractions e WHERE e.report_id=r.id ORDER BY e.created_at DESC,e.id DESC LIMIT 1) latest ON latest.id=i.extraction_id
          WHERE i.submission_id=$1 AND r.status='ready' AND r.expires_at>now()
          AND i.review_revision=(SELECT COALESCE(MAX(revision),0) FROM public.namat_report_reviews WHERE report_id=r.id)
          ORDER BY i.report_id`,[submissionId]);
        return rows.map(inventoryReview);
      });
    },
    async budget(){return transaction(async client=>usage(client,await lockBudget(client)));},
    async reserve({reservationId,amountMicros}={}) {
      id(reservationId);micros(amountMicros,1);
      if(amountMicros>ANALYSIS_BUDGET_MICROS)fail('analysis_budget_exhausted',402);
      return transaction(async client=>{
        const limit=await lockBudget(client);
        const {rows:[existing]}=await client.query('SELECT * FROM public.namat_analysis_spend WHERE id=$1',[reservationId]);
        if(existing){if(Number(existing.reserved_micros)!==amountMicros)fail('reservation_conflict');return {...reservation(existing),budget:await usage(client,limit)};}
        const current=await usage(client,limit);
        if(amountMicros>current.remainingMicros)fail('analysis_budget_exhausted',402);
        const {rows:[saved]}=await client.query('INSERT INTO public.namat_analysis_spend(id,budget_id,reserved_micros) VALUES ($1,$2,$3) RETURNING *',[reservationId,BUDGET,amountMicros]);
        return {...reservation(saved),budget:await usage(client,limit)};
      });
    },
    async settle({reservationId,actualMicros}={}) {
      id(reservationId);micros(actualMicros);
      return transaction(async client=>{
        const limit=await lockBudget(client);
        const {rows:[existing]}=await client.query('SELECT * FROM public.namat_analysis_spend WHERE id=$1 FOR UPDATE',[reservationId]);
        if(!existing)fail('reservation_not_found',404);
        if(existing.actual_micros!==null){if(Number(existing.actual_micros)!==actualMicros)fail('settlement_conflict');return {...reservation(existing),budget:await usage(client,limit)};}
        // Record real usage even if a pricing/upper-bound defect overspent. Never
        // hide spend by clamping it; all following reservations stop at the cap.
        const {rows:[saved]}=await client.query('UPDATE public.namat_analysis_spend SET actual_micros=$2,settled_at=now() WHERE id=$1 RETURNING *',[reservationId,actualMicros]);
        return {...reservation(saved),budget:await usage(client,limit)};
      });
    },
    async saveRun(value={}) {
      id(value.id);id(value.submissionId);hash(value.cacheKey);hash(value.caseFingerprint);snapshot(value.inputSnapshot);
      const analysis=json(value.analysis,1_000_000),metadata=json(value.metadata,500_000),input=json(value.inputSnapshot,500_000);
      const evaluatedAt=stamp(value.evaluatedAt),expiresAt=stamp(value.expiresAt);
      if(Date.parse(expiresAt)<=Date.parse(evaluatedAt)||Date.parse(expiresAt)-Date.parse(evaluatedAt)>7*86400_000||Date.parse(evaluatedAt)>Date.now()+60_000)fail('invalid_time',400);
      if(value.analysis.caseFingerprint!==value.caseFingerprint)fail('fingerprint_mismatch',400);
      return transaction(async client=>{
        const submission=await liveSubmission(client,value.submissionId);
        await assertCurrent(client,submission,value.inputSnapshot);
        const {rows:[existing]}=await client.query('SELECT * FROM public.namat_analysis_runs WHERE id=$1',[value.id]);
        if(existing){
          if(existing.submission_id!==value.submissionId||existing.cache_key!==value.cacheKey||existing.case_fingerprint!==value.caseFingerprint||!same(existing.analysis,value.analysis)||!same(existing.metadata,value.metadata)||!same(existing.input_snapshot,value.inputSnapshot)||new Date(existing.evaluated_at).toISOString()!==evaluatedAt)fail('analysis_id_conflict');
          return run(existing);
        }
        const expiry=new Date(Math.min(Date.parse(expiresAt),new Date(submission.expires_at).getTime())).toISOString();
        if(Date.parse(expiry)<=Date.now())fail('analysis_expired');
        const {rows:[saved]}=await client.query(`INSERT INTO public.namat_analysis_runs(id,submission_id,cache_key,case_fingerprint,input_snapshot,analysis,metadata,evaluated_at,expires_at)
          VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9) RETURNING *`,[value.id,value.submissionId,value.cacheKey,value.caseFingerprint,input,analysis,metadata,evaluatedAt,expiry]);
        return run(saved);
      });
    },
    async findRun({submissionId,cacheKey,now}={}) {
      id(submissionId);hash(cacheKey);
      const at=now===undefined?new Date().toISOString():stamp(typeof now==='number'?new Date(now).toISOString():now);
      return transaction(async client=>{
        const submission=await liveSubmission(client,submissionId);
        const {rows:[row]}=await client.query(`SELECT * FROM public.namat_analysis_runs WHERE submission_id=$1 AND cache_key=$2
          AND expires_at>GREATEST(now(),$3::timestamptz) ORDER BY created_at DESC,id DESC LIMIT 1`,[submissionId,cacheKey,at]);
        if(!row)return null;
        try{await assertCurrent(client,submission,row.input_snapshot);}catch(error){if(error instanceof AnalysisStoreError&&['stale_analysis','unprocessed_reports'].includes(error.code))return null;throw error;}
        return run(row);
      });
    },
    async getRun({submissionId,runId}={}) {
      return transaction(async client=>{
        const submission=await liveSubmission(client,submissionId),row=await liveRun(client,submissionId,runId);
        await assertCurrent(client,submission,row.input_snapshot);
        const {rows}=await client.query('SELECT * FROM public.namat_analysis_decisions WHERE run_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[runId]);
        return {...run(row),latestDecision:rows.length?decision(rows[0]):null};
      });
    },
    async saveDecision({submissionId,runId,caseFingerprint,actor,selectedTestIds,decision:choice,notes=''}={}) {
      id(submissionId);id(runId);hash(caseFingerprint);
      if(typeof actor!=='string'||!actor.trim()||actor.length>256||/[\u0000-\u001f\u007f]/.test(actor)||!['approved','rejected','needs_changes'].includes(choice)||typeof notes!=='string'||notes.length>4000||CONTROL.test(notes)||!Array.isArray(selectedTestIds)||selectedTestIds.length>80||new Set(selectedTestIds).size!==selectedTestIds.length||selectedTestIds.some(test=>typeof test!=='string'||!test||test.length>100)||(choice!=='approved'&&selectedTestIds.length))fail('invalid_decision',400);
      return transaction(async client=>{
        const submission=await liveSubmission(client,submissionId),row=await liveRun(client,submissionId,runId);
        if(row.case_fingerprint!==caseFingerprint)fail('stale_analysis');
        await assertCurrent(client,submission,row.input_snapshot);
        const tests=row.analysis?.plan?.tests;
        if(!Array.isArray(tests)||selectedTestIds.some(testId=>!tests.some(test=>test.id===testId)))fail('invalid_selection',400);
        const {rows:[saved]}=await client.query(`INSERT INTO public.namat_analysis_decisions(id,run_id,submission_id,case_fingerprint,actor,selected_test_ids,decision,notes)
          SELECT $1,$2,$3,$4,$5,$6::jsonb,$7,$8 FROM public.namat_analysis_runs r
          JOIN public.hackathon_welcome_submissions s ON s.id=r.submission_id
          WHERE r.id=$2 AND r.submission_id=$3 AND r.expires_at>clock_timestamp() AND s.expires_at>clock_timestamp() RETURNING *`,[randomUUID(),runId,submissionId,caseFingerprint,actor.trim(),JSON.stringify(selectedTestIds),choice,notes]);
        if(!saved)fail('analysis_expired');
        return decision(saved);
      });
    },
  };
}
