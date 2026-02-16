import { LineOfSight } from './LineOfSight.js';
import { EventBus } from '../utils/EventBus.js';
import { SeededRandom } from '../utils/Random.js';

export class MatchState {
  constructor(config = {}) {
    this.tick = 0;
    this.active = false;
    this.winner = null;
    this.loser = null;

    // Units
    this.units = []; // [unit0, unit1]

    // Systems
    this.eventBus = config.eventBus || new EventBus();
    this.rng = config.rng || new SeededRandom(config.seed || Date.now());
    this.los = new LineOfSight();

    // Arena
    this.arenaModifiers = []; // Active modifiers for this match
    this.dynamicEvents = []; // Active events on the field

    // Targeting
    this.targets = new Map(); // unitId -> targetId

    // Config
    this.maxTicks = config.maxTicks || 6000; // 10 minutes
    this.isSimulation = config.isSimulation || false;

    // Match stats
    this.startTime = 0;
    this.endTime = 0;
  }

  addUnit(unit) {
    this.units.push(unit);
  }

  getUnit(id) {
    return this.units.find(u => u.id === id);
  }

  getOpponent(unitId) {
    // If unit has a selected target, return that
    const targetId = this.targets.get(unitId);
    if (targetId) {
      const target = this.units.find(u => u.id === targetId && u.isAlive);
      if (target) return target;
    }
    // Fallback: first alive enemy
    return this.units.find(u => u.id !== unitId && u.isAlive);
  }

  getEnemies(unitId) {
    return this.units.filter(u => u.id !== unitId && u.isAlive);
  }

  setTarget(unitId, targetId) {
    this.targets.set(unitId, targetId);
  }

  getTarget(unitId) {
    return this.targets.get(unitId) || null;
  }

  start() {
    this.active = true;
    this.tick = 0;
    this.winner = null;
    this.loser = null;
    this.startTime = Date.now();
  }

  end(winner, loser) {
    this.active = false;
    this.winner = winner;
    this.loser = loser;
    this.endTime = Date.now();
  }

  checkWinCondition() {
    for (const unit of this.units) {
      if (!unit.isAlive) {
        const winner = this.units.find(u => u.isAlive);
        const loser = unit;
        this.end(winner, loser);
        return true;
      }
    }

    // Timeout — whoever has more HP% wins
    if (this.tick >= this.maxTicks) {
      const sorted = [...this.units].sort((a, b) => (b.hp / b.maxHp) - (a.hp / a.maxHp));
      this.end(sorted[0], sorted[1]);
      return true;
    }

    return false;
  }

  getMatchDuration() {
    return this.tick / 10; // seconds
  }

  serialize() {
    return {
      tick: this.tick,
      active: this.active,
      units: this.units.map(u => u.serialize()),
      winner: this.winner?.id || null,
      modifiers: this.arenaModifiers.map(m => m.id),
      events: this.dynamicEvents.map(e => ({
        type: e.type,
        position: e.position?.toArray()
      }))
    };
  }
}
