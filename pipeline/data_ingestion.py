"""
Data Ingestion Pipeline for Karnal Region (Diagram 1 & 2 Stage 1 & 2)
Optical Satellites: Sentinel-2 (10m - B2, B3, B4, B8, B11, B12)
Microwave SAR: Sentinel-1 (10m - VV, VH polarizations)
Ancillary IMD Weather: Rainfall (mm), Temp (°C), RH (%), ETo (mm/day)
Ground Information: Field samples across Karnal tehsils
"""

import numpy as np
import pandas as pd
from datetime import datetime, timedelta

# Target dates across typical cropping cycle in Karnal (Kharif Paddy -> Rabi Wheat)
SEASON_DATES = [
    "2026-06-15", "2026-07-01", "2026-07-15", "2026-08-01", "2026-08-15", "2026-09-01",
    "2026-09-15", "2026-10-01", "2026-10-15", "2026-11-01", "2026-11-15", "2026-12-01",
    "2026-12-15", "2027-01-01", "2027-01-15", "2027-02-01", "2027-02-15", "2027-03-01",
    "2027-03-15", "2027-04-01"
]

CROP_CLASSES = ["Paddy (Rice)", "Wheat", "Sugarcane", "Mustard", "Fodder/Vegetables"]

def fetch_weather_data(date_str):
    """Simulates/ingests IMD meteorological data for Karnal region."""
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    month = dt.month
    
    # Monsoon in Karnal: July - September
    if month in [7, 8, 9]:
        rainfall = np.random.uniform(5.0, 45.0) if np.random.rand() > 0.4 else 0.0
        temp = np.random.uniform(28.0, 35.0)
        rh = np.random.uniform(70.0, 92.0)
        eto = np.random.uniform(3.5, 5.0)
    elif month in [11, 12, 1, 2]: # Rabi winter
        rainfall = np.random.uniform(0.0, 12.0) if np.random.rand() > 0.8 else 0.0
        temp = np.random.uniform(10.0, 22.0)
        rh = np.random.uniform(50.0, 75.0)
        eto = np.random.uniform(2.0, 3.5)
    else: # Pre-monsoon/Summer
        rainfall = np.random.uniform(0.0, 20.0) if np.random.rand() > 0.7 else 0.0
        temp = np.random.uniform(32.0, 42.0)
        rh = np.random.uniform(35.0, 60.0)
        eto = np.random.uniform(5.5, 8.0)

    return {
        "date": date_str,
        "rainfall_mm": round(float(rainfall), 2),
        "temp_c": round(float(temp), 1),
        "rh_percent": round(float(rh), 1),
        "eto_mm_day": round(float(eto), 2)
    }

def generate_field_samples(num_fields=60):
    """Generates sample agricultural field plots across Karnal tehsils with coordinates and crop labels."""
    from karnal_aoi import TEHSILS
    
    fields = []
    field_id = 101
    
    for tehsil in TEHSILS:
        # Create 12 fields per tehsil
        for i in range(num_fields // len(TEHSILS)):
            # Random offset within Tehsil area
            lat = tehsil["lat"] + np.random.uniform(-0.04, 0.04)
            lon = tehsil["lon"] + np.random.uniform(-0.04, 0.04)
            area_acres = round(float(np.random.uniform(1.5, 8.5)), 2)
            
            # Assign crop based on tehsil primary crops
            crop = np.random.choice(tehsil["primary_crops"])
            if crop == "Poplar/Fodder" or crop == "Vegetables/Fodder":
                crop = "Fodder/Vegetables"
                
            fields.append({
                "field_id": f"KRN-FLD-{field_id}",
                "tehsil": tehsil["name"],
                "canal_branch": tehsil["canal_branch"],
                "lat": round(float(lat), 5),
                "lon": round(float(lon), 5),
                "area_acres": area_acres,
                "assigned_crop": crop,
                "soil_type": "Alluvial Loam" if i % 2 == 0 else "Clay Loam"
            })
            field_id += 1
            
    return fields

if __name__ == "__main__":
    fields = generate_field_samples()
    print(f"Generated {len(fields)} field ground samples across Karnal tehsils.")
    weather_sample = fetch_weather_data("2026-08-15")
    print("Sample weather data for August 15 in Karnal:", weather_sample)
