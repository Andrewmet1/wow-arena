#!/usr/bin/env node
// AAA dungeon asset batch — interactive props, decorative statues, gate
// archways, banner variants, plus extra wall textures for chamber identity.
// Idempotent: skips files that already exist.

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

// ── Textures: archway / banner / decoration variants ─────────────────────
const TEXTURES = {
  archway_stone: 'Seamless tileable dark fantasy stone archway texture, finely carved gothic arch frame with relief sculptures of saints and demons, weathered grey stone with traces of gold leaf in the carvings, painterly digital art, flat orthographic front view, 1024x1024 seamless tile',
  banner_demonic: 'Tileable dark fantasy banner texture, deep crimson velvet with a black skull-and-thorn heraldry stitched in gold thread, frayed edges, hangs vertically, painterly digital art, flat orthographic front view, 512x1024 portrait tile',
  banner_holy: 'Tileable dark fantasy banner texture, deep blue velvet with a tarnished silver sun-and-flame heraldry, frayed edges, faded paint, hangs vertically, painterly digital art, flat orthographic front view, 512x1024 portrait tile',
  decal_holy_circle: 'Dark fantasy circular holy sigil decal on transparent background, stylized sun and laurel-wreath ring with runic script, glowing soft gold, painterly digital art, top-down view, 512x512 transparent PNG',
  decal_blood_runes: 'Dark fantasy circular blood-rune decal on transparent background, scrawled glyphs in dark red dripping outward from a central spiral, painterly digital art, top-down view, 512x512 transparent PNG',
  vfx_godray: 'Soft volumetric godray beam texture on transparent background, vertical cone of warm yellow-orange light fading at the edges, painterly digital art, 512x1024 transparent PNG',
};

async function genTexture(id, prompt) {
  const out = path.join(TEX_DIR, `${id}.png`);
  if (fs.existsSync(out)) { console.log(`[tex ${id}] skip`); return; }
  console.log(`[tex ${id}] generating...`);
  const useTransparent = id.startsWith('decal_') || id.startsWith('vfx_');
  const body = {
    model: 'gpt-image-1', prompt, n: 1,
    size: id.startsWith('banner_') ? '1024x1536' : '1024x1024',
    quality: 'medium', output_format: 'png',
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

// ── Props: interactive features + decorative statues + archways ──────────
const PROPS = {
  // Interactive (drives feature kinds: ritual_brazier, ancient_idol, cursed_bell)
  ritual_brazier_lit: 'Single 3D dark fantasy ornate ritual brazier with bright orange flames burning inside, tall iron tripod stand topped with a wide bowl, ember sparks rising, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  ancient_idol: 'Single 3D dark fantasy ancient stone idol, weathered humanoid statue with horned head and folded arms, glowing red rune at the chest, dark grey stone with red runic veins, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  cursed_bell: 'Single 3D dark fantasy cursed iron bell hanging from a stone arch, weathered black iron with skull engravings around the rim, glowing red runes etched on the surface, frayed rope dangling down, isolated single object, front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  // Visible doorway architecture
  gate_archway: 'Single 3D dark fantasy gothic stone archway gate, towering pointed arch carved with runic script, slight crimson glow in the keystone, dark weathered stone with cracked mortar, isolated single object, front view from the front of the arch, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  // Decorative scene-setters
  guardian_statue: 'Single 3D dark fantasy guardian statue, life-size kneeling armored knight with greatsword planted point-down, head bowed in eternal vigil, dark grey weathered stone, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  candelabrum_tall: 'Single 3D dark fantasy tall iron candelabrum, branching iron stand with five lit candles dripping wax, gothic ornate base, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  altar_runic: 'Single 3D dark fantasy runic altar, low rectangular stone slab with glowing red runes carved across its surface, blood channels running off the sides, ornate carved base, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  treasure_pile: 'Single 3D dark fantasy small pile of treasure spilling onto stone floor, gold coins and a few jeweled goblets and a crown, faintly glowing, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
};

async function genConcept(id, prompt) {
  const out = path.join(CONCEPT_DIR, `prop_${id}.png`);
  if (fs.existsSync(out)) { console.log(`[prop ${id}] concept skip`); return fs.readFileSync(out); }
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
  console.log(`[prop ${id}] meshy ${taskId}`);
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
  if (fs.existsSync(out)) { console.log(`[prop ${id}] glb skip`); return; }
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

console.log('=== AAA dungeon asset batch ===');
console.log('--- Textures ---');
await Promise.all(Object.entries(TEXTURES).map(([id, p]) => genTexture(id, p)));
console.log('--- Props ---');
for (const [id, p] of Object.entries(PROPS)) {
  await genProp(id, p);
}
console.log('=== Done ===');
