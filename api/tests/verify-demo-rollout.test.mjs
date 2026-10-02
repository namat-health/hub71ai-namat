import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyDemoRollout,validateUploadUrl} from '../scripts/verify-demo-rollout.mjs';
import {pdf} from './hackathon-fixtures.mjs';
const intake='0123456789abcdef'.repeat(4),portal='fedcba9876543210'.repeat(4),upstream='1234567890abcdef'.repeat(4);
const reportId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',sessionId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const origin='https://start.namat.health',api='https://namat-api-staging-uaen-001.azurewebsites.net';
const marker={'x-namat-api-route':'demo-v1'};
const json=(body,status=200,headers=marker)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});

function setup(t,{loseSession=false,loseCompletion=false,loseSave=false}={}) {
  const dir=mkdtempSync(join(tmpdir(),'namat-rollout-verifier-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const settingsPath=join(dir,'settings.json'),outputDirectory=join(dir,'evidence');
  writeFileSync(settingsPath,JSON.stringify({api:{NAMAT_API_MODE:'synthetic-staging',NAMAT_DEMO_INTAKE_TOKEN:intake,NAMAT_DEMO_PORTAL_TOKEN:portal,NAMAT_DEMO_UPSTREAM_TOKEN:upstream},form:{NAMAT_SHARED_API_INTAKE_TOKEN:intake,NAMAT_SHARED_API_UPSTREAM_TOKEN:upstream},portal:{NAMAT_SHARED_API_ORIGIN:api,NAMAT_SHARED_API_PORTAL_TOKEN:portal}}),{mode:0o600});
  const counts={writes:0,sessions:0,reservations:0,blobWrites:0,submissions:0},rows=new Map();
  let complete=false,uploaded=false;
  const signed=`https://namatreportstestuaen001.blob.core.windows.net/quarantine/uploads/${reportId}?sp=c&spr=https&sr=b&se=2030-01-01T00%3A00%3A00Z&sig=fictional-signature`;
  const fetchImpl=async(value,options={})=>{
    const url=new URL(value),method=options.method||'GET',key=options.headers?.['X-Namat-Service-Key'];
    if(method!=='GET')counts.writes++;
    if(url.origin===api){
      if(url.pathname==='/healthz')return json({status:'ok'},200,{});
      if(!key)return json({},401);
      if(url.pathname==='/v1/demo/intake')return json({},403);
      if(key===intake)return json({},403);
      if(url.pathname==='/v1/demo/ready')return json({status:'ready'});
      if(url.pathname==='/v1/demo/submissions')return json({submissions:[...rows.values()]});
      const match=url.pathname.match(/^\/v1\/demo\/submissions\/([^/]+)\/reports\/([^/]+)$/);
      if(match){
        const row=[...rows.values()].find(row=>row.id===match[1]);
        if(!row?.attached_reports.some(report=>report.id===match[2]))return json({},404);
        const bytes=pdf();return new Response(bytes,{headers:{'content-type':'application/pdf','content-length':String(bytes.length),'x-namat-content-sha256':createHash('sha256').update(bytes).digest('hex')}});
      }
    }
    if(url.origin===origin){
      if(url.pathname.startsWith('/internal/'))return json({},401,{});
      if(url.pathname==='/api/hackathon'){
        if(method==='GET')return json({status:'ready'});
        const data=JSON.parse(options.body);assert.equal(data.email,'fborja@martinez-laredo.com');assert.equal(data.dataClass,'synthetic');assert.equal(data.fictionalConfirmed,true);
        if(!rows.has(data.requestId)){
          counts.submissions++;
          const serial=String(counts.submissions).padStart(12,'0');
          rows.set(data.requestId,{id:`00000000-0000-4000-8000-${serial}`,receipt_id:`10000000-0000-4000-8000-${serial}`,email:data.email,first_name:data.firstName,notes:data.notes,data_class:data.dataClass,fictional_confirmed:true,attached_reports:data.reportIds?.map(id=>({id}))||[]});
        }
        if(loseSave){loseSave=false;throw Error('simulated save acknowledgement lost');}
        return json({status:'saved',receiptId:rows.get(data.requestId).receipt_id,confirmationEmail:'sent'},201);
      }
      if(url.pathname==='/api/reports/sessions'){
        counts.sessions++;if(loseSession){loseSession=false;throw Error('simulated lost response');}
        return json({sessionId,token:'A'.repeat(43)},201);
      }
      if(url.pathname==='/api/reports/uploads'){
        counts.reservations++;return json({reportId,status:'uploading',uploadUrl:signed},201);
      }
      if(url.pathname===`/api/reports/uploads/${reportId}/complete`){
        assert.ok(uploaded||complete);complete=true;uploaded=false;
        if(loseCompletion){loseCompletion=false;throw Error('simulated completion response lost');}
        return json({reportId,status:'queued'});
      }
    }
    if(url.hostname==='namatreportstestuaen001.blob.core.windows.net'){
      assert.equal(value,signed);assert.equal(method,'PUT');assert.deepEqual(options.body,pdf());
      if(uploaded)return new Response(null,{status:409});uploaded=true;counts.blobWrites++;return new Response(null,{status:201});
    }
    throw Error('Unexpected mocked request');
  };
  return {dir,counts,options:{settingsPath,outputDirectory,fetchImpl}};
}

test('hosted verifier is read-only by default',async t=>{
  const fixture=setup(t),result=await verifyDemoRollout(fixture.options);
  assert.equal(result.failed,0);assert.equal(fixture.counts.writes,0);assert.equal(fixture.counts.submissions,0);
});
test('two fictional cases resume without extra records, sessions or file writes',async t=>{
  const fixture=setup(t);
  const first=await verifyDemoRollout({...fixture.options,submitFictional:true});
  assert.equal(first.failed,0);assert.equal(first.syntheticSubmissions,2);
  assert.deepEqual({sessions:fixture.counts.sessions,reservations:fixture.counts.reservations,blobWrites:fixture.counts.blobWrites,submissions:fixture.counts.submissions},{sessions:1,reservations:1,blobWrites:1,submissions:2});
  const previous=fixture.counts.writes;
  const resumed=await verifyDemoRollout({...fixture.options,submitFictional:true});
  assert.equal(resumed.failed,0);assert.equal(fixture.counts.writes,previous);
  const evidence=readFileSync(join(fixture.options.outputDirectory,'hosted-verification.json'),'utf8');
  assert.ok(!evidence.includes(intake));assert.ok(!evidence.includes('A'.repeat(43)));assert.ok(!evidence.includes('fictional-signature'));
});
test('uncertain session creation stops retries instead of creating another session',async t=>{
  const fixture=setup(t,{loseSession:true});
  await assert.rejects(verifyDemoRollout({...fixture.options,submitFictional:true}),/transport_outcome_unknown/);
  await assert.rejects(verifyDemoRollout({...fixture.options,submitFictional:true}),/session_creation_uncertain_manual_recovery_required/);
  assert.equal(fixture.counts.sessions,1);assert.equal(fixture.counts.submissions,1);
});
test('lost completion acknowledgement recovers before any duplicate file upload',async t=>{
  const fixture=setup(t,{loseCompletion:true});
  await assert.rejects(verifyDemoRollout({...fixture.options,submitFictional:true}),/transport_outcome_unknown/);
  const resumed=await verifyDemoRollout({...fixture.options,submitFictional:true});
  assert.equal(resumed.failed,0);assert.equal(fixture.counts.sessions,1);assert.equal(fixture.counts.blobWrites,1);assert.equal(fixture.counts.submissions,2);
});
test('lost intake acknowledgement recovers its saved receipt before resuming the same two cases',async t=>{
  const fixture=setup(t,{loseSave:true});
  await assert.rejects(verifyDemoRollout({...fixture.options,submitFictional:true}),/transport_outcome_unknown/);
  assert.equal(fixture.counts.submissions,1);
  const resumed=await verifyDemoRollout({...fixture.options,submitFictional:true});
  assert.equal(resumed.failed,0);assert.equal(fixture.counts.submissions,2);assert.equal(fixture.counts.sessions,1);
});
test('signed uploads are restricted to the expected private account, object and create-only permission',()=>{
  const good=`https://namatreportstestuaen001.blob.core.windows.net/quarantine/uploads/${reportId}?sp=c&spr=https&sr=b&se=2030-01-01&sig=fixture`;
  assert.equal(validateUploadUrl(good,reportId).expiresSoon,false);
  for(const bad of [good.replace('https:','http:'),good.replace('namatreportstestuaen001','anotheraccount'),good.replace('sp=c','sp=rw'),good.replace('/quarantine/','/originals/'),good.replace(reportId,sessionId)])assert.throws(()=>validateUploadUrl(bad,reportId),/unexpected_upload_destination/);
});
