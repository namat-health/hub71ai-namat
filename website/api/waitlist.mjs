import {processWaitlist} from '../server/waitlist.mjs';
export default async function handler(req, res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if (req.method !== 'POST') res.setHeader('Allow','POST');
  const result = await processWaitlist({method:req.method,headers:req.headers,body:req.body,ip:req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress});
  if (result.status === 429) res.setHeader('Retry-After','600');
  res.status(result.status).json(result.body);
}
