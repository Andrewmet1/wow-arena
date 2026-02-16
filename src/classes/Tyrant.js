import { defineAbility } from '../abilities/AbilityBase.js';
import { ClassBase } from './ClassBase.js';
import { SCHOOL, CC_TYPE, ABILITY_FLAG, RESOURCE_TYPE, AURA_TYPE } from '../constants.js';
import { Aura } from '../engine/Aura.js';
import { CrowdControlSystem } from '../engine/CrowdControl.js';

// ---------------------------------------------------------------------------
// Ability definitions
// ---------------------------------------------------------------------------

const ravagingCleave = defineAbility({
  id: 'ravaging_cleave',
  name: 'Ravaging Cleave',
  school: SCHOOL.PHYSICAL,
  cost: { [RESOURCE_TYPE.RAGE]: 30 },
  cooldown: 60,
  castTime: 0,
  range: 5,
  slot: 1,
  description: 'A vicious strike that deals 8500 damage and reduces healing received by 30% for 10s.',
  execute(engine, source, target, currentTick) {
    // Deal damage
    engine.dealDamage(source, target, 8500, SCHOOL.PHYSICAL, 'ravaging_cleave', currentTick);

    // Apply Ravaged Flesh debuff
    const aura = new Aura({
      id: 'ravaged_flesh',
      name: 'Ravaged Flesh',
      type: AURA_TYPE.DEBUFF,
      sourceId: source.id,
      targetId: target.id,
      school: SCHOOL.PHYSICAL,
      duration: 100, // 10s
      appliedTick: currentTick,
      healingReduction: 0.30,
      isMagic: false,
      isDispellable: false
    });
    target.auras.apply(aura);
  }
});

const bloodrageStrike = defineAbility({
  id: 'bloodrage_strike',
  name: 'Bloodrage Strike',
  school: SCHOOL.PHYSICAL,
  cost: { [RESOURCE_TYPE.RAGE]: 20 },
  cooldown: 0,
  castTime: 0,
  range: 5,
  slot: 2,
  description: 'A furious strike dealing 5500 damage. Generates 10 rage if target is above 80% HP.',
  execute(engine, source, target, currentTick) {
    // Deal damage
    engine.dealDamage(source, target, 5500, SCHOOL.PHYSICAL, 'bloodrage_strike', currentTick);

    // Generate rage if target is above 80% HP
    if (target.hp > target.maxHp * 0.80) {
      source.resources.gain(RESOURCE_TYPE.RAGE, 10);
    }
  }
});

const brutalSlam = defineAbility({
  id: 'brutal_slam',
  name: 'Brutal Slam',
  school: SCHOOL.PHYSICAL,
  cost: { [RESOURCE_TYPE.RAGE]: 20 },
  cooldown: 0,
  castTime: 0,
  range: 5,
  damage: 4800,
  slot: 8,
  description: 'Slams the target for 4800 damage.'
});

const ironCyclone = defineAbility({
  id: 'iron_cyclone',
  name: 'Iron Cyclone',
  school: SCHOOL.PHYSICAL,
  cost: null,
  cooldown: 900,
  castTime: 0,
  range: 8,
  slot: 4,
  description: 'Become a whirlwind of steel for 6s, dealing 2000 damage on impact and 3500 damage every 0.5s to nearby enemies. Immune to CC while active.',
  execute(engine, source, target, currentTick) {
    // Initial impact damage
    engine.dealDamage(source, target, 2000, SCHOOL.PHYSICAL, 'iron_cyclone', currentTick);
    const aura = new Aura({
      id: 'iron_cyclone_active',
      name: 'Iron Cyclone',
      type: AURA_TYPE.BUFF,
      sourceId: source.id,
      targetId: source.id,
      school: SCHOOL.PHYSICAL,
      duration: 60, // 6s
      appliedTick: currentTick,
      isPeriodic: true,
      tickInterval: 5, // every 0.5s
      isMagic: false,
      isDispellable: false,
      data: { targetId: target.id },
      onApply(unit) {
        unit.immuneToCC = true;
      },
      onRemove(unit) {
        unit.immuneToCC = false;
      },
      onTick(engine, unit, aura, tick) {
        // Deal damage to the target if in 8yd range
        const tickTarget = engine.match.getUnit(aura.data.targetId);
        if (tickTarget && tickTarget.isAlive && unit.distanceTo(tickTarget) <= 8) {
          engine.dealDamage(unit, tickTarget, 3500, SCHOOL.PHYSICAL, 'iron_cyclone', tick);
        }
        // Generate 5 rage per tick
        unit.resources.gain(RESOURCE_TYPE.RAGE, 5);
      }
    });
    source.auras.apply(aura);
  }
});

