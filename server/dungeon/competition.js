// Dungeon competition layer — tiers, gear, gems, ladder. Lives alongside
// the existing dungeon code. None of this carries over into PvP arena —
// gear/gems only mod stats while running a dungeon.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const TABLE = process.env.DYNAMO_TABLE || 'EbonCrucible';
const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' })
);

// ── TIER SCALING ─────────────────────────────────────────────────────────
// AI-balanced (gpt-5, scripts/balance-dungeon-tiers.mjs) for skill-clearable
// design — perfect no-gear play beats every tier. Gear/sockets shorten clear
// time, never gate access. Highlights from the balance pass:
//   - Smoother T2/T3 ramp so post-tutorial players don't hit a wall.
//   - T6 gems start at 2 so sockets are online before T7's "socketed
//     baseline" breakpoint.
//   - T9 time limit eased 480→540s to avoid feel-bad timeouts right before T10.
//   - T10 has NO time limit — the leaderboard provides speed-run pressure
//     without making the capstone fail-on-attrition (per Elden Ring pillar).
// TIERS rebalanced for the new multi-chamber / multi-pack density. Previously
// T1 was scaled for ~4 mobs per room. Now wings have 3-4 packs of 2-3 mobs
// (~8-12 mobs per room), so per-mob HP/damage must drop ~50% to keep total
// time-to-clear similar at the same skill level.
// AI-balanced (scripts/balance-dungeon-gear.mjs, gpt-5):
//   - T7-T10 gem ranges tightened so sockets grow steadily instead of exploding
//   - Top-end gems = 4 max (was 5) to preserve long-tail progression value
export const TIERS = {
  1:  { hpScale: 0.55, dmgScale: 0.55, lootMult: 1.00, gemsMin: 0, gemsMax: 0, timeLimitSec: 0 },
  2:  { hpScale: 0.70, dmgScale: 0.65, lootMult: 1.15, gemsMin: 0, gemsMax: 1, timeLimitSec: 0 },
  3:  { hpScale: 0.85, dmgScale: 0.78, lootMult: 1.30, gemsMin: 1, gemsMax: 1, timeLimitSec: 720 },
  4:  { hpScale: 1.05, dmgScale: 0.92, lootMult: 1.50, gemsMin: 1, gemsMax: 2, timeLimitSec: 720 },
  5:  { hpScale: 1.30, dmgScale: 1.10, lootMult: 1.75, gemsMin: 1, gemsMax: 2, timeLimitSec: 600 },
  6:  { hpScale: 1.55, dmgScale: 1.28, lootMult: 2.00, gemsMin: 2, gemsMax: 3, timeLimitSec: 600 },
  7:  { hpScale: 1.85, dmgScale: 1.48, lootMult: 2.35, gemsMin: 2, gemsMax: 3, timeLimitSec: 540 },
  8:  { hpScale: 2.20, dmgScale: 1.70, lootMult: 2.70, gemsMin: 2, gemsMax: 3, timeLimitSec: 540 },
  9:  { hpScale: 2.60, dmgScale: 1.95, lootMult: 3.05, gemsMin: 3, gemsMax: 4, timeLimitSec: 540 },
  10: { hpScale: 3.05, dmgScale: 2.20, lootMult: 3.60, gemsMin: 3, gemsMax: 4, timeLimitSec: 0 },
};

export function getTierConfig(tier) {
  return TIERS[Math.max(1, Math.min(10, tier | 0))] || TIERS[1];
}

// ── GEAR ─────────────────────────────────────────────────────────────────
// Slot list. Gear stats are flat additions to existing engine stats:
//   damage    → unit.stats.damageDealtMod += value
//   armor     → unit.stats.physicalArmor += value (capped by ARMOR_CAP)
//   magicres  → unit.stats.magicDR += value
//   haste     → unit.stats.cooldownMod *= (1 - value)
//   crit      → unit.stats.critChance += value
//   life      → unit.maxHp + value
//   moveSpeed → unit.stats.moveSpeedMultiplier *= (1 + value)
export const GEAR_SLOTS = ['head', 'chest', 'legs', 'weapon', 'offhand', 'trinket'];
export const GEAR_RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

// AI-balanced compressed rarity scale — previously 2.65× at legendary inflated
// affix rolls beyond what felt earnable. New scale is gentler and pairs with
// the 4-affix legendary bump (was 3) for excitement without raw power inflation.
const RARITY_VALUE_SCALE = {
  common:    1.00,
  uncommon:  1.15,
  rare:      1.35,
  epic:      1.60,
  legendary: 1.95,
};
// Tier value scale (raw stat multiplier). T1-T5 grow gradually (1.0→1.75),
// T6-T10 grow MORE GENTLY (1.85→2.40) — the value added at higher tiers is
// shifted from raw stats into ACCESS to better rarity rolls, more affix
// slots, set bonuses, and legendary effects. This means a perfectly-rolled
// T5 epic with set bonuses can compete with T10 gear for specific builds,
// preventing the "everything below T10 is obsolete" treadmill.
const TIER_VALUE_SCALE = {
  1: 1.0, 2: 1.15, 3: 1.30, 4: 1.50, 5: 1.70,
  6: 1.85, 7: 2.00, 8: 2.15, 9: 2.28, 10: 2.40,
};

