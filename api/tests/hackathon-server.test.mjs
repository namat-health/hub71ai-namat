import test from 'node:test';
import assert from 'node:assert/strict';
import {hackathonConfig,validateHackathonSubmission,processHackathonRequest,MAX_BODY_BYTES,MAX_FILE_BYTES} from '../src/hackathon/server/api.mjs';
import {validateReport} from '../src/hackathon/server/uploads.mjs';
import {createHackathonStore,poolOptions,submissionFingerprint} from '../src/hackathon/server/store.mjs';
import {env,origin,input,request,answers,file,png,jpeg} from './hackathon-fixtures.mjs';

test('hackathon configuration is explicit, validates origins and always verifies database TLS',()=>{
  assert.ok(hackathonConfig(env));
  for(const name of ['HACKATHON_ENABLED','HACKATHON_DATABASE_URL','HACKATHON_ALLOWED_ORIGINS'])assert.equal(hackathonConfig({...env,[name]:''}),null,name);
  for(const value of ['*','http://example.com','https://start.namat.health/path','https://user:pass@start.namat.health','https://start.namat.health,invalid'])assert.equal(hackathonConfig({...env,HACKATHON_ALLOWED_ORIGINS:value}),null);
  assert.ok(hackathonConfig({...env,HACKATHON_ALLOWED_ORIGINS:'http://127.0.0.1:4332'}));
  const options=poolOptions(hackathonConfig({...env,HACKATHON_DATABASE_URL:env.HACKATHON_DATABASE_URL+'?sslmode=disable'}));
  assert.equal(options.ssl.rejectUnauthorized,true);assert.equal(options.connectionString,undefined);
  assert.equal(options.max,2);
});

test('hackathon validates contact, fictional confirmation, current answers and report branching',()=>{
  const checked=validateHackathonSubmission(input({email:' Fictional@Example.Invalid ',firstName:' Fictional '}));
  assert.equal(checked.ok,true);assert.equal(checked.value.email,'fictional@example.invalid');assert.equal(checked.value.firstName,'Fictional');
  const invalid=[{dataClass:'live'},{fictionalConfirmed:false},{version:'old'},{requestId:'wrong'},{email:'bad'},
    {email:'a@example.invalid\nBcc: b@example.invalid'},{firstName:'<script>'},{reports:null},{reports:[file()]},
    {answers:answers({bloodwork:'yes'}),reports:[]},{answers:{...answers(),unknown:'unsafe'}},{recipient:'other@example.invalid'}];
  for(const override of invalid)assert.equal(validateHackathonSubmission(input(override)).ok,false,JSON.stringify(override));
  const uploaded=validateHackathonSubmission(input({answers:answers({bloodwork:'yes'}),reports:[file(),file(png(),'x.png','image/png'),file(jpeg(),'x.jpg','image/jpeg')]}));
  assert.equal(uploaded.ok,true);assert.equal(uploaded.value.reports.length,3);
  assert.equal(validateHackathonSubmission(input({answers:answers({bloodwork:'yes'}),reports:Array(4).fill(file())})).ok,false);
});

test('hackathon requires a nonblank first name before persistence and preserves Unicode names',async()=>{
  let databaseCalls=0;
  const pool={query(){databaseCalls++;throw new Error('Unexpected database access');},connect(){databaseCalls++;throw new Error('Unexpected database access');}};
  for(const firstName of [undefined,null,'',' ','\u00a0\u2003',42,{},[],'A'.repeat(81),'A\0B','A\tB','A\r\nB','A\x7fB','A\u2028B','A\u2029B']){
    const payload=input({firstName});
    assert.equal(validateHackathonSubmission(payload).ok,false,JSON.stringify(firstName));
    const response=await processHackathonRequest(request(payload),{env,pool});
    assert.equal(response.status,400,JSON.stringify(firstName));
    assert.match(response.body.message,/first name/);
  }
  assert.equal(databaseCalls,0);
  for(const firstName of ['ريم','Zoë','O’Connor','Jean-Luc','𠮷野','A'.repeat(80)]){
    const checked=validateHackathonSubmission(input({firstName:`  ${firstName}  `}));
    assert.equal(checked.ok,true);
    assert.equal(checked.value.firstName,firstName);
    assert.equal(Object.hasOwn(checked.value.answers,'firstName'),false);
  }
});

