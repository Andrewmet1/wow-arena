import { defineAbility } from '../abilities/AbilityBase.js';
import { ClassBase } from './ClassBase.js';
import { SCHOOL, CC_TYPE, ABILITY_FLAG, RESOURCE_TYPE, AURA_TYPE } from '../constants.js';
import { Aura } from '../engine/Aura.js';
import { CrowdControlSystem } from '../engine/CrowdControl.js';
import { EVENTS } from '../utils/EventBus.js';

// ---------------------------------------------------------------------------
// Ability definitions
// ---------------------------------------------------------------------------

const infernoBolt = defineAbility({
  id: 'inferno_bolt',
  name: 'Inferno Bolt',
  school: SCHOOL.FIRE,
  cost: { [RESOURCE_TYPE.MANA]: 300 },
  cooldown: 0,
  castTime: 20, // 2.0s
  range: 45,
  slot: 1,
  description: 'Hurls a ball of fire at the target, dealing 6500 damage and generating 1 Cinder stack.',
  execute(engine, source, target, currentTick) {
    engine.dealDamage(source, target, 6500, SCHOOL.FIRE, 'inferno_bolt', currentTick);

    // Generate cinder stack (double during Pyroclasm)
    const hasPyroclasm = source.auras.has('pyroclasm_buff');
    const stacksToGain = hasPyroclasm ? 2 : 1;
    source.resources.gain(RESOURCE_TYPE.CINDER_STACKS, stacksToGain);
  }
});

const cataclysmFlare = defineAbility({
  id: 'cataclysm_flare',
  name: 'Cataclysm Flare',
  school: SCHOOL.FIRE,
  cost: { [RESOURCE_TYPE.MANA]: 500 },
  cooldown: 0,
  castTime: 35, // 3.5s
  range: 45,
  slot: 2,
  description: 'Launches an immense bolt of fire at the target. Deals 22000 damage if 4 Cinder stacks are consumed, otherwise 14000. Applies Pyre.',
  execute(engine, source, target, currentTick) {
    // Check cinder stacks for empowered Cataclysm Flare — 3.5s cast rewarded with massive damage
    const cinderCount = source.resources.getCurrent(RESOURCE_TYPE.CINDER_STACKS);
    let damage = 14000;
    if (cinderCount >= 4) {
      damage = 22000;
      source.resources.set(RESOURCE_TYPE.CINDER_STACKS, 0);
    }

    engine.dealDamage(source, target, damage, SCHOOL.FIRE, 'cataclysm_flare', currentTick);

    // Apply Pyre DoT: 8s, ticking every 1s for 500 damage (4000 total)
    const pyre = new Aura({
      id: 'pyre_dot',
      name: 'Pyre',
      type: AURA_TYPE.DOT,
      sourceId: source.id,
      targetId: target.id,
      school: SCHOOL.FIRE,
      duration: 80, // 8s
      appliedTick: currentTick,
      isPeriodic: true,
      tickInterval: 10, // every 1s
      tickDamage: 500,
      isMagic: true,
      isDispellable: true
    });
    target.auras.apply(pyre);
  }
});

const searingPulse = defineAbility({
  id: 'searing_pulse',
  name: 'Searing Pulse',
  school: SCHOOL.FIRE,
  cost: { [RESOURCE_TYPE.MANA]: 200 },
  cooldown: 80, // 8s
  castTime: 5, // 0.5s
  range: 45,
  flags: [ABILITY_FLAG.IGNORES_GCD, ABILITY_FLAG.GUARANTEED_CRIT, ABILITY_FLAG.USABLE_WHILE_CASTING],
  charges: { max: 2, rechargeTicks: 80 },
  slot: 3,
  description: 'Blasts the target with fire for 5000 damage. Always crits. Generates 1 Cinder stack. Usable while casting.',
  execute(engine, source, target, currentTick) {
    engine.dealDamage(source, target, 5000, SCHOOL.FIRE, 'searing_pulse', currentTick);

    // Generate cinder stack
    source.resources.gain(RESOURCE_TYPE.CINDER_STACKS, 1);
  }
});

