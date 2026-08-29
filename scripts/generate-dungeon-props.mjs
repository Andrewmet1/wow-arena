#!/usr/bin/env node
// Generate dungeon environment props via Meshy.
// These get scattered around dungeon rooms to make them feel like inhabited
// crypts/forges/throne rooms instead of empty box geometry.

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
const CONCEPTS_DIR = path.join(ROOT, 'public', 'assets', 'art', 'concepts');
fs.mkdirSync(PROPS_DIR, { recursive: true });

const PROPS = {
  sarcophagus: 'Single 3D dark fantasy stone sarcophagus, ancient carved coffin standing on the ground, weathered stone with bone reliefs, slightly cracked lid, isolated single object, T-pose-like front facing camera angle, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  brazier: 'Single 3D dark fantasy iron brazier, ornate metal bowl on three legs filled with glowing ember coals, slight smoke wisp, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  bone_pile: 'Single 3D dark fantasy pile of skulls and femurs, weathered yellowed bones stacked into a small mound about 2 feet tall, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  iron_chains: 'Single 3D dark fantasy hanging iron chains, three heavy rusted chain links draping from above with hooks at the ends, isolated single object, front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  fallen_banner: 'Single 3D dark fantasy fallen war banner on a broken pole, tattered crimson and black cloth with skull and ash heraldry slumped to the ground, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  rune_pillar: 'Single 3D dark fantasy short stone rune pillar, waist-high carved stone obelisk covered in glowing red runes, slight ember smoke at the top, isolated single object, front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function genConcept(id, prompt) {
  const out = path.join(CONCEPTS_DIR, `prop_${id}.png`);
  if (fs.existsSync(out)) { console.log(`[${id}] concept exists, skip`); return fs.readFileSync(out); }
  console.log(`[${id}] generating concept...`);
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
  console.log(`[${id}] meshy task ${taskId}`);
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
  const out = path.join(PROPS_DIR, `${id}.glb`);
  if (fs.existsSync(out)) { console.log(`[${id}] glb exists, skip`); return; }
  try {
    const buf = await genConcept(id, prompt);
    const result = await meshyImg23d(buf, id);
    const url = result.model_urls?.glb;
    if (!url) throw new Error('no glb url');
    const glbBuf = Buffer.from(await (await fetch(url)).arrayBuffer());
    fs.writeFileSync(out, glbBuf);
    console.log(`[${id}] saved ${(glbBuf.length / 1024 / 1024).toFixed(1)} MB`);
  } catch (e) {
    console.error(`[${id}] FAILED: ${e.message}`);
  }
}

await Promise.all(Object.entries(PROPS).map(([id, p]) => genProp(id, p)));
console.log('Props done.');
