#!/usr/bin/env node
// Phase 2 asset gen — expand the dungeon's texture + prop pool so the new
// chamber templates have their own visual identity. Runs in background while
// the wing/template system is built.
//
// Generates: 5 new wall textures, 4 new floor textures, 1 ceiling variant,
// 2 decoration textures, ~10 new prop GLBs via Meshy.
//
// Re-runs are idempotent — skips files that already exist.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8');
const OPENAI_KEY = env.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const MESHY_KEY  = env.match(/MESHY_API_KEY=(.+)/)?.[1]?.trim();
const MESHY_API  = 'https://api.meshy.ai';

const TEX_DIR     = path.join(ROOT, 'public', 'assets', 'art', 'dungeon');
const PROP_DIR    = path.join(ROOT, 'public', 'assets', 'models', 'props');
const CONCEPT_DIR = path.join(ROOT, 'public', 'assets', 'art', 'concepts');
fs.mkdirSync(TEX_DIR, { recursive: true });
fs.mkdirSync(PROP_DIR, { recursive: true });
fs.mkdirSync(CONCEPT_DIR, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── New textures for chamber templates ─────────────────────────────────────
const TEXTURES = {
  // Ossuary chamber: bone-stacked walls
  wall_bone: 'Seamless tileable dark fantasy bone wall texture, stacked human skulls and femurs cemented into a wall with dark grey mortar, weathered yellow-grey bone, painterly digital art, flat orthographic front view, 1024x1024 seamless tile',
  floor_bone_dust: 'Seamless tileable dark fantasy bone-dust floor texture, grey-white powdered stone floor with scattered bone fragments and black ash trails, painterly digital art, top-down orthographic view, 1024x1024 seamless tile',

  // Collapsed chapel: carved religious stone
  wall_chapel: 'Seamless tileable dark fantasy chapel wall texture, large carved stone blocks with weathered religious bas-relief of broken angelic figures and dark fantasy iconography, faded paint cracking off, painterly digital art, flat orthographic front view, 1024x1024 seamless tile',
  floor_chapel: 'Seamless tileable dark fantasy cathedral floor texture, alternating dark and pale marble tiles in an aged checker pattern with worn edges and faint runic inlays, painterly digital art, top-down orthographic view, 1024x1024 seamless tile',

  // Ritual pit: carved obsidian with glowing veins
  wall_obsidian: 'Seamless tileable dark fantasy obsidian wall texture, polished black volcanic stone with thin glowing red lava-rune veins running through cracks, painterly digital art, flat orthographic front view, 1024x1024 seamless tile',
  floor_ritual: 'Seamless tileable dark fantasy ritual chamber floor texture, polished black stone with concentric red glowing runic circles inscribed across, sacrifice patterns, painterly digital art, top-down orthographic view, 1024x1024 seamless tile',

  // Pillar gauntlet: weathered colonnade
  wall_columned: 'Seamless tileable dark fantasy pillared corridor wall, dark grey stone with shallow pilasters and tall narrow window slits glowing faintly with embers from outside, painterly digital art, flat orthographic front view, 1024x1024 seamless tile',

  // Long hall: deep crypt
  wall_crypt: 'Seamless tileable dark fantasy crypt wall texture, narrow grave alcoves carved into stone with iron grates over each, weathered black-grey stone, painterly digital art, flat orthographic front view, 1024x1024 seamless tile',
  floor_crypt: 'Seamless tileable dark fantasy crypt floor texture, narrow rectangular flagstones with thin water channels between them, dark moss in the cracks, painterly digital art, top-down orthographic view, 1024x1024 seamless tile',

  // Ceiling variants
  ceiling_vault: 'Seamless tileable dark fantasy stone vault ceiling, ribbed gothic vaulted stone with iron struts, painterly digital art, flat orthographic view from below, 1024x1024 seamless tile',

  // Decoration textures (used as decals / banners / floor glyphs)
  decal_skull_glyph: 'Dark fantasy circular skull glyph decal on transparent background, ornate ringed sigil with a stylized skull at center surrounded by runic script, glowing crimson, painterly digital art, 512x512 transparent PNG',
  decal_blood_splatter: 'Dark fantasy floor blood splatter decal on transparent background, dried blood pool spreading across stone, painterly digital art, top-down view, 512x512 transparent PNG',
};

async function genTexture(id, prompt) {
  const out = path.join(TEX_DIR, `${id}.png`);
  if (fs.existsSync(out)) { console.log(`[tex ${id}] exists, skip`); return; }
  console.log(`[tex ${id}] generating...`);
  const useTransparent = id.startsWith('decal_');
  const body = {
    model: 'gpt-image-1',
    prompt,
    n: 1,
    size: useTransparent ? '1024x1024' : '1024x1024',
    quality: 'medium',
    output_format: 'png',
  };
  if (useTransparent) body.background = 'transparent';
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) { console.error(`[tex ${id}]`, JSON.stringify(d).slice(0, 200)); return; }
  fs.writeFileSync(out, Buffer.from(d.data[0].b64_json, 'base64'));
  console.log(`[tex ${id}] saved`);
}

