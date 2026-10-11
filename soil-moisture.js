/* Historical research explorer. No inference, training or irrigation APIs are called. */
(function (root) {
  'use strict';
  const families = ['Persistence', 'Seasonal climatology', 'Markov chain', 'Gaussian BN', 'Gaussian DBN', 'Gaussian HMM', 'Logit-normal HMM', 'Kalman LDS', 'Switching LDS (IMM)', 'Nonlinear beta CPD'];
  const sfLabels = {'Persistence': 'Persistence', 'Irregular Gaussian DBN': 'Gaussian transition regression', 'Irregular Kalman LDS': 'Duration-dependent Gaussian transition', 'Irregular Gaussian HMM': 'HMM-gated Gaussian regression'};
  const descriptions = {
    'Persistence': ['Repeats the latest moisture value, with horizon-specific Gaussian error variance fitted on training data.', 'Missing history is forward-filled for at most three days, then replaced by the training median. Abrupt wetting and long outages can defeat persistence.'],
    'Seasonal climatology': ['A Gaussian moisture distribution for each calendar month, pooled across training stations.', 'Captures seasonality but misses local rainfall responses and station-specific moisture levels.'],
    'Markov chain': ['Three observed moisture bins use training terciles. A fitted transition matrix propagates the current bin; Gaussian emissions describe future moisture.', 'Bins are relative moisture levels, not measured crop-stress classes. Discretization limits precision.'],
    'Gaussian BN': ['A separate linear Gaussian conditional model predicts each horizon from lagged moisture, rainfall and temperature. There are no hidden states.', 'Ridge-regularized coefficients use training-scaled inputs. Linearity and site shifts can limit transfer.'],
    'Gaussian DBN': ['A multivariate Gaussian state propagates moisture at three depths, rainfall and temperature. Available measurements condition the state; missing components retain propagated uncertainty.', 'This is a statistical weather–moisture system. It does not impose a physical water balance.'],
    'Gaussian HMM': ['Two or three hidden states have Gaussian moisture emissions and a learned transition matrix. Filtering updates state probabilities before forecasting.', 'State numbers are arbitrary mixture labels. Shared emission levels may transfer poorly between soil baselines.'],
    'Logit-normal HMM': ['A hidden Markov model is fitted to logit-transformed moisture, yielding predictive support between zero and one.', 'Boundary inputs are clipped to [0.00001, 0.99999]. Bounded support does not guarantee better accuracy or calibration.'],
    'Kalman LDS': ['A continuous latent moisture state follows linear Gaussian dynamics. Kalman updates combine process and measurement uncertainty.', 'A single linear response can miss abrupt transitions. Implemented as the one-regime switching model.'],
    'Switching LDS (IMM)': ['Two discrete regimes have separate linear moisture dynamics and shared observation variance. Interacting multiple-model inference moment-matches regime-conditioned Gaussian beliefs.', 'Training uses a Gaussian mixture and weighted regressions, not full switching-state expectation maximization. More regimes can add estimation error.'],
    'Nonlinear beta CPD': ['Boosted trees estimate the logit mean of a beta conditional distribution. A constant precision is fitted per forecast horizon.', 'Predictions remain between zero and one, but extrapolation to unfamiliar stations is limited. Tree leaves are not hidden temporal states.']
  };
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = (v, n = 5) => v == null || !Number.isFinite(v) ? '—' : v !== 0 && Math.abs(v) < .00001 ? v.toExponential(2) : v.toFixed(n);
  const pct = v => v == null ? '—' : v > 0 && v < .0005 ? '<0.1%' : `${(v * 100).toFixed(1)}%`;
  const signed = v => `${v > 0 ? '+' : ''}${fmt(v)}`;
  const mean = values => { const valid = values.filter(v => Number.isFinite(v)); return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null; };
  function summarize(rows, keys, fields) {
    const groups = new Map();
    for (const row of rows) { const key = JSON.stringify(keys.map(k => row[k])); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); }
    return [...groups.values()].map(group => Object.assign(Object.fromEntries(keys.map(k => [k, group[0][k]])), Object.fromEntries(fields.map(k => [k, mean(group.map(r => r[k]))])), {groups: group.length}));
  }
  function dailyRows(data, horizon) { return data.daily.filter(r => r.horizon === Number(horizon)); }
  function eventRows(data, horizon) {
    const rows = data.events.filter(r => r.horizon === Number(horizon));
    return summarize(rows, ['family'], ['Brier', 'AP']).map(r => ({...r, supported: rows.filter(x => x.family === r.family && x.both_classes).length}));
  }
  function sunflowerRows(data, year) {
    return summarize(data.sunflower.filter(r => year === 'all' || r.test_year === Number(year)), ['family'], ['RMSE', 'MAE', 'coverage90', 'interval_width']);
  }
  function csv(rows) {
    if (!rows.length) return '';
    const keys = Object.keys(rows[0]);
    const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    return [keys.map(cell).join(','), ...rows.map(r => keys.map(k => cell(r[k])).join(','))].join('\r\n');
  }
  function validate(data) {
    if (data.schema_version !== 1 || data.daily?.length !== 60 || data.events?.length !== 300 || data.sunflower?.length !== 96) throw Error('Incomplete study snapshot');
    for (const network of ['NOAA', 'SCAN']) for (const horizon of [1, 3, 7]) for (const family of families) {
      const rows = data.daily.filter(r => r.network === network && r.horizon === horizon && r.family === family);
      if (rows.length !== 1 || !['RMSE', 'MAE', 'coverage_cal', 'width_cal'].every(k => Number.isFinite(rows[0][k]))) throw Error('Invalid forecast scores');
    }
    if (data.validation?.checks?.some(r => r.metric_reconciliation !== 'passed')) throw Error('Unreconciled study data');
    return data;
  }
  const api = {families, sfLabels, dailyRows, eventRows, sunflowerRows, csv, validate};
  if (typeof module !== 'undefined') module.exports = api;
  root.AgriSenseSoil = api;
  if (!root.document) return;
  const $ = id => document.getElementById(id);
  const updateNoticeLanguage = () => { $('research-scope').lang = root.AgriSenseI18n.language; };
  root.addEventListener('agrisense:languagechange', updateNoticeLanguage);
  document.addEventListener('DOMContentLoaded', updateNoticeLanguage);
  let data;
  function table(id, rows, columns, caption) {
    $(id).innerHTML = `<table><caption class="language-help">${esc(caption)}</caption><thead><tr>${columns.map(c => `<th scope="col">${esc(c[1])}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${columns.map((c, i) => `<${i ? 'td' : 'th scope="row"'}>${esc(c[2] ? c[2](r[c[0]]) : r[c[0]])}</${i ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</tbody></table>`;
    $(id).tabIndex = 0;
    $(id).setAttribute('aria-label', caption + '; scroll for more columns');
  }
  function bars(id, rows, metric, max, label = r => r.family) {
    $(id).innerHTML = `<div class="axis-note"><span>0</span><span class="scale-label">${fmt(max)} ${metric === 'Brier' ? 'Brier score' : 'm³/m³'}</span></div>${rows.map(r => `<div class="bar-row ${r.family === 'Persistence' ? 'baseline' : ''}"><span class="bar-label">${esc(label(r))}</span><div class="bar-track" aria-hidden="true"><div class="bar-fill" style="width:${max ? Math.max(0, Math.min(100, 100 * r[metric] / max)) : 0}%"></div></div><span class="bar-value">${fmt(r[metric])}</span></div>`).join('')}`;
  }
  function renderForecasts() {
    const horizon = Number($('forecast-horizon').value), metric = $('forecast-metric').value;
    const rows = dailyRows(data, horizon), max = Math.max(...rows.map(r => r[metric])) * 1.05;
    for (const [network, id] of [['NOAA', 'noaa'], ['SCAN', 'scan']]) {
      const group = families.map(family => rows.find(r => r.network === network && r.family === family));
      bars(id + '-bars', group, metric, max);
      const best = [...group].sort((a, b) => a[metric] - b[metric])[0], base = group.find(r => r.family === 'Persistence');
      $(id + '-finding').textContent = `${horizon}-day ${metric}: ${best.family} has the lowest recorded error (${fmt(best[metric])}); persistence is ${fmt(base[metric])} m³/m³.`;
    }
    table('interval-table', rows, [['network','Network'],['family','Model'],['RMSE','RMSE',fmt],['MAE','MAE',fmt],['coverage_cal','90% interval coverage',pct],['width_cal','Interval width (m³/m³)',fmt],['Brier_cal','Calibrated Brier',fmt],['outside_mass','Mass outside [0,1]',pct]], `${horizon}-day accuracy and uncertainty`);
    $('original-support').innerHTML = ['NOAA','SCAN'].map(network => {const q=data.daily_support.filter(r=>r.network===network&&r.horizon===horizon);return `<p class="note">${network}: ${q.filter(r=>r.both_classes).length}/${q.length} station–year groups contain both event classes at ${horizon} days.</p>`;}).join('');
  }
  function renderBootstrap() {
    const rows = data.bootstrap.filter(r => r.block_days === Number($('bootstrap-block').value));
    $('bootstrap-results').innerHTML = `<div class="bootstrap-grid">${rows.map(r => `<div><h3>${esc(r.network)}</h3><strong>${signed(r.delta_MAE)} <small>m³/m³</small></strong><p>95% interval: [${signed(r.lower95)}, ${signed(r.upper95)}]</p><p>${r.lower95 > 0 ? 'The selected pipeline has higher MAE in this comparison.' : r.upper95 < 0 ? 'The selected pipeline has lower MAE in this comparison.' : 'The interval includes zero; superiority is not established.'}</p></div>`).join('')}</div>`;
  }
  function renderResilience() {
    const network = $('robust-network').value, rows = data.robustness.filter(r => r.network === network);
    const scenarios = [['clean','Clean'],['outage_7d','7-day outage'],['outage_30d','30-day outage'],['drift_negative','Negative drift'],['drift_positive','Positive drift']];
    const max = Math.max(...rows.map(r=>r.RMSE));
    $('robust-table').innerHTML = `<table class="soil-heat"><caption class="language-help">${network}: full-year RMSE under sensor failures</caption><thead><tr><th scope="col">Model</th>${scenarios.map(s=>`<th scope="col">${s[1]}</th>`).join('')}</tr></thead><tbody>${families.map(f=>`<tr><th scope="row">${esc(f)}</th>${scenarios.map(([s])=>{const r=rows.find(r=>r.family===f&&r.scenario===s);return `<td style="background:rgba(92,205,174,${.06+.35*r.RMSE/max})">${fmt(r.RMSE)}</td>`;}).join('')}</tr>`).join('')}</tbody></table>`;
    $('robust-table').tabIndex = 0;
    table('ablation-table',data.ablations.filter(r=>r.network===network),[['family','Model'],['scenario','Inputs',v=>v==='target_only'?'Target only':'Target + weather'],['RMSE','RMSE',fmt],['MAE','MAE',fmt]],'Fixed-hyperparameter ablations');
  }
  function renderClimate() {
    const rows = families.map(f=>({family:f, station:data.daily.find(r=>r.network==='SCAN'&&r.family===f&&r.horizon===3).RMSE, climate:data.climate.find(r=>r.family===f&&r.horizon===3).RMSE}));
    const max=Math.max(...rows.flatMap(r=>[r.station,r.climate]))*1.05;
    $('climate-bars').innerHTML=`<div class="axis-note"><span>0</span><span>${fmt(max)} m³/m³</span></div>${rows.map(r=>`<div class="paired-row"><span>${esc(r.family)}</span><div class="paired-bars">${['station','climate'].map((key,i)=>`<div class="bar-row"><div class="bar-track" aria-hidden="true"><div class="bar-fill ${i?'secondary':''}" style="width:${100*r[key]/max}%"></div></div><span class="bar-value" aria-label="${key} holdout RMSE">${fmt(r[key])}</span></div>`).join('')}</div></div>`).join('')}`;
    table('climate-table',rows,[['family','Model'],['station','Station holdout RMSE',fmt],['climate','Climate holdout RMSE',fmt]],'SCAN transfer comparison');
  }
  function renderEvents() {
    const horizon=Number($('event-horizon').value), rows=eventRows(data,horizon).sort((a,b)=>a.Brier-b.Brier);
    const folds=data.events.filter(r=>r.horizon===horizon&&r.family==='Persistence');
    $('event-support').textContent=`${folds.filter(r=>r.both_classes).length} of ${folds.length} station–year groups contain both event classes at ${horizon} days.`;
    bars('event-bars',rows,'Brier',Math.max(...rows.map(r=>r.Brier))*1.05);
    table('event-table',rows,[['family','Model'],['Brier','Raw Brier',fmt],['AP','AP (supported folds)',fmt],['supported','Folds with both classes']], 'Soil event probability quality');
    table('event-folds',folds,[['fold','Station–year'],['n','Observations'],['events','Low-moisture events'],['both_classes','Both classes',v=>v?'Yes':'No']], 'Soil event class support');
  }
  function renderSunflower() {
    const year=$('sunflower-year').value, rows=sunflowerRows(data,year).sort((a,b)=>a.RMSE-b.RMSE);
    bars('sunflower-bars',rows,'RMSE',Math.max(...rows.map(r=>r.RMSE))*1.05,r=>sfLabels[r.family]);
    table('sunflower-table',rows,[['family','Model',v=>sfLabels[v]],['RMSE','RMSE (m³/m³)',fmt],['MAE','MAE (m³/m³)',fmt],['coverage90','90% interval coverage',pct],['interval_width','Interval width (m³/m³)',fmt]], 'Sunflower retrospective endpoint estimates');
    const base=data.sunflower.filter(r=>r.family==='Persistence'&&(year==='all'||r.test_year===Number(year)));
    $('sunflower-count').textContent=`${base.length} treatment–year groups, ${base.reduce((n,r)=>n+r.n,0)} measured intervals per model. Each group receives equal weight, regardless of its interval count.`;
  }
  function renderModel() {
    const f=$('model-family').value;
    $('model-name').textContent=f; $('model-description').textContent=descriptions[f][0]; $('model-limitation').textContent=descriptions[f][1];
  }
  function renderSources() {
    $('validation-summary').textContent=`${data.validation.total_prediction_rows.toLocaleString('en-IN')} archived prediction rows checked across five experiments. ${data.validation.verified_evidence_tables} evidence tables passed SHA-256 integrity checks.`;
    table('validation-table',data.validation.checks,[['dataset','Experiment'],['prediction_rows','Prediction rows'],['groups','Metric groups'],['metric_reconciliation','Scores reconciled'],['target_reconciliation','Target check']], 'Integration validation');
    table('dataset-table',data.datasets,[['network','Network'],['stations','Stations'],['daily_rows','Daily rows'],['start','First date'],['end','Last date']], 'Measured observation coverage');
    table('split-table',data.splits,[['network','Experiment'],['fold','Held-out fold'],['fit_end','Fit through'],['cal_start','Calibration from'],['cal_end','Calibration through'],['test_start','Test from'],['test_end','Test through']], 'Daily temporal partitions');
    $('input-hashes').innerHTML=data.provenance.inputs.map(r=>`<div class="hash">${esc(r.file)}<code>SHA-256 ${esc(r.sha256)}</code></div>`).join('');
    $('model-family').innerHTML=families.map(f=>`<option>${esc(f)}</option>`).join('');
    $('model-family').value='Gaussian DBN';renderModel();
  }
  function switchView(view) {
    document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));
    document.querySelectorAll('[data-panel]').forEach(p=>{p.hidden=p.dataset.panel!==view;});
  }
  async function init() {
    try {
      const response=await fetch('data/soil-moisture/dashboard.json');
      if(!response.ok)throw Error('Study data unavailable');
      data=validate(await response.json());
      $('soil-kpis').innerHTML=[['10','Daily model families','Including persistence and climatology'],['1 · 3 · 7','Day forecast leads','Mid-depth volumetric moisture'],['9','US monitoring stations','NOAA and SCAN evaluated separately'],['90%','Nominal interval level','Check observed coverage and width']].map(([value,label,detail])=>`<div class="kpi"><span>${label}</span><strong>${value}</strong><small>${detail}</small></div>`).join('');
      renderForecasts();renderBootstrap();renderResilience();renderClimate();renderEvents();renderSunflower();renderSources();
      $('soil-status').hidden=true;$('soil-dashboard').hidden=false;
    } catch(error) {
      $('soil-status').hidden=false;$('soil-dashboard').hidden=true;
      $('soil-status').innerHTML='The research data could not be loaded. <button type="button" class="retry" id="retry-soil">Try again</button> <a href="data/soil-moisture/source/daily_macro.csv">Download the forecast CSV</a>.';
      $('retry-soil').addEventListener('click',init);
      console.error('Soil moisture dashboard:',error.message);
    }
  }
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
  for(const [ids,fn] of [[['forecast-horizon','forecast-metric'],renderForecasts],[['bootstrap-block'],renderBootstrap],[['robust-network'],renderResilience],[['event-horizon'],renderEvents],[['sunflower-year'],renderSunflower],[['model-family'],renderModel]])for(const id of ids)$(id).addEventListener('change',()=>{if(data)fn();});
  $('export-forecasts').addEventListener('click',()=>{
    if(!data)return;
    const horizon=$('forecast-horizon').value;
    const blob=new Blob([csv(dailyRows(data,horizon))],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`soil-moisture-${horizon}-day-scores.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  init();
})(typeof globalThis!=='undefined'?globalThis:this);
