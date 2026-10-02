import {createHash} from 'node:crypto';
import {MAX_FILE_BYTES} from '../welcome/questionnaire-model.mjs';

const MIME_EXTENSIONS = new Map([
  ['application/pdf',/\.pdf$/i], ['image/jpeg',/\.jpe?g$/i], ['image/png',/\.png$/i],
]);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = maxBytes => ({ok:false,message:`Choose a valid PDF, JPG or PNG report of ${maxBytes / (1024 * 1024)} MiB or less.`});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit=0;bit<8;bit+=1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validPng(bytes) {
  if (bytes.length < 57 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return false;
  let offset=8,header=false,data=false;
  while (offset+12 <= bytes.length) {
    const length=bytes.readUInt32BE(offset),end=offset+12+length;
    if (end>bytes.length) return false;
    const type=bytes.toString('ascii',offset+4,offset+8);
    if (!/^[A-Za-z]{4}$/.test(type) || bytes.readUInt32BE(end-4)!==crc32(bytes.subarray(offset+4,end-4))) return false;
    if (!header) {
      if (type!=='IHDR' || length!==13) return false;
      const width=bytes.readUInt32BE(offset+8),height=bytes.readUInt32BE(offset+12);
      const bits=bytes[offset+16],colour=bytes[offset+17];
      const depths={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
      if (!width || !height || !depths[colour]?.includes(bits) || bytes[offset+18]!==0 || bytes[offset+19]!==0 || bytes[offset+20]>1) return false;
      header=true;
    } else if (type==='IHDR') return false;
    if (type==='IDAT') data=true;
    if (type==='IEND') return length===0 && data && end===bytes.length;
    offset=end;
  }
  return false;
}

function validJpeg(bytes) {
  if (bytes.length<12 || bytes[0]!==0xff || bytes[1]!==0xd8) return false;
  let offset=2,frame=false,scan=false;
  while (offset<bytes.length) {
    if (bytes[offset++]!==0xff) return false;
    while (bytes[offset]===0xff) offset+=1;
    const marker=bytes[offset++];
    if (marker===0xd9) return frame && scan && offset===bytes.length;
    if (marker===undefined || marker===0x00 || marker===0xd8 || (marker>=0xd0&&marker<=0xd7)) return false;
    if (marker===0x01) continue;
    if (offset+2>bytes.length) return false;
    const length=bytes.readUInt16BE(offset);
    if (length<2 || offset+length>bytes.length) return false;
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      if (length<8 || !bytes.readUInt16BE(offset+3) || !bytes.readUInt16BE(offset+5)) return false;
      frame=true;
    }
    offset+=length;
    if (marker===0xda) {
      if (!frame) return false;
      scan=true;
      // Entropy-coded data can contain escaped FF bytes and restart markers.
      while (offset<bytes.length) {
        if (bytes[offset]!==0xff) {offset+=1;continue;}
        if (bytes[offset+1]===0x00 || (bytes[offset+1]>=0xd0&&bytes[offset+1]<=0xd7)) {offset+=2;continue;}
        break;
      }
    }
  }
  return false;
}

function validPdf(bytes) {
  const text=bytes.toString('latin1');
  // Only screen the envelope here. PDF dictionaries, compressed objects and
  // attachments require inspectDocument() before persistence. Searching raw
  // bytes also rejects harmless C2PA metadata and visible document text.
  return /^%PDF-(?:1\.[0-7]|2\.0)[\t\r\n ]/.test(text) && /%%EOF[\t\r\n ]*$/.test(text);
}

export function validateReport(input,{maxBytes=MAX_FILE_BYTES}={}) {
  if (!Number.isInteger(maxBytes) || maxBytes<1 || maxBytes>10*1024*1024) throw new RangeError('Invalid report size limit');
  const reject=()=>invalid(maxBytes);
  if (input === null || input === undefined) return {ok:true,value:null};
  if (!plain(input) || Object.keys(input).length!==4 || !['name','type','size','base64'].every(key=>Object.hasOwn(input,key))) return reject();
  if (typeof input.name!=='string' || input.name.length>160 || Buffer.byteLength(input.name)>256
    || !input.name.trim() || input.name!==input.name.trim() || /[\x00-\x1f\x7f<>/\\]/.test(input.name)
    || !MIME_EXTENSIONS.get(input.type)?.test(input.name)
    || !Number.isInteger(input.size) || input.size<1 || input.size>maxBytes
    || typeof input.base64!=='string' || input.base64.length>Math.ceil(maxBytes/3)*4
    || input.base64.length%4!==0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)) return reject();
  const bytes=Buffer.from(input.base64,'base64');
  if (bytes.length!==input.size || bytes.toString('base64')!==input.base64) return reject();
  if (!(input.type==='application/pdf' ? validPdf(bytes) : input.type==='image/png' ? validPng(bytes) : validJpeg(bytes))) return reject();
  return {ok:true,value:{name:input.name,type:input.type,size:bytes.length,bytes,sha256:createHash('sha256').update(bytes).digest('hex')}};
}
