from __future__ import annotations

import argparse
import json
import math
from collections import Counter
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio
from pyproj import Transformer

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"

FEATURE_CSV = DATA_DIR / "karnal_real_features.csv"
TEMPORAL_CSV = DATA_DIR / "karnal_real_temporal_table.csv"
MANIFEST_CSV = DATA_DIR / "Karnal_Period_Manifest_2025.csv"
SOIL_TIF = DATA_DIR / "Karnal_Soil_Stack_Static.tif"
WEATHER_DIR = DATA_DIR / "weather"
PERIOD_DIR = DATA_DIR / "periods"
OUTPUT_JSON = DATA_DIR / "karnal_master_demo_output.json"

LATITUDE_RAD = math.radians(29.6857)
ELEVATION_M = 250.0

SOIL_DEFAULT_NAMES = [
    "soil_texture_class_0cm",
    "soil_texture_class_10cm",
    "soil_texture_class_30cm",
    "soil_texture_class_60cm",
    "soil_texture_class_100cm",
    "soil_texture_class_200cm",
    "bulk_density_kg_m3_0cm",
    "bulk_density_kg_m3_10cm",
    "bulk_density_kg_m3_30cm",
    "bulk_density_kg_m3_60cm",
    "bulk_density_kg_m3_100cm",
    "bulk_density_kg_m3_200cm",
    "organic_carbon_g_kg_0cm",
    "organic_carbon_g_kg_10cm",
    "organic_carbon_g_kg_30cm",
    "organic_carbon_g_kg_60cm",
    "organic_carbon_g_kg_100cm",
    "organic_carbon_g_kg_200cm",
    "field_capacity_pct_0cm",
    "field_capacity_pct_10cm",
    "field_capacity_pct_30cm",
    "field_capacity_pct_60cm",
    "field_capacity_pct_100cm",
    "field_capacity_pct_200cm",
]

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
        x = float(value)
    except (TypeError, ValueError):
        return None
    return x if np.isfinite(x) else None

def round_or_none(value, digits=3):
    x = finite_or_none(value)
    return round(x, digits) if x is not None else None

def vegetation_condition(ndvi):
    x = finite_or_none(ndvi)
    if x is None:
        return "No Optical Observation"
    if x >= 0.60:
        return "Dense / Healthy Vegetation"
    if x >= 0.40:
        return "Moderate Vegetation"
    if x >= 0.20:
        return "Low Vegetation"
    return "Sparse / Early Vegetation"

def moisture_signal(ndmi):
    x = finite_or_none(ndmi)
    if x is None:
        return "No Optical Observation"
    if x >= 0.30:
        return "Moist / High"
    if x >= 0.15:
        return "Moderate Moisture"
    if x >= 0.00:
        return "Low Moisture"
    return "Very Low Moisture"

def kc_for(crop, stage):
    return CROP_KC.get(str(crop), {}).get(str(stage), 0.85)

def saturation_vapour_pressure(temp_c):
    return 0.6108 * math.exp(17.27 * temp_c / (temp_c + 237.3))

def extraterrestrial_radiation_mj_m2_day(day_of_year, latitude_rad=LATITUDE_RAD):
    dr = 1 + 0.033 * math.cos(2 * math.pi * day_of_year / 365)
    solar_declination = 0.409 * math.sin(2 * math.pi * day_of_year / 365 - 1.39)
    x = -math.tan(latitude_rad) * math.tan(solar_declination)
    x = min(1.0, max(-1.0, x))
    sunset_angle = math.acos(x)
    gsc = 0.0820
    return (
        (24 * 60 / math.pi)
        * gsc
        * dr
        * (
            sunset_angle * math.sin(latitude_rad) * math.sin(solar_declination)
            + math.cos(latitude_rad)
            * math.cos(solar_declination)
            * math.sin(sunset_angle)
        )
    )

