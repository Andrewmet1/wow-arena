// Core timing — 10Hz simulation (100ms per tick)
export const TICK_RATE = 100; // ms per tick
export const TICKS_PER_SECOND = 1000 / TICK_RATE; // 10
export const GCD_DURATION = 15; // 1.5s in ticks

// Match limits
export const MAX_MATCH_TICKS = 6000; // 10 minutes
export const MATCH_TIMEOUT_TICKS = MAX_MATCH_TICKS;

// Combat
export const BASE_CRIT_CHANCE = 0.10;
export const CRIT_MULTIPLIER_DIRECT = 2.0;
export const CRIT_MULTIPLIER_DOT = 1.5;
export const ARMOR_CAP = 0.70;
export const MAGIC_DR_CAP = 0.50;
export const BASE_HP = 100000;
export const CLASS_HP = {
  tyrant: 125000,
  revenant: 115000,
  harbinger: 112000,
  wraith: 105000,
  infernal: 115000,
};
export const PUSHBACK_AMOUNT_TICKS = 5; // 0.5s
export const MAX_PUSHBACKS = 2;

// Auto-attack
export const MELEE_RANGE = 5;
export const DEFAULT_SWING_TIMER = 20; // 2.0s in ticks

// DR system
export const DR_RESET_TICKS = 180; // 18 seconds
export const DR_DURATIONS = [1.0, 0.5, 0.25, 0]; // 100%, 50%, 25%, immune

export const DR_CATEGORY = {
  STUN: 'stun',
  ROOT: 'root',
  DISORIENT: 'disorient',
  INCAPACITATE: 'incapacitate',
  SILENCE: 'silence'
};

// Spell schools
export const SCHOOL = {
  PHYSICAL: 'physical',
  FIRE: 'fire',
  FROST: 'frost',
  ARCANE: 'arcane',
  SHADOW: 'shadow',
  HOLY: 'holy'
};

// Unit states
export const UNIT_STATE = {
  IDLE: 'idle',
  CASTING: 'casting',
  CHANNELING: 'channeling',
  STUNNED: 'stunned',
  FEARED: 'feared',
  INCAPACITATED: 'incapacitated',
  ROOTED: 'rooted',
  SILENCED: 'silenced',
  DEAD: 'dead'
};

// CC types
export const CC_TYPE = {
  STUN: 'stun',       // Cannot act, cannot move
  ROOT: 'root',       // Cannot move, can cast
  FEAR: 'fear',       // Cannot act, moves randomly
  DISORIENT: 'disorient', // Cannot act, breaks on damage
  INCAPACITATE: 'incapacitate', // Cannot act, breaks on any damage
  SILENCE: 'silence'  // Cannot cast spells, can move and melee
};

// Ability flags
export const ABILITY_FLAG = {
  INSTANT: 'instant',
  CAST: 'cast',
  CHANNEL: 'channel',
  MELEE: 'melee',
  RANGED: 'ranged',
  REQUIRES_STEALTH: 'requires_stealth',
  USABLE_WHILE_CASTING: 'usable_while_casting',
  USABLE_WHILE_MOVING: 'usable_while_moving',
  USABLE_WHILE_CC: 'usable_while_cc',
  BREAKS_ON_DAMAGE: 'breaks_on_damage',
  IGNORES_ARMOR: 'ignores_armor',
  IGNORES_GCD: 'ignores_gcd',
  GUARANTEED_CRIT: 'guaranteed_crit',
  CANNOT_BE_INTERRUPTED: 'cannot_be_interrupted'
};

// Resource types
export const RESOURCE_TYPE = {
  RAGE: 'rage',
  ENERGY: 'energy',
  MANA: 'mana',
  COMBO_POINTS: 'combo_points',
  HOLY_POWER: 'holy_power',
  CINDER_STACKS: 'cinder_stacks',
  SOUL_SHARDS: 'soul_shards'
};

// Aura types
export const AURA_TYPE = {
  BUFF: 'buff',
  DEBUFF: 'debuff',
  DOT: 'dot',
  HOT: 'hot',
  ABSORB: 'absorb'
};

