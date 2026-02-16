import { calculateDamage, calculateHealing, getActiveModifiersOnTarget } from './DamageFormulas.js';
import { CrowdControlSystem } from './CrowdControl.js';
import { CastSystem } from './CastSystem.js';
import { MovementSystem } from './MovementSystem.js';
import { Aura } from './Aura.js';
import { EVENTS } from '../utils/EventBus.js';
import {
  GCD_DURATION, ABILITY_FLAG, SCHOOL, CC_TYPE, AURA_TYPE,
  MELEE_RANGE, TICKS_PER_SECOND
} from '../constants.js';

export class CombatEngine {
  constructor(matchState) {
    this.match = matchState;
    this.movement = new MovementSystem(matchState.los);
    this.pendingActions = []; // Actions queued for this tick
  }

  /**
   * Process one game tick
   */
  tick() {
    const currentTick = this.match.tick;

    // 1. Process pending ability actions (from player input or AI)
    this.processPendingActions(currentTick);

    // 2. Process casts and channels
    for (const unit of this.match.units) {
      this.processCasting(unit, currentTick);
      this.processChanneling(unit, currentTick);
    }

    // 3. Process movement
    for (const unit of this.match.units) {
      this.movement.moveUnit(unit);
    }

    // 4. Process auto-attacks
    for (const unit of this.match.units) {
      this.processAutoAttack(unit, currentTick);
    }

    // 5. Tick units (resources, cooldowns, auras, CC expiry)
    for (const unit of this.match.units) {
      const tickedAuras = unit.tick(currentTick);
      this.processAuraTicks(unit, tickedAuras, currentTick);
    }

    // 6. Process arena events
    this.processArenaEvents(currentTick);

    // 7. Check win condition
    this.match.checkWinCondition();

    // 8. Advance tick
    this.match.tick++;
  }

  /**
   * Queue an ability use for this tick
   */
  queueAbility(unitId, abilityId, targetId = null) {
    this.pendingActions.push({ unitId, abilityId, targetId });
  }

  /**
   * Process all queued ability actions
   */
  processPendingActions(currentTick) {
    for (const action of this.pendingActions) {
      const unit = this.match.getUnit(action.unitId);
      // For self-cast abilities (range=0), pass unit as target instead of opponent
      const ability = unit?.abilities.get(action.abilityId);
      let target;
      if (ability && ability.range === 0) {
        target = unit; // Self-cast
      } else if (action.targetId) {
        target = this.match.getUnit(action.targetId);
      } else {
        target = this.match.getOpponent(action.unitId);
      }
      if (unit && unit.isAlive) {
        this.useAbility(unit, action.abilityId, target, currentTick);
      }
    }
    this.pendingActions = [];
  }

  /**
   * Attempt to use an ability
   */
  useAbility(source, abilityId, target, currentTick) {
    const ability = source.abilities.get(abilityId);
    if (!ability) return { success: false, reason: 'unknown_ability' };

    // Validate ability use
    const validation = this.validateAbility(source, ability, target, currentTick);
    if (!validation.valid) {
      this.match.eventBus.emit(EVENTS.ABILITY_CAST_FAILED, {
        sourceId: source.id, abilityId, reason: validation.reason
      });
      return { success: false, reason: validation.reason };
    }

    // Handle different ability types
    if (ability.castTime > 0 && !ability.flags?.includes(ABILITY_FLAG.CHANNEL)) {
      // Start casting
      CastSystem.startCast(source, ability, target.id, currentTick);
      this.match.eventBus.emit(EVENTS.ABILITY_CAST_START, {
        sourceId: source.id, abilityId, targetId: target.id, castTime: ability.castTime
      });
    } else if (ability.flags?.includes(ABILITY_FLAG.CHANNEL)) {
      // Start channeling
      CastSystem.startChannel(source, ability, target.id, currentTick);
      this.match.eventBus.emit(EVENTS.CHANNEL_START, {
        sourceId: source.id, abilityId, targetId: target.id
      });
      // Spend resources and start GCD for channels too
      this.spendResources(source, ability);
      if (!ability.flags?.includes(ABILITY_FLAG.IGNORES_GCD)) {
        source.startGCD(currentTick, GCD_DURATION);
      }
    } else {
      // Instant cast — execute immediately
      this.executeAbility(source, ability, target, currentTick);
    }

    return { success: true };
  }