def estimate_fao56_eto_period(weather, period_start, day_count):
    """
    FAO-56 Penman-Monteith reference ET0 estimate.

    The weather TIFF contains 8-day aggregate/context variables. Solar radiation
    is converted to a representative daily value by dividing by day_count.
    This remains an estimate because the period raster is not a daily station
    record.
    """
    needed = [
        "tmean_C", "tmax_C", "tmin_C", "dewpoint_C",
        "wind10_mps", "surface_pressure_kPa", "solar_rad_MJ_m2"
    ]
    if any(finite_or_none(weather.get(k)) is None for k in needed):
        return None

    tmean = float(weather["tmean_C"])
    tmax = float(weather["tmax_C"])
    tmin = float(weather["tmin_C"])
    tdew = float(weather["dewpoint_C"])
    u10 = max(0.0, float(weather["wind10_mps"]))
    pressure = float(weather["surface_pressure_kPa"])
    rs_period = max(0.0, float(weather["solar_rad_MJ_m2"]))

    # Convert wind at 10 m to 2 m.
    u2 = u10 * 4.87 / math.log(67.8 * 10.0 - 5.42)

    es_tmax = saturation_vapour_pressure(tmax)
    es_tmin = saturation_vapour_pressure(tmin)
    es = (es_tmax + es_tmin) / 2.0
    ea = saturation_vapour_pressure(tdew)

    delta = (
        4098.0 * saturation_vapour_pressure(tmean)
        / ((tmean + 237.3) ** 2)
    )
    gamma = 0.000665 * pressure

    rs = rs_period / max(int(day_count), 1)
    rns = (1.0 - 0.23) * rs

    start = pd.Timestamp(period_start)
    midpoint = start + pd.Timedelta(days=max(int(day_count), 1) / 2.0)
    doy = int(midpoint.dayofyear)

    ra = extraterrestrial_radiation_mj_m2_day(doy)
    rso = (0.75 + 2e-5 * ELEVATION_M) * ra

    sigma = 4.903e-9
    tmax_k = tmax + 273.16
    tmin_k = tmin + 273.16

    cloud_term = 1.0
    if rso > 0:
        cloud_term = 1.35 * min(rs / rso, 1.0) - 0.35

    rnl = (
        sigma
        * ((tmax_k ** 4 + tmin_k ** 4) / 2.0)
        * (0.34 - 0.14 * math.sqrt(max(ea, 0.0)))
        * cloud_term
    )

    rn = max(0.0, rns - rnl)

    numerator = (
        0.408 * delta * rn
        + gamma
        * (900.0 / (tmean + 273.0))
        * u2
        * max(es - ea, 0.0)
    )
    denominator = delta + gamma * (1.0 + 0.34 * u2)

    if denominator <= 0:
        return None

    eto_daily = max(0.0, numerator / denominator)
    return eto_daily * max(int(day_count), 1)

def irrigation_rule(crop, stage, moisture, weather, eto_period):
    rainfall = finite_or_none(weather.get("rainfall_mm")) or 0.0
    kc = kc_for(crop, stage)

    etc = kc * eto_period if eto_period is not None else None

    # Transparent prototype effective-rainfall approximation.
    peff = max(0.0, 0.80 * rainfall)

    if etc is None:
        deficit = None
    else:
        deficit = max(0.0, etc - peff)

    if deficit is None:
        priority = 0
        depth = 0.0
        label = "No Advisory"
    elif deficit < 5:
        priority = 1
        depth = 0.0
        label = "No / Low Priority"
    elif deficit < 15:
        priority = 4
        depth = round(min(25.0, deficit * 1.15), 1)
        label = "Low Priority"
    elif deficit < 30:
        priority = 7
        depth = round(min(45.0, deficit * 1.15), 1)
        label = "Medium Priority"
    else:
        priority = 10
        depth = round(min(60.0, deficit * 1.15), 1)
        label = "High Priority"

    # Escalate one band when the current real NDMI signal is very low.
    if moisture == "Very Low Moisture" and priority in {1, 4, 7}:
        priority = min(10, priority + 2)

    timing = (
        "No irrigation indicated"
        if priority <= 1
        else "Within 4-5 days"
        if priority <= 4
        else "Within 2-3 days"
        if priority <= 7
        else "Within 24 hours"
    )

    return {
        "kc": round(kc, 2),
        "eto_mm": round_or_none(eto_period, 2),
        "etc_mm": round_or_none(etc, 2),
        "effective_rain_mm": round(peff, 2),
        "deficit_mm": round_or_none(deficit, 2),
        "recommended_depth_mm": depth,
        "priority_score": priority,
        "priority_label": label,
        "timing": timing,
        "status": "Prototype water-balance advisory using real 8-day weather.",
    }

