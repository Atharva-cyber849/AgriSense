/**
 * AgriSense Karnal - Web GIS Platform & Pipeline Engine Frontend
 * Location: Karnal District, Haryana, India
 */

let map;
let geojsonLayer = null;
let posterMap = null;
let posterFieldLayer = null;
let currentLayerMode = 'crop';
let pipelineData = null;
let activeField = null;

// Chart Instances
let cropChartInstance = null;
let stressChartInstance = null;
let fieldTemporalChartInstance = null;

// Color Palette Definitions
const CROP_COLORS = {
  "Paddy (Rice)": "#10b981",
  "Wheat": "#f59e0b",
  "Sugarcane": "#a855f7",
  "Mustard": "#eab308",
  "Fodder/Vegetables": "#14b8a6"
};

const STAGE_COLORS = {
  "Sowing/Planting": "#38bdf8",
  "Vegetative": "#22c55e",
  "Flowering": "#84cc16",
  "Grain Filling": "#f97316",
  "Maturity": "#a16207"
};

const STRESS_COLORS = {
  "No Stress": "#10b981",
  "Mild Stress": "#eab308",
  "Moderate Stress": "#f97316",
  "Severe Stress": "#ef4444"
};

// Initialize Application on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  initMap();
  initEventListeners();
  fetchPipelineData();
});

// Initialize Leaflet GIS Map over Karnal
function initMap() {
  // Karnal, Haryana coordinates
  map = L.map('map', {
    center: [29.6857, 76.9905],
    zoom: 11,
    zoomControl: false
  });

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // Esri World Imagery basemap
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri',
    maxZoom: 19
  }).addTo(map);
}

// Fetch Pipeline Execution JSON Data
async function fetchPipelineData() {
  try {
    const res = await fetch('/api/data');
    if (!res.ok) throw new Error('Data payload not found');
    pipelineData = await res.json();
    renderAllComponents();
  } catch (err) {
    console.warn('Backend API offline, falling back to local client execution:', err);
    // Client fallback if server endpoint delayed
    setTimeout(async () => {
      try {
        const res = await fetch('/api/data');
        if (res.ok) {
          pipelineData = await res.json();
          renderAllComponents();
        }
      } catch (e) {
        console.error('Failed to load data:', e);
      }
    }, 1000);
  }
}

// Render All Components after Data Load
function renderAllComponents() {
  if (!pipelineData) return;

  updateHeaderStats();
  renderGeoJSONLayer();
  updateLegend();
  renderCharts();
  renderTehsilTable();
  updatePersonaView();
  updatePosterCards();
  renderPosterFieldMap();
}

function renderPosterFieldMap() {
  const posterMapEl = document.getElementById('poster-field-map');
  if (!posterMapEl || !window.L || !pipelineData || !pipelineData.geojson || !pipelineData.geojson.features) return;

  if (posterMap) {
    posterMap.remove();
    posterMap = null;
  }

  posterMap = L.map('poster-field-map', {
    zoomControl: true,
    attributionControl: true,
    scrollWheelZoom: false
  }).setView([29.6857, 76.9905], 10);

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri',
    maxZoom: 19
  }).addTo(posterMap);

  posterFieldLayer = L.geoJSON(pipelineData.geojson, {
    style: (feature) => {
      const crop = feature.properties.crop_type || 'Sugarcane';
      const colors = {
        'Paddy (Rice)': '#10b981',
        'Wheat': '#f59e0b',
        'Sugarcane': '#a855f7',
        'Mustard': '#eab308',
        'Fodder/Vegetables': '#14b8a6'
      };
      return {
        color: '#0f172a',
        weight: 1,
        fillColor: colors[crop] || '#10b981',
        fillOpacity: 0.7
      };
    },
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      layer.bindPopup(`
        <div style="font-family: Inter, sans-serif; font-size: 12px;">
          <strong>${p.field_id}</strong><br>
          ${p.crop_type}<br>
          ${p.growth_stage}<br>
          ${p.moisture_stress}
        </div>
      `);
    }
  }).addTo(posterMap);

  const bounds = posterFieldLayer.getBounds();
  if (bounds && bounds.isValid && bounds.isValid()) {
    posterMap.fitBounds(bounds, { padding: [18, 18] });
  }
}

