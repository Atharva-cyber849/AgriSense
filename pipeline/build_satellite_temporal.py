from __future__ import annotations

import argparse
import re
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio
from pyproj import Transformer
from tqdm import tqdm

# First-script canonical band layout.
OPTICAL_BANDS = [
    "B2", "B3", "B4", "B8", "B11", "B12",
    "NDVI", "NDWI", "NDMI", "EVI", "SAVI"
]
SAR_BANDS = ["VV", "VH", "VV_VH_ratio_raw"]
ALL_BANDS = OPTICAL_BANDS + SAR_BANDS

SAT_RE = re.compile(
    r"^Karnal_ARD_(\d{4}-\d{2}-\d{2})_tile(\d+)(?:-\d+)?\.tif$",
    re.I
)

# GEE/rasterio description aliases seen in old exports.
ALIASES = {
    "vv_vh_ratio": "VV_VH_ratio_raw",
    "vv/vh_ratio": "VV_VH_ratio_raw",
    "vvvh_ratio": "VV_VH_ratio_raw",
    "vv_vh_ratio_raw": "VV_VH_ratio_raw",
}


def valid_number(value, nodata=None):
    if np.ma.is_masked(value):
        return False
    try:
        value = float(value)
    except (TypeError, ValueError):
        return False
    if not np.isfinite(value):
        return False
    if nodata is not None:
        try:
            if np.isfinite(float(nodata)) and np.isclose(value, float(nodata)):
                return False
        except Exception:
            pass
    return not np.isclose(value, -9999.0)


def normalize_description(name):
    if name is None:
        return None
    raw = str(name).strip()
    if not raw:
        return None

    # Exact canonical match first.
    for canonical in ALL_BANDS:
        if raw.lower() == canonical.lower():
            return canonical

    key = raw.lower().replace(" ", "_")
    return ALIASES.get(key)


def detect_band_layout(ds):
    """
    Return [(canonical_name, 1-based raster band index), ...].

    The OLD GEE script can legitimately export different band counts:
      14 bands = optical + SAR
      11 bands = optical only
       3 bands = SAR only

    This happens when one sensor has no scenes in a period. It is not file
    corruption. We preserve missing sensor values as NaN.
    """
    descriptions = list(ds.descriptions or [])

    # Prefer embedded GeoTIFF band descriptions when they are usable.
    described = []
    for i, desc in enumerate(descriptions, start=1):
        canonical = normalize_description(desc)
        if canonical is not None:
            described.append((canonical, i))

    if len(described) == ds.count and len({x[0] for x in described}) == ds.count:
        return described, "geotiff_descriptions"

    # Safe fallbacks based on the known first-script export layout.
    if ds.count == 14:
        return list(zip(ALL_BANDS, range(1, 15))), "known_full_14_band_layout"

    if ds.count == 11:
        return list(zip(OPTICAL_BANDS, range(1, 12))), "known_optical_only_11_band_layout"

    if ds.count == 3:
        return list(zip(SAR_BANDS, range(1, 4))), "known_sar_only_3_band_layout"

    raise ValueError(
        f"{Path(ds.name).name}: unsupported band count {ds.count}. "
        f"Descriptions={descriptions}. Supported old-script layouts are "
        "14 (optical+SAR), 11 (optical only), or 3 (SAR only)."
    )


def discover(raster_dir: Path):
    rows = []
    for p in raster_dir.rglob("*.tif"):
        m = SAT_RE.match(p.name)
        if m:
            rows.append({
                "path": p,
                "period_start": m.group(1),
                "tile_id": int(m.group(2))
            })

    if not rows:
        raise FileNotFoundError(
            f"No old satellite tiles found below {raster_dir}. "
            "Expected names like Karnal_ARD_2025-06-01_tile0.tif"
        )

    return pd.DataFrame(rows).sort_values(["period_start", "tile_id"])


