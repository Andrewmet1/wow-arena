/**
 * SkeletonTransfer — Rig Meshy models with a Mixamo-compatible skeleton.
 *
 * Uses zone-based vertex classification (adapted from AutoRigger) to assign
 * bone weights based on spatial position. This is more robust than proximity-
 * based weighting for complex models with robes, held weapons, and accessories.
 *
 * The model geometry is normalized: centered on X/Z, feet at Y=0,
 * then scaled to a standard height (STANDARD_HEIGHT) so that bone
 * positions match AnimationFactory clip expectations (Hips at ~Y=1.0).
 *
 * An optional worldScale parameter applies additional scaling to both
 * vertices and skeleton, so the outputGroup never needs a transform scale
 * (which would cause double-scaling in the Three.js skinning shader).
 */

import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const MAX_INFLUENCES = 4;

/**
 * Maximum total vertex count for rigged output.
 * Models above this get iterative vertex merging for performance.
 * Two skinned characters at 25K verts each = 50K total skinned verts.
 */
const MAX_VERTEX_BUDGET = 25000;

/**
 * Standard model height where Hips sits at ~y=1.0.
 * AnimationFactory position tracks assume this height.
 */
const STANDARD_HEIGHT = 1.887;

// ── Mixamo bone indices (order matches BONE_DEFS) ──────────────────────
const MX = {
  HIPS: 0,
  SPINE: 1,
  SPINE1: 2,
  SPINE2: 3,
  NECK: 4,
  HEAD: 5,
  L_SHOULDER: 6,
  L_ARM: 7,
  L_FOREARM: 8,
  L_HAND: 9,
  R_SHOULDER: 10,
  R_ARM: 11,
  R_FOREARM: 12,
  R_HAND: 13,
  L_UPLEG: 14,
  L_LEG: 15,
  L_FOOT: 16,
  L_TOE: 17,
  R_UPLEG: 18,
  R_LEG: 19,
  R_FOOT: 20,
  R_TOE: 21,
};

// ── Bone hierarchy definition (Mixamo-compatible) ───────────────────────

/**
 * Define skeleton proportionally: each bone's position is relative to the
 * model's normalized height (0 = feet, 1 = top of head).
 * X values are proportional to model height.
 */
const BONE_DEFS = [
  // name,                    parent,               relY,    relX,    relZ
  ['mixamorigHips',           null,                  0.53,    0.0,     0.0  ],
  ['mixamorigSpine',          'mixamorigHips',       0.58,    0.0,     0.0  ],
  ['mixamorigSpine1',         'mixamorigSpine',      0.64,    0.0,     0.0  ],
  ['mixamorigSpine2',         'mixamorigSpine1',     0.72,    0.0,     0.0  ],
  ['mixamorigNeck',           'mixamorigSpine2',     0.82,    0.0,     0.0  ],
  ['mixamorigHead',           'mixamorigNeck',       0.88,    0.0,     0.0  ],
  // Left arm chain
  ['mixamorigLeftShoulder',   'mixamorigSpine2',     0.80,   -0.08,    0.0  ],
  ['mixamorigLeftArm',        'mixamorigLeftShoulder',0.78,  -0.16,    0.0  ],
  ['mixamorigLeftForeArm',    'mixamorigLeftArm',    0.72,   -0.28,    0.0  ],
  ['mixamorigLeftHand',       'mixamorigLeftForeArm',0.65,   -0.38,    0.0  ],
  // Right arm chain
  ['mixamorigRightShoulder',  'mixamorigSpine2',     0.80,    0.08,    0.0  ],
  ['mixamorigRightArm',       'mixamorigRightShoulder',0.78,  0.16,    0.0  ],
  ['mixamorigRightForeArm',   'mixamorigRightArm',   0.72,    0.28,    0.0  ],
  ['mixamorigRightHand',      'mixamorigRightForeArm',0.65,   0.38,    0.0  ],
  // Left leg chain
  ['mixamorigLeftUpLeg',      'mixamorigHips',       0.49,   -0.08,    0.0  ],
  ['mixamorigLeftLeg',        'mixamorigLeftUpLeg',  0.28,   -0.08,    0.0  ],
  ['mixamorigLeftFoot',       'mixamorigLeftLeg',    0.05,   -0.08,    0.02 ],
  ['mixamorigLeftToeBase',    'mixamorigLeftFoot',   0.01,   -0.08,   -0.06 ],
  // Right leg chain
  ['mixamorigRightUpLeg',     'mixamorigHips',       0.49,    0.08,    0.0  ],
  ['mixamorigRightLeg',       'mixamorigRightUpLeg', 0.28,    0.08,    0.0  ],
  ['mixamorigRightFoot',      'mixamorigRightLeg',   0.05,    0.08,    0.02 ],
  ['mixamorigRightToeBase',   'mixamorigRightFoot',  0.01,    0.08,   -0.06 ],
];

