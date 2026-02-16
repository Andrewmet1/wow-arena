import { AURA_TYPE } from '../constants.js';

export class AuraManager {
  constructor(unit) {
    this.unit = unit;
    this.auras = new Map(); // id -> Aura
    this.appliedStatMods = new Map(); // track what we've applied to revert
  }

  apply(aura) {
    const existing = this.auras.get(aura.id);

    if (existing) {
      // Refresh duration
      existing.refresh(aura.appliedTick, aura.duration);

      // Handle stacking
      if (existing.maxStacks > 1) {
        existing.addStack();
      }
      return;
    }

    this.auras.set(aura.id, aura);

    // Apply stat modifications
    if (aura.statMods) {
      this.applyStatMods(aura);
    }

    // Apply healing reduction
    if (aura.healingReduction > 0) {
      this.unit.stats.healingReceivedMod *= (1 - aura.healingReduction);
    }

    // Run onApply callback
    if (aura.onApply) {
      aura.onApply(this.unit, aura);
    }
  }

  remove(auraId) {
    const aura = this.auras.get(auraId);
    if (!aura) return null;

    // Revert stat modifications
    if (aura.statMods) {
      this.revertStatMods(aura);
    }

    // Revert healing reduction
    if (aura.healingReduction > 0) {
      this.unit.stats.healingReceivedMod /= (1 - aura.healingReduction);
    }

    // Run onRemove callback
    if (aura.onRemove) {
      aura.onRemove(this.unit, aura);
    }

    this.auras.delete(auraId);
    return aura;
  }

  getAura(id) {
    return this.auras.get(id) || null;
  }

  has(id) {
    return this.auras.has(id);
  }

  hasAura(id) {
    return this.auras.has(id);
  }

  getAurasByType(type) {
    const result = [];
    for (const aura of this.auras.values()) {
      if (aura.type === type) result.push(aura);
    }
    return result;
  }

  getDebuffs() {
    return this.getAurasByType(AURA_TYPE.DEBUFF)
      .concat(this.getAurasByType(AURA_TYPE.DOT));
  }

  getBuffs() {
    return this.getAurasByType(AURA_TYPE.BUFF)
      .concat(this.getAurasByType(AURA_TYPE.HOT))
      .concat(this.getAurasByType(AURA_TYPE.ABSORB));
  }

  removeAllMagicDebuffs() {
    const toRemove = [];
    for (const [id, aura] of this.auras) {
      if ((aura.type === AURA_TYPE.DEBUFF || aura.type === AURA_TYPE.DOT) && aura.isMagic) {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      this.remove(id);
    }
    return toRemove.length;
  }

  removeAllDebuffs() {
    const toRemove = [];
    for (const [id, aura] of this.auras) {
      if (aura.type === AURA_TYPE.DEBUFF || aura.type === AURA_TYPE.DOT) {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      this.remove(id);
    }
    return toRemove.length;
  }

  tick(currentTick) {
    const expired = [];
    const ticked = [];

    for (const [id, aura] of this.auras) {
      // Check expiration
      if (aura.isExpired(currentTick)) {
        expired.push(id);
        continue;
      }

      // Process periodic effects
      if (aura.shouldTick(currentTick)) {
        ticked.push(aura);
        aura.advanceTick();
      }
    }

    // Remove expired auras
    for (const id of expired) {
      this.remove(id);
    }

    return ticked; // Return ticked auras for damage/healing processing
  }

  applyStatMods(aura) {
    for (const [stat, value] of Object.entries(aura.statMods)) {
      if (stat in this.unit.stats) {
        this.unit.stats[stat] *= value;
      }
    }
  }

  revertStatMods(aura) {
    for (const [stat, value] of Object.entries(aura.statMods)) {
      if (stat in this.unit.stats && value !== 0) {
        this.unit.stats[stat] /= value;
      }
    }
  }

  removeAll() {
    const ids = [...this.auras.keys()];
    for (const id of ids) {
      this.remove(id);
    }
  }

  get count() {
    return this.auras.size;
  }

  serialize() {
    const result = [];
    for (const aura of this.auras.values()) {
      if (!aura.isHidden) {
        result.push({
          id: aura.id,
          name: aura.name,
          type: aura.type,
          stacks: aura.stacks
        });
      }
    }
    return result;
  }
}
