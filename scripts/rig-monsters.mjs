#!/usr/bin/env node
/**
 * Re-rig the 6 dungeon monsters that were generated unrigged.
 *
 * The original generate-monsters.mjs only ran Meshy image-to-3D, which
 * produces a static T-pose mesh. To animate them we need the additional
 * remesh → auto-rig pipeline (same as generate-skin.mjs uses for class
 * characters).
 *
 * This script takes the existing image-to-3D task IDs (preserved in the
 * background output log) and submits each to Meshy's remesh + rigging
 * endpoints. Replaces the unrigged GLBs in /public/assets/models/monsters/.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const envContent = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8');
const MESHY_KEY = envContent.match(/MESHY_API_KEY=(.+)/)?.[1]?.trim();
if (!MESHY_KEY) { console.error('Missing MESHY_API_KEY'); process.exit(1); }

const MESHY_API = 'https://api.meshy.ai';
const MONSTERS_DIR = path.join(ROOT, 'public', 'assets', 'models', 'monsters');

// Map of monster id -> Meshy image-to-3D task id (from the previous generation run)
const TASKS = {
  hellhound:        '019df5eb-5ec4-7a23-9421-f8c1f55fba74',
  ashen_warlord:    '019df5eb-5ea0-7a23-a010-70e89ca173ba',
  bone_cultist:     '019df5eb-7446-73e4-91aa-edec72f162cc',
  wraith_specter:   '019df5eb-74af-7a24-8742-90d2da581edb',
  drudgekin_brute:  '019df5eb-81fa-7a24-83f0-2ed5384cbd99',
  carrion_knight:   '019df5eb-83b1-7a24-81cd-7e95f64bce0b',
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function safeJson(res) { try { return await res.json(); } catch { return {}; } }

async function meshyPost(endpoint, body) {
  const res = await fetch(`${MESHY_API}${endpoint}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${MESHY_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(`POST ${endpoint} → ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

async function meshyPoll(endpoint, taskId, label) {
  for (let i = 0; i < 360; i++) {
    await sleep(5000);
    const res = await fetch(`${MESHY_API}${endpoint}/${taskId}`, {
      headers: { 'Authorization': `Bearer ${MESHY_KEY}` },
    });
    if (!res.ok) continue;
    const d = await safeJson(res);
    if (d.status === 'SUCCEEDED') return d;
    if (d.status === 'FAILED') throw new Error(`${label} ${taskId} failed: ${d.task_error?.message || 'unknown'}`);
    if (i % 6 === 0) console.log(`  [${label}] ${d.status} ${d.progress || 0}%`);
  }
  throw new Error(`${label} ${taskId} timed out`);
}

async function rigMonster(monsterId, imageTo3dTaskId) {
  console.log(`\n=== ${monsterId} ===`);
  console.log(`  Source task: ${imageTo3dTaskId}`);

  // Step 1: Remesh — reduce polycount so rigger can process it
  console.log('  Remeshing (target 200K polys)...');
  const remeshCreate = await meshyPost('/openapi/v1/remesh', {
    input_task_id: imageTo3dTaskId,
    target_polycount: 200000,
    topology: 'triangle',
  });
  const remeshTaskId = remeshCreate.result;
  console.log(`  Remesh task: ${remeshTaskId}`);
  await meshyPoll('/openapi/v1/remesh', remeshTaskId, 'remesh');
  console.log('  Remesh done');

  // Step 2: Rigging — Meshy adds a humanoid skeleton automatically
  console.log('  Auto-rigging (Meshy humanoid skeleton)...');
  const rigCreate = await meshyPost('/openapi/v1/rigging', {
    input_task_id: remeshTaskId,
    height_meters: 1.8,
  });
  const rigTaskId = rigCreate.result;
  console.log(`  Rig task: ${rigTaskId}`);
  const rigData = await meshyPoll('/openapi/v1/rigging', rigTaskId, 'rig');
  console.log('  Rig done');

  // Step 3: Download the rigged GLB
  const glbUrl = rigData.model_urls?.glb;
  if (!glbUrl) throw new Error(`No rigged GLB URL: ${JSON.stringify(rigData).slice(0, 200)}`);
  const buf = Buffer.from(await (await fetch(glbUrl)).arrayBuffer());
  const outPath = path.join(MONSTERS_DIR, `${monsterId}.glb`);
  fs.writeFileSync(outPath, buf);
  console.log(`  Saved rigged GLB: ${path.relative(ROOT, outPath)} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
  return { monsterId, rigTaskId };
}

const ids = Object.keys(TASKS);
console.log(`Re-rigging ${ids.length} monsters from existing image-to-3D tasks. ~5-10 min each, parallel.`);
Promise.all(ids.map(id => rigMonster(id, TASKS[id])
  .catch(err => { console.error(`[${id}] FAILED: ${err.message}`); return { monsterId: id, error: err.message }; })))
  .then(results => {
    const ok = results.filter(r => !r.error);
    console.log(`\nDone — ${ok.length}/${results.length} successfully rigged`);
    process.exit(ok.length === results.length ? 0 : 1);
  });
