#!/usr/bin/env node
/**
 * Generate themed floor + wall textures + interactive-feature Meshy GLBs
 * for the per-template chamber layouts. Runs DALL-E (gpt-image-1) for
 * textures, Meshy.ai image-to-3D for the 3 feature props.
 *
 * Usage:
 *   node scripts/generate-themed-environment.mjs            # generate all
 *   node scripts/generate-themed-environment.mjs textures   # textures only
 *   node scripts/generate-themed-environment.mjs props      # props only
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8');
const OPENAI_KEY = env.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const MESHY_KEY = env.match(/MESHY_API_KEY=(.+)/)?.[1]?.trim();
const MESHY_API = 'https://api.meshy.ai';

if (!OPENAI_KEY) { console.error('OPENAI_API_KEY missing'); process.exit(1); }

const TEX_DIR = path.join(ROOT, 'public', 'assets', 'art', 'dungeon');
const PROPS_DIR = path.join(ROOT, 'public', 'assets', 'models', 'props');
const CONCEPTS_DIR = path.join(ROOT, 'public', 'assets', 'art', 'concepts');
[TEX_DIR, PROPS_DIR, CONCEPTS_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

const FLOORS = {
  floor_crypt:
    'Top-down orthographic view of a seamless tileable repeating texture of an ancient stone burial-hall floor. Large rectangular tomb-slabs arranged in a regular grid, cracked and worn, with thin gold-leaf inscriptions in faded relief. Dark grey-blue stone, dust-filled cracks, scuffed footpath worn into the stone center. Diablo 2 dungeon aesthetic, painted-realistic, dark moody palette, no characters, no UI, seamless edges match perfectly, 2048x2048.',
  floor_chapel:
    'Top-down orthographic view of a seamless tileable repeating texture of a ruined cathedral floor. Large polished marble flagstones with hairline cracks, faded gold inlays in cross and rune patterns, scattered ash and rust stains, dried blood pooled near the seams. Stained glass shards scattered. Dark warm beige and grey palette with ember-orange highlights, Diablo cathedral aesthetic, no characters, no UI, seamless edges match perfectly, 2048x2048.',
  floor_ritual:
    'Top-down orthographic view of a seamless tileable repeating texture of a polished obsidian ritual floor. Black volcanic glass etched with luminous red runic spirals and pentagrams baked into the surface, faint embers glowing in the rune-grooves, soot stains and old blood crusts at the edges. Dark with red ember accents, Diablo ritual chamber aesthetic, no characters, no UI, seamless edges match perfectly, 2048x2048.',
  floor_bone_dust:
    'Top-down orthographic view of a seamless tileable repeating texture of an ossuary floor covered in compacted bone dust and skull fragments. Yellowed bone-ivory base, scattered finger bones and rib fragments embedded in the surface, dried blood smears. Pale cold palette with deep shadow cracks, Diablo bone chamber aesthetic, no characters, no UI, seamless edges match perfectly, 2048x2048.',
  floor_runic:
    'Top-down orthographic view of a seamless tileable repeating texture of a massive throne-room floor. Black basalt slabs inlaid with sharp gold and bloodred runic patterns radiating outward from a central focus, the rune grooves glowing faintly with infernal heat. Polished, regal, decay around the edges. Diablo boss-room aesthetic, no characters, no UI, seamless edges match perfectly, 2048x2048.',
  floor_obsidian_polished:
    'Top-down orthographic view of a seamless tileable repeating texture of polished black obsidian floor tiles. Glassy reflective surface with deep red veins running through, occasional spider-cracks revealing molten orange beneath. Dark with red-orange accents, Diablo demonic aesthetic, no characters, no UI, seamless edges match perfectly, 2048x2048.',
};

const WALLS = {
  wall_crypt:
    'Flat orthographic seamless tileable repeating texture of an ancient crypt wall. Tightly packed cut-stone blocks with carved grave-niches showing partial skulls and dried bones inside, faded runic inscriptions running horizontally, moss in the deepest cracks. Dark grey-blue stone, cold lighting suggested in the bake. Diablo crypt aesthetic, no characters, no UI, seamless edges match perfectly, 2048x2048.',
  wall_chapel:
    'Flat orthographic seamless tileable repeating texture of a ruined cathedral wall. Tall arched stone-block masonry, faded cherubic reliefs, broken pieces showing rebar-like iron skeletons inside, ash stains running down from soot-darkened areas above. Warm beige and grey, Diablo cathedral aesthetic, no characters, no UI, seamless edges match perfectly, 2048x2048.',
  wall_obsidian:
    'Flat orthographic seamless tileable repeating texture of an obsidian ritual chamber wall. Glassy black volcanic stone slabs with red rune-grooves running between them glowing faintly, sigils and bound demon symbols carved deep, scorch marks. Dark with red glow accents, Diablo demonic ritual aesthetic, no characters, no UI, seamless edges match perfectly, 2048x2048.',
  wall_bone:
    'Flat orthographic seamless tileable repeating texture of an ossuary wall constructed entirely of human skulls and femurs stacked tightly together in geometric patterns. Yellow-ivory bone tones, mortar gaps, occasional missing skulls revealing dark recesses. Pale cold palette, Diablo bone-dungeon aesthetic, no characters, no UI, seamless edges match perfectly, 2048x2048.',
  wall_runic:
    'Flat orthographic seamless tileable repeating texture of a massive boss-arena wall. Black basalt slabs alternating with bronze panels engraved with infernal runes that glow red-orange, gold trim, ornate scrollwork. Imposing, decay around the edges suggesting age. Diablo boss-throne aesthetic, no characters, no UI, seamless edges match perfectly, 2048x2048.',
};

const PROPS = {
  merchant_crucible:
    'Single 3D sculpted dark fantasy MERCHANT FIGURE for a Diablo-style dungeon. Hooded skeletal shopkeeper in tattered deep red robes with gold trim, standing behind a heavy iron-bound stone counter, twin glowing gold pinpoint eyes in the skull. On the counter: glowing gold coin pile, an open spellbook, a small skull. Bony hands resting forward. Three-quarter front view, isolated single object, dark moody studio lighting on transparent background, 3D model concept for image-to-3D generation, no characters in scene other than the shopkeeper figure.',
  puzzle_obelisk:
    'Single 3D sculpted dark fantasy ARCANE PUZZLE OBELISK for a Diablo-style dungeon. Tall standing four-sided black obsidian obelisk approximately 4 meters tall on a square stone plinth, four faces each showing a different glowing teal-cyan runic glyph (a flame, a snowflake, a skull, a star). A floating teal-cyan crystal orb hovers above the obelisk top, faint particle wisps. Pure puzzle/arcane device aesthetic, clearly distinct from a religious idol. Three-quarter front view, isolated single object, dark moody studio lighting on transparent background, 3D model concept for image-to-3D generation.',
  treasure_chest_dungeon:
    'Single 3D sculpted dark fantasy LOOT CHEST for a Diablo-style dungeon. Heavy aged wooden chest reinforced with thick iron bands and rivets, a gold-plated lock plate with a skull motif, four ornate gold corner posts. Lid slightly ajar with warm golden inner glow leaking out, hint of gold coins and a sword hilt visible inside. Chipped wood and tarnished gold for age. Square base proportions. Three-quarter front view, isolated single object, dark moody studio lighting on transparent background, 3D model concept for image-to-3D generation.',
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function genTex(id, prompt, sizeArg = '1024x1024') {
  const out = path.join(TEX_DIR, `${id}.png`);
  if (fs.existsSync(out)) { console.log(`[tex:${id}] exists, skip`); return; }
  console.log(`[tex:${id}] generating...`);
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: 'gpt-image-1', prompt, n: 1, size: sizeArg,
      quality: 'high', output_format: 'png',
    }),
  });
  const d = await r.json();
  if (!r.ok) { console.error(`[tex:${id}]`, JSON.stringify(d).slice(0, 300)); return; }
  const buf = Buffer.from(d.data[0].b64_json, 'base64');
  fs.writeFileSync(out, buf);
  console.log(`[tex:${id}] saved ${(buf.length / 1024).toFixed(0)} KB`);
}

async function genConcept(id, prompt) {
  const out = path.join(CONCEPTS_DIR, `prop_${id}.png`);
  if (fs.existsSync(out)) return fs.readFileSync(out);
  console.log(`[concept:${id}] generating...`);
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: 'gpt-image-1', prompt, n: 1, size: '1024x1024',
      quality: 'high', background: 'transparent', output_format: 'png',
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(d).slice(0, 300));
  const buf = Buffer.from(d.data[0].b64_json, 'base64');
  fs.writeFileSync(out, buf);
  return buf;
}

async function meshyImg23d(buf, id) {
  if (!MESHY_KEY) throw new Error('MESHY_API_KEY missing — cannot generate GLBs');
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
  if (!create.ok) throw new Error(`create: ${JSON.stringify(cd).slice(0, 300)}`);
  const taskId = cd.result;
  for (let i = 0; i < 360; i++) {
    await sleep(5000);
    const r = await fetch(`${MESHY_API}/openapi/v1/image-to-3d/${taskId}`, { headers: { 'Authorization': `Bearer ${MESHY_KEY}` } });
    const d = await r.json().catch(() => ({}));
    if (d.status === 'SUCCEEDED') return d;
    if (d.status === 'FAILED') throw new Error(`meshy: ${d.task_error?.message || 'unknown'}`);
    if (i % 6 === 0) console.log(`  [prop:${id}] ${d.status} ${d.progress || 0}%`);
  }
  throw new Error('timeout');
}

async function genProp(id, prompt) {
  const out = path.join(PROPS_DIR, `${id}.glb`);
  if (fs.existsSync(out)) { console.log(`[prop:${id}] exists, skip`); return; }
  try {
    console.log(`[prop:${id}] starting...`);
    const buf = await genConcept(id, prompt);
    const result = await meshyImg23d(buf, id);
    const url = result.model_urls?.glb;
    if (!url) throw new Error('no glb url');
    const glbBuf = Buffer.from(await (await fetch(url)).arrayBuffer());
    fs.writeFileSync(out, glbBuf);
    console.log(`[prop:${id}] saved ${(glbBuf.length / 1024 / 1024).toFixed(1)} MB`);
  } catch (e) {
    console.error(`[prop:${id}] FAILED: ${e.message}`);
  }
}

const mode = process.argv[2] || 'all';
const tasks = [];
if (mode === 'all' || mode === 'textures') {
  tasks.push(...Object.entries(FLOORS).map(([id, p]) => genTex(id, p, '1024x1024')));
  tasks.push(...Object.entries(WALLS).map(([id, p]) => genTex(id, p, '1024x1024')));
}
if (mode === 'all' || mode === 'props') {
  tasks.push(...Object.entries(PROPS).map(([id, p]) => genProp(id, p)));
}
await Promise.all(tasks);
console.log('Done.');
