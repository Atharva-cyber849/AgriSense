"""
Core AI/ML Processing & Modelling Engine + Water Deficit Estimation.
Implements the major model families shown in the design diagram:
1. Land-use / field segmentation (k-means style clustering)
2. Crop type classification (heuristic + tree-style ensemble logic)
3. Growth stage detection (temporal phenology logic)
4. Moisture stress detection (XGBoost-like risk scoring)
5. Water deficit estimation and irrigation advisory
6. Explainability summary for model decisions
"""

from __future__ import annotations

import math
from typing import Dict, Iterable, List, Sequence

import numpy as np

# FAO-56 Crop Coefficients (Kc) for Karnal Crops across Growth Stages
CROP_KC_LOOKUP = {
    "Paddy (Rice)": {
        "Sowing/Planting": 0.50,
        "Vegetative": 1.05,
        "Flowering": 1.20,
        "Grain Filling": 1.15,
        "Maturity": 0.70,
    },
    "Wheat": {
        "Sowing/Planting": 0.40,
        "Vegetative": 0.85,
        "Flowering": 1.15,
        "Grain Filling": 1.10,
        "Maturity": 0.45,
    },
    "Sugarcane": {
        "Sowing/Planting": 0.40,
        "Vegetative": 1.00,
        "Flowering": 1.25,
        "Grain Filling": 1.20,
        "Maturity": 0.75,
    },
    "Mustard": {
        "Sowing/Planting": 0.35,
        "Vegetative": 0.75,
        "Flowering": 1.05,
        "Grain Filling": 0.95,
        "Maturity": 0.35,
    },
    "Fodder/Vegetables": {
        "Sowing/Planting": 0.45,
        "Vegetative": 0.85,
        "Flowering": 1.05,
        "Grain Filling": 0.95,
        "Maturity": 0.60,
    },
}


class SimpleKMeans:
    """Very lightweight k-means implementation used when sklearn is unavailable."""

    def __init__(self, n_clusters: int = 3, max_iter: int = 25, random_state: int = 0):
        self.n_clusters = n_clusters
        self.max_iter = max_iter
        self.random_state = random_state
        self.centroids_ = None

    def fit_predict(self, X: Sequence[Sequence[float]]) -> np.ndarray:
        X = np.asarray(X, dtype=float)
        if X.ndim == 1:
            X = X.reshape(-1, 1)

        rng = np.random.default_rng(self.random_state)
        idx = rng.choice(np.arange(len(X)), size=self.n_clusters, replace=False)
        centroids = X[idx].copy()

        for _ in range(self.max_iter):
            distances = np.linalg.norm(X[:, None, :] - centroids[None, :, :], axis=2)
            labels = np.argmin(distances, axis=1)
            new_centroids = centroids.copy()
            for c in range(self.n_clusters):
                cluster_points = X[labels == c]
                if len(cluster_points) > 0:
                    new_centroids[c] = cluster_points.mean(axis=0)
            if np.allclose(new_centroids, centroids):
                break
            centroids = new_centroids

        self.centroids_ = centroids
        distances = np.linalg.norm(X[:, None, :] - centroids[None, :, :], axis=2)
        return np.argmin(distances, axis=1)


def segment_land_use(pixel_features: Sequence[Sequence[float]]) -> Dict[str, object]:
    """Segment image pixels into vegetation, water, and bare-soil classes.
    This mirrors a simple segmentation model in the diagram rather than a full deep network.
    """
    if not pixel_features:
        return {"labels": [], "classes": []}

    X = np.asarray(pixel_features, dtype=float)
    if X.ndim == 1:
        X = X.reshape(-1, 1)

    # Use NDVI-like behavior if available: assume 3 features [NDVI, NDWI, brightness]
    # For a standard feature table, use the first 3 columns or derive proxies.
    model = SimpleKMeans(n_clusters=3, max_iter=35, random_state=0)
    labels = model.fit_predict(X)

    # Map clusters to semantic classes on the basis of average NDVI / NDWI proxies
    cluster_stats = []
    for c in range(model.n_clusters):
        members = X[labels == c]
        if len(members) == 0:
            score = 0.0
        else:
            score = float(members.mean(axis=0)[0]) if members.shape[1] > 0 else 0.0
        cluster_stats.append(score)

    cluster_order = sorted(range(len(cluster_stats)), key=lambda i: cluster_stats[i])
    class_map = {
        cluster_order[0]: "bare_soil",
        cluster_order[1]: "vegetation",
        cluster_order[2]: "water",
    }

    class_labels = [class_map.get(int(label), "mixed") for label in labels]
    return {
        "labels": class_labels,
        "classes": ["water", "vegetation", "bare_soil"],
        "cluster_scores": cluster_stats,
    }


def classify_crop_type(temporal_indices: Dict[str, float], sar_feats: Dict[str, float]) -> Dict[str, float | str]:
    """Crop classifier with tree-like rule boundaries for the main Karnal crop classes."""
    max_ndvi = float(temporal_indices.get("max_ndvi", 0.75))
    mean_ndmi = float(temporal_indices.get("mean_ndmi", 0.25))
    vv_vh_ratio = float(sar_feats.get("VV_VH_ratio", 5.5))

    if max_ndvi > 0.72 and mean_ndmi > 0.30 and vv_vh_ratio > 5.0:
        crop = "Paddy (Rice)"
        confidence = 0.94
    elif max_ndvi > 0.65 and mean_ndmi < 0.25 and vv_vh_ratio <= 4.8:
        crop = "Wheat"
        confidence = 0.91
    elif max_ndvi > 0.60 and mean_ndmi > 0.35:
        crop = "Sugarcane"
        confidence = 0.88
    elif max_ndvi <= 0.62 and vv_vh_ratio < 4.2:
        crop = "Mustard"
        confidence = 0.86
    else:
        crop = "Fodder/Vegetables"
        confidence = 0.85

    return {"crop_type": crop, "confidence": round(confidence, 2)}


