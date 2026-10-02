import test from 'node:test';
import assert from 'node:assert/strict';
import {getPath,updateAnswer,validateSubmission,validateStep,normaliseNotes,getReview,QUESTIONS} from '../src/hackathon/welcome/questionnaire-model.mjs';
import {answers} from './hackathon-fixtures.mjs';
test('every goal asks history, symptoms and confounders; removed screens stay removed',()=>{
 for(const goal of QUESTIONS.goals.options){const a=answers({goals:[goal.id]}),path=getPath(a);assert.equal(validateSubmission({answers:a}).ok,true);for(const id of ['history','symptoms','medicines','tobacco','alcohol'])assert.ok(path.includes(id));for(const id of ['motivation','weight','checkup','pregnancy','treatment'])assert.ok(!path.includes(id));}
});
test('exact age and optional measurements are validated without guessing missing data',()=>{
 const a=answers({age:'42',height_cm:'168.5',weight_kg:'67.2'});assert.equal(validateStep('age',a),null);assert.match(getReview(a).find(r=>r.id==='age').value,/42 years; 168.5 cm; 67.2 kg/);
 for(const age of ['41-50','17','121','42.5','NaN'])assert.ok(validateStep('age',{...a,age}));
 assert.equal(validateStep('age',{...a,height_cm:'',weight_kg:''}),null);assert.ok(validateStep('age',{...a,weight_kg:'-1'}));
});
test('family unknown is explicit; details remain optional and disappear when deselected',()=>{
 let a=answers({family:['cancer']});assert.equal(validateSubmission({answers:a}).ok,true);
 assert.equal(normaliseNotes(a,{family:'Aunt, cancer type and age unknown'}).family,'Aunt, cancer type and age unknown');
 a=updateAnswer(a,'family',['cancer','unsure']);assert.deepEqual(a.family,['unsure']);assert.deepEqual(normaliseNotes(a,{family:'Aunt'}),{});
});
test('changing merged goals clears their follow-up and priority, never the universal history',()=>{
 let a=answers({goals:['symptoms','hormones'],priority:'hormones',history:['cholesterol']});a=updateAnswer(a,'goals',['curiosity']);assert.equal(a.priority,'');assert.deepEqual(a.hormones,[]);assert.deepEqual(a.history,['cholesterol']);
});
test('multiple goals including a UAE move skip priority; older open v2 forms still submit',()=>{
 for(const goals of [['uae_move','symptoms'],['checkup','performance'],QUESTIONS.goals.options.map(option=>option.id)]) {
  const a=answers({goals});
  assert.ok(!getPath(a).includes('priority'));
  assert.ok(!getReview(a).some(row=>row.id==='priority'));
  const checked=validateSubmission({answers:{...a,priority:goals[0]}});
  assert.equal(checked.ok,true);assert.equal(checked.answers.priority,'');assert.deepEqual(checked.answers.goals,a.goals);
  assert.equal(validateSubmission({answers:{...a,priority:'unrecognised-goal'}}).ok,false);
  assert.equal(validateSubmission({answers:{...a,goals:42,priority:goals[0]}}).ok,false);
 }
});

test('server accepts in-flight v1 forms and stores their original version',async()=>{
 const v1=await import('../src/hackathon/welcome/questionnaire-v1.mjs');
 const {validateHackathonSubmission}=await import('../src/hackathon/server/api.mjs');
 const {input}=await import('./hackathon-fixtures.mjs');
 let legacy=v1.createAnswers();
 for(const [key,value]of Object.entries({goals:['curiosity'],age:'31-40',sex:'male',location:'dubai',curiosity:['other'],family:['none'],bloodwork:'no'}))legacy=v1.updateAnswer(legacy,key,value);
 const checked=validateHackathonSubmission(input({version:v1.VERSION,answers:legacy}));assert.equal(checked.ok,true);assert.equal(checked.value.version,v1.VERSION);assert.equal(checked.value.answers.age,'31-40');
});