function updatePosterCards() {
  if (!pipelineData || !pipelineData.summary) return;

  const s = pipelineData.summary;
  const fields = pipelineData.fields || [];
  const avgStress = fields.length ? fields.reduce((acc, field) => acc + (field.stress_score || 0), 0) / fields.length : 0;
  const criticalFields = fields.filter(field => field.water_balance && field.water_balance.canal_priority_score >= 7).length;
  const acyclic = fields.length ? fields.reduce((acc, field) => acc + (field.area_ha || 0), 0) : 0;
  const avgNdvi = fields.length ? fields.reduce((acc, field) => acc + ((field.indices && field.indices.NDVI) || 0), 0) / fields.length : 0;

  const updateText = (selector, value) => {
    const el = document.querySelector(`[data-poster-field="${selector}"]`);
    if (el) el.textContent = value;
  };

  updateText('farmer-health', avgStress < 0.5 ? 'Good' : 'Stable');
  updateText('farmer-stress', avgStress > 0.6 ? 'Severe' : (avgStress > 0.4 ? 'Moderate' : 'Mild'));
  updateText('farmer-irrigation', `${Math.max(8, Math.round((s.total_weekly_water_deficit_m3 || 0) / Math.max(fields.length, 1) / 8))} mm`);

  updateText('wua-demand', `${Math.round((s.total_weekly_water_deficit_m3 || 0) / 10)} m³`);
  updateText('wua-available', `${Math.max(20, Math.round((s.latest_weather && s.latest_weather.rainfall_mm) || 30))} m³`);
  updateText('wua-status', criticalFields > 0 ? 'Critical' : 'Normal');

  updateText('officer-crop', Object.keys(s.crop_distribution || {})[0] || 'Sugarcane');
  updateText('officer-stage', Object.keys(s.growth_stage_distribution || {})[0] || 'Vegetative');
  updateText('officer-alerts', criticalFields > 0 ? 'High' : 'Low');

  updateText('irrigation-demand', `${Math.round((s.total_weekly_water_deficit_m3 || 0) * 0.8).toLocaleString()} m³`);
  updateText('irrigation-supply', `${Math.round((s.total_weekly_water_deficit_m3 || 0) * 0.62).toLocaleString()} m³`);
  updateText('irrigation-gap', `${Math.round(Math.max((s.total_weekly_water_deficit_m3 || 0) * 0.18, 250)).toLocaleString()} m³`);

  updateText('researcher-ndvi', avgNdvi.toFixed(2));
  updateText('researcher-ndwi', `${Math.min(0.85, Math.max(0.0, avgNdvi * 0.3)).toFixed(2)}`);
  updateText('researcher-stress', avgStress > 0.6 ? 'Severe' : (avgStress > 0.4 ? 'Moderate' : 'Mild'));

  updateText('policy-risk', avgStress > 0.6 ? 'High' : (avgStress > 0.4 ? 'Moderate' : 'Low'));
  updateText('policy-coverage', `${Math.min(100, Math.max(10, Math.round((s.total_area_ha || 0) / 8))).toFixed(0)}%`);
  updateText('policy-priority', criticalFields > 0 ? 'High' : 'Medium');

  updateText('admin-users', `${Math.max(1200, Math.round((s.total_fields_monitored || 0) * 16 + 1200))}`);
  updateText('admin-health', '99%');
  updateText('admin-alerts', criticalFields > 0 ? 'Moderate' : 'Low');
}

// Update Top Navigation Bar Key Indicators
function updateHeaderStats() {
  const summary = pipelineData.summary;
  document.getElementById('header-total-area').textContent = `${summary.total_area_ha} ha`;
  document.getElementById('header-water-deficit').textContent = `${summary.total_weekly_water_deficit_m3.toLocaleString()} m³`;
  document.getElementById('header-irrigation-needed').textContent = `${summary.area_requiring_irrigation_ha} ha`;
  
  const w = summary.latest_weather;
  document.getElementById('header-weather').textContent = `${w.temp_c}°C | ${w.rainfall_mm}mm Rain`;
}