// AI-balanced stat pool base values — compressed ~50% to keep top-end rolls
// (T10 legendary 4-affix) sane vs player baselines (50-65k HP, 3500-4500 AA dmg).
//
// Each slot now has a CORE pool (always available, balanced base stats) plus
// a SECONDARY pool of niche/conditional/build-defining affixes that unlock
// at uncommon+. This gives every roll real variety without slot homogeneity.
const STAT_POOLS = {
  head:    [{ stat: 'life', base: 800 },  { stat: 'crit', base: 0.015 }, { stat: 'magicres', base: 0.012 }],
  chest:   [{ stat: 'life', base: 1400 }, { stat: 'armor', base: 0.015 }],
  legs:    [{ stat: 'life', base: 1100 }, { stat: 'moveSpeed', base: 0.020 }],
  weapon:  [{ stat: 'damage', base: 0.030 }, { stat: 'crit', base: 0.020 }],
  offhand: [{ stat: 'haste', base: 0.020 }, { stat: 'damage', base: 0.020 }],
  trinket: [{ stat: 'crit', base: 0.025 }, { stat: 'haste', base: 0.020 }, { stat: 'damage', base: 0.020 }],
};

// ── Secondary affix pool (build-defining mods) ──────────────────────────
// These are eligible affixes for uncommon+ rolls. Each affix is more
// situational than core stats and creates real build identity. Affixes are
// applied in the engine via DungeonRoom._applyGearAffixes() when gear is
// equipped (see corresponding handler).
//
// Categories:
//   - PROC: triggered effects ("X% chance on hit to...")
//   - CONDITIONAL: stats that activate under conditions ("damage +X% while below 30% HP")
//   - UTILITY: passive bonuses ("interrupts grant haste for 4s")
//   - LIFESTEAL: sustain ("heal for X% of damage dealt")
//   - REFLECT: counter-attacks ("X% physical damage reflected")
//   - COOLDOWN: ability-specific bonuses
const SECONDARY_AFFIXES = {
  // Weapon-specific build mods
  weapon: [
    { stat: 'cleaveChance', base: 0.10, kind: 'proc',        label: 'Cleave' },
    { stat: 'bleedOnCrit',  base: 0.30, kind: 'proc',        label: 'Bleed on Crit' },
    { stat: 'lifesteal',    base: 0.02, kind: 'lifesteal',   label: 'Lifesteal' },
    { stat: 'execStrike',   base: 0.15, kind: 'conditional', label: 'Execute' },        // +dmg vs <30% HP targets
    { stat: 'critMultiplier', base: 0.20, kind: 'multiplier', label: 'Brutality' },     // crit damage multiplier
    { stat: 'attackSpeed',  base: 0.05, kind: 'stat',        label: 'Attack Speed' },
  ],
  // Offhand: defensive/utility mods
  offhand: [
    { stat: 'block',        base: 0.04, kind: 'stat',        label: 'Block Chance' },
    { stat: 'thornsReflect',base: 0.03, kind: 'reflect',     label: 'Thorns' },
    { stat: 'shieldOnKill', base: 0.04, kind: 'proc',        label: 'Bulwark' },        // % maxHp absorb on kill
    { stat: 'parryChance',  base: 0.04, kind: 'stat',        label: 'Parry' },
    { stat: 'spellPower',   base: 0.04, kind: 'stat',        label: 'Spellpower' },
  ],
  // Head: cognition + magical resilience
  head: [
    { stat: 'manaCost',     base: 0.04, kind: 'reduction',   label: 'Conservation' },   // -% resource costs
    { stat: 'interruptResist', base: 0.30, kind: 'stat',     label: 'Steadfast' },
    { stat: 'tenacity',     base: 0.05, kind: 'stat',        label: 'Tenacity' },       // CC duration reduction
    { stat: 'magicres',     base: 0.020, kind: 'stat',       label: 'Resilience' },     // bigger magic res affix
    { stat: 'visionRange',  base: 0.05, kind: 'utility',     label: 'Far Sight' },      // QoL — see further
  ],
  // Chest: heavy armor / defensive
  chest: [
    { stat: 'damageReduction', base: 0.015, kind: 'stat',    label: 'Hardiness' },
    { stat: 'absorbOnLow',  base: 0.06, kind: 'conditional', label: 'Iron Will' },      // absorb at low HP
    { stat: 'healthRegen',  base: 0.005, kind: 'stat',       label: 'Regeneration' },   // % maxHP/s while OOC
    { stat: 'reviveCharge', base: 1,    kind: 'unique',      label: 'Second Wind' },    // 1 free revive at 30% HP, once/run
  ],
  // Legs: mobility + initiative
  legs: [
    { stat: 'dashCDR',      base: 0.10, kind: 'reduction',   label: 'Quickfoot' },      // -% dash CD
    { stat: 'sprintBurst',  base: 0.15, kind: 'proc',        label: 'Burst' },          // +move speed on hit, 3s
    { stat: 'jumpHeight',   base: 0.25, kind: 'utility',     label: 'Leap' },
    { stat: 'moveSpeed',    base: 0.025, kind: 'stat',       label: 'Swiftness' },
  ],
  // Trinket: catch-all proc / unique modifier slot
  trinket: [
    { stat: 'cdrAura',      base: 0.04, kind: 'stat',        label: 'Focus Aura' },     // -% all CDs
    { stat: 'firstHitDmg',  base: 0.30, kind: 'conditional', label: 'Ambush' },         // +dmg first hit on a target
    { stat: 'killHeal',     base: 0.05, kind: 'proc',        label: 'Bloodthirst' },    // heal % maxHP on kill
    { stat: 'comboBuilder', base: 1,    kind: 'unique',      label: 'Combo Master' },   // +1 max combo points/holy power
    { stat: 'overkillDmg',  base: 0.20, kind: 'proc',        label: 'Overkill' },       // overkill dmg becomes shield
  ],
};

