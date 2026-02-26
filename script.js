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
function predict() {
  const tenure   = +document.getElementById('tenure').value;
  const monthly  = +document.getElementById('monthlyCharges').value;
  const contract = document.getElementById('contract').value;
  const payment  = document.getElementById('paymentMethod').value;
  const paperless= document.getElementById('paperlessBilling').value;
  const internet = document.getElementById('internetService').value;
  const senior   = +document.getElementById('seniorCitizen').value;
  const partner  = document.getElementById('partner').value;
  const dependents = document.getElementById('dependents').value;
  const onlineSec   = document.getElementById('onlineSecurity').value === 'Yes';
  const onlineBack  = document.getElementById('onlineBackup').value === 'Yes';
  const deviceProt  = document.getElementById('deviceProtection').value === 'Yes';
  const techSupport = document.getElementById('techSupport').value === 'Yes';

  // Engineered features
  const isNewCustomer   = tenure <= 6;
  const isLongTerm      = tenure >= 24;
  const numServices     = [onlineSec, onlineBack, deviceProt, techSupport].filter(Boolean).length;
  const easyLeaver      = paperless === 'Yes' && payment === 'Electronic check';
  const fiberNoAddons   = internet === 'Fiber optic' && !onlineSec && !onlineBack && !deviceProt;
  const soloCustomer    = partner === 'No' && dependents === 'No';
  const noProtection    = !onlineSec && !onlineBack && !techSupport;
  const highRiskCombo   = contract === 'Month-to-month' && monthly > 65;

  // Weighted score
  let score = 0;
  if (contract === 'Month-to-month')  score += 22;
  else if (contract === 'One year')   score += 8;
  else                                score -= 15;
  if (isNewCustomer)   score += 18;
  if (isLongTerm)      score -= 15;
  if (fiberNoAddons)   score += 20;
  if (noProtection)    score += 16;
  if (easyLeaver)      score += 14;
  if (highRiskCombo)   score += 14;
  if (soloCustomer)    score += 8;
  if (senior === 1)    score += 6;
  score -= numServices * 3;
  if (monthly > 80)    score += 8;
  if (monthly < 35)    score -= 5;

  score = Math.max(5, Math.min(95, 20 + score));

  document.getElementById('resultPlaceholder').style.display = 'none';
  document.getElementById('resultContent').style.display     = 'flex';
  document.getElementById('resultContent').style.flexDirection = 'column';
  document.getElementById('resultContent').style.gap = '16px';

  const circumference = 251;
  const offset = circumference - (score / 100) * circumference;
  const fill = document.getElementById('gaugeFill');
  fill.style.transition = 'stroke-dashoffset 1s cubic-bezier(0.22,1,0.36,1)';
  fill.style.strokeDashoffset = offset;
  document.getElementById('gaugePct').textContent = score + '%';

  let riskColor, riskText, riskSub, isChurn;
  if (score >= 60)      { riskColor = 'var(--danger)'; riskText = 'HIGH RISK';   riskSub = 'Immediate retention action needed'; isChurn = true; }
  else if (score >= 40) { riskColor = 'var(--warn)';   riskText = 'MEDIUM RISK'; riskSub = 'Monitor closely — proactive outreach'; isChurn = score >= 50; }
  else                  { riskColor = 'var(--safe)';   riskText = 'LOW RISK';    riskSub = 'Customer likely to stay'; isChurn = false; }

  document.getElementById('riskLabel').textContent = riskText;
  document.getElementById('riskLabel').style.color = riskColor;
  document.getElementById('riskSub').textContent   = riskSub;

  const verdict = document.getElementById('verdictBox');
  verdict.className = 'verdict-box ' + (isChurn ? 'verdict-churn' : 'verdict-stay');
  document.getElementById('verdictMain').textContent = isChurn ? '⚠️ CHURN' : '✅ NOT CHURN';

  const factors = [
    { name: 'Contract Type',       val: contract === 'Month-to-month' ? 85 : contract === 'One year' ? 40 : 10 },
    { name: 'Fiber No Add-ons',    val: fiberNoAddons ? 90 : 5 },
    { name: 'No Protection Svcs',  val: noProtection ? 80 : 8 },
    { name: 'Easy Leaver',         val: easyLeaver ? 75 : 5 },
    { name: 'High Risk Combo',     val: highRiskCombo ? 78 : 10 },
    { name: 'New Customer',        val: isNewCustomer ? 70 : isLongTerm ? 5 : 25 },
  ].sort((a,b) => b.val - a.val).slice(0,4);

  const rf = document.getElementById('riskFactors');
  rf.innerHTML = factors.map(f => `
    <div class="risk-factor-item">
      <span style="font-size:0.78rem;width:130px;flex-shrink:0;">${f.name}</span>
      <div class="risk-factor-bar-wrap">
        <div class="risk-factor-bar" style="width:${f.val}%;background:${f.val>60?'var(--danger)':f.val>35?'var(--warn)':'var(--safe)'}"></div>
      </div>
      <span style="font-family:var(--font-mono);font-size:0.72rem;color:var(--muted);width:32px;text-align:right;">${f.val}%</span>
    </div>
  `).join('');
}

