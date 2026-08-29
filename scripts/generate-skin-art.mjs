#!/usr/bin/env node
// Generate showcase art for a published skin via gpt-image-1
// Uses concept art as reference to create: portrait, splash, banner, loading screen, icon
// Also registers the skin in AssetManifest.js (SKIN_CATALOG + ASSET_MANIFEST character entry)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';

const ROOT = resolve(import.meta.dirname, '..');
const envText = readFileSync(resolve(ROOT, '.env'), 'utf-8');
const apiKey = envText.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
if (!apiKey) { console.error('No OPENAI_API_KEY in .env'); process.exit(1); }

const OUTPUT_DIR = resolve(ROOT, 'public/assets/art/skins');
const CONCEPTS_DIR = resolve(ROOT, 'public/assets/art/concepts');
const MANIFEST_PATH = resolve(ROOT, 'src/rendering/AssetManifest.js');

mkdirSync(OUTPUT_DIR, { recursive: true });

// ── Class descriptions for prompt context ──
const CLASS_DESCRIPTIONS = {
  tyrant: {
    name: 'Tyrant',
    silhouette: 'Dark fantasy armored warlord wielding a massive greatsword, heavy full plate armor, menacing hulking physique with thick gauntlets and greaves, horned helm with face-covering visor, pauldrons and breastplate, battle-scarred warrior, greatsword gripped in both hands',
    weaponConcept: 'wpn_tyrant_greatsword.png',
  },
  wraith: {
    name: 'Wraith',
    silhouette: 'Shadow assassin wielding twin daggers, sleek fitted leather armor with a tattered hood pulled up, lightweight agile build, ghostly pale skin on face and hands, belt with small pouches, cloth wrappings on forearms and calves, a dagger in each hand',
    weaponConcept: 'wpn_wraith_daggers.png',
  },
  infernal: {
    name: 'Infernal',
    silhouette: 'Fire mage in flowing arcane robes wielding a tall ornate staff, tall slender build, crown-like headpiece, ethereal cloth edges, ornate belt with crystal buckle, long sleeves with visible hands, staff held in right hand',
    weaponConcept: 'wpn_infernal_staff.png',
  },
  harbinger: {
    name: 'Harbinger',
    silhouette: 'Death warlock wielding a gnarled dark staff, layered ritualistic robes, gaunt frame with elongated fingers, hooded with glowing eyes under the cowl, tattered cloth layers, bone and skull accessories, staff held in right hand crackling with death magic',
    weaponConcept: 'wpn_harbinger_staff.png',
  },
  revenant: {
    name: 'Revenant',
    silhouette: 'Holy crusader knight wielding a glowing mace in right hand and a heavy shield in left hand, plate armor with tabard overlay, ornate shoulder guards, heavy armored boots, sacred cross emblem on chest, righteous but corrupted appearance',
    weaponConcept: 'wpn_revenant_mace.png',
  },
};

// ── Parse CLI args ──
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : null;
}

const classId = getArg('class');
const skinId = getArg('skin');
const skinName = getArg('name') || skinId?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const rarity = getArg('rarity') || 'epic';
const price = parseInt(getArg('price') || '5000', 10);
const description = getArg('description') || `${skinName} skin for ${CLASS_DESCRIPTIONS[classId]?.name || classId}`;
const skipExisting = args.includes('--skip-existing');
const skipRegister = args.includes('--skip-register');

if (!classId || !skinId) {
  console.error('Usage: node generate-skin-art.mjs --class <classId> --skin <skinId> [--name "Display Name"] [--rarity epic] [--price 5000] [--description "..."] [--skip-existing] [--skip-register]');
  process.exit(1);
}

const classInfo = CLASS_DESCRIPTIONS[classId];
if (!classInfo) {
  console.error(`Unknown class: ${classId}. Available: ${Object.keys(CLASS_DESCRIPTIONS).join(', ')}`);
  process.exit(1);
}

const skinKey = `${classId}_${skinId}`;
const conceptPath = resolve(CONCEPTS_DIR, `${skinKey}.png`);

// Try alternate concept art names
let conceptArtPath = null;
for (const candidate of [conceptPath, resolve(CONCEPTS_DIR, `${skinKey}_inspired_plate_armor.png`)]) {
  if (existsSync(candidate)) {
    conceptArtPath = candidate;
    break;
  }
}

// ── Load concept art as base64 for image reference ──
let conceptBase64 = null;
if (conceptArtPath) {
  conceptBase64 = readFileSync(conceptArtPath).toString('base64');
  console.log(`Loaded concept art: ${conceptArtPath}`);
} else {
  console.warn(`No concept art found at ${conceptPath} — generating without reference`);
}