// AI-balanced affix counts — bumped legendary 3→4 + rare 2→3 to give rarity
// tiers distinct identity beyond just bigger numbers.
const RARITY_AFFIX_COUNT = {
  common: 1, uncommon: 2, rare: 3, epic: 3, legendary: 4,
};

// ── Class-biased stat preferences ────────────────────────────────────────
// When rolling gear FOR A SPECIFIC CLASS, weight the affix selection toward
// that class's preferred stats. Each weight is a multiplier applied to a
// stat's selection probability — higher = more likely to roll on this class.
// Stats not listed default to 1.0 (neutral).
//
// Design principles:
//   - Tyrant (warrior):    damage, life, armor — sustained pressure
//   - Wraith (rogue):      crit, haste, damage — burst windows
//   - Infernal (mage):     damage, crit, haste — ranged DPS
//   - Harbinger (warlock): damage, life, haste — DoT pressure + survival
//   - Revenant (paladin):  armor, life, magicres — tank/heal hybrid
//
// Off-class stats stay possible (10-20% relative weight) so loot drops still
// feel exciting — you can still roll crit on a Tyrant, just rarely.
// AI-balanced class weights — off-stat floors raised from 0.3-0.4 to 0.6-0.8
// so "weird but usable" rolls still appear occasionally. Strong bias preserved
// without hard-banning any stat.
const CLASS_STAT_WEIGHTS = {
  tyrant: {
    damage: 3.0, life: 3.0, armor: 3.0,
    crit: 1.0, haste: 1.0, moveSpeed: 1.5, magicres: 1.2,
  },
  wraith: {
    crit: 3.0, haste: 3.0, damage: 2.5,
    life: 1.2, moveSpeed: 1.8, armor: 0.7, magicres: 0.8,
  },
  infernal: {
    damage: 3.0, crit: 3.0, haste: 2.5,
    life: 1.0, moveSpeed: 1.0, armor: 0.6, magicres: 1.5,
  },
  harbinger: {
    damage: 3.0, life: 2.5, haste: 2.5,
    crit: 1.5, moveSpeed: 1.0, armor: 0.8, magicres: 1.5,
  },
  revenant: {
    armor: 3.0, life: 3.0, magicres: 2.5,
    damage: 1.5, crit: 1.0, haste: 1.2, moveSpeed: 0.8,
  },
};

/** Sample N affixes from a slot's pool, weighted by the class's preferences.
 *  For uncommon+ rolls, ~30-50% of affix slots can pull from the secondary
 *  build-defining pool (procs/conditionals/uniques) so every rare+ item has
 *  real build identity, not just bigger numbers. */
function pickClassBiasedAffixes(slotPool, n, classId, rng, slot = null, rarity = 'common') {
  const weights = CLASS_STAT_WEIGHTS[classId] || {};
  // Secondary pool eligibility: uncommon=1 slot, rare=2, epic=2, legendary=3
  const secondaryEligibility = {
    common: 0, uncommon: 1, rare: 2, epic: 2, legendary: 3,
  };
  const maxSecondary = Math.min(secondaryEligibility[rarity] || 0, n);
  const secondaryPool = (slot && SECONDARY_AFFIXES[slot]) ? SECONDARY_AFFIXES[slot] : [];

  // First, pick a random number (0..maxSecondary) of secondary affixes
  const secondaryCount = secondaryPool.length
    ? Math.floor(rng() * (maxSecondary + 1))
    : 0;
  const chosen = [];

  // Pick secondary affixes first (build-defining, exciting on hover)
  const remainingSecondary = [...secondaryPool];
  for (let i = 0; i < secondaryCount && remainingSecondary.length; i++) {
    const idx = Math.floor(rng() * remainingSecondary.length);
    chosen.push(remainingSecondary[idx]);
    remainingSecondary.splice(idx, 1);
  }

  // Fill remaining slots from primary slot pool with class-biased weights
  const remainingPrimary = [...slotPool];
  const primaryNeeded = Math.max(0, n - chosen.length);
  for (let i = 0; i < primaryNeeded && remainingPrimary.length; i++) {
    const totals = remainingPrimary.map(a => weights[a.stat] ?? 1.0);
    const sum = totals.reduce((a, b) => a + b, 0);
    let pick = rng() * sum;
    let idx = 0;
    for (let j = 0; j < remainingPrimary.length; j++) {
      pick -= totals[j];
      if (pick <= 0) { idx = j; break; }
    }
    chosen.push(remainingPrimary[idx]);
    remainingPrimary.splice(idx, 1);
  }
  return chosen;
}

