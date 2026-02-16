import { defineAbility } from '../abilities/AbilityBase.js';
import { ClassBase } from './ClassBase.js';
import { SCHOOL, CC_TYPE, ABILITY_FLAG, RESOURCE_TYPE, AURA_TYPE } from '../constants.js';
import { Aura } from '../engine/Aura.js';
import { CrowdControlSystem } from '../engine/CrowdControl.js';

// ─── Abilities ──────────────────────────────────────────────────────────────────

const viperLash = defineAbility({
  id: 'viper_lash',
  name: 'Viper Lash',
  school: SCHOOL.PHYSICAL,
  cost: { [RESOURCE_TYPE.ENERGY]: 40 },
  cooldown: 0,
  castTime: 0,
  range: 5,
  slot: 1,
  description: 'A quick strike that deals 5000 damage and generates 1 combo point (25% chance for 2).',
  execute(engine, source, target, currentTick) {
    engine.dealDamage(source, target, 5000, SCHOOL.PHYSICAL, 'viper_lash', currentTick);
    const points = engine.match.rng.chance(0.25) ? 2 : 1;
    source.resources.gain(RESOURCE_TYPE.COMBO_POINTS, points);
  }
});

const throatOpener = defineAbility({
  id: 'throat_opener',
  name: 'Throat Opener',
  school: SCHOOL.PHYSICAL,
  cost: { [RESOURCE_TYPE.ENERGY]: 50 },
  cooldown: 0,
  castTime: 0,
  range: 5,
  flags: [ABILITY_FLAG.REQUIRES_STEALTH],
  slot: 2,
  description: 'A powerful strike from stealth dealing 10000 damage and generating 2 combo points.',
  execute(engine, source, target, currentTick) {
    engine.breakStealth(source, currentTick);
    engine.dealDamage(source, target, 10000, SCHOOL.PHYSICAL, 'throat_opener', currentTick);
    source.resources.gain(RESOURCE_TYPE.COMBO_POINTS, 2);
  }
});

const grimFlurry = defineAbility({
  id: 'grim_flurry',
  name: 'Grim Flurry',
  school: SCHOOL.PHYSICAL,
  cost: { [RESOURCE_TYPE.ENERGY]: 35 },
  cooldown: 0,
  castTime: 0,
  range: 5,
  slot: 3,
  description: 'A devastating finishing move. Deals 2500 + 2500 per combo point consumed.',
  execute(engine, source, target, currentTick) {
    const comboPoints = source.resources.getCurrent(RESOURCE_TYPE.COMBO_POINTS);
    const damage = 2500 + (2500 * comboPoints);
    engine.dealDamage(source, target, damage, SCHOOL.PHYSICAL, 'grim_flurry', currentTick);
    source.resources.set(RESOURCE_TYPE.COMBO_POINTS, 0);
  }
});

const nerveStrike = defineAbility({
  id: 'nerve_strike',
  name: 'Nerve Strike',
  school: SCHOOL.PHYSICAL,
  cost: { [RESOURCE_TYPE.ENERGY]: 25 },
  cooldown: 200,
  castTime: 0,
  range: 5,
  slot: 4,
  description: 'A finishing move that stuns the target for 1 second per combo point.',
  execute(engine, source, target, currentTick) {
    const comboPoints = source.resources.getCurrent(RESOURCE_TYPE.COMBO_POINTS);
    const stunDuration = 10 + (10 * comboPoints);
    CrowdControlSystem.applyCC(source, target, CC_TYPE.STUN, stunDuration, currentTick);
    source.resources.set(RESOURCE_TYPE.COMBO_POINTS, 0);
  }
});

const serratedWound = defineAbility({
  id: 'serrated_wound',
  name: 'Serrated Wound',
  school: SCHOOL.PHYSICAL,
  cost: { [RESOURCE_TYPE.ENERGY]: 25 },
  cooldown: 0,
  castTime: 0,
  range: 5,
  slot: 8,
  description: 'A finishing move that causes the target to bleed for 12 seconds. Damage scales with combo points.',
  execute(engine, source, target, currentTick) {
    const comboPoints = source.resources.getCurrent(RESOURCE_TYPE.COMBO_POINTS);
    const tickDamage = 150 * comboPoints;
    target.auras.apply(new Aura({
      id: 'serrated_wound_dot',
      name: 'Serrated Wound',
      type: AURA_TYPE.DOT,
      sourceId: source.id,
      targetId: target.id,
      school: SCHOOL.PHYSICAL,
      duration: 120,
      appliedTick: currentTick,
      isPeriodic: true,
      tickInterval: 10,
      tickDamage: tickDamage,
      isMagic: false,
      data: { ignoresArmor: true }
    }));
    source.resources.set(RESOURCE_TYPE.COMBO_POINTS, 0);
  }
});

