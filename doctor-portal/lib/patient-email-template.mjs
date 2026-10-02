// Visual layer of the doctor-reviewed results email, on the Namat identity: Ledger v2.0
// tokens (stone ground, paper panels, desert-petrol cover, clay only as a small signal,
// watch amber only for status with ink text) and the website's type system (Archivo
// display, DM Sans body, IBM Plex Mono labels). The fonts load from namat.health, which
// serves them with open CORS; Gmail and Outlook fall back to Helvetica/Arial and Menlo.
// Copy and escaping live in patient-email.mjs; every string reaching this file is escaped.

const C = {
  stone: "#F0EDE3",
  paper: "#F9F7F0",
  bench: "#E6E1CF",
  line: "#D6D2C2",
  ink: "#172523",
  body: "#3B382E",
  soft: "#6B6857",
  petrol: "#143F3C",
  petrolHair: "#2E5B53",
  dune: "#F0E9D8",
  warmStone: "#BFB69B",
  clayLight: "#E2A98C",
  clayInk: "#96491F",
  amber: "#C79A3B",
  governance: "#B44A22",
};
const DISPLAY =
  "'Namat Archivo',Archivo,'Helvetica Neue',Helvetica,Arial,sans-serif";
const SANS =
  "'Namat DM Sans','DM Sans','Helvetica Neue',Helvetica,Arial,sans-serif";
const MONO =
  "'Namat Plex Mono','IBM Plex Mono',Menlo,Consolas,'Courier New',monospace";
const FONTS = [
  "@font-face{font-family:'Namat Archivo';font-style:normal;font-weight:100 900;font-stretch:62% 125%;src:url('https://namat.health/assets/archivo-original-latin.woff2') format('woff2')}",
  "@font-face{font-family:'Namat DM Sans';font-style:normal;font-weight:100 1000;src:url('https://namat.health/_astro/dm-sans-latin-wght-normal.Xz1IZZA0.woff2') format('woff2')}",
  "@font-face{font-family:'Namat Plex Mono';font-style:normal;font-weight:400;src:url('https://namat.health/_astro/ibm-plex-mono-latin-400-normal.DMJ8VG8y.woff2') format('woff2')}",
  "@font-face{font-family:'Namat Plex Mono';font-style:normal;font-weight:600;src:url('https://namat.health/_astro/ibm-plex-mono-latin-600-normal.BgSNZQsw.woff2') format('woff2')}",
].join("");
const RESPONSIVE =
  "@media (max-width:520px){.outer{padding:16px 8px 32px!important}.pad{padding-left:22px!important;padding-right:22px!important}.h1{font-size:31px!important;line-height:34px!important;letter-spacing:-1.1px!important}.stack{display:block!important;width:100%!important;text-align:left!important;padding-left:0!important;padding-top:10px!important}}" +
  "a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}";

const table = (content, style = "") =>
  `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;${style}">${content}</table>`;

const mono = (text, color = C.soft, extra = "") =>
  `<div style="font-family:${MONO};font-size:11px;line-height:16px;letter-spacing:1.3px;text-transform:uppercase;color:${color};${extra}">${text}</div>`;

