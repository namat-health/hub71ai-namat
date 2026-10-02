// Assemble the temporary event site from the current Astro build. This script
// does not build, install dependencies, read environment files or deploy.
import {createHash} from 'node:crypto';
import {existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, posix, relative, resolve, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import ts from 'typescript';
import {JOURNEY_VISUALS} from '../src/lib/journey-visuals.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = 'api/hackathon.mjs';
const PAGE = 'welcome/index.html';
export const RUNTIME_DEPENDENCIES=Object.freeze({
  '@azure/identity':'4.13.3','@azure/storage-blob':'12.34.0','@cantoo/pdf-lib':'2.11.1',
  'pdfjs-dist':'6.3.289','pg':'8.23.0','sharp':'0.35.5',
});
export const REPORT_RUNTIME_FILES=Object.freeze([
  'service.mjs','blob.mjs','local-blob.mjs','document.mjs','document-worker.mjs','store.mjs','worker.mjs','ocr.mjs','extract.mjs',
  'review.html','review.mjs','review.css',
].map(name=>`services/report-processing/${name}`));
export const SHARED_API_RUNTIME_FILES=Object.freeze([
  'src/hackathon/server/shared-api.mjs','src/hackathon/server/portal-data.mjs',
]);
const STATIC_EXTENSION = /\.(?:js|css|woff2?|webp|avif|png|jpe?g|svg|ico|mp4)$/;
// The questionnaire switches scenes and demographics in the browser. Every
// responsive source in its visual catalogue must remain in the static closure.
const REQUIRED_PHOTOS = new Set(Object.values(JOURNEY_VISUALS).flatMap(visual => [
  visual.src,
  ...visual.srcSet.split(',').map(candidate => candidate.trim().split(/\s+/)[0]),
]));
const sharedModules = new Set(['src/hackathon/welcome/questionnaire-model.mjs', 'src/hackathon/welcome/questionnaire-v1.mjs', 'src/lib/overview-preview.mjs', 'src/lib/overview-preview-v4.mjs', 'server/journey-email-layout.mjs']);
const runtimePath = path => path === ENTRY || /^src\/hackathon\/server\/[\w-]+\.mjs$/.test(path) || sharedModules.has(path) || REPORT_RUNTIME_FILES.includes(path);
const staticPath = path => path === 'favicon.svg' || /^(?:_astro|assets)\/[\w./-]+$/.test(path) && STATIC_EXTENSION.test(path);
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const sorted = map => new Map([...map].sort(([a], [b]) => a.localeCompare(b, 'en')));

function safePath(path) {
  if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some(part => !part || part === '..' || part.startsWith('.'))) {
    throw new Error(`Unsafe package path: ${path}`);
  }
  return path;
}

function readRegular(root, path) {
  safePath(path);
  const file = resolve(root, path);
  // Checking realpath also rejects symlinked parent directories.
  if (!file.startsWith(root + sep) || realpathSync(file) !== file || !lstatSync(file).isFile()) {
    throw new Error(`Only regular files inside the source directory may be copied: ${path}`);
  }
  return readFileSync(file);
}

