import {parentPort,workerData} from 'node:worker_threads';
import {inflateSync} from 'node:zlib';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';

const {bytes,mime,limits}=workerData;
const fail=code=>{const error=new Error(code);error.documentCode=code;throw error;};
// These libraries receive bytes, never an upload URL. Deny accidental fetches
// as well; only locally installed font/CMap data may be opened by PDF.js.
globalThis.fetch=async()=>{throw new Error('Document network access is disabled');};

function pixels(width,height) {
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1
    ||width>limits.maxDimension||height>limits.maxDimension||width*height>limits.maxPixels)fail('image_too_large');
}

function validJumbf(bytes) {
  const b=Buffer.from(bytes);
  if(b.length<38||b.length>limits.maxC2paBytes||b.readUInt32BE(0)!==b.length||b.toString('ascii',4,8)!=='jumb')return false;
  // C2PA manifest-store JUMBF content-type UUID, not a filename heuristic.
  if(b.toString('ascii',12,16)!=='jumd'||b.readUInt32BE(8)<25
    ||b.subarray(16,32).toString('hex')!=='6332706100110010800000aa00389b71')return false;
  let offset=8,count=0;
  while(offset+8<=b.length){
    const length=b.readUInt32BE(offset);
    if(length<8||offset+length>b.length)return false;
    offset+=length;count++;
  }
  return offset===b.length&&count>=2;
}

async function inspectPdfStructure() {
  const P=await import('@cantoo/pdf-lib');
  let document;
  try {document=await P.PDFDocument.load(bytes,{throwOnInvalidObject:true,updateMetadata:false});}
  catch(error){if(error?.name==='EncryptedPDFError'||/encrypted/i.test(error?.message||''))fail('encrypted_pdf');throw error;}
  if(document.isEncrypted)fail('encrypted_pdf');
  const count=document.getPageCount();
  if(count<1)fail('invalid_document');
  if(count>limits.maxPages)fail('too_many_pages');
  const context=document.context;
  const resolve=value=>value instanceof P.PDFRef?context.lookup(value):value;
  const entry=(dict,key)=>resolve(dict.get(P.PDFName.of(key)));
  const name=value=>value instanceof P.PDFName?value.decodeText():null;
  const string=value=>value instanceof P.PDFName||value instanceof P.PDFString||value instanceof P.PDFHexString?value.decodeText():null;
  const objects=context.enumerateIndirectObjects();
  if(objects.length>limits.maxObjects)fail('document_too_complex');
  const dictionaries=[],streams=[],seen=new Set(),todo=objects.map(([,object])=>object);
  todo.push(document.catalog);
  let edges=0;
  const forbiddenKeys=new Set(['JS','JavaScript','AA','OpenAction','XFA','RichMedia','RichMediaContent','RichMediaSettings']);
  const actions=new Set(['GoTo','GoToR','GoToE','Launch','Thread','URI','Sound','Movie','Hide','Named','SubmitForm','ResetForm','ImportData','JavaScript','SetOCGState','Rendition','Trans','GoTo3DView','RichMediaExecute']);
  while(todo.length){
    if(++edges>limits.maxObjects*8)fail('document_too_complex');
    const object=resolve(todo.pop());
    if(!object||seen.has(object))continue;
    seen.add(object);
    if(seen.size>limits.maxObjects*4)fail('document_too_complex');
    if(object instanceof P.PDFRawStream){
      streams.push(object);todo.push(object.dict);
      // External stream data can reference files/URLs outside the upload.
      if(['F','FFilter','FDecodeParms'].some(key=>object.dict.has(P.PDFName.of(key))))fail('active_content');
      if(name(entry(object.dict,'Subtype'))==='Image'){
        const w=entry(object.dict,'Width'),h=entry(object.dict,'Height');
        pixels(w instanceof P.PDFNumber?w.asNumber():0,h instanceof P.PDFNumber?h.asNumber():0);
      }
    } else if(object instanceof P.PDFDict){
      dictionaries.push(object);
      if(name(entry(object,'Type'))==='Action'||actions.has(name(entry(object,'S'))))fail('active_content');
      if(['RichMedia','Movie','Sound','Screen','3D'].includes(name(entry(object,'Subtype'))))fail('active_content');
      for(const [key,value] of object.entries()){
        if(forbiddenKeys.has(key.decodeText()))fail('active_content');
        todo.push(value);
      }
    } else if(object instanceof P.PDFArray){
      for(let i=0;i<object.size();i++)todo.push(object.get(i));
    }
  }
  const allowedStreams=new Set();
  for(const dict of dictionaries){
    if(name(entry(dict,'Type'))!=='Filespec'&&!dict.has(P.PDFName.of('EF')))continue;
    if(name(entry(dict,'Type'))!=='Filespec'||name(entry(dict,'AFRelationship'))!=='C2PA_Manifest'
      ||string(entry(dict,'Subtype'))!=='application/c2pa'||dict.has(P.PDFName.of('RF')))fail('unsupported_attachment');
    const embedded=entry(dict,'EF');
    if(!(embedded instanceof P.PDFDict)||!embedded.entries().length)fail('unsupported_attachment');
    for(const [key,value] of embedded.entries()){
      const stream=resolve(value);
      if(!['F','UF'].includes(key.decodeText())||!(stream instanceof P.PDFRawStream)
        ||name(entry(stream.dict,'Type'))!=='EmbeddedFile'||name(entry(stream.dict,'Subtype'))!=='application/c2pa')fail('unsupported_attachment');
      if(allowedStreams.has(stream))continue;
      let content=stream.getContents();
      if(content.length>limits.maxC2paBytes)fail('unsupported_attachment');
      const filter=entry(stream.dict,'Filter');
      if(filter){
        // Bounded decompression, supporting the standard lossless PDF filter.
        const filters=filter instanceof P.PDFArray?filter.asArray().map(resolve):[filter];
        if(filters.length!==1||!['FlateDecode','Fl'].includes(name(filters[0]))||stream.dict.has(P.PDFName.of('DecodeParms')))fail('unsupported_attachment');
        try{content=inflateSync(content,{maxOutputLength:limits.maxC2paBytes});}catch{fail('unsupported_attachment');}
      }
      if(!validJumbf(content))fail('unsupported_attachment');
      allowedStreams.add(stream);
    }
  }
  for(const stream of streams){
    if(name(entry(stream.dict,'Type'))==='EmbeddedFile'&&!allowedStreams.has(stream))fail('unsupported_attachment');
  }
  // A scan can still carry a native-text letterhead or watermark. Remember
  // substantial page images so that a few such words do not suppress OCR.
  const rasterPages=new Set();
  for(const [index,page] of document.getPages().entries()){
    const pending=[page.node.Resources()],visited=new Set();
    while(pending.length){
      const resources=resolve(pending.pop());
      if(!(resources instanceof P.PDFDict)||visited.has(resources))continue;
      visited.add(resources);
      if(visited.size>1000)fail('document_too_complex');
      const xobjects=entry(resources,'XObject');
      if(!(xobjects instanceof P.PDFDict))continue;
      for(const [,reference] of xobjects.entries()){
        const object=resolve(reference);
        if(!(object instanceof P.PDFRawStream))continue;
        if(name(entry(object.dict,'Subtype'))==='Image'){
          const width=entry(object.dict,'Width'),height=entry(object.dict,'Height');
          if(width instanceof P.PDFNumber&&height instanceof P.PDFNumber&&width.asNumber()*height.asNumber()>=250000)rasterPages.add(index+1);
        }else if(name(entry(object.dict,'Subtype'))==='Form')pending.push(entry(object.dict,'Resources'));
      }
    }
  }
  return {pageCount:count,rasterPages};
}

