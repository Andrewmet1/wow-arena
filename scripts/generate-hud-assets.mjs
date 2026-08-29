#!/usr/bin/env node
// Generate dark fantasy HUD UI art assets via gpt-image-1
// Each asset is a transparent PNG at 1024x1024 (for quality), intended to be used at the target size
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const envText = readFileSync(resolve(ROOT, '.env'), 'utf-8');
const apiKey = envText.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
if (!apiKey) { console.error('No OPENAI_API_KEY in .env'); process.exit(1); }

const OUTPUT_DIR = resolve(ROOT, 'public/assets/art/hud');
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`Created output directory: ${OUTPUT_DIR}`);
}

const skipExisting = process.argv.includes('--skip-existing');

const assets = [
  {
    name: 'unit_frame_bg',
    prompt: 'A dark fantasy game UI unit frame background panel, horizontal rectangular shape (roughly 4:1 aspect ratio), ornate dark wrought iron edges with subtle rivets and bolts along the border, dark interior with a very slight gradient from dark charcoal gray to near-black, the metal edges have a gothic forged look with small decorative notches, the panel feels like a dark iron plate from a gothic fantasy arena game, transparent area outside the panel edges, no text no letters no words no characters no faces, game UI element, highly detailed digital painting, dark fantasy style'
  },
  {
    name: 'hp_bar_fill',
    prompt: 'A horizontal health bar fill texture for a dark fantasy game UI, wide horizontal bar shape (roughly 8:1 aspect ratio), gradient from dark emerald green on the left edge through rich green in the middle to bright green with a subtle bright white-green highlight shine line running horizontally across the upper third of the bar, dark fantasy metallic sheen and luster on the surface, the bar should look like glowing liquid life energy contained in dark metal, seamless and clean edges, transparent background, no text no letters no words, game UI element, highly detailed digital painting'
  },
  {
    name: 'match_timer_bg',
    prompt: 'An ornate match timer background panel for a dark fantasy arena game UI, horizontal rectangular panel (roughly 4:1 aspect ratio), dark forged metal frame with small decorative pointed gothic flourishes extending from the left and right sides, dark near-black interior, thin gold accent trim running along the inner edges of the frame, the panel feels like a dark iron nameplate with golden inlay from a gothic fantasy game, transparent background outside the panel, no text no letters no numbers no words, game UI element, highly detailed digital painting, dark fantasy style'
  },
  {
    name: 'ability_slot_bg',
    prompt: 'A single square ability slot frame for a dark fantasy arena game UI, square dark wrought iron border with a subtle inner bevel catching dim light, small angular corner accent details at all four corners, the interior center is completely transparent/empty so an ability icon can show through, the border is thick dark metal with subtle forge texture and a slight dark metallic sheen, transparent background outside and inside the frame, no text no letters no words no icons inside, game UI button slot element, highly detailed digital painting, dark fantasy style'
  }
];

console.log(`Generating ${assets.length} HUD assets via gpt-image-1 (transparent PNG, 1024x1024)...\n`);

for (const asset of assets) {
  const outPath = resolve(OUTPUT_DIR, `${asset.name}.png`);
  if (skipExisting && existsSync(outPath)) {
    console.log(`Skipping ${asset.name} (already exists)`);
    continue;
  }
  console.log(`=== Generating ${asset.name} ===`);
  try {
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt: asset.prompt,
        n: 1,
        size: '1024x1024',
        quality: 'medium',
        background: 'transparent',
        output_format: 'png'
      })
    });
    const data = await resp.json();
    if (!data.data?.[0]) {
      console.error(`Failed for ${asset.name}:`, JSON.stringify(data).slice(0, 300));
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
      console.error(`No image data for ${asset.name}`);
      continue;
    }
    writeFileSync(outPath, buf);
    console.log(`Saved ${asset.name}.png (${(buf.length / 1024).toFixed(0)} KB) -> ${outPath}`);
  } catch (err) {
    console.error(`Error generating ${asset.name}:`, err.message);
  }
  // Rate limit pause between requests
  await new Promise(r => setTimeout(r, 5000));
}
console.log('\n=== Done ===');
