#!/usr/bin/env node
// Generate dark fantasy champion betting art via DALL-E 3 for Ebon Crucible
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const envText = readFileSync(resolve(ROOT, '.env'), 'utf-8');
const apiKey = envText.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
if (!apiKey) { console.error('No OPENAI_API_KEY in .env'); process.exit(1); }

const OUTPUT_DIR = resolve(ROOT, 'public/assets/art');
const skipExisting = process.argv.includes('--skip-existing');

const images = [
  {
    name: 'betting_hero',
    size: '1792x1024',
    prompt: 'Dark fantasy gambling hall interior, a massive ornate golden scale of justice floating above a stone betting table with glowing rune-inscribed coins and spectral champion portraits, dark moody atmosphere with warm golden candlelight and teal magical wisps, ancient bookmaker\'s den aesthetic with skulls and trophies on shelves, dramatic cinematic lighting, epic game art, no text no letters no words no writing'
  },
  {
    name: 'betting_champion_overlay',
    size: '1024x1024',
    prompt: 'Dark fantasy champion throne emblem, an ornate golden crown resting on a dark obsidian throne with spectral energy radiating outward, crossed swords behind the throne, dark moody atmosphere with warm gold and deep shadow lighting, centered symmetric heraldic composition, no text no letters no words no writing, solid black background, highly detailed digital painting, clean crisp edges, game UI badge'
  },
  {
    name: 'betting_holds',
    size: '1024x1024',
    prompt: 'Dark fantasy game emblem, a raised golden shield with a crown symbol radiating protective green energy and golden light, ornate gold filigree border, champion defending their throne aesthetic, centered symmetric heraldic composition, no text no letters no words no writing, solid black background, highly detailed digital painting, clean crisp edges, game UI badge, warm gold and green lighting'
  },
  {
    name: 'betting_falls',
    size: '1024x1024',
    prompt: 'Dark fantasy game emblem, a shattered dark crown falling into crimson flames and smoke, broken sword fragments, ornate crimson and dark iron border with chain motifs, dethroned champion aesthetic, centered symmetric heraldic composition, no text no letters no words no writing, solid black background, highly detailed digital painting, clean crisp edges, game UI badge, dramatic red and shadow lighting'
  }
];

console.log(`Generating ${images.length} betting art assets via DALL-E 3 (HD quality)...`);

for (const img of images) {
  const outPath = resolve(OUTPUT_DIR, `${img.name}.webp`);
  if (skipExisting && existsSync(outPath)) {
    console.log(`Skipping ${img.name} (already exists)`);
    continue;
  }
  console.log(`\n=== Generating ${img.name} ===`);
  try {
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'dall-e-3', prompt: img.prompt, n: 1, size: img.size, quality: 'hd' })
    });
    const data = await resp.json();
    if (!data.data?.[0]?.url) {
      console.error(`Failed for ${img.name}:`, JSON.stringify(data).slice(0, 300));
      continue;
    }
    const url = data.data[0].url;
    console.log(`Got URL, downloading ${img.name}...`);
    const imgResp = await fetch(url);
    const buf = Buffer.from(await imgResp.arrayBuffer());
    writeFileSync(outPath, buf);
    console.log(`Saved ${img.name} (${(buf.length / 1024).toFixed(0)} KB) -> ${outPath}`);
  } catch (err) {
    console.error(`Error generating ${img.name}:`, err.message);
  }
  // Rate limit delay
  await new Promise(r => setTimeout(r, 15000));
}
console.log('\n=== Done ===');
