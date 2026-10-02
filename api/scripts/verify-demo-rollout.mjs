// Read-only unless --submit-fictional is explicit. Recovery state containing
// session credentials stays beside the private settings bundle, never in Git.
// Reuse that bundle location on retries. The API cannot recover a session token
// after an uncertain first session-create response, so that case stops safely.
import {readFileSync,writeFileSync,mkdirSync,statSync,lstatSync,existsSync,renameSync,openSync,writeSync,fsyncSync,closeSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {input,answers,pdf} from '../tests/hackathon-fixtures.mjs';

const API='https://namat-api-staging-uaen-001.azurewebsites.net';
const FORM='https://start.namat.health';
const STORAGE='namatreportstestuaen001.blob.core.windows.net';
const EMAIL='fborja@martinez-laredo.com';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN=/^[0-9a-f]{64}$/;
const HASH=value=>createHash('sha256').update(value).digest('hex');
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const OUTPUT=resolve(ROOT,'output/demo-rollout-2026-10-01');
const STATE_NAME='demo-rollout-private-state.json';
const fail=code=>{throw new Error(code);};

function privateJson(path) {
  const info=lstatSync(path);
  if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077)!==0)fail('private_file_required');
  return JSON.parse(readFileSync(path,'utf8'));
}
function atomicPrivate(path,value) {
  const temporary=path+'.pending';
  const fd=openSync(temporary,'w',0o600);
  try{writeSync(fd,JSON.stringify(value,null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
  renameSync(temporary,path);
}
function settings(bundle) {
  const {api,form,portal}=bundle||{};
  if(!api||!form||!portal||api.NAMAT_API_MODE!=='synthetic-staging')fail('invalid_settings_bundle');
  const tokens=[api.NAMAT_DEMO_INTAKE_TOKEN,api.NAMAT_DEMO_PORTAL_TOKEN,api.NAMAT_DEMO_UPSTREAM_TOKEN];
  if(tokens.some(value=>typeof value!=='string'||!TOKEN.test(value))||new Set(tokens).size!==3||
    form.NAMAT_SHARED_API_INTAKE_TOKEN!==tokens[0]||portal.NAMAT_SHARED_API_PORTAL_TOKEN!==tokens[1]||
    form.NAMAT_SHARED_API_UPSTREAM_TOKEN!==tokens[2]||portal.NAMAT_SHARED_API_ORIGIN!==API)fail('consumer_credentials_do_not_match');
  return {intake:tokens[0],portal:tokens[1],reviewer:form.NAMAT_REPORT_REVIEW_TOKEN};
}

export function validateUploadUrl(value,reportId,now=Date.now()) {
  let url;try{url=new URL(value);}catch{fail('unexpected_upload_destination');}
  if(!UUID.test(reportId)||url.protocol!=='https:'||url.hostname!==STORAGE||url.port||url.username||url.password||url.hash||
    url.pathname!==`/quarantine/uploads/${reportId}`||url.searchParams.get('sp')!=='c'||url.searchParams.get('spr')!=='https'||url.searchParams.get('sr')!=='b'||
    !url.searchParams.get('sig')||!Number.isFinite(Date.parse(url.searchParams.get('se'))))fail('unexpected_upload_destination');
  return {url:url.href,expiresSoon:Date.parse(url.searchParams.get('se'))<now+30000};
}

export function newRecoveryState() {
  const cases=[input({email:EMAIL,firstName:'Fictional API no report'}),input({email:EMAIL,firstName:'Fictional API report',answers:answers({bloodwork:'yes'})})]
    .map(payload=>({...payload,notes:{curiosity:`Fictional shared API verification ${payload.requestId}`}}))
    .map(payload=>({payload,receiptId:null,submissionId:null,replayVerified:false}));
  const bytes=pdf();
  return {version:1,createdAt:new Date().toISOString(),cases,session:null,sessionCreationStarted:false,
    report:{name:'fictional-api-verification.pdf',type:'application/pdf',size:bytes.length,sha256:HASH(bytes),base64:bytes.toString('base64'),id:null,uploadUrl:null,uploadAttempted:false,completed:false}};
}
export function validateRecoveryState(state) {
  if(state?.version!==1||!Array.isArray(state.cases)||state.cases.length!==2||new Set(state.cases.map(item=>item.payload?.requestId)).size!==2)fail('invalid_recovery_state');
  for(const [index,item]of state.cases.entries()){
    const payload=item.payload;
    if(!UUID.test(payload?.requestId||'')||payload.email!==EMAIL||payload.dataClass!=='synthetic'||payload.fictionalConfirmed!==true||
      payload.firstName!==(index?'Fictional API report':'Fictional API no report')||payload.notes?.curiosity!==`Fictional shared API verification ${payload.requestId}`||
      payload.answers?.bloodwork!==(index?'yes':'no')||!Array.isArray(payload.reports)||payload.reports.length||
      item.receiptId&&!UUID.test(item.receiptId)||item.submissionId&&!UUID.test(item.submissionId))fail('invalid_recovery_state');
  }
  const report=state.report,bytes=Buffer.from(report?.base64||'','base64');
  if(report?.name!=='fictional-api-verification.pdf'||report.type!=='application/pdf'||report.size!==bytes.length||
    report.sha256!==HASH(bytes)||!bytes.equals(pdf())||report.id&&!UUID.test(report.id))fail('fictional_report_changed');
  if(state.session&&(!UUID.test(state.session.id)||!/^[A-Za-z0-9_-]{43}$/.test(state.session.token)))fail('invalid_recovery_state');
  if(report.uploadUrl)validateUploadUrl(report.uploadUrl,report.id);
  return bytes;
}

async function boundedResponse(response,max=12*1024*1024) {
  const declared=response.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>max)){await response.body?.cancel();fail('response_size_invalid');}
  if(!response.body)return Buffer.alloc(0);
  const chunks=[];let total=0;
  const reader=response.body.getReader();
  try {
    while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>max)fail('response_size_invalid');chunks.push(Buffer.from(value));}
  } catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  const bytes=Buffer.concat(chunks,total);
  if(declared!==null&&Number(declared)!==bytes.length)fail('response_size_invalid');
  return bytes;
}

