import {VERSION,MAX_FILE_BYTES,validateSubmission} from '../welcome/questionnaire-model.mjs';
import {validateReport} from './uploads.mjs';
import {createHackathonStore,getHackathonPool} from './store.mjs';
import {inspectDocument} from '../../../services/report-processing/document.mjs';
import {getReportService,reportConfig} from '../../../services/report-processing/service.mjs';

export {MAX_FILE_BYTES};
export const MAX_BODY_BYTES=4_000_000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const plain=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const fields=new Set(['version','requestId','dataClass','fictionalConfirmed','answers','notes','email','firstName','reports']);
const localHosts=new Set(['localhost','127.0.0.1','[::1]']);

export function hackathonConfig(env) {
  if (env.HACKATHON_ENABLED!=='true' || !env.HACKATHON_DATABASE_URL || !env.HACKATHON_ALLOWED_ORIGINS) return null;
  try {
    const database=new URL(env.HACKATHON_DATABASE_URL);
    if (!['postgres:','postgresql:'].includes(database.protocol) || !database.hostname || !database.username || !database.password
      || !/^\/[a-zA-Z_][a-zA-Z0-9_-]{0,62}$/.test(database.pathname) || database.hash
      || !Number.isInteger(Number(database.port||5432)) || Number(database.port||5432)<1 || Number(database.port||5432)>65535) return null;
    const origins=new Set();
    for (const entry of env.HACKATHON_ALLOWED_ORIGINS.split(',')) {
      const url=new URL(entry.trim());
      if (url.username || url.password || url.pathname!=='/' || url.search || url.hash
        || (url.protocol!=='https:' && !(url.protocol==='http:'&&localHosts.has(url.hostname)))) return null;
      origins.add(url.origin);
    }
    return origins.size ? {databaseUrl:database.href,databaseCa:env.HACKATHON_DATABASE_CA,origins,dataClass:'synthetic'} : null;
  } catch {return null;}
}

export function validateHackathonSubmission(input,{externalReports}={}) {
  if (!plain(input) || Object.keys(input).some(key=>!fields.has(key)&&!(externalReports&&['reportIds','reportSession'].includes(key))) || input.version!==VERSION
    || typeof input.requestId!=='string' || !UUID.test(input.requestId)
    || input.dataClass!=='synthetic' || input.fictionalConfirmed!==true) {
    return {ok:false,message:'Confirm that this is a fictional test case and review the questionnaire.'};
  }
  const checked=validateSubmission({answers:input.answers,notes:input.notes});
  if (!checked.ok) return {ok:false,message:'Please complete the questionnaire.',errors:checked.errors};
  if (typeof input.email!=='string' || input.email.length>254 || /[\x00-\x20\x7f<>]/.test(input.email.trim())
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) return {ok:false,message:'Please enter a valid email address.'};
  if (typeof input.firstName!=='string' || !input.firstName.trim() || input.firstName.trim().length>80
    || /[\x00-\x1f\x7f<>\u2028\u2029]/.test(input.firstName)) return {ok:false,message:'Please enter your first name (up to 80 characters).'};
  if (!Array.isArray(input.reports) || input.reports.length>3) return {ok:false,message:'Attach up to three PDF, JPG or PNG reports.'};
  const reports=externalReports||[];
  if(externalReports&&input.reports.length)return {ok:false,message:'Use the completed report uploads.'};
  for (const inputReport of input.reports) {
    const report=validateReport(inputReport);
    if (!report.ok || !report.value) return {ok:false,message:'Choose valid PDF, JPG or PNG reports.'};
    reports.push(report.value);
  }
  if (!externalReports&&reports.reduce((total,report)=>total+report.size,0)>MAX_FILE_BYTES) return {ok:false,message:'The combined report size must be 2 MiB or less.'};
  if (checked.answers.bloodwork==='yes' ? reports.length<1 : reports.length>0) return {ok:false,message:checked.answers.bloodwork==='yes'
    ? 'Attach at least one report before submitting.' : 'Only attach reports when you selected recent blood work.'};
  return {ok:true,value:{requestId:input.requestId.toLowerCase(),version:VERSION,dataClass:'synthetic',fictionalConfirmed:true,
    answers:checked.answers,notes:checked.notes,email:input.email.trim().toLowerCase(),firstName:input.firstName.trim(),reports,
    ...(externalReports?{reportSessionId:input.reportSession.id,reportIds:input.reportIds}:{})}};
}

