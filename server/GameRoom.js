import { MatchState } from '../src/engine/MatchState.js';
import { CombatEngine } from '../src/engine/CombatEngine.js';
import { Unit } from '../src/engine/Unit.js';
import { CLASS_REGISTRY } from '../src/classes/ClassRegistry.js';
import { EventBus, EVENTS } from '../src/utils/EventBus.js';
import { SeededRandom } from '../src/utils/Random.js';
import { Vec3 } from '../src/utils/Vec3.js';
import { TICK_RATE, BASE_MOVE_SPEED, TICKS_PER_SECOND } from '../src/constants.js';
import { calculateEloChange, calculateChallengeEloChange, calculateContributionScore, calculateTeamEloChange } from './elo.js';
import * as db from './db.js';
import { updateChallengeProgress } from './challenges.js';
import { AIController } from '../src/ai/AIController.js';

const WS_OPEN = 1;

export class GameRoom {
  constructor(code, opts = {}) {
    this.code = code;
    this.mode = opts.mode || '1v1';
    const playerCount = this.mode === '2v2' ? 4 : 2;
    this.players = new Array(playerCount).fill(null);
    this.match = null;
    this.engine = null;
    this.tickInterval = null;
    this.pendingInputs = Array.from({ length: playerCount }, () => []);
    // Highest input sequence number applied per slot. Sent back with state so a
    // client knows exactly which of its inputs the server has seen, and can
    // replay only the ones still in flight. Without it a client can only guess
    // — which is what a fixed rollback timeout is, a guess.
    this.lastAckedSeq = Array.from({ length: playerCount }, () => 0);
    this.eventBuffer = []; // events accumulated during current tick
    this.ranked = opts.ranked || false;
    this.playerMeta = opts.playerMeta || {}; // slot -> { sub, elo, username, classId }
    this.challenge = opts.challenge || false;
    this.challengeData = opts.challengeData || null; // { challengeId, wager, amplifier, challengerSlot }
    this.onChallengeEnd = null; // callback set by index.js
    this.isPractice = opts.practice || false;
    this.aiControllers = {}; // slot -> AIController instance

    // Spectator support
    this.spectators = []; // Array of { ws, sub, username }
    this.isChampionMatch = false;
    this.championClassId = null;
    this.maxSpectators = 50;
  }

  addPlayer(ws, classId, slot) {
    this.players[slot] = { ws, classId, slot };
    ws.playerSlot = slot;
  }

  addAIPlayer(classId, slot) {
    this.players[slot] = { ws: null, classId, slot, isAI: true };
  }

  // ── Spectator Methods ──────────────────────────────────────────

  addSpectator(ws, sub, username) {
    if (this.spectators.length >= this.maxSpectators) return false;
    if (this.spectators.some(s => s.ws === ws)) return false;
    this.spectators.push({ ws, sub, username });

    // Send current state snapshot so spectator can join mid-match
    if (this.match) {
      const initMsg = {
        type: 'spectator_init',
        roomCode: this.code,
        tick: this.match.tick,
        units: this.match.units.map(u => ({
          id: u.id,
          classId: u.classId,
          name: u.name,
          hp: Math.round(u.hp),
          maxHp: u.maxHp,
          position: [
            Math.round(u.position.x * 100) / 100,
            0,
            Math.round(u.position.z * 100) / 100
          ],
          facing: Math.round(u.facing * 1000) / 1000,
          alive: u.alive,
          resources: this._serializeResources(u),
          auras: u.auras.serialize(),
          abilities: [...u.abilities.keys()],
        })),
        playerMeta: Object.fromEntries(
          this.players.map((_, i) => [i, this.playerMeta[i]
            ? { username: this.playerMeta[i].username, elo: this.playerMeta[i].elo, rating: this.playerMeta[i].rating || 0, classId: this.playerMeta[i].classId, activeFrame: this.playerMeta[i].activeFrame || null, activeTitle: this.playerMeta[i].activeTitle || null }
            : null
          ])
        ),
        isChampionMatch: this.isChampionMatch,
        championClassId: this.championClassId,
      };
      if (ws.readyState === WS_OPEN) {
        ws.send(JSON.stringify(initMsg));
      }
    }

    this._broadcastSpectatorCount();
    return true;
  }

  removeSpectator(ws) {
    const idx = this.spectators.findIndex(s => s.ws === ws);
    if (idx !== -1) {
      this.spectators.splice(idx, 1);
      this._broadcastSpectatorCount();
      return true;
    }
    return false;
  }

  getSpectatorCount() {
    return this.spectators.length;
  }

  _broadcastSpectatorCount() {
    const msg = JSON.stringify({ type: 'spectator_count', count: this.spectators.length, roomCode: this.code });
    for (const s of this.spectators) {
      if (s.ws.readyState === WS_OPEN) s.ws.send(msg);
    }
    // Also inform players
    for (const p of this.players) {
      if (p?.ws?.readyState === WS_OPEN) p.ws.send(msg);
    }
  }

  _sendToSpectators(msg) {
    const data = typeof msg === 'string' ? msg : JSON.stringify(msg);
    for (const s of this.spectators) {
      if (s.ws.readyState === WS_OPEN) s.ws.send(data);
    }
  }

  isFull() {
    return this.players.every(p => p !== null);
  }

  isEmpty() {
    return this.players.every(p => p === null || p.isAI);
  }

