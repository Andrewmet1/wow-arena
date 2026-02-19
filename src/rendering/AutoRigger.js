/**
 * AutoRigger — Full humanoid auto-rigging for static Meshy.ai meshes.
 *
 * Takes a static mesh Group → normalizes geometry to match the procedural
 * skeleton's coordinate space → produces a rigged SkinnedMesh with 23
 * anatomically correct bones.
 *
 * Bone hierarchy (compatible with CharacterRenderer animation targets):
 *
 *   rootBone
 *   ├── hips                          ← hip sway / pelvis rotation
 *   │   ├── spine                     ← lower back / waist twist
 *   │   └── legs                      ← leg group (compat with procedural model)
 *   │       ├── leftLeg               ← upper leg / thigh
 *   │       │   └── leftLowerLeg      ← knee
 *   │       │       └── leftFoot      ← ankle
 *   │       │           └── leftToe   ← toe
 *   │       └── rightLeg
 *   │           └── rightLowerLeg
 *   │               └── rightFoot
 *   │                   └── rightToe
 *   └── body                          ← torso / chest (y=1.0)
 *       ├── neck                      ← neck rotation
 *       │   └── head                  ← head look/nod
 *       ├── leftShoulder              ← shoulder shrug
 *       │   └── leftArm               ← upper arm
 *       │       └── leftForearm       ← elbow
 *       │           └── leftHand      ← wrist / weapon attach
 *       └── rightShoulder
 *           └── rightArm
 *               └── rightForearm
 *                   └── rightHand     ← weapon attach
 */

import * as THREE from 'three';
import { getRigConfig } from './AssetManifest.js';

// ─── Bone indices (order = skinIndex buffer order) ──────────────────────────
export const BONE = {
  ROOT: 0,
  HIPS: 1,
  SPINE: 2,
  LEGS: 3,
  LEFT_UPPER_LEG: 4,
  LEFT_LOWER_LEG: 5,
  LEFT_FOOT: 6,
  LEFT_TOE: 7,
  RIGHT_UPPER_LEG: 8,
  RIGHT_LOWER_LEG: 9,
  RIGHT_FOOT: 10,
  RIGHT_TOE: 11,
  BODY: 12,
  NECK: 13,
  HEAD: 14,
  LEFT_SHOULDER: 15,
  LEFT_UPPER_ARM: 16,
  LEFT_FOREARM: 17,
  LEFT_HAND: 18,
  RIGHT_SHOULDER: 19,
  RIGHT_UPPER_ARM: 20,
  RIGHT_FOREARM: 21,
  RIGHT_HAND: 22,
};

export const BONE_COUNT = 23;

// Target height for normalized model space — matches procedural buildBaseSkeleton()
const TARGET_HEIGHT = 1.8;

// Per-bone colors for weight visualization (exported for viewer)
export const BONE_COLORS = [
  '#888888', // ROOT
  '#FF6600', // HIPS
  '#FF9900', // SPINE
  '#884400', // LEGS (group)
  '#2266FF', // LEFT_UPPER_LEG
  '#0044CC', // LEFT_LOWER_LEG
  '#003399', // LEFT_FOOT
  '#002266', // LEFT_TOE
  '#FF2266', // RIGHT_UPPER_LEG
  '#CC0044', // RIGHT_LOWER_LEG
  '#990033', // RIGHT_FOOT
  '#660022', // RIGHT_TOE
  '#44CC44', // BODY
  '#FFCC00', // NECK
  '#FFFF44', // HEAD
  '#44FFCC', // LEFT_SHOULDER
  '#22CCAA', // LEFT_UPPER_ARM
  '#119988', // LEFT_FOREARM
  '#007766', // LEFT_HAND
  '#CC44FF', // RIGHT_SHOULDER
  '#AA22CC', // RIGHT_UPPER_ARM
  '#881199', // RIGHT_FOREARM
  '#660088', // RIGHT_HAND
];

// Bone display names for UI
export const BONE_NAMES = [
  'Root', 'Hips', 'Spine', 'Legs',
  'L.Thigh', 'L.Knee', 'L.Foot', 'L.Toe',
  'R.Thigh', 'R.Knee', 'R.Foot', 'R.Toe',
  'Body', 'Neck', 'Head',
  'L.Shoulder', 'L.UpperArm', 'L.Forearm', 'L.Hand',
  'R.Shoulder', 'R.UpperArm', 'R.Forearm', 'R.Hand',
];