  /**
   * Validate if an ability can be used
   */
  validateAbility(source, ability, target, currentTick) {
    // Dead check
    if (!source.isAlive) return { valid: false, reason: 'dead' };

    // CC check
    if (!source.canAct) return { valid: false, reason: 'cc' };

    // Silence check for spells
    if (source.isSilenced && ability.school !== SCHOOL.PHYSICAL) {
      return { valid: false, reason: 'silenced' };
    }

    // GCD check
    if (!ability.flags?.includes(ABILITY_FLAG.IGNORES_GCD) && source.isOnGCD(currentTick)) {
      return { valid: false, reason: 'gcd' };
    }

    // Cooldown check
    if (!source.cooldowns.isReady(ability.id, currentTick)) {
      return { valid: false, reason: 'cooldown' };
    }

    // Already casting check — instant abilities (castTime 0) can always be used while casting
    if (source.isCasting && ability.castTime > 0 && !ability.flags?.includes(ABILITY_FLAG.USABLE_WHILE_CASTING)) {
      return { valid: false, reason: 'casting' };
    }

    // Resource check
    if (ability.cost) {
      for (const [resourceType, amount] of Object.entries(ability.cost)) {
        if (!source.resources.canAfford(resourceType, amount)) {
          return { valid: false, reason: 'resource' };
        }
      }
    }

    // Stealth requirement
    if (ability.flags?.includes(ABILITY_FLAG.REQUIRES_STEALTH) && !source.stealthed) {
      return { valid: false, reason: 'requires_stealth' };
    }

    // Target stealth check — can't target stealthed enemies
    if (target && target.stealthed && target.id !== source.id) {
      return { valid: false, reason: 'target_stealthed' };
    }

    // Range check
    if (target && ability.range) {
      const dist = source.distanceTo(target);
      if (dist > ability.range) return { valid: false, reason: 'out_of_range' };
      if (ability.minRange && dist < ability.minRange) return { valid: false, reason: 'too_close' };
    }

    // LoS check
    if (target && ability.range > MELEE_RANGE) {
      if (!this.match.los.hasLineOfSight(source.position, target.position)) {
        return { valid: false, reason: 'no_los' };
      }
    }

    // Spell school lockout check
    if (ability.school && source.spellSchools.isLocked(ability.school, currentTick)) {
      return { valid: false, reason: 'school_locked' };
    }

    return { valid: true };
  }

  /**
   * Execute an ability's effects (after cast completes or for instants)
   */
  executeAbility(source, ability, target, currentTick) {
    // Spend resources
    this.spendResources(source, ability);

    // Start GCD
    if (!ability.flags?.includes(ABILITY_FLAG.IGNORES_GCD)) {
      source.startGCD(currentTick, GCD_DURATION);
    }

    // Start cooldown
    if (ability.cooldown > 0) {
      source.cooldowns.startCooldown(ability.id, ability.cooldown, currentTick);
    }

    // Break stealth on offensive ability (any ability that targets an enemy)
    if (source.stealthed) {
      const isSelfBuff = !target || target.id === source.id;
      if (!isSelfBuff) {
        this.breakStealth(source, currentTick);
      }
    }

    // Execute ability effects
    if (ability.execute) {
      ability.execute(this, source, target, currentTick);
    } else {
      this.executeDefaultEffects(source, ability, target, currentTick);
    }

    // Emit event
    this.match.eventBus.emit(EVENTS.ABILITY_CAST_SUCCESS, {
      sourceId: source.id,
      abilityId: ability.id,
      targetId: target?.id
    });
  }

