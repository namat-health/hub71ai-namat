import {
  VERSION, createAnswers, getQuestion, updateAnswer,
  validateSubmission, normaliseNotes, noteApplies, NOTE_PROMPTS,
  NOTE_MAX, getContextCopy, getReview, PROFILE_FIELDS, getVisualAnswers,
} from './questionnaire-model.mjs';
import {getScreenPath, screenFor, validateScreen, getSection, sectionVisualStep} from './questionnaire-flow.mjs';
import {COPY, BRAND_TAGLINE} from '../../lib/journey-copy.mjs';
import {getJourneyVisual, getProfileVisual} from '../../lib/journey-visuals.mjs';
const BLOODWORK_ART: Record<string,string> = {yes:'/assets/journey/bloodwork-yes.svg',no:'/assets/journey/bloodwork-no.svg'};

type Answers = Record<string,string | string[]>;
type ReportReference = {name:string;type:string;size:number;sha256:string};
type Report = ReportReference & {file:File;upload?:{reportId:string;uploadUrl:string;uploaded:boolean;completed:boolean}};
type ReportSession = {id:string;token:string};
type Receipt = {receiptId:string;confirmationEmail?:string;reportCount?:number};
const REPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;
const DRAFT_KEY = 'namat.hackathon.welcome.v2';
// Astro's local page router requires a trailing slash; Vercel exposes the
// production function at the extensionless API path.
const api = import.meta.env.DEV ? '/api/hackathon/' : '/api/hackathon';
const root = document.querySelector<HTMLElement>('[data-hackathon-questionnaire]');
if (root) initialise(root);

