#!/usr/bin/env node
// Generate Season 1 Battle Pass exclusive cosmetics via gpt-image-1
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const envText = readFileSync(resolve(ROOT, '.env'), 'utf-8');
const apiKey = envText.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
if (!apiKey) { console.error('No OPENAI_API_KEY in .env'); process.exit(1); }

const FRAMES_DIR = resolve(ROOT, 'public/assets/art/frames');
const skipExisting = process.argv.includes('--skip-existing');

const FRAME_STYLE = 'square portrait frame border with a large transparent empty center window cutout, ornate dark fantasy style, game UI element, the border is thick and decorative extending inward, transparent background, highly detailed digital painting, no face no character no portrait inside, no text no letters no words';

const assets = [
  // Battle Pass Season 1 Frames (9 total)
  { name: 'bp_s1_frame_iron', dir: FRAMES_DIR, prompt: `A dark crucible-forged iron portrait frame border with molten cracks and orange ember glow seeping through the metal, hammered dark steel with glowing forge lines, ${FRAME_STYLE}` },
  { name: 'bp_s1_frame_bloodforge', dir: FRAMES_DIR, prompt: `A crimson blood-forged portrait frame border with pulsing red veins of energy running through obsidian metal, blood-red crystalline formations at corners, dark and violent, ${FRAME_STYLE}` },
  { name: 'bp_s1_frame_thorns', dir: FRAMES_DIR, prompt: `A soul thorn portrait frame border with twisted thorny branches made of dark metal and ghostly blue soul energy, spectral thorns with wisps of spirit fire, ${FRAME_STYLE}` },
  { name: 'bp_s1_frame_doomweaver', dir: FRAMES_DIR, prompt: `A doom-woven portrait frame border with interlocking dark chains and purple-black doom energy weaving between them, ominous runes carved into chain links, dark arcane power, ${FRAME_STYLE}` },
  { name: 'bp_s1_frame_obsidian', dir: FRAMES_DIR, prompt: `An obsidian crown portrait frame border with polished black obsidian and gold crown motifs, regal dark stone with embedded gold veins, a small crown centerpiece at top, ${FRAME_STYLE}` },
  { name: 'bp_s1_frame_abyssal', dir: FRAMES_DIR, prompt: `An abyssal gate portrait frame border shaped like a dark portal entrance, swirling void energy around a stone archway border, deep space stars visible in the darkness, cosmic horror, ${FRAME_STYLE}` },
  { name: 'bp_s1_frame_soulflame', dir: FRAMES_DIR, prompt: `A soulflame portrait frame border with ethereal blue-white soul fire burning along all edges, ghostly flames rising upward, spectral energy wisps, haunting and beautiful, ${FRAME_STYLE}` },
  { name: 'bp_s1_frame_diadem', dir: FRAMES_DIR, prompt: `An ebon diadem portrait frame border combining dark metal with brilliant gemstones, an ornate crown-diadem formation at top with rubies and sapphires, royal dark fantasy, ${FRAME_STYLE}` },
  { name: 'bp_s1_frame_eternal', dir: FRAMES_DIR, prompt: `A crucible eternal portrait frame border with ancient dark metal fused with golden divine light, eternal flame motifs, celestial symbols and dark runes coexisting, timeless and legendary, ${FRAME_STYLE}` },
  { name: 'bp_s1_frame_crown', dir: FRAMES_DIR, prompt: `The most ornate portrait frame ever forged in the Ebon Crucible — obsidian and molten gold fusion with a magnificent skull crown at top, ethereal dark energy and golden divine light merging at every edge, floating dark particles and golden sparks, the ultimate legendary frame, ${FRAME_STYLE}` },
];

console.log(`Generating ${assets.length} Season 1 Battle Pass assets via gpt-image-1...`);

for (const asset of assets) {
  if (!existsSync(asset.dir)) mkdirSync(asset.dir, { recursive: true });
  const outPath = resolve(asset.dir, `${asset.name}.png`);
  if (skipExisting && existsSync(outPath)) {
    console.log(`Skipping ${asset.name} (already exists)`);
    continue;
  }
  console.log(`\n=== Generating ${asset.name} ===`);
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
        output_format: 'png',
      }),
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
  await new Promise(r => setTimeout(r, 5000));
}
console.log('\n=== Done ===');