/**
 * Create the full 23-bone skeleton hierarchy.
 * Positions are in the standard coordinate space (height ≈ 1.8, feet at y ≈ 0).
 * Bone names match CharacterRenderer's getObjectByName() expectations.
 */
export function createSkeleton() {
  const bones = [];
  const bonesByName = new Map();

  function makeBone(name, parent, x, y, z) {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(x, y, z);
    if (parent) parent.add(bone);
    bones.push(bone);
    bonesByName.set(name, bone);
    return bone;
  }

  // Root at origin
  const rootBone = makeBone('rootBone', null, 0, 0, 0);

  // ── Lower body ──
  const hips     = makeBone('hips', rootBone, 0, 0.40, 0);
  const spine    = makeBone('spine', hips, 0, 0.15, 0);       // world: (0, 0.55)
  const legs     = makeBone('legs', hips, 0, -0.10, 0);       // world: (0, 0.30) — compat group

  // Left leg chain
  const leftLeg      = makeBone('leftLeg', legs, -0.18, 0, 0);      // world: (-0.18, 0.30)
  const leftLowerLeg = makeBone('leftLowerLeg', leftLeg, 0, -0.18, 0);  // world: (-0.18, 0.12)
  const leftFoot     = makeBone('leftFoot', leftLowerLeg, 0, -0.12, 0.02); // world: (-0.18, 0.00)
  const leftToe      = makeBone('leftToe', leftFoot, 0, -0.01, 0.05);

  // Right leg chain
  const rightLeg      = makeBone('rightLeg', legs, 0.18, 0, 0);
  const rightLowerLeg = makeBone('rightLowerLeg', rightLeg, 0, -0.18, 0);
  const rightFoot     = makeBone('rightFoot', rightLowerLeg, 0, -0.12, 0.02);
  const rightToe      = makeBone('rightToe', rightFoot, 0, -0.01, 0.05);

  // ── Upper body ──
  const body = makeBone('body', rootBone, 0, 1.0, 0);

  // Neck → Head
  const neck = makeBone('neck', body, 0, 0.45, 0);           // world: (0, 1.45)
  const head = makeBone('head', neck, 0, 0.17, 0);           // world: (0, 1.62)

  // Left arm chain: shoulder → upper arm → forearm → hand
  const leftShoulder = makeBone('leftShoulder', body, -0.22, 0.12, 0);  // world: (-0.22, 1.12)
  const leftArm      = makeBone('leftArm', leftShoulder, -0.28, -0.02, 0); // world: (-0.50, 1.10)
  const leftForearm  = makeBone('leftForearm', leftArm, -0.22, 0, 0);      // world: (-0.72, 1.10)
  const leftHand     = makeBone('leftHand', leftForearm, -0.18, 0, 0);     // world: (-0.90, 1.10)

  // Right arm chain
  const rightShoulder = makeBone('rightShoulder', body, 0.22, 0.12, 0);
  const rightArm      = makeBone('rightArm', rightShoulder, 0.28, -0.02, 0);
  const rightForearm  = makeBone('rightForearm', rightArm, 0.22, 0, 0);
  const rightHand     = makeBone('rightHand', rightForearm, 0.18, 0, 0);

  return { rootBone, bones, bonesByName };
}

// ─── Smoothstep helper ──────────────────────────────────────────────────────
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Classify a vertex into bone zones for a T-pose humanoid model.
 *
 * @param {number} px - proportional X (vertex x / TARGET_HEIGHT), centered at 0
 * @param {number} py - proportional Y (0 = feet, 1 = top of head)
 * @param {number} pz - proportional Z
 * @param {object} cfg - rig config thresholds
 * @returns {{ indices: number[], weights: number[] }} exactly 4 influences
 */
