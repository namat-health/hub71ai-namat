// Transitional shared API for the approved fictional demo. The existing report
// engine remains the sole storage/worker owner; no writes are mirrored.
import {createHash,timingSafeEqual,randomUUID} from 'node:crypto';
export const DEMO_UPSTREAM='https://namat-welcome-test-uaen-001.azurewebsites.net';
const UUID='[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const SOURCE=new RegExp(`^/v1/demo/submissions/(${UUID})/reports/(${UUID}|legacy-[0-2])$`,'i');
// Parser drafts exist only for stored reports, never legacy attachments.
const EXTRACTION=new RegExp(`^/v1/demo/submissions/(${UUID})/reports/(${UUID})/extraction$`,'i');
const REVIEWS=new RegExp(`^/v1/demo/submissions/(${UUID})/reports/(${UUID})/reviews$`,'i');
const UPLOAD=new RegExp(`^/v1/demo/reports/uploads/(${UUID})/complete$`,'i');
const REPORT=new RegExp(`^/v1/demo/reports/(${UUID})/(source|reviews|retry)$`,'i');
const CASE=new RegExp(`^/v1/demo/reports/cases/(${UUID})$`,'i');
const MAX_REQUEST=4_000_000,MAX_RESPONSE=12*1024*1024;
const token=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)&&new Set(value).size>=8;
const equal=(a,b)=>typeof a==='string'&&a.length<=256&&timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());

export function demoBridgeConfig(env=process.env) {
  if(env.NAMAT_API_DEMO_ENABLED!=='true')return null;
  const origin=env.NAMAT_DEMO_UPSTREAM_ORIGIN;
  let url;try{url=new URL(origin);}catch{throw new Error('Configure the explicit demo backend origin.');}
  const local=env.NAMAT_API_MODE==='synthetic-local'&&url.protocol==='http:'&&['127.0.0.1','[::1]'].includes(url.hostname)&&url.port;
  if(origin!==DEMO_UPSTREAM&&!local)throw new Error('Use the approved demo backend.');
  if(url.origin!==origin||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Invalid demo backend origin.');
  const values=['NAMAT_DEMO_INTAKE_TOKEN','NAMAT_DEMO_PORTAL_TOKEN','NAMAT_DEMO_UPSTREAM_TOKEN'].map(k=>env[k]);
  if(values.some(v=>!token(v))||new Set(values).size!==3)throw new Error('Configure three distinct random demo service credentials.');
  return Object.freeze({origin,intakeToken:values[0],portalToken:values[1],upstreamToken:values[2]});
}

export function demoRoute(path) {
  if(path==='/v1/demo/intake')return {scope:'intake',methods:['GET','POST','OPTIONS'],upstream:'/api/hackathon'};
  if(path==='/v1/demo/ready')return {scope:'portal',methods:['GET'],upstream:'/api/namat-portal/ready'};
  if(path==='/v1/demo/submissions')return {scope:'portal',methods:['GET'],upstream:'/api/namat-portal/submissions'};
  const source=SOURCE.exec(path);
  if(source)return {scope:'portal',methods:['GET'],upstream:`/api/namat-portal/submissions/${source[1]}/reports/${source[2]}`};
  const extraction=EXTRACTION.exec(path);
  if(extraction)return {scope:'portal',methods:['GET'],upstream:`/api/namat-portal/submissions/${extraction[1]}/reports/${extraction[2]}/extraction`};
  const reviews=REVIEWS.exec(path);
  if(reviews)return {scope:'portal',methods:['POST'],upstream:`/api/namat-portal/submissions/${reviews[1]}/reports/${reviews[2]}/reviews`};
  const reportPaths=['/v1/demo/reports/sessions','/v1/demo/reports/uploads'];
  if(reportPaths.includes(path)||UPLOAD.test(path))return {scope:'intake',methods:['POST'],upstream:path.replace('/v1/demo','/api')};
  if(path==='/v1/demo/reports/cases'||CASE.test(path))return {scope:'intake',methods:['GET'],upstream:path.replace('/v1/demo','/api')};
  const report=REPORT.exec(path);
  if(report)return {scope:'intake',methods:[report[2]==='source'?'GET':'POST'],upstream:path.replace('/v1/demo','/api')};
  return null;
}

function failure(status,code,trace,extra={}) {
  return {status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','x-request-id':trace,...extra},
    body:Buffer.from(JSON.stringify({status:'error',code,message:'The shared demo service could not complete this request.',requestId:trace}))};
}
async function readRequest(req) {
  const length=req.headers['content-length'];
  if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>MAX_REQUEST))return null;
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>MAX_REQUEST){req.pause();return null;}chunks.push(Buffer.from(chunk));}
  return Buffer.concat(chunks);
}
async function readResponse(response) {
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_RESPONSE)){await response.body?.cancel();throw new Error('Bounded response exceeded.');}
  if(!response.body)return Buffer.alloc(0);
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_RESPONSE)throw new Error('Bounded response exceeded.');chunks.push(Buffer.from(value));}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}
  finally{reader.releaseLock();}
  // Fetch can transparently decompress responses; upstream is asked for identity.
  if(length!==null&&size!==Number(length))throw new Error('Truncated response.');
  return Buffer.concat(chunks);
}