def detect_growth_stage(crop_type: str, current_ndvi: float, season_progress_pct: float) -> str:
    """Phenology model that mimics an LSTM/temporal sequence stage detector."""
    progress = float(np.clip(season_progress_pct, 0.0, 1.0))
    ndvi = float(np.clip(current_ndvi, -1.0, 1.0))

    if progress < 0.18:
        stage = "Sowing/Planting"
    elif progress < 0.45:
        stage = "Vegetative"
    elif progress < 0.70:
        stage = "Flowering"
    elif progress < 0.88:
        stage = "Grain Filling"
    else:
        stage = "Maturity"

    if ndvi < 0.15:
        return "Early / Stress / Fallow"
    return stage


def detect_moisture_stress(ndvi: float, ndwi: float, ndmi: float, sar_vv: float, weather_eto: float, rainfall_7day: float) -> Dict[str, float | str]:
    """Stress model converting vegetation and weather signals into a stress score."""
    water_balance_index = (ndwi + ndmi + (sar_vv + 20.0) / 20.0) / 3.0
    deficit_risk = max(0.0, (weather_eto * 7.0 - rainfall_7day) / (weather_eto * 7.0 + 1e-5))

    stress_score = 0.6 * deficit_risk + 0.4 * (1.0 - max(0.0, water_balance_index))
    stress_score = float(np.clip(stress_score, 0.0, 1.0))

    if stress_score < 0.25:
        category = "No Stress"
    elif stress_score < 0.50:
        category = "Mild Stress"
    elif stress_score < 0.75:
        category = "Moderate Stress"
    else:
        category = "Severe Stress"

    return {"stress_category": category, "stress_score": round(stress_score, 2)}


def calculate_water_balance_and_advisory(crop_type: str, growth_stage: str, eto_mm_day: float, rainfall_7day_mm: float, stress_category: str) -> Dict[str, object]:
    """FAO-56 crop water balance and recommended irrigation schedule."""
    kc = CROP_KC_LOOKUP.get(crop_type, {}).get(growth_stage, 0.85)
    etc_daily = eto_mm_day * kc
    etc_weekly = etc_daily * 7.0

    peff_weekly = rainfall_7day_mm * 0.75 if rainfall_7day_mm > 5.0 else 0.0
    water_deficit_mm = max(0.0, etc_weekly - peff_weekly)

    if water_deficit_mm < 10.0 or stress_category == "No Stress":
        rec_depth = 0.0
        rec_timing = "No irrigation required this week"
        priority = 1
        advisory = "Soil moisture adequate. Rain / current moisture meets crop evapotranspiration demand."
    elif water_deficit_mm < 25.0:
        rec_depth = 30.0
        rec_timing = "Within 4-5 days"
        priority = 4
        advisory = "Apply light irrigation (30 mm) within 5 days to prevent moderate crop stress."
    elif water_deficit_mm < 45.0:
        rec_depth = 50.0
        rec_timing = "Within 2-3 days"
        priority = 7
        advisory = "Apply standard irrigation (50 mm) within 48 hours. Canal supply release requested."
    else:
        rec_depth = 65.0
        rec_timing = "Immediate (Within 24 hours)"
        priority = 10
        advisory = "URGENT: High water deficit detected! Apply immediate irrigation (65 mm) to avoid yield loss."

    return {
        "kc_factor": round(kc, 2),
        "etc_daily_mm": round(etc_daily, 2),
        "etc_weekly_mm": round(etc_weekly, 2),
        "effective_rain_mm": round(peff_weekly, 2),
        "water_deficit_mm": round(water_deficit_mm, 2),
        "recommended_depth_mm": rec_depth,
        "recommended_timing": rec_timing,
        "canal_priority_score": priority,
        "advisory_text": advisory,
    }


class ShapLikeExplainer:
    """Simple explainability helper to approximate SHAP/LIME-style feature importance."""

    def __init__(self, feature_names: Sequence[str]):
        self.feature_names = list(feature_names)

    def explain(self, values: Sequence[float]) -> Dict[str, float]:
        values = np.asarray(values, dtype=float)
        if values.size == 0:
            return {}
        centered = np.abs(values - values.mean())
        total = float(centered.sum())
        if total <= 0:
            return {name: 0.0 for name in self.feature_names}
        contributions = {name: float(centered[i] / total) for i, name in enumerate(self.feature_names)}
        return contributions


def explain_model_contributions(feature_map: Dict[str, float]) -> Dict[str, float]:
    """Return relative feature contributions for explainability output."""
    explainer = ShapLikeExplainer(list(feature_map.keys()))
    return explainer.explain(list(feature_map.values()))


if __name__ == "__main__":
    crop_res = classify_crop_type({"max_ndvi": 0.78, "mean_ndmi": 0.32}, {"VV_VH_ratio": 5.8})
    print("Crop Classification:", crop_res)
    stage = detect_growth_stage(crop_res["crop_type"], 0.72, 0.55)
    print("Detected Growth Stage:", stage)
    stress = detect_moisture_stress(0.55, 0.12, 0.15, -12.5, 4.8, 12.0)
    print("Moisture Stress:", stress)
    adv = calculate_water_balance_and_advisory(crop_res["crop_type"], stage, 4.8, 12.0, stress["stress_category"])
    print("Water Balance & Irrigation Advisory:", adv)
    print("Explainability:", explain_model_contributions({"NDVI": 0.74, "NDWI": 0.12, "NDMI": 0.3, "VV_dB": -14.2}))
