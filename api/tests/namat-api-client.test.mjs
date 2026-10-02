import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {createNamatApiClient, NamatApiClientError} from '../services/namat-api/client.mjs';
import {createNamatApiServer} from '../services/namat-api/server.mjs';
import {QUESTIONNAIRE_REVISION, STAGING_ORIGIN} from '../services/namat-api/config.mjs';
import {input} from './hackathon-fixtures.mjs';

const token='0123456789abcdef'.repeat(4);
const traceId='019a7df4-b9aa-4b00-87c3-f99c79ab5669';
const receiptId='509a7df4-b9aa-4b00-87c3-f99c79ab5669';
const saved={status:'saved',receiptId,confirmationEmail:'pending'};
const spec=JSON.parse(readFileSync(new URL('../services/namat-api/contracts/openapi.json',import.meta.url)));
const stage=fetcher=>createNamatApiClient({mode:'synthetic-staging',baseUrl:STAGING_ORIGIN,stagingToken:token,fetcher});
const reply=(data=saved,status=201,headers={})=>new Response(JSON.stringify(data),{status,headers:{
  'content-type':'application/json; charset=utf-8','x-request-id':traceId,...headers}});
const errorReply=(code,status,headers={})=>reply({status:'error',code,message:'SECRET upstream input or token',requestId:traceId},status,headers);
const isError=(code,outcome)=>error=>{
  assert.ok(error instanceof NamatApiClientError);assert.equal(error.code,code);
  if(outcome)assert.equal(error.submissionOutcome,outcome);
  assert.doesNotMatch(error.message,/SECRET|0123456789abcdef|fictional@example/);
  assert.equal(error.cause,undefined);
  return true;
};

test('client pins staging destination and keeps credential in Authorization only',async()=>{
  const calls=[];const source=input();const before=structuredClone(source);
  const client=stage(async(url,options)=>{calls.push({url,options});return reply();});
  assert.deepEqual(await client.submitSubmission(source),{status:201,data:saved,traceId});
  assert.deepEqual(source,before,'call must not mutate the caller retry payload');
  const [{url,options}]=calls;
  assert.equal(url,STAGING_ORIGIN+'/v1/submissions');assert.equal(options.headers.Authorization,`Bearer ${token}`);
  assert.equal(options.headers.Origin,undefined);assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
  const body=JSON.parse(options.body);assert.equal(body.questionnaireRevision,QUESTIONNAIRE_REVISION);
  assert.equal(body.requestId,source.requestId);assert.deepEqual(body.answers,source.answers);
  assert.doesNotMatch(url+options.body,/0123456789abcdef/);assert.equal(calls.length,1);
});

test('invalid destinations and credential combinations fail before transport',()=>{
  const base={mode:'synthetic-staging',baseUrl:STAGING_ORIGIN,stagingToken:token};
  for(const change of [{mode:undefined},{baseUrl:'http://namat-api-staging-uaen-001.azurewebsites.net'},
    {baseUrl:'https://evil.example'}, {baseUrl:STAGING_ORIGIN+'.evil.example'},
    {baseUrl:'https://secret@namat-api-staging-uaen-001.azurewebsites.net'},
    {baseUrl:STAGING_ORIGIN+'/v1'}, {baseUrl:STAGING_ORIGIN+'/?key=secret'}, {baseUrl:STAGING_ORIGIN+'/#secret'},
    {baseUrl:'http://127.0.0.1:4340'}, {stagingToken:'placeholder'}, {origin:'https://start.namat.health'},
    {timeoutMs:0}, {timeoutMs:60001}, {timeoutMs:1.5}, {fetcher:'invalid'}]) {
    assert.throws(()=>createNamatApiClient({...base,...change}),isError('invalid_configuration','not_sent'));
  }
  for(const settings of [
    {mode:'synthetic-local',baseUrl:'https://remote.example'},
    {mode:'synthetic-local',baseUrl:'http://127.0.0.1:4340',stagingToken:token},
    {mode:'synthetic-local',baseUrl:'http://127.0.0.1:4340',origin:'https://evil.example'},
  ])assert.throws(()=>createNamatApiClient(settings),isError('invalid_configuration','not_sent'));
});

