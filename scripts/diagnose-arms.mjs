/**
 * Diagnostic: Load each class GLB and run arm detection + preDeformArms
 * to show exactly what SkeletonTransfer sees per model.
 *
 * Usage: node scripts/diagnose-arms.mjs
 */

// Polyfill browser globals for Three.js in Node
import { Blob as NodeBlob } from 'buffer';
globalThis.self = globalThis;
globalThis.window = globalThis;
globalThis.document = { createElementNS: () => ({}) };
globalThis.Blob = globalThis.Blob || NodeBlob;
globalThis.navigator = { userAgent: '' };

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import fs from 'fs';
import path from 'path';

const MODELS_DIR = path.resolve('public/assets/models');
const CLASSES = ['tyrant', 'wraith', 'infernal', 'harbinger', 'revenant'];
const ARM_REST_ANGLE_DEG = 55;

// ── Replicate detectArmPose from SkeletonTransfer ──

function detectArmPose(meshyScene, bbox) {
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const height = size.y;
  const minY = bbox.min.y;
  const centerX = (bbox.min.x + bbox.max.x) / 2;

  const leftVerts = [];
  const rightVerts = [];
  const v = new THREE.Vector3();

  meshyScene.traverse(child => {
    if (!child.isMesh) return;
    child.updateMatrixWorld(true);
    const pos = child.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      v.applyMatrix4(child.matrixWorld);
      const relY = (v.y - minY) / height;
      const relX = (v.x - centerX) / height;
      if (relY < 0.45 || relY > 0.95) continue;
      if (Math.abs(relX) < 0.10) continue;
      if (relX < 0) leftVerts.push({ relX, relY });
      else rightVerts.push({ relX, relY });
    }
  });

  function traceArm(verts) {
    if (verts.length < 20) return null;
    verts.sort((a, b) => Math.abs(a.relX) - Math.abs(b.relX));
    const n = verts.length;
    const q = Math.max(5, Math.floor(n / 4));
    const zones = [
      verts.slice(0, q),
      verts.slice(q, 2 * q),
      verts.slice(2 * q, 3 * q),
      verts.slice(3 * q),
    ];
    return zones.map(zone => {
      const ys = zone.map(v => v.relY).sort((a, b) => a - b);
      const xs = zone.map(v => v.relX).sort((a, b) => a - b);
      return {
        relX: xs[Math.floor(xs.length / 2)],
        relY: ys[Math.floor(ys.length / 2)],
      };
    });
  }

  return {
    left: traceArm(leftVerts),
    right: traceArm(rightVerts),
    leftCount: leftVerts.length,
    rightCount: rightVerts.length,
  };
}

function computeArmAngle(zones) {
  if (!zones || zones.length < 4) return null;
  const shoulder = zones[0];
  const hand = zones[3];
  const dx = Math.abs(hand.relX) - Math.abs(shoulder.relX);
  const dy = hand.relY - shoulder.relY;
  const currentAngle = Math.atan2(dy, Math.max(dx, 0.01));
  return currentAngle;
}

function computeArmRotation(zones) {
  const currentAngle = computeArmAngle(zones);
  if (currentAngle === null) return { rotation: 0, currentAngleDeg: null, reason: 'detection failed' };
  const TARGET_ANGLE = -ARM_REST_ANGLE_DEG * Math.PI / 180;
  const currentDeg = currentAngle * 180 / Math.PI;
  if (currentAngle > TARGET_ANGLE + 0.15) {
    const rotationRad = TARGET_ANGLE - currentAngle;
    return { rotation: rotationRad, currentAngleDeg: currentDeg, reason: 'will rotate' };
  }
  return { rotation: 0, currentAngleDeg: currentDeg, reason: 'already below target' };
}

// ── Load GLB using node fs ──

async function loadGLB(filepath) {
  const data = fs.readFileSync(filepath);
  const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);

  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.parse(arrayBuffer, '', (gltf) => resolve(gltf), (err) => reject(err));
  });
}

// ── Main ──