def read_manifest(path: Path):
    manifest = pd.read_csv(path)
    manifest["period_start"] = pd.to_datetime(manifest["period_start"])
    manifest["period_last_date"] = pd.to_datetime(manifest["period_last_date"])
    return manifest.sort_values("period_index").reset_index(drop=True)

def weather_file_for(period_start):
    return WEATHER_DIR / f"Karnal_Weather_{pd.Timestamp(period_start).date().isoformat()}.tif"

def sample_raster_at_points(path: Path, points, expected_names=None):
    with rasterio.open(path) as ds:
        descriptions = list(ds.descriptions or [])
        if all(descriptions):
            names = [str(x) for x in descriptions]
        elif expected_names is not None:
            if ds.count != len(expected_names):
                raise ValueError(
                    f"{path.name}: expected {len(expected_names)} bands, found {ds.count}"
                )
            names = list(expected_names)
        else:
            names = [f"band_{i}" for i in range(1, ds.count + 1)]

        transformer = Transformer.from_crs(
            "EPSG:4326", ds.crs, always_xy=True
        )
        xs, ys = transformer.transform(
            points["longitude"].to_numpy(float),
            points["latitude"].to_numpy(float)
        )
        coords = list(zip(xs, ys))

        samples = list(ds.sample(coords, masked=True))
        rows = []

        for sample in samples:
            sample = np.ma.asarray(sample)
            row = {}
            for i, name in enumerate(names):
                value = sample[i]
                if np.ma.is_masked(value):
                    row[name] = None
                    continue
                x = finite_or_none(value)
                if x is None or np.isclose(x, -9999.0):
                    row[name] = None
                else:
                    row[name] = x
            rows.append(row)

        return rows

def load_temporal(path: Path):
    if not path.exists():
        return None
    df = pd.read_csv(path)
    needed = ["field_id", "period_start"]
    if any(c not in df.columns for c in needed):
        raise ValueError(
            f"{path.name} must contain field_id and period_start."
        )
    df["period_start"] = pd.to_datetime(df["period_start"])
    if "VV_VH_ratio_dB" not in df.columns and {"VV", "VH"}.issubset(df.columns):
        df["VV_VH_ratio_dB"] = (
            pd.to_numeric(df["VV"], errors="coerce")
            - pd.to_numeric(df["VH"], errors="coerce")
        )
    return df

def build_satellite_lookup(temporal):
    if temporal is None:
        return {}, [], [], []

    by_field = {}
    for fid, g in temporal.groupby("field_id"):
        g = g.sort_values("period_start").copy()
        by_field[str(fid)] = g

    all_dates = sorted(
        d.date().isoformat()
        for d in temporal["period_start"].dropna().drop_duplicates()
    )

    optical_mask = (
        temporal.get("optical_valid", pd.Series(0, index=temporal.index))
        .fillna(0)
        .astype(int)
        .eq(1)
    )
    if "NDVI" in temporal.columns:
        optical_mask = optical_mask | temporal["NDVI"].notna()

    sar_mask = (
        temporal.get("sar_valid", pd.Series(0, index=temporal.index))
        .fillna(0)
        .astype(int)
        .eq(1)
    )
    if {"VV", "VH"}.issubset(temporal.columns):
        sar_mask = sar_mask | (
            temporal["VV"].notna() &
            temporal["VH"].notna()
        )

    optical_dates = sorted(
        d.date().isoformat()
        for d in temporal.loc[
            optical_mask, "period_start"
        ].dropna().drop_duplicates()
    )

    sar_dates = sorted(
        d.date().isoformat()
        for d in temporal.loc[
            sar_mask, "period_start"
        ].dropna().drop_duplicates()
    )

    return by_field, all_dates, optical_dates, sar_dates
