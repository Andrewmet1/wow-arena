#!/usr/bin/env node
// Generate League-of-Legends quality portrait frames via gpt-image-1
// Overwrites existing frames with higher quality versions
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const envText = readFileSync(resolve(ROOT, '.env'), 'utf-8');
const apiKey = envText.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
if (!apiKey) { console.error('No OPENAI_API_KEY in .env'); process.exit(1); }

const OUTPUT_DIR = resolve(ROOT, 'public/assets/art/frames');
mkdirSync(OUTPUT_DIR, { recursive: true });
const skipExisting = process.argv.includes('--skip-existing');

// Style: League of Legends champion border quality — thick ornate metalwork, jewels, glowing accents
const STYLE = 'square portrait frame border with transparent empty center window for a character portrait, thick ornate decorative border like League of Legends champion loading screen borders, hyper-detailed 3D rendered metalwork with depth and dimension, polished reflective surfaces, inlaid gemstones and jewels, glowing magical energy accents along edges, triple-A video game UI quality, transparent background, sharp clean edges, no face no character no portrait inside the frame, no text no letters no numbers no words';

const frames = [
  // === 5 Rank Frames (auto-assigned by ELO tier) ===
  {
    name: 'rank_frame_broken',
    prompt: `A damaged corroded iron portrait frame border, thick dark gray oxidized iron with deep cracks and missing chunks, bent and warped metal with exposed rivets and rust stains, dim red embers glowing through the cracks like dying forge fire, heavy industrial beaten metal look, ${STYLE}`
  },
  {
    name: 'rank_frame_proven',
    prompt: `A polished steel and silver portrait frame border, clean bright silver metal with precise geometric engravings, small sapphire gems at the four corners, subtle blue energy glowing along the inner edge groove, hammered silver filigree patterns, professional and refined military honor frame, ${STYLE}`
  },
  {
    name: 'rank_frame_exalted',
    prompt: `A magnificent golden portrait frame border with ornate baroque scrollwork, rich 24-karat gold metal with deeply carved floral relief patterns, four large ruby gemstones at the corners with smaller diamonds between them, warm golden divine light emanating from the frame, gold leaf details and crown motif at the top center, ${STYLE}`
  },
  {
    name: 'rank_frame_dread',
    prompt: `An otherworldly crystalline portrait frame border made of jagged teal-green crystal formations, large luminous crystal shards jutting outward from each corner and edge, intense teal energy pulsing through crystal veins, reality-warping glow around the frame, floating crystalline fragments orbiting the border, alien and powerful, ${STYLE}`
  },
  {
    name: 'rank_frame_ascended',
    prompt: `The ultimate celestial portrait frame border radiating pure divine power, white diamond and platinum metal with intricate angelic wing motifs at top and bottom, brilliant white-blue light beams shooting outward from every edge, floating ice crystal shards and prismatic light refractions, aurora borealis energy flowing through the metal, the most prestigious and awe-inspiring frame imaginable, ${STYLE}`
  },

  // === 10 Shop Frames (purchasable cosmetics, increasing price/quality) ===
  {
    name: 'frame_iron',
    prompt: `A solid dark iron portrait frame border with clean angular design, matte black wrought iron with subtle forge hammer marks, small iron studs along the edges, faint orange glow from embedded forge coals at the corners, sturdy and utilitarian warrior aesthetic, ${STYLE}`
  },
  {
    name: 'frame_crimson',
    prompt: `A crimson blood-themed portrait frame border with sharp thorn-like spikes along all edges, deep blood red metal with darker maroon undertones, thorny rose vine motifs carved into the metal, bright red gemstones dripping with crimson energy, aggressive and dangerous, ${STYLE}`
  },
  {
    name: 'frame_frost',
    prompt: `An ice palace portrait frame border with thick frozen ice crystal formations, pale blue and white translucent ice with internal frost patterns, icicle formations hanging from the top and jutting from corners, cold mist emanating outward, snowflake engravings with a brilliant blue sapphire at each corner, ${STYLE}`
  },
  {
    name: 'frame_arcane',
    prompt: `A mystical arcane portrait frame border with floating runic symbols orbiting the frame, deep purple metal with inlaid glowing violet runes, amethyst gemstones pulsing with arcane energy, magical particle effects around the border, ancient magical tome binding aesthetic with brass and purple metal, ${STYLE}`
  },
  {
    name: 'frame_emerald',
    prompt: `A living nature portrait frame border with thick enchanted vines and leaves growing over dark ancient wood, large emerald gemstones set in wooden knots, bioluminescent green moss and tiny glowing flowers, golden acorn and leaf filigree accents, magical druidic woodland frame, ${STYLE}`
  },
  {
    name: 'frame_shadow',
    prompt: `A dark void portrait frame border with thick black obsidian metal and swirling shadow energy tendrils reaching outward, deep purple void energy seeping from gaps in the dark metal, dark amethyst gemstones with an inner void glow, reality-distorting edges where shadow meets light, sinister and foreboding, ${STYLE}`
  },
  {
    name: 'frame_inferno',
    prompt: `A molten lava portrait frame border with thick volcanic rock and flowing magma channels, bright orange-red molten metal pouring through carved channels in dark basalt, roaring flames erupting from the corners, fire ruby gemstones embedded in the volcanic rock, intense heat distortion and ember particles, ${STYLE}`
  },
  {
    name: 'frame_celestial',
    prompt: `A divine celestial portrait frame border with thick golden-white metal and radiating light beams, large diamond gemstones at each corner casting prismatic rainbows, angelic feather wing motifs at the top, holy golden halos and divine energy circles, warm radiant glow that illuminates everything around it, ${STYLE}`
  },
  {
    name: 'frame_void',
    prompt: `A cosmic void portrait frame border with dark purple-black metal containing trapped galaxies and nebulae swirling within, cosmic purple gemstones with visible star clusters inside, reality-tearing edges with dimensional rift effects, dark matter energy tendrils, the frame appears to contain a window into deep space, ${STYLE}`
  },
  {
    name: 'frame_ebon',
    prompt: `The most prestigious dark fantasy portrait frame border ever created, thick obsidian and dark gold metal with skull crown motif at the top, enormous blood-red gemstones at each corner surrounded by smaller diamonds, intricate relief carvings depicting epic battles, golden energy veins pulsing through dark metal like a heartbeat, combination of death and royalty themes, the ultimate collector's frame worthy of a dark god, ${STYLE}`
  },
];