function initialise(root:HTMLElement) {
  const view = root.querySelector<HTMLElement>('[data-step-view]')!;
  const progress = root.querySelector<HTMLElement>('[data-progress]')!;
  const meter = root.querySelector<HTMLProgressElement>('[data-progress-meter]')!;
  const progressLabel = root.querySelector<HTMLElement>('[data-progress-label]')!;
  const workspace = root.querySelector<HTMLElement>('.ov-workspace')!;
  const photograph = root.querySelector<HTMLImageElement>('[data-journey-image]')!;
  const desktopPhotos = window.matchMedia('(min-width: 761px) and (min-aspect-ratio: 1/1)');
  let answers:Answers = createAnswers();
  let notes:Record<string,string> = {};
  let current = 'welcome';
  let firstName = '';
  let email = '';
  let fictionalConfirmed = false;
  let reports:Report[] = [];
  let expectedReports:ReportReference[] = [];
  let requestId = crypto.randomUUID();
  let receipt:Receipt | null = null;
  let busy = false;
  let saveConflict = false;
  let resetPending = false;
  let editing = false;
  let readingFiles = false;
  let errorMessage = '';
  let saveStage = '';
  let reportSession:ReportSession | null = null;

  const escape = (value:unknown) => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
  const changed = () => {requestId = crypto.randomUUID(); receipt = null; saveConflict = false; errorMessage = '';};
  const reportReferences = () => reports.map(({name,type,size,sha256})=>({name,type,size,sha256}));
  const clearUploads = () => {reportSession=null;for(const report of reports)delete report.upload;};
  const contactError = () => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email.trim()) || email.trim().length > 254
    ? 'Please enter a valid email address.' : !firstName.trim() || firstName.trim().length > 80 || /[\u0000-\u001f\u007f<>\u2028\u2029]/.test(firstName)
      ? 'Please enter your name (up to 80 characters).' : !fictionalConfirmed
        ? 'Please confirm that your health answers and reports are fictional.' : null;

  function persist() {
    try {
      sessionStorage.setItem(DRAFT_KEY,JSON.stringify({version:VERSION,answers,notes,current,firstName,email,
        fictionalConfirmed,requestId,reports:reports.length ? reportReferences() : expectedReports,receipt}));
    } catch { /* The form also works without browser storage. */ }
  }
  try {
    const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null');
    if (draft?.version === VERSION) {
      answers = updateAnswer(draft.answers || {});
      notes = normaliseNotes(answers,draft.notes || {});
      firstName = typeof draft.firstName === 'string' ? draft.firstName.slice(0,80) : '';
      email = typeof draft.email === 'string' ? draft.email.slice(0,254) : '';
      fictionalConfirmed = draft.fictionalConfirmed === true;
      if (/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(draft.requestId)) requestId = draft.requestId;
      expectedReports = Array.isArray(draft.reports) ? draft.reports.filter((r:ReportReference)=>r && typeof r.name==='string' && r.name.length<=160 && typeof r.sha256==='string' && /^[\da-f]{64}$/.test(r.sha256)).slice(0,3) : [];
      if (draft.receipt && typeof draft.receipt.receiptId === 'string' && /^[\da-f-]{36}$/i.test(draft.receipt.receiptId)) {
        receipt = draft.receipt; current = 'success';
      } else if (getScreenPath(answers).includes(screenFor(draft.current,answers))) current = screenFor(draft.current,answers);
    }
  } catch { /* Ignore an invalid or unavailable saved draft. */ }

  function missingBefore(target:string) {
    const path = getScreenPath(answers);
    return path.slice(0,path.indexOf(target)).find(id=>id === 'contact' ? contactError() : validateScreen(id,answers,notes));
  }
  function navigate(target:string,replace=false) {
    if (busy || readingFiles) return;
    target = screenFor(target,answers);
    current = target === 'success' && receipt ? target : getScreenPath(answers).includes(target) ? missingBefore(target) || target : 'welcome';
    errorMessage = ''; resetPending = false;
    const ordinal = current === 'success' ? 'complete' : `s${String(getScreenPath(answers).indexOf(current)).padStart(2,'0')}`;
    history[replace ? 'replaceState' : 'pushState']({step:current},'',`${location.pathname}#${ordinal}`);
    render();
  }
  function next() {
    const error = current === 'contact' ? contactError() : validateScreen(current,answers,notes);
    if (error) return showError(error);
    if (editing) {
      const missing = getScreenPath(answers).slice(0,getScreenPath(answers).indexOf('contact')).find(id=>validateScreen(id,answers,notes));
      if (missing) return navigate(missing);
      editing = false; return navigate('contact');
    }
    const path = getScreenPath(answers);
    navigate(path[path.indexOf(current)+1] || current);
  }
  function showError(message:string) {
    errorMessage = message;
    const error = view.querySelector<HTMLElement>('[data-error]');
    if (error) {error.textContent = message; error.hidden = false; error.focus();}
  }
  const heading = (title:string,body='') => `<h1 class="ov-title" id="hk-heading" tabindex="-1">${escape(title)}</h1>${body ? `<p class="ov-intro">${escape(body)}</p>` : ''}`;
  const errorMarkup = () => `<p class="ov-error" data-error role="alert" tabindex="-1" ${errorMessage ? '' : 'hidden'}>${escape(errorMessage)}</p>`;
  const actions = (label='Continue',action='continue',back=true,disabled=false) => `<div class="ov-actions">${back ? '<button class="ov-back" type="button" data-action="back">← Back</button>' : ''}<button class="ov-primary" type="${action === 'submit' ? 'submit' : 'button'}" data-action="${action}" ${disabled || busy ? 'disabled' : ''}>${escape(label)}</button></div>`;
  const reviewMarkup = () => `<details class="ov-review"><summary>Review your answers</summary><dl>${getReview(answers,notes).filter(row=>row.id!=='bloodwork').map(row=>`<div class="ov-review-row"><dt>${escape(row.title)}</dt><dd>${escape(row.value)}</dd><button type="button" data-edit="${escape(row.id)}">Change</button></div>`).join('')}</dl></details>`;
  function mobilePortrait(scene = 'recognition') {
    const visual = getProfileVisual(getVisualAnswers(answers), scene);
    return visual.kind === 'person' ? `<img class="ov-mobile-portrait" src="${visual.src}" srcset="${visual.srcSet}" sizes="120px" width="${visual.width}" height="${visual.height}" alt="" aria-hidden="true" decoding="async" />` : '';
  }
  function noteField(id=current) {
    const prompt = (NOTE_PROMPTS as Record<string,string[]>)[id];
    if (!prompt) return '';
    return `<div data-note-field data-note-for="${id}" ${noteApplies(id,answers) ? '' : 'hidden'}><label class="ov-field" for="hk-note-${id}">${escape(prompt[0])}<input id="hk-note-${id}" name="note" data-note-key="${id}" maxlength="${NOTE_MAX}" value="${escape(notes[id])}" placeholder="${escape(prompt[1])}" autocomplete="off" /></label></div>`;
  }
  function choiceGroup(id:string) {
    const q=getQuestion(id,answers)!;
    return `<fieldset class="hk-question-group"><legend>${escape(q.title)}</legend>${q.body?`<p class="hk-group-hint">${escape(q.body)}</p>`:''}<div class="ov-options ${id==='sex'?'hk-two-options':''}">${q.options.map((option:{id:string;label:string})=>`<label class="ov-option"><input type="radio" name="${id}" data-answer-key="${id}" value="${escape(option.id)}" ${answers[id]===option.id?'checked':''} /><span>${escape(option.label)}</span></label>`).join('')}</div>${noteField(id)}</fieldset>`;
  }
  desktopPhotos.addEventListener('change', () => {
    if (!desktopPhotos.matches) return;
    const visual = getJourneyVisual(sectionVisualStep(current), getVisualAnswers(answers));
    photograph.sizes = `max(50vw, ${(100 * visual.width / visual.height).toFixed(2)}svh)`;
    photograph.srcset = visual.srcSet;
    photograph.src = visual.src;
    photograph.width = visual.width;
    photograph.height = visual.height;
  });
  function render() {
    root.dataset.step = current;
    const section = getSection(current,answers);
    root.dataset.section = String(section.number);
    progress.hidden = current === 'welcome'; meter.value = section.progress; progressLabel.textContent = `${section.progress}%`;
    meter.setAttribute('aria-valuetext',`${section.progress}% complete`);
    const q = getQuestion(current,answers);
    root.dataset.choiceCount = String(q?.options.length || 0);
    const visual = getJourneyVisual(sectionVisualStep(current), getVisualAnswers(answers));
    root.dataset.visualKind = visual.kind;
    root.dataset.visualScene = visual.scene;
    root.dataset.visualCast = visual.cast || '';
    if (desktopPhotos.matches && photograph.getAttribute('src') !== visual.src) {
      photograph.sizes = `max(50vw, ${(100 * visual.width / visual.height).toFixed(2)}svh)`;
      photograph.srcset = visual.srcSet; photograph.src = visual.src;
      photograph.width = visual.width; photograph.height = visual.height;
    }
    const caption = root.querySelector<HTMLElement>('[data-art-caption]');
    if (caption) caption.textContent = visual.scene === 'recognition' ? getContextCopy(answers).title : BRAND_TAGLINE;
    if (current === 'basics') {
      const locationQuestion=getQuestion('location',answers)!;
      view.innerHTML = `<form data-question-form novalidate>${heading('A few basics about you','These details help put your results in context. Height and weight are optional.')}<div class="hk-profile-fields">${Object.entries(PROFILE_FIELDS).map(([key,field])=>`<label class="ov-field" for="hk-${key}">${escape(field.label)}<input id="hk-${key}" name="${key}" data-profile-field type="number" inputmode="${key==='age' ? 'numeric' : 'decimal'}" min="${field.min}" max="${field.max}" step="${field.step}" value="${escape(answers[key])}" ${key==='age' ? 'required' : ''} /></label>`).join('')}</div>${choiceGroup('sex')}<label class="ov-field hk-location" for="hk-location">${escape(locationQuestion.title)}<select id="hk-location" name="location" data-answer-key="location" required><option value="">Choose your Emirate</option>${locationQuestion.options.map((option:{id:string;label:string})=>`<option value="${option.id}" ${answers.location===option.id?'selected':''}>${escape(option.label)}</option>`).join('')}</select><small>${escape(locationQuestion.body)}</small></label>${errorMarkup()}${actions('Continue','submit',true,Boolean(validateScreen(current,answers,notes)))}</form>`;
    } else if (current === 'habits') {
      view.innerHTML = `<form data-question-form novalidate>${heading('A little about your everyday habits','Both answers help your doctor put your results in context.')}<div class="hk-habit-grid">${choiceGroup('tobacco')}${choiceGroup('alcohol')}</div>${errorMarkup()}${actions('Continue','submit',true,Boolean(validateScreen(current,answers,notes)))}</form>`;
    } else if (q) {
      const value = answers[current];
      const options = current==='family' ? [...q.options.filter((o:{id:string})=>['none','unsure'].includes(o.id)),...q.options.filter((o:{id:string})=>!['none','unsure'].includes(o.id))] : q.options;
      const final = current === 'bloodwork';
      const finalForward = !final ? '' : value === 'yes'
        ? `<button class="ov-primary" type="button" data-action="continue" ${busy ? 'disabled' : ''}>Continue to upload</button>`
        : value === 'no'
          ? `<button class="ov-primary" type="button" data-action="${saveConflict ? 'restart' : 'save'}" ${busy ? 'disabled' : ''}>${saveConflict ? 'Start over' : errorMessage ? 'Try again' : 'Submit questionnaire'}</button>`
          : '';
      view.innerHTML = `<form data-question-form novalidate>${heading(q.title,final ? 'Choose No to send your questionnaire, or Yes to add your recent reports.' : q.body)}<fieldset class="ov-options ${current==='family' ? 'hk-family-options' : ''}" aria-labelledby="hk-heading"><legend class="ov-sr">${escape(q.title)}</legend>${options.map((option:{id:string;label:string})=>`<label class="ov-option ${current==='family'&&['none','unsure'].includes(option.id)?'hk-family-shortcut':''}"><input type="${q.multiple ? 'checkbox' : 'radio'}" name="answer" value="${escape(option.id)}" ${Array.isArray(value) ? value.includes(option.id) ? 'checked' : '' : value===option.id ? 'checked' : ''} ${busy ? 'disabled' : ''} />${final ? `<img class="ov-bloodwork-illustration" src="${BLOODWORK_ART[option.id]}" width="320" height="220" alt="" aria-hidden="true" />` : ''}<span>${escape(option.label)}</span></label>`).join('')}</fieldset>${noteField()}${errorMarkup()}${final ? `<p class="hk-save-state" role="status">${busy ? 'Saving your questionnaire…' : ''}</p><div class="ov-actions"><button class="ov-back" type="button" data-action="back" ${busy ? 'disabled' : ''}>← Back</button>${finalForward}</div>` : actions('Continue','submit',true,Boolean(validateScreen(current,answers,notes)))}</form>`;
    } else if (current === 'welcome') {
      view.innerHTML = `${heading('Welcome to the UAE. Let’s take care of your health.',COPY.welcome.body)}<p class="hk-demo-note">Please use fictional health answers and sample reports only.</p>${actions('Get started','continue',false)}`;
    } else if (current === 'contact') {
      view.innerHTML = `<form data-contact-form novalidate>${mobilePortrait('review')}${heading('Where should we send your confirmation?','We’ll confirm that we’ve received your questionnaire, then email your personalised diagnostic plan once it has been reviewed and approved by your doctor.')}<div class="ov-contact-fields"><label class="ov-field" for="hk-name">Name<input id="hk-name" name="firstName" maxlength="80" value="${escape(firstName)}" autocomplete="name" required /></label><label class="ov-field" for="hk-email">Email address<input id="hk-email" name="email" type="email" maxlength="254" value="${escape(email)}" autocomplete="email" required /></label></div>${reviewMarkup()}<label class="ov-checkbox"><input type="checkbox" name="fictionalConfirmed" ${fictionalConfirmed ? 'checked' : ''} /><span>I confirm that these health answers and any reports I upload are fictional, and agree to receive emails about this demo.</span></label>${errorMarkup()}${actions('Continue','submit')}</form>`;
    } else if (current === 'upload') {
      const selected = reports.length ? reportReferences() : expectedReports;
      view.innerHTML = `${heading('Upload blood results from the past 12 months','Add your fictional reports so they can be reviewed with your questionnaire.')}<div class="hk-upload" data-drop-zone><label for="hk-reports">Drag and drop your reports here, or choose files</label><input id="hk-reports" type="file" name="reports" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" multiple ${busy || readingFiles ? 'disabled' : ''} /><p>PDF, JPG or PNG · Up to 3 files · 10 MiB per file</p></div>${selected.length ? `<div class="hk-report"><strong>${selected.map(r=>escape(r.name)).join('<br />')}</strong><p>${reports.length ? `${(reports.reduce((n,r)=>n+r.size,0)/1024).toFixed(0)} KB selected` : 'Please reattach these files. Reports are not stored in your browser.'}</p><button class="ov-secondary" type="button" data-action="remove-reports" ${busy || readingFiles ? 'disabled' : ''}>Remove files</button></div>` : ''}${errorMarkup()}<p class="hk-save-state" role="status">${busy ? escape(saveStage) : readingFiles ? 'Checking your files…' : ''}</p>${actions(busy ? 'Submitting…' : saveConflict ? 'Start over' : 'Submit questionnaire',saveConflict ? 'restart' : 'save',true,!reports.length || readingFiles)}`;
    } else if (current === 'success' && receipt) {
      const emailMessage = receipt.confirmationEmail==='sent' ? 'Your confirmation email has been handed to our email provider.'
        : receipt.confirmationEmail==='disabled' ? 'Your questionnaire is safely saved. Email delivery is switched off for this test.'
        : receipt.confirmationEmail==='failed' ? 'Your questionnaire is safely saved, but we couldn’t send your confirmation email. Keep your reference below.'
        : receipt.confirmationEmail==='pending' ? 'Your confirmation email is pending. Your questionnaire is safely saved.'
        : 'Your questionnaire is safely saved, but we couldn’t confirm whether your email was sent. Keep your reference below.';
      view.innerHTML = `<div class="ov-success" aria-hidden="true">✓</div>${heading('You’re all set.','Your questionnaire has been saved. Thank you for taking part.')}<p class="ov-note">${emailMessage}</p>${receipt.reportCount ? '<p class="ov-note">Your reports have been received and queued for processing. Extracted values will need review before they can be used.</p>' : ''}<div class="hk-receipt"><p>Your reference</p><code>${escape(receipt.receiptId)}</code></div><div class="ov-inline-actions"><a class="ov-primary" href="https://namat.health/welcome">Back to Namat</a><button class="ov-secondary" type="button" data-action="restart">Start another example</button></div>`;
    }
    if (resetPending) view.insertAdjacentHTML('afterbegin',`<section class="ov-card" role="alertdialog" aria-label="Start over?"><h2>Start over?</h2><p>This clears your answers and selected files from this browser. It does not delete an already submitted questionnaire.</p><div class="ov-inline-actions"><button class="ov-secondary" type="button" data-action="cancel-reset">Keep my answers</button><button class="ov-primary" type="button" data-action="confirm-reset">Start over</button></div></section>`);
    root.querySelectorAll<HTMLButtonElement>('[data-action="restart"]').forEach(button=>button.disabled=busy || readingFiles);
    if (!busy && !readingFiles) {
      view.querySelector<HTMLElement>(resetPending ? '[data-action="cancel-reset"]' : 'h1')?.focus({preventScroll:true});
      workspace.scrollTo({top:0,behavior:'instant'}); window.scrollTo({top:0,behavior:'instant'});
    }
    persist();
  }
  async function loadFiles(files:File[]) {
    if (busy || readingFiles) return;
    if (!files.length) return;
    if (files.length>3 || files.some(file=>file.size>REPORT_MAX_FILE_BYTES)) return showError('Choose up to 3 files, each 10 MiB or less.');
    const loaded:Report[] = [];
    readingFiles = true; errorMessage = ''; render();
    try {
      for (const file of files) {
        const type = file.type || ({pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png'}[file.name.split('.').at(-1)?.toLowerCase() || '']);
        if (!['application/pdf','image/jpeg','image/png'].includes(type || '') || !file.size || file.name.length>160 || /[\u0000-\u001f\u007f/\\]/.test(file.name)) throw new Error('Please choose a PDF, JPG or PNG report with a simple filename.');
        const bytes = new Uint8Array(await file.arrayBuffer());
        const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
        loaded.push({name:file.name,type:type!,size:file.size,sha256,file});
      }
      const references = loaded.map(({name,type,size,sha256})=>({name,type,size,sha256}));
      if (JSON.stringify(references)!==JSON.stringify(expectedReports)) {changed();clearUploads();}
      else loaded.forEach((report,index)=>{report.upload=reports[index]?.upload;});
      reports = loaded; expectedReports = references;
    } catch (error) {errorMessage = error instanceof Error ? error.message : 'We couldn’t read that report. Please choose it again.';}
    finally {readingFiles = false; render();}
  }
  function stage(message:string) {saveStage=message;render();}
  async function reportRequest(path:string,body:unknown,authenticated=true) {
    const response=await fetch(`/api/reports${path}`,{method:'POST',headers:{'Content-Type':'application/json',
      ...(authenticated && reportSession ? {Authorization:`Bearer ${reportSession.token}`,'X-Report-Session':reportSession.id} : {})},
      credentials:'same-origin',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(45000),body:JSON.stringify(body)});
    const result=await response.json().catch(()=>null);
    if(!response.ok){
      if(authenticated && [401,403].includes(response.status)){
        clearUploads();throw new Error('Your upload session has expired. Please try again.');
      }
      throw new Error(result?.message || 'We couldn’t confirm your report upload. Please try again.');
    }
    return result;
  }
  async function uploadReports() {
    if(!reportSession){
      stage('Preparing your report upload…');
      const session=await reportRequest('/sessions',{},false);
      if(typeof session?.sessionId!=='string' || typeof session?.token!=='string' || !session.sessionId || !session.token)throw new Error('We couldn’t start your report upload. Please try again.');
      reportSession={id:session.sessionId,token:session.token};
    }
    for(const [index,report]of reports.entries()){
      if(report.upload?.completed)continue;
      stage(`Uploading report ${index+1} of ${reports.length}…`);
      if(!report.upload){
        const uploaded=await reportRequest('/uploads',({name:report.name,type:report.type,size:report.size,sha256:report.sha256}));
        if(typeof uploaded?.reportId!=='string' || !uploaded.reportId)throw new Error('We couldn’t prepare that report. Please try again.');
        if(['queued','processing','ready'].includes(uploaded.status)){
          report.upload={reportId:uploaded.reportId,uploadUrl:'',uploaded:true,completed:true};continue;
        }
        if(typeof uploaded?.uploadUrl!=='string')throw new Error('We couldn’t prepare that report. Please try again.');
        const uploadUrl=new URL(uploaded.uploadUrl,location.origin);
        if(uploadUrl.protocol!=='https:' && !(uploadUrl.protocol==='http:' && uploadUrl.origin===location.origin))throw new Error('We couldn’t prepare that report. Please try again.');
        report.upload={reportId:uploaded.reportId,uploadUrl:uploadUrl.href,uploaded:false,completed:false};
      }
      if(!report.upload.uploaded){
        const response=await fetch(report.upload.uploadUrl,{method:'PUT',headers:{'Content-Type':report.type,'x-ms-blob-type':'BlockBlob'},
          body:report.file,credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(120000)});
        // A create-only upload may already exist after a lost PUT response.
        // Completion verifies its exact size/hash before it can be attached.
        if(!response.ok && ![409,412].includes(response.status)){delete report.upload;throw new Error('We couldn’t upload that report. Please try again.');}
        report.upload.uploaded=true;
      }
      stage(`Validating report ${index+1} of ${reports.length}…`);
      const completed=await reportRequest(`/uploads/${encodeURIComponent(report.upload.reportId)}/complete`,{});
      if(completed?.reportId!==report.upload.reportId || !['queued','processing','ready'].includes(completed.status))throw new Error('We couldn’t confirm that report was received. Please try again.');
      report.upload.completed=true;
    }
    return reports.map(report=>report.upload!.reportId);
  }
  async function save() {
    if (busy || readingFiles) return;
    const contact = contactError();
    if (contact) {navigate('contact'); return showError(contact);}
    const validation = validateSubmission({answers,notes});
    if (!validation.ok) {const first = screenFor(Object.keys(validation.errors)[0],answers); if (getScreenPath(answers).includes(first)) navigate(first); return showError(Object.values(validation.errors)[0] as string);}
    if (answers.bloodwork==='yes' && !reports.length) {navigate('upload'); return showError('Please choose your fictional blood report.');}
    busy = true; saveStage='Saving your questionnaire…'; errorMessage = ''; persist(); render();
    try {
      const reportIds=reports.length ? await uploadReports() : [];
      stage('Saving your questionnaire…');
      const response = await fetch(api,{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',credentials:'same-origin',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(45000),body:JSON.stringify({version:VERSION,requestId,dataClass:'synthetic',fictionalConfirmed,firstName:firstName.trim(),email:email.trim().toLowerCase(),answers:validation.answers,notes:validation.notes,reports:[],...(reportIds.length ? {reportIds,reportSession} : {})})});
      const result = await response.json().catch(()=>null);
      if (response.status === 409) {
        saveConflict = true;
        throw new Error('This questionnaire was already saved with different answers. Choose Start over to begin a new example.');
      }
      if (!response.ok || result?.status!=='saved' || !/^[\da-f-]{36}$/i.test(result?.receiptId || '')) throw new Error(result?.message || 'We couldn’t confirm the save. Please try again; the same submission will not be saved twice.');
      receipt = {receiptId:result.receiptId,confirmationEmail:result.confirmationEmail,reportCount:reportIds.length};
      reports = []; expectedReports = []; clearUploads(); busy = false; navigate('success',true);
    } catch (error) {
      busy = false; errorMessage = error instanceof Error && error.name!=='TimeoutError' ? error.message : 'We couldn’t confirm the save. Please try again; the same submission will not be saved twice.'; render(); showError(errorMessage);
    }
  }
  root.addEventListener('click',event=>{
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || button.disabled || busy || readingFiles) return;
    if (button.dataset.edit) {editing=true; navigate(button.dataset.edit); return;}
    switch(button.dataset.action) {
      case 'continue': next(); break;
      case 'back': {editing=false; const path=getScreenPath(answers); navigate(path[Math.max(0,path.indexOf(current)-1)]); break;}
      case 'save': void save(); break;
      case 'remove-reports': reports=[];expectedReports=[];clearUploads();changed();render();break;
      case 'restart': resetPending=true;render();break;
      case 'cancel-reset': resetPending=false;render();break;
      case 'confirm-reset': answers=createAnswers();notes={};reports=[];expectedReports=[];clearUploads();firstName=email='';fictionalConfirmed=false;editing=false;changed();navigate('welcome',true);break;
    }
  });
  root.addEventListener('submit',event=>{event.preventDefault();if (!busy && !readingFiles) next();});
  root.addEventListener('change',event=>{
    const input = event.target as HTMLInputElement;
    if (busy || readingFiles) return;
    if (input.name==='reports') {void loadFiles(Array.from(input.files || []));return;}
    if (input.name==='fictionalConfirmed') {fictionalConfirmed=input.checked;changed();persist();return;}
    const key=input.dataset?.answerKey || (input.name==='answer'?current:'');
    const q = getQuestion(key,answers); if (!q) return;
    const previous = answers[key];
    const value = q.multiple ? input.checked ? [...(previous as string[]),input.value] : (previous as string[]).filter(id=>id!==input.value) : input.value;
    answers=updateAnswer(answers,key,value); notes=normaliseNotes(answers,notes); changed();
    if (answers.bloodwork!=='yes') {reports=[];expectedReports=[];clearUploads();}
    if (current==='bloodwork') {persist();if(input.value==='no') void save();else navigate('upload');return;}
    const selected = answers[key];
    view.querySelectorAll<HTMLInputElement>(`input[name="${input.name}"]`).forEach(item=>item.checked=Array.isArray(selected) ? selected.includes(item.value) : selected===item.value);
    view.querySelectorAll<HTMLElement>('[data-note-field]').forEach(field=>{
      const id=field.dataset.noteFor || current;
      field.hidden=!noteApplies(id,answers);
      const note=field.querySelector<HTMLInputElement>('input');if(note)note.value=notes[id]||'';
    });
    const submit = view.querySelector<HTMLButtonElement>('button[type="submit"]');if(submit)submit.disabled=Boolean(validateScreen(current,answers,notes));
    const error = view.querySelector<HTMLElement>('[data-error]');if(error)error.hidden=true;
    persist();
    if (!['basics','habits'].includes(current) && !q.multiple && !previous && !noteApplies(current,answers)) next();
  });
  root.addEventListener('input',event=>{
    if(busy || readingFiles)return;
    const input=event.target as HTMLInputElement;
    if(['age','height_cm','weight_kg'].includes(input.name)) {answers=updateAnswer(answers,input.name,input.value);const submit=view.querySelector<HTMLButtonElement>('button[type="submit"]');if(submit)submit.disabled=Boolean(validateScreen(current,answers));}
    else if(input.name==='note') {notes[input.dataset?.noteKey || current]=input.value;const submit=view.querySelector<HTMLButtonElement>('button[type="submit"]');if(submit)submit.disabled=Boolean(validateScreen(current,answers,notes));}
    else if(input.name==='firstName') firstName=input.value;
    else if(input.name==='email') email=input.value;
    else return;
    changed();persist();
  });
  root.addEventListener('dragover',event=>{if((event.target as HTMLElement).closest('[data-drop-zone]'))event.preventDefault();});
  root.addEventListener('drop',event=>{if(!(event.target as HTMLElement).closest('[data-drop-zone]'))return;event.preventDefault();void loadFiles(Array.from(event.dataTransfer?.files || []));});
  window.addEventListener('popstate',event=>{
    if(busy || readingFiles)return;
    const target=event.state?.step;
    if(target)navigate(target,true);else navigate('welcome',true);
  });
  if (current!=='success') current=missingBefore(current) || current;
  navigate(current,true);
}