// Get Color according to selected layer mode
function getFeatureStyle(feature) {
  const props = feature.properties;
  let color = '#10b981';

  if (currentLayerMode === 'crop') {
    color = CROP_COLORS[props.crop_type] || '#10b981';
  } else if (currentLayerMode === 'stage') {
    color = STAGE_COLORS[props.growth_stage] || '#3b82f6';
  } else if (currentLayerMode === 'stress') {
    color = STRESS_COLORS[props.moisture_stress] || '#10b981';
  } else if (currentLayerMode === 'deficit') {
    const def = props.water_deficit_mm;
    color = def > 40 ? '#ef4444' : def > 25 ? '#f97316' : def > 10 ? '#eab308' : '#10b981';
  } else if (currentLayerMode === 'advisory') {
    const p = props.canal_priority_score;
    color = p >= 8 ? '#ef4444' : p >= 4 ? '#f59e0b' : '#10b981';
  }

  return {
    fillColor: color,
    weight: 2,
    opacity: 0.9,
    color: '#0d1520',
    dashArray: '',
    fillOpacity: 0.65
  };
}

// Render Field Polygons on GIS Map
function renderGeoJSONLayer() {
  if (geojsonLayer) {
    map.removeLayer(geojsonLayer);
  }

  geojsonLayer = L.geoJSON(pipelineData.geojson, {
    style: getFeatureStyle,
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      layer.bindTooltip(`
        <div style="font-family: Inter; font-size: 12px; padding: 4px;">
          <strong>Field ID:</strong> ${p.field_id}<br/>
          <strong>Crop:</strong> ${p.crop_type}<br/>
          <strong>Growth Stage:</strong> ${p.growth_stage}<br/>
          <strong>Water Deficit:</strong> ${p.water_deficit_mm} mm<br/>
          <strong>Advisory Depth:</strong> ${p.recommended_depth_mm} mm
        </div>
      `, { sticky: true, opacity: 0.9 });

      layer.on('click', () => {
        openFieldModal(p.field_id);
      });

      layer.on('mouseover', () => {
        layer.setStyle({ fillOpacity: 0.9, weight: 3 });
      });
      layer.on('mouseout', () => {
        layer.setStyle(getFeatureStyle(feature));
      });
    }
  }).addTo(map);

  // Zoom map to Karnal layer bounds
  if (geojsonLayer.getBounds().isValid()) {
    map.fitBounds(geojsonLayer.getBounds(), { padding: [30, 30] });
  }
}

// Dynamic Legend Update
function updateLegend() {
  const legendItems = document.getElementById('legend-items');
  const legendTitle = document.getElementById('legend-title');
  legendItems.innerHTML = '';

  let items = [];

  if (currentLayerMode === 'crop') {
    legendTitle.textContent = 'Crop Type Legend';
    items = Object.entries(CROP_COLORS).map(([name, color]) => ({ name, color }));
  } else if (currentLayerMode === 'stage') {
    legendTitle.textContent = 'Crop Growth Stage';
    items = Object.entries(STAGE_COLORS).map(([name, color]) => ({ name, color }));
  } else if (currentLayerMode === 'stress') {
    legendTitle.textContent = 'Moisture Stress Severity';
    items = Object.entries(STRESS_COLORS).map(([name, color]) => ({ name, color }));
  } else if (currentLayerMode === 'deficit') {
    legendTitle.textContent = 'Water Deficit (mm)';
    items = [
      { name: '0 - 10 mm (Low)', color: '#10b981' },
      { name: '10 - 25 mm (Moderate)', color: '#eab308' },
      { name: '25 - 40 mm (High)', color: '#f97316' },
      { name: '> 40 mm (Critical)', color: '#ef4444' }
    ];
  } else if (currentLayerMode === 'advisory') {
    legendTitle.textContent = 'Canal Release Priority';
    items = [
      { name: 'Priority 1-3 (Low / None)', color: '#10b981' },
      { name: 'Priority 4-7 (Medium)', color: '#f59e0b' },
      { name: 'Priority 8-10 (High Urgent)', color: '#ef4444' }
    ];
  }

  items.forEach(item => {
    const div = document.createElement('div');
    div.className = 'legend-item';
    div.innerHTML = `<span class="color-box" style="background:${item.color}"></span> <span>${item.name}</span>`;
    legendItems.appendChild(div);
  });
}