const glacialLance = defineAbility({
  id: 'glacial_lance',
  name: 'Glacial Lance',
  school: SCHOOL.FROST,
  cost: { [RESOURCE_TYPE.MANA]: 250 },
  cooldown: 0,
  castTime: 18, // 1.8s
  range: 45,
  slot: 4,
  description: 'Launches a bolt of frost at the target, dealing 5500 damage and slowing movement by 40% for 8s.',
  execute(engine, source, target, currentTick) {
    engine.dealDamage(source, target, 5500, SCHOOL.FROST, 'glacial_lance', currentTick);

    // Apply Glacial Chill debuff (40% slow for 8s)
    const glacialChill = new Aura({
      id: 'glacial_chill_debuff',
      name: 'Glacial Chill',
      type: AURA_TYPE.DEBUFF,
      sourceId: source.id,
      targetId: target.id,
      school: SCHOOL.FROST,
      duration: 80, // 8s
      appliedTick: currentTick,
      statMods: { moveSpeedMultiplier: 0.6 },
      isMagic: true,
      isDispellable: true
    });
    target.auras.apply(glacialChill);
  }
});

const permafrostBurst = defineAbility({
  id: 'permafrost_burst',
  name: 'Permafrost Burst',
  school: SCHOOL.FROST,
  cost: { [RESOURCE_TYPE.MANA]: 200 },
  cooldown: 180, // 18s
  castTime: 0,
  range: 45,
  slot: 5,
  description: 'Blasts the target with frost, dealing 3000 damage and rooting them for 4s.',
  execute(engine, source, target, currentTick) {
    engine.dealDamage(source, target, 3000, SCHOOL.FROST, 'permafrost_burst', currentTick);

    // Apply 4s root
    CrowdControlSystem.applyCC(source, target, CC_TYPE.ROOT, 40, currentTick);
  }
});

const phaseShift = defineAbility({
  id: 'phase_shift',
  name: 'Phase Shift',
  school: SCHOOL.ARCANE,
  cost: { [RESOURCE_TYPE.MANA]: 100 },
  cooldown: 200, // 20s
  castTime: 0,
  range: 0,
  flags: [ABILITY_FLAG.IGNORES_GCD, ABILITY_FLAG.USABLE_WHILE_CASTING],
  charges: { max: 2, rechargeTicks: 200 },
  slot: 6,
  description: 'Teleport 20 yards forward, breaking stuns and roots. 2 charges.',
  execute(engine, source, target, currentTick) {
    // Break stuns and roots
    CrowdControlSystem.breakStuns(source);
    CrowdControlSystem.breakRoots(source);

    // Look up the enemy directly (target=self for range:0 abilities)
    const enemy = engine.match.getOpponent(source.id);

    // Teleport 20yd — use movement direction if moving, otherwise away from enemy
    let dx, dz;
    if (source.moveTarget) {
      // Moving: blink in movement direction
      const dirX = source.moveTarget.x - source.position.x;
      const dirZ = source.moveTarget.z - source.position.z;
      const len = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
      dx = dirX / len;
      dz = dirZ / len;
    } else if (enemy) {
      // Standing still: blink away from enemy
      const dirX = source.position.x - enemy.position.x;
      const dirZ = source.position.z - enemy.position.z;
      const len = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
      dx = dirX / len;
      dz = dirZ / len;
    } else {
      // Fallback: blink in facing direction
      dx = Math.sin(source.facing);
      dz = Math.cos(source.facing);
    }

    const newX = source.position.x + dx * 20;
    const newZ = source.position.z + dz * 20;

    // Clamp to arena bounds
    const clamped = engine.match.los.clampToBounds({ x: newX, z: newZ });
    source.position.x = clamped.x;
    source.position.z = clamped.z;
    // Clear move target so unit doesn't walk back
    source.moveTarget = null;
  }
});

const pyroclasm = defineAbility({
  id: 'pyroclasm',
  name: 'Pyroclasm',
  school: SCHOOL.FIRE,
  cost: null,
  cooldown: 900, // 90s
  castTime: 0,
  range: 0,
  flags: [ABILITY_FLAG.IGNORES_GCD, ABILITY_FLAG.USABLE_WHILE_CASTING],
  slot: 7,
  description: 'Activates fiery power for 12s. All fire spells crit and cast 50% faster. Cinder stacks generate double. Increases damage taken by 10%.',
  execute(engine, source, target, currentTick) {
    const aura = new Aura({
      id: 'pyroclasm_buff',
      name: 'Pyroclasm',
      type: AURA_TYPE.BUFF,
      sourceId: source.id,
      targetId: source.id,
      school: SCHOOL.FIRE,
      duration: 120, // 12s
      appliedTick: currentTick,
      statMods: { damageTakenMod: 1.10 },
      isMagic: false,
      isDispellable: false,
      onApply(unit) {
        unit.stats.critChance = 1.0;
        unit.stats.hasteMultiplier = 1.5;
      },
      onRemove(unit) {
        unit.stats.critChance = 0.10;
        unit.stats.hasteMultiplier = 1.0;
      }
    });
    source.auras.apply(aura);
  }
});

