const express = require('express');
const cors = require('cors');
const helmet = require('helmet'); 
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT           = path.join(__dirname, '..');                            
const MODEL_PATH     = path.join(ROOT, 'ml', 'model', 'churn_model.joblib');
const TRAIN_SCRIPT   = path.join(ROOT, 'ml', 'train_model.py');
const PREDICT_SCRIPT = path.join(ROOT, 'ml', 'predict.py');
const INSIGHTS_SCRIPT = path.join(ROOT, 'ml', 'insights.py');

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10kb' }));  
app.use(express.static(path.join(ROOT, 'frontend')));                         // ← serves frontend/

function runPython(scriptPath, payload) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [scriptPath], {
      cwd: ROOT,                                                               // ← run from project root
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `Python script failed with code ${code}`));
        return;
      }
      resolve(stdout.trim());
    });

    if (payload !== undefined) {
      child.stdin.write(JSON.stringify(payload));
    }

    child.stdin.end();
  });
}

let modelTrainingPromise = null;
let modelStatus = {
  status: fs.existsSync(MODEL_PATH) ? 'ready' : 'missing',
  startedAt: null,
  finishedAt: null,
  error: null,
};

function refreshModelStatusFromDisk() {
  const modelExists = fs.existsSync(MODEL_PATH);

  if (modelExists && modelStatus.status !== 'training') {
    modelStatus = {
      status: 'ready',
      startedAt: modelStatus.startedAt,
      finishedAt: modelStatus.finishedAt || new Date().toISOString(),
      error: null,
    };
    return;
  }

  if (!modelExists && modelStatus.status !== 'training') {
    modelStatus = {
      status: 'missing',
      startedAt: null,
      finishedAt: null,
      error: null,
    };
  }
}

function startModelTraining() {
  refreshModelStatusFromDisk();

  if (modelStatus.status === 'ready') {
    return Promise.resolve();
  }

  if (modelTrainingPromise) {
    return modelTrainingPromise;
  }

  modelStatus = {
    status: 'training',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  };

  modelTrainingPromise = runPython(TRAIN_SCRIPT)
    .then((output) => {
      if (output) {
        console.log(output);
      }
      if (!fs.existsSync(MODEL_PATH)) {
        throw new Error('Training finished but model artifact was not created.');
      }
      modelStatus = {
        status: 'ready',
        startedAt: modelStatus.startedAt,
        finishedAt: new Date().toISOString(),
        error: null,
      };
    })
    .catch((err) => {
      modelStatus = {
        status: 'error',
        startedAt: modelStatus.startedAt,
        finishedAt: new Date().toISOString(),
        error: err.message,
      };
      throw err;
    })
    .finally(() => {
      modelTrainingPromise = null;
    });

  return modelTrainingPromise;
}

app.post('/api/predict', async (req, res) => {
  try {
    refreshModelStatusFromDisk();

    if (modelStatus.status !== 'ready') {
      startModelTraining().catch((err) => {
        console.error('Background model training failed:', err.message);
      });
      return res.status(202).json({
        status: 'loading',
        message: 'Model is training. Please retry shortly.',
      });
    }

    const output = await runPython(PREDICT_SCRIPT, req.body || {});
    const prediction = JSON.parse(output);
    res.json(prediction);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Prediction failed',
      details: err.message,
    });
  }
});

// ── NEW: Model insights — reads importance_map from the saved artifact ──
app.get('/api/model-insights', async (_req, res) => {
  refreshModelStatusFromDisk();

  if (modelStatus.status !== 'ready') {
    return res.status(202).json({ status: 'loading' });
  }

  try {
    const output = await runPython(INSIGHTS_SCRIPT);
    res.json(JSON.parse(output));
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Failed to load model insights',
      details: err.message,
    });
  }
});

app.get('/api/model-status', (_req, res) => {
  refreshModelStatusFromDisk();
  res.json(modelStatus);
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// app.listen must be last
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  startModelTraining().catch((err) => {
    console.error('Initial model training failed:', err.message);
  });
});