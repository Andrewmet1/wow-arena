#!/usr/bin/env node
/**
 * Regenerate class character models using Meshy Image-to-3D + Rigging API.
 * Uses class splash art as reference image, with texture_prompt to guide style.
 *
 * Pipeline: Splash Art → Image-to-3D (with texture_prompt + pose_mode) → Rigging → GLB
 *
 * --no-weapons mode uses:
 *   - texture_prompt: explicitly requests "no weapons, empty hands"
 *   - pose_mode: 'a-pose' for clean rigging-ready pose
 *
 * Usage: node scripts/regenerate-model.mjs <classId|all> [--no-weapons] [--skip-rig] [--rig-only <taskId>]
 * Example: node scripts/regenerate-model.mjs tyrant --no-weapons
 *          node scripts/regenerate-model.mjs all --no-weapons
 *          node scripts/regenerate-model.mjs tyrant --rig-only 019c69f0-...
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Load .env
const envPath = path.join(ROOT, '.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const API_KEY = envContent.match(/MESHY_API_KEY=(.+)/)?.[1]?.trim();
if (!API_KEY) {
  console.error('Missing MESHY_API_KEY in .env');
  process.exit(1);
}

const MESHY_API = 'https://api.meshy.ai';

// Class config — uses splash art as input for Image-to-3D.
// texture_prompt guides both texturing and (to some extent) geometry.
// noweapons_texture_prompt explicitly requests no weapons + empty hands.
const CLASS_CONFIG = {
  tyrant: {
    portrait: 'tyrant_splash.png',
    portrait_fallback: 'tyrant_splash.webp',
    texture_prompt: 'Dark black plate armor with crimson battle damage, massive glowing red-orange fire greatsword blade held upright, demonic skull engravings, red cape, dark steel gauntlets and pauldrons, high detail PBR textures',
    noweapons_texture_prompt: 'Dark fantasy armored warlord standing in A-pose, heavy black plate armor with crimson battle damage, demonic skull engravings on pauldrons and breastplate, red cape, dark steel gauntlets and greaves, arms at sides with open empty hands, absolutely no weapons no sword no greatsword no blade, high detail PBR textures',
  },
  wraith: {
    portrait: 'wraith_splash.png',
    portrait_fallback: 'wraith_splash.webp',
    texture_prompt: 'Dark purple-indigo fitted leather armor with silver buckles, two glowing purple ethereal curved daggers, purple energy wisps, dark hood and bird-like mask, tattered cloak, dark leather boots, high detail PBR textures',
    noweapons_texture_prompt: 'Dark fantasy shadow assassin standing in A-pose, dark purple-indigo fitted leather armor with silver buckles, dark hood and bird-like mask, tattered cloak, dark leather boots, arms at sides with open empty hands, absolutely no weapons no daggers no blades no knives, high detail PBR textures',
  },
  infernal: {
    portrait: 'infernal_splash.png',
    portrait_fallback: 'infernal_splash.webp',
    texture_prompt: 'Dark flowing robes with lava and molten ember cracks, glowing orange eye sockets under dark hood, skull face, ornate fire staff with crystal top, charcoal and deep orange fabric, high detail PBR textures',
    noweapons_texture_prompt: 'Dark fantasy fire mage standing in A-pose, dark flowing robes with lava and molten ember cracks, glowing orange eye sockets under dark hood, charcoal and deep orange fabric, arms at sides with open empty hands, absolutely no weapons no staff no wand no orb, high detail PBR textures',
  },
  harbinger: {
    portrait: 'harbinger_splash.png',
    portrait_fallback: 'harbinger_splash.webp',
    texture_prompt: 'Tattered dark green and black robes, large curved ram horns with ridges, skeletal face with green glowing eyes, open glowing green grimoire book, skull belt accessories, bone ornaments, high detail PBR textures',
    noweapons_texture_prompt: 'Dark fantasy death warlock standing in A-pose, tattered dark green and black robes, large curved ram horns with ridges, skeletal face with green glowing eyes, skull belt accessories, bone ornaments, arms at sides with open empty hands, absolutely no weapons no book no grimoire no staff, high detail PBR textures',
  },
  revenant: {
    portrait: 'revenant_splash.png',
    portrait_fallback: 'revenant_splash.webp',
    texture_prompt: 'Dark fantasy holy crusader knight, ivory white tabard draped over weathered bronze and dark steel plate armor, ornate golden cross emblem on chest, aged gold trim accents only, warm dark tones, battle-worn sacred warrior, muted color palette, high detail PBR textures',
    noweapons_texture_prompt: 'Dark fantasy holy paladin knight standing in A-pose, ivory white tabard over weathered bronze and dark steel plate armor, ornate golden cross emblem on chest, aged gold trim accents, warm dark tones, arms at sides with open empty hands, absolutely no weapons no sword no shield no mace, high detail PBR textures',
  },
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Convert a webp image to PNG and return as base64 data URI.
 * Uses macOS sips for conversion (no npm dependencies needed).
 */
