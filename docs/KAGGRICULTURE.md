# Kaggriculture Lab

[`kaggriculture.html`](../kaggriculture.html) runs Kaggle's [Kaggriculture](https://www.kaggle.com/competitions/kaggriculture) game engine in the browser and compares farming strategies live. It needs no backend, so it works on the static Netlify site.

## How it fits together

| File | Job |
| --- | --- |
| `kaggriculture/engine/` | `kaggriculture.py` and its spec, copied unmodified from `kaggle-environments` 1.33.3 (Apache 2.0, `LICENSE` included) |
| `kaggriculture/runner.py` | Stands in for the parts of Kaggle's framework the engine relies on |
| `kaggriculture/main.py` | All strategies, and the competition entry `agent`. One self-contained file |
| `js/kaggriculture-worker.js` | Loads Pyodide from jsDelivr in a Web Worker and plays matches off the main thread |
| `js/kaggriculture.js` | Match view, replay, tournament and charts |

`kaggle_environments` itself has dozens of dependencies, including JAX and transformers, so it can't run in a browser. The engine is pure Python and imports only one helper from the framework, which is why this split works.

The first visit downloads about 10 MB of Pyodide. A match then takes about a second, and the browser's results match a native Python run.

## Checks

```bash
npm run check:kaggriculture          # App logic, wiring, and the engine's SHA-256
pip install kaggle-environments
npm run test:kaggriculture:engine    # Plays full matches on both, and compares every turn
```

The engine test compares farms, market, town, private state, status and rewards at each of the 720 turns.

On Windows, `pip install kaggle-environments` can fail because of long file paths in unrelated games. Either [enable long paths](https://learn.microsoft.com/windows/win32/fileio/maximum-file-path-limitation) or unpack the wheel to a short folder and set `PYTHONPATH` to it, with `kaggle_environments/envs` holding only `kaggriculture`.

## Updating the engine

1. Copy the new `kaggriculture.py` and `kaggriculture.json` into `kaggriculture/engine/`.
2. Update `ENGINE_VERSION` in `runner.py`, the version on the lab page and the hash in `tests/kaggriculture.test.js`.
3. Run both checks above.

## Submitting to Kaggle

`main.py` is ready to submit as a single file. Join the competition and accept its rules on Kaggle first.

```bash
cd kaggriculture
kaggle competitions submit kaggriculture -f main.py -m "Market planner v1"
```

## Limits

- Results are local matches between the strategies in this app. They aren't Kaggle leaderboard scores, and no agent has been submitted.
- Winning here may not carry over to the leaderboard. Scores vary a lot with the opponent, because two farms selling the same product crash its price.
- Agents sell their fertilizer and never use it on crops. They don't keep sheep, and rarely choose tomatoes or strawberries.
- Kaggriculture is a game with invented prices. Its results say nothing about real farms and aren't evidence for the Karnal advisory.
