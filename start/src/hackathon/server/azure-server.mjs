// Azure App Service entrypoint. Configuration comes from platform environment
// settings; this server never loads environment files or logs request details.
import {createServer} from 'node:http';
import {readFile, realpath, stat} from 'node:fs/promises';
import {extname, resolve, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {handleHackathonHttp} from './http.mjs';
import {MAX_BODY_BYTES} from './api.mjs';
import {hackathonConfig} from './api.mjs';
import {getHackathonPool,createHackathonStore} from './store.mjs';
import {getReportService,reportConfig} from '../../../services/report-processing/service.mjs';
import {fork} from 'node:child_process';
import {sharedApiConfig,sharedApiRoute,portalRoute,validUpstreamRequest,proxySharedApi,INTERNAL_PREFIX,MAX_PROXY_RESPONSE_BYTES} from './shared-api.mjs';
import {listSubmissions,reportExtractionResponse,reportReviewResponse,reportSourceResponse} from './portal-data.mjs';

export const SECURITY_HEADERS = Object.freeze({
  'X-Robots-Tag':'noindex, nofollow, noarchive',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'X-Frame-Options':'DENY',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
});
const TYPES = Object.freeze({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp','.avif':'image/avif',
  '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.ico':'image/x-icon',
  '.woff2':'font/woff2','.woff':'font/woff','.mp4':'video/mp4'});
const DEFAULT_PUBLIC = fileURLToPath(new URL('../../../public/', import.meta.url));
const MAX_STATIC_BYTES = 32 * 1024 * 1024;

export function azureServerOptions(env = process.env) {
  const port = env.PORT || '8080';
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  return {port:Number(port),host:'0.0.0.0'};
}

function pathname(raw = '/') {
  if (typeof raw !== 'string' || raw.length > 4096 || !raw.startsWith('/') || raw.startsWith('//')) return null;
  try {
    const path = decodeURIComponent(raw.split('?',1)[0]);
    if (/[\\\u0000-\u0020\u007f]/.test(path) || path.includes('//') || path.split('/').some(part=>part.startsWith('.'))) return null;
    return path;
  } catch {return null;}
}

// Stop buffering at the limit, including chunked requests without a length.
function readBody(req) {
  return new Promise((resolveBody,reject)=>{
    const chunks=[];let size=0;
    const clear=()=>{req.off('data',data);req.off('end',end);req.off('error',error);req.off('aborted',aborted);};
    const data=chunk=>{
      size+=chunk.length;
      if(size>MAX_BODY_BYTES){clear();req.pause();resolveBody(null);return;}
      chunks.push(Buffer.from(chunk));
    };
    const end=()=>{clear();resolveBody(Buffer.concat(chunks));};
    const error=()=>{clear();reject(new Error('Unreadable request.'));};
    const aborted=()=>{clear();reject(new Error('Aborted request.'));};
    req.on('data',data);req.once('end',end);req.once('error',error);req.once('aborted',aborted);
  });
}

export function createHackathonAzureServer({publicDirectory=DEFAULT_PUBLIC,env=process.env,pool,reportService,fetchImpl=fetch} = {}) {
  const base=resolve(publicDirectory);
  const sharedConfig=sharedApiConfig(env);
  const securityHeaders={...SECURITY_HEADERS};
  if(reportConfig(env)&&/^[a-z0-9]{3,24}$/.test(env.NAMAT_REPORT_STORAGE_ACCOUNT||''))securityHeaders['Content-Security-Policy']=securityHeaders['Content-Security-Policy'].replace("connect-src 'self'",`connect-src 'self' https://${env.NAMAT_REPORT_STORAGE_ACCOUNT}.blob.core.windows.net`);
  const send=(req,res,status,body='',headers={})=>{
    res.writeHead(status,{'Cache-Control':'no-store','Content-Type':'text/plain; charset=utf-8',...headers});
    res.end(req.method==='HEAD'?'':body);
  };
  const rejectBody=(req,res)=>{
    // Close the oversized upload after writing its bounded error response.
    res.once('finish',()=>req.destroy());
    send(req,res,413,JSON.stringify({status:'error',message:'Your submission is too large. Please choose smaller reports.'}),
      {'Content-Type':'application/json; charset=utf-8',Connection:'close'});
  };
  const server=createServer({maxHeaderSize:16*1024},async(req,res)=>{
    for(const [key,value] of Object.entries(securityHeaders))res.setHeader(key,value);
    try {
      let path=pathname(req.url);
      if(path===null)return send(req,res,400,'Bad request.');
      // Authenticate before rewriting the URL. An authenticated internal call
      // reaches the existing data owner directly and can never re-enter proxying.
      let internal=false;
      if(path===INTERNAL_PREFIX||path.startsWith(INTERNAL_PREFIX+'/')) {
        if(!validUpstreamRequest(req.headers,sharedConfig))return send(req,res,401,'Unauthorized.');
        if(req.url.includes('?')||req.url.includes('%'))return send(req,res,400,'Bad request.');
        if(['GET','OPTIONS'].includes(req.method)&&((req.headers['content-length']!==undefined&&req.headers['content-length']!=='0')||req.headers['transfer-encoding']))return send(req,res,400,'Bad request.');
        path=path.slice(INTERNAL_PREFIX.length);
        if(!sharedApiRoute(path,req.method)&&!portalRoute(path,req.method))return send(req,res,404,'Not found.');
        internal=true;req.url=path;delete req.headers['x-namat-upstream-key'];delete req.headers['x-namat-service-key'];
      }
      if(path.startsWith('/api/namat-portal')) {
        if(!internal)return send(req,res,404,'Not found.');
        const route=portalRoute(path,req.method),config=hackathonConfig(env);
        if(!route||!config||!reportConfig(env))return send(req,res,503,'{"status":"unavailable"}',{'Content-Type':'application/json; charset=utf-8'});
        const database=pool||await getHackathonPool(config);
        if(route.kind==='ready') {
          let ready=false;
          try {
            const {rows}=await database.query("SELECT relation IS NOT NULL AND has_table_privilege(current_user,relation,'SELECT') AS ready FROM (SELECT to_regclass(name) AS relation FROM unnest(ARRAY['public.hackathon_welcome_submissions','public.namat_reports']) AS name) target");
            ready=rows.length===2&&rows.every(row=>row.ready===true)&&await createHackathonStore(database).ready();
          } catch {}
          return send(req,res,ready?200:503,JSON.stringify({status:ready?'ready':'unavailable'}),{'Content-Type':'application/json; charset=utf-8'});
        }
        if(route.kind==='submissions') {
          const output=JSON.stringify({submissions:await listSubmissions(database)});
          if(Buffer.byteLength(output)>MAX_PROXY_RESPONSE_BYTES)return send(req,res,503,'{"status":"unavailable"}',{'Content-Type':'application/json; charset=utf-8'});
          return send(req,res,200,output,{'Content-Type':'application/json; charset=utf-8'});
        }
        if(route.kind==='extraction') {
          const result=await reportExtractionResponse(route,{pool:database});
          return send(req,res,result.status,Buffer.from(await result.arrayBuffer()),Object.fromEntries(result.headers));
        }
        if(route.kind==='review') {
          const json={'Content-Type':'application/json; charset=utf-8'};
          if(!/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(req.headers['content-type']||''))return send(req,res,415,'{"status":"error","code":"unsupported_media_type"}',json);
          const length=req.headers['content-length'];
          if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>MAX_BODY_BYTES))return rejectBody(req,res);
          const raw=await readBody(req);
          if(raw===null)return rejectBody(req,res);
          let body;
          try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
          catch{return send(req,res,400,'{"status":"error","code":"invalid_json"}',json);}
          const service=reportService||getReportService(database,env);
          const result=await reportReviewResponse(route,{pool:database,store:service.store,body});
          return send(req,res,result.status,Buffer.from(await result.arrayBuffer()),Object.fromEntries(result.headers));
        }
        const service=reportService||getReportService(database,env);
        const result=await reportSourceResponse(new Request(`https://start.namat.health${path}`),route,{pool:database,blobs:service.blobs});
        return send(req,res,result.status,Buffer.from(await result.arrayBuffer()),Object.fromEntries(result.headers));
      }
      if(!internal&&sharedConfig.enabled&&(path.startsWith('/api/reports/')||/^\/api\/hackathon\/?$/.test(path))) {
        const route=sharedApiRoute(path,req.method);
        if(!route||req.url.includes('?')||req.url.includes('%'))return send(req,res,404,'Not found.');
        await proxySharedApi(req,res,{config:sharedConfig,route,fetchImpl});return;
      }
      if(path.startsWith('/api/reports/')&&reportConfig(env)) {
        const config=hackathonConfig(env);
        if(!config)return send(req,res,503,'Report service is unavailable.');
        await (reportService||getReportService(pool||await getHackathonPool(config),env)).handle(req,res);return;
      }
      if(['/review','/review/','/review.mjs','/review.css','/review/review.mjs','/review/review.css'].includes(path)&&reportConfig(env)) {
        if(!['GET','HEAD'].includes(req.method))return send(req,res,405,'Method not allowed.');
        res.setHeader('Content-Security-Policy',securityHeaders['Content-Security-Policy'].replace("img-src 'self' data:","img-src 'self' data: blob:")+"; frame-src blob:");
        const name=path.endsWith('.mjs')?'review.mjs':path.endsWith('.css')?'review.css':'review.html';
        return send(req,res,200,await readFile(new URL(`../../../services/report-processing/${name}`,import.meta.url)),{'Content-Type':name.endsWith('.mjs')?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8'});
      }
      if(path==='/api/hackathon'||path==='/api/hackathon/') {
        if(req.method==='POST') {
          const length=req.headers['content-length'];
          if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>MAX_BODY_BYTES))return rejectBody(req,res);
          const body=await readBody(req);
          if(body===null)return rejectBody(req,res);
          req.body=body;
        }
        await handleHackathonHttp(req,{
          get headersSent(){return res.headersSent;},
          writeHead:(status,headers)=>res.writeHead(status,{...headers,...securityHeaders}),
          end:body=>res.end(body),
        },{env,pool});
        return;
      }
      if(!['GET','HEAD'].includes(req.method))return send(req,res,405,'Method not allowed.',{Allow:'GET, HEAD'});
      if(path==='/healthz')return send(req,res,200,'{"status":"ok"}',{'Content-Type':'application/json; charset=utf-8'});
      if(path==='/')return send(req,res,307,'',{Location:'/welcome'});
      const relativePath=['/welcome','/welcome/','/welcome/index.html'].includes(path)?'welcome/index.html'
        : path==='/favicon.svg'?'favicon.svg':/^\/(?:_astro|assets)\/[\w./-]+$/.test(path)?path.slice(1):null;
      if(!relativePath)return send(req,res,404,'Not found.');
      const canonicalBase=await realpath(base);
      const file=resolve(canonicalBase,relativePath),type=TYPES[extname(file)];
      const metadata=type&&file.startsWith(canonicalBase+sep)?await stat(file).catch(()=>null):null;
      if(!metadata?.isFile()||metadata.size>MAX_STATIC_BYTES||await realpath(file)!==file)return send(req,res,404,'Not found.');
      const cache=relativePath.startsWith('_astro/')?'public, max-age=31536000, immutable':'no-cache';
      send(req,res,200,req.method==='HEAD'?'':await readFile(file),{'Content-Type':type,'Content-Length':metadata.size,'Cache-Control':cache});
    } catch {
      if(!res.headersSent)send(req,res,503,'Temporarily unavailable.');
      else if(!res.writableEnded)res.end();
    }
  });
  server.requestTimeout=60000;
  server.headersTimeout=10000;
  server.keepAliveTimeout=5000;
  server.maxRequestsPerSocket=100;
  server.on('clientError',(_error,socket)=>{
    if(socket.writable)socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  return server;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const {port,host}=azureServerOptions();
    const server=createHackathonAzureServer();
    let reportWorker,workerTimer,workerStopping=false;
    const startWorker=()=>{
      if(workerStopping)return;
      reportWorker=fork(new URL('../../../services/report-processing/worker.mjs',import.meta.url),[],{stdio:'inherit'});
      reportWorker.once('exit',()=>{if(!workerStopping)workerTimer=setTimeout(startWorker,5000);});
    };
    if(reportConfig(process.env))startWorker();
    server.on('error',()=>{console.error('The demo server could not start. Check the listener settings.');process.exitCode=1;});
    server.listen(port,host,()=>console.log('The demo server is listening.'));
    let stopping=false;
    for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{
      if(stopping)return;stopping=true;
      workerStopping=true;clearTimeout(workerTimer);reportWorker?.kill('SIGTERM');
      const timer=setTimeout(()=>{server.closeAllConnections();process.exit(0);},15000);timer.unref();
      server.close(()=>{clearTimeout(timer);process.exit(0);});
      server.closeIdleConnections();
    });
  } catch {
    console.error('The demo server refused startup. Check the listener settings.');
    process.exitCode=1;
  }
}
