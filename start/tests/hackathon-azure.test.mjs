import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {azureServerOptions,createHackathonAzureServer,SECURITY_HEADERS} from '../src/hackathon/server/azure-server.mjs';
import {MAX_BODY_BYTES} from '../src/hackathon/server/api.mjs';
import {collectHackathonAzureFiles,verifyLinuxNative,AZURE_RUNTIME_TARGET} from '../scripts/package-hackathon-azure.mjs';
import {deterministicZip} from '../scripts/lib/deterministic-zip.mjs';
import {vercelConfig,RUNTIME_DEPENDENCIES,REPORT_RUNTIME_FILES,ANALYSIS_RUNTIME_FILES} from '../scripts/build-hackathon-site.mjs';
import {env as baseEnv,origin,input} from './hackathon-fixtures.mjs';

function directory(t) {
  const root=mkdtempSync(join(tmpdir(),'namat-azure-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const write=(name,body)=>{mkdirSync(dirname(join(root,name)),{recursive:true});writeFileSync(join(root,name),body);};
  return {root,write};
}
function dispatch(server,url,{method='GET',headers={},body='',chunks}={}) {
  return new Promise(resolve=>{
    const req=Readable.from(chunks||[Buffer.from(body)]);
    Object.assign(req,{url,method,headers,socket:{remoteAddress:'127.0.0.1'}});
    const res=new EventEmitter(),values={};
    Object.assign(res,{headersSent:false,writableEnded:false,
      setHeader(key,value){values[key.toLowerCase()]=value;},
      writeHead(status,headers){this.status=status;this.headersSent=true;for(const[k,v]of Object.entries(headers))values[k.toLowerCase()]=v;},
      end(body=''){this.writableEnded=true;this.emit('finish');resolve({status:this.status,headers:values,body:Buffer.isBuffer(body)?body.toString():body});},
    });
    server.emit('request',req,res);
  });
}

test('Azure listener uses Node platform PORT and the same security policy as Vercel',()=>{
  assert.deepEqual(azureServerOptions({}),{port:8080,host:'0.0.0.0'});
  assert.deepEqual(azureServerOptions({PORT:'9090'}),{port:9090,host:'0.0.0.0'});
  for(const port of ['0','65536',' 8080','-1','3.5','8e3','pipe'])assert.throws(()=>azureServerOptions({PORT:port}),/PORT/);
  assert.deepEqual(SECURITY_HEADERS,Object.fromEntries(vercelConfig().headers[0].headers.map(({key,value})=>[key,value])));
});

test('Azure serves the welcome page/assets and generic liveness; other routes and symlinks stay closed',async t=>{
  const {root,write}=directory(t);
  write('welcome/index.html','<h1>Demo welcome</h1>');write('_astro/app.js','export const demo = true;');
  write('assets/photo.webp',Buffer.from([1,2,3]));write('secret.json','PRIVATE');
  write('other/index.html','OTHER PAGE');
  symlinkSync(join(root,'secret.json'),join(root,'assets/leak.js'));
  const server=createHackathonAzureServer({publicDirectory:root,env:{}});t.after(()=>server.close());
  assert.equal((await dispatch(server,'/')).headers.location,'/welcome');
  for(const route of ['/welcome','/welcome/','/welcome/index.html']) {
    const res=await dispatch(server,route);assert.equal(res.status,200);assert.match(res.body,/Demo welcome/);
    for(const [key,value]of Object.entries(SECURITY_HEADERS))assert.equal(res.headers[key.toLowerCase()],value);
  }
  const head=await dispatch(server,'/welcome',{method:'HEAD'});assert.equal(head.body,'');assert.equal(head.status,200);assert.ok(head.headers['content-length']);
  const script=await dispatch(server,'/_astro/app.js');assert.equal(script.status,200);assert.match(script.headers['cache-control'],/immutable/);
  const health=await dispatch(server,'/healthz');assert.deepEqual(JSON.parse(health.body),{status:'ok'});
  assert.equal((await dispatch(server,'/healthz',{method:'HEAD'})).body,'');
  for(const path of ['/other/index.html','/package.json','/api/journey','/assets/leak.js','/assets/missing.webp'])assert.equal((await dispatch(server,path)).status,404,path);
  for(const path of ['/../secret.json','/assets/%2e%2e/secret.json','/%2eenv','/assets/%00x.js','//elsewhere/','/assets/\\secret.json','/%ZZ'])assert.equal((await dispatch(server,path)).status,400,path);
  assert.equal((await dispatch(server,'/welcome',{method:'POST'})).status,405);
});

test('API routes preserve origin/name checks and the current demo data through an injected pool',async t=>{
  const {root}=directory(t),calls=[];
  const receipt='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const pool={async query(sql){
    if(sql.includes('has_table_privilege'))return {rows:[{ready:true},{ready:true}]};
    if(sql.includes("SET status='sending'"))return {rows:[]};
    return {rows:[{status:'local'}]};
  },async connect(){return {async query(sql,params){calls.push({sql,params});return sql.includes('RETURNING receipt_id')?{rows:[{receipt_id:receipt}]}:{rows:[]};},release(){}};}};
  const env={...baseEnv,HACKATHON_EMAIL_MODE:'local'};
  const server=createHackathonAzureServer({publicDirectory:root,env,pool});t.after(()=>server.close());
  for(const path of ['/api/hackathon','/api/hackathon/'])assert.equal((await dispatch(server,path)).status,200);
  const headers={origin,'content-type':'application/json'};
  assert.equal((await dispatch(server,'/api/hackathon',{method:'POST',headers:{...headers,origin:'https://other.invalid'},body:JSON.stringify(input())})).status,403);
  assert.equal((await dispatch(server,'/api/hackathon',{method:'POST',headers,body:JSON.stringify(input({firstName:''}))})).status,400);
  assert.equal(calls.length,0);
  const payload=input(),res=await dispatch(server,'/api/hackathon/',{method:'POST',headers,body:JSON.stringify(payload)});
  assert.equal(res.status,201);assert.equal(JSON.parse(res.body).status,'saved');
  assert.equal(res.headers['x-robots-tag'],'noindex, nofollow, noarchive');
  const saved=calls.find(call=>call.sql.includes('RETURNING receipt_id'));
  assert.equal(saved.params[8],payload.firstName);
  for(const removed of ['country','pregnancy','treatment'])assert.equal(Object.hasOwn(saved.params[4],removed),false);
});

