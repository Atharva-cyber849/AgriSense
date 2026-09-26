"""Build the public AgriFieldNet snapshot from completed experiment outputs.

Standard library only. Run from any directory; raw field records stay out of
the dashboard bundle. Fail rather than combine inconsistent result files.
"""
from pathlib import Path
from collections import defaultdict
import csv
import hashlib
import json
import math
import shutil
import statistics

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'AgriFieldNet' / 'agrifieldnet_final_outputs'
DEST = ROOT / 'data' / 'agrifieldnet'
used = set()
METRICS = ['accuracy', 'balanced_accuracy', 'macro_precision', 'macro_recall',
           'macro_f1', 'weighted_f1', 'kappa', 'mcc']
LABELS = {
    'A0_S2_static': 'Static optical · S2',
    'A1_S2_temporal': 'Temporal optical · S2',
    'A2_S1_temporal': 'Temporal radar · S1',
    'A3_S1_S2_temporal': 'Temporal fusion · S1 + S2',
    'A4_temporal_descriptors': 'Temporal descriptors',
    'A3_S1_S2_sequence': 'Deep temporal fusion',
}


def rows(name):
    used.add(name)
    with (SOURCE / name).open(encoding='utf-8-sig', newline='') as handle:
        return list(csv.DictReader(handle))


def number(value):
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f'Non-finite result: {value}')
    return result


def check(condition, message):
    if not condition:
        raise ValueError(message)


