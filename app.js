/**
 * AgriSense Karnal — 19-step 8-day master timeline frontend
 *
 * Data model:
 * - 19 real 8-day weather periods
 * - old real satellite observations at their native ~16-day dates
 * - intermediate 8-day periods carry the latest previous satellite state
 * - each period explicitly shows FRESH / CARRIED / UNAVAILABLE satellite status
 * - water deficit/advisory varies every 8 days from real weather + prototype rule
 */

let map;
let geojsonLayer = null;
let posterMap = null;
let posterFieldLayer = null;

let pipelineData = null;
let currentPeriodPayload = null;
let currentPeriodByField = new Map();
let currentPeriodIndex = 0;
let seasonTimer = null;
let currentLayerMode = 'crop';
let activeField = null;

let farmerFieldIds = [];
let currentPersonaRole = 'officer';

const ROLE_CONFIG = {
  officer: {
    title: 'Agriculture Officer',
    panelTitle: 'Agriculture Officer — Regional Crop Intelligence',
    layers: ['crop', 'stage', 'stress', 'deficit', 'advisory'],
    defaultLayer: 'crop',
    showModelEvaluation: true,
    showPipelineArchitecture: true,
    showRunPipeline: true,
    fieldScope: 'all',
    charts: 'agriculture',
    showQa: true,
    allowFieldModal: true
  },
  irrigation: {
    title: 'Irrigation Officer',
    panelTitle: 'Irrigation Officer — Water Deficit & Release Priority',
    layers: ['deficit', 'advisory'],
    defaultLayer: 'deficit',
    showModelEvaluation: false,
    showPipelineArchitecture: false,
    showRunPipeline: false,
    fieldScope: 'all',
    charts: 'water',
    showQa: true,
    allowFieldModal: true
  },
  wua: {
    title: 'Water User Association',
    panelTitle: 'WUA — Local Water Demand & Irrigation Priority',
    layers: ['deficit', 'advisory'],
    defaultLayer: 'advisory',
    showModelEvaluation: false,
    showPipelineArchitecture: false,
    showRunPipeline: false,
    fieldScope: 'all',
    charts: 'water',
    showQa: true,
    allowFieldModal: true
  },
  farmer: {
    title: 'Farmer',
    panelTitle: 'Farmer — My Assigned Demo Plots',
    layers: ['crop', 'stress', 'deficit', 'advisory'],
    defaultLayer: 'advisory',
    showModelEvaluation: false,
    showPipelineArchitecture: false,
    showRunPipeline: false,
    fieldScope: 'farmer',
    charts: 'farmer',
    showQa: false,
    allowFieldModal: true
  },
  policy: {
    title: 'Policy Maker',
    panelTitle: 'Policy Maker — Regional Seasonal Overview',
    layers: ['crop', 'deficit', 'advisory'],
    defaultLayer: 'crop',
    showModelEvaluation: true,
    showPipelineArchitecture: false,
    showRunPipeline: false,
    fieldScope: 'all',
    charts: 'policy',
    showQa: true,
    allowFieldModal: false
  }
};

let cropChartInstance = null;
let stressChartInstance = null;
let fieldTemporalChartInstance = null;

const VEG_COLORS = {
  "Dense / Healthy Vegetation": "#16a34a",
  "Moderate Vegetation": "#84cc16",
  "Low Vegetation": "#f59e0b",
  "Sparse / Early Vegetation": "#f97316",
  "No Optical Observation": "#64748b"
};

const STAGE_COLORS = {
  "Sowing/Planting": "#38bdf8",
  "Vegetative": "#22c55e",
  "Flowering": "#84cc16",
  "Grain Filling": "#f97316",
  "Maturity": "#a16207",
  "Derived Stage Unavailable": "#64748b",
  "No Satellite Observation": "#64748b"
};

const MOISTURE_COLORS = {
  "Moist / High": "#06b6d4",
  "Moderate Moisture": "#3b82f6",
  "Low Moisture": "#f59e0b",
  "Very Low Moisture": "#ef4444",
  "No Optical Observation": "#64748b"
};

document.addEventListener('DOMContentLoaded', async () => {
  injectUi();
  syncHeaderHeight();

  window.addEventListener('resize', syncHeaderHeight);

  if (window.lucide) lucide.createIcons();

  initMap();
  initEventListeners();
  await fetchMasterData();
});

/* -------------------------------------------------------------------------- */
/* UI + HEADER                                                                 */
/* -------------------------------------------------------------------------- */

