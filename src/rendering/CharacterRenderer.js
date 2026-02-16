import * as THREE from 'three';

/**
 * CharacterRenderer — Procedural character model renderer for a dark fantasy Ebon Crucible game.
 *
 * Creates hierarchical skeleton models from Three.js primitives for five classes:
 * TYRANT, WRAITH, INFERNAL, HARBINGER, REVENANT.
 *
 * Each character is a Group of Groups/Meshes forming a humanoid skeleton with
 * class-specific armor, weapons, and accessories. All meshes use MeshStandardMaterial.
 *
 * Enhanced with higher polygon counts, organic silhouettes, neck meshes,
 * hands, feet, and per-class detail additions including animated named parts.
 */

// ─── Class ID constants ────────────────────────────────────────────────────────
const CLASS_TYRANT = 'TYRANT';
const CLASS_WRAITH = 'WRAITH';
const CLASS_INFERNAL = 'INFERNAL';
const CLASS_HARBINGER = 'HARBINGER';
const CLASS_REVENANT = 'REVENANT';

// ─── Ability → Animation Archetype Map ───────────────────────────────────────────
// Maps every ability ID to a reusable animation archetype for per-ability motion.
const ABILITY_ANIM_MAP = {
  // ═══ TYRANT (12 abilities) ═══
  ravaging_cleave:   'horizontal_cleave',
  bloodrage_strike:  'quick_stab',
  brutal_slam:       'overhead_slam',
  iron_cyclone:      'war_cry',         // whirlwind handled separately, this is the initial cast
  shatter_guard:     'horizontal_cleave',
  warbringer_rush:   'charge_rush',
  crippling_strike:  'kidney_strike',
  thunder_spike:     'hand_blast',
  iron_resolve:      'defensive_brace',
  warborn_rally:     'war_cry',
  skull_crack:       'interrupt_jab',
  crushing_descent:  'charge_rush',

  // ═══ WRAITH (14 abilities) ═══
  viper_lash:        'quick_stab',
  throat_opener:     'quick_stab',
  grim_flurry:       'dual_slash',
  nerve_strike:      'kidney_strike',
  serrated_wound:    'dual_slash',
  blackjack:         'kidney_strike',
  veil_of_night:     'vanish_crouch',
  shade_shift:       'teleport_blink',
  phantasm_dodge:    'vanish_crouch',
  umbral_shroud:     'defensive_brace',
  blood_tincture:    'heal_self',
  throat_jab:        'interrupt_jab',
  frenzy_edge:       'power_up',
  shadowmeld:        'vanish_crouch',

  // ═══ INFERNAL (13 abilities) ═══
  // Cast-time abilities handled by animateCast; these are the instants:
  searing_pulse:     'hand_blast',
  permafrost_burst:  'ground_stomp',
  phase_shift:       'teleport_blink',
  pyroclasm:         'power_up',
  crystalline_ward:  'defensive_brace',
  cauterize:         'heal_self',
  arcane_bulwark:    'defensive_brace',
  spell_fracture:    'interrupt_jab',
  scaldwind:         'ground_stomp',

  // ═══ HARBINGER (13 abilities) ═══
  hex_blight:        'dark_curse',
  creeping_torment:  'dark_curse',
  wraith_bolt:       'hand_blast',
  nether_slam:       'ground_stomp',
  blood_tithe:       'power_up',
  warded_flesh:      'defensive_brace',
  rift_anchor:       'teleport_blink',
  hex_silence:       'interrupt_jab',
  soul_ignite:       'power_up',

  // ═══ REVENANT (13 abilities) ═══
  hallowed_strike:   'mace_smite',
  divine_reckoning:  'holy_smash',
  radiant_verdict:   'mace_smite',
  sanctified_gale:   'ground_stomp',
  ember_wake:        'ground_stomp',
  gavel_of_light:    'holy_smash',
  binding_prayer:    'prayer_channel',  // also has cast time — used for instant trigger
  aegis_of_dawn:     'war_cry',
  sovereign_mend:    'heal_self',
  holy_restoration:  'heal_self',
  unchained_grace:   'speed_burst',
  sanctified_rebuff: 'shield_bash',
  valiant_charge:    'speed_burst',
};

// ─── Runtime Sobel Normal Map Generator ─────────────────────────────────────────
/**
 * Generates a normal map from a diffuse image using Sobel operator.
 * Draws to a canvas and returns a THREE.CanvasTexture.
 */
function _sobelNormalMap(image, targetCanvas, strength = 2.5) {
  const w = image.width || image.naturalWidth || 256;
  const h = image.height || image.naturalHeight || 256;
  targetCanvas.width = w;
  targetCanvas.height = h;
  const ctx = targetCanvas.getContext('2d');
  ctx.drawImage(image, 0, 0, w, h);
  const srcData = ctx.getImageData(0, 0, w, h);
  const src = srcData.data;
  const outData = ctx.createImageData(w, h);
  const out = outData.data;

  // Convert to grayscale heightmap
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = (src[i * 4] * 0.299 + src[i * 4 + 1] * 0.587 + src[i * 4 + 2] * 0.114) / 255;
  }

  // Sobel 3x3 kernel
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = gray[((y - 1 + h) % h) * w + (x - 1 + w) % w];
      const t  = gray[((y - 1 + h) % h) * w + x];
      const tr = gray[((y - 1 + h) % h) * w + (x + 1) % w];
      const l  = gray[y * w + (x - 1 + w) % w];
      const r  = gray[y * w + (x + 1) % w];
      const bl = gray[((y + 1) % h) * w + (x - 1 + w) % w];
      const b  = gray[((y + 1) % h) * w + x];
      const br = gray[((y + 1) % h) * w + (x + 1) % w];

      const dX = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dY = (bl + 2 * b + br) - (tl + 2 * t + tr);

      let nx = -dX * strength;
      let ny = -dY * strength;
      let nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len; ny /= len; nz /= len;

      const pi = (y * w + x) * 4;
      out[pi]     = ((nx * 0.5 + 0.5) * 255) | 0;
      out[pi + 1] = ((ny * 0.5 + 0.5) * 255) | 0;
      out[pi + 2] = ((nz * 0.5 + 0.5) * 255) | 0;
      out[pi + 3] = 255;
    }
  }
  ctx.putImageData(outData, 0, 0);
}

/**
 * Create a deferred normal map texture that populates itself when the source texture loads.
 * Returns immediately with a placeholder; fills in real data on source image load.
 */
function _createNormalMap(sourceTex, strength = 2.5) {
  const canvas = document.createElement('canvas');
  canvas.width = 4; canvas.height = 4;
  const normalTex = new THREE.CanvasTexture(canvas);
  normalTex.wrapS = sourceTex.wrapS;
  normalTex.wrapT = sourceTex.wrapT;
  if (sourceTex.repeat) normalTex.repeat.copy(sourceTex.repeat);

  // Poll for image readiness (TextureLoader doesn't expose onLoad for already-started loads)
  const tryGenerate = () => {
    if (sourceTex.image && (sourceTex.image.complete !== false)) {
      _sobelNormalMap(sourceTex.image, canvas, strength);
      normalTex.needsUpdate = true;
    } else {
      requestAnimationFrame(tryGenerate);
    }
  };
  requestAnimationFrame(tryGenerate);

  return normalTex;
}

// ─── Texture loader (eager, non-blocking) ──────────────────────────────────────
const _texLoader = new THREE.TextureLoader();
const CLASS_TEXTURES = {};

function _loadClassTex(classId) {
  const tex = _texLoader.load(`/assets/textures/tex_${classId}_body.webp`);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  // Auto-generate normal map
  tex._normalMap = _createNormalMap(tex, 2.5);
  return tex;
}

CLASS_TEXTURES.tyrant = _loadClassTex('tyrant');
CLASS_TEXTURES.wraith = _loadClassTex('wraith');
CLASS_TEXTURES.infernal = _loadClassTex('infernal');
CLASS_TEXTURES.harbinger = _loadClassTex('harbinger');
CLASS_TEXTURES.revenant = _loadClassTex('revenant');

// ─── Weapon texture loader ────────────────────────────────────────────────────
const WEAPON_TEXTURES = {};

function _loadWeaponTex(name) {
  const tex = _texLoader.load(`/assets/textures/tex_weapon_${name}.webp`);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 4);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Auto-generate normal map
  tex._normalMap = _createNormalMap(tex, 3.0);
  return tex;
}

WEAPON_TEXTURES.tyrant_sword = _loadWeaponTex('tyrant_sword');
WEAPON_TEXTURES.wraith_dagger = _loadWeaponTex('wraith_dagger');
WEAPON_TEXTURES.infernal_staff = _loadWeaponTex('infernal_staff');
WEAPON_TEXTURES.harbinger_staff = _loadWeaponTex('harbinger_staff');
WEAPON_TEXTURES.revenant_mace = _loadWeaponTex('revenant_mace');

// ─── UV Atlas Regions (2x2 grid layout) ────────────────────────────────────────
// Each body texture atlas is divided:  Top-Left=Head, Top-Right=Shoulders/Arms,
// Bottom-Left=Torso/Chest, Bottom-Right=Legs/Boots
const UV_REGIONS = {
  HEAD:      { uMin: 0.0, uMax: 0.5, vMin: 0.5, vMax: 1.0 },
  SHOULDERS: { uMin: 0.5, uMax: 1.0, vMin: 0.5, vMax: 1.0 },
  TORSO:     { uMin: 0.0, uMax: 0.5, vMin: 0.0, vMax: 0.5 },
  LEGS:      { uMin: 0.5, uMax: 1.0, vMin: 0.0, vMax: 0.5 },
};

/** Remap UV coordinates of a geometry to address a sub-region of a texture atlas. */
function _remapUVs(geometry, region) {
  const uv = geometry.attributes.uv;
  if (!uv) return geometry;
  const arr = uv.array;
  for (let i = 0; i < arr.length; i += 2) {
    arr[i]     = region.uMin + arr[i]     * (region.uMax - region.uMin);
    arr[i + 1] = region.vMin + arr[i + 1] * (region.vMax - region.vMin);
  }
  uv.needsUpdate = true;
  return geometry;
}

/** Create a LatheGeometry from profile points with UV remapping. */
function createProfileMesh(profilePoints, segments, uvRegion, material) {
  const geo = new THREE.LatheGeometry(profilePoints, segments);
  _remapUVs(geo, uvRegion);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}

/** Create an ExtrudeGeometry mesh with UV remapping. */
function createExtrudedMesh(shape, extrudeSettings, uvRegion, material) {
  const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  _remapUVs(geo, uvRegion);
  return new THREE.Mesh(geo, material);
}

/** Create a tapered limb (cylinder with different top/bottom radii) with UV remapping. */
function createTaperedLimb(topR, bottomR, length, segments, uvRegion, material) {
  const geo = new THREE.CylinderGeometry(topR, bottomR, length, segments);
  _remapUVs(geo, uvRegion);
  return new THREE.Mesh(geo, material);
}

/** Create a curved horn/tendril using TubeGeometry on a CatmullRomCurve3. */
function createCurvedHorn(curvePoints, radius, segments, material) {
  const curve = new THREE.CatmullRomCurve3(curvePoints);
  const geo = new THREE.TubeGeometry(curve, segments, radius, 8, false);
  return new THREE.Mesh(geo, material);
}

// ─── Shared helper: make a MeshStandardMaterial ────────────────────────────────
function mat(opts) {
  if (!opts.side) opts.side = THREE.DoubleSide;
  // Auto-wire normal map from diffuse texture if available
  if (opts.map && opts.map._normalMap && !opts.normalMap) {
    opts.normalMap = opts.map._normalMap;
    if (!opts.normalScale) {
      // Scale normal intensity based on material type:
      // Metallic (armor/weapons) → stronger normals for forged detail
      // Leather/cloth → softer normals for fabric weave
      const metal = opts.metalness || 0;
      const strength = metal > 0.5 ? 1.8 : metal > 0.2 ? 1.3 : 0.9;
      opts.normalScale = new THREE.Vector2(strength, strength);
    }
  }
  return new THREE.MeshStandardMaterial(opts);
}

// ─── Shared skeleton builder ───────────────────────────────────────────────────
// Returns the root group pre-populated with the common hierarchy nodes.
// Enhanced: 16-segment body, 24-segment head, 12-segment limbs, tapered body,
// neck mesh, hand spheres, feet boxes.
function buildBaseSkeleton() {
  const root = new THREE.Group();
  root.name = 'characterRoot';

  // Body — torso region
  const body = new THREE.Group();
  body.name = 'body';
  body.position.y = 1.0;

  // Arms
  const leftArm = new THREE.Group();
  leftArm.name = 'leftArm';
  leftArm.position.x = -0.5;

  const rightArm = new THREE.Group();
  rightArm.name = 'rightArm';
  rightArm.position.x = 0.5;

  body.add(leftArm);
  body.add(rightArm);

  // Head — positioned to sit naturally on neck/torso
  const head = new THREE.Group();
  head.name = 'head';
  head.position.y = 0.62;
  body.add(head);

  // Neck — connects head to body (taller to bridge gap properly)
  const neckMat = mat({ color: 0x665544, roughness: 0.7, metalness: 0.1 });
  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.12, 0.22, 12),
    neckMat
  );
  neck.name = 'neck';
  neck.position.y = 0.52;
  body.add(neck);

  // Extras container
  const extras = new THREE.Group();
  extras.name = 'extras';
  body.add(extras);

  root.add(body);

  // Legs
  const legs = new THREE.Group();
  legs.name = 'legs';
  legs.position.y = 0;

  const legMat = mat({ color: 0x555555, roughness: 0.6, metalness: 0.3 });

  const leftLeg = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.08, 0.6, 12),
    legMat
  );
  leftLeg.name = 'leftLeg';
  leftLeg.position.set(-0.18, 0.3, 0);

  const rightLeg = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.08, 0.6, 12),
    legMat
  );
  rightLeg.name = 'rightLeg';
  rightLeg.position.set(0.18, 0.3, 0);

  // Feet — slightly elongated boxes at leg bottoms
  const footMat = mat({ color: 0x444444, roughness: 0.7, metalness: 0.2 });
  const leftFoot = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.05, 0.16),
    footMat
  );
  leftFoot.name = 'leftFoot';
  leftFoot.position.set(0, -0.32, 0.03);
  leftLeg.add(leftFoot);

  const rightFoot = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.05, 0.16),
    footMat
  );
  rightFoot.name = 'rightFoot';
  rightFoot.position.set(0, -0.32, 0.03);
  rightLeg.add(rightFoot);

  legs.add(leftLeg);
  legs.add(rightLeg);
  root.add(legs);

  // Weapon trail (hidden by default)
  const trailGeo = new THREE.PlaneGeometry(0.1, 1.0, 1, 4);
  const trailMat = mat({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 0.6,
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const weaponTrail = new THREE.Mesh(trailGeo, trailMat);
  weaponTrail.name = 'weaponTrail';
  weaponTrail.visible = false;
  root.add(weaponTrail);

  return root;
}

// ─────────────────────────────────────────────────────────────────────────────
// Class-specific builder functions
// ─────────────────────────────────────────────────────────────────────────────

function buildTyrant() {
  const root = buildBaseSkeleton();
  const body = root.getObjectByName('body');
  const head = root.getObjectByName('head');
  const leftArm = root.getObjectByName('leftArm');
  const rightArm = root.getObjectByName('rightArm');
  const extras = root.getObjectByName('extras');
  const legs = root.getObjectByName('legs');

  // --- Palette: dark steel with blood red accents (bright enough to show DALL-E textures) ---
  const darkSteel = 0x9ca0a8;
  const bloodRed = 0xc84040;
  const boneWhite = 0xd2c8a0;
  const plateMat = mat({ color: darkSteel, metalness: 0.8, roughness: 0.25, map: CLASS_TEXTURES.tyrant });
  const bloodMat = mat({ color: bloodRed, metalness: 0.5, roughness: 0.35, emissive: 0x6b1010, emissiveIntensity: 0.15, map: CLASS_TEXTURES.tyrant });
  const armMat = mat({ color: darkSteel, metalness: 0.75, roughness: 0.3, map: CLASS_TEXTURES.tyrant });
  const leatherMat = mat({ color: 0x8a7060, roughness: 0.85, metalness: 0.05, map: CLASS_TEXTURES.tyrant });

  // ── Torso: barrel chest plate via sculpted LatheGeometry (24 segments) ──
  const torsoProfile = [
    new THREE.Vector2(0.16, 0.5),   // gorget (top)
    new THREE.Vector2(0.22, 0.4),   // neck
    new THREE.Vector2(0.34, 0.25),  // upper chest
    new THREE.Vector2(0.44, 0.1),   // widest (bulked up)
    new THREE.Vector2(0.36, 0.0),   // mid
    new THREE.Vector2(0.30, -0.15), // waist
    new THREE.Vector2(0.28, -0.3),  // hip
    new THREE.Vector2(0.25, -0.45), // bottom
  ];
  const torso = createProfileMesh(torsoProfile, 24, UV_REGIONS.TORSO, plateMat);
  torso.name = 'torso';
  body.add(torso);

  // Update neck material to match
  const neck = root.getObjectByName('neck');
  if (neck) neck.material = plateMat;

  // ── Shoulders: spiked pauldrons via LatheGeometry (dome + spike cone) ──
  const pauldronProfile = [
    new THREE.Vector2(0.0, 0.0),    // center base
    new THREE.Vector2(0.28, 0.0),   // dome rim (scaled up)
    new THREE.Vector2(0.20, 0.06),  // dome rise
    new THREE.Vector2(0.14, 0.12),  // dome upper
    new THREE.Vector2(0.07, 0.16),  // dome shoulder
    new THREE.Vector2(0.04, 0.22),  // spike base
    new THREE.Vector2(0.02, 0.30),  // spike taper
    new THREE.Vector2(0.0, 0.38),   // spike tip
  ];

  const leftPauldron = createProfileMesh(pauldronProfile, 16, UV_REGIONS.SHOULDERS, bloodMat);
  leftPauldron.name = 'leftPauldron';
  leftPauldron.position.set(-0.5, 0.48, 0);
  body.add(leftPauldron);

  const rightPauldron = createProfileMesh(pauldronProfile, 16, UV_REGIONS.SHOULDERS, bloodMat);
  rightPauldron.name = 'rightPauldron';
  rightPauldron.position.set(0.5, 0.48, 0);
  body.add(rightPauldron);

  // ── Head: horned/pointed great helm via sculpted LatheGeometry (24 segments) ──
  const helmetProfile = [
    new THREE.Vector2(0.14, 0.0),   // neck collar
    new THREE.Vector2(0.22, 0.06),  // jaw
    new THREE.Vector2(0.22, 0.14),  // face
    new THREE.Vector2(0.20, 0.22),  // temple
    new THREE.Vector2(0.16, 0.30),  // crown
    new THREE.Vector2(0.10, 0.36),  // narrowing
    new THREE.Vector2(0.04, 0.42),  // point
    new THREE.Vector2(0.0, 0.46),   // tip
  ];
  const helmet = createProfileMesh(helmetProfile, 24, UV_REGIONS.HEAD, plateMat);
  helmet.name = 'headMesh';
  head.add(helmet);

  // T-slit visor — horizontal and vertical slits
  const visorMat = mat({ color: 0x080808, roughness: 1.0, metalness: 0.0 });
  const visorH = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.025, 0.04), visorMat);
  visorH.name = 'visor';
  visorH.position.set(0, 0.10, 0.22);
  head.add(visorH);

  const visorV = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.1, 0.04), visorMat);
  visorV.name = 'visorVert';
  visorV.position.set(0, 0.08, 0.22);
  head.add(visorV);

  // Visor slit eye glow — menacing red glow visible through the T-slit (enhanced intensity)
  const eyeGlowMat = mat({
    color: bloodRed, emissive: bloodRed, emissiveIntensity: 3.0,
    roughness: 0.2, metalness: 0.0,
  });
  const leftEyeGlow = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), eyeGlowMat);
  leftEyeGlow.name = 'leftEyeGlow';
  leftEyeGlow.position.set(-0.04, 0.10, 0.23);
  head.add(leftEyeGlow);

  const rightEyeGlow = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), eyeGlowMat);
  rightEyeGlow.name = 'rightEyeGlow';
  rightEyeGlow.position.set(0.04, 0.10, 0.23);
  head.add(rightEyeGlow);

  // Face PointLight — casts red glow from the visor
  const faceLight = new THREE.PointLight(0xff0000, 0.4, 0.8);
  faceLight.name = 'faceLight';
  faceLight.position.set(0, 0.10, 0.20);
  head.add(faceLight);

  // ── Large curved demon horns on helmet ──
  const hornMat = mat({ color: 0x6a5e4a, metalness: 0.3, roughness: 0.5 });

  const leftHorn = createCurvedHorn([
    new THREE.Vector3(0.12, 0.20, 0.05),
    new THREE.Vector3(0.25, 0.30, 0.0),
    new THREE.Vector3(0.30, 0.45, -0.10),
    new THREE.Vector3(0.22, 0.55, -0.20),
  ], 0.035, 12, hornMat);
  leftHorn.name = 'leftHorn';
  head.add(leftHorn);

  const rightHorn = createCurvedHorn([
    new THREE.Vector3(-0.12, 0.20, 0.05),
    new THREE.Vector3(-0.25, 0.30, 0.0),
    new THREE.Vector3(-0.30, 0.45, -0.10),
    new THREE.Vector3(-0.22, 0.55, -0.20),
  ], 0.035, 12, hornMat);
  rightHorn.name = 'rightHorn';
  head.add(rightHorn);

  // ── Arms: tapered armored limbs (16 segments, thickened) ──
  const leftUpperArm = createTaperedLimb(0.11, 0.07, 0.5, 16, UV_REGIONS.SHOULDERS, armMat);
  leftUpperArm.name = 'upperArm';
  leftUpperArm.position.y = -0.3;
  leftArm.add(leftUpperArm);

  const leftHand = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 10), armMat);
  leftHand.name = 'hand';
  leftHand.position.y = -0.6;
  leftArm.add(leftHand);

  const rightUpperArm = createTaperedLimb(0.11, 0.07, 0.5, 16, UV_REGIONS.SHOULDERS, armMat);
  rightUpperArm.name = 'upperArm';
  rightUpperArm.position.y = -0.3;
  rightArm.add(rightUpperArm);

  const rightHand = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 10), armMat);
  rightHand.name = 'rightHand';
  rightHand.position.y = -0.6;
  rightArm.add(rightHand);

  // ── Weapon: greatsword via ExtrudeGeometry — flat double-edged blade ──
  const bladeMat = mat({ color: 0xb0b8c0, metalness: 0.95, roughness: 0.08, map: WEAPON_TEXTURES.tyrant_sword });
  const bladeShape = new THREE.Shape();
  // 14-point double-edged blade outline (x = half-width, y = height from bottom)
  bladeShape.moveTo(0.0, 0.0);         // pommel bottom center
  bladeShape.lineTo(-0.03, 0.02);      // pommel left
  bladeShape.lineTo(-0.03, 0.08);      // pommel top left
  bladeShape.lineTo(-0.015, 0.10);     // grip start left
  bladeShape.lineTo(-0.015, 0.28);     // grip end left
  bladeShape.lineTo(-0.16, 0.30);      // crossguard left tip
  bladeShape.lineTo(-0.16, 0.34);      // crossguard left top
  bladeShape.lineTo(-0.06, 0.36);      // blade start left
  bladeShape.lineTo(-0.05, 1.20);      // blade mid left
  bladeShape.lineTo(0.0, 1.65);        // blade tip (point)
  bladeShape.lineTo(0.05, 1.20);       // blade mid right
  bladeShape.lineTo(0.06, 0.36);       // blade start right
  bladeShape.lineTo(0.16, 0.34);       // crossguard right top
  bladeShape.lineTo(0.16, 0.30);       // crossguard right tip
  bladeShape.lineTo(0.015, 0.28);      // grip end right
  bladeShape.lineTo(0.015, 0.10);      // grip start right
  bladeShape.lineTo(0.03, 0.08);       // pommel top right
  bladeShape.lineTo(0.03, 0.02);       // pommel right
  bladeShape.lineTo(0.0, 0.0);         // back to bottom center

  const swordMesh = createExtrudedMesh(bladeShape, {
    depth: 0.015,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.003,
    bevelSegments: 1,
  }, UV_REGIONS.TORSO, bladeMat);
  swordMesh.name = 'weapon';
  swordMesh.scale.set(1.5, 1.5, 1.5);
  // Center the extrusion and orient blade downward from hand
  swordMesh.position.set(0, 0.35, -0.007);
  swordMesh.rotation.z = Math.PI;
  rightArm.add(swordMesh);

  // ── Glowing red rune strip down center of sword blade ──
  const swordGlowMat = mat({
    color: 0xff2200, emissive: 0xff2200, emissiveIntensity: 2.0,
    transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false,
  });
  const swordGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 1.8), swordGlowMat);
  swordGlow.name = 'swordGlow';
  swordGlow.position.set(0, 0.45, -0.007 + 0.02);
  swordGlow.rotation.z = Math.PI;
  rightArm.add(swordGlow);

  // ── Belt with buckle (torus at waist) ──
  const belt = new THREE.Mesh(
    new THREE.TorusGeometry(0.35, 0.04, 12, 24),
    leatherMat
  );
  belt.name = 'belt';
  belt.position.y = -0.45;
  belt.rotation.x = Math.PI / 2;
  body.add(belt);

  // Belt buckle
  const buckle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 0.03, 8),
    mat({ color: boneWhite, metalness: 0.7, roughness: 0.3 })
  );
  buckle.name = 'buckle';
  buckle.position.set(0, -0.45, 0.34);
  buckle.rotation.x = Math.PI / 2;
  body.add(buckle);

  // ── Red cape behind body (PlaneGeometry, 2 height segments for wave animation) ──
  const cape = new THREE.Mesh(
    new THREE.PlaneGeometry(0.7, 1.1, 4, 2),
    mat({ color: bloodRed, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide, map: CLASS_TEXTURES.tyrant })
  );
  cape.name = 'cape';
  cape.position.set(0, -0.15, -0.28);
  cape.rotation.x = 0.12;
  extras.add(cape);

  // ── Legs: heavy tapered steel greaves (16 segments) ──
  const leftLeg = legs.getObjectByName('leftLeg');
  const rightLeg = legs.getObjectByName('rightLeg');

  const leftGreave = createTaperedLimb(0.12, 0.09, 0.6, 16, UV_REGIONS.LEGS, plateMat);
  leftGreave.name = 'leftGreave';
  leftLeg.geometry.dispose();
  leftLeg.geometry = leftGreave.geometry;
  leftLeg.material = plateMat;

  const rightGreave = createTaperedLimb(0.12, 0.09, 0.6, 16, UV_REGIONS.LEGS, plateMat);
  rightGreave.name = 'rightGreave';
  rightLeg.geometry.dispose();
  rightLeg.geometry = rightGreave.geometry;
  rightLeg.material = plateMat;

  // Update feet material
  const leftFoot = leftLeg.getObjectByName('leftFoot');
  const rightFoot = rightLeg.getObjectByName('rightFoot');
  if (leftFoot) leftFoot.material = plateMat;
  if (rightFoot) rightFoot.material = plateMat;

  // Knee guards — protruding sphere plates on each leg
  const kneeMat = mat({ color: darkSteel, metalness: 0.8, roughness: 0.2, map: CLASS_TEXTURES.tyrant });
  const kneeGeo = new THREE.SphereGeometry(0.08, 12, 10);
  const leftKnee = new THREE.Mesh(kneeGeo, kneeMat);
  leftKnee.name = 'leftKnee';
  leftKnee.scale.set(0.9, 0.8, 1.3);
  leftKnee.position.set(0, 0.12, 0.09);
  leftLeg.add(leftKnee);

  const rightKnee = new THREE.Mesh(kneeGeo, kneeMat);
  rightKnee.name = 'rightKnee';
  rightKnee.scale.set(0.9, 0.8, 1.3);
  rightKnee.position.set(0, 0.12, 0.09);
  rightLeg.add(rightKnee);

  return root;
}

