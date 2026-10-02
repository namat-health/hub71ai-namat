import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import ts from 'typescript';
import * as model from '../src/hackathon/welcome/questionnaire-model.mjs';
import {COPY, BRAND_TAGLINE} from '../src/lib/journey-copy.mjs';
import {getJourneyVisual, getProfileVisual} from '../src/lib/journey-visuals.mjs';
import {answers as completedAnswers} from './hackathon-fixtures.mjs';

const source = readFileSync(new URL('../src/hackathon/welcome/questionnaire.ts',import.meta.url),'utf8')
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*'[^']+';\s*/g,'')
  .replaceAll('import.meta.env.DEV','false');
const client = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const flush = () => new Promise(resolve=>setImmediate(resolve));
const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function draft(bloodwork,current='bloodwork') {
  return {version:model.VERSION,answers:completedAnswers({bloodwork}),notes:{curiosity:'Fictional only'},current,
    firstName:'Fictional',email:'fictional@example.invalid',fictionalConfirmed:true,requestId,reports:[]};
}

// Exercise the actual client handlers and generated controls without a browser
// or network. Layout and native file-picker behaviour are covered by browser QA.
function mount(saved,fetcher) {
  const events = {};
  const storage = {value:JSON.stringify(saved)};
  const element = {focus(){},scrollTo(){},hidden:false,textContent:'',disabled:false};
  const view = {...element,innerHTML:'',querySelector:()=>element,querySelectorAll:()=>[],insertAdjacentHTML(_position,html){this.innerHTML=html+this.innerHTML;}};
  const image = {src:'',getAttribute(){return this.src;}};
  const root = {dataset:{},querySelector:selector=>selector==='[data-step-view]' ? view : selector==='[data-journey-image]' ? image : element,
    querySelectorAll:()=>[],addEventListener:(type,handler)=>{events[type]=handler;}};
  runInNewContext(client,{...model,COPY,BRAND_TAGLINE,getJourneyVisual,getProfileVisual,crypto:webcrypto,document:{querySelector:()=>root},
    sessionStorage:{getItem:()=>storage.value,setItem:(_key,value)=>{storage.value=value;}},
    location:{pathname:'/welcome',origin:'http://127.0.0.1:4332'},history:{pushState(){},replaceState(){}},window:{scrollTo(){},addEventListener(){},matchMedia(){return {matches:true,addEventListener(){}};}},
    fetch:fetcher,AbortSignal,Uint8Array,URL,Error});
  function button(action) {
    for (const match of view.innerHTML.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
      if (match[1].includes(`data-action="${action}"`)) return {
        dataset:{action},disabled:/\bdisabled\b/.test(match[1]),label:match[2],
      };
    }
    return null;
  }
  return {root,view,storage,button,
    click(action) {
      const control=button(action);
      assert.ok(control,`Expected a rendered ${action} control`);
      events.click({target:{closest:()=>control}});
    },
    choose(value) {events.change({target:{name:'answer',value,checked:true}});},
    input(name,value) {events.input({target:{name,value}});},
    files(files) {events.change({target:{name:'reports',files}});},
    submit() {events.submit({preventDefault(){}});},
  };
}

test('a restored Yes and returning from upload both require an explicit forward action',()=>{
  let sends=0;
  const app=mount(draft('yes'),()=>{sends++;throw new Error('No save expected');});
  assert.equal(app.root.dataset.step,'bloodwork');
  assert.equal(app.button('continue')?.label,'Continue to upload');
  assert.equal(sends,0,'hydrating Yes must not submit or advance');
  app.click('continue');
  assert.equal(app.root.dataset.step,'upload');
  app.click('back');
  assert.equal(app.root.dataset.step,'bloodwork');
  assert.equal(app.button('continue')?.label,'Continue to upload');
  app.click('continue');
  assert.equal(app.root.dataset.step,'upload');
  assert.equal(JSON.parse(app.storage.value).requestId,requestId);
  assert.equal(sends,0);
});

