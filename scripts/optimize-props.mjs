#!/usr/bin/env node
// Decimate dungeon props and shrink their textures.
//
// Meshy was asked for target_polycount: 15000 for every prop, so a rubble pile
// carries the same geometry budget as a hero asset — and a ~6MB 2048² texture
// with it. 86 props, 619MB, 1.29M triangles. A chamber holding 30-50 of them
// spends ~500K triangles and several hundred MB of VRAM on clutter, which is
// what forced bloom, SSAO and shadows off to claw back frames.
//
// Props render small and are seen at distance. Budgets here are tiered by role
// rather than flat: silhouette matters for a statue, not for a bone pile.
//
//   node scripts/optimize-props.mjs --dry-run
//   node scripts/optimize-props.mjs            (originals -> props/_original/)

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const DIR = path.resolve('public/assets/models/props');
const BACKUP = path.join(DIR, '_original');
const DRY = process.argv.includes('--dry-run');
const arg = (f, d) => process.argv.includes(f) ? process.argv[process.argv.indexOf(f) + 1] : d;
const TEX = parseInt(arg('--tex', '512'), 10);

// Silhouette-critical props keep more geometry; scatter clutter needs very
// little, since it is small on screen and usually partly occluded.
const BUDGET = [
  [/statue|throne|idol|altar|sarcophagus|pillar|buttress|archway|stairs|bridge|gate|door|chandelier/, 3000],
  [/banner|cage|chains|brazier|candelabrum|pew|barrel|crate|dummy|window|blade|trap|vent|plate/, 1800],
  [/.*/, 900],   // bone piles, rubble, urns, ash, skulls
];
const budgetFor = (id) => BUDGET.find(([re]) => re.test(id))[1];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;
if (!DRY) fs.mkdirSync(BACKUP, { recursive: true });

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.glb'));
let beforeT = 0, afterT = 0, beforeB = 0, afterB = 0, n = 0;
console.log(`\n  ${files.length} props · target textures ${TEX}px\n  ` + '─'.repeat(62));

for (const f of files) {
  const id = f.slice(0, -4);
  const src = path.join(DIR, f);
  const size0 = fs.statSync(src).size;
  const doc = await io.read(src);

  let t0 = 0;
  for (const m of doc.getRoot().listMeshes())
    for (const pr of m.listPrimitives()) { const i = pr.getIndices(); if (i) t0 += i.getCount() / 3; }

  const budget = budgetFor(id);
  const ratio = Math.min(1, budget / Math.max(1, t0));
  beforeT += t0; beforeB += size0;

  if (DRY) {
    console.log(`  ${id.padEnd(30)} ${Math.round(t0).toLocaleString().padStart(7)} -> ~${budget.toLocaleString().padStart(5)}  (${(ratio * 100).toFixed(0)}%)`);
    afterT += budget; afterB += size0 * 0.12;
    n++; continue;
  }

  fs.copyFileSync(src, path.join(BACKUP, f));
  await doc.transform(weld({ tolerance: 0.0001 }));
  if (ratio < 1) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.02 }));

  for (const tex of doc.getRoot().listTextures()) {
    const img = tex.getImage();
    if (!img) continue;
    tex.setImage(await sharp(Buffer.from(img))
      .resize(TEX, TEX, { fit: 'inside', withoutEnlargement: true })
      .png({ quality: 85 }).toBuffer());
    tex.setMimeType('image/png');
  }

  await io.write(src, doc);
  let t1 = 0;
  const doc2 = await io.read(src);
  for (const m of doc2.getRoot().listMeshes())
    for (const pr of m.listPrimitives()) { const i = pr.getIndices(); if (i) t1 += i.getCount() / 3; }
  const size1 = fs.statSync(src).size;
  afterT += t1; afterB += size1; n++;
  console.log(`  ${id.padEnd(30)} ${Math.round(t0).toLocaleString().padStart(7)} -> ${Math.round(t1).toLocaleString().padStart(6)} tris   ${(size0/1048576).toFixed(1)} -> ${(size1/1048576).toFixed(2)} MB`);
}

console.log('  ' + '─'.repeat(62));
console.log(`  ${n} props`);
console.log(`  triangles : ${Math.round(beforeT).toLocaleString()} -> ${Math.round(afterT).toLocaleString()}  (${(100 - afterT / beforeT * 100).toFixed(0)}% less)`);
console.log(`  on disk   : ${(beforeB/1048576).toFixed(0)} MB -> ${(afterB/1048576).toFixed(0)} MB`);
if (DRY) console.log('  [dry run] re-run without --dry-run to apply\n'); else console.log(`  originals in ${BACKUP}\n`);