// ── Load weapon concept art as second reference ──
let weaponBase64 = null;
if (classInfo.weaponConcept) {
  const wpnPath = resolve(CONCEPTS_DIR, classInfo.weaponConcept);
  if (existsSync(wpnPath)) {
    weaponBase64 = readFileSync(wpnPath).toString('base64');
    console.log(`Loaded weapon concept: ${wpnPath}`);
  } else {
    console.warn(`No weapon concept art at ${wpnPath} — generating without weapon reference`);
  }
}

// ── Art asset definitions ──
const STYLE_SUFFIX = 'dark fantasy arena combat game, highly detailed digital painting, League of Legends splash art quality, vibrant colors and strong contrast, no text no letters no words no writing no UI elements';

// Build a rich visual prompt — emphasize matching the provided concept art reference images
const visualFeaturesBase = `CRITICAL: This character MUST look EXACTLY like the character shown in the first reference image — match the armor design, head/helmet shape, material textures, color palette, and glowing accents precisely. The character is the "${skinName}" skin. ${description}. Reproduce every distinctive visual detail from the reference: unique helmet/mask shape, shoulder armor silhouette, glowing eye color, material finish, and overall color scheme.`;
const weaponFeatures = weaponBase64
  ? ` The character MUST be wielding the weapon shown in the second reference image — reproduce its exact design, proportions, material, and glowing elements. The weapon is prominent and clearly visible.`
  : '';
const visualFeatures = visualFeaturesBase;
const visualFeaturesWithWeapon = visualFeaturesBase + weaponFeatures;

// Class-specific action verbs for dynamic poses
const CLASS_ACTIONS = {
  tyrant: { verb: 'swinging a massive greatsword mid-cleave', scene: 'sparks and shockwaves erupting from the blade impact, cracked arena floor, debris flying' },
  wraith: { verb: 'lunging forward with twin daggers in a lethal strike', scene: 'shadow trails and dark energy wisps, vanishing afterimages, poison dripping from blades' },
  infernal: { verb: 'wielding a tall ornate staff and channeling a devastating spell through it', scene: 'fire and ice magic exploding from the staff tip, arcane runes floating in the air, elemental chaos, the staff is prominent and glowing with power' },
  harbinger: { verb: 'channeling dark necromantic energy through a gnarled staff', scene: 'green soul flames spiraling from the staff tip, skeletal hands reaching from the ground, death magic pulsing through the weapon' },
  revenant: { verb: 'raising a glowing mace and shield in righteous fury', scene: 'holy light radiating outward, divine runes blazing, golden energy shattering darkness' },
};
const classAction = CLASS_ACTIONS[classId] || { verb: 'in an aggressive combat stance', scene: 'magical energy crackling around them' };

