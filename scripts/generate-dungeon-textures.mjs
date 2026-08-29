#!/usr/bin/env node
// Generate tileable dungeon textures + promotional art via DALL-E.
// Wired into DungeonEnvironment.js to texture the walls, floor, ceiling.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OPENAI_KEY = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8').match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const TEX_DIR = path.join(ROOT, 'public', 'assets', 'art', 'dungeon');
fs.mkdirSync(TEX_DIR, { recursive: true });

const ASSETS = {
  floor_stone:    'Seamless tileable stone floor texture for a dark fantasy dungeon, large rectangular slabs of weathered grey-brown stone with cracked mortar between them, slight ash dust in the grout, painterly digital art, top-down orthographic view, 1024x1024 seamless tile',
  wall_stone:     'Seamless tileable stone wall texture for a dark fantasy dungeon, irregular dark grey blocks with deep mortar lines, slightly mossy and water-stained, faintly carved with weathered runes barely visible, painterly digital art, flat orthographic front view, 1024x1024 seamless tile',
  ceiling_beams:  'Seamless tileable dark wood ceiling texture with rough black-stained timber planks running horizontally and a heavy iron rivet pattern, dark fantasy dungeon, painterly digital art, flat orthographic view from below, 1024x1024 seamless tile',
  splash_crucible_below: 'Dark fantasy promotional splash art: a lone armored adventurer standing at the entrance of an enormous underground stone hall, towering crowned skeleton figure on a distant ash throne barely visible at the far end, columns rising into darkness, torches throwing long warm flickering light, ash motes drifting in the air, dramatic chiaroscuro, painterly cinematic digital art, 16:9 aspect',
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

await Promise.all([
  gen('floor_stone',    ASSETS.floor_stone),
  gen('wall_stone',     ASSETS.wall_stone),
  gen('ceiling_beams',  ASSETS.ceiling_beams),
  gen('splash_crucible_below', ASSETS.splash_crucible_below, '1536x1024'),
]);
console.log('Textures done.');
