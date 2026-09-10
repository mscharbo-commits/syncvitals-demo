# SyncVitals — Connected Demo

Four standalone demo portals wired to one shared, evolving dataset instead of each simulating its own disconnected data.

## Files
- `index.html` — landing page linking all four portals, with a live status of the shared dataset
- `data-engine.js` — the shared data engine: seeds 6 demo patients, evolves their vitals every 8 seconds, computes baseline risk/ER/hospitalization scores, and persists/broadcasts state so every open tab stays in sync
- `api/nutrition-plan.js` — serverless function that proxies AI nutrition plan generation to the Anthropic API, keeping the API key server-side (never exposed to the browser)
- `syncvitals-command.html` — Command Dashboard (risk-scoring pipeline + AI narrative)
- `syncvitals-predict.html` — Prediction AI (disease-specific deterioration modeling)
- `syncvitals-rpm.html` — Nurse Portal / RPM (patient registry, trend charts, care plans, escalation)
- `sv-patient-nutrition.html` — Patient Nutrition Portal (food logging, condition-specific guidance)

## Risk scoring architecture
**Predict AI is the sole authority on risk scores — Command Dashboard and Nurse Portal are read-only spokes, not independent assessors.**

- **Predict AI** computes and pushes `riskScore`, `er48h`, `hosp30d`, `newsScore`/`newsBand`, and the clinical narrative for every patient via `SVEngine.setDerived(id, {..., source:'predict'})`. Once it has assessed a patient, that assessment is authoritative for the rest of the session.
- **The shared engine** (`data-engine.js`) provides a NEWS2-only fallback (`source:'engine'`) so numbers are never blank before Predict AI has run for a patient — but the moment Predict AI enriches a patient, the engine's own per-tick recompute (`fallbackComposite()`) stops touching that patient's score. Vitals and the NEWS2 number itself keep evolving underneath either way — only the composite assessment is gated.
- **Command Dashboard** no longer computes or pushes a competing score. It still runs local anomaly detection (for its own alerts panel) and its pipeline visualization, but the risk number / ER% / admit% / narrative it displays are read directly from whatever Predict AI (or the engine fallback) last set. The UI shows which one is currently active ("✓ Predict AI" vs "⏳ NEWS2 baseline").
- **Nurse Portal** has always been read-only for this data; its panel now correctly attributes the source as Predict AI rather than Command Dashboard.

Underneath that hub-and-spoke structure, the composite score is still built in two layers:

1. **NEWS2 (National Early Warning Score 2)** — the acuity core, computed identically everywhere via `SVEngine.computeNEWS2()`. NEWS2 was originally published by the Royal College of Physicians (UK, 2017 update) and endorsed by NHS England, but it also has direct U.S. federal healthcare adoption worth leading with for a U.S. audience:
   - Selected for inclusion in the **U.S. Department of Veterans Affairs' new nationwide federal Electronic Health Record**.
   - Peer-reviewed validation in a U.S. Veteran population at Kansas City VA Medical Center (4,781 patients, 142,375 NEWS readings, AUC 0.72 for predicting 24h ICU transfer/mortality).
   - Subject of a formal evidence review commissioned directly by the VA's Evidence-based Synthesis Program to guide system-wide implementation.
2. **Condition-specific modifiers**, layered on top and individually sourced: glucose thresholds from ADA Standards of Care (diabetes), CHF rapid-weight-gain thresholds from standard AHA self-monitoring guidance, hypertension staging from AHA/ACC (2017 guideline, JNC8 lineage), hyperkalemia + eGFR staging from KDIGO (CKD), and FEV1% staging from GOLD 2024 (COPD).

This split matters for credibility: the NEWS2 layer is a real, citable, externally validated instrument with genuine U.S. federal deployment; the condition-specific modifiers are guideline-sourced but not independently validated as a combined predictive model.

## AI nutrition plan generation
The Nurse Portal's "AI Build" nutrition planner (`nutrAIBuild()` in `syncvitals-rpm.html`) calls `/api/nutrition-plan`, a Vercel serverless function that holds the real Anthropic API key and forwards the request. This requires an **`ANTHROPIC_API_KEY`** environment variable set on the Vercel project (Project Settings → Environment Variables). Without it, the function returns an error and the UI automatically falls back to a rule-based offline plan — so the feature degrades gracefully either way, it just won't be true AI-generated content until the key is set.

## How it's wired together
- `data-engine.js` is loaded by every portal and owns one canonical patient dataset in `localStorage` (`sv_shared_state_v1`), replicated across tabs via `BroadcastChannel` and the native `storage` event.
- Every 8 seconds, whichever tab is open ticks the engine forward: vitals random-walk (biased by each patient's `deteriorating` flag), and baseline risk/ER/hospitalization scores get recomputed. This always keeps data moving even if only one portal is open.
- Command Dashboard and Prediction AI additionally run their own richer, disease-specific scoring and push it into the shared engine via `SVEngine.setDerived(patientId, {...})` — so if either of those portals is open, Nurse Portal shows their richer analysis; otherwise it falls back to the engine's baseline scoring, so panels are never empty.
- Nurse Portal listens for the engine's `sv:update` event and re-renders instantly (registry list, prediction panel, BP/vitals trend chart) instead of relying only on a polling timer.
- Legacy `localStorage` keys (`sv_pred_<patientId>`) are still written for backward compatibility with any code that reads them directly.

## Running locally
This is a static site — no build step. From this folder:
```
python3 -m http.server 8000
```
Then open `http://localhost:8000` — **not** the files directly via `file://`, since each `file://` document gets an isolated `localStorage` and the portals won't be able to share data.

## Best demo flow
1. Open Command Dashboard (or Predict AI) in one tab — leave it running.
2. Open Nurse Portal in a second tab.
3. Watch the "AI Prediction Engine" panel and BP trend chart update on their own every few seconds, matching what Command/Predict are computing.
