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
  description: 'A vicious cleave that deals 8500 damage to the target and all enemies within 4 yards. Reduces healing received by 50% for 10s.',
  execute(engine, source, target, currentTick) {
    // True cleave — primary target + all enemies within 4yd of the target.
    engine.dealAoeDamage(source, target.position, 8500, SCHOOL.PHYSICAL, 'ravaging_cleave', currentTick, 4, { primaryTarget: target });

    // Apply Ravaged Flesh debuff to all enemies hit (4yd around target)
    const r2 = 16;
    for (const u of engine.match.units) {
      if (!u.isAlive) continue;
      if (u.id === source.id) continue;
      if (u.team != null && source.team != null && u.team === source.team) continue;
      const dx = u.position.x - target.position.x;
      const dz = u.position.z - target.position.z;
      if (dx * dx + dz * dz > r2 && u !== target) continue;
      u.auras.apply(new Aura({
        id: 'ravaged_flesh',
        name: 'Ravaged Flesh',
        type: AURA_TYPE.DEBUFF,
        sourceId: source.id,
        targetId: u.id,
        school: SCHOOL.PHYSICAL,
        duration: 100,
        appliedTick: currentTick,
        healingReduction: 0.50,
        isMagic: false,
        isDispellable: false,
      }));
    }
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
  description: 'A furious strike dealing 7000 damage. Generates 10 rage if target is above 80% HP or has Ravaged Flesh.',
  execute(engine, source, target, currentTick) {
    // Deal damage
    engine.dealDamage(source, target, 7000, SCHOOL.PHYSICAL, 'bloodrage_strike', currentTick);

    // Generate rage if target is above 80% HP or has mortal strike debuff (incentivizes maintaining Ravaged Flesh)
    if (target.hp > target.maxHp * 0.80 || target.auras.hasAura('ravaged_flesh')) {
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
  slot: 8,
  description: 'Slams the target for 5000 damage. Deals triple damage if target is below 40% health (50% if Shatter Guard is active).',
  execute(engine, source, target, currentTick) {
    let damage = 5000;
    // Execute threshold rises to 50% when Shatter Guard debuff is active (combo synergy)
    const executeThreshold = target.auras.hasAura('shatter_guard_debuff') ? 0.50 : 0.40;
    if (target.hp < target.maxHp * executeThreshold) {
      damage = 15000; // Execute range — triple damage
    }
    engine.dealDamage(source, target, damage, SCHOOL.PHYSICAL, 'brutal_slam', currentTick);
  }
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
  description: 'Become a whirlwind of steel for 5s, dealing 5000 damage on impact and 3000 damage every 0.5s to nearby enemies. Immune to CC while active.',
  execute(engine, source, target, currentTick) {
    // Initial impact damage — also AoE across all enemies within 8 yards.
    const radius = 8;
    const radiusSq = radius * radius;
    for (const candidate of engine.match.units) {
      if (!candidate.isAlive) continue;
      if (candidate.id === source.id) continue;
      if (candidate.team != null && source.team != null && candidate.team === source.team) continue;
      const dx = candidate.position.x - source.position.x;
      const dz = candidate.position.z - source.position.z;
      if (dx * dx + dz * dz > radiusSq) continue;
      engine.dealDamage(source, candidate, 5000, SCHOOL.PHYSICAL, 'iron_cyclone', currentTick);
    }

    const aura = new Aura({
      id: 'iron_cyclone_active',
      name: 'Iron Cyclone',
      type: AURA_TYPE.BUFF,
      sourceId: source.id,
      targetId: source.id,
      school: SCHOOL.PHYSICAL,
      duration: 50, // 5s
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
        // True AoE — hit every alive enemy within 8 yards each tick. Earlier
        // version only hit the single target stored on the aura, which was
        // useless against mob packs in the dungeon. Filtering by team ensures
        // the cyclone never hits allies in 2v2 / dungeon co-op.
        const radius = 8;
        const radiusSq = radius * radius;
        for (const candidate of engine.match.units) {
          if (!candidate.isAlive) continue;
          if (candidate.id === unit.id) continue;
          if (candidate.team != null && unit.team != null && candidate.team === unit.team) continue;
          const dx = candidate.position.x - unit.position.x;
          const dz = candidate.position.z - unit.position.z;
          if (dx * dx + dz * dz > radiusSq) continue;
          engine.dealDamage(unit, candidate, 3000, SCHOOL.PHYSICAL, 'iron_cyclone', tick);
        }
        // Generate 5 rage per tick (rewards staying in melee)
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
  description: 'Smashes the target for 6000 damage and increases damage taken by 30% for 10s. Removes immunity effects — if immunity was stripped, deals 12000 and stuns for 3s.',
  execute(engine, source, target, currentTick) {
    // Shattering Blow: strip immunity effects before dealing damage
    let shattered = false;
    if (target.immuneToAll) {
      target.auras.remove('aegis_of_dawn_buff');
      target.auras.remove('crystalline_ward_buff');
      shattered = true;
    }

    // Deal damage (double if shattering immunity)
    const damage = shattered ? 12000 : 6000;
    engine.dealDamage(source, target, damage, SCHOOL.PHYSICAL, 'shatter_guard', currentTick);

    // Stun if immunity was shattered
    if (shattered) {
      CrowdControlSystem.applyCC(source, target, CC_TYPE.STUN, 30, currentTick);
    }

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
  description: 'Hurls a bolt of lightning at the target, dealing 4000 damage, stunning for 3s, reducing healing by 75% for 12s, and slowing by 50% for 8s.',
  execute(engine, source, target, currentTick) {
    // Deal damage
    engine.dealDamage(source, target, 4000, SCHOOL.PHYSICAL, 'thunder_spike', currentTick);

    // Apply 3s stun
    CrowdControlSystem.applyCC(source, target, CC_TYPE.STUN, 30, currentTick);

    // Apply 75% healing reduction for 12s (burst window vs healers — outlasts Aegis)
    const healReduce = new Aura({
      id: 'thunder_spike_heal_reduce',
      name: 'Thunder Spike',
      type: AURA_TYPE.DEBUFF,
      sourceId: source.id,
      targetId: target.id,
      school: SCHOOL.PHYSICAL,
      duration: 120, // 12s
      appliedTick: currentTick,
      healingReduction: 0.75,
      isMagic: false,
      isDispellable: false
    });
    target.auras.apply(healReduce);

    // Apply 50% slow for 8s to prevent kiting after stun
    const slow = new Aura({
      id: 'thunder_spike_slow',
      name: 'Thunder Spike',
      type: AURA_TYPE.DEBUFF,
      sourceId: source.id,
      targetId: target.id,
      school: SCHOOL.PHYSICAL,
      duration: 80,
      appliedTick: currentTick,
      statMods: { moveSpeedMultiplier: 0.5 },
      isMagic: false,
      isDispellable: false
    });
    target.auras.apply(slow);
  }
});

const ironResolve = defineAbility({
  id: 'iron_resolve',
  name: 'Iron Resolve',
  school: SCHOOL.PHYSICAL,
  cost: null,
  cooldown: 600,
  castTime: 0,
  range: 0,
  flags: [ABILITY_FLAG.IGNORES_GCD, ABILITY_FLAG.USABLE_WHILE_CC],
  slot: 9,
  description: 'Break free from all CC. Become immune to CC and reduce all damage taken by 65% for 8s.',
  execute(engine, source, target, currentTick) {
    // Break all CC on activation (like Berserker Rage)
    CrowdControlSystem.removeAllCC(source);

    const aura = new Aura({
      id: 'iron_resolve_buff',
      name: 'Iron Resolve',
      type: AURA_TYPE.BUFF,
      sourceId: source.id,
      targetId: source.id,
      school: SCHOOL.PHYSICAL,
      duration: 80, // 8s
      appliedTick: currentTick,
      statMods: { damageTakenMod: 0.35 }, // 65% DR against all damage types
      isMagic: false,
      isDispellable: false,
      onApply(unit) {
        unit.immuneToCC = true;
      },
      onRemove(unit) {
        unit.immuneToCC = false;
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
  description: 'Let out a rallying cry, healing yourself for 18000 and gaining an 12000 absorb shield for 10s.',
  execute(engine, source, target, currentTick) {
    // Heal self for 18000
    engine.healUnit(source, source, 18000, currentTick);

    // Add absorb shield of 12000 lasting 10s
    source.addAbsorb(12000, currentTick + 100, 'warborn_rally');
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
  description: 'Leap to the target. The crushing landing deals 2500 damage to all enemies within 4 yards and slows them by 50% for 3s.',
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

    // AoE landing impact — primary + everyone within 4yd of the impact
    engine.dealAoeDamage(source, target.position, 2500, SCHOOL.PHYSICAL, 'crushing_descent', currentTick, 4, { primaryTarget: target });

    // Apply slow to every enemy hit by the landing
    const r2 = 16;
    for (const u of engine.match.units) {
      if (!u.isAlive) continue;
      if (u.id === source.id) continue;
      if (u.team != null && source.team != null && u.team === source.team) continue;
      const ux = u.position.x - target.position.x;
      const uz = u.position.z - target.position.z;
      if (ux * ux + uz * uz > r2 && u !== target) continue;
      u.auras.apply(new Aura({
        id: 'crushing_descent_slow',
        name: 'Crushing Descent',
        type: AURA_TYPE.DEBUFF,
        sourceId: source.id,
        targetId: u.id,
        school: SCHOOL.PHYSICAL,
        duration: 30,
        appliedTick: currentTick,
        statMods: { moveSpeedMultiplier: 0.5 },
        isMagic: false,
        isDispellable: false,
      }));
    }
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
  magicDR: 0.20,
  moveSpeed: 1.05,
  autoAttackDamage: 3500,
  swingTimer: 20,
  classData: {
    ragePerSwing: 5,
    woundPoison: true,  // Tyrant applies 25% healing reduction on melee hits (Deep Wounds)
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
  defaultLoadout: ['ravaging_cleave', 'bloodrage_strike', 'skull_crack', 'shatter_guard', 'iron_cyclone', 'warbringer_rush'],
  builds: [
    {
      id: 'iron_tide', name: 'Iron Tide',
      description: 'Relentless aggression. Break them before they can react.',
      loadout: ['ravaging_cleave', 'bloodrage_strike', 'skull_crack', 'shatter_guard', 'iron_cyclone', 'warbringer_rush']
    },
    {
      id: 'blood_oath', name: 'Blood Oath',
      description: 'Unyielding resilience. Outlast anyone who dares stand against you.',
      loadout: ['ravaging_cleave', 'bloodrage_strike', 'skull_crack', 'iron_resolve', 'warborn_rally', 'thunder_spike']
    },
    {
      id: 'butcher', name: 'Butcher',
      description: 'Savage executioner. The weaker they get, the harder you hit.',
      loadout: ['ravaging_cleave', 'bloodrage_strike', 'skull_crack', 'shatter_guard', 'brutal_slam', 'crushing_descent']
    },
    {
      id: 'siegebreaker', name: 'Siegebreaker',
      description: 'No one escapes. Close the gap and never let go.',
      loadout: ['ravaging_cleave', 'bloodrage_strike', 'skull_crack', 'warbringer_rush', 'crushing_descent', 'crippling_strike']
    }
  ]
});

export default tyrantClass;
export { tyrantClass };