const crystallineWard = defineAbility({
  id: 'crystalline_ward',
  name: 'Crystalline Ward',
  school: SCHOOL.FROST,
  cost: null,
  cooldown: 1800, // 180s
  castTime: 0,
  range: 0,
  flags: [ABILITY_FLAG.IGNORES_GCD, ABILITY_FLAG.USABLE_WHILE_CASTING],
  slot: 8,
  description: 'Encases you in a block of ice for 8s, making you immune to all damage and effects. Removes all debuffs and CC.',
  execute(engine, source, target, currentTick) {
    // Remove all debuffs and CC
    source.auras.removeAllDebuffs();
    CrowdControlSystem.removeAllCC(source);

    // Apply Crystalline Ward buff
    const aura = new Aura({
      id: 'crystalline_ward_buff',
      name: 'Crystalline Ward',
      type: AURA_TYPE.BUFF,
      sourceId: source.id,
      targetId: source.id,
      school: SCHOOL.FROST,
      duration: 80, // 8s
      appliedTick: currentTick,
      isMagic: false,
      isDispellable: false,
      onApply(unit) {
        unit.immuneToAll = true;
        unit.cancelCast();
        unit.cancelChannel();
      },
      onRemove(unit) {
        unit.immuneToAll = false;
      }
    });
    source.auras.apply(aura);
  }
});

const cauterize = defineAbility({
  id: 'cauterize',
  name: 'Cauterize',
  school: SCHOOL.FIRE,
  cost: { [RESOURCE_TYPE.MANA]: 800 },
  cooldown: 450, // 45s
  castTime: 0,
  range: 0,
  flags: [ABILITY_FLAG.IGNORES_GCD, ABILITY_FLAG.USABLE_WHILE_CASTING],
  slot: 13,
  description: 'Cauterize your wounds with flame. Instantly heals 8000 HP and applies a heal-over-time for 4000 over 8s.',
  execute(engine, source, target, currentTick) {
    engine.healUnit(source, source, 8000, currentTick);

    // HoT: 500 per tick for 8 ticks (4000 total over 8s)
    const hot = new Aura({
      id: 'cauterize_hot',
      name: 'Cauterize',
      type: AURA_TYPE.BUFF,
      sourceId: source.id,
      targetId: source.id,
      school: SCHOOL.FIRE,
      duration: 80, // 8s
      appliedTick: currentTick,
      isPeriodic: true,
      tickInterval: 10, // 1s
      tickHealing: 500,
      isMagic: false,
      isDispellable: true
    });
    source.auras.apply(hot);
  }
});

const arcaneBulwark = defineAbility({
  id: 'arcane_bulwark',
  name: 'Arcane Bulwark',
  school: SCHOOL.ARCANE,
  cost: { [RESOURCE_TYPE.MANA]: 500 },
  cooldown: 600, // 60s
  castTime: 0,
  range: 0,
  flags: [ABILITY_FLAG.IGNORES_GCD, ABILITY_FLAG.USABLE_WHILE_CASTING],
  slot: 9,
  description: 'Shields you with an arcane barrier, absorbing 20000 damage and reducing physical damage taken by 15% for 15s.',
  execute(engine, source, target, currentTick) {
    // Add absorb shield
    source.addAbsorb(20000, currentTick + 150, 'arcane_bulwark');

    // Apply Arcane Bulwark buff (15% less physical damage)
    const aura = new Aura({
      id: 'arcane_bulwark_buff',
      name: 'Arcane Bulwark',
      type: AURA_TYPE.BUFF,
      sourceId: source.id,
      targetId: source.id,
      school: SCHOOL.ARCANE,
      duration: 150, // 15s
      appliedTick: currentTick,
      statMods: { damageTakenMod: 0.85 },
      isMagic: false,
      isDispellable: false
    });
    source.auras.apply(aura);
  }
});

