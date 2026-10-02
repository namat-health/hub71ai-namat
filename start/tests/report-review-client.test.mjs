import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createReviewController,renderReport,normaliseObservations,reviewRevision,currentObservations} from '../services/report-processing/review.mjs';

const observation={name:'Sample marker',value:'42',unit:'unit',referenceRange:'10–50',date:'2026-10-01',page:1,sourceText:'Sample marker 42 unit 10–50'};
const report=()=>({id:'report-one',name:'fictional.pdf',status:'extracted',extraction:{id:'extract-v1',pages:[{number:1,text:'Fictional source'}],observations:[observation]},reviews:[{revision:2,decision:'needs_changes'}]});
const detail=()=>({case:{id:'case-one',receiptId:'receipt-one',firstName:'Fictional'},reports:[report()]});
const json=value=>({ok:true,status:200,json:async()=>value});

test('review queue keeps operator access in memory and authenticates every data request',async()=>{
  const calls=[];
  const controller=createReviewController({fetcher:async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/source'))return {ok:true,status:200,blob:async()=>new Blob(['PDF'],{type:'application/pdf'})};
    return json(url.endsWith('/cases')?{cases:[detail().case]}:detail());
  }});
  await controller.connect('  private-operator-token  ');assert.equal(controller.state.authenticated,true);
  await controller.openCase('case-one');const blob=await controller.source('report-one');assert.equal(blob.type,'application/pdf');
  for(const {options}of calls){assert.equal(options.headers.Authorization,'Bearer private-operator-token');assert.equal(options.cache,'no-store');assert.equal(options.referrerPolicy,'no-referrer');}
  assert.doesNotMatch(JSON.stringify(controller.state),/private-operator-token/);
  controller.lock();assert.equal(controller.state.authenticated,false);assert.deepEqual(controller.state.cases,[]);assert.equal(controller.state.detail,null);
  await assert.rejects(controller.source('report-one'),/reviewer access key/);
  const source=readFileSync(new URL('../services/report-processing/review.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/localStorage|sessionStorage/);
});

test('review submission sends the exact extraction and current review revision only after an explicit action',async()=>{
  const calls=[];
  const controller=createReviewController({fetcher:async(url,options)=>{
    calls.push({url,options});return json(url.endsWith('/cases')?{cases:[detail().case]}:url.endsWith('/reviews')?{review:{revision:3}}:detail());
  }});
  await controller.connect('token');await controller.openCase('case-one');assert.equal(calls.filter(call=>call.options.method==='POST').length,0);
  await controller.saveReview('report-one',[observation],'approved');
  const posts=calls.filter(call=>call.options.method==='POST');assert.equal(posts.length,1);
  assert.deepEqual(JSON.parse(posts[0].options.body),{extractionId:'extract-v1',expectedReviewRevision:2,observations:[observation],decision:'approved'});
  assert.equal(controller.state.message,'Your review has been saved.');
  await assert.rejects(controller.saveReview('report-one',[{...observation,value:'43'}],'approved'),/Save corrections/);
  assert.equal(calls.filter(call=>call.options.method==='POST').length,1);
});

test('stale review responses keep edits visible and require a refresh before another decision',async()=>{
  let posts=0;
  const controller=createReviewController({fetcher:async(url,options)=>{
    if(options.method==='POST'){posts++;return {ok:false,status:409,json:async()=>({message:'conflict'})};}
    return json(url.endsWith('/cases')?{cases:[detail().case]}:detail());
  }});
  await controller.connect('token');await controller.openCase('case-one');
  const edits=[{...observation,value:'43'}];await controller.saveReview('report-one',edits,'corrected');
  assert.match(controller.state.error,/Refresh/);assert.deepEqual(controller.state.drafts['report-one'],edits);
  await assert.rejects(controller.saveReview('report-one',edits,'corrected'),/Refresh/);assert.equal(posts,1);
  await controller.refresh();assert.deepEqual(controller.state.stale,[]);
});

test('review UI exposes source pages, escapes document content and shows empty or unknown extractions honestly',()=>{
  const original=report();original.name='<script>report</script>';original.extraction.observations=[{...observation,name:'<script>alert(1)</script>'}];
  const html=renderReport(original);
  assert.match(html,/Draft extraction/);assert.match(html,/data-source="report-one" data-page="1"/);
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
  assert.match(html,/I checked these values against the original/);
  assert.match(renderReport({...report(),extraction:{id:'empty-v1',pages:[],observations:[]}}),/No observations were extracted/);
  assert.match(renderReport({...report(),status:'unknown',extraction:null}),/No extraction is available for review/);
  assert.doesNotMatch(renderReport({...report(),extraction:null}),/value="approved"/);
  assert.match(renderReport(report(),{stale:true}),/value="approved" disabled/);
});

test('observation edits preserve null fields and require real source page references',()=>{
  assert.equal(reviewRevision({reviews:[{revision:1},{revision:3},{revision:2}]}),3);
  assert.deepEqual(normaliseObservations([{...observation,unit:' ',page:'1'}],[{number:1}]),[{...observation,unit:null}]);
  assert.throws(()=>normaliseObservations([{...observation,page:2}],[{number:1}]),/valid source page/);
  assert.throws(()=>normaliseObservations([{...observation,sourceText:''}],[{number:1}]),/source text/);
});

test('an incomplete extraction can be marked as needing changes without inventing observations',async()=>{
  let payload;
  const incomplete=detail();incomplete.reports[0].extraction.observations=[{name:'Unclear marker',page:null,sourceText:null}];
  const controller=createReviewController({fetcher:async(url,options)=>{
    if(options.method==='POST'){payload=JSON.parse(options.body);return json({review:{revision:3}});}
    return json(url.endsWith('/cases')?{cases:[incomplete.case]}:incomplete);
  }});
  await controller.connect('token');await controller.openCase('case-one');
  assert.match(renderReport(incomplete.reports[0]),/source page unavailable/);
  await controller.saveReview('report-one',incomplete.reports[0].extraction.observations,'needs_changes');
  assert.equal(payload.decision,'needs_changes');assert.equal(payload.observations[0].name,'Unclear marker');
  assert.equal(payload.observations[0].page,null);assert.equal(payload.observations[0].sourceText,null);
});

test('saved corrections remain the current editable values and the next approval baseline',async()=>{
  const corrected=detail();const edited={...observation,value:'43'};
  corrected.reports[0].reviews=[{revision:3,extractionId:'extract-v1',decision:'corrected',observations:[edited]},
    {revision:4,extractionId:'older-extraction',decision:'approved',observations:[{...observation,value:'old'}]}];
  assert.deepEqual(currentObservations(corrected.reports[0]),[edited]);
  assert.match(renderReport(corrected.reports[0]),/name="value" value="43"/);
  let posted;
  const controller=createReviewController({fetcher:async(url,options)=>{
    if(options.method==='POST'){posted=JSON.parse(options.body);return json({review:{revision:5}});}
    return json(url.endsWith('/cases')?{cases:[corrected.case]}:corrected);
  }});
  await controller.connect('token');await controller.openCase('case-one');
  await controller.saveReview('report-one',[edited],'approved');
  assert.equal(posted.expectedReviewRevision,4);assert.deepEqual(posted.observations,[edited]);
});

test('locking during a pending response cannot restore private case data after the lock',async()=>{
  let resolveBody,bodyStarted;
  const started=new Promise(resolve=>{bodyStarted=resolve;});
  const controller=createReviewController({fetcher:async()=>({ok:true,status:200,json:()=>{bodyStarted();return new Promise(resolve=>{resolveBody=resolve;});}})});
  const connecting=controller.connect('token');await started;
  controller.lock();resolveBody({cases:[detail().case]});await connecting;
  assert.equal(controller.state.authenticated,false);assert.deepEqual(controller.state.cases,[]);assert.equal(controller.state.detail,null);
});

test('failed processing can be retried explicitly and refreshes the case after the request',async()=>{
  const failed=detail();failed.reports[0].status='failed';failed.reports[0].extraction=null;
  const calls=[];
  const controller=createReviewController({fetcher:async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/retry')){failed.reports[0].status='queued';return json({report:failed.reports[0]});}
    return json(url.endsWith('/cases')?{cases:[failed.case]}:failed);
  }});
  assert.match(renderReport(failed.reports[0]),/Retry processing/);
  assert.doesNotMatch(renderReport(report()),/Retry processing/);
  await controller.connect('token');await controller.openCase('case-one');
  assert.equal(calls.filter(call=>call.options.method==='POST').length,0);
  await controller.retryProcessing('report-one');
  const retry=calls.find(call=>call.url.endsWith('/retry'));assert.equal(retry.options.method,'POST');assert.deepEqual(JSON.parse(retry.options.body),{});
  assert.equal(controller.state.detail.reports[0].status,'queued');assert.match(controller.state.message,/queued/);
  await controller.retryProcessing('report-one');assert.equal(calls.filter(call=>call.options.method==='POST').length,1);
});
