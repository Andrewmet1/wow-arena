#!/usr/bin/env node
// Generate dark fantasy mastery tier emblem art via DALL-E 3 for Ebon Crucible
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
    name: 'mastery_uninitiated',
    prompt: 'Dark fantasy game mastery emblem, a cracked rough stone tablet with a faint single rune scratched into it, weathered iron ring border with rust and age, unworthy and humble, centered symmetric heraldic composition, no text no letters no words no writing, solid black background, highly detailed digital painting, clean crisp edges, game UI badge, grey desaturated dark moody lighting'
  },
  {
    name: 'mastery_blooded',
    prompt: 'Dark fantasy game mastery emblem, a silver gauntlet clenched into a fist with drops of crimson blood running down the knuckles, ornate silver border with thorn and chain accents, battle-hardened warrior aesthetic, centered symmetric heraldic composition, no text no letters no words no writing, solid black background, highly detailed digital painting, clean crisp edges, game UI badge, cool silver metallic lighting with red highlights'
  },
  {
    name: 'mastery_forged',
    prompt: 'Dark fantasy game mastery emblem, a golden anvil with a glowing hot sword being forged on it, sparks and molten metal drops flying upward, ornate gold filigree border with hammer and flame motifs, master craftsman aesthetic, centered symmetric heraldic composition, no text no letters no words no writing, solid black background, highly detailed digital painting, clean crisp edges, game UI badge, warm golden forge lighting'
  },
  {
    name: 'mastery_ascendant',
    prompt: 'Dark fantasy game mastery emblem, an ethereal figure rising upward with arms spread surrounded by swirling teal spectral energy and ascending light ribbons, ornate platinum and teal border with celestial wing motifs, transcendent and powerful, centered symmetric heraldic composition, no text no letters no words no writing, solid black background, highly detailed digital painting, clean crisp edges, game UI badge, supernatural teal and white lighting'
  },
  {
    name: 'mastery_sovereign',
    prompt: 'Dark fantasy game mastery emblem, a magnificent obsidian and gold crown floating above a dark magical aura, radiating golden divine light rays, ornate crucible gold border with royal crest and dark gemstones, ultimate mastery and supreme authority, centered symmetric heraldic composition, no text no letters no words no writing, solid black background, highly detailed digital painting, clean crisp edges, game UI badge, dramatic warm gold and deep shadow lighting'
  }
];

console.log(`Generating ${emblems.length} mastery tier emblems via DALL-E 3 (HD quality)...`);

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