// AI-balanced explicit per-tier cumulative thresholds. Checked legendary →
// epic → rare → uncommon → common. Each value is "roll under this for at
// least this rarity." Numbers feel: T1 mostly common with rare excitement,
// T5-T7 mostly uncommon/rare with epic windows, T10 ~15% legendary chance.
const RARITY_THRESHOLDS = {
  1:  { legendary: 0.00, epic: 0.00, rare: 0.05, uncommon: 0.30 },
  2:  { legendary: 0.00, epic: 0.00, rare: 0.10, uncommon: 0.45 },
  3:  { legendary: 0.00, epic: 0.00, rare: 0.15, uncommon: 0.60 },
  4:  { legendary: 0.00, epic: 0.05, rare: 0.25, uncommon: 0.70 },
  5:  { legendary: 0.00, epic: 0.10, rare: 0.35, uncommon: 0.75 },
  6:  { legendary: 0.00, epic: 0.12, rare: 0.40, uncommon: 0.75 },
  7:  { legendary: 0.00, epic: 0.15, rare: 0.43, uncommon: 0.73 },
  8:  { legendary: 0.04, epic: 0.22, rare: 0.50, uncommon: 0.75 },
  9:  { legendary: 0.10, epic: 0.30, rare: 0.55, uncommon: 0.75 },
  10: { legendary: 0.15, epic: 0.37, rare: 0.62, uncommon: 0.80 },
};
function pickRarityForTier(tier, rng = Math.random) {
  const t = Math.max(1, Math.min(10, tier | 0));
  const thresh = RARITY_THRESHOLDS[t];
  const r = rng();
  if (r < thresh.legendary) return 'legendary';
  if (r < thresh.epic) return 'epic';
  if (r < thresh.rare) return 'rare';
  if (r < thresh.uncommon) return 'uncommon';
  return 'common';
}

/** Roll a piece of gear for a slot at a given tier. When `classId` is given,
 *  affixes are weighted toward that class's preferred stats so a Tyrant is
 *  much more likely to roll damage/life/armor than crit/haste. */
export function rollGear({ slot, tier, themeId = 'crucible_below', classId = null, rng = Math.random }) {
  const rarity = pickRarityForTier(tier, rng);
  const pool = STAT_POOLS[slot] || [];
  const affixCount = Math.min(pool.length, RARITY_AFFIX_COUNT[rarity] || 1);
  // Class-biased affix selection (falls back to flat shuffle if no classId)
  const shuffled = classId
    ? pickClassBiasedAffixes(pool, affixCount, classId, rng, slot, rarity)
    : [...pool].sort(() => rng() - 0.5).slice(0, affixCount);
  const tierMult = TIER_VALUE_SCALE[tier] || 1;
  const rarityMult = RARITY_VALUE_SCALE[rarity] || 1;
  const stats = {};
  for (const { stat, base } of shuffled) {
    const v = base * tierMult * rarityMult * (0.85 + rng() * 0.30);
    stats[stat] = Math.round(v * 1000) / 1000;
  }
  const itemId = 'i_' + Math.random().toString(36).slice(2, 12);
  // Set + legendary unique roll happen here. A set membership replaces the
  // item's display name with the set name. A legendary unique effect is a
  // separate field rendered in the tooltip.
  const setId = rollSetId(rarity, classId, rng);
  const legendaryEffect = rarity === 'legendary' ? rollLegendaryEffect(slot, rng) : null;
  let name = generateGearName({ slot, rarity, themeId });
  if (legendaryEffect) {
    // Legendary unique items use their canonical name instead of a procedural one
    name = legendaryEffect.name;
  } else if (setId) {
    const setDef = SETS[setId];
    name = `${setDef.name} ${SLOT_NOUN[slot] || 'Relic'}`;
  }
  const description = legendaryEffect
    ? legendaryEffect.desc
    : (setId ? SETS[setId].description : generateGearDescription({ slot, rarity }));
  // Pick the icon: legendary effects use their unique icon, set pieces use
  // the set+slot icon, otherwise the default rarity+slot icon.
  let iconUrl;
  if (legendaryEffect) {
    iconUrl = `/assets/art/icons/legendaries/${legendaryEffect.id}.png`;
  } else if (setId) {
    iconUrl = `/assets/art/icons/sets/${setId}_${slot}.png`;
  } else {
    iconUrl = `/assets/art/icons/gear/${rarity}_${slot}.png`;
  }
  return {
    itemId,
    slot,
    rarity,
    tier,
    themeId,
    classId,
    setId,
    legendaryEffectId: legendaryEffect?.id || null,
    legendaryEffectDesc: legendaryEffect?.desc || null,
    name,
    description,
    iconUrl,
    stats,
    rolledAt: new Date().toISOString(),
  };
}

