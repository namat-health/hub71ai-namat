import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {createHackathonAzureServer} from '../src/hackathon/server/azure-server.mjs';
import {sharedApiConfig,sharedApiRoute,portalRoute,MAX_PROXY_RESPONSE_BYTES} from '../src/hackathon/server/shared-api.mjs';
import {listSubmissions,reportExtractionResponse,reportReviewResponse,reportSourceResponse} from '../src/hackathon/server/portal-data.mjs';
import {extractObservations} from '../services/report-processing/extract.mjs';
import {env as baseEnv,origin} from './hackathon-fixtures.mjs';

const intake='0123456789abcdef'.repeat(4),upstream='fedcba9876543210'.repeat(4),review='1234567890abcdef'.repeat(4);
const env={...baseEnv,NAMAT_SHARED_API_ENABLED:'true',NAMAT_SHARED_API_INTAKE_TOKEN:intake,NAMAT_SHARED_API_UPSTREAM_TOKEN:upstream,NAMAT_REPORT_REVIEW_TOKEN:review,NAMAT_REPORTS_ENABLED:'true'};
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',reportId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const active={data_class:'synthetic',fictional_confirmed:true,expires_at:'2099-01-01T00:00:00Z'};
const bytes=Buffer.from('%PDF-1.7\nfictional fixture only\n%%EOF');
const hash=createHash('sha256').update(bytes).digest('hex');

function dispatch(server,url,{method='GET',headers={},body=''}={}) {
  return new Promise(resolve=>{
    const req=Readable.from([Buffer.from(body)]);Object.assign(req,{url,method,headers,socket:{remoteAddress:'127.0.0.1'}});
    const res=new EventEmitter(),values={};
    Object.assign(res,{headersSent:false,writableEnded:false,setHeader(k,v){values[k.toLowerCase()]=v;},
      writeHead(status,headers){this.status=status;this.headersSent=true;for(const[k,v]of Object.entries(headers))values[k.toLowerCase()]=v;},
      end(body=''){this.writableEnded=true;this.emit('finish');resolve({status:this.status,headers:values,body:Buffer.isBuffer(body)?body.toString():body});}});
    server.emit('request',req,res);
  });
}

test('shared API is off by default and refuses incomplete enabled or reused credentials',()=>{
  assert.equal(sharedApiConfig({}).enabled,false);
  assert.equal(sharedApiConfig({NAMAT_SHARED_API_UPSTREAM_TOKEN:upstream}).enabled,false);
  for(const change of [
    {NAMAT_SHARED_API_INTAKE_TOKEN:''},{NAMAT_SHARED_API_UPSTREAM_TOKEN:''},
    {NAMAT_SHARED_API_ENABLED:'yes'},{NAMAT_SHARED_API_UPSTREAM_TOKEN:intake},
    {NAMAT_SHARED_API_INTAKE_TOKEN:review},{NAMAT_SHARED_API_UPSTREAM_TOKEN:'x'},
  ])assert.throws(()=>createHackathonAzureServer({env:{...env,...change}}));
});

test('proxy accepts only fixed methods and exact known routes',()=>{
  assert.equal(sharedApiRoute('/api/hackathon/','POST'),'/v1/demo/intake');
  assert.equal(sharedApiRoute(`/api/reports/uploads/${id}/complete`,'POST'),`/v1/demo/reports/uploads/${id}/complete`);
  for(const [path,method]of [['/api/reports/local-upload','PUT'],['/api/reports/anything','GET'],['/api/hackathon','DELETE'],['/api/reports/cases','POST'],['/api/reports/cases?x=y','GET']])assert.equal(sharedApiRoute(path,method),null);
});