// ─────────────────────────────────────────────────────────────────────────────

function buildWraith() {
  const root = buildBaseSkeleton();
  const body = root.getObjectByName('body');
  const head = root.getObjectByName('head');
  const leftArm = root.getObjectByName('leftArm');
  const rightArm = root.getObjectByName('rightArm');
  const extras = root.getObjectByName('extras');
  const legs = root.getObjectByName('legs');

  // --- Palette: dark purple / indigo with midnight blue accents (bright for texture visibility) ---
  const indigo = 0x7060a0;
  const midnight = 0x5848a0;
  const leather = 0x7a6898;
  const metalBuckle = 0x8888aa;
  const leatherMat = mat({ color: leather, roughness: 0.78, metalness: 0.1, map: CLASS_TEXTURES.wraith });
  const midnightMat = mat({ color: midnight, roughness: 0.65, metalness: 0.15, map: CLASS_TEXTURES.wraith });
  const buckleMat = mat({ color: metalBuckle, metalness: 0.7, roughness: 0.35 });

  // ── Torso: lean leather body via createProfileMesh (7 profile points) ──
  const torsoProfile = [
    new THREE.Vector2(0.14, 0.45),
    new THREE.Vector2(0.24, 0.3),
    new THREE.Vector2(0.26, 0.15),
    new THREE.Vector2(0.24, 0),
    new THREE.Vector2(0.20, -0.15),
    new THREE.Vector2(0.22, -0.3),
    new THREE.Vector2(0.20, -0.45),
  ];
  const torso = createProfileMesh(torsoProfile, 16, UV_REGIONS.TORSO, leatherMat);
  torso.name = 'torso';
  body.add(torso);

  // Update neck material
  const neck = root.getObjectByName('neck');
  if (neck) neck.material = leatherMat;

  // Cross-strap across chest (left shoulder to right hip)
  const strap1 = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.75, 0.02),
    midnightMat
  );
  strap1.name = 'strap1';
  strap1.position.set(0, 0.05, 0.24);
  strap1.rotation.z = 0.35;
  body.add(strap1);

  // Second cross-strap
  const strap2 = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.75, 0.02),
    midnightMat
  );
  strap2.name = 'strap2';
  strap2.position.set(0, 0.05, 0.24);
  strap2.rotation.z = -0.35;
  body.add(strap2);

  // Buckle at strap intersection
  const strapBuckle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.025, 16),
    buckleMat
  );
  strapBuckle.name = 'strapBuckle';
  strapBuckle.position.set(0, 0.05, 0.26);
  strapBuckle.rotation.x = Math.PI / 2;
  body.add(strapBuckle);

  // ── Head: peaked hood via createProfileMesh (6 profile points) ──
  const hoodMat = mat({ color: 0x5a4880, roughness: 0.75, metalness: 0.1, map: CLASS_TEXTURES.wraith });
  const hoodProfile = [
    new THREE.Vector2(0.26, 0),
    new THREE.Vector2(0.29, 0.08),
    new THREE.Vector2(0.23, 0.18),
    new THREE.Vector2(0.16, 0.28),
    new THREE.Vector2(0.05, 0.35),
    new THREE.Vector2(0, 0.38),
  ];
  const hood = createProfileMesh(hoodProfile, 24, UV_REGIONS.HEAD, hoodMat);
  hood.name = 'hood';
  hood.position.set(0, -0.02, -0.02);
  head.add(hood);

  // Face under hood — textured with head region, darkened
  const faceGeo = new THREE.SphereGeometry(0.18, 24, 16);
  _remapUVs(faceGeo, UV_REGIONS.HEAD);
  const face = new THREE.Mesh(
    faceGeo,
    mat({ color: 0x605068, roughness: 0.9, metalness: 0.05, map: CLASS_TEXTURES.wraith })
  );
  face.name = 'headMesh';
  face.position.set(0, -0.04, 0.06);
  head.add(face);

  // Glowing eye slits (emissive violet)
  const eyeSlitMat = mat({ color: 0x8866cc, emissive: 0x9944ff, emissiveIntensity: 2.5, roughness: 0.3, metalness: 0.0 });
  const leftEyeSlit = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 8), eyeSlitMat);
  leftEyeSlit.name = 'leftEye';
  leftEyeSlit.position.set(-0.06, 0.0, 0.19);
  head.add(leftEyeSlit);
  const rightEyeSlit = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 8), eyeSlitMat);
  rightEyeSlit.name = 'rightEye';
  rightEyeSlit.position.set(0.06, 0.0, 0.19);
  head.add(rightEyeSlit);

  // ── Arms: tapered leather limbs via createTaperedLimb ──
  const leftUpperArm = createTaperedLimb(0.065, 0.05, 0.48, 16, UV_REGIONS.SHOULDERS, leatherMat);
  leftUpperArm.name = 'upperArm';
  leftUpperArm.position.y = -0.25;
  leftArm.add(leftUpperArm);

  // Left bracer
  const bracerGeo = new THREE.CylinderGeometry(0.06, 0.065, 0.18, 12);
  const leftBracer = new THREE.Mesh(bracerGeo, midnightMat);
  leftBracer.name = 'leftBracer';
  leftBracer.position.y = -0.48;
  leftArm.add(leftBracer);

  // Left bracer buckle
  const leftBracerBuckle = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 0.02, 0.015),
    buckleMat
  );
  leftBracerBuckle.name = 'leftBracerBuckle';
  leftBracerBuckle.position.set(0, -0.48, 0.07);
  leftArm.add(leftBracerBuckle);

  // Forearm wraps — thin torus rings on each arm
  const wrapMat = mat({ color: midnight, roughness: 0.7, metalness: 0.15 });
  const wrapGeo = new THREE.TorusGeometry(0.06, 0.008, 8, 12);
  const leftWrap1 = new THREE.Mesh(wrapGeo, wrapMat);
  leftWrap1.name = 'leftWrap1';
  leftWrap1.position.y = -0.38;
  leftWrap1.rotation.x = Math.PI / 2;
  leftArm.add(leftWrap1);
  const leftWrap2 = new THREE.Mesh(wrapGeo, wrapMat);
  leftWrap2.name = 'leftWrap2';
  leftWrap2.position.y = -0.43;
  leftWrap2.rotation.x = Math.PI / 2;
  leftArm.add(leftWrap2);

  // Left hand
  const handMat = mat({ color: 0x605068, roughness: 0.8, metalness: 0.1, map: CLASS_TEXTURES.wraith });
  const leftHand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), handMat);
  leftHand.name = 'hand';
  leftHand.position.y = -0.6;
  leftArm.add(leftHand);

  // ── Daggers: curved blade via createExtrudedMesh ──
  const daggerBladeMat = mat({ color: 0x9098a5, metalness: 0.92, roughness: 0.08, map: WEAPON_TEXTURES.wraith_dagger });
  const daggerExtrudeSettings = { depth: 0.01, bevelEnabled: false };

  // Left dagger — curved blade shape (~0.055 wide x 0.44 tall)
  const leftBladeShape = new THREE.Shape();
  leftBladeShape.moveTo(0, 0);
  leftBladeShape.lineTo(0.055, 0);
  leftBladeShape.quadraticCurveTo(0.06, -0.22, 0.03, -0.44);
  leftBladeShape.lineTo(0.025, -0.44);
  leftBladeShape.quadraticCurveTo(0.02, -0.22, 0, 0);

  const leftDagger = createExtrudedMesh(leftBladeShape, daggerExtrudeSettings, UV_REGIONS.TORSO, daggerBladeMat);
  leftDagger.name = 'weapon';
  leftDagger.scale.set(1.8, 1.8, 1.8);
  leftDagger.position.set(-0.005, -0.65, -0.005);
  leftArm.add(leftDagger);

  // Weapon trail marker (empty group for effects system)
  const leftWeaponTrail = new THREE.Group();
  leftWeaponTrail.name = 'weaponTrail';
  leftDagger.add(leftWeaponTrail);

  // Left dagger crossguard
  const daggerGuardGeo = new THREE.BoxGeometry(0.08, 0.02, 0.025);
  const leftDaggerGuard = new THREE.Mesh(daggerGuardGeo, buckleMat);
  leftDaggerGuard.name = 'leftDaggerGuard';
  leftDaggerGuard.position.y = -0.58;
  leftArm.add(leftDaggerGuard);

  // Left dagger aura glow
  const daggerGlowMat = mat({ color: 0x000000, emissive: 0x8844ff, emissiveIntensity: 1.5, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false });
  const leftDaggerGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.08, 0.5),
    daggerGlowMat
  );
  leftDaggerGlow.name = 'leftDaggerGlow';
  leftDaggerGlow.position.set(-0.005, -0.58, -0.005);
  leftArm.add(leftDaggerGlow);

  // Right arm
  const rightUpperArm = createTaperedLimb(0.065, 0.05, 0.48, 16, UV_REGIONS.SHOULDERS, leatherMat);
  rightUpperArm.name = 'upperArm';
  rightUpperArm.position.y = -0.25;
  rightArm.add(rightUpperArm);

  // Right bracer
  const rightBracer = new THREE.Mesh(bracerGeo, midnightMat);
  rightBracer.name = 'rightBracer';
  rightBracer.position.y = -0.48;
  rightArm.add(rightBracer);

  // Right forearm wraps
  const rightWrap1 = new THREE.Mesh(wrapGeo, wrapMat);
  rightWrap1.name = 'rightWrap1';
  rightWrap1.position.y = -0.38;
  rightWrap1.rotation.x = Math.PI / 2;
  rightArm.add(rightWrap1);
  const rightWrap2 = new THREE.Mesh(wrapGeo, wrapMat);
  rightWrap2.name = 'rightWrap2';
  rightWrap2.position.y = -0.43;
  rightWrap2.rotation.x = Math.PI / 2;
  rightArm.add(rightWrap2);

  // Right hand
  const rightHand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), handMat);
  rightHand.name = 'rightHand';
  rightHand.position.y = -0.6;
  rightArm.add(rightHand);

  // Right dagger — mirrored curved blade
  const rightBladeShape = new THREE.Shape();
  rightBladeShape.moveTo(0, 0);
  rightBladeShape.lineTo(-0.055, 0);
  rightBladeShape.quadraticCurveTo(-0.06, -0.22, -0.03, -0.44);
  rightBladeShape.lineTo(-0.025, -0.44);
  rightBladeShape.quadraticCurveTo(-0.02, -0.22, 0, 0);

  const rightDagger = createExtrudedMesh(rightBladeShape, daggerExtrudeSettings, UV_REGIONS.TORSO, daggerBladeMat);
  rightDagger.name = 'weapon';
  rightDagger.scale.set(1.8, 1.8, 1.8);
  rightDagger.position.set(0.005, -0.65, -0.005);
  rightArm.add(rightDagger);

  // Right dagger crossguard
  const rightDaggerGuard = new THREE.Mesh(daggerGuardGeo, buckleMat);
  rightDaggerGuard.name = 'rightDaggerGuard';
  rightDaggerGuard.position.y = -0.58;
  rightArm.add(rightDaggerGuard);

  // Right dagger aura glow
  const rightDaggerGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.08, 0.5),
    daggerGlowMat
  );
  rightDaggerGlow.name = 'rightDaggerGlow';
  rightDaggerGlow.position.set(0.005, -0.58, -0.005);
  rightArm.add(rightDaggerGlow);

  // ── Belt with pouches ──
  const wraithBelt = new THREE.Mesh(
    new THREE.TorusGeometry(0.3, 0.025, 12, 24),
    midnightMat
  );
  wraithBelt.name = 'belt';
  wraithBelt.position.y = -0.38;
  wraithBelt.rotation.x = Math.PI / 2;
  body.add(wraithBelt);

  // Belt pouches — small boxes at waist
  const pouchMat = mat({ color: 0x2a1e1a, roughness: 0.85, metalness: 0.05 });
  const pouch1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.04), pouchMat);
  pouch1.name = 'pouch1';
  pouch1.position.set(-0.26, -0.38, 0.13);
  body.add(pouch1);

  const pouch2 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.035), pouchMat);
  pouch2.name = 'pouch2';
  pouch2.position.set(0.22, -0.38, 0.16);
  body.add(pouch2);

  const pouch3 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.055, 0.035), pouchMat);
  pouch3.name = 'pouch3';
  pouch3.position.set(0.05, -0.38, 0.28);
  body.add(pouch3);

  // ── Tattered cloak behind body (PlaneGeometry, 3 width segments for vertex flutter) ──
  const cape = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.8, 3, 5),
    mat({ color: indigo, roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide, map: CLASS_TEXTURES.wraith })
  );
  cape.name = 'cape';
  cape.position.set(-0.1, -0.05, -0.24);
  cape.rotation.x = 0.15;
  cape.rotation.y = 0.15;
  extras.add(cape);

  // ── Shadow tendrils behind body ──
  const tendrilMat = mat({ color: 0x2b1d4e, emissive: 0x1a0e30, emissiveIntensity: 0.3, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
  const tendrilGeo = new THREE.PlaneGeometry(0.06, 0.6, 1, 4);
  for (let i = 0; i < 5; i++) {
    const tendril = new THREE.Mesh(tendrilGeo, tendrilMat);
    tendril.name = `tendril${i}`;
    const t = i / 4; // 0 to 1
    tendril.position.set(
      -0.3 + t * 0.6,
      -0.1,
      -0.25 - t * 0.025 + (i % 2) * 0.025 - 0.025
    );
    tendril.rotation.x = 0.2 + (i * 0.15);
    tendril.rotation.z = (i - 2) * 0.12;
    extras.add(tendril);
  }

  // ── Legs: tapered leather limbs via createTaperedLimb ──
  const leftLeg = legs.getObjectByName('leftLeg');
  const rightLeg = legs.getObjectByName('rightLeg');

  const leftLegMesh = createTaperedLimb(0.095, 0.07, 0.58, 16, UV_REGIONS.LEGS, leatherMat);
  leftLeg.geometry.dispose();
  leftLeg.geometry = leftLegMesh.geometry;
  leftLeg.material = leatherMat;

  const rightLegMesh = createTaperedLimb(0.095, 0.07, 0.58, 16, UV_REGIONS.LEGS, leatherMat);
  rightLeg.geometry.dispose();
  rightLeg.geometry = rightLegMesh.geometry;
  rightLeg.material = leatherMat;

  // Update feet material
  const leftFoot = leftLeg.getObjectByName('leftFoot');
  const rightFoot = rightLeg.getObjectByName('rightFoot');
  if (leftFoot) leftFoot.material = leatherMat;
  if (rightFoot) rightFoot.material = leatherMat;

  // ── Shadow mote particles ──
  const moteMat = mat({ color: 0x2b1d4e, emissive: 0x6633aa, emissiveIntensity: 1.5, transparent: true, opacity: 0.6 });
  const moteGeo = new THREE.SphereGeometry(0.025, 8, 6);
  for (let i = 0; i < 4; i++) {
    const mote = new THREE.Mesh(moteGeo, moteMat);
    mote.name = `shadowMote${i}`;
    const angle = (i / 4) * Math.PI * 2;
    mote.position.set(
      Math.cos(angle) * 0.5,
      0,
      Math.sin(angle) * 0.5
    );
    body.add(mote);
  }

  return root;
}

// ─────────────────────────────────────────────────────────────────────────────

function buildInfernal() {
  const root = buildBaseSkeleton();
  const body = root.getObjectByName('body');
  const head = root.getObjectByName('head');
  const leftArm = root.getObjectByName('leftArm');
  const rightArm = root.getObjectByName('rightArm');
  const extras = root.getObjectByName('extras');
  const legs = root.getObjectByName('legs');

  // --- Palette: deep crimson robes with gold/amber emissive accents (bright for textures) ---
  const deepCrimson = 0xc05050;
  const charcoal = 0x7a6868;
  const gold = 0xd4b860;
  const emberOrange = 0xff5500;
  const robeMat = mat({ color: deepCrimson, roughness: 0.72, metalness: 0.08, map: CLASS_TEXTURES.infernal });
  const darkRobeMat = mat({ color: charcoal, roughness: 0.8, metalness: 0.05, map: CLASS_TEXTURES.infernal });
  const goldMat = mat({ color: gold, metalness: 0.6, roughness: 0.35, map: CLASS_TEXTURES.infernal });
  const skinMat = mat({ color: 0x9e8672, roughness: 0.85, metalness: 0.0 });

  // ── Robe: single flowing profile from collar to flared hem ──
  const robeProfile = [
    new THREE.Vector2(0.12, 0.5),    // Collar
    new THREE.Vector2(0.22, 0.38),   // Shoulders
    new THREE.Vector2(0.26, 0.25),   // Upper chest
    new THREE.Vector2(0.24, 0.1),    // Chest
    new THREE.Vector2(0.20, -0.05),  // Waist (cinched by sash)
    new THREE.Vector2(0.26, -0.2),   // Below sash
    new THREE.Vector2(0.32, -0.35),  // Mid skirt
    new THREE.Vector2(0.38, -0.5),   // Lower skirt
    new THREE.Vector2(0.42, -0.6),   // Hem flare
  ];
  const robe = createProfileMesh(robeProfile, 20, UV_REGIONS.TORSO, robeMat);
  robe.name = 'torso';
  body.add(robe);

  // Update neck material
  const neck = root.getObjectByName('neck');
  if (neck) neck.material = skinMat;

  // ── Ornate belt / sash around waist ──
  const sash = new THREE.Mesh(
    new THREE.TorusGeometry(0.21, 0.03, 12, 24),
    goldMat
  );
  sash.name = 'belt';
  sash.position.y = -0.05;
  sash.rotation.x = Math.PI / 2;
  body.add(sash);

  // Sash gem / clasp
  const sashGem = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.04, 0),
    mat({ color: emberOrange, emissive: emberOrange, emissiveIntensity: 0.8, roughness: 0.2, metalness: 0.3 })
  );
  sashGem.name = 'sashGem';
  sashGem.position.set(0, -0.05, 0.23);
  body.add(sashGem);

  // ── Head: wizened face with wide-brim pointed hat ──
  const headGeo = new THREE.SphereGeometry(0.2, 24, 16);
  _remapUVs(headGeo, UV_REGIONS.HEAD);
  const headMesh = new THREE.Mesh(
    headGeo,
    mat({ color: 0x9e8672, roughness: 0.85, metalness: 0.0, map: CLASS_TEXTURES.infernal })
  );
  headMesh.name = 'headMesh';
  head.add(headMesh);

  // Pointed hat — wide brim tapering to a point via createProfileMesh
  const hatProfile = [
    new THREE.Vector2(0.32, 0),     // Brim edge
    new THREE.Vector2(0.30, 0.02),  // Brim
    new THREE.Vector2(0.16, 0.04),  // Brim inner edge
    new THREE.Vector2(0.15, 0.06),  // Hat base
    new THREE.Vector2(0.12, 0.18),  // Mid cone
    new THREE.Vector2(0.08, 0.30),  // Upper
    new THREE.Vector2(0.03, 0.40),  // Near tip
    new THREE.Vector2(0, 0.44),     // Tip
  ];
  const hatMat = mat({ color: charcoal, roughness: 0.75, metalness: 0.1, map: CLASS_TEXTURES.infernal });
  const hat = createProfileMesh(hatProfile, 24, UV_REGIONS.HEAD, hatMat);
  hat.name = 'hat';
  hat.position.y = 0.12;
  head.add(hat);

  // ── Arms: thinner mage arms using createTaperedLimb ──
  const leftUpperArm = createTaperedLimb(0.06, 0.045, 0.48, 16, UV_REGIONS.SHOULDERS, robeMat);
  leftUpperArm.name = 'upperArm';
  leftUpperArm.position.y = -0.25;
  leftArm.add(leftUpperArm);

  // Left hand
  const leftHand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), skinMat);
  leftHand.name = 'hand';
  leftHand.position.y = -0.55;
  leftArm.add(leftHand);

  // Left palm glow orb
  const palmGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 10, 8),
    mat({ color: emberOrange, emissive: 0xff6600, emissiveIntensity: 1.5, roughness: 0.1, metalness: 0.0, transparent: true, opacity: 0.7 })
  );
  palmGlow.name = 'leftPalmGlow';
  palmGlow.position.y = -0.55;
  leftArm.add(palmGlow);

  const rightUpperArm = createTaperedLimb(0.06, 0.045, 0.48, 16, UV_REGIONS.SHOULDERS, robeMat);
  rightUpperArm.name = 'upperArm';
  rightUpperArm.position.y = -0.25;
  rightArm.add(rightUpperArm);

  // Right hand
  const rightHand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), skinMat);
  rightHand.name = 'rightHand';
  rightHand.position.y = -0.55;
  rightArm.add(rightHand);

  // ── Staff: ornate arcane staff with metal claw cage and large crystal ──
  const staffMat = mat({ color: 0x8a6a48, roughness: 0.85, metalness: 0.05, map: WEAPON_TEXTURES.infernal_staff });

  // Staff shaft — slightly tapered
  const staff = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.035, 2.0, 12),
    staffMat
  );
  staff.name = 'weapon';
  staff.scale.set(1.4, 1.4, 1.4);
  staff.position.y = -0.35;
  rightArm.add(staff);

  // Decorative metal bands on shaft
  const bandMat = mat({ color: 0xc0a040, metalness: 0.85, roughness: 0.2 });
  for (let b = 0; b < 3; b++) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.008, 8, 16), bandMat);
    band.position.y = -0.2 + b * 0.3;
    band.rotation.x = Math.PI / 2;
    staff.add(band);
  }

  // ── Metal claw cage holding the crystal (4 prongs) ──
  const clawMat = mat({ color: 0x8a7040, metalness: 0.8, roughness: 0.3 });
  for (let c = 0; c < 4; c++) {
    const angle = (c / 4) * Math.PI * 2;
    const clawPts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const spread = Math.sin(t * Math.PI) * 0.08;
      clawPts.push(new THREE.Vector3(
        Math.cos(angle) * (0.03 + spread),
        0.55 + t * 0.22,
        Math.sin(angle) * (0.03 + spread)
      ));
    }
    const clawCurve = new THREE.CatmullRomCurve3(clawPts);
    const clawGeo = new THREE.TubeGeometry(clawCurve, 10, 0.01, 6, false);
    staff.add(new THREE.Mesh(clawGeo, clawMat));
  }

  // Glowing crystal on staff tip — larger, more dramatic
  const crystal = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.14, 1),
    mat({
      color: emberOrange,
      emissive: 0xff6600,
      emissiveIntensity: 2.0,
      roughness: 0.1,
      metalness: 0.4,
    })
  );
  crystal.name = 'staffCrystal';
  crystal.position.y = 0.72;
  staff.add(crystal);

  // Inner core glow (smaller brighter sphere inside crystal)
  const coreGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 10, 8),
    mat({
      color: 0xffaa00,
      emissive: 0xff8800,
      emissiveIntensity: 3.0,
      roughness: 0.0,
      metalness: 0.0,
      transparent: true,
      opacity: 0.7,
    })
  );
  coreGlow.name = 'crystalCore';
  coreGlow.position.y = 0.72;
  staff.add(coreGlow);

  // Floating flame particle above staff
  const staffFlame = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 10, 8),
    mat({
      color: 0xff6600,
      emissive: 0xff4400,
      emissiveIntensity: 2.5,
      roughness: 0.1,
      metalness: 0.0,
      transparent: true,
      opacity: 0.85,
    })
  );
  staffFlame.name = 'staffFlame';
  staffFlame.position.y = 0.92;
  staff.add(staffFlame);

  // Orbiting ember sparks (3 around crystal)
  const emberMat = mat({
    color: 0xff4500, emissive: 0xff6600, emissiveIntensity: 2.0,
    roughness: 0.1, metalness: 0.0, transparent: true, opacity: 0.8,
  });
  for (let e = 0; e < 3; e++) {
    const eAngle = (e / 3) * Math.PI * 2;
    const ember = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), emberMat);
    ember.name = e === 0 ? 'ember' : `ember${e + 1}`;
    ember.position.set(Math.cos(eAngle) * 0.1, 0.25 + e * 0.06, Math.sin(eAngle) * 0.1);
    crystal.add(ember);
  }

  // ── Legs: minimal, hidden under robe ──
  const leftLeg = legs.getObjectByName('leftLeg');
  const rightLeg = legs.getObjectByName('rightLeg');

  const leftLegMesh = createTaperedLimb(0.08, 0.06, 0.5, 12, UV_REGIONS.LEGS, robeMat);
  leftLegMesh.name = 'leftLegRobe';
  leftLeg.add(leftLegMesh);
  leftLeg.material = darkRobeMat;

  const rightLegMesh = createTaperedLimb(0.08, 0.06, 0.5, 12, UV_REGIONS.LEGS, robeMat);
  rightLegMesh.name = 'rightLegRobe';
  rightLeg.add(rightLegMesh);
  rightLeg.material = darkRobeMat;

  // Hide feet under robe
  const leftFoot = leftLeg.getObjectByName('leftFoot');
  const rightFoot = rightLeg.getObjectByName('rightFoot');
  if (leftFoot) leftFoot.material = darkRobeMat;
  if (rightFoot) rightFoot.material = darkRobeMat;


  // ── Enhancement 1: Flame Crown (on top of existing hat) ──
  const crown = new THREE.Group();
  crown.name = 'crown';

  const crownBase = new THREE.Mesh(
    new THREE.TorusGeometry(0.18, 0.02, 16, 24),
    mat({ color: 0x1a0a00, metalness: 0.6, roughness: 0.4, emissive: 0xff4400, emissiveIntensity: 0.3 })
  );
  crownBase.name = 'crownBase';
  crownBase.position.set(0, 0.15, 0);
  crownBase.rotation.x = Math.PI / 2;
  crown.add(crownBase);

  const crownSpikeMat = mat({
    emissive: 0xff6600,
    emissiveIntensity: 1.8,
    color: 0xff4400,
    transparent: true,
    opacity: 0.85,
  });
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    const spike = new THREE.Mesh(
      new THREE.ConeGeometry(0.03, 0.12, 6),
      crownSpikeMat
    );
    spike.name = 'crownSpike' + i;
    spike.position.set(
      0.18 * Math.cos(angle),
      0.15,
      0.18 * Math.sin(angle)
    );
    // Tilt outward away from center
    spike.rotation.z = -Math.cos(angle) * 0.3;
    spike.rotation.x = Math.sin(angle) * 0.3;
    crown.add(spike);
  }

  head.add(crown);

  // ── Enhancement 2: Chest Fire Gem ──
  const chestGem = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.055, 0),
    mat({ color: 0xff8800, emissive: 0xff6600, emissiveIntensity: 2.5, metalness: 0.3, roughness: 0.2 })
  );
  chestGem.name = 'chestGem';
  chestGem.position.set(0, 0.15, 0.28);
  body.add(chestGem);

  // ── Enhancement 3: Lava Crack Emissive Lines on Robe ──
  const lavaCrackMat = mat({
    emissive: 0xff4400,
    emissiveIntensity: 1.2,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const lavaCrackPositions = [
    { pos: [0.15, 0.0, 0.22], rot: { y: 0.3 } },
    { pos: [-0.12, -0.1, 0.24], rot: { y: -0.2 } },
    { pos: [0.08, -0.25, 0.20], rot: { y: 0.5, z: 0.4 } },
    { pos: [-0.18, 0.1, 0.18], rot: { y: -0.4, z: -0.3 } },
  ];
  lavaCrackPositions.forEach((cfg, i) => {
    const crack = new THREE.Mesh(
      new THREE.PlaneGeometry(0.01, 0.4),
      lavaCrackMat
    );
    crack.name = 'lavaCrack' + i;
    crack.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
    if (cfg.rot.y !== undefined) crack.rotation.y = cfg.rot.y;
    if (cfg.rot.z !== undefined) crack.rotation.z = cfg.rot.z;
    body.add(crack);
  });

  // ── Enhancement 4: Floating Fire Particles ──
  const fireParticleMat = mat({
    color: 0xff4400,
    emissive: 0xff4400,
    emissiveIntensity: 2.5,
    transparent: true,
    opacity: 0.7,
  });
  const fireParticleConfigs = [
    { angle: 0, y: 0.5, radius: 0.35 },
    { angle: Math.PI / 3, y: 0.2, radius: 0.38 },
    { angle: 2 * Math.PI / 3, y: -0.1, radius: 0.32 },
    { angle: Math.PI, y: -0.3, radius: 0.36 },
    { angle: 4 * Math.PI / 3, y: 0.1, radius: 0.34 },
    { angle: 5 * Math.PI / 3, y: 0.35, radius: 0.30 },
  ];
  fireParticleConfigs.forEach((cfg, i) => {
    const particle = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 6, 4),
      fireParticleMat
    );
    particle.name = 'fireParticle' + i;
    particle.position.set(
      cfg.radius * Math.cos(cfg.angle),
      cfg.y,
      cfg.radius * Math.sin(cfg.angle)
    );
    body.add(particle);
  });

  return root;
}