def satellite_for_master_period(field_id, master_date, by_field, fallback_row):
    """
    Carry optical and SAR independently.

    Example:
      19 Jul can have fresh SAR but no fresh optical.
      In that case NDVI/NDMI are carried from the latest earlier optical date,
      while VV/VH come from fresh 19-Jul SAR.
    """
    master_ts = pd.Timestamp(master_date)
    g = by_field.get(str(field_id))

    def empty_modality():
        return {
            "status": "unavailable",
            "source_date": None,
            "age_days": None,
        }

    if g is None or g.empty:
        return {
            "status": "unavailable",
            "source_date": None,
            "age_days": None,
            "optical_status": "unavailable",
            "optical_source_date": None,
            "optical_age_days": None,
            "sar_status": "unavailable",
            "sar_source_date": None,
            "sar_age_days": None,
            "NDVI": None,
            "NDMI": None,
            "EVI": None,
            "SAVI": None,
            "VV": None,
            "VH": None,
            "VV_VH_ratio_dB": None,
            "optical_valid": 0,
            "sar_valid": 0,
        }

    eligible = g[g["period_start"] <= master_ts].copy()

    if eligible.empty:
        return {
            "status": "unavailable",
            "source_date": None,
            "age_days": None,
            "optical_status": "unavailable",
            "optical_source_date": None,
            "optical_age_days": None,
            "sar_status": "unavailable",
            "sar_source_date": None,
            "sar_age_days": None,
            "NDVI": None,
            "NDMI": None,
            "EVI": None,
            "SAVI": None,
            "VV": None,
            "VH": None,
            "VV_VH_ratio_dB": None,
            "optical_valid": 0,
            "sar_valid": 0,
        }

    optical_mask = pd.Series(False, index=eligible.index)
    if "optical_valid" in eligible.columns:
        optical_mask = (
            pd.to_numeric(
                eligible["optical_valid"],
                errors="coerce"
            ).fillna(0).astype(int).eq(1)
        )
    if "NDVI" in eligible.columns:
        optical_mask = optical_mask | eligible["NDVI"].notna()

    sar_mask = pd.Series(False, index=eligible.index)
    if "sar_valid" in eligible.columns:
        sar_mask = (
            pd.to_numeric(
                eligible["sar_valid"],
                errors="coerce"
            ).fillna(0).astype(int).eq(1)
        )
    if {"VV", "VH"}.issubset(eligible.columns):
        sar_mask = sar_mask | (
            eligible["VV"].notna() &
            eligible["VH"].notna()
        )

    optical_rows = eligible[optical_mask]
    sar_rows = eligible[sar_mask]

    optical = empty_modality()
    sar = empty_modality()

    optical_row = None
    if not optical_rows.empty:
        optical_row = optical_rows.iloc[-1]
        source = pd.Timestamp(optical_row["period_start"])
        age = int((master_ts - source).days)
        optical = {
            "status": "fresh" if age == 0 else "carried",
            "source_date": source.date().isoformat(),
            "age_days": age,
        }

    sar_row = None
    if not sar_rows.empty:
        sar_row = sar_rows.iloc[-1]
        source = pd.Timestamp(sar_row["period_start"])
        age = int((master_ts - source).days)
        sar = {
            "status": "fresh" if age == 0 else "carried",
            "source_date": source.date().isoformat(),
            "age_days": age,
        }

    available_statuses = {
        optical["status"],
        sar["status"]
    } - {"unavailable"}

    if not available_statuses:
        overall = "unavailable"
    elif optical["status"] == sar["status"] == "fresh":
        overall = "fresh"
    elif "fresh" in available_statuses:
        overall = "mixed"
    else:
        overall = "carried"

    source_candidates = [
        x for x in [
            optical["source_date"],
            sar["source_date"]
        ] if x
    ]
    overall_source = max(source_candidates) if source_candidates else None

    ages = [
        x for x in [
            optical["age_days"],
            sar["age_days"]
        ] if x is not None
    ]
    overall_age = min(ages) if ages else None

    return {
        "status": overall,
        "source_date": overall_source,
        "age_days": overall_age,

        "optical_status": optical["status"],
        "optical_source_date": optical["source_date"],
        "optical_age_days": optical["age_days"],

        "sar_status": sar["status"],
        "sar_source_date": sar["source_date"],
        "sar_age_days": sar["age_days"],

        "NDVI": round_or_none(
            optical_row.get("NDVI")
            if optical_row is not None else None
        ),
        "NDMI": round_or_none(
            optical_row.get("NDMI")
            if optical_row is not None else None
        ),
        "EVI": round_or_none(
            optical_row.get("EVI")
            if optical_row is not None else None
        ),
        "SAVI": round_or_none(
            optical_row.get("SAVI")
            if optical_row is not None else None
        ),

        "VV": round_or_none(
            sar_row.get("VV")
            if sar_row is not None else None,
            2
        ),
        "VH": round_or_none(
            sar_row.get("VH")
            if sar_row is not None else None,
            2
        ),
        "VV_VH_ratio_dB": round_or_none(
            sar_row.get("VV_VH_ratio_dB")
            if sar_row is not None else None,
            2
        ),

        "optical_valid": int(optical_row is not None),
        "sar_valid": int(sar_row is not None),
    }
