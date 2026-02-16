import { defineAbility } from '../abilities/AbilityBase.js';
import { ClassBase } from './ClassBase.js';
import { SCHOOL, CC_TYPE, ABILITY_FLAG, RESOURCE_TYPE, AURA_TYPE } from '../constants.js';
import { Aura } from '../engine/Aura.js';
import { CrowdControlSystem } from '../engine/CrowdControl.js';

// ---------------------------------------------------------------------------
// Ability definitions
// ---------------------------------------------------------------------------

const hexBlight = defineAbility({
  id: 'hex_blight',
  name: 'Hex Blight',
  school: SCHOOL.SHADOW,
  cost: { [RESOURCE_TYPE.MANA]: 200 },
  cooldown: 0,
  castTime: 0,
  range: 35,
  slot: 1,
  description: 'Corrupts the target, dealing 9000 Shadow damage over 18s and slowing them by 30% for 6s. DoT ticks have a 10% chance to generate a Soul Shard.',
  execute(engine, source, target, currentTick) {
    const aura = new Aura({
      id: 'hex_blight_dot',
      name: 'Hex Blight',
      type: AURA_TYPE.DOT,
      sourceId: source.id,
      targetId: target.id,
      school: SCHOOL.SHADOW,
      duration: 180,
      appliedTick: currentTick,
      isPeriodic: true,
      tickInterval: 10,
      tickDamage: 500,
      data: { generatesSoulShards: true }
    });
    target.auras.apply(aura);

    // Apply 30% slow for 6s — gives Harbinger kiting ability
    const slow = new Aura({
      id: 'hex_blight_slow',
      name: 'Hex Blight',
      type: AURA_TYPE.DEBUFF,
      sourceId: source.id,
      targetId: target.id,
      school: SCHOOL.SHADOW,
      duration: 60,
      appliedTick: currentTick,
      statMods: { moveSpeedMultiplier: 0.7 },
      isMagic: true,
      isDispellable: true
    });
    target.auras.apply(slow);
  }
});

const creepingTorment = defineAbility({
  id: 'creeping_torment',
  name: 'Creeping Torment',
  school: SCHOOL.SHADOW,
  cost: { [RESOURCE_TYPE.MANA]: 250 },
  cooldown: 0,
  castTime: 0,
  range: 35,
  slot: 2,
  description: 'Afflicts the target with creeping torment, dealing escalating Shadow damage over 20s. Starts low and ramps up over time. DoT ticks have a 10% chance to generate a Soul Shard.',
  execute(engine, source, target, currentTick) {
    const aura = new Aura({
      id: 'creeping_torment_dot',
      name: 'Creeping Torment',
      type: AURA_TYPE.DOT,
      sourceId: source.id,
      targetId: target.id,
      school: SCHOOL.SHADOW,
      duration: 200,
      appliedTick: currentTick,
      isPeriodic: true,
      tickInterval: 10,
      tickDamage: 0, // Handled by onTick
      data: { generatesSoulShards: true },
      onTick(engine, unit, aura, tick) {
        const elapsed = tick - aura.appliedTick;
        const rampStage = Math.floor(elapsed / 40);
        const tickDamage = Math.min(200 + (rampStage * 250), 1200);
        const sourceUnit = engine.match.getUnit(aura.sourceId);
        if (sourceUnit) {
          engine.dealDamage(sourceUnit, unit, tickDamage, SCHOOL.SHADOW, 'creeping_torment', tick);
        }
      }
    });
    target.auras.apply(aura);
  }
});

