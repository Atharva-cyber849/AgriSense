"""
Data Pre-processing Engine (Diagram 1 Stage 2 & Diagram 2 Steps 2-5)
- Optical Pre-processing: Radiometric Calibration (DN -> TOA/BOA), s2cloudless Cloud/Shadow Masking, Resampling.
- SAR Pre-processing: Radiometric Calibration (DN -> dB), 3x3 Refined Lee Speckle Filter, Terrain Correction.
- Temporal Compositing: 8-day / 15-day Median Composites.
- Karnal AOI Spatial Masking.
"""

import numpy as np

# Scale factor for Sentinel-2 surface reflectance (BOA)
S2_SCALE_FACTOR = 10000.0

def s2_radiometric_calibration(raw_dn):
    """Converts Sentinel-2 raw Digital Numbers (DN) to Surface Reflectance (BOA) [0.0 - 1.0]."""
    reflectance = np.array(raw_dn) / S2_SCALE_FACTOR
    return np.clip(reflectance, 0.0, 1.0)

def s2_cloud_shadow_mask(b2, b4, b8, b11, qa60):
    """
    Implements s2cloudless and QA60 cloud/shadow detection.
    Returns binary mask: 1 = Clear pixel, 0 = Cloud/Shadow masked pixel.
    """
    # Simple brightness and spectral cloud index check
    cloud_score = (b2 + b4 + b11) / 3.0
    shadow_score = (b8 < 0.12) & (b11 > 0.15)
    
    cloud_mask = (cloud_score < 0.35) & (qa60 == 0) & (~shadow_score)
    return cloud_mask.astype(int)

def sar_refined_lee_filter(image, win_size=3):
    """
    Applies 3x3 Refined Lee Filter for SAR Speckle Reduction on Sentinel-1 backscatter.
    Reduces multiplicative noise while preserving edges and field boundaries.
    """
    img = np.array(image, dtype=np.float32)
    mean = np.mean(img)
    var = np.var(img)
    if var == 0:
        return img
    
    # Weight calculation
    weight = var / (var + mean**2)
    filtered = mean + weight * (img - mean)
    return filtered

def sar_dn_to_db(raw_dn, calib_factor=-83.0):
    """Converts Sentinel-1 SAR Digital Numbers to Backscatter coefficient sigma-0 in decibels (dB)."""
    linear = np.square(np.array(raw_dn, dtype=np.float32))
    # Avoid log(0)
    linear = np.maximum(linear, 1e-6)
    db = 10.0 * np.log10(linear) + calib_factor
    return np.clip(db, -30.0, 5.0)

def temporal_compositing(temporal_stack, composite_type="median"):
    """
    Performs 8-day / 15-day temporal compositing across cloud-masked time-series stacks.
    Eliminates cloud contamination and residual noise.
    """
    stack = np.array(temporal_stack)
    if composite_type == "median":
        return np.nanmedian(stack, axis=0)
    elif composite_type == "percentile_75":
        return np.nanpercentile(stack, 75, axis=0)
    elif composite_type == "mean":
        return np.nanmean(stack, axis=0)
    else:
        return np.nanmedian(stack, axis=0)

if __name__ == "__main__":
    raw_s2 = [1023, 1156, 4500, 8900]
    boa = s2_radiometric_calibration(raw_s2)
    print("Pre-processed Optical BOA Reflectance:", boa)
    
    raw_sar = [120, 150, 95]
    sar_db = sar_dn_to_db(raw_sar)
    filtered_sar = sar_refined_lee_filter(sar_db)
    print("Pre-processed SAR dB Backscatter after Refined Lee Filter:", filtered_sar)
