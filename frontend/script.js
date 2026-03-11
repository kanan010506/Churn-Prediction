// ── Tab switching ──────────────────────────────────
function switchTab(id, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('panel-' + id).classList.add('active');
  if (id === 'compare') buildCompareChart();
  if (id === 'insights') buildFeatChart();
}

// ── Prediction logic ───────────────────────────────
let predictionInFlight = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setPredictLoading(isLoading, text = '⚡ Run Prediction') {
  const btn = document.querySelector('.predict-btn');
  const label = document.getElementById('predictBtnText');
  if (!btn || !label) return;
  btn.classList.toggle('loading', isLoading);
  btn.disabled = isLoading;
  label.textContent = text;
}

function showPlaceholderMessage(message) {
  const placeholder = document.getElementById('resultPlaceholder');
  const content = document.getElementById('resultContent');
  const placeholderText = document.querySelector('#resultPlaceholder p');
  if (placeholder) placeholder.style.display = 'flex';
  if (content) content.style.display = 'none';
  if (placeholderText) placeholderText.textContent = message;
}

async function pollUntilModelReady() {
  for (let i = 0; i < 90; i += 1) {
    const statusRes = await fetch('/api/model-status');
    if (!statusRes.ok) throw new Error('Could not read model status');
    const status = await statusRes.json();
    if (status.status === 'ready') return;
    if (status.status === 'error') throw new Error(status.error || 'Model training failed');
    showPlaceholderMessage('Model loading... this can take ~30 seconds on first run.');
    await sleep(1000);
  }
  throw new Error('Model is still training. Please retry in a few seconds.');
}

