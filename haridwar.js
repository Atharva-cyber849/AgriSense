let haridwarData = null;
let haridwarCharts = {};
let currentHaridwarSeason = 'wheat_2023_24';
let currentFeatureSet = 'S1_S2_fusion';

document.addEventListener('DOMContentLoaded', async () => {
  if (window.lucide) lucide.createIcons();

  bindHaridwarNavigation();

  try {
    const response = await fetch(
      'data/haridwar/haridwar_dashboard.json',
      { cache: 'no-store' }
    );

    if (!response.ok) {
      throw new Error(
        `Unable to load Haridwar dashboard data (HTTP ${response.status}).`
      );
    }

    haridwarData = await response.json();

    renderHaridwarHeader();
    renderHaridwarOverview();
    renderHaridwarPhenology();
    renderHaridwarModels();
    renderHaridwarRobustness();
    renderHaridwarGallery();
  } catch (error) {
    console.error(error);
    document.querySelector('.haridwar-shell').innerHTML = `
      <section class="haridwar-card">
        <div class="haridwar-warning">
          ${escapeHtml(error.message)}
        </div>
      </section>
    `;
  }
});

function bindHaridwarNavigation() {
  document.querySelectorAll('.haridwar-tab').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.haridwar-tab')
        .forEach(x => x.classList.remove('active'));

      document.querySelectorAll('.haridwar-panel')
        .forEach(x => x.classList.remove('active'));

      button.classList.add('active');

      document
        .querySelector(`[data-panel="${button.dataset.tab}"]`)
        ?.classList.add('active');

      window.setTimeout(() => {
        Object.values(haridwarCharts)
          .forEach(chart => chart?.resize?.());
      }, 50);
    });
  });

  document.getElementById('h-season-select')
    ?.addEventListener('change', event => {
      currentHaridwarSeason = event.target.value;
      renderHaridwarPhenology();
    });

  document.querySelectorAll('[data-feature-set]')
    .forEach(button => {
      button.addEventListener('click', () => {
        currentFeatureSet = button.dataset.featureSet;

        document.querySelectorAll('[data-feature-set]')
          .forEach(x => x.classList.remove('active'));

        button.classList.add('active');
        renderHaridwarModels();
      });
    });
}

function renderHaridwarHeader() {
  const meta = haridwarData.meta;
  const fusionBest = haridwarData.best_models.S1_S2_fusion;

  setText('h-kpi-seasons', meta.seasons.length);
  setText('h-kpi-labelled', meta.labelled_rows);
  setText('h-kpi-f1', fusionBest.macro_f1.toFixed(3));
  setText('h-kpi-s1', meta.s1_track_observations.toLocaleString());
  setText('h-scope-note', meta.scope_note);
}

function renderHaridwarOverview() {
  const meta = haridwarData.meta;
  const s1 = haridwarData.season_meta.wheat_2023_24;
  const s2 = haridwarData.season_meta.wheat_2024_25;

  setText('h-over-calendar', meta.fusion_calendar_rows);
  setText('h-over-anchors', meta.published_stage_anchors);

  setText(
    'h-over-optical-1',
    `${(s1.usable_optical_fraction * 100).toFixed(1)}%`
  );
  setText(
    'h-over-gap-1',
    `${s1.usable_optical_dates}/${s1.calendar_acquisitions} usable dates • longest gap ≈ ${s1.approx_longest_missing_run_days} d`
  );

  setText(
    'h-over-optical-2',
    `${(s2.usable_optical_fraction * 100).toFixed(1)}%`
  );
  setText(
    'h-over-gap-2',
    `${s2.usable_optical_dates}/${s2.calendar_acquisitions} usable dates • longest gap ≈ ${s2.approx_longest_missing_run_days} d`
  );

  renderSeasonQualityTable();
  renderAnalysisNotes();
  renderBestModelSummaryChart();
  renderStageDistributionChart();
}

