import test from 'node:test';
import assert from 'node:assert/strict';
import {processWaitlist,validatePayload,validDoiTemplate} from '../server/waitlist.mjs';
const env={WAITLIST_ALLOWED_ORIGINS:'https://preview.example',BREVO_API_KEY:'test-only',BREVO_WAITLIST_LIST_ID:'3',BREVO_DOI_TEMPLATE_ID:'1',WAITLIST_CONFIRMATION_URL:'https://preview.example/confirmed/'};
const valid={email:' PERSON@example.com ',consent:true,website:'',variant:'home'};
const request={method:'POST',headers:{origin:'https://preview.example','content-type':'application/json'},body:valid,ip:'test'};
test('requires explicit consent and a valid email; rejects header injection',()=>{
  assert.equal(validatePayload({...valid,consent:false}),null);
  assert.equal(validatePayload({...valid,email:'a@example.com\r\nbcc:other@example.com'}),null);
  assert.equal(validatePayload({...valid,email:'not-an-email'}),null);
  assert.equal(validatePayload({...valid,variant:'untrusted'}),null);
  assert.equal(validatePayload(valid).email,'person@example.com');
});
test('unconfigured waitlist never claims to have saved an address',async()=>{
  const result=await processWaitlist(request,{env:{WAITLIST_ALLOWED_ORIGINS:'https://preview.example'},fetcher:()=>{throw Error('must not call provider');}});
  assert.equal(result.status,503);assert.match(result.body.message,/not been saved/);
});
test('rejects cross-origin, wrong method, oversized input and honeypots',async()=>{
  assert.equal((await processWaitlist({...request,method:'GET'},{env})).status,405);
  assert.equal((await processWaitlist({...request,headers:{...request.headers,origin:'https://other.example'}},{env})).status,403);
  assert.equal((await processWaitlist({...request,body:{...valid,website:'spam'}},{env})).status,400);
  assert.equal((await processWaitlist({...request,body:' '.repeat(2049)},{env})).status,413);
});
test('rejects inactive or non-DOI templates before sending',async()=>{
  let calls=0;
  const result=await processWaitlist(request,{env,now:1,throttle:false,fetcher:async()=>{calls++;return {ok:true,json:async()=>({isActive:true,doiTemplate:false})};}});
  assert.equal(result.status,503);assert.equal(calls,1);
});
test('optin tag alone does not qualify a template with only a redirect link',()=>{
  assert.equal(validDoiTemplate({isActive:true,doiTemplate:true,htmlContent:'<a href="{{ params.DOIurl }}">Confirm</a>'}),false);
  assert.equal(validDoiTemplate({isActive:true,doiTemplate:true,htmlContent:'<a href="{{ doubleoptin }}">Confirm</a>'}),true);
});
test('sends correct provider payload and reports pending, not confirmed',async()=>{
  const calls=[];
  const result=await processWaitlist(request,{env,now:400000,throttle:false,fetcher:async(url,options)=>{calls.push({url,options});return url.includes('/smtp/templates/')?{ok:true,json:async()=>({isActive:true,doiTemplate:true,htmlContent:'<a href="{{ doubleoptin }}">Confirm</a>'})}:{ok:true,status:201};}});
  assert.equal(result.status,202);assert.equal(result.body.status,'confirmation_pending');
  assert.deepEqual(JSON.parse(calls[1].options.body),{email:'person@example.com',includeListIds:[3],templateId:1,redirectionUrl:'https://preview.example/confirmed/'});
  assert.equal(calls[1].options.headers['api-key'],'test-only');
});
test('provider/network failures do not produce success',async()=>{
  const failure=await processWaitlist(request,{env,now:400001,throttle:false,fetcher:async()=>({ok:false,status:500})});
  assert.equal(failure.status,502);
  const timeout=await processWaitlist(request,{env,now:400002,throttle:false,fetcher:async()=>{throw Error('timeout');}});
  assert.equal(timeout.status,502);
});
test('public acquisition routes and archived designs use the same validation contract',()=>{
  for(const variant of ['home','how-it-works','dune','fieldnotes','afterglow','journal','continuum']) assert.ok(validatePayload({...valid,variant}));
});
