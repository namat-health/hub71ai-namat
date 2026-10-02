// Create a deterministic API-only Azure package. Reads only traced/allowlisted
// source and locked runtime dependencies; never loads secrets or deploys.
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,realpathSync,writeFileSync} from 'node:fs';
import {dirname,join,posix,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {deterministicZip} from './lib/deterministic-zip.mjs';
import {lockedRuntimePackage,moduleImports,RUNTIME_DEPENDENCIES} from './lib/runtime-package.mjs';
import {AZURE_RUNTIME_TARGET,prepareHackathonRuntime,verifyLinuxNative} from './lib/azure-runtime.mjs';

const REPO=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const ENTRY='services/namat-api/server.mjs';
const REVISION='services/namat-api/source-revision.json';
const CONTRACT='services/namat-api/contracts/openapi.json';
const WORKER='services/report-processing/document-worker.mjs';
const PINNED_SQL='src/hackathon/db/001_welcome_submissions.sql';
const digest=value=>createHash('sha256').update(value).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const ordered=files=>new Map([...files].sort(([a],[b])=>a.localeCompare(b,'en')));
const SKIP=new Set(['node_modules','test','tests','__tests__','fixtures','examples','docs','secrets.json','credentials.json','package-lock.json','npm-shrinkwrap.json']);
const REQUIRED_NATIVE=['@img/sharp-linux-x64','@img/sharp-libvips-linux-x64','@napi-rs/canvas-linux-x64-gnu'];
const RUNTIME_EXTENSION=/\.(?:js|mjs|cjs|json|node|wasm|bin|bcmap|pfb|ttf|otf|icc|dat|so(?:\.\d+)*)$/;
const native=/\.(?:node|so(?:\.\d+)*)$/;

function safePath(path) {
  if(!path||path.startsWith('/')||path.includes('\\')||path.split('/').some(part=>!part||part.startsWith('.')))throw new Error('Unsafe API package path.');
  return path;
}
function read(root,path) {
  safePath(path);
  const file=resolve(root,path);
  if(!file.startsWith(root+sep)||realpathSync(file)!==file||!lstatSync(file).isFile())throw new Error('API package sources must be regular files without symlinks.');
  return readFileSync(file);
}
function allowedSource(path) {
  return /^services\/namat-api\/(?!initialize\.mjs$|worker\.mjs$)[\w-]+\.mjs$/.test(path)
    || /^src\/hackathon\/server\/(?:api|uploads|store)\.mjs$/.test(path)
    || /^src\/lib\/overview-preview(?:-v4)?\.mjs$/.test(path)
    || path==='src/hackathon/welcome/questionnaire-model.mjs'
    || /^services\/report-processing\/(?:document(?:-worker)?|service|blob|local-blob|store)\.mjs$/.test(path)
    || path===PINNED_SQL;
}

export function collectNamatApiSources(root=REPO) {
  root=realpathSync(root);
  const revisionBody=read(root,REVISION),revision=JSON.parse(revisionBody);
  if(typeof revision.questionnaireRevision!=='string'||!revision.sources||Array.isArray(revision.sources)||!Object.keys(revision.sources).length)throw new Error('Invalid API source revision manifest.');
  const files=new Map([[REVISION,revisionBody],[CONTRACT,read(root,CONTRACT)]]);
  // The document worker and source lock are runtime resources opened with
  // new URL(), not normal imports. The SQL is included only for revision checks.
  const pending=[ENTRY,WORKER];
  for(const [path,expected] of Object.entries(revision.sources)) {
    if(!allowedSource(safePath(path))||!/^[a-f0-9]{64}$/.test(expected)||digest(read(root,path))!==expected)throw new Error(`Pinned API source changed or is disallowed: ${path}`);
    pending.push(path);
  }
  const externals=new Set();
  while(pending.length) {
    const path=safePath(pending.pop());
    if(files.has(path))continue;
    if(!allowedSource(path))throw new Error(`API import is outside the deployment allowlist: ${path}`);
    const body=read(root,path);files.set(path,body);
    if(!path.endsWith('.mjs'))continue;
    for(const specifier of moduleImports(body.toString(),path)) {
      if(specifier.startsWith('node:'))continue;
      if(specifier.startsWith('.')){pending.push(safePath(posix.join(posix.dirname(path),specifier)));continue;}
      const name=specifier.startsWith('@')?specifier.split('/').slice(0,2).join('/'):specifier.split('/')[0];
      if(!Object.hasOwn(RUNTIME_DEPENDENCIES,name))throw new Error(`Unexpected API runtime dependency: ${specifier}`);
      externals.add(name);
    }
  }
  for(const name of ['pg','@cantoo/pdf-lib','pdfjs-dist','sharp'])if(!externals.has(name))throw new Error(`Missing expected API runtime import: ${name}`);
  return {files:ordered(files),revision:revision.questionnaireRevision};
}

function supportsTarget(locked,path) {
  const accepts=(values,target)=>!values||!values.includes('!'+target)&&(!values.some(value=>!value.startsWith('!'))||values.includes(target));
  return accepts(locked.os,'linux')&&accepts(locked.cpu,'x64')&&accepts(locked.libc,'glibc')&&!/linuxmusl|linux-[^/]*-musl/.test(path);
}
export function collectNamatApiAzureFiles(root=REPO,{nodeModulesDirectory=process.env.NAMAT_RUNTIME_NODE_MODULES||join(root,'node_modules')}={}) {
  root=realpathSync(root);
  const {files,revision}=collectNamatApiSources(root);
  const {manifest,lock}=lockedRuntimePackage(JSON.parse(read(root,'package-lock.json')));
  const runtimeRoot=resolve(nodeModulesDirectory);
  if(realpathSync(runtimeRoot)!==runtimeRoot)throw new Error('The runtime dependency directory cannot contain symlinks.');
  for(const name of REQUIRED_NATIVE)if(!existsSync(join(runtimeRoot,name,'package.json')))throw new Error(`Missing Linux x64 runtime dependency ${name}. Stage npm ci --os=linux --cpu=x64 --libc=glibc --ignore-scripts and set NAMAT_RUNTIME_NODE_MODULES.`);
  if(runtimeRoot!==join(root,'node_modules')) {
    const stagedLock=join(dirname(runtimeRoot),'package-lock.json');
    if(!existsSync(stagedLock)||realpathSync(stagedLock)!==stagedLock||JSON.stringify(lockedRuntimePackage(JSON.parse(readFileSync(stagedLock))).lock)!==JSON.stringify(lock))throw new Error('Staged runtime lockfile does not match the generated runtime dependency lock.');
  }
  const dependencies=[];
  for(const [path,locked] of Object.entries(lock.packages)) {
    if(!path)continue;
    if(!supportsTarget(locked,path)){if(locked.optional)continue;throw new Error(`Locked dependency does not support Linux x64: ${path}`);}
    const source=path.slice('node_modules/'.length);
    if(!existsSync(join(runtimeRoot,source,'package.json'))&&locked.optional)continue;
    const installed=JSON.parse(read(runtimeRoot,`${source}/package.json`)),name=path.split('node_modules/').at(-1);
    if(installed.name!==name||installed.version!==locked.version)throw new Error('Installed runtime dependencies do not match the lockfile.');
    dependencies.push({path,name,version:installed.version});
    const walk=directory=>{
      for(const name of readdirSync(join(runtimeRoot,directory)).sort()) {
        if(name.startsWith('.')||SKIP.has(name))continue;
        const child=`${directory}/${name}`,metadata=lstatSync(join(runtimeRoot,child));
        if(metadata.isSymbolicLink())throw new Error('Runtime dependency symlinks are not supported.');
        if(metadata.isDirectory())walk(child);
        else if(metadata.isFile()&&(RUNTIME_EXTENSION.test(name)||/^licen[cs]e(?:\.\w+)?$/i.test(name))){
          const body=read(runtimeRoot,child),destination=`node_modules/${child}`;
          if(native.test(name))verifyLinuxNative(body,destination);
          files.set(destination,body);
        }
      }
    };
    walk(source);
  }
  for(const directory of ['cmaps/','standard_fonts/','wasm/'])if(![...files.keys()].some(path=>path.startsWith(`node_modules/pdfjs-dist/${directory}`)))throw new Error(`PDF runtime resources are missing: ${directory}`);
  for(const name of REQUIRED_NATIVE)if(![...files.keys()].some(path=>path.startsWith(`node_modules/${name}/`)&&native.test(path)))throw new Error(`Linux runtime native binary is missing: ${name}`);
  const metadata={...manifest,name:'namat-api-azure',scripts:{start:`node ${ENTRY}`}};
  lock.name=metadata.name;lock.packages[''].name=metadata.name;
  files.set('package.json',json(metadata));files.set('package-lock.json',json(lock));
  const payload=ordered(files);
  const inventory={kind:'namat-api-azure',formatVersion:1,entrypoint:ENTRY,nodeMajor:22,runtimeTarget:AZURE_RUNTIME_TARGET,
    questionnaireRevision:revision,initializationCliIncluded:false,outboxWorkerIncluded:false,documentWorkerIncluded:true,
    dependencies,files:[...payload].map(([path,body])=>({path,bytes:body.length,sha256:digest(body)}))};
  files.set('package-manifest.json',json(inventory));
  return {files:ordered(files),manifest:inventory};
}

export const prepareNamatApiRuntime=prepareHackathonRuntime;
export function packageNamatApiAzure(root=REPO,options) {
  root=realpathSync(root);
  const {files,manifest}=collectNamatApiAzureFiles(root,options),zip=deterministicZip(files);
  const output=join(root,'output');mkdirSync(output,{recursive:true});
  if(realpathSync(output)!==output)throw new Error('The output directory cannot be a symlink.');
  const result={...manifest,fileCount:files.size,zipBytes:zip.length,zipSha256:digest(zip)};
  for(const name of ['namat-api-azure.zip','namat-api-azure-manifest.json'])if(lstatSync(join(output,name),{throwIfNoEntry:false})?.isSymbolicLink())throw new Error('API output files cannot be symlinks.');
  writeFileSync(join(output,'namat-api-azure.zip'),zip);writeFileSync(join(output,'namat-api-azure-manifest.json'),json(result));
  return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if(process.argv.length===4&&process.argv[2]==='--prepare-runtime')console.log(JSON.stringify(prepareNamatApiRuntime(process.argv[3])));
    else {
      if(process.argv.length>2)throw new Error('Use --prepare-runtime DIRECTORY or no arguments.');
      const result=packageNamatApiAzure();
      console.log(JSON.stringify({file:'output/namat-api-azure.zip',files:result.fileCount,bytes:result.zipBytes,sha256:result.zipSha256}));
    }
  } catch(error) {console.error(`API packaging failed: ${error.message}`);process.exitCode=1;}
}
