#!/usr/bin/env node
// Generate dark fantasy rank emblem art via DALL-E 3 for Ebon Crucible
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const envText = readFileSync(resolve(ROOT, '.env'), 'utf-8');
const apiKey = envText.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
if (!apiKey) { console.error('No OPENAI_API_KEY in .env'); process.exit(1); }

const OUTPUT_DIR = resolve(ROOT, 'public/assets/art');
const skipExisting = process.argv.includes('--skip-existing');

const emblems = [
  {
    name: 'rank_cinder',
    prompt: 'Dark fantasy game rank emblem, a cracked iron skull with faintly glowing orange cracks and dying embers, worn corroded metal border with rivets, centered symmetric heraldic composition, no text no letters no words no writing, solid black background, highly detailed digital painting, clean crisp edges, game UI rank badge, dark moody lighting'
  },
  {
    name: 'rank_crimson',
    prompt: 'Dark fantasy game rank emblem, a polished silver war helm with a crimson blood-red plume, ornate steel border with thorned accents, centered symmetric heraldic composition, no text no letters no words no writing, solid black background, highly detailed digital painting, clean crisp edges, game UI rank badge, dark moody lighting with metallic reflections'
  },
  {
    name: 'rank_dreadforge',
    prompt: 'Dark fantasy game rank emblem, a golden phoenix rising from molten metal with spread wings, ornate gold filigree border with forge motifs, glowing amber and gold tones, centered symmetric heraldic composition, no text no letters no words no writing, solid black background, highly detailed digital painting, clean crisp edges, game UI rank badge, warm golden lighting'
  },
  {
    name: 'rank_soulfire',
    prompt: 'Dark fantasy game rank emblem, an ethereal teal-green ghostly flame burning inside a spectral chalice, silver and teal ornamental border with wispy spirit tendrils, supernatural glow, centered symmetric heraldic composition, no text no letters no words no writing, solid black background, highly detailed digital painting, clean crisp edges, game UI rank badge, ethereal teal lighting'
  },
  {
    name: 'rank_abyssal',
    prompt: 'Dark fantasy game rank emblem, a radiant diamond crystal crown floating with ice-blue cosmic energy and starlight, platinum border with celestial star accents and ethereal light rays, centered symmetric heraldic composition, no text no letters no words no writing, solid black background, highly detailed digital painting, clean crisp edges, game UI rank badge, brilliant blue-white cosmic lighting'
  }
];

console.log(`Generating ${emblems.length} rank emblems via DALL-E 3 (HD quality)...`);

for (const emblem of emblems) {
  const outPath = resolve(OUTPUT_DIR, `${emblem.name}.webp`);
  if (skipExisting && existsSync(outPath)) {
    console.log(`Skipping ${emblem.name} (already exists)`);
    continue;
  }
  console.log(`\n=== Generating ${emblem.name} ===`);
  try {
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'dall-e-3', prompt: emblem.prompt, n: 1, size: '1024x1024', quality: 'hd' })
    });
    const data = await resp.json();
    if (!data.data?.[0]?.url) {
      console.error(`Failed for ${emblem.name}:`, JSON.stringify(data).slice(0, 300));
      continue;
    }
    const url = data.data[0].url;
    console.log(`Got URL, downloading ${emblem.name}...`);
    const imgResp = await fetch(url);
    const buf = Buffer.from(await imgResp.arrayBuffer());
    writeFileSync(outPath, buf);
    console.log(`Saved ${emblem.name} (${(buf.length / 1024).toFixed(0)} KB) -> ${outPath}`);
  } catch (err) {
    console.error(`Error generating ${emblem.name}:`, err.message);
  }
  // Rate limit delay
  await new Promise(r => setTimeout(r, 15000));
}
console.log('\n=== Done ===');
