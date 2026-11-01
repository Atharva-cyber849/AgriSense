"""
Irrigation policy simulator for rabi wheat in Karnal.

A daily FAO-56 root-zone water balance scored with the FAO-33 yield response:
    relative yield = 1 - Ky * (1 - ETa / ETc)

Policies decide every 8 days (the product's advisory period), from depletion and
climatology only: none of them sees future weather. Every policy runs on the same
seasons. Results are simulation outputs, not measured field savings.

Weather: ERA5 daily ET0 and precipitation at Karnal, from the Open-Meteo archive.
    python pipeline/policy_sim.py --fetch
"""
from __future__ import annotations

import argparse
import json
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
WEATHER_CSV = ROOT / "data" / "policy_sim" / "karnal_era5_daily.csv"
OUTPUT_JSON = ROOT / "data" / "policy_sim" / "results.json"

LAT, LON = 29.6857, 76.9905
FIRST_SEASON, LAST_SEASON = 2005, 2024  # Harvest-year start: 2024 means 2024-25.

# Crop assumptions (FAO-56 Tables 11, 12 and 22; FAO-33 for Ky).
SOWING_MONTH_DAY = (11, 15)
STAGE_DAYS = (20, 25, 60, 30)
KC_INI, KC_MID, KC_END = 0.40, 1.15, 0.35
DEPLETION_FRACTION = 0.55
KY = 1.0
ROOT_DEPTH_M = 1.0
AWC_MM_PER_M = 140.0  # Mid-range for the loam soils in Karnal_Soil_Stack_Static.tif.
EFFECTIVE_RAIN = 0.8
DECISION_DAYS = 8
ACTIONS_MM = (0, 25, 50, 75)

# Common farmer practice: days after sowing of each 75 mm irrigation.
FIXED_SCHEDULE_DAS = (21, 42, 65, 85, 105)
WATER_SHADOW_PRICE = 0.0005  # Yield fraction per mm, used only in the combined score.

# Shared-water case: one distributary, head to tail.
N_FIELDS = 120
CONVEYANCE_LOSS_AT_TAIL = 0.25
TAIL_FRACTION = 1 / 3
AWC_SPREAD = 0.25


@dataclass
class Season:
    label: str
    eto: np.ndarray
    rain: np.ndarray
    kc: np.ndarray


def fetch_weather():
    params = {
        "latitude": LAT,
        "longitude": LON,
        "start_date": f"{FIRST_SEASON}-11-01",
        "end_date": f"{LAST_SEASON + 1}-05-31",
        "daily": "et0_fao_evapotranspiration,precipitation_sum",
        "timezone": "Asia/Kolkata",
        "models": "era5",
    }
    url = "https://archive-api.open-meteo.com/v1/archive?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=120) as response:
        daily = json.load(response)["daily"]
    WEATHER_CSV.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame({
        "date": daily["time"],
        "eto_mm": daily["et0_fao_evapotranspiration"],
        "rain_mm": daily["precipitation_sum"],
    }).to_csv(WEATHER_CSV, index=False)


def kc_curve():
    ini, dev, mid, late = STAGE_DAYS
    return np.concatenate([
        np.full(ini, KC_INI),
        np.linspace(KC_INI, KC_MID, dev),
        np.full(mid, KC_MID),
        np.linspace(KC_MID, KC_END, late),
    ])


def load_seasons():
    weather = pd.read_csv(WEATHER_CSV, parse_dates=["date"]).set_index("date")
    kc = kc_curve()
    seasons = []
    for year in range(FIRST_SEASON, LAST_SEASON + 1):
        start = date(year, *SOWING_MONTH_DAY)
        days = pd.date_range(start, start + timedelta(days=len(kc) - 1))
        window = weather.loc[days]
        if window.isna().any().any():
            raise ValueError(f"Missing weather in season {year}")
        seasons.append(Season(
            f"{year}-{str(year + 1)[2:]}",
            window["eto_mm"].to_numpy(float),
            window["rain_mm"].to_numpy(float),
            kc,
        ))
    return seasons


def water_stress(depletion, taw):
    readily_available = DEPLETION_FRACTION * taw
    ks = (taw - depletion) / np.maximum(taw - readily_available, 1e-6)
    return np.clip(ks, 0.0, 1.0)