test('public form proxy preserves browser credentials and never leaks service keys, cookies or upstream headers',async t=>{
  const calls=[];
  const server=createHackathonAzureServer({env,fetchImpl:async(url,options)=>{
    calls.push({url,options});return new Response('{"status":"saved"}',{status:201,headers:{'content-type':'application/json','set-cookie':'secret=1','x-namat-upstream-key':upstream}});
  }});t.after(()=>server.close());
  const body=JSON.stringify({test:'fictional'});
  const result=await dispatch(server,'/api/hackathon',{method:'POST',body,headers:{origin,'content-type':'application/json',authorization:'Bearer browser-session','x-report-session':id,cookie:'private=1','x-namat-upstream-key':'attacker','x-namat-service-key':'attacker'}});
  assert.equal(result.status,201);assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://namat-api-staging-uaen-001.azurewebsites.net/v1/demo/intake');
  assert.equal(calls[0].options.headers['X-Namat-Service-Key'],intake);
  assert.equal(calls[0].options.headers.authorization,'Bearer browser-session');
  assert.equal(calls[0].options.headers.origin,origin);assert.equal(calls[0].options.headers['x-report-session'],id);
  assert.equal(calls[0].options.headers.cookie,undefined);assert.equal(calls[0].options.headers['x-namat-upstream-key'],undefined);
  assert.equal(calls[0].options.body.toString(),body);assert.equal(calls[0].options.redirect,'error');
  assert.equal(result.headers['set-cookie'],undefined);assert.equal(result.headers['x-namat-upstream-key'],undefined);
  assert.ok(!JSON.stringify(result).includes(intake));assert.ok(!JSON.stringify(result).includes(upstream));
});

test('proxy does not retry or fall back after upstream failure; rejects oversized and redirected responses',async t=>{
  for(const response of [()=>{throw new Error(`provider ${upstream}`);},()=>new Response('redirect',{status:302}),()=>new Response('x',{headers:{'content-length':String(MAX_PROXY_RESPONSE_BYTES+1)}})]){
    let calls=0,database=0;
    const server=createHackathonAzureServer({env,pool:{query(){database++;}},fetchImpl:async()=>{calls++;return response();}});t.after(()=>server.close());
    const result=await dispatch(server,'/api/hackathon');
    assert.equal(result.status,502);assert.equal(calls,1);assert.equal(database,0);assert.ok(!result.body.includes(upstream));
  }
});

test('intake preflight and route evidence survive the same-origin proxy without exposing keys',async t=>{
  const server=createHackathonAzureServer({env,fetchImpl:async(url,options)=>{
    assert.equal(options.method,'OPTIONS');assert.equal(options.body,undefined);
    assert.equal(options.headers['access-control-request-method'],'POST');
    assert.equal(options.headers['access-control-request-headers'],'content-type');
    return new Response(null,{status:204,headers:{'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS',
      'access-control-allow-headers':'Content-Type','vary':'Origin','x-namat-api-route':'demo-v1','x-request-id':id,'x-namat-service-key':intake}});
  }});t.after(()=>server.close());
  const result=await dispatch(server,'/api/hackathon',{method:'OPTIONS',headers:{origin,'access-control-request-method':'POST','access-control-request-headers':'content-type'}});
  assert.equal(result.status,204);assert.equal(result.headers['access-control-allow-origin'],origin);
  assert.equal(result.headers['access-control-allow-methods'],'POST, OPTIONS');assert.equal(result.headers['access-control-allow-headers'],'Content-Type');
  assert.equal(result.headers.vary,'Origin');assert.equal(result.headers['x-namat-api-route'],'demo-v1');assert.equal(result.headers['x-request-id'],id);
  assert.equal(result.headers['x-namat-service-key'],undefined);
});

test('unknown routes and oversized bodies stop before shared API access',async t=>{
  let calls=0;const server=createHackathonAzureServer({env,fetchImpl:async()=>{calls++;throw Error('unexpected');}});t.after(()=>server.close());
  for(const path of ['/api/reports/local-upload','/api/reports/cases?other=1','/api/reports/%63ases'])assert.equal((await dispatch(server,path)).status,404);
  const large=await dispatch(server,'/api/hackathon',{method:'POST',headers:{'content-length':'4000001'}});
  assert.equal(large.status,413);assert.equal(calls,0);
});

