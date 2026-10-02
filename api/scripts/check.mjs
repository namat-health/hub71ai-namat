import {readdirSync} from 'node:fs';
import {resolve,relative,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {assertSourceRevision} from '../services/namat-api/revision.mjs';

const root=resolve(import.meta.dirname,'..');
const files=[];
function walk(directory) {
  for(const entry of readdirSync(directory,{withFileTypes:true})) {
    if(entry.name.startsWith('.')||['node_modules','output','coverage'].includes(entry.name))continue;
    const path=join(directory,entry.name);
    if(entry.isDirectory())walk(path);
    else if(entry.isFile()&&path.endsWith('.mjs'))files.push(relative(root,path));
  }
}
walk(root);
for(const file of files.sort()) {
  const result=spawnSync(process.execPath,['--check',file],{cwd:root,stdio:'inherit'});
  if(result.status!==0)process.exit(result.status||1);
}
const declarations=spawnSync(process.execPath,[
  'node_modules/typescript/bin/tsc','--noEmit','--strict','--module','NodeNext','--moduleResolution','NodeNext',
  '--target','ES2022','services/namat-api/contracts/client.d.ts','services/namat-api/client.d.mts','services/report-processing/contracts/client.d.ts',
],{cwd:root,stdio:'inherit'});
if(declarations.status!==0)process.exit(declarations.status||1);
const revision=assertSourceRevision();
console.log(`Checked ${files.length} JavaScript modules, client declarations and source revision ${revision}.`);
