import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,realpathSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {inflateRawSync} from 'node:zlib';
import {collectNamatApiSources,collectNamatApiAzureFiles,packageNamatApiAzure,prepareNamatApiRuntime} from '../scripts/package-namat-api-azure.mjs';
import {lockedRuntimePackage,RUNTIME_DEPENDENCIES} from '../scripts/lib/runtime-package.mjs';
import {deterministicZip} from '../scripts/lib/deterministic-zip.mjs';

const REPO=resolve(import.meta.dirname,'..');
const hash=body=>createHash('sha256').update(body).digest('hex');
const locked=()=>lockedRuntimePackage(JSON.parse(readFileSync(join(REPO,'package-lock.json'))));
function directory(t) {
  const root=realpathSync(mkdtempSync(join(tmpdir(),'namat-api-package-')));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const write=(path,body)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),body);};
  return {root,write};
}
function fixture(t) {
  const {root,write}=directory(t),{files}=collectNamatApiSources();
  for(const [path,body] of files)write(path,body);
  write('package-lock.json',readFileSync(join(REPO,'package-lock.json')));
  const {manifest,lock}=locked();
  write('runtime/package.json',JSON.stringify(manifest));write('runtime/package-lock.json',JSON.stringify(lock));
  for(const [path,entry] of Object.entries(lock.packages))if(path)write(`runtime/${path}/package.json`,JSON.stringify({name:path.split('node_modules/').at(-1),version:entry.version}));
  for(const path of ['cmaps/fixture.bcmap','standard_fonts/fixture.ttf','wasm/fixture.wasm'])write(`runtime/node_modules/pdfjs-dist/${path}`,'fixture');
  const elf=Buffer.alloc(32);elf.writeUInt32BE(0x7f454c46);elf[4]=2;elf[5]=1;elf.writeUInt16LE(62,18);
  write('runtime/node_modules/@img/sharp-linux-x64/lib/sharp-linux-x64.node',elf);
  write('runtime/node_modules/@img/sharp-libvips-linux-x64/lib/libvips-cpp.so.8',elf);
  write('runtime/node_modules/@napi-rs/canvas-linux-x64-gnu/skia.linux-x64-gnu.node',elf);
  return {root,write,options:{nodeModulesDirectory:join(root,'runtime/node_modules')}};
}

test('API source closure contains the contract, every pinned file and document worker; excludes unrelated services',()=>{
  const {files,revision}=collectNamatApiSources();
  const pins=JSON.parse(files.get('services/namat-api/source-revision.json'));
  assert.equal(revision,pins.questionnaireRevision);
  for(const [path,sha256] of Object.entries(pins.sources))assert.equal(hash(files.get(path)),sha256,path);
  for(const path of ['services/namat-api/server.mjs','services/namat-api/contracts/openapi.json','services/report-processing/document-worker.mjs','src/hackathon/db/001_welcome_submissions.sql'])assert.ok(files.has(path),path);
  for(const path of ['services/namat-api/initialize.mjs','services/namat-api/worker.mjs','services/report-processing/worker.mjs','services/report-processing/review.html','src/hackathon/server/azure-server.mjs','src/hackathon/server/confirmation-email.mjs'])assert.equal(files.has(path),false,path);
  for(const path of files.keys())assert.doesNotMatch(path,/^(?:public|output|tests|scripts)\/|(^|\/)\.|\.env/);
});

test('packaging refuses changed source pins, source symlinks and imports outside the API closure',t=>{
  const {root,write}=fixture(t),entry='services/namat-api/server.mjs',original=readFileSync(join(root,entry));
  write(entry,original+'\nimport "../../scripts/private.mjs";\n');
  assert.throws(()=>collectNamatApiSources(root),/outside the deployment allowlist/);
  write(entry,original+'\nawait import(process.env.EXTRA);\n');
  assert.throws(()=>collectNamatApiSources(root),/Nonliteral import/);
  write(entry,original+'\nimport "unlocked-library";\n');
  assert.throws(()=>collectNamatApiSources(root),/Unexpected API runtime dependency/);
  write(entry,original);
  const pinned='src/hackathon/welcome/questionnaire-model.mjs';
  write(pinned,readFileSync(join(root,pinned))+'\n// Changed after contract review.\n');
  assert.throws(()=>collectNamatApiSources(root),/Pinned API source changed/);
  write(pinned,readFileSync(join(REPO,pinned)));
  rmSync(join(root,entry));symlinkSync(join(REPO,entry),join(root,entry));
  assert.throws(()=>collectNamatApiSources(root),/regular files without symlinks/);
});

test('runtime preparation writes only the locked manifest into an empty directory',t=>{
  const {root}=directory(t),staging=join(root,'runtime');
  const result=prepareNamatApiRuntime(staging);
  assert.deepEqual(result.runtimeTarget,{os:'linux',cpu:'x64',libc:'glibc'});
  assert.match(result.installCommand,/--os=linux --cpu=x64 --libc=glibc --ignore-scripts/);
  assert.deepEqual(JSON.parse(readFileSync(join(staging,'package-lock.json'))),locked().lock);
  assert.throws(()=>prepareNamatApiRuntime(staging),/empty, regular/);
});

