import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readApiConfig, QUESTIONNAIRE_REVISION} from '../services/namat-api/config.mjs';
import {assertSourceRevision} from '../services/namat-api/revision.mjs';
import {QUESTIONS, NOTE_OPTIONS, NOTE_MAX, VERSION, MAX_FILE_BYTES} from '../src/hackathon/welcome/questionnaire-model.mjs';
import {validateHackathonSubmission, MAX_BODY_BYTES} from '../src/hackathon/server/api.mjs';

const spec = JSON.parse(readFileSync(new URL('../services/namat-api/contracts/openapi.json', import.meta.url), 'utf8'));
const schemas = spec.components.schemas;
const post = spec.paths['/v1/submissions'].post;
const example = post.requestBody.content['application/json'].examples.fictionalNoBloodwork.value;
const baseline = ['goals','age','sex','location','family','bloodwork'];
const legacy = ({questionnaireRevision, ...input}) => input;
const sorted = values => [...values].sort();
const visit = (value, callback) => {
  if (!value || typeof value !== 'object') return;
  callback(value);
  for (const child of Object.values(value)) visit(child,callback);
};

test('contract exposes only the local implemented operations and pins the source revision', () => {
  assert.equal(spec.openapi,'3.1.0');
  const config = readApiConfig({});
  assert.deepEqual(spec.servers.map(server=>server.url), [`http://${config.host}:${config.port}`]);
  assert.deepEqual(Object.fromEntries(Object.entries(spec.paths).map(([path,value])=>[path,sorted(Object.keys(value))])), {
    '/healthz':['get','head'], '/readyz':['get','head'], '/v1/openapi.json':['get','head'], '/v1/submissions':['options','post'],
  });
  assert.equal(schemas.SubmissionRequest.properties.questionnaireRevision.const,QUESTIONNAIRE_REVISION);
  assert.equal(schemas.SubmissionRequest.properties.version.const,VERSION);
  assert.equal(assertSourceRevision(),QUESTIONNAIRE_REVISION);
});

test('every contract schema reference resolves locally and application objects reject extra fields', () => {
  let references = 0;
  visit(spec,value=>{
    if (!value.$ref) return;
    references++;
    assert.ok(value.$ref.startsWith('#/'),value.$ref);
    const resolved=value.$ref.slice(2).split('/').map(key=>key.replace(/~1/g,'/').replace(/~0/g,'~'))
      .reduce((node,key)=>node?.[key],spec);
    assert.ok(resolved,`Unresolved reference: ${value.$ref}`);
  });
  assert.ok(references>20);
  for(const [name,schema] of Object.entries(schemas)) {
    if(schema.type!=='object')continue;
    assert.equal(schema.additionalProperties,false,name);
    assert.ok(schema.required.every(key=>Object.hasOwn(schema.properties,key)),name);
  }
  const ids=Object.values(spec.paths).flatMap(path=>Object.values(path).map(operation=>operation.operationId));
  assert.equal(new Set(ids).size,ids.length,'Operation IDs must be unique for client generators');
});

test('answer and note vocabulary matches the pinned questionnaire including inactive empty values', () => {
  assert.deepEqual(Object.keys(schemas.QuestionnaireAnswers.properties),Object.keys(QUESTIONS));
  assert.deepEqual(schemas.QuestionnaireAnswers.required,baseline);
  assert.deepEqual(Object.keys(schemas.QuestionnaireNotes.properties),Object.keys(NOTE_OPTIONS));
  for(const [id,q] of Object.entries(QUESTIONS)) {
    const field=schemas.QuestionnaireAnswers.properties[id];
    const normal=field.anyOf?.[0]||field;
    const options=q.multiple?normal.items.enum:normal.enum.filter(value=>value!=='');
    assert.deepEqual(options,q.options.map(option=>option.id),id);
    if(!baseline.includes(id)) {
      assert.deepEqual(field.anyOf[1],q.multiple?{type:'string',const:''}:{type:'array',maxItems:0},id);
    }
    if(q.multiple)assert.equal(normal.uniqueItems,true,id);
  }
  for(const field of Object.values(schemas.QuestionnaireNotes.properties))assert.equal(field.maxLength,NOTE_MAX);
});

