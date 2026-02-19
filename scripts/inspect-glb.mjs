#!/usr/bin/env node
import fs from 'fs';

const filePath = process.argv[2];
if (!filePath) { console.error('Usage: node inspect-glb.mjs <file.glb>'); process.exit(1); }

const data = fs.readFileSync(filePath);
const jsonLen = data.readUInt32LE(12);
const json = JSON.parse(data.subarray(20, 20 + jsonLen).toString('utf8'));

console.log('=== NODE NAMES ===');
if (json.nodes) {
  json.nodes.forEach((n, i) => {
    const extra = [];
    if (n.skin !== undefined) extra.push('HAS SKIN');
    if (n.children) extra.push('children:' + JSON.stringify(n.children));
    console.log(`  [${i}] ${n.name || '(unnamed)'}${extra.length ? ' (' + extra.join(', ') + ')' : ''}`);
  });
}

console.log('\n=== SKINS (SKELETONS) ===');
if (json.skins) {
  json.skins.forEach((s, i) => {
    const boneNames = s.joints.map(j => json.nodes[j]?.name || String(j));
    console.log(`  Skin[${i}] skeleton: ${json.nodes[s.skeleton]?.name}`);
    console.log(`  Joints (${s.joints.length}):`);
    boneNames.forEach((name, j) => console.log(`    [${j}] ${name}`));
  });
}

console.log('\n=== ANIMATIONS ===');
if (json.animations) {
  json.animations.forEach((a, i) => {
    const targets = a.channels.map(c => `${json.nodes[c.target.node]?.name}.${c.target.path}`);
    console.log(`  Anim[${i}] "${a.name || 'unnamed'}" (${a.channels.length} channels):`);
    targets.forEach(t => console.log(`    ${t}`));
  });
} else {
  console.log('  (none)');
}