test('Azure rejects oversized chunked and declared bodies before database access',async t=>{
  const {root}=directory(t);let calls=0;
  const pool={query(){calls++;throw new Error('Unexpected database call');},connect(){calls++;throw new Error('Unexpected database call');}};
  const server=createHackathonAzureServer({publicDirectory:root,env:baseEnv,pool});t.after(()=>server.close());
  const headers={origin,'content-type':'application/json'};
  const declared=await dispatch(server,'/api/hackathon',{method:'POST',headers:{...headers,'content-length':String(MAX_BODY_BYTES+1)}});
  assert.equal(declared.status,413);assert.equal(declared.headers.connection,'close');
  const streamed=await dispatch(server,'/api/hackathon',{method:'POST',headers,chunks:[Buffer.alloc(MAX_BODY_BYTES),Buffer.from('x')]});
  assert.equal(streamed.status,413);assert.equal(calls,0);
});

test('Linux native binary verification rejects macOS, Windows and non-x64 payloads',()=>{
  for(const bytes of [Buffer.from('not a binary'),Buffer.from([0xcf,0xfa,0xed,0xfe,...Array(28).fill(0)]),Buffer.alloc(32)])assert.throws(()=>verifyLinuxNative(bytes,'pretend.node'),/Linux x64 ELF/);
  const elf=Buffer.alloc(32);elf.writeUInt32BE(0x7f454c46);elf[4]=2;elf[5]=1;elf.writeUInt16LE(62,18);
  assert.doesNotThrow(()=>verifyLinuxNative(elf,'linux.node'));
  elf.writeUInt16LE(183,18);assert.throws(()=>verifyLinuxNative(elf,'arm64.node'),/Linux x64 ELF/);
});

