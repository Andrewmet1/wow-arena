// Builds a chamber out of kit pieces instead of primitives.
//
// The greybox emits one PlaneGeometry for the floor and extruded boxes for
// walls, then scatters props on top. Detail painted on primitives cannot read
// as architecture from an overhead camera, because there is no architecture —
// just a textured quad. This walks the chamber as a grid and places real meshes:
// floor tiles, wall segments that face inward, corner blocks, arches at
// doorways, skirting where wall meets floor.
//
// Two properties matter for it to be usable before a kit is fully generated:
//
//   Graceful fallback — a piece with no GLB yet falls back to a tinted box of
//   the correct footprint. A half-generated biome still builds and still plays,
//   so a kit can be filled in a piece at a time instead of all-or-nothing.
//
//   Instancing — every repeat of a piece shares one InstancedMesh. A tiled
//   floor is hundreds of cells; without instancing that is hundreds of draw
//   calls, which is the cost that forced the render features off to begin with.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ROLES, kitPath } from './KitSchema.js';
import { buildModules, solve } from './WFC.js';

const _loader = new GLTFLoader();
const _cache = new Map();     // url -> Promise<THREE.Object3D|null>

function loadPiece(biomeId, pieceId) {
  const url = kitPath(biomeId, pieceId);
  if (_cache.has(url)) return _cache.get(url);
  const p = new Promise((resolve) => {
    _loader.load(url, g => resolve(g.scene), undefined, () => resolve(null));
  });
  _cache.set(url, p);
  return p;
}

/** Deterministic per-chamber RNG so a seed always rebuilds the same room. */
function rngFor(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Merge the geometry of a loaded piece into one buffer for instancing. */
function flatten(obj) {
  const geos = [];
  let mat = null;
  obj.updateWorldMatrix(true, true);
  obj.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    geos.push(g);
    if (!mat) mat = Array.isArray(o.material) ? o.material[0] : o.material;
  });
  if (!geos.length) return null;
  // Single-primitive pieces are the common case; merging many is not worth a
  // dependency here, so take the largest and let the rest ride as extras.
  geos.sort((a, b) => (b.getAttribute('position')?.count || 0) - (a.getAttribute('position')?.count || 0));
  return { geometry: geos[0], material: mat };
}

export class KitAssembler {
  /**
   * @param {THREE.Object3D} root  group to attach built geometry to
   * @param {object} biome         validated biome spec
   */
  constructor(root, biome) {
    this.root = root;
    this.biome = biome;
    this.cell = biome.grid?.cell ?? 4;
    this.wallH = biome.grid?.wallHeight ?? 6;
    this._built = [];
  }

  dispose() {
    for (const o of this._built) {
      this.root.remove(o);
      o.geometry?.dispose?.();
      if (o.material?.dispose) o.material.dispose();
    }
    this._built.length = 0;
    this._lights = [];
  }

  _pick(role, rng) {
    const opts = (this.biome.kit || []).filter(p => p.role === role);
    if (!opts.length) return null;
    const base = opts[Math.floor(rng() * opts.length)];
    const all = [base.id, ...(base.variants || [])];
    return all[Math.floor(rng() * all.length)];
  }

