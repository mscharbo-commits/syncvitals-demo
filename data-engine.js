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
  // Bump this whenever the patient/state data model changes in a way that
  // makes existing saved sessions stale or degraded (new fields, changed
  // scoring, fixed bugs in how history accumulates, etc). loadState()
  // reseeds automatically on mismatch — no manual localStorage clearing
  // needed by the user.
  const SCHEMA_VERSION = 3;
  const CHANNEL_NAME = 'syncvitals_sync';
  const TICK_MS = 8000; // how often the shared dataset advances

  const SEED_PATIENTS = [
    { id: 'P001', name: 'Margaret Okafor', age: 68, dx: 'HTN Stage 2, CKD Stage 3',
      conditions: ['HTN', 'CKD'], phase: 30, riskBase: 66, deteriorating: true, severityCap: 0.65, baselineWeight: 162,
      vitals: { sbp: 172, dbp: 98, hr: 88, spo2: 97, weight: 162, glucose: null, rr: 18, temp: 37.0, consciousness: 'alert', supplementalO2: false, potassium: 5.0, fev1pct: null, egfr: 44 } },
    { id: 'P002', name: 'Robert Chen', age: 74, dx: 'CHF NYHA III, T2DM, HFrEF EF 40%',
      conditions: ['CHF', 'DM'], phase: 30, riskBase: 80, deteriorating: true, severityCap: 0.85, baselineWeight: 196,
      vitals: { sbp: 148, dbp: 88, hr: 96, spo2: 93, weight: 203, glucose: 218, rr: 20, temp: 37.1, consciousness: 'alert', supplementalO2: false, potassium: null, fev1pct: null, egfr: null } },
    { id: 'P003', name: 'Diane Morales', age: 61, dx: 'COPD GOLD II, Declining SpO2',
      conditions: ['COPD'], phase: 60, riskBase: 62, deteriorating: true, severityCap: 0.65, baselineWeight: 154,
      vitals: { sbp: 128, dbp: 80, hr: 82, spo2: 89, weight: 154, glucose: null, rr: 22, temp: 37.0, consciousness: 'alert', supplementalO2: false, potassium: null, fev1pct: 58, egfr: null } },
    { id: 'P004', name: 'James Okafor', age: 71, dx: 'T2DM, HTN Stage 1, Stable',
      conditions: ['DM', 'HTN'], phase: 60, riskBase: 35, deteriorating: false, severityCap: 0, baselineWeight: 188,
      vitals: { sbp: 136, dbp: 84, hr: 74, spo2: 98, weight: 188, glucose: 142, rr: 16, temp: 36.8, consciousness: 'alert', supplementalO2: false, potassium: null, fev1pct: null, egfr: null } },
    { id: 'P005', name: 'Patricia Walsh', age: 79, dx: 'CHF NYHA I, Stable',
      conditions: ['CHF'], phase: 60, riskBase: 48, deteriorating: false, severityCap: 0.2, baselineWeight: 155,
      vitals: { sbp: 132, dbp: 78, hr: 74, spo2: 96, weight: 158, glucose: null, rr: 16, temp: 36.9, consciousness: 'alert', supplementalO2: false, potassium: null, fev1pct: null, egfr: null } },
    { id: 'P006', name: 'Marcus Rivera', age: 52, dx: 'HTN Stage 2, Non-Adherent',
      conditions: ['HTN'], phase: 30, riskBase: 58, deteriorating: true, severityCap: 0.5, baselineWeight: 195,
      vitals: { sbp: 158, dbp: 96, hr: 88, spo2: 98, weight: 195, glucose: null, rr: 18, temp: 37.0, consciousness: 'alert', supplementalO2: false, potassium: null, fev1pct: null, egfr: null } },
    { id: 'P007', name: 'Carlos Mendez', age: 58, dx: 'Type 2 Diabetes Mellitus, Hypertension Stage 1',
      conditions: ['DM', 'HTN'], phase: 30, riskBase: 52, deteriorating: false, severityCap: 0.32, baselineWeight: 192,
      vitals: { sbp: 148, dbp: 88, hr: 78, spo2: 98, weight: 196, glucose: 218, rr: 16, temp: 37.0, consciousness: 'alert', supplementalO2: false, potassium: null, fev1pct: null, egfr: null } },
    { id: 'P008', name: 'Linda Park', age: 66, dx: 'COPD GOLD I, Well-Controlled',
      conditions: ['COPD'], phase: 30, riskBase: 35, deteriorating: false, severityCap: 0.05, baselineWeight: 142,
      vitals: { sbp: 124, dbp: 76, hr: 76, spo2: 95, weight: 142, glucose: null, rr: 17, temp: 36.9, consciousness: 'alert', supplementalO2: false, potassium: null, fev1pct: 68, egfr: null } },
    { id: 'P009', name: 'Harold Jenkins', age: 70, dx: 'CKD Stage 2, Stable',
      conditions: ['CKD'], phase: 30, riskBase: 42, deteriorating: false, severityCap: 0.25, baselineWeight: 178,
      vitals: { sbp: 130, dbp: 80, hr: 72, spo2: 97, weight: 178, glucose: null, rr: 15, temp: 36.8, consciousness: 'alert', supplementalO2: false, potassium: 4.4, fev1pct: null, egfr: 68 } },
    { id: 'P010', name: 'Susan Whitfield', age: 67, dx: 'CHF NYHA II, Early Decompensation Risk',
      conditions: ['CHF'], phase: 30, riskBase: 58, deteriorating: true, severityCap: 0.55, baselineWeight: 168,
      vitals: { sbp: 138, dbp: 84, hr: 84, spo2: 95, weight: 169, glucose: null, rr: 18, temp: 37.0, consciousness: 'alert', supplementalO2: false, potassium: null, fev1pct: null, egfr: null } },
    { id: 'P011', name: 'David Kim', age: 45, dx: 'HTN Stage 1, Well-Controlled',
      conditions: ['HTN'], phase: 30, riskBase: 30, deteriorating: false, severityCap: 0.05, baselineWeight: 185,
      vitals: { sbp: 128, dbp: 82, hr: 70, spo2: 99, weight: 185, glucose: null, rr: 14, temp: 36.7, consciousness: 'alert', supplementalO2: false, potassium: null, fev1pct: null, egfr: null } },
    { id: 'P012', name: 'Angela Brooks', age: 54, dx: 'T2DM, Newly Diagnosed',
      conditions: ['DM'], phase: 30, riskBase: 50, deteriorating: true, severityCap: 0.45, baselineWeight: 204,
      vitals: { sbp: 134, dbp: 82, hr: 80, spo2: 98, weight: 204, glucose: 176, rr: 16, temp: 37.0, consciousness: 'alert', supplementalO2: false, potassium: null, fev1pct: null, egfr: null } },
  ];

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function jitter(base, spread) { return base + (Math.random() - 0.5) * 2 * spread; }
  function round1(v) { return Math.round(v * 10) / 10; }

  // ── LONGITUDINAL HISTORY (10-20 day backfill) ──
  // Real RPM value isn't just a live snapshot — it's the trend, and
  // specifically catching a decline early enough that intervention works.
  // Each patient gets a narrative pattern instead of a flat/monotonic
  // trajectory: some decline throughout (untreated), some show a clear
  // intervention point where a clinician acted and the trend reversed,
  // one shows steady improvement since a new diagnosis, and the rest stay
  // stable. This mirrors how real physiologic + lab drift work — smooth
  // trends with daily noise, not random walk.
  const HISTORY_PATTERNS = {
    P001: { pattern: 'decline' },                                   // progressive CKD, untreated — shows why escalation matters
    P002: { pattern: 'intervention', day: 10, note: 'Furosemide increased 20mg\u219240mg; f/u scheduled' },
    P003: { pattern: 'decline' },                                   // progressive COPD, untreated
    P004: { pattern: 'stable' },
    P005: { pattern: 'stable' },
    P006: { pattern: 'intervention', day: 9, note: 'Adherence coaching call; pharmacy blister-pack enrollment' },
    P007: { pattern: 'stable' },
    P008: { pattern: 'stable' },
    P009: { pattern: 'stable' },
    P010: { pattern: 'intervention', day: 8, note: 'Diuretic titration after early weight-gain alert' },
    P011: { pattern: 'stable' },
    P012: { pattern: 'improving' }                                  // newly diagnosed, responding to new regimen
  };
  const HISTORY_DAYS = 16;

  function severityAtDay(cap, t, info) {
    // t is 0..1 across the backfill window
    if (info.pattern === 'stable') return cap * 0.15 * t;
    if (info.pattern === 'decline') return cap * t;
    if (info.pattern === 'improving') return cap * (1 - 0.6 * t);
    if (info.pattern === 'intervention') {
      const interventionT = info.day / (HISTORY_DAYS - 1);
      if (t <= interventionT) return cap * (interventionT === 0 ? 1 : t / interventionT);
      const postT = (t - interventionT) / (1 - interventionT);
      return cap * (1 - postT * 0.75);
    }
    return 0;
  }

  // The chronic-burden floor (riskBase) also needs to move with the
  // narrative, not stay fixed at today's value — otherwise it swamps the
  // whole trend on early low-severity days and flattens the story.
  function floorMultiplierAtDay(t, info) {
    if (info.pattern === 'stable') return 1;
    if (info.pattern === 'decline') return 0.55 + 0.45 * t; // ramps up to today's full riskBase
    if (info.pattern === 'improving') return 1 - 0.4 * t;   // starts at full, eases down
    if (info.pattern === 'intervention') {
      const interventionT = info.day / (HISTORY_DAYS - 1);
      if (t <= interventionT) return 0.55 + 0.45 * (interventionT === 0 ? 1 : t / interventionT);
      const postT = (t - interventionT) / (1 - interventionT);
      return 1 - postT * 0.35; // improves after intervention, doesn't fully return to baseline
    }
    return 1;
  }

  function backfillHistory(p) {
    const info = HISTORY_PATTERNS[p.id] || { pattern: 'stable' };
    const b = p.baselineVitals;
    const cap = p.severityCap != null ? p.severityCap : (p.deteriorating ? 0.5 : 0);
    const now = Date.now();
    const dayMs = 86400000;
    const entries = [];
    let lastVitals = null;
    for (let d = HISTORY_DAYS - 1; d >= 0; d--) {
      const t = 1 - d / (HISTORY_DAYS - 1); // 0 at oldest day, 1 at today
      const sev = severityAtDay(cap, t, info);
      const v = {};
      function val(key, worstDelta, noise, round) {
        if (b[key] == null) { v[key] = null; return; }
        const target = b[key] + worstDelta * sev;
        const n = target + (Math.random() - 0.5) * 2 * noise;
        v[key] = round ? Math.round(n) : Math.round(n * 10) / 10;
      }
      // Noise kept modest relative to live-tick noise — this backfill is
      // meant to read as a clear trend line, not minute-to-minute jitter.
      val('sbp', 26, 1.5, true); val('dbp', 14, 1, true); val('hr', 16, 1.5, true);
      val('spo2', -7, 0.5, true); val('weight', 7, 0.25, false); val('glucose', 65, 6, true);
      val('rr', 7, 0.75, true); val('temp', 0.8, 0.08, false);
      val('potassium', 0.9, 0.08, false); val('fev1pct', -16, 1, true); val('egfr', -16, 0.5, true);
      v.consciousness = 'alert'; v.supplementalO2 = v.spo2 != null && v.spo2 < 88;
      const scored = scoreVitals(p.conditions, v, {
        riskBase: p.riskBase * floorMultiplierAtDay(t, info), baselineWeight: p.baselineWeight, adherence: p.adherence, age: p.age
      });
      entries.push(Object.assign({ ts: now - d * dayMs, riskScore: scored.score }, v));
      lastVitals = v;
    }
    p.history = entries;
    p.historyPattern = info.pattern;
    if (info.note) p.interventionNote = 'Day ' + info.day + ': ' + info.note;
    // Carry the narrative's ending point into live state, so ticking
    // continues smoothly from "today" instead of snapping back to a
    // severity-0 baseline and discarding the whole backfilled story.
    p.vitals = Object.assign({}, p.vitals, lastVitals);
    p.severity = severityAtDay(cap, 1, info);
    // For intervention/improving patients, the improved state becomes
    // their new ongoing baseline — a successful intervention genuinely
    // lowers a patient's classified risk level, not just today's number.
    // Otherwise live ticking's fallbackComposite would floor back at the
    // OLD full riskBase and erase the improvement the moment it ticks.
    if (info.pattern === 'intervention' || info.pattern === 'improving') {
      const endMult = floorMultiplierAtDay(1, info);
      p.riskBase = Math.round(p.riskBase * endMult);
      p.severityCap = Math.round(cap * 0.4 * 100) / 100; // reduced relapse risk, not zero
      p.deteriorating = false; // stabilized post-intervention
    }
  }

  function seedState() {
    const now = Date.now();
    const patients = {};
    SEED_PATIENTS.forEach(p => {
      const vitals = Object.assign({}, p.vitals);
      const patient = Object.assign({}, p, {
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
      backfillHistory(patient); // populates p.history with the 16-day narrative trend
      patients[p.id] = patient;
    });
    return { tick: 0, updatedAt: now, schemaVersion: SCHEMA_VERSION, patients: patients };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.schemaVersion === SCHEMA_VERSION && parsed.patients && Object.keys(parsed.patients).length) return parsed;
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
    // Store at most one entry per calendar day — real BP monitoring is a
    // handful of readings/day, not one every tick. Without this, a long
    // demo session floods the array with same-day ticks and eventually
    // evicts the entire historical backfill via the length cap below.
    const todayKey = new Date().toISOString().slice(0, 10);
    const lastEntry = p.history[p.history.length - 1];
    const lastKey = lastEntry ? new Date(lastEntry.ts).toISOString().slice(0, 10) : null;
    if (lastKey === todayKey) {
      p.history[p.history.length - 1] = Object.assign({ ts: Date.now() }, v);
    } else {
      p.history.push(Object.assign({ ts: Date.now() }, v));
    }
    if (p.history.length > 60) p.history.shift(); // now a 60-DAY safety cap, not a tick cap
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
  // Pure scoring function — takes conditions/vitals/context, returns the
  // composite assessment. This is the SAME function production code calls
  // (via fallbackComposite below), and is also exported on SVEngine so it
  // can be validated directly against known clinical scenarios.
  function scoreVitals(conditions, vitals, opts) {
    opts = opts || {};
    const v = vitals;
    const riskBase = opts.riskBase != null ? opts.riskBase : 0;
    const baselineWeight = opts.baselineWeight != null ? opts.baselineWeight : null;
    const adherence = opts.adherence || 'yes';
    const age = opts.age != null ? opts.age : 65;

    const news = computeNEWS2(v);
    let score = clamp(news.total * 7, 0, 75);

    if (v.glucose != null && conditions.includes('DM')) {
      if (v.glucose > 300) score += 18; else if (v.glucose > 180) score += 8; // ADA Standards of Care
    }
    if (conditions.includes('CHF') && v.weight != null && baselineWeight != null) {
      const gain = v.weight - baselineWeight;
      if (gain >= 5) score += 15; else if (gain >= 2) score += 8; // AHA CHF self-monitoring guidance
    }
    if (conditions.includes('HTN')) {
      if (v.sbp >= 180 || v.dbp >= 120) score += 10; // AHA/ACC hypertensive crisis
      else if (v.sbp >= 140 || v.dbp >= 90) score += 5; // AHA/ACC Stage 2
    }
    if (conditions.includes('CKD') && v.potassium != null) {
      if (v.potassium > 5.5) score += 15; else if (v.potassium > 5.0) score += 7; // KDIGO hyperkalemia
    }
    if (conditions.includes('CKD') && v.egfr != null) {
      if (v.egfr < 15) score += 22; else if (v.egfr < 30) score += 12; else if (v.egfr < 45) score += 5; // KDIGO eGFR staging
    }
    if (conditions.includes('COPD') && v.fev1pct != null) {
      if (v.fev1pct < 30) score += 15; else if (v.fev1pct < 50) score += 8; // GOLD FEV1% staging
    }
    if (adherence === 'no') score += 14; else if (adherence === 'partial') score += 7;

    score = Math.max(score, riskBase); // chronic disease burden floor
    score = clamp(Math.round(score), 5, 98);
    const er = clamp(Math.round(score * 0.45 + (v.spo2 != null && v.spo2 < 92 ? 15 : 0)), 2, 95);
    const hosp = clamp(Math.round(score * 0.6 + er * 0.25 + Math.max(0, (age - 65) * 0.4)), 3, 95);
    const det24h = clamp(Math.round(er * 0.55 + score * 0.3), 0, 95);
    const tier = score >= 65 ? 'high' : score >= 40 ? 'medium' : 'low';

    return { score, er48h: er, hosp30d: hosp, det24h, tier, newsScore: news.total, newsBand: news.band, newsBreakdown: news.breakdown };
  }

  function fallbackComposite(p) {
    const v = p.vitals;
    const result = scoreVitals(p.conditions, v, {
      riskBase: p.riskBase, baselineWeight: p.baselineWeight, adherence: p.adherence, age: p.age
    });
    const news = { total: result.newsScore, band: result.newsBand };
    const score = result.score, er = result.er48h, hosp = result.hosp30d, det24h = result.det24h;

    p.newsScore = news.total; p.newsBand = news.band; p.newsBreakdown = result.newsBreakdown;
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
    scoreVitals: scoreVitals,
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
