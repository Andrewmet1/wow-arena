#!/usr/bin/env node
// Generate unique background art for pages that currently reuse other images
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const envText = readFileSync(resolve(ROOT, '.env'), 'utf-8');
const apiKey = envText.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
if (!apiKey) { console.error('No OPENAI_API_KEY in .env'); process.exit(1); }

const OUTPUT_DIR = resolve(ROOT, 'public/assets/art');
const ART_DIR = resolve(ROOT, 'public/assets/art');
const skipExisting = process.argv.includes('--skip-existing');

// Load character portraits for reference
function loadPortrait(name) {
  const path = resolve(ART_DIR, `${name}_portrait.webp`);
  if (!existsSync(path)) return null;
  return readFileSync(path);
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
    name: 'news_hub_bg',
    prompt: 'A dark fantasy news bulletin board in an ancient stone hall, multiple ornate parchment scrolls pinned to a massive wooden board with iron nails, magical ink glowing on the scrolls, candlelight illuminating the scene from iron sconces, cobwebs in corners, dark atmospheric moody lighting, highly detailed digital painting, cinematic composition, no text no letters no words no writing',
    portraits: [portraits.tyrant, portraits.wraith],
  },
  {
    name: 'community_bg',
    prompt: 'A dark fantasy tavern gathering hall, a massive round stone table where five dark fantasy champions sit in heated discussion, tankards and maps on the table, warm fireplace glow mixing with teal magical wisps, banners of different factions hanging from stone pillars, epic cinematic atmosphere, highly detailed digital painting, no text no letters no words no writing',
    portraits: [portraits.tyrant, portraits.wraith, portraits.infernal, portraits.harbinger, portraits.revenant],
  },
];

console.log(`Generating ${images.length} page background images via gpt-image-1...`);

for (const img of images) {
  const outPath = resolve(OUTPUT_DIR, `${img.name}.webp`);
  if (skipExisting && existsSync(outPath)) {
    console.log(`Skipping ${img.name} (already exists)`);
    continue;
  }
  console.log(`\n=== Generating ${img.name} ===`);
  try {
    const form = new FormData();
    form.append('model', 'gpt-image-1');
    form.append('prompt', img.prompt);
    form.append('n', '1');
    form.append('size', '1536x1024');
    form.append('quality', 'high');

    for (let i = 0; i < img.portraits.length; i++) {
      const buf = img.portraits[i];
      if (!buf) continue;
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
    const imgData = data.data[0];
    let buf;
    if (imgData.b64_json) {
      buf = Buffer.from(imgData.b64_json, 'base64');
    } else if (imgData.url) {
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
  await new Promise(r => setTimeout(r, 15000));
}
console.log('\n=== Done ===');
