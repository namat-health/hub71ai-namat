import test from 'node:test';
import assert from 'node:assert/strict';
import {VERSION,PROGRESS,QUESTIONS,createAnswers,getQuestion,getPath,updateAnswer,validateStep,buildOverview,getCoverageCopy,noteApplies,normaliseNotes,getGeography,getProfileContext,getAnswerAcknowledgement,validateCountryName,buildOverviewForVersion} from '../src/lib/overview-preview.mjs';

const detailOrder = ['prevention','history','symptoms','performance','weight','hormones','checkup','curiosity'];
const empty = id => QUESTIONS[id].multiple ? [] : '';
const apply = (state,changes) => Object.entries(changes).reduce((answers,[id,value])=>updateAnswer(answers,id,value),state);
function ready(goals=['checkup']) {
  return apply(createAnswers(),{goals,age:'31-40',sex:'male',location:'abu-dhabi',treatment:'no'});
}
function complete(goals=['checkup']) {
  let answers = ready(goals);
  const motivation = getQuestion('motivation',answers).options.map(option=>option.id);
  answers = updateAnswer(answers,'motivation',motivation);
  return finish(answers);
}
// Answer whatever the path still needs: the first option (in follow-up order for
// priority), and “none” for family history.
function finish(answers) {
  for (let guard=0;guard<40;guard++) {
    const missing=getPath(answers).find(id=>QUESTIONS[id] && validateStep(id,answers));
    if (!missing) return answers;
    const q=getQuestion(missing,answers);
    const first=missing==='priority' ? detailOrder.find(id=>q.options.some(option=>option.id===id)) : q.options[0].id;
    answers=updateAnswer(answers,missing,missing==='family' ? ['none'] : q.multiple ? [first] : first);
  }
  throw new Error('journey did not complete');
}

test('follow-ups run in the same order as the reasons on screen 10',()=>{
  assert.deepEqual(detailOrder.filter(id=>id!=='curiosity'),QUESTIONS.motivation.options.map(option=>option.id).filter(id=>id!=='lifestyle'));
  let state=createAnswers();
  for (const [id,value] of [['goals',['checkup','curiosity']],['age','41-50'],['sex','female'],['pregnancy','no'],['treatment','no'],['location','dubai'],['motivation',QUESTIONS.motivation.options.map(option=>option.id)],['symptoms',['energy','sleep']]]) state=updateAnswer(state,id,value);
  const path=getPath(state);
  assert.deepEqual(path.filter(id=>detailOrder.includes(id)),detailOrder);
  // The progress bar only ever moves forward along the longest route.
  const values=path.map(id=>PROGRESS[id]);
  assert.ok(values.every((value,i)=>i===0 || value>values[i-1]),values.join(','));
});

test('the preview contains the approved questions and reference progress weights',()=>{
  assert.equal(VERSION,'namat-overview-preview-v5');
  assert.equal(QUESTIONS.age.options.length,6);
  assert.equal(QUESTIONS.country.options.length,6);
  assert.equal(QUESTIONS.location.options.length,8);
  assert.equal(PROGRESS.contact,86);
  assert.equal(PROGRESS['pregnancy-exit'],24);
  assert.equal(PROGRESS['treatment-exit'],31);
  assert.equal(getQuestion('unknown'),null);
  assert.equal(getQuestion('__proto__'),null);
  assert.deepEqual(updateAnswer(createAnswers(),'__proto__',['anything']),createAnswers());
});