test('caller mistakes and referenced uploads are rejected without a network call',async()=>{
  let calls=0;const client=stage(async()=>{calls++;return reply();});
  for(const source of [input({reportIds:[]}),input({reportSession:{id:'private',token:'SECRET'}})]) {
    await assert.rejects(client.submitSubmission(source),isError('unsupported_report_references','not_sent'));
  }
  for(const source of [null,[],input({questionnaireRevision:'new-revision'}),input({requestId:'bad'}),
    input({dataClass:'live'}),input({fictionalConfirmed:false}),input({extra:'SECRET'})]) {
    await assert.rejects(client.submitSubmission(source),isError('invalid_request','not_sent'));
  }
  await assert.rejects(client.submitSubmission(input({firstName:'x'.repeat(4_000_001)})),isError('request_too_large','not_sent'));
  const circular=input();circular.answers.loop=circular;
  await assert.rejects(client.submitSubmission(circular),isError('invalid_request','not_sent'));
  assert.equal(calls,0);
});

test('conflict and throttling preserve status, trace and retry advice without echoing upstream text',async()=>{
  let calls=0;
  for(const [code,status,outcome] of [['idempotency_conflict',409,'rejected'],['rate_limited',429,'rejected'],
    ['unauthorized',401,'rejected'],['service_unavailable',503,'unknown']]) {
    const client=stage(async()=>{calls++;return errorReply(code,status,{'retry-after':'60'});});
    await assert.rejects(client.submitSubmission(input()),error=>{
      isError(code,outcome)(error);assert.equal(error.status,status);assert.equal(error.traceId,traceId);
      assert.equal(error.retryAfterSeconds,60);assert.equal(error.kind,'api');return true;
    });
  }
  assert.equal(calls,4,'one transport call per operation; no retries or fallback');
});

test('unsafe retry headers are discarded and bounded HTTP-date advice is supported',async()=>{
  for(const raw of ['SECRET','999999999999','-1','86401']) {
    await assert.rejects(stage(async()=>errorReply('rate_limited',429,{'retry-after':raw})).submitSubmission(input()),error=>{
      assert.equal(error.retryAfterSeconds,undefined);return true;
    });
  }
  const future=new Date(Date.now()+60000).toUTCString();
  await assert.rejects(stage(async()=>errorReply('rate_limited',429,{'retry-after':future})).submitSubmission(input()),error=>{
    assert.ok(error.retryAfterSeconds>=58&&error.retryAfterSeconds<=60);return true;
  });
});

test('lost response remains unknown and caller can explicitly retry the exact same request ID',async()=>{
  let calls=0;const bodies=[];const client=stage(async(_url,options)=>{
    bodies.push(options.body);if(++calls===1)throw new Error('SECRET network configuration');return reply();
  });
  const source=input();await assert.rejects(client.submitSubmission(source),isError('transport_error','unknown'));
  assert.equal(calls,1);assert.equal((await client.submitSubmission(source)).data.receiptId,receiptId);
  assert.equal(bodies[0],bodies[1]);assert.equal(calls,2);
});

test('deadline covers missing headers and a stalled response body without replaying the POST',async()=>{
  for(const fetcher of [async()=>new Promise(()=>{}),async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));}}),
    {headers:{'content-type':'application/json','x-request-id':traceId}})]) {
    let calls=0;const client=createNamatApiClient({mode:'synthetic-staging',baseUrl:STAGING_ORIGIN,stagingToken:token,
      timeoutMs:100,fetcher:async(...args)=>{calls++;return fetcher(...args);}});
    await assert.rejects(client.submitSubmission(input()),isError('timeout','unknown'));assert.equal(calls,1);
  }
});

