import { RESOURCE_TYPE, TICKS_PER_SECOND } from '../constants.js';

export class ResourcePool {
  constructor(type, max, current = null, regenPerSecond = 0) {
    this.type = type;
    this.max = max;
    this.current = current !== null ? current : max;
    this.baseRegenPerSecond = regenPerSecond;
    this.regenPerSecond = regenPerSecond;
    this.regenModifier = 1.0;
  }

  spend(amount) {
    if (this.current < amount) return false;
    this.current -= amount;
    return true;
  }

  gain(amount) {
    this.current = Math.min(this.max, this.current + amount);
  }

  canAfford(amount) {
    return this.current >= amount;
  }

  tick() {
    if (this.regenPerSecond > 0) {
      const regenPerTick = (this.regenPerSecond * this.regenModifier) / TICKS_PER_SECOND;
      this.gain(regenPerTick);
    }
  }

  setRegenModifier(mod) {
    this.regenModifier = mod;
  }

  reset(current = null) {
    this.current = current !== null ? current : this.max;
    this.regenModifier = 1.0;
  }

  get percent() {
    return this.max > 0 ? this.current / this.max : 0;
  }
}

export class ResourceSystem {
  constructor() {
    this.pools = new Map();
  }

  addPool(type, max, startValue = null, regenPerSecond = 0) {
    this.pools.set(type, new ResourcePool(type, max, startValue, regenPerSecond));
    return this;
  }

  get(type) {
    return this.pools.get(type);
  }

  spend(type, amount) {
    const pool = this.pools.get(type);
    if (!pool) return false;
    return pool.spend(amount);
  }

  gain(type, amount) {
    const pool = this.pools.get(type);
    if (pool) pool.gain(amount);
  }

  canAfford(type, amount) {
    const pool = this.pools.get(type);
    if (!pool) return false;
    return pool.canAfford(amount);
  }

  set(type, value) {
    const pool = this.pools.get(type);
    if (pool) pool.current = Math.max(0, Math.min(pool.max, value));
  }

  getCurrent(type) {
    const pool = this.pools.get(type);
    return pool ? pool.current : 0;
  }

  getMax(type) {
    const pool = this.pools.get(type);
    return pool ? pool.max : 0;
  }

  tick() {
    for (const pool of this.pools.values()) {
      pool.tick();
    }
  }

  reset() {
    for (const pool of this.pools.values()) {
      pool.reset();
    }
  }
}
