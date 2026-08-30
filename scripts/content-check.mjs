#!/usr/bin/env node
// content-check — reconcile generated dungeon content against what the
// engine can actually reach.
//
// This is the missing success signal. Generation scripts had no way to know
// whether an asset landed somewhere reachable, so 68 of them quietly didn't.
// Run this after any content batch; non-zero exit means drift.
//
//   node scripts/content-check.mjs           # report
//   node scripts/content-check.mjs --json    # machine-readable (for agents)
//   node scripts/content-check.mjs --strict  # exit 1 on orphans too

import { scanDisk, scanEngine, scanDeclaredMonsters, scanThemeTextures, scanAnimations, scanCharacters } from './lib/content-index.mjs';

const JSON_OUT = process.argv.includes('--json');
const STRICT   = process.argv.includes('--strict');

const disk = scanDisk();
const eng = scanEngine();
const declaredMonsters = scanDeclaredMonsters();
const themeTextures = scanThemeTextures();
const anims = scanAnimations();
const chars = scanCharacters();

const pooled = new Set(Object.values(eng.pools).flat());
const aliasTargets = new Set(Object.values(eng.aliases));

// A prop is reachable if it sits in a placement pool, is an alias target, or
// is quoted anywhere else in the engine (chest/shrine/throne specials).
const reachable = (id) =>
  pooled.has(id) || aliasTargets.has(id) || eng.referenced.has(id);

const propOrphans = disk.props.filter(id => !reachable(id));
const propBroken  = [...pooled].filter(id => !disk.props.includes(id) && !eng.aliases[id]);
const themeLive = new Set(Object.values(themeTextures).flatMap(i => i.live));
// Derived companions. loadNormal() builds `${name}_normal.png` from a surface
// texture's name, so the file is never mentioned literally anywhere — a
// name-matching audit reports all 46 as orphans and buries the real ones.
// A companion is reachable exactly when its base texture is.
const texReachable = (id) => {
  if (eng.engineReferenced.has(id) || themeLive.has(id)) return true;
  const base = id.replace(/_normal$/, '');
  return base !== id && (eng.engineReferenced.has(base) || themeLive.has(base));
};
const texOrphans  = disk.textures.filter(id => !texReachable(id));
const blocked     = eng.blocked || [];
const monOrphans  = disk.monsters.filter(id => !declaredMonsters.includes(id));
const monMissing  = declaredMonsters.filter(id => !disk.monsters.includes(id));
const unpreloaded = disk.props.filter(id => pooled.has(id) && !eng.preload.includes(id));

// Textures declared in a theme but outside the blocks the engine resolves
// at runtime — those never reach the renderer.
const themeDrift = {};
for (const [theme, info] of Object.entries(themeTextures)) {
  if (info.inert.length) themeDrift[theme] = info.inert;
}

