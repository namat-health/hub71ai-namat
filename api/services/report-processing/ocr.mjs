import {DefaultAzureCredential} from '@azure/identity';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function analyzeLayout(bytes,mime,{env=process.env,credential=new DefaultAzureCredential(),fetcher=fetch,pause=sleep,timeoutMs=150000}={}) {
  const endpoint=env.NAMAT_DOCUMENT_ENDPOINT;
  if (!/^https:\/\/[a-z0-9-]+\.cognitiveservices\.azure\.com\/$/.test(endpoint||'')) {
    const error=new Error('OCR is not configured.');error.code='ocr_unavailable';throw error;
  }
  const token=await credential.getToken('https://cognitiveservices.azure.com/.default');
  const headers={Authorization:`Bearer ${token.token}`};
  const deadline=performance.now()+Math.min(timeoutMs,150000);
  const signal=limit=>{const remaining=Math.floor(deadline-performance.now());if(remaining<=0){const e=new Error('OCR timed out.');e.code='ocr_timeout';throw e;}return AbortSignal.timeout(Math.min(limit,remaining));};
  let operation;
  try {
    const response=await fetcher(`${endpoint}documentintelligence/documentModels/prebuilt-layout:analyze?api-version=2024-11-30`,
      {method:'POST',headers:{...headers,'Content-Type':mime},body:bytes,signal:signal(30000),redirect:'error'});
    if (!response.ok) {const error=new Error('OCR service did not accept the report.');error.code=`ocr_http_${response.status}`;throw error;}
    const location=response.headers.get('operation-location');
    if (!location || new URL(location).origin!==new URL(endpoint).origin || !new URL(location).pathname.startsWith('/documentintelligence/documentModels/')) throw new Error('Invalid OCR operation.');
    operation=location;
    for (let attempt=0;attempt<75;attempt++) {
      await pause(Math.min(2000,Math.max(0,deadline-performance.now())));
      const poll=await fetcher(operation,{headers,signal:signal(15000),redirect:'error'});
      if (!poll.ok) {const error=new Error('OCR service could not return the report.');error.code=`ocr_http_${poll.status}`;throw error;}
      const result=await poll.json();
      if (result.status==='failed') {const error=new Error('OCR could not read this report.');error.code='ocr_failed';throw error;}
      if (result.status==='succeeded') {
        const pages=(result.analyzeResult?.pages||[]).map(page=>({number:page.pageNumber,
          text:(page.lines||[]).map(line=>line.content).join('\n'),
          lines:(page.lines||[]).map(line=>({text:line.content,bounds:line.polygon,unit:page.unit}))}));
        // Layout cells preserve rows when OCR emits each column as a separate line.
        for(const table of result.analyzeResult?.tables||[]) {
          const rows=new Map();
          for(const cell of table.cells||[]) {
            if(cell.kind==='columnHeader')continue;
            const page=cell.boundingRegions?.[0]?.pageNumber||table.boundingRegions?.[0]?.pageNumber;
            const key=`${page}:${cell.rowIndex}`;
            if(!rows.has(key))rows.set(key,{page,cells:[]});rows.get(key).cells.push(cell);
          }
          for(const row of rows.values()) {
            const page=pages.find(page=>page.number===row.page);if(!page)continue;
            const cells=row.cells.sort((a,b)=>a.columnIndex-b.columnIndex);
            page.lines.push({text:cells.map(cell=>cell.content).join(' '),bounds:cells[0].boundingRegions?.[0]?.polygon,fromTable:true});
          }
        }
        if (!pages.length || pages.length>50 || JSON.stringify(pages).length>3000000) throw new Error('OCR result exceeds limits.');
        return {pages,pageCount:pages.length,modelVersion:'prebuilt-layout-2024-11-30'};
      }
    }
    const error=new Error('OCR timed out.');error.code='ocr_timeout';throw error;
  } finally {
    // Delete provider-side result early; originals and drafts remain in our private stores.
    if (operation) await fetcher(operation,{method:'DELETE',headers,signal:AbortSignal.timeout(10000),redirect:'error'}).catch(()=>{});
  }
}