function classifyVertex(px, py, pz, cfg) {
  const {
    // Y-axis thresholds (proportional 0-1)
    toeY       = 0.02,
    footY      = 0.06,
    kneeY      = 0.20,
    thighY     = 0.35,
    hipY       = 0.42,
    waistY     = 0.50,
    chestY     = 0.58,
    shoulderY  = 0.62,
    neckY      = 0.82,
    headY      = 0.88,
    // X-axis thresholds for arm detection (proportional)
    armStartX  = 0.13,
    shoulderX  = 0.20,
    elbowX     = 0.30,
    wristX     = 0.40,
    // Blending
    blendMargin = 0.04,
  } = cfg;

  const influences = [];
  const absX = Math.abs(px);
  const isLeft = px < 0;

  function add(boneIdx, weight) {
    if (weight > 0.001) influences.push({ bone: boneIdx, weight });
  }

  // ── HEAD (above headY) ──
  if (py > headY - blendMargin) {
    const hw = smoothstep(headY - blendMargin, headY + blendMargin, py);
    add(BONE.HEAD, hw);
    if (hw < 1) add(BONE.NECK, 1 - hw);
  }
  // ── NECK (neckY to headY) ──
  else if (py > neckY - blendMargin) {
    const nw = smoothstep(neckY - blendMargin, neckY + blendMargin, py);
    add(BONE.NECK, nw);
    if (nw < 1) {
      // Check if this is arm or body
      if (absX > armStartX + blendMargin) {
        add(isLeft ? BONE.LEFT_SHOULDER : BONE.RIGHT_SHOULDER, (1 - nw) * 0.5);
        add(BONE.BODY, (1 - nw) * 0.5);
      } else {
        add(BONE.BODY, 1 - nw);
      }
    }
  }
  // ── SHOULDER & ARM ZONE (shoulderY to neckY) ──
  else if (py > shoulderY - blendMargin && absX > armStartX - blendMargin) {
    const armBlend = smoothstep(armStartX - blendMargin, armStartX + blendMargin, absX);

    if (armBlend > 0.01) {
      // T-pose: classify along X-axis (further from center = further down the arm)
      if (absX < shoulderX) {
        add(isLeft ? BONE.LEFT_SHOULDER : BONE.RIGHT_SHOULDER, armBlend);
      } else if (absX < elbowX) {
        const t = smoothstep(shoulderX, elbowX, absX);
        add(isLeft ? BONE.LEFT_UPPER_ARM : BONE.RIGHT_UPPER_ARM, armBlend * (1 - t * 0.3));
        add(isLeft ? BONE.LEFT_SHOULDER : BONE.RIGHT_SHOULDER, armBlend * t * 0.3);
      } else if (absX < wristX) {
        add(isLeft ? BONE.LEFT_FOREARM : BONE.RIGHT_FOREARM, armBlend);
      } else {
        add(isLeft ? BONE.LEFT_HAND : BONE.RIGHT_HAND, armBlend);
      }
    }
    // Body bleed for torso-adjacent vertices
    if (armBlend < 1) {
      add(BONE.BODY, 1 - armBlend);
    }
  }
  // ── UPPER TORSO (chestY to shoulderY) — pure body ──
  else if (py > chestY - blendMargin) {
    // Check for arms extending down (T-pose arms may dip slightly)
    if (absX > armStartX + blendMargin * 2 && py > chestY) {
      const armBlend = smoothstep(armStartX + blendMargin, armStartX + blendMargin * 3, absX);
      if (absX < elbowX) {
        add(isLeft ? BONE.LEFT_UPPER_ARM : BONE.RIGHT_UPPER_ARM, armBlend);
      } else if (absX < wristX) {
        add(isLeft ? BONE.LEFT_FOREARM : BONE.RIGHT_FOREARM, armBlend);
      } else {
        add(isLeft ? BONE.LEFT_HAND : BONE.RIGHT_HAND, armBlend);
      }
      if (armBlend < 1) add(BONE.BODY, 1 - armBlend);
    } else {
      add(BONE.BODY, 1);
    }
  }
  // ── WAIST (waistY to chestY) — body blending into spine ──
  else if (py > waistY - blendMargin) {
    const spineBlend = smoothstep(chestY, waistY, py); // more spine as we go down
    add(BONE.BODY, 1 - spineBlend * 0.6);
    add(BONE.SPINE, spineBlend * 0.6);
  }
  // ── HIP ZONE (hipY to waistY) — spine/hips blend ──
  else if (py > hipY - blendMargin) {
    const hipBlend = smoothstep(waistY, hipY, py);
    add(BONE.SPINE, (1 - hipBlend) * 0.5);
    add(BONE.HIPS, 0.5 + hipBlend * 0.5);
  }
  // ── UPPER LEG / THIGH (thighY to hipY) ──
  else if (py > thighY - blendMargin) {
    const legBlend = smoothstep(hipY + blendMargin, hipY - blendMargin, py);
    const side = isLeft ? BONE.LEFT_UPPER_LEG : BONE.RIGHT_UPPER_LEG;
    add(side, legBlend);
    if (legBlend < 1) add(BONE.HIPS, 1 - legBlend);
  }
  // ── KNEE / LOWER LEG (kneeY to thighY) ──
  else if (py > kneeY - blendMargin) {
    const kneeBlend = smoothstep(thighY + blendMargin, thighY - blendMargin, py);
    const upperSide = isLeft ? BONE.LEFT_UPPER_LEG : BONE.RIGHT_UPPER_LEG;
    const lowerSide = isLeft ? BONE.LEFT_LOWER_LEG : BONE.RIGHT_LOWER_LEG;
    add(lowerSide, kneeBlend);
    if (kneeBlend < 1) add(upperSide, 1 - kneeBlend);
  }
  // ── FOOT (footY to kneeY) ──
  else if (py > footY - blendMargin) {
    const footBlend = smoothstep(kneeY + blendMargin, kneeY - blendMargin, py);
    const lowerSide = isLeft ? BONE.LEFT_LOWER_LEG : BONE.RIGHT_LOWER_LEG;
    const footSide = isLeft ? BONE.LEFT_FOOT : BONE.RIGHT_FOOT;
    add(footSide, footBlend);
    if (footBlend < 1) add(lowerSide, 1 - footBlend);
  }
  // ── TOE (below footY) ──
  else if (py > toeY - blendMargin) {
    const toeBlend = smoothstep(footY + blendMargin, footY - blendMargin, py);
    const footSide = isLeft ? BONE.LEFT_FOOT : BONE.RIGHT_FOOT;
    const toeSide = isLeft ? BONE.LEFT_TOE : BONE.RIGHT_TOE;
    add(toeSide, toeBlend);
    if (toeBlend < 1) add(footSide, 1 - toeBlend);
  }
  // ── VERY BOTTOM (below toeY) ──
  else {
    add(isLeft ? BONE.LEFT_TOE : BONE.RIGHT_TOE, 1);
  }

  // Fallback
  if (influences.length === 0) {
    influences.push({ bone: BONE.BODY, weight: 1 });
  }

  // Normalize, sort by weight desc, take top 4, re-normalize
  let total = influences.reduce((s, i) => s + i.weight, 0);
  for (const inf of influences) inf.weight /= total;

  influences.sort((a, b) => b.weight - a.weight);
  const top4 = influences.slice(0, 4);
  while (top4.length < 4) top4.push({ bone: 0, weight: 0 });

  total = top4.reduce((s, i) => s + i.weight, 0);
  if (total > 0) for (const inf of top4) inf.weight /= total;

  return {
    indices: top4.map(i => i.bone),
    weights: top4.map(i => i.weight),
  };
}

