// Run: node tests/run-clinical-validation.js
//
// Feeds known, guideline-defensible clinical vignettes (tests/clinical-vignettes.js)
// through the ACTUAL production scoring function (SVEngine.scoreVitals) and grades
// the result against the expected risk tier. This validates the real code path —
// re-run this after any change to data-engine.js's scoring logic to check for
// regressions before deploying.
const path = require('path');

global.window = global;
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.document = { addEventListener: () => {} };
global.CustomEvent = function () {};
global.BroadcastChannel = undefined;
global.addEventListener = () => {};
global.dispatchEvent = () => {};

require(path.join(__dirname, '..', 'data-engine.js'));
const VIGNETTES = require(path.join(__dirname, 'clinical-vignettes.js'));

console.log('═══════════════════════════════════════════════════════════════════');
console.log('CLINICAL VALIDATION — known scenarios through production scoring');
console.log('═══════════════════════════════════════════════════════════════════\n');

let pass = 0, fail = 0;
const failures = [];

VIGNETTES.forEach(vig => {
  const result = window.SVEngine.scoreVitals(vig.conditions, vig.vitals, vig.opts);
  const correct = result.tier === vig.expected;
  if (correct) pass++; else { fail++; failures.push(vig.label); }
  const mark = correct ? '✓ PASS' : '✗ FAIL';
  console.log(`${mark}  ${vig.label}`);
  console.log(`        expected: ${vig.expected.toUpperCase()}  |  actual: ${result.tier.toUpperCase()} (score ${result.score}, NEWS2 ${result.newsScore} ${result.newsBand})`);
});

console.log('\n───────────────────────────────────────────────────────────────────');
console.log(`RESULT: ${pass}/${pass + fail} passed (${Math.round(pass / (pass + fail) * 100)}%)`);
if (failures.length) console.log('Failures: ' + failures.join('; '));
console.log('───────────────────────────────────────────────────────────────────');

process.exit(fail > 0 ? 1 : 0);