const spellFracture = defineAbility({
  id: 'spell_fracture',
  name: 'Spell Fracture',
  school: SCHOOL.ARCANE,
  cost: null,
  cooldown: 240, // 24s
  castTime: 0,
  range: 45,
  flags: [ABILITY_FLAG.IGNORES_GCD],
  slot: 10,
  description: 'Counters the target\'s spellcast, interrupting it and locking that school for 6s.',
  execute(engine, source, target, currentTick) {
    // Interrupt with 6s (60 ticks) lockout
    engine.interruptTarget(source, target, 60, currentTick);
  }
});

const scaldwind = defineAbility({
  id: 'scaldwind',
  name: 'Scaldwind',
  school: SCHOOL.FIRE,
  cost: { [RESOURCE_TYPE.MANA]: 300 },
  cooldown: 200, // 20s
  castTime: 0,
  range: 12,
  slot: 11,
  description: 'Breathes a cone of fire at the target, dealing 6000 damage and disorienting for 4s. Breaks on heavy damage.',
  execute(engine, source, target, currentTick) {
    engine.dealDamage(source, target, 6000, SCHOOL.FIRE, 'scaldwind', currentTick);

    // Apply 4s disorient (breaks on damage above 2000 threshold)
    CrowdControlSystem.applyCC(source, target, CC_TYPE.DISORIENT, 40, currentTick, {
      breakOnDamage: true,
      damageThreshold: 2000
    });
  }
});

const emberBrand = defineAbility({
  id: 'ember_brand',
  name: 'Ember Brand',
  school: SCHOOL.FIRE,
  cost: { [RESOURCE_TYPE.MANA]: 100 },
  cooldown: 0,
  castTime: 10, // 1.0s
  range: 45,
  flags: [ABILITY_FLAG.USABLE_WHILE_MOVING],
  slot: 12,
  description: 'Scorches the target for 3500 damage. Castable while moving. Generates 1 Cinder stack.',
  execute(engine, source, target, currentTick) {
    engine.dealDamage(source, target, 3500, SCHOOL.FIRE, 'ember_brand', currentTick);

    // Generate cinder stack
    source.resources.gain(RESOURCE_TYPE.CINDER_STACKS, 1);
  }
});

const scorchedEarth = defineAbility({
  id: 'scorched_earth',
  name: 'Scorched Earth',
  school: SCHOOL.FIRE,
  cost: { [RESOURCE_TYPE.MANA]: 400 },
  cooldown: 200, // 20s
  castTime: 0,
  range: 45,
  slot: 14,
  description: 'Scorches the ground at the target\'s location for 8s. Enemies standing in the zone take 2000 fire damage per second and are slowed by 50%.',
  execute(engine, source, target, currentTick) {
    const zonePos = { x: target.position.x, z: target.position.z };
    const ZONE_RADIUS = 7;
    const ZONE_DURATION = 80; // 8s
    const endTick = currentTick + ZONE_DURATION;
    let lastTickAt = currentTick;

    engine.match.eventBus.emit(EVENTS.GROUND_ZONE_PLACED, {
      id: 'scorched_earth_' + currentTick,
      sourceId: source.id,
      position: zonePos,
      radius: ZONE_RADIUS,
      duration: ZONE_DURATION,
      school: SCHOOL.FIRE,
      type: 'scorched_earth'
    });

    engine.match.dynamicEvents.push({
      id: 'scorched_earth_' + currentTick,
      tick(engine, tick) {
        if (tick >= endTick) {
          this.expired = true;
          engine.match.eventBus.emit(EVENTS.GROUND_ZONE_EXPIRED, { id: this.id });
          return;
        }
        // Tick every 1s (10 ticks)
        if (tick - lastTickAt < 10) return;
        lastTickAt = tick;

        for (const unit of engine.match.units) {
          if (unit.id === source.id || !unit.isAlive) continue;
          const dx = unit.position.x - zonePos.x;
          const dz = unit.position.z - zonePos.z;
          if (dx * dx + dz * dz <= ZONE_RADIUS * ZONE_RADIUS) {
            engine.dealDamage(source, unit, 2000, SCHOOL.FIRE, 'scorched_earth', tick);
            // Apply slow
            unit.auras.apply(new Aura({
              id: 'scorched_earth_slow',
              name: 'Scorched Earth',
              type: AURA_TYPE.DEBUFF,
              sourceId: source.id,
              targetId: unit.id,
              school: SCHOOL.FIRE,
              duration: 15, // 1.5s — refreshed each zone tick
              appliedTick: tick,
              statMods: { moveSpeedMultiplier: 0.5 },
              isMagic: true,
              isDispellable: true
            }));
          }
        }
      }
    });
  }
});