// ─────────────────────────────────────────────────────────────────────────────

function buildHarbinger() {
  const root = buildBaseSkeleton();
  const body = root.getObjectByName('body');
  const head = root.getObjectByName('head');
  const leftArm = root.getObjectByName('leftArm');
  const rightArm = root.getObjectByName('rightArm');
  const extras = root.getObjectByName('extras');
  const legs = root.getObjectByName('legs');

  // --- Palette: dark green with purple emissive, decrepit and eldritch (bright for textures) ---
  const darkGreen = 0x5a8a50;
  const rotGreen = 0x6a9a60;
  const purpleAccent = 0x7722bb;
  const boneColor = 0xb0a890;
  const robeMat = mat({ color: darkGreen, roughness: 0.65, metalness: 0.15, map: CLASS_TEXTURES.harbinger });
  const rotMat = mat({ color: rotGreen, roughness: 0.75, metalness: 0.1, map: CLASS_TEXTURES.harbinger });
  const boneMat = mat({ color: boneColor, roughness: 0.7, metalness: 0.2, map: CLASS_TEXTURES.harbinger });

  // ── Torso: hunched tattered robe via createProfileMesh ──
  const robeProfile = [
    new THREE.Vector2(0.14, 0.5),    // Hunched shoulder
    new THREE.Vector2(0.24, 0.35),   // Upper
    new THREE.Vector2(0.28, 0.2),    // Chest
    new THREE.Vector2(0.22, 0),      // Gaunt waist
    new THREE.Vector2(0.26, -0.15),  // Below waist
    new THREE.Vector2(0.30, -0.3),   // Skirt
    new THREE.Vector2(0.35, -0.45),  // Ragged hem
    new THREE.Vector2(0.32, -0.55),  // Bottom
  ];
  const torso = createProfileMesh(robeProfile, 16, UV_REGIONS.TORSO, robeMat);
  torso.name = 'torso';
  torso.rotation.x = 0.12; // hunched forward posture
  body.add(torso);

  // Update neck material
  const neck = root.getObjectByName('neck');
  if (neck) neck.material = robeMat;

  // Tattered robe strips — thin PlaneGeometry hanging from waist
  const stripMat = mat({ color: darkGreen, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide, map: CLASS_TEXTURES.harbinger });
  const stripPositions = [
    { x: -0.22, z: 0.2, rot: 0.15, h: 0.45, w: 0.1 },
    { x: 0.18, z: 0.22, rot: 0.1, h: 0.4, w: 0.08 },
    { x: 0.0, z: -0.22, rot: -0.12, h: 0.42, w: 0.09 },
  ];
  stripPositions.forEach((s, i) => {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h, 1, 3), stripMat);
    strip.name = `robeStrip${i + 1}`;
    strip.position.set(s.x, -0.65, s.z);
    strip.rotation.x = s.rot;
    body.add(strip);
  });

  // ── Head: gaunt skull via createProfileMesh ──
  const skullProfile = [
    new THREE.Vector2(0.13, 0),       // Jaw (1.3x)
    new THREE.Vector2(0.208, 0.065),  // Lower face (1.3x)
    new THREE.Vector2(0.247, 0.156),  // Cheek (1.3x)
    new THREE.Vector2(0.234, 0.26),   // Temple (1.3x)
    new THREE.Vector2(0.195, 0.364),  // Crown (1.3x)
    new THREE.Vector2(0.13, 0.429),   // Upper skull (1.3x)
    new THREE.Vector2(0.052, 0.468),  // Top (1.3x)
    new THREE.Vector2(0, 0.494),      // Peak (1.3x)
  ];
  const skullMat = mat({ color: 0x7a8070, roughness: 0.75, metalness: 0.1, map: CLASS_TEXTURES.harbinger });
  const headMesh = createProfileMesh(skullProfile, 24, UV_REGIONS.HEAD, skullMat);
  headMesh.name = 'headMesh';
  head.add(headMesh);

  // Hood / cowl draped over head — UV remapped to HEAD region
  const cowlGeo = new THREE.SphereGeometry(0.24, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6);
  _remapUVs(cowlGeo, UV_REGIONS.HEAD);
  const cowl = new THREE.Mesh(cowlGeo, robeMat);
  cowl.name = 'cowl';
  cowl.position.set(0, 0.04, -0.04);
  head.add(cowl);

  // Curved horns — TubeGeometry + CatmullRomCurve3, ram-style with wide spread
  const hornMat = boneMat;
  const leftHornCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(-0.30, 0.25, 0.08),
    new THREE.Vector3(-0.38, 0.40, -0.05),
    new THREE.Vector3(-0.30, 0.50, -0.25),
    new THREE.Vector3(-0.20, 0.45, -0.35),
  ]);
  const leftHorn = new THREE.Mesh(
    new THREE.TubeGeometry(leftHornCurve, 16, 0.04, 16, false),
    hornMat
  );
  leftHorn.name = 'leftHorn';
  leftHorn.position.set(-0.08, 0.15, 0.05);
  head.add(leftHorn);

  const rightHornCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.30, 0.25, 0.08),
    new THREE.Vector3(0.38, 0.40, -0.05),
    new THREE.Vector3(0.30, 0.50, -0.25),
    new THREE.Vector3(0.20, 0.45, -0.35),
  ]);
  const rightHorn = new THREE.Mesh(
    new THREE.TubeGeometry(rightHornCurve, 16, 0.04, 16, false),
    hornMat
  );
  rightHorn.name = 'rightHorn';
  rightHorn.position.set(0.08, 0.15, 0.05);
  head.add(rightHorn);

  // Glowing green eyes
  const eyeMat = mat({ color: 0x33ff33, emissive: 0x44ff44, emissiveIntensity: 1.5, roughness: 0.2, metalness: 0.0 });
  const leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), eyeMat);
  leftEye.name = 'leftEye';
  leftEye.position.set(-0.07, 0.02, 0.17);
  head.add(leftEye);

  const rightEye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), eyeMat);
  rightEye.name = 'rightEye';
  rightEye.position.set(0.07, 0.02, 0.17);
  head.add(rightEye);

  // Jaw piece below skull
  const jaw = new THREE.Mesh(
    new THREE.BoxGeometry(0.10, 0.04, 0.08),
    boneMat
  );
  jaw.name = 'jaw';
  jaw.position.set(0, -0.05, 0.08);
  head.add(jaw);

  // Green point light on skull
  const skullLight = new THREE.PointLight(0x22ff22, 0.3, 0.8);
  skullLight.name = 'skullLight';
  skullLight.position.set(0, 0.05, 0.15);
  head.add(skullLight);

  // ── Arms: emaciated via createTaperedLimb ──
  const leftUpperArm = createTaperedLimb(0.055, 0.04, 0.5, 16, UV_REGIONS.SHOULDERS, robeMat);
  leftUpperArm.name = 'upperArm';
  leftUpperArm.position.y = -0.25;
  leftArm.add(leftUpperArm);

  // Left hand
  const handMat = mat({ color: 0x7a8070, roughness: 0.75, metalness: 0.1, map: CLASS_TEXTURES.harbinger });
  const leftHand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), handMat);
  leftHand.name = 'hand';
  leftHand.position.y = -0.52;
  leftArm.add(leftHand);

  // ── Open grimoire in left hand (two angled boxes like open book pages) ──
  const grimoireGroup = new THREE.Group();
  grimoireGroup.name = 'grimoire';
  grimoireGroup.position.y = -0.55;

  const pageMat = mat({
    color: 0x1a2a18,
    roughness: 0.5,
    metalness: 0.15,
    emissive: purpleAccent,
    emissiveIntensity: 0.4,
  });

  // Book spine
  const spine = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 0.22, 0.025),
    mat({ color: 0x1a1210, roughness: 0.8, metalness: 0.2 })
  );
  spine.name = 'grimoireSpine';
  grimoireGroup.add(spine);

  // Left page — angled box
  const leftPage = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.22, 0.015), pageMat);
  leftPage.name = 'grimoireLeft';
  leftPage.position.x = -0.07;
  leftPage.rotation.y = 0.3;
  grimoireGroup.add(leftPage);

  // Right page — angled box
  const rightPage = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.22, 0.015), pageMat);
  rightPage.name = 'grimoireRight';
  rightPage.position.x = 0.07;
  rightPage.rotation.y = -0.3;
  grimoireGroup.add(rightPage);

  leftArm.add(grimoireGroup);

  // Soul orb near grimoire — small emissive sphere named 'soulOrb'
  const soulOrb = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 12, 10),
    mat({
      color: 0x33ff66,
      emissive: 0x22dd44,
      emissiveIntensity: 1.8,
      roughness: 0.1,
      metalness: 0.0,
      transparent: true,
      opacity: 0.8,
    })
  );
  soulOrb.name = 'soulOrb';
  soulOrb.position.set(0.12, -0.5, 0.08);
  leftArm.add(soulOrb);

  // Right arm: emaciated via createTaperedLimb
  const rightUpperArm = createTaperedLimb(0.055, 0.04, 0.5, 16, UV_REGIONS.SHOULDERS, robeMat);
  rightUpperArm.name = 'upperArm';
  rightUpperArm.position.y = -0.25;
  rightArm.add(rightUpperArm);

  // Right hand
  const rightHandMesh = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), handMat);
  rightHandMesh.name = 'rightHand';
  rightHandMesh.position.y = -0.52;
  rightArm.add(rightHandMesh);

  // ── Staff: gnarled necromantic staff with detailed skull, bone prongs & soul crystal ──
  const staffWood = mat({ color: 0x7a5830, roughness: 0.88, metalness: 0.05, map: WEAPON_TEXTURES.harbinger_staff });
  const staff = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.035, 1.8, 12),
    staffWood
  );
  staff.name = 'weapon';
  staff.scale.set(1.4, 1.4, 1.4);
  staff.position.y = -0.4;
  rightArm.add(staff);

  // Gnarled wood knots along shaft
  const knotMat = mat({ color: 0x5a3820, roughness: 0.95, metalness: 0.0, map: WEAPON_TEXTURES.harbinger_staff });
  for (let k = 0; k < 3; k++) {
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), knotMat);
    knot.scale.set(1.2, 0.6, 1.0);
    knot.position.set((k % 2 === 0 ? 0.025 : -0.025), -0.3 + k * 0.35, 0.015);
    staff.add(knot);
  }

  // ── Skull atop staff — detailed cranium, brow, jaw, eye sockets ──
  const skullGrp = new THREE.Group();
  skullGrp.name = 'staffSkull';
  skullGrp.position.y = 0.64;
  staff.add(skullGrp);

  // Cranium (slightly elongated sphere)
  const cranium = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 14, 12),
    boneMat
  );
  cranium.scale.set(0.9, 1.15, 0.85);
  skullGrp.add(cranium);

  // Brow ridge (flattened torus across front)
  const browMat = mat({ color: 0x9a8e78, roughness: 0.85, metalness: 0.1 });
  const brow = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.015, 6, 12, Math.PI), browMat);
  brow.position.set(0, 0.015, 0.055);
  brow.rotation.x = -0.3;
  skullGrp.add(brow);

  // Eye sockets (dark recessed spheres)
  const eyeSocketMat = mat({ color: 0x111111, roughness: 1.0, metalness: 0.0 });
  const leftEyeSocket = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), eyeSocketMat);
  leftEyeSocket.position.set(-0.03, 0.01, 0.065);
  skullGrp.add(leftEyeSocket);
  const rightEyeSocket = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), eyeSocketMat);
  rightEyeSocket.position.set(0.03, 0.01, 0.065);
  skullGrp.add(rightEyeSocket);

  // Glowing eyes inside sockets
  const skullEyeMat = mat({ color: purpleAccent, emissive: purpleAccent, emissiveIntensity: 2.5, roughness: 0.1, metalness: 0.0 });
  const skullLeftEye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), skullEyeMat);
  skullLeftEye.name = 'skullEye';
  skullLeftEye.position.set(-0.03, 0.01, 0.072);
  skullGrp.add(skullLeftEye);
  const skullRightEye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), skullEyeMat);
  skullRightEye.position.set(0.03, 0.01, 0.072);
  skullGrp.add(skullRightEye);

  // Nasal cavity
  const skullNose = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.018, 0.01), eyeSocketMat);
  skullNose.position.set(0, -0.015, 0.07);
  skullGrp.add(skullNose);

  // Jawbone (smaller flattened sphere below cranium)
  const skullJaw = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), boneMat);
  skullJaw.name = 'skullJaw';
  skullJaw.scale.set(0.85, 0.5, 0.7);
  skullJaw.position.set(0, -0.06, 0.01);
  skullGrp.add(skullJaw);

  // Teeth row (tiny boxes across jaw front)
  const toothMat = mat({ color: 0xd0c8a8, roughness: 0.6, metalness: 0.2 });
  for (let t = -2; t <= 2; t++) {
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.012, 0.006), toothMat);
    tooth.position.set(t * 0.012, -0.045, 0.055);
    skullGrp.add(tooth);
  }

  // ── Bone prongs curving up from staff to cradle the skull ──
  const prongMat = mat({ color: 0xa09878, roughness: 0.8, metalness: 0.15 });
  for (let p = 0; p < 3; p++) {
    const angle = (p / 3) * Math.PI * 2 + 0.3;
    const prongPts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const r = 0.04 * (1 - t * 0.6); // taper outward then inward
      prongPts.push(new THREE.Vector3(
        Math.cos(angle) * r + Math.cos(angle) * t * 0.06,
        t * 0.14 + 0.5,
        Math.sin(angle) * r + Math.sin(angle) * t * 0.06
      ));
    }
    const prongCurve = new THREE.CatmullRomCurve3(prongPts);
    const prongGeo = new THREE.TubeGeometry(prongCurve, 8, 0.012, 6, false);
    const prong = new THREE.Mesh(prongGeo, prongMat);
    staff.add(prong);
  }

  // ── Soul crystal embedded in skull forehead ──
  const soulCrystal = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.03, 0),
    mat({ color: 0x44ff44, emissive: 0x22cc22, emissiveIntensity: 2.0, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.85 })
  );
  soulCrystal.name = 'soulCrystal';
  soulCrystal.position.set(0, 0.05, 0.07);
  soulCrystal.rotation.z = Math.PI / 4;
  skullGrp.add(soulCrystal);

  // ── Runic circle at feet — RingGeometry with green emissive glow, named 'runeCircle' ──
  const runeCircle = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.55, 24),
    mat({
      color: 0x33ff33,
      emissive: 0x22dd22,
      emissiveIntensity: 0.8,
      roughness: 0.3,
      metalness: 0.0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.5,
    })
  );
  runeCircle.name = 'runeCircle';
  runeCircle.position.y = -1.0;
  runeCircle.rotation.x = -Math.PI / 2;
  body.add(runeCircle);

  // ── Legs: hidden under robe, thin via createTaperedLimb ──
  const leftLeg = legs.getObjectByName('leftLeg');
  const rightLeg = legs.getObjectByName('rightLeg');
  const leftLegMesh = createTaperedLimb(0.07, 0.05, 0.55, 12, UV_REGIONS.LEGS, robeMat);
  leftLegMesh.name = 'leftLegMesh';
  leftLeg.add(leftLegMesh);
  leftLeg.material = rotMat;
  rightLeg.material = rotMat;

  const rightLegMesh = createTaperedLimb(0.07, 0.05, 0.55, 12, UV_REGIONS.LEGS, robeMat);
  rightLegMesh.name = 'rightLegMesh';
  rightLeg.add(rightLegMesh);

  // Hide feet under robe
  const leftFoot = leftLeg.getObjectByName('leftFoot');
  const rightFoot = rightLeg.getObjectByName('rightFoot');
  if (leftFoot) leftFoot.material = rotMat;
  if (rightFoot) rightFoot.material = rotMat;

  // ── Green aura particles — 6 small emissive spheres floating around body ──
  const auraMat = mat({
    color: 0x115511,
    emissive: 0x22ff22,
    emissiveIntensity: 1.0,
    transparent: true,
    opacity: 0.6,
  });
  const auraPositions = [
    { x: 0.4, y: -0.4, z: 0.0 },
    { x: -0.35, y: -0.2, z: 0.2 },
    { x: 0.2, y: 0.0, z: -0.35 },
    { x: -0.3, y: 0.1, z: -0.25 },
    { x: 0.0, y: 0.3, z: 0.4 },
    { x: 0.35, y: -0.1, z: 0.2 },
  ];
  auraPositions.forEach((p, i) => {
    const mote = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), auraMat);
    mote.name = `auraMote${i}`;
    mote.position.set(p.x, p.y, p.z);
    body.add(mote);
  });

  // ── Bone decorations — 3 small tapered bone cylinders dangling from body ──
  const boneDecoMat = mat({ color: 0xd2c8a0, roughness: 0.6, metalness: 0.2 });
  const boneDecoPositions = [
    { x: -0.15, y: -0.2, z: 0.2 },
    { x: 0.1, y: -0.25, z: 0.22 },
    { x: 0.0, y: 0.35, z: 0.18 },
  ];
  boneDecoPositions.forEach((p, i) => {
    const bone = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.008, 0.1, 6),
      boneDecoMat
    );
    bone.name = `boneDeco${i}`;
    bone.position.set(p.x, p.y, p.z);
    body.add(bone);
  });

  return root;
}

