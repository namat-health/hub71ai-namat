import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {validateEmailCaseReferences,summarizeDeliveryEvents,verifyDemoEmailDelivery} from '../scripts/verify-demo-email-delivery.mjs';
const EMAIL='fborja@martinez-laredo.com',createdAt='2026-10-01T15:00:00.000Z',now=new Date('2026-10-01T15:01:00.000Z');
const references=()=>({createdAt,cases:Array.from({length:2},()=>({requestId:randomUUID(),receiptId:randomUUID(),submissionId:randomUUID()}))});

function fixture(t,{status='sent',fetcher}={}) {
  const dir=mkdtempSync(join(tmpdir(),'namat-delivery-verifier-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const refs=references(),settingsPath=join(dir,'settings.json'),referencesPath=join(dir,'references.json'),outputDirectory=join(dir,'evidence');
  const key='FICTIONAL-KEY-MUST-NOT-APPEAR-IN-EVIDENCE';
  writeFileSync(settingsPath,JSON.stringify({form:{BREVO_API_KEY:key,HACKATHON_DATABASE_URL:'postgresql://fictional:fictional@namat-pg-test-uaen-001.postgres.database.azure.com:5432/namat_journey'}}),{mode:0o600});
  writeFileSync(referencesPath,JSON.stringify(refs),{mode:0o600});
  const rows=refs.cases.map((c,i)=>({submission_id:c.submissionId,request_id:c.requestId,receipt_id:c.receiptId,created_at:createdAt,status,attempts:1,provider_message_id:`<fictional-${i}@brevo.invalid>`,sent_at:createdAt}));
  const queries=[],reads=[];let releases=0,ended=false;
  const poolFactory=options=>{
    assert.equal(options.ssl.rejectUnauthorized,true);assert.equal(options.max,1);
    return {connect:async()=>({query:async(sql,values)=>{
      queries.push({sql,values});
      if(['BEGIN READ ONLY','ROLLBACK'].includes(sql))return {rows:[]};
      assert.match(sql,/^SELECT /);assert.match(sql,/s\.id=ANY\(\$1::uuid\[\]\)/);assert.match(sql,/s\.email=\$4 AND o\.recipient_email=\$4/);
      assert.match(sql,/s\.fictional_confirmed=true/);assert.match(sql,/Fictional shared API verification/);
      assert.deepEqual(values,[refs.cases.map(c=>c.submissionId),refs.cases.map(c=>c.requestId),refs.cases.map(c=>c.receiptId),EMAIL]);
      return {rows};
    },release:()=>{releases++;}}),end:async()=>{ended=true;}};
  };
  const fetchImpl=async(url,options)=>{
    reads.push({url,method:options.method});assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
    const parsed=new URL(url);assert.equal(parsed.origin,'https://api.brevo.com');assert.equal(parsed.pathname,'/v3/smtp/statistics/events');
    assert.equal(parsed.searchParams.get('email'),EMAIL);assert.equal(parsed.searchParams.get('limit'),'100');
    assert.equal(options.headers['api-key'],key);
    if(fetcher)return fetcher(parsed,options);
    return new Response(JSON.stringify({events:[{email:EMAIL,messageId:parsed.searchParams.get('messageId'),event:'delivered',date:'2026-10-01T15:00:10Z',subject:'MUST NOT STORE',ip:'DO NOT STORE'}]}),{status:200});
  };
  return {key,queries,reads,options:{settingsPath,referencesPath,outputDirectory,now,poolFactory,fetchImpl},evidence:()=>readFileSync(join(outputDirectory,'email-delivery-verification.json'),'utf8'),closed:()=>ended&&releases===1};
}

test('delivery verification requires exactly two distinct saved case identifiers',()=>{
  const refs=references();assert.equal(validateEmailCaseReferences(refs).cases.length,2);
  assert.throws(()=>validateEmailCaseReferences({...refs,cases:[refs.cases[0]]}),/two_case_references_required/);
  assert.throws(()=>validateEmailCaseReferences({...refs,cases:[refs.cases[0],refs.cases[0]]}),/distinct_case_ids_required/);
  assert.throws(()=>validateEmailCaseReferences({...refs,cases:refs.cases.map(c=>({...c,payload:{email:'other@example.invalid'}}))}),/fictional_owner_cases_required/);
});

test('delivery evidence excludes other recipients and message IDs; acceptance and opening do not prove delivery',()=>{
  const id='<fictional@brevo.invalid>',event={email:EMAIL,messageId:id,event:'requests',date:createdAt};
  const summary=summarizeDeliveryEvents({events:[event,{...event,event:'opened'},{...event,event:'delivered',email:'UNRELATED@example.invalid'},{...event,event:'delivered',messageId:'other'}]},id);
  assert.equal(summary.status,'delivery_unconfirmed');assert.equal(summary.events.length,2);assert.equal(summary.deliveredAt,null);
  assert.doesNotMatch(JSON.stringify(summary),/UNRELATED/);
  assert.equal(summarizeDeliveryEvents({},id).status,'delivery_unconfirmed');
  assert.equal(summarizeDeliveryEvents({events:[{...event,event:'delivered',messageId:'fictional@brevo.invalid'}]},id).status,'delivered');
});

test('verifier only reads two outbox records and makes two exactly filtered GET requests',async t=>{
  const f=fixture(t),result=await verifyDemoEmailDelivery(f.options);
  assert.deepEqual(result,{cases:2,delivered:2,complete:true,providerReads:2,emailsSentByVerifier:0});
  assert.equal(f.queries.length,3);assert.equal(f.reads.length,2);assert.equal(f.closed(),true);
  for(const forbidden of [f.key,'MUST NOT STORE','DO NOT STORE'])assert.equal(f.evidence().includes(forbidden),false);
});

test('a queued or ambiguous confirmation is not resent or inferred to have been accepted',async t=>{
  const f=fixture(t,{status:'unknown'}),result=await verifyDemoEmailDelivery(f.options);
  assert.equal(result.complete,false);assert.equal(result.providerReads,0);assert.equal(f.reads.length,0);
  assert.equal(JSON.parse(f.evidence()).cases.every(c=>c.status==='provider_acceptance_unconfirmed'),true);
});

test('provider rate limiting is recorded without retries or response-body leakage',async t=>{
  const f=fixture(t,{fetcher:()=>new Response('private provider detail',{status:429})}),result=await verifyDemoEmailDelivery(f.options);
  assert.equal(result.providerReads,2);assert.equal(result.delivered,0);assert.doesNotMatch(f.evidence(),/private provider detail/);
  assert.equal(JSON.parse(f.evidence()).cases.every(c=>c.status==='provider_rate_limited'),true);
});

test('oversized provider response stops with sanitized evidence and closes its database connection',async t=>{
  const f=fixture(t,{fetcher:()=>new Response('private',{headers:{'content-length':'131073'}})});
  await assert.rejects(verifyDemoEmailDelivery(f.options),/provider_response_too_large/);
  assert.equal(f.closed(),true);assert.equal(f.reads.length,1);assert.equal(f.evidence().includes(f.key),false);
});
