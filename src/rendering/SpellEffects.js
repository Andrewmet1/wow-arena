import * as THREE from 'three';

// ─── Spell texture loader ─────────────────────────────────────────────────────
const _spellTexLoader = new THREE.TextureLoader();
const SPELL_TEXTURES = {};

function _loadSpellTex(school) {
  const tex = _spellTexLoader.load(`/assets/textures/tex_spell_${school}.webp`);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

SPELL_TEXTURES.fire = _loadSpellTex('fire');
SPELL_TEXTURES.shadow = _loadSpellTex('shadow');
SPELL_TEXTURES.holy = _loadSpellTex('holy');
SPELL_TEXTURES.frost = _loadSpellTex('frost');
SPELL_TEXTURES.arcane = _loadSpellTex('arcane');
SPELL_TEXTURES.nature = _loadSpellTex('nature');
// Physical school reuses fire texture as a subtle fallback (tinted by material color)
SPELL_TEXTURES.physical = SPELL_TEXTURES.fire;

// ─── Shared unit-radius sphere geometry pool (avoids per-spawn GPU allocations) ─
// dispose() overridden to no-op so cleanup code doesn't destroy shared buffers.
function _makeSharedSphere(segs) {
  const geo = new THREE.SphereGeometry(1, segs, segs);
  geo.dispose = () => {}; // shared — never dispose
  return geo;
}
const _sphereGeo4 = _makeSharedSphere(4);
const _sphereGeo6 = _makeSharedSphere(6);
const _sphereGeo8 = _makeSharedSphere(8);
const _sphereGeo10 = _makeSharedSphere(10);
const _sphereGeo12 = _makeSharedSphere(12);

// ─── VFX-specific textures (DALL-E generated + procedural) ───────────────────
function _loadVfxTex(name) {
  const tex = _spellTexLoader.load(`/assets/textures/tex_vfx_${name}.webp`);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const VFX_TEXTURES = {};
// School-based VFX textures
VFX_TEXTURES.fire = _loadVfxTex('fire_eruption');
VFX_TEXTURES.frost = _loadVfxTex('frost_crystal');
VFX_TEXTURES.shadow = _loadVfxTex('shadow_rune');
VFX_TEXTURES.holy = _loadVfxTex('holy_radiance');
VFX_TEXTURES.lightning = _loadVfxTex('lightning_arc');
VFX_TEXTURES.blood = _loadVfxTex('blood_slash');
VFX_TEXTURES.poison = _loadVfxTex('poison_mist');
VFX_TEXTURES.arcane = _loadVfxTex('arcane_swirl');
// Tyrant (Warrior) class textures
VFX_TEXTURES.tyrantCleave = _loadVfxTex('tyrant_cleave');
VFX_TEXTURES.tyrantCyclone = _loadVfxTex('tyrant_cyclone');
VFX_TEXTURES.tyrantSlam = _loadVfxTex('tyrant_slam');
// Wraith (Rogue) class textures
VFX_TEXTURES.wraithSlash = _loadVfxTex('wraith_slash');
VFX_TEXTURES.wraithShadow = _loadVfxTex('wraith_shadow');
VFX_TEXTURES.wraithPoison = _loadVfxTex('wraith_poison');
// Infernal (Mage) class textures
VFX_TEXTURES.infernalFireball = _loadVfxTex('infernal_fireball');
VFX_TEXTURES.infernalFrost = _loadVfxTex('infernal_frost');
VFX_TEXTURES.infernalArcane = _loadVfxTex('infernal_arcane');
VFX_TEXTURES.infernalEruption = _loadVfxTex('infernal_eruption');
// Harbinger (Warlock) class textures
VFX_TEXTURES.harbingerCurse = _loadVfxTex('harbinger_curse');
VFX_TEXTURES.harbingerDrain = _loadVfxTex('harbinger_drain');
VFX_TEXTURES.harbingerPortal = _loadVfxTex('harbinger_portal');
VFX_TEXTURES.harbingerNova = _loadVfxTex('harbinger_nova');
// Revenant (Paladin) class textures
VFX_TEXTURES.revenantSmite = _loadVfxTex('revenant_smite');
VFX_TEXTURES.revenantHeal = _loadVfxTex('revenant_heal');
VFX_TEXTURES.revenantShield = _loadVfxTex('revenant_shield');
VFX_TEXTURES.revenantPillar = _loadVfxTex('revenant_pillar');
// Shared VFX textures
VFX_TEXTURES.energyOrb = _loadVfxTex('energy_orb');
VFX_TEXTURES.impactRing = _loadVfxTex('impact_ring');
VFX_TEXTURES.steelSlash = _loadVfxTex('steel_slash');
VFX_TEXTURES.groundCrack = _loadVfxTex('ground_crack');
VFX_TEXTURES.natureVines = _loadVfxTex('nature_vines');
VFX_TEXTURES.stunImpact = _loadVfxTex('stun_impact');

// ─── Procedural Canvas Textures ──────────────────────────────────────────────

function _createCanvasTexture(size, drawFn) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  drawFn(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Rune circle texture — glowing magic circle with sigils
const PROC_TEXTURES = {};
PROC_TEXTURES.runeCircle = _createCanvasTexture(256, (ctx, s) => {
  const c = s / 2;
  ctx.clearRect(0, 0, s, s);
  // Outer ring
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(c, c, c * 0.85, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(c, c, c * 0.75, 0, Math.PI * 2); ctx.stroke();
  // Inner ring
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(c, c, c * 0.5, 0, Math.PI * 2); ctx.stroke();
  // Rune sigils around circle
  ctx.font = `${s * 0.12}px serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const runes = '\u16A0\u16A2\u16A6\u16B1\u16B7\u16C1\u16C7\u16D2'; // Elder Futhark
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const rx = c + Math.cos(a) * c * 0.65;
    const ry = c + Math.sin(a) * c * 0.65;
    ctx.save();
    ctx.translate(rx, ry);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillText(runes[i], 0, 0);
    ctx.restore();
  }
  // Cross lines
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * c * 0.5, c + Math.sin(a) * c * 0.5);
    ctx.lineTo(c + Math.cos(a + Math.PI) * c * 0.5, c + Math.sin(a + Math.PI) * c * 0.5);
    ctx.stroke();
  }
  // Center pentagram
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= 5; i++) {
    const a = ((i * 2) % 5) / 5 * Math.PI * 2 - Math.PI / 2;
    const px = c + Math.cos(a) * c * 0.35;
    const py = c + Math.sin(a) * c * 0.35;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();
});

// Energy swirl texture
PROC_TEXTURES.energySwirl = _createCanvasTexture(256, (ctx, s) => {
  const c = s / 2;
  ctx.clearRect(0, 0, s, s);
  for (let i = 0; i < 5; i++) {
    ctx.strokeStyle = `rgba(255,255,255,${0.3 + i * 0.12})`;
    ctx.lineWidth = 2 + i;
    ctx.beginPath();
    for (let t = 0; t < 200; t++) {
      const a = (t / 200) * Math.PI * 4 + i * 0.5;
      const r = (t / 200) * c * 0.8 + 10;
      const x = c + Math.cos(a) * r;
      const y = c + Math.sin(a) * r;
      if (t === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
});

// Lightning crack texture
PROC_TEXTURES.lightning = _createCanvasTexture(128, (ctx, s) => {
  ctx.clearRect(0, 0, s, s);
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 3;
  ctx.shadowColor = 'rgba(150,180,255,1)';
  ctx.shadowBlur = 8;
  // Main bolt
  let y = 0;
  let x = s / 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  while (y < s) {
    x += (Math.random() - 0.5) * 30;
    y += 5 + Math.random() * 15;
    ctx.lineTo(Math.max(10, Math.min(s - 10, x)), Math.min(y, s));
  }
  ctx.stroke();
  // Branches
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 4; i++) {
    const bx = s * 0.3 + Math.random() * s * 0.4;
    const by = Math.random() * s * 0.7;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    let cx = bx, cy = by;
    for (let j = 0; j < 5; j++) {
      cx += (Math.random() - 0.5) * 20;
      cy += 5 + Math.random() * 10;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }
});

// Slash arc texture
PROC_TEXTURES.slashArc = _createCanvasTexture(256, (ctx, s) => {
  ctx.clearRect(0, 0, s, s);
  const grad = ctx.createLinearGradient(0, 0, s, s);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.8)');
  grad.addColorStop(0.5, 'rgba(255,255,255,1)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, s, s);
});

/**
 * Manages spell visual effects using particle systems and mesh animations.
 * Enhanced with school-specific projectile coloring, spinning rings, trail spheres,
 * shockwave impacts, ground decals, aura/fear/root ongoing effects, and death bursts.
 */
export { VFX_TEXTURES };

export class SpellEffects {
  constructor(scene) {
    this.scene = scene;
    this.activeEffects = [];
    this.maxActiveEffects = 50;
    this.bloodDecals = [];
    this.maxBloodDecals = 50;
    this._clock = new THREE.Clock();
    this._elapsedTime = 0;
  }

  // ──────────────────────────────────────────────
  //  PROJECTILE
  // ──────────────────────────────────────────────

  /**
   * Spawn a projectile effect traveling from source to target.
   * Includes spinning ring, trail spheres, and school-specific coloring.
   */
  spawnProjectile(from, to, config) {
    const { color = 0xff4400, size = 0.8, speed = 40, trailLength = 8, school = 'fire', tex = null } = config;

    const group = new THREE.Group();

    // --- School-specific core & glow ---
    const schoolVisuals = this._buildSchoolProjectile(school, color, size);
    group.add(schoolVisuals.core);
    if (schoolVisuals.glow) group.add(schoolVisuals.glow);
    if (schoolVisuals.outerGlow) group.add(schoolVisuals.outerGlow);

    // --- Spinning ring around projectile ---
    const ringGeo = new THREE.RingGeometry(size * 1.6, size * 2.0, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide
    });
    const spinningRing = new THREE.Mesh(ringGeo, ringMat);
    group.add(spinningRing);

    // --- Trail spheres (trailing meshes with decreasing opacity) ---
    const trailSphereCount = 6;
    const trailSpheres = [];
    for (let t = 0; t < trailSphereCount; t++) {
      const trailSize = Math.max(size * (0.7 - t * 0.1), 0.05);
      const trailMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.6 - t * 0.09
      });
      const trailMesh = new THREE.Mesh(_sphereGeo12, trailMat);
      trailMesh.scale.setScalar(trailSize);
      trailMesh.visible = false; // hidden until projectile has moved enough
      group.add(trailMesh);
      trailSpheres.push({
        mesh: trailMesh,
        offset: (t + 1) * size * 1.5 // distance behind the projectile head
      });
    }

    const startPos = new THREE.Vector3(from.x, from.y || 1.5, from.z);
    group.position.copy(startPos);
    this.scene.add(group);

    const direction = new THREE.Vector3(
      to.x - from.x,
      (to.y || 1.5) - (from.y || 1.5),
      to.z - from.z
    );
    const totalDist = direction.length();
    direction.normalize();

    // Orient spinning ring perpendicular to travel direction
    const axis = new THREE.Vector3(0, 0, 1);
    const quat = new THREE.Quaternion().setFromUnitVectors(axis, direction);
    spinningRing.quaternion.copy(quat);

    // Record previous positions for trail following
    const positionHistory = [];

    this.activeEffects.push({
      type: 'projectile',
      group,
      direction,
      speed,
      traveled: 0,
      totalDist,
      spinningRing,
      spinAngle: 0,
      trailSpheres,
      positionHistory,
      school,
      schoolVisuals,
      size,
      color,
      trail: null,         // kept for compatibility
      trailPositions: [],  // kept for compatibility
      onComplete: () => {
        this.spawnImpact(to, { color, size: size * 3, school });
      }
    });
  }

  /**
   * Build school-specific core and glow meshes for projectiles.
   */
  _buildSchoolProjectile(school, color, size) {
    const result = {};
    // Higher poly count (16 segments) for smoother spheres
    const segs = 16;

    switch (school) {
      case 'fire': {
        const coreGeo = new THREE.SphereGeometry(size, segs, segs);
        const coreMat = new THREE.MeshBasicMaterial({
          color: 0xff4400,
          transparent: true,
          opacity: 0.95,
          map: SPELL_TEXTURES.fire || null
        });
        result.core = new THREE.Mesh(coreGeo, coreMat);
        result.core.userData._fireMat = coreMat;

        const glowGeo = new THREE.SphereGeometry(size * 2.8, segs, segs);
        const glowMat = new THREE.MeshBasicMaterial({
          color: 0xff6600,
          transparent: true,
          opacity: 0.25,
          map: SPELL_TEXTURES.fire || null
        });
        result.glow = new THREE.Mesh(glowGeo, glowMat);
        result.glow.userData._fireMat = glowMat;
        break;
      }

      case 'shadow': {
        const coreGeo = new THREE.SphereGeometry(size * 0.6, segs, segs);
        const coreMat = new THREE.MeshBasicMaterial({
          color: 0x110022,
          transparent: true,
          opacity: 0.95,
          map: SPELL_TEXTURES.shadow || null
        });
        result.core = new THREE.Mesh(coreGeo, coreMat);

        const outerGeo = new THREE.SphereGeometry(size * 2.5, segs, segs);
        const outerMat = new THREE.MeshBasicMaterial({
          color: 0x8800ff,
          transparent: true,
          opacity: 0.25,
          map: SPELL_TEXTURES.shadow || null
        });
        result.outerGlow = new THREE.Mesh(outerGeo, outerMat);

        const glowGeo = new THREE.SphereGeometry(size * 1.5, segs, segs);
        const glowMat = new THREE.MeshBasicMaterial({
          color: 0x6600aa,
          transparent: true,
          opacity: 0.4,
          map: SPELL_TEXTURES.shadow || null
        });
        result.glow = new THREE.Mesh(glowGeo, glowMat);
        break;
      }

      case 'holy': {
        const coreGeo = new THREE.SphereGeometry(size * 0.7, segs, segs);
        const coreMat = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 1.0,
          map: SPELL_TEXTURES.holy || null
        });
        result.core = new THREE.Mesh(coreGeo, coreMat);

        const glowGeo = new THREE.SphereGeometry(size * 2.8, segs, segs);
        const glowMat = new THREE.MeshBasicMaterial({
          color: 0xffd700,
          transparent: true,
          opacity: 0.3,
          map: SPELL_TEXTURES.holy || null
        });
        result.glow = new THREE.Mesh(glowGeo, glowMat);
        break;
      }

      case 'physical': {
        const coreGeo = new THREE.SphereGeometry(size * 0.5, segs, segs);
        const coreMat = new THREE.MeshBasicMaterial({
          color: 0xcccccc,
          transparent: true,
          opacity: 0.95
        });
        result.core = new THREE.Mesh(coreGeo, coreMat);
        result.core.scale.set(1, 1, 2.0);

        const glowGeo = new THREE.SphereGeometry(size * 1.5, segs, segs);
        const glowMat = new THREE.MeshBasicMaterial({
          color: 0x888888,
          transparent: true,
          opacity: 0.2
        });
        result.glow = new THREE.Mesh(glowGeo, glowMat);
        break;
      }

      default: {
        const coreGeo = new THREE.SphereGeometry(size, segs, segs);
        const coreMat = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.9,
          map: SPELL_TEXTURES[school] || null
        });
        result.core = new THREE.Mesh(coreGeo, coreMat);

        const glowGeo = new THREE.SphereGeometry(size * 3, segs, segs);
        const glowMat = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.3,
          map: SPELL_TEXTURES[school] || null
        });
        result.glow = new THREE.Mesh(glowGeo, glowMat);
        break;
      }
    }

    return result;
  }

  // ──────────────────────────────────────────────
  //  IMPACT
  // ──────────────────────────────────────────────

  /**
   * Spawn impact burst at a position.
   * Includes varied-size mesh particles, ground decal, shockwave ring, and ground flash.
   */
  spawnImpact(position, config) {
    const { color = 0xff4400, size = 3.5, particleCount = 16, school = 'fire', scale = 1.0, weaponTrail = false, tex = null } = config;

    const impactGroup = new THREE.Group();
    impactGroup.position.set(position.x, 0, position.z);
    this.scene.add(impactGroup);

    // --- Mesh-based impact particles (10-18 with varied sizes and shapes) ---
    const actualCount = Math.max(10, Math.min(18, particleCount));
    const impactParticles = [];
    const schoolTex = tex || VFX_TEXTURES[school] || SPELL_TEXTURES[school] || null;
    for (let i = 0; i < actualCount; i++) {
      const pSize = (0.08 + Math.random() * 0.2) * (size * 0.25);
      const pMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        map: schoolTex
      });
      const pMesh = new THREE.Mesh(_sphereGeo10, pMat);
      pMesh.position.set(0, position.y || 1.5, 0);
      // Elongate some particles randomly
      if (i % 3 === 0) pMesh.scale.set(pSize, pSize * 0.5, pSize * 2.0);
      else pMesh.scale.setScalar(pSize);
      impactGroup.add(pMesh);

      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 5;
      impactParticles.push({
        mesh: pMesh,
        velocity: new THREE.Vector3(
          Math.cos(angle) * speed,
          2 + Math.random() * 5,
          Math.sin(angle) * speed
        ),
        rotSpeed: (Math.random() - 0.5) * 8
      });
    }

    // --- Ground decal (CircleGeometry flat on ground, fades out over 2s) ---
    const decalSize = size * 0.6;
    const decalGeo = new THREE.CircleGeometry(decalSize, 16);
    const decalMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      map: tex || VFX_TEXTURES.impactRing || SPELL_TEXTURES[school] || null
    });
    const groundDecal = new THREE.Mesh(decalGeo, decalMat);
    groundDecal.rotation.x = -Math.PI / 2;
    groundDecal.position.set(0, 0.27, 0);
    impactGroup.add(groundDecal);

    // --- Shockwave ring (RingGeometry that scales up and fades out) ---
    const shockGeo = new THREE.RingGeometry(0.1, 0.3, 24);
    const shockMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide
    });
    const shockwave = new THREE.Mesh(shockGeo, shockMat);
    shockwave.rotation.x = -Math.PI / 2;
    shockwave.position.set(0, 0.28, 0);
    impactGroup.add(shockwave);

    // --- Brief ground flash (CircleGeometry, 0.2s flash then fade) ---
    const flashGeo = new THREE.CircleGeometry(size * 0.8, 24);
    const flashMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      map: SPELL_TEXTURES[school] || null
    });
    const groundFlash = new THREE.Mesh(flashGeo, flashMat);
    groundFlash.rotation.x = -Math.PI / 2;
    groundFlash.position.set(0, 0.29, 0);
    impactGroup.add(groundFlash);

    // --- Optional weapon trail arc ---
    let weaponTrailMesh = null;
    if (weaponTrail) {
      const arcPoints = [];
      for (let a = 0; a <= 8; a++) {
        const angle = (a / 8) * Math.PI * 0.8 - Math.PI * 0.4;
        arcPoints.push(new THREE.Vector3(
          Math.cos(angle) * size * 0.8,
          (position.y || 1.5) + Math.sin(angle) * size * 0.3,
          0
        ));
      }
      const arcCurve = new THREE.CatmullRomCurve3(arcPoints);
      const arcGeo = new THREE.TubeGeometry(arcCurve, 8, 0.04, 4, false);
      const arcMat = new THREE.MeshBasicMaterial({
        color: 0xcccccc,
        transparent: true,
        opacity: 0.7
      });
      weaponTrailMesh = new THREE.Mesh(arcGeo, arcMat);
      impactGroup.add(weaponTrailMesh);
    }

    this.activeEffects.push({
      type: 'impact',
      impactGroup,
      impactParticles,
      groundDecal,
      shockwave,
      groundFlash,
      weaponTrailMesh,
      age: 0,
      maxAge: 2.0,     // ground decal lasts 2s
      flashAge: 0,
      flashMaxAge: 0.2,
      shockwaveScale: 1,
      gravity: -10,
      // Legacy compat fields
      points: null,
      velocities: null
    });
  }

  // ──────────────────────────────────────────────
  //  BLOOD / DEATH
  // ──────────────────────────────────────────────

  /**
   * Spawn blood splatter on hit.
   * Larger splatter decals, persist 5s instead of 3s.
   */
  spawnBlood(position, intensity = 1) {
    const particleCount = Math.floor(14 * intensity);
    const group = new THREE.Group();
    group.position.set(position.x, 0, position.z);
    this.scene.add(group);

    const bloodColors = [0x8b0000, 0x660000, 0xaa1111, 0x550000];
    const bloodParticles = [];
    for (let i = 0; i < particleCount; i++) {
      const pSize = 0.06 + Math.random() * 0.18;
      // Mix droplets (spheres) and streaks (elongated)
      const isStreak = i % 4 === 0;
      const pMat = new THREE.MeshBasicMaterial({
        color: bloodColors[Math.floor(Math.random() * bloodColors.length)],
        transparent: true,
        opacity: 0.85 + Math.random() * 0.15
      });
      const pMesh = new THREE.Mesh(_sphereGeo8, pMat);
      pMesh.position.set(
        (Math.random() - 0.5) * 0.3,
        (position.y || 1.5) + (Math.random() - 0.5) * 0.4,
        (Math.random() - 0.5) * 0.3
      );
      if (isStreak) pMesh.scale.set(pSize * 0.5, pSize * 0.5, pSize * 2.0);
      else pMesh.scale.setScalar(pSize);
      group.add(pMesh);

      const angle = Math.random() * Math.PI * 2;
      const speed = (2 + Math.random() * 5) * intensity;
      bloodParticles.push({
        mesh: pMesh,
        velocity: new THREE.Vector3(
          Math.cos(angle) * speed,
          (1 + Math.random() * 4) * intensity,
          Math.sin(angle) * speed
        ),
        rotSpeed: (Math.random() - 0.5) * 6,
        isStreak
      });
    }

    this.activeEffects.push({
      type: 'blood',
      bloodGroup: group,
      bloodParticles,
      age: 0,
      maxAge: 1.2,
      gravity: -14,
      points: null,
      velocities: null
    });

    // Add multiple blood decals for more splatter
    this.addBloodDecal(position);
    if (intensity > 0.7) this.addBloodDecal(position);
  }

  /**
   * Add blood stain on the arena floor. Larger size, 5s persist.
   */
  addBloodDecal(position) {
    const size = 0.6 + Math.random() * 1.8;
    // Irregular splatter shape using a deformed circle
    const segments = 12;
    const shape = new THREE.Shape();
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const r = size * (0.6 + Math.random() * 0.4);
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    const geo = new THREE.ShapeGeometry(shape);
    const bloodDecalColors = [0x4a0000, 0x3a0000, 0x550000, 0x420000];
    const mat = new THREE.MeshBasicMaterial({
      color: bloodDecalColors[Math.floor(Math.random() * bloodDecalColors.length)],
      transparent: true,
      opacity: 0.4 + Math.random() * 0.2,
      depthWrite: false
    });
    const decal = new THREE.Mesh(geo, mat);
    decal.rotation.x = -Math.PI / 2;
    decal.rotation.z = Math.random() * Math.PI * 2; // random rotation
    decal.position.set(
      position.x + (Math.random() - 0.5) * 2.5,
      0.26,
      position.z + (Math.random() - 0.5) * 2.5
    );
    this.scene.add(decal);
    this.bloodDecals.push({ mesh: decal, age: 0, persistTime: 5 });

    // Remove oldest decal if we have too many
    if (this.bloodDecals.length > this.maxBloodDecals) {
      const old = this.bloodDecals.shift();
      this.scene.remove(old.mesh);
      old.mesh.geometry.dispose();
      old.mesh.material.dispose();
    }
  }

  /**
   * Large particle explosion on unit death (15-20 particles, mixed sizes, dramatic spread).
   */
  spawnDeathBurst(position) {
    const burstCount = 15 + Math.floor(Math.random() * 6); // 15-20
    const group = new THREE.Group();
    group.position.set(position.x, 0, position.z);
    this.scene.add(group);

    const deathParticles = [];
    for (let i = 0; i < burstCount; i++) {
      const pSize = 0.1 + Math.random() * 0.4;
      const shade = Math.random() > 0.5 ? 0x880000 : 0x444444;
      const pMat = new THREE.MeshBasicMaterial({
        color: shade,
        transparent: true,
        opacity: 0.95
      });
      const pMesh = new THREE.Mesh(_sphereGeo6, pMat);
      pMesh.scale.setScalar(pSize);
      pMesh.position.set(0, (position.y || 1.0), 0);
      group.add(pMesh);

      deathParticles.push({
        mesh: pMesh,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 10,
          Math.random() * 8 + 2,
          (Math.random() - 0.5) * 10
        )
      });
    }

    this.activeEffects.push({
      type: 'death_burst',
      deathGroup: group,
      deathParticles,
      age: 0,
      maxAge: 2.0,
      gravity: -12
    });
  }

  // ──────────────────────────────────────────────
  //  BEAM
  // ──────────────────────────────────────────────

  /**
   * Spawn a WoW-style drain beam tethered between two live position references.
   * Uses a particle-chain approach: each tendril is a Points cloud whose positions
   * are recomputed every frame based on current source/target positions.
   * Energy visibly flows from target → caster along sinusoidal tendrils.
   */
  spawnBeam(from, to, config) {
    const { color = 0x9900ff, duration = 1.0, school = 'shadow', sourceId = null } = config;

    const baseColor = new THREE.Color(color);
    const brightColor = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.45);
    const warmColor = new THREE.Color(color).lerp(new THREE.Color(0xff6644), 0.25);

    // ── Procedural soft-glow sprite texture ──
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = 64; glowCanvas.height = 64;
    const gCtx = glowCanvas.getContext('2d');
    const grad = gCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1.0)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0.6)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.15)');
    grad.addColorStop(1, 'rgba(255,255,255,0.0)');
    gCtx.fillStyle = grad;
    gCtx.fillRect(0, 0, 64, 64);
    const glowTex = new THREE.CanvasTexture(glowCanvas);

    // ── 1. Three sinusoidal tendril chains (Points-based, updated each frame) ──
    const TENDRIL_COUNT = 3;
    const POINTS_PER_TENDRIL = 40;
    const tendrils = [];
    for (let t = 0; t < TENDRIL_COUNT; t++) {
      const positions = new Float32Array(POINTS_PER_TENDRIL * 3);
      const sizes = new Float32Array(POINTS_PER_TENDRIL);
      for (let i = 0; i < POINTS_PER_TENDRIL; i++) {
        const frac = i / (POINTS_PER_TENDRIL - 1);
        sizes[i] = (0.8 + Math.sin(frac * Math.PI) * 1.8) * (t === 0 ? 1.2 : 0.9);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
      const mat = new THREE.PointsMaterial({
        color: t === 0 ? brightColor : baseColor,
        map: glowTex,
        size: t === 0 ? 1.2 : 0.9,
        transparent: true,
        opacity: t === 0 ? 0.9 : 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true
      });
      const points = new THREE.Points(geo, mat);
      this.scene.add(points);
      tendrils.push({
        points, geo, mat,
        phaseOff: (t / TENDRIL_COUNT) * Math.PI * 2,
        waveAmp: 0.6 + t * 0.25,
        waveFreq: 2.0 + t * 0.6,
        count: POINTS_PER_TENDRIL
      });
    }

    // ── 2. Soul orbs flowing target → caster (individual meshes) ──
    const orbs = [];
    for (let i = 0; i < 6; i++) {
      const orbGeo = new THREE.SphereGeometry(0.15 + Math.random() * 0.1, 8, 8);
      const orbMat = new THREE.MeshBasicMaterial({
        color: brightColor,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      const orb = new THREE.Mesh(orbGeo, orbMat);
      this.scene.add(orb);
      orbs.push({
        mesh: orb, mat: orbMat,
        t: i / 6,                           // parametric position along beam [0=target, 1=caster]
        speed: 0.3 + Math.random() * 0.25,  // how fast it travels per second
        orbitPhase: Math.random() * Math.PI * 2,
        orbitSpeed: 2.5 + Math.random() * 2,
        orbitRadius: 0.25 + Math.random() * 0.2
      });
    }

    // ── 3. Siphon wisps (small fast particles along the beam) ──
    const WISP_COUNT = 60;
    const wispPositions = new Float32Array(WISP_COUNT * 3);
    const wispGeo = new THREE.BufferGeometry();
    wispGeo.setAttribute('position', new THREE.BufferAttribute(wispPositions, 3));
    const wispMat = new THREE.PointsMaterial({
      color: warmColor,
      map: glowTex,
      size: 0.5,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    });
    const wisps = new THREE.Points(wispGeo, wispMat);
    this.scene.add(wisps);
    const wispData = [];
    for (let i = 0; i < WISP_COUNT; i++) {
      wispData.push({
        t: Math.random(),
        speed: 0.8 + Math.random() * 0.6,
        drift: Math.random() * Math.PI * 2,
        driftRadius: 0.15 + Math.random() * 0.3
      });
    }

    this.activeEffects.push({
      type: 'beam',
      sourceId,
      tendrils,
      orbs,
      wisps, wispGeo, wispMat, wispData,
      glowTex,
      from,       // live position reference (source unit)
      to,         // live position reference (target unit)
      age: 0,
      maxAge: duration
    });
  }

  /**
   * Force-remove all beam effects originating from a given sourceId (channel ended).
   */
  removeBeamsFromSource(sourceId) {
    for (let i = this.activeEffects.length - 1; i >= 0; i--) {
      const effect = this.activeEffects[i];
      if (effect.type === 'beam' && effect.sourceId === sourceId) {
        this.removeEffect(effect);
        this.activeEffects.splice(i, 1);
      }
    }
  }

  // ──────────────────────────────────────────────
  //  AURA (enhanced)
  // ──────────────────────────────────────────────

  /**
   * Spawn a buff/aura visual around a character.
   * Pulsing ring at unit feet + 5-6 particles rising from ground.
   */
  spawnAuraEffect(position, config) {
    const { color = 0xffd700, radius = 3.0, duration = 2.0 } = config;

    const group = new THREE.Group();
    group.position.set(position.x, 0, position.z);
    this.scene.add(group);

    // Pulsing ring at feet
    const ringGeo = new THREE.RingGeometry(radius - 0.1, radius, 12);
    const ringMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.3;
    group.add(ring);

    // Rising particles (5-6 small spheres that float upward)
    const risingCount = 5 + Math.floor(Math.random() * 2);
    const risingParticles = [];
    for (let i = 0; i < risingCount; i++) {
      const pSize = 0.08 + Math.random() * 0.07;
      const pMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.7
      });
      const pMesh = new THREE.Mesh(_sphereGeo6, pMat);
      pMesh.scale.setScalar(pSize);
      const angle = (i / risingCount) * Math.PI * 2;
      const dist = radius * 0.4 + Math.random() * radius * 0.5;
      pMesh.position.set(Math.cos(angle) * dist, 0.3, Math.sin(angle) * dist);
      group.add(pMesh);
      risingParticles.push({
        mesh: pMesh,
        baseAngle: angle,
        baseDist: dist,
        riseSpeed: 0.8 + Math.random() * 0.6,
        startY: 0.3,
        maxRise: 2.5 + Math.random()
      });
    }

    this.activeEffects.push({
      type: 'aura_ring',
      auraGroup: group,
      ring,
      risingParticles,
      age: 0,
      maxAge: duration,
      pulsePhase: 0
    });
  }

  // ──────────────────────────────────────────────
  //  STUN STARS (unchanged)
  // ──────────────────────────────────────────────

  /**
   * Spawn stun stars above a unit
   */
  spawnStunStars(position) {
    const group = new THREE.Group();
    const starMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });

    for (let i = 0; i < 3; i++) {
      const star = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.2),
        starMat
      );
      const angle = (i / 3) * Math.PI * 2;
      star.position.set(Math.cos(angle) * 0.8, 3.5, Math.sin(angle) * 0.8);
      group.add(star);
    }

    group.position.set(position.x, 0, position.z);
    this.scene.add(group);

    return {
      type: 'stun_stars',
      group,
      update: (time) => {
        group.children.forEach((star, i) => {
          const angle = time * 3 + (i / 3) * Math.PI * 2;
          star.position.x = Math.cos(angle) * 0.8;
          star.position.z = Math.sin(angle) * 0.8;
        });
      },
      remove: () => {
        this.scene.remove(group);
        group.children.forEach(c => {
          c.geometry.dispose();
          c.material.dispose();
        });
      }
    };
  }

  // ──────────────────────────────────────────────
  //  FEAR EFFECT
  // ──────────────────────────────────────────────

  /**
   * Dark tendrils (small curved TubeGeometry) waving from feet.
   * Returns a handle with update() and remove() for external management.
   */
  spawnFearEffect(position) {
    const group = new THREE.Group();
    group.position.set(position.x, 0, position.z);
    this.scene.add(group);

    const tendrilCount = 4;
    const tendrils = [];
    for (let i = 0; i < tendrilCount; i++) {
      const angle = (i / tendrilCount) * Math.PI * 2;
      const cp = [
        new THREE.Vector3(Math.cos(angle) * 0.3, 0.1, Math.sin(angle) * 0.3),
        new THREE.Vector3(Math.cos(angle) * 0.6, 0.6, Math.sin(angle) * 0.6),
        new THREE.Vector3(Math.cos(angle) * 0.4, 1.2, Math.sin(angle) * 0.4),
        new THREE.Vector3(Math.cos(angle) * 0.7, 1.8, Math.sin(angle) * 0.7)
      ];
      const curve = new THREE.CatmullRomCurve3(cp);
      const tubeGeo = new THREE.TubeGeometry(curve, 8, 0.04, 4, false);
      const tubeMat = new THREE.MeshBasicMaterial({
        color: 0x330066,
        transparent: true,
        opacity: 0.7
      });
      const tube = new THREE.Mesh(tubeGeo, tubeMat);
      group.add(tube);
      tendrils.push({ mesh: tube, baseAngle: angle, controlPoints: cp, curve });
    }

    return {
      type: 'fear',
      group,
      tendrils,
      update: (time) => {
        // Wave tendrils by regenerating geometry
        for (const tendril of tendrils) {
          const a = tendril.baseAngle;
          const wave = Math.sin(time * 3 + a) * 0.3;
          const wave2 = Math.cos(time * 2.5 + a) * 0.2;

          tendril.controlPoints[1].x = Math.cos(a) * 0.6 + wave;
          tendril.controlPoints[1].z = Math.sin(a) * 0.6 + wave2;
          tendril.controlPoints[2].x = Math.cos(a) * 0.4 - wave;
          tendril.controlPoints[2].z = Math.sin(a) * 0.4 - wave2;
          tendril.controlPoints[3].x = Math.cos(a) * 0.7 + wave * 0.5;
          tendril.controlPoints[3].z = Math.sin(a) * 0.7 + wave2 * 0.5;

          const newCurve = new THREE.CatmullRomCurve3(tendril.controlPoints);
          const newGeo = new THREE.TubeGeometry(newCurve, 8, 0.04, 4, false);
          tendril.mesh.geometry.dispose();
          tendril.mesh.geometry = newGeo;
        }
      },
      remove: () => {
        this.scene.remove(group);
        group.traverse(child => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
        });
      }
    };
  }

  // ──────────────────────────────────────────────
  //  ROOT EFFECT
  // ──────────────────────────────────────────────

  /**
   * Green vine-like tubes from ground upward.
   * Returns a handle with update() and remove() for external management.
   */
  spawnRootEffect(position) {
    const group = new THREE.Group();
    group.position.set(position.x, 0, position.z);
    this.scene.add(group);

    const vineCount = 4;
    const vines = [];
    for (let i = 0; i < vineCount; i++) {
      const angle = (i / vineCount) * Math.PI * 2 + Math.random() * 0.4;
      const height = 1.2 + Math.random() * 1.0;
      const cp = [
        new THREE.Vector3(Math.cos(angle) * 0.5, 0.0, Math.sin(angle) * 0.5),
        new THREE.Vector3(Math.cos(angle) * 0.35, height * 0.33, Math.sin(angle) * 0.35),
        new THREE.Vector3(Math.cos(angle) * 0.2, height * 0.66, Math.sin(angle) * 0.2),
        new THREE.Vector3(Math.cos(angle) * 0.1, height, Math.sin(angle) * 0.1)
      ];
      const curve = new THREE.CatmullRomCurve3(cp);
      const tubeGeo = new THREE.TubeGeometry(curve, 8, 0.05, 4, false);
      const tubeMat = new THREE.MeshBasicMaterial({
        color: 0x22aa22,
        transparent: true,
        opacity: 0.8
      });
      const vine = new THREE.Mesh(tubeGeo, tubeMat);
      group.add(vine);
      vines.push({ mesh: vine, baseAngle: angle, controlPoints: cp, height });
    }

    return {
      type: 'root',
      group,
      vines,
      update: (time) => {
        // Slight sway
        for (const vine of vines) {
          const sway = Math.sin(time * 1.5 + vine.baseAngle * 2) * 0.08;
          vine.controlPoints[2].x = Math.cos(vine.baseAngle) * 0.2 + sway;
          vine.controlPoints[2].z = Math.sin(vine.baseAngle) * 0.2 + sway;
          vine.controlPoints[3].x = Math.cos(vine.baseAngle) * 0.1 - sway;
          vine.controlPoints[3].z = Math.sin(vine.baseAngle) * 0.1 - sway;

          const newCurve = new THREE.CatmullRomCurve3(vine.controlPoints);
          const newGeo = new THREE.TubeGeometry(newCurve, 8, 0.05, 4, false);
          vine.mesh.geometry.dispose();
          vine.mesh.geometry = newGeo;
        }
      },
      remove: () => {
        this.scene.remove(group);
        group.traverse(child => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
        });
      }
    };
  }

  // ──────────────────────────────────────────────
  //  UTILITY
  // ──────────────────────────────────────────────

  /**
   * Get spell effect color based on school
   */
  getSchoolColor(school) {
    const colors = {
      physical: 0xaaaaaa,
      fire: 0xff4400,
      frost: 0x4488ff,
      arcane: 0xaa44ff,
      shadow: 0x6600aa,
      holy: 0xffd700
    };
    return colors[school] || 0xffffff;
  }

  // ──────────────────────────────────────────────
  //  UPDATE LOOP
  // ──────────────────────────────────────────────

  /**
   * Update all active effects.
   * Handles projectile spinning rings, trail spheres, shockwave expansion,
   * ground decal fade, stealth shimmer, death bursts, and cleanup.
   */
  update(deltaTime) {
    this._elapsedTime += deltaTime;

    // Enforce effect cap — remove oldest effects when exceeding limit
    while (this.activeEffects.length > this.maxActiveEffects) {
      const oldest = this.activeEffects.shift();
      this.removeEffect(oldest);
    }

    for (let i = this.activeEffects.length - 1; i >= 0; i--) {
      const effect = this.activeEffects[i];

      switch (effect.type) {
        case 'projectile':
          this.updateProjectile(effect, deltaTime);
          break;
        case 'impact':
          this.updateImpact(effect, deltaTime);
          break;
        case 'blood':
          this.updateBlood(effect, deltaTime);
          break;
        case 'death_burst':
          this.updateDeathBurst(effect, deltaTime);
          break;
        case 'beam':
          this.updateBeam(effect, deltaTime);
          break;
        case 'aura_ring':
          this.updateAuraRing(effect, deltaTime);
          break;
        case 'stealth_shimmer':
          this.updateStealthShimmer(effect, deltaTime);
          break;
        case 'ground_slam':
          this.updateGroundSlam(effect, deltaTime);
          break;
        case 'shield_bubble':
          this.updateShieldBubble(effect, deltaTime);
          break;
        case 'heal_burst':
          this.updateHealBurst(effect, deltaTime);
          break;
        case 'weapon_swing':
          this.updateWeaponSwing(effect, deltaTime);
          break;
        case 'holy_pillar':
          this.updateHolyPillar(effect, deltaTime);
          break;
        case 'fire_column':
          this.updateFireColumn(effect, deltaTime);
          break;
        case 'lightning_strike':
          this.updateLightningStrike(effect, deltaTime);
          break;
        case 'vortex':
          this.updateVortex(effect, deltaTime);
          break;
        case 'rune_circle':
          this.updateRuneCircle(effect, deltaTime);
          break;
        case 'ice_shards':
          this.updateIceShards(effect, deltaTime);
          break;
        case 'shadow_nova':
          this.updateShadowNova(effect, deltaTime);
          break;
        case 'dagger_flurry':
          this.updateDaggerFlurry(effect, deltaTime);
          break;
        case 'charge_trail':
          this.updateChargeTrail(effect, deltaTime);
          break;
        case 'teleport_flash':
          this.updateTeleportFlash(effect, deltaTime);
          break;
        case 'ground_zone':
          this.updateGroundZone(effect, deltaTime);
          break;
      }

      // Remove completed effects
      if (effect._remove) {
        this.removeEffect(effect);
        this.activeEffects.splice(i, 1);
      }
    }

    // Fade blood decals (persist 5s, then start fading)
    for (let i = this.bloodDecals.length - 1; i >= 0; i--) {
      const decal = this.bloodDecals[i];
      decal.age += deltaTime;
      const persistTime = decal.persistTime || 5;
      if (decal.age > persistTime) {
        decal.mesh.material.opacity *= 0.97;
        if (decal.mesh.material.opacity < 0.05) {
          this.scene.remove(decal.mesh);
          decal.mesh.geometry.dispose();
          decal.mesh.material.dispose();
          this.bloodDecals.splice(i, 1);
        }
      }
    }
  }

  // --- Projectile update (spinning ring + trail spheres + school animation) ---
  updateProjectile(effect, dt) {
    const move = effect.direction.clone().multiplyScalar(effect.speed * dt);
    effect.group.position.add(move);
    effect.traveled += effect.speed * dt;

    // Record position history for trail
    effect.positionHistory.unshift(effect.group.position.clone());
    if (effect.positionHistory.length > 20) effect.positionHistory.pop();

    // Animate spinning ring
    if (effect.spinningRing) {
      effect.spinAngle += dt * 8;
      // Rotate the ring around the travel axis
      const axis = new THREE.Vector3(0, 0, 1);
      const travelQuat = new THREE.Quaternion().setFromUnitVectors(axis, effect.direction);
      const spinQuat = new THREE.Quaternion().setFromAxisAngle(effect.direction, effect.spinAngle);
      effect.spinningRing.quaternion.copy(spinQuat.multiply(travelQuat));
    }

    // Animate trail spheres following the projectile path
    if (effect.trailSpheres) {
      for (let t = 0; t < effect.trailSpheres.length; t++) {
        const ts = effect.trailSpheres[t];
        // Position each trail sphere at a past position
        const historyIndex = Math.min((t + 1) * 3, effect.positionHistory.length - 1);
        if (historyIndex >= 0 && effect.positionHistory[historyIndex]) {
          // Convert world position to local group space
          const worldPos = effect.positionHistory[historyIndex];
          const localPos = worldPos.clone().sub(effect.group.position);
          ts.mesh.position.copy(localPos);
          ts.mesh.visible = true;
        }
      }
    }

    // School-specific animation
    this._animateSchoolProjectile(effect, dt);

    if (effect.traveled >= effect.totalDist) {
      if (effect.onComplete) effect.onComplete();
      effect._remove = true;
    }
  }

  /**
   * Per-frame school-specific projectile animation.
   */
  _animateSchoolProjectile(effect, dt) {
    const time = this._elapsedTime;

    switch (effect.school) {
      case 'fire': {
        // Flickering emissive shift: orange -> yellow using sin(time)
        const sv = effect.schoolVisuals;
        if (sv && sv.core && sv.core.userData._fireMat) {
          const t = (Math.sin(time * 12) + 1) * 0.5; // 0..1
          const r = 1.0;
          const g = 0.27 + t * 0.47; // 0.27 (orange) .. 0.74 (yellow)
          const b = t * 0.1;
          sv.core.userData._fireMat.color.setRGB(r, g, b);
        }
        if (sv && sv.glow && sv.glow.userData._fireMat) {
          const t = (Math.sin(time * 12 + 1) + 1) * 0.5;
          sv.glow.userData._fireMat.color.setRGB(1.0, 0.4 + t * 0.4, t * 0.1);
        }
        break;
      }

      case 'shadow': {
        // Pulse the outer glow opacity
        const sv = effect.schoolVisuals;
        if (sv && sv.outerGlow) {
          sv.outerGlow.material.opacity = 0.2 + Math.sin(time * 5) * 0.1;
        }
        break;
      }

      case 'holy': {
        // Pulse glow brightness
        const sv = effect.schoolVisuals;
        if (sv && sv.glow) {
          sv.glow.material.opacity = 0.25 + Math.sin(time * 6) * 0.1;
        }
        break;
      }

      case 'physical': {
        // Slight shimmer on the metallic core
        const sv = effect.schoolVisuals;
        if (sv && sv.core) {
          const brightness = 0.75 + Math.sin(time * 10) * 0.1;
          sv.core.material.color.setRGB(brightness, brightness, brightness);
        }
        break;
      }
    }

    // Animate spell texture UV for swirling effect
    if (effect.schoolVisuals && effect.schoolVisuals.core && effect.schoolVisuals.core.material.map) {
      effect.schoolVisuals.core.material.map.offset.x += dt * 0.3;
      effect.schoolVisuals.core.material.map.offset.y += dt * 0.2;
    }
    if (effect.schoolVisuals && effect.schoolVisuals.glow && effect.schoolVisuals.glow.material.map) {
      effect.schoolVisuals.glow.material.map.offset.x += dt * 0.2;
      effect.schoolVisuals.glow.material.map.offset.y += dt * 0.15;
    }
    if (effect.schoolVisuals && effect.schoolVisuals.outerGlow && effect.schoolVisuals.outerGlow.material.map) {
      effect.schoolVisuals.outerGlow.material.map.offset.x += dt * 0.15;
      effect.schoolVisuals.outerGlow.material.map.offset.y += dt * 0.25;
    }
  }

  // --- Impact update (particles, shockwave, ground decal, flash) ---
  updateImpact(effect, dt) {
    effect.age += dt;

    // Animate mesh particles
    if (effect.impactParticles) {
      for (const p of effect.impactParticles) {
        p.velocity.y += effect.gravity * dt;
        p.mesh.position.x += p.velocity.x * dt;
        p.mesh.position.y += p.velocity.y * dt;
        p.mesh.position.z += p.velocity.z * dt;

        // Spin particles for visual interest
        if (p.rotSpeed) p.mesh.rotation.y += p.rotSpeed * dt;

        // Shrink particles as they age
        const life = Math.max(0, 1.0 - effect.age / 1.0);
        const scale = 0.3 + life * 0.7;
        p.mesh.scale.multiplyScalar(1.0 - dt * 0.5); // gradual shrink

        // Floor collision
        if (p.mesh.position.y < 0.26) {
          p.mesh.position.y = 0.26;
          p.velocity.y *= -0.3;
          p.velocity.x *= 0.5;
          p.velocity.z *= 0.5;
        }

        // Fade particles
        p.mesh.material.opacity = life * 0.9;
      }
    }

    // Animate shockwave ring expansion
    if (effect.shockwave) {
      effect.shockwaveScale += dt * 8;
      effect.shockwave.scale.set(effect.shockwaveScale, effect.shockwaveScale, 1);
      const shockLife = Math.max(0, 1.0 - effect.age / 0.6);
      effect.shockwave.material.opacity = shockLife * 0.7;
    }

    // Ground flash: bright for 0.2s then fade quickly
    if (effect.groundFlash) {
      effect.flashAge += dt;
      if (effect.flashAge < effect.flashMaxAge) {
        effect.groundFlash.material.opacity = 0.8;
      } else {
        const fadeProgress = (effect.flashAge - effect.flashMaxAge) / 0.15;
        effect.groundFlash.material.opacity = Math.max(0, 0.8 * (1 - fadeProgress));
      }
    }

    // Ground decal fade over 2s
    if (effect.groundDecal) {
      const decalFade = Math.max(0, 1.0 - effect.age / 2.0);
      effect.groundDecal.material.opacity = 0.5 * decalFade;
    }

    // Weapon trail fade
    if (effect.weaponTrailMesh) {
      const trailFade = Math.max(0, 1.0 - effect.age / 0.5);
      effect.weaponTrailMesh.material.opacity = 0.7 * trailFade;
    }

    if (effect.age >= effect.maxAge) {
      effect._remove = true;
    }
  }

  // --- Blood update (mesh-based particles with rotation + streaks) ---
  updateBlood(effect, dt) {
    effect.age += dt;

    if (effect.bloodParticles) {
      for (const p of effect.bloodParticles) {
        p.velocity.y += effect.gravity * dt;
        p.mesh.position.x += p.velocity.x * dt;
        p.mesh.position.y += p.velocity.y * dt;
        p.mesh.position.z += p.velocity.z * dt;

        // Spin particles
        if (p.rotSpeed) {
          p.mesh.rotation.x += p.rotSpeed * dt;
          p.mesh.rotation.z += p.rotSpeed * dt * 0.5;
        }

        // Orient streak particles along velocity
        if (p.isStreak && (Math.abs(p.velocity.x) > 0.1 || Math.abs(p.velocity.z) > 0.1)) {
          p.mesh.lookAt(
            p.mesh.position.x + p.velocity.x,
            p.mesh.position.y + p.velocity.y,
            p.mesh.position.z + p.velocity.z
          );
        }

        if (p.mesh.position.y < 0.26) {
          p.mesh.position.y = 0.26;
          p.velocity.y *= -0.2;
          p.velocity.x *= 0.4;
          p.velocity.z *= 0.4;
          // Flatten on ground impact
          p.mesh.scale.y *= 0.5;
        }

        const life = Math.max(0, 1.0 - effect.age / effect.maxAge);
        p.mesh.material.opacity = life * 0.9;
        // Shrink slightly over time
        const shrink = 1.0 - dt * 0.3;
        p.mesh.scale.multiplyScalar(Math.max(shrink, 0.9));
      }
    }

    // Legacy PointsMaterial path (if old callers pass points/velocities directly)
    if (effect.points && effect.velocities) {
      this.updateParticlesLegacy(effect, dt);
    }

    if (effect.age >= effect.maxAge) {
      effect._remove = true;
    }
  }

  // --- Death burst update ---
  updateDeathBurst(effect, dt) {
    effect.age += dt;

    for (const p of effect.deathParticles) {
      p.velocity.y += effect.gravity * dt;
      p.mesh.position.x += p.velocity.x * dt;
      p.mesh.position.y += p.velocity.y * dt;
      p.mesh.position.z += p.velocity.z * dt;

      if (p.mesh.position.y < 0.26) {
        p.mesh.position.y = 0.26;
        p.velocity.y *= -0.2;
        p.velocity.x *= 0.4;
        p.velocity.z *= 0.4;
      }

      const life = Math.max(0, 1.0 - effect.age / effect.maxAge);
      p.mesh.material.opacity = life * 0.95;
    }

    if (effect.age >= effect.maxAge) {
      effect._remove = true;
    }
  }

  // --- Legacy particle update (for backward compat if anything still uses PointsMaterial) ---
  updateParticlesLegacy(effect, dt) {
    const positions = effect.points.geometry.attributes.position.array;

    for (let i = 0; i < effect.velocities.length; i++) {
      effect.velocities[i].y += effect.gravity * dt;
      positions[i * 3] += effect.velocities[i].x * dt;
      positions[i * 3 + 1] += effect.velocities[i].y * dt;
      positions[i * 3 + 2] += effect.velocities[i].z * dt;

      if (positions[i * 3 + 1] < 0.26) {
        positions[i * 3 + 1] = 0.26;
        effect.velocities[i].y *= -0.3;
        effect.velocities[i].x *= 0.5;
        effect.velocities[i].z *= 0.5;
      }
    }

    effect.points.geometry.attributes.position.needsUpdate = true;
    effect.points.material.opacity = 1.0 - (effect.age / effect.maxAge);
  }

  updateBeam(effect, dt) {
    effect.age += dt;
    const time = effect.age;
    const fade = Math.min(1, 1 - (time - effect.maxAge + 0.4) / 0.4);
    const fadeIn = Math.min(1, time / 0.3);
    const alpha = fadeIn * Math.max(0, fade);
    const pulse = 0.75 + Math.sin(time * 6) * 0.25;

    // ── Compute live beam axis from source to target ──
    const srcY = (effect.from.y || 0) + 3.5;
    const tgtY = (effect.to.y || 0) + 3.5;
    const src = new THREE.Vector3(effect.from.x, srcY, effect.from.z);
    const tgt = new THREE.Vector3(effect.to.x, tgtY, effect.to.z);
    const dir = new THREE.Vector3().subVectors(tgt, src);
    const dist = dir.length();
    if (dist < 0.01) { effect._remove = true; return; }
    dir.normalize();

    // Perpendicular axes for wave displacement
    const up = new THREE.Vector3(0, 1, 0);
    const perp1 = new THREE.Vector3().crossVectors(dir, up).normalize();
    if (perp1.length() < 0.5) perp1.set(1, 0, 0); // fallback if dir ≈ up
    perp1.normalize();
    const perp2 = new THREE.Vector3().crossVectors(dir, perp1).normalize();

    // ── 1. Update tendril chain positions (sinusoidal wave along beam) ──
    if (effect.tendrils) {
      for (const tendril of effect.tendrils) {
        const posAttr = tendril.geo.getAttribute('position');
        for (let i = 0; i < tendril.count; i++) {
          const frac = i / (tendril.count - 1);
          // Base position: lerp from target to source (energy flows target→caster)
          const base = new THREE.Vector3().lerpVectors(tgt, src, frac);
          // Sinusoidal wave perpendicular to beam, tapered at endpoints
          const taper = Math.sin(frac * Math.PI);
          const angle = frac * Math.PI * tendril.waveFreq * 2 + tendril.phaseOff + time * 3.0;
          const waveX = Math.cos(angle) * tendril.waveAmp * taper;
          const waveZ = Math.sin(angle) * tendril.waveAmp * taper;
          base.addScaledVector(perp1, waveX);
          base.addScaledVector(perp2, waveZ);
          posAttr.setXYZ(i, base.x, base.y, base.z);
        }
        posAttr.needsUpdate = true;
        tendril.mat.opacity = (tendril === effect.tendrils[0] ? 0.85 : 0.5) * pulse * alpha;
      }
    }

    // ── 2. Soul orbs: flow from target to caster along the beam ──
    if (effect.orbs) {
      for (const orb of effect.orbs) {
        orb.t += orb.speed * dt;
        if (orb.t >= 1.0) orb.t -= 1.0; // loop back to target
        // Position along beam
        const pos = new THREE.Vector3().lerpVectors(tgt, src, orb.t);
        // Spiral orbit around beam axis
        orb.orbitPhase += orb.orbitSpeed * dt;
        const taper = Math.sin(orb.t * Math.PI);
        pos.addScaledVector(perp1, Math.cos(orb.orbitPhase) * orb.orbitRadius * taper);
        pos.addScaledVector(perp2, Math.sin(orb.orbitPhase) * orb.orbitRadius * taper);
        orb.mesh.position.copy(pos);
        const scale = 0.7 + Math.sin(time * 8 + orb.orbitPhase) * 0.4;
        orb.mesh.scale.setScalar(scale);
        orb.mat.opacity = (0.7 + Math.sin(time * 6 + orb.orbitPhase) * 0.3) * alpha;
      }
    }

    // ── 3. Siphon wisps: fast flowing particles along beam ──
    if (effect.wispData && effect.wispGeo) {
      const posAttr = effect.wispGeo.getAttribute('position');
      for (let i = 0; i < effect.wispData.length; i++) {
        const w = effect.wispData[i];
        w.t += w.speed * dt;
        if (w.t >= 1.0) w.t -= 1.0;
        const pos = new THREE.Vector3().lerpVectors(tgt, src, w.t);
        w.drift += dt * 4;
        const taper = Math.sin(w.t * Math.PI);
        pos.addScaledVector(perp1, Math.cos(w.drift) * w.driftRadius * taper);
        pos.addScaledVector(perp2, Math.sin(w.drift) * w.driftRadius * taper);
        posAttr.setXYZ(i, pos.x, pos.y, pos.z);
      }
      posAttr.needsUpdate = true;
      effect.wispMat.opacity = 0.6 * pulse * alpha;
    }

    if (time >= effect.maxAge) {
      effect._remove = true;
    }
  }

  // --- Aura ring update (pulsing + rising particles) ---
  updateAuraRing(effect, dt) {
    effect.age += dt;
    effect.pulsePhase += dt;

    // Pulse the ring scale
    const pulseScale = 1.0 + Math.sin(effect.pulsePhase * 4) * 0.15;
    if (effect.ring) {
      effect.ring.scale.set(pulseScale, pulseScale, 1);
      effect.ring.material.opacity = (0.6 + Math.sin(effect.pulsePhase * 4) * 0.2) *
        (1 - effect.age / effect.maxAge);
    }

    // Animate rising particles
    if (effect.risingParticles) {
      for (const rp of effect.risingParticles) {
        rp.mesh.position.y += rp.riseSpeed * dt;
        // Loop particle back to ground when it reaches max height
        if (rp.mesh.position.y > rp.startY + rp.maxRise) {
          rp.mesh.position.y = rp.startY;
        }
        // Fade based on height
        const heightFraction = (rp.mesh.position.y - rp.startY) / rp.maxRise;
        rp.mesh.material.opacity = Math.max(0, 0.7 * (1 - heightFraction) *
          (1 - effect.age / effect.maxAge));
      }
    }

    if (effect.age >= effect.maxAge) {
      effect._remove = true;
    }
  }

  // --- Stealth shimmer update ---
  updateStealthShimmer(effect, dt) {
    effect.age += dt;
    if (effect.targetModel) {
      // Oscillate model opacity for stealth shimmer
      const shimmer = 0.15 + Math.sin(this._elapsedTime * 5) * 0.1;
      effect.targetModel.traverse(child => {
        if (child.material && child.material.transparent !== undefined) {
          child.material.transparent = true;
          child.material.opacity = shimmer;
        }
      });
    }

    if (effect.age >= effect.maxAge) {
      // Restore full opacity
      if (effect.targetModel) {
        effect.targetModel.traverse(child => {
          if (child.material) {
            child.material.opacity = 1.0;
            child.material.transparent = false;
          }
        });
      }
      effect._remove = true;
    }
  }

  // ──────────────────────────────────────────────
  //  STEALTH SHIMMER (spawn helper)
  // ──────────────────────────────────────────────

  /**
   * Begin stealth shimmer on a model. The update loop handles the opacity oscillation.
   * @param {THREE.Object3D} model - The character model to shimmer
   * @param {number} duration - How long the shimmer lasts
   */
  spawnStealthShimmer(model, duration = 5.0) {
    this.activeEffects.push({
      type: 'stealth_shimmer',
      targetModel: model,
      age: 0,
      maxAge: duration
    });
  }

  // ──────────────────────────────────────────────
  //  GROUND SLAM (AoE leaps, stomps, explosions)
  // ──────────────────────────────────────────────

  spawnGroundSlam(position, config) {
    const { color = 0xff4400, size = 5, school = 'physical', debrisCount = 8, tex = null } = config;
    const schoolTex = tex || VFX_TEXTURES[school] || VFX_TEXTURES.groundCrack || null;
    const group = new THREE.Group();
    group.position.set(position.x, 0, position.z);
    this.scene.add(group);

    // Expanding shockwave ring (textured + additive)
    const shockGeo = new THREE.RingGeometry(0.2, 0.6, 32);
    const shockMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.8, side: THREE.DoubleSide,
      map: schoolTex, blending: THREE.AdditiveBlending, depthWrite: false
    });
    const shockwave = new THREE.Mesh(shockGeo, shockMat);
    shockwave.rotation.x = -Math.PI / 2;
    shockwave.position.y = 0.3;
    group.add(shockwave);

    // Ground crack decal
    const crackGeo = new THREE.CircleGeometry(size * 0.4, 16);
    const crackMat = new THREE.MeshBasicMaterial({
      color: 0x222222, transparent: true, opacity: 0.5, depthWrite: false,
      map: tex || VFX_TEXTURES.groundCrack || SPELL_TEXTURES[school] || null
    });
    const crack = new THREE.Mesh(crackGeo, crackMat);
    crack.rotation.x = -Math.PI / 2;
    crack.position.y = 0.26;
    group.add(crack);

    // Debris chunks flying upward (textured)
    const debris = [];
    for (let i = 0; i < debrisCount; i++) {
      const chunkSize = 0.1 + Math.random() * 0.25;
      const chunkColor = school === 'frost' ? 0x88ccff : school === 'holy' ? 0xffd700
        : school === 'fire' ? 0xff6633 : school === 'shadow' ? 0x6622aa : 0x665544;
      const mat = new THREE.MeshBasicMaterial({
        color: chunkColor, transparent: true, opacity: 0.9,
        map: schoolTex, blending: THREE.AdditiveBlending, depthWrite: false
      });
      const chunk = new THREE.Mesh(_sphereGeo6, mat);
      chunk.scale.setScalar(chunkSize);
      chunk.position.set(0, 0.3, 0);
      chunk.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      group.add(chunk);
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 5;
      debris.push({
        mesh: chunk,
        velocity: new THREE.Vector3(Math.cos(angle) * speed, 3 + Math.random() * 5, Math.sin(angle) * speed),
        rotSpeed: (Math.random() - 0.5) * 10
      });
    }

    this.activeEffects.push({
      type: 'ground_slam', group, shockwave, crack, debris,
      shockScale: 1, age: 0, maxAge: 2.0, size, gravity: -14
    });
  }

  updateGroundSlam(effect, dt) {
    effect.age += dt;
    const life = Math.max(0, 1 - effect.age / effect.maxAge);

    // Expand shockwave
    effect.shockScale += dt * 10;
    if (effect.shockwave) {
      effect.shockwave.scale.set(effect.shockScale, effect.shockScale, 1);
      effect.shockwave.material.opacity = life * 0.8;
    }

    // Fade crack
    if (effect.crack) effect.crack.material.opacity = life * 0.5;

    // Animate debris
    for (const d of effect.debris) {
      d.velocity.y += effect.gravity * dt;
      d.mesh.position.x += d.velocity.x * dt;
      d.mesh.position.y += d.velocity.y * dt;
      d.mesh.position.z += d.velocity.z * dt;
      d.mesh.rotation.x += d.rotSpeed * dt;
      d.mesh.rotation.z += d.rotSpeed * dt * 0.7;
      if (d.mesh.position.y < 0.26) {
        d.mesh.position.y = 0.26;
        d.velocity.y *= -0.2;
        d.velocity.x *= 0.4;
        d.velocity.z *= 0.4;
      }
      d.mesh.material.opacity = life * 0.9;
    }

    if (effect.age >= effect.maxAge) effect._remove = true;
  }

  // ──────────────────────────────────────────────
  //  SHIELD BUBBLE (absorbs, immunities)
  // ──────────────────────────────────────────────

  spawnShieldBubble(position, config) {
    const { color = 0x4488ff, radius = 2.5, duration = 3.0, school = 'frost' } = config;
    const group = new THREE.Group();
    group.position.set(position.x, 0, position.z);
    this.scene.add(group);

    // Translucent sphere
    const sphereGeo = new THREE.SphereGeometry(radius, 24, 16);
    const sphereMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.2, side: THREE.DoubleSide,
      map: SPELL_TEXTURES[school] || null
    });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    sphere.position.y = radius;
    group.add(sphere);

    // Rotating equator ring
    const ringGeo = new THREE.TorusGeometry(radius * 1.1, 0.06, 8, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = radius;
    group.add(ring);

    this.activeEffects.push({
      type: 'shield_bubble', group, sphere, ring, sphereMat, ringMat,
      age: 0, maxAge: duration, rotAngle: 0
    });
  }

  updateShieldBubble(effect, dt) {
    effect.age += dt;
    const life = Math.max(0, 1 - effect.age / effect.maxAge);
    const pulse = 1 + Math.sin(effect.age * 4) * 0.05;

    if (effect.sphere) {
      effect.sphere.scale.set(pulse, pulse, pulse);
      effect.sphereMat.opacity = 0.15 * life + Math.sin(effect.age * 3) * 0.05;
    }
    if (effect.ring) {
      effect.rotAngle += dt * 2;
      effect.ring.rotation.x = effect.rotAngle;
      effect.ring.rotation.z = effect.rotAngle * 0.3;
      effect.ringMat.opacity = 0.5 * life;
    }

    if (effect.age >= effect.maxAge) effect._remove = true;
  }

  // ──────────────────────────────────────────────
  //  HEAL BURST (heals, HoTs, recovery)
  // ──────────────────────────────────────────────

  spawnHealBurst(position, config) {
    const { color = 0x44ff44, size = 3, school = 'holy', particleCount = 12 } = config;
    const group = new THREE.Group();
    group.position.set(position.x, 0, position.z);
    this.scene.add(group);

    // Ground flash
    const flashGeo = new THREE.CircleGeometry(size * 0.6, 16);
    const flashMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.6, depthWrite: false,
      map: SPELL_TEXTURES[school] || null
    });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.rotation.x = -Math.PI / 2;
    flash.position.y = 0.28;
    group.add(flash);

    // Upward-floating particles in a spiral
    const particles = [];
    for (let i = 0; i < particleCount; i++) {
      const pSize = 0.06 + Math.random() * 0.1;
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 });
      const p = new THREE.Mesh(_sphereGeo6, mat);
      p.scale.setScalar(pSize);
      const angle = (i / particleCount) * Math.PI * 2;
      const dist = 0.5 + Math.random() * 1.5;
      p.position.set(Math.cos(angle) * dist, 0.3, Math.sin(angle) * dist);
      group.add(p);
      particles.push({ mesh: p, angle, dist, riseSpeed: 1.5 + Math.random() * 2, spiralSpeed: 1 + Math.random() });
    }

    this.activeEffects.push({
      type: 'heal_burst', group, flash, particles,
      age: 0, maxAge: 2.0
    });
  }

  updateHealBurst(effect, dt) {
    effect.age += dt;
    const life = Math.max(0, 1 - effect.age / effect.maxAge);

    if (effect.flash) effect.flash.material.opacity = life * 0.6;

    for (const p of effect.particles) {
      p.angle += p.spiralSpeed * dt;
      p.mesh.position.x = Math.cos(p.angle) * p.dist * life;
      p.mesh.position.z = Math.sin(p.angle) * p.dist * life;
      p.mesh.position.y += p.riseSpeed * dt;
      p.mesh.material.opacity = life * 0.8;
      const shrink = Math.max(0.3, life);
      p.mesh.scale.setScalar(shrink);
    }

    if (effect.age >= effect.maxAge) effect._remove = true;
  }

  // ──────────────────────────────────────────────
  //  WEAPON SWING (melee strikes, cleaves)
  // ──────────────────────────────────────────────

  spawnWeaponSwing(position, config) {
    const { color = 0xcccccc, size = 3, school = 'physical', tex = null } = config;
    const group = new THREE.Group();
    group.position.set(position.x, (position.y || 1.5), position.z);
    this.scene.add(group);

    // Arc sweep — curved tube representing a weapon trail
    const arcPoints = [];
    for (let a = 0; a <= 10; a++) {
      const angle = (a / 10) * Math.PI * 0.9 - Math.PI * 0.45;
      arcPoints.push(new THREE.Vector3(
        Math.cos(angle) * size * 0.6,
        Math.sin(angle) * size * 0.2,
        (a / 10 - 0.5) * 0.5
      ));
    }
    const curve = new THREE.CatmullRomCurve3(arcPoints);
    const tubeGeo = new THREE.TubeGeometry(curve, 10, 0.05, 4, false);
    const swingTex = tex || VFX_TEXTURES.steelSlash || null;
    const tubeMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, map: swingTex });
    const trail = new THREE.Mesh(tubeGeo, tubeMat);
    group.add(trail);

    // Wider glow arc
    const glowGeo = new THREE.TubeGeometry(curve, 10, 0.2, 4, false);
    const glowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, map: swingTex });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    group.add(glow);

    this.activeEffects.push({
      type: 'weapon_swing', group, tubeMat, glowMat,
      age: 0, maxAge: 0.4
    });
  }

  updateWeaponSwing(effect, dt) {
    effect.age += dt;
    const life = Math.max(0, 1 - effect.age / effect.maxAge);
    effect.tubeMat.opacity = life * 0.8;
    effect.glowMat.opacity = life * 0.25;
    effect.group.rotation.y += dt * 8;
    if (effect.age >= effect.maxAge) effect._remove = true;
  }

  // ──────────────────────────────────────────────
  //  HOLY PILLAR (light from sky — paladin)
  // ──────────────────────────────────────────────

  spawnHolyPillar(position, config) {
    const { color = 0xffd700, height = 18, radius = 1.5, duration = 1.5, tex = null } = config;
    const group = new THREE.Group();
    group.position.set(position.x, 0, position.z);
    this.scene.add(group);

    // Vertical light beam
    const beamGeo = new THREE.CylinderGeometry(radius * 0.3, radius, height, 12, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.6, side: THREE.DoubleSide,
      map: tex || VFX_TEXTURES.holy || SPELL_TEXTURES.holy || null, depthWrite: false
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = height / 2;
    group.add(beam);

    // Outer glow cylinder
    const glowGeo = new THREE.CylinderGeometry(radius * 0.6, radius * 1.8, height, 12, 1, true);
    const glowMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.y = height / 2;
    group.add(glow);

    // Ground circle
    const groundGeo = new THREE.RingGeometry(radius * 0.8, radius * 1.5, 24);
    const groundMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false,
      map: PROC_TEXTURES.runeCircle
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.28;
    group.add(ground);

    // Rising light motes
    const motes = [];
    for (let i = 0; i < 12; i++) {
      const mSize = 0.08 + Math.random() * 0.06;
      const mMat = new THREE.MeshBasicMaterial({ color: 0xffffdd, transparent: true, opacity: 0.8 });
      const m = new THREE.Mesh(_sphereGeo6, mMat);
      m.scale.setScalar(mSize);
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * radius;
      m.position.set(Math.cos(a) * d, Math.random() * height * 0.5, Math.sin(a) * d);
      group.add(m);
      motes.push({ mesh: m, speed: 3 + Math.random() * 5, angle: a, dist: d });
    }

    this.activeEffects.push({
      type: 'holy_pillar', group, beam, beamMat, glow, glowMat, ground, groundMat, motes,
      height, age: 0, maxAge: duration
    });
  }

  updateHolyPillar(effect, dt) {
    effect.age += dt;
    const life = Math.max(0, 1 - effect.age / effect.maxAge);
    const fadeIn = Math.min(1, effect.age / 0.2);
    const alpha = life * fadeIn;

    if (effect.beamMat) effect.beamMat.opacity = 0.6 * alpha;
    if (effect.glowMat) effect.glowMat.opacity = 0.15 * alpha;
    if (effect.groundMat) {
      effect.groundMat.opacity = 0.7 * alpha;
      effect.ground.rotation.z += dt * 1.5;
    }

    for (const m of effect.motes) {
      m.mesh.position.y += m.speed * dt;
      if (m.mesh.position.y > effect.height) m.mesh.position.y = 0;
      m.mesh.material.opacity = alpha * 0.8;
    }

    if (effect.age >= effect.maxAge) effect._remove = true;
  }

  // ──────────────────────────────────────────────
  //  FIRE COLUMN (erupting fire pillar — mage)
  // ──────────────────────────────────────────────

  spawnFireColumn(position, config) {
    const { color = 0xff4400, height = 10, radius = 1.2, duration = 1.2 } = config;
    const group = new THREE.Group();
    group.position.set(position.x, 0, position.z);
    this.scene.add(group);

    // Fire pillar — tapered cylinder
    const pillarGeo = new THREE.CylinderGeometry(radius * 0.2, radius, height, 10, 4, true);
    const pillarMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.7, side: THREE.DoubleSide,
      map: VFX_TEXTURES.fire || SPELL_TEXTURES.fire || null, depthWrite: false
    });
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.position.y = height / 2;
    group.add(pillar);

    // Outer heat haze
    const hazeGeo = new THREE.CylinderGeometry(radius * 0.5, radius * 1.6, height * 0.7, 10, 1, true);
    const hazeMat = new THREE.MeshBasicMaterial({
      color: 0xff6600, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false
    });
    const haze = new THREE.Mesh(hazeGeo, hazeMat);
    haze.position.y = height * 0.35;
    group.add(haze);

    // Embers flying upward
    const embers = [];
    for (let i = 0; i < 16; i++) {
      const eSize = 0.05 + Math.random() * 0.08;
      const eColor = Math.random() > 0.5 ? 0xffaa22 : 0xff4400;
      const eMat = new THREE.MeshBasicMaterial({ color: eColor, transparent: true, opacity: 0.9 });
      const ember = new THREE.Mesh(_sphereGeo4, eMat);
      ember.scale.setScalar(eSize);
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * radius * 0.8;
      ember.position.set(Math.cos(a) * d, Math.random() * height * 0.3, Math.sin(a) * d);
      group.add(ember);
      embers.push({
        mesh: ember, speed: 4 + Math.random() * 8, drift: (Math.random() - 0.5) * 2, angle: a
      });
    }

    // Ground scorch
    const scorchGeo = new THREE.CircleGeometry(radius * 1.8, 16);
    const scorchMat = new THREE.MeshBasicMaterial({
      color: 0x331100, transparent: true, opacity: 0.5, depthWrite: false,
      map: SPELL_TEXTURES.fire || null
    });
    const scorch = new THREE.Mesh(scorchGeo, scorchMat);
    scorch.rotation.x = -Math.PI / 2;
    scorch.position.y = 0.27;
    group.add(scorch);

    this.activeEffects.push({
      type: 'fire_column', group, pillar, pillarMat, haze, hazeMat, embers, scorch, scorchMat,
      height, age: 0, maxAge: duration
    });
  }

  updateFireColumn(effect, dt) {
    effect.age += dt;
    const life = Math.max(0, 1 - effect.age / effect.maxAge);
    const t = this._elapsedTime;

    // Flicker
    const flicker = 0.6 + Math.sin(t * 15) * 0.15 + Math.sin(t * 23) * 0.1;
    if (effect.pillarMat) effect.pillarMat.opacity = flicker * life;
    if (effect.hazeMat) effect.hazeMat.opacity = 0.2 * life;
    if (effect.scorchMat) effect.scorchMat.opacity = 0.5 * life;

    // Animate embers rising
    for (const e of effect.embers) {
      e.mesh.position.y += e.speed * dt;
      e.mesh.position.x += e.drift * dt;
      if (e.mesh.position.y > effect.height) {
        e.mesh.position.y = 0;
        e.mesh.position.x = Math.cos(e.angle) * Math.random() * 0.8;
        e.mesh.position.z = Math.sin(e.angle) * Math.random() * 0.8;
      }
      e.mesh.material.opacity = life * (0.6 + Math.random() * 0.4);
    }

    // UV scroll on pillar
    if (effect.pillar && effect.pillar.material.map) {
      effect.pillar.material.map.offset.y -= dt * 2.0;
    }

    if (effect.age >= effect.maxAge) effect._remove = true;
  }

  // ──────────────────────────────────────────────
  //  LIGHTNING STRIKE (bolt from sky)
  // ──────────────────────────────────────────────

  spawnLightningStrike(position, config) {
    const { color = 0x88aaff, duration = 0.5, segments = 12 } = config;
    const group = new THREE.Group();
    group.position.set(position.x, 0, position.z);
    this.scene.add(group);

    const height = 16;
    // Jagged bolt made of connected line segments
    const points = [];
    let x = 0, z = 0;
    for (let i = 0; i <= segments; i++) {
      const y = (i / segments) * height;
      points.push(new THREE.Vector3(x, y, z));
      x += (Math.random() - 0.5) * 2.5;
      z += (Math.random() - 0.5) * 1.5;
    }
    const curve = new THREE.CatmullRomCurve3(points);

    // Core bolt
    const coreGeo = new THREE.TubeGeometry(curve, segments * 2, 0.15, 6, false);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 1.0, depthWrite: false
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    group.add(core);

    // Glow bolt
    const glowGeo = new THREE.TubeGeometry(curve, segments * 2, 0.5, 6, false);
    const glowMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.4, depthWrite: false
    });
    const glowBolt = new THREE.Mesh(glowGeo, glowMat);
    group.add(glowBolt);

    // Branch bolts
    for (let b = 0; b < 3; b++) {
      const bi = Math.floor(Math.random() * (segments - 2)) + 1;
      const bp = points[bi].clone();
      const branchPts = [bp.clone()];
      let bx = bp.x, bz = bp.z;
      for (let j = 0; j < 4; j++) {
        bx += (Math.random() - 0.5) * 3;
        bz += (Math.random() - 0.5) * 2;
        branchPts.push(new THREE.Vector3(bx, bp.y - (j + 1) * 1.5, bz));
      }
      const branchCurve = new THREE.CatmullRomCurve3(branchPts);
      const branchGeo = new THREE.TubeGeometry(branchCurve, 6, 0.06, 4, false);
      const branchMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 });
      group.add(new THREE.Mesh(branchGeo, branchMat));
    }

    // Ground flash
    const flashGeo = new THREE.CircleGeometry(3, 16);
    const flashMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.8, depthWrite: false,
      map: PROC_TEXTURES.lightning
    });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.rotation.x = -Math.PI / 2;
    flash.position.y = 0.28;
    group.add(flash);

    this.activeEffects.push({
      type: 'lightning_strike', group, coreMat, glowMat, flashMat,
      age: 0, maxAge: duration
    });
  }

  updateLightningStrike(effect, dt) {
    effect.age += dt;
    // Lightning rapidly fades
    const life = Math.max(0, 1 - effect.age / effect.maxAge);
    const flicker = life > 0.5 ? 1.0 : (Math.random() > 0.3 ? life * 2 : 0);
    if (effect.coreMat) effect.coreMat.opacity = flicker;
    if (effect.glowMat) effect.glowMat.opacity = flicker * 0.4;
    if (effect.flashMat) effect.flashMat.opacity = life * 0.8;
    if (effect.age >= effect.maxAge) effect._remove = true;
  }

  // ──────────────────────────────────────────────
  //  VORTEX (spinning tornado — whirlwind, cyclone)
  // ──────────────────────────────────────────────

  spawnVortex(position, config) {
    const { color = 0xaaaaaa, radius = 3, height = 6, duration = 4.0, school = 'physical' } = config;
    const schoolTex = VFX_TEXTURES[school] || SPELL_TEXTURES[school] || null;
    const group = new THREE.Group();
    group.position.set(position.x, 0, position.z);
    this.scene.add(group);

    // Stacked spinning rings at different heights (textured + additive glow)
    const rings = [];
    for (let i = 0; i < 6; i++) {
      const y = (i / 5) * height;
      const r = radius * (1 - i * 0.12);
      const ringGeo = new THREE.TorusGeometry(r, 0.12, 6, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.5, depthWrite: false,
        map: schoolTex, blending: THREE.AdditiveBlending
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = y;
      ring.rotation.x = Math.PI / 2;
      group.add(ring);
      rings.push({ mesh: ring, baseY: y, speed: 3 + i * 1.5, r });
    }

    // Debris particles orbiting (textured spheres instead of plain boxes)
    const orbitParticles = [];
    for (let i = 0; i < 20; i++) {
      const pSize = 0.1 + Math.random() * 0.08;
      const pColor = school === 'frost' ? 0x88ccff : school === 'holy' ? 0xffd700
        : school === 'shadow' ? 0x6622aa : school === 'fire' ? 0xff6633 : 0x998877;
      const pMat = new THREE.MeshBasicMaterial({
        color: pColor, transparent: true, opacity: 0.7,
        map: schoolTex, blending: THREE.AdditiveBlending, depthWrite: false
      });
      const p = new THREE.Mesh(_sphereGeo6, pMat);
      p.scale.setScalar(pSize);
      const a = Math.random() * Math.PI * 2;
      const py = Math.random() * height;
      const pr = radius * (0.3 + Math.random() * 0.7);
      p.position.set(Math.cos(a) * pr, py, Math.sin(a) * pr);
      group.add(p);
      orbitParticles.push({ mesh: p, angle: a, y: py, r: pr, speed: 4 + Math.random() * 4, riseSpeed: 1 + Math.random() * 2 });
    }

    this.activeEffects.push({
      type: 'vortex', group, rings, orbitParticles, height, radius,
      age: 0, maxAge: duration
    });
  }

  updateVortex(effect, dt) {
    effect.age += dt;
    const life = Math.max(0, 1 - effect.age / effect.maxAge);

    for (const r of effect.rings) {
      r.mesh.rotation.z += r.speed * dt;
      r.mesh.material.opacity = 0.4 * life;
      // Slight bob
      r.mesh.position.y = r.baseY + Math.sin(this._elapsedTime * 2 + r.baseY) * 0.2;
    }

    for (const p of effect.orbitParticles) {
      p.angle += p.speed * dt;
      p.y += p.riseSpeed * dt;
      if (p.y > effect.height) p.y = 0;
      p.mesh.position.x = Math.cos(p.angle) * p.r;
      p.mesh.position.z = Math.sin(p.angle) * p.r;
      p.mesh.position.y = p.y;
      p.mesh.rotation.x += dt * 3;
      p.mesh.rotation.z += dt * 2;
      p.mesh.material.opacity = 0.6 * life;
    }

    if (effect.age >= effect.maxAge) effect._remove = true;
  }

  // ──────────────────────────────────────────────
  //  RUNE CIRCLE (ground sigil — warlock, mage)
  // ──────────────────────────────────────────────

  spawnRuneCircle(position, config) {
    const { color = 0x8800ff, radius = 3.0, duration = 2.0, school = 'shadow' } = config;
    const schoolTex = VFX_TEXTURES[school] || SPELL_TEXTURES[school] || null;
    const group = new THREE.Group();
    group.position.set(position.x, 0.29, position.z);
    this.scene.add(group);

    // Main rune circle disc (procedural rune texture)
    const discGeo = new THREE.CircleGeometry(radius, 32);
    const discMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide,
      map: PROC_TEXTURES.runeCircle, blending: THREE.AdditiveBlending
    });
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.rotation.x = -Math.PI / 2;
    group.add(disc);

    // Outer rotating ring (textured with school texture + additive glow)
    const outerGeo = new THREE.RingGeometry(radius * 0.90, radius * 1.10, 32);
    const outerMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false,
      map: schoolTex || PROC_TEXTURES.energySwirl, blending: THREE.AdditiveBlending
    });
    const outer = new THREE.Mesh(outerGeo, outerMat);
    outer.rotation.x = -Math.PI / 2;
    group.add(outer);

    // Rising wisps (textured)
    const wisps = [];
    for (let i = 0; i < 8; i++) {
      const wSize = 0.06 + Math.random() * 0.04;
      const wMat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.7,
        map: schoolTex, blending: THREE.AdditiveBlending, depthWrite: false
      });
      const w = new THREE.Mesh(_sphereGeo6, wMat);
      w.scale.setScalar(wSize);
      const a = (i / 8) * Math.PI * 2;
      const d = radius * (0.4 + Math.random() * 0.5);
      w.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
      group.add(w);
      wisps.push({ mesh: w, angle: a, dist: d, phase: Math.random() * Math.PI * 2 });
    }

    this.activeEffects.push({
      type: 'rune_circle', group, disc, discMat, outer, outerMat, wisps,
      age: 0, maxAge: duration
    });
  }

  updateRuneCircle(effect, dt) {
    effect.age += dt;
    const life = Math.max(0, 1 - effect.age / effect.maxAge);
    const fadeIn = Math.min(1, effect.age / 0.3);
    const alpha = life * fadeIn;

    if (effect.discMat) effect.discMat.opacity = 0.6 * alpha;
    if (effect.outerMat) effect.outerMat.opacity = 0.8 * alpha;
    if (effect.disc) effect.disc.rotation.z += dt * 0.8;
    if (effect.outer) effect.outer.rotation.z -= dt * 1.2;

    for (const w of effect.wisps) {
      w.mesh.position.y = Math.sin(this._elapsedTime * 2 + w.phase) * 1.5 + 1.0;
      w.mesh.material.opacity = alpha * 0.6;
    }

    if (effect.age >= effect.maxAge) effect._remove = true;
  }

  // ──────────────────────────────────────────────
  //  ICE SHARDS (crystalline burst — frost)
  // ──────────────────────────────────────────────

  spawnIceShards(position, config) {
    const { color = 0x88ccff, count = 8, size = 1.5, duration = 1.5 } = config;
    const group = new THREE.Group();
    group.position.set(position.x, 0, position.z);
    this.scene.add(group);

    const shards = [];
    for (let i = 0; i < count; i++) {
      // Create elongated crystal shape
      const h = size * (0.5 + Math.random() * 1.0);
      const w = h * 0.15;
      const shardGeo = new THREE.ConeGeometry(w, h, 4);
      const shardMat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.85,
        map: SPELL_TEXTURES.frost || null
      });
      const shard = new THREE.Mesh(shardGeo, shardMat);
      const a = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const d = 0.5 + Math.random() * 2;
      shard.position.set(Math.cos(a) * d, h / 2, Math.sin(a) * d);
      // Tilt outward
      shard.rotation.z = (Math.random() - 0.5) * 0.8;
      shard.rotation.x = (Math.random() - 0.5) * 0.5;
      group.add(shard);
      shards.push({ mesh: shard, targetY: h / 2, speed: 5 + Math.random() * 5 });
      shard.position.y = -0.5; // Start underground
    }

    // Frost ground ring
    const frostGeo = new THREE.RingGeometry(1.5, 3.0, 24);
    const frostMat = new THREE.MeshBasicMaterial({
      color: 0xaaddff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false,
      map: SPELL_TEXTURES.frost || null
    });
    const frost = new THREE.Mesh(frostGeo, frostMat);
    frost.rotation.x = -Math.PI / 2;
    frost.position.y = 0.27;
    group.add(frost);

    // Cold mist particles
    const mist = [];
    for (let i = 0; i < 10; i++) {
      const mSize = 0.2 + Math.random() * 0.3;
      const mMat = new THREE.MeshBasicMaterial({ color: 0xccddff, transparent: true, opacity: 0.3 });
      const m = new THREE.Mesh(_sphereGeo6, mMat);
      m.scale.setScalar(mSize);
      m.position.set((Math.random() - 0.5) * 4, 0.3 + Math.random() * 0.5, (Math.random() - 0.5) * 4);
      group.add(m);
      mist.push({ mesh: m, baseSize: mSize, drift: new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.2, (Math.random() - 0.5) * 0.5) });
    }

    this.activeEffects.push({
      type: 'ice_shards', group, shards, frost, frostMat, mist,
      age: 0, maxAge: duration
    });
  }

  updateIceShards(effect, dt) {
    effect.age += dt;
    const life = Math.max(0, 1 - effect.age / effect.maxAge);

    // Shards erupt upward then hold
    for (const s of effect.shards) {
      if (s.mesh.position.y < s.targetY) {
        s.mesh.position.y += s.speed * dt;
        if (s.mesh.position.y > s.targetY) s.mesh.position.y = s.targetY;
      }
      s.mesh.material.opacity = 0.85 * life;
    }

    if (effect.frostMat) effect.frostMat.opacity = 0.5 * life;

    for (const m of effect.mist) {
      m.mesh.position.add(m.drift.clone().multiplyScalar(dt));
      m.mesh.material.opacity = 0.3 * life;
      const sc = 1 + effect.age * 0.3;
      m.mesh.scale.setScalar(m.baseSize * sc);
    }

    if (effect.age >= effect.maxAge) effect._remove = true;
  }

  // ──────────────────────────────────────────────
  //  SHADOW NOVA (expanding dark ring — warlock)
  // ──────────────────────────────────────────────

  spawnShadowNova(position, config) {
    const { color = 0x6600aa, radius = 6, duration = 1.0 } = config;
    const group = new THREE.Group();
    group.position.set(position.x, 1.5, position.z);
    this.scene.add(group);

    // Dark sphere that expands and fades
    const sphereGeo = new THREE.SphereGeometry(0.5, 16, 16);
    const sphereMat = new THREE.MeshBasicMaterial({
      color: 0x110022, transparent: true, opacity: 0.8, side: THREE.DoubleSide,
      map: SPELL_TEXTURES.shadow || null
    });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    group.add(sphere);

    // Expanding ring
    const ringGeo = new THREE.TorusGeometry(0.5, 0.15, 8, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.7, depthWrite: false
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    // Shadow tendrils outward
    const tendrils = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const tMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 });
      const t = new THREE.Mesh(_sphereGeo6, tMat);
      t.scale.setScalar(0.12);
      group.add(t);
      tendrils.push({ mesh: t, angle: a, r: 0 });
    }

    this.activeEffects.push({
      type: 'shadow_nova', group, sphere, sphereMat, ring, ringMat, tendrils, radius,
      age: 0, maxAge: duration
    });
  }

  updateShadowNova(effect, dt) {
    effect.age += dt;
    const progress = effect.age / effect.maxAge;
    const life = Math.max(0, 1 - progress);

    // Sphere expands and fades
    const scale = 1 + progress * effect.radius;
    if (effect.sphere) {
      effect.sphere.scale.setScalar(scale);
      effect.sphereMat.opacity = 0.6 * life;
    }

    // Ring expands faster
    if (effect.ring) {
      const rScale = 1 + progress * effect.radius * 1.5;
      effect.ring.scale.setScalar(rScale);
      effect.ringMat.opacity = 0.7 * life;
    }

    // Tendrils shoot outward
    for (const t of effect.tendrils) {
      t.r = progress * effect.radius * 1.2;
      t.mesh.position.x = Math.cos(t.angle) * t.r;
      t.mesh.position.z = Math.sin(t.angle) * t.r;
      t.mesh.material.opacity = 0.6 * life;
    }

    if (effect.age >= effect.maxAge) effect._remove = true;
  }

  // ──────────────────────────────────────────────
  //  DAGGER FLURRY (multi-slash arcs — rogue)
  // ──────────────────────────────────────────────

  spawnDaggerFlurry(position, config) {
    const { color = 0xaaaacc, slashCount = 4, size = 2.5, duration = 0.6 } = config;
    const group = new THREE.Group();
    group.position.set(position.x, position.y || 1.5, position.z);
    this.scene.add(group);

    const slashes = [];
    for (let i = 0; i < slashCount; i++) {
      // Each slash is a thin curved plane
      const arcPts = [];
      const startAngle = (Math.random() - 0.5) * Math.PI;
      for (let a = 0; a <= 8; a++) {
        const angle = startAngle + (a / 8) * Math.PI * 0.7;
        arcPts.push(new THREE.Vector3(
          Math.cos(angle) * size * (0.4 + Math.random() * 0.3),
          Math.sin(angle) * size * 0.15 + (Math.random() - 0.5) * 0.3,
          (a / 8 - 0.5) * 0.3
        ));
      }
      const curve = new THREE.CatmullRomCurve3(arcPts);
      const tubeGeo = new THREE.TubeGeometry(curve, 8, 0.03, 3, false);
      const tubeMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 });
      const slash = new THREE.Mesh(tubeGeo, tubeMat);

      // Glow version
      const glowGeo = new THREE.TubeGeometry(curve, 8, 0.12, 4, false);
      const glowMat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0, depthWrite: false
      });
      const glowSlash = new THREE.Mesh(glowGeo, glowMat);

      // Random rotation for variety
      const rotY = Math.random() * Math.PI * 2;
      slash.rotation.y = rotY;
      glowSlash.rotation.y = rotY;

      group.add(slash);
      group.add(glowSlash);
      slashes.push({
        mesh: slash, glow: glowSlash, mat: tubeMat, glowMat,
        delay: i * (duration / slashCount) * 0.6,
        fadeIn: 0.05, holdTime: 0.15
      });
    }

    this.activeEffects.push({
      type: 'dagger_flurry', group, slashes,
      age: 0, maxAge: duration
    });
  }

  updateDaggerFlurry(effect, dt) {
    effect.age += dt;

    for (const s of effect.slashes) {
      const localAge = effect.age - s.delay;
      if (localAge < 0) continue;
      const totalLife = s.fadeIn + s.holdTime + 0.15;
      if (localAge < s.fadeIn) {
        const t = localAge / s.fadeIn;
        s.mat.opacity = t * 0.9;
        s.glowMat.opacity = t * 0.3;
      } else if (localAge < s.fadeIn + s.holdTime) {
        s.mat.opacity = 0.9;
        s.glowMat.opacity = 0.3;
      } else {
        const fade = Math.max(0, 1 - (localAge - s.fadeIn - s.holdTime) / 0.15);
        s.mat.opacity = fade * 0.9;
        s.glowMat.opacity = fade * 0.3;
      }
      s.mesh.rotation.y += dt * 12;
      s.glow.rotation.y = s.mesh.rotation.y;
    }

    if (effect.age >= effect.maxAge) effect._remove = true;
  }

  // ──────────────────────────────────────────────
  //  CHARGE TRAIL (rush/charge — warrior, paladin)
  // ──────────────────────────────────────────────

  spawnChargeTrail(from, to, config) {
    const { color = 0xcc4444, duration = 0.6 } = config;
    const group = new THREE.Group();
    this.scene.add(group);

    const start = new THREE.Vector3(from.x, 0.5, from.z);
    const end = new THREE.Vector3(to.x, 0.5, to.z);
    const dist = start.distanceTo(end);

    // Dust trail along ground
    const trailParticles = [];
    const numParticles = Math.floor(dist * 2);
    for (let i = 0; i < numParticles; i++) {
      const t = i / numParticles;
      const pos = start.clone().lerp(end, t);
      pos.x += (Math.random() - 0.5) * 1.5;
      pos.z += (Math.random() - 0.5) * 1.5;
      const pSize = 0.1 + Math.random() * 0.2;
      const pMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 });
      const p = new THREE.Mesh(_sphereGeo4, pMat);
      p.scale.setScalar(pSize);
      p.position.copy(pos);
      group.add(p);
      trailParticles.push({
        mesh: p, baseSize: pSize, riseSpeed: 1 + Math.random() * 2, drift: (Math.random() - 0.5) * 1
      });
    }

    this.activeEffects.push({
      type: 'charge_trail', group, trailParticles, age: 0, maxAge: duration
    });
  }

  updateChargeTrail(effect, dt) {
    effect.age += dt;
    const life = Math.max(0, 1 - effect.age / effect.maxAge);

    for (const p of effect.trailParticles) {
      p.mesh.position.y += p.riseSpeed * dt;
      p.mesh.position.x += p.drift * dt;
      p.mesh.material.opacity = life * 0.6;
      const sc = 1 + effect.age * 2;
      p.mesh.scale.setScalar(p.baseSize * sc);
    }

    if (effect.age >= effect.maxAge) effect._remove = true;
  }

  // ──────────────────────────────────────────────
  //  TELEPORT FLASH (blink/phase shift — mage, warlock)
  // ──────────────────────────────────────────────

  spawnTeleportFlash(position, config) {
    const { color = 0x6644ff, duration = 0.8, school = 'arcane' } = config;
    const group = new THREE.Group();
    group.position.set(position.x, 0, position.z);
    this.scene.add(group);

    // Implosion particles (move INWARD then disappear)
    const particles = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const d = 3 + Math.random() * 2;
      const pMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 });
      const p = new THREE.Mesh(_sphereGeo4, pMat);
      p.scale.setScalar(0.08);
      p.position.set(Math.cos(a) * d, 1 + Math.random() * 2, Math.sin(a) * d);
      group.add(p);
      particles.push({ mesh: p, startX: Math.cos(a) * d, startZ: Math.sin(a) * d, startY: p.position.y });
    }

    // Vertical swirl column
    const swirlGeo = new THREE.CylinderGeometry(0.3, 1.5, 5, 12, 4, true);
    const swirlMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.4, side: THREE.DoubleSide,
      map: SPELL_TEXTURES[school] || PROC_TEXTURES.energySwirl, depthWrite: false
    });
    const swirl = new THREE.Mesh(swirlGeo, swirlMat);
    swirl.position.y = 2.5;
    group.add(swirl);

    this.activeEffects.push({
      type: 'teleport_flash', group, particles, swirl, swirlMat,
      age: 0, maxAge: duration
    });
  }

  updateTeleportFlash(effect, dt) {
    effect.age += dt;
    const progress = Math.min(1, effect.age / (effect.maxAge * 0.5));
    const life = Math.max(0, 1 - effect.age / effect.maxAge);

    // Particles implode toward center
    for (const p of effect.particles) {
      const t = Math.min(1, progress * 1.5);
      p.mesh.position.x = p.startX * (1 - t);
      p.mesh.position.z = p.startZ * (1 - t);
      p.mesh.position.y = p.startY * (1 - t * 0.5);
      p.mesh.material.opacity = life * 0.8;
    }

    // Swirl rotates and fades
    if (effect.swirl) {
      effect.swirl.rotation.y += dt * 8;
      effect.swirlMat.opacity = life * 0.4;
    }

    if (effect.age >= effect.maxAge) effect._remove = true;
  }

  // ──────────────────────────────────────────────
  //  GROUND ZONE (persistent AoE circle — fire, frost, shadow)
  // ──────────────────────────────────────────────

  spawnGroundZone(position, config) {
    const {
      id, color = 0xff4400, radius = 7, duration = 8.0,
      school = 'fire', type = 'scorched_earth'
    } = config;
    const schoolTex = VFX_TEXTURES[school] || SPELL_TEXTURES[school] || null;
    const group = new THREE.Group();
    group.position.set(position.x, 0.15, position.z);
    this.scene.add(group);

    // Main circle disc
    const discGeo = new THREE.CircleGeometry(radius, 48);
    const discMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.0, depthWrite: false,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      map: PROC_TEXTURES.runeCircle
    });
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.rotation.x = -Math.PI / 2;
    group.add(disc);

    // Rotating outer ring
    const ringGeo = new THREE.RingGeometry(radius * 0.88, radius * 1.05, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.0, depthWrite: false,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      map: schoolTex || PROC_TEXTURES.energySwirl
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);

    // Rising wisps around the edge
    const wisps = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const d = radius * (0.5 + Math.random() * 0.4);
      const wSize = 0.1 + Math.random() * 0.08;
      const wMat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.0,
        map: schoolTex, blending: THREE.AdditiveBlending, depthWrite: false
      });
      const w = new THREE.Mesh(_sphereGeo6, wMat);
      w.scale.setScalar(wSize);
      w.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
      group.add(w);
      wisps.push({ mesh: w, angle: a, dist: d, phase: Math.random() * Math.PI * 2 });
    }

    this.activeEffects.push({
      type: 'ground_zone', zoneId: id, group, disc, discMat, ring, ringMat, wisps,
      age: 0, maxAge: duration, _forceRemove: false
    });
  }

  removeGroundZone(zoneId) {
    for (const effect of this.activeEffects) {
      if (effect.type === 'ground_zone' && effect.zoneId === zoneId) {
        effect._forceRemove = true;
        break;
      }
    }
  }

  updateGroundZone(effect, dt) {
    effect.age += dt;
    const fadeIn = Math.min(1, effect.age / 0.5);
    const fadeOut = effect._forceRemove ? Math.max(0, 1 - (effect.age - effect.maxAge + 0.5) / 0.5) : 1;
    const alpha = fadeIn * fadeOut;

    if (effect.discMat) effect.discMat.opacity = 0.35 * alpha;
    if (effect.ringMat) effect.ringMat.opacity = 0.5 * alpha;
    if (effect.disc) effect.disc.rotation.z += dt * 0.3;
    if (effect.ring) effect.ring.rotation.z -= dt * 0.6;

    for (const w of effect.wisps) {
      w.mesh.position.y = Math.sin(this._elapsedTime * 2 + w.phase) * 2.0 + 1.0;
      w.mesh.material.opacity = alpha * 0.5;
    }

    if (effect._forceRemove || effect.age >= effect.maxAge + 0.5) {
      effect._remove = true;
    }
  }

  // ──────────────────────────────────────────────
  //  CLEANUP
  // ──────────────────────────────────────────────

  removeEffect(effect) {
    // Group-based effects (projectile, aura, fear, root, death burst, blood)
    if (effect.group) {
      this.scene.remove(effect.group);
      effect.group.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }
    if (effect.auraGroup) {
      this.scene.remove(effect.auraGroup);
      effect.auraGroup.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }
    if (effect.impactGroup) {
      this.scene.remove(effect.impactGroup);
      effect.impactGroup.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }
    if (effect.bloodGroup) {
      this.scene.remove(effect.bloodGroup);
      effect.bloodGroup.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }
    if (effect.deathGroup) {
      this.scene.remove(effect.deathGroup);
      effect.deathGroup.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }
    if (effect.points) {
      this.scene.remove(effect.points);
      effect.points.geometry.dispose();
      effect.points.material.dispose();
    }
    if (effect.beamGroup) {
      this.scene.remove(effect.beamGroup);
      effect.beamGroup.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }
    // New particle-chain beam cleanup
    if (effect.type === 'beam') {
      if (effect.tendrils) {
        for (const t of effect.tendrils) {
          if (t.points) this.scene.remove(t.points);
          if (t.geo) t.geo.dispose();
          if (t.mat) t.mat.dispose();
        }
      }
      if (effect.orbs) {
        for (const o of effect.orbs) {
          if (o.mesh) {
            this.scene.remove(o.mesh);
            if (o.mesh.geometry) o.mesh.geometry.dispose();
          }
          if (o.mat) o.mat.dispose();
        }
      }
      if (effect.wisps) {
        this.scene.remove(effect.wisps);
        if (effect.wispGeo) effect.wispGeo.dispose();
        if (effect.wispMat) effect.wispMat.dispose();
      }
      if (effect.glowTex) {
        effect.glowTex.dispose();
      }
    }
    if (effect.line) {
      this.scene.remove(effect.line);
      effect.line.geometry.dispose();
      effect.line.material.dispose();
    }
    if (effect.ring && !effect.auraGroup) {
      this.scene.remove(effect.ring);
      effect.ring.geometry.dispose();
      effect.ring.material.dispose();
    }
  }

  /**
   * Clean up all effects
   */
  dispose() {
    for (const effect of this.activeEffects) {
      this.removeEffect(effect);
    }
    this.activeEffects = [];

    for (const decal of this.bloodDecals) {
      this.scene.remove(decal.mesh);
      decal.mesh.geometry.dispose();
      decal.mesh.material.dispose();
    }
    this.bloodDecals = [];
  }
}
