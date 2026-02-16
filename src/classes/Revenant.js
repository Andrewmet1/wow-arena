import { defineAbility } from '../abilities/AbilityBase.js';
import { ClassBase } from './ClassBase.js';
import { SCHOOL, CC_TYPE, ABILITY_FLAG, RESOURCE_TYPE, AURA_TYPE } from '../constants.js';
import { Aura } from '../engine/Aura.js';
import { CrowdControlSystem } from '../engine/CrowdControl.js';

// ---------------------------------------------------------------------------
// Ability definitions
// ---------------------------------------------------------------------------

const hallowedStrike = defineAbility({
  id: 'hallowed_strike',
  name: 'Hallowed Strike',
  school: SCHOOL.PHYSICAL,
  cost: null,
  cooldown: 50, // 5s
  castTime: 0,
  range: 5,
  slot: 1,
  description: 'Strikes the target for 5500 physical damage. Generates 1 Holy Power.',
  execute(engine, source, target, currentTick) {
    engine.dealDamage(source, target, 5500, SCHOOL.PHYSICAL, 'hallowed_strike', currentTick);
    source.resources.gain(RESOURCE_TYPE.HOLY_POWER, 1);
  }
});

const divineReckoning = defineAbility({
  id: 'divine_reckoning',
  name: 'Divine Reckoning',
  school: SCHOOL.HOLY,
  cost: { [RESOURCE_TYPE.MANA]: 300 },
  cooldown: 100, // 10s
  castTime: 0,
  range: 30,
  slot: 2,
  description: 'Judges the target for 8000 holy damage. Generates 1 Holy Power. Target takes 15% more holy damage for 8s.',
  execute(engine, source, target, currentTick) {
    engine.dealDamage(source, target, 8000, SCHOOL.HOLY, 'divine_reckoning', currentTick);
    source.resources.gain(RESOURCE_TYPE.HOLY_POWER, 1);

    // Apply Divine Reckoning debuff (15% increased holy damage taken)
    const aura = new Aura({
      id: 'divine_reckoning_debuff',
      name: 'Divine Reckoning',
      type: AURA_TYPE.DEBUFF,
      sourceId: source.id,
      targetId: target.id,
      school: SCHOOL.HOLY,
      duration: 80, // 8s
      appliedTick: currentTick,
      isMagic: true,
      isDispellable: true
    });
    target.auras.apply(aura);
  }
});

const radiantVerdict = defineAbility({
  id: 'radiant_verdict',
  name: 'Radiant Verdict',
  school: SCHOOL.HOLY,
  cost: null, // Handled manually in execute — engine must not pre-spend
  cooldown: 0,
  castTime: 0,
  range: 5,
  slot: 3,
  description: 'Consumes all Holy Power to deliver a devastating holy strike. Deals 5000 + 2500 per Holy Power spent.',
  execute(engine, source, target, currentTick) {
    const holyPower = source.resources.getCurrent(RESOURCE_TYPE.HOLY_POWER);
    if (holyPower < 3) {
      engine.match.eventBus.emit('ability_cast_failed', { sourceId: source.id, abilityId: 'radiant_verdict', reason: 'resource' });
      return;
    }

    const damage = 5000 + (2500 * holyPower);
    source.resources.set(RESOURCE_TYPE.HOLY_POWER, 0);
    engine.dealDamage(source, target, damage, SCHOOL.HOLY, 'radiant_verdict', currentTick);
  }
});

const sanctifiedGale = defineAbility({
  id: 'sanctified_gale',
  name: 'Sanctified Gale',
  school: SCHOOL.HOLY,
  cost: null, // Handled manually in execute
  cooldown: 0,
  castTime: 0,
  range: 8,
  slot: 4,
  description: 'Consumes all Holy Power to unleash a divine tempest dealing 10000 holy damage and healing self for 5000.',
  execute(engine, source, target, currentTick) {
    const holyPower = source.resources.getCurrent(RESOURCE_TYPE.HOLY_POWER);
    if (holyPower < 3) {
      engine.match.eventBus.emit('ability_cast_failed', { sourceId: source.id, abilityId: 'sanctified_gale', reason: 'resource' });
      return;
    }

    source.resources.set(RESOURCE_TYPE.HOLY_POWER, 0);
    engine.dealDamage(source, target, 10000, SCHOOL.HOLY, 'sanctified_gale', currentTick);
    engine.healUnit(source, source, 5000, currentTick);
  }
});

const emberWake = defineAbility({
  id: 'ember_wake',
  name: 'Ember Wake',
  school: SCHOOL.HOLY,
  cost: null,
  cooldown: 450, // 45s
  castTime: 0,
  range: 12,
  slot: 5,
  description: 'Lashes out with holy energy for 10000 damage. Generates 3 Holy Power. Slows target by 50% for 4s.',
  execute(engine, source, target, currentTick) {
    engine.dealDamage(source, target, 10000, SCHOOL.HOLY, 'ember_wake', currentTick);
    source.resources.gain(RESOURCE_TYPE.HOLY_POWER, 3);

    // Apply slow debuff
    const aura = new Aura({
      id: 'ember_wake_slow',
      name: 'Ember Wake',
      type: AURA_TYPE.DEBUFF,
      sourceId: source.id,
      targetId: target.id,
      school: SCHOOL.HOLY,
      duration: 40, // 4s
      appliedTick: currentTick,
      statMods: { moveSpeedMultiplier: 0.5 },
      isMagic: true,
      isDispellable: true
    });
    target.auras.apply(aura);
  }
});

