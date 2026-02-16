import { DR_CATEGORY, DR_RESET_TICKS, DR_DURATIONS, CC_TYPE } from '../constants.js';

// Map CC types to their DR categories
const CC_TO_DR = {
  [CC_TYPE.STUN]: DR_CATEGORY.STUN,
  [CC_TYPE.ROOT]: DR_CATEGORY.ROOT,
  [CC_TYPE.FEAR]: DR_CATEGORY.DISORIENT,
  [CC_TYPE.DISORIENT]: DR_CATEGORY.DISORIENT,
  [CC_TYPE.INCAPACITATE]: DR_CATEGORY.INCAPACITATE,
  [CC_TYPE.SILENCE]: DR_CATEGORY.SILENCE
};

export class CrowdControlSystem {
  /**
   * Attempt to apply CC to a target.
   * Returns { applied, duration, immune } or { applied: false, immune: true }
   */
  static applyCC(source, target, ccType, baseDurationTicks, currentTick, options = {}) {
    const {
      breakOnDamage = false,
      damageThreshold = 0
    } = options;

    // Check immunities
    if (target.immuneToCC || target.immuneToAll) {
      return { applied: false, immune: true, duration: 0 };
    }

    // Get DR category
    const drCategory = CC_TO_DR[ccType];
    if (!drCategory) {
      // No DR category — apply at full duration
      target.addCC(ccType, baseDurationTicks, currentTick, source.id, breakOnDamage, damageThreshold);
      return { applied: true, immune: false, duration: baseDurationTicks };
    }

    // Check DR on target
    const dr = target.drTracker.get(drCategory);
    let drCount = 0;

    if (dr) {
      // Check if DR has reset
      if (currentTick - dr.lastAppliedTick >= DR_RESET_TICKS) {
        drCount = 0;
      } else {
        drCount = dr.count;
      }
    }

    // Get duration multiplier
    if (drCount >= DR_DURATIONS.length - 1) {
      // Immune
      return { applied: false, immune: true, duration: 0 };
    }

    const durationMultiplier = DR_DURATIONS[drCount];
    if (durationMultiplier === 0) {
      return { applied: false, immune: true, duration: 0 };
    }

    const actualDuration = Math.max(1, Math.round(baseDurationTicks * durationMultiplier));

    // Apply CC
    target.addCC(ccType, actualDuration, currentTick, source.id, breakOnDamage, damageThreshold);

    // Update DR tracker
    target.drTracker.set(drCategory, {
      count: drCount + 1,
      lastAppliedTick: currentTick
    });

    // Track CC time for stats
    source.totalCCTimeInflicted += actualDuration;

    return { applied: true, immune: false, duration: actualDuration };
  }

  /**
   * Remove a specific CC type from target
   */
  static removeCC(target, ccType) {
    target.removeCC(ccType);
  }

  /**
   * Remove all CCs from target (e.g., PvP trinket, Ice Block)
   */
  static removeAllCC(target) {
    target.removeAllCC();
  }

  /**
   * Break stuns and roots (e.g., Blink, Blessing of Freedom for roots only)
   */
  static breakStuns(target) {
    target.ccEffects = target.ccEffects.filter(cc => cc.type !== CC_TYPE.STUN);
  }

  static breakRoots(target) {
    target.ccEffects = target.ccEffects.filter(cc => cc.type !== CC_TYPE.ROOT);
  }

  /**
   * Check if target has any active CC of given type
   */
  static hasCC(target, ccType) {
    return target.ccEffects.some(cc => cc.type === ccType);
  }

  /**
   * Get remaining duration of a CC type on target
   */
  static getCCRemaining(target, ccType, currentTick) {
    const cc = target.ccEffects.find(cc => cc.type === ccType);
    if (!cc) return 0;
    return Math.max(0, cc.endTick - currentTick);
  }

  /**
   * Get current DR count for a category on target
   */
  static getDRCount(target, drCategory, currentTick) {
    const dr = target.drTracker.get(drCategory);
    if (!dr) return 0;
    if (currentTick - dr.lastAppliedTick >= DR_RESET_TICKS) return 0;
    return dr.count;
  }

  /**
   * Check if target is immune to a DR category
   */
  static isImmune(target, drCategory, currentTick) {
    return CrowdControlSystem.getDRCount(target, drCategory, currentTick) >= 3;
  }
}
