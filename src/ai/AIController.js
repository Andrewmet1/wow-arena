import { CC_TYPE, MELEE_RANGE, SCHOOL } from '../constants.js';
import { CrowdControlSystem } from '../engine/CrowdControl.js';

/**
 * AI states for the behavior tree
 */
const AI_STATE = {
  EMERGENCY: 'emergency',
  BURST_WINDOW: 'burst_window',
  CC_CHAIN: 'cc_chain',
  PRESSURE: 'pressure',
  KITE: 'kite',
  CHASE: 'chase',
  PILLAR_PLAY: 'pillar_play'
};

export class AIController {
  constructor(unitId, difficulty = 'medium') {
    this.unitId = unitId;
    this.difficulty = difficulty;
    this.state = AI_STATE.PRESSURE;

    // Reaction time in ticks based on difficulty
    this.reactionDelay = {
      easy: 2,    // 200ms
      medium: 1,  // 100ms
      hard: 0,    // instant
      sim: 0      // instant
    }[difficulty] || 1;

    // Chase re-path delay — melee only updates chase path every N ticks
    this._lastChaseTick = 0;
    this._chaseUpdateInterval = {
      easy: 5,    // 500ms
      medium: 3,  // 300ms
      hard: 2,    // 200ms
      sim: 1      // 100ms
    }[difficulty] || 3;

    // Track enemy cooldowns
    this.enemyCooldowns = new Map(); // abilityId -> { usedAtTick, cooldown }
    this.lastDecisionTick = -10;

    // Pending action (delayed by reaction time)
    this.pendingAction = null;
    this.pendingActionTick = 0;

    // Timers to prevent indefinite defensive play
    this._pillarPlayStart = null;
    this._emergencyStart = null;

    // Targeting
    this.currentTarget = null;
  }

  /**
   * Main decision function called every tick
   */
  decide(matchState, engine, currentTick) {
    const unit = matchState.getUnit(this.unitId);

    if (!unit || !unit.isAlive) return;

    // Select target — re-evaluate if current target is dead
    const enemies = matchState.getEnemies(this.unitId);
    if (enemies.length === 0) return;

    if (!this.currentTarget || !matchState.getUnit(this.currentTarget)?.isAlive) {
      // Pick nearest alive enemy
      let nearest = enemies[0];
      let nearestDist = unit.distanceTo(nearest);
      for (let i = 1; i < enemies.length; i++) {
        const dist = unit.distanceTo(enemies[i]);
        if (dist < nearestDist) {
          nearest = enemies[i];
          nearestDist = dist;
        }
      }
      this.currentTarget = nearest.id;
      matchState.setTarget(this.unitId, this.currentTarget);
    }

    const enemy = matchState.getUnit(this.currentTarget);

    // If target is stealthed, lose them — stop chasing and casting
    if (enemy && enemy.stealthed) {
      engine.movement.stop(unit);
      this.pendingAction = null;
      return;
    }

    // Process pending delayed action
    if (this.pendingAction && currentTick >= this.pendingActionTick) {
      engine.queueAbility(this.unitId, this.pendingAction.abilityId, this.pendingAction.targetId);
      this.pendingAction = null;
    }

    // Don't decide every tick to save performance
    if (currentTick - this.lastDecisionTick < 1) return;
    this.lastDecisionTick = currentTick;

    // If we can't act, just handle movement
    if (!unit.canAct) {
      return;
    }

    // Don't interrupt our own casts
    if (unit.isCasting || unit.isChanneling) {
      // But DO interrupt enemy casts if we have an instant interrupt available
      this.tryInterrupt(unit, enemy, engine, matchState, currentTick);
      return;
    }

    // Select behavior state
    this.state = this.selectState(unit, enemy, matchState, currentTick);

    // Handle movement
    this.handleMovement(unit, enemy, engine, matchState, currentTick);

    // Select and queue ability
    const ability = this.selectAbility(unit, enemy, engine, matchState, currentTick);
    if (ability) {
      if (this.reactionDelay > 0) {
        this.pendingAction = { abilityId: ability.id, targetId: enemy.id };
        this.pendingActionTick = currentTick + this.reactionDelay;
      } else {
        engine.queueAbility(this.unitId, ability.id, enemy.id);
      }
    }
  }

