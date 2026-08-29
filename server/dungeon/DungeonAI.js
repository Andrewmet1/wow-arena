import { Vec3 } from '../../src/utils/Vec3.js';

// Dungeon-specific AI — state machine with aggro zones.
//
// Replaces the PvP AIController for monsters. PvP AI assumes an active
// 1v1/2v2 with constant pressure; that's not the dungeon vibe. Here mobs
// idle until the player walks into their aggro radius (Dark Souls / WoW
// dungeon style), then pursue, then de-aggro if the player escapes far
// enough or breaks LOS for several seconds.
//
// Aggro radius and abilities come from the monster archetype config.
//
// States:
//   idle    — standing still near spawn, not aware of player
//   pursue  — moving toward player, attacking when in range
//   return  — broke aggro, walking back to spawn position

const TICKS_PER_SECOND = 10;
const LOS_BREAK_TICKS = 5 * TICKS_PER_SECOND;     // 5s out of LOS = de-aggro
const PURSUE_GIVEUP_DIST_MULT = 2.5;               // de-aggro past 2.5x aggro radius

export class DungeonAI {
  constructor(slot, archetypeConfig, behaviors = null) {
    this.slot = slot;
    this.archetype = archetypeConfig;
    this.aggroRadius = archetypeConfig.aggroRadius || 14;
    this.behavior = archetypeConfig.aiBehavior || 'aggressive_melee';
    this.behaviors = behaviors;

    this.state = 'idle';
    this.spawnPos = null;
    this.lastSeenPlayerTick = 0;
    this._abilityCooldowns = new Map(); // abilityId -> next available tick (best-effort)

    // Patrol — when idle, monsters wander around their spawn point so they
    // look alive and unaware rather than frozen statues. Each monster picks
    // a random waypoint within `patrolRadius` of spawn, walks there, pauses,
    // picks a new one. Never wanders into another monster's spawn area.
    this._patrolWaypoint = null;
    this._patrolPauseUntil = 0;
    this.patrolRadius = archetypeConfig.patrolRadius || 6;

    // Obstacle-avoidance state — track position over time. If a monster has
    // queued movement but barely moved across several ticks, it's wedged on
    // a pillar/wall; sidestep perpendicular to the desired direction until
    // the obstacle clears. Cheap alternative to a real nav grid.
    this._lastPos = null;
    this._stuckTicks = 0;
    this._sidestepUntilTick = 0;
    this._sidestepSign = 1;
  }

  /**
   * Called once per server tick by DungeonRoom.
   * Drives the unit via engine.movement / engine.queueAbility.
   */
  decide(match, engine, currentTick) {
    const self = match.units.find(u => u.id === this.slot);
    if (!self || !self.isAlive) return;

    // Cache spawn position on first decide
    if (!this.spawnPos) {
      this.spawnPos = { x: self.position.x, z: self.position.z };
    }

    const player = match.units[0];
    if (!player || !player.isAlive) {
      this._goIdle(engine, self);
      return;
    }

    const dx = player.position.x - self.position.x;
    const dz = player.position.z - self.position.z;
    const distToPlayer = Math.sqrt(dx * dx + dz * dz);

    // ── State transitions ─────────────────────────────────────────────
    if (this.state === 'idle') {
      if (distToPlayer < this.aggroRadius) {
        this.state = 'pursue';
        this.lastSeenPlayerTick = currentTick;
        match.setTarget(this.slot, 0);
      }
    } else if (this.state === 'pursue') {
      const hasLos = match.los?.hasLineOfSight
        ? match.los.hasLineOfSight(self.position, player.position)
        : true;
      if (hasLos) this.lastSeenPlayerTick = currentTick;

      const tooFar = distToPlayer > this.aggroRadius * PURSUE_GIVEUP_DIST_MULT;
      const lostSight = currentTick - this.lastSeenPlayerTick > LOS_BREAK_TICKS;
      if (tooFar || lostSight) {
        this.state = 'return';
      }
    } else if (this.state === 'return') {
      const dxs = self.position.x - this.spawnPos.x;
      const dzs = self.position.z - this.spawnPos.z;
      const distToSpawn = Math.sqrt(dxs * dxs + dzs * dzs);
      if (distToSpawn < 2) {
        this.state = 'idle';
        // Heal back to full when returning to spawn — Dark Souls reset
        self.hp = self.maxHp;
      } else if (distToPlayer < this.aggroRadius) {
        // Re-aggroed mid-return
        this.state = 'pursue';
        this.lastSeenPlayerTick = currentTick;
      }
    }

    // ── State actions ─────────────────────────────────────────────────
    switch (this.state) {
      case 'idle':       this._actIdle(engine, self); break;
      case 'pursue':     this._actPursue(engine, self, player, distToPlayer, dx, dz, currentTick); break;
      case 'return':     this._actReturn(engine, self); break;
    }
  }

