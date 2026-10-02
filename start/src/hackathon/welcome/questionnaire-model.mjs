import {QUESTIONS as BASE,getQuestion as baseQuestion,SLEEP_TRIGGERS,NOTE_OPTIONS as BASE_NOTES,NOTE_PROMPTS as BASE_PROMPTS,NOTE_MAX,getContextCopy as baseContext} from '../../lib/overview-preview.mjs';
export {NOTE_MAX};
export const VERSION='namat-hackathon-welcome-v2';
export const MAX_FILE_BYTES=2*1024*1024;
export const PROGRESS=Object.freeze({welcome:0,goals:4,age:11,sex:17,context:21,location:25,reassurance:29,priority:32,prevention:36,history:41,symptoms:47,performance:52,hormones:57,curiosity:61,sleep:65,medicines:70,tobacco:75,alcohol:79,family:84,contact:90,bloodwork:94,upload:97,success:100});
const removed=new Set(['country','pregnancy','treatment','motivation','weight','checkup']);
const question=(id,title,entries,multiple=false,body='')=>({id,title,body,multiple,progress:PROGRESS[id],options:entries.map(([id,label])=>({id,label}))});
export const QUESTIONS=Object.freeze({
 ...Object.fromEntries(Object.entries(BASE).filter(([id])=>!removed.has(id)).map(([id,q])=>[id,{...q,progress:PROGRESS[id]}])),
 goals:question('goals','What brings you to Namat today?',[
 ['checkup','A complete health check-up'],['prevention','Finding health risks early'],['history','Following up on past health problems'],['symptoms','Understanding symptoms or changes'],['lifestyle','Building healthier habits'],['performance','Improving my health and performance'],['hormones','Discuss symptoms that may relate to hormones'],['uae_move','Starting a new life in the UAE'],['curiosity','Just curious, exploring my options'],
 ],true,'Choose all that apply.'),
 age:question('age','A few basics about you',[],false,'Your age, height and weight help put your results in context. Leave height or weight blank if you’re not sure.'),
 location:{...BASE.location,title:'Where have you moved to?',progress:PROGRESS.location,options:BASE.location.options.filter(o=>o.id!=='outside-uae')},
 family:{...BASE.family,progress:PROGRESS.family,options:[...BASE.family.options,{id:'unsure',label:'I’m not sure'}]},
 medicines:question('medicines','Do you take any medicines or supplements?',[['yes','Yes'],['none','No'],['unsure','I’m not sure']],false,'Include prescriptions, over-the-counter medicines, vitamins and supplements.'),
 tobacco:question('tobacco','Do you use tobacco or nicotine?',[['never','I’ve never used it regularly'],['former','I used to'],['current','I currently do'],['declined','Prefer not to say']],false,'Include cigarettes, shisha, dokha, vaping and other nicotine products.'),
 alcohol:question('alcohol','How often do you drink alcohol?',[['never','Never'],['monthly','Monthly or less'],['weekly','Some days each week'],['most-days','Most days'],['declined','Prefer not to say']]),
 bloodwork:question('bloodwork','Have you had blood work in the past 12 months?',[['yes','Yes'],['no','No']],false,'Results from the past 12 months can help avoid repeating tests.'),
});
export const PROFILE_FIELDS=Object.freeze({age:{label:'Age (years)',min:18,max:120,step:1,required:true},height_cm:{label:'Height (cm, optional)',min:80,max:250,step:0.1},weight_kg:{label:'Weight (kg, optional)',min:20,max:400,step:0.1}});
export const NOTE_OPTIONS=Object.freeze({...Object.fromEntries(Object.entries(BASE_NOTES).filter(([id])=>!removed.has(id))),medicines:'yes',tobacco:'use',alcohol:'use',family:'detail'});
export const NOTE_PROMPTS=Object.freeze({...BASE_PROMPTS,
 medicines:['Names and doses, if you know them (optional)','For example: metformin 500 mg; vitamin D; biotin'],
 tobacco:['What and roughly how much? (optional)','For example: 5 cigarettes a day for 10 years; quit in 2024'],
 alcohol:['Roughly how many drinks on a usual drinking day? (optional)','For example: 1 glass of wine'],
 family:['Any details you know? (optional)','For example: father — heart attack at about 55; aunt — cancer, type unknown'],
});
const exclusive=new Set(['none','unsure']);
const empty=q=>q.multiple?[]:'';
export const createAnswers=()=>({...Object.fromEntries(Object.values(QUESTIONS).map(q=>[q.id,empty(q)])),height_cm:'',weight_kg:''});
export function getQuestion(id,answers={}) {
 if(!Object.hasOwn(QUESTIONS,id))return null;
 if(id==='priority')return {...QUESTIONS.priority,options:QUESTIONS.goals.options.filter(o=>answers.goals?.includes(o.id))};
 if(id==='hormones')return {...baseQuestion(id,answers),progress:PROGRESS[id]};
 return QUESTIONS[id];
}
export function getPath(answers={}) {
 const path=['welcome','goals','age','sex','context','location','reassurance'];
 const goals=Array.isArray(answers.goals)?answers.goals:[];
 if(goals.includes('prevention'))path.push('prevention');
 path.push('history','symptoms');
 for(const id of ['performance','hormones','curiosity'])if(goals.includes(id))path.push(id);
 if(Object.entries(SLEEP_TRIGGERS).some(([id,value])=>path.includes(id)&&Array.isArray(answers[id])&&answers[id].includes(value)))path.push('sleep');
 path.push('medicines','tobacco','alcohol','family','contact','bloodwork');
 if(answers.bloodwork==='yes')path.push('upload');
 return path;
}
const scalar=value=>typeof value==='string'?value.trim().slice(0,8):'';
function clean(q,value) {
 if(q.id==='age')return scalar(value);
 if(!q.multiple)return q.options.some(o=>o.id===value)?value:'';
 let selected=Array.isArray(value)?value.filter(id=>q.options.some(o=>o.id===id)):[];
 if(selected.some(id=>exclusive.has(id))&&selected.length>1)selected=exclusive.has(selected.at(-1))?[selected.at(-1)]:selected.filter(id=>!exclusive.has(id));
 return q.options.filter(o=>selected.includes(o.id)).map(o=>o.id);
}
export function updateAnswer(answers={},id,value) {
 const next=createAnswers();
 for(const q of Object.values(QUESTIONS))next[q.id]=clean(q,answers[q.id]);
 for(const key of ['height_cm','weight_kg'])next[key]=scalar(answers[key]);
 if(Object.hasOwn(QUESTIONS,id))next[id]=clean(QUESTIONS[id],value);
 if(['height_cm','weight_kg'].includes(id))next[id]=scalar(value);
 for(const key of ['priority','hormones'])next[key]=clean(getQuestion(key,next),next[key]);
 const active=new Set(getPath(next));
 for(const q of Object.values(QUESTIONS))if(!active.has(q.id))next[q.id]=empty(q);
 return next;
}
export function noteApplies(id,answers={}) {
 if(!getPath(answers).includes(id))return false;
 if(id==='family')return Array.isArray(answers.family)&&answers.family.some(value=>!exclusive.has(value));
 if(id==='tobacco')return ['current','former'].includes(answers.tobacco);
 if(id==='alcohol')return ['monthly','weekly','most-days'].includes(answers.alcohol);
 const option=NOTE_OPTIONS[id];
 return Boolean(option&&(Array.isArray(answers[id])?answers[id].includes(option):answers[id]===option));
}
/** @returns {Record<string,string>} */
export function normaliseNotes(answers={},notes={}) {
 /** @type {Record<string,string>} */
 const result={};if(!notes||typeof notes!=='object'||Array.isArray(notes))return result;
 for(const id of Object.keys(NOTE_OPTIONS))if(noteApplies(id,answers)&&typeof notes[id]==='string') {
  const value=notes[id].replace(/[\u0000-\u001f\u007f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,NOTE_MAX);if(value)result[id]=value;
 }
 return result;
}
export function validateStep(id,answers={},_notes={}) {
 if(!getPath(answers).includes(id))return 'This question is no longer part of your questionnaire.';
 if(id==='age') {
  for(const [key,field]of Object.entries(PROFILE_FIELDS)) {
   const value=answers[key];if((value===''||value===undefined)&&!field.required)continue;
   if(typeof value!=='string'||!/^\d+(?:\.\d)?$/.test(value)||Number(value)<field.min||Number(value)>field.max||(field.step===1&&!/^\d+$/.test(value)))return `Please enter ${key==='age'?'an age':key==='height_cm'?'a height':'a weight'} between ${field.min} and ${field.max}${key==='age'?' in whole years':key==='height_cm'?' cm':' kg'}.`;
  }
  return null;
 }
 const q=getQuestion(id,answers);if(!q)return null;
 const values=q.multiple?answers[id]:[answers[id]];
 if(!Array.isArray(values)||!values.length)return 'Please choose an answer.';
 if(new Set(values).size!==values.length||values.some(value=>!q.options.some(o=>o.id===value)))return 'Choose only the available answers.';
 if(q.multiple&&values.length>1&&values.some(value=>exclusive.has(value)))return 'Choose either none or unsure, or the options that apply.';
 return null;
}
export function validateSubmission(input={}) {
 const {answers,notes={}}=input||{},errors={};
 if(!answers||typeof answers!=='object'||Array.isArray(answers))return {ok:false,errors:{answers:'Please complete the questionnaire.'},answers:createAnswers(),notes:{}};
 const path=getPath(answers);
 for(const id of path){const error=validateStep(id,answers);if(error)errors[id]=error;}
 for(const [id,value]of Object.entries(answers)) {
  // Older v2 tabs may still send this answer. Accept valid legacy choices;
  // updateAnswer clears it because the priority screen is no longer active.
  if(id==='priority') {
   const options=Array.isArray(answers.goals)?getQuestion(id,answers).options:[];
   if(typeof value!=='string'||(value!==''&&!options.some(option=>option.id===value)))errors.answers='Please review your answers.';
   continue;
  }
  if(!Object.hasOwn(createAnswers(),id))errors.answers='Choose only the available answers.';
  else if(!['height_cm','weight_kg'].includes(id)&&!path.includes(id)&&(Array.isArray(value)?value.length>0:value!==''))errors.answers='Please review your answers.';
 }
 if(!notes||typeof notes!=='object'||Array.isArray(notes))errors.notes='Please review your additional details.';
 else for(const [id,value]of Object.entries(notes))if(!Object.hasOwn(NOTE_OPTIONS,id)||typeof value!=='string'||value.length>NOTE_MAX||/[\u0000-\u001f\u007f<>]/.test(value)||(value.trim()&&!noteApplies(id,answers)))errors.notes='Please review your additional details.';
 return {ok:!Object.keys(errors).length,errors,answers:updateAnswer(answers),notes:normaliseNotes(answers,notes)};
}
export function getReview(answers={},notes={}) {
 return getPath(answers).filter(id=>Object.hasOwn(QUESTIONS,id)).map(id=>{
  const q=getQuestion(id,answers),values=Array.isArray(answers[id])?answers[id]:[answers[id]];
  const labels=id==='age'?[answers.age&&`${answers.age} years`,answers.height_cm&&`${answers.height_cm} cm`,answers.weight_kg&&`${answers.weight_kg} kg`].filter(Boolean):q.options.filter(o=>values.includes(o.id)).map(o=>o.label);
  if(noteApplies(id,answers)&&notes[id])labels.push(notes[id]);return {id,title:q.title,value:labels.join('; ')};
 });
}
// Existing photographs use bands; the saved age remains exact.
export function getVisualAnswers(answers={}) {
 const age=Number(answers.age);
 return {...answers,age:age>=18?age<=30?'18-30':age<=40?'31-40':age<=50?'41-50':age<=60?'51-60':age<=70?'61-70':'71-plus':''};
}
export const getContextCopy=answers=>baseContext(getVisualAnswers(answers));
export const getProfileContext=(answers={})=>({age:answers.age||'',sex:answers.sex||'',label:[BASE.sex.options.find(o=>o.id===answers.sex)?.label,answers.age&&`${answers.age} years`].filter(Boolean).join(' · ')});