const ringOfFrost = defineAbility({
  id: 'ring_of_frost',
  name: 'Ring of Frost',
  school: SCHOOL.FROST,
  cost: { [RESOURCE_TYPE.MANA]: 300 },
  cooldown: 300, // 30s
  castTime: 0,
  range: 45,
  slot: 15,
  description: 'Places a frost ring at the target\'s location. After 2s, enemies who enter are frozen for 4s and take 4000 frost damage. Lasts 10s.',
  execute(engine, source, target, currentTick) {
    const zonePos = { x: target.position.x, z: target.position.z };
    const ZONE_RADIUS = 8;
    const ARM_DELAY = 20; // 2s
    const ZONE_DURATION = 100; // 10s total
    const endTick = currentTick + ZONE_DURATION;
    const armTick = currentTick + ARM_DELAY;
    const frozenUnits = new Set();

    engine.match.eventBus.emit(EVENTS.GROUND_ZONE_PLACED, {
      id: 'ring_of_frost_' + currentTick,
      sourceId: source.id,
      position: zonePos,
      radius: ZONE_RADIUS,
      duration: ZONE_DURATION,
      school: SCHOOL.FROST,
      type: 'ring_of_frost'
    });

    engine.match.dynamicEvents.push({
      id: 'ring_of_frost_' + currentTick,
      tick(engine, tick) {
        if (tick >= endTick) {
          this.expired = true;
          engine.match.eventBus.emit(EVENTS.GROUND_ZONE_EXPIRED, { id: this.id });
          return;
        }
        // Not armed yet
        if (tick < armTick) return;

        for (const unit of engine.match.units) {
          if (unit.id === source.id || !unit.isAlive) continue;
          if (frozenUnits.has(unit.id)) continue; // Already triggered on this unit

          const dx = unit.position.x - zonePos.x;
          const dz = unit.position.z - zonePos.z;
          if (dx * dx + dz * dz <= ZONE_RADIUS * ZONE_RADIUS) {
            frozenUnits.add(unit.id);
            engine.dealDamage(source, unit, 4000, SCHOOL.FROST, 'ring_of_frost', tick);
            CrowdControlSystem.applyCC(source, unit, CC_TYPE.ROOT, 40, tick); // 4s root
          }
        }
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Class definition
// ---------------------------------------------------------------------------

export const InfernalClass = new ClassBase({
  id: 'infernal',
  name: 'Infernal',
  color: '#FF4500',
  accentColor: '#FFD700',
  isRanged: true,
  physicalArmor: 0.12,
  magicDR: 0.20,
  moveSpeed: 1.0,
  autoAttackDamage: 0,
  swingTimer: 20,
  classData: { cauterize: true },
  resourcePools: [
    {
      type: RESOURCE_TYPE.MANA,
      max: 10000,
      start: 10000,
      regenPerSecond: 100
    },
    {
      type: RESOURCE_TYPE.CINDER_STACKS,
      max: 4,
      start: 0,
      regenPerSecond: 0
    }
  ],
  abilities: [
    infernoBolt,
    cataclysmFlare,
    searingPulse,
    glacialLance,
    permafrostBurst,
    phaseShift,
    pyroclasm,
    crystallineWard,
    cauterize,
    arcaneBulwark,
    spellFracture,
    scaldwind,
    emberBrand,
    scorchedEarth,
    ringOfFrost
  ],
  chargedAbilities: [
    { abilityId: 'searing_pulse', maxCharges: 2, rechargeTicks: 80 },
    { abilityId: 'phase_shift', maxCharges: 2, rechargeTicks: 200 }
  ],
  coreAbilityIds: ['inferno_bolt', 'searing_pulse', 'phase_shift'],
  defaultLoadout: ['inferno_bolt', 'glacial_lance', 'searing_pulse', 'ember_brand', 'phase_shift', 'pyroclasm']
});
