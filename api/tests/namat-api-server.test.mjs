import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {once} from 'node:events';
import {createNamatApiServer} from '../services/namat-api/server.mjs';
import {input,answers,file} from './hackathon-fixtures.mjs';

const origin='http://127.0.0.1:4324';
const env={NAMAT_API_MODE:'synthetic-local',NAMAT_API_ALLOWED_ORIGINS:origin,
  NAMAT_API_DATABASE_URL:'postgresql://tester:fictional@127.0.0.1:5432/namat_hackathon',NAMAT_API_SCHEMA:'namat_api_test'};
const receiptId='509a7df4-b9aa-4b00-87c3-f99c79ab5669';
const payload=(overrides={})=>({...input(),questionnaireRevision:'uae-arrival-2026-09-30',...overrides});
const goodHeaders={origin,'content-type':'application/json'};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const defaultStore=()=>({ready:async()=>true,save:async()=>({receiptId})});

async function withServer(run,{store=defaultStore(),runtimeEnv=env}={}){
  const server=createNamatApiServer({env:runtimeEnv,store});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  try{return await run(server.address().port);}finally{
    const closed=once(server,'close');
    server.close();
    server.closeAllConnections();
    await closed;
  }
}

function request(port,{method='GET',path='/healthz',headers={},body,chunks}={}){
  return new Promise((resolve,reject)=>{
    const req=httpRequest({hostname:'127.0.0.1',port,method,path,headers,agent:false},res=>{
      const parts=[];
      res.on('data',chunk=>parts.push(chunk));
      res.on('error',reject);
      res.on('end',()=>{
        const text=Buffer.concat(parts).toString('utf8');
        let json;
        try{json=JSON.parse(text);}catch{}
        resolve({status:res.statusCode,headers:res.headers,text,json});
      });
    });
    req.setTimeout(3000,()=>req.destroy(new Error('Local API request timed out')));
    req.on('error',reject);
    if(chunks){for(const chunk of chunks)req.write(chunk);req.end();}
    else req.end(body);
  });
}
const post=(port,value=payload(),extra={})=>request(port,{method:'POST',path:'/v1/submissions',headers:goodHeaders,body:JSON.stringify(value),...extra});
function assertError(response,status){
  assert.equal(response.status,status,response.text);
  assert.equal(response.json?.status,'error');
  assert.equal(typeof response.json?.code,'string');
  assert.ok(response.json.code.length>0);
  assert.equal(typeof response.json?.message,'string');
  assert.match(response.json?.requestId||'',UUID);
  assert.equal(response.headers['x-request-id'],response.json.requestId);
  assert.match(response.headers['cache-control'],/(?:^|,\s*)no-store(?:,|$)/);
}

test('local API exposes independent liveness, database readiness and its versioned contract',async()=>{
  let readinessCalls=0;
  await withServer(async port=>{
    const health=await request(port);
    assert.equal(health.status,200);assert.deepEqual(health.json,{status:'ok'});assert.equal(readinessCalls,0);
    const ready=await request(port,{path:'/readyz'});
    assert.equal(ready.status,200);assert.equal(ready.json.status,'ready');assert.equal(readinessCalls,1);
    const spec=await request(port,{path:'/v1/openapi.json'});
    assert.equal(spec.status,200);assert.match(spec.json.openapi,/^3\./);
    assert.ok(spec.json.paths['/v1/submissions'].post);
    assert.match(spec.headers['x-request-id'],UUID);
  },{store:{...defaultStore(),ready:async()=>{readinessCalls++;return true;}}});
});

test('readiness safely reports false or failing dependencies while liveness remains available',async()=>{
  for(const ready of [async()=>false,async()=>{throw new Error('SECRET postgresql://private/password');}]){
    await withServer(async port=>{
      const response=await request(port,{path:'/readyz'});
      assert.equal(response.status,503);
      assert.doesNotMatch(response.text,/SECRET|private|password/);
      assert.equal((await request(port)).status,200);
    },{store:{...defaultStore(),ready}});
  }
});

test('valid fictional questionnaire normalizes through the shared validator and queues acknowledgement',async()=>{
  const saved=[];
  let mailCalls=0;
  await withServer(async port=>{
    const value=payload({email:'  Fictional@Example.Invalid ',firstName:'  ريم  '});
    const response=await post(port,value);
    assert.equal(response.status,201,response.text);
    assert.deepEqual(response.json,{status:'saved',receiptId,confirmationEmail:'pending'});
    assert.equal(response.headers['access-control-allow-origin'],origin);
    assert.match(response.headers['cache-control'],/(?:^|,\s*)no-store(?:,|$)/);
    assert.match(response.headers['x-request-id'],UUID);
    assert.equal(saved.length,1);assert.equal(saved[0].email,'fictional@example.invalid');assert.equal(saved[0].firstName,'ريم');
    assert.equal(saved[0].dataClass,'synthetic');assert.equal(saved[0].fictionalConfirmed,true);
    assert.deepEqual(saved[0].answers,value.answers);
    assert.equal(mailCalls,0,'HTTP submission must not dispatch external mail');
  },{store:{...defaultStore(),save:async value=>{saved.push(value);return {receiptId};},deliverReceiptConfirmation:async()=>{mailCalls++;throw new Error('Should not send');}}});
});

