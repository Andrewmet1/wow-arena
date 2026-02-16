import * as THREE from 'three';

// ─── Runtime Sobel Normal Map Generator ─────────────────────────────────────
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
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = (src[i * 4] * 0.299 + src[i * 4 + 1] * 0.587 + src[i * 4 + 2] * 0.114) / 255;
  }
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
      let nx = -dX * strength, ny = -dY * strength, nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len; ny /= len; nz /= len;
      const pi = (y * w + x) * 4;
      out[pi] = ((nx * 0.5 + 0.5) * 255) | 0;
      out[pi + 1] = ((ny * 0.5 + 0.5) * 255) | 0;
      out[pi + 2] = ((nz * 0.5 + 0.5) * 255) | 0;
      out[pi + 3] = 255;
    }
  }
  ctx.putImageData(outData, 0, 0);
}

function _createNormalMap(sourceTex, strength = 2.5) {
  const canvas = document.createElement('canvas');
  canvas.width = 4; canvas.height = 4;
  const normalTex = new THREE.CanvasTexture(canvas);
  normalTex.wrapS = sourceTex.wrapS;
  normalTex.wrapT = sourceTex.wrapT;
  if (sourceTex.repeat) normalTex.repeat.copy(sourceTex.repeat);
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

// ─── Texture loader (eager, non-blocking) ──────────────────────────────────
const _texLoader = new THREE.TextureLoader();

function _loadTiledTex(path, repeatX = 1, repeatY = 1) {
  const tex = _texLoader.load(path);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex._normalMap = _createNormalMap(tex, 3.0);
  return tex;
}

const ARENA_TEXTURES = {
  floor:  _loadTiledTex('/assets/textures/tex_arena_floor.webp', 10, 10),
  wall:   _loadTiledTex('/assets/textures/tex_arena_wall.webp', 2, 1),
  pillar: _loadTiledTex('/assets/textures/tex_arena_pillar.webp', 1, 2),
  stagingFloor: _loadTiledTex('/assets/textures/tex_staging_floor.webp', 3, 3),
  stagingWall:  _loadTiledTex('/assets/textures/tex_staging_wall.webp', 2, 1),
  gateIron:     _loadTiledTex('/assets/textures/tex_gate_iron.webp', 1, 1),
  torchFlame: (() => {
    const t = _texLoader.load('/assets/textures/tex_torch_flame.webp');
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })(),
  sky:    (() => {
    const t = _texLoader.load('/assets/textures/tex_sky_panorama.webp');
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })(),
};

/**
 * ArenaRenderer
 *
 * Constructs the dark fantasy arena geometry and manages per-frame
 * animation for ambient particles, runic glows, torch-flame flicker,
 * floating embers, ground fog, and central emblem rotation.
 */
export class ArenaRenderer {
  /**
   * @param {THREE.Scene} scene - The Three.js scene to add arena objects to.
   */
  constructor(scene) {
    this.scene = scene;

    /** Root group that holds every arena mesh / light / particle system. */
    this.group = new THREE.Group();
    this.group.name = 'ArenaGroup';

    /** References kept for per-frame animation. */
    this.particles = null;
    this.particleVelocities = [];
    this.torchLights = [];
    this.torchBaseLightIntensities = [];
    this.torchFlameSprites = [];

    /** Runic ring meshes for pulsing emissive animation. */
    this.runicRings = [];

    /** Ground fog plane meshes for drift / opacity animation. */
    this.fogPlanes = [];

    /** Central arena emblem rings for counter-rotation animation. */
    this.emblemRings = [];

    /** Torch flame spheres for bobbing animation. */
    this.torchFlameSpheres = [];

    /** Floating ember meshes for rising animation. */
    this.floatingEmbers = [];

    /** Gate portcullis meshes (two gates, opposite ends). */
    this.gates = [];
    this._gatesOpen = false;
    this._gateAnimating = false;
    this._gateAnimStart = 0;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Build all arena geometry and add the root group to the scene.
   */
  build() {
    this._buildFloor();
    this._buildFloorTileStrips();
    this._buildFloorCracks();
    this._buildWalls();
    this._buildGates();
    this._buildPillars();
    this._buildBloodStains();
    this._buildParticles();
    this._buildTorches();
    this._buildArenaEmblem();
    this._buildGroundFog();
    this._buildSkyDome();
    this._buildFloatingEmbers();

    this.scene.add(this.group);
  }

  /**
   * Per-frame animation tick.
   * @param {number} deltaTime - Seconds since last frame.
   */
  animate(deltaTime) {
    this._animateParticles(deltaTime);
    this._animateTorches(deltaTime);
    this._animateRunicRings(deltaTime);
    this._animateGroundFog(deltaTime);
    this._animateEmblemRings(deltaTime);
    this._animateTorchFlameSpheres(deltaTime);
    this._animateFloatingEmbers(deltaTime);
    this._animateGates(deltaTime);
  }

  /**
   * Trigger gate open animation.
   */
  openGates() {
    if (this._gatesOpen) return;
    this._gatesOpen = true;
    this._gateAnimating = true;
    this._gateAnimStart = performance.now() / 1000;
  }

  /**
   * @returns {THREE.Group} The root group containing all arena objects.
   */
  getGroup() {
    return this.group;
  }

  /**
   * @returns {THREE.Mesh[]} Collision meshes for camera raycasting (pillars + walls).
   */
  getCollisionMeshes() {
    const meshes = [];
    this.group.traverse((child) => {
      if (child.isMesh && (child.name.startsWith('Pillar_') || child.name.startsWith('Wall_'))) {
        meshes.push(child);
      }
    });
    return meshes;
  }

  // ---------------------------------------------------------------------------
  // Floor
  // ---------------------------------------------------------------------------

  _buildFloor() {
    const geometry = new THREE.CylinderGeometry(40, 40, 0.5, 64);
    const material = new THREE.MeshStandardMaterial({
      color: 0x888888,
      map: ARENA_TEXTURES.floor,
      normalMap: ARENA_TEXTURES.floor._normalMap,
      normalScale: new THREE.Vector2(1.5, 1.5),
      roughness: 0.85,
      metalness: 0.15,
    });

    const floor = new THREE.Mesh(geometry, material);
    floor.position.y = -0.25; // sink half the height so the top surface is at y = 0
    floor.receiveShadow = true;
    floor.name = 'ArenaFloor';

    this.group.add(floor);

    // Floor edge rim - torus along the floor perimeter
    const rimGeometry = new THREE.TorusGeometry(40, 0.3, 16, 64);
    const rimMaterial = new THREE.MeshStandardMaterial({
      color: 0x556070,
      map: ARENA_TEXTURES.wall,
      emissive: 0x0a0a15,
      emissiveIntensity: 0.3,
      roughness: 0.7,
      metalness: 0.3,
    });
    const rim = new THREE.Mesh(rimGeometry, rimMaterial);
    rim.position.y = 0.01;
    rim.rotation.x = Math.PI / 2; // lay flat
    rim.name = 'FloorEdgeRim';

    this.group.add(rim);
  }

  // ---------------------------------------------------------------------------
  // Stone tile strip pattern (dark PlaneGeometry strips in a grid)
  // ---------------------------------------------------------------------------

  _buildFloorTileStrips() {
    const RADIUS = 39.5;
    const TILE_SPACING = 4;
    const STRIP_WIDTH = 0.05;
    const STRIP_Y = 0.02;

    const stripMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a1a24,
      roughness: 0.9,
      metalness: 0.1,
    });

    // Merge all strip geometries into one for performance
    const mergedPositions = [];
    const mergedNormals = [];
    const mergedIndices = [];
    let indexOffset = 0;

    // Helper to add a strip quad to merged arrays
    const addStrip = (x1, z1, x2, z2) => {
      const dx = x2 - x1;
      const dz = z2 - z1;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len < 0.1) return;
      // Perpendicular direction for width
      const px = (-dz / len) * STRIP_WIDTH * 0.5;
      const pz = (dx / len) * STRIP_WIDTH * 0.5;

      // 4 vertices for the quad
      mergedPositions.push(
        x1 + px, STRIP_Y, z1 + pz,
        x1 - px, STRIP_Y, z1 - pz,
        x2 - px, STRIP_Y, z2 - pz,
        x2 + px, STRIP_Y, z2 + pz,
      );
      // Normal pointing up
      for (let n = 0; n < 4; n++) {
        mergedNormals.push(0, 1, 0);
      }
      // Two triangles
      mergedIndices.push(
        indexOffset, indexOffset + 1, indexOffset + 2,
        indexOffset, indexOffset + 2, indexOffset + 3,
      );
      indexOffset += 4;
    };

    // Grid lines along X
    for (let x = -RADIUS; x <= RADIUS; x += TILE_SPACING) {
      const halfSpan = Math.sqrt(Math.max(0, RADIUS * RADIUS - x * x));
      addStrip(x, -halfSpan, x, halfSpan);
    }

    // Grid lines along Z
    for (let z = -RADIUS; z <= RADIUS; z += TILE_SPACING) {
      const halfSpan = Math.sqrt(Math.max(0, RADIUS * RADIUS - z * z));
      addStrip(-halfSpan, z, halfSpan, z);
    }

    if (mergedPositions.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(mergedPositions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mergedNormals, 3));
      geometry.setIndex(mergedIndices);

      const strips = new THREE.Mesh(geometry, stripMaterial);
      strips.receiveShadow = true;
      strips.name = 'FloorTileStrips';
      this.group.add(strips);
    }
  }

  // ---------------------------------------------------------------------------
  // Floor crack grid (stone tile lines) — kept for extra detail
  // ---------------------------------------------------------------------------

  _buildFloorCracks() {
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x556677,
      transparent: true,
      opacity: 0.4,
    });

    const RADIUS = 39.5;
    const TILE_SPACING = 4;

    const points = [];

    // Grid lines along X
    for (let x = -RADIUS; x <= RADIUS; x += TILE_SPACING) {
      const halfSpan = Math.sqrt(Math.max(0, RADIUS * RADIUS - x * x));
      points.push(new THREE.Vector3(x, 0.01, -halfSpan));
      points.push(new THREE.Vector3(x, 0.01, halfSpan));
    }

    // Grid lines along Z
    for (let z = -RADIUS; z <= RADIUS; z += TILE_SPACING) {
      const halfSpan = Math.sqrt(Math.max(0, RADIUS * RADIUS - z * z));
      points.push(new THREE.Vector3(-halfSpan, 0.01, z));
      points.push(new THREE.Vector3(halfSpan, 0.01, z));
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const lines = new THREE.LineSegments(geometry, lineMaterial);
    lines.name = 'FloorCracks';

    this.group.add(lines);
  }

  // ---------------------------------------------------------------------------
  // Walls — with crenellations, archways, color variation, base trim
  // ---------------------------------------------------------------------------

  _buildWalls() {
    const wallColorA = 0x556070;
    const wallColorB = 0x4a5565;

    const WALL_COUNT = 32;
    const WALL_HEIGHT = 5;
    const WALL_RADIUS = 41; // slightly outside the floor edge
    const WALL_WIDTH = (2 * Math.PI * WALL_RADIUS) / WALL_COUNT + 0.15; // slight overlap
    const WALL_DEPTH = 1.5;

    // Torch positions (indices) — every 8th wall segment
    const torchIndices = new Set([0, 8, 16, 24]);

    for (let i = 0; i < WALL_COUNT; i++) {
      const angle = (i / WALL_COUNT) * Math.PI * 2;
      const isAlt = i % 2 === 0;

      const wallMaterial = new THREE.MeshStandardMaterial({
        color: isAlt ? wallColorA : wallColorB,
        map: ARENA_TEXTURES.wall,
        normalMap: ARENA_TEXTURES.wall._normalMap,
        normalScale: new THREE.Vector2(1.8, 1.8),
        roughness: 0.9,
        metalness: 0.1,
      });

      // Main wall segment
      const geometry = new THREE.BoxGeometry(WALL_WIDTH, WALL_HEIGHT, WALL_DEPTH);
      const wall = new THREE.Mesh(geometry, wallMaterial);

      wall.position.set(
        Math.cos(angle) * WALL_RADIUS,
        WALL_HEIGHT / 2,
        Math.sin(angle) * WALL_RADIUS,
      );
      wall.rotation.y = -angle + Math.PI / 2;
      wall.castShadow = true;
      wall.receiveShadow = true;
      wall.name = `Wall_${i}`;

      this.group.add(wall);

      // --- Wall base trim: darker strip along the bottom ---
      const baseTrimGeom = new THREE.BoxGeometry(WALL_WIDTH + 0.1, 0.4, WALL_DEPTH + 0.2);
      const baseTrimMat = new THREE.MeshStandardMaterial({
        color: 0x555568,
        map: ARENA_TEXTURES.wall,
        roughness: 0.95,
        metalness: 0.05,
      });
      const baseTrim = new THREE.Mesh(baseTrimGeom, baseTrimMat);
      baseTrim.position.set(
        Math.cos(angle) * WALL_RADIUS,
        0.2,
        Math.sin(angle) * WALL_RADIUS,
      );
      baseTrim.rotation.y = -angle + Math.PI / 2;
      baseTrim.receiveShadow = true;
      baseTrim.name = `WallBaseTrim_${i}`;
      this.group.add(baseTrim);

      // --- Crenellations on top: alternating boxes ---
      if (i % 2 === 0) {
        const crenGeom = new THREE.BoxGeometry(WALL_WIDTH * 0.4, 1.0, WALL_DEPTH * 0.8);
        const crenMat = new THREE.MeshStandardMaterial({
          color: 0x6a7080,
          map: ARENA_TEXTURES.wall,
          roughness: 0.9,
          metalness: 0.1,
        });
        const cren = new THREE.Mesh(crenGeom, crenMat);
        cren.position.set(
          Math.cos(angle) * WALL_RADIUS,
          WALL_HEIGHT + 0.5,
          Math.sin(angle) * WALL_RADIUS,
        );
        cren.rotation.y = -angle + Math.PI / 2;
        cren.castShadow = true;
        cren.receiveShadow = true;
        cren.name = `WallCren_${i}`;
        this.group.add(cren);
      }

      // --- Archway frames at torch positions ---
      if (torchIndices.has(i)) {
        this._buildArchway(angle, WALL_RADIUS, WALL_HEIGHT, WALL_DEPTH);
      }
    }
  }

  /**
   * Build an archway frame at a wall position: two vertical pillars + curved arch.
   */
  _buildArchway(angle, wallRadius, wallHeight, wallDepth) {
    const archMaterial = new THREE.MeshStandardMaterial({
      color: 0x7a8090,
      map: ARENA_TEXTURES.pillar,
      roughness: 0.8,
      metalness: 0.2,
    });

    const cx = Math.cos(angle) * wallRadius;
    const cz = Math.sin(angle) * wallRadius;

    // Direction tangent to wall (perpendicular to the radius)
    const tx = -Math.sin(angle);
    const tz = Math.cos(angle);

    const pillarSpacing = 1.2;
    const pillarRadius = 0.15;
    const pillarHeight = wallHeight - 0.5;

    // Left pillar
    const lpGeom = new THREE.CylinderGeometry(pillarRadius, pillarRadius, pillarHeight, 8);
    const lp = new THREE.Mesh(lpGeom, archMaterial);
    lp.position.set(
      cx + tx * pillarSpacing,
      pillarHeight / 2,
      cz + tz * pillarSpacing,
    );
    lp.castShadow = true;
    lp.name = 'ArchPillar';
    this.group.add(lp);

    // Right pillar
    const rp = new THREE.Mesh(lpGeom, archMaterial);
    rp.position.set(
      cx - tx * pillarSpacing,
      pillarHeight / 2,
      cz - tz * pillarSpacing,
    );
    rp.castShadow = true;
    rp.name = 'ArchPillar';
    this.group.add(rp);

    // Curved arch using TubeGeometry with CatmullRomCurve3
    const archPoints = [];
    const segments = 12;
    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      const archAngle = Math.PI * t; // semicircle from left to right
      const localX = Math.cos(archAngle) * pillarSpacing;
      const localY = Math.sin(archAngle) * 1.0; // arch height

      archPoints.push(new THREE.Vector3(
        cx + tx * localX,
        pillarHeight + localY,
        cz + tz * localX,
      ));
    }

    const archCurve = new THREE.CatmullRomCurve3(archPoints);
    const archTubeGeom = new THREE.TubeGeometry(archCurve, 16, 0.1, 8, false);
    const arch = new THREE.Mesh(archTubeGeom, archMaterial);
    arch.castShadow = true;
    arch.name = 'ArchCurve';
    this.group.add(arch);
  }

  // ---------------------------------------------------------------------------
  // Starting Gates + Staging Cells (open-top gladiator pens outside arena)
  // ---------------------------------------------------------------------------

  _buildGates() {
    const WALL_RADIUS = 41;
    const GATE_WIDTH = 7;
    const GATE_HEIGHT = 6;
    const CELL_DEPTH = 12;
    const CELL_WIDTH = 10;
    const WALL_H = 4.5;

    const gateConfigs = [
      { sign: 1,  name: 'East' },
      { sign: -1, name: 'West' },
    ];

    // Shared materials
    const cellFloorMat = new THREE.MeshStandardMaterial({
      color: 0x999999,
      map: ARENA_TEXTURES.stagingFloor,
      normalMap: ARENA_TEXTURES.stagingFloor._normalMap,
      normalScale: new THREE.Vector2(2.0, 2.0),
      roughness: 0.88,
      metalness: 0.05,
    });

    const cellWallMat = new THREE.MeshStandardMaterial({
      color: 0x888888,
      map: ARENA_TEXTURES.stagingWall,
      normalMap: ARENA_TEXTURES.stagingWall._normalMap,
      normalScale: new THREE.Vector2(2.0, 2.0),
      roughness: 0.9,
      metalness: 0.08,
    });

    const stoneTrimMat = new THREE.MeshStandardMaterial({
      color: 0x5a5a68,
      map: ARENA_TEXTURES.pillar,
      roughness: 0.85,
      metalness: 0.12,
    });

    const ironFixtureMat = new THREE.MeshStandardMaterial({
      color: 0x6a6a6a,
      map: ARENA_TEXTURES.gateIron,
      roughness: 0.3,
      metalness: 0.85,
    });

    const gateIronMat = new THREE.MeshStandardMaterial({
      color: 0x6a6a6a,
      map: ARENA_TEXTURES.gateIron,
      normalMap: ARENA_TEXTURES.gateIron._normalMap,
      normalScale: new THREE.Vector2(1.5, 1.5),
      roughness: 0.3,
      metalness: 0.9,
    });

    const darkIronMat = new THREE.MeshStandardMaterial({
      color: 0x555555,
      map: ARENA_TEXTURES.gateIron,
      roughness: 0.25,
      metalness: 0.95,
    });

    for (const cfg of gateConfigs) {
      const { sign, name } = cfg;
      const gateX = sign * WALL_RADIUS;
      const outX = sign;
      const cellCenterX = gateX + outX * (CELL_DEPTH / 2 + 1);

      const cellGroup = new THREE.Group();
      cellGroup.name = `StagingCell_${name}`;

      // ─── Floor with stone border ───
      const floorGeom = new THREE.BoxGeometry(CELL_DEPTH + 2, 0.4, CELL_WIDTH);
      const floor = new THREE.Mesh(floorGeom, cellFloorMat);
      floor.position.set(cellCenterX, -0.2, 0);
      floor.receiveShadow = true;
      cellGroup.add(floor);

      // Stone floor border trim (raised edge)
      const borderThick = 0.4;
      const trimH = 0.3;
      const trimY = trimH / 2;
      // Back border
      const backTrim = new THREE.Mesh(
        new THREE.BoxGeometry(borderThick, trimH, CELL_WIDTH + borderThick * 2),
        stoneTrimMat
      );
      backTrim.position.set(gateX + outX * (CELL_DEPTH + 1 + borderThick / 2), trimY, 0);
      cellGroup.add(backTrim);
      // Side borders
      for (const zSide of [-1, 1]) {
        const sideTrim = new THREE.Mesh(
          new THREE.BoxGeometry(CELL_DEPTH + 2 + borderThick, trimH, borderThick),
          stoneTrimMat
        );
        sideTrim.position.set(cellCenterX, trimY, zSide * (CELL_WIDTH / 2 + borderThick / 2));
        cellGroup.add(sideTrim);
      }

      // ─── Walls (shorter, no ceiling — open-top gladiator pen) ───
      // Back wall
      const backWall = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, WALL_H, CELL_WIDTH + 1),
        cellWallMat
      );
      backWall.position.set(gateX + outX * (CELL_DEPTH + 1.6), WALL_H / 2, 0);
      backWall.castShadow = true;
      backWall.receiveShadow = true;
      cellGroup.add(backWall);

      // Side walls
      for (const zSide of [-1, 1]) {
        const sideWall = new THREE.Mesh(
          new THREE.BoxGeometry(CELL_DEPTH + 2, WALL_H, 1.2),
          cellWallMat
        );
        sideWall.position.set(cellCenterX, WALL_H / 2, zSide * (CELL_WIDTH / 2 + 0.6));
        sideWall.castShadow = true;
        sideWall.receiveShadow = true;
        cellGroup.add(sideWall);
      }

      // ─── Wall-top crenellations ───
      for (const zSide of [-1, 1]) {
        for (let ci = 0; ci < 5; ci++) {
          const cx = gateX + outX * (2 + ci * 2.5);
          const cren = new THREE.Mesh(
            new THREE.BoxGeometry(1.0, 0.7, 1.4),
            stoneTrimMat
          );
          cren.position.set(cx, WALL_H + 0.35, zSide * (CELL_WIDTH / 2 + 0.6));
          cren.castShadow = true;
          cellGroup.add(cren);
        }
      }
      // Back wall crenellations
      for (let ci = -2; ci <= 2; ci++) {
        const cren = new THREE.Mesh(
          new THREE.BoxGeometry(1.4, 0.7, 1.0),
          stoneTrimMat
        );
        cren.position.set(gateX + outX * (CELL_DEPTH + 1.6), WALL_H + 0.35, ci * 2.2);
        cren.castShadow = true;
        cellGroup.add(cren);
      }

      // ─── Corner stone pillars ───
      const pillarR = 0.5;
      const pillarH = WALL_H + 1.5;
      const cornerPositions = [
        { x: gateX + outX * (CELL_DEPTH + 1.6), z: -(CELL_WIDTH / 2 + 0.6) },
        { x: gateX + outX * (CELL_DEPTH + 1.6), z:  (CELL_WIDTH / 2 + 0.6) },
        { x: gateX + outX * 0.5,                z: -(CELL_WIDTH / 2 + 0.6) },
        { x: gateX + outX * 0.5,                z:  (CELL_WIDTH / 2 + 0.6) },
      ];
      for (const cp of cornerPositions) {
        const pillar = new THREE.Mesh(
          new THREE.CylinderGeometry(pillarR, pillarR + 0.1, pillarH, 8),
          stoneTrimMat
        );
        pillar.position.set(cp.x, pillarH / 2, cp.z);
        pillar.castShadow = true;
        cellGroup.add(pillar);
        // Pillar cap
        const cap = new THREE.Mesh(
          new THREE.SphereGeometry(pillarR + 0.15, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
          stoneTrimMat
        );
        cap.position.set(cp.x, pillarH, cp.z);
        cellGroup.add(cap);
      }

      // ─── Wall-mounted torches (2 per side wall) ───
      for (const zSide of [-1, 1]) {
        for (let ti = 0; ti < 2; ti++) {
          const tx = gateX + outX * (3.5 + ti * 5.5);
          const wallZ = zSide * (CELL_WIDTH / 2 + 0.1);

          // Iron bracket (L-shaped)
          const bracketV = new THREE.Mesh(
            new THREE.BoxGeometry(0.12, 0.8, 0.12), ironFixtureMat
          );
          bracketV.position.set(tx, 3.0, wallZ);
          cellGroup.add(bracketV);
          const bracketH = new THREE.Mesh(
            new THREE.BoxGeometry(0.12, 0.12, 0.5), ironFixtureMat
          );
          bracketH.position.set(tx, 3.4, wallZ - zSide * 0.25);
          cellGroup.add(bracketH);

          // Torch head (cylinder)
          const torchHead = new THREE.Mesh(
            new THREE.CylinderGeometry(0.08, 0.06, 0.3, 6),
            new THREE.MeshStandardMaterial({ color: 0x7a5a3a, map: ARENA_TEXTURES.stagingWall, roughness: 0.9 })
          );
          torchHead.position.set(tx, 3.55, wallZ - zSide * 0.45);
          cellGroup.add(torchHead);

          // Flame glow (textured billboard)
          const flameGeom = new THREE.PlaneGeometry(0.5, 0.7);
          const flameMat = new THREE.MeshBasicMaterial({
            map: ARENA_TEXTURES.torchFlame,
            color: 0xffaa44,
            transparent: true,
            opacity: 0.9,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          });
          const flame = new THREE.Mesh(flameGeom, flameMat);
          flame.position.set(tx, 3.8, wallZ - zSide * 0.45);
          cellGroup.add(flame);

          // Point light
          const light = new THREE.PointLight(0xff8844, 1.2, 10, 2);
          light.position.set(tx, 3.8, wallZ - zSide * 0.45);
          cellGroup.add(light);
        }
      }

      // ─── Iron ring fixtures on back wall ───
      for (const ringZ of [-2, 0, 2]) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.2, 0.04, 8, 12),
          ironFixtureMat
        );
        ring.position.set(gateX + outX * (CELL_DEPTH + 1.0), 2.0, ringZ);
        ring.rotation.y = Math.PI / 2;
        cellGroup.add(ring);
        // Mounting plate
        const plate = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12, 0.12, 0.08, 8),
          ironFixtureMat
        );
        plate.position.set(gateX + outX * (CELL_DEPTH + 1.0), 2.2, ringZ);
        plate.rotation.z = Math.PI / 2;
        cellGroup.add(plate);
      }

      // ─── Hanging chains from back wall (dangling loose) ───
      for (const chainZ of [-3, 3]) {
        for (let link = 0; link < 5; link++) {
          const chain = new THREE.Mesh(
            new THREE.TorusGeometry(0.08, 0.025, 6, 8),
            ironFixtureMat
          );
          chain.position.set(
            gateX + outX * (CELL_DEPTH + 0.8),
            3.5 - link * 0.3,
            chainZ
          );
          chain.rotation.x = link % 2 === 0 ? 0 : Math.PI / 2;
          chain.rotation.y = Math.PI / 2;
          cellGroup.add(chain);
        }
      }

      this.group.add(cellGroup);

      // ═══════════════════════════════════════════════════════════
      // ─── Portcullis Gate (thick iron bars in stone archway) ───
      // ═══════════════════════════════════════════════════════════
      const gateGroup = new THREE.Group();
      gateGroup.name = `Gate_${name}`;

      // Thick vertical bars
      const BAR_R = 0.12;
      const BAR_GAP = 0.55;
      const barCount = Math.floor(GATE_WIDTH / BAR_GAP);
      for (let i = 0; i <= barCount; i++) {
        const offset = -GATE_WIDTH / 2 + i * BAR_GAP;
        const bar = new THREE.Mesh(
          new THREE.CylinderGeometry(BAR_R, BAR_R, GATE_HEIGHT, 8),
          gateIronMat
        );
        bar.position.set(gateX, GATE_HEIGHT / 2, offset);
        bar.castShadow = true;
        gateGroup.add(bar);
      }

      // Horizontal crossbars (4 — more substantial)
      for (let h = 0; h < 4; h++) {
        const y = 0.8 + h * (GATE_HEIGHT - 1.2) / 3;
        const cross = new THREE.Mesh(
          new THREE.CylinderGeometry(BAR_R * 0.8, BAR_R * 0.8, GATE_WIDTH + 0.2, 8),
          darkIronMat
        );
        cross.position.set(gateX, y, 0);
        cross.rotation.x = Math.PI / 2;
        cross.castShadow = true;
        gateGroup.add(cross);
      }

      // Bottom rail (thick bar along the ground)
      const bottomRail = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.25, GATE_WIDTH + 0.4),
        darkIronMat
      );
      bottomRail.position.set(gateX, 0.125, 0);
      gateGroup.add(bottomRail);

      // Spike tips on every bar
      for (let i = 0; i <= barCount; i++) {
        const offset = -GATE_WIDTH / 2 + i * BAR_GAP;
        const spike = new THREE.Mesh(
          new THREE.ConeGeometry(BAR_R * 2, 0.6, 6),
          darkIronMat
        );
        spike.position.set(gateX, GATE_HEIGHT + 0.3, offset);
        gateGroup.add(spike);
      }

      // Store animation data
      gateGroup._closedY = 0;
      gateGroup._openY = GATE_HEIGHT + 2;
      gateGroup._gateHeight = GATE_HEIGHT;

      this.group.add(gateGroup);
      this.gates.push(gateGroup);

      // ═══════════════════════════════════════════════
      // ─── Stone Archway Frame (static, not moving) ─
      // ═══════════════════════════════════════════════
      const archGroup = new THREE.Group();
      archGroup.name = `GateArch_${name}`;

      // Massive stone pillars flanking the gate
      for (const zSide of [-1, 1]) {
        // Main pillar body
        const pH = GATE_HEIGHT + 2.5;
        const pillar = new THREE.Mesh(
          new THREE.BoxGeometry(2.0, pH, 1.5),
          stoneTrimMat
        );
        pillar.position.set(gateX, pH / 2, zSide * (GATE_WIDTH / 2 + 0.75));
        pillar.castShadow = true;
        pillar.receiveShadow = true;
        archGroup.add(pillar);

        // Pillar base (wider)
        const base = new THREE.Mesh(
          new THREE.BoxGeometry(2.4, 0.5, 1.9),
          stoneTrimMat
        );
        base.position.set(gateX, 0.25, zSide * (GATE_WIDTH / 2 + 0.75));
        archGroup.add(base);

        // Pillar capital (wider top)
        const capital = new THREE.Mesh(
          new THREE.BoxGeometry(2.3, 0.4, 1.8),
          stoneTrimMat
        );
        capital.position.set(gateX, pH, zSide * (GATE_WIDTH / 2 + 0.75));
        archGroup.add(capital);

        // Skull ornament on pillar face (facing into cell)
        const skull = new THREE.Mesh(
          new THREE.SphereGeometry(0.25, 8, 6),
          new THREE.MeshStandardMaterial({ color: 0xb0a890, map: ARENA_TEXTURES.pillar, roughness: 0.8, metalness: 0.1 })
        );
        skull.position.set(gateX + outX * 1.0, GATE_HEIGHT * 0.7, zSide * (GATE_WIDTH / 2 + 0.75));
        skull.scale.set(1, 1.1, 0.7);
        archGroup.add(skull);
      }

      // Heavy stone lintel
      const lintel = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 1.5, GATE_WIDTH + 3),
        stoneTrimMat
      );
      lintel.position.set(gateX, GATE_HEIGHT + 1.75, 0);
      lintel.castShadow = true;
      lintel.receiveShadow = true;
      archGroup.add(lintel);

      // Decorative keystone (center of lintel, facing out)
      const keystone = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.8, 1.2),
        new THREE.MeshStandardMaterial({ color: 0x8a8a98, map: ARENA_TEXTURES.pillar, roughness: 0.7, metalness: 0.2 })
      );
      keystone.position.set(gateX + outX * 1.15, GATE_HEIGHT + 1.5, 0);
      archGroup.add(keystone);

      // Iron gate track grooves (visible slots where portcullis slides)
      for (const zSide of [-1, 1]) {
        const groove = new THREE.Mesh(
          new THREE.BoxGeometry(0.3, GATE_HEIGHT + 2, 0.15),
          darkIronMat
        );
        groove.position.set(gateX, (GATE_HEIGHT + 2) / 2, zSide * (GATE_WIDTH / 2 + 0.1));
        archGroup.add(groove);
      }

      this.group.add(archGroup);
    }
  }

  _animateGates(_dt) {
    if (!this._gateAnimating) return;

    const elapsed = performance.now() / 1000 - this._gateAnimStart;
    const duration = 2.5; // 2.5 second heavy gate open
    const t = Math.min(1, elapsed / duration);

    // Ease-out cubic for heavy gate feel
    const eased = 1 - Math.pow(1 - t, 3);

    for (const gate of this.gates) {
      gate.position.y = gate._closedY + (gate._openY - gate._closedY) * eased;
    }

    if (t >= 1) {
      this._gateAnimating = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Pillars with enhanced runic glow rings, base, capital, grooves
  // ---------------------------------------------------------------------------

  _buildPillars() {
    const pillarPositions = [
      { x: 20, z: 20 },
      { x: -20, z: 20 },
      { x: 20, z: -20 },
      { x: -20, z: -20 },
    ];

    const pillarMaterial = new THREE.MeshStandardMaterial({
      color: 0x8899aa,
      map: ARENA_TEXTURES.pillar,
      normalMap: ARENA_TEXTURES.pillar._normalMap,
      normalScale: new THREE.Vector2(2.0, 2.0),
      roughness: 0.8,
      metalness: 0.2,
    });

    const runeMaterial = new THREE.MeshStandardMaterial({
      color: 0x4400aa,
      emissive: 0x6622cc,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });

    const capitalMaterial = new THREE.MeshStandardMaterial({
      color: 0x8899aa,
      map: ARENA_TEXTURES.pillar,
      roughness: 0.7,
      metalness: 0.3,
    });

    const grooveMaterial = new THREE.MeshStandardMaterial({
      color: 0x6a6a7a,
      map: ARENA_TEXTURES.pillar,
      roughness: 0.9,
      metalness: 0.1,
    });

    for (const pos of pillarPositions) {
      // --- Wider base cylinder ---
      const wideBaseGeom = new THREE.CylinderGeometry(2.5, 2.8, 0.5, 16);
      const wideBase = new THREE.Mesh(wideBaseGeom, pillarMaterial);
      wideBase.position.set(pos.x, 0.25, pos.z);
      wideBase.castShadow = true;
      wideBase.receiveShadow = true;
      wideBase.name = `PillarWideBase_${pos.x}_${pos.z}`;
      this.group.add(wideBase);

      // Pillar base (narrower, on top of wide base)
      const baseGeom = new THREE.CylinderGeometry(2, 2, 0.3, 16);
      const base = new THREE.Mesh(baseGeom, pillarMaterial);
      base.position.set(pos.x, 0.65, pos.z);
      base.castShadow = true;
      base.receiveShadow = true;
      base.name = `PillarBase_${pos.x}_${pos.z}`;
      this.group.add(base);

      // Pillar cylinder — collision mesh
      const pillarGeom = new THREE.CylinderGeometry(1.5, 1.5, 8, 8);
      const pillar = new THREE.Mesh(pillarGeom, pillarMaterial);
      pillar.position.set(pos.x, 4, pos.z);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      pillar.name = `Pillar_${pos.x}_${pos.z}`;
      this.group.add(pillar);

      // --- Capital: wider cylinder + torus at top ---
      const capitalCylGeom = new THREE.CylinderGeometry(2.0, 1.8, 0.4, 16);
      const capitalCyl = new THREE.Mesh(capitalCylGeom, capitalMaterial);
      capitalCyl.position.set(pos.x, 8.2, pos.z);
      capitalCyl.castShadow = true;
      capitalCyl.receiveShadow = true;
      capitalCyl.name = `PillarCapital_${pos.x}_${pos.z}`;
      this.group.add(capitalCyl);

      const capitalTorusGeom = new THREE.TorusGeometry(2.0, 0.15, 8, 24);
      const capitalTorus = new THREE.Mesh(capitalTorusGeom, capitalMaterial);
      capitalTorus.position.set(pos.x, 8.4, pos.z);
      capitalTorus.rotation.x = Math.PI / 2;
      capitalTorus.castShadow = true;
      capitalTorus.name = `PillarCapitalTorus_${pos.x}_${pos.z}`;
      this.group.add(capitalTorus);

      // --- Pillar surface groove: thin torus ring at mid-height ---
      const grooveGeom = new THREE.TorusGeometry(1.55, 0.08, 8, 24);
      const groove = new THREE.Mesh(grooveGeom, grooveMaterial);
      groove.position.set(pos.x, 4.0, pos.z);
      groove.rotation.x = Math.PI / 2;
      groove.name = `PillarGroove_${pos.x}_${pos.z}`;
      this.group.add(groove);

      // --- Enhanced runic glow rings: larger, with counter-rotating pair ---
      const ringHeights = [1.5, 4, 6.5];
      for (const h of ringHeights) {
        // Primary ring (larger)
        const ringGeom = new THREE.TorusGeometry(2.0, 0.08, 8, 32);
        const ring = new THREE.Mesh(ringGeom, runeMaterial.clone());
        ring.position.set(pos.x, h, pos.z);
        ring.rotation.x = Math.PI / 2; // lay flat around the pillar
        ring.name = `RuneRing_${pos.x}_${pos.z}_h${h}`;
        ring.userData.rotationDir = 1;
        this.runicRings.push(ring);
        this.group.add(ring);

        // Secondary counter-rotating ring
        const ring2Geom = new THREE.TorusGeometry(2.2, 0.05, 8, 32);
        const ring2Mat = runeMaterial.clone();
        ring2Mat.emissiveIntensity = 0.4;
        ring2Mat.opacity = 0.6;
        const ring2 = new THREE.Mesh(ring2Geom, ring2Mat);
        ring2.position.set(pos.x, h, pos.z);
        ring2.rotation.x = Math.PI / 2;
        ring2.name = `RuneRing2_${pos.x}_${pos.z}_h${h}`;
        ring2.userData.rotationDir = -1;
        this.runicRings.push(ring2);
        this.group.add(ring2);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Blood stains
  // ---------------------------------------------------------------------------

  _buildBloodStains() {
    const STAIN_COUNT = 12;
    const ARENA_RADIUS = 35; // keep inside the walls

    const bloodMaterial = new THREE.MeshBasicMaterial({
      color: 0x660000,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    for (let i = 0; i < STAIN_COUNT; i++) {
      const radius = 0.5 + Math.random() * 1.5; // 0.5 - 2.0
      const geometry = new THREE.CircleGeometry(radius, 16);
      const stain = new THREE.Mesh(geometry, bloodMaterial.clone());

      // Random position within arena bounds (polar coords to stay circular)
      const r = Math.random() * ARENA_RADIUS;
      const theta = Math.random() * Math.PI * 2;

      stain.position.set(
        Math.cos(theta) * r,
        0.02, // just above the floor surface
        Math.sin(theta) * r,
      );
      stain.rotation.x = -Math.PI / 2; // lay flat
      stain.name = `BloodStain_${i}`;

      this.group.add(stain);
    }
  }

  // ---------------------------------------------------------------------------
  // Ambient particles (dust / embers)
  // ---------------------------------------------------------------------------

  _buildParticles() {
    const PARTICLE_COUNT = 80;
    const ARENA_RADIUS = 38;
    const MAX_HEIGHT = 20;

    const positions = new Float32Array(PARTICLE_COUNT * 3);
    this.particleVelocities = new Float32Array(PARTICLE_COUNT);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const r = Math.random() * ARENA_RADIUS;
      const theta = Math.random() * Math.PI * 2;

      positions[i * 3] = Math.cos(theta) * r;           // x
      positions[i * 3 + 1] = Math.random() * MAX_HEIGHT; // y
      positions[i * 3 + 2] = Math.sin(theta) * r;       // z

      // Individual upward speed (units / second)
      this.particleVelocities[i] = 0.3 + Math.random() * 0.7;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0xff4400,
      size: 0.2,
      transparent: true,
      opacity: 0.7,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.particles = new THREE.Points(geometry, material);
    this.particles.name = 'AmbientParticles';

    this.group.add(this.particles);
  }

  // ---------------------------------------------------------------------------
  // Torch flames (emissive sprites + multiple bobbing spheres per torch)
  // ---------------------------------------------------------------------------

  _buildTorches() {
    const torchPositions = [
      new THREE.Vector3(38, 4, 0),
      new THREE.Vector3(-38, 4, 0),
      new THREE.Vector3(0, 4, 38),
      new THREE.Vector3(0, 4, -38),
    ];

    const flameTex = ARENA_TEXTURES.torchFlame;

    for (const pos of torchPositions) {
      // Textured flame billboard
      const flameGeom = new THREE.PlaneGeometry(1.4, 2.0);
      const flameMat = new THREE.MeshBasicMaterial({
        map: flameTex,
        color: 0xffaa44,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const flame = new THREE.Mesh(flameGeom, flameMat);
      flame.position.copy(pos);
      flame.name = 'TorchFlame';

      this.torchFlameSprites.push(flame);
      this.group.add(flame);

      // Point light for each arena wall torch
      const light = new THREE.PointLight(0xff8844, 2.0, 18, 2);
      light.position.copy(pos);
      this.torchLights.push(light);
      this.torchBaseLightIntensities.push(2.0);
      this.group.add(light);

      // 2-3 small textured flame wisps per torch for dynamic fire look
      const sphereCount = 2 + Math.floor(Math.random() * 2);
      const wispColors = [0xff6600, 0xffaa22, 0xff4400];

      for (let s = 0; s < sphereCount; s++) {
        const wispGeom = new THREE.PlaneGeometry(0.4 + Math.random() * 0.2, 0.5 + Math.random() * 0.3);
        const wispMat = new THREE.MeshBasicMaterial({
          map: flameTex,
          color: wispColors[s % wispColors.length],
          transparent: true,
          opacity: 0.75,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const wisp = new THREE.Mesh(wispGeom, wispMat);
        wisp.position.set(
          pos.x + (Math.random() - 0.5) * 0.3,
          pos.y + Math.random() * 0.4,
          pos.z + (Math.random() - 0.5) * 0.3,
        );
        wisp.name = 'TorchFlameSphere';
        wisp.userData.baseY = wisp.position.y;
        wisp.userData.bobPhase = Math.random() * Math.PI * 2;
        wisp.userData.bobSpeed = 2.0 + Math.random() * 2.0;
        wisp.userData.bobAmplitude = 0.1 + Math.random() * 0.15;

        this.torchFlameSpheres.push(wisp);
        this.group.add(wisp);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Floating embers — small orange spheres drifting upward from torch positions
  // ---------------------------------------------------------------------------

  _buildFloatingEmbers() {
    const torchPositions = [
      new THREE.Vector3(38, 4, 0),
      new THREE.Vector3(-38, 4, 0),
      new THREE.Vector3(0, 4, 38),
      new THREE.Vector3(0, 4, -38),
    ];

    const EMBERS_PER_TORCH = 3; // 12 total across 4 torches
    const extraEmbers = 3; // 3 extra for 15 total

    const emberMaterial = new THREE.MeshBasicMaterial({
      color: 0xff6622,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    // Embers distributed across torch positions
    for (let t = 0; t < torchPositions.length; t++) {
      const tp = torchPositions[t];
      const count = EMBERS_PER_TORCH + (t < extraEmbers ? 1 : 0);

      for (let e = 0; e < count; e++) {
        const geom = new THREE.SphereGeometry(0.06 + Math.random() * 0.04, 6, 6);
        const ember = new THREE.Mesh(geom, emberMaterial.clone());

        ember.position.set(
          tp.x + (Math.random() - 0.5) * 1.5,
          tp.y + Math.random() * 5.0,
          tp.z + (Math.random() - 0.5) * 1.5,
        );
        ember.name = 'FloatingEmber';

        // Store origin torch position and movement parameters
        ember.userData.torchX = tp.x;
        ember.userData.torchY = tp.y;
        ember.userData.torchZ = tp.z;
        ember.userData.riseSpeed = 0.8 + Math.random() * 1.2;
        ember.userData.driftPhase = Math.random() * Math.PI * 2;
        ember.userData.maxHeight = tp.y + 12 + Math.random() * 5;

        this.floatingEmbers.push(ember);
        this.group.add(ember);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Central arena emblem — 3 nested rings with dark red/gold emissive glow
  // ---------------------------------------------------------------------------

  _buildArenaEmblem() {
    const ringConfigs = [
      { innerR: 2.8, outerR: 3.2, color: 0x881122, emissive: 0xaa2244, intensity: 0.8 },
      { innerR: 4.8, outerR: 5.2, color: 0x886622, emissive: 0xccaa44, intensity: 0.7 },
      { innerR: 6.8, outerR: 7.1, color: 0x881122, emissive: 0xaa2244, intensity: 0.6 },
    ];

    for (let i = 0; i < ringConfigs.length; i++) {
      const cfg = ringConfigs[i];
      const emblemMaterial = new THREE.MeshStandardMaterial({
        color: cfg.color,
        emissive: cfg.emissive,
        emissiveIntensity: cfg.intensity,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
      });

      const ringGeom = new THREE.RingGeometry(cfg.innerR, cfg.outerR, 64);
      const ring = new THREE.Mesh(ringGeom, emblemMaterial);
      ring.position.y = 0.02;
      ring.rotation.x = -Math.PI / 2; // lay flat

      // Alternate rotation directions: ring 0 CW, ring 1 CCW, ring 2 CW
      ring.userData.rotationSpeed = (i % 2 === 0 ? 1 : -1) * (0.08 + i * 0.03);
      ring.name = `ArenaEmblem_Ring${i}`;
      this.emblemRings.push(ring);
      this.group.add(ring);
    }
  }

  // ---------------------------------------------------------------------------
  // Ground fog — more planes with scale oscillation support
  // ---------------------------------------------------------------------------

  _buildGroundFog() {
    const FOG_COUNT = 25;
    const ARENA_RADIUS = 35;

    const fogMaterial = new THREE.MeshBasicMaterial({
      color: 0x1a2030,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    for (let i = 0; i < FOG_COUNT; i++) {
      const size = 6 + Math.random() * 6; // 6-12 unit planes
      const geometry = new THREE.PlaneGeometry(size, size);
      const plane = new THREE.Mesh(geometry, fogMaterial.clone());

      // Random position within arena bounds
      const r = Math.random() * ARENA_RADIUS;
      const theta = Math.random() * Math.PI * 2;

      plane.position.set(
        Math.cos(theta) * r,
        0.3 + Math.random() * 0.5, // y between 0.3 and 0.8
        Math.sin(theta) * r,
      );
      plane.rotation.x = -Math.PI / 2; // lay flat
      plane.rotation.z = Math.random() * Math.PI * 2; // random spin

      // Store base scale for oscillation
      plane.userData.baseScale = 1.0;
      plane.userData.scalePhase = Math.random() * Math.PI * 2;
      plane.name = `FogPlane_${i}`;

      this.fogPlanes.push(plane);
      this.group.add(plane);
    }
  }

  // ---------------------------------------------------------------------------
  // Sky dome — gradient from near-black at top to dark blue at horizon
  // ---------------------------------------------------------------------------

  _buildSkyDome() {
    const geometry = new THREE.SphereGeometry(200, 32, 32);

    const material = new THREE.MeshBasicMaterial({
      map: ARENA_TEXTURES.sky,
      side: THREE.BackSide,
    });

    const skyDome = new THREE.Mesh(geometry, material);
    skyDome.name = 'SkyDome';

    this.group.add(skyDome);
  }

  // ---------------------------------------------------------------------------
  // Per-frame animation
  // ---------------------------------------------------------------------------

  /**
   * Float particles upward and recycle them when they exceed max height.
   * @param {number} dt - delta time in seconds.
   */
  _animateParticles(dt) {
    if (!this.particles) return;

    const MAX_HEIGHT = 20;
    const ARENA_RADIUS = 38;

    const posAttr = this.particles.geometry.getAttribute('position');
    const arr = posAttr.array;

    for (let i = 0; i < posAttr.count; i++) {
      // Move upward
      arr[i * 3 + 1] += this.particleVelocities[i] * dt;

      // Slight horizontal drift using deterministic sin-wave (avoids per-frame Math.random)
      const phase = i * 1.618;
      arr[i * 3] += Math.sin(arr[i * 3 + 1] * 0.5 + phase) * 0.015 * dt;
      arr[i * 3 + 2] += Math.cos(arr[i * 3 + 1] * 0.5 + phase) * 0.015 * dt;

      // Reset when too high
      if (arr[i * 3 + 1] > MAX_HEIGHT) {
        const r = Math.random() * ARENA_RADIUS;
        const theta = Math.random() * Math.PI * 2;
        arr[i * 3] = Math.cos(theta) * r;
        arr[i * 3 + 1] = 0;
        arr[i * 3 + 2] = Math.sin(theta) * r;
      }
    }

    posAttr.needsUpdate = true;
  }

  /**
   * Slightly randomise torch light intensity each frame for a flicker effect,
   * and orient flame sprites toward the camera (billboarding is handled
   * externally if needed, but we oscillate scale here).
   * @param {number} _dt - delta time in seconds.
   */
  _animateTorches(_dt) {
    for (let i = 0; i < this.torchLights.length; i++) {
      const base = this.torchBaseLightIntensities[i];
      // Flicker: random deviation of up to +/- 20 %
      this.torchLights[i].intensity = base + (Math.random() - 0.5) * base * 0.4;

      // Subtle flame scale oscillation
      const flame = this.torchFlameSprites[i];
      if (flame) {
        const scaleY = 1.0 + (Math.random() - 0.5) * 0.2;
        flame.scale.set(1, scaleY, 1);
      }
    }

    // Also oscillate flame sprites that don't have paired torchLights
    for (let i = this.torchLights.length; i < this.torchFlameSprites.length; i++) {
      const flame = this.torchFlameSprites[i];
      if (flame) {
        const scaleY = 1.0 + (Math.random() - 0.5) * 0.2;
        flame.scale.set(1, scaleY, 1);
      }
    }
  }

  /**
   * Pulse runic ring emissive intensity using a sin wave for a breathing glow,
   * and rotate rings based on their direction userData.
   * @param {number} dt - delta time in seconds.
   */
  _animateRunicRings(dt) {
    const time = performance.now() * 0.001; // seconds
    for (let i = 0; i < this.runicRings.length; i++) {
      const ring = this.runicRings[i];
      // Phase-offset each ring so they don't all pulse in unison
      const phase = i * 0.8;
      ring.material.emissiveIntensity = 0.4 + 0.4 * Math.sin(time * 2.0 + phase);

      // Rotate ring around its local Y axis (which is the pillar's vertical axis
      // since the ring's x-rotation is PI/2)
      const dir = ring.userData.rotationDir || 1;
      ring.rotation.z += dir * 0.3 * dt;
    }
  }

  /**
   * Slowly drift fog planes, oscillate their opacity and scale for an ethereal ground haze.
   * @param {number} dt - delta time in seconds.
   */
  _animateGroundFog(dt) {
    const time = performance.now() * 0.001; // seconds
    for (let i = 0; i < this.fogPlanes.length; i++) {
      const plane = this.fogPlanes[i];

      // Slow drift
      const phase = i * 1.3;
      plane.position.x += Math.sin(time * 0.3 + phase) * 0.2 * dt;
      plane.position.z += Math.cos(time * 0.3 + phase) * 0.2 * dt;

      // Gentle rotation
      plane.rotation.z += 0.02 * dt;

      // Oscillate opacity between 0.05 and 0.20
      plane.material.opacity = 0.125 + 0.075 * Math.sin(time * 0.5 + phase);

      // Subtle scale oscillation
      const scalePhase = plane.userData.scalePhase || 0;
      const scaleVal = 1.0 + 0.1 * Math.sin(time * 0.4 + scalePhase);
      plane.scale.set(scaleVal, scaleVal, 1);
    }
  }

  /**
   * Rotate central arena emblem rings with counter-rotation.
   * @param {number} dt - delta time in seconds.
   */
  _animateEmblemRings(dt) {
    for (const ring of this.emblemRings) {
      const speed = ring.userData.rotationSpeed || 0.1;
      ring.rotation.z += speed * dt;
    }
  }

  /**
   * Bobbing animation for torch flame spheres.
   * @param {number} _dt - delta time in seconds.
   */
  _animateTorchFlameSpheres(_dt) {
    const time = performance.now() * 0.001;
    for (const sphere of this.torchFlameSpheres) {
      const { baseY, bobPhase, bobSpeed, bobAmplitude } = sphere.userData;
      sphere.position.y = baseY + Math.sin(time * bobSpeed + bobPhase) * bobAmplitude;

      // Subtle opacity flicker
      sphere.material.opacity = 0.6 + 0.3 * Math.sin(time * bobSpeed * 1.5 + bobPhase);
    }
  }

  /**
   * Floating embers rise from torch positions and recycle when too high.
   * @param {number} dt - delta time in seconds.
   */
  _animateFloatingEmbers(dt) {
    const time = performance.now() * 0.001;
    for (const ember of this.floatingEmbers) {
      const { torchX, torchY, torchZ, riseSpeed, driftPhase, maxHeight } = ember.userData;

      // Rise upward
      ember.position.y += riseSpeed * dt;

      // Horizontal drift
      ember.position.x += Math.sin(time * 0.8 + driftPhase) * 0.3 * dt;
      ember.position.z += Math.cos(time * 0.6 + driftPhase) * 0.3 * dt;

      // Fade out as it rises
      const heightRatio = (ember.position.y - torchY) / (maxHeight - torchY);
      ember.material.opacity = Math.max(0, 0.9 * (1.0 - heightRatio));

      // Recycle when too high
      if (ember.position.y > maxHeight) {
        ember.position.set(
          torchX + (Math.random() - 0.5) * 1.5,
          torchY,
          torchZ + (Math.random() - 0.5) * 1.5,
        );
        ember.material.opacity = 0.9;
      }
    }
  }
}
