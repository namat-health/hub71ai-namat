import {processHackathonRequest,MAX_BODY_BYTES} from './api.mjs';
import {sendHackathonConfirmation} from './confirmation-email.mjs';

/** Shared Node HTTP adapter for local preview and Vercel. No request data is logged. */
export async function handleHackathonHttp(req,res,{env=process.env,pool}={}) {
  const headers = {'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Type':'application/json; charset=utf-8'};
  const send = result => {
    res.writeHead(result.status,{...headers,...result.headers});
    res.end(result.body === null ? '' : JSON.stringify(result.body));
  };
  try {
    let body = req.body;
    if (body === undefined && req.method === 'POST') {
      const chunks=[];let size=0;
      for await (const chunk of req) {
        size+=chunk.length;
        if(size<=MAX_BODY_BYTES)chunks.push(Buffer.from(chunk));
      }
      if(size>MAX_BODY_BYTES)return send({status:413,body:{status:'error',message:'Your submission is too large. Please choose smaller reports.'}});
      body=Buffer.concat(chunks);
    }
    const result = await processHackathonRequest({method:req.method,headers:req.headers,body},
      {env,pool,sender:message=>sendHackathonConfirmation(message,{env})});
    send(result);
  } catch {
    if(!res.headersSent)send({status:503,body:{status:'unavailable',message:'We couldn’t confirm your submission. Please try again.'}});
  }
}