const volatileHex = defineAbility({
  id: 'volatile_hex',
  name: 'Volatile Hex',
  school: SCHOOL.SHADOW,
  cost: { [RESOURCE_TYPE.MANA]: 400 },
  cooldown: 0,
  castTime: 15,
  range: 35,
  slot: 7,
  description: 'Afflicts the target with a volatile hex, dealing 12000 Shadow damage over 8s. Dispelling this effect deals 6000 instant Shadow damage. DoT ticks have a 10% chance to generate a Soul Shard.',
  execute(engine, source, target, currentTick) {
    const aura = new Aura({
      id: 'volatile_hex_dot',
      name: 'Volatile Hex',
      type: AURA_TYPE.DOT,
      sourceId: source.id,
      targetId: target.id,
      school: SCHOOL.SHADOW,
      duration: 80,
      appliedTick: currentTick,
      isPeriodic: true,
      tickInterval: 10,
      tickDamage: 1500,
      data: { generatesSoulShards: true },
      onDispel(engine, unit, aura) {
        // Dispelling Volatile Hex detonates for 6000 shadow damage
        const caster = engine.match.getUnit(aura.sourceId);
        if (caster) {
          engine.dealDamage(caster, unit, 6000, SCHOOL.SHADOW, 'volatile_hex_detonate', engine.match.tick);
        }
      }
    });
    target.auras.apply(aura);
  }
});

const siphonEssence = defineAbility({
  id: 'siphon_essence',
  name: 'Siphon Essence',
  school: SCHOOL.SHADOW,
  cost: { [RESOURCE_TYPE.MANA]: 150 },
  cooldown: 0,
  castTime: 0,
  channelDuration: 50,
  channelTickInterval: 10,
  range: 35,
  flags: [ABILITY_FLAG.CHANNEL],
  slot: 3,
  description: 'Drains the target\'s life force, dealing 2000 Shadow damage and healing you for 3500 every 1s for 5s.',
  channelTick(engine, source, target, currentTick) {
    engine.dealDamage(source, target, 2000, SCHOOL.SHADOW, 'siphon_essence', currentTick);
    engine.healUnit(source, source, 3500, currentTick);
  }
});

const hexRupture = defineAbility({
  id: 'hex_rupture',
  name: 'Hex Rupture',
  school: SCHOOL.SHADOW,
  cost: { [RESOURCE_TYPE.SOUL_SHARDS]: 1 },
  cooldown: 0,
  castTime: 15,
  range: 35,
  slot: 4,
  description: 'Ruptures the target\'s afflictions, dealing 3000 damage plus 2000 per active DoT. Extends all DoTs on the target by 3s.',
  execute(engine, source, target, currentTick) {
    // Count active DoTs on the target
    const dotIds = ['hex_blight_dot', 'creeping_torment_dot', 'volatile_hex_dot'];
    let dotCount = 0;
    const activeDots = [];

    for (const dotId of dotIds) {
      const aura = target.auras.get(dotId);
      if (aura) {
        dotCount++;
        activeDots.push(aura);
      }
    }

    // Deal damage based on active DoT count
    const damage = 3000 + (2000 * dotCount);
    engine.dealDamage(source, target, damage, SCHOOL.SHADOW, 'hex_rupture', currentTick);

    // Extend all DoTs by 30 ticks (3s)
    for (const aura of activeDots) {
      aura.endTick += 30;
    }
  }
});

const dreadHowl = defineAbility({
  id: 'dread_howl',
  name: 'Dread Howl',
  school: SCHOOL.SHADOW,
  cost: { [RESOURCE_TYPE.MANA]: 300 },
  cooldown: 240, // 24s
  castTime: 12,
  range: 30,
  slot: 5,
  description: 'Strikes dread into the target, causing them to flee in terror for 6s. Damage above 2000 will break the effect. Shares diminishing returns with Disorient.',
  execute(engine, source, target, currentTick) {
    CrowdControlSystem.applyCC(source, target, CC_TYPE.FEAR, 60, currentTick, {
      breakOnDamage: true,
      damageThreshold: 2000
    });
  }
});

