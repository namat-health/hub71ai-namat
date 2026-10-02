import {AnalysisStoreError} from './store.mjs';

const OPERATIONS=new Set(['reserve','settle','saveRun','findRun','getRun','saveDecision','budget','saveInventoryReview','getInventoryReviews']);
export const MAX_ANALYSIS_STORE_BYTES=2_500_000;
const output=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});

// Internal transport only. Caller verifies the upstream service key before
// invoking this handler; actor is supplied by the authenticated portal service.
export async function analysisStoreResponse(request,{store,actor}={}) {
  if(request.method!=='POST')return output({error:'method_not_allowed'},405);
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(request.headers.get('content-type')||''))return output({error:'unsupported_media_type'},415);
  let payload;
  try{
    const reader=request.body?.getReader();if(!reader)return output({error:'invalid_json'},400);
    const parts=[];let bytes=0;
    while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>MAX_ANALYSIS_STORE_BYTES){await reader.cancel();return output({error:'payload_too_large'},413);}parts.push(Buffer.from(value));}
    payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));
  }catch{return output({error:'invalid_json'},400);}
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(key=>!['operation','input'].includes(key))||!OPERATIONS.has(payload.operation)||!payload.input||typeof payload.input!=='object'||Array.isArray(payload.input))return output({error:'invalid_operation'},400);
  try{
    const input=['saveDecision','saveInventoryReview'].includes(payload.operation)&&actor!==undefined?{...payload.input,actor}:payload.input;
    const result=await store[payload.operation](input);
    return output({result});
  }catch(error){
    if(error instanceof AnalysisStoreError)return output({error:error.code},error.status);
    // No provider details, query text, patient data or configuration in errors.
    return output({error:'analysis_store_unavailable'},503);
  }
}