function imageToBase64DataUri(imagePath) {
  const ext = path.extname(imagePath).toLowerCase();

  if (ext === '.webp') {
    // Convert webp to png using sips (macOS built-in)
    const tmpPng = imagePath.replace('.webp', '_tmp.png');
    try {
      execSync(`sips -s format png "${imagePath}" --out "${tmpPng}" 2>/dev/null`);
      const pngBuffer = fs.readFileSync(tmpPng);
      fs.unlinkSync(tmpPng); // cleanup
      return `data:image/png;base64,${pngBuffer.toString('base64')}`;
    } catch (e) {
      console.warn('  sips conversion failed, trying direct read...');
    }
  }

  // For png/jpg, read directly
  const buffer = fs.readFileSync(imagePath);
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

async function apiPost(endpoint, body) {
  const res = await fetch(`${MESHY_API}${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API POST ${endpoint} failed (${res.status}): ${text}`);
  }

  return res.json();
}

async function pollTask(endpoint, taskId) {
  const maxAttempts = 360; // 30 min max
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`${MESHY_API}${endpoint}/${taskId}`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
    });

    if (!res.ok) {
      console.warn(`  Poll failed (${res.status}), retrying...`);
      await sleep(5000);
      continue;
    }

    const data = await res.json();
    const task_status = data.status;

    if (task_status === 'SUCCEEDED') {
      return data;
    } else if (task_status === 'FAILED') {
      throw new Error(`Task ${taskId} failed: ${data.task_error?.message || JSON.stringify(data)}`);
    }

    const progress = data.progress || 0;
    process.stdout.write(`  Status: ${task_status} (${progress}% | attempt ${i + 1}/${maxAttempts})    \r`);
    await sleep(5000);
  }

  throw new Error(`Task ${taskId} timed out after 30 minutes`);
}

