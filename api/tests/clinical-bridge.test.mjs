import assert from 'node:assert/strict';
import test from 'node:test';
import {Readable} from 'node:stream';
import {randomBytes} from 'node:crypto';
import {createDemoBridge,demoRoute,DEMO_UPSTREAM} from '../services/namat-api/demo-bridge.mjs';
const intake=randomBytes(32).toString('hex'),portal=randomBytes(32).toString('hex'),upstream=randomBytes(32).toString('hex');
const env={NAMAT_API_DEMO_ENABLED:'true',NAMAT_API_MODE:'synthetic-local',NAMAT_DEMO_UPSTREAM_ORIGIN:DEMO_UPSTREAM,NAMAT_DEMO_INTAKE_TOKEN:intake,NAMAT_DEMO_PORTAL_TOKEN:portal,NAMAT_DEMO_UPSTREAM_TOKEN:upstream};
const sid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',rid='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const evidence=`/v1/demo/submissions/${sid}/reports/${rid}/evidence-v1`,storage='/v1/demo/analysis-store';
const request=(url,{key=portal,method='GET',body='',headers={}}={})=>Object.assign(Readable.from(body?[Buffer.from(body)]:[]),{url,method,headers:{'x-namat-service-key':key,...headers}});
test('clinical evidence and analysis storage have explicit portal-only routes',()=>{
  assert.deepEqual(demoRoute(evidence),{scope:'portal',methods:['GET'],upstream:`/api/namat-portal/submissions/${sid}/reports/${rid}/evidence-v1`});
  assert.deepEqual(demoRoute(storage),{scope:'portal',methods:['POST'],upstream:'/api/namat-portal/analysis-store'});
  for(const path of [evidence+'/extra',evidence+'?source=other',storage+'/extra',storage+'?operation=delete',`/v1/demo/submissions/${sid}/reports/legacy-0/evidence-v1`])assert.equal(demoRoute(path),null);
});
test('intake credentials cannot read clinical source evidence or invoke any analysis-store operation',async()=>{
  let calls=0;const bridge=createDemoBridge({env,fetcher:async()=>{calls++;return Response.json({});}});
  for(const [url,method]of [[evidence,'GET'],[storage,'POST']]){
    assert.equal((await bridge(request(url,{key:intake,method,body:method==='POST'?'{}':''}))).status,403);
    assert.equal((await bridge(request(url,{key:'invalid',method}))).status,401);
  }
  assert.equal((await bridge(request(evidence,{method:'POST'}))).status,405);
  assert.equal((await bridge(request(storage))).status,405);assert.equal(calls,0);
});
test('clinical forwarding uses exact internal aliases and independent upstream credentials',async()=>{
  const seen=[],bridge=createDemoBridge({env,fetcher:async(url,init)=>{seen.push({url,init});return Response.json({result:{ok:true}},{headers:{'x-namat-upstream-key':'never','set-cookie':'never=1'}});}});
  const payload=JSON.stringify({operation:'saveInventoryReview',input:{submissionId:sid,reportId:rid,extractionId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',reviewRevision:0,actor:'Fictional doctor'}});
  const result=await bridge(request(storage,{method:'POST',body:payload,headers:{'content-type':'application/json','x-namat-upstream-key':'spoofed',cookie:'private=1'}}));
  assert.equal(result.status,200);assert.equal(seen[0].url,DEMO_UPSTREAM+'/internal/namat/api/namat-portal/analysis-store');
  assert.equal(seen[0].init.body.toString(),payload);assert.equal(seen[0].init.headers['X-Namat-Upstream-Key'],upstream);
  assert.equal(seen[0].init.headers.cookie,undefined);assert.equal(seen[0].init.headers['x-namat-service-key'],undefined);assert.equal(seen[0].init.redirect,'error');
  assert.equal(result.headers['set-cookie'],undefined);assert.equal(result.headers['x-namat-upstream-key'],undefined);
  await bridge(request(evidence));assert.equal(seen[1].url,DEMO_UPSTREAM+`/internal/namat/api/namat-portal/submissions/${sid}/reports/${rid}/evidence-v1`);
});
test('clinical conflicts propagate once; malformed redirects fail without retries',async()=>{
  for(const status of [402,404,409]){
    let calls=0;const bridge=createDemoBridge({env,fetcher:async()=>{calls++;return Response.json({error:'fixture'},{status});}});
    assert.equal((await bridge(request(storage,{method:'POST',body:'{}'}))).status,status);assert.equal(calls,1);
  }
  let calls=0;const bridge=createDemoBridge({env,fetcher:async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://untrusted.invalid'}});}});
  assert.equal((await bridge(request(evidence))).status,502);assert.equal(calls,1);
});
