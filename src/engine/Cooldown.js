export class CooldownTracker {
  constructor() {
    // Map of abilityId -> tick when available
    this.cooldowns = new Map();
    // Map of abilityId -> { maxCharges, currentCharges, rechargeTicks, nextRechargeAt }
    this.charges = new Map();
  }

  startCooldown(abilityId, durationTicks, currentTick) {
    const chargeInfo = this.charges.get(abilityId);
    if (chargeInfo) {
      chargeInfo.currentCharges--;
      if (chargeInfo.nextRechargeAt === 0) {
        chargeInfo.nextRechargeAt = currentTick + chargeInfo.rechargeTicks;
      }
      return;
    }
    this.cooldowns.set(abilityId, currentTick + durationTicks);
  }

  isReady(abilityId, currentTick) {
    const chargeInfo = this.charges.get(abilityId);
    if (chargeInfo) {
      return chargeInfo.currentCharges > 0;
    }
    const expiresAt = this.cooldowns.get(abilityId);
    if (!expiresAt) return true;
    return currentTick >= expiresAt;
  }

  getRemaining(abilityId, currentTick) {
    const chargeInfo = this.charges.get(abilityId);
    if (chargeInfo) {
      if (chargeInfo.currentCharges > 0) return 0;
      return Math.max(0, chargeInfo.nextRechargeAt - currentTick);
    }
    const expiresAt = this.cooldowns.get(abilityId);
    if (!expiresAt) return 0;
    return Math.max(0, expiresAt - currentTick);
  }

  getCharges(abilityId) {
    const chargeInfo = this.charges.get(abilityId);
    return chargeInfo ? chargeInfo.currentCharges : null;
  }

  registerChargedAbility(abilityId, maxCharges, rechargeTicks) {
    this.charges.set(abilityId, {
      maxCharges,
      currentCharges: maxCharges,
      rechargeTicks,
      nextRechargeAt: 0
    });
  }

  tick(currentTick) {
    // Clean up expired cooldowns
    for (const [id, expiresAt] of this.cooldowns) {
      if (currentTick >= expiresAt) {
        this.cooldowns.delete(id);
      }
    }

    // Process charge recharges
    for (const [id, info] of this.charges) {
      if (info.currentCharges < info.maxCharges && info.nextRechargeAt > 0 && currentTick >= info.nextRechargeAt) {
        info.currentCharges++;
        if (info.currentCharges < info.maxCharges) {
          info.nextRechargeAt = currentTick + info.rechargeTicks;
        } else {
          info.nextRechargeAt = 0;
        }
      }
    }
  }

  reduceCooldown(abilityId, ticks) {
    const expiresAt = this.cooldowns.get(abilityId);
    if (expiresAt) {
      this.cooldowns.set(abilityId, expiresAt - ticks);
    }
  }

  resetAll() {
    this.cooldowns.clear();
    for (const info of this.charges.values()) {
      info.currentCharges = info.maxCharges;
      info.nextRechargeAt = 0;
    }
  }

  reset(abilityId) {
    this.cooldowns.delete(abilityId);
    const chargeInfo = this.charges.get(abilityId);
    if (chargeInfo) {
      chargeInfo.currentCharges = chargeInfo.maxCharges;
      chargeInfo.nextRechargeAt = 0;
    }
  }
}