const assets = [
  {
    // Portrait: Dramatic casting pose for nameplate/HUD — head and upper body, magical energy
    name: `${skinKey}_portrait`,
    size: '1024x1024',
    format: 'webp',
    includeWeapon: false,
    prompt: `Epic close-up portrait of a ${classInfo.silhouette}. ${visualFeatures} Dramatic side lighting with strong contrast, intense expression, ornate armor details filling the frame, dark moody background with faint magical energy, sharp focus on material textures and glowing accents, ${STYLE_SUFFIX}`,
  },
  {
    // Splash: THE premier showcase art — full action mid-combat, weapon front and center. This sells the skin.
    name: `${skinKey}_splash_wide`,
    size: '1536x1024',
    format: 'webp',
    includeWeapon: true,
    prompt: `EPIC ACTION SCENE: A ${classInfo.silhouette} ${classAction.verb} — ${classAction.scene}. ${visualFeaturesWithWeapon} Dramatic low camera angle looking up at the champion. The weapon is the FOCAL POINT — mid-swing or channeling energy, glowing with power, at the center of the composition. Extreme motion blur, cinematic depth of field with bokeh, volumetric dust and particle effects. The character is MID-ACTION not posing — muscles tensed, weight shifting, caught in a split-second of combat. KEY: Brightly lit from magical effects and rim lighting so all armor and weapon details are vivid and clear — NOT a dark silhouette, ${STYLE_SUFFIX}`,
  },
  {
    // Banner: Arena entrance / intimidation shot — walking toward camera, weapon at their side
    name: `${skinKey}_banner`,
    size: '1536x1024',
    format: 'webp',
    includeWeapon: true,
    prompt: `CINEMATIC HERO ENTRANCE: A ${classInfo.silhouette} strides through the gates of a dark fantasy arena colosseum, weapon held at their side, cape or robes billowing dramatically. ${visualFeaturesWithWeapon} Wide panoramic composition — the warrior walks TOWARD the camera from deep in the arena entrance, silhouetted against blazing torchlight behind them. Crumbling stone pillars frame the shot. Atmospheric fog and embers swirl. The crowd is a blur of shadows in the stands above. Weapon is clearly visible and matches the reference. KEY: Dramatic backlighting with strong rim light outlining every armor detail, face and weapon illuminated by magical glow from below, ${STYLE_SUFFIX}`,
  },
  {
    // Loading: Victory / finishing blow moment — weapon raised, enemy defeated
    name: `${skinKey}_loading`,
    size: '1536x1024',
    format: 'webp',
    includeWeapon: true,
    prompt: `VICTORY MOMENT: A ${classInfo.silhouette} raises their weapon triumphantly after a devastating finishing blow in a dark fantasy arena — ${classAction.scene}. ${visualFeaturesWithWeapon} The weapon is raised high, still crackling with residual energy from the killing strike. A defeated foe lies as a faint shadow/silhouette at their feet. The champion stands tall with one foot forward, weight shifted, looking down at the fallen. Camera at ground level looking UP at the champion. Debris and magical particles settling around them. KEY: Character BRIGHTLY illuminated by magical afterglow and dramatic uplighting, weapon glowing prominently overhead, high contrast between the lit champion and the dark arena behind, ${STYLE_SUFFIX}`,
  },
  {
    // Icon: Tight bust with weapon visible — for shop thumbnails, UI elements
    name: `${skinKey}_icon`,
    size: '1024x1024',
    format: 'webp',
    includeWeapon: true,
    prompt: `Stylized bust icon of a ${classInfo.silhouette} in a fierce battle cry. ${visualFeaturesWithWeapon} Bold dramatic three-quarter view, head turned slightly toward camera, weapon visible rising from behind the shoulder or gripped beside the face. Vivid glowing accent colors and magical energy crackling around the weapon tip. Dark background with subtle magical particles. Tight crop showing head, shoulders, and weapon — maximum detail on armor textures and weapon design. Game UI icon style, clean powerful silhouette, ${STYLE_SUFFIX}`,
  },
];

// ── Generate art ──
console.log(`\n╔══════════════════════════════════════════╗`);
console.log(`║  GENERATING SKIN ART: ${skinName.padEnd(18)} ║`);
console.log(`║  Class: ${classInfo.name.padEnd(31)} ║`);
console.log(`║  Assets: ${assets.length} images                      ║`);
console.log(`╚══════════════════════════════════════════╝\n`);

let generated = 0;
let failed = 0;

for (const asset of assets) {
  const ext = asset.format === 'png' ? 'png' : 'webp';
  const outPath = resolve(OUTPUT_DIR, `${asset.name}.${ext}`);

  if (skipExisting && existsSync(outPath)) {
    console.log(`  [SKIP] ${asset.name} (already exists)`);
    generated++;
    continue;
  }

  console.log(`  [${generated + failed + 1}/${assets.length}] Generating ${asset.name} (${asset.size})...`);

  try {
    let data;

    // gpt-image-1 edit API supports all sizes (1024x1024, 1536x1024, 1024x1536).
    // Always use concept art as reference when available for visual consistency.
    const canUseEditApi = !!conceptBase64;

    if (canUseEditApi) {
      // Use gpt-image-1 edit mode with concept art as reference (all sizes)
      const form = new FormData();
      form.append('model', 'gpt-image-1');
      form.append('prompt', asset.prompt);
      form.append('n', '1');
      form.append('size', asset.size);

      // Reference image 1: character concept art
      const buf = Buffer.from(conceptBase64, 'base64');
      const blob = new Blob([buf], { type: 'image/png' });
      form.append('image[]', blob, 'character.png');

      // Reference image 2: weapon concept art (only for assets that need it)
      if (asset.includeWeapon && weaponBase64) {
        const wpnBuf = Buffer.from(weaponBase64, 'base64');
        const wpnBlob = new Blob([wpnBuf], { type: 'image/png' });
        form.append('image[]', wpnBlob, 'weapon.png');
      }

      const resp = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        body: form,
      });
      data = await resp.json();
    } else {
      // Generation mode — no reference image, supports all sizes
      const resp = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-image-1',
          prompt: asset.prompt,
          n: 1,
          size: asset.size,
          quality: 'high',
        }),
      });
      data = await resp.json();
    }

    if (!data.data?.[0]) {
      console.error(`    FAILED: ${JSON.stringify(data).slice(0, 300)}`);
      failed++;
      continue;
    }

    const imgData = data.data[0];
    let imgBuf;
    if (imgData.b64_json) {
      imgBuf = Buffer.from(imgData.b64_json, 'base64');
    } else if (imgData.url) {
      const dlResp = await fetch(imgData.url);
      imgBuf = Buffer.from(await dlResp.arrayBuffer());
    } else {
      console.error(`    No image data returned`);
      failed++;
      continue;
    }

    writeFileSync(outPath, imgBuf);
    console.log(`    Saved (${(imgBuf.length / 1024).toFixed(0)} KB) -> ${asset.name}.${ext}`);
    generated++;
  } catch (err) {
    console.error(`    ERROR: ${err.message}`);
    failed++;
  }

  // Rate limit delay between generations
  await new Promise(r => setTimeout(r, 10000));
}

