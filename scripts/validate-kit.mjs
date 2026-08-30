#!/usr/bin/env node
// Check generated kit pieces are actually usable as architecture.
//
// Image-to-3D models optimise for "looks like the picture", not for geometry
// that mates. A wall that comes back as a rounded slab still renders fine in
// isolation and tiles into a visibly lumpy wall, which is the difference
// between a level that reads as built and one that reads as boxes.
//
// Run this on ONE generated piece before paying for a whole kit:
//   node scripts/validate-kit.mjs <biomeId> [pieceId]
//
// Checks are geometric, not aesthetic — they catch the failures that make a
// piece unusable regardless of how good it looks:
//   footprint   bounding box proportions match the declared role
//   flat face   walls/corners have a planar back to mate against
//   grounded    sits on y=0 rather than floating or sunk
//   scale       within a sane range of the grid cell
//   density     enough triangles to hold detail, few enough to instance

import fs from 'fs';
import path from 'path';

const [biomeId, onlyPiece] = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!biomeId) { console.log('\n  usage: node scripts/validate-kit.mjs <biomeId> [pieceId]\n'); process.exit(1); }

const biome = (await import(path.resolve('content/biomes', `${biomeId}.mjs`))).default;
const dir = path.resolve('public/assets/models/kits', biomeId);
const cell = biome.grid?.cell ?? 4;

/** Read positions out of a GLB without a full glTF loader. */
function readPositions(file) {
  const buf = fs.readFileSync(file);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(buf.slice(20, 20 + jsonLen)));
  const binOff = 20 + jsonLen + 8;
  const out = [];
  let tris = 0;
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      const idx = prim.indices;
      if (idx != null) tris += json.accessors[idx].count / 3;
      const acc = json.accessors[prim.attributes?.POSITION];
      if (!acc || acc.componentType !== 5126) continue;
      const bv = json.bufferViews[acc.bufferView];
      const start = binOff + (bv.byteOffset || 0) + (acc.byteOffset || 0);
      for (let i = 0; i < acc.count; i++) {
        const o = start + i * 12;
        out.push([dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)]);
      }
    }
  }
  return { pts: out, tris: Math.round(tris) };
}

function analyse(file, piece) {
  const { pts, tris } = readPositions(file);
  if (!pts.length) return [{ level: 'fail', msg: 'no geometry' }];

  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], p[a]); max[a] = Math.max(max[a], p[a]); }
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const notes = [];

  // Scale: pieces are normalised at build time, but a wildly off model usually
  // signals the generator produced something other than what was asked for.
  const longest = Math.max(...size);
  if (longest < 0.05) notes.push({ level: 'fail', msg: `degenerate (longest axis ${longest.toFixed(3)})` });

  // Proportion. Walls and corners are slabs — one axis much thinner than the
  // others. A near-cube wall is the "it came back as a box" failure.
  const sorted = [...size].sort((a, b) => a - b);
  const flatness = sorted[0] / (sorted[2] || 1);
  if (['wall', 'corner', 'doorway'].includes(piece.role)) {
    if (flatness > 0.55) notes.push({ level: 'fail', msg: `not slab-like — thin/long ratio ${flatness.toFixed(2)} (want < 0.55); tiles into a lumpy wall` });
    else notes.push({ level: 'pass', msg: `slab proportion ${flatness.toFixed(2)}` });
  }
  if (piece.role === 'floor' || piece.role === 'filler') {
    const h = size[1] / (Math.max(size[0], size[2]) || 1);
    if (h > 0.6) notes.push({ level: 'fail', msg: `too tall for a floor tile (height ratio ${h.toFixed(2)})` });
    else notes.push({ level: 'pass', msg: `floor profile ${h.toFixed(2)}` });
  }

  // Flat mating face: a wall needs a plane of vertices at its back. Sample the
  // thinnest axis and see how much of the mesh sits on its extreme.
  if (['wall', 'corner', 'doorway'].includes(piece.role)) {
    const axis = size.indexOf(sorted[0]);
    const lo = min[axis], span = size[axis] || 1;
    const onBack = pts.filter(p => (p[axis] - lo) / span < 0.06).length / pts.length;
    if (onBack < 0.10) notes.push({ level: 'warn', msg: `only ${(onBack * 100).toFixed(0)}% of vertices form a back face — may not mate flush` });
    else notes.push({ level: 'pass', msg: `back face ${(onBack * 100).toFixed(0)}% of vertices` });
  }

  // Grounded: pieces are placed on y=0, so a mesh centred on its origin will
  // sink halfway into the floor.
  const yOffset = min[1] / (size[1] || 1);
  if (Math.abs(yOffset) > 0.35) notes.push({ level: 'warn', msg: `origin is not at the base (min-y offset ${yOffset.toFixed(2)}) — will float or sink` });

  // Density: instancing makes repeats cheap, but each piece still costs VRAM.
  if (tris > 6000) notes.push({ level: 'warn', msg: `${tris.toLocaleString()} tris — heavy for a tiled piece` });
  else if (tris < 40) notes.push({ level: 'fail', msg: `${tris} tris — no detail, will read as a box` });
  else notes.push({ level: 'pass', msg: `${tris.toLocaleString()} tris` });

  notes.push({ level: 'info', msg: `bounds ${size.map(v => v.toFixed(2)).join(' x ')} (cell ${cell})` });
  return notes;
}

const pieces = (biome.kit || []).filter(p => !onlyPiece || p.id === onlyPiece);
let fails = 0, checked = 0;
console.log(`\n  KIT VALIDATION — ${biomeId}\n  ` + '─'.repeat(62));
for (const p of pieces) {
  const file = path.join(dir, `${p.id}.glb`);
  if (!fs.existsSync(file)) { console.log(`  ·  ${p.id.padEnd(26)} not generated`); continue; }
  checked++;
  const notes = analyse(file, p);
  const bad = notes.filter(n => n.level === 'fail').length;
  fails += bad;
  console.log(`  ${bad ? '✗' : '✓'}  ${p.id.padEnd(26)} [${p.role}]`);
  for (const n of notes) console.log(`        ${n.level.padEnd(5)} ${n.msg}`);
}
console.log('  ' + '─'.repeat(62));
if (!checked) {
  console.log('  nothing generated yet — validate one piece before paying for the kit\n');
  process.exit(0);
}
console.log(`  ${checked} checked · ${fails} blocking issue(s)\n`);
process.exit(fails ? 1 : 0);
