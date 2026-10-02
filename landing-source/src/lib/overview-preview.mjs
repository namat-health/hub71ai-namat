/** Current questionnaire model. No storage, network, clinical scoring or model calls. */
import * as v4 from './overview-preview-v4.mjs';
export const VERSION = 'namat-overview-preview-v5';
export const PROGRESS = Object.freeze({
  welcome:0, goals:3, age:10, sex:14, context:17,
  pregnancy:21, 'pregnancy-exit':24, treatment:28, 'treatment-exit':31,
  location:18, country:19, 'geography-exit':20, reassurance:45, motivation:48, priority:50, prevention:52,
  history:55, symptoms:58, performance:64, weight:66,
  hormones:70, checkup:71, curiosity:72, sleep:74,
  family:76, bloodwork:78, transition:79, summary:83, contact:86,
});
const options = (entries) => entries.map(([id,label]) => Object.freeze({id,label}));
const question = (id,title,entries,multiple=true,body='') => Object.freeze({
  id,title,body,multiple,options:Object.freeze(options(entries)),progress:PROGRESS[id],
});
// Reasons on screen 10; the first-priority question offers the same labels.
const REASONS = [
  ['prevention','Prevent health problems in the future'],['history','Follow up on past health problems'],
  ['symptoms','Understand my symptoms'],['lifestyle','Build healthier habits'],
  ['performance','Feel and perform better every day'],['weight','Lose weight or body fat'],
  ['hormones','Balance my hormones'],['checkup','Get a full picture of my health today'],
];
export const QUESTIONS = Object.freeze({
  goals:question('goals','What brings you to Namat today?',[
    ['checkup','A complete health check-up'],['prevention','Finding health risks early'],
    ['symptoms','Understanding symptoms or changes'],['performance','Improving my health and performance'],
    ['curiosity','Just curious, exploring my options'],
  ],true,'Your answers help us ask the right questions and build an overview that’s relevant to you.'),
  age:question('age','What is your age?',[
    ['18-30','18–30'],['31-40','31–40'],['41-50','41–50'],['51-60','51–60'],['61-70','61–70'],['71-plus','71 and above'],
  ],false,'Your age helps us understand your health needs.'),
  sex:question('sex','Are you male or female?',[
    ['female','Female'],['male','Male'],
  ],false,'Some health checks are different for men and women.'),
  pregnancy:question('pregnancy','Are you currently pregnant?',[
    ['yes','Yes'],['no','No'],
  ],false,'Pregnancy needs a different kind of care, so we need to know.'),
  treatment:question('treatment','Are you currently under treatment for a serious illness?',[
    ['no','No'],['yes','Yes'],
  ],false,'Such as cancer, heart disease, advanced organ disease or a major neurological condition, under a specialist’s care.'),
  country:question('country','Which country do you live in?',[
    ['bahrain','Bahrain'],['kuwait','Kuwait'],['oman','Oman'],['qatar','Qatar'],['saudi-arabia','Saudi Arabia'],['outside-gcc','Another country'],
  ],false,'This helps us keep you informed about availability near you.'),
  location:question('location','Where do you live?',[
    ['abu-dhabi','Abu Dhabi'],['dubai','Dubai'],['sharjah','Sharjah'],['ajman','Ajman'],
    ['umm-al-quwain','Umm Al Quwain'],['ras-al-khaimah','Ras Al Khaimah'],['fujairah','Fujairah'],['outside-uae','Outside the UAE'],
  ],false,'This helps us tell you what’s available near you.'),
  motivation:question('motivation','What made you want to check your health now?',REASONS,true,'Choose all that apply.'),
  // Priority, weight, hormones, sleep and blood tests were introduced in v3;
  // their content (not just wording) still awaits Dr. Bravo's review.
  priority:question('priority','What would you like to improve first?',REASONS,false,'Choose one to focus on first.'),
  prevention:question('prevention','Which health risks would you like to prevent?',[
    ['heart','Heart and blood pressure'],['metabolism','Diabetes and blood sugar'],['hormones','Hormones'],
    ['brain','Brain health and memory'],['cancer','Cancer'],['reproductive','Reproductive health'],
    ['inherited','Conditions that run in my family'],['broad','A general overview'],['other','Something else'],
  ],true,'Choose all that apply.'),
  checkup:question('checkup','What would make this check-up worth it for you?',[
    ['risks','Know my health risks'],['measurements','Understand my test results'],['guidance','Get advice from a doctor'],
    ['priorities','Clear priorities'],['plan','A long-term health plan'],['reassurance','Peace of mind'],
  ],true,'Choose all that apply.'),
  symptoms:question('symptoms','What symptoms or health concerns do you have?',[
    ['energy','Low energy or tiredness'],['weight','Weight changes'],['focus-mood','Focus or mood'],['sleep','Sleep problems'],['recovery','Slow recovery'],
    ['skin-hair','Skin or hair problems'],['digestion','Stomach or digestion'],['movement','Joint pain or stiffness'],['other','Other'],['none','I don’t have any symptoms'],
  ],true,'Choose all that apply. If yours isn’t listed, choose ‘Other’ and your doctor will ask about it.'),
  history:question('history','Do you have a history of any of the following?',[
    ['cholesterol','High cholesterol'],['blood-pressure','High blood pressure'],['blood-sugar','High blood sugar or diabetes'],['hormones','Hormone problems'],
    ['reproductive','Reproductive health problems'],['autoimmune','Autoimmune conditions'],['stress-anxiety','Stress or anxiety'],
    ['injury','Past injuries'],['other','Other'],['none','None of these'],
  ],true,'This helps your doctor see patterns and decide what to keep an eye on.'),
  performance:question('performance','What would you like to improve day to day?',[
    ['energy','More energy'],['clarity','Clearer thinking'],['strength','Strength and fitness'],['sleep','Better sleep'],
    ['recovery','Faster recovery'],['mood','Better mood'],['injury','Recovering from an injury'],['other','Something else'],
  ],true,'Choose all that apply.'),
  weight:question('weight','How has your weight changed over the last 12 months?',[
    ['stable','It’s stayed about the same'],['gained','It has gone up'],['lost','It has gone down'],
  ],false,''),
  hormones:question('hormones','Why do you want to check your hormones?',[
    ['cycle','Changes in my periods'],['menopause','Pre-menopause or menopause symptoms'],
    ['energy-mood','Low energy or low mood'],['libido','Low libido'],['body','Changes in weight or muscle'],
    ['skin-hair','Skin or hair changes'],['check','I just want them checked'],['other','Something else'],
  ],true,'Choose all that apply.'),
  curiosity:question('curiosity','What would you like to know more about?',[
    ['metabolism','Weight and metabolism'],['reproductive','Reproductive health'],['heart','Heart health'],
    ['energy','Energy levels'],['clarity','Focus and memory'],['risks','General health risks'],
    ['other','Something else'],['unsure','I’m not sure where to start'],
  ],true,'Choose all that interest you.'),
  sleep:question('sleep','How is your sleep?',[
    ['unrested','I often wake up feeling tired'],['snore','I snore, or I’ve been told I snore'],['none','Neither of these'],
  ],true,'Choose any that apply.'),
  family:question('family','Do any of these run in your family?',[
    ['heart','Heart disease'],['stroke','Stroke'],['metabolic','Diabetes, cholesterol or weight problems'],['cancer','Cancer'],
    ['bone-joint','Bone and joint problems'],['hormonal','Hormone problems'],['neurological','Neurological conditions (e.g. dementia)'],
    ['autoimmune','Autoimmune diseases'],['inherited','Genetic conditions'],['reproductive','Fertility or reproductive problems'],
    ['early','Someone died before 60'],['none','None that I know of'],
  ],true,'Some conditions run in families, so this helps us tailor your check-up.'),
  bloodwork:question('bloodwork','Have you done any blood tests in the past 6 months?',[
    ['yes','Yes'],['no','No'],['unsure','I don’t remember'],
  ],false,'Recent results can help avoid repeating tests.'),
});
// Follow-ups run in the same order as the reasons on screen 10; curiosity,
// which comes from the goals screen, runs last.
export const DETAIL_ORDER = [...REASONS.map(([id]) => id).filter(id=>id!=='lifestyle'),'curiosity'];
export const EXCLUSIVE_NONE = new Set(['symptoms','history','family','sleep']);
// Short follow-ups shown only when a follow-up answer deserves a doctor's attention.
// Kept empty for the route-map tooling. Daytime energy no longer adds a question.
export const ENERGY_TRIGGERS = Object.freeze({});
export const SLEEP_TRIGGERS = Object.freeze({symptoms:'sleep',performance:'sleep'});
export const FEMALE_ONLY = Object.freeze({hormones:Object.freeze(['cycle','menopause'])});
// Options that open a short, optional text box. The text travels in a separate
// notes map and is kept only while that option is chosen on the active path.
export const NOTE_OPTIONS = Object.freeze({prevention:'other',symptoms:'other',history:'other',performance:'other',hormones:'other',curiosity:'other',country:'outside-gcc'});
export const NOTE_MAX = 200;
// [box label, placeholder] for each note.
export const NOTE_PROMPTS = Object.freeze({
  prevention:['What other health risk? (optional)','Type here'],
  symptoms:['What other symptom or concern? (optional)','Type here'],
  history:['What other health problem? (optional)','Type here'],
  performance:['What else would you like to improve? (optional)','Type here'],
  country:['Which country do you live in?','Enter your country'],
  hormones:['Tell us a little more (optional)','Type here'],
  curiosity:['What else would you like to know about? (optional)','Type here'],
});
const DISCUSSION_PROMPTS = Object.freeze({
  prevention:'How could my personal and family history inform what we discuss about prevention?',
  checkup:'What information would help us establish a useful starting point?',
  symptoms:'What details about these changes should I bring to a consultation?',
  history:'Which previous results or records would be helpful to review?',
  performance:'How could we define useful goals and follow progress?',
  lifestyle:'Which changes in my routine would be helpful to discuss?',
  weight:'What could be behind the changes in my weight, and what is worth checking?',
  hormones:'Which hormone checks would make sense for me, given how I feel?',
  curiosity:'Where would you suggest we begin, based on my interests?',
});
const EXTRA_PROMPTS = Object.freeze({
  sleep:'Is my sleep worth looking into further, for example for sleep apnoea?',
});
const selected = (value) => Array.isArray(value) ? value : [];
const knownSelections = (q,value) => q.options.filter(option => selected(value).includes(option.id)).map(option=>option.id);

