// Shared deterministic ZIP writer; fixed timestamps make identical inputs reproducible.
import {deflateRawSync} from 'node:zlib';

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