export async function processHackathonRequest({method,headers={},body},{env=process.env,pool:injectedPool,sender}={}) {
  const reply=(status,value,extra={})=>({status,body:value,headers:{'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow',Vary:'Origin',...extra}});
  const unavailable=()=>reply(503,{status:'unavailable',maxFileBytes:MAX_FILE_BYTES});
  const config=hackathonConfig(env);
  if (!config) return unavailable();
  const origin=headers.origin;
  if (headers['sec-fetch-site']==='cross-site' || (origin!==undefined && (typeof origin!=='string'||!config.origins.has(origin)))) {
    return reply(403,{status:'error',message:'Please use the Namat questionnaire.'});
  }
  const cors=typeof origin==='string' ? {'Access-Control-Allow-Origin':origin} : {};
  const respond=(status,value,extra={})=>reply(status,value,{...cors,...extra});
  if (method==='OPTIONS') {
    if (!origin || headers['access-control-request-method']!=='POST'
      || String(headers['access-control-request-headers']||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean).some(h=>h!=='content-type')) return respond(403,{status:'error'});
    return respond(204,null,{'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'});
  }
  if (!['GET','POST'].includes(method)) return respond(405,{status:'error',message:'This action is not available.'},{Allow:'GET, POST, OPTIONS'});
  if (method==='POST') {
    if (!origin) return respond(403,{status:'error',message:'Please use the Namat questionnaire.'});
    if (typeof headers['content-type']!=='string' || !/^application\/json(?:\s*;|$)/i.test(headers['content-type'])) return respond(415,{status:'error',message:'Use a JSON submission.'});
    if (headers['content-length']!==undefined && (!/^\d+$/.test(String(headers['content-length'])) || Number(headers['content-length'])>MAX_BODY_BYTES)) return respond(413,{status:'error',message:'This submission is too large.'});
    let input;
    try {
      const raw=Buffer.isBuffer(body) ? body : typeof body==='string' ? Buffer.from(body) : Buffer.from(JSON.stringify(body??null));
      if (raw.length>MAX_BODY_BYTES) return respond(413,{status:'error',message:'This submission is too large.'});
      input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
    } catch {return respond(400,{status:'error',message:'Please review your submission.'});}
    let externalReports,reportService,pool=injectedPool;
    if(input?.reportIds!==undefined||input?.reportSession!==undefined) {
      if(!reportConfig(env))return respond(503,{status:'error',message:'Report uploads are temporarily unavailable.'});
      try {
        pool=pool||await getHackathonPool(config);reportService=getReportService(pool,env);
        externalReports=await reportService.resolveReports(input.reportIds,input.reportSession);
      } catch {return respond(400,{status:'error',message:'Please finish uploading your reports, or choose them again.'});}
    }
    const checked=validateHackathonSubmission(input,{externalReports});
    if (!checked.ok) return respond(400,{status:'error',message:checked.message,...(checked.errors?{errors:checked.errors}:{})});
    if(!externalReports)for(const report of checked.value.reports){
      try{await inspectDocument(report.bytes,report.type);}
      catch(error){return respond(400,{status:'error',message:error.message||'Choose a valid report.'});}
    }
    try {
      const store=createHackathonStore(pool||await getHackathonPool(config),{reportStore:reportService?.store});
      const saved=await store.save(checked.value);
      if (saved?.conflict) return respond(409,{status:'conflict',message:'This request was already saved with different content. Please submit it again with a new request ID.'});
      if (!UUID.test(saved?.receiptId||'')) return unavailable();
      let confirmationEmail='pending';
      if (typeof sender==='function') {
        try {
          const delivery=await store.deliverReceiptConfirmation(saved.receiptId,sender);
          confirmationEmail=delivery?.status==='sent' ? 'sent'
            : delivery?.blocked || delivery?.status==='local' || delivery?.status==='blocked' ? 'disabled'
            : delivery?.status==='failed' ? 'failed' : delivery?.status==='queued' ? 'pending' : 'unknown';
        } catch {
          // The submission is saved, but we cannot confirm the email outcome.
          confirmationEmail='unknown';
        }
      }
      return respond(201,{status:'saved',receiptId:saved.receiptId,confirmationEmail});
    } catch {return unavailable();}
  }
  try {
    const ready=await createHackathonStore(injectedPool||await getHackathonPool(config)).ready();
    return ready ? respond(200,{status:'ready',maxFileBytes:MAX_FILE_BYTES}) : unavailable();
  } catch {return unavailable();}
}
