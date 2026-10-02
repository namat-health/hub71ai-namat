import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {readApiConfig, STAGING_ORIGIN, QUESTIONNAIRE_REVISION} from '../services/namat-api/config.mjs';
import {createDatabase, initializeDatabase} from '../services/namat-api/database.mjs';
import {createNamatApiServer, inspectSubmissionReports} from '../services/namat-api/server.mjs';
import {hasStagingAccess} from '../services/namat-api/staging-auth.mjs';
import {input, answers, file, pdf, png, jpeg} from './hackathon-fixtures.mjs';

// Generated per test process; never a deployable credential or public example.
const token = randomBytes(32).toString('hex');
const env = {NAMAT_API_MODE:'synthetic-staging', NAMAT_API_STAGING_APPROVED:'true', NAMAT_API_STAGING_TOKEN:token,
  NAMAT_API_PUBLIC_ORIGIN:STAGING_ORIGIN, NAMAT_API_SCHEMA:'namat_api_staging', PORT:'8080',
  NAMAT_API_DATABASE_URL:'postgresql://namat_api_staging_runtime:fictional@namat-pg-test-uaen-001.postgres.database.azure.com:5432/namat_journey'};
const host = new URL(STAGING_ORIGIN).host;
const authenticated = {host, authorization:`Bearer ${token}`};
const receiptId = '509a7df4-b9aa-4b00-87c3-f99c79ab5669';
const defaultStore = () => ({ready:async()=>true, save:async()=>({receiptId})});
const payload = (overrides={}) => ({...input(),questionnaireRevision:QUESTIONNAIRE_REVISION,...overrides});
async function withServer(run, store=defaultStore()) {
  const server = createNamatApiServer({env,store});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  try { return await run(server.address().port,server); }
  finally { const closed=once(server,'close');server.close();server.closeAllConnections();await closed; }
}
function request(port,{path='/healthz',method='GET',headers={host},body}={}) {
  return new Promise((resolve,reject)=>{
    const req=httpRequest({hostname:'127.0.0.1',port,path,method,headers,agent:false},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);
      res.on('end',()=>{const text=Buffer.concat(chunks).toString('utf8');let json;try{json=JSON.parse(text);}catch{}
        resolve({status:res.statusCode,headers:res.headers,text,json});});
    });
    req.setTimeout(5000,()=>req.destroy(new Error('Test request timed out.')));
    req.on('error',reject);req.end(body);
  });
}
const post = (port, value=payload(), options={}) => request(port,{path:'/v1/submissions',method:'POST',
  headers:{...authenticated,'content-type':'application/json'},body:JSON.stringify(value),...options});

test('staging requires explicit approved destination, credential, database role and schema',()=>{
  const config=readApiConfig(env);
  assert.equal(config.mode,'synthetic-staging');assert.equal(config.host,'0.0.0.0');assert.equal(config.port,8080);
  assert.equal(config.publicOrigin,STAGING_ORIGIN);assert.equal(config.schema,'namat_api_staging');
  assert.deepEqual([...config.origins],[STAGING_ORIGIN]);
  for(const overrides of [
    {NAMAT_API_STAGING_APPROVED:undefined},{NAMAT_API_STAGING_APPROVED:'false'},
    {NAMAT_API_STAGING_TOKEN:undefined},{NAMAT_API_STAGING_TOKEN:'short'},
    {NAMAT_API_STAGING_TOKEN:'a'.repeat(64)},{NAMAT_API_STAGING_TOKEN:token.toUpperCase()},
    {NAMAT_API_PUBLIC_ORIGIN:'http://'+host},{NAMAT_API_PUBLIC_ORIGIN:STAGING_ORIGIN+'/'},
    {NAMAT_API_PUBLIC_ORIGIN:'https://example.invalid'}, {NAMAT_API_HOST:'127.0.0.1'},
    {PORT:'80'}, {NAMAT_API_PORT:'4340'}, {NAMAT_API_SCHEMA:'public'}, {NAMAT_API_SCHEMA:'namat_api_dev'},
    {NAMAT_API_DATABASE_URL:undefined},
    {NAMAT_API_DATABASE_URL:env.NAMAT_API_DATABASE_URL.replace('namat_api_staging_runtime','postgres')},
    {NAMAT_API_DATABASE_URL:env.NAMAT_API_DATABASE_URL.replace('/namat_journey','/another_database')},
    {NAMAT_API_DATABASE_URL:env.NAMAT_API_DATABASE_URL.replace('namat-pg-test-uaen-001','other')},
    {NAMAT_API_DATABASE_URL:env.NAMAT_API_DATABASE_URL+'?sslmode=disable'},
    {NAMAT_API_DATABASE_URL:env.NAMAT_API_DATABASE_URL.replace(':5432/',':5433/')},
    {NAMAT_API_ALLOWED_ORIGINS:'*'}, {NAMAT_API_ALLOWED_ORIGINS:'http://127.0.0.1:4324'},
    {NAMAT_API_ALLOWED_ORIGINS:'https://start.namat.health.evil.invalid'},
  ]) assert.throws(()=>readApiConfig({...env,...overrides}),undefined,Object.keys(overrides).join(','));
});

