// Development adapter only. Cloud deployments require Azure Blob Storage.
import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {MAX_REPORT_BYTES} from './blob.mjs';
export function createLocalBlobStore(directory,secret) {
  if (!directory || !secret || secret.length<32) throw new Error('Local report storage requires an explicit directory and secret.');
  const root=resolve(directory),keyPattern=/^[a-z0-9/-]{1,180}$/;
  const path=(container,key)=>{if(!keyPattern.test(key)||key.split('/').some(part=>!part))throw new Error('Invalid storage key.');const destination=resolve(root,container,key);if(!destination.startsWith(`${root}/${container}/`))throw new Error('Invalid storage key.');return destination;};
  const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
  const signature=(key,expires)=>createHmac('sha256',secret).update(`${key}:${expires}`).digest('hex');
  const write=async(container,key,bytes)=>{const dest=path(container,key);await mkdir(dirname(dest),{recursive:true,mode:0o700});await writeFile(dest,bytes,{mode:0o600,flag:'wx'});};
  return {
    local:true,
    async uploadUrl(key){const expires=Date.now()+900000;return `/api/reports/local-upload?key=${encodeURIComponent(key)}&expires=${expires}&signature=${signature(key,expires)}`;},
    async receive(url,bytes) {
      const key=url.searchParams.get('key'),expires=Number(url.searchParams.get('expires')),sig=url.searchParams.get('signature')||'';
      const expected=signature(key,expires);
      if (!keyPattern.test(key||'') || !Number.isSafeInteger(expires)||expires<Date.now()||expires>Date.now()+900000||sig.length!==expected.length||!timingSafeEqual(Buffer.from(sig),Buffer.from(expected))) throw new Error('Upload permission expired.');
      if (!bytes.length||bytes.length>MAX_REPORT_BYTES)throw new Error('File too large.');
      try{await write('quarantine',key,bytes);}catch(error){if(error.code==='EEXIST'){error.status=409;error.message='This upload already exists. Finish validating it.';}throw error;}
    },
    async readQuarantine(key,expected){const bytes=await readFile(path('quarantine',key));if(bytes.length!==expected.size||bytes.length>MAX_REPORT_BYTES||digest(bytes)!==expected.sha256){const e=new Error('The uploaded file changed.');e.code='hash_mismatch';throw e;}return bytes;},
    async promote(id,bytes){const key=`reports/${id}`;try{await write('originals',key,bytes);}catch(error){if(error.code!=='EEXIST'||!(await readFile(path('originals',key))).equals(bytes))throw error;}return key;},
    async read(key){const bytes=await readFile(path('originals',key));if(bytes.length>MAX_REPORT_BYTES)throw new Error('File too large.');return bytes;},
    async deleteQuarantine(key){await unlink(path('quarantine',key)).catch(e=>{if(e.code!=='ENOENT')throw e;});},
    async deleteOriginal(key){await unlink(path('originals',key)).catch(e=>{if(e.code!=='ENOENT')throw e;});},
  };
}