// ─────────────────────────────────────────────────────────────────────────────

function buildRevenant() {
  const root = buildBaseSkeleton();
  const body = root.getObjectByName('body');
  const head = root.getObjectByName('head');
  const leftArm = root.getObjectByName('leftArm');
  const rightArm = root.getObjectByName('rightArm');
  const extras = root.getObjectByName('extras');
  const legs = root.getObjectByName('legs');

  // --- Palette: cream / white plate with gold and holy glow ---
  const ivory = 0xe8e0cc;
  const warmWhite = 0xf0ead6;
  const goldColor = 0xc9a84c;
  const royalBlue = 0x5570bb;
  const holyGlow = 0xffeebb;
  const plateMat = mat({ color: ivory, metalness: 0.82, roughness: 0.18, map: CLASS_TEXTURES.revenant });
  const goldMat = mat({ color: goldColor, metalness: 0.75, roughness: 0.2, emissive: goldColor, emissiveIntensity: 0.3, map: CLASS_TEXTURES.revenant });
  const blueMat = mat({ color: royalBlue, roughness: 0.65, metalness: 0.05, map: CLASS_TEXTURES.revenant });

  // ── Torso: sculpted plate armor (LatheGeometry — gorget → chest → tapered waist) ──
  const torsoProfile = [
    new THREE.Vector2(0.25, -0.45),  // bottom hem
    new THREE.Vector2(0.28, -0.3),   // hip
    new THREE.Vector2(0.30, -0.1),   // waist taper
    new THREE.Vector2(0.35,  0.1),   // widest chest
    new THREE.Vector2(0.32,  0.25),  // upper chest
    new THREE.Vector2(0.20,  0.4),   // neck base
    new THREE.Vector2(0.15,  0.5),   // gorget top
  ];
  const torso = createProfileMesh(torsoProfile, 24, UV_REGIONS.TORSO, plateMat);
  torso.name = 'torso';
  body.add(torso);

  // Update neck material
  const neckNode = root.getObjectByName('neck');
  if (neckNode) neckNode.material = plateMat;

  // ── Tabard on chest front — PlaneGeometry with cross made from two overlapping thin planes ──
  const tabard = new THREE.Mesh(
    new THREE.PlaneGeometry(0.36, 0.6, 1, 3),
    mat({ color: royalBlue, roughness: 0.7, metalness: 0.0, side: THREE.DoubleSide })
  );
  tabard.name = 'tabard';
  tabard.position.set(0, -0.15, 0.27);
  body.add(tabard);

  // Cross on tabard — vertical + horizontal gold bars (two overlapping thin planes)
  const crossMat = mat({ color: goldColor, metalness: 0.65, roughness: 0.25, emissive: 0xc9a84c, emissiveIntensity: 0.3 });
  const crossVert = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.28), crossMat);
  crossVert.name = 'crossVert';
  crossVert.position.set(0, -0.12, 0.28);
  body.add(crossVert);

  const crossHoriz = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.035), crossMat);
  crossHoriz.name = 'crossHoriz';
  crossHoriz.position.set(0, -0.06, 0.28);
  body.add(crossHoriz);

  // Belt with gold buckle
  const belt = new THREE.Mesh(
    new THREE.TorusGeometry(0.36, 0.03, 12, 24),
    mat({ color: 0x3a2f20, roughness: 0.8, metalness: 0.15 })
  );
  belt.name = 'belt';
  belt.position.y = -0.42;
  belt.rotation.x = Math.PI / 2;
  body.add(belt);

  const beltBuckle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.025, 10),
    goldMat
  );
  beltBuckle.name = 'beltBuckle';
  beltBuckle.position.set(0, -0.42, 0.35);
  beltBuckle.rotation.x = Math.PI / 2;
  body.add(beltBuckle);

  // Chain mail hint at waist — ring of small torus
  const chainMailMat = mat({ color: 0x888888, metalness: 0.7, roughness: 0.35 });
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const chainLink = new THREE.Mesh(
      new THREE.TorusGeometry(0.02, 0.005, 6, 8),
      chainMailMat
    );
    chainLink.name = `chainLink${i}`;
    chainLink.position.set(
      Math.sin(angle) * 0.34,
      -0.48,
      Math.cos(angle) * 0.34
    );
    chainLink.rotation.x = Math.PI / 2;
    chainLink.rotation.z = angle;
    body.add(chainLink);
  }

  // ── Shoulder guards — sculpted rounded pauldrons (LatheGeometry dome) ──
  const shoulderProfile = [
    new THREE.Vector2(0.0,   0.12),  // dome apex
    new THREE.Vector2(0.08,  0.11),  // upper dome curve
    new THREE.Vector2(0.14,  0.08),  // mid dome
    new THREE.Vector2(0.17,  0.04),  // lower dome flare
    new THREE.Vector2(0.18,  0.0),   // base edge
    new THREE.Vector2(0.15, -0.02),  // undercut lip
  ];

  const leftShoulder = createProfileMesh(shoulderProfile, 20, UV_REGIONS.SHOULDERS, plateMat);
  leftShoulder.name = 'leftShoulder';
  leftShoulder.position.set(-0.48, 0.44, 0);
  body.add(leftShoulder);

  // Gold shoulder trim
  const shoulderTrimGeo = new THREE.TorusGeometry(0.16, 0.012, 8, 16);
  const leftShoulderTrim = new THREE.Mesh(shoulderTrimGeo, goldMat);
  leftShoulderTrim.name = 'leftShoulderTrim';
  leftShoulderTrim.position.set(-0.48, 0.42, 0);
  leftShoulderTrim.rotation.x = Math.PI / 2;
  body.add(leftShoulderTrim);

  const rightShoulder = createProfileMesh(shoulderProfile, 20, UV_REGIONS.SHOULDERS, plateMat);
  rightShoulder.name = 'rightShoulder';
  rightShoulder.position.set(0.48, 0.44, 0);
  body.add(rightShoulder);

  const rightShoulderTrim = new THREE.Mesh(shoulderTrimGeo, goldMat);
  rightShoulderTrim.name = 'rightShoulderTrim';
  rightShoulderTrim.position.set(0.48, 0.42, 0);
  rightShoulderTrim.rotation.x = Math.PI / 2;
  body.add(rightShoulderTrim);

  // ── Head: sculpted great helm (LatheGeometry — neck collar → jaw → crown dome) ──
  const helmetProfile = [
    new THREE.Vector2(0.15, 0.0),    // neck opening (base)
    new THREE.Vector2(0.22, 0.08),   // jaw widens
    new THREE.Vector2(0.22, 0.15),   // face area
    new THREE.Vector2(0.21, 0.25),   // temple narrows slightly
    new THREE.Vector2(0.18, 0.30),   // crown taper begins
    new THREE.Vector2(0.12, 0.35),   // upper crown
    new THREE.Vector2(0.04, 0.38),   // near apex
    new THREE.Vector2(0.0,  0.4),    // dome tip
  ];
  const headMesh = createProfileMesh(helmetProfile, 24, UV_REGIONS.HEAD, plateMat);
  headMesh.name = 'headMesh';
  head.add(headMesh);

  // Visor slit
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.02, 0.04),
    mat({ color: 0x111111, roughness: 1.0, metalness: 0.0 })
  );
  visor.name = 'visor';
  visor.position.set(0, 0.12, 0.21);
  head.add(visor);

  // Gold trim around helmet face
  const helmetTrim = new THREE.Mesh(
    new THREE.TorusGeometry(0.21, 0.012, 8, 20),
    goldMat
  );
  helmetTrim.name = 'helmetTrim';
  helmetTrim.position.set(0, 0.12, 0.04);
  helmetTrim.rotation.x = Math.PI / 2;
  head.add(helmetTrim);

  // ── Halo: floating golden ring above head (TorusGeometry, gold emissive, named 'halo') ──
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.25, 0.025, 16, 32),
    mat({
      color: goldColor,
      metalness: 0.7,
      roughness: 0.2,
      emissive: holyGlow,
      emissiveIntensity: 0.3,
    })
  );
  halo.name = 'halo';
  halo.position.y = 0.50;
  halo.rotation.x = Math.PI / 2;
  head.add(halo);

  // ── Halo Light Rays: 4 PlaneGeometry strips radiating outward ──
  const haloRayMat = mat({
    color: 0x000000,
    emissive: 0xffd700,
    emissiveIntensity: 0.2,
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const haloRayGeo = new THREE.PlaneGeometry(0.03, 0.4);
  for (let i = 0; i < 4; i++) {
    const ray = new THREE.Mesh(haloRayGeo, haloRayMat);
    ray.name = `haloRay${i}`;
    const angle = (i / 4) * Math.PI * 2; // 0, 90, 180, 270 degrees
    ray.position.set(Math.cos(angle) * 0.2, 0, Math.sin(angle) * 0.2);
    ray.rotation.x = Math.PI / 2;
    ray.rotation.z = angle;
    halo.add(ray);
  }

  // ── Arms: tapered plate limbs ──
  const armMat = mat({ color: ivory, metalness: 0.78, roughness: 0.2, map: CLASS_TEXTURES.revenant });

  const leftUpperArm = createTaperedLimb(0.09, 0.07, 0.5, 16, UV_REGIONS.SHOULDERS, armMat);
  leftUpperArm.name = 'upperArm';
  leftUpperArm.position.y = -0.3;
  leftArm.add(leftUpperArm);

  // Left hand
  const leftHand = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 10), armMat);
  leftHand.name = 'hand';
  leftHand.position.y = -0.58;
  leftArm.add(leftHand);

  // ── Kite shield on left arm (ExtrudeGeometry — pointed bottom, rounded top) ──
  const shieldShape = new THREE.Shape();
  shieldShape.moveTo(0, -0.30);                                    // pointed bottom tip
  shieldShape.quadraticCurveTo(0.18, -0.15, 0.25, 0.05);          // right lower curve
  shieldShape.quadraticCurveTo(0.26, 0.22, 0.12, 0.30);           // right upper curve
  shieldShape.quadraticCurveTo(0.0, 0.34, -0.12, 0.30);           // top center arc
  shieldShape.quadraticCurveTo(-0.26, 0.22, -0.25, 0.05);         // left upper curve
  shieldShape.quadraticCurveTo(-0.18, -0.15, 0, -0.30);           // left lower curve back to tip

  const shieldMat = mat({ color: warmWhite, metalness: 0.75, roughness: 0.25, side: THREE.DoubleSide, map: WEAPON_TEXTURES.revenant_mace });
  const shieldFace = createExtrudedMesh(shieldShape, {
    depth: 0.03,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.008,
    bevelSegments: 2,
  }, UV_REGIONS.SHOULDERS, shieldMat);
  shieldFace.name = 'shield';
  shieldFace.position.set(-0.15, -0.55, 0.15);
  shieldFace.rotation.y = Math.PI;
  leftArm.add(shieldFace);

  // Gold shield rim
  const shieldRim = new THREE.Mesh(
    new THREE.TorusGeometry(0.28, 0.018, 10, 20),
    goldMat
  );
  shieldRim.name = 'shieldRim';
  shieldRim.position.set(-0.15, -0.55, 0.15);
  shieldRim.rotation.y = Math.PI / 2;
  leftArm.add(shieldRim);

  // Shield boss (center bump)
  const shieldBoss = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 12, 10),
    goldMat
  );
  shieldBoss.name = 'shieldBoss';
  shieldBoss.position.set(-0.15, -0.55, 0.2);
  leftArm.add(shieldBoss);

  // ── Shield Cross Glow: emissive gold overlay on shield face ──
  const shieldCrossGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.06, 0.35),
    mat({
      color: 0x000000,
      emissive: 0xffd700,
      emissiveIntensity: 1.2,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  shieldCrossGlow.name = 'shieldCrossGlow';
  shieldCrossGlow.position.set(-0.15, -0.55, 0.22);
  shieldCrossGlow.rotation.y = Math.PI;
  leftArm.add(shieldCrossGlow);

  // Right arm
  const rightUpperArm = createTaperedLimb(0.09, 0.07, 0.5, 16, UV_REGIONS.SHOULDERS, armMat);
  rightUpperArm.name = 'upperArm';
  rightUpperArm.position.y = -0.3;
  rightArm.add(rightUpperArm);

  // Right hand
  const rightHand = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 10), armMat);
  rightHand.name = 'rightHand';
  rightHand.position.y = -0.58;
  rightArm.add(rightHand);

  // ── Weapon: mace with sculpted flanged head (LatheGeometry) ──
  const maceShaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.03, 1.0, 12),
    mat({ color: 0x8a7a60, roughness: 0.85, metalness: 0.1, map: WEAPON_TEXTURES.revenant_mace })
  );
  maceShaft.name = 'weapon';
  maceShaft.scale.set(1.5, 1.5, 1.5);
  maceShaft.position.y = -0.45;
  rightArm.add(maceShaft);

  // Mace head — flanged profile with ridges via LatheGeometry
  const maceHeadProfile = [
    new THREE.Vector2(0.02, 0.0),    // base of head (narrow stem)
    new THREE.Vector2(0.08, 0.02),   // swell outward
    new THREE.Vector2(0.12, 0.04),   // first ridge peak
    new THREE.Vector2(0.06, 0.06),   // valley between ridges
    new THREE.Vector2(0.11, 0.08),   // second ridge peak
    new THREE.Vector2(0.04, 0.10),   // narrow above ridges
    new THREE.Vector2(0.0,  0.12),   // tip (closed)
  ];
  const maceHead = createProfileMesh(maceHeadProfile, 16, UV_REGIONS.SHOULDERS, goldMat);
  maceHead.name = 'maceHead';
  maceHead.position.y = 0.45;
  maceShaft.add(maceHead);

  // Mace pommel
  const macePommel = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 10, 8),
    goldMat
  );
  macePommel.name = 'macePommel';
  macePommel.position.y = -0.48;
  maceShaft.add(macePommel);

  // ── Cape: shorter elegant cape from shoulders ──
  const cape = new THREE.Mesh(
    new THREE.PlaneGeometry(0.6, 0.75, 3, 5),
    mat({ color: royalBlue, roughness: 0.8, metalness: 0.0, side: THREE.DoubleSide })
  );
  cape.name = 'cape';
  cape.position.set(0, -0.1, -0.26);
  cape.rotation.x = 0.1;
  extras.add(cape);

  // ── Angel Wings: 5 feather-layer fan on each side ──
  const wingMat = mat({
    color: 0xf5eedd,
    emissive: 0xffeebb,
    emissiveIntensity: 0.4,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.85,
  });
  const featherGeo = new THREE.PlaneGeometry(0.15, 0.55);

  // Left Wing
  const leftWing = new THREE.Group();
  leftWing.name = 'leftWing';
  leftWing.position.set(-0.15, 0.25, -0.25);
  leftWing.rotation.y = -0.3;
  body.add(leftWing);

  const leftFeatherData = [
    { x:  0.00, y:  0.00, rz:  0.2 },
    { x: -0.12, y: -0.05, rz:  0.5 },
    { x: -0.24, y: -0.12, rz:  0.8 },
    { x: -0.34, y: -0.20, rz:  1.1 },
    { x: -0.42, y: -0.30, rz:  1.4 },
  ];
  for (let i = 0; i < leftFeatherData.length; i++) {
    const d = leftFeatherData[i];
    const feather = new THREE.Mesh(featherGeo, wingMat);
    feather.name = `feather${i}`;
    feather.position.set(d.x, d.y, 0);
    feather.rotation.z = d.rz;
    leftWing.add(feather);
  }

  // Right Wing (mirror of left)
  const rightWing = new THREE.Group();
  rightWing.name = 'rightWing';
  rightWing.position.set(0.15, 0.25, -0.25);
  rightWing.rotation.y = 0.3;
  body.add(rightWing);

  const rightFeatherData = [
    { x:  0.00, y:  0.00, rz: -0.2 },
    { x:  0.12, y: -0.05, rz: -0.5 },
    { x:  0.24, y: -0.12, rz: -0.8 },
    { x:  0.34, y: -0.20, rz: -1.1 },
    { x:  0.42, y: -0.30, rz: -1.4 },
  ];
  for (let i = 0; i < rightFeatherData.length; i++) {
    const d = rightFeatherData[i];
    const feather = new THREE.Mesh(featherGeo, wingMat);
    feather.name = `feather${i}`;
    feather.position.set(d.x, d.y, 0);
    feather.rotation.z = d.rz;
    rightWing.add(feather);
  }

  // ── Legs: tapered plate greaves with gold knee guards ──
  const leftLeg = legs.getObjectByName('leftLeg');
  const rightLeg = legs.getObjectByName('rightLeg');

  const leftLegMesh = createTaperedLimb(0.12, 0.1, 0.6, 16, UV_REGIONS.LEGS, plateMat);
  leftLeg.geometry.dispose();
  leftLeg.geometry = leftLegMesh.geometry;
  leftLeg.material = plateMat;

  const rightLegMesh = createTaperedLimb(0.12, 0.1, 0.6, 16, UV_REGIONS.LEGS, plateMat);
  rightLeg.geometry.dispose();
  rightLeg.geometry = rightLegMesh.geometry;
  rightLeg.material = plateMat;

  // Update feet material
  const leftFoot = leftLeg.getObjectByName('leftFoot');
  const rightFoot = rightLeg.getObjectByName('rightFoot');
  if (leftFoot) leftFoot.material = plateMat;
  if (rightFoot) rightFoot.material = plateMat;

  // Knee guards
  const kneeGeo = new THREE.SphereGeometry(0.065, 12, 10);
  const leftKnee = new THREE.Mesh(kneeGeo, goldMat);
  leftKnee.name = 'leftKnee';
  leftKnee.scale.set(0.8, 0.7, 1.2);
  leftKnee.position.set(0, 0.1, 0.08);
  leftLeg.add(leftKnee);

  const rightKnee = new THREE.Mesh(kneeGeo, goldMat);
  rightKnee.name = 'rightKnee';
  rightKnee.scale.set(0.8, 0.7, 1.2);
  rightKnee.position.set(0, 0.1, 0.08);
  rightLeg.add(rightKnee);

  return root;
}