function renderSeasonQualityTable() {
  const body = document.getElementById('h-season-quality-body');
  if (!body) return;

  body.innerHTML = Object.entries(haridwarData.season_meta)
    .map(([season, value]) => `
      <tr>
        <td><strong>${formatSeason(season)}</strong></td>
        <td>${value.calendar_acquisitions}</td>
        <td>${value.usable_optical_dates}</td>
        <td>${(value.usable_optical_fraction * 100).toFixed(1)}%</td>
        <td>${value.approx_longest_missing_run_days} d</td>
      </tr>
    `).join('');
}

function renderAnalysisNotes() {
  const target = document.getElementById('h-analysis-notes');
  if (!target) return;

  target.innerHTML = haridwarData.analysis_notes
    .map(note => `
      <div class="haridwar-analysis-note">
        <strong>${escapeHtml(note.title)}</strong>
        <p>${escapeHtml(note.text)}</p>
      </div>
    `).join('');
}

function renderBestModelSummaryChart() {
  const canvas = document.getElementById('hBestModelChart');
  if (!canvas) return;

  destroyChart('best');

  const order = ['S2_only', 'S1_only', 'S1_S2_fusion'];

  haridwarCharts.best = new Chart(
    canvas.getContext('2d'),
    {
      type: 'bar',
      data: {
        labels: order.map(formatFeatureSet),
        datasets: [
          {
            label: 'Accuracy',
            data: order.map(
              x => haridwarData.best_models[x].accuracy
            ),
          },
          {
            label: 'Macro F1',
            data: order.map(
              x => haridwarData.best_models[x].macro_f1
            ),
          },
          {
            label: 'Balanced Accuracy',
            data: order.map(
              x => haridwarData.best_models[x].balanced_accuracy
            ),
          }
        ]
      },
      options: commonChartOptions({
        y: {
          min: 0,
          max: 1,
          ticks: { callback: value => `${Math.round(value * 100)}%` }
        }
      })
    }
  );
}

function renderStageDistributionChart() {
  const canvas = document.getElementById('hStageDistChart');
  if (!canvas) return;

  destroyChart('stageDist');

  const entries = Object.entries(haridwarData.stage_distribution);

  haridwarCharts.stageDist = new Chart(
    canvas.getContext('2d'),
    {
      type: 'doughnut',
      data: {
        labels: entries.map(x => x[0]),
        datasets: [{
          data: entries.map(x => x[1]),
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: '#cbd5e1',
              boxWidth: 11,
              font: { size: 10 }
            }
          }
        }
      }
    }
  );
}

function renderHaridwarPhenology() {
  if (!haridwarData) return;

  renderNdviChart();
  renderStageAnchors();
  renderTransitionTable();
}

function renderNdviChart() {
  const canvas = document.getElementById('hNdviChart');
  if (!canvas) return;

  destroyChart('ndvi');

  const rows = haridwarData.ndvi_curves
    .filter(x => x.season === currentHaridwarSeason)
    .sort((a, b) => a.date.localeCompare(b.date));

  const anchors = haridwarData.stage_anchors
    .filter(x => x.season === currentHaridwarSeason);

  const anchorPoints = anchors.map(anchor => {
    const nearest = rows.reduce((best, row) => {
      const distance = Math.abs(
        new Date(row.date) - new Date(anchor.observed_date)
      );
      if (!best || distance < best.distance) {
        return { row, distance };
      }
      return best;
    }, null);

    return {
      x: anchor.observed_date,
      y: nearest?.row?.NDVI_whittaker ?? null,
      stage: anchor.observed_stage,
      group: anchor.stage_group_5,
    };
  });

  haridwarCharts.ndvi = new Chart(
    canvas.getContext('2d'),
    {
      type: 'line',
      data: {
        labels: rows.map(x => x.date),
        datasets: [
          {
            label: 'Raw NDVI',
            data: rows.map(x => x.NDVI_raw),
            spanGaps: true,
            pointRadius: 2,
            borderWidth: 1,
            tension: 0.15,
          },
          {
            label: 'Whittaker-smoothed NDVI',
            data: rows.map(x => x.NDVI_whittaker),
            pointRadius: 0,
            borderWidth: 2,
            tension: 0.25,
          },
          {
            label: 'Published stage anchors',
            data: rows.map(row => {
              const match = anchorPoints.find(x => x.x === row.date);
              return match ? match.y : null;
            }),
            showLine: false,
            pointRadius: 6,
            pointHoverRadius: 8,
          }
        ]
      },
      options: commonChartOptions({
        interaction: {
          mode: 'index',
          intersect: false
        },
        y: {
          min: 0,
          max: 1,
          title: {
            display: true,
            text: 'NDVI',
            color: '#94a3b8'
          }
        }
      })
    }
  );
}