test('report envelope validation checks encoding and signatures before asynchronous document inspection',()=>{
  for(const valid of [file(),file(png(),'report.png','image/png'),file(jpeg(),'report.jpeg','image/jpeg')])assert.equal(validateReport(valid).ok,true,valid.type);
  for(const invalid of [file(Buffer.from('<html>not a report</html>')),file(Buffer.from('<svg></svg>'),'x.svg','image/svg+xml'),
    file(Buffer.from('MZexecutable'),'x.pdf'),{...file(),name:'../x.pdf'},{...file(),name:'x.exe'},{...file(),size:1},
    {...file(),base64:file().base64+'\n'},{...file(),base64:'data:application/pdf;base64,'+file().base64},
    file(Buffer.concat([png(),Buffer.from('<html>extra</html>')]),'x.png','image/png'),file(jpeg().subarray(0,-2),'x.jpg','image/jpeg')])assert.equal(validateReport(invalid).ok,false,invalid.name);
  const corrupt=png();corrupt[corrupt.length-5]^=1;assert.equal(validateReport(file(corrupt,'x.png','image/png')).ok,false);
});

test('aggregate report size is bounded even when individual files fit',()=>{
  const large=Buffer.concat([Buffer.from('%PDF-1.7\n'),Buffer.alloc(1_100_000,32),Buffer.from('\n%%EOF\n')]);
  assert.equal(validateReport(file(large)).ok,true);
  assert.equal(validateHackathonSubmission(input({answers:answers({bloodwork:'yes'}),reports:[file(large),file(large,'second.pdf')]})).ok,false);
  assert.equal(validateReport({...file(),size:MAX_FILE_BYTES+1}).ok,false);
  const prefix=Buffer.from('%PDF-1.7\n'),suffix=Buffer.from('\n%%EOF\n');
  const boundary=Buffer.concat([prefix,Buffer.alloc(MAX_FILE_BYTES-prefix.length-suffix.length,32),suffix]);
  assert.equal(validateHackathonSubmission(input({answers:answers({bloodwork:'yes'}),reports:[file(boundary)]})).ok,true,'exactly 2 MiB is accepted');
  assert.equal(validateReport(file(Buffer.concat([boundary,Buffer.from(' ')]))).ok,false,'one extra byte is rejected');
});

test('normalisation makes fingerprints stable and includes contact and all report contents',()=>{
  const raw=input({answers:answers({bloodwork:'yes'}),reports:[file()]});
  const value=validateHackathonSubmission(raw).value;
  const reordered=validateHackathonSubmission({...raw,answers:Object.fromEntries(Object.entries(raw.answers).reverse()),email:raw.email.toUpperCase()}).value;
  assert.equal(submissionFingerprint(value),submissionFingerprint(reordered));
  assert.notEqual(submissionFingerprint(value),submissionFingerprint({...value,email:'changed@example.invalid'}));
  assert.notEqual(submissionFingerprint(value),submissionFingerprint({...value,reports:[{...value.reports[0],sha256:'0'.repeat(64)}]}));
});

test('API rejects unsafe requests before the database and returns generic unavailable responses',async()=>{
  const pool={query(){throw new Error('SECRET database connection string');},connect(){throw new Error('SECRET database connection string');}};
  const run=(r,options={})=>processHackathonRequest(r,{env,pool,...options});
  assert.equal((await run(request(input(),{origin:'https://evil.example'}))).status,403);
  assert.equal((await run(request(input(),{origin:undefined}))).status,403);
  assert.equal((await run(request(input(),{'content-type':'text/html'}))).status,415);
  assert.equal((await run(request(input(),{'sec-fetch-site':'cross-site'}))).status,403);
  assert.equal((await run(request('x'.repeat(MAX_BODY_BYTES+1)))).status,413);
  assert.equal((await run(request(input(),{'content-length':String(MAX_BODY_BYTES+1)}))).status,413);
  assert.equal((await run(request(Buffer.from([0xc3,0x28])))).status,400);
  assert.equal((await run(request('{broken'))).status,400);
  assert.equal((await run({method:'DELETE'})).status,405);
  const unavailable=await run(request(input()));assert.equal(unavailable.status,503);assert.doesNotMatch(JSON.stringify(unavailable),/SECRET/);
  assert.deepEqual((await run({method:'GET'},{env:{}})).body,{status:'unavailable',maxFileBytes:MAX_FILE_BYTES});
  assert.equal((await run({method:'GET'})).status,503);
  assert.equal((await processHackathonRequest({method:'GET'},{env,pool:{query:async()=>({rows:[{ready:true},{ready:false}]})}})).status,503);
  const ready=await processHackathonRequest({method:'GET',headers:{origin}},{env,pool:{query:async()=>({rows:[{ready:true},{ready:true}]})}});
  assert.equal(ready.status,200);assert.equal(ready.body.status,'ready');assert.equal(ready.headers['Cache-Control'],'no-store');
});

