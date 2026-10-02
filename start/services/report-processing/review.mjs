const API='/api/reports';
const text=value=>String(value??'');
export const escapeHtml=value=>text(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fields=['name','value','unit','referenceRange','date','page','sourceText'];
const labels={name:'Test or observation',value:'Value',unit:'Unit',referenceRange:'Reference range',date:'Report date',page:'Source page',sourceText:'Text from the source'};
const statusLabels={created:'Awaiting upload',uploaded:'Uploaded',validating:'Checking file',queued:'Queued for processing',processing:'Processing',extracted:'Draft extraction',ready:'Draft extraction',reviewed:'Reviewed',failed:'Processing failed',rejected:'File rejected'};
const reviewLabels={approved:'Approved',corrected:'Corrections saved',needs_changes:'Needs changes'};
const dateLabel=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?'Date unavailable':date.toLocaleString();};
export const reviewRevision=report=>Math.max(0,...(report.reviews||[]).map(review=>Number.isSafeInteger(review.revision)?review.revision:0));
export const latestReview=report=>(report.reviews||[]).filter(review=>review.extractionId===report.extraction?.id&&Array.isArray(review.observations)).sort((a,b)=>(b.revision||0)-(a.revision||0))[0];
export const currentObservations=report=>latestReview(report)?.observations??(Array.isArray(report.extraction?.observations)?report.extraction.observations:[]);

export function normaliseObservations(observations,pages=[],allowIncomplete=false) {
  if(!Array.isArray(observations))throw new Error('Review the observation fields before saving.');
  const pageNumbers=new Set(pages.map(page=>Number(page.number)).filter(page=>Number.isSafeInteger(page)&&page>0));
  return observations.map(observation=>{
    const cleaned=Object.fromEntries(fields.map(field=>[field,field==='page'?(text(observation[field]).trim()?Number(observation[field]):null):text(observation[field]).trim()||null]));
    if(!allowIncomplete&&(!cleaned.name || !Number.isSafeInteger(cleaned.page) || cleaned.page<1 || (pageNumbers.size&&!pageNumbers.has(cleaned.page))))throw new Error('Each observation needs a name and a valid source page.');
    if(!allowIncomplete&&!cleaned.sourceText)throw new Error('Include the source text for each observation so the values can be checked.');
    return cleaned;
  });
}

export function renderObservation(observation,index,reportId,disabled=false) {
  const safeId=escapeHtml(reportId),hasPage=Number.isSafeInteger(Number(observation.page))&&Number(observation.page)>0,page=hasPage?Number(observation.page):1;
  return `<section class="observation" data-observation-row data-row-index="${index}"><div class="observation-header"><h4>Observation ${index+1}</h4><button type="button" class="small-button" data-source="${safeId}" data-page="${page}">${hasPage?`Open source · page ${page}`:'Open original · source page unavailable'}</button></div><div class="observation-fields">${fields.map(field=>{
    const id=`observation-${safeId}-${index}-${field}`;
    return `<div class="${field==='sourceText'?'wide':field==='name'?'first':''}"><label for="${id}">${labels[field]}</label>${field==='sourceText'
      ? `<textarea class="source-copy" id="${id}" name="${field}" ${disabled?'disabled':''}>${escapeHtml(observation[field])}</textarea>`
      : `<input id="${id}" name="${field}" value="${escapeHtml(observation[field])}" ${field==='page'?'type="number" min="1" step="1"':'type="text"'} ${disabled?'disabled':''} />`}</div>`;
  }).join('')}</div><button type="button" class="small-button" data-remove-row="${index}" ${disabled?'disabled':''}>Remove observation</button></section>`;
}