export function moduleImports(text, filename) {
  const tree = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (tree.parseDiagnostics.length) throw new Error(`Cannot parse module: ${filename}`);
  const imports = new Set();
  const literal = node => {
    if (!node || !ts.isStringLiteralLike(node)) throw new Error(`Nonliteral import requires explicit packaging support: ${filename}`);
    imports.add(node.text);
  };
  const visit = node => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) && node.moduleSpecifier) literal(node.moduleSpecifier);
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) literal(node.arguments[0]);
      if (ts.isIdentifier(node.expression) && node.expression.text === 'require') throw new Error(`Unexpected CommonJS import: ${filename}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return imports;
}

export function staticReferences(text, path) {
  const found = new Set();
  const add = ref => {
    const clean = ref.split(/[?#]/, 1)[0];
    const name = clean.startsWith('/') ? clean.slice(1) : posix.join(posix.dirname(path), clean);
    safePath(name);
    if (!staticPath(name)) throw new Error(`Unexpected static dependency in ${path}: ${ref}`);
    found.add(name);
  };
  // Includes HTML attributes, inline CSS and JS string/template literals used
  // when the questionnaire switches its left-hand image after an answer.
  for (const [, ref] of text.matchAll(/["'`(\s,](\/(?:_astro|assets)\/[^\s"'`()<>;,]+|\/favicon\.svg)(?=["'`)\s,;<>]|$)/g)) add(ref);
  for (const [, ref] of text.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)) {
    if (/^(?:data:|https?:|#)/.test(ref)) continue;
    add(ref);
  }
  if (/\.js$/.test(path)) {
    for (const specifier of moduleImports(text, path)) {
      if (!specifier.startsWith('.')) throw new Error(`Unexpected browser import in ${path}: ${specifier}`);
      add(specifier);
    }
  }
  return found;
}

export function runtimeClosure(read) {
  const files = new Map();
  // Worker entrypoints constructed with new URL() and reviewer assets loaded
  // with readFile() are deliberately explicit; import tracing cannot see them.
  const pending = [ENTRY,...REPORT_RUNTIME_FILES,...SHARED_API_RUNTIME_FILES];
  const externals = new Set();
  while (pending.length) {
    const path = pending.pop();
    if (files.has(path)) continue;
    if (!runtimePath(path)) throw new Error(`Runtime import is outside the hackathon allowlist: ${path}`);
    const content = read(path);
    files.set(path, content);
    if(!path.endsWith('.mjs'))continue;
    for (const specifier of moduleImports(content.toString(), path)) {
      if (specifier.startsWith('node:')) continue;
      const packageName=specifier.startsWith('@')?specifier.split('/').slice(0,2).join('/'):specifier.split('/')[0];
      if (Object.hasOwn(RUNTIME_DEPENDENCIES,packageName)) { externals.add(packageName); continue; }
      if (!specifier.startsWith('.')) throw new Error(`Unexpected runtime dependency: ${specifier}`);
      const dependency = posix.join(posix.dirname(path), specifier);
      safePath(dependency);
      pending.push(dependency);
    }
  }
  if (!externals.has('pg')) throw new Error('Expected the hackathon PostgreSQL dependency.');
  return sorted(files);
}

export function lockedRuntimePackage(sourceLock) {
  if (sourceLock.lockfileVersion !== 3 || Object.entries(RUNTIME_DEPENDENCIES).some(([name,version])=>
    sourceLock.packages?.[`node_modules/${name}`]?.version!==version||sourceLock.packages?.['']?.dependencies?.[name]!==version)) {
    throw new Error('A version 3 lockfile with the exact pinned runtime dependencies is required.');
  }
  const manifest = {name: 'namat-hackathon', version: '0.0.0', private: true, type: 'module', engines: {node: '22.x'}, dependencies: {...RUNTIME_DEPENDENCIES}};
  const packages = new Map();
  const locate = (name, parent) => {
    if (!/^(@[\w-]+\/)?[\w.-]+$/.test(name)) throw new Error('Unsafe dependency name.');
    let directory = parent;
    while (true) {
      const key = posix.join(directory, 'node_modules', name);
      if (sourceLock.packages[key]) return key;
      if (!directory) return null;
      directory = posix.dirname(directory);
      if (directory === '.') directory = '';
    }
  };
  const pending = Object.keys(RUNTIME_DEPENDENCIES).map(name=>({name,parent:'',optional:false}));
  while (pending.length) {
    const {name, parent, optional} = pending.pop();
    const key = locate(name, parent);
    if (!key) { if (optional) continue; throw new Error(`Missing locked dependency: ${name}`); }
    if (packages.has(key)) continue;
    const entry = sourceLock.packages[key];
    if (!entry.version || !entry.integrity || !/^https:\/\/registry\.npmjs\.org\//.test(entry.resolved || '') || entry.link) {
      throw new Error(`Only integrity-locked npm registry dependencies may be included: ${key}`);
    }
    packages.set(key, entry);
    const optionalNames = new Set(Object.keys(entry.optionalDependencies || {}));
    for (const dep of new Set([...Object.keys(entry.dependencies || {}), ...optionalNames])) pending.push({name: dep, parent: key, optional: optionalNames.has(dep)});
    for (const dep of Object.keys(entry.peerDependencies || {})) pending.push({name: dep, parent: key, optional: entry.peerDependenciesMeta?.[dep]?.optional === true});
  }
  const root = {name: manifest.name, version: manifest.version, dependencies: manifest.dependencies, engines: manifest.engines};
  return {manifest, lock: {name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true, packages: {'': root, ...Object.fromEntries(sorted(packages))}}};
}

export function vercelConfig() {
  return {
    $schema: 'https://openapi.vercel.sh/vercel.json', framework: null,
    installCommand: 'npm ci --ignore-scripts --no-audit --no-fund',
    buildCommand: '', outputDirectory: 'public', cleanUrls: true, trailingSlash: false,
    functions: {'api/hackathon.mjs': {maxDuration: 60,
      includeFiles:'{services/report-processing/**,node_modules/pdfjs-dist/**,node_modules/@cantoo/pdf-lib/**,node_modules/sharp/**,node_modules/@img/**,node_modules/@napi-rs/**}'}},
    redirects: [{source: '/', destination: '/welcome', permanent: false}],
    headers: [{source: '/(.*)', headers: [
      {key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive'},
      {key: 'X-Content-Type-Options', value: 'nosniff'},
      {key: 'Referrer-Policy', value: 'no-referrer'},
      {key: 'X-Frame-Options', value: 'DENY'},
      {key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()'},
      {key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"},
    ]}],
  };
}

export function collectHackathonPackage(root = REPO) {
  root = realpathSync(root);
  const dist = realpathSync(join(root, 'dist'));
  if (dist !== join(root, 'dist')) throw new Error('The compiled output cannot be a symlink.');
  const page = readRegular(dist, PAGE);
  if (!page.includes('data-hackathon-questionnaire') || !/noindex/.test(page.toString()) || !/connect-src (?:'|&#39;)self(?:'|&#39;)/.test(page.toString())) {
    throw new Error('The current dist build must contain the noindex hackathon questionnaire with a same-origin API.');
  }
  const files = runtimeClosure(path => readRegular(root, path));
  files.set('public/welcome/index.html', page);
  const pending = [...staticReferences(page.toString(), PAGE)];
  while (pending.length) {
    const path = pending.pop();
    if (files.has(`public/${path}`)) continue;
    const content = readRegular(dist, path);
    files.set(`public/${path}`, content);
    if (/\.(?:js|css)$/.test(path)) pending.push(...staticReferences(content.toString(), path));
  }
  for (const photo of REQUIRED_PHOTOS) if (!files.has(`public${photo}`)) throw new Error(`The current questionnaire must reference its dynamic photo: ${photo}`);
  const {manifest, lock} = lockedRuntimePackage(JSON.parse(readRegular(root, 'package-lock.json')));
  files.set('package.json', json(manifest));
  files.set('package-lock.json', json(lock));
  files.set('vercel.json', json(vercelConfig()));
  const inventory = [...sorted(files)].map(([path, content]) => ({path, bytes: content.length, sha256: hash(content)}));
  files.set('package-manifest.json', json({format: 1, sourcePage: `dist/${PAGE}`, files: inventory}));
  return sorted(files);
}

export function verifyHackathonPackage(target = join(REPO, 'dist-hackathon')) {
  target = realpathSync(target);
  const paths = [];
  const walk = directory => {
    for (const name of readdirSync(directory).sort()) {
      const full = join(directory, name), stat = lstatSync(full);
      const path = relative(target, full).split(sep).join('/');
      safePath(path);
      if (stat.isSymbolicLink()) throw new Error(`Symlink in package: ${path}`);
      if (stat.isDirectory()) walk(full);
      else if (stat.isFile()) paths.push(path);
      else throw new Error(`Unsupported package entry: ${path}`);
    }
  };
  walk(target);
  const read = path => readRegular(target, path);
  const inventory = JSON.parse(read('package-manifest.json'));
  if (inventory.format !== 1 || !Array.isArray(inventory.files)) throw new Error('Invalid package manifest.');
  const expected = new Set(['package-manifest.json']);
  for (const item of inventory.files) {
    safePath(item.path);
    if (expected.has(item.path)) throw new Error('Duplicate file in package manifest.');
    expected.add(item.path);
    const content = read(item.path);
    if (content.length !== item.bytes || hash(content) !== item.sha256) throw new Error(`Package file changed: ${item.path}`);
  }
  if (paths.length !== expected.size || paths.some(path => !expected.has(path))) throw new Error('Unexpected file in deployment package.');
  const runtime = runtimeClosure(read);
  const allowedGenerated = new Set(['package.json', 'package-lock.json', 'vercel.json', 'package-manifest.json']);
  const staticFiles = new Set(['public/welcome/index.html']);
  const pending = [...staticReferences(read('public/welcome/index.html').toString(), PAGE)];
  while (pending.length) {
    const path = pending.pop(), full = `public/${path}`;
    if (staticFiles.has(full)) continue;
    const content = read(full);
    staticFiles.add(full);
    if (/\.(?:js|css)$/.test(path)) pending.push(...staticReferences(content.toString(), path));
  }
  for (const path of paths) if (!runtime.has(path) && !staticFiles.has(path) && !allowedGenerated.has(path)) throw new Error(`File is outside the package dependency closure: ${path}`);
  for (const photo of REQUIRED_PHOTOS) if (!staticFiles.has(`public${photo}`)) throw new Error(`Missing dynamic photo: ${photo}`);
  const metadata = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  const locked = lockedRuntimePackage(lock);
  if (JSON.stringify(metadata) !== JSON.stringify(locked.manifest) || JSON.stringify(lock) !== JSON.stringify(locked.lock)) throw new Error('Runtime package or lockfile includes unexpected dependencies.');
  if (JSON.stringify(JSON.parse(read('vercel.json'))) !== JSON.stringify(vercelConfig())) throw new Error('Unexpected deployment configuration.');
  return {files: paths.length, staticFiles: staticFiles.size, runtimeFiles: runtime.size, dependencies: Object.keys(lock.packages).length - 1};
}

export function buildHackathonPackage(root = REPO) {
  root = realpathSync(root);
  const target = join(root, 'dist-hackathon');
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new Error('Refusing to replace a symlinked output directory.');
  // Collect first so a missing asset/import leaves any prior package intact.
  const files = collectHackathonPackage(root);
  const staging = mkdtempSync(join(root, '.hackathon-package-'));
  try {
    for (const [path, content] of files) {
      const destination = join(staging, path);
      mkdirSync(dirname(destination), {recursive: true});
      writeFileSync(destination, content);
    }
    const result = verifyHackathonPackage(staging);
    rmSync(target, {recursive: true, force: true});
    renameSync(staging, target);
    return {target, ...result};
  } finally {
    rmSync(staging, {recursive: true, force: true});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = buildHackathonPackage();
  console.log(`Hackathon package ready in ${result.target}: ${result.staticFiles} static files, ${result.runtimeFiles} runtime modules, ${result.dependencies} locked dependencies. No deployment performed.`);
}
