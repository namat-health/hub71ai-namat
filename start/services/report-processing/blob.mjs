import {createHash} from 'node:crypto';
import {BlobServiceClient, BlobSASPermissions, generateBlobSASQueryParameters, SASProtocol} from '@azure/storage-blob';
import {DefaultAzureCredential} from '@azure/identity';

export const MAX_REPORT_BYTES = 10 * 1024 * 1024;
const keyPattern = /^[a-z0-9/-]{1,180}$/;
export function createBlobStore(env=process.env, credential=new DefaultAzureCredential()) {
  const account=env.NAMAT_REPORT_STORAGE_ACCOUNT;
  if (!/^[a-z0-9]{3,24}$/.test(account||'')) throw new Error('Report storage is not configured.');
  const service=new BlobServiceClient(`https://${account}.blob.core.windows.net`,credential,{retryOptions:{maxTries:3}});
  const container=name=>service.getContainerClient(name);
  const blob=(name,key)=>{if(!keyPattern.test(key))throw new Error('Invalid storage key.');return container(name).getBlockBlobClient(key);};
  let delegation;
  return {
    origin:`https://${account}.blob.core.windows.net`,
    async uploadUrl(key) {
      const start=new Date(Date.now()-300000),expiry=new Date(Date.now()+15*60000);
      if (!delegation || new Date(delegation.signedExpiresOn).getTime()<Date.now()+20*60000) {
        delegation=await service.getUserDelegationKey(start,new Date(Date.now()+60*60000));
      }
      // Create permission allows one new blob, with no read/list/delete or overwrite permission.
      const sas=generateBlobSASQueryParameters({containerName:'quarantine',blobName:key,
        permissions:BlobSASPermissions.parse('c'),startsOn:start,expiresOn:expiry,protocol:SASProtocol.Https},delegation,account).toString();
      return `${blob('quarantine',key).url}?${sas}`;
    },
    async readQuarantine(key,expected) {
      const source=blob('quarantine',key),properties=await source.getProperties();
      if (!properties.contentLength || properties.contentLength>MAX_REPORT_BYTES || properties.contentLength!==expected.size) {
        const error=new Error('The uploaded file size does not match.');error.code='size_mismatch';throw error;
      }
      // Read exactly the version whose size was checked. A concurrent overwrite cannot replace validated bytes.
      const bytes=await source.downloadToBuffer(0,properties.contentLength,{conditions:{ifMatch:properties.etag}});
      const sha256=createHash('sha256').update(bytes).digest('hex');
      if (sha256!==expected.sha256) {const error=new Error('The uploaded file changed. Choose it again.');error.code='hash_mismatch';throw error;}
      return bytes;
    },
    async promote(id,bytes,mime) {
      const key=`reports/${id}`,target=blob('originals',key);
      try {await target.uploadData(bytes,{conditions:{ifNoneMatch:'*'},blobHTTPHeaders:{blobContentType:mime}});}
      catch(error) {
        if (![409,412].includes(error.statusCode)) throw error;
        const existing=await target.downloadToBuffer(0,MAX_REPORT_BYTES+1);
        if (!existing.equals(bytes)) throw new Error('Stored report conflict.');
      }
      return key;
    },
    async read(key) {
      const target=blob('originals',key),properties=await target.getProperties();
      if (properties.contentLength>MAX_REPORT_BYTES) throw new Error('Stored report exceeds its limit.');
      return target.downloadToBuffer(0,properties.contentLength,{conditions:{ifMatch:properties.etag}});
    },
    async deleteQuarantine(key) {await blob('quarantine',key).deleteIfExists({deleteSnapshots:'include'});},
    async deleteOriginal(key) {await blob('originals',key).deleteIfExists({deleteSnapshots:'include'});},
  };
}
