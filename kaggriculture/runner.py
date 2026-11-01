"""Runs Kaggle's unmodified Kaggriculture interpreter without the full framework.

kaggle_environments needs dozens of packages, which rules out the browser, but the
game itself is one pure-Python file. This module supplies just the framework behaviour
that file depends on. tests/test_kaggriculture_engine.py checks it plays identically to
kaggle_environments.make("kaggriculture").
"""
import copy
import importlib
import json
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE_DIR = os.path.join(HERE, "engine")
ENGINE_VERSION = "1.33.3"


class Struct(dict):
    """Dict with attribute access, like kaggle_environments' structify."""

    def __getattr__(self, name):
        try:
            return self[name]
        except KeyError as error:
            raise AttributeError(name) from error

    def __setattr__(self, name, value):
        self[name] = value


def _resolve_episode_seed(env):
    """Same result as kaggle_environments.utils.resolve_episode_seed for a given seed."""
    seed = env.configuration.get("seed")
    env.configuration["seed"] = None
    env.info["seed"] = seed
    return seed


def load_engine():
    """Import the vendored interpreter, giving it only the helper it needs."""
    if "kaggle_environments" not in sys.modules:
        package = types.ModuleType("kaggle_environments")
        utils = types.ModuleType("kaggle_environments.utils")
        utils.resolve_episode_seed = _resolve_episode_seed
        package.utils = utils
        sys.modules["kaggle_environments"] = package
        sys.modules["kaggle_environments.utils"] = utils
    if ENGINE_DIR not in sys.path:
        sys.path.insert(0, ENGINE_DIR)
    return importlib.import_module("kaggriculture")


class Match:
    def __init__(self, seed, episode_steps=720):
        self.engine = load_engine()
        with open(os.path.join(ENGINE_DIR, "kaggriculture.json"), encoding="utf-8") as handle:
            spec = json.load(handle)
        configuration = {"episodeSteps": episode_steps}
        for key, value in spec["configuration"].items():
            if isinstance(value, dict):
                configuration[key] = copy.deepcopy(value.get("default"))
            elif key != "episodeSteps":
                configuration[key] = value
        configuration["seed"] = seed
        self.configuration = Struct(configuration)
        self.info = {}
        self.done = False
        self.state = [
            Struct(action=None, reward=0, status="ACTIVE", info={},
                   observation=Struct(player=i, private={}, remainingOverageTime=60))
            for i in range(2)
        ]
        self.state[0].observation.update(farms=[], market={}, town={}, day=0, hour=0, step=0)
        self.engine.interpreter(self.state, self)
        self.state[0].observation.step = 0

    @property
    def step_number(self):
        return self.state[0].observation.step

    @property
    def finished(self):
        return self.done or any(s.status != "ACTIVE" for s in self.state)

    def observation(self, player):
        """What an agent sees: shared state, plus its own private state only."""
        shared = self.state[0].observation
        return {
            "player": player,
            "step": shared.step,
            "day": shared.day,
            "hour": shared.hour,
            "farms": shared.farms,
            "market": shared.market,
            "town": shared.town,
            "private": copy.deepcopy(self.state[player].observation.private),
            "remainingOverageTime": 60,
        }

    def advance(self, actions):
        next_step = self.step_number + 1
        for player, action in enumerate(actions):
            self.state[player].action = action
        self.engine.interpreter(self.state, self)
        self.state[0].observation.step = next_step
        if next_step >= self.configuration.episodeSteps - 1:
            for s in self.state:
                if s.status == "ACTIVE":
                    s.status = "DONE"
        self.done = all(s.status == "DONE" for s in self.state)

    def money(self):
        return [float(farm["money"]) for farm in self.state[0].observation.farms]


TILE_CODES = {"WHEAT": "w", "CARROT": "c", "TOMATO": "t", "STRAWBERRY": "s", "MELON": "m",
              "GOOSE": "G", "COW": "C", "SHEEP": "S"}


def _tile_code(tile):
    if tile is None:
        return "."
    if tile == "LOCKED":
        return "#"
    kind = tile.get("kind")
    if kind == "WEED":
        return "x"
    if kind == "PLANT":
        return TILE_CODES[tile["crop"]]
    if "animal" in tile:
        return TILE_CODES[tile["animal"]]
    return "o"


def snapshot(match):
    """Compact end-of-turn view for charts and the replay."""
    shared = match.state[0].observation
    return {
        "step": shared.step,
        "day": shared.day,
        "hour": shared.hour,
        "money": match.money(),
        "tiles": ["".join(_tile_code(t) for row in farm["tiles"] for t in row) for farm in shared.farms],
        "hands": [len(farm["hands"]) for farm in shared.farms],
        "units": [[farm["farmer"]] + list(farm["hands"]) for farm in shared.farms],
        "land": [len(farm["unlocked_quadrants"]) for farm in shared.farms],
        "prices": dict(shared.market["prices"]),
        "shops": list(shared.town["unlocked_shops"]),
    }


def strategy_table():
    """Every playable strategy: engine built-ins plus the ones in main.py."""
    import main

    engine = load_engine()
    return {"pass": engine.pass_agent, "random": engine.random_agent, "starter": engine.starter_agent,
            **main.STRATEGIES}


def play(name_a, name_b, seed, episode_steps=720, on_frame=None, frame_every=24):
    """Play one match. An agent that raises passes that turn and the error is reported."""
    table = strategy_table()
    agents = [table[name_a], table[name_b]]
    match = Match(seed, episode_steps)
    errors = [None, None]
    frames = [snapshot(match)]
    while not match.finished:
        actions = []
        for player, agent in enumerate(agents):
            try:
                actions.append(agent(match.observation(player)))
            except Exception as error:  # A faulty strategy must not end the match.
                errors[player] = errors[player] or f"{type(error).__name__}: {error}"
                actions.append({"farmer": ["PASS"], "hands": [], "market": []})
        match.advance(actions)
        at_frame = match.step_number % frame_every == frame_every - 2 or match.finished
        if at_frame:
            frame = snapshot(match)
            frames.append(frame)
            if on_frame:
                on_frame(frame)
    money = match.money()
    return {"strategies": [name_a, name_b], "seed": seed, "final": money, "errors": errors,
            "winner": 0 if money[0] > money[1] else 1 if money[1] > money[0] else None,
            "frames": frames}
