#!/usr/bin/env node
// Generate dark fantasy portrait frames via gpt-image-1
// Each frame is a transparent PNG with an ornate border and a transparent center window
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const envText = readFileSync(resolve(ROOT, '.env'), 'utf-8');
const apiKey = envText.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
if (!apiKey) { console.error('No OPENAI_API_KEY in .env'); process.exit(1); }

const OUTPUT_DIR = resolve(ROOT, 'public/assets/art/frames');
const skipExisting = process.argv.includes('--skip-existing');

// Shared style suffix for all frames
const STYLE = 'square portrait frame border with a large transparent empty center window cutout, ornate dark fantasy style, game UI element, the border is thick and decorative extending inward, transparent background, highly detailed digital painting, no face no character no portrait inside, no text no letters no words';

const frames = [
  // === 5 Rank Frames (auto-assigned by ELO tier) ===
  { name: 'rank_frame_broken', prompt: `A worn and cracked iron portrait frame border with rust and corrosion, dull gray metal with broken edges and rivets, dark scratches across the surface, ${STYLE}` },
  { name: 'rank_frame_proven', prompt: `A polished silver portrait frame border with subtle elvish engravings, clean hammered silver with small geometric patterns along the edges, cool metallic sheen, ${STYLE}` },
  { name: 'rank_frame_exalted', prompt: `An ornate golden filigree portrait frame border with crimson gemstones at the four corners, intricate swirling gold leaf patterns, warm radiant glow along edges, ${STYLE}` },
  { name: 'rank_frame_dread', prompt: `A teal crystal portrait frame border with ethereal glowing edges, sharp crystalline formations jutting outward, teal and cyan energy pulsing through translucent crystal structure, mystical otherworldly glow, ${STYLE}` },
  { name: 'rank_frame_ascended', prompt: `An ethereal radiant portrait frame border made of pure light and ice, brilliant white-blue energy tendrils forming the border, floating ice shards and divine light rays emanating outward, celestial and transcendent, ${STYLE}` },

  // === 10 Shop Frames (purchasable cosmetics) ===
  { name: 'frame_iron', prompt: `A simple dark iron portrait frame border with clean straight edges, matte black iron with subtle forge marks, minimalist and sturdy, ${STYLE}` },
  { name: 'frame_crimson', prompt: `A crimson thorn portrait frame border with sharp red thorny vines wrapping around the border, deep blood red metal with rose thorn spikes, dark red glow, ${STYLE}` },
  { name: 'frame_frost', prompt: `An ice crystal portrait frame border with frozen jagged ice formations, pale blue and white frost covering the edges, cold mist emanating from the frame, ${STYLE}` },
  { name: 'frame_arcane', prompt: `A purple arcane portrait frame border with glowing magical runes etched into dark purple metal, floating arcane symbols orbiting the border, violet mystical energy, ${STYLE}` },
  { name: 'frame_emerald', prompt: `An emerald vine portrait frame border with living green vines and leaves growing along dark wood, emerald gemstones embedded in the corners, lush forest green glow, ${STYLE}` },
  { name: 'frame_shadow', prompt: `A dark shadow portrait frame border with swirling black smoke and shadow wisps forming the edges, deep purple-black energy, ethereal darkness seeping outward, ominous and mysterious, ${STYLE}` },
  { name: 'frame_inferno', prompt: `A flame-engulfed portrait frame border with roaring orange and red fire along all edges, molten metal dripping, intense heat distortion, burning ember particles, ${STYLE}` },
  { name: 'frame_celestial', prompt: `A golden divine halo portrait frame border with radiant golden light beams extending outward, angelic wings motif at the top, holy golden energy and warm divine glow, ${STYLE}` },
  { name: 'frame_void', prompt: `A void energy portrait frame border with dark purple and black void tendrils forming the border, cosmic star particles trapped in the void, reality-warping distortion at the edges, ${STYLE}` },
  { name: 'frame_ebon', prompt: `The ultimate dark fantasy portrait frame border combining dark obsidian metal with crucible gold accents, intricate skull and crown motifs, golden energy veins pulsing through dark material, the most ornate and prestigious frame, ${STYLE}` },
];

console.log(`Generating ${frames.length} portrait frames via gpt-image-1 (transparent PNG, 256x256)...`);

for (const frame of frames) {
  const outPath = resolve(OUTPUT_DIR, `${frame.name}.png`);
  if (skipExisting && existsSync(outPath)) {
    console.log(`Skipping ${frame.name} (already exists)`);
    continue;
  }
  console.log(`\n=== Generating ${frame.name} ===`);
  try {
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt: frame.prompt,
        n: 1,
        size: '1024x1024',
        quality: 'medium',
        background: 'transparent',
        output_format: 'png'
      })
    });
    const data = await resp.json();
    if (!data.data?.[0]) {
      console.error(`Failed for ${frame.name}:`, JSON.stringify(data).slice(0, 300));
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
      console.error(`No image data for ${frame.name}`);
      continue;
    }
    writeFileSync(outPath, buf);
    console.log(`Saved ${frame.name}.png (${(buf.length / 1024).toFixed(0)} KB) -> ${outPath}`);
  } catch (err) {
    console.error(`Error generating ${frame.name}:`, err.message);
  }
  await new Promise(r => setTimeout(r, 5000));
}
console.log('\n=== Done ===');
