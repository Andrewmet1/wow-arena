#!/usr/bin/env node
// Massive content gen pass: 5 new mob variants (Meshy 3D) + 4 themed bosses
// (Meshy 3D) + puzzle UI assets (DALL-E painted textures).
//
// Mobs are generated as concept PNG -> Meshy image-to-3D -> GLB.
// Bosses same pipeline at higher poly count.
// Puzzle UI is just DALL-E PNGs.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8');
const OPENAI_KEY = env.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const MESHY_KEY = env.match(/MESHY_API_KEY=(.+)/)?.[1]?.trim();
const MESHY_API = 'https://api.meshy.ai';

const MONSTER_DIR = path.join(ROOT, 'public', 'assets', 'models', 'monsters');
const CONCEPT_DIR = path.join(ROOT, 'public', 'assets', 'art', 'concepts');
const PUZZLE_DIR = path.join(ROOT, 'public', 'assets', 'art', 'ui', 'puzzles');
fs.mkdirSync(MONSTER_DIR, { recursive: true });
fs.mkdirSync(CONCEPT_DIR, { recursive: true });
fs.mkdirSync(PUZZLE_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── New mobs (5) ────────────────────────────────────────────────────────
const NEW_MOBS = {
  rotbringer_thrall: 'A hunched plague-infested zombie thrall, ribcage exposed with maggots crawling out, sickly green skin tones, long tattered shroud, hunched aggressive posture, dark fantasy game character',
  ashen_pyromancer: 'A dark robed pyromancer mage with cracked obsidian skin, glowing orange runes on body, hovering flame in one hand, hooded face hidden in shadow, dark fantasy game character',
  bone_warden: 'A skeletal armored warrior with rusted spiked plate armor, glowing red eyes in helmet, large two-handed warhammer, intimidating fighter stance, dark fantasy game character',
  shadow_stalker: 'A wraith-like assassin in tattered dark robes, smoky shadowy lower body fading to nothing, two glowing curved daggers, sinister hooded face, dark fantasy game character',
  crucible_hound: 'A demonic hellhound mid-stride, exposed glowing molten chest plates, four eyes, sharp jutting bone spines along spine, dark fantasy game creature',
};

// ── Themed bosses (4 new — one per non-crucible theme) ──────────────────
const NEW_BOSSES = {
  frostfire_magus: 'A towering arch-mage boss with frozen ice armor wrapped around a glowing magma core, half body of ice half body of flame, ornate crown of icicles and embers, two-handed crystal staff, dark fantasy game boss character',
  rotbringer_lord: 'A massive bloated necromancer boss covered in writhing tentacles and corrupted vines, three skull-faces emerging from torso, robe woven from rotting fabric, dark fantasy game boss character',
  hollow_saint: 'A fallen paladin boss in pristine white-and-gold plate armor pierced by spectral spears, halo of cracked light above broken helmet, two glowing seraph wings of pale fire, dark fantasy game boss character',
  dune_stalker: 'A predatory desert assassin boss, lean wiry body wrapped in sand-colored ritual bandages, four arms each holding a curved blade, mirage-shimmer effect around silhouette, mask with dozens of eye-holes, dark fantasy game boss character',
};

// ── Puzzle UI assets (DALL-E painted) ───────────────────────────────────
const PUZZLE_UI = [
  { id: 'glyph_fire',    prompt: 'Dark fantasy glowing red fire rune glyph on transparent background, single ornate eldritch symbol with crimson glow, painterly digital art icon, 1024x1024 transparent PNG' },
  { id: 'glyph_frost',   prompt: 'Dark fantasy glowing pale blue frost rune glyph on transparent background, single ornate eldritch symbol with icy glow, painterly digital art icon, 1024x1024 transparent PNG' },
  { id: 'glyph_shadow',  prompt: 'Dark fantasy glowing dark purple shadow rune glyph on transparent background, single ornate eldritch symbol with violet glow, painterly digital art icon, 1024x1024 transparent PNG' },
  { id: 'glyph_holy',    prompt: 'Dark fantasy glowing gold holy rune glyph on transparent background, single ornate eldritch symbol with bright golden glow, painterly digital art icon, 1024x1024 transparent PNG' },
  { id: 'glyph_nature',  prompt: 'Dark fantasy glowing green nature rune glyph on transparent background, single ornate eldritch symbol with verdant glow, painterly digital art icon, 1024x1024 transparent PNG' },
  { id: 'glyph_blood',   prompt: 'Dark fantasy glowing dark red blood rune glyph on transparent background, single ornate eldritch symbol with dripping crimson glow, painterly digital art icon, 1024x1024 transparent PNG' },
  { id: 'pressure_plate_off', prompt: 'Dark fantasy stone pressure plate floor tile on transparent background, top-down view, weathered square stone plate with iron rim and central rune carved into surface, painterly digital art, 1024x1024 transparent PNG' },
  { id: 'pressure_plate_on',  prompt: 'Dark fantasy stone pressure plate floor tile glowing with golden light on transparent background, top-down view, weathered square stone plate with iron rim and central rune glowing bright gold, painterly digital art, 1024x1024 transparent PNG' },
  { id: 'sacrifice_blood',   prompt: 'Dark fantasy painted choice card on transparent background, ornate parchment card with a chalice of blood at center and "SACRIFICE BLOOD" gothic text, painterly digital art, 1024x1024 transparent PNG' },
  { id: 'sacrifice_soul',    prompt: 'Dark fantasy painted choice card on transparent background, ornate parchment card with a glowing soul-flame at center and "SACRIFICE SOUL" gothic text, painterly digital art, 1024x1024 transparent PNG' },
  { id: 'sacrifice_flesh',   prompt: 'Dark fantasy painted choice card on transparent background, ornate parchment card with a beating heart at center and "SACRIFICE FLESH" gothic text, painterly digital art, 1024x1024 transparent PNG' },
  { id: 'brazier_unlit',     prompt: 'Dark fantasy unlit iron brazier with cold embers on transparent background, top-down view, simple iron bowl on tripod with dark coals, painterly digital art, 1024x1024 transparent PNG' },
  { id: 'brazier_lit',       prompt: 'Dark fantasy lit iron brazier with bright fire on transparent background, top-down view, iron bowl on tripod with leaping golden flames and ember sparks, painterly digital art, 1024x1024 transparent PNG' },
];

// ── Helpers ──────────────────────────────────────────────────────────────
async function genConcept(id, prompt, transparent = true) {
  const out = path.join(CONCEPT_DIR, `${id}_concept.png`);
  if (fs.existsSync(out)) return fs.readFileSync(out);
  console.log(`[concept ${id}]`);
  const body = {
    model: 'gpt-image-1', prompt, n: 1,
    size: '1024x1024', quality: 'medium', output_format: 'png',
  };
  if (transparent) body.background = 'transparent';
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(d).slice(0, 200));
  const buf = Buffer.from(d.data[0].b64_json, 'base64');
  fs.writeFileSync(out, buf);
  return buf;
}

