# Soil moisture research in AgriSense

Open `soil-moisture.html` from any dashboard. It is a static research explorer,
using AgriSense's existing styles and saved language preference. Navigation and
the historical-research notice support ten Indian languages and English. Technical study
results retain English, as on the existing research pages. Automatic language is
English for this US study. No farmer inference or advisory API is changed.

## Rebuild the snapshot

Use Python with NumPy and pandas in an isolated environment. Supply the three
original user files; they are not bundled into the public site:

```sh
python pipeline/build_soil_moisture_dashboard.py --evidence /path/to/Soil_Moisture_PGM_Final_Evidence.zip --outputs /path/to/Soil_Moisture_PGM_Submission_Outputs.zip --notebook /path/to/notebook.ipynb
```

The builder checks the exact evidence archive SHA-256 and all 38 manifested
tables. It reads bounded paths without extracting or executing notebook/HTML
content. It writes `data/soil-moisture/dashboard.json` and inspectable CSV/JSON
sources. No runtime network data provider or training dependency is required.

## Verification and interpretation

- Recomputes daily NOAA/SCAN/climate scores, soil-event probabilities and
  sunflower endpoint scores from 426,752 archived prediction rows, reconciling
  1,296 metric groups and the exported tables. Counts include each model and
  protocol; they are not counts of unique observations.
- Reconciles daily and soil-event targets with canonical station observations;
  verifies daily horizon offsets, unique model/origin keys, expected families,
  valid probability/interval values, and chronological station holdout splits.
- Recomputes all eight selected-pipeline bootstrap results using station-cluster
  resampling and 300 circular-block replicates with the notebook seeds.
- Reaggregates archived robustness/ablation fold metrics. Corrupted predictions
  were not archived, so their individual errors cannot be recomputed.
- Sunflower scores are recomputed from archived predictions, not independently
  reconstructed from raw depth measurements. The model uses already-realized
  weather and irrigation. Equal treatment-year means are intentional; never
  pool or weight these reported macro scores by interval count.
- Model fitting is not rerun. `archived-verification.json` contains the original
  notebook's recorded refit checks, separate from `integration-validation.json`.
- Soil event AP stays null for single-class groups. Raw probabilities and direct
  SSURGO sites only; no proxy site or shared probability calibration is used.
- NOAA/SCAN and protocol results remain separate. Research estimates do not
  establish live Indian field moisture, crop stress, causal irrigation effects,
  yield gains or water savings.

UI changes have no build step. Tests:

```sh
npm run check:soil-moisture
node --test tests/*.test.js
npm run test:soil-moisture:browser
```

Browser checks require Playwright and Microsoft Edge. `PLAYWRIGHT_MODULE` can
point to an existing Playwright install; `SOIL_TEST_BASE_URL` optionally tests a
deployed site. They exercise filters, comparisons, CSV export, saved language,
source downloads, mobile overflow and the load-failure/retry state.
