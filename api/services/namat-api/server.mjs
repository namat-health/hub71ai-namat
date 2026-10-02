import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {validateHackathonSubmission, MAX_BODY_BYTES} from '../../src/hackathon/server/api.mjs';
import {readApiConfig, QUESTIONNAIRE_REVISION} from './config.mjs';
import {assertSourceRevision} from './revision.mjs';
import {createDatabase} from './database.mjs';
import {inspectDocument, DocumentInspectionError, DOCUMENT_LIMITS} from '../report-processing/document.mjs';
import {hasStagingAccess} from './staging-auth.mjs';
import {createDemoBridge} from './demo-bridge.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const headers = Object.freeze({
  'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'private, no-store',
  'X-Content-Type-Options':'nosniff', 'X-Robots-Tag':'noindex, nofollow',
  'Referrer-Policy':'no-referrer', 'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",
  'X-Frame-Options':'DENY', Vary:'Origin',
});
function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    const clear = () => {req.off('data',data);req.off('end',end);req.off('error',error);req.off('aborted',error);};
    const data = chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {clear();req.pause();resolveBody(null);return;}
      chunks.push(Buffer.from(chunk));
    };
    const end = () => {clear();resolveBody(Buffer.concat(chunks));};
    const error = () => {clear();reject(new Error('Unreadable body.'));};
    req.on('data',data);req.once('end',end);req.once('error',error);req.once('aborted',error);
  });
}
function isLocalHost(host, port) {
  if (typeof host !== 'string') return false;
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host.toLowerCase());
}

export async function inspectSubmissionReports(reports,{staging=false,inspect=inspectDocument,now=Date.now}={}) {
  // A three-file request shares one staging inspection budget. Each worker is
  // given only the remaining time; local document behavior stays unchanged.
  const deadline = staging ? now() + DOCUMENT_LIMITS.timeoutMs : null;
  for (const report of reports) {
    if (!staging) {await inspect(report.bytes,report.type);continue;}
    const remaining = Math.min(DOCUMENT_LIMITS.timeoutMs,deadline-now());
    if (remaining <= 0) throw new DocumentInspectionError('inspection_timeout');
    await inspect(report.bytes,report.type,{timeoutMs:remaining});
  }
}

function stagingContract(spec, config) {
  spec.info.title = 'Namat API — synthetic staging intake';
  spec.info.description = 'Authenticated synthetic staging intake. No private record reads, clinical approval, AI processing or external email delivery. The staging bearer credential belongs in trusted server-side clients only; it is not a patient or doctor identity.';
  spec.servers = [{url:config.publicOrigin, description:'Azure staging; fictional data only.'}];
  spec.security = [{StagingToken:[]}];
  spec.components.securitySchemes = {...spec.components.securitySchemes, StagingToken:{type:'http', scheme:'bearer',
    description:'Server-side staging access credential. Never embed this credential in a website, browser bundle or example.'}};
  const errorCodes = spec.components.schemas.ApiError?.properties?.code?.enum;
  if (errorCodes && !errorCodes.includes('unauthorized')) errorCodes.push('unauthorized');
  for (const [path, item] of Object.entries(spec.paths)) for (const [method, operation] of Object.entries(item)) {
    if (!['get','head','post','options','put','patch','delete'].includes(method)) continue;
    const publicOperation = path === '/healthz' || method === 'options';
    operation.security = publicOperation ? [] : [{StagingToken:[]}];
    if (!publicOperation) operation.responses['401'] = {description:'Missing or invalid staging bearer credential.',
      headers:{'X-Request-Id':{schema:{$ref:'#/components/schemas/TraceId'}},
        'Cache-Control':{schema:{type:'string',const:'private, no-store'}},
        'WWW-Authenticate':{schema:{type:'string',const:'Bearer realm="namat-staging"'}}},
      ...(method === 'head' ? {} : {content:{'application/json':{schema:{$ref:'#/components/schemas/ApiError'}}}})};
    if (operation.responses['403']) operation.responses['403'].description = 'Host or supplied Origin is not permitted, or the browser preflight is not permitted.';
    for (const parameter of operation.parameters || []) if (parameter.in === 'header' && parameter.name === 'Origin') {
      parameter.required = method === 'options';
      parameter.description = 'Optional for server clients; when supplied it must exactly match a configured HTTPS client origin. Required for preflight.';
    }
    if (method === 'options') {
      operation.responses['204'].headers['Access-Control-Allow-Headers'].schema.const = 'Content-Type, Authorization';
      operation.parameters.find(parameter=>parameter.name === 'Access-Control-Request-Headers').description = 'If present, a comma-separated list containing only Content-Type and Authorization (case-insensitive).';
    }
  }
  spec['x-runtime-limits'] = {...spec['x-local-limits'], maxInFlightSubmissions:1, maxInspectionMilliseconds:DOCUMENT_LIMITS.timeoutMs};
  delete spec['x-local-limits'];
  spec.paths['/v1/submissions'].post.description = spec.paths['/v1/submissions'].post.description
    .replace('at most four submissions concurrently', 'one submission at a time')
    .replace('local development limits', 'staging process limits');
  spec.paths['/v1/submissions'].post.responses['429'].description = 'A staging process limit was reached: more than 60 authorized POST attempts in a fixed 60-second window, or one submission already in flight. Retry-After is 60 seconds.';
  spec.paths['/readyz'].get.summary = 'Check that staging storage is available';
  if (spec['x-response-policy']) spec['x-response-policy'].notes = 'Private no-store responses. Requests require the configured public Host and a staging bearer token, except generic liveness and allowed preflight. Forwarded Host headers are never trusted. Liveness alone also accepts loopback probe hosts. Unknown private routes authenticate before returning 404.';
  return spec;
}

