#!/usr/bin/env node
// Generate VFX particle sprite textures via gpt-image-1
// Transparent PNGs used as SpriteMaterial.map for all in-game particle effects
// These MUST be abstract energy/glow textures — NOT painted illustrations
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const envText = readFileSync(resolve(ROOT, '.env'), 'utf-8');
const apiKey = envText.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
if (!apiKey) { console.error('No OPENAI_API_KEY in .env'); process.exit(1); }

const OUTPUT_DIR = resolve(ROOT, 'public/assets/textures/particles');
mkdirSync(OUTPUT_DIR, { recursive: true });
const skipExisting = process.argv.includes('--skip-existing');

// CRITICAL: These are VFX SPRITE SHEETS for a game engine with ADDITIVE BLENDING.
// They must be: abstract energy, radial soft gradients, NO illustrations, NO objects, NO realistic things.
// Think Diablo/Path of Exile/WoW spell particle textures — pure light and energy.
const STYLE = 'abstract energy VFX particle texture for a video game engine, pure soft light and energy, radial gradient fading to fully transparent edges, centered on transparent background, used with additive blending, NOT an illustration NOT a painting NOT a real object, just pure glowing energy light, no text no letters, 1024x1024 sprite texture';

const sprites = [
  // === Core energy orbs ===
  {
    name: 'particle_soft_glow',
    prompt: `Pure white-gold soft circular energy glow, perfectly round radial gradient, bright white center smoothly fading outward through warm gold to fully transparent edges, like a point light source viewed head-on, ${STYLE}`
  },
  {
    name: 'particle_fire',
    prompt: `Abstract orange-red fire energy burst, bright yellow-white hot core radiating outward through orange and deep red to transparent, wispy energy tendrils at edges like plasma, no realistic flames just pure fire energy glow, ${STYLE}`
  },
  {
    name: 'particle_ember',
    prompt: `Tiny compact bright orange-yellow energy dot, intense concentrated glow with small warm halo, like a single burning spark or hot ember viewed from distance, very small bright core with quick falloff to transparent, ${STYLE}`
  },
  {
    name: 'particle_smoke',
    prompt: `Soft cloudy gray-white volumetric puff, translucent billowing cloud shape with very soft feathered transparent edges, ethereal misty fog particle, subtle internal density variation, fading to transparent at all edges, ${STYLE}`
  },
  {
    name: 'particle_spark',
    prompt: `Bright white 4-pointed star lens flare, brilliant white center with four sharp light rays extending outward in a cross/plus pattern, golden-white glowing beams, like a camera lens flare or magic twinkle, ${STYLE}`
  },
  {
    name: 'particle_shadow',
    prompt: `Dark purple-black void energy orb, deep violet-black core with dark purple smoky tendrils radiating outward, inverse glow that absorbs light, ethereal dark magic energy, like a dark matter particle, swirling darkness fading to transparent, ${STYLE}`
  },
  {
    name: 'particle_holy',
    prompt: `Warm golden-white divine light orb, bright pure white center radiating through warm gold to transparent, sacred radiant energy with subtle golden rays, like concentrated sunlight or holy magic, ${STYLE}`
  },
  {
    name: 'particle_frost',
    prompt: `Cool pale blue-white ice energy crystal, bright white center with icy blue glow radiating outward, crystalline sharp edges mixed with soft cold mist, frozen energy particle with hexagonal hints, cold blue light fading to transparent, ${STYLE}`
  },
  {
    name: 'particle_blood',
    prompt: `Dark crimson red energy splatter, deep blood-red core with darker red tendrils radiating irregularly outward, visceral dark red energy burst, chaotic asymmetric spread pattern, fading to transparent at edges, ${STYLE}`
  },
  {
    name: 'particle_lightning',
    prompt: `Bright white-cyan electric discharge, brilliant white core with jagged electric blue-cyan energy arcs branching outward in multiple directions, intense electrical spark, like a ball lightning or tesla coil discharge, ${STYLE}`
  },
  {
    name: 'particle_heal',
    prompt: `Bright emerald green healing energy orb, vivid green core with warm golden-green highlights radiating outward, nature restoration magic, soft leafy organic energy pattern, warm green glow fading to transparent, ${STYLE}`
  },
  {
    name: 'particle_arcane',
    prompt: `Deep violet-magenta arcane energy orb, bright magenta-pink core radiating through deep purple, mystical swirling energy with subtle runic sparkle hints, concentrated magical power, purple energy fading to transparent, ${STYLE}`
  },

  // === Specialized effect sprites ===
  {
    name: 'particle_ring',
    prompt: `Thin circular energy ring shape, viewed straight on, a single glowing ring outline with NO fill in the center, bright white-gold energy flowing along the circle line, soft glow emanating from the ring line only, empty transparent center and transparent outside, ${STYLE}`
  },
  {
    name: 'particle_trail',
    prompt: `Horizontal elongated energy streak, stretched motion blur trail with bright white center tapering to warm orange-gold at both ends, like a comet tail or speed line, elongated horizontally across the center, ${STYLE}`
  },
  {
    name: 'particle_impact_burst',
    prompt: `Radial starburst explosion, bright white-yellow center with energy rays shooting outward symmetrically in all directions, dramatic flash impact like a supernova or magic explosion, radiating light beams, ${STYLE}`
  },
  {
    name: 'particle_swirl',
    prompt: `Spiral energy vortex viewed from above, swirling blue-purple magical energy forming a tight logarithmic spiral pattern from center outward, arcane whirlpool of light energy, ${STYLE}`
  },
  {
    name: 'particle_shield',
    prompt: `Translucent blue-cyan hexagonal energy shield panel, flat geometric hex shape with bright glowing edges and semi-transparent fill, sci-fi force field barrier fragment, energy barrier piece, ${STYLE}`
  },
  {
    name: 'particle_slash',
    prompt: `Curved bright energy crescent arc, white-silver glowing curved slash line sweeping in a crescent moon shape, clean sharp energy trail like a sword swing, bright leading edge fading behind, ${STYLE}`
  },
];

console.log(`Generating ${sprites.length} VFX particle sprites via gpt-image-1...`);
console.log(`Output: ${OUTPUT_DIR}\n`);

let generated = 0;
let skipped = 0;

for (const sprite of sprites) {
  const outPath = resolve(OUTPUT_DIR, `${sprite.name}.png`);
  if (skipExisting && existsSync(outPath)) {
    console.log(`  SKIP ${sprite.name} (exists)`);
    skipped++;
    continue;
  }

  console.log(`  GEN  ${sprite.name}...`);
  try {
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt: sprite.prompt,
        n: 1,
        size: '1024x1024',
        quality: 'high',
        background: 'transparent',
        output_format: 'png'
      })
    });

    const data = await resp.json();
    if (!data.data?.[0]) {
      console.error(`  FAIL ${sprite.name}:`, JSON.stringify(data).slice(0, 300));
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
      console.error(`  FAIL ${sprite.name}: No image data`);
      continue;
    }

    writeFileSync(outPath, buf);
    generated++;
    console.log(`  DONE ${sprite.name} (${(buf.length / 1024).toFixed(0)} KB)`);
  } catch (err) {
    console.error(`  ERR  ${sprite.name}: ${err.message}`);
  }

  // Rate limit: 8s between requests (high quality)
  await new Promise(r => setTimeout(r, 8000));
}

console.log(`\nComplete: ${generated} generated, ${skipped} skipped, ${sprites.length - generated - skipped} failed`);
