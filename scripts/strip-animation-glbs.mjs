#!/usr/bin/env node
/**
 * Strip mesh/texture data from Meshy animation GLBs, keeping only animation tracks + skeleton.
 * Reduces each file from ~33MB to <1MB.
 *
 * Usage: node scripts/strip-animation-glbs.mjs
 *   --dry-run    Show what would happen without writing files
 *   --file X     Process only a single file (for testing)
 *   --dir X      Source directory (default: public/assets/animations/shared)
 *   --out X      Write to this directory instead of overwriting in place.
 *                Always prefer --out for irreplaceable source art; in-place
 *                writes are unrecoverable if the strip is wrong.
 */

import fs from 'fs';
import path from 'path';

const argVal = (flag) => process.argv.includes(flag)
  ? process.argv[process.argv.indexOf(flag) + 1]
  : null;

const ANIM_DIR = path.resolve(argVal('--dir') || 'public/assets/animations/shared');
const OUT_DIR = argVal('--out') ? path.resolve(argVal('--out')) : null;
const DRY_RUN = process.argv.includes('--dry-run');
const SINGLE = process.argv.includes('--file')
  ? process.argv[process.argv.indexOf('--file') + 1]
  : null;

// GLB magic + header
const GLB_MAGIC = 0x46546C67; // 'glTF'

function readGLB(filePath) {
  const buf = fs.readFileSync(filePath);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  if (dv.getUint32(0, true) !== GLB_MAGIC) throw new Error('Not a GLB file');
  const version = dv.getUint32(4, true);
  if (version !== 2) throw new Error(`Unsupported GLB version: ${version}`);

  // Chunk 0: JSON
  const jsonLen = dv.getUint32(12, true);
  const jsonType = dv.getUint32(16, true);
  if (jsonType !== 0x4E4F534A) throw new Error('First chunk is not JSON');
  const jsonStr = new TextDecoder().decode(buf.slice(20, 20 + jsonLen));
  const json = JSON.parse(jsonStr);

  // Chunk 1: BIN
  const binOffset = 20 + jsonLen;
  let binData = null;
  if (binOffset < buf.byteLength) {
    const binLen = dv.getUint32(binOffset, true);
    binData = buf.slice(binOffset + 8, binOffset + 8 + binLen);
  }

  return { json, binData };
}

function writeGLB(filePath, json, binData) {
  const jsonStr = JSON.stringify(json);
  // Pad JSON to 4-byte boundary with spaces
  const jsonPadded = jsonStr + ' '.repeat((4 - (jsonStr.length % 4)) % 4);
  const jsonBuf = new TextEncoder().encode(jsonPadded);

  // Pad BIN to 4-byte boundary with zeros
  const binPadLen = (4 - (binData.byteLength % 4)) % 4;
  const binPadded = Buffer.concat([binData, Buffer.alloc(binPadLen)]);

  const totalLen = 12 + 8 + jsonBuf.byteLength + 8 + binPadded.byteLength;
  const out = Buffer.alloc(totalLen);
  const dv = new DataView(out.buffer);

  // Header
  dv.setUint32(0, GLB_MAGIC, true);
  dv.setUint32(4, 2, true); // version
  dv.setUint32(8, totalLen, true);

  // JSON chunk
  dv.setUint32(12, jsonBuf.byteLength, true);
  dv.setUint32(16, 0x4E4F534A, true);
  out.set(jsonBuf, 20);

  // BIN chunk
  const binChunkOff = 20 + jsonBuf.byteLength;
  dv.setUint32(binChunkOff, binPadded.byteLength, true);
  dv.setUint32(binChunkOff + 4, 0x004E4942, true);
  out.set(binPadded, binChunkOff + 8);

  fs.writeFileSync(filePath, out);
}