const NAME_PREFIXES = {
  common:    ['Worn', 'Used', 'Old', 'Battered', 'Pitted'],
  uncommon:  ['Dusty', 'Tarnished', 'Forgotten', 'Sun-Bleached', 'Travel-Worn'],
  rare:      ['Cursed', 'Bloodbound', 'Shadowforged', 'Ashen-Wrought', 'Hallowed'],
  epic:      ['Soulrend', 'Voidtouched', 'Ember-Crowned', 'Wraithbound', 'Sanguine'],
  legendary: ['Throneborn', 'Eldritch', 'Crucible-Forged', 'King-Hand', 'God-Marked'],
};
const SLOT_NOUN = {
  head: 'Helm', chest: 'Cuirass', legs: 'Greaves',
  weapon: 'Blade', offhand: 'Sigil', trinket: 'Token',
};
// Themed flavor lines — each rarity has a pool. The slot adds an evocative
// second sentence. Result: every dropped item has a description even if
// rolled by RNG. Tooltip-ready.
const FLAVOR_LINES = {
  common: [
    'A standard-issue piece. Someone wore it; someone died in it.',
    'Plain craftsmanship. Plenty of nicks and dents.',
    'Found discarded in a forgotten alcove.',
  ],
  uncommon: [
    'A trinket from a once-proud guard.',
    'The maker\'s mark is still legible — barely.',
    'Stout work. The smith would have been pleased.',
  ],
  rare: [
    'The runes still cool the touch.',
    'A faint hum, as if remembering its last wearer\'s last words.',
    'It chooses who is allowed to lift it.',
  ],
  epic: [
    'Forged in the year the king first ate his crown.',
    'The metal weeps when wet. The wet stays.',
    'Whoever bore this last — they meant it.',
  ],
  legendary: [
    'A relic of the throne itself. The crown will know it.',
    'Worn by the first who tried. Found in the seventh who failed.',
    'It is older than the war. The war was named after it.',
  ],
};
const SLOT_FLAVOR = {
  head:    'A weight upon the brow. A pact, perhaps.',
  chest:   'Heavier than it looks. Always heavier than it looks.',
  legs:    'They carry you onward. They carry the dead onward too.',
  weapon:  'It has tasted before. It will taste again.',
  offhand: 'Held in the off-hand, but it is not the lesser piece.',
  trinket: 'Small. Patient. Quietly hungry.',
};
function generateGearName({ slot, rarity }) {
  const prefixes = NAME_PREFIXES[rarity] || NAME_PREFIXES.common;
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  return `${prefix} ${SLOT_NOUN[slot] || 'Relic'}`;
}
function generateGearDescription({ slot, rarity }) {
  const lines = FLAVOR_LINES[rarity] || FLAVOR_LINES.common;
  const line = lines[Math.floor(Math.random() * lines.length)];
  return `${line} ${SLOT_FLAVOR[slot] || ''}`.trim();
}

// ── SET BONUSES ─────────────────────────────────────────────────────────
// Each rare/epic/legendary roll can be marked as part of a SET. Wearing
// multiple pieces of the same set grants 2/4/6-piece bonuses with build-
// defining effects (not just bigger stats).
//
// 5 themed sets — each tuned for one class but cross-usable:
//   crimson_wraith     (Wraith)    — burst/stealth/bleed
//   ashen_throne       (Tyrant)    — sustain/cleave/heavy
//   ember_archon       (Infernal)  — burst/cooldown/crit
//   rotbringer         (Harbinger) — dot/lifesteal/regen
//   hollow_paladin     (Revenant)  — defense/group-utility/sustain
//
// Implementation: each set entry has bonuses keyed by piece count. The engine
// reads equipped gear, groups by setId, applies any bonus where setCount >= n.
export const SETS = {
  crimson_wraith: {
    id: 'crimson_wraith',
    name: 'Crimson Wraith',
    classBias: 'wraith',
    description: 'A killer\'s set — built for striking from shadow and bleeding the wounded dry.',
    color: '#a02040',
    bonuses: {
      2: { stat: 'critMultiplier', value: 0.15, label: '+15% crit damage' },
      4: { stat: 'bleedSpread',    value: 1.0,  label: 'Your bleeds spread to enemies within 5u of the target on tick' },
      6: { stat: 'shadowstep',     value: 1.0,  label: 'Killing a target with crit refunds your dodge cooldown' },
    },
  },
  ashen_throne: {
    id: 'ashen_throne',
    name: 'Ashen Throne',
    classBias: 'tyrant',
    description: 'The crown\'s own armor. Heavy, hungry, and never alone in a fight.',
    color: '#8b1a1a',
    bonuses: {
      2: { stat: 'damageReduction', value: 0.05, label: '+5% damage reduction' },
      4: { stat: 'cleaveExpand',    value: 1.0,  label: 'Your auto-attacks cleave to 2 nearby enemies for 40%' },
      6: { stat: 'ragingHeart',     value: 1.0,  label: 'Below 35% HP, gain 30% damage and 20% lifesteal' },
    },
  },
  ember_archon: {
    id: 'ember_archon',
    name: 'Ember Archon',
    classBias: 'infernal',
    description: 'Robes woven from the dying breath of the first flame. Burns hotter the longer you cast.',
    color: '#e85a20',
    bonuses: {
      2: { stat: 'spellPower', value: 0.06, label: '+6% spell power' },
      4: { stat: 'igniteSpread', value: 1.0, label: 'Crit hits ignite — 50% of crit damage as fire DoT over 4s' },
      6: { stat: 'overcharge',  value: 1.0, label: 'Every 4th cast of the same spell costs no resource and crits' },
    },
  },
  rotbringer: {
    id: 'rotbringer',
    name: 'Rotbringer',
    classBias: 'harbinger',
    description: 'Soulbound to the rotting earth. Drain everything. Outlive everything.',
    color: '#4a8830',
    bonuses: {
      2: { stat: 'lifesteal', value: 0.03, label: '+3% lifesteal from periodic damage' },
      4: { stat: 'plagueSpread', value: 1.0, label: 'Your DoTs spread to a random nearby enemy every 4s' },
      6: { stat: 'soulharvest',  value: 1.0, label: 'Each enemy you kill grants +2% maxHP for the rest of the run' },
    },
  },
  hollow_paladin: {
    id: 'hollow_paladin',
    name: 'Hollow Paladin',
    classBias: 'revenant',
    description: 'Faith made armor. The dead king\'s most loyal protector forged this himself.',
    color: '#d4af37',
    bonuses: {
      2: { stat: 'armor', value: 0.04, label: '+4% physical armor' },
      4: { stat: 'aegisShield', value: 0.10, label: 'Whenever you cast a heal, gain absorb equal to 10% maxHP' },
      6: { stat: 'lightfall',   value: 1.0,  label: 'Every 30s, your next ability is critical and heals all allies for 25% maxHP' },
    },
  },
};