function injectUi() {
  const style = document.createElement('style');
  style.textContent = `
    :root { --actual-header-height: 92px; }

    .app-header {
      display:grid !important;
      grid-template-columns:minmax(250px,310px) minmax(400px,1fr) auto !important;
      align-items:center !important;
      gap:.7rem !important;
      padding:.55rem 1rem !important;
      min-height:76px !important;
      height:auto !important;
    }

    .header-left,.header-center,.header-right,.brand-logo,.brand-text {
      min-width:0 !important;
    }

    .brand-title { white-space:nowrap; }
    .brand-subtitle {
      white-space:normal !important;
      line-height:1.2;
      max-width:260px;
    }

    .header-center {
      display:grid !important;
      grid-template-columns:repeat(4,minmax(100px,1fr)) !important;
      gap:.5rem !important;
      width:100%;
    }

    .stat-pill {
      min-width:0 !important;
      max-width:none !important;
      width:100% !important;
      padding:.42rem .5rem !important;
      overflow:hidden;
    }

    .stat-label {
      white-space:normal !important;
      text-align:center;
      line-height:1.05;
      min-height:1.35rem;
    }

    .stat-value {
      white-space:nowrap;
      line-height:1.1;
    }

    .header-right {
      display:flex;
      gap:.5rem !important;
      align-items:center;
      flex-wrap:nowrap;
    }

    .header-right .btn { white-space:nowrap; }
    .persona-selector { min-width:210px; }

    @media (max-width:1820px) {
      .app-header {
        grid-template-columns:minmax(260px,1fr) auto !important;
        grid-template-areas:
          "brand actions"
          "stats stats";
      }
      .header-left { grid-area:brand; }
      .header-right { grid-area:actions; justify-content:flex-end; }
      .header-center {
        grid-area:stats;
        grid-template-columns:repeat(4,minmax(0,1fr)) !important;
      }
      .stat-label { min-height:0; }
    }

    @media (max-width:1250px) {
      .app-header {
        grid-template-columns:1fr !important;
        grid-template-areas:
          "brand"
          "actions"
          "stats";
      }
      .header-right {
        justify-content:flex-start;
        flex-wrap:wrap;
      }
      .header-center {
        grid-template-columns:repeat(2,minmax(0,1fr)) !important;
      }
    }

    .main-layout {
      height:calc(100vh - var(--actual-header-height)) !important;
      min-height:620px;
    }

    .master-timeline {
      position:absolute;
      z-index:560;
      top:5.1rem;
      left:1rem;
      width:min(1040px,calc(100% - 2rem));
      display:grid;
      grid-template-columns:auto auto minmax(220px,1fr) auto auto auto;
      align-items:center;
      gap:.55rem;
      padding:.62rem .72rem;
      border:1px solid rgba(255,255,255,.10);
      border-radius:12px;
      background:rgba(12,20,32,.95);
      backdrop-filter:blur(12px);
      box-shadow:0 10px 30px rgba(0,0,0,.35);
    }

    .timeline-btn {
      width:34px;
      height:34px;
      border:1px solid rgba(255,255,255,.10);
      border-radius:8px;
      background:rgba(255,255,255,.05);
      color:#f8fafc;
      cursor:pointer;
      display:flex;
      align-items:center;
      justify-content:center;
    }

    .timeline-btn:hover {
      background:rgba(16,185,129,.14);
      border-color:rgba(16,185,129,.36);
    }

    .timeline-slider-wrap {
      display:grid;
      grid-template-columns:minmax(120px,1fr) minmax(160px,auto);
      gap:.65rem;
      align-items:center;
      min-width:0;
    }

    .timeline-slider {
      width:100%;
      accent-color:#10b981;
    }

    .timeline-period-label {
      display:flex;
      flex-direction:column;
      min-width:0;
    }

    .timeline-date {
      color:#f8fafc;
      font-weight:700;
      font-family:var(--font-title);
      white-space:nowrap;
    }

    .timeline-sub {
      color:#94a3b8;
      font-size:.64rem;
      margin-top:.15rem;
      white-space:nowrap;
    }

    .timeline-select {
      min-width:132px;
      height:34px;
      border-radius:8px;
      border:1px solid rgba(255,255,255,.10);
      background:#101926;
      color:#e5e7eb;
      padding:0 .5rem;
      font-size:.72rem;
    }

    .timeline-chip {
      padding:.31rem .48rem;
      border-radius:999px;
      font-size:.64rem;
      font-weight:800;
      white-space:nowrap;
      border:1px solid rgba(255,255,255,.12);
    }

    .chip-fresh {
      background:rgba(16,185,129,.15);
      border-color:rgba(16,185,129,.35);
      color:#6ee7b7;
    }

    .chip-carried {
      background:rgba(245,158,11,.14);
      border-color:rgba(245,158,11,.35);
      color:#fcd34d;
    }

    .chip-unavailable {
      background:rgba(100,116,139,.18);
      color:#cbd5e1;
    }

    .weather-chip {
      background:rgba(6,182,212,.12);
      border-color:rgba(6,182,212,.35);
      color:#67e8f9;
    }

    .map-info-badge { top:11.25rem !important; }

    .provenance-banner {
      display:flex;
      gap:.45rem;
      flex-wrap:wrap;
      align-items:center;
      padding:.65rem .8rem;
      margin-bottom:.85rem;
      border:1px solid rgba(255,255,255,.10);
      border-radius:10px;
      background:rgba(15,23,42,.82);
      font-size:.72rem;
    }

    .prov-pill {
      padding:.22rem .5rem;
      border-radius:999px;
      font-weight:700;
    }

    .prov-real {
      background:rgba(16,185,129,.16);
      color:#6ee7b7;
      border:1px solid rgba(16,185,129,.35);
    }

    .prov-derived {
      background:rgba(59,130,246,.15);
      color:#93c5fd;
      border:1px solid rgba(59,130,246,.35);
    }

    .prov-proto {
      background:rgba(245,158,11,.15);
      color:#fcd34d;
      border:1px solid rgba(245,158,11,.35);
    }

    .period-context-card {
      display:grid;
      grid-template-columns:repeat(4,minmax(0,1fr));
      gap:.45rem;
      margin:.25rem 0 .9rem;
      padding:.65rem;
      background:rgba(255,255,255,.03);
      border:1px solid rgba(255,255,255,.08);
      border-radius:10px;
    }

    .period-context-item {
      background:rgba(0,0,0,.15);
      border-radius:8px;
      padding:.5rem;
    }

    .period-context-item span {
      display:block;
      color:#94a3b8;
      font-size:.63rem;
    }

    .period-context-item strong {
      display:block;
      margin-top:.2rem;
      font-size:.82rem;
      color:#f8fafc;
    }


    .role-hidden {
      display:none !important;
    }

    .role-scope-badge {
      display:inline-flex;
      align-items:center;
      gap:.35rem;
      padding:.3rem .52rem;
      border-radius:999px;
      border:1px solid rgba(16,185,129,.28);
      background:rgba(16,185,129,.10);
      color:#6ee7b7;
      font-size:.65rem;
      font-weight:700;
      margin-top:.45rem;
    }

    .farmer-plot-list {
      display:grid;
      grid-template-columns:1fr 1fr;
      gap:.45rem;
      margin-top:.65rem;
    }

    .farmer-plot-btn {
      border:1px solid rgba(255,255,255,.10);
      border-radius:8px;
      background:rgba(255,255,255,.04);
      color:#e5e7eb;
      padding:.55rem;
      text-align:left;
      cursor:pointer;
      font-family:var(--font-body);
    }

    .farmer-plot-btn:hover {
      border-color:rgba(16,185,129,.4);
      background:rgba(16,185,129,.09);
    }

    .farmer-plot-btn strong {
      display:block;
      color:#f8fafc;
      font-size:.76rem;
    }

    .farmer-plot-btn span {
      display:block;
      color:#94a3b8;
      font-size:.64rem;
      margin-top:.18rem;
    }

    .role-water-note {
      margin-top:.7rem;
      padding:.58rem .65rem;
      border-left:3px solid #06b6d4;
      background:rgba(6,182,212,.07);
      color:#a5f3fc;
      font-size:.7rem;
      line-height:1.45;
    }


    .live-inference-card {
      margin:0 0 .9rem;
      padding:.75rem;
      border:1px solid rgba(139,92,246,.25);
      border-radius:10px;
      background:linear-gradient(135deg, rgba(139,92,246,.09), rgba(15,23,42,.72));
    }

    .live-inference-head {
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:.6rem;
      margin-bottom:.65rem;
    }

    .live-inference-head strong {
      color:#f8fafc;
      font-size:.82rem;
    }

    .live-inference-status {
      padding:.23rem .45rem;
      border-radius:999px;
      font-size:.62rem;
      font-weight:800;
      background:rgba(139,92,246,.15);
      border:1px solid rgba(139,92,246,.30);
      color:#c4b5fd;
      white-space:nowrap;
    }

    .live-inference-grid {
      display:grid;
      grid-template-columns:repeat(3,minmax(0,1fr));
      gap:.5rem;
    }

    .live-inference-item {
      min-width:0;
      padding:.55rem;
      border-radius:8px;
      background:rgba(0,0,0,.18);
      border:1px solid rgba(255,255,255,.07);
    }

    .live-inference-item span {
      display:block;
      color:#94a3b8;
      font-size:.62rem;
      margin-bottom:.2rem;
    }

    .live-inference-item strong {
      display:block;
      color:#f8fafc;
      font-size:.78rem;
      overflow-wrap:anywhere;
    }

    .live-inference-confidence {
      margin-top:.25rem;
      color:#a7f3d0;
      font-size:.64rem;
    }

    .live-inference-note {
      margin-top:.6rem;
      color:#94a3b8;
      font-size:.63rem;
      line-height:1.45;
    }

    .live-inference-error {
      color:#fca5a5;
      font-size:.7rem;
      line-height:1.45;
    }

    @media(max-width:700px) {
      .live-inference-grid {
        grid-template-columns:1fr;
      }
    }

    .model-eval-grid {
      display:grid;
      grid-template-columns:repeat(3,minmax(0,1fr));
      gap:1rem;
    }

    .model-card {
      background:rgba(255,255,255,.035);
      border:1px solid rgba(255,255,255,.10);
      border-radius:12px;
      padding:1rem;
    }

    .model-metrics {
      display:grid;
      grid-template-columns:repeat(2,1fr);
      gap:.4rem;
      margin:.7rem 0;
    }

    .model-metric {
      background:rgba(0,0,0,.18);
      border-radius:8px;
      padding:.5rem;
    }

    .model-metric span {
      display:block;
      color:#94a3b8;
      font-size:.65rem;
    }

    .model-metric strong {
      color:#f8fafc;
      font-size:.95rem;
    }

    .cm-table {
      width:100%;
      border-collapse:collapse;
      margin-top:.6rem;
      font-size:.7rem;
    }

    .cm-table th,.cm-table td {
      border:1px solid rgba(255,255,255,.10);
      text-align:center;
      padding:.35rem;
    }

    .eval-warning {
      padding:.65rem .8rem;
      border-left:3px solid #f59e0b;
      background:rgba(245,158,11,.08);
      color:#fcd34d;
      font-size:.75rem;
      margin-bottom:1rem;
    }

    @media(max-width:1000px) {
      .master-timeline {
        top:8.3rem;
        grid-template-columns:auto auto 1fr auto;
      }
      .timeline-select,.weather-chip { display:none; }
      .map-info-badge { top:16.5rem !important; }
      .period-context-card { grid-template-columns:repeat(2,1fr); }
      .model-eval-grid { grid-template-columns:1fr; }
    }
  `;
  document.head.appendChild(style);

  const labels = document.querySelectorAll('.stat-label');
  if (labels[0]) labels[0].textContent = '8-Day Rainfall';
  if (labels[1]) labels[1].textContent = 'FAO-56 ET₀';
  if (labels[2]) labels[2].textContent = 'Satellite State';
  if (labels[3]) labels[3].textContent = 'SAR Valid';

  const layerNames = {
    crop: ['leaf', 'Vegetation'],
    stage: ['trending-up', 'Derived Stage'],
    stress: ['waves', 'Moisture Signal'],
    deficit: ['droplets', 'Water Deficit'],
    advisory: ['compass', 'Irrigation Advisory']
  };

  Object.entries(layerNames).forEach(([key, [icon, label]]) => {
    const btn = document.querySelector(`.layer-btn[data-layer="${key}"]`);
    if (btn) btn.innerHTML = `<i data-lucide="${icon}"></i> ${label}`;
  });

  const headerRight = document.querySelector('.header-right');
  if (headerRight && !document.getElementById('btn-model-eval')) {
    const button = document.createElement('button');
    button.className = 'btn btn-outline';
    button.id = 'btn-model-eval';
    button.innerHTML =
      '<i data-lucide="brain-circuit"></i> AI Model Evaluation';
    const runButton = document.getElementById('btn-run-pipeline');
    headerRight.insertBefore(button, runButton || null);
  }

  const mapSection = document.querySelector('.map-section');
  if (mapSection && !document.getElementById('master-timeline')) {
    const timeline = document.createElement('div');
    timeline.id = 'master-timeline';
    timeline.className = 'master-timeline';
    timeline.innerHTML = `
      <button id="timeline-prev" class="timeline-btn" title="Previous 8-day period">
        <i data-lucide="chevron-left"></i>
      </button>
      <button id="timeline-play" class="timeline-btn" title="Play full season">
        <i data-lucide="play"></i>
      </button>
      <div class="timeline-slider-wrap">
        <input id="timeline-slider" class="timeline-slider" type="range" min="0" max="18" value="0" step="1">
        <div class="timeline-period-label">
          <span id="timeline-date" class="timeline-date">Loading season...</span>
          <span id="timeline-sub" class="timeline-sub">19 × 8-day periods</span>
        </div>
      </div>
      <select id="timeline-select" class="timeline-select"></select>
      <span id="satellite-chip" class="timeline-chip chip-unavailable">SATELLITE</span>
      <span id="weather-chip" class="timeline-chip weather-chip">WEATHER 8-DAY</span>
      <button id="timeline-next" class="timeline-btn" title="Next 8-day period">
        <i data-lucide="chevron-right"></i>
      </button>
    `;
    mapSection.appendChild(timeline);
  }

  const sidebar = document.querySelector('.sidebar-scrollable');
  if (sidebar && !document.getElementById('data-provenance-banner')) {
    const banner = document.createElement('div');
    banner.id = 'data-provenance-banner';
    banner.className = 'provenance-banner';
    banner.innerHTML = `
      <span class="prov-pill prov-real">REAL 8-day weather</span>
      <span class="prov-pill prov-real">REAL old satellite</span>
      <span class="prov-pill prov-derived">DERIVED stage</span>
      <span class="prov-pill prov-proto">PROTOTYPE advisory</span>
    `;
    sidebar.prepend(banner);
  }

  if (!document.getElementById('model-eval-backdrop')) {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'model-eval-backdrop';
    modal.innerHTML = `
      <div class="modal-card modal-xlarge">
        <div class="modal-header">
          <div class="modal-title-group">
            <h3>AI Model Evaluation</h3>
            <span class="badge badge-info">Derived-label demo</span>
          </div>
          <button class="modal-close" id="btn-close-model-eval">&times;</button>
        </div>
        <div class="modal-body">
          <div class="eval-warning">
            Current confusion matrices use derived/pseudo labels, not independent agronomic field validation.
          </div>
          <div id="model-eval-content">Loading...</div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }
}

function syncHeaderHeight() {
  requestAnimationFrame(() => {
    const header = document.querySelector('.app-header');
    if (!header) return;
    document.documentElement.style.setProperty(
      '--actual-header-height',
      `${Math.ceil(header.getBoundingClientRect().height)}px`
    );
  });
}

/* -------------------------------------------------------------------------- */
/* MAP                                                                         */
/* -------------------------------------------------------------------------- */

function initMap() {
  map = L.map('map', {
    center: [29.6857, 76.9905],
    zoom: 10,
    zoomControl: false,
    preferCanvas: true
  });

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      attribution: 'Tiles &copy; Esri',
      maxZoom: 19
    }
  ).addTo(map);
}

/* -------------------------------------------------------------------------- */
/* DATA                                                                        */
/* -------------------------------------------------------------------------- */

async function fetchMasterData() {
  const sources = [
    '/api/data',
    '/data/karnal_master_demo_output.json',
    '/data/karnal_gee_output.json',
    '/data/karnal_pipeline_output.json'
  ];

  for (const source of sources) {
    try {
      const res = await fetch(source, { cache: 'no-store' });
      if (!res.ok) continue;

      const payload = await res.json();
      if (!payload.summary || !payload.geojson) continue;

      pipelineData = payload;
      initializePersonaScopes();
      configureTimeline();
      await loadPeriod(0, false);
      renderBaseMap();
      applyPersonaRole(false);
      renderAll();
      return;
    } catch (err) {
      console.warn(`Unable to load ${source}:`, err.message);
    }
  }

  setText('timeline-date', 'Static pipeline data unavailable');
  setText('timeline-sub', 'Run the local pipeline or check the deployment assets.');
}

function masterTimeline() {
  return pipelineData?.summary?.master_timeline || [];
}

function configureTimeline() {
  const timeline = masterTimeline();
  const slider = document.getElementById('timeline-slider');
  const select = document.getElementById('timeline-select');

  if (slider) {
    slider.min = 0;
    slider.max = Math.max(0, timeline.length - 1);
    slider.value = currentPeriodIndex;
  }

  if (select) {
    select.innerHTML = timeline.map((p, index) =>
      `<option value="${index}">${formatDateLong(p.period_start)}</option>`
    ).join('');
    select.value = String(currentPeriodIndex);
  }
}

async function loadPeriod(index, shouldRender = true) {
  const timeline = masterTimeline();
  if (!timeline.length) return;

  currentPeriodIndex = Math.max(0, Math.min(timeline.length - 1, Number(index)));

  const period = timeline[currentPeriodIndex];
  const periodPath = encodeURIComponent(period.period_start);
  const sources = [
    `/api/period/${periodPath}`,
    `/data/periods/${periodPath}.json`
  ];

  let payload = null;
  for (const source of sources) {
    const res = await fetch(source, { cache: 'no-store' });
    if (res.ok) {
      payload = await res.json();
      break;
    }
  }

  if (!payload) {
    throw new Error(`Unable to load period ${period.period_start}`);
  }

  currentPeriodPayload = payload;
  currentPeriodByField = new Map(
    (currentPeriodPayload.records || [])
      .map(row => [String(row.field_id), row])
  );

  updateTimelineUi();

  if (shouldRender) {
    renderAll();
  }
}

function currentPeriodSummary() {
  return currentPeriodPayload?.summary || masterTimeline()[currentPeriodIndex] || {};
}

function updateTimelineUi() {
  const p = currentPeriodSummary();

  setText('timeline-date', `${formatDateLong(p.period_start)} – ${formatDateShort(p.period_end)}`);
  setText(
    'timeline-sub',
    `Period ${currentPeriodIndex + 1} of ${masterTimeline().length} • 8-day weather/advisory step`
  );

  const slider = document.getElementById('timeline-slider');
  const select = document.getElementById('timeline-select');
  if (slider) slider.value = String(currentPeriodIndex);
  if (select) select.value = String(currentPeriodIndex);

  const satChip = document.getElementById('satellite-chip');
  if (satChip) {
    satChip.className = 'timeline-chip';

    if (p.satellite_mode === 'fresh') {
      satChip.classList.add('chip-fresh');
      satChip.textContent = 'OPT + SAR FRESH';
    } else if (p.satellite_mode === 'mixed') {
      satChip.classList.add('chip-carried');
      const opt = modalityShort('OPT', p.optical_mode, p.optical_age_days);
      const sar = modalityShort('SAR', p.sar_mode, p.sar_age_days);
      satChip.textContent = `${opt} • ${sar}`;
    } else if (p.satellite_mode === 'carried') {
      satChip.classList.add('chip-carried');
      const opt = modalityShort('OPT', p.optical_mode, p.optical_age_days);
      const sar = modalityShort('SAR', p.sar_mode, p.sar_age_days);
      satChip.textContent = `${opt} • ${sar}`;
    } else {
      satChip.classList.add('chip-unavailable');
      satChip.textContent = 'SATELLITE UNAVAILABLE';
    }
  }

  const weatherChip = document.getElementById('weather-chip');
  if (weatherChip) {
    weatherChip.textContent = p.weather_available
      ? 'WEATHER FRESH • 8-DAY'
      : 'WEATHER MISSING';
  }
}

/* -------------------------------------------------------------------------- */
/* RENDER                                                                      */
/* -------------------------------------------------------------------------- */

function renderAll() {
  applyPersonaChrome();
  updateHeader();
  updateLegend();
  updateMapStyles();
  renderCharts();
  renderQaTable();
  updatePersonaView();
  updatePosterCards();

  if (activeField && roleAllowsField(activeField.field_id)) {
    updateOpenFieldModal();
  } else if (activeField && !roleAllowsField(activeField.field_id)) {
    activeField = null;
    document.getElementById('field-modal-backdrop')
      ?.classList.remove('active');
  }

  syncHeaderHeight();

  if (window.lucide) lucide.createIcons();
}

function renderBaseMap() {
  if (geojsonLayer) map.removeLayer(geojsonLayer);

  const visibleIds = visibleFieldIdSet();
  const filteredGeojson = {
    type: 'FeatureCollection',
    features: (pipelineData.geojson?.features || []).filter(feature => {
      const id = String(feature.properties?.field_id);
      return visibleIds === null || visibleIds.has(id);
    })
  };

  geojsonLayer = L.geoJSON(filteredGeojson, {
    pointToLayer: (feature, latlng) =>
      L.circleMarker(latlng, {
        radius: currentPersonaRole === 'farmer' ? 8 : 4,
        ...featureStyle(feature.properties.field_id)
      }),
    onEachFeature: (feature, layer) => {
      const id = feature.properties.field_id;

      layer.bindTooltip(
        tooltipHtml(id),
        { sticky: true, opacity: 0.95 }
      );

      layer.on('click', () => {
        if (ROLE_CONFIG[currentPersonaRole]?.allowFieldModal !== false) {
          openFieldModal(id);
        }
      });

      layer.on('mouseover', () =>
        layer.setStyle({ fillOpacity: 0.95, weight: 2.5 })
      );

      layer.on('mouseout', () =>
        layer.setStyle(featureStyle(id))
      );
    }
  }).addTo(map);

  const bounds = geojsonLayer.getBounds();
  if (bounds.isValid()) {
    map.fitBounds(
      bounds,
      {
        padding: currentPersonaRole === 'farmer' ? [100, 100] : [25, 25],
        maxZoom: currentPersonaRole === 'farmer' ? 15 : 11
      }
    );
  }
}

function updateMapStyles() {
  if (!geojsonLayer) return;

  geojsonLayer.eachLayer(layer => {
    const id = layer.feature?.properties?.field_id;
    if (!id) return;

    layer.setStyle(featureStyle(id));

    if (layer.getTooltip()) {
      layer.setTooltipContent(tooltipHtml(id));
    }
  });
}

function currentRecord(fieldId) {
  return currentPeriodByField.get(String(fieldId));
}

function featureStyle(fieldId) {
  const row = currentRecord(fieldId);

  let color = '#64748b';

  if (row) {
    if (currentLayerMode === 'crop') {
      color = VEG_COLORS[row.derived?.vegetation_condition] || '#64748b';
    } else if (currentLayerMode === 'stage') {
      color = STAGE_COLORS[row.derived?.growth_stage] || '#64748b';
    } else if (currentLayerMode === 'stress') {
      color = MOISTURE_COLORS[row.derived?.moisture_signal] || '#64748b';
    } else if (currentLayerMode === 'deficit') {
      const d = Number(row.water_balance?.deficit_mm);
      color = !Number.isFinite(d)
        ? '#64748b'
        : d > 30
          ? '#ef4444'
          : d > 15
            ? '#f97316'
            : d > 5
              ? '#eab308'
              : '#10b981';
    } else if (currentLayerMode === 'advisory') {
      const p = Number(row.water_balance?.priority_score || 0);
      color =
        p >= 8 ? '#ef4444' :
        p >= 5 ? '#f97316' :
        p >= 3 ? '#f59e0b' :
        '#10b981';
    }
  }

  const satelliteUnavailable =
    ['crop', 'stage', 'stress'].includes(currentLayerMode) &&
    row?.satellite?.status === 'unavailable';

  return {
    fillColor: satelliteUnavailable ? '#475569' : color,
    color: '#0d1520',
    weight: 1.3,
    opacity: satelliteUnavailable ? 0.35 : 0.9,
    fillOpacity: satelliteUnavailable ? 0.22 : 0.74
  };
}

function tooltipHtml(fieldId) {
  const row = currentRecord(fieldId);
  if (!row) return `<strong>${fieldId}</strong>`;

  const sat = row.satellite || {};
  const weather = row.weather || {};
  const wb = row.water_balance || {};

  return `
    <div style="font-family:Inter;font-size:12px;line-height:1.45;padding:4px">
      <strong>${fieldId}</strong><br>
      <strong>Period:</strong> ${formatDateShort(row.period_start)}<br>
      <strong>Satellite:</strong> ${satelliteLabel(sat)}<br>
      <strong>NDVI:</strong> ${fmt(sat.NDVI, 3)}<br>
      <strong>NDMI:</strong> ${fmt(sat.NDMI, 3)}<br>
      <strong>Rainfall:</strong> ${fmt(weather.rainfall_mm, 1)} mm<br>
      <strong>ET₀:</strong> ${fmt(weather.fao56_eto_est_mm, 1)} mm<br>
      <strong>Deficit:</strong> ${fmt(wb.deficit_mm, 1)} mm
    </div>
  `;
}

function modalityShort(label, status, ageDays) {
  if (status === 'fresh') return `${label} FRESH`;
  if (status === 'carried') return `${label} ${ageDays}d OLD`;
  return `${label} N/A`;
}

function satelliteLabel(sat) {
  if (!sat) return 'Unavailable';

  const opt = modalityShort(
    'Optical',
    sat.optical_status || sat.status,
    sat.optical_age_days ?? sat.age_days
  );

  const sar = modalityShort(
    'SAR',
    sat.sar_status || sat.status,
    sat.sar_age_days ?? sat.age_days
  );

  return `${opt} • ${sar}`;
}
/* -------------------------------------------------------------------------- */
/* HEADER + LEGEND                                                             */
/* -------------------------------------------------------------------------- */

function updateHeader() {
  const p = currentPeriodSummary();
  const labels = document.querySelectorAll('.stat-label');
  const scoped = getScopedCurrentRecords();

  const setHeaderLabels = (a, b, c, d) => {
    if (labels[0]) labels[0].textContent = a;
    if (labels[1]) labels[1].textContent = b;
    if (labels[2]) labels[2].textContent = c;
    if (labels[3]) labels[3].textContent = d;
  };

  if (currentPersonaRole === 'farmer') {
    const deficits = scoped
      .map(x => Number(x.water_balance?.deficit_mm))
      .filter(Number.isFinite);

    const priorities = scoped
      .map(x => Number(x.water_balance?.priority_score))
      .filter(Number.isFinite);

    const rainfall = scoped
      .map(x => Number(x.weather?.rainfall_mm))
      .filter(Number.isFinite);

    const avgDeficit = deficits.length
      ? deficits.reduce((a, b) => a + b, 0) / deficits.length
      : NaN;

    const avgRain = rainfall.length
      ? rainfall.reduce((a, b) => a + b, 0) / rainfall.length
      : NaN;

    const maxPriority = priorities.length
      ? Math.max(...priorities)
      : NaN;

    setHeaderLabels('My Plots', '8-Day Rainfall', 'Water Deficit', 'Advisory Priority');
    setText('header-total-area', `${farmerFieldIds.length} plots`);
    setText('header-water-deficit', `${fmt(avgRain, 1)} mm`);
    setText('header-irrigation-needed', `${fmt(avgDeficit, 1)} mm`);
    setText('header-weather', Number.isFinite(maxPriority) ? `${maxPriority}/10` : '--');
  } else if (currentPersonaRole === 'irrigation' || currentPersonaRole === 'wua') {
    const high =
      Number(p.irrigation_priority_distribution?.['High Priority'] || 0) +
      Number(p.irrigation_priority_distribution?.['Medium Priority'] || 0);

    setHeaderLabels('8-Day Rainfall', 'FAO-56 ET₀', 'Median Deficit', 'Priority Samples');
    setText('header-total-area', `${fmt(p.mean_rainfall_mm, 1)} mm`);
    setText('header-water-deficit', `${fmt(p.mean_fao56_eto_mm, 1)} mm`);
    setText('header-irrigation-needed', `${fmt(p.median_deficit_mm, 1)} mm`);
    setText('header-weather', high.toLocaleString());
  } else if (currentPersonaRole === 'policy') {
    setHeaderLabels('8-Day Rainfall', 'FAO-56 ET₀', 'Optical Valid', 'SAR Valid');
    setText('header-total-area', `${fmt(p.mean_rainfall_mm, 1)} mm`);
    setText('header-water-deficit', `${fmt(p.mean_fao56_eto_mm, 1)} mm`);
    setText('header-irrigation-needed', `${fmt(p.optical_valid_pct, 1)}%`);
    setText('header-weather', `${fmt(p.sar_valid_pct, 1)}%`);
  } else {
    const satState =
      p.satellite_mode === 'fresh'
        ? 'OPT+SAR FRESH'
        : p.satellite_mode === 'mixed'
          ? `${modalityShort('O', p.optical_mode, p.optical_age_days)} / ${modalityShort('S', p.sar_mode, p.sar_age_days)}`
          : p.satellite_mode === 'carried'
            ? `${modalityShort('O', p.optical_mode, p.optical_age_days)} / ${modalityShort('S', p.sar_mode, p.sar_age_days)}`
            : 'N/A';

    setHeaderLabels('8-Day Rainfall', 'FAO-56 ET₀', 'Satellite State', 'SAR Valid');
    setText('header-total-area', `${fmt(p.mean_rainfall_mm, 1)} mm`);
    setText('header-water-deficit', `${fmt(p.mean_fao56_eto_mm, 1)} mm`);
    setText('header-irrigation-needed', satState);
    setText('header-weather', `${fmt(p.sar_valid_pct, 1)}%`);
  }

  const badge = document.querySelector('.badge-live');
  if (badge) {
    badge.innerHTML =
      `<span class="pulse"></span> ${formatDateShort(p.period_start)} • ${ROLE_CONFIG[currentPersonaRole]?.title || 'User'}`;
  }
}

function updateLegend() {
  const title = document.getElementById('legend-title');
  const items = document.getElementById('legend-items');

  if (!title || !items) return;

  items.innerHTML = '';

  let palette = [];

  if (currentLayerMode === 'crop') {
    title.textContent = `Vegetation • ${formatDateShort(currentPeriodSummary().period_start)}`;
    palette = Object.entries(VEG_COLORS);
  } else if (currentLayerMode === 'stage') {
    title.textContent = 'Derived Seasonal Stage';
    palette = Object.entries(STAGE_COLORS);
  } else if (currentLayerMode === 'stress') {
    title.textContent = 'Real NDMI Moisture Signal';
    palette = Object.entries(MOISTURE_COLORS);
  } else if (currentLayerMode === 'deficit') {
    title.textContent = '8-Day Water Deficit';
    palette = [
      ['0–5 mm', '#10b981'],
      ['5–15 mm', '#eab308'],
      ['15–30 mm', '#f97316'],
      ['>30 mm', '#ef4444']
    ];
  } else {
    title.textContent = '8-Day Irrigation Priority';
    palette = [
      ['Low / None', '#10b981'],
      ['Low', '#f59e0b'],
      ['Medium', '#f97316'],
      ['High', '#ef4444']
    ];
  }

  for (const [name, color] of palette) {
    const div = document.createElement('div');
    div.className = 'legend-item';
    div.innerHTML =
      `<span class="color-box" style="background:${color}"></span><span>${name}</span>`;
    items.appendChild(div);
  }
}

/* -------------------------------------------------------------------------- */
/* SIDEBAR                                                                     */
/* -------------------------------------------------------------------------- */

function renderCharts() {
  const summary = currentPeriodSummary();
  const cards = Array.from(document.querySelectorAll('.chart-card'));
  const firstCard = cards[0];
  const secondCard = cards[1];

  if (currentPersonaRole === 'farmer') {
    firstCard?.classList.add('role-hidden');
    secondCard?.classList.add('role-hidden');
    return;
  }

  firstCard?.classList.remove('role-hidden');
  secondCard?.classList.remove('role-hidden');

  const cropTitle = firstCard?.querySelector('.chart-header h4');
  const stressTitle = secondCard?.querySelector('.chart-header h4');

  const cropCtx = document.getElementById('cropChart')?.getContext('2d');
  const stressCtx = document.getElementById('stressChart')?.getContext('2d');

  if (cropChartInstance) cropChartInstance.destroy();
  if (stressChartInstance) stressChartInstance.destroy();

  const isWaterRole =
    currentPersonaRole === 'irrigation' ||
    currentPersonaRole === 'wua';

  if (isWaterRole) {
    firstCard?.classList.add('role-hidden');

    if (stressTitle) {
      stressTitle.innerHTML =
        '<i data-lucide="droplets"></i> Irrigation Priority Distribution';
    }

    const dist = summary.irrigation_priority_distribution || {};
    const labels = Object.keys(dist);
    const priorityColors = {
      'No / Low Priority': '#10b981',
      'Low Priority': '#eab308',
      'Medium Priority': '#f97316',
      'High Priority': '#ef4444',
      'No Advisory': '#64748b'
    };

    if (stressCtx) {
      stressChartInstance = new Chart(stressCtx, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            data: Object.values(dist),
            backgroundColor: labels.map(
              x => priorityColors[x] || '#64748b'
            ),
            borderRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: {
              ticks: { color: '#9ca3af', font: { size: 9 } },
              grid: { display: false }
            },
            y: {
              ticks: { color: '#9ca3af', font: { size: 9 } },
              grid: { color: 'rgba(255,255,255,.05)' }
            }
          }
        }
      });
    }
    return;
  }

  firstCard?.classList.remove('role-hidden');

  if (cropTitle) {
    cropTitle.innerHTML =
      currentPersonaRole === 'policy'
        ? '<i data-lucide="leaf"></i> Regional Vegetation Condition'
        : '<i data-lucide="leaf"></i> Current Vegetation Condition';
  }

  if (stressTitle) {
    stressTitle.innerHTML =
      currentPersonaRole === 'policy'
        ? '<i data-lucide="droplets"></i> Irrigation Priority Distribution'
        : '<i data-lucide="waves"></i> Current Moisture Signal';
  }

  if (cropCtx) {
    const dist = summary.vegetation_distribution || {};
    const labels = Object.keys(dist);

    cropChartInstance = new Chart(cropCtx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: Object.values(dist),
          backgroundColor: labels.map(
            x => VEG_COLORS[x] || '#64748b'
          ),
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: {
            position: 'right',
            labels: { color: '#9ca3af', font: { size: 10 } }
          }
        }
      }
    });
  }

  if (stressCtx) {
    const dist = currentPersonaRole === 'policy'
      ? (summary.irrigation_priority_distribution || {})
      : (summary.moisture_distribution || {});

    const labels = Object.keys(dist);
    const colors = currentPersonaRole === 'policy'
      ? {
          'No / Low Priority': '#10b981',
          'Low Priority': '#eab308',
          'Medium Priority': '#f97316',
          'High Priority': '#ef4444',
          'No Advisory': '#64748b'
        }
      : MOISTURE_COLORS;

    stressChartInstance = new Chart(stressCtx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: Object.values(dist),
          backgroundColor: labels.map(
            x => colors[x] || '#64748b'
          ),
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            ticks: { color: '#9ca3af', font: { size: 9 } },
            grid: { display: false }
          },
          y: {
            ticks: { color: '#9ca3af', font: { size: 9 } },
            grid: { color: 'rgba(255,255,255,.05)' }
          }
        }
      }
    });
  }
}

function renderQaTable() {
  const tbody = document.getElementById('tehsil-table-body');
  const card = tbody?.closest('.data-table-card');
  if (!tbody || !card) return;

  const cfg = ROLE_CONFIG[currentPersonaRole] || ROLE_CONFIG.officer;

  if (!cfg.showQa) {
    card.classList.add('role-hidden');
    return;
  }

  card.classList.remove('role-hidden');

  const p = currentPeriodSummary();
  const title = card.querySelector('.table-header h4');

  if (title) {
    title.innerHTML =
      currentPersonaRole === 'irrigation' || currentPersonaRole === 'wua'
        ? '<i data-lucide="droplets"></i> Water Allocation Status'
        : currentPersonaRole === 'policy'
          ? '<i data-lucide="database"></i> Regional Data & Water Status'
          : '<i data-lucide="database"></i> Current 8-Day Period QA';
  }

  const table = document.getElementById('tehsil-table');
  const heads = table?.querySelectorAll('thead th') || [];

  if (heads.length >= 4) {
    heads[0].textContent = 'Component';
    heads[1].textContent = 'Source';
    heads[2].textContent = 'Value';
    heads[3].textContent = 'Status';
  }

  let rows;

  if (currentPersonaRole === 'irrigation' || currentPersonaRole === 'wua') {
    const high =
      Number(p.irrigation_priority_distribution?.['High Priority'] || 0);
    const medium =
      Number(p.irrigation_priority_distribution?.['Medium Priority'] || 0);

    rows = [
      ['8-Day Rainfall', 'Real weather', `${fmt(p.mean_rainfall_mm,1)} mm`, 'REAL'],
      ['FAO-56 ET₀', 'Derived weather', `${fmt(p.mean_fao56_eto_mm,1)} mm`, 'DERIVED'],
      ['Median Deficit', 'Water balance', `${fmt(p.median_deficit_mm,1)} mm`, 'PROTOTYPE'],
      ['Medium Priority', 'Advisory rule', medium.toLocaleString(), 'PROTOTYPE'],
      ['High Priority', 'Advisory rule', high.toLocaleString(), 'PROTOTYPE']
    ];
  } else {
    rows = [
      ['Period', 'Master calendar', `${formatDateShort(p.period_start)}–${formatDateShort(p.period_end)}`, 'REAL'],
      ['Weather', 'New 8-day raster', `${fmt(p.mean_rainfall_mm, 1)} mm rain`, p.weather_available ? 'REAL' : 'MISSING'],
      ['Satellite', 'Old 16-day dataset',
        `${modalityShort('OPT', p.optical_mode, p.optical_age_days)} / ${modalityShort('SAR', p.sar_mode, p.sar_age_days)}`,
        p.satellite_mode === 'fresh' ? 'FRESH' : p.satellite_mode === 'mixed' ? 'MIXED' : p.satellite_mode === 'carried' ? 'CARRIED' : 'MISSING'
      ],
      ['Optical valid', 'Sentinel-2', `${fmt(p.optical_valid_pct, 1)}%`, 'REAL'],
      ['SAR valid', 'Sentinel-1', `${fmt(p.sar_valid_pct, 1)}%`, 'REAL'],
      ['Irrigation', 'Water-balance rule', `${fmt(p.median_deficit_mm, 1)} mm median`, 'PROTOTYPE']
    ];
  }

  tbody.innerHTML = rows.map(([a, b, c, d]) => {
    const cls =
      ['REAL', 'FRESH'].includes(d)
        ? 'priority-low'
        : d === 'MISSING'
          ? 'priority-high'
          : 'priority-mid';

    return `
      <tr>
        <td><strong>${a}</strong></td>
        <td style="color:#9ca3af">${b}</td>
        <td>${c}</td>
        <td><span class="priority-pill ${cls}">${d}</span></td>
      </tr>
    `;
  }).join('');
}

function updatePersonaView() {
  const container = document.getElementById('persona-view-container');
  if (!container) return;

  const p = currentPeriodSummary();
  const scoped = getScopedCurrentRecords();

  if (currentPersonaRole === 'farmer') {
    const plotRows = farmerFieldIds
      .map(id => {
        const field = pipelineData.fields.find(
          x => String(x.field_id) === String(id)
        );
        const row = currentRecord(id);
        return { field, row };
      })
      .filter(x => x.field && x.row);

    container.innerHTML = `
      <div class="persona-title">
        <i data-lucide="sprout"></i> Farmer — My Farms
      </div>
      <p class="persona-body">
        Only your two assigned demo plots are shown on the map. Technical model
        evaluation and regional pipeline controls are hidden.
      </p>
      <div class="farmer-plot-list">
        ${plotRows.map(({ field, row }, index) => `
          <button class="farmer-plot-btn" data-farmer-field="${field.field_id}">
            <strong>Farm ${index + 1} • ${field.field_id}</strong>
            <span>
              Deficit ${fmt(row.water_balance?.deficit_mm,1)} mm •
              Priority ${row.water_balance?.priority_score ?? '--'}/10
            </span>
          </button>
        `).join('')}
      </div>
      <span class="role-scope-badge">
        <i data-lucide="map-pin"></i> ${plotRows.length} assigned demo plots
      </span>
    `;

    container.querySelectorAll('[data-farmer-field]').forEach(button => {
      button.addEventListener('click', () => {
        const id = button.dataset.farmerField;
        const field = pipelineData.fields.find(
          x => String(x.field_id) === String(id)
        );
        if (field) {
          map.setView([field.lat, field.lon], 15);
          openFieldModal(id);
        }
      });
    });
  } else if (currentPersonaRole === 'irrigation') {
    container.innerHTML = `
      <div class="persona-title">
        <i data-lucide="waves"></i> Irrigation Officer
      </div>
      <p class="persona-body">
        Water-only operational interface: deficit and irrigation-priority layers,
        8-day rainfall, ET₀ estimate, and release-priority distribution.
      </p>
      <div class="persona-kpi-grid">
        <div class="persona-kpi-box">
          <span class="kpi-title">Median Deficit</span>
          <span class="kpi-val text-amber">${fmt(p.median_deficit_mm,1)} mm</span>
        </div>
        <div class="persona-kpi-box">
          <span class="kpi-title">8-Day Rainfall</span>
          <span class="kpi-val text-cyan">${fmt(p.mean_rainfall_mm,1)} mm</span>
        </div>
      </div>
      <div class="role-water-note">
        Crop/phenology/model-evaluation controls are intentionally hidden in this role.
      </div>
    `;
  } else if (currentPersonaRole === 'wua') {
    const high =
      Number(p.irrigation_priority_distribution?.['High Priority'] || 0) +
      Number(p.irrigation_priority_distribution?.['Medium Priority'] || 0);

    container.innerHTML = `
      <div class="persona-title">
        <i data-lucide="users"></i> Water User Association
      </div>
      <p class="persona-body">
        Simplified water-allocation view for local coordination: deficit and
        advisory layers only.
      </p>
      <div class="persona-kpi-grid">
        <div class="persona-kpi-box">
          <span class="kpi-title">Priority Samples</span>
          <span class="kpi-val text-amber">${high.toLocaleString()}</span>
        </div>
        <div class="persona-kpi-box">
          <span class="kpi-title">Median Deficit</span>
          <span class="kpi-val">${fmt(p.median_deficit_mm,1)} mm</span>
        </div>
      </div>
      <div class="role-water-note">
        A real WUA/canal boundary can replace the current regional demo scope later.
      </div>
    `;
  } else if (currentPersonaRole === 'policy') {
    container.innerHTML = `
      <div class="persona-title">
        <i data-lucide="landmark"></i> Policy Maker
      </div>
      <p class="persona-body">
        Regional summary interface. Individual point inspection is disabled;
        the emphasis is seasonal coverage, vegetation and irrigation demand.
      </p>
      <div class="persona-kpi-grid">
        <div class="persona-kpi-box">
          <span class="kpi-title">Optical Coverage</span>
          <span class="kpi-val text-emerald">${fmt(p.optical_valid_pct,1)}%</span>
        </div>
        <div class="persona-kpi-box">
          <span class="kpi-title">SAR Coverage</span>
          <span class="kpi-val text-cyan">${fmt(p.sar_valid_pct,1)}%</span>
        </div>
      </div>
    `;
  } else {
    container.innerHTML = `
      <div class="persona-title">
        <i data-lucide="badge-check"></i> Agriculture Officer
      </div>
      <p class="persona-body">
        Full regional crop-intelligence interface with vegetation, derived
        phenology, moisture signal, deficit, advisory, QA and model evaluation.
      </p>
      <div class="persona-kpi-grid">
        <div class="persona-kpi-box">
          <span class="kpi-title">Optical Valid</span>
          <span class="kpi-val text-emerald">${fmt(p.optical_valid_pct,1)}%</span>
        </div>
        <div class="persona-kpi-box">
          <span class="kpi-title">SAR Valid</span>
          <span class="kpi-val text-cyan">${fmt(p.sar_valid_pct,1)}%</span>
        </div>
      </div>
    `;
  }

  if (window.lucide) lucide.createIcons();
}

/* -------------------------------------------------------------------------- */
/* FIELD MODAL                                                                 */
/* -------------------------------------------------------------------------- */

async function openFieldModal(fieldId) {
  if (!roleAllowsField(fieldId)) return;

  const cfg = ROLE_CONFIG[currentPersonaRole] || ROLE_CONFIG.officer;
  if (cfg.allowFieldModal === false) return;

  activeField = pipelineData.fields.find(
    f => String(f.field_id) === String(fieldId)
  );

  if (!activeField) return;

  updateFieldModalValues();

  document.getElementById('field-modal-backdrop')
    ?.classList.add('active');

  await Promise.all([
    renderFieldTimeline(fieldId),
    renderLiveInference(fieldId)
  ]);
}

async function updateOpenFieldModal() {
  if (!activeField) return;

  updateFieldModalValues();

  await Promise.all([
    renderFieldTimeline(activeField.field_id),
    renderLiveInference(activeField.field_id)
  ]);
}

function updateFieldModalValues() {
  const row = currentRecord(activeField.field_id);
  if (!row) return;

  const sat = row.satellite || {};
  const weather = row.weather || {};
  const water = row.water_balance || {};

  setText(
    'field-modal-title',
    `Observation: ${activeField.field_id} • ${formatDateShort(row.period_start)}`
  );
  setText(
    'field-modal-crop',
    activeField.crop_type || 'Unclassified'
  );
  setText(
    'field-modal-tehsil',
    satelliteLabel(sat)
  );

  setText('m-ndvi', fmt(sat.NDVI, 3));
  setText(
    'm-ndwi',
    fmt(activeField.snapshot_indices?.NDWI, 3)
  );
  setText('m-ndmi', fmt(sat.NDMI, 3));

  setText('m-vv', `${fmt(sat.VV, 2)} dB`);
  setText('m-vh', `${fmt(sat.VH, 2)} dB`);
  setText(
    'm-ratio',
    `${fmt(sat.VV_VH_ratio_dB, 2)} dB`
  );

  setText('m-area', 'Point observation');
  setText(
    'm-soil',
    `FC 0cm ${fmt(activeField.soil?.field_capacity_0cm, 1)}%`
  );
  setText(
    'm-canal',
    `Weather grid • ${fmt(weather.rainfall_mm,1)} mm rain`
  );

  setText('m-kc', fmt(water.kc, 2));
  setText('m-etc', `${fmt(water.etc_mm, 1)} mm`);
  setText(
    'm-peff',
    `${fmt(water.effective_rain_mm, 1)} mm`
  );
  setText(
    'm-deficit',
    `${fmt(water.deficit_mm, 1)} mm`
  );

  setText(
    'm-advisory-text',
    `${water.priority_label || 'No Advisory'} — ${water.status || ''}`
  );
  setText(
    'm-rec-depth',
    `${fmt(water.recommended_depth_mm, 1)} mm`
  );
  setText(
    'm-rec-timing',
    water.timing || '--'
  );

  const badge = document.getElementById('m-priority-badge');
  if (badge) {
    const priority = Number(water.priority_score || 0);
    badge.textContent =
      `Priority ${priority}/10 • ${water.priority_label || '--'}`;
    badge.className =
      `badge ${priority >= 8 ? 'badge-danger' : priority >= 4 ? 'badge-warning' : 'badge-emerald'}`;
  }

  injectPeriodContext(row);
}

function injectPeriodContext(row) {
  const body =
    document.querySelector('#field-modal-backdrop .modal-body');

  if (!body) return;

  let card = document.getElementById('period-context-card');

  if (!card) {
    card = document.createElement('div');
    card.id = 'period-context-card';
    card.className = 'period-context-card';
    body.prepend(card);
  }

  const sat = row.satellite || {};
  const weather = row.weather || {};

  card.innerHTML = `
    <div class="period-context-item">
      <span>Master Period</span>
      <strong>${formatDateShort(row.period_start)}–${formatDateShort(row.period_end)}</strong>
    </div>
    <div class="period-context-item">
      <span>Satellite State</span>
      <strong>${satelliteLabel(sat)}</strong>
    </div>
    <div class="period-context-item">
      <span>8-Day Rainfall</span>
      <strong>${fmt(weather.rainfall_mm,1)} mm</strong>
    </div>
    <div class="period-context-item">
      <span>FAO-56 ET₀ Estimate</span>
      <strong>${fmt(weather.fao56_eto_est_mm,1)} mm</strong>
    </div>
    <div class="period-context-item">
      <span>Mean Temperature</span>
      <strong>${fmt(weather.tmean_C,1)} °C</strong>
    </div>
    <div class="period-context-item">
      <span>ERA5 PEV</span>
      <strong>${fmt(weather.ERA5_PEV_mm,1)} mm</strong>
    </div>
    <div class="period-context-item">
      <span>Derived Stage</span>
      <strong>${row.derived?.growth_stage || '--'}</strong>
    </div>
    <div class="period-context-item">
      <span>Moisture Signal</span>
      <strong>${row.derived?.moisture_signal || '--'}</strong>
    </div>
  `;
}

async function renderFieldTimeline(fieldId) {
  const canvas = document.getElementById('fieldTemporalChart');
  if (!canvas) return;

  try {
    const res = await fetch(
      `/api/field-timeline/${encodeURIComponent(fieldId)}`,
      { cache: 'no-store' }
    );

    if (!res.ok) return;

    const payload = await res.json();
    const timeline = payload.timeline || [];

    if (fieldTemporalChartInstance) {
      fieldTemporalChartInstance.destroy();
    }

    const labels = timeline.map(
      x => formatDateShort(x.period_start)
    );

    const ndvi = timeline.map(
      x => finiteOrNull(x.satellite?.NDVI)
    );

    const rainfall = timeline.map(
      x => finiteOrNull(x.weather?.rainfall_mm)
    );

    const freshPointRadius = timeline.map(
      x => x.satellite?.status === 'fresh' ? 6 : 3
    );

    fieldTemporalChartInstance = new Chart(
      canvas.getContext('2d'),
      {
        data: {
          labels,
          datasets: [
            {
              type: 'line',
              label: 'NDVI • latest real satellite state',
              data: ndvi,
              borderColor: '#10b981',
              backgroundColor: 'rgba(16,185,129,.08)',
              pointRadius: freshPointRadius,
              spanGaps: true,
              tension: 0.25,
              yAxisID: 'y'
            },
            {
              type: 'bar',
              label: '8-day rainfall (mm)',
              data: rainfall,
              backgroundColor: 'rgba(6,182,212,.28)',
              borderColor: '#06b6d4',
              borderWidth: 1,
              yAxisID: 'y1'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'index',
            intersect: false
          },
          scales: {
            x: {
              ticks: {
                color: '#9ca3af',
                font: { size: 9 }
              },
              grid: { display: false }
            },
            y: {
              type: 'linear',
              position: 'left',
              min: -0.2,
              max: 1.0,
              ticks: { color: '#10b981' }
            },
            y1: {
              type: 'linear',
              position: 'right',
              beginAtZero: true,
              ticks: { color: '#06b6d4' },
              grid: { display: false }
            }
          },
          plugins: {
            legend: {
              labels: {
                color: '#9ca3af',
                font: { size: 10 }
              }
            }
          }
        }
      }
    );
  } catch (err) {
    console.warn('Field timeline unavailable:', err);
  }
}


/* -------------------------------------------------------------------------- */
/* LIVE MODEL INFERENCE                                                        */
/* -------------------------------------------------------------------------- */

function roleShowsLiveInference() {
  return (
    currentPersonaRole === 'officer' ||
    currentPersonaRole === 'farmer'
  );
}

function ensureInferenceCard() {
  const body =
    document.querySelector('#field-modal-backdrop .modal-body');

  if (!body) return null;

  let card = document.getElementById('live-inference-card');

  if (!roleShowsLiveInference()) {
    card?.remove();
    return null;
  }

  if (!card) {
    card = document.createElement('div');
    card.id = 'live-inference-card';
    card.className = 'live-inference-card';

    const periodCard =
      document.getElementById('period-context-card');

    if (periodCard?.parentNode) {
      periodCard.insertAdjacentElement('afterend', card);
    } else {
      body.prepend(card);
    }
  }

  return card;
}

async function renderLiveInference(fieldId) {
  const card = ensureInferenceCard();
  if (!card) return;

  const period = currentPeriodSummary()?.period_start || '';

  card.innerHTML = `
    <div class="live-inference-head">
      <strong>
        <i data-lucide="brain-circuit"></i>
        ${currentPersonaRole === 'farmer'
          ? 'AI Field Assessment'
          : 'Live Trained-Model Inference'}
      </strong>
      <span class="live-inference-status">RUNNING</span>
    </div>
    <div style="font-size:.68rem;color:#94a3b8">
      Loading Crop RF, Phenology LSTM and Stress XGBoost...
    </div>
  `;

  if (window.lucide) lucide.createIcons();

  try {
    const query = period
      ? `?as_of=${encodeURIComponent(period)}`
      : '';

    const response = await fetch(
      `/api/inference/field/${encodeURIComponent(fieldId)}${query}`,
      { cache:'no-store' }
    );

    const payload = await response.json();

    if (!response.ok) {
      const detail =
        payload?.details?.detail?.message ||
        payload?.details?.detail ||
        payload?.details ||
        payload?.error ||
        `HTTP ${response.status}`;

      throw new Error(
        typeof detail === 'string'
          ? detail
          : JSON.stringify(detail)
      );
    }

    if (
      !activeField ||
      String(activeField.field_id) !== String(fieldId)
    ) {
      return;
    }

    const crop = payload.predictions?.crop;
    const phenology = payload.predictions?.phenology;
    const stress = payload.predictions?.stress;

    const modelLine = prediction => {
      if (!prediction || currentPersonaRole === 'farmer') {
        return '';
      }
      return `
        <div class="live-inference-note">
          ${escapeHtml(prediction.model || '')}
        </div>
      `;
    };

    const itemHtml = (title, prediction) => {
      if (!prediction) {
        return `
          <div class="live-inference-item">
            <span>${title}</span>
            <strong>Unavailable</strong>
          </div>
        `;
      }

      return `
        <div class="live-inference-item">
          <span>${title}</span>
          <strong>${escapeHtml(prediction.label || '--')}</strong>
          <div class="live-inference-confidence">
            ${
              prediction.confidence == null
                ? 'confidence unavailable'
                : `${(Number(prediction.confidence) * 100).toFixed(1)}% confidence`
            }
          </div>
          ${modelLine(prediction)}
        </div>
      `;
    };

    card.innerHTML = `
      <div class="live-inference-head">
        <strong>
          <i data-lucide="brain-circuit"></i>
          ${currentPersonaRole === 'farmer'
            ? 'AI Field Assessment'
            : 'Live Trained-Model Inference'}
        </strong>
        <span class="live-inference-status">MODEL OUTPUT</span>
      </div>

      <div class="live-inference-grid">
        ${itemHtml('Crop', crop)}
        ${itemHtml('Growth Stage', phenology)}
        ${itemHtml('Moisture Stress', stress)}
      </div>

      <div class="live-inference-note">
        As of <strong>${escapeHtml(payload.as_of || period || '--')}</strong>.
        Optical source:
        <strong>${escapeHtml(payload.data_sources?.optical_source_date || 'N/A')}</strong>.
        SAR source:
        <strong>${escapeHtml(payload.data_sources?.sar_source_date || 'N/A')}</strong>.
        ${
          currentPersonaRole === 'farmer'
            ? 'Prototype AI decision-support output.'
            : 'These are predictions from the serialized trained models; current training labels are still prototype/derived.'
        }
      </div>

      ${
        (payload.warnings || []).length
          ? `<div class="live-inference-error" style="margin-top:.55rem">
              ${payload.warnings.map(escapeHtml).join('<br>')}
            </div>`
          : ''
      }
    `;

    if (window.lucide) lucide.createIcons();

  } catch (error) {
    card.innerHTML = `
      <div class="live-inference-head">
        <strong>
          <i data-lucide="brain-circuit"></i>
          Live Model Inference
        </strong>
        <span class="live-inference-status">OFFLINE</span>
      </div>
      <div class="live-inference-error">
        ${escapeHtml(error.message)}
      </div>
      <div class="live-inference-note">
        Verify the selected artifacts in <code>private_models/</code>
        and check <code>/api/inference/health</code>.
      </div>
    `;

    if (window.lucide) lucide.createIcons();
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}


/* -------------------------------------------------------------------------- */
/* MODEL EVAL                                                                  */
/* -------------------------------------------------------------------------- */

async function renderModelEvaluation() {
  const target = document.getElementById('model-eval-content');
  if (!target) return;

  target.innerHTML = 'Loading model evaluation...';

  try {
    const [evalRes, metaRes] = await Promise.all([
      fetch('/api/model-evaluation', { cache: 'no-store' }),
      fetch('/api/model-metadata', { cache: 'no-store' })
    ]);

    const staticEvalRes = evalRes.ok
      ? evalRes
      : await fetch('/data/model_evaluation.json', { cache: 'no-store' });
    const staticMetaRes = metaRes.ok
      ? metaRes
      : await fetch('/data/model_metadata.json', { cache: 'no-store' });

    if (!staticEvalRes.ok) {
      throw new Error('model_evaluation.json is unavailable');
    }

    const rows = await staticEvalRes.json();
    const meta = staticMetaRes.ok ? await staticMetaRes.json() : {};

    const grouped = {};

    rows.forEach(row => {
      if (!grouped[row.engine]) grouped[row.engine] = [];
      grouped[row.engine].push(row);
    });

    target.innerHTML =
      Object.entries(grouped).map(([engine, models]) => `
        <section style="margin-bottom:1.3rem">
          <h3 style="margin-bottom:.7rem">${engine}</h3>
          <div class="model-eval-grid">
            ${models.map(modelCardHtml).join('')}
          </div>
        </section>
      `).join('') +
      `<div class="eval-warning">
        ${meta.evaluation_warning || 'Prototype evaluation on derived/pseudo labels.'}
      </div>`;
  } catch (err) {
    target.innerHTML =
      `<div class="eval-warning">${err.message}</div>`;
  }
}

function modelCardHtml(m) {
  return `
    <article class="model-card">
      <h4>${m.model}</h4>
      <div style="font-size:.68rem;color:#94a3b8">
        ${(m.classes || []).join(' • ')}
      </div>
      <div class="model-metrics">
        <div class="model-metric">
          <span>Accuracy</span>
          <strong>${pct(m.accuracy)}</strong>
        </div>
        <div class="model-metric">
          <span>Macro F1</span>
          <strong>${fmt(m.macro_f1,3)}</strong>
        </div>
        <div class="model-metric">
          <span>Macro Precision</span>
          <strong>${fmt(m.macro_precision,3)}</strong>
        </div>
        <div class="model-metric">
          <span>Macro Recall</span>
          <strong>${fmt(m.macro_recall,3)}</strong>
        </div>
      </div>
      ${confusionMatrixHtml(m.classes || [], m.confusion_matrix || [])}
    </article>
  `;
}

function confusionMatrixHtml(classes, matrix) {
  if (!matrix.length) return '';

  const head =
    `<tr><th>Actual ↓ / Pred →</th>${classes.map(c => `<th>${c}</th>`).join('')}</tr>`;

  const body = matrix.map(
    (row, i) =>
      `<tr><th>${classes[i] ?? i}</th>${row.map(v => `<td>${v}</td>`).join('')}</tr>`
  ).join('');

  return `<table class="cm-table">${head}${body}</table>`;
}

/* -------------------------------------------------------------------------- */
/* EVENTS                                                                      */
/* -------------------------------------------------------------------------- */

function initEventListeners() {
  document.querySelectorAll('.layer-btn').forEach(button => {
    button.addEventListener('click', event => {
      document.querySelectorAll('.layer-btn')
        .forEach(x => x.classList.remove('active'));

      const target = event.currentTarget;
      target.classList.add('active');
      currentLayerMode = target.dataset.layer;

      updateLegend();
      updateMapStyles();
    });
  });

  document.getElementById('timeline-prev')
    ?.addEventListener('click', async () => {
      stopPlayback();
      const count = masterTimeline().length;
      const next =
        (currentPeriodIndex - 1 + count) % count;
      await loadPeriod(next);
    });

  document.getElementById('timeline-next')
    ?.addEventListener('click', async () => {
      stopPlayback();
      const count = masterTimeline().length;
      const next =
        (currentPeriodIndex + 1) % count;
      await loadPeriod(next);
    });

  document.getElementById('timeline-slider')
    ?.addEventListener('input', async event => {
      stopPlayback();
      await loadPeriod(Number(event.target.value));
    });

  document.getElementById('timeline-select')
    ?.addEventListener('change', async event => {
      stopPlayback();
      await loadPeriod(Number(event.target.value));
    });

  document.getElementById('timeline-play')
    ?.addEventListener('click', togglePlayback);

  document.getElementById('btn-model-eval')
    ?.addEventListener('click', async () => {
      document.getElementById('model-eval-backdrop')
        ?.classList.add('active');
      await renderModelEvaluation();
    });

  document.getElementById('btn-close-model-eval')
    ?.addEventListener('click', () => {
      document.getElementById('model-eval-backdrop')
        ?.classList.remove('active');
    });

  document.getElementById('btn-close-field-modal')
    ?.addEventListener('click', () => {
      document.getElementById('field-modal-backdrop')
        ?.classList.remove('active');
    });

  document.getElementById('btn-pipeline-modal')
    ?.addEventListener('click', () => {
      document.getElementById('pipeline-modal-backdrop')
        ?.classList.add('active');
    });

  document.getElementById('btn-close-pipeline-modal')
    ?.addEventListener('click', () => {
      document.getElementById('pipeline-modal-backdrop')
        ?.classList.remove('active');
    });

  document.getElementById('btn-run-pipeline')
    ?.addEventListener('click', rebuildPipeline);

  document.getElementById('persona-select')
    ?.addEventListener('change', async event => {
      stopPlayback();
      currentPersonaRole = event.target.value || 'officer';
      applyPersonaRole(true);
    });

  document.getElementById('btn-export-field')
    ?.addEventListener('click', () => {
      if (!activeField) return;

      const current = currentRecord(activeField.field_id);
      const blob = new Blob(
        [JSON.stringify({ field: activeField, current_period: current }, null, 2)],
        { type: 'application/json' }
      );

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download =
        `AgriSense_${activeField.field_id}_${currentPeriodSummary().period_start}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
}

function togglePlayback() {
  if (seasonTimer) {
    stopPlayback();
    return;
  }

  const playButton = document.getElementById('timeline-play');

  if (currentPeriodIndex >= masterTimeline().length - 1) {
    loadPeriod(0);
  }

  seasonTimer = setInterval(async () => {
    if (currentPeriodIndex >= masterTimeline().length - 1) {
      stopPlayback();
      return;
    }

    await loadPeriod(currentPeriodIndex + 1);
  }, 1500);

  if (playButton) {
    playButton.innerHTML = '<i data-lucide="pause"></i>';
  }

  if (window.lucide) lucide.createIcons();
}

function stopPlayback() {
  if (seasonTimer) {
    clearInterval(seasonTimer);
    seasonTimer = null;
  }

  const playButton = document.getElementById('timeline-play');
  if (playButton) {
    playButton.innerHTML = '<i data-lucide="play"></i>';
  }

  if (window.lucide) lucide.createIcons();
}

async function rebuildPipeline() {
  stopPlayback();

  const button = document.getElementById('btn-run-pipeline');
  if (!button) return;

  button.disabled = true;
  button.innerHTML =
    '<i data-lucide="loader" class="spin"></i> Rebuilding 19 Steps...';

  const consoleBody = document.getElementById('console-body');
  const consoleStatus = document.getElementById('console-status');

  document.getElementById('pipeline-modal-backdrop')
    ?.classList.add('active');

  if (consoleStatus) {
    consoleStatus.textContent =
      'Combining 19 weather periods with the latest real old satellite state...';
  }

  if (consoleBody) {
    consoleBody.innerHTML = `
      <div class="log-line log-info">[1] Reading 19-period master manifest...</div>
      <div class="log-line log-info">[2] Sampling real 8-day weather rasters...</div>
      <div class="log-line log-info">[3] Sampling static 24-band soil stack...</div>
      <div class="log-line log-info">[4] Matching old real satellite observations...</div>
      <div class="log-line log-info">[5] Marking FRESH vs CARRIED satellite states...</div>
      <div class="log-line log-info">[6] Calculating FAO-56 ET₀ estimates + prototype advisory...</div>
    `;
  }

  try {
    const res = await fetch(
      '/api/run-pipeline',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      }
    );

    const result = await res.json();

    if (!res.ok) {
      throw new Error(result.details || result.error || 'Pipeline failed');
    }

    pipelineData = result.data;
    initializePersonaScopes();
    currentPeriodIndex = 0;
    configureTimeline();
    await loadPeriod(0, false);

    if (!geojsonLayer) {
      renderBaseMap();
    }

    renderAll();

    if (consoleStatus) {
      consoleStatus.textContent = '19-step master timeline ready';
    }

    if (consoleBody) {
      consoleBody.innerHTML += `
        <div class="log-line log-success">
          [SUCCESS] ${pipelineData.summary.master_period_count} master periods ready.
          Satellite temporal table:
          ${pipelineData.summary.satellite_temporal_available ? 'available' : 'missing'}.
        </div>
      `;
    }
  } catch (err) {
    if (consoleBody) {
      consoleBody.innerHTML +=
        `<div class="log-line log-err">[ERROR] ${err.message}</div>`;
    }
  } finally {
    button.disabled = false;
    button.innerHTML =
      '<i data-lucide="refresh-cw"></i> Rebuild Demo Data';

    if (window.lucide) lucide.createIcons();
  }
}

