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
    const nx = Math.max(1, Math.round((chamber.halfX * 2) / c));
    const nz = Math.max(1, Math.round((chamber.halfZ * 2) / c));
    const x0 = chamber.cx - (nx * c) / 2 + c / 2;
    const z0 = chamber.cz - (nz * c) / 2 + c / 2;

    const rules = this.biome.rules || {};
    const groups = new Map();   // pieceId -> transforms[]
    const add = (id, pos, rotY = 0, scale) => {
      if (!id) return;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      (groups.get(id) ?? groups.set(id, []).get(id)).push({ pos, quat: q, scale });
    };

    // Snap doorway points to perimeter cell indices so arches land in the wall.
    const doorCells = new Set();
    for (const d of doorways) {
      const ix = Math.round((d.x - x0) / c), iz = Math.round((d.z - z0) / c);
      doorCells.add(`${Math.max(0, Math.min(nx - 1, ix))},${Math.max(0, Math.min(nz - 1, iz))}`);
    }

    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const x = x0 + ix * c, z = z0 + iz * c;
        const edgeX = ix === 0 || ix === nx - 1;
        const edgeZ = iz === 0 || iz === nz - 1;

        if (edgeX && edgeZ) {
          // Corner: rotate so the two finished faces point into the room.
          const rot = (ix === 0 ? (iz === 0 ? 0 : Math.PI / 2) : (iz === 0 ? -Math.PI / 2 : Math.PI));
          add(this._pick(ROLES.CORNER, rng), new THREE.Vector3(x, 0, z), rot);
          continue;
        }
        if (edgeX || edgeZ) {
          const isDoor = doorCells.has(`${ix},${iz}`);
          // Wall faces inward: rotation depends on which edge it sits on.
          const rot = edgeZ ? (iz === 0 ? 0 : Math.PI) : (ix === 0 ? Math.PI / 2 : -Math.PI / 2);
          add(this._pick(isDoor ? ROLES.DOORWAY : ROLES.WALL, rng), new THREE.Vector3(x, 0, z), rot);
          if (rules.trim) add(this._pick(ROLES.TRIM, rng), new THREE.Vector3(x, 0, z), rot);
          continue;
        }

        // Interior floor, with occasional rubble and pillars for relief.
        const filler = rules.fillerRate && rng() < rules.fillerRate;
        const id = filler ? this._pick(ROLES.FILLER, rng) : this._pick(ROLES.FLOOR, rng);
        // Quarter-turn jitter hides the grid without needing more variants.
        const rot = rules.variantJitter ? Math.floor(rng() * 4) * (Math.PI / 2) : 0;
        add(id, new THREE.Vector3(x, 0, z), rot);

        if (rules.pillarRate && rng() < rules.pillarRate) {
          add(this._pick(ROLES.PILLAR, rng), new THREE.Vector3(x, 0, z), rng() * Math.PI * 2);
        }
      }
    }

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
      // Fallback boxes are centred on origin; lift them so they sit on y=0.
      const lifted = transforms.map(t => ({
        ...t, pos: t.pos.clone().setY(t.pos.y + size[1] / 2),
      }));
      return this._place(id, lifted, size, color);
    }));

    return groups.size;
  }
}
