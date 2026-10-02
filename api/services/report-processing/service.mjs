import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {createReportStore} from './store.mjs';
import {createBlobStore,MAX_REPORT_BYTES} from './blob.mjs';
import {createLocalBlobStore} from './local-blob.mjs';
import {inspectDocument} from './document.mjs';
export const tokenHash=token=>createHash('sha256').update(token).digest('hex');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function reportConfig(env) {return env.NAMAT_REPORTS_ENABLED==='true';}
const services=new WeakMap();
export function getReportService(pool,env=process.env) {
  if(!services.has(pool))services.set(pool,createReportService({pool,env}));
  return services.get(pool);
}
export function createReportService({pool,env=process.env,blobStore,inspect=inspectDocument}) {
  const store=createReportStore(pool);
  const blobs=blobStore||(env.NAMAT_REPORT_LOCAL_DIRECTORY
    ? createLocalBlobStore(env.NAMAT_REPORT_LOCAL_DIRECTORY,env.NAMAT_REPORT_REVIEW_TOKEN)
    : createBlobStore(env));
  let windowStart=0,requests=0,inspections=0;
  const origins=new Set((env.HACKATHON_ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()));
  const publicReport=r=>({id:r.id,name:r.name,type:r.mime,size:r.size,status:r.status,errorCode:r.errorCode,pageCount:r.pageCount,createdAt:r.createdAt});
  async function authorizeSession(id,token) {
    return UUID.test(id||'')&&typeof token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(token)&&await store.authorizeSession(id,tokenHash(token));
  }
  const readJson=async(req,max=1000000)=>{
    const chunks=[];let total=0;
    for await(const chunk of req){total+=chunk.length;if(total>max){const e=new Error('Request too large.');e.status=413;throw e;}chunks.push(chunk);}
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{const e=new Error('Send valid JSON.');e.status=400;throw e;}
  };
  return {store,blobs,authorizeSession,
    async resolveReports(ids,session) {
      if (!Array.isArray(ids)||ids.length<1||ids.length>3||new Set(ids).size!==ids.length||ids.some(id=>!UUID.test(id))||!await authorizeSession(session?.id,session?.token)) throw new Error('Invalid report session.');
      const reports=await Promise.all(ids.map(id=>store.getReport(id,session.id)));
      if(reports.some(r=>!r||!['queued','processing','ready'].includes(r.status)||new Date(r.expiresAt)<=new Date()))throw new Error('Reports have not finished uploading.');
      return reports.map(r=>({id:r.id,name:r.name,type:r.mime,size:r.size,sha256:r.sha256}));
    },
    async handle(req,res) {
      const url=new URL(req.url,'http://localhost'),path=url.pathname;
      const send=(status,body,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store',...headers});res.end(Buffer.isBuffer(body)?body:JSON.stringify(body));};
      try {
        if(blobs.local&&!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host||''))return send(403,{message:'Local report storage is available only on this computer.'});
        if(req.headers.origin&&!origins.has(req.headers.origin))return send(403,{message:'Use the Namat application.'});
        if(['POST','PUT'].includes(req.method)&&(!origins.has(req.headers.origin)||req.headers['sec-fetch-site']==='cross-site'))return send(403,{message:'Use the Namat application.'});
        if(Date.now()-windowStart>60000){windowStart=Date.now();requests=0;}
        if(++requests>120)return send(429,{message:'Please wait a minute and retry.'},{'Retry-After':'60'});
        const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
        if(path==='/api/reports/local-upload'&&req.method==='PUT'&&blobs.local){
          const parts=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>MAX_REPORT_BYTES)return send(413,{message:'Choose a report of 10 MiB or less.'});parts.push(chunk);}
          await blobs.receive(url,Buffer.concat(parts));return send(201,{status:'uploaded'});
        }
        if(path==='/api/reports/sessions'&&req.method==='POST') {
          if(req.headers['content-type']!=='application/json')return send(415,{message:'Send JSON.'});
          await readJson(req,1024);const token=randomBytes(32).toString('base64url');
          const session=await store.createSession(tokenHash(token));return send(201,{sessionId:session.id,token});
        }
        if(path==='/api/reports/uploads'||/^\/api\/reports\/uploads\/[a-f0-9-]+\/complete$/.test(path)) {
          if(req.method!=='POST')return send(405,{message:'Use POST.'});
          if(!await authorizeSession(req.headers['x-report-session'],token))return send(401,{message:'Your upload session expired. Choose the files again.'});
          const sessionId=req.headers['x-report-session'],body=await readJson(req,2048);
          if(path==='/api/reports/uploads') {
            const extensions={'application/pdf':/\.pdf$/i,'image/png':/\.png$/i,'image/jpeg':/\.jpe?g$/i};
            if(typeof body.name!=='string'||body.name!==body.name.trim()||body.name.length<1||body.name.length>160||Buffer.byteLength(body.name)>256||/[\x00-\x1f\x7f<>/\\]/.test(body.name)||!extensions[body.type]?.test(body.name)||!Number.isInteger(body.size)||body.size<1||body.size>MAX_REPORT_BYTES||!/^[a-f0-9]{64}$/.test(body.sha256||''))return send(400,{message:'Choose a PDF, JPG or PNG of 10 MiB or less, with a simple filename.'});
            const report=await store.createReport(sessionId,{name:body.name,mime:body.type,size:body.size,sha256:body.sha256});
            return send(201,{reportId:report.id,status:report.status,uploadUrl:await blobs.uploadUrl(`uploads/${report.id}`)});
          }
          const id=path.split('/')[4],report=UUID.test(id)&&await store.getReport(id,sessionId);
          if(!report)return send(404,{message:'Report not found.'});
          if(['queued','processing','ready'].includes(report.status))return send(200,{reportId:id,status:report.status});
          if(report.status!=='uploading')return send(409,{message:'Choose the report again.'});
          if(inspections>=2)return send(429,{message:'Other reports are being checked. Please retry shortly.'});
          inspections++;
          try {
            const bytes=await blobs.readQuarantine(`uploads/${id}`,report);
            await inspect(bytes,report.mime);
            const blobKey=await blobs.promote(id,bytes,report.mime);
            await store.markUploaded(id,sessionId,{sha256:report.sha256,size:report.size,blobKey});
            await blobs.deleteQuarantine(`uploads/${id}`).catch(()=>{});
            return send(200,{status:'queued',reportId:id});
          } catch(error) {
            if(error.name==='DocumentInspectionError'||['hash_mismatch','size_mismatch'].includes(error.code)){
              await store.markRejected(id,sessionId,error.code||'invalid_document');
              await blobs.deleteQuarantine(`uploads/${id}`).catch(()=>{});
              return send(400,{message:error.message,code:error.code||'invalid_document'});
            }
            throw error;
          } finally {inspections--;}
        }
        const expected=env.NAMAT_REPORT_REVIEW_TOKEN;
        if(!expected||expected.length<32||Buffer.byteLength(token)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(token),Buffer.from(expected)))return send(401,{message:'Enter your reviewer access key.'});
        if(path==='/api/reports/cases'&&req.method==='GET')return send(200,{cases:await store.listCases()});
        const detail=path.match(/^\/api\/reports\/cases\/([a-f0-9-]+)$/);
        if(detail&&req.method==='GET'&&UUID.test(detail[1])) {
          const data=await store.getCase(detail[1]);if(!data)return send(404,{message:'Case not found.'});
          return send(200,{case:{id:data.submissionId,receiptId:data.receiptId,firstName:data.firstName,createdAt:data.createdAt},reports:data.reports.map(r=>({...publicReport(r),extraction:r.extractions?.[0]||null,reviews:r.reviews||[]}))});
        }
        const source=path.match(/^\/api\/reports\/([a-f0-9-]+)\/source$/);
        if(source&&req.method==='GET'&&UUID.test(source[1])) {
          const r=await store.getReport(source[1]);if(!r?.submissionId||new Date(r.expiresAt)<=new Date()||!['processing','ready','queued','failed'].includes(r.status))return send(404,{message:'Report not found.'});
          const bytes=await blobs.read(r.blobKey);
          if(tokenHash(bytes)!==r.sha256)throw new Error('Report integrity mismatch.');
          return send(200,bytes,{'Content-Type':r.mime,'Content-Disposition':`inline; filename="report.${r.mime==='application/pdf'?'pdf':r.mime==='image/png'?'png':'jpg'}"`,'Content-Security-Policy':"default-src 'none'; sandbox"});
        }
        const review=path.match(/^\/api\/reports\/([a-f0-9-]+)\/reviews$/);
        if(review&&req.method==='POST'&&UUID.test(review[1]))return send(201,{review:await store.saveReview(review[1],await readJson(req),'demo-reviewer')});
        const retry=path.match(/^\/api\/reports\/([a-f0-9-]+)\/retry$/);
        if(retry&&req.method==='POST'&&UUID.test(retry[1])){await readJson(req,1024);return send(200,{report:publicReport(await store.retryReport(retry[1]))});}
        return send(404,{message:'This operation is not available.'});
      } catch(error) {
        const status=Number.isInteger(error.status)&&error.status>=400&&error.status<500?error.status:503;
        send(status,{message:status===503?'Report storage is temporarily unavailable. Please retry.':error.message,code:status===503?'unavailable':error.code});
      }
    },
  };
}