const shatterGuard = defineAbility({
  id: 'shatter_guard',
  name: 'Shatter Guard',
  school: SCHOOL.PHYSICAL,
  cost: { [RESOURCE_TYPE.RAGE]: 10 },
  cooldown: 450,
  castTime: 0,
  range: 5,
  slot: 5,
  description: 'Smashes the target for 6000 damage and increases damage taken by 30% for 10s.',
  execute(engine, source, target, currentTick) {
    // Deal damage
    engine.dealDamage(source, target, 6000, SCHOOL.PHYSICAL, 'shatter_guard', currentTick);

    // Apply Shatter Guard debuff
    const aura = new Aura({
      id: 'shatter_guard_debuff',
      name: 'Shatter Guard',
      type: AURA_TYPE.DEBUFF,
      sourceId: source.id,
      targetId: target.id,
      school: SCHOOL.PHYSICAL,
      duration: 100, // 10s
      appliedTick: currentTick,
      statMods: { damageTakenMod: 1.30 },
      isMagic: false,
      isDispellable: false
    });
    target.auras.apply(aura);
  }
});

const warbringerRush = defineAbility({
  id: 'warbringer_rush',
  name: 'Warbringer Rush',
  school: SCHOOL.PHYSICAL,
  cost: null,
  cooldown: 150,
  castTime: 0,
  range: 25,
  minRange: 8,
  slot: 6,
  description: 'Charge to an enemy, dealing 2000 damage, rooting them for 1.5s, and generating 20 rage.',
  execute(engine, source, target, currentTick) {
    // Teleport source to within 3yd of target
    const dx = source.position.x - target.position.x;
    const dz = source.position.z - target.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > 0) {
      const nx = dx / dist;
      const nz = dz / dist;
      source.position.x = target.position.x + nx * 3;
      source.position.z = target.position.z + nz * 3;
    }

    // Deal damage
    engine.dealDamage(source, target, 2000, SCHOOL.PHYSICAL, 'warbringer_rush', currentTick);

    // Apply 1.5s root
    CrowdControlSystem.applyCC(source, target, CC_TYPE.ROOT, 15, currentTick);

    // Generate 20 rage
    source.resources.gain(RESOURCE_TYPE.RAGE, 20);
  }
});

const cripplingStrike = defineAbility({
  id: 'crippling_strike',
  name: 'Crippling Strike',
  school: SCHOOL.PHYSICAL,
  cost: { [RESOURCE_TYPE.RAGE]: 10 },
  cooldown: 0,
  castTime: 0,
  range: 5,
  slot: 7,
  description: 'Maims the target for 1500 damage and slows movement speed by 50% for 12s.',
  execute(engine, source, target, currentTick) {
    // Deal damage
    engine.dealDamage(source, target, 1500, SCHOOL.PHYSICAL, 'crippling_strike', currentTick);

    // Apply Crippling Strike slow debuff
    const aura = new Aura({
      id: 'crippling_strike_debuff',
      name: 'Crippling Strike',
      type: AURA_TYPE.DEBUFF,
      sourceId: source.id,
      targetId: target.id,
      school: SCHOOL.PHYSICAL,
      duration: 120, // 12s
      appliedTick: currentTick,
      statMods: { moveSpeedMultiplier: 0.5 },
      isMagic: false,
      isDispellable: false
    });
    target.auras.apply(aura);
  }
});

const thunderSpike = defineAbility({
  id: 'thunder_spike',
  name: 'Thunder Spike',
  school: SCHOOL.PHYSICAL,
  cost: { [RESOURCE_TYPE.RAGE]: 10 },
  cooldown: 300,
  castTime: 0,
  range: 20,
  slot: 3,
  description: 'Hurls a bolt of lightning at the target, dealing 3000 damage and stunning for 3s.',
  execute(engine, source, target, currentTick) {
    // Deal damage
    engine.dealDamage(source, target, 3000, SCHOOL.PHYSICAL, 'thunder_spike', currentTick);

    // Apply 3s stun
    CrowdControlSystem.applyCC(source, target, CC_TYPE.STUN, 30, currentTick);
  }
});