  startMatch() {
    const seed = Date.now();
    const rng = new SeededRandom(seed);
    const eventBus = new EventBus();

    this.match = new MatchState({ eventBus, rng, seed, mode: this.mode });
    this.engine = new CombatEngine(this.match);

    // Create units from each player's class
    const playerCount = this.players.length;
    for (let i = 0; i < playerCount; i++) {
      const player = this.players[i];
      const classDef = CLASS_REGISTRY[player.classId];
      if (!classDef) {
        this.broadcast({ type: 'error', message: `Unknown class: ${player.classId}` });
        return;
      }
      const unit = new Unit(i, player.classId, classDef.name);
      classDef.applyToUnit(unit);
      if (this.mode === '2v2') {
        unit.team = Math.floor(i / 2);
      }
      this.match.addUnit(unit);
    }

    // Position players inside staging cells (gates open after countdown)
    if (this.mode === '2v2') {
      this.match.units[0].position = new Vec3(-43, 0, -3);
      this.match.units[0].facing = Math.PI / 2;
      this.match.units[1].position = new Vec3(-43, 0, 3);
      this.match.units[1].facing = Math.PI / 2;
      this.match.units[2].position = new Vec3(43, 0, -3);
      this.match.units[2].facing = -Math.PI / 2;
      this.match.units[3].position = new Vec3(43, 0, 3);
      this.match.units[3].facing = -Math.PI / 2;
      this.match.setTarget(0, 2);
      this.match.setTarget(1, 3);
      this.match.setTarget(2, 0);
      this.match.setTarget(3, 1);
    } else {
      this.match.units[0].position = new Vec3(-43, 0, 0);
      this.match.units[0].facing = Math.PI / 2;
      this.match.units[1].position = new Vec3(43, 0, 0);
      this.match.units[1].facing = -Math.PI / 2;
      this.match.setTarget(0, 1);
      this.match.setTarget(1, 0);
    }

    // Init AI controllers for bot slots
    for (let i = 0; i < playerCount; i++) {
      const player = this.players[i];
      if (player?.isAI) {
        const ai = new AIController(i, 'hard');
        if (this.mode === '2v2') {
          ai.teamMode = true;
          const team = Math.floor(i / 2);
          ai.allyId = team === 0 ? (i === 0 ? 1 : 0) : (i === 2 ? 3 : 2);
        }
        this.aiControllers[i] = ai;
      }
    }

    // Capture events for broadcast
    this._wireEvents(eventBus);

    // Start
    this.match.start();

    // Build playerMeta for all slots
    const metaPayload = {};
    for (let i = 0; i < playerCount; i++) {
      metaPayload[i] = this.playerMeta[i]
        ? { username: this.playerMeta[i].username, elo: this.playerMeta[i].elo, rating: this.playerMeta[i].rating || 0, activeFrame: this.playerMeta[i].activeFrame || null, activeTitle: this.playerMeta[i].activeTitle || null, activeSkin: this.playerMeta[i].activeSkin || null }
        : null;
    }

    // Notify all players
    const startMsg = {
      type: 'match_start',
      seed,
      mode: this.mode,
      playerMeta: metaPayload,
      // Include duel/wager data if this is a challenge match
      ...(this.challenge && this.challengeData ? {
        duel: { duelId: this.challengeData.duelId, wager: this.challengeData.wager, amplifier: this.challengeData.amplifier }
      } : {}),
      units: this.match.units.map(u => ({
        id: u.id,
        classId: u.classId,
        name: u.name,
        hp: u.hp,
        maxHp: u.maxHp,
        team: u.team,
        position: u.position.toArray(),
        facing: u.facing,
        abilities: [...u.abilities.keys()],
        resources: this._serializeResources(u)
      }))
    };

    // Count human players who need to load
    this._loadedPlayers = new Set();
    this._humanSlots = [];
    for (const p of this.players) {
      if (p && !p.isAI) this._humanSlots.push(p.slot);
    }

    for (const p of this.players) {
      if (p?.ws?.readyState === WS_OPEN) {
        p.ws.send(JSON.stringify({ ...startMsg, yourSlot: p.slot, waitForLoaded: this._humanSlots.length > 1 }));
      }
    }

    const classLog = this.players.map(p => p.classId).join(' vs ');
    console.log(`[Room ${this.code}] ${this.mode} match started: ${classLog}`);

    if (this._humanSlots.length <= 1) {
      // Solo vs AI — start immediately, open gates after countdown
      this._startPreciseTickLoop();
      setTimeout(() => { if (this.match?.los) this.match.los.gatesOpen = true; }, 10000);
    } else {
      // Multi-player — wait for all humans to load, with 120s timeout.
      // Late loaders that finish after this still get a direct match_begin
      // in playerLoaded() so they exit the loading screen.
      this._loadTimeout = setTimeout(() => {
        if (!this.tickInterval) {
          console.log(`[Room ${this.code}] Load timeout — starting match with ${this._loadedPlayers.size}/${this._humanSlots.length} loaded`);
          this._beginMatch();
        }
      }, 120000);
    }
  }

  playerLoaded(slot) {
    if (!this._loadedPlayers) return;
    this._loadedPlayers.add(slot);
    console.log(`[Room ${this.code}] Player ${slot} loaded (${this._loadedPlayers.size}/${this._humanSlots.length})`);

    // If match already started without this player (timeout fired), send them
    // match_begin directly so their client exits the loading screen.
    if (this.tickInterval) {
      const p = this.players.find(pl => pl?.slot === slot);
      if (p?.ws?.readyState === WS_OPEN) {
        p.ws.send(JSON.stringify({ type: 'match_begin' }));
        console.log(`[Room ${this.code}] Sent late match_begin to slot ${slot}`);
      }
      return;
    }

    // Notify all players of loading progress
    this.broadcast({
      type: 'loading_progress',
      loaded: this._loadedPlayers.size,
      total: this._humanSlots.length
    });

    if (this._loadedPlayers.size >= this._humanSlots.length) {
      this._beginMatch();
    }
  }

  _beginMatch() {
    if (this.tickInterval) return; // Already started
    if (this._loadTimeout) { clearTimeout(this._loadTimeout); this._loadTimeout = null; }
    this.broadcast({ type: 'match_begin' });
    // Open gates after 10-second countdown (matches client-side countdown)
    setTimeout(() => {
      if (this.match?.los) this.match.los.gatesOpen = true;
    }, 10000);
    this._startPreciseTickLoop();
  }

  /**
   * Precise tick loop — compensates for timer drift instead of relying on setInterval.
   * Produces consistent tick timing (±2ms vs setInterval's ±25ms).
   */
  _startPreciseTickLoop() {
    this._tickStartTime = Date.now();
    this._tickCount = 0;
    this.tickInterval = true; // Flag that loop is running

    const loop = () => {
      if (!this.tickInterval) return;
      const now = Date.now();
      const elapsed = now - this._tickStartTime;
      const expectedTicks = Math.floor(elapsed / TICK_RATE);

      // Catch up missed ticks (e.g. after GC pause)
      while (this._tickCount < expectedTicks && this.tickInterval) {
        this.tick();
        this._tickCount++;
        if (!this.match?.active) return;
      }

      const nextTickTime = (this._tickCount + 1) * TICK_RATE;
      const delay = Math.max(1, nextTickTime - elapsed);
      this._tickTimer = setTimeout(loop, delay);
    };

    this._tickTimer = setTimeout(loop, TICK_RATE);
  }