// ─────────────────────────────────────────────────────────────────────────────
// Class registry
// ─────────────────────────────────────────────────────────────────────────────
const CLASS_BUILDERS = new Map([
  [CLASS_TYRANT, buildTyrant],
  [CLASS_WRAITH, buildWraith],
  [CLASS_INFERNAL, buildInfernal],
  [CLASS_HARBINGER, buildHarbinger],
  [CLASS_REVENANT, buildRevenant],
]);

// ─────────────────────────────────────────────────────────────────────────────
// CharacterRenderer
// ─────────────────────────────────────────────────────────────────────────────

export default class CharacterRenderer {
  /**
   * @param {THREE.Scene} scene — the Three.js scene to add characters to.
   */
  constructor(scene) {
    this.scene = scene;
    /** @type {Map<string, THREE.Group>} unitId -> character root group */
    this.characters = new Map();
  }

  // ── Character creation ──────────────────────────────────────────────────

  /**
   * Creates a procedural character model for the given class and adds it to the scene.
   * @param {string} unitId   — unique identifier for this unit
   * @param {string} classId  — one of TYRANT, WRAITH, INFERNAL, HARBINGER, REVENANT
   * @returns {THREE.Group} the root group for this character
   */
  createCharacter(unitId, classId) {
    // Remove existing character with the same unitId, if any
    if (this.characters.has(unitId)) {
      this.removeCharacter(unitId);
    }

    const normalizedId = typeof classId === 'string' ? classId.toUpperCase() : classId;
    const builder = CLASS_BUILDERS.get(normalizedId);
    if (!builder) {
      console.warn(`CharacterRenderer: unknown classId "${classId}", falling back to TYRANT`);
      return this.createCharacter(unitId, CLASS_TYRANT);
    }

    const model = builder();
    model.scale.set(2.5, 2.5, 2.5);
    model.name = `character_${unitId}`;
    model.userData.classId = classId;
    model.userData.unitId = unitId;
    // Store original emissive values for hit-flash restoration
    model.userData._originalEmissives = new Map();
    model.traverse((child) => {
      if (child.isMesh) {
        model.userData._originalEmissives.set(child.uuid, {
          emissive: child.material.emissive ? child.material.emissive.clone() : new THREE.Color(0x000000),
          emissiveIntensity: child.material.emissiveIntensity || 0,
        });
      }
    });

    this.scene.add(model);
    this.characters.set(unitId, model);
    return model;
  }

  /**
   * Remove a character from the scene and dispose its resources.
   * @param {string} unitId
   */
  removeCharacter(unitId) {
    const model = this.characters.get(unitId);
    if (!model) return;

    this.scene.remove(model);
    model.traverse((child) => {
      if (child.isMesh) {
        child.geometry.dispose();
        if (child.material.dispose) child.material.dispose();
      }
    });
    this.characters.delete(unitId);
  }

  // ── Animation helpers ───────────────────────────────────────────────────

  /**
   * Subtle idle breathing / bob animation.
   * Enhanced: body.scale.y breathing oscillation (0.98-1.02), named part animations.
   * @param {THREE.Group} model — character root
   * @param {number} time — elapsed time in seconds
   */
  animateIdle(model, time) {
    const body = model.getObjectByName('body');
    if (!body) return;

    const leftArm = model.getObjectByName('leftArm');
    const rightArm = model.getObjectByName('rightArm');
    const leftLeg = model.getObjectByName('leftLeg');
    const rightLeg = model.getObjectByName('rightLeg');
    const head = model.getObjectByName('head');
    const classId = model.userData.classId;

    // Breathing bob — smooth and organic
    const breathCycle = Math.sin(time * 2.2) * 0.04 + Math.sin(time * 1.3) * 0.02;
    body.position.y = 1.0 + breathCycle;

    // Chest expansion (breathing) — always reset all axes to prevent sticky scale
    body.scale.x = 1.0 + Math.sin(time * 2.2) * 0.008;
    body.scale.y = 1.0 + Math.sin(time * 2.2) * 0.015;
    body.scale.z = 1.0;

    // Subtle body sway (weight shifting foot to foot like WoW idle)
    body.rotation.z = Math.sin(time * 0.8) * 0.03;
    body.rotation.y = Math.sin(time * 0.5) * 0.04;

    // Head: look around periodically
    if (head) {
      head.rotation.y = Math.sin(time * 0.7 + 0.5) * 0.08;
      head.rotation.x = Math.sin(time * 0.9) * 0.04 - 0.05; // slight downward tilt
    }

    // Combat-ready arm poses based on class
    const isMelee = classId === CLASS_TYRANT || classId === CLASS_WRAITH || classId === CLASS_REVENANT;
    if (isMelee) {
      // Weapon arm slightly forward, off-hand ready — combat stance
      if (rightArm) {
        rightArm.rotation.x = -0.4 + Math.sin(time * 1.8) * 0.06;
        rightArm.rotation.z = -0.15;
      }
      if (leftArm) {
        leftArm.rotation.x = -0.2 + Math.sin(time * 1.5 + 1) * 0.05;
        leftArm.rotation.z = 0.2;
      }
    } else {
      // Caster: arms relaxed at sides with subtle sway
      if (leftArm) {
        leftArm.rotation.z = 0.15 + Math.sin(time * 1.5) * 0.08;
        leftArm.rotation.x = Math.sin(time * 1.2) * 0.05;
      }
      if (rightArm) {
        rightArm.rotation.z = -0.15 - Math.sin(time * 1.5) * 0.08;
        rightArm.rotation.x = Math.sin(time * 1.2 + 0.5) * 0.05;
      }
    }

    // Subtle leg shift (weight transfer)
    if (leftLeg) leftLeg.rotation.z = Math.sin(time * 0.8) * 0.03;
    if (rightLeg) rightLeg.rotation.z = -Math.sin(time * 0.8) * 0.03;

    // Harbinger grimoire float
    if (classId === CLASS_HARBINGER) {
      const grimoire = model.getObjectByName('grimoire');
      if (grimoire) {
        grimoire.position.y = -0.55 + Math.sin(time * 3) * 0.04;
        grimoire.rotation.y = Math.sin(time * 1.5) * 0.15;
      }
    }

    // ── Animate named parts ──
    this._animateNamedParts(model, time);
  }

  /**
   * Walk cycle — legs and arms swing, body bobs.
   * Enhanced: increased arm swing amplitude, slight body bob.
   * @param {THREE.Group} model
   * @param {number} time — elapsed time in seconds
   * @param {number} speed — movement speed multiplier (default 1)
   */
  animateWalk(model, time, speed = 1) {
    const body = model.getObjectByName('body');
    const leftLeg = model.getObjectByName('leftLeg');
    const rightLeg = model.getObjectByName('rightLeg');
    const leftArm = model.getObjectByName('leftArm');
    const rightArm = model.getObjectByName('rightArm');
    const head = model.getObjectByName('head');
    const classId = model.userData.classId;

    if (classId === CLASS_TYRANT) {
      // ═══ TYRANT: Heavy armored march — slow cadence, stomping, weapon resting on shoulder ═══
      const freq = speed * 5; // slower cadence = heavier feel
      const s = Math.sin(time * freq);
      if (body) {
        body.position.y = 1.0 + Math.abs(s) * 0.10;
        body.rotation.x = 0.08; // slight forward lean (upright posture)
        body.rotation.z = s * 0.06; // small hip sway
        body.rotation.y = s * 0.04;
      }
      if (head) { head.rotation.x = -0.06; head.rotation.z = -s * 0.03; }
      // Heavy stomping legs — slower, wider
      if (leftLeg) leftLeg.rotation.x = s * 0.8;
      if (rightLeg) rightLeg.rotation.x = -s * 0.8;
      // Right arm: sword resting forward/low, minimal swing
      if (rightArm) {
        rightArm.rotation.x = -0.5 + s * 0.15;
        rightArm.rotation.z = -0.2;
      }
      // Left arm: shield arm, swings slightly with stride
      if (leftArm) {
        leftArm.rotation.x = -0.1 - s * 0.25;
        leftArm.rotation.z = 0.25;
      }
    } else if (classId === CLASS_WRAITH) {
      // ═══ WRAITH: Low sneaky sprint — crouched, fast legs, arms back like a ninja ═══
      const freq = speed * 9; // fast cadence = darting movement
      const s = Math.sin(time * freq);
      if (body) {
        body.position.y = 0.85 + Math.abs(s) * 0.06; // crouched lower
        body.rotation.x = 0.35; // heavy forward lean (predatory)
        body.rotation.z = s * 0.04; // tight sway
        body.rotation.y = s * 0.08; // torso twists more
      }
      if (head) { head.rotation.x = -0.30; head.rotation.z = -s * 0.04; }
      // Fast, tight leg stride
      if (leftLeg) leftLeg.rotation.x = s * 1.2;
      if (rightLeg) rightLeg.rotation.x = -s * 1.2;
      // Arms swept back (ninja run) with daggers trailing
      if (rightArm) {
        rightArm.rotation.x = 0.6 + s * 0.2; // arm back
        rightArm.rotation.z = -0.3;
      }
      if (leftArm) {
        leftArm.rotation.x = 0.6 - s * 0.2; // arm back, opposite phase
        leftArm.rotation.z = 0.3;
      }
    } else if (classId === CLASS_INFERNAL) {
      // ═══ INFERNAL: Floating glide — minimal leg movement, arms wide, ethereal hovering ═══
      const freq = speed * 6;
      const s = Math.sin(time * freq);
      if (body) {
        body.position.y = 1.05 + Math.sin(time * 2.5) * 0.06; // gentle float bob
        body.rotation.x = 0.05; // nearly upright
        body.rotation.z = Math.sin(time * 1.8) * 0.04; // slow graceful sway
        body.rotation.y = Math.sin(time * 1.5) * 0.03;
      }
      if (head) { head.rotation.x = -0.05; head.rotation.z = -Math.sin(time * 1.8) * 0.02; }
      // Legs: barely visible shuffle under robes
      if (leftLeg) leftLeg.rotation.x = s * 0.3;
      if (rightLeg) rightLeg.rotation.x = -s * 0.3;
      // Staff held forward with both hands, slight sway
      if (leftArm) {
        leftArm.rotation.x = -0.4 + Math.sin(time * 2) * 0.1;
        leftArm.rotation.z = 0.15;
      }
      if (rightArm) {
        rightArm.rotation.x = -0.4 + Math.sin(time * 2 + 0.5) * 0.1;
        rightArm.rotation.z = -0.15;
      }
    } else if (classId === CLASS_HARBINGER) {
      // ═══ HARBINGER: Menacing shamble — uneven gait, hunched, one arm forward (staff) ═══
      const freq = speed * 5.5;
      const s = Math.sin(time * freq);
      const s2 = Math.sin(time * freq * 0.7); // offset for asymmetric feel
      if (body) {
        body.position.y = 0.95 + Math.abs(s) * 0.08;
        body.rotation.x = 0.20; // hunched over
        body.rotation.z = s * 0.08 + 0.04; // permanent slight tilt (asymmetric)
        body.rotation.y = s2 * 0.05;
      }
      if (head) { head.rotation.x = -0.15; head.rotation.z = -s * 0.06; }
      // Uneven legs — one drags slightly
      if (leftLeg) leftLeg.rotation.x = s * 0.7;
      if (rightLeg) rightLeg.rotation.x = -s * 0.85; // right leg takes bigger step
      // Left arm (staff): held forward, slight bob
      if (leftArm) {
        leftArm.rotation.x = -0.6 + s2 * 0.15;
        leftArm.rotation.z = 0.1;
      }
      // Right arm: hangs low and sways loosely (creepy)
      if (rightArm) {
        rightArm.rotation.x = 0.2 - s * 0.4;
        rightArm.rotation.z = -0.1 + s2 * 0.06;
      }
    } else if (classId === CLASS_REVENANT) {
      // ═══ REVENANT: Righteous stride — upright, purposeful, mace at side, shield forward ═══
      const freq = speed * 6.5;
      const s = Math.sin(time * freq);
      if (body) {
        body.position.y = 1.0 + Math.abs(s) * 0.10;
        body.rotation.x = 0.06; // upright, proud posture
        body.rotation.z = s * 0.05;
        body.rotation.y = s * 0.04;
      }
      if (head) { head.rotation.x = -0.04; head.rotation.z = -s * 0.03; }
      // Steady, even stride
      if (leftLeg) leftLeg.rotation.x = s * 0.9;
      if (rightLeg) rightLeg.rotation.x = -s * 0.9;
      // Right arm: mace swings with stride
      if (rightArm) {
        rightArm.rotation.x = -0.3 + s * 0.35;
        rightArm.rotation.z = -0.15;
      }
      // Left arm: shield held forward, minimal swing
      if (leftArm) {
        leftArm.rotation.x = -0.5 - s * 0.1;
        leftArm.rotation.z = 0.3;
      }
    } else {
      // ═══ Fallback: generic walk ═══
      const freq = speed * 7;
      const s = Math.sin(time * freq);
      if (body) {
        body.position.y = 1.0 + Math.abs(s) * 0.12;
        body.rotation.x = 0.12;
        body.rotation.z = s * 0.08;
      }
      if (head) { head.rotation.x = -0.10; }
      if (leftLeg) leftLeg.rotation.x = s * 0.9;
      if (rightLeg) rightLeg.rotation.x = -s * 0.9;
      if (leftArm) leftArm.rotation.x = -s * 0.5;
      if (rightArm) rightArm.rotation.x = s * 0.5;
    }

    // ── Animate named parts ──
    this._animateNamedParts(model, time);
  }