async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
  console.log(`  Saved: ${destPath} (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);
}

async function regenerateModel(classId, { skipRig = false, rigOnlyTaskId = null, noWeapons = false } = {}) {
  const config = CLASS_CONFIG[classId];
  if (!config) {
    console.error(`Unknown class: ${classId}. Available: ${Object.keys(CLASS_CONFIG).join(', ')}`);
    process.exit(1);
  }

  const modeLabel = noWeapons ? ' (NO WEAPONS + A-POSE)' : '';
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  REGENERATING ${classId.toUpperCase()}${modeLabel} — Meshy Image-to-3D${skipRig ? '' : ' + Rigging'}`);
  console.log(`${'═'.repeat(60)}`);

  // Select texture prompt based on mode
  const texturePrompt = noWeapons
    ? (config.noweapons_texture_prompt || config.texture_prompt)
    : config.texture_prompt;

  let imageTo3dTaskId = rigOnlyTaskId;
  let taskData = null;

  // ── Step 1: Image-to-3D (skip if --rig-only) ──
  if (!rigOnlyTaskId) {
    // Find portrait: try primary, then fallback
    let portraitFile = config.portrait;
    let portraitPath = path.join(ROOT, 'public', 'assets', 'art', portraitFile);

    if (!fs.existsSync(portraitPath) && config.portrait_fallback) {
      console.log(`  Portrait not found (${portraitFile}), using fallback`);
      portraitFile = config.portrait_fallback;
      portraitPath = path.join(ROOT, 'public', 'assets', 'art', portraitFile);
    }
    if (!fs.existsSync(portraitPath)) {
      throw new Error(`Portrait not found: ${portraitPath}`);
    }

    console.log(`\n  Portrait: ${portraitFile}`);
    console.log('  Converting to base64...');
    const imageDataUri = imageToBase64DataUri(portraitPath);
    console.log(`  Image data URI size: ${(imageDataUri.length / 1024).toFixed(0)}KB`);

    // When --no-weapons, use a-pose so arms are at sides (easier to rig, no weapon grip)
    const poseMode = noWeapons ? 'a-pose' : '';

    console.log('\n  ── Step 1: Image-to-3D ──');
    console.log(`  Texture prompt: "${texturePrompt}"`);
    if (poseMode) console.log(`  Pose mode: ${poseMode}`);

    const taskResult = await apiPost('/openapi/v1/image-to-3d', {
      image_url: imageDataUri,
      ai_model: 'meshy-6',
      topology: 'triangle',
      target_polycount: 30000,
      symmetry_mode: 'auto',
      should_remesh: false,
      should_texture: true,
      enable_pbr: true,
      texture_prompt: texturePrompt,
      ...(poseMode && { pose_mode: poseMode }),
    });

    imageTo3dTaskId = taskResult.result;
    console.log(`  Task ID: ${imageTo3dTaskId}`);
    console.log('  Waiting for generation (3-8 minutes)...');

    taskData = await pollTask('/openapi/v1/image-to-3d', imageTo3dTaskId);
    console.log('\n  Image-to-3D complete!');
  } else {
    console.log(`\n  ── Skipping Image-to-3D, using existing task: ${rigOnlyTaskId} ──`);
    // Fetch existing task data for model download
    const res = await fetch(`${MESHY_API}/openapi/v1/image-to-3d/${rigOnlyTaskId}`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
    });
    if (res.ok) {
      taskData = await res.json();
    }
  }

  // ── Download unrigged model ──
  console.log('\n  ── Downloading unrigged model ──');
  const modelDest = path.join(ROOT, 'public', 'assets', 'models', `char_${classId}.glb`);
  if (fs.existsSync(modelDest)) {
    const backupPath = modelDest.replace('.glb', `_backup_${Date.now()}.glb`);
    fs.copyFileSync(modelDest, backupPath);
    console.log(`  Backed up existing model: ${path.basename(backupPath)}`);
  }

  if (taskData) {
    const glbUrl = taskData.model_urls?.glb || taskData.model_url;
    if (glbUrl) {
      await downloadFile(glbUrl, modelDest);
    } else {
      console.error('  No GLB URL in result:', JSON.stringify(taskData.model_urls || {}, null, 2));
    }

    // Download textures
    const texDir = path.join(ROOT, 'public', 'assets', 'textures', `skin_${classId}`);
    fs.mkdirSync(texDir, { recursive: true });
    if (taskData.texture_urls && Array.isArray(taskData.texture_urls)) {
      const texSet = taskData.texture_urls[0];
      if (texSet) {
        const TEX_MAP = { base_color: 'diffuse', metallic: 'metallic', roughness: 'roughness', normal: 'normal' };
        for (const [apiKey, localName] of Object.entries(TEX_MAP)) {
          if (texSet[apiKey]) {
            await downloadFile(texSet[apiKey], path.join(texDir, `${localName}.png`));
          }
        }
      }
    }
  }

  // ── Step 2: Meshy Rigging ──
  if (!skipRig) {
    console.log('\n  ── Step 2: Meshy Auto-Rigging ──');
    console.log(`  Input task: ${imageTo3dTaskId}`);

    const rigResult = await apiPost('/openapi/v1/rigging', {
      input_task_id: imageTo3dTaskId,
      height_meters: 1.8,
    });

    const rigTaskId = rigResult.result;
    console.log(`  Rig Task ID: ${rigTaskId}`);
    console.log('  Waiting for rigging (1-3 minutes)...');

    const rigData = await pollTask('/openapi/v1/rigging', rigTaskId);
    console.log('\n  Rigging complete!');

    // Rigging API returns URLs in result.rigged_character_glb_url (not model_urls)
    const riggedGlb = rigData.result?.rigged_character_glb_url || rigData.model_urls?.glb;
    if (riggedGlb) {
      console.log('  Downloading rigged GLB...');
      await downloadFile(riggedGlb, modelDest);
      console.log('  Rigged model saved!');
    } else {
      console.warn('  No rigged GLB URL found, keeping unrigged model');
      console.log('  Response keys:', JSON.stringify(Object.keys(rigData), null, 2));
      console.log('  result keys:', JSON.stringify(Object.keys(rigData.result || {}), null, 2));
    }
  }

  console.log(`\n  ${'─'.repeat(50)}`);
  console.log(`  ✓ ${classId.toUpperCase()} model regenerated${skipRig ? '' : ' + rigged'}!`);
  console.log(`  Model: ${modelDest}`);
  console.log(`  ${'─'.repeat(50)}\n`);

  return imageTo3dTaskId;
}