  /**
   * Select behavior state based on current situation
   */
  selectState(unit, enemy, matchState, currentTick) {
    const hpPercent = unit.hp / unit.maxHp;
    const enemyHpPercent = enemy.hp / enemy.maxHp;
    const distance = unit.distanceTo(enemy);
    const isRanged = unit.classData.isRanged || this.isRangedClass(unit);

    // EMERGENCY: Very low HP — but force fighting after 3s to prevent infinite kiting
    if (hpPercent < 0.15) {
      if (!this._emergencyStart) this._emergencyStart = currentTick;
      if (currentTick - this._emergencyStart < 30) { // 3 seconds max
        return AI_STATE.EMERGENCY;
      }
      // After 3s of emergency, fall through to PRESSURE to force a fight
    } else {
      this._emergencyStart = null;
    }

    // PILLAR_PLAY: Low HP and waiting for defensive CDs — but only for 5 seconds max
    if (hpPercent < 0.30 && !this.hasDefensiveReady(unit, currentTick)) {
      if (!this._pillarPlayStart) this._pillarPlayStart = currentTick;
      if (currentTick - this._pillarPlayStart < 50) { // 5 seconds max
        return AI_STATE.PILLAR_PLAY;
      }
    } else {
      this._pillarPlayStart = null;
    }

    // BURST_WINDOW: All burst CDs ready and enemy vulnerable
    if (this.hasBurstReady(unit, currentTick) && !this.enemyHasDefensiveReady(enemy, currentTick)) {
      return AI_STATE.BURST_WINDOW;
    }

    // CC_CHAIN: Set up CC for burst or control
    if (this.hasCCReady(unit, currentTick) && this.hasBurstReady(unit, currentTick)) {
      return AI_STATE.CC_CHAIN;
    }

    // KITE: Ranged class with melee in face
    if (isRanged && distance < 10) {
      return AI_STATE.KITE;
    }

    // CHASE: Melee class with enemy out of range
    if (!isRanged && distance > MELEE_RANGE + 2) {
      return AI_STATE.CHASE;
    }

    return AI_STATE.PRESSURE;
  }

  /**
   * Handle movement based on state
   */
  handleMovement(unit, enemy, engine, matchState, currentTick) {
    const distance = unit.distanceTo(enemy);
    const isRanged = this.isRangedClass(unit);

    // Melee chase uses delayed re-pathing to create kiting windows
    const canRepath = (currentTick - this._lastChaseTick >= this._chaseUpdateInterval);

    switch (this.state) {
      case AI_STATE.KITE:
        engine.movement.moveAway(unit, enemy, 28);
        break;

      case AI_STATE.CHASE:
        if (canRepath) {
          engine.movement.moveToward(unit, enemy, 4);
          this._lastChaseTick = currentTick;
        }
        break;

      case AI_STATE.PILLAR_PLAY: {
        const { pillar } = matchState.los.getNearestPillar(unit.position);
        if (pillar) {
          const cover = matchState.los.getPillarCoverPosition(pillar, enemy.position);
          engine.movement.moveTo(unit, { x: cover.x, y: 0, z: cover.z });
        }
        break;
      }

      case AI_STATE.EMERGENCY:
        // Run away or to pillar
        if (isRanged) {
          engine.movement.moveAway(unit, enemy, 30);
        } else {
          const { pillar } = matchState.los.getNearestPillar(unit.position);
          if (pillar) {
            const cover = matchState.los.getPillarCoverPosition(pillar, enemy.position);
            engine.movement.moveTo(unit, { x: cover.x, y: 0, z: cover.z });
          }
        }
        break;

      default:
        // Pressure/Burst — maintain ideal range
        if (isRanged) {
          if (distance < 20) {
            engine.movement.moveAway(unit, enemy, 28);
          } else if (distance > 33) {
            engine.movement.moveToward(unit, enemy, 28);
          }
        } else {
          if (distance > MELEE_RANGE + 1) {
            // Chase with delayed re-pathing
            if (canRepath) {
              engine.movement.moveToward(unit, enemy, 4);
              this._lastChaseTick = currentTick;
            }
          } else {
            // In melee range — occasionally strafe for dynamic feel
            if (canRepath && matchState.rng?.chance(0.15)) {
              engine.movement.strafe(unit, enemy, matchState.rng?.chance(0.5));
              this._lastChaseTick = currentTick;
            } else {
              unit.faceTarget(enemy);
              engine.movement.stop(unit);
            }
          }
        }
        break;
    }
  }