const normalise=text=>text.normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').replace(/\s+/gu,' ').trim();
const round=value=>Math.round(value*100)/100;

function textLines(items,viewport,Util) {
  const spans=[];
  for(const item of items){
    if(typeof item.str!=='string')continue;
    const text=normalise(item.str);
    if(!text)continue;
    const transform=Util.transform(viewport.transform,item.transform);
    const height=Math.hypot(transform[2],transform[3]);
    const width=Math.abs(item.width*viewport.scale);
    const x=transform[4]-(transform[0]<0?width:0),y=transform[5]-height;
    if(![x,y,width,height].every(Number.isFinite))fail('invalid_document');
    spans.push({text,x,y,width,height,rtl:item.dir==='rtl'});
  }
  spans.sort((a,b)=>a.y-b.y||a.x-b.x);
  const rows=[];
  for(const span of spans){
    const row=rows.at(-1);
    if(row&&Math.abs(row.y-span.y)<=Math.max(2,Math.min(row.height,span.height)*0.35)){
      row.spans.push(span);row.height=Math.max(row.height,span.height);
    }else rows.push({y:span.y,height:span.height,spans:[span]});
  }
  return rows.map(row=>{
    const rtl=row.spans.filter(span=>span.rtl).length>row.spans.length/2;
    row.spans.sort((a,b)=>rtl?b.x-a.x:a.x-b.x);
    let text='',previous;
    for(const span of row.spans){
      const gap=previous?(rtl?previous.x-(span.x+span.width):span.x-(previous.x+previous.width)):0;
      text+=(previous?(gap>Math.max(12,span.height*1.5)?'\t':' '):'')+span.text;
      previous=span;
    }
    const x=Math.min(...row.spans.map(span=>span.x)),y=Math.min(...row.spans.map(span=>span.y));
    return {text,bounds:{x:round(x),y:round(y),width:round(Math.max(...row.spans.map(span=>span.x+span.width))-x),height:round(Math.max(...row.spans.map(span=>span.y+span.height))-y)}};
  });
}

