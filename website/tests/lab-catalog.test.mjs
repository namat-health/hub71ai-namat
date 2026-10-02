// Lab catalogue: name matching and input checks always run. The PostgreSQL part runs only with an
// explicitly supplied loopback LAB_CATALOG_TEST_DATABASE_URL and uses a throwaway schema.
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {buildIndex,checkProviderFile,hoursFrom,joinedNames,loadProvider,matchName,migrate,notForAdults,prune,seedBiomarkers,standardPanel} from '../scripts/lib/lab-catalog.mjs';

const read=file=>JSON.parse(readFileSync(new URL(`../db/lab-catalog/${file}`,import.meta.url),'utf8'));
const biomarkers=read('biomarkers.json'),demo=read('demo.json');
const index=buildIndex(biomarkers.biomarkers,read('aliases.json').aliases);

test('printed names match the right biomarker',()=>{
  const cases={
    'Vitamin D, 25 Hydroxy (25-OH), Total':'vitamin-d-25-oh','25-OH Vitamin D':'vitamin-d-25-oh','Thyroid Stimulating Hormone (TSH)':'tsh',
    'Hemoglobin':'haemoglobin','SGPT':'alt','hs-CRP':'hs-crp','CRP':'crp','Fasting Blood Sugar':'glucose','Glucose (Fasting)':'glucose',
    'HbA1c (Glycated Hemoglobin)':'hba1c','Estradiol':'oestradiol','LDL Cholesterol (Calculated)':'ldl-cholesterol','Lead, Blood':'blood-lead',
    'Ferritin':'ferritin','Free T4':'free-t4','T4 Free':'free-t4','DHEA Sulfate':'dhea-s',
    'AST/SGOT (Aspartate Aminotransferase)':'ast','ALT/SGPT (Alanine Aminotransferase)':'alt','Ferritin In Serum':'ferritin',
    'Vitamin D Total (25-Hydroxycholecalciferol)':'vitamin-d-25-oh','BUN (Blood Urea Nitrogen)':'urea','FT4 (Thyroxine - Free)':'free-t4'};
  for(const [printed,id] of Object.entries(cases)) assert.equal(matchName(index,printed),id,printed);
});

test('qualified or different tests stay unmatched',()=>{
  for(const printed of ['1,25-Dihydroxy Vitamin D','Testosterone (Free)','Free Testosterone','Direct Bilirubin','Total T4','Ionised Calcium',
    'Creatinine (Urine)','Free PSA','Iron Studies','BUN / Creatinine Ratio, Serum','LDL/HDL Ratio','Albumin/Globulin (A/G) Ratio',
    'Folic Acid (RBC)','25 - OH - Vitamin D2','Na/K','Bilirubin, Direct/Indirect']) assert.equal(matchName(index,printed),null,printed);
  assert.equal(matchName(index,'Aspartate Aminotransferase (AST/SGOT)'),'ast');
});

test('only CBC and lipid panels stand for their core results',()=>{
  assert.deepEqual(standardPanel('Complete Blood Count - CBC'),['haemoglobin','haematocrit','mcv','white-cell-count','platelets']);
  assert.equal(standardPanel('Complete blood count (CBC) w/Diff').length,7);
  assert.deepEqual(standardPanel('Lipid Profile'),['total-cholesterol','ldl-cholesterol','hdl-cholesterol','triglycerides']);
  for(const printed of ['Liver Function Test (LFT)','Kidney Function Tests','Reticulocyte Count','Platelet count','Complete Health Check Up','Lipase'])
    assert.equal(standardPanel(printed),null,printed);
});

test('listed contents are split and truncated lists are marked incomplete',()=>{
  const [offering]=checkProviderFile({provider:{name:'Example',type:'lab'},offerings:[{name:'Wellness',kind:'package',contents_complete:true,
    biomarkers_as_printed:['Lipid Profile (Cholesterol, LDL, HDL, Triglycerides)','SSA (Ro 52, 60) Antibodies','Ferritin','And More']}]}).offerings;
  assert.deepEqual(offering.contents.map(c=>c.printed),['Cholesterol','LDL','HDL','Triglycerides','SSA (Ro 52, 60) Antibodies','Ferritin']);
  assert.equal(offering.contents_complete,false);
});

