const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const soil=require('../soil-moisture.js');
const data=require('../data/soil-moisture/dashboard.json');
test('complete evidence, prediction counts and downloadable source integrity',()=>{
  soil.validate(data);
  assert.equal(data.validation.total_prediction_rows,426752);
  assert.equal(data.validation.checks.reduce((s,r)=>s+r.groups,0),1296);
  assert.equal(data.validation.verified_evidence_tables,38);
  for(const source of data.provenance.published_sources){
    const bytes=fs.readFileSync(path.join(__dirname,'../data/soil-moisture/source',source.file));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),source.sha256,source.file);
  }
});
test('filters preserve distinct experiments and known descriptive baseline results',()=>{
  for(const h of [1,3,7])assert.equal(soil.dailyRows(data,h).length,20);
  const q=soil.dailyRows(data,3);
  const best=network=>q.filter(r=>r.network===network).sort((a,b)=>a.RMSE-b.RMSE)[0];
  assert.equal(best('NOAA').family,'Persistence');
  assert.equal(best('SCAN').family,'Kalman LDS');
  assert.ok(Math.abs(best('NOAA').RMSE-.019416130260587753)<1e-12);
  const b=data.bootstrap.find(r=>r.network==='NOAA'&&r.block_days===30);
  assert.ok(b.lower95<0&&b.upper95>0);
});
test('single-class event groups retain missing AP and do not enter AP means',()=>{
  const q=soil.eventRows(data,3);
  assert.equal(q.length,10);
  for(const row of q){assert.equal(row.supported,8);assert.equal(row.groups,10);}
  const single=data.events.filter(r=>!r.both_classes);
  assert.ok(single.length>0);
  assert.ok(single.every(r=>r.AP===null));
  const base=q.find(r=>r.family==='Persistence');
  assert.ok(Math.abs(base.Brier-.0405)<.0001);
});
test('sunflower uses treatment-year macro means and preserves year scope',()=>{
  for(const year of ['2015','2016'])assert.ok(soil.sunflowerRows(data,year).every(r=>r.groups===12));
  const all=soil.sunflowerRows(data,'all');
  assert.ok(all.every(r=>r.groups===24));
  const best=[...all].sort((a,b)=>a.RMSE-b.RMSE)[0];
  assert.equal(best.family,'Irregular Gaussian HMM');
  assert.ok(Math.abs(best.RMSE-.01517)<.00001);
});
test('exports include only the selected lead and validation rejects damaged snapshots',()=>{
  const rows=soil.dailyRows(data,7);
  const out=soil.csv(rows);
  assert.equal(out.split('\r\n').length,21);
  assert.ok(rows.every(r=>r.horizon===7));
  assert.throws(()=>soil.validate({...data,daily:data.daily.slice(1)}));
  const bad=structuredClone(data);bad.daily[0].RMSE=null;
  assert.throws(()=>soil.validate(bad));
});