test('fictional example, omitted notes and omitted inactive answers pass actual source validation', () => {
  assert.equal(example.questionnaireRevision,QUESTIONNAIRE_REVISION);
  assert.match(example.email,/@example\.invalid$/);
  assert.equal(validateHackathonSubmission(legacy(example)).ok,true);
  const minimal=structuredClone(example);
  delete minimal.notes;
  for(const key of Object.keys(minimal.answers)) {
    if(!baseline.includes(key)&&key!=='curiosity')delete minimal.answers[key];
  }
  assert.equal(validateHackathonSubmission(legacy(minimal)).ok,true,'Inactive answers are not mandatory');
  assert.ok(!schemas.SubmissionRequest.required.includes('notes'));
  for(const [id,q] of Object.entries(QUESTIONS)) {
    if(baseline.includes(id)||id==='curiosity')continue;
    const tolerated=structuredClone(minimal);
    tolerated.answers[id]=q.multiple?'':[];
    assert.equal(validateHackathonSubmission(legacy(tolerated)).ok,true,`Legacy empty shape: ${id}`);
  }
});

test('contract required fields and upload limits agree with actual input requirements', () => {
  const top=schemas.SubmissionRequest;
  assert.deepEqual(sorted(top.required),sorted(['version','questionnaireRevision','requestId','dataClass','fictionalConfirmed','answers','email','firstName','reports']));
  for(const field of top.required.filter(key=>key!=='questionnaireRevision')) {
    const missing=legacy(structuredClone(example));
    delete missing[field];
    assert.equal(validateHackathonSubmission(missing).ok,false,field);
  }
  assert.equal(schemas.Report.properties.size.maximum,MAX_FILE_BYTES);
  assert.equal(schemas.Report.properties.base64.maxLength,Math.ceil(MAX_FILE_BYTES/3)*4);
  assert.deepEqual(sorted(schemas.Report.required),['base64','name','size','type']);
  assert.equal(top.properties.reports.maxItems,3);
  assert.equal(spec['x-local-limits'].maxBodyBytes,MAX_BODY_BYTES);
  assert.equal(schemas.QuestionnaireNotes.additionalProperties,false);
});

test('wire responses distinguish HEAD, readiness, saved outbox and API errors', () => {
  assert.deepEqual(sorted(schemas.SubmissionSaved.required),['confirmationEmail','receiptId','status']);
  assert.deepEqual(schemas.SubmissionSaved.properties.confirmationEmail.enum,['pending','simulated','accepted','failed','unknown']);
  assert.match(schemas.SubmissionSaved.properties.confirmationEmail.description,/not delivery/);
  assert.equal(schemas.ApiError.properties.requestId.$ref,'#/components/schemas/TraceId');
  assert.equal(schemas.SubmissionRequest.properties.requestId.$ref,'#/components/schemas/SubmissionIdempotencyKey');
  assert.equal(spec.paths['/readyz'].get.responses['503'].content['application/json'].schema.$ref,'#/components/schemas/UnavailableReadiness');
  assert.equal(post.responses['429'].headers['Retry-After'].schema.const,'60');
  assert.equal(spec.paths['/v1/submissions'].options.responses['204'].headers['Access-Control-Allow-Methods'].schema.const,'POST, OPTIONS');
  for(const path of Object.values(spec.paths))for(const [method,operation] of Object.entries(path)) {
    for(const response of Object.values(operation.responses)) {
      assert.equal(response.headers['Cache-Control'].schema.const,'private, no-store');
      assert.equal(response.headers['X-Request-Id'].schema.$ref,'#/components/schemas/TraceId');
      if(method==='head')assert.equal(response.content,undefined,'HEAD must not promise JSON');
    }
  }
  assert.equal(spec.components.responses.NotFound.content['application/json'].schema.allOf[1].properties.code.enum[0],'not_found');
});
