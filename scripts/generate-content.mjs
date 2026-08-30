#!/usr/bin/env node
// Content queue runner.
//
//   node scripts/generate-content.mjs                 # dry run: plan + cost
//   node scripts/generate-content.mjs --commit        # actually generate
//   node scripts/generate-content.mjs --commit --budget 5
//
// Dry run is the default on purpose: every mesh call costs real money, and an
// agent running unattended should have to opt in explicitly. The budget cap is
// a hard stop, not a warning.
//
// After generating, run `npm run verify:all` — generation succeeding is not
// the same as the asset being reachable and loadable.

import { PROPS } from '../content/queue.mjs';
import { Budget, generateProp, COST } from './lib/genkit.mjs';

const COMMIT = process.argv.includes('--commit');
const CAP = process.argv.includes('--budget')
  ? parseFloat(process.argv[process.argv.indexOf('--budget') + 1])
  : 10;

if (!PROPS.length) {
  console.log('\n  Content queue is empty — add entries to content/queue.mjs\n');
  process.exit(0);
}

const budget = new Budget(CAP);
console.log(`\n  ${COMMIT ? 'GENERATING' : 'DRY RUN'} — ${PROPS.length} queued prop(s), $${CAP.toFixed(2)} cap`);
console.log('  ' + '─'.repeat(58));

const results = [];
for (const spec of PROPS) {
  if (!spec.placements?.length) {
    console.log(`  ✗ ${spec.id}: no placements — would be unreachable, skipping`);
    results.push({ id: spec.id, status: 'rejected-no-placement' });
    continue;
  }
  try {
    const r = await generateProp({ ...spec, budget, commit: COMMIT });
    console.log(`  ${r.status === 'generated' ? '✓' : '·'} ${r.id}: ${r.status}`);
    results.push(r);
  } catch (e) {
    console.log(`  ✗ ${spec.id}: ${e.message}`);
    results.push({ id: spec.id, status: 'failed', error: e.message });
    if (/budget exceeded/.test(e.message)) break;
  }
}

console.log('  ' + '─'.repeat(58));
console.log(`  ${budget.report()}`);
if (!COMMIT) {
  const est = PROPS.length * (COST.image + COST.mesh);
  console.log(`  estimated cost to run for real: ~$${est.toFixed(2)}`);
  console.log('  re-run with --commit to generate\n');
} else {
  console.log('  now run: npm run verify:all\n');
}
process.exit(results.some(r => r.status === 'failed') ? 1 : 0);
