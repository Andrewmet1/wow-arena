#!/usr/bin/env node
// Regenerate ALL 32 VFX_TEXTURES at AAA quality via gpt-image-1
// These are mapped onto planes, spheres, and meshes for spell effects
// MUST have dark/black backgrounds for additive blending
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';

const ROOT = resolve(import.meta.dirname, '..');
const envText = readFileSync(resolve(ROOT, '.env'), 'utf-8');
const apiKey = envText.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
if (!apiKey) { console.error('No OPENAI_API_KEY in .env'); process.exit(1); }

const OUTPUT_DIR = resolve(ROOT, 'public/assets/textures');
const skipExisting = process.argv.includes('--skip-existing');

// These textures are mapped onto 3D meshes with additive blending.
// Dark/black background is CRITICAL. No text, no objects, pure energy effects.
const STYLE = 'AAA video game VFX texture on pure black background, glowing energy effect, used on 3D mesh with additive blending, cinematic quality like Diablo 4 or World of Warcraft spell effects, vivid saturated colors against black, no text no letters no objects no characters, square 1024x1024';

const textures = [
  // === School-based generic VFX ===
  {
    name: 'tex_vfx_fire_eruption',
    prompt: `Explosive fire eruption energy burst, bright orange-yellow flames swirling outward from center, intense hot white core, fiery tendrils and embers radiating in all directions, volcanic explosion of flames on black background, ${STYLE}`
  },
  {
    name: 'tex_vfx_frost_crystal',
    prompt: `Crystalline ice frost energy formation, pale blue and white ice crystal shards arranged in a radial pattern, frozen magical energy with sharp geometric ice crystals, cold blue glow with white frost particles, icy spell effect on black background, ${STYLE}`
  },
  {
    name: 'tex_vfx_shadow_rune',
    prompt: `Dark arcane shadow rune circle, glowing purple-violet runic symbols arranged in concentric circles, dark magic sigil with ethereal shadow tendrils, occult spell circle with dim purple energy, sinister dark magic on black background, ${STYLE}`
  },
  {
    name: 'tex_vfx_holy_radiance',
    prompt: `Divine golden holy radiance burst, brilliant warm golden-white light rays radiating from center, sacred energy with heavenly glow, divine sunburst pattern with golden particles, holy magic explosion on black background, ${STYLE}`
  },
  {
    name: 'tex_vfx_lightning_arc',
    prompt: `Electric lightning discharge arc, brilliant white-cyan branching lightning bolts radiating from a bright core, intense electrical energy with blue-white arcs, crackling electricity with bright sparks on black background, ${STYLE}`
  },
  {
    name: 'tex_vfx_blood_slash',
    prompt: `Visceral crimson blood slash energy, dark red arc of blood energy sweeping in a crescent pattern, deep crimson with darker edges and bright red highlights, blood magic slash effect on black background, ${STYLE}`
  },
  {
    name: 'tex_vfx_poison_mist',
    prompt: `Toxic green poison mist cloud, sickly green swirling toxic vapor with bright yellow-green highlights, poisonous gas with droplets and bubbles, noxious nature damage cloud on black background, ${STYLE}`
  },
  {
    name: 'tex_vfx_arcane_swirl',
    prompt: `Mystical arcane energy vortex, deep violet and magenta magical energy swirling in a spiral pattern, bright runic sparkles within the purple vortex, concentrated arcane power on black background, ${STYLE}`
  },

  // === Tyrant (Warrior) class textures ===
  {
    name: 'tex_vfx_tyrant_cleave',
    prompt: `Brutal warrior weapon cleave energy arc, intense red-orange sweeping blade energy trail with white-hot edge, sparks and ember particles along the arc, powerful melee slash effect with motion blur, aggressive combat energy on black background, ${STYLE}`
  },
  {
    name: 'tex_vfx_tyrant_cyclone',
    prompt: `Spinning warrior cyclone whirlwind, red-orange energy tornado vortex spiraling from center, circular motion blur with fiery particle trails, powerful spinning attack effect with radial energy lines on black background, ${STYLE}`
  },
  {
    name: 'tex_vfx_tyrant_slam',
    prompt: `Ground slam impact shockwave, concentric rings of orange-red energy radiating outward from a bright impact point, earth-shattering impact with debris and cracks pattern, seismic slam effect on black background, ${STYLE}`
  },

  // === Wraith (Rogue) class textures ===
  {
    name: 'tex_vfx_wraith_slash',
    prompt: `Quick dual-blade poison slash, two crossed bright green-purple energy slash arcs forming an X pattern, venomous blade trails with toxic drip particles, fast assassin strike effect on black background, ${STYLE}`
  },
  {
    name: 'tex_vfx_wraith_shadow',
    prompt: `Shadow stealth vanish effect, dark purple-black smoke dissipating outward, ethereal shadow wisps fading into darkness, mysterious void energy with faint purple glow, shadow step teleport effect on black background, ${STYLE}`
  },
  {
    name: 'tex_vfx_wraith_poison',
    prompt: `Dripping poison dagger effect, bright toxic green energy with venomous drips and splatters, poison-coated blade aura with bubbling acid droplets, toxic green glow on black background, ${STYLE}`
  },

  // === Infernal (Mage) class textures ===
  {
    name: 'tex_vfx_infernal_fireball',
    prompt: `Massive fireball projectile energy, intense orange-red-yellow fire sphere with swirling flame tendrils, bright white-hot core with outward-flowing fire energy, powerful fire spell projectile on black background, ${STYLE}`
  },
  {
    name: 'tex_vfx_infernal_frost',
    prompt: `Frost mage ice spell effect, sharp crystalline ice shards radiating outward, pale blue and white with icy mist, frozen energy with geometric crystal patterns, cold blue frost magic on black background, ${STYLE}`
  },
  {
    name: 'tex_vfx_infernal_arcane',
    prompt: `Arcane mage spell energy, bright violet-magenta arcane runes orbiting a central energy nexus, mystical purple energy with floating geometric symbols, powerful arcane magic concentration on black background, ${STYLE}`
  },
  {
    name: 'tex_vfx_infernal_eruption',
    prompt: `Volcanic ground eruption spell, pillar of fire and molten energy shooting upward, bright orange-red magma fountain with flying ember chunks, devastating eruption from below on black background, ${STYLE}`
  },

  // === Harbinger (Warlock) class textures ===
  {
    name: 'tex_vfx_harbinger_curse',
    prompt: `Dark warlock curse hex circle, sinister purple-green glowing runic symbols in a magic circle, dark energy tendrils reaching inward, malevolent curse sigil with occult symbols on black background, ${STYLE}`
  },
  {
    name: 'tex_vfx_harbinger_drain',
    prompt: `Soul drain life-steal beam energy, swirling purple-red energy stream flowing in one direction, dark tendrils of stolen life force with bright points of absorbed energy, vampiric drain effect on black background, ${STYLE}`
  },
  {
    name: 'tex_vfx_harbinger_portal',
    prompt: `Dark void portal rift, swirling deep purple-black dimensional tear with bright magenta edges, reality-warping vortex with cosmic void visible within, warlock teleport gate on black background, ${STYLE}`
  },
  {
    name: 'tex_vfx_harbinger_nova',
    prompt: `Dark shadow nova explosion, expanding ring of purple-black shadow energy bursting outward, dark shockwave with violet lightning arcs, devastating shadow AOE blast on black background, ${STYLE}`
  },

  // === Revenant (Paladin) class textures ===
  {
    name: 'tex_vfx_revenant_smite',
    prompt: `Holy smite divine strike, brilliant golden-white energy cross burst radiating outward, divine judgment impact with warm golden rays and holy sparkles, sacred weapon strike energy on black background, ${STYLE}`
  },
  {
    name: 'tex_vfx_revenant_heal',
    prompt: `Holy healing restoration energy, warm golden-green swirling upward healing particles, gentle divine light with nature growth energy, restorative holy magic spiral on black background, ${STYLE}`
  },
  {
    name: 'tex_vfx_revenant_shield',
    prompt: `Divine protection shield barrier, translucent golden-white hexagonal shield pattern, holy protective ward with radiant edges, sacred energy barrier with golden light on black background, ${STYLE}`
  },
  {
    name: 'tex_vfx_revenant_pillar',
    prompt: `Holy light pillar from above, vertical beam of brilliant golden-white divine energy, heavenly pillar of judgment with holy particles ascending, celestial column of sacred light on black background, ${STYLE}`
  },

  // === Shared VFX textures ===
  {
    name: 'tex_vfx_energy_orb',
    prompt: `Pure energy projectile sphere, bright white-blue swirling energy orb with spiral internal patterns, glowing arcane projectile with trailing energy wisps, concentrated magic sphere on black background, ${STYLE}`
  },
  {
    name: 'tex_vfx_impact_ring',
    prompt: `Circular impact shockwave ring, bright white-gold energy ring expanding outward, thin circular shockwave with bright leading edge and fading trail, impact ripple effect on black background, ${STYLE}`
  },
  {
    name: 'tex_vfx_steel_slash',
    prompt: `Clean steel weapon slash arc, bright silver-white curved blade energy sweep, sharp metallic slash trail with sparks, clean weapon strike effect with motion blur on black background, ${STYLE}`
  },
  {
    name: 'tex_vfx_ground_crack',
    prompt: `Ground crack impact pattern, glowing orange-red cracks spreading outward in a web pattern, earth fracture with molten energy visible through the cracks, seismic damage texture on black background, ${STYLE}`
  },
  {
    name: 'tex_vfx_nature_vines',
    prompt: `Living nature vine energy, bright emerald green glowing vines and leaves swirling in a circular pattern, bioluminescent plant energy with golden flower sparkles, druidic nature magic on black background, ${STYLE}`
  },
  {
    name: 'tex_vfx_stun_impact',
    prompt: `Stun impact concussion burst, bright white-yellow starburst with concentric dizzy circles, jarring impact flash with small orbiting stars, knockout strike effect on black background, ${STYLE}`
  },
];