/** Roll a set id for a piece of gear — chance scales with rarity. Common gear
 *  has 0% chance, legendary has ~50% chance. Returns null if no set rolled. */
function rollSetId(rarity, classId, rng = Math.random) {
  const chance = {
    common: 0, uncommon: 0.10, rare: 0.20, epic: 0.35, legendary: 0.50,
  }[rarity] || 0;
  if (rng() >= chance) return null;
  // Prefer the class-biased set, fall back to all sets
  const classSet = Object.values(SETS).find(s => s.classBias === classId);
  if (classSet && rng() < 0.70) return classSet.id;
  const all = Object.keys(SETS);
  return all[Math.floor(rng() * all.length)];
}

// ── LEGENDARY UNIQUE EFFECTS ────────────────────────────────────────────
// When a legendary rolls, ~75% of legendaries also roll a UNIQUE EFFECT —
// a named build-defining effect that's separate from stat affixes. These
// are what makes legendary loot exciting beyond "bigger numbers."
export const LEGENDARY_EFFECTS = {
  king_hand: {
    id: 'king_hand', name: 'King\'s Hand',
    slot: 'weapon',
    desc: 'Killing blow returns 8% max HP and increases damage by 15% for 6s.',
  },
  ashen_pact: {
    id: 'ashen_pact', name: 'The Ashen Pact',
    slot: 'trinket',
    desc: 'Damage taken below 25% HP is delayed 3s and returned as physical damage to your attacker.',
  },
  voidmind_circlet: {
    id: 'voidmind_circlet', name: 'Voidmind Circlet',
    slot: 'head',
    desc: 'Every 5 seconds, your next ability costs no resource and refreshes a random spell\'s cooldown.',
  },
  bulwark_of_ages: {
    id: 'bulwark_of_ages', name: 'Bulwark of Ages',
    slot: 'offhand',
    desc: 'Block also reflects 100% of blocked damage as physical damage to the attacker.',
  },
  stormstride_greaves: {
    id: 'stormstride_greaves', name: 'Stormstride Greaves',
    slot: 'legs',
    desc: 'Dashing through enemies stuns them for 1s and grants you 30% damage for 4s.',
  },
  carapace_of_thorns: {
    id: 'carapace_of_thorns', name: 'Carapace of Thorns',
    slot: 'chest',
    desc: 'When struck, deal 100% of damage taken back to attacker as physical damage (5s ICD per enemy).',
  },
  wraithcloak: {
    id: 'wraithcloak', name: 'Wraithcloak',
    slot: 'chest',
    desc: 'Dropping below 20% HP makes you untargetable for 2s. 60s internal cooldown.',
  },
  crucible_forge_blade: {
    id: 'crucible_forge_blade', name: 'Crucible-Forge Blade',
    slot: 'weapon',
    desc: 'Your auto-attacks cleave through all enemies in a 5u cone for 65% damage.',
  },
  soulharvest_sigil: {
    id: 'soulharvest_sigil', name: 'Soulharvest Sigil',
    slot: 'offhand',
    desc: 'Each enemy you kill in the same room grants a stacking +3% damage. Resets on room clear.',
  },
  ember_crown: {
    id: 'ember_crown', name: 'Ember Crown',
    slot: 'head',
    desc: 'Your crits ignite the target for 40% damage over 5s. Multiple ignites stack.',
  },
  ring_of_seven_falls: {
    id: 'ring_of_seven_falls', name: 'Ring of Seven Falls',
    slot: 'trinket',
    desc: 'The first 7 hits you take per room are reduced by 40% damage.',
  },
  godsblood_amulet: {
    id: 'godsblood_amulet', name: 'Godsblood Amulet',
    slot: 'trinket',
    desc: 'Your healing also grants the target an absorb shield equal to 50% of the heal for 6s.',
  },
  thronebreaker_pauldrons: {
    id: 'thronebreaker_pauldrons', name: 'Thronebreaker Pauldrons',
    slot: 'chest',
    desc: 'Every 30s, your next damaging ability deals +200% damage.',
  },
  warders_signet: {
    id: 'warders_signet', name: 'Warder\'s Signet',
    slot: 'trinket',
    desc: 'Interrupting an enemy cast grants 15% haste for 8s and 25% magic resist for 4s.',
  },
  hollow_kings_boots: {
    id: 'hollow_kings_boots', name: 'Hollow King\'s Boots',
    slot: 'legs',
    desc: 'Standing still for 2s grants 50% damage reduction. Lost when you move.',
  },
};

