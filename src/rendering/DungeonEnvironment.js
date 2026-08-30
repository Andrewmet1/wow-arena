// DungeonEnvironment — programmatic dungeon room geometry that replaces the
// open arena floor when in dungeon mode. Built from Three.js primitives +
// existing arena textures so we don't need new asset files for v1.
//
// Layout per room: a ~50x50 stone-floored chamber with closed walls on all
// four sides, low ceiling with cross-beams, columns at the corners, wall
// torches casting warm light, and an iron portcullis "doorway" at the
// player's spawn end. The arena's existing pillars (which the LOS engine
// uses) stay in place — they become broken columns inside the chamber.
//
// Per-room theming: combat / boss / treasure rooms swap accent colors and
// add room-type props (boss = throne, treasure = chest, shrine = altar).
//
// Usage:
//   const env = new DungeonEnvironment(scene);
//   env.build({ roomType: 'combat', theme: 'crucible_below' });
//   ...
//   env.dispose(); // when leaving dungeon

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { poolFor, DESTRUCTIBLE as MANIFEST_DESTRUCTIBLE, CLOTH as MANIFEST_CLOTH } from './DungeonManifest.js';

// Cache prop GLBs across rebuilds — load once, clone per room.
const _propLoader = new GLTFLoader();
const _propCache = new Map(); // id → THREE.Group (original, never modified)
const _propPromises = new Map(); // id → loading Promise

const PROP_IDS = [
  // Wave 1 — basic dungeon clutter
  'sarcophagus', 'brazier', 'bone_pile', 'iron_chains', 'fallen_banner', 'rune_pillar',
  // Wave 2 — souls-style environmental storytelling
  'broken_statue', 'hanging_cage', 'ritual_circle', 'burial_urn',
  'skull_idol', 'ash_pile', 'ember_pool', 'iron_brazier_tall',
];

function loadProp(id) {
  if (_propCache.has(id)) return Promise.resolve(_propCache.get(id));
  if (_propPromises.has(id)) return _propPromises.get(id);
  const p = new Promise((resolve) => {
    _propLoader.load(
      `/assets/models/props/${id}.glb`,
      (gltf) => {
        _propCache.set(id, gltf.scene);
        resolve(gltf.scene);
      },
      undefined,
      (err) => {
        console.warn(`[DungeonEnvironment] prop ${id} failed to load:`, err.message);
        resolve(null);
      }
    );
  });
  _propPromises.set(id, p);
  return p;
}

// Pre-warm prop cache on module load — non-blocking, returns instantly
PROP_IDS.forEach(id => loadProp(id));

// Sized to feel like a proper dungeon hall — large enough to hold combat for
// 4 mobs spread out, with room to dodge, kite, and use line-of-sight columns.
// Decorative columns (visual) are placed at the engine PILLAR_POSITIONS (±20, ±20)
// so the visible columns line up with the LOS-blocking pillars the engine uses.
const ROOM_HALF_X = 55;     // chamber half-width — 110 units across, dungeon-hall sized
const ROOM_HALF_Z = 38;     // chamber half-depth
// 6u walls — short enough that the overhead camera always sees the player
// even at spawn. Past the walls, the outer ground + props + fog haze
// provide a designed scene so there's no "void" reveal.
const WALL_HEIGHT = 6;
const CEILING_HEIGHT = 18;

// Stone material — dark, mossy, slightly metallic for damp dungeon look
const STONE_DARK = 0x2a221c;
const STONE_LIGHT = 0x4a3a30;
const MORTAR = 0x1a1410;

// DALL-E generated tileable textures — load once, share across rooms
const _texLoader = new THREE.TextureLoader();
const _textures = {};
function loadTex(name, repeatX = 1, repeatY = 1) {
  if (_textures[name]) return _textures[name];
  // Most textures live in /art/dungeon/. VFX-prefixed live in /art/vfx/ and
  // tex_-prefixed (procedural-cover material maps) live in /art/vfx/ too.
  const dir = (name.startsWith('vfx_') || name.startsWith('tex_'))
    ? 'vfx' : 'dungeon';
  const tex = _texLoader.load(`/assets/art/${dir}/${name}.png`);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  _textures[name] = tex;
  return tex;
}

/**
 * Companion normal map for a surface texture, or null.
 *
 * Every dungeon material was albedo-only and faked relief by assigning the
 * diffuse texture as a bumpMap. That derives height from brightness, so mortar
 * lines read as bumps and painted highlights read as ridges. The `_normal`
 * companions (scripts/generate-env-normals.mjs) encode gradient direction
 * instead, so light moving across a wall behaves plausibly.
 *
 * Only floor/wall/ceiling surfaces have them; anything else returns null and
 * keeps its previous look.
 */
const _normals = {};
function loadNormal(name, repeatX = 1, repeatY = 1) {
  if (!/^(floor|wall|ceiling)_/.test(name)) return null;
  const key = `${name}__n`;
  if (_normals[key]) return _normals[key];
  const tex = _texLoader.load(
    `/assets/art/dungeon/${name}_normal.png`,
    undefined, undefined,
    () => { _normals[key] = null; },   // missing companion is not an error
  );
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.NoColorSpace;  // normals are data, not colour
  _normals[key] = tex;
  return tex;
}

export class DungeonEnvironment {
  constructor(scene, renderer = null, camera = null) {
    this.scene = scene;
    // Optional renderer + camera — used to pre-compile chest/portal shaders
    // at wing build time so the first kill doesn't stall while WebGL compiles
    // an additive-blend material variant on the hot path.
    this.renderer = renderer;
    this.camera = camera;
    this.group = new THREE.Group();
    this.group.name = 'DungeonEnvironment';
    this.torches = [];
    this._currentRoomType = null;
  }

  /**
   * Build a multi-chamber WING from server-provided layout data. This is the
   * preferred build path — each "room" in a dungeon run is now a wing made of
   * 1-3 chambers connected by corridors, with optional treasure alcoves and
   * hidden reliquaries. Falls back to legacy single-room render if no wing
   * data is provided.
   */
  buildWing({ wing, roomType = 'combat', theme = null, roomIndex = 0 } = {}) {
    if (!wing) return this.build({ roomType, theme, roomIndex });
    this.dispose();
    this._currentRoomType = roomType;
    this._currentWing = wing;
    // Theme payload (sent by server) drives floor textures, walls, lighting,
    // weather, vegetation, light cones. Each dungeon overlays its own theme.
    this._theme = theme || {};
    const COMBAT_VARIANTS = ['mossy', 'bloodied', 'charred', 'cracked'];
    this._roomVariant = (roomType === 'combat')
      ? COMBAT_VARIANTS[roomIndex % COMBAT_VARIANTS.length]
      : null;

    // Castle dungeon chamber build:
    //   - Floor (DALL-E painted tile)
    //   - Walls (height 6, camera-visible)
    //   - Castle furniture: layered procedural placement using Meshy GLBs
    //     organized by category (wall / corner / center / scatter / hanging)
    for (const chamber of wing.chambers) {
      this._buildChamberFloor(chamber);
      this._buildChamberWalls(chamber, wing);
      this._buildChamberFurniture(chamber, wing);
    }
    for (const corridor of wing.corridors) {
      this._buildCorridorFloor(corridor);
      this._buildCorridorWalls(corridor, wing);
    }
    // Outer environment intentionally NOT built — the painted void_skybox.png
    // is set as scene.background by SceneManager.applyDungeonAtmosphere, and
    // that's the only thing the camera should see past the chamber walls.
    // No outer ground plane, no scatter, no dome, no fog ring.
    this._buildTorchesFromWing(wing);
    this._buildAmbientLighting(wing);
    // PERF: cover pieces skipped — they use Meshy GLB clones (pillar_intact,
    // rune_pillar, etc.) which are heavy. The interior obstacles + corner
    // pillars already provide tactical cover.
    this._buildFeatures(wing);

    this._buildEmbersForBounds(wing.bounds);
    this._buildDustMotesForBounds(wing.bounds);

    // Preload chest assets + the exit portal arch so neither pack-clear
    // chest spawn NOR the last-mob portal spawn hitches a frame.
    this._preloadChestAssets();
    this._preloadPortalArch();

    this.scene.add(this.group);
  }

  /** Background-load the exit portal archway GLB so the last-mob portal
   *  spawn doesn't pay the GLB-load cost on the kill frame. */
  async _preloadPortalArch() {
    if (!this._propLoader) {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      this._propLoader = new GLTFLoader();
    }
    if (!this._propCache) this._propCache = new Map();
    if (!this._portalSwirlTex) {
      const loader = new THREE.TextureLoader();
      this._portalSwirlTex = loader.load('/assets/art/vfx/vfx_portal_swirl.png');
      this._portalRunesTex = loader.load('/assets/art/vfx/vfx_portal_runes.png');
    }
    const archTag = 'doorway_archway_runic';
    if (this._propCache.get(archTag) === undefined) {
      this._propCache.set(archTag, null);
      try {
        const gltf = await new Promise((res, rej) =>
          this._propLoader.load(`/assets/models/props/${archTag}.glb`, res, undefined, rej));
        // Pre-configure materials once so every clone is cheap
        gltf.scene.traverse(c => {
          if (c.isMesh) {
            c.castShadow = false;
            c.receiveShadow = true;
            if (c.material?.map && !c.material.bumpMap) {
              c.material.bumpMap = c.material.map;
              c.material.bumpScale = 0.08;
              c.material.needsUpdate = true;
            }
          }
        });
        this._propCache.set(archTag, gltf.scene);
      } catch {
        this._propCache.set(archTag, null);
      }
    }
  }

