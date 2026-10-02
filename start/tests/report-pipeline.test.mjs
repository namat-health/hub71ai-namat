// End-to-end local evidence: real HTTP, a disposable PostgreSQL schema, disk
// object storage, structural parsing and the actual worker. All reports are
// fictional. OCR network calls are replaced by an explicit provider stub.
import {after,afterEach,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {once} from 'node:events';
import pg from 'pg';
import {PDFDocument,StandardFonts,PDFName,PDFString} from '@cantoo/pdf-lib';
import {createHackathonAzureServer} from '../src/hackathon/server/azure-server.mjs';
import {createReportService} from '../services/report-processing/service.mjs';
import {createReportStore} from '../services/report-processing/store.mjs';
import {createLocalBlobStore} from '../services/report-processing/local-blob.mjs';
import {processNextReport,cleanupExpiredReports} from '../services/report-processing/worker.mjs';
import {inspectDocument} from '../services/report-processing/document.mjs';
import {analyzeLayout} from '../services/report-processing/ocr.mjs';
import {input,answers,origin} from './hackathon-fixtures.mjs';

const databaseUrl=process.env.REPORT_TEST_DATABASE_URL;
if(databaseUrl&&!['localhost','127.0.0.1','[::1]'].includes(new URL(databaseUrl).hostname))throw new Error('Report pipeline tests require a loopback database.');
const enabled=Boolean(databaseUrl),schema=`report_pipeline_${randomUUID().replaceAll('-','')}`;
const scoped=sql=>sql.replaceAll('public.',`${schema}.`),digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const secret='synthetic-local-review-key-'+randomUUID();
let directory,admin,native,pool,env,server,service,baseUrl,schemaCreated=false;
before(async()=>{
  if(!enabled)return;
  directory=await mkdtemp(join(tmpdir(),'namat-report-pipeline-'));
  admin=new pg.Pool({connectionString:databaseUrl,max:1,connectionTimeoutMillis:5000});
  await admin.query(`CREATE SCHEMA ${schema}`);schemaCreated=true;
  native=new pg.Pool({connectionString:databaseUrl,max:8,connectionTimeoutMillis:5000});
  pool={query:(sql,params)=>native.query(scoped(sql),params),connect:async()=>{
    const client=await native.connect();return {query:(sql,params)=>client.query(scoped(sql),params),release:()=>client.release()};
  }};
  for(const path of ['../src/hackathon/db/001_welcome_submissions.sql','../src/hackathon/db/003_questionnaire_v2.sql','../services/report-processing/db/002_report_processing.sql'])await pool.query(await readFile(new URL(path,import.meta.url),'utf8'));
  env={HACKATHON_ENABLED:'true',HACKATHON_DATABASE_URL:databaseUrl,HACKATHON_ALLOWED_ORIGINS:origin,HACKATHON_EMAIL_MODE:'local',
    NAMAT_REPORTS_ENABLED:'true',NAMAT_REPORT_LOCAL_DIRECTORY:directory,NAMAT_REPORT_REVIEW_TOKEN:secret,NAMAT_OCR_DAILY_PAGE_LIMIT:'200'};
});
beforeEach(async()=>{
  if(!enabled)return;
  await pool.query(`TRUNCATE public.namat_report_reviews,public.namat_report_extractions,public.namat_report_jobs,
    public.namat_reports,public.namat_report_sessions,public.namat_report_ocr_budget,public.hackathon_email_outbox,public.hackathon_welcome_submissions CASCADE`);
  service=createReportService({pool,env,blobStore:createLocalBlobStore(directory,secret)});
  server=createHackathonAzureServer({env,pool,reportService:service});
  server.listen(0,'127.0.0.1');await once(server,'listening');baseUrl=`http://127.0.0.1:${server.address().port}`;
});
afterEach(async()=>{
  if(server){const closed=once(server,'close');server.close();server.closeAllConnections();await closed;server=null;}
});
after(async()=>{
  await native?.end();
  if(admin){if(schemaCreated)await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
  if(directory)await rm(directory,{recursive:true,force:true});
});
const check=(name,fn,options={})=>test(`report pipeline: ${name}`,{skip:!enabled,...options},fn);

async function request(path,{method='GET',body,session,reviewer=false,headers={}}={}) {
  const raw=Buffer.isBuffer(body)||body instanceof Uint8Array;
  const response=await fetch(new URL(path,baseUrl),{method,headers:{origin,
    ...(body!==undefined?{'content-type':raw?'application/pdf':'application/json'}:{}),
    ...(session?{'x-report-session':session.sessionId,authorization:`Bearer ${session.token}`}:{ }),
    ...(reviewer?{authorization:`Bearer ${secret}`}:{ }),...headers},
  ...(body!==undefined?{body:raw?body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(45000)});
  const bytes=Buffer.from(await response.arrayBuffer());
  let json;try{json=JSON.parse(bytes.toString('utf8'));}catch{}
  return {status:response.status,headers:response.headers,bytes,json};
}
function expectStatus(response,status) {assert.equal(response.status,status,JSON.stringify(response.json)||response.bytes.toString('utf8').slice(0,200));return response.json;}
async function newSession() {return expectStatus(await request('/api/reports/sessions',{method:'POST',body:{}}),201);}
async function labPdf({blank=false,active=false}={}) {
  const document=await PDFDocument.create(),font=await document.embedFont(StandardFonts.Helvetica),page=document.addPage([612,792]);
  if(!blank){
    for(const [index,line]of ['Fictional laboratory report for integration testing','Glucose 94 mg/dL 70-99','HbA1c 5.4 % 4.0-5.6','Ferritin 38 ng/mL 15-150'].entries())page.drawText(line,{x:45,y:740-index*30,size:12,font});
  }
  if(active)document.catalog.set(PDFName.of('OpenAction'),document.context.obj({S:'JavaScript',JS:PDFString.of('fixture-only')}));
  return Buffer.from(await document.save());
}
async function metadata(bytes,{session,name='fictional-lab.pdf',type='application/pdf'}={}) {
  session??=await newSession();
  const body={name,type,size:bytes.length,sha256:digest(bytes)};
  const result=expectStatus(await request('/api/reports/uploads',{method:'POST',session,body}),201);
  return {...result,session,metadata:body,bytes};
}
async function upload(bytes,options={}) {
  const record=await metadata(bytes,options);
  expectStatus(await request(record.uploadUrl,{method:'PUT',body:bytes,headers:{'x-ms-blob-type':'BlockBlob'}}),201);
  expectStatus(await request(`/api/reports/uploads/${record.reportId}/complete`,{method:'POST',session:record.session,body:{}}),200);
  return record;
}
function submissionBody(record,overrides={}) {
  return input({answers:answers({bloodwork:'yes'}),reports:[],reportIds:[record.reportId],
    reportSession:{id:record.session.sessionId,token:record.session.token},...overrides});
}
async function submit(record,overrides={}) {
  const body=submissionBody(record,overrides),saved=expectStatus(await request('/api/hackathon',{method:'POST',body}),201);
  return {body,saved};
}
async function details() {
  const listed=expectStatus(await request('/api/reports/cases',{reviewer:true}),200);assert.equal(listed.cases.length,1);
  const detail=expectStatus(await request(`/api/reports/cases/${listed.cases[0].id}`,{reviewer:true}),200);
  return {...detail,listed:listed.cases[0]};
}
const noOcr=async()=>{throw new Error('Native-text fixture unexpectedly used OCR.');};

check('upload, durable submission, restart, native extraction, source viewing and exact-version review work together',async()=>{
  const original=await labPdf(),originalHash=digest(original),record=await upload(original);
  assert.equal((await pool.query('SELECT 1 FROM public.namat_report_jobs')).rowCount,0);
  assert.deepEqual(expectStatus(await request('/api/reports/cases',{reviewer:true}),200),{cases:[]});
  const {body,saved}=await submit(record);
  assert.equal(saved.status,'saved');assert.equal(saved.confirmationEmail,'disabled');
  const replay=expectStatus(await request('/api/hackathon',{method:'POST',body}),201);assert.equal(replay.receiptId,saved.receiptId);
  expectStatus(await request('/api/hackathon',{method:'POST',body:{...body,firstName:'Changed'}}),409);
  assert.equal((await pool.query('SELECT 1 FROM public.hackathon_welcome_submissions')).rowCount,1);
  assert.equal((await pool.query('SELECT 1 FROM public.hackathon_email_outbox')).rowCount,1);
  assert.equal((await pool.query('SELECT 1 FROM public.namat_report_jobs')).rowCount,1);
  const staged=await details();assert.equal(staged.reports[0].status,'queued');assert.equal(staged.reports[0].extraction,null);
  // New adapter/store instances can recover all required state after a restart.
  const restarted={store:createReportStore(pool),blobs:createLocalBlobStore(directory,secret),env,ocr:noOcr};
  const processed=await processNextReport(restarted);assert.equal(processed.completed,true);assert.equal(processed.reportId,record.reportId);
  assert.deepEqual(await processNextReport(restarted),{worked:false});
  const extracted=await details(),report=extracted.reports[0];
  assert.equal(report.status,'ready');assert.equal(extracted.listed.reportCount,1);assert.equal(extracted.listed.readyCount,1);
  assert.deepEqual(report.extraction.observations.map(({name,value,unit,referenceRange,page})=>({name,value,unit,referenceRange,page})),[
    {name:'Glucose',value:'94',unit:'mg/dL',referenceRange:'70-99',page:1},
    {name:'HbA1c',value:'5.4',unit:'%',referenceRange:'4.0-5.6',page:1},
    {name:'Ferritin',value:'38',unit:'ng/mL',referenceRange:'15-150',page:1},
  ]);
  assert.ok(report.extraction.observations.every(observation=>observation.sourceText&&observation.bounds));
  assert.deepEqual(report.reviews,[]);assert.equal(report.extraction.inputSha256,originalHash);
  const source=await request(`/api/reports/${record.reportId}/source`,{reviewer:true});
  assert.equal(source.status,200);assert.equal(source.headers.get('content-type'),'application/pdf');assert.match(source.headers.get('cache-control'),/no-store/);
  assert.match(source.headers.get('content-security-policy'),/sandbox/);assert.equal(digest(source.bytes),originalHash);
  assert.equal(digest(await readFile(join(directory,'originals','reports',record.reportId))),originalHash);
  const corrections=report.extraction.observations.map((observation,index)=>index?observation:{...observation,value:'95'});
  const bypass=expectStatus(await request(`/api/reports/${record.reportId}/reviews`,{method:'POST',reviewer:true,
    body:{extractionId:report.extraction.id,expectedReviewRevision:0,observations:corrections,decision:'approved'}}),409);
  assert.equal(bypass.code,'save_corrections_first');
  for(const invalid of [{value:95},{page:99},{sourceText:null}]){
    const rejected=expectStatus(await request(`/api/reports/${record.reportId}/reviews`,{method:'POST',reviewer:true,
      body:{extractionId:report.extraction.id,expectedReviewRevision:0,observations:[{...corrections[0],...invalid}],decision:'corrected'}}),400);
    assert.equal(rejected.code,'invalid_observations');
  }
  const wrongExtraction=expectStatus(await request(`/api/reports/${record.reportId}/reviews`,{method:'POST',reviewer:true,
    body:{extractionId:randomUUID(),expectedReviewRevision:0,observations:report.extraction.observations,decision:'approved'}}),409);
  assert.equal(wrongExtraction.code,'stale_extraction');
  assert.equal((await pool.query('SELECT 1 FROM public.namat_report_reviews')).rowCount,0);
  const first=expectStatus(await request(`/api/reports/${record.reportId}/reviews`,{method:'POST',reviewer:true,
    body:{extractionId:report.extraction.id,expectedReviewRevision:0,observations:corrections,decision:'corrected'}}),201);
  assert.equal(first.review.revision,1);
  expectStatus(await request(`/api/reports/${record.reportId}/reviews`,{method:'POST',reviewer:true,
    body:{extractionId:report.extraction.id,expectedReviewRevision:0,observations:report.extraction.observations,decision:'approved'}}),409);
  const approved=expectStatus(await request(`/api/reports/${record.reportId}/reviews`,{method:'POST',reviewer:true,
    body:{extractionId:report.extraction.id,expectedReviewRevision:1,observations:corrections,decision:'approved'}}),201);
  assert.equal(approved.review.revision,2);
  const reviewed=(await details()).reports[0];assert.equal(reviewed.reviews[0].decision,'approved');assert.equal(reviewed.reviews[0].observations[0].value,'95');
  assert.equal(reviewed.extraction.observations[0].value,'94');assert.equal(digest(original),originalHash);
});

check('lost metadata, upload and completion responses can be retried without duplicate files or submissions',async()=>{
  const bytes=await labPdf(),record=await metadata(bytes);
  const retried=expectStatus(await request('/api/reports/uploads',{method:'POST',session:record.session,body:record.metadata}),201);
  assert.equal(retried.reportId,record.reportId);assert.equal(retried.status,'uploading');
  expectStatus(await request(record.uploadUrl,{method:'PUT',body:bytes}),201);
  // Simulates losing the successful PUT response. Create-only storage refuses
  // overwrite; completion independently checks the already-written bytes.
  const repeatedPut=await request(retried.uploadUrl,{method:'PUT',body:bytes});assert.ok([409,412].includes(repeatedPut.status),`expected create-only conflict, got ${repeatedPut.status}`);
  const finish=()=>request(`/api/reports/uploads/${record.reportId}/complete`,{method:'POST',session:record.session,body:{}});
  expectStatus(await finish(),200);expectStatus(await finish(),200);
  const metadataAfter=expectStatus(await request('/api/reports/uploads',{method:'POST',session:record.session,body:record.metadata}),201);
  assert.equal(metadataAfter.reportId,record.reportId);assert.equal(metadataAfter.status,'queued');
  assert.equal((await pool.query('SELECT 1 FROM public.namat_reports')).rowCount,1);
  const {body,saved}=await submit(record);
  const replays=await Promise.all(Array.from({length:4},()=>request('/api/hackathon',{method:'POST',body})));
  assert.ok(replays.every(response=>response.status===201&&response.json.receiptId===saved.receiptId));
  assert.equal((await pool.query('SELECT 1 FROM public.namat_report_jobs')).rowCount,1);
});

check('session ownership, operator access and origin checks protect upload completion, private sources and reviews',async()=>{
  const bytes=await labPdf(),record=await metadata(bytes),other=await newSession();
  expectStatus(await request('/api/reports/cases'),401);
  expectStatus(await request('/api/reports/cases',{headers:{authorization:'Bearer invalid'}}),401);
  expectStatus(await request('/api/reports/sessions',{method:'POST',body:{},headers:{origin:'https://other.invalid'}}),403);
  expectStatus(await request('/api/reports/sessions',{method:'POST',body:{},headers:{'sec-fetch-site':'cross-site'}}),403);
  expectStatus(await request('/api/reports/uploads',{method:'POST',body:record.metadata,session:{...record.session,token:other.token}}),401);
  expectStatus(await request(record.uploadUrl,{method:'PUT',body:bytes}),201);
  expectStatus(await request(`/api/reports/uploads/${record.reportId}/complete`,{method:'POST',body:{},session:other}),404);
  expectStatus(await request(`/api/reports/${record.reportId}/source`,{reviewer:true}),404);
  expectStatus(await request(`/api/reports/uploads/${record.reportId}/complete`,{method:'POST',body:{},session:record.session}),200);
  expectStatus(await request('/api/hackathon',{method:'POST',body:submissionBody(record,{reportSession:{id:other.sessionId,token:other.token}})}),400);
  assert.equal((await pool.query('SELECT 1 FROM public.hackathon_welcome_submissions')).rowCount,0);
  const {saved}=await submit(record);
  expectStatus(await request(`/api/reports/${record.reportId}/source`,{headers:{authorization:`Bearer ${saved.receiptId}`}}),401);
  expectStatus(await request(`/api/reports/${record.reportId}/reviews`,{method:'POST',session:record.session,body:{}}),401);
  expectStatus(await request(`/api/reports/${record.reportId}/source`,{reviewer:true,headers:{origin:'https://other.invalid'}}),403);
});

check('corrupt, active and changed files receive specific rejection and cannot create a submission',async()=>{
  for(const [name,bytes,expected]of [
    ['broken.pdf',Buffer.from('%PDF-1.7\nnot a real PDF\n%%EOF\n'),'invalid_document'],
    ['active.pdf',await labPdf({active:true}),'active_content'],
  ]){
    const record=await metadata(bytes,{name});expectStatus(await request(record.uploadUrl,{method:'PUT',body:bytes}),201);
    const rejected=expectStatus(await request(`/api/reports/uploads/${record.reportId}/complete`,{method:'POST',session:record.session,body:{}}),400);
    assert.equal(rejected.code,expected);assert.notEqual(rejected.message,expected);
    assert.equal((await service.store.getReport(record.reportId)).status,'rejected');
    expectStatus(await request('/api/hackathon',{method:'POST',body:submissionBody(record)}),400);
  }
  const bytes=await labPdf(),record=await metadata(bytes),changed=Buffer.from(bytes);changed[0]^=1;
  expectStatus(await request(record.uploadUrl,{method:'PUT',body:changed}),201);
  const rejected=expectStatus(await request(`/api/reports/uploads/${record.reportId}/complete`,{method:'POST',session:record.session,body:{}}),400);
  assert.equal(rejected.code,'hash_mismatch');assert.equal((await service.store.getReport(record.reportId)).status,'rejected');
  assert.equal((await pool.query('SELECT 1 FROM public.hackathon_welcome_submissions')).rowCount,0);
  assert.equal((await pool.query('SELECT 1 FROM public.namat_report_jobs')).rowCount,0);
});

check('scanned report calls the real OCR adapter with a stubbed provider, enforces budget and saves source-linked drafts',async()=>{
  const bytes=await labPdf({blank:true}),record=await upload(bytes);await submit(record);
  assert.equal((await inspectDocument(bytes,'application/pdf')).needsOcr,true);
  const endpoint='https://fictional-documents.cognitiveservices.azure.com/',operation=endpoint+'documentintelligence/documentModels/prebuilt-layout/analyzeResults/fictional?api-version=2024-11-30';
  const calls=[],credential={getToken:async scope=>{assert.equal(scope,'https://cognitiveservices.azure.com/.default');return {token:'synthetic-provider-token'};}};
  const fetcher=async(url,options)=>{
    calls.push({url,method:options.method||'GET'});assert.equal(options.headers.Authorization,'Bearer synthetic-provider-token');assert.equal(options.redirect,'error');
    if(options.method==='POST'){
      assert.equal(digest(options.body),digest(bytes));assert.equal(options.headers['Content-Type'],'application/pdf');
      return new Response('',{status:202,headers:{'operation-location':operation}});
    }
    assert.equal(url,operation);
    if(options.method==='DELETE')return new Response(null,{status:204});
    return Response.json({status:'succeeded',analyzeResult:{pages:[{pageNumber:1,unit:'inch',lines:[
      {content:'Glucose 102 mg/dL 70-99',polygon:[1,1,3,1,3,1.2,1,1.2]},
    ]}]}});
  };
  const result=await processNextReport({store:createReportStore(pool),blobs:createLocalBlobStore(directory,secret),env,
    ocr:(data,mime)=>analyzeLayout(data,mime,{env:{...env,NAMAT_DOCUMENT_ENDPOINT:endpoint},credential,fetcher,pause:async()=>{}})});
  assert.equal(result.completed,true);assert.deepEqual(calls.map(call=>call.method),['POST','GET','DELETE']);
  const extraction=(await details()).reports[0].extraction;
  assert.match(extraction.processorVersion,/:azure-layout$/);assert.equal(extraction.observations[0].value,'102');assert.equal(extraction.observations[0].sourceText,'Glucose 102 mg/dL 70-99');
  assert.equal((await pool.query('SELECT pages FROM public.namat_report_ocr_budget')).rows[0].pages,1);
  assert.equal(digest((await request(`/api/reports/${record.reportId}/source`,{reviewer:true})).bytes),digest(bytes));
});

check('worker storage restart and expired cleanup preserve live originals and remove expired files plus derived records',async()=>{
  const record=await upload(await labPdf());await submit(record);
  await processNextReport({store:service.store,blobs:service.blobs,env,ocr:noOcr});
  const live=await cleanupExpiredReports({store:createReportStore(pool),blobs:createLocalBlobStore(directory,secret),pool});assert.equal(live.deleted,0);
  assert.ok((await service.blobs.read(`reports/${record.reportId}`)).length);
  await pool.query("UPDATE public.namat_reports SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1",[record.reportId]);
  const cleaned=await cleanupExpiredReports({store:createReportStore(pool),blobs:createLocalBlobStore(directory,secret),pool});assert.equal(cleaned.deleted,1);
  await assert.rejects(readFile(join(directory,'originals','reports',record.reportId)),{code:'ENOENT'});
  assert.equal((await pool.query('SELECT 1 FROM public.namat_report_jobs')).rowCount,0);assert.equal((await pool.query('SELECT 1 FROM public.namat_report_extractions')).rowCount,0);
  expectStatus(await request(`/api/reports/${record.reportId}/source`,{reviewer:true}),404);
});

check('only an operator can retry a failed report after a provider outage and recovery needs no new upload',async()=>{
  const record=await upload(await labPdf({blank:true}));await submit(record);
  const unavailable=async()=>{const error=new Error('Synthetic provider outage');error.code='ocr_unavailable';throw error;};
  const failed=await processNextReport({store:service.store,blobs:service.blobs,env,ocr:unavailable});
  assert.equal(failed.completed,false);assert.equal((await details()).reports[0].status,'failed');
  const path=`/api/reports/${record.reportId}/retry`;
  expectStatus(await request(path,{method:'POST',body:{}}),401);
  expectStatus(await request(path,{method:'POST',body:{},session:record.session}),401);
  expectStatus(await request(path,{method:'POST',body:{},reviewer:true,headers:{origin:'https://other.invalid'}}),403);
  const retry=expectStatus(await request(path,{method:'POST',body:{},reviewer:true}),200);
  assert.equal(retry.report.id,record.reportId);assert.equal(retry.report.status,'queued');
  expectStatus(await request(path,{method:'POST',body:{},reviewer:true}),409);
  const ocr=async bytes=>{
    assert.equal(digest(bytes),digest(record.bytes));
    return {pageCount:1,pages:[{number:1,text:'Glucose 94 mg/dL 70-99',lines:[{text:'Glucose 94 mg/dL 70-99'}]}]};
  };
  const recovered=await processNextReport({store:createReportStore(pool),blobs:createLocalBlobStore(directory,secret),env,ocr});
  assert.equal(recovered.completed,true);assert.equal((await details()).reports[0].status,'ready');
  assert.equal((await pool.query('SELECT 1 FROM public.namat_reports')).rowCount,1);
  assert.equal((await pool.query('SELECT 1 FROM public.namat_report_jobs')).rowCount,1);
  assert.equal((await pool.query('SELECT pages FROM public.namat_report_ocr_budget')).rows[0].pages,2);
  expectStatus(await request(path,{method:'POST',body:{},reviewer:true}),409);
});

// Skip before the per-test HTTP/database setup. Skipping inside the callback
// after setup leaves its server open on Node 22 when the fixture is absent.
check('the supplied C2PA PDF uploads, processes and returns the byte-identical original when explicitly provided',async()=>{
  const bytes=await readFile(process.env.NAMAT_REPORT_SAMPLE_PATH),expectedHash=digest(bytes),record=await upload(bytes,{name:'example.pdf'});
  await submit(record);
  const result=await processNextReport({store:createReportStore(pool),blobs:createLocalBlobStore(directory,secret),env,ocr:noOcr});
  assert.equal(result.completed,true);
  const report=(await details()).reports[0];assert.equal(report.pageCount,3);assert.equal(report.extraction.pages.length,3);assert.equal(report.extraction.inputSha256,expectedHash);
  const source=await request(`/api/reports/${record.reportId}/source`,{reviewer:true});assert.equal(source.status,200);assert.equal(digest(source.bytes),expectedHash);
},{skip:!enabled||!process.env.NAMAT_REPORT_SAMPLE_PATH});