  _wireEvents(eventBus) {
    const capturedEvents = [
      EVENTS.DAMAGE_DEALT, EVENTS.HEALING_DONE, EVENTS.UNIT_DIED,
      EVENTS.ABILITY_CAST_START, EVENTS.ABILITY_CAST_SUCCESS, EVENTS.ABILITY_CAST_FAILED,
      EVENTS.ABILITY_INTERRUPTED,
      EVENTS.CHANNEL_START, EVENTS.CHANNEL_TICK, EVENTS.CHANNEL_END,
      EVENTS.CC_APPLIED, EVENTS.CC_REMOVED, EVENTS.CC_IMMUNE,
      EVENTS.AURA_APPLIED, EVENTS.AURA_REFRESHED, EVENTS.AURA_REMOVED, EVENTS.AURA_TICK,
      EVENTS.AUTO_ATTACK,
      EVENTS.STEALTH_ENTER, EVENTS.STEALTH_BREAK,
      EVENTS.ABSORB_APPLIED, EVENTS.ABSORB_CONSUMED,
      EVENTS.MATCH_END
    ];

    for (const eventType of capturedEvents) {
      if (eventType) {
        eventBus.on(eventType, (data) => {
          this.eventBuffer.push({ event: eventType, ...data });
        });
      }
    }
  }

  tick() {
    if (!this.match.active) return;

    // Apply buffered inputs from all players
    for (let i = 0; i < this.players.length; i++) {
      const inputs = this.pendingInputs[i];
      for (const input of inputs) {
        this._applyInput(i, input);
        // Sequence numbers are monotonic per client; hold the highest applied
        // rather than the last, so an out-of-order arrival cannot walk the ack
        // backwards and cause the client to replay inputs twice.
        if (typeof input.seq === 'number' && input.seq > this.lastAckedSeq[i]) {
          this.lastAckedSeq[i] = input.seq;
        }
      }
      this.pendingInputs[i] = [];
    }

    // Clear event buffer for this tick
    this.eventBuffer = [];

    // AI decisions (before engine tick so their inputs are processed this frame)
    for (const [slotStr, ai] of Object.entries(this.aiControllers)) {
      const slot = parseInt(slotStr);
      if (this.match.units[slot]?.isAlive) {
        ai.decide(this.match, this.engine, this.match.tick);
      }
    }

    // Run one engine tick
    this.engine.tick();

    // Broadcast state + events to both clients
    this._broadcastState();

    // Check if match ended
    if (!this.match.active) {
      this._endMatch();
    }
  }

  _applyInput(slot, input) {
    const unit = this.match.units[slot];
    if (!unit || !unit.isAlive) return;

    // Target switching (2v2: client sends targetId to switch between enemies)
    if (input.targetId !== undefined && input.targetId !== null) {
      const target = this.match.getUnit(input.targetId);
      if (target && this.match.isEnemy(unit, target)) {
        this.match.setTarget(slot, input.targetId);
      }
    }

    // Ability usage
    if (input.abilities && input.abilities.length > 0) {
      const targetId = this.match.targets.get(slot) ?? (slot === 0 ? 1 : 0);
      for (const abilityId of input.abilities) {
        this.engine.queueAbility(slot, abilityId, targetId);
      }
    }

    // Movement direction
    if (input.moveDir) {
      const speed = (BASE_MOVE_SPEED * unit.getEffectiveMoveSpeed()) / TICKS_PER_SECOND;
      const targetPos = new Vec3(
        unit.position.x + input.moveDir.x * speed * 5,
        0,
        unit.position.z + input.moveDir.z * speed * 5
      );
      this.engine.movement.moveTo(unit, targetPos);

      // Cancel channels on movement
      if (unit.isChanneling) {
        unit.cancelChannel();
      }
    } else if (input.stopMove) {
      this.engine.movement.stop(unit);
    }

    // Facing
    if (input.facing !== undefined) {
      unit.facing = input.facing;
    }
  }

  _broadcastState() {
    const state = {
      type: 'tick',
      t: this.match.tick,
      u: this.match.units.map(u => this._serializeUnit(u)),
      e: this.eventBuffer,
      // Per-slot input acknowledgement, indexed by slot. Broadcast to everyone
      // because the packet already is; each client reads its own entry.
      ack: this.lastAckedSeq,
    };

    const msg = JSON.stringify(state);
    for (const player of this.players) {
      if (player?.ws?.readyState === WS_OPEN) {
        player.ws.send(msg);
      }
    }

    // Send identical tick data to spectators (reuse player message with patched type)
    if (this.spectators.length > 0) {
      const specMsg = msg.replace('"type":"tick"', '"type":"spectator_tick"');
      for (const s of this.spectators) {
        if (s.ws.readyState === WS_OPEN) s.ws.send(specMsg);
      }
    }
  }

  _serializeUnit(unit) {
    return {
      id: unit.id,
      hp: Math.round(unit.hp),
      maxHp: unit.maxHp,
      pos: [
        Math.round(unit.position.x * 100) / 100,
        0,
        Math.round(unit.position.z * 100) / 100
      ],
      f: Math.round(unit.facing * 1000) / 1000,
      alive: unit.alive,
      stealth: unit.stealthed || false,
      cc: unit.ccEffects.map(c => ({ type: c.type, end: c.endTick })),
      cast: unit.castState ? {
        id: unit.castState.abilityId,
        start: unit.castState.startTick,
        end: unit.castState.endTick
      } : null,
      chan: unit.channelState ? { id: unit.channelState.abilityId, start: unit.channelState.startTick, end: unit.channelState.endTick } : null,
      res: this._serializeResources(unit),
      gcd: unit.gcdEndTick,
      auras: unit.auras.serialize(),
      immune: unit.immuneToAll || false,
      dodging: unit.isDodging || false
    };
  }