const wraithBolt = defineAbility({
  id: 'wraith_bolt',
  name: 'Wraith Bolt',
  school: SCHOOL.SHADOW,
  cost: null,
  cooldown: 450,
  castTime: 0,
  range: 30,
  slot: 6,
  description: 'Deals 5000 Shadow damage, disorients the target for 3s, and heals you for 5000. Damage above 2000 breaks the disorient. Shares DR with Dread Howl.',
  execute(engine, source, target, currentTick) {
    // Deal damage
    engine.dealDamage(source, target, 5000, SCHOOL.SHADOW, 'wraith_bolt', currentTick);

    // Apply 3s disorient (shares DR with Dread Howl via DISORIENT category)
    CrowdControlSystem.applyCC(source, target, CC_TYPE.DISORIENT, 30, currentTick, {
      breakOnDamage: true,
      damageThreshold: 2000
    });

    // Heal self
    engine.healUnit(source, source, 5000, currentTick);
  }
});

const netherSlam = defineAbility({
  id: 'nether_slam',
  name: 'Nether Slam',
  school: SCHOOL.SHADOW,
  cost: { [RESOURCE_TYPE.MANA]: 300 },
  cooldown: 300,
  castTime: 5,
  range: 30,
  slot: 8,
  description: 'Unleashes a burst of nether energy, dealing 4000 damage and stunning the target for 3s.',
  execute(engine, source, target, currentTick) {
    engine.dealDamage(source, target, 4000, SCHOOL.SHADOW, 'nether_slam', currentTick);
    CrowdControlSystem.applyCC(source, target, CC_TYPE.STUN, 30, currentTick);
  }
});

const bloodTithe = defineAbility({
  id: 'blood_tithe',
  name: 'Blood Tithe',
  school: SCHOOL.SHADOW,
  cost: null,
  cooldown: 600,
  castTime: 0,
  range: 0,
  flags: [ABILITY_FLAG.IGNORES_GCD],
  slot: 9,
  description: 'Sacrifices 25% of your demon\'s HP to grant an absorb shield equal to 300% of the sacrificed amount for 10s. May kill the pet.',
  execute(engine, source, target, currentTick) {
    if (!source.classData.petAlive || source.classData.petHp <= 0) {
      engine.match.eventBus.emit('ability_cast_failed', { sourceId: source.id, abilityId: 'blood_tithe', reason: 'no_pet' });
      return;
    }
    const sacrifice = source.classData.petHp * 0.25;
    source.classData.petHp -= sacrifice;

    if (source.classData.petHp <= 0) {
      source.classData.petHp = 0;
      source.classData.petAlive = false;
    }

    const shieldAmount = sacrifice * 3;
    source.addAbsorb(shieldAmount, currentTick + 100, 'blood_tithe');
  }
});

const wardedFlesh = defineAbility({
  id: 'warded_flesh',
  name: 'Warded Flesh',
  school: SCHOOL.SHADOW,
  cost: null,
  cooldown: 1800,
  castTime: 0,
  range: 0,
  flags: [ABILITY_FLAG.IGNORES_GCD],
  slot: 10,
  description: 'Harden your skin, reducing all damage taken by 40% for 8s.',
  execute(engine, source, target, currentTick) {
    const aura = new Aura({
      id: 'warded_flesh_buff',
      name: 'Warded Flesh',
      type: AURA_TYPE.BUFF,
      sourceId: source.id,
      targetId: source.id,
      school: SCHOOL.SHADOW,
      duration: 80,
      appliedTick: currentTick,
      statMods: { damageTakenMod: 0.60 },
      isMagic: false,
      isDispellable: false
    });
    source.auras.apply(aura);
  }
});

const riftAnchor = defineAbility({
  id: 'rift_anchor',
  name: 'Rift Anchor',
  school: SCHOOL.SHADOW,
  cost: null,
  cooldown: 0,
  castTime: 0,
  range: 0,
  flags: [ABILITY_FLAG.IGNORES_GCD],
  charges: { max: 2, rechargeTicks: 150 }, // 2 charges, 15s recharge
  slot: 11,
  description: 'Places a Rift Anchor at your location (charge 1). Use again to teleport back to it (charge 2). 2 charges.',
  execute(engine, source, target, currentTick) {
    if (source.classData.demonicCircle) {
      // Teleport to the circle and consume it
      source.position.x = source.classData.demonicCircle.x;
      source.position.z = source.classData.demonicCircle.z;
      source.moveTarget = null; // Stop movement after teleport
      source.classData.demonicCircle = null;
    } else {
      // Place the circle at current position
      source.classData.demonicCircle = {
        x: source.position.x,
        z: source.position.z
      };
    }
  }
});