/** When a legendary rolls, ~75% chance to also receive a unique effect.
 *  Effect is filtered to the item's slot (or generic). */
function rollLegendaryEffect(slot, rng = Math.random) {
  if (rng() >= 0.75) return null;
  const eligible = Object.values(LEGENDARY_EFFECTS).filter(e => e.slot === slot);
  if (!eligible.length) return null;
  return eligible[Math.floor(rng() * eligible.length)];
}

// ── GEMS / SOCKETS ───────────────────────────────────────────────────────
// Gems are permanent character progression — once socketed, the bonus is
// always active (PvE only, never PvP). A spec has 6 socket slots. Each
// socketed gem provides a flat % bonus that doesn't carry to arena.
export const GEM_TIERS = ['common', 'rare', 'mythic'];
// AI-balanced gem values — compressed ~40% so a single mythic gem (~3.5% dmg,
// 2.8% crit/haste, 1800 life) is meaningful but slower than per-run gear
// spikes. Sockets become long-tail horizontal progression.
const GEM_VALUE = {
  common: { damage: 0.012, life: 500,  haste: 0.008, crit: 0.008, armor: 0.007 },
  rare:   { damage: 0.024, life: 1000, haste: 0.016, crit: 0.016, armor: 0.014 },
  mythic: { damage: 0.035, life: 1800, haste: 0.028, crit: 0.028, armor: 0.022 },
};
const GEM_STAT_NAMES = {
  damage: 'Bloodgem',  life: 'Lifegem',  haste: 'Hastegem',
  crit:   'Critgem',   armor: 'Aegisgem',
};

const GEM_FLAVOR = {
  common: 'A small stone. Useful enough.',
  rare:   'It hums faintly when held. Something inside is awake.',
  mythic: 'A relic-grade gem. The light it sheds remembers something.',
};
export function rollGem({ tier, rng = Math.random }) {
  const gemTier = tier >= 9 ? (rng() < 0.30 ? 'mythic' : 'rare')
                : tier >= 6 ? (rng() < 0.50 ? 'rare' : 'common')
                : 'common';
  const stats = Object.keys(GEM_VALUE[gemTier]);
  const stat = stats[Math.floor(rng() * stats.length)];
  const baseName = GEM_STAT_NAMES[stat] || 'Gem';
  const prefix = gemTier === 'mythic' ? 'Mythic ' : gemTier === 'rare' ? 'Rare ' : '';
  return {
    gemId: 'g_' + Math.random().toString(36).slice(2, 12),
    rarity: gemTier,
    stat,
    value: GEM_VALUE[gemTier][stat],
    name: `${prefix}${baseName}`,
    description: GEM_FLAVOR[gemTier] || GEM_FLAVOR.common,
    iconUrl: `/assets/art/icons/gems/${gemTier}_${stat}.png`,
    rolledAt: new Date().toISOString(),
  };
}

// ── INVENTORY (DynamoDB) ─────────────────────────────────────────────────
// PK: PLAYER#<sub>  SK: GEAR_INV — single record holding all gear + sockets
const INV_SK = 'GEAR_INV';

export async function getInventory(sub) {
  const { Item } = await client.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `PLAYER#${sub}`, SK: INV_SK },
  }));
  return Item || { PK: `PLAYER#${sub}`, SK: INV_SK, gear: [], gems: [], socketed: {}, equipped: {} };
}

/** Equip / unequip a gear piece into a slot for a class. */
export async function equipGear(sub, classId, slot, itemId) {
  const inv = await getInventory(sub);
  inv.equipped = inv.equipped || {};
  inv.equipped[classId] = inv.equipped[classId] || {};
  if (itemId == null) delete inv.equipped[classId][slot];
  else inv.equipped[classId][slot] = itemId;
  await client.send(new PutCommand({ TableName: TABLE, Item: inv }));
}

/** Socket / unsocket a gem at a 0..5 slot index for a class. */
export async function socketGem(sub, classId, slotIndex, gemId) {
  const inv = await getInventory(sub);
  inv.socketed = inv.socketed || {};
  const list = inv.socketed[classId] || [];
  while (list.length < 6) list.push(null);
  const idx = Math.max(0, Math.min(5, slotIndex | 0));
  list[idx] = gemId == null ? null : gemId;
  inv.socketed[classId] = list;
  await client.send(new PutCommand({ TableName: TABLE, Item: inv }));
}

export async function loadEquippedGearAndSockets(sub, classId) {
  const inv = await getInventory(sub);
  const equipped = inv.equipped?.[classId] || {};
  const socketed = inv.socketed?.[classId] || []; // up to 6 gemIds
  const gearById = {};
  for (const g of (inv.gear || [])) gearById[g.itemId] = g;
  const gemById = {};
  for (const g of (inv.gems || [])) gemById[g.gemId] = g;
  return {
    equipped: Object.fromEntries(
      Object.entries(equipped)
        .map(([slot, id]) => [slot, gearById[id] || null])
        .filter(([, item]) => item)
    ),
    sockets: socketed.map(id => gemById[id] || null).filter(Boolean),
  };
}