/* -------------------------------------------------------------------------- */
/* POSTER MAP                                                                  */
/* -------------------------------------------------------------------------- */

function renderPosterFieldMap() {
  const element = document.getElementById('poster-field-map');
  if (!element || !pipelineData?.geojson?.features) return;

  if (posterMap && posterFieldLayer) {
    posterFieldLayer.eachLayer(layer => {
      const id = layer.feature?.properties?.field_id;
      if (id && layer.setStyle) {
        layer.setStyle(featureStyle(id));
      }
    });
    return;
  }

  posterMap = L.map('poster-field-map', {
    zoomControl: true,
    attributionControl: true,
    scrollWheelZoom: false,
    preferCanvas: true
  }).setView([29.6857, 76.9905], 10);

  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      attribution: 'Tiles &copy; Esri',
      maxZoom: 19
    }
  ).addTo(posterMap);

  const subset = {
    type: 'FeatureCollection',
    features: pipelineData.geojson.features.slice(0, 800)
  };

  posterFieldLayer = L.geoJSON(subset, {
    pointToLayer: (feature, latlng) =>
      L.circleMarker(latlng, {
        radius: 3,
        ...featureStyle(feature.properties.field_id)
      })
  }).addTo(posterMap);

  const bounds = posterFieldLayer.getBounds();
  if (bounds.isValid()) {
    posterMap.fitBounds(bounds, { padding: [18, 18] });
  }
}