// ── Main ──
const args = process.argv.slice(2);
const classId = args[0]?.toLowerCase();
const skipRig = args.includes('--skip-rig');
const noWeapons = args.includes('--no-weapons');
const rigOnlyIdx = args.indexOf('--rig-only');
const rigOnlyTaskId = rigOnlyIdx >= 0 ? args[rigOnlyIdx + 1] : null;

if (!classId) {
  console.log('Meshy Image-to-3D + Rigging Model Generator');
  console.log(`Usage: node scripts/regenerate-model.mjs <classId|all> [--no-weapons] [--skip-rig] [--rig-only <taskId>]`);
  console.log(`Available: ${Object.keys(CLASS_CONFIG).join(', ')}, all`);
  console.log('\nFlags:');
  console.log('  --no-weapons        Generate without weapons (a-pose + "no weapons" prompt)');
  console.log('  --skip-rig          Skip the rigging step (download raw model only)');
  console.log('  --rig-only <taskId> Skip Image-to-3D, rig an existing task');
  process.exit(1);
}

async function main() {
  const classes = classId === 'all'
    ? Object.keys(CLASS_CONFIG) // All classes through same pipeline for consistency
    : [classId];

  console.log(`\nRegenerating ${classes.length} class(es): ${classes.join(', ')}${noWeapons ? ' (NO WEAPONS)' : ''}\n`);

  const results = { success: [], failed: [] };
  for (const cls of classes) {
    try {
      await regenerateModel(cls, { skipRig, rigOnlyTaskId, noWeapons });
      results.success.push(cls);
    } catch (err) {
      console.error(`\n  ✗ ${cls.toUpperCase()} failed: ${err.message}\n`);
      results.failed.push(cls);
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log('  SUMMARY');
  console.log('═'.repeat(60));
  console.log(`  Success: ${results.success.map(c => c.toUpperCase()).join(', ') || 'none'}`);
  if (results.failed.length) {
    console.log(`  Failed:  ${results.failed.map(c => c.toUpperCase()).join(', ')}`);
  }
  console.log('═'.repeat(60) + '\n');
}

main().catch(err => {
  console.error(`\n  ✗ Fatal:`, err.message);
  process.exit(1);
});
