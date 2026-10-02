// Linux runtime staging and binary checks; no deployment or website build.
import {lstatSync,mkdirSync,readFileSync,readdirSync,realpathSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {lockedRuntimePackage} from './runtime-package.mjs';
const REPO=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
export const AZURE_RUNTIME_TARGET=Object.freeze({os:'linux',cpu:'x64',libc:'glibc'});
export function verifyLinuxNative(body,path) {
  // Linux App Service is x86-64 glibc. Never ship a Mach-O, PE, ARM or 32-bit
  // binary copied from the developer's machine under a valid-looking name.
  if(body.length<20||body.readUInt32BE(0)!==0x7f454c46||body[4]!==2||body[5]!==1||body.readUInt16LE(18)!==62){
    throw new Error(`Expected a Linux x64 ELF runtime binary: ${path}`);
  }
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
