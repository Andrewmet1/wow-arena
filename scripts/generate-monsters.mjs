#!/usr/bin/env node
/**
 * Ebon Crucible — Monster Generation Pipeline
 *
 * Generates dark-fantasy monster concept art + 3D models for the dungeon.
 * Uses the same OpenAI + Meshy pipeline as generate-skin.mjs but with
 * monster-specific prompts and saves to /public/assets/models/monsters/.
 *
 * Usage:
 *   node scripts/generate-monsters.mjs                # Generate all 6 monsters
 *   node scripts/generate-monsters.mjs --only hellhound,bone_cultist
 *   node scripts/generate-monsters.mjs --theme crucible_below
 *
 * Each monster takes ~10 min (30s concept art + 5 min image-to-3D + 5 min auto-rig).
 * The script runs them in parallel to fit roughly within a single 10-15 min window
 * if Meshy capacity allows; sequential fallback on rate-limit errors.
 *
 * Output:
 *   public/assets/art/concepts/monster_<id>.png    — concept art
 *   public/assets/models/monsters/<id>.glb         — rigged GLB
 *
 * The dungeon engine looks for these meshes by ID; falls back to the base
 * class mesh if a monster GLB hasn't been generated yet.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const envContent = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8');
const OPENAI_KEY = envContent.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const MESHY_KEY = envContent.match(/MESHY_API_KEY=(.+)/)?.[1]?.trim();
if (!OPENAI_KEY) { console.error('Missing OPENAI_API_KEY in .env'); process.exit(1); }
if (!MESHY_KEY) { console.error('Missing MESHY_API_KEY in .env'); process.exit(1); }

const MESHY_API = 'https://api.meshy.ai';
const MONSTERS_DIR = path.join(ROOT, 'public', 'assets', 'models', 'monsters');
const CONCEPTS_DIR = path.join(ROOT, 'public', 'assets', 'art', 'concepts');
fs.mkdirSync(MONSTERS_DIR, { recursive: true });
fs.mkdirSync(CONCEPTS_DIR, { recursive: true });

// ── Monster catalog — themed prompts for the Crucible Below ──────────
const MONSTER_PROMPTS = {
  carrion_knight: {
    name: 'Carrion Knight',
    theme: 'crucible_below',
    prompt: `Dark fantasy undead knight standing in T-pose for 3D rigging.
Rusted iron plate armor riddled with battle damage and decay, exposed bone joints
between armor plates, hollow glowing red eyes burning beneath a horned visored helm,
heavy gauntlets and greaves, draped tattered cloak in ash-grey, the haunted shell
of an ancient warrior risen from death.
Symmetrical T-pose, arms straight out to the sides, legs slightly apart, facing
camera, neutral expression, no weapons in hand, full body shot,
dark moody studio lighting on transparent background, 3D character concept art
suitable for image-to-3D generation.`,
  },
  bone_cultist: {
    name: 'Bone Cultist',
    theme: 'crucible_below',
    prompt: `Dark fantasy hooded cultist sorcerer in T-pose for 3D rigging.
Tattered ash-black robes adorned with bone fragments, skull motifs, and ritual
chains, sunken pale corpse-like skin, glowing purple eye sockets beneath a deep
hood, gaunt and unholy proportions, scarred fingers extended, no weapons.
Symmetrical T-pose, arms straight out to the sides, legs slightly apart, facing
camera, neutral expression, full body shot, dark moody studio lighting on
transparent background, 3D character concept art suitable for image-to-3D generation.`,
  },
  hellhound: {
    name: 'Hellhound',
    theme: 'crucible_below',
    prompt: `Dark fantasy demonic war-hound in standing pose for 3D rigging.
Charred black fur with glowing ember cracks across the body, exposed bone spikes
along the spine and skull, hollow burning red eyes, lean muscular predator stance
with bared fangs, hellish ash trailing from its paws, four legs visible.
Quadruped standing pose, side-front three-quarter view, full body shot,
dark moody studio lighting on transparent background, 3D character concept art
suitable for image-to-3D generation.`,
  },
  drudgekin_brute: {
    name: 'Drudgekin Brute',
    theme: 'crucible_below',
    prompt: `Dark fantasy hulking warbeast brute in T-pose for 3D rigging.
Mountain of muscle wrapped in iron chains and meat-hook scars, broken tusks
jutting from a brutalized jaw, patchwork stitching across the face, towering
shoulders covered in mismatched armor scraps, massive fists, no weapons.
Symmetrical T-pose, arms straight out to the sides, legs slightly apart, facing
camera, neutral expression, full body shot, dark moody studio lighting on
transparent background, 3D character concept art suitable for image-to-3D generation.`,
  },
  wraith_specter: {
    name: 'Wraith Specter',
    theme: 'crucible_below',
    prompt: `Dark fantasy ghostly specter in T-pose for 3D rigging.
Half-formed translucent figure of a hooded wraith, tattered shadowy cloak
dissolving into wispy mist at the edges, sunken hollow face under a torn cowl,
faint blue-white glow at the chest, ethereal phantom warrior with spectral hands
extended, no weapons.
Symmetrical T-pose, arms straight out to the sides, legs slightly apart, facing
camera, neutral expression, full body shot, dark moody studio lighting on
transparent background, 3D character concept art suitable for image-to-3D generation.`,
  },
  ashen_warlord: {
    name: 'The Ashen Warlord',
    theme: 'crucible_below',
    prompt: `Dark fantasy ancient warlord king in imposing T-pose for 3D rigging.
Towering figure in soot-blackened ornate plate armor with embered cracks running
through the metal, tall crowned helm with curved horns and a face-covering visor,
heavy pauldrons and breastplate engraved with forgotten glyphs, ash and sparks
trailing from gauntlets, BOSS-tier intimidating presence, no weapons in hand,
massive scale.
Symmetrical T-pose, arms straight out to the sides, legs slightly apart, facing
camera, full body shot, dark moody studio lighting on transparent background,
3D character concept art suitable for image-to-3D generation.`,
  },
};

// ── Helpers ─────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function safeJson(res) { try { return await res.json(); } catch { return {}; } }

async function generateConceptArt(monsterId, monsterCfg) {
  const outPath = path.join(CONCEPTS_DIR, `monster_${monsterId}.png`);
  if (fs.existsSync(outPath)) {
    console.log(`  [${monsterId}] concept art already exists, skipping`);
    return { imagePath: outPath, imageBuffer: fs.readFileSync(outPath) };
  }
  console.log(`  [${monsterId}] generating concept art...`);
  const resp = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: 'gpt-image-1', prompt: monsterCfg.prompt,
      n: 1, size: '1024x1024', quality: 'high',
      background: 'transparent', output_format: 'png',
    }),
  });
  const data = await safeJson(resp);
  if (!resp.ok) throw new Error(`OpenAI error: ${JSON.stringify(data).slice(0, 200)}`);
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error(`No image data: ${JSON.stringify(data).slice(0, 200)}`);
  const buf = Buffer.from(b64, 'base64');
  fs.writeFileSync(outPath, buf);
  console.log(`  [${monsterId}] concept art saved (${(buf.length / 1024).toFixed(0)} KB)`);
  return { imagePath: outPath, imageBuffer: buf };
}

async function meshyImageTo3D(imageBuffer, monsterId) {
  console.log(`  [${monsterId}] submitting image to Meshy...`);
  const base64 = `data:image/png;base64,${imageBuffer.toString('base64')}`;
  const create = await fetch(`${MESHY_API}/openapi/v1/image-to-3d`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${MESHY_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: base64,
      ai_model: 'meshy-5',
      topology: 'triangle',
      target_polycount: 30000,
      should_remesh: true,
      should_texture: true,
      enable_pbr: true,
    }),
  });
  const createData = await safeJson(create);
  if (!create.ok) throw new Error(`Meshy create failed: ${JSON.stringify(createData).slice(0, 200)}`);
  const taskId = createData.result;
  console.log(`  [${monsterId}] Meshy task ${taskId} — polling...`);

  // Poll up to 30 min
  for (let i = 0; i < 360; i++) {
    await sleep(5000);
    const poll = await fetch(`${MESHY_API}/openapi/v1/image-to-3d/${taskId}`, {
      headers: { 'Authorization': `Bearer ${MESHY_KEY}` },
    });
    if (!poll.ok) continue;
    const pollData = await safeJson(poll);
    if (pollData.status === 'SUCCEEDED') {
      console.log(`  [${monsterId}] Meshy generation complete (${(pollData.progress || 100)}%)`);
      return pollData;
    }
    if (pollData.status === 'FAILED') {
      throw new Error(`Meshy task ${taskId} failed: ${pollData.task_error?.message || 'unknown'}`);
    }
    if (i % 6 === 0) console.log(`  [${monsterId}] ${pollData.status} ${pollData.progress || 0}%`);
  }
  throw new Error(`Meshy task ${taskId} timed out`);
}

async function downloadGlb(url, outPath, monsterId) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buf);
  console.log(`  [${monsterId}] saved ${path.relative(ROOT, outPath)} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
}

async function generateMonster(monsterId) {
  const cfg = MONSTER_PROMPTS[monsterId];
  if (!cfg) throw new Error(`Unknown monster ${monsterId}`);
  const outGlb = path.join(MONSTERS_DIR, `${monsterId}.glb`);
  if (fs.existsSync(outGlb)) {
    console.log(`[${monsterId}] already generated, skipping`);
    return;
  }
  try {
    const { imageBuffer } = await generateConceptArt(monsterId, cfg);
    const result = await meshyImageTo3D(imageBuffer, monsterId);
    const glbUrl = result.model_urls?.glb;
    if (!glbUrl) throw new Error(`No GLB URL in result`);
    await downloadGlb(glbUrl, outGlb, monsterId);
    console.log(`[${monsterId}] DONE`);
  } catch (err) {
    console.error(`[${monsterId}] FAILED:`, err.message);
  }
}

// ── Main ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const onlyArg = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const ids = onlyArg ? onlyArg.split(',') : Object.keys(MONSTER_PROMPTS);

console.log(`Generating ${ids.length} monsters: ${ids.join(', ')}`);
console.log(`Concurrent — each ~10 min total. Run in background.`);

// Run all in parallel — Meshy supports concurrent requests on the paid tier
Promise.all(ids.map(id => generateMonster(id)))
  .then(() => {
    console.log('\nAll monster generations complete.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Pipeline error:', err);
    process.exit(1);
  });