const report = {
  props:    { onDisk: disk.props.length,    reachable: disk.props.filter(reachable).length, orphans: propOrphans, brokenRefs: propBroken },
  textures: { onDisk: disk.textures.length, reachable: disk.textures.filter(texReachable).length, orphans: texOrphans },
  blocked,
  monsters: { onDisk: disk.monsters.length, declared: declaredMonsters.length, orphans: monOrphans, missingModels: monMissing },
  preload:  { pooled: pooled.size, preloaded: eng.preload.length, lazyLoaded: unpreloaded.length },
  themeDrift,
  animations: anims,
  characters: chars,
};

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const bar = (n, tot) => {
    const w = 24, f = tot ? Math.round((n / tot) * w) : 0;
    return '█'.repeat(f) + '░'.repeat(w - f);
  };
  const pct = (n, tot) => tot ? `${Math.round((n / tot) * 100)}%` : '—';

  console.log('\n  CONTENT AUDIT\n  ' + '─'.repeat(58));
  for (const [name, key] of [['Props', 'props'], ['Textures', 'textures']]) {
    const r = report[key];
    console.log(`  ${name.padEnd(9)} ${bar(r.reachable, r.onDisk)}  ${String(r.reachable).padStart(3)}/${String(r.onDisk).padEnd(4)} reachable  (${r.orphans.length} orphaned, ${pct(r.orphans.length, r.onDisk)})`);
  }
  const okModels = chars.models.filter(m => m.desktop && m.mobile && m.pbr).length;
  console.log(`  ${'Characters'.padEnd(9)} ${bar(okModels, chars.models.length)}  ${String(okModels).padStart(3)}/${String(chars.models.length).padEnd(4)} complete   (model + LOD + PBR)`);
  const m = report.monsters;
  console.log(`  ${'Monsters'.padEnd(9)} ${bar(m.declared, m.onDisk)}  ${String(m.declared).padStart(3)}/${String(m.onDisk).padEnd(4)} declared   (${m.orphans.length} can never spawn)`);

  const show = (title, ids, note) => {
    if (!ids.length) return;
    console.log(`\n  ${title}  (${ids.length})${note ? '\n  ' + note : ''}`);
    for (const id of ids) console.log('     · ' + id);
  };
  show('ORPHANED PROPS', propOrphans, 'generated + paid for, no code path reaches them');
  show('ORPHANED MONSTERS', monOrphans, 'model exists but not declared in server/dungeon/monsters.js');
  show('ORPHANED TEXTURES', texOrphans);
  show('BROKEN REFS — pooled but no file', propBroken, 'these fail to load at runtime');
  show('MISSING MONSTER MODELS', monMissing, 'declared server-side, no GLB — falls back to class mesh');

  if (chars.issues.length) {
    console.log(`\n  CHARACTER CONTENT ISSUES  (${chars.issues.length})`);
    for (const i of chars.issues) console.log(`     · ${i.id.padEnd(46)} ${i.kind} — ${i.detail}`);
  }

  if (blocked.length) {
    console.log(`\n  DECLARED BUT BLOCKED ON A SYSTEM  (${blocked.length})`);
    console.log('  asset is fine; nothing can place it yet');
    const bySys = {};
    for (const b of blocked) (bySys[b.system] ||= []).push(b.id);
    for (const [sys, ids] of Object.entries(bySys)) console.log(`     · ${sys.padEnd(14)} ${ids.join(', ')}`);
  }

  if (anims.missing.length) {
    console.log(`\n  ANIMATION CLIPS DECLARED WITH NO FILE  (${anims.missing.length})`);
    console.log('  these silently fall back to idle at runtime');
    for (const m of anims.missing) console.log(`     · ${m.key.padEnd(26)} ${m.file}${m.used ? '   [USED BY A CLASS]' : '   (unused decl)'}`);
  }

  const driftThemes = Object.keys(themeDrift);
  if (driftThemes.length) {
    console.log(`\n  THEMES DECLARING TEXTURES THE ENGINE IGNORES  (${driftThemes.length})`);
    console.log('  declared outside floor/wall/vegetation/weather — never sampled');
    for (const t of driftThemes) {
      console.log(`     · ${t.padEnd(22)} ${themeDrift[t].length} ignored: ${themeDrift[t].slice(0,4).join(', ')}${themeDrift[t].length>4?'…':''}`);
    }
  }

  const totalOrphans = propOrphans.length + texOrphans.length + monOrphans.length;
  console.log('\n  ' + '─'.repeat(58));
  console.log(`  ${totalOrphans} unreachable assets · ${propBroken.length} broken refs\n`);
}

// Broken refs are always a failure — they're runtime errors. Orphans only
// fail under --strict so this can be adopted before the backlog is cleared.
const failed = propBroken.length > 0 || monMissing.length > 0
  || anims.missing.some(m => m.used)
  || chars.issues.some(i => i.kind === 'missing-model' || i.kind === 'missing-pbr')
  || (STRICT && (propOrphans.length + texOrphans.length + monOrphans.length) > 0);
process.exit(failed ? 1 : 0);
