#!/usr/bin/env node
/**
 * Generate class-specific texture skins using the Meshy Retexture API.
 * Takes the base_humanoid.glb and applies AI-generated textures for each class.
 *
 * Usage: node scripts/generate-skins.mjs [classId]
 * If no classId specified, generates all 5 classes.
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

const BASE_MESH = path.join(ROOT, 'public', 'assets', 'models', 'base_humanoid.glb');
const TEXTURE_OUT = path.join(ROOT, 'public', 'assets', 'textures');

// Per-class config: prompt + optional style reference image
const CLASS_CONFIG = {
  tyrant: {
    prompt: 'Dark fantasy armored warlord, heavy crimson and black plate armor with spikes and battle damage, demonic rune engravings, dark steel gauntlets, war-torn champion, high detail PBR textures, 4K quality',
    styleRef: 'tex_tyrant_body.webp',
  },
  wraith: {
    prompt: 'Shadow assassin in dark leather armor with tattered hood, ghostly pale skin visible, dark purple cloth wrappings, stealthy rogue with poisoned blade sheaths, high detail PBR textures, 4K quality',
    styleRef: 'tex_wraith_body.webp',
  },
  infernal: {
    prompt: 'Fire mage in flowing arcane robes with glowing ember runes, crown of living flame patterns, deep red and orange fabric with magical ash particles, high detail PBR textures, 4K quality',
    styleRef: 'tex_infernal_body.webp',
  },
  harbinger: {
    prompt: 'Death warlock in dark ritualistic robes, bone and skull accessories, necrotic green glowing sigils, tattered dark cloth, horned headpiece, necromancer, high detail PBR textures, 4K quality',
    styleRef: 'tex_harbinger_body.webp',
  },
  revenant: {
    prompt: 'Dark fantasy holy crusader knight, ivory white tabard draped over weathered bronze and dark steel plate armor, ornate golden cross emblem on chest, aged gold trim accents only, warm dark tones, battle-worn sacred warrior, muted color palette, high detail PBR textures, 4K quality',
    styleRef: null,
    splashRef: 'revenant_splash.png',
  },
};

const MESHY_API = 'https://api.meshy.ai';

async function createRetextureTask(modelBase64, prompt, styleImageBase64) {
  const body = {
    model_url: `data:application/octet-stream;base64,${modelBase64}`,
    text_style_prompt: prompt,
    enable_original_uv: true,
    enable_pbr: true,
    ai_model: 'latest',
  };

  // Add style reference image if available (guides AI toward existing art style)
  if (styleImageBase64) {
    body.image_style_url = `data:image/png;base64,${styleImageBase64}`;
  }

  const res = await fetch(`${MESHY_API}/openapi/v1/retexture`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Retexture create failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.result; // task ID
}

async function pollTask(taskId) {
  const maxAttempts = 120; // 10 min max
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`${MESHY_API}/openapi/v1/retexture/${taskId}`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
    });

    if (!res.ok) {
      console.warn(`  Poll failed (${res.status}), retrying...`);
      await sleep(5000);
      continue;
    }

    const data = await res.json();
    const status = data.status;

    if (status === 'SUCCEEDED') {
      return data;
    } else if (status === 'FAILED') {
      throw new Error(`Task ${taskId} failed: ${data.task_error?.message || 'unknown error'}`);
    }

    process.stdout.write(`  Status: ${status} (attempt ${i + 1}/${maxAttempts})\r`);
    await sleep(5000);
  }

  throw new Error(`Task ${taskId} timed out`);
}

async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function generateSkin(classId) {
  const config = CLASS_CONFIG[classId];
  if (!config) {
    console.error(`Unknown class: ${classId}`);
    return;
  }

  const outDir = path.join(TEXTURE_OUT, `skin_${classId}`);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`\n═══ Generating skin for ${classId.toUpperCase()} ═══`);
  console.log(`  Prompt: "${config.prompt}"`);

  // Read and base64 encode the base mesh
  console.log('  Reading base mesh...');
  const meshBuffer = fs.readFileSync(BASE_MESH);
  const meshBase64 = meshBuffer.toString('base64');
  console.log(`  Base mesh: ${(meshBuffer.length / 1024 / 1024).toFixed(1)}MB → ${(meshBase64.length / 1024 / 1024).toFixed(1)}MB base64`);

  // Load style reference image if available
  let styleImageBase64 = null;
  if (config.splashRef) {
    // Use splash art from public/assets/art/ as style guide
    const refPath = path.join(ROOT, 'public', 'assets', 'art', config.splashRef);
    if (fs.existsSync(refPath)) {
      styleImageBase64 = fs.readFileSync(refPath).toString('base64');
      console.log(`  Style reference (splash art): ${config.splashRef} (${(styleImageBase64.length / 1024).toFixed(0)}KB base64)`);
    } else {
      console.log(`  Splash art not found: ${refPath}`);
    }
  } else if (config.styleRef) {
    const refPath = path.join(TEXTURE_OUT, config.styleRef);
    if (fs.existsSync(refPath)) {
      styleImageBase64 = fs.readFileSync(refPath).toString('base64');
      console.log(`  Style reference: ${config.styleRef} (${(styleImageBase64.length / 1024).toFixed(0)}KB base64)`);
    } else {
      console.log(`  Style reference not found: ${refPath} (using text prompt only)`);
    }
  }

  // Create retexture task
  console.log('  Creating retexture task (ai_model: latest)...');
  const taskId = await createRetextureTask(meshBase64, config.prompt, styleImageBase64);
  console.log(`  Task ID: ${taskId}`);

  // Poll until done
  console.log('  Waiting for completion...');
  const result = await pollTask(taskId);
  console.log('\n  Task completed!');

  // Download textures — API returns texture_urls as an array of texture set objects
  if (result.texture_urls && Array.isArray(result.texture_urls)) {
    const texSet = result.texture_urls[0]; // first (and usually only) texture set
    if (texSet) {
      const TEX_MAP = {
        base_color: 'diffuse',
        metallic: 'metallic',
        roughness: 'roughness',
        normal: 'normal',
      };
      for (const [apiKey, localName] of Object.entries(TEX_MAP)) {
        if (texSet[apiKey]) {
          const dest = path.join(outDir, `${localName}.png`);
          console.log(`  Downloading ${localName} texture...`);
          await downloadFile(texSet[apiKey], dest);
          console.log(`  Saved: ${dest}`);
        }
      }
    }
  }

  // Also download the retextured GLB as backup
  if (result.model_urls?.glb) {
    const glbDest = path.join(outDir, 'retextured.glb');
    console.log('  Downloading retextured GLB...');
    await downloadFile(result.model_urls.glb, glbDest);
    console.log(`  Saved: ${glbDest}`);
  }

  console.log(`  ✓ Skin for ${classId} complete!`);
}

// ── Main ──
const args = process.argv.slice(2);
const classIds = args.length > 0 ? args : Object.keys(CLASS_CONFIG);

console.log('Meshy Retexture Skin Generator');
console.log(`Classes: ${classIds.join(', ')}`);
console.log(`Base mesh: ${BASE_MESH}`);

(async () => {
  for (const classId of classIds) {
    try {
      await generateSkin(classId);
    } catch (err) {
      console.error(`\n  ✗ Failed for ${classId}:`, err.message);
    }
  }
  console.log('\nDone!');
})();
