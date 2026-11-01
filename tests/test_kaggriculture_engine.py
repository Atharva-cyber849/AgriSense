"""Checks the browser runner plays identically to the official framework.

Needs `pip install kaggle-environments`. Run: python tests/test_kaggriculture_engine.py
"""
import importlib.util
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAME_DIR = os.path.join(ROOT, "kaggriculture")


def comparable(state):
    obs = state[0]["observation"]
    return json.dumps(
        {"farms": obs["farms"], "market": obs["market"], "town": obs["town"], "day": obs["day"],
         "hour": obs["hour"], "step": obs["step"],
         "private": [s["observation"]["private"] for s in state],
         "status": [s["status"] for s in state], "reward": [s["reward"] for s in state]},
        sort_keys=True,
    )


def main():
    from kaggle_environments import make

    official_engine = importlib.import_module("kaggle_environments.envs.kaggriculture.kaggriculture")
    with open(official_engine.__file__, "rb") as handle:
        official_bytes = handle.read().replace(b"\r\n", b"\n")
    with open(os.path.join(GAME_DIR, "engine", "kaggriculture.py"), "rb") as handle:
        assert handle.read().replace(b"\r\n", b"\n") == official_bytes, "vendored engine differs from package"
    print("engine file identical to kaggle_environments", official_engine.__file__)

    # Load the agents before the runner installs its stand-in framework module.
    sys.path.insert(0, GAME_DIR)
    import main as agents

    table = {"starter": official_engine.starter_agent, **agents.STRATEGIES}
    pairs = [("market_planner", "goose_ranch", 11), ("melon_rush", "staple_fields", 12),
             ("mixed_ranch", "starter", 13), ("wheat_loop", "market_planner", 14)]

    official_runs = []
    for a, b, seed in pairs:
        env = make("kaggriculture", configuration={"episodeSteps": 720, "seed": seed})
        env.reset(2)
        states = [comparable(env.state)]
        while not env.done:
            actions = [table[n](_official_obs(env, i))
                       for i, n in enumerate((a, b))]
            env.step(actions)
            states.append(comparable(env.state))
        official_runs.append(states)

    for name in [m for m in sys.modules if m == "kaggle_environments" or m.startswith("kaggle_environments.")]:
        del sys.modules[name]
    sys.modules.pop("kaggriculture", None)
    import runner

    for (a, b, seed), official in zip(pairs, official_runs):
        match = runner.Match(seed)
        states = [comparable(match.state)]
        while not match.finished:
            match.advance([table[n](match.observation(i)) for i, n in enumerate((a, b))])
            states.append(comparable(match.state))
        assert len(states) == len(official), f"{a}/{b}: {len(states)} vs {len(official)} steps"
        for step, (mine, theirs) in enumerate(zip(states, official)):
            assert mine == theirs, f"{a}/{b} seed {seed}: first difference at step {step}"
        final = json.loads(states[-1])["reward"]
        print(f"identical over {len(states)} states: {a} vs {b} seed {seed} -> {final}")
    print("PASS")


def _official_obs(env, player):
    shared = env.state[0]["observation"]
    own = env.state[player]["observation"]
    return {"player": player, "step": shared["step"], "day": shared["day"], "hour": shared["hour"],
            "farms": shared["farms"], "market": shared["market"], "town": shared["town"],
            "private": json.loads(json.dumps(own["private"]))}


if __name__ == "__main__":
    main()