console.log(`\n  ART COMPLETE: ${generated} generated, ${failed} failed\n`);

// ── Register skin in AssetManifest.js ──
if (!skipRegister) {
  console.log('  REGISTERING skin in AssetManifest.js...');

  let source = readFileSync(MANIFEST_PATH, 'utf-8');
  const skinCatalogKey = skinKey;

  // Helper: find the section of source between a marker and its closing `};`
  function findSection(src, marker) {
    const start = src.indexOf(marker);
    if (start === -1) return null;
    const braceStart = src.indexOf('{', start);
    // Find matching closing brace — count nested braces
    let depth = 1, i = braceStart + 1;
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    }
    return { start, braceStart, end: i, text: src.slice(start, i) };
  }

  // 1. Add to ASSET_MANIFEST character entries (scoped to correct class block)
  const manifestSection = findSection(source, 'export const ASSET_MANIFEST = {');
  if (manifestSection) {
    const classBlockRegex = new RegExp(
      `(  ${classId}: \\{[\\s\\S]*?character: \\{[\\s\\S]*?)(\\n    \\},)`,
      'm'
    );
    const skinModelFile = `skins/${skinKey}.glb`;
    const skinModelLine = `\n      ${skinId}: '${skinModelFile}',`;
    const manifestText = manifestSection.text;

    if (manifestText.includes(`${skinId}: '${skinModelFile}'`)) {
      console.log(`    ASSET_MANIFEST character entry already exists for ${skinId}`);
    } else {
      const classMatch = manifestText.match(classBlockRegex);
      if (classMatch) {
        const newManifest = manifestText.replace(classBlockRegex, `$1${skinModelLine}$2`);
        source = source.slice(0, manifestSection.start) + newManifest + source.slice(manifestSection.end);
        console.log(`    Added ${skinId} to ASSET_MANIFEST.${classId}.character`);
      } else {
        console.warn(`    Could not find character block for ${classId} in ASSET_MANIFEST`);
      }
    }
  }

  // 2. Add/update SKIN_CATALOG entry (scoped to SKIN_CATALOG section only)
  const catalogEntry = `  ${skinCatalogKey}: {
    classId: '${classId}', skinId: '${skinId}',
    name: '${skinName.replace(/'/g, "\\'")}', rarity: '${rarity}', price: ${price},
    description: '${description.replace(/'/g, "\\'")}',
    portraitArt: '/assets/art/skins/${skinKey}_portrait.webp',
    splashArt: '/assets/art/skins/${skinKey}_splash_wide.webp',
    bannerArt: '/assets/art/skins/${skinKey}_banner.webp',
    loadingArt: '/assets/art/skins/${skinKey}_loading.webp',
    iconArt: '/assets/art/skins/${skinKey}_icon.webp',
  },`;

  const catalogSection = findSection(source, 'export const SKIN_CATALOG = {');
  if (catalogSection) {
    const entryRegex = new RegExp(`  ${skinCatalogKey}: \\{[\\s\\S]*?\\n  \\},`, 'm');
    if (entryRegex.test(catalogSection.text)) {
      // Replace within the catalog section only
      const newCatalog = catalogSection.text.replace(entryRegex, catalogEntry);
      source = source.slice(0, catalogSection.start) + newCatalog + source.slice(catalogSection.end);
      console.log(`    Updated SKIN_CATALOG entry for ${skinCatalogKey}`);
    } else {
      // Insert as last entry (before the closing })
      const closingBrace = catalogSection.end - 1;
      source = source.slice(0, closingBrace) + catalogEntry + '\n' + source.slice(closingBrace);
      console.log(`    Added SKIN_CATALOG entry for ${skinCatalogKey}`);
    }
  } else {
    console.warn(`    SKIN_CATALOG not found in AssetManifest.js — cannot register`);
  }

  // 3. Ensure weaponsBakedIn: false in SKIN_ANIMATIONS (scoped to SKIN_ANIMATIONS section)
  const animSection = findSection(source, 'export const SKIN_ANIMATIONS = {');
  if (animSection) {
    const skinAnimKey = skinKey;
    const entryRegex = new RegExp(`  ${skinAnimKey}: \\{`, 'm');
    if (entryRegex.test(animSection.text)) {
      // Entry exists — check if weaponsBakedIn is present
      const fullEntryRegex = new RegExp(`  ${skinAnimKey}: \\{[\\s\\S]*?\\n  \\},`, 'm');
      const entryMatch = animSection.text.match(fullEntryRegex);
      if (entryMatch && entryMatch[0].includes('weaponsBakedIn')) {
        console.log(`    SKIN_ANIMATIONS.${skinAnimKey} already has weaponsBakedIn`);
      } else {
        // Insert weaponsBakedIn: false after the opening {
        const entryStart = animSection.text.indexOf(`  ${skinAnimKey}: {`);
        const braceAfter = animSection.text.indexOf('{', entryStart) + 1;
        const globalPos = animSection.start + braceAfter;
        source = source.slice(0, globalPos) + `\n    weaponsBakedIn: false,` + source.slice(globalPos);
        console.log(`    Added weaponsBakedIn: false to SKIN_ANIMATIONS.${skinAnimKey}`);
      }
    } else {
      // No entry yet — create minimal one with weaponsBakedIn at end of section
      const minimalEntry = `  ${skinAnimKey}: {\n    weaponsBakedIn: false,\n  },`;
      const closingBrace = animSection.end - 1;
      source = source.slice(0, closingBrace) + minimalEntry + '\n' + source.slice(closingBrace);
      console.log(`    Added SKIN_ANIMATIONS.${skinAnimKey} with weaponsBakedIn: false`);
    }
  }

  writeFileSync(MANIFEST_PATH, source, 'utf-8');
  console.log('    AssetManifest.js updated!');

  // 4. Add skin price to server SHOP_PRICES (server-authoritative validation)
  const serverPath = resolve(ROOT, 'server/index.js');
  if (existsSync(serverPath)) {
    let serverSource = readFileSync(serverPath, 'utf-8');
    const skinItemId = `skin_${skinKey}`;
    if (serverSource.includes(`${skinItemId}:`)) {
      console.log(`    Server SHOP_PRICES already has ${skinItemId}`);
    } else {
      // Insert before the closing }; of SHOP_PRICES
      const skinsSectionMatch = serverSource.match(/(\/\/ Skins\n(?:  skin_\w+: \d+,\n)*)(};)/m);
      if (skinsSectionMatch) {
        const insertLine = `  ${skinItemId}: ${price},\n`;
        serverSource = serverSource.replace(skinsSectionMatch[0], skinsSectionMatch[1] + insertLine + skinsSectionMatch[2]);
        writeFileSync(serverPath, serverSource, 'utf-8');
        console.log(`    Added ${skinItemId}: ${price} to server SHOP_PRICES`);
      } else {
        console.warn(`    Could not find SHOP_PRICES skins section in server/index.js`);
      }
    }
  }

  console.log('');
}

// ── Summary ──
console.log('╔══════════════════════════════════════════╗');
console.log(`║  SKIN PUBLISHED: ${skinName.padEnd(22)} ║`);
console.log(`║  Class: ${classInfo.name.padEnd(31)} ║`);
console.log(`║  Rarity: ${rarity.padEnd(30)} ║`);
console.log(`║  Price: ${String(price).padEnd(31)} ║`);
console.log(`║  Art: ${generated}/${assets.length} assets                       ║`);
console.log('╚══════════════════════════════════════════╝');

// ── Update marketing pages (class page skins section, news article, feed.json) ──
console.log('\n  Updating marketing pages...');
try {
  const pageArgs = [
    '--class', classId,
    '--skin', skinId,
    '--name', skinName,
    '--rarity', rarity,
    '--price', String(price),
    '--description', description,
  ];
  execSync(`node ${resolve(ROOT, 'scripts/generate-skin-pages.mjs')} ${pageArgs.map(a => JSON.stringify(a)).join(' ')}`, {
    cwd: ROOT,
    stdio: 'inherit',
    timeout: 30000,
  });
} catch (err) {
  console.error('  WARNING: Marketing page update failed:', err.message);
  // Non-fatal — publish is still successful even if pages fail
}
