// Email clients receive system-font fallbacks and inline styles. Approved copy
// remains in each renderer; this file supplies only its visual presentation.
export const escapeEmailHtml = value => value.replace(/[&<>"']/g, character => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[character]));

const sans = 'Arial, Helvetica, sans-serif';
const colors = {forest:'#143f3c',cream:'#f9f7f0',stone:'#f0ede3',muted:'#566a65'};

// Optional static image origin is separate from recipient/template payloads.
// It must be a bare HTTPS origin matching the approved action/unsubscribe link.
// All recipients receive identical image URLs, without IDs or query parameters.
function staticAssetOrigin(value, link) {
  if (typeof value !== 'string' || !value || /[\s\x00-\x1f\x7f]/.test(value)) return '';
  try {
    const origin = new URL(value);
    const destination = new URL(link);
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash
      || origin.pathname !== '/' || ![origin.origin, `${origin.origin}/`].includes(value)
      || origin.origin !== destination.origin) return '';
    return origin.origin;
  } catch {return '';}
}

/** Rounded founder letter. Static images are optional and off by default. */
export function renderJourneyEmailLayout({subject,paragraphs,action,unsubscribeUrl}, {assetOrigin = process.env.JOURNEY_EMAIL_ASSET_ORIGIN} = {}) {
  const origin = staticAssetOrigin(assetOrigin, action?.url || unsubscribeUrl);
  const wordmark = origin
    ? `<img src="${escapeEmailHtml(origin)}/assets/email/namat-wordmark-forest.png" width="150" height="41" alt="Namat" border="0" referrerpolicy="no-referrer" style="display:block;width:150px;height:auto;max-width:100%;border:0;color:${colors.forest};font-family:${sans};font-size:28px;line-height:41px;font-weight:700">`
    : `<span style="display:inline-block;color:${colors.forest};font-family:${sans};font-size:33px;line-height:38px;font-weight:700;letter-spacing:-1.5px;border-bottom:1px solid ${colors.forest};padding-bottom:4px">namat<span aria-hidden="true" style="font-size:21px;letter-spacing:0">.</span></span>`;
  const portrait = origin ? `<!--[if mso]><img src="${escapeEmailHtml(origin)}/assets/email/borja-founder.jpeg" width="60" height="80" alt="" role="presentation" border="0" referrerpolicy="no-referrer" style="display:block;"><![endif]--><!--[if !mso]><!--><div style="width:80px;height:80px;overflow:hidden;border-radius:50%;background:${colors.cream}"><img src="${escapeEmailHtml(origin)}/assets/email/borja-founder.jpeg" width="80" height="107" alt="" role="presentation" border="0" referrerpolicy="no-referrer" style="display:block;width:80px;height:auto;max-width:none;transform:scale(1.45);transform-origin:40px 40px;color:${colors.forest};font-family:${sans};font-size:12px;line-height:16px"></div><!--<![endif]-->` : '';
  const body = paragraphs.map((part,index) => {
    if (part === null) return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:4px 0 30px"><tr><td bgcolor="${colors.forest}" style="background:${colors.forest};border-radius:14px;text-align:center;mso-padding-alt:15px 23px"><a href="${escapeEmailHtml(action.url)}" style="display:inline-block;border:1px solid ${colors.forest};border-radius:14px;padding:15px 23px;color:${colors.cream};font-family:${sans};font-size:16px;line-height:22px;font-weight:600;text-decoration:none;text-align:center">${escapeEmailHtml(action.label)}</a></td></tr></table>`;
    if (index === 0) return `<p style="margin:0 0 26px;color:${colors.forest};font-family:${sans};font-size:26px;line-height:35px;font-weight:600;letter-spacing:-0.6px;overflow-wrap:anywhere;word-break:break-word">${escapeEmailHtml(part)}</p>`;
    if (index === paragraphs.length - 1 && part === 'Best,\nBorja :)') {
      const signature = `<p style="margin:0;color:${colors.forest};font-family:${sans};font-size:16px;line-height:27px">Best,<br><span style="font-family:${sans};font-size:23px;line-height:35px;letter-spacing:-0.6px;font-weight:600">Borja :)</span></p>`;
      return origin ? `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:30px 0 0"><tr><td width="80" valign="middle" style="width:80px">${portrait}</td><td width="18" style="width:18px">&nbsp;</td><td valign="middle">${signature}</td></tr></table>` : `<div style="margin:30px 0 0">${signature}</div>`;
    }
    return `<p style="margin:0 0 22px;color:${colors.forest};font-family:${sans};font-size:16px;line-height:27px;font-weight:400">${escapeEmailHtml(part).replaceAll('\n','<br>')}</p>`;
  }).join('');
  const footer = unsubscribeUrl ? `<tr><td class="letter-pad" style="padding:0 42px 32px;border-radius:0 0 24px 24px"><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse"><tr><td style="padding-top:20px;border-top:1px solid #dfdfd3;font-family:${sans};font-size:12px;line-height:20px"><a href="${escapeEmailHtml(unsubscribeUrl)}" style="color:${colors.muted};text-decoration:underline;text-underline-offset:3px">Unsubscribe</a></td></tr></table></td></tr>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeEmailHtml(subject)}</title><style>@media(max-width:480px){.outer{padding:12px 6px!important}.letter-pad{padding-left:24px!important;padding-right:24px!important}}a:focus-visible{outline:3px solid #b36b3a;outline-offset:4px}</style></head><body bgcolor="${colors.stone}" style="margin:0;padding:0;background:${colors.stone};color:${colors.forest};font-family:${sans};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%"><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="${colors.stone}" style="width:100%;background:${colors.stone};border-collapse:collapse"><tr><td class="outer" align="center" style="padding:36px 12px"><!--[if mso]><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600"><tr><td><![endif]--><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="${colors.cream}" style="width:100%;max-width:600px;background:${colors.cream};border-collapse:separate;border-radius:24px;overflow:hidden"><tr><td class="letter-pad" style="border-radius:24px 24px 0 0;padding:38px 42px 30px">${wordmark}</td></tr><tr><td class="letter-pad" style="padding:26px 42px 42px">${body}</td></tr>${footer}</table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
}
