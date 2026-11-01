# Integration notes

## AgriSense Persistent AI Inference Layer

### Replace
- js/app.js
- server.js

### Add
- pipeline/inference_service.py
- pipeline/requirements_inference.txt
- models/README.md
- scripts/start_agrisense_with_ai.bat

### Copy from AI_Model_Artifacts into models/
- crop_engine__random_forest.joblib
- crop_type_label_encoder.joblib
- stress_engine__xgboost.joblib
- moisture_stress_label_encoder.joblib
- phenology_lstm.keras
- phenology_lstm_imputer.joblib
- phenology_lstm_scaler.joblib
- phenology_lstm_label_encoder.joblib
- phenology_lstm_metadata.json

Keep:
- data/karnal_real_temporal_table.csv

### Install
pip install -r pipeline/requirements_inference.txt
npm install

### Start
npm start

The Node server auto-starts the Python service on port 8001.

### Check
http://localhost:3000/api/inference/health
http://localhost:3000/api/inference/models

Expected health values once artifacts are copied:
- crop_ready: true
- phenology_ready: true
- stress_ready: true
- field_count: 4311
- period_count: 10

### UI
Agriculture Officer:
- sees detailed Crop RF / Phenology LSTM / Stress XGBoost output in field modal.

Farmer:
- sees simplified AI Field Assessment on the two assigned demo plots.

Irrigation Officer / WUA:
- live model card remains hidden so those interfaces stay water-focused.

### Important
The service genuinely runs the serialized trained artifacts. It does not reuse the old
hard-coded display labels. Current crop/stress targets and LSTM phenology targets are
still prototype/derived labels, so keep the existing validation disclaimer.

## AgriSense — Haridwar Research Dashboard Update

This package adds the uploaded Haridwar results to the existing AgriSense
repository without replacing the Karnal operational dashboard.

### What the Haridwar page contains

The page is based only on the uploaded `haridwar_outputs.zip`.

#### Overview
- 2 wheat seasons: 2023-24 and 2024-25
- 68 Sentinel-2/Sentinel-1 fusion-calendar rows
- 59 labelled model rows
- 20 published stage anchors
- 101 Sentinel-1 track observations
- natural optical-gap summaries

#### Phenology
- raw Sentinel-2 NDVI
- Whittaker-smoothed NDVI
- published growth-stage anchors
- 5 grouped phenology classes:
  - Establishment
  - Vegetative
  - Reproductive
  - Grain Filling
  - Senescence/Harvest
- transition-date evaluation for Whittaker and Double Logistic methods

#### Model analysis
- S2-only models
- S1-only models
- S1+S2 fusion models
- leave-one-season-out out-of-fold metrics
- selected best model for each feature set
- confusion matrices
- per-season metrics

Current best LOSO models by macro-F1:
- S1+S2 Fusion: Random Forest
- S2 Only: RBF SVM
- S1 Only: Random Forest

#### Cloud robustness
- natural cloud-gap summary
- optical masking robustness
- fusion vs optical-only degradation
- fusion Random Forest permutation feature importance

#### Research output gallery
The actual PNG outputs from the uploaded Haridwar analysis are displayed
directly in the app.

### Scientific scope

The uploaded Haridwar outputs support:

- wheat phenology analysis
- S1/S2 feature fusion
- model evaluation
- transition-date analysis
- cloud-gap robustness

They do NOT contain Haridwar weather/soil/water-balance/irrigation-advisory
outputs. The Haridwar page therefore does not fabricate a water-deficit or
irrigation recommendation.

This is intentionally different from Karnal, where the current app has an
8-day weather/water-balance demonstration.

---

## Files to copy into the repository

Extract this ZIP at the AgriSense repository root:

```text
haridwar.html
css/haridwar.css
js/haridwar.js

data/
└── haridwar/
    ├── haridwar_dashboard.json
    ├── plots/
    └── source/

patches/
├── add-haridwar-link.patch
└── apply_haridwar_link.py
```

No changes are required to:

```text
js/app.js
server.js
css/styles.css
pipeline/
models/
```

The Haridwar dashboard uses static JSON/PNG data, so it works with both the
current Express deployment and a static Netlify deployment.

---

## Add the Haridwar button to the existing Karnal page

After extracting the ZIP into the repo root, run:

```bash
python patches/apply_haridwar_link.py
```

This makes one small change to the existing `index.html`:

```html
<a class="btn btn-outline" href="haridwar.html">
  <i data-lucide="flask-conical"></i> Haridwar Research
</a>
```