  _serializeResources(unit) {
    const res = {};
    for (const [type, pool] of unit.resources.pools) {
      res[type] = { cur: Math.round(pool.current), max: pool.max };
    }
    return res;
  }

  handleInput(ws, msg) {
    const slot = ws.playerSlot;
    if (slot >= 0 && slot < this.players.length) {
      // Cap buffer to prevent memory exhaustion from malicious clients
      if (this.pendingInputs[slot].length >= 20) return;
      // Validate facing: must be a finite number
      if (msg.facing !== undefined) {
        if (typeof msg.facing !== 'number' || !Number.isFinite(msg.facing)) {
          delete msg.facing;
        }
      }
      // Cap abilities array to prevent tick flooding
      if (msg.abilities && msg.abilities.length > 6) {
        msg.abilities = msg.abilities.slice(0, 6);
      }
      // Sequence must be a finite number or the ack it produces is meaningless.
      if (msg.seq !== undefined && (typeof msg.seq !== 'number' || !Number.isFinite(msg.seq))) {
        delete msg.seq;
      }
      this.pendingInputs[slot].push(msg);
    }
  }

  handleDisconnect(ws) {
    // Check if this is a spectator disconnecting
    if (this.removeSpectator(ws)) return;

    const slot = ws.playerSlot;
    if (slot >= 0 && slot < this.players.length) {
      this.players[slot] = null;

      // Practice co-op disconnect — end match immediately
      if (this.isPractice && this.match?.active) {
        this.match.active = false;
        for (const p of this.players) {
          if (p?.ws?.readyState === WS_OPEN) {
            p.ws.send(JSON.stringify({ type: 'opponent_disconnected' }));
          }
        }
        this._endMatch();
        console.log(`[Room ${this.code}] Co-op practice: player ${slot} disconnected — ending match`);
        return;
      }

      // 2v2 disconnect handling
      if (this.mode === '2v2' && (this.ranked || this.challenge) && this.match?.active && !this._matchEnded) {
        const team = Math.floor(slot / 2);
        const teammateSlot = team === 0 ? (slot === 0 ? 1 : 0) : (slot === 2 ? 3 : 2);
        const teammateConnected = this.players[teammateSlot] !== null;

        if (!teammateConnected) {
          // Both team members disconnected — team forfeit
          const winTeam = team === 0 ? 1 : 0;
          this.match.active = false;
          this.match.winner = { team: winTeam };
          this.match.loser = { team };
          this._endMatch();
          console.log(`[Room ${this.code}] Team ${team} forfeited (both disconnected)`);
          return;
        }
        // Single DC — game continues, notify remaining players
        for (const p of this.players) {
          if (p?.ws?.readyState === WS_OPEN) {
            p.ws.send(JSON.stringify({ type: 'player_disconnected', slot }));
          }
        }
        console.log(`[Room ${this.code}] Player ${slot} disconnected (teammate still in)`);
        return;
      }

      // 1v1 ranked/duel forfeit: if match is active AND hasn't already ended
      if ((this.ranked || this.challenge) && this.match?.active && !this._matchEnded) {
        const otherSlot = slot === 0 ? 1 : 0;
        const otherUnit = this.match.units[otherSlot];
        const dcUnit = this.match.units[slot];
        if (otherUnit && dcUnit) {
          this.match.active = false;
          this.match.winner = otherUnit;
          this.match.loser = dcUnit;
          this._endMatch();
          console.log(`[Room ${this.code}] Player ${slot} disconnected — forfeit (ranked)`);
          return;
        }
      }

      // Non-ranked: notify other players
      for (const p of this.players) {
        if (p?.ws?.readyState === WS_OPEN) {
          p.ws.send(JSON.stringify({ type: 'opponent_disconnected' }));
        }
      }
      console.log(`[Room ${this.code}] Player ${slot} disconnected`);
    }
  }

  // Calculate performance score (0-100) for a unit based on combat output.
  // Measures damage dealt + healing done relative to the opponent's max HP.
  _calcPerfScore(unit, opponent) {
    if (!unit || !opponent) return 0;
    const output = (unit.totalDamageDealt || 0) + (unit.totalHealingDone || 0);
    const baseline = opponent.maxHp || 1;
    return Math.min(100, Math.round((output / baseline) * 100));
  }

