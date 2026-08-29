#!/usr/bin/env node
// AI-driven balance pass for dungeon tier scaling. Reads the current TIERS
// table from server/dungeon/competition.js + the player class baselines and
// asks GPT-5 to validate / tweak the numbers so:
//   1. Every tier is skill-clearable WITHOUT gear (Elden Ring style — perfect
//      play beats it, gear just makes it faster).
//   2. Tier 1 ≈ "first attempt should win", tier 10 ≈ "0.1% of players".
//   3. Loot/gem drops feel proportional to time invested.
//   4. Time limits push speed-running without forcing a sprint at low tiers.
//
// Output: prints a JSON suggestion block. You decide whether to merge.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8');
const KEY = env.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();

const competitionSrc = fs.readFileSync(path.join(ROOT, 'server/dungeon/competition.js'), 'utf-8');
const classRegistrySnapshot = `
Tyrant: maxHp 65000, autoAttackDamage 3500, ragePerSwing 5
Wraith: maxHp 50000, autoAttackDamage 4500, comboPoints 5 max
Infernal: maxHp 50000, mana 1000, autoAttackDamage 0 (caster)
Harbinger: maxHp 55000, soul shards 5 max
Revenant: maxHp 65000, holy power 5 max, plate armor
`;

const prompt = `You are balancing a Mythic+-style dungeon mode for a multiplayer arena game. The dungeon is solo. Player picks T1–T10. Each tier scales monster HP and damage.

DESIGN PILLARS:
- Skill-clearable like Elden Ring: a perfect player with NO gear should be able to clear T10 with skill alone. Gear/gems make it faster, not possible.
- T1 = first attempt should usually win for any player who finished the tutorial.
- T5 = competitive ladder floor. Clearable in ~10 min with average skill + some gear.
- T10 = top 0.1%. Designed around speed-runs.

CURRENT BASELINE (from server/dungeon/competition.js):
${competitionSrc.match(/export const TIERS = {[\s\S]*?};/m)?.[0] || '(missing)'}

PLAYER CLASS BASELINES:
${classRegistrySnapshot}

OTHER CONTEXT:
- 7-room dungeon: 6 combat + 1 boss
- Per-room scaling: HP +18%/room, damage +10%/room, boss +100% HP / +50% dmg on top
- So tier 10 boss in room 7 is hpScale * (1 + 6*0.18 + 1.0) = TIERS[10].hpScale * 3.08
- Combined T10 boss HP = base monster HP * 5.40 * 3.08 = ~16.6× baseline. Is this too tanky?
- Player has dodge roll with 6 ticks (0.6s) of i-frames
- Boss casts have 1.5s telegraph windows now (Elden Ring read-and-react)
- Loot: T1 = 1 gear / 0 gems. T5 = 1 gear / 1-2 gems. T10 = 1-2 gear / 3-5 gems.
- Gear stats: % damage, % crit, % haste, flat HP, etc — bonuses up to ~+10% per piece at top tiers.

TASK:
Look at TIERS table. Suggest specific value changes (if needed) so the design pillars hold. Specifically check:
- Is T10 too tanky/lethal for a no-gear skill clear?
- Is the T1 → T2 → T3 progression smooth or too steep?
- Are gem drop ranges correct for "T7 = clear-able with sockets, push-able further"?
- Are time limits too tight / too loose?

OUTPUT FORMAT — strictly JSON, no prose:
{
  "diagnosis": "1-3 sentences",
  "suggested_tiers": { "1": {...}, "2": {...}, ..., "10": {...} },
  "notes": ["specific design notes about each problematic tier"]
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
  console.error('OpenAI error:', JSON.stringify(d).slice(0, 500));
  process.exit(1);
}
console.log(d.choices[0].message.content);
