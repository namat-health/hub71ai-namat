import {
  QUESTIONS as BASE_QUESTIONS, getQuestion as baseQuestion, DETAIL_ORDER,
  EXCLUSIVE_NONE, SLEEP_TRIGGERS, NOTE_OPTIONS as BASE_NOTE_OPTIONS, NOTE_PROMPTS as BASE_NOTE_PROMPTS, NOTE_MAX,
  getContextCopy, getProfileContext,
} from '../../lib/overview-preview.mjs';

export {NOTE_MAX, getContextCopy, getProfileContext};
export const VERSION = 'namat-hackathon-welcome-v1';
export const PROGRESS = Object.freeze({
  welcome:0,goals:4,age:10,sex:15,context:20,location:24,reassurance:28,
  motivation:32,priority:37,prevention:42,history:46,symptoms:50,performance:54,
  weight:58,hormones:62,checkup:66,curiosity:70,sleep:74,family:80,
  contact:86,bloodwork:94,upload:97,success:100,
});
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
const removedQuestions = new Set(['country','pregnancy','treatment']);
export const NOTE_OPTIONS = Object.freeze(Object.fromEntries(Object.entries(BASE_NOTE_OPTIONS).filter(([id])=>!removedQuestions.has(id))));
export const NOTE_PROMPTS = Object.freeze(Object.fromEntries(Object.entries(BASE_NOTE_PROMPTS).filter(([id])=>!removedQuestions.has(id))));
const demoQuestions = Object.fromEntries(Object.entries(BASE_QUESTIONS)
  .filter(([id])=>!removedQuestions.has(id))
  .map(([id,q])=>[id,Object.freeze({...q,progress:PROGRESS[id]})]));
export const QUESTIONS = Object.freeze({
  ...demoQuestions,
  goals: Object.freeze({...demoQuestions.goals,
    options:Object.freeze([
      ...BASE_QUESTIONS.goals.options.filter(option=>option.id!=='curiosity'),
      Object.freeze({id:'uae_move',label:'Starting a new life in the UAE'}),
      ...BASE_QUESTIONS.goals.options.filter(option=>option.id==='curiosity'),
    ]),
  }),
  location: Object.freeze({...demoQuestions.location,
    options:Object.freeze(BASE_QUESTIONS.location.options.filter(option=>option.id!=='outside-uae')),
  }),
  bloodwork: Object.freeze({...demoQuestions.bloodwork,
    title:'Have you had any blood work done in the past six months?',
    options:Object.freeze([{id:'yes',label:'Yes'},{id:'no',label:'No'}]),
  }),
});
export const createAnswers = () => Object.fromEntries(Object.values(QUESTIONS).map(q=>[q.id,q.multiple ? [] : '']));
export function getQuestion(id,answers={}) {
  if (!Object.hasOwn(QUESTIONS,id)) return null;
  // Reuse only the shared option filtering for these two dynamic questions.
  if (id === 'priority' || id === 'hormones') return {...baseQuestion(id,answers),progress:PROGRESS[id]};
  return QUESTIONS[id];
}

