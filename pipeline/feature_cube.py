"""
Feature Extraction & Multi-Source Feature Cube Assembly (Diagram 1 Stage 3 & Diagram 2 Steps 6 & 7)
- Spectral Indices: NDVI, NDWI, NDMI, EVI, SAVI, MNDWI
- SAR Features: VV, VH backscatter dB, VV/VH ratio
- Phenological Metrics: Start of Season (SOS), Peak Growth, Length of Growing Period (LGP)
- Multi-Source Feature Stack / Feature Cube (Time x Features)
"""

import numpy as np

def calculate_spectral_indices(b2, b3, b4, b8, b11):
    """
    Computes all standard agricultural & moisture spectral indices from Sentinel-2 bands.
    b2: Blue (490 nm)
    b3: Green (560 nm)
    b4: Red (665 nm)
    b8: NIR (842 nm)
    b11: SWIR1 (1610 nm)
    """
    eps = 1e-6
    
    # Normalized Difference Vegetation Index (NDVI)
    ndvi = (b8 - b4) / (b8 + b4 + eps)
    
    # Normalized Difference Water Index (NDWI)
    ndwi = (b3 - b8) / (b3 + b8 + eps)
    
    # Normalized Difference Moisture Index (NDMI)
    ndmi = (b8 - b11) / (b8 + b11 + eps)
    
    # Enhanced Vegetation Index (EVI)
    evi = 2.5 * (b8 - b4) / (b8 + 6.0 * b4 - 7.5 * b2 + 1.0 + eps)
    
    # Soil Adjusted Vegetation Index (SAVI)
    savi = 1.5 * (b8 - b4) / (b8 + b4 + 0.5 + eps)
    
    # Modified NDWI
    mndwi = (b3 - b11) / (b3 + b11 + eps)

    return {
        "NDVI": float(np.clip(ndvi, -1.0, 1.0)),
        "NDWI": float(np.clip(ndwi, -1.0, 1.0)),
        "NDMI": float(np.clip(ndmi, -1.0, 1.0)),
        "EVI": float(np.clip(evi, -1.0, 2.0)),
        "SAVI": float(np.clip(savi, -1.0, 1.0)),
        "MNDWI": float(np.clip(mndwi, -1.0, 1.0))
    }

def calculate_sar_features(vv_db, vh_db):
    """
    Calculates Sentinel-1 SAR features.
    vv_db: VV polarization in dB (-30 to +5)
    vh_db: VH polarization in dB (-35 to 0)
    """
    vv_vh_ratio = vv_db - vh_db  # Ratio in dB scale
    
    # GLCM texture proxy features
    contrast = abs(vv_db - vh_db) * 0.4
    entropy = (abs(vv_db) + abs(vh_db)) / 20.0
    homogeneity = 1.0 / (1.0 + contrast)

    return {
        "VV_dB": float(round(vv_db, 2)),
        "VH_dB": float(round(vh_db, 2)),
        "VV_VH_ratio": float(round(vv_vh_ratio, 2)),
        "GLCM_contrast": float(round(contrast, 3)),
        "GLCM_entropy": float(round(entropy, 3)),
        "GLCM_homogeneity": float(round(homogeneity, 3))
    }

def extract_phenology_metrics(ndvi_time_series, dates):
    """
    Extracts phenological parameters across a seasonal profile:
    - Start of Season (SOS): Date when NDVI exceeds 15% of amplitude
    - Peak Growth: Date and value of maximum NDVI
    - End of Season (EOS): Harvest date
    - Length of Growing Period (LGP): Days between SOS and EOS
    """
    ndvi_arr = np.array(ndvi_time_series)
    max_idx = np.argmax(ndvi_arr)
    max_val = ndvi_arr[max_idx]
    min_val = np.min(ndvi_arr)
    amp = max_val - min_val
    
    sos_thresh = min_val + 0.20 * amp
    sos_idx = 0
    for idx, v in enumerate(ndvi_arr[:max_idx]):
        if v >= sos_thresh:
            sos_idx = idx
            break
            
    eos_thresh = min_val + 0.25 * amp
    eos_idx = len(ndvi_arr) - 1
    for idx in range(max_idx, len(ndvi_arr)):
        if ndvi_arr[idx] <= eos_thresh:
            eos_idx = idx
            break
            
    return {
        "sos_date": dates[sos_idx],
        "peak_date": dates[max_idx],
        "peak_ndvi": float(round(max_val, 3)),
        "eos_date": dates[eos_idx],
        "lgp_days": (eos_idx - sos_idx) * 15 # 15-day compositing interval
    }

if __name__ == "__main__":
    indices = calculate_spectral_indices(b2=0.08, b3=0.12, b4=0.09, b8=0.45, b11=0.18)
    print("Calculated Spectral Indices:", indices)
    sar_feats = calculate_sar_features(-11.2, -16.8)
    print("Calculated SAR Features:", sar_feats)