function stripAnimationGLB(filePath) {
  const { json, binData } = readGLB(filePath);

  if (!json.animations || json.animations.length === 0) {
    console.log(`  SKIP (no animations): ${path.basename(filePath)}`);
    return null;
  }

  // Collect all accessors & bufferViews used by animations
  const usedAccessors = new Set();
  const usedBufferViews = new Set();

  for (const anim of json.animations) {
    for (const sampler of anim.samplers) {
      usedAccessors.add(sampler.input);
      usedAccessors.add(sampler.output);
    }
  }

  // Also keep the skeleton's inverse bind matrices if present
  if (json.skins) {
    for (const skin of json.skins) {
      if (skin.inverseBindMatrices != null) {
        usedAccessors.add(skin.inverseBindMatrices);
      }
    }
  }

  for (const accIdx of usedAccessors) {
    const acc = json.accessors[accIdx];
    if (acc.bufferView != null) usedBufferViews.add(acc.bufferView);
  }

  // Build new bin buffer with only the used bufferViews
  const oldBufViews = json.bufferViews || [];
  const bufViewMap = new Map(); // old index -> new index
  const newBufViews = [];
  const binChunks = [];
  let newBinOffset = 0;

  for (const oldIdx of [...usedBufferViews].sort((a, b) => a - b)) {
    const bv = oldBufViews[oldIdx];
    const byteOffset = bv.byteOffset || 0;
    const byteLength = bv.byteLength;
    const chunk = binData.slice(byteOffset, byteOffset + byteLength);

    // Align to 4 bytes
    const padLen = (4 - (byteLength % 4)) % 4;

    bufViewMap.set(oldIdx, newBufViews.length);
    newBufViews.push({
      buffer: 0,
      byteOffset: newBinOffset,
      byteLength,
      ...(bv.byteStride ? { byteStride: bv.byteStride } : {}),
      ...(bv.target ? { target: bv.target } : {}),
    });

    binChunks.push(chunk);
    if (padLen > 0) binChunks.push(Buffer.alloc(padLen));
    newBinOffset += byteLength + padLen;
  }

  const newBin = Buffer.concat(binChunks);

  // Remap accessor bufferView indices
  const accMap = new Map(); // old index -> new index
  const newAccessors = [];
  for (const oldIdx of [...usedAccessors].sort((a, b) => a - b)) {
    const acc = { ...json.accessors[oldIdx] };
    if (acc.bufferView != null) {
      acc.bufferView = bufViewMap.get(acc.bufferView);
    }
    accMap.set(oldIdx, newAccessors.length);
    newAccessors.push(acc);
  }

  // Remap animation sampler references
  const newAnimations = json.animations.map(anim => ({
    ...anim,
    samplers: anim.samplers.map(s => ({
      ...s,
      input: accMap.get(s.input),
      output: accMap.get(s.output),
    })),
  }));

  // Remap skin inverse bind matrices
  const newSkins = json.skins?.map(skin => {
    const s = { ...skin };
    if (s.inverseBindMatrices != null) {
      s.inverseBindMatrices = accMap.get(s.inverseBindMatrices);
    }
    return s;
  });

  // Keep nodes (for bone hierarchy) but strip mesh references
  const newNodes = (json.nodes || []).map(node => {
    const n = { ...node };
    delete n.mesh;
    return n;
  });

  // Build stripped JSON — no meshes, materials, textures, images
  const stripped = {
    asset: json.asset,
    scene: json.scene,
    scenes: json.scenes,
    nodes: newNodes,
    animations: newAnimations,
    accessors: newAccessors,
    bufferViews: newBufViews,
    buffers: [{ byteLength: newBin.byteLength }],
  };
  if (newSkins) stripped.skins = newSkins;

  return { json: stripped, binData: newBin };
}

// Main
async function main() {
  const files = SINGLE
    ? [path.resolve(SINGLE)]
    : fs.readdirSync(ANIM_DIR)
        .filter(f => f.endsWith('.glb'))
        .map(f => path.join(ANIM_DIR, f));

  if (OUT_DIR) fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Processing ${files.length} animation GLBs from ${ANIM_DIR}`);
  console.log(OUT_DIR ? `Writing to ${OUT_DIR} (originals untouched)` : 'WRITING IN PLACE');
  let totalBefore = 0;
  let totalAfter = 0;
  let processed = 0;

  for (const file of files) {
    const before = fs.statSync(file).size;
    totalBefore += before;

    try {
      const result = stripAnimationGLB(file);
      if (!result) continue;

      const afterSize = 12 + 8 + JSON.stringify(result.json).length + 8 + result.binData.byteLength;
      totalAfter += afterSize;
      processed++;

      const pct = ((1 - afterSize / before) * 100).toFixed(1);
      console.log(`  ${path.basename(file)}: ${(before / 1e6).toFixed(1)}MB → ${(afterSize / 1e6).toFixed(1)}MB (${pct}% reduction)`);

      if (!DRY_RUN) {
        const dest = OUT_DIR
          ? path.join(OUT_DIR, path.relative(ANIM_DIR, file))
          : file;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        writeGLB(dest, result.json, result.binData);
      }
    } catch (err) {
      console.error(`  ERROR ${path.basename(file)}: ${err.message}`);
    }
  }

  console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Processed ${processed}/${files.length} files`);
  console.log(`Total: ${(totalBefore / 1e6).toFixed(1)}MB → ${(totalAfter / 1e6).toFixed(1)}MB (${((1 - totalAfter / totalBefore) * 100).toFixed(1)}% reduction)`);
}

main().catch(err => { console.error(err); process.exit(1); });