class Fields:
    """Vectorised root-zone state for a set of fields over one season."""

    def __init__(self, awc_mm_per_m):
        self.taw = np.asarray(awc_mm_per_m, float) * ROOT_DEPTH_M
        self.depletion = np.zeros_like(self.taw)  # Pre-sowing irrigation fills the profile.
        self.eta = np.zeros_like(self.taw)
        self.etc = 0.0
        self.stress_days = np.zeros_like(self.taw)
        self.applied = np.zeros_like(self.taw)

    def irrigate(self, delivered):
        self.depletion = np.maximum(0.0, self.depletion - delivered)

    def step(self, eto, rain, kc):
        etc = kc * eto
        self.depletion = np.maximum(0.0, self.depletion - EFFECTIVE_RAIN * rain)
        ks = water_stress(self.depletion, self.taw)
        eta = ks * etc
        self.depletion = np.minimum(self.taw, self.depletion + eta)
        self.eta += eta
        self.etc += etc
        self.stress_days += ks < 1.0

    def relative_yield(self):
        return np.maximum(0.0, 1.0 - KY * (1.0 - self.eta / max(self.etc, 1e-6)))


def demand_fao_rule(fields):
    """Current product rule: at the readily-available limit, refill to the nearest action."""
    triggered = fields.depletion >= DEPLETION_FRACTION * fields.taw * 0.75
    actions = np.asarray(ACTIONS_MM, float)
    nearest = actions[np.abs(fields.depletion[:, None] - actions[None, :]).argmin(axis=1)]
    return np.where(triggered, np.maximum(nearest, actions[1]), 0.0)


def demand_fixed(day):
    return 75.0 if any(day <= das < day + DECISION_DAYS for das in FIXED_SCHEDULE_DAS) else 0.0


def climatological_et(seasons, excluded):
    """Mean daily ETc of the other seasons: the only outlook the allocator gets."""
    return np.mean([s.kc * s.eto for s in seasons if s is not excluded], axis=0)


def et_saved(fields, mm, outlook):
    """ET kept over the next period if `mm` were delivered now, assuming no rain."""
    def stressed_et(start):
        depletion = start.copy()
        total = np.zeros_like(depletion)
        for etc in outlook:
            eta = water_stress(depletion, fields.taw) * etc
            depletion = np.minimum(fields.taw, depletion + eta)
            total += eta
        return total
    return stressed_et(np.maximum(0.0, fields.depletion - mm)) - stressed_et(fields.depletion)


def allocate_budget(fields, release, delivery_factor, outlook):
    """Give each 25 mm block to the field where it saves the most yield per mm released."""
    allocated = np.zeros_like(fields.taw)
    step = float(ACTIONS_MM[1])
    max_depth = float(ACTIONS_MM[-1])
    remaining = release
    while remaining > 0:
        probe = Fields(fields.taw)
        probe.depletion = np.maximum(0.0, fields.depletion - allocated)
        gain = et_saved(probe, step * delivery_factor, outlook) / step
        gain[allocated >= max_depth] = 0.0
        best = int(np.argmax(gain))
        if gain[best] <= 0 or remaining < step:
            break
        allocated[best] += step * delivery_factor
        remaining -= step
    return allocated


def head_first(demand_at_field, release, delivery_factor):
    """Status quo: upstream fields draw what they want until the release runs out."""
    delivered = np.zeros_like(demand_at_field)
    remaining = release
    for i, want in enumerate(demand_at_field):
        drawn = min(want / delivery_factor[i], remaining)
        delivered[i] = drawn * delivery_factor[i]
        remaining -= drawn
    return delivered, release - remaining


def summarise(fields, released, tail):
    y = fields.relative_yield()
    return {
        "water_mm": float(released / len(y)),
        "yield": float(y.mean()),
        "stressed_fields": float((fields.stress_days > 0).mean()),
        "stress_days": float(fields.stress_days.mean()),
        "tail_stress_days": float(fields.stress_days[tail].mean()),
        "head_stress_days": float(fields.stress_days[~tail].mean()),
        "tail_yield": float(y[tail].mean()),
        "head_yield": float(y[~tail].mean()),
    }


def run_single_field(season, policy, awc):
    fields = Fields([awc])
    used = 0.0
    for day in range(len(season.kc)):
        if day % DECISION_DAYS == 0:
            want = demand_fixed(day) if policy == "fixed" else float(demand_fao_rule(fields)[0])
            fields.irrigate(np.array([want]))
            used += want
        fields.step(season.eto[day], season.rain[day], season.kc[day])
    return {
        "water_mm": used,
        "yield": float(fields.relative_yield()[0]),
        "stress_days": float(fields.stress_days[0]),
    }


