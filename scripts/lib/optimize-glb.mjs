// Shrink a generated GLB in place.
//
// Meshers return a hero-quality asset regardless of how the thing will be used:
// the first generated floor tile came back at 11.3MB, of which 11.1MB was a 4K
// texture — on a piece that is instanced hundreds of times across one room. A
// 45-piece kit at that rate is half a gigabyte, and the same oversight already
// cost this project once when 86 props shipped at 15,000 triangles each.
//
// Running it as part of generation rather than as a cleanup pass means the
// mistake cannot be made by forgetting.

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'fs';

/**
 * @param {string} file          .glb to rewrite in place
 * @param {object} opts
 * @param {number} opts.maxTris  triangle budget (0 disables decimation)
 * @param {number} opts.texSize  longest texture edge in pixels
 */
export async function optimizeGlb(file, { maxTris = 2500, texSize = 512 } = {}) {
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const before = fs.statSync(file).size;
  const doc = await io.read(file);

  let tris = 0;
  for (const m of doc.getRoot().listMeshes())
    for (const pr of m.listPrimitives()) {
      const i = pr.getIndices();
      if (i) tris += i.getCount() / 3;
    }

  await doc.transform(weld({ tolerance: 0.0001 }));
  if (maxTris && tris > maxTris) {
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: maxTris / tris, error: 0.02 }));
  }

  for (const tex of doc.getRoot().listTextures()) {
    const img = tex.getImage();
    if (!img) continue;
    // webp rather than png: these are albedo maps on tiling geometry, where
    // lossy artefacts are invisible and the size difference is severe.
    tex.setImage(await sharp(Buffer.from(img))
      .resize(texSize, texSize, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 88 }).toBuffer());
    tex.setMimeType('image/webp');
  }

  await io.write(file, doc);
  const after = fs.statSync(file).size;
  return { before, after, tris: Math.round(tris), saved: 1 - after / before };
}
