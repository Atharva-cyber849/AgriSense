'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pct = value => `${(value * 100).toFixed(2)}%`;
  const score = value => Number(value).toFixed(3);
  const count = value => Number(value).toLocaleString('en-IN');
  const palette = ['#43d9ae', '#64bcff', '#f4c36b', '#c7a1ff', '#ff98af'];
  const metricNames = {macro_f1:'Macro-F1', accuracy:'Accuracy', balanced_accuracy:'Balanced accuracy', weighted_f1:'Weighted F1'};
  let data, selected, visible = [];
  const modelKey = r => `${r.feature_set}/${r.model}`;
  const featureLabel = fs => data.feature_labels[fs] || fs;
  const modelAt = key => data.models.find(r => modelKey(r) === key);

  function table(headers, rows, options = {}) {
    return `<table class="${options.className || ''}"><thead><tr>${headers.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((v, i) => `<${i === 0 ? 'th scope="row"' : 'td'}>${esc(v)}</${i === 0 ? 'th' : 'td'}>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  function bars(id, rows, {max = 1, format = score, color = palette[0], signed = false} = {}) {
    $(id).innerHTML = rows.map(row => {
      const width = Math.min(100, Math.abs(row.value) / (max || 1) * 100);
      const fill = signed
        ? `<div class="signed-track"><span class="signed-fill" style="${row.value < 0 ? 'right' : 'left'}:50%;width:${width / 2}%;background:${row.value < 0 ? palette[2] : color}"></span></div>`
        : `<div class="bar-track"><div class="bar-fill" style="width:${width}%;background:${color}"></div></div>`;
      return `<div class="bar-row"><div class="bar-label">${esc(row.label)}${row.sub ? `<small>${esc(row.sub)}</small>` : ''}</div>${fill}<span class="bar-value">${esc(format(row.value))}</span></div>`;
    }).join('') + `<div class="axis-note"><span>${signed ? esc(format(-max)) : '0'}</span><span>${signed ? '0 · mean decrease in macro-F1' : 'Scale'}</span><span>${esc(format(max))}</span></div>`;
  }

  // Fixed 0–1 y scale keeps sensor/model comparisons honest. Native SVG has no CDN dependency.
  function lines(id, labels, series, {percent = false} = {}) {
    const width = 720, height = 280, left = 48, right = 22, top = 16, bottom = 42;
    const x = i => left + i * (width - left - right) / Math.max(1, labels.length - 1);
    const y = v => top + (1 - v) * (height - top - bottom);
    let markup = `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(series.map(s => s.name).join(' versus '))}">`;
    for (let tick = 0; tick <= 4; tick++) {
      const v = tick / 4;
      markup += `<line class="gridline" x1="${left}" x2="${width-right}" y1="${y(v)}" y2="${y(v)}"/><text x="${left-9}" y="${y(v)+4}" text-anchor="end">${percent ? `${v*100}%` : v.toFixed(2)}</text>`;
    }
    labels.forEach((label, i) => {
      if (labels.length <= 8 || i % 2 === 0) markup += `<text x="${x(i)}" y="${height-13}" text-anchor="middle">${esc(label)}</text>`;
    });
    series.forEach((s, j) => {
      const color = palette[j % palette.length];
      markup += `<polyline fill="none" stroke="${color}" stroke-width="2.5" ${j ? 'stroke-dasharray="6 3"' : ''} points="${s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>`;
      s.values.forEach((v, i) => {
        const sd = s.std?.[i];
        if (sd != null) {
          const hi = y(Math.min(1, v+sd)), lo = y(Math.max(0, v-sd));
          markup += `<path d="M${x(i)},${hi}V${lo} M${x(i)-4},${hi}H${x(i)+4} M${x(i)-4},${lo}H${x(i)+4}" stroke="${color}"/>`;
        }
        markup += `<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="${color}"><title>${esc(s.name)} · ${esc(labels[i])}: ${percent ? pct(v) : score(v)}${sd != null ? ` ± ${score(sd)} SD` : ''}</title></circle>`;
      });
    });
    markup += '</svg><div class="legend">' + series.map((s,j) => `<span><i style="background:${palette[j % palette.length]}"></i>${esc(s.name)}</span>`).join('') + '</div>';
    $(id).innerHTML = markup;
  }

  function kpis(id, cards) {
    $(id).innerHTML = cards.map(c => `<div class="kpi"><span>${esc(c[0])}</span><strong>${esc(c[1])}</strong><small>${esc(c[2])}</small></div>`).join('');
  }

  function overview() {
    const m = data.manifest;
    const leaders = data.leaders.map(l => modelAt(modelKey(l)));
    const fusion = leaders.find(r => r.feature_set === 'A3_S1_S2_temporal');
    const optical = leaders.find(r => r.feature_set === 'A1_S2_temporal');
    $('scope').textContent = `${count(m.unique_fields)} fields · ${m.classes.length} crop classes · ${m.unique_periods} ten-day periods · Sentinel-1 + Sentinel-2`;
    $('validation-label').textContent = `${m.n_folds}-fold spatial validation`;
    kpis('kpis', [['Labeled fields', count(m.unique_fields), `${count(m.rows)} field-period records`], ['Fusion macro-F1', score(fusion.macro_f1), fusion.model], ['Fusion accuracy', pct(fusion.accuracy), 'Pooled out-of-fold predictions'], ['Crop classes', m.classes.length, `${m.n_folds} spatial validation folds`]]);
    const delta = (fusion.macro_f1 - optical.macro_f1) * 100;
    $('finding').textContent = `The fusion leader scores ${delta.toFixed(2)} percentage points ${delta >= 0 ? 'above' : 'below'} the temporal optical leader on macro-F1. High overall accuracy masks uneven crop performance: inspect the per-crop results before drawing conclusions about rare classes. This comparison uses different selected models and is not a significance test.`;
    bars('sensor-bars', leaders.filter(r => r.feature_set !== 'A3_S1_S2_sequence').map(r => ({label:featureLabel(r.feature_set), sub:r.model, value:r.macro_f1})));
    bars('class-bars', data.class_support.map(r => ({label:r.crop, value:r.fields})), {max:m.unique_fields, format:count, color:palette[1]});
    bars('deep-bars', data.models.filter(r => r.feature_set === 'A3_S1_S2_sequence').sort((a,b) => b.macro_f1-a.macro_f1).map(r => ({label:r.model, sub:`Accuracy ${pct(r.accuracy)}`, value:r.macro_f1})), {color:palette[3]});
    const coverage = [...data.coverage].sort((a,b) => a.period_index-b.period_index);
    lines('coverage-chart', coverage.map(r => r.period_index), [
      {name:'Valid NDVI', values:coverage.map(r => r.ndvi_valid_fraction)},
      {name:'Any S1 observation', values:coverage.map(r => r.s1_any_fraction)},
      {name:'Mean S2 clear fraction', values:coverage.map(r => r.mean_s2_clear_frac)},
    ], {percent:true});
    $('coverage-table').innerHTML = table(['Period','Fields','Valid NDVI','Any S1','Mean S2 clear'], coverage.map(r => [r.period_index, count(r.fields), pct(r.ndvi_valid_fraction), pct(r.s1_any_fraction), pct(r.mean_s2_clear_frac)]));
  }

  function renderModels() {
    const feature = $('feature-filter').value, metric = $('metric-filter').value;
    const term = $('model-search').value.trim().toLowerCase();
    visible = data.models.filter(r => (!feature || r.feature_set === feature) && r.model.toLowerCase().includes(term)).sort((a,b) => b[metric]-a[metric] || a.model.localeCompare(b.model));
    $('result-count').textContent = `${visible.length} of ${data.models.length} model/feature-set combinations · ranked by ${metricNames[metric]}`;
    $('export-models').disabled = visible.length === 0;
    if (!visible.length) {
      $('leaderboard').innerHTML = '<p>No matching models. Clear the search or reset filters.</p>';
      $('model-detail').hidden = true;
      return;
    }
    if (!visible.some(r => modelKey(r) === selected)) selected = modelKey(visible[0]);
    $('leaderboard').innerHTML = `<table><thead><tr>${['Rank','Model','Feature set','Macro-F1','Accuracy','Balanced accuracy','Weighted F1','Details'].map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${visible.map((r,i) => `<tr class="${modelKey(r) === selected ? 'selected' : ''}"><td>${i+1}</td><th scope="row">${esc(r.model)}</th><td>${esc(featureLabel(r.feature_set))}</td><td>${score(r.macro_f1)}</td><td>${pct(r.accuracy)}</td><td>${pct(r.balanced_accuracy)}</td><td>${score(r.weighted_f1)}</td><td><button type="button" data-model="${esc(modelKey(r))}" aria-label="Inspect ${esc(r.model)} with ${esc(featureLabel(r.feature_set))}" aria-pressed="${modelKey(r) === selected}">Inspect</button></td></tr>`).join('')}</tbody></table>`;
    $('model-detail').hidden = false;
    detail();
  }

  function detail() {
    const r = modelAt(selected);
    $('model-title').textContent = `${r.model} · ${featureLabel(r.feature_set)}`;
    $('model-description').textContent = `All ${count(data.manifest.unique_fields)} fields have exactly one held-out prediction. Per-crop scores and confusion counts are calculated from those predictions.`;
    kpis('model-kpis', [['Macro-F1', score(r.macro_f1), 'Equal weight per crop'], ['Accuracy', pct(r.accuracy), 'Correct predictions / all fields'], ['Balanced accuracy', pct(r.balanced_accuracy), 'Mean recall across crops'], ['Weighted F1', score(r.weighted_f1), 'Weighted by crop support']]);
    $('class-table').innerHTML = table(['Crop','Precision','Recall','F1','Fields'], r.per_class.map(c => [c.crop, score(c.precision), score(c.recall), score(c.f1), count(c.support)]));
    bars('fold-bars', r.folds.map(f => ({label:`Fold ${f.fold+1}`, sub:`${count(f.fields)} fields · accuracy ${pct(f.accuracy)}`, value:f.macro_f1})), {color:palette[1]});
    matrix();
  }

  function matrix() {
    const r = modelAt(selected), mode = $('matrix-mode').value;
    const labels = data.manifest.classes;
    const max = Math.max(...r.confusion.flat());
    $('confusion').innerHTML = `<table class="matrix"><caption>Actual crop × predicted crop · ${mode === 'percent' ? 'each row sums to 100% before rounding' : 'number of fields'}</caption><thead><tr><th scope="col">Actual ↓ / Predicted →</th>${labels.map(l => `<th scope="col">${esc(l)}</th>`).join('')}</tr></thead><tbody>${r.confusion.map((row,i) => {
      const total = row.reduce((a,b) => a+b, 0);
      return `<tr><th scope="row">${esc(labels[i])}</th>${row.map((v,j) => {
        const fraction = mode === 'percent' ? v/total : v/(max || 1);
        return `<td style="background:rgba(0,125,110,${(fraction*.85).toFixed(3)})" title="${esc(labels[i])} → ${esc(labels[j])}: ${v} fields (${pct(v/total)})">${mode === 'percent' ? `${(v/total*100).toFixed(1)}%` : v}</td>`;
      }).join('')}</tr>`;
    }).join('')}</tbody></table>`;
  }

  function robustness() {
    const random = $('scenario-mode').value === 'random';
    const scenarios = random ? ['random_0','random_20','random_40','random_60'] : ['random_0','contiguous_20d','contiguous_40d'];
    const labels = random ? ['Unmasked','20% masked','40% masked','60% masked'] : ['Unmasked','20-day gap','40-day gap'];
    const featureSets = ['A1_S2_temporal','A3_S1_S2_temporal'];
    const shown = featureSets.flatMap(fs => scenarios.map(s => data.robustness.find(r => r.feature_set === fs && r.scenario === s)));
    lines('robustness-chart', labels, featureSets.map(fs => {
      const rows = shown.filter(r => r.feature_set === fs);
      return {name:`${featureLabel(fs)} · ${rows[0].model}`, values:rows.map(r => r.mean), std:rows.map(r => r.std)};
    }));
    $('robustness-table').innerHTML = table(['Feature set','Model','Masking scenario','Mean macro-F1','SD','Repeats'], shown.map(r => [featureLabel(r.feature_set), r.model, labels[scenarios.indexOf(r.scenario)], score(r.mean), r.std == null ? '— (one run)' : score(r.std), r.repeats]));
  }

  function evidence() {
    const m = data.manifest;
    $('manifest').innerHTML = [
      ['Validation', m.validation_mode.replaceAll('_',' ')], ['Outer folds', m.n_folds],
      ['Training/evaluation profile', m.run_profile], ['Importance profile', 'Quick exploratory run'],
      ['Periodic batches', `${m.found_periodic_batches.length}/8`], ['Observation batches', `${m.found_observation_batches.length}/8`],
      ['Missing periodic batches', m.missing_periodic_batches.join(', ') || 'None'], ['Missing observation batches', m.missing_observation_batches.join(', ') || 'None'],
    ].map(([k,v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
    $('reconciliation').textContent = `Build verification: ${count(data.validation.predictions_checked)} predictions checked across ${data.validation.models_reconciled_against_oof} model/feature-set combinations; headline scores, class support and unique out-of-fold coverage reconciled.`;
    bars('missing-bars', data.missingness.map(r => ({label:r.feature, value:r.fraction})), {format:pct, color:palette[2]});
    $('consistency').innerHTML = table(['Sensor','Expected presence','Template rows','Difference'], data.consistency.map(r => [r.sensor, count(r.expected_periodic_presence), count(r.template_rows), count(r.difference)]));
    $('downloads').innerHTML = data.downloads.map(name => `<a href="data/agrifieldnet/source/${encodeURIComponent(name)}" download>${esc(name.replaceAll('_',' ').replace('.csv',''))} ↓</a>`).join('');
    $('gallery').innerHTML = data.figures.map(name => `<figure><a href="data/agrifieldnet/plots/${encodeURIComponent(name)}" target="_blank" rel="noopener"><img loading="lazy" src="data/agrifieldnet/plots/${encodeURIComponent(name)}" alt="${esc(name.replaceAll('_',' ').replace('.png',''))}"></a><figcaption>${esc(name.replaceAll('_',' ').replace('.png',''))}${name.includes('importance_quick') ? ' · Quick exploratory estimate' : ''}</figcaption></figure>`).join('');
    const importance = data.importance.slice(0,20);
    bars('importance-bars', importance.map(r => ({label:r.feature, value:r.mean})), {signed:true, max:Math.max(...importance.map(r => Math.abs(r.mean))), format:v => `${v > 0 ? '+' : ''}${v.toFixed(4)}`});
  }

  function activate(view) {
    if (!['overview','models','robustness','evidence'].includes(view)) view = 'overview';
    document.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== view; });
    document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
    history.replaceState(null, '', `#${view}`);
  }

  function exportModels() {
    const columns = ['feature_set','model','macro_f1','accuracy','balanced_accuracy','weighted_f1'];
    const quote = v => `"${String(v).replaceAll('"','""')}"`;
    const csv = [columns.join(','), ...visible.map(r => columns.map(c => quote(r[c])).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8'}));
    const link = document.createElement('a');
    link.href = url; link.download = 'agrifieldnet_filtered_models.csv';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function init() {
    try {
      const response = await fetch('data/agrifieldnet/dashboard.json');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data = await response.json();
      if (data.schema_version !== 1 || !data.models?.length) throw new Error('Unsupported or empty results snapshot');
      $('feature-filter').innerHTML = '<option value="">All feature sets</option>' + Object.entries(data.feature_labels).map(([key,label]) => `<option value="${esc(key)}">${esc(label)}</option>`).join('');
      $('feature-filter').value = 'A3_S1_S2_temporal';
      overview(); renderModels(); robustness(); evidence();
      document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => activate(button.dataset.view)));
      $('feature-filter').addEventListener('change', renderModels);
      $('metric-filter').addEventListener('change', renderModels);
      $('model-search').addEventListener('input', renderModels);
      $('reset-models').addEventListener('click', () => { $('feature-filter').value = ''; $('metric-filter').value = 'macro_f1'; $('model-search').value = ''; renderModels(); });
      $('leaderboard').addEventListener('click', event => { const button = event.target.closest('[data-model]'); if (button) { selected = button.dataset.model; renderModels(); $('model-detail').scrollIntoView({behavior:'auto', block:'start'}); } });
      $('matrix-mode').addEventListener('change', matrix);
      $('scenario-mode').addEventListener('change', robustness);
      $('export-models').addEventListener('click', exportModels);
      window.addEventListener('hashchange', () => activate(location.hash.slice(1)));
      activate(location.hash.slice(1));
      $('status').hidden = true; $('dashboard').hidden = false;
    } catch (error) {
      $('status').classList.add('error');
      $('status').textContent = `Results could not be loaded (${error.message}). Serve AgriSense with npm start and confirm data/agrifieldnet/dashboard.json is present.`;
      $('scope').textContent = 'Research results are currently unavailable.';
      console.error('AgriFieldNet dashboard:', error);
    }
  }
  init();
})();