async function diagnose() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  ARM POSE DIAGNOSTIC — SkeletonTransfer preDeformArms');
  console.log('═══════════════════════════════════════════════════════════\n');

  for (const cls of CLASSES) {
    const filepath = path.join(MODELS_DIR, `char_${cls}.glb`);
    if (!fs.existsSync(filepath)) {
      console.log(`[${cls.toUpperCase()}] Model not found: ${filepath}\n`);
      continue;
    }

    try {
      const gltf = await loadGLB(filepath);
      const scene = gltf.scene;
      scene.updateMatrixWorld(true);

      // Count vertices and meshes
      let totalVerts = 0;
      let meshCount = 0;
      scene.traverse(child => {
        if (child.isMesh) {
          meshCount++;
          totalVerts += child.geometry.getAttribute('position').count;
        }
      });

      const bbox = new THREE.Box3().setFromObject(scene);
      const size = new THREE.Vector3();
      bbox.getSize(size);

      console.log(`── ${cls.toUpperCase()} ──────────────────────────────────────`);
      console.log(`  File size: ${(fs.statSync(filepath).size / 1024 / 1024).toFixed(1)} MB`);
      console.log(`  Meshes: ${meshCount}, Vertices: ${totalVerts.toLocaleString()}`);
      console.log(`  BBox: [${bbox.min.x.toFixed(3)}, ${bbox.min.y.toFixed(3)}, ${bbox.min.z.toFixed(3)}]`);
      console.log(`     to: [${bbox.max.x.toFixed(3)}, ${bbox.max.y.toFixed(3)}, ${bbox.max.z.toFixed(3)}]`);
      console.log(`  Size: ${size.x.toFixed(3)} x ${size.y.toFixed(3)} x ${size.z.toFixed(3)}`);
      console.log(`  Height: ${size.y.toFixed(3)}`);

      // Run arm detection
      const armPose = detectArmPose(scene, bbox);
      console.log(`  Arm vertices — left: ${armPose.leftCount}, right: ${armPose.rightCount}`);

      if (armPose.left) {
        console.log(`  Left arm zones:  ${armPose.left.map(z => `(${z.relX.toFixed(3)}, ${z.relY.toFixed(3)})`).join(' → ')}`);
        const { rotation, currentAngleDeg, reason } = computeArmRotation(armPose.left);
        console.log(`  Left arm angle:  ${currentAngleDeg?.toFixed(1)}° (0°=horizontal, -90°=straight down)`);
        console.log(`  Left rotation:   ${(rotation * 180 / Math.PI).toFixed(1)}° (${reason})`);
      } else {
        console.log(`  Left arm: NOT DETECTED (< 20 vertices)`);
      }

      if (armPose.right) {
        console.log(`  Right arm zones: ${armPose.right.map(z => `(${z.relX.toFixed(3)}, ${z.relY.toFixed(3)})`).join(' → ')}`);
        const { rotation, currentAngleDeg, reason } = computeArmRotation(armPose.right);
        console.log(`  Right arm angle: ${currentAngleDeg?.toFixed(1)}° (0°=horizontal, -90°=straight down)`);
        console.log(`  Right rotation:  ${(rotation * 180 / Math.PI).toFixed(1)}° (${reason})`);
      } else {
        console.log(`  Right arm: NOT DETECTED (< 20 vertices)`);
      }

      // Would preDeformArms fire?
      const leftRot = armPose.left ? computeArmRotation(armPose.left).rotation : 0;
      const rightRot = armPose.right ? computeArmRotation(armPose.right).rotation : 0;
      const wouldDeform = Math.abs(leftRot) >= 0.05 || Math.abs(rightRot) >= 0.05;
      console.log(`  preDeformArms would fire: ${wouldDeform ? 'YES' : 'NO ← ARMS STAY IN T-POSE!'}`);

      console.log('');
    } catch (err) {
      console.log(`[${cls.toUpperCase()}] Error loading: ${err.message}\n`);
    }
  }
}

diagnose().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
