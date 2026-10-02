import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnswers,getPath,getQuestion,updateAnswer,validateSubmission,normaliseNotes,PROGRESS,QUESTIONS,
  NOTE_OPTIONS,NOTE_PROMPTS,getContextCopy,getProfileContext,getReview,VERSION} from '../src/hackathon/welcome/questionnaire-model.mjs';
import {QUESTIONS as PERMANENT_QUESTIONS} from '../src/lib/overview-preview.mjs';

function complete(overrides={}) {
  let answers=createAnswers();
  for(let i=0;i<40;i++) {
    const id=getPath(answers).find(key=>{const q=getQuestion(key,answers);return q && (q.multiple ? !answers[key].length : !answers[key]);});
    if(!id)return answers;
    const q=getQuestion(id,answers);
    answers=updateAnswer(answers,id,overrides[id] ?? (q.multiple ? [q.options[0].id] : q.options[0].id));
  }
  throw new Error('The questionnaire did not finish.');
}
test('all age, sex and goal combinations finish with email before final bloodwork and working profile cards',()=>{
  for(const age of getQuestion('age').options.map(o=>o.id))for(const sex of ['female','male'])for(const goal of getQuestion('goals').options.map(o=>o.id))for(const bloodwork of ['yes','no']) {
    const answers=complete({age,sex,bloodwork,goals:[goal],curiosity:['risks']});
    const path=getPath(answers);
    assert.equal(path.filter(id=>getQuestion(id,answers)).at(-1),'bloodwork');
    assert.equal(path.at(-1),bloodwork==='yes' ? 'upload' : 'bloodwork');
    assert.equal(path[path.indexOf('bloodwork')-1],'contact');
    assert.ok(!path.some(id=>id.endsWith('-exit')));
    assert.ok(!path.some(id=>['country','pregnancy','treatment'].includes(id)));
    assert.equal(validateSubmission({answers}).ok,true);
    const profile=getProfileContext(answers),copy=getContextCopy(answers);
    assert.ok(profile.age && profile.sex && profile.label && copy.title && copy.body);
    const progress=path.map(id=>PROGRESS[id]);
    assert.ok(progress.every((p,i)=>Number.isFinite(p) && p>=0 && p<100 && (i===0 || p>progress[i-1])));
  }
});
test('the new UAE goal follows health motivations and their selected details',()=>{
  assert.equal(getQuestion('goals').options.find(o=>o.id==='uae_move')?.label,'Starting a new life in the UAE');
  for(const goals of [['uae_move'],['uae_move','curiosity']]) {
    const answers=complete({goals,motivation:['symptoms','performance'],priority:'performance',symptoms:['sleep'],sleep:['snore']});
    const path=getPath(answers);
    for(const id of ['motivation','priority','symptoms','performance','sleep'])assert.ok(path.includes(id));
    assert.equal(path.includes('curiosity'),goals.includes('curiosity'));
    assert.equal(validateSubmission({answers}).ok,true);
    assert.match(getReview(answers).find(row=>row.id==='goals').value,/Starting a new life in the UAE/);
  }
  assert.equal(getPath(complete({goals:['curiosity']})).includes('motivation'),false);
});
test('the demo accepts exactly seven Emirates and keeps the permanent questionnaire unchanged',()=>{
  const emirates=['abu-dhabi','dubai','sharjah','ajman','umm-al-quwain','ras-al-khaimah','fujairah'];
  assert.deepEqual(getQuestion('location').options.map(o=>o.id),emirates);
  for(const location of emirates)assert.equal(validateSubmission({answers:complete({location})}).ok,true);
  for(const id of ['country','pregnancy','treatment']) {
    assert.equal(getQuestion(id),null);
    assert.equal(Object.hasOwn(QUESTIONS,id),false);
    assert.equal(Object.hasOwn(createAnswers(),id),false);
    assert.ok(PERMANENT_QUESTIONS[id]);
  }
  assert.equal(Object.hasOwn(NOTE_OPTIONS,'country'),false);
  assert.equal(Object.hasOwn(NOTE_PROMPTS,'country'),false);
  assert.ok(PERMANENT_QUESTIONS.location.options.some(o=>o.id==='outside-uae'));
  assert.equal(PERMANENT_QUESTIONS.goals.options.some(o=>o.id==='uae_move'),false);
  assert.equal(VERSION,'namat-hackathon-welcome-v1');
});
test('saved drafts prune removed questions and country notes, and require a valid Emirate again',()=>{
  const stale={...complete({goals:['curiosity'],curiosity:['other']}),location:'outside-uae',country:'outside-gcc',pregnancy:'yes',treatment:'yes'};
  let cleaned=updateAnswer(stale);
  assert.equal(cleaned.location,'');
  for(const id of ['country','pregnancy','treatment'])assert.equal(Object.hasOwn(cleaned,id),false);
  const notes=normaliseNotes(cleaned,{country:'Spain',curiosity:'A fictional question'});
  assert.deepEqual(notes,{curiosity:'A fictional question'});
  assert.ok(validateSubmission({answers:cleaned,notes}).errors.location);
  cleaned=updateAnswer(cleaned,'location','dubai');
  assert.equal(validateSubmission({answers:cleaned,notes}).ok,true);
});
test('changing branches removes obsolete answers and notes',()=>{
  let answers=complete({goals:['symptoms'],motivation:['symptoms','hormones'],priority:'hormones',symptoms:['sleep','other'],hormones:['cycle'],sex:'female',sleep:['snore']});
  assert.ok(getPath(answers).includes('sleep'));
  answers=updateAnswer(answers,'symptoms',['focus-mood']);
  assert.deepEqual(answers.sleep,[]);
  assert.deepEqual(normaliseNotes(answers,{symptoms:'Old note'}),{});
  answers=updateAnswer(answers,'sex','male');
  assert.equal(Object.hasOwn(answers,'pregnancy'),false);
  assert.deepEqual(answers.hormones,[]);
  answers=updateAnswer(answers,'motivation',['symptoms']);
  assert.equal(answers.priority,'');
});
test('mutually exclusive none can be replaced in either direction',()=>{
  let answers=complete({family:['none'],bloodwork:'no'});
  answers=updateAnswer(answers,'family',['none','heart']);assert.deepEqual(answers.family,['heart']);
  answers=updateAnswer(answers,'family',['heart','none']);assert.deepEqual(answers.family,['none']);
});
test('server validation rejects inactive answers, unknown fields and oversized notes',()=>{
  const answers=complete({sex:'male',bloodwork:'no'});
  for(const id of ['pregnancy','treatment','country'])for(const value of ['', 'yes']) {
    const result=validateSubmission({answers:{...answers,[id]:value}});
    assert.equal(result.ok,false);
    assert.ok(result.errors.answers);
    assert.equal(Object.hasOwn(result.answers,id),false);
  }
  assert.equal(validateSubmission({answers:{...answers,location:'outside-uae'}}).ok,false);
  for(const country of ['', 'Spain'])assert.equal(validateSubmission({answers,notes:{country}}).ok,false);
  assert.equal(validateSubmission({answers:{...answers,hormones:['libido']}}).ok,false);
  assert.equal(validateSubmission({answers:{...answers,unknown:'anything'}}).ok,false);
  assert.equal(validateSubmission({answers,notes:{history:'x'.repeat(201)}}).ok,false);
  assert.equal(validateSubmission({answers,notes:[]}).ok,false);
});
test('progress follows the longest detail path and matches each question metadata',()=>{
  const answers=complete({goals:['uae_move','curiosity'],motivation:getQuestion('motivation').options.map(o=>o.id),
    symptoms:['sleep'],performance:['sleep'],sleep:['snore'],bloodwork:'yes'});
  const path=getPath(answers);
  assert.equal(validateSubmission({answers}).ok,true);
  for(let i=1;i<path.length;i++)assert.ok(PROGRESS[path[i]]>PROGRESS[path[i-1]],`${path[i-1]} → ${path[i]}`);
  for(const id of path)if(getQuestion(id,answers))assert.equal(getQuestion(id,answers).progress,PROGRESS[id]);
  assert.equal(PROGRESS.success,100);
});