  _goIdle(engine, self) {
    this.state = 'idle';
    engine.movement.stop(self);
  }

  _actIdle(engine, self) {
    // Patrol behavior: pick a random waypoint within patrolRadius of spawn,
    // walk slowly there, pause for 1-3s, repeat. Makes monsters feel alive
    // and unaware of the player rather than frozen in T-pose.
    const currentTick = self._currentTick || 0;
    const now = Date.now();

    // If pausing, just stand still
    if (this._patrolPauseUntil > now) {
      engine.movement.stop(self);
      return;
    }

    // Pick a new waypoint if we don't have one
    if (!this._patrolWaypoint) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * this.patrolRadius;
      this._patrolWaypoint = {
        x: this.spawnPos.x + Math.cos(angle) * dist,
        z: this.spawnPos.z + Math.sin(angle) * dist,
      };
    }

    // Walk toward waypoint. MovementSystem only knows moveTo + stop, so we
    // hand it the waypoint as the destination — speed is handled by the unit's
    // base move speed (no sprint vs. stroll distinction here yet).
    const dx = this._patrolWaypoint.x - self.position.x;
    const dz = this._patrolWaypoint.z - self.position.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < 0.5) {
      // Reached waypoint — pause 1-3s, then pick new one
      engine.movement.stop(self);
      this._patrolWaypoint = null;
      this._patrolPauseUntil = now + 1000 + Math.random() * 2000;
      return;
    }
    engine.movement.moveTo(self, new Vec3(this._patrolWaypoint.x, 0, this._patrolWaypoint.z));
  }

  _actPursue(engine, self, player, distToPlayer, dx, dz, currentTick) {
    const norm = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
    const meleeRange = 4.5;

    // Compute the desired chase direction first, then run obstacle avoidance
    // over it. This way both kite_caster (move away) and melee (move toward)
    // benefit from the same sidestep-when-stuck behavior.
    let dirX = 0, dirZ = 0;
    let wantsToMove = false;
    let wantsToCast = false;
    let wantsAutoAttack = false;

    if (this.behavior === 'kite_caster' && this.archetype.abilities?.length > 0) {
      const desiredRange = 18;
      if (distToPlayer < 8) {
        dirX = -dx / norm; dirZ = -dz / norm; wantsToMove = true;
      } else if (distToPlayer > desiredRange) {
        dirX = dx / norm; dirZ = dz / norm; wantsToMove = true;
      } else {
        wantsToCast = true;
      }
    } else {
      // Melee archetypes (default): close to melee, attack
      if (distToPlayer > meleeRange) {
        dirX = dx / norm; dirZ = dz / norm; wantsToMove = true;
      } else {
        wantsAutoAttack = true;
        if (this.archetype.abilities?.length > 0) wantsToCast = true;
      }
    }

    // Obstacle avoidance: if we wanted to move but didn't actually move much
    // for a few ticks, we're jammed on a pillar/wall/another monster. Pick a
    // perpendicular sidestep and commit for ~10 ticks (1s) so we don't
    // oscillate back into the obstacle.
    if (wantsToMove) {
      if (this._lastPos) {
        const movedSq = (self.position.x - this._lastPos.x) ** 2
                      + (self.position.z - this._lastPos.z) ** 2;
        if (movedSq < 0.01) this._stuckTicks++;
        else this._stuckTicks = Math.max(0, this._stuckTicks - 1);
      }
      this._lastPos = { x: self.position.x, z: self.position.z };

      const stillSidestepping = currentTick < this._sidestepUntilTick;
      if (this._stuckTicks > 5 || stillSidestepping) {
        if (!stillSidestepping) {
          // Pick a sidestep direction once per stuck event — alternate L/R so
          // a row of monsters jamming on the same pillar disperses.
          this._sidestepSign = Math.random() < 0.5 ? -1 : 1;
          this._sidestepUntilTick = currentTick + 10;
          this._stuckTicks = 0;
        }
        // Rotate desired direction 90° in the chosen sign — perpendicular
        // strafe past the obstacle while still trending toward the goal.
        const sx = -dirZ * this._sidestepSign;
        const sz =  dirX * this._sidestepSign;
        // Blend 70% sidestep + 30% original so we don't run perfectly
        // sideways and never get any closer.
        dirX = sx * 0.7 + dirX * 0.3;
        dirZ = sz * 0.7 + dirZ * 0.3;
        const m = Math.max(0.001, Math.sqrt(dirX * dirX + dirZ * dirZ));
        dirX /= m; dirZ /= m;
      }
      // Project a point ~6 units in the desired direction so MovementSystem's
      // moveTo gets a real destination (it doesn't have a setDirection API).
      const lookahead = 6;
      engine.movement.moveTo(
        self,
        new Vec3(self.position.x + dirX * lookahead, 0, self.position.z + dirZ * lookahead),
      );
    } else {
      this._stuckTicks = 0;
      this._sidestepUntilTick = 0;
      engine.movement.stop(self);
      self.facing = Math.atan2(dx, dz);
    }

    if (wantsToCast) this._tryAbility(engine, currentTick);
    // Auto-attack is handled by engine.processAutoAttack when in melee range
  }

  _actReturn(engine, self) {
    engine.movement.moveTo(self, new Vec3(this.spawnPos.x, 0, this.spawnPos.z));
  }

  /** Try the first whitelisted ability if its (best-effort) cooldown is up. */
  _tryAbility(engine, currentTick) {
    if (!this.archetype.abilities?.length) return;
    // Boss-tier: cycle through abilities, randomized order, with telegraphed
    // windups (the ability's own castTime acts as the telegraph window).
    let abilityId;
    if (this.behavior === 'boss_warlord' && this.archetype.abilities.length > 1) {
      // Pick a random ability from the boss's pool, but prefer one not used
      // recently so the player sees variety per encounter (Dark Souls-y).
      const recentlyUsed = new Set();
      for (const [id, tick] of this._abilityCooldowns) {
        if (currentTick - tick < 100) recentlyUsed.add(id);
      }
      const fresh = this.archetype.abilities.filter(id => !recentlyUsed.has(id));
      const pool = fresh.length ? fresh : this.archetype.abilities;
      abilityId = pool[Math.floor(Math.random() * pool.length)];
    } else {
      abilityId = this.archetype.abilities[0];
    }
    const nextAt = this._abilityCooldowns.get(abilityId) || 0;
    if (currentTick < nextAt) return;
    engine.queueAbility(this.slot, abilityId, 0);
    // Lazy cooldown estimate — server-side ability has the real CD; we just
    // throttle our queueing so the AI doesn't hammer the same ability every tick.
    // Boss has a longer between-ability gap so the player has time to dodge.
    const gap = this.behavior === 'boss_warlord' ? 60 : 80;
    this._abilityCooldowns.set(abilityId, currentTick + gap);
  }
}