test('input checks keep only what the file states',()=>{
  const checked=checkProviderFile({collected_on:'2026-10-01',provider:{name:'Example Lab',type:'lab'},
    collection_options:[{emirate:'abu_dhabi',mode:'home',fee_rule:'free_above',fee_aed:100},{emirate:'Abu Dhabi',mode:'home',fee_rule:'none'},
      {emirate:'dubai',mode:'walk_in',fee_rule:'free_above',fee_aed:50,free_above_aed:300,turnaround_text:'24-48 hours'}],
    offerings:[{name:'Vitamin D',kind:'single_test',prices:[{emirate:'dubai',price_aed:'AED 50'},{emirate:'dubai',price_aed:60},{emirate:'mars',price_aed:10}]},
      {name:'Vitamin D',kind:'mystery',biomarkers_as_printed:['A','B','A'],prices:[{price_aed:0}]}]});
  assert.equal(checked.provider.slug,'example-lab');
  assert.deepEqual(checked.collectionOptions.map(o=>[o.emirate,o.fee_rule,o.fee_aed,o.free_above_aed,o.turnaround_hours]),
    [['abu_dhabi','not_stated',null,null,null],['dubai','free_above',50,300,48]]);
  const [single,second]=checked.offerings;
  assert.deepEqual(single.contents,[{printed:'Vitamin D',id:null}]);
  assert.deepEqual(single.prices.map(p=>[p.emirate,p.price_aed,p.source]),[['dubai',50,'website']]);
  assert.equal(second.slug,'vitamin-d-2');
  assert.equal(second.kind,'package');
  assert.deepEqual(second.contents.map(c=>c.printed),['A','B']);
  assert.equal(second.prices.length,0);
  assert.equal(checked.warnings.length,6);
  assert.throws(()=>checkProviderFile({provider:{name:'X',type:'lab | hospital_clinic'}}),/provider type/);
});

test('an option without an emirate counts only with a UAE-wide claim',()=>{
  const {collectionOptions}=checkProviderFile({provider:{name:'Example',type:'lab'},collection_options:[
    {emirate:null,mode:'home',fee_rule:'all_inclusive',quote:'We come to you anywhere in the UAE.'},
    {emirate:null,mode:'walk_in',fee_rule:'none',quote:'Visit one of our labs.'}]});
  assert.equal(collectionOptions.length,7);
  assert.ok(collectionOptions.every(o=>o.mode==='home'));
});

test('turnaround text becomes hours',()=>{
  assert.equal(hoursFrom('Results within 24 hours'),24);
  assert.equal(hoursFrom('1-2 days'),48);
  assert.equal(hoursFrom('3–5 working days'),120);
  assert.equal(hoursFrom('Same day'),null);
});

test('a line naming several tests is split only when every part is a known name',()=>{
  const ids=name=>joinedNames(index,name)?.map(x=>x.id)??null;
  assert.deepEqual(ids('Vitamin D & B12'),['vitamin-d-25-oh','vitamin-b12']);
  assert.deepEqual(ids('SGOT (AST) and SGPT (ALT)'),['ast','alt']);
  assert.deepEqual(ids('Diabetic Screen (Glucose, HbA1c)'),['glucose','hba1c']);
  for(const name of ['Testosterone, Free','LDL/HDL ratio','T3, T4, TSH','Bilirubin, Total and Direct']) assert.equal(ids(name),null,name);
});

test('packages for children or pregnancy are recognised; single tests and adult packages are not',()=>{
  for(const [name,kind] of [['Kids Health Checkup','package'],['ANEMIA PROFILE NEONATAL/JAUNDICE','panel'],['Comprehensive Pregnancy Check Up','package'],['Gold - Back To School (Sharjah)','package']]) assert.ok(notForAdults(name,kind),name);
  for(const [name,kind] of [['Pregnancy Blood Test','single_test'],['Swiss Health Check Basic Health Check Men / Women / Children','package'],['Kidney Function Test','panel'],['Male Fertility','package']]) assert.ok(!notForAdults(name,kind),name);
});

