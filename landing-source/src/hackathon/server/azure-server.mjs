// Azure App Service entrypoint. Configuration comes from platform environment
// settings; this server never loads environment files or logs request details.
import {createServer} from 'node:http';
import {readFile, realpath, stat} from 'node:fs/promises';
import {extname, resolve, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {handleHackathonHttp} from './http.mjs';
import {MAX_BODY_BYTES} from './api.mjs';
import {hackathonConfig} from './api.mjs';
import {getHackathonPool} from './store.mjs';
import {getReportService,reportConfig} from '../../../services/report-processing/service.mjs';
import {fork} from 'node:child_process';

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

export function createHackathonAzureServer({publicDirectory=DEFAULT_PUBLIC,env=process.env,pool,reportService} = {}) {
  const base=resolve(publicDirectory);
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
      const path=pathname(req.url);
      if(path===null)return send(req,res,400,'Bad request.');
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
