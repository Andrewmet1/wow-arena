// Combat design rules, enforced.
//
// These are deliberate choices about how the game plays, and the kind that
// erode silently as abilities get added or tuned. Encoding them means a
// violation shows up as a failing check rather than as a class that quietly
// stops feeling like its archetype.
//
//   node scripts/test-combat-design.mjs

import fs from 'fs';
import path from 'path';

const TICKS_PER_SECOND = 10;
const MAX_CAST_SEC = 3.0;          // beyond this an arena cast is uncastable
const MELEE = ['Tyrant', 'Wraith'];    // no hard casts at all
const CASTERS = ['Infernal', 'Harbinger'];
const HYBRID = ['Revenant'];       // a small number of casts is correct

let failures = 0;
const check = (label, cond, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

function castsFor(cls) {
  const src = fs.readFileSync(path.join('src/classes', `${cls}.js`), 'utf-8');
  const out = [];
  for (const m of src.matchAll(/id:\s*'([a-z_]+)'[\s\S]{0,600}?castTime:\s*(\d+)/g)) {
    const ticks = Number(m[2]);
    if (ticks > 0) out.push({ id: m[1], ticks, sec: ticks / TICKS_PER_SECOND });
  }
  return out;
}

console.log('\n  COMBAT DESIGN RULES\n  ' + '─'.repeat(58));

// Melee archetypes are defined by never standing still to cast.
for (const cls of MELEE) {
  const casts = castsFor(cls);
  check(`${cls} (melee) has no hard casts`, casts.length === 0,
    casts.length ? casts.map(c => `${c.id} ${c.sec}s`).join(', ') : 'all instants');
}

// Casters should actually cast, or they are just melee at range.
for (const cls of CASTERS) {
  const casts = castsFor(cls);
  check(`${cls} (caster) has cast-time abilities`, casts.length >= 3, `${casts.length} casts`);
}

// A hybrid earns a couple, not a spellbook.
for (const cls of HYBRID) {
  const casts = castsFor(cls);
  check(`${cls} (hybrid) casts are limited`, casts.length > 0 && casts.length <= 3,
    `${casts.length} cast(s)`);
}

// The cap applies to everyone.
{
  const all = [...MELEE, ...CASTERS, ...HYBRID].flatMap(c => castsFor(c).map(x => ({ ...x, cls: c })));
  const over = all.filter(a => a.sec > MAX_CAST_SEC);
  check(`no cast exceeds ${MAX_CAST_SEC}s`, over.length === 0,
    over.length ? over.map(a => `${a.cls}.${a.id} ${a.sec}s`).join(', ') : `longest ${Math.max(...all.map(a => a.sec))}s`);
}

// Sub-GCD casts are pointless: the GCD gates them anyway, so they read as
// instants with extra steps.
{
  const GCD_SEC = 1.5;
  const all = [...CASTERS, ...HYBRID].flatMap(c => castsFor(c).map(x => ({ ...x, cls: c })));
  const under = all.filter(a => a.sec > 0 && a.sec < GCD_SEC * 0.5);
  console.log(under.length
    ? `  NOTE  ${under.length} cast(s) under ${GCD_SEC * 0.5}s read as instants: ${under.map(a => a.cls + '.' + a.id).join(', ')}`
    : '  NOTE  no sub-GCD casts');
}

console.log('  ' + '─'.repeat(58));
console.log(`  ${failures === 0 ? 'ALL DESIGN RULES HOLD' : failures + ' RULE(S) VIOLATED'}\n`);
process.exit(failures ? 1 : 0);