test('demo data is fictional and every item names a known biomarker',()=>{
  assert.equal(demo.meta.fictional,true);
  const known=new Set(biomarkers.biomarkers.map(m=>m.id));
  for(const file of demo.providers) for(const offering of file.offerings) for(const item of offering.biomarkers_as_printed) assert.ok(known.has(item.id),item.id);
});

const url=process.env.LAB_CATALOG_TEST_DATABASE_URL;
if(url&&!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)) throw new Error('Lab catalogue integration tests require a loopback PostgreSQL database.');
const enabled=Boolean(url),schema=`lab_catalog_test_${randomUUID().replaceAll('-','').slice(0,12)}`;
let pool;
before(async()=>{
  if(!enabled)return;
  pool=new pg.Pool({connectionString:url,max:2});
  await migrate(pool,schema);
  await migrate(pool,schema);
  const client=await pool.connect();
  try {
    await seedBiomarkers(client,schema,biomarkers);
    for(const file of [...demo.providers,...demo.providers]) await loadProvider(client,schema,checkProviderFile(file,{source:'price_list'}),index,{mappedBy:'demo-seed'});
  } finally {client.release();}
});
after(async()=>{
  if(!enabled)return;
  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await pool.end();
});
const check=(title,run)=>test(title,{skip:!enabled},run);

check('native: migrations and demo loads are repeatable',async()=>{
  const {rows:[c]}=await pool.query(`SELECT (SELECT count(*) FROM ${schema}.providers)::int AS providers,(SELECT count(*) FROM ${schema}.offerings)::int AS offerings,
    (SELECT count(*) FROM ${schema}.offering_prices)::int AS prices,(SELECT count(*) FROM ${schema}.offering_biomarkers WHERE biomarker_id IS NULL)::int AS unmatched,
    (SELECT count(*) FROM ${schema}.schema_migrations)::int AS migrations`);
  assert.deepEqual(c,{providers:4,offerings:16,prices:16,unmatched:0,migrations:1});
});

check('native: Abu Dhabi providers that sell each of a four-test order',async()=>{
  const order=['total-cholesterol','ldl-cholesterol','hdl-cholesterol','triglycerides','ferritin','vitamin-d-25-oh','vitamin-b12'];
  const {rows}=await pool.query(`SELECT p.slug, count(DISTINCT b.biomarker_id)::int AS covered
    FROM ${schema}.providers p JOIN ${schema}.collection_options c ON c.provider_id=p.id AND c.emirate='abu_dhabi'
    JOIN ${schema}.offerings o ON o.provider_id=p.id JOIN ${schema}.offering_biomarkers b ON b.offering_id=o.id AND b.biomarker_id=ANY($1)
    GROUP BY p.slug ORDER BY p.slug`,[order]);
  assert.deepEqual(rows,[{slug:'clinic-c',covered:6},{slug:'home-visit-a',covered:7},{slug:'walk-in-lab-b',covered:7}]);
});

check('native: constraints reject bad rows',async()=>{
  const {rows:[{id}]}=await pool.query(`SELECT id FROM ${schema}.providers WHERE slug='clinic-c'`);
  await assert.rejects(pool.query(`INSERT INTO ${schema}.collection_options (provider_id,emirate,mode,fee_rule) VALUES ($1,'qatar','home','none')`,[id]),/emirate/);
  await assert.rejects(pool.query(`INSERT INTO ${schema}.collection_options (provider_id,emirate,mode,fee_rule) VALUES ($1,'sharjah','home','free_above')`,[id]),/check/);
  await assert.rejects(pool.query(`INSERT INTO ${schema}.offering_biomarkers (offering_id,printed_name,biomarker_id)
    SELECT id,'Made up','not-a-marker' FROM ${schema}.offerings LIMIT 1`),/foreign key/);
});