test('all 31 nonempty goal combinations expose eight motivations except the curiosity-only route',()=>{
  const goals = QUESTIONS.goals.options.map(option=>option.id);
  const allMotivations = QUESTIONS.motivation.options.map(option=>option.id);
  for (let mask=1;mask<32;mask++) {
    const chosen=goals.filter((_,index)=>mask & (1<<index));
    const answers=complete(chosen);
    const curiosityOnly=chosen.length===1 && chosen[0]==='curiosity';
    assert.equal(getQuestion('motivation',answers).options.length,8,chosen.join(','));
    assert.deepEqual(answers.motivation,curiosityOnly ? [] : allMotivations,chosen.join(','));
    const expectedDetails=detailOrder.filter(id=>id==='curiosity' ? chosen.includes('curiosity') : !curiosityOnly);
    const path=getPath(answers);
    assert.deepEqual(path.filter(id=>detailOrder.includes(id)),expectedDetails);
    assert.equal(path.includes('motivation'),!curiosityOnly);
    assert.deepEqual(path.slice(0,5),['welcome','goals','age','sex','context']);
    assert.ok(!path.includes('examples'));
    assert.ok(!path.includes('coverage'));
    assert.equal(path[path.indexOf('context')+1],'location');
    assert.ok(!path.includes('country'));
    assert.equal(path[path.indexOf('treatment')+1],'reassurance');
    assert.equal(validateStep('contact',answers),null,chosen.join(','));
    const overview=buildOverview(answers);
    assert.equal(overview.goals.length,chosen.length);
    assert.deepEqual(overview.topics.map(topic=>topic.id),expectedDetails);
    assert.equal(overview.prompts.length,expectedDetails.length);
    assert.equal(path.at(-1),'contact');
  }
});

test('screening exits terminate the path and permanently clear later answers',()=>{
  let state=complete(QUESTIONS.goals.options.map(option=>option.id));
  state=updateAnswer(state,'treatment','yes');
  assert.equal(getPath(state).at(-1),'treatment-exit');
  for (const id of ['motivation',...detailOrder,'family']) assert.deepEqual(state[id],QUESTIONS[id].multiple ? [] : '');
  assert.deepEqual(buildOverview(state).topics,[]);
  assert.deepEqual(buildOverview(state).prompts,[]);
  state=updateAnswer(state,'treatment','no');
  assert.equal(state.location,'abu-dhabi');
  assert.ok(validateStep('contact',state));
  state=updateAnswer(complete(),'sex','female');
  assert.equal(state.pregnancy,'');
  assert.ok(validateStep('pregnancy',state));
  state=updateAnswer(state,'pregnancy','yes');
  assert.equal(getPath(state).at(-1),'pregnancy-exit');
  assert.equal(state.treatment,'');
  assert.equal(state.location,'abu-dhabi');
  assert.deepEqual(state.motivation,[]);
  assert.deepEqual(buildOverview(state).prompts,[]);
  state=updateAnswer(state,'pregnancy','no');
  assert.equal(state.treatment,'');
});

test('sex changes clear pregnancy and require a newly applicable answer',()=>{
  let state=updateAnswer(complete(),'sex','female');
  state=updateAnswer(state,'pregnancy','no');
  assert.equal(validateStep('contact',state),null);
  state=updateAnswer(state,'sex','male');
  assert.equal(state.pregnancy,'');
  assert.ok(!getPath(state).includes('pregnancy'));
  state=updateAnswer(state,'sex','female');
  assert.equal(state.pregnancy,'');
  assert.ok(validateStep('contact',state));
});

test('goal edits retain all chosen motivations, and deselecting a motivation clears its detail answers',()=>{
  let state=complete(['checkup','symptoms','curiosity']);
  const initial=structuredClone(state);
  state=updateAnswer(state,'goals',['symptoms']);
  assert.deepEqual(state.motivation,initial.motivation);
  for (const id of detailOrder.filter(id=>id!=='curiosity')) assert.deepEqual(state[id],initial[id]);
  assert.deepEqual(state.curiosity,[]);
  assert.deepEqual(initial.goals,['checkup','symptoms','curiosity']);
  assert.deepEqual(buildOverview(state).topics.map(topic=>topic.id),detailOrder.filter(id=>id!=='curiosity'));
  state=updateAnswer(state,'motivation',['lifestyle']);
  for (const id of detailOrder.filter(id=>id!=='lifestyle')) assert.deepEqual(state[id],empty(id));
  assert.equal(state.lifestyle,undefined);
  assert.deepEqual(buildOverview(state).topics,[]);
  assert.equal(buildOverview(state).priority,'Build healthier habits');
  state=updateAnswer(state,'motivation',['symptoms','lifestyle']);
  assert.deepEqual(state.symptoms,[]);
  assert.ok(validateStep('symptoms',state));
  assert.ok(!buildOverview(state).topics.some(topic=>topic.id==='symptoms'));
  state=updateAnswer(state,'goals',['curiosity']);
  assert.deepEqual(state.motivation,[]);
  assert.equal(state.lifestyle,undefined);
  assert.deepEqual(getPath(state).filter(id=>detailOrder.includes(id)),['curiosity']);
});