  /**
   * Attack swing — right arm swings forward.
   * Enhanced: body.rotation.z during wind-up (+-0.15 radians).
   * @param {THREE.Group} model
   * @param {number} progress — 0 (start) to 1 (end)
   */
  /**
   * Per-ability animation for instant/melee abilities.
   * Each ability has a unique motion archetype. Falls back to animateAttack for auto-attacks.
   */
  animateAbility(model, progress, abilityId, time) {
    if (!abilityId) {
      // Auto-attack — use class-specific default
      return this.animateAttack(model, progress);
    }

    const body = model.getObjectByName('body');
    const leftArm = model.getObjectByName('leftArm');
    const rightArm = model.getObjectByName('rightArm');
    const head = model.getObjectByName('head');
    const leftLeg = model.getObjectByName('leftLeg');
    const rightLeg = model.getObjectByName('rightLeg');
    const classId = model.userData.classId;

    // Easing helpers
    const easeOut = (t, pow = 3) => 1 - Math.pow(1 - t, pow);
    const easeIn = (t, pow = 2) => Math.pow(t, pow);
    const snap = (t) => t < 0.3 ? easeIn(t / 0.3) : 1 - easeOut((t - 0.3) / 0.7, 2);

    // Animation archetype mapping
    const archetype = ABILITY_ANIM_MAP[abilityId];
    if (!archetype) {
      // Unknown ability — fall back to class default attack
      return this.animateAttack(model, progress);
    }

    const p = progress; // 0→1

    switch (archetype) {
      // ═══════════════════════════════════════════
      //  MELEE ARCHETYPES
      // ═══════════════════════════════════════════

      case 'horizontal_cleave': {
        // Wide sideways slash — body twists, weapon sweeps horizontally
        const swing = Math.sin(p * Math.PI);
        const twist = p < 0.3 ? -easeIn(p / 0.3) * 0.5 : -0.5 + easeOut((p - 0.3) / 0.7) * 1.2;
        if (rightArm) { rightArm.rotation.x = -0.3 - swing * 0.8; rightArm.rotation.z = twist * 1.5; }
        if (leftArm) { leftArm.rotation.x = -0.2; leftArm.rotation.z = -twist * 0.3; }
        if (body) { body.rotation.y = twist * 0.6; body.rotation.x = 0.1; body.position.y = 1.0 - swing * 0.05; }
        if (head) head.rotation.y = twist * 0.3;
        if (leftLeg) leftLeg.rotation.x = swing * 0.2;
        if (rightLeg) rightLeg.rotation.x = -swing * 0.3;
        break;
      }

      case 'overhead_slam': {
        // Weapon raised high, slammed down with impact
        const phase = p < 0.35 ? 'windup' : p < 0.5 ? 'strike' : 'recover';
        if (phase === 'windup') {
          const t = easeIn(p / 0.35, 1.5);
          if (rightArm) { rightArm.rotation.x = -0.5 - t * 3.0; rightArm.rotation.z = -t * 0.3; }
          if (body) { body.rotation.x = -t * 0.3; body.position.y = 1.0 + t * 0.1; }
          if (leftLeg) leftLeg.rotation.x = t * 0.3;
        } else if (phase === 'strike') {
          const t = easeOut((p - 0.35) / 0.15, 5);
          if (rightArm) { rightArm.rotation.x = -3.5 + t * 4.5; rightArm.rotation.z = -0.3 + t * 0.3; }
          if (body) { body.rotation.x = -0.3 + t * 0.6; body.position.y = 1.1 - t * 0.2; }
        } else {
          const t = easeOut((p - 0.5) / 0.5, 2);
          if (rightArm) rightArm.rotation.x = 1.0 * (1 - t);
          if (body) { body.rotation.x = 0.3 * (1 - t); body.position.y = 0.9 + t * 0.1; }
        }
        if (head) head.rotation.x = -snap(p) * 0.2;
        break;
      }

      case 'quick_stab': {
        // Fast forward lunge with one weapon
        const lunge = Math.sin(p * Math.PI);
        const thrust = p < 0.25 ? easeIn(p / 0.25) : 1 - easeOut((p - 0.25) / 0.75, 2);
        if (rightArm) { rightArm.rotation.x = 0.5 - thrust * 3.5; rightArm.rotation.z = -0.3; }
        if (leftArm) { leftArm.rotation.x = -0.2 - thrust * 0.5; leftArm.rotation.z = 0.2; }
        if (body) { body.rotation.x = thrust * 0.3; body.position.y = 1.0 - lunge * 0.1; }
        if (rightLeg) rightLeg.rotation.x = -lunge * 0.5;
        if (leftLeg) leftLeg.rotation.x = lunge * 0.3;
        break;
      }

      case 'dual_slash': {
        // Both weapons cross-slash — arms swing inward then outward
        const swing = Math.sin(p * Math.PI);
        const cross = p < 0.3 ? easeIn(p / 0.3) : 1 - easeOut((p - 0.3) / 0.7, 2);
        if (rightArm) { rightArm.rotation.x = -cross * 2.5; rightArm.rotation.z = 0.5 - cross * 1.5; }
        if (leftArm) { leftArm.rotation.x = -cross * 2.5; leftArm.rotation.z = -0.5 + cross * 1.5; }
        if (body) { body.rotation.x = cross * 0.2; body.position.y = 1.0 - swing * 0.12; body.rotation.z = Math.sin(p * Math.PI * 2) * 0.08; }
        if (rightLeg) rightLeg.rotation.x = -swing * 0.3;
        if (leftLeg) leftLeg.rotation.x = swing * 0.3;
        break;
      }

      case 'kidney_strike': {
        // Low crouched precision strike
        const crouch = Math.sin(p * Math.PI);
        const strike = p < 0.4 ? easeIn(p / 0.4) : 1 - easeOut((p - 0.4) / 0.6, 2);
        if (body) { body.position.y = 1.0 - crouch * 0.25; body.rotation.x = crouch * 0.35; }
        if (rightArm) { rightArm.rotation.x = 0.3 - strike * 3.0; rightArm.rotation.z = -0.4; }
        if (leftArm) { leftArm.rotation.x = -0.5; leftArm.rotation.z = 0.3 + crouch * 0.2; }
        if (rightLeg) rightLeg.rotation.x = -crouch * 0.4;
        if (leftLeg) leftLeg.rotation.x = crouch * 0.5;
        break;
      }

      case 'mace_smite': {
        // Holy mace overhead strike with shield brace
        const phase = p < 0.3 ? 'raise' : p < 0.45 ? 'strike' : 'recover';
        if (phase === 'raise') {
          const t = easeIn(p / 0.3, 1.5);
          if (rightArm) { rightArm.rotation.x = -0.5 - t * 2.8; }
          if (leftArm) { leftArm.rotation.x = -t * 0.8; leftArm.rotation.z = t * 0.5; }
          if (body) { body.rotation.x = -t * 0.2; body.position.y = 1.0 + t * 0.08; }
        } else if (phase === 'strike') {
          const t = easeOut((p - 0.3) / 0.15, 5);
          if (rightArm) rightArm.rotation.x = -3.3 + t * 4.3;
          if (leftArm) { leftArm.rotation.x = -0.8 + t * 1.2; leftArm.rotation.z = 0.5 - t * 0.3; }
          if (body) { body.rotation.x = -0.2 + t * 0.5; body.position.y = 1.08 - t * 0.18; }
        } else {
          const t = easeOut((p - 0.45) / 0.55, 2);
          if (rightArm) rightArm.rotation.x = 1.0 * (1 - t);
          if (body) { body.position.y = 0.9 + t * 0.1; body.rotation.x = 0.3 * (1 - t); }
        }
        break;
      }

      case 'shield_bash': {
        // Shield thrust forward — left arm leads
        const thrust = p < 0.3 ? easeIn(p / 0.3) : 1 - easeOut((p - 0.3) / 0.7, 2);
        if (leftArm) { leftArm.rotation.x = -thrust * 2.5; leftArm.rotation.z = 0.5 - thrust * 0.5; }
        if (rightArm) { rightArm.rotation.x = -0.3; rightArm.rotation.z = -0.2; }
        if (body) { body.rotation.x = thrust * 0.25; body.rotation.y = -thrust * 0.2; body.position.y = 1.0 - thrust * 0.05; }
        if (rightLeg) rightLeg.rotation.x = -thrust * 0.4;
        break;
      }

      // ═══════════════════════════════════════════
      //  MOVEMENT / CHARGE ARCHETYPES
      // ═══════════════════════════════════════════

      case 'charge_rush': {
        // Body lunges forward with weapon extended
        const lunge = Math.sin(p * Math.PI);
        if (body) { body.rotation.x = 0.4 * lunge; body.position.y = 1.0 - lunge * 0.15; }
        if (rightArm) { rightArm.rotation.x = -0.5 - lunge * 1.5; rightArm.rotation.z = -lunge * 0.3; }
        if (leftArm) { leftArm.rotation.x = -lunge * 0.8; }
        if (rightLeg) rightLeg.rotation.x = -lunge * 0.8;
        if (leftLeg) leftLeg.rotation.x = lunge * 0.6;
        if (head) head.rotation.x = -lunge * 0.15;
        break;
      }

      case 'teleport_blink': {
        // Quick crouch then straighten — blink feel
        const flash = p < 0.2 ? easeIn(p / 0.2) : 1 - easeOut((p - 0.2) / 0.8, 3);
        if (body) { body.position.y = 1.0 - flash * 0.3; body.rotation.x = flash * 0.3; }
        if (leftArm) leftArm.rotation.z = flash * 0.6;
        if (rightArm) rightArm.rotation.z = -flash * 0.6;
        break;
      }

      // ═══════════════════════════════════════════
      //  SELF-BUFF / DEFENSIVE ARCHETYPES
      // ═══════════════════════════════════════════

      case 'war_cry': {
        // Arms wide, chest out, power roar
        const flex = Math.sin(p * Math.PI);
        if (body) { body.position.y = 1.0 + flex * 0.1; body.rotation.x = -flex * 0.15; }
        if (rightArm) { rightArm.rotation.x = -flex * 0.8; rightArm.rotation.z = -flex * 0.9; }
        if (leftArm) { leftArm.rotation.x = -flex * 0.8; leftArm.rotation.z = flex * 0.9; }
        if (head) head.rotation.x = -flex * 0.25;
        if (leftLeg) leftLeg.rotation.z = -flex * 0.15;
        if (rightLeg) rightLeg.rotation.z = flex * 0.15;
        break;
      }

      case 'defensive_brace': {
        // Arms in, body tenses, shield/weapon close to body
        const brace = Math.sin(p * Math.PI);
        if (body) { body.position.y = 1.0 - brace * 0.08; body.rotation.x = brace * 0.1; }
        if (rightArm) { rightArm.rotation.x = -brace * 1.2; rightArm.rotation.z = -brace * 0.3; }
        if (leftArm) { leftArm.rotation.x = -brace * 1.0; leftArm.rotation.z = brace * 0.4; }
        if (head) head.rotation.x = brace * 0.1;
        break;
      }

      case 'vanish_crouch': {
        // Quick crouch down and fade
        const dip = p < 0.3 ? easeIn(p / 0.3) : 1;
        const rise = p > 0.5 ? easeOut((p - 0.5) / 0.5, 2) : 0;
        const crouch = dip - rise;
        if (body) { body.position.y = 1.0 - crouch * 0.4; body.rotation.x = crouch * 0.4; }
        if (leftArm) { leftArm.rotation.z = crouch * 0.5; leftArm.rotation.x = crouch * 0.3; }
        if (rightArm) { rightArm.rotation.z = -crouch * 0.5; rightArm.rotation.x = crouch * 0.3; }
        if (leftLeg) leftLeg.rotation.x = crouch * 0.6;
        if (rightLeg) rightLeg.rotation.x = crouch * 0.4;
        break;
      }

      case 'power_up': {
        // Fists clench, body tenses, slight lift
        const flex = Math.sin(p * Math.PI);
        const tremble = Math.sin(time * 30) * flex * 0.04;
        if (body) { body.position.y = 1.0 + flex * 0.06; body.rotation.z = tremble; }
        if (rightArm) { rightArm.rotation.x = -flex * 1.5; rightArm.rotation.z = -flex * 0.4 + tremble; }
        if (leftArm) { leftArm.rotation.x = -flex * 1.5; leftArm.rotation.z = flex * 0.4 + tremble; }
        if (head) head.rotation.x = -flex * 0.15;
        break;
      }

      // ═══════════════════════════════════════════
      //  HEAL / SELF-CAST ARCHETYPES
      // ═══════════════════════════════════════════

      case 'heal_self': {
        // Hands raised to chest, warm glow gesture
        const glow = Math.sin(p * Math.PI);
        if (body) { body.position.y = 1.0 + glow * 0.04; }
        if (rightArm) { rightArm.rotation.x = -glow * 1.8; rightArm.rotation.z = -glow * 0.4; }
        if (leftArm) { leftArm.rotation.x = -glow * 1.8; leftArm.rotation.z = glow * 0.4; }
        if (head) head.rotation.x = -glow * 0.12;
        break;
      }

      // ═══════════════════════════════════════════
      //  RANGED INSTANT ARCHETYPES
      // ═══════════════════════════════════════════

      case 'hand_blast': {
        // One hand thrusts forward to launch a projectile
        const thrust = p < 0.25 ? easeIn(p / 0.25) : 1 - easeOut((p - 0.25) / 0.75, 2);
        if (rightArm) { rightArm.rotation.x = -thrust * 2.8; rightArm.rotation.z = -thrust * 0.3; }
        if (leftArm) { leftArm.rotation.x = -thrust * 0.5; leftArm.rotation.z = thrust * 0.3; }
        if (body) { body.rotation.x = -0.1 + thrust * 0.25; body.position.y = 1.0 + thrust * 0.03; }
        if (head) head.rotation.x = -thrust * 0.12;
        break;
      }

      case 'ground_stomp': {
        // Foot stamps, arms slam downward for AoE
        const stomp = p < 0.3 ? easeIn(p / 0.3) : 1 - easeOut((p - 0.3) / 0.7, 3);
        if (body) { body.position.y = 1.0 + (p < 0.3 ? stomp * 0.1 : -stomp * 0.15); body.rotation.x = stomp * 0.2; }
        if (rightArm) { rightArm.rotation.x = -stomp * 2.0; rightArm.rotation.z = -stomp * 0.5; }
        if (leftArm) { leftArm.rotation.x = -stomp * 2.0; leftArm.rotation.z = stomp * 0.5; }
        if (rightLeg) rightLeg.rotation.x = stomp * 0.5;
        if (head) head.rotation.x = stomp * 0.15;
        break;
      }

      case 'fear_howl': {
        // Arms wide, head thrown back, screaming
        const howl = Math.sin(p * Math.PI);
        const tremor = Math.sin(time * 20) * howl * 0.03;
        if (body) { body.rotation.x = -howl * 0.25; body.position.y = 1.0 + howl * 0.08; body.rotation.z = tremor; }
        if (rightArm) { rightArm.rotation.x = -howl * 1.0; rightArm.rotation.z = -howl * 1.0; }
        if (leftArm) { leftArm.rotation.x = -howl * 1.0; leftArm.rotation.z = howl * 1.0; }
        if (head) { head.rotation.x = -howl * 0.35; }
        break;
      }

      case 'dark_curse': {
        // One arm extends, fingers clawing — placing a curse
        const extend = p < 0.3 ? easeIn(p / 0.3) : 1 - easeOut((p - 0.3) / 0.7, 2) * 0.7;
        if (rightArm) { rightArm.rotation.x = -extend * 2.2; rightArm.rotation.z = -extend * 0.2; }
        if (leftArm) { leftArm.rotation.x = -extend * 0.6; leftArm.rotation.z = 0.3; }
        if (body) { body.rotation.x = extend * 0.15; body.rotation.y = -extend * 0.15; }
        if (head) head.rotation.y = -extend * 0.1;
        break;
      }

      case 'drain_pose': {
        // Both arms extended, pulling energy from target
        const pull = Math.sin(p * Math.PI);
        if (rightArm) { rightArm.rotation.x = -1.5 * pull; rightArm.rotation.z = -0.3 * pull; }
        if (leftArm) { leftArm.rotation.x = -1.5 * pull; leftArm.rotation.z = 0.3 * pull; }
        if (body) { body.rotation.x = pull * 0.15; body.position.y = 1.0 + pull * 0.04; }
        break;
      }

      case 'holy_smash': {
        // Weapon raised overhead with divine energy, slam down
        const phase = p < 0.35 ? 'raise' : p < 0.5 ? 'strike' : 'glow';
        if (phase === 'raise') {
          const t = easeIn(p / 0.35);
          if (rightArm) { rightArm.rotation.x = -0.5 - t * 2.5; }
          if (leftArm) { leftArm.rotation.x = -t * 1.0; leftArm.rotation.z = t * 0.6; }
          if (body) { body.rotation.x = -t * 0.2; body.position.y = 1.0 + t * 0.1; }
        } else if (phase === 'strike') {
          const t = easeOut((p - 0.35) / 0.15, 5);
          if (rightArm) rightArm.rotation.x = -3.0 + t * 4.0;
          if (leftArm) { leftArm.rotation.x = -1.0 + t * 1.5; }
          if (body) { body.rotation.x = -0.2 + t * 0.5; body.position.y = 1.1 - t * 0.2; }
        } else {
          const t = easeOut((p - 0.5) / 0.5, 2);
          if (rightArm) rightArm.rotation.x = 1.0 * (1 - t);
          if (body) { body.position.y = 0.9 + t * 0.1; }
        }
        if (head) head.rotation.x = -snap(p) * 0.15;
        break;
      }

      case 'prayer_channel': {
        // Hands together in front, slight kneel
        const pray = Math.sin(p * Math.PI);
        if (body) { body.position.y = 1.0 - pray * 0.12; body.rotation.x = pray * 0.15; }
        if (rightArm) { rightArm.rotation.x = -pray * 1.8; rightArm.rotation.z = pray * 0.3; }
        if (leftArm) { leftArm.rotation.x = -pray * 1.8; leftArm.rotation.z = -pray * 0.3; }
        if (head) head.rotation.x = pray * 0.1;
        if (rightLeg) rightLeg.rotation.x = pray * 0.3;
        break;
      }

      case 'speed_burst': {
        // Body crouches into sprint position
        const launch = p < 0.2 ? easeIn(p / 0.2) : 1 - easeOut((p - 0.2) / 0.8, 3);
        if (body) { body.rotation.x = launch * 0.4; body.position.y = 1.0 - launch * 0.1; }
        if (rightArm) rightArm.rotation.x = launch * 0.8;
        if (leftArm) leftArm.rotation.x = -launch * 0.8;
        if (rightLeg) rightLeg.rotation.x = -launch * 0.7;
        if (leftLeg) leftLeg.rotation.x = launch * 0.7;
        break;
      }

      case 'interrupt_jab': {
        // Quick forward jab — fast, snappy
        const jab = p < 0.2 ? easeIn(p / 0.2) * 1.0 : (1.0 - easeOut((p - 0.2) / 0.8, 3));
        if (rightArm) { rightArm.rotation.x = -jab * 2.5; rightArm.rotation.z = -jab * 0.2; }
        if (body) { body.rotation.x = jab * 0.15; body.rotation.y = -jab * 0.1; }
        if (head) head.rotation.y = -jab * 0.1;
        break;
      }

      default:
        // Fallback to class-specific attack
        return this.animateAttack(model, progress);
    }

    // Animate named parts (halo, cape, etc.)
    this._animateNamedParts(model, time);
  }

  animateAttack(model, progress) {
    const rightArm = model.getObjectByName('rightArm');
    const leftArm = model.getObjectByName('leftArm');
    const body = model.getObjectByName('body');
    const head = model.getObjectByName('head');
    const leftLeg = model.getObjectByName('leftLeg');
    const rightLeg = model.getObjectByName('rightLeg');
    if (!rightArm) return;

    const classId = model.userData.classId;

    // Easing helpers
    const easeOutPow = (t, pow = 3) => 1 - Math.pow(1 - t, pow);
    const easeInPow = (t, pow = 2) => Math.pow(t, pow);

    // 3-phase timing: Anticipation (25%) → Strike (15%) → Recovery (60%)
    let phase, phaseT;
    if (progress < 0.25) { phase = 'windup'; phaseT = progress / 0.25; }
    else if (progress < 0.40) { phase = 'strike'; phaseT = (progress - 0.25) / 0.15; }
    else { phase = 'recovery'; phaseT = (progress - 0.40) / 0.60; }

    const strikeSnap = phase === 'strike' ? easeOutPow(phaseT, 5) : 0;

    if (classId === CLASS_WRAITH) {
      // --- ROGUE: explosive lunging dual-stab ---
      if (phase === 'windup') {
        const t = easeInPow(phaseT, 1.5);
        rightArm.rotation.x = 1.2 * t;        // pull arm way back
        rightArm.rotation.z = -0.6 * t;
        if (leftArm) { leftArm.rotation.x = 1.0 * t; leftArm.rotation.z = 0.6 * t; }
        if (body) { body.position.y = 1.0 - 0.35 * t; body.rotation.x = 0.45 * t; body.rotation.z = -0.15 * t; }
        if (leftLeg) leftLeg.rotation.x = 0.4 * t;
        if (rightLeg) rightLeg.rotation.x = -0.6 * t;
      } else if (phase === 'strike') {
        const t = easeOutPow(phaseT, 5);
        rightArm.rotation.x = 1.2 - 4.5 * t;  // explosive forward stab
        rightArm.rotation.z = -0.6 - 0.4 * t;
        if (leftArm) { leftArm.rotation.x = 1.0 - 4.2 * t; leftArm.rotation.z = 0.6 + 0.4 * t; }
        if (body) { body.position.y = 0.65; body.rotation.x = 0.45 - 0.7 * t; body.rotation.z = -0.15 + 0.3 * t; }
        if (leftLeg) leftLeg.rotation.x = 0.4 - 1.2 * t;
        if (rightLeg) rightLeg.rotation.x = -0.6 + 0.4 * t;
      } else {
        const t = easeOutPow(phaseT, 2);
        rightArm.rotation.x = -3.3 * (1 - t);
        if (leftArm) leftArm.rotation.x = -3.2 * (1 - t);
        if (body) { body.position.y = 0.65 + 0.35 * t; body.rotation.x = -0.25 * (1 - t); body.rotation.z = 0.15 * (1 - t); }
        if (leftLeg) leftLeg.rotation.x = -0.8 * (1 - t);
        if (rightLeg) rightLeg.rotation.x = -0.2 * (1 - t);
      }
    } else if (classId === CLASS_TYRANT) {
      // --- WARRIOR: massive overhead cleave ---
      if (phase === 'windup') {
        const t = easeInPow(phaseT, 1.5);
        rightArm.rotation.x = -0.5 - t * 3.2;  // raise VERY high overhead
        rightArm.rotation.z = -t * 0.6;
        if (body) { body.rotation.x = -t * 0.35; body.rotation.z = -t * 0.3; body.position.y = 1.0 + t * 0.1; }
        if (leftArm) { leftArm.rotation.x = -t * 0.6; leftArm.rotation.z = t * 0.5; }
        if (leftLeg) leftLeg.rotation.x = -0.3 * t;
        if (rightLeg) rightLeg.rotation.x = 0.2 * t;
      } else if (phase === 'strike') {
        const t = easeOutPow(phaseT, 6); // EXPLOSIVE snap down
        rightArm.rotation.x = -3.7 + t * 5.0;  // swing ALL the way through
        rightArm.rotation.z = -0.6 + t * 1.2;
        if (body) { body.rotation.x = -0.35 + t * 0.7; body.rotation.z = -0.3 + t * 0.7; body.position.y = 1.1 - t * 0.3; }
        if (leftArm) { leftArm.rotation.x = -0.6 + t * 1.0; leftArm.rotation.z = 0.5 - t * 0.3; }
        if (leftLeg) leftLeg.rotation.x = -0.3 + t * 0.9;
        if (rightLeg) rightLeg.rotation.x = 0.2 + t * 0.4;
      } else {
        const t = easeOutPow(phaseT, 2);
        rightArm.rotation.x = 1.3 * (1 - t);
        if (body) { body.rotation.x = 0.35 * (1 - t); body.rotation.z = 0.4 * (1 - t); body.position.y = 0.8 + 0.2 * t; }
        if (leftArm) leftArm.rotation.x = 0.4 * (1 - t);
        if (leftLeg) leftLeg.rotation.x = 0.6 * (1 - t);
        if (rightLeg) rightLeg.rotation.x = 0.6 * (1 - t);
      }
    } else if (classId === CLASS_REVENANT) {
      // --- PALADIN: holy smite (raise to sky → slam with shield forward) ---
      if (phase === 'windup') {
        const t = easeInPow(phaseT, 1.5);
        rightArm.rotation.x = -0.5 - t * 3.0;  // raise mace high
        if (leftArm) { leftArm.rotation.x = -t * 1.0; leftArm.rotation.z = 0.8 * t; } // shield up
        if (body) { body.rotation.x = -t * 0.25; body.position.y = 1.0 + t * 0.15; }
        if (leftLeg) leftLeg.rotation.x = -0.3 * t;
      } else if (phase === 'strike') {
        const t = easeOutPow(phaseT, 6);
        rightArm.rotation.x = -3.5 + t * 4.5;  // slam down
        if (leftArm) { leftArm.rotation.x = -1.0 + t * 1.5; leftArm.rotation.z = 0.8 - t * 0.6; } // shield bash forward
        if (body) { body.rotation.x = -0.25 + t * 0.5; body.position.y = 1.15 - t * 0.35; }
        if (leftLeg) leftLeg.rotation.x = -0.3 + t * 1.0;
        if (rightLeg) rightLeg.rotation.x = t * 0.4;
      } else {
        const t = easeOutPow(phaseT, 2);
        rightArm.rotation.x = 1.0 * (1 - t);
        if (leftArm) { leftArm.rotation.x = 0.5 * (1 - t); leftArm.rotation.z = 0.2 * (1 - t); }
        if (body) { body.rotation.x = 0.25 * (1 - t); body.position.y = 0.8 + 0.2 * t; }
        if (leftLeg) leftLeg.rotation.x = 0.7 * (1 - t);
        if (rightLeg) rightLeg.rotation.x = 0.4 * (1 - t);
      }
    } else {
      // --- DEFAULT (caster swing — slap with staff) ---
      const swing = Math.sin(progress * Math.PI);
      rightArm.rotation.x = -swing * 2.8;
      rightArm.rotation.z = -swing * 0.8;
      if (leftArm) { leftArm.rotation.x = swing * 0.5; leftArm.rotation.z = swing * 0.3; }
      if (body) { body.rotation.z = swing * 0.35; body.rotation.x = swing * 0.15; }
    }

    // Head follows body rotation
    if (head) {
      head.rotation.z = (body?.rotation.z || 0) * 0.5;
      head.rotation.x = (body?.rotation.x || 0) * 0.3;
    }

    // --- LUNGE: massive forward step during strike phase ---
    if (phase === 'strike' || (phase === 'recovery' && phaseT < 0.3)) {
      const lungeT = phase === 'strike' ? easeOutPow(phaseT, 3) : (1 - phaseT / 0.3);
      const lunge = lungeT * 0.8; // MUCH bigger lunge
      model.position.z += lunge * Math.cos(model.rotation.y);
      model.position.x += lunge * Math.sin(model.rotation.y);
    }

    // --- Squash & stretch on body (exaggerated) ---
    if (body) {
      if (phase === 'windup') {
        const sq = easeInPow(phaseT) * 0.15;
        body.scale.set(1 + sq, 1 - sq, 1 + sq);
      } else if (phase === 'strike') {
        const st = easeOutPow(phaseT, 3) * 0.18;
        body.scale.set(1 - st * 0.5, 1 + st, 1 - st * 0.5);
      } else {
        const t = easeOutPow(phaseT, 2);
        body.scale.set(
          1 + 0.08 * (1 - t),
          1 - 0.08 * (1 - t),
          1 + 0.08 * (1 - t)
        );
      }
    }

    // Weapon trail
    const trail = model.getObjectByName('weaponTrail');
    if (trail) {
      trail.visible = phase === 'strike' || (phase === 'recovery' && phaseT < 0.3);
      if (trail.material) {
        trail.material.opacity = phase === 'strike' ? easeOutPow(phaseT, 2) * 0.9 : 0.4;
      }
      const sw = phase === 'strike' ? strikeSnap : 0;
      trail.position.set(0.7, 1.0 + sw * 0.6, 0.7 * sw);
      trail.rotation.z = -sw * 1.5;
    }
  }