const blackjack = defineAbility({
  id: 'blackjack',
  name: 'Blackjack',
  school: SCHOOL.PHYSICAL,
  cost: { [RESOURCE_TYPE.ENERGY]: 40 },
  cooldown: 0,
  castTime: 0,
  range: 5,
  flags: [ABILITY_FLAG.REQUIRES_STEALTH],
  slot: 9,
  description: 'A stunning attack from stealth that incapacitates the target for 4 seconds and generates 2 combo points.',
  execute(engine, source, target, currentTick) {
    engine.breakStealth(source, currentTick);
    CrowdControlSystem.applyCC(source, target, CC_TYPE.STUN, 40, currentTick);
    source.resources.gain(RESOURCE_TYPE.COMBO_POINTS, 2);
  }
});

const veilOfNight = defineAbility({
  id: 'veil_of_night',
  name: 'Veil of Night',
  school: SCHOOL.PHYSICAL,
  cost: null,
  cooldown: 1200,
  castTime: 0,
  range: 0,
  flags: [ABILITY_FLAG.IGNORES_GCD],
  slot: 6,
  description: 'Vanish from sight, removing all DoTs and CC effects and entering stealth.',
  execute(engine, source, target, currentTick) {
    source.auras.removeAllDebuffs();
    engine.enterStealth(source, currentTick);
    CrowdControlSystem.removeAllCC(source);
  }
});

const shadeShift = defineAbility({
  id: 'shade_shift',
  name: 'Shade Shift',
  school: SCHOOL.PHYSICAL,
  cost: null,
  cooldown: 120,
  castTime: 0,
  range: 25,
  flags: [ABILITY_FLAG.IGNORES_GCD],
  slot: 5,
  description: 'Teleport behind the target and gain a buff that makes the next ability a guaranteed crit.',
  execute(engine, source, target, currentTick) {
    // Teleport behind target (2 yards behind their facing direction)
    source.position.x = target.position.x - Math.sin(target.facing) * 2;
    source.position.z = target.position.z - Math.cos(target.facing) * 2;
    // Apply shade shift buff for guaranteed crit
    source.auras.apply(new Aura({
      id: 'shade_shift_buff',
      name: 'Shade Shift',
      type: AURA_TYPE.BUFF,
      sourceId: source.id,
      targetId: source.id,
      school: SCHOOL.PHYSICAL,
      duration: 30,
      appliedTick: currentTick,
      isMagic: false,
      onApply(unit) {
        unit.classData.shadowStepCrit = true;
      },
      onRemove(unit) {
        unit.classData.shadowStepCrit = false;
      }
    }));
  }
});

const phantasmDodge = defineAbility({
  id: 'phantasm_dodge',
  name: 'Phantasm Dodge',
  school: SCHOOL.PHYSICAL,
  cost: null,
  cooldown: 1200,
  castTime: 0,
  range: 0,
  flags: [ABILITY_FLAG.IGNORES_GCD],
  slot: 7,
  description: 'Become immune to physical damage for 10 seconds.',
  execute(engine, source, target, currentTick) {
    source.auras.apply(new Aura({
      id: 'phantasm_dodge_buff',
      name: 'Phantasm Dodge',
      type: AURA_TYPE.BUFF,
      sourceId: source.id,
      targetId: source.id,
      school: SCHOOL.PHYSICAL,
      duration: 100,
      appliedTick: currentTick,
      isMagic: false,
      onApply(unit) {
        unit.immuneToPhysical = true;
      },
      onRemove(unit) {
        unit.immuneToPhysical = false;
      }
    }));
  }
});

const umbralShroud = defineAbility({
  id: 'umbral_shroud',
  name: 'Umbral Shroud',
  school: SCHOOL.PHYSICAL,
  cost: null,
  cooldown: 900,
  castTime: 0,
  range: 0,
  flags: [ABILITY_FLAG.IGNORES_GCD],
  slot: 10,
  description: 'Remove all magic debuffs and become immune to magic damage for 5 seconds.',
  execute(engine, source, target, currentTick) {
    source.auras.removeAllMagicDebuffs();
    source.auras.apply(new Aura({
      id: 'umbral_shroud_buff',
      name: 'Umbral Shroud',
      type: AURA_TYPE.BUFF,
      sourceId: source.id,
      targetId: source.id,
      school: SCHOOL.PHYSICAL,
      duration: 50,
      appliedTick: currentTick,
      isMagic: false,
      onApply(unit) {
        unit.immuneToMagic = true;
      },
      onRemove(unit) {
        unit.immuneToMagic = false;
      }
    }));
  }
});