export async function addGearAndGems(sub, gear = [], gems = []) {
  const inv = await getInventory(sub);
  inv.gear = (inv.gear || []).concat(gear);
  inv.gems = (inv.gems || []).concat(gems);
  await client.send(new PutCommand({ TableName: TABLE, Item: inv }));
}

/** Vendor sell-back price for a piece of gear. Scales by rarity + tier so
 *  legendary T10 isn't worth the same as common T1. Legendaries pay roughly
 *  10x common rates so finding a duplicate legendary still feels rewarding. */
const SELL_RARITY_VALUE = {
  common: 8, uncommon: 18, rare: 40, epic: 90, legendary: 220,
};
export function sellPriceForGear(gear) {
  if (!gear) return 0;
  const base = SELL_RARITY_VALUE[gear.rarity] || 0;
  const tierMult = 1 + ((gear.tier || 1) - 1) * 0.15;
  return Math.round(base * tierMult);
}

/** Sell a piece of gear from the player's inventory. Verifies the gear
 *  exists + isn't currently equipped on any class. Returns { soldPrice,
 *  newBalance } on success or { error } on failure. */
export async function sellGear(sub, itemId) {
  const inv = await getInventory(sub);
  const gear = (inv.gear || []).find(g => g.itemId === itemId);
  if (!gear) return { error: 'Item not in inventory.' };
  // Block selling currently-equipped pieces — protect against accidentally
  // selling the player's active loadout.
  const equipped = inv.equipped || {};
  for (const classId of Object.keys(equipped)) {
    for (const slot of Object.keys(equipped[classId] || {})) {
      if (equipped[classId][slot] === itemId) {
        return { error: 'Unequip from ' + classId + ' first.' };
      }
    }
  }
  const price = sellPriceForGear(gear);
  inv.gear = inv.gear.filter(g => g.itemId !== itemId);
  await client.send(new PutCommand({ TableName: TABLE, Item: inv }));
  // Bank the coins via the existing wallet path.
  const { awardCoins, getProfile } = await import('../db.js');
  await awardCoins(sub, price);
  const profile = await getProfile(sub).catch(() => null);
  return { soldPrice: price, newBalance: profile?.coins ?? null, itemName: gear.name };
}

// ── LADDER ───────────────────────────────────────────────────────────────
// Per (class, tier, partySize) leaderboard sorted by clear time ASC.
// PK: LADDER#<class>#<tier>#<partySize>   SK: <ms padded>#<runId>
// Records the run as an item with the player's username so we don't have
// to do a profile lookup on every leaderboard query.
export async function recordLadderEntry({
  sub, username, classId, tier, partySize, durationMs, themeId, partyMembers = [],
}) {
  if (!sub || !classId || !tier || !partySize || !durationMs) return;
  const padded = String(durationMs).padStart(10, '0'); // sorts ascending by time
  const runId = Math.random().toString(36).slice(2, 12);
  const item = {
    PK: `LADDER#${classId}#${tier}#${partySize}`,
    SK: `${padded}#${runId}`,
    sub, username, classId, tier, partySize,
    durationMs, themeId,
    partyMembers,
    timestamp: new Date().toISOString(),
  };
  await client.send(new PutCommand({ TableName: TABLE, Item: item }));
}

/** Highest cleared tier per class for a player. Used to gate tier picker:
 *  T2 unlocks once T1 is cleared, etc. Walks ladder records — single query
 *  is cheap because each player has at most 10 entries. */
export async function getPlayerProgression(sub) {
  const out = { byClass: {}, totalRuns: 0, bestTimesByClassTier: {} };
  if (!sub) return out;
  // Scan player's MATCH/DUNGEON history (per-player records — not the
  // global LADDER PK). Use the existing PLAYER#sub partition.
  const resp = await client.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `PLAYER#${sub}`, ':prefix': 'DUNGEON#' },
  }));
  for (const r of (resp.Items || [])) {
    out.totalRuns++;
    if (r.result !== 'victory') continue;
    const c = r.classId, t = r.tier || 1;
    if (!out.byClass[c] || t > out.byClass[c]) out.byClass[c] = t;
    const key = `${c}_${t}`;
    const ms = (r.durationSec || 0) * 1000;
    if (ms > 0 && (!out.bestTimesByClassTier[key] || ms < out.bestTimesByClassTier[key])) {
      out.bestTimesByClassTier[key] = ms;
    }
  }
  return out;
}

export async function getLadder({ classId, tier, partySize = 1, limit = 20 }) {
  const resp = await client.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': `LADDER#${classId}#${tier}#${partySize}` },
    Limit: limit,
    ScanIndexForward: true, // ascending — fastest first
  }));
  return (resp.Items || []).map(it => ({
    rank: 0, // filled by caller
    sub: it.sub, username: it.username,
    classId: it.classId, tier: it.tier, partySize: it.partySize,
    durationMs: it.durationMs,
    durationSec: Math.round(it.durationMs / 1000),
    timestamp: it.timestamp,
  })).map((r, i) => ({ ...r, rank: i + 1 }));
}
