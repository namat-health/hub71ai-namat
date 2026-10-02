import {PDFDocument,StandardFonts} from '@cantoo/pdf-lib';
import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {input,answers} from '../tests/hackathon-fixtures.mjs';
const base='http://127.0.0.1:4350',headers={'Content-Type':'application/json',Origin:base};
const document=await PDFDocument.create(),page=document.addPage(),font=await document.embedFont(StandardFonts.Helvetica);
const lines=['FICTIONAL LAB REPORT - demonstration only','Collection date: 01/10/2026','Glucose 94 mg/dL 70 - 99','HbA1c 5.4 % 4.0 - 5.6','Ferritin 85 ng/mL 30 - 400','CRP <5 mg/L <5'];
lines.forEach((text,i)=>page.drawText(text,{x:45,y:760-i*32,size:14,font}));
const bytes=Buffer.from(await document.save());
await mkdir('output/report-processing-2026-10-01',{recursive:true});
await writeFile('output/report-processing-2026-10-01/fictional-lab-report.pdf',bytes);
async function json(path,body,extra={}){const response=await fetch(base+path,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(`${path}: ${response.status} ${data.message}`);return data;}
const session=await json('/api/reports/sessions',{}),auth={Authorization:`Bearer ${session.token}`,'X-Report-Session':session.sessionId};
const files=[{name:'fictional-lab-report.pdf',bytes}];
if(process.env.NAMAT_REPORT_SAMPLE_PATH)files.push({name:'example.pdf',bytes:await readFile(process.env.NAMAT_REPORT_SAMPLE_PATH)});
const ids=[];
for(const file of files){const created=await json('/api/reports/uploads',{name:file.name,type:'application/pdf',size:file.bytes.length,sha256:createHash('sha256').update(file.bytes).digest('hex')},auth);
 const uploaded=await fetch(new URL(created.uploadUrl,base),{method:'PUT',headers:{Origin:base,'Content-Type':'application/pdf','x-ms-blob-type':'BlockBlob'},body:file.bytes});if(!uploaded.ok)throw new Error('File upload failed.');
 await json(`/api/reports/uploads/${created.reportId}/complete`,{},auth);ids.push(created.reportId);}
const saved=await json('/api/hackathon',input({answers:answers({bloodwork:'yes'}),reportIds:ids,reportSession:{id:session.sessionId,token:session.token}}));
const result={...saved,reportIds:ids,preview:`${base}/review`,seededAt:new Date().toISOString()};
await writeFile('output/report-processing-2026-10-01/local-preview.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
