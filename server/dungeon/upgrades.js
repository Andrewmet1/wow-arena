// Dungeon upgrades — picked one at a time between rooms from a random pool of 3.
//
// Upgrades are PURE DATA + a single `apply(unit)` function that mutates the
// player's Unit. They stack: same upgrade picked twice doubles its effect.
// Designed to all be additive (no negative trade-offs in v1) so every pick
// feels like progress.
//
// Eight upgrades is enough variety for the v1 demo (3-room run = 3 picks,
// 8C3 = 56 distinct combinations). v2 will expand to ~20 with synergies.

// Upgrades wire directly into the engine's existing stat fields
// (`unit.stats.damageDealtMod`, `damageTakenMod`, `physicalArmor`, etc.)
// rather than custom `dungeon*` properties the engine doesn't read. Earlier
// versions stored e.g. `unit.dungeonDamageMultiplier` which nothing consumed
// — so picks felt cosmetic. Lifesteal is the one exception: it needs an
// event hook fired from DungeonRoom on DAMAGE_DEALT.
export const UPGRADES = {
  bloodlust: {
    id: 'bloodlust',
    name: 'Bloodlust',
    description: '+15% damage on all attacks and abilities.',
    icon: '⚔',
    apply(unit) {
      unit.stats.damageDealtMod = (unit.stats.damageDealtMod || 1) * 1.15;
    },
  },

  ironhide: {
    id: 'ironhide',
    name: 'Ironhide',
    description: '+1500 maximum health. Heals you for the same amount.',
    icon: '🛡',
    apply(unit) {
      unit.maxHp += 1500;
      unit.hp = Math.min(unit.maxHp, unit.hp + 1500);
    },
  },

  swiftness: {
    id: 'swiftness',
    name: 'Swiftness',
    description: '+15% movement speed.',
    icon: '⚡',
    apply(unit) {
      // getEffectiveMoveSpeed reads stats.moveSpeedMultiplier directly.
      unit.stats.moveSpeedMultiplier = (unit.stats.moveSpeedMultiplier || 1) * 1.15;
    },
  },

  focus: {
    id: 'focus',
    name: 'Focus',
    description: '-20% ability cooldowns.',
    icon: '◎',
    apply(unit) {
      // Cooldowns scheduling reads stats.cooldownMod when present; fall back
      // to a flat multiplier the cooldown system can pick up.
      unit.stats.cooldownMod = (unit.stats.cooldownMod || 1) * 0.80;
      unit.dungeonCdMultiplier = unit.stats.cooldownMod; // mirror for UI
    },
  },

  vampiric: {
    id: 'vampiric',
    name: 'Vampiric',
    description: 'Heal for 5% of damage dealt.',
    icon: '🩸',
    apply(unit) {
      // Consumed by DungeonRoom's DAMAGE_DEALT listener (fires server-side
      // on every successful hit, heals the source unit).
      unit.dungeonLifesteal = (unit.dungeonLifesteal || 0) + 0.05;
    },
  },

  bulwark: {
    id: 'bulwark',
    name: 'Bulwark',
    description: '+10% damage reduction from all sources.',
    icon: '🜨',
    apply(unit) {
      // damageTakenMod is the multiplier applied to incoming damage
      // (1.0 = full, 0.9 = 10% less).
      unit.stats.damageTakenMod = (unit.stats.damageTakenMod || 1) * 0.90;
    },
  },

  rolling_thunder: {
    id: 'rolling_thunder',
    name: 'Rolling Thunder',
    description: 'Dodge roll cooldown reduced by 1.5s.',
    icon: '↻',
    apply(unit) {
      unit.dungeonDodgeCdReduction = (unit.dungeonDodgeCdReduction || 0) + 15; // 15 ticks
    },
  },

  second_wind: {
    id: 'second_wind',
    name: 'Second Wind',
    description: 'Restore 20% of max HP at the start of every room.',
    icon: '✣',
    apply(unit) {
      unit.dungeonRoomHealPct = (unit.dungeonRoomHealPct || 0) + 0.20;
    },
  },
};

/**
 * Pick `count` random upgrades from the pool. Optionally exclude IDs the
 * player has already maxed out (we don't gate this in v1 — repeats are fine).
 */
export function rollUpgradeChoices(count = 3, exclude = []) {
  const pool = Object.keys(UPGRADES).filter(id => !exclude.includes(id));
  // Fisher-Yates partial shuffle, take first `count`.
  for (let i = pool.length - 1; i > pool.length - 1 - count && i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(-Math.min(count, pool.length))
    .map(id => UPGRADES[id])
    .map(u => ({ id: u.id, name: u.name, description: u.description, icon: u.icon }));
}

export function applyUpgrade(unit, upgradeId) {
  const upgrade = UPGRADES[upgradeId];
  if (!upgrade) return false;
  upgrade.apply(unit);
  return true;
}