  async _endMatch() {
    if (this._matchEnded) return; // Prevent double-end (disconnect during async end)
    this._matchEnded = true;
    if (this._tickTimer) { clearTimeout(this._tickTimer); this._tickTimer = null; }
    this.tickInterval = null;

    // 2v2 matches use team-based end logic
    if (this.mode === '2v2') {
      return this._endMatch2v2();
    }

    const winnerId = this.match.winner?.id ?? null;
    const loserId = this.match.loser?.id ?? null;
    const duration = this.match.getMatchDuration();

    if (this.ranked && winnerId !== null && loserId !== null) {
      const winnerMeta = this.playerMeta[winnerId];
      const loserMeta = this.playerMeta[loserId];

      if (winnerMeta && loserMeta) {
        // Use per-class ELO for calculation (queue already passes class-specific ELO as meta.elo)
        const winnerChange = calculateEloChange(winnerMeta.elo, loserMeta.elo, true);
        const loserStreak = loserMeta.currentStreak || 0;
        const loserChange = calculateEloChange(loserMeta.elo, winnerMeta.elo, false, { streak: loserStreak });
        const matchId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        let winnerResult = null;
        let loserResult = null;
        const winnerUnit = this.match.units[winnerId];
        const loserUnit = this.match.units[loserId];
        const loserPerfScore = this._calcPerfScore(loserUnit, winnerUnit);
        try {
          [winnerResult, loserResult] = await Promise.all([
            db.updateEloAndStats(winnerMeta.sub, winnerChange, winnerMeta.classId, true, duration, 100),
            db.updateEloAndStats(loserMeta.sub, loserChange, loserMeta.classId, false, duration, loserPerfScore),
          ]);
          await Promise.all([
            db.recordMatch(winnerMeta.sub, {
              matchId,
              opponentUsername: loserMeta.username,
              opponentElo: loserMeta.elo,
              opponentSub: loserMeta.sub,
              playerElo: winnerMeta.elo,
              playerClass: winnerMeta.classId,
              opponentClass: loserMeta.classId,
              result: 'win',
              eloChange: winnerChange,
              duration,
              mode: '1v1',
            }),
            db.recordMatch(loserMeta.sub, {
              matchId,
              opponentUsername: winnerMeta.username,
              opponentElo: winnerMeta.elo,
              opponentSub: winnerMeta.sub,
              playerElo: loserMeta.elo,
              playerClass: loserMeta.classId,
              opponentClass: winnerMeta.classId,
              result: 'loss',
              eloChange: loserChange,
              duration,
              mode: '1v1',
            }),
          ]);
          console.log(`[Room ${this.code}] Ranked ELO: ${winnerMeta.username} +${winnerChange}, ${loserMeta.username} ${loserChange}`);

          // Update balance aggregate (fire-and-forget)
          db.updateBalanceAggregate(
            winnerMeta.classId, loserMeta.classId,
            winnerMeta.elo, loserMeta.elo,
            duration
          ).catch(err => console.error(`[Room ${this.code}] Balance aggregate update failed:`, err.message));
        } catch (err) {
          console.error(`[Room ${this.code}] Failed to update ELO:`, err);
        }

        // Per-class champion check
        let championUpdates = [];
        try {
          const classesToCheck = [...new Set([winnerMeta.classId, loserMeta.classId])];
          const [winnerProfile, loserProfile] = await Promise.all([
            db.getProfile(winnerMeta.sub),
            db.getProfile(loserMeta.sub),
          ]);

          for (const classId of classesToCheck) {
            const currentChamp = await db.getClassChampion(classId);
            let newChampProfile = null;

            for (const profile of [winnerProfile, loserProfile]) {
              if (!profile) continue;
              const cs = profile.classStats?.[classId];
              if (!cs || cs.gamesPlayed < 10) continue;

              if (!currentChamp || cs.wins > currentChamp.wins) {
                if (!newChampProfile || cs.wins > (newChampProfile.classStats?.[classId]?.wins || 0)) {
                  newChampProfile = profile;
                }
              }
            }

            if (newChampProfile) {
              const cs = newChampProfile.classStats[classId];
              const winRate = Math.round((cs.wins / cs.gamesPlayed) * 100);
              const sub = newChampProfile.PK.replace('PLAYER#', '');
              await db.setClassChampion(classId, sub, newChampProfile.username, cs.wins, winRate);
              championUpdates.push({ classId, username: newChampProfile.username, wins: cs.wins, winRate });
              console.log(`[Champion] ${newChampProfile.username} is now ${classId} champion (${cs.wins}W)`);
            }
          }
        } catch (err) {
          console.error(`[Room ${this.code}] Champion check failed:`, err.message);
        }

        // Bet resolution (fire-and-forget)
        try {
          const classesInMatch = [...new Set([winnerMeta.classId, loserMeta.classId])];
          for (const classId of classesInMatch) {
            const champChanged = championUpdates.some(u => u.classId === classId);
            if (champChanged) {
              // Champion dethroned — "falls" bets win, "holds" bets lose
              db.resolveChampionFall(classId)
                .then(r => { if (r.resolved.length) console.log(`[Bets] ${classId} champion fell — ${r.resolved.length} bets resolved, ${r.jackpotContribution} to jackpot`); })
                .catch(err => console.error(`[Bets] resolveChampionFall error:`, err.message));
            } else {
              // Champion held — tick bets (decrement matchesRemaining, resolve expired)
              const currentChamp = await db.getClassChampion(classId);
              if (currentChamp?.playerSub) {
                db.tickClassBets(classId, currentChamp.playerSub)
                  .then(r => {
                    if (r.resolved.length) console.log(`[Bets] ${classId} champion held — ${r.resolved.length} bets resolved, champion earned ${r.championCut} coins, ${r.jackpotContribution} to jackpot`);
                  })
                  .catch(err => console.error(`[Bets] tickClassBets error:`, err.message));
              }
            }
          }
        } catch (err) {
          console.error(`[Room ${this.code}] Bet resolution failed:`, err.message);
        }

        // Challenge progress (fire-and-forget)
        updateChallengeProgress(winnerMeta.sub, winnerMeta.classId, true, winnerResult?.newElo || winnerMeta.elo, loserResult?.newElo || loserMeta.elo)
          .catch(err => console.error('[Challenges] progress error:', err.message));
        updateChallengeProgress(loserMeta.sub, loserMeta.classId, false, loserResult?.newElo || loserMeta.elo, winnerResult?.newElo || winnerMeta.elo)
          .catch(err => console.error('[Challenges] progress error:', err.message));

        // Auto-set avatar to class played if not set
        for (const p of this.players) {
          const meta = this.playerMeta[p?.slot];
          if (p?.ws?.readyState === WS_OPEN && meta && !meta.avatarClass) {
            db.setAvatarClass(meta.sub, meta.classId).then(() => {
              p.ws.send(JSON.stringify({ type: 'avatar_class_set', classId: meta.classId }));
            }).catch(() => {});
          }
        }

        // Send personalized match_end to each player with their ELO change
        for (const p of this.players) {
          if (p?.ws?.readyState === WS_OPEN) {
            const isWinner = p.slot === winnerId;
            const meta = this.playerMeta[p.slot];
            const coinResult = isWinner ? winnerResult : loserResult;
            const payload = {
              type: 'match_end',
              winner: winnerId,
              loser: loserId,
              duration,
              ranked: true,
              eloChange: isWinner ? winnerChange : loserChange,
              newElo: coinResult?.newElo ?? (meta ? meta.elo + (isWinner ? winnerChange : loserChange) : null),
              ratingChange: coinResult?.ratingChange ?? 0,
              newRating: coinResult?.rating ?? 0,
              classElo: coinResult?.classElo ?? null,
              oldClassElo: coinResult?.oldClassElo ?? meta?.elo ?? null,
              classElos: coinResult?.classElos ?? null,
              coinsEarned: coinResult?.coinsEarned || 0,
              newCoins: coinResult?.newCoins || 0,
              xpEarned: coinResult?.xpEarned || 0,
              classMastery: coinResult?.classMastery || null,
              levelUps: coinResult?.levelUps || 0,
              masteryCoinsEarned: coinResult?.masteryCoinsEarned || 0,
              accountXp: coinResult?.accountXp || 0,
              accountLevel: coinResult?.accountLevel || 0,
              accountLevelUps: coinResult?.accountLevelUps || 0,
              accountMilestoneCoins: coinResult?.accountMilestoneCoins || 0,
              seasonXp: coinResult?.seasonXp || 0,
              seasonTier: coinResult?.seasonTier || 0,
              bpTiersGained: coinResult?.bpTiersGained || 0,
              bpCoinsEarned: coinResult?.bpCoinsEarned || 0,
              bpNewRewards: coinResult?.bpNewRewards || [],
              playerMeta: {
                [winnerId]: { username: winnerMeta.username, classId: winnerMeta.classId },
                [loserId]: { username: loserMeta.username, classId: loserMeta.classId },
              },
            };
            if (championUpdates.length > 0) payload.championUpdates = championUpdates;
            p.ws.send(JSON.stringify(payload));
          }
        }

        // Broadcast champion updates to all connected clients
        if (championUpdates.length > 0 && this.onChampionUpdate) {
          this.onChampionUpdate(championUpdates);
        }

        // Notify spectators of match result
        if (this.spectators.length > 0) {
          this._sendToSpectators({
            type: 'spectator_match_end',
            roomCode: this.code,
            result: 'finished',
            winner: winnerId,
            loser: loserId,
            duration,
            playerMeta: {
              [winnerId]: { username: winnerMeta.username, classId: winnerMeta.classId },
              [loserId]: { username: loserMeta.username, classId: loserMeta.classId },
            },
            championUpdates,
          });
          this.spectators = [];
        }
        return;
      }
    }

    // ── Wager Duel Match ──
    if (this.challenge && this.challengeData && winnerId !== null && loserId !== null) {
      const winnerMeta = this.playerMeta[winnerId];
      const loserMeta = this.playerMeta[loserId];
      const { duelId, wager, amplifier, challengerSlot } = this.challengeData;

      if (winnerMeta && loserMeta) {
        try {
          const winnerChange = calculateChallengeEloChange(winnerMeta.elo, loserMeta.elo, true, amplifier);
          const loserStreak = loserMeta.currentStreak || 0;
          const loserChange = calculateChallengeEloChange(loserMeta.elo, winnerMeta.elo, false, amplifier, { streak: loserStreak });
          const matchId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

          const duelLoserPerf = this._calcPerfScore(this.match.units[loserId], this.match.units[winnerId]);
          const [winnerResult, loserResult] = await Promise.all([
            db.updateEloAndStats(winnerMeta.sub, winnerChange, winnerMeta.classId, true, duration, 100),
            db.updateEloAndStats(loserMeta.sub, loserChange, loserMeta.classId, false, duration, duelLoserPerf),
          ]);

          // Record match
          await Promise.all([
            db.recordMatch(winnerMeta.sub, {
              matchId, opponentUsername: loserMeta.username, opponentElo: loserMeta.elo,
              opponentSub: loserMeta.sub, playerElo: winnerMeta.elo,
              playerClass: winnerMeta.classId, opponentClass: loserMeta.classId,
              result: 'win', eloChange: winnerChange, duration, mode: 'duel',
            }),
            db.recordMatch(loserMeta.sub, {
              matchId, opponentUsername: winnerMeta.username, opponentElo: winnerMeta.elo,
              opponentSub: winnerMeta.sub, playerElo: loserMeta.elo,
              playerClass: loserMeta.classId, opponentClass: winnerMeta.classId,
              result: 'loss', eloChange: loserChange, duration, mode: 'duel',
            }),
          ]);

          // Release escrow to the winner
          const coinRecipient = winnerMeta.sub;
          await db.releaseEscrow(duelId, coinRecipient);

          // Resolve the duel record + clear active duel locks
          await Promise.all([
            db.resolveDuel(duelId, winnerMeta.sub),
            db.clearActiveDuelLock(winnerMeta.sub),
            db.clearActiveDuelLock(loserMeta.sub),
          ]);

          // Record duel metric
          db.recordDuelMetric('duel_completed', {
            duelId, wager, amplifier,
            winnerSub: winnerMeta.sub, loserSub: loserMeta.sub,
            duration, eloSwing: winnerChange,
          }).catch(err => console.error(`[Duel Metric] error:`, err.message));

          console.log(`[Room ${this.code}] Duel: ${winnerMeta.username} +${winnerChange}, ${loserMeta.username} ${loserChange} (${wager} coins, ${amplifier}x)`);

          // Send personalized match_end
          const challengerIsWinner = winnerId === challengerSlot;
          for (const p of this.players) {
            if (p?.ws?.readyState === WS_OPEN) {
              const isWinner = p.slot === winnerId;
              const coinResult = isWinner ? winnerResult : loserResult;
              const meta = this.playerMeta[p.slot];
              p.ws.send(JSON.stringify({
                type: 'match_end',
                winner: winnerId,
                loser: loserId,
                duration,
                ranked: true,
                duel: true,
                wager,
                amplifier,
                challengerWon: challengerIsWinner,
                eloChange: isWinner ? winnerChange : loserChange,
                newElo: coinResult?.newElo ?? (meta ? meta.elo + (isWinner ? winnerChange : loserChange) : null),
                ratingChange: coinResult?.ratingChange ?? 0,
                newRating: coinResult?.rating ?? 0,
                classElo: coinResult?.classElo ?? null,
                oldClassElo: coinResult?.oldClassElo ?? null,
                classElos: coinResult?.classElos ?? null,
                coinsEarned: coinResult?.coinsEarned || 0,
                newCoins: coinResult?.newCoins || 0,
                xpEarned: coinResult?.xpEarned || 0,
                classMastery: coinResult?.classMastery || null,
                levelUps: coinResult?.levelUps || 0,
                masteryCoinsEarned: coinResult?.masteryCoinsEarned || 0,
                accountXp: coinResult?.accountXp || 0,
                accountLevel: coinResult?.accountLevel || 0,
                accountLevelUps: coinResult?.accountLevelUps || 0,
                accountMilestoneCoins: coinResult?.accountMilestoneCoins || 0,
                seasonXp: coinResult?.seasonXp || 0,
                seasonTier: coinResult?.seasonTier || 0,
                bpTiersGained: coinResult?.bpTiersGained || 0,
                bpCoinsEarned: coinResult?.bpCoinsEarned || 0,
                bpNewRewards: coinResult?.bpNewRewards || [],
                playerMeta: {
                  [winnerId]: { username: winnerMeta.username, classId: winnerMeta.classId },
                  [loserId]: { username: loserMeta.username, classId: loserMeta.classId },
                },
              }));
            }
          }

          if (this.onChallengeEnd) {
            this.onChallengeEnd(duelId, winnerMeta.sub, loserMeta.sub);
          }

          // Notify spectators
          if (this.spectators.length > 0) {
            this._sendToSpectators({
              type: 'spectator_match_end',
              roomCode: this.code,
              result: 'finished',
              winner: winnerId,
              loser: loserId,
              duration,
              duel: true,
              playerMeta: {
                [winnerId]: { username: winnerMeta.username, classId: winnerMeta.classId },
                [loserId]: { username: loserMeta.username, classId: loserMeta.classId },
              },
            });
            this.spectators = [];
          }
        } catch (err) {
          console.error(`[Room ${this.code}] Duel match error:`, err);
          // Attempt to refund on error and clear locks
          try {
            await db.refundEscrow(duelId);
            await db.resolveDuel(duelId, null, 'error');
            await Promise.all([
              db.clearActiveDuelLock(this.playerMeta[winnerId]?.sub),
              db.clearActiveDuelLock(this.playerMeta[loserId]?.sub),
            ].filter(Boolean));
          } catch (_) {}
        }
        return;
      }
    }

    // Non-ranked or missing metadata — send basic match_end
    this.broadcast({
      type: 'match_end',
      winner: winnerId,
      loser: loserId,
      duration,
    });

    // Notify spectators
    if (this.spectators.length > 0) {
      this._sendToSpectators({
        type: 'spectator_match_end',
        roomCode: this.code,
        result: 'finished',
        winner: winnerId,
        loser: loserId,
        duration,
      });
      this.spectators = [];
    }
    console.log(`[Room ${this.code}] Match ended — winner: player ${winnerId}`);
  }

