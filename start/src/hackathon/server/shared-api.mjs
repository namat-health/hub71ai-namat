// Server-only compatibility adapter. The browser keeps its existing same-origin
// routes; only this service knows the key used to reach the shared API.
import {createHash,timingSafeEqual} from 'node:crypto';
import {MAX_BODY_BYTES} from './api.mjs';

export const SHARED_API_ORIGIN='https://namat-api-staging-uaen-001.azurewebsites.net';
export const INTERNAL_PREFIX='/internal/namat';
export const MAX_PROXY_RESPONSE_BYTES=10*1024*1024;
const UUID='[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const key=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)&&new Set(value).size>=8;
const digest=value=>createHash('sha256').update(value).digest();

export function sharedApiConfig(env=process.env) {
  if(env.NAMAT_SHARED_API_ENABLED!==undefined&&!['true','false',''].includes(env.NAMAT_SHARED_API_ENABLED))throw new Error('Invalid shared API mode.');
  const enabled=env.NAMAT_SHARED_API_ENABLED==='true';
  const intakeToken=env.NAMAT_SHARED_API_INTAKE_TOKEN||null;
  const upstreamToken=env.NAMAT_SHARED_API_UPSTREAM_TOKEN||null;
  if((intakeToken&&!key(intakeToken))||(upstreamToken&&!key(upstreamToken))||
    (enabled&&(!intakeToken||!upstreamToken))||
    (intakeToken&&intakeToken===upstreamToken)||
    [intakeToken,upstreamToken].some(token=>token&&token===env.NAMAT_REPORT_REVIEW_TOKEN))throw new Error('Shared API credentials are missing or invalid.');
  return {enabled,intakeToken,upstreamToken};
}

export function validUpstreamRequest(headers,config) {
  const supplied=headers['x-namat-upstream-key'];
  return typeof supplied==='string'&&supplied.length<=512&&Boolean(config.upstreamToken)&&
    timingSafeEqual(digest(supplied),digest(config.upstreamToken));
}

// No free-form destination, path traversal, query forwarding or local-upload
// route is accepted by this Azure-only adapter.
export function sharedApiRoute(path,method) {
  if(/^\/api\/hackathon\/?$/.test(path)&&['GET','POST','OPTIONS'].includes(method))return '/v1/demo/intake';
  const suffix=path.startsWith('/api/reports/')?path.slice('/api/reports'.length):null;
  if(!suffix)return null;
  if(method==='POST'&&(['/sessions','/uploads'].includes(suffix)||new RegExp(`^/uploads/${UUID}/complete$`,'i').test(suffix)||new RegExp(`^/${UUID}/(?:reviews|retry)$`,'i').test(suffix)))return `/v1/demo/reports${suffix}`;
  if(method==='GET'&&(suffix==='/cases'||new RegExp(`^/cases/${UUID}$`,'i').test(suffix)||new RegExp(`^/${UUID}/source$`,'i').test(suffix)))return `/v1/demo/reports${suffix}`;
  return null;
}

export function portalRoute(path,method) {
  const review=path.match(new RegExp(`^/api/namat-portal/submissions/(${UUID})/reports/(${UUID})/reviews$`,'i'));
  if(review)return method==='POST'?{kind:'review',submissionId:review[1],reportId:review[2]}:null;
  if(method!=='GET')return null;
  if(path==='/api/namat-portal/ready')return {kind:'ready'};
  if(path==='/api/namat-portal/submissions')return {kind:'submissions'};
  const match=path.match(new RegExp(`^/api/namat-portal/submissions/(${UUID})/reports/(${UUID}|legacy-[0-2])$`,'i'));
  if(match)return {kind:'source',submissionId:match[1],reportId:match[2]};
  // Legacy attachments are never processed, so only stored reports have drafts.
  const extraction=path.match(new RegExp(`^/api/namat-portal/submissions/(${UUID})/reports/(${UUID})/extraction$`,'i'));
  return extraction?{kind:'extraction',submissionId:extraction[1],reportId:extraction[2]}:null;
}

async function body(req,limit) {
  const declared=req.headers['content-length'];
  if(declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>limit))throw Object.assign(new Error('Request too large.'),{status:413});
  if(['GET','OPTIONS'].includes(req.method)){
    if((declared!==undefined&&Number(declared)!==0)||req.headers['transfer-encoding'])throw Object.assign(new Error('Unexpected body.'),{status:400});
    return undefined;
  }
  const parts=[];let total=0;
  const deadline=setTimeout(()=>req.destroy(new Error('Request timed out.')),15000);deadline.unref?.();
  try {
    for await(const chunk of req){total+=chunk.length;if(total>limit)throw Object.assign(new Error('Request too large.'),{status:413});parts.push(Buffer.from(chunk));}
    return Buffer.concat(parts,total);
  } finally {clearTimeout(deadline);}
}

async function responseBytes(response) {
  const declared=response.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>MAX_PROXY_RESPONSE_BYTES)){
    await response.body?.cancel();throw new Error('Invalid upstream response.');
  }
  const reader=response.body?.getReader();if(!reader)return Buffer.alloc(0);
  const chunks=[];let size=0;
  try {
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_PROXY_RESPONSE_BYTES)throw new Error('Invalid upstream response.');chunks.push(Buffer.from(value));}
  } catch(error){await reader.cancel().catch(()=>{});throw error;}
  if(declared!==null&&Number(declared)!==size)throw new Error('Invalid upstream response.');
  return Buffer.concat(chunks,size);
}

export async function proxySharedApi(req,res,{config,route,fetchImpl=fetch}) {
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store'});res.end(JSON.stringify(value));};
  try {
    const payload=await body(req,route==='/v1/demo/intake'?MAX_BODY_BYTES:1_000_000);
    const headers={'X-Namat-Service-Key':config.intakeToken,'Accept-Encoding':'identity'};
    for(const name of ['authorization','origin','x-report-session','content-type','sec-fetch-site','accept','access-control-request-method','access-control-request-headers']){
      if(typeof req.headers[name]==='string')headers[name]=req.headers[name];
    }
    const upstream=await fetchImpl(`${SHARED_API_ORIGIN}${route}`,{method:req.method,headers,body:payload,
      redirect:'error',cache:'no-store',signal:AbortSignal.timeout(55000)});
    if(upstream.status<200||upstream.status>=600||upstream.status>=300&&upstream.status<400)throw new Error('Unexpected upstream response.');
    const bytes=await responseBytes(upstream);
    const out={'Cache-Control':'private, no-store'};
    for(const name of ['content-type','content-disposition','retry-after','content-security-policy','x-request-id','x-namat-api-route',
      'access-control-allow-origin','access-control-allow-methods','access-control-allow-headers','access-control-expose-headers','vary']){
      const value=upstream.headers.get(name);if(value)out[name]=value;
    }
    res.writeHead(upstream.status,out);res.end(bytes);
  } catch(error){
    if(!res.headersSent)send(error.status===413?413:error.status===400?400:502,{status:'unavailable',message:error.status===413?'Your submission is too large.':'The submission service is temporarily unavailable. Please try again.'});
  }
}
