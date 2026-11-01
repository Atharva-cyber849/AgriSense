# AgriSense — Changes Before Competition

Nov 1, 2026 · @Blaze

## Summary

AgriSense rates about 7/10 for competitions today; these changes should bring it to about 8.5. The two P0 fixes remove the weaknesses a sharp judge would attack first: model scores that come from circular labels, and a stress map that treats bare soil as a stressed crop. The P1 and P2 items tighten the story and add the one thing the project lacks: a measured impact number.

Assessed against the live site ([agrisenseirrigation.netlify.app](https://agrisenseirrigation.netlify.app/)) and the repo ([Atharva-cyber849/AgriSense](https://github.com/Atharva-cyber849/AgriSense)) at commit ae5278f (12 Oct 2026).

**Keep as is:** the REAL / DERIVED / PROTOTYPE provenance badges, the AgriFieldNet spatial-validation study (macro-F1 0.391, accuracy 73.3%, 5,551 fields), the Haridwar cloud-gap result (macro-F1 0.424 for radar+optical vs 0.267 for optical alone at 60% masking), the 10-language interface and the passing tests (16 of 16).

## P0 — Critical fixes

### 1. Replace the circular 100% model scores

**Problem.** In `pipeline/karnal_gee_pipeline.js` (lines \~275–279) the labels are thresholds on the same features the models train on: crop = `NDVI > 0.65 ? Paddy : Unclassified`, growth stage = NDVI cut-offs at 0.25 and 0.55, stress = `1 − NDMI` cut-offs at 0.45 and 0.7. Random Forest and XGBoost then score 100% because they relearn those if-statements. The "AI Model Evaluation" panel shows these numbers first, so "how did you get 100%?" is the likeliest judge question.

**Change.**

- Train the crop engine on AgriFieldNet's real field labels and run it on Karnal; show its spatial-validation score (macro-F1 0.391, accuracy 73.3%) as the crop engine's real performance.
- Remove the 2-class Paddy/Unclassified confusion matrices from the main panel, or move them under a collapsed "rule-consistency check" with one line explaining they only confirm the rules were learned.
- Keep the phenology LSTM result (80.9%, 5 classes) but state that its labels come from NDVI trajectories.
- Pitch line: "We report honest, held-out metrics, not 100% on our own labels."

**Files.** `pipeline/karnal_gee_pipeline.js`, `pipeline/ai_models.py`, `pipeline/inference_service.py`, `private_models/`, the model-evaluation panel in `app.js`.

### 2. Fix the stress and fallow logic, and the demo date

**Problem.** On the 1 June 2025 view, 4,286 of 4,311 points (99.4%) are "Severe Stress" and 4,109 (95.3%) are "Unclassified". Stress is `1 − NDMI`, so bare or pre-sowing soil reads as a crop under severe water stress, and the system advises irrigating fallow land. There is no "no/mild stress" class in the data at all.

**Change.**

- Mask non-crop pixels: NDVI below about 0.2 → "No crop / fallow — no advisory".
- Compute stress only on cropped pixels; scale it within the crop's expected range for its stage, and keep the mild-stress class.
- Open the demo on a date with a real canopy (late August–September for kharif paddy), or switch the demo to the rabi wheat season.
- Make the field card's numbers agree: one timing window, and an irrigation depth that matches the shown net deficit.

**Files.** `pipeline/karnal_gee_pipeline.js`, `pipeline/build_master_demo.py`, `data/periods/*.json`, `app.js`.

## P1 — Credibility fixes

### 3. Call sample points what they are

The 4,311 map points are random Earth Engine sample pixels (`GEE-PIXEL-xxxx`), but the interface calls them fields. Either rename them "sample points" in the UI, or move to real parcel polygons (AgriFieldNet already provides field boundaries) and aggregate indices per parcel. Parcels are the stronger option because advisories are given per field.

### 4. Make "Run AI Pipeline" honest

Clicking it only changes the button to "Rebuild Demo Data" and replays precomputed files. Rename it "Replay season", or wire it to the FastAPI inference service so it returns a fresh prediction for one field. Before judging, wake the Render backend (it is slow on the first request) and check `/api/health` and `/api/inference/health`.

### 5. Remove contradictions in the static sample card

The page's built-in sample field (KRN-FLD-101) says both "within 48 hours" and "within 2–3 days", and recommends 50 mm against a 33.2 mm weekly net deficit. Pick one window and make the depth follow from the deficit. Also fill or hide the KPI tiles and tehsil table that show empty before the data loads.

**Files.** `index.html`, `app.js`, `server.js`, `render.yaml`.

## P1 — One storyline

### 6. Tie the four modules into one argument

The site covers four separate study areas: Karnal, Haridwar, AgriFieldNet and US soil-moisture stations. Judges reward one problem, one user, one result. Give each module a single job in the pitch:

1. **Karnal operational demo:** the product. It is the landing page and the live demo.
2. **Haridwar cloud-gap result:** the proof that radar matters during monsoon cloud cover (0.424 vs 0.267 macro-F1).
3. **AgriFieldNet study:** the evidence that the crop model works on real labels.
4. **Policy simulator (item 7):** the impact number.

Move the US soil-moisture page (NOAA USCRN, USDA SCAN, Colorado sunflower trials) to an appendix link or drop it from the competition build. If you keep it, frame its Kalman filter as the state estimator that fills gaps between satellite passes, not as a separate product.

**Files.** `index.html` navigation, `soil-moisture.html`, the pitch deck.

## P2 — New feature: irrigation policy simulator

### 7. Measure the advisory's impact in simulation

This borrows the core of Kaggle's Kaggriculture game: an agent keeps crops watered under limited resources and is scored over a whole season. It gives AgriSense the impact number it lacks. Borrow only that; leave out the game's market prices, animals, hiring and land buying.

| Kaggriculture | AgriSense equivalent |
| --- | --- |
| Crop dies after 2 unwatered days | Root-zone depletion past the safe limit → stress → yield loss (FAO-56 water balance, FAO-33 yield response) |
| Extra farm hands cost more each time | Limited canal water per rotation; each extra delivery costs more |
| Two players share one market | Head- and tail-end farmers share one distributary release |
| Agent scored over many seasons | Advisory scored over many years of Karnal weather |
| Replay viewer | The existing 19-period map slider |

**Build steps.**

1. Write `pipeline/policy_sim.py`. Each field tracks root-zone depletion per period. Inputs: ETo, rainfall, crop coefficient and soil water capacity. Action: 0, 25, 50 or 75 mm. Score: simulated relative yield (yield loss = Ky × water shortfall; Ky about 1.0 for wheat) minus water used.
2. Get multi-year weather: pull past seasons of ERA5-Land through Earth Engine, since the pipeline only has 2025.
3. Compare policies on the same seasons: a fixed farmer schedule, the current FAO-56 rule, and a budget-constrained allocation that gives water where it saves the most yield per mm. Add a reinforcement-learning agent only if it beats that allocation.
4. Add the shared-water case for the Irrigation Officer and WUA views: one distributary, a fixed release, and tail-end stress days as a fairness measure.
5. Add a "Policy comparison" panel showing water used, simulated yield, stressed fields and tail-end stress days per policy, and replay the chosen season on the map slider.

Start with wheat: its yield response is well established, it connects to the Haridwar wheat work, and rabi sowing is under way.

**Pitch line (from the run):** "Across 20 seasons of Karnal weather, with 70% of normal canal water, our allocation uses 15% less water than a fixed schedule, raises simulated relative yield by 11 points and cuts tail-end stress days by 54%." Present it as a simulation result, not measured field savings.

**Files.** New `pipeline/policy_sim.py`, `pipeline/karnal_gee_pipeline.js` (weather export), `app.js` (panel), `data/`.

## P2 — Repo hygiene

### 8. Add a README and clean the root

Judges often open GitHub before the demo. Right now the repo has no top-level README, weighs 317 MB, and its root mixes code with .docx, .pdf, .zip and .csv files.

- Add `README.md` with the live link, a one-paragraph problem statement, an architecture diagram, a results table (the honest metrics from items 1 and 7), how to run it, and the team.
- Move reports into `docs/`, datasets into `data/`, and large zips (`haridwar_outputs.zip`, AgriFieldNet outputs) into a GitHub Release or Git LFS.
- Merge the three `README_*_INTEGRATION.md` files into `docs/`.
- Rename `private_models/` to `models/`: the repo is public, so the name is misleading.
- Fix `.gitignore`: line 2 is missing a newline (`data/**/*.parquetnode_modules/`), so neither pattern works.

## Checklist

Effort is a rough estimate for one person; do P0 first.

| # | Change | Priority | Effort | Status |
| --- | --- | --- | --- | --- |
| 1 | Replace circular 100% model scores with real-label metrics | P0 | 1–2 days | Partly done: real metrics shown, circular models retired. Not run on Karnal: needs a Nov–May export |
| 2 | Mask fallow land, fix stress classes, change demo date | P0 | 1 day | Done |
| 3 | Rename fields to sample points, or switch to parcels | P1 | 2 hours (rename) / 2 days (parcels) | Done (rename). Parcels not possible: AgriFieldNet has no Karnal boundaries |
| 4 | Make "Run AI Pipeline" honest; wake backend before judging | P1 | Half a day | Done in code. Backend still to wake: inference returned 503 on 1 Nov |
| 5 | Remove contradictions in the sample field card and empty tiles | P1 | 2 hours | Done |
| 6 | One storyline; move soil-moisture page to an appendix | P1 | Half a day | Done in the site and README. No pitch deck in the repo |
| 7 | Irrigation policy simulator and comparison panel | P2 | 2–3 days | Done for wheat. Replay is in the panel, not the map slider |
| 8 | README and repo cleanup | P2 | Half a day | Mostly done. Zips need uploading to a Release; add teammates to README |
