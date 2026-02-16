/**
 * AutoRigger — Vertex-based auto-rigging for static Meshy.ai meshes.
 *
 * Takes a static mesh Group → produces a rigged SkinnedMesh with a named bone
 * hierarchy that matches the existing animation system's expectations.
 *
 * Bone hierarchy (matches CharacterRenderer animation targets):
 *
 *   rootBone
 *   ├── hips
 *   │   ├── leftUpperLeg
 *   │   │   └── leftLowerLeg
 *   │   │       └── leftFoot
 *   │   └── rightUpperLeg
 *   │       └── rightLowerLeg
 *   │           └── rightFoot
 *   └── body (spine/torso)
 *       ├── head
 *       ├── leftUpperArm (leftArm compatible)
 *       │   └── leftForearm
 *       │       └── leftHand ← weapon attach
 *       └── rightUpperArm (rightArm compatible)
 *           └── rightForearm
 *               └── rightHand ← weapon attach
 */

import * as THREE from 'three';
import { getRigConfig } from './AssetManifest.js';

// Bone indices (order matters for skinIndex buffer)
const BONE = {
  ROOT: 0,
  HIPS: 1,
  BODY: 2,
  HEAD: 3,
  LEFT_UPPER_ARM: 4,
  LEFT_FOREARM: 5,
  LEFT_HAND: 6,
  RIGHT_UPPER_ARM: 7,
  RIGHT_FOREARM: 8,
  RIGHT_HAND: 9,
  LEFT_LEG: 10,      // upper leg (named leftLeg for compat)
  LEFT_LOWER_LEG: 11,
  LEFT_FOOT: 12,
  RIGHT_LEG: 13,     // upper leg (named rightLeg for compat)
  RIGHT_LOWER_LEG: 14,
  RIGHT_FOOT: 15,
};

const BONE_COUNT = 16;

/**
 * Create the bone hierarchy.
 * Positions are in normalized model space (model scaled to ~unit height).
 * @returns {{ rootBone: THREE.Bone, bones: THREE.Bone[], bonesByName: Map<string, THREE.Bone> }}
 */
function createSkeleton() {
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

  // Root at origin — bone positions match procedural buildBaseSkeleton() layout
  const rootBone = makeBone('rootBone', null, 0, 0, 0);

  // Legs group equivalent — legs attach to root at ground level
  // Procedural: leftLeg at (-0.18, 0.3, 0) relative to root
  const hips = makeBone('hips', rootBone, 0, 0.30, 0);
  const leftUpperLeg = makeBone('leftLeg', hips, -0.18, 0, 0);
  const leftLowerLeg = makeBone('leftLowerLeg', leftUpperLeg, 0, -0.20, 0);
  const leftFoot = makeBone('leftFoot', leftLowerLeg, 0, -0.12, 0.03);
  const rightUpperLeg = makeBone('rightLeg', hips, 0.18, 0, 0);
  const rightLowerLeg = makeBone('rightLowerLeg', rightUpperLeg, 0, -0.20, 0);
  const rightFoot = makeBone('rightFoot', rightLowerLeg, 0, -0.12, 0.03);

  // Upper body — procedural: body at y=1.0 relative to root
  const body = makeBone('body', rootBone, 0, 1.0, 0);
  // Head at y=0.62 relative to body (matches procedural)
  const head = makeBone('head', body, 0, 0.62, 0);

  // Arms — procedural: leftArm at x=-0.5, rightArm at x=0.5, relative to body
  const leftUpperArm = makeBone('leftArm', body, -0.5, 0, 0);
  const leftForearm = makeBone('leftForearm', leftUpperArm, -0.06, -0.18, 0);
  const leftHand = makeBone('leftHand', leftForearm, -0.02, -0.15, 0);

  const rightUpperArm = makeBone('rightArm', body, 0.5, 0, 0);
  const rightForearm = makeBone('rightForearm', rightUpperArm, 0.06, -0.18, 0);
  const rightHand = makeBone('rightHand', rightForearm, 0.02, -0.15, 0);

  return { rootBone, bones, bonesByName };
}