const gavelOfLight = defineAbility({
  id: 'gavel_of_light',
  name: 'Gavel of Light',
  school: SCHOOL.HOLY,
  cost: null,
  cooldown: 600, // 60s
  castTime: 0,
  range: 10,
  slot: 6,
  description: 'Stuns the target for 5s.',
  execute(engine, source, target, currentTick) {
    CrowdControlSystem.applyCC(source, target, CC_TYPE.STUN, 50, currentTick);
  }
});

const bindingPrayer = defineAbility({
  id: 'binding_prayer',
  name: 'Binding Prayer',
  school: SCHOOL.HOLY,
  cost: { [RESOURCE_TYPE.MANA]: 500 },
  cooldown: 150, // 15s
  castTime: 15, // 1.5s
  range: 30,
  slot: 7,
  description: 'Incapacitates the target for 6s. Any damage breaks the effect.',
  execute(engine, source, target, currentTick) {
    CrowdControlSystem.applyCC(source, target, CC_TYPE.INCAPACITATE, 60, currentTick, {
      breakOnDamage: true,
      damageThreshold: 0
    });
  }
});

const aegisOfDawn = defineAbility({
  id: 'aegis_of_dawn',
  name: 'Aegis of Dawn',
  school: SCHOOL.HOLY,
  cost: null,
  cooldown: 3000, // 300s / 5min
  castTime: 0,
  range: 0,
  flags: [ABILITY_FLAG.IGNORES_GCD, ABILITY_FLAG.USABLE_WHILE_CASTING],
  slot: 8,
  description: 'Grants immunity to all damage and effects for 8s. Removes all debuffs and CC. Causes Forbearance (30s).',
  execute(engine, source, target, currentTick) {
    // Check Forbearance
    if (source.classData.hasForbearance && currentTick < source.classData.forbearanceEndTick) {
      engine.match.eventBus.emit('ability_cast_failed', { sourceId: source.id, abilityId: 'aegis_of_dawn', reason: 'forbearance' });
      return;
    }

    // Remove all debuffs and CC
    source.auras.removeAllDebuffs();
    CrowdControlSystem.removeAllCC(source);

    // Apply Aegis of Dawn buff (Divine Shield — can still act)
    const aura = new Aura({
      id: 'aegis_of_dawn_buff',
      name: 'Aegis of Dawn',
      type: AURA_TYPE.BUFF,
      sourceId: source.id,
      targetId: source.id,
      school: SCHOOL.HOLY,
      duration: 80, // 8s
      appliedTick: currentTick,
      isMagic: false,
      isDispellable: false,
      onApply(unit) {
        unit.immuneToAll = true;
        unit.canActWhileImmune = true;
      },
      onRemove(unit) {
        unit.immuneToAll = false;
        unit.canActWhileImmune = false;
      }
    });
    source.auras.apply(aura);

    // Apply Forbearance
    source.classData.hasForbearance = true;
    source.classData.forbearanceEndTick = currentTick + 300; // 30s
  }
});

const sovereignMend = defineAbility({
  id: 'sovereign_mend',
  name: 'Sovereign Mend',
  school: SCHOOL.HOLY,
  cost: null,
  cooldown: 3000, // 300s / 5min
  castTime: 0,
  range: 0,
  flags: [ABILITY_FLAG.IGNORES_GCD],
  slot: 9,
  description: 'Heals yourself to full health. Causes Forbearance (30s).',
  execute(engine, source, target, currentTick) {
    // Check Forbearance
    if (source.classData.hasForbearance && currentTick < source.classData.forbearanceEndTick) {
      engine.match.eventBus.emit('ability_cast_failed', { sourceId: source.id, abilityId: 'sovereign_mend', reason: 'forbearance' });
      return;
    }

    // Heal self to full HP
    engine.healUnit(source, source, source.maxHp, currentTick);

    // Apply Forbearance
    source.classData.hasForbearance = true;
    source.classData.forbearanceEndTick = currentTick + 300; // 30s
  }
});

const holyRestoration = defineAbility({
  id: 'holy_restoration',
  name: 'Holy Restoration',
  school: SCHOOL.HOLY,
  cost: null, // Handled manually in execute
  cooldown: 0,
  castTime: 0,
  range: 0,
  slot: 10,
  description: 'Consumes all Holy Power to heal yourself for 4000 + 3000 per Holy Power spent.',
  execute(engine, source, target, currentTick) {
    const holyPower = source.resources.getCurrent(RESOURCE_TYPE.HOLY_POWER);
    if (holyPower < 3) {
      engine.match.eventBus.emit('ability_cast_failed', { sourceId: source.id, abilityId: 'holy_restoration', reason: 'resource' });
      return;
    }

    const healing = 4000 + (3000 * holyPower);
    source.resources.set(RESOURCE_TYPE.HOLY_POWER, 0);
    engine.healUnit(source, source, healing, currentTick);
  }
});

