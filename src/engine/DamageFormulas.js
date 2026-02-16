import {
  SCHOOL, ARMOR_CAP, MAGIC_DR_CAP,
  BASE_CRIT_CHANCE, CRIT_MULTIPLIER_DIRECT, CRIT_MULTIPLIER_DOT
} from '../constants.js';

export function calculateDamage(baseDamage, school, source, target, rng, options = {}) {
  const {
    ignoresArmor = false,
    guaranteedCrit = false,
    isDot = false,
    additiveModifiers = [] // Array of multipliers to add: e.g. [0.30] for Colossus Smash
  } = options;

  let damage = baseDamage;

  // Apply source damage modifier
  damage *= source.stats.damageDealtMod;

  // Apply additive modifiers (e.g., Colossus Smash, Judgment debuff)
  for (const mod of additiveModifiers) {
    damage *= (1 + mod);
  }

  // Apply armor/magic DR
  if (!ignoresArmor) {
    if (school === SCHOOL.PHYSICAL) {
      const armor = Math.min(target.stats.physicalArmor, ARMOR_CAP);
      damage *= (1 - armor);
    } else {
      const magicDR = Math.min(target.stats.magicDR, MAGIC_DR_CAP);
      damage *= (1 - magicDR);
    }
  }

  // Apply target damage taken modifier
  damage *= target.stats.damageTakenMod;

  // Critical strike
  let isCrit = false;
  if (guaranteedCrit) {
    isCrit = true;
  } else if (!isDot || rng.chance(source.stats.critChance)) {
    // Direct spells can crit based on crit chance
    // DoTs use the same chance but different multiplier
    if (!isDot) {
      isCrit = rng.chance(source.stats.critChance);
    }
  }

  if (isCrit) {
    damage *= isDot ? CRIT_MULTIPLIER_DOT : CRIT_MULTIPLIER_DIRECT;
  }

  return {
    damage: Math.round(damage),
    isCrit,
    school,
    mitigated: Math.round(baseDamage - damage)
  };
}

export function calculateHealing(baseHealing, source, target, options = {}) {
  const {
    additiveModifiers = []
  } = options;

  let healing = baseHealing;

  // Source healing done modifier
  healing *= source.stats.healingDoneMod;

  // Target healing received modifier
  healing *= target.stats.healingReceivedMod;

  // Additive modifiers
  for (const mod of additiveModifiers) {
    healing *= (1 + mod);
  }

  return Math.round(healing);
}

export function getActiveModifiersOnTarget(target) {
  const modifiers = [];

  // Check for Shatter Guard debuff
  const shatterGuard = target.auras.getAura('shatter_guard_debuff');
  if (shatterGuard) {
    modifiers.push(0.30);
  }

  // Check for Divine Reckoning debuff
  const divineReckoning = target.auras.getAura('divine_reckoning_debuff');
  if (divineReckoning) {
    modifiers.push(0.15);
  }

  return modifiers;
}
