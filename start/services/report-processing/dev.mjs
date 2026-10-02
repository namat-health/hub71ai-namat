import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Pool} from 'pg';
import {createHackathonAzureServer} from '../../src/hackathon/server/azure-server.mjs';
import {createReportService} from './service.mjs';
import {processNextReport,cleanupExpiredReports} from './worker.mjs';

const env={...process.env},url=new URL(env.HACKATHON_DATABASE_URL);
if(!['127.0.0.1','localhost'].includes(url.hostname)||!env.NAMAT_REPORT_LOCAL_DIRECTORY||!env.NAMAT_REPORT_REVIEW_TOKEN)throw new Error('The report preview requires explicit local settings.');
const native=new Pool({connectionString:url.href,max:4}),schema='namat_reports_dev';
const scoped=sql=>sql.replaceAll('public.',`${schema}.`);
const pool={query:(sql,values)=>native.query(scoped(sql),values),connect:async()=>{const client=await native.connect();return {query:(sql,values)=>client.query(scoped(sql),values),release:()=>client.release()};}};
if(process.argv.includes('--init')) {
  const client=await native.connect();
  try {
    await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('namat-report-preview-initialization'))");
    if(!(await client.query('SELECT to_regnamespace($1) AS schema',[schema])).rows[0].schema) {
      await client.query(`CREATE SCHEMA ${schema}`);
      for(const path of ['../../src/hackathon/db/001_welcome_submissions.sql','./db/002_report_processing.sql'])await client.query(scoped(await readFile(new URL(path,import.meta.url),'utf8')));
    }
    await client.query('COMMIT');console.log('Local report preview schema is ready.');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();await native.end();}
} else {
  const port=Number(env.PORT||4350);env.HACKATHON_ALLOWED_ORIGINS=`http://127.0.0.1:${port},http://localhost:${port}`;
  env.HACKATHON_ENABLED='true';env.NAMAT_REPORTS_ENABLED='true';env.HACKATHON_EMAIL_MODE='local';
  const service=createReportService({pool,env});
  const server=createHackathonAzureServer({publicDirectory:resolve('dist-hackathon/public'),env,pool,reportService:service});
  let busy=false;
  const timer=setInterval(async()=>{if(busy)return;busy=true;try{await processNextReport({...service,env});}catch{console.error('Local report worker is unavailable.');}finally{busy=false;}},2000);
  server.listen(port,'127.0.0.1',()=>console.log(`Local fictional report preview: http://127.0.0.1:${port}/review`));
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{clearInterval(timer);server.close(async()=>{await native.end();process.exit(0);});});
}
