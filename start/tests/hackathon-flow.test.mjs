import test from 'node:test';
import assert from 'node:assert/strict';
import {QUESTIONS, getPath, getQuestion} from '../src/hackathon/welcome/questionnaire-model.mjs';
import {getScreenPath, screenQuestions, screenFor, getSection, sectionVisualStep} from '../src/hackathon/welcome/questionnaire-flow.mjs';
import {answers} from './hackathon-fixtures.mjs';

test('all goal routes collect the same question IDs in five fewer screen transitions',()=>{
 for(const goals of [...QUESTIONS.goals.options.map(q=>[q.id]),QUESTIONS.goals.options.map(q=>q.id)]) {
  const a=answers({goals}),screens=getScreenPath(a),old=getPath(a);
  assert.equal(screens.length,old.length-5);
  assert.deepEqual(screens.flatMap(screenQuestions).filter(id=>getQuestion(id)),old.filter(id=>getQuestion(id)));
  assert.ok(!screens.some(id=>['context','reassurance','sex','location','tobacco','alcohol'].includes(id)));
 }
});
test('old draft and review destinations map to grouped screens without new answer keys',()=>{
 for(const id of ['age','sex','location','context','height_cm','weight_kg'])assert.equal(screenFor(id),'basics');
 for(const id of ['tobacco','alcohol'])assert.equal(screenFor(id),'habits');
 assert.equal(screenFor('reassurance',{goals:['prevention']}),'prevention');
 assert.equal(screenFor('priority',{goals:['uae_move']}),'history');
 const a=answers();assert.ok(!Object.hasOwn(a,'basics'));assert.ok(!Object.hasOwn(a,'habits'));
});
test('progress follows the active route; imagery stays fixed within each section',()=>{
 const a=answers({goals:['prevention','performance'],bloodwork:'yes'}),path=getScreenPath(a);
 let last=0;const photos=new Map();
 for(const id of path.slice(1)) {
  const section=getSection(id,a);assert.ok(section.progress>=last&&section.progress<100);last=section.progress;
  const visual=sectionVisualStep(id);if(photos.has(section.number))assert.equal(visual,photos.get(section.number));else photos.set(section.number,visual);
 }
 assert.equal(photos.size,3);assert.equal(getSection('success',a).progress,100);
});