// ── Smoothstep helper ───────────────────────────────────────────────────
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ── Zone-based vertex classification ────────────────────────────────────

/**
 * Default rig zone thresholds (proportional 0-1 range).
 * Adapted from AutoRigger's proven classifyVertex approach.
 */
const DEFAULT_THRESHOLDS = {
  // Y-axis thresholds (proportional 0-1)
  toeY: 0.02,
  footY: 0.06,
  kneeY: 0.20,
  thighY: 0.35,
  hipY: 0.42,
  waistY: 0.50,
  chestY: 0.58,
  shoulderY: 0.62,
  neckY: 0.82,
  headY: 0.88,
  // X-axis thresholds for arm detection (proportional to height)
  armStartX: 0.13,
  shoulderX: 0.20,
  elbowX: 0.30,
  wristX: 0.40,
  // Blending
  blendMargin: 0.04,
};

/**
 * Classify a vertex into bone zones for a humanoid model.
 * Uses proportional coordinates (px, py) where:
 *   py: 0 = feet, 1 = top of head
 *   px: 0 = center, negative = left, positive = right (proportional to height)
 *
 * Returns exactly 4 bone influences (indices + weights).
 *
 * @param {number} px - proportional X (vertex x / scaled height)
 * @param {number} py - proportional Y (vertex y / scaled height)
 * @param {Object} cfg - zone thresholds
 * @returns {{ indices: number[], weights: number[] }}
 */
