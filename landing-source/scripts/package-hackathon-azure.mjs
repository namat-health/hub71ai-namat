// Bundle the existing standalone page and current API for Azure App Service.
// No install, network, environment loading or deployment is performed.
// On a Mac, first prepare an empty staging directory with --prepare-runtime,
// run npm ci there with --os=linux --cpu=x64 --libc=glibc --ignore-scripts,
// then point NAMAT_RUNTIME_NODE_MODULES at that directory's node_modules.
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,realpathSync,writeFileSync} from 'node:fs';
import {dirname,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {deterministicZip} from './package-journey-test.mjs';
import {lockedRuntimePackage,moduleImports,runtimeClosure,staticReferences} from './build-hackathon-site.mjs';

const REPO=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const ENTRY='src/hackathon/server/azure-server.mjs';
const digest=body=>createHash('sha256').update(body).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const ordered=files=>new Map([...files].sort(([a],[b])=>a.localeCompare(b,'en')));
const SKIP=new Set(['node_modules','test','tests','__tests__','fixtures','examples','docs','secrets.json','credentials.json','package-lock.json','npm-shrinkwrap.json']);
export const AZURE_RUNTIME_TARGET=Object.freeze({os:'linux',cpu:'x64',libc:'glibc'});
const REQUIRED_NATIVE=['@img/sharp-linux-x64','@img/sharp-libvips-linux-x64','@napi-rs/canvas-linux-x64-gnu'];
const RUNTIME_EXTENSION=/\.(?:js|mjs|cjs|json|node|wasm|bin|bcmap|pfb|ttf|otf|icc|dat|so(?:\.\d+)*)$/;
const native=/\.(?:node|so(?:\.\d+)*)$/;
export function verifyLinuxNative(body,path) {
  // Linux App Service is x86-64 glibc. Never ship a Mach-O, PE, ARM or 32-bit
  // binary copied from the developer's machine under a valid-looking name.
  if(body.length<20||body.readUInt32BE(0)!==0x7f454c46||body[4]!==2||body[5]!==1||body.readUInt16LE(18)!==62){
    throw new Error(`Expected a Linux x64 ELF runtime binary: ${path}`);
  }
}
function supportsTarget(locked,path) {
  const accepts=(values,target)=>!values||!values.includes('!'+target)&&(!values.some(value=>!value.startsWith('!'))||values.includes(target));
  return accepts(locked.os,'linux')&&accepts(locked.cpu,'x64')&&accepts(locked.libc,'glibc')&&!/linuxmusl|linux-[^/]*-musl/.test(path);
}
function read(root,path) {
  if(!path||path.startsWith('/')||path.includes('\\')||path.split('/').some(part=>!part||part.startsWith('.')))throw new Error('Unsafe deployment path.');
  const file=resolve(root,path);
  if(!file.startsWith(root+sep)||realpathSync(file)!==file||!lstatSync(file).isFile())throw new Error('Deployment sources must be regular files without symlinks.');
  return readFileSync(file);
}

export function prepareHackathonRuntime(directory,root=REPO) {
  const target=resolve(directory),{manifest,lock}=lockedRuntimePackage(JSON.parse(read(realpathSync(root),'package-lock.json')));
  mkdirSync(target,{recursive:true});
  if(realpathSync(target)!==target||readdirSync(target).length)throw new Error('Choose an empty, regular runtime staging directory.');
  writeFileSync(join(target,'package.json'),json(manifest));
  writeFileSync(join(target,'package-lock.json'),json(lock));
  return {directory:target,nodeModulesDirectory:join(target,'node_modules'),runtimeTarget:AZURE_RUNTIME_TARGET,
    installCommand:'npm ci --os=linux --cpu=x64 --libc=glibc --ignore-scripts --no-audit --no-fund'};
}

export function collectHackathonAzureFiles(root=REPO,{nodeModulesDirectory=process.env.NAMAT_RUNTIME_NODE_MODULES||join(root,'node_modules')}={}) {
  root=realpathSync(root);
  const files=runtimeClosure(path=>read(root,path));
  files.delete('api/hackathon.mjs');
  const entry=read(root,ENTRY);
  for(const specifier of moduleImports(entry.toString(),ENTRY)) {
    if(specifier.startsWith('node:'))continue;
    const dependency=relative(root,resolve(root,dirname(ENTRY),specifier)).split(sep).join('/');
    if(!specifier.startsWith('.')||!files.has(dependency))throw new Error('Unexpected Azure server dependency.');
  }
  files.set(ENTRY,entry);
  const standalone=join(root,'dist-hackathon');
  const inventory=JSON.parse(read(standalone,'package-manifest.json'));
  const allowed=new Map(inventory.files.filter(item=>item.path.startsWith('public/')).map(item=>[item.path,item]));
  const copyPublic=path=>{
    const item=allowed.get(path),body=read(standalone,path);
    if(!item||item.bytes!==body.length||item.sha256!==digest(body))throw new Error('The standalone page or its assets changed; rebuild the hackathon package.');
    files.set(path,body);return body;
  };
  const page=copyPublic('public/welcome/index.html');
  if(!page.includes('data-hackathon-questionnaire')||!page.includes('noindex'))throw new Error('Build the standalone demo questionnaire first.');
  const pending=[...staticReferences(page.toString(),'start/welcome/index.html')];
  while(pending.length) {
    const asset=pending.pop(),path=`public/${asset}`;
    if(files.has(path))continue;
    const body=copyPublic(path);
    if(/\.(js|css)$/.test(path))pending.push(...staticReferences(body.toString(),asset));
  }
  const {manifest,lock}=lockedRuntimePackage(JSON.parse(read(root,'package-lock.json')));
  const runtimeRoot=resolve(nodeModulesDirectory);
  if(realpathSync(runtimeRoot)!==runtimeRoot)throw new Error('The runtime dependency directory cannot contain symlinks.');
  for(const name of REQUIRED_NATIVE){
    if(!existsSync(join(runtimeRoot,name,'package.json')))throw new Error(`Missing Linux x64 runtime dependency ${name}. Stage npm ci --os=linux --cpu=x64 --libc=glibc --ignore-scripts and set NAMAT_RUNTIME_NODE_MODULES.`);
  }
  const stagedLock=join(dirname(runtimeRoot),'package-lock.json');
  if(runtimeRoot!==join(root,'node_modules')){
    if(!existsSync(stagedLock)||JSON.stringify(lockedRuntimePackage(JSON.parse(readFileSync(stagedLock))).lock)!==JSON.stringify(lock)){
      throw new Error('Staged runtime lockfile does not match the generated runtime dependency lock.');
    }
  }
  const dependencies=[];
  for(const [path,locked] of Object.entries(lock.packages)) {
    if(!path)continue;
    if(!supportsTarget(locked,path)){if(locked.optional)continue;throw new Error(`Locked dependency does not support Linux x64: ${path}`);}
    const source=path.slice('node_modules/'.length);
    if(!existsSync(join(runtimeRoot,source,'package.json'))&&locked.optional)continue;
    const installed=JSON.parse(read(runtimeRoot,`${source}/package.json`));
    const name=path.split('node_modules/').at(-1);
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
  const metadata={...manifest,name:'namat-hackathon-azure',scripts:{start:`node ${ENTRY}`}};
  lock.name=metadata.name;lock.packages[''].name=metadata.name;
  files.set('package.json',json(metadata));
  files.set('package-lock.json',json(lock));
  const payload=ordered(files);
  const inventoryFile={kind:'namat-hackathon-azure',formatVersion:1,entrypoint:ENTRY,nodeMajor:22,runtimeTarget:AZURE_RUNTIME_TARGET,
    dependencies,files:[...payload].map(([path,body])=>({path,bytes:body.length,sha256:digest(body)}))};
  files.set('package-manifest.json',json(inventoryFile));
  return {files:ordered(files),manifest:inventoryFile};
}

export function packageHackathonAzure(root=REPO,options) {
  root=realpathSync(root);
  const {files,manifest}=collectHackathonAzureFiles(root,options);
  const zip=deterministicZip(files);
  const output=join(root,'output');mkdirSync(output,{recursive:true});
  if(realpathSync(output)!==output)throw new Error('The output directory cannot be a symlink.');
  const result={...manifest,fileCount:files.size,zipBytes:zip.length,zipSha256:digest(zip)};
  writeFileSync(join(output,'namat-hackathon-azure.zip'),zip);
  writeFileSync(join(output,'hackathon-azure-manifest.json'),json(result));
  return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if(process.argv.length===4&&process.argv[2]==='--prepare-runtime')console.log(JSON.stringify(prepareHackathonRuntime(process.argv[3])));
    else {
      if(process.argv.length>2)throw new Error('Use --prepare-runtime DIRECTORY or no arguments.');
      const result=packageHackathonAzure();
      console.log(JSON.stringify({file:'output/namat-hackathon-azure.zip',files:result.fileCount,bytes:result.zipBytes,sha256:result.zipSha256}));
    }
  } catch(error) {
    console.error(`Demo packaging failed: ${error.message}`);
    process.exitCode=1;
  }
}