// ── Compare chart ──────────────────────────────────
const compareData = [
  { metric: 'Accuracy',    lr: 73.2, rf: 75.6, gb: 74.2, xgb: 74.1 },
  { metric: 'Precision',   lr: 50.0, rf: 53.0, gb: 51.0, xgb: 51.0 },
  { metric: 'Recall',      lr: 79.0, rf: 76.0, gb: 78.0, xgb: 78.0 },
  { metric: 'F1 Score',    lr: 61.0, rf: 63.0, gb: 62.0, xgb: 62.0 },
  { metric: 'ROC-AUC',     lr: 83.7, rf: 83.7, gb: 84.0, xgb: 83.9 },
  { metric: 'CV ROC-AUC',  lr: 84.9, rf: 84.9, gb: 84.6, xgb: 84.5 },
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

// ── Feature importance chart ───────────────────────
const features = [
  { name: 'tenure',              pct: 18.2, isNew: false },
  { name: 'MonthlyCharges',      pct: 16.1, isNew: false },
  { name: 'TotalCharges',        pct: 14.3, isNew: false },
  { name: 'ChargesPerTenure',    pct:  9.8, isNew: true  },
  { name: 'Contract_M2M',        pct:  8.7, isNew: false },
  { name: 'NumServices',         pct:  7.1, isNew: true  },
  { name: 'InternetService',     pct:  5.8, isNew: false },
  { name: 'TechSupport_No',      pct:  4.7, isNew: false },
  { name: 'OnlineSecurity_No',   pct:  4.1, isNew: false },
  { name: 'PaymentMethod',       pct:  3.8, isNew: false },
  { name: 'IsNewCustomer',       pct:  3.4, isNew: true  },
  { name: 'SeniorCitizen',       pct:  2.2, isNew: false },
  { name: 'FiberNoAddons',       pct:  1.8, isNew: true  },
  { name: 'EasyLeaver',          pct:  1.4, isNew: true  },
  { name: 'HighRiskCombo',       pct:  1.0, isNew: true  },
];

const palette = ['#00d4ff','#22d3ee','#38bdf8','#60a5fa','#818cf8','#a78bfa','#c084fc',
                 '#e879f9','#f472b6','#fb7185','#f87171','#fbbf24','#34d399','#6ee7b7','#a7f3d0'];

function buildFeatChart() {
  const el = document.getElementById('featImpChart');
  if (el.innerHTML !== '') return;
  el.innerHTML = features.map((f, i) => `
    <div class="feat-bar-row">
      <div class="feat-name">${f.name}${f.isNew ? '<span class="new-feat-dot"></span>' : ''}</div>
      <div class="feat-bar-outer"><div class="feat-bar-inner" data-w="${(f.pct/18.2*100).toFixed(1)}" style="width:0%;background:${palette[i]}"></div></div>
      <div class="feat-pct">${f.pct}%</div>
    </div>
  `).join('');
  setTimeout(() => {
    document.querySelectorAll('.feat-bar-inner').forEach(b => {
      b.style.width = b.dataset.w + '%';
    });
  }, 60);
}