/**
 * Auto-rig a static mesh Group into a SkinnedMesh with full bone hierarchy.
 *
 * Normalizes the model geometry to match the procedural skeleton coordinate space
 * (height ≈ 1.8, feet at y ≈ 0, centered on X/Z). This ensures that the
 * CharacterRenderer's hardcoded animation values (body.position.y = 1.0, etc.)
 * work correctly for Meshy models of any original size.
 *
 * @param {THREE.Group} staticModel - the loaded Meshy model (static meshes)
 * @param {string} classId - for per-class rig config
 * @returns {THREE.Group} rigged model with named bones
 */
export function autoRig(staticModel, classId) {
  const cfg = getRigConfig(classId);
  const { rootBone, bones, bonesByName } = createSkeleton();

  staticModel.updateMatrixWorld(true);

  // ── Compute model bounding box ──
  const bbox = new THREE.Box3();
  staticModel.traverse((child) => {
    if (child.isMesh) {
      child.geometry.computeBoundingBox();
      const childBox = child.geometry.boundingBox.clone();
      childBox.applyMatrix4(child.matrixWorld);
      bbox.union(childBox);
    }
  });

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  bbox.getSize(size);
  bbox.getCenter(center);

  const modelHeight = size.y || 1;
  const modelWidth = size.x || 1;
  const minY = bbox.min.y;

  // ── Normalization: scale + translate so model matches procedural skeleton space ──
  // Target: height = TARGET_HEIGHT, bottom at y ≈ 0, centered on X/Z
  const scale = TARGET_HEIGHT / modelHeight;

  // ── Detect T-pose vs non-T-pose and adapt arm thresholds ──
  // T-pose: width/height ≈ 1.5–2.0 (arms extended horizontally)
  // Non-T-pose: width/height < 1.0 (arms at sides or close to body)
  const widthHeightRatio = modelWidth / modelHeight;
  const isTPose = widthHeightRatio > 1.2;

  // For non-T-pose models, scale arm X thresholds to fit the actual model width.
  // The normalized half-width in proportional space (0–1):
  const normalizedHalfWidth = (modelWidth * scale * 0.5) / TARGET_HEIGHT;

  // Create an effective config with scaled arm thresholds for narrow models
  let effectiveCfg = cfg;
  if (!isTPose && normalizedHalfWidth < cfg.wristX) {
    // Scale X thresholds so armStartX → 35% of half-width, shoulderX → 50%,
    // elbowX → 70%, wristX → 85% (leaves 15% for the body core)
    const hw = normalizedHalfWidth;
    effectiveCfg = {
      ...cfg,
      armStartX:  hw * 0.35,
      shoulderX:  hw * 0.50,
      elbowX:     hw * 0.70,
      wristX:     hw * 0.85,
    };
  }

  // Collect all meshes
  const meshes = [];
  staticModel.traverse((child) => {
    if (child.isMesh) meshes.push(child);
  });

  // ── Merge all mesh geometries into a single SkinnedMesh ──
  const mergedPositions = [];
  const mergedNormals = [];
  const mergedUvs = [];
  const mergedIndices = [];
  const mergedSkinIndices = [];
  const mergedSkinWeights = [];
  const materialGroups = [];
  const materials = [];
  let vertexOffset = 0;
  let indexOffset = 0;

  for (const child of meshes) {
    const geo = child.geometry.clone();
    geo.applyMatrix4(child.matrixWorld);

    const posAttr = geo.getAttribute('position');
    const normAttr = geo.getAttribute('normal');
    const uvAttr = geo.getAttribute('uv');
    const vertCount = posAttr.count;

    for (let i = 0; i < vertCount; i++) {
      const ox = posAttr.getX(i);
      const oy = posAttr.getY(i);
      const oz = posAttr.getZ(i);

      // Normalize position to standard coordinate space
      const nx = (ox - center.x) * scale;
      const ny = (oy - minY) * scale;
      const nz = (oz - center.z) * scale;

      mergedPositions.push(nx, ny, nz);

      if (normAttr) mergedNormals.push(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i));
      else mergedNormals.push(0, 1, 0);
      if (uvAttr) mergedUvs.push(uvAttr.getX(i), uvAttr.getY(i));
      else mergedUvs.push(0, 0);

      // Classify using proportional coordinates (0-1 range)
      const py = ny / TARGET_HEIGHT;
      const px = nx / TARGET_HEIGHT;
      const pz = nz / TARGET_HEIGHT;

      const { indices, weights } = classifyVertex(px, py, pz, effectiveCfg);
      mergedSkinIndices.push(...indices);
      mergedSkinWeights.push(...weights);
    }

    // Handle indices
    const indexAttr = geo.getIndex();
    const startIndex = indexOffset;
    if (indexAttr) {
      for (let j = 0; j < indexAttr.count; j++) {
        mergedIndices.push(indexAttr.getX(j) + vertexOffset);
      }
      indexOffset += indexAttr.count;
    } else {
      for (let j = 0; j < vertCount; j++) {
        mergedIndices.push(j + vertexOffset);
      }
      indexOffset += vertCount;
    }

    // Material group
    const matClone = child.material.clone();
    materials.push(matClone);
    materialGroups.push({
      start: startIndex,
      count: indexOffset - startIndex,
      materialIndex: materials.length - 1,
    });

    vertexOffset += vertCount;
    geo.dispose();
  }

  // ── Build merged BufferGeometry ──
  const mergedGeo = new THREE.BufferGeometry();
  mergedGeo.setAttribute('position', new THREE.Float32BufferAttribute(mergedPositions, 3));
  mergedGeo.setAttribute('normal', new THREE.Float32BufferAttribute(mergedNormals, 3));
  mergedGeo.setAttribute('uv', new THREE.Float32BufferAttribute(mergedUvs, 2));
  mergedGeo.setIndex(mergedIndices);
  mergedGeo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(mergedSkinIndices, 4));
  mergedGeo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(mergedSkinWeights, 4));

  for (const grp of materialGroups) {
    mergedGeo.addGroup(grp.start, grp.count, grp.materialIndex);
  }

  // ── Create SkinnedMesh and bind ──
  const skinnedMesh = new THREE.SkinnedMesh(mergedGeo, materials);
  skinnedMesh.castShadow = true;
  skinnedMesh.receiveShadow = true;
  skinnedMesh.name = 'characterMesh';
  skinnedMesh.add(rootBone);
  skinnedMesh.bind(new THREE.Skeleton(bones));

  // ── Assemble rigged group ──
  const riggedGroup = new THREE.Group();
  riggedGroup.name = 'riggedCharacter';
  riggedGroup.add(skinnedMesh);

  // Store metadata for animation system
  riggedGroup.userData.skeleton = skinnedMesh.skeleton;
  riggedGroup.userData.bonesByName = bonesByName;
  riggedGroup.userData.isRigged = true;
  riggedGroup.userData.meshCount = meshes.length;
  riggedGroup.userData.vertexCount = vertexOffset;
  riggedGroup.userData.originalHeight = modelHeight;
  riggedGroup.userData.normalizedScale = scale;

  return riggedGroup;
}

