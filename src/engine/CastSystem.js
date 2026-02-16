import { PUSHBACK_AMOUNT_TICKS, MAX_PUSHBACKS, ABILITY_FLAG } from '../constants.js';

export class CastSystem {
  /**
   * Start casting an ability
   */
  static startCast(unit, ability, targetId, currentTick) {
    const castTime = CastSystem.getCastTime(unit, ability);

    unit.castState = {
      abilityId: ability.id,
      ability,
      startTick: currentTick,
      endTick: currentTick + castTime,
      targetId,
      castTime
    };
    unit.pushbackCount = 0;

    // Stop movement unless ability is castable while moving
    if (!ability.flags?.includes(ABILITY_FLAG.USABLE_WHILE_MOVING)) {
      unit.moveTarget = null;
    }

    return true;
  }

  /**
   * Start channeling an ability
   */
  static startChannel(unit, ability, targetId, currentTick) {
    const channelDuration = ability.channelDuration || ability.castTime;
    const tickInterval = ability.channelTickInterval || 5; // 0.5s default

    unit.channelState = {
      abilityId: ability.id,
      ability,
      startTick: currentTick,
      endTick: currentTick + channelDuration,
      targetId,
      tickInterval,
      nextTickAt: currentTick + tickInterval,
      tickCount: 0
    };

    // Stop movement
    unit.moveTarget = null;

    return true;
  }

  /**
   * Get effective cast time (accounting for haste)
   */
  static getCastTime(unit, ability) {
    if (!ability.castTime || ability.castTime === 0) return 0;
    return Math.max(1, Math.round(ability.castTime / unit.stats.hasteMultiplier));
  }

  /**
   * Check if a cast has completed this tick
   */
  static checkCastComplete(unit, currentTick) {
    if (!unit.castState) return null;
    if (currentTick >= unit.castState.endTick) {
      const castState = unit.castState;
      unit.castState = null;
      unit.pushbackCount = 0;
      return castState;
    }
    return null;
  }

  /**
   * Check if a channel should tick this tick
   */
  static checkChannelTick(unit, currentTick) {
    if (!unit.channelState) return null;

    // Check if channel is complete
    if (currentTick >= unit.channelState.endTick) {
      const channelState = unit.channelState;
      unit.channelState = null;
      return { completed: true, channelState };
    }

    // Check for periodic tick
    if (currentTick >= unit.channelState.nextTickAt) {
      unit.channelState.nextTickAt += unit.channelState.tickInterval;
      unit.channelState.tickCount++;
      return { tick: true, channelState: unit.channelState };
    }

    return null;
  }

  /**
   * Apply pushback to a cast (from taking physical damage)
   */
  static applyPushback(unit) {
    if (!unit.castState) return false;
    if (unit.castState.ability.flags?.includes(ABILITY_FLAG.CANNOT_BE_INTERRUPTED)) return false;
    if (unit.pushbackCount >= MAX_PUSHBACKS) return false;

    unit.castState.endTick += PUSHBACK_AMOUNT_TICKS;
    unit.pushbackCount++;
    return true;
  }

  /**
   * Interrupt a cast/channel and lock out the school
   */
  static interrupt(target, interrupterSource, lockoutDurationTicks, currentTick) {
    let interrupted = false;
    let school = null;

    if (target.castState) {
      if (target.castState.ability.flags?.includes(ABILITY_FLAG.CANNOT_BE_INTERRUPTED)) {
        return { interrupted: false, school: null };
      }
      school = target.castState.ability.school;
      target.cancelCast();
      interrupted = true;
    } else if (target.channelState) {
      if (target.channelState.ability.flags?.includes(ABILITY_FLAG.CANNOT_BE_INTERRUPTED)) {
        return { interrupted: false, school: null };
      }
      school = target.channelState.ability.school;
      target.cancelChannel();
      interrupted = true;
    }

    if (interrupted && school && lockoutDurationTicks > 0) {
      target.spellSchools.applyLockout(school, currentTick, lockoutDurationTicks);
    }

    return { interrupted, school };
  }

  /**
   * Get cast progress as 0-1
   */
  static getCastProgress(unit, currentTick) {
    if (!unit.castState) return 0;
    const total = unit.castState.endTick - unit.castState.startTick;
    if (total <= 0) return 1;
    const elapsed = currentTick - unit.castState.startTick;
    return Math.min(1, elapsed / total);
  }

  /**
   * Get channel progress as 0-1 (drains from 1 to 0)
   */
  static getChannelProgress(unit, currentTick) {
    if (!unit.channelState) return 0;
    const total = unit.channelState.endTick - unit.channelState.startTick;
    if (total <= 0) return 0;
    const remaining = unit.channelState.endTick - currentTick;
    return Math.max(0, remaining / total);
  }
}
