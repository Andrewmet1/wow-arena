#!/usr/bin/env node
/**
 * Generate mobile-optimized character models by decimating geometry.
 * Keeps textures, skeleton, and bone hierarchy intact — just fewer triangles.
 *
 * Input:  public/assets/models/char_{class}.glb  (300K-800K verts)
 * Output: public/assets/models/char_{class}_mobile.glb  (~50K verts)
 *
 * Usage:
 *   node scripts/generate-mobile-models.mjs              # all classes
 *   node scripts/generate-mobile-models.mjs --class tyrant  # single class
 *   node scripts/generate-mobile-models.mjs --ratio 0.08    # custom ratio
 *   node scripts/generate-mobile-models.mjs --dry-run       # just show stats
 */

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import { MeshoptSimplifier } from 'meshoptimizer';
import fs from 'fs';
import path from 'path';

const MODEL_DIR = path.resolve('public/assets/models');
const CLASSES = ['tyrant', 'wraith', 'infernal', 'harbinger', 'revenant'];
// Presence-based lookup: `--suffix ""` is a legitimate value (write to the
// canonical char_<class>.glb), so a falsy-value fallback would silently
// redirect the output to the default. Check for the flag, not the value.
const hasArg = (f) => process.argv.includes(f);
const argVal = (f) => hasArg(f) ? (process.argv[process.argv.indexOf(f) + 1] ?? '') : null;
const TARGET_RATIO = parseFloat(argVal('--ratio') || '0.08');
// Absolute triangle budget. Preferred over --ratio for a mixed-density set:
// the classes range from 664K to 1.42M tris, so one ratio yields wildly
// different results per class. A budget gives every class the same target.
const TARGET_TRIS = argVal('--target-tris') ? parseInt(argVal('--target-tris'), 10) : null;
const OUT_SUFFIX = hasArg('--suffix') ? argVal('--suffix') : '_mobile';
const TEX_SIZE = parseInt(hasArg('--tex') ? argVal('--tex') : '1024', 10);
const IN_SUFFIX = hasArg('--in-suffix') ? argVal('--in-suffix') : '';
const SINGLE_CLASS = process.argv.find((a, i) => process.argv[i-1] === '--class') || null;
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  await MeshoptSimplifier.ready;

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const classes = SINGLE_CLASS ? [SINGLE_CLASS] : CLASSES;

  for (const cls of classes) {
    const inputPath = path.join(MODEL_DIR, `char_${cls}${IN_SUFFIX}.glb`);
    const outputPath = path.join(MODEL_DIR, `char_${cls}${OUT_SUFFIX}.glb`);

    if (!fs.existsSync(inputPath)) {
      console.log(`SKIP: ${inputPath} not found`);
      continue;
    }

    console.log(`\nProcessing ${cls}...`);
    const inputSize = fs.statSync(inputPath).size;

    const doc = await io.read(inputPath);

    // Count original vertices
    let origVerts = 0, origTris = 0;
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        if (pos) origVerts += pos.getCount();
        const idx = prim.getIndices();
        if (idx) origTris += idx.getCount() / 3;
      }
    }

    console.log(`  Original: ${origVerts.toLocaleString()} verts, ${Math.round(origTris).toLocaleString()} tris (${(inputSize/1e6).toFixed(1)}MB)`);

    if (DRY_RUN) {
      const estVerts = Math.round(origVerts * TARGET_RATIO);
      const estTris = Math.round(origTris * TARGET_RATIO);
      console.log(`  Target (~${(TARGET_RATIO*100).toFixed(0)}%): ~${estVerts.toLocaleString()} verts, ~${estTris.toLocaleString()} tris`);
      continue;
    }

    // Weld vertices first (merge duplicates at same position)
    await doc.transform(weld({ tolerance: 0.0001 }));

    // Simplify mesh — absolute budget when given, else a flat ratio.
    const ratio = TARGET_TRIS
      ? Math.min(1, TARGET_TRIS / Math.max(1, origTris))
      : TARGET_RATIO;
    console.log(`  Simplify ratio: ${(ratio * 100).toFixed(1)}%${TARGET_TRIS ? ` (budget ${TARGET_TRIS.toLocaleString()} tris)` : ''}`);
    await doc.transform(
      simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.01 })
    );

    // Downsize textures to 1024px max (from 4K) — huge GPU memory savings on mobile
    for (const tex of doc.getRoot().listTextures()) {
      const img = tex.getImage();
      if (!img) continue;
      const resized = await sharp(Buffer.from(img))
        .resize(TEX_SIZE, TEX_SIZE, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
      tex.setImage(resized);
      tex.setMimeType('image/png');
    }

    // Count result vertices
    let newVerts = 0, newTris = 0;
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        if (pos) newVerts += pos.getCount();
        const idx = prim.getIndices();
        if (idx) newTris += idx.getCount() / 3;
      }
    }

    await io.write(outputPath, doc);
    const outputSize = fs.statSync(outputPath).size;

    const vertReduction = ((1 - newVerts / origVerts) * 100).toFixed(1);
    const sizeReduction = ((1 - outputSize / inputSize) * 100).toFixed(1);
    console.log(`  Result: ${newVerts.toLocaleString()} verts, ${Math.round(newTris).toLocaleString()} tris (${(outputSize/1e6).toFixed(1)}MB)`);
    console.log(`  Reduction: ${vertReduction}% verts, ${sizeReduction}% file size`);
  }

  console.log('\nDone!');
}

main().catch(err => { console.error(err); process.exit(1); });
