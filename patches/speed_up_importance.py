from pathlib import Path
import ast
import json
import shutil
import nbformat

path = Path('AgriFieldNet/AgriFieldNet_Local_Jupyter.ipynb')
raw = json.loads(path.read_text(encoding='utf-8'))
cell = raw['cells'][27]
source = ''.join(cell['source'])
assert source.startswith('# ---------- Bounded permutation importance')
source = source.replace(
    "rank=leaderboard",
    "# Fast exploratory estimates; use False for the original paper sampling budget.\n"
    "# All original features and validation folds are retained.\n"
    "from threadpoolctl import threadpool_limits\n"
    "IMPORTANCE_QUICK = True\n"
    "importance_repeats = min(2, P['importance_repeats']) if IMPORTANCE_QUICK else P['importance_repeats']\n"
    "importance_samples = min(400, P['importance_max_samples']) if IMPORTANCE_QUICK else P['importance_max_samples']\n"
    "importance_threads = min(4, CPU_THREADS)\n\n"
    "rank=leaderboard", 1)
source = source.replace("P['importance_repeats'],", "importance_repeats,")
source = source.replace("'| max_samples:', P['importance_max_samples']", "'| max_samples:', importance_samples,\n        '| quick exploratory estimate:', IMPORTANCE_QUICK,\n        flush=True")
source = source.replace(
    "        model.fit(Xdf.iloc[tr],y[tr])",
    "        print(f'Fold {fold + 1}/{len(folds)}: fitting {leader_name}...', flush=True)\n"
    "        with threadpool_limits(limits=importance_threads):\n"
    "            model.fit(Xdf.iloc[tr],y[tr])\n"
    "        print(f'  Fit finished in {time.time()-t0:.1f}s; starting '\n"
    "              f'{Xdf.shape[1] * importance_repeats} permutation scores...', flush=True)")
source = source.replace(
    "        # GPU estimators should not be called concurrently from multiple joblib workers.\n"
    "        pi_jobs = 1 if (GPU_AVAILABLE and leader_name in ['XGBoost','CatBoost']) else CPU_THREADS",
    "        # Avoid process copies and nested model/OpenMP parallelism on Windows.\n"
    "        pi_jobs = 1")
source = source.replace("min(P['importance_max_samples'], len(te))", "min(importance_samples, len(te))")
start = source.index('        pi=permutation_importance(')
end = source.index('\n\n        for f,mn,sd', start)
block = source[start:end]
# Sample once so baseline and permuted scores use the same validation rows.
block = block.replace('Xdf.iloc[te],', 'X_eval,').replace('y[te],', 'y_eval,')
block = block.replace('max_samples=max_samples', 'max_samples=1.0')
source = source[:start] + (
    "        rng = np.random.RandomState(RANDOM_STATE + fold)\n"
    "        eval_idx = rng.choice(te, size=max_samples, replace=False)\n"
    "        X_eval, y_eval = Xdf.iloc[eval_idx], y[eval_idx]\n"
    "        with threadpool_limits(limits=importance_threads):\n"
    + '\n'.join('    ' + line for line in block.splitlines())
) + source[end:]
source = source.replace("        print(' fold',fold,'time=',round(time.time()-t0,1),'s')",
    "        print(' fold',fold,'time=',round(time.time()-t0,1),'s', flush=True)")
source = source.replace("    imp.to_csv(OUT/'fusion_permutation_importance.csv',index=False)",
    "    importance_suffix = '_quick' if IMPORTANCE_QUICK else ''\n"
    "    imp.to_csv(OUT/f'fusion_permutation_importance{importance_suffix}.csv',index=False)")
source = source.replace("OUT/'05_fusion_feature_importance.png'", "OUT/f'05_fusion_feature_importance{importance_suffix}.png'")
ast.parse(source)
backup = path.with_suffix('.before_importance_fix.ipynb')
if not backup.exists():
    shutil.copy2(path, backup)
cell['source'] = source.splitlines(keepends=True)
cell['outputs'] = []
cell['execution_count'] = None
nbformat.validate(nbformat.from_dict(raw))
path.write_text(json.dumps(raw, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
path.with_name('permutation_importance_fast.py').write_text(source, encoding='utf-8')
print('Updated cell 27; backup and standalone replacement cell saved.')
