const VARIANTS = new Set(['home','how-it-works','dune','fieldnotes','afterglow','journal','continuum']);
const EMAIL = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;
const UNAVAILABLE = 'The waitlist connection is being prepared. Your email has not been saved. Please try again later.';
export const validDoiTemplate = template => template?.isActive === true && template?.doiTemplate === true && /\{\{\s*doubleoptin\s*\}\}/.test(template?.htmlContent || '');
const buckets = new Map();
let templateCheckedUntil = 0;
let checkedTemplateKey = '';

export function validatePayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (typeof input.email !== 'string' || input.email.length > 254 || /[\r\n\x00-\x1f]/.test(input.email)) return null;
  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email) || input.consent !== true || !VARIANTS.has(input.variant)) return null;
  if (typeof input.website !== 'string') return null;
  return {email, variant: input.variant, honeypot: input.website.length > 0};
}

export function allowedOrigins(env) {
  const declared = (env.WAITLIST_ALLOWED_ORIGINS || '').split(',').filter(Boolean);
  for (const host of [env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL]) {
    if (host) declared.push(`https://${host}`);
  }
  return new Set(declared.map(value => {try {return new URL(value.trim()).origin;} catch {return '';}}).filter(Boolean));
}

function limited(key, now) {
  // Instance-local defence in depth. Public launch also requires a platform WAF rule.
  if (buckets.size > 5000) for (const [id, bucket] of buckets) if (bucket.until <= now) buckets.delete(id);
  let bucket = buckets.get(key);
  if (!bucket || bucket.until <= now) {bucket = {count:0,until:now+600_000};buckets.set(key,bucket);}
  bucket.count++;
  return bucket.count > 5;
}

export async function processWaitlist({method, headers, body, ip}, {env=process.env, fetcher=fetch, now=Date.now(), throttle=true} = {}) {
  const reply = (status, message, extra={}) => ({status,body:{message,...extra}});
  if (method !== 'POST') return reply(405,'Please use the waitlist form.');
  const origin = headers.origin;
  if (!origin || !allowedOrigins(env).has(origin)) return reply(403,'Please submit from the Namat website.');
  if (!(headers['content-type'] || '').startsWith('application/json')) return reply(415,'Please use the waitlist form.');
  if (Number(headers['content-length'] || 0) > 2048) return reply(413,'This request is too large.');
  let input;
  try {
    if (typeof body === 'string' && Buffer.byteLength(body) > 2048) return reply(413,'This request is too large.');
    input = typeof body === 'string' ? JSON.parse(body) : body;
    if (Buffer.byteLength(JSON.stringify(input) || '') > 2048) return reply(413,'This request is too large.');
  } catch {return reply(400,'Please enter a valid email address and tick the consent box.');}
  const value = validatePayload(input);
  if (!value) return reply(400,'Please enter a valid email address and tick the consent box.');
  if (value.honeypot) return reply(400,'We couldn’t accept this request.');
  const listId = Number(env.BREVO_WAITLIST_LIST_ID);
  const templateId = Number(env.BREVO_DOI_TEMPLATE_ID);
  let redirect;
  try {redirect = new URL(env.WAITLIST_CONFIRMATION_URL);} catch {return reply(503,UNAVAILABLE);}
  if (!env.BREVO_API_KEY || !Number.isSafeInteger(listId) || listId < 1 || !Number.isSafeInteger(templateId) || templateId < 1 || redirect.protocol !== 'https:' || !allowedOrigins(env).has(redirect.origin)) return reply(503,UNAVAILABLE);
  if (throttle && limited(ip || 'unknown', now)) return reply(429,'Please wait a few minutes before trying again.');
  const providerHeaders = {'api-key':env.BREVO_API_KEY,'Content-Type':'application/json','Accept':'application/json'};
  try {
    // Fail closed if the selected template is inactive or is not recognised as DOI.
    const templateKey = `${templateId}:${listId}`;
    if (templateCheckedUntil <= now || checkedTemplateKey !== templateKey) {
      const check = await fetcher(`https://api.brevo.com/v3/smtp/templates/${templateId}`, {headers:providerHeaders,signal:AbortSignal.timeout(8000)});
      if (!check.ok) return reply(503,UNAVAILABLE);
      const template = await check.json();
      if (!validDoiTemplate(template)) return reply(503,UNAVAILABLE);
      checkedTemplateKey = templateKey;
      templateCheckedUntil = now + 300_000;
    }
    const result = await fetcher('https://api.brevo.com/v3/contacts/doubleOptinConfirmation', {
      method:'POST',headers:providerHeaders,signal:AbortSignal.timeout(8000),
      body:JSON.stringify({email:value.email,includeListIds:[listId],templateId,redirectionUrl:redirect.href}),
    });
    if (!result.ok) return reply(result.status === 429 ? 429 : 502, result.status === 429 ? 'Please wait a few minutes before trying again.' : 'We couldn’t complete your request. Please try again later.');
    return reply(202,'Check your inbox to confirm your email. You join the waitlist after you confirm.',{status:'confirmation_pending'});
  } catch {return reply(502,'We couldn’t connect to the waitlist. Please try again later.');}
}
