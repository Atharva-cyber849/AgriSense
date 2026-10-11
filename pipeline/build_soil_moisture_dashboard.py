"""Build AgriSense's bounded soil-moisture snapshot from supplied research archives.

Never executes the notebook or extracts archive paths. Requires numpy and pandas.
See SOIL_MOISTURE.md for invocation and validation boundaries.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import zipfile

import numpy as np
import pandas as pd

EXPECTED_EVIDENCE = '508c7330a78ee0a29c4e0d0ac6500ab338d9fa3dbac2246b9febdef094d96bb3'
METRICS = ['RMSE', 'MAE', 'Brier_raw', 'Brier_cal', 'coverage_cal', 'width_cal', 'outside_mass']
KEYS = ['fold', 'station', 'family', 'horizon']


def average_precision_score(labels, probabilities):
    """Non-interpolated AP, grouping ties at each distinct score threshold."""
    order = np.argsort(-np.asarray(probabilities), kind='stable')
    scores = np.asarray(probabilities)[order]
    y = np.asarray(labels, dtype=int)[order]
    ends = np.r_[np.flatnonzero(np.diff(scores)), len(y) - 1]
    positives = np.cumsum(y)[ends]
    recall = positives / y.sum()
    precision = positives / (ends + 1)
    return float(np.sum(np.diff(np.r_[0, recall]) * precision))


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def reconcile(actual, expected, keys, columns):
    assert not actual.duplicated(keys).any(), keys
    assert not expected.duplicated(keys).any(), keys
    merged = actual.merge(expected, on=keys, suffixes=('_a', '_b'), how='outer', indicator=True)
    assert merged['_merge'].eq('both').all(), 'Missing reconciliation keys'
    for col in columns:
        np.testing.assert_allclose(merged[col + '_a'], merged[col + '_b'], atol=1e-9, rtol=1e-7, equal_nan=True, err_msg=col)


def daily_metrics(pred, truth):
    assert not pred.duplicated(['fold', 'station', 'origin', 'horizon', 'family']).any()
    assert pred.groupby(['fold', 'station', 'origin', 'horizon']).family.nunique().eq(10).all()
    assert ((pd.to_datetime(pred.target_date) - pd.to_datetime(pred.origin)).dt.days == pred.horizon).all()
    actual = truth.set_index(['station', 'date']).sm20.reindex(pd.MultiIndex.from_frame(pred[['station', 'target_date']])).to_numpy()
    np.testing.assert_allclose(pred.observed, actual, atol=1e-10, rtol=1e-10)
    assert np.isfinite(pred[['observed', 'prediction', 'p_low', 'p_cal', 'lower_cal', 'upper_cal']]).all().all()
    assert pred.p_low.between(0, 1).all() and pred.p_cal.between(0, 1).all()
    assert (pred.lower_cal <= pred.upper_cal).all()
    rows = []
    for key, g in pred.groupby(KEYS):
        e = g.prediction - g.observed
        event = g.observed < g.threshold
        rows.append(dict(zip(KEYS, key), n=len(g), RMSE=np.sqrt(np.mean(e ** 2)), MAE=np.mean(abs(e)),
            Brier_raw=np.mean((g.p_low - event) ** 2), Brier_cal=np.mean((g.p_cal - event) ** 2),
            coverage_cal=np.mean((g.observed >= g.lower_cal) & (g.observed <= g.upper_cal)),
            width_cal=np.mean(g.upper_cal - g.lower_cal), outside_mass=g.outside_mass.mean(),
            events=int(event.sum()), both_classes=event.nunique() == 2,
            AP=average_precision_score(event, g.p_low) if event.nunique() == 2 else np.nan))
    return pd.DataFrame(rows)


def bootstrap(pred, network):
    chosen = pred[(pred.horizon == 3) & pred.selected_family]
    base = pred[(pred.horizon == 3) & pred.family.eq('Persistence')]
    q = chosen.merge(base[['fold', 'station', 'target_date', 'prediction']], on=['fold', 'station', 'target_date'], suffixes=('', '_base'), validate='one_to_one')
    assert len(q) == len(base)
    q['delta'] = abs(q.prediction - q.observed) - abs(q.prediction_base - q.observed)
    q['target_date'] = pd.to_datetime(q.target_date)
    arrays = {(s, y): g.set_index('target_date').delta.sort_index().asfreq('D').to_numpy() for (s, y), g in q.groupby(['station', 'test_year'])}
    sites = sorted(q.station.unique())
    point = q.groupby(['station', 'test_year']).delta.mean().mean()
    rows = []
    for block in [7, 14, 30, 60]:
        rng = np.random.default_rng(42 + block)
        replicates = []
        for _ in range(300):
            values = []
            for site in rng.choice(sites, len(sites), replace=True):
                for (s, year), a in arrays.items():
                    if site != s:
                        continue
                    starts = rng.integers(0, len(a), size=int(np.ceil(len(a) / block)))
                    sample = np.concatenate([a[(np.arange(block) + i) % len(a)] for i in starts])[:len(a)]
                    values.append(np.nanmean(sample))
            replicates.append(np.mean(values))
        rows.append(dict(network=network, block_days=block, delta_MAE=point,
                         lower95=np.quantile(replicates, .025), upper95=np.quantile(replicates, .975), stations=len(sites)))
    return pd.DataFrame(rows)


def build(evidence_path, outputs_path, notebook_path, destination):
    evidence_raw = evidence_path.read_bytes()
    assert digest(evidence_raw) == EXPECTED_EVIDENCE, 'Unexpected evidence archive'
    evidence = zipfile.ZipFile(io.BytesIO(evidence_raw))
    outputs = zipfile.ZipFile(outputs_path)
    provenance = json.loads(evidence.read('provenance.json'))
    verified = []
    for item in provenance['tables']:
        raw = evidence.read(item['file'])
        assert digest(raw) == item['sha256'], item['file']
        verified.append(dict(file=item['file'], sha256=item['sha256']))
    notebook = json.loads(notebook_path.read_text(encoding='utf-8'))
    assert EXPECTED_EVIDENCE in ''.join(notebook['cells'][6]['source'])
    source_hashes = []

    def read(name):
        return pd.read_csv(io.BytesIO(evidence.read(name)))

    def exported(name):
        return pd.read_csv(io.BytesIO(outputs.read(name)))

    destination.mkdir(parents=True, exist_ok=True)
    source = destination / 'source'
    source.mkdir(exist_ok=True)
    data = {'schema_version': 1}

    def save(name, frame, origin):
        raw = frame.to_csv(index=False, float_format='%.15g').encode()
        (source / name).write_bytes(raw)
        source_hashes.append(dict(file=name, rows=len(frame), sha256=digest(raw), origin=origin))
        return json.loads(frame.to_json(orient='records', double_precision=15))

    daily, checks, support, boots, datasets, selections, splits = [], [], [], [], [], [], []
    for label, prefix, observations in [('NOAA', 'noaa', 'noaa/canonical_observations.csv'),
        ('SCAN', 'scan_benchmark', 'scan_benchmark/canonical_scan_observations.csv'),
        ('Climate transfer', 'scan_climate_cluster_transfer', 'scan_benchmark/canonical_scan_observations.csv')]:
        truth = read(observations)
        assert not truth.duplicated(['station', 'date']).any()
        pred = read(prefix + '/predictions.csv')
        met = daily_metrics(pred, truth)
        reconcile(met, read(prefix + '/metrics.csv'), KEYS, METRICS[:6])
        manifest = json.loads(evidence.read(prefix + '/split_manifest.json'))
        for split in manifest:
            assert split['held'] not in split['fit_sites']
            assert split['fit_end'] < split['cal_start'] <= split['cal_end'] < split['test_start']
            rows = pred[pred.fold.eq(split['fold'])]
            assert rows.station.eq(split['held']).all()
            assert rows.target_date.between(split['test_start'], split['test_end']).all()
            splits.append(dict(network=label, **split))
        macro = met.groupby(['family', 'horizon'])[METRICS].mean().reset_index()
        checks.append(dict(dataset=label, prediction_rows=len(pred), groups=len(met), metric_reconciliation='passed', target_reconciliation='passed'))
        if label == 'Climate transfer':
            reconcile(macro, exported('climate_macro.csv'), ['family', 'horizon'], ['RMSE', 'MAE', 'coverage_cal'])
            data['climate'] = save('climate_macro.csv', macro, prefix + '/predictions.csv')
        else:
            daily.append(macro.assign(network=label))
            support.append(met[met.family.eq('Persistence')][KEYS + ['n', 'events', 'both_classes']].assign(network=label))
            boots.append(bootstrap(pred, label))
            choices = read(prefix + '/choices.csv')
            selected = choices[choices.selected_family]
            assert not selected.duplicated('fold').any() and len(selected) == len(manifest)
            selections.append(selected[['fold', 'family', 'inner_RMSE']].assign(network=label))
            datasets.append(dict(network=label, stations=truth.station.nunique(), daily_rows=len(truth), start=truth.date.min(), end=truth.date.max(), test_years=sorted(pred.test_year.unique().tolist()), folds=len(manifest)))
    daily = pd.concat(daily, ignore_index=True)
    reconcile(daily, exported('daily_macro.csv'), ['network', 'family', 'horizon'], METRICS)
    data['daily'] = save('daily_macro.csv', daily, 'NOAA and SCAN predictions; equal station-year means')
    data['daily_support'] = save('daily_event_support.csv', pd.concat(support), 'Recomputed original training-threshold event counts; Persistence rows only')
    boot = pd.concat(boots)
    reconcile(boot, exported('bootstrap.csv'), ['network', 'block_days'], ['delta_MAE', 'lower95', 'upper95'])
    data['bootstrap'] = save('bootstrap.csv', boot, 'Recomputed selected-pipeline minus persistence MAE; station resampling and circular day blocks; 300 replicates; seed 42 + block length')
    data['selections'] = save('selected_models.csv', pd.concat(selections), 'Archived inner-validation choices')
    data['datasets'] = datasets
    data['splits'] = splits

    robust, ablations = [], []
    for label, prefix in [('NOAA', 'noaa'), ('SCAN', 'scan_benchmark')]:
        frame = read(prefix + '/robustness.csv')
        frame = frame[frame.horizon.eq(3)].groupby(['family', 'scenario'])[['RMSE', 'MAE']].mean().reset_index().assign(network=label)
        clean = daily[daily.network.eq(label) & daily.horizon.eq(3)][['family', 'RMSE', 'MAE', 'network']].assign(scenario='clean')
        robust.extend([frame, clean])
        frame = read(prefix + '/ablations.csv')
        ablations.append(frame[frame.horizon.eq(3)].groupby(['family', 'scenario'])[['RMSE', 'MAE']].mean().reset_index().assign(network=label))
    for key, frames in [('robustness', robust), ('ablations', ablations)]:
        frame = pd.concat(frames, ignore_index=True)
        reconcile(frame, exported(key + '.csv'), ['network', 'family', 'scenario'], ['RMSE', 'MAE'])
        data[key] = save(key + '.csv', frame, 'Archived per-fold scores, equal station-year means; corrupted row-level predictions not supplied')

    soil = read('scan_paw_normalized/scan_soil_hydraulics.csv')
    assert len(soil) == 5 and soil.source.eq('USDA SSURGO/SDA').all()
    paw = read('scan_paw_normalized/predictions.csv')
    assert set(paw.station) == set(soil.station)
    limits = soil.set_index('station')
    cutoff = limits.theta_wp + .3 * (limits.theta_fc - limits.theta_wp)
    np.testing.assert_allclose(paw.threshold, paw.station.map(cutoff), atol=1e-10, rtol=1e-8)
    met = daily_metrics(paw, read('scan_benchmark/canonical_scan_observations.csv'))
    events = met[KEYS + ['n', 'events', 'both_classes', 'Brier_raw', 'AP']].rename(columns={'Brier_raw': 'Brier'})
    reconcile(events, exported('soil_event_metrics.csv'), KEYS, ['n', 'events', 'Brier', 'AP'])
    data['events'] = save('soil_event_metrics.csv', events, 'Five direct-soil sites; raw probabilities only; event r < 0.30; AP null for single-class folds')
    checks.append(dict(dataset='Soil-normalized events', prediction_rows=len(paw), groups=len(events), metric_reconciliation='passed', target_reconciliation='passed'))
    soil['event_cutoff'] = soil.station.map(cutoff)
    data['soil'] = save('soil_thresholds.csv', soil[['station', 'theta_wp', 'theta_fc', 'event_cutoff']], 'USDA SSURGO 0-30 cm retention estimates from supplied evidence')

    sf = read('sunflower_irregular_pgm/predictions.csv')
    assert not sf.duplicated(['fold', 'family', 'start_date', 'end_date']).any()
    assert sf.interval_days.between(1, 60).all()
    assert ((pd.to_datetime(sf.end_date) - pd.to_datetime(sf.start_date)).dt.days == sf.interval_days).all()
    rows = []
    for (fold, family), g in sf.groupby(['fold', 'family']):
        e = g.prediction - g.observed
        rows.append(dict(fold=fold, family=family, test_year=int(g.test_year.iloc[0]), held_treatment=int(g.held_treatment.iloc[0]), n=len(g),
            RMSE=np.sqrt(np.mean(e**2)), MAE=np.mean(abs(e)), coverage90=np.mean((g.observed >= g.lower90_cal) & (g.observed <= g.upper90_cal)), interval_width=np.mean(g.upper90_cal - g.lower90_cal)))
    sf_metrics = pd.DataFrame(rows)
    for expected in [read('sunflower_irregular_pgm/metrics.csv'), exported('sunflower_metrics.csv')]:
        reconcile(sf_metrics, expected, ['fold', 'family'], ['n', 'RMSE', 'MAE', 'coverage90', 'interval_width'])
    data['sunflower'] = save('sunflower_metrics.csv', sf_metrics, 'Recomputed archived endpoint predictions; equal treatment-year macro means in UI')
    checks.append(dict(dataset='Sunflower', prediction_rows=len(sf), groups=len(sf_metrics), metric_reconciliation='passed', target_reconciliation='Not independently reconciled to raw depth measurements'))

    # Publish an explicit small allowlist, never archive-controlled paths or HTML.
    for name in ['dbn_A.csv', 'dbn_Q.csv', 'worked_probabilities.csv']:
        raw = outputs.read(name)
        (source / name).write_bytes(raw)
        source_hashes.append(dict(file=name, sha256=digest(raw), origin='Supplied fitted representative NOAA model output; not refitted here'))
    methods = '\n\n'.join(''.join(c['source']) for i, c in enumerate(notebook['cells']) if i in [0, 1, 7, 11, 14, 17, 20, 23, 26, 29, 32, 35, 38, 41, 43, 50, 54, 56, 58, 60, 62, 68, 71])
    (source / 'study-methods.md').write_text(methods, encoding='utf-8')
    (source / 'archived-verification.json').write_bytes(outputs.read('verification.json'))
    data['validation'] = dict(checks=checks, total_prediction_rows=sum(c['prediction_rows'] for c in checks), verified_evidence_tables=len(verified), model_refits='Not rerun during web integration. Supplied notebook records representative daily refits and full sunflower refits.', robustness='Reaggregated archived fold scores; corrupted predictions are not archived.')
    data['provenance'] = dict(inputs=[dict(file=p.name, sha256=digest(p.read_bytes())) for p in [evidence_path, outputs_path, notebook_path]], evidence_tables=verified, published_sources=source_hashes, method='Build script recomputes metrics and bootstrap from supplied predictions. No model fitting or external data retrieval.', units='Volumetric soil moisture in m³/m³; probabilities and coverage in [0,1].', classification='Historical measured observations and archived model predictions; no synthetic observations.')
    (source / 'integration-validation.json').write_text(json.dumps(data['validation'], indent=2), encoding='utf-8')
    (source / 'provenance.json').write_text(json.dumps(data['provenance'], indent=2), encoding='utf-8')
    (destination / 'dashboard.json').write_text(json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(',', ':')), encoding='utf-8')
    print(json.dumps(data['validation'], indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--outputs', type=Path, required=True)
    parser.add_argument('--notebook', type=Path, required=True)
    parser.add_argument('--destination', type=Path, default=Path(__file__).resolve().parents[1] / 'data' / 'soil-moisture')
    args = parser.parse_args()
    build(args.evidence, args.outputs, args.notebook, args.destination)
