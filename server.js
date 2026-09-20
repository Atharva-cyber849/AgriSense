const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use('/private_models', (req, res) => {
  res.status(404).end();
});

app.use(express.static(__dirname));

const DATA_DIR = path.join(__dirname, 'data');
const MASTER_PATH = path.join(DATA_DIR, 'karnal_master_demo_output.json');
const PERIOD_DIR = path.join(DATA_DIR, 'periods');


const INFERENCE_HOST = process.env.AGRISENSE_INFERENCE_HOST || '127.0.0.1';
const INFERENCE_PORT = Number(process.env.AGRISENSE_INFERENCE_PORT || 8001);
const INFERENCE_BASE = `http://${INFERENCE_HOST}:${INFERENCE_PORT}`;
const AUTO_START_INFERENCE =
  String(process.env.AGRISENSE_AUTO_START_INFERENCE || '1') !== '0';

let inferenceProcess = null;

function startInferenceService() {
  if (!AUTO_START_INFERENCE || inferenceProcess) return;

  const venvPython = process.platform === 'win32'
    ? path.join(__dirname, '.venv', 'Scripts', 'python.exe')
    : path.join(__dirname, '.venv', 'bin', 'python');
  const python = process.env.PYTHON || (
    fs.existsSync(venvPython) ? venvPython : 'python'
  );
  const script = path.join(__dirname, 'pipeline', 'inference_service.py');

  if (!fs.existsSync(script)) {
    console.warn('Inference service script not found:', script);
    return;
  }

  inferenceProcess = spawn(
    python,
    [script],
    {
      cwd: path.join(__dirname, 'pipeline'),
      env: {
        ...process.env,
        AGRISENSE_INFERENCE_HOST: INFERENCE_HOST,
        AGRISENSE_INFERENCE_PORT: String(INFERENCE_PORT)
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );

  inferenceProcess.stdout.on('data', data => {
    process.stdout.write(`[Inference] ${data}`);
  });

  inferenceProcess.stderr.on('data', data => {
    process.stderr.write(`[Inference] ${data}`);
  });

  inferenceProcess.on('exit', code => {
    console.log(`Inference service exited with code ${code}`);
    inferenceProcess = null;
  });
}

async function inferenceFetch(relativePath) {
  const response = await fetch(`${INFERENCE_BASE}${relativePath}`, {
    headers: { Accept: 'application/json' }
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = { detail: `Inference HTTP ${response.status}` };
  }

  if (!response.ok) {
    const error = new Error(
      payload?.detail?.message ||
      payload?.detail ||
      `Inference HTTP ${response.status}`
    );
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

const periodCache = new Map();

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadMaster() {
  if (!fs.existsSync(MASTER_PATH)) return null;
  return readJson(MASTER_PATH);
}

function loadPeriod(periodStart) {
  if (periodCache.has(periodStart)) {
    return periodCache.get(periodStart);
  }

  const p = path.join(PERIOD_DIR, `${periodStart}.json`);
  if (!fs.existsSync(p)) return null;

  const payload = readJson(p);
  const byId = new Map(
    (payload.records || []).map(record => [String(record.field_id), record])
  );

  const cached = { payload, byId };
  periodCache.set(periodStart, cached);
  return cached;
}

app.get('/api/data', (req, res) => {
  const payload = loadMaster();

  if (!payload) {
    return res.status(404).json({
      error: 'Master demo data not found.',
      next_step: 'Run: python pipeline/run_pipeline.py'
    });
  }

  res.json(payload);
});

app.get('/api/period/:periodStart', (req, res) => {
  const cached = loadPeriod(req.params.periodStart);

  if (!cached) {
    return res.status(404).json({
      error: `Period not found: ${req.params.periodStart}`
    });
  }

  res.json(cached.payload);
});

app.get('/api/field-timeline/:fieldId', (req, res) => {
  const master = loadMaster();
  if (!master) {
    return res.status(404).json({ error: 'Master demo data not found.' });
  }

  const fieldId = String(req.params.fieldId);
  const timeline = [];

  for (const p of master.summary?.master_timeline || []) {
    const periodStart = p.period_start;
    const cached = loadPeriod(periodStart);
    const record = cached?.byId.get(fieldId);

    if (record) {
      timeline.push(record);
    }
  }

  res.json({
    field_id: fieldId,
    timeline
  });
});

app.get('/api/model-evaluation', (req, res) => {
  const p = path.join(DATA_DIR, 'model_evaluation.json');
  if (!fs.existsSync(p)) {
    return res.status(404).json({ error: 'model_evaluation.json not found' });
  }
  res.json(readJson(p));
});

app.get('/api/model-metadata', (req, res) => {
  const p = path.join(DATA_DIR, 'model_metadata.json');
  if (!fs.existsSync(p)) {
    return res.status(404).json({ error: 'model_metadata.json not found' });
  }
  res.json(readJson(p));
});


app.get('/api/inference/health', async (req, res) => {
  try {
    res.json(await inferenceFetch('/health'));
  } catch (error) {
    res.status(503).json({
      error: 'Inference service unavailable',
      details: error.payload || error.message
    });
  }
});

app.get('/api/inference/models', async (req, res) => {
  try {
    res.json(await inferenceFetch('/models'));
  } catch (error) {
    res.status(503).json({
      error: 'Inference service unavailable',
      details: error.payload || error.message
    });
  }
});

app.get('/api/inference/field/:fieldId', async (req, res) => {
  const fieldId = encodeURIComponent(req.params.fieldId);
  const asOf = req.query.as_of || req.query.period || '';
  const query = asOf ? `?as_of=${encodeURIComponent(asOf)}` : '';

  try {
    res.json(
      await inferenceFetch(`/predict/field/${fieldId}${query}`)
    );
  } catch (error) {
    res.status(
      Number.isInteger(error.status) ? error.status : 503
    ).json({
      error: 'Field inference failed',
      details: error.payload || error.message
    });
  }
});

app.get('/api/health', (req, res) => {
  const master = loadMaster();

  res.json({
    status: 'ok',
    mode: '8-day-master-timeline',
    master_ready: Boolean(master),
    master_period_count: master?.summary?.master_period_count || 0,
    satellite_temporal_available:
      Boolean(master?.summary?.satellite_temporal_available),
    period_cache_size: periodCache.size
  });
});

app.post('/api/run-pipeline', (req, res) => {
  const script = path.join(__dirname, 'pipeline', 'run_pipeline.py');
  const args = [script];

  if (req.body?.satellite_dir) {
    args.push('--satellite-dir', String(req.body.satellite_dir));
  }

  execFile(
    'python',
    args,
    { cwd: __dirname },
    (error, stdout, stderr) => {
      if (error) {
        return res.status(500).json({
          error: '8-day master pipeline failed',
          details: stderr || error.message,
          stdout
        });
      }

      periodCache.clear();

      const payload = loadMaster();
      if (!payload) {
        return res.status(500).json({
          error: 'Pipeline completed but master JSON was not created.',
          stdout
        });
      }

      res.json({
        success: true,
        stdout,
        data: payload
      });
    }
  );
});

startInferenceService();

app.listen(PORT, () => {
  console.log('=======================================================');
  console.log('AgriSense Karnal — 8-Day Master Timeline');
  console.log(`http://localhost:${PORT}`);
  console.log('=======================================================');
});


function stopInferenceService() {
  if (inferenceProcess && !inferenceProcess.killed) {
    inferenceProcess.kill();
  }
}

process.on('SIGINT', () => {
  stopInferenceService();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopInferenceService();
  process.exit(0);
});