/**
 * Classify a vertex position into a bone zone.
 * Returns up to 4 bone influences with weights (for smooth blending).
 *
 * @param {number} nx - normalized X [-0.5, 0.5]
 * @param {number} ny - normalized Y [0, 1]
 * @param {number} nz - normalized Z
 * @param {object} cfg - rig config thresholds
 * @returns {{ indices: number[], weights: number[] }} up to 4 influences
 */
function classifyVertex(nx, ny, nz, cfg) {
  const { headThreshold, armThreshold, armX, legThreshold, blendMargin } = cfg;

  const influences = [];

  // Helper: add influence with smooth weight
  function addInfluence(boneIdx, weight) {
    if (weight > 0.001) {
      influences.push({ bone: boneIdx, weight });
    }
  }

  // Smoothstep helper
  function smoothstep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  const absX = Math.abs(nx);
  const isLeft = nx < 0;

  // ── HEAD zone ──
  if (ny > headThreshold - blendMargin) {
    const headWeight = smoothstep(headThreshold - blendMargin, headThreshold + blendMargin, ny);
    addInfluence(BONE.HEAD, headWeight);
    // Partial body influence at boundary
    if (headWeight < 1) {
      addInfluence(BONE.BODY, 1 - headWeight);
    }
  }
  // ── ARM zones ──
  else if (ny > legThreshold && absX >= armX - blendMargin) {
    const armBlend = smoothstep(armX - blendMargin, armX + blendMargin, absX);

    if (armBlend > 0.01) {
      // Split upper arm / forearm by Y position within arm zone
      const armMidY = (armThreshold + headThreshold) * 0.5;
      const forearmThreshold = armMidY - 0.08;

      if (ny > armMidY) {
        // Upper arm
        addInfluence(isLeft ? BONE.LEFT_UPPER_ARM : BONE.RIGHT_UPPER_ARM, armBlend);
      } else if (ny > forearmThreshold) {
        // Forearm
        addInfluence(isLeft ? BONE.LEFT_FOREARM : BONE.RIGHT_FOREARM, armBlend);
      } else {
        // Hand
        addInfluence(isLeft ? BONE.LEFT_HAND : BONE.RIGHT_HAND, armBlend);
      }
    }

    // Body bleed
    if (armBlend < 1) {
      addInfluence(BONE.BODY, (1 - armBlend));
    }
  }
  // ── TORSO zone ──
  else if (ny > legThreshold + blendMargin) {
    const hipBlend = smoothstep(legThreshold + blendMargin * 2, legThreshold + blendMargin, ny);
    addInfluence(BONE.BODY, 1 - hipBlend * 0.3);
    if (hipBlend > 0.01) {
      addInfluence(BONE.HIPS, hipBlend * 0.3);
    }
  }
  // ── LEG zones ──
  else if (ny <= legThreshold + blendMargin) {
    const legMidY = legThreshold * 0.5;
    const footThreshold = 0.05;

    if (ny < footThreshold + blendMargin) {
      // Foot
      addInfluence(isLeft ? BONE.LEFT_FOOT : BONE.RIGHT_FOOT, 1);
    } else if (ny < legMidY) {
      // Lower leg
      const footBlend = smoothstep(footThreshold + blendMargin * 2, footThreshold, ny);
      addInfluence(isLeft ? BONE.LEFT_LOWER_LEG : BONE.RIGHT_LOWER_LEG, 1 - footBlend);
      if (footBlend > 0.01) {
        addInfluence(isLeft ? BONE.LEFT_FOOT : BONE.RIGHT_FOOT, footBlend);
      }
    } else {
      // Upper leg, blending into hips
      const hipBlend = smoothstep(legThreshold - blendMargin, legThreshold + blendMargin, ny);
      addInfluence(isLeft ? BONE.LEFT_LEG : BONE.RIGHT_LEG, 1 - hipBlend * 0.5);
      if (hipBlend > 0.01) {
        addInfluence(BONE.HIPS, hipBlend * 0.5);
      }
    }
  }

  // Fallback: if no influences, assign to body
  if (influences.length === 0) {
    influences.push({ bone: BONE.BODY, weight: 1 });
  }

  // Normalize weights to sum to 1
  const total = influences.reduce((s, i) => s + i.weight, 0);
  for (const inf of influences) {
    inf.weight /= total;
  }

  // Sort by weight descending, take top 4
  influences.sort((a, b) => b.weight - a.weight);
  const top4 = influences.slice(0, 4);

  // Pad to exactly 4
  while (top4.length < 4) {
    top4.push({ bone: 0, weight: 0 });
  }

  // Re-normalize top 4
  const total4 = top4.reduce((s, i) => s + i.weight, 0);
  if (total4 > 0) {
    for (const inf of top4) {
      inf.weight /= total4;
    }
  }

  return {
    indices: top4.map(i => i.bone),
    weights: top4.map(i => i.weight),
  };
}

