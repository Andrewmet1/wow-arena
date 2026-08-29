#!/usr/bin/env node
/**
 * Finish the 2 monsters that failed:
 *   - bone_cultist: Meshy remesh failed with "internal server error". Retry
 *     remesh + rig from the original image-to-3D task.
 *   - hellhound: Meshy rigger requires humanoid; quadruped pose estimation
 *     fails. Regenerate concept art as a *bipedal* hound-warrior, then run
 *     the full pipeline image-to-3D → remesh → rig.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const envContent = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8');
const OPENAI_KEY = envContent.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const MESHY_KEY = envContent.match(/MESHY_API_KEY=(.+)/)?.[1]?.trim();
const MESHY_API = 'https://api.meshy.ai';
const MONSTERS_DIR = path.join(ROOT, 'public', 'assets', 'models', 'monsters');
const CONCEPTS_DIR = path.join(ROOT, 'public', 'assets', 'art', 'concepts');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function meshyPost(endpoint, body) {
  const res = await fetch(`${MESHY_API}${endpoint}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${MESHY_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`POST ${endpoint} → ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

async function meshyPoll(endpoint, taskId, label) {
  for (let i = 0; i < 360; i++) {
    await sleep(5000);
    const r = await fetch(`${MESHY_API}${endpoint}/${taskId}`, {
      headers: { 'Authorization': `Bearer ${MESHY_KEY}` },
    });
    const d = await r.json().catch(() => ({}));
    if (d.status === 'SUCCEEDED') return d;
    if (d.status === 'FAILED') throw new Error(`${label} ${taskId} failed: ${d.task_error?.message || 'unknown'}`);
    if (i % 6 === 0) console.log(`  [${label}] ${d.status} ${d.progress || 0}%`);
  }
  throw new Error(`${label} timed out`);
}

async function remeshAndRig(label, imageTo3dTaskId) {
  console.log(`\n[${label}] Remeshing from ${imageTo3dTaskId}...`);
  const remeshCreate = await meshyPost('/openapi/v1/remesh', {
    input_task_id: imageTo3dTaskId, target_polycount: 200000, topology: 'triangle',
  });
  await meshyPoll('/openapi/v1/remesh', remeshCreate.result, 'remesh');
  console.log(`[${label}] Rigging...`);
  const rigCreate = await meshyPost('/openapi/v1/rigging', {
    input_task_id: remeshCreate.result, height_meters: 1.8,
  });
  const rigData = await meshyPoll('/openapi/v1/rigging', rigCreate.result, 'rig');
  const glbUrl = rigData.result?.rigged_character_glb_url
              || rigData.rigged_character_glb_url
              || rigData.model_urls?.glb;
  if (!glbUrl) throw new Error(`[${label}] no GLB URL: ${JSON.stringify(rigData).slice(0, 300)}`);
  console.log(`[${label}] downloading ${glbUrl.slice(0, 80)}...`);
  const buf = Buffer.from(await (await fetch(glbUrl)).arrayBuffer());
  const outPath = path.join(MONSTERS_DIR, `${label}.glb`);
  fs.writeFileSync(outPath, buf);
  console.log(`[${label}] saved (${(buf.length / 1024 / 1024).toFixed(1)} MB rigged)`);
}

async function generateConcept(monsterId, prompt) {
  const outPath = path.join(CONCEPTS_DIR, `monster_${monsterId}.png`);
  console.log(`[${monsterId}] generating new humanoid concept...`);
  const resp = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: 'gpt-image-1', prompt,
      n: 1, size: '1024x1024', quality: 'high',
      background: 'transparent', output_format: 'png',
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`OpenAI: ${JSON.stringify(data).slice(0, 200)}`);
  const buf = Buffer.from(data.data[0].b64_json, 'base64');
  fs.writeFileSync(outPath, buf);
  return buf;
}

async function fullPipeline(monsterId, prompt) {
  // Concept art
  const imgBuf = await generateConcept(monsterId, prompt);
  // image-to-3D
  console.log(`[${monsterId}] image-to-3D...`);
  const create = await meshyPost('/openapi/v1/image-to-3d', {
    image_url: `data:image/png;base64,${imgBuf.toString('base64')}`,
    ai_model: 'meshy-5', topology: 'triangle', target_polycount: 30000,
    should_remesh: true, should_texture: true, enable_pbr: true,
  });
  const i23dData = await meshyPoll('/openapi/v1/image-to-3d', create.result, 'i23d');
  // remesh + rig
  await remeshAndRig(monsterId, create.result);
}

// ── Tasks ──────────────────────────────────────────────────────────
const tasks = [
  // bone_cultist: retry remesh+rig from existing image-to-3D task
  () => remeshAndRig('bone_cultist', '019df5eb-7446-73e4-91aa-edec72f162cc'),

  // hellhound: replace with humanoid hound-warrior (full pipeline)
  () => fullPipeline('hellhound', `Dark fantasy bipedal hound-warrior demon in T-pose for 3D rigging.
Humanoid jackal/wolf-headed creature standing upright on two legs, charred black fur with
glowing ember cracks across the body, exposed bone spikes along the spine, hollow burning
red eyes, lean muscular bipedal predator stance, hellish ash trailing from clawed hands,
ragged dark cloth wrappings around waist, no weapons.
Symmetrical T-pose, arms straight out to the sides, legs slightly apart, facing camera,
neutral expression, full body shot, dark moody studio lighting on transparent background,
3D character concept art suitable for image-to-3D generation.`),
];

await Promise.all(tasks.map(t => t().catch(err => console.error(err.message))));
console.log('\nDone.');
