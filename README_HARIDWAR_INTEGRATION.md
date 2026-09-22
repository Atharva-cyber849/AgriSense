# AgriSense — Haridwar Research Dashboard Update

This package adds the uploaded Haridwar results to the existing AgriSense
repository without replacing the Karnal operational dashboard.

## What the Haridwar page contains

The page is based only on the uploaded `haridwar_outputs.zip`.

### Overview
- 2 wheat seasons: 2023-24 and 2024-25
- 68 Sentinel-2/Sentinel-1 fusion-calendar rows
- 59 labelled model rows
- 20 published stage anchors
- 101 Sentinel-1 track observations
- natural optical-gap summaries

### Phenology
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

### Model analysis
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

### Cloud robustness
- natural cloud-gap summary
- optical masking robustness
- fusion vs optical-only degradation
- fusion Random Forest permutation feature importance

### Research output gallery
The actual PNG outputs from the uploaded Haridwar analysis are displayed
directly in the app.

## Scientific scope

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

# Files to copy into the repository

Extract this ZIP at the AgriSense repository root:

```text
haridwar.html
haridwar.css
haridwar.js

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
app.js
server.js
styles.css
pipeline/
private_models/
```

The Haridwar dashboard uses static JSON/PNG data, so it works with both the
current Express deployment and a static Netlify deployment.

---

# Add the Haridwar button to the existing Karnal page

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

# Test locally

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

# Recommended commit

```bash
git add index.html haridwar.html haridwar.css haridwar.js data/haridwar
git commit -m "Add Haridwar wheat phenology research dashboard"
git push
```

You do not have to commit the `patches/` directory after `index.html` has been
updated.

---

# Key current Haridwar results shown in the dashboard

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