test('Azure ZIP includes explicit workers, reviewer assets and Linux native dependencies',t=>{
  try {readFileSync('dist-hackathon/package-manifest.json');}catch{t.skip('Build the standalone demo package first.');return;}
  if(process.platform!=='linux'&&!process.env.NAMAT_RUNTIME_NODE_MODULES){
    assert.throws(()=>collectHackathonAzureFiles(),/Missing Linux x64 runtime dependency/);
    t.skip('Set NAMAT_RUNTIME_NODE_MODULES to a staged Linux npm-ci directory for full ZIP verification.');return;
  }
  const {files,manifest}=collectHackathonAzureFiles();
  assert.ok(files.has('public/welcome/index.html'));
  assert.ok(files.has('src/hackathon/server/azure-server.mjs'));
  assert.ok(files.has('node_modules/pg/package.json'));
  for(const path of files.keys()) {
    assert.doesNotMatch(path,/(^|\/)\.|\.env|\.map$|^api\/|^db\/|^research\/|^vercel\.json$/);
    assert.match(path,/^(?:public\/|src\/hackathon\/(?:server\/|welcome\/questionnaire-(?:model|v1)\.mjs$)|src\/lib\/overview-preview(?:-v4)?\.mjs$|server\/journey-email-layout\.mjs$|services\/(?:report-processing|clinical-analysis)\/|node_modules\/|package(?:-lock|-manifest)?\.json$)/);
  }
  assert.equal(files.has('src/hackathon/development.mjs'),false);
  assert.equal(files.has('server/journey-server.mjs'),false);
  const metadata=JSON.parse(files.get('package.json'));
  assert.deepEqual(metadata.scripts,{start:'node src/hackathon/server/azure-server.mjs'});
  assert.deepEqual(metadata.engines,{node:'22.x'});
  assert.deepEqual(metadata.dependencies,RUNTIME_DEPENDENCIES);
  assert.deepEqual(manifest.runtimeTarget,AZURE_RUNTIME_TARGET);
  for(const path of REPORT_RUNTIME_FILES)assert.ok(files.has(path),path);
  for(const path of ANALYSIS_RUNTIME_FILES)assert.ok(files.has(path),path);
  for(const name of ['@img/sharp-linux-x64','@img/sharp-libvips-linux-x64','@napi-rs/canvas-linux-x64-gnu'])assert.ok(files.has(`node_modules/${name}/package.json`),name);
  assert.ok([...files.keys()].some(path=>path.endsWith('.bcmap')));
  assert.ok([...files.keys()].some(path=>/standard_fonts\/.*\.ttf$/.test(path)));
  for(const row of manifest.files)assert.equal(createHash('sha256').update(files.get(row.path)).digest('hex'),row.sha256);
  const zip=deterministicZip(files);
  assert.deepEqual(zip,deterministicZip(new Map([...files].reverse())));
  const {root,write}=directory(t);let offset=0,entries=0;
  while(zip.readUInt32LE(offset)===0x04034b50) {
    const length=zip.readUInt32LE(offset+18),nameLength=zip.readUInt16LE(offset+26);
    const name=zip.subarray(offset+30,offset+30+nameLength).toString();
    const body=inflateRawSync(zip.subarray(offset+30+nameLength,offset+30+nameLength+length));
    assert.deepEqual(body,files.get(name));write(name,body);entries++;offset+=30+nameLength+length;
  }
  assert.equal(entries,files.size);
  const smoke=spawnSync(process.execPath,['--input-type=module','-e',"import {createHackathonAzureServer} from './src/hackathon/server/azure-server.mjs'; import pg from 'pg'; if(typeof pg.Pool!=='function')throw Error('Missing pg');const server=createHackathonAzureServer({env:{}});server.close();console.log('ok');"],{cwd:root,encoding:'utf8',env:{PATH:process.env.PATH}});
  assert.equal(smoke.status,0,smoke.stderr);assert.equal(smoke.stdout.trim(),'ok');
});
