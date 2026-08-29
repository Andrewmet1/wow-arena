#!/usr/bin/env node
/**
 * Generate sound effects using ElevenLabs Sound Effects API.
 * Output: public/assets/audio/sfx/{key}.mp3
 * Idempotent: skips existing files unless --force flag is passed.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'public', 'assets', 'audio', 'sfx');
const API_KEY = process.env.ELEVENLABS_API_KEY || 'sk_aabb461442cd3f90ce9852a0189413596ae7eb5ff88505f8';
const FORCE = process.argv.includes('--force');

const SFX_PROMPTS = [
  { key: 'sword_hit', prompt: 'Heavy sword impact on metal armor, dark fantasy, sharp metallic clang with bass thud', duration: 1 },
  { key: 'sword_swing', prompt: 'Fast sword swing whoosh through air, dark fantasy weapon slash', duration: 0.5 },
  { key: 'melee_hit', prompt: 'Brutal melee punch impact, flesh and bone crunch, dark gritty combat', duration: 0.5 },
  { key: 'spell_cast', prompt: 'Dark magical spell casting, arcane energy gathering and releasing, mystical whoosh with sparkle', duration: 1 },
  { key: 'fire_impact', prompt: 'Explosive fireball impact, roaring flames and crackling fire burst, magical explosion', duration: 1 },
  { key: 'shadow_impact', prompt: 'Dark shadow magic impact, ominous void energy pulse, deep bass rumble, sinister', duration: 1 },
  { key: 'holy_impact', prompt: 'Divine holy magic impact, bright radiant energy burst, crystalline chime, heavenly', duration: 1 },
  { key: 'frost_impact', prompt: 'Ice shattering impact, frozen crystal breaking apart, cold crackle and shatter', duration: 1 },
  { key: 'heal_cast', prompt: 'Gentle holy healing magic spell, warm golden light shimmer, restoration and renewal', duration: 1.5 },
  { key: 'stun_hit', prompt: 'Electric stun shock impact, crackling energy burst, disorienting magical zap', duration: 0.5 },
  { key: 'death', prompt: 'Dark fantasy character death sound, body collapsing to ground, final dramatic breath', duration: 1.5 },
  { key: 'dodge_roll', prompt: 'Fast athletic dodge roll on stone ground, leather armor rustling, quick whoosh movement', duration: 0.5 },
  { key: 'jump_land', prompt: 'Heavy armored warrior landing from jump on stone floor, ground impact thud, boots', duration: 0.5 },
  { key: 'shield_block', prompt: 'Metal shield blocking a heavy sword attack, loud defensive clang, sparks', duration: 0.5 },
  { key: 'ability_ready', prompt: 'Short magical ability charged and ready notification chime, ascending mystical tone', duration: 0.5 },
  { key: 'match_start', prompt: 'Epic dark fantasy arena horn blast, battle drums beginning, warriors prepare for combat', duration: 2 },
  { key: 'victory_sting', prompt: 'Triumphant dark fantasy victory fanfare, short heroic horns and dramatic choir', duration: 2.5 },
  { key: 'defeat_sting', prompt: 'Somber dark fantasy defeat melody, mournful low strings and fading hope', duration: 2.5 },
  { key: 'button_click', prompt: 'Short crisp UI button click, magical stone interface press, subtle', duration: 0.5 },
  { key: 'button_hover', prompt: 'Very soft subtle UI hover sound, gentle magical whisper breath, barely audible', duration: 0.5 },
  { key: 'beam_loop', prompt: 'Continuous dark energy drain beam tether, siphoning magical energy, pulsing dark stream', duration: 3 },
  { key: 'crowd_ambient', prompt: 'Medieval dark fantasy arena crowd ambient background, distant spectators murmuring, torches crackling', duration: 5 },
  { key: 'low_health', prompt: 'Tense heartbeat warning pulse, low health danger indicator, rhythmic pounding getting urgent', duration: 2 },
  { key: 'cc_break', prompt: 'Breaking free from magical chains and bonds, shattering crystal restraints, liberation burst', duration: 1 },
  { key: 'charge_rush', prompt: 'Heavy armored warrior charging forward, rapid footsteps on stone, rushing momentum whoosh', duration: 1 },
];

fs.mkdirSync(OUT_DIR, { recursive: true });

async function generateSFX(entry) {
  const outPath = path.join(OUT_DIR, `${entry.key}.mp3`);
  if (!FORCE && fs.existsSync(outPath)) {
    console.log(`  SKIP ${entry.key} (exists)`);
    return true;
  }

  console.log(`  GEN  ${entry.key} — "${entry.prompt.slice(0, 60)}..."`);

  const resp = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
    method: 'POST',
    headers: {
      'xi-api-key': API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: entry.prompt,
      duration_seconds: entry.duration,
      prompt_influence: 0.3,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error(`  FAIL ${entry.key}: ${resp.status} ${errText.slice(0, 200)}`);
    return false;
  }

  const buffer = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(outPath, buffer);
  const sizeKB = Math.round(buffer.length / 1024);
  console.log(`  OK   ${entry.key} (${sizeKB}KB)`);
  return true;
}

async function main() {
  console.log(`\nElevenLabs SFX Generator`);
  console.log(`Output: ${OUT_DIR}`);
  console.log(`Effects: ${SFX_PROMPTS.length}`);
  console.log(`Force: ${FORCE}\n`);

  let success = 0, fail = 0, skip = 0;

  for (const entry of SFX_PROMPTS) {
    try {
      const existed = !FORCE && fs.existsSync(path.join(OUT_DIR, `${entry.key}.mp3`));
      const ok = await generateSFX(entry);
      if (existed) skip++;
      else if (ok) success++;
      else fail++;
      // Rate limit: 500ms between API calls
      if (!existed) await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.error(`  ERR  ${entry.key}: ${err.message}`);
      fail++;
    }
  }

  console.log(`\nDone: ${success} generated, ${skip} skipped, ${fail} failed`);
}

main();
