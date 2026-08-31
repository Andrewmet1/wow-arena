import { LineOfSight } from './LineOfSight.js';
import { variantPillars } from '../arena/ArenaVariants.js';
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
    // Arena layout. Passed through from the room so cover and boundary come
    // from the chosen variant rather than a single hardcoded shape.
    this.arenaVariant = config.arenaVariant || null;
    this.los = this.arenaVariant
      ? new LineOfSight(variantPillars(this.arenaVariant), this.arenaVariant.radius)
      : new LineOfSight();

    // Arena
    this.dynamicEvents = []; // Active events on the field

    // Targeting
    this.targets = new Map(); // unitId -> targetId

    // Config
    this.maxTicks = config.maxTicks || 6000; // 10 minutes
    this.isSimulation = config.isSimulation || false;
    this.mode = config.mode || '1v1'; // '1v1' or '2v2'

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
    const unit = this.getUnit(unitId);
    const targetId = this.targets.get(unitId);
    if (targetId != null) {
      const target = this.units.find(u => u.id === targetId && u.isAlive);
      if (target) {
        // In team mode, skip if target is an ally
        if (unit?.team != null && target.team === unit.team) { /* fall through */ }
        else return target;
      }
    }
    // Fallback: first alive enemy
    const enemies = this.getEnemies(unitId);
    return enemies.length > 0 ? enemies[0] : null;
  }

  getEnemies(unitId) {
    const unit = this.getUnit(unitId);
    if (!unit || unit.team == null) return this.units.filter(u => u.id !== unitId && u.isAlive);
    return this.units.filter(u => u.team !== unit.team && u.isAlive);
  }

  getAllies(unitId) {
    const unit = this.getUnit(unitId);
    if (!unit || unit.team == null) return [];
    return this.units.filter(u => u.id !== unitId && u.team === unit.team && u.isAlive);
  }

  isEnemy(unitA, unitB) {
    if (unitA.team != null) return unitB.team !== unitA.team;
    return unitA.id !== unitB.id;
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
    // Dungeon: match only ends when the player (slot 0) dies. Monster deaths
    // are non-terminal — DungeonRoom advances to the next encounter externally.
    if (this.mode === 'dungeon') {
      const player = this.units[0];
      if (player && !player.isAlive) {
        this.end(null, player);
        return true;
      }
      return false;
    }
    if (this.mode === '2v2') {
      const t0Alive = this.units.filter(u => u.team === 0 && u.isAlive).length;
      const t1Alive = this.units.filter(u => u.team === 1 && u.isAlive).length;
      if (t0Alive === 0 && t1Alive === 0) {
        this.end({ team: 0 }, { team: 1 }); // simultaneous wipe edge case
        return true;
      }
      if (t0Alive === 0) { this.end({ team: 1 }, { team: 0 }); return true; }
      if (t1Alive === 0) { this.end({ team: 0 }, { team: 1 }); return true; }
      if (this.tick >= this.maxTicks) {
        const t0Hp = this.units.filter(u => u.team === 0).reduce((s, u) => s + u.hp / u.maxHp, 0);
        const t1Hp = this.units.filter(u => u.team === 1).reduce((s, u) => s + u.hp / u.maxHp, 0);
        this.end({ team: t0Hp >= t1Hp ? 0 : 1 }, { team: t0Hp >= t1Hp ? 1 : 0 });
        return true;
      }
      return false;
    }

    // 1v1 logic
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
      winner: this.winner?.id ?? this.winner?.team ?? null,
      events: this.dynamicEvents.map(e => ({
        type: e.type,
        position: e.position?.toArray()
      }))
    };
  }
}