test('API package is deterministic, inventory-verified, and excludes credentials, website files and worker CLIs',t=>{
  const {root,write,options}=fixture(t);
  for(const name of ['.env','public/welcome/index.html','output/private.json','tests/private.test.mjs','services/namat-api/worker.mjs'])write(name,'DO NOT PACKAGE');
  write('runtime/node_modules/pg/credentials.json','DO NOT PACKAGE');
  const {files,manifest}=collectNamatApiAzureFiles(root,options);
  const metadata=JSON.parse(files.get('package.json'));
  assert.deepEqual(metadata.scripts,{start:'node services/namat-api/server.mjs'});
  assert.deepEqual(metadata.engines,{node:'22.x'});assert.deepEqual(metadata.dependencies,RUNTIME_DEPENDENCIES);
  assert.equal(manifest.initializationCliIncluded,false);assert.equal(manifest.outboxWorkerIncluded,false);assert.equal(manifest.documentWorkerIncluded,true);
  assert.deepEqual(manifest.runtimeTarget,{os:'linux',cpu:'x64',libc:'glibc'});
  for(const [path,body] of files) {
    assert.doesNotMatch(path,/^(?:public|output|tests)\/|(^|\/)\.|\.env|credentials\.json/);
    assert.equal(body.includes('DO NOT PACKAGE'),false,path);
  }
  for(const item of manifest.files){assert.equal(files.get(item.path).length,item.bytes);assert.equal(hash(files.get(item.path)),item.sha256);}
  const zip=deterministicZip(files);assert.deepEqual(zip,deterministicZip(new Map([...files].reverse())));
  let offset=0,count=0;
  while(zip.readUInt32LE(offset)===0x04034b50) {
    const length=zip.readUInt32LE(offset+18),nameLength=zip.readUInt16LE(offset+26),name=zip.subarray(offset+30,offset+30+nameLength).toString();
    assert.deepEqual(inflateRawSync(zip.subarray(offset+30+nameLength,offset+30+nameLength+length)),files.get(name));
    count++;offset+=30+nameLength+length;
  }
  assert.equal(count,files.size);
  const result=packageNamatApiAzure(root,options);
  assert.equal(result.zipSha256,hash(zip));assert.deepEqual(readFileSync(join(root,'output/namat-api-azure.zip')),zip);
  rmSync(join(root,'output/namat-api-azure.zip'));symlinkSync(join(root,'package-lock.json'),join(root,'output/namat-api-azure.zip'));
  assert.throws(()=>packageNamatApiAzure(root,options),/output files cannot be symlinks/);
});

test('runtime packaging refuses missing resources, wrong locks, versions, dependency symlinks and Mac binaries',t=>{
  const {root,write,options}=fixture(t),base='runtime/node_modules/pg/package.json',original=readFileSync(join(root,base));
  write(base,JSON.stringify({name:'pg',version:'0.0.0'}));
  assert.throws(()=>collectNamatApiAzureFiles(root,options),/do not match the lockfile/);write(base,original);
  symlinkSync(join(root,'package-lock.json'),join(root,'runtime/node_modules/pg/leak.json'));
  assert.throws(()=>collectNamatApiAzureFiles(root,options),/symlinks are not supported/);rmSync(join(root,'runtime/node_modules/pg/leak.json'));
  const binary='runtime/node_modules/@img/sharp-linux-x64/lib/sharp-linux-x64.node',elf=readFileSync(join(root,binary));
  write(binary,Buffer.from([0xcf,0xfa,0xed,0xfe,...Array(28).fill(0)]));
  assert.throws(()=>collectNamatApiAzureFiles(root,options),/Linux x64 ELF/);write(binary,elf);
  rmSync(join(root,'runtime/node_modules/pdfjs-dist/wasm'),{recursive:true});
  assert.throws(()=>collectNamatApiAzureFiles(root,options),/PDF runtime resources are missing/);write('runtime/node_modules/pdfjs-dist/wasm/fixture.wasm','fixture');
  const lock=JSON.parse(readFileSync(join(root,'runtime/package-lock.json')));lock.packages['node_modules/pg'].version='0.0.0';write('runtime/package-lock.json',JSON.stringify(lock));
  assert.throws(()=>collectNamatApiAzureFiles(root,options),/exact pinned runtime dependencies/);
});

test('actual staged Linux runtime imports the packaged server and validates source/resource completeness',t=>{
  if(!process.env.NAMAT_RUNTIME_NODE_MODULES){t.skip('Set NAMAT_RUNTIME_NODE_MODULES to the locked Linux staging directory.');return;}
  const {files}=collectNamatApiAzureFiles(),{root,write}=directory(t);
  for(const [path,body] of files)write(path,body);
  for(const path of ['node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs','node_modules/@napi-rs/canvas-linux-x64-gnu/skia.linux-x64-gnu.node'])assert.ok(files.has(path),path);
  assert.ok([...files.keys()].some(path=>/^node_modules\/@img\/sharp-linux-x64\/lib\/sharp-linux-x64.*\.node$/.test(path)));
  const smoke=spawnSync(process.execPath,['--input-type=module','-e',"import {createNamatApiServer} from './services/namat-api/server.mjs';import pg from 'pg';if(typeof pg.Pool!=='function')throw Error('Missing pg');const server=createNamatApiServer({env:{}});server.close();console.log('ok');"],{cwd:root,encoding:'utf8',env:{PATH:process.env.PATH}});
  assert.equal(smoke.status,0,smoke.stderr);assert.equal(smoke.stdout.trim(),'ok');
});
