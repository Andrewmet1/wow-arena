#!/usr/bin/env node
// Generate animated VFX sprite sheet atlases via gpt-image-1
// Each atlas is a 4x4 grid (16 frames at 256x256) within a 1024x1024 image
// Used by SpriteSheetAnimator for frame-by-frame spell effect animation
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const envText = readFileSync(resolve(ROOT, '.env'), 'utf-8');
const apiKey = envText.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
if (!apiKey) { console.error('No OPENAI_API_KEY in .env'); process.exit(1); }

const OUTPUT_DIR = resolve(ROOT, 'public/assets/textures/spritesheets');
mkdirSync(OUTPUT_DIR, { recursive: true });
const skipExisting = process.argv.includes('--skip-existing');

// CRITICAL: These are SPRITE SHEET ATLASES — 4x4 grids showing 16 sequential animation frames.
// Each frame must be in its own cell, left-to-right top-to-bottom, consistent sizing.
// For additive blending: dark/black backgrounds. For sprites: transparent backgrounds.
const GRID = 'A 4x4 grid sprite sheet containing exactly 16 sequential animation frames arranged in 4 rows of 4, each cell is 256x256 pixels, frames read left to right then top to bottom showing a smooth animation sequence, game VFX sprite sheet atlas';
const STYLE = 'dark fantasy AAA video game spell effect, cinematic quality like Diablo 4 or World of Warcraft, vivid saturated colors, no text no labels no numbers no borders between cells, 1024x1024 total image';