// The temporary demo has no pregnancy, treatment or overseas screening flow.
// Every goal except curiosity alone continues through health motivations.
export function getPath(answers={}) {
  const path = ['welcome','goals','age','sex','context','location','reassurance'];
  const goals = Array.isArray(answers.goals) ? answers.goals : [];
  const curiosityOnly = goals.length === 1 && goals[0] === 'curiosity';
  const motivations = !curiosityOnly && Array.isArray(answers.motivation) ? answers.motivation : [];
  if (!curiosityOnly) path.push('motivation');
  if (motivations.length > 1) path.push('priority');
  for (const id of DETAIL_ORDER) if (id === 'curiosity' ? goals.includes(id) : motivations.includes(id)) path.push(id);
  if (Object.entries(SLEEP_TRIGGERS).some(([id,option])=>path.includes(id) && Array.isArray(answers[id]) && answers[id].includes(option))) path.push('sleep');
  path.push('family','contact','bloodwork');
  if (answers.bloodwork === 'yes') path.push('upload');
  return path;
}
function cleanValue(q,value) {
  if (!q.multiple) return q.options.some(o=>o.id===value) ? value : '';
  let selected = Array.isArray(value) ? value.filter(id=>q.options.some(o=>o.id===id)) : [];
  if (EXCLUSIVE_NONE.has(q.id) && selected.includes('none') && selected.length > 1) {
    selected = selected.at(-1) === 'none' ? ['none'] : selected.filter(id=>id!=='none');
  }
  return q.options.filter(o=>selected.includes(o.id)).map(o=>o.id);
}
export function updateAnswer(answers={},id,value) {
  const next = createAnswers();
  for (const q of Object.values(QUESTIONS)) next[q.id] = cleanValue(q,answers[q.id]);
  if (Object.hasOwn(QUESTIONS,id)) next[id] = cleanValue(QUESTIONS[id],value);
  for (const dependent of ['priority','hormones']) next[dependent] = cleanValue(getQuestion(dependent,next),next[dependent]);
  const active = new Set(getPath(next));
  for (const q of Object.values(QUESTIONS)) if (!active.has(q.id)) next[q.id] = q.multiple ? [] : '';
  return next;
}
export function noteApplies(id,answers={}) {
  const option = NOTE_OPTIONS[id];
  return Boolean(option && getPath(answers).includes(id) && (Array.isArray(answers[id]) ? answers[id].includes(option) : answers[id] === option));
}
/** @returns {Record<string,string>} */
export function normaliseNotes(answers={},notes={}) {
  /** @type {Record<string,string>} */
  const clean = {};
  if (!notes || typeof notes !== 'object' || Array.isArray(notes)) return clean;
  for (const id of Object.keys(NOTE_OPTIONS)) {
    if (!noteApplies(id,answers) || typeof notes[id] !== 'string') continue;
    const value = notes[id].replace(/[\u0000-\u001f\u007f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,NOTE_MAX);
    if (value) clean[id] = value;
  }
  return clean;
}
export function validateStep(id,answers={},_notes={}) {
  if (!getPath(answers).includes(id)) return 'This question is no longer part of your questionnaire.';
  const q = getQuestion(id,answers);
  if (!q) return null;
  const value = answers[id];
  if (q.multiple) {
    if (!Array.isArray(value) || !value.length) return 'Please choose an answer.';
    if (new Set(value).size !== value.length || value.some(item=>!q.options.some(o=>o.id===item))) return 'Choose only the available answers.';
    if (EXCLUSIVE_NONE.has(id) && value.includes('none') && value.length > 1) return 'Choose either none or the options that apply.';
  } else if (!q.options.some(o=>o.id===value)) return 'Please choose an answer.';
  return null;
}
export function validateSubmission(input={}) {
  const {answers,notes={}} = input || {};
  const errors = {};
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return {ok:false,errors:{answers:'Please complete the questionnaire.'},answers:createAnswers(),notes:{}};
  if (!notes || typeof notes !== 'object' || Array.isArray(notes)) errors.notes = 'Please review your additional details.';
  const path = getPath(answers);
  for (const id of path) {
    const error = validateStep(id,answers,notes || {});
    if (error) errors[id] = error;
  }
  for (const [id,value] of Object.entries(answers)) {
    if (!Object.hasOwn(QUESTIONS,id)) errors.answers = 'Choose only the available answers.';
    else if (!path.includes(id) && (Array.isArray(value) ? value.length > 0 : value !== '')) errors.answers = 'Please review your answers.';
  }
  if (notes && typeof notes === 'object' && !Array.isArray(notes)) {
    for (const [id,value] of Object.entries(notes)) {
      if (!Object.hasOwn(NOTE_OPTIONS,id) || typeof value !== 'string' || value.length > NOTE_MAX || /[\u0000-\u001f\u007f<>]/.test(value) || (value.trim() && !noteApplies(id,answers))) errors.notes = 'Please review your additional details.';
    }
  }
  return {ok:Object.keys(errors).length === 0,errors,answers:updateAnswer(answers),notes:normaliseNotes(answers,notes)};
}
export function getReview(answers={},notes={}) {
  return getPath(answers).filter(id=>Object.hasOwn(QUESTIONS,id)).map(id=>{
    const q = getQuestion(id,answers);
    const selected = q.multiple ? answers[id] : [answers[id]];
    const labels = q.options.filter(o=>selected?.includes(o.id)).map(o=>o.label);
    if (noteApplies(id,answers) && notes[id]) labels.push(notes[id]);
    return {id,title:q.title,value:labels.join('; ')};
  });
}
