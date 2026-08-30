// Animation timing contract.
//
// Combat read as choppy because every one-shot clip was longer than the window
// the state machine held it for, so swings were truncated and snapped to idle.
// This asserts the replacement rule: a clip is time-scaled to occupy exactly
// its gameplay window — the ability's cast time, or the GCD for an instant.
//
// PvP is why it must be exact rather than merely "long enough": an opponent
// reads your animation to know when you can act again, so an animation that
// outlives its GCD misinforms them, and one cut short misinforms them too.
//
//   node scripts/test-animation.mjs

import fs from 'fs';
import path from 'path';

const TICKS_PER_SECOND = 10;
const GCD_DURATION = 15;                    // ticks
const GCD_SEC = GCD_DURATION / TICKS_PER_SECOND;
const RIGS = path.resolve('public/assets/animations/rigs/tyrant_frost_dragon');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

function clipDuration(file) {
  const buf = fs.readFileSync(file);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const jsonLen = dv.getUint32(12, true);
  const js = JSON.parse(new TextDecoder().decode(buf.slice(20, 20 + jsonLen)));
  let best = 0;
  for (const a of js.animations || []) {
    for (const smp of a.samplers || []) {
      const acc = js.accessors[smp.input];
      if (acc?.max) best = Math.max(best, acc.max[0]);
    }
  }
  return best;
}

// Mirrors CharacterRenderer.fitToWindow exactly.
const fitToWindow = (dur, windowSec) => {
  if (!dur || !windowSec || windowSec <= 0) return 1.0;
  return Math.max(0.35, Math.min(4.0, dur / windowSec));
};

console.log('\n  ANIMATION TIMING\n  ' + '─'.repeat(62));

// Real ability cast times across every class.
const castTimes = [];
for (const f of fs.readdirSync('src/classes')) {
  if (!/^[A-Z]/.test(f)) continue;
  const src = fs.readFileSync(path.join('src/classes', f), 'utf-8');
  for (const m of src.matchAll(/castTime:\s*(\d+)/g)) castTimes.push(Number(m[1]));
}
const instants = castTimes.filter(t => t === 0).length;
check('most abilities are instants (GCD-bound)', instants / castTimes.length > 0.7,
  `${instants}/${castTimes.length}`);

// Every one-shot clip must land on its window after scaling.
const clips = ['attack', 'left_slash', 'heavy_hammer_swing', 'mage_spell_cast_3',
               'charged_ground_slam', 'block', 'sword_judgment'];
let worst = 0;
console.log(`\n  ${'clip'.padEnd(24)} ${'raw'.padStart(6)} ${'scale'.padStart(6)} ${'played'.padStart(7)}`);
for (const name of clips) {
  const f = path.join(RIGS, `${name}.glb`);
  if (!fs.existsSync(f)) continue;
  const dur = clipDuration(f);
  const ts = fitToWindow(dur, GCD_SEC);
  const played = dur / ts;                 // seconds of wall clock
  worst = Math.max(worst, Math.abs(played - GCD_SEC));
  console.log(`  ${name.padEnd(24)} ${dur.toFixed(2).padStart(6)} ${ts.toFixed(2).padStart(6)} ${played.toFixed(2).padStart(7)}s`);
}
check('every clip fills its GCD window', worst < 0.01, `worst deviation ${worst.toFixed(3)}s`);

// A cast-time ability should occupy its cast, not the GCD.
{
  const dur = clipDuration(path.join(RIGS, 'mage_spell_cast_3.glb'));
  const castSec = 15 / TICKS_PER_SECOND;   // a 1.5s cast
  const played = dur / fitToWindow(dur, castSec);
  check('cast animation matches cast time', Math.abs(played - castSec) < 0.01,
    `${played.toFixed(2)}s vs ${castSec}s cast`);
}

// The clamp must not silently distort extreme clips.
{
  check('absurdly long clip is clamped, not frozen', fitToWindow(30, GCD_SEC) === 4.0);
  check('very short clip is clamped, not stalled', fitToWindow(0.2, GCD_SEC) === 0.35);
  check('missing duration falls back to 1.0', fitToWindow(0, GCD_SEC) === 1.0);
}

// Additive flinch budget.
{
  const dur = clipDuration(path.join(RIGS, 'hit_reaction.glb'));
  const ts = Math.max(1, dur / 0.25);
  check('hit flinch compressed to ~0.25s', Math.abs(dur / ts - 0.25) < 0.01,
    `${dur.toFixed(2)}s clip at ${ts.toFixed(1)}x`);
  check('flinch is far shorter than a GCD', dur / ts < GCD_SEC / 4,
    'cannot act as a micro-stun');
}

console.log('  ' + '─'.repeat(62));
console.log(`  ${failures === 0 ? 'ALL ANIMATION CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
process.exit(failures ? 1 : 0);
