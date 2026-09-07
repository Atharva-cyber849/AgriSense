"""Bridge the Earth Engine export folder into the local AgriSense app schema.

Earth Engine JavaScript runs in the Code Editor, not as a normal local Node or
Python script. This module therefore handles the local half of that workflow:
find the CSV exported by karnal_gee_pipeline.js and convert it to app JSON.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Iterable

try:
    from .csv_to_geojson import csv_to_geojson
except ImportError:
    from csv_to_geojson import csv_to_geojson

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
GEE_SCRIPT = ROOT / "pipeline" / "karnal_gee_pipeline.js"
OUTPUT_PATH = DATA_DIR / "karnal_gee_output.json"


def _export_candidates() -> Iterable[Path]:
    preferred = [
        DATA_DIR / "Karnal_GEE_Field_Features.csv",
        DATA_DIR / "karnal_gee_field_features.csv",
        DATA_DIR / "gee_output.csv",
    ]
    seen = set()
    for path in preferred + sorted(DATA_DIR.glob("Karnal_Field_Features_*.csv")):
        if path not in seen:
            seen.add(path)
            yield path


def find_gee_export() -> Path | None:
    """Return the newest known GEE app-feature CSV, if it exists."""
    existing = [path for path in _export_candidates() if path.exists()]
    return max(existing, key=lambda path: path.stat().st_mtime) if existing else None


def ingest_gee_export(csv_path: str | Path | None = None) -> dict:
    """Convert a downloaded GEE app-feature CSV to the app JSON format."""
    source = Path(csv_path) if csv_path else find_gee_export()
    if source is None:
        raise FileNotFoundError(
            "No GEE feature CSV found in data/. Run karnal_gee_pipeline.js in "
            "the Earth Engine Code Editor, run its table export, and place the "
            "downloaded CSV in data/."
        )
    if not source.exists():
        raise FileNotFoundError(f"GEE export does not exist: {source}")

    DATA_DIR.mkdir(exist_ok=True)
    output = csv_to_geojson(source, OUTPUT_PATH)
    output["summary"]["source"] = "Google Earth Engine export"
    output["summary"]["source_csv"] = source.name
    output["summary"]["ingested_at"] = datetime.now().isoformat()
    OUTPUT_PATH.write_text(__import__("json").dumps(output, indent=2), encoding="utf-8")
    print(f"GEE export ingested: {source.name} -> {OUTPUT_PATH.name}")
    return output


def describe_gee_setup() -> str:
    return (
        f"GEE script ready: {GEE_SCRIPT}\n"
        "Run it in https://code.earthengine.google.com, execute the "
        "Karnal_Field_Features_<YEAR> table task, download the CSV into data/, "
        "then rerun this command."
    )


if __name__ == "__main__":
    ingest_gee_export()
