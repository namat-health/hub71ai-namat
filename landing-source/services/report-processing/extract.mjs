// Conservative extraction: each candidate remains a draft with its verbatim source.
// No numeric conversion, unit conversion, range inference or clinical interpretation.
const NAME=/^(?:ha?emoglobin|hba1c|glycated ha?emoglobin|wbc|rbc|platelets?|ha?ematocrit|mcv|mchc?|rdw|neutrophils?|lymphocytes?|monocytes?|eosinophils?|basophils?|glucose|fasting glucose|cholesterol|total cholesterol|hdl(?: cholesterol)?|ldl(?: cholesterol)?|triglycerides?|creatinine|egfr|urea|bun|uric acid|sodium|potassium|chloride|bicarbonate|calcium|magnesium|phosph(?:ate|orus)|alt|ast|alp|ggt|bilirubin|total bilirubin|albumin|total protein|tsh|free t[34]|ft[34]|vitamin d|25[- ]oh vitamin d|vitamin b12|b12|folate|ferritin|iron|transferrin|crp|hs[- ]crp|c[- ]reactive protein|esr|testosterone|psa|insulin)\b/i;
const VALUE=/^([<>≤≥]?\s*[-+]?\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?)/;
export const PROCESSOR_VERSION='namat-lab-draft-2026-10-01.1';
export function extractObservations(pages) {
  const observations=[];
  const dates=pages.flatMap(page=>(page.lines||[]).map(line=>({page:page.number,text:line.text,match:line.text.match(/^(?:collection|collected|sample|specimen|report)(?:\s+date)?\s*:\s*(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\b/i)}))).filter(row=>row.match);
  const uniqueDates=new Set(dates.map(row=>row.match[1]));
  const seen=new Set();
  for (const page of pages) for (const line of page.lines||[]) {
    const text=String(line.text||'').trim(),match=text.match(NAME);
    if (!match) continue;
    const remainder=text.slice(match[0].length).replace(/^[\s:|]+/,'');
    const value=remainder.match(VALUE);
    if (!value) continue;
    const tail=remainder.slice(value[0].length).trim().replace(/^[HL*]\s+/, '');
    const unit=tail.match(/^(?:mmol\/L|[munpµμ]?g\/(?:dL|L|mL)|mg\/dl|IU\/L|U\/L|mIU\/L|µIU\/mL|uIU\/mL|ng\/mL|pg\/mL|pmol\/L|nmol\/L|mL\/min(?:\/1\.73\s?m[²2])?|10\^?[36912]+\/L|x?10[³⁶⁹¹²]+\/L|%|fL|pg|mm\/hr)(?=\s|$)/i);
    const rest=(unit?tail.slice(unit[0].length):tail).replace(/^[\s|:]+/,'');
    const range=rest.match(/^(?:[LH*]\s+)?(?:\(?\s*)([<>≤≥]?\s*\d+(?:[.,]\d+)?\s*[-–]\s*\d+(?:[.,]\d+)?|[<>≤≥]\s*\d+(?:[.,]\d+)?)/);
    const signature=`${page.number}:${text.toLowerCase().replace(/\s+/g,' ')}`;
    if(seen.has(signature))continue;seen.add(signature);
    const localDate=dates.filter(row=>row.page===page.number),dateSource=new Set(localDate.map(row=>row.match[1])).size===1?localDate[0]:uniqueDates.size===1?dates[0]:null;
    observations.push({name:match[0],value:value[1].trim(),unit:unit?.[0]||null,
      referenceRange:range?.[1]?.trim()||null,date:dateSource?.match[1]||null,
      ...(dateSource?{dateSourceText:dateSource.text,dateSourcePage:dateSource.page}:{}),page:page.number,sourceText:text,
      ...(line.bounds?{bounds:line.bounds}:{}),reviewRequired:true});
    if (observations.length>=500) return observations;
  }
  return observations;
}
