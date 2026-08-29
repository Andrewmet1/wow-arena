#!/usr/bin/env node
// Generate proper atmospheric VFX textures so the dungeon doesn't have
// hard-coded flat shapes pretending to be fog/light. Each is designed as
// a sprite/decal that can be animated with drift/rotation/opacity for
// genuine immersive movement.
//
// Output: /assets/art/vfx/

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OPENAI_KEY = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8').match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const VFX_DIR = path.join(ROOT, 'public', 'assets', 'art', 'vfx');
fs.mkdirSync(VFX_DIR, { recursive: true });

const ASSETS = [
  // ── Atmospheric fog/smoke ──────────────────────────────────────────────
  { id: 'vfx_fog_dense', size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy dense fog cloud puff on transparent background, soft wispy gray-green smoke sphere with feathery edges fading to fully transparent, top-down view, suitable as a billboard sprite that will be drifted and pulsed in real-time as atmospheric volume fog inside a dungeon, painterly digital art, transparent PNG' },
  { id: 'vfx_mist_swirl', size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy ground mist swirl on transparent background, low-lying horizontal wisp of pale ghostly fog with curling tendrils, mostly transparent center, fades to nothing at edges, top-down view, suitable as a drifting ground decal sprite, painterly digital art, transparent PNG' },
  { id: 'vfx_smoke_column', size: '1024x1536', transparent: true,
    prompt: 'Dark fantasy vertical smoke column on transparent background, tall billowing dark gray smoke rising from a point, widens slightly toward the top, fades to transparent at top and sides, designed as a billboard sprite rising from a torch or brazier, painterly digital art, transparent PNG' },
  { id: 'vfx_dust_cloud', size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy floating dust cloud on transparent background, soft brown-tan suspended dust particles in a cluster shape, mostly transparent, particles visible as soft round flecks, fades to nothing at edges, top-down view, painterly digital art, transparent PNG' },

  // ── Light shafts / god rays ───────────────────────────────────────────
  { id: 'vfx_light_shaft_warm', size: '1024x1536', transparent: true,
    prompt: 'Dark fantasy warm orange light shaft on transparent background, vertical cone of soft warm orange light falling from above, narrow at top widening at bottom, semi-transparent volumetric look, fades to fully transparent at edges and bottom, billboard sprite, painterly digital art, transparent PNG' },
  { id: 'vfx_light_shaft_cold', size: '1024x1536', transparent: true,
    prompt: 'Dark fantasy cold pale-blue light shaft on transparent background, vertical cone of ghostly pale blue light falling from above, narrow at top widening at bottom, semi-transparent volumetric look, fades to fully transparent at edges and bottom, billboard sprite, painterly digital art, transparent PNG' },

  // ── Particles / embers ────────────────────────────────────────────────
  { id: 'vfx_ember_particle', size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy single glowing ember particle on transparent background, small bright orange-yellow molten spark with soft glow halo around it, fades to transparent at edges, designed to be used as instanced particles drifting upward, painterly digital art, transparent PNG' },
  { id: 'vfx_ash_particle', size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy single drifting ash flake on transparent background, small irregular gray flake with subtle glow, designed as an instanced particle drifting downward, painterly digital art, transparent PNG' },
  { id: 'vfx_spark_swirl', size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy curl of golden sparks on transparent background, a swirling arc of bright golden particles trailing through black, suitable as a billboard sprite to mark active ritual circles or interactable glow, painterly digital art, transparent PNG' },

  // ── Ground decals (animated subtly) ───────────────────────────────────
  { id: 'vfx_ground_rune_pulse', size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy glowing crimson rune circle on transparent background, top-down view of an intricate eldritch rune pattern inside a circle, soft red-orange glow, fades to transparent at outer edge, designed as a ground decal that will pulse opacity in-game, painterly digital art, transparent PNG' },
  { id: 'vfx_ground_blood_pool', size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy fresh blood pool decal on transparent background, top-down view of a glistening dark red blood puddle with irregular splatter edges, semi-transparent at edges, suitable as a ground decal, painterly digital art, transparent PNG' },

  // ── Cover prop textures (for proceduraly built pillars/rubble/arches) ─
  // These get baked onto the procedural geometry so cover pieces aren't
  // flat-colored stones anymore.
  { id: 'tex_carved_stone', size: '1024x1024', transparent: false,
    prompt: 'Dark fantasy seamless tileable carved gray stone texture, weathered ornate gothic carving with cracks and grime, suitable as a procedural-cover material map for broken pillars and rubble blocks, top-down view, painterly digital art, 1024x1024 PNG, tileable seamless' },
  { id: 'tex_rubble_stone', size: '1024x1024', transparent: false,
    prompt: 'Dark fantasy seamless tileable broken rubble stone texture, jagged broken stone chunks in shades of dark gray with dust and small cracks, suitable as a procedural rubble pile material map, top-down view, painterly digital art, 1024x1024 PNG, tileable seamless' },
  { id: 'tex_dark_wood_iron', size: '1024x1024', transparent: false,
    prompt: 'Dark fantasy seamless tileable dark iron-banded wood texture, deep brown wood planks with riveted iron strapping, suitable as a procedural material map for arches and beams, top-down view, painterly digital art, 1024x1024 PNG, tileable seamless' },
];

async function gen(asset) {
  const out = path.join(VFX_DIR, `${asset.id}.png`);
  if (fs.existsSync(out)) { console.log(`[skip] ${asset.id}`); return; }
  console.log(`[gen] ${asset.id} ${asset.size}...`);
  const body = {
    model: 'gpt-image-1',
    prompt: asset.prompt,
    n: 1,
    size: asset.size,
    quality: 'medium',
    output_format: 'png',
  };
  if (asset.transparent) body.background = 'transparent';
  try {
    const r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) {
      console.error(`[ERR ${asset.id}]`, JSON.stringify(d).slice(0, 300));
      return;
    }
    fs.writeFileSync(out, Buffer.from(d.data[0].b64_json, 'base64'));
    console.log(`[ok] ${asset.id}`);
  } catch (e) {
    console.error(`[ERR ${asset.id}]`, e.message);
  }
}

console.log(`=== Atmosphere assets: ${ASSETS.length} pieces ===`);
await Promise.all(ASSETS.map(gen));
console.log('=== Done ===');
