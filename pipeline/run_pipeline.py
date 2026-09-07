"""
Main Pipeline Execution Driver for Karnal Region (Diagram 1 & 2 End-to-End)
Runs Stages 1 through 8:
- Data Ingestion & Field Boundary Creation
- Calibration & Preprocessing (S2 Cloud Masking, S1 Refined Lee Speckle Filtering)
- Multi-Source Feature Extraction & Feature Cube Construction
- AI/ML Model Execution (Crop Classification, Growth Stage, Moisture Stress)
- Water Deficit Estimation & FAO-56 Crop Water Balance
- Generation of 5 Output Map Data Sets & Time-Series Profiles for Web GIS Platform
"""

import json
import os
import argparse
import numpy as np
from datetime import datetime

from karnal_aoi import TEHSILS, CANAL_NETWORKS, KARNAL_CENTER, generate_karnal_geojson_bounds
from data_ingestion import generate_field_samples, fetch_weather_data, SEASON_DATES
from preprocessing import s2_radiometric_calibration, s2_cloud_shadow_mask, sar_dn_to_db, sar_refined_lee_filter
from feature_cube import calculate_spectral_indices, calculate_sar_features, extract_phenology_metrics
from ai_models import classify_crop_type, detect_growth_stage, detect_moisture_stress, calculate_water_balance_and_advisory


def execute_gee_pipeline(csv_path=None):
    """Ingest the feature table exported by karnal_gee_pipeline.js."""
    from gee_runner import describe_gee_setup, ingest_gee_export

    print("STARTING GOOGLE EARTH ENGINE INGESTION PIPELINE")
    print(describe_gee_setup())
    output = ingest_gee_export(csv_path)
    print(
        "GEE INGESTION COMPLETE: "
        f"{output['summary']['total_fields_monitored']} features loaded"
    )
    return output