export function createAnswers() {
  return Object.fromEntries(Object.values(QUESTIONS).map(q => [q.id,q.multiple ? [] : '']));
}
// Priority offers only the reasons chosen on motivation; female-only options
// are removed from hormones for everyone else.
export function getQuestion(id, answers={}) {
  if (!Object.hasOwn(QUESTIONS,id)) return null;
  const q = QUESTIONS[id];
  if (id === 'priority') {
    const chosen = knownSelections(QUESTIONS.motivation,answers.motivation);
    return {...q,options:q.options.filter(option=>chosen.includes(option.id))};
  }
  if (Object.hasOwn(FEMALE_ONLY,id) && answers.sex !== 'female') return {...q,options:q.options.filter(option=>!FEMALE_ONLY[id].includes(option.id))};
  return q;
}
export function getPath(answers={}) {
  const path = ['welcome','goals','age','sex','context'];
  path.push('location');
  if (answers.location === 'outside-uae') {
    path.push('country');
    if (answers.country === 'outside-gcc') return [...path,'geography-exit'];
  }
  if (answers.sex === 'female') {
    path.push('pregnancy');
    if (answers.pregnancy === 'yes') return [...path,'pregnancy-exit'];
  }
  path.push('treatment');
  if (answers.treatment === 'yes') return [...path,'treatment-exit'];
  path.push('reassurance');
  const goals = knownSelections(QUESTIONS.goals,answers.goals);
  const curiosityOnly = goals.length === 1 && goals[0] === 'curiosity';
  const motivations = curiosityOnly ? [] : knownSelections(getQuestion('motivation',answers),answers.motivation);
  if (!curiosityOnly) path.push('motivation');
  if (motivations.length > 1) path.push('priority');
  for (const id of DETAIL_ORDER) {
    if (!(id === 'curiosity' ? goals.includes('curiosity') : motivations.includes(id))) continue;
    path.push(id);
  }
  const picked = triggers => Object.entries(triggers).some(([id,option]) => path.includes(id) && knownSelections(QUESTIONS[id],answers[id]).includes(option));
  if (picked(SLEEP_TRIGGERS)) path.push('sleep');
  return [...path,'family','bloodwork','transition','summary','contact'];
}
export function noteApplies(id,answers={}) {
  const option = NOTE_OPTIONS[id];
  if (!option || !getPath(answers).includes(id)) return false;
  return Array.isArray(answers[id]) ? answers[id].includes(option) : answers[id] === option;
}
/** @returns {Record<string, string>} */
export function normaliseNotes(answers={},notes={}) {
  /** @type {Record<string, string>} */
  const clean = {};
  if (!notes || typeof notes !== 'object' || Array.isArray(notes)) return clean;
  for (const id of Object.keys(NOTE_OPTIONS)) {
    if (!Object.hasOwn(notes,id) || typeof notes[id] !== 'string' || !noteApplies(id,answers)) continue;
    const text = notes[id].replace(/[\u0000-\u001f\u007f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,id==='country' ? 80 : NOTE_MAX);
    if (text) clean[id] = text;
  }
  return clean;
}
function normaliseValue(q,value) {
  if (!q.multiple) return q.options.some(option=>option.id===value) ? value : '';
  let values = selected(value).filter(id => q.options.some(option=>option.id===id));
  if (EXCLUSIVE_NONE.has(q.id) && values.includes('none') && values.length > 1) {
    values = values.at(-1) === 'none' ? ['none'] : values.filter(id=>id!=='none');
  }
  return q.options.filter(option=>values.includes(option.id)).map(option=>option.id);
}
export function updateAnswer(answers,id,value) {
  const next = createAnswers();
  for (const q of Object.values(QUESTIONS)) next[q.id] = normaliseValue(q, answers?.[q.id]);
  if (Object.hasOwn(QUESTIONS,id)) next[id] = normaliseValue(QUESTIONS[id],value);
  // Returning to an emirate clears any previous overseas country selection.
  // Historical answer sets are rendered by their explicit version, not coerced here.
  next.motivation = normaliseValue(getQuestion('motivation',next),next.motivation);
  if (next.sex !== 'female') next.pregnancy = '';
  // Options that depend on other answers.
  for (const dynamic of ['priority','hormones']) next[dynamic] = normaliseValue(getQuestion(dynamic,next),next[dynamic]);
  const active = new Set(getPath(next));
  for (const q of Object.values(QUESTIONS)) if (!active.has(q.id)) next[q.id] = q.multiple ? [] : '';
  return next;
}
function validateQuestion(q,value) {
  if (q.multiple) {
    if (!Array.isArray(value) || !value.length) return 'Please choose an answer.';
    if (new Set(value).size !== value.length || value.some(id=>!q.options.some(option=>option.id===id))) return 'Choose only the available answers.';
    if (EXCLUSIVE_NONE.has(q.id) && value.includes('none') && value.length > 1) return 'Choose either no concerns or the areas that apply.';
    return null;
  }
  return q.options.some(option=>option.id===value) ? null : 'Please choose an answer.';
}
export function validateStep(id,answers={}) {
  const path = getPath(answers);
  if (!path.includes(id)) return 'This step is not part of your current journey.';
  const q = getQuestion(id,answers);
  if (q) return validateQuestion(q,answers[id]);
  if (id === 'summary' || id === 'contact') {
    for (const step of path) {
      const item = getQuestion(step,answers);
      if (item) {
        const error = validateQuestion(item,answers[step]);
        if (error) return error;
      }
    }
    for (const [key,value] of Object.entries(answers)) {
      if (!Object.hasOwn(QUESTIONS,key)) return 'Choose only the available answers.';
      if (!path.includes(key) && (Array.isArray(value) ? value.length : value !== '')) return 'Review your answers before continuing.';
    }
  }
  return null;
}
// Unrecorded age bands use neutral draft copy; no risk rates or test recommendations.
// The supplied walkthrough records a woman in her 40s; that reference copy is selected separately.
const CONTEXT_COPY = Object.freeze({
  '18-30':Object.freeze({title:'Invest in your health from the start.',body:'Understanding your health now helps you stay well for yourself and your family.'}),
  '31-40':Object.freeze({title:'Make time for your health in your 30s.',body:'Between work and family, a clear view of your health helps you decide what needs attention.'}),
  '41-50':Object.freeze({title:'Your 40s: time for a fresh look at your health.',body:'Bring your goals, your health history and any recent changes into one conversation with your doctor.'}),
  '51-60':Object.freeze({title:'Stay healthy for the years ahead.',body:'Knowing your health today helps you and your doctor plan what to watch, for you and your loved ones.'}),
  '61-70':Object.freeze({title:'Keep doing what matters to you.',body:'Your health history, daily activities and goals help your doctor plan the right next steps.'}),
  '71-plus':Object.freeze({title:'Care built around your life.',body:'Tell us about your health and your daily life, so your doctor can plan your next steps with you.'}),
});
export function getContextCopy(answers={}) {
  if (answers.age === '41-50' && answers.sex === 'female') return {
    title:'Why your 40s are an important decade',
    body:'Hormonal changes can affect heart, bone and metabolic health. Early detection helps you go through this stage with clarity and confidence.',
    caption:'Cholesterol and heart risk rise for women in their 40s',
  };
  return Object.hasOwn(CONTEXT_COPY,answers.age) ? CONTEXT_COPY[answers.age] : {title:'A clearer picture of your health.',body:'Your age, health history and priorities help shape a conversation about your next steps.'};
}
export function getGeography(answers={}) {
  const emirate = QUESTIONS.location.options.find(option=>option.id===answers.location && option.id!=='outside-uae');
  if (emirate) return {countryCode:'uae',emirate:emirate.id};
  const country = QUESTIONS.country.options.find(option=>option.id===answers.country);
  if (answers.location === 'outside-uae' && country) return {countryCode:country.id,emirate:''};
  // Explicit v4 values remain useful to operational reports of historical records.
  if (!answers.location && (country || answers.country === 'uae')) return {countryCode:answers.country,emirate:''};
  return {countryCode:'',emirate:''};
}
export function getCoverageCopy(answers={}) {
  const {countryCode,emirate} = getGeography(answers);
  const location = QUESTIONS.location.options.find(option=>option.id===emirate);
  const country = QUESTIONS.country.options.find(option=>option.id===countryCode);
  if (location) return `You’re interested in Namat from ${location.label}. We’ll email you when there’s news about availability and the next steps.`;
  if (country && country.id !== 'outside-gcc') return `You’re interested in Namat from ${country.label}. We’ll email you when there’s news about availability and the next steps.`;
  return 'We’re launching in the UAE first and planning to expand to Gulf countries as soon as possible.';
}
/** A factual identity label; it makes no claim about clinical needs or risk. */
export function getProfileContext(answers={}) {
  const age = QUESTIONS.age.options.find(option=>option.id===answers.age);
  const sex = QUESTIONS.sex.options.find(option=>option.id===answers.sex);
  return {age:age?.label || '',sex:sex?.label || '',label:[sex?.label,age?.label].filter(Boolean).join(' · ')};
}
/** Country names are free text, not a guessed geographical classification. */
export function validateCountryName(value) {
  if (typeof value !== 'string' || value.trim().length < 2) return 'Please enter your country.';
  if (value.trim().length > 80 || /[\u0000-\u001f\u007f<>]/.test(value)) return 'Please enter a country name of up to 80 characters.';
  return null;
}
export function buildOverview(answers={},notes={}) {
  const typed = normaliseNotes(answers,notes);
  const path = getPath(answers);
  const valid = Object.fromEntries(path.filter(id=>QUESTIONS[id] && !validateQuestion(getQuestion(id,answers),answers[id])).map(id=>[id,answers[id]]));
  const labels = (id) => {
    const q = getQuestion(id,answers);
    const values = q.multiple ? selected(valid[id]) : [valid[id]];
    return q.options.filter(option=>values.includes(option.id)).map(option=>option.id === NOTE_OPTIONS[id] && typed[id] ? `${option.label}: ${typed[id]}` : option.label);
  };
  const goals = labels('goals');
  const recap = path.filter(id=>Object.hasOwn(valid,id)).map(id=>({id,title:QUESTIONS[id].title,value:labels(id).join('; ')}));
  if (path.at(-1).endsWith('-exit')) return {goals,priority:null,topics:[],recap,prompts:[]};
  // The first priority is the chosen reason, or the only reason when just one was picked.
  const reasons = Object.hasOwn(valid,'motivation') ? valid.motivation : [];
  const priorityId = valid.priority || (reasons.length === 1 ? reasons[0] : null);
  const priority = priorityId ? QUESTIONS.motivation.options.find(option=>option.id===priorityId).label : null;
  const topics = DETAIL_ORDER.filter(id=>Object.hasOwn(valid,id) && !selected(valid[id]).includes('none')).map(id=>({id,title:QUESTIONS[id].title,items:labels(id)}))
    .sort((a,b)=>(b.id===priorityId)-(a.id===priorityId));
  const prompts = topics.map(topic=>DISCUSSION_PROMPTS[topic.id]);
  if (Object.hasOwn(valid,'sleep') && !valid.sleep.includes('none')) prompts.push(EXTRA_PROMPTS.sleep);
  if (!prompts.length) prompts.push('What would be a useful starting point for a conversation about my health?');
  return {goals,priority,topics,recap,prompts};
}

/** Preserve the exact recap and active-path semantics of saved v4 submissions. */
export function buildOverviewForVersion(version,answers={},notes={}) {
  if (version === VERSION) return buildOverview(answers,notes);
  if (version === v4.VERSION) return v4.buildOverview(answers,notes);
  throw new Error('This saved questionnaire version is not supported.');
}
/** Facts for acknowledgement cards, drawn only from valid, active answers. */
export function getAnswerAcknowledgement(answers={},notes={}) {
  const overview = buildOverview(answers,notes);
  const find = id => overview.recap.find(row=>row.id===id)?.value || '';
  return {
    profile:getProfileContext(answers),
    goals:overview.goals,
    priority:overview.priority,
    motivations:find('motivation'),
    topics:overview.topics.map(topic=>({id:topic.id,items:topic.items})),
    family:find('family'),
    bloodwork:find('bloodwork'),
  };
}