  async _endMatch2v2() {
    const winTeam = this.match.winner?.team;
    const loseTeam = this.match.loser?.team;
    const duration = this.match.getMatchDuration();

    // Build playerMeta for all slots
    const allMeta = {};
    for (let i = 0; i < this.players.length; i++) {
      const m = this.playerMeta[i];
      if (m) allMeta[i] = { username: m.username, classId: m.classId, team: Math.floor(i / 2) };
    }

    if (!this.ranked || winTeam == null || loseTeam == null) {
      // Non-ranked 2v2 — basic match_end
      this.broadcast({ type: 'match_end', winner: { team: winTeam }, loser: { team: loseTeam }, duration, mode: '2v2', playerMeta: allMeta });
      if (this.spectators.length > 0) {
        this._sendToSpectators({ type: 'spectator_match_end', roomCode: this.code, result: 'finished', winner: { team: winTeam }, loser: { team: loseTeam }, duration, playerMeta: allMeta });
        this.spectators = [];
      }
      // Award practice rewards to human players in co-op practice
      if (this.isPractice) {
        for (let i = 0; i < this.players.length; i++) {
          const p = this.players[i];
          const meta = this.playerMeta[i];
          if (!p || p.isAI || !meta?.sub) continue;
          const won = winTeam != null && Math.floor(i / 2) === winTeam;
          const unit = this.match.units[i];
          const enemyTeam = Math.floor(i / 2) === 0 ? 1 : 0;
          const enemyHp = this.match.units.filter(u => u.team === enemyTeam).reduce((s, u) => s + (u.maxHp || 0), 0) || 1;
          const pracPerf = won ? 100 : this._calcPerfScore(unit, { maxHp: enemyHp });
          try {
            const result = await db.awardPracticeReward(meta.sub, meta.classId, won, 'hard', pracPerf);
            // Track 2v2 practice / 1v1 server-AI matches for admin analytics
            const enemyClasses = this.match.units.filter(u => u.team !== unit.team).map(u => u.classId).filter(Boolean);
            db.recordAIMatch({
              sub: meta.sub, classId: meta.classId,
              opponentClass: enemyClasses[0] || null,
              won, difficulty: 'hard',
              durationSec: this.match.tick / 10,
            }).catch(err => console.warn('[AI Match] record failed:', err.message));
            if (result && p.ws?.readyState === WS_OPEN) {
              p.ws.send(JSON.stringify({
                type: 'practice_reward',
                coins: result.gated ? 0 : result.coinsEarned,
                newCoins: result.gated ? 0 : result.newCoins,
                xpEarned: result.xpEarned,
                classMastery: result.classMastery,
                levelUps: result.levelUps,
                masteryCoinsEarned: result.masteryCoinsEarned,
                gated: result.gated || false,
                accountXp: result.accountXp,
                accountLevel: result.accountLevel,
                accountLevelUps: result.accountLevelUps,
                accountMilestoneCoins: result.accountMilestoneCoins,
                seasonXp: result.seasonXp,
                seasonTier: result.seasonTier,
                bpTiersGained: result.bpTiersGained || 0,
                bpCoinsEarned: result.bpCoinsEarned || 0,
                bpNewRewards: result.bpNewRewards || [],
              }));
            }
          } catch (err) {
            console.error(`[Room ${this.code}] Practice reward error for slot ${i}:`, err.message);
          }
        }
      }
      console.log(`[Room ${this.code}] 2v2 match ended — team ${winTeam} wins${this.isPractice ? ' (co-op practice)' : ''}`);
      return;
    }

    // Ranked 2v2 — performance-based ELO
    const teamStats = {};
    for (let t = 0; t <= 1; t++) {
      const members = this.match.units.filter(u => u.team === t);
      teamStats[t] = {
        totalDamage: members.reduce((s, u) => s + (u.totalDamageDealt || 0), 0),
        totalCCTime: members.reduce((s, u) => s + (u.totalCCApplied || 0), 0),
        totalKills: members.reduce((s, u) => s + (u.killParticipation || 0), 0),
      };
    }

    const teamElos = {};
    for (let t = 0; t <= 1; t++) {
      const metas = this.match.units.filter(u => u.team === t).map(u => this.playerMeta[u.id]).filter(Boolean);
      teamElos[t] = metas.length > 0 ? metas.reduce((s, m) => s + m.elo, 0) / metas.length : 1500;
    }

    const matchId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const playerResults = [];
    for (const unit of this.match.units) {
      const meta = this.playerMeta[unit.id];
      if (!meta?.sub) continue;
      const won = unit.team === winTeam;
      const myTeamStats = teamStats[unit.team];
      const playerStats = {
        damage: unit.totalDamageDealt || 0,
        ccTime: unit.totalCCApplied || 0,
        timeAlive: unit.timeAlive || 0,
        killParticipation: unit.killParticipation || 0,
      };
      const contribution = calculateContributionScore(playerStats, myTeamStats, this.match.tick);
      const myTeamAvg = teamElos[unit.team];
      const enemyTeamAvg = teamElos[unit.team === 0 ? 1 : 0];
      const eloChange = calculateTeamEloChange(meta.elo, myTeamAvg, enemyTeamAvg, won, contribution, { streak: meta.currentStreak || 0 });
      playerResults.push({ slot: unit.id, meta, won, eloChange, contribution });
    }

    // Compute per-player performance scores (damage + healing vs enemy team HP)
    for (const r of playerResults) {
      const unit = this.match.units[r.slot];
      const enemyTeam = unit.team === 0 ? 1 : 0;
      const enemyTotalHp = this.match.units.filter(u => u.team === enemyTeam).reduce((s, u) => s + (u.maxHp || 0), 0) || 1;
      r.perfScore = r.won ? 100 : Math.min(100, Math.round(((unit.totalDamageDealt || 0) + (unit.totalHealingDone || 0)) / enemyTotalHp * 100));
    }

    try {
      const dbResults = await Promise.all(
        playerResults.map(r => db.updateEloAndStats(r.meta.sub, r.eloChange, r.meta.classId, r.won, duration, r.perfScore))
      );

      await Promise.all(
        playerResults.map(r => {
          const enemies = playerResults.filter(pr => this.match.units[pr.slot].team !== this.match.units[r.slot].team);
          return db.recordMatch(r.meta.sub, {
            matchId,
            opponentUsername: enemies.map(e => e.meta.username).join(' & '),
            opponentElo: Math.round(enemies.reduce((s, e) => s + e.meta.elo, 0) / Math.max(enemies.length, 1)),
            opponentSub: enemies[0]?.meta.sub || null,
            playerElo: r.meta.elo,
            playerClass: r.meta.classId,
            opponentClass: enemies.map(e => e.meta.classId).join(','),
            result: r.won ? 'win' : 'loss',
            eloChange: r.eloChange,
            duration,
            mode: '2v2',
          });
        })
      );

      console.log(`[Room ${this.code}] 2v2 Ranked ELO:`, playerResults.map(r => `${r.meta.username} ${r.eloChange > 0 ? '+' : ''}${r.eloChange}`).join(', '));

      for (let i = 0; i < playerResults.length; i++) {
        const r = playerResults[i];
        const p = this.players[r.slot];
        if (!p?.ws || p.ws.readyState !== WS_OPEN) continue;
        const dbResult = dbResults[i];
        p.ws.send(JSON.stringify({
          type: 'match_end',
          winner: { team: winTeam },
          loser: { team: loseTeam },
          duration,
          mode: '2v2',
          ranked: true,
          eloChange: r.eloChange,
          ratingChange: dbResult?.ratingChange ?? 0,
          newRating: dbResult?.rating ?? 0,
          contributionScore: Math.round(r.contribution * 100),
          newElo: dbResult?.newElo ?? (r.meta.elo + r.eloChange),
          classElo: dbResult?.classElo ?? null,
          oldClassElo: dbResult?.oldClassElo ?? r.meta.elo,
          classElos: dbResult?.classElos ?? null,
          coinsEarned: dbResult?.coinsEarned || 0,
          newCoins: dbResult?.newCoins || 0,
          xpEarned: dbResult?.xpEarned || 0,
          classMastery: dbResult?.classMastery || null,
          levelUps: dbResult?.levelUps || 0,
          masteryCoinsEarned: dbResult?.masteryCoinsEarned || 0,
          accountXp: dbResult?.accountXp || 0,
          accountLevel: dbResult?.accountLevel || 0,
          accountLevelUps: dbResult?.accountLevelUps || 0,
          accountMilestoneCoins: dbResult?.accountMilestoneCoins || 0,
          seasonXp: dbResult?.seasonXp || 0,
          seasonTier: dbResult?.seasonTier || 0,
          bpTiersGained: dbResult?.bpTiersGained || 0,
          bpCoinsEarned: dbResult?.bpCoinsEarned || 0,
          bpNewRewards: dbResult?.bpNewRewards || [],
          playerMeta: allMeta,
        }));
      }
    } catch (err) {
      console.error(`[Room ${this.code}] 2v2 ranked ELO update failed:`, err);
      this.broadcast({ type: 'match_end', winner: { team: winTeam }, loser: { team: loseTeam }, duration, mode: '2v2', playerMeta: allMeta });
    }

    if (this.spectators.length > 0) {
      this._sendToSpectators({ type: 'spectator_match_end', roomCode: this.code, result: 'finished', winner: { team: winTeam }, loser: { team: loseTeam }, duration, playerMeta: allMeta });
      this.spectators = [];
    }
    console.log(`[Room ${this.code}] 2v2 match ended — team ${winTeam} wins`);
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const player of this.players) {
      if (player?.ws?.readyState === WS_OPEN) {
        player.ws.send(data);
      }
    }
  }

  cleanup() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.aiControllers = {};
    // Notify spectators that match is over
    if (this.spectators.length > 0) {
      this._sendToSpectators({ type: 'spectator_match_end', result: 'cancelled', roomCode: this.code });
      this.spectators = [];
    }
  }
}