  /** Build chest templates SYNCHRONOUSLY using only procedural geometry +
   *  shared materials. No GLB load = no async wait = no lag spike on
   *  pack-clear kills. The chest is a chunky Diablo-style stone+gold box
   *  with an emissive amber rim, a lock plate, a beam column, and a floor
   *  glow ring. Two variants (common amber / rare orange). Called from
   *  buildWing as plain synchronous code — runs once per session. */
  _preloadChestAssets() {
    if (this._chestTemplate) return;
    if (!this._pickupBeamTex) {
      this._pickupBeamTex = new THREE.TextureLoader().load(
        '/assets/art/vfx/vfx_pickup_beam.png',
        (tex) => { tex.colorSpace = THREE.SRGBColorSpace; },
      );
    }
    if (!this._interactGlowTex) {
      this._interactGlowTex = new THREE.TextureLoader().load(
        '/assets/art/vfx/vfx_interact_glow.png',
        (tex) => { tex.colorSpace = THREE.SRGBColorSpace; },
      );
    }
    // Shared geometry (one allocation, all chests reuse)
    const chestBaseGeo = new THREE.BoxGeometry(1.6, 0.7, 1.1);
    const chestLidGeo = new THREE.BoxGeometry(1.6, 0.4, 1.1);
    const lockGeo = new THREE.BoxGeometry(0.4, 0.4, 0.15);
    const bandGeo = new THREE.BoxGeometry(1.65, 0.12, 1.15);
    const cornerGeo = new THREE.BoxGeometry(0.18, 0.8, 0.18);

    const buildTemplate = (rare) => {
      const wood = new THREE.MeshStandardMaterial({
        color: rare ? 0x3a1810 : 0x2a1a0e,
        roughness: 0.85, metalness: 0.1,
      });
      const gold = new THREE.MeshStandardMaterial({
        color: rare ? 0xffd060 : 0xc89030,
        roughness: 0.25, metalness: 0.92,
        emissive: rare ? 0xff8810 : 0x885022,
        emissiveIntensity: rare ? 0.9 : 0.55,
      });
      const grp = new THREE.Group();
      // Body
      const base = new THREE.Mesh(chestBaseGeo, wood);
      base.position.y = 0.35;
      grp.add(base);
      // Lid
      const lid = new THREE.Mesh(chestLidGeo, wood);
      lid.position.y = 0.7 + 0.2 + 0.02;
      lid.rotation.x = -0.15;
      grp.add(lid);
      // Iron bands (two, around the body horizontally)
      for (const y of [0.2, 0.5]) {
        const band = new THREE.Mesh(bandGeo, gold);
        band.position.y = y;
        grp.add(band);
      }
      // Lock plate
      const lock = new THREE.Mesh(lockGeo, gold);
      lock.position.set(0, 0.6, 0.58);
      grp.add(lock);
      // 4 corner posts
      for (const [dx, dz] of [[-0.79, -0.51], [0.79, -0.51], [-0.79, 0.51], [0.79, 0.51]]) {
        const c = new THREE.Mesh(cornerGeo, gold);
        c.position.set(dx, 0.4, dz);
        grp.add(c);
      }
      // Scale up for rare
      grp.scale.setScalar(rare ? 1.25 : 1.05);
      // PointLight removed — every chest clone created a new dynamic light
      // and WebGL forward rendering cost scales linearly with light count.
      // With 5+ chests on screen FPS tanked. The additive beam + glow ring
      // below already give it punch.
      // Pickup beam
      const beamMat = new THREE.MeshBasicMaterial({
        map: this._pickupBeamTex, transparent: true, depthWrite: false,
        opacity: 0.85, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const beam = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 7), beamMat);
      beam.position.y = 3.5;
      beam.userData.isPickupBeam = true;
      grp.add(beam);
      // Floor glow ring
      const glowMat = new THREE.MeshBasicMaterial({
        map: this._interactGlowTex, transparent: true, depthWrite: false,
        opacity: 0.85, blending: THREE.AdditiveBlending,
      });
      const gMesh = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), glowMat);
      gMesh.rotation.x = -Math.PI / 2;
      gMesh.position.y = 0.02;
      gMesh.userData.isInteractGlow = true;
      grp.add(gMesh);
      return grp;
    };
    this._chestTemplate = {
      common: buildTemplate(false),
      rare: buildTemplate(true),
    };
    // Force shader + texture upload to GPU NOW so the first chest spawn
    // doesn't pay the compile/upload cost on the kill frame. Without this,
    // the first chest after a kill stalled ~2s while the additive-blended
    // MeshBasicMaterial shader compiled and the textures uploaded.
    if (this.renderer && this.camera) {
      const warm = new THREE.Group();
      warm.add(this._chestTemplate.common.clone());
      warm.add(this._chestTemplate.rare.clone());
      warm.position.set(99999, -9999, 99999); // off-screen
      this.scene.add(warm);
      try {
        this.renderer.compile(this.scene, this.camera);
      } catch (err) {
        console.warn('[Dungeon] chest pre-compile failed:', err.message);
      }
      this.scene.remove(warm);
    }
  }

  /**
   * Legacy single-room build path. Kept for fallback during transition.
   * Idempotent — calling again rebuilds with the new roomType.
   */
  build({ roomType = 'combat', theme = null, roomIndex = 0 } = {}) {
    this.dispose();
    this._currentRoomType = roomType;
    // Combat rooms cycle through visual variants so each one feels distinct
    // — moss-overgrown, blood-soaked, charred, cracked. Boss/treasure/shrine/
    // hidden override with their own dedicated look. Use the room index to
    // make the variant deterministic per run (so reloads don't reshuffle).
    const COMBAT_VARIANTS = ['mossy', 'bloodied', 'charred', 'cracked'];
    this._roomVariant = (roomType === 'combat')
      ? COMBAT_VARIANTS[roomIndex % COMBAT_VARIANTS.length]
      : null;

    this._buildFloor();
    this._buildWalls();
    this._buildCeiling();
    this._buildColumns();
    this._buildTorches();
    this._buildDoorway();

    // Room-type centerpiece props
    if (roomType === 'boss')      this._buildThrone();
    else if (roomType === 'treasure') this._buildTreasureChest();
    else if (roomType === 'shrine')   this._buildShrine();
    else if (roomType === 'hidden')   this._buildHiddenAltar();

    // Scatter Meshy-generated props around the chamber for visual richness.
    // Same prop pool every room but randomized placement so each room reads
    // distinctly. Async — props pop in over the next ~100ms as GLBs load.
    this._scatterProps(roomType);

    // Ambient particle systems — drifting ember motes + dust haze. Sells the
    // "old crypt with warm fires" feel without requiring more 3D assets.
    this._buildEmbers();
    this._buildDustMotes();

    this.scene.add(this.group);
  }

  _buildEmbers() {
    // PERF: count cut 32 → 16. The per-frame BufferAttribute update was
    // adding measurable CPU cost on low-end GPUs.
    const count = 16;
    const positions = new Float32Array(count * 3);
    const lifetimes = new Float32Array(count);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * ROOM_HALF_X * 1.8;
      positions[i * 3 + 1] = Math.random() * 6;
      positions[i * 3 + 2] = (Math.random() - 0.5) * ROOM_HALF_Z * 1.8;
      lifetimes[i] = Math.random();
      speeds[i] = 0.3 + Math.random() * 0.4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xff7733,
      size: 0.18,
      transparent: true,
      opacity: 0.85,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.userData.isEmbers = true;
    points.userData.lifetimes = lifetimes;
    points.userData.speeds = speeds;
    this.group.add(points);
    this._embers = points;
  }

  _buildDustMotes() {
    // PERF: count cut 20 → 10.
    const count = 10;
    const positions = new Float32Array(count * 3);
    const offsets = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * ROOM_HALF_X * 1.9;
      positions[i * 3 + 1] = 1 + Math.random() * 12;
      positions[i * 3 + 2] = (Math.random() - 0.5) * ROOM_HALF_Z * 1.9;
      offsets[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xc8b890,
      size: 0.08,
      transparent: true,
      opacity: 0.35,
      sizeAttenuation: true,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.userData.isDust = true;
    points.userData.offsets = offsets;
    this.group.add(points);
    this._dust = points;
  }

  async _scatterProps(roomType) {
    // Different prop weights per room type — boss room has more threatening
    // props, treasure has fewer combat-y items, etc.
    // Souls-style room composition. Each room type gets a different "story":
    //   combat — abandoned hall, scattered urns/bones, occasional cage hung
    //   elite  — failed challenger's last stand: broken statues, ash piles, more chains
    //   boss   — throne approach: ritual circles, ember pools, all the imposing props
    //   treasure — quiet storage: urns, idol, low torch
    //   shrine — devotional space: idols, ritual circle, quiet
    //   hidden — sanctum: burial urns, skull idols, single ember pool
    const counts = {
      combat:   { sarcophagus: 1, brazier: 1, bone_pile: 2, iron_chains: 1, fallen_banner: 1, rune_pillar: 0,
                  broken_statue: 1, hanging_cage: 1, ritual_circle: 0, burial_urn: 2, skull_idol: 0, ash_pile: 1, ember_pool: 0, iron_brazier_tall: 0 },
      elite:    { sarcophagus: 2, brazier: 1, bone_pile: 1, iron_chains: 2, fallen_banner: 1, rune_pillar: 1,
                  broken_statue: 2, hanging_cage: 2, ritual_circle: 0, burial_urn: 2, skull_idol: 1, ash_pile: 2, ember_pool: 0, iron_brazier_tall: 1 },
      boss:     { sarcophagus: 3, brazier: 2, bone_pile: 2, iron_chains: 2, fallen_banner: 2, rune_pillar: 2,
                  broken_statue: 3, hanging_cage: 2, ritual_circle: 1, burial_urn: 2, skull_idol: 2, ash_pile: 3, ember_pool: 2, iron_brazier_tall: 2 },
      treasure: { sarcophagus: 0, brazier: 1, bone_pile: 0, iron_chains: 0, fallen_banner: 0, rune_pillar: 1,
                  broken_statue: 0, hanging_cage: 0, ritual_circle: 0, burial_urn: 3, skull_idol: 1, ash_pile: 0, ember_pool: 0, iron_brazier_tall: 1 },
      shrine:   { sarcophagus: 1, brazier: 1, bone_pile: 0, iron_chains: 0, fallen_banner: 0, rune_pillar: 2,
                  broken_statue: 1, hanging_cage: 0, ritual_circle: 1, burial_urn: 1, skull_idol: 2, ash_pile: 0, ember_pool: 0, iron_brazier_tall: 1 },
      hidden:   { sarcophagus: 1, brazier: 0, bone_pile: 0, iron_chains: 0, fallen_banner: 0, rune_pillar: 2,
                  broken_statue: 1, hanging_cage: 1, ritual_circle: 1, burial_urn: 2, skull_idol: 2, ash_pile: 1, ember_pool: 1, iron_brazier_tall: 0 },
    };
    const planned = counts[roomType] || counts.combat;

    // Reserve "dead zones" so props don't block the player spawn or center
    // combat space. Props scatter in three rings: along walls, near columns,
    // and corners.
    const reserved = [
      { x: -40, z: 0, r: 8 },   // player spawn
      { x: 0, z: 0, r: 14 },    // center fight space
    ];
    const tooCloseToReserved = (x, z) => reserved.some(r => {
      const dx = x - r.x, dz = z - r.z;
      return dx * dx + dz * dz < r.r * r.r;
    });

    const placements = [];
    const generateSpot = () => {
      for (let attempt = 0; attempt < 10; attempt++) {
        // Bias toward walls — pick a "ring" location
        const ring = Math.random();
        let x, z;
        if (ring < 0.6) {
          // Along long walls (east/west)
          const side = Math.random() < 0.5 ? -1 : 1;
          x = side * (ROOM_HALF_X - 4 - Math.random() * 4);
          z = (Math.random() - 0.5) * (ROOM_HALF_Z * 2 - 8);
        } else if (ring < 0.85) {
          // Along short walls (north/south)
          const side = Math.random() < 0.5 ? -1 : 1;
          x = (Math.random() - 0.5) * (ROOM_HALF_X * 2 - 8);
          z = side * (ROOM_HALF_Z - 4 - Math.random() * 4);
        } else {
          // Mid-room scatter
          x = (Math.random() - 0.5) * (ROOM_HALF_X * 2 - 12);
          z = (Math.random() - 0.5) * (ROOM_HALF_Z * 2 - 12);
        }
        if (!tooCloseToReserved(x, z)
            && !placements.some(p => (p.x - x) ** 2 + (p.z - z) ** 2 < 25)) {
          placements.push({ x, z });
          return { x, z };
        }
      }
      return null;
    };

    for (const [propId, count] of Object.entries(planned)) {
      for (let i = 0; i < count; i++) {
        const spot = generateSpot();
        if (!spot) break;
        const propGroup = await loadProp(propId);
        if (!propGroup) continue;
        // Important: the build() may have been called again (room transition)
        // before this prop finished loading. Skip stale placements.
        if (this._currentRoomType !== roomType) return;
        const clone = propGroup.clone(true);
        clone.position.set(spot.x, 0, spot.z);
        clone.rotation.y = Math.random() * Math.PI * 2;
        // Auto-scale: many Meshy GLBs come in at ~1m, but some are tiny.
        // Heuristic: target a height of ~2 units (matches dungeon scale).
        const bbox = new THREE.Box3().setFromObject(clone);
        const height = bbox.max.y - bbox.min.y;
        if (height > 0) {
          const scaleFactor = (1.5 + Math.random() * 1.5) / height;
          clone.scale.setScalar(scaleFactor);
        }
        clone.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
        this.group.add(clone);
      }
    }
  }

  /** Tear down all geometry. Called when leaving dungeon mode. */
  dispose() {
    // Hazard nodes are keyed by server feature id; stale entries from the
    // previous wing would otherwise match new ids and drive the wrong ring.
    this._hazardNodes?.clear();
    if (!this.group) return;
    this.group.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) m?.dispose?.();
      }
    });
    this.scene.remove(this.group);
    this.group = new THREE.Group();
    this.group.name = 'DungeonEnvironment';
    this.torches = [];
    this._animCache = null;
    this._transientFX = null;
    this._authoredChambers = null;
    this._accentLightCount = 0;
  }

  /** Build a cached map of animated nodes by tag. Avoids traversing the
   *  entire scene graph (~1500 nodes) every frame in tick() — instead we
   *  walk once after build() / buildWing() and iterate short arrays. */
  _rebuildAnimCache() {
    const cache = {
      vendorSigil: [], exitVortex: [], exitRing: [], exitLight: [],
      portalRunes: [], leverBeacon: [], brazierFlame: [], bellMesh: [],
      idolRune: [], interactGlow: [], pickupBeam: [], ritualCircle: [],
      fog: [], godRay: [], atmosphereParticle: [], chamberFill: [],
      weather: [], lightCone: [], lightning: [], cloth: [],
      debris: [], stepDust: [], bossSigil: [], bossFlame: [], bloodWell: [],
    };
    if (!this.group) { this._animCache = cache; return; }
    this.group.traverse((node) => {
      const ud = node.userData;
      if (!ud) return;
      if (ud.isVendorSigil) cache.vendorSigil.push(node);
      if (ud.isExitVortex) cache.exitVortex.push(node);
      if (ud.isExitRing) cache.exitRing.push(node);
      if (ud.isExitLight) cache.exitLight.push(node);
      if (ud.isPortalRunes) cache.portalRunes.push(node);
      if (ud.isLeverBeacon) cache.leverBeacon.push(node);
      if (ud.isBrazierFlame) cache.brazierFlame.push(node);
      if (ud.isBellMesh) cache.bellMesh.push(node);
      if (ud.isIdolRune) cache.idolRune.push(node);
      if (ud.isInteractGlow) cache.interactGlow.push(node);
      if (ud.isPickupBeam) cache.pickupBeam.push(node);
      if (ud.isRitualCircle) cache.ritualCircle.push(node);
      if (ud.isFog) cache.fog.push(node);
      if (ud.isGodRay) cache.godRay.push(node);
      if (ud.isAtmosphereParticle) cache.atmosphereParticle.push(node);
      if (ud.isChamberFill) cache.chamberFill.push(node);
      if (ud.isWeather) cache.weather.push(node);
      if (ud.isLightCone) cache.lightCone.push(node);
      if (ud.isLightning) cache.lightning.push(node);
      if (ud.isCloth) cache.cloth.push(node);
      if (ud.isBossSigil) cache.bossSigil.push(node);
      if (ud.isBossFlame) cache.bossFlame.push(node);
      if (ud.isBloodWell) cache.bloodWell.push(node);
    });
    this._animCache = cache;
  }

  /** Per-frame torch flicker + particle drift. Called from main render loop. */
  tick(time) {
    // Throttle counter — used to skip expensive per-frame work like the
    // ember CPU updates + fog/atmosphere position writes. ~30 Hz feels
    // identical to 60 Hz visually for drifting particles.
    this._tickCounter = (this._tickCounter || 0) + 1;
    const halfRateFrame = (this._tickCounter & 1) === 0;

    for (const t of this.torches) {
      const f = 0.85 + Math.sin(time * 6 + t.userData.flickerOffset) * 0.08
                     + Math.sin(time * 17 + t.userData.flickerOffset) * 0.05;
      t.intensity = t.userData.baseIntensity * f;
    }

    // Embers drift upward and recycle from the floor when they hit the ceiling.
    // Updates run at half frame rate — visually indistinguishable, halves the
    // GPU position-buffer sync that was a measurable cost in low-FPS rooms.
    if (this._embers && halfRateFrame) {
      const positions = this._embers.geometry.attributes.position.array;
      const speeds = this._embers.userData.speeds;
      const count = speeds.length;
      for (let i = 0; i < count; i++) {
        positions[i * 3 + 1] += speeds[i] * 0.1; // double step to compensate
        positions[i * 3] += Math.sin(time * 0.5 + i) * 0.02;
        if (positions[i * 3 + 1] > 16) {
          positions[i * 3]     = (Math.random() - 0.5) * ROOM_HALF_X * 1.8;
          positions[i * 3 + 1] = 0.5;
          positions[i * 3 + 2] = (Math.random() - 0.5) * ROOM_HALF_Z * 1.8;
        }
      }
      this._embers.geometry.attributes.position.needsUpdate = true;
    }

    // PERF: cached arrays of animated nodes built once on dungeon build,
    // not every frame. Each `traverse()` was O(N=~1500) over the whole
    // scene graph — replaced with direct iteration over short arrays.
    if (!this._animCache) this._rebuildAnimCache();
    const ac = this._animCache;

    for (const node of ac.vendorSigil) {
      if (!node.material) continue;
      node.rotation.z += 0.015;
      node.position.y = 4.5 + Math.sin(time * 1.8) * 0.18;
      node.material.opacity = 0.7 + Math.sin(time * 2.2) * 0.2;
    }
    for (const node of ac.exitVortex) {
      if (!node.material) continue;
      node.rotation.z += 0.012;
      node.material.opacity = 0.75 + Math.sin(time * 2.5) * 0.20;
    }
    for (const node of ac.exitRing) {
      node.rotation.z = time * 1.5;
      if (node.material) node.material.opacity = 0.55 + Math.sin(time * 2.0) * 0.25;
    }
    for (const node of ac.exitLight) {
      node.intensity = (node.userData.basePulse || 4) + Math.sin(time * 4.5) * 1.5;
    }
    for (const node of ac.portalRunes) {
      if (!node.material) continue;
      node.rotation.z -= 0.018;
      node.material.opacity = 0.55 + Math.sin(time * 1.8 + 1) * 0.18;
    }

    for (const node of ac.leverBeacon) {
      if (node.material) node.material.opacity = 0.25 + Math.sin(time * 3.5) * 0.18;
    }
    for (const node of ac.brazierFlame) {
      const s = 0.85 + Math.sin(time * 7) * 0.15;
      node.scale.set(s, 1 + Math.sin(time * 11) * 0.08, s);
    }
    for (const node of ac.bellMesh) {
      if (!node.userData.consumedDone) node.rotation.z = Math.sin(time * 2) * 0.08;
    }
    for (const node of ac.idolRune) {
      if (node.material) node.material.opacity = 0.6 + Math.sin(time * 2.5) * 0.3;
    }
    for (const node of ac.interactGlow) {
      if (!node.material) continue;
      const phase = node.userData.basePhase || 0;
      node.material.opacity = 0.55 + Math.sin(time * 2 + phase) * 0.3;
      node.rotation.z = (time * 0.4 + phase) % (Math.PI * 2);
    }
    for (const node of ac.pickupBeam) {
      if (!node.material) continue;
      node.material.opacity = 0.7 + Math.sin(time * 3) * 0.18;
      node.scale.y = 1 + Math.sin(time * 2.5) * 0.06;
    }
    for (const node of ac.ritualCircle) {
      if (node.material) node.material.opacity = 0.35 + Math.sin(time * 1.4) * 0.18;
    }
    // Atmospheric drift — fog sprites, god rays, ambient particles. These
    // are slow-moving cosmetic loops; updating every other frame is
    // visually identical to every frame but halves the JS+sync cost.
    if (halfRateFrame) {
      for (const node of ac.fog) {
        if (!node.material) continue;
        const ud = node.userData;
        const phase = ud.driftPhase || 0;
        const speed = ud.driftSpeed || 0.3;
        const driftX = ud.driftDirX || 0;
        const driftZ = ud.driftDirZ || 0;
        const baseX = ud.baseX ?? node.position.x;
        const baseZ = ud.baseZ ?? node.position.z;
        const baseY = ud.baseY || 2;
        const t = time * speed + phase;
        const driftR = (ud.boundR || 18) * 0.6;
        node.position.x = baseX + Math.sin(t * 0.3) * driftR * driftX;
        node.position.z = baseZ + Math.cos(t * 0.27) * driftR * driftZ;
        node.position.y = baseY + Math.sin(t * 0.5) * 0.6;
        node.material.opacity = 0.10 + Math.sin(t * 0.8) * 0.08;
        node.rotation.z += (ud.spinSpeed || 0.0008) * 2;
      }
      for (const node of ac.godRay) {
        if (!node.material) continue;
        const phase = node.userData.basePhase || 0;
        node.material.opacity = 0.22 + Math.sin(time * 0.7 + phase) * 0.10;
        node.rotation.y += (node.userData.spinSpeed || 0.0005) * 2;
      }
      for (const node of ac.atmosphereParticle) {
        const ud = node.userData;
        const speed = ud.driftSpeed || 0.5;
        const side = ud.sideDrift || 0;
        node.position.y += speed * 0.08;
        node.position.x = ud.baseX + Math.sin(time * 0.6 + ud.phase) * side * 6;
        if (ud.isEmber && node.position.y > ud.maxY) node.position.y = 0;
        else if (!ud.isEmber && node.position.y < 0) node.position.y = ud.maxY;
      }
    }
    for (const node of ac.chamberFill) {
      const phase = node.userData.flickerPhase || 0;
      const base = node.userData.basePulse || 1.5;
      node.intensity = base + Math.sin(time * 4 + phase) * 0.25 + (Math.random() - 0.5) * 0.05;
    }
    for (const node of ac.weather) {
      const ud = node.userData;
      const speed = ud.fallSpeed || 5;
      node.position.y -= speed * 0.02;
      if (ud.swirlMag) {
        const phase = ud.driftPhase || 0;
        node.position.x = ud.baseX + Math.sin(time * 0.8 + phase) * ud.swirlMag * 3;
        node.position.z = ud.baseZ + Math.cos(time * 0.6 + phase) * ud.swirlMag * 3;
      }
      if (node.position.y < -2) node.position.y = ud.maxY;
    }
    for (const node of ac.lightCone) {
      if (!node.material) continue;
      const phase = node.userData.basePhase || 0;
      node.material.opacity = 0.15 + Math.sin(time * 1.2 + phase) * 0.10;
    }
    for (const node of ac.lightning) {
      if (!node.material) continue;
      const ud = node.userData;
      ud.nextFlashTime -= 0.016;
      if (ud.nextFlashTime <= 0) {
        ud._flashProgress = 1.0;
        ud.nextFlashTime = 8 + Math.random() * 12;
      }
      if (ud._flashProgress > 0) {
        node.material.opacity = ud._flashProgress * 0.75;
        ud._flashProgress -= 0.08;
      } else node.material.opacity = 0;
    }
    for (const node of ac.cloth) {
      const phase = node.userData.clothPhase || 0;
      node.rotation.z = Math.sin(time * 0.8 + phase) * 0.05;
      node.rotation.x = Math.sin(time * 0.6 + phase) * 0.03;
    }
    // Step dust + debris are transient — iterate the current set and prune
    // expired ones in-place. They're never added to the cache (created at
    // runtime), so we keep these on small short-lived lists separately.
    if (this._transientFX) {
      const next = [];
      for (const node of this._transientFX) {
        const ud = node.userData;
        if (ud?.isStepDust) {
          const t = (performance.now() - ud.startTime) / 600;
          if (t >= 1) {
            this.group.remove(node);
            if (node.isMesh) node.geometry?.dispose?.();
            continue;
          }
          if (node.material) {
            node.material.opacity = 0.35 * (1 - t);
            const scale = 1 + t * 0.5;
            node.scale.set(scale, scale, scale);
          }
        } else if (ud?.isDebris) {
          const t = (performance.now() - ud.startTime) / 1000;
          if (t > 1.2) {
            this.group.remove(node);
            if (node.isMesh) node.geometry?.dispose?.();
            continue;
          }
          const v = ud.velocity;
          v.y -= 9.0 * 0.016;
          node.position.x += v.x * 0.016;
          node.position.y += v.y * 0.016;
          node.position.z += v.z * 0.016;
          if (node.position.y < 0.05 && !ud._bounced) {
            node.position.y = 0.05;
            v.y = -v.y * 0.4; v.x *= 0.6; v.z *= 0.6;
            ud._bounced = true;
          }
          const av = ud.angVel;
          node.rotation.x += av.x * 0.016;
          node.rotation.y += av.y * 0.016;
          node.rotation.z += av.z * 0.016;
          if (t > 0.8 && node.material) {
            if (!node.material.transparent) { node.material.transparent = true; node.material.needsUpdate = true; }
            node.material.opacity = 1 - (t - 0.8) / 0.4;
          }
        }
        next.push(node);
      }
      this._transientFX = next;
    }

    // Blood well pulse — scale + glow track fill level. Once the well is
    // ready (fill >= 1) it pulses brighter to signal "drink me".
    const wing = this._currentWing;
    if (wing?.features && ac.bloodWell.length) {
      for (const node of ac.bloodWell) {
        const f = wing.features.find(x => x.id === node.userData.featureId);
        if (!f) continue;
        node.userData.fill = f.fill || 0;
        node.userData.consumed = !!f.consumed;
        const ready = f.fill >= 1 && !f.consumed;
        for (const c of node.children) {
          if (c.userData?.isWellBlood && c.material) {
            const fillScale = f.consumed ? 0.05 : Math.max(0.15, f.fill);
            c.scale.set(fillScale, 1, fillScale);
            c.material.opacity = f.consumed ? 0.3 : (0.6 + Math.min(0.4, f.fill * 0.4));
            if (ready) {
              const pulse = 0.85 + Math.sin(time * 5) * 0.15;
              c.material.opacity = pulse;
            }
          }
          if (c.userData?.isWellGlow) {
            c.intensity = f.consumed ? 0 : (0.5 + f.fill * 2.5 + (ready ? Math.sin(time * 5) * 0.5 : 0));
          }
        }
      }
    }

    // Boss sigil + flame pulse — gives the throne a heartbeat
    if (this._currentRoomType === 'boss' && (ac.bossSigil.length || ac.bossFlame.length)) {
      const pulse = 0.7 + Math.sin(time * 1.6) * 0.3;
      for (const node of ac.bossSigil) {
        if (node.material) node.material.opacity = 0.4 + pulse * 0.4;
      }
      for (const node of ac.bossFlame) {
        const s = 0.85 + Math.sin(time * 9 + node.position.x) * 0.18;
        node.scale.set(s, 1.0 + Math.sin(time * 11) * 0.1, s);
      }
    }

    // Dust motes drift in slow circular currents
    if (this._dust) {
      const positions = this._dust.geometry.attributes.position.array;
      const offsets = this._dust.userData.offsets;
      const count = offsets.length;
      for (let i = 0; i < count; i++) {
        positions[i * 3]     += Math.sin(time * 0.2 + offsets[i]) * 0.008;
        positions[i * 3 + 1] += Math.sin(time * 0.3 + offsets[i] * 1.3) * 0.004;
        positions[i * 3 + 2] += Math.cos(time * 0.18 + offsets[i] * 0.7) * 0.008;
      }
      this._dust.geometry.attributes.position.needsUpdate = true;
    }
  }

  // ── Geometry builders ──────────────────────────────────────────────

  _buildFloor() {
    // Per-room floor texture + tint. Boss/hidden glow with runic sigils.
    // Elite is bloodstained. Regular combat rooms cycle variants so the
    // sequence feels like progression rather than a treadmill of the same
    // hall over and over.
    let floorAsset = 'floor_stone';
    let tint = 0xb8a896;
    if (this._currentRoomType === 'boss' || this._currentRoomType === 'hidden') {
      floorAsset = 'floor_runic';
      tint = 0xa07060;
    } else if (this._currentRoomType === 'elite') {
      floorAsset = 'floor_blood';
      tint = 0x9a6868;
    } else if (this._currentRoomType === 'combat') {
      // Variant cycle: each combat room a different floor + tint
      switch (this._roomVariant) {
        case 'mossy':    floorAsset = 'floor_cracked'; tint = 0x8aa078; break;
        case 'bloodied': floorAsset = 'floor_blood';   tint = 0xa07878; break;
        case 'charred':  floorAsset = 'floor_ashen';   tint = 0x988880; break;
        case 'cracked':  floorAsset = 'floor_cracked'; tint = 0xa89888; break;
      }
    }
    const floorTex = loadTex(floorAsset, ROOM_HALF_X * 2 / 8, ROOM_HALF_Z * 2 / 8);
    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTex,
      color: tint,
      roughness: 0.92,
      metalness: 0.05,
    });
    const floorGeo = new THREE.PlaneGeometry(ROOM_HALF_X * 2, ROOM_HALF_Z * 2);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    this.group.add(floor);

    // Tile grout pattern — thin dark lines every 4 units forming a grid
    const groutMat = new THREE.LineBasicMaterial({ color: MORTAR, transparent: true, opacity: 0.7 });
    const points = [];
    for (let x = -ROOM_HALF_X; x <= ROOM_HALF_X; x += 4) {
      points.push(new THREE.Vector3(x, 0.02, -ROOM_HALF_Z), new THREE.Vector3(x, 0.02, ROOM_HALF_Z));
    }
    for (let z = -ROOM_HALF_Z; z <= ROOM_HALF_Z; z += 4) {
      points.push(new THREE.Vector3(-ROOM_HALF_X, 0.02, z), new THREE.Vector3(ROOM_HALF_X, 0.02, z));
    }
    const groutGeo = new THREE.BufferGeometry().setFromPoints(points);
    this.group.add(new THREE.LineSegments(groutGeo, groutMat));

    // Centerpiece — runic circle pulsing under boss room only
    if (this._currentRoomType === 'boss') {
      const ringGeo = new THREE.RingGeometry(8, 9.5, 48);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xa04040, transparent: true, opacity: 0.4, side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.04;
      this.group.add(ring);
    }
  }

  _buildWalls() {
    // Per-room wall texture + tint matching floor variant.
    let wallAsset = 'wall_stone';
    let tint = 0xa89888;
    if (this._currentRoomType === 'boss') {
      wallAsset = 'wall_runic'; tint = 0xa87060;
    } else if (this._currentRoomType === 'shrine') {
      wallAsset = 'wall_carved'; tint = 0xa89888;
    } else if (this._currentRoomType === 'hidden') {
      wallAsset = 'wall_runic'; tint = 0x807088;
    } else if (this._currentRoomType === 'elite') {
      wallAsset = 'wall_cracked'; tint = 0x988078;
    } else if (this._currentRoomType === 'treasure') {
      wallAsset = 'wall_carved'; tint = 0xb8a070;
    } else if (this._currentRoomType === 'combat') {
      switch (this._roomVariant) {
        case 'mossy':    wallAsset = 'wall_mossy';    tint = 0x88a078; break;
        case 'bloodied': wallAsset = 'wall_bloodied'; tint = 0xa07878; break;
        case 'charred':  wallAsset = 'wall_charred';  tint = 0x806870; break;
        case 'cracked':  wallAsset = 'wall_cracked';  tint = 0xa89888; break;
      }
    }
    const wallTex = loadTex(wallAsset, 4, 1.5);
    const wallMat = new THREE.MeshStandardMaterial({
      map: wallTex,
      color: tint,
      roughness: 0.95,
      metalness: 0.08,
    });
    const wallThickness = 1.5;

    // North wall (positive Z)
    const northWall = new THREE.Mesh(
      new THREE.BoxGeometry(ROOM_HALF_X * 2 + wallThickness * 2, WALL_HEIGHT, wallThickness),
      wallMat
    );
    northWall.position.set(0, WALL_HEIGHT / 2, ROOM_HALF_Z + wallThickness / 2);
    northWall.castShadow = true;
    northWall.receiveShadow = true;
    this.group.add(northWall);

    // South wall (negative Z) — has the doorway, so build as 2 segments
    const doorwayHalfWidth = 4;
    const segLen = ROOM_HALF_X - doorwayHalfWidth;
    const southWest = new THREE.Mesh(
      new THREE.BoxGeometry(segLen, WALL_HEIGHT, wallThickness), wallMat
    );
    southWest.position.set(-(segLen / 2 + doorwayHalfWidth), WALL_HEIGHT / 2, -ROOM_HALF_Z - wallThickness / 2);
    southWest.castShadow = true; southWest.receiveShadow = true;
    this.group.add(southWest);

    const southEast = new THREE.Mesh(
      new THREE.BoxGeometry(segLen, WALL_HEIGHT, wallThickness), wallMat
    );
    southEast.position.set(segLen / 2 + doorwayHalfWidth, WALL_HEIGHT / 2, -ROOM_HALF_Z - wallThickness / 2);
    southEast.castShadow = true; southEast.receiveShadow = true;
    this.group.add(southEast);

    // Lintel above the doorway
    const lintelHeight = 3;
    const lintel = new THREE.Mesh(
      new THREE.BoxGeometry(doorwayHalfWidth * 2, lintelHeight, wallThickness * 1.4),
      wallMat
    );
    lintel.position.set(0, WALL_HEIGHT - lintelHeight / 2, -ROOM_HALF_Z - wallThickness / 2);
    lintel.castShadow = true; lintel.receiveShadow = true;
    this.group.add(lintel);

    // East wall (positive X)
    const eastWall = new THREE.Mesh(
      new THREE.BoxGeometry(wallThickness, WALL_HEIGHT, ROOM_HALF_Z * 2),
      wallMat
    );
    eastWall.position.set(ROOM_HALF_X + wallThickness / 2, WALL_HEIGHT / 2, 0);
    eastWall.castShadow = true; eastWall.receiveShadow = true;
    this.group.add(eastWall);

    // West wall (negative X)
    const westWall = new THREE.Mesh(
      new THREE.BoxGeometry(wallThickness, WALL_HEIGHT, ROOM_HALF_Z * 2),
      wallMat
    );
    westWall.position.set(-ROOM_HALF_X - wallThickness / 2, WALL_HEIGHT / 2, 0);
    westWall.castShadow = true; westWall.receiveShadow = true;
    this.group.add(westWall);
  }

  _buildCeiling() {
    const ceilTex = loadTex('ceiling_beams', ROOM_HALF_X * 2 / 12, ROOM_HALF_Z * 2 / 12);
    const ceilMat = new THREE.MeshStandardMaterial({
      map: ceilTex,
      color: 0x4a3a2a,
      roughness: 0.95, metalness: 0.05,
    });
    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM_HALF_X * 2, ROOM_HALF_Z * 2),
      ceilMat
    );
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = CEILING_HEIGHT;
    this.group.add(ceil);

    // Cross-beams every 8 units along Z
    const beamMat = new THREE.MeshStandardMaterial({
      color: 0x3a2a1c, roughness: 0.85, metalness: 0.1,
    });
    for (let z = -ROOM_HALF_Z + 4; z < ROOM_HALF_Z; z += 8) {
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(ROOM_HALF_X * 2, 1.2, 0.8),
        beamMat
      );
      beam.position.set(0, CEILING_HEIGHT - 0.6, z);
      beam.castShadow = true;
      this.group.add(beam);
    }
  }

  _buildColumns() {
    // Four broken stone columns at the room corners — break up the silhouette,
    // give monsters cover to LOS-pull around. Engine pillars handle collision;
    // these are visual.
    const colMat = new THREE.MeshStandardMaterial({
      color: 0x3a2e24, roughness: 0.92, metalness: 0.06,
    });
    // Six visual columns: four flanking the room corners (visual depth) plus
    // two aligned to engine PILLAR_POSITIONS at ±20 (LOS-blocking).
    const positions = [
      { x: -38, z: -28 }, { x:  38, z: -28 },
      { x: -38, z:  28 }, { x:  38, z:  28 },
      { x: -20, z: -20 }, { x:  20, z:  20 },
      { x: -20, z:  20 }, { x:  20, z: -20 },
    ];
    for (const p of positions) {
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(1.2, 1.4, 11, 12, 1),
        colMat
      );
      col.position.set(p.x, 5.5, p.z);
      col.castShadow = true;
      col.receiveShadow = true;
      this.group.add(col);

      // Capital
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(3.5, 0.8, 3.5),
        colMat
      );
      cap.position.set(p.x, 11.4, p.z);
      cap.castShadow = true;
      this.group.add(cap);

      // Base
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(3.5, 0.8, 3.5),
        colMat
      );
      base.position.set(p.x, 0.4, p.z);
      base.castShadow = true; base.receiveShadow = true;
      this.group.add(base);
    }
  }

  _buildTorches() {
    // Torch color shifts per room variant — moss rooms glow sickly green, blood
    // rooms throb red, charred rooms keep the orange ember default, etc. Boss
    // gets deeper red + stronger intensity for that "throne room" feel.
    let flameColor = 0xff8844;
    let lightColor = 0xff7a44;
    let lightIntensity = 1.5;
    if (this._currentRoomType === 'boss') {
      flameColor = 0xff3322; lightColor = 0xff2a1a; lightIntensity = 2.4;
    } else if (this._currentRoomType === 'shrine') {
      flameColor = 0xfff0a8; lightColor = 0xffe88a; lightIntensity = 1.8;
    } else if (this._currentRoomType === 'hidden') {
      flameColor = 0xa888ff; lightColor = 0x8866ff; lightIntensity = 1.6;
    } else if (this._currentRoomType === 'treasure') {
      flameColor = 0xffd070; lightColor = 0xffc060; lightIntensity = 1.7;
    } else if (this._currentRoomType === 'combat') {
      // All combat variants use the same warm orange — variant tints
      // (green/red/etc) were leaking through as "colored squares" that
      // looked broken.
      flameColor = 0xff8844; lightColor = 0xff7a44; lightIntensity = 1.5;
    }
    const sconceMat = new THREE.MeshStandardMaterial({
      color: 0x2a1a0e, roughness: 0.85, metalness: 0.4,
    });
    const flameMat = new THREE.MeshBasicMaterial({ color: flameColor });

    // Torches every ~18 units along the long walls + a couple on the back wall.
    const positions = [
      // East wall (positive X) — 4 torches
      { x: ROOM_HALF_X - 0.5, z: -22, normalX: -1 },
      { x: ROOM_HALF_X - 0.5, z:  -8, normalX: -1 },
      { x: ROOM_HALF_X - 0.5, z:   8, normalX: -1 },
      { x: ROOM_HALF_X - 0.5, z:  22, normalX: -1 },
      // West wall (negative X) — 4 torches
      { x: -ROOM_HALF_X + 0.5, z: -22, normalX: 1 },
      { x: -ROOM_HALF_X + 0.5, z:  -8, normalX: 1 },
      { x: -ROOM_HALF_X + 0.5, z:   8, normalX: 1 },
      { x: -ROOM_HALF_X + 0.5, z:  22, normalX: 1 },
      // North wall (back, positive Z) — 2 flanking torches
      { x: -16, z: ROOM_HALF_Z - 0.5, normalZ: -1 },
      { x:  16, z: ROOM_HALF_Z - 0.5, normalZ: -1 },
    ];

    for (const p of positions) {
      // Sconce
      const sconce = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 1.2, 0.4),
        sconceMat
      );
      sconce.position.set(p.x, 7, p.z);
      this.group.add(sconce);

      // Flame
      const flame = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 8, 6),
        flameMat
      );
      flame.position.set(p.x, 7.8, p.z);
      this.group.add(flame);

      // Light
      const light = new THREE.PointLight(lightColor, lightIntensity, 16, 2);
      light.position.set(p.x + (p.normalX || 0) * 1.5, 7.5, p.z + (p.normalZ || 0) * 1.5);
      light.userData.baseIntensity = lightIntensity;
      light.userData.flickerOffset = Math.random() * Math.PI * 2;
      this.group.add(light);
      this.torches.push(light);
    }
  }

  _buildDoorway() {
    // Iron portcullis at the entrance (south wall doorway). Animates open
    // when the room loads, closes ominously after combat starts.
    const barMat = new THREE.MeshStandardMaterial({
      color: 0x1a1410, roughness: 0.7, metalness: 0.6,
    });
    const portcullis = new THREE.Group();
    portcullis.name = 'DungeonPortcullis';
    for (let x = -3.5; x <= 3.5; x += 0.7) {
      const bar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 10, 6),
        barMat
      );
      bar.position.set(x, 5, 0);
      portcullis.add(bar);
    }
    portcullis.position.set(0, 0, -ROOM_HALF_Z - 0.7);
    this.group.add(portcullis);
  }

  _buildThrone() {
    // Boss room — bigger, more imposing throne setup with red shaft of light,
    // pulsing runic floor circle, and a pair of guardian braziers flanking
    // the seat. The first time the player rounds the entrance pillar this
    // should read instantly as "you are not in another combat room."
    const throneMat = new THREE.MeshStandardMaterial({
      color: 0x1a1410, roughness: 0.85, metalness: 0.35,
    });
    const ironMat = new THREE.MeshStandardMaterial({
      color: 0x2a221a, roughness: 0.6, metalness: 0.85,
    });
    const throne = new THREE.Group();
    throne.name = 'BossThrone';

    // Massive stepped dais
    const daisLow = new THREE.Mesh(new THREE.BoxGeometry(10, 0.7, 7), throneMat);
    daisLow.position.set(0, 0.35, 0);
    throne.add(daisLow);
    const daisHigh = new THREE.Mesh(new THREE.BoxGeometry(7, 0.7, 5), throneMat);
    daisHigh.position.set(0, 1.05, 0);
    throne.add(daisHigh);

    // Seat (twice as big as before)
    const seat = new THREE.Mesh(new THREE.BoxGeometry(5, 1.4, 4), throneMat);
    seat.position.set(0, 2.1, 0);
    throne.add(seat);
    // Backrest with iron trim
    const back = new THREE.Mesh(new THREE.BoxGeometry(5.2, 9, 1), throneMat);
    back.position.set(0, 6, -1.8);
    throne.add(back);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.4, 1.1), ironMat);
    trim.position.set(0, 10.4, -1.8);
    throne.add(trim);
    // Tall spires on the backrest
    for (const x of [-2.2, 2.2]) {
      const spire = new THREE.Mesh(new THREE.ConeGeometry(0.4, 2.5, 8), ironMat);
      spire.position.set(x, 11.7, -1.8);
      throne.add(spire);
    }

    // Two flanking braziers spitting flame
    const brazierMat = new THREE.MeshStandardMaterial({ color: 0x1a1208, roughness: 0.6, metalness: 0.7 });
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xff3322 });
    for (const x of [-5, 5]) {
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 0.7, 0.6, 12), brazierMat);
      bowl.position.set(x, 2.4, 1.5);
      throne.add(bowl);
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 2.2, 8), brazierMat);
      stand.position.set(x, 1.2, 1.5);
      throne.add(stand);
      const flame = new THREE.Mesh(new THREE.SphereGeometry(1.0, 12, 10), flameMat);
      flame.position.set(x, 3.4, 1.5);
      flame.userData.isBossFlame = true;
      throne.add(flame);
      const brazierLight = new THREE.PointLight(0xff2a1a, 3.5, 22, 2);
      brazierLight.position.set(x, 4.5, 1.5);
      throne.add(brazierLight);
    }

    // Skull pile / ash heap at the base
    const ashMat = new THREE.MeshStandardMaterial({ color: 0x2a1814, roughness: 0.95 });
    const ash = new THREE.Mesh(new THREE.SphereGeometry(2.2, 10, 6), ashMat);
    ash.scale.set(1, 0.3, 1);
    ash.position.set(0, 0.5, 3.5);
    throne.add(ash);

    // Pulsing red sigil on the dais floor (in addition to the floor circle)
    const sigilMat = new THREE.MeshBasicMaterial({
      color: 0xa02020, transparent: true, opacity: 0.6, side: THREE.DoubleSide,
    });
    const sigil = new THREE.Mesh(new THREE.RingGeometry(2.4, 3.0, 32), sigilMat);
    sigil.rotation.x = -Math.PI / 2;
    sigil.position.set(0, 0.72, 0);
    sigil.userData.isBossSigil = true;
    throne.add(sigil);

    // Volumetric red shaft of "light" coming down from the ceiling onto the
    // throne — sells the apex of the dungeon. Cone with additive blend.
    const shaftMat = new THREE.MeshBasicMaterial({
      color: 0xff2a22, transparent: true, opacity: 0.18,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
    });
    const shaft = new THREE.Mesh(new THREE.ConeGeometry(4, 12, 16, 1, true), shaftMat);
    shaft.position.set(0, 9, 0);
    throne.add(shaft);

    throne.position.set(38, 0, 0);
    throne.rotation.y = -Math.PI / 2;
    this.group.add(throne);

    // Two banner pairs framing the approach to the throne
    const bannerMat = new THREE.MeshStandardMaterial({
      color: 0x4a1818, roughness: 0.95, metalness: 0.0,
    });
    for (const z of [-15, 15]) {
      for (const x of [10, 24]) {
        const banner = new THREE.Mesh(new THREE.PlaneGeometry(3, 8), bannerMat);
        banner.position.set(x, 7, z);
        banner.rotation.y = Math.PI / 2;
        this.group.add(banner);
      }
    }
  }

  _buildTreasureChest() {
    // Treasure room: gold-trimmed iron chest in the center
    const woodMat = new THREE.MeshStandardMaterial({
      color: 0x4a3018, roughness: 0.85, metalness: 0.1,
    });
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xc8a860, roughness: 0.4, metalness: 0.9, emissive: 0x664422, emissiveIntensity: 0.3,
    });

    const chest = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(3, 1.8, 2), woodMat);
    body.position.y = 0.9; chest.add(body);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(3, 0.4, 2), goldMat);
    lid.position.y = 2; chest.add(lid);
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.3), goldMat);
    lock.position.set(0, 1.7, 1.05); chest.add(lock);

    chest.position.set(15, 0, 0);
    this.group.add(chest);
  }

  _buildShrine() {
    // Shrine room: glowing altar with a hovering rune
    const altarMat = new THREE.MeshStandardMaterial({
      color: 0x4a4a5a, roughness: 0.6, metalness: 0.5,
    });
    const altar = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 2), altarMat);
    altar.position.set(15, 1, 0);
    this.group.add(altar);

    const runeMat = new THREE.MeshBasicMaterial({
      color: 0x88aaff, transparent: true, opacity: 0.8,
    });
    const rune = new THREE.Mesh(new THREE.OctahedronGeometry(0.7), runeMat);
    rune.position.set(15, 4, 0);
    rune.userData.isShrineRune = true;
    this.group.add(rune);

    const runeLight = new THREE.PointLight(0x88aaff, 1.8, 12);
    runeLight.position.set(15, 4, 0);
    this.group.add(runeLight);
  }

  _buildHiddenAltar() {
    // Hidden room: dark stone altar with a single brilliant white-gold rune
    const altarMat = new THREE.MeshStandardMaterial({
      color: 0x0a0808, roughness: 0.7, metalness: 0.4,
    });
    const altar = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.5, 1.5, 8), altarMat);
    altar.position.set(15, 0.75, 0);
    this.group.add(altar);

    const runeMat = new THREE.MeshBasicMaterial({ color: 0xffeecc });
    const rune = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 0), runeMat);
    rune.position.set(15, 2.8, 0);
    this.group.add(rune);

    const light = new THREE.PointLight(0xffeecc, 3, 18);
    light.position.set(15, 3, 0);
    this.group.add(light);
  }

  // ── Wing-based renderers ──────────────────────────────────────────────────

  // Per-chamber template — picks textures + tint + small geometry style.
  _chamberStyle(chamber) {
    const tpl = chamber.template;
    const styles = {
      entry_hall:        { wall: 'wall_stone',     floor: 'floor_stone',      tint: 0xa89888 },
      corridor:          { wall: 'wall_stone',     floor: 'floor_cracked',    tint: 0x988878 },
      octagonal_arena:   { wall: 'wall_runic',     floor: 'floor_runic',      tint: 0xa07060 },
      pillar_gauntlet:   { wall: 'wall_columned',  floor: 'floor_stone',      tint: 0xa89878 },
      ossuary:           { wall: 'wall_bone',      floor: 'floor_bone_dust',  tint: 0xb0a888 },
      ritual_pit:        { wall: 'wall_obsidian',  floor: 'floor_ritual',     tint: 0x806878 },
      collapsed_chapel:  { wall: 'wall_chapel',    floor: 'floor_chapel',     tint: 0xa89888 },
      long_hall_crypt:   { wall: 'wall_crypt',     floor: 'floor_crypt',      tint: 0x887868 },
      reliquary:         { wall: 'wall_chapel',    floor: 'floor_chapel',     tint: 0xc8a070 },
      treasure_alcove:   { wall: 'wall_carved',    floor: 'floor_stone',      tint: 0xc89860 },
      boss_throne:       { wall: 'wall_runic',     floor: 'floor_runic',      tint: 0xa87060 },
    };
    return styles[tpl] || styles.entry_hall;
  }

  _buildChamberFloor(chamber) {
    const style = this._chamberStyle(chamber);
    // Theme override: if a theme floor.primary is defined, prefer it over
    // the chamber-template default.
    const themeFloor = this._theme?.floor;
    const primaryTex = themeFloor?.primary || style.floor;
    const heightmapName = themeFloor?.heightmap || 'tex_heightmap_stone';
    const heightAmp = themeFloor?.heightAmplitude || 0.25;

    // One tile per 8 units made each slab roughly three player-widths across,
    // which reads as giant flat rectangles from the overhead gameplay camera.
    // 4 units puts floor detail near player scale, where a top-down game needs
    // it — this is the view the game is actually played from.
    const TILE = 4;
    const tex = loadTex(primaryTex, chamber.halfX * 2 / TILE, chamber.halfZ * 2 / TILE);
    // Procedural normal mapping — re-use diffuse as bumpMap to give the floor
    // visible surface relief. Diablo-style depth without authored normal maps.
    const mat = new THREE.MeshStandardMaterial({
      map: tex, color: style.tint, roughness: 0.92, metalness: 0.05,
      normalMap: loadNormal(primaryTex, chamber.halfX * 2 / TILE, chamber.halfZ * 2 / TILE),
      normalScale: new THREE.Vector2(1.1, 1.1),
    });
    // PERF: floor is now FLAT — heightmap displacement on a 32x32 subdivided
    // plane was tanking framerate (3000+ verts per chamber × 5 chambers).
    // The bumpMap on the floor material gives sufficient apparent depth.
    const geo = new THREE.PlaneGeometry(chamber.halfX * 2, chamber.halfZ * 2);
    const floor = new THREE.Mesh(geo, mat);
    floor.rotation.x = -Math.PI / 2;
    // Elevation makes a wing read as architecture rather than a floor plan.
    // Assigned per chamber by the layout generator; the step is small (4 units
    // against 14-unit walls) because the camera looks down and a large drop
    // would hide the lower room instead of showing depth.
    floor.position.set(chamber.cx, chamber.elevation || 0, chamber.cz);
    floor.receiveShadow = true;
    floor.userData.chamberId = chamber.id;
    this.group.add(floor);

    // Wet floor sheen overlay — only for themes that declare wetSheen
    if (themeFloor?.wetSheen) {
      const sheenTex = loadTex('vfx_wet_floor_sheen', chamber.halfX * 2 / 12, chamber.halfZ * 2 / 12);
      const sheenMat = new THREE.MeshBasicMaterial({
        map: sheenTex,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sheenGeo = new THREE.PlaneGeometry(chamber.halfX * 2, chamber.halfZ * 2);
      const sheen = new THREE.Mesh(sheenGeo, sheenMat);
      sheen.rotation.x = -Math.PI / 2;
      sheen.position.set(chamber.cx, (chamber.elevation || 0) + 0.04, chamber.cz);
      this.group.add(sheen);
    }

    // Skip overlays on tiny tiles (alcoves, entry halls) — they'd just stack.
    if (chamber.halfX < 12 || chamber.halfZ < 10) return;

    // Floor patches disabled — user reported them as "random textures that
    // look odd and out of place" (visible rectangular texture patches on
    // the floor read as un-blended squares regardless of blending mode).
    // The base chamber floor texture alone now carries the look.

    // ── Scatter floor decals (blood, scorch, claw marks, runes) ──────────
    // These read as "this place has seen carnage." Diablo does this densely.
    const decalOptions = [
      'decal_blood_splatter', 'decal_blood_handprint', 'decal_blood_runes',
      'decal_burn_scorch', 'decal_claw_marks',
      'decal_skull_glyph', 'decal_summoning_circle',
    ];
    // Theme-tinted decal subset for variety
    if (style.wall === 'wall_chapel') {
      decalOptions.push('decal_holy_circle', 'decal_holy_seal');
    }
    if (style.floor === 'floor_obsidian_polished' || style.floor === 'floor_ritual') {
      decalOptions.push('decal_summoning_circle');
    }

    // Floor decals cut from 6-10 → 2 max — too many of these (blood splatters,
    // scorch marks, glyphs) were reading as cluttered floating squares
    // rather than environmental detail. Two tasteful ones per chamber.
    const decalCount = 2;
    for (let i = 0; i < decalCount; i++) {
      const which = decalOptions[Math.floor(Math.random() * decalOptions.length)];
      const dTex = loadTex(which, 1, 1);
      const dSize = 3 + Math.random() * 2;
      const dMat = new THREE.MeshBasicMaterial({
        map: dTex,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        alphaTest: 0.4,
        blending: THREE.MultiplyBlending,
      });
      const decal = new THREE.Mesh(new THREE.PlaneGeometry(dSize, dSize), dMat);
      decal.rotation.x = -Math.PI / 2;
      decal.rotation.z = Math.random() * Math.PI * 2;
      const dx = chamber.cx + (Math.random() - 0.5) * (chamber.halfX * 1.4);
      const dz = chamber.cz + (Math.random() - 0.5) * (chamber.halfZ * 1.4);
      decal.position.set(dx, 0.05 + i * 0.005, dz);
      this.group.add(decal);
    }
  }

  _buildCorridorFloor(corridor) {
    const tex = loadTex('floor_cracked', corridor.halfX * 2 / 6, corridor.halfZ * 2 / 6);
    const mat = new THREE.MeshStandardMaterial({
      map: tex, color: 0x988878, roughness: 0.92, metalness: 0.05,
    });
    const geo = new THREE.PlaneGeometry(corridor.halfX * 2, corridor.halfZ * 2);
    const floor = new THREE.Mesh(geo, mat);
    floor.rotation.x = -Math.PI / 2;
    // Corridors carry the mean of what they join, so a link between levels
    // reads as a ramp rather than two hard steps.
    floor.position.set(corridor.cx, corridor.elevation || 0, corridor.cz);
    floor.receiveShadow = true;
    this.group.add(floor);
  }

  /** Find abutting overlap on each side of the given tile. */
  _findAbuttingRanges(tile, allTiles) {
    const ranges = { n: [], s: [], e: [], w: [] };
    const cN = tile.cz + tile.halfZ, cS = tile.cz - tile.halfZ;
    const cE = tile.cx + tile.halfX, cW = tile.cx - tile.halfX;
    const EPS = 0.5;
    for (const t of allTiles) {
      if (t === tile) continue;
      const tN = t.cz + t.halfZ, tS = t.cz - t.halfZ;
      const tE = t.cx + t.halfX, tW = t.cx - t.halfX;
      // North edge of `tile` meets south edge of `t`
      if (Math.abs(tS - cN) < EPS && tE > cW + EPS && tW < cE - EPS) {
        ranges.n.push([Math.max(cW, tW), Math.min(cE, tE)]);
      }
      if (Math.abs(tN - cS) < EPS && tE > cW + EPS && tW < cE - EPS) {
        ranges.s.push([Math.max(cW, tW), Math.min(cE, tE)]);
      }
      if (Math.abs(tW - cE) < EPS && tN > cS + EPS && tS < cN - EPS) {
        ranges.e.push([Math.max(cS, tS), Math.min(cN, tN)]);
      }
      if (Math.abs(tE - cW) < EPS && tN > cS + EPS && tS < cN - EPS) {
        ranges.w.push([Math.max(cS, tS), Math.min(cN, tN)]);
      }
    }
    return ranges;
  }

  /** Build wall segments along an axis-aligned edge with cut-outs for abutting tiles. */
  _buildEdgeWalls(opts) {
    const { x1, x2, z1, z2, axis, abuttingRanges, mat, height = WALL_HEIGHT, thickness = 1.0, accentMats = [] } = opts;
    const start = (axis === 'x') ? x1 : z1;
    const end   = (axis === 'x') ? x2 : z2;
    if (end <= start) return;

    // Sort ranges, build complementary segments (these are the "doorway gaps")
    const ranges = [...(abuttingRanges || [])].sort((a, b) => a[0] - b[0]);
    const segments = [];
    let cursor = start;
    for (const [a, b] of ranges) {
      if (a > cursor) segments.push([cursor, Math.min(a, end)]);
      cursor = Math.max(cursor, b);
      if (cursor >= end) break;
    }
    if (cursor < end) segments.push([cursor, end]);

    // Build each segment as a SOLID base wall (one piece, full height).
    // Earlier "dynamic subdivision" created stair-step buttresses with visible
    // void gaps between sub-pieces — visually terrible. Instead: solid base,
    // then layer detail (pilasters, broken caps, rubble, moss) as ADDITIONAL
    // meshes on top.
    for (const [s, e] of segments) {
      const len = e - s;
      if (len < 0.5) continue;
      // Slight pad on each end so adjacent wall segments overlap at corners
      // and there's no visible seam.
      const padded = 0.15;
      const adjLen = len + padded * 2;
      const mid = (s + e) / 2;
      // Flat BoxGeometry walls — subdivision (3000+ verts) was the biggest
      // single perf hit. Bump maps + textures give surface depth without
      // per-vertex displacement. Use the WALL_HEIGHT constant (10) so this
      // matches the chamber-edge wall builder.
      const wallHeight = height;
      let geo, pos;
      if (axis === 'x') {
        geo = new THREE.BoxGeometry(adjLen, wallHeight, thickness);
        pos = new THREE.Vector3(mid, wallHeight / 2, z1);
      } else {
        geo = new THREE.BoxGeometry(thickness, wallHeight, adjLen);
        pos = new THREE.Vector3(x1, wallHeight / 2, mid);
      }
      const wall = new THREE.Mesh(geo, mat);
      wall.position.copy(pos);
      // Walls don't cast directional-light shadows in dungeon mode — the
      // jagged displaced wall tops were projecting long spiky shadows across
      // the floor that read as broken visual artifacts. The chiaroscuro is
      // provided by SSAO + per-chamber spot lights + fake-GI floor uplight
      // instead. Walls still RECEIVE shadows from props.
      wall.castShadow = false;
      wall.receiveShadow = true;
      this.group.add(wall);

      // Layer detail on top: pilasters every ~12u (decorative outset columns),
      // accent panels every ~16u (alternate texture inset),
      // broken-top caps at random intervals.
      this._addWallSegmentDetails({
        s, e, axis,
        crossPos: (axis === 'x') ? z1 : x1,
        height, thickness, mat, accentMats,
      });
    }
  }

  /** Per-vertex displacement on a wall BoxGeometry so the wall surface has
   *  real broken-stone topology (not a flat box). Uses simplex-like noise
   *  computed from vertex position. Displaces only the outer X (or Z) face;
   *  inner face stays flat to keep the chamber interior clean. Top edge gets
   *  jagged carved-out variation (looks like the wall top has crumbled). */
  _displaceWallVertices(geo, axis, thickness, worldPos) {
    const pos = geo.attributes.position;
    const half = thickness / 2;
    // Cheap multi-octave noise function
    const noise = (x, y, z) => {
      const n1 = Math.sin(x * 0.7 + y * 0.5) * Math.cos(z * 0.6 + y * 0.4);
      const n2 = Math.sin(x * 1.8 + z * 1.3) * 0.4;
      const n3 = Math.cos(y * 2.2) * 0.25;
      return n1 + n2 + n3;
    };
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i);
      const ly = pos.getY(i);
      const lz = pos.getZ(i);
      // Sample noise from world-space coords so adjacent walls match seams
      const wx = lx + worldPos.x;
      const wz = lz + worldPos.z;
      const n = noise(wx, ly, wz);
      // Reduced displacement amplitude from 0.4 to 0.15. The big spiky
      // outward displacements were the cause of those long dark shadow
      // shapes the user saw on the floor — even with shadows disabled,
      // the silhouette was too irregular.
      if (axis === 'x') {
        const isOuterFace = Math.abs(Math.abs(lz) - half) < 0.01;
        const outerSign = Math.sign(worldPos.z) || 1;
        const isOuter = isOuterFace && Math.sign(lz) === outerSign;
        if (isOuter) {
          const disp = Math.max(0, n * 0.15 + 0.05);
          pos.setZ(i, lz + outerSign * disp);
        }
      } else {
        const isOuterFace = Math.abs(Math.abs(lx) - half) < 0.01;
        const outerSign = Math.sign(worldPos.x) || 1;
        const isOuter = isOuterFace && Math.sign(lx) === outerSign;
        if (isOuter) {
          const disp = Math.max(0, n * 0.15 + 0.05);
          pos.setX(i, lx + outerSign * disp);
        }
      }
      // Top edge crumble reduced from 0.6 to 0.25 max — the wall top now has
      // SUBTLE variation instead of spiky breakage that read as bad geometry.
      if (Math.abs(ly - WALL_HEIGHT / 2) < 0.5) {
        const crumble = Math.max(0, noise(wx, ly * 0.3, wz) * 0.25);
        pos.setY(i, ly - crumble);
      }
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }

  /** Layer decorative geometry ON TOP of the solid base wall — pilasters,
   *  accent panels, broken-top caps, and torch sconces. Result reads as a
   *  weathered ornate wall rather than a flat box, WITHOUT introducing
   *  voids/seams that the previous subdivision approach caused. */
  async _addWallSegmentDetails({ s, e, axis, crossPos, height, thickness, mat, accentMats = [] }) {
    // PERF: skip ALL wall decoration (pilasters + accent panels + broken
    // caps). Each chamber was generating dozens of these decorative meshes
    // (each a draw call) and they're cosmetic only. The base wall + corner
    // pillars + perimeter rubble carry enough detail. Saves ~100 draw calls
    // per wing.
    return;
    // eslint-disable-next-line no-unreachable
    const len = e - s;
    if (len < 4) return;

    // Pilasters every ~12u along the wall — use Meshy rune_pillar GLB
    // instead of procedural BoxGeometry for real architectural depth.
    const pilasterCount = Math.max(0, Math.floor(len / 12));
    const pilasterSpacing = len / (pilasterCount + 1);
    const outwardSign = (axis === 'x' ? Math.sign(crossPos) : Math.sign(crossPos)) || 1;

    // Lazy-load the rune_pillar GLB for use as pilasters
    if (!this._propLoader) {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      this._propLoader = new GLTFLoader();
    }
    if (!this._propCache) this._propCache = new Map();
    const tag = 'rune_pillar';
    let pillarModel = this._propCache.get(tag);
    if (pillarModel === undefined) {
      this._propCache.set(tag, null);
      try {
        const gltf = await new Promise((res, rej) =>
          this._propLoader.load(`/assets/models/props/${tag}.glb`, res, undefined, rej));
        this._propCache.set(tag, gltf.scene);
        pillarModel = gltf.scene;
      } catch {
        this._propCache.set(tag, null);
      }
    }

    for (let i = 1; i <= pilasterCount; i++) {
      const along = s + i * pilasterSpacing;
      // Position the pilaster slightly outset from the wall surface
      let px, pz;
      if (axis === 'x') {
        px = along;
        pz = crossPos + outwardSign * thickness * 0.5;
      } else {
        px = crossPos + outwardSign * thickness * 0.5;
        pz = along;
      }
      if (pillarModel) {
        const inst = pillarModel.clone(true);
        inst.traverse(c => {
          if (c.isMesh) {
            c.castShadow = false;
            c.receiveShadow = true;
            if (c.material && c.material.map && !c.material.bumpMap) {
              c.material.bumpMap = c.material.map;
              c.material.bumpScale = 0.06;
              c.material.needsUpdate = true;
            }
          }
        });
        inst.position.set(px, 0, pz);
        inst.rotation.y = (axis === 'x') ? 0 : Math.PI / 2;
        // Pilaster height should reach near the top of the wall (height=8 default)
        // Default Meshy pillar is roughly 4u tall, scale up
        inst.scale.setScalar(1.4 + Math.random() * 0.2);
        this.group.add(inst);
      } else {
        // Fallback procedural pilaster if GLB hasn't loaded
        const pilasterW = 1.2, pilasterD = thickness * 1.5, pilasterH = height * 1.05;
        const pgeo = axis === 'x'
          ? new THREE.BoxGeometry(pilasterW, pilasterH, pilasterD)
          : new THREE.BoxGeometry(pilasterD, pilasterH, pilasterW);
        const pillar = new THREE.Mesh(pgeo, mat);
        pillar.position.set(px, pilasterH / 2, pz);
        pillar.castShadow = false;
        pillar.receiveShadow = true;
        this.group.add(pillar);
      }
    }

    // Accent panel inset — every ~16u along the wall, embed a thin accent-
    // textured panel that reads as a runic glow / ornate carving on the wall.
    if (accentMats.length) {
      const accentCount = Math.max(0, Math.floor(len / 16));
      const accentSpacing = len / (accentCount + 1);
      for (let i = 1; i <= accentCount; i++) {
        const along = s + i * accentSpacing + (Math.random() - 0.5) * 2;
        const accentMat = accentMats[Math.floor(Math.random() * accentMats.length)];
        const aW = 2.8, aH = height * 0.5, aD = 0.06;
        let ageo, apos;
        if (axis === 'x') {
          ageo = new THREE.BoxGeometry(aW, aH, aD);
          // Push inward toward the chamber slightly so it reads as an inset panel
          const inZ = crossPos - outwardSign * (thickness / 2 + 0.04);
          apos = new THREE.Vector3(along, height * 0.5, inZ);
        } else {
          ageo = new THREE.BoxGeometry(aD, aH, aW);
          const inX = crossPos - outwardSign * (thickness / 2 + 0.04);
          apos = new THREE.Vector3(inX, height * 0.5, along);
        }
        const panel = new THREE.Mesh(ageo, accentMat);
        panel.position.copy(apos);
        this.group.add(panel);
      }
    }
  }

  _buildChamberWalls(chamber, wing) {
    const allTiles = [...wing.chambers, ...wing.corridors];
    const ranges = this._findAbuttingRanges(chamber, allTiles);
    const style = this._chamberStyle(chamber);
    // Theme-driven wall materials — primary + 2-3 accent textures so the
    // dynamic wall builder can swap textures between sub-pieces (some carved,
    // some runic-glow, some broken-relief), giving the Diablo feel.
    const themeWall = this._theme?.wall;
    const primaryTex = themeWall?.primary || style.wall;
    const accentTexNames = themeWall?.accentTextures || ['wall_runic_glow', 'wall_ornate_panel', 'wall_broken_relief'];
    const tint = themeWall?.tint || style.tint;
    const primaryWallTex = loadTex(primaryTex, 4, 1.5);
    const mat = new THREE.MeshStandardMaterial({
      map: primaryWallTex,
      color: tint, roughness: 0.95, metalness: 0.08,
      normalMap: loadNormal(primaryTex, 4, 1.5),
      normalScale: new THREE.Vector2(1.25, 1.25),
    });
    const accentMats = accentTexNames.map(name => {
      const at = loadTex(name, 4, 1.5);
      return new THREE.MeshStandardMaterial({
        map: at, color: tint, roughness: 0.92, metalness: 0.10,
        normalMap: loadNormal(name, 4, 1.5),
        normalScale: new THREE.Vector2(1.15, 1.15),
        // Runic accents glow — give them emissive so bloom picks them up
        emissive: name.includes('runic') ? 0x4a1010 : 0x000000,
        emissiveIntensity: name.includes('runic') ? 0.55 : 0,
      });
    });
    const cN = chamber.cz + chamber.halfZ, cS = chamber.cz - chamber.halfZ;
    const cE = chamber.cx + chamber.halfX, cW = chamber.cx - chamber.halfX;
    const T = 1.0;
    this._buildEdgeWalls({ x1: cW, x2: cE, z1: cN + T / 2, z2: cN + T / 2, axis: 'x', abuttingRanges: ranges.n, mat, accentMats });
    this._buildEdgeWalls({ x1: cW, x2: cE, z1: cS - T / 2, z2: cS - T / 2, axis: 'x', abuttingRanges: ranges.s, mat, accentMats });
    this._buildEdgeWalls({ x1: cE + T / 2, x2: cE + T / 2, z1: cS, z2: cN, axis: 'z', abuttingRanges: ranges.e, mat, accentMats });
    this._buildEdgeWalls({ x1: cW - T / 2, x2: cW - T / 2, z1: cS, z2: cN, axis: 'z', abuttingRanges: ranges.w, mat, accentMats });
    // Diablo-style wall accents: rubble at base + broken tops + moss tufts
    this._scatterWallDetail(chamber);
  }

  /** Add rubble piles at wall bases + broken/jagged top stones + occasional
   *  moss patches along the wall faces. Adds the "this wall has stood for
   *  centuries" weathered look instead of pristine flat panels. */
  _scatterWallDetail(chamber) {
    // DISABLED — the moss patches (flat green planes) and procedural
    // wall-base rubble blocks were the "random green squares" the user
    // kept reporting. They're flat untextured rectangles glued to walls
    // and never rendered correctly. The castle furniture pass + perimeter
    // rubble carry the wall detail now.
    return;
    // eslint-disable-next-line no-unreachable
    const cN = chamber.cz + chamber.halfZ;
    const cS = chamber.cz - chamber.halfZ;
    const cE = chamber.cx + chamber.halfX;
    const cW = chamber.cx - chamber.halfX;

    const rubbleMat = new THREE.MeshStandardMaterial({
      map: loadTex('tex_rubble_stone', 0.8, 0.8),
      color: 0x3a3028, roughness: 0.98, metalness: 0.0,
    });
    const stoneMat = new THREE.MeshStandardMaterial({
      map: loadTex('tex_carved_stone', 0.8, 0.8),
      color: 0x4a3a30, roughness: 0.95, metalness: 0.0,
    });
    const mossMat = new THREE.MeshBasicMaterial({
      color: 0x4a5a30, transparent: true, opacity: 0.55,
      depthWrite: false, side: THREE.DoubleSide,
    });

    // Number of detail props scales with wall length
    const detailCount = Math.floor((chamber.halfX + chamber.halfZ) * 0.4);
    for (let i = 0; i < detailCount; i++) {
      const wallSide = Math.floor(Math.random() * 4);
      const detailType = Math.random();
      let x, z, rotY;
      const inset = 1.2;
      if (wallSide === 0) { // North
        x = chamber.cx + (Math.random() - 0.5) * (chamber.halfX * 2 - 4);
        z = cN - inset;
        rotY = 0;
      } else if (wallSide === 1) { // South
        x = chamber.cx + (Math.random() - 0.5) * (chamber.halfX * 2 - 4);
        z = cS + inset;
        rotY = Math.PI;
      } else if (wallSide === 2) { // East
        x = cE - inset;
        z = chamber.cz + (Math.random() - 0.5) * (chamber.halfZ * 2 - 4);
        rotY = -Math.PI / 2;
      } else { // West
        x = cW + inset;
        z = chamber.cz + (Math.random() - 0.5) * (chamber.halfZ * 2 - 4);
        rotY = Math.PI / 2;
      }

      if (detailType < 0.45) {
        // Rubble pile at wall base — 2-3 stacked irregular blocks
        const pieces = 2 + Math.floor(Math.random() * 2);
        for (let p = 0; p < pieces; p++) {
          const w = 0.6 + Math.random() * 0.9;
          const h = 0.4 + Math.random() * 0.7;
          const d = 0.6 + Math.random() * 0.9;
          const block = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), rubbleMat);
          const jx = (Math.random() - 0.5) * 0.8;
          const jz = (Math.random() - 0.5) * 0.8;
          block.position.set(x + jx, h / 2 + p * 0.3, z + jz);
          block.rotation.set(
            (Math.random() - 0.5) * 0.5,
            Math.random() * Math.PI * 2,
            (Math.random() - 0.5) * 0.5,
          );
          block.castShadow = true;
          block.receiveShadow = true;
          this.group.add(block);
        }
      } else if (detailType < 0.75) {
        // Broken-off top stone — jagged piece angled out from the wall top
        const w = 0.7 + Math.random() * 0.9;
        const h = 0.6 + Math.random() * 0.5;
        const d = 0.5 + Math.random() * 0.5;
        const top = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stoneMat);
        top.position.set(x, WALL_HEIGHT - 0.4, z);
        top.rotation.set(
          (Math.random() - 0.5) * 0.4,
          rotY + (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 0.4,
        );
        top.castShadow = true;
        this.group.add(top);
      } else {
        // Moss/vegetation patch — flat plane stuck to wall
        const w = 0.8 + Math.random() * 1.4;
        const h = 0.8 + Math.random() * 1.4;
        const moss = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mossMat);
        moss.position.set(x, 0.5 + Math.random() * 4, z);
        moss.rotation.y = rotY;
        this.group.add(moss);
      }
    }
  }
  _buildChamberWallsLegacy() { /* preserved for any external callers */ }

  _buildCorridorWalls(corridor, wing) {
    const allTiles = [...wing.chambers, ...wing.corridors];
    const ranges = this._findAbuttingRanges(corridor, allTiles);
    const tex = loadTex('wall_stone', 3, 1.5);
    const mat = new THREE.MeshStandardMaterial({
      map: tex, color: 0x887878, roughness: 0.95, metalness: 0.08,
    });
    const cN = corridor.cz + corridor.halfZ, cS = corridor.cz - corridor.halfZ;
    const cE = corridor.cx + corridor.halfX, cW = corridor.cx - corridor.halfX;
    const T = 1.0;
    this._buildEdgeWalls({ x1: cW, x2: cE, z1: cN + T / 2, z2: cN + T / 2, axis: 'x', abuttingRanges: ranges.n, mat });
    this._buildEdgeWalls({ x1: cW, x2: cE, z1: cS - T / 2, z2: cS - T / 2, axis: 'x', abuttingRanges: ranges.s, mat });
    this._buildEdgeWalls({ x1: cE + T / 2, x2: cE + T / 2, z1: cS, z2: cN, axis: 'z', abuttingRanges: ranges.e, mat });
    this._buildEdgeWalls({ x1: cW - T / 2, x2: cW - T / 2, z1: cS, z2: cN, axis: 'z', abuttingRanges: ranges.w, mat });
  }

  /**
   * Ceiling over the whole wing.
   *
   * Was written and then never called: buildWing skips it, so the current
   * dungeon has no roof at all and the player sees sky over 6-unit walls. That
   * is why chambers read as walled courtyards rather than interiors — a
   * 108-unit-wide room, open to the sky, is a parade ground regardless of how
   * much clutter sits on the floor.
   *
   * The walls are short because the overhead camera has to see the player
   * (see WALL_HEIGHT). Enclosure and an overhead camera are only compatible if
   * the roof gets out of the way, which is what every isometric dungeon game
   * does: keep the ceiling for low, in-world views and drop it once the camera
   * climbs above it. setCeilingVisibility drives that per frame.
   */
  _buildCeilingFromBounds(bounds, height = WALL_HEIGHT) {
    const w = bounds.halfX * 2 + 4;
    const d = bounds.halfZ * 2 + 4;
    const tex = loadTex('ceiling_vault', w / 8, d / 8);
    const mat = new THREE.MeshStandardMaterial({
      map: tex, color: 0x4a3a30, roughness: 0.92, metalness: 0.05,
      side: THREE.DoubleSide, transparent: true, opacity: 1,
    });
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = height;
    ceil.renderOrder = -1;
    this.group.add(ceil);
    this._ceiling = ceil;
    return ceil;
  }

  /**
   * Fade the ceiling out as the camera rises through it, so an overhead camera
   * never looks at the underside of a roof and a low camera still feels roofed.
   */
  setCeilingVisibility(cameraY) {
    const c = this._ceiling;
    if (!c) return;
    const h = c.position.y;
    const fade = 6;
    const o = cameraY >= h ? 0 : Math.min(1, (h - cameraY) / fade);
    c.material.opacity = o;
    c.visible = o > 0.02;
  }

  /** Build a ceiling for the current wing. Opt-in: callers decide. */
  buildCeiling(bounds, height) {
    if (this._ceiling) { this.group.remove(this._ceiling); this._ceiling = null; }
    return this._buildCeilingFromBounds(bounds, height);
  }

  _buildTorchesFromWing(wing) {
    const sconceMat = new THREE.MeshStandardMaterial({ color: 0x2a1a0e, roughness: 0.85, metalness: 0.4 });
    // All torches use warm orange now — the mossy/bloodied/cracked variant
    // tints (green / red / amber) were rendering as small colored squares on
    // the floor (the additive flame spheres bleeding through the camera
    // perspective) which the user reported as "random green squares."
    // One consistent warm color keeps the castle theme coherent.
    let flameColor = 0xff8844, lightColor = 0xff7a44, lightIntensity = 1.5;
    if (this._currentRoomType === 'boss') {
      flameColor = 0xff3322; lightColor = 0xff2a1a; lightIntensity = 2.4;
    }
    const flameMat = new THREE.MeshBasicMaterial({ color: flameColor });

    // PERF: 4 torches per chamber × visible flame meshes, but only ONE
    // actual point-light per chamber (positioned high above the chamber
    // center for even illumination). Each PointLight is expensive in
    // WebGL forward rendering — going from 4-per-chamber to 1-per-chamber
    // (with 4 chambers, that's 16 → 4 lights). Big fps win.
    const pillarTopY = 9.4;
    for (const chamber of wing.chambers) {
      const inset = 2.5;
      const positions = [
        { x: chamber.cx - chamber.halfX + inset, z: chamber.cz - chamber.halfZ + inset },
        { x: chamber.cx + chamber.halfX - inset, z: chamber.cz - chamber.halfZ + inset },
        { x: chamber.cx - chamber.halfX + inset, z: chamber.cz + chamber.halfZ - inset },
        { x: chamber.cx + chamber.halfX - inset, z: chamber.cz + chamber.halfZ - inset },
      ];
      // Visible flame meshes at all 4 corners (cheap — no shader light cost)
      for (const p of positions) {
        const sconce = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.6), sconceMat);
        sconce.position.set(p.x, pillarTopY + 0.2, p.z);
        this.group.add(sconce);
        const flame = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), flameMat);
        flame.position.set(p.x, pillarTopY + 0.7, p.z);
        this.group.add(flame);
      }
      // ONE high light per chamber center providing the torch glow for all
      // four corners — same visual effect at 1/4 the light cost.
      const light = new THREE.PointLight(lightColor, lightIntensity * 2, 28, 2);
      light.position.set(chamber.cx, pillarTopY + 1.0, chamber.cz);
      light.userData.baseIntensity = lightIntensity * 2;
      light.userData.flickerOffset = Math.random() * Math.PI * 2;
      this.group.add(light);
      this.torches.push(light);
    }
  }

  /** Visible gothic archways at every chamber↔corridor connection so the
   *  player can see the doorways from the overhead camera (otherwise the
   *  gaps in the walls just read as missing geometry). */
  _buildGateArchways(wing) {
    const archMat = new THREE.MeshStandardMaterial({
      color: 0x3a2e22, roughness: 0.85, metalness: 0.35,
    });
    const allTiles = [...wing.chambers, ...wing.corridors];
    const placed = new Set();
    for (const tile of wing.chambers) {
      const ranges = this._findAbuttingRanges(tile, allTiles);
      const cN = tile.cz + tile.halfZ, cS = tile.cz - tile.halfZ;
      const cE = tile.cx + tile.halfX, cW = tile.cx - tile.halfX;
      // For each side, place one archway per abutting range
      for (const [side, list] of [['n', ranges.n], ['s', ranges.s], ['e', ranges.e], ['w', ranges.w]]) {
        for (const [a, b] of list) {
          const mid = (a + b) / 2;
          // Dedupe — both adjacent tiles compute the same archway
          const key = side === 'n' || side === 's'
            ? `xz:${mid.toFixed(1)}:${(side === 'n' ? cN : cS).toFixed(1)}`
            : `zx:${mid.toFixed(1)}:${(side === 'e' ? cE : cW).toFixed(1)}`;
          if (placed.has(key)) continue;
          placed.add(key);
          const arch = new THREE.Group();
          // Two posts + lintel
          const post1 = new THREE.Mesh(new THREE.BoxGeometry(0.8, 8, 0.8), archMat);
          const post2 = new THREE.Mesh(new THREE.BoxGeometry(0.8, 8, 0.8), archMat);
          const lintel = new THREE.Mesh(new THREE.BoxGeometry(1, 1.4, 1), archMat);
          if (side === 'n' || side === 's') {
            const z = side === 'n' ? cN : cS;
            const w = b - a;
            post1.position.set(mid - w / 2 + 0.4, 4, z);
            post2.position.set(mid + w / 2 - 0.4, 4, z);
            lintel.position.set(mid, 8.7, z);
            lintel.scale.set(w, 1, 1);
          } else {
            const x = side === 'e' ? cE : cW;
            const w = b - a;
            post1.position.set(x, 4, mid - w / 2 + 0.4);
            post2.position.set(x, 4, mid + w / 2 - 0.4);
            lintel.position.set(x, 8.7, mid);
            lintel.scale.set(1, 1, w);
          }
          for (const p of [post1, post2]) {
            p.castShadow = true; p.receiveShadow = true;
          }
          arch.add(post1); arch.add(post2); arch.add(lintel);
          this.group.add(arch);
        }
      }
    }
  }

  /** Warm directional "skylight" coming from above + slightly back, fakes
   *  sunlight pouring in from the now-roofless dungeon. Plus a soft fill
   *  so corners aren't pitch black. */
  _buildAmbientLighting(wing) {
    // PERF: dramatically reduced light count. Previously each chamber got
    // 4 separate PointLights (fake GI + main fill + rim + floor uplight),
    // plus hemi + directional at wing level. With 4 chambers + 4 torches
    // each (16 more) + architecture lights (4 more), we were running ~30
    // dynamic lights, which WebGL forward rendering can't handle without
    // tanking framerate.
    // New approach: ONE hemisphere light for global tint, ONE main fill per
    // chamber for the pool-of-light effect. Torches still provide the
    // dramatic flicker. Total ~5-6 lights per wing instead of 30.
    // Wing-level hemisphere ambient (low — authored chambers add their own
    // theme-specific ambient on top of this).
    const hemi = new THREE.HemisphereLight(0xd0d4e0, 0x181010, 0.35);
    hemi.position.set(0, 30, 0);
    this.group.add(hemi);
    // Per-chamber fill light — SKIPPED for chambers with authored layouts
    // (those carry their own accent lighting recipe). Procedural chambers
    // still get a basic chamber fill so they're not pitch black.
    const authoredIds = this._authoredChambers || new Set();
    for (const c of wing.chambers) {
      if (c.hidden) continue;
      if (authoredIds.has(c.id || `${c.cx},${c.cz}`)) continue;
      const fill = new THREE.PointLight(0xffc080, 1.4, Math.max(c.halfX, c.halfZ) * 2.2, 2);
      fill.position.set(c.cx, 12, c.cz);
      fill.userData.isChamberFill = true;
      fill.userData.basePulse = 1.4;
      fill.userData.flickerPhase = Math.random() * Math.PI * 2;
      this.group.add(fill);
    }

    // Chamber fog sprites DISABLED — user reported they looked nothing like
    // fog (just floating textured rectangles). Scene fog density alone now
    // provides the atmospheric haze.
    if (false) for (const c of wing.chambers) {
      if (c.hidden) continue;
      const area = c.halfX * c.halfZ;
      const fogCount = Math.max(4, Math.floor(area / 80));
      // FAR fewer fog sprites — previously 4-15 per chamber created opaque
      // overlapping blobs that read as dark silhouettes on the floor. Reduced
      // to 2-4 per chamber, ADDITIVE blending (so they brighten the air
      // instead of darken it), shadow-disabled, and only above head height
      // so they never sit on the floor occluding tile patterns.
      const reducedFogCount = Math.max(2, Math.min(4, Math.floor(fogCount / 3)));
      for (let i = 0; i < reducedFogCount; i++) {
        const roll = Math.random();
        const texKey = roll < 0.50 ? 'dense' : roll < 0.85 ? 'mist' : 'smoke';
        const tex = this._fogTexes[texKey];
        const size = texKey === 'smoke'
          ? 6 + Math.random() * 4
          : 12 + Math.random() * 8;
        const tall = texKey === 'smoke';
        const mat = new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          opacity: 0.08 + Math.random() * 0.10,
          depthWrite: false,
          depthTest: true,
          side: THREE.DoubleSide,
          // Additive blending so fog BRIGHTENS the air (Diablo style),
          // doesn't render as dark silhouette on floor
          blending: THREE.AdditiveBlending,
          // Subtle warm tint, no longer dark brown
          color: texKey === 'mist' ? 0x504030 : 0x806040,
        });
        const fog = new THREE.Mesh(
          new THREE.PlaneGeometry(size, tall ? size * 1.5 : size),
          mat,
        );
        const fx = c.cx + (Math.random() - 0.5) * c.halfX * 1.4;
        const fz = c.cz + (Math.random() - 0.5) * c.halfZ * 1.4;
        // Keep fog ABOVE the player's head so it doesn't blob over the floor
        const fy = tall
          ? 5 + Math.random() * 3
          : 4 + Math.random() * 2;
        fog.position.set(fx, fy, fz);
        fog.rotation.x = tall
          ? (Math.random() - 0.5) * 0.2
          : -Math.PI / 2 + (Math.random() - 0.5) * 0.5;
        fog.rotation.z = Math.random() * Math.PI * 2;
        fog.castShadow = false;
        fog.receiveShadow = false;
        fog.userData.isFog = true;
        fog.userData.fogVariant = texKey;
        // Per-sprite drift vector
        fog.userData.driftDirX = (Math.random() - 0.5) * 0.6;
        fog.userData.driftDirZ = (Math.random() - 0.5) * 0.6;
        fog.userData.driftPhase = Math.random() * Math.PI * 2;
        fog.userData.driftSpeed = 0.2 + Math.random() * 0.4;
        fog.userData.spinSpeed = (Math.random() - 0.5) * 0.0008;
        fog.userData.baseX = fx;
        fog.userData.baseY = fy;
        fog.userData.baseZ = fz;
        // Per-chamber drift bounds so fog never escapes its room
        fog.userData.boundCx = c.cx;
        fog.userData.boundCz = c.cz;
        fog.userData.boundR = Math.min(c.halfX, c.halfZ) * 1.3;
        this.group.add(fog);
      }
    }

    // God-ray shafts disabled — they were big vertical PlaneGeometry
    // billboards that read as bright white pillars on the overhead camera.
    // The chamber center point-light from _buildChamberArchitecture gives
    // the "pool of light" feel without the broken planar look.

    // ── Drifting embers and ash — instanced billboards that float upward
    // and respawn at the bottom. Use painted ember/ash particles for the
    // immersive "this place is on fire" atmosphere.
    if (!this._emberTex) {
      this._emberTex = new THREE.TextureLoader().load('/assets/art/vfx/vfx_ember_particle.png');
      this._ashTex = new THREE.TextureLoader().load('/assets/art/vfx/vfx_ash_particle.png');
    }
    for (const c of wing.chambers) {
      if (c.hidden) continue;
      // PERF: cap embers/ash to 4 per chamber (was up to 30+) — large chambers
      // were creating particle storms that hammered fillrate.
      const particleCount = Math.max(3, Math.min(6, Math.floor(c.halfX * c.halfZ / 600)));
      for (let i = 0; i < particleCount; i++) {
        const isEmber = Math.random() < 0.65;
        const mat = new THREE.MeshBasicMaterial({
          map: isEmber ? this._emberTex : this._ashTex,
          transparent: true,
          opacity: 0.5 + Math.random() * 0.4,
          depthWrite: false,
          blending: isEmber ? THREE.AdditiveBlending : THREE.NormalBlending,
          side: THREE.DoubleSide,
        });
        const size = isEmber ? 0.35 + Math.random() * 0.4 : 0.4 + Math.random() * 0.5;
        const p = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
        const px = c.cx + (Math.random() - 0.5) * c.halfX * 1.7;
        const pz = c.cz + (Math.random() - 0.5) * c.halfZ * 1.7;
        const py = Math.random() * 8;
        p.position.set(px, py, pz);
        p.userData.isAtmosphereParticle = true;
        p.userData.isEmber = isEmber;
        p.userData.driftSpeed = isEmber
          ? 0.6 + Math.random() * 0.8 // embers rise
          : -(0.3 + Math.random() * 0.4); // ash falls
        p.userData.sideDrift = (Math.random() - 0.5) * 0.3;
        p.userData.phase = Math.random() * Math.PI * 2;
        p.userData.baseX = px;
        p.userData.baseZ = pz;
        p.userData.maxY = 8;
        this.group.add(p);
      }
    }
  }

  _buildBreakableWalls(wing) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x4a3a2a, roughness: 0.95, metalness: 0.05,
    });
    for (const door of wing.doors) {
      if (door.kind !== 'breakable' || door.broken) continue;
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(door.halfX * 2, WALL_HEIGHT * 0.85, door.halfZ * 2 + 1.0),
        mat,
      );
      wall.position.set(door.cx, WALL_HEIGHT / 2 * 0.85, door.cz);
      wall.userData.isBreakableWall = true;
      wall.userData.doorId = door.id;
      // Visual hint cracks
      const crack = new THREE.Mesh(
        new THREE.BoxGeometry(door.halfX * 1.2, 1.4, 0.05),
        new THREE.MeshBasicMaterial({ color: 0xa84020, transparent: true, opacity: 0.7 }),
      );
      crack.position.set(door.cx, WALL_HEIGHT / 2, door.cz + door.halfZ + 0.1);
      this.group.add(wall);
      this.group.add(crack);
    }
  }

  /** Place chest + lever GLBs (with prop-loader fallback to procedural). */
  /** Build the environmental "void filler" outside the wing's playable area.
   *  Diablo-style: chambers don't sit in pure brown emptiness — there's
   *  visible (but unreachable) terrain beyond the walls. We build:
   *    1. Dark stone floor extending well past the bounds — a "subfloor"
   *       that's visible in any view-angle gap between chambers
   *    2. Scatter of rubble piles, broken pillars, ruined wall segments
   *       OUTSIDE the wing's tile footprint to suggest a wider ruin
   *    3. Heavy fog ring around the wing's perimeter to fade everything
   *       into mystery
   *    4. Distant cliff/rock geometry at low elevation creating depth
   *  All purely decorative — player can't walk there (polygon containment
   *  clamps to wing tiles only). */

  /** Apply vertex displacement to a PlaneGeometry from a heightmap texture.
   *  Reads the texture's image data once, samples per-vertex, and bakes
   *  Y-displacement into the geometry. Result: floor has gentle bumps,
   *  raised platforms, sunken patches — not billiard-table flat. */
  _applyHeightDisplacement(geo, heightmapName, amplitude = 0.25) {
    if (!this._heightmapCache) this._heightmapCache = new Map();
    const cached = this._heightmapCache.get(heightmapName);
    const applyFromImageData = (imgData, w, h) => {
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const u = (pos.getX(i) / geo.parameters.width + 0.5) % 1;
        const v = (pos.getY(i) / geo.parameters.height + 0.5) % 1;
        const px = Math.floor(u * w) % w;
        const py = Math.floor(v * h) % h;
        const idx = (py * w + px) * 4;
        const r = imgData[idx] / 255;
        // Heightmap is grayscale: use R as height
        pos.setZ(i, (r - 0.5) * amplitude * 2);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
    };
    if (cached?.data) {
      applyFromImageData(cached.data, cached.w, cached.h);
      return;
    }
    // Async load — geometry stays flat until heightmap loads, then bumps appear.
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, img.width, img.height).data;
      this._heightmapCache.set(heightmapName, { data: imgData, w: img.width, h: img.height });
      applyFromImageData(imgData, img.width, img.height);
    };
    img.onerror = () => {
      // Heightmap missing — geometry stays flat, no harm done
      this._heightmapCache.set(heightmapName, { data: null });
    };
    img.src = `/assets/art/dungeon/${heightmapName}.png`;
  }

  /** Scatter vegetation tufts (grass/weed/dead-branch/moss) across the chamber
   *  floor based on the theme's vegetation profile. Each tuft is a billboard
   *  PlaneGeometry with a painted texture. */
  _buildChamberVegetation(chamber) {
    const veg = this._theme?.vegetation;
    if (!veg || !veg.density || !veg.variants?.length) return;
    // Skip on small/non-combat tiles
    if (chamber.halfX < 12 || chamber.halfZ < 10) return;

    if (!this._vegTexCache) this._vegTexCache = new Map();
    const getTex = (name) => {
      if (this._vegTexCache.has(name)) return this._vegTexCache.get(name);
      const t = loadTex(name, 1, 1);
      this._vegTexCache.set(name, t);
      return t;
    };

    // Density: 0..1 → number of tufts per ~100 sq units of floor
    const area = chamber.halfX * 2 * chamber.halfZ * 2;
    const tuftCount = Math.floor(area / 100 * veg.density);
    for (let i = 0; i < tuftCount; i++) {
      const variant = veg.variants[Math.floor(Math.random() * veg.variants.length)];
      const tex = getTex(variant);
      // Vines hang from walls vertically; others sit flat on the floor
      const isVine = variant.includes('vine');
      const size = isVine
        ? 1.5 + Math.random() * 1.5
        : 0.9 + Math.random() * 0.8;
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0.75 + Math.random() * 0.25,
        depthWrite: false,
        side: THREE.DoubleSide,
        color: veg.color || 0xffffff,
        alphaTest: 0.1,
      });
      const tuft = new THREE.Mesh(
        new THREE.PlaneGeometry(size, isVine ? size * 1.8 : size),
        mat,
      );
      const x = chamber.cx + (Math.random() - 0.5) * (chamber.halfX * 2 - 4);
      const z = chamber.cz + (Math.random() - 0.5) * (chamber.halfZ * 2 - 4);
      if (isVine) {
        // Hanging vine: stick to nearest wall, vertical orientation
        const dxN = chamber.cz + chamber.halfZ - z;
        const dxS = z - (chamber.cz - chamber.halfZ);
        const dxE = chamber.cx + chamber.halfX - x;
        const dxW = x - (chamber.cx - chamber.halfX);
        const minD = Math.min(dxN, dxS, dxE, dxW);
        if (minD > 6) continue; // only near walls
        tuft.position.set(x, 2 + Math.random() * 3, z);
        tuft.rotation.y = Math.random() * Math.PI * 2;
      } else {
        tuft.position.set(x, size / 2 - 0.05, z);
        tuft.rotation.y = Math.random() * Math.PI * 2;
      }
      this.group.add(tuft);
    }
  }

  /** Theme-driven weather particle system. Rain falls straight down with
   *  motion-streak texture, snow swirls gently, ash drifts. Lightning is a
   *  random flash overlay. */
  _buildWeatherSystem(wing) {
    const w = this._theme?.weather;
    if (!w || w.type === 'none') return;
    const density = w.density || 1;
    const bounds = wing.bounds;
    const areaX = bounds.halfX * 2;
    const areaZ = bounds.halfZ * 2;
    // PERF: massive reduction — weather particles were 200+ on big wings.
    // 50 cap is plenty of visual atmosphere without melting fillrate.
    const particleCount = Math.floor((areaX * areaZ / 200) * density);
    const cap = 50;

    let texName, color, speed, isVertical, blend, isStreak;
    if (w.type === 'rain') {
      texName = 'vfx_rain_streak';
      color = 0xaaccff;
      speed = 16;
      isVertical = true;
      blend = THREE.NormalBlending;
      isStreak = true;
    } else if (w.type === 'snow') {
      texName = 'vfx_snow_flake';
      color = 0xffffff;
      speed = 1.5;
      isVertical = false;
      blend = THREE.NormalBlending;
      isStreak = false;
    } else if (w.type === 'ash') {
      texName = 'vfx_ash_fall';
      color = 0xcccccc;
      speed = 1.0;
      isVertical = false;
      blend = THREE.NormalBlending;
      isStreak = false;
    } else if (w.type === 'ember') {
      // Embers rise instead of falling — handled by existing ambient particles
      return;
    } else {
      return;
    }

    if (!this._weatherTexCache) this._weatherTexCache = new Map();
    let tex = this._weatherTexCache.get(texName);
    if (!tex) {
      tex = loadTex(texName, 1, 1);
      this._weatherTexCache.set(texName, tex);
    }

    const count = Math.min(particleCount, cap);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, depthWrite: false,
        opacity: 0.45 + Math.random() * 0.4,
        blending: blend, color, side: THREE.DoubleSide,
        alphaTest: 0.08,
      });
      const size = isStreak
        ? 0.5 + Math.random() * 0.3
        : 0.3 + Math.random() * 0.25;
      const p = new THREE.Mesh(
        new THREE.PlaneGeometry(size * (isStreak ? 0.3 : 1), isStreak ? size * 4 : size),
        mat,
      );
      const x = (Math.random() - 0.5) * areaX * 1.1;
      const z = (Math.random() - 0.5) * areaZ * 1.1;
      const y = Math.random() * 16;
      p.position.set(x, y, z);
      p.userData.isWeather = true;
      p.userData.weatherType = w.type;
      p.userData.fallSpeed = speed * (0.8 + Math.random() * 0.5);
      p.userData.driftPhase = Math.random() * Math.PI * 2;
      p.userData.swirlMag = isVertical ? 0 : 0.4;
      p.userData.baseX = x;
      p.userData.baseZ = z;
      p.userData.maxY = 16;
      this.group.add(p);
    }

    // Lightning flash overlay — fullscreen plane that briefly brightens.
    if (w.lightning && !this._lightningOverlay) {
      const flashTex = loadTex('vfx_lightning_flash', 1, 1);
      const flashMat = new THREE.MeshBasicMaterial({
        map: flashTex, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const flash = new THREE.Mesh(new THREE.PlaneGeometry(40, 80), flashMat);
      flash.position.set(0, 30, 0);
      flash.rotation.x = Math.PI / 4;
      flash.userData.isLightning = true;
      flash.userData.nextFlashTime = 5 + Math.random() * 8;
      this.group.add(flash);
      this._lightningOverlay = flash;
    }
  }

  /** Add volumetric light cones at each torch position so torchlight reads
   *  as visible beams through the fog (Diablo-style chiaroscuro). */
  _buildLightCones(_wing) {
    // Disabled — these were huge bright vertical planes that read as broken
    // white pillars on the overhead Diablo camera. The "pool of light" feel
    // is now provided by point-lights in _buildChamberArchitecture instead.
  }

  async _buildOuterEnvironment(wing) {
    if (!wing.chambers?.length) return;

    // ── 0) Skybox dome — uses the DALL-E painted void_skybox.png mapped to
    // the inside of a giant sphere. When the camera ever points past the
    // outer ground, it sees a painted "distant ruins / deep gloom" backdrop
    // instead of a flat colored void. Tone-mapped + fog-affected so it
    // blends into the chamber fog seamlessly.
    {
      if (!this._skyboxTex) {
        this._skyboxTex = new THREE.TextureLoader().load('/assets/art/dungeon/void_skybox.png');
        this._skyboxTex.colorSpace = THREE.SRGBColorSpace;
        this._skyboxTex.mapping = THREE.EquirectangularReflectionMapping;
      }
      const domeR = Math.max(wing.bounds.halfX, wing.bounds.halfZ) + 400;
      // Skybox is fogged out beyond ~50u so high-detail geometry is wasted.
      // 16x10 segments vs 48x24 cuts vertex count from 1,152 to 160 — looks
      // identical at runtime.
      const domeGeo = new THREE.SphereGeometry(domeR, 16, 10);
      const domeMat = new THREE.MeshBasicMaterial({
        map: this._skyboxTex,
        side: THREE.BackSide,
        fog: true,
        color: 0x553a30, // tint multiplier — dim the painted texture so it
                        // reads as distant atmosphere rather than vivid art
      });
      const dome = new THREE.Mesh(domeGeo, domeMat);
      dome.position.y = 0;
      this.group.add(dome);
    }

    // ── 1) Subfloor — pure black plane that fills any "gap" between chamber
    // floors. Sits ~0.03u below the chamber floors so chamber floors render
    // on top. Black + toneMapped:false so it's truly invisible — the player
    // can't tell where the chamber floor ends and the void begins.
    const halfX = wing.bounds.halfX + 40;
    const halfZ = wing.bounds.halfZ + 40;
    const subfloorMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      fog: false,
      toneMapped: false,
    });
    const subfloor = new THREE.Mesh(
      new THREE.PlaneGeometry(halfX * 2, halfZ * 2),
      subfloorMat,
    );
    subfloor.rotation.x = -Math.PI / 2;
    subfloor.position.y = -0.05;
    this.group.add(subfloor);

    // ── 1.5) Outer GROUND — MASSIVE textured plane visible past the
    // chamber walls. Color tint BRIGHTENED 0x1a1410 → 0x6a5040 so the
    // painted floor_ashen texture is actually visible (previous tint was
    // so dark the texture read as uniform gray void). Fog still hides it
    // at distance, so the bright tint only shows in the near band.
    const groundHalf = 800;
    const outerGroundTex = loadTex('floor_ashen', groundHalf / 6, groundHalf / 6);
    const outerGroundMat = new THREE.MeshStandardMaterial({
      map: outerGroundTex,
      color: 0x6a5040,
      roughness: 0.95, metalness: 0.0,
    });
    const outerGround = new THREE.Mesh(
      new THREE.PlaneGeometry(groundHalf * 2, groundHalf * 2),
      outerGroundMat,
    );
    outerGround.rotation.x = -Math.PI / 2;
    outerGround.position.y = -0.04;
    this.group.add(outerGround);

    // ── 2) Outer-ring rubble/pillar scatter — ruins beyond the playable
    // area. Placed in a band 6-50u outside the wing bounds to fill the
    // "void" with detail.
    const isInsideWing = (x, z) => {
      for (const c of wing.chambers) {
        if (Math.abs(x - c.cx) < c.halfX + 1 && Math.abs(z - c.cz) < c.halfZ + 1) return true;
      }
      for (const co of wing.corridors) {
        if (Math.abs(x - co.cx) < co.halfX + 1 && Math.abs(z - co.cz) < co.halfZ + 1) return true;
      }
      return false;
    };
    const rubbleMat = new THREE.MeshStandardMaterial({
      map: loadTex('tex_rubble_stone', 1, 1),
      color: 0x4a3a30, roughness: 0.95, metalness: 0.05,
    });
    const wallChunkMat = new THREE.MeshStandardMaterial({
      map: loadTex('tex_carved_stone', 1, 1),
      color: 0x3a2e22, roughness: 0.9, metalness: 0.05,
    });
    // PERF: outer props back to 30. The previous bump to 140 tanked frame
    // rate (4-5fps reports). Combined with the huge outer ground plane +
    // distant landmarks + fog haze the player still reads "designed ruin
    // field" without 140 individual draw calls.
    // Outer scatter removed — user reported the small gray cubes/cylinders
    // looked like "random untextured boxes." Clean outer ground + the
    // distant Meshy landmarks (already kept) carry the visual weight now.

    // ── 3) Distant outer-ring landmarks — replaced procedural box "cliffs"
    // with real Meshy props (buttresses, broken statues, guardian statues,
    // collapsed archways). Looks like the wing sits in a much larger ruin
    // instead of being boxed in by procedural cubes.
    if (!this._propLoader) {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      this._propLoader = new GLTFLoader();
    }
    if (!this._propCache) this._propCache = new Map();
    const RING_PROPS = poolFor('ring');
    // PERF: distant Meshy landmarks 24 → 6. Each is a high-poly GLB clone
    // with many sub-meshes (~5 draw calls each) so 24 was producing 100+
    // draw calls at the horizon. 6 is enough at this fog density.
    const cliffRing = 6;
    const cliffR = Math.max(wing.bounds.halfX, wing.bounds.halfZ) + 70;
    for (let i = 0; i < cliffRing; i++) {
      const a = (i / cliffRing) * Math.PI * 2 + Math.random() * 0.3;
      const r = cliffR + (Math.random() - 0.5) * 12;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const tag = RING_PROPS[Math.floor(Math.random() * RING_PROPS.length)];
      let model = this._propCache.get(tag);
      if (model === undefined) {
        this._propCache.set(tag, null);
        try {
          const gltf = await new Promise((res, rej) =>
            this._propLoader.load(`/assets/models/props/${tag}.glb`, res, undefined, rej));
          this._propCache.set(tag, gltf.scene);
          model = gltf.scene;
        } catch {
          this._propCache.set(tag, null);
        }
      }
      if (model) {
        const inst = model.clone(true);
        inst.traverse(c => {
          if (c.isMesh) {
            c.castShadow = false;
            c.receiveShadow = true;
            if (c.material && c.material.map && !c.material.bumpMap) {
              c.material.bumpMap = c.material.map;
              c.material.bumpScale = 0.06;
              c.material.needsUpdate = true;
            }
          }
        });
        inst.position.set(x, 0, z);
        inst.rotation.y = Math.atan2(-x, -z); // face origin
        // Scale up the ring landmarks so they read at distance — these
        // are meant to be far-away environmental detail, not cover.
        inst.scale.setScalar(2.5 + Math.random() * 1.5);
        this.group.add(inst);
      }
    }

    // ── 4) Outer fog band — ring of dense fog sprites around the wing,
    // fading the outer area into mystery so the cliffs read as "distant"
    // rather than "boundary box."
    if (!this._fogTexes) {
      this._fogTexes = {
        dense: new THREE.TextureLoader().load('/assets/art/vfx/vfx_fog_dense.png'),
        mist: new THREE.TextureLoader().load('/assets/art/vfx/vfx_mist_swirl.png'),
        smoke: new THREE.TextureLoader().load('/assets/art/vfx/vfx_smoke_column.png'),
        dust: new THREE.TextureLoader().load('/assets/art/vfx/vfx_dust_cloud.png'),
      };
    }
    // Outer fog ring disabled entirely — user reported them as "random
    // floating textures." Scene fog density + the dome already handle the
    // distant haze; the additive sprite billboards were just visual noise.
    const ringCount = 0;
    const ringR = Math.max(wing.bounds.halfX, wing.bounds.halfZ) + 40;
    for (let i = 0; i < ringCount; i++) {
      const a = (i / ringCount) * Math.PI * 2 + Math.random() * 0.4;
      const r = ringR + Math.random() * 25;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const size = 14 + Math.random() * 10;
      const mat = new THREE.MeshBasicMaterial({
        map: Math.random() < 0.7 ? this._fogTexes.dense : this._fogTexes.mist,
        transparent: true,
        opacity: 0.12 + Math.random() * 0.08,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        color: 0x604838,
      });
      const fog = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
      // Vertical orientation (face camera) instead of lying on floor
      fog.position.set(x, 8 + Math.random() * 4, z);
      fog.rotation.y = Math.atan2(-x, -z); // face origin
      fog.castShadow = false;
      fog.receiveShadow = false;
      fog.userData.isFog = true;
      fog.userData.fogVariant = 'outer';
      fog.userData.driftDirX = (Math.random() - 0.5) * 0.3;
      fog.userData.driftDirZ = (Math.random() - 0.5) * 0.3;
      fog.userData.driftPhase = Math.random() * Math.PI * 2;
      fog.userData.driftSpeed = 0.15 + Math.random() * 0.2;
      fog.userData.spinSpeed = (Math.random() - 0.5) * 0.0006;
      fog.userData.baseX = x;
      fog.userData.baseY = fog.position.y;
      fog.userData.baseZ = z;
      fog.userData.boundR = 12;
      this.group.add(fog);
    }
  }

  /** Render procedural interior cover pieces (Diablo-style chamber variety).
   *  Each cover entry is a `kind` (pillar_cluster / rubble_pile / broken_arch /
   *  ritual_circle) at a position with rotation + piece count. We build small
   *  groups of geometry inline since these are scattered randomly per-run and
   *  loading a GLB per piece would be excessive. */
  /** Phase-1 revamp: cover pieces now use real Meshy GLBs instead of
   *  procedural CylinderGeometry/BoxGeometry. Pillar clusters pick from a
   *  pool of real pillar models (broken/runic/intact/crumbling), rubble
   *  piles use rubble_pile + rubble_small, broken arches use collapsed_archway. */
  async _buildCoverPieces(wing) {
    if (!wing.cover?.length) return;
    if (!this._propLoader) {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      this._propLoader = new GLTFLoader();
    }
    if (!this._propCache) this._propCache = new Map();
    // Async loader that caches GLBs
    const loadPropClone = async (tag) => {
      let model = this._propCache.get(tag);
      if (model === undefined) {
        this._propCache.set(tag, null);
        try {
          const gltf = await new Promise((res, rej) =>
            this._propLoader.load(`/assets/models/props/${tag}.glb`, res, undefined, rej));
          this._propCache.set(tag, gltf.scene);
          model = gltf.scene;
        } catch {
          this._propCache.set(tag, null);
          return null;
        }
      }
      if (!model) return null;
      const inst = model.clone(true);
      inst.traverse(c => {
        if (c.isMesh) {
          // Cover doesn't cast shadow either (consistent with walls)
          c.castShadow = false;
          c.receiveShadow = true;
          if (c.material && c.material.map && !c.material.bumpMap) {
            c.material.bumpMap = c.material.map;
            c.material.bumpScale = 0.08;
            c.material.needsUpdate = true;
          }
        }
      });
      return inst;
    };

    // Ritual ground decal (no Meshy substitute needed — texture is correct)
    const runeTex = loadTex('vfx_ground_rune_pulse', 1, 1);
    const ritualMat = new THREE.MeshBasicMaterial({
      map: runeTex,
      transparent: true, opacity: 0.7,
      side: THREE.DoubleSide, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    // Pools of Meshy GLB names per cover kind. Random pick per piece for
    // visual variety — no two pillar clusters look identical.
    const PILLAR_POOL = poolFor('pillar');
    const RUBBLE_POOL = poolFor('rubble');
    const ARCH_POOL   = poolFor('arch');

    for (const c of wing.cover) {
      const grp = new THREE.Group();
      grp.userData.coverId = c.id;
      grp.userData.coverKind = c.kind;

      if (c.kind === 'pillar_cluster') {
        for (let i = 0; i < c.pieceCount; i++) {
          const angle = (i / c.pieceCount) * Math.PI * 2 + c.rot;
          const r = 0.5 + Math.random() * (c.radius * 0.55);
          const px = Math.cos(angle) * r;
          const pz = Math.sin(angle) * r;
          const tag = PILLAR_POOL[Math.floor(Math.random() * PILLAR_POOL.length)];
          const pillar = await loadPropClone(tag);
          if (!pillar) continue;
          pillar.position.set(px, 0, pz);
          pillar.rotation.y = Math.random() * Math.PI * 2;
          pillar.scale.setScalar(0.9 + Math.random() * 0.4);
          grp.add(pillar);
        }
      } else if (c.kind === 'rubble_pile') {
        for (let i = 0; i < c.pieceCount; i++) {
          const angle = Math.random() * Math.PI * 2;
          const r = Math.random() * c.radius * 0.7;
          const px = Math.cos(angle) * r;
          const pz = Math.sin(angle) * r;
          const tag = RUBBLE_POOL[Math.floor(Math.random() * RUBBLE_POOL.length)];
          const chunk = await loadPropClone(tag);
          if (!chunk) continue;
          chunk.position.set(px, 0, pz);
          chunk.rotation.y = Math.random() * Math.PI * 2;
          chunk.scale.setScalar(0.7 + Math.random() * 0.5);
          grp.add(chunk);
        }
      } else if (c.kind === 'broken_arch') {
        const tag = ARCH_POOL[Math.floor(Math.random() * ARCH_POOL.length)];
        const arch = await loadPropClone(tag);
        if (arch) {
          arch.position.set(0, 0, 0);
          arch.rotation.y = Math.random() * 0.6;
          arch.scale.setScalar(1.2 + Math.random() * 0.3);
          grp.add(arch);
        }
      } else if (c.kind === 'ritual_circle') {
        // Painted decal (not a Meshy mesh — texture is correct here)
        const circle = new THREE.Mesh(
          new THREE.RingGeometry(c.radius * 0.35, c.radius, 32),
          ritualMat,
        );
        circle.rotation.x = -Math.PI / 2;
        circle.position.y = 0.03;
        circle.userData.isRitualCircle = true;
        grp.add(circle);
        const inner = new THREE.Mesh(
          new THREE.RingGeometry(c.radius * 0.15, c.radius * 0.32, 24),
          ritualMat,
        );
        inner.rotation.x = -Math.PI / 2;
        inner.position.y = 0.04;
        inner.userData.isRitualCircle = true;
        grp.add(inner);
      }

      grp.position.set(c.cx, 0, c.cz);
      grp.rotation.y = c.rot;
      this.group.add(grp);
    }
  }

  _buildFeatures(wing) {
    // DIAGNOSTIC: tally features the server sent. If you can't see a vendor
    // or puzzle in-game, check this console output to see if the server
    // even included one in the wing payload.
    const counts = {};
    for (const f of (wing?.features || [])) counts[f.kind] = (counts[f.kind] || 0) + 1;
    console.log('[Dungeon] _buildFeatures: wing.features =', wing?.features?.length || 0, counts);

    const INTERACTABLE_KINDS = new Set([
      'chest', 'lever', 'exit', 'blood_well', 'ritual_brazier',
      'ancient_idol', 'cursed_bell',
    ]);
    if (!this._interactGlowTex) {
      this._interactGlowTex = new THREE.TextureLoader().load(
        '/assets/art/vfx/vfx_interactable_glow.png',
        (tex) => { tex.colorSpace = THREE.SRGBColorSpace; },
      );
    }
    const addInteractGlow = (group, isConsumed) => {
      if (isConsumed) return; // Don't draw glow on consumed/used interactables.
      const geo = new THREE.PlaneGeometry(5, 5);
      const mat = new THREE.MeshBasicMaterial({
        map: this._interactGlowTex,
        transparent: true, depthWrite: false,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
      });
      const glow = new THREE.Mesh(geo, mat);
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.02; // just above the floor
      glow.userData.isInteractGlow = true;
      glow.userData.basePhase = Math.random() * Math.PI * 2;
      group.add(glow);
    };

    // Hazards. Placed by the server (server/dungeon/hazards.js) with explicit
    // coordinates, so unlike scattered decoration they render exactly where the
    // damage check happens — a hazard the player can't trust visually is worse
    // than none. The ground ring reads the phase the server sends each tick:
    // amber while telegraphing, hot red while active.
    if (!this._hazardNodes) this._hazardNodes = new Map();
    for (const f of wing.features) {
      if (!f.isHazard) continue;
      const group = new THREE.Group();
      group.position.set(f.cx, 0, f.cz);

      const ringGeo = new THREE.RingGeometry(0.6, 3.0, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffaa30, transparent: true, opacity: 0.0,
        side: THREE.DoubleSide, depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      group.add(ring);

      loadProp(f.kind).then((proto) => {
        if (!proto) return;
        const model = proto.clone(true);
        model.scale.setScalar(1.2);
        group.add(model);
      });

      this.group.add(group);
      this._hazardNodes.set(f.id, { group, ring, ringMat });
    }

    for (const f of wing.features) {
      if (f.isHazard) continue;
      if (f.kind === 'chest') {
        // Use Meshy treasure_chest_locked.glb (real sculpted asset). Rare
        // tier gets a brighter point light. Opened state can re-spawn with
        // a slight rotation/scale offset to suggest the lid is ajar.
        this._spawnMeshyChest(f, addInteractGlow);
      } else if (f.kind === 'ritual_brazier') {
        // Tall iron brazier — burns brighter once lit
        const grp = new THREE.Group();
        grp.userData.featureId = f.id;
        grp.userData.isBrazier = true;
        grp.userData.consumed = !!f.consumed;
        const stand = new THREE.Mesh(
          new THREE.CylinderGeometry(0.3, 0.5, 2.4, 8),
          new THREE.MeshStandardMaterial({ color: 0x1a1208, roughness: 0.6, metalness: 0.7 }),
        );
        stand.position.y = 1.2;
        grp.add(stand);
        const bowl = new THREE.Mesh(
          new THREE.CylinderGeometry(0.9, 0.6, 0.5, 12),
          new THREE.MeshStandardMaterial({ color: 0x2a1c10, roughness: 0.7, metalness: 0.55 }),
        );
        bowl.position.y = 2.6;
        grp.add(bowl);
        const flame = new THREE.Mesh(
          new THREE.SphereGeometry(0.7, 12, 10),
          new THREE.MeshBasicMaterial({ color: f.consumed ? 0xff6018 : 0xc8884a }),
        );
        flame.position.y = 3.3;
        flame.userData.isBrazierFlame = true;
        grp.add(flame);
        const light = new THREE.PointLight(f.consumed ? 0xff7022 : 0x886030, f.consumed ? 4 : 1.2, 16, 2);
        light.position.y = 3.5;
        light.userData.isBrazierLight = true;
        grp.add(light);
        grp.position.set(f.cx, 0, f.cz);
        addInteractGlow(grp, !!f.consumed);
        this.group.add(grp);
      } else if (f.kind === 'ancient_idol') {
        const grp = new THREE.Group();
        grp.userData.featureId = f.id;
        grp.userData.isIdol = true;
        grp.userData.consumed = !!f.consumed;
        const body = new THREE.Mesh(
          new THREE.BoxGeometry(0.9, 2.6, 0.6),
          new THREE.MeshStandardMaterial({ color: 0x3a3028, roughness: 0.95, metalness: 0.05 }),
        );
        body.position.y = 1.3;
        grp.add(body);
        const head = new THREE.Mesh(
          new THREE.SphereGeometry(0.45, 10, 8),
          new THREE.MeshStandardMaterial({ color: 0x3a3028, roughness: 0.95 }),
        );
        head.position.y = 2.85;
        grp.add(head);
        // Glowing rune at chest
        const rune = new THREE.Mesh(
          new THREE.RingGeometry(0.18, 0.28, 16),
          new THREE.MeshBasicMaterial({
            color: f.consumed ? 0x666666 : 0xffd060,
            transparent: true, opacity: 0.85, side: THREE.DoubleSide,
          }),
        );
        rune.position.set(0, 1.6, 0.31);
        rune.userData.isIdolRune = true;
        grp.add(rune);
        // Idol PointLight removed — the emissive rune material below
        // already reads as a glow without adding a per-fragment light cost.
        grp.position.set(f.cx, 0, f.cz);
        addInteractGlow(grp, !!f.consumed);
        this.group.add(grp);
      } else if (f.kind === 'cursed_bell') {
        const grp = new THREE.Group();
        grp.userData.featureId = f.id;
        grp.userData.isBell = true;
        grp.userData.consumed = !!f.consumed;
        // Stone arch
        const archMat = new THREE.MeshStandardMaterial({ color: 0x2a221a, roughness: 0.85, metalness: 0.3 });
        const post1 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4, 0.4), archMat);
        post1.position.set(-0.8, 2, 0); grp.add(post1);
        const post2 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4, 0.4), archMat);
        post2.position.set(0.8, 2, 0); grp.add(post2);
        const beam = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.4, 0.4), archMat);
        beam.position.set(0, 4, 0); grp.add(beam);
        // The bell
        const bell = new THREE.Mesh(
          new THREE.ConeGeometry(0.6, 1.0, 12, 1, true),
          new THREE.MeshStandardMaterial({ color: 0x2a1208, roughness: 0.5, metalness: 0.85,
            emissive: f.consumed ? 0x000000 : 0x440000, emissiveIntensity: f.consumed ? 0 : 0.4 }),
        );
        bell.position.set(0, 3, 0);
        bell.rotation.x = Math.PI;
        bell.userData.isBellMesh = true;
        grp.add(bell);
        // Bell PointLight removed — emissive bell material provides the
        // visual glow without the per-fragment light cost.
        grp.position.set(f.cx, 0, f.cz);
        addInteractGlow(grp, !!f.consumed);
        this.group.add(grp);
      } else if (f.kind === 'vendor') {
        console.log('[Dungeon] Spawning vendor at', f.cx, f.cz, 'isStarter=', f.isStarter);
        this._spawnMeshyVendor(f, addInteractGlow);
      } else if (f.kind === 'puzzle_shrine') {
        // Puzzle shrine — uses skull_idol Meshy GLB with a teal glow ring
        // so it visually differs from the ancient_idol prop.
        this._spawnMeshyShrine(f, addInteractGlow);
      } else if (f.kind === 'blood_well') {
        const well = new THREE.Group();
        well.userData.featureId = f.id;
        well.userData.isBloodWell = true;
        well.userData.fill = f.fill || 0;
        well.userData.consumed = !!f.consumed;
        // Stone basin
        const basin = new THREE.Mesh(
          new THREE.CylinderGeometry(1.4, 1.6, 0.8, 16),
          new THREE.MeshStandardMaterial({ color: 0x2a221a, roughness: 0.85, metalness: 0.4 }),
        );
        basin.position.y = 0.4;
        well.add(basin);
        // Blood pool inside (scales with fill)
        const blood = new THREE.Mesh(
          new THREE.CylinderGeometry(1.2, 1.2, 0.1, 16),
          new THREE.MeshBasicMaterial({ color: 0x8a0010, transparent: true, opacity: 0.95 }),
        );
        blood.position.y = 0.45;
        blood.userData.isWellBlood = true;
        well.add(blood);
        // Well PointLight removed — the additive blood-pool mesh + interact
        // glow ring carry the visual fine and we need the light budget for
        // chamber torches.
        well.position.set(f.cx, 0, f.cz);
        addInteractGlow(well, !!f.consumed);
        this.group.add(well);
      } else if (f.kind === 'lever') {
        const lever = new THREE.Group();
        lever.userData.featureId = f.id;
        lever.userData.isLever = true;
        lever.userData.activated = !!f.activated;
        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.4, 0.5, 1.6, 8),
          new THREE.MeshStandardMaterial({ color: 0x2a1a0e, roughness: 0.85, metalness: 0.4 }),
        );
        post.position.set(0, 0.8, 0);
        lever.add(post);
        const handle = new THREE.Mesh(
          new THREE.CylinderGeometry(0.06, 0.06, 1.0, 6),
          new THREE.MeshStandardMaterial({ color: 0x6a4020, metalness: 0.6, roughness: 0.4 }),
        );
        handle.position.set(0, 1.6, f.activated ? -0.4 : 0.4);
        handle.rotation.z = Math.PI / 2;
        handle.rotation.x = f.activated ? -Math.PI / 4 : Math.PI / 4;
        lever.add(handle);
        const rune = new THREE.Mesh(
          new THREE.RingGeometry(0.5, 0.7, 16),
          new THREE.MeshBasicMaterial({ color: f.activated ? 0x44ff44 : 0xff4422, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
        );
        rune.rotation.x = -Math.PI / 2;
        rune.position.set(0, 0.05, 0);
        rune.userData.isLeverRune = true;
        lever.add(rune);
        // Lever PointLight removed — emissive rune ring + the beacon column
        // below provide the visual without the per-fragment light cost.
        // Vertical beacon column visible from across the chamber when the
        // lever is unpulled — fades the moment it's activated. Helps the
        // player find the hidden-passage trigger without a UI hint.
        if (!f.activated) {
          const beaconMat = new THREE.MeshBasicMaterial({
            color: 0xff3322, transparent: true, opacity: 0.35,
            blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
          });
          const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.2, 14, 12, 1, true), beaconMat);
          beacon.position.set(0, 7, 0);
          beacon.userData.isLeverBeacon = true;
          lever.add(beacon);
        }
        lever.position.set(f.cx, 0, f.cz);
        this.group.add(lever);
      }
    }
  }

  /** Spawn a single loot chest mid-run (e.g. after a pack clears). Builds the
   *  same procedural chest as _buildFeatures and adds a tall pickup beam VFX
   *  so the player notices the drop from across the room. */
  /** Spawn a small dust puff at the player's feet (called while running).
   *  Single billboard sprite with a quick fade-out + slight outward expand.
   *  Throttled by the caller. */
  /**
   * Drive hazard visuals from server phase. Called each tick with the `hz`
   * array in the state payload — the server owns the phase, the client only
   * renders it, so the warning a player sees can never disagree with the
   * damage check.
   */
  setHazardPhases(states) {
    if (!this._hazardNodes || !states?.length) return;
    for (const s of states) {
      const node = this._hazardNodes.get(s.id);
      if (!node) continue;
      if (s.phase === 'telegraph') {
        node.ringMat.color.setHex(0xffaa30);
        node.ringMat.opacity = 0.55;
      } else if (s.phase === 'active') {
        node.ringMat.color.setHex(0xff2010);
        node.ringMat.opacity = 0.95;
      } else {
        node.ringMat.opacity = 0.0;
      }
    }
  }

  spawnStepDust(x, z) {
    if (!this.group) return;
    if (!this._dustTex) {
      this._dustTex = new THREE.TextureLoader().load('/assets/art/vfx/vfx_dust_cloud.png');
    }
    const mat = new THREE.MeshBasicMaterial({
      map: this._dustTex,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      side: THREE.DoubleSide,
      color: 0xa89878,
    });
    const puff = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), mat);
    // Spawn slightly behind the player so it reads as kicked-up dust
    puff.position.set(x, 0.15, z);
    puff.rotation.x = -Math.PI / 2;
    puff.rotation.z = Math.random() * Math.PI * 2;
    puff.userData.isStepDust = true;
    puff.userData.startTime = performance.now();
    this.group.add(puff);
    (this._transientFX = this._transientFX || []).push(puff);
  }

  /** Break any destructible props within `radius` of (x, z) — called by main.js
   *  when a player swings near them or runs through. Plays a debris VFX +
   *  removes the prop. Cheap and satisfying. */
  breakDestructiblesNear(x, z, radius = 2.5) {
    if (!this.group) return [];
    const broken = [];
    const toBreak = [];
    // Performance limit: never break more than 3 in a single call. Avoids
    // a multi-prop lag spike if the player walks through a cluster.
    this.group.traverse(node => {
      if (!node.userData?.isDestructible) return;
      if (toBreak.length >= 3) return;
      const dx = node.position.x - x;
      const dz = node.position.z - z;
      if (dx * dx + dz * dz <= radius * radius) {
        toBreak.push(node);
      }
    });
    for (const node of toBreak) {
      // Debris VFX: spawn 5-8 small rubble cubes flying upward from the prop's
      // position, then fade and remove after 1.2s
      const px = node.position.x;
      const pz = node.position.z;
      const rubbleMat = new THREE.MeshStandardMaterial({
        color: 0x6a5a48, roughness: 0.95, metalness: 0.0,
      });
      // Reduced from 6-8 to 4 to lower per-break GC pressure
      const debrisCount = 4;
      const startTime = performance.now();
      for (let i = 0; i < debrisCount; i++) {
        const piece = new THREE.Mesh(
          new THREE.BoxGeometry(0.25 + Math.random() * 0.2, 0.2 + Math.random() * 0.15, 0.25 + Math.random() * 0.2),
          rubbleMat,
        );
        piece.position.set(px, 0.6, pz);
        piece.userData.isDebris = true;
        piece.userData.startTime = startTime;
        piece.userData.velocity = {
          x: (Math.random() - 0.5) * 3,
          y: 2 + Math.random() * 2,
          z: (Math.random() - 0.5) * 3,
        };
        piece.userData.angVel = {
          x: (Math.random() - 0.5) * 4,
          y: (Math.random() - 0.5) * 4,
          z: (Math.random() - 0.5) * 4,
        };
        this.group.add(piece);
        (this._transientFX = this._transientFX || []).push(piece);
      }
      broken.push(node.userData.destructibleId);
      this.group.remove(node);
      // Dispose meshes inside the cloned prop to free GPU memory
      node.traverse(c => { if (c.isMesh) { c.geometry?.dispose?.(); /* shared material — don't dispose */ } });
    }
    return broken;
  }

  /** Spawn the Meshy treasure_chest_locked GLB at the chest feature position.
   *  Rare chests get a brighter glow + larger scale. Used by both initial
   *  wing-spawn chests and per-pack-clear loot drop chests. */
  async _spawnMeshyChest(f, addInteractGlow) {
    if (!this._propLoader) {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      this._propLoader = new GLTFLoader();
    }
    if (!this._propCache) this._propCache = new Map();
    const tag = 'treasure_chest_locked';
    let chestModel = this._propCache.get(tag);
    if (chestModel === undefined) {
      this._propCache.set(tag, null);
      try {
        const gltf = await new Promise((res, rej) =>
          this._propLoader.load(`/assets/models/props/${tag}.glb`, res, undefined, rej));
        this._propCache.set(tag, gltf.scene);
        chestModel = gltf.scene;
      } catch {
        this._propCache.set(tag, null);
      }
    }
    const chest = new THREE.Group();
    chest.userData.featureId = f.id;
    chest.userData.isChest = true;
    chest.userData.opened = !!f.opened;
    if (chestModel) {
      const inst = chestModel.clone(true);
      inst.traverse(c => {
        if (c.isMesh) {
          c.castShadow = false;
          c.receiveShadow = true;
          if (c.material && c.material.map && !c.material.bumpMap) {
            c.material.bumpMap = c.material.map;
            c.material.bumpScale = 0.08;
            c.material.needsUpdate = true;
          }
          // Rare tier: brighten emissive so chest glows visibly
          if (c.material && f.tier === 'rare') {
            c.material.emissive = new THREE.Color(0xff8810);
            c.material.emissiveIntensity = 0.4;
            c.material.needsUpdate = true;
          }
        }
      });
      // Boost scale and tilt the lid slightly if already opened
      const scale = f.tier === 'rare' ? 1.6 : 1.3;
      inst.scale.setScalar(scale);
      // PERF/visual: Meshy chest origin is often at the geometric center,
      // not the bottom. Without raising Y the bottom sinks into the floor.
      // Raise by ~half the chest's scaled height (chest is ~1u tall in GLB).
      inst.position.y = 0.5 * scale;
      if (f.opened) {
        inst.position.y = 0.5 * scale + 0.15;
        inst.rotation.x = -0.12;
      }
      chest.add(inst);
    } else {
      // Fallback procedural chest while GLB loads
      const matBody = new THREE.MeshStandardMaterial({
        color: f.tier === 'rare' ? 0xc89030 : 0x8a6a3a,
        roughness: 0.5, metalness: 0.7,
        emissive: f.tier === 'rare' ? 0xff8810 : 0x402010,
        emissiveIntensity: 0.4,
      });
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.0, 1.0), matBody);
      base.position.set(0, 0.5, 0);
      chest.add(base);
    }
    // Glow light (always added)
    const glow = new THREE.PointLight(f.tier === 'rare' ? 0xffaa30 : 0xff8830, 2.5, 10, 2);
    glow.position.set(0, 1.2, 0);
    chest.add(glow);
    chest.position.set(f.cx, 0, f.cz);
    if (addInteractGlow) addInteractGlow(chest, !!f.opened);
    this.group.add(chest);
  }

  /** Build a Meshy vendor NPC — uses guardian_statue GLB tinted gold with
   *  emissive glow. Stationary "merchant statue" in the boss-wing entry hall. */
  async _spawnMeshyVendor(f, addInteractGlow) {
    console.log('[Dungeon] VENDOR spawning at', f.cx, f.cz, 'isStarter=', !!f.isStarter);

    // Use the freshly-generated Meshy GLB (merchant_crucible) — a hooded
    // skeleton shopkeeper behind a counter. Distinct from any furniture
    // prop so the player can tell at a glance "this is the merchant."
    if (!this._propLoader) {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      this._propLoader = new GLTFLoader();
    }
    if (!this._propCache) this._propCache = new Map();
    const tag = 'merchant_crucible';
    let model = this._propCache.get(tag);
    if (model === undefined) {
      this._propCache.set(tag, null);
      try {
        const gltf = await new Promise((res, rej) =>
          this._propLoader.load(`/assets/models/props/${tag}.glb`, res, undefined, rej));
        gltf.scene.traverse(c => {
          if (c.isMesh) {
            c.castShadow = false;
            c.receiveShadow = true;
            if (c.material?.map && !c.material.bumpMap) {
              c.material.bumpMap = c.material.map;
              c.material.bumpScale = 0.1;
              c.material.needsUpdate = true;
            }
          }
        });
        const wrapper = new THREE.Group();
        wrapper.add(gltf.scene);
        const bbox = new THREE.Box3().setFromObject(wrapper);
        if (isFinite(bbox.min.y)) gltf.scene.position.y -= bbox.min.y;
        this._propCache.set(tag, wrapper);
        model = wrapper;
      } catch (e) {
        console.warn('[Dungeon] merchant_crucible GLB failed, falling back to procedural', e);
        this._propCache.set(tag, null);
      }
    }
    const grp = new THREE.Group();
    grp.userData.featureId = f.id;
    grp.userData.isVendor = true;
    if (model) {
      const inst = model.clone();
      inst.scale.setScalar(2.5); // tall enough to read at distance
      grp.add(inst);
    }
    // Subtle gold halo above the merchant — visible at distance but no
    // longer a giant in-your-face beacon column.
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 12, 8),
      new THREE.MeshBasicMaterial({
        color: 0xffd060, transparent: true, opacity: 0.5,
        toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    halo.position.y = 3.5;
    halo.userData.isVendorSigil = true;
    grp.add(halo);
    const glow = new THREE.PointLight(0xffd060, 2.5, 14, 2);
    glow.position.y = 3;
    grp.add(glow);

    grp.position.set(f.cx, 0, f.cz);
    if (addInteractGlow) addInteractGlow(grp, false);
    this.group.add(grp);
  }

  /** Debug marker too — same pattern as vendor.
   *  Procedural puzzle shrine — replaces the async Meshy skull_idol load
   *  (which was sometimes invisible if the GLB didn't load in time).
   *  A dark obelisk with a glowing teal floating crystal on top + a tall
   *  teal beacon column visible from across the wing. Unambiguous "puzzle
   *  here" signal. */
  async _spawnMeshyShrine(f, addInteractGlow) {
    console.log('[Dungeon] PUZZLE spawning at', f.cx, f.cz, 'type=', f.puzzleType);

    // Use the freshly-generated Meshy GLB (puzzle_obelisk) — a 4-glyph
    // arcane obelisk with floating crystal. Distinct from any worship idol.
    if (!this._propLoader) {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      this._propLoader = new GLTFLoader();
    }
    if (!this._propCache) this._propCache = new Map();
    const tag = 'puzzle_obelisk';
    let model = this._propCache.get(tag);
    if (model === undefined) {
      this._propCache.set(tag, null);
      try {
        const gltf = await new Promise((res, rej) =>
          this._propLoader.load(`/assets/models/props/${tag}.glb`, res, undefined, rej));
        gltf.scene.traverse(c => {
          if (c.isMesh) {
            c.castShadow = false;
            c.receiveShadow = true;
            if (c.material) {
              c.material.emissive = new THREE.Color(0x30aaff);
              c.material.emissiveIntensity = 0.4;
              if (c.material.map && !c.material.bumpMap) {
                c.material.bumpMap = c.material.map;
                c.material.bumpScale = 0.08;
              }
              c.material.needsUpdate = true;
            }
          }
        });
        const wrapper = new THREE.Group();
        wrapper.add(gltf.scene);
        const bbox = new THREE.Box3().setFromObject(wrapper);
        if (isFinite(bbox.min.y)) gltf.scene.position.y -= bbox.min.y;
        this._propCache.set(tag, wrapper);
        model = wrapper;
      } catch (e) {
        console.warn('[Dungeon] puzzle_obelisk GLB failed, falling back to procedural', e);
        this._propCache.set(tag, null);
      }
    }
    const grp = new THREE.Group();
    grp.userData.featureId = f.id;
    grp.userData.isShrine = true;
    grp.userData.consumed = !!f.consumed;
    if (model) {
      const inst = model.clone();
      inst.scale.setScalar(2.0);
      grp.add(inst);
    }
    if (!f.consumed) {
      // Subtle teal halo above the obelisk
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 12, 8),
        new THREE.MeshBasicMaterial({
          color: 0x30ccff, transparent: true, opacity: 0.55,
          toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false,
        }),
      );
      halo.position.y = 4;
      halo.userData.isIdolRune = true;
      grp.add(halo);
      const glow = new THREE.PointLight(0x30aaff, 2.5, 14, 2);
      glow.position.y = 3.5;
      grp.add(glow);
    }
    grp.position.set(f.cx, 0, f.cz);
    if (addInteractGlow) addInteractGlow(grp, !!f.consumed);
    this.group.add(grp);
    this._buildPuzzleDecoration(f);
  }

  /** Ring of decorative props around a puzzle shrine that visually telegraph
   *  which puzzle type it is — so the player sees 4 unlit braziers and knows
   *  "I'll be putting these in some order" before they interact. Decoration
   *  only — solving is still through the modal. */
  _buildPuzzleDecoration(f) {
    if (!f || f.consumed || !f.puzzleType) return;
    const cx = f.cx, cz = f.cz;
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0x4a3a2a, roughness: 0.9, metalness: 0.08,
    });
    const tealMat = new THREE.MeshBasicMaterial({
      color: 0x30ccff, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const goldMat = new THREE.MeshBasicMaterial({
      color: 0xffd060, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });

    if (f.puzzleType === 'brazier_order') {
      // 4 unlit stone braziers in a row in front of the shrine.
      const stoneCol = new THREE.MeshStandardMaterial({
        color: 0x3a3028, roughness: 0.92, metalness: 0.08,
      });
      const colGeo = new THREE.CylinderGeometry(0.4, 0.5, 1.8, 8);
      const bowlGeo = new THREE.CylinderGeometry(0.55, 0.4, 0.4, 12);
      for (let i = 0; i < 4; i++) {
        const ox = (i - 1.5) * 1.8;
        const oz = -3.5;
        const col = new THREE.Mesh(colGeo, stoneCol);
        col.position.set(cx + ox, 0.9, cz + oz);
        this.group.add(col);
        const bowl = new THREE.Mesh(bowlGeo, stoneCol);
        bowl.position.set(cx + ox, 1.95, cz + oz);
        this.group.add(bowl);
        // Small teal sigil floating above each unlit brazier
        const sigil = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.4, 16), tealMat);
        sigil.rotation.x = -Math.PI / 2;
        sigil.position.set(cx + ox, 2.6, cz + oz);
        this.group.add(sigil);
      }
    } else if (f.puzzleType === 'pressure_plates') {
      // 4 stone pressure plates on the floor in front of the shrine,
      // numbered 1-4 (drawn as ring + dots in teal).
      for (let i = 0; i < 4; i++) {
        const ox = (i - 1.5) * 1.6;
        const oz = -3.5;
        const plate = new THREE.Mesh(
          new THREE.BoxGeometry(1.3, 0.15, 1.3),
          stoneMat,
        );
        plate.position.set(cx + ox, 0.075, cz + oz);
        this.group.add(plate);
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.55, 16), tealMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(cx + ox, 0.16, cz + oz);
        this.group.add(ring);
      }
    } else if (f.puzzleType === 'sacrifice_choice') {
      // 3 small altars in a row, each with a different colored offering glow.
      const altarMat = new THREE.MeshStandardMaterial({
        color: 0x3a2820, roughness: 0.85, metalness: 0.08,
      });
      const colors = [0xcc2020, 0x6622aa, 0xddaa44]; // blood, soul, flesh
      for (let i = 0; i < 3; i++) {
        const ox = (i - 1) * 2.0;
        const oz = -3.5;
        const altar = new THREE.Mesh(
          new THREE.BoxGeometry(1.0, 0.9, 1.0),
          altarMat,
        );
        altar.position.set(cx + ox, 0.45, cz + oz);
        this.group.add(altar);
        const offering = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.3, 0),
          new THREE.MeshBasicMaterial({
            color: colors[i], transparent: true, opacity: 0.85,
            blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
          }),
        );
        offering.position.set(cx + ox, 1.2, cz + oz);
        this.group.add(offering);
      }
    } else if (f.puzzleType === 'glyph_sequence') {
      // 6 short plinths in a half-circle, each with a different-colored glowing rune.
      const plinthGeo = new THREE.CylinderGeometry(0.4, 0.5, 1.2, 8);
      const glyphColors = [0xff6040, 0x88ccff, 0x6622aa, 0xffd700, 0x66ff80, 0xcc2020];
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i / 5) * Math.PI; // half-circle south of shrine
        const r = 3.2;
        const ox = Math.cos(a) * r;
        const oz = Math.sin(a) * r;
        const plinth = new THREE.Mesh(plinthGeo, stoneMat);
        plinth.position.set(cx + ox, 0.6, cz + oz);
        this.group.add(plinth);
        const rune = new THREE.Mesh(
          new THREE.RingGeometry(0.25, 0.4, 16),
          new THREE.MeshBasicMaterial({
            color: glyphColors[i], transparent: true, opacity: 0.85,
            blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
          }),
        );
        rune.rotation.x = -Math.PI / 2;
        rune.position.set(cx + ox, 1.3, cz + oz);
        this.group.add(rune);
      }
    }
  }

  spawnLootChest(f) {
    if (!f || f.kind !== 'chest') return;
    if (!this.group) return;
    // Fully synchronous spawn — chest template is procedural geometry +
    // shared materials, built once per session. Clone shares all
    // geometry/material refs; we push the two animated nodes
    // (isPickupBeam, isInteractGlow) into the existing anim cache
    // directly instead of invalidating it (a full retraverse of ~1500
    // scene nodes on the kill frame caused noticeable lag).
    this._preloadChestAssets();
    const tmpl = this._chestTemplate?.[f.tier === 'rare' ? 'rare' : 'common'];
    if (!tmpl) return;
    const chest = tmpl.clone();
    chest.userData.featureId = f.id;
    chest.userData.isChest = true;
    chest.userData.opened = false;
    chest.position.set(f.cx, 0, f.cz);
    this.group.add(chest);
    if (this._animCache) {
      chest.traverse((node) => {
        const ud = node.userData;
        if (!ud) return;
        if (ud.isPickupBeam) this._animCache.pickupBeam.push(node);
        if (ud.isInteractGlow) this._animCache.interactGlow.push(node);
      });
    }
  }

  _buildEmbersForBounds(bounds) {
    const count = 80;
    const positions = new Float32Array(count * 3);
    const lifetimes = new Float32Array(count);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * bounds.halfX * 1.8;
      positions[i * 3 + 1] = Math.random() * 6;
      positions[i * 3 + 2] = (Math.random() - 0.5) * bounds.halfZ * 1.8;
      lifetimes[i] = Math.random();
      speeds[i] = 0.3 + Math.random() * 0.4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xff7733, size: 0.18, transparent: true, opacity: 0.85,
      sizeAttenuation: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.userData.isEmbers = true;
    points.userData.lifetimes = lifetimes;
    points.userData.speeds = speeds;
    points.userData.bounds = bounds;
    this.group.add(points);
    this._embers = points;
  }

  _buildDustMotesForBounds(bounds) {
    const count = 50;
    const positions = new Float32Array(count * 3);
    const offsets = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * bounds.halfX * 1.9;
      positions[i * 3 + 1] = 1 + Math.random() * 12;
      positions[i * 3 + 2] = (Math.random() - 0.5) * bounds.halfZ * 1.9;
      offsets[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xc8b890, size: 0.08, transparent: true, opacity: 0.35,
      sizeAttenuation: true, depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.userData.isDust = true;
    points.userData.offsets = offsets;
    this.group.add(points);
    this._dust = points;
  }

  /** Add a glowing exit portal at the given world position. Uses the Meshy
   *  doorway_archway_runic.glb for the frame + a painted vfx_portal_swirl
   *  texture for the swirling vortex inside. Falls back to a stone archway
   *  if the GLB isn't loaded yet. */
  async addExitPortal(exit) {
    const portal = new THREE.Group();
    portal.userData.isExitPortal = true;
    portal.userData.featureId = exit.id;

    // ── Meshy archway frame ──────────────────────────────────────────
    if (!this._propLoader) {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      this._propLoader = new GLTFLoader();
    }
    if (!this._propCache) this._propCache = new Map();
    const archTag = 'doorway_archway_runic';
    let archModel = this._propCache.get(archTag);
    if (archModel === undefined) {
      this._propCache.set(archTag, null);
      try {
        const gltf = await new Promise((res, rej) =>
          this._propLoader.load(`/assets/models/props/${archTag}.glb`, res, undefined, rej));
        this._propCache.set(archTag, gltf.scene);
        archModel = gltf.scene;
      } catch {
        this._propCache.set(archTag, null);
      }
    }
    if (archModel) {
      // SHALLOW clone — geometry + materials shared by reference. Previously
      // we did clone(true) which deep-cloned all materials and traversed
      // every mesh to set bump maps on the fresh clones — same per-kill
      // lag spike pattern as the old chest spawn had.
      const arch = archModel.clone();
      arch.scale.setScalar(2.5);
      arch.rotation.y = Math.PI / 2;
      portal.add(arch);
    } else {
      // Fallback procedural archway if GLB hasn't loaded
      const frameMat = new THREE.MeshStandardMaterial({
        color: 0x2a221a, roughness: 0.7, metalness: 0.6,
        emissive: 0x442200, emissiveIntensity: 0.2,
      });
      const post1 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6, 0.8), frameMat);
      post1.position.set(0, 3, -1.5);
      portal.add(post1);
      const post2 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6, 0.8), frameMat);
      post2.position.set(0, 3, 1.5);
      portal.add(post2);
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 4), frameMat);
      lintel.position.set(0, 6.2, 0);
      portal.add(lintel);
    }

    // ── Painted swirl VFX inside the archway ─────────────────────────
    if (!this._portalSwirlTex) {
      const loader = new THREE.TextureLoader();
      this._portalSwirlTex = loader.load('/assets/art/vfx/vfx_portal_swirl.png');
      this._portalRunesTex = loader.load('/assets/art/vfx/vfx_portal_runes.png');
    }
    const swirlMat = new THREE.MeshBasicMaterial({
      map: this._portalSwirlTex,
      transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const swirl = new THREE.Mesh(new THREE.PlaneGeometry(4, 5.5), swirlMat);
    swirl.position.set(0, 3, 0);
    swirl.userData.isExitVortex = true;
    swirl.userData.basePhase = Math.random() * Math.PI * 2;
    portal.add(swirl);

    // Second rune layer rotating opposite direction
    const runesMat = new THREE.MeshBasicMaterial({
      map: this._portalRunesTex,
      transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const runes = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), runesMat);
    runes.position.set(0, 3, 0);
    runes.userData.isPortalRunes = true;
    portal.add(runes);

    // Bright point light pulled toward the swirl center
    const light = new THREE.PointLight(0xffd060, 5, 22, 2);
    light.position.set(0, 3, 0);
    light.userData.basePulse = 5;
    light.userData.isExitLight = true;
    portal.add(light);

    // Floor glow circle
    const ringGeo = new THREE.RingGeometry(2.4, 3.0, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffd060, transparent: true, opacity: 0.75,
      side: THREE.DoubleSide, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    ring.userData.isExitRing = true;
    portal.add(ring);

    portal.position.set(exit.cx, 0, exit.cz);
    this.group.add(portal);
  }

  /** Per-chamber prop scatter using thoughtful placement rules:
   *  - wall_hugging props (sarcophagi, hanging cages, braziers, banners) line the walls
   *  - cluster props (skulls, urns, bone piles) form 2-3 tight clusters
   *  - center props (broken pillars, ritual circles) sit in the chamber's interior
   *  This replaces uniform random scatter which made everything look randomly thrown around. */
  /** Perimeter rubble using InstancedMesh — ONE draw call for the entire
   *  perimeter regardless of block count. Skips doorway gaps so the player
   *  isn't blocked by stray cubes at gates. */
  _buildPerimeterRubbleInstanced(chamber) {
    if (!chamber || chamber.halfX < 6 || chamber.halfZ < 6) return;
    if (!this._sharedRubbleMat) {
      const tex = loadTex('tex_rubble_stone', 0.6, 0.6);
      this._sharedRubbleMat = new THREE.MeshStandardMaterial({
        map: tex, color: 0x4a3a2a, roughness: 0.95, metalness: 0.03,
      });
      this._sharedRubbleGeo = new THREE.BoxGeometry(1, 1, 1);
    }

    // Compute doorway zones (where rubble would block movement)
    const wing = this._currentWing;
    const doorways = [];
    if (wing) {
      const all = [...(wing.chambers || []), ...(wing.corridors || [])];
      const ranges = this._findAbuttingRanges(chamber, all);
      for (const [a, b] of (ranges.n || [])) doorways.push({ x: (a + b) / 2, z: chamber.cz + chamber.halfZ, halfW: (b - a) / 2 + 1 });
      for (const [a, b] of (ranges.s || [])) doorways.push({ x: (a + b) / 2, z: chamber.cz - chamber.halfZ, halfW: (b - a) / 2 + 1 });
      for (const [a, b] of (ranges.e || [])) doorways.push({ x: chamber.cx + chamber.halfX, z: (a + b) / 2, halfW: (b - a) / 2 + 1 });
      for (const [a, b] of (ranges.w || [])) doorways.push({ x: chamber.cx - chamber.halfX, z: (a + b) / 2, halfW: (b - a) / 2 + 1 });
    }
    const inGateway = (x, z) => {
      for (const d of doorways) {
        if ((x - d.x) ** 2 + (z - d.z) ** 2 < (d.halfW + 1.5) ** 2) return true;
      }
      return false;
    };

    const countX = Math.floor(chamber.halfX * 0.3);
    const countZ = Math.floor(chamber.halfZ * 0.3);
    const maxTotal = (countX + countZ) * 2;
    if (maxTotal <= 0) return;
    const cN = chamber.cz + chamber.halfZ;
    const cS = chamber.cz - chamber.halfZ;
    const cE = chamber.cx + chamber.halfX;
    const cW = chamber.cx - chamber.halfX;
    // Buffer up the positions first so we can size the InstancedMesh exactly
    const positions = [];
    for (let i = 0; i < countX; i++) {
      const x = cW + (chamber.halfX * 2 * (i + 0.5)) / countX + (Math.random() - 0.5) * 0.8;
      const zN = cN - 0.3 + (Math.random() - 0.5) * 0.6;
      const zS = cS + 0.3 + (Math.random() - 0.5) * 0.6;
      if (!inGateway(x, zN)) positions.push({ x, z: zN });
      if (!inGateway(x, zS)) positions.push({ x, z: zS });
    }
    for (let i = 0; i < countZ; i++) {
      const z = cS + (chamber.halfZ * 2 * (i + 0.5)) / countZ + (Math.random() - 0.5) * 0.8;
      const xE = cE - 0.3 + (Math.random() - 0.5) * 0.6;
      const xW = cW + 0.3 + (Math.random() - 0.5) * 0.6;
      if (!inGateway(xE, z)) positions.push({ x: xE, z });
      if (!inGateway(xW, z)) positions.push({ x: xW, z });
    }
    if (!positions.length) return;
    const inst = new THREE.InstancedMesh(this._sharedRubbleGeo, this._sharedRubbleMat, positions.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    const s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    positions.forEach((pos, idx) => {
      const w = 0.6 + Math.random() * 1.4;
      const h = 0.4 + Math.random() * 0.9;
      const d = 0.6 + Math.random() * 1.0;
      e.set((Math.random() - 0.5) * 0.4, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.4);
      q.setFromEuler(e);
      p.set(pos.x, h / 2, pos.z);
      s.set(w, h, d);
      m.compose(p, q, s);
      inst.setMatrixAt(idx, m);
    });
    inst.instanceMatrix.needsUpdate = true;
    this.group.add(inst);
  }

  /** Interior obstacles — broken pillars + low sarcophagus blocks scattered
   *  through the chamber play area. Adds cover + Diablo "ruined hall" feel
   *  without procedural pillar-on-doorway issues. InstancedMesh so it's
   *  ONE draw call per type per chamber. */
  _buildInteriorObstacles(chamber) {
    if (!chamber || chamber.halfX < 8 || chamber.halfZ < 8) return;
    if (chamber.template === 'boss_arena' || chamber.template === 'boss') return;

    // Shared interior materials (built once per session)
    if (!this._sharedObstacleMats) {
      const carvedTex = loadTex('tex_carved_stone', 0.8, 0.8);
      this._sharedObstacleMats = {
        stone: new THREE.MeshStandardMaterial({
          map: carvedTex, color: 0x5a4a36, roughness: 0.92, metalness: 0.05,
        }),
      };
      this._brokenPillarGeo = new THREE.CylinderGeometry(0.55, 0.7, 2.2, 8);
      this._sarcophagusGeo = new THREE.BoxGeometry(2.4, 1.0, 1.1);
    }
    const stoneMat = this._sharedObstacleMats.stone;

    // Doorway zones to avoid
    const wing = this._currentWing;
    const doorways = [];
    if (wing) {
      const all = [...(wing.chambers || []), ...(wing.corridors || [])];
      const ranges = this._findAbuttingRanges(chamber, all);
      for (const [a, b] of (ranges.n || [])) doorways.push({ x: (a + b) / 2, z: chamber.cz + chamber.halfZ });
      for (const [a, b] of (ranges.s || [])) doorways.push({ x: (a + b) / 2, z: chamber.cz - chamber.halfZ });
      for (const [a, b] of (ranges.e || [])) doorways.push({ x: chamber.cx + chamber.halfX, z: (a + b) / 2 });
      for (const [a, b] of (ranges.w || [])) doorways.push({ x: chamber.cx - chamber.halfX, z: (a + b) / 2 });
    }
    const blocked = (x, z) => {
      // Block near doorways
      for (const d of doorways) {
        if ((x - d.x) ** 2 + (z - d.z) ** 2 < 25) return true;
      }
      // Block near chamber center (player spawn zone in some templates)
      if ((x - chamber.cx) ** 2 + (z - chamber.cz) ** 2 < 16) return true;
      return false;
    };

    // Pick 3-6 broken pillars + 1-3 sarcophagi positions
    const pillarTransforms = [];
    const sarcoTransforms = [];
    const targetPillars = 4 + Math.floor(Math.random() * 3);
    const targetSarcs = 1 + Math.floor(Math.random() * 3);
    let attempts = 0;
    const placed = [];
    const isClear = (x, z, minDist) => {
      for (const p of placed) {
        if ((p.x - x) ** 2 + (p.z - z) ** 2 < minDist * minDist) return false;
      }
      return true;
    };
    while (pillarTransforms.length < targetPillars && attempts < 60) {
      attempts++;
      const x = chamber.cx + (Math.random() - 0.5) * (chamber.halfX * 2 - 6);
      const z = chamber.cz + (Math.random() - 0.5) * (chamber.halfZ * 2 - 6);
      if (blocked(x, z) || !isClear(x, z, 5)) continue;
      pillarTransforms.push({ x, z, rotY: Math.random() * Math.PI * 2, scale: 0.9 + Math.random() * 0.5 });
      placed.push({ x, z });
    }
    attempts = 0;
    while (sarcoTransforms.length < targetSarcs && attempts < 30) {
      attempts++;
      const x = chamber.cx + (Math.random() - 0.5) * (chamber.halfX * 2 - 6);
      const z = chamber.cz + (Math.random() - 0.5) * (chamber.halfZ * 2 - 6);
      if (blocked(x, z) || !isClear(x, z, 6)) continue;
      sarcoTransforms.push({ x, z, rotY: (Math.random() < 0.5 ? 0 : Math.PI / 2) + (Math.random() - 0.5) * 0.3 });
      placed.push({ x, z });
    }

    if (pillarTransforms.length) {
      const inst = new THREE.InstancedMesh(this._brokenPillarGeo, stoneMat, pillarTransforms.length);
      const m = new THREE.Matrix4(); const q = new THREE.Quaternion();
      const p = new THREE.Vector3(); const s = new THREE.Vector3(); const e = new THREE.Euler();
      pillarTransforms.forEach((t, i) => {
        e.set((Math.random() - 0.5) * 0.3, t.rotY, (Math.random() - 0.5) * 0.2);
        q.setFromEuler(e);
        p.set(t.x, 1.1 * t.scale, t.z);
        s.set(t.scale, t.scale, t.scale);
        m.compose(p, q, s);
        inst.setMatrixAt(i, m);
      });
      inst.instanceMatrix.needsUpdate = true;
      this.group.add(inst);
    }
    if (sarcoTransforms.length) {
      const inst = new THREE.InstancedMesh(this._sarcophagusGeo, stoneMat, sarcoTransforms.length);
      const m = new THREE.Matrix4(); const q = new THREE.Quaternion();
      const p = new THREE.Vector3(); const s = new THREE.Vector3(); const e = new THREE.Euler();
      sarcoTransforms.forEach((t, i) => {
        e.set(0, t.rotY, 0);
        q.setFromEuler(e);
        p.set(t.x, 0.5, t.z);
        s.set(1, 1, 1);
        m.compose(p, q, s);
        inst.setMatrixAt(i, m);
      });
      inst.instanceMatrix.needsUpdate = true;
      this.group.add(inst);
    }
  }

  /** Mulberry32 deterministic RNG — same chamber id => same layout every
   *  time. Hash the chamber id into a numeric seed. */
  _seededRng(chamberId) {
    let h = 2166136261;
    for (let i = 0; i < (chamberId || '').length; i++) {
      h ^= chamberId.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    let a = h >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Build castle-style furniture for a chamber. Prefers a hand-authored
   *  layout from ChamberLayouts.js keyed on the chamber's template id.
   *  Falls back to categorized procedural scatter if no authored layout
   *  exists for that template. Each prop loaded once and cloned. */
  async _buildChamberFurniture(chamber, wing) {
    if (!chamber || chamber.halfX < 6 || chamber.halfZ < 6) return;

    // ── Authored layout path ────────────────────────────────────────────
    const { CHAMBER_LAYOUTS } = await import('./ChamberLayouts.js');
    const layout = CHAMBER_LAYOUTS[chamber.template];
    if (layout) {
      if (!this._propLoader) {
        const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
        this._propLoader = new GLTFLoader();
      }
      if (!this._propCache) this._propCache = new Map();
      const loadPropTemplate = async (tag) => {
        let model = this._propCache.get(tag);
        if (model === undefined) {
          this._propCache.set(tag, null);
          try {
            const gltf = await new Promise((res, rej) =>
              this._propLoader.load(`/assets/models/props/${tag}.glb`, res, undefined, rej));
            gltf.scene.traverse(c => {
              if (c.isMesh) {
                c.castShadow = false;
                c.receiveShadow = true;
                if (c.material?.map && !c.material.bumpMap) {
                  c.material.bumpMap = c.material.map;
                  c.material.bumpScale = 0.08;
                  c.material.needsUpdate = true;
                }
              }
            });
            const wrapper = new THREE.Group();
            wrapper.add(gltf.scene);
            const bbox = new THREE.Box3().setFromObject(wrapper);
            if (isFinite(bbox.min.y)) {
              gltf.scene.position.y -= bbox.min.y;
            }
            this._propCache.set(tag, wrapper);
            model = wrapper;
          } catch {
            this._propCache.set(tag, null);
            return null;
          }
        }
        return model;
      };
      // Parallel preload then synchronous placement
      const uniqueTags = [...new Set(layout.pieces.map(p => p.tag))];
      await Promise.all(uniqueTags.map(t => loadPropTemplate(t)));
      for (const p of layout.pieces) {
        const model = this._propCache.get(p.tag);
        if (!model) continue;
        const inst = model.clone();
        inst.position.set(chamber.cx + p.x, (chamber.elevation || 0) + (p.y || 0), chamber.cz + p.z);
        inst.rotation.y = p.rotY || 0;
        inst.scale.setScalar(p.scale || 1);
        this.group.add(inst);
      }
      // Authored lighting recipe
      if (layout.lighting) {
        if (layout.lighting.ambient) {
          const hemi = new THREE.HemisphereLight(
            layout.lighting.ambient.color,
            0x181010,
            layout.lighting.ambient.intensity,
          );
          hemi.position.set(chamber.cx, 30, chamber.cz);
          this.group.add(hemi);
        }
        // Accent PointLights — capped at 4 GLOBAL (across all chambers in
        // this wing). Forward rendering scales linearly per light and the
        // previous unbounded count (16-28 with 4 chambers) was the single
        // largest FPS hit in the dungeon. The ambient hemisphere + torches
        // + emissive accent materials provide the visual punch without
        // adding to the per-fragment light loop.
        if (!this._accentLightCount) this._accentLightCount = 0;
        const ACCENT_LIGHT_BUDGET = 4;
        for (const a of (layout.lighting.accents || [])) {
          if (this._accentLightCount >= ACCENT_LIGHT_BUDGET) break;
          const light = new THREE.PointLight(
            a.color, a.intensity, a.range, 2,
          );
          light.position.set(chamber.cx + a.x, a.y, chamber.cz + a.z);
          this.group.add(light);
          this._accentLightCount++;
        }
      }
      // Mark this chamber as "authored" so _buildAmbientLighting doesn't
      // double-stack a chamber fill light on top of the authored accents.
      if (!this._authoredChambers) this._authoredChambers = new Set();
      this._authoredChambers.add(chamber.id || `${chamber.cx},${chamber.cz}`);
      console.log(`[Dungeon] Authored layout for ${chamber.template}: ${layout.pieces.length} pieces`);
      return;
    }
    // ── Procedural fallback (unchanged for templates without a layout) ──

    // Lazy-load GLTFLoader + prop cache
    if (!this._propLoader) {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      this._propLoader = new GLTFLoader();
    }
    if (!this._propCache) this._propCache = new Map();

    // Async loader returns a cloneable model from cache. NORMALIZES the
    // model's vertical pivot so the bottom of its bounding box sits at y=0
    // — Meshy GLBs have varied pivot conventions (some at center, some at
    // bottom), causing half-buried-in-ground placements. We wrap the scene
    // in a Group offset by -boundingBox.min.y so callers can always place
    // at floor y=0 and the model stands correctly.
    const loadPropTemplate = async (tag) => {
      let model = this._propCache.get(tag);
      if (model === undefined) {
        this._propCache.set(tag, null);
        try {
          const gltf = await new Promise((res, rej) =>
            this._propLoader.load(`/assets/models/props/${tag}.glb`, res, undefined, rej));
          gltf.scene.traverse(c => {
            if (c.isMesh) {
              c.castShadow = false;
              c.receiveShadow = true;
              if (c.material?.map && !c.material.bumpMap) {
                c.material.bumpMap = c.material.map;
                c.material.bumpScale = 0.08;
                c.material.needsUpdate = true;
              }
            }
          });
          // Wrap in a Group so we can offset Y without mutating the scene root.
          // Compute bbox AFTER the traverse so any material/texture-driven
          // size factors are accounted for.
          const wrapper = new THREE.Group();
          wrapper.add(gltf.scene);
          const bbox = new THREE.Box3().setFromObject(wrapper);
          // Lift scene so its bottom is at y=0
          if (isFinite(bbox.min.y)) {
            gltf.scene.position.y -= bbox.min.y;
          }
          this._propCache.set(tag, wrapper);
          model = wrapper;
        } catch {
          this._propCache.set(tag, null);
          return null;
        }
      }
      return model;
    };

    // Castle furniture pools — derived from DungeonManifest so a newly
    // generated prop becomes placeable by declaring it there, instead of
    // needing a hand-edit in the right one of a dozen arrays here. That gap is
    // what left 27 generated props unreachable.
    const WALL_PROPS = poolFor('wall');
    const CORNER_PROPS = poolFor('corner');
    const CENTER_PROPS = poolFor('center');
    const SCATTER_PROPS = poolFor('scatter');
    const HANGING_PROPS = poolFor('hanging');

    const rng = this._seededRng(chamber.id || `${chamber.cx},${chamber.cz}`);
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];

    // Doorway zones to avoid blocking
    const doorways = [];
    if (wing) {
      const all = [...(wing.chambers || []), ...(wing.corridors || [])];
      const ranges = this._findAbuttingRanges(chamber, all);
      for (const [a, b] of (ranges.n || [])) doorways.push({ x: (a + b) / 2, z: chamber.cz + chamber.halfZ, r: (b - a) / 2 + 2 });
      for (const [a, b] of (ranges.s || [])) doorways.push({ x: (a + b) / 2, z: chamber.cz - chamber.halfZ, r: (b - a) / 2 + 2 });
      for (const [a, b] of (ranges.e || [])) doorways.push({ x: chamber.cx + chamber.halfX, z: (a + b) / 2, r: (b - a) / 2 + 2 });
      for (const [a, b] of (ranges.w || [])) doorways.push({ x: chamber.cx - chamber.halfX, z: (a + b) / 2, r: (b - a) / 2 + 2 });
    }
    const blockedByDoor = (x, z) => {
      for (const d of doorways) {
        if ((x - d.x) ** 2 + (z - d.z) ** 2 < d.r * d.r) return true;
      }
      return false;
    };

    const placed = [];
    const isClear = (x, z, minDist) => {
      for (const p of placed) {
        if ((p.x - x) ** 2 + (p.z - z) ** 2 < minDist * minDist) return false;
      }
      return true;
    };

    // Tracks all placements for the renderer to add
    const placements = []; // [{ tag, x, z, y, rotY, scale }]

    // ── 1) Center hero piece (only if chamber has no other feature there)
    // Skip if a feature (puzzle/blood-well/etc.) is already at chamber center.
    const hasCenterFeature = (wing?.features || []).some(f =>
      Math.abs(f.cx - chamber.cx) < 3 && Math.abs(f.cz - chamber.cz) < 3
    );
    if (!hasCenterFeature) {
      placements.push({
        tag: pick(CENTER_PROPS),
        x: chamber.cx, z: chamber.cz, y: 0,
        rotY: rng() * Math.PI * 2,
        scale: 1.4 + rng() * 0.3,
      });
      placed.push({ x: chamber.cx, z: chamber.cz });
    }

    // ── 2) 4 corner pillars (cheap silhouette anchors, also skip doorways)
    const inset = 2.5;
    const corners = [
      { x: chamber.cx - chamber.halfX + inset, z: chamber.cz - chamber.halfZ + inset },
      { x: chamber.cx + chamber.halfX - inset, z: chamber.cz - chamber.halfZ + inset },
      { x: chamber.cx + chamber.halfX - inset, z: chamber.cz + chamber.halfZ - inset },
      { x: chamber.cx - chamber.halfX + inset, z: chamber.cz + chamber.halfZ - inset },
    ];
    for (const c of corners) {
      if (blockedByDoor(c.x, c.z)) continue;
      placements.push({
        tag: pick(CORNER_PROPS),
        x: c.x, z: c.z, y: 0,
        rotY: rng() * Math.PI * 2,
        scale: 1.6 + rng() * 0.3,
      });
      placed.push({ x: c.x, z: c.z });
    }

    // ── 3) Wall-hugging props — 5-9 along the perimeter, evenly spaced.
    // Pick a different prop type per placement so it doesn't read as repetitive.
    const wallCount = 5 + Math.floor(rng() * 5);
    const wallInset = 1.8;
    let wallAttempts = 0;
    let placedWall = 0;
    while (placedWall < wallCount && wallAttempts < 40) {
      wallAttempts++;
      const side = Math.floor(rng() * 4);
      let x, z, rotY;
      if (side === 0) {
        x = chamber.cx + (rng() - 0.5) * (chamber.halfX * 2 - 4);
        z = chamber.cz + chamber.halfZ - wallInset;
        rotY = Math.PI;
      } else if (side === 1) {
        x = chamber.cx + (rng() - 0.5) * (chamber.halfX * 2 - 4);
        z = chamber.cz - chamber.halfZ + wallInset;
        rotY = 0;
      } else if (side === 2) {
        x = chamber.cx + chamber.halfX - wallInset;
        z = chamber.cz + (rng() - 0.5) * (chamber.halfZ * 2 - 4);
        rotY = -Math.PI / 2;
      } else {
        x = chamber.cx - chamber.halfX + wallInset;
        z = chamber.cz + (rng() - 0.5) * (chamber.halfZ * 2 - 4);
        rotY = Math.PI / 2;
      }
      if (blockedByDoor(x, z)) continue;
      if (!isClear(x, z, 3)) continue;
      placements.push({
        tag: pick(WALL_PROPS),
        x, z, y: 0,
        rotY: rotY + (rng() - 0.5) * 0.3,
        scale: 1.1 + rng() * 0.3,
      });
      placed.push({ x, z });
      placedWall++;
    }

    // ── 4) Scatter clusters — 2-3 tight clusters of bones/urns/ash
    const clusterCount = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < clusterCount; i++) {
      const angle = rng() * Math.PI * 2;
      const r = Math.min(chamber.halfX, chamber.halfZ) * (0.35 + rng() * 0.25);
      const cx = chamber.cx + Math.cos(angle) * r;
      const cz = chamber.cz + Math.sin(angle) * r;
      const clusterSize = 2 + Math.floor(rng() * 3);
      for (let j = 0; j < clusterSize; j++) {
        const ja = rng() * Math.PI * 2;
        const jr = rng() * 1.4;
        const x = cx + Math.cos(ja) * jr;
        const z = cz + Math.sin(ja) * jr;
        if (blockedByDoor(x, z) || !isClear(x, z, 1.5)) continue;
        placements.push({
          tag: pick(SCATTER_PROPS),
          x, z, y: 0,
          rotY: rng() * Math.PI * 2,
          scale: 0.85 + rng() * 0.3,
        });
        placed.push({ x, z });
      }
    }

    // (Hanging ceiling props skipped — no ceiling in dungeon chambers.)

    // ── 6) Center pool-of-light point light (Diablo signature)
    if (chamber.template !== 'boss_arena' && chamber.template !== 'boss') {
      const light = new THREE.PointLight(0xffae50, 0.9, 14, 2.0);
      light.position.set(chamber.cx, 6.0, chamber.cz);
      this.group.add(light);
    }

    // PARALLEL preload of all unique GLBs FIRST so the props actually appear
    // when the room loads — previous version awaited each GLB sequentially
    // inside the for loop, which made the room sit empty for 10-20 seconds
    // while ~20 GLBs loaded one after another.
    const uniqueTags = [...new Set(placements.map(p => p.tag))];
    await Promise.all(uniqueTags.map(t => loadPropTemplate(t)));

    // Now place all props synchronously — every template is cached.
    let placedCount = 0;
    let missingCount = 0;
    for (const p of placements) {
      const model = this._propCache.get(p.tag);
      if (!model) {
        missingCount++;
        // Procedural fallback so something renders even if the GLB failed
        const fallback = new THREE.Mesh(
          new THREE.BoxGeometry(0.8, 1.4, 0.8),
          new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.9 }),
        );
        fallback.position.set(p.x, 0.7, p.z);
        fallback.rotation.y = p.rotY;
        this.group.add(fallback);
        continue;
      }
      const inst = model.clone();
      inst.position.set(p.x, p.y, p.z);
      inst.rotation.y = p.rotY;
      inst.scale.setScalar(p.scale);
      this.group.add(inst);
      placedCount++;
    }
    console.log(`[Dungeon] Furniture placed in ${chamber.id}: ${placedCount} props (${missingCount} fallback boxes)`);
  }

  /** Low rubble "perimeter" — broken stone blocks scattered along where the
   *  chamber's walls would have been. Knee-high so the camera can see over
   *  them, but visually defines "this is where the room ends." Shares one
   *  rubble material across all blocks (cheap). */
  _buildPerimeterRubble(chamber) {
    if (!chamber || chamber.halfX < 6 || chamber.halfZ < 6) return;
    const tex = loadTex('tex_rubble_stone', 0.6, 0.6);
    const mat = new THREE.MeshStandardMaterial({
      map: tex, color: 0x4a3a2a, roughness: 0.95, metalness: 0.03,
    });
    const blockGeo = new THREE.BoxGeometry(1, 1, 1);
    // Place blocks along the 4 edges. Density scales with edge length.
    const edgeBlock = (x, z) => {
      const w = 0.6 + Math.random() * 1.4;
      const h = 0.4 + Math.random() * 0.9;
      const d = 0.6 + Math.random() * 1.0;
      const b = new THREE.Mesh(blockGeo, mat);
      b.position.set(x, h / 2, z);
      b.scale.set(w, h, d);
      b.rotation.set(
        (Math.random() - 0.5) * 0.4,
        Math.random() * Math.PI * 2,
        (Math.random() - 0.5) * 0.4,
      );
      this.group.add(b);
    };
    const cN = chamber.cz + chamber.halfZ;
    const cS = chamber.cz - chamber.halfZ;
    const cE = chamber.cx + chamber.halfX;
    const cW = chamber.cx - chamber.halfX;
    // PERF: rubble density halved — was 0.8 → 0.3. Each block is a draw
    // call, and a typical 30u chamber edge produced 24 blocks (× 4 edges
    // × 4 chambers = 384 draw calls of rubble alone). 0.3 gives ~9 per
    // edge which still reads as broken stone perimeter.
    const countX = Math.floor(chamber.halfX * 0.3);
    const countZ = Math.floor(chamber.halfZ * 0.3);
    for (let i = 0; i < countX; i++) {
      const x = cW + (chamber.halfX * 2 * (i + 0.5)) / countX + (Math.random() - 0.5) * 0.8;
      edgeBlock(x, cN - 0.3 + (Math.random() - 0.5) * 0.6);
      edgeBlock(x, cS + 0.3 + (Math.random() - 0.5) * 0.6);
    }
    for (let i = 0; i < countZ; i++) {
      const z = cS + (chamber.halfZ * 2 * (i + 0.5)) / countZ + (Math.random() - 0.5) * 0.8;
      edgeBlock(cE - 0.3 + (Math.random() - 0.5) * 0.6, z);
      edgeBlock(cW + 0.3 + (Math.random() - 0.5) * 0.6, z);
    }
  }

  /** Add cheap Diablo-style architectural anchors to a chamber. Procedural
   *  CylinderGeometry pillars sharing ONE material across the whole chamber
   *  (no GLB clones) — corner pillars + side-wall pillars + center pool-of-
   *  light point light. Skips placements within doorway gaps so pillars
   *  never block movement through gates. */
  _buildChamberArchitecture(chamber, wing) {
    if (!chamber || chamber.halfX < 8 || chamber.halfZ < 8) return;

    const stoneTex = loadTex('wall_stone', 0.5, 1.0);
    const shaftMat = new THREE.MeshStandardMaterial({
      map: stoneTex, color: 0x6a5a4a, roughness: 0.95, metalness: 0.05,
      bumpMap: stoneTex, bumpScale: 0.10,
    });
    const capMat = new THREE.MeshStandardMaterial({
      map: stoneTex, color: 0x4a3a2a, roughness: 0.92, metalness: 0.08,
    });
    const shaftHeight = 8.5;
    const shaftGeo = new THREE.CylinderGeometry(0.65, 0.8, shaftHeight, 10);
    const capGeo = new THREE.BoxGeometry(1.8, 0.45, 1.8);
    const inset = 2.5;

    // Compute doorway exclusion zones: where the chamber abuts a corridor
    // or another chamber, skip pillars that would block movement.
    const doorways = [];
    if (wing) {
      const all = [...(wing.chambers || []), ...(wing.corridors || [])];
      const ranges = this._findAbuttingRanges(chamber, all);
      // ranges is { n: [[a,b]...], s, e, w } — convert to world points
      for (const [a, b] of (ranges.n || [])) doorways.push({ x: (a + b) / 2, z: chamber.cz + chamber.halfZ });
      for (const [a, b] of (ranges.s || [])) doorways.push({ x: (a + b) / 2, z: chamber.cz - chamber.halfZ });
      for (const [a, b] of (ranges.e || [])) doorways.push({ x: chamber.cx + chamber.halfX, z: (a + b) / 2 });
      for (const [a, b] of (ranges.w || [])) doorways.push({ x: chamber.cx - chamber.halfX, z: (a + b) / 2 });
    }
    const tooCloseToGate = (x, z) => {
      for (const d of doorways) {
        if ((x - d.x) ** 2 + (z - d.z) ** 2 < 16) return true; // 4u clearance
      }
      return false;
    };

    const placePillar = (x, z) => {
      if (tooCloseToGate(x, z)) return;
      const base = new THREE.Mesh(capGeo, capMat);
      base.position.set(x, 0.225, z);
      this.group.add(base);
      const shaft = new THREE.Mesh(shaftGeo, shaftMat);
      shaft.position.set(x, 0.45 + shaftHeight / 2, z);
      this.group.add(shaft);
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.set(x, 0.45 + shaftHeight + 0.225, z);
      this.group.add(cap);
    };

    // 4 corner pillars (each is checked against doorways)
    placePillar(chamber.cx - chamber.halfX + inset, chamber.cz - chamber.halfZ + inset);
    placePillar(chamber.cx + chamber.halfX - inset, chamber.cz - chamber.halfZ + inset);
    placePillar(chamber.cx + chamber.halfX - inset, chamber.cz + chamber.halfZ - inset);
    placePillar(chamber.cx - chamber.halfX + inset, chamber.cz + chamber.halfZ - inset);

    // Mid-wall pillars on long sides (large chambers only)
    if (chamber.halfX > 18) {
      placePillar(chamber.cx, chamber.cz - chamber.halfZ + inset);
      placePillar(chamber.cx, chamber.cz + chamber.halfZ - inset);
    }
    if (chamber.halfZ > 18) {
      placePillar(chamber.cx - chamber.halfX + inset, chamber.cz);
      placePillar(chamber.cx + chamber.halfX - inset, chamber.cz);
    }

    // Center pool-of-light — single warm point light. Adds vertical interest
    // by lighting the floor below from above ("god ray" without the broken
    // billboard look the old _buildLightCones / _buildGodRays had).
    if (chamber.template !== 'boss_arena' && chamber.template !== 'boss') {
      const light = new THREE.PointLight(0xffae50, 0.9, 14, 2.0);
      light.position.set(chamber.cx, 6.0, chamber.cz);
      this.group.add(light);
    }
  }

  async _buildChamberProps(chamber) {
    const { CHAMBER_TEMPLATES } = await import('../../server/dungeon/chambers.js')
      .catch(() => ({ CHAMBER_TEMPLATES: {} }));
    const tpl = CHAMBER_TEMPLATES[chamber.template];
    if (!tpl?.propTags?.length) return;
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    if (!this._propCache) this._propCache = new Map();
    if (!this._propLoader) this._propLoader = new GLTFLoader();

    // Classify props into placement categories — this is what makes the
    // environment feel intentional. Wall-hugging props line the perimeter,
    // cluster props form tight gatherings, center props anchor the middle.
    const WALL_HUGGING = new Set(poolFor('wall'));
    const CLUSTER = new Set(poolFor('cluster'));
    const CENTER = new Set(poolFor('center'));
    const PROP_ALIASES = {
      banners: 'fallen_banner',
      chains: 'iron_chains',
      torches: 'iron_brazier_tall',
      treasure_chest_open: 'treasure_chest_locked',
    };
    const placed = [];

    // Helper: load model + add instance at position with scale/rotation
    // Destructible prop tags — these can be broken by walking through or
    // attacking. Each break plays a small VFX + (occasionally) drops coins.
    const DESTRUCTIBLE = new Set(MANIFEST_DESTRUCTIBLE);
    // Cloth/banner props that get a subtle sway animation
    const CLOTH = new Set(MANIFEST_CLOTH);
    const placeProp = async (tag, x, z, scale = 1.2, rotY = null) => {
      const resolvedTag = PROP_ALIASES[tag] || tag;
      const url = `/assets/models/props/${resolvedTag}.glb`;
      let model = this._propCache.get(resolvedTag);
      if (model === undefined) {
        this._propCache.set(resolvedTag, null);
        try {
          const gltf = await new Promise((res, rej) => this._propLoader.load(url, res, undefined, rej));
          this._propCache.set(resolvedTag, gltf.scene);
          model = gltf.scene;
        } catch {
          this._propCache.set(resolvedTag, null);
          return;
        }
      }
      if (!model) return;
      const inst = model.clone(true);
      inst.traverse(c => {
        if (c.isMesh) {
          c.castShadow = true;
          c.receiveShadow = true;
          // Add procedural normal mapping to imported props too — many Meshy
          // GLBs only have diffuse textures. Re-use diffuse as bump.
          if (c.material && c.material.map && !c.material.bumpMap) {
            c.material.bumpMap = c.material.map;
            c.material.bumpScale = 0.10;
            c.material.needsUpdate = true;
          }
        }
      });
      inst.position.set(x, 0, z);
      inst.scale.setScalar(scale + Math.random() * 0.4);
      inst.rotation.y = rotY != null ? rotY : Math.random() * Math.PI * 2;
      if (DESTRUCTIBLE.has(resolvedTag)) {
        inst.userData.isDestructible = true;
        inst.userData.destructibleTag = resolvedTag;
        inst.userData.destructibleX = x;
        inst.userData.destructibleZ = z;
        inst.userData.destructibleId = `destr_${Math.floor(Math.random() * 1e9)}`;
      }
      if (CLOTH.has(resolvedTag)) {
        inst.userData.isCloth = true;
        inst.userData.clothPhase = Math.random() * Math.PI * 2;
      }
      this.group.add(inst);
      placed.push({ x, z });
    };

    const isClearOf = (x, z, minDist) => {
      for (const p of placed) {
        if ((p.x - x) ** 2 + (p.z - z) ** 2 < minDist * minDist) return false;
      }
      return true;
    };

    // ── 1) Wall-hugging props — line the perimeter
    const wallTags = tpl.propTags.filter(t => WALL_HUGGING.has(PROP_ALIASES[t] || t));
    for (const tag of wallTags) {
      // Was a flat 4..7 regardless of room size, which left a 96x84 chamber
      // essentially empty. Props were 15,000 triangles each when that number
      // was chosen; they are ~900 now, so density is affordable. Scaling by
      // wall length keeps small alcoves from being crammed.
      const perimeter = 2 * (chamber.halfX + chamber.halfZ) * 2;
      const count = Math.max(6, Math.min(26, Math.round(perimeter / 26)));
      for (let i = 0; i < count; i++) {
        // Pick a wall (N/S/E/W) and a position along it, 1.5u offset inward
        const wallChoice = Math.floor(Math.random() * 4);
        let x, z, rotY;
        const inset = 1.8;
        if (wallChoice === 0) { // North
          x = chamber.cx + (Math.random() - 0.5) * (chamber.halfX * 2 - 4);
          z = chamber.cz - chamber.halfZ + inset;
          rotY = 0;
        } else if (wallChoice === 1) { // South
          x = chamber.cx + (Math.random() - 0.5) * (chamber.halfX * 2 - 4);
          z = chamber.cz + chamber.halfZ - inset;
          rotY = Math.PI;
        } else if (wallChoice === 2) { // East
          x = chamber.cx + chamber.halfX - inset;
          z = chamber.cz + (Math.random() - 0.5) * (chamber.halfZ * 2 - 4);
          rotY = -Math.PI / 2;
        } else { // West
          x = chamber.cx - chamber.halfX + inset;
          z = chamber.cz + (Math.random() - 0.5) * (chamber.halfZ * 2 - 4);
          rotY = Math.PI / 2;
        }
        if (!isClearOf(x, z, 3)) continue;
        await placeProp(tag, x, z, 1.3, rotY + (Math.random() - 0.5) * 0.2);
      }
    }

    // ── 2) Cluster props — 2-3 tight clusters of bones/skulls/urns
    const clusterTags = tpl.propTags.filter(t => CLUSTER.has(PROP_ALIASES[t] || t));
    if (clusterTags.length) {
      const clusterCount = 2 + Math.floor(Math.random() * 2);
      for (let c = 0; c < clusterCount; c++) {
        // Cluster centers: between walls and center, distributed evenly
        const angle = (c / clusterCount) * Math.PI * 2 + Math.random() * 0.5;
        const r = (Math.min(chamber.halfX, chamber.halfZ)) * (0.4 + Math.random() * 0.25);
        const cx = chamber.cx + Math.cos(angle) * r;
        const cz = chamber.cz + Math.sin(angle) * r;
        // 3-5 props in each cluster, tight grouping
        const inCluster = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < inCluster; i++) {
          const ja = Math.random() * Math.PI * 2;
          const jr = Math.random() * 1.6;
          const x = cx + Math.cos(ja) * jr;
          const z = cz + Math.sin(ja) * jr;
          if (!isClearOf(x, z, 1.2)) continue;
          const tag = clusterTags[Math.floor(Math.random() * clusterTags.length)];
          await placeProp(tag, x, z, 0.9);
        }
      }
    }

    // ── 3) Center props — broken pillars, altars, ritual marks anchoring the chamber
    const centerTags = tpl.propTags.filter(t => CENTER.has(PROP_ALIASES[t] || t));
    if (centerTags.length) {
      const centerCount = 3 + Math.floor(Math.random() * 3); // 3-5 anchors
      for (let i = 0; i < centerCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const r = Math.random() * Math.min(chamber.halfX, chamber.halfZ) * 0.5;
        const x = chamber.cx + Math.cos(angle) * r;
        const z = chamber.cz + Math.sin(angle) * r;
        if (!isClearOf(x, z, 4)) continue;
        const tag = centerTags[Math.floor(Math.random() * centerTags.length)];
        await placeProp(tag, x, z, 1.3);
      }
    }

    // ── 3b) Environmental storytelling: kneeling/hanging corpses ────────
    // ~30% chance per chamber to add a single "victim" prop near a wall
    // (hanging cage skeleton, kneeling corpse-as-bone-pile). Adds the
    // "you are not the first to come here" Diablo vibe.
    if (Math.random() < 0.3 && chamber.halfX > 18) {
      const victimTags = ['hanging_cage_skeleton', 'bone_pile', 'sarcophagus'];
      const tag = victimTags[Math.floor(Math.random() * victimTags.length)];
      // Place against the chamber wall (random side)
      const side = Math.floor(Math.random() * 4);
      let x, z;
      const inset = 2.5;
      if (side === 0) { x = chamber.cx; z = chamber.cz - chamber.halfZ + inset; }
      else if (side === 1) { x = chamber.cx; z = chamber.cz + chamber.halfZ - inset; }
      else if (side === 2) { x = chamber.cx + chamber.halfX - inset; z = chamber.cz; }
      else { x = chamber.cx - chamber.halfX + inset; z = chamber.cz; }
      // Slight offset so it doesn't sit dead-center of the wall
      x += (Math.random() - 0.5) * (chamber.halfX * 1.2);
      z += (Math.random() - 0.5) * (chamber.halfZ * 1.2);
      if (isClearOf(x, z, 3)) {
        await placeProp(tag, x, z, 1.4);
      }
    }

    // ── 4) Misc props — anything not categorized gets light scatter (2-3 each)
    const miscTags = tpl.propTags.filter(t => {
      const r = PROP_ALIASES[t] || t;
      return !WALL_HUGGING.has(r) && !CLUSTER.has(r) && !CENTER.has(r);
    });
    for (const tag of miscTags) {
      const count = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < count; i++) {
        const x = chamber.cx + (Math.random() - 0.5) * (chamber.halfX * 2 - 4);
        const z = chamber.cz + (Math.random() - 0.5) * (chamber.halfZ * 2 - 4);
        if (!isClearOf(x, z, 3)) continue;
        await placeProp(tag, x, z, 1.1);
      }
    }
  }
}