const unchainedGrace = defineAbility({
  id: 'unchained_grace',
  name: 'Unchained Grace',
  school: SCHOOL.HOLY,
  cost: { [RESOURCE_TYPE.MANA]: 500 },
  cooldown: 250, // 25s
  castTime: 0,
  range: 0,
  slot: 11,
  description: 'Removes roots and slows. Grants immunity to roots and slows for 8s.',
  execute(engine, source, target, currentTick) {
    // Remove roots
    CrowdControlSystem.breakRoots(source);

    // Remove known slow auras
    source.auras.remove('crippling_strike_debuff');
    source.auras.remove('glacial_chill_debuff');
    source.auras.remove('crushing_descent_slow');
    source.auras.remove('ember_wake_slow');

    // Apply Unchained Grace buff
    const aura = new Aura({
      id: 'unchained_grace_buff',
      name: 'Unchained Grace',
      type: AURA_TYPE.BUFF,
      sourceId: source.id,
      targetId: source.id,
      school: SCHOOL.HOLY,
      duration: 80, // 8s
      appliedTick: currentTick,
      isMagic: true,
      isDispellable: true,
      onApply(unit) {
        unit.classData.freedomActive = true;
      },
      onRemove(unit) {
        unit.classData.freedomActive = false;
      }
    });
    source.auras.apply(aura);
  }
});

const sanctifiedRebuff = defineAbility({
  id: 'sanctified_rebuff',
  name: 'Sanctified Rebuff',
  school: SCHOOL.PHYSICAL,
  cost: null,
  cooldown: 150, // 15s
  castTime: 0,
  range: 5,
  flags: [ABILITY_FLAG.IGNORES_GCD],
  slot: 12,
  description: 'Interrupts spellcasting and locks the school for 4s.',
  execute(engine, source, target, currentTick) {
    engine.interruptTarget(source, target, 40, currentTick);
  }
});

const valiantCharge = defineAbility({
  id: 'valiant_charge',
  name: 'Valiant Charge',
  school: SCHOOL.HOLY,
  cost: null,
  cooldown: 300, // 30s
  castTime: 0,
  range: 0,
  slot: 0,
  description: 'Increases movement speed by 100% for 4s. Breaks roots and slows on activation.',
  execute(engine, source, target, currentTick) {
    // Break roots and slows on activation
    CrowdControlSystem.breakRoots(source);
    source.auras.remove('crippling_strike_debuff');
    source.auras.remove('glacial_chill_debuff');
    source.auras.remove('crushing_descent_slow');
    source.auras.remove('ember_wake_slow');

    // Apply Valiant Charge buff
    const aura = new Aura({
      id: 'valiant_charge_buff',
      name: 'Valiant Charge',
      type: AURA_TYPE.BUFF,
      sourceId: source.id,
      targetId: source.id,
      school: SCHOOL.HOLY,
      duration: 40, // 4s
      appliedTick: currentTick,
      statMods: { moveSpeedMultiplier: 2.0 },
      isMagic: false,
      isDispellable: false
    });
    source.auras.apply(aura);
  }
});

// ---------------------------------------------------------------------------
// Class definition
// ---------------------------------------------------------------------------

export const RevenantClass = new ClassBase({
  id: 'revenant',
  name: 'Revenant',
  color: '#F5F5DC',
  accentColor: '#FFD700',
  isRanged: false,
  physicalArmor: 0.25,
  magicDR: 0.15,
  moveSpeed: 1.05,
  autoAttackDamage: 2800,
  swingTimer: 20, // 2.0s
  classData: {
    hasForbearance: false,
    forbearanceEndTick: 0,
    freedomActive: false,
    autoAttackSlow: {
      auraId: 'revenant_judgment_slow',
      name: 'Judgment',
      slowAmount: 0.7,
      duration: 60
    }
  },
  resourcePools: [
    {
      type: RESOURCE_TYPE.HOLY_POWER,
      max: 5,
      start: 0,
      regenPerSecond: 0
    },
    {
      type: RESOURCE_TYPE.MANA,
      max: 5000,
      start: 5000,
      regenPerSecond: 50
    }
  ],
  abilities: [
    hallowedStrike,
    divineReckoning,
    radiantVerdict,
    sanctifiedGale,
    emberWake,
    gavelOfLight,
    bindingPrayer,
    aegisOfDawn,
    sovereignMend,
    holyRestoration,
    unchainedGrace,
    sanctifiedRebuff,
    valiantCharge
  ],
  coreAbilityIds: ['hallowed_strike', 'radiant_verdict', 'sanctified_rebuff'],
  defaultLoadout: ['hallowed_strike', 'radiant_verdict', 'sanctified_rebuff', 'divine_reckoning', 'gavel_of_light', 'aegis_of_dawn']
});
