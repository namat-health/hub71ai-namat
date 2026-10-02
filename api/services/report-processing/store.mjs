import {randomUUID} from 'node:crypto';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const MIME = new Set(['application/pdf','image/jpeg','image/png']);
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ATTEMPTS = 3;
const EXPIRED = `(r.expires_at <= now() OR (r.submission_id IS NULL AND s.expires_at <= now()))`;
export class ReportStoreError extends Error {
  constructor(code,status=409) { super(code); this.name='ReportStoreError'; this.code=code; this.status=status; }
}
const fail = (code,status) => { throw new ReportStoreError(code,status); };
const id = value => { if (typeof value!=='string'||!UUID.test(value)) fail('invalid_id',400); return value; };
const hash = value => { if (typeof value!=='string'||!HASH.test(value)) fail('invalid_hash',400); return value; };
const errorCode = value => typeof value==='string'&&/^[a-z][a-z0-9_]{0,79}$/.test(value) ? value : 'processing_failed';
const bounded = (value,fallback=50) => Number.isInteger(value) ? Math.min(100,Math.max(1,value)) : fallback;
function jsonArray(value,maxBytes=2000000) {
  if (!Array.isArray(value)) fail('invalid_output',400);
  let json; try { json=JSON.stringify(value); } catch { fail('invalid_output',400); }
  if (Buffer.byteLength(json)>maxBytes) fail('output_too_large',400);
  return json;
}
function reviewObservations(values,pages,decision) {
  if(!Array.isArray(values)||values.length>500||(!values.length&&decision!=='needs_changes'))fail('invalid_observations',400);
  const numbers=new Set(pages.map(page=>page.number));
  return values.map(value=>{
    if(!value||typeof value!=='object'||Array.isArray(value))fail('invalid_observations',400);
    const clean={};
    for(const field of ['name','value','unit','referenceRange','date','sourceText']){
      if(value[field]!==null&&value[field]!==undefined&&typeof value[field]!=='string')fail('invalid_observations',400);
      const text=value[field]?.trim()||null;
      if(text&&(text.length>(field==='sourceText'?5000:500)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)))fail('invalid_observations',400);
      clean[field]=text;
    }
    clean.page=value.page;
    if(decision!=='needs_changes'&&(!clean.name||!clean.sourceText||!Number.isInteger(clean.page)||!numbers.has(clean.page)))fail('invalid_observations',400);
    return clean;
  });
}
function report(row) {
  return row ? {id:row.id,sessionId:row.session_id,submissionId:row.submission_id,name:row.name,mime:row.mime,
    size:row.size,sha256:row.sha256,blobKey:row.blob_key,status:row.status,pageCount:row.page_count,
    errorCode:row.error_code,createdAt:row.created_at,expiresAt:row.expires_at} : null;
}
function extraction(row) {
  return {id:row.id,reportId:row.report_id,jobId:row.job_id,processorVersion:row.processor_version,inputSha256:row.input_sha256,
    pages:row.pages,observations:row.observations,warnings:row.warnings,createdAt:row.created_at};
}
function review(row) {
  return {id:row.id,reportId:row.report_id,extractionId:row.extraction_id,revision:row.revision,observations:row.observations,
    decision:row.decision,actor:row.actor,createdAt:row.created_at};
}

