import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createDemoBridge,demoBridgeConfig,demoRoute,DEMO_UPSTREAM} from '../services/namat-api/demo-bridge.mjs';
import {createNamatApiServer} from '../services/namat-api/server.mjs';
const intake=randomBytes(32).toString('hex'),portal=randomBytes(32).toString('hex'),upstream=randomBytes(32).toString('hex');
const env={NAMAT_API_DEMO_ENABLED:'true',NAMAT_API_MODE:'synthetic-local',NAMAT_DEMO_UPSTREAM_ORIGIN:DEMO_UPSTREAM,NAMAT_DEMO_INTAKE_TOKEN:intake,NAMAT_DEMO_PORTAL_TOKEN:portal,NAMAT_DEMO_UPSTREAM_TOKEN:upstream};
const request=(url,{key=intake,method='GET',body,headers={}}={})=>Object.assign(Readable.from(body?[Buffer.from(body)]:[]),{url,method,headers:{'x-namat-service-key':key,...headers}});
const json=result=>JSON.parse(result.body.toString());
test('disabled bridge and partial enabled settings fail closed',async()=>{
 assert.equal(demoBridgeConfig({}),null);
 assert.throws(()=>demoBridgeConfig({NAMAT_API_DEMO_ENABLED:'true'}));
 for(const origin of ['https://evil.invalid',DEMO_UPSTREAM+'/',DEMO_UPSTREAM+'/path','https://name:secret@namat-welcome-test-uaen-001.azurewebsites.net'])assert.throws(()=>demoBridgeConfig({...env,NAMAT_DEMO_UPSTREAM_ORIGIN:origin}));
 assert.throws(()=>demoBridgeConfig({...env,NAMAT_DEMO_PORTAL_TOKEN:intake}));
 assert.equal((await createDemoBridge({env:{}})(request('/v1/demo/intake'))).status,503);
});
test('service scopes cannot read each other’s routes or invoke unsupported methods',async()=>{
 let calls=0;const bridge=createDemoBridge({env,fetcher:async()=>{calls++;return Response.json({});}});
 assert.equal((await bridge(request('/v1/demo/submissions'))).status,403);
 assert.equal((await bridge(request('/v1/demo/intake',{key:portal}))).status,403);
 assert.equal((await bridge(request('/v1/demo/intake',{key:'wrong'}))).status,401);
  assert.equal((await bridge(request('/v1/demo/submissions',{key:portal,method:'DELETE'}))).status,405);
  assert.equal((await bridge(request('/v1/demo/reports/sessions',{method:'OPTIONS'}))).status,405);
 for(const path of ['/v1/demo/intake?target=https://evil.invalid','/v1/demo/../healthz','/v1/demo/reports/uploads/not-an-id/complete','/v1/demo/submissions/'+randomUUID()+'/reports/legacy-3'])assert.equal((await bridge(request(path,{key:portal}))).status,404);
 assert.equal(calls,0);
});
test('intake forwards one exact body and original request ID without leaking service credentials',async()=>{
 const payload=JSON.stringify({requestId:randomUUID(),reports:[],reportIds:[randomUUID()],reportSession:{id:randomUUID(),token:'session-example'}});
 const seen=[];const bridge=createDemoBridge({env,fetcher:async(url,options)=>{seen.push({url,options});return Response.json({status:'saved',receiptId:randomUUID(),confirmationEmail:'sent'},{status:201});}});
 const result=await bridge(request('/v1/demo/intake',{method:'POST',body:payload,headers:{origin:'https://start.namat.health','content-type':'application/json',cookie:'private-cookie','x-namat-upstream-key':'attacker'}}));
 assert.equal(result.status,201);assert.equal(seen.length,1);
 assert.equal(seen[0].url,DEMO_UPSTREAM+'/internal/namat/api/hackathon');
 assert.equal(seen[0].options.body.toString(),payload);assert.equal(seen[0].options.redirect,'error');
 assert.equal(seen[0].options.headers['X-Namat-Upstream-Key'],upstream);
 assert.equal(seen[0].options.headers.origin,'https://start.namat.health');
 assert.equal(seen[0].options.headers.cookie,undefined);
 assert.equal(seen[0].options.headers['x-namat-service-key'],undefined);
 assert.equal(result.headers['x-namat-api-route'],'demo-v1');
});
test('report sessions preserve their user credential independently of service authentication',async()=>{
 const id=randomUUID();let seen;
 const bridge=createDemoBridge({env,fetcher:async(url,options)=>{seen={url,options};return Response.json({reportId:id,status:'uploaded'});}});
 await bridge(request(`/v1/demo/reports/uploads/${id}/complete`,{method:'POST',body:'{}',headers:{authorization:'Bearer user-session','x-report-session':'session-id','sec-fetch-site':'cross-site'}}));
 assert.equal(seen.options.headers.authorization,'Bearer user-session');assert.equal(seen.options.headers['x-report-session'],'session-id');
 assert.equal(seen.options.headers['sec-fetch-site'],'cross-site');
 assert.equal(seen.url,DEMO_UPSTREAM+`/internal/namat/api/reports/uploads/${id}/complete`);
});
test('private source bytes and integrity metadata survive the bridge',async()=>{
 const bytes=Buffer.from('%PDF-1.7\nfictional fixture'),hash=createHash('sha256').update(bytes).digest('hex');
 const bridge=createDemoBridge({env,fetcher:async()=>new Response(bytes,{headers:{'content-type':'application/pdf','content-length':String(bytes.length),'x-namat-content-sha256':hash,'set-cookie':'never=forward'}})});
 const result=await bridge(request(`/v1/demo/submissions/${randomUUID()}/reports/legacy-0`,{key:portal}));
 assert.deepEqual(result.body,bytes);assert.equal(result.headers['x-namat-content-sha256'],hash);assert.equal(result.headers['set-cookie'],undefined);
});
test('conflicts and rate limits preserve status without automatic retries',async()=>{
 for(const status of [409,429,503]){
  let count=0;const bridge=createDemoBridge({env,fetcher:async()=>{count++;return Response.json({status:'error'},{status,headers:{'retry-after':'61'}});}});
  const result=await bridge(request('/v1/demo/intake',{method:'POST',body:'{}'}));assert.equal(result.status,status);assert.equal(result.headers['retry-after'],'61');assert.equal(count,1);
 }
});
test('ambiguous upstream failure remains generic and never retries or falls back',async()=>{
 let count=0;const bridge=createDemoBridge({env,fetcher:async()=>{count++;throw new Error(upstream+' private request details');}});
 const result=await bridge(request('/v1/demo/intake',{method:'POST',body:'{}'}));
 assert.equal(result.status,502);assert.equal(json(result).code,'upstream_unavailable');assert.equal(count,1);assert.ok(!result.body.includes(upstream));
});
test('oversized request and response are rejected with bounded buffering',async()=>{
 let count=0;const bridge=createDemoBridge({env,fetcher:async()=>{count++;return new Response('x',{headers:{'content-length':String(13*1024*1024)}});}});
 assert.equal((await bridge(request('/v1/demo/intake',{method:'POST',headers:{'content-length':'4000001'}}))).status,413);assert.equal(count,0);
 assert.equal((await bridge(request('/v1/demo/intake'))).status,502);assert.equal(count,1);
});
test('per-consumer rate and shared concurrency limits recover',async()=>{
 let unblock;const bridge=createDemoBridge({env,maxInFlight:1,maxRequests:2,fetcher:()=>new Promise(resolve=>{unblock=()=>resolve(Response.json({}));})});
 const pending=bridge(request('/v1/demo/intake'));await new Promise(r=>setImmediate(r));
 assert.equal((await bridge(request('/v1/demo/ready',{key:portal}))).status,429);
 unblock();assert.equal((await pending).status,200);
 const next=bridge(request('/v1/demo/intake'));await new Promise(r=>setImmediate(r));unblock();assert.equal((await next).status,200);
 assert.equal((await bridge(request('/v1/demo/intake'))).status,429);
});
test('real HTTP bridge authenticates and refuses redirects with no second request',async()=>{
 let calls=0,mode='ready';const backend=createServer((req,res)=>{
  calls++;assert.equal(req.headers['x-namat-upstream-key'],upstream);
  if(mode==='redirect'){res.writeHead(302,{location:'/must-not-follow'});res.end();return;}
  assert.equal(req.url,'/internal/namat/api/namat-portal/ready');res.writeHead(200,{'content-type':'application/json'});res.end('{"status":"ready"}');
 });backend.listen(0,'127.0.0.1');await once(backend,'listening');
 const configured={...env,NAMAT_DEMO_UPSTREAM_ORIGIN:`http://127.0.0.1:${backend.address().port}`};
 const api=createNamatApiServer({env:configured,store:{ready:async()=>true}});api.listen(0,'127.0.0.1');await once(api,'listening');
 const base=`http://127.0.0.1:${api.address().port}`;
 try{
  assert.equal((await fetch(base+'/v1/demo/ready')).status,401);
  const response=await fetch(base+'/v1/demo/ready',{headers:{'X-Namat-Service-Key':portal}});assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:'ready'});
  mode='redirect';assert.equal((await fetch(base+'/v1/demo/ready',{headers:{'X-Namat-Service-Key':portal}})).status,502);assert.equal(calls,2);
 }finally{api.closeAllConnections();backend.closeAllConnections();await Promise.all([new Promise(r=>api.close(r)),new Promise(r=>backend.close(r))]);}
});
test('real HTTP report response has one exact media type and preserves its bytes',async()=>{
 const bytes=Buffer.from('%PDF-1.7\nfictional original'),hash=createHash('sha256').update(bytes).digest('hex');
 const backend=createServer((req,res)=>{
  assert.equal(req.headers['x-namat-upstream-key'],upstream);
  res.writeHead(200,{'Content-Type':'application/pdf','Content-Length':String(bytes.length),'X-Namat-Content-Sha256':hash,'Cache-Control':'private, no-store'});res.end(bytes);
 });backend.listen(0,'127.0.0.1');await once(backend,'listening');
 const api=createNamatApiServer({env:{...env,NAMAT_DEMO_UPSTREAM_ORIGIN:`http://127.0.0.1:${backend.address().port}`},store:{ready:async()=>true}});
 api.listen(0,'127.0.0.1');await once(api,'listening');
 try{
  const response=await fetch(`http://127.0.0.1:${api.address().port}/v1/demo/submissions/${randomUUID()}/reports/legacy-0`,{headers:{'X-Namat-Service-Key':portal}});
  assert.equal(response.status,200);
  assert.equal(response.headers.get('content-type'),'application/pdf');
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.equal(response.headers.get('content-length'),String(bytes.length));
  assert.equal(response.headers.get('x-namat-content-sha256'),hash);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
 }finally{api.closeAllConnections();backend.closeAllConnections();await Promise.all([new Promise(r=>api.close(r)),new Promise(r=>backend.close(r))]);}
});
test('portal extraction reads are portal-scoped GETs on stored report IDs',async()=>{
 const submission=randomUUID(),report=randomUUID(),path=`/v1/demo/submissions/${submission}/reports/${report}/extraction`;
 assert.deepEqual(demoRoute(path),{scope:'portal',methods:['GET'],upstream:`/api/namat-portal/submissions/${submission}/reports/${report}/extraction`});
 for(const other of [`/v1/demo/submissions/${submission}/reports/legacy-0/extraction`,`${path}/more`,`/v1/demo/submissions/${submission}/extraction`])assert.equal(demoRoute(other),null);
 let seen=[];const bridge=createDemoBridge({env,fetcher:async(url,options)=>{seen.push({url,options});return Response.json({report:{id:report,status:'ready',pageCount:1},extraction:null});}});
 assert.equal((await bridge(request(path))).status,403);
 assert.equal((await bridge(request(path,{key:portal,method:'POST'}))).status,405);
 assert.equal(seen.length,0);
 const result=await bridge(request(path,{key:portal,headers:{cookie:'private-cookie'}}));
 assert.equal(result.status,200);assert.equal(seen.length,1);
 assert.equal(seen[0].url,DEMO_UPSTREAM+`/internal/namat/api/namat-portal/submissions/${submission}/reports/${report}/extraction`);
 assert.equal(seen[0].options.method,'GET');assert.equal(seen[0].options.headers['X-Namat-Upstream-Key'],upstream);
 assert.equal(seen[0].options.headers.cookie,undefined);assert.equal(seen[0].options.headers['x-namat-service-key'],undefined);
 assert.deepEqual(json(result),{report:{id:report,status:'ready',pageCount:1},extraction:null});
});
test('portal review saves are portal-scoped POSTs that forward one exact JSON body',async()=>{
 const submission=randomUUID(),report=randomUUID(),path=`/v1/demo/submissions/${submission}/reports/${report}/reviews`;
 assert.deepEqual(demoRoute(path),{scope:'portal',methods:['POST'],upstream:`/api/namat-portal/submissions/${submission}/reports/${report}/reviews`});
 assert.equal(demoRoute(`/v1/demo/submissions/${submission}/reports/legacy-0/reviews`),null);
 const payload=JSON.stringify({extractionId:randomUUID(),expectedReviewRevision:0,observations:[],actor:'Dr. Fictional (microsoft:test)'});
 const seen=[];const bridge=createDemoBridge({env,fetcher:async(url,options)=>{seen.push({url,options});return Response.json({review:{revision:1,createdAt:'2026-10-01T12:00:00.000Z'}});}});
 assert.equal((await bridge(request(path,{method:'POST',body:payload}))).status,403);
 assert.equal((await bridge(request(path,{key:portal}))).status,405);
 assert.equal(seen.length,0);
 const result=await bridge(request(path,{key:portal,method:'POST',body:payload,headers:{'content-type':'application/json',cookie:'private-cookie'}}));
 assert.equal(result.status,200);assert.equal(seen.length,1);
 assert.equal(seen[0].url,DEMO_UPSTREAM+`/internal/namat/api/namat-portal/submissions/${submission}/reports/${report}/reviews`);
 assert.equal(seen[0].options.method,'POST');assert.equal(seen[0].options.body.toString(),payload);
 assert.equal(seen[0].options.headers['content-type'],'application/json');assert.equal(seen[0].options.headers['X-Namat-Upstream-Key'],upstream);
 assert.equal(seen[0].options.headers.cookie,undefined);
 for(const status of [400,409]){
  const conflict=createDemoBridge({env,fetcher:async()=>Response.json({status:'error',code:'stale_review'},{status})});
  assert.equal((await conflict(request(path,{key:portal,method:'POST',body:payload,headers:{'content-type':'application/json'}}))).status,status);
 }
});