/* -------------------------------------------------------------------------- */
/* ROLE-SPECIFIC UI                                                            */
/* -------------------------------------------------------------------------- */

function initializePersonaScopes() {
  currentPersonaRole =
    document.getElementById('persona-select')?.value || 'officer';

  const centerLat = 29.6857;
  const centerLon = 76.9905;

  const candidates = (pipelineData?.fields || [])
    .filter(field =>
      Number.isFinite(Number(field.lat)) &&
      Number.isFinite(Number(field.lon))
    )
    .map(field => ({
      id: String(field.field_id),
      distance2:
        Math.pow(Number(field.lat) - centerLat, 2) +
        Math.pow(Number(field.lon) - centerLon, 2)
    }))
    .sort((a, b) => a.distance2 - b.distance2);

  // These are real observation points selected deterministically for the demo.
  // They are not claimed to be verified cadastral farm boundaries.
  farmerFieldIds = candidates.slice(0, 2).map(x => x.id);
}

function visibleFieldIdSet() {
  const cfg = ROLE_CONFIG[currentPersonaRole] || ROLE_CONFIG.officer;

  if (cfg.fieldScope === 'farmer') {
    return new Set(farmerFieldIds.map(String));
  }

  return null;
}

function roleAllowsField(fieldId) {
  const visible = visibleFieldIdSet();
  return visible === null || visible.has(String(fieldId));
}

