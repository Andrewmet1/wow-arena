import fs from 'fs';

const path = process.argv[2] || 'public/assets/models/wpn_revenant_mace_shield.glb';
const buf = fs.readFileSync(path);
const jsonLen = buf.readUInt32LE(12);
const jsonStr = buf.toString('utf-8', 20, 20 + jsonLen);
const json = JSON.parse(jsonStr);

console.log('Nodes:', json.nodes?.length);
console.log('Meshes:', json.meshes?.length);
console.log('Materials:', json.materials?.length);

if (json.nodes) {
  for (let i = 0; i < json.nodes.length; i++) {
    const n = json.nodes[i];
    const parts = [`Node ${i}: ${n.name || '(unnamed)'}`];
    if (n.mesh != null) parts.push(`mesh=${n.mesh}`);
    if (n.children) parts.push(`children=[${n.children.join(',')}]`);
    if (n.scale) parts.push(`scale=[${n.scale.join(',')}]`);
    if (n.translation) parts.push(`translation=[${n.translation.join(',')}]`);
    console.log(' ', parts.join(' '));
  }
}

if (json.meshes) {
  for (let i = 0; i < json.meshes.length; i++) {
    const m = json.meshes[i];
    console.log(`  Mesh ${i}: ${m.name || '(unnamed)'} primitives=${m.primitives?.length}`);
    // Check vertex count from accessors
    if (m.primitives) {
      for (const p of m.primitives) {
        const posAccessor = json.accessors?.[p.attributes?.POSITION];
        if (posAccessor) {
          console.log(`    vertices: ${posAccessor.count}, min: [${posAccessor.min?.join(',')}], max: [${posAccessor.max?.join(',')}]`);
        }
      }
    }
  }
}
