/**
 * Quick script to inspect the Soldier GLB:
 * - Skeleton bone names and rest quaternions
 * - Animation clip names and track details
 *
 * Pure Node.js — no Three.js imports needed, just reads GLB JSON chunk.
 */

import fs from 'fs';
import path from 'path';

const glbPath = path.resolve('public/assets/models/base_humanoid.glb');
const buffer = fs.readFileSync(glbPath);

// Parse GLB header
const magic = buffer.readUInt32LE(0);
console.log('Magic:', magic === 0x46546C67 ? 'glTF' : 'UNKNOWN');
const version = buffer.readUInt32LE(4);
const length = buffer.readUInt32LE(8);
console.log('Version:', version, 'Total length:', length);

// First chunk is JSON
const chunk0Length = buffer.readUInt32LE(12);
const jsonStr = buffer.toString('utf8', 20, 20 + chunk0Length);
const gltf = JSON.parse(jsonStr);

// Print nodes
console.log('\n=== NODES ===');
if (gltf.nodes) {
  for (let i = 0; i < gltf.nodes.length; i++) {
    const n = gltf.nodes[i];
    const rot = n.rotation ? `rot=[${n.rotation.map(v => v.toFixed(4)).join(',')}]` : '';
    const pos = n.translation ? `pos=[${n.translation.map(v => v.toFixed(4)).join(',')}]` : '';
    const scl = n.scale ? `scl=[${n.scale.map(v => v.toFixed(4)).join(',')}]` : '';
    console.log(`  [${i}] ${n.name || '(unnamed)'}  ${pos} ${rot} ${scl}  children=${JSON.stringify(n.children || [])}`);
  }
}

// Print skins
console.log('\n=== SKINS ===');
if (gltf.skins) {
  for (const skin of gltf.skins) {
    console.log('  Joints:', skin.joints?.length, 'nodes');
    if (skin.joints) {
      for (const j of skin.joints) {
        console.log(`    Joint node[${j}]: ${gltf.nodes[j]?.name}`);
      }
    }
  }
}

// Print animations
console.log('\n=== ANIMATIONS ===');
if (gltf.animations) {
  for (const anim of gltf.animations) {
    console.log(`  "${anim.name}" — ${anim.channels?.length} channels`);
    if (anim.channels) {
      const paths = {};
      for (const ch of anim.channels) {
        const p = ch.target.path;
        paths[p] = (paths[p] || 0) + 1;
      }
      console.log('    Track types:', JSON.stringify(paths));
      // Show first few channels
      for (const ch of anim.channels.slice(0, 3)) {
        const target = ch.target;
        const nodeName = gltf.nodes[target.node]?.name;
        console.log(`    → node[${target.node}] "${nodeName}" .${target.path}`);
      }
      if (anim.channels.length > 3) {
        console.log(`    ... and ${anim.channels.length - 3} more channels`);
      }
    }
  }
}

// Print bone rest rotations (from nodes)
console.log('\n=== BONE REST QUATERNIONS (non-identity only) ===');
const boneJoints = gltf.skins?.[0]?.joints || [];
let identityCount = 0;
let nonIdentityCount = 0;
for (const j of boneJoints) {
  const node = gltf.nodes[j];
  const r = node.rotation || [0, 0, 0, 1];
  const isIdentity = Math.abs(r[0]) < 0.001 && Math.abs(r[1]) < 0.001 && Math.abs(r[2]) < 0.001 && Math.abs(r[3] - 1) < 0.001;
  if (!isIdentity) {
    nonIdentityCount++;
    // Convert quaternion to approximate euler degrees for readability
    const [x, y, z, w] = r;
    const sinr = 2 * (w * x + y * z);
    const cosr = 1 - 2 * (x * x + y * y);
    const roll = Math.atan2(sinr, cosr) * 180 / Math.PI;
    const sinp = 2 * (w * y - z * x);
    const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * 90 : Math.asin(sinp) * 180 / Math.PI;
    const siny = 2 * (w * z + x * y);
    const cosy = 1 - 2 * (y * y + z * z);
    const yaw = Math.atan2(siny, cosy) * 180 / Math.PI;
    console.log(`  ${node.name}: quat=[${r.map(v => v.toFixed(4)).join(', ')}]  euler≈[${roll.toFixed(1)}, ${pitch.toFixed(1)}, ${yaw.toFixed(1)}]°`);
  } else {
    identityCount++;
  }
}
console.log(`  (${identityCount} bones at identity, ${nonIdentityCount} with rotation)`);