const bloodTincture = defineAbility({
  id: 'blood_tincture',
  name: 'Blood Tincture',
  school: SCHOOL.PHYSICAL,
  cost: { [RESOURCE_TYPE.ENERGY]: 30 },
  cooldown: 300,
  castTime: 0,
  range: 0,
  slot: 11,
  description: 'Drink a healing vial that restores 15000 health over 6 seconds.',
  execute(engine, source, target, currentTick) {
    source.auras.apply(new Aura({
      id: 'blood_tincture_hot',
      name: 'Blood Tincture',
      type: AURA_TYPE.HOT,
      sourceId: source.id,
      targetId: source.id,
      school: SCHOOL.PHYSICAL,
      duration: 60,
      appliedTick: currentTick,
      isPeriodic: true,
      tickInterval: 10,
      tickHealing: 2500,
      isMagic: false
    }));
  }
});

const throatJab = defineAbility({
  id: 'throat_jab',
  name: 'Throat Jab',
  school: SCHOOL.PHYSICAL,
  cost: null,
  cooldown: 150,
  castTime: 0,
  range: 5,
  flags: [ABILITY_FLAG.IGNORES_GCD],
  slot: 12,
  description: 'Interrupt the target, locking out their spell school for 5 seconds.',
  execute(engine, source, target, currentTick) {
    engine.interruptTarget(source, target, 50, currentTick);
  }
});

const frenzyEdge = defineAbility({
  id: 'frenzy_edge',
  name: 'Frenzy Edge',
  school: SCHOOL.PHYSICAL,
  cost: null,
  cooldown: 450,
  castTime: 0,
  range: 0,
  slot: 13,
  description: 'Enter a flurry of blades, increasing damage dealt by 30% and energy regeneration by 30% for 12 seconds.',
  execute(engine, source, target, currentTick) {
    source.auras.apply(new Aura({
      id: 'frenzy_edge_buff',
      name: 'Frenzy Edge',
      type: AURA_TYPE.BUFF,
      sourceId: source.id,
      targetId: source.id,
      school: SCHOOL.PHYSICAL,
      duration: 120,
      appliedTick: currentTick,
      statMods: { damageDealtMod: 1.30 },
      isMagic: false,
      onApply(unit) {
        unit.classData.energyRegenMod = 1.3;
      },
      onRemove(unit) {
        unit.classData.energyRegenMod = 1.0;
      }
    }));
  }
});

const shadowmeld = defineAbility({
  id: 'shadowmeld',
  name: 'Shadowmeld',
  school: SCHOOL.PHYSICAL,
  cost: null,
  cooldown: 80,
  castTime: 0,
  range: 0,
  slot: 14,
  description: 'Enter stealth mode. Only usable out of combat.',
  execute(engine, source, target, currentTick) {
    if (source.inCombat) {
      engine.match.eventBus.emit('ability_cast_failed', { sourceId: source.id, abilityId: 'shadowmeld', reason: 'in_combat' });
      return;
    }
    engine.enterStealth(source, currentTick);
  }
});

// ─── Class Definition ───────────────────────────────────────────────────────────

export default new ClassBase({
  id: 'wraith',
  name: 'Wraith',
  description: 'A deadly melee assassin that strikes from the shadows. Masters of combo point finishers, stealth openers, and evasive cooldowns.',
  color: '#2D1B69',
  accentColor: '#1a1a2e',
  isRanged: false,

  physicalArmor: 0.15,
  magicDR: 0.05,
  moveSpeed: 1.10,

  autoAttackDamage: 2500,
  swingTimer: 14,

  classData: {
    shadowStepCrit: false,
    energyRegenMod: 1.0,
    autoAttackSlow: {
      auraId: 'crippling_poison',
      name: 'Crippling Poison',
      slowAmount: 0.7,
      duration: 80
    }
  },

  resourcePools: [
    {
      type: RESOURCE_TYPE.ENERGY,
      max: 100,
      start: 100,
      regenPerSecond: 10
    },
    {
      type: RESOURCE_TYPE.COMBO_POINTS,
      max: 5,
      start: 0,
      regenPerSecond: 0
    }
  ],

  abilities: [
    viperLash,
    throatOpener,
    grimFlurry,
    nerveStrike,
    serratedWound,
    blackjack,
    veilOfNight,
    shadeShift,
    phantasmDodge,
    umbralShroud,
    bloodTincture,
    throatJab,
    frenzyEdge,
    shadowmeld
  ],
  coreAbilityIds: ['viper_lash', 'grim_flurry', 'throat_jab'],
  defaultLoadout: ['viper_lash', 'grim_flurry', 'serrated_wound', 'shade_shift', 'veil_of_night', 'nerve_strike']
});