  async _buildFallbackFloor(chamber, nx, nz, x0, z0) {
    const c = this.cell;
    const transforms = [];
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        transforms.push({ pos: new THREE.Vector3(x0 + ix * c, 0.125, z0 + iz * c) });
      }
    }
    const floor = (this.biome.kit || []).find(p => p.role === ROLES.FLOOR);
    await this._place(floor?.id ?? 'floor', transforms, [c, 0.25, c], 0x2f2722);
    return 1;
  }

  /**
   * Place one piece type at many transforms as a single InstancedMesh, falling
   * back to a box of the right size when the GLB does not exist yet.
   */
  async _place(pieceId, transforms, fallbackSize, fallbackColor) {
    if (!transforms.length) return;
    const src = await loadPiece(this.biome.id, pieceId);
    let geometry, material;

    if (src) {
      const f = flatten(src);
      if (f) ({ geometry, material } = f);
    }
    if (!geometry) {
      // No mesh yet — a correctly-sized block keeps the level playable and
      // makes missing pieces obvious rather than invisible.
      geometry = new THREE.BoxGeometry(...fallbackSize);
      material = new THREE.MeshStandardMaterial({ color: fallbackColor, roughness: 0.95, metalness: 0.05 });
    }

    const inst = new THREE.InstancedMesh(geometry, material, transforms.length);
    inst.castShadow = true; inst.receiveShadow = true;
    const m = new THREE.Matrix4();
    transforms.forEach((t, i) => {
      m.compose(t.pos, t.quat ?? new THREE.Quaternion(), t.scale ?? new THREE.Vector3(1, 1, 1));
      inst.setMatrixAt(i, m);
    });
    inst.instanceMatrix.needsUpdate = true;
    // Frustum culling tests the *geometry's* bounding sphere, which is centred
    // on the piece's own origin — not on where its instances actually sit. A
    // chamber placed away from world origin therefore culls entirely and draws
    // nothing. Recomputing over the instance transforms fixes it and keeps
    // culling working, which matters once several chambers exist.
    inst.computeBoundingSphere?.();
    if (!inst.boundingSphere || !isFinite(inst.boundingSphere.radius)) {
      inst.frustumCulled = false;
    }
    inst.userData.kitPiece = pieceId;
    this.root.add(inst);
    this._built.push(inst);
  }

  /**
   * Build one chamber. `doorways` are world-space points where a wall segment
   * should be an arch instead — the assembler snaps each to its nearest
   * perimeter cell.
   */

  /**
   * Collapse runs of the same module into wider pieces where the kit has them.
   *
   * WFC solves one module per cell, which is what makes a wall read as a row of
   * identical panels however good the art is. Real kits mix 1x1, 2x1 and 4x1
   * runs precisely to break that rhythm, and a piece's declared footprint is
   * how it says so.
   *
   * Merging after the solve rather than solving with variable-size modules
   * keeps the constraint problem simple: adjacency is still decided per cell,
   * and a run of N identical modules is by definition internally compatible, so
   * replacing it with one N-wide piece cannot violate a socket rule.
   */
  _mergeRuns(result, nx, nz) {
    const byId = Object.fromEntries((this.biome.kit || []).map(p => [p.id, p]));
    // Widest footprint available per piece id, and any wider sibling that could
    // stand in for a run of it.
    const widerFor = (id) => (this.biome.kit || [])
      .filter(p => p.role === byId[id]?.role && (p.footprint?.[0] ?? 1) > 1)
      .sort((a, b) => (b.footprint[0] - a.footprint[0]));

    const merged = [];
    const consumed = new Set();

    const runAt = (i, step, limit) => {
      const m = result[i];
      let n = 1;
      while (n < limit) {
        const j = i + step * n;
        const nm = result[j];
        if (!nm || nm.pieceId !== m.pieceId || nm.turns !== m.turns) break;
        n++;
      }
      return n;
    };

    // Horizontal runs along the top and bottom edges only — vertical edges and
    // the interior stay per-cell, since a floor run gains nothing visually.
    for (const row of [0, nz - 1]) {
      for (let x = 0; x < nx; x++) {
        const i = row * nx + x;
        if (consumed.has(i)) continue;
        const m = result[i];
        const options = widerFor(m.pieceId);
        if (!options.length) continue;
        const avail = runAt(i, 1, nx - x);
        const pick = options.find(o => o.footprint[0] <= avail);
        if (!pick || pick.footprint[0] < 2) continue;
        const w = pick.footprint[0];
        for (let k = 0; k < w; k++) consumed.add(i + k);
        merged.push({ index: i, span: w, module: { ...m, pieceId: pick.id } });
      }
    }
    return { merged, consumed };
  }


  /**
   * Light pools along the walls.
   *
   * A top-down scene reads as flat when it is evenly lit: with no darkness
   * between sources there is nothing for the eye to use as depth. Diablo-style
   * lighting is mostly dark with strong local pools, so these are deliberately
   * few, bright and short-range rather than many and dim.
   *
   * Count is capped because each is a real light and the render features were
   * already switched off once to buy back frames.
   */
  _placeLights(chamber, nx, nz, x0, z0, rng) {
    const cfg = this.biome.rules?.lights;
    if (!cfg) return 0;
    const c = this.cell;
    const step = Math.max(2, cfg.spacingCells ?? 3);
    const spots = [];
    for (let x = 1; x < nx - 1; x += step) {
      spots.push([x, 0], [x, nz - 1]);
    }
    for (let z = step; z < nz - 1; z += step) {
      spots.push([0, z], [nx - 1, z]);
    }
    const MAX = 10;
    while (spots.length > MAX) spots.splice(Math.floor(rng() * spots.length), 1);

    for (const [gx, gz] of spots) {
      // Pull inward off the wall face so the pool lands on the floor rather
      // than washing the wall it sits on.
      const inX = gx === 0 ? 1 : gx === nx - 1 ? -1 : 0;
      const inZ = gz === 0 ? 1 : gz === nz - 1 ? -1 : 0;
      const l = new THREE.PointLight(cfg.color ?? 0xff7a3c, cfg.intensity ?? 26, cfg.distance ?? 34, 2);
      l.position.set(x0 + gx * c + inX * c * 0.35, cfg.height ?? 7, z0 + gz * c + inZ * c * 0.35);
      l.userData.flickerBase = l.intensity;
      l.userData.flickerAmt = cfg.flicker ?? 0;
      l.userData.flickerPhase = rng() * Math.PI * 2;
      this.root.add(l);
      this._built.push(l);
      (this._lights ??= []).push(l);
    }
    return spots.length;
  }

  /** Per-frame flicker, so pools breathe instead of sitting static. */
  tick(t) {
    for (const l of this._lights ?? []) {
      const a = l.userData.flickerAmt;
      if (!a) continue;
      l.intensity = l.userData.flickerBase * (1 + a * Math.sin(t * 7 + l.userData.flickerPhase));
    }
  }

  /**
   * Small debris across open floor, at mixed sizes.
   *
   * Filler swaps a whole cell for a rubble tile; this is the layer beneath
   * that — several small pieces per cell at a quarter to two-thirds scale.
   * A single size of prop on a clean plane reads as sparse no matter how many
   * are placed, because real floors carry detail at several scales at once.
   */
  _scatterDebris(result, nx, nz, x0, z0, rng, groups) {
    const cfg = this.biome.rules?.scatter;
    if (!cfg) return 0;
    const pool = (this.biome.kit || []).filter(p => p.role === ROLES.FILLER);
    if (!pool.length) return 0;
    const c = this.cell;
    const [lo, hi] = cfg.scaleRange ?? [0.25, 0.7];
    let n = 0;
    result.forEach((m, i) => {
      if (m.role !== ROLES.FLOOR) return;          // only open floor
      if (rng() > (cfg.rate ?? 0.5)) return;
      const cx = x0 + (i % nx) * c;
      const cz = z0 + Math.floor(i / nx) * c;
      for (let k = 0; k < (cfg.perCell ?? 2); k++) {
        const piece = pool[Math.floor(rng() * pool.length)];
        const sc = lo + rng() * (hi - lo);
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
        const pos = new THREE.Vector3(
          cx + (rng() - 0.5) * c * 0.8, 0,
          cz + (rng() - 0.5) * c * 0.8,
        );
        if (!groups.has(piece.id)) groups.set(piece.id, []);
        groups.get(piece.id).push({ pos, quat: q, scale: new THREE.Vector3(sc, sc, sc) });
        n++;
      }
    });
    return n;
  }

  async buildChamber(chamber, doorways = []) {
    const rng = rngFor(chamber.id || `${chamber.cx},${chamber.cz}`);
    const c = this.cell;
    const nx = Math.max(3, Math.round((chamber.halfX * 2) / c));
    const nz = Math.max(3, Math.round((chamber.halfZ * 2) / c));
    const x0 = chamber.cx - (nx * c) / 2 + c / 2;
    const z0 = chamber.cz - (nz * c) / 2 + c / 2;

    if (!this._mods) this._mods = buildModules(this.biome.kit);
    const { modules, compat } = this._mods;

    // Snap doorway points to perimeter cells so arches land in the wall rather
    // than wherever the solver finds them convenient.
    const doorCells = new Set();
    for (const d of doorways) {
      const ix = Math.round((d.cx ?? d.x - x0) / c), iz = Math.round((d.cz ?? d.z - z0) / c);
      doorCells.add(`${Math.max(0, Math.min(nx - 1, ix))},${Math.max(0, Math.min(nz - 1, iz))}`);
    }

    // Pin what the room's shape dictates; the solver decides everything else.
    const fixed = (x, y) => {
      const edge = x === 0 || y === 0 || x === nx - 1 || y === nz - 1;
      const cornerCell = (x === 0 || x === nx - 1) && (y === 0 || y === nz - 1);
      if (cornerCell) return (m) => m.role === ROLES.CORNER;
      if (edge) {
        if (doorCells.has(`${x},${y}`)) return (m) => m.role === ROLES.DOORWAY;
        return (m) => m.role === ROLES.WALL || m.role === ROLES.DOORWAY;
      }
      return (m) => m.role === ROLES.FLOOR || m.role === ROLES.FILLER || m.role === ROLES.PILLAR;
    };

    const result = solve({ w: nx, h: nz, modules, compat, rng, fixed });
    if (!result) {
      // Over-constrained rooms are possible; a plain floor is better than a
      // half-built chamber or a thrown error mid-render.
      console.warn(`[KitAssembler] no solution for ${chamber.id}, falling back to floor only`);
      return this._buildFallbackFloor(chamber, nx, nz, x0, z0);
    }

    const groups = new Map();
    const { merged, consumed } = this._mergeRuns(result, nx, nz);

    const push = (id, pos, quat, scale) => {
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push({ pos, quat, scale });
    };

    // Wider pieces first; their cells are then skipped below.
    for (const run of merged) {
      const x = x0 + (run.index % nx) * c + ((run.span - 1) * c) / 2;   // centre the span
      const z = z0 + Math.floor(run.index / nx) * c;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -run.module.turns * Math.PI / 2);
      push(run.module.pieceId, new THREE.Vector3(x, 0, z), q);
    }

    this._placeLights(chamber, nx, nz, x0, z0, rng);
    this._scatterDebris(result, nx, nz, x0, z0, rng, groups);

    result.forEach((m, i) => {
      if (consumed.has(i)) return;
      const x = x0 + (i % nx) * c;
      const z = z0 + Math.floor(i / nx) * c;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -m.turns * Math.PI / 2);
      push(m.pieceId, new THREE.Vector3(x, 0, z), q);
    });

    // Emit one InstancedMesh per piece. Fallback block sizes come from the
    // piece's role, so a kit that is only half generated still assembles into
    // something with the right massing rather than a field of identical cubes.
    const kitById = Object.fromEntries((this.biome.kit || []).map(p => [p.id, p]));
    const roleOf = (id) => kitById[id]?.role
      ?? (this.biome.kit || []).find(p => (p.variants || []).includes(id))?.role;

    await Promise.all([...groups.entries()].map(([id, transforms]) => {
      const role = roleOf(id);
      const vertical = role === ROLES.WALL || role === ROLES.CORNER || role === ROLES.DOORWAY;
      const isPillar = role === ROLES.PILLAR;
      const size = vertical ? [c, this.wallH, c]
                 : isPillar ? [c * 0.45, this.wallH * 1.4, c * 0.45]
                 : [c, 0.25, c];
      // Placeholder albedo has to be light enough to show lighting. At
      // 0x2f2722 — RGB(47,39,34) — a fully lit surface still tops out around
      // 18% brightness, so the scene measured 98% near-black no matter how the
      // lights were tuned. Dark stone is the right *final* look, but only once
      // real materials exist; a blockout that cannot show its own lighting
      // cannot be judged.
      const color = vertical ? 0x8a7f72 : isPillar ? 0x9a8d7f : 0x6f665c;
      // Fallback boxes are origin-centred; lift so they rest on y=0.
      const lifted = transforms.map(t => ({ ...t, pos: t.pos.clone().setY(t.pos.y + size[1] / 2) }));
      return this._place(id, lifted, size, color);
    }));

    return groups.size;
  }
}