test('untrusted success/error bodies and incorrect trace IDs cannot fabricate a saved receipt',async()=>{
  const responses=[reply({...saved,receiptId:'fake'}),reply({...saved,confirmationEmail:'delivered'}),reply({...saved,secret:'SECRET'}),
    reply(saved,200),reply(saved,201,{'x-request-id':'SECRET'}),reply(saved,201,{'content-type':'text/html'}),
    reply({status:'error',code:'idempotency_conflict',message:'SECRET',requestId:receiptId},409),
    reply({status:'error',code:'rate_limited',message:'SECRET',requestId:traceId},503),
    new Response('{',{status:201,headers:{'content-type':'application/json','x-request-id':traceId}})];
  for(const response of responses)await assert.rejects(stage(async()=>response).submitSubmission(input()),isError('invalid_response','unknown'));
});

test('response buffering has declared and streaming limits',async()=>{
  let cancelled=false;
  const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(512*1024+1));},cancel(){cancelled=true;}});
  for(const response of [reply(saved,201,{'content-length':String(512*1024+1)}),
    new Response(stream,{status:201,headers:{'content-type':'application/json','x-request-id':traceId}})]) {
    await assert.rejects(stage(async()=>response).submitSubmission(input()),isError('invalid_response','unknown'));
  }
  assert.equal(cancelled,true);
});

test('readiness distinguishes unavailable storage and contract is checked against the pinned revision',async()=>{
  for(const ready of [true,false])assert.deepEqual(await stage(async()=>reply({status:ready?'ready':'unavailable'},ready?200:503)).getReadiness(),
    {ready,status:ready?200:503,traceId});
  const client=stage(async(url,options)=>{
    assert.equal(url,STAGING_ORIGIN+'/v1/openapi.json');assert.equal(options.method,'GET');assert.equal(options.body,undefined);
    return reply(spec,200);
  });
  assert.equal((await client.getContract()).data.info.version,'0.2.0');
  const altered=structuredClone(spec);altered.components.schemas.SubmissionRequest.properties.questionnaireRevision.const='unsupported';
  await assert.rejects(stage(async()=>reply(altered,200)).getContract(),isError('invalid_response','not_applicable'));
  await assert.rejects(stage(async()=>errorReply('unauthorized',401)).getReadiness(),isError('unauthorized','not_applicable'));
});

test('real HTTP redirects are not followed',async()=>{
  let followed=0;
  const server=createServer((req,res)=>{
    if(req.url==='/v1/submissions'){res.writeHead(307,{Location:'/credential-trap'});res.end();}
    else{followed++;res.end();}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try {
    const client=createNamatApiClient({mode:'synthetic-local',baseUrl:`http://127.0.0.1:${server.address().port}`});
    await assert.rejects(client.submitSubmission(input()),isError('transport_error','unknown'));assert.equal(followed,0);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('client exercises real local API contract, normalization and duplicate/conflict semantics',async()=>{
  let stored,ready=true;const store={ready:async()=>ready,save:async value=>{
    if(stored&&stored.requestId===value.requestId&&JSON.stringify(stored)!==JSON.stringify(value))return {conflict:true};
    stored=value;return {receiptId};
  }};
  const origin='http://127.0.0.1:4324';
  const server=createNamatApiServer({env:{NAMAT_API_ALLOWED_ORIGINS:origin},store});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try {
    const client=createNamatApiClient({mode:'synthetic-local',baseUrl:`http://127.0.0.1:${server.address().port}`,origin});
    assert.equal((await client.getReadiness()).ready,true);assert.equal((await client.getContract()).data.info.version,'0.2.0');
    const source=input();assert.equal((await client.submitSubmission(source)).data.receiptId,receiptId);
    assert.equal((await client.submitSubmission(source)).data.receiptId,receiptId);
    await assert.rejects(client.submitSubmission({...source,firstName:'Changed'}),isError('idempotency_conflict','rejected'));
    ready=false;assert.equal((await client.getReadiness()).ready,false);
    await assert.rejects(client.submitSubmission(source),isError('service_unavailable','unknown'));
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
