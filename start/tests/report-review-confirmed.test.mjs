import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createReportStore} from '../services/report-processing/store.mjs';

// A minimal stand-in for the saveReview transaction's queries.
function fakePool({revision=0}={}) {
  const reportId=randomUUID(),extractionId=randomUUID(),inserted=[];
  const pages=[{number:1,lines:[]}];
  const observations=[{name:'Glucose',value:'94',unit:'mg/dL',referenceRange:'70 - 99',date:null,page:1,sourceText:'Glucose 94 mg/dL 70 - 99'}];
  const client={async query(sql,params=[]){
    if(/^(BEGIN|COMMIT|ROLLBACK)/.test(sql))return {rows:[]};
    if(sql.includes('FROM public.namat_reports'))return {rows:[{id:reportId}]};
    if(sql.includes('FROM public.namat_report_extractions'))return {rows:[{id:extractionId,pages,observations}]};
    if(sql.includes('COALESCE(MAX(revision),0)::integer AS revision'))return {rows:[{revision}]};
    if(sql.startsWith('INSERT INTO public.namat_report_reviews')){
      inserted.push(JSON.parse(params[3]));
      return {rows:[{id:params[0],report_id:reportId,extraction_id:extractionId,revision:revision+1,observations:JSON.parse(params[3]),decision:params[4],actor:params[5],created_at:new Date()}]};
    }
    throw new Error(`Unexpected query: ${sql.slice(0,60)}`);
  },release(){}};
  return {reportId,extractionId,observations,inserted,pool:{connect:async()=>client,query:client.query}};
}

test('a review keeps a doctor confirmation per value and nothing else extra',async()=>{
  const {pool,reportId,extractionId,observations,inserted}=fakePool();
  const store=createReportStore(pool);
  const review=await store.saveReview(reportId,{extractionId,expectedReviewRevision:0,decision:'corrected',
    observations:[{...observations[0],confirmed:true,bounds:{x:1,y:2,width:3,height:4},note:'SECRET'}]},'Dr. Fictional');
  assert.equal(review.revision,1);
  assert.deepEqual(inserted[0],[{name:'Glucose',value:'94',unit:'mg/dL',referenceRange:'70 - 99',date:null,sourceText:'Glucose 94 mg/dL 70 - 99',page:1,confirmed:true}]);
  await store.saveReview(reportId,{extractionId,expectedReviewRevision:0,decision:'corrected',observations:[{...observations[0],confirmed:false}]},'Dr. Fictional');
  assert.equal(inserted[1][0].confirmed,undefined);
});

test('a review refuses a confirmation that is not a boolean',async()=>{
  const {pool,reportId,extractionId,observations,inserted}=fakePool();
  const store=createReportStore(pool);
  for(const confirmed of ['yes',1,null])
    await assert.rejects(store.saveReview(reportId,{extractionId,expectedReviewRevision:0,decision:'corrected',observations:[{...observations[0],confirmed}]},'Dr. Fictional'),{code:'invalid_observations'});
  assert.equal(inserted.length,0);
});