export async function verifyDemoRollout({settingsPath,submitFictional=false,waitProcessing=false,fetchImpl=fetch,outputDirectory=OUTPUT}={}) {
  const report={checkedAt:new Date().toISOString(),mode:submitFictional?'two-fictional-cases':'read-only',checks:[],emailRecipient:EMAIL};
  let state,statePath,bytes;
  const evidence=()=>{
    mkdirSync(outputDirectory,{recursive:true});
    writeFileSync(resolve(outputDirectory,'hosted-verification.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
    if(state)writeFileSync(resolve(outputDirectory,'fictional-case-references.json'),JSON.stringify({createdAt:state.createdAt,cases:state.cases.map(item=>({requestId:item.payload.requestId,receiptId:item.receiptId,submissionId:item.submissionId,replayVerified:item.replayVerified,confirmationEmail:item.confirmationEmail||null})),reportId:state.report.id},null,2)+'\n',{mode:0o600});
  };
  const check=(name,pass)=>{report.checks.push({name,pass:Boolean(pass)});evidence();if(!pass)fail(name);};
  const save=()=>{validateRecoveryState(state);atomicPrivate(statePath,state);evidence();};
  try {
    if(!settingsPath)fail('private_settings_path_required');
    const full=resolve(settingsPath),keys=settings(privateJson(full));
    if((statSync(dirname(full)).mode&0o077)!==0)fail('private_settings_directory_required');
    statePath=resolve(dirname(full),STATE_NAME);
    if(existsSync(statePath)){state=privateJson(statePath);bytes=validateRecoveryState(state);}
    const request=async(base,path,{method='GET',body,key,headers={},timeout=45000,maxBytes}={})=>{
      if(![API,FORM].includes(base)||!path.startsWith('/')||path.startsWith('//'))fail('unexpected_request_destination');
      let response;
      try {response=await fetchImpl(base+path,{method,headers:{'Accept-Encoding':'identity',...(key?{'X-Namat-Service-Key':key}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},
        ...(body!==undefined?{body:JSON.stringify(body)}:{}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(timeout)});}catch{fail('transport_outcome_unknown');}
      const raw=await boundedResponse(response,maxBytes);let data;try{data=JSON.parse(raw.toString('utf8'));}catch{}
      return {status:response.status,headers:response.headers,bytes:raw,data};
    };
    const formRequest=(path,options={})=>request(FORM,path,{...options,headers:{Origin:FORM,...options.headers}});
    const apiRequest=(path,options={})=>request(API,path,{...options,key:options.key===undefined?keys.portal:options.key});
    const marker=response=>response.headers.get('x-namat-api-route')==='demo-v1';
    let response=await request(API,'/healthz');check('api_public_health',response.status===200&&response.data?.status==='ok');
    response=await apiRequest('/v1/demo/submissions',{key:null});check('anonymous_portal_denied',response.status===401);
    response=await apiRequest('/v1/demo/submissions',{key:keys.intake});check('intake_key_cannot_read_portal',response.status===403);
    response=await apiRequest('/v1/demo/intake');check('portal_key_cannot_use_intake',response.status===403);
    response=await request(FORM,'/internal/namat/api/namat-portal/ready');check('anonymous_internal_alias_denied',response.status===401);
    response=await apiRequest('/v1/demo/ready');check('api_backend_ready',response.status===200&&response.data?.status==='ready'&&marker(response));
    response=await formRequest('/api/hackathon');check('public_form_uses_shared_api',response.status===200&&response.data?.status==='ready'&&marker(response));

    const readCases=async()=>{
      const value=await apiRequest('/v1/demo/submissions');
      check('portal_list_available',value.status===200&&Array.isArray(value.data?.submissions)&&marker(value));
      return value.data.submissions;
    };
    const recoverReceipts=async()=>{
      const list=await readCases();if(!state)return list;
      for(const item of state.cases){
        const matches=list.filter(row=>row.notes?.curiosity===item.payload.notes.curiosity&&row.email===EMAIL&&row.first_name===item.payload.firstName&&row.data_class==='synthetic'&&row.fictional_confirmed===true);
        if(matches.length>1)fail('duplicate_fictional_cases');
        if(matches.length){const row=matches[0];if(!UUID.test(row.id)||!UUID.test(row.receipt_id)||(item.receiptId&&item.receiptId!==row.receipt_id))fail('saved_receipt_changed');item.receiptId=row.receipt_id;item.submissionId=row.id;}
      }
      save();return list;
    };

    if(submitFictional){
      if(!state){state=newRecoveryState();bytes=validateRecoveryState(state);save();}
      // Request IDs, exact answers and report bytes have been durably saved
      // before the first request which can create any remote record.
      await recoverReceipts();
      const submit=async(item,label)=>{
        if(!item.receiptId){
          item.saveAttempted=true;save();
          const result=await formRequest('/api/hackathon',{method:'POST',body:item.payload});
          if(result.status===201&&result.data?.status==='saved'&&UUID.test(result.data.receiptId||'')){
            item.receiptId=result.data.receiptId;item.confirmationEmail=result.data.confirmationEmail;save();
          }
          check(`${label}_saved_through_api`,result.status===201&&result.data?.status==='saved'&&item.receiptId===result.data?.receiptId&&marker(result));
        }
        if(!item.replayVerified){
          item.replayAttempted=true;save();
          const replay=await formRequest('/api/hackathon',{method:'POST',body:item.payload});
          check(`${label}_replay_same_receipt`,replay.status===201&&replay.data?.receiptId===item.receiptId&&marker(replay));
          item.replayVerified=true;item.confirmationEmail=replay.data.confirmationEmail;save();
        }
      };
      await submit(state.cases[0],'no_report');

      if(!state.cases[1].receiptId){
        if(!state.session){
          if(state.sessionCreationStarted)fail('session_creation_uncertain_manual_recovery_required');
          state.sessionCreationStarted=true;save();
          const session=await formRequest('/api/reports/sessions',{method:'POST',body:{}});
          if(session.status===201&&UUID.test(session.data?.sessionId||'')&&/^[A-Za-z0-9_-]{43}$/.test(session.data?.token||'')){
            state.session={id:session.data.sessionId,token:session.data.token,createdAt:new Date().toISOString()};save();
          }
          check('report_session_created_once',Boolean(state.session)&&marker(session));
        }
        const sessionHeaders={Authorization:`Bearer ${state.session.token}`,'X-Report-Session':state.session.id};
        // A completion may have committed even if its response was lost. Check
        // that idempotent operation before writing the quarantine object again.
        if(state.report.uploadAttempted&&state.report.id&&!state.report.completed){
          const recovered=await formRequest(`/api/reports/uploads/${state.report.id}/complete`,{method:'POST',body:{},headers:sessionHeaders});
          if(recovered.status===200&&recovered.data?.reportId===state.report.id&&['queued','processing','ready'].includes(recovered.data.status)){
            check('previous_upload_completion_recovered',marker(recovered));state.report.completed=true;save();
          } else if(recovered.status!==503)fail('previous_upload_requires_manual_recovery');
        }
        if(!state.report.completed){
          if(!state.report.uploadUrl||validateUploadUrl(state.report.uploadUrl,state.report.id).expiresSoon){
            const {name,type,size,sha256}=state.report;state.report.reservationAttempted=true;save();
            const reservation=await formRequest('/api/reports/uploads',{method:'POST',body:{name,type,size,sha256},headers:sessionHeaders});
            if(reservation.status===201&&UUID.test(reservation.data?.reportId||'')&&(!state.report.id||state.report.id===reservation.data.reportId)){
              validateUploadUrl(reservation.data.uploadUrl,reservation.data.reportId);
              state.report.id=reservation.data.reportId;state.report.uploadUrl=reservation.data.uploadUrl;save();
            }
            check('stable_report_reservation',reservation.status===201&&state.report.id===reservation.data?.reportId&&marker(reservation));
          }
          const destination=validateUploadUrl(state.report.uploadUrl,state.report.id);
          state.report.uploadAttempted=true;save();
          let uploaded;try{uploaded=await fetchImpl(destination.url,{method:'PUT',headers:{'Content-Type':state.report.type,'x-ms-blob-type':'BlockBlob'},body:bytes,redirect:'error',signal:AbortSignal.timeout(45000)});}catch{fail('upload_outcome_unknown_retry_same_state');}
          await uploaded.body?.cancel();
          check('fictional_original_uploaded_or_already_exists',[201,409,412].includes(uploaded.status));
          state.report.completionAttempted=true;save();
          const complete=await formRequest(`/api/reports/uploads/${state.report.id}/complete`,{method:'POST',body:{},headers:sessionHeaders});
          check('original_integrity_accepted',complete.status===200&&complete.data?.reportId===state.report.id&&['queued','processing','ready'].includes(complete.data.status)&&marker(complete));
          state.report.completed=true;save();
        }
        state.cases[1].payload.reportIds=[state.report.id];
        state.cases[1].payload.reportSession={id:state.session.id,token:state.session.token};save();
      }
      await submit(state.cases[1],'report');
      await recoverReceipts();
    }

    if(state?.cases.every(item=>item.receiptId)){
      const list=await recoverReceipts();
      for(const [index,item]of state.cases.entries())check(`case_${index+1}_visible_in_portal`,list.some(row=>row.id===item.submissionId&&row.receipt_id===item.receiptId));
      const reportCase=state.cases[1],attached=list.find(row=>row.id===reportCase.submissionId)?.attached_reports;
      check('uploaded_report_bound_to_case',Array.isArray(attached)&&attached.some(item=>item.id===state.report.id));
      response=await apiRequest(`/v1/demo/submissions/${reportCase.submissionId}/reports/${state.report.id}`);
      check('private_original_exact_bytes',response.status===200&&response.bytes.equals(bytes)&&HASH(response.bytes)===state.report.sha256&&response.headers.get('x-namat-content-sha256')===state.report.sha256&&Number(response.headers.get('content-length'))===bytes.length&&response.headers.get('content-type')==='application/pdf');
      response=await apiRequest(`/v1/demo/submissions/${state.cases[0].submissionId}/reports/${state.report.id}`);
      check('wrong_submission_cannot_read_report',response.status===404);
      if(waitProcessing){
        if(typeof keys.reviewer!=='string'||keys.reviewer.length<32)fail('reviewer_configuration_required_for_poll');
        const deadline=Date.now()+60000;let ready=false;
        while(Date.now()<deadline){
          const result=await apiRequest(`/v1/demo/reports/cases/${reportCase.submissionId}`,{key:keys.intake,headers:{Authorization:`Bearer ${keys.reviewer}`},timeout:Math.max(100,Math.min(10000,deadline-Date.now()))});
          const found=result.data?.reports?.find(item=>item.id===state.report.id);
          if(result.status===200&&found?.status==='ready'&&found.extraction){ready=true;break;}
          if(found?.status==='failed'||found?.status==='rejected')break;
          const delay=Math.min(5000,deadline-Date.now());if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));
        }
        check('native_pdf_processing_ready',ready);
      }
      report.syntheticSubmissions=2;
      report.confirmationStates=state.cases.map(item=>item.confirmationEmail||'not_observed');
    }
    report.passed=report.checks.filter(item=>item.pass).length;report.failed=report.checks.filter(item=>!item.pass).length;evidence();
    return {passed:report.passed,failed:report.failed,syntheticSubmissions:report.syntheticSubmissions||0,emailRecipient:EMAIL};
  } catch(error){
    report.failure=/^[a-z0-9_]+$/.test(error?.message||'')?error.message:'verification_incomplete';
    report.passed=report.checks.filter(item=>item.pass).length;report.failed=report.checks.filter(item=>!item.pass).length;evidence();
    throw new Error(report.failure);
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const args=process.argv.slice(2);
  if(args.includes('--help'))console.log('Usage: node scripts/verify-demo-rollout.mjs PRIVATE_SETTINGS_BUNDLE [--submit-fictional] [--wait-processing]\nRead-only by default. Reuse the same private bundle directory to resume. A successful provider acknowledgement does not prove inbox delivery.');
  else {
    try {
      if(!args[0]||args[0].startsWith('--')||args.slice(1).some(value=>!['--submit-fictional','--wait-processing'].includes(value)))fail('invalid_arguments');
      const result=await verifyDemoRollout({settingsPath:args[0],submitFictional:args.includes('--submit-fictional'),waitProcessing:args.includes('--wait-processing')});
      console.log(JSON.stringify(result));
    }catch(error){console.error(`Demo verification stopped: ${error.message}. Reuse the saved private recovery state before retrying.`);process.exitCode=1;}
  }
}
