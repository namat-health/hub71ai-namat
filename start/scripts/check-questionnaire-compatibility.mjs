// Local contract check across both repositories. No network, database writes or email.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {answers,input} from '../tests/hackathon-fixtures.mjs';
import {validateHackathonSubmission} from '../src/hackathon/server/api.mjs';
import * as legacy from '../src/hackathon/welcome/questionnaire-v1.mjs';
import {getPath,getQuestion} from '../src/hackathon/welcome/questionnaire-model.mjs';
import {getScreenPath,screenQuestions} from '../src/hackathon/welcome/questionnaire-flow.mjs';

const checkout=process.env.NAMAT_PORTAL_CHECKOUT;
assert.ok(checkout,'Set NAMAT_PORTAL_CHECKOUT to the current doctor-portal checkout.');
const portal=path=>import(pathToFileURL(resolve(checkout,path)).href);
const [{submissionsResponse},{answerText,questionnaireGroups,profileLine,contextSentence},{buildCaseContext}]=await Promise.all([
 portal('lib/portal-backend.mjs'),portal('lib/questionnaire.mjs'),portal('lib/clinical/case-context.mjs'),
]);
const now=Date.parse('2026-10-02T08:00:00Z');
const id=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
let old=legacy.createAnswers();
for(const [key,value]of Object.entries({goals:['curiosity'],age:'31-40',sex:'male',location:'dubai',curiosity:['other'],family:['none'],bloodwork:'no'}))old=legacy.updateAnswer(old,key,value);
const payloads=[
 input({version:legacy.VERSION,answers:old,notes:{curiosity:'Fictional only'}}),
 input({firstName:'Fictional Example',answers:answers({age:'42',height_cm:'167.5',weight_kg:'65.2',goals:['performance','uae_move'],medicines:'yes',tobacco:'former',alcohol:'weekly',family:['cancer']}),notes:{medicines:'Vitamin D; dose unknown',tobacco:'Quit in 2024',alcohol:'1 glass',family:'Aunt; type and age unknown'}}),
 input({answers:answers({age:'68',family:['unsure'],tobacco:'declined',alcohol:'declined'})}),
];
const rows=payloads.map((payload,n)=>{
 const checked=validateHackathonSubmission(payload);assert.equal(checked.ok,true,JSON.stringify(checked.errors));
 if(n)assert.deepEqual(getScreenPath(checked.value.answers).flatMap(screenQuestions).filter(key=>getQuestion(key)),getPath(checked.value.answers).filter(key=>getQuestion(key)));
 return {id:id(n+1),receipt_id:id(n+21),questionnaire_version:checked.value.version,data_class:'synthetic',fictional_confirmed:true,answers:checked.value.answers,notes:checked.value.notes,email:'fictional@example.invalid',first_name:checked.value.firstName,created_at:'2026-10-02T07:00:00Z',expires_at:'2026-10-03T07:00:00Z',attached_reports:[]};
});
// Include an already-stored v2 response from before the priority screen was removed.
rows.splice(1,0,{...structuredClone(rows[1]),id:id(10),receipt_id:id(30),answers:{...rows[1].answers,priority:'performance'}});
const owner=id(80),tenant=id(81),hostname='local-compatibility.azurewebsites.net';
const env={NAMAT_SHARED_API_ENABLED:'true',NAMAT_SHARED_API_ORIGIN:'https://namat-api-staging-uaen-001.azurewebsites.net',NAMAT_SHARED_API_PORTAL_TOKEN:'fictional-local-test-service-key-0123456789',NAMAT_PORTAL_AUTH_MODE:'azure-easy-auth',NAMAT_PORTAL_TENANT_ID:tenant,NAMAT_PORTAL_ALLOWED_USER_IDS:owner,WEBSITE_SITE_NAME:'local-compatibility',WEBSITE_HOSTNAME:hostname,WEBSITE_INSTANCE_ID:'fictional-local-instance'};
const request=()=>new Request(`https://${hostname}/api/submissions`,{headers:{'X-MS-CLIENT-PRINCIPAL':Buffer.from(JSON.stringify({auth_typ:'aad',claims:[{typ:'oid',val:owner},{typ:'tid',val:tenant}]})).toString('base64')}});
for(const submissions of [[rows[0]],[rows[2]],rows]) {
 const response=await submissionsResponse(request(),{env,now,getPool(){throw new Error('Unexpected database access');},fetchImpl:async()=>Response.json({submissions})});
 assert.equal(response.status,200,'A supported new response must not break the patient list.');
 assert.deepEqual((await response.json()).submissions,submissions);
}
for(const row of rows) {
 assert.ok(questionnaireGroups(row).length);assert.ok(profileLine(row.answers));assert.ok(contextSentence(row.answers));
 const context=buildCaseContext(row,[],{now});
 assert.equal(context.questionnaire.version,row.questionnaire_version);
 assert.equal(context.questionnaire.exactAge,row.questionnaire_version===legacy.VERSION?null:Number(row.answers.age));
 for(const key of ['age','sex','location','tobacco','alcohol','medicines','family','height_cm','weight_kg']) {
  const value=row.answers[key];if(value===undefined||value===''||(Array.isArray(value)&&!value.length))continue;
  assert.ok(answerText(key,row),`Missing doctor-facing label: ${key}`);
  assert.deepEqual(context.questionnaire.facts.find(f=>f.id===`answer:${key}`)?.value,value);
 }
 for(const [key,value]of Object.entries(row.notes))assert.equal(context.questionnaire.facts.find(f=>f.id===`note:${key}`)?.value,value);
}
assert.equal(rows[2].first_name,'Fictional Example');
assert.equal(answerText('height_cm',rows[2]),'167.5 cm');
assert.equal(answerText('weight_kg',rows[2]),'65.2 kg');
console.log('PASS: backend validation; old v1, stored v2 and new grouped v2 in one portal list; doctor labels, units and clinical facts. No new answer IDs or version.');