// Authentication belongs to the HTTP boundary. Methods without sessionId are
// for authenticated staff/worker use only; UUID references are not credentials.
export function createReportStore(pool,{leaseSeconds=300}={}) {
  if (!Number.isInteger(leaseSeconds)||leaseSeconds<1||leaseSeconds>3600) throw new Error('Invalid report lease duration.');
  async function transaction(fn) {
    const client=await pool.connect();
    try { await client.query('BEGIN'); const value=await fn(client); await client.query('COMMIT'); return value; }
    catch (error) { await client.query('ROLLBACK').catch(()=>{}); throw error; }
    finally { client.release(); }
  }
  async function liveSession(client,sessionId) {
    const {rows:[session]}=await client.query('SELECT id FROM public.namat_report_sessions WHERE id=$1 AND expires_at>now() FOR UPDATE',[id(sessionId)]);
    if (!session) fail('session_expired',401);
  }
  async function lockedJob(client,job) {
    const {rows:[row]}=await client.query(`SELECT * FROM public.namat_report_jobs
      WHERE id=$1 AND report_id=$2 AND lease_token=$3 AND status='processing' AND lease_expires_at>now() FOR UPDATE`,
    [id(job.id),id(job.reportId),id(job.leaseToken)]);
    return row;
  }
  const store={
    async createSession(tokenHash) {
      const {rows:[row]}=await pool.query('INSERT INTO public.namat_report_sessions(id,token_hash) VALUES ($1,$2) RETURNING id,expires_at',[randomUUID(),hash(tokenHash)]);
      return {id:row.id,expiresAt:row.expires_at};
    },
    async authorizeSession(sessionId,tokenHash) {
      if (!UUID.test(sessionId||'')||!HASH.test(tokenHash||'')) return false;
      return (await pool.query('SELECT 1 FROM public.namat_report_sessions WHERE id=$1 AND token_hash=$2 AND expires_at>now()',[sessionId,tokenHash])).rowCount===1;
    },
    async createReport(sessionId,{name,mime,size,sha256,blobKey}={}) {
      if (typeof name!=='string'||name!==name.trim()||name.length<1||name.length>160||Buffer.byteLength(name)>256||/[\x00-\x1f\x7f<>/\\]/.test(name)
        ||!MIME.has(mime)||!Number.isInteger(size)||size<1||size>MAX_BYTES) fail('invalid_report',400);
      hash(sha256);
      const reportId=randomUUID(),key=blobKey??`uploads/${reportId}`;
      if (typeof key!=='string'||key.length>512||!/^[-a-zA-Z0-9_/\.]+$/.test(key)||key.split('/').some(part=>!part||part==='.'||part==='..')) fail('invalid_blob_key',400);
      return transaction(async client=>{
        await liveSession(client,sessionId);
        const {rows:[existing]}=await client.query(`SELECT * FROM public.namat_reports WHERE session_id=$1 AND name=$2 AND mime=$3 AND size=$4
          AND sha256=$5 AND status NOT IN ('failed','rejected') AND expires_at>now() ORDER BY created_at,id LIMIT 1`,[sessionId,name,mime,size,sha256]);
        if (existing) return report(existing);
        const {rows:[counts]}=await client.query(`SELECT count(*)::integer AS total,
          count(*) FILTER(WHERE status NOT IN ('failed','rejected'))::integer AS active
          FROM public.namat_reports WHERE session_id=$1`,[sessionId]);
        if (counts.active>=3||counts.total>=12) fail('report_limit',409);
        const {rows:[row]}=await client.query(`INSERT INTO public.namat_reports(id,session_id,name,mime,size,sha256,blob_key)
          VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[reportId,sessionId,name,mime,size,sha256,key]);
        return report(row);
      });
    },
    async getReport(reportId,sessionId) {
      const params=[id(reportId)];
      const sessionClause=sessionId===undefined?'':' AND r.session_id=$2 AND s.expires_at>now()';
      if (sessionId!==undefined) params.push(id(sessionId));
      const {rows:[row]}=await pool.query(`SELECT r.* FROM public.namat_reports r JOIN public.namat_report_sessions s ON s.id=r.session_id
        WHERE r.id=$1 AND r.expires_at>now()${sessionClause}`,params);
      return report(row);
    },
    async markUploaded(reportId,sessionId,{sha256,size,blobKey}={}) {
      id(reportId);hash(sha256);
      return transaction(async client=>{
        await liveSession(client,sessionId);
        const {rows:[row]}=await client.query('SELECT * FROM public.namat_reports WHERE id=$1 AND session_id=$2 AND expires_at>now() FOR UPDATE',[reportId,sessionId]);
        if (!row) fail('report_not_found',404);
        if (row.sha256!==sha256||row.size!==size||blobKey!==`reports/${reportId}`) fail('upload_mismatch');
        if (['queued','processing','ready'].includes(row.status)) {
          if (row.blob_key!==blobKey) fail('upload_mismatch');
          return report(row);
        }
        if (row.status!=='uploading') fail('upload_not_available');
        const {rows:[saved]}=await client.query("UPDATE public.namat_reports SET status='queued',error_code=NULL,blob_key=$2 WHERE id=$1 RETURNING *",[reportId,blobKey]);
        return report(saved);
      });
    },
    async markRejected(reportId,sessionId,code) {
      return transaction(async client=>{
        await liveSession(client,sessionId);
        const {rows:[row]}=await client.query('SELECT * FROM public.namat_reports WHERE id=$1 AND session_id=$2 FOR UPDATE',[id(reportId),sessionId]);
        if (!row) fail('report_not_found',404);
        if (row.submission_id!==null||!['uploading','rejected'].includes(row.status)) fail('upload_not_available');
        if (row.status==='rejected') return report(row);
        const {rows:[saved]}=await client.query("UPDATE public.namat_reports SET status='rejected',error_code=$2 WHERE id=$1 RETURNING *",[reportId,errorCode(code)]);
        return report(saved);
      });
    },
    // Caller owns BEGIN/COMMIT: report links and jobs must commit with intake and
    // its email outbox. Session locking serializes competing submissions.
    async linkReports(client,submissionId,sessionId,reportIds) {
      id(submissionId);
      if (!Array.isArray(reportIds)||reportIds.length<1||reportIds.length>3||new Set(reportIds).size!==reportIds.length) fail('invalid_reports',400);
      reportIds.forEach(id);
      await liveSession(client,sessionId);
      const {rows:[submission]}=await client.query('SELECT id,expires_at FROM public.hackathon_welcome_submissions WHERE id=$1 AND expires_at>now()',[submissionId]);
      if (!submission) fail('submission_not_found',404);
      const {rows}=await client.query(`SELECT * FROM public.namat_reports WHERE id=ANY($1::uuid[]) AND session_id=$2 AND expires_at>now() ORDER BY id FOR UPDATE`,[reportIds,sessionId]);
      if (rows.length!==reportIds.length||rows.some(row=>!['queued','processing','ready'].includes(row.status)||row.submission_id&&row.submission_id!==submissionId)) fail('reports_not_available');
      const {rows:[existing]}=await client.query('SELECT count(*)::integer AS total FROM public.namat_reports WHERE submission_id=$1 AND NOT (id=ANY($2::uuid[]))',[submissionId,reportIds]);
      if (existing.total+rows.length>3) fail('report_limit');
      for (const row of rows) {
        await client.query('UPDATE public.namat_reports SET submission_id=$2,expires_at=LEAST(expires_at,$3) WHERE id=$1',[row.id,submissionId,submission.expires_at]);
        await client.query('INSERT INTO public.namat_report_jobs(id,report_id) VALUES ($1,$2) ON CONFLICT(report_id) DO NOTHING',[randomUUID(),row.id]);
      }
      return rows.map(row=>report({...row,submission_id:submissionId}));
    },
    async listCases(limit=50) {
      const {rows}=await pool.query(`SELECT s.id,s.receipt_id,s.first_name,s.created_at,count(r.id)::integer AS report_count,
        count(r.id) FILTER(WHERE r.status='ready')::integer AS ready_count
        FROM public.hackathon_welcome_submissions s JOIN public.namat_reports r ON r.submission_id=s.id
        WHERE s.expires_at>now() AND r.expires_at>now() GROUP BY s.id ORDER BY s.created_at DESC,s.id DESC LIMIT $1`,[bounded(limit)]);
      return rows.map(row=>({id:row.id,submissionId:row.id,receiptId:row.receipt_id,firstName:row.first_name,createdAt:row.created_at,reportCount:row.report_count,readyCount:row.ready_count}));
    },
    async getCase(submissionId) {
      return transaction(async client=>{
        // One snapshot keeps report states and immutable outputs consistent.
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const {rows:[row]}=await client.query('SELECT id,receipt_id,first_name,created_at,answers,notes FROM public.hackathon_welcome_submissions WHERE id=$1 AND expires_at>now()',[id(submissionId)]);
        if (!row) return null;
        const {rows:reports}=await client.query('SELECT * FROM public.namat_reports WHERE submission_id=$1 AND expires_at>now() ORDER BY created_at,id',[submissionId]);
        if (!reports.length) return null;
        const ids=reports.map(r=>r.id);
        const {rows:extractions}=await client.query('SELECT * FROM public.namat_report_extractions WHERE report_id=ANY($1::uuid[]) ORDER BY created_at DESC,id DESC',[ids]);
        const {rows:reviews}=await client.query('SELECT * FROM public.namat_report_reviews WHERE report_id=ANY($1::uuid[]) ORDER BY revision DESC',[ids]);
        return {id:row.id,submissionId:row.id,receiptId:row.receipt_id,firstName:row.first_name,createdAt:row.created_at,answers:row.answers,notes:row.notes,
          reports:reports.map(r=>({...report(r),extractions:extractions.filter(e=>e.report_id===r.id).map(extraction),reviews:reviews.filter(v=>v.report_id===r.id).map(review)}))};
      });
    },
    async saveReview(reportId,{extractionId,observations,decision,expectedReviewRevision}={},actor) {
      id(reportId);id(extractionId);jsonArray(observations);
      if (!['approved','corrected','needs_changes'].includes(decision)||typeof actor!=='string'||!actor.trim()||actor.length>256
        ||!Number.isInteger(expectedReviewRevision)||expectedReviewRevision<0) fail('invalid_review',400);
      return transaction(async client=>{
        const {rows:[row]}=await client.query("SELECT id FROM public.namat_reports WHERE id=$1 AND submission_id IS NOT NULL AND status='ready' AND expires_at>now() FOR UPDATE",[reportId]);
        if (!row) fail('report_not_ready');
        const {rows:[latest]}=await client.query('SELECT id,pages,observations FROM public.namat_report_extractions WHERE report_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[reportId]);
        if (!latest||latest.id!==extractionId) fail('stale_extraction');
        const {rows:[current]}=await client.query('SELECT COALESCE(MAX(revision),0)::integer AS revision FROM public.namat_report_reviews WHERE report_id=$1',[reportId]);
        if (current.revision!==expectedReviewRevision) fail('stale_review');
        const clean=reviewObservations(observations,latest.pages,decision),content=jsonArray(clean);
        if(decision==='approved') {
          const {rows:[previous]}=await client.query('SELECT observations FROM public.namat_report_reviews WHERE report_id=$1 AND extraction_id=$2 ORDER BY revision DESC LIMIT 1',[reportId,extractionId]);
          if(JSON.stringify(clean)!==JSON.stringify(reviewObservations(previous?.observations||latest.observations,latest.pages,decision)))fail('save_corrections_first');
        }
        const {rows:[saved]}=await client.query(`INSERT INTO public.namat_report_reviews(id,report_id,extraction_id,revision,observations,decision,actor)
          SELECT $1,$2,$3,COALESCE(MAX(revision),0)+1,$4::jsonb,$5,$6 FROM public.namat_report_reviews WHERE report_id=$2 RETURNING *`,
        [randomUUID(),reportId,extractionId,content,decision,actor.trim()]);
        return review(saved);
      });
    },
    async claimJob() {
      return transaction(async client=>{
        // A worker killed on its final attempt must still reach a terminal state.
        const {rows:exhausted}=await client.query(`UPDATE public.namat_report_jobs SET status='failed',lease_token=NULL,lease_expires_at=NULL,
          error_code='attempts_exhausted',completed_at=now() WHERE status='processing' AND lease_expires_at<=now() AND attempts>=$1 RETURNING report_id`,[MAX_ATTEMPTS]);
        if (exhausted.length) await client.query("UPDATE public.namat_reports SET status='failed',error_code='attempts_exhausted' WHERE id=ANY($1::uuid[]) AND status='processing'",[exhausted.map(row=>row.report_id)]);
        const {rows:[job]}=await client.query(`SELECT j.* FROM public.namat_report_jobs j JOIN public.namat_reports r ON r.id=j.report_id
          JOIN public.hackathon_welcome_submissions s ON s.id=r.submission_id
          WHERE ((j.status='queued' AND j.available_at<=now()) OR (j.status='processing' AND j.lease_expires_at<=now()))
            AND j.attempts<$1 AND r.status IN ('queued','processing') AND r.expires_at>now() AND s.expires_at>now()
          ORDER BY j.available_at,j.created_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED`,[MAX_ATTEMPTS]);
        if (!job) return null;
        const leaseToken=randomUUID();
        await client.query(`UPDATE public.namat_report_jobs SET status='processing',attempts=attempts+1,lease_token=$2,
          lease_expires_at=now()+($3*interval '1 second'),error_code=NULL WHERE id=$1`,[job.id,leaseToken,leaseSeconds]);
        const {rows:[row]}=await client.query("UPDATE public.namat_reports SET status='processing',error_code=NULL WHERE id=$1 RETURNING *",[job.report_id]);
        return {id:job.id,reportId:job.report_id,leaseToken,attempts:job.attempts+1,report:report(row)};
      });
    },
    async completeJob(job,{processorVersion,pages,observations,warnings=[],pageCount}={}) {
      if (typeof processorVersion!=='string'||!processorVersion.trim()||processorVersion.length>160) fail('invalid_processor_version',400);
      const pageJson=jsonArray(pages,8000000),observationJson=jsonArray(observations),warningJson=jsonArray(warnings,1000000);
      if (!pages.length||pages.length>50||(pageCount!==undefined&&pageCount!==pages.length)) fail('invalid_page_count',400);
      return transaction(async client=>{
        if (!await lockedJob(client,job)) return {completed:false};
        const {rows:[row]}=await client.query('SELECT * FROM public.namat_reports WHERE id=$1 AND submission_id IS NOT NULL AND expires_at>now() FOR UPDATE',[job.reportId]);
        if (!row) return {completed:false};
        const {rows:[saved]}=await client.query(`INSERT INTO public.namat_report_extractions(id,report_id,job_id,processor_version,input_sha256,pages,observations,warnings)
          VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) RETURNING *`,[randomUUID(),row.id,job.id,processorVersion,row.sha256,pageJson,observationJson,warningJson]);
        await client.query("UPDATE public.namat_reports SET status='ready',page_count=$2,error_code=NULL WHERE id=$1",[row.id,pages.length]);
        await client.query("UPDATE public.namat_report_jobs SET status='succeeded',lease_token=NULL,lease_expires_at=NULL,completed_at=now(),error_code=NULL WHERE id=$1",[job.id]);
        return {completed:true,extraction:extraction(saved)};
      });
    },
    async failJob(job,code,{retryable=false}={}) {
      return transaction(async client=>{
        const row=await lockedJob(client,job);if (!row) return {updated:false};
        const retry=retryable===true&&row.attempts<MAX_ATTEMPTS,status=retry?'queued':'failed';
        await client.query(`UPDATE public.namat_report_jobs SET status=$2,error_code=$3,lease_token=NULL,lease_expires_at=NULL,
          available_at=now()+($4*interval '1 second'),completed_at=CASE WHEN $2='failed' THEN now() ELSE NULL END WHERE id=$1`,
        [job.id,status,errorCode(code),Math.min(3600,15*2**(row.attempts-1))]);
        await client.query('UPDATE public.namat_reports SET status=$2,error_code=$3 WHERE id=$1',[job.reportId,status,errorCode(code)]);
        return {updated:true,status};
      });
    },
    // Explicit authenticated operator action after a terminal processing failure.
    // Use the same lock order as workers, never alter an existing extraction,
    // and bound manual retries separately from each automatic attempt cycle.
    async retryReport(reportId) {
      return transaction(async client=>{
        const {rows:[job]}=await client.query('SELECT * FROM public.namat_report_jobs WHERE report_id=$1 FOR UPDATE',[id(reportId)]);
        if (!job||job.status!=='failed') fail('retry_not_available');
        const {rows:[row]}=await client.query(`SELECT r.* FROM public.namat_reports r
          JOIN public.hackathon_welcome_submissions s ON s.id=r.submission_id
          WHERE r.id=$1 AND r.status='failed' AND r.expires_at>now() AND s.expires_at>now() FOR UPDATE OF r`,[reportId]);
        if (!row) fail('retry_not_available');
        if (job.manual_retries>=3) fail('retry_limit');
        await client.query(`UPDATE public.namat_report_jobs SET status='queued',attempts=0,manual_retries=manual_retries+1,
          last_retry_at=now(),last_failure_code=error_code,error_code=NULL,lease_token=NULL,lease_expires_at=NULL,
          available_at=now(),completed_at=NULL WHERE id=$1`,[job.id]);
        const {rows:[saved]}=await client.query("UPDATE public.namat_reports SET status='queued',error_code=NULL WHERE id=$1 RETURNING *",[reportId]);
        return report(saved);
      });
    },
    // Reserve before contacting OCR. An uncertain provider outcome deliberately
    // keeps its reservation so retry/restart cannot bypass the daily spend cap.
    async reserveOcrPages(pageCount,limit=200) {
      if (!Number.isInteger(pageCount)||pageCount<1||pageCount>50||!Number.isInteger(limit)||limit<0||limit>1000000) fail('invalid_ocr_budget',400);
      if (pageCount>limit) return false;
      const result=await pool.query(`INSERT INTO public.namat_report_ocr_budget(day,pages)
        VALUES ((now() AT TIME ZONE 'UTC')::date,$1)
        ON CONFLICT(day) DO UPDATE SET pages=public.namat_report_ocr_budget.pages+EXCLUDED.pages,updated_at=now()
        WHERE public.namat_report_ocr_budget.pages+EXCLUDED.pages <= $2 RETURNING pages`,[pageCount,limit]);
      return result.rowCount===1;
    },
    async expiredReports(limit=100) {
      const {rows}=await pool.query(`SELECT r.* FROM public.namat_reports r JOIN public.namat_report_sessions s ON s.id=r.session_id
        WHERE ${EXPIRED} ORDER BY r.expires_at,r.id LIMIT $1`,[bounded(limit,100)]);
      return rows.map(report);
    },
    async deleteExpiredReport(reportId) {
      return (await pool.query(`DELETE FROM public.namat_reports r USING public.namat_report_sessions s
        WHERE r.session_id=s.id AND r.id=$1 AND ${EXPIRED}`,[id(reportId)])).rowCount===1;
    },
  };
  return store;
}