async function meshyImageTo3D(buf, id) {
  const create = await fetch(`${MESHY_API}/openapi/v1/image-to-3d`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${MESHY_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: `data:image/png;base64,${buf.toString('base64')}`,
      ai_model: 'meshy-5', topology: 'triangle', target_polycount: 30000,
      should_remesh: true, should_texture: true, enable_pbr: true,
    }),
  });
  const cd = await create.json();
  if (!create.ok) throw new Error(`create: ${JSON.stringify(cd).slice(0, 200)}`);
  const taskId = cd.result;
  console.log(`[meshy ${id}] task ${taskId}`);
  for (let i = 0; i < 480; i++) {
    await sleep(5000);
    const r = await fetch(`${MESHY_API}/openapi/v1/image-to-3d/${taskId}`, {
      headers: { 'Authorization': `Bearer ${MESHY_KEY}` },
    });
    const d = await r.json().catch(() => ({}));
    if (d.status === 'SUCCEEDED') return d;
    if (d.status === 'FAILED') throw new Error(`failed: ${d.task_error?.message}`);
    if (i % 6 === 0) console.log(`  [${id}] ${d.status} ${d.progress || 0}%`);
  }
  throw new Error('timeout');
}

async function genMonster(id, prompt) {
  const outGlb = path.join(MONSTER_DIR, `${id}.glb`);
  if (fs.existsSync(outGlb)) { console.log(`[skip ${id}]`); return; }
  try {
    const buf = await genConcept(id, prompt);
    const result = await meshyImageTo3D(buf, id);
    const url = result.model_urls?.glb;
    if (!url) throw new Error('no glb');
    const glbBuf = Buffer.from(await (await fetch(url)).arrayBuffer());
    fs.writeFileSync(outGlb, glbBuf);
    console.log(`[ok ${id}] ${(glbBuf.length / 1024).toFixed(0)} KB`);
  } catch (e) {
    console.error(`[ERR ${id}]`, e.message);
  }
}

async function genPuzzleAsset(asset) {
  const out = path.join(PUZZLE_DIR, `${asset.id}.png`);
  if (fs.existsSync(out)) { console.log(`[skip ${asset.id}]`); return; }
  console.log(`[ui ${asset.id}]`);
  try {
    const r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: 'gpt-image-1', prompt: asset.prompt, n: 1,
        size: '1024x1024', quality: 'medium', output_format: 'png',
        background: 'transparent',
      }),
    });
    const d = await r.json();
    if (!r.ok) { console.error(`[ERR ${asset.id}]`, JSON.stringify(d).slice(0, 200)); return; }
    fs.writeFileSync(out, Buffer.from(d.data[0].b64_json, 'base64'));
    console.log(`[ok ${asset.id}]`);
  } catch (e) {
    console.error(`[ERR ${asset.id}]`, e.message);
  }
}

console.log('=== Mobs + bosses + puzzle assets ===');
// Puzzle UI is fast — run first
await Promise.all(PUZZLE_UI.map(genPuzzleAsset));
// Mobs + bosses are slow (Meshy ~5-10 min each); kick them all in parallel
const allMeshy = [
  ...Object.entries(NEW_MOBS).map(([id, p]) => genMonster(id, p)),
  ...Object.entries(NEW_BOSSES).map(([id, p]) => genMonster(id, p)),
];
await Promise.all(allMeshy);
console.log('=== Done ===');
