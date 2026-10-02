// Backend-only import tracing and pinned runtime lock extraction.
import {posix} from 'node:path';
import ts from 'typescript';

export const RUNTIME_DEPENDENCIES=Object.freeze({
  '@azure/identity':'4.13.3','@azure/storage-blob':'12.34.0','@cantoo/pdf-lib':'2.11.1',
  'pdfjs-dist':'6.3.289','pg':'8.23.0','sharp':'0.35.5',
});

const sorted = map => new Map([...map].sort(([a], [b]) => a.localeCompare(b, 'en')));

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
