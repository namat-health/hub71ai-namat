import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractObservations} from '../services/report-processing/extract.mjs';
import {analyzeLayout} from '../services/report-processing/ocr.mjs';
test('draft values preserve comparisons, units, ranges, dates and provenance without inferring missing data',()=>{
  const text=['Collection date: 01/10/2026','Glucose 94 mg/dL 70 - 99','CRP <5 mg/L <5','Ferritin 85 ng/mL 30 - 400','Unrecognised assay 999 units'];
  const values=extractObservations([{number:2,text:text.join('\n'),lines:text.map(text=>({text}))}]);
  assert.equal(values.length,3);assert.equal(values[0].value,'94');assert.equal(values[0].unit,'mg/dL');assert.equal(values[0].referenceRange,'70 - 99');
  assert.equal(values[1].value,'<5');assert.equal(values[1].referenceRange,'<5');assert.equal(values[2].date,'01/10/2026');assert.equal(values[2].page,2);
  assert.equal(values[2].dateSourceText,text[0]);assert.equal(values[2].sourceText,text[3]);assert.ok(values.every(value=>value.reviewRequired===true));
  const ambiguous=extractObservations([{number:1,lines:[{text:'Collection date: 01/10/2026'},{text:'Collection date: 02/10/2026'},{text:'Glucose 4.9'}]}]);
  assert.equal(ambiguous[0].date,null);assert.equal(ambiguous[0].unit,null);assert.equal(ambiguous[0].referenceRange,null);
});
test('OCR rebuilds table rows and deletes the provider result; it never follows foreign operation URLs',async()=>{
  const endpoint='https://fictional.cognitiveservices.azure.com/',operation=endpoint+'documentintelligence/documentModels/prebuilt-layout/analyzeResults/demo?api-version=2024-11-30';
  const calls=[];
  const fetcher=async(url,options)=>{calls.push({url,method:options.method||'GET'});
    if(options.method==='POST')return new Response('',{status:202,headers:{'operation-location':operation}});
    if(options.method==='DELETE')return new Response(null,{status:204});
    return Response.json({status:'succeeded',analyzeResult:{pages:[{pageNumber:1,lines:[],unit:'inch'}],tables:[{cells:[
      {rowIndex:1,columnIndex:0,content:'Glucose',boundingRegions:[{pageNumber:1,polygon:[0,0,1,1]}]},
      {rowIndex:1,columnIndex:1,content:'94',boundingRegions:[{pageNumber:1}]},
      {rowIndex:1,columnIndex:2,content:'mg/dL',boundingRegions:[{pageNumber:1}]},
    ]}]}});};
  const options={env:{NAMAT_DOCUMENT_ENDPOINT:endpoint},credential:{getToken:async()=>({token:'synthetic'})},fetcher,pause:async()=>{}};
  const result=await analyzeLayout(Buffer.from('fictional'),'image/png',options);
  assert.equal(extractObservations(result.pages)[0].value,'94');assert.equal(calls.at(-1).method,'DELETE');
  const malicious=[];
  await assert.rejects(analyzeLayout(Buffer.from('fictional'),'image/png',{...options,fetcher:async(url)=>{malicious.push(url);return new Response('',{status:202,headers:{'operation-location':'https://external.invalid/private'}});}}));
  assert.equal(malicious.length,1);
});
