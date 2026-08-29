import { calculateDamage, calculateHealing, getActiveModifiersOnTarget } from './DamageFormulas.js';
import { CrowdControlSystem } from './CrowdControl.js';
import { CastSystem } from './CastSystem.js';
import { MovementSystem } from './MovementSystem.js';
import { Aura } from './Aura.js';
import { EVENTS } from '../utils/EventBus.js';
import {
  GCD_DURATION, ABILITY_FLAG, SCHOOL, CC_TYPE, AURA_TYPE,
  MELEE_RANGE, TICKS_PER_SECOND,
  DAMPENING_START_TICK, DAMPENING_PER_INTERVAL, DAMPENING_INTERVAL_TICKS, DAMPENING_CAP
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

    // 4b. Process pet auto-attacks (Harbinger demon)
    for (const unit of this.match.units) {
      this.processPetAttack(unit, currentTick);
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
      if (unit && unit.isAlive && target) {
        this.useAbility(unit, action.abilityId, target, currentTick);
      }
    }
    this.pendingActions = [];
  }

  /**
   * Attempt to use an ability
   */
  useAbility(source, abilityId, target, currentTick) {
    if (!target) return { success: false, reason: 'no_target' };
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
      // Telegraph metadata — ground indicator the client renders during the
      // cast so the player has a visible "this lands here in N seconds"
      // warning. Hostile-to-player casts of 1s+ get a telegraph; defensives /
      // self-buffs / instants do not. This is the Elden Ring read-and-react
      // pattern — see `_isThreateningAbility` for which ones flag.
      const telegraph = this._buildTelegraph(source, ability, target);
      this.match.eventBus.emit(EVENTS.ABILITY_CAST_START, {
        sourceId: source.id, abilityId, targetId: target.id, castTime: ability.castTime,
        telegraph,
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

    // CC check (skip for abilities usable while CC'd, like trinkets/CC-breaks)
    if (!source.canAct && !ability.flags?.includes(ABILITY_FLAG.USABLE_WHILE_CC)) {
      return { valid: false, reason: 'cc' };
    }

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

    // Gates check — no abilities until gates open
    if (!this.match.los.gatesOpen) return { valid: false, reason: 'gates_closed' };

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

    // Start cooldown — apply per-unit cooldown modifier (Focus upgrade etc.)
    if (ability.cooldown > 0) {
      const cdMult = source.stats.cooldownMod || 1;
      const cdTicks = Math.max(1, Math.round(ability.cooldown * cdMult));
      source.cooldowns.startCooldown(ability.id, cdTicks, currentTick);
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

  /** Decide whether a cast deserves a ground telegraph for the player to
   *  read and react to (Elden Ring style). Self-buffs, dispels, and tiny
   *  instants don't need one — only abilities that hit the player or land
   *  in a zone they can dodge out of. */
  _buildTelegraph(source, ability, target) {
    if (!ability) return null;
    if ((ability.castTime || 0) < 10) return null; // <1s — too fast to telegraph anyway
    // Skip self-cast buffs and channels handled elsewhere
    if (ability.range === 0) return null;
    if (target.id === source.id) return null;
    // Centered on the targeted unit's position when cast started — the
    // attack lands on whoever's there at completion (Elden Ring-style read).
    return {
      kind: 'circle',
      cx: target.position.x,
      cz: target.position.z,
      radius: this._inferAbilityRadius(ability),
      color: this._inferAbilityColor(ability),
      durationTicks: ability.castTime,
    };
  }

  _inferAbilityRadius(ability) {
    // Heuristic — abilities tagged AoE / nova / cleave get bigger radii.
    // Default to a 4-yard "you'll get hit if you're standing on this spot".
    const id = (ability.id || '').toLowerCase();
    if (id.includes('nova') || id.includes('shadowfury') || id.includes('cyclone')) return 8;
    if (id.includes('slam') || id.includes('cleave') || id.includes('rupture')) return 6;
    if (id.includes('cataclysm') || id.includes('meteor')) return 10;
    return 4;
  }

  _inferAbilityColor(ability) {
    const school = (ability.school || '').toLowerCase();
    if (school === 'fire')     return 0xff5520;
    if (school === 'frost')    return 0x44a8ff;
    if (school === 'shadow')   return 0xa030c8;
    if (school === 'arcane')   return 0xc060ff;
    if (school === 'holy')     return 0xffd060;
    if (school === 'nature')   return 0x40ff60;
    return 0xff3030; // physical / unknown — red
  }

  /**
   * Deal AoE damage to every alive enemy within `radius` of `center`. Returns
   * the number of units hit. Filters out allies (same team) and the source.
   * The primary target (when given) is hit first to guarantee at least one
   * application even if no other unit is in range.
   *
   * Use this for "cleave" / "burst" / "nova" / "ground" effects so a single
   * cast actually damages a mob pack instead of one mob.
   */
  dealAoeDamage(source, center, baseDamage, school, abilityId, currentTick, radius, options = {}) {
    const r2 = radius * radius;
    let hits = 0;
    const primary = options.primaryTarget;
    if (primary && primary.isAlive
        && (primary.team == null || source.team == null || primary.team !== source.team)) {
      this.dealDamage(source, primary, baseDamage, school, abilityId, currentTick, options);
      hits++;
    }
    for (const u of this.match.units) {
      if (!u.isAlive) continue;
      if (u.id === source.id) continue;
      if (u === primary) continue;
      if (u.team != null && source.team != null && u.team === source.team) continue;
      const dx = u.position.x - center.x;
      const dz = u.position.z - center.z;
      if (dx * dx + dz * dz > r2) continue;
      this.dealDamage(source, u, baseDamage, school, abilityId, currentTick, options);
      hits++;
    }
    return hits;
  }

  /** Cone-shaped AoE — hits enemies within `radius` AND inside a half-angle
   *  arc from `source` toward `dirVec` ({x,z} normalized). Half-angle in radians. */
  dealConeDamage(source, dirVec, baseDamage, school, abilityId, currentTick, radius, halfAngleRad, options = {}) {
    const r2 = radius * radius;
    let hits = 0;
    const dirLen = Math.hypot(dirVec.x, dirVec.z) || 1;
    const dx0 = dirVec.x / dirLen, dz0 = dirVec.z / dirLen;
    for (const u of this.match.units) {
      if (!u.isAlive) continue;
      if (u.id === source.id) continue;
      if (u.team != null && source.team != null && u.team === source.team) continue;
      const dx = u.position.x - source.position.x;
      const dz = u.position.z - source.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2 || d2 < 0.01) continue;
      const dLen = Math.sqrt(d2);
      const dot = (dx / dLen) * dx0 + (dz / dLen) * dz0;
      // dot >= cos(halfAngle) means within cone
      if (dot < Math.cos(halfAngleRad)) continue;
      this.dealDamage(source, u, baseDamage, school, abilityId, currentTick, options);
      hits++;
    }
    return hits;
  }

  /**
   * Deal damage from source to target
   */
  dealDamage(source, target, baseDamage, school, abilityId, currentTick, options = {}) {
    // Apply periodic damage reduction (e.g., Infernal passive vs DoTs)
    let adjustedDamage = baseDamage;
    if (options.isDot && target.classData?.periodicDR) {
      adjustedDamage = Math.round(baseDamage * (1 - target.classData.periodicDR));
    }

    const additiveModifiers = getActiveModifiersOnTarget(target);
    const result = calculateDamage(adjustedDamage, school, source, target, this.match.rng, {
      ...options,
      additiveModifiers
    });

    const actual = target.applyDamage(result.damage, school, source.id, abilityId);
    source.totalDamageDealt += result.damage;

    // Track damage attribution for kill participation (2v2/3v3)
    if (source.team != null && target.team !== source.team) {
      if (!target._damagedBy) target._damagedBy = new Set();
      target._damagedBy.add(source.id);
      // Propagate kill participation when target dies
      if (!target.isAlive && target._damagedBy) {
        for (const attackerId of target._damagedBy) {
          const attacker = this.match.getUnit(attackerId);
          if (attacker) attacker.killParticipation++;
        }
      }
    }

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
  getDampening(currentTick) {
    if (currentTick < DAMPENING_START_TICK) return 0;
    const elapsed = currentTick - DAMPENING_START_TICK;
    const intervals = Math.floor(elapsed / DAMPENING_INTERVAL_TICKS);
    return Math.min(intervals * DAMPENING_PER_INTERVAL, DAMPENING_CAP);
  }

  healUnit(source, target, baseHealing, currentTick, options = {}) {
    const effective = calculateHealing(baseHealing, source, target, options);
    const dampening = this.getDampening(currentTick);
    const dampenedHealing = Math.round(effective * (1 - dampening));
    const actual = target.applyHealing(dampenedHealing);

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
        if (source && this.match.rng.chance(0.15)) {
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
        const ability = completed.ability;
        // Re-check range and LOS at completion. Target may have moved out of
        // range or behind a pillar during the cast. Spell fizzles (no damage)
        // but resource/CD cost was already paid at cast start — same as WoW.
        if (ability.range) {
          const dist = unit.distanceTo(target);
          if (dist > ability.range) {
            this.match.eventBus.emit(EVENTS.ABILITY_CAST_FAILED, {
              sourceId: unit.id, abilityId: ability.id, reason: 'out_of_range'
            });
            return;
          }
        }
        if (ability.range > MELEE_RANGE
          && !this.match.los.hasLineOfSight(unit.position, target.position)) {
          this.match.eventBus.emit(EVENTS.ABILITY_CAST_FAILED, {
            sourceId: unit.id, abilityId: ability.id, reason: 'no_los'
          });
          return;
        }
        this.executeAbility(unit, ability, target, currentTick);
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
      // LOS re-check per tick — drain beams etc. should fizzle while the
      // target is behind a pillar but resume if the target re-emerges.
      const ability = result.channelState.ability;
      const hasLos = !target
        || ability.range <= MELEE_RANGE
        || this.match.los.hasLineOfSight(unit.position, target.position);
      if (target && hasLos && ability.channelTick) {
        ability.channelTick(this, unit, target, currentTick);
        this.match.eventBus.emit(EVENTS.CHANNEL_TICK, {
          sourceId: unit.id, abilityId: result.channelState.abilityId, targetId: result.channelState.targetId, tickCount: result.channelState.tickCount
        });
      }
    }
  }

  /**
   * Process auto-attacks
   */
  processAutoAttack(unit, currentTick) {
    if (!unit.isAlive || !unit.autoAttackEnabled || unit.autoAttackDamage === 0) return;
    if (!unit.canAct) return;
    if (unit.isCasting || unit.isChanneling) return;
    if (!this.match.los.gatesOpen) return;

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

    // Wound poison: reduce healing received (Wraith passive)
    if (unit.classData.woundPoison) {
      target.auras.apply(new Aura({
        id: 'wound_poison_debuff',
        name: 'Wound Poison',
        type: AURA_TYPE.DEBUFF,
        sourceId: unit.id,
        targetId: target.id,
        school: SCHOOL.PHYSICAL,
        duration: 120, // 12s, refreshes on each melee hit
        appliedTick: currentTick,
        healingReduction: 0.35,
        isMagic: false,
        isDispellable: false
      }));
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

    // Molten Armor: Infernal passive — deal fire damage back to melee attackers
    if (target.classData.moltenArmor && target.isAlive) {
      this.dealDamage(target, unit, 400, SCHOOL.FIRE, 'molten_armor', currentTick);
    }

    this.match.eventBus.emit(EVENTS.AUTO_ATTACK, { sourceId: unit.id, targetId: target.id });
  }

  /**
   * Process pet auto-attacks (Harbinger demon)
   */
  processPetAttack(unit, currentTick) {
    if (!unit.isAlive || !unit.classData.petAlive || !unit.classData.petDamage) return;
    if (!this.match.los.gatesOpen) return;

    if (!unit.classData._petNextSwingTick) unit.classData._petNextSwingTick = 0;
    if (currentTick < unit.classData._petNextSwingTick) return;

    const target = this.match.getOpponent(unit.id);
    if (!target || !target.isAlive) return;

    // Pet range check — must be within 30 yards of owner
    const dx = unit.position.x - target.position.x;
    const dz = unit.position.z - target.position.z;
    if (dx * dx + dz * dz > 900) return; // >30yd, out of pet range

    // Pet can detect stealthed targets within 15yd (breaks stealth on hit)
    if (target.stealthed) {
      const dx = unit.position.x - target.position.x;
      const dz = unit.position.z - target.position.z;
      if (dx * dx + dz * dz > 225) return; // >15yd, can't detect
      this.breakStealth(target, currentTick);
    }

    this.dealDamage(unit, target, unit.classData.petDamage, SCHOOL.SHADOW, 'pet_attack', currentTick);
    unit.classData._petNextSwingTick = currentTick + 20; // 2s swing timer
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
