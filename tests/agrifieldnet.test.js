// Exercise the real page controller with a minimal DOM harness, no browser dependencies.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'data/agrifieldnet/dashboard.json'), 'utf8'));
const source = fs.readFileSync(path.join(root, 'agrifieldnet.js'), 'utf8');

async function controller(failed = false) {
  const nodes = new Map();
  const make = () => ({value:'', hidden:false, innerHTML:'', textContent:'', dataset:{}, listeners:{}, attributes:{}, classList:{add(){}},
    addEventListener(name, callback) { this.listeners[name] = callback; },
    setAttribute(name, value) { this.attributes[name] = value; },
    scrollIntoView(){}, click(){}, remove(){}});
  const html = fs.readFileSync(path.join(root, 'agrifieldnet.html'), 'utf8');
  for (const [,id] of html.matchAll(/id="([^"]+)"/g)) nodes.set(id, make());
  nodes.get('metric-filter').value = 'macro_f1';
  nodes.get('matrix-mode').value = 'percent';
  nodes.get('scenario-mode').value = 'random';
  nodes.get('dashboard').hidden = true;
  const panels = ['overview','models','robustness','evidence'].map(view => Object.assign(make(), {dataset:{panel:view}}));
  const tabs = ['overview','models','robustness','evidence'].map(view => Object.assign(make(), {dataset:{view}}));
  let blob;
  const context = {
    document: {getElementById:id => { assert(nodes.has(id), `Missing element #${id}`); return nodes.get(id); },
      querySelectorAll:selector => selector === '[data-panel]' ? panels : tabs,
      createElement:make, body:{append(){}}},
    fetch:async () => ({ok:!failed, status:503, json:async () => snapshot}),
    window:{addEventListener(){}}, history:{replaceState(){}}, location:{hash:''},
    Blob, URL:{createObjectURL(value){blob = value; return 'blob:test';}, revokeObjectURL(){}},
    setTimeout:callback => callback(), console:{error(){}},
  };
  vm.runInNewContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  return {nodes, tabs, panels, getBlob:() => blob};
}

test('initial results, overview, and source-backed details render', async () => {
  const {nodes} = await controller();
  assert.equal(nodes.get('dashboard').hidden, false);
  assert.equal(nodes.get('status').hidden, true);
  assert.match(nodes.get('result-count').textContent, /16 of 83/);
  assert.match(nodes.get('model-title').textContent, /HistGradientBoosting/);
  assert.match(nodes.get('kpis').innerHTML, /73\.30%/);
  assert.match(nodes.get('confusion').innerHTML, /Coriander/);
  assert.match(nodes.get('gallery').innerHTML, /05_fusion_feature_importance_quick.png/);
  assert.match(nodes.get('finding').textContent, /0\.23 percentage points/);
});

test('filters, empty state, reset, ranking and export retain the same scope', async () => {
  const {nodes, getBlob} = await controller();
  nodes.get('model-search').value = 'does-not-exist';
  nodes.get('model-search').listeners.input();
  assert.equal(nodes.get('model-detail').hidden, true);
  assert.equal(nodes.get('export-models').disabled, true);
  nodes.get('reset-models').listeners.click();
  assert.match(nodes.get('result-count').textContent, /83 of 83/);
  nodes.get('feature-filter').value = 'A3_S1_S2_sequence';
  nodes.get('feature-filter').listeners.change();
  assert.match(nodes.get('result-count').textContent, /3 of 83/);
  assert.match(nodes.get('model-title').textContent, /CNN1D/);
  nodes.get('metric-filter').value = 'accuracy';
  nodes.get('metric-filter').listeners.change();
  nodes.get('export-models').listeners.click();
  const csv = await getBlob().text();
  assert.equal(csv.split('\r\n').length, 4);
  assert.match(csv, /CNN1D/);
  assert.doesNotMatch(csv, /HistGradientBoosting/);
});

test('model drill-down, matrix units, tab selection and gap scenarios work', async () => {
  const {nodes, tabs, panels} = await controller();
  nodes.get('leaderboard').listeners.click({target:{closest:() => ({dataset:{model:'A3_S1_S2_temporal/CatBoost'}})}});
  assert.match(nodes.get('model-title').textContent, /^CatBoost/);
  nodes.get('matrix-mode').value = 'count';
  nodes.get('matrix-mode').listeners.change();
  assert.match(nodes.get('confusion').innerHTML, /number of fields/);
  nodes.get('scenario-mode').value = 'contiguous';
  nodes.get('scenario-mode').listeners.change();
  assert.match(nodes.get('robustness-table').innerHTML, /40-day gap/);
  assert.doesNotMatch(nodes.get('robustness-table').innerHTML, /60% masked/);
  tabs[2].listeners.click();
  assert.equal(panels[2].hidden, false);
  assert.equal(panels[0].hidden, true);
  assert.equal(tabs[2].attributes['aria-pressed'], 'true');
});

test('missing data produces a visible error instead of fabricated results', async () => {
  const {nodes} = await controller(true);
  assert.match(nodes.get('status').textContent, /HTTP 503/);
  assert.equal(nodes.get('dashboard').hidden, true);
});

test('every bundled source and figure exists; payload has no workstation paths', () => {
  for (const [folder, files] of [['source',snapshot.downloads],['plots',snapshot.figures]]) {
    for (const file of files) assert(fs.existsSync(path.join(root, 'data/agrifieldnet', folder, file)), file);
  }
  assert.equal(snapshot.validation.predictions_checked, 460733);
  assert.equal(snapshot.models.length, 83);
  assert.equal(snapshot.models.reduce((n,m) => n + m.confusion.flat().reduce((a,b) => a+b,0),0), 460733);
  assert.doesNotMatch(JSON.stringify(snapshot), /\/mnt\/c\/Users|C:\\\\Users|gpu_info/);
});