// ── New props for chamber templates ────────────────────────────────────────
const PROPS = {
  stone_altar: 'Single 3D dark fantasy stone altar, large flat slab on a stepped base with bloodstain runnels carved into the top surface, dark grey weathered stone with red iron staining, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  broken_pillar: 'Single 3D dark fantasy broken stone pillar, fluted classical column snapped at the midpoint, the upper half toppled to the ground beside the standing base, dark grey weathered stone, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  skull_stack: 'Single 3D dark fantasy stack of stacked skulls in a niche shape, about 30 yellowed skulls neatly stacked into a low pyramid, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  ritual_circle_large: 'Single 3D dark fantasy large ritual circle on a thin stone disc, intricate carved runic patterns radiating from a central glyph, glowing red embers tracing the lines, isolated single object, top-down view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  hanging_cage_skeleton: 'Single 3D dark fantasy hanging iron cage with a skeleton inside, rusted bars holding a slumped human skeleton with rotting cloth scraps, hanging from a chain at the top, isolated single object, front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  treasure_chest_open: 'Single 3D dark fantasy ornate iron-bound wooden chest with the lid slightly open, glowing golden light spilling out from inside, dark stained oak with riveted iron strapping and a heavy gothic lock, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  treasure_chest_locked: 'Single 3D dark fantasy ornate iron-bound wooden chest closed with a heavy gothic skull-shaped lock, dark stained oak with rusted iron strapping, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  lever_pillar: 'Single 3D dark fantasy ritual lever pillar, waist-high carved black stone post with an iron lever handle on top, glowing red rune at the base, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  collapsed_archway: 'Single 3D dark fantasy collapsed stone archway, broken gothic arch with rubble piled around the base, partially open passage in the center, dark grey weathered stone with red ash dust, isolated single object, front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  pew_broken: 'Single 3D dark fantasy broken church pew, splintered dark wood bench tipped sideways, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
};

async function genConcept(id, prompt) {
  const out = path.join(CONCEPT_DIR, `prop_${id}.png`);
  if (fs.existsSync(out)) {
    console.log(`[prop ${id}] concept exists, skip gen`);
    return fs.readFileSync(out);
  }
  console.log(`[prop ${id}] generating concept...`);
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: 'gpt-image-1', prompt, n: 1, size: '1024x1024', quality: 'medium', background: 'transparent', output_format: 'png' }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(d).slice(0, 200));
  const buf = Buffer.from(d.data[0].b64_json, 'base64');
  fs.writeFileSync(out, buf);
  return buf;
}

async function meshyImg23d(buf, id) {
  const create = await fetch(`${MESHY_API}/openapi/v1/image-to-3d`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${MESHY_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: `data:image/png;base64,${buf.toString('base64')}`,
      ai_model: 'meshy-5', topology: 'triangle', target_polycount: 15000,
      should_remesh: true, should_texture: true, enable_pbr: true,
    }),
  });
  const cd = await create.json();
  if (!create.ok) throw new Error(`create: ${JSON.stringify(cd).slice(0, 200)}`);
  const taskId = cd.result;
  console.log(`[prop ${id}] meshy task ${taskId}`);
  for (let i = 0; i < 360; i++) {
    await sleep(5000);
    const r = await fetch(`${MESHY_API}/openapi/v1/image-to-3d/${taskId}`, { headers: { 'Authorization': `Bearer ${MESHY_KEY}` } });
    const d = await r.json().catch(() => ({}));
    if (d.status === 'SUCCEEDED') return d;
    if (d.status === 'FAILED') throw new Error(`meshy failed: ${d.task_error?.message}`);
    if (i % 6 === 0) console.log(`  [${id}] ${d.status} ${d.progress || 0}%`);
  }
  throw new Error('timeout');
}

async function genProp(id, prompt) {
  const out = path.join(PROP_DIR, `${id}.glb`);
  if (fs.existsSync(out)) { console.log(`[prop ${id}] glb exists, skip`); return; }
  try {
    const buf = await genConcept(id, prompt);
    const result = await meshyImg23d(buf, id);
    const url = result.model_urls?.glb;
    if (!url) throw new Error('no glb url');
    const glbBuf = Buffer.from(await (await fetch(url)).arrayBuffer());
    fs.writeFileSync(out, glbBuf);
    console.log(`[prop ${id}] saved ${(glbBuf.length / 1024).toFixed(0)} KB`);
  } catch (err) {
    console.error(`[prop ${id}] failed:`, err.message);
  }
}

// ── Run ────────────────────────────────────────────────────────────────────
console.log('=== Phase 2 asset generation ===');

// Textures (parallel)
console.log('--- Textures ---');
await Promise.all(Object.entries(TEXTURES).map(([id, p]) => genTexture(id, p)));

// Props (sequential — Meshy throttles concurrent jobs)
console.log('--- Props ---');
for (const [id, p] of Object.entries(PROPS)) {
  await genProp(id, p);
}

console.log('=== Done ===');