test('internal aliases require the independent upstream key and bypass proxy exactly once',async t=>{
  let calls=0,reads=0;
  const pool={async query(){reads++;return {rows:[{ready:true},{ready:true}]};}};
  const server=createHackathonAzureServer({env,pool,fetchImpl:async()=>{calls++;throw Error('loop');}});t.after(()=>server.close());
  for(const value of [undefined,intake,review,'incorrect']){
    const res=await dispatch(server,'/internal/namat/api/hackathon',{headers:value?{'x-namat-upstream-key':value}:{}});
    assert.equal(res.status,401);
  }
  assert.equal(reads,0);
  const res=await dispatch(server,'/internal/namat/api/hackathon',{headers:{'x-namat-upstream-key':upstream}});
  assert.equal(res.status,200);assert.equal(JSON.parse(res.body).status,'ready');assert.equal(reads,1);assert.equal(calls,0);
  assert.equal((await dispatch(server,'/internal/namat/healthz',{headers:{'x-namat-upstream-key':upstream}})).status,404);
  assert.equal((await dispatch(server,'/internal/namat/api/hackathon?x=1',{headers:{'x-namat-upstream-key':upstream}})).status,400);
});

test('internal report transport preserves independent browser/reviewer auth for the data owner',async t=>{
  let calls=0;const service={async handle(req,res){calls++;assert.equal(req.url,`/api/reports/${id}/source`);assert.equal(req.headers.authorization,`Bearer ${review}`);assert.equal(req.headers['x-namat-upstream-key'],undefined);res.writeHead(200,{});res.end('fictional');}};
  const server=createHackathonAzureServer({env,reportService:service,pool:{}});t.after(()=>server.close());
  const result=await dispatch(server,`/internal/namat/api/reports/${id}/source`,{headers:{'x-namat-upstream-key':upstream,authorization:`Bearer ${review}`}});
  assert.equal(result.status,200);assert.equal(calls,1);
});

test('portal data routes stay private and return agreed readiness shape',async t=>{
  const pool={async query(){return {rows:[{ready:true},{ready:true}]};}};
  const server=createHackathonAzureServer({env,pool});t.after(()=>server.close());
  for(const path of ['/api/namat-portal/ready','/api/namat-portal/submissions'])assert.equal((await dispatch(server,path,{headers:{'x-namat-upstream-key':upstream}})).status,404);
  const result=await dispatch(server,'/internal/namat/api/namat-portal/ready',{headers:{'x-namat-upstream-key':upstream}});
  assert.equal(result.status,200);assert.deepEqual(JSON.parse(result.body),{status:'ready'});
  pool.query=async()=>{throw new Error('private database failure');};
  const failed=await dispatch(server,'/internal/namat/api/namat-portal/ready',{headers:{'x-namat-upstream-key':upstream}});
  assert.equal(failed.status,503);assert.deepEqual(JSON.parse(failed.body),{status:'unavailable'});
});

test('portal list preserves shapes and source URLs without returning stored bytes or blob keys',async()=>{
  const pool={async query(sql){return {rows:sql.includes('cardinality')?[{id,...active,answers:{},report_metadata:[],legacy_report_count:0,report_files:['PRIVATE']}]:[{id:reportId,submission_id:id,name:'fictional.pdf',mime:'application/pdf',size:bytes.length,sha256:hash,status:'ready',expires_at:active.expires_at,blob_key:'PRIVATE'}]};}};
  const rows=await listSubmissions(pool);
  assert.equal(rows[0].attached_reports[0].sourceUrl,`/api/submissions/${id}/reports/${reportId}/source`);
  assert.equal(rows[0].report_files,undefined);assert.ok(!JSON.stringify(rows).includes('PRIVATE'));
});