test('none is exclusive in both toggle directions but curiosity unsure is not',()=>{
  for (const id of ['symptoms','history','family']) {
    let state=complete(['prevention']);
    const first=QUESTIONS[id].options[0].id;
    state=updateAnswer(state,id,[first,'none']);
    assert.deepEqual(state[id],['none']);
    state=updateAnswer(state,id,['none',first]);
    assert.deepEqual(state[id],[first]);
    assert.ok(validateStep(id,{...state,[id]:[first,'none']}));
  }
  let state=complete(['curiosity']);
  state=updateAnswer(state,'curiosity',['unsure','heart']);
  assert.deepEqual(state.curiosity,['heart','unsure']);
  assert.equal(validateStep('curiosity',state),null);
});

test('overview does not invent concerns, risks, tests or prompts for denied concerns',()=>{
  let state=ready(['prevention']);
  state=apply(state,{motivation:['history','symptoms'],symptoms:['none'],history:['none'],family:['none']});
  const overview=buildOverview(state);
  assert.deepEqual(overview.topics,[]);
  assert.deepEqual(overview.prompts,['What would be a useful starting point for a conversation about my health?']);
  assert.equal(overview.recap.find(item=>item.id==='family').value,'None that I know of');
  assert.equal(overview.recap.find(item=>item.id==='history').value,'None of these');
  assert.equal(overview.recap.find(item=>item.id==='symptoms').value,'I don’t have any symptoms');
  assert.ok(!overview.recap.some(item=>item.id==='pregnancy'));
  const dirty={...state,prevention:['cancer'],curiosity:['reproductive'],symptoms:['none','energy']};
  const safe=buildOverview(dirty);
  assert.deepEqual(safe.topics,[]);
  assert.ok(!safe.recap.some(item=>item.id==='prevention'||item.id==='curiosity'||item.id==='symptoms'));
  assert.ok(validateStep('contact',dirty));
});

test('a broad overview remains its own choice, without inferred topic domains',()=>{
  let state=ready(['prevention']);
  state=apply(state,{motivation:['prevention'],prevention:['broad'],family:['none']});
  assert.deepEqual(state.prevention,['broad']);
  assert.deepEqual(buildOverview(state).topics[0].items,['A general overview']);
});

test('validation rejects missing, duplicated, unknown and stale hidden answers',()=>{
  const state=complete();
  for (const goals of [[],['checkup','checkup'],['invented'],'checkup']) assert.ok(validateStep('goals',{...state,goals}));
  assert.ok(validateStep('age',{...state,age:'under-18'}));
  assert.ok(validateStep('pregnancy',state));
  assert.ok(validateStep('unknown',state));
  assert.ok(validateStep('contact',{...state,curiosity:['heart']}));
  assert.ok(validateStep('contact',{...state,extra:'unapproved'}));
  assert.equal(validateStep('contact',state),null);
  assert.deepEqual(updateAnswer(state,'goals',['checkup','checkup','bad']).goals,['checkup']);
  assert.deepEqual(updateAnswer(state,'motivation',['performance']).motivation,['performance']);
  assert.deepEqual(updateAnswer(state,'motivation',['invented']).motivation,[]);
});

