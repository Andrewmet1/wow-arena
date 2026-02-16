import { ABILITY_FLAG, SCHOOL } from '../constants.js';

/**
 * Create an ability definition.
 * Abilities are data objects with optional execute functions.
 */
export function defineAbility(config) {
  return {
    id: config.id,
    name: config.name,
    school: config.school || SCHOOL.PHYSICAL,
    icon: config.icon || config.id, // For UI display

    // Costs: { rage: 30 } or { mana: 300, soul_shards: 1 }
    cost: config.cost || null,

    // Timing (in ticks)
    cooldown: config.cooldown || 0,
    castTime: config.castTime || 0, // 0 = instant
    channelDuration: config.channelDuration || 0,
    channelTickInterval: config.channelTickInterval || 5, // ticks between channel ticks

    // Range
    range: config.range || 5, // yards
    minRange: config.minRange || 0,

    // Direct effects
    damage: config.damage || 0,
    healing: config.healing || 0,

    // CC
    cc: config.cc || null, // { type, duration, breakOnDamage, damageThreshold }

    // Aura to apply
    applyAura: config.applyAura || null,

    // Absorb shield
    absorb: config.absorb || null,

    // Resource generation
    generateResource: config.generateResource || null,

    // Flags
    flags: config.flags || [],

    // Custom execution function: (engine, source, target, currentTick) => void
    execute: config.execute || null,

    // Custom channel tick function: (engine, source, target, currentTick) => void
    channelTick: config.channelTick || null,

    // Charges (for abilities with multiple charges)
    charges: config.charges || null, // { max: 2, rechargeTicks: 200 }

    // Description for UI
    description: config.description || '',

    // Keybind slot (1-12)
    slot: config.slot || 0
  };
}
