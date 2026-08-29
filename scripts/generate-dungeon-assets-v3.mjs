#!/usr/bin/env node
// Wave 3: more environment props + atmosphere textures, modeled on Dark Souls /
// Hades / Diablo 4 environmental storytelling — ash piles, broken statues,
// hanging cages, ritual circles, ember pools. The dungeon should feel lived-in
// (and died-in) instead of empty geometry.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8');
const OPENAI_KEY = env.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const MESHY_KEY = env.match(/MESHY_API_KEY=(.+)/)?.[1]?.trim();
const MESHY_API = 'https://api.meshy.ai';

const PROPS_DIR = path.join(ROOT, 'public', 'assets', 'models', 'props');
const TEX_DIR = path.join(ROOT, 'public', 'assets', 'art', 'dungeon');
const CONCEPTS_DIR = path.join(ROOT, 'public', 'assets', 'art', 'concepts');
[PROPS_DIR, TEX_DIR, CONCEPTS_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

const PROPS = {
  broken_statue: 'Single 3D dark fantasy broken stone statue of a kneeling armored knight, headless or with a shattered face, weathered grey stone, the figure missing one arm, pedestal beneath, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  hanging_cage: 'Single 3D dark fantasy iron hanging cage / gibbet, rusted black iron bars forming a small humanoid-sized cage suspended from a heavy chain, slightly swinging, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  ritual_circle: 'Single 3D dark fantasy carved stone ritual circle floor decal, large round stone disc with deeply carved demonic runes glowing faint red, slight ash dust on top, isolated single object, top-down three-quarter view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  burial_urn: 'Single 3D dark fantasy stone burial urn / vessel, weathered grey ceramic with carved skull motifs, slight crack on the side, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  skull_idol: 'Single 3D dark fantasy stone skull idol on a small pillar, ancient menacing carved skull on top of a short carved stone column, glowing faint red eye sockets, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  ash_pile: 'Single 3D dark fantasy ash pile on the ground, large mound of grey ash with skeletal fragments and broken weapons protruding, low and wide, isolated single object, three-quarter view from above, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  ember_pool: 'Single 3D dark fantasy molten ember pool, flat circular pool of glowing red-orange liquid embers in a stone basin, slight smoke wisp rising, isolated single object, three-quarter view from above, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  iron_brazier_tall: 'Single 3D dark fantasy tall iron brazier on a tripod stand, wrought iron column reaching up to a wide bowl filled with glowing embers, decorative skull motifs on the legs, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
};

const TEXTURES = {
  wall_mossy: 'Seamless tileable dark fantasy stone wall texture covered in damp green-black moss patches, dripping water stains, dungeon crypt aesthetic, painterly digital art, flat orthographic front view, 1024x1024 seamless tile',
  wall_charred: 'Seamless tileable dark fantasy stone wall texture, blackened and soot-burned with patches of cracked exposed stone, embers glowing faintly in the cracks, painterly digital art, flat orthographic front view, 1024x1024 seamless tile',
  wall_bloodied: 'Seamless tileable dark fantasy stone wall texture with old dried blood splatters smeared across grey blocks, dungeon arena vibe, painterly digital art, flat orthographic front view, 1024x1024 seamless tile',
  floor_ashen: 'Seamless tileable dark fantasy stone floor texture covered in a thin layer of grey ash with footprints disturbing it, large weathered slabs visible underneath, painterly digital art, top-down orthographic view, 1024x1024 seamless tile',
  floor_cracked: 'Seamless tileable dark fantasy stone floor texture, large slabs broken with deep cracks running through them, debris scattered, painterly digital art, top-down orthographic view, 1024x1024 seamless tile',
  banner_red: 'Seamless tileable dark fantasy heavy banner texture, deep crimson red fabric with embroidered black skull and ash heraldry, edges frayed with battle damage, painterly digital art, flat orthographic front view, 1024x1024 seamless tile',
  banner_purple: 'Seamless tileable dark fantasy heavy banner texture, deep violet-black fabric with embroidered silver moon and bone heraldry, slightly torn, painterly digital art, flat orthographic front view, 1024x1024 seamless tile',
  ceiling_vaulted: 'Seamless tileable dark fantasy vaulted stone ceiling texture, dark grey stone arches converging into a central rib, painterly digital art, flat orthographic view from below, 1024x1024 seamless tile',
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function genTex(id, prompt) {
  const out = path.join(TEX_DIR, `${id}.png`);
  if (fs.existsSync(out)) { console.log(`[tex:${id}] exists, skip`); return; }
  console.log(`[tex:${id}] generating...`);
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: 'gpt-image-1', prompt, n: 1, size: '1024x1024', quality: 'medium', output_format: 'png' }),
  });
  const d = await r.json();
  if (!r.ok) { console.error(`[tex:${id}]`, JSON.stringify(d).slice(0, 200)); return; }
  const buf = Buffer.from(d.data[0].b64_json, 'base64');
  fs.writeFileSync(out, buf);
  console.log(`[tex:${id}] saved ${(buf.length / 1024).toFixed(0)} KB`);
}

async function genConcept(id, prompt) {
  const out = path.join(CONCEPTS_DIR, `prop_${id}.png`);
  if (fs.existsSync(out)) return fs.readFileSync(out);
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
  for (let i = 0; i < 360; i++) {
    await sleep(5000);
    const r = await fetch(`${MESHY_API}/openapi/v1/image-to-3d/${taskId}`, { headers: { 'Authorization': `Bearer ${MESHY_KEY}` } });
    const d = await r.json().catch(() => ({}));
    if (d.status === 'SUCCEEDED') return d;
    if (d.status === 'FAILED') throw new Error(`meshy: ${d.task_error?.message}`);
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

// Run textures + props in parallel — textures finish fast, props slow
await Promise.all([
  ...Object.entries(TEXTURES).map(([id, p]) => genTex(id, p)),
  ...Object.entries(PROPS).map(([id, p]) => genProp(id, p)),
]);
console.log('Wave 3 done.');
