// content-index — the single place that knows how to look at dungeon content.
//
// Three views of the same world, which is exactly where the drift comes from:
//   DISK     — what generation actually produced
//   ENGINE   — what DungeonEnvironment.js can actually reach
//   MANIFEST — what we *say* exists (src/rendering/DungeonManifest.js)
//
// Every orphaned asset is a disagreement between two of these. Both
// content-check and the manifest bootstrapper read from here so they can
// never disagree about the facts.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');

const ENGINE = path.join(ROOT, 'src', 'rendering', 'DungeonEnvironment.js');
const MONSTERS_JS = path.join(ROOT, 'server', 'dungeon', 'monsters.js');

export const DIRS = {
  props:    path.join(ROOT, 'public', 'assets', 'models', 'props'),
  monsters: path.join(ROOT, 'public', 'assets', 'models', 'monsters'),
  textures: path.join(ROOT, 'public', 'assets', 'art', 'dungeon'),
};

/** Basenames (no extension) of every file of `ext` in `dir`. */
function scan(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(ext))
    .map(f => path.basename(f, ext))
    .sort();
}

export function scanDisk() {
  return {
    props:    scan(DIRS.props, '.glb'),
    monsters: scan(DIRS.monsters, '.glb'),
    textures: scan(DIRS.textures, '.png'),
  };
}

// The placement pools currently hardcoded in DungeonEnvironment.js. Parsed
// rather than hand-copied so this stays true as the engine changes — and so
// the bootstrapper captures real placement intent instead of guessing.
const POOL_VARS = {
  wall:    ['WALL_PROPS', 'WALL_HUGGING'],
  corner:  ['CORNER_PROPS'],
  center:  ['CENTER_PROPS', 'CENTER'],
  scatter: ['SCATTER_PROPS'],
  cluster: ['CLUSTER'],
  ring:    ['RING_PROPS'],
  pillar:  ['PILLAR_POOL'],
  rubble:  ['RUBBLE_POOL'],
  arch:    ['ARCH_POOL'],
  hanging: ['HANGING_PROPS'],
};

const FLAG_VARS = { destructible: 'DESTRUCTIBLE', cloth: 'CLOTH' };

/** Pull `const NAME = [...]` or `new Set([...])` out of the engine source. */
function extractList(src, varName) {
  const re = new RegExp(
    `const\\s+${varName}\\s*=\\s*(?:new Set\\(\\s*)?\\[([\\s\\S]*?)\\]`, 'm');
  const m = src.match(re);
  if (!m) return [];
  return [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map(x => x[1]);
}

/**
 * Pools now live in DungeonManifest.js and the engine derives them via
 * poolFor(), so parsing array literals out of the engine finds nothing. Read
 * the manifest when it exists and fall back to source-parsing for the
 * pre-manifest layout.
 */
function poolsFromManifest() {
  const p = path.join(ROOT, 'src', 'rendering', 'DungeonManifest.js');
  if (!fs.existsSync(p)) return null;
  const src = fs.readFileSync(p, 'utf-8');
  const pools = {};
  const flags = { destructible: [], cloth: [] };
  const re = /\{ id: '([a-z0-9_]+)', placements: \[([^\]]*)\]([^}]*)\}/g;
  for (const m of src.matchAll(re)) {
    const id = m[1];
    const places = [...m[2].matchAll(/'([a-z0-9_:]+)'/g)].map(x => x[1]);
    for (const pl of places) (pools[pl] ||= []).push(id);
    if (m[3].includes('destructible: true')) flags.destructible.push(id);
    if (m[3].includes('cloth: true')) flags.cloth.push(id);
  }
  return { pools, flags };
}