def inspect_layouts(catalog):
    """
    Inspect one file per period before the expensive 4,311-point sampling.
    This makes variable-band periods visible immediately.
    """
    print("\nDetected old-satellite period layouts:")
    print("-" * 72)

    rows = []
    for period, files in catalog.groupby("period_start"):
        path = Path(files.iloc[0]["path"])
        with rasterio.open(path) as ds:
            mapping, source = detect_band_layout(ds)
            names = [x[0] for x in mapping]
            row = {
                "period_start": period,
                "band_count": ds.count,
                "layout_source": source,
                "has_optical": int(any(x in OPTICAL_BANDS for x in names)),
                "has_sar": int(any(x in SAR_BANDS for x in names)),
                "bands": ",".join(names),
            }
            rows.append(row)

            sensor_label = (
                "OPTICAL + SAR"
                if row["has_optical"] and row["has_sar"]
                else "OPTICAL ONLY"
                if row["has_optical"]
                else "SAR ONLY"
                if row["has_sar"]
                else "UNKNOWN"
            )
            print(
                f"{period} | {ds.count:2d} bands | {sensor_label:13s} | "
                f"{source}"
            )

    print("-" * 72)
    return pd.DataFrame(rows)


def sample_period(period, files, points, layout_counter):
    # Same canonical output width for EVERY period.
    values = np.full(
        (len(points), len(ALL_BANDS)),
        np.nan,
        dtype=np.float64
    )

    band_pos = {name: i for i, name in enumerate(ALL_BANDS)}
    optical_source_tile = np.full(len(points), -1, dtype=np.int32)
    sar_source_tile = np.full(len(points), -1, dtype=np.int32)

    lons = points["longitude"].to_numpy(float)
    lats = points["latitude"].to_numpy(float)

    for _, item in files.iterrows():
        path = Path(item["path"])
        tile_id = int(item["tile_id"])

        with rasterio.open(path) as ds:
            layout, layout_source = detect_band_layout(ds)
            layout_counter[(ds.count, layout_source)] += 1

            canonical_names = [name for name, _ in layout]
            raster_indexes = [index for _, index in layout]

            transformer = Transformer.from_crs(
                "EPSG:4326",
                ds.crs,
                always_xy=True
            )
            xs, ys = transformer.transform(lons, lats)
            xs = np.asarray(xs)
            ys = np.asarray(ys)

            inside = (
                (xs >= ds.bounds.left) &
                (xs <= ds.bounds.right) &
                (ys >= ds.bounds.bottom) &
                (ys <= ds.bounds.top)
            )

            point_indexes = np.where(inside)[0]
            if not len(point_indexes):
                continue

            coords = list(zip(xs[point_indexes], ys[point_indexes]))

            for point_index, sample in zip(
                point_indexes,
                ds.sample(coords, indexes=raster_indexes, masked=True)
            ):
                sample = np.ma.asarray(sample)

                optical_seen = False
                sar_seen = False

                for local_i, canonical_name in enumerate(canonical_names):
                    value = sample[local_i]

                    if not valid_number(value, ds.nodata):
                        continue

                    dest = band_pos[canonical_name]

                    # Tile overlap is possible. Keep the first valid value.
                    if np.isnan(values[point_index, dest]):
                        values[point_index, dest] = float(value)

                    if canonical_name in OPTICAL_BANDS:
                        optical_seen = True
                    if canonical_name in SAR_BANDS:
                        sar_seen = True

                if optical_seen and optical_source_tile[point_index] < 0:
                    optical_source_tile[point_index] = tile_id
                if sar_seen and sar_source_tile[point_index] < 0:
                    sar_source_tile[point_index] = tile_id

    out = points[["field_id", "latitude", "longitude"]].copy()
    out["period_start"] = pd.to_datetime(period)

    for i, name in enumerate(ALL_BANDS):
        out[name] = values[:, i]

    # NEVER use the old VV/VH quotient for modelling.
    out["VV_VH_ratio_dB"] = out["VV"] - out["VH"]

    out["optical_valid"] = (
        out[["NDVI", "NDMI", "EVI", "SAVI"]]
        .notna()
        .any(axis=1)
    ).astype("int8")

    out["sar_valid"] = (
        out["VV"].notna() &
        out["VH"].notna()
    ).astype("int8")

    out["optical_source_tile"] = optical_source_tile
    out["sar_source_tile"] = sar_source_tile

    return out