def build():
    manifest = json.loads((SOURCE / 'run_manifest.json').read_text(encoding='utf-8'))
    used.add('run_manifest.json')
    # Do not publish workstation paths, GPU identity or other local runtime details.
    manifest = {key: manifest[key] for key in (
        'run_profile', 'rows', 'unique_fields', 'unique_periods', 'classes',
        'validation_mode', 'n_folds', 'found_periodic_batches',
        'found_observation_batches', 'missing_periodic_batches',
        'missing_observation_batches')}
    classes = manifest['classes']
    class_idx = {name: i for i, name in enumerate(classes)}
    support = [{'crop': r['crop_type'], 'fields': int(r['fields'])}
               for r in rows('class_support.csv')]
    check(sum(r['fields'] for r in support) == manifest['unique_fields'], 'Class support mismatch')
    check(manifest['rows'] == manifest['unique_fields'] * manifest['unique_periods'], 'Panel size mismatch')
    expected_support = {r['crop']: r['fields'] for r in support}
    records = rows('model_leaderboard_oof.csv')
    deep = rows('deep_model_metrics.csv')
    records += [r for r in deep if r['fold'] == 'OOF']
    fold_rows = rows('model_metrics_all_folds.csv') + deep
    folds = defaultdict(list)
    for r in fold_rows:
        if r['fold'] != 'OOF':
            folds[(r['feature_set'], r['model'])].append(r)
    models = []
    for r in records:
        key = (r['feature_set'], r['model'])
        check(r['fold'] == 'OOF', f'Non-OOF leaderboard row: {key}')
        check(r['validation_mode'] == manifest['validation_mode'], f'Validation mismatch: {key}')
        check(len(folds[key]) == manifest['n_folds'], f'Incomplete folds: {key}')
        models.append({
            'feature_set': key[0], 'model': key[1],
            **{m: number(r[m]) for m in METRICS},
            'folds': [{'fold': int(f['fold']), **{m: number(f[m]) for m in METRICS}}
                      for f in sorted(folds[key], key=lambda f: int(f['fold']))],
            'confusion': [[0] * len(classes) for _ in classes],
        })
    by_key = {(r['feature_set'], r['model']): r for r in models}
    check(len(by_key) == len(models), 'Duplicate models')
    seen = defaultdict(set)
    fold_fields = defaultdict(set)
    for filename in ('model_oof_predictions.csv', 'deep_model_oof_predictions.csv'):
        used.add(filename)
        with (SOURCE / filename).open(encoding='utf-8-sig', newline='') as handle:
            for r in csv.DictReader(handle):
                key = (r['feature_set'], r['model'])
                check(r['field_id'] not in seen[key], f'Duplicate OOF field: {key}')
                seen[key].add(r['field_id'])
                fold_fields[(key, int(r['fold']))].add(r['field_id'])
                by_key[key]['confusion'][class_idx[r['y_true']]][class_idx[r['y_pred']]] += 1
    for key, model in by_key.items():
        check(len(seen[key]) == manifest['unique_fields'], f'Incomplete OOF predictions: {key}')
        matrix = model['confusion']
        per_class = []
        for i, label in enumerate(classes):
            total = sum(matrix[i])
            check(total == expected_support[label], f'OOF class support mismatch: {key}/{label}')
            correct = matrix[i][i]
            predicted = sum(row[i] for row in matrix)
            precision = correct / predicted if predicted else 0
            recall = correct / total if total else 0
            f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0
            per_class.append({'crop': label, 'precision': precision, 'recall': recall,
                              'f1': f1, 'support': total})
        recomputed = {
            'accuracy': sum(matrix[i][i] for i in range(len(classes))) / manifest['unique_fields'],
            'macro_f1': statistics.mean(c['f1'] for c in per_class),
            'macro_precision': statistics.mean(c['precision'] for c in per_class),
            'macro_recall': statistics.mean(c['recall'] for c in per_class),
            'weighted_f1': sum(c['f1'] * c['support'] for c in per_class) / manifest['unique_fields'],
        }
        for metric, value in recomputed.items():
            check(math.isclose(value, model[metric], abs_tol=1e-9), f'{metric} disagrees with OOF predictions: {key}')
        model['per_class'] = per_class
        for f in model['folds']:
            f['fields'] = len(fold_fields[(key, f['fold'])])
    leaders = []
    for feature_set in LABELS:
        candidates = [r for r in models if r['feature_set'] == feature_set]
        check(bool(candidates), f'Missing feature set {feature_set}')
        best = max(candidates, key=lambda r: r['macro_f1'])
        leaders.append({'feature_set': feature_set, 'model': best['model']})
    for r in rows('sensor_ablation_leaders.csv'):
        best = next(x for x in leaders if x['feature_set'] == r['feature_set'])
        check(r['model'] == best['model'], 'Ablation leader mismatch')
        check(math.isclose(number(r['macro_f1']), by_key[(r['feature_set'], r['model'])]['macro_f1'], abs_tol=1e-9), 'Ablation score mismatch')
    robust = defaultdict(list)
    for r in rows('optical_gap_robustness.csv'):
        robust[(r['feature_set'], r['model'], r['scenario'])].append(number(r['macro_f1']))
    robustness = [{'feature_set': k[0], 'model': k[1], 'scenario': k[2],
                   'mean': statistics.mean(v), 'std': statistics.stdev(v) if len(v) > 1 else None,
                   'repeats': len(v)} for k, v in robust.items()]
    coverage = [{k: int(r[k]) if k in ('period_index', 'fields') else number(r[k])
                 for k in r} for r in rows('period_sensor_coverage.csv')]
    check(len(coverage) == manifest['unique_periods'], 'Sensor coverage period mismatch')
    importance = defaultdict(list)
    for r in rows('fusion_permutation_importance_quick.csv'):
        importance[r['feature']].append(number(r['importance_mean']))
    check(all(len(v) == manifest['n_folds'] for v in importance.values()), 'Importance fold mismatch')
    importance = sorted([{'feature': k, 'mean': statistics.mean(v), 'fold_std': statistics.stdev(v)}
                         for k, v in importance.items()], key=lambda r: abs(r['mean']), reverse=True)
    missingness = [{'feature': r[''], 'fraction': number(r['missing_fraction'])}
                   for r in rows('feature_missingness.csv')]
    consistency = [{k: r[k] if k == 'sensor' else int(r[k]) for k in r}
                   for r in rows('observation_template_consistency.csv')]
    # Copy only compact public evidence, never the multi-megabyte field-level data.
    downloads = ['model_leaderboard_oof.csv', 'deep_model_metrics.csv', 'class_support.csv',
                 'sensor_ablation_leaders.csv', 'optical_gap_robustness.csv',
                 'period_sensor_coverage.csv', 'fusion_permutation_importance_quick.csv']
    figures = sorted(p.name for p in SOURCE.glob('*.png'))
    (DEST / 'source').mkdir(parents=True, exist_ok=True)
    (DEST / 'plots').mkdir(exist_ok=True)
    for name in downloads:
        shutil.copy2(SOURCE / name, DEST / 'source' / name)
    for name in figures:
        used.add(name)
        shutil.copy2(SOURCE / name, DEST / 'plots' / name)
    provenance = [{'file': name, 'sha256': hashlib.sha256((SOURCE / name).read_bytes()).hexdigest()}
                  for name in sorted(used)]
    payload = {'schema_version': 1, 'source_directory': 'AgriFieldNet/agrifieldnet_final_outputs',
               'manifest': manifest, 'feature_labels': LABELS, 'models': models,
               'leaders': leaders, 'class_support': support, 'robustness': robustness,
               'coverage': coverage, 'importance': importance, 'missingness': missingness,
               'consistency': consistency, 'downloads': downloads, 'figures': figures,
               'provenance': provenance,
               'validation': {'models_reconciled_against_oof': len(models),
                              'predictions_checked': sum(len(v) for v in seen.values())}}
    (DEST / 'dashboard.json').write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n', encoding='utf-8')
    print(f'Built {len(models)} models; reconciled {payload["validation"]["predictions_checked"]:,} OOF predictions.')
    print(f'Dashboard snapshot: {DEST / "dashboard.json"}')


if __name__ == '__main__':
    build()
