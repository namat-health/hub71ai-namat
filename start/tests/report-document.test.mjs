import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PDFDocument,PDFName,PDFString,StandardFonts} from '@cantoo/pdf-lib';
import sharp from 'sharp';
import {inspectDocument,DocumentInspectionError,DOCUMENT_LIMITS} from '../services/report-processing/document.mjs';
import {validateReport} from '../src/hackathon/server/uploads.mjs';

const key=PDFName.of;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const error=code=>value=>value instanceof DocumentInspectionError&&value.code===code&&!/private-payload/.test(value.message);
const box=(type,contents)=>{
  const result=Buffer.alloc(contents.length+8);
  result.writeUInt32BE(result.length);result.write(type,4,'ascii');contents.copy(result,8);
  return result;
};
const description=(uuid,label)=>box('jumd',Buffer.concat([Buffer.from(uuid,'hex'),Buffer.from([3]),Buffer.from(label+'\0')]));
const c2pa=()=>box('jumb',Buffer.concat([
  description('6332706100110010800000aa00389b71','c2pa'),
  box('jumb',Buffer.concat([description('63326d6100110010800000aa00389b71','test-manifest'),box('bfdb',Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))])),
]));

async function pdf({pages=1,text=true,modify}={}) {
  const document=await PDFDocument.create();
  const font=await document.embedFont(StandardFonts.Helvetica);
  for(let i=0;i<pages;i++){
    const page=document.addPage([612,792]);
    if(text){
      page.drawText(`Fictional laboratory report - page ${i+1}`,{x:45,y:740,size:14,font});
      page.drawText('Glucose',{x:45,y:700,size:12,font});
      page.drawText('94 mg/dL',{x:260,y:700,size:12,font});
      page.drawText('Reference 70-99',{x:390,y:700,size:12,font});
    }
  }
  if(modify)await modify(document);
  return Buffer.from(await document.save());
}

function attach(document,{content=c2pa(),relationship='C2PA_Manifest',subtype='application/c2pa',streamSubtype='application/c2pa',compress=false}={}) {
  const context=document.context;
  const metadata={Type:'EmbeddedFile',Subtype:key(streamSubtype)};
  const stream=compress?context.flateStream(content,metadata):context.stream(content,metadata);
  const streamRef=context.register(stream);
  const spec=context.obj({Type:'Filespec',F:PDFString.of('Content Credentials'),UF:PDFString.of('Content Credentials'),
    AFRelationship:key(relationship),Subtype:PDFString.of(subtype),EF:{F:streamRef}});
  const specRef=context.register(spec);
  document.catalog.set(key('AF'),context.obj([specRef]));
  document.catalog.set(key('Names'),context.obj({EmbeddedFiles:{Names:[PDFString.of('Content Credentials'),specRef]}}));
}

test('extracts native text with stable page/line provenance and preserves original bytes',async()=>{
  const bytes=await pdf({pages:2});
  const before=digest(bytes),result=await inspectDocument(bytes,'application/pdf');
  assert.equal(result.pageCount,2);assert.equal(result.needsOcr,false);
  assert.deepEqual(result.pages.map(page=>page.number),[1,2]);
  assert.match(result.pages[0].text,/Glucose\t94 mg\/dL\tReference 70-99/);
  assert.match(result.pages[1].text,/page 2/);
  assert.ok(result.pages.every(page=>page.lines.every(line=>line.bounds&&Object.values(line.bounds).every(Number.isFinite))));
  assert.equal(digest(bytes),before);
});

test('allows plain and compressed C2PA streams containing SVG metadata without changing originals',async()=>{
  for(const compress of [false,true]){
    const bytes=await pdf({modify:doc=>attach(doc,{compress})}),before=digest(bytes);
    assert.equal(validateReport({name:'test.pdf',type:'application/pdf',size:bytes.length,base64:bytes.toString('base64')}).ok,true);
    assert.equal((await inspectDocument(bytes,'application/pdf')).pageCount,1);
    assert.equal(digest(bytes),before);
  }
});

test('visible PDF text can mention JavaScript, EmbeddedFile or SVG without becoming an action',async()=>{
  const bytes=await pdf({modify:doc=>doc.getPage(0).drawText('/JS /JavaScript /EmbeddedFile <svg >',{x:45,y:650,size:12})});
  assert.match((await inspectDocument(bytes,'application/pdf')).pages[0].text,/\/JavaScript/);
});

test('10 MiB envelope boundary remains bounded and canonical base64 is enforced',()=>{
  const prefix=Buffer.from('%PDF-1.7\n'),suffix=Buffer.from('\n%%EOF\n');
  const bytes=Buffer.concat([prefix,Buffer.alloc(DOCUMENT_LIMITS.maxBytes-prefix.length-suffix.length,32),suffix]);
  const report={name:'large.pdf',type:'application/pdf',size:bytes.length,base64:bytes.toString('base64')};
  assert.equal(validateReport(report,{maxBytes:DOCUMENT_LIMITS.maxBytes}).ok,true);
  assert.equal(validateReport(report).ok,false,'the legacy 2 MiB limit remains in place');
  assert.equal(validateReport({...report,base64:report.base64.slice(0,-4)+'===='},{maxBytes:DOCUMENT_LIMITS.maxBytes}).ok,false);
});

