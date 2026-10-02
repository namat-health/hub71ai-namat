import {randomUUID} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {VERSION,QUESTIONS,createAnswers,updateAnswer,getPath,getQuestion,validateStep} from '../src/hackathon/welcome/questionnaire-model.mjs';

export const origin='https://start.namat.health';
export const env={HACKATHON_ENABLED:'true',HACKATHON_DATABASE_URL:'postgresql://tester:fictional@example.postgres.database.azure.com:5432/namat_journey',HACKATHON_ALLOWED_ORIGINS:origin};
export function answers(overrides={}) {
  let result=createAnswers();
  for(const [key,value]of Object.entries({goals:['curiosity'],age:'36',sex:'male',location:'dubai',curiosity:['other'],family:['none'],bloodwork:'no',...overrides}))result=updateAnswer(result,key,value);
  for(let n=0;n<40;n+=1){
    const missing=getPath(result).find(id=>QUESTIONS[id]&&validateStep(id,result));
    if(!missing)return result;
    const q=getQuestion(missing,result);result=updateAnswer(result,missing,q.multiple?[q.options[0].id]:q.options[0].id);
  }
  throw new Error('Incomplete fixture');
}
export const input=(overrides={})=>({version:VERSION,requestId:randomUUID(),dataClass:'synthetic',fictionalConfirmed:true,
  email:'fictional@example.invalid',firstName:'Fictional',answers:answers(),notes:{curiosity:'Fictional case only'},reports:[],...overrides});
export const request=(body,headers={})=>({method:'POST',headers:{origin,'content-type':'application/json',...headers},body});
export function pdf(){
  const content='BT /F1 12 Tf 40 740 Td (Fictional laboratory report - Glucose 94 mg/dL) Tj ET';
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let text='%PDF-1.7\n';const offsets=[0];
  for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
  const start=Buffer.byteLength(text);
  text+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(const offset of offsets.slice(1))text+=`${String(offset).padStart(10,'0')} 00000 n \n`;
  return Buffer.from(text+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
}
export const file=(bytes=pdf(),name='fictional.pdf',type='application/pdf')=>({name,type,size:bytes.length,base64:bytes.toString('base64')});
function crc(bytes){let c=0xffffffff;for(const byte of bytes){c^=byte;for(let i=0;i<8;i++)c=(c>>>1)^(0xedb88320&-(c&1));}return(c^0xffffffff)>>>0;}
export function png(){
  const chunk=(type,payload)=>{const b=Buffer.alloc(payload.length+12);b.writeUInt32BE(payload.length);b.write(type,4);payload.copy(b,8);b.writeUInt32BE(crc(b.subarray(4,-4)),b.length-4);return b;};
  const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,0,0,0]))),chunk('IEND',Buffer.alloc(0))]);
}
// A fully decodable one-pixel black JPEG, rather than marker-only test data.
export const jpeg=()=>Buffer.from('/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJUAB//Z','base64');
