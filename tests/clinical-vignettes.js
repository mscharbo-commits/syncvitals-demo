// ═══════════════════════════════════════════════════════════════════
// CLINICAL VALIDATION VIGNETTES
// Known, guideline-defensible vital-sign scenarios with an expected risk
// tier a clinician would assign on sight — NOT tuned to make the scoring
// engine look good. These are fed into the ACTUAL production scoring
// function (SVEngine.scoreVitals), unmodified, and graded blind.
// ═══════════════════════════════════════════════════════════════════
const VIGNETTES = [
  // ── LOW RISK: textbook well-controlled ──
  { label: 'Well-controlled HTN', conditions: ['HTN'], expected: 'low',
    vitals: { sbp:128, dbp:82, hr:70, spo2:98, rr:14, temp:36.8, consciousness:'alert', supplementalO2:false, weight:null, glucose:null, potassium:null, fev1pct:null, egfr:null },
    opts: { riskBase:25, adherence:'yes', age:55 } },
  { label: 'Well-controlled T2DM (normal fasting glucose)', conditions: ['DM'], expected: 'low',
    vitals: { sbp:122, dbp:78, hr:68, spo2:98, rr:14, temp:36.7, consciousness:'alert', supplementalO2:false, weight:null, glucose:110, potassium:null, fev1pct:null, egfr:null },
    opts: { riskBase:25, adherence:'yes', age:58 } },
  { label: 'Mild well-managed COPD (GOLD I)', conditions: ['COPD'], expected: 'low',
    vitals: { sbp:120, dbp:76, hr:72, spo2:96, rr:16, temp:36.8, consciousness:'alert', supplementalO2:false, weight:null, glucose:null, potassium:null, fev1pct:72, egfr:null },
    opts: { riskBase:25, adherence:'yes', age:60 } },
  { label: 'Early CKD Stage 2, stable', conditions: ['CKD'], expected: 'low',
    vitals: { sbp:124, dbp:78, hr:70, spo2:97, rr:14, temp:36.7, consciousness:'alert', supplementalO2:false, weight:null, glucose:null, potassium:4.2, fev1pct:null, egfr:75 },
    opts: { riskBase:25, adherence:'yes', age:62 } },
  { label: 'Compensated CHF, no fluid overload', conditions: ['CHF'], expected: 'low',
    vitals: { sbp:118, dbp:74, hr:68, spo2:97, rr:14, temp:36.7, consciousness:'alert', supplementalO2:false, weight:150, glucose:null, potassium:null, fev1pct:null, egfr:null },
    opts: { riskBase:25, adherence:'yes', age:70, baselineWeight:150 } },

  // ── MEDIUM RISK: real but not emergent ──
  { label: 'Stage 2 HTN, uncontrolled (not crisis)', conditions: ['HTN'], expected: 'medium',
    vitals: { sbp:155, dbp:96, hr:84, spo2:96, rr:16, temp:36.9, consciousness:'alert', supplementalO2:false, weight:null, glucose:null, potassium:null, fev1pct:null, egfr:null },
    opts: { riskBase:45, adherence:'partial', age:60 } },
  { label: 'T2DM above target (not DKA range)', conditions: ['DM'], expected: 'medium',
    vitals: { sbp:138, dbp:86, hr:78, spo2:97, rr:16, temp:36.9, consciousness:'alert', supplementalO2:false, weight:null, glucose:220, potassium:null, fev1pct:null, egfr:null },
    opts: { riskBase:45, adherence:'partial', age:60 } },
  { label: 'Moderate COPD (GOLD III), borderline SpO2', conditions: ['COPD'], expected: 'medium',
    vitals: { sbp:130, dbp:80, hr:88, spo2:91, rr:22, temp:37.0, consciousness:'alert', supplementalO2:false, weight:null, glucose:null, potassium:null, fev1pct:42, egfr:null },
    opts: { riskBase:45, adherence:'yes', age:63 } },
  { label: 'CKD Stage 3b-4, mild hyperkalemia', conditions: ['CKD'], expected: 'medium',
    vitals: { sbp:145, dbp:88, hr:78, spo2:96, rr:16, temp:36.9, consciousness:'alert', supplementalO2:false, weight:null, glucose:null, potassium:5.2, fev1pct:null, egfr:32 },
    opts: { riskBase:45, adherence:'yes', age:68 } },
  { label: 'Early CHF decompensation (+3 lbs)', conditions: ['CHF'], expected: 'medium',
    vitals: { sbp:140, dbp:88, hr:92, spo2:93, rr:20, temp:37.0, consciousness:'alert', supplementalO2:false, weight:153, glucose:null, potassium:null, fev1pct:null, egfr:null },
    opts: { riskBase:45, adherence:'partial', age:72, baselineWeight:150 } },

  // ── HIGH RISK: textbook emergent presentations ──
  { label: 'Hypertensive crisis', conditions: ['HTN'], expected: 'high',
    vitals: { sbp:198, dbp:122, hr:108, spo2:94, rr:24, temp:37.2, consciousness:'alert', supplementalO2:false, weight:null, glucose:null, potassium:null, fev1pct:null, egfr:null },
    opts: { riskBase:55, adherence:'no', age:58 } },
  { label: 'DKA presentation', conditions: ['DM'], expected: 'high',
    vitals: { sbp:100, dbp:60, hr:118, spo2:95, rr:28, temp:37.5, consciousness:'alert', supplementalO2:false, weight:null, glucose:420, potassium:null, fev1pct:null, egfr:null },
    opts: { riskBase:55, adherence:'no', age:54 } },
  { label: 'Severe COPD exacerbation, needs O2', conditions: ['COPD'], expected: 'high',
    vitals: { sbp:135, dbp:82, hr:112, spo2:84, rr:30, temp:37.3, consciousness:'alert', supplementalO2:true, weight:null, glucose:null, potassium:null, fev1pct:24, egfr:null },
    opts: { riskBase:55, adherence:'yes', age:66 } },
  { label: 'Severe hyperkalemia + AKI on CKD', conditions: ['CKD'], expected: 'high',
    vitals: { sbp:168, dbp:98, hr:96, spo2:95, rr:20, temp:37.0, consciousness:'alert', supplementalO2:false, weight:null, glucose:null, potassium:6.4, fev1pct:null, egfr:12 },
    opts: { riskBase:55, adherence:'yes', age:71 } },
  { label: 'Acute decompensated CHF', conditions: ['CHF'], expected: 'high',
    vitals: { sbp:92, dbp:58, hr:114, spo2:87, rr:26, temp:37.1, consciousness:'alert', supplementalO2:true, weight:159, glucose:null, potassium:null, fev1pct:null, egfr:null },
    opts: { riskBase:55, adherence:'partial', age:79, baselineWeight:150 } },
];

module.exports = VIGNETTES;