def build(raster_dir: Path, points_csv: Path, output_csv: Path):
    points = pd.read_csv(points_csv)

    needed = ["field_id", "latitude", "longitude"]
    missing = [c for c in needed if c not in points.columns]
    if missing:
        raise ValueError(f"Point CSV missing columns: {missing}")

    points = points[needed].drop_duplicates("field_id").copy()
    points["latitude"] = pd.to_numeric(
        points["latitude"], errors="coerce"
    )
    points["longitude"] = pd.to_numeric(
        points["longitude"], errors="coerce"
    )
    points = (
        points
        .dropna(subset=["latitude", "longitude"])
        .reset_index(drop=True)
    )

    catalog = discover(raster_dir)

    print("Old satellite TIFFs:", len(catalog))
    print("Satellite periods:", catalog["period_start"].nunique())
    print("Fixed locations:", len(points))

    layout_df = inspect_layouts(catalog)

    frames = []
    layout_counter = Counter()

    grouped = list(catalog.groupby("period_start"))

    for period, files in tqdm(
        grouped,
        desc="Sampling old 16-day satellite"
    ):
        frames.append(
            sample_period(
                period,
                files,
                points,
                layout_counter
            )
        )

    temporal = pd.concat(frames, ignore_index=True)
    temporal = temporal.sort_values(
        ["field_id", "period_start"]
    ).reset_index(drop=True)

    output_csv.parent.mkdir(parents=True, exist_ok=True)

    temporal.to_csv(output_csv, index=False)

    layout_out = output_csv.with_name(
        output_csv.stem + "_period_layouts.csv"
    )
    layout_df.to_csv(layout_out, index=False)

    coverage = (
        temporal.groupby("period_start")
        .agg(
            point_count=("field_id", "count"),
            optical_valid_count=("optical_valid", "sum"),
            sar_valid_count=("sar_valid", "sum")
        )
        .reset_index()
    )
    coverage["optical_valid_pct"] = (
        100 * coverage["optical_valid_count"] /
        coverage["point_count"]
    )
    coverage["sar_valid_pct"] = (
        100 * coverage["sar_valid_count"] /
        coverage["point_count"]
    )

    coverage_out = output_csv.with_name(
        output_csv.stem + "_coverage.csv"
    )
    coverage.to_csv(coverage_out, index=False)

    parquet = output_csv.with_suffix(".parquet")
    try:
        temporal.to_parquet(parquet, index=False)
    except Exception as exc:
        print("Parquet skipped:", exc)

    print("\nSaved temporal table:", output_csv)
    print("Saved period layouts:", layout_out)
    print("Saved period coverage:", coverage_out)
    print("Rows:", len(temporal))
    print("Periods:", temporal["period_start"].nunique())

    print("\nRaster layout counts:")
    for key, count in sorted(layout_counter.items()):
        print(f"  {key}: {count} files")

    print("\nPer-period sensor coverage:")
    print(
        coverage[
            [
                "period_start",
                "optical_valid_pct",
                "sar_valid_pct"
            ]
        ].to_string(index=False)
    )

    return temporal


def main():
    ap = argparse.ArgumentParser(
        description=(
            "Build the old Karnal satellite temporal table while supporting "
            "full, optical-only, and SAR-only GEE exports."
        )
    )
    ap.add_argument(
        "--raster-dir",
        required=True,
        type=Path
    )
    ap.add_argument(
        "--points",
        type=Path,
        default=Path("data/karnal_real_features.csv")
    )
    ap.add_argument(
        "--output",
        type=Path,
        default=Path("data/karnal_real_temporal_table.csv")
    )

    args = ap.parse_args()

    build(
        args.raster_dir,
        args.points,
        args.output
    )


if __name__ == "__main__":
    main()