function renderStageAnchors() {
  const target = document.getElementById('h-stage-anchor-list');
  if (!target) return;

  const rows = haridwarData.stage_anchors
    .filter(x => x.season === currentHaridwarSeason)
    .sort((a, b) => a.observed_date.localeCompare(b.observed_date));

  target.innerHTML = rows.map(row => `
    <div class="haridwar-stage-row">
      <time>${formatDate(row.observed_date)}</time>
      <strong>${escapeHtml(row.observed_stage)}</strong>
      <span>${escapeHtml(row.stage_group_5)}</span>
    </div>
  `).join('');
}

function renderTransitionTable() {
  const body = document.getElementById('h-transition-body');
  if (!body) return;

  const rows = haridwarData.transition_evaluation
    .filter(x => x.season === currentHaridwarSeason);

  body.innerHTML = rows.map(row => `
    <tr>
      <td>${escapeHtml(row.method)}</td>
      <td><strong>${escapeHtml(row.transition)}</strong></td>
      <td>${formatDate(row.predicted_date)}</td>
      <td>${formatDate(row.reference_start)} – ${formatDate(row.reference_end)}</td>
      <td>${Number(row.interval_error_days).toFixed(0)} d</td>
    </tr>
  `).join('');
}

function renderHaridwarModels() {
  if (!haridwarData) return;

  renderModelComparison();
  renderSelectedModelMetrics();
  renderConfusionMatrix();
  renderPerSeasonMetrics();
}

function renderModelComparison() {
  const canvas = document.getElementById('hModelChart');
  if (!canvas) return;

  destroyChart('models');

  const rows = haridwarData.model_metrics_loso_oof
    .filter(x => x.feature_set === currentFeatureSet)
    .sort((a, b) => b.macro_f1 - a.macro_f1);

  haridwarCharts.models = new Chart(
    canvas.getContext('2d'),
    {
      type: 'bar',
      data: {
        labels: rows.map(x => x.model),
        datasets: [{
          label: 'Macro F1',
          data: rows.map(x => x.macro_f1),
        }]
      },
      options: commonChartOptions({
        indexAxis: 'y',
        x: {
          min: 0,
          max: .75,
          ticks: {
            callback: value => value.toFixed(1)
          }
        }
      })
    }
  );
}

function renderSelectedModelMetrics() {
  const best = haridwarData.best_models[currentFeatureSet];

  setText(
    'h-best-model-title',
    `${best.model} • ${formatFeatureSet(currentFeatureSet)}`
  );
  setText('h-m-accuracy', pct(best.accuracy));
  setText('h-m-balanced', pct(best.balanced_accuracy));
  setText('h-m-precision', best.macro_precision.toFixed(3));
  setText('h-m-recall', best.macro_recall.toFixed(3));
  setText('h-m-f1', best.macro_f1.toFixed(3));
  setText('h-m-kappa', best.kappa.toFixed(3));
}

