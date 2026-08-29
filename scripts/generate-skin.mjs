#!/usr/bin/env node
/**
 * Ebon Crucible — Skin Generation Pipeline
 *
 * Two-mode concept art generation:
 *   1. Base model (--name default): gpt-image-1 generates A-pose from scratch
 *   2. Skin (--name X --prompt "..."): gpt-image-1 edits the base reference image,
 *      keeping pose/proportions and reskinning colors/materials/motifs
 *
 * Full pipeline: concept art → Meshy image-to-3D → auto-rig → rigged GLB
 *
 * Usage:
 *   node scripts/generate-skin.mjs --class tyrant --name default                          # Generate base reference
 *   node scripts/generate-skin.mjs --class tyrant --name "Frost" --prompt "icy blue dragon-scale plate, frost runes, crystal visor"
 *   node scripts/generate-skin.mjs --class tyrant --name "Frost" --image ./art.png        # Use custom image
 *   node scripts/generate-skin.mjs --class tyrant --name "Frost" --meshy-task <id>        # Resume from Meshy
 *   node scripts/generate-skin.mjs --class tyrant --list                                  # List existing skins
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Load API keys from .env ──
const envPath = path.join(ROOT, '.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const OPENAI_KEY = envContent.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const MESHY_KEY = envContent.match(/MESHY_API_KEY=(.+)/)?.[1]?.trim();

if (!OPENAI_KEY) { console.error('Missing OPENAI_API_KEY in .env'); process.exit(1); }
if (!MESHY_KEY) { console.error('Missing MESHY_API_KEY in .env'); process.exit(1); }

const MESHY_API = 'https://api.meshy.ai';
const MODELS_DIR = path.join(ROOT, 'public', 'assets', 'models');
const SKINS_DIR = path.join(MODELS_DIR, 'skins');
const CONCEPTS_DIR = path.join(ROOT, 'public', 'assets', 'art', 'concepts');
const ART_DIR = path.join(ROOT, 'public', 'assets', 'art');

// ── Per-class descriptions ──
// `silhouette` = body type/armor class (stays constant across all skins)
// `defaultTheme` = color/material theme used when no style modifier is given
const CLASS_DESCRIPTIONS = {
  tyrant: {
    name: 'Tyrant',
    silhouette: 'Dark fantasy armored warlord in heavy full plate armor, menacing hulking physique with thick gauntlets and greaves, horned helm with face-covering visor, pauldrons and breastplate, battle-scarred warrior',
    defaultTheme: 'crimson and black plate with spikes, demonic rune engravings, battle damage marks',
  },
  wraith: {
    name: 'Wraith',
    silhouette: 'Shadow assassin in sleek fitted leather armor with a tattered hood pulled up, lightweight agile build, ghostly pale skin on face and hands, belt with small pouches, cloth wrappings on forearms and calves',
    defaultTheme: 'dark purple and black leather, ethereal purple glow on edges, ghostly pale skin',
  },
  infernal: {
    name: 'Infernal',
    silhouette: 'Fire mage in flowing arcane robes, tall slender build, crown-like headpiece, ethereal cloth edges, ornate belt with crystal buckle, long sleeves with visible hands',
    defaultTheme: 'dark robes with glowing orange ember runes woven into fabric, smoldering cloth edges, living flame patterns',
  },
  harbinger: {
    name: 'Harbinger',
    silhouette: 'Death warlock in layered ritualistic robes, gaunt frame with elongated fingers, hooded with glowing eyes under the cowl, tattered cloth layers, bone and skull accessories',
    defaultTheme: 'dark robes with necrotic green glowing sigils, bone ornaments, green eldritch energy',
  },
  revenant: {
    name: 'Revenant',
    silhouette: 'Holy crusader knight in plate armor with tabard overlay, ornate shoulder guards, heavy armored boots, sacred cross emblem on chest, righteous but corrupted appearance',
    defaultTheme: 'ivory white tabard over weathered bronze and dark steel plate, faintly gold glowing cracked cross emblem',
  },
};

// ── A-pose prompt wrapper ──
function buildConceptPrompt(classId, styleModifier) {
  const classInfo = CLASS_DESCRIPTIONS[classId];

  // Silhouette (body type + armor class) is always the same for a given class.
  // The theme (colors, materials, motifs) changes per skin.
  const theme = styleModifier || classInfo.defaultTheme;

  return [
    'Full body character concept art in A-pose: arms angled 45 degrees away from body,',
    'palms facing inward, fingers relaxed and slightly spread, legs shoulder-width apart.',
    'Front view, centered in frame, transparent background.',
    'NO weapons in hands — hands are completely empty and open.',
    'Normal human proportions, approximately 6-7 heads tall, NOT oversized or exaggerated.',
    '',
    `Character body type: ${classInfo.silhouette}`,
    `Color and material theme: ${theme}`,
    '',
    'Style: professional game character reference sheet, dark fantasy aesthetic,',
    'detailed armor and clothing clearly visible on all limbs including hands and feet,',
    'full body from top of head to soles of feet, high detail, clean silhouette.',
  ].join('\n');
}

// ── Utilities ──
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function sanitizeName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

// ── Convert class portrait webp → PNG buffer (for OpenAI edit API) ──
import { execSync } from 'child_process';
import os from 'os';

function getPortraitPngBuffer(classId) {
  const portraitPath = path.join(ART_DIR, `${classId}_portrait.webp`);
  if (!fs.existsSync(portraitPath)) return null;

  try {
    const tmpPng = path.join(os.tmpdir(), `ebon_portrait_${classId}_${Date.now()}.png`);
    execSync(`dwebp "${portraitPath}" -o "${tmpPng}"`, { stdio: 'pipe' });
    const buf = fs.readFileSync(tmpPng);
    fs.unlinkSync(tmpPng); // cleanup
    console.log(`  Portrait reference: ${path.relative(ROOT, portraitPath)} → PNG (${(buf.length / 1024).toFixed(0)} KB)`);
    return buf;
  } catch (err) {
    console.warn(`  Could not convert portrait: ${err.message}`);
    return null;
  }
}

async function safeJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 300)}`); }
}

// ── OpenAI: Generate base concept art from scratch ──
async function generateBaseConceptArt(classId) {
  const prompt = buildConceptPrompt(classId, null);
  const outPath = path.join(CONCEPTS_DIR, `${classId}_default.png`);

  console.log('\n  Step 1: Generating base concept art (gpt-image-1 generation)...');
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
  console.log(`  Base concept art saved: ${outPath} (${(buf.length / 1024).toFixed(0)} KB)`);

  return { imagePath: outPath, imageBuffer: buf };
}

// ── OpenAI: Edit reference image to create skin variant ──
async function generateSkinConceptArt(classId, skinName, skinPrompt) {
  // Prefer class portrait as reference — it shows what the character actually looks like
  let refImage = getPortraitPngBuffer(classId);
  let refSource = 'portrait';

  if (!refImage) {
    // Fall back to base concept art
    const basePath = path.join(CONCEPTS_DIR, `${classId}_default.png`);
    if (!fs.existsSync(basePath)) {
      console.log('  No portrait or base reference found — generating base concept art first...');
      await generateBaseConceptArt(classId);
    }
    refImage = fs.readFileSync(basePath);
    refSource = 'base concept art';
  }

  const classInfo = CLASS_DESCRIPTIONS[classId];
  const outPath = path.join(CONCEPTS_DIR, `${classId}_${skinName}.png`);

  // Build an edit prompt that uses the portrait as reference but outputs an A-pose concept
  const editPrompt = [
    `Create a full-body A-pose character concept art based on this reference image of the character.`,
    `OUTPUT POSE: A-pose — arms angled 45 degrees away from body, palms inward, legs shoulder-width apart, front view, centered, transparent background.`,
    `KEEP: The character's general body type, armor class (${classInfo.silhouette.split(',')[0]}), and proportions.`,
    `EMPTY HANDS: No weapons — hands are completely open and empty.`,
    ``,
    `REDESIGN the armor, helm, and ornamental details to match this new theme:`,
    `${skinPrompt}`,
    ``,
    `The new armor should look like a completely different set — not just a recolor.`,
    `Dark fantasy game character concept art, high detail, full body head to toe, transparent background.`,
  ].join('\n');

  console.log(`\n  Step 1: Editing ${refSource} (gpt-image-1 edit)...`);
  console.log(`  Reference: ${refSource === 'portrait' ? `${classId}_portrait.webp` : `${classId}_default.png`}`);
  console.log(`  Edit prompt: "${editPrompt.slice(0, 120)}..."`);

  // Use multipart/form-data for the edit endpoint
  const baseImage = refImage;
  const boundary = '----EbonCrucibleBoundary' + Date.now();

  let body = '';
  // model
  body += `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\ngpt-image-1\r\n`;
  // prompt
  body += `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${editPrompt}\r\n`;
  // size
  body += `--${boundary}\r\nContent-Disposition: form-data; name="size"\r\n\r\n1024x1024\r\n`;
  // quality
  body += `--${boundary}\r\nContent-Disposition: form-data; name="quality"\r\n\r\nhigh\r\n`;
  // background
  body += `--${boundary}\r\nContent-Disposition: form-data; name="background"\r\n\r\ntransparent\r\n`;

  // Build binary body with image
  const preImage = Buffer.from(
    body + `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${classId}_reference.png"\r\nContent-Type: image/png\r\n\r\n`,
    'utf-8'
  );
  const postImage = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
  const fullBody = Buffer.concat([preImage, baseImage, postImage]);

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
  console.log(`  Skin concept art saved: ${outPath} (${(buf.length / 1024).toFixed(0)} KB)`);

  return { imagePath: outPath, imageBuffer: buf };
}

// ── Extract image buffer from OpenAI response ──
async function extractImageBuffer(data) {
  if (data.data?.[0]?.b64_json) {
    return Buffer.from(data.data[0].b64_json, 'base64');
  } else if (data.data?.[0]?.url) {
    const dlResp = await fetch(data.data[0].url);
    return Buffer.from(await dlResp.arrayBuffer());
  }
  throw new Error(`No image in response: ${JSON.stringify(data).slice(0, 300)}`);
}

// ── Legacy: Generate concept art from scratch (used when no base reference exists) ──
async function generateConceptArt(classId, skinName, skinPrompt) {
  const prompt = buildConceptPrompt(classId, skinPrompt);
  const outPath = path.join(CONCEPTS_DIR, `${classId}_${skinName}.png`);

  console.log('\n  Step 1: Generating concept art (gpt-image-1)...');
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
  console.log(`  Concept art saved: ${outPath} (${(buf.length / 1024).toFixed(0)} KB)`);

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
  const maxAttempts = 360; // 30 min max
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

// ── Meshy: Image-to-3D ──
async function meshyImageTo3D(imageBuffer) {
  console.log('\n  Step 2: Submitting to Meshy image-to-3D...');

  const base64 = `data:image/png;base64,${imageBuffer.toString('base64')}`;

  const result = await meshyPost('/openapi/v1/image-to-3d', {
    image_url: base64,
    ai_model: 'meshy-6',
    topology: 'triangle',
    target_polycount: 30000,
    should_texture: true,
    enable_pbr: true,
  });

  const taskId = result.result;
  console.log(`  Image-to-3D Task ID: ${taskId}`);
  console.log('  (Save this ID to resume with --meshy-task if needed)');

  const taskData = await meshyPoll('/openapi/v1/image-to-3d', taskId, 'Image-to-3D');
  return { taskId, taskData };
}

// ── Meshy: Remesh (reduce poly count for rigging) ──
async function meshyRemesh(imageTo3dTaskId) {
  console.log('\n  Step 3a: Remeshing model (reducing to 200K polys for rigging)...');

  const result = await meshyPost('/openapi/v1/remesh', {
    input_task_id: imageTo3dTaskId,
    target_polycount: 200000,
    topology: 'triangle',
  });

  const remeshTaskId = result.result;
  console.log(`  Remesh Task ID: ${remeshTaskId}`);

  const remeshData = await meshyPoll('/openapi/v1/remesh', remeshTaskId, 'Remesh');
  return { remeshTaskId, remeshData };
}

// ── Meshy: Auto-Rig ──
async function meshyRig(remeshTaskId) {
  console.log('\n  Step 3b: Auto-rigging model...');

  const result = await meshyPost('/openapi/v1/rigging', {
    input_task_id: remeshTaskId,
    height_meters: 1.8,
  });

  const rigTaskId = result.result;
  console.log(`  Rig Task ID: ${rigTaskId}`);
  console.log('  (Save this ID for animation generation with generate-animations.mjs)');

  const rigData = await meshyPoll('/openapi/v1/rigging', rigTaskId, 'Rigging');
  return { rigTaskId, rigData };
}

// ── Main pipeline ──
async function generateSkin(classId, skinName, options = {}) {
  const { prompt, imagePath, meshyTaskId, rigTaskId: resumeRigTaskId, conceptOnly, skipConcept } = options;
  const isDefault = skinName === 'default';

  const destDir = isDefault ? MODELS_DIR : SKINS_DIR;
  const destFile = isDefault
    ? `char_${classId}.glb`
    : `${classId}_${skinName}.glb`;
  const destPath = path.join(destDir, destFile);

  fs.mkdirSync(destDir, { recursive: true });
  fs.mkdirSync(CONCEPTS_DIR, { recursive: true });

  console.log(`\n${'═'.repeat(60)}`);
  if (conceptOnly) {
    console.log(`  GENERATING CONCEPT ART: ${CLASS_DESCRIPTIONS[classId].name}`);
  } else {
    console.log(`  GENERATING ${isDefault ? 'BASE MODEL' : 'SKIN'}: ${CLASS_DESCRIPTIONS[classId].name}`);
  }
  if (!isDefault) console.log(`  Skin: ${skinName}`);
  if (!conceptOnly) console.log(`  Output: ${path.relative(ROOT, destPath)}`);
  console.log('═'.repeat(60));

  let imageBuffer;
  let i2dTaskId = meshyTaskId;
  let rigId = resumeRigTaskId;

  // ── Step 1: Concept art ──
  const conceptPath = path.join(CONCEPTS_DIR, `${classId}_${skinName}.png`);

  if (skipConcept) {
    // Use existing concept art (user already approved it)
    if (fs.existsSync(conceptPath)) {
      console.log(`\n  Step 1: Using approved concept art: ${path.relative(ROOT, conceptPath)}`);
      imageBuffer = fs.readFileSync(conceptPath);
    } else {
      throw new Error(`No concept art found at ${conceptPath}. Generate concept first.`);
    }
  } else if (!imagePath && !i2dTaskId && !rigId) {
    if (isDefault) {
      const result = await generateBaseConceptArt(classId);
      imageBuffer = result.imageBuffer;
    } else if (prompt) {
      const result = await generateSkinConceptArt(classId, skinName, prompt);
      imageBuffer = result.imageBuffer;
    } else {
      const result = await generateConceptArt(classId, skinName, null);
      imageBuffer = result.imageBuffer;
    }

    // Concept-only mode: stop after generating the art
    if (conceptOnly) {
      console.log(`\n${'─'.repeat(60)}`);
      console.log('  CONCEPT ART READY FOR REVIEW');
      console.log(`  File: ${path.relative(ROOT, conceptPath)}`);
      console.log(`  URL:  /assets/art/concepts/${classId}_${skinName}.png`);
      console.log('─'.repeat(60) + '\n');
      return { conceptPath, conceptUrl: `/assets/art/concepts/${classId}_${skinName}.png` };
    }
  } else if (imagePath && !i2dTaskId && !rigId) {
    console.log(`\n  Step 1: Using provided image: ${imagePath}`);
    imageBuffer = fs.readFileSync(imagePath);
  }

  // ── Step 2: Image-to-3D (skip if --meshy-task or --rig-task) ──
  if (!i2dTaskId && !rigId) {
    const result = await meshyImageTo3D(imageBuffer);
    i2dTaskId = result.taskId;
  } else if (i2dTaskId && !rigId) {
    console.log(`\n  Step 2: Resuming from Meshy task: ${i2dTaskId}`);
    // Poll the existing task to completion
    await meshyPoll('/openapi/v1/image-to-3d', i2dTaskId, 'Image-to-3D');
  }

  // ── Step 3a: Remesh (reduce poly count for rigging limit) ──
  let remeshId;
  if (!rigId) {
    const remeshResult = await meshyRemesh(i2dTaskId);
    remeshId = remeshResult.remeshTaskId;
  }

  // ── Step 3b: Auto-rig (skip if --rig-task) ──
  let rigData;
  if (!rigId) {
    const result = await meshyRig(remeshId);
    rigId = result.rigTaskId;
    rigData = result.rigData;
  } else {
    console.log(`\n  Step 3b: Resuming from rig task: ${rigId}`);
    rigData = await meshyPoll('/openapi/v1/rigging', rigId, 'Rigging');
  }

  // ── Step 4: Download rigged GLB ──
  console.log('\n  Step 4: Downloading rigged model...');
  const glbUrl = rigData?.result?.rigged_character_glb_url;
  if (!glbUrl) {
    console.error('  No rigged GLB URL in result:', JSON.stringify(rigData?.result || {}).slice(0, 300));
    throw new Error('No rigged GLB URL found');
  }

  // Backup existing file
  if (fs.existsSync(destPath)) {
    const backup = destPath.replace('.glb', `_backup_${Date.now()}.glb`);
    fs.copyFileSync(destPath, backup);
    console.log(`  Backed up existing: ${path.basename(backup)}`);
  }

  await downloadFile(glbUrl, destPath);

  // ── Summary ──
  console.log(`\n${'─'.repeat(60)}`);
  console.log('  DONE!');
  console.log(`  Model:    ${path.relative(ROOT, destPath)}`);
  console.log(`  Rig Task: ${rigId}`);
  console.log('');
  console.log('  Next steps:');
  console.log('    1. Open viewer.html → select class → load this skin');
  console.log('    2. Test animations (idle, run, attack, etc.)');
  console.log('    3. Attach weapons and adjust offsets');
  console.log('');
  console.log('  To generate animations for this rig:');
  console.log(`    node scripts/generate-animations.mjs --rig-task ${rigId}`);
  console.log('─'.repeat(60) + '\n');

  return { destPath, rigTaskId: rigId, meshyTaskId: i2dTaskId };
}

// ── List skins ──
function listSkins(classId) {
  const classes = classId === 'all' ? Object.keys(CLASS_DESCRIPTIONS) : [classId];

  console.log(`\n  Existing skins:\n`);
  for (const cls of classes) {
    const baseExists = fs.existsSync(path.join(MODELS_DIR, `char_${cls}.glb`));
    console.log(`  ${CLASS_DESCRIPTIONS[cls].name}:`);
    console.log(`    ${baseExists ? '✓' : '✗'} default (char_${cls}.glb)`);

    if (fs.existsSync(SKINS_DIR)) {
      const skins = fs.readdirSync(SKINS_DIR)
        .filter(f => f.startsWith(`${cls}_`) && f.endsWith('.glb') && !f.includes('_backup_'));
      for (const skin of skins) {
        const skinName = skin.replace(`${cls}_`, '').replace('.glb', '');
        console.log(`    ✓ ${skinName} (skins/${skin})`);
      }
      if (skins.length === 0) {
        console.log('    (no skins generated yet)');
      }
    } else {
      console.log('    (no skins generated yet)');
    }
    console.log('');
  }

  // Check for concept art
  if (fs.existsSync(CONCEPTS_DIR)) {
    const concepts = fs.readdirSync(CONCEPTS_DIR).filter(f => f.endsWith('.png'));
    if (concepts.length > 0) {
      console.log(`  Concept art (${concepts.length} files):`);
      for (const c of concepts) {
        console.log(`    ${c}`);
      }
      console.log('');
    }
  }
}

// ── CLI ──
const args = process.argv.slice(2);

function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : null;
}

const classId = getArg('--class')?.toLowerCase();
const skinNameRaw = getArg('--name');
const skinPrompt = getArg('--prompt');
const imagePath = getArg('--image');
const meshyTaskId = getArg('--meshy-task');
const rigTaskId = getArg('--rig-task');
const doList = args.includes('--list');
const conceptOnly = args.includes('--concept-only');
const skipConcept = args.includes('--skip-concept');

if (!classId) {
  console.log('Ebon Crucible — Skin Generation Pipeline');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/generate-skin.mjs --class <id> --name <name> [options]');
  console.log('');
  console.log('Options:');
  console.log('  --class <id>          Class ID (tyrant, wraith, infernal, harbinger, revenant, or all)');
  console.log('  --name <name>         Skin name (use "default" to regenerate base model)');
  console.log('  --prompt <text>       Custom armor/appearance description (overrides base class look)');
  console.log('  --image <path>        Skip concept art generation, use this image file');
  console.log('  --meshy-task <id>     Resume from existing Meshy image-to-3D task');
  console.log('  --rig-task <id>       Resume from existing Meshy rigging task');
  console.log('  --list                List existing skins for the class');
  console.log('');
  console.log('Examples:');
  console.log('  # Generate a new skin');
  console.log('  node scripts/generate-skin.mjs --class tyrant --name "Frost Warlord" \\');
  console.log('    --prompt "ice crystal plate armor, blue glow, frost-covered pauldrons"');
  console.log('');
  console.log('  # Regenerate base model with proper A-pose');
  console.log('  node scripts/generate-skin.mjs --class tyrant --name default');
  console.log('');
  console.log('  # Regenerate ALL base models');
  console.log('  node scripts/generate-skin.mjs --class all --name default');
  console.log('');
  console.log('  # Use your own concept art image');
  console.log('  node scripts/generate-skin.mjs --class tyrant --name "Custom" --image ./my-art.png');
  console.log('');
  console.log(`Available classes: ${Object.keys(CLASS_DESCRIPTIONS).join(', ')}`);
  process.exit(1);
}

if (doList) {
  listSkins(classId);
  process.exit(0);
}

if (!skinNameRaw && !doList) {
  console.error('Error: --name is required (use "default" for base model)');
  process.exit(1);
}

const skinName = sanitizeName(skinNameRaw);

async function main() {
  const classes = classId === 'all' ? Object.keys(CLASS_DESCRIPTIONS) : [classId];

  if (!CLASS_DESCRIPTIONS[classes[0]] && classId !== 'all') {
    console.error(`Unknown class: ${classId}. Available: ${Object.keys(CLASS_DESCRIPTIONS).join(', ')}`);
    process.exit(1);
  }

  const results = { success: [], failed: [] };

  for (const cls of classes) {
    try {
      await generateSkin(cls, skinName, {
        prompt: skinPrompt,
        imagePath,
        meshyTaskId,
        rigTaskId,
        conceptOnly,
        skipConcept,
      });
      results.success.push(cls);
    } catch (err) {
      console.error(`\n  ${cls.toUpperCase()} failed: ${err.message}`);
      results.failed.push(cls);
    }
  }

  if (classes.length > 1) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log('  SUMMARY');
    console.log('═'.repeat(60));
    console.log(`  Success: ${results.success.map(c => c.toUpperCase()).join(', ') || 'none'}`);
    if (results.failed.length) {
      console.log(`  Failed:  ${results.failed.map(c => c.toUpperCase()).join(', ')}`);
    }
    console.log('═'.repeat(60) + '\n');
  }
}

main().catch(err => {
  console.error(`\n  Fatal: ${err.message}`);
  process.exit(1);
});
