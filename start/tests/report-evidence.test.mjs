import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {reportEvidenceResponse,reportExtractionResponse} from '../src/hackathon/server/portal-data.mjs';
import {createHackathonAzureServer} from '../src/hackathon/server/azure-server.mjs';
import {portalRoute} from '../src/hackathon/server/shared-api.mjs';
import {extractObservations} from '../services/report-processing/extract.mjs';
import {env as baseEnv} from './hackathon-fixtures.mjs';
const submissionId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',reportId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const extractionId='cccccccc-cccc-4ccc-8ccc-cccccccccccc',hash='a'.repeat(64);
const lines=['Collection date: 01/10/2026','ApoB 110 mg/dL <90','Unknown assay 42 units'];
const page={number:1,text:lines.join('\n'),lines:lines.map(text=>({text,bounds:{x:1,y:2,width:3,height:4}}))};
const row=(extra={})=>({id:reportId,submission_id:submissionId,data_class:'synthetic',fictional_confirmed:true,
  expires_at:'2099-01-01',submission_expires_at:'2099-01-01',status:'ready',mime:'application/pdf',page_count:1,
  extraction_id:extractionId,processor_version:'namat-lab-draft-2026-10-02.1:native',input_sha256:hash,
  extracted_at:'2026-10-02T00:00:00Z',pages:[page],observations:extractObservations([page]),warnings:[],review_revision:0,...extra});
const options=value=>({pool:{async query(){return {rows:[value]};}}});
const reference={submissionId,reportId};

test('versioned evidence keeps every source line and typed dates; old extraction remains unchanged',async()=>{
  const response=await reportEvidenceResponse(reference,options(row())),body=await response.json();
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.equal(body.evidenceVersion,'namat-report-evidence-v1');assert.equal(body.extraction.inputSha256,hash);
  assert.equal(body.extraction.pages[0].text,page.text);
  assert.equal(body.extraction.pages[0].lines[2].text,'Unknown assay 42 units');
  assert.equal(body.extraction.pages[0].lines[2].id,'page:1:line:2');
  assert.equal(body.extraction.observations[0].dateKind,'collection');
  assert.equal(body.extraction.observations[0].dateSourcePage,1);
  const old=await(await reportExtractionResponse(reference,options(row()))).json();
  assert.equal(old.evidenceVersion,undefined);assert.deepEqual(old.extraction.pages,[{number:1,unit:'pt'}]);
  assert.equal(old.extraction.observations[0].dateKind,undefined);
});

test('evidence enforces binding, expiry and synthetic scope',async()=>{
  for(const change of [{submission_id:reportId},{id:submissionId},{expires_at:'2000-01-01'},{submission_expires_at:'2000-01-01'},{data_class:'real'},{fictional_confirmed:false},{status:'rejected'}])
    assert.equal((await reportEvidenceResponse(reference,options(row(change)))).status,404);
  assert.equal((await reportEvidenceResponse({submissionId,reportId:'legacy-0'},options(row()))).status,404);
});

test('oversized or incomplete evidence fails rather than silently discarding data',async()=>{
  for(const change of [{page_count:2},{pages:[{...page,text:'x'.repeat(1000001)}]},{pages:[{...page,number:2}]},{observations:[{name:'ApoB',value:'1',page:'1'}]},
    {pages:Array.from({length:9},(_,i)=>({number:i+1,text:'x'.repeat(999999),lines:[]})),page_count:9}])
    assert.equal((await reportEvidenceResponse(reference,options(row(change)))).status,503);
});

test('reviewed dates inherit only unchanged, uniquely matched original provenance',async()=>{
  const original=row().observations[0],review={...original,value:'100',confirmed:true};
  delete review.dateKind;delete review.dateSourceText;delete review.dateSourcePage;
  const value=row({reviewed_revision:1,review_revision:1,review_decision:'corrected',reviewed_at:'2026-10-02T01:00:00Z',review_observations:[review]});
  let body=await(await reportEvidenceResponse(reference,options(value))).json();
  assert.equal(body.review.observations[0].dateKind,'collection');
  value.review_observations[0].date='02/10/2026';
  body=await(await reportEvidenceResponse(reference,options(value))).json();
  assert.equal(body.review.observations[0].dateKind,'unknown');assert.equal(body.review.observations[0].dateSourceText,null);
});

function dispatch(server,url,headers={}) {
  return new Promise(resolve=>{
    const req=Readable.from([]);Object.assign(req,{url,method:'GET',headers,socket:{remoteAddress:'127.0.0.1'}});
    const res=new EventEmitter();Object.assign(res,{headersSent:false,writableEnded:false,setHeader(){},
      writeHead(status){this.status=status;this.headersSent=true;},end(body=''){this.writableEnded=true;this.emit('finish');resolve({status:this.status,body:body.toString()});}});
    server.emit('request',req,res);
  });
}
test('evidence route is private and requires the independent internal key',async t=>{
  const intake='0123456789abcdef'.repeat(4),upstream='fedcba9876543210'.repeat(4);
  const env={...baseEnv,NAMAT_SHARED_API_ENABLED:'true',NAMAT_SHARED_API_INTAKE_TOKEN:intake,NAMAT_SHARED_API_UPSTREAM_TOKEN:upstream,NAMAT_REPORT_REVIEW_TOKEN:'1234567890abcdef'.repeat(4),NAMAT_REPORTS_ENABLED:'true'};
  const path=`/api/namat-portal/submissions/${submissionId}/reports/${reportId}/evidence-v1`;
  assert.deepEqual(portalRoute(path,'GET'),{kind:'evidence',...reference});assert.equal(portalRoute(path,'POST'),null);
  const server=createHackathonAzureServer({env,pool:options(row()).pool});t.after(()=>server.close());
  assert.equal((await dispatch(server,path,{'x-namat-upstream-key':upstream})).status,404);
  assert.equal((await dispatch(server,'/internal/namat'+path)).status,401);
  assert.equal((await dispatch(server,'/internal/namat'+path,{'x-namat-upstream-key':intake})).status,401);
  const result=await dispatch(server,'/internal/namat'+path,{'x-namat-upstream-key':upstream});
  assert.equal(result.status,200);assert.equal(JSON.parse(result.body).evidenceVersion,'namat-report-evidence-v1');
});