console.log(`Generating ${frames.length} League-quality portrait frames via gpt-image-1...`);
console.log(`Output: ${OUTPUT_DIR}\n`);

let generated = 0;
let skipped = 0;

for (const frame of frames) {
  const outPath = resolve(OUTPUT_DIR, `${frame.name}.png`);
  if (skipExisting && existsSync(outPath)) {
    console.log(`  SKIP ${frame.name} (exists)`);
    skipped++;
    continue;
  }

  console.log(`  GEN  ${frame.name}...`);
  try {
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt: frame.prompt,
        n: 1,
        size: '1024x1024',
        quality: 'high',
        background: 'transparent',
        output_format: 'png'
      })
    });

    const data = await resp.json();
    if (!data.data?.[0]) {
      console.error(`  FAIL ${frame.name}:`, JSON.stringify(data).slice(0, 300));
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
      console.error(`  FAIL ${frame.name}: No image data`);
      continue;
    }

    writeFileSync(outPath, buf);
    generated++;
    console.log(`  DONE ${frame.name} (${(buf.length / 1024).toFixed(0)} KB)`);
  } catch (err) {
    console.error(`  ERR  ${frame.name}: ${err.message}`);
  }

  // Rate limit: 8s between requests (high quality takes longer)
  await new Promise(r => setTimeout(r, 8000));
}

console.log(`\nComplete: ${generated} generated, ${skipped} skipped, ${frames.length - generated - skipped} failed`);