def run_shared(season, policy, season_release_mm, outlook_curve, awc=AWC_MM_PER_M, record=False):
    """
    All policies share one seasonal volume. Each rotation may draw the remaining
    volume divided by the rotations left, so unspent water rolls forward and a
    schedule with few irrigation dates is not capped by a per-step limit.
    """
    position = np.linspace(0, 1, N_FIELDS)
    # Deterministic soil spread, decoupled from canal position.
    spread = np.sin(np.arange(N_FIELDS) * 2.399963)
    fields = Fields(awc * (1 + AWC_SPREAD * spread))
    delivery_factor = 1 - CONVEYANCE_LOSS_AT_TAIL * position
    tail = position >= 1 - TAIL_FRACTION
    remaining_volume = season_release_mm * N_FIELDS
    decision_days = range(0, len(season.kc), DECISION_DAYS)
    released = 0.0
    history = []
    for day in range(len(season.kc)):
        if day % DECISION_DAYS == 0:
            if policy == "fixed":
                rotations_left = sum(demand_fixed(d) > 0 for d in decision_days if d >= day)
            else:
                rotations_left = sum(1 for d in decision_days if d >= day)
            available = remaining_volume / max(rotations_left, 1)
            if policy == "budget":
                # Each reach gets its own share; within it, water goes where it saves most.
                outlook = outlook_curve[day:day + DECISION_DAYS]
                delivered = np.zeros(N_FIELDS)
                used = 0.0
                for band, factor in _reaches(delivery_factor):
                    probe = Fields(fields.taw[band])
                    probe.depletion = fields.depletion[band]
                    allocated = allocate_budget(probe, available * band.mean(), factor, outlook)
                    delivered[band] = allocated
                    used += allocated.sum() / factor
            else:
                want = (
                    np.full(N_FIELDS, demand_fixed(day))
                    if policy == "fixed"
                    else demand_fao_rule(fields)
                )
                delivered, used = head_first(want, available, delivery_factor)
            fields.irrigate(delivered)
            released += used
            remaining_volume -= used
            if record:
                history.append({
                    "day": day,
                    "depletion_ratio": np.round(fields.depletion / fields.taw, 2).tolist(),
                })
        fields.step(season.eto[day], season.rain[day], season.kc[day])
    result = summarise(fields, released, tail)
    if record:
        result["replay"] = history
    return result


def _reaches(delivery_factor, count=3):
    """Three equal canal reaches, as in warabandi rotation planning."""
    edges = np.linspace(0, len(delivery_factor), count + 1).astype(int)
    for start, end in zip(edges[:-1], edges[1:]):
        mask = np.zeros(len(delivery_factor), bool)
        mask[start:end] = True
        yield mask, float(delivery_factor[start:end].mean())


def bootstrap_mean_ci(values, n=4000, seed=7):
    rng = np.random.default_rng(seed)
    values = np.asarray(values, float)
    means = rng.choice(values, size=(n, len(values))).mean(axis=1)
    return [round(float(np.percentile(means, 2.5)), 1), round(float(np.percentile(means, 97.5)), 1)]


