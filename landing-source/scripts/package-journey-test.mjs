// Build a reproducible, allowlisted Azure Node deployment ZIP. Never archive
// the repository wholesale; private configuration and evidence stay local.
import {readFileSync,readdirSync,lstatSync,realpathSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,relative,dirname,join,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';

const digest = value => createHash('sha256').update(value).digest('hex');
const POSIX = path => path.split(sep).join('/');
const DEP_EXTENSIONS = /\.(?:js|mjs|cjs|json)$/;
const STATIC_EXTENSIONS = /\.(?:html|js|css|svg|webp|avif|png|jpe?g|woff2?|mp4)$/;
const SKIP_DIRS = new Set(['node_modules','test','tests','__tests__','fixtures','examples','docs']);

export function collectRuntimeFiles(root) {
  root=realpathSync(resolve(root));
  const files=new Map();
  const dependencies=new Map();
  const add=(path,content) => {
    if (!path || path.startsWith('/') || path.split('/').some(part=>!part || part==='..' || part.startsWith('.'))) throw new Error('Unsafe package path.');
    files.set(path,Buffer.isBuffer(content)?content:Buffer.from(content));
  };
  const read=path => {
    const file=resolve(root,path);
    if (!file.startsWith(root+sep) || realpathSync(file)!==file || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw new Error('Only regular allowlisted files can be packaged.');
    return readFileSync(file);
  };
  const pending=['server/journey-server.mjs','server/journey-access-client.js'];
  const allowedSource=path => /^(?:server|src\/lib|src\/data)\/[\w/-]+\.(?:mjs|js)$/.test(path);
  while(pending.length) {
    const path=pending.pop();
    if(files.has(path)) continue;
    if(!allowedSource(path)) throw new Error('Runtime import is outside the source allowlist.');
    const content=read(path);
    add(path,content);
    const imports=[...content.toString().matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g)].map(match=>match[1]);
    for(const specifier of imports) {
      if(specifier.startsWith('node:')) continue;
      if(specifier === 'pg') continue;
      if(!specifier.startsWith('.')) throw new Error('Unexpected runtime dependency.');
      pending.push(POSIX(relative(root,resolve(root,dirname(path),specifier))));
    }
  }
  const walk=(directory,visit,skip = () => false) => {
    if(realpathSync(directory)!==directory) throw new Error('Symlinks are not allowed in the deployment package.');
    for(const name of readdirSync(directory).sort()) {
      if(name.startsWith('.') || skip(name)) continue;
      const full=join(directory,name),stat=lstatSync(full);
      if(stat.isSymbolicLink()) throw new Error('Symlinks are not allowed in the deployment package.');
      if(stat.isDirectory()) walk(full,visit,skip);
      else if(stat.isFile()) visit(full);
    }
  };
  const dist=join(root,'dist-journey');
  const html=read('dist-journey/index.html').toString();
  if(!html.includes('noindex') || !/connect-src (?:'|&#39;)self(?:'|&#39;)/.test(html)) throw new Error('Build the connected, noindex journey before packaging.');
  for(const name of readdirSync(dist)) if(!['_astro','assets','index.html','favicon.svg'].includes(name)) throw new Error('Unexpected file in the connected build.');
  walk(dist,full=>{
    const path=POSIX(relative(root,full));
    if(!STATIC_EXTENSIONS.test(path)) throw new Error('Unexpected static file extension.');
    add(path,readFileSync(full));
  });
  const locate=(name,parent) => {
    let directory=dirname(parent);
    while(directory.startsWith(root)) {
      const candidate=join(directory,'node_modules',name,'package.json');
      if(existsSync(candidate)) return candidate;
      if(directory === root) break;
      directory=dirname(directory);
    }
    return null;
  };
  const dependencyQueue=[{name:'pg',parent:join(root,'package.json'),optional:false}];
  const visited=new Set();
  while(dependencyQueue.length) {
    const {name,parent,optional}=dependencyQueue.pop();
    const metadata=locate(name,parent);
    if(!metadata) {if(optional) continue; throw new Error('A locked runtime dependency is missing; run npm ci first.');}
    if(visited.has(metadata)) continue;
    visited.add(metadata);
    const packageRoot=dirname(metadata);
    const info=JSON.parse(readFileSync(metadata,'utf8'));
    if(info.name !== name) throw new Error('Runtime dependency identity mismatch.');
    dependencies.set(POSIX(relative(root,packageRoot)),{name,version:info.version});
    walk(packageRoot,full=>{
      if(DEP_EXTENSIONS.test(full) || /[/\\]LICENSE(?:\.\w+)?$/i.test(full)) add(POSIX(relative(root,full)),readFileSync(full));
    },entry=>SKIP_DIRS.has(entry));
    const optionalNames=new Set(Object.keys(info.optionalDependencies || {}));
    for(const dep of new Set([...Object.keys(info.dependencies || {}),...optionalNames])) dependencyQueue.push({name:dep,parent:metadata,optional:optionalNames.has(dep)});
    for(const dep of Object.keys(info.peerDependencies || {})) dependencyQueue.push({name:dep,parent:metadata,optional:info.peerDependenciesMeta?.[dep]?.optional === true});
  }
  const pg=[...dependencies.values()].find(value=>value.name === 'pg');
  add('package.json',JSON.stringify({name:'namat-journey-synthetic-test',version:'1.0.0',private:true,type:'module',
    engines:{node:'22.x'},scripts:{start:'node server/journey-server.mjs'},dependencies:{pg:pg.version}},null,2)+'\n');
  return {files:new Map([...files].sort(([a],[b])=>a.localeCompare(b,'en'))),dependencies:[...dependencies].sort(([a],[b])=>a.localeCompare(b,'en')).map(([path,value])=>({path,...value}))};
}

const CRC_TABLE=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++) n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc32=buffer=>{let crc=0xffffffff;for(const byte of buffer)crc=CRC_TABLE[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;};

export function deterministicZip(files) {
  if(files.size > 65535) throw new Error('Deployment package is too large.');
  const blocks=[],central=[];
  let offset=0;
  for(const [path,body] of [...files].sort(([a],[b])=>a.localeCompare(b,'en'))) {
    const name=Buffer.from(path),compressed=deflateRawSync(body,{level:9}),crc=crc32(body);
    const local=Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt16LE(33,12);
    local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
    blocks.push(local,name,compressed);
    const header=Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(20,6);header.writeUInt16LE(8,10);header.writeUInt16LE(33,14);
    header.writeUInt32LE(crc,16);header.writeUInt32LE(compressed.length,20);header.writeUInt32LE(body.length,24);header.writeUInt16LE(name.length,28);header.writeUInt32LE(offset,42);
    central.push(header,name);offset+=local.length+name.length+compressed.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.size,8);end.writeUInt16LE(files.size,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...blocks,directory,end]);
}

export function packageJourneyTest(root = process.cwd()) {
  const {files,dependencies}=collectRuntimeFiles(root);
  const zip=deterministicZip(files);
  const manifest={kind:'restricted-synthetic-journey-runtime',formatVersion:1,entrypoint:'server/journey-server.mjs',
    nodeMajor:22,workerIncluded:false,migrationsIncluded:false,fileCount:files.size,zipBytes:zip.length,zipSha256:digest(zip),dependencies,
    files:[...files].map(([path,body])=>({path,bytes:body.length,sha256:digest(body)}))};
  const directory=resolve(root,'output');
  mkdirSync(directory,{recursive:true});
  writeFileSync(join(directory,'namat-journey-synthetic-test.zip'),zip);
  writeFileSync(join(directory,'journey-hosted-test-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}

if(import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    if(process.argv.length > 2) throw new Error('This packager accepts no arguments.');
    const result=packageJourneyTest();
    console.log(JSON.stringify({file:'output/namat-journey-synthetic-test.zip',files:result.fileCount,bytes:result.zipBytes,sha256:result.zipSha256}));
  } catch {
    console.error('Journey test packaging failed. Check the connected build and installed locked dependencies.');
    process.exitCode=1;
  }
}