function renderConfusionMatrix() {
  const target = document.getElementById('h-confusion-matrix');
  if (!target) return;

  const cm = haridwarData.confusion_matrices[currentFeatureSet];
  const maxValue = Math.max(
    1,
    ...cm.matrix.flat().map(Number)
  );

  const header = `
    <tr>
      <th>Actual ↓ / Predicted →</th>
      ${cm.classes.map(x => `<th>${escapeHtml(shortStage(x))}</th>`).join('')}
    </tr>
  `;

  const body = cm.matrix.map((row, rowIndex) => `
    <tr>
      <th>${escapeHtml(shortStage(cm.classes[rowIndex]))}</th>
      ${row.map(value => {
        const alpha = .06 + (.52 * Number(value) / maxValue);
        return `
          <td style="background:rgba(16,185,129,${alpha.toFixed(3)})">
            ${value}
          </td>
        `;
      }).join('')}
    </tr>
  `).join('');

  target.innerHTML = `
    <table>
      <thead>${header}</thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function renderPerSeasonMetrics() {
  const body = document.getElementById('h-per-season-body');
  if (!body) return;

  const selectedModel =
    haridwarData.best_models[currentFeatureSet].model;

  const rows = haridwarData.per_season_model_metrics
    .filter(
      x =>
        x.feature_set === currentFeatureSet &&
        x.model === selectedModel
    );

  body.innerHTML = rows.map(row => `
    <tr>
      <td>${formatSeason(row.test_season)}</td>
      <td>${escapeHtml(row.model)}</td>
      <td>${pct(row.accuracy)}</td>
      <td>${pct(row.balanced_accuracy)}</td>
      <td>${Number(row.macro_f1).toFixed(3)}</td>
      <td>${Number(row.kappa).toFixed(3)}</td>
    </tr>
  `).join('');
}

function renderHaridwarRobustness() {
  if (!haridwarData) return;

  renderRobustnessChart();
  renderImportanceChart();
  renderGapCards();
}

function renderRobustnessChart() {
  const canvas = document.getElementById('hRobustChart');
  if (!canvas) return;

  destroyChart('robust');

  const groups = {};

  haridwarData.gap_robustness.forEach(row => {
    const key = formatFeatureSet(row.feature_set);
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  });

  const labels = [...new Set(
    haridwarData.gap_robustness
      .map(x => Number(x.mask_fraction))
  )].sort((a, b) => a - b);

  haridwarCharts.robust = new Chart(
    canvas.getContext('2d'),
    {
      type: 'line',
      data: {
        labels: labels.map(x => `${Math.round(x * 100)}% masked`),
        datasets: Object.entries(groups).map(([label, rows]) => ({
          label,
          data: labels.map(mask => {
            const row = rows.find(
              x => Number(x.mask_fraction) === mask
            );
            return row?.macro_f1 ?? null;
          }),
          borderWidth: 2,
          pointRadius: 4,
          tension: .15,
        }))
      },
      options: commonChartOptions({
        y: {
          min: 0,
          max: .6,
          title: {
            display: true,
            text: 'Macro F1',
            color: '#94a3b8'
          }
        }
      })
    }
  );
}

function renderImportanceChart() {
  const canvas = document.getElementById('hImportanceChart');
  if (!canvas) return;

  destroyChart('importance');

  const rows = haridwarData.feature_importance_top
    .slice(0, 12)
    .reverse();

  haridwarCharts.importance = new Chart(
    canvas.getContext('2d'),
    {
      type: 'bar',
      data: {
        labels: rows.map(x => x.feature),
        datasets: [{
          label: 'Mean permutation importance',
          data: rows.map(x => x.importance_mean),
        }]
      },
      options: commonChartOptions({
        indexAxis: 'y'
      })
    }
  );
}

function renderGapCards() {
  const target = document.getElementById('h-gap-cards');
  if (!target) return;

  target.innerHTML = haridwarData.natural_cloud_gaps
    .map(row => `
      <div class="haridwar-gap-card">
        <h3>${formatSeason(row.season)}</h3>
        <div class="haridwar-gap-kpis">
          <div>
            <span>Calendar acquisitions</span>
            <strong>${row.n_calendar_acquisitions}</strong>
          </div>
          <div>
            <span>Usable optical</span>
            <strong>${row.n_usable_optical_dates}</strong>
          </div>
          <div>
            <span>Longest missing run</span>
            <strong>≈ ${row.approx_longest_missing_run_days} d</strong>
          </div>
        </div>
      </div>
    `).join('');
}

function renderHaridwarGallery() {
  const target = document.getElementById('h-output-gallery');
  if (!target) return;

  const items = [
    [
      '01_s2_ndvi_stage_anchors.png',
      'Sentinel-2 NDVI and published wheat stage anchors'
    ],
    [
      '02_model_comparison_S1_S2_fusion.png',
      'S1 + S2 fusion model comparison'
    ],
    [
      '02_model_comparison_S2_only.png',
      'Sentinel-2-only model comparison'
    ],
    [
      '02_model_comparison_S1_only.png',
      'Sentinel-1-only model comparison'
    ],
    [
      '04_cm_normalized_S1_S2_fusion_RandomForest.png',
      'Normalized confusion matrix — fusion Random Forest'
    ],
    [
      '05_fusion_permutation_importance.png',
      'Fusion-model permutation feature importance'
    ],
    [
      '06_whittaker_wheat_2023_24.png',
      'Whittaker-smoothed NDVI — Wheat 2023-24'
    ],
    [
      '06_whittaker_wheat_2024_25.png',
      'Whittaker-smoothed NDVI — Wheat 2024-25'
    ],
    [
      '07_optical_gap_robustness.png',
      'Optical-gap robustness experiment'
    ]
  ];

  target.innerHTML = items.map(([file, caption]) => `
    <figure>
      <a
        href="data/haridwar/plots/${file}"
        target="_blank"
        rel="noopener"
      >
        <img
          src="data/haridwar/plots/${file}"
          alt="${escapeHtml(caption)}"
          loading="lazy"
        >
      </a>
      <figcaption>${escapeHtml(caption)}</figcaption>
    </figure>
  `).join('');
}

function commonChartOptions(extraScales = {}) {
  const suppliedScales =
    extraScales.y || extraScales.x
      ? extraScales
      : {};

  const base = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: '#cbd5e1',
          font: { size: 10 }
        }
      },
      tooltip: {
        intersect: false
      }
    },
    scales: {
      x: {
        ticks: {
          color: '#94a3b8',
          font: { size: 9 }
        },
        grid: {
          color: 'rgba(255,255,255,.05)'
        }
      },
      y: {
        ticks: {
          color: '#94a3b8',
          font: { size: 9 }
        },
        grid: {
          color: 'rgba(255,255,255,.05)'
        }
      }
    }
  };

  if (extraScales.interaction) {
    base.interaction = extraScales.interaction;
  }

  for (const axis of ['x', 'y']) {
    if (suppliedScales[axis]) {
      base.scales[axis] = {
        ...base.scales[axis],
        ...suppliedScales[axis],
        ticks: {
          ...base.scales[axis].ticks,
          ...(suppliedScales[axis].ticks || {})
        }
      };
    }
  }

  if (extraScales.indexAxis) {
    base.indexAxis = extraScales.indexAxis;
  }

  return base;
}

function destroyChart(key) {
  if (haridwarCharts[key]) {
    haridwarCharts[key].destroy();
    delete haridwarCharts[key];
  }
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function pct(value) {
  const n = Number(value);
  return Number.isFinite(n)
    ? `${(n * 100).toFixed(1)}%`
    : '--';
}

function formatSeason(value) {
  const map = {
    wheat_2023_24: 'Wheat 2023-24',
    wheat_2024_25: 'Wheat 2024-25'
  };
  return map[value] || String(value);
}

function formatFeatureSet(value) {
  const map = {
    S2_only: 'S2 Only',
    S1_only: 'S1 Only',
    S1_S2_fusion: 'S1 + S2 Fusion'
  };
  return map[value] || String(value);
}

function shortStage(value) {
  const map = {
    'Establishment': 'Establishment',
    'Vegetative': 'Vegetative',
    'Reproductive': 'Reproductive',
    'Grain Filling': 'Grain Fill',
    'Senescence/Harvest': 'Sen./Harvest'
  };
  return map[value] || value;
}

function formatDate(value) {
  if (!value) return '--';

  const date = new Date(`${String(value).slice(0,10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleDateString(
    'en-IN',
    {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    }
  );
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
