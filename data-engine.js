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
      conditions: ['HTN', 'CKD'], phase: 30, riskBase: 62, deteriorating: true, severityCap: 0.55, baselineWeight: 162,
      vitals: { sbp: 172, dbp: 98, hr: 88, spo2: 97, weight: 162, glucose: null, rr: 18, temp: 37.0, consciousness: 'alert', supplementalO2: false, potassium: 5.0, fev1pct: null, egfr: 44 } },
    { id: 'P002', name: 'Robert Chen', age: 74, dx: 'CHF NYHA III, T2DM, HFrEF EF 40%',
      conditions: ['CHF', 'DM'], phase: 30, riskBase: 76, deteriorating: true, severityCap: 0.75, baselineWeight: 196,
      vitals: { sbp: 148, dbp: 88, hr: 96, spo2: 93, weight: 203, glucose: 218, rr: 20, temp: 37.1, consciousness: 'alert', supplementalO2: false, potassium: null, fev1pct: null, egfr: null } },
    { id: 'P003', name: 'Diane Morales', age: 61, dx: 'COPD GOLD II, Declining SpO2',
      conditions: ['COPD'], phase: 60, riskBase: 58, deteriorating: true, severityCap: 0.5, baselineWeight: 154,
      vitals: { sbp: 128, dbp: 80, hr: 82, spo2: 89, weight: 154, glucose: null, rr: 22, temp: 37.0, consciousness: 'alert', supplementalO2: false, potassium: null, fev1pct: 58, egfr: null } },
    { id: 'P004', name: 'James Okafor', age: 71, dx: 'T2DM, HTN Stage 1, Stable',
      conditions: ['DM', 'HTN'], phase: 60, riskBase: 30, deteriorating: false, severityCap: 0, baselineWeight: 188,
      vitals: { sbp: 136, dbp: 84, hr: 74, spo2: 98, weight: 188, glucose: 142, rr: 16, temp: 36.8, consciousness: 'alert', supplementalO2: false, potassium: null, fev1pct: null, egfr: null } },
    { id: 'P005', name: 'Patricia Walsh', age: 79, dx: 'CHF NYHA I, Stable',
      conditions: ['CHF'], phase: 60, riskBase: 36, deteriorating: false, severityCap: 0, baselineWeight: 155,
      vitals: { sbp: 132, dbp: 78, hr: 74, spo2: 96, weight: 158, glucose: null, rr: 16, temp: 36.9, consciousness: 'alert', supplementalO2: false, potassium: null, fev1pct: null, egfr: null } },
    { id: 'P006', name: 'Marcus Rivera', age: 52, dx: 'HTN Stage 2, Non-Adherent',
      conditions: ['HTN'], phase: 30, riskBase: 52, deteriorating: true, severityCap: 0.4, baselineWeight: 195,
      vitals: { sbp: 158, dbp: 96, hr: 88, spo2: 98, weight: 195, glucose: null, rr: 18, temp: 37.0, consciousness: 'alert', supplementalO2: false, potassium: null, fev1pct: null, egfr: null } },
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
        baselineVitals: Object.assign({}, p.vitals), // reference point for mean-reverting drift
        severity: 0, // 0-1, how far toward a "bad day" this patient currently is
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
        const firstPatient = parsed && parsed.patients && Object.values(parsed.patients)[0];
        // Schema check: older saved sessions predate baselineVitals/severity
        // (mean-reverting drift) — reseed rather than let them stay pinned
        // at whatever extreme they'd drifted to under the old model.
        if (firstPatient && firstPatient.baselineVitals) return parsed;
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
          newsScore: p.newsScore, newsBand: p.newsBand,
          summary: p.summary, top_concern: p.topConcern, action: p.action,
          ts: state.updatedAt, source: p.source
        }));
      } catch (e) {}
    });
  }

  // Mean-reverting drift: each vital oscillates around a "target" with
  // noise, rather than an unbounded random walk. For deteriorating
  // patients, the target itself slowly shifts worse over the session and
  // plateaus at a clinically-meaningful (not physiologically-extreme)
  // offset from baseline — so a long-running demo settles into a
  // realistic "this patient is trending down" pattern instead of every
  // vital eventually pinning at the hard safety clamp. Stable patients'
  // targets stay at baseline, so they hover with normal variability.
  function stepVitals(p) {
    const v = p.vitals;
    const b = p.baselineVitals || v;

    // severity ramps slowly toward each patient's individual ceiling
    // (severityCap — reflects intended relative acuity, so not every
    // deteriorating patient converges to the same "worst case") and decays
    // back toward 0 for stable patients.
    const cap = p.severityCap != null ? p.severityCap : (p.deteriorating ? 0.6 : 0);
    p.severity = clamp((p.severity || 0) + (p.deteriorating ? 0.006 : -0.02), 0, cap);
    const sev = p.severity;

    const revert = 0.25; // fraction of the gap to target closed each tick
    function step(key, worstDelta, noise, min, max, round) {
      if (v[key] == null) return;
      const target = (b[key] != null ? b[key] : v[key]) + worstDelta * sev;
      let nv = v[key] + revert * (target - v[key]) + (Math.random() - 0.5) * 2 * noise;
      nv = clamp(nv, min, max);
      v[key] = round ? Math.round(nv) : round1(nv);
    }

    step('sbp', 26, 2.5, 90, 210, true);
    step('dbp', 14, 1.5, 55, 130, true);
    step('hr', 16, 2.5, 50, 140, true);
    step('spo2', -7, 0.8, 82, 100, true);
    step('weight', 7, 0.4, (b.weight || v.weight) - 15, (b.weight || v.weight) + 15, false);
    step('glucose', 65, 10, 60, 400, true);
    step('rr', 7, 1.2, 10, 34, true);
    step('temp', 0.8, 0.12, 35.0, 39.5, false);
    step('potassium', 0.9, 0.12, 3.0, 6.5, false);
    step('fev1pct', -16, 1.5, 15, 90, true);
    step('egfr', -16, 0.8, 5, 90, true);

    // Auto-flag supplemental oxygen once SpO2 is persistently low — mirrors real
    // RPM/telehealth practice of prescribing home O2 below ~88-90%.
    if (v.spo2 != null) v.supplementalO2 = v.spo2 < 88;
    p.history.push(Object.assign({ ts: Date.now() }, v));
    if (p.history.length > 30) p.history.shift();
  }

  // ── NEWS2 (National Early Warning Score 2) ──
  // Originally Royal College of Physicians (UK), 2017 update, endorsed by
  // NHS England. Also has direct U.S. federal adoption: selected for the
  // VA's new nationwide federal EHR, and validated in a peer-reviewed
  // study on Veteran patients (Kansas City VA, AUC 0.72 for 24h ICU
  // transfer/mortality). This is the validated "how acutely unwell right
  // now" core of the risk engine — condition-specific modifiers (CHF
  // weight gain, DM glucose, adherence) are layered on top in
  // baselineScore(), not folded in.
  function computeNEWS2(v) {
    const b = {};
    let total = 0;
    function add(key, pts) { b[key] = pts; total += pts; }

    if (v.rr == null) add('rr', 0);
    else if (v.rr <= 8) add('rr', 3);
    else if (v.rr <= 11) add('rr', 1);
    else if (v.rr <= 20) add('rr', 0);
    else if (v.rr <= 24) add('rr', 2);
    else add('rr', 3);

    if (v.spo2 == null) add('spo2', 0);
    else if (v.spo2 <= 91) add('spo2', 3);
    else if (v.spo2 <= 93) add('spo2', 2);
    else if (v.spo2 <= 95) add('spo2', 1);
    else add('spo2', 0);
    add('o2', v.supplementalO2 ? 2 : 0);

    if (v.sbp == null) add('sbp', 0);
    else if (v.sbp <= 90) add('sbp', 3);
    else if (v.sbp <= 100) add('sbp', 2);
    else if (v.sbp <= 110) add('sbp', 1);
    else if (v.sbp <= 219) add('sbp', 0);
    else add('sbp', 3);

    if (v.hr == null) add('hr', 0);
    else if (v.hr <= 40) add('hr', 3);
    else if (v.hr <= 50) add('hr', 1);
    else if (v.hr <= 90) add('hr', 0);
    else if (v.hr <= 110) add('hr', 1);
    else if (v.hr <= 130) add('hr', 2);
    else add('hr', 3);

    add('consciousness', v.consciousness === 'alert' ? 0 : 3);

    if (v.temp == null) add('temp', 0);
    else if (v.temp <= 35.0) add('temp', 3);
    else if (v.temp <= 36.0) add('temp', 1);
    else if (v.temp <= 38.0) add('temp', 0);
    else if (v.temp <= 39.0) add('temp', 1);
    else add('temp', 2);

    const band = total >= 7 ? 'high' : (total >= 5 || Math.max(b.rr, b.spo2, b.sbp, b.hr, b.consciousness, b.temp) >= 3) ? 'medium' : 'low';
    return { total: total, breakdown: b, band: band };
  }

  // Predict AI is the single authority on composite risk scoring — this is
  // a fallback only, so numbers are never blank before Predict AI has run
  // for a patient. Once Predict AI enriches a patient (source:'predict'),
  // this fallback stops recomputing riskScore/er48h/hosp30d/narrative for
  // that patient — vitals and NEWS2 keep evolving underneath, but the
  // authoritative assessment stays Predict AI's until the page resets.
  function fallbackComposite(p) {
    const v = p.vitals;
    const news = { total: p.newsScore, band: p.newsBand };
    let score = clamp(news.total * 7, 0, 75);

    // Condition-specific modifiers (guideline-sourced, layered on top of NEWS2)
    if (v.glucose != null && p.conditions.includes('DM')) {
      if (v.glucose > 300) score += 18; else if (v.glucose > 180) score += 8; // ADA Standards of Care
    }
    if (p.conditions.includes('CHF') && v.weight != null && p.baselineWeight != null) {
      // Rapid weight gain — standard CHF self-monitoring guidance (AHA)
      const gain = v.weight - p.baselineWeight;
      if (gain >= 5) score += 15; else if (gain >= 2) score += 8;
    }
    if (p.conditions.includes('HTN')) {
      // Hypertension staging — AHA/ACC (2017 guideline, JNC8 lineage), distinct from NEWS2's generic SBP band
      if (v.sbp >= 180 || v.dbp >= 120) score += 10; // hypertensive crisis
      else if (v.sbp >= 140 || v.dbp >= 90) score += 5; // Stage 2
    }
    if (p.conditions.includes('CKD') && v.potassium != null) {
      // Hyperkalemia — KDIGO CKD guideline threshold (>5.5 mEq/L requires intervention)
      if (v.potassium > 5.5) score += 15; else if (v.potassium > 5.0) score += 7;
    }
    if (p.conditions.includes('CKD') && v.egfr != null) {
      // eGFR staging — KDIGO CKD guideline (the primary value CKD stages are defined by)
      if (v.egfr < 15) score += 22; else if (v.egfr < 30) score += 12; else if (v.egfr < 45) score += 5;
    }
    if (p.conditions.includes('COPD') && v.fev1pct != null) {
      // FEV1% staging — GOLD 2024 (COPD staging by FEV1%: <30% GOLD4, 30-49% GOLD3)
      if (v.fev1pct < 30) score += 15; else if (v.fev1pct < 50) score += 8;
    }
    if (p.adherence === 'no') score += 14; else if (p.adherence === 'partial') score += 7;

    score = clamp(Math.round(score), 5, 98);
    const er = clamp(Math.round(score * 0.45 + (v.spo2 != null && v.spo2 < 92 ? 15 : 0)), 2, 95);
    const hosp = clamp(Math.round(score * 0.6 + er * 0.25 + Math.max(0, (p.age - 65) * 0.4)), 3, 95);
    const det24h = clamp(Math.round(er * 0.55 + score * 0.3), 0, 95);

    p.riskScore = score; p.er48h = er; p.hosp30d = hosp; p.det24h = det24h;
    p.topConcern =
      (p.conditions.includes('CKD') && v.potassium > 5.5) ? ('Hyperkalemia K\u207a ' + v.potassium + ' mEq/L (KDIGO threshold >5.5)')
      : (p.conditions.includes('COPD') && v.fev1pct != null && v.fev1pct < 50) ? ('FEV\u2081 ' + v.fev1pct + '% \u2014 GOLD Stage ' + (v.fev1pct < 30 ? 'IV' : 'III'))
      : (p.conditions.includes('CHF') && p.baselineWeight != null && (v.weight - p.baselineWeight) >= 2) ? ('+' + (v.weight - p.baselineWeight).toFixed(1) + ' lbs since baseline \u2014 CHF fluid retention risk')
      : (p.conditions.includes('DM') && v.glucose > 180) ? ('Glucose ' + v.glucose + ' mg/dL above ADA target')
      : news.band === 'high' ? ('NEWS2 ' + news.total + ' (high) \u2014 multi-system deterioration')
      : (v.spo2 != null && v.spo2 < 90) ? ('SpO\u2082 critical low (' + v.spo2 + '%)')
      : (p.conditions.includes('HTN') && (v.sbp >= 180 || v.dbp >= 120)) ? ('Hypertensive crisis (SBP ' + v.sbp + '/' + v.dbp + ', AHA/ACC)')
      : p.deteriorating ? 'Trending up over recent readings' : 'Stable';
    p.summary = p.name.split(' ')[0] + ' (' + p.dx + ') \u2014 NEWS2 ' + news.total + ' (' + news.band + '), composite risk ' + score + '/100, ER 48h ' + er + '%, admit 30d ' + hosp + '%. (Awaiting full Predict AI assessment)';
    p.action = news.band === 'high' || score >= 70 ? 'Contact physician now' : news.band === 'medium' || score >= 45 ? 'Notify physician within 4 hours' : 'Continue monitoring per care plan';
    p.source = 'engine';
  }

  function tick() {
    const state = loadState();
    Object.keys(state.patients).forEach(function (id) {
      const p = state.patients[id];
      stepVitals(p);
      // NEWS2 is a vitals-only fact — always kept current for every patient.
      const news = computeNEWS2(p.vitals);
      p.newsScore = news.total; p.newsBand = news.band; p.newsBreakdown = news.breakdown;
      // The composite risk score / ER% / admit% / narrative is Predict AI's
      // call. Only fill it in here if Predict AI hasn't assessed this
      // patient yet this session — never overwrite its assessment.
      if (p.source !== 'predict') fallbackComposite(p);
    });
    state.tick++;
    state.updatedAt = Date.now();
    saveState(state);
    broadcast(state);
    return state;
  }

  // Let a richer page (Command / Predict) push its own computed scores/narrative
  // for a patient without touching vitals — this "upgrades" what other tabs see.
  // Predict AI is the intended caller for riskScore/er48h/hosp30d/summary —
  // it's the hub; other portals should only read, not push competing
  // assessments. (Command Dashboard intentionally does not call this for
  // scoring anymore — see syncvitals-command.html.)
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
    computeNEWS2: computeNEWS2,
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
