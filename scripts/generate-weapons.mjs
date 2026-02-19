#!/usr/bin/env node
/**
 * Generate class-specific weapon models using Meshy Text-to-3D API.
 *
 * Uses a two-step pipeline: preview → refine for high-quality weapon models.
 * Each weapon has a detailed text prompt describing the isolated weapon.
 *
 * Usage:
 *   node scripts/generate-weapons.mjs <classId|all> [--weapon <type>] [--preview-only] [--refine-only <taskId>]
 *
 * Examples:
 *   node scripts/generate-weapons.mjs revenant --weapon mace
 *   node scripts/generate-weapons.mjs revenant --weapon shield
 *   node scripts/generate-weapons.mjs tyrant
 *   node scripts/generate-weapons.mjs all
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
const MODEL_OUT = path.join(ROOT, 'public', 'assets', 'models');

// ── Per-class weapon config ──
const WEAPON_CONFIG = {
  tyrant: {
    weapons: {
      greatsword: {
        outputFile: 'wpn_tyrant_greatsword.glb',
        prompt: 'Dark fantasy two-handed greatsword, massive broad blade with glowing red-orange fire runes etched along the fuller, black steel blade with crimson battle damage, demonic skull crossguard with curved horns, dark leather wrapped grip, single isolated weapon on plain background, game asset',
        texturePrompt: 'Dark black steel blade with crimson glowing rune engravings, demonic skull pommel, dark leather grip, battle-worn metal, high detail PBR textures',
      },
    },
  },
  wraith: {
    weapons: {
      daggers: {
        outputFile: 'wpn_wraith_daggers.glb',
        prompt: 'Dark fantasy pair of curved assassin daggers, ethereal purple glowing blades, ornate silver crossguards with amethyst gems, dark leather wrapped handles, ghostly purple energy wisps trailing from blades, single isolated weapons on plain background, game asset',
        texturePrompt: 'Purple-indigo ethereal glowing blade, dark silver crossguard with amethyst gem, black leather grip, ghostly energy wisps, high detail PBR textures',
      },
    },
  },
  infernal: {
    weapons: {
      staff: {
        outputFile: 'wpn_infernal_staff.glb',
        prompt: 'Dark fantasy fire mage staff, tall ornate staff with a large glowing orange-red fire crystal orb at the top held by twisted dark metal claws, charcoal black wood shaft with molten lava crack veins, ember particles, single isolated weapon on plain background, game asset',
        texturePrompt: 'Charcoal black wood shaft with glowing orange lava cracks, twisted dark metal claw holding fire crystal, molten ember glow, high detail PBR textures',
      },
    },
  },
  harbinger: {
    weapons: {
      staff: {
        outputFile: 'wpn_harbinger_staff.glb',
        prompt: 'Dark fantasy warlock staff topped with an open floating grimoire book with glowing green necrotic pages, gnarled dark wood shaft with bone fragments and skull ornaments embedded, green eldritch energy swirling around the top, single isolated weapon on plain background, game asset',
        texturePrompt: 'Gnarled dark wood with bone ornaments, glowing green necrotic grimoire book, skull carvings, eldritch green energy, high detail PBR textures',
      },
    },
  },
  revenant: {
    weapons: {
      mace: {
        outputFile: 'wpn_revenant_mace.glb',
        prompt: 'Dark fantasy holy paladin flanged mace, ornate golden flanged head with sacred cross engravings and warm divine glow, weathered bronze handle wrapped in white leather, golden pommel with holy gem, single isolated weapon on plain background, game asset',
        texturePrompt: 'Ornate aged gold flanged mace head with sacred cross engraving, weathered bronze shaft, white leather grip, warm divine golden glow, high detail PBR textures',
      },
      shield: {
        outputFile: 'wpn_revenant_shield.glb',
        prompt: 'Dark fantasy ornate holy paladin kite shield, dark bronze metallic body, thick ornate gold rim border, large golden fleur-de-lis cross emblem in center, central golden boss medallion with amber gem, four corner gold studs, battle-worn sacred warrior shield, single isolated object on plain background, game asset',
        texturePrompt: 'Dark bronze shield body, ornate aged gold thick rim, golden fleur-de-lis cross emblem, amber gem center boss, battle-worn holy warrior, high detail PBR textures',
      },
    },
  },
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  const maxAttempts = 360;
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

    if (task_status === 'SUCCEEDED') return data;
    if (task_status === 'FAILED') {
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

// ── Generate one weapon via Text-to-3D (preview → refine) ──
async function generateWeapon(classId, weaponType, config, options = {}) {
  const { previewOnly, refineOnlyTaskId } = options;

  console.log(`\n  ── ${weaponType.toUpperCase()} ──`);
  console.log(`  Output: ${config.outputFile}`);
  console.log('  Mode: TEXT-TO-3D (preview → refine)');

  let previewTaskId = refineOnlyTaskId;

  if (!refineOnlyTaskId) {
    console.log('\n  Step 1: Preview...');
    console.log(`  Prompt: "${config.prompt.slice(0, 80)}..."`);

    const result = await apiPost('/openapi/v2/text-to-3d', {
      mode: 'preview',
      prompt: config.prompt,
      ai_model: 'meshy-6',
      topology: 'triangle',
      target_polycount: 10000,
      symmetry_mode: 'auto',
    });

    previewTaskId = result.result;
    console.log(`  Preview Task ID: ${previewTaskId}`);

    const previewData = await pollTask('/openapi/v2/text-to-3d', previewTaskId);
    console.log('\n  Preview complete!');

    if (previewOnly) {
      if (previewData.model_urls?.glb) {
        const dest = path.join(MODEL_OUT, config.outputFile.replace('.glb', '_preview.glb'));
        await downloadFile(previewData.model_urls.glb, dest);
      }
      console.log(`  Preview-only done. Task ID: ${previewTaskId}`);
      console.log(`  To refine: node scripts/generate-weapons.mjs ${classId} --weapon ${weaponType} --refine-only ${previewTaskId}`);
      return { taskId: previewTaskId, mode: 'preview' };
    }
  }

  console.log('\n  Step 2: Refine...');
  const refineResult = await apiPost('/openapi/v2/text-to-3d', {
    mode: 'refine',
    preview_task_id: previewTaskId,
    enable_pbr: true,
    texture_prompt: config.texturePrompt,
  });

  const refineTaskId = refineResult.result;
  console.log(`  Refine Task ID: ${refineTaskId}`);

  const refineData = await pollTask('/openapi/v2/text-to-3d', refineTaskId);
  console.log('\n  Refinement complete!');

  // Download GLB
  const dest = path.join(MODEL_OUT, config.outputFile);
  if (fs.existsSync(dest)) {
    const backup = dest.replace('.glb', `_backup_${Date.now()}.glb`);
    fs.copyFileSync(dest, backup);
    console.log(`  Backed up: ${path.basename(backup)}`);
  }

  const glbUrl = refineData?.model_urls?.glb || refineData?.model_url;
  if (glbUrl) {
    await downloadFile(glbUrl, dest);
  } else {
    console.warn('  No GLB URL in result');
  }

  return { taskId: refineTaskId, mode: 'text-to-3d' };
}

// ── Generate weapons for a class ──
async function generateClassWeapons(classId, weaponFilter, options = {}) {
  const classConfig = WEAPON_CONFIG[classId];
  if (!classConfig) {
    console.error(`Unknown class: ${classId}. Available: ${Object.keys(WEAPON_CONFIG).join(', ')}`);
    process.exit(1);
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  GENERATING WEAPONS FOR ${classId.toUpperCase()}`);
  console.log(`${'═'.repeat(60)}`);

  const weapons = weaponFilter
    ? { [weaponFilter]: classConfig.weapons[weaponFilter] }
    : classConfig.weapons;

  if (weaponFilter && !classConfig.weapons[weaponFilter]) {
    console.error(`  Unknown weapon type: ${weaponFilter}. Available: ${Object.keys(classConfig.weapons).join(', ')}`);
    return { error: true };
  }

  const results = {};
  for (const [weaponType, config] of Object.entries(weapons)) {
    try {
      results[weaponType] = await generateWeapon(classId, weaponType, config, options);
    } catch (err) {
      console.error(`\n  Failed ${weaponType}: ${err.message}`);
      results[weaponType] = { error: err.message };
    }
  }

  return results;
}

// ── Main ──
const args = process.argv.slice(2);
const classId = args[0]?.toLowerCase();
const previewOnly = args.includes('--preview-only');
const refineIdx = args.indexOf('--refine-only');
const refineOnlyTaskId = refineIdx >= 0 ? args[refineIdx + 1] : null;
const weaponIdx = args.indexOf('--weapon');
const weaponFilter = weaponIdx >= 0 ? args[weaponIdx + 1] : null;

if (!classId) {
  console.log('Meshy Weapon Generator (Text-to-3D)');
  console.log('');
  console.log('Usage: node scripts/generate-weapons.mjs <classId|all> [options]');
  console.log('');
  console.log('Options:');
  console.log('  --weapon <type>          Generate only this weapon type');
  console.log('  --preview-only           Generate preview only (cheaper, faster)');
  console.log('  --refine-only <taskId>   Skip preview, refine an existing preview task');
  console.log('');
  console.log('Available classes and weapons:');
  for (const [cls, cfg] of Object.entries(WEAPON_CONFIG)) {
    for (const [wt, wc] of Object.entries(cfg.weapons)) {
      console.log(`  ${cls} --weapon ${wt}  → ${wc.outputFile}`);
    }
  }
  process.exit(1);
}

async function main() {
  const classes = classId === 'all' ? Object.keys(WEAPON_CONFIG) : [classId];

  console.log(`\nGenerating weapons for: ${classes.join(', ')}${weaponFilter ? ` (${weaponFilter} only)` : ''}`);

  const allResults = { success: [], failed: [] };
  for (const cls of classes) {
    try {
      const results = await generateClassWeapons(cls, weaponFilter, { previewOnly, refineOnlyTaskId });
      const anyFailed = Object.values(results).some(r => r.error);
      (anyFailed ? allResults.failed : allResults.success).push(cls);
    } catch (err) {
      console.error(`\n  ${cls.toUpperCase()} failed: ${err.message}`);
      allResults.failed.push(cls);
    }
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  SUMMARY');
  console.log('═'.repeat(60));
  console.log(`  Success: ${allResults.success.map(c => c.toUpperCase()).join(', ') || 'none'}`);
  if (allResults.failed.length) {
    console.log(`  Failed:  ${allResults.failed.map(c => c.toUpperCase()).join(', ')}`);
  }
  console.log('═'.repeat(60) + '\n');
}

main().catch(err => {
  console.error(`\n  Fatal:`, err.message);
  process.exit(1);
});
