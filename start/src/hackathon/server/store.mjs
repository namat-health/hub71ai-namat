import {createHash,randomUUID} from 'node:crypto';

const pools=new Map();
export const TABLE='public.hackathon_welcome_submissions';
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value==='object') return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function submissionFingerprint(value) {
  const reports=value.reports.map(({name,type,size,sha256})=>({name,type,size,sha256}));
  return createHash('sha256').update(canonical({version:value.version,dataClass:'synthetic',fictionalConfirmed:true,
    answers:value.answers,notes:value.notes,email:value.email,firstName:value.firstName,reports})).digest('hex');
}

export function poolOptions(config) {
  const url=new URL(config.databaseUrl);
  // Set fields explicitly: URL sslmode parameters must never replace verified
  // TLS with weaker driver settings. Credentials stay in server memory.
  return {host:url.hostname,port:Number(url.port||5432),database:decodeURIComponent(url.pathname.slice(1)),
    user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),
    ssl:['localhost','127.0.0.1','[::1]'].includes(url.hostname) ? false : {rejectUnauthorized:true,...(config.databaseCa?{ca:config.databaseCa}:{})},
    max:2,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,statement_timeout:7000};
}

export async function getHackathonPool(config) {
  const key=`${config.databaseUrl}\0${config.databaseCa||''}`;
  if (!pools.has(key)) {
    const {Pool}=await import('pg');
    pools.set(key,new Pool(poolOptions(config)));
  }
  return pools.get(key);
}

export function createHackathonStore(pool,{reportStore}={}) {
  return {
    async ready() {
      const {rows}=await pool.query(`SELECT relation IS NOT NULL
        AND has_table_privilege(current_user,relation,'SELECT')
        AND has_table_privilege(current_user,relation,'INSERT') AS ready
        FROM (SELECT to_regclass(name) AS relation
          FROM unnest(ARRAY['${TABLE}','public.hackathon_email_outbox']) AS name) target`);
      return rows.length===2 && rows.every(row=>row.ready===true);
    },
    async save(value) {
      const fingerprint=submissionFingerprint(value),id=randomUUID(),receiptId=randomUUID();
      const client=await pool.connect();
      try {
        await client.query('BEGIN');
        const legacyReports=value.reportIds?[]:value.reports;
        if(value.reportIds&&!reportStore)throw new Error('Report storage unavailable.');
        const metadata=legacyReports.map(({name,type,size,sha256})=>({name,type,size,sha256}));
        const inserted=await client.query(`INSERT INTO ${TABLE}
          (id,request_id,receipt_id,questionnaire_version,data_class,fictional_confirmed,answers,notes,fingerprint,
           email,first_name,report_metadata,report_files,report_total_size)
          VALUES ($1,$2,$3,$4,'synthetic',TRUE,$5,$6,$7,$8,$9,$10,$11,$12)
          ON CONFLICT (request_id) DO NOTHING RETURNING receipt_id`,
        [id,value.requestId,receiptId,value.version,value.answers,value.notes,fingerprint,value.email,value.firstName,
          JSON.stringify(metadata),legacyReports.map(report=>report.bytes),legacyReports.reduce((sum,r)=>sum+r.size,0)]);
        let saved;
        if (inserted.rows[0]) {
          if(value.reportIds)await reportStore.linkReports(client,id,value.reportSessionId,value.reportIds);
          await client.query(`INSERT INTO public.hackathon_email_outbox
            (id,submission_id,reference,data_class,recipient_email,first_name,has_reports,status)
            VALUES ($1,$2,$3,'synthetic',$4,$5,$6,'queued')`,[randomUUID(),id,receiptId,value.email,value.firstName,value.reports.length>0]);
          saved={receiptId};
        } else {
          // The conflicting INSERT waits for its winner. This next statement
          // sees the committed row; the atomic outbox is already present too.
          const {rows:[existing]}=await client.query(`SELECT receipt_id,fingerprint FROM ${TABLE} WHERE request_id=$1`,[value.requestId]);
          saved=!existing ? null : existing.fingerprint===fingerprint ? {receiptId:existing.receipt_id,repeated:true} : {conflict:true};
        }
        await client.query('COMMIT');
        return saved;
      } catch(error) {await client.query('ROLLBACK').catch(()=>{});throw error;}
      finally {client.release();}
    },
    async deliverReceiptConfirmation(receiptId,sender) {
      if (typeof sender!=='function' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(receiptId)) return {status:'blocked'};
      const claimToken=randomUUID();
      const {rows:[claimed]}=await pool.query(`UPDATE public.hackathon_email_outbox
        SET status='sending',claim_token=$2,claimed_at=now(),attempts=attempts+1
        WHERE reference=$1 AND status='queued' AND expires_at>now() AND available_at<=now()
        RETURNING id,recipient_email,first_name,has_reports,reference`,[receiptId,claimToken]);
      if (!claimed) {
        const {rows:[existing]}=await pool.query('SELECT status FROM public.hackathon_email_outbox WHERE reference=$1',[receiptId]);
        return {status:existing?.status||'unavailable'};
      }
      // The standalone UPDATE has committed before any external call. A crash
      // leaves sending held, so a duplicate request cannot send another email.
      let result;
      try {result=await sender({recipientEmail:claimed.recipient_email,firstName:claimed.first_name||'',hasReports:claimed.has_reports,reference:claimed.reference});}
      catch {result={state:'unknown'};}
      const status=result?.state==='accepted' ? 'sent' : result?.state==='simulated' ? 'local'
        : ['blocked','retry'].includes(result?.state) ? 'queued' : result?.state==='failed' ? 'failed' : 'unknown';
      const providerMessageId=status==='sent'&&typeof result.messageId==='string' ? result.messageId.slice(0,256) : null;
      const code=result?.state==='blocked' ? 'sender_blocked' : result?.state==='retry' ? 'provider_rate_limited'
        : status==='unknown' ? 'provider_outcome_unknown' : status==='failed' ? 'provider_rejected' : null;
      const delay=result?.state==='retry' ? Math.min(86400,Math.max(15,Number(result.retryAfterSeconds)||60)) : 0;
      try {
        const finished=await pool.query(`UPDATE public.hackathon_email_outbox
          SET status=$3,provider_message_id=$4,last_error_code=$5,sent_at=CASE WHEN $3='sent' THEN now() ELSE NULL END,
              available_at=now()+($6::integer * interval '1 second'),claim_token=NULL
          WHERE id=$1 AND claim_token=$2 AND status='sending'`,[claimed.id,claimToken,status,providerMessageId,code,Math.ceil(delay)]);
        return finished.rowCount===1 ? {status,...(result?.state==='blocked'?{blocked:true}:{})} : {status:'unknown'};
      } catch {return {status:'unknown'};}
    },
  };
}
