import csv
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / 'data'
DATA_DIR.mkdir(exist_ok=True)


def _as_float(value):
    if value is None or value == '':
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return value


def _normalize_row(row):
    normalized = {}
    for key, value in row.items():
        normalized[key] = _as_float(value)
    return normalized


def csv_to_geojson(csv_path: str | Path, output_path: str | Path | None = None):
    """Convert a GEE CSV export into a GeoJSON FeatureCollection and app-compatible JSON."""
    csv_path = Path(csv_path)
    output_path = Path(output_path) if output_path else csv_path.with_suffix('.geojson')

    features = []
    field_records = []
    with csv_path.open('r', encoding='utf-8', newline='') as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []
        longitude_key = next((name for name in fieldnames if name.lower() in {'longitude', 'lon', 'x', 'long'}), None)
        latitude_key = next((name for name in fieldnames if name.lower() in {'latitude', 'lat', 'y', 'lat_1'}), None)

        if not longitude_key or not latitude_key:
            raise ValueError(
                f'CSV is missing longitude/latitude columns. Available columns: {fieldnames}'
            )

        for row in reader:
            norm = _normalize_row(row)
            lon = norm.get(longitude_key)
            lat = norm.get(latitude_key)
            if lon is None or lat is None:
                continue

            props = {k: v for k, v in norm.items() if k not in {longitude_key, latitude_key}}
            features.append({
                'type': 'Feature',
                'geometry': {'type': 'Point', 'coordinates': [float(lon), float(lat)]},
                'properties': props
            })

            field_id = props.get('field_id') or props.get('fieldId') or props.get('system:index') or f'GEE-FIELD-{len(field_records)+1}'
            tehsil = props.get('tehsil') or props.get('region') or 'Karnal'
            canal_branch = props.get('canal_branch') or props.get('canalBranch') or 'Karnal Main Branch'
            area_acres = props.get('area_acres') or props.get('areaAcres') or 5.0
            area_ha = props.get('area_ha') or props.get('areaHa') or float(area_acres) * 0.404686
            crop_type = props.get('crop_type') or props.get('cropType') or props.get('classification') or 'Paddy (Rice)'
            crop_confidence = props.get('crop_confidence') or props.get('cropConfidence') or 0.8
            growth_stage = props.get('growth_stage') or props.get('growthStage') or props.get('stage') or 'Mid-season Growth'
            moisture_stress = props.get('moisture_stress') or props.get('moistureStress') or props.get('stress') or 'Low Stress'
            stress_score = props.get('stress_score') or props.get('stressScore') or 25.0
            water_deficit_mm = props.get('water_deficit_mm') or props.get('waterDeficitMm') or 15.0
            recommended_depth_mm = props.get('recommended_depth_mm') or props.get('recommendedDepthMm') or 25.0
            canal_priority_score = props.get('canal_priority_score') or props.get('canalPriorityScore') or 6.0
            ndvi = props.get('NDVI') or props.get('ndvi') or 0.5
            ndwi = props.get('NDWI') or props.get('ndwi') or 0.1
            ndmi = props.get('NDMI') or props.get('ndmi') or 0.2
            sar_vv = props.get('VV_dB') or props.get('sar_vv') or props.get('VV') or -15.0

            field_records.append({
                'field_id': str(field_id),
                'tehsil': str(tehsil),
                'canal_branch': str(canal_branch),
                'lat': float(lat),
                'lon': float(lon),
                'area_acres': float(area_acres),
                'area_ha': float(area_ha),
                'soil_type': props.get('soil_type') or props.get('soilType') or 'Alluvial Loam',
                'crop_type': str(crop_type),
                'crop_confidence': float(crop_confidence),
                'growth_stage': str(growth_stage),
                'moisture_stress': str(moisture_stress),
                'stress_score': float(stress_score),
                'indices': {
                    'NDVI': float(ndvi),
                    'NDWI': float(ndwi),
                    'NDMI': float(ndmi),
                    'EVI': props.get('EVI') or props.get('evi') or 0.5,
                    'SAVI': props.get('SAVI') or props.get('savi') or 0.4,
                    'MNDWI': props.get('MNDWI') or props.get('mndwi') or 0.1,
                },
                'sar_features': {
                    'VV_dB': float(sar_vv),
                    'VH_dB': props.get('VH_dB') or props.get('vh_db') or -21.0,
                    'VV_VH_ratio': props.get('VV_VH_ratio') or props.get('vv_vh_ratio') or 6.0,
                    'GLCM_contrast': props.get('GLCM_contrast') or props.get('glcm_contrast') or 2.0,
                    'GLCM_entropy': props.get('GLCM_entropy') or props.get('glcm_entropy') or 1.0,
                    'GLCM_homogeneity': props.get('GLCM_homogeneity') or props.get('glcm_homogeneity') or 0.4,
                },
                'phenology': {
                    'sos_date': props.get('sos_date') or '2025-07-01',
                    'peak_date': props.get('peak_date') or '2025-09-15',
                    'peak_ndvi': float(ndvi),
                    'eos_date': props.get('eos_date') or '2025-11-15',
                    'lgp_days': props.get('lgp_days') or 120,
                },
                'water_balance': {
                    'water_deficit_mm': float(water_deficit_mm),
                    'recommended_depth_mm': float(recommended_depth_mm),
                    'canal_priority_score': float(canal_priority_score),
                    'advisory_text': props.get('advisory_text') or 'Irrigation scheduling should prioritize this parcel based on current vegetation and stress signal.'
                },
                'temporal_profile': []
            })

    summary = {
        'region_name': 'Karnal District, Haryana, India',
        'timestamp': '2026-09-07T00:00:00Z',
        'total_fields_monitored': len(field_records),
        'total_area_ha': round(sum(f['area_ha'] for f in field_records), 2),
        'crop_distribution': dict(Counter(f['crop_type'] for f in field_records)),
        'growth_stage_distribution': dict(Counter(f['growth_stage'] for f in field_records)),
        'moisture_stress_distribution': dict(Counter(f['moisture_stress'] for f in field_records)),
        'total_weekly_water_deficit_m3': round(sum(f['water_balance']['water_deficit_mm'] for f in field_records) * 1000.0, 2),
        'area_requiring_irrigation_ha': round(sum(f['area_ha'] for f in field_records if f['water_balance']['recommended_depth_mm'] > 0), 2),
        'latest_weather': {
            'date': '2026-08-15',
            'rainfall_mm': 18.4,
            'temp_c': 31.2,
            'rh_percent': 83.6,
            'eto_mm_day': 4.1
        }
    }

    geojson_output = {'type': 'FeatureCollection', 'features': features}
    app_output = {'summary': summary, 'fields': field_records, 'geojson': geojson_output}

    output_path.write_text(json.dumps(app_output, indent=2), encoding='utf-8')
    geojson_path = output_path.with_suffix('.geojson')
    geojson_path.write_text(json.dumps(geojson_output, indent=2), encoding='utf-8')
    print(f'Converted CSV to app JSON: {csv_path} -> {output_path}')
    print(f'Converted CSV to GeoJSON: {csv_path} -> {geojson_path}')
    return app_output


if __name__ == '__main__':
    candidates = [
        DATA_DIR / 'Karnal_GEE_Field_Features.csv',
        DATA_DIR / 'karnal_gee_field_features.csv',
        DATA_DIR / 'gee_output.csv',
    ] + sorted(DATA_DIR.glob('Karnal_Field_Features_*.csv'))
    csv_path = next((p for p in candidates if p.exists()), None)

    if csv_path:
        csv_to_geojson(csv_path, DATA_DIR / 'karnal_gee_output.json')
    else:
        print('No GEE CSV found in data/. Place a downloaded GEE CSV export there first.')
