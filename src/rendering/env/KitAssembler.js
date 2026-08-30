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
    result.forEach((m, i) => {
      const x = x0 + (i % nx) * c;
      const z = z0 + Math.floor(i / nx) * c;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -m.turns * Math.PI / 2);
      if (!groups.has(m.pieceId)) groups.set(m.pieceId, []);
      groups.get(m.pieceId).push({ pos: new THREE.Vector3(x, 0, z), quat: q });
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
      const color = vertical ? 0x3a2f28 : isPillar ? 0x4a3d33 : 0x2f2722;
      // Fallback boxes are origin-centred; lift so they rest on y=0.
      const lifted = transforms.map(t => ({ ...t, pos: t.pos.clone().setY(t.pos.y + size[1] / 2) }));
      return this._place(id, lifted, size, color);
    }));

    return groups.size;
  }
}