function classifyVertex(px, py, cfg) {
  const {
    toeY, footY, kneeY, thighY, hipY, waistY, chestY,
    shoulderY, neckY, headY, armStartX, shoulderX, elbowX,
    wristX, blendMargin,
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
    add(MX.HEAD, hw);
    if (hw < 1) add(MX.NECK, 1 - hw);
  }
  // ── NECK (neckY to headY) ──
  else if (py > neckY - blendMargin) {
    const nw = smoothstep(neckY - blendMargin, neckY + blendMargin, py);
    add(MX.NECK, nw);
    if (nw < 1) {
      if (absX > armStartX + blendMargin) {
        add(isLeft ? MX.L_SHOULDER : MX.R_SHOULDER, (1 - nw) * 0.5);
        add(MX.SPINE2, (1 - nw) * 0.5);
      } else {
        add(MX.SPINE2, 1 - nw);
      }
    }
  }
  // ── SHOULDER & ARM ZONE (shoulderY to neckY, far from center) ──
  else if (py > shoulderY - blendMargin && absX > armStartX - blendMargin) {
    const armBlend = smoothstep(armStartX - blendMargin, armStartX + blendMargin, absX);

    if (armBlend > 0.01) {
      if (absX < shoulderX) {
        add(isLeft ? MX.L_SHOULDER : MX.R_SHOULDER, armBlend);
      } else if (absX < elbowX) {
        const t = smoothstep(shoulderX, elbowX, absX);
        add(isLeft ? MX.L_ARM : MX.R_ARM, armBlend * (1 - t * 0.3));
        add(isLeft ? MX.L_SHOULDER : MX.R_SHOULDER, armBlend * t * 0.3);
      } else if (absX < wristX) {
        add(isLeft ? MX.L_FOREARM : MX.R_FOREARM, armBlend);
      } else {
        add(isLeft ? MX.L_HAND : MX.R_HAND, armBlend);
      }
    }
    if (armBlend < 1) {
      add(MX.SPINE2, 1 - armBlend);
    }
  }
  // ── UPPER TORSO (chestY to shoulderY) ──
  else if (py > chestY - blendMargin) {
    // Check for arms extending down at this height
    if (absX > armStartX + blendMargin * 2 && py > chestY) {
      const armBlend = smoothstep(armStartX + blendMargin, armStartX + blendMargin * 3, absX);
      if (absX < elbowX) {
        add(isLeft ? MX.L_ARM : MX.R_ARM, armBlend);
      } else if (absX < wristX) {
        add(isLeft ? MX.L_FOREARM : MX.R_FOREARM, armBlend);
      } else {
        add(isLeft ? MX.L_HAND : MX.R_HAND, armBlend);
      }
      if (armBlend < 1) add(MX.SPINE2, 1 - armBlend);
    } else {
      add(MX.SPINE2, 1);
    }
  }
  // ── WAIST (waistY to chestY) — Spine2 blending into Spine1 ──
  else if (py > waistY - blendMargin) {
    const spineBlend = smoothstep(chestY, waistY, py);
    add(MX.SPINE2, (1 - spineBlend) * 0.5);
    add(MX.SPINE1, (1 - spineBlend) * 0.5 + spineBlend * 0.3);
    add(MX.SPINE, spineBlend * 0.7);
  }
  // ── HIP ZONE (hipY to waistY) — spine/hips blend ──
  else if (py > hipY - blendMargin) {
    const hipBlend = smoothstep(waistY, hipY, py);
    add(MX.SPINE, (1 - hipBlend) * 0.5);
    add(MX.HIPS, 0.5 + hipBlend * 0.5);
  }
  // ── UPPER LEG / THIGH (thighY to hipY) ──
  else if (py > thighY - blendMargin) {
    const legBlend = smoothstep(hipY + blendMargin, hipY - blendMargin, py);
    const side = isLeft ? MX.L_UPLEG : MX.R_UPLEG;
    add(side, legBlend);
    if (legBlend < 1) add(MX.HIPS, 1 - legBlend);
  }
  // ── KNEE / LOWER LEG (kneeY to thighY) ──
  else if (py > kneeY - blendMargin) {
    const kneeBlend = smoothstep(thighY + blendMargin, thighY - blendMargin, py);
    const upperSide = isLeft ? MX.L_UPLEG : MX.R_UPLEG;
    const lowerSide = isLeft ? MX.L_LEG : MX.R_LEG;
    add(lowerSide, kneeBlend);
    if (kneeBlend < 1) add(upperSide, 1 - kneeBlend);
  }
  // ── FOOT (footY to kneeY) ──
  else if (py > footY - blendMargin) {
    const footBlend = smoothstep(kneeY + blendMargin, kneeY - blendMargin, py);
    const lowerSide = isLeft ? MX.L_LEG : MX.R_LEG;
    const footSide = isLeft ? MX.L_FOOT : MX.R_FOOT;
    add(footSide, footBlend);
    if (footBlend < 1) add(lowerSide, 1 - footBlend);
  }
  // ── TOE (below footY) ──
  else if (py > toeY - blendMargin) {
    const toeBlend = smoothstep(footY + blendMargin, footY - blendMargin, py);
    const footSide = isLeft ? MX.L_FOOT : MX.R_FOOT;
    const toeSide = isLeft ? MX.L_TOE : MX.R_TOE;
    add(toeSide, toeBlend);
    if (toeBlend < 1) add(footSide, 1 - toeBlend);
  }
  // ── VERY BOTTOM (below toeY) ──
  else {
    add(isLeft ? MX.L_TOE : MX.R_TOE, 1);
  }

  // Fallback: assign to Spine2 (body) if nothing matched
  if (influences.length === 0) {
    influences.push({ bone: MX.SPINE2, weight: 1 });
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

// ── Skeleton creation ───────────────────────────────────────────────────

/**
 * Create a Mixamo-compatible skeleton positioned inside the given bounding box.
 * Uses fixed proportional positions — no arm pose detection (which confuses
 * held weapons with arms).
 *
 * @param {THREE.Box3} bbox - Model bounding box (should be normalized: feet at y=0)
 * @returns {{ bones: THREE.Bone[], boneWorldPositions: Map<string, THREE.Vector3> }}
 */
function createMixamoSkeleton(bbox) {
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const height = size.y;
  const minY = bbox.min.y;
  const centerX = (bbox.min.x + bbox.max.x) / 2;
  const centerZ = (bbox.min.z + bbox.max.z) / 2;

  const boneMap = new Map();
  const boneWorldPositions = new Map();
  const bones = [];

  for (const [name, parentName, relY, relX, relZ] of BONE_DEFS) {
    const bone = new THREE.Bone();
    bone.name = name;

    const worldPos = new THREE.Vector3(
      centerX + relX * height,
      minY + relY * height,
      centerZ + relZ * height,
    );
    boneWorldPositions.set(name, worldPos);

    if (parentName && boneMap.has(parentName)) {
      const parent = boneMap.get(parentName);
      const parentWorld = boneWorldPositions.get(parentName);
      parent.add(bone);
      bone.position.copy(worldPos).sub(parentWorld);
    } else {
      bone.position.copy(worldPos);
    }

    boneMap.set(name, bone);
    bones.push(bone);
  }

  return { bones, boneWorldPositions };
}

// ── Main rigging function ───────────────────────────────────────────────

/**
 * Rig a Meshy model with a Mixamo-compatible skeleton.
 *
 * The geometry is:
 * 1. Centered on X/Z, feet at Y=0
 * 2. Scaled to STANDARD_HEIGHT (so Hips is at ~y=1.0)
 * 3. Optionally scaled by worldScale for game-world sizing
 *
 * Uses zone-based vertex classification (like AutoRigger) for robust
 * bone weight assignment that handles robes, held weapons, and accessories.
 *
 * @param {THREE.Object3D} meshyScene - The loaded Meshy model scene
 * @param {THREE.AnimationClip[]} [animations=[]] - Animation clips to include
 * @param {number} [worldScale=1.0] - Additional scale applied to vertices and skeleton
 * @returns {{ scene: THREE.Group, animations: THREE.AnimationClip[], scaleFactor: number }}
 */
export function rigWithMixamoSkeleton(meshyScene, animations = [], worldScale = 1.0) {
  console.time('[SkeletonTransfer] Rigging');

  // 1. Compute model bounding box in world space
  meshyScene.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(meshyScene);

  // 2. Compute normalization: center X/Z, feet at Y=0
  const centerX = (bbox.min.x + bbox.max.x) / 2;
  const centerZ = (bbox.min.z + bbox.max.z) / 2;
  const groundY = bbox.min.y;
  const rawHeight = bbox.max.y - groundY;

  if (rawHeight < 0.001) {
    console.warn('[SkeletonTransfer] Model has near-zero height, returning empty group');
    return { scene: new THREE.Group(), animations, scaleFactor: 1.0 };
  }

  // 3. Compute scale factor
  const scaleFactor = (STANDARD_HEIGHT / rawHeight) * worldScale;
  const scaledHeight = rawHeight * scaleFactor;

  console.log(`[SkeletonTransfer] Raw height: ${rawHeight.toFixed(3)}, scaleFactor: ${scaleFactor.toFixed(3)} (worldScale: ${worldScale})`);

  // 4. Create scaled bounding box for skeleton placement
  const scaledBbox = new THREE.Box3(
    new THREE.Vector3(
      (bbox.min.x - centerX) * scaleFactor,
      0,
      (bbox.min.z - centerZ) * scaleFactor
    ),
    new THREE.Vector3(
      (bbox.max.x - centerX) * scaleFactor,
      scaledHeight,
      (bbox.max.z - centerZ) * scaleFactor
    ),
  );

  // 5. Detect T-pose vs non-T-pose and adapt arm thresholds
  const modelWidth = (bbox.max.x - bbox.min.x) * scaleFactor;
  const widthHeightRatio = modelWidth / scaledHeight;
  const isTPose = widthHeightRatio > 1.2;

  let cfg = { ...DEFAULT_THRESHOLDS };
  if (!isTPose) {
    // Scale arm X thresholds to fit the actual model width
    const normalizedHalfWidth = (modelWidth * 0.5) / scaledHeight;
    if (normalizedHalfWidth < cfg.wristX) {
      cfg = {
        ...cfg,
        armStartX: normalizedHalfWidth * 0.35,
        shoulderX: normalizedHalfWidth * 0.50,
        elbowX:    normalizedHalfWidth * 0.70,
        wristX:    normalizedHalfWidth * 0.85,
      };
      console.log(`[SkeletonTransfer] Non-T-pose (ratio ${widthHeightRatio.toFixed(2)}), scaled arm thresholds: armStart=${cfg.armStartX.toFixed(3)}, wrist=${cfg.wristX.toFixed(3)}`);
    }
  } else {
    console.log(`[SkeletonTransfer] T-pose detected (ratio ${widthHeightRatio.toFixed(2)})`);
  }

  // 6. Create Mixamo skeleton (fixed proportional positions, no arm detection)
  const { bones, boneWorldPositions } = createMixamoSkeleton(scaledBbox);

  console.log('[SkeletonTransfer] Hips Y:', boneWorldPositions.get('mixamorigHips').y.toFixed(3),
    ', Model height:', scaledHeight.toFixed(3));

  // 7. Update bone world matrices before creating Skeleton
  bones[0].updateWorldMatrix(false, true);

  // 8. Create skeleton
  const skeleton = new THREE.Skeleton(bones);

  // 9. Create output group (identity transform)
  const outputGroup = new THREE.Group();
  outputGroup.add(bones[0]);

  // 10. Count total vertices and compute per-mesh budget for merging
  const meshInfos = [];
  meshyScene.traverse(child => {
    if (child.isMesh) {
      meshInfos.push({ mesh: child, verts: child.geometry.getAttribute('position').count });
    }
  });
  const rawTotalVerts = meshInfos.reduce((s, m) => s + m.verts, 0);

  let mergeTolerance = 0;
  if (rawTotalVerts > MAX_VERTEX_BUDGET) {
    // Aggressive merge: start higher and will iterate if needed
    mergeTolerance = (rawTotalVerts / MAX_VERTEX_BUDGET) * 0.005;
    console.log(`[SkeletonTransfer] Model has ${rawTotalVerts} vertices (budget: ${MAX_VERTEX_BUDGET}), initial merge tolerance ${mergeTolerance.toFixed(4)}`);
  }

  // 11. Process each mesh in the Meshy scene
  let totalVerts = 0;
  for (const { mesh: child } of meshInfos) {
    let geom = child.geometry.clone();

    // Iterative merge: double tolerance until this mesh's share of the budget is met
    if (mergeTolerance > 0) {
      const meshBudget = Math.max(500, Math.floor(MAX_VERTEX_BUDGET * (geom.getAttribute('position').count / rawTotalVerts)));
      let tol = mergeTolerance;
      const before = geom.getAttribute('position').count;
      for (let pass = 0; pass < 4; pass++) {
        try {
          const merged = mergeVertices(geom, tol);
          geom = merged;
          if (geom.getAttribute('position').count <= meshBudget) break;
          tol *= 2.5; // escalate tolerance
        } catch (e) {
          console.warn('[SkeletonTransfer] mergeVertices failed, using current geometry', e.message);
          break;
        }
      }
      const after = geom.getAttribute('position').count;
      if (before !== after) {
        console.log(`[SkeletonTransfer] Merged ${before} → ${after} vertices (${((1 - after / before) * 100).toFixed(0)}% reduction, budget: ${meshBudget})`);
      }
    }

    const posAttr = geom.getAttribute('position');
    const normalAttr = geom.getAttribute('normal');
    const vertexCount = posAttr.count;
    totalVerts += vertexCount;

    // Get world matrix for this mesh (to flatten any local transforms)
    const worldMatrix = child.matrixWorld.clone();
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(worldMatrix);

    // Allocate skinning attributes
    const skinIndices = new Uint16Array(vertexCount * 4);
    const skinWeights = new Float32Array(vertexCount * 4);

    const vertex = new THREE.Vector3();
    const normal = new THREE.Vector3();

    for (let v = 0; v < vertexCount; v++) {
      // Transform vertex to world space, then normalize + scale
      vertex.set(posAttr.getX(v), posAttr.getY(v), posAttr.getZ(v));
      vertex.applyMatrix4(worldMatrix);
      vertex.x = (vertex.x - centerX) * scaleFactor;
      vertex.y = (vertex.y - groundY) * scaleFactor;
      vertex.z = (vertex.z - centerZ) * scaleFactor;

      // Write scaled position back to geometry
      posAttr.setXYZ(v, vertex.x, vertex.y, vertex.z);

      // Transform normal by world rotation
      if (normalAttr) {
        normal.set(normalAttr.getX(v), normalAttr.getY(v), normalAttr.getZ(v));
        normal.applyMatrix3(normalMatrix).normalize();
        normalAttr.setXYZ(v, normal.x, normal.y, normal.z);
      }

      // Zone-based classification (proportional coordinates)
      const py = vertex.y / scaledHeight;
      const px = vertex.x / scaledHeight;

      const { indices, weights } = classifyVertex(px, py, cfg);

      for (let i = 0; i < 4; i++) {
        skinIndices[v * 4 + i] = indices[i];
        skinWeights[v * 4 + i] = weights[i];
      }
    }

    posAttr.needsUpdate = true;
    if (normalAttr) normalAttr.needsUpdate = true;

    // Add skin attributes
    geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
    geom.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));

    // Recompute bounds after modifying vertex positions
    geom.computeBoundingSphere();
    geom.computeBoundingBox();

    // Clone material(s) for independence
    const material = Array.isArray(child.material)
      ? child.material.map(m => m.clone())
      : child.material.clone();

    // Create SkinnedMesh — NO castShadow (shadow pass re-runs the
    // entire skinning vertex shader, effectively doubling GPU cost)
    const skinnedMesh = new THREE.SkinnedMesh(geom, material);
    skinnedMesh.name = child.name || 'meshySkin';
    skinnedMesh.castShadow = false;
    skinnedMesh.receiveShadow = true;

    // Disable frustum culling — bone deformation moves vertices
    // outside the static bounding sphere
    skinnedMesh.frustumCulled = false;

    // Bind with identity bindMatrix
    skinnedMesh.bind(skeleton, new THREE.Matrix4());

    outputGroup.add(skinnedMesh);
  }

  console.timeEnd('[SkeletonTransfer] Rigging');
  console.log(`[SkeletonTransfer] Rigged ${totalVerts} vertices across ${bones.length} bones`);

  return {
    scene: outputGroup,
    animations,
    scaleFactor,
  };
}

/**
 * Quick utility: get the skeleton from a rigged output.
 */
export function getSkeleton(riggedScene) {
  let skel = null;
  riggedScene.traverse(child => {
    if (child.isSkinnedMesh && child.skeleton) {
      skel = child.skeleton;
    }
  });
  return skel;
}