test('staging database uses certificate verification and init cannot run hosted migrations',async()=>{
  const config=readApiConfig(env);
  const database=createDatabase(config);
  try {
    assert.equal(database.native.options.ssl.rejectUnauthorized,true);
    assert.equal(database.native.options.user,'namat_api_staging_runtime');
    assert.equal(database.native.options.max,2);
    assert.throws(()=>createDatabase({...config,schema:'public'}));
    assert.throws(()=>createDatabase({...config,stagingApproved:false}));
    assert.throws(()=>createDatabase({...config,stagingToken:'bad'}));
    assert.throws(()=>createDatabase({...config,mode:'synthetic-local'}));
    await assert.rejects(initializeDatabase(config),/local-only/);
  } finally {await database.close();}
});

test('staging bearer verifier rejects missing, alternate and partial credentials',()=>{
  assert.equal(hasStagingAccess(`Bearer ${token}`,token),true);
  for(const header of [undefined,'',token,`Basic ${token}`,`Bearer ${token.slice(1)}`,`Bearer ${token} `,
    `Bearer ${randomBytes(32).toString('hex')}`,`Bearer ${token}, Bearer ${token}`]) assert.equal(hasStagingAccess(header,token),false);
});

test('only generic staging liveness and allowed preflight work without credentials',async()=>{
  let calls=0;
  await withServer(async port=>{
    assert.deepEqual((await request(port)).json,{status:'ok'});
    for(const path of ['/readyz','/v1/openapi.json','/v1/cases','/v1/submissions/anything','/unknown','/healthz?x=1']) {
      const response=await request(port,{path});
      assert.equal(response.status,401);assert.equal(response.json.code,'unauthorized');
      assert.equal(response.headers['www-authenticate'],'Bearer realm="namat-staging"');
      assert.ok(!response.text.includes(token));
    }
    const denied=await post(port,payload(),{headers:{host,'content-type':'application/json'}});
    assert.equal(denied.status,401);assert.equal(calls,0);
    assert.equal((await request(port,{path:'/readyz',headers:authenticated})).status,200);
    assert.equal(calls,1);
    assert.equal((await request(port,{path:'/v1/cases',headers:authenticated})).status,404);
    const head=await request(port,{path:'/readyz',method:'HEAD'});
    assert.equal(head.status,401);assert.equal(head.text,'');
  },{ready:async()=>{calls++;return true;},save:async()=>{throw new Error('Unexpected save');}});
});

test('staging never trusts forwarded host and allows loopback only for liveness',async()=>{
  await withServer(async port=>{
    for(const probeHost of ['localhost','127.0.0.1','[::1]',`127.0.0.1:${port}`]) {
      assert.equal((await request(port,{headers:{host:probeHost}})).status,200);
      assert.equal((await request(port,{path:'/readyz',headers:{...authenticated,host:probeHost}})).status,403);
    }
    for(const badHost of ['evil.invalid',host+'.evil.invalid',host+':443']) {
      const headers={...authenticated,host:badHost,'x-forwarded-host':host,'x-original-host':host};
      assert.equal((await request(port,{headers})).status,403);
      assert.equal((await request(port,{path:'/readyz',headers})).status,403);
    }
    assert.equal((await request(port,{path:'/readyz',headers:{...authenticated,'x-forwarded-host':'evil.invalid'}})).status,200);
  });
});

test('staging server clients can submit without Origin but a supplied Origin must be allowed',async()=>{
  let saves=0;
  await withServer(async port=>{
    assert.equal((await post(port)).status,201);
    assert.equal((await post(port,payload(),{headers:{...authenticated,'content-type':'application/json',origin:STAGING_ORIGIN,'sec-fetch-site':'cross-site'}})).status,201);
    for(const origin of ['null','https://evil.invalid',STAGING_ORIGIN+'/', 'http://127.0.0.1:4324']) {
      assert.equal((await post(port,payload(),{headers:{...authenticated,'content-type':'application/json',origin}})).status,403);
    }
    assert.equal(saves,2);
  },{...defaultStore(),save:async()=>{saves++;return {receiptId};}});
});

test('authenticated staging intake inspects supported PDF, PNG and JPEG reports before persistence',async()=>{
  let saved;
  await withServer(async port=>{
    const reports=[file(pdf()),file(png(),'fictional.png','image/png'),file(jpeg(),'fictional.jpg','image/jpeg')];
    const response=await post(port,payload({answers:answers({bloodwork:'yes'}),reports}));
    assert.equal(response.status,201,response.text);
    assert.equal(saved.reports.length,3);
    assert.deepEqual(saved.reports.map(report=>report.type),['application/pdf','image/png','image/jpeg']);
    for(const report of saved.reports) assert.match(report.sha256,/^[0-9a-f]{64}$/);
  },{...defaultStore(),save:async value=>{saved=value;return {receiptId};}});
});