def execute_karnal_pipeline():
    print("=" * 70)
    print("STARTING SATELLITE AGRICULTURE & IRRIGATION PIPELINE FOR KARNAL REGION")
    print("=" * 70)
    
    # Stage 1: Load AOI & Field Samples
    print("[STAGE 1/8] Ingesting Karnal AOI, Tehsil Boundaries & Ground Samples...")
    fields = generate_field_samples(num_fields=60)
    bounds = generate_karnal_geojson_bounds()
    print(f" -> Generated {len(fields)} plot boundaries across 5 Karnal tehsils.")
    
    # Recent weather snapshot
    weather_latest = fetch_weather_data("2026-08-15")
    print(f" -> Ingested weather data: Temp={weather_latest['temp_c']}°C, Rain={weather_latest['rainfall_mm']}mm, ETo={weather_latest['eto_mm_day']}mm/day")

    processed_fields = []
    crop_counts = {}
    stage_counts = {}
    stress_counts = {}
    total_water_deficit_m3 = 0.0
    total_recommended_irrigation_ha = 0.0

    # Stage 2 to 6: Process each field through raw calibration, feature cube, AI model & water deficit engine
    print("[STAGE 2-6/8] Executing Calibration, Cloud/Speckle Filtering, Feature Extraction & AI Models...")
    
    for idx, f in enumerate(fields):
        # Generate raw observation simulation for field
        # Optical raw DNs
        raw_b2 = 1000 + int(np.random.uniform(-100, 200))
        raw_b3 = 1200 + int(np.random.uniform(-100, 300))
        raw_b4 = 900 + int(np.random.uniform(-100, 200))
        raw_b8 = 4200 + int(np.random.uniform(-500, 800))
        raw_b11 = 1800 + int(np.random.uniform(-300, 400))
        
        # Preprocess optical
        b2_boa = s2_radiometric_calibration(raw_b2)
        b3_boa = s2_radiometric_calibration(raw_b3)
        b4_boa = s2_radiometric_calibration(raw_b4)
        b8_boa = s2_radiometric_calibration(raw_b8)
        b11_boa = s2_radiometric_calibration(raw_b11)
        
        # Preprocess SAR
        raw_sar_vv = 120 + np.random.uniform(-20, 30)
        raw_sar_vh = 70 + np.random.uniform(-15, 20)
        vv_db = sar_dn_to_db(raw_sar_vv)
        vh_db = sar_dn_to_db(raw_sar_vh)
        vv_filtered = float(sar_refined_lee_filter(vv_db))
        vh_filtered = float(sar_refined_lee_filter(vh_db))
        
        # Feature Extraction
        indices = calculate_spectral_indices(b2_boa, b3_boa, b4_boa, b8_boa, b11_boa)
        sar_feats = calculate_sar_features(vv_filtered, vh_filtered)
        
        # Build 10-date temporal profile for NDVI/SAR time series chart
        temporal_profile = []
        base_ndvi = indices["NDVI"]
        for d_idx, date in enumerate(SEASON_DATES[:10]):
            season_progress = d_idx / 10.0
            # Bell curve for crop growth profile
            curve_factor = np.sin(season_progress * np.pi)
            step_ndvi = float(np.clip(0.15 + (base_ndvi - 0.15) * curve_factor + np.random.uniform(-0.03, 0.03), 0.1, 0.9))
            step_sar_vv = float(round(-16.0 + curve_factor * 5.0 + np.random.uniform(-0.5, 0.5), 2))
            temporal_profile.append({
                "date": date,
                "ndvi": round(step_ndvi, 3),
                "ndwi": round(step_ndvi * 0.4 - 0.1, 3),
                "sar_vv_db": step_sar_vv
            })
            
        phenology_metrics = extract_phenology_metrics([t["ndvi"] for t in temporal_profile], SEASON_DATES[:10])
        
        # AI Models
        crop_classification = classify_crop_type(
            {"max_ndvi": phenology_metrics["peak_ndvi"], "mean_ndmi": indices["NDMI"]},
            sar_feats
        )
        detected_crop = crop_classification["crop_type"]
        crop_counts[detected_crop] = crop_counts.get(detected_crop, 0) + 1
        
        season_pct = np.random.uniform(0.3, 0.7) # Mid-season view
        stage = detect_growth_stage(detected_crop, indices["NDVI"], season_pct)
        stage_counts[stage] = stage_counts.get(stage, 0) + 1
        
        # Moisture Stress Detection
        recent_rain = weather_latest["rainfall_mm"]
        stress = detect_moisture_stress(
            indices["NDVI"], indices["NDWI"], indices["NDMI"],
            sar_feats["VV_dB"], weather_latest["eto_mm_day"], recent_rain
        )
        stress_cat = stress["stress_category"]
        stress_counts[stress_cat] = stress_counts.get(stress_cat, 0) + 1
        
        # Water Deficit Estimation & Irrigation Advisory Engine
        water_adv = calculate_water_balance_and_advisory(
            detected_crop, stage, weather_latest["eto_mm_day"], recent_rain, stress_cat
        )
        
        # Accumulate metrics
        area_ha = f["area_acres"] * 0.404686
        field_deficit_m3 = (water_adv["water_deficit_mm"] / 1000.0) * (area_ha * 10000.0)
        total_water_deficit_m3 += field_deficit_m3
        if water_adv["recommended_depth_mm"] > 0:
            total_recommended_irrigation_ha += area_ha
            
        field_record = {
            "field_id": f["field_id"],
            "tehsil": f["tehsil"],
            "canal_branch": f["canal_branch"],
            "lat": f["lat"],
            "lon": f["lon"],
            "area_acres": f["area_acres"],
            "area_ha": round(area_ha, 2),
            "soil_type": f["soil_type"],
            "crop_type": detected_crop,
            "crop_confidence": crop_classification["confidence"],
            "growth_stage": stage,
            "moisture_stress": stress_cat,
            "stress_score": stress["stress_score"],
            "indices": indices,
            "sar_features": sar_feats,
            "phenology": phenology_metrics,
            "water_balance": water_adv,
            "temporal_profile": temporal_profile
        }
        processed_fields.append(field_record)

    # Stage 7 & 8: Build Output Products & Web Platform Payload
    print("[STAGE 7-8/8] Assembling Regional Analytics & Web GIS Data Bundles...")
    
    summary_stats = {
        "region_name": "Karnal District, Haryana, India",
        "timestamp": datetime.now().isoformat(),
        "total_fields_monitored": len(fields),
        "total_area_ha": round(sum(f["area_ha"] for f in processed_fields), 2),
        "crop_distribution": crop_counts,
        "growth_stage_distribution": stage_counts,
        "moisture_stress_distribution": stress_counts,
        "total_weekly_water_deficit_m3": round(total_water_deficit_m3, 1),
        "area_requiring_irrigation_ha": round(total_recommended_irrigation_ha, 2),
        "tehsils": TEHSILS,
        "canal_networks": CANAL_NETWORKS,
        "latest_weather": weather_latest
    }
    
    # Create GeoJSON Features for Web Map Rendering
    geojson_fields = []
    for f in processed_fields:
        # Create small polygon around field center lat/lon
        lat, lon = f["lat"], f["lon"]
        d = 0.003
        poly = [
            [round(lon - d, 5), round(lat - d, 5)],
            [round(lon + d, 5), round(lat - d, 5)],
            [round(lon + d, 5), round(lat + d, 5)],
            [round(lon - d, 5), round(lat + d, 5)],
            [round(lon - d, 5), round(lat - d, 5)]
        ]
        
        geojson_fields.append({
            "type": "Feature",
            "properties": {
                "field_id": f["field_id"],
                "tehsil": f["tehsil"],
                "canal_branch": f["canal_branch"],
                "crop_type": f["crop_type"],
                "growth_stage": f["growth_stage"],
                "moisture_stress": f["moisture_stress"],
                "water_deficit_mm": f["water_balance"]["water_deficit_mm"],
                "recommended_depth_mm": f["water_balance"]["recommended_depth_mm"],
                "canal_priority_score": f["water_balance"]["canal_priority_score"],
                "advisory_text": f["water_balance"]["advisory_text"],
                "ndvi": f["indices"]["NDVI"],
                "ndwi": f["indices"]["NDWI"],
                "sar_vv": f["sar_features"]["VV_dB"],
                "area_acres": f["area_acres"]
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [poly]
            }
        })
        
    geojson_collection = {
        "type": "FeatureCollection",
        "features": geojson_fields
    }

    full_output = {
        "summary": summary_stats,
        "fields": processed_fields,
        "geojson": geojson_collection
    }
    
    os.makedirs("data", exist_ok=True)
    with open("data/karnal_pipeline_output.json", "w") as f:
        json.dump(full_output, f, indent=2)
        
    print("=" * 70)
    print("PIPELINE EXECUTION COMPLETE! Output saved to data/karnal_pipeline_output.json")
    print(f"Monitored Fields: {len(fields)} | Water Deficit: {summary_stats['total_weekly_water_deficit_m3']} m³")
    print("=" * 70)
    return full_output

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run the Karnal AgriSense pipeline")
    parser.add_argument(
        "--mode",
        choices=("local", "gee"),
        default=os.getenv("AGRISENSE_PIPELINE_MODE", "local"),
        help="local generates the fallback dataset; gee ingests the GEE table export",
    )
    parser.add_argument(
        "--csv",
        default=None,
        help="optional path to a downloaded GEE feature CSV when --mode gee is used",
    )
    args = parser.parse_args()

    if args.mode == "gee":
        try:
            execute_gee_pipeline(args.csv)
        except (FileNotFoundError, ValueError) as exc:
            parser.error(str(exc))
    else:
        execute_karnal_pipeline()