def mean_across(rows, keys):
    return {k: round(float(np.mean([r[k] for r in rows])), 3) for k in keys}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--fetch", action="store_true", help="Download the ERA5 weather first.")
    args = ap.parse_args()
    if args.fetch or not WEATHER_CSV.exists():
        fetch_weather()

    seasons = load_seasons()

    # 1. Single field, unlimited water.
    single = {
        p: [run_single_field(s, p, AWC_MM_PER_M) for s in seasons]
        for p in ("fixed", "fao56")
    }
    single_keys = ["water_mm", "yield", "stress_days"]
    water_saving = [
        100 * (1 - b["water_mm"] / a["water_mm"])
        for a, b in zip(single["fixed"], single["fao56"])
    ]
    yield_change = [
        100 * (b["yield"] - a["yield"])
        for a, b in zip(single["fixed"], single["fao56"])
    ]

    # 2. Shared distributary. The release is a share of what the FAO-56 rule draws unconstrained.
    unconstrained = float(np.mean([
        run_shared(s, "fao56", 1e9, None)["water_mm"] for s in seasons
    ]))
    scenarios = {}
    for share in (0.5, 0.7, 0.85):
        release = share * unconstrained
        rows = {
            p: [run_shared(s, p, release, climatological_et(seasons, s)) for s in seasons]
            for p in ("fixed", "fao56", "budget")
        }
        keys = list(rows["fixed"][0].keys())
        scenarios[str(share)] = {
            "release_mm_per_season": round(share * unconstrained, 1),
            "policies": {p: mean_across(r, keys) for p, r in rows.items()},
            "tail_stress_days_cut_vs_fixed_pct": round(100 * (1 - (
                np.mean([r["tail_stress_days"] for r in rows["budget"]])
                / np.mean([r["tail_stress_days"] for r in rows["fixed"]])
            )), 1),
            "by_season": {
                p: [{
                    "season": s.label,
                    "yield": round(x["yield"], 3),
                    "water_mm": round(x["water_mm"], 1),
                    "tail_stress_days": round(x["tail_stress_days"], 1),
                } for s, x in zip(seasons, r)]
                for p, r in rows.items()
            },
        }

    # 3. Sensitivity of the headline to the two assumptions it depends on most.
    sensitivity = []
    for awc in (100.0, 140.0, 180.0):
        for das in ((21, 65, 105), (21, 45, 85, 105), FIXED_SCHEDULE_DAS, (21, 35, 50, 65, 85, 105)):
            saved, dy = [], []
            for s in seasons:
                base = _run_fixed_schedule(s, das, awc)
                rule = run_single_field(s, "fao56", awc)
                saved.append(100 * (1 - rule["water_mm"] / base["water_mm"]))
                dy.append(100 * (rule["yield"] - base["yield"]))
            sensitivity.append({
                "awc_mm_per_m": awc,
                "fixed_irrigations": len(das),
                "water_saving_pct": round(float(np.mean(saved)), 1),
                "yield_change_pts": round(float(np.mean(dy)), 1),
            })

    # 4. Replay: driest season on record at the middle release level.
    driest = int(np.argmin([s.rain.sum() for s in seasons]))
    replay_share = "0.7"
    replay_release = float(replay_share) * unconstrained
    replay = {
        "season": seasons[driest].label,
        "rain_mm": round(float(seasons[driest].rain.sum()), 1),
        "share": float(replay_share),
        "policies": {
            p: run_shared(
                seasons[driest], p, replay_release,
                climatological_et(seasons, seasons[driest]), record=True,
            )["replay"]
            for p in ("fixed", "budget")
        },
    }

    payload = {
        "crop": "Wheat (rabi)",
        "seasons": len(seasons),
        "season_range": f"{seasons[0].label} to {seasons[-1].label}",
        "weather_source": "ERA5 via Open-Meteo archive, grid cell nearest Karnal (29.69N, 76.99E)",
        "status": "Simulation result, not measured field savings.",
        "assumptions": {
            "sowing": "15 Nov",
            "stage_days": STAGE_DAYS,
            "kc": [KC_INI, KC_MID, KC_END],
            "depletion_fraction_p": DEPLETION_FRACTION,
            "ky": KY,
            "root_depth_m": ROOT_DEPTH_M,
            "awc_mm_per_m": AWC_MM_PER_M,
            "effective_rain_fraction": EFFECTIVE_RAIN,
            "decision_days": DECISION_DAYS,
            "actions_mm": ACTIONS_MM,
            "fixed_schedule": {"das": FIXED_SCHEDULE_DAS, "depth_mm": 75},
            "shared": {
                "fields": N_FIELDS,
                "conveyance_loss_at_tail": CONVEYANCE_LOSS_AT_TAIL,
                "tail_fraction": TAIL_FRACTION,
                "awc_spread": AWC_SPREAD,
            },
            "water_shadow_price_per_mm": WATER_SHADOW_PRICE,
        },
        "single_field": {
            "policies": {p: mean_across(r, single_keys) for p, r in single.items()},
            "water_saving_pct": round(float(np.mean(water_saving)), 1),
            "water_saving_ci95": bootstrap_mean_ci(water_saving),
            "yield_change_pts": round(float(np.mean(yield_change)), 1),
            "yield_change_ci95": bootstrap_mean_ci(yield_change),
            "combined_score": {
                p: round(float(np.mean([x["yield"] - WATER_SHADOW_PRICE * x["water_mm"] for x in r])), 3)
                for p, r in single.items()
            },
        },
        "shared_water": {
            "unconstrained_demand_mm": round(unconstrained, 1),
            "scenarios": scenarios,
        },
        "sensitivity": sensitivity,
        "replay": replay,
    }
    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")

    print(json.dumps(payload["single_field"], indent=1))
    for share, scenario in scenarios.items():
        print("release", share, scenario["release_mm_per_season"], "mm; tail cut vs fixed", scenario["tail_stress_days_cut_vs_fixed_pct"], "%")
        for p, v in scenario["policies"].items():
            print(" ", p, v)
    print(pd.DataFrame(sensitivity).to_string(index=False))


def _run_fixed_schedule(season, das_list, awc):
    fields = Fields([awc])
    used = 0.0
    for day in range(len(season.kc)):
        if day % DECISION_DAYS == 0:
            want = 75.0 if any(day <= das < day + DECISION_DAYS for das in das_list) else 0.0
            fields.irrigate(np.array([want]))
            used += want
        fields.step(season.eto[day], season.rain[day], season.kc[day])
    return {"water_mm": used, "yield": float(fields.relative_yield()[0])}


if __name__ == "__main__":
    main()
