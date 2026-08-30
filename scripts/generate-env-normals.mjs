#!/usr/bin/env node
// Derive normal maps for dungeon surface textures.
//
// Every dungeon material is albedo-only: 53 MeshStandardMaterials, zero
// normalMap / roughnessMap / aoMap between them. The engine compensates by
// assigning the diffuse texture as a bumpMap, which fakes relief from
// brightness and gets it wrong wherever the art is dark-but-flat or
// bright-but-recessed — mortar lines read as bumps, painted highlights read as
// ridges.
//
// A Sobel gradient over luminance is still an approximation, but it is a
// *directional* one: it encodes which way a surface turns, so light moving
// across it behaves plausibly instead of just brightening. It costs nothing and
// runs offline, unlike regenerating the whole texture set through an image
// model.
//
//   node scripts/generate-env-normals.mjs [--strength 2.0] [--force]

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const DIR = path.resolve('public/assets/art/dungeon');
const arg = (f, d) => process.argv.includes(f) ? process.argv[process.argv.indexOf(f) + 1] : d;
const STRENGTH = parseFloat(arg('--strength', '2.0'));
const FORCE = process.argv.includes('--force');

// Only surfaces the renderer tiles across geometry. Banners, decals and
// skyboxes gain nothing from a derived normal and would only cost memory.
const SURFACE = /^(floor|wall|ceiling)_/;

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.png') && SURFACE.test(f) && !f.includes('_normal'));
console.log(`\n  ${files.length} surface textures\n  ` + '─'.repeat(50));

let made = 0, skipped = 0;
for (const f of files) {
  const base = f.slice(0, -4);
  const out = path.join(DIR, `${base}_normal.png`);
  if (fs.existsSync(out) && !FORCE) { skipped++; continue; }

  const img = sharp(path.join(DIR, f));
  const { width, height } = await img.metadata();
  const gray = await img.clone().greyscale().raw().toBuffer();

  const nx = Buffer.alloc(width * height * 3);
  const at = (x, y) => gray[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Sobel: horizontal and vertical luminance gradient.
      const gx = (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1))
               - (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1));
      const gy = (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1))
               - (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1));
      // Normalise the gradient into a unit normal, then pack to 0..255.
      let vx = -gx / 255 * STRENGTH, vy = -gy / 255 * STRENGTH, vz = 1;
      const len = Math.hypot(vx, vy, vz) || 1;
      const i = (y * width + x) * 3;
      nx[i]     = Math.round((vx / len * 0.5 + 0.5) * 255);
      nx[i + 1] = Math.round((vy / len * 0.5 + 0.5) * 255);
      nx[i + 2] = Math.round((vz / len * 0.5 + 0.5) * 255);
    }
  }
  await sharp(nx, { raw: { width, height, channels: 3 } }).png().toFile(out);
  made++;
  console.log(`  ${base.padEnd(30)} ${width}×${height}`);
}
console.log('  ' + '─'.repeat(50));
console.log(`  ${made} generated, ${skipped} already present\n`);