test('staging report inspection shares one deadline and never starts a report after the budget expires',async()=>{
  const reports=Array.from({length:3},()=>({bytes:Buffer.from('fictional'),type:'application/pdf'}));
  let clock=1000;
  const budgets=[];
  await assert.rejects(inspectSubmissionReports(reports,{staging:true,now:()=>clock,
    inspect:async(_bytes,_type,options)=>{budgets.push(options.timeoutMs);clock+=budgets.length===1?20000:11000;}}),
  error=>error.code==='inspection_timeout');
  assert.deepEqual(budgets,[30000,10000]);
  let localCalls=0;
  await inspectSubmissionReports(reports,{now:()=>{throw new Error('Local inspection must not use a shared deadline');},
    inspect:async(_bytes,_type,options)=>{assert.equal(options,undefined);localCalls++;}});
  assert.equal(localCalls,3);
});

test('staging preflight permits only explicit origins, POST and authorization/content-type',async()=>{
  await withServer(async port=>{
    const headers={host,origin:STAGING_ORIGIN,'access-control-request-method':'POST','access-control-request-headers':'authorization, content-type'};
    const options={path:'/v1/submissions',method:'OPTIONS',headers};
    const good=await request(port,options);
    assert.equal(good.status,204);assert.equal(good.headers['access-control-allow-headers'],'Content-Type, Authorization');
    for(const overrides of [{origin:undefined},{origin:'https://evil.invalid'},
      {'access-control-request-method':'GET'},{'access-control-request-headers':'x-user-id, authorization'}]) {
      const next=Object.fromEntries(Object.entries({...headers,...overrides}).filter(([,value])=>value!==undefined));
      assert.equal((await request(port,{...options,headers:next})).status,403);
    }
  });
});

test('hosted OpenAPI reflects bearer security, HTTPS origin and the runtime limits without a secret',async()=>{
  await withServer(async port=>{
    const response=await request(port,{path:'/v1/openapi.json',headers:authenticated});
    assert.equal(response.status,200);assert.equal(response.json.servers[0].url,STAGING_ORIGIN);
    assert.deepEqual(response.json.security,[{StagingToken:[]}]);
    assert.deepEqual(response.json.paths['/healthz'].get.security,[]);
    assert.deepEqual(response.json.paths['/v1/submissions'].options.security,[]);
    assert.deepEqual(response.json.paths['/v1/submissions'].post.security,[{StagingToken:[]}]);
    assert.equal(response.json.paths['/v1/submissions'].post.parameters[0].required,false);
    assert.equal(response.json.paths['/readyz'].head.responses['401'].content,undefined);
    assert.equal(response.json['x-runtime-limits'].maxInFlightSubmissions,1);
    assert.match(response.json.paths['/v1/submissions'].post.responses['429'].description,/one submission already in flight/);
    assert.equal(response.json.paths['/readyz'].get.summary,'Check that staging storage is available');
    assert.equal(response.json.components.securitySchemes.StagingToken.scheme,'bearer');
    assert.ok(!response.text.includes(token));assert.ok(!response.text.includes('fictional@namat-pg'));
  });
});

test('unavailable staging storage stops work before JSON and report inspection',async()=>{
  for(const ready of [async()=>false,async()=>{throw new Error('private connection detail');}]) {
    await withServer(async port=>{
      const malformed=await post(port,payload(),{body:'{invalid json'});
      assert.equal(malformed.status,503);assert.ok(!malformed.text.includes('private connection'));
      const invalidReport=payload({answers:answers({bloodwork:'yes'}),reports:[file(Buffer.from('%PDF-1.7 invalid report'))]});
      assert.equal((await post(port,invalidReport)).status,503);
    },{ready,save:async()=>{throw new Error('Should not save');}});
  }
});

test('staging serializes expensive submissions on the shared small plan and recovers capacity',async()=>{
  let release,entered;
  const gate=new Promise(resolve=>{release=resolve;});
  const started=new Promise(resolve=>{entered=resolve;});
  await withServer(async (port,server)=>{
    assert.equal(server.requestTimeout,45000);assert.equal(server.timeout,45000);assert.equal(server.headersTimeout,10000);
    const first=post(port);
    try {await started;assert.equal((await post(port)).status,429);assert.equal((await request(port)).status,200);}
    finally {release();}
    assert.equal((await first).status,201);
    assert.equal((await post(port)).status,201);
  },{...defaultStore(),save:async()=>{entered();await gate;return {receiptId};}});
});