def derive_stage_curve(g):
    """
    Returns a date -> broad derived stage mapping from the real NDVI curve.

    This is a transparent derived phenology layer, not observed ground truth.
    """
    if g is None or g.empty or "NDVI" not in g.columns:
        return {}

    work = g[["period_start", "NDVI"]].copy()
    work["NDVI"] = pd.to_numeric(work["NDVI"], errors="coerce")
    work = work.dropna(subset=["NDVI"]).sort_values("period_start")
    if len(work) < 3:
        return {}

    vals = work["NDVI"].to_numpy(float)
    smooth = pd.Series(vals).rolling(
        3, center=True, min_periods=1
    ).median().to_numpy()

    min_v = float(np.min(smooth))
    max_v = float(np.max(smooth))
    amp = max(max_v - min_v, 1e-6)
    norm = (smooth - min_v) / amp
    peak = int(np.argmax(smooth))

    out = {}
    for i, (_, row) in enumerate(work.iterrows()):
        n = float(norm[i])
        if i <= peak:
            if n < 0.25:
                stage = "Sowing/Planting"
            elif n < 0.72:
                stage = "Vegetative"
            else:
                stage = "Flowering"
        else:
            if n >= 0.65:
                stage = "Grain Filling"
            else:
                stage = "Maturity"
        out[pd.Timestamp(row["period_start"]).date().isoformat()] = stage
    return out

def carried_stage(stage_map, source_date):
    if not source_date:
        return "No Satellite Observation"
    return stage_map.get(source_date, "Derived Stage Unavailable")

def soil_context(soil_row):
    return {
        "texture_class_0cm": round_or_none(soil_row.get("soil_texture_class_0cm"), 0),
        "texture_class_30cm": round_or_none(soil_row.get("soil_texture_class_30cm"), 0),
        "bulk_density_0cm": round_or_none(soil_row.get("bulk_density_kg_m3_0cm"), 1),
        "organic_carbon_0cm": round_or_none(soil_row.get("organic_carbon_g_kg_0cm"), 2),
        "field_capacity_0cm": round_or_none(soil_row.get("field_capacity_pct_0cm"), 2),
        "field_capacity_30cm": round_or_none(soil_row.get("field_capacity_pct_30cm"), 2),
        "field_capacity_60cm": round_or_none(soil_row.get("field_capacity_pct_60cm"), 2),
    }

