import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {buildHackathonPackage, collectHackathonPackage, lockedRuntimePackage, moduleImports, staticReferences, verifyHackathonPackage,RUNTIME_DEPENDENCIES,REPORT_RUNTIME_FILES} from '../scripts/build-hackathon-site.mjs';
import {JOURNEY_VISUALS, getJourneyVisual} from '../src/lib/journey-visuals.mjs';

const photos = new Set(Object.values(JOURNEY_VISUALS).flatMap(visual => [
  visual.src,
  ...visual.srcSet.split(',').map(candidate => candidate.trim().split(/\s+/)[0]),
]));
const welcomePhoto = getJourneyVisual('welcome', {}).src;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'namat-hackathon-package-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const write = (path, text) => {mkdirSync(dirname(join(root, path)), {recursive: true}); writeFileSync(join(root, path), text);};
  write('package-lock.json', readFileSync(new URL('../package-lock.json', import.meta.url)));
  write('api/hackathon.mjs', "export {handler as default} from '../src/hackathon/server/http.mjs';");
  write('src/hackathon/server/http.mjs', "export async function handler() { return import('pg'); }");
  for(const path of REPORT_RUNTIME_FILES)write(path,path.endsWith('.mjs')?'export const fixture=true;':'Reviewer fixture');
  write('dist/start/welcome/index.html', `<html data-hackathon-questionnaire><meta name="robots" content="noindex"><meta http-equiv="Content-Security-Policy" content="connect-src 'self'"><link rel="stylesheet" href="/_astro/welcome.css"><script type="module" src="/_astro/welcome.js"></script></html>`);
  write('dist/_astro/welcome.js', `import './chunk.js'; const visuals = ${JSON.stringify(JOURNEY_VISUALS)};`);
  write('dist/_astro/chunk.js', "export const version = 'test';");
  write('dist/_astro/welcome.css', '@font-face {src:url(./font.woff2)}');
  write('dist/_astro/font.woff2', Buffer.from([1, 2, 3]));
  for (const path of photos) write(`dist${path}`, Buffer.from([0, 128, 255]));
  // These must never be copied, even when present beside a dependency.
  write('.env.hackathon.local', 'DO_NOT_COPY_SENTINEL');
  write('api/funnel.mjs', 'DO_NOT_COPY_SENTINEL');
  write('dist/index.html', 'DO_NOT_COPY_SENTINEL');
  write('dist/start/index.html', 'DO_NOT_COPY_SENTINEL');
  write('dist/assets/unrelated.webp', 'DO_NOT_COPY_SENTINEL');
  return {root, write};
}

test('standalone package follows static/dynamic asset imports and excludes other routes and secrets', t => {
  const {root, write} = fixture(t);
  const result = buildHackathonPackage(root);
  assert.deepEqual(verifyHackathonPackage(result.target), {files: 23 + photos.size, staticFiles: 5 + photos.size, runtimeFiles: 14, dependencies: 125});
  const files = collectHackathonPackage(root);
  for (const content of files.values()) assert.ok(!content.includes('DO_NOT_COPY_SENTINEL'));
  assert.ok(files.has('public/_astro/chunk.js'));
  assert.ok(files.has('public/_astro/font.woff2'));
  for (const photo of photos) assert.ok(files.has(`public${photo}`), `includes responsive photo ${photo}`);
  assert.equal(files.has('public/index.html'), false);
  const config = JSON.parse(files.get('vercel.json'));
  assert.equal(config.framework, null);
  assert.equal(config.functions['api/hackathon.mjs'].maxDuration,60);
  assert.match(config.functions['api/hackathon.mjs'].includeFiles,/services\/report-processing\/\*\*/);
  for(const path of REPORT_RUNTIME_FILES)assert.ok(files.has(path),`includes explicit worker/reviewer asset ${path}`);
  assert.deepEqual(config.redirects, [{source: '/', destination: '/welcome', permanent: false}]);
  assert.ok(config.headers[0].headers.some(header => header.key === 'X-Robots-Tag' && header.value.includes('noindex')));
  // Every invocation reads the latest source, including changes to the mailer.
  write('src/hackathon/server/http.mjs', "export async function handler() { const newest = true; return import('pg'); }");
  buildHackathonPackage(root);
  assert.match(readFileSync(join(result.target, 'src/hackathon/server/http.mjs'), 'utf8'), /newest/);
});