  /**
   * Select the best ability to use
   */
  selectAbility(unit, enemy, engine, matchState, currentTick) {
    const available = this.getAvailableAbilities(unit, enemy, engine, currentTick);
    if (available.length === 0) return null;

    // Score each ability
    const scored = available.map(ability => ({
      ability,
      score: this.scoreAbility(ability, unit, enemy, matchState, currentTick)
    }));

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Return highest scored ability
    return scored[0].score > 0 ? scored[0].ability : null;
  }

  /**
   * Get all abilities that can be used right now
   */
  getAvailableAbilities(unit, enemy, engine, currentTick) {
    const available = [];

    for (const [id, ability] of unit.abilities) {
      const validation = engine.validateAbility(unit, ability, enemy, currentTick);
      if (validation.valid) {
        available.push(ability);
      }
    }

    return available;
  }

  /**
   * Score an ability based on current game state
   */
  scoreAbility(ability, unit, enemy, matchState, currentTick) {
    let score = 0;
    const hpPercent = unit.hp / unit.maxHp;
    const enemyHpPercent = enemy.hp / enemy.maxHp;
    const distance = unit.distanceTo(enemy);

    // --- Interrupt scoring (highest priority) ---
    if (this.isInterrupt(ability)) {
      if (enemy.isCasting || enemy.isChanneling) {
        return 1000; // Always interrupt
      }
      return -100; // Don't waste interrupt
    }

    // --- Emergency healing/defensive ---
    if (this.state === AI_STATE.EMERGENCY) {
      if (this.isDefensive(ability)) return 500;
      if (this.isHealingAbility(ability)) return 400;
      if (this.isCCAbility(ability)) return 300; // CC to buy time
    }

    // --- Burst window ---
    if (this.state === AI_STATE.BURST_WINDOW) {
      if (this.isBurstCooldown(ability)) return 200;
      if (ability.damage > 0) {
        score += ability.damage / 100; // Prioritize high damage
      }
    }

    // --- CC Chain ---
    if (this.state === AI_STATE.CC_CHAIN) {
      if (this.isCCAbility(ability) && !enemy.isStunned && !enemy.isFeared) {
        return 180;
      }
    }

    // --- General scoring ---

    // Damage abilities
    if (ability.damage > 0) {
      score += 50 + (ability.damage / 500);

      // Bonus for execute range
      if (enemyHpPercent < 0.20) score += 30;

      // Bonus if enemy has vulnerability debuff
      if (enemy.auras.hasAura('shatter_guard_debuff') || enemy.auras.hasAura('divine_reckoning_debuff')) {
        score += 20;
      }
    }

    // DoTs — apply if not already on target
    if (ability.applyAura && ability.applyAura.type === 'dot') {
      if (!enemy.auras.hasAura(ability.applyAura.id)) {
        score += 80; // High priority to apply missing DoTs
      } else {
        score -= 20; // Don't refresh early
      }
    }

    // Harbinger DoTs — custom execute but still track by aura ID
    if (this.isDotAbility(ability)) {
      const dotAuraId = this.getDotAuraId(ability);
      if (dotAuraId && !enemy.auras.hasAura(dotAuraId)) {
        score += 80;
      } else if (dotAuraId && enemy.auras.hasAura(dotAuraId)) {
        score -= 20;
      }
    }

    // Healing — scale with damage taken
    if (this.isHealingAbility(ability)) {
      const missingHp = (1 - hpPercent);
      score += missingHp * 200;
      if (hpPercent > 0.85) score -= 50; // Don't heal at high HP
    }

    // CC — don't waste on DR immune targets
    if (this.isCCAbility(ability)) {
      const drCategory = this.getCCDRCategory(ability);
      if (drCategory && CrowdControlSystem.isImmune(enemy, drCategory, currentTick)) {
        return -100;
      }
      score += 60;

      // Bonus if enemy is casting a big spell
      if (enemy.isCasting) score += 40;
    }

    // Gap closers — high priority when out of melee range
    if (this.isGapCloser(ability)) {
      if (distance > 8) {
        score += 200;
        if (this.state === AI_STATE.CHASE) score += 50;
      } else if (distance > MELEE_RANGE) {
        score += 100;
      } else {
        score -= 30;
      }
    }

    // Slow abilities — keep slow up on target when in melee or chasing
    if (this.isSlowAbility(ability) && !this.hasSlowOnTarget(enemy)) {
      const isRanged = this.isRangedClass(unit);
      if (!isRanged) {
        score += 200; // Very high priority for melee to slow targets
        if (this.state === AI_STATE.CHASE) score += 100;
      }
    }

    // Defensive cooldowns — save for when needed
    if (this.isDefensive(ability)) {
      if (hpPercent > 0.50) return -50; // Don't use defensives at high HP
      if (hpPercent < 0.30) score += 150;
    }

    // Ground zone abilities — great for kiting and peeling
    if (this.isGroundZoneAbility(ability)) {
      if (this.state === AI_STATE.KITE) {
        score += 180; // Very high priority when being chased
      } else if (distance < 12) {
        score += 120; // Good when enemy is close
      } else {
        score += 60; // Always decent in pressure
      }
    }

    // Penalty for long cast times while in danger
    if (ability.castTime > 0 && hpPercent < 0.30) {
      score -= 30;
    }

    // Penalty for cast time abilities when enemy is in melee (might get interrupted)
    if (ability.castTime > 0 && distance < MELEE_RANGE + 2) {
      score -= 20;
    }

    return score;
  }