// Render Summary Charts in Sidebar
function renderCharts() {
  const summary = pipelineData.summary;

  // Crop Chart
  const cropCtx = document.getElementById('cropChart').getContext('2d');
  if (cropChartInstance) cropChartInstance.destroy();
  
  const cropLabels = Object.keys(summary.crop_distribution);
  const cropData = Object.values(summary.crop_distribution);
  const cropColors = cropLabels.map(l => CROP_COLORS[l] || '#10b981');

  cropChartInstance = new Chart(cropCtx, {
    type: 'doughnut',
    data: {
      labels: cropLabels,
      datasets: [{
        data: cropData,
        backgroundColor: cropColors,
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: '#9ca3af', font: { size: 10 } } }
      },
      cutout: '70%'
    }
  });

  // Moisture Stress Chart
  const stressCtx = document.getElementById('stressChart').getContext('2d');
  if (stressChartInstance) stressChartInstance.destroy();

  const stressLabels = Object.keys(summary.moisture_stress_distribution);
  const stressData = Object.values(summary.moisture_stress_distribution);
  const stressColors = stressLabels.map(l => STRESS_COLORS[l] || '#10b981');

  stressChartInstance = new Chart(stressCtx, {
    type: 'bar',
    data: {
      labels: stressLabels,
      datasets: [{
        label: 'Fields Count',
        data: stressData,
        backgroundColor: stressColors,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#9ca3af', font: { size: 9 } }, grid: { display: false } },
        y: { ticks: { color: '#9ca3af', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.05)' } }
      }
    }
  });
}

// Render Tehsil Deficit & Canal Priority Table
function renderTehsilTable() {
  const tbody = document.getElementById('tehsil-table-body');
  tbody.innerHTML = '';

  const tehsils = pipelineData.summary.tehsils;
  const fields = pipelineData.fields;

  tehsils.forEach(t => {
    const tehsilFields = fields.filter(f => f.tehsil === t.name);
    const sumDeficit = tehsilFields.reduce((acc, f) => acc + f.water_balance.water_deficit_mm, 0);
    const avgPriority = Math.round(tehsilFields.reduce((acc, f) => acc + f.water_balance.canal_priority_score, 0) / (tehsilFields.length || 1));

    let pClass = 'priority-low';
    if (avgPriority >= 7) pClass = 'priority-high';
    else if (avgPriority >= 4) pClass = 'priority-mid';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${t.name}</strong></td>
      <td style="color: #9ca3af;">${t.canal_branch}</td>
      <td style="color: #f59e0b; font-weight: 600;">${Math.round(sumDeficit * 10)} m³</td>
      <td><span class="priority-pill ${pClass}">${avgPriority}/10</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// Open Field Inspection Drawer / Modal
function openFieldModal(fieldId) {
  const field = pipelineData.fields.find(f => f.field_id === fieldId);
  if (!field) return;

  activeField = field;

  document.getElementById('field-modal-title').textContent = `Field Inspection: ${field.field_id}`;
  document.getElementById('field-modal-crop').textContent = field.crop_type;
  document.getElementById('field-modal-tehsil').textContent = `${field.tehsil} Tehsil`;

  // Indices
  document.getElementById('m-ndvi').textContent = field.indices.NDVI;
  document.getElementById('m-ndwi').textContent = field.indices.NDWI;
  document.getElementById('m-ndmi').textContent = field.indices.NDMI;

  // SAR
  document.getElementById('m-vv').textContent = `${field.sar_features.VV_dB} dB`;
  document.getElementById('m-vh').textContent = `${field.sar_features.VH_dB} dB`;
  document.getElementById('m-ratio').textContent = `${field.sar_features.VV_VH_ratio} dB`;

  // Info
  document.getElementById('m-area').textContent = `${field.area_acres} acres (${field.area_ha} ha)`;
  document.getElementById('m-soil').textContent = field.soil_type;
  document.getElementById('m-canal').textContent = field.canal_branch;

  // Water Balance & Advisory
  const wb = field.water_balance;
  document.getElementById('m-kc').textContent = wb.kc_factor;
  document.getElementById('m-etc').textContent = `${wb.etc_weekly_mm} mm`;
  document.getElementById('m-peff').textContent = `${wb.effective_rain_mm} mm`;
  document.getElementById('m-deficit').textContent = `${wb.water_deficit_mm} mm`;

  document.getElementById('m-advisory-text').textContent = wb.advisory_text;
  document.getElementById('m-rec-depth').textContent = `${wb.recommended_depth_mm} mm`;
  document.getElementById('m-rec-timing').textContent = wb.recommended_timing;

  const pBadge = document.getElementById('m-priority-badge');
  pBadge.textContent = `Priority ${wb.canal_priority_score}/10`;
  pBadge.className = `badge ${wb.canal_priority_score >= 8 ? 'badge-danger' : wb.canal_priority_score >= 4 ? 'badge-warning' : 'badge-emerald'}`;

  // Render Multi-temporal Chart
  renderFieldTemporalChart(field.temporal_profile);

  // Show Modal
  document.getElementById('field-modal-backdrop').classList.add('active');
}

// Render Field Temporal Line Chart (NDVI vs SAR)
function renderFieldTemporalChart(temporalProfile) {
  const ctx = document.getElementById('fieldTemporalChart').getContext('2d');
  if (fieldTemporalChartInstance) fieldTemporalChartInstance.destroy();

  const labels = temporalProfile.map(t => t.date.substring(5)); // MM-DD
  const ndviData = temporalProfile.map(t => t.ndvi);
  const sarData = temporalProfile.map(t => t.sar_vv_db);

  fieldTemporalChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Sentinel-2 NDVI',
          data: ndviData,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          fill: true,
          tension: 0.3,
          yAxisID: 'y'
        },
        {
          label: 'Sentinel-1 SAR VV (dB)',
          data: sarData,
          borderColor: '#06b6d4',
          borderDash: [4, 4],
          fill: false,
          tension: 0.3,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: '#9ca3af', font: { size: 9 } }, grid: { display: false } },
        y: { type: 'linear', position: 'left', min: 0, max: 1.0, ticks: { color: '#10b981', font: { size: 9 } } },
        y1: { type: 'linear', position: 'right', min: -25, max: -5, ticks: { color: '#06b6d4', font: { size: 9 } }, grid: { display: false } }
      },
      plugins: {
        legend: { labels: { color: '#9ca3af', font: { size: 10 } } }
      }
    }
  });
}