export function renderReport(report,{busy=false,stale=false,draft}={}) {
  const id=escapeHtml(report.id),extraction=report.extraction;
  const status=text(report.status||'unknown'),canReview=Boolean(extraction?.id)&&['ready','extracted','reviewed'].includes(status);
  const observations=draft??currentObservations(report),currentReview=latestReview(report);
  const reviews=Array.isArray(report.reviews)?report.reviews:[];
  const disabled=busy||stale;
  const reviewed=canReview&&currentReview&&Object.hasOwn(reviewLabels,currentReview.decision);
  const statusClass=reviewed?currentReview.decision:['queued','processing','failed','rejected'].includes(status)?status:canReview?'draft':'';
  return `<article class="report-card" data-report="${id}"><div class="report-header"><div><h3>${escapeHtml(report.name||'Untitled report')}</h3><p class="muted">${extraction?.pages?.length?`${extraction.pages.length} source page${extraction.pages.length===1?'':'s'}`:'Source page count unavailable'}</p></div><span class="status status-${statusClass}">${escapeHtml(reviewed?reviewLabels[currentReview.decision]:statusLabels[status]||`Status: ${status}`)}</span></div><div class="report-actions"><button type="button" class="small-button" data-source="${id}" data-page="1">Open original report</button>${status==='failed'?`<button type="button" class="small-button" data-retry="${id}" ${busy?'disabled':''}>Retry processing</button>`:''}</div>${report.errorCode?`<p class="error">Processing could not finish (${escapeHtml(report.errorCode)}). Check the original report before taking any action.</p>`:''}${stale?'<p class="error">This report or its review changed. Refresh the case before saving a decision. Your unsaved entries are shown below.</p>':''}${canReview
    ? `<form data-review-form="${id}"><p class="notice">${currentReview ? `Saved review · revision ${escapeHtml(currentReview.revision)}. ` : 'Draft extraction. '}Check every value and its source page before approving. This review does not create a diagnosis or care plan.</p>${observations.length?'':`<p class="empty">${currentReview ? 'The latest review contains no observations.' : 'No observations were extracted.'} Open the original report and add any values that need review, or mark this extraction as needing changes.</p>`}<div class="observation-list">${observations.map((observation,index)=>renderObservation(observation,index,report.id,disabled)).join('')}</div><div class="report-actions"><button type="button" class="small-button" data-add-row="${id}" ${disabled?'disabled':''}>Add observation</button></div><div class="review-decision"><label><input type="checkbox" name="sourceChecked" ${disabled?'disabled':''} />I checked these values against the original report and its source pages.</label><div class="decision-buttons"><button class="primary" type="submit" name="decision" value="approved" ${disabled?'disabled':''}>Approve current values</button><button type="submit" name="decision" value="corrected" ${disabled?'disabled':''}>Save corrections</button><button type="submit" name="decision" value="needs_changes" ${disabled?'disabled':''}>Needs changes</button></div></div></form>`
    : `<p class="empty">${['created','uploaded','validating','queued','processing'].includes(status)?'Extraction is not ready yet. Refresh the case after processing finishes.':'No extraction is available for review. Open the original report to inspect it.'}</p>`}${reviews.length?`<details class="review-history"><summary>Review history · ${reviews.length}</summary><ul>${reviews.map(review=>`<li><strong>${escapeHtml({approved:'Approved',corrected:'Corrected',needs_changes:'Needs changes'}[review.decision]||review.decision||'Review')}</strong> · revision ${escapeHtml(review.revision??'?')} · ${escapeHtml(dateLabel(review.createdAt||review.created_at))}</li>`).join('')}</ul></details>`:'<p class="muted">No reviewer decision recorded.</p>'}</article>`;
}