const ironResolve = defineAbility({
  id: 'iron_resolve',
  name: 'Iron Resolve',
  school: SCHOOL.PHYSICAL,
  cost: null,
  cooldown: 1200,
  castTime: 0,
  range: 0,
  flags: [ABILITY_FLAG.IGNORES_GCD],
  slot: 9,
  description: 'Become immune to physical damage and reduce magic damage taken by 30% for 8s.',
  execute(engine, source, target, currentTick) {
    const aura = new Aura({
      id: 'iron_resolve_buff',
      name: 'Iron Resolve',
      type: AURA_TYPE.BUFF,
      sourceId: source.id,
      targetId: source.id,
      school: SCHOOL.PHYSICAL,
      duration: 80, // 8s
      appliedTick: currentTick,
      statMods: { damageTakenMod: 0.70 },
      isMagic: false,
      isDispellable: false,
      onApply(unit) {
        unit.immuneToPhysical = true;
      },
      onRemove(unit) {
        unit.immuneToPhysical = false;
      }
    });
    source.auras.apply(aura);
  }
});

const warbornRally = defineAbility({
  id: 'warborn_rally',
  name: 'Warborn Rally',
  school: SCHOOL.PHYSICAL,
  cost: { [RESOURCE_TYPE.RAGE]: 30 },
  cooldown: 600,
  castTime: 0,
  range: 0,
  slot: 10,
  description: 'Let out a rallying cry, healing yourself for 12000 and gaining an 8000 absorb shield for 10s.',
  execute(engine, source, target, currentTick) {
    // Heal self for 12000
    engine.healUnit(source, source, 12000, currentTick);

    // Add absorb shield of 8000 lasting 10s
    source.addAbsorb(8000, currentTick + 100, 'warborn_rally');
  }
});

const skullCrack = defineAbility({
  id: 'skull_crack',
  name: 'Skull Crack',
  school: SCHOOL.PHYSICAL,
  cost: null,
  cooldown: 150,
  castTime: 0,
  range: 5,
  flags: [ABILITY_FLAG.IGNORES_GCD],
  slot: 11,
  description: 'Pummels the target, interrupting spellcasting and locking the school for 4s.',
  execute(engine, source, target, currentTick) {
    // Interrupt with 4s (40 ticks) lockout
    engine.interruptTarget(source, target, 40, currentTick);
  }
});

const crushingDescent = defineAbility({
  id: 'crushing_descent',
  name: 'Crushing Descent',
  school: SCHOOL.PHYSICAL,
  cost: null,
  cooldown: 300,
  castTime: 0,
  range: 30,
  slot: 12,
  description: 'Leap to the target, dealing 2500 damage and slowing them by 50% for 3s.',
  execute(engine, source, target, currentTick) {
    // Teleport source to 5yd from target
    const dx = source.position.x - target.position.x;
    const dz = source.position.z - target.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > 0) {
      const nx = dx / dist;
      const nz = dz / dist;
      source.position.x = target.position.x + nx * 5;
      source.position.z = target.position.z + nz * 5;
    }

    // Deal damage
    engine.dealDamage(source, target, 2500, SCHOOL.PHYSICAL, 'crushing_descent', currentTick);

    // Apply 3s slow
    const aura = new Aura({
      id: 'crushing_descent_slow',
      name: 'Crushing Descent',
      type: AURA_TYPE.DEBUFF,
      sourceId: source.id,
      targetId: target.id,
      school: SCHOOL.PHYSICAL,
      duration: 30, // 3s
      appliedTick: currentTick,
      statMods: { moveSpeedMultiplier: 0.5 },
      isMagic: false,
      isDispellable: false
    });
    target.auras.apply(aura);
  }
});

// ---------------------------------------------------------------------------
// Class definition
// ---------------------------------------------------------------------------

const tyrantClass = new ClassBase({
  id: 'tyrant',
  name: 'Tyrant',
  color: '#8B0000',
  accentColor: '#708090',
  isRanged: false,
  physicalArmor: 0.30,
  magicDR: 0.10,
  moveSpeed: 1.05,
  autoAttackDamage: 3000,
  swingTimer: 20,
  classData: {
    ragePerSwing: 5,
    autoAttackSlow: {
      auraId: 'tyrant_hamstring',
      name: 'Hamstring',
      slowAmount: 0.6,
      duration: 80
    }
  },
  resourcePools: [
    {
      type: RESOURCE_TYPE.RAGE,
      max: 100,
      start: 0,
      regenPerSecond: 0
    }
  ],
  abilities: [
    ravagingCleave,
    bloodrageStrike,
    brutalSlam,
    ironCyclone,
    shatterGuard,
    warbringerRush,
    cripplingStrike,
    thunderSpike,
    ironResolve,
    warbornRally,
    skullCrack,
    crushingDescent
  ],
  coreAbilityIds: ['ravaging_cleave', 'bloodrage_strike', 'skull_crack'],
  defaultLoadout: ['ravaging_cleave', 'bloodrage_strike', 'skull_crack', 'thunder_spike', 'shatter_guard', 'iron_cyclone']
});

export default tyrantClass;
export { tyrantClass };