export function createDemoBridge({env=process.env,fetcher=fetch,maxInFlight=4,maxRequests=240,timeoutMs=40000,now=Date.now}={}) {
  const config=demoBridgeConfig(env);
  let inFlight=0;const windows=new Map();
  return async function handle(req,{trace=randomUUID()}={}) {
    if(!config)return failure(503,'demo_unavailable',trace);
    const key=req.headers['x-namat-service-key'];
    const scope=equal(key,config.intakeToken)?'intake':equal(key,config.portalToken)?'portal':null;
    if(!scope)return failure(401,'unauthorized',trace);
    const route=demoRoute(req.url);
    if(!route)return failure(404,'not_found',trace);
    if(route.scope!==scope)return failure(403,'forbidden_scope',trace);
    if(!route.methods.includes(req.method))return failure(405,'method_not_allowed',trace,{allow:route.methods.join(', ')});
    const time=now();let window=windows.get(scope);
    if(!window||time-window.start>=60000){window={start:time,count:0};windows.set(scope,window);}
    if(++window.count>maxRequests||inFlight>=maxInFlight)return failure(429,'rate_limited',trace,{'retry-after':'60'});
    inFlight++;
    try {
      const body=['POST','PUT','PATCH'].includes(req.method)?await readRequest(req):undefined;
      if(body===null)return failure(413,'payload_too_large',trace,{connection:'close'});
      const headers={'X-Namat-Upstream-Key':config.upstreamToken,'X-Namat-Request-Id':trace,'Accept-Encoding':'identity'};
      for(const name of ['origin','authorization','x-report-session','content-type','accept','sec-fetch-site','access-control-request-method','access-control-request-headers']){
        const value=req.headers[name];if(typeof value==='string')headers[name]=value;
      }
      const response=await fetcher(config.origin+'/internal/namat'+route.upstream,{method:req.method,headers,...(body!==undefined?{body}:{}),redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
      if(response.status>=300&&response.status<400){await response.body?.cancel();return failure(502,'upstream_unavailable',trace);}
      const bytes=await readResponse(response);
      const outgoing={'cache-control':'private, no-store','content-length':String(bytes.length),'x-request-id':trace,'x-namat-api-route':'demo-v1'};
      for(const name of ['content-type','content-disposition','retry-after','allow','x-namat-content-sha256','access-control-allow-origin','access-control-allow-methods','access-control-allow-headers','vary']){
        const value=response.headers.get(name);if(value!==null)outgoing[name]=value;
      }
      return {status:response.status,headers:outgoing,body:bytes};
    } catch {return failure(502,'upstream_unavailable',trace);}
    finally{inFlight--;}
  };
}
