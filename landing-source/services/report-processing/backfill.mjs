import {createHash,randomBytes} from 'node:crypto';
import {inspectDocument} from './document.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const sourceColumns='s.id,s.fingerprint,s.report_metadata,s.report_files,s.report_total_size';
const eligible=`s.data_class='synthetic' AND s.fictional_confirmed=true AND s.expires_at>now()
  AND cardinality(s.report_files)>0
  AND NOT EXISTS(SELECT 1 FROM public.namat_reports r WHERE r.submission_id=s.id)`;

function sourceReports(row) {
  const metadata=row.report_metadata,files=row.report_files;
  if(!Array.isArray(metadata)||!Array.isArray(files)||files.length<1||files.length>3||metadata.length!==files.length)throw new Error('Invalid legacy reports.');
  let total=0;
  const reports=files.map((file,index)=>{
    const meta=metadata[index];
    if(!(file instanceof Uint8Array)||!meta||typeof meta!=='object')throw new Error('Invalid legacy report.');
    const bytes=Buffer.from(file),extensions={'application/pdf':/\.pdf$/i,'image/png':/\.png$/i,'image/jpeg':/\.jpe?g$/i};
    if(!bytes.length||bytes.length>10*1024*1024||!Number.isInteger(meta.size)||meta.size!==bytes.length
      ||typeof meta.sha256!=='string'||!/^[a-f0-9]{64}$/.test(meta.sha256)||digest(bytes)!==meta.sha256
      ||typeof meta.name!=='string'||meta.name!==meta.name.trim()||!meta.name.length||meta.name.length>160
      ||Buffer.byteLength(meta.name)>256||/[\x00-\x1f\x7f<>/\\]/.test(meta.name)||!extensions[meta.type]?.test(meta.name))throw new Error('Invalid legacy report.');
    total+=bytes.length;
    return {name:meta.name,mime:meta.type,size:meta.size,sha256:meta.sha256,bytes};
  });
  if(total!==row.report_total_size)throw new Error('Invalid legacy report size.');
  return reports;
}

const snapshot=(row,reports)=>JSON.stringify({fingerprint:row.fingerprint,
  reports:reports.map(({name,mime,size,sha256})=>({name,mime,size,sha256}))});

/**
 * Explicit operator utility; importing this module starts no work. Original
 * legacy bytes, receipts, fingerprints and email records are never modified.
 * Reports are staged before a short transaction. A private random session is
 * never exposed to a browser. If staging/linking is interrupted, the existing
 * expired-session cleanup removes detached copies after 24 hours.
 */
export async function backfillLegacyReports({pool,store,blobs,inspect=inspectDocument,limit=25}) {
  if(!Number.isInteger(limit)||limit<1||limit>100)throw new RangeError('Backfill limit must be between 1 and 100.');
  if(!pool?.query||!pool?.connect||!store?.createSession||!store?.createReport||!store?.markUploaded||!store?.linkReports||!blobs?.promote||typeof inspect!=='function')throw new TypeError('Backfill dependencies are required.');
  const counters={migrated:0,skipped:0,failed:0};
  const {rows:candidates}=await pool.query(`SELECT s.id FROM public.hackathon_welcome_submissions s
    WHERE ${eligible} ORDER BY s.created_at,s.id LIMIT $1`,[limit]);
  for(const candidate of candidates){
    let client,transaction=false;
    try{
      const {rows:[source]}=await pool.query(`SELECT ${sourceColumns} FROM public.hackathon_welcome_submissions s
        WHERE s.id=$1 AND ${eligible}`,[candidate.id]);
      if(!source){counters.skipped++;continue;}
      // Validate every hash before either parser work or writing any new copy.
      const originals=sourceReports(source),before=snapshot(source,originals);
      for(const report of originals)await inspect(Uint8Array.from(report.bytes),report.mime);
      const session=await store.createSession(digest(randomBytes(32)));
      const ids=[];
      for(const report of originals){
        const row=await store.createReport(session.id,{name:report.name,mime:report.mime,size:report.size,sha256:report.sha256});
        const blobKey=await blobs.promote(row.id,Buffer.from(report.bytes),report.mime);
        await store.markUploaded(row.id,session.id,{sha256:report.sha256,size:report.size,blobKey});
        // The upload store deliberately deduplicates identical name/type/byte
        // metadata within a session. Legacy arrays may contain that file twice.
        if(!ids.includes(row.id))ids.push(row.id);
      }
      client=await pool.connect();await client.query('BEGIN');transaction=true;
      // This serializes backfills without requiring UPDATE privileges on the
      // legacy table or holding a database transaction during blob/parser I/O.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`report-backfill:${source.id}`]);
      const {rows:[current]}=await client.query(`SELECT ${sourceColumns} FROM public.hackathon_welcome_submissions s
        WHERE s.id=$1 AND ${eligible}`,[source.id]);
      if(!current||snapshot(current,sourceReports(current))!==before){
        await client.query('ROLLBACK');transaction=false;counters.skipped++;continue;
      }
      await store.linkReports(client,source.id,session.id,ids);
      await client.query('COMMIT');transaction=false;counters.migrated++;
    }catch{
      if(transaction)await client.query('ROLLBACK').catch(()=>{});
      counters.failed++;
    }finally{client?.release();}
  }
  return counters;
}