test('preflight only allows configured origins and JSON POST',async()=>{
  const good={method:'OPTIONS',headers:{origin,'access-control-request-method':'POST','access-control-request-headers':'content-type'}};
  assert.equal((await processHackathonRequest(good,{env})).status,204);
  assert.equal((await processHackathonRequest({...good,headers:{...good.headers,'access-control-request-headers':'authorization'}},{env})).status,403);
});

test('confirmation delivery preserves provider retry delays up to one day',async()=>{
  const receiptId='ba02fa26-00da-4e83-a3b5-c76f012eb89c';
  for(const [requested,expected]of [[60,60],[7200,7200],[86400,86400],[172800,86400]]){
    let delay;
    const pool={async query(sql,params){
      if(sql.includes('RETURNING id,recipient_email'))return {rows:[{id:receiptId,reference:receiptId,recipient_email:'fictional@example.invalid',first_name:null,has_reports:false}]};
      delay=params[5];return {rowCount:1};
    }};
    assert.deepEqual(await createHackathonStore(pool).deliverReceiptConfirmation(receiptId,async()=>({state:'retry',retryAfterSeconds:requested})),{status:'queued'});
    assert.equal(delay,expected);
  }
});

test('saved submissions expose failed and uncertain email outcomes without losing the receipt',async()=>{
  const scenarios=[
    {result:{state:'accepted',messageId:'fictional'},expected:'sent'},
    {result:{state:'simulated'},expected:'disabled'},
    {result:{state:'blocked'},expected:'disabled'},
    {result:{state:'retry',retryAfterSeconds:60},expected:'pending'},
    {result:{state:'failed'},expected:'failed'},
    {result:{state:'unknown'},expected:'unknown'},
    {senderThrows:true,expected:'unknown'},
    {held:'failed',expected:'failed'},
    {held:'unknown',expected:'unknown'},
    {held:'sending',expected:'unknown'},
    {held:'unavailable',expected:'unknown'},
    {held:'queued',expected:'pending'},
    {claimThrows:true,expected:'unknown'},
    {noSender:true,expected:'pending'},
  ];
  for(const scenario of scenarios){
    let sends=0,receiptId;
    const pool={
      async connect(){return {async query(sql,params){
        if(sql.startsWith('INSERT INTO public.hackathon_welcome_submissions')){
          receiptId=params[2];return {rows:[{receipt_id:receiptId}]};
        }
        return {rows:[]};
      },release(){}};},
      async query(sql){
        if(scenario.claimThrows)throw new Error('private database details');
        if(sql.includes('RETURNING id,recipient_email'))return {rows:scenario.held?[]:[{
          id:receiptId,reference:receiptId,recipient_email:'fictional@example.invalid',first_name:'Fictional',has_reports:false,
        }]};
        if(sql.startsWith('SELECT status'))return {rows:[{status:scenario.held}]};
        return {rowCount:1};
      },
    };
    const sender=scenario.noSender?undefined:async()=>{
      sends++;
      if(scenario.senderThrows)throw new Error('private provider details');
      return scenario.result;
    };
    const response=await processHackathonRequest(request(input()),{env,pool,sender});
    assert.equal(response.status,201,JSON.stringify(scenario));
    assert.deepEqual(response.body,{status:'saved',receiptId,confirmationEmail:scenario.expected},JSON.stringify(scenario));
    assert.equal(sends,scenario.held||scenario.claimThrows||scenario.noSender?0:1);
  }
});
