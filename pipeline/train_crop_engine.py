"""
Train the crop engine on AgriFieldNet's real field labels.

Scores come from the same spatial folds as the AgriFieldNet study, restricted to
bands the Karnal pipeline also exports. The model is NOT applied to the current
Karnal table: AgriFieldNet covers rabi (Nov-May) and that table covers kharif
(Jun-Oct), so its time steps have no matching input. Applying it needs a Karnal
Nov-May export with the columns in FEATURE_BANDS.
"""
from __future__ import annotations

import glob
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "AgriFieldNet" / "data"
OUTPUTS = ROOT / "AgriFieldNet" / "agrifieldnet_final_outputs"
MODEL_PATH = ROOT / "models" / "crop_engine_agrifieldnet.joblib"
METRICS_PATH = ROOT / "data" / "crop_engine_metrics.json"

# LSWI uses the same bands as Karnal's NDMI (B8, B11).
FEATURE_BANDS = ["B2", "B3", "B4", "B8", "B11", "B12", "NDVI", "EVI", "LSWI", "VV", "VH"]
PERIODS = 21


def load_features():
    columns = [
        "field_id", "crop_type", "period_index",
        "B2", "B3", "B4", "B8", "B11", "B12", "NDVI", "EVI", "LSWI",
        "S1A_VV", "S1D_VV", "S1A_VH", "S1D_VH",
    ]
    frames = [
        pd.read_csv(path, usecols=columns)
        for path in sorted(glob.glob(str(SOURCE / "agrifieldnet_periodic_features_batch*.csv")))
    ]
    df = pd.concat(frames, ignore_index=True).dropna(subset=["period_index"])
    df["VV"] = df[["S1A_VV", "S1D_VV"]].mean(axis=1)
    df["VH"] = df[["S1A_VH", "S1D_VH"]].mean(axis=1)
    df["period_index"] = df["period_index"].astype(int)
    wide = df.pivot_table(index="field_id", columns="period_index", values=FEATURE_BANDS)
    wide.columns = [f"{band}_{period:02d}" for band, period in wide.columns]
    labels = df.drop_duplicates("field_id").set_index("field_id")["crop_type"]
    return wide, labels.loc[wide.index]


def study_folds():
    """Reuse the study's spatial-grid folds so the scores are directly comparable."""
    usecols = ["field_id", "feature_set", "model", "fold"]
    oof = pd.read_csv(OUTPUTS / "model_oof_predictions.csv", usecols=usecols)
    first = oof[(oof["feature_set"] == oof["feature_set"].iloc[0]) & (oof["model"] == oof["model"].iloc[0])]
    return first.drop_duplicates("field_id").set_index("field_id")["fold"]


def new_model():
    return RandomForestClassifier(
        n_estimators=400,
        min_samples_leaf=2,
        class_weight="balanced_subsample",
        n_jobs=-1,
        random_state=42,
    )


def research_leader():
    board = pd.read_csv(OUTPUTS / "model_leaderboard_oof.csv")
    board = board[~board["model"].str.contains("Dummy")]
    best = board.sort_values("macro_f1", ascending=False).iloc[0]
    baseline = pd.read_csv(OUTPUTS / "model_leaderboard_oof.csv")
    baseline = baseline[baseline["model"].str.contains("Dummy")].iloc[0]
    return {
        "feature_set": str(best["feature_set"]),
        "model": str(best["model"]),
        "macro_f1": round(float(best["macro_f1"]), 3),
        "accuracy": round(float(best["accuracy"]), 3),
        "baseline_macro_f1": round(float(baseline["macro_f1"]), 3),
        "baseline_accuracy": round(float(baseline["accuracy"]), 3),
    }


def main():
    X, y = load_features()
    folds = study_folds().reindex(X.index)
    keep = folds.notna()
    X, y, folds = X[keep], y[keep], folds[keep].astype(int)
    classes = sorted(y.unique())

    predicted = pd.Series(index=X.index, dtype=object)
    for fold in sorted(folds.unique()):
        test = folds == fold
        model = new_model().fit(X[~test], y[~test])
        predicted[test] = model.predict(X[test])
        print(f"fold {fold}: macro-F1 {f1_score(y[test], predicted[test], average='macro'):.3f}")

    per_class = f1_score(y, predicted, labels=classes, average=None, zero_division=0)
    final = new_model().fit(X, y)
    MODEL_PATH.parent.mkdir(exist_ok=True)
    joblib.dump(
        {"model": final, "features": list(X.columns), "classes": classes},
        MODEL_PATH,
        compress=3,
    )

    leader = research_leader()
    payload = {
        "label_source": "AgriFieldNet field labels (real, independent of the input features)",
        "validation": "spatial_grid_stratified_group, 4 folds, out-of-fold predictions",
        "fields": int(len(y)),
        "training_window": "2021-11-01 to 2022-05-29 (rabi)",
        "applied_to_karnal": False,
        "not_applied_reason": (
            "The Karnal table covers Jun-Oct (kharif) and the model is trained on Nov-May (rabi). "
            "Running it needs a Karnal Nov-May export."
        ),
        "research_leader": leader,
        "deployable_model": {
            "model": "Random Forest",
            "feature_set": "Bands shared with the Karnal export: " + ", ".join(FEATURE_BANDS),
            "macro_f1": round(float(f1_score(y, predicted, average="macro")), 3),
            "accuracy": round(float(accuracy_score(y, predicted)), 3),
            "classes": classes,
            "per_class_f1": {c: round(float(v), 3) for c, v in zip(classes, per_class)},
            "class_support": {c: int((y == c).sum()) for c in classes},
            "confusion_matrix": confusion_matrix(y, predicted, labels=classes).tolist(),
        },
    }
    METRICS_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps({k: payload[k] for k in ("fields", "research_leader")}, indent=2))
    print("deployable macro-F1", payload["deployable_model"]["macro_f1"], "accuracy", payload["deployable_model"]["accuracy"])


if __name__ == "__main__":
    main()