Alternatively:

```bash
git apply patches/add-haridwar-link.patch
```

Use only ONE of those two methods.

---

## Test locally

```bash
npm start
```

Open Karnal:

```text
http://localhost:3000/
```

Click:

```text
Haridwar Research
```

or open directly:

```text
http://localhost:3000/haridwar.html
```

The Haridwar page has a `Karnal Operational Demo` button to return to the main
dashboard.

---

## Recommended commit

```bash
git add index.html haridwar.html css/haridwar.css js/haridwar.js data/haridwar
git commit -m "Add Haridwar wheat phenology research dashboard"
git push
```

You do not have to commit the `patches/` directory after `index.html` has been
updated.

---

## Key current Haridwar results shown in the dashboard

The dashboard reports values from the uploaded analysis rather than substituting
Karnal results.

- Best S1+S2 fusion LOSO model: Random Forest
  - Accuracy: about 64.4%
  - Balanced accuracy: about 50.4%
  - Macro-F1: about 0.493
- Best S2-only LOSO model: RBF SVM
  - Accuracy: about 55.9%
  - Macro-F1: about 0.461
- Best S1-only LOSO model: Random Forest
  - Accuracy: about 64.4%
  - Macro-F1: about 0.429
- Optical usability:
  - Wheat 2023-24: about 60.5%, longest missing run about 30 days
  - Wheat 2024-25: about 73.3%, longest missing run about 10 days
- At 60% additional optical masking:
  - S1+S2 fusion Random Forest mean macro-F1 remains about 0.424
  - S2-only RBF-SVM mean macro-F1 falls to about 0.267

The five-stage dataset is imbalanced, especially Senescence/Harvest, so the UI
shows macro metrics and confusion matrices rather than relying on accuracy alone.

## AgriFieldNet research in AgriSense

Open `/agrifieldnet.html` on the existing AgriSense server (`npm start`).
The Karnal and Haridwar headers both link to this page. The page uses local
HTML, CSS, JavaScript and a generated JSON snapshot, with no extra frontend
dependencies or external chart services. It also works on the existing static host.

### Included results

- 5,551 fields, 13 crops, 21 ten-day periods, four spatial validation folds.
- All 80 classical model/feature-set combinations and three deep models.
- Sensor ablation, class distribution, sensor coverage and missingness.
- Searchable/sortable model results, per-crop metrics, per-fold results,
  confusion matrices in field counts or row percentages, and filtered CSV export.
- Random and consecutive optical-gap experiments with mean macro-F1 and
  sample standard deviation across masking repeats (not confidence intervals).
- Signed, individual-feature quick permutation importance and original figures.
- Downloadable compact source CSVs and source SHA-256 hashes in the snapshot.

### Refresh from notebook results

After the notebook has finished saving a consistent set of output files:

```shell
npm run build:agrifieldnet
npm run check:agrifieldnet
```

The builder uses Python's standard library only. Its input directory is
`AgriFieldNet/agrifieldnet_final_outputs`; it generates `data/agrifieldnet`.
It checks uniqueness/completeness of out-of-fold field coverage and recalculates
accuracy, macro-F1, macro precision, macro recall and weighted F1 from all
460,733 predictions. It also reconciles class support and ablation leaders.
Inconsistent metric/prediction outputs stop the build before publishing a new
snapshot. Workstation paths and hardware details are omitted. Field-level
prediction records are aggregated into confusion counts rather than copied.

The training/evaluation run uses the paper profile. Permutation importance
uses the separately labeled quick run (two repeats, up to 400 validation fields
per fold); it must not be interpreted as full-budget importance. The importance
view ranks individual features by absolute mean signed importance across folds,
whereas the original saved figure aggregates positive contributions by base feature.

The fusion leader (HistGradientBoosting) has 0.390976 pooled OOF macro-F1 and
73.3021% accuracy. Per-crop scores expose substantial imbalance, including zero
F1 for Coriander and Green pea. Leaders are selected on these same OOF results;
this is model comparison, not a separate untouched final-test estimate. Sensor
leader comparisons also change model families, so do not isolate a causal sensor
effect. Synthetic missingness experiments mask test-time S2 signals; they are
distinct from observed sensor coverage.

No inference endpoint, live field map, irrigation advice or trained-model
deployment is implied by these evaluation outputs. No backend changes are
required. Rebuild and include `data/agrifieldnet` along with the three page files
when deploying the repository.