test('location describes plans and does not promise availability',()=>{
  for (const option of QUESTIONS.location.options.filter(item=>item.id!=='outside-uae')) {
    const copy=getCoverageCopy({location:option.id});
    assert.ok(copy.includes(option.label));
    assert.match(copy,/when there’s news about availability/);
    assert.doesNotMatch(copy,/initial focus|Abu Dhabi;/);
  }
});

test('each of the 255 motivation combinations includes only its selected follow-ups',()=>{
  const motivations=QUESTIONS.motivation.options.map(option=>option.id);
  for (let mask=1;mask<256;mask++) {
    const chosen=motivations.filter((_,index)=>mask & (1<<index));
    const state=finish(updateAnswer(complete(['checkup']),'motivation',chosen));
    const expectedDetails=detailOrder.filter(id=>chosen.includes(id));
    assert.deepEqual(getPath(state).filter(id=>detailOrder.includes(id)),expectedDetails);
    assert.deepEqual(buildOverview(state).topics.map(topic=>topic.id),expectedDetails);
    for (const id of detailOrder.filter(id=>!chosen.includes(id))) assert.deepEqual(state[id],empty(id));
    assert.equal(getPath(state).includes('priority'),chosen.length>1);
    assert.ok(!getPath(state).includes('cravings'));
    assert.ok(!getPath(state).includes('lifestyle'));
    assert.ok(!getPath(state).includes('energy'));
    assert.equal(validateStep('contact',state),null);
  }
});

test('the first priority is asked only for two or more reasons and leads the overview',()=>{
  let state=finish(apply(ready(['checkup']),{motivation:['weight']}));
  assert.ok(!getPath(state).includes('priority'));
  assert.equal(buildOverview(state).priority,'Lose weight or body fat');
  state=updateAnswer(state,'motivation',['symptoms','weight','hormones']);
  assert.deepEqual(getQuestion('priority',state).options.map(option=>option.id),['symptoms','weight','hormones']);
  assert.ok(validateStep('priority',{...state,priority:'checkup'}),'only chosen reasons can be the priority');
  state=finish(updateAnswer(state,'priority','hormones'));
  const overview=buildOverview(state);
  assert.equal(overview.priority,'Balance my hormones');
  assert.equal(overview.topics[0].id,'hormones','the priority topic comes first');
  assert.equal(overview.prompts[0],'Which hormone checks would make sense for me, given how I feel?');
  state=updateAnswer(state,'motivation',['symptoms','weight']);
  assert.equal(state.priority,'','a priority that is no longer chosen is cleared');
  assert.ok(validateStep('contact',state));
});

test('weight no longer adds cravings, while hormones hides female-only options from others',()=>{
  let state=finish(apply(ready(['checkup']),{motivation:['weight','hormones']}));
  const path=getPath(state);
  assert.deepEqual(path.slice(path.indexOf('weight'),path.indexOf('weight')+2),['weight','hormones']);
  assert.ok(!Object.hasOwn(state,'cravings'));
  assert.ok(!getQuestion('hormones',state).options.some(option=>['cycle','menopause'].includes(option.id)));
  assert.deepEqual(updateAnswer(state,'hormones',['cycle','libido']).hormones,['libido'],'male answers cannot include cycle options');
  let female=finish(apply(ready(['checkup']),{sex:'female',pregnancy:'no',treatment:'no',location:'dubai',motivation:['hormones']}));
  assert.ok(getQuestion('hormones',female).options.some(option=>option.id==='menopause'));
  female=updateAnswer(female,'hormones',['menopause']);
  assert.deepEqual(female.hormones,['menopause']);
  assert.deepEqual(updateAnswer(female,'sex','male').hormones,[],'switching to male removes female-only answers');
});