const spritesheets = [
  // === Harbinger (Warlock) ===
  {
    name: 'ss_harbinger_skull',
    prompt: `${GRID}, animation of a glowing spectral skull rotating 360 degrees in place, frame 1 shows skull facing forward with purple energy wisps trailing, each subsequent frame rotates the skull further, ethereal purple-violet glow with dark smoky trails behind the skull, warlock necromancy death magic, on pure black background, ${STYLE}`
  },
  {
    name: 'ss_harbinger_void_swirl',
    prompt: `${GRID}, animation of a dark void energy vortex spiraling and pulsing, starts as a small purple-black point and expands into a swirling maelstrom then contracts back, deep violet-black with bright magenta edges, dark dimensional rift energy, warlock shadow magic, on pure black background, ${STYLE}`
  },
  {
    name: 'ss_harbinger_soul_wisp',
    prompt: `${GRID}, animation of a ghostly soul wisp floating and flickering, ethereal green-purple spectral flame drifting and undulating, starts dim then brightens with a ghostly wail shape then dims again, soul drain life-steal energy, warlock death magic, on pure black background, ${STYLE}`
  },

  // === Revenant (Paladin) ===
  {
    name: 'ss_revenant_cross',
    prompt: `${GRID}, animation of a radiant golden holy cross symbol pulsing with divine light, starts dim then radiates brilliant golden-white beams outward at peak brightness then fades back, warm sacred energy with golden sparkle particles, paladin holy magic, on pure black background, ${STYLE}`
  },
  {
    name: 'ss_revenant_holy_burst',
    prompt: `${GRID}, animation of a divine golden light burst expanding outward, starts as a concentrated golden point then explodes outward in radial holy rays then dissipates, brilliant white-gold sacred energy with warm particles, paladin smite effect, on pure black background, ${STYLE}`
  },
  {
    name: 'ss_revenant_sacred_shield',
    prompt: `${GRID}, animation of a translucent golden hexagonal energy shield shimmering, the shield surface ripples with golden light waves flowing across it, protective divine barrier with rune inscriptions glowing in sequence, paladin protection magic, on pure black background, ${STYLE}`
  },

  // === Tyrant (Warrior) ===
  {
    name: 'ss_tyrant_weapon_trail',
    prompt: `${GRID}, animation of a bright orange-red weapon slash arc sweeping through the air, starts from one side and sweeps in a crescent arc to the other side leaving a hot white-orange energy trail with ember sparks, fierce warrior combat energy, on pure black background, ${STYLE}`
  },
  {
    name: 'ss_tyrant_impact_sparks',
    prompt: `${GRID}, animation of an explosive metal impact spark burst, starts with a bright white flash at center then sparks fly outward in all directions through orange to red then fade away, ground impact with debris and embers, warrior slam effect, on pure black background, ${STYLE}`
  },
  {
    name: 'ss_tyrant_rage_fire',
    prompt: `${GRID}, animation of intense berserker rage fire flaring around a central point, flames surge upward and outward in a fury then pulse back in a breathing cycle, deep red-orange with angry hot white core, warrior battle rage aura, on pure black background, ${STYLE}`
  },

  // === Wraith (Rogue) ===
  {
    name: 'ss_wraith_poison_drip',
    prompt: `${GRID}, animation of toxic green poison drops forming and falling, a droplet forms at top growing larger then falls downward and splashes into toxic puddle with acid bubbles, sickly yellow-green venomous liquid, rogue assassin poison effect, on pure black background, ${STYLE}`
  },
  {
    name: 'ss_wraith_shadow_wisp',
    prompt: `${GRID}, animation of a dark shadow tendril materializing and fading, starts as faint dark wisps then coalesces into a solid dark purple-black smoke form then dissipates into nothing, stealth shadow energy, rogue vanish effect, on pure black background, ${STYLE}`
  },
  {
    name: 'ss_wraith_dagger_gleam',
    prompt: `${GRID}, animation of a sharp silver dagger blade gleam sweeping across, a bright white-silver light reflection travels along an angled blade edge from base to tip with trailing sparkles, quick assassin strike flash, rogue dagger effect, on pure black background, ${STYLE}`
  },

  // === Infernal (Mage) ===
  {
    name: 'ss_infernal_arcane_rune',
    prompt: `${GRID}, animation of a glowing violet arcane rune circle slowly spinning clockwise, mystical purple symbols orbit around the circle edge with inner runes pulsing in sequence, deep magenta-violet magical inscriptions, mage arcane spell circle, on pure black background, ${STYLE}`
  },
  {
    name: 'ss_infernal_fire_spiral',
    prompt: `${GRID}, animation of fire energy spiraling outward from center, starts as a bright orange-yellow point then flames spiral outward in a logarithmic pattern growing larger, intense fire tornado formation, mage fire spell effect, on pure black background, ${STYLE}`
  },
  {
    name: 'ss_infernal_frost_crystal',
    prompt: `${GRID}, animation of ice crystal formation and shattering, starts with a seed crystal then branches grow outward into a beautiful ice crystal then cracks and shatters into sparkling fragments, pale blue-white with cold mist, mage frost spell effect, on pure black background, ${STYLE}`
  },

  // === Shared ===
  {
    name: 'ss_impact_explosion',
    prompt: `${GRID}, animation of a universal magic impact explosion, starts as a bright white flash then expands into a fiery golden-white starburst with radiating energy rays then fades to embers and smoke, dramatic spell impact hit effect, on pure black background, ${STYLE}`
  },
  {
    name: 'ss_healing_swirl',
    prompt: `${GRID}, animation of green-gold healing energy particles rising upward in a gentle spiral, glowing emerald-green motes with warm golden highlights float upward and fade, nature restoration magic, healing spell effect, on pure black background, ${STYLE}`
  },
  {
    name: 'ss_energy_vortex',
    prompt: `${GRID}, animation of a blue-white energy vortex spinning and pulsing, bright cyan-white magical energy forming a tight spiral that rotates and breathes in intensity, concentrated arcane power whirlpool, universal magic effect, on pure black background, ${STYLE}`
  },
];

console.log(`Generating ${spritesheets.length} VFX sprite sheet atlases via gpt-image-1...`);
console.log(`Output: ${OUTPUT_DIR}\n`);

let generated = 0;
let skipped = 0;

for (const ss of spritesheets) {
  const outPath = resolve(OUTPUT_DIR, `${ss.name}.png`);
  if (skipExisting && existsSync(outPath)) {
    console.log(`  SKIP ${ss.name} (exists)`);
    skipped++;
    continue;
  }

  console.log(`  GEN  ${ss.name}...`);
  try {
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt: ss.prompt,
        n: 1,
        size: '1024x1024',
        quality: 'high',
        background: 'auto',
        output_format: 'png'
      })
    });

    const data = await resp.json();
    if (!data.data?.[0]) {
      console.error(`  FAIL ${ss.name}:`, JSON.stringify(data).slice(0, 300));
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
      console.error(`  FAIL ${ss.name}: No image data`);
      continue;
    }

    writeFileSync(outPath, buf);
    generated++;
    console.log(`  DONE ${ss.name} (${(buf.length / 1024).toFixed(0)} KB)`);
  } catch (err) {
    console.error(`  ERR  ${ss.name}: ${err.message}`);
  }

  // Rate limit: 8s between requests (high quality)
  await new Promise(r => setTimeout(r, 8000));
}

console.log(`\nComplete: ${generated} generated, ${skipped} skipped, ${spritesheets.length - generated - skipped} failed`);