  /**
   * Try to interrupt enemy cast
   */
  tryInterrupt(unit, enemy, engine, matchState, currentTick) {
    if (!enemy.isCasting && !enemy.isChanneling) return;

    for (const [id, ability] of unit.abilities) {
      if (this.isInterrupt(ability)) {
        const validation = engine.validateAbility(unit, ability, enemy, currentTick);
        if (validation.valid) {
          // Check reaction time
          if (this.difficulty === 'easy' && matchState.rng.chance(0.5)) return; // 50% miss
          if (this.difficulty === 'medium' && matchState.rng.chance(0.2)) return; // 20% miss

          engine.queueAbility(this.unitId, ability.id, enemy.id);
          return;
        }
      }
    }
  }

  // --- Ability classification helpers ---

  isInterrupt(ability) {
    return ['skull_crack', 'throat_jab', 'spell_fracture', 'hex_silence', 'sanctified_rebuff'].includes(ability.id);
  }

  isDefensive(ability) {
    return ['iron_resolve', 'warborn_rally', 'phantasm_dodge', 'umbral_shroud', 'veil_of_night',
            'crystalline_ward', 'arcane_bulwark', 'aegis_of_dawn', 'sovereign_mend',
            'blood_tithe', 'warded_flesh'].includes(ability.id);
  }

  isHealingAbility(ability) {
    return ['warborn_rally', 'blood_tincture', 'holy_restoration', 'sovereign_mend',
            'sanctified_gale', 'siphon_essence', 'wraith_bolt'].includes(ability.id);
  }

