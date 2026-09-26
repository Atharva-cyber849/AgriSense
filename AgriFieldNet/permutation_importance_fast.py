# ---------- Bounded permutation importance for the A3 fusion leader ----------
# Full permutation of 400+ features × many repeats is one of the slowest cells.
# This version keeps the evaluation fold-local but bounds repetitions/sample count.

# Fast exploratory estimates; use False for the original paper sampling budget.
# All original features and validation folds are retained.
from threadpoolctl import threadpool_limits
IMPORTANCE_QUICK = True
importance_repeats = min(2, P['importance_repeats']) if IMPORTANCE_QUICK else P['importance_repeats']
importance_samples = min(400, P['importance_max_samples']) if IMPORTANCE_QUICK else P['importance_max_samples']
importance_threads = min(4, CPU_THREADS)

rank=leaderboard[leaderboard['feature_set']=='A3_S1_S2_temporal']

if RUN_PERMUTATION_IMPORTANCE and not rank.empty:
    leader_name=rank.iloc[0]['model']
    Xdf=FEATURE_SETS['A3_S1_S2_temporal'].astype(np.float32)
    imp_rows=[]

    print(
        'Permutation importance leader:', leader_name,
        '| repeats:', importance_repeats,
        '| max_samples:', importance_samples,
        '| quick exploratory estimate:', IMPORTANCE_QUICK,
        flush=True
    )

    for fold,(tr,te) in enumerate(folds):
        t0=time.time()
        model=make_pipeline(clone(MODELS[leader_name]))
        print(f'Fold {fold + 1}/{len(folds)}: fitting {leader_name}...', flush=True)
        with threadpool_limits(limits=importance_threads):
            model.fit(Xdf.iloc[tr],y[tr])
        print(f'  Fit finished in {time.time()-t0:.1f}s; starting '
              f'{Xdf.shape[1] * importance_repeats} permutation scores...', flush=True)

        # Avoid process copies and nested model/OpenMP parallelism on Windows.
        pi_jobs = 1

        max_samples = min(importance_samples, len(te))

        rng = np.random.RandomState(RANDOM_STATE + fold)
        eval_idx = rng.choice(te, size=max_samples, replace=False)
        X_eval, y_eval = Xdf.iloc[eval_idx], y[eval_idx]
        with threadpool_limits(limits=importance_threads):
            pi=permutation_importance(
                model,
                X_eval,
                y_eval,
                scoring='f1_macro',
                n_repeats=importance_repeats,
                random_state=RANDOM_STATE + fold,
                n_jobs=pi_jobs,
                max_samples=1.0
            )

        for f,mn,sd in zip(Xdf.columns,pi.importances_mean,pi.importances_std):
            imp_rows.append({
                'fold':fold,
                'feature':f,
                'importance_mean':mn,
                'importance_std':sd
            })

        print(' fold',fold,'time=',round(time.time()-t0,1),'s', flush=True)
        del model, pi
        gc.collect()

    imp=pd.DataFrame(imp_rows)
    imp_avg=(
        imp.groupby('feature')['importance_mean']
        .mean()
        .sort_values(ascending=False)
    )

    display(imp_avg.head(30).to_frame())
    importance_suffix = '_quick' if IMPORTANCE_QUICK else ''
    imp.to_csv(OUT/f'fusion_permutation_importance{importance_suffix}.csv',index=False)

    agg={}
    for feat,val in imp_avg.items():
        base=feat.split('__p')[0]
        agg[base]=agg.get(base,0)+max(float(val),0)

    agg=pd.Series(agg).sort_values(ascending=False).head(20)

    fig,ax=plt.subplots(figsize=(9,7))
    agg.sort_values().plot.barh(ax=ax)
    ax.set_xlabel('Aggregated positive permutation importance')
    ax.set_title(f'A3 fusion leader — {leader_name}')
    plt.tight_layout()
    plt.savefig(OUT/f'05_fusion_feature_importance{importance_suffix}.png',dpi=180)
    plt.show()
else:
    print('Permutation importance disabled or no A3 leader available.')
