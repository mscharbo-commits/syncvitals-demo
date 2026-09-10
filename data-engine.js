/* ============================================================
   SyncVitals Shared Data Engine
   One evolving dataset shared by Command, Predict, Nurse Portal
   and Nutrition — via localStorage + BroadcastChannel, so every
   portal you have open is reading/writing the SAME patients,
   the SAME vitals trend, and the SAME risk scores.

   Any open tab can advance the simulation (deterministically —
   it always advances from whatever the last saved state was, so
   multiple open tabs never fight each other or diverge). If no
   tab is open for a while, the first tab that loads just picks
   up where the data left off.
   ============================================================ */
(function (window) {
  const STORAGE_KEY = 'sv_shared_state_v1';
  const CHANNEL_NAME = 'syncvitals_sync';
  const TICK_MS = 8000; // how often the shared dataset advances

  const SEED_PATIENTS = [
    { id: 'P001', name: 'Margaret Okafor', age: 68, dx: 'HTN Stage 2, CKD Stage 3',
      conditions: ['HTN', 'CKD'], phase: 30, riskBase: 62, deteriorating: true,
      vitals: { sbp: 172, dbp: 98, hr: 88, spo2: 97, weight: 162, glucose: null } },
    { id: 'P002', name: 'Robert Chen', age: 74, dx: 'CHF NYHA III, T2DM, HFrEF EF 40%',
      conditions: ['CHF', 'DM'], phase: 30, riskBase: 76, deteriorating: true,
      vitals: { sbp: 148, dbp: 88, hr: 96, spo2: 93, weight: 203, glucose: 218 } },
    { id: 'P003', name: 'Diane Morales', age: 61, dx: 'COPD GOLD II, Declining SpO2',
      conditions: ['COPD'], phase: 60, riskBase: 58, deteriorating: true,
      vitals: { sbp: 128, dbp: 80, hr: 82, spo2: 89, weight: 154, glucose: null } },
    { id: 'P004', name: 'James Okafor', age: 71, dx: 'T2DM, HTN Stage 1, Stable',
      conditions: ['DM', 'HTN'], phase: 60, riskBase: 30, deteriorating: false,
      vitals: { sbp: 136, dbp: 84, hr: 74, spo2: 98, weight: 188, glucose: 142 } },
    { id: 'P005', name: 'Patricia Walsh', age: 79, dx: 'CHF NYHA I, Stable',
      conditions: ['CHF'], phase: 60, riskBase: 36, deteriorating: false,
      vitals: { sbp: 132, dbp: 78, hr: 74, spo2: 96, weight: 158, glucose: null } },
    { id: 'P006', name: 'Marcus Rivera', age: 52, dx: 'HTN Stage 2, Non-Adherent',
      conditions: ['HTN'], phase: 30, riskBase: 52, deteriorating: true,
      vitals: { sbp: 158, dbp: 96, hr: 88, spo2: 98, weight: 195, glucose: null } },
  ];

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function jitter(base, spread) { return base + (Math.random() - 0.5) * 2 * spread; }
  function round1(v) { return Math.round(v * 10) / 10; }

  function seedState() {
    const now = Date.now();
    const patients = {};
    SEED_PATIENTS.forEach(p => {
      const vitals = Object.assign({}, p.vitals);
      patients[p.id] = Object.assign({}, p, {
        vitals: vitals,
        history: [Object.assign({ ts: now }, vitals)],
        riskScore: p.riskBase,
        er48h: Math.round(p.riskBase * 0.4),
        hosp30d: Math.round(p.riskBase * 0.5),
        det24h: Math.round(p.riskBase * 0.3),
        adherence: p.id === 'P006' ? 'no' : (p.deteriorating ? 'partial' : 'yes'),
        summary: '', topConcern: '', action: '',
        source: 'engine'
      });
    });
    return { tick: 0, updatedAt: now, patients: patients };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.patients && Object.keys(parsed.patients).length) return parsed;
      }
    } catch (e) {}
    const fresh = seedState();
    saveState(fresh);
    return fresh;
  }

  function saveState(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
    // Legacy per-patient keys — kept so existing sv_pred_<id> readers keep working.
    Object.keys(state.patients).forEach(function (id) {
      const p = state.patients[id];
      try {
        localStorage.setItem('sv_pred_' + id, JSON.stringify({
          riskScore: p.riskScore, er48h: p.er48h, hosp30d: p.hosp30d, det24h: p.det24h,
          summary: p.summary, top_concern: p.topConcern, action: p.action,
          ts: state.updatedAt, source: p.source
        }));
      } catch (e) {}
    });
  }

  function stepVitals(p) {
    const v = p.vitals;
    const drift = p.deteriorating ? 1 : -0.3;
    if (v.sbp != null) v.sbp = Math.round(clamp(jitter(v.sbp + drift * 0.6, 3), 90, 210));
    if (v.dbp != null) v.dbp = Math.round(clamp(jitter(v.dbp + drift * 0.3, 2), 55, 130));
    if (v.hr != null) v.hr = Math.round(clamp(jitter(v.hr, 3), 50, 140));
    if (v.spo2 != null) v.spo2 = Math.round(clamp(jitter(v.spo2 - (p.deteriorating ? 0.15 : 0), 1), 82, 100));
    if (v.weight != null) v.weight = round1(clamp(jitter(v.weight + (p.deteriorating ? 0.15 : -0.05), 0.6), v.weight - 15, v.weight + 15));
    if (v.glucose != null) v.glucose = Math.round(clamp(jitter(v.glucose, 12), 60, 400));
    p.history.push(Object.assign({ ts: Date.now() }, v));
    if (p.history.length > 30) p.history.shift();
  }

  // Baseline clinical scoring — always runs so numbers never sit empty.
  // A portal (Command / Predict) can override with richer numbers via setDerived().
  function baselineScore(p) {
    const v = p.vitals;
    let score = p.riskBase;
    if (v.sbp >= 180) score += 20; else if (v.sbp >= 160) score += 12; else if (v.sbp >= 140) score += 6;
    if (v.spo2 != null && v.spo2 < 90) score += 22; else if (v.spo2 != null && v.spo2 < 94) score += 12;
    if (v.glucose != null && v.glucose > 300) score += 18; else if (v.glucose != null && v.glucose > 180) score += 8;
    if (p.adherence === 'no') score += 14; else if (p.adherence === 'partial') score += 7;
    score = clamp(Math.round(score), 5, 98);

    const er = clamp(Math.round(score * 0.45 + (v.spo2 != null && v.spo2 < 92 ? 20 : 0) + (v.sbp >= 180 ? 18 : 0)), 2, 95);
    const hosp = clamp(Math.round(score * 0.6 + er * 0.25 + Math.max(0, (p.age - 65) * 0.4)), 3, 95);
    const det24h = clamp(Math.round(er * 0.55 + score * 0.3), 0, 95);

    p.riskScore = score; p.er48h = er; p.hosp30d = hosp; p.det24h = det24h;
    p.topConcern = (v.spo2 != null && v.spo2 < 90) ? ('SpO\u2082 critical low (' + v.spo2 + '%)')
      : v.sbp >= 180 ? ('Hypertensive urgency (SBP ' + v.sbp + ')')
      : p.deteriorating ? 'Trending up over recent readings' : 'Stable';
    p.summary = p.name.split(' ')[0] + ' (' + p.dx + ') \u2014 risk ' + score + '/100, ER 48h ' + er + '%, admit 30d ' + hosp + '%.';
    p.action = score >= 70 ? 'Contact physician now' : score >= 45 ? 'Notify physician within 4 hours' : 'Continue monitoring per care plan';
    p.source = 'engine';
  }

  function tick() {
    const state = loadState();
    Object.keys(state.patients).forEach(function (id) {
      const p = state.patients[id];
      stepVitals(p);
      baselineScore(p);
    });
    state.tick++;
    state.updatedAt = Date.now();
    saveState(state);
    broadcast(state);
    return state;
  }

  // Let a richer page (Command / Predict) push its own computed scores/narrative
  // for a patient without touching vitals — this "upgrades" what other tabs see.
  function setDerived(id, fields) {
    const state = loadState();
    const p = state.patients[id];
    if (!p) return state;
    Object.assign(p, fields, { source: fields.source || 'portal' });
    state.updatedAt = Date.now();
    saveState(state);
    broadcast(state);
    return state;
  }

  let bc = null;
  try { bc = new BroadcastChannel(CHANNEL_NAME); } catch (e) { bc = null; }

  function broadcast(state) {
    window.dispatchEvent(new CustomEvent('sv:update', { detail: state }));
    if (bc) { try { bc.postMessage({ type: 'sv:update', tick: state.tick }); } catch (e) {} }
  }

  if (bc) {
    bc.onmessage = function (e) {
      if (e.data && e.data.type === 'sv:update') {
        window.dispatchEvent(new CustomEvent('sv:update', { detail: loadState() }));
      }
    };
  }
  window.addEventListener('storage', function (e) {
    if (e.key === STORAGE_KEY) window.dispatchEvent(new CustomEvent('sv:update', { detail: loadState() }));
  });

  let timer = null;
  function start() { if (timer) return; timer = setInterval(tick, TICK_MS); }
  function stop() { clearInterval(timer); timer = null; }

  window.SVEngine = {
    loadState: loadState,
    tick: tick,
    setDerived: setDerived,
    start: start,
    stop: stop,
    STORAGE_KEY: STORAGE_KEY,
    TICK_MS: TICK_MS
  };

  document.addEventListener('DOMContentLoaded', function () {
    window.dispatchEvent(new CustomEvent('sv:update', { detail: loadState() }));
    start();
  });
})(window);