// The site's wordmark: "namat" set wide in Archivo, a hairline beneath it and a square stop.
function wordmark(color, size) {
  const stop = Math.max(4, Math.round(size * 0.13));
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr><td style="font-family:${DISPLAY};font-stretch:125%;font-weight:700;font-size:${size}px;line-height:${size}px;letter-spacing:${(-size * 0.035).toFixed(1)}px;color:${color};white-space:nowrap;padding:0 0 ${Math.round(size * 0.14)}px;border-bottom:1px solid ${color}">namat</td><td valign="bottom" style="padding:0 0 0 ${Math.round(size * 0.1)}px;font-size:0;line-height:0"><div style="width:${stop}px;height:${stop}px;background:${color};font-size:0;line-height:0">&nbsp;</div></td></tr></table>`;
}

function section(number, label, inner, first = false) {
  return `<tr><td style="padding:${first ? "0" : "34px"} 0 0">${table(
    `<tr><td style="${first ? "" : `border-top:1px solid ${C.line};`}padding:${first ? "0" : "18px"} 0 0">${table(
      `<tr><td width="34" style="width:34px;font-family:${MONO};font-size:11px;line-height:16px;letter-spacing:1.3px;color:${C.clayInk}">${number}</td><td>${mono(label)}</td></tr>`,
    )}</td></tr><tr><td style="padding:16px 0 0">${inner}</td></tr>`,
  )}</td></tr>`;
}

function chip(flag) {
  if (flag === "high" || flag === "low")
    return `<span style="display:inline-block;background:${C.amber};color:${C.ink};font-family:${MONO};font-weight:600;font-size:10px;line-height:14px;letter-spacing:1px;text-transform:uppercase;padding:3px 9px;border-radius:999px;white-space:nowrap">${flag === "high" ? "Above" : "Below"} printed range</span>`;
  if (flag === "within")
    return `<span style="display:inline-block;background:${C.bench};color:${C.ink};font-family:${MONO};font-size:10px;line-height:14px;letter-spacing:1px;text-transform:uppercase;padding:3px 9px;border-radius:999px;white-space:nowrap">Within range</span>`;
  return "";
}

function results(labs) {
  return table(
    labs
      .map(
        (lab) =>
          `<tr><td valign="top" style="padding:15px 0;border-top:1px solid ${C.line}"><div style="font-family:${SANS};font-weight:600;font-size:16px;line-height:22px;color:${C.ink}">${lab.name}</div>${mono(lab.range ? `Printed range ${lab.range}` : "No range printed", C.soft, "font-size:10px;letter-spacing:1px;padding-top:5px")}</td><td class="stack" align="right" valign="top" style="padding:15px 0 15px 14px;border-top:1px solid ${C.line};white-space:nowrap"><div><span style="font-family:${DISPLAY};font-stretch:108%;font-weight:640;font-size:24px;line-height:26px;letter-spacing:-0.6px;color:${C.ink}">${lab.value}</span>${lab.unit ? `<span style="font-family:${MONO};font-size:11px;line-height:16px;color:${C.soft};padding-left:5px">${lab.unit}</span>` : ""}</div>${lab.chip ? `<div style="padding-top:7px">${chip(lab.chip)}</div>` : ""}</td></tr>`,
      )
      .join(""),
  );
}

function tests(items) {
  return table(
    items
      .map(
        (item, index) =>
          `<tr><td width="34" valign="top" style="width:34px;padding:16px 0;border-top:1px solid ${C.line};font-family:${MONO};font-size:12px;line-height:24px;color:${C.clayInk}">${String(index + 1).padStart(2, "0")}</td><td valign="top" style="padding:16px 0;border-top:1px solid ${C.line}"><div style="font-family:${DISPLAY};font-stretch:108%;font-weight:640;font-size:20px;line-height:25px;letter-spacing:-0.5px;color:${C.ink}">${item.name}</div>${item.reason ? `<div style="font-family:${SANS};font-size:15px;line-height:23px;color:${C.body};padding-top:4px">${item.reason}</div>` : ""}</td></tr>`,
      )
      .join(""),
  );
}

function option(item) {
  const detail = (label, value) =>
    `<tr><td width="92" valign="top" style="width:92px;padding:9px 0 0;font-family:${MONO};font-size:10px;line-height:20px;letter-spacing:1px;text-transform:uppercase;color:${C.soft}">${label}</td><td valign="top" style="padding:9px 0 0;font-family:${SANS};font-size:14px;line-height:21px;color:${C.body}">${value}</td></tr>`;
  return `<tr><td style="padding:0 0 12px">${table(
    `<tr><td bgcolor="${C.stone}" style="background:${C.stone};border:1px solid ${C.line};border-radius:18px;padding:20px 22px 18px">${table(
      `<tr><td valign="top">${mono(`Option ${item.rank} · ${item.mode}`, C.soft, "font-size:10px;letter-spacing:1.2px")}<div style="font-family:${DISPLAY};font-stretch:108%;font-weight:640;font-size:20px;line-height:25px;letter-spacing:-0.5px;color:${C.ink};padding-top:6px">${item.provider}</div></td><td class="stack" align="right" valign="top" style="padding-left:14px;white-space:nowrap"><div style="font-family:${DISPLAY};font-stretch:108%;font-weight:640;font-size:28px;line-height:30px;letter-spacing:-0.9px;color:${C.ink}">${item.total}</div>${mono("Listed total", C.soft, "font-size:10px;letter-spacing:1.2px;padding-top:4px")}</td></tr>`,
    )}${table(
      [
        detail("Covers", item.covers),
        detail("Visit fee", item.fee),
        item.turnaround ? detail("Results", item.turnaround) : "",
        item.places.length
          ? detail(
              "Where",
              item.places
                .map(
                  (place) =>
                    `<div style="padding:0 0 8px">${place.area ? `<span style="color:${C.ink};font-weight:600">${place.area}</span><br>` : ""}${place.address}${place.hours ? `<br><span style="color:${C.soft};font-size:13px">${place.hours}</span>` : ""}</div>`,
                )
                .join(""),
            )
          : "",
        item.homeAreas ? detail("Home visits", item.homeAreas) : "",
        item.sources.length
          ? detail(
              "Prices",
              `${item.sources.map((source) => `<a href="${source.href}" style="color:${C.petrol};text-decoration:underline;text-underline-offset:3px">${source.name}</a>`).join(" · ")}${item.checked ? `<span style="color:${C.soft}"> · checked ${item.checked}</span>` : ""}`,
            )
          : "",
      ].join(""),
      `margin-top:14px;border-top:1px solid ${C.line}`,
    )}</td></tr>`,
    "border-collapse:separate",
  )}</td></tr>`;
}

/** Returns the full HTML document for an already-escaped view model. */
export function renderPatientEmailHtml(m) {
  const cover = `<tr><td class="pad" bgcolor="${C.petrol}" style="background:${C.petrol};border-radius:24px 24px 0 0;padding:34px 40px 36px">${wordmark(C.dune, 30)}<div style="height:44px;line-height:44px;font-size:0">&nbsp;</div>${mono(m.coverEyebrow, C.warmStone)}<h1 class="h1" style="margin:14px 0 0;font-family:${DISPLAY};font-stretch:108%;font-weight:640;font-size:40px;line-height:43px;letter-spacing:-1.5px;color:${C.dune}">${m.headline}</h1></td></tr>`;

  const parts = [];
  if (m.message)
    parts.push(
      `<tr><td style="padding:0 0 34px">${table(`<tr><td bgcolor="${C.bench}" style="background:${C.bench};border-radius:18px;padding:22px 24px">${mono("A note from your doctor")}<p style="margin:10px 0 0;font-family:${SANS};font-size:18px;line-height:28px;color:${C.ink}">${m.message}</p>${m.doctorName ? mono(`— ${m.doctorName}`, C.soft, "padding-top:12px;font-size:10px") : ""}</td></tr>`, "border-collapse:separate")}</td></tr>`,
    );
  const sections = [];
  if (m.summary || m.findings.length)
    sections.push([
      "What your doctor found",
      `${m.summary ? `<p style="margin:0 0 ${m.findings.length ? 18 : 0}px;font-family:${SANS};font-size:18px;line-height:29px;color:${C.ink}">${m.summary}</p>` : ""}${table(
        m.findings
          .map(
            (finding) =>
              `<tr><td style="padding:14px 0;border-top:1px solid ${C.line}"><div style="font-family:${SANS};font-weight:600;font-size:16px;line-height:23px;color:${C.ink}">${finding.title}</div>${finding.reason ? `<div style="font-family:${SANS};font-size:15px;line-height:23px;color:${C.body};padding-top:3px">${finding.reason}</div>` : ""}</td></tr>`,
          )
          .join(""),
      )}`,
    ]);
  if (m.labs.length)
    sections.push([
      "Your results",
      `<p style="margin:0 0 14px;font-family:${SANS};font-size:14px;line-height:22px;color:${C.soft}">As printed on the reports you shared. Each range is the one printed by the lab that ran the test.</p>${results(m.labs)}`,
    ]);
  sections.push([
    "Tests your doctor recommends",
    m.tests.length
      ? tests(m.tests)
      : `<p style="margin:0;font-family:${SANS};font-size:16px;line-height:26px;color:${C.body}">Your doctor isn't recommending any further blood tests right now. That isn't an all-clear: if anything changes, reply to this email.</p>`,
  ]);
  if (m.draws)
    sections.push([
      m.draws.title,
      `${m.draws.note ? `<p style="margin:0 0 16px;font-family:${SANS};font-size:14px;line-height:22px;color:${C.soft}">${m.draws.note}</p>` : ""}${
        m.draws.options.length
          ? `${table(m.draws.options.map(option).join(""))}<p style="margin:6px 0 0;font-family:${SANS};font-size:13px;line-height:20px;color:${C.soft}">${m.draws.finePrint}</p>`
          : `<p style="margin:0;font-family:${SANS};font-size:16px;line-height:26px;color:${C.body}">${m.draws.empty}</p>`
      }`,
    ]);
  sections.forEach(([label, inner], index) => {
    parts.push(
      section(String(index + 1).padStart(2, "0"), label, inner, index === 0),
    );
  });
  parts.push(
    `<tr><td style="padding:36px 0 0">${table(
      `<tr><td style="border-top:1px solid ${C.line};padding:24px 0 0"><p style="margin:0;font-family:${SANS};font-size:16px;line-height:26px;color:${C.body}">If you have a question, just reply. I read every message.</p><p style="margin:18px 0 0;font-family:${SANS};font-size:16px;line-height:22px;color:${C.body}">Best,</p><p style="margin:4px 0 0;font-family:${DISPLAY};font-stretch:108%;font-weight:640;font-size:28px;line-height:30px;letter-spacing:-0.9px;color:${C.ink}">Borja</p>${mono("Founder, Namat", C.soft, "font-size:10px;padding-top:6px")}</td></tr>`,
    )}</td></tr>`,
  );
  const bodyCard = `<tr><td class="pad" bgcolor="${C.paper}" style="background:${C.paper};border-radius:0 0 24px 24px;padding:38px 40px 40px">${table(parts.join(""))}</td></tr>`;
  const header = `<tr><td style="padding:0 4px 14px">${table(
    `<tr><td valign="middle">${mono("Doctor review", C.soft, "font-size:10px")}</td><td align="right" valign="middle"><span style="display:inline-block;border:1px solid ${C.governance};border-radius:999px;padding:3px 10px;font-family:${MONO};font-size:10px;line-height:14px;letter-spacing:1px;text-transform:uppercase;color:${C.governance};white-space:nowrap">${m.notice}</span></td></tr>`,
  )}</td></tr>`;
  const footer = `<tr><td style="padding:26px 6px 0">${table(
    `<tr><td valign="middle">${wordmark(C.petrol, 18)}</td><td align="right" valign="middle">${mono("Abu Dhabi · namat.health", C.soft, "font-size:10px")}</td></tr><tr><td colspan="2" style="padding:16px 0 0">${mono(`Review reference ${m.reference}`, C.soft, "font-size:10px;letter-spacing:0.8px")}<p style="margin:8px 0 0;font-family:${SANS};font-size:12px;line-height:19px;color:${C.soft}">${m.notice}. ${m.prototype}</p></td></tr>`,
  )}</td></tr>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><meta name="x-apple-disable-message-reformatting"><title>${m.subject}</title><style>${FONTS}${RESPONSIVE}</style></head><body bgcolor="${C.stone}" style="margin:0;padding:0;background:${C.stone};color:${C.ink};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%"><div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.stone}">${m.preheader}</div>${table(
    `<tr><td class="outer" align="center" style="padding:30px 12px 44px"><!--[if mso]><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600"><tr><td><![endif]-->${table(
      `${header}${cover}${bodyCard}${footer}`,
      "max-width:600px;border-collapse:separate",
    )}<!--[if mso]></td></tr></table><![endif]--></td></tr>`,
    `background:${C.stone}`,
  )}</body></html>`;
}