test('sleep remains conditional and daytime energy is never added',()=>{
  let state=finish(apply(ready(['checkup']),{motivation:['symptoms']}));
  state=updateAnswer(state,'symptoms',['weight']);
  assert.ok(!getPath(state).includes('sleep'));
  state=finish(updateAnswer(state,'symptoms',['energy','sleep']));
  assert.ok(!getPath(state).includes('energy') && getPath(state).includes('sleep'));
  assert.equal(buildOverview(apply(state,{sleep:['none']})).prompts.length,1);
  const flagged=buildOverview(apply(state,{sleep:['snore','unrested']}));
  assert.ok(!flagged.prompts.includes('What could explain the way my energy changes through the day?'));
  assert.ok(flagged.prompts.includes('Is my sleep worth looking into further, for example for sleep apnoea?'));
  state=updateAnswer(state,'sleep',['snore','none']);
  assert.deepEqual(state.sleep,['none']);
  state=updateAnswer(state,'symptoms',['weight']);
  assert.deepEqual(state.sleep,[]);
  const curious=finish(apply(ready(['curiosity']),{curiosity:['energy']}));
  assert.ok(!getPath(curious).includes('energy'));
});

test('everyone is asked about recent blood tests, and family history includes stroke and early death',()=>{
  for (const goals of [['curiosity'],['checkup','symptoms']]) {
    const path=getPath(complete(goals));
    assert.equal(path[path.indexOf('family')+1],'bloodwork');
  }
  assert.deepEqual(QUESTIONS.bloodwork.options.map(option=>option.id),['yes','no','unsure']);
  const family=QUESTIONS.family.options.map(option=>option.id);
  assert.ok(family.includes('stroke') && family.includes('early'));
  assert.equal(family.at(-1),'none');
});

test('“Other” opens an optional note, and historical country free text is discarded',()=>{
  let state=finish(apply(ready(['checkup']),{location:'outside-uae',country:'oman',motivation:['symptoms','history']}));
  state=finish(updateAnswer(state,'symptoms',['energy','other']));
  assert.ok(!noteApplies('location',state) && noteApplies('symptoms',state));
  assert.ok(!noteApplies('history',state),'no note unless “Other” is chosen');
  assert.ok(!noteApplies('family',state),'questions without an “Other” option never take notes');
  const notes=normaliseNotes(state,{location:'  Oman\n',symptoms:'numb <i>fingers</i>',history:'dropped',extra:'dropped',performance:42});
  assert.deepEqual(notes,{symptoms:'numb i fingers /i'});
  assert.equal(normaliseNotes(state,{symptoms:'x'.repeat(500)}).symptoms.length,200);
  assert.deepEqual(normaliseNotes(state,'not an object'),{});
  const recap=buildOverview(state,notes).recap;
  assert.equal(recap.find(row=>row.id==='country').value,'Oman');
  assert.equal(recap.find(row=>row.id==='location').value,'Outside the UAE');
  assert.match(recap.find(row=>row.id==='symptoms').value,/Other: numb i fingers \/i$/);
  state=updateAnswer(state,'symptoms',['energy']);
  assert.deepEqual(normaliseNotes(state,notes),{},'unticking “Other” drops its note');
});

test('emirates continue directly and all other GCC countries follow the country screen',()=>{
  const local=complete();
  assert.equal(getPath(local)[5],'location');
  assert.ok(!getPath(local).includes('country'));
  assert.equal(local.country,'');
  assert.deepEqual(getGeography(local),{countryCode:'uae',emirate:'abu-dhabi'});
  for (const country of QUESTIONS.country.options.filter(item=>item.id!=='outside-gcc')) {
    const state=finish(apply(ready(),{location:'outside-uae',country:country.id}));
    assert.equal(getPath(state)[6],'country');
    assert.equal(validateStep('contact',state),null,country.id);
    assert.equal(state.location,'outside-uae');
    assert.ok(buildOverview(state).recap.some(row=>row.id==='country' && row.value===country.label));
    assert.deepEqual(getGeography(state),{countryCode:country.id,emirate:''});
  }
});