  /**
   * Cast animation — both arms raise forward, glow intensifies.
   * Enhanced: lean back at start (body.rotation.x = -0.1), forward at release (+0.1).
   * @param {THREE.Group} model
   * @param {number} progress — 0 to 1
   */
  animateCast(model, progress, abilityId) {
    const leftArm = model.getObjectByName('leftArm');
    const rightArm = model.getObjectByName('rightArm');
    const body = model.getObjectByName('body');
    const head = model.getObjectByName('head');
    const leftLeg = model.getObjectByName('leftLeg');
    const rightLeg = model.getObjectByName('rightLeg');
    const classId = model.userData.classId;
    const castIntensity = Math.sin(progress * Math.PI);

    // Phase-based casting (channel → build → release)
    const isChanneling = progress < 0.7;
    const releasePhase = progress > 0.7 ? (progress - 0.7) / 0.3 : 0;

    // ═══ ABILITY-SPECIFIC CAST ANIMATIONS ═══
    // Each cast-time ability gets a unique motion within its class.

    if (abilityId === 'inferno_bolt') {
      // FIRE BOLT: Right hand channels flame, left steadies staff, quick thrust release
      const sway = Math.sin(progress * 12) * 0.06;
      if (isChanneling) {
        const p = Math.min(1, progress / 0.7);
        if (rightArm) { rightArm.rotation.x = -1.5 * p; rightArm.rotation.z = -0.3 * p + sway; }
        if (leftArm) { leftArm.rotation.x = -0.8 * p; leftArm.rotation.z = 0.4 * p; }
        if (body) { body.rotation.x = -0.1 * p; body.position.y = 1.0 + 0.06 * p; body.rotation.z = sway * 0.3; }
      } else {
        const r = Math.sin(releasePhase * Math.PI);
        if (rightArm) { rightArm.rotation.x = -1.5 - r * 1.5; rightArm.rotation.z = -0.3 + r * 0.3; }
        if (body) { body.rotation.x = -0.1 + r * 0.3; body.position.y = 1.06 - r * 0.1; }
      }
    } else if (abilityId === 'cataclysm_flare') {
      // BIG FIRE: Both hands raised wide, massive energy buildup, explosive downward release
      const tremor = Math.sin(progress * 8) * 0.1;
      if (isChanneling) {
        const p = Math.min(1, progress / 0.7);
        if (leftArm) { leftArm.rotation.x = -2.0 * p; leftArm.rotation.z = 0.9 * p + tremor; }
        if (rightArm) { rightArm.rotation.x = -2.0 * p; rightArm.rotation.z = -0.9 * p - tremor; }
        if (body) { body.rotation.x = -0.25 * p; body.position.y = 1.0 + 0.15 * p; body.rotation.z = tremor * 0.4; }
        if (leftLeg) leftLeg.rotation.z = -p * 0.1;
        if (rightLeg) rightLeg.rotation.z = p * 0.1;
      } else {
        const r = Math.sin(releasePhase * Math.PI);
        if (leftArm) { leftArm.rotation.x = -2.0 - r * 1.0; leftArm.rotation.z = 0.9 - r * 1.0; }
        if (rightArm) { rightArm.rotation.x = -2.0 - r * 1.0; rightArm.rotation.z = -0.9 + r * 1.0; }
        if (body) { body.rotation.x = -0.25 + r * 0.6; body.position.y = 1.15 - r * 0.25; }
      }
    } else if (abilityId === 'glacial_lance') {
      // FROST LANCE: One hand forms icicle — arm extended straight, body leans sideways
      const charge = Math.sin(progress * 10) * 0.04;
      if (isChanneling) {
        const p = Math.min(1, progress / 0.7);
        if (rightArm) { rightArm.rotation.x = -2.2 * p; rightArm.rotation.z = -0.15; }
        if (leftArm) { leftArm.rotation.x = -0.5 * p; leftArm.rotation.z = 0.3 + p * 0.2; }
        if (body) { body.rotation.y = 0.15 * p; body.rotation.x = -0.1 * p; body.position.y = 1.0 + 0.04 * p + charge; }
      } else {
        const r = Math.sin(releasePhase * Math.PI);
        if (rightArm) rightArm.rotation.x = -2.2 - r * 0.8;
        if (body) { body.rotation.y = 0.15 - r * 0.25; body.rotation.x = -0.1 + r * 0.2; }
      }
    } else if (abilityId === 'ember_brand') {
      // QUICK FIRE: Fast one-hand cast, minimal windup — fling from the hip
      const fling = Math.sin(progress * Math.PI);
      if (rightArm) { rightArm.rotation.x = -fling * 2.0; rightArm.rotation.z = -0.2 - fling * 0.3; }
      if (leftArm) { leftArm.rotation.x = -fling * 0.4; leftArm.rotation.z = 0.2; }
      if (body) { body.rotation.y = -fling * 0.1; body.rotation.x = fling * 0.1; }
    } else if (abilityId === 'volatile_hex') {
      // SHADOW CAST: Both hands weave dark energy, body hunches, sinister release
      const weave = Math.sin(progress * 14) * 0.06;
      if (isChanneling) {
        const p = Math.min(1, progress / 0.7);
        if (rightArm) { rightArm.rotation.x = -1.2 * p; rightArm.rotation.z = -0.6 * p + weave; }
        if (leftArm) { leftArm.rotation.x = -1.0 * p; leftArm.rotation.z = 0.7 * p - weave; }
        if (body) { body.rotation.x = 0.2 * p; body.position.y = 1.0 - 0.05 * p; body.rotation.z = weave * 0.5; }
      } else {
        const r = Math.sin(releasePhase * Math.PI);
        if (rightArm) { rightArm.rotation.x = -1.2 - r * 1.5; }
        if (leftArm) { leftArm.rotation.x = -1.0 - r * 1.5; }
        if (body) { body.rotation.x = 0.2 - r * 0.3; }
      }
    } else if (abilityId === 'siphon_essence') {
      // DRAIN CHANNEL: Arms extended forward, fingers clawing, pulling life force
      const pulse = Math.sin(progress * 6) * 0.05;
      if (rightArm) { rightArm.rotation.x = -1.8 * castIntensity; rightArm.rotation.z = -0.2 + pulse; }
      if (leftArm) { leftArm.rotation.x = -1.8 * castIntensity; leftArm.rotation.z = 0.2 - pulse; }
      if (body) { body.rotation.x = castIntensity * 0.2; body.position.y = 1.0 + castIntensity * 0.05; body.rotation.z = pulse; }
    } else if (abilityId === 'hex_rupture') {
      // SHADOW BURST: Staff slams down, detonating hexes — violent downward motion
      if (isChanneling) {
        const p = Math.min(1, progress / 0.7);
        if (rightArm) { rightArm.rotation.x = -0.5 - p * 2.0; }
        if (leftArm) { leftArm.rotation.x = -0.3 - p * 1.5; leftArm.rotation.z = 0.5 * p; }
        if (body) { body.rotation.x = -p * 0.2; body.position.y = 1.0 + p * 0.1; }
      } else {
        const r = Math.sin(releasePhase * Math.PI);
        if (rightArm) rightArm.rotation.x = -2.5 + r * 3.5;
        if (leftArm) leftArm.rotation.x = -1.8 + r * 2.5;
        if (body) { body.rotation.x = -0.2 + r * 0.5; body.position.y = 1.1 - r * 0.2; }
      }
    } else if (abilityId === 'dread_howl') {
      // FEAR HOWL: Arms spread wide, head thrown back, screaming
      const howl = castIntensity;
      const tremor = Math.sin(progress * 18) * howl * 0.04;
      if (rightArm) { rightArm.rotation.x = -howl * 0.8; rightArm.rotation.z = -howl * 1.0; }
      if (leftArm) { leftArm.rotation.x = -howl * 0.8; leftArm.rotation.z = howl * 1.0; }
      if (body) { body.rotation.x = -howl * 0.25; body.position.y = 1.0 + howl * 0.08; body.rotation.z = tremor; }
      if (head) { head.rotation.x = -howl * 0.35; }
    } else if (abilityId === 'nether_slam') {
      // SHADOW STUN: Quick slam — arm thrust downward
      const slam = Math.sin(progress * Math.PI);
      if (rightArm) { rightArm.rotation.x = -2.5 * slam; rightArm.rotation.z = -0.3; }
      if (body) { body.rotation.x = slam * 0.2; body.position.y = 1.0 - slam * 0.1; }
    } else if (abilityId === 'binding_prayer') {
      // HOLY PRAYER: Hands together, head bowed, kneeling slightly
      const pray = castIntensity;
      if (rightArm) { rightArm.rotation.x = -pray * 1.8; rightArm.rotation.z = pray * 0.3; }
      if (leftArm) { leftArm.rotation.x = -pray * 1.8; leftArm.rotation.z = -pray * 0.3; }
      if (body) { body.position.y = 1.0 - pray * 0.1; body.rotation.x = pray * 0.15; }
      if (head) { head.rotation.x = pray * 0.12; }
      if (rightLeg) rightLeg.rotation.x = pray * 0.3;

    // ═══ CLASS-DEFAULT CAST ANIMATIONS (for abilities without specific override) ═══
    } else if (classId === CLASS_TYRANT) {
      const tremor = Math.sin(progress * 14) * 0.04;
      if (isChanneling) {
        const p = Math.min(1, progress / 0.7);
        if (rightArm) { rightArm.rotation.x = -0.5 - p * 2.5; rightArm.rotation.z = -p * 0.4; }
        if (leftArm) { leftArm.rotation.x = -p * 0.8; leftArm.rotation.z = 0.3 + p * 0.3; }
        if (body) { body.rotation.x = -p * 0.15 + tremor; body.position.y = 1.0 + p * 0.08; body.rotation.z = tremor * 1.5; }
      } else {
        const r = Math.sin(releasePhase * Math.PI);
        if (rightArm) { rightArm.rotation.x = -3.0 + r * 3.5; rightArm.rotation.z = -0.4 + r * 0.4; }
        if (leftArm) { leftArm.rotation.x = -0.8 + r * 1.2; }
        if (body) { body.rotation.x = -0.15 + r * 0.5; body.position.y = 1.08 - r * 0.2; }
      }
    } else if (classId === CLASS_WRAITH) {
      const flicker = Math.sin(progress * 16) * 0.03;
      if (isChanneling) {
        const p = Math.min(1, progress / 0.7);
        if (rightArm) { rightArm.rotation.x = 0.3 * p; rightArm.rotation.z = -0.4 - p * 0.3; }
        if (leftArm) { leftArm.rotation.x = 0.3 * p; leftArm.rotation.z = 0.4 + p * 0.3; }
        if (body) { body.position.y = 1.0 - p * 0.2; body.rotation.x = 0.3 * p + flicker; body.rotation.z = flicker * 2; }
      } else {
        const r = Math.sin(releasePhase * Math.PI);
        if (rightArm) { rightArm.rotation.x = 0.3 - r * 3.0; rightArm.rotation.z = -0.7 + r * 0.5; }
        if (leftArm) { leftArm.rotation.x = 0.3 - r * 3.0; leftArm.rotation.z = 0.7 - r * 0.5; }
        if (body) { body.position.y = 0.8 + r * 0.3; body.rotation.x = 0.3 - r * 0.4; }
      }
    } else if (classId === CLASS_INFERNAL) {
      const castSway = Math.sin(progress * 10) * 0.08;
      if (isChanneling) {
        const p = Math.min(1, progress / 0.7);
        if (leftArm) { leftArm.rotation.x = -1.8 * p; leftArm.rotation.z = 0.7 * p + castSway; }
        if (rightArm) { rightArm.rotation.x = -1.8 * p; rightArm.rotation.z = -0.7 * p - castSway; }
        if (body) { body.rotation.x = -0.2 * p; body.position.y = 1.0 + 0.12 * p; body.rotation.z = castSway * 0.5; }
      } else {
        const r = Math.sin(releasePhase * Math.PI);
        if (leftArm) { leftArm.rotation.x = -1.8 - r * 1.2; leftArm.rotation.z = 0.7 - r * 0.7; }
        if (rightArm) { rightArm.rotation.x = -1.8 - r * 1.2; rightArm.rotation.z = -0.7 + r * 0.7; }
        if (body) { body.rotation.x = -0.2 + r * 0.5; body.position.y = 1.12 - r * 0.15; }
      }
    } else if (classId === CLASS_HARBINGER) {
      const sway = Math.sin(progress * 10) * 0.08;
      const ritual = Math.sin(progress * 5) * 0.1;
      if (rightArm) { rightArm.rotation.x = -1.5 * castIntensity - 0.4; rightArm.rotation.z = -0.5 * castIntensity + sway; }
      if (leftArm) { leftArm.rotation.x = -0.9 * castIntensity; leftArm.rotation.z = 0.8 + sway; }
      if (body) { body.rotation.x = -0.15 + castIntensity * 0.2; body.rotation.z = ritual; body.position.y = 1.0 + castIntensity * 0.08; }
    } else if (classId === CLASS_REVENANT) {
      if (isChanneling) {
        const p = Math.min(1, progress / 0.7);
        if (rightArm) { rightArm.rotation.x = -0.5 - p * 2.8; rightArm.rotation.z = -p * 0.3; }
        if (leftArm) { leftArm.rotation.x = -p * 1.2; leftArm.rotation.z = 0.5 * p; }
        if (body) { body.rotation.x = -p * 0.2; body.position.y = 1.0 + p * 0.12; }
      } else {
        const r = Math.sin(releasePhase * Math.PI);
        if (rightArm) { rightArm.rotation.x = -3.3 + r * 3.0; }
        if (leftArm) { leftArm.rotation.x = -1.2 + r * 1.0; }
        if (body) { body.rotation.x = -0.2 + r * 0.4; body.position.y = 1.12 - r * 0.15; }
      }
    } else {
      if (leftArm) { leftArm.rotation.x = -castIntensity * 1.8; leftArm.rotation.z = castIntensity * 0.6; }
      if (rightArm) { rightArm.rotation.x = -castIntensity * 1.8; rightArm.rotation.z = -castIntensity * 0.6; }
      if (body) {
        if (progress < 0.4) { body.rotation.x = -0.12 * (1.0 - progress / 0.4); }
        else { body.rotation.x = 0.15 * ((progress - 0.4) / 0.6); }
        body.position.y = 1.0 + castIntensity * 0.03;
      }
    }

    // Head tilts up during cast
    if (head) head.rotation.x = -castIntensity * 0.15;

    // Glow hands during cast — class-colored
    const handColors = {
      [CLASS_INFERNAL]: 0xff4400,
      [CLASS_HARBINGER]: 0x8800cc,
      [CLASS_REVENANT]: 0xffd700,
      [CLASS_TYRANT]: 0xcc2200,
      [CLASS_WRAITH]: 0x332266
    };
    const glowColor = handColors[classId] || 0x4488ff;

    const leftHand = model.getObjectByName('leftHand');
    const rightHand = model.getObjectByName('rightHand');
    if (leftHand && leftHand.material) {
      leftHand.material.emissive = leftHand.material.emissive || new THREE.Color(0xffffff);
      leftHand.material.emissive.setHex(glowColor);
      leftHand.material.emissiveIntensity = castIntensity * 2.0;
    }
    if (rightHand && rightHand.material) {
      rightHand.material.emissive = rightHand.material.emissive || new THREE.Color(0xffffff);
      rightHand.material.emissive.setHex(glowColor);
      rightHand.material.emissiveIntensity = castIntensity * 2.0;
    }

    // Intensify glow on staff crystal — dim at idle, bright during cast
    const crystal = model.getObjectByName('staffCrystal');
    if (crystal) crystal.material.emissiveIntensity = 0.2 + castIntensity * 2.0;

    // Harbinger grimoire glow — dim at idle, bright during cast
    const grimoire = model.getObjectByName('grimoire');
    if (grimoire) {
      grimoire.traverse((child) => {
        if (child.isMesh && child.material) child.material.emissiveIntensity = 0.1 + castIntensity * 1.5;
      });
    }

    // Revenant halo glow — only bright during casting
    const halo = model.getObjectByName('halo');
    if (halo) halo.material.emissiveIntensity = 0.15 + castIntensity * 1.8;

    // Eye glow — subtle at idle, intense during cast
    const leftEye = model.getObjectByName('leftEye');
    const rightEye = model.getObjectByName('rightEye');
    if (leftEye && leftEye.material) leftEye.material.emissiveIntensity = 0.4 + castIntensity * 2.0;
    if (rightEye && rightEye.material) rightEye.material.emissiveIntensity = 0.4 + castIntensity * 2.0;
  }

  /**
   * Death animation — body tilts backward and falls.
   * Enhanced: fall to side (root.rotation.z increasing to PI/2 over time).
   * @param {THREE.Group} model
   * @param {number} progress — 0 (alive) to 1 (fully fallen)
   */
  animateDeath(model, progress) {
    const body = model.getObjectByName('body');
    if (!body) return;

    // Tilt backward
    body.rotation.x = progress * (Math.PI / 2);
    // Sink toward ground
    body.position.y = 1.0 - progress * 0.7;

    // Fall to side — root.rotation.z increases to PI/2
    model.rotation.z = progress * (Math.PI / 2);

    // Legs buckle
    const leftLeg = model.getObjectByName('leftLeg');
    const rightLeg = model.getObjectByName('rightLeg');
    if (leftLeg) leftLeg.rotation.x = progress * 0.8;
    if (rightLeg) rightLeg.rotation.x = progress * 0.8;
  }

  /**
   * Stun visual — body slumps forward, arms hang limp
   */
  animateStunned(model, time) {
    const body = model.getObjectByName('body');
    const leftArm = model.getObjectByName('leftArm');
    const rightArm = model.getObjectByName('rightArm');
    const head = model.getObjectByName('head');

    if (body) {
      body.rotation.x = 0.3; // slump forward
      body.position.y = 0.85; // sink slightly
    }
    if (leftArm) leftArm.rotation.z = 0.4; // arms hang out
    if (rightArm) rightArm.rotation.z = -0.4;
    if (head) head.rotation.x = 0.3; // head droops
  }

