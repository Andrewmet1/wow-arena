import { CC_TYPE, MELEE_RANGE, SCHOOL, ABILITY_FLAG } from '../constants.js';
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

    // Team mode (2v2/3v3)
    this.teamMode = false;
    this.allyId = null;
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
      if (this.teamMode && enemies.length > 1) {
        this.currentTarget = this._selectTeamTarget(unit, enemies, matchState);
      } else {
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
      }
      matchState.setTarget(this.unitId, this.currentTarget);
    } else if (this.teamMode && enemies.length > 1) {
      // Re-evaluate target periodically in team mode
      const newTarget = this._selectTeamTarget(unit, enemies, matchState);
      if (newTarget !== this.currentTarget) {
        this.currentTarget = newTarget;
        matchState.setTarget(this.unitId, this.currentTarget);
      }
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

    // If we can't act, try CC-break abilities before giving up
    if (!unit.canAct) {
      this.tryCCBreak(unit, enemy, engine, matchState, currentTick);
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

    // EMERGENCY: Low HP — but force fighting after 3s to prevent infinite kiting
    if (hpPercent < 0.25) {
      if (!this._emergencyStart) this._emergencyStart = currentTick;
      if (currentTick - this._emergencyStart < 30) { // 3 seconds max
        return AI_STATE.EMERGENCY;
      }
      // After 3s of emergency, fall through to PRESSURE to force a fight
    } else {
      this._emergencyStart = null;
    }

    // PILLAR_PLAY: Low HP and waiting for defensive CDs — but only for 5 seconds max
    if (hpPercent < 0.40 && !this.hasDefensiveReady(unit, currentTick)) {
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

    // CC_CHAIN: Set up CC for burst, control, or defensive
    if (this.hasCCReady(unit, currentTick)) {
      if (this.hasBurstReady(unit, currentTick)) return AI_STATE.CC_CHAIN;
      if (hpPercent < 0.40) return AI_STATE.CC_CHAIN;  // CC to buy time
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
   * Get abilities in the active loadout (or all if no loadout set)
   */
  _getLoadoutAbilities(unit) {
    const loadout = unit.activeLoadout;
    if (!loadout || loadout.length === 0) return [...unit.abilities.values()];
    return loadout.map(id => unit.abilities.get(id)).filter(Boolean);
  }

  /**
   * Get all abilities that can be used right now (filtered to active loadout)
   */
  getAvailableAbilities(unit, enemy, engine, currentTick) {
    const available = [];

    for (const ability of this._getLoadoutAbilities(unit)) {
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
      score += missingHp * 250; // Heal more aggressively
      if (hpPercent < 0.40) score += 100; // Critical healing bonus
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

    // Defensive cooldowns — use proactively when under pressure
    if (this.isDefensive(ability)) {
      if (hpPercent > 0.65) return -50; // Don't waste at high HP
      if (hpPercent < 0.25) score += 300; // Critical — must use NOW
      else if (hpPercent < 0.40) score += 200; // High priority
      else if (hpPercent < 0.55) score += 100; // Proactive use under pressure
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

    // Class-specific scoring adjustments
    score += this.classSpecificScoring(ability, unit, enemy, matchState, currentTick);

    // Matchup-aware adjustments
    score += this.matchupAdjustments(ability, unit, enemy, matchState, currentTick);

    return score;
  }

  /**
   * Try to interrupt enemy cast
   */
  tryInterrupt(unit, enemy, engine, matchState, currentTick) {
    if (!enemy.isCasting && !enemy.isChanneling) return;

    for (const ability of this._getLoadoutAbilities(unit)) {
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

  // --- CC-break: use abilities flagged USABLE_WHILE_CC when crowd-controlled ---

  tryCCBreak(unit, enemy, engine, matchState, currentTick) {
    for (const ability of this._getLoadoutAbilities(unit)) {
      if (!ability.flags?.includes(ABILITY_FLAG.USABLE_WHILE_CC)) continue;
      if (!unit.cooldowns.isReady(ability.id, currentTick)) continue;
      // Check resource cost
      if (ability.cost) {
        let canAfford = true;
        for (const [resourceType, amount] of Object.entries(ability.cost)) {
          if (!unit.resources.canAfford(resourceType, amount)) { canAfford = false; break; }
        }
        if (!canAfford) continue;
      }
      // Use the CC-break ability
      engine.queueAbility(unit.id, ability.id, enemy?.id);
      return;
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
            'sanctified_gale', 'siphon_essence', 'wraith_bolt', 'cauterize'].includes(ability.id);
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
    for (const ability of this._getLoadoutAbilities(unit)) {
      if (this.isBurstCooldown(ability) && unit.cooldowns.isReady(ability.id, currentTick)) {
        return true;
      }
    }
    return false;
  }

  hasDefensiveReady(unit, currentTick) {
    for (const ability of this._getLoadoutAbilities(unit)) {
      if (this.isDefensive(ability) && unit.cooldowns.isReady(ability.id, currentTick)) {
        return true;
      }
    }
    return false;
  }

  hasCCReady(unit, currentTick) {
    for (const ability of this._getLoadoutAbilities(unit)) {
      if (this.isCCAbility(ability) && unit.cooldowns.isReady(ability.id, currentTick)) {
        return true;
      }
    }
    return false;
  }

  // --- Class-specific scoring ---

  classSpecificScoring(ability, unit, enemy, matchState, currentTick) {
    switch (unit.classId) {
      case 'wraith': return this.wraithScoring(ability, unit, enemy, matchState, currentTick);
      case 'infernal': return this.infernalScoring(ability, unit, enemy, matchState, currentTick);
      case 'harbinger': return this.harbingerScoring(ability, unit, enemy, matchState, currentTick);
      case 'tyrant': return this.tyrantScoring(ability, unit, enemy, matchState, currentTick);
      case 'revenant': return this.revenantScoring(ability, unit, enemy, matchState, currentTick);
      default: return 0;
    }
  }

  wraithScoring(ability, unit, enemy, matchState, currentTick) {
    const cp = unit.resources.getCurrent('combo_points');

    // Stealth opener priority
    if (unit.stealthed) {
      if (ability.id === 'blackjack') return 500;
      if (ability.id === 'throat_opener') return 480;
      return -100;  // Don't break stealth with anything else
    }

    // Finisher management: don't use below 4 CP unless executing
    if (['grim_flurry', 'nerve_strike', 'serrated_wound'].includes(ability.id)) {
      if (cp < 3) return -200;
      if (cp < 4 && enemy.hp / enemy.maxHp > 0.25) return -50;
      if (cp >= 5) return 40;
    }

    // Serrated Wound: prioritize keeping bleed up (enables Viper Lash +30% and Grim Flurry +20%)
    if (ability.id === 'serrated_wound' && cp >= 3 && !enemy.auras?.hasAura('serrated_wound_dot')) return 120;

    // Builder priority when low CP (higher if bleed is active for +30% damage synergy)
    if (ability.id === 'viper_lash' && cp < 4) {
      return enemy.auras?.hasAura('serrated_wound_dot') ? 50 : 30;
    }

    // Shade Shift: use for gap close or burst setup
    if (ability.id === 'shade_shift') {
      const distance = unit.distanceTo(enemy);
      if (distance > 10) return 250;
      if (cp >= 3) return 150;
    }

    // Frenzy Edge: use before burst, not randomly
    if (ability.id === 'frenzy_edge') {
      if (cp >= 3) return 120;
      return -20;
    }

    // Defensive choice: physical vs magic immune
    if (ability.id === 'phantasm_dodge' && this.isRangedClass(enemy)) return -30;
    if (ability.id === 'umbral_shroud' && !this.isRangedClass(enemy)) return -30;

    return 0;
  }

  infernalScoring(ability, unit, enemy, matchState, currentTick) {
    const cinders = unit.resources.getCurrent('cinder_stacks');
    const distance = unit.distanceTo(enemy);

    // Cataclysm Flare: only cast at 4 cinder stacks (empowered)
    if (ability.id === 'cataclysm_flare') {
      if (cinders >= 4) return 200;
      return -100;
    }

    // Pyroclasm timing: use when stacks are low for fast build-up
    if (ability.id === 'pyroclasm') {
      if (cinders <= 1) return 150;
      return 80;
    }

    // Permafrost Burst: high priority when melee is close
    if (ability.id === 'permafrost_burst') {
      if (distance < 12) return 300;
      return 40;
    }

    // Phase Shift: use when melee is in face
    if (ability.id === 'phase_shift') {
      if (distance < 8) return 280;
      return -30;
    }

    // Ring of Frost: use when melee is approaching
    if (ability.id === 'ring_of_frost' && distance < 15 && distance > 5) return 180;

    // Scorched Earth: drop under self when enemy is close
    if (ability.id === 'scorched_earth' && distance < 10) return 160;

    // Penalize Glacial Lance when close (can't afford the cast time)
    if (ability.id === 'glacial_lance' && distance < 10) return -40;

    // Prefer instant/fast casts when pressured
    if (ability.id === 'ember_brand' && distance < 15) return 30;

    // Ignition proc: prioritize Inferno Bolt when we have instant-cast proc (free follow-up after empowered Cataclysm)
    if (unit.classData?.ignitionProc && ability.id === 'inferno_bolt') return 180;

    // Searing Pulse: bonus priority if Pyre is ticking (refreshes duration)
    if (ability.id === 'searing_pulse' && enemy.auras?.hasAura('pyre_dot')) return 80;

    return 0;
  }

  harbingerScoring(ability, unit, enemy, matchState, currentTick) {
    const dotsOnTarget = ['hex_blight_dot', 'creeping_torment_dot', 'volatile_hex_dot']
      .filter(id => enemy.auras.hasAura(id)).length;
    const soulShards = unit.resources.getCurrent('soul_shards');

    // DoT application priority: get all 3 up before anything else
    if (ability.id === 'hex_blight' && !enemy.auras.hasAura('hex_blight_dot')) return 200;
    if (ability.id === 'creeping_torment' && !enemy.auras.hasAura('creeping_torment_dot')) return 190;
    if (ability.id === 'volatile_hex' && !enemy.auras.hasAura('volatile_hex_dot')) return 180;

    // Hex Rupture: massive when all 3 DoTs are up
    if (ability.id === 'hex_rupture') {
      if (dotsOnTarget >= 3 && soulShards >= 1) return 250;
      if (dotsOnTarget >= 2 && soulShards >= 1) return 100;
      return -50;
    }

    // Dread Howl: save for when enemy CC break is on CD
    if (ability.id === 'dread_howl') {
      const enemyCCBreakOnCD = this.enemyCooldowns.has('iron_resolve') ||
        this.enemyCooldowns.has('veil_of_night') || this.enemyCooldowns.has('aegis_of_dawn') ||
        this.enemyCooldowns.has('warded_flesh');
      if (enemyCCBreakOnCD) return 200;
      return 80;
    }

    // Soul Ignite: use before Siphon Essence (Siphon generates shard during Soul Ignite → Hex Rupture loop)
    if (ability.id === 'soul_ignite' && soulShards >= 1) {
      if (dotsOnTarget >= 2) return 200; // DoTs up → Soul Ignite → Siphon → shard → Hex Rupture loop
      return 160;
    }

    // Siphon Essence: higher priority with Soul Ignite buff (generates shard on completion)
    if (ability.id === 'siphon_essence') {
      if (unit.auras.has('soul_ignite_buff')) return 220; // Empowered: double damage + shard gen
      return 60;
    }

    // Blood Tithe: proactive shield when pet is healthy
    if (ability.id === 'blood_tithe' && unit.classData.petAlive && unit.classData.petHp > 15000) {
      if (unit.hp / unit.maxHp < 0.70) return 140;
    }

    return 0;
  }

  tyrantScoring(ability, unit, enemy, matchState, currentTick) {
    const rage = unit.resources.getCurrent('rage');
    const enemyHp = enemy.hp / enemy.maxHp;

    // Shatter Guard: TOP priority if enemy is immune (Shattering Blow), otherwise before Iron Cyclone
    if (ability.id === 'shatter_guard') {
      if (enemy.immuneToAll) return 500; // Strip immunity immediately!
      if (unit.cooldowns.isReady('iron_cyclone', currentTick) && rage >= 10) return 220;
    }

    // Iron Cyclone: best when Shatter Guard debuff is on target
    if (ability.id === 'iron_cyclone') {
      if (enemy.auras.hasAura('shatter_guard_debuff')) return 300;
      return 150;
    }

    // Ravaging Cleave: keep mortal strike up on healers/sustain classes
    if (ability.id === 'ravaging_cleave') {
      if (!enemy.auras.hasAura('ravaged_flesh') &&
          ['revenant', 'harbinger'].includes(enemy.classId)) return 180;
      if (!enemy.auras.hasAura('ravaged_flesh')) return 120;
    }

    // Brutal Slam: big priority in execute range (threshold 50% with Shatter Guard debuff)
    if (ability.id === 'brutal_slam') {
      const threshold = enemy.auras?.hasAura('shatter_guard_debuff') ? 0.50 : 0.40;
      if (enemyHp < threshold) return 250;
    }

    // Bloodrage Strike: higher priority when mortal strike is up (bonus rage synergy)
    if (ability.id === 'bloodrage_strike' && enemy.auras?.hasAura('ravaged_flesh')) return 80;

    // Gap closer management: save Warbringer Rush for when target runs
    if (ability.id === 'warbringer_rush') {
      const dist = unit.distanceTo(enemy);
      if (dist > 12) return 300;
      if (dist > 8) return 150;
      return -20;
    }

    // Crushing Descent: secondary gap closer
    if (ability.id === 'crushing_descent') {
      const dist = unit.distanceTo(enemy);
      if (dist > 15) return 200;
      return -10;
    }

    // Don't dump rage below 40 if burst CDs are almost ready
    if (ability.cost?.rage >= 20 && rage < 40 &&
        unit.cooldowns.isReady('iron_cyclone', currentTick + 100)) {
      return -30;
    }

    return 0;
  }

  revenantScoring(ability, unit, enemy, matchState, currentTick) {
    const hp = unit.resources.getCurrent('holy_power');
    const hpPercent = unit.hp / unit.maxHp;
    const hasForbearance = unit.classData.hasForbearance &&
      currentTick < unit.classData.forbearanceEndTick;

    // Holy Power spenders: only use at 3+ HP
    if (['radiant_verdict', 'sanctified_gale', 'holy_restoration'].includes(ability.id)) {
      if (hp < 3) return -200;
    }

    // Choose spender based on situation
    if (ability.id === 'radiant_verdict' && hp >= 3) {
      if (enemy.hp / enemy.maxHp < 0.30) return 300; // Execute
      // Judgment combo: +25% damage when Divine Reckoning is on target
      if (enemy.auras?.hasAura('divine_reckoning_debuff')) return 150;
      return 100;
    }
    if (ability.id === 'sanctified_gale' && hp >= 3) return 90;
    if (ability.id === 'holy_restoration' && hp >= 3 && hpPercent < 0.50) return 200;

    // Ember Wake: prioritize when low HP to start burst + fast HP generation
    if (ability.id === 'ember_wake') {
      if (hp < 2) return 200; // Low HP → Ember Wake → 2 HP per Hallowed Strike
      return 100;
    }

    // Divine Reckoning: higher priority to set up Radiant Verdict combo (+25% damage)
    if (ability.id === 'divine_reckoning') {
      if (!enemy.auras?.hasAura('divine_reckoning_debuff')) {
        return hp >= 2 ? 170 : 140; // Extra priority if about to finisher
      }
      return 40;
    }

    // Forbearance tracking: don't try both big CDs in same window
    if (ability.id === 'aegis_of_dawn' && hasForbearance) return -500;
    if (ability.id === 'sovereign_mend' && hasForbearance) return -500;

    // Aegis when under heavy pressure and not on Forbearance
    if (ability.id === 'aegis_of_dawn' && !hasForbearance && hpPercent < 0.30) return 400;

    // Sovereign Mend when low
    if (ability.id === 'sovereign_mend' && !hasForbearance && hpPercent < 0.35) return 350;

    // Unchained Grace: use to remove roots/slows (no longer removes healing reduction)
    if (ability.id === 'unchained_grace') {
      if (unit.auras.has('crippling_strike_debuff') || unit.auras.has('glacial_chill_debuff')) return 150;
      if (unit.auras.has('crushing_descent_slow') || unit.auras.has('ember_wake_slow')) return 120;
    }

    // Valiant Charge: use when chasing or distant
    if (ability.id === 'valiant_charge') {
      const dist = unit.distanceTo(enemy);
      if (dist > 15) return 180;
      return 20;
    }

    return 0;
  }

  // --- Matchup-aware adjustments ---

  matchupAdjustments(ability, unit, enemy, matchState, currentTick) {
    let adj = 0;

    // Ranged vs Melee: prioritize roots and kiting tools
    if (this.isRangedClass(unit) && !this.isRangedClass(enemy)) {
      if (ability.id === 'permafrost_burst') adj += 80;
      if (ability.id === 'phase_shift') adj += 60;
      if (this.isGroundZoneAbility(ability)) adj += 40;
    }

    // Melee vs Ranged: prioritize gap closers and interrupts
    if (!this.isRangedClass(unit) && this.isRangedClass(enemy)) {
      if (this.isGapCloser(ability)) adj += 60;
      if (this.isInterrupt(ability) && enemy.isCasting) adj += 100;
    }

    // vs Harbinger: save interrupt for Dread Howl cast or Siphon Essence channel
    if (enemy.classId === 'harbinger' && this.isInterrupt(ability)) {
      if (enemy.isCasting || enemy.isChanneling) adj += 150;
      else adj -= 50;  // Save interrupt
    }

    // vs Revenant: apply healing reduction ASAP
    if (enemy.classId === 'revenant') {
      if (ability.id === 'ravaging_cleave' && !enemy.auras.hasAura('ravaged_flesh')) adj += 100;
    }

    return adj;
  }

  enemyHasDefensiveReady(enemy, currentTick) {
    const defensiveIds = ['iron_resolve', 'warborn_rally', 'phantasm_dodge', 'umbral_shroud',
      'veil_of_night', 'crystalline_ward', 'arcane_bulwark', 'aegis_of_dawn',
      'sovereign_mend', 'blood_tithe', 'warded_flesh'];

    for (const defId of defensiveIds) {
      if (!enemy.abilities.has(defId)) continue;
      const tracked = this.enemyCooldowns.get(defId);
      if (!tracked) return true;  // Never seen it used — assume available
      if (currentTick >= tracked.usedAtTick + tracked.cooldown) return true;  // Off CD
    }
    return false;  // All tracked defensives still on CD
  }

  /**
   * Track when enemy uses abilities (called externally)
   */
  observeEnemyAbility(abilityId, cooldown, currentTick) {
    this.enemyCooldowns.set(abilityId, { usedAtTick: currentTick, cooldown });
  }

  // --- Team mode target selection (2v2/3v3) ---

  _selectTeamTarget(unit, enemies, matchState) {
    if (enemies.length <= 1) return enemies[0]?.id;

    const ally = this.allyId != null ? matchState.getUnit(this.allyId) : null;
    const allyTarget = ally ? matchState.getTarget(ally.id) : null;
    const allyTargetUnit = allyTarget != null ? matchState.getUnit(allyTarget) : null;

    // Peel: if ally is low HP, attack whoever is closest to ally
    if (ally?.isAlive && ally.hp / ally.maxHp < 0.30) {
      let closest = enemies[0];
      let closestDist = ally.distanceTo(enemies[0]);
      for (let i = 1; i < enemies.length; i++) {
        const dist = ally.distanceTo(enemies[i]);
        if (dist < closestDist) { closest = enemies[i]; closestDist = dist; }
      }
      return closest.id;
    }

    // Focus fire: if ally's target is low HP, join the kill
    if (allyTargetUnit?.isAlive && allyTargetUnit.hp / allyTargetUnit.maxHp < 0.40) {
      return allyTarget;
    }

    // If ally is CC'ing one target, attack the other (split pressure)
    if (allyTargetUnit?.isAlive) {
      const otherEnemy = enemies.find(e => e.id !== allyTarget);
      if (otherEnemy && (allyTargetUnit.isStunned || allyTargetUnit.isFeared || allyTargetUnit.isIncapacitated)) {
        return otherEnemy.id;
      }
    }

    // Default: target squishiest enemy
    const sorted = [...enemies].sort((a, b) => a.maxHp - b.maxHp);
    return sorted[0].id;
  }

  /**
   * Select a random build for the AI.
   * Returns a loadout array (6 ability IDs).
   */
  static selectBuildForMatchup(classDef, opponentClassId) {
    const builds = classDef.builds;
    if (!builds || builds.length === 0) return classDef.defaultLoadout;
    const pick = builds[Math.floor(Math.random() * builds.length)];
    return pick.loadout;
  }
}