test('another country goes straight to geographical interest and clears all later answers',()=>{
  for (const choice of [{sex:'female',pregnancy:'yes'},{treatment:'yes'}]) {
    let state=apply(complete(),choice);
    assert.match(getPath(state).at(-1),/^(pregnancy|treatment)-exit$/);
    state=apply(state,{location:'outside-uae',country:'outside-gcc'});
    assert.deepEqual(getPath(state),['welcome','goals','age','sex','context','location','country','geography-exit']);
    for (const id of ['pregnancy','treatment','motivation','family']) assert.deepEqual(state[id],empty(id));
    assert.deepEqual(buildOverview(state).topics,[]);
    assert.deepEqual(getGeography(state),{countryCode:'outside-gcc',emirate:''});
    assert.ok(noteApplies('country',state));
    assert.deepEqual(normaliseNotes(state,{country:'  United Kingdom  ',symptoms:'discard'}),{country:'United Kingdom'});
    assert.equal(buildOverview(state,{country:'United Kingdom'}).recap.find(row=>row.id==='country').value,'Another country: United Kingdom');
  }
});

test('returning to an emirate clears country and its free text',()=>{
  let state=apply(complete(),{location:'outside-uae',country:'outside-gcc'});
  state=updateAnswer(state,'location','dubai');
  assert.equal(state.country,'');
  assert.deepEqual(normaliseNotes(state,{country:'France'}),{});
  assert.ok(!getPath(state).includes('country'));
  assert.deepEqual(getGeography(state),{countryCode:'uae',emirate:'dubai'});
});

test('country text has a bounded, explicit validation rule',()=>{
  assert.equal(validateCountryName('United Kingdom'),null);
  assert.equal(validateCountryName('المغرب'),null);
  for (const value of ['',null,42,'a','x'.repeat(81),'<France>']) assert.ok(validateCountryName(value));
});

test('profile and acknowledgement helpers use only stated answers',()=>{
  assert.deepEqual(getProfileContext({age:'41-50',sex:'female'}),{age:'41–50',sex:'Female',label:'Female · 41–50'});
  assert.deepEqual(getProfileContext({age:'invented',sex:'invented'}),{age:'',sex:'',label:''});
  const state=finish(apply(ready(),{motivation:['symptoms'],symptoms:['sleep'],sleep:['none']}));
  const card=getAnswerAcknowledgement({...state,history:['cholesterol'],energy:'low'});
  assert.deepEqual(card.goals,['A complete health check-up']);
  assert.equal(card.priority,'Understand my symptoms');
  assert.deepEqual(card.topics,[{id:'symptoms',items:['Sleep problems']}]);
  assert.equal(card.family,'None that I know of');
  assert.equal(card.bloodwork,'Yes');
  assert.equal(card.motivations,'Understand my symptoms');
});

test('v4 overviews retain old question recaps while v5 rejects their answers',async()=>{
  const legacy=await import('../src/lib/overview-preview-v4.mjs');
  let old=legacy.createAnswers();
  const input={goals:['checkup'],age:'31-40',sex:'male',country:'uae',location:'dubai',treatment:'no',motivation:['lifestyle','weight','symptoms'],priority:'lifestyle',lifestyle:['other'],weight:'gained',cravings:'often',symptoms:['energy'],energy:'low',family:['none'],bloodwork:'no'};
  for (const [id,value] of Object.entries(input)) old=legacy.updateAnswer(old,id,value);
  assert.equal(legacy.validateStep('contact',old),null);
  const overview=buildOverviewForVersion(legacy.VERSION,old,{lifestyle:'Started night shifts'});
  assert.ok(overview.recap.some(row=>row.id==='cravings' && row.value==='Often'));
  assert.ok(overview.recap.some(row=>row.id==='energy' && row.value==='I often feel tired'));
  assert.ok(overview.recap.some(row=>row.id==='lifestyle' && row.value.includes('Started night shifts')));
  assert.equal(overview.recap.find(row=>row.id==='country').value,'United Arab Emirates');
  assert.deepEqual(overview,legacy.buildOverview(old,{lifestyle:'Started night shifts'}));
  assert.ok(validateStep('contact',old));
  assert.throws(()=>buildOverviewForVersion('unrecognised',old),/not supported/);
  const current=complete();
  assert.deepEqual(buildOverviewForVersion(VERSION,current),buildOverview(current));
});
