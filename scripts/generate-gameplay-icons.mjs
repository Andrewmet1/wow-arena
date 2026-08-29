#!/usr/bin/env node
// Generate dark fantasy icons for the gameplay page via gpt-image-1
// Uses transparent backgrounds so icons blend with any dark UI
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const envText = readFileSync(resolve(ROOT, '.env'), 'utf-8');
const apiKey = envText.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
if (!apiKey) { console.error('No OPENAI_API_KEY in .env'); process.exit(1); }

const OUTPUT_DIR = resolve(ROOT, 'public/assets/art/icons');
const skipExisting = process.argv.includes('--skip-existing');

// Shared style suffix — transparent background for UI overlay use
const STYLE = 'centered symmetric icon, transparent background, dark fantasy style with ornate gold and teal accents, clean crisp edges, game UI icon, highly detailed digital painting, no text no letters no words no writing';

const icons = [
  // Gameplay page "pillar" icons
  { name: 'icon_action', prompt: `A lightning bolt crackling with golden energy, sparks flying outward, ${STYLE}` },
  { name: 'icon_strategy', prompt: `An ornate golden balance scale with one side holding a glowing soul ember and the other a dark crystal, mystical energy flowing between pans, ${STYLE}` },
  { name: 'icon_combat', prompt: `Two crossed dark fantasy swords with ornate hilts, one wreathed in crimson fire and the other in teal shadow energy, ${STYLE}` },

  // Combat mechanic icons
  { name: 'icon_resource', prompt: `A glowing golden mana crystal orb floating with magical energy radiating outward in spirals, ${STYLE}` },
  { name: 'icon_execute', prompt: `A massive dark executioner axe with a crimson glowing blade edge, skull pommel, dripping red energy, ${STYLE}` },
  { name: 'icon_combo', prompt: `Three dark fantasy daggers arranged in a fan pattern, each trailing a different colored spectral streak purple teal and gold, ${STYLE}` },
  { name: 'icon_dot', prompt: `A dark skull with green poison dripping from the eye sockets, surrounded by swirling toxic green fumes, ${STYLE}` },
  { name: 'icon_holypower', prompt: `A radiant golden cross-shaped halo with divine light beams emanating outward, ${STYLE}` },

  // Economy icons
  { name: 'icon_earn_coins', prompt: `A pile of enchanted gold coins with magical teal runes glowing on surfaces, golden light emanating upward, ${STYLE}` },
  { name: 'icon_champion_bets', prompt: `An ornate golden betting scale with spectral champion silhouettes on each side, teal magical energy, ${STYLE}` },
  { name: 'icon_champions_cut', prompt: `A dark crown with crimson gemstones sitting atop gold coins, dark energy radiating from the crown, ${STYLE}` },
  { name: 'icon_weekly_quests', prompt: `An ancient scroll unrolled with glowing green quest runes, a dark quill pen floating beside it, ${STYLE}` },

  // Input icons
  { name: 'icon_keyboard', prompt: `A dark fantasy mechanical keyboard key with a glowing golden rune symbol, ornate dark metal frame, ${STYLE}` },
  { name: 'icon_controller', prompt: `A dark fantasy game controller made of dark iron and bone, glowing teal buttons and gold analog sticks, ${STYLE}` },
];

console.log(`Generating ${icons.length} gameplay icons via gpt-image-1 (transparent PNG, 1024x1024)...`);

for (const icon of icons) {
  const outPath = resolve(OUTPUT_DIR, `${icon.name}.png`);
  if (skipExisting && existsSync(outPath)) {
    console.log(`Skipping ${icon.name} (already exists)`);
    continue;
  }
  console.log(`\n=== Generating ${icon.name} ===`);
  try {
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt: icon.prompt,
        n: 1,
        size: '1024x1024',
        quality: 'medium',
        background: 'transparent',
        output_format: 'png'
      })
    });
    const data = await resp.json();
    if (!data.data?.[0]) {
      console.error(`Failed for ${icon.name}:`, JSON.stringify(data).slice(0, 300));
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
      console.error(`No image data for ${icon.name}`);
      continue;
    }
    writeFileSync(outPath, buf);
    console.log(`Saved ${icon.name}.png (${(buf.length / 1024).toFixed(0)} KB) -> ${outPath}`);
  } catch (err) {
    console.error(`Error generating ${icon.name}:`, err.message);
  }
  await new Promise(r => setTimeout(r, 5000));
}
console.log('\n=== Done ===');
