from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"

DEFAULT_INPUT = DATA_DIR / "karnal_real_features.csv"
DEFAULT_TEMPORAL = DATA_DIR / "karnal_real_temporal_table.csv"
DEFAULT_OUTPUT = DATA_DIR / "karnal_real_demo_output.json"

DEMO_ETO_MM_DAY = 4.5
DEMO_RAIN_7D_MM = 12.0

CROP_KC = {
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


def finite_or_none(value):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if np.isfinite(value) else None


def vegetation_condition(ndvi):
    if ndvi is None:
        return "No Optical Observation"
    if ndvi >= 0.60:
        return "Dense / Healthy Vegetation"
    if ndvi >= 0.40:
        return "Moderate Vegetation"
    if ndvi >= 0.20:
        return "Low Vegetation"
    return "Sparse / Early Vegetation"


def kc_for(crop_type, stage):
    return CROP_KC.get(str(crop_type), {}).get(str(stage), 0.85)


def irrigation_rule(crop_type, stage, stress_class):
    kc = kc_for(crop_type, stage)
    etc_daily = DEMO_ETO_MM_DAY * kc
    etc_7d = etc_daily * 7.0
    peff = DEMO_RAIN_7D_MM * 0.75 if DEMO_RAIN_7D_MM > 5 else 0.0
    deficit = max(0.0, etc_7d - peff)

    if deficit < 10 and str(stress_class) in {"No Stress", "Low Stress"}:
        depth, priority = 0.0, 1
        timing = "No irrigation required this week"
        advisory = "Moisture/rainfall is adequate under the prototype demo rule."
    elif deficit < 25:
        depth, priority = 30.0, 4
        timing = "Within 4-5 days"
        advisory = "Light irrigation priority under the prototype water-balance rule."
    elif deficit < 45:
        depth, priority = 50.0, 7
        timing = "Within 2-3 days"
        advisory = "Moderate-to-high irrigation priority under the prototype water-balance rule."
    else:
        depth, priority = 65.0, 10
        timing = "Within 24 hours"
        advisory = "High irrigation priority under the prototype water-balance rule."

    return {
        "kc_factor": round(kc, 2),
        "etc_daily_mm": round(etc_daily, 2),
        "etc_weekly_mm": round(etc_7d, 2),
        "effective_rain_mm": round(peff, 2),
        "water_deficit_mm": round(deficit, 2),
        "recommended_depth_mm": depth,
        "recommended_timing": timing,
        "canal_priority_score": priority,
        "advisory_text": advisory,
        "status": "Prototype decision-support rule; not a validated agronomic prescription.",
    }


def load_temporal_profiles(path: Path):
    if not path.exists():
        return {}

    if path.suffix.lower() == ".parquet":
        tdf = pd.read_parquet(path)
    else:
        tdf = pd.read_csv(path)

    if "field_id" not in tdf.columns:
        return {}

    date_col = next((c for c in ("period_start", "date", "timestamp") if c in tdf.columns), None)
    if date_col is None:
        return {}

    tdf[date_col] = pd.to_datetime(tdf[date_col], errors="coerce")

    if "VV_VH_ratio_dB" not in tdf.columns and {"VV", "VH"}.issubset(tdf.columns):
        tdf["VV_VH_ratio_dB"] = (
            pd.to_numeric(tdf["VV"], errors="coerce")
            - pd.to_numeric(tdf["VH"], errors="coerce")
        )

    profiles = {}
    for fid, g in tdf.groupby("field_id"):
        g = g.sort_values(date_col)
        seq = []
        for _, row in g.iterrows():
            if pd.isna(row[date_col]):
                continue
            seq.append({
                "date": row[date_col].date().isoformat(),
                "ndvi": finite_or_none(row.get("NDVI")),
                "ndmi": finite_or_none(row.get("NDMI")),
                "evi": finite_or_none(row.get("EVI")),
                "savi": finite_or_none(row.get("SAVI")),
                "sar_vv_db": finite_or_none(row.get("VV")),
                "sar_vh_db": finite_or_none(row.get("VH")),
                "vv_vh_ratio_db": finite_or_none(row.get("VV_VH_ratio_dB")),
                "optical_valid": int(row.get("optical_valid", 1)) if pd.notna(row.get("optical_valid", 1)) else 0,
                "sar_valid": int(row.get("sar_valid", 1)) if pd.notna(row.get("sar_valid", 1)) else 0,
            })
        profiles[str(fid)] = seq
    return profiles


def build_real_demo(input_csv: Path, output_json: Path, temporal_path: Path | None = None):
    df = pd.read_csv(input_csv)

    required = [
        "field_id", "latitude", "longitude",
        "NDVI", "NDMI", "NDWI", "EVI", "SAVI",
        "VV", "VH",
        "crop_type", "growth_stage", "moisture_stress",
    ]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Input CSV is missing required columns: {missing}")

    numeric_cols = [
        "latitude", "longitude", "NDVI", "NDMI", "NDWI", "EVI", "SAVI",
        "VV", "VH", "stress_score", "water_deficit_mm",
        "recommended_depth_mm", "canal_priority_score", "sar_available",
    ]
    for c in numeric_cols:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")

    df["VV_VH_ratio_dB"] = df["VV"] - df["VH"]

    temporal_profiles = load_temporal_profiles(temporal_path) if temporal_path else {}

    available_periods = sorted({
        str(obs.get("date"))[:10]
        for seq in temporal_profiles.values()
        for obs in seq
        if obs.get("date") and not obs.get("single_snapshot_only")
    })

    fields = []
    features = []

    veg_counter = Counter()
    high_priority_count = 0
    sar_available_count = 0
    ndvi_values = []
    deficit_values = []

    for _, r in df.iterrows():
        fid = str(r["field_id"])
        lat = finite_or_none(r["latitude"])
        lon = finite_or_none(r["longitude"])
        if lat is None or lon is None:
            continue

        ndvi = finite_or_none(r.get("NDVI"))
        ndmi = finite_or_none(r.get("NDMI"))
        ndwi = finite_or_none(r.get("NDWI"))
        evi = finite_or_none(r.get("EVI"))
        savi = finite_or_none(r.get("SAVI"))
        vv = finite_or_none(r.get("VV"))
        vh = finite_or_none(r.get("VH"))
        ratio_db = finite_or_none(r.get("VV_VH_ratio_dB"))

        crop = str(r.get("crop_type", "Unclassified"))
        stage = str(r.get("growth_stage", "Unknown"))
        stress = str(r.get("moisture_stress", "Unknown"))

        water = irrigation_rule(crop, stage, stress)
        veg = vegetation_condition(ndvi)

        veg_counter[veg] += 1
        high_priority_count += int(water["canal_priority_score"] >= 7)
        sar_ok = bool(
            finite_or_none(r.get("sar_available")) == 1
            if "sar_available" in df.columns
            else (vv is not None and vh is not None)
        )
        sar_available_count += int(sar_ok)

        if ndvi is not None:
            ndvi_values.append(ndvi)
        deficit_values.append(water["water_deficit_mm"])

        temporal_profile = temporal_profiles.get(fid, [])
        if not temporal_profile:
            temporal_profile = [{
                "date": "2025-06-01",
                "ndvi": ndvi,
                "ndmi": ndmi,
                "evi": evi,
                "savi": savi,
                "sar_vv_db": vv,
                "sar_vh_db": vh,
                "vv_vh_ratio_db": ratio_db,
                "optical_valid": int(ndvi is not None),
                "sar_valid": int(sar_ok),
                "single_snapshot_only": True,
            }]

        record = {
            "field_id": fid,
            "observation_unit": "Karnal satellite sample point",
            "lat": lat,
            "lon": lon,
            "area_acres": None,
            "area_ha": None,
            "tehsil": "Karnal",
            "canal_branch": "Not assigned in point-level demo data",
            "soil_type": "Static Karnal soil layer available",
            "crop_type": crop,
            "crop_confidence": None,
            "growth_stage": stage,
            "moisture_stress": stress,
            "stress_score": finite_or_none(r.get("stress_score")),
            "vegetation_condition": veg,
            "indices": {
                "NDVI": ndvi,
                "NDWI": ndwi,
                "NDMI": ndmi,
                "EVI": evi,
                "SAVI": savi,
            },
            "sar_features": {
                "VV_dB": vv,
                "VH_dB": vh,
                "VV_VH_ratio": ratio_db,
                "sar_available": sar_ok,
            },
            "water_balance": water,
            "temporal_profile": temporal_profile,
            "provenance": {
                "spectral_indices": "REAL: downloaded Karnal Sentinel-2-derived features",
                "sar": "REAL: downloaded Karnal Sentinel-1 VV/VH; ratio corrected offline as VV - VH",
                "crop_type": "PROTOTYPE/DERIVED label",
                "growth_stage": "PROTOTYPE/DERIVED label",
                "moisture_stress": "PROTOTYPE/DERIVED label",
                "irrigation_advisory": "PROTOTYPE FAO-style water-balance/rule engine",
            },
        }
        fields.append(record)

        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [lon, lat],
            },
            "properties": {
                "field_id": fid,
                "crop_type": crop,
                "growth_stage": stage,
                "moisture_stress": stress,
                "vegetation_condition": veg,
                "water_deficit_mm": water["water_deficit_mm"],
                "recommended_depth_mm": water["recommended_depth_mm"],
                "canal_priority_score": water["canal_priority_score"],
                "ndvi": ndvi,
                "ndmi": ndmi,
                "sar_vv": vv,
                "sar_available": sar_ok,
            },
        })

    crop_counts = Counter(f["crop_type"] for f in fields)
    stage_counts = Counter(f["growth_stage"] for f in fields)
    stress_counts = Counter(f["moisture_stress"] for f in fields)

    summary = {
        "region_name": "Karnal District, Haryana, India",
        "source": "Real downloaded Karnal satellite feature dataset",
        "demo_mode": True,
        "observation_count": len(fields),
        "total_fields_monitored": len(fields),
        "total_area_ha": None,
        "mean_ndvi": round(float(np.mean(ndvi_values)), 3) if ndvi_values else None,
        "median_water_deficit_mm": round(float(np.median(deficit_values)), 2) if deficit_values else None,
        "high_priority_count": high_priority_count,
        "sar_coverage_pct": round(100.0 * sar_available_count / max(len(fields), 1), 1),
        "crop_distribution": dict(crop_counts),
        "growth_stage_distribution": dict(stage_counts),
        "moisture_stress_distribution": dict(stress_counts),
        "vegetation_condition_distribution": dict(veg_counter),
        # Compatibility fields used by old UI. These are prototype values, not measured water volumes.
        "total_weekly_water_deficit_m3": 0.0,
        "area_requiring_irrigation_ha": 0.0,
        "tehsils": [],
        "canal_networks": [],
        "latest_weather": {
            "date": "Demo scenario",
            "rainfall_mm": DEMO_RAIN_7D_MM,
            "temp_c": None,
            "rh_percent": None,
            "eto_mm_day": DEMO_ETO_MM_DAY,
            "status": "Prototype scenario because full-period weather was not downloaded in the first GEE export.",
        },
        "available_periods": available_periods,
        "temporal_period_count": len(available_periods),
        "composite_interval_days": 16,
        "temporal_profile_loaded": bool(temporal_profiles),
        "provenance": {
            "real": [
                "Karnal coordinates",
                "Sentinel-2 derived NDVI/NDMI/NDWI/EVI/SAVI",
                "Sentinel-1 VV/VH",
            ],
            "corrected": [
                "VV_VH_ratio_dB = VV - VH"
            ],
            "prototype": [
                "crop labels",
                "growth-stage labels",
                "moisture-stress labels",
                "irrigation advisory",
            ],
            "temporal_profile_loaded": bool(temporal_profiles),
        },
    }

    payload = {
        "summary": summary,
        "fields": fields,
        "geojson": {
            "type": "FeatureCollection",
            "features": features,
        },
    }

    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print("=" * 68)
    print("AGRISENSE REAL KARNAL DEMO DATA BUILT")
    print("=" * 68)
    print("Input:", input_csv)
    print("Observations:", len(fields))
    print("Temporal profiles loaded:", bool(temporal_profiles))
    print("Mean NDVI:", summary["mean_ndvi"])
    print("SAR coverage:", summary["sar_coverage_pct"], "%")
    print("Output:", output_json)

    return payload


def main():
    parser = argparse.ArgumentParser(description="Build AgriSense presentation JSON from the real Karnal feature CSV.")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--temporal", type=Path, default=DEFAULT_TEMPORAL)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    temporal = args.temporal if args.temporal.exists() else None
    build_real_demo(args.input, args.output, temporal)


if __name__ == "__main__":
    main()
