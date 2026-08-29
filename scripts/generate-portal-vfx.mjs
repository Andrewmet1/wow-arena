#!/usr/bin/env node
// Generate a proper portal swirl VFX texture for the dungeon exit portal.
// Replaces the flat yellow plane that was reading as "broken" with a real
// magical swirl effect.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OPENAI_KEY = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8').match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const VFX_DIR = path.join(ROOT, 'public', 'assets', 'art', 'vfx');

const ASSETS = [
  { id: 'vfx_portal_swirl', size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy magical portal swirl on transparent background, top-down view of a swirling vortex of bright golden-orange energy spiraling inward to a brilliant white-yellow center, ethereal energy wisps trailing from the rim, painterly digital art VFX sprite suitable for a billboard plane inside a portal archway, fades to transparent at outer rim, 1024x1024 transparent PNG' },
  { id: 'vfx_portal_runes', size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy floating glowing runes on transparent background, a circular arrangement of cryptic eldritch runes glowing bright orange-gold, painterly digital art, fades to transparent at edges, suitable as a billboard sprite that rotates over a portal swirl, 1024x1024 transparent PNG' },
];

async function gen(asset) {
  const out = path.join(VFX_DIR, `${asset.id}.png`);
  if (fs.existsSync(out)) { console.log(`[skip] ${asset.id}`); return; }
  console.log(`[gen] ${asset.id}...`);
  const body = {
    model: 'gpt-image-1', prompt: asset.prompt, n: 1,
    size: asset.size, quality: 'medium', output_format: 'png',
  };
  if (asset.transparent) body.background = 'transparent';
  try {
    const r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) { console.error(`[ERR ${asset.id}]`, JSON.stringify(d).slice(0, 300)); return; }
    fs.writeFileSync(out, Buffer.from(d.data[0].b64_json, 'base64'));
    console.log(`[ok] ${asset.id}`);
  } catch (e) { console.error(`[ERR ${asset.id}]`, e.message); }
}

console.log(`=== Portal VFX: ${ASSETS.length} pieces ===`);
await Promise.all(ASSETS.map(gen));
console.log('=== Done ===');