test('rejects document, page and compressed-object actions structurally',async()=>{
  for(const modify of [
    doc=>doc.catalog.set(key('OpenAction'),doc.context.obj([doc.getPage(0).ref,'Fit'])),
    doc=>doc.getPage(0).node.set(key('AA'),doc.context.obj({O:{S:'JavaScript',JS:PDFString.of('private-payload')}})),
    doc=>doc.catalog.set(key('Names'),doc.context.obj({JavaScript:{Names:[PDFString.of('test'),{S:'JavaScript',JS:PDFString.of('private-payload')}]}})),
    doc=>doc.context.register(doc.context.obj({Type:'Action',S:'Launch',F:PDFString.of('private-payload')})),
    doc=>doc.getPage(0).node.set(key('Annots'),doc.context.obj([{Type:'Annot',Subtype:'Link',Rect:[0,0,20,20],A:{S:'URI',URI:PDFString.of('https://example.invalid/private-payload')}}])),
  ])await assert.rejects(inspectDocument(await pdf({modify}),'application/pdf'),error('active_content'));
});

test('rejects unsupported, spoofed and orphaned attachments',async()=>{
  for(const modify of [
    doc=>attach(doc,{relationship:'Data',subtype:'application/octet-stream'}),
    doc=>attach(doc,{content:Buffer.from('private-payload')}),
    doc=>attach(doc,{streamSubtype:'application/octet-stream'}),
    doc=>doc.context.register(doc.context.stream(Buffer.from('private-payload'),{Type:'EmbeddedFile'})),
    doc=>doc.context.register(doc.context.obj({Type:'Filespec',F:PDFString.of('https://example.invalid/private-payload')})),
  ])await assert.rejects(inspectDocument(await pdf({modify}),'application/pdf'),error('unsupported_attachment'));
});

test('rejects malformed, oversized, password-protected and over-page-limit reports',async()=>{
  await assert.rejects(inspectDocument(Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF'),'application/pdf'),error('invalid_document'));
  await assert.rejects(inspectDocument(Buffer.alloc(DOCUMENT_LIMITS.maxBytes+1),'application/pdf'),error('too_large'));
  await assert.rejects(inspectDocument(await pdf({pages:51}),'application/pdf'),error('too_many_pages'));
  const encrypted=await pdf({modify:async doc=>{await doc.encrypt({userPassword:'private-payload',ownerPassword:'private-payload-owner'});}});
  await assert.rejects(inspectDocument(encrypted,'application/pdf'),error('encrypted_pdf'));
  await assert.rejects(inspectDocument(await pdf(),'image/png'),error('invalid_document'));
});

test('a blank page or image requires OCR and both PNG and JPEG are fully decoded',async()=>{
  const blank=await inspectDocument(await pdf({text:false}),'application/pdf');
  assert.equal(blank.needsOcr,true);assert.equal(blank.pages[0].text,'');
  for(const [format,mime]of [['png','image/png'],['jpeg','image/jpeg']]){
    const bytes=await sharp({create:{width:32,height:24,channels:3,background:'#ffffff'}})[format]().toBuffer();
    const result=await inspectDocument(bytes,mime);
    assert.equal(result.pageCount,1);assert.equal(result.needsOcr,true);assert.deepEqual(result.pages[0].lines,[]);
    await assert.rejects(inspectDocument(bytes.subarray(0,Math.floor(bytes.length/2)),mime),error('invalid_document'));
    await assert.rejects(inspectDocument(Buffer.concat([bytes,Buffer.from('<html>extra</html>')]),mime),error('invalid_document'));
  }
});

test('a scanned page with a native letterhead still requires OCR',async()=>{
  const bytes=await pdf({text:false,modify:async document=>{
    const scan=await document.embedPng(await sharp({create:{width:600,height:800,channels:3,background:'#fefefe'}}).png().toBuffer());
    document.getPage(0).drawImage(scan,{x:0,y:0,width:612,height:700});
    document.getPage(0).drawText('Fictional laboratory - scanned results',{x:45,y:740,size:12});
  }});
  const result=await inspectDocument(bytes,'application/pdf');
  assert.ok(result.pages[0].text.length>20);assert.equal(result.needsOcr,true);
});

test('enforces image pixel budgets and genuinely interrupts a parser deadline',async()=>{
  const oversized=await sharp({create:{width:5001,height:5000,channels:3,background:'#ffffff'}}).png().toBuffer();
  await assert.rejects(inspectDocument(oversized,'image/png'),error('image_too_large'));
  const start=Date.now();
  await assert.rejects(inspectDocument(await pdf(),'application/pdf',{timeoutMs:1}),error('inspection_timeout'));
  assert.ok(Date.now()-start<2000);
});

test('the supplied C2PA regression sample opens successfully when explicitly provided',async t=>{
  // The user's report is never copied into the repository or a test artifact.
  if(!process.env.NAMAT_REPORT_SAMPLE_PATH){t.skip('Set NAMAT_REPORT_SAMPLE_PATH to inspect a local sample');return;}
  const bytes=await readFile(process.env.NAMAT_REPORT_SAMPLE_PATH),before=digest(bytes);
  const result=await inspectDocument(bytes,'application/pdf');
  assert.equal(result.pageCount,3);assert.equal(result.needsOcr,false);assert.equal(digest(bytes),before);
});