check('native: current price is the latest unexpired one',async()=>{
  const {rows:[{id}]}=await pool.query(`SELECT o.id FROM ${schema}.offerings o JOIN ${schema}.providers p ON p.id=o.provider_id WHERE p.slug='walk-in-lab-b' AND o.slug='ferritin'`);
  await pool.query(`INSERT INTO ${schema}.offering_prices (offering_id,emirate,price_aed,source,checked_on,valid_until) VALUES ($1,'abu_dhabi',65,'price_list','2026-10-02','2026-10-03')`,[id]);
  const {rows}=await pool.query(`SELECT price_aed::text FROM ${schema}.current_prices WHERE offering_id=$1`,[id]);
  assert.deepEqual(rows,[{price_aed:current()<= '2026-10-03'?'65.00':'70.00'}]);
});
const current=()=>new Date().toISOString().slice(0,10);

check('native: prune keeps only what can be quoted, and a second run removes nothing',async()=>{
  const pruned=`${schema}_prune`,client=await pool.connect();
  try {
    await migrate(pool,pruned);
    await seedBiomarkers(client,pruned,biomarkers);
    const files=structuredClone(demo.providers),inAbuDhabi=(price,extra={})=>[{emirate:'abu_dhabi',price_aed:price,...extra}];
    files.find(f=>f.provider.slug==='walk-in-lab-b').offerings.push(
      {name:'Kids Health Package',kind:'package',biomarkers_as_printed:[{name:'Ferritin',id:'ferritin'}],prices:inAbuDhabi(50)},
      {name:'Folate',kind:'single_test',biomarkers_as_printed:[{name:'Folate',id:'folate'}],prices:inAbuDhabi(40,{price_type:'indicative'})},
      {name:'TSH',kind:'single_test',biomarkers_as_printed:[{name:'TSH',id:'tsh'}],prices:inAbuDhabi(30,{price_type:'promo',valid_until:'2026-01-31'})},
      {name:'Allergy panel',kind:'panel',biomarkers_as_printed:['Cat dander IgE'],prices:inAbuDhabi(300)},
      {name:'HbA1c',kind:'single_test',biomarkers_as_printed:[{name:'HbA1c',id:'hba1c'}],prices:[{emirate:'sharjah',price_aed:60}]},
      {name:'Ramadan Special',kind:'package',biomarkers_as_printed:[{name:'Glucose',id:'glucose'}],prices:inAbuDhabi(99)},
      {name:'Glucose',kind:'single_test',biomarkers_as_printed:[{name:'Glucose',id:'glucose'}]});
    files.push({collected_on:'2026-10-01',provider:{slug:'profile-only',name:'Profile only',type:'lab'}});
    for(const file of files) await loadProvider(client,pruned,checkProviderFile(file,{source:'price_list'}),index,{mappedBy:'demo-seed'});
    const rules={coreBiomarkers:['total-cholesterol','ldl-cholesterol','hdl-cholesterol','triglycerides','ferritin','vitamin-d-25-oh','vitamin-b12'],minCoreBiomarkers:7,
      excludedProviders:{'provider-d':'test'},staleOfferings:[{provider:'walk-in-lab-b',name:'ramadan',reason:'test'}]};
    assert.deepEqual(await prune(client,pruned,rules),{excludedProviders:['provider-d'],staleOfferings:1,stalePrices:2,pricesOutsideArea:1,
      notForAdults:1,unpriced:4,noBiomarker:1,emptyProviders:['profile-only'],narrowProviders:['clinic-c']});
    const {rows}=await client.query(`SELECT p.slug,count(o.id)::int AS offerings FROM ${pruned}.providers p LEFT JOIN ${pruned}.offerings o ON o.provider_id=p.id GROUP BY 1 ORDER BY 1`);
    assert.deepEqual(rows,[{slug:'home-visit-a',offerings:5},{slug:'walk-in-lab-b',offerings:4}]);
    assert.deepEqual(await prune(client,pruned,rules),{excludedProviders:[],staleOfferings:0,stalePrices:0,pricesOutsideArea:0,
      notForAdults:0,unpriced:0,noBiomarker:0,emptyProviders:[],narrowProviders:[]});
    await assert.rejects(prune(client,pruned,{...rules,staleOfferings:[{provider:'x',name:'a',url:'b'}]}),/exactly one/);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${pruned} CASCADE`);
    client.release();
  }
});
