import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {poolOptions,createHackathonStore} from '../../src/hackathon/server/store.mjs';
import {sendHackathonConfirmation} from '../../src/hackathon/server/confirmation-email.mjs';
import {createReportService} from './service.mjs';
import {inspectDocument} from './document.mjs';
import {analyzeLayout} from './ocr.mjs';
import {extractObservations,PROCESSOR_VERSION} from './extract.mjs';

export async function processNextReport({store,blobs,inspect=inspectDocument,ocr=analyzeLayout,env=process.env}) {
  const job=await store.claimJob();if(!job)return {worked:false};
  try {
    const bytes=await blobs.read(job.report.blobKey);
    if(createHash('sha256').update(bytes).digest('hex')!==job.report.sha256){const e=new Error('Stored report integrity mismatch.');e.code='integrity_mismatch';throw e;}
    let document=await inspect(bytes,job.report.mime),method='native';
    if(document.needsOcr) {
      const budget=Number(env.NAMAT_OCR_DAILY_PAGE_LIMIT||200);
      if(!Number.isInteger(budget)||budget<1||budget>1000||!await store.reserveOcrPages(document.pageCount,budget)){const e=new Error('Daily OCR limit reached.');e.code='ocr_daily_limit';throw e;}
      document=await ocr(bytes,job.report.mime,{env});method='azure-layout';
    }
    const observations=extractObservations(document.pages);
    const result=await store.completeJob(job,{processorVersion:`${PROCESSOR_VERSION}:${method}`,pages:document.pages,pageCount:document.pageCount,
      observations,warnings:observations.length?['Draft values require comparison with the source report.']:['No supported lab values were identified. Review the source report manually.']});
    return {worked:true,completed:result.completed,reportId:job.reportId};
  } catch(error) {
    const code=/^[a-z][a-z0-9_]{0,79}$/.test(error.code||'')?error.code:'processing_unavailable';
    await store.failJob(job,code,{retryable:['processing_unavailable','ocr_timeout','ocr_http_429','ocr_http_500','ocr_http_502','ocr_http_503','ocr_http_504'].includes(code)});
    return {worked:true,completed:false,reportId:job.reportId,code};
  }
}
export async function cleanupExpiredReports({store,blobs,pool}) {
  let deleted=0;
  for(const report of await store.expiredReports()) {
    try {
      if(report.blobKey.startsWith('reports/'))await blobs.deleteOriginal(report.blobKey);
      // Covers a crash between promotion and its database update.
      else await blobs.deleteOriginal(`reports/${report.id}`);
      await blobs.deleteQuarantine(`uploads/${report.id}`);
      if(await store.deleteExpiredReport(report.id))deleted++;
    }catch{/* Retry retained metadata and file deletion on the next cleanup pass. */}
  }
  if(pool){
    await pool.query('SELECT public.namat_report_cleanup_metadata()');
  }
  return {deleted};
}
export async function runWorker(env=process.env) {
  const pool=new Pool({...poolOptions({databaseUrl:env.HACKATHON_DATABASE_URL,databaseCa:env.HACKATHON_DATABASE_CA}),max:1});
  const {store,blobs}=createReportService({pool,env});
  let stopping=false,lastCleanup=0,lastEmail=0;
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{stopping=true;});
  console.log('Report worker started.');
  try {
    while(!stopping) {
      try {
        const result=await processNextReport({store,blobs,env});
        if(result.worked)console.log(JSON.stringify({event:'report_job',...result}));
        if(Date.now()-lastCleanup>3600000){await cleanupExpiredReports({store,blobs,pool});lastCleanup=Date.now();}
        if(Date.now()-lastEmail>15000){
          const {rows:[next]}=await pool.query("SELECT reference FROM public.hackathon_email_outbox WHERE status='queued' AND available_at<=now() AND expires_at>now() ORDER BY created_at LIMIT 1");
          if(next)await createHackathonStore(pool).deliverReceiptConfirmation(next.reference,message=>sendHackathonConfirmation(message,{env}));
          // sending/unknown are deliberately held for provider reconciliation.
          lastEmail=Date.now();
        }
        if(!result.worked)await new Promise(resolve=>setTimeout(resolve,3000));
      } catch {console.error('Report worker will retry after a storage failure.');await new Promise(resolve=>setTimeout(resolve,10000));}
    }
  } finally {await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)runWorker().catch(()=>{console.error('Report worker could not start.');process.exitCode=1;});