test('portal source checks exact submission/report binding, synthetic state, expiry and integrity',async()=>{
  const base={...active,id:reportId,submission_id:id,submission_expires_at:active.expires_at,name:'fictional.pdf',mime:'application/pdf',size:bytes.length,sha256:hash,status:'ready',blob_key:`reports/${reportId}`};
  const request=new Request('https://start.namat.health/internal/source');
  for(const change of [{submission_id:reportId},{id},{data_class:'real'},{fictional_confirmed:false},{expires_at:'2000-01-01'},{submission_expires_at:'2000-01-01'},{status:'rejected'}]){
    let reads=0;const result=await reportSourceResponse(request,{submissionId:id,reportId},{pool:{async query(){return {rows:[{...base,...change}]};}},blobs:{async read(){reads++;return bytes;}}});
    assert.equal(result.status,404);assert.equal(reads,0);
  }
  const result=await reportSourceResponse(request,{submissionId:id,reportId},{pool:{async query(sql,params){assert.deepEqual(params,[reportId,id]);assert.match(sql,/r\.submission_id=\$2/);return {rows:[base]};}},blobs:{async read(key){assert.equal(key,`reports/${reportId}`);return bytes;}}});
  assert.equal(result.status,200);assert.equal(result.headers.get('x-namat-content-sha256'),hash);assert.equal(result.headers.get('content-length'),String(bytes.length));assert.equal(Buffer.from(await result.arrayBuffer()).equals(bytes),true);
  const invalid=await reportSourceResponse(request,{submissionId:id,reportId},{pool:{async query(){return {rows:[base]};}},blobs:{async read(){return Buffer.from('wrong');}}});assert.equal(invalid.status,502);
});

test('legacy reports remain bound to the same active synthetic submission and metadata checksum',async()=>{
  const row={id,...active,metadata:{name:'sample.pdf',type:'application/pdf',size:bytes.length,sha256:hash},bytes};
  const request=new Request('https://start.namat.health/internal/source');
  const pool={async query(sql,params){assert.deepEqual(params,[id,0]);assert.match(sql,/WHERE id=\$1/);return {rows:[row]};}};
  const result=await reportSourceResponse(request,{submissionId:id,reportId:'legacy-0'},{pool});
  assert.equal(result.status,200);assert.equal(result.headers.get('x-namat-content-sha256'),hash);
  row.id=reportId;assert.equal((await reportSourceResponse(request,{submissionId:id,reportId:'legacy-0'},{pool})).status,404);
});

const extractionId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const draftRow=(change={})=>({...active,id:reportId,submission_id:id,submission_expires_at:active.expires_at,mime:'application/pdf',status:'ready',page_count:1,
  extraction_id:extractionId,processor_version:'namat-lab-draft-2026-10-01.1:native',extracted_at:new Date('2026-10-01T10:00:00Z'),
  pages:[{number:1,text:'PRIVATE PAGE TEXT',lines:[{text:'PRIVATE PAGE TEXT'}]}],
  observations:extractObservations([{number:1,lines:[{text:'Glucose 94 mg/dL 70 - 99',bounds:{x:45,y:60,width:200,height:14}},{text:'HbA1c 5.4 % 4.0 - 5.6'}]}]),
  warnings:['Draft values require comparison with the source report.'],...change});

test('portal extraction route accepts GET on stored report IDs only',()=>{
  assert.deepEqual(portalRoute(`/api/namat-portal/submissions/${id}/reports/${reportId}/extraction`,'GET'),{kind:'extraction',submissionId:id,reportId});
  for(const [path,method] of [[`/api/namat-portal/submissions/${id}/reports/legacy-0/extraction`,'GET'],[`/api/namat-portal/submissions/${id}/reports/${reportId}/extraction`,'POST'],
    [`/api/namat-portal/submissions/${id}/reports/${reportId}/extraction/more`,'GET'],[`/api/namat-portal/submissions/${id}/extraction`,'GET']])assert.equal(portalRoute(path,method),null);
});