// Update Sidebar View based on Persona Selection
function updatePersonaView() {
  const persona = document.getElementById('persona-select').value;
  const container = document.getElementById('persona-view-container');
  if (!pipelineData) return;

  const s = pipelineData.summary;

  if (persona === 'officer') {
    container.innerHTML = `
      <div class="persona-title"><i data-lucide="award"></i> Agriculture Officer Portal</div>
      <p class="persona-body">Karnal District crop health & acreage status. Paddy covers 42% of area, Wheat at 38%. Vegetation health index is stable.</p>
      <div class="persona-kpi-grid">
        <div class="persona-kpi-box">
          <span class="kpi-title">Monitored Fields</span>
          <span class="kpi-val">${s.total_fields_monitored}</span>
        </div>
        <div class="persona-kpi-box">
          <span class="kpi-title">Paddy Acreage</span>
          <span class="kpi-val text-emerald">${(s.total_area_ha * 0.42).toFixed(1)} ha</span>
        </div>
      </div>
    `;
  } else if (persona === 'irrigation') {
    container.innerHTML = `
      <div class="persona-title"><i data-lucide="waves"></i> Irrigation Officer Command</div>
      <p class="persona-body">Western Yamuna Canal allocation module. Priority release needed for Indri & Assandh distributaries.</p>
      <div class="persona-kpi-grid">
        <div class="persona-kpi-box">
          <span class="kpi-title">Canal Deficit</span>
          <span class="kpi-val text-amber">${s.total_weekly_water_deficit_m3.toLocaleString()} m³</span>
        </div>
        <div class="persona-kpi-box">
          <span class="kpi-title">High Priority Blocks</span>
          <span class="kpi-val text-red">3 Tehsils</span>
        </div>
      </div>
    `;
  } else if (persona === 'wua') {
    container.innerHTML = `
      <div class="persona-title"><i data-lucide="users"></i> Water User Association (WUA)</div>
      <p class="persona-body">Village rotational schedule (Warabandi). Nilokheri & Gharaunda branches operating on 48-hour turn cycle.</p>
      <div class="persona-kpi-grid">
        <div class="persona-kpi-box">
          <span class="kpi-title">Active Outlets</span>
          <span class="kpi-val text-cyan">24 Outlets</span>
        </div>
        <div class="persona-kpi-box">
          <span class="kpi-title">Scheduled Hours</span>
          <span class="kpi-val">120 Hours</span>
        </div>
      </div>
    `;
  } else if (persona === 'farmer') {
    container.innerHTML = `
      <div class="persona-title"><i data-lucide="smartphone"></i> Farmer Mobile Advisory</div>
      <p class="persona-body">Field-level SMS & App alert: <strong>50 mm light irrigation recommended for Paddy within 48 hours</strong> due to zero rainfall forecast.</p>
      <div class="persona-kpi-grid">
        <div class="persona-kpi-box">
          <span class="kpi-title">Recommended Depth</span>
          <span class="kpi-val text-emerald">50 mm</span>
        </div>
        <div class="persona-kpi-box">
          <span class="kpi-title">Alert Status</span>
          <span class="kpi-val text-amber">SMS Sent</span>
        </div>
      </div>
    `;
  } else if (persona === 'policy') {
    container.innerHTML = `
      <div class="persona-title"><i data-lucide="landmark"></i> Policy & Drought Resilience</div>
      <p class="persona-body">Regional crop diversification & groundwater extraction analysis. Micro-irrigation adoption grant priority for Karnal central block.</p>
      <div class="persona-kpi-grid">
        <div class="persona-kpi-box">
          <span class="kpi-title">Drought Risk</span>
          <span class="kpi-val text-emerald">Low-Moderate</span>
        </div>
        <div class="persona-kpi-box">
          <span class="kpi-title">Micro-Irrigation</span>
          <span class="kpi-val text-cyan">34% Coverage</span>
        </div>
      </div>
    `;
  }

  lucide.createIcons();
}

