// Trusted Node.js clients only. Never import this module or its configuration
// into browser code: the staging token authorizes the whole test environment.
import {Buffer} from 'node:buffer';
import {QUESTIONNAIRE_REVISION, STAGING_ORIGIN} from './config.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOOPBACK = new Set(['localhost','127.0.0.1','[::1]']);
const REQUEST_LIMIT = 4_000_000;
const RESPONSE_LIMIT = 512 * 1024;
const FIELDS = new Set(['version','questionnaireRevision','requestId','dataClass','fictionalConfirmed','answers','notes','email','firstName','reports']);
const EMAIL_STATES = new Set(['pending','simulated','accepted','failed','unknown']);
const ERRORS = new Map([[400,new Set(['validation_failed','invalid_json'])],[401,new Set(['unauthorized'])],
  [403,new Set(['forbidden_origin'])],[404,new Set(['not_found'])],[405,new Set(['method_not_allowed'])],
  [409,new Set(['idempotency_conflict'])],[413,new Set(['payload_too_large'])],[415,new Set(['unsupported_media_type'])],
  [429,new Set(['rate_limited'])],[503,new Set(['service_unavailable'])]]);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));

/** Contains safe machine metadata only, never request data, tokens or provider text. */
export class NamatApiClientError extends Error {
  constructor(code, {kind='request', status, traceId, retryAfterSeconds, submissionOutcome='not_sent'} = {}) {
    const messages = {invalid_configuration:'Use explicit Namat API client settings.',invalid_request:'Use a supported fictional intake request.',
      unsupported_report_references:'This API client supports inline reports only. Referenced uploads require a later contract.',
      request_too_large:'The submission exceeds the API request limit.',timeout:'The API request timed out.',
      transport_error:'The API response could not be confirmed.',invalid_response:'The API returned an unexpected response.',
      idempotency_conflict:'This request ID was already used with different content.',rate_limited:'The API requested a later retry.'};
    super(messages[code] || 'The API rejected this request.');
    this.name='NamatApiClientError';this.kind=kind;this.code=code;this.submissionOutcome=submissionOutcome;
    if(status !== undefined)this.status=status;
    if(traceId !== undefined)this.traceId=traceId;
    if(retryAfterSeconds !== undefined)this.retryAfterSeconds=retryAfterSeconds;
  }
}

function configuration(options) {
  const fail = () => {throw new NamatApiClientError('invalid_configuration',{kind:'configuration'});};
  if(!plain(options) || !['synthetic-local','synthetic-staging'].includes(options.mode))fail();
  let url;
  try {url=new URL(options.baseUrl);} catch {fail();}
  if(url.username || url.password || url.pathname !== '/' || url.search || url.hash)fail();
  const timeoutMs=options.timeoutMs ?? 45000;
  if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>60000)fail();
  const fetcher=options.fetcher ?? globalThis.fetch;
  if(typeof fetcher!=='function')fail();
  const headers={Accept:'application/json'};
  if(options.mode==='synthetic-staging') {
    if(url.origin!==STAGING_ORIGIN || typeof options.stagingToken!=='string'
      || !/^[a-f0-9]{64}$/.test(options.stagingToken) || new Set(options.stagingToken).size<8
      || options.origin!==undefined)fail();
    headers.Authorization=`Bearer ${options.stagingToken}`;
  } else {
    if(!['http:','https:'].includes(url.protocol)||!LOOPBACK.has(url.hostname)||options.stagingToken!==undefined)fail();
    let origin;
    try {origin=new URL(options.origin ?? url.origin);} catch {fail();}
    if(!['http:','https:'].includes(origin.protocol)||!LOOPBACK.has(origin.hostname)
      || origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)fail();
    headers.Origin=origin.origin;
  }
  return {baseUrl:url.origin,headers,timeoutMs,fetcher};
}

function serializeSubmission(input) {
  if(!plain(input))throw new NamatApiClientError('invalid_request');
  if(Object.hasOwn(input,'reportIds')||Object.hasOwn(input,'reportSession'))throw new NamatApiClientError('unsupported_report_references');
  if(Object.keys(input).some(key=>!FIELDS.has(key))||input.version!=='namat-hackathon-welcome-v1'
    || typeof input.requestId!=='string'||!UUID.test(input.requestId)||input.dataClass!=='synthetic'||input.fictionalConfirmed!==true
    || (input.questionnaireRevision!==undefined&&input.questionnaireRevision!==QUESTIONNAIRE_REVISION)
    || !plain(input.answers)||!Array.isArray(input.reports)||input.reports.length>3
    || typeof input.email!=='string'||typeof input.firstName!=='string')throw new NamatApiClientError('invalid_request');
  let body;
  try {body=JSON.stringify({...input,questionnaireRevision:QUESTIONNAIRE_REVISION});}
  catch {throw new NamatApiClientError('invalid_request');}
  if(Buffer.byteLength(body)>REQUEST_LIMIT)throw new NamatApiClientError('request_too_large');
  return body;
}