test('missing assets fail before replacing a verified package', t => {
  const {root} = fixture(t);
  const {target} = buildHackathonPackage(root);
  const oldManifest = readFileSync(join(target, 'package-manifest.json'));
  rmSync(join(root, `dist${welcomePhoto}`));
  assert.throws(() => buildHackathonPackage(root), /ENOENT/);
  assert.deepEqual(readFileSync(join(target, 'package-manifest.json')), oldManifest);
  verifyHackathonPackage(target);
});

test('symlinked source assets, permanent API imports and computed imports are rejected', t => {
  const {root, write} = fixture(t);
  const photo = join(root, `dist${welcomePhoto}`);
  rmSync(photo);
  symlinkSync(join(root, '.env.hackathon.local'), photo);
  assert.throws(() => collectHackathonPackage(root), /Only regular files/);
  rmSync(photo);
  write(`dist${welcomePhoto}`, 'restored');
  write('api/hackathon.mjs', "export {default} from './funnel.mjs';");
  assert.throws(() => collectHackathonPackage(root), /outside the hackathon allowlist/);
  assert.throws(() => moduleImports('await import(process.env.MODULE)', 'unsafe.mjs'), /Nonliteral import/);
});

test('verification detects added files and changed runtime content', t => {
  const {root, write} = fixture(t);
  const {target} = buildHackathonPackage(root);
  write('dist-hackathon/api/funnel.mjs', 'extra');
  assert.throws(() => verifyHackathonPackage(target), /Unexpected file/);
  rmSync(join(target, 'api/funnel.mjs'));
  write('dist-hackathon/src/hackathon/server/http.mjs', 'changed');
  assert.throws(() => verifyHackathonPackage(target), /Package file changed/);
});

test('runtime package lock retains pinned parser, image and Azure dependencies while excluding the website toolchain', () => {
  const source = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)));
  const {manifest, lock} = lockedRuntimePackage(source);
  assert.deepEqual(manifest.dependencies, RUNTIME_DEPENDENCIES);
  assert.deepEqual(manifest.engines, {node: '22.x'});
  assert.equal(lock.packages['node_modules/pg'].integrity, source.packages['node_modules/pg'].integrity);
  assert.ok(lock.packages['node_modules/pg-pool']);
  assert.ok(lock.packages['node_modules/pg-types']);
  for(const name of ['pdfjs-dist','sharp','@cantoo/pdf-lib','@azure/storage-blob','@azure/identity','@img/sharp-linux-x64','@img/sharp-libvips-linux-x64','@napi-rs/canvas-linux-x64-gnu'])assert.ok(lock.packages[`node_modules/${name}`]?.integrity,name);
  assert.equal(lock.packages['node_modules/astro'], undefined);
  assert.equal(lock.packages['node_modules/typescript'], undefined);
  assert.deepEqual(lockedRuntimePackage(lock).lock, lock);
  const altered=structuredClone(source);altered.packages['node_modules/sharp'].version='0.0.0';
  assert.throws(()=>lockedRuntimePackage(altered),/exact pinned/);
});

test('responsive image discovery separates srcset URLs from width descriptors', () => {
  const image = getJourneyVisual('welcome', {});
  const expected = image.srcSet.split(',').map(candidate => candidate.trim().split(/\s+/)[0].slice(1));
  assert.deepEqual([...staticReferences(`<img src="${image.src}" srcset="${image.srcSet}">`, 'start/welcome/index.html')].sort(), expected.sort());
  assert.deepEqual([...staticReferences(`export const srcSet = ${JSON.stringify(image.srcSet)};`, '_astro/welcome.js')].sort(), expected.sort());
});

test('a catalogue photo omitted from the browser dependency closure is rejected', t => {
  const {root, write} = fixture(t);
  const incomplete = Object.fromEntries(Object.entries(JOURNEY_VISUALS).filter(([, visual]) => visual.src !== welcomePhoto));
  write('dist/_astro/welcome.js', `import './chunk.js'; const visuals = ${JSON.stringify(incomplete)};`);
  assert.throws(() => collectHackathonPackage(root), /must reference its dynamic photo/);
});