function getScopedCurrentRecords() {
  const records = currentPeriodPayload?.records || [];
  const visible = visibleFieldIdSet();

  if (visible === null) return records;

  return records.filter(row =>
    visible.has(String(row.field_id))
  );
}

function setElementVisible(element, visible) {
  if (!element) return;
  element.classList.toggle('role-hidden', !visible);
}

function applyPersonaChrome() {
  const cfg = ROLE_CONFIG[currentPersonaRole] || ROLE_CONFIG.officer;

  setText('panel-title', cfg.panelTitle);

  document.querySelectorAll('.layer-btn').forEach(button => {
    const allowed = cfg.layers.includes(button.dataset.layer);
    button.classList.toggle('role-hidden', !allowed);
  });

  if (!cfg.layers.includes(currentLayerMode)) {
    currentLayerMode = cfg.defaultLayer;
  }

  document.querySelectorAll('.layer-btn')
    .forEach(button =>
      button.classList.toggle(
        'active',
        button.dataset.layer === currentLayerMode
      )
    );

  setElementVisible(
    document.getElementById('btn-model-eval'),
    cfg.showModelEvaluation
  );
  setElementVisible(
    document.getElementById('btn-pipeline-modal'),
    cfg.showPipelineArchitecture
  );
  setElementVisible(
    document.getElementById('btn-run-pipeline'),
    cfg.showRunPipeline
  );

  const posterSection = document.querySelector('.design-poster-section');
  if (posterSection) {
    // Keep the multi-persona design poster out of focused operational views.
    posterSection.classList.toggle(
      'role-hidden',
      currentPersonaRole !== 'officer'
    );
  }
}