/**
 * Generate per-vertex bone weight colors for visualization.
 * Returns an array of RGB floats (3 per vertex) colored by primary bone influence.
 *
 * @param {THREE.BufferGeometry} geometry - rigged geometry with skinIndex/skinWeight
 * @returns {Float32Array} vertex colors (r,g,b per vertex)
 */
export function generateBoneWeightColors(geometry) {
  const skinIndexAttr = geometry.getAttribute('skinIndex');
  const skinWeightAttr = geometry.getAttribute('skinWeight');
  if (!skinIndexAttr || !skinWeightAttr) return null;

  const vertCount = skinIndexAttr.count;
  const colors = new Float32Array(vertCount * 3);

  for (let i = 0; i < vertCount; i++) {
    // Find primary bone (highest weight)
    let maxWeight = 0;
    let primaryBone = 0;
    for (let j = 0; j < 4; j++) {
      const w = skinWeightAttr.getComponent(i, j);
      if (w > maxWeight) {
        maxWeight = w;
        primaryBone = skinIndexAttr.getComponent(i, j);
      }
    }

    const hex = BONE_COLORS[primaryBone] || '#888888';
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;

    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }

  return colors;
}

/**
 * Attach a weapon model to a hand bone.
 */
export function attachWeapon(riggedModel, weaponModel, hand = 'right', offset = {}) {
  const bonesByName = riggedModel.userData.bonesByName;
  if (!bonesByName) {
    console.warn('AutoRigger.attachWeapon: model is not rigged');
    return;
  }

  const weaponClone = weaponModel.clone(true);
  weaponClone.name = 'weapon';

  if (offset.position) weaponClone.position.set(...offset.position);
  if (offset.rotation) weaponClone.rotation.set(...offset.rotation);
  if (offset.scale) weaponClone.scale.set(...offset.scale);

  if (hand === 'both' || hand === 'right') {
    const rightHand = bonesByName.get('rightHand');
    if (rightHand) rightHand.add(weaponClone);
  }

  if (hand === 'both' || hand === 'left' || hand === 'dual') {
    const leftHand = bonesByName.get('leftHand');
    if (leftHand) {
      const leftClone = weaponClone.clone(true);
      leftClone.name = 'weaponLeft';
      leftClone.scale.x *= -1;
      leftHand.add(leftClone);
    }
  }
}

/**
 * Detach weapon(s) from a rigged model.
 */
export function detachWeapons(riggedModel) {
  const bonesByName = riggedModel.userData.bonesByName;
  if (!bonesByName) return;

  for (const handName of ['rightHand', 'leftHand']) {
    const hand = bonesByName.get(handName);
    if (!hand) continue;
    const toRemove = [];
    hand.children.forEach(child => {
      if (child.name === 'weapon' || child.name === 'weaponLeft') toRemove.push(child);
    });
    toRemove.forEach(child => {
      hand.remove(child);
      child.traverse(c => {
        if (c.isMesh) { c.geometry.dispose(); c.material.dispose(); }
      });
    });
  }
}
