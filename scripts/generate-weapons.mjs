#!/usr/bin/env node
/**
 * Ebon Crucible — Weapon Generation Pipeline
 *
 * Two-mode pipeline:
 *   1. Concept art (gpt-image-1) → review → Meshy Image-to-3D
 *   2. Legacy Text-to-3D (preview → refine) — still available via --text-to-3d
 *
 * Usage:
 *   node scripts/generate-weapons.mjs <classId|all> --weapon <type>
 *   node scripts/generate-weapons.mjs <classId> --weapon <type> --concept-only
 *   node scripts/generate-weapons.mjs <classId> --weapon <type> --skip-concept
 *   node scripts/generate-weapons.mjs <classId> --weapon <type> --prompt "custom description"
 *   node scripts/generate-weapons.mjs <classId> --weapon <type> --text-to-3d
 *
 * Examples:
 *   node scripts/generate-weapons.mjs tyrant --weapon greatsword --concept-only
 *   node scripts/generate-weapons.mjs tyrant --weapon greatsword --skip-concept
 *   node scripts/generate-weapons.mjs revenant --weapon mace --prompt "frost-covered holy mace with ice crystals"
 *   node scripts/generate-weapons.mjs revenant --weapon shield
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
const MESHY_KEY = envContent.match(/MESHY_API_KEY=(.+)/)?.[1]?.trim();
const OPENAI_KEY = envContent.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();

if (!MESHY_KEY) { console.error('Missing MESHY_API_KEY in .env'); process.exit(1); }
if (!OPENAI_KEY) { console.error('Missing OPENAI_API_KEY in .env'); process.exit(1); }

const MESHY_API = 'https://api.meshy.ai';
const MODEL_OUT = path.join(ROOT, 'public', 'assets', 'models');
const CONCEPTS_DIR = path.join(ROOT, 'public', 'assets', 'art', 'concepts');

// ── Per-class weapon config ──
// `defaultDescription` = used for concept art generation
// `prompt` / `texturePrompt` = legacy Text-to-3D prompts
const WEAPON_CONFIG = {
  tyrant: {
    weapons: {
      greatsword: {
        outputFile: 'wpn_tyrant_greatsword.glb',
        defaultDescription: 'massive dark fantasy two-handed greatsword, broad black steel blade with crimson glowing fire runes etched along the fuller, demonic skull crossguard with curved horns, dark leather wrapped grip, battle-scarred and weathered',
        prompt: 'Dark fantasy two-handed greatsword, massive broad blade with glowing red-orange fire runes etched along the fuller, black steel blade with crimson battle damage, demonic skull crossguard with curved horns, dark leather wrapped grip, single isolated weapon on plain background, game asset',
        texturePrompt: 'Dark black steel blade with crimson glowing rune engravings, demonic skull pommel, dark leather grip, battle-worn metal, high detail PBR textures',
      },
    },
  },
  wraith: {
    weapons: {
      daggers: {
        outputFile: 'wpn_wraith_daggers.glb',
        defaultDescription: 'pair of curved dark fantasy assassin daggers, ethereal purple glowing blades, ornate silver crossguards with amethyst gems, dark leather wrapped handles, ghostly purple energy wisps trailing from blade edges',
        prompt: 'Dark fantasy pair of curved assassin daggers, ethereal purple glowing blades, ornate silver crossguards with amethyst gems, dark leather wrapped handles, ghostly purple energy wisps trailing from blades, single isolated weapons on plain background, game asset',
        texturePrompt: 'Purple-indigo ethereal glowing blade, dark silver crossguard with amethyst gem, black leather grip, ghostly energy wisps, high detail PBR textures',
      },
    },
  },
  infernal: {
    weapons: {
      staff: {
        outputFile: 'wpn_infernal_staff.glb',
        defaultDescription: 'tall dark fantasy fire mage staff, large glowing orange-red fire crystal orb at the top held by twisted dark metal claws, charcoal black wood shaft with molten lava crack veins, ember particles rising from crystal',
        prompt: 'Dark fantasy fire mage staff, tall ornate staff with a large glowing orange-red fire crystal orb at the top held by twisted dark metal claws, charcoal black wood shaft with molten lava crack veins, ember particles, single isolated weapon on plain background, game asset',
        texturePrompt: 'Charcoal black wood shaft with glowing orange lava cracks, twisted dark metal claw holding fire crystal, molten ember glow, high detail PBR textures',
      },
    },
  },
  harbinger: {
    weapons: {
      staff: {
        outputFile: 'wpn_harbinger_staff.glb',
        defaultDescription: 'dark fantasy warlock staff with open floating grimoire book on top with glowing green necrotic pages, gnarled dark wood shaft with bone fragments and skull ornaments embedded, green eldritch energy swirling around the top section',
        prompt: 'Dark fantasy warlock staff topped with an open floating grimoire book with glowing green necrotic pages, gnarled dark wood shaft with bone fragments and skull ornaments embedded, green eldritch energy swirling around the top, single isolated weapon on plain background, game asset',
        texturePrompt: 'Gnarled dark wood with bone ornaments, glowing green necrotic grimoire book, skull carvings, eldritch green energy, high detail PBR textures',
      },
    },
  },
  revenant: {
    weapons: {
      mace: {
        outputFile: 'wpn_revenant_mace.glb',
        defaultDescription: 'ornate dark fantasy holy paladin flanged mace, golden flanged head with sacred cross engravings and warm divine glow, weathered bronze handle wrapped in white leather, golden pommel with holy amber gem',
        prompt: 'Dark fantasy holy paladin flanged mace, ornate golden flanged head with sacred cross engravings and warm divine glow, weathered bronze handle wrapped in white leather, golden pommel with holy gem, single isolated weapon on plain background, game asset',
        texturePrompt: 'Ornate aged gold flanged mace head with sacred cross engraving, weathered bronze shaft, white leather grip, warm divine golden glow, high detail PBR textures',
      },
      shield: {
        outputFile: 'wpn_revenant_shield.glb',
        defaultDescription: 'ornate dark fantasy holy paladin kite shield, dark bronze metallic body, thick ornate gold rim border, large golden fleur-de-lis cross emblem in center, central golden boss medallion with amber gem, battle-worn sacred warrior shield',
        prompt: 'Dark fantasy ornate holy paladin kite shield, dark bronze metallic body, thick ornate gold rim border, large golden fleur-de-lis cross emblem in center, central golden boss medallion with amber gem, four corner gold studs, battle-worn sacred warrior shield, single isolated object on plain background, game asset',
        texturePrompt: 'Dark bronze shield body, ornate aged gold thick rim, golden fleur-de-lis cross emblem, amber gem center boss, battle-worn holy warrior, high detail PBR textures',
      },
    },
  },
};

// ── Utilities ──
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function sanitizeName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

async function safeJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 300)}`); }
}

async function extractImageBuffer(data) {
  if (data.data?.[0]?.b64_json) {
    return Buffer.from(data.data[0].b64_json, 'base64');
  } else if (data.data?.[0]?.url) {
    const dlResp = await fetch(data.data[0].url);
    return Buffer.from(await dlResp.arrayBuffer());
  }
  throw new Error(`No image in response: ${JSON.stringify(data).slice(0, 300)}`);
}

// ── Concept Art Prompt ──
function buildWeaponConceptPrompt(classId, weaponType, customPrompt) {
  const classConfig = WEAPON_CONFIG[classId];
  const weaponConfig = classConfig?.weapons[weaponType];
  const description = customPrompt || weaponConfig?.defaultDescription || weaponConfig?.prompt;

  return [
    `Single isolated weapon on a transparent background. No character, no hands, no other objects.`,
    `The weapon is displayed vertically centered in frame, front view.`,
    ``,
    `Weapon: ${description}`,
    ``,
    `Style: dark fantasy game weapon concept art, high detail, clean edges,`,
    `professional game asset reference, dramatic lighting, transparent background.`,
  ].join('\n');
}

// ── Build edit prompt for skin-referenced weapon ──
function buildSkinWeaponEditPrompt(classId, weaponType, customPrompt) {
  const classConfig = WEAPON_CONFIG[classId];
  const weaponConfig = classConfig?.weapons[weaponType];
  const description = customPrompt || weaponConfig?.defaultDescription || weaponConfig?.prompt;

  return [
    `Based on this character's armor, generate ONLY a single isolated weapon on a transparent background.`,
    `NO character, NO hands, NO body parts — ONLY the weapon itself, vertically centered.`,
    ``,
    `Match the color scheme, materials, motifs, and ornamental style of the character's armor shown in the reference image.`,
    `The weapon should look like it belongs to this character — same fantasy theme, same palette.`,
    ``,
    `Weapon type: ${description}`,
    ``,
    `Style: dark fantasy game weapon concept art, high detail, clean edges,`,
    `professional game asset reference, transparent background.`,
  ].join('\n');
}

// ── OpenAI: Generate weapon concept art (with optional skin reference) ──
async function generateWeaponConceptArt(classId, weaponType, customPrompt, skinImagePath) {
  const conceptName = `wpn_${classId}_${weaponType}`;
  const outPath = path.join(CONCEPTS_DIR, `${conceptName}.png`);

  // If skin concept art is provided, use edit API to match the skin's theme
  if (skinImagePath && fs.existsSync(skinImagePath)) {
    const editPrompt = buildSkinWeaponEditPrompt(classId, weaponType, customPrompt);
    const skinImage = fs.readFileSync(skinImagePath);

    console.log('\n  Step 1: Generating weapon concept art (gpt-image-1 EDIT — skin-referenced)...');
    console.log(`  Skin reference: ${path.relative(ROOT, skinImagePath)}`);
    console.log(`  Edit prompt: "${editPrompt.slice(0, 120)}..."`);

    const boundary = '----EbonWeaponBoundary' + Date.now();
    let body = '';
    body += `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\ngpt-image-1\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${editPrompt}\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="size"\r\n\r\n1024x1024\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="quality"\r\n\r\nhigh\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="background"\r\n\r\ntransparent\r\n`;

    const preImage = Buffer.from(
      body + `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="skin_reference.png"\r\nContent-Type: image/png\r\n\r\n`,
      'utf-8'
    );
    const postImage = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
    const fullBody = Buffer.concat([preImage, skinImage, postImage]);

    const resp = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: fullBody,
    });

    const data = await safeJson(resp);
    if (!resp.ok) {
      throw new Error(`OpenAI edit API error (${resp.status}): ${JSON.stringify(data).slice(0, 300)}`);
    }

    const buf = await extractImageBuffer(data);
    fs.mkdirSync(CONCEPTS_DIR, { recursive: true });
    fs.writeFileSync(outPath, buf);
    console.log(`  Weapon concept art saved: ${outPath} (${(buf.length / 1024).toFixed(0)} KB)`);
    return { imagePath: outPath, imageBuffer: buf };
  }

  // No skin reference — use standard generation
  const prompt = buildWeaponConceptPrompt(classId, weaponType, customPrompt);

  console.log('\n  Step 1: Generating weapon concept art (gpt-image-1)...');
  console.log(`  Prompt: "${prompt.slice(0, 120)}..."`);

  const resp = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt,
      n: 1,
      size: '1024x1024',
      quality: 'high',
      background: 'transparent',
      output_format: 'png',
    }),
  });

  const data = await safeJson(resp);
  if (!resp.ok) {
    throw new Error(`OpenAI API error (${resp.status}): ${JSON.stringify(data).slice(0, 300)}`);
  }

  const buf = await extractImageBuffer(data);
  fs.mkdirSync(CONCEPTS_DIR, { recursive: true });
  fs.writeFileSync(outPath, buf);
  console.log(`  Weapon concept art saved: ${outPath} (${(buf.length / 1024).toFixed(0)} KB)`);

  return { imagePath: outPath, imageBuffer: buf };
}

// ── Meshy: Shared API helpers ──
async function meshyPost(endpoint, body) {
  const res = await fetch(`${MESHY_API}${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MESHY_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Meshy POST ${endpoint} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return safeJson(res);
}

async function meshyPoll(endpoint, taskId, label = '') {
  const maxAttempts = 360;
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`${MESHY_API}${endpoint}/${taskId}`, {
      headers: { 'Authorization': `Bearer ${MESHY_KEY}` },
    });

    if (!res.ok) {
      console.warn(`  Poll failed (${res.status}), retrying...`);
      await sleep(5000);
      continue;
    }

    let data;
    try { data = await safeJson(res); }
    catch { await sleep(5000); continue; }

    if (data.status === 'SUCCEEDED') {
      console.log(`\n  ${label || 'Task'} complete!`);
      return data;
    }
    if (data.status === 'FAILED') {
      throw new Error(`${label || 'Task'} ${taskId} failed: ${data.task_error?.message || JSON.stringify(data).slice(0, 200)}`);
    }

    const progress = data.progress || 0;
    process.stdout.write(`  ${label || 'Status'}: ${data.status} (${progress}% | ${i + 1}/${maxAttempts})    \r`);
    await sleep(5000);
  }
  throw new Error(`${label || 'Task'} ${taskId} timed out after 30 minutes`);
}

async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
  console.log(`  Saved: ${path.relative(ROOT, destPath)} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
  return buffer;
}

// ── Meshy: Image-to-3D (used with concept art pipeline) ──
async function meshyImageTo3D(imageBuffer) {
  console.log('\n  Step 2: Submitting to Meshy Image-to-3D...');

  const base64 = `data:image/png;base64,${imageBuffer.toString('base64')}`;

  const result = await meshyPost('/openapi/v1/image-to-3d', {
    image_url: base64,
    ai_model: 'meshy-6',
    topology: 'triangle',
    target_polycount: 10000,
    should_texture: true,
    enable_pbr: true,
  });

  const taskId = result.result;
  console.log(`  Image-to-3D Task ID: ${taskId}`);

  const taskData = await meshyPoll('/openapi/v1/image-to-3d', taskId, 'Image-to-3D');
  return { taskId, taskData };
}

// ── Generate one weapon via concept art → Image-to-3D ──
async function generateWeaponWithConcept(classId, weaponType, config, options = {}) {
  const { conceptOnly, skipConcept, customPrompt, skinImagePath } = options;
  const conceptName = `wpn_${classId}_${weaponType}`;
  const conceptPath = path.join(CONCEPTS_DIR, `${conceptName}.png`);

  console.log(`\n  ── ${weaponType.toUpperCase()} ──`);
  console.log(`  Output: ${config.outputFile}`);
  console.log('  Mode: CONCEPT ART → IMAGE-TO-3D');

  let imageBuffer;

  // Step 1: Concept art
  if (skipConcept) {
    if (!fs.existsSync(conceptPath)) {
      throw new Error(`No concept art found at ${conceptPath}. Generate concept first.`);
    }
    console.log(`\n  Step 1: Using approved concept art: ${path.relative(ROOT, conceptPath)}`);
    imageBuffer = fs.readFileSync(conceptPath);
  } else {
    const result = await generateWeaponConceptArt(classId, weaponType, customPrompt, skinImagePath);
    imageBuffer = result.imageBuffer;

    if (conceptOnly) {
      console.log(`\n${'─'.repeat(60)}`);
      console.log('  WEAPON CONCEPT ART READY FOR REVIEW');
      console.log(`  File: ${path.relative(ROOT, conceptPath)}`);
      console.log(`  URL:  /assets/art/concepts/${conceptName}.png`);
      console.log('─'.repeat(60) + '\n');
      return { conceptPath, conceptUrl: `/assets/art/concepts/${conceptName}.png` };
    }
  }

  // Step 2: Image-to-3D
  const { taskId, taskData } = await meshyImageTo3D(imageBuffer);

  // Step 3: Download GLB
  console.log('\n  Step 3: Downloading weapon model...');
  const glbUrl = taskData?.model_urls?.glb || taskData?.model_url;
  if (!glbUrl) {
    throw new Error('No GLB URL found in Image-to-3D result');
  }

  const dest = path.join(MODEL_OUT, config.outputFile);
  if (fs.existsSync(dest)) {
    const backup = dest.replace('.glb', `_backup_${Date.now()}.glb`);
    fs.copyFileSync(dest, backup);
    console.log(`  Backed up: ${path.basename(backup)}`);
  }

  await downloadFile(glbUrl, dest);

  console.log(`\n${'─'.repeat(60)}`);
  console.log('  DONE!');
  console.log(`  Weapon:   ${path.relative(ROOT, dest)}`);
  console.log(`  Task ID:  ${taskId}`);
  console.log('─'.repeat(60) + '\n');

  return { taskId, destPath: dest, mode: 'image-to-3d' };
}

// ── Legacy: Generate one weapon via Text-to-3D (preview → refine) ──
async function generateWeaponTextTo3D(classId, weaponType, config, options = {}) {
  const { previewOnly, refineOnlyTaskId } = options;

  console.log(`\n  ── ${weaponType.toUpperCase()} ──`);
  console.log(`  Output: ${config.outputFile}`);
  console.log('  Mode: TEXT-TO-3D (preview → refine)');

  let previewTaskId = refineOnlyTaskId;

  if (!refineOnlyTaskId) {
    console.log('\n  Step 1: Preview...');
    console.log(`  Prompt: "${config.prompt.slice(0, 80)}..."`);

    const result = await meshyPost('/openapi/v2/text-to-3d', {
      mode: 'preview',
      prompt: config.prompt,
      ai_model: 'meshy-6',
      topology: 'triangle',
      target_polycount: 10000,
      symmetry_mode: 'auto',
    });

    previewTaskId = result.result;
    console.log(`  Preview Task ID: ${previewTaskId}`);

    const previewData = await meshyPoll('/openapi/v2/text-to-3d', previewTaskId, 'Preview');
    console.log('\n  Preview complete!');

    if (previewOnly) {
      if (previewData.model_urls?.glb) {
        const dest = path.join(MODEL_OUT, config.outputFile.replace('.glb', '_preview.glb'));
        await downloadFile(previewData.model_urls.glb, dest);
      }
      console.log(`  Preview-only done. Task ID: ${previewTaskId}`);
      console.log(`  To refine: node scripts/generate-weapons.mjs ${classId} --weapon ${weaponType} --text-to-3d --refine-only ${previewTaskId}`);
      return { taskId: previewTaskId, mode: 'preview' };
    }
  }

  console.log('\n  Step 2: Refine...');
  const refineResult = await meshyPost('/openapi/v2/text-to-3d', {
    mode: 'refine',
    preview_task_id: previewTaskId,
    enable_pbr: true,
    texture_prompt: config.texturePrompt,
  });

  const refineTaskId = refineResult.result;
  console.log(`  Refine Task ID: ${refineTaskId}`);

  const refineData = await meshyPoll('/openapi/v2/text-to-3d', refineTaskId, 'Refine');
  console.log('\n  Refinement complete!');

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
  if (options.conceptOnly) {
    console.log(`  GENERATING WEAPON CONCEPT ART: ${classId.toUpperCase()}`);
  } else {
    console.log(`  GENERATING WEAPONS FOR ${classId.toUpperCase()}`);
  }
  console.log(`${'═'.repeat(60)}`);

  const weapons = weaponFilter
    ? { [weaponFilter]: classConfig.weapons[weaponFilter] }
    : classConfig.weapons;

  if (weaponFilter && !classConfig.weapons[weaponFilter]) {
    console.error(`  Unknown weapon type: ${weaponFilter}. Available: ${Object.keys(classConfig.weapons).join(', ')}`);
    return { error: true };
  }

  // If no explicit skin image but skinId is provided, look for concept art automatically
  if (!options.skinImagePath && options.skinId) {
    const conceptPath = path.join(CONCEPTS_DIR, `${classId}_${options.skinId}.png`);
    if (fs.existsSync(conceptPath)) {
      options.skinImagePath = conceptPath;
      console.log(`  Auto-detected skin concept art: ${path.relative(ROOT, conceptPath)}`);
    }
  }

  const results = {};
  for (const [weaponType, config] of Object.entries(weapons)) {
    // Per-skin weapon: save to a separate file so it doesn't overwrite the class default
    const effectiveConfig = { ...config };
    if (options.skinId && options.skinId !== 'default') {
      const skinWeaponFile = `wpn_${classId}_${options.skinId}_${weaponType}.glb`;
      effectiveConfig.outputFile = skinWeaponFile;
      console.log(`  Per-skin weapon: will save as ${skinWeaponFile}`);
    }
    try {
      if (options.textTo3d) {
        results[weaponType] = await generateWeaponTextTo3D(classId, weaponType, effectiveConfig, options);
      } else {
        results[weaponType] = await generateWeaponWithConcept(classId, weaponType, effectiveConfig, options);
      }
      // Auto-register per-skin weapon in AssetManifest
      if (options.skinId && options.skinId !== 'default' && !results[weaponType]?.error) {
        _registerSkinWeapon(classId, options.skinId, weaponType, effectiveConfig.outputFile);
      }
    } catch (err) {
      console.error(`\n  Failed ${weaponType}: ${err.message}`);
      results[weaponType] = { error: err.message };
    }
  }

  return results;
}

// Auto-register a per-skin weapon in AssetManifest.js
function _registerSkinWeapon(classId, skinId, weaponType, glbFile) {
  const manifestPath = path.join(ROOT, 'src', 'rendering', 'AssetManifest.js');
  let content = fs.readFileSync(manifestPath, 'utf-8');

  const weaponKey = `${skinId}_${weaponType}`;

  // Find the ASSET_MANIFEST class block — anchored to lines starting with "  classId: {"
  // and ending at the next top-level class or the closing of ASSET_MANIFEST.
  // We use a global regex to find ALL `classId: {` blocks and pick the one inside ASSET_MANIFEST
  // (the one with `weapons:` and `defaultWeapon:` properties).
  const assetMatchRegex = new RegExp(
    `(^  ${classId}: \\{[\\s\\S]*?defaultWeapon: '[^']*',[\\s\\S]*?\\n  \\},)`,
    'm'
  );
  const assetMatch = content.match(assetMatchRegex);
  if (!assetMatch) {
    console.warn(`  Could not find ASSET_MANIFEST block for ${classId} — manifest not updated`);
    return;
  }
  let block = assetMatch[1];

  // Add weapon to weapons map (within this block only)
  if (!block.includes(`${weaponKey}:`)) {
    const weaponsRegex = /(weapons:\s*\{[^}]*)(\})/m;
    block = block.replace(weaponsRegex, (full, before, close) => {
      // Trim trailing whitespace before close brace, then re-indent properly
      const trimmedBefore = before.replace(/\s*$/, '');
      return `${trimmedBefore}\n      ${weaponKey}: '${glbFile}',\n    ${close}`;
    });
  }

  // Add to skinWeapons (within this block only)
  if (block.includes('skinWeapons:')) {
    const skinPattern = new RegExp(`${skinId}:\\s*'[^']*'`);
    if (skinPattern.test(block)) {
      block = block.replace(skinPattern, `${skinId}: '${weaponKey}'`);
    } else {
      block = block.replace(/(skinWeapons:\s*\{[^}]*)(\})/m, (full, before, close) => {
        const trimmedBefore = before.replace(/\s*$/, '');
        return `${trimmedBefore}\n      ${skinId}: '${weaponKey}',\n    ${close}`;
      });
    }
  } else {
    // Add new skinWeapons block after defaultWeapon
    block = block.replace(
      /(defaultWeapon: '[^']*',)/,
      `$1\n    skinWeapons: {\n      ${skinId}: '${weaponKey}',\n    },`
    );
  }

  content = content.replace(assetMatch[1], block);
  fs.writeFileSync(manifestPath, content, 'utf-8');
  console.log(`  Registered skin weapon in AssetManifest: ${classId}.skinWeapons.${skinId} → ${weaponKey}`);
}

// ── CLI ──
const args = process.argv.slice(2);

function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : null;
}

const classId = args[0]?.toLowerCase();
const weaponFilter = getArg('--weapon');
const customPrompt = getArg('--prompt');
const skinImagePath = getArg('--skin-image');
const skinId = getArg('--skin');
const conceptOnly = args.includes('--concept-only');
const skipConcept = args.includes('--skip-concept');
const textTo3d = args.includes('--text-to-3d');
const previewOnly = args.includes('--preview-only');
const refineOnlyTaskId = getArg('--refine-only');

if (!classId) {
  console.log('Ebon Crucible — Weapon Generation Pipeline');
  console.log('');
  console.log('Usage: node scripts/generate-weapons.mjs <classId|all> --weapon <type> [options]');
  console.log('');
  console.log('Options:');
  console.log('  --weapon <type>          Generate only this weapon type');
  console.log('  --prompt <text>          Custom weapon description for concept art');
  console.log('  --concept-only           Generate concept art only (for review)');
  console.log('  --skip-concept           Use existing approved concept art, skip to Meshy');
  console.log('  --text-to-3d             Use legacy Text-to-3D pipeline instead of concept art');
  console.log('  --preview-only           (text-to-3d) Generate preview only');
  console.log('  --refine-only <taskId>   (text-to-3d) Refine existing preview task');
  console.log('');
  console.log('Default pipeline: concept art (gpt-image-1) → review → Meshy Image-to-3D');
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
  if (conceptOnly) console.log('Mode: concept art only (for review)');
  else if (skipConcept) console.log('Mode: using approved concept art → Image-to-3D');
  else if (textTo3d) console.log('Mode: Text-to-3D (legacy)');
  else console.log('Mode: concept art → Image-to-3D');

  const allResults = { success: [], failed: [] };
  for (const cls of classes) {
    try {
      const results = await generateClassWeapons(cls, weaponFilter, {
        conceptOnly, skipConcept, customPrompt, skinImagePath, skinId, textTo3d, previewOnly, refineOnlyTaskId,
      });
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