function applyPersonaRole(rebuildMap = true) {
  const cfg = ROLE_CONFIG[currentPersonaRole] || ROLE_CONFIG.officer;

  activeField = null;
  document.getElementById('field-modal-backdrop')
    ?.classList.remove('active');

  applyPersonaChrome();

  if (rebuildMap && pipelineData) {
    renderBaseMap();
  }

  updateHeader();
  updateLegend();
  renderCharts();
  renderQaTable();
  updatePersonaView();

  if (window.lucide) lucide.createIcons();
  syncHeaderHeight();
}


/* -------------------------------------------------------------------------- */
/* HELPERS                                                                     */
/* -------------------------------------------------------------------------- */

function masterTimeline() {
  return pipelineData?.summary?.master_timeline || [];
}

function fmt(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : '--';
}

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pct(value) {
  const n = Number(value);
  return Number.isFinite(n)
    ? `${(n * 100).toFixed(1)}%`
    : '--';
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function formatDateShort(value) {
  if (!value) return '--';

  const d = new Date(
    `${String(value).slice(0, 10)}T00:00:00`
  );

  if (Number.isNaN(d.getTime())) {
    return String(value);
  }

  return d.toLocaleDateString(
    'en-IN',
    { day: '2-digit', month: 'short' }
  );
}

function formatDateLong(value) {
  if (!value) return '--';

  const d = new Date(
    `${String(value).slice(0, 10)}T00:00:00`
  );

  if (Number.isNaN(d.getTime())) {
    return String(value);
  }

  return d.toLocaleDateString(
    'en-IN',
    {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    }
  );
}

// Keep the existing poster cards populated with non-fabricated labels.
function updatePosterCards() {
  const update = (selector, value) => {
    const el =
      document.querySelector(`[data-poster-field="${selector}"]`);
    if (el) el.textContent = value;
  };

  const p = currentPeriodSummary();

  update('farmer-health', formatDateShort(p.period_start));
  update('farmer-stress', p.satellite_mode || '--');
  update('farmer-irrigation', `${fmt(p.median_deficit_mm,1)} mm`);

  update('wua-demand', '8-day');
  update('wua-available', `${fmt(p.mean_rainfall_mm,1)} mm`);
  update('wua-status', 'Demo');

  update('officer-crop', 'Real satellite');
  update('officer-stage', 'Derived');
  update('officer-alerts', p.satellite_mode || '--');

  update('irrigation-demand', `${fmt(p.mean_fao56_eto_mm,1)} mm ET₀`);
  update('irrigation-supply', `${fmt(p.mean_rainfall_mm,1)} mm rain`);
  update('irrigation-gap', `${fmt(p.median_deficit_mm,1)} mm`);

  update('researcher-ndvi', p.satellite_mode || '--');
  update('researcher-ndwi', 'Real weather');
  update('researcher-stress', 'NDMI');

  update('policy-risk', 'Demo');
  update('policy-coverage', '19 periods');
  update('policy-priority', 'Prototype');

  update('admin-users', `${pipelineData?.summary?.observation_count || 0} obs`);
  update('admin-health', 'Static demo');
  update('admin-alerts', 'N/A');

  renderPosterFieldMap();
}

// Ensure poster cards also update each render.
const originalRenderAll = renderAll;
renderAll = function() {
  updateHeader();
  updateLegend();
  updateMapStyles();
  renderCharts();
  renderQaTable();
  updatePersonaView();
  updatePosterCards();

  if (activeField) {
    updateOpenFieldModal();
  }

  syncHeaderHeight();

  if (window.lucide) lucide.createIcons();
};
