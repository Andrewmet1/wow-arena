#!/usr/bin/env node
// Second wave of dungeon textures — wall variants, decorative details,
// floor variants for visual richness.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OPENAI_KEY = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8').match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const TEX_DIR = path.join(ROOT, 'public', 'assets', 'art', 'dungeon');
fs.mkdirSync(TEX_DIR, { recursive: true });

const ASSETS = {
  // Wall variants
  wall_carved: 'Seamless tileable dark fantasy stone wall texture, large blocks with deeply carved bas-relief panels showing skeletal warriors marching, ancient eroded look, painterly digital art, flat orthographic front view, 1024x1024 seamless tile',
  wall_runic: 'Seamless tileable dark fantasy stone wall texture, mossy grey-black blocks with glowing red rune carvings scattered across the surface, dark fantasy crypt aesthetic, painterly digital art, flat orthographic front view, 1024x1024 seamless tile',
  wall_cracked: 'Seamless tileable dark fantasy stone wall texture, weathered grey-brown blocks with deep cracks running through, water stains and moss in the cracks, ash dust at the bottom, painterly digital art, flat orthographic front view, 1024x1024 seamless tile',
  // Floor variants
  floor_runic: 'Seamless tileable dark fantasy stone floor with a faint glowing red runic pattern subtly visible across large weathered slabs, dark fantasy ritual chamber, painterly digital art, top-down orthographic view, 1024x1024 seamless tile',
  floor_blood: 'Seamless tileable dark fantasy stone floor texture with old blood stains spread across weathered grey slabs, dried dark crimson splatters, dungeon arena vibe, painterly digital art, top-down orthographic view, 1024x1024 seamless tile',
  // Detail textures
  metal_iron: 'Seamless tileable dark fantasy heavy iron metal texture, hammered black-iron surface with rust patches and rivets, painterly digital art, flat orthographic view, 1024x1024 seamless tile',
  cloth_banner: 'Seamless tileable dark fantasy heavy cloth banner texture, deep crimson red weathered fabric with faint skull and ash heraldry patterns, frayed edges visible, painterly digital art, flat orthographic front view, 1024x1024 seamless tile',
  // Door / portcullis details
  door_iron: 'Single 3D dark fantasy iron-bound wooden dungeon door, heavy black iron studded panels reinforcing dark wood, large iron ring handle, isolated single object, front view, dark moody studio lighting on transparent background, 1024x1024 image for image-to-3D'
};

async function gen(id, prompt, size = '1024x1024') {
  const out = path.join(TEX_DIR, `${id}.png`);
  if (fs.existsSync(out)) { console.log(`[${id}] exists, skip`); return; }
  console.log(`[${id}] generating...`);
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: 'gpt-image-1', prompt, n: 1, size, quality: 'medium', output_format: 'png' }),
  });
  const d = await r.json();
  if (!r.ok) { console.error(`[${id}]`, JSON.stringify(d).slice(0, 200)); return; }
  const buf = Buffer.from(d.data[0].b64_json, 'base64');
  fs.writeFileSync(out, buf);
  console.log(`[${id}] saved ${(buf.length / 1024).toFixed(0)} KB`);
}

await Promise.all(Object.entries(ASSETS).map(([id, p]) => gen(id, p)));
console.log('Wave 2 textures done.');