export function createReviewController({fetcher=globalThis.fetch,onChange=()=>{}}={}) {
  let token='',generation=0;
  const state={authenticated:false,cases:[],detail:null,loading:false,saving:false,error:'',message:'',drafts:{},stale:[]};
  const changed=()=>onChange(state);
  function lock(){generation++;token='';Object.assign(state,{authenticated:false,cases:[],detail:null,loading:false,saving:false,error:'',message:'',drafts:{},stale:[]});changed();}
  async function request(path,{method='GET',body,raw=false}={}) {
    if(!token)throw new Error('Enter your reviewer access key.');
    const currentGeneration=generation;
    const response=await fetcher(`${API}${path}`,{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',credentials:'same-origin',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(45000)});
    if(currentGeneration!==generation)throw new Error('This review session has ended.');
    if([401,403].includes(response.status)){lock();throw new Error('Access was denied. Enter a valid reviewer access key.');}
    if(raw&&response.ok){const blob=await response.blob();if(currentGeneration!==generation)throw new Error('This review session has ended.');return blob;}
    const result=await response.json().catch(()=>null);
    if(currentGeneration!==generation)throw new Error('This review session has ended.');
    if(!response.ok){const error=new Error(response.status===409?'This extraction or review changed. Refresh the case before saving.':result?.message||'The review service could not complete that request.');error.status=response.status;throw error;}
    return result;
  }
  async function connect(value){
    lock();token=text(value).trim();state.loading=true;changed();
    try{const result=await request('/cases');state.cases=Array.isArray(result?.cases)?result.cases:[];state.authenticated=true;}
    catch(error){token='';state.error=error.message||'The review queue could not be opened.';}
    finally{state.loading=false;changed();}
  }
  async function refresh(){
    if(state.loading||state.saving)return;
    state.loading=true;state.error='';state.message='';changed();
    try{
      const result=await request('/cases');state.cases=Array.isArray(result?.cases)?result.cases:[];
      if(state.detail?.case?.id)state.detail=await request(`/cases/${encodeURIComponent(state.detail.case.id)}`);
      state.drafts={};state.stale=[];
    }catch(error){state.error=error.message;}
    finally{state.loading=false;changed();}
  }
  async function openCase(id){
    if(state.loading||state.saving)return;
    state.loading=true;state.error='';state.message='';state.detail=null;state.drafts={};state.stale=[];changed();
    try{state.detail=await request(`/cases/${encodeURIComponent(id)}`);}
    catch(error){state.error=error.message;}
    finally{state.loading=false;changed();}
  }
  async function saveReview(reportId,observations,decision){
    if(state.loading||state.saving)return;
    const report=state.detail?.reports?.find(report=>report.id===reportId);
    if(!report?.extraction?.id || !['ready','extracted','reviewed'].includes(report.status) || state.stale.includes(reportId))throw new Error('Refresh this case before saving a review.');
    if(!['approved','corrected','needs_changes'].includes(decision))throw new Error('Choose a review decision.');
    const cleaned=normaliseObservations(observations,report.extraction.pages,decision==='needs_changes');
    if(decision!=='needs_changes'&&!cleaned.length)throw new Error('Add observations before approving or saving corrections.');
    if(decision==='approved'&&JSON.stringify(cleaned)!==JSON.stringify(normaliseObservations(currentObservations(report),report.extraction.pages)))throw new Error('The observations have changed. Use Save corrections to record your edits.');
    state.drafts[reportId]=observations;state.saving=true;state.error='';state.message='';changed();
    try{
      await request(`/${encodeURIComponent(reportId)}/reviews`,{method:'POST',body:{extractionId:report.extraction.id,expectedReviewRevision:reviewRevision(report),observations:cleaned,decision}});
      state.message='Your review has been saved.';
      state.detail=await request(`/cases/${encodeURIComponent(state.detail.case.id)}`);state.drafts={};state.stale=[];
    }catch(error){
      state.stale=[...new Set([...state.stale,reportId])];
      state.error=error.status===409?error.message:state.message?'Your review was saved, but the refreshed case could not be loaded. Refresh before making another change.':error.status?error.message:'We couldn’t confirm whether your review was saved. Refresh the case before trying again.';
    }finally{state.saving=false;changed();}
  }
  async function retryProcessing(reportId){
    if(state.loading||state.saving)return;
    if(state.detail?.reports?.find(report=>report.id===reportId)?.status!=='failed')return;
    state.saving=true;state.error='';state.message='';changed();
    try{
      await request(`/${encodeURIComponent(reportId)}/retry`,{method:'POST',body:{}});
      state.detail=await request(`/cases/${encodeURIComponent(state.detail.case.id)}`);
      state.message='The report has been queued for another processing attempt.';
    }catch(error){state.error=error.message==='manual_retry_limit'?'This report has reached its retry limit.':error.message;}
    finally{state.saving=false;changed();}
  }
  return {state,connect,lock,refresh,openCase,saveReview,retryProcessing,source:(id)=>request(`/${encodeURIComponent(id)}/source`,{raw:true})};
}

function mountReview(root){
  const loginHtml=root.innerHTML,sourceUrls=new Set();
  let sourceReturn=null;
  const revokeSources=()=>{for(const url of sourceUrls)URL.revokeObjectURL(url);sourceUrls.clear();};
  const controller=createReviewController({onChange:render});
  function render(state){
    if(!state.authenticated){
      revokeSources();root.innerHTML=loginHtml;
      const button=root.querySelector('button[type="submit"]');button.disabled=state.loading;button.textContent=state.loading?'Opening review queue…':'Open review queue';
      const error=root.querySelector('#login-error');error.textContent=state.error;error.hidden=!state.error;return;
    }
    const selected=state.detail?.case;
    root.innerHTML=`<div class="review-shell"><div class="toolbar"><div><p class="eyebrow">Report review</p><p class="muted">${state.cases.length} case${state.cases.length===1?'':'s'} · Source checks required</p></div><div class="toolbar-actions"><button type="button" data-action="refresh" ${state.loading||state.saving?'disabled':''}>Refresh queue</button><button type="button" data-action="lock">Lock review</button></div></div>${state.error?`<p class="error" role="alert">${escapeHtml(state.error)}</p>`:''}${state.message?`<p class="notice" role="status">${escapeHtml(state.message)}</p>`:''}<div class="workspace"><aside class="queue" aria-label="Cases"><h2>Cases</h2>${state.cases.length?`<ul class="queue-list">${state.cases.map(item=>`<li><button type="button" class="case-button" data-case="${escapeHtml(item.id)}" aria-current="${selected?.id===item.id}" ${state.loading||state.saving?'disabled':''}><strong>${escapeHtml(item.firstName||'Fictional case')}</strong><small>${escapeHtml(dateLabel(item.createdAt))}</small><small>${escapeHtml(item.reportCount??(Array.isArray(item.reports)?item.reports.length:'—'))} report${(item.reportCount??item.reports?.length)===1?'':'s'}${Number.isInteger(item.readyCount)?` · ${item.readyCount} ready`:''}</small></button></li>`).join('')}</ul>`:'<p class="empty">No submitted report cases are available.</p>'}</aside><section class="case-content" aria-label="Case review">${state.loading?'<p class="loading" role="status">Loading case details…</p>':selected?`<h2>${escapeHtml(selected.firstName||'Fictional case')}</h2><p class="case-meta">Reference ${escapeHtml(selected.receiptId||'unavailable')} · ${escapeHtml(dateLabel(selected.createdAt))}</p>${state.detail.reports?.length?state.detail.reports.map(report=>renderReport(report,{busy:state.saving,stale:state.stale.includes(report.id),draft:state.drafts[report.id]})).join(''):'<p class="empty">No reports are attached to this case.</p>'}`:'<div class="empty">Choose a case to inspect its reports and extracted values.</div>'}<div id="source-preview" aria-live="polite"></div></section></div></div>`;
  }
  const readRows=form=>Array.from(form.querySelectorAll('[data-observation-row]')).map(row=>Object.fromEntries(fields.map(field=>[field,row.querySelector(`[name="${field}"]`).value])));
  function showFormError(form,message){let error=form.querySelector('[data-form-error]');if(!error){error=document.createElement('p');error.className='error';error.dataset.formError='';error.setAttribute('role','alert');form.prepend(error);}error.textContent=message;error.scrollIntoView({block:'nearest'});}
  root.addEventListener('submit',async event=>{
    event.preventDefault();const form=event.target;
    if(form.id==='review-login'){const token=form.querySelector('[name="token"]').value;form.reset();await controller.connect(token);return;}
    const id=form.dataset.reviewForm;if(!id)return;
    const decision=event.submitter?.value;
    if(decision!=='needs_changes'&&!form.querySelector('[name="sourceChecked"]').checked){showFormError(form,'Confirm that you checked the source pages before saving this decision.');return;}
    try{await controller.saveReview(id,readRows(form),decision);}catch(error){showFormError(form,error.message);}
  });
  root.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button||button.disabled)return;
    if(button.dataset.action==='lock'){controller.lock();return;}
    if(button.dataset.action==='refresh'){revokeSources();await controller.refresh();return;}
    if(button.dataset.action==='back-to-values'){sourceReturn?.scrollIntoView({block:'center'});sourceReturn?.focus({preventScroll:true});return;}
    if(button.dataset.case){revokeSources();await controller.openCase(button.dataset.case);return;}
    if(button.dataset.retry){await controller.retryProcessing(button.dataset.retry);return;}
    if(button.dataset.source){
      const preview=root.querySelector('#source-preview');if(!preview)return;
      sourceReturn=button;
      preview.innerHTML='<p class="loading" role="status">Opening the original report…</p>';
      try{
        const blob=await controller.source(button.dataset.source),url=URL.createObjectURL(blob);sourceUrls.add(url);
        const page=Number(button.dataset.page)||1,fragment=`${url}#page=${page}`;
        const image=['image/png','image/jpeg'].includes(blob.type);
        const name=controller.state.detail?.reports?.find(report=>report.id===button.dataset.source)?.name||'Original report';
        preview.innerHTML=`<section class="source-panel"><h2>${escapeHtml(name)} · page ${page}</h2><div class="report-actions"><button type="button" class="small-button" data-action="back-to-values">Back to values</button><a href="${fragment}" target="_blank" rel="noopener noreferrer">Open original in a new tab</a></div>${image?`<img src="${url}" alt="Original uploaded report" />`:`<iframe src="${fragment}" title="Original report, page ${page}" referrerpolicy="no-referrer"></iframe>`}</section>`;
        preview.scrollIntoView({block:'start',behavior:'smooth'});
      }catch(error){preview.innerHTML=`<p class="error" role="alert">${escapeHtml(error.message)}</p>`;}
      return;
    }
    const form=button.closest('[data-review-form]');if(!form)return;
    if(button.dataset.addRow){
      const index=Math.max(-1,...Array.from(form.querySelectorAll('[data-observation-row]')).map(row=>Number(row.dataset.rowIndex)))+1;
      form.querySelector('.observation-list').insertAdjacentHTML('beforeend',renderObservation({page:1},index,button.dataset.addRow));
      form.querySelector('[name="sourceChecked"]').checked=false;
    }else if(button.hasAttribute('data-remove-row')){button.closest('[data-observation-row]').remove();form.querySelector('[name="sourceChecked"]').checked=false;}
  });
  root.addEventListener('input',event=>{
    const form=event.target.closest('[data-review-form]');if(!form||event.target.name==='sourceChecked')return;
    form.querySelector('[name="sourceChecked"]').checked=false;
    if(event.target.name==='page'){
      const button=event.target.closest('[data-observation-row]').querySelector('[data-source]'),page=Number(event.target.value);
      const valid=Number.isSafeInteger(page)&&page>0;
      button.dataset.page=String(valid?page:1);button.textContent=valid?`Open source · page ${button.dataset.page}`:'Open original · source page unavailable';
    }
  });
  window.addEventListener('pagehide',()=>{controller.lock();revokeSources();});
}

if(typeof document!=='undefined'){const root=document.querySelector('#report-review');if(root)mountReview(root);}
