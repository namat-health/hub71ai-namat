import {readAcquisition, sanitizeAcquisition, withAcquisition} from '../lib/attribution.mjs';

// Carries approved campaign codes from the landing address to start links, so
// a visitor who browses first keeps their original acquisition. Codes live in
// this tab's sessionStorage only; nothing is sent until a start link is used.
const key = 'namat.acquisition';
let acquisition = readAcquisition(window.location.search);
try {
  if (Object.keys(acquisition).length) sessionStorage.setItem(key, JSON.stringify(acquisition));
  else acquisition = sanitizeAcquisition(JSON.parse(sessionStorage.getItem(key) || '{}'));
} catch {
  // Storage unavailable: only this page's own approved codes are carried.
}
if (Object.keys(acquisition).length) {
  document.querySelectorAll<HTMLAnchorElement>('a[data-start-link]').forEach(link => {
    link.href = withAcquisition(link.getAttribute('href') || '', acquisition);
  });
}