test('portal extraction returns the latest bound draft without page text, unknown fields or reviews',async()=>{
  const row=draftRow({observations:[...draftRow().observations,{name:'Malformed',value:'1',page:'1'}]});
  const result=await reportExtractionResponse({submissionId:id,reportId},{pool:{async query(sql,params){
    assert.deepEqual(params,[reportId,id]);assert.match(sql,/r\.submission_id=\$2/);assert.match(sql,/ORDER BY created_at DESC,id DESC LIMIT 1/);return {rows:[row]};}}});
  assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'private, no-store');
  const body=await result.json();
  assert.deepEqual(body.report,{id:reportId,status:'ready',pageCount:1});
  assert.equal(body.extraction.id,extractionId);assert.equal(body.extraction.createdAt,'2026-10-01T10:00:00.000Z');
  assert.deepEqual(body.extraction.pages,[{number:1,unit:'pt'}]);
  assert.equal(body.extraction.observations.length,2);
  assert.deepEqual(body.extraction.observations[0],{name:'Glucose',value:'94',unit:'mg/dL',referenceRange:'70 - 99',date:null,sourceText:'Glucose 94 mg/dL 70 - 99',page:1,bounds:{x:45,y:60,width:200,height:14}});
  assert.equal(body.extraction.observations[1].bounds,null);assert.equal(body.extraction.observations[1].reviewRequired,undefined);
  assert.deepEqual(body.extraction.warnings,['Draft values require comparison with the source report.']);
  assert.ok(!JSON.stringify(body).includes('PRIVATE'));
});

test('portal extraction reports OCR units, pending drafts and the exact binding',async()=>{
  const polygon=[1,1,2,1,2,2,1,2];
  const ocr=draftRow({mime:'image/png',processor_version:'namat-lab-draft-2026-10-01.1:azure-layout',pages:[{number:1,lines:[{text:'Glucose 94',bounds:polygon,fromTable:true}]}],observations:[{name:'Glucose',value:'94',page:1,bounds:polygon}]});
  const read=row=>reportExtractionResponse({submissionId:id,reportId},{pool:{async query(){return {rows:[row]};}}});
  let body=await (await read(ocr)).json();
  assert.deepEqual(body.extraction.pages,[{number:1,unit:'pixel'}]);assert.deepEqual(body.extraction.observations[0].bounds,polygon);
  assert.equal((await (await read({...ocr,mime:'application/pdf'})).json()).extraction.pages[0].unit,'inch');
  assert.equal((await (await read({...ocr,pages:[{number:1,lines:[{text:'x',unit:'pixel'}]}]})).json()).extraction.pages[0].unit,'pixel');
  body=await (await read(draftRow({status:'processing',page_count:null,extraction_id:null,processor_version:null,pages:null,observations:null,warnings:null}))).json();
  assert.deepEqual(body,{report:{id:reportId,status:'processing',pageCount:null},extraction:null,review:null,reviewRevision:0});
  for(const change of [{submission_id:reportId},{id},{data_class:'real'},{fictional_confirmed:false},{expires_at:'2000-01-01'},{submission_expires_at:'2000-01-01'},{status:'rejected'}])
    assert.equal((await read(draftRow(change))).status,404);
  assert.equal((await reportExtractionResponse({submissionId:id,reportId:'legacy-0'},{pool:{async query(){throw new Error('unexpected');}}})).status,404);
  const failed=await reportExtractionResponse({submissionId:id,reportId},{pool:{async query(){throw new Error('private database failure');}}});
  assert.equal(failed.status,503);assert.ok(!(await failed.text()).includes('private'));
});