  /**
   * Root visual — legs frozen, upper body can still move slightly
   */
  animateRooted(model, time) {
    const body = model.getObjectByName('body');
    const leftArm = model.getObjectByName('leftArm');
    const rightArm = model.getObjectByName('rightArm');

    // Body sways slightly trying to break free
    if (body) body.position.y = 1.0 + Math.sin(time * 4) * 0.02;
    if (leftArm) leftArm.rotation.x = Math.sin(time * 3) * 0.3;
    if (rightArm) rightArm.rotation.x = -Math.sin(time * 3) * 0.3;

    // Legs stay perfectly still (override any walking)
    const leftLeg = model.getObjectByName('leftLeg');
    const rightLeg = model.getObjectByName('rightLeg');
    if (leftLeg) leftLeg.rotation.set(0, 0, 0);
    if (rightLeg) rightLeg.rotation.set(0, 0, 0);
  }

  /**
   * Fear visual — body shakes and wobbles erratically
   */
  animateFeared(model, time) {
    const body = model.getObjectByName('body');
    const head = model.getObjectByName('head');
    const leftArm = model.getObjectByName('leftArm');
    const rightArm = model.getObjectByName('rightArm');
    const leftLeg = model.getObjectByName('leftLeg');
    const rightLeg = model.getObjectByName('rightLeg');

    if (body) {
      body.rotation.z = Math.sin(time * 12) * 0.15; // fast wobble
      body.position.y = 1.0 + Math.abs(Math.sin(time * 8)) * 0.08;
    }
    if (head) head.rotation.z = Math.sin(time * 10 + 1) * 0.2;
    if (leftArm) leftArm.rotation.x = Math.sin(time * 14) * 0.5;
    if (rightArm) rightArm.rotation.x = Math.cos(time * 14) * 0.5;
    if (leftLeg) leftLeg.rotation.x = Math.sin(time * 10) * 0.6;
    if (rightLeg) rightLeg.rotation.x = Math.cos(time * 10) * 0.6;
  }

  /**
   * Silence visual — subtle purple tint (no dramatic animation, just restricted)
   */
  animateSilenced(model, time) {
    // Just do idle with a slight head-shake
    this.animateIdle(model, time);
    const head = model.getObjectByName('head');
    if (head) head.rotation.z = Math.sin(time * 6) * 0.08;
  }

  /**
   * Hit flash — briefly makes all meshes glow red, then fades back.
   * Call this once; it sets emissive to red. Use _restoreEmissives() to reset.
   * @param {THREE.Group} model
   */
  animateHit(model) {
    const originals = model.userData._originalEmissives;

    model.traverse((child) => {
      if (child.isMesh && child.material) {
        child.material.emissive = new THREE.Color(0xff0000);
        child.material.emissiveIntensity = 1.0;
      }
    });

    // Cancel previous hit flash timeout to prevent race conditions
    if (model.userData._hitFlashTimeout) clearTimeout(model.userData._hitFlashTimeout);
    model.userData._hitFlashTimeout = setTimeout(() => {
      model.traverse((child) => {
        if (child.isMesh && child.material && originals) {
          const orig = originals.get(child.uuid);
          if (orig) {
            child.material.emissive.copy(orig.emissive);
            child.material.emissiveIntensity = orig.emissiveIntensity;
          }
        }
      });
      model.userData._hitFlashTimeout = null;
    }, 150);
  }

  /**
   * Restore original emissive values after a hit flash or other emissive override.
   * @param {THREE.Group} model
   */
  _restoreEmissives(model) {
    const originals = model.userData._originalEmissives;
    if (!originals) return;

    model.traverse((child) => {
      if (child.isMesh && child.material) {
        const orig = originals.get(child.uuid);
        if (orig) {
          child.material.emissive.copy(orig.emissive);
          child.material.emissiveIntensity = orig.emissiveIntensity;
        }
      }
    });
  }

  /**
   * Stealth toggle — sets all mesh opacity.
   * @param {THREE.Group} model
   * @param {boolean} active — true = stealthed (transparent), false = visible
   */
  animateStealth(model, active) {
    const targetOpacity = active ? 0.3 : 1.0;

    model.traverse((child) => {
      if (child.isMesh && child.material) {
        child.material.transparent = active;
        child.material.opacity = targetOpacity;
        child.material.needsUpdate = true;
      }
    });
  }

  /**
   * Animate named special parts per class — called every frame from idle/walk/etc.
   * @param {THREE.Group} model
   * @param {number} time — elapsed time in seconds
   * @private
   */
  _animateNamedParts(model, time) {
    // ── 1. Halo rotation (Revenant) ──
    const halo = model.getObjectByName('halo');
    if (halo) {
      halo.rotation.z = time * 0.5;
    }

    // ── 2. RuneCircle rotation (Harbinger) ──
    const runeCircle = model.getObjectByName('runeCircle');
    if (runeCircle) {
      runeCircle.rotation.z = time * 0.8;
    }

    // ── 3. SoulOrb orbit (Harbinger) ──
    const soulOrb = model.getObjectByName('soulOrb');
    if (soulOrb) {
      soulOrb.position.x = 0.12 + Math.sin(time * 2.5) * 0.08;
      soulOrb.position.z = 0.08 + Math.cos(time * 2.5) * 0.08;
      soulOrb.position.y = -0.5 + Math.sin(time * 3) * 0.04;
    }

    // ── 4. StaffFlame bobbing + scale pulse (Infernal) ──
    const staffFlame = model.getObjectByName('staffFlame');
    if (staffFlame) {
      staffFlame.position.y = 0.9 + Math.sin(time * 4) * 0.04;
      staffFlame.scale.setScalar(0.9 + Math.sin(time * 6) * 0.15);
    }

    // ── 5. Cape cloth sway (Tyrant, Wraith, Revenant) ──
    const cape = model.getObjectByName('cape');
    if (cape) {
      cape.rotation.x = Math.sin(time * 1.5) * 0.08;
      cape.rotation.z = Math.sin(time * 1.2 + 0.5) * 0.04;
    }

    // ── 6. Infernal fire particles orbit ──
    for (let i = 0; i < 6; i++) {
      const particle = model.getObjectByName('fireParticle' + i);
      if (particle) {
        const angle = time * 2.0 + i * (Math.PI * 2 / 6);
        const radius = 0.25 + Math.sin(time * 3 + i) * 0.05;
        particle.position.x = Math.cos(angle) * radius;
        particle.position.z = Math.sin(angle) * radius;
        particle.position.y = 0.6 + Math.sin(time * 4 + i * 1.5) * 0.08;
      } else {
        break;
      }
    }

    // ── 7. Infernal embers float upward ──
    const ember = model.getObjectByName('ember');
    if (ember) {
      ember.position.y = 0.5 + Math.sin(time * 3) * 0.1;
      ember.position.x = Math.sin(time * 2.2) * 0.06;
    }
    const ember2 = model.getObjectByName('ember2');
    if (ember2) {
      ember2.position.y = 0.6 + Math.sin(time * 3.5 + 1) * 0.1;
      ember2.position.x = Math.cos(time * 2.8) * 0.06;
    }

    // ── 8. Infernal crystal spin (staffCrystal) ──
    const crystal = model.getObjectByName('staffCrystal');
    if (crystal) {
      crystal.rotation.y = time * 1.5;
    }

    // ── 9. Infernal crown spike pulse (crownSpike0-N) ──
    for (let i = 0; i < 8; i++) {
      const spike = model.getObjectByName('crownSpike' + i);
      if (spike) {
        spike.material.emissiveIntensity = 1.5 + Math.sin(time * 3.0 + i * 0.7) * 0.8;
      } else {
        break;
      }
    }

    // ── 10. Infernal sash gem pulse ──
    const sashGem = model.getObjectByName('sashGem');
    if (sashGem) {
      sashGem.material.emissiveIntensity = 1.5 + Math.sin(time * 2.5) * 0.5;
    }

    // ── 11. Infernal chest gem + lava cracks glow ──
    const chestGem = model.getObjectByName('chestGem');
    if (chestGem) {
      chestGem.material.emissiveIntensity = 2.0 + Math.sin(time * 2.0) * 0.8;
    }
    for (let i = 0; i < 5; i++) {
      const crack = model.getObjectByName('lavaCrack' + i);
      if (crack) {
        crack.material.emissiveIntensity = 1.0 + Math.sin(time * 2.5 + i * 1.2) * 0.6;
      } else {
        break;
      }
    }

    // ── 12. Harbinger skull eye glow pulse ──
    const skullEye = model.getObjectByName('skullEye');
    if (skullEye) {
      skullEye.material.emissiveIntensity = 1.0 + Math.sin(time * 3.0) * 0.5;
    }
    const skullLight = model.getObjectByName('skullLight');
    if (skullLight) {
      skullLight.intensity = 0.8 + Math.sin(time * 3.0) * 0.3;
    }

    // ── 13. Harbinger grimoire page flutter ──
    const grimoireLeft = model.getObjectByName('grimoireLeft');
    if (grimoireLeft) {
      grimoireLeft.rotation.y = -0.3 + Math.sin(time * 2.0) * 0.08;
    }
    const grimoireRight = model.getObjectByName('grimoireRight');
    if (grimoireRight) {
      grimoireRight.rotation.y = 0.3 + Math.sin(time * 2.0 + 0.5) * 0.08;
    }

    // ── 14. Revenant wing breathing/flap (leftWing, rightWing) ──
    const leftWing = model.getObjectByName('leftWing');
    if (leftWing) {
      leftWing.rotation.z = Math.sin(time * 1.2) * 0.08;
    }
    const rightWing = model.getObjectByName('rightWing');
    if (rightWing) {
      rightWing.rotation.z = -Math.sin(time * 1.2) * 0.08;
    }

    // ── 15. Revenant shield cross glow pulse ──
    const shieldCrossGlow = model.getObjectByName('shieldCrossGlow');
    if (shieldCrossGlow) {
      shieldCrossGlow.material.emissiveIntensity = 0.8 + Math.sin(time * 2.0) * 0.3;
      shieldCrossGlow.material.opacity = 0.5 + Math.sin(time * 2.0) * 0.2;
    }

    // ── 16. Eye glow pulsing ──
    // Tyrant: leftEyeGlow / rightEyeGlow
    const leftEyeGlow = model.getObjectByName('leftEyeGlow');
    if (leftEyeGlow) {
      leftEyeGlow.material.emissiveIntensity = 1.2 + Math.sin(time * 3.0) * 0.4;
    }
    const rightEyeGlow = model.getObjectByName('rightEyeGlow');
    if (rightEyeGlow) {
      rightEyeGlow.material.emissiveIntensity = 1.2 + Math.sin(time * 3.0) * 0.4;
    }
    // Wraith / Harbinger: leftEye / rightEye (only if emissive)
    const leftEye = model.getObjectByName('leftEye');
    if (leftEye && leftEye.material && leftEye.material.emissiveIntensity !== undefined) {
      leftEye.material.emissiveIntensity = 1.2 + Math.sin(time * 2.8) * 0.5;
    }
    const rightEye = model.getObjectByName('rightEye');
    if (rightEye && rightEye.material && rightEye.material.emissiveIntensity !== undefined) {
      rightEye.material.emissiveIntensity = 1.2 + Math.sin(time * 2.8) * 0.5;
    }

    // ── 17. Tyrant sword glow pulse ──
    const swordGlow = model.getObjectByName('swordGlow');
    if (swordGlow) {
      swordGlow.material.opacity = 0.5 + Math.sin(time * 2.0) * 0.2;
    }

    // ── 18. Wraith dagger glow pulse ──
    const leftDaggerGlow = model.getObjectByName('leftDaggerGlow');
    if (leftDaggerGlow) {
      leftDaggerGlow.material.emissiveIntensity = 1.5 + Math.sin(time * 3.5) * 0.6;
    }
    const rightDaggerGlow = model.getObjectByName('rightDaggerGlow');
    if (rightDaggerGlow) {
      rightDaggerGlow.material.emissiveIntensity = 1.5 + Math.sin(time * 3.5 + 1.0) * 0.6;
    }

    // ── 19. Infernal palm glow pulse ──
    const palmGlow = model.getObjectByName('leftPalmGlow');
    if (palmGlow) {
      palmGlow.material.emissiveIntensity = 2.0 + Math.sin(time * 4.0) * 1.0;
    }

    // ── 20. Tyrant face light intensity pulse ──
    const faceLight = model.getObjectByName('faceLight');
    if (faceLight) {
      faceLight.intensity = 0.6 + Math.sin(time * 3.0) * 0.2;
    }
  }

  // ── Per-frame update ────────────────────────────────────────────────────

  /**
   * Update a character's transform and animation each frame.
   * @param {string} unitId
   * @param {object} unitState — { position: {x,y,z}, rotation: number, state: string, castProgress?: number, attackProgress?: number, deathProgress?: number, speed?: number, stealthed?: boolean }
   * @param {number} time — elapsed time in seconds
   */
  updateCharacter(unitId, unitState, time) {
    const model = this.characters.get(unitId);
    if (!model) return;

    // Position
    if (unitState.position) {
      model.position.set(
        unitState.position.x || 0,
        unitState.position.y || 0,
        unitState.position.z || 0
      );
    }

    // Rotation (facing) — whirlwind overrides with rapid spin
    if (unitState.whirlwind) {
      model.rotation.y = time * 12; // ~2 full spins per second
      // Slight body dip + arms out for whirlwind feel
      const body = model.getObjectByName('body');
      if (body) body.position.y = 0.95 + Math.sin(time * 24) * 0.03;
      const leftArm = model.getObjectByName('leftArm');
      const rightArm = model.getObjectByName('rightArm');
      if (leftArm) { leftArm.rotation.z = -Math.PI * 0.45; leftArm.rotation.x = 0; }
      if (rightArm) { rightArm.rotation.z = Math.PI * 0.45; rightArm.rotation.x = 0; }
      this._animateNamedParts(model, time);
      return; // skip normal animation state machine
    } else if (unitState.rotation !== undefined) {
      model.rotation.y = unitState.rotation;
    }

    // Stealth
    if (unitState.stealthed !== undefined) {
      this.animateStealth(model, unitState.stealthed);
    }

    // Animation state machine
    switch (unitState.state) {
      case 'idle':
        this._resetPose(model);
        this.animateIdle(model, time);
        break;

      case 'moving':
      case 'walk':
        this._resetPose(model);
        this.animateWalk(model, time, unitState.speed || 1);
        break;

      case 'attacking':
      case 'attack':
        this._resetPose(model);
        this.animateAbility(model, unitState.attackProgress || 0, unitState.attackAbilityId, time);
        break;

      case 'casting':
      case 'cast':
        this._resetPose(model);
        this.animateCast(model, unitState.castProgress || 0, unitState.castAbilityId);
        break;

      case 'hit':
        this.animateHit(model);
        break;

      case 'dead':
      case 'death':
        this.animateDeath(model, unitState.deathProgress || 1);
        break;

      case 'stunned':
        this._resetPose(model);
        this.animateStunned(model, time);
        break;

      case 'rooted':
        this._resetPose(model);
        this.animateRooted(model, time);
        break;

      case 'feared':
        this._resetPose(model);
        this.animateFeared(model, time);
        break;

      case 'silenced':
        this._resetPose(model);
        this.animateSilenced(model, time);
        break;

      case 'rolling': {
        this._resetPose(model);
        const rollProg = unitState.rollProgress || 0;
        model.rotation.z = rollProg * Math.PI * 2; // full barrel roll
        // Move body low during roll
        const rollBody = model.getObjectByName('body');
        if (rollBody) {
          rollBody.position.y = 0.5 + Math.sin(rollProg * Math.PI) * 0.3;
        }
        break;
      }

      default:
        this.animateIdle(model, time);
        break;
    }
  }

  /**
   * Reset body / arm / leg rotations to neutral pose before applying a new animation.
   * @param {THREE.Group} model
   * @private
   */
  _resetPose(model) {
    // Clear any pending external scale resets (hit squash timeouts)
    if (model.userData._squashTimeout) {
      clearTimeout(model.userData._squashTimeout);
      model.userData._squashTimeout = null;
    }
    const body = model.getObjectByName('body');
    if (body) {
      body.rotation.set(0, 0, 0);
      body.position.y = 1.0;
      body.scale.set(1, 1, 1);
    }
    const head = model.getObjectByName('head');
    if (head) head.rotation.set(0, 0, 0);

    const leftArm = model.getObjectByName('leftArm');
    const rightArm = model.getObjectByName('rightArm');
    if (leftArm) leftArm.rotation.set(0, 0, 0);
    if (rightArm) rightArm.rotation.set(0, 0, 0);

    const leftLeg = model.getObjectByName('leftLeg');
    const rightLeg = model.getObjectByName('rightLeg');
    if (leftLeg) leftLeg.rotation.set(0, 0, 0);
    if (rightLeg) rightLeg.rotation.set(0, 0, 0);

    // Reset death fall rotation
    model.rotation.z = 0;

    const trail = model.getObjectByName('weaponTrail');
    if (trail) trail.visible = false;
  }

  // ── Utility ─────────────────────────────────────────────────────────────

  /**
   * Get the model for a unitId.
   * @param {string} unitId
   * @returns {THREE.Group|undefined}
   */
  getCharacter(unitId) {
    return this.characters.get(unitId);
  }

  /**
   * Remove all characters from the scene.
   */
  clear() {
    for (const unitId of this.characters.keys()) {
      this.removeCharacter(unitId);
    }
  }

  // ── 3D Portrait Renderer ──────────────────────────────────────────────────

  /**
   * Renders 3D bust portraits for all classes using an offscreen WebGLRenderer.
   * Returns a Map of classId → data URL (PNG).
   * @param {number} [size=256] — portrait resolution (square)
   * @returns {Map<string, string>} classId → dataURL
   */
  static renderPortraits(size = 256) {
    const portraits = new Map();
    const allClasses = [CLASS_TYRANT, CLASS_WRAITH, CLASS_INFERNAL, CLASS_HARBINGER, CLASS_REVENANT];

    // Class-specific camera and lighting configs for dramatic portraits
    const classConfigs = {
      [CLASS_TYRANT]: {
        camPos: [0.6, 2.4, 2.0],  camLookAt: [0, 1.6, 0],
        keyColor: 0xffeedd, keyIntensity: 2.5, keyPos: [2, 3, 2],
        fillColor: 0x883322, fillIntensity: 0.8, fillPos: [-2, 1, 1],
        rimColor: 0xff4422, rimIntensity: 1.5, rimPos: [-1, 2, -2],
        bgColor: 0x1a0808
      },
      [CLASS_WRAITH]: {
        camPos: [0.5, 2.2, 1.8],  camLookAt: [0, 1.5, 0],
        keyColor: 0xccccff, keyIntensity: 2.0, keyPos: [1.5, 3, 2],
        fillColor: 0x442266, fillIntensity: 0.8, fillPos: [-2, 1, 0.5],
        rimColor: 0x8844cc, rimIntensity: 1.8, rimPos: [-1, 2.5, -2],
        bgColor: 0x0a0812
      },
      [CLASS_INFERNAL]: {
        camPos: [0.4, 2.5, 2.0],  camLookAt: [0, 1.7, 0],
        keyColor: 0xfff0dd, keyIntensity: 2.5, keyPos: [2, 3.5, 2],
        fillColor: 0xff6600, fillIntensity: 0.6, fillPos: [-2, 1, 1],
        rimColor: 0xff4400, rimIntensity: 2.0, rimPos: [0, 2, -2.5],
        bgColor: 0x120808
      },
      [CLASS_HARBINGER]: {
        camPos: [0.5, 2.3, 1.9],  camLookAt: [0, 1.6, 0],
        keyColor: 0xddffdd, keyIntensity: 2.0, keyPos: [1.5, 3, 2],
        fillColor: 0x225522, fillIntensity: 0.8, fillPos: [-2, 1, 0.5],
        rimColor: 0x44ff44, rimIntensity: 1.5, rimPos: [-1, 2.5, -2],
        bgColor: 0x061008
      },
      [CLASS_REVENANT]: {
        camPos: [0.5, 2.4, 2.0],  camLookAt: [0, 1.6, 0],
        keyColor: 0xffffee, keyIntensity: 2.5, keyPos: [2, 3, 2],
        fillColor: 0xddaa44, fillIntensity: 0.8, fillPos: [-2, 1, 1],
        rimColor: 0xffdd66, rimIntensity: 1.8, rimPos: [-1, 2, -2],
        bgColor: 0x100e06
      }
    };

    // Create offscreen renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(size, size);
    renderer.setPixelRatio(1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);

    for (const classId of allClasses) {
      const scene = new THREE.Scene();
      const cfg = classConfigs[classId];
      scene.background = new THREE.Color(cfg.bgColor);

      // Build the character model (same function used in-game)
      const builder = CLASS_BUILDERS.get(classId);
      if (!builder) continue;
      const model = builder();
      model.scale.set(2.5, 2.5, 2.5);
      scene.add(model);

      // Slight heroic body turn — facing slightly toward camera
      model.rotation.y = -0.2;

      // 3-point lighting: key, fill, rim
      const key = new THREE.DirectionalLight(cfg.keyColor, cfg.keyIntensity);
      key.position.set(...cfg.keyPos);
      scene.add(key);

      const fill = new THREE.DirectionalLight(cfg.fillColor, cfg.fillIntensity);
      fill.position.set(...cfg.fillPos);
      scene.add(fill);

      const rim = new THREE.DirectionalLight(cfg.rimColor, cfg.rimIntensity);
      rim.position.set(...cfg.rimPos);
      scene.add(rim);

      // Ambient for shadow fill
      scene.add(new THREE.AmbientLight(0x222222, 0.4));

      // Camera: heroic upward angle at upper body
      camera.position.set(...cfg.camPos);
      camera.lookAt(new THREE.Vector3(...cfg.camLookAt));
      camera.updateProjectionMatrix();

      renderer.render(scene, camera);

      // Extract data URL
      portraits.set(classId.toLowerCase(), renderer.domElement.toDataURL('image/png'));

      // Dispose model
      model.traverse(child => {
        if (child.isMesh) {
          child.geometry.dispose();
          if (child.material.dispose) child.material.dispose();
        }
      });
    }

    renderer.dispose();
    return portraits;
  }
}
