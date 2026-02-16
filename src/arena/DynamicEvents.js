import { Vec3 } from '../utils/Vec3.js';
import { CC_TYPE } from '../constants.js';
import { CrowdControlSystem } from '../engine/CrowdControl.js';
import { Aura } from '../engine/Aura.js';

const COLLECT_RADIUS = 3; // yards to collect an orb

/**
 * Base class for dynamic arena events
 */
class ArenaEvent {
  constructor(type, position, duration, matchState) {
    this.type = type;
    this.position = position;
    this.duration = duration; // ticks
    this.spawnTick = matchState.tick;
    this.expireTick = matchState.tick + duration;
    this.expired = false;
    this.collected = false;
    this.collectible = true;
  }

  tick(engine, currentTick) {
    if (currentTick >= this.expireTick) {
      this.expired = true;
      return;
    }

    if (this.collectible) {
      for (const unit of engine.match.units) {
        if (!unit.isAlive) continue;
        const dist = unit.position.distanceXZ(this.position);
        if (dist <= COLLECT_RADIUS) {
          this.onCollect(engine, unit, currentTick);
          this.collected = true;
          this.expired = true;
          return;
        }
      }
    }
  }

  onCollect(engine, unit, currentTick) {}
}

/**
 * Power Orb — +20% damage for 12s
 */
class PowerOrb extends ArenaEvent {
  constructor(matchState, rng) {
    super('power_orb', new Vec3(0, 0, 0), 150, matchState);
  }

  onCollect(engine, unit, currentTick) {
    unit.auras.apply(new Aura({
      id: 'power_orb_buff',
      name: 'Power Surge',
      type: 'buff',
      sourceId: -1,
      targetId: unit.id,
      duration: 120,
      appliedTick: currentTick,
      statMods: { damageDealtMod: 1.20 }
    }));
  }
}

/**
 * Healing Orb — instant 25000 HP heal
 */
class HealingOrb extends ArenaEvent {
  constructor(matchState, rng) {
    const pillar = rng.pick(matchState.los.pillars);
    const offset = rng.range(-3, 3);
    super('healing_orb', new Vec3(pillar.x + offset, 0, pillar.z + offset), 150, matchState);
  }

  onCollect(engine, unit, currentTick) {
    engine.healUnit(unit, unit, 25000, currentTick);
  }
}

/**
 * Shield Rune — 15000 HP absorb
 */
class ShieldRune extends ArenaEvent {
  constructor(matchState, rng) {
    super('shield_rune', new Vec3(0, 0, 0), 150, matchState);
  }

  onCollect(engine, unit, currentTick) {
    unit.addAbsorb(15000, currentTick + 200, 'shield_rune');
  }
}

/**
 * Speed Shrine — +30% movement for 15s
 */
class SpeedShrine extends ArenaEvent {
  constructor(matchState, rng) {
    const pillar = rng.pick(matchState.los.pillars);
    super('speed_shrine', new Vec3(pillar.x, 0, pillar.z + 4), 150, matchState);
  }

  onCollect(engine, unit, currentTick) {
    unit.auras.apply(new Aura({
      id: 'speed_shrine_buff',
      name: 'Swift',
      type: 'buff',
      sourceId: -1,
      targetId: unit.id,
      duration: 150,
      appliedTick: currentTick,
      statMods: { moveSpeedMultiplier: 1.30 }
    }));
  }
}

/**
 * Mana Crystal — restore 3000 mana
 */
class ManaCrystal extends ArenaEvent {
  constructor(matchState, rng) {
    const x = rng.range(-15, 15);
    const z = rng.range(-15, 15);
    super('mana_crystal', new Vec3(x, 0, z), 150, matchState);
  }

  onCollect(engine, unit, currentTick) {
    unit.resources.gain('mana', 3000);
  }
}

/**
 * Hazard Zone — AoE damage area
 */
class HazardZone extends ArenaEvent {
  constructor(matchState, rng) {
    const x = rng.range(-20, 20);
    const z = rng.range(-20, 20);
    super('hazard_zone', new Vec3(x, 0, z), 200, matchState);
    this.collectible = false;
    this.radius = 8;
    this.warningTicks = 30;
    this.activeTick = matchState.tick + this.warningTicks;
  }

  tick(engine, currentTick) {
    if (currentTick >= this.expireTick) {
      this.expired = true;
      return;
    }

    if (currentTick < this.activeTick) return;

    if ((currentTick - this.activeTick) % 10 === 0) {
      for (const unit of engine.match.units) {
        if (!unit.isAlive) continue;
        const dist = unit.position.distanceXZ(this.position);
        if (dist <= this.radius) {
          engine.dealDamage(unit, unit, 2000, 'fire', 'hazard_zone', currentTick);
        }
      }
    }
  }
}

/**
 * CC Totem — stuns first player within range
 */
class CCTotem extends ArenaEvent {
  constructor(matchState, rng) {
    const x = rng.range(-18, 18);
    const z = rng.range(-18, 18);
    super('cc_totem', new Vec3(x, 0, z), 300, matchState);
    this.triggerRadius = 8;
    this.triggered = false;
  }

  tick(engine, currentTick) {
    if (currentTick >= this.expireTick || this.triggered) {
      this.expired = true;
      return;
    }

    for (const unit of engine.match.units) {
      if (!unit.isAlive) continue;
      const dist = unit.position.distanceXZ(this.position);
      if (dist <= this.triggerRadius) {
        CrowdControlSystem.applyCC(
          { id: -1, totalCCTimeInflicted: 0 },
          unit, CC_TYPE.STUN, 20, currentTick
        );
        this.triggered = true;
        this.expired = true;
        return;
      }
    }
  }
}

export const EVENT_FACTORIES = [
  (ms, rng) => new PowerOrb(ms, rng),
  (ms, rng) => new HealingOrb(ms, rng),
  (ms, rng) => new ShieldRune(ms, rng),
  (ms, rng) => new SpeedShrine(ms, rng),
  (ms, rng) => new ManaCrystal(ms, rng),
  (ms, rng) => new HazardZone(ms, rng),
  (ms, rng) => new CCTotem(ms, rng)
];