test('first name is required for new submissions and restored unnamed drafts',async()=>{
  for (const firstName of ['', '   ']) {
    let sends=0;
    const app=mount({...draft('no'),firstName},()=>{sends++;throw new Error('No save expected');});
    assert.equal(app.root.dataset.step,'contact');
    assert.match(app.view.innerHTML,/name="firstName"[^>]*required/);
    app.submit();
    assert.equal(app.root.dataset.step,'contact');
    assert.equal(sends,0);
    app.input('firstName','  ليلى  ');
    app.submit();
    assert.equal(app.root.dataset.step,'bloodwork');
    await flush();
    assert.equal(sends,0,'entering a name must not automatically submit a restored No');
  }
});

test('fresh No submits automatically; reload and retries preserve its request ID without another automatic send',async()=>{
  const attempts=[];
  const fail=async(_url,options)=>{attempts.push(JSON.parse(options.body));throw new Error('Simulated lost response');};
  const initial=mount(draft(''),fail);
  assert.equal(initial.button('save'),null);
  initial.choose('no');
  assert.equal(attempts.length,1,'a fresh No selection still sends');
  assert.equal(initial.button('save')?.disabled,true,'pending request cannot be submitted again');
  initial.click('save');
  assert.equal(attempts.length,1);
  await flush();
  assert.equal(initial.button('save')?.label,'Try again');
  initial.click('save');
  await flush();
  assert.equal(attempts.length,2);
  assert.equal(attempts[1].requestId,attempts[0].requestId);

  const restored=mount(JSON.parse(initial.storage.value),async(_url,options)=>{
    attempts.push(JSON.parse(options.body));
    return {ok:true,json:async()=>({status:'saved',receiptId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',confirmationEmail:'disabled'})};
  });
  assert.equal(restored.root.dataset.step,'bloodwork');
  assert.equal(restored.button('save')?.label,'Submit questionnaire');
  assert.equal(attempts.length,2,'hydrating No must not send');
  restored.click('save');
  await flush();
  assert.equal(attempts.length,3);
  assert.equal(attempts[2].requestId,attempts[0].requestId);
  assert.equal(restored.root.dataset.step,'success');
});

test('a confirmed conflict offers an explicit new example instead of repeating the same save',async()=>{
  let sends=0;
  const app=mount(draft('no'),async()=>{
    sends++;
    return {ok:false,status:409,json:async()=>({status:'conflict'})};
  });
  app.click('save');
  await flush();
  assert.equal(sends,1);
  assert.equal(app.button('save'),null);
  assert.equal(app.button('restart')?.label,'Start over');
  assert.match(app.view.innerHTML,/already saved with different answers/);
  assert.equal(JSON.parse(app.storage.value).requestId,requestId,'conflicts must not silently mint another submission');
  app.click('restart');
  app.click('confirm-reset');
  assert.equal(app.root.dataset.step,'welcome');
  assert.notEqual(JSON.parse(app.storage.value).requestId,requestId);
  assert.equal(sends,1);
});

test('saved receipts distinguish email failures and uncertainty without suggesting resubmission',async()=>{
  const receiptId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  for(const [confirmationEmail,message]of [
    ['sent','Your confirmation email has been handed to our email provider.'],
    ['disabled','Your questionnaire is safely saved. Email delivery is switched off for this test.'],
    ['pending','Your confirmation email is pending. Your questionnaire is safely saved.'],
    ['failed','Your questionnaire is safely saved, but we couldn’t send your confirmation email. Keep your reference below.'],
    ['unknown','Your questionnaire is safely saved, but we couldn’t confirm whether your email was sent. Keep your reference below.'],
    [undefined,'Your questionnaire is safely saved, but we couldn’t confirm whether your email was sent. Keep your reference below.'],
  ]){
    let sends=0;
    const app=mount(draft('no'),async()=>{
      sends++;
      return {ok:true,json:async()=>({status:'saved',receiptId,confirmationEmail})};
    });
    app.click('save');
    await flush();
    assert.equal(app.root.dataset.step,'success');
    assert.ok(app.view.innerHTML.includes(message),String(confirmationEmail));
    assert.ok(app.view.innerHTML.includes(receiptId));
    assert.equal(app.button('save'),null);
    assert.equal(sends,1);
  }
});

const eventually=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await flush();}assert.ok(predicate(),'Expected the asynchronous UI operation to finish');};
const pdfFile=(name='sample.pdf',size=40)=>new File([new Uint8Array(size)],name,{type:'application/pdf'});

test('reports upload as raw files before saving references; a lost save retries without another upload',async()=>{
  const requests=[],report=pdfFile(),receiptId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  let saveAttempts=0;
  const app=mount(draft('yes','upload'),async(url,options)=>{
    requests.push({url,options});
    if(url==='/api/reports/sessions')return {ok:true,json:async()=>({sessionId:'upload-session',token:'private-upload-token'})};
    if(url==='/api/reports/uploads'){
      const body=JSON.parse(options.body);
      assert.deepEqual(Object.keys(body).sort(),['name','sha256','size','type']);
      assert.equal(body.sha256,Buffer.from(await webcrypto.subtle.digest('SHA-256',await report.arrayBuffer())).toString('hex'));
      assert.equal(options.headers.Authorization,'Bearer private-upload-token');
      assert.equal(options.headers['X-Report-Session'],'upload-session');
      return {ok:true,json:async()=>({reportId:'report-one',uploadUrl:'/test-blob/report-one'})};
    }
    if(url==='http://127.0.0.1:4332/test-blob/report-one'){
      assert.equal(options.method,'PUT');assert.equal(options.body,report);
      assert.equal(options.credentials,'omit');assert.equal(options.headers['x-ms-blob-type'],'BlockBlob');
      assert.equal(options.headers.Authorization,undefined);
      return {ok:true};
    }
    if(url==='/api/reports/uploads/report-one/complete')return {ok:true,json:async()=>({status:'queued',reportId:'report-one'})};
    assert.equal(url,'/api/hackathon');saveAttempts++;
    if(saveAttempts===1)throw new Error('Simulated lost response');
    return {ok:true,json:async()=>({status:'saved',receiptId,confirmationEmail:'sent'})};
  });
  app.files([report]);await eventually(()=>app.button('save')&&!app.button('save').disabled);
  const stored=JSON.parse(app.storage.value);
  assert.deepEqual(Object.keys(stored.reports[0]).sort(),['name','sha256','size','type']);
  assert.doesNotMatch(app.storage.value,/base64|private-upload-token|upload-session/);
  app.click('save');await eventually(()=>saveAttempts===1&&app.button('save')&&!app.button('save').disabled);
  const initialSave=JSON.parse(requests.find(entry=>entry.url==='/api/hackathon').options.body);
  assert.deepEqual(initialSave.reports,[]);assert.deepEqual(initialSave.reportIds,['report-one']);
  assert.deepEqual(initialSave.reportSession,{id:'upload-session',token:'private-upload-token'});
  assert.equal(app.root.dataset.step,'upload');
  app.click('save');await eventually(()=>app.root.dataset.step==='success');
  assert.equal(requests.filter(entry=>entry.options.method==='PUT').length,1);
  assert.equal(requests.filter(entry=>entry.url==='/api/reports/uploads').length,1);
  const retriedSave=JSON.parse(requests.filter(entry=>entry.url==='/api/hackathon')[1].options.body);
  assert.deepEqual(retriedSave,initialSave);
  assert.match(app.view.innerHTML,/reports have been received and queued for processing/);
  assert.doesNotMatch(app.storage.value,/private-upload-token|upload-session/);
});

test('upload completion retries reuse bytes already stored and never submit unvalidated reports',async()=>{
  let puts=0,completions=0,saves=0;
  const app=mount(draft('yes','upload'),async(url,options)=>{
    if(url==='/api/reports/sessions')return {ok:true,json:async()=>({sessionId:'session',token:'token'})};
    if(url==='/api/reports/uploads')return {ok:true,json:async()=>({reportId:'one',uploadUrl:'/blob/one'})};
    if(options.method==='PUT'){puts++;return {ok:true};}
    if(url.endsWith('/complete')){completions++;if(completions===1)throw new Error('Lost validation response');return {ok:true,json:async()=>({reportId:'one',status:'queued'})};}
    saves++;return {ok:true,json:async()=>({status:'saved',receiptId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',confirmationEmail:'pending'})};
  });
  app.files([pdfFile()]);await eventually(()=>app.button('save')&&!app.button('save').disabled);
  app.click('save');await eventually(()=>completions===1&&!app.button('save').disabled);
  assert.equal(saves,0);assert.equal(puts,1);
  app.click('save');await eventually(()=>app.root.dataset.step==='success');
  assert.equal(completions,2);assert.equal(puts,1);assert.equal(saves,1);
});

test('report selection allows three files of 10 MiB each and keeps their bytes out of browser storage',async()=>{
  const app=mount(draft('yes','upload'),()=>{throw new Error('Selecting files must not send');});
  const largeFile=name=>({name,type:'application/pdf',size:10*1024*1024,arrayBuffer:async()=>new ArrayBuffer(1)});
  app.files([largeFile('one.pdf'),largeFile('two.pdf'),largeFile('three.pdf')]);
  await eventually(()=>app.button('save')&&!app.button('save').disabled);
  assert.equal(JSON.parse(app.storage.value).reports.length,3);
  assert.match(app.view.innerHTML,/10 MiB per file/);
  const before=app.storage.value;
  app.files([{...largeFile('too-large.pdf'),size:10*1024*1024+1}]);
  assert.equal(app.storage.value,before);
  app.files([pdfFile('1.pdf'),pdfFile('2.pdf'),pdfFile('3.pdf'),pdfFile('4.pdf')]);
  assert.equal(app.storage.value,before);
});

test('an upload already queued after a lost response reuses its report ID without uploading again',async()=>{
  let puts=0,completions=0;
  const app=mount(draft('yes','upload'),async(url,options)=>{
    if(url==='/api/reports/sessions')return {ok:true,json:async()=>({sessionId:'session',token:'token'})};
    if(url==='/api/reports/uploads')return {ok:true,json:async()=>({reportId:'already-received',status:'ready'})};
    if(options.method==='PUT')puts++;
    if(url.endsWith('/complete'))completions++;
    assert.equal(url,'/api/hackathon');assert.deepEqual(JSON.parse(options.body).reportIds,['already-received']);
    return {ok:true,json:async()=>({status:'saved',receiptId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',confirmationEmail:'pending'})};
  });
  app.files([pdfFile()]);await eventually(()=>app.button('save')&&!app.button('save').disabled);
  app.click('save');await eventually(()=>app.root.dataset.step==='success');
  assert.equal(puts,0);assert.equal(completions,0);
});

test('a lost raw-upload response is recovered through completion after create-only PUT conflicts',async()=>{
  for(const conflictStatus of [409,412]){
    let puts=0,completions=0,saves=0;
    const app=mount(draft('yes','upload'),async(url,options)=>{
      if(url==='/api/reports/sessions')return {ok:true,json:async()=>({sessionId:'session',token:'token'})};
      if(url==='/api/reports/uploads')return {ok:true,json:async()=>({reportId:'one',uploadUrl:'/blob/one'})};
      if(options.method==='PUT'){puts++;if(puts===1)throw new Error('Lost PUT response');return {ok:false,status:conflictStatus};}
      if(url.endsWith('/complete')){completions++;return {ok:true,json:async()=>({reportId:'one',status:'processing'})};}
      saves++;return {ok:true,json:async()=>({status:'saved',receiptId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',confirmationEmail:'pending'})};
    });
    app.files([pdfFile()]);await eventually(()=>app.button('save')&&!app.button('save').disabled);
    app.click('save');await eventually(()=>puts===1&&!app.button('save').disabled);assert.equal(saves,0);
    app.click('save');await eventually(()=>app.root.dataset.step==='success');
    assert.equal(puts,2);assert.equal(completions,1);assert.equal(saves,1);
  }
});
