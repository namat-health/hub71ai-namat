// Lab quotes. Unit tests build quote data in memory; the database test runs only with an
// explicitly supplied loopback LAB_CATALOG_TEST_DATABASE_URL and uses a throwaway schema.
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {buildIndex,checkProviderFile,isCalculated,loadProvider,migrate,seedBiomarkers} from '../scripts/lib/lab-catalog.mjs';
import {quote,quoteFor,visitFee} from '../scripts/lib/lab-quote.mjs';

const read=file=>JSON.parse(readFileSync(new URL(`../db/lab-catalog/${file}`,import.meta.url),'utf8'));
const biomarkers=read('biomarkers.json'),demo=read('demo.json');
const LIPID=['total-cholesterol','ldl-cholesterol','hdl-cholesterol','triglycerides'];
const THREE=[...LIPID,'ferritin','vitamin-d-25-oh'],FOUR=[...THREE,'vitamin-b12'];
const summary=result=>result.options.map(o=>[o.provider.slug,o.mode,o.total_aed,o.not_ordered]);

// Quote data for one emirate, built from provider files whose items name their biomarkers.
let nextId=1;
const dataFrom=(files,emirate)=>({emirate,providers:files.map(file=>({slug:file.provider.slug,name:file.provider.name,type:file.provider.type,
  options:file.collection_options.filter(o=>o.emirate===emirate).map(o=>({fee_aed:null,free_above_aed:null,minimum_order_aed:null,areas:null,turnaround_hours:null,...o})),
  offerings:file.offerings.flatMap(o=>{
    const price=o.prices.find(p=>p.emirate===emirate)??o.prices.find(p=>p.emirate==null);
    return price?[{id:nextId++,slug:o.name,name:o.name,kind:o.kind,url:null,contents_complete:o.contents_complete??true,turnaround_hours:o.turnaround_hours??null,
      price:price.price_aed,list_price_aed:null,price_type:'list',checked_on:'2026-10-01',
      items:o.biomarkers_as_printed.map(b=>({printed_name:b.name,biomarker_id:b.id??null,calculated:isCalculated(b.name)}))}]:[];
  })})).filter(p=>p.options.length)});
const option=(mode,fee_rule,extra={})=>({mode,fee_rule,fee_aed:null,free_above_aed:null,minimum_order_aed:null,areas:null,turnaround_hours:null,...extra});
const provider=(slug,options,offerings)=>({slug,name:slug,type:'lab',options,offerings:offerings.map(([name,price,ids,extra={}],i)=>({id:i+1,slug:name,name,
  kind:ids.length>1?'panel':'single_test',url:null,contents_complete:true,turnaround_hours:null,price,list_price_aed:null,price_type:'list',checked_on:'2026-10-01',
  items:ids.map(id=>({printed_name:id,biomarker_id:id,calculated:false})),...extra}))});
const one=(...providers)=>({emirate:'abu_dhabi',providers});

test('the plan example: three tests in Abu Dhabi, then a fourth that Clinic C does not sell',()=>{
  const data=dataFrom(demo.providers,'abu_dhabi');
  // Home visit A's AED 399 package beats its singles (457 and 606); Clinic C adds its AED 50 fee below AED 400.
  assert.deepEqual(summary(quote(data,{biomarkers:THREE,emirate:'abu_dhabi'})),
    [['walk-in-lab-b','walk_in',300,0],['clinic-c','walk_in',304,0],['home-visit-a','home',399,7]]);
  const four=quote(data,{biomarkers:FOUR,emirate:'abu_dhabi'});
  assert.deepEqual(summary(four),[['walk-in-lab-b','walk_in',390,0],['home-visit-a','home',399,6]]);
  assert.equal(four.covers_all,true);
  assert.deepEqual(four.not_listed,[{provider:'clinic-c',mode:'walk_in',reason:'missing vitamin-b12'}]);
  const clinic=quote(data,{biomarkers:THREE,emirate:'abu_dhabi'}).options[1];
  assert.deepEqual([clinic.subtotal_aed,clinic.visit_fee_aed,clinic.fee_rule],[254,50,'free_above']);
});

test('no offering is kept that could be dropped, even to reach free collection',()=>{
  const freeAbove100=[option('walk_in','free_above',{fee_aed:50,free_above_aed:100})];
  const padded=quote(one(provider('lab',freeAbove100,[['Diabetes panel',80,['glucose','hba1c']],['HbA1c',25,['hba1c']]])),{biomarkers:['glucose','hba1c'],emirate:'abu_dhabi'});
  assert.deepEqual(padded.options.map(o=>[o.offerings.map(x=>x.name),o.total_aed]),[[['Diabetes panel'],130]]);
  const natural=quote(one(provider('lab',freeAbove100,[['Glucose',60,['glucose']],['HbA1c',30,['hba1c']],['Diabetes panel',100,['glucose','hba1c']]])),{biomarkers:['glucose','hba1c'],emirate:'abu_dhabi'});
  assert.deepEqual(natural.options.map(o=>[o.offerings.map(x=>x.name),o.total_aed,o.visit_fee_aed]),[[['Diabetes panel'],100,0]]);
});

test('eGFR counts through creatinine and says so',()=>{
  const result=quote(one(provider('lab',[option('walk_in','none')],[['Creatinine',30,['creatinine']],['Glucose',20,['glucose']]])),{biomarkers:['egfr','glucose'],emirate:'abu_dhabi'});
  assert.equal(result.covers_all,true);
  assert.deepEqual(result.options[0].calculated,[{biomarker:'egfr',from:['creatinine']}]);
  assert.equal(result.options[0].total_aed,50);
});