test('uploaded fictional reports reuse existing file validation before persistence',async()=>{
  let saved;
  await withServer(async port=>{
    const valid=payload({answers:answers({bloodwork:'yes'}),reports:[file()]});
    assert.equal((await post(port,valid)).status,201);
    assert.equal(saved.reports.length,1);
    assert.match(saved.reports[0].sha256,/^[a-f0-9]{64}$/);
    saved=null;
    const invalid={...valid,reports:[file(Buffer.from('<html>not a report</html>'))]};
    assertError(await post(port,invalid),400);
    assert.equal(saved,null);
  },{store:{...defaultStore(),save:async value=>{saved=value;return {receiptId};}}});
});

test('idempotent repeats preserve the receipt and changed-content conflicts return 409',async()=>{
  for(const result of [{receiptId,repeated:true},{conflict:true}]){
    await withServer(async port=>{
      const response=await post(port);
      if(result.conflict)assertError(response,409);
      else{assert.equal(response.status,201);assert.deepEqual(response.json,{status:'saved',receiptId,confirmationEmail:'pending'});}
    },{store:{...defaultStore(),save:async()=>result}});
  }
});

test('unsafe origins, cross-site requests, and non-JSON content never reach persistence',async()=>{
  let saves=0;
  await withServer(async port=>{
    for(const headers of [
      {'content-type':'application/json'},
      {...goodHeaders,origin:'https://evil.example'},
      {...goodHeaders,origin:'null'},
      {...goodHeaders,origin:origin+'/'},
      {...goodHeaders,'sec-fetch-site':'cross-site'},
    ])assertError(await post(port,payload(),{headers}),403);
    for(const type of ['text/plain','text/html','application/jsonp'])assertError(await post(port,payload(),{headers:{origin,'content-type':type}}),415);
    assertError(await post(port,payload(),{headers:{origin}}),415);
    assert.equal(saves,0);
  },{store:{...defaultStore(),save:async()=>{saves++;return {receiptId};}}});
});

test('loopback host guard prevents DNS rebinding even with an allowed Origin',async()=>{
  let saves=0;
  await withServer(async port=>{
    for(const host of ['evil.example','127.0.0.1.evil.example','localhost.evil.example','0.0.0.0',
      'localhost',`localhost:${port===65535?1:port+1}`,`localhost:${port}/path`, `user@localhost:${port}`]){
      assertError(await post(port,payload(),{headers:{...goodHeaders,host}}),403);
    }
    assert.equal(saves,0);
    for(const host of ['localhost:'+port,'127.0.0.1:'+port,'[::1]:'+port]){
      assert.equal((await request(port,{headers:{host}})).status,200);
    }
  },{store:{...defaultStore(),save:async()=>{saves++;return {receiptId};}}});
});

test('preflight grants only the agreed submission operation and content type',async()=>{
  await withServer(async port=>{
    const options={method:'OPTIONS',path:'/v1/submissions',headers:{origin,'access-control-request-method':'POST','access-control-request-headers':'content-type'}};
    const response=await request(port,options);
    assert.equal(response.status,204);assert.equal(response.text,'');
    assert.equal(response.headers['access-control-allow-origin'],origin);
    assert.match(response.headers['access-control-allow-methods'],/POST/);
    for(const headers of [
      {...options.headers,origin:'https://evil.example'},
      {...options.headers,'access-control-request-method':'DELETE'},
      {...options.headers,'access-control-request-headers':'content-type, authorization'},
      {'access-control-request-method':'POST','access-control-request-headers':'content-type'},
    ])assertError(await request(port,{...options,headers}),403);
  });
});

test('private records and unimplemented doctor operations are unavailable',async()=>{
  await withServer(async port=>{
    for(const path of ['/v1/submissions/'+receiptId,'/v1/cases','/v1/patients','/v1/reports/'+receiptId,'/api/hackathon']){
      assertError(await request(port,{path}),404);
    }
    assertError(await request(port,{path:'/v1/submissions'}),405);
    assertError(await request(port,{path:'/v1/submissions',method:'DELETE',headers:goodHeaders}),405);
  });
});

test('bad revisions, real-data flags, unexpected fields and incomplete contact are rejected before saving',async()=>{
  let saves=0;
  await withServer(async port=>{
    for(const overrides of [{questionnaireRevision:'old'},{questionnaireRevision:null},{dataClass:'live'},{fictionalConfirmed:false},
      {firstName:''},{firstName:undefined},{email:'bad'},{recipient:'outside@example.invalid'},{answers:{...answers(),unknown:'secret'}}]){
      assertError(await post(port,payload(overrides)),400);
    }
    const missingRevision=payload();delete missingRevision.questionnaireRevision;
    assertError(await post(port,missingRevision),400);
    assert.equal(saves,0);
  },{store:{...defaultStore(),save:async()=>{saves++;return {receiptId};}}});
});