const hexSilence = defineAbility({
  id: 'hex_silence',
  name: 'Hex Silence',
  school: SCHOOL.SHADOW,
  cost: null,
  cooldown: 240,
  castTime: 0,
  range: 35,
  flags: [ABILITY_FLAG.IGNORES_GCD],
  slot: 12,
  description: 'Commands your demon to interrupt the target, locking their spell school for 5s. Requires a living pet.',
  execute(engine, source, target, currentTick) {
    if (!source.classData.petAlive) {
      engine.match.eventBus.emit('ability_cast_failed', { sourceId: source.id, abilityId: 'hex_silence', reason: 'no_pet' });
      return;
    }
    engine.interruptTarget(source, target, 50, currentTick);
  }
});

const soulIgnite = defineAbility({
  id: 'soul_ignite',
  name: 'Soul Ignite',
  school: SCHOOL.SHADOW,
  cost: { [RESOURCE_TYPE.SOUL_SHARDS]: 1 },
  cooldown: 300,
  castTime: 0,
  range: 0,
  slot: 0,
  description: 'Burns a Soul Shard to empower your next Siphon Essence, making it channel 50% faster and deal double damage and healing for 15s.',
  execute(engine, source, target, currentTick) {
    const aura = new Aura({
      id: 'soul_ignite_buff',
      name: 'Soul Ignite',
      type: AURA_TYPE.BUFF,
      sourceId: source.id,
      targetId: source.id,
      school: SCHOOL.SHADOW,
      duration: 150,
      appliedTick: currentTick,
      isMagic: false,
      isDispellable: false,
      onApply(unit) {
        unit.classData.soulburnActive = true;
      },
      onRemove(unit) {
        unit.classData.soulburnActive = false;
      }
    });
    source.auras.apply(aura);
  }
});

// ---------------------------------------------------------------------------
// Class definition
// ---------------------------------------------------------------------------

export const HarbingerClass = new ClassBase({
  id: 'harbinger',
  name: 'Harbinger',
  description: 'A master of shadow curses and demonic pacts. Wears down enemies with relentless damage-over-time effects while draining their life force. Commands a demon pet for interrupts and sacrificial shields.',
  color: '#006400',
  accentColor: '#9400D3',
  isRanged: true,

  physicalArmor: 0.10,
  magicDR: 0.15,
  moveSpeed: 0.95,

  autoAttackDamage: 0,
  swingTimer: 20,

  classData: {
    petHp: 30000,
    petMaxHp: 30000,
    petAlive: true,
    petDamage: 1500,
    demonicCircle: null,
    soulburnActive: false
  },

  resourcePools: [
    {
      type: RESOURCE_TYPE.MANA,
      max: 10000,
      start: 10000,
      regenPerSecond: 80
    },
    {
      type: RESOURCE_TYPE.SOUL_SHARDS,
      max: 3,
      start: 0,
      regenPerSecond: 0
    }
  ],

  abilities: [
    hexBlight,
    creepingTorment,
    volatileHex,
    siphonEssence,
    hexRupture,
    dreadHowl,
    wraithBolt,
    netherSlam,
    bloodTithe,
    wardedFlesh,
    riftAnchor,
    hexSilence,
    soulIgnite
  ],
  chargedAbilities: [
    { abilityId: 'rift_anchor', maxCharges: 2, rechargeTicks: 150 }
  ],
  coreAbilityIds: ['hex_blight', 'creeping_torment', 'hex_silence'],
  defaultLoadout: ['hex_blight', 'creeping_torment', 'hex_silence', 'siphon_essence', 'rift_anchor', 'volatile_hex']
});

export default HarbingerClass;
