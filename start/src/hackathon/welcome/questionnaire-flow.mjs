import {getPath, getQuestion, validateStep} from './questionnaire-model.mjs';

// Presentation only. The saved v2 question IDs and validation stay unchanged.
const GROUPS=Object.freeze({basics:['age','sex','location'],habits:['tobacco','alcohol']});
export function screenFor(id,answers={}) {
 if(['age','height_cm','weight_kg','sex','location','context'].includes(id))return 'basics';
 if(['tobacco','alcohol'].includes(id))return 'habits';
 if(['reassurance','priority'].includes(id))return getPath(answers).includes('prevention')?'prevention':'history';
 return id;
}
export function getScreenPath(answers={}) {
 return [...new Set(getPath(answers).filter(id=>!['context','reassurance'].includes(id)).map(id=>screenFor(id,answers)))];
}
export const screenQuestions=id=>GROUPS[id]||[id];
export function validateScreen(id,answers={},notes={}) {
 for(const key of screenQuestions(id)) {
  if(!getQuestion(key,answers))continue;
  const error=validateStep(key,answers,notes);
  if(error)return error;
 }
 return null;
}
export function getSection(id,answers={}) {
 const number=['welcome','goals','basics'].includes(id)?1:['contact','bloodwork','upload','success'].includes(id)?3:2;
 const title=['About you','Your health','Your reports'][number-1];
 const screens=getScreenPath(answers).filter(step=>step!=='welcome');
 const progress=id==='success'?100:Math.max(0,Math.round(screens.indexOf(id)/screens.length*100));
 return {number,title,progress,label:id==='success'?'Complete':`${title} · ${number} of 3`};
}
export function sectionVisualStep(id) {
 if(id==='welcome')return 'welcome';
 const {number}=getSection(id);
 return number===1?'goals':number===2?'context':'finished';
}
