from __future__ import annotations

import os
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = Path(os.getenv("AGRISENSE_MODEL_DIR", str(ROOT / "private_models")))
TEMPORAL_CSV = Path(
    os.getenv(
        "AGRISENSE_TEMPORAL_CSV",
        str(ROOT / "data" / "karnal_real_temporal_table.csv"),
    )
)

HOST = os.getenv("AGRISENSE_INFERENCE_HOST", "127.0.0.1")
PORT = int(os.getenv("AGRISENSE_INFERENCE_PORT", "8001"))

SNAPSHOT_FEATURES = [
    "EVI", "NDMI", "NDVI", "NDWI", "SAVI",
    "VV", "VH", "VV_VH_ratio_dB",
]

DEFAULT_LSTM_FEATURES = [
    "NDVI", "NDMI", "NDWI", "EVI", "SAVI",
    "VV", "VH", "VV_VH_ratio_dB",
    "optical_valid", "sar_valid", "season_day",
]


def finite_or_none(value: Any):
    try:
        x = float(value)
    except (TypeError, ValueError):
        return None
    return x if np.isfinite(x) else None


class ModelRegistry:
    def __init__(self):
        self.crop_model = None
        self.crop_encoder = None
        self.stress_model = None
        self.stress_model_name = None
        self.stress_encoder = None
        self.lstm_model = None
        self.lstm_imputer = None
        self.lstm_scaler = None
        self.lstm_encoder = None
        self.lstm_metadata = {}
        self.temporal = None
        self.temporal_groups = {}
        self.season_start = None
        self.loaded_paths = {}
        self.missing = []
        self.load_errors = []

    def _find(self, *candidates):
        for name in candidates:
            p = MODEL_DIR / name
            if p.exists():
                return p
        for name in candidates:
            matches = list(MODEL_DIR.rglob(name))
            if matches:
                return matches[0]
        return None

    def _joblib(self, key, *candidates):
        for name in candidates:
            p = self._find(name)
            if not p:
                continue
            try:
                value = joblib.load(p)
            except Exception as exc:
                self.load_errors.append(f"{key} ({name}): {exc}")
                continue
            self.loaded_paths[key] = str(p)
            return value

        self.missing.append(f"{key}: {', '.join(candidates)}")
        return None

    def load(self):
        MODEL_DIR.mkdir(parents=True, exist_ok=True)

        self.crop_model = self._joblib(
            "crop_model", "crop_engine__random_forest.joblib"
        )
        self.crop_encoder = self._joblib(
            "crop_encoder", "crop_type_label_encoder.joblib"
        )

        self.stress_model = self._joblib(
            "stress_model",
            "stress_engine__xgboost.joblib",
            "stress_engine__random_forest.joblib",
            "stress_engine__logistic_regression.joblib",
        )
        stress_path = self.loaded_paths.get("stress_model", "")
        if "random_forest" in stress_path:
            self.stress_model_name = "Random Forest"
        elif "logistic_regression" in stress_path:
            self.stress_model_name = "Logistic Regression"
        elif "xgboost" in stress_path:
            self.stress_model_name = "XGBoost"
        self.stress_encoder = self._joblib(
            "stress_encoder", "moisture_stress_label_encoder.joblib"
        )

        self.lstm_imputer = self._joblib(
            "lstm_imputer", "phenology_lstm_imputer.joblib"
        )
        self.lstm_scaler = self._joblib(
            "lstm_scaler", "phenology_lstm_scaler.joblib"
        )
        self.lstm_encoder = self._joblib(
            "lstm_encoder", "phenology_lstm_label_encoder.joblib"
        )

        meta = self._find("phenology_lstm_metadata.json")
        if meta:
            self.loaded_paths["lstm_metadata"] = str(meta)
            self.lstm_metadata = json.loads(meta.read_text(encoding="utf-8"))
        else:
            self.missing.append("lstm_metadata: phenology_lstm_metadata.json")

        keras_path = self._find("phenology_lstm.keras")
        if keras_path:
            import tensorflow as tf
            self.loaded_paths["lstm_model"] = str(keras_path)
            self.lstm_model = tf.keras.models.load_model(
                keras_path, compile=False
            )
        else:
            self.missing.append("lstm_model: phenology_lstm.keras")

        self._load_temporal()

    def _load_temporal(self):
        if not TEMPORAL_CSV.exists():
            self.missing.append(f"temporal_csv: {TEMPORAL_CSV}")
            return

        df = pd.read_csv(TEMPORAL_CSV)
        required = {
            "field_id", "period_start",
            "NDVI", "NDMI", "NDWI", "EVI", "SAVI", "VV", "VH",
        }
        missing = sorted(required - set(df.columns))
        if missing:
            self.missing.append(f"temporal columns: {missing}")
            return

        df["period_start"] = pd.to_datetime(df["period_start"], errors="coerce")

        for col in [
            "NDVI", "NDMI", "NDWI", "EVI", "SAVI",
            "VV", "VH", "optical_valid", "sar_valid",
        ]:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce")

        df["VV_VH_ratio_dB"] = df["VV"] - df["VH"]

        # Match the corrected Colab LSTM preprocessing.
        bad_evi = df["EVI"].notna() & (
            (df["EVI"] < -1.0) | (df["EVI"] > 1.0)
        )
        df.loc[bad_evi, "EVI"] = np.nan

        if "optical_valid" not in df.columns:
            df["optical_valid"] = (
                df[["NDVI", "NDMI", "EVI", "SAVI"]]
                .notna().any(axis=1).astype(int)
            )
        if "sar_valid" not in df.columns:
            df["sar_valid"] = (
                df["VV"].notna() & df["VH"].notna()
            ).astype(int)

        df["optical_valid"] = df["optical_valid"].fillna(0).astype(int)
        df["sar_valid"] = df["sar_valid"].fillna(0).astype(int)

        df = (
            df.dropna(subset=["field_id", "period_start"])
            .sort_values(["field_id", "period_start"])
            .reset_index(drop=True)
        )

        self.season_start = df["period_start"].min()
        df["season_day"] = (
            df["period_start"] - self.season_start
        ).dt.days.astype(float)

        self.temporal = df
        self.temporal_groups = {
            str(fid): g.copy()
            for fid, g in df.groupby("field_id", sort=False)
        }
        self.loaded_paths["temporal_csv"] = str(TEMPORAL_CSV)

    @property
    def crop_ready(self):
        return (
            self.crop_model is not None
            and self.crop_encoder is not None
            and self.temporal is not None
        )

    @property
    def stress_ready(self):
        return (
            self.stress_model is not None
            and self.stress_encoder is not None
            and self.temporal is not None
        )

    @property
    def phenology_ready(self):
        return all([
            self.lstm_model is not None,
            self.lstm_imputer is not None,
            self.lstm_scaler is not None,
            self.lstm_encoder is not None,
            self.temporal is not None,
        ])

    def status(self):
        return {
            "ready": self.crop_ready and self.stress_ready and self.phenology_ready,
            "crop_ready": self.crop_ready,
            "phenology_ready": self.phenology_ready,
            "stress_ready": self.stress_ready,
            "model_dir": str(MODEL_DIR),
            "temporal_csv": str(TEMPORAL_CSV),
            "loaded_paths": self.loaded_paths,
            "missing": self.missing,
            "load_errors": self.load_errors,
            "field_count": (
                int(self.temporal["field_id"].nunique())
                if self.temporal is not None else 0
            ),
            "period_count": (
                int(self.temporal["period_start"].nunique())
                if self.temporal is not None else 0
            ),
        }

    def _history(self, field_id, as_of):
        group = self.temporal_groups.get(str(field_id))
        if group is None:
            raise HTTPException(
                status_code=404,
                detail=f"field_id not found: {field_id}",
            )

        if as_of:
            timestamp = pd.to_datetime(as_of, errors="coerce")
            if pd.isna(timestamp):
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid as_of date: {as_of}",
                )
        else:
            timestamp = group["period_start"].max()

        history = group[group["period_start"] <= timestamp].copy()
        if history.empty:
            raise HTTPException(
                status_code=404,
                detail=f"No observation on/before {timestamp.date()}",
            )
        return history, timestamp

    def _fused_snapshot(self, history):
        optical = history[
            history["optical_valid"].eq(1)
            & history["NDVI"].notna()
        ]
        sar = history[
            history["sar_valid"].eq(1)
            & history["VV"].notna()
            & history["VH"].notna()
        ]

        o = optical.iloc[-1] if not optical.empty else None
        s = sar.iloc[-1] if not sar.empty else None

        values = {
            "EVI": finite_or_none(o.get("EVI")) if o is not None else None,
            "NDMI": finite_or_none(o.get("NDMI")) if o is not None else None,
            "NDVI": finite_or_none(o.get("NDVI")) if o is not None else None,
            "NDWI": finite_or_none(o.get("NDWI")) if o is not None else None,
            "SAVI": finite_or_none(o.get("SAVI")) if o is not None else None,
            "VV": finite_or_none(s.get("VV")) if s is not None else None,
            "VH": finite_or_none(s.get("VH")) if s is not None else None,
            "VV_VH_ratio_dB": (
                finite_or_none(s.get("VV") - s.get("VH"))
                if s is not None else None
            ),
        }

        optical_date = (
            pd.Timestamp(o["period_start"]).date().isoformat()
            if o is not None else None
        )
        sar_date = (
            pd.Timestamp(s["period_start"]).date().isoformat()
            if s is not None else None
        )

        return values, optical_date, sar_date

    def _predict_tabular(self, model, encoder, values):
        X = pd.DataFrame(
            [[values.get(c) for c in SNAPSHOT_FEATURES]],
            columns=SNAPSHOT_FEATURES,
        )
        code = int(np.asarray(model.predict(X)).reshape(-1)[0])
        label = str(encoder.inverse_transform([code])[0])

        probabilities = {}
        confidence = None
        if hasattr(model, "predict_proba"):
            prob = np.asarray(model.predict_proba(X))[0]
            probabilities = {
                str(name): float(p)
                for name, p in zip(encoder.classes_, prob)
            }
            confidence = float(np.max(prob))

        return {
            "label": label,
            "confidence": confidence,
            "probabilities": probabilities,
        }

    def _lstm_sequence(self, history):
        work = history.copy()

        # Causal only: previous optical data may be retained, never future data.
        optical_cols = ["NDVI", "NDMI", "NDWI", "EVI", "SAVI"]
        work[optical_cols] = work[optical_cols].ffill()

        features = self.lstm_metadata.get(
            "features", DEFAULT_LSTM_FEATURES
        )
        sequence_length = int(
            self.lstm_metadata.get("sequence_length", 3)
        )

        for col in features:
            if col not in work.columns:
                work[col] = np.nan

        matrix = work[features].copy()
        matrix = self.lstm_imputer.transform(matrix)
        matrix = self.lstm_scaler.transform(matrix)

        recent = np.asarray(matrix[-sequence_length:], dtype=np.float32)
        padded = np.zeros(
            (sequence_length, len(features)),
            dtype=np.float32,
        )
        padded[-len(recent):] = recent

        return padded[np.newaxis, ...], features, sequence_length

    def predict_field(self, field_id, as_of=None):
        if self.temporal is None:
            raise HTTPException(
                status_code=503,
                detail="Temporal CSV is not loaded.",
            )

        history, timestamp = self._history(field_id, as_of)
        snapshot, optical_date, sar_date = self._fused_snapshot(history)

        result = {
            "field_id": str(field_id),
            "as_of": timestamp.date().isoformat(),
            "data_sources": {
                "optical_source_date": optical_date,
                "sar_source_date": sar_date,
                "old_satellite_periods_used": int(len(history)),
            },
            "features": snapshot,
            "predictions": {},
            "warnings": [],
        }

        if self.crop_ready:
            try:
                p = self._predict_tabular(
                    self.crop_model, self.crop_encoder, snapshot
                )
                p.update({
                    "engine": "Crop Engine",
                    "model": "Random Forest",
                    "evaluation_status": "prototype / derived-label model",
                })
                result["predictions"]["crop"] = p
            except Exception as exc:
                result["warnings"].append(f"Crop inference failed: {exc}")

        if self.stress_ready:
            try:
                p = self._predict_tabular(
                    self.stress_model, self.stress_encoder, snapshot
                )
                p.update({
                    "engine": "Stress Engine",
                    "model": self.stress_model_name,
                    "evaluation_status": "prototype / derived-label model",
                })
                result["predictions"]["stress"] = p
            except Exception as exc:
                result["warnings"].append(f"Stress inference failed: {exc}")

        if self.phenology_ready:
            try:
                X, features, sequence_length = self._lstm_sequence(history)
                prob = np.asarray(
                    self.lstm_model.predict(X, verbose=0)
                )[0]
                code = int(np.argmax(prob))
                label = str(
                    self.lstm_encoder.inverse_transform([code])[0]
                )
                result["predictions"]["phenology"] = {
                    "label": label,
                    "confidence": float(prob[code]),
                    "probabilities": {
                        str(name): float(p)
                        for name, p in zip(
                            self.lstm_encoder.classes_, prob
                        )
                    },
                    "engine": "Phenology Engine",
                    "model": "LSTM",
                    "sequence_length": sequence_length,
                    "features": features,
                    "evaluation_status": (
                        self.lstm_metadata.get(
                            "evaluation_warning",
                            "prototype temporal model",
                        )
                    ),
                }
            except Exception as exc:
                result["warnings"].append(
                    f"Phenology LSTM inference failed: {exc}"
                )

        if not result["predictions"]:
            raise HTTPException(
                status_code=503,
                detail={
                    "message": "No trained inference engine is ready.",
                    "status": self.status(),
                },
            )

        return result


registry = ModelRegistry()


@asynccontextmanager
async def lifespan(app: FastAPI):
    registry.load()
    yield


app = FastAPI(
    title="AgriSense Inference Service",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return registry.status()


@app.get("/models")
def models():
    return {
        "selected_deployment_models": {
            "crop": "Random Forest",
            "phenology": "LSTM",
            "stress": "XGBoost",
        },
        "status": registry.status(),
    }


@app.get("/predict/field/{field_id}")
def predict_field(
    field_id: str,
    as_of: str | None = Query(default=None),
):
    return registry.predict_field(field_id, as_of)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "inference_service:app",
        host=HOST,
        port=PORT,
        reload=False,
        workers=1,
    )
