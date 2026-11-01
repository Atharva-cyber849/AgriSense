(function (root) {
  'use strict';

  const STRATEGIES = {
    market_planner: { label: 'Market planner', note: 'Prices every crop and animal against what both farms will sell, then takes the best use of each tile. This is the competition entry.' },
    mixed_ranch: { label: 'Mixed ranch', note: 'Cows and geese with daily care, plus wheat and carrots, chosen by expected price.' },
    melon_rush: { label: 'Melon rush', note: 'Melons only, held back from the market when prices fall too far.' },
    staple_fields: { label: 'Staple fields', note: 'Wheat and carrots with hired hands. No animals.' },
    goose_ranch: { label: 'Goose ranch', note: 'Up to 30 geese with wheat. Eggs hold their price, but the setup is slow to pay back.' },
    wheat_loop: { label: 'Wheat loop', note: 'The worked example from the competition guide: one farmer, one tile at a time.' },
    starter: { label: 'Starter', note: 'Kaggle built-in: a one-farmer carrot loop.', builtin: true },
    random: { label: 'Random', note: 'Kaggle built-in: random legal-looking moves.', builtin: true },
    pass: { label: 'Pass', note: 'Kaggle built-in: does nothing, so it keeps its starting $3,000.', builtin: true }
  };

  const DEFAULT_ROSTER = ['market_planner', 'mixed_ranch', 'melon_rush', 'staple_fields', 'goose_ranch', 'starter'];
  const PRODUCTS = ['WHEAT', 'CARROT', 'TOMATO', 'STRAWBERRY', 'MELON', 'EGG', 'MILK', 'WOOL', 'FERTILIZER'];

  // Every ordered pairing, so each strategy plays from both seats on every seed.
  function schedule(names, seedCount) {
    const games = [];
    for (let seed = 1; seed <= seedCount; seed += 1) {
      for (const a of names) {
        for (const b of names) {
          if (a !== b) games.push({ a, b, seed });
        }
      }
    }
    return games;
  }

  function standings(results) {
    const table = new Map();
    const row = name => {
      if (!table.has(name)) table.set(name, { name, games: 0, wins: 0, draws: 0, losses: 0, coins: 0 });
      return table.get(name);
    };
    for (const { strategies: [a, b], final: [coinsA, coinsB] } of results) {
      const [ra, rb] = [row(a), row(b)];
      ra.games += 1; rb.games += 1;
      ra.coins += coinsA; rb.coins += coinsB;
      if (coinsA > coinsB) { ra.wins += 1; rb.losses += 1; }
      else if (coinsB > coinsA) { rb.wins += 1; ra.losses += 1; }
      else { ra.draws += 1; rb.draws += 1; }
    }
    return [...table.values()]
      .map(r => ({ ...r, winRate: r.games ? (r.wins + r.draws / 2) / r.games : 0, avgCoins: r.games ? r.coins / r.games : 0 }))
      .sort((x, y) => y.winRate - x.winRate || y.avgCoins - x.avgCoins);
  }

  // Average coin margin of `row` over `column`, combining both seats.
  function headToHead(results) {
    const pairs = {};
    const add = (me, other, margin, won) => {
      pairs[me] = pairs[me] || {};
      const cell = pairs[me][other] = pairs[me][other] || { games: 0, margin: 0, wins: 0 };
      cell.games += 1;
      cell.margin += margin;
      if (won) cell.wins += 1;
    };
    for (const { strategies: [a, b], final: [coinsA, coinsB] } of results) {
      add(a, b, coinsA - coinsB, coinsA > coinsB);
      add(b, a, coinsB - coinsA, coinsB > coinsA);
    }
    return pairs;
  }

  function resultsCsv(results) {
    const lines = ['seed,player_a,player_b,coins_a,coins_b,winner'];
    for (const r of results) {
      const winner = r.final[0] > r.final[1] ? r.strategies[0] : r.final[1] > r.final[0] ? r.strategies[1] : 'draw';
      lines.push([r.seed, r.strategies[0], r.strategies[1], r.final[0], r.final[1], winner].join(','));
    }
    return `${lines.join('\n')}\n`;
  }

  const api = { STRATEGIES, DEFAULT_ROSTER, PRODUCTS, schedule, standings, headToHead, resultsCsv };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (!root.document) return;

  const $ = id => document.getElementById(id);
  const label = name => STRATEGIES[name]?.label || name;
  const coins = value => `$${Math.round(value).toLocaleString('en-US')}`;
  const signedCoins = value => `${value >= 0 ? '+' : '−'}$${Math.abs(Math.round(value)).toLocaleString('en-US')}`;
  const svgEscape = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const TILES = {
    w: 'Wheat', c: 'Carrot', t: 'Tomato', s: 'Strawberry', m: 'Melon',
    G: 'Goose', C: 'Cow', S: 'Sheep', x: 'Weed', o: 'Empty coop or pasture', '.': 'Empty', '#': 'Locked'
  };

  let worker = null;
  let engineReady = false;
  let nextId = 1;
  const pending = new Map();

  function startWorker() {
    worker = new Worker('js/kaggriculture-worker.js');
    worker.onmessage = ({ data }) => {
      if (data.type === 'ready') {
        engineReady = true;
        setEngineStatus('ready');
        return;
      }
      const job = pending.get(data.id);
      if (data.type === 'error' && !job) {
        setEngineStatus('failed', data.message);
        return;
      }
      if (!job) return;
      if (data.type === 'frame') job.onFrame?.(data.frame);
      if (data.type === 'result') { pending.delete(data.id); job.resolve(data.result); }
      if (data.type === 'error') { pending.delete(data.id); job.reject(new Error(data.message)); }
    };
    worker.onerror = event => setEngineStatus('failed', event.message);
    worker.postMessage({ type: 'boot' });
  }

  function setEngineStatus(state, detail) {
    const status = $('engine-status');
    const controls = [$('run-match'), $('run-tournament')];
    controls.forEach(button => { button.disabled = state !== 'ready'; });
    $('engine-retry').hidden = state !== 'failed';
    status.dataset.state = state;
    status.textContent = state === 'ready'
      ? 'Game engine ready. Matches run in this browser tab.'
      : state === 'failed'
        ? `The game engine could not load, so no matches can run. Check your connection and retry. (${detail || 'Unknown error'})`
        : 'Loading the Python game engine. This downloads about 10 MB the first time…';
  }

  function runGame(a, b, seed, stream, onFrame) {
    return new Promise((resolve, reject) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, { resolve, reject, onFrame });
      worker.postMessage({ type: 'play', id, a, b, seed, stream });
    });
  }

  /* ---- Tooltip ---------------------------------------------------------- */

  function showTip(event, html) {
    const tip = $('viz-tip');
    tip.innerHTML = html;
    tip.hidden = false;
    const x = Math.min(event.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
    const y = Math.max(8, event.clientY - tip.offsetHeight - 10);
    tip.style.transform = `translate(${x}px, ${y}px)`;
  }
  const hideTip = () => { $('viz-tip').hidden = true; };

  /* ---- Line chart ------------------------------------------------------- */

  function niceMax(value) {
    if (value <= 0) return 1;
    const power = 10 ** Math.floor(Math.log10(value));
    const unit = [1, 2, 2.5, 5, 10].find(m => m * power >= value) * power;
    return unit;
  }

  function drawLines(container, series, { format, marker, domainDays = 30 }) {
    const width = 720;
    const height = 280;
    const pad = { left: 62, right: 96, top: 14, bottom: 32 };
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const all = series.flatMap(s => s.values.map(v => v.y));
    const top = niceMax(Math.max(...all, 1));
    const x = day => pad.left + (day / (domainDays - 1)) * innerW;
    const y = value => pad.top + innerH - (value / top) * innerH;
    const grid = [0, 0.25, 0.5, 0.75, 1].map(share => {
      const value = top * share;
      return `<line class="gridline" x1="${pad.left}" x2="${width - pad.right}" y1="${y(value)}" y2="${y(value)}"></line>` +
        `<text x="${pad.left - 8}" y="${y(value) + 4}" text-anchor="end">${svgEscape(format(value))}</text>`;
    }).join('');
    const ticks = [1, 5, 10, 15, 20, 25, 30].filter(d => d <= domainDays).map(day =>
      `<text x="${x(day - 1)}" y="${height - 10}" text-anchor="middle">Day ${day}</text>`).join('');
    // Keep end labels apart when the two series finish close together.
    const ends = series.map(s => ({ s, last: s.values[s.values.length - 1] })).filter(e => e.last);
    const labelY = ends.map(e => y(e.last.y) + 4);
    if (labelY.length === 2 && Math.abs(labelY[0] - labelY[1]) < 14) {
      const middle = (labelY[0] + labelY[1]) / 2;
      const upper = labelY[0] <= labelY[1] ? 0 : 1;
      labelY[upper] = middle - 7;
      labelY[1 - upper] = middle + 7;
    }
    const lines = series.map(s => {
      const points = s.values.map(v => `${x(v.day).toFixed(1)},${y(v.y).toFixed(1)}`).join(' ');
      return `<polyline fill="none" stroke="var(--${s.color})" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${points}"></polyline>`;
    }).join('');
    const endMarks = ends.map((e, i) =>
      `<circle cx="${x(e.last.day)}" cy="${y(e.last.y)}" r="4" fill="var(--${e.s.color})" stroke="var(--card)" stroke-width="2"></circle>` +
      `<text class="end-label" x="${x(e.last.day) + 9}" y="${labelY[i]}">${svgEscape(format(e.last.y))}</text>`).join('');
    const markerLine = marker == null ? '' :
      `<line class="replay-marker" x1="${x(marker)}" x2="${x(marker)}" y1="${pad.top}" y2="${pad.top + innerH}"></line>`;
    container.innerHTML = `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${svgEscape(series.map(s => `${s.name} ${ends.find(e => e.s === s) ? format(ends.find(e => e.s === s).last.y) : ''}`).join(', '))}">
      ${grid}${ticks}${markerLine}${lines}${endMarks}
      <line class="crosshair" y1="${pad.top}" y2="${pad.top + innerH}" hidden></line>
      <rect class="hit" x="${pad.left}" y="${pad.top}" width="${innerW}" height="${innerH}" fill="transparent"></rect>
    </svg>`;
    const svg = container.querySelector('svg');
    const crosshair = svg.querySelector('.crosshair');
    const hit = svg.querySelector('.hit');
    hit.addEventListener('pointermove', event => {
      const box = svg.getBoundingClientRect();
      const px = ((event.clientX - box.left) / box.width) * width;
      const day = Math.round(((px - pad.left) / innerW) * (domainDays - 1));
      const rows = series.map(s => {
        const point = s.values.find(v => v.day === day);
        return point ? `<div class="tip-row"><i style="background:var(--${s.color})"></i>${svgEscape(s.name)}<b>${svgEscape(format(point.y))}</b></div>` : '';
      }).join('');
      if (!rows) { hideTip(); crosshair.setAttribute('hidden', ''); return; }
      crosshair.removeAttribute('hidden');
      crosshair.setAttribute('x1', x(day));
      crosshair.setAttribute('x2', x(day));
      showTip(event, `<div class="tip-title">Day ${day + 1}</div>${rows}`);
    });
    hit.addEventListener('pointerleave', () => { hideTip(); crosshair.setAttribute('hidden', ''); });
  }

  /* ---- Live match ------------------------------------------------------- */

  const match = { frames: [], names: [], index: 0, playing: null, running: false };

  // One point per day: the frame recorded at that day's close.
  function dailyFrames() {
    return match.frames.filter(frame => frame.step > 0);
  }

  function renderMatch() {
    const frames = dailyFrames();
    const [a, b] = match.names;
    if (!frames.length) return;
    const frame = frames[Math.min(match.index, frames.length - 1)];
    const last = frames[frames.length - 1];
    $('match-kpis').innerHTML = [
      { title: `Player A · ${label(a)}`, value: coins(frame.money[0]), small: `${frame.hands[0]} hired hands · ${frame.land[0]} of 4 quadrants` },
      { title: `Player B · ${label(b)}`, value: coins(frame.money[1]), small: `${frame.hands[1]} hired hands · ${frame.land[1]} of 4 quadrants` },
      { title: 'Lead', value: frame.money[0] === frame.money[1] ? 'Level' : coins(Math.abs(frame.money[0] - frame.money[1])), small: frame.money[0] === frame.money[1] ? 'Coins are equal' : `${frame.money[0] > frame.money[1] ? 'Player A' : 'Player B'} ahead` },
      { title: 'Season day', value: `${frame.day + 1} of 30`, small: `${frame.shops.length} town ${frame.shops.length === 1 ? 'shop' : 'shops'} open` }
    ].map(k => `<div class="kpi"><span>${svgEscape(k.title)}</span><strong>${svgEscape(k.value)}</strong><small>${svgEscape(k.small)}</small></div>`).join('');

    const toSeries = (player, color, name) => ({ name, color, values: frames.map(f => ({ day: f.day, y: f.money[player] })) });
    drawLines($('money-chart'), [toSeries(0, 'series-a', `A · ${label(a)}`), toSeries(1, 'series-b', `B · ${label(b)}`)], {
      format: coins, marker: match.running ? null : frame.day
    });
    $('money-legend').innerHTML = `<span><i style="background:var(--series-a)"></i>A · ${svgEscape(label(a))}</span><span><i style="background:var(--series-b)"></i>B · ${svgEscape(label(b))}</span>`;

    const product = $('price-product').value;
    drawLines($('price-chart'), [{ name: product, color: 'series-a', values: frames.map(f => ({ day: f.day, y: f.prices[product] })) }], {
      format: value => coins(value), marker: match.running ? null : frame.day
    });

    renderFarm($('farm-a'), frame, 0, `A · ${label(a)}`);
    renderFarm($('farm-b'), frame, 1, `B · ${label(b)}`);

    const slider = $('replay-slider');
    slider.max = String(frames.length - 1);
    slider.value = String(Math.min(match.index, frames.length - 1));
    $('replay-label').textContent = `Day ${frame.day + 1} · hour ${frame.hour}`;
    $('match-table').innerHTML = `<table><thead><tr><th>Day</th><th class="numeric">A coins</th><th class="numeric">B coins</th><th class="numeric">A hands</th><th class="numeric">B hands</th></tr></thead><tbody>${
      frames.map(f => `<tr><td>${f.day + 1}</td><td class="numeric">${coins(f.money[0])}</td><td class="numeric">${coins(f.money[1])}</td><td class="numeric">${f.hands[0]}</td><td class="numeric">${f.hands[1]}</td></tr>`).join('')
    }</tbody></table>`;
    $('match-summary').textContent = match.running
      ? `Playing day ${last.day + 1} of 30…`
      : matchSummary(last);
  }

  function matchSummary(last) {
    const [a, b] = match.names;
    const [ma, mb] = last.money;
    if (ma === mb) return `Draw on seed ${match.seed}: both finished on ${coins(ma)}.`;
    const winner = ma > mb ? `Player A (${label(a)})` : `Player B (${label(b)})`;
    return `${winner} won on seed ${match.seed}, ${coins(Math.max(ma, mb))} to ${coins(Math.min(ma, mb))}.`;
  }

  function renderFarm(container, frame, player, title) {
    const tiles = frame.tiles[player];
    const units = new Set(frame.units[player].map(([x, y]) => `${x},${y}`));
    let cells = '';
    for (let i = 0; i < tiles.length; i += 1) {
      const code = tiles[i];
      const x = i % 10;
      const y = Math.floor(i / 10);
      const name = TILES[code] || code;
      const hasUnit = units.has(`${x},${y}`);
      const text = code === '.' || code === '#' ? '' : code === 'o' ? '' : code;
      cells += `<div class="tile" data-tile="${code === '.' ? 'empty' : code === '#' ? 'locked' : code}" title="${svgEscape(name)}">${svgEscape(text)}${hasUnit ? '<span class="unit" aria-hidden="true"></span>' : ''}</div>`;
    }
    const planted = [...tiles].filter(code => !'.#xo'.includes(code)).length;
    container.innerHTML = `<h3>${svgEscape(title)}</h3><div class="farm-grid" role="img" aria-label="${svgEscape(`${title}: ${planted} tiles in use on day ${frame.day + 1}`)}">${cells}</div>`;
  }

  function stopReplay() {
    if (match.playing) clearInterval(match.playing);
    match.playing = null;
    $('replay-play').textContent = 'Play season';
  }

  async function startMatch() {
    const a = $('player-a').value;
    const b = $('player-b').value;
    const seed = Math.max(1, Math.floor(Number($('match-seed').value) || 1));
    $('match-seed').value = String(seed);
    stopReplay();
    Object.assign(match, { frames: [], names: [a, b], seed, index: 0, running: true });
    setBusy(true);
    $('match-output').hidden = false;
    $('match-error').hidden = true;
    $('match-summary').textContent = 'Starting the match…';
    try {
      const result = await runGame(a, b, seed, true, frame => {
        match.frames.push(frame);
        match.index = dailyFrames().length - 1;
        renderMatch();
      });
      match.frames = result.frames;
      match.running = false;
      match.index = dailyFrames().length - 1;
      renderMatch();
      const failures = result.errors.map((error, i) => error && `${i ? 'Player B' : 'Player A'}: ${error}`).filter(Boolean);
      if (failures.length) showMatchError(`A strategy raised an error and passed those turns. ${failures.join(' ')}`);
    } catch (error) {
      showMatchError(`The match stopped: ${error.message}`);
    } finally {
      match.running = false;
      setBusy(false);
    }
  }

  function showMatchError(message) {
    const box = $('match-error');
    box.textContent = message;
    box.hidden = false;
  }

  function setBusy(busy) {
    $('run-match').disabled = busy || !engineReady;
    $('run-tournament').disabled = busy || !engineReady;
    $('replay-play').disabled = busy;
    $('replay-slider').disabled = busy;
  }

  /* ---- Tournament ------------------------------------------------------- */

  const tournament = { results: [], running: false, stop: false };

  async function startTournament() {
    const names = [...document.querySelectorAll('#roster input:checked')].map(input => input.value);
    const seeds = Number($('tournament-seeds').value);
    if (names.length < 2) {
      $('tournament-progress').textContent = 'Pick at least two strategies.';
      return;
    }
    const games = schedule(names, seeds);
    Object.assign(tournament, { results: [], running: true, stop: false });
    setBusy(true);
    $('stop-tournament').hidden = false;
    $('export-tournament').hidden = true;
    $('tournament-output').hidden = false;
    $('tournament-error').hidden = true;
    const started = performance.now();
    try {
      for (let i = 0; i < games.length && !tournament.stop; i += 1) {
        const { a, b, seed } = games[i];
        const elapsed = (performance.now() - started) / 1000;
        const remaining = i ? Math.ceil((elapsed / i) * (games.length - i)) : null;
        $('tournament-progress').textContent = `Match ${i + 1} of ${games.length}: ${label(a)} vs ${label(b)}, seed ${seed}${remaining === null ? '' : ` · about ${remaining}s left`}`;
        $('tournament-bar').style.width = `${(i / games.length) * 100}%`;
        tournament.results.push(await runGame(a, b, seed, false));
        renderTournament(names);
      }
      const played = tournament.results.length;
      tournament.running = false;
      if (played) renderTournament(names);
      $('tournament-bar').style.width = `${(played / games.length) * 100}%`;
      $('tournament-progress').textContent = tournament.stop
        ? `Stopped after ${played} of ${games.length} matches. Standings cover those matches only.`
        : `Finished ${played} matches across ${seeds} ${seeds === 1 ? 'seed' : 'seeds'}.`;
      $('export-tournament').hidden = played === 0;
    } catch (error) {
      const box = $('tournament-error');
      box.textContent = `The tournament stopped after ${tournament.results.length} matches: ${error.message}`;
      box.hidden = false;
    } finally {
      tournament.running = false;
      $('stop-tournament').hidden = true;
      setBusy(false);
    }
  }

  function renderTournament(names) {
    const table = standings(tournament.results);
    const top = Math.max(...table.map(r => r.avgCoins), 1);
    $('standings').innerHTML = `<table><thead><tr><th>Rank</th><th>Strategy</th><th class="numeric">Win rate</th><th class="numeric">W–D–L</th><th>Average coins</th></tr></thead><tbody>${
      table.map((r, i) => `<tr><td>${i + 1}</td><td>${svgEscape(label(r.name))}</td><td class="numeric">${(r.winRate * 100).toFixed(0)}%</td><td class="numeric">${r.wins}–${r.draws}–${r.losses}</td>
        <td><div class="avg-bar" data-tip="${svgEscape(`${label(r.name)}: ${coins(r.avgCoins)} average over ${r.games} matches`)}"><div class="avg-track"><div class="avg-fill" style="width:${(r.avgCoins / top) * 100}%"></div></div><span>${coins(r.avgCoins)}</span></div></td></tr>`).join('')
    }</tbody></table>`;
    const pairs = headToHead(tournament.results);
    const order = table.map(r => r.name).concat(names.filter(n => !table.some(r => r.name === n)));
    const largest = Math.max(1, ...order.flatMap(me => order.map(other => Math.abs((pairs[me]?.[other]?.margin || 0) / (pairs[me]?.[other]?.games || 1)))));
    $('matrix').innerHTML = `<table class="matrix"><thead><tr><th>Row vs column</th>${order.map(n => `<th>${svgEscape(label(n))}</th>`).join('')}</tr></thead><tbody>${
      order.map(me => `<tr><th>${svgEscape(label(me))}</th>${order.map(other => {
        if (me === other) return '<td class="self" aria-label="Same strategy">–</td>';
        const cell = pairs[me]?.[other];
        if (!cell) return '<td class="self">…</td>';
        const margin = cell.margin / cell.games;
        const strength = Math.round(Math.min(1, Math.abs(margin) / largest) * 70 + 10);
        const hue = margin >= 0 ? 'var(--series-a)' : 'var(--series-b)';
        return `<td style="background:color-mix(in srgb, ${hue} ${strength}%, var(--card))" data-tip="${svgEscape(`${label(me)} vs ${label(other)}: won ${cell.wins} of ${cell.games}, average margin ${signedCoins(margin)}`)}">${signedCoins(margin)}<small>${cell.wins}/${cell.games}</small></td>`;
      }).join('')}</tr>`).join('')
    }</tbody></table>`;
    const best = table[0];
    $('tournament-finding').textContent = `${label(best.name)} leads with a ${(best.winRate * 100).toFixed(0)}% win rate and ${coins(best.avgCoins)} on average, over ${best.games} matches${tournament.running ? ' so far' : ''}.`;
  }

  function download(name, text) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    link.download = name;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  /* ---- Page setup ------------------------------------------------------- */

  function init() {
    const options = Object.entries(STRATEGIES).map(([value, s]) => `<option value="${value}">${svgEscape(s.label)}</option>`).join('');
    $('player-a').innerHTML = options;
    $('player-b').innerHTML = options;
    $('player-a').value = 'market_planner';
    $('player-b').value = 'melon_rush';
    $('price-product').innerHTML = PRODUCTS.map(p => `<option value="${p}">${p[0]}${p.slice(1).toLowerCase()}</option>`).join('');
    $('price-product').value = 'MILK';
    $('roster').innerHTML = Object.entries(STRATEGIES).map(([value, s]) =>
      `<label class="roster-item"><input type="checkbox" value="${value}" ${DEFAULT_ROSTER.includes(value) ? 'checked' : ''}><span><b>${svgEscape(s.label)}</b>${s.builtin ? ' <em>Kaggle built-in</em>' : ''}<small>${svgEscape(s.note)}</small></span></label>`).join('');
    $('tile-key').innerHTML = Object.entries(TILES).map(([code, name]) =>
      `<span><div class="tile" data-tile="${code === '.' ? 'empty' : code === '#' ? 'locked' : code}">${code === '.' || code === '#' || code === 'o' ? '' : svgEscape(code)}</div>${svgEscape(name)}</span>`).join('') +
      '<span><div class="tile" data-tile="empty"><span class="unit"></span></div>Worker</span>';

    const updateRosterCount = () => {
      const names = document.querySelectorAll('#roster input:checked').length;
      const seeds = Number($('tournament-seeds').value);
      const games = names * (names - 1) * seeds;
      $('tournament-size').textContent = names < 2 ? 'Pick at least two strategies.' : `${games} matches: every pairing, from both seats, on each seed.`;
    };
    $('roster').addEventListener('change', updateRosterCount);
    $('tournament-seeds').addEventListener('change', updateRosterCount);
    updateRosterCount();

    document.querySelectorAll('.tabs button').forEach(button => {
      button.addEventListener('click', () => {
        document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
        document.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== button.dataset.view; });
      });
    });

    $('run-match').addEventListener('click', startMatch);
    $('run-tournament').addEventListener('click', startTournament);
    $('stop-tournament').addEventListener('click', () => {
      tournament.stop = true;
      $('tournament-progress').textContent = 'Stopping after this match…';
    });
    $('export-tournament').addEventListener('click', () => download('kaggriculture_tournament.csv', resultsCsv(tournament.results)));
    $('engine-retry').addEventListener('click', () => {
      worker.terminate();
      setEngineStatus('loading');
      startWorker();
    });
    $('price-product').addEventListener('change', renderMatch);
    $('replay-slider').addEventListener('input', event => {
      stopReplay();
      match.index = Number(event.target.value);
      renderMatch();
    });
    $('replay-play').addEventListener('click', () => {
      if (match.playing) { stopReplay(); return; }
      const total = dailyFrames().length;
      if (!total) return;
      if (match.index >= total - 1) match.index = 0;
      $('replay-play').textContent = 'Pause';
      renderMatch();
      match.playing = setInterval(() => {
        if (match.index >= total - 1) { stopReplay(); return; }
        match.index += 1;
        renderMatch();
      }, 450);
    });
    document.addEventListener('pointermove', event => {
      const target = event.target.closest?.('[data-tip]');
      if (target) showTip(event, svgEscape(target.dataset.tip));
      else if (!event.target.closest?.('.hit')) hideTip();
    });

    setEngineStatus('loading');
    startWorker();
  }

  document.addEventListener('DOMContentLoaded', init);
})(typeof window === 'object' ? window : globalThis);