/**
 * Auto-rig a static mesh Group into a SkinnedMesh with bone hierarchy.
 *
 * @param {THREE.Group} staticModel - the loaded Meshy model (static meshes)
 * @param {string} classId - for per-class rig config
 * @returns {THREE.Group} rigged model with named bones compatible with CharacterRenderer animations
 */
export function autoRig(staticModel, classId) {
  const cfg = getRigConfig(classId);
  const { rootBone, bones, bonesByName } = createSkeleton();

  staticModel.updateMatrixWorld(true);

  // Compute bounding box of all meshes
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

  const height = size.y || 1;
  const minY = bbox.min.y;

  // Create the rigged output group — rootBone is the single shared bone hierarchy
  const riggedGroup = new THREE.Group();
  riggedGroup.name = 'riggedCharacter';
  riggedGroup.add(rootBone);

  // Create skeleton from the shared bones
  const skeleton = new THREE.Skeleton(bones);

  // Collect all meshes first (avoid modifying hierarchy during traverse)
  const meshes = [];
  staticModel.traverse((child) => {
    if (child.isMesh) meshes.push(child);
  });

  // Merge all mesh geometries into a single SkinnedMesh for proper skeleton binding.
  // Multiple SkinnedMeshes sharing one Skeleton is problematic — merge instead.
  const mergedPositions = [];
  const mergedNormals = [];
  const mergedUvs = [];
  const mergedIndices = [];
  const mergedSkinIndices = [];
  const mergedSkinWeights = [];
  const materialGroups = []; // { start, count, materialIndex }
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

    // Classify vertices and compute skin weights
    for (let i = 0; i < vertCount; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      const z = posAttr.getZ(i);

      mergedPositions.push(x, y, z);
      if (normAttr) mergedNormals.push(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i));
      else mergedNormals.push(0, 1, 0);
      if (uvAttr) mergedUvs.push(uvAttr.getX(i), uvAttr.getY(i));
      else mergedUvs.push(0, 0);

      const ny = (y - minY) / height;
      const nx = (x - center.x) / height;
      const nz = (z - center.z) / height;

      const { indices, weights } = classifyVertex(nx, ny, nz, cfg);
      mergedSkinIndices.push(...indices);
      mergedSkinWeights.push(...weights);
    }

    // Handle indices
    const indexAttr = geo.getIndex();
    const startIndex = indexOffset;
    if (indexAttr) {
      for (let i = 0; i < indexAttr.count; i++) {
        mergedIndices.push(indexAttr.getX(i) + vertexOffset);
      }
      indexOffset += indexAttr.count;
    } else {
      for (let i = 0; i < vertCount; i++) {
        mergedIndices.push(i + vertexOffset);
      }
      indexOffset += vertCount;
    }

    // Track material group
    const matClone = child.material.clone();
    const matIdx = materials.length;
    materials.push(matClone);
    materialGroups.push({
      start: startIndex,
      count: indexOffset - startIndex,
      materialIndex: matIdx,
    });

    vertexOffset += vertCount;
    geo.dispose();
  }

  // Build merged BufferGeometry
  const mergedGeo = new THREE.BufferGeometry();
  mergedGeo.setAttribute('position', new THREE.Float32BufferAttribute(mergedPositions, 3));
  mergedGeo.setAttribute('normal', new THREE.Float32BufferAttribute(mergedNormals, 3));
  mergedGeo.setAttribute('uv', new THREE.Float32BufferAttribute(mergedUvs, 2));
  mergedGeo.setIndex(mergedIndices);
  mergedGeo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(mergedSkinIndices, 4));
  mergedGeo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(mergedSkinWeights, 4));

  // Add material groups for multi-material rendering
  for (const grp of materialGroups) {
    mergedGeo.addGroup(grp.start, grp.count, grp.materialIndex);
  }

  // Create single SkinnedMesh with the shared skeleton
  const skinnedMesh = new THREE.SkinnedMesh(mergedGeo, materials);
  skinnedMesh.castShadow = true;
  skinnedMesh.receiveShadow = true;
  skinnedMesh.name = 'characterMesh';
  skinnedMesh.add(rootBone);
  skinnedMesh.bind(skeleton);

  riggedGroup.add(skinnedMesh);

  // Store bone references for animation system
  riggedGroup.userData.skeleton = skeleton;
  riggedGroup.userData.bonesByName = bonesByName;
  riggedGroup.userData.isRigged = true;
  riggedGroup.userData.meshCount = meshes.length;
  riggedGroup.userData.vertexCount = vertexOffset;

  return riggedGroup;
}

