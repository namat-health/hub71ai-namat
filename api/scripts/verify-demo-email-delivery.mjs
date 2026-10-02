// Read-only verification of the two explicitly saved fictional rollout cases.
// Never invokes the sender, alters the outbox, or queries other recipients.
import {readFileSync,writeFileSync,mkdirSync,lstatSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {poolOptions} from '../src/hackathon/server/store.mjs';

const EMAIL='fborja@martinez-laredo.com';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROOT=resolve(import.meta.dirname,'..');
const OUTPUT=resolve(ROOT,'output/demo-rollout-2026-10-01');
const fail=code=>{throw new Error(code);};
const canonicalId=value=>typeof value==='string'?value.replace(/^<(.*)>$/,'$1'):'';
const events=new Set(['request','requests','sent','delivered','deferred','hardBounce','hardBounces','softBounce','softBounces','blocked','spam','invalid','invalid_email','error','opened','uniqueOpened','clicks','unsubscribed','loadedByProxy','proxy_open','unique_proxy_open']);

function privateJson(path) {
  const info=lstatSync(path);
  if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077)!==0)fail('private_file_required');
  return JSON.parse(readFileSync(path,'utf8'));
}

export function validateEmailCaseReferences(value) {
  if(!Array.isArray(value?.cases)||value.cases.length!==2||!Number.isFinite(Date.parse(value.createdAt)))fail('two_case_references_required');
  const cases=value.cases.map(item=>{
    const requestId=item.requestId||item.payload?.requestId;
    if(![requestId,item.receiptId,item.submissionId].every(v=>typeof v==='string'&&UUID.test(v)))fail('saved_case_ids_required');
    if(item.payload&&(item.payload.email!==EMAIL||item.payload.dataClass!=='synthetic'||item.payload.fictionalConfirmed!==true))fail('fictional_owner_cases_required');
    return {requestId,receiptId:item.receiptId,submissionId:item.submissionId};
  });
  for(const key of ['requestId','receiptId','submissionId'])if(new Set(cases.map(item=>item[key])).size!==2)fail('distinct_case_ids_required');
  return {createdAt:new Date(value.createdAt).toISOString(),cases};
}

export function summarizeDeliveryEvents(value,messageId) {
  const records=value?.events===undefined?[]:value.events;
  if(!value||typeof value!=='object'||Array.isArray(value)||!Array.isArray(records)||records.length>100)fail('invalid_provider_event_response');
  const matched=[];
  for(const item of records) {
    // Even if a provider ignores its filters, unrelated records never enter
    // local evidence, stdout, or the delivery result.
    if(item.email!==EMAIL||canonicalId(item.messageId)!==canonicalId(messageId))continue;
    if(!events.has(item.event)||!Number.isFinite(Date.parse(item.date)))continue;
    matched.push({event:item.event,date:new Date(item.date).toISOString()});
  }
  const delivered=matched.filter(item=>item.event==='delivered');
  const failed=matched.some(item=>['hardBounce','hardBounces','blocked','invalid','invalid_email','error'].includes(item.event));
  return {status:delivered.length?'delivered':failed?'delivery_failed':'delivery_unconfirmed',
    deliveredAt:delivered.at(-1)?.date||null,events:matched,eventLimitReached:records.length===100};
}

async function boundedJson(response) {
  const max=131072,declared=response.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>max)){await response.body?.cancel();fail('provider_response_too_large');}
  if(!response.body)fail('invalid_provider_event_response');
  const reader=response.body.getReader(),parts=[];let size=0;
  try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)fail('provider_response_too_large');parts.push(Buffer.from(value));}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{fail('invalid_provider_event_response');}
}