console.log(`Generating ${textures.length} AAA VFX textures via gpt-image-1...`);
console.log(`Output: ${OUTPUT_DIR}\n`);

let generated = 0;
let skipped = 0;

for (const tex of textures) {
  const pngPath = resolve(OUTPUT_DIR, `${tex.name}.png`);
  const webpPath = resolve(OUTPUT_DIR, `${tex.name}.webp`);

  if (skipExisting && existsSync(webpPath)) {
    console.log(`  SKIP ${tex.name} (exists)`);
    skipped++;
    continue;
  }

  console.log(`  GEN  ${tex.name}...`);
  try {
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt: tex.prompt,
        n: 1,
        size: '1024x1024',
        quality: 'high',
        background: 'auto',
        output_format: 'png'
      })
    });

    const data = await resp.json();
    if (!data.data?.[0]) {
      console.error(`  FAIL ${tex.name}:`, JSON.stringify(data).slice(0, 300));
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
      console.error(`  FAIL ${tex.name}: No image data`);
      continue;
    }

    // Save as PNG first, then convert to webp
    writeFileSync(pngPath, buf);
    try {
      execSync(`sips -s format webp "${pngPath}" --out "${webpPath}" 2>/dev/null`, { stdio: 'pipe' });
      // Remove temporary PNG
      execSync(`rm "${pngPath}"`, { stdio: 'pipe' });
    } catch {
      // If sips fails, keep the PNG and rename to webp (Three.js handles it)
      console.log(`  WARN ${tex.name}: sips conversion failed, using PNG`);
      execSync(`mv "${pngPath}" "${webpPath}"`, { stdio: 'pipe' });
    }

    const finalSize = readFileSync(webpPath).length;
    generated++;
    console.log(`  DONE ${tex.name} (${(finalSize / 1024).toFixed(0)} KB)`);
  } catch (err) {
    console.error(`  ERR  ${tex.name}: ${err.message}`);
  }

  // Rate limit: 8s between requests (high quality)
  await new Promise(r => setTimeout(r, 8000));
}

console.log(`\nComplete: ${generated} generated, ${skipped} skipped, ${textures.length - generated - skipped} failed`);