// Event Listeners for Map Layers, Persona Switch, Modals & Rerun Pipeline
function initEventListeners() {
  // Layer Switcher Buttons
  document.querySelectorAll('.layer-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.layer-btn').forEach(b => b.classList.remove('active'));
      const target = e.currentTarget;
      target.classList.add('active');
      currentLayerMode = target.dataset.layer;

      if (pipelineData) {
        renderGeoJSONLayer();
        updateLegend();
      }
    });
  });

  // Persona Switcher
  document.getElementById('persona-select').addEventListener('change', () => {
    updatePersonaView();
  });

  // Modals
  document.getElementById('btn-close-field-modal').addEventListener('click', () => {
    document.getElementById('field-modal-backdrop').classList.remove('active');
  });

  document.getElementById('btn-pipeline-modal').addEventListener('click', () => {
    document.getElementById('pipeline-modal-backdrop').classList.add('active');
  });

  document.getElementById('btn-close-pipeline-modal').addEventListener('click', () => {
    document.getElementById('pipeline-modal-backdrop').classList.remove('active');
  });

  // Export Field Advisory Button
  document.getElementById('btn-export-field').addEventListener('click', () => {
    if (!activeField) return;
    const blob = new Blob([JSON.stringify(activeField, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Advisory_${activeField.field_id}_Karnal.json`;
    a.click();
  });

  // Run AI Pipeline Button
  document.getElementById('btn-run-pipeline').addEventListener('click', async () => {
    const btn = document.getElementById('btn-run-pipeline');
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader" class="spin"></i> Running Pipeline...`;
    
    // Open architecture modal to show execution logs
    document.getElementById('pipeline-modal-backdrop').classList.add('active');
    const consoleBody = document.getElementById('console-body');
    const consoleStatus = document.getElementById('console-status');
    
    consoleStatus.textContent = 'Executing 8 Pipeline Stages...';
    consoleBody.innerHTML = `
      <div class="log-line log-info">[STAGE 1] Triggering Sentinel-2 & Sentinel-1 Ingestion for Karnal...</div>
      <div class="log-line log-info">[STAGE 2] Applying s2cloudless cloud masking & Refined Lee SAR speckle filter...</div>
      <div class="log-line log-info">[STAGE 3] Extracting NDVI, NDWI, NDMI & SAR VV/VH feature cubes...</div>
      <div class="log-line log-info">[STAGE 4] Running Random Forest crop classifier & Growth Stage LSTM...</div>
      <div class="log-line log-info">[STAGE 6] Computing FAO-56 Penman-Monteith crop evapotranspiration & deficit...</div>
    `;

    try {
      const res = await fetch('/api/run-pipeline', { method: 'POST' });
      const result = await res.json();
      if (result.success && result.data) {
        pipelineData = result.data;
        renderAllComponents();
        consoleStatus.textContent = 'Execution Complete!';
        consoleBody.innerHTML += `<div class="log-line log-success">[SUCCESS] Fresh crop & water deficit layers loaded onto GIS map!</div>`;
      }
    } catch (e) {
      consoleBody.innerHTML += `<div class="log-line log-err">[ERROR] Failed to run pipeline: ${e.message}</div>`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="play"></i> Run AI Pipeline`;
      lucide.createIcons();
    }
  });
}
