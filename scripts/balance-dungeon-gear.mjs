#!/usr/bin/env node
// AI balance audit of the dungeon gear / gem / drop-rate / tier system.
// Reads the current competition.js + DungeonRoom.js drop logic, sends to
// gpt-5, gets specific recommendations.
//
// Output: prints JSON report. Apply changes manually.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const KEY = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8').match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();

const competitionSrc = fs.readFileSync(path.join(ROOT, 'server/dungeon/competition.js'), 'utf-8');
const dungeonRoomSrc = fs.readFileSync(path.join(ROOT, 'server/dungeon/DungeonRoom.js'), 'utf-8');

// Extract just the relevant sections to keep prompt size manageable
const tiers = competitionSrc.match(/export const TIERS = {[\s\S]*?};/m)?.[0] || '(not found)';
const rarityScale = competitionSrc.match(/const RARITY_VALUE_SCALE = {[\s\S]*?};/m)?.[0] || '';
const tierScale = competitionSrc.match(/const TIER_VALUE_SCALE = {[\s\S]*?};/m)?.[0] || '';
const statPools = competitionSrc.match(/const STAT_POOLS = {[\s\S]*?};/m)?.[0] || '';
const rarityAffix = competitionSrc.match(/const RARITY_AFFIX_COUNT = {[\s\S]*?};/m)?.[0] || '';
const classWeights = competitionSrc.match(/const CLASS_STAT_WEIGHTS = {[\s\S]*?};/m)?.[0] || '';
const gemValue = competitionSrc.match(/const GEM_VALUE = {[\s\S]*?};/m)?.[0] || '';
const pickRarity = competitionSrc.match(/function pickRarityForTier[\s\S]*?return 'common';\s*}/m)?.[0] || '';
const mobDrop = dungeonRoomSrc.match(/\/\/ Per-mob gear drop chance[\s\S]*?_sendToPlayer\({[\s\S]*?\);\s*\}\);/m)?.[0] || '';
const bossLoot = dungeonRoomSrc.match(/_rollBossLoot\(\) {[\s\S]*?return { gear, gems };\s*}/m)?.[0] || '';

const prompt = `You are balancing the loot + gear + gem economy for a Mythic+ style dungeon mode. The player descends 5 rooms (4 combat + 1 boss). Each combat room has 3-4 mob packs of 2-3 mobs each. The run is solo. Player picks tier 1-10.

DESIGN PILLARS:
- Skill-clearable: a perfect no-gear player can clear T10. Gear/gems make it faster.
- Loot drops should feel exciting — not too rare (player gives up) or too common (no thrill).
- Higher tier = better drop chance + better rarity.
- Class-biased: a Tyrant should rarely roll mage stats and vice versa.
- Gems are permanent character progression; gear is per-spec for now.

CURRENT NUMBERS:

TIER scaling (HP/dmg/loot/gems/timeLimit):
${tiers}

Rarity value scale (multiplied into affix values):
${rarityScale}

Tier value scale (multiplied into affix values):
${tierScale}

Per-slot stat pools (base values):
${statPools}

Rarity → affix count:
${rarityAffix}

Class stat weights (3.0 = preferred, 1.0 = neutral, 0.3 = rare):
${classWeights}

Rarity roll function (per tier):
${pickRarity}

Gem value scale (per rarity per stat):
${gemValue}

PER-MOB GEAR DROP LOGIC:
${mobDrop}

BOSS LOOT ROLL:
${bossLoot}

OTHER CONTEXT:
- Player baselines: 50000-65000 HP, 3500-4500 auto-attack damage
- A T1 run = ~8-15 mob kills + 1 boss
- A T10 run = same mob count but mobs ~3x HP/dmg

TASK:
1. Audit drop rates. Is 2.5%/12% trash/elite + +0.8% per tier the right curve? At T1 a run = ~12 mobs × 2.5% + 1 elite × 12% + 1 boss × 100% = ~42% chance of any mob drop + guaranteed boss drop. At T10 = ~10.5% × 11 + 20% + 100% = ~235% mob drops + boss. Does that feel right?
2. Audit rarity curve. Currently legendary needs tier 9+ AND 18% roll. Too rare? Just right?
3. Audit class weight bias. Are the weights (3.0 preferred, 0.3-0.8 hated) too extreme or about right?
4. Audit gem values vs gear values. Are gems too weak/strong relative to gear?
5. Are stat pools balanced — does crit/haste/damage scale comparably?
6. Anything else off?

OUTPUT FORMAT — strict JSON, no prose outside it:
{
  "diagnosis": "1-3 sentences",
  "tier_changes": {},
  "rarity_changes": {},
  "stat_pool_changes": {},
  "class_weight_changes": {},
  "gem_value_changes": {},
  "drop_rate_changes": { "trashBaseChance": null, "eliteBaseChance": null, "tierBonusPerLevel": null },
  "rarity_threshold_changes": {},
  "notes": ["specific actionable notes"]
}`;

const r = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
  body: JSON.stringify({
    model: 'gpt-5',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
  }),
});
const d = await r.json();
if (!r.ok) {
  console.error('OpenAI error:', JSON.stringify(d).slice(0, 600));
  process.exit(1);
}
console.log(d.choices[0].message.content);