def build(
    features_csv=FEATURE_CSV,
    temporal_csv=TEMPORAL_CSV,
    manifest_csv=MANIFEST_CSV,
    soil_tif=SOIL_TIF,
    output_json=OUTPUT_JSON,
):
    features = pd.read_csv(features_csv)

    required = [
        "field_id", "latitude", "longitude",
        "NDVI", "NDMI", "NDWI", "EVI", "SAVI",
        "VV", "VH",
        "crop_type", "growth_stage", "moisture_stress"
    ]
    missing = [c for c in required if c not in features.columns]
    if missing:
        raise ValueError(f"Feature CSV missing columns: {missing}")

    features = features.drop_duplicates("field_id").copy()
    features["latitude"] = pd.to_numeric(features["latitude"], errors="coerce")
    features["longitude"] = pd.to_numeric(features["longitude"], errors="coerce")
    features = features.dropna(subset=["latitude", "longitude"]).reset_index(drop=True)

    manifest = read_manifest(manifest_csv)
    temporal = load_temporal(temporal_csv)
    sat_by_field, satellite_dates, optical_dates, sar_dates = build_satellite_lookup(temporal)

    # Static soil sample.
    if soil_tif.exists():
        soil_rows = sample_raster_at_points(
            soil_tif, features, SOIL_DEFAULT_NAMES
        )
    else:
        soil_rows = [{} for _ in range(len(features))]

    # Stage lookup per field.
    stage_maps = {}
    if temporal is not None:
        for fid, g in temporal.groupby("field_id"):
            stage_maps[str(fid)] = derive_stage_curve(g)

    # Base field objects and base GeoJSON.
    fields = []
    geo_features = []

    for i, row in features.iterrows():
        vv = finite_or_none(row.get("VV"))
        vh = finite_or_none(row.get("VH"))

        field = {
            "field_id": str(row["field_id"]),
            "lat": float(row["latitude"]),
            "lon": float(row["longitude"]),
            "crop_type": str(row.get("crop_type", "Unclassified")),
            "prototype_growth_stage": str(row.get("growth_stage", "Unknown")),
            "prototype_moisture_stress": str(row.get("moisture_stress", "Unknown")),
            "snapshot_indices": {
                "NDVI": round_or_none(row.get("NDVI")),
                "NDMI": round_or_none(row.get("NDMI")),
                "NDWI": round_or_none(row.get("NDWI")),
                "EVI": round_or_none(row.get("EVI")),
                "SAVI": round_or_none(row.get("SAVI")),
            },
            "snapshot_sar": {
                "VV_dB": round_or_none(vv, 2),
                "VH_dB": round_or_none(vh, 2),
                "VV_VH_ratio_dB": round_or_none(
                    (vv - vh) if vv is not None and vh is not None else None,
                    2
                ),
            },
            "soil": soil_context(soil_rows[i]),
            "provenance": {
                "satellite": "REAL old 16-day downloaded Sentinel-2/Sentinel-1 when temporal table is present",
                "weather": "REAL new-script 8-day weather raster",
                "soil": "REAL new-script 24-band static soil stack",
                "growth_stage": "DERIVED from real NDVI seasonal trajectory",
                "irrigation": "PROTOTYPE water-balance decision support",
            }
        }
        fields.append(field)

        geo_features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [
                    float(row["longitude"]),
                    float(row["latitude"])
                ]
            },
            "properties": {
                "field_id": str(row["field_id"])
            }
        })

    PERIOD_DIR.mkdir(parents=True, exist_ok=True)

    master_timeline = []
    field_index = {
        str(row["field_id"]): row
        for _, row in features.iterrows()
    }

    for _, period in manifest.iterrows():
        period_start = pd.Timestamp(period["period_start"])
        period_start_s = period_start.date().isoformat()
        period_end_s = pd.Timestamp(period["period_last_date"]).date().isoformat()
        day_count = int(period.get("period_day_count", 8))

        weather_path = weather_file_for(period_start)
        if weather_path.exists():
            weather_rows = sample_raster_at_points(weather_path, features)
            weather_available = True
        else:
            weather_rows = [{} for _ in range(len(features))]
            weather_available = False

        records = []

        vegetation_counter = Counter()
        moisture_counter = Counter()
        stage_counter = Counter()
        priority_counter = Counter()

        rainfall_values = []
        eto_values = []
        deficit_values = []
        optical_valid_count = 0
        sar_valid_count = 0

        # Period-level fresh/carried label is determined from available
        # OLD satellite dates, not the new manifest's s1/s2 availability flags.
        def modality_state(dates):
            previous = [d for d in dates if d <= period_start_s]
            if period_start_s in dates:
                return "fresh", period_start_s, 0
            if previous:
                source = previous[-1]
                age = int((period_start - pd.Timestamp(source)).days)
                return "carried", source, age
            return "unavailable", None, None

        optical_mode, optical_source, optical_age = modality_state(optical_dates)
        sar_mode, sar_source, sar_age = modality_state(sar_dates)

        if optical_mode == sar_mode == "fresh":
            period_sat_mode = "fresh"
        elif "fresh" in {optical_mode, sar_mode}:
            period_sat_mode = "mixed"
        elif "carried" in {optical_mode, sar_mode}:
            period_sat_mode = "carried"
        else:
            period_sat_mode = "unavailable"

        source_candidates = [x for x in [optical_source, sar_source] if x]
        period_sat_source = max(source_candidates) if source_candidates else None

        age_candidates = [x for x in [optical_age, sar_age] if x is not None]
        period_sat_age = min(age_candidates) if age_candidates else None

        for i, feature_row in features.iterrows():
            fid = str(feature_row["field_id"])
            weather = weather_rows[i]

            sat = satellite_for_master_period(
                fid,
                period_start,
                sat_by_field,
                feature_row
            )

            stage = carried_stage(
                stage_maps.get(fid, {}),
                sat.get("source_date")
            )
            veg = vegetation_condition(sat.get("NDVI"))
            moisture = moisture_signal(sat.get("NDMI"))

            eto = estimate_fao56_eto_period(
                weather,
                period_start,
                day_count
            )

            water = irrigation_rule(
                str(feature_row.get("crop_type", "Unclassified")),
                stage,
                moisture,
                weather,
                eto
            )

            rainfall = finite_or_none(weather.get("rainfall_mm"))
            if rainfall is not None:
                rainfall_values.append(rainfall)
            if eto is not None:
                eto_values.append(eto)
            if water["deficit_mm"] is not None:
                deficit_values.append(float(water["deficit_mm"]))

            optical_valid_count += int(sat.get("optical_valid", 0) == 1)
            sar_valid_count += int(sat.get("sar_valid", 0) == 1)

            vegetation_counter[veg] += 1
            moisture_counter[moisture] += 1
            stage_counter[stage] += 1
            priority_counter[water["priority_label"]] += 1

            records.append({
                "field_id": fid,
                "period_start": period_start_s,
                "period_end": period_end_s,
                "weather": {
                    "rainfall_mm": round_or_none(weather.get("rainfall_mm"), 2),
                    "tmean_C": round_or_none(weather.get("tmean_C"), 2),
                    "tmax_C": round_or_none(weather.get("tmax_C"), 2),
                    "tmin_C": round_or_none(weather.get("tmin_C"), 2),
                    "dewpoint_C": round_or_none(weather.get("dewpoint_C"), 2),
                    "wind10_mps": round_or_none(weather.get("wind10_mps"), 2),
                    "surface_pressure_kPa": round_or_none(weather.get("surface_pressure_kPa"), 2),
                    "solar_rad_MJ_m2": round_or_none(weather.get("solar_rad_MJ_m2"), 2),
                    "ERA5_PEV_mm": round_or_none(weather.get("ERA5_PEV_mm"), 2),
                    "weather_valid": int(weather.get("weather_valid", 0) or 0),
                    "fao56_eto_est_mm": round_or_none(eto, 2),
                },
                "satellite": sat,
                "derived": {
                    "vegetation_condition": veg,
                    "growth_stage": stage,
                    "moisture_signal": moisture,
                },
                "water_balance": water,
            })

        n = max(len(records), 1)
        period_summary = {
            "period_start": period_start_s,
            "period_end": period_end_s,
            "period_index": int(period["period_index"]),
            "day_count": day_count,
            "weather_available": weather_available,
            "satellite_mode": period_sat_mode,
            "satellite_source_date": period_sat_source,
            "satellite_age_days": period_sat_age,
            "optical_mode": optical_mode,
            "optical_source_date": optical_source,
            "optical_age_days": optical_age,
            "sar_mode": sar_mode,
            "sar_source_date": sar_source,
            "sar_age_days": sar_age,
            "optical_valid_pct": round(100 * optical_valid_count / n, 1),
            "sar_valid_pct": round(100 * sar_valid_count / n, 1),
            "mean_rainfall_mm": round(float(np.mean(rainfall_values)), 2)
                if rainfall_values else None,
            "mean_fao56_eto_mm": round(float(np.mean(eto_values)), 2)
                if eto_values else None,
            "median_deficit_mm": round(float(np.median(deficit_values)), 2)
                if deficit_values else None,
            "vegetation_distribution": dict(vegetation_counter),
            "moisture_distribution": dict(moisture_counter),
            "growth_stage_distribution": dict(stage_counter),
            "irrigation_priority_distribution": dict(priority_counter),
            # Informational only: these refer to the NEW 8-day script that was
            # not fully downloaded as satellite rasters.
            "new_script_manifest": {
                "s1_available": int(period.get("s1_available", 0)),
                "s1_scene_count": int(period.get("s1_scene_count", 0)),
                "s2_available": int(period.get("s2_available", 0)),
                "s2_scene_count": int(period.get("s2_scene_count", 0)),
            }
        }

        period_payload = {
            "summary": period_summary,
            "records": records
        }

        (PERIOD_DIR / f"{period_start_s}.json").write_text(
            json.dumps(period_payload, separators=(",", ":")),
            encoding="utf-8"
        )

        master_timeline.append(period_summary)

    crop_counts = Counter(str(x) for x in features["crop_type"])
    prototype_stage_counts = Counter(str(x) for x in features["growth_stage"])
    prototype_stress_counts = Counter(str(x) for x in features["moisture_stress"])

    summary = {
        "region_name": "Karnal District, Haryana, India",
        "generated_at": datetime.now().isoformat(),
        "demo_mode": True,
        "master_period_count": len(master_timeline),
        "master_interval_days": 8,
        "master_timeline": master_timeline,
        "satellite_periods": satellite_dates,
        "optical_periods": optical_dates,
        "sar_periods": sar_dates,
        "satellite_temporal_available": temporal is not None,
        "weather_period_count": sum(
            1 for x in master_timeline if x["weather_available"]
        ),
        "soil_stack_available": soil_tif.exists(),
        "observation_count": len(fields),
        "crop_distribution": dict(crop_counts),
        "prototype_growth_stage_distribution": dict(prototype_stage_counts),
        "prototype_moisture_stress_distribution": dict(prototype_stress_counts),
        "source_note": (
            "8-day master timeline = real new weather + real static soil + "
            "latest available real old 16-day satellite observation."
        ),
        "satellite_status_definition": {
            "fresh": "Old satellite observation date exactly matches the 8-day master period start.",
            "carried": "Most recent previous old satellite observation is carried forward; age_days is shown.",
            "unavailable": "No old satellite observation exists on or before this master period."
        }
    }

    payload = {
        "summary": summary,
        "fields": fields,
        "geojson": {
            "type": "FeatureCollection",
            "features": geo_features
        }
    }

    output_json.write_text(
        json.dumps(payload, separators=(",", ":")),
        encoding="utf-8"
    )

    print("=" * 72)
    print("AGRISENSE 8-DAY MASTER TIMELINE BUILT")
    print("=" * 72)
    print("Master periods:", len(master_timeline))
    print("Weather periods:", summary["weather_period_count"])
    print("Old satellite periods:", len(satellite_dates))
    print("Satellite temporal table:", "YES" if temporal is not None else "NO")
    print("Fields:", len(fields))
    print("Output:", output_json)
    print("Period directory:", PERIOD_DIR)

    return payload

def main():
    ap = argparse.ArgumentParser(
        description="Build the AgriSense 19-step 8-day master demo timeline."
    )
    ap.add_argument("--features", type=Path, default=FEATURE_CSV)
    ap.add_argument("--temporal", type=Path, default=TEMPORAL_CSV)
    ap.add_argument("--manifest", type=Path, default=MANIFEST_CSV)
    ap.add_argument("--soil", type=Path, default=SOIL_TIF)
    ap.add_argument("--output", type=Path, default=OUTPUT_JSON)
    args = ap.parse_args()

    build(
        features_csv=args.features,
        temporal_csv=args.temporal,
        manifest_csv=args.manifest,
        soil_tif=args.soil,
        output_json=args.output,
    )

if __name__ == "__main__":
    main()
