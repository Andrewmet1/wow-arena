#!/usr/bin/env node
/**
 * generate-icons.js — Generate WoW-style ability icons via OpenAI DALL-E 3.
 *
 * Usage:   node scripts/generate-icons.js [--class tyrant] [--dry-run]
 * Env:     OPENAI_API_KEY in .env
 *
 * Generates 1024x1024 icons, saves to public/assets/icons/{ability_id}.png
 * Skips already-generated icons. Rate-limited to ~5 images/min.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = path.join(__dirname, '..', 'public', 'assets', 'icons');
const API_KEY = process.env.OPENAI_API_KEY;

if (!API_KEY) {
  console.error('Missing OPENAI_API_KEY in .env');
  process.exit(1);
}

// ─── Full ability manifest ───────────────────────────────────────────────────
const ABILITIES = [
  // Tyrant (Warrior)
  { id: 'ravaging_cleave', name: 'Ravaging Cleave', school: 'physical', class: 'Tyrant' },
  { id: 'bloodrage_strike', name: 'Bloodrage Strike', school: 'physical', class: 'Tyrant' },
  { id: 'brutal_slam', name: 'Brutal Slam', school: 'physical', class: 'Tyrant' },
  { id: 'iron_cyclone', name: 'Iron Cyclone', school: 'physical', class: 'Tyrant' },
  { id: 'shatter_guard', name: 'Shatter Guard', school: 'physical', class: 'Tyrant' },
  { id: 'warbringer_rush', name: 'Warbringer Rush', school: 'physical', class: 'Tyrant' },
  { id: 'crippling_strike', name: 'Crippling Strike', school: 'physical', class: 'Tyrant' },
  { id: 'thunder_spike', name: 'Thunder Spike', school: 'physical', class: 'Tyrant' },
  { id: 'iron_resolve', name: 'Iron Resolve', school: 'physical', class: 'Tyrant' },
  { id: 'warborn_rally', name: 'Warborn Rally', school: 'physical', class: 'Tyrant' },
  { id: 'skull_crack', name: 'Skull Crack', school: 'physical', class: 'Tyrant' },
  { id: 'crushing_descent', name: 'Crushing Descent', school: 'physical', class: 'Tyrant' },

  // Wraith (Rogue)
  { id: 'viper_lash', name: 'Viper Lash', school: 'physical', class: 'Wraith' },
  { id: 'throat_opener', name: 'Throat Opener', school: 'physical', class: 'Wraith' },
  { id: 'grim_flurry', name: 'Grim Flurry', school: 'physical', class: 'Wraith' },
  { id: 'nerve_strike', name: 'Nerve Strike', school: 'physical', class: 'Wraith' },
  { id: 'serrated_wound', name: 'Serrated Wound', school: 'physical', class: 'Wraith' },
  { id: 'blackjack', name: 'Blackjack', school: 'physical', class: 'Wraith' },
  { id: 'veil_of_night', name: 'Veil of Night', school: 'physical', class: 'Wraith' },
  { id: 'shade_shift', name: 'Shade Shift', school: 'physical', class: 'Wraith' },
  { id: 'phantasm_dodge', name: 'Phantasm Dodge', school: 'physical', class: 'Wraith' },
  { id: 'umbral_shroud', name: 'Umbral Shroud', school: 'physical', class: 'Wraith' },
  { id: 'blood_tincture', name: 'Blood Tincture', school: 'physical', class: 'Wraith' },
  { id: 'throat_jab', name: 'Throat Jab', school: 'physical', class: 'Wraith' },
  { id: 'frenzy_edge', name: 'Frenzy Edge', school: 'physical', class: 'Wraith' },
  { id: 'shadowmeld', name: 'Shadowmeld', school: 'physical', class: 'Wraith' },

  // Infernal (Mage)
  { id: 'inferno_bolt', name: 'Inferno Bolt', school: 'fire', class: 'Infernal' },
  { id: 'cataclysm_flare', name: 'Cataclysm Flare', school: 'fire', class: 'Infernal' },
  { id: 'searing_pulse', name: 'Searing Pulse', school: 'fire', class: 'Infernal' },
  { id: 'glacial_lance', name: 'Glacial Lance', school: 'frost', class: 'Infernal' },
  { id: 'permafrost_burst', name: 'Permafrost Burst', school: 'frost', class: 'Infernal' },
  { id: 'phase_shift', name: 'Phase Shift', school: 'arcane', class: 'Infernal' },
  { id: 'pyroclasm', name: 'Pyroclasm', school: 'fire', class: 'Infernal' },
  { id: 'crystalline_ward', name: 'Crystalline Ward', school: 'frost', class: 'Infernal' },
  { id: 'cauterize', name: 'Cauterize', school: 'fire', class: 'Infernal' },
  { id: 'arcane_bulwark', name: 'Arcane Bulwark', school: 'arcane', class: 'Infernal' },
  { id: 'spell_fracture', name: 'Spell Fracture', school: 'arcane', class: 'Infernal' },
  { id: 'scaldwind', name: 'Scaldwind', school: 'fire', class: 'Infernal' },
  { id: 'ember_brand', name: 'Ember Brand', school: 'fire', class: 'Infernal' },
  { id: 'scorched_earth', name: 'Scorched Earth', school: 'fire', class: 'Infernal' },
  { id: 'ring_of_frost', name: 'Ring of Frost', school: 'frost', class: 'Infernal' },

  // Harbinger (Warlock)
  { id: 'hex_blight', name: 'Hex Blight', school: 'shadow', class: 'Harbinger' },
  { id: 'creeping_torment', name: 'Creeping Torment', school: 'shadow', class: 'Harbinger' },
  { id: 'volatile_hex', name: 'Volatile Hex', school: 'shadow', class: 'Harbinger' },
  { id: 'siphon_essence', name: 'Siphon Essence', school: 'shadow', class: 'Harbinger' },
  { id: 'hex_rupture', name: 'Hex Rupture', school: 'shadow', class: 'Harbinger' },
  { id: 'dread_howl', name: 'Dread Howl', school: 'shadow', class: 'Harbinger' },
  { id: 'wraith_bolt', name: 'Wraith Bolt', school: 'shadow', class: 'Harbinger' },
  { id: 'nether_slam', name: 'Nether Slam', school: 'shadow', class: 'Harbinger' },
  { id: 'blood_tithe', name: 'Blood Tithe', school: 'shadow', class: 'Harbinger' },
  { id: 'warded_flesh', name: 'Warded Flesh', school: 'shadow', class: 'Harbinger' },
  { id: 'rift_anchor', name: 'Rift Anchor', school: 'shadow', class: 'Harbinger' },
  { id: 'hex_silence', name: 'Hex Silence', school: 'shadow', class: 'Harbinger' },
  { id: 'soul_ignite', name: 'Soul Ignite', school: 'shadow', class: 'Harbinger' },
  { id: 'shadowfury', name: 'Shadowfury', school: 'shadow', class: 'Harbinger' },
  { id: 'abyssal_ground', name: 'Abyssal Ground', school: 'shadow', class: 'Harbinger' },

  // Revenant (Paladin)
  { id: 'hallowed_strike', name: 'Hallowed Strike', school: 'physical', class: 'Revenant' },
  { id: 'divine_reckoning', name: 'Divine Reckoning', school: 'holy', class: 'Revenant' },
  { id: 'radiant_verdict', name: 'Radiant Verdict', school: 'holy', class: 'Revenant' },
  { id: 'sanctified_gale', name: 'Sanctified Gale', school: 'holy', class: 'Revenant' },
  { id: 'ember_wake', name: 'Ember Wake', school: 'holy', class: 'Revenant' },
  { id: 'gavel_of_light', name: 'Gavel of Light', school: 'holy', class: 'Revenant' },
  { id: 'binding_prayer', name: 'Binding Prayer', school: 'holy', class: 'Revenant' },
  { id: 'aegis_of_dawn', name: 'Aegis of Dawn', school: 'holy', class: 'Revenant' },
  { id: 'sovereign_mend', name: 'Sovereign Mend', school: 'holy', class: 'Revenant' },
  { id: 'holy_restoration', name: 'Holy Restoration', school: 'holy', class: 'Revenant' },
  { id: 'unchained_grace', name: 'Unchained Grace', school: 'holy', class: 'Revenant' },
  { id: 'sanctified_rebuff', name: 'Sanctified Rebuff', school: 'physical', class: 'Revenant' },
  { id: 'valiant_charge', name: 'Valiant Charge', school: 'holy', class: 'Revenant' },
];

// ─── School-based color/mood descriptors ─────────────────────────────────────
const SCHOOL_THEMES = {
  physical: 'metallic steel and iron tones, battle-worn, sharp edges, dark crimson accents, aggressive',
  fire: 'blazing orange and red flames, molten lava, volcanic eruption, infernal heat, ember glow',
  frost: 'icy blue and white crystals, frozen shards, glacial mist, winter cold, frostbite',
  arcane: 'ethereal purple and violet energy, arcane runes, mystical geometry, shimmering magic',
  shadow: 'dark purple and black void energy, necrotic green accents, eldritch horror, corruption',
  holy: 'radiant golden light, divine sunbeams, sacred halo, warm amber glow, blessed energy',
};

// ─── Helper: download URL to file ────────────────────────────────────────────
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (resp) => {
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
        // Follow redirect
        https.get(resp.headers.location, (resp2) => {
          resp2.pipe(file);
          file.on('finish', () => { file.close(resolve); });
        }).on('error', reject);
      } else {
        resp.pipe(file);
        file.on('finish', () => { file.close(resolve); });
      }
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

// ─── Helper: call OpenAI DALL-E 3 ────────────────────────────────────────────
async function generateIcon(ability) {
  const schoolTheme = SCHOOL_THEMES[ability.school] || SCHOOL_THEMES.physical;
  const prompt = `World of Warcraft style ability icon for "${ability.name}". Dark fantasy game UI icon, square format, centered composition with no text or letters. ${schoolTheme}. Painterly digital art style with rich textures, dramatic lighting, ornate border frame. The icon should clearly represent the ability through symbolic imagery.`;

  const body = JSON.stringify({
    model: 'dall-e-3',
    prompt,
    n: 1,
    size: '1024x1024',
    quality: 'standard',
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/images/generations',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error(json.error.message));
          } else {
            resolve(json.data[0].url);
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const classFilter = args.includes('--class') ? args[args.indexOf('--class') + 1] : null;

  fs.mkdirSync(ICONS_DIR, { recursive: true });

  let abilities = ABILITIES;
  if (classFilter) {
    abilities = abilities.filter(a => a.class.toLowerCase() === classFilter.toLowerCase());
    console.log(`Filtering to class: ${classFilter} (${abilities.length} abilities)`);
  }

  // Skip already-generated
  const toGenerate = abilities.filter(a => !fs.existsSync(path.join(ICONS_DIR, `${a.id}.png`)));
  const skipped = abilities.length - toGenerate.length;

  console.log(`\nIcon Generation Plan:`);
  console.log(`  Total abilities: ${abilities.length}`);
  console.log(`  Already generated: ${skipped}`);
  console.log(`  To generate: ${toGenerate.length}`);
  console.log(`  Estimated time: ~${Math.ceil(toGenerate.length * 15 / 60)} minutes\n`);

  if (dryRun) {
    console.log('Dry run — would generate:');
    for (const a of toGenerate) console.log(`  ${a.id} (${a.class} / ${a.school})`);
    return;
  }

  if (toGenerate.length === 0) {
    console.log('All icons already generated!');
    return;
  }

  let generated = 0;
  let failed = 0;

  for (const ability of toGenerate) {
    const outPath = path.join(ICONS_DIR, `${ability.id}.png`);
    try {
      process.stdout.write(`[${generated + failed + 1}/${toGenerate.length}] ${ability.id} (${ability.class})... `);
      const url = await generateIcon(ability);
      await downloadFile(url, outPath);
      console.log('OK');
      generated++;
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      failed++;
    }

    // Rate limit: ~4 requests per minute for DALL-E 3
    if (generated + failed < toGenerate.length) {
      await new Promise(r => setTimeout(r, 15000));
    }
  }

  console.log(`\nDone! Generated: ${generated}, Failed: ${failed}, Skipped: ${skipped}`);
}

main().catch(console.error);
