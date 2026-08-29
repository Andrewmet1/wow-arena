#!/usr/bin/env node
// Generate the gear + gem icon library so every item the player loots has a
// painted icon (not just a procedural placeholder). The dungeon hub renders
// these in inventory grids, equip slots, and tooltips.
//
// Output:
//   public/assets/art/icons/gear/{rarity}_{slot}.png  (30 icons)
//   public/assets/art/icons/gems/{rarity}_{stat}.png  (15 icons)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OPENAI_KEY = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8').match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();

const GEAR_DIR = path.join(ROOT, 'public', 'assets', 'art', 'icons', 'gear');
const GEM_DIR  = path.join(ROOT, 'public', 'assets', 'art', 'icons', 'gems');
fs.mkdirSync(GEAR_DIR, { recursive: true });
fs.mkdirSync(GEM_DIR, { recursive: true });

// Rarity color/style mapping — affects the rim glow and metal hue
const RARITY_STYLE = {
  common:    'plain weathered iron with no glow',
  uncommon:  'polished bronze with subtle green tint',
  rare:      'silver inlaid with sapphire blue glow',
  epic:      'darksteel with purple-violet glow and runic etchings',
  legendary: 'gold-and-obsidian with bright orange-yellow glow and intricate carvings',
};

const SLOT_DESCRIPTIONS = {
  head:    'gothic helmet with horns and visor',
  chest:   'plate cuirass with central runic emblem',
  legs:    'plated greaves with iron knee plates',
  weapon:  'two-handed war sword',
  offhand: 'eldritch sigil shield with embedded crystal',
  trinket: 'amulet on a chain with a glowing centerpiece',
};

const GEM_STAT_STYLE = {
  damage: { name: 'Bloodgem', desc: 'faceted crimson red gem' },
  life:   { name: 'Lifegem',  desc: 'faceted emerald green gem' },
  haste:  { name: 'Hastegem', desc: 'faceted golden yellow gem' },
  crit:   { name: 'Critgem',  desc: 'faceted icy blue gem' },
  armor:  { name: 'Aegisgem', desc: 'faceted silver-white gem' },
};
const GEM_RARITY_STYLE = {
  common: 'small dim gem with faint glow',
  rare:   'medium gem with bright clear glow and ornate setting',
  mythic: 'large brilliant gem with intense pulsing glow and ornate gold setting',
};

const ASSETS = [];

// Gear: rarity × slot
for (const [rarity, rarityDesc] of Object.entries(RARITY_STYLE)) {
  for (const [slot, slotDesc] of Object.entries(SLOT_DESCRIPTIONS)) {
    ASSETS.push({
      out: path.join(GEAR_DIR, `${rarity}_${slot}.png`),
      id: `gear_${rarity}_${slot}`,
      size: '1024x1024',
      transparent: true,
      prompt: `Dark fantasy game item icon on transparent background, top-down ortho view of a single ${rarityDesc} ${slotDesc}, painterly digital art icon style centered in frame, decorative ornate gothic detailing, suitable as a square inventory slot icon, 1024x1024 transparent PNG`,
    });
  }
}

// Gems: rarity × stat type
for (const [rarity, rarityDesc] of Object.entries(GEM_RARITY_STYLE)) {
  for (const [stat, { name, desc }] of Object.entries(GEM_STAT_STYLE)) {
    ASSETS.push({
      out: path.join(GEM_DIR, `${rarity}_${stat}.png`),
      id: `gem_${rarity}_${stat}`,
      size: '1024x1024',
      transparent: true,
      prompt: `Dark fantasy game gem icon on transparent background, top-down ortho view of a ${rarityDesc} that is a ${desc} (the ${name} gem), centered in frame, painterly digital art icon, dark gothic style, 1024x1024 transparent PNG`,
    });
  }
}

async function gen(asset) {
  if (fs.existsSync(asset.out)) { console.log(`[skip] ${asset.id}`); return; }
  console.log(`[gen] ${asset.id}...`);
  const body = {
    model: 'gpt-image-1',
    prompt: asset.prompt,
    n: 1,
    size: asset.size,
    quality: 'medium',
    output_format: 'png',
  };
  if (asset.transparent) body.background = 'transparent';
  try {
    const r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) {
      console.error(`[ERR ${asset.id}]`, JSON.stringify(d).slice(0, 300));
      return;
    }
    fs.writeFileSync(asset.out, Buffer.from(d.data[0].b64_json, 'base64'));
    console.log(`[ok] ${asset.id}`);
  } catch (e) {
    console.error(`[ERR ${asset.id}]`, e.message);
  }
}

console.log(`=== Gear+gem icons: ${ASSETS.length} pieces ===`);
// Limit concurrency to 8 to avoid rate limits
const concurrency = 8;
const queue = [...ASSETS];
const workers = [];
for (let i = 0; i < concurrency; i++) {
  workers.push((async () => {
    while (queue.length) {
      const a = queue.shift();
      if (!a) return;
      await gen(a);
    }
  })());
}
await Promise.all(workers);
console.log('=== Done ===');