/**
 * Attach a weapon model to a hand bone.
 *
 * @param {THREE.Group} riggedModel - the auto-rigged character
 * @param {THREE.Group} weaponModel - the weapon mesh
 * @param {'left'|'right'|'both'} hand - which hand to attach to
 * @param {object} [offset] - { position: [x,y,z], rotation: [x,y,z], scale: [x,y,z] }
 */
export function attachWeapon(riggedModel, weaponModel, hand = 'right', offset = {}) {
  const bonesByName = riggedModel.userData.bonesByName;
  if (!bonesByName) {
    console.warn('AutoRigger.attachWeapon: model is not rigged');
    return;
  }

  const weaponClone = weaponModel.clone(true);
  weaponClone.name = 'weapon';

  // Apply offset
  if (offset.position) weaponClone.position.set(...offset.position);
  if (offset.rotation) weaponClone.rotation.set(...offset.rotation);
  if (offset.scale) weaponClone.scale.set(...offset.scale);

  if (hand === 'both' || hand === 'right') {
    const rightHand = bonesByName.get('rightHand');
    if (rightHand) {
      rightHand.add(weaponClone);
    }
  }

  if (hand === 'both' || hand === 'left' || hand === 'dual') {
    const leftHand = bonesByName.get('leftHand');
    if (leftHand) {
      const leftClone = weaponClone.clone(true);
      leftClone.name = 'weaponLeft';
      // Mirror for left hand
      leftClone.scale.x *= -1;
      leftHand.add(leftClone);
    }
  }
}

/**
 * Detach weapon(s) from a rigged model.
 * @param {THREE.Group} riggedModel
 */
export function detachWeapons(riggedModel) {
  const bonesByName = riggedModel.userData.bonesByName;
  if (!bonesByName) return;

  for (const handName of ['rightHand', 'leftHand']) {
    const hand = bonesByName.get(handName);
    if (!hand) continue;
    const toRemove = [];
    hand.children.forEach(child => {
      if (child.name === 'weapon' || child.name === 'weaponLeft') {
        toRemove.push(child);
      }
    });
    toRemove.forEach(child => {
      hand.remove(child);
      child.traverse(c => {
        if (c.isMesh) {
          c.geometry.dispose();
          c.material.dispose();
        }
      });
    });
  }
}

export { BONE, BONE_COUNT, createSkeleton };