test('internal extraction route is private and returns the agreed JSON shape',async t=>{
  const pool={async query(sql){return {rows:sql.includes('namat_report_extractions')?[draftRow()]:[{ready:true},{ready:true}]};}};
  const server=createHackathonAzureServer({env,pool});t.after(()=>server.close());
  const path=`/api/namat-portal/submissions/${id}/reports/${reportId}/extraction`;
  assert.equal((await dispatch(server,path,{headers:{'x-namat-upstream-key':upstream}})).status,404);
  assert.equal((await dispatch(server,'/internal/namat'+path)).status,401);
  const result=await dispatch(server,'/internal/namat'+path,{headers:{'x-namat-upstream-key':upstream}});
  assert.equal(result.status,200);assert.match(result.headers['content-type'],/^application\/json/);
  assert.equal(JSON.parse(result.body).extraction.observations[0].name,'Glucose');
  assert.equal((await dispatch(server,`/internal/namat/api/namat-portal/submissions/${id}/reports/legacy-0/extraction`,{headers:{'x-namat-upstream-key':upstream}})).status,404);
});

test('portal extraction includes the latest review of the current draft and the report revision',async()=>{
  const reviewed=draftRow({reviewed_revision:3,review_decision:'corrected',reviewed_at:new Date('2026-10-01T11:00:00Z'),review_revision:4,
    review_observations:[{name:'Glucose',value:'94',unit:'mg/dL',referenceRange:'70 - 99',date:null,sourceText:'Glucose 94 mg/dL 70 - 99',page:1,confirmed:true},
      {name:'HbA1c',value:'5.4',unit:'%',referenceRange:'4.0 - 5.6',date:null,sourceText:'HbA1c 5.4 % 4.0 - 5.6',page:1,internal:'SECRET'}]});
  let sql;
  const body=await (await reportExtractionResponse({submissionId:id,reportId},{pool:{async query(text){sql=text;return {rows:[reviewed]};}}})).json();
  assert.match(sql,/extraction_id=e\.id ORDER BY revision DESC LIMIT 1/);assert.match(sql,/COALESCE\(MAX\(revision\),0\)/);
  assert.equal(body.reviewRevision,4);
  assert.deepEqual(body.review,{revision:3,decision:'corrected',createdAt:'2026-10-01T11:00:00.000Z',observations:[
    {name:'Glucose',value:'94',unit:'mg/dL',referenceRange:'70 - 99',date:null,sourceText:'Glucose 94 mg/dL 70 - 99',page:1,confirmed:true},
    {name:'HbA1c',value:'5.4',unit:'%',referenceRange:'4.0 - 5.6',date:null,sourceText:'HbA1c 5.4 % 4.0 - 5.6',page:1,confirmed:false}]});
  assert.ok(!JSON.stringify(body).includes('SECRET'));
  const unreviewed=await (await reportExtractionResponse({submissionId:id,reportId},{pool:{async query(){return {rows:[draftRow({review_revision:2})]};}}})).json();
  assert.equal(unreviewed.review,null);assert.equal(unreviewed.reviewRevision,2);
});

const reviewBody=(change={})=>({extractionId,expectedReviewRevision:0,observations:[{name:'Glucose',value:'94',page:1,sourceText:'Glucose 94',confirmed:true}],actor:'Dr. Fictional (microsoft:11111111-1111-4111-8111-111111111111)',...change});
const boundRow=(change={})=>({...active,id:reportId,submission_id:id,submission_expires_at:active.expires_at,...change});

test('portal review saves the next corrected revision for the bound report only',async()=>{
  const saved=[];
  const store={async saveReview(report,input,actor){saved.push({report,input,actor});return {revision:1,createdAt:new Date('2026-10-01T12:00:00Z')};}};
  const pool={async query(sql,params){assert.deepEqual(params,[reportId,id]);assert.match(sql,/r\.submission_id=\$2/);return {rows:[boundRow()]};}};
  const result=await reportReviewResponse({submissionId:id,reportId},{pool,store,body:reviewBody({actor:'  Dr. Fictional (microsoft:x)  '})});
  assert.equal(result.status,200);assert.deepEqual(await result.json(),{review:{revision:1,createdAt:'2026-10-01T12:00:00.000Z'}});
  assert.deepEqual(saved,[{report:reportId,input:{extractionId,observations:reviewBody().observations,decision:'corrected',expectedReviewRevision:0},actor:'Dr. Fictional (microsoft:x)'}]);
  for(const change of [{submission_id:reportId},{data_class:'real'},{fictional_confirmed:false},{expires_at:'2000-01-01'},{submission_expires_at:'2000-01-01'}]){
    const before=saved.length;
    assert.equal((await reportReviewResponse({submissionId:id,reportId},{pool:{async query(){return {rows:[boundRow(change)]};}},store,body:reviewBody()})).status,404);
    assert.equal(saved.length,before);
  }
});