test('when nobody covers everything, the providers covering the most are listed with what is missing',()=>{
  const result=quote(one(provider('a-lab',[option('walk_in','none')],[['Glucose',20,['glucose']],['ApoB',90,['apob']]]),provider('b-lab',[option('walk_in','none')],[['Glucose',15,['glucose']]])),
    {biomarkers:['glucose','apob','lipoprotein-a'],emirate:'abu_dhabi'});
  assert.equal(result.covers_all,false);
  assert.deepEqual(result.options.map(o=>[o.provider.slug,o.covered,o.missing]),[['a-lab',['glucose','apob'],['lipoprotein-a']]]);
});

test('home visits respect listed areas and minimum orders; a visit type can be chosen',()=>{
  const lab=provider('lab',[option('home','flat',{fee_aed:50,areas:['Al Reem Island'],minimum_order_aed:100}),option('walk_in','none')],[['Glucose',20,['glucose']],['Diabetes panel',120,['glucose','hba1c']]]);
  assert.deepEqual(quote(one(lab),{biomarkers:['glucose'],emirate:'abu_dhabi',area:'Khalifa City'}).not_listed,
    [{provider:'lab',mode:'home',reason:"doesn't list Khalifa City for home visits"}]);
  assert.deepEqual(quote(one(lab),{biomarkers:['glucose'],emirate:'abu_dhabi',area:'Al Reem'}).not_listed,
    [{provider:'lab',mode:'home',reason:'below the minimum order of AED 100'}]);
  assert.deepEqual(summary(quote(one(lab),{biomarkers:['glucose','hba1c'],emirate:'abu_dhabi',mode:'home'})),[['lab','home',170,0]]);
});

test('sort-v1: listed total, then turnaround, then home collection, then provider',()=>{
  const result=quote(one(
    provider('a-walk',[option('walk_in','none')],[['Glucose',50,['glucose']]]),
    provider('z-home',[option('home','all_inclusive')],[['Glucose',50,['glucose']]]),
    provider('fast',[option('walk_in','none',{turnaround_hours:24})],[['Glucose',50,['glucose'],{turnaround_hours:24}]]),
    provider('cheap',[option('walk_in','not_stated')],[['Glucose',45,['glucose']]])),{biomarkers:['glucose'],emirate:'abu_dhabi'});
  assert.deepEqual(result.options.map(o=>o.provider.slug),['cheap','fast','z-home','a-walk']);
  assert.equal(result.options[0].visit_fee_aed,null);
  assert.equal(result.sort_label,'Sorted by listed total, visit fees included');
});

test('visit fees and request checks',()=>{
  assert.deepEqual([visitFee({fee_rule:'flat',fee_aed:75},10),visitFee({fee_rule:'free_above',fee_aed:50,free_above_aed:300},299),
    visitFee({fee_rule:'free_above',fee_aed:50,free_above_aed:300},300),visitFee({fee_rule:'all_inclusive'},10),visitFee({fee_rule:'not_stated'},10)],[75,50,0,0,null]);
  assert.throws(()=>quote(one(),{biomarkers:[],emirate:'abu_dhabi'}),/at least one/);
  assert.throws(()=>quote(one(),{biomarkers:['glucose'],emirate:'doha'}),/Unknown emirate/);
  assert.throws(()=>quote(one(),{biomarkers:['glucose'],emirate:'dubai',mode:'drive_through'}),/visit type/);
});

const url=process.env.LAB_CATALOG_TEST_DATABASE_URL;
if(url&&!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)) throw new Error('Lab quote integration tests require a loopback PostgreSQL database.');
const enabled=Boolean(url),schema=`lab_quote_test_${randomUUID().replaceAll('-','').slice(0,12)}`;
let pool;
before(async()=>{
  if(!enabled)return;
  pool=new pg.Pool({connectionString:url,max:2});
  await migrate(pool,schema);
  const client=await pool.connect();
  try {
    await seedBiomarkers(client,schema,biomarkers);
    const index=buildIndex(biomarkers.biomarkers,read('aliases.json').aliases);
    for(const file of demo.providers) await loadProvider(client,schema,checkProviderFile(file,{source:'price_list'}),index,{mappedBy:'demo-seed'});
  } finally {client.release();}
});
after(async()=>{
  if(!enabled)return;
  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await pool.end();
});

test('native: a quote read from the catalogue matches the in-memory one',{skip:!enabled},async()=>{
  const client=await pool.connect();
  try {
    const four=await quoteFor(client,schema,{biomarkers:FOUR,emirate:'abu_dhabi'});
    assert.deepEqual(summary(four),[['walk-in-lab-b','walk_in',390,0],['home-visit-a','home',399,6]]);
    assert.deepEqual(four.options[1].offerings.map(o=>o.name),['Essential Health Check']);
    assert.deepEqual(summary(await quoteFor(client,schema,{biomarkers:FOUR,emirate:'dubai'})),[['provider-d','walk_in',380,0],['provider-d','home',455,0]]);
    await assert.rejects(quoteFor(client,schema,{biomarkers:['glucose','made-up-marker'],emirate:'dubai'}),/Unknown biomarker: made-up-marker/);
  } finally {client.release();}
});