export async function verifyDemoEmailDelivery({settingsPath,referencesPath=resolve(OUTPUT,'fictional-case-references.json'),
  outputDirectory=OUTPUT,fetchImpl=fetch,poolFactory=options=>new pg.Pool(options),now=new Date()}={}) {
  const report={checkedAt:now.toISOString(),mode:'read-only',recipient:EMAIL,emailsSentByVerifier:0,providerReads:0,cases:[]};
  let pool,client;
  const save=()=>{mkdirSync(outputDirectory,{recursive:true});writeFileSync(resolve(outputDirectory,'email-delivery-verification.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});};
  try {
    if(!settingsPath)fail('private_settings_path_required');
    const bundle=privateJson(resolve(settingsPath)),settings=bundle.form?.settings||bundle.form;
    if(typeof settings?.BREVO_API_KEY!=='string'||!settings.BREVO_API_KEY.trim())fail('brevo_key_missing');
    let url;try{url=new URL(settings.HACKATHON_DATABASE_URL);}catch{fail('approved_database_required');}
    if(url.protocol!=='postgresql:'||url.hostname!=='namat-pg-test-uaen-001.postgres.database.azure.com'||url.pathname!=='/namat_journey'||url.port&&url.port!=='5432'||url.hash)fail('approved_database_required');
    const references=validateEmailCaseReferences(privateJson(resolve(referencesPath)));
    if(Date.parse(references.createdAt)>now.getTime()+60000||now-Date.parse(references.createdAt)>7*86400000)fail('recent_case_references_required');
    pool=poolFactory({...poolOptions({databaseUrl:settings.HACKATHON_DATABASE_URL,databaseCa:settings.HACKATHON_DATABASE_CA}),max:1});
    client=await pool.connect();
    await client.query('BEGIN READ ONLY');
    const {rows}=await client.query(`SELECT s.id AS submission_id,s.request_id,s.receipt_id,s.created_at,
      o.status,o.attempts,o.provider_message_id,o.sent_at
      FROM public.hackathon_welcome_submissions s
      JOIN public.hackathon_email_outbox o ON o.submission_id=s.id AND o.reference=s.receipt_id
      WHERE s.id=ANY($1::uuid[]) AND s.request_id=ANY($2::uuid[]) AND s.receipt_id=ANY($3::uuid[])
        AND s.email=$4 AND o.recipient_email=$4 AND s.data_class='synthetic' AND o.data_class='synthetic'
        AND s.fictional_confirmed=true AND s.notes->>'curiosity'='Fictional shared API verification '||s.request_id::text`,
      [references.cases.map(x=>x.submissionId),references.cases.map(x=>x.requestId),references.cases.map(x=>x.receiptId),EMAIL]);
    await client.query('ROLLBACK');client.release();client=null;
    if(rows.length!==2)fail('two_matching_owner_outbox_records_required');
    for(const [index,item]of references.cases.entries()) {
      const row=rows.find(row=>row.request_id===item.requestId&&row.submission_id===item.submissionId&&row.receipt_id===item.receiptId);
      if(!row)fail('case_outbox_mismatch');
      const result={case:index+1,...item,outboxStatus:row.status,sendAttempts:row.attempts,status:'provider_acceptance_unconfirmed'};
      report.cases.push(result);
      if(row.status!=='sent'||typeof row.provider_message_id!=='string'||!row.provider_message_id||row.provider_message_id.length>256||/[\x00-\x1f\x7f]/.test(row.provider_message_id)){save();continue;}
      result.providerMessageId=row.provider_message_id;
      const sent=Date.parse(row.sent_at||row.created_at);
      if(!Number.isFinite(sent)||sent<Date.parse(references.createdAt)-60000||sent>now.getTime()+60000)fail('message_date_mismatch');
      const endpoint=new URL('https://api.brevo.com/v3/smtp/statistics/events');
      endpoint.search=new URLSearchParams({email:EMAIL,messageId:row.provider_message_id,startDate:new Date(sent).toISOString().slice(0,10),endDate:now.toISOString().slice(0,10),limit:'100',offset:'0',sort:'asc'}).toString();
      report.providerReads++;
      const response=await fetchImpl(endpoint.href,{method:'GET',headers:{'api-key':settings.BREVO_API_KEY,Accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
      if(!response.ok){await response.body?.cancel();result.status=response.status===429?'provider_rate_limited':'provider_read_failed';result.providerHttpStatus=response.status;save();continue;}
      Object.assign(result,summarizeDeliveryEvents(await boundedJson(response),row.provider_message_id));save();
    }
    report.delivered=report.cases.filter(item=>item.status==='delivered').length;
    report.complete=report.delivered===2;save();
    return {cases:report.cases.length,delivered:report.delivered,complete:report.complete,providerReads:report.providerReads,emailsSentByVerifier:0};
  } catch(error) {
    report.failure=/^[a-z0-9_]+$/.test(error?.message||'')?error.message:'email_verification_incomplete';save();throw new Error(report.failure);
  } finally {
    if(client){await client.query('ROLLBACK').catch(()=>{});client.release();}
    await pool?.end();
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  if(process.argv.length<3||process.argv.length>4){console.error('Usage: node scripts/verify-demo-email-delivery.mjs PRIVATE_SETTINGS_BUNDLE [PRIVATE_CASE_REFERENCES]');process.exitCode=1;}
  else verifyDemoEmailDelivery({settingsPath:process.argv[2],...(process.argv[3]?{referencesPath:process.argv[3]}:{})})
    .then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(`Email delivery verification stopped: ${error.message}. No email was sent.`);process.exitCode=1;});
}
