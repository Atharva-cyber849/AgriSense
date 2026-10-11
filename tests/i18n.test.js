const test=require('node:test');
const assert=require('node:assert/strict');
const i18n=require('../i18n.js');
const rows=require('../i18n-catalog.js');
const regional=require('../i18n-regional.js');

test('ten Indian languages plus English have complete, aligned, safe catalogues',()=>{
  assert.deepEqual(Object.keys(i18n.names),['en','hi','bn','mr','te','ta','gu','ur','kn','or','ml']);
  const tokens=s=>[...s.matchAll(/\{\w+\}/g)].map(x=>x[0]).sort();
  for(const [code,catalogue] of Object.entries(regional)){
    assert.equal(Object.keys(catalogue).length,rows.length,code);
    i18n.setPreference(code);
    assert.equal(i18n.resolve(code,'karnal'),code);
    assert.equal(i18n.locale(),`${code}-IN`);
    for(const [en] of rows){
      const value=catalogue[en];
      assert.ok(typeof value==='string'&&value.trim(),`${code}: ${en}`);
      assert.notEqual(value,en,`${code}: untranslated ${en}`);
      assert.deepEqual(tokens(value),tokens(en),`${code}: ${en}`);
      assert.ok(!/[<>]/.test(value),`${code}: unexpected markup`);
      assert.equal(i18n.t(en),value,`${code}: ${en}`);
    }
    assert.equal(i18n.t('FIELD-001'),'FIELD-001');
    assert.ok(i18n.t('Farm {number} • {id}',{number:2,id:'FIELD-001'}).includes('FIELD-001'));
    for(const label of ['Within 24 hours','Within 2-3 days','Within 4-5 days','No irrigation indicated'])assert.notEqual(i18n.t(label),label);
    assert.ok(i18n.t('FAO-56 ET₀ Estimate').includes('FAO-56 ET₀'));
  }
  i18n.setPreference('en');
});

test('Urdu isolates interpolated identifiers without changing source values',()=>{
  i18n.setPreference('ur');
  assert.ok(i18n.t('Farm {number} • {id}',{number:1,id:'GEE-PIXEL-2015'}).includes('\u2068GEE-PIXEL-2015\u2069'));
  assert.equal(i18n.t('GEE-PIXEL-2015'),'GEE-PIXEL-2015');
  i18n.setPreference('en');
});
test('study-area defaults and explicit overrides',()=>{
  assert.equal(i18n.resolve('auto','karnal'),'hi');
  assert.equal(i18n.resolve('auto','haridwar'),'hi');
  assert.equal(i18n.resolve('auto','agrifieldnet'),'en');
  assert.equal(i18n.resolve('ta','karnal'),'ta');
  assert.equal(i18n.resolve('constructor','karnal'),'hi');
  assert.equal(i18n.resolve('auto','unknown'),'en');
});
test('catalogue completeness, unique keys and placeholder parity',()=>{
  const tokens=s=>[...s.matchAll(/\{\w+\}/g)].map(x=>x[0]).sort();
  assert.equal(new Set(rows.map(r=>r[0])).size,rows.length);
  for(const [en,...translations] of rows)for(const text of translations){assert.ok(text.trim(),en);assert.deepEqual(tokens(text),tokens(en),en);}
});
test('prototype caveats, timing and source values remain distinct',()=>{
  i18n.setPreference('hi');
  assert.equal(i18n.t('Within 24 hours'),'24 घंटों के भीतर');
  assert.match(i18n.t('Prototype water-balance advisory using real 8-day weather.'),/प्रायोगिक/);
  assert.equal(i18n.t('FIELD-001'),'FIELD-001');
  assert.equal(i18n.t('Farm {number} • {id}',{number:1,id:'<test>{number}'}),'खेत 1 • <test>{number}');
  i18n.setPreference('ta');assert.equal(i18n.t('Water Deficit'),'நீர்ப் பற்றாக்குறை');
  i18n.setPreference('en');assert.equal(i18n.t('Water Deficit'),'Water Deficit');
});
test('invalid or unavailable preference storage is safe',()=>{
  const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
  assert.equal(i18n.read(blocked),'auto');assert.equal(i18n.save(blocked,'hi'),false);
  assert.equal(i18n.read({getItem:()=>'{invalid'}),'auto');
  let saved;assert.equal(i18n.save({setItem(k,v){saved=[k,v];}},'ta'),true);
  assert.deepEqual(saved,[i18n.key,'ta']);
});