  /**
   * Default ability effect execution
   */
  executeDefaultEffects(source, ability, target, currentTick) {
    // Direct damage
    if (ability.damage) {
      this.dealDamage(source, target, ability.damage, ability.school, ability.id, currentTick, {
        ignoresArmor: ability.flags?.includes(ABILITY_FLAG.IGNORES_ARMOR),
        guaranteedCrit: ability.flags?.includes(ABILITY_FLAG.GUARANTEED_CRIT)
      });
    }

    // Direct healing (self)
    if (ability.healing) {
      this.healUnit(source, source, ability.healing, currentTick);
    }

    // Apply CC
    if (ability.cc) {
      CrowdControlSystem.applyCC(
        source, target, ability.cc.type,
        ability.cc.duration, currentTick,
        {
          breakOnDamage: ability.cc.breakOnDamage,
          damageThreshold: ability.cc.damageThreshold
        }
      );
    }

    // Apply aura/debuff
    if (ability.applyAura) {
      const auraConfig = { ...ability.applyAura, sourceId: source.id, appliedTick: currentTick };
      const auraTarget = ability.applyAura.onSelf ? source : target;
      auraTarget.auras.apply(new Aura(auraConfig));
    }

    // Apply absorb shield
    if (ability.absorb) {
      const absorTarget = ability.absorb.onSelf !== false ? source : target;
      absorTarget.addAbsorb(ability.absorb.amount, currentTick + (ability.absorb.duration || 100), ability.id);
    }

    // Generate resources
    if (ability.generateResource) {
      for (const [type, amount] of Object.entries(ability.generateResource)) {
        source.resources.gain(type, amount);
      }
    }
  }

  /**
   * Deal damage from source to target
   */
  dealDamage(source, target, baseDamage, school, abilityId, currentTick, options = {}) {
    const additiveModifiers = getActiveModifiersOnTarget(target);
    const result = calculateDamage(baseDamage, school, source, target, this.match.rng, {
      ...options,
      additiveModifiers
    });

    const actual = target.applyDamage(result.damage, school, source.id, abilityId);
    source.totalDamageDealt += result.damage;

    // Cauterize passive (Infernal): heal when dropping below 30% HP, once per match
    if (target.isAlive && target.hp < target.maxHp * 0.3 && target.classData.cauterize && !target.classData._cauterizeUsed) {
      target.classData._cauterizeUsed = true;
      const cauterizeHot = new Aura({
        id: 'cauterize_hot',
        name: 'Cauterize',
        type: AURA_TYPE.HOT,
        sourceId: target.id,
        targetId: target.id,
        school: SCHOOL.FIRE,
        duration: 40, // 4s
        appliedTick: currentTick,
        isPeriodic: true,
        tickInterval: 10, // every 1s
        tickHealing: 2000, // 8000 total over 4s
        isMagic: false,
        isDispellable: false
      });
      target.auras.apply(cauterizeHot);
    }

    this.match.eventBus.emit(EVENTS.DAMAGE_DEALT, {
      sourceId: source.id,
      targetId: target.id,
      abilityId,
      amount: result.damage,
      school,
      isCrit: result.isCrit,
      overkill: Math.max(0, result.damage - target.hp - actual)
    });

    // Apply pushback on physical damage during cast
    if (school === SCHOOL.PHYSICAL && target.isCasting) {
      CastSystem.applyPushback(target);
    }

    return result;
  }

  /**
   * Heal a unit
   */
  healUnit(source, target, baseHealing, currentTick, options = {}) {
    const effective = calculateHealing(baseHealing, source, target, options);
    const actual = target.applyHealing(effective);

    this.match.eventBus.emit(EVENTS.HEALING_DONE, {
      sourceId: source.id,
      targetId: target.id,
      amount: actual,
      overhealing: effective - actual
    });

    return actual;
  }

  /**
   * Process aura periodic ticks
   */
  processAuraTicks(unit, tickedAuras, currentTick) {
    for (const aura of tickedAuras) {
      if (aura.onTick) {
        aura.onTick(this, unit, aura, currentTick);
        continue;
      }

      // Default periodic behavior
      if (aura.tickDamage > 0) {
        const source = this.match.getUnit(aura.sourceId);
        if (source) {
          this.dealDamage(source, unit, aura.tickDamage, aura.school, aura.id, currentTick, {
            isDot: true, ignoresArmor: aura.data?.ignoresArmor
          });
        }
      }

      if (aura.tickHealing > 0) {
        const source = this.match.getUnit(aura.sourceId);
        if (source) {
          this.healUnit(source, unit, aura.tickHealing, currentTick);
        }
      }

      // Soul shard generation from DoTs (Harbinger)
      if (aura.data?.generatesSoulShards && aura.tickDamage > 0) {
        const source = this.match.getUnit(aura.sourceId);
        if (source && this.match.rng.chance(0.10)) {
          source.resources.gain('soul_shards', 1);
        }
      }

      this.match.eventBus.emit(EVENTS.AURA_TICK, {
        unitId: unit.id, auraId: aura.id, damage: aura.tickDamage, healing: aura.tickHealing
      });
    }
  }