  isCCAbility(ability) {
    return ability.cc || ['dread_howl', 'nerve_strike', 'blackjack', 'thunder_spike',
            'gavel_of_light', 'binding_prayer', 'permafrost_burst', 'scaldwind',
            'wraith_bolt', 'nether_slam', 'shadowfury', 'ring_of_frost'].includes(ability.id);
  }

  isGroundZoneAbility(ability) {
    return ['scorched_earth', 'ring_of_frost', 'shadowfury', 'abyssal_ground'].includes(ability.id);
  }

  isBurstCooldown(ability) {
    return ['shatter_guard', 'iron_cyclone', 'pyroclasm', 'frenzy_edge',
            'ember_wake', 'soul_ignite'].includes(ability.id);
  }

  isGapCloser(ability) {
    return ['warbringer_rush', 'crushing_descent', 'shade_shift', 'phase_shift',
            'valiant_charge', 'rift_anchor'].includes(ability.id);
  }

  isSlowAbility(ability) {
    return ['crippling_strike', 'crushing_descent', 'ember_wake', 'glacial_lance'].includes(ability.id);
  }

  hasSlowOnTarget(enemy) {
    return enemy.auras.hasAura('crippling_strike_debuff') ||
           enemy.auras.hasAura('glacial_chill_debuff') ||
           enemy.auras.hasAura('crushing_descent_slow') ||
           enemy.auras.hasAura('ember_wake_slow') ||
           enemy.auras.hasAura('tyrant_hamstring') ||
           enemy.auras.hasAura('crippling_poison') ||
           enemy.auras.hasAura('revenant_judgment_slow') ||
           enemy.auras.hasAura('hex_blight_slow') ||
           enemy.auras.hasAura('scorched_earth_slow') ||
           enemy.auras.hasAura('abyssal_ground_slow');
  }

  isDotAbility(ability) {
    return ['hex_blight', 'creeping_torment', 'volatile_hex', 'serrated_wound'].includes(ability.id);
  }

  getDotAuraId(ability) {
    const map = {
      'hex_blight': 'hex_blight_dot',
      'creeping_torment': 'creeping_torment_dot',
      'volatile_hex': 'volatile_hex_dot',
      'serrated_wound': 'serrated_wound_dot'
    };
    return map[ability.id] || null;
  }

  isRangedClass(unit) {
    return ['infernal', 'harbinger'].includes(unit.classId);
  }

  getCCDRCategory(ability) {
    if (ability.cc) {
      const ccToDR = {
        stun: 'stun', root: 'root', fear: 'disorient',
        disorient: 'disorient', incapacitate: 'incapacitate'
      };
      return ccToDR[ability.cc.type] || null;
    }
    return null;
  }

  hasBurstReady(unit, currentTick) {
    for (const [id, ability] of unit.abilities) {
      if (this.isBurstCooldown(ability) && unit.cooldowns.isReady(id, currentTick)) {
        return true;
      }
    }
    return false;
  }

  hasDefensiveReady(unit, currentTick) {
    for (const [id, ability] of unit.abilities) {
      if (this.isDefensive(ability) && unit.cooldowns.isReady(id, currentTick)) {
        return true;
      }
    }
    return false;
  }

  hasCCReady(unit, currentTick) {
    for (const [id, ability] of unit.abilities) {
      if (this.isCCAbility(ability) && unit.cooldowns.isReady(id, currentTick)) {
        return true;
      }
    }
    return false;
  }

  enemyHasDefensiveReady(enemy, currentTick) {
    // Conservative: assume defensives are ready unless we've seen them used
    for (const [abilityId, info] of this.enemyCooldowns) {
      if (currentTick < info.usedAtTick + info.cooldown) {
        // This defensive is on CD
        continue;
      }
    }
    // By default assume some defensive might be available
    return true;
  }

  /**
   * Track when enemy uses abilities (called externally)
   */
  observeEnemyAbility(abilityId, cooldown, currentTick) {
    this.enemyCooldowns.set(abilityId, { usedAtTick: currentTick, cooldown });
  }
}
