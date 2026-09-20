from __future__ import annotations

import argparse
import os
from pathlib import Path

from build_master_demo import build

ROOT = Path(__file__).resolve().parent.parent
TEMPORAL = ROOT / "data" / "karnal_real_temporal_table.csv"
POINTS = ROOT / "data" / "karnal_real_features.csv"

def main():
    ap = argparse.ArgumentParser(
        description="Build AgriSense real-data 8-day master timeline."
    )
    ap.add_argument(
        "--satellite-dir",
        type=Path,
        default=Path(os.getenv("AGRISENSE_OLD_SATELLITE_DIR", ""))
            if os.getenv("AGRISENSE_OLD_SATELLITE_DIR")
            else None,
        help=(
            "Optional folder containing old Karnal_ARD_YYYY-MM-DD_tileN.tif files. "
            "Used only when data/karnal_real_temporal_table.csv does not yet exist."
        )
    )
    args = ap.parse_args()

    if not TEMPORAL.exists() and args.satellite_dir:
        from build_satellite_temporal import build as build_temporal
        print("Temporal CSV missing; building it from the old satellite GeoTIFFs...")
        build_temporal(args.satellite_dir, POINTS, TEMPORAL)

    if not TEMPORAL.exists():
        print(
            "WARNING: old satellite temporal table is missing. "
            "The 19-step weather timeline will still build, but satellite status "
            "will be 'unavailable'. To enable Fresh/Carried satellite states run:\n"
            "python pipeline/build_satellite_temporal.py --raster-dir <OLD_TIF_FOLDER>"
        )

    build()

if __name__ == "__main__":
    main()
