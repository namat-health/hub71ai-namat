// Read-only by default. --submit-fictional explicitly enables two synthetic
// staging cases, with saved request IDs for safe resume after interruption.
import {readFileSync,writeFileSync,mkdirSync,statSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {readApiConfig} from '../services/namat-api/config.mjs';
import {createDatabase} from '../services/namat-api/database.mjs';
import {input,answers,file,png,jpeg} from '../tests/hackathon-fixtures.mjs';
const settingsPath=process.argv[2];
const dir=resolve('output/namat-api-staging-2026-10-01');
const report={checkedAt:new Date().toISOString(),checks:[],externalEmailsSent:0};
let database;
const persist=()=>{mkdirSync(dir,{recursive:true});writeFileSync(`${dir}/hosted-verification.json`,JSON.stringify(report,null,2)+'\n');};
const check=(name,pass)=>{report.checks.push({name,pass:Boolean(pass)});persist();if(!pass)throw new Error(name);};
try {
 if(!settingsPath||(statSync(settingsPath).mode&0o077)!==0)throw new Error('Private configuration required');
 const config=readApiConfig(JSON.parse(readFileSync(settingsPath,'utf8')));
 if(config.mode!=='synthetic-staging')throw new Error('Staging configuration required');
 const base=config.publicOrigin;
 const req=async(path,{auth=true,method='GET',body,headers={}}={})=>{
  const response=await fetch(base+path,{method,headers:{...(auth?{Authorization:`Bearer ${config.stagingToken}`}:{ }),...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(45000)});
  const text=await response.text();let data;try{data=JSON.parse(text);}catch{}
  return {status:response.status,data,headers:response.headers};
 };
 let response=await req('/healthz',{auth:false});check('public_liveness',response.status===200&&response.data?.status==='ok');
 response=await req('/readyz',{auth:false});check('readiness_requires_key',response.status===401);
 response=await req('/v1/openapi.json',{auth:false});check('contract_requires_key',response.status===401);
 response=await req('/v1/submissions',{auth:false,method:'POST',body:{}});check('anonymous_write_denied',response.status===401);
 response=await req('/readyz',{headers:{Authorization:'Bearer invalid'}});check('incorrect_key_denied',response.status===401);
 response=await req('/readyz');check('authenticated_storage_ready',response.status===200&&response.data?.status==='ready');
 response=await req('/v1/openapi.json');check('hosted_contract',response.status===200&&response.data?.servers?.[0]?.url===base&&response.data?.security?.[0]?.StagingToken?.length===0);
 check('staging_concurrency_documented',response.data?.['x-runtime-limits']?.maxInFlightSubmissions===1&&response.data?.paths?.['/v1/submissions']?.post?.responses?.['429']?.description?.includes('one submission already in flight')&&response.data?.paths?.['/readyz']?.get?.summary==='Check that staging storage is available');
 check('private_cache_headers',response.headers.get('cache-control')==='private, no-store');
 response=await req('/v1/cases');check('case_read_unimplemented',response.status===404);
 response=await req('/v1/submissions');check('submission_read_unavailable',response.status===405);
 response=await req('/v1/submissions',{auth:false,method:'OPTIONS',headers:{Origin:base,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,authorization'}});check('authorized_origin_preflight',response.status===204&&response.headers.get('access-control-allow-origin')===base);
 if(process.argv.includes('--submit-fictional')) {
  const seedPath=`${dir}/fictional-cases.json`;
  const cases=existsSync(seedPath)?JSON.parse(readFileSync(seedPath,'utf8')):[input({email:'staging-no-report@example.invalid',firstName:'Fictional API'}),input({email:'staging-reports@example.invalid',firstName:'Fictional Upload',answers:answers({bloodwork:'yes'}),reports:[file(),file(png(),'fictional.png','image/png'),file(jpeg(),'fictional.jpg','image/jpeg')]})];
  if(cases.length!==2||cases.some(x=>!x.email.endsWith('@example.invalid')||x.dataClass!=='synthetic'||x.fictionalConfirmed!==true))throw new Error('Unexpected test fixtures');
  writeFileSync(seedPath,JSON.stringify(cases,null,2)+'\n');
  const payload=value=>({...value,questionnaireRevision:'uae-arrival-2026-09-30'});
  response=await req('/v1/submissions',{method:'POST',body:payload(cases[0]),headers:{Origin:'https://unapproved.example'}});check('foreign_origin_denied',response.status===403);
  response=await req('/v1/submissions',{method:'POST',body:payload({...cases[0],firstName:''})});check('blank_name_denied',response.status===400);
  response=await req('/v1/submissions',{method:'POST',body:{...payload(cases[0]),dataClass:'real'}});check('real_data_flag_denied',response.status===400);
  response=await req('/v1/submissions',{method:'POST',body:{...payload(cases[0]),questionnaireRevision:'unknown'}});check('unknown_revision_denied',response.status===400);
  response=await req('/v1/submissions',{method:'POST',body:payload(cases[0])});check('no_report_saved',response.status===201&&response.data?.confirmationEmail==='pending');
  const firstReceipt=response.data.receiptId;
  response=await req('/v1/submissions',{method:'POST',body:payload(cases[0])});check('retry_same_receipt',response.status===201&&response.data?.receiptId===firstReceipt);
  response=await req('/v1/submissions',{method:'POST',body:payload({...cases[0],firstName:'Changed Fictional'})});check('changed_retry_conflict',response.status===409);
  response=await req('/v1/submissions',{method:'POST',body:payload(cases[1])});check('three_report_types_saved',response.status===201&&response.data?.confirmationEmail==='pending');
  const secondReceipt=response.data.receiptId;
  database=createDatabase(config);
  const {rows}=await database.pool.query(`SELECT s.request_id,s.receipt_id,s.questionnaire_revision,s.report_files,s.report_metadata,o.status,o.attempts,o.provider_message_id
   FROM public.hackathon_welcome_submissions s JOIN public.hackathon_email_outbox o ON o.submission_id=s.id WHERE s.request_id=ANY($1::uuid[])`,[cases.map(x=>x.requestId)]);
  check('exactly_two_persisted_cases',rows.length===2&&new Set(rows.map(x=>x.request_id)).size===2);
  check('emails_queued_without_sends',rows.every(x=>x.status==='queued'&&x.attempts===0&&x.provider_message_id===null));
  check('revision_persisted',rows.every(x=>x.questionnaire_revision==='uae-arrival-2026-09-30'));
  const uploaded=rows.find(x=>x.request_id===cases[1].requestId);
  check('report_bytes_and_digests_match',uploaded.report_files.length===3&&uploaded.report_files.every((bytes,i)=>bytes.equals(Buffer.from(cases[1].reports[i].base64,'base64'))&&createHash('sha256').update(bytes).digest('hex')===uploaded.report_metadata[i].sha256));
  report.receipts=[firstReceipt,secondReceipt];report.syntheticSubmissions=2;
 }
 report.passed=report.checks.filter(x=>x.pass).length;report.failed=report.checks.filter(x=>!x.pass).length;persist();console.log(JSON.stringify({passed:report.passed,failed:report.failed,syntheticSubmissions:report.syntheticSubmissions||0,externalEmailsSent:0}));
} catch(error) {report.failure=error.message?.match(/^[a-z_]+$/)?.[0]||'verification_incomplete';persist();console.error(`Staging verification stopped: ${report.failure}. See sanitized evidence before retrying.`);process.exitCode=1;}
finally {await database?.close();}