// Movement
// WoW runs at 7 yards/sec and the arena is built around that pace. At 14 the
// 80-yard arena crossed in 5.7s instead of 11.4s, which halved the time
// pillars and line-of-sight are worth anything — the spatial layer arena play
// is actually made of. It also outran the run animation by ~5x (see
// RUN_CLIP_YPS), which is what read as floaty.
export const BASE_MOVE_SPEED = 7; // yards per second (WoW parity)
export const MOVE_SPEED_PER_TICK = BASE_MOVE_SPEED / TICKS_PER_SECOND;

// Dodge roll
export const DODGE_ROLL_DISTANCE = 8;    // yards (increased for meaningful kiting)
export const DODGE_ROLL_DURATION = 4;     // ticks (0.4s)
export const DODGE_ROLL_COOLDOWN = 50;    // ticks (5s)
export const DODGE_ROLL_IMMUNITY = 4;     // ticks (0.4s)
export const DODGE_ROLL_SNARE = 0.5;      // 50% slow applied to nearby enemies
export const DODGE_ROLL_SNARE_RANGE = 8;  // yards — enemies within this range get snared
export const DODGE_ROLL_SNARE_DURATION = 20; // ticks (2s)

// Arena
export const ARENA_RADIUS = 40;
export const PILLAR_RADIUS = 1.5;
export const PILLAR_POSITIONS = [
  { x: 20, z: 20 },
  { x: -20, z: 20 },
  { x: 20, z: -20 },
  { x: -20, z: -20 }
];

// AI difficulty
export const AI_DIFFICULTY = {
  EASY: 'easy',
  MEDIUM: 'medium',
  HARD: 'hard',
  SIM: 'sim'
};

// Arena dampening (healing reduction over time)
// Dampening exists to end stalemates, not to shape the opening. Starting at
// 60s meant healing was taxed from the first minute of every match and capped
// out around the seventh; 180s lets a match play out first.
export const DAMPENING_START_TICK = 1800;  // Starts at 180s
export const DAMPENING_PER_INTERVAL = 0.02; // 2% per interval
export const DAMPENING_INTERVAL_TICKS = 100; // Every 10s
export const DAMPENING_CAP = 0.75;          // Max 75% healing reduction

// Balance simulation
export const BALANCE_MATCHES_PER_MATCHUP = 2000;
export const BALANCE_WIN_RATE_TARGET = 0.50;
export const BALANCE_WIN_RATE_TOLERANCE = 0.03;
export const BALANCE_MAX_ITERATIONS = 50;
export const BALANCE_ADJUSTMENT_RATE = 0.03;
export const BALANCE_MAX_STAT_DEVIATION = 0.40;

// ── Free skins ──────────────────────────────────────────────────────────
//
// One skin per class that every player owns without buying it. Shared by the
// client (so the UI shows it unlocked) and the server (so equipping it passes
// validation) — the two check ownership independently, and a list that lived
// in only one of them would either show a locked skin as available or reject
// an equip the UI had already offered.
//
// Stored as skinId per class; the inventory item id is derived, so the naming
// convention lives in one place.
export const FREE_SKINS = {
  tyrant:    'ashen_overlord',
  wraith:    'frozen_reaper',
  infernal:  'frost_dragon_skeleton_inspired_ice_wizar',
  harbinger: 'frozen_ice_dragon_skeleton_warlock',
  revenant:  'frozen_ice_holy_paladin_fallen_dragon',
};

/** Inventory item id for a class skin. One definition, both sides. */
export function skinItemId(classId, skinId) {
  return `skin_${classId}_${skinId}`;
}

/** Is this skin free for everyone? */
export function isFreeSkin(classId, skinId) {
  return !!classId && FREE_SKINS[classId] === skinId;
}

/** Every free skin as an inventory item id — for merging into a UI's owned set. */
export function freeSkinItemIds() {
  return Object.entries(FREE_SKINS).map(([c, s]) => skinItemId(c, s));
}