test('portal review refuses malformed input before any read and keeps store conflicts',async()=>{
  let reads=0;const pool={async query(){reads++;return {rows:[boundRow()]};}};
  const store={async saveReview(){throw new Error('unexpected');}};
  for(const body of [null,[],reviewBody({extractionId:'x'}),reviewBody({expectedReviewRevision:-1}),reviewBody({expectedReviewRevision:1.5}),
    reviewBody({observations:'all'}),reviewBody({actor:''}),reviewBody({actor:'a\nb'}),reviewBody({actor:'x'.repeat(257)}),{...reviewBody(),decision:'approved'}])
    assert.equal((await reportReviewResponse({submissionId:id,reportId},{pool,store,body})).status,400);
  assert.equal((await reportReviewResponse({submissionId:id,reportId:'legacy-0'},{pool,store,body:reviewBody()})).status,404);
  assert.equal(reads,0);
  const failing=code=>({async saveReview(){const error=new Error(code);error.name='ReportStoreError';error.code=code;error.status=code==='invalid_observations'?400:409;throw error;}});
  for(const [code,status] of [['stale_review',409],['stale_extraction',409],['report_not_ready',409],['invalid_observations',400]]){
    const result=await reportReviewResponse({submissionId:id,reportId},{pool,store:failing(code),body:reviewBody()});
    assert.equal(result.status,status);assert.deepEqual(await result.json(),{status:'error',code});
  }
  const broken=await reportReviewResponse({submissionId:id,reportId},{pool,store:{async saveReview(){throw new Error('private database failure');}},body:reviewBody()});
  assert.equal(broken.status,503);assert.ok(!(await broken.text()).includes('private'));
});

test('internal review route is a private JSON POST with bounded input',async t=>{
  const saved=[];
  const pool={async query(){return {rows:[boundRow()]};}};
  const service={store:{async saveReview(report,input,actor){saved.push({report,input,actor});return {revision:2,createdAt:new Date('2026-10-01T12:00:00Z')};}}};
  const server=createHackathonAzureServer({env,pool,reportService:service});t.after(()=>server.close());
  const path=`/api/namat-portal/submissions/${id}/reports/${reportId}/reviews`;
  // The server strips the upstream key from each authenticated request's headers.
  const headers=()=>({'x-namat-upstream-key':upstream,'content-type':'application/json'});
  assert.deepEqual(portalRoute(path,'POST'),{kind:'review',submissionId:id,reportId});
  assert.equal(portalRoute(path,'GET'),null);
  assert.equal((await dispatch(server,path,{method:'POST',headers:headers(),body:JSON.stringify(reviewBody())})).status,404);
  assert.equal((await dispatch(server,'/internal/namat'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(reviewBody())})).status,401);
  assert.equal((await dispatch(server,'/internal/namat'+path,{method:'POST',headers:{...headers(),'content-type':'text/plain'},body:JSON.stringify(reviewBody())})).status,415);
  assert.equal((await dispatch(server,'/internal/namat'+path,{method:'POST',headers:headers(),body:'{not json'})).status,400);
  assert.equal((await dispatch(server,'/internal/namat'+path,{method:'POST',headers:{...headers(),'content-length':'4000001'}})).status,413);
  assert.equal(saved.length,0);
  const result=await dispatch(server,'/internal/namat'+path,{method:'POST',headers:headers(),body:JSON.stringify(reviewBody())});
  assert.equal(result.status,200);assert.equal(JSON.parse(result.body).review.revision,2);
  assert.equal(saved.length,1);assert.equal(saved[0].input.decision,'corrected');
});