function retryDelay(headers) {
  const raw=headers.get('retry-after');
  if(!raw)return undefined;
  if(/^\d{1,5}$/.test(raw))return Number(raw)<=86400 ? Number(raw) : undefined;
  // HTTP dates are allowed by HTTP, but only return a bounded numeric delay.
  if(!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(raw))return undefined;
  const delay=Math.max(0,Math.ceil((Date.parse(raw)-Date.now())/1000));
  return Number.isFinite(delay)&&delay<=86400 ? delay : undefined;
}

async function boundedJson(response) {
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(response.headers.get('content-type')||''))throw new Error();
  const declared=response.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>RESPONSE_LIMIT))throw new Error();
  const reader=response.body?.getReader();
  if(!reader)throw new Error();
  const chunks=[];let size=0,complete=false;
  try {
    while(true) {
      const {done,value}=await reader.read();
      if(done){complete=true;break;}
      size+=value.byteLength;
      if(size>RESPONSE_LIMIT)throw new Error();
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)));
  } finally {
    if(!complete)void reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
}

/** No automatic retry, legacy fallback or background sending is performed. */
export function createNamatApiClient(options) {
  const config=configuration(options);
  async function request(path,{body,operation}) {
    const submission=operation==='submit';
    const unknown=submission?'unknown':'not_applicable';
    const controller=new AbortController();let timer;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{
      controller.abort();reject(new NamatApiClientError('timeout',{kind:'transport',submissionOutcome:unknown}));
    },config.timeoutMs);});
    const perform=async()=>{
      let response;
      try {response=await config.fetcher(config.baseUrl+path,{method:submission?'POST':'GET',
        headers:{...config.headers,...(submission?{'Content-Type':'application/json; charset=utf-8'}:{})},
        ...(submission?{body}:{}),redirect:'error',credentials:'omit',cache:'no-store',signal:controller.signal});}
      catch {throw new NamatApiClientError(controller.signal.aborted?'timeout':'transport_error',{kind:'transport',submissionOutcome:unknown});}
      let data,traceId;
      try {
        if(response.redirected||(response.url&&response.url!==config.baseUrl+path)||response.status>=300&&response.status<400)throw new Error();
        traceId=response.headers.get('x-request-id');
        if(!UUID.test(traceId||''))throw new Error();
        data=await boundedJson(response);
      } catch {throw new NamatApiClientError('invalid_response',{kind:'response',submissionOutcome:unknown});}
      const status=response.status;
      if(operation==='ready'&&[200,503].includes(status)&&exact(data,['status'])&&data.status===(status===200?'ready':'unavailable')) {
        return {ready:status===200,status,traceId};
      }
      if(operation==='submit'&&status===201&&exact(data,['status','receiptId','confirmationEmail'])
        &&data.status==='saved'&&UUID.test(data.receiptId||'')&&EMAIL_STATES.has(data.confirmationEmail)) {
        return {status,data,traceId};
      }
      if(operation==='contract'&&status===200&&plain(data)&&/^3\.1\./.test(data.openapi||'')
        &&data.info?.version==='0.2.0'&&plain(data.paths?.['/v1/submissions']?.post)
        &&data.components?.schemas?.SubmissionRequest?.properties?.questionnaireRevision?.const===QUESTIONNAIRE_REVISION) {
        return {status,data,traceId};
      }
      if(ERRORS.get(status)?.has(data?.code)&&exact(data,['status','code','message','requestId'])
        &&data.status==='error'&&typeof data.message==='string'&&data.requestId===traceId) {
        throw new NamatApiClientError(data.code,{kind:'api',status,traceId,retryAfterSeconds:retryDelay(response.headers),
          submissionOutcome:submission?(status===503?'unknown':'rejected'):'not_applicable'});
      }
      throw new NamatApiClientError('invalid_response',{kind:'response',submissionOutcome:unknown});
    };
    try {return await Promise.race([perform(),timeout]);}
    finally {clearTimeout(timer);controller.abort();}
  }
  return Object.freeze({
    submitSubmission:async input=>request('/v1/submissions',{operation:'submit',body:serializeSubmission(input)}),
    getReadiness:()=>request('/readyz',{operation:'ready'}),
    getContract:()=>request('/v1/openapi.json',{operation:'contract'}),
  });
}