async function inspectPdf() {
  const buffer=Buffer.from(bytes);
  if(!/^%PDF-(?:1\.[0-7]|2\.0)[\t\r\n ]/.test(buffer.toString('latin1',0,16))||!/%%EOF[\t\r\n ]*$/.test(buffer.toString('latin1',Math.max(0,buffer.length-1024))))fail('invalid_document');
  const {getDocument,Util}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const require=createRequire(import.meta.url),packageRoot=dirname(require.resolve('pdfjs-dist/package.json'));
  const task=getDocument({data:Uint8Array.from(bytes),stopAtErrors:true,verbosity:0,
    isEvalSupported:false,enableXfa:false,useSystemFonts:false,disableFontFace:true,useWorkerFetch:false,
    useWasm:false,isImageDecoderSupported:false,isOffscreenCanvasSupported:false,
    disableAutoFetch:true,disableStream:true,disableRange:true,maxImageSize:limits.maxPixels,
    standardFontDataUrl:join(packageRoot,'standard_fonts')+'/',cMapUrl:join(packageRoot,'cmaps')+'/',cMapPacked:true});
  try{
    const document=await task.promise;
    if(document.numPages>limits.maxPages)fail('too_many_pages');
    if(await document.getPermissions()!==null)fail('encrypted_pdf');
    const structure=await inspectPdfStructure();
    if(document.numPages!==structure.pageCount)fail('invalid_document');
    if(await document.hasJSActions()||await document.getJSActions()||await document.getOpenAction())fail('active_content');
    const pages=[];let characters=0,itemCount=0;
    for(let number=1;number<=document.numPages;number++){
      const page=await document.getPage(number),viewport=page.getViewport({scale:1});
      if(await page.getJSActions())fail('active_content');
      const content=await page.getTextContent({disableNormalization:true});
      itemCount+=content.items.length;
      if(itemCount>limits.maxTextItems)fail('document_too_complex');
      const lines=textLines(content.items,viewport,Util),text=lines.map(line=>line.text).join('\n');
      characters+=text.length;
      if(characters>limits.maxCharacters)fail('document_too_complex');
      pages.push({number,text,lines});
      page.cleanup();
    }
    return {pages,pageCount:pages.length,needsOcr:pages.some(page=>{
      const count=page.text.replace(/\s/g,'').length;
      return count<20||structure.rasterPages.has(page.number)&&count<200;
    })};
  }finally{await task.destroy();}
}

async function inspectImage() {
  const buffer=Buffer.from(bytes);
  if(mime==='image/png'?!buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    :buffer.length<4||buffer[0]!==255||buffer[1]!==216||buffer.at(-2)!==255||buffer.at(-1)!==217)fail('invalid_document');
  if(mime==='image/png'){
    let offset=8,header=false,data=false,finished=false;
    while(offset+12<=buffer.length){
      const length=buffer.readUInt32BE(offset),end=offset+12+length;
      if(end>buffer.length)fail('invalid_document');
      const type=buffer.toString('ascii',offset+4,offset+8);
      if(!/^[A-Za-z]{4}$/.test(type)||type==='acTL')fail('invalid_document');
      let crc=0xffffffff;
      for(const byte of buffer.subarray(offset+4,end-4)){
        crc^=byte;
        for(let bit=0;bit<8;bit++)crc=(crc>>>1)^(0xedb88320&-(crc&1));
      }
      if(((crc^0xffffffff)>>>0)!==buffer.readUInt32BE(end-4))fail('invalid_document');
      if(!header){if(type!=='IHDR'||length!==13)fail('invalid_document');header=true;}
      else if(type==='IHDR')fail('invalid_document');
      if(type==='IDAT')data=true;
      if(type==='IEND'){
        if(length!==0||!data||end!==buffer.length)fail('invalid_document');
        finished=true;break;
      }
      offset=end;
    }
    if(!finished)fail('invalid_document');
  }
  const {default:sharp}=await import('sharp');
  sharp.cache(false);sharp.concurrency(1);
  const image=sharp(buffer,{limitInputPixels:limits.maxPixels,failOn:'warning',animated:false});
  const metadata=await image.metadata();
  if(metadata.format!==(mime==='image/png'?'png':'jpeg'))fail('invalid_document');
  pixels(metadata.width,metadata.height);
  if((metadata.pages||1)!==1)fail('invalid_document');
  // metadata() alone accepts some truncated images. Decode every pixel while
  // keeping the original upload unchanged and bounding both dimensions/time.
  await image.timeout({seconds:10}).raw().toBuffer();
  return {pages:[{number:1,text:'',lines:[]}],pageCount:1,needsOcr:true};
}

try{
  const value=await (mime==='application/pdf'?inspectPdf():inspectImage());
  parentPort.postMessage({ok:true,value});
}catch(error){
  const code=error?.documentCode||(/pixel limit/i.test(error?.message||'')?'image_too_large':error?.name==='PasswordException'?'encrypted_pdf':'invalid_document');
  parentPort.postMessage({ok:false,code});
}
