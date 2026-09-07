import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / 'data'
DATA_DIR.mkdir(exist_ok=True)

# This script bridges the GEE output into the same JSON schema used by the app.
# In practice, you can export from Earth Engine as CSV/JSON, then save it here as
# data/karnal_gee_output.json. This file makes the app work without cloud exports.

sample_output = {
    "summary": {
        "region_name": "Karnal District, Haryana, India",
        "timestamp": "2026-09-07T00:00:00Z",
        "total_fields_monitored": 5,
        "total_area_ha": 67.25,
        "crop_distribution": {
            "Paddy (Rice)": 2,
            "Wheat": 2,
            "Sugarcane": 1
        },
        "growth_stage_distribution": {
            "Mid-season Growth": 3,
            "Peak Vegetative / Flowering": 2
        },
        "moisture_stress_distribution": {
            "Low Stress": 3,
            "Moderate Stress": 2
        },
        "total_weekly_water_deficit_m3": 42150.0,
        "area_requiring_irrigation_ha": 31.4,
        "latest_weather": {
            "date": "2026-08-15",
            "rainfall_mm": 18.4,
            "temp_c": 31.2,
            "rh_percent": 83.6,
            "eto_mm_day": 4.1
        }
    },
    "fields": [
        {
            "field_id": "KRN-FLD-101",
            "tehsil": "Karnal",
            "canal_branch": "Karnal Main Branch",
            "lat": 29.6857,
            "lon": 76.9905,
            "area_acres": 5.2,
            "area_ha": 2.10,
            "soil_type": "Alluvial Loam",
            "crop_type": "Paddy (Rice)",
            "crop_confidence": 0.91,
            "growth_stage": "Peak Vegetative / Flowering",
            "moisture_stress": "Low Stress",
            "stress_score": 21.0,
            "indices": {"NDVI": 0.74, "NDWI": 0.12, "NDMI": 0.31, "EVI": 0.55, "SAVI": 0.46, "MNDWI": 0.18},
            "sar_features": {"VV_dB": -14.2, "VH_dB": -20.8, "VV_VH_ratio": 6.6, "GLCM_contrast": 2.4, "GLCM_entropy": 1.02, "GLCM_homogeneity": 0.38},
            "phenology": {"sos_date": "2025-07-01", "peak_date": "2025-09-15", "peak_ndvi": 0.74, "eos_date": "2025-11-15", "lgp_days": 120},
            "water_balance": {"water_deficit_mm": 18.0, "recommended_depth_mm": 30.0, "canal_priority_score": 8.0, "advisory_text": "Use moderate irrigation scheduling."},
            "temporal_profile": []
        }
    ],
    "geojson": {
        "type": "FeatureCollection",
        "features": []
    }
}

out_path = DATA_DIR / 'karnal_gee_output.json'
out_path.write_text(json.dumps(sample_output, indent=2), encoding='utf-8')
print(f'Wrote local GEE fallback export to {out_path}')
