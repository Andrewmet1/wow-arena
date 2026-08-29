// Dungeon monster archetypes.
//
// PHASE 1 (now): each monster maps to an existing player class skeleton with
// stat overrides + a slim ability list. Lets us build the gameplay loop with
// the assets we already have, then swap to proper Meshy-generated meshes
// later by changing only `baseClassId` (or adding `modelOverride`).
//
// Each monster's `abilities` is a whitelist applied AFTER the class is loaded —
// the unit only receives those, plus auto-attack. Keeps movesets tight and
// PvE-appropriate (no random buff stacks, no full PvP toolkits).
//
// `aiBehavior` is a tag the DungeonAI module uses to pick which decision tree
// runs. See server/dungeon/DungeonAI.js.

export const MONSTERS = {
  // ── Mob tier ──────────────────────────────────────────────────────
  // ── Trash tier ─ smaller than player, fall in 1-2 hits ────────────
  carrion_knight: {
    id: 'carrion_knight',
    name: 'Carrion Knight',
    lore: 'Husks of fallen warriors, bound to ancient oaths they no longer remember.',
    baseClassId: 'tyrant',
    modelScale: 0.78,            // distinctly smaller than the player (1.0)
    statOverrides: {
      hpMultiplier: 0.30,
      autoAttackDamage: 1500,
      moveSpeedMultiplier: 0.92,
      swingTimer: 24,
    },
    abilities: [],
    aiBehavior: 'aggressive_melee',
    difficulty: 1,
  },

  bone_cultist: {
    id: 'bone_cultist',
    name: 'Bone Cultist',
    lore: 'Robed acolytes who traded their tongues for the whispers of the void.',
    baseClassId: 'harbinger',
    modelScale: 0.80,
    statOverrides: {
      hpMultiplier: 0.25,
      autoAttackDamage: 0,
      moveSpeedMultiplier: 0.85,
    },
    abilities: ['shadow_bolt'],
    aiBehavior: 'kite_caster',
    difficulty: 1,
  },

  hellhound: {
    id: 'hellhound',
    name: 'Hellhound',
    lore: 'Charcoal-furred beasts that hunt by the scent of fresh sorrow.',
    baseClassId: 'wraith',
    modelScale: 0.72,            // smallest trash
    statOverrides: {
      hpMultiplier: 0.28,
      autoAttackDamage: 1300,
      moveSpeedMultiplier: 1.25,
      swingTimer: 18,
    },
    abilities: [],
    aiBehavior: 'charger',
    difficulty: 2,
  },

  // ── Elite tier ─ noticeably larger, threatening posture ───────────
  drudgekin_brute: {
    id: 'drudgekin_brute',
    name: 'Drudgekin Brute',
    lore: 'Misshapen warbeasts forged in the lower forges of the Crucible.',
    baseClassId: 'tyrant',
    modelScale: 1.45,            // hulking elite
    statOverrides: {
      hpMultiplier: 1.40,
      autoAttackDamage: 3500,
      moveSpeedMultiplier: 0.75,
      swingTimer: 32,
    },
    abilities: ['ground_slam'],
    aiBehavior: 'tank_brute',
    difficulty: 3,
  },

  wraith_specter: {
    id: 'wraith_specter',
    name: 'Wraith Specter',
    lore: 'Half-formed echoes of those who died in the Crucible without a name.',
    baseClassId: 'wraith',
    modelScale: 1.20,            // elite — towering apparition
    statOverrides: {
      hpMultiplier: 0.85,
      autoAttackDamage: 1800,
      moveSpeedMultiplier: 1.05,
      swingTimer: 20,
    },
    abilities: ['shadow_step'],
    aiBehavior: 'evasive_striker',
    difficulty: 3,
  },

  // ── Boss tier ─────────────────────────────────────────────────────
  ashen_warlord: {
    id: 'ashen_warlord',
    name: 'The Ashen Warlord',
    lore: 'The first king to enter the Crucible. He has not left.',
    baseClassId: 'tyrant',
    modelScale: 1.5,
    statOverrides: {
      hpMultiplier: 4.5,         // boss HP
      autoAttackDamage: 4500,
      moveSpeedMultiplier: 0.85,
      swingTimer: 22,
    },
    // Boss kit — four distinct attacks with clear telegraphs. The DungeonAI
    // boss_warlord branch picks randomly from these per cast, prefering ones
    // not used recently so the player sees variety run-to-run (Dark Souls).
    //   crushing_descent — leap with windup, lands as AOE (dodge by spacing)
    //   iron_cyclone     — whirlwind self-buff, lethal in melee (kite or interrupt)
    //   warbringer_rush  — charge from range (sidestep when committed)
    //   thunder_spike    — stun bolt (interrupt or LOS)
    abilities: ['crushing_descent', 'iron_cyclone', 'warbringer_rush', 'thunder_spike'],
    aggroRadius: 50,             // boss aggros across whole room — no idle posture
    aiBehavior: 'boss_warlord',
    difficulty: 5,
    isBoss: true,
  },
};

/**
 * Build a unit-like config object for the engine to spawn a monster.
 * Returns null if the monster id is unknown.
 */
export function getMonsterConfig(monsterId) {
  return MONSTERS[monsterId] || null;
}
