#!/usr/bin/env node
// Generate dark fantasy art assets via DALL-E 3 for Ebon Crucible
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const envText = readFileSync(resolve(ROOT, '.env'), 'utf-8');
const apiKey = envText.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
if (!apiKey) { console.error('No OPENAI_API_KEY in .env'); process.exit(1); }

const OUTPUT_DIR = resolve(ROOT, 'public/assets/art');
const skipExisting = process.argv.includes('--skip-existing');

const images = [
  // === Existing background art ===
  {
    name: 'arena_action',
    prompt: 'Dark fantasy arena combat scene, two armored champions clashing in a volcanic stone colosseum, magical spell effects, fire and shadow energy, dramatic lighting, dark moody atmosphere with crimson and gold accents, epic fantasy game art style, 16:9 cinematic composition, no text no letters no words'
  },
  {
    name: 'ranked_banner',
    prompt: 'Dark fantasy throne room with five glowing rank emblems arranged in ascending order - iron grey, silver, gold, teal, diamond blue - floating above a stone altar, dark magical atmosphere, epic fantasy art, ornate gothic architecture, moody lighting, no text no letters no words'
  },
  {
    name: 'patch_notes_bg',
    prompt: 'Dark fantasy war table with scrolls and magical artifacts, dimly lit by candlelight, ancient maps and glowing runes, parchment with arcane writing, dark medieval study aesthetic, moody cinematic lighting, top-down perspective, no text no letters no words'
  },

  // === New scene/background art ===
  {
    name: 'rankings_hero_bg',
    prompt: 'Grand dark fantasy colosseum interior viewed from above, tiered stone seats rising into shadow, burning torches along the walls, a circular arena floor with carved runes glowing faintly, dramatic overhead lighting from a hole in the domed ceiling, dark moody atmosphere, epic fantasy game art, cinematic 16:9 composition, no text no letters no words'
  },
  {
    name: 'prove_yourself_bg',
    prompt: 'Dramatic dark fantasy scene of a lone armored warrior silhouette walking through a massive stone archway into a volcanic arena, golden sunlight streaming through the entrance creating god rays, dust particles in the air, dark moody atmosphere beyond the archway, epic gladiator entrance, cinematic 16:9 composition, no text no letters no words'
  },
  {
    name: 'mode_ranked',
    prompt: 'Dark fantasy arena duel, two armored champions facing each other across a volcanic stone arena floor, weapons drawn, magical energy crackling between them, dramatic side lighting, tense standoff moment, dark atmospheric colosseum background, epic game art, cinematic composition, no text no letters no words'
  },
  {
    name: 'mode_custom',
    prompt: 'Dark fantasy tavern war room interior, a large wooden table with a magical glowing game board, floating spectral chess-like pieces, tankards and scrolls, warm candlelight and fireplace glow, casual but atmospheric, cozy dark medieval setting, game art style, cinematic composition, no text no letters no words'
  },
  {
    name: 'mode_ai',
    prompt: 'Dark fantasy training ground, a lone warrior practicing combat against a spectral ghostly training dummy that glows with blue arcane energy, mystical training arena with floating arcane targets, practice weapons on racks, moody atmospheric lighting, game art style, cinematic composition, no text no letters no words'
  },

  // === Class banner art (panoramic, showing full character + environment) ===
  {
    name: 'tyrant_banner',
    prompt: 'Dark fantasy warrior in heavy crimson-accented black plate armor, massive two-handed greatsword resting on shoulder, standing powerfully in a volcanic battlefield with lava rivers and dark smoke, full body visible from head to feet, wide panoramic shot showing character and environment, dark red and crimson color palette, epic game art, cinematic 16:9 composition, no text no letters no words'
  },
  {
    name: 'wraith_banner',
    prompt: 'Dark fantasy assassin in shadowy dark purple leather armor with hood, dual curved daggers drawn, crouching on a moonlit gothic rooftop overlooking a dark city, full body visible, wide panoramic shot showing character and environment, deep purple and shadow color palette, silver moonlight, epic game art, cinematic 16:9 composition, no text no letters no words'
  },
  {
    name: 'infernal_banner',
    prompt: 'Dark fantasy fire mage in flowing dark robes with orange flame accents and glowing runes, ornate staff crackling with fire magic, standing amid a field of lava and volcanic flame pillars, full body visible from head to feet, wide panoramic shot showing character and hellish environment, orange and dark red color palette, epic game art, cinematic 16:9 composition, no text no letters no words'
  },
  {
    name: 'harbinger_banner',
    prompt: 'Dark fantasy warlock in tattered dark green-accented robes, swirling dark shadow energy around outstretched hands, standing in a corrupted dead swamp with twisted trees and green ghostly wisps, full body visible from head to feet, wide panoramic shot showing character and environment, dark green and shadow color palette, eerie atmosphere, epic game art, cinematic 16:9 composition, no text no letters no words'
  },
  {
    name: 'revenant_banner',
    prompt: 'Dark fantasy holy paladin in ornate golden plate armor with white tabard, wielding a glowing mace and kite shield, standing in a ruined gothic cathedral with shafts of golden divine light streaming through broken stained glass, full body visible from head to feet, wide panoramic shot, gold and white color palette with dark shadows, epic game art, cinematic 16:9 composition, no text no letters no words'
  }
];

console.log(`Found ${images.length} images to generate via DALL-E 3 (HD quality)...`);

let generated = 0;
let skipped = 0;

for (const img of images) {
  const outPath = resolve(OUTPUT_DIR, `${img.name}.webp`);
  if (skipExisting && existsSync(outPath)) {
    console.log(`Skipping ${img.name} (already exists)`);
    skipped++;
    continue;
  }
  console.log(`\n=== Generating ${img.name} (${generated + 1}/${images.length - skipped}) ===`);
  try {
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'dall-e-3', prompt: img.prompt, n: 1, size: '1792x1024', quality: 'hd' })
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
    generated++;
  } catch (err) {
    console.error(`Error generating ${img.name}:`, err.message);
  }
  // Rate limit delay
  await new Promise(r => setTimeout(r, 15000));
}
console.log(`\n=== Done === (${generated} generated, ${skipped} skipped)`);
