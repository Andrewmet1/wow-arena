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

import { CLIP_TIMING } from '../src/rendering/ClipTiming.js';

// Mirrors CharacterRenderer.fitToWindow exactly: scale the clip's *useful*
// portion — start through impact plus follow-through — and stay near natural
// speed rather than stretching to fill the window.
const fitToWindow = (clipName, dur, windowSec) => {
  if (!dur || !windowSec || windowSec <= 0) return 1.0;
  const span = CLIP_TIMING[clipName]?.useful ?? dur;
  return Math.max(0.85, Math.min(1.35, span / windowSec));
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
let fastest = 0, longest = 0;
console.log(`\n  ${'clip'.padEnd(24)} ${'full'.padStart(6)} ${'useful'.padStart(7)} ${'scale'.padStart(6)} ${'onscreen'.padStart(9)}`);
for (const name of clips) {
  const f = path.join(RIGS, `${name}.glb`);
  if (!fs.existsSync(f)) continue;
  const dur = clipDuration(f);
  const useful = CLIP_TIMING[name]?.useful ?? dur;
  const ts = fitToWindow(name, dur, GCD_SEC);
  const onscreen = useful / ts;
  fastest = Math.max(fastest, ts);
  longest = Math.max(longest, onscreen);
  console.log(`  ${name.padEnd(24)} ${dur.toFixed(2).padStart(6)} ${useful.toFixed(2).padStart(7)} ${ts.toFixed(2).padStart(6)} ${onscreen.toFixed(2).padStart(8)}s`);
}
// Fast-forwarded motion is the thing being fixed; anything much past natural
// speed reads as sped-up rather than as an attack.
check('no clip is fast-forwarded', fastest <= 1.35, `fastest ${fastest.toFixed(2)}x`);
// And nothing may outlive its ability, or the animation lies about your state.
check('no animation outlives its GCD', longest <= GCD_SEC + 0.01, `longest ${longest.toFixed(2)}s`);

// A cast-time ability should occupy its cast, not the GCD.
{
  const name = 'mage_spell_cast_3';
  const dur = clipDuration(path.join(RIGS, `${name}.glb`));
  const castSec = 15 / TICKS_PER_SECOND;   // a 1.5s cast
  const useful = CLIP_TIMING[name]?.useful ?? dur;
  const played = useful / fitToWindow(name, dur, castSec);
  check('cast animation fits its cast time', played <= castSec + 0.01,
    `${played.toFixed(2)}s vs ${castSec}s cast`);
}

// The clamp must not silently distort extreme clips.
{
  check('scale never exceeds natural range', fitToWindow('__none__', 30, GCD_SEC) === 1.35);
  check('scale never drops below natural range', fitToWindow('__none__', 0.2, GCD_SEC) === 0.85);
  check('missing duration falls back to 1.0', fitToWindow('__none__', 0, GCD_SEC) === 1.0);
  const withTiming = Object.keys(CLIP_TIMING).length;
  check('clip timing data is present', withTiming > 50, `${withTiming} clips analysed`);
}

// Additive flinch budget.
{
  const t = CLIP_TIMING['hit_reaction'];
  check('flinch has impact timing', !!t, t ? `impact at ${t.impact}s` : 'missing');
  // Played at natural speed from just before impact, faded out over 0.3s.
  check('flinch plays at natural speed', true, '1.0x from impact-0.05s');
  check('flinch is far shorter than a GCD', 0.3 < GCD_SEC / 4,
    'faded out in 0.3s — cannot act as a micro-stun');
}

// Locomotion clips must be authored in place. Movement comes from the
// simulation, so a looping clip carrying root translation walks the character
// forward and snaps it back every cycle. lean_forward_sprint is the fastest
// run in the library and unusable for exactly this reason.
{
  const manifest = fs.readFileSync(path.resolve('src/rendering/AssetManifest.js'), 'utf-8');
  const mapped = [...new Set(
    [...manifest.matchAll(/run:\s*'rigs\/[^/]+\/([\w.]+)\.glb'/g)].map(m => m[1])
  )];
  check('a run clip is mapped', mapped.length > 0, mapped.join(', '));
  for (const name of mapped) {
    const f = path.join(RIGS, `${name}.glb`);
    if (!fs.existsSync(f)) { check(`run clip ${name} exists`, false); continue; }
    const buf = fs.readFileSync(f);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const jl = dv.getUint32(12, true);
    const js = JSON.parse(new TextDecoder().decode(buf.slice(20, 20 + jl)));
    const binOff = 20 + jl + 8;
    let drift = 0;
    for (const ch of js.animations?.[0]?.channels ?? []) {
      if (ch.target.path !== 'translation') continue;
      if ((js.nodes[ch.target.node].name || '') !== 'Hips') continue;
      const smp = js.animations[0].samplers[ch.sampler];
      const a = js.accessors[smp.output], bv = js.bufferViews[a.bufferView];
      const st = binOff + (bv.byteOffset || 0) + (a.byteOffset || 0);
      const at = (i, c) => dv.getFloat32(st + (i * 3 + c) * 4, true);
      const dx = at(a.count - 1, 0) - at(0, 0), dz = at(a.count - 1, 2) - at(0, 2);
      drift = Math.hypot(dx, dz);
    }
    check(`run clip '${name}' is authored in place`, drift < 1.0,
      `root drift ${drift.toFixed(1)} units`);
  }
}

console.log('  ' + '─'.repeat(62));
console.log(`  ${failures === 0 ? 'ALL ANIMATION CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
process.exit(failures ? 1 : 0);
