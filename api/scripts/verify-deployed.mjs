// Azure CLI output remains in memory. Never print application setting values.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
const origin='https://namat-api-staging-uaen-001.azurewebsites.net';
try {
 const {stdout}=await run(process.env.NAMAT_AZ_CLI||'az',['webapp','config','appsettings','list','-g','namat-data-test-uaen','-n','namat-api-staging-uaen-001','--only-show-errors','-o','json'],{maxBuffer:2*1024*1024});
 const settings=Object.fromEntries(JSON.parse(stdout).map(x=>[x.name,x.value]));
 const token=settings.NAMAT_API_STAGING_TOKEN;
 if(!/^[a-f0-9]{64}$/.test(token||'')||settings.NAMAT_API_PUBLIC_ORIGIN!==origin)throw new Error('Unexpected deployment settings.');
 const paths=[['/healthz',false,200],['/readyz',false,401],['/readyz',true,200],['/v1/openapi.json',true,200]];
 for(const[path,auth,status]of paths){const r=await fetch(origin+path,{headers:auth?{Authorization:`Bearer ${token}`}:{},redirect:'error',signal:AbortSignal.timeout(45000)});if(r.status!==status)throw new Error('Hosted check failed.');const j=await r.json();if(path==='/readyz'&&auth&&j.status!=='ready')throw new Error('Storage not ready.');}
 console.log('Verified Azure API liveness, authentication, storage readiness and contract. No records or emails created.');
} catch {console.error('Deployment verification failed. Inspect the Azure API app; no secret values were logged.');process.exitCode=1;}
