// Wave Function Collapse over a kit's socket constraints.
//
// The first assembler picked a random piece per cell. That is a shuffle, not a
// generator: nothing stopped a wall opening onto solid rock or an arch leading
// nowhere, and the output read as repeating boxes however good the art was.
//
// WFC treats the room as a constraint problem. Every cell starts holding every
// module that could go there; collapsing one cell removes the now-impossible
// options from its neighbours, and that removal cascades. Each local choice
// stays compatible with everything around it, which is what produces variety
// that still looks deliberate.
//
// A "module" is a (piece, rotation) pair — a wall facing north and the same
// wall facing east are different modules with different sockets.

import { DIRS, OPPOSITE, rotateSockets } from './KitSchema.js';

const STEP = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

/** Expand a kit into rotated modules and precompute what may touch what. */
export function buildModules(kit) {
  const modules = [];
  for (const p of kit) {
    const ids = [p.id, ...(p.variants || [])];
    const turns = p.rotatable === false ? [0] : [0, 1, 2, 3];
    for (const id of ids) {
      for (const t of turns) {
        modules.push({ pieceId: id, role: p.role, turns: t, sockets: rotateSockets(p.sockets, t), weight: p.weight ?? 1 });
      }
    }
  }
  // compat[dir][i] = bitset-ish Set of module indices allowed on that side of i.
  const compat = {};
  for (const d of DIRS) {
    compat[d] = modules.map(a =>
      new Set(modules.map((b, j) => (a.sockets[d] === b.sockets[OPPOSITE[d]] ? j : -1)).filter(j => j >= 0))
    );
  }
  return { modules, compat };
}

/**
 * Solve a w×h grid.
 *
 * `fixed` pins cells before solving — used for room perimeters, where the
 * outward face must be 'void' or the solver would happily wall off the middle
 * of the floor.
 *
 * Contradictions are expected rather than exceptional: a constrained grid can
 * paint itself into a corner, so the solve restarts with a fresh sequence a
 * bounded number of times before giving up. Returning null lets the caller fall
 * back rather than throwing mid-build.
 */
export function solve({ w, h, modules, compat, rng, fixed = () => null, attempts = 12 }) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const wave = new Array(w * h);
    for (let i = 0; i < w * h; i++) wave[i] = new Set(modules.keys ? modules.keys() : modules.map((_, k) => k));

    let contradiction = false;
    const at = (x, y) => y * w + x;
    const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h;

    // Narrow a cell to a predicate, then propagate the consequences.
    const constrain = (x, y, pred) => {
      const cell = wave[at(x, y)];
      let changed = false;
      for (const m of [...cell]) if (!pred(modules[m], m)) { cell.delete(m); changed = true; }
      if (!cell.size) contradiction = true;
      return changed;
    };

    const propagate = (startX, startY) => {
      const stack = [[startX, startY]];
      while (stack.length && !contradiction) {
        const [x, y] = stack.pop();
        const cell = wave[at(x, y)];
        for (const d of DIRS) {
          const [dx, dy] = STEP[d];
          const nx = x + dx, ny = y + dy;
          if (!inside(nx, ny)) continue;
          // Union of everything the current cell's remaining options permit.
          const allowed = new Set();
          for (const m of cell) for (const j of compat[d][m]) allowed.add(j);
          const nCell = wave[at(nx, ny)];
          let changed = false;
          for (const m of [...nCell]) if (!allowed.has(m)) { nCell.delete(m); changed = true; }
          if (!nCell.size) { contradiction = true; return; }
          if (changed) stack.push([nx, ny]);
        }
      }
    };

    // Pin boundary//caller-fixed cells first so propagation starts from truth.
    for (let y = 0; y < h && !contradiction; y++) {
      for (let x = 0; x < w && !contradiction; x++) {
        const want = fixed(x, y);
        if (!want) continue;
        constrain(x, y, want);
        if (!contradiction) propagate(x, y);
      }
    }
    if (contradiction) continue;

    // Collapse lowest-entropy cells until everything is decided.
    while (!contradiction) {
      let best = -1, bestN = Infinity;
      for (let i = 0; i < wave.length; i++) {
        const n = wave[i].size;
        if (n > 1 && n < bestN) { bestN = n; best = i; }
      }
      if (best < 0) break;   // fully collapsed

      const opts = [...wave[best]];
      const total = opts.reduce((s, m) => s + modules[m].weight, 0);
      let r = rng() * total, chosen = opts[opts.length - 1];
      for (const m of opts) { r -= modules[m].weight; if (r <= 0) { chosen = m; break; } }
      wave[best] = new Set([chosen]);
      propagate(best % w, Math.floor(best / w));
    }

    if (contradiction) continue;
    return wave.map(c => modules[[...c][0]]);
  }
  return null;   // caller falls back
}
