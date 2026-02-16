import { AURA_TYPE } from '../constants.js';

export class Aura {
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.type = config.type || AURA_TYPE.BUFF;
    this.sourceId = config.sourceId;
    this.targetId = config.targetId;
    this.school = config.school || 'physical';

    // Timing
    this.duration = config.duration; // total ticks
    this.appliedTick = config.appliedTick;
    this.endTick = config.appliedTick + config.duration;

    // Periodic
    this.isPeriodic = config.isPeriodic || false;
    this.tickInterval = config.tickInterval || 10; // ticks between periodic effects
    this.nextTickAt = config.appliedTick + (config.tickInterval || 10);
    this.tickDamage = config.tickDamage || 0;
    this.tickHealing = config.tickHealing || 0;

    // Stat modifications
    this.statMods = config.statMods || {}; // { damageDealtMod: 1.3, moveSpeedMultiplier: 0.5, ... }

    // Healing reduction (for Mortal Wounds)
    this.healingReduction = config.healingReduction || 0;

    // Custom data
    this.stacks = config.stacks || 1;
    this.maxStacks = config.maxStacks || 1;
    this.data = config.data || {};

    // Flags
    this.isMagic = config.isMagic !== undefined ? config.isMagic : true;
    this.isDispellable = config.isDispellable !== undefined ? config.isDispellable : true;
    this.isHidden = config.isHidden || false;

    // Callbacks
    this.onApply = config.onApply || null;
    this.onRemove = config.onRemove || null;
    this.onTick = config.onTick || null; // custom tick behavior
  }

  isExpired(currentTick) {
    return currentTick >= this.endTick;
  }

  shouldTick(currentTick) {
    return this.isPeriodic && currentTick >= this.nextTickAt;
  }

  advanceTick() {
    this.nextTickAt += this.tickInterval;
  }

  refresh(currentTick, newDuration = null) {
    const dur = newDuration || this.duration;
    this.endTick = currentTick + dur;
    this.appliedTick = currentTick;
  }

  addStack() {
    if (this.stacks < this.maxStacks) {
      this.stacks++;
    }
  }

  getRemainingTicks(currentTick) {
    return Math.max(0, this.endTick - currentTick);
  }

  getRemainingSeconds(currentTick) {
    return this.getRemainingTicks(currentTick) / 10;
  }

  serialize() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      stacks: this.stacks,
      remainingTicks: 0 // set externally
    };
  }
}
