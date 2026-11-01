const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const lab = require('../js/kaggriculture.js');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const game = (a, b, x, y, seed = 1) => ({ strategies: [a, b], final: [x, y], seed });

test('tournament schedule plays every pairing from both seats on each seed', () => {
  const games = lab.schedule(['a', 'b', 'c'], 2);
  assert.equal(games.length, 12);
  assert.ok(games.some(g => g.a === 'a' && g.b === 'b' && g.seed === 2));
  assert.ok(games.some(g => g.a === 'b' && g.b === 'a' && g.seed === 2));
  assert.ok(games.every(g => g.a !== g.b));
});

test('standings count a draw as half a win and rank by win rate', () => {
  const table = lab.standings([game('a', 'b', 100, 50), game('b', 'a', 70, 70), game('b', 'c', 90, 10)]);
  assert.deepEqual(table.map(r => r.name), ['a', 'b', 'c']);
  assert.equal(table[0].winRate, 0.75);
  assert.equal(table[1].winRate, 0.5);
  assert.equal(table[1].draws, 1);
  assert.equal(table[0].avgCoins, 85);
});

test('head to head combines both seats from the row strategy view', () => {
  const pairs = lab.headToHead([game('a', 'b', 100, 50), game('b', 'a', 90, 60)]);
  assert.equal(pairs.a.b.margin, 20);
  assert.equal(pairs.a.b.wins, 1);
  assert.equal(pairs.b.a.margin, -20);
  assert.equal(pairs.a.b.games, 2);
});

test('results export writes the winner or a draw', () => {
  const csv = lab.resultsCsv([game('a', 'b', 5, 2, 3), game('a', 'b', 4, 4, 4)]);
  assert.match(csv, /^seed,player_a/);
  assert.match(csv, /3,a,b,5,2,a/);
  assert.match(csv, /4,a,b,4,4,draw/);
});

test('every strategy offered in the app exists, and the entry point is last', () => {
  const agents = read('kaggriculture/main.py');
  const engine = read('kaggriculture/engine/kaggriculture.py');
  for (const [name, meta] of Object.entries(lab.STRATEGIES)) {
    if (meta.builtin) assert.match(engine, new RegExp(`"${name}": ${name}_agent`), name);
    else assert.ok(agents.includes(`"${name}":`), name);
  }
  const lastDef = [...agents.matchAll(/^(?:def|class) (\w+)/gm)].pop()[1];
  assert.equal(lastDef, 'agent');
});

test('vendored engine has not been edited', () => {
  const bytes = fs.readFileSync(path.join(root, 'kaggriculture/engine/kaggriculture.py'));
  const digest = crypto.createHash('sha256').update(bytes.toString('utf8').replace(/\r\n/g, '\n')).digest('hex');
  assert.equal(digest, 'bc8a54879ef02c7ea64b8b333d6a976f0ea65c4949149d01f463f23bccee653e');
  assert.ok(fs.existsSync(path.join(root, 'kaggriculture/engine/LICENSE')));
});

test('the lab page and its link from the main page are wired up', () => {
  const page = read('kaggriculture.html');
  for (const id of ['run-match', 'run-tournament', 'player-a', 'player-b', 'match-seed', 'standings', 'matrix', 'engine-status', 'replay-slider']) {
    assert.ok(page.includes(`id="${id}"`), id);
  }
  assert.match(page, /js\/kaggriculture\.js/);
  assert.match(read('index.html'), /href="kaggriculture\.html"/);
  const worker = read('js/kaggriculture-worker.js');
  for (const file of ['engine/kaggriculture.py', 'engine/kaggriculture.json', 'runner.py', 'main.py']) {
    assert.ok(worker.includes(file), file);
    assert.ok(fs.existsSync(path.join(root, 'kaggriculture', file)), file);
  }
});
