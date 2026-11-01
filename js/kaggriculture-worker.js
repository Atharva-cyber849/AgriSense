// Runs Kaggle's Python game engine in the browser, off the main thread.
const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';
const GAME_FILES = ['engine/kaggriculture.py', 'engine/kaggriculture.json', 'runner.py', 'main.py'];

let python = null;

async function boot() {
  importScripts(`${PYODIDE_URL}pyodide.js`);
  python = await loadPyodide({ indexURL: PYODIDE_URL });
  python.FS.mkdirTree('/game/engine');
  for (const file of GAME_FILES) {
    const response = await fetch(`../kaggriculture/${file}`);
    if (!response.ok) throw new Error(`Could not load ${file} (HTTP ${response.status})`);
    python.FS.writeFile(`/game/${file}`, await response.text());
  }
  python.runPython(`
import json, sys
sys.path.insert(0, '/game')
import js, runner

def play_json(a, b, seed, stream):
    on_frame = (lambda frame: js.postFrame(json.dumps(frame))) if stream else None
    result = runner.play(a, b, int(seed), on_frame=on_frame)
    if not stream:
        result.pop('frames')
    return json.dumps(result)
`);
}

self.postFrame = json => postMessage({ type: 'frame', id: self.currentId, frame: JSON.parse(json) });

const ready = boot();

self.onmessage = async ({ data }) => {
  try {
    await ready;
    if (data.type === 'boot') {
      postMessage({ type: 'ready' });
      return;
    }
    self.currentId = data.id;
    const playJson = python.globals.get('play_json');
    const result = JSON.parse(playJson(data.a, data.b, data.seed, Boolean(data.stream)));
    playJson.destroy();
    postMessage({ type: 'result', id: data.id, result });
  } catch (error) {
    postMessage({ type: 'error', id: data.id, message: String(error.message || error) });
  }
};
