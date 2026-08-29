#!/usr/bin/env node
// Generate icons for the 5 themed gear sets + 15 named legendary uniques.
// Output:
//   public/assets/art/icons/sets/{setId}_{slot}.png  (5 sets × 6 slots = 30)
//   public/assets/art/icons/legendaries/{effectId}.png  (15 unique)
//   public/assets/art/icons/sets/{setId}_emblem.png  (5 set emblems for hub)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OPENAI_KEY = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8').match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();

const SETS_DIR = path.join(ROOT, 'public', 'assets', 'art', 'icons', 'sets');
const LEG_DIR = path.join(ROOT, 'public', 'assets', 'art', 'icons', 'legendaries');
fs.mkdirSync(SETS_DIR, { recursive: true });
fs.mkdirSync(LEG_DIR, { recursive: true });

// Set visual signatures
const SETS = {
  crimson_wraith: {
    base: 'dark crimson red leather with black shadow filigree, bone hooks and ritual stitching',
    accent: 'glowing red runic embroidery',
  },
  ashen_throne: {
    base: 'heavy dark steel plate with charred-iron edges and skull motifs, weathered with battle scars',
    accent: 'ember-red glow in cracks',
  },
  ember_archon: {
    base: 'tattered red-and-gold mage robes with glowing fire-rune trim and obsidian buckles',
    accent: 'inner ember-fire glow',
  },
  rotbringer: {
    base: 'twisted dark green leather and bone with vines, mushrooms, and decay growths',
    accent: 'sickly green corrupted glow',
  },
  hollow_paladin: {
    base: 'gold and ivory plate with holy halo etchings and white-blue divine runes',
    accent: 'pale gold divine glow',
  },
};
const SLOT_DESCS = {
  head:    'gothic helmet with horns and visor',
  chest:   'plate cuirass with central runic emblem',
  legs:    'plated greaves with iron knee plates',
  weapon:  'two-handed war sword',
  offhand: 'sigil shield with embedded crystal',
  trinket: 'amulet on a chain with glowing centerpiece',
};

const LEGENDARIES = {
  king_hand: 'A regal black-and-gold longsword, the blade etched with crowned skulls, hilt wrapped in red velvet, faint golden glow along the fuller',
  ashen_pact: 'A blackened iron amulet with a single glowing red eye in the center, set in ornate burnished gold',
  voidmind_circlet: 'A thin obsidian crown with three pulsing violet gems and trailing dark mist',
  bulwark_of_ages: 'A massive round tower shield of weathered steel and gold with a roaring lion face boss',
  stormstride_greaves: 'Plated leg armor with lightning-blue runes glowing along the calf and crackling ember sparks',
  carapace_of_thorns: 'A spiked dark iron chestplate covered in jutting black thorns, blood streaks on the spikes',
  wraithcloak: 'A tattered black cloak with ghostly white smoke trailing from its edges, a silver clasp shaped like a screaming skull',
  crucible_forge_blade: 'A massive cleaver-style two-handed sword, the blade glowing white-hot with embers along the edge, iron-banded leather grip',
  soulharvest_sigil: 'A bone-white circular sigil with carved demon faces, surrounded by floating ghostly green flames',
  ember_crown: 'A crown of black iron with seven small flickering flames atop its spikes, gold inlay around the base',
  ring_of_seven_falls: 'A dark silver ring with seven small obsidian gems arranged in a circle, faint waterfall glow',
  godsblood_amulet: 'An ornate gold and ruby amulet with a single drop of luminous crimson liquid suspended inside the central gem',
  thronebreaker_pauldrons: 'Massive jagged dark steel shoulder armor with golden spikes, broken crown motif on each side',
  warders_signet: 'A silver ring with an inscribed glowing blue sigil, runic markings around the band',
  hollow_kings_boots: 'Tall battle-worn leather boots with iron toe caps and bone fragments threaded into the laces, faint sickly green glow at the soles',
};

const ASSETS = [];
// Set pieces (5 × 6 = 30)
for (const [setId, setStyle] of Object.entries(SETS)) {
  for (const [slot, slotDesc] of Object.entries(SLOT_DESCS)) {
    ASSETS.push({
      out: path.join(SETS_DIR, `${setId}_${slot}.png`),
      id: `set_${setId}_${slot}`,
      size: '1024x1024',
      transparent: true,
      prompt: `Dark fantasy game item icon on transparent background, top-down ortho view of a ${slotDesc} made of ${setStyle.base} with ${setStyle.accent}, ornate matching set piece, painterly digital art icon style centered in frame, suitable as a square inventory slot icon, 1024x1024 transparent PNG`,
    });
  }
}
// Set emblems (5 emblems for hub set-progress UI)
for (const [setId, setStyle] of Object.entries(SETS)) {
  ASSETS.push({
    out: path.join(SETS_DIR, `${setId}_emblem.png`),
    id: `set_${setId}_emblem`,
    size: '1024x1024',
    transparent: true,
    prompt: `Dark fantasy circular set emblem on transparent background, ornate medallion with the ${setStyle.base} aesthetic and ${setStyle.accent}, centered single emblem icon, painterly digital art, 1024x1024 transparent PNG`,
  });
}
// Legendary uniques (15)
for (const [effectId, desc] of Object.entries(LEGENDARIES)) {
  ASSETS.push({
    out: path.join(LEG_DIR, `${effectId}.png`),
    id: `legendary_${effectId}`,
    size: '1024x1024',
    transparent: true,
    prompt: `Dark fantasy legendary unique item icon on transparent background, top-down ortho view of ${desc}, intricate hand-painted detail, ornate gothic style, bright glow effect appropriate to the item, painterly digital art icon style centered in frame, 1024x1024 transparent PNG`,
  });
}

async function gen(asset) {
  if (fs.existsSync(asset.out)) { console.log(`[skip] ${asset.id}`); return; }
  console.log(`[gen] ${asset.id}...`);
  const body = {
    model: 'gpt-image-1', prompt: asset.prompt, n: 1,
    size: asset.size, quality: 'medium', output_format: 'png',
  };
  if (asset.transparent) body.background = 'transparent';
  try {
    const r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) { console.error(`[ERR ${asset.id}]`, JSON.stringify(d).slice(0, 300)); return; }
    fs.writeFileSync(asset.out, Buffer.from(d.data[0].b64_json, 'base64'));
    console.log(`[ok] ${asset.id}`);
  } catch (e) { console.error(`[ERR ${asset.id}]`, e.message); }
}

console.log(`=== Set + Legendary icons: ${ASSETS.length} pieces ===`);
const concurrency = 8;
const queue = [...ASSETS];
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (queue.length) {
    const a = queue.shift();
    if (!a) return;
    await gen(a);
  }
}));
console.log('=== Done ===');