test('malformed JSON and invalid UTF-8 are rejected before persistence',async()=>{
  let saves=0;
  await withServer(async port=>{
    for(const body of ['{broken',Buffer.from([0xc3,0x28])])assertError(await post(port,payload(),{body}),400);
    assert.equal(saves,0);
  },{store:{...defaultStore(),save:async()=>{saves++;return {receiptId};}}});
});

test('declared and chunked oversized bodies get bounded responses and leave the server usable',async()=>{
  let saves=0;
  await withServer(async port=>{
    assertError(await post(port,payload(),{headers:{...goodHeaders,'content-length':'4000001'},body:''}),413);
    const chunks=Array.from({length:62},()=>Buffer.alloc(65536,32));
    assertError(await request(port,{method:'POST',path:'/v1/submissions',headers:{...goodHeaders,'transfer-encoding':'chunked'},chunks}),413);
    assert.equal(saves,0);
    assert.equal((await request(port)).status,200);
  },{store:{...defaultStore(),save:async()=>{saves++;return {receiptId};}}});
});

test('internal errors never expose submitted data or credentials and use a server trace ID',async()=>{
  await withServer(async port=>{
    const response=await post(port,payload({firstName:'Private Marker'}),{headers:{...goodHeaders,'x-request-id':'user-controlled-marker'}});
    assertError(response,503);
    assert.notEqual(response.json.requestId,'user-controlled-marker');
    assert.doesNotMatch(response.text,/Private Marker|fictional@example|postgresql|password|SECRET|user-controlled-marker/);
  },{store:{...defaultStore(),save:async()=>{throw new Error('SECRET postgresql://private:password@host/db Private Marker fictional@example.invalid');}}});
});

test('invalid persistence receipts are treated as unavailable, never advertised as successful',async()=>{
  for(const result of [null,{}, {receiptId:'not-a-uuid'}])await withServer(async port=>{
    assertError(await post(port),503);
  },{store:{...defaultStore(),save:async()=>result}});
});

test('even an injected store cannot bypass nonlocal database configuration',()=>{
  assert.throws(()=>createNamatApiServer({env:{...env,NAMAT_API_DATABASE_URL:'postgresql://tester:fictional@remote.example:5432/namat_hackathon'},store:defaultStore()}));
});

test('concurrent persistence is bounded and capacity recovers after in-flight requests finish',{timeout:5000},async()=>{
  let entered=0,release;
  const gate=new Promise(resolve=>{release=resolve;});
  let allEntered;
  const atCapacity=new Promise(resolve=>{allEntered=resolve;});
  await withServer(async port=>{
    const pending=Array.from({length:4},()=>post(port));
    try{
      await atCapacity;
      const blocked=await post(port);
      assertError(blocked,429);
      assert.equal(blocked.headers['retry-after'],'60');
      assert.equal(entered,4);
      assert.equal((await request(port)).status,200,'liveness stays available at submission capacity');
    }finally{release();}
    const results=await Promise.all(pending);
    assert.ok(results.every(response=>response.status===201));
    assert.equal((await post(port)).status,201,'completion releases a submission slot');
  },{store:{...defaultStore(),save:async()=>{entered++;if(entered===4)allEntered();await gate;return {receiptId};}}});
});

test('local submission rate limit rejects excess requests without additional database work',async()=>{
  let saves=0;
  await withServer(async port=>{
    for(let count=0;count<60;count++)assert.equal((await post(port)).status,201);
    const blocked=await post(port);
    assertError(blocked,429);
    assert.equal(saves,60);
    assert.equal(blocked.headers['retry-after'],'60');
    assert.equal((await request(port)).status,200);
  },{store:{...defaultStore(),save:async()=>{saves++;return {receiptId};}}});
});


test('HEAD probes preserve readiness status and never expose record data',async()=>{
  for(const available of [true,false])await withServer(async port=>{
    const live=await request(port,{method:'HEAD'});
    assert.equal(live.status,200);assert.equal(live.text,'');
    const ready=await request(port,{method:'HEAD',path:'/readyz'});
    assert.equal(ready.status,available?200:503);assert.equal(ready.text,'');
    assert.match(ready.headers['x-request-id'],UUID);
    const listing=await request(port,{method:'HEAD',path:'/v1/submissions'});
    assert.equal(listing.status,405);assert.equal(listing.text,'');
    const record=await request(port,{method:'HEAD',path:'/v1/submissions/'+receiptId});
    assert.equal(record.status,404);assert.equal(record.text,'');
  },{store:{...defaultStore(),ready:async()=>available}});
});