  /**
   * Process completed casts
   */
  processCasting(unit, currentTick) {
    const completed = CastSystem.checkCastComplete(unit, currentTick);
    if (completed) {
      const target = this.match.getUnit(completed.targetId);
      if (target && target.isAlive) {
        this.executeAbility(unit, completed.ability, target, currentTick);
      }
    }
  }

  /**
   * Process channel ticks and completion
   */
  processChanneling(unit, currentTick) {
    const result = CastSystem.checkChannelTick(unit, currentTick);
    if (!result) return;

    if (result.completed) {
      // Channel finished
      this.match.eventBus.emit(EVENTS.CHANNEL_END, {
        sourceId: unit.id, abilityId: result.channelState.abilityId
      });
    } else if (result.tick) {
      // Channel tick
      const target = this.match.getUnit(result.channelState.targetId);
      if (target && result.channelState.ability.channelTick) {
        result.channelState.ability.channelTick(this, unit, target, currentTick);
      }
      this.match.eventBus.emit(EVENTS.CHANNEL_TICK, {
        sourceId: unit.id, abilityId: result.channelState.abilityId, targetId: result.channelState.targetId, tickCount: result.channelState.tickCount
      });
    }
  }

  /**
   * Process auto-attacks
   */
  processAutoAttack(unit, currentTick) {
    if (!unit.isAlive || !unit.autoAttackEnabled || unit.autoAttackDamage === 0) return;
    if (!unit.canAct) return;
    if (unit.isCasting || unit.isChanneling) return;

    if (currentTick < unit.nextSwingTick) return;

    const target = this.match.getOpponent(unit.id);
    if (!target || !target.isAlive) return;
    if (target.stealthed) return;
    if (!unit.isInMeleeRange(target)) return;

    // Swing
    unit.faceTarget(target);
    this.dealDamage(unit, target, unit.autoAttackDamage, SCHOOL.PHYSICAL, 'auto_attack', currentTick);
    unit.nextSwingTick = currentTick + unit.swingTimer;

    // Rage generation from auto-attacks (Tyrant class)
    if (unit.classData.ragePerSwing) {
      unit.resources.gain('rage', unit.classData.ragePerSwing);
    }

    // Auto-attack passive slow (melee classes apply a movement slow on hit)
    if (unit.classData.autoAttackSlow) {
      const slowConfig = unit.classData.autoAttackSlow;
      target.auras.apply(new Aura({
        id: slowConfig.auraId,
        name: slowConfig.name || 'Slowed',
        type: AURA_TYPE.DEBUFF,
        sourceId: unit.id,
        targetId: target.id,
        school: SCHOOL.PHYSICAL,
        duration: slowConfig.duration,
        appliedTick: currentTick,
        statMods: { moveSpeedMultiplier: slowConfig.slowAmount },
        isMagic: false,
        isDispellable: false
      }));
    }

    this.match.eventBus.emit(EVENTS.AUTO_ATTACK, { sourceId: unit.id, targetId: target.id });
  }

  /**
   * Process arena dynamic events
   */
  processArenaEvents(currentTick) {
    for (let i = this.match.dynamicEvents.length - 1; i >= 0; i--) {
      const event = this.match.dynamicEvents[i];
      if (event.tick) event.tick(this, currentTick);
      if (event.expired) {
        this.match.dynamicEvents.splice(i, 1);
      }
    }
  }

  /**
   * Spend ability resources
   */
  spendResources(source, ability) {
    if (!ability.cost) return;
    for (const [type, amount] of Object.entries(ability.cost)) {
      source.resources.spend(type, amount);
    }
  }

  /**
   * Break stealth
   */
  breakStealth(unit, currentTick) {
    if (!unit.stealthed) return;
    unit.stealthed = false;
    this.match.eventBus.emit(EVENTS.STEALTH_BREAK, { unitId: unit.id });
  }

  /**
   * Enter stealth
   */
  enterStealth(unit, currentTick) {
    unit.stealthed = true;
    unit.moveTarget = null; // Stop moving for stealth
    this.match.eventBus.emit(EVENTS.STEALTH_ENTER, { unitId: unit.id });
  }

  /**
   * Interrupt a target
   */
  interruptTarget(source, target, lockoutDuration, currentTick) {
    return CastSystem.interrupt(target, source, lockoutDuration, currentTick);
  }
}
