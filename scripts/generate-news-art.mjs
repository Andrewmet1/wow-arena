#!/usr/bin/env node
// Generate unique dark fantasy hero images for news articles via gpt-image-1
// Passes actual character portrait images as references for visual consistency
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const envText = readFileSync(resolve(ROOT, '.env'), 'utf-8');
const apiKey = envText.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
if (!apiKey) { console.error('No OPENAI_API_KEY in .env'); process.exit(1); }

const OUTPUT_DIR = resolve(ROOT, 'public/assets/art');
const ART_DIR = resolve(ROOT, 'public/assets/art');
const skipExisting = process.argv.includes('--skip-existing');

// Load character portrait files as base64 for image references
function loadPortrait(name) {
  const path = resolve(ART_DIR, `${name}_portrait.webp`);
  if (!existsSync(path)) { console.warn(`Portrait not found: ${path}`); return null; }
  return readFileSync(path).toString('base64');
}

const portraits = {
  tyrant: loadPortrait('tyrant'),
  wraith: loadPortrait('wraith'),
  infernal: loadPortrait('infernal'),
  harbinger: loadPortrait('harbinger'),
  revenant: loadPortrait('revenant'),
};

const images = [
  {
    name: 'news_shop_betting',
    // Use Tyrant + Wraith portraits as references
    refImages: [portraits.tyrant, portraits.wraith],
    prompt: 'Using the two characters shown in the reference images as the exact visual designs, create a vibrant dark fantasy gambling hall scene with strong lighting. The horned armored warrior (first image) and the hooded masked assassin (second image) stand on opposite sides of a massive ornate stone betting table. Piles of brightly glowing enchanted gold coins cover the table, a large ethereal golden weighing scale floats between them radiating warm light. The hall is lit by bright warm golden torches and floating teal magical flames, illuminating the characters and table clearly. Rich warm colors, golden ambient light filling the scene. Epic cinematic wide composition, highly detailed digital painting, League of Legends splash art style, no text no letters no words no writing'
  },
  {
    name: 'news_patch_0_2',
    // Use all 5 portraits as references
    refImages: [portraits.tyrant, portraits.wraith, portraits.infernal, portraits.harbinger, portraits.revenant],
    prompt: 'Using the five characters shown in the reference images as the exact visual designs, create a dark fantasy ability synergy scene. All five champions are arranged in a circle on a runic obsidian arena floor: the horned armored warrior (image 1) radiates crimson rage energy, the hooded masked assassin (image 2) emanates purple shadow wisps, the flaming skull mage (image 3) channels orange arcane fire spirals, the horned undead warlock (image 4) casts green corruption tendrils, and the golden holy knight (image 5) projects golden holy light beams. All five energies intertwine into a massive spiraling vortex above them. Ancient stone pillars frame the scene, dramatic teal and crimson atmospheric haze. Epic cinematic wide shot, highly detailed digital painting, League of Legends splash art style, no text no letters no words no writing'
  }
];

console.log(`Generating ${images.length} news hero images via gpt-image-1 with character portrait references...`);

for (const img of images) {
  const outPath = resolve(OUTPUT_DIR, `${img.name}.webp`);
  if (skipExisting && existsSync(outPath)) {
    console.log(`Skipping ${img.name} (already exists)`);
    continue;
  }
  console.log(`\n=== Generating ${img.name} (${img.refImages.length} reference portraits) ===`);
  try {
    // Build multipart form with portrait images as references
    const form = new FormData();
    form.append('model', 'gpt-image-1');
    form.append('prompt', img.prompt);
    form.append('n', '1');
    form.append('size', '1536x1024');
    form.append('quality', 'high');

    // Attach each portrait as an image reference
    for (let i = 0; i < img.refImages.length; i++) {
      const b64 = img.refImages[i];
      if (!b64) continue;
      const buf = Buffer.from(b64, 'base64');
      const blob = new Blob([buf], { type: 'image/webp' });
      form.append('image[]', blob, `portrait_${i}.webp`);
    }

    const resp = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: form
    });
    const data = await resp.json();
    if (!data.data?.[0]) {
      console.error(`Failed for ${img.name}:`, JSON.stringify(data).slice(0, 500));
      continue;
    }

    // gpt-image-1 returns base64 by default
    const imgData = data.data[0];
    let buf;
    if (imgData.b64_json) {
      buf = Buffer.from(imgData.b64_json, 'base64');
    } else if (imgData.url) {
      console.log(`Got URL, downloading ${img.name}...`);
      const dlResp = await fetch(imgData.url);
      buf = Buffer.from(await dlResp.arrayBuffer());
    } else {
      console.error(`No image data for ${img.name}`);
      continue;
    }

    writeFileSync(outPath, buf);
    console.log(`Saved ${img.name} (${(buf.length / 1024).toFixed(0)} KB) -> ${outPath}`);
  } catch (err) {
    console.error(`Error generating ${img.name}:`, err.message);
  }
  // Rate limit delay between generations
  await new Promise(r => setTimeout(r, 15000));
}
console.log('\n=== Done ===');
