const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

function findPipelineDataPath(preferGee = false) {
  const primaryPath = path.join(__dirname, 'data', 'karnal_pipeline_output.json');
  const geeLocalPath = path.join(__dirname, 'data', 'karnal_gee_output.json');

  if (preferGee && fs.existsSync(geeLocalPath)) return geeLocalPath;
  if (fs.existsSync(primaryPath)) return primaryPath;
  if (fs.existsSync(geeLocalPath)) return geeLocalPath;

  const dataDir = path.join(__dirname, 'data');
  if (fs.existsSync(dataDir)) {
    const csvFiles = fs.readdirSync(dataDir)
      .filter(file => file.toLowerCase().endsWith('.csv'))
      .sort();
    if (csvFiles.length > 0) {
      const csvPath = path.join(dataDir, csvFiles[0]);
      const scriptPath = path.join(__dirname, 'pipeline', 'csv_to_geojson.py');
      const { execFileSync } = require('child_process');
      try {
        execFileSync('python', [scriptPath], { cwd: __dirname });
        return path.join(__dirname, 'data', 'karnal_gee_output.json');
      } catch (err) {
        console.error('CSV conversion failed:', err.message);
      }
    }
  }

  return null;
}

// Get complete Karnal pipeline output
app.get('/api/data', (req, res) => {
  const preferGee = req.query.source === 'gee' || process.env.AGRISENSE_PIPELINE_MODE === 'gee';
  const dataPath = findPipelineDataPath(preferGee);

  if (dataPath && fs.existsSync(dataPath)) {
    const raw = fs.readFileSync(dataPath, 'utf8');
    try {
      res.json(JSON.parse(raw));
    } catch (e) {
      res.status(500).json({ error: 'Pipeline JSON is invalid', details: e.message });
    }
    return;
  }

  res.status(404).json({ error: 'Pipeline output not found. Please run pipeline or place a GEE CSV export in the data folder.' });
});

// Trigger dynamic pipeline execution
app.post('/api/run-pipeline', (req, res) => {
  console.log('Triggering Karnal Satellite Pipeline execution...');
  const requestedMode = req.body && req.body.mode === 'gee' ? 'gee' : (process.env.AGRISENSE_PIPELINE_MODE || 'local');
  const pipelineCommand = requestedMode === 'gee'
    ? 'python pipeline/run_pipeline.py --mode gee'
    : 'python pipeline/run_pipeline.py && python pipeline/gee_local_export.py';

  exec(pipelineCommand, (error, stdout, stderr) => {
    if (error) {
      console.error('Pipeline execution error:', stderr);
      return res.status(500).json({ error: `${requestedMode} pipeline execution failed`, details: stderr });
    }
    console.log('Pipeline executed successfully:', stdout);

    const dataPath = findPipelineDataPath(requestedMode === 'gee');
    if (dataPath && fs.existsSync(dataPath)) {
      const raw = fs.readFileSync(dataPath, 'utf8');
      return res.json({ success: true, stdout, data: JSON.parse(raw) });
    }
    res.json({ success: true, stdout });
  });
});

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`Karnal AgriSense Web GIS Platform listening on port ${PORT}`);
  console.log(`http://localhost:${PORT}`);
  console.log(`=======================================================`);
});
