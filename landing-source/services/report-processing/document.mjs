import {Worker} from 'node:worker_threads';

export const DOCUMENT_LIMITS=Object.freeze({
  maxBytes:10*1024*1024,
  maxPages:50,
  maxPixels:25_000_000,
  maxDimension:16_384,
  maxCharacters:1_000_000,
  maxTextItems:100_000,
  maxObjects:50_000,
  maxC2paBytes:2*1024*1024,
  timeoutMs:30_000,
});

const messages=Object.freeze({
  unsupported_type:'Choose a PDF, JPG or PNG report.',
  too_large:'Each report must be 10 MiB or less.',
  invalid_document:'We could not read this report. Export a new PDF, JPG or PNG and try again.',
  encrypted_pdf:'This PDF is password protected. Upload an unlocked copy.',
  active_content:'This PDF contains actions or interactive content. Export a static PDF and try again.',
  unsupported_attachment:'This PDF contains an unsupported attached file. Export a PDF without attachments and try again.',
  too_many_pages:'Each report must contain 50 pages or fewer.',
  image_too_large:'This image is too large to process. Use an image under 25 million pixels and 16,384 pixels on either side.',
  document_too_complex:'This report is too complex to process. Export a simpler PDF or split it into smaller reports.',
  inspection_timeout:'Checking this report took too long. Export a simpler copy and try again.',
});

export class DocumentInspectionError extends Error {
  constructor(code='invalid_document') {
    super(messages[code]||messages.invalid_document);
    this.name='DocumentInspectionError';
    this.code=Object.hasOwn(messages,code)?code:'invalid_document';
  }
}

/**
 * Structurally inspect original bytes without changing them or following URLs.
 * PDF text lines include optional {x,y,width,height} bounds in PDF points from
 * the rotated page's top-left corner. Empty/scant text marks needsOcr=true.
 * This checks supported formats/content; it is not a malware scan or C2PA
 * signature verification. Callers must keep originals private and inert.
 */
export async function inspectDocument(bytes,mime,{timeoutMs=DOCUMENT_LIMITS.timeoutMs}={}) {
  if (!['application/pdf','image/png','image/jpeg'].includes(mime)) throw new DocumentInspectionError('unsupported_type');
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength) throw new DocumentInspectionError();
  if (bytes.byteLength>DOCUMENT_LIMITS.maxBytes) throw new DocumentInspectionError('too_large');
  if (!Number.isInteger(timeoutMs) || timeoutMs<1 || timeoutMs>DOCUMENT_LIMITS.timeoutMs) throw new RangeError('Invalid inspection timeout');
  // Copy rather than transferring the caller's buffer: its original bytes and
  // digest must survive inspection. Heavy parsing stays off the request loop.
  const data=Uint8Array.from(bytes);
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./document-worker.mjs',import.meta.url),{
      workerData:{bytes:data,mime,limits:DOCUMENT_LIMITS},
      resourceLimits:{maxOldGenerationSizeMb:256,maxYoungGenerationSizeMb:32,stackSizeMb:4},
      stdout:true,stderr:true,
      // Do not inherit --input-type from local stdin invocations.
      execArgv:process.execArgv.filter(value=>!value.startsWith('--input-type')),
    });
    // Parser warnings can contain document contents. Do not forward them into
    // operational logs or error responses.
    worker.stdout.resume();worker.stderr.resume();
    let settled=false;
    const finish=(error,value)=>{
      if(settled)return;
      settled=true;clearTimeout(timer);
      void worker.terminate();
      if(error)reject(error);else resolve(value);
    };
    const timer=setTimeout(()=>finish(new DocumentInspectionError('inspection_timeout')),timeoutMs);
    worker.once('message',message=>{
      if(message?.ok===true)finish(null,message.value);
      else finish(new DocumentInspectionError(message?.code));
    });
    worker.once('error',error=>finish(new DocumentInspectionError(error?.code==='ERR_WORKER_OUT_OF_MEMORY'?'document_too_complex':'invalid_document')));
    worker.once('exit',()=>{if(!settled)finish(new DocumentInspectionError());});
  });
}
