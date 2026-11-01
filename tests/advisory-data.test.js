const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const master=read('data/karnal_master_demo_output.json');
const periods=master.summary.master_timeline.map(p=>read(`data/periods/${p.period_start}.json`));

test('no-crop points never receive stress or an irrigation advisory',()=>{
  for(const period of periods)for(const row of period.records){
    if(row.satellite.NDVI===null||row.satellite.NDVI>=0.2)continue;
    assert.equal(row.derived.moisture_stress,'No crop / fallow');
    assert.equal(row.water_balance.recommended_depth_mm,0);
    assert.equal(row.water_balance.priority_score,0);
    assert.equal(row.water_balance.deficit_mm,null);
  }
});

test('depth follows the deficit and label, score and timing agree',()=>{
  const bands={'No / Low Priority':[1,'No irrigation indicated'],'Low Priority':[4,'Within 4-5 days'],'Medium Priority':[7,'Within 2-3 days'],'High Priority':[10,'Within 24 hours']};
  for(const period of periods)for(const {water_balance:w} of period.records){
    if(w.deficit_mm===null)continue;
    if(w.recommended_depth_mm>0)assert.ok(Math.abs(w.recommended_depth_mm-Math.min(60,w.deficit_mm*1.15))<=1,JSON.stringify(w)); // 60 mm is the single-application cap.
    const band=bands[w.priority_label];
    if(!band)continue;
    assert.equal(w.priority_score,band[0],JSON.stringify(w));
    assert.equal(w.timing,band[1],JSON.stringify(w));
  }
});

test('the demo opens on a canopy date and stress keeps its lower classes',()=>{
  const start=periods.find(p=>p.summary.period_start===master.summary.demo_default_period).summary;
  assert.equal(start.optical_mode,'fresh');
  assert.ok(start.vegetation_distribution['Dense / Healthy Vegetation']>start.vegetation_distribution['Sparse / Early Vegetation']);
  for(const label of ['No Stress','Mild Stress','Moderate Stress','Severe Stress'])assert.ok(start.stress_distribution[label]>0,label);
});

test('reported crop metrics are held out, not on circular labels',()=>{
  const crop=read('data/crop_engine_metrics.json');
  assert.equal(crop.research_leader.macro_f1,0.391);
  assert.equal(crop.research_leader.accuracy,0.733);
  assert.equal(crop.fields,5551);
  assert.equal(crop.applied_to_karnal,false);
  assert.ok(crop.deployable_model.macro_f1>crop.research_leader.baseline_macro_f1);
});

test('all policies in the shared-water case get the same release',()=>{
  const sim=read('data/policy_sim/results.json');
  assert.equal(sim.seasons,20);
  assert.match(sim.status,/not measured/i);
  for(const scenario of Object.values(sim.shared_water.scenarios)){
    for(const policy of Object.values(scenario.policies))assert.ok(policy.water_mm<=scenario.release_mm_per_season+0.1);
    assert.ok(scenario.policies.budget.yield>scenario.policies.fixed.yield);
  }
});