export function createNamatApiServer({env = process.env, store: injectedStore} = {}) {
  const config = readApiConfig(env);
  const staging = config.mode === 'synthetic-staging';
  const demoBridge = createDemoBridge({env});
  assertSourceRevision();
  const spec = JSON.parse(readFileSync(new URL('./contracts/openapi.json', import.meta.url), 'utf8'));
  if (staging) stagingContract(spec, config);
  if(env.NAMAT_API_DEMO_ENABLED==='true'){
    spec.info.title='Namat API — isolated intake and connected demo';
    spec.info.description='The operations in this OpenAPI document describe the isolated synthetic intake schema. The separately authenticated /v1/demo interface connects the existing fictional questionnaire, report engine and signed-in doctor portal. See x-demo-interface for its contract.';
    spec['x-demo-interface']={version:'demo-v1',basePath:'/v1/demo',contract:'https://github.com/namat-health/namat-api/blob/main/docs/demo-integration.md',authenticationHeader:'X-Namat-Service-Key',scopes:['intake','portal'],storageOwner:'Existing fictional demo report engine; no mirrored writes.'};
  }
  const database = injectedStore ? null : createDatabase(config);
  const store = injectedStore || database?.store;
  let windowStart = Date.now(), submissions = 0, inFlight = 0;
  const server = createServer({maxHeaderSize:16*1024}, async (req,res) => {
    const trace = randomUUID();
    const base = {...headers, 'X-Request-Id':trace};
    const send = (status, body, extra = {}) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status,{...base,...extra});
      res.end(req.method === 'HEAD' || body === null ? '' : JSON.stringify(body));
    };
    const fail = (status,code,message,extra={}) => send(status,{status:'error',code,message,requestId:trace},extra);
    const closeAfter = () => {base.Connection='close'; res.once('finish',()=>req.destroy());};
    try {
      const path = req.url;
      const healthProbe = path === '/healthz' && ['GET','HEAD'].includes(req.method);
      const suppliedHost = typeof req.headers.host === 'string' ? req.headers.host.toLowerCase() : '';
      const localHost = isLocalHost(suppliedHost,server.address()?.port);
      const allowedHost = staging
        ? suppliedHost === new URL(config.publicOrigin).host || (healthProbe && (localHost || ['localhost','127.0.0.1','[::1]'].includes(suppliedHost)))
        : localHost;
      if (!allowedHost) {
        closeAfter();return fail(403,'forbidden_origin',staging ? 'Use the configured Namat API host.' : 'Use the local Namat API.');
      }
      const origin = req.headers.origin;
      if (origin !== undefined && (typeof origin !== 'string' || !config.origins.has(origin))) {
        closeAfter();return fail(403,'forbidden_origin','This origin is not permitted.');
      }
      if (origin) {base['Access-Control-Allow-Origin']=origin;base['Access-Control-Expose-Headers']='X-Request-Id';}
      if (path.startsWith('/v1/demo/')) {
        const result=await demoBridge(req,{trace});
        if(res.destroyed||res.writableEnded)return;
        if(result.headers.connection==='close')res.once('finish',()=>req.destroy());
        // HTTP header names are case-insensitive. Normalize before overriding
        // JSON defaults so binary reports have one exact media type.
        const outgoing=Object.fromEntries([...Object.entries(base),...Object.entries(result.headers)]
          .map(([name,value])=>[name.toLowerCase(),value]));
        res.writeHead(result.status,outgoing);
        res.end(req.method==='HEAD'?'':result.body);
        return;
      }
      const preflight = path === '/v1/submissions' && req.method === 'OPTIONS';
      if (staging && !healthProbe && !preflight && !hasStagingAccess(req.headers.authorization,config.stagingToken)) {
        closeAfter();return fail(401,'unauthorized','A valid staging credential is required.',{'WWW-Authenticate':'Bearer realm="namat-staging"'});
      }
      const routes = {'/healthz':['GET','HEAD'], '/readyz':['GET','HEAD'], '/v1/openapi.json':['GET','HEAD'], '/v1/submissions':['POST','OPTIONS']};
      if (!Object.hasOwn(routes,path)) {closeAfter();return fail(404,'not_found','This API operation is not available.');}
      if (!routes[path].includes(req.method)) {
        closeAfter();return fail(405,'method_not_allowed','This method is not available.',{Allow:routes[path].join(', ')});
      }
      if (path === '/healthz') return send(200,{status:'ok'});
      if (path === '/v1/openapi.json') return send(200,spec);
      if (path === '/readyz') {
        let ready = false;
        try {ready = Boolean(store && await store.ready());} catch {}
        return send(ready ? 200 : 503,{status:ready ? 'ready' : 'unavailable'});
      }
      if ((!staging && (!origin || req.headers['sec-fetch-site'] === 'cross-site')) || (preflight && !origin)) {
        closeAfter();return fail(403,'forbidden_origin','Use an allowed local questionnaire.');
      }
      if (req.method === 'OPTIONS') {
        const requested = String(req.headers['access-control-request-headers'] || '').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
        const allowedHeaders = staging ? ['content-type','authorization'] : ['content-type'];
        if (req.headers['access-control-request-method'] !== 'POST' || requested.some(x=>!allowedHeaders.includes(x))) {
          return fail(403,'forbidden_origin','This preflight is not permitted.');
        }
        return send(204,null,{'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':staging ? 'Content-Type, Authorization' : 'Content-Type'});
      }
      if (Date.now() - windowStart >= 60000) {windowStart=Date.now();submissions=0;}
      submissions++;
      if (submissions > 60 || inFlight >= (staging ? 1 : 4)) {
        closeAfter();return fail(429,'rate_limited','Please retry shortly.',{'Retry-After':'60'});
      }
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(req.headers['content-type'] || '')
          || (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')) {
        closeAfter();return fail(415,'unsupported_media_type','Send UTF-8 JSON without compression.');
      }
      const length = req.headers['content-length'];
      if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
        closeAfter();return fail(413,'payload_too_large','The request exceeds the size limit.');
      }
      inFlight++;
      try {
        // Bound concurrent readiness checks with the same admission limit as
        // saves; reject unavailable storage before parsing or inspecting files.
        if (!store || !await store.ready()) {closeAfter();return fail(503,'service_unavailable','Submission storage is unavailable.');}
        const bytes = await readBody(req);
        if (bytes === null) {closeAfter();return fail(413,'payload_too_large','The request exceeds the size limit.');}
        let input;
        try {input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
        catch {return fail(400,'invalid_json','Send valid UTF-8 JSON.');}
        if (!input || typeof input !== 'object' || Array.isArray(input) || input.questionnaireRevision !== QUESTIONNAIRE_REVISION) {
          return fail(400,'validation_failed','Use the supported questionnaire revision.');
        }
        const {questionnaireRevision:_revision,...legacyInput}=input;
        const checked = validateHackathonSubmission(legacyInput);
        if (!checked.ok) return fail(400,'validation_failed',checked.message);
        try {await inspectSubmissionReports(checked.value.reports,{staging});}
        catch(error){return fail(400,'validation_failed',error.message);}
        const saved = await store.save(checked.value);
        if (saved?.conflict) return fail(409,'idempotency_conflict','This request ID was already used with different content.');
        if (!UUID.test(saved?.receiptId || '')) return fail(503,'service_unavailable','Submission storage is unavailable.');
        // Outbox work is durable; this API never calls an email/model provider.
        const confirmationEmail = saved.confirmationEmail || 'pending';
        if (!['pending','simulated','accepted','failed','unknown'].includes(confirmationEmail)) throw new Error('Invalid outbox state.');
        return send(201,{status:'saved',receiptId:saved.receiptId,confirmationEmail});
      } finally {inFlight--;}
    } catch {
      if (!res.headersSent) fail(503,'service_unavailable','The API is temporarily unavailable.');
      else if (!res.writableEnded) res.end();
    }
  });
  server.requestTimeout = staging ? 45000 : 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 2000;
  server.maxRequestsPerSocket = 100;
  server.setTimeout(staging ? 45000 : 15000,socket=>socket.destroy());
  server.on('close',()=>{database?.close().catch(()=>{});});
  server.on('clientError',(_error,socket)=>{
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const config = readApiConfig();
    const server = createNamatApiServer();
    server.on('error',()=>{console.error('Namat API could not start. Check listener settings.');process.exitCode=1;});
    server.listen(config.port,config.host,()=>console.log(`Namat API listening in ${config.mode} mode on port ${config.port}. No external email or model calls are enabled.`));
    let stopping = false;
    for (const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{
      if (stopping) return;
      stopping=true;
      const timer=setTimeout(()=>server.closeAllConnections(),5000);timer.unref();
      server.close(()=>clearTimeout(timer));server.closeIdleConnections();
    });
  } catch {
    console.error('Namat API refused startup. Check explicit runtime configuration and the pinned source revision.');process.exitCode=1;
  }
}