export function scanEngine() {
  const src = fs.readFileSync(ENGINE, 'utf-8');
  const manifest = poolsFromManifest();

  let pools = {}, flags = {};
  if (manifest) {
    pools = manifest.pools;
    flags = manifest.flags;
  } else {
    for (const [pool, vars] of Object.entries(POOL_VARS)) {
      const ids = new Set();
      for (const v of vars) extractList(src, v).forEach(id => ids.add(id));
      pools[pool] = [...ids].sort();
    }
    for (const [flag, v] of Object.entries(FLAG_VARS)) flags[flag] = extractList(src, v);
  }

  const aliasBlock = src.match(/const PROP_ALIASES\s*=\s*\{([\s\S]*?)\}/m);
  const aliases = {};
  if (aliasBlock) {
    for (const [, k, v] of aliasBlock[1].matchAll(/([a-z0-9_]+)\s*:\s*'([a-z0-9_]+)'/g)) {
      aliases[k] = v;
    }
  }

  // Any quoted lowercase token in the engine — the broad net used to decide
  // whether an on-disk asset is reachable at all, even outside a named pool.
  // Two distinct questions, and conflating them makes the audit lie:
  //   engineReferenced — does DungeonEnvironment.js actually read this name?
  //   referenced       — is it reachable at all (engine OR manifest pool)?
  // Theme drift must use the former: a texture the manifest declares but the
  // renderer never samples still renders as nothing.
  const engineReferenced = new Set([...src.matchAll(/['"]([a-z0-9_]+)['"]/g)].map(m => m[1]));
  const referenced = new Set(engineReferenced);
  const mpath = path.join(ROOT, 'src', 'rendering', 'DungeonManifest.js');
  const blocked = [];
  if (fs.existsSync(mpath)) {
    const msrc = fs.readFileSync(mpath, 'utf-8');
    for (const m of msrc.matchAll(/\{ id: '([a-z0-9_]+)', placements: \[([^\]]*)\]/g)) {
      const places = [...m[2].matchAll(/'([a-z0-9_:]+)'/g)].map(x => x[1]);
      if (places.some(x => x.startsWith('blocked:'))) {
        blocked.push({ id: m[1], system: places.find(x => x.startsWith('blocked:')).split(':')[1] });
      } else {
        referenced.add(m[1]);
      }
    }
  }

  const preload = extractList(src, 'PROP_IDS');

  return { pools, flags, aliases, referenced, engineReferenced, blocked, preload };
}

/** Monster ids declared server-side — only these can ever spawn. */
export function scanDeclaredMonsters() {
  if (!fs.existsSync(MONSTERS_JS)) return [];
  const src = fs.readFileSync(MONSTERS_JS, 'utf-8');
  return [...src.matchAll(/^\s{2}([a-z0-9_]+):\s*\{/gm)].map(m => m[1]).sort();
}

export function loadManifest() {
  const p = path.join(ROOT, 'src', 'rendering', 'DungeonManifest.js');
  if (!fs.existsSync(p)) return null;
  return import(`file://${p}`).then(m => m).catch(() => null);
}

/**
 * Textures each theme declares. A theme can name a texture that exists on
 * disk and still never render it, because the engine reads only its own
 * hardcoded names — which is why several themes currently look alike.
 */
export function scanThemeTextures() {
  const p = path.join(ROOT, 'server', 'dungeon', 'themes.js');
  if (!fs.existsSync(p)) return {};
  const src = fs.readFileSync(p, 'utf-8');

  // The engine resolves theme art at runtime through a fixed set of fields
  // (see DungeonEnvironment: _theme?.floor / .wall / .vegetation / .weather),
  // so those texture names never appear as literals in the engine source.
  // Anything under one of these keys IS rendered; only names outside them are
  // genuinely ignored. Matching on engine string literals instead flags every
  // themed texture as drift, which is wrong.
  const LIVE_KEYS = ['floor', 'wall', 'vegetation', 'weather', 'lighting', 'atmosphere'];

  const themes = {};
  const keys = [...src.matchAll(/^\s{2}([a-z0-9_]+):\s*\{/gm)];
  keys.forEach((m, i) => {
    const start = m.index;
    const end = i + 1 < keys.length ? keys[i + 1].index : src.length;
    const body = src.slice(start, end);

    // Carve out the sub-blocks the engine reads, so we can tell live art from
    // decorative leftovers.
    const live = new Set();
    for (const key of LIVE_KEYS) {
      const km = new RegExp(`^\\s{4}${key}:\\s*\\{`, 'm').exec(body);
      if (!km) continue;
      // Consume to the matching close brace at the same indent.
      const rest = body.slice(km.index);
      const close = rest.search(/^\s{4}\},?$/m);
      const block = close === -1 ? rest : rest.slice(0, close);
      for (const t of block.matchAll(/'((?:wall|floor|ceiling|decal|tex|vfx)_[a-z0-9_]+)'/g)) live.add(t[1]);
    }

    const all = [...new Set(
      [...body.matchAll(/'((?:wall|floor|ceiling|decal)_[a-z0-9_]+)'/g)].map(x => x[1])
    )];
    themes[m[1]] = { all: all.sort(), live: [...live].sort(), inert: all.filter(t => !live.has(t)).sort() };
  });
  return themes;
}

/**
 * Animation clips declared in AssetManifest that have no file, and clips on
 * disk nothing declares. A declaration with no file silently falls back to
 * `idle` at runtime, which is how "the ability plays no animation" hides.
 */
export function scanAnimations() {
  const p = path.join(ROOT, 'src', 'rendering', 'AssetManifest.js');
  if (!fs.existsSync(p)) return { missing: [], unused: [] };
  const src = fs.readFileSync(p, 'utf-8');
  const shared = /SHARED_ANIMATIONS\s*=\s*\{([\s\S]*?)\n\}/.exec(src);
  const cls = /CLASS_ANIMATIONS\s*=\s*\{([\s\S]*?)\n\};/.exec(src);
  if (!shared) return { missing: [], unused: [] };

  const decls = [...shared[1].matchAll(/(\w+):\s*'([\w./]+\.glb)'/g)]
    .map(m => ({ key: m[1], file: m[2] }));
  const usedKeys = new Set(
    cls ? [...cls[1].matchAll(/:\s*'([\w./]+)'/g)].map(m => m[1]).filter(v => !v.endsWith('.glb')) : []
  );

  const dir = path.join(ROOT, 'public', 'assets', 'animations', 'shared');
  const onDisk = fs.existsSync(dir)
    ? new Set(fs.readdirSync(dir).filter(f => f.endsWith('.glb')))
    : new Set();

  const missing = decls
    .filter(d => !onDisk.has(path.basename(d.file)) && !d.file.includes('/'))
    .map(d => ({ ...d, used: usedKeys.has(d.key) }));
  const declared = new Set(decls.map(d => path.basename(d.file)));
  const unused = [...onDisk].filter(f => !declared.has(f));
  return { missing, unused };
}