async function predict() {
  if (predictionInFlight) return;
  predictionInFlight = true;
  setPredictLoading(true, 'Running prediction...');
  showPlaceholderMessage('Running prediction...');

  const payload = {
    tenure: +document.getElementById('tenure').value,
    monthlyCharges: +document.getElementById('monthlyCharges').value,
    contract: document.getElementById('contract').value,
    paymentMethod: document.getElementById('paymentMethod').value,
    paperlessBilling: document.getElementById('paperlessBilling').value,
    internetService: document.getElementById('internetService').value,
    seniorCitizen: +document.getElementById('seniorCitizen').value,
    partner: document.getElementById('partner').value,
    dependents: document.getElementById('dependents').value,
    onlineSecurity: document.getElementById('onlineSecurity').value,
    onlineBackup: document.getElementById('onlineBackup').value,
    deviceProtection: document.getElementById('deviceProtection').value,
    techSupport: document.getElementById('techSupport').value,
  };

  try {
    let res = await fetch('/api/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.status === 202) {
      showPlaceholderMessage('Model loading... this can take ~30 seconds on first run.');
      setPredictLoading(true, 'Model loading...');
      await pollUntilModelReady();
      setPredictLoading(true, 'Running prediction...');
      res = await fetch('/api/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    if (!res.ok) throw new Error('Prediction request failed');

    const result = await res.json();
    renderPrediction(result);
  } catch (err) {
    console.error(err);
    showPlaceholderMessage(`Prediction failed: ${err.message}`);
  } finally {
    predictionInFlight = false;
    setPredictLoading(false, '⚡ Run Prediction');
  }
}

function renderPrediction(result) {
  const score = Math.max(0, Math.min(100, Number(result.score ?? 0)));
  document.getElementById('resultPlaceholder').style.display = 'none';
  document.getElementById('resultContent').style.display = 'flex';
  document.getElementById('resultContent').style.flexDirection = 'column';
  document.getElementById('resultContent').style.gap = '16px';

  const circumference = 251;
  const offset = circumference - (score / 100) * circumference;
  const fill = document.getElementById('gaugeFill');
  fill.style.transition = 'stroke-dashoffset 1s cubic-bezier(0.22,1,0.36,1)';
  fill.style.strokeDashoffset = offset;
  document.getElementById('gaugePct').textContent = score + '%';

  const riskText = result.riskLabel || 'LOW RISK';
  const riskSub = result.riskSub || 'Customer likely to stay';
  const isChurn = Boolean(result.isChurn);
  const riskColor = riskText === 'HIGH RISK' ? 'var(--danger)'
    : riskText === 'MEDIUM RISK' ? 'var(--warn)'
      : 'var(--safe)';

  document.getElementById('riskLabel').textContent = riskText;
  document.getElementById('riskLabel').style.color = riskColor;
  document.getElementById('riskSub').textContent = riskSub;

  const verdict = document.getElementById('verdictBox');
  verdict.className = 'verdict-box ' + (isChurn ? 'verdict-churn' : 'verdict-stay');
  document.getElementById('verdictMain').textContent = isChurn ? '⚠️ CHURN' : '✅ NOT CHURN';

  const factors = Array.isArray(result.riskFactors) ? result.riskFactors : [];
  document.getElementById('riskFactors').innerHTML = factors.map(f => `
    <div class="risk-factor-item">
      <span style="font-size:0.78rem;width:130px;flex-shrink:0;">${f.name}</span>
      <div class="risk-factor-bar-wrap">
        <div class="risk-factor-bar" style="width:${f.val}%;background:${f.val > 60 ? 'var(--danger)' : f.val > 35 ? 'var(--warn)' : 'var(--safe)'}"></div>
      </div>
      <span style="font-family:var(--font-mono);font-size:0.72rem;color:var(--muted);width:32px;text-align:right;">${f.val}%</span>
    </div>
  `).join('');
}

// ── Compare chart (notebook metrics — static is correct here) ──────
const compareData = [
  { metric: 'Accuracy', lr: 73.2, rf: 75.6, gb: 74.2, xgb: 74.1 },
  { metric: 'Precision', lr: 50.0, rf: 53.0, gb: 51.0, xgb: 51.0 },
  { metric: 'Recall', lr: 79.0, rf: 76.0, gb: 78.0, xgb: 78.0 },
  { metric: 'F1 Score', lr: 61.0, rf: 63.0, gb: 62.0, xgb: 62.0 },
  { metric: 'ROC-AUC', lr: 83.7, rf: 83.7, gb: 84.0, xgb: 83.9 },
  { metric: 'CV ROC-AUC', lr: 84.9, rf: 84.9, gb: 84.6, xgb: 84.5 },
];

function buildCompareChart() {
  const el = document.getElementById('compareChartInner');
  if (el.innerHTML !== '') return;
  el.innerHTML = compareData.map(d => `
    <div class="compare-bar-group">
      <div class="compare-bar-label">${d.metric}</div>
      <div class="compare-bars">
        <div class="compare-bar-row">
          <div class="model-tag tag-lr">LR</div>
          <div class="cbar-outer"><div class="cbar-inner cbar-lr" data-w="${d.lr}" style="width:0%"></div></div>
          <div class="cbar-num">${d.lr}%</div>
        </div>
        <div class="compare-bar-row">
          <div class="model-tag tag-rf">RF</div>
          <div class="cbar-outer"><div class="cbar-inner cbar-rf" data-w="${d.rf}" style="width:0%"></div></div>
          <div class="cbar-num">${d.rf}%</div>
        </div>
        <div class="compare-bar-row">
          <div class="model-tag tag-gb">GB</div>
          <div class="cbar-outer"><div class="cbar-inner cbar-gb" data-w="${d.gb}" style="width:0%"></div></div>
          <div class="cbar-num" style="font-weight:600;color:var(--accent)">${d.gb}%</div>
        </div>
        <div class="compare-bar-row">
          <div class="model-tag tag-xgb">XG</div>
          <div class="cbar-outer"><div class="cbar-inner cbar-xgb" data-w="${d.xgb}" style="width:0%"></div></div>
          <div class="cbar-num">${d.xgb}%</div>
        </div>
      </div>
    </div>
  `).join('');
  setTimeout(() => {
    document.querySelectorAll('.cbar-inner').forEach(b => {
      b.style.width = b.dataset.w + '%';
    });
  }, 50);
}

// ── Feature importance chart — FIXED: live from model, no hardcoding ──
const palette = ['#00d4ff', '#22d3ee', '#38bdf8', '#60a5fa', '#818cf8', '#a78bfa', '#c084fc',
  '#e879f9', '#f472b6', '#fb7185', '#f87171', '#fbbf24', '#34d399', '#6ee7b7', '#a7f3d0'];

const engineeredFeatures = new Set([
  'ChargesPerTenure', 'IsNewCustomer', 'IsLongTermCustomer', 'NumServices',
  'HasInternet', 'EasyLeaver', 'FiberNoAddons', 'SoloCustomer', 'NoProtection', 'HighRiskCombo',
]);

async function buildFeatChart() {
  const el = document.getElementById('featImpChart');
  if (el.innerHTML !== '') return;

  el.innerHTML = '<div style="color:var(--muted);font-size:0.8rem;font-family:var(--font-mono);padding:8px 0;">Loading from model...</div>';

  try {
    const res = await fetch('/api/model-insights');

    if (res.status === 202) {
      el.innerHTML = '';  // reset so retry works on next tab visit
      return;
    }

    const data = await res.json();
    const top15 = Object.entries(data.importances).slice(0, 15);
    const maxVal = top15[0][1];

    el.innerHTML = top15.map(([name, pct], i) => `
      <div class="feat-bar-row">
        <div class="feat-name">${name}${engineeredFeatures.has(name) ? '<span class="new-feat-dot"></span>' : ''}</div>
        <div class="feat-bar-outer">
          <div class="feat-bar-inner" data-w="${((pct / maxVal) * 100).toFixed(1)}"
               style="width:0%;background:${palette[i] || palette[14]}"></div>
        </div>
        <div class="feat-pct">${pct.toFixed(1)}%</div>
      </div>
    `).join('');

    setTimeout(() => {
      document.querySelectorAll('.feat-bar-inner').forEach(b => {
        b.style.width = b.dataset.w + '%';
      });
    }, 60);

  } catch (err) {
    el.innerHTML = '';  // reset for retry
  }
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab, btn));
});

document.getElementById('predictBtn').addEventListener('click', predict);