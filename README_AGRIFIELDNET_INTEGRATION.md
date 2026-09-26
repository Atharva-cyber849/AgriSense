# AgriFieldNet research in AgriSense

Open `/agrifieldnet.html` on the existing AgriSense server (`npm start`).
The Karnal and Haridwar headers both link to this page. The page uses local
HTML, CSS, JavaScript and a generated JSON snapshot, with no extra frontend
dependencies or external chart services. It also works on the existing static host.

## Included results

- 5,551 fields, 13 crops, 21 ten-day periods, four spatial validation folds.
- All 80 classical model/feature-set combinations and three deep models.
- Sensor ablation, class distribution, sensor coverage and missingness.
- Searchable/sortable model results, per-crop metrics, per-fold results,
  confusion matrices in field counts or row percentages, and filtered CSV export.
- Random and consecutive optical-gap experiments with mean macro-F1 and
  sample standard deviation across masking repeats (not confidence intervals).
- Signed, individual-feature quick permutation importance and original figures.
- Downloadable compact source CSVs and source SHA-256 hashes in the snapshot.

## Refresh from notebook results

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
