// DungeonRoom — solo PvE roguelike-style room.
//
// Reuses MatchState + CombatEngine + AIController from PvP. The differences:
//   - Single human player (slot 0) vs AI monsters (slots 1+).
//   - Multiple sequential encounters within one session ("rooms").
//   - Between rooms: pause engine, send upgrade picks, resume on player choice.
//   - Match ends on player death (defeat) or last room cleared (victory).
//   - No ELO, no spectators, no 2v2.
//
// We deliberately do NOT extend GameRoom — that class is heavy with PvP/ELO/
// 2v2/spectator logic that adds risk if subclassed. Cleaner to share only
// the engine layer (MatchState/CombatEngine) and write the room loop fresh.

import { MatchState } from '../../src/engine/MatchState.js';
import { CombatEngine } from '../../src/engine/CombatEngine.js';
import { Unit } from '../../src/engine/Unit.js';
import { CLASS_REGISTRY } from '../../src/classes/ClassRegistry.js';
import { EventBus, EVENTS } from '../../src/utils/EventBus.js';
import { SeededRandom } from '../../src/utils/Random.js';
import { Vec3 } from '../../src/utils/Vec3.js';
import { TICK_RATE, BASE_MOVE_SPEED, TICKS_PER_SECOND } from '../../src/constants.js';
import * as db from '../db.js';

import { getMonsterConfig } from './monsters.js';
import { rollUpgradeChoices, applyUpgrade, UPGRADES } from './upgrades.js';
import { ROOM_COIN_REWARD } from './encounters.js';
import { getTheme } from './themes.js';
import { generateFloor, ROOM_TYPES } from './DungeonGenerator.js';
import { DungeonAI } from './DungeonAI.js';
import { buildWing } from './WingLayout.js';
import { tickHazards, hazardStates } from './hazards.js';
import {
  getTierConfig, rollGear, rollGem,
  loadEquippedGearAndSockets, addGearAndGems, recordLadderEntry, SETS,
  GEAR_SLOTS,
} from './competition.js';

const WS_OPEN = 1;

/** Seeded RNG (mulberry32) — used so server + client can agree on a puzzle's
 *  randomized layout (glyph order, plate sequence, etc.) without sending
 *  the answer over the wire. Server seeds the puzzle; client + server both
 *  derive the same sequence locally. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle that consumes a deterministic, fixed sequence of
 *  rng() calls so client and server compute identical orderings from the
 *  same seed. Previously used `arr.sort(() => rng() - 0.5)` which is
 *  implementation-defined (V8's sort algorithm changes comparator call
 *  order based on array size), causing the puzzle answer the client
 *  displayed to NOT match the server's expected answer. */
function shuffleDeterministic(arr, rng) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
  }
  return out;
}

export class DungeonRoom {
  constructor(code, opts = {}) {
    this.code = code;
    this.player = null;          // { ws, classId, slot: 0, sub, username }
    this.match = null;
    this.engine = null;
    this.aiControllers = {};     // monsterSlot -> DungeonAI instance
    this.tickInterval = null;
    this._tickTimer = null;
    this.eventBuffer = [];
    this.pendingInputs = [];

    // Theme + procedural floor generation
    this.themeId = opts.themeId || 'crucible_below';
    this.theme = getTheme(this.themeId);
    this.tier = Math.max(1, Math.min(10, opts.tier || 1));
    this.tierCfg = getTierConfig(this.tier);
    this._lootDropped = []; // gear/gem rolls for this run, awarded on victory
    this.floor = null;           // [room, room, ...] populated in startMatch

    // Dungeon run state
    this.roomIndex = 0;          // 0-based: which encounter we're on
    this.upgradesPicked = [];    // [{ id, name } ...]
    this.coinsEarned = 0;        // display counter for this run (pickups, gross)
    this.coinsUnbanked = 0;      // coins not yet banked to DB; banked on wing-clear
    this.walletCoins = 0;        // player's Crucible Coin wallet — loaded from DB
                                  // at run start. Used for purchases at both
                                  // starter and boss vendors. Updated live as
                                  // coins bank and as vendor purchases deduct.
    this.roomState = 'idle';     // 'idle' | 'awaiting_ready' | 'fighting' | 'between_rooms' | 'finished'
    this._pendingUpgradeChoices = null;
    // Vendor purchase tracking. Per-item counts so we can cap stackable
    // permanent buffs (rites) and refuse no-op purchases (heal at full HP,
    // shield while one is already active).
    this._vendorPurchases = {};

    this.playerMeta = opts.playerMeta || {};
  }

  addPlayer(ws, classId, sub, username) {
    this.player = { ws, classId, slot: 0, sub, username };
    ws.playerSlot = 0;
  }

  isEmpty() {
    return !this.player || !this.player.ws || this.player.ws.readyState !== WS_OPEN;
  }

  // ── Match lifecycle ────────────────────────────────────────────────

  startMatch() {
    if (!this.player) return;

    const seed = Date.now();
    const rng = new SeededRandom(seed);
    const eventBus = new EventBus();

    this.match = new MatchState({ eventBus, rng, seed, mode: 'dungeon' });
    this.match.start();
    // Wing-based dungeon: bounds are computed per-wing in _spawnEncounter,
    // so we initialize with a generous default that the wing layout will
    // overwrite on the first encounter. Pillars are always empty in dungeon
    // mode (chamber templates manage their own visual columns).
    if (this.match.los) {
      this.match.los.dungeonBounds = { halfX: 60, halfZ: 40 };
      this.match.los.pillars = [];
    }
    this.engine = new CombatEngine(this.match);
    this.eventBus = eventBus;
    this._wireEvents();

    // Player unit (slot 0)
    const classDef = CLASS_REGISTRY[this.player.classId];
    if (!classDef) {
      this._sendToPlayer({ type: 'error', message: `Unknown class: ${this.player.classId}` });
      return;
    }
    const playerUnit = new Unit(0, this.player.classId, classDef.name);
    classDef.applyToUnit(playerUnit);
    playerUnit.team = 0;
    playerUnit.position = new Vec3(-40, 0, 0);
    playerUnit.facing = Math.PI / 2;
    this.match.addUnit(playerUnit);

    // Equipped gear + socketed gems — applied to the player unit at run
    // start so their stats are baked in before combat. Async fetch; we kick
    // it off but don't block startMatch (gear is small bonuses, late apply
    // by 200ms is fine).
    this._applyEquippedGearAndGems(playerUnit).catch(err =>
      console.warn(`[Dungeon ${this.code}] gear apply failed:`, err.message)
    );

    // Track run start for ladder timing
    this._runStartMs = Date.now();

    // Load the player's persisted Crucible Coin wallet so they can spend it
    // at the starter vendor (extraction help) without waiting for victory.
    // Fire-and-forget; the starter vendor pulls a fresh balance on open.
    if (this.player.sub) {
      db.getProfile(this.player.sub).then(p => {
        this.walletCoins = p?.coins || 0;
        this._sendToPlayer({ type: 'dungeon_wallet_update', walletCoins: this.walletCoins });
      }).catch(err => console.warn(`[Dungeon ${this.code}] wallet load failed:`, err.message));
    }

    // Generate the procedural floor for this run from the theme.
    // Same theme, different room sequence each session — never the same run twice.
    if (!this.theme) {
      console.warn(`[Dungeon ${this.code}] unknown theme ${this.themeId}, falling back to crucible_below`);
      this.theme = getTheme('crucible_below');
    }
    this.floor = generateFloor(this.theme);
    console.log(`[Dungeon ${this.code}] generated floor: ${this.floor.length} rooms (${this.floor.map(r => r.type).join(', ')})`);

    // Spawn first encounter
    this._spawnEncounter(0);

    // Send dungeon_start with full state — include the wing layout so the
    // client can render the multi-chamber geometry, and the floor plan for
    // the minimap / path preview.
    this._sendToPlayer({
      type: 'dungeon_start',
      seed,
      roomIndex: 0,
      totalRooms: this.floor.length,
      yourSlot: 0,
      units: this.match.units.map(u => this._serializeUnitFull(u)),
      currentRoom: this._getCurrentRoomInfo(),
      wing: this._serializeWing(),
      theme: {
        id: this.theme.id,
        name: this.theme.name,
        atmosphere: this.theme.atmosphere,
        // NEW framework fields — client renderer uses these to drive the
        // floor heightmap, vegetation, weather, walls, light cones, etc.
        lighting: this.theme.lighting,
        weather: this.theme.weather,
        vegetation: this.theme.vegetation,
        floor: this.theme.floor,
        wall: this.theme.wall,
        outerEnvironment: this.theme.outerEnvironment,
        lightCone: this.theme.lightCone,
      },
      floorPlan: this.floor.map(r => ({ roomNumber: r.roomNumber, type: r.type, label: r.label, isBoss: !!r.isBoss })),
    });

    // Wait for client to finish loadout select + asset load before ticking.
    // Engine tick loop is gated by `roomState !== 'fighting'` — that's enough
    // to prevent monsters from acting. We do NOT close the LOS gates because
    // that triggers the staging-cell clamp, which confines the player to a
    // tiny 13x10 box near the arena edge. Dungeons have no staging gates.
    this.roomState = 'awaiting_ready';
    if (this.match.los) this.match.los.gatesOpen = true;

    console.log(`[Dungeon ${this.code}] started — ${this.player.username} (${this.player.classId})`);
  }

  /** Client signals it has finished loading and is ready to play. */
  playerReady() {
    if (this.roomState !== 'awaiting_ready') return;
    this.roomState = 'fighting';
    this._startTickLoop();
    console.log(`[Dungeon ${this.code}] ready — tick loop started`);
  }

  /** Compat alias — PvP `player_loaded` message handler in server/index.js
   *  calls room.playerLoaded(slot). For dungeon we want the same effect
   *  (start ticking) so accept either signal. */
  playerLoaded(_slot) {
    this.playerReady();
  }

  /**
   * Spawn the monsters for encounter at roomIndex. Adds Unit objects + AI
   * controllers, sets initial positions and target. Also generates the wing
   * layout (multi-chamber room with optional treasure / hidden reliquary)
   * and stores it on `this.currentWing` for the client to render.
   */
  _spawnEncounter(roomIndex) {
    const encounter = this.floor?.[roomIndex];
    if (!encounter) return;

    // Wipe previous monsters: they should already be dead, but clear them
    // from the units list so unit ids stay tidy.
    this.match.units = this.match.units.filter(u => u.id === 0);
    this.aiControllers = {};

    // Build a wing layout for this room — picks chamber template, optional
    // treasure alcove, optional hidden reliquary with lever-gated wall.
    const wing = buildWing({
      themeId: this.themeId,
      roomType: encounter.type,
      rng: () => this.match.rng?.next?.() ?? Math.random(),
      isFirstWing: roomIndex === 0,
      roomIndex,
    });
    this.currentWing = wing;
    const featureCounts = {};
    for (const f of wing.features) featureCounts[f.kind] = (featureCounts[f.kind] || 0) + 1;
    console.log(`[Dungeon ${this.code}] Wing built room=${roomIndex} type=${encounter.type} firstWing=${roomIndex === 0} features=${wing.features.length} ${JSON.stringify(featureCounts)}`);
    this._roomCleared = false;

    // Update bounds + reset hidden chamber gate state. Bounds initially
    // exclude the hidden chamber so the player can't walk into it before
    // pulling the lever — _expandBoundsForHidden() includes it after.
    if (this.match.los) {
      this.match.los.dungeonBounds = this._computeBoundsExcludingHidden(wing);
      // Polygon containment — exclude hidden chambers so player can't walk
      // into them through their connector before pulling the lever.
      this.match.los.dungeonTiles = this._collectTiles(wing, false);
    }

    // Place the player at the wing's entry hall
    const player = this.match.units[0];
    if (player) {
      player.position = new Vec3(wing.playerSpawn.x, 0, wing.playerSpawn.z);
      player.facing = Math.PI / 2;
    }

    // Non-combat rooms (treasure / shrine / hidden floor types) get no mobs
    if (!encounter.monsters || encounter.monsters.length === 0) {
      return;
    }

    // Spawn each monster as a Unit driven by the equivalent class AI.
    let nextSlot = 1;
    for (let i = 0; i < encounter.monsters.length; i++) {
      const monsterRef = encounter.monsters[i];
      const monsterCfg = getMonsterConfig(monsterRef.id);
      if (!monsterCfg) {
        console.warn(`[Dungeon ${this.code}] unknown monster id: ${monsterRef.id}`);
        continue;
      }
      const classDef = CLASS_REGISTRY[monsterCfg.baseClassId];
      if (!classDef) continue;

      const slot = nextSlot++;
      const unit = new Unit(slot, monsterCfg.baseClassId, monsterCfg.name);
      classDef.applyToUnit(unit);
      unit.team = 1;
      unit.isMonster = true;
      unit.monsterId = monsterCfg.id;
      unit.modelScale = monsterCfg.modelScale || 1;

      // Strip the inherited class kit — monsters only get auto-attack +
      // whatever abilities the archetype explicitly whitelists. Otherwise
      // the AI uses the full PvP toolkit (charge, ground slam, the lot)
      // and one-shots the player from across the arena.
      unit.abilities.clear();
      const whitelist = monsterCfg.abilities || [];
      for (const abilityId of whitelist) {
        const ability = classDef.abilities.find(a => a.id === abilityId);
        if (ability) unit.abilities.set(ability.id, ability);
      }
      unit.activeLoadout = whitelist;

      // Apply stat overrides
      const ov = monsterCfg.statOverrides || {};
      if (ov.hpMultiplier) {
        unit.maxHp = Math.round(unit.maxHp * ov.hpMultiplier);
        unit.hp = unit.maxHp;
      }
      if (ov.autoAttackDamage !== undefined) unit.autoAttackDamage = ov.autoAttackDamage;
      if (ov.swingTimer) unit.swingTimer = ov.swingTimer;
      // Mobs default to 0.75x player speed so the player can actually kite.
      // Without this, mobs use full base-class speed (often equal to player)
      // and ranged classes have no escape — every fight becomes a melee
      // standoff. Monster config can override via `statOverrides.moveSpeedMultiplier`.
      // (Previously set `dungeonMoveSpeedMultiplier` which nothing read.)
      const monsterSpeedMult = ov.moveSpeedMultiplier ?? 0.75;
      unit.stats.moveSpeedMultiplier = (unit.stats.moveSpeedMultiplier || 1) * monsterSpeedMult;

      // Per-room scaling × dungeon-tier scaling. Per-room steps reduced from
      // 0.18/0.10 to 0.10/0.06 because multi-chamber wings now have 3x the
      // mob count per room — keeps total room-clear time reasonable instead
      // of the room 4 ramp feeling brutal.
      const roomTier = roomIndex;
      const roomHpScale  = 1 + roomTier * 0.10 + (encounter.isBoss ? 1.0 : 0);
      const roomDmgScale = 1 + roomTier * 0.06 + (encounter.isBoss ? 0.5 : 0);
      const hpScale  = roomHpScale  * (this.tierCfg.hpScale  || 1);
      const dmgScale = roomDmgScale * (this.tierCfg.dmgScale || 1);
      unit.maxHp = Math.round(unit.maxHp * hpScale);
      unit.hp = unit.maxHp;
      unit.autoAttackDamage = Math.round((unit.autoAttackDamage || 0) * dmgScale);
      unit.stats.damageDealtMod = (unit.stats.damageDealtMod || 1) * dmgScale;

      // Position from wing layout (spread across chambers) instead of the
      // legacy single-encounter spawnPositions list.
      const wingSpawn = wing.spawns[i] || { x: 0, z: 0 };
      unit.position = new Vec3(wingSpawn.x, 0, wingSpawn.z);
      unit.facing = -Math.PI / 2;
      // Tag the unit with its pack id so we can detect "pack cleared" and
      // drop a loot chest at the pack centroid. WingLayout sets this.
      unit.packId = wingSpawn.packId || null;

      this.match.addUnit(unit);

      // Dungeon-specific AI with aggro state machine — idle until player
      // approaches, pursue when within range, de-aggro on extended LOS break.
      const ai = new DungeonAI(slot, monsterCfg);
      this.aiControllers[slot] = ai;
    }

    // Apply per-room "second wind"-style heals etc. (player ref set above)
    if (player && player.dungeonRoomHealPct > 0) {
      const heal = Math.round(player.maxHp * player.dungeonRoomHealPct);
      player.hp = Math.min(player.maxHp, player.hp + heal);
    }

    // Consume the ritual_brazier next-room damage buff if pending
    if (player && player._dungeonNextRoomDmgBuff > 0) {
      player.stats.damageDealtMod = (player.stats.damageDealtMod || 1) * (1 + player._dungeonNextRoomDmgBuff);
      player._dungeonBoonAppliedThisRoom = player._dungeonNextRoomDmgBuff;
      player._dungeonNextRoomDmgBuff = 0;
    } else if (player?._dungeonBoonAppliedThisRoom > 0) {
      // Boon was applied LAST room — reverse it now (single-room duration)
      player.stats.damageDealtMod = (player.stats.damageDealtMod || 1) / (1 + player._dungeonBoonAppliedThisRoom);
      player._dungeonBoonAppliedThisRoom = 0;
    }

    // Set initial target: player targets first monster, monsters target player
    if (this.match.units.length > 1) {
      this.match.setTarget(0, 1);
      for (let s = 1; s < this.match.units.length; s++) {
        this.match.setTarget(s, 0);
      }
    }
  }

  // ── Tick loop ──────────────────────────────────────────────────────

  _startTickLoop() {
    this._tickStartTime = Date.now();
    this._tickCount = 0;
    this.tickInterval = true;

    const loop = () => {
      if (!this.tickInterval) return;
      const now = Date.now();
      const elapsed = now - this._tickStartTime;
      const expected = Math.floor(elapsed / TICK_RATE);
      while (this._tickCount < expected && this.tickInterval) {
        this._tickOnce();
        this._tickCount++;
        if (this.roomState === 'finished' || this.roomState === 'between_rooms') return;
      }
      const next = (this._tickCount + 1) * TICK_RATE;
      const delay = Math.max(1, next - elapsed);
      this._tickTimer = setTimeout(loop, delay);
    };
    this._tickTimer = setTimeout(loop, TICK_RATE);
  }

  _stopTickLoop() {
    this.tickInterval = false;
    if (this._tickTimer) { clearTimeout(this._tickTimer); this._tickTimer = null; }
  }

  /** Player opened the pause menu — freeze the server tick loop. Without
   *  this, mobs keep attacking through the pause menu and the player can
   *  die while idle in the menu (which then routes to the hub, looking
   *  exactly like "ESC twice abandons the dungeon"). Resume restarts the
   *  loop; tick counter is preserved so timers/cooldowns continue from
   *  where they left off. */
  pauseRun() {
    if (this.roomState !== 'fighting' && this.roomState !== 'awaiting_exit') return;
    if (this._isPaused) return;
    this._isPaused = true;
    this._pauseRequestedAt = Date.now();
    this._stopTickLoop();
    // Belt-and-suspenders: the pause WS message has 50-100ms of round-trip
    // latency, so it's possible a mob's attack tick fires AFTER the player
    // hits ESC but BEFORE the server applies the pause. That race killed
    // players in the menu and looked exactly like "ESC twice abandons the
    // dungeon." Flag the player immune-to-all-damage on pause so even a
    // late-arriving damage tick can't drop them to 0.
    const player = this.match?.units?.[0];
    if (player) player.immuneToAll = true;
  }

  resumeRun() {
    if (!this._isPaused) return;
    this._isPaused = false;
    // Clear the pause-immunity flag set in pauseRun() before resuming ticks.
    const player = this.match?.units?.[0];
    if (player) player.immuneToAll = false;
    if (this.roomState !== 'fighting' && this.roomState !== 'awaiting_exit') return;
    // _startTickLoop resets _tickStartTime + _tickCount; combat timers run off
    // of match.tick which is incremented inside _tickOnce, so they keep their
    // values across the pause/resume cycle.
    this._startTickLoop();
  }

  _tickOnce() {
    if (!this.match) return;
    // Run ticks while fighting AND while awaiting the exit portal — player
    // still needs to walk around, interact with chests, send F-key messages
    // after the room is cleared. Only `between_rooms` (upgrade picker open)
    // and `finished` should freeze the world.
    if (this.roomState !== 'fighting' && this.roomState !== 'awaiting_exit') return;

    // Don't pre-increment match.tick — CombatEngine.tick() advances it as the
    // last step of each tick. Doing both made the dungeon run at 2x tick rate
    // and threw off cooldown / swing-timer math relative to wall clock.
    this.eventBuffer = [];

    // Apply buffered player inputs
    for (const input of this.pendingInputs) {
      this._applyInput(0, input);
    }
    this.pendingInputs = [];

    // AI decisions
    for (const [slotStr, ai] of Object.entries(this.aiControllers)) {
      const slot = parseInt(slotStr);
      const unit = this.match.units.find(u => u.id === slot);
      if (unit?.isAlive) {
        ai.decide(this.match, this.engine, this.match.tick);
      }
    }

    // Environmental hazards resolve before the engine tick so their damage is
    // part of the same tick the player sees, not a frame late.
    tickHazards(this.currentWing, this.match.units, this.match.tick, (unit, dmg, hazard) => {
      unit.hp = Math.max(0, unit.hp - dmg);
      if (unit.hp === 0 && unit.isAlive !== false) unit.alive = false;
      this.eventBuffer.push({
        event: 'hazard_hit', targetId: unit.id, damage: dmg,
        hazardId: hazard.id, kind: hazard.kind,
      });
    });

    this.engine.tick();

    this._broadcastState();

    // End-of-tick checks
    if (!this.match.active) {
      // checkWinCondition fired — player died
      this._endDungeonDeath();
      return;
    }

    // Check if all monsters dead → room clear
    const aliveMonsters = this.match.units.filter(u => u.id !== 0 && u.isAlive);
    if (aliveMonsters.length === 0) {
      this._onRoomClear();
    }
  }

  _applyInput(slot, input) {
    const unit = this.match.units[slot];
    if (!unit || !unit.isAlive) return;

    // Match GameRoom's input shape — client sends moveDir / abilities / etc.
    if (input.targetId !== undefined && input.targetId !== null) {
      const target = this.match.units.find(u => u.id === input.targetId);
      if (target && target.team !== unit.team) {
        this.match.setTarget(slot, input.targetId);
      }
    }
    // Movement: client sends `moveDir` (per main.js _sendPvPInput); convert
    // to a moveTo target using the same formula GameRoom uses.
    if (input.moveDir) {
      const speed = (BASE_MOVE_SPEED * (unit.getEffectiveMoveSpeed?.() || 1)) / TICKS_PER_SECOND;
      const targetPos = new Vec3(
        unit.position.x + input.moveDir.x * speed * 5,
        0,
        unit.position.z + input.moveDir.z * speed * 5,
      );
      this.engine.movement.moveTo(unit, targetPos);
      if (unit.isChanneling) unit.cancelChannel();
    } else if (input.stopMove) {
      this.engine.movement.stop(unit);
    }
    if (input.facing !== undefined) unit.facing = input.facing;

    // Abilities: client (NetworkManager.sendInput) sends `abilities` as a flat
    // array of ability ID strings — same shape as PvP. Earlier code expected
    // each entry to be `{abilityId, targetId}`, dropping every cast on the
    // floor. Match GameRoom's contract: iterate strings, route to the unit's
    // current target id (set by setTarget on the matchState).
    if (Array.isArray(input.abilities) && input.abilities.length > 0) {
      const targetId = this.match.targets.get(slot) ?? input.targetId ?? null;
      for (const abilityId of input.abilities) {
        this.engine.queueAbility(slot, abilityId, targetId);
      }
    }
    if (input.abilityId) {
      this.engine.queueAbility(slot, input.abilityId, input.targetId);
    }

    if (input.dodgeRoll && input.dodgeRollDirection) {
      this.engine.movement.startDodgeRoll(unit, input.dodgeRollDirection, this.match.tick, 0);
    }
  }

  // ── Room clear / advance ───────────────────────────────────────────

  _onRoomClear() {
    if (this._roomCleared) return; // dedupe — runs once when last monster dies
    this._roomCleared = true;

    const room = this.floor[this.roomIndex];
    const baseReward = room.isBoss ? 80 : (room.type === ROOM_TYPES.ELITE ? 50 : 30);
    const reward = (room.coinBonus || baseReward);
    this.coinsEarned += reward;
    const isLastRoom = this.roomIndex >= this.floor.length - 1;

    if (isLastRoom) {
      this._endDungeonVictory();
      return;
    }

    // Don't auto-advance — spawn an exit portal at the far east of the main
    // chamber and wait for the player to walk to it + interact. This gives
    // them time to loot chests / explore hidden chambers before committing.
    this.roomState = 'awaiting_exit';
    if (this.currentWing) {
      const main = this.currentWing.chambers.find(c => c.id === 'main');
      if (main) {
        // Exit portal sits at the far end of the main chamber, opposite the
        // direction the player came in from.
        const exitFeature = {
          kind: 'exit',
          id: 'wing_exit',
          cx: main.cx + main.halfX - 3,
          cz: main.cz,
          activated: false,
        };
        this.currentWing.features.push(exitFeature);
      }
    }

    this._sendToPlayer({
      type: 'dungeon_room_cleared',  // distinct from dungeon_room_clear
      roomIndex: this.roomIndex,
      roomType: room.type,
      coinsEarned: reward,
      totalCoins: this.coinsEarned,
      wing: this._serializeWing(),  // send updated wing with exit feature
    });
  }

  /** Player interacted with the exit portal — present upgrade picks now,
   *  plus an EXTRACT option so the player can bank pending loot and end
   *  the run safely instead of pushing deeper and risking it. Extract is
   *  available unless this is the boss room (no next room to go to). */
  _presentUpgradePicks() {
    const room = this.floor[this.roomIndex];
    this.roomState = 'between_rooms';
    const upgradeCount = room.isHidden ? 4 : 3;
    this._pendingUpgradeChoices = rollUpgradeChoices(upgradeCount, []);
    const pendingGear = this._lootDropped.filter(item => item.slot && item.itemId);
    const pendingGems = this._lootDropped.filter(item => item.gemId);
    const nextRoom = this._getNextRoomInfo();
    this._sendToPlayer({
      type: 'dungeon_room_clear',
      roomIndex: this.roomIndex,
      roomType: room.type,
      isBoss: !!room.isBoss,
      isHidden: !!room.isHidden,
      coinsEarned: 0, // already awarded on clear
      totalCoins: this.coinsEarned,
      upgradeChoices: this._pendingUpgradeChoices,
      nextRoom,
      // Extract = bank loot, end run. Only meaningful if there's a next
      // room AND the player has something to save.
      // Extract is always available between rooms — even with zero pending
      // loot, the player should have the option to bail before pushing
      // deeper. Previously gated on having drops, which surprised players
      // who wanted to leave a run early without grinding for gear first.
      canExtract: !!nextRoom,
      pendingGearCount: pendingGear.length,
      pendingGemCount: pendingGems.length,
    });
  }

  /** Player picked an upgrade — apply it and advance to the next room. */
  pickUpgrade(upgradeId) {
    if (this.roomState !== 'between_rooms') return;
    if (!this._pendingUpgradeChoices?.some(u => u.id === upgradeId)) return;

    const player = this.match.units[0];
    applyUpgrade(player, upgradeId);
    const picked = this._pendingUpgradeChoices.find(u => u.id === upgradeId);
    this.upgradesPicked.push({ id: picked.id, name: picked.name });
    this._pendingUpgradeChoices = null;

    // Persist this-wing coins to the wallet NOW — coins must survive defeat.
    // The previous design only banked on victory, which felt like nothing
    // ever stuck. Bank as a checkpoint between wings.
    this._bankUnbankedCoins();

    // Advance to next encounter — _spawnEncounter sets player position from
    // the new wing's playerSpawn (entry hall). Drop the legacy -30, 0, 0
    // fallback that would teleport the player into a wall when the wing
    // entry is somewhere else.
    this.roomIndex++;
    this._spawnEncounter(this.roomIndex);

    this._sendToPlayer({
      type: 'dungeon_next_room',
      roomIndex: this.roomIndex,
      currentRoom: this._getCurrentRoomInfo(),
      wing: this._serializeWing(),
      units: this.match.units.map(u => this._serializeUnitFull(u)),
    });

    this.roomState = 'fighting';
    // Restart tick loop
    this._tickCount = 0;
    this._tickStartTime = Date.now();
    this._startTickLoop();
  }

  _endDungeonVictory() {
    this.roomState = 'finished';
    this._stopTickLoop();
    this._payoutCoins();
    this._recordRun('victory');

    // Roll boss loot — gear from the slot pool + tier-appropriate gems
    const lootRolled = this._rollBossLoot();
    this._lootDropped.push(...lootRolled.gear, ...lootRolled.gems);

    // Persist gear + gems to inventory + record ladder time. Includes BOTH
    // boss loot (above) AND any mob-dropped gear accumulated during the run.
    // Gear items have `slot`, gems have `gemId` — partition by that.
    const allGear = this._lootDropped.filter(item => item.slot && item.itemId);
    const allGems = this._lootDropped.filter(item => item.gemId);
    if (this.player?.sub && this._runStartMs) {
      const durationMs = Date.now() - this._runStartMs;
      addGearAndGems(this.player.sub, allGear, allGems)
        .catch(err => console.warn(`[Dungeon ${this.code}] inventory save failed:`, err.message));
      recordLadderEntry({
        sub: this.player.sub,
        username: this.player.username,
        classId: this.player.classId,
        tier: this.tier,
        partySize: 1, // solo only for now
        durationMs,
        themeId: this.themeId,
      }).catch(err => console.warn(`[Dungeon ${this.code}] ladder record failed:`, err.message));
    }

    this._sendToPlayer({
      type: 'dungeon_complete',
      result: 'victory',
      tier: this.tier,
      roomsCleared: this.floor.length,
      coinsEarned: this.coinsEarned,
      upgradesPicked: this.upgradesPicked,
      lootDropped: this._lootDropped,
      durationMs: this._runStartMs ? (Date.now() - this._runStartMs) : 0,
    });
    console.log(`[Dungeon ${this.code}] VICTORY T${this.tier} — ${this.player.username} cleared all ${this.floor.length} rooms`);
  }

  _endDungeonDeath() {
    // Pause-race guard: if the player paused within the last 2 seconds, the
    // death tick was already in flight when ESC was pressed and the player
    // shouldn't actually die. Refill HP, mark them alive, and bail. The
    // pause is still in effect; on resume they continue from full health.
    if (this._isPaused || (this._pauseRequestedAt && Date.now() - this._pauseRequestedAt < 2000)) {
      const player = this.match?.units?.[0];
      if (player) {
        player.hp = player.maxHp;
        player.alive = true;
        player.isAlive = true;
        if (this.match) this.match.active = true;
      }
      console.log(`[Dungeon ${this.code}] death revived by pause-race guard for ${this.player.username}`);
      return;
    }
    this.roomState = 'finished';
    this._stopTickLoop();
    this._payoutCoins();
    this._recordRun('defeat');
    this._sendToPlayer({
      type: 'dungeon_complete',
      result: 'defeat',
      roomsCleared: this.roomIndex,
      coinsEarned: this.coinsEarned,
      upgradesPicked: this.upgradesPicked,
    });
    console.log(`[Dungeon ${this.code}] DEFEAT — ${this.player.username} died on room ${this.roomIndex + 1}`);
  }

  /** Player chose to extract at the exit portal — bank the run-loot (gear +
   *  gems accumulated so far) to their inventory and end the run. Unlike
   *  victory this doesn't roll boss loot and doesn't record a ladder time;
   *  it's just a safe checkpoint. Coins are already banked per wing. */
  extractRun() {
    if (this.roomState !== 'between_rooms' && this.roomState !== 'awaiting_exit') return;
    this.roomState = 'finished';
    this._stopTickLoop();
    this._payoutCoins();
    this._recordRun('extract');
    const allGear = this._lootDropped.filter(item => item.slot && item.itemId);
    const allGems = this._lootDropped.filter(item => item.gemId);
    if (this.player?.sub && (allGear.length || allGems.length)) {
      addGearAndGems(this.player.sub, allGear, allGems)
        .catch(err => console.warn(`[Dungeon ${this.code}] extract inventory save failed:`, err.message));
    }
    this._sendToPlayer({
      type: 'dungeon_complete',
      result: 'extract',
      tier: this.tier,
      roomsCleared: this.roomIndex + 1,
      coinsEarned: this.coinsEarned,
      upgradesPicked: this.upgradesPicked,
      lootDropped: this._lootDropped,
      durationMs: this._runStartMs ? (Date.now() - this._runStartMs) : 0,
    });
    console.log(`[Dungeon ${this.code}] EXTRACT — ${this.player.username} extracted after room ${this.roomIndex + 1} with ${allGear.length} gear, ${allGems.length} gems`);
  }

  /** Bank any unbanked run-coins to the player's Crucible Coin wallet and
   *  tell the client the new wallet total so the in-game inventory updates.
   *  Called on every wing-clear AND at end of run (victory or defeat) so
   *  coins always survive — losing a run no longer wipes the take. */
  async _bankUnbankedCoins() {
    if (!this.player?.sub || this.coinsUnbanked <= 0) return;
    const banking = this.coinsUnbanked;
    this.coinsUnbanked = 0;
    try {
      const newBalance = await db.awardCoins(this.player.sub, banking);
      // db.awardCoins typically returns the new balance; fall back to
      // local tracking if not.
      this.walletCoins = (typeof newBalance === 'number')
        ? newBalance
        : (this.walletCoins + banking);
      this._sendToPlayer({
        type: 'dungeon_wallet_update',
        walletCoins: this.walletCoins,
        banked: banking,
      });
    } catch (err) {
      // Roll the unbanked back so we retry on the next bank.
      this.coinsUnbanked += banking;
      console.error(`[Dungeon ${this.code}] coin bank failed:`, err.message);
    }
  }

  /** Legacy alias — kept so existing callsites compile. */
  async _payoutCoins() {
    return this._bankUnbankedCoins();
  }

  /** Persist a run record for admin analytics — clear rate, time-to-clear,
   *  upgrade pick rate, kill room. Fire-and-forget so failures don't block. */
  _recordRun(result) {
    if (!this.player?.sub) return;
    const startedAt = this._tickStartTime || Date.now();
    const durationSec = (Date.now() - startedAt) / 1000;
    const currentRoom = this.floor?.[this.roomIndex];
    const aliveMonsters = this.match?.units?.filter(u => u.id !== 0 && u.isAlive) || [];
    const killer = result === 'defeat' && aliveMonsters.length ? aliveMonsters[0].monsterId : null;
    db.recordDungeonRun({
      sub: this.player.sub,
      themeId: this.themeId,
      classId: this.player.classId,
      result,
      roomsCleared: result === 'victory' ? this.floor.length : this.roomIndex,
      totalRooms: this.floor?.length || 0,
      durationSec,
      coinsEarned: this.coinsEarned,
      upgradesPicked: this.upgradesPicked.map(u => u.id),
      diedInRoom: result === 'defeat' ? currentRoom?.label || null : null,
      diedToMonsterId: killer,
    }).catch(err => console.warn(`[Dungeon ${this.code}] analytics record failed:`, err.message));
  }

  // ── Input + spectator handlers ─────────────────────────────────────

  handleInput(ws, msg) {
    if (this.player?.ws !== ws) return;
    // Client (NetworkManager.sendInput) sends a FLAT shape:
    //   `{type:'input', moveDir, abilities, targetId, facing, ...}`
    // Push the message directly so _applyInput sees the shape it expects.
    this.pendingInputs.push(msg);
  }

  /**
   * Player interacts with a feature (chest, lever, breakable wall) by
   * pressing F when in range. Server validates proximity, applies effect,
   * broadcasts the new state.
   */
  /** Vendor catalog. Two stocks:
   *   - STARTER vendor (wing 0 entry): "extraction help" items the player
   *     buys with banked coins from previous runs — persistent stats that
   *     last the whole run (max HP, dmg, speed, loot luck).
   *   - BOSS vendor (boss-wing entry): emergency consumables (heals + boss
   *     fight buffs) for last-mile prep before the final encounter.
   *  Prices scale with tier so higher tiers stay meaningful. */
  _getVendorItems(isStarter = false) {
    const tier = this.tier || 1;
    const tierMult = 1 + (tier - 1) * 0.15;
    if (isStarter) {
      // Tuned so a single wing-clear (~40-60 coins) buys a cheap item, and
      // a full T1 run (~220 coins) can afford one mid-tier Rite plus a
      // consumable. Prices still scale with tier — at T10 a Rite costs ~140
      // but T10 mob payouts also scale, so cost-as-fraction-of-run is flat.
      return [
        { id: 'heal_half',          name: 'POTION OF VITALITY', desc: 'Restore 40% of max HP.',                    cost: Math.round( 40 * tierMult), icon: 'heal_half' },
        { id: 'absorb_shield',      name: 'WARDING TALISMAN',   desc: 'Grants a 25% maxHP absorb shield.',         cost: Math.round( 60 * tierMult), icon: 'absorb_shield' },
        { id: 'starter_speed',      name: 'RITE OF SWIFTNESS',  desc: '+10% movement speed for the entire run.',   cost: Math.round( 70 * tierMult), icon: 'buff_haste' },
        { id: 'starter_max_hp',     name: 'RITE OF ENDURANCE',  desc: '+10% max HP for the entire run.',           cost: Math.round( 90 * tierMult), icon: 'buff_defense' },
        { id: 'starter_dmg',        name: 'RITE OF SLAUGHTER',  desc: '+10% damage for the entire run.',           cost: Math.round( 90 * tierMult), icon: 'buff_damage' },
        { id: 'starter_extra_coin', name: 'COIN-WARDED CHARM',  desc: '+25% coins from mobs for the entire run.',  cost: Math.round(120 * tierMult), icon: 'heal_full' },
      ];
    }
    return [
      { id: 'heal_full',    name: 'FULL HEAL',           desc: 'Restore HP to full.',                 cost: Math.round(180 * tierMult), icon: 'heal_full' },
      { id: 'heal_half',    name: 'POTION OF VITALITY',  desc: 'Restore 40% of max HP.',              cost: Math.round( 60 * tierMult), icon: 'heal_half' },
      { id: 'buff_damage',  name: 'BREW OF FURY',        desc: '+20% damage for the boss fight.',     cost: Math.round(120 * tierMult), icon: 'buff_damage' },
      { id: 'buff_defense', name: 'STONESKIN ELIXIR',    desc: '-15% damage taken for the boss fight.', cost: Math.round(120 * tierMult), icon: 'buff_defense' },
      { id: 'buff_haste',   name: 'TINCTURE OF HASTE',   desc: '-10% ability cooldowns for the boss.', cost: Math.round(100 * tierMult), icon: 'buff_haste' },
      { id: 'absorb_shield', name: 'WARDING TALISMAN',   desc: 'Grants a 25% maxHP absorb shield.',   cost: Math.round( 90 * tierMult), icon: 'absorb_shield' },
    ];
  }

  /** Stack/use limits per vendor item, plus a "should refuse this purchase
   *  right now" predicate. Without these the player can spam-buy +10% dmg
   *  rites and clear T10 trivially. */
  _getVendorItemRules() {
    return {
      // Heals: unlimited count but gated by current HP.
      heal_full:  { max: Infinity, statefulRefuse: (p) => p.hp >= p.maxHp ? 'Already at full HP.' : null },
      heal_half:  { max: Infinity, statefulRefuse: (p) => p.hp >= p.maxHp ? 'Already at full HP.' : null },
      // Shields stack additively (each absorb takes damage in turn) so we
      // don't refuse when one's active — the player can stockpile up to 3
      // for a 75% maxHP buffer. Previously refused with "Shield already
      // active." which silently rejected buys 2-4 and confused players.
      absorb_shield: { max: 3, statefulRefuse: null },
      buff_damage:   { max: 1, statefulRefuse: null },
      buff_defense:  { max: 1, statefulRefuse: null },
      buff_haste:    { max: 1, statefulRefuse: null },
      // Permanent run-rites — capped at 3 stacks each (max +30% per stat).
      // Previously these could be spammed for unbounded scaling.
      starter_max_hp:     { max: 3, statefulRefuse: null },
      starter_dmg:        { max: 3, statefulRefuse: null },
      starter_speed:      { max: 3, statefulRefuse: null },
      starter_extra_coin: { max: 3, statefulRefuse: null },
    };
  }

  /** Handle a vendor purchase. Spends from the player's Crucible Coin
   *  WALLET (not run-local coinsEarned) so this works for the starter
   *  vendor on wing 0 — where the player wants to spend coins from
   *  previous runs to help with extraction. Server is authoritative:
   *  validate caps + state-refusals BEFORE deducting coins, then
   *  db.deductCoins atomically validates + deducts, only then apply effect. */
  async handleVendorBuy(ws, featureId, itemId) {
    if (this.player?.ws !== ws) return;
    const wing = this.currentWing;
    if (!wing) return;
    const feature = wing.features.find(f => f.id === featureId);
    if (!feature || feature.kind !== 'vendor') return;
    const player = this.match.units[0];
    if (!player?.alive) return;
    const dx = player.position.x - feature.cx;
    const dz = player.position.z - feature.cz;
    if (dx * dx + dz * dz > 36) return;

    const items = this._getVendorItems(!!feature.isStarter);
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    if (!this.player.sub) {
      this._sendToPlayer({ type: 'dungeon_vendor_result', success: false, reason: 'Not signed in.' });
      return;
    }

    // ── Stack-cap + stateful gate enforcement (runs BEFORE coin deduction so
    //    the player isn't charged for a refused purchase) ───────────────────
    const rules = this._getVendorItemRules()[itemId] || { max: Infinity, statefulRefuse: null };
    const owned = this._vendorPurchases[itemId] || 0;
    if (owned >= rules.max) {
      this._sendToPlayer({
        type: 'dungeon_vendor_result',
        success: false,
        reason: rules.max === 1 ? 'Already active.' : `Maxed out (${rules.max}/${rules.max}).`,
        walletCoins: this.walletCoins,
        purchases: this._vendorPurchases,
      });
      return;
    }
    if (rules.statefulRefuse) {
      const refusal = rules.statefulRefuse(player);
      if (refusal) {
        this._sendToPlayer({
          type: 'dungeon_vendor_result',
          success: false,
          reason: refusal,
          walletCoins: this.walletCoins,
          purchases: this._vendorPurchases,
        });
        return;
      }
    }

    // Bank any unbanked run-coins first so the wallet shows the player's
    // actual balance including what they just earned this run.
    await this._bankUnbankedCoins();

    // Atomic DB-side deduction with conditional-check on `coins >= cost`.
    const ok = await db.deductCoins(this.player.sub, item.cost);
    if (!ok) {
      this._sendToPlayer({
        type: 'dungeon_vendor_result',
        success: false,
        reason: 'Not enough Crucible Coins.',
        walletCoins: this.walletCoins,
        purchases: this._vendorPurchases,
      });
      return;
    }
    this.walletCoins = Math.max(0, this.walletCoins - item.cost);
    this._vendorPurchases[itemId] = owned + 1;

    // Apply the effect
    if (item.id === 'heal_full') {
      player.hp = player.maxHp;
    } else if (item.id === 'heal_half') {
      player.hp = Math.min(player.maxHp, player.hp + Math.round(player.maxHp * 0.4));
    } else if (item.id === 'buff_damage') {
      player.stats.damageDealtMod = (player.stats.damageDealtMod || 1) * 1.20;
    } else if (item.id === 'buff_defense') {
      player.stats.damageTakenMod = (player.stats.damageTakenMod || 1) * 0.85;
    } else if (item.id === 'buff_haste') {
      player.stats.cooldownMod = (player.stats.cooldownMod || 1) * 0.90;
    } else if (item.id === 'absorb_shield') {
      const amount = Math.round(player.maxHp * 0.25);
      player.absorbs = player.absorbs || [];
      player.absorbs.push({ amount, sourceId: 0, abilityId: 'vendor_talisman' });
    } else if (item.id === 'starter_max_hp') {
      player.maxHp = Math.round(player.maxHp * 1.10);
      player.hp = player.maxHp;
    } else if (item.id === 'starter_dmg') {
      player.stats.damageDealtMod = (player.stats.damageDealtMod || 1) * 1.10;
    } else if (item.id === 'starter_speed') {
      // Engine reads `moveSpeedMultiplier` (Unit.js:178). Previously wrote
      // to `moveSpeedMod` which nothing read — speed buff was a no-op.
      player.stats.moveSpeedMultiplier = (player.stats.moveSpeedMultiplier || 1) * 1.10;
    } else if (item.id === 'starter_extra_coin') {
      // Loot luck — +25% coin drops for this run.
      this._coinDropMult = (this._coinDropMult || 1) * 1.25;
    }
    this._sendToPlayer({
      type: 'dungeon_vendor_result',
      success: true,
      itemId,
      itemName: item.name,
      walletCoins: this.walletCoins,
      coinsRemaining: this.walletCoins, // legacy alias
      hp: player.hp,
      maxHp: player.maxHp,
      purchases: this._vendorPurchases,
      ownedAfter: this._vendorPurchases[itemId],
      maxStacks: rules.max === Infinity ? null : rules.max,
    });
  }

  /** Player completed a shrine puzzle on the client. Server validates the
   *  solution against the seeded answer and awards rewards (or applies a
   *  small penalty on fail). REBALANCED rewards (less generous):
   *    Success: 30% gear + 20% upgrade + 12% gem + 38% small heal (was 50/35/15/0)
   *    Fail:    apply a -10% damage debuff for the rest of the run
   *  Puzzles aren't auto-win — players have to engage with them. */
  handlePuzzleSolve(ws, featureId, solution) {
    if (this.player?.ws !== ws) return;
    const wing = this.currentWing;
    if (!wing) return;
    const player = this.match.units[0];
    if (!player?.alive) return;
    const feature = wing.features.find(f => f.id === featureId);
    if (!feature || feature.kind !== 'puzzle_shrine') return;
    if (feature.consumed) return;
    feature.consumed = true;

    // Server-side validation of the solution. Each puzzle type has its
    // canonical answer derived from the seed; client must match.
    const isCorrect = this._validatePuzzleSolution(feature.puzzleType, feature.puzzleSeed, solution);

    if (!isCorrect) {
      // Punish with a temporary debuff — wrong answers have consequences
      player.stats.damageDealtMod = (player.stats.damageDealtMod || 1) * 0.90;
      this._sendToPlayer({
        type: 'dungeon_puzzle_resolved',
        featureId: feature.id,
        success: false,
        penalty: 'Damage reduced 10% for this run',
      });
      return;
    }

    // Correct! Rebalanced (less generous) reward roll.
    // Puzzle rewards SCALE WITH TIER — higher tiers tilt the reward roll
    // toward gear + upgrades + gems and away from the "consolation heal."
    // T1: 30% gear, 20% upgrade, 12% gem, 38% heal
    // T5: 40% gear, 25% upgrade, 18% gem, 17% heal
    // T10: 50% gear, 28% upgrade, 22% gem,  0% heal
    const tier = this.tier || 1;
    const tierLerp = Math.min(1, (tier - 1) / 9);
    const gearThr = 0.30 + 0.20 * tierLerp;
    const upgThr = gearThr + 0.20 + 0.08 * tierLerp;
    const gemThr = upgThr + 0.12 + 0.10 * tierLerp;

    const roll = Math.random();
    const classId = this.player?.classId || null;
    let outcome;
    if (roll < gearThr) {
      const slots = ['head', 'chest', 'legs', 'weapon', 'offhand', 'trinket'];
      const slot = slots[Math.floor(Math.random() * slots.length)];
      const gear = rollGear({ slot, tier, themeId: this.themeId, classId });
      this._lootDropped.push(gear);
      outcome = { kind: 'gear', item: gear };
    } else if (roll < upgThr) {
      const choices = rollUpgradeChoices(1, this.upgradesPicked.map(u => u.id));
      if (choices.length) {
        applyUpgrade(player, choices[0].id);
        this.upgradesPicked.push({ id: choices[0].id, name: choices[0].name, source: 'shrine' });
        outcome = { kind: 'upgrade', item: choices[0] };
      }
    } else if (roll < gemThr) {
      const gem = rollGem({ tier });
      this._lootDropped.push(gem);
      outcome = { kind: 'gem', item: gem };
    } else {
      const heal = Math.round(player.maxHp * 0.20);
      player.hp = Math.min(player.maxHp, player.hp + heal);
      outcome = { kind: 'heal', amount: heal };
    }
    this._sendToPlayer({
      type: 'dungeon_puzzle_resolved',
      featureId: feature.id,
      success: true,
      outcome,
    });
  }

  /** Validate a puzzle solution server-side. Each puzzle type has a
   *  canonical answer derived from the seed. */
  _validatePuzzleSolution(puzzleType, seed, solution) {
    const rng = mulberry32(seed);
    if (puzzleType === 'glyph_sequence') {
      // Server picks 4 glyphs from 6 in random order; player must repeat.
      const glyphs = ['fire', 'frost', 'shadow', 'holy', 'nature', 'blood'];
      const sequence = [];
      for (let i = 0; i < 4; i++) {
        sequence.push(glyphs[Math.floor(rng() * glyphs.length)]);
      }
      if (!Array.isArray(solution) || solution.length !== 4) return false;
      return sequence.every((g, i) => solution[i] === g);
    }
    if (puzzleType === 'pressure_plates') {
      const order = shuffleDeterministic([1, 2, 3, 4], rng);
      if (!Array.isArray(solution) || solution.length !== 4) return false;
      return order.every((n, i) => solution[i] === n);
    }
    if (puzzleType === 'sacrifice_choice') {
      // 3 cards: blood, soul, flesh. Seed picks which is the "correct" one.
      const options = ['blood', 'soul', 'flesh'];
      const correct = options[Math.floor(rng() * options.length)];
      return solution === correct;
    }
    if (puzzleType === 'brazier_order') {
      const order = shuffleDeterministic([1, 2, 3, 4], rng);
      if (!Array.isArray(solution) || solution.length !== 4) return false;
      return order.every((n, i) => solution[i] === n);
    }
    return false;
  }

  handleInteract(ws, featureId) {
    if (this.player?.ws !== ws) return;
    const wing = this.currentWing;
    if (!wing) return;
    const player = this.match.units[0];
    if (!player?.alive) return;

    const feature = wing.features.find(f => f.id === featureId);
    if (!feature) return;
    const dx = player.position.x - feature.cx;
    const dz = player.position.z - feature.cz;
    if (dx * dx + dz * dz > 16) return; // 4 unit interact range

    if (feature.kind === 'chest' && !feature.opened) {
      feature.opened = true;
      // Reward: pick a random upgrade and apply it (skip already-stored ones)
      const choices = rollUpgradeChoices(feature.tier === 'rare' ? 2 : 1, []);
      const applied = [];
      for (const choice of choices) {
        applyUpgrade(player, choice.id);
        // Stamp the source tier so the client can color the upgrade icon —
        // rare chest upgrades get a gold halo, common chest = silver/bronze.
        applied.push({ ...choice, sourceTier: feature.tier || 'common' });
        this.upgradesPicked.push({ id: choice.id, name: choice.name, source: 'chest' });
      }
      this._sendToPlayer({
        type: 'dungeon_chest_opened',
        featureId: feature.id,
        tier: feature.tier,
        rewards: applied,
      });
    } else if (feature.kind === 'blood_well') {
      if (feature.consumed) return;
      // Heal scales with current fill — partial fill = partial heal, but
      // ALWAYS drinkable. Previously we silently returned if fill < 1,
      // which meant F did nothing and the player had no feedback.
      feature.consumed = true;
      const fillFrac = Math.max(0.3, Math.min(1, feature.fill || 0));
      const heal = Math.round(player.maxHp * 0.30 * fillFrac);
      const before = player.hp;
      player.hp = Math.min(player.maxHp, player.hp + heal);
      const actual = player.hp - before;
      this._sendToPlayer({
        type: 'dungeon_well_consumed',
        featureId: feature.id,
        healed: actual,
      });
    } else if (feature.kind === 'ritual_brazier') {
      if (feature.consumed) return;
      feature.consumed = true;
      // Buff player damage for the next room transition. We carry the boost
      // on the unit itself; _spawnEncounter can apply it at the next room.
      player._dungeonNextRoomDmgBuff = (player._dungeonNextRoomDmgBuff || 0) + 0.20;
      this._sendToPlayer({
        type: 'dungeon_brazier_lit',
        featureId: feature.id,
        bonus: '+20% damage in the next room',
      });
    } else if (feature.kind === 'ancient_idol') {
      if (feature.consumed) return;
      feature.consumed = true;
      // 30k absorb shield — pushed straight onto the unit's absorbs list so
      // the damage formula consumes it before HP. No aura wrapper needed.
      player.absorbs.push({ amount: 30000, sourceId: 0, abilityId: 'ancient_idol' });
      this._sendToPlayer({
        type: 'dungeon_idol_channeled',
        featureId: feature.id,
        absorb: 30000,
      });
    } else if (feature.kind === 'cursed_bell') {
      if (feature.consumed) return;
      feature.consumed = true;
      // Spawn 2 extra mobs in the main chamber + drop a guaranteed rare chest
      const main = this.currentWing?.chambers?.find(c => c.id === 'main');
      if (main) {
        const trashPool = this.theme?.trashPool || ['carrion_knight'];
        let nextSlot = this.match.units.length;
        for (let i = 0; i < 2; i++) {
          const monsterId = trashPool[Math.floor(Math.random() * trashPool.length)];
          const cfg = getMonsterConfig(monsterId);
          if (!cfg) continue;
          const classDef = CLASS_REGISTRY[cfg.baseClassId];
          if (!classDef) continue;
          const slot = nextSlot++;
          const unit = new Unit(slot, cfg.baseClassId, cfg.name);
          classDef.applyToUnit(unit);
          unit.team = 1;
          unit.isMonster = true;
          unit.monsterId = cfg.id;
          unit.modelScale = cfg.modelScale || 1;
          unit.abilities.clear();
          for (const id of (cfg.abilities || [])) {
            const ab = classDef.abilities.find(a => a.id === id);
            if (ab) unit.abilities.set(ab.id, ab);
          }
          unit.position = new Vec3(
            main.cx + (Math.random() - 0.5) * main.halfX,
            0,
            main.cz + (Math.random() - 0.5) * main.halfZ,
          );
          this.match.addUnit(unit);
          this.aiControllers[slot] = new DungeonAI(slot, cfg);
        }
        // Drop a bonus rare chest at the bell's location
        this.currentWing.features.push({
          kind: 'chest',
          id: `bell_chest_${Date.now()}`,
          tier: 'rare',
          cx: feature.cx, cz: feature.cz,
          opened: false,
          reward: 'random_upgrade_x2',
        });
        this._sendToPlayer({
          type: 'dungeon_bell_rung',
          featureId: feature.id,
          wing: this._serializeWing(),
          units: this.match.units.map(u => this._serializeUnitFull(u)),
        });
      }
    } else if (feature.kind === 'vendor') {
      // Vendor — opens a shop UI on the client. Two flavors: starter (wing 0
      // entry, persistent-stat items bought with wallet balance) and boss
      // (final wing entry, last-minute heals/buffs). Both spend from the
      // wallet. We bank any unbanked run-coins first so the wallet shows
      // the player's actual balance including this run's earnings.
      this._bankUnbankedCoins().then(() => {
        const player = this.match.units[0];
        const rules = this._getVendorItemRules();
        const items = this._getVendorItems(!!feature.isStarter).map(it => {
          const owned = this._vendorPurchases[it.id] || 0;
          const r = rules[it.id] || { max: Infinity, statefulRefuse: null };
          const stateRefusal = r.statefulRefuse ? r.statefulRefuse(player) : null;
          return {
            ...it,
            owned,
            maxStacks: r.max === Infinity ? null : r.max,
            disabledReason: owned >= r.max
              ? (r.max === 1 ? 'Already active.' : 'Maxed out.')
              : stateRefusal,
          };
        });
        this._sendToPlayer({
          type: 'dungeon_vendor_open',
          featureId: feature.id,
          isStarter: !!feature.isStarter,
          coins: this.walletCoins,
          walletCoins: this.walletCoins,
          items,
          purchases: this._vendorPurchases,
        });
      });
    } else if (feature.kind === 'puzzle_shrine') {
      // Puzzle shrine — opens a client-side puzzle UI. The CLIENT sends back
      // dungeon_puzzle_solve with the player's solution; the server validates
      // it and resolves with rebalanced rewards. Interacting just OPENS the
      // puzzle, doesn't auto-grant reward.
      if (feature.consumed) return;
      // Pick a puzzle type if not already assigned
      if (!feature.puzzleType) {
        const types = ['glyph_sequence', 'pressure_plates', 'sacrifice_choice', 'brazier_order'];
        feature.puzzleType = types[Math.floor(Math.random() * types.length)];
        feature.puzzleSeed = Math.floor(Math.random() * 1e9);
      }
      this._sendToPlayer({
        type: 'dungeon_puzzle_open',
        featureId: feature.id,
        puzzleType: feature.puzzleType,
        puzzleSeed: feature.puzzleSeed,
        tier: this.tier || 1,
      });
    } else if (feature.kind === 'exit') {
      // Exit portal — only valid after the room is cleared. Triggers the
      // upgrade picker. The room actually advances when the player picks.
      if (this.roomState !== 'awaiting_exit') return;
      this._presentUpgradePicks();
    } else if (feature.kind === 'lever' && !feature.activated) {
      feature.activated = true;
      // Find the targeted door (breakable wall) and break it
      const door = wing.doors.find(d => d.id === feature.target);
      if (door) door.broken = true;
      // Expand bounds + tile list to include the hidden chamber
      if (this.match.los) {
        this.match.los.dungeonBounds = this._computeBoundsIncludingHidden(wing);
        this.match.los.dungeonTiles = this._collectTiles(wing, true);
      }
      this._sendToPlayer({
        type: 'dungeon_lever_pulled',
        featureId: feature.id,
        targetDoorId: feature.target,
        newBounds: this.match.los.dungeonBounds,
        newTiles: this.match.los.dungeonTiles,
      });
    }
  }

  /**
   * Wing bounds excluding any hidden chambers — the initial state for any
   * wing with a lever-gated hidden chamber.
   */
  /** Apply the player's equipped gear + socketed gems as flat stat boosts to
   *  their unit. PvE-only — these never carry into PvP. */
  async _applyEquippedGearAndGems(unit) {
    if (!this.player?.sub) return;
    const { equipped, sockets } = await loadEquippedGearAndSockets(this.player.sub, this.player.classId);
    const apply = (stat, val) => {
      if (val == null) return;
      switch (stat) {
        case 'damage':    unit.stats.damageDealtMod = (unit.stats.damageDealtMod || 1) * (1 + val); break;
        case 'armor':     unit.stats.physicalArmor = (unit.stats.physicalArmor || 0) + val; break;
        case 'magicres':  unit.stats.magicDR = (unit.stats.magicDR || 0) + val; break;
        case 'haste':     unit.stats.cooldownMod = (unit.stats.cooldownMod || 1) * (1 - val); break;
        case 'crit':      unit.stats.critChance = (unit.stats.critChance || 0) + val; break;
        case 'life':      unit.maxHp = Math.round(unit.maxHp + val); unit.hp = unit.maxHp; break;
        case 'moveSpeed': unit.stats.moveSpeedMultiplier = (unit.stats.moveSpeedMultiplier || 1) * (1 + val); break;
        case 'damageReduction': unit.stats.damageTakenMod = (unit.stats.damageTakenMod || 1) * (1 - val); break;
        case 'spellPower': unit.stats.spellPowerMod = (unit.stats.spellPowerMod || 1) * (1 + val); break;
        case 'lifesteal':  unit.stats.lifestealPct = (unit.stats.lifestealPct || 0) + val; break;
        case 'critMultiplier': unit.stats.critMultiplier = (unit.stats.critMultiplier || 1) + val; break;
      }
    };
    for (const item of Object.values(equipped || {})) {
      for (const [stat, val] of Object.entries(item.stats || {})) apply(stat, val);
    }
    for (const gem of (sockets || [])) {
      apply(gem.stat, gem.value);
    }

    // ── SET BONUSES ──────────────────────────────────────────────────────
    // Count how many pieces of each set are equipped, then apply 2/4/6-piece
    // bonuses. Each bonus is also a stat application (or a flag on the unit
    // for build-defining effects the engine reads).
    const setCounts = {};
    for (const item of Object.values(equipped || {})) {
      if (item.setId) setCounts[item.setId] = (setCounts[item.setId] || 0) + 1;
    }
    if (!unit.activeSetBonuses) unit.activeSetBonuses = [];
    for (const [setId, count] of Object.entries(setCounts)) {
      const setDef = SETS[setId];
      if (!setDef) continue;
      // Apply each piece threshold the player has met (2, 4, 6)
      for (const threshold of [2, 4, 6]) {
        if (count >= threshold && setDef.bonuses[threshold]) {
          const b = setDef.bonuses[threshold];
          apply(b.stat, b.value);
          unit.activeSetBonuses.push({ setId, threshold, label: b.label });
        }
      }
    }

    // ── LEGENDARY UNIQUE EFFECTS ─────────────────────────────────────────
    // Each equipped legendary with a `legendaryEffectId` adds a flag to the
    // unit that the combat engine reads to apply build-defining effects.
    // The engine's event hooks check `unit.legendaryEffects` for triggers
    // like "on_kill", "on_dash", "on_hit_taken", etc.
    if (!unit.legendaryEffects) unit.legendaryEffects = [];
    for (const item of Object.values(equipped || {})) {
      if (!item.legendaryEffectId) continue;
      unit.legendaryEffects.push({
        id: item.legendaryEffectId,
        desc: item.legendaryEffectDesc,
        slot: item.slot,
      });
    }
  }

  /** Roll boss loot for this tier — 1-2 pieces of gear + 0-N gems based on
   *  the tier config. Gear is class-biased toward the player's stat
   *  preferences (Tyrant prefers damage/life/armor, Infernal prefers
   *  damage/crit/haste, etc.). */
  _rollBossLoot() {
    const cfg = this.tierCfg;
    const gear = [];
    const gems = [];
    const classId = this.player?.classId || null;
    // Always one gear piece on boss kill
    const slot = GEAR_SLOTS[Math.floor(Math.random() * GEAR_SLOTS.length)];
    gear.push(rollGear({ slot, tier: this.tier, themeId: this.themeId, classId }));
    // Bonus gear for tier 5+ (AI-balanced 40%→30% to keep total items per
    // run predictable at T7+ without crushing the boss-kill payoff).
    if (this.tier >= 5 && Math.random() < 0.30) {
      const slot2 = GEAR_SLOTS[Math.floor(Math.random() * GEAR_SLOTS.length)];
      gear.push(rollGear({ slot: slot2, tier: this.tier, themeId: this.themeId, classId }));
    }
    // Gems based on tier config
    const gemCount = cfg.gemsMin + Math.floor(Math.random() * (cfg.gemsMax - cfg.gemsMin + 1));
    for (let i = 0; i < gemCount; i++) gems.push(rollGem({ tier: this.tier }));
    return { gear, gems };
  }

  /** Build the tile list (chambers + corridors) for los polygon containment.
   *  When `includeHidden` is false, hidden chambers AND hidden connector
   *  corridors are excluded so the player can't path into them through the
   *  breakable wall before it's broken. */
  _collectTiles(wing, includeHidden) {
    const tiles = [];
    for (const c of wing.chambers) {
      if (c.hidden && !includeHidden) continue;
      tiles.push({ cx: c.cx, cz: c.cz, halfX: c.halfX, halfZ: c.halfZ });
    }
    for (const c of wing.corridors) {
      if (c.hidden && !includeHidden) continue;
      tiles.push({ cx: c.cx, cz: c.cz, halfX: c.halfX, halfZ: c.halfZ });
    }
    return tiles;
  }

  _computeBoundsExcludingHidden(wing) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const c of [...wing.chambers, ...wing.corridors]) {
      if (c.hidden) continue;
      minX = Math.min(minX, c.cx - c.halfX);
      maxX = Math.max(maxX, c.cx + c.halfX);
      minZ = Math.min(minZ, c.cz - c.halfZ);
      maxZ = Math.max(maxZ, c.cz + c.halfZ);
    }
    return {
      halfX: Math.max(20, Math.ceil(Math.max(Math.abs(minX), Math.abs(maxX)) + 2)),
      halfZ: Math.max(15, Math.ceil(Math.max(Math.abs(minZ), Math.abs(maxZ)) + 2)),
    };
  }

  _computeBoundsIncludingHidden(wing) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const c of [...wing.chambers, ...wing.corridors]) {
      minX = Math.min(minX, c.cx - c.halfX);
      maxX = Math.max(maxX, c.cx + c.halfX);
      minZ = Math.min(minZ, c.cz - c.halfZ);
      maxZ = Math.max(maxZ, c.cz + c.halfZ);
    }
    return {
      halfX: Math.max(20, Math.ceil(Math.max(Math.abs(minX), Math.abs(maxX)) + 2)),
      halfZ: Math.max(15, Math.ceil(Math.max(Math.abs(minZ), Math.abs(maxZ)) + 2)),
    };
  }

  handleDisconnect(ws) {
    if (this.player?.ws === ws) {
      this._stopTickLoop();
      this.roomState = 'finished';
    }
  }

  cleanup() {
    this._stopTickLoop();
    this.match = null;
    this.engine = null;
  }

  // ── Networking helpers ─────────────────────────────────────────────

  _sendToPlayer(msg) {
    if (this.player?.ws?.readyState === WS_OPEN) {
      this.player.ws.send(JSON.stringify(msg));
    }
  }

  _broadcastState() {
    if (!this.player?.ws || this.player.ws.readyState !== WS_OPEN) return;
    const state = {
      type: 'tick',
      t: this.match.tick,
      u: this.match.units.map(u => this._serializeUnit(u)),
      e: this.eventBuffer,
      // Hazard phases (idle/telegraph/active) drive the client's warning
      // visuals. Sent every tick because the phase is what the player reads.
      hz: hazardStates(this.currentWing, this.match.tick),
    };
    this.player.ws.send(JSON.stringify(state));
  }

  _serializeUnit(unit) {
    // Serialize cooldowns: client uses these to render the ability bar sweep
    // and to know whether a press is legitimately on CD. Previously omitted,
    // so the client's predicted CD was the only signal — when a cast was
    // rejected server-side, the client never learned the CD wasn't actually
    // running, which is why "Whirlwind sometimes fires while on CD" happened.
    const cds = {};
    if (unit.cooldowns?.cooldowns) {
      for (const [abilityId, expiresAt] of unit.cooldowns.cooldowns) {
        const remain = expiresAt - this.match.tick;
        if (remain > 0) cds[abilityId] = expiresAt;
      }
    }
    // Charge-based cooldowns: send current charges + nextRechargeAt
    const charges = {};
    if (unit.cooldowns?.charges) {
      for (const [abilityId, info] of unit.cooldowns.charges) {
        charges[abilityId] = { c: info.currentCharges, m: info.maxCharges, n: info.nextRechargeAt };
      }
    }
    // Absorb shields — sum so client can render the overlay segment on the
    // health bar. Some classes have multiple stacked shields (e.g. Revenant).
    let absorbTotal = 0;
    if (unit.absorbs?.length) {
      for (const a of unit.absorbs) absorbTotal += Math.max(0, a.amount || 0);
    }
    return {
      id: unit.id,
      hp: Math.round(unit.hp),
      maxHp: unit.maxHp,
      pos: [
        Math.round(unit.position.x * 100) / 100,
        0,
        Math.round(unit.position.z * 100) / 100,
      ],
      f: Math.round(unit.facing * 1000) / 1000,
      alive: unit.alive,
      stealth: unit.stealthed || false,
      cc: unit.ccEffects.map(c => ({ type: c.type, end: c.endTick })),
      cast: unit.castState ? {
        id: unit.castState.abilityId,
        start: unit.castState.startTick,
        end: unit.castState.endTick,
      } : null,
      chan: unit.channelState ? {
        id: unit.channelState.abilityId,
        start: unit.channelState.startTick,
        end: unit.channelState.endTick,
      } : null,
      res: this._serializeResources(unit),
      gcd: unit.gcdEndTick,
      auras: unit.auras.serialize(),
      cd: cds,
      ch: charges,
      ab: Math.round(absorbTotal),
    };
  }

  _serializeUnitFull(unit) {
    return {
      id: unit.id,
      classId: unit.classId,
      name: unit.name,
      hp: unit.hp,
      maxHp: unit.maxHp,
      team: unit.team,
      position: unit.position.toArray(),
      facing: unit.facing,
      abilities: [...unit.abilities.keys()],
      resources: this._serializeResources(unit),
      isMonster: !!unit.isMonster,
      monsterId: unit.monsterId || null,
      modelScale: unit.modelScale || 1,
      packId: unit.packId || null,
    };
  }

  _serializeResources(unit) {
    // Match PvP GameRoom's wire format — client _applyServerTick reads `cur`
    // and `max` from each pool entry. Earlier code sent `current` here, so
    // the client's pool.current was set to undefined on every tick → rage /
    // energy / mana etc. always showed 0 → abilities looked uncastable.
    const out = {};
    for (const [type, pool] of unit.resources.pools.entries()) {
      out[type] = { cur: Math.round(pool.current), max: pool.max };
    }
    return out;
  }

  /** Network-safe wing layout — stripped of any function refs / cycles. */
  _serializeWing() {
    const w = this.currentWing;
    if (!w) return null;
    return {
      mainTemplate: w.mainTemplate,
      themeId: w.themeId,
      bounds: w.bounds,
      chambers: w.chambers.map(c => ({
        id: c.id, template: c.template,
        cx: c.cx, cz: c.cz, halfX: c.halfX, halfZ: c.halfZ,
        hidden: !!c.hidden,
      })),
      corridors: w.corridors.map(c => ({
        cx: c.cx, cz: c.cz, halfX: c.halfX, halfZ: c.halfZ,
        hidden: !!c.hidden, isApproach: !!c.isApproach,
      })),
      doors: w.doors.map(d => ({
        kind: d.kind, id: d.id || null,
        cx: d.cx, cz: d.cz, halfX: d.halfX, halfZ: d.halfZ,
        broken: !!d.broken,
      })),
      features: w.features.map(f => ({
        kind: f.kind, id: f.id, tier: f.tier || null,
        cx: f.cx, cz: f.cz,
        opened: !!f.opened, activated: !!f.activated,
        target: f.target || null,
        fill: f.fill ?? 0, capacity: f.capacity || 0, consumed: !!f.consumed,
        // Puzzle metadata (so the client can render type-specific decoration
        // around the shrine + drive the right modal UI on interact).
        puzzleType: f.puzzleType || null,
        puzzleSeed: f.puzzleSeed || null,
        // Vendor flag (starter vs boss) so the client picks the right catalog.
        isStarter: !!f.isStarter,
      })),
      cover: (w.cover || []).map(c => ({
        id: c.id, kind: c.kind,
        cx: c.cx, cz: c.cz,
        radius: c.radius, rot: c.rot, pieceCount: c.pieceCount,
        chamberId: c.chamberId,
      })),
      playerSpawn: w.playerSpawn,
    };
  }

  _getCurrentRoomInfo() {
    const e = this.floor?.[this.roomIndex];
    return e ? { number: e.roomNumber, label: e.label, lore: e.lore || '', type: e.type, isBoss: !!e.isBoss } : null;
  }

  _getNextRoomInfo() {
    const e = this.floor?.[this.roomIndex + 1];
    return e ? { number: e.roomNumber, label: e.label, lore: e.lore || '', type: e.type, isBoss: !!e.isBoss } : null;
  }

  _wireEvents() {
    // Capture the same event set as PvP GameRoom and use the SAME shape
    // (`{event: <type>, ...data}`) so the client's tickData.e replay loop
    // routes them correctly to its eventBus for animations + VFX.
    const capturedEvents = [
      EVENTS.DAMAGE_DEALT, EVENTS.HEALING_DONE, EVENTS.UNIT_DAMAGED, EVENTS.UNIT_DIED,
      EVENTS.ABILITY_CAST_START, EVENTS.ABILITY_CAST_SUCCESS, EVENTS.ABILITY_CAST_FAILED,
      EVENTS.ABILITY_INTERRUPTED,
      EVENTS.CHANNEL_START, EVENTS.CHANNEL_TICK, EVENTS.CHANNEL_END,
      EVENTS.CC_APPLIED, EVENTS.CC_REMOVED, EVENTS.CC_IMMUNE,
      EVENTS.AURA_APPLIED, EVENTS.AURA_REFRESHED, EVENTS.AURA_REMOVED, EVENTS.AURA_TICK,
      EVENTS.AUTO_ATTACK,
      EVENTS.STEALTH_ENTER, EVENTS.STEALTH_BREAK,
      EVENTS.ABSORB_APPLIED, EVENTS.ABSORB_CONSUMED,
      EVENTS.MATCH_END,
    ];
    for (const eventType of capturedEvents) {
      if (!eventType) continue;
      this.eventBus.on(eventType, (data) => {
        this.eventBuffer.push({ event: eventType, ...data });
      });
    }

    // Blood well fill — every monster killed by the player adds to each
    // unconsumed blood_well in the current wing. We watch DAMAGE_DEALT and
    // check if the target died on this hit (CombatEngine doesn't emit a
    // separate UNIT_DIED, so DAMAGE_DEALT + post-hit alive check is how we
    // detect kills).
    this.eventBus.on(EVENTS.DAMAGE_DEALT, (data) => {
      if (data.sourceId !== 0) return; // player must be the killer
      const victim = this.match.units.find(u => u.id === data.targetId);
      if (!victim || victim.isAlive) return; // still alive — not a kill
      if (!victim.isMonster) return;
      // Dedupe: only count each victim once
      victim._countedForBloodWell = victim._countedForBloodWell || false;
      if (victim._countedForBloodWell) return;
      victim._countedForBloodWell = true;
      const wing = this.currentWing;
      if (!wing?.features?.length) return;
      const wells = wing.features.filter(f => f.kind === 'blood_well' && !f.consumed);
      if (!wells.length) return;
      for (const w of wells) {
        if (w.fill >= 1) continue;
        w.fill = Math.min(1, w.fill + 1 / Math.max(1, w.capacity || 4));
      }
      this._sendToPlayer({
        type: 'dungeon_feature_update',
        features: wells.map(w => ({ id: w.id, fill: w.fill, consumed: w.consumed })),
      });
    });

    // Per-mob gear drop chance — RNG roll on each mob kill. Trash mobs have
    // a small chance (~3%), elite/named mobs have higher (~12%), bosses are
    // guaranteed (handled separately in _rollBossLoot). The drops go straight
    // into the player's inventory and are surfaced on the run summary so
    // players can equip them before the next dungeon. Gear is class-biased
    // (Tyrant rolls damage/life/armor, not Infernal mana stats).
    this.eventBus.on(EVENTS.DAMAGE_DEALT, (data) => {
      if (data.sourceId !== 0) return;
      const victim = this.match.units.find(u => u.id === data.targetId);
      if (!victim || victim.isAlive) return;
      if (!victim.isMonster) return;
      if (victim._gearDropRolled) return;
      victim._gearDropRolled = true;

      // ── Per-mob coin drop ────────────────────────────────────────────
      // Every mob drops a small pile so players accumulate coins to spend
      // at the vendor before the boss. Elite mobs drop more. Tier scales it.
      const isEliteCoin = victim.monsterId && (
        victim.monsterId.includes('warlord') ||
        victim.monsterId.includes('brute') ||
        victim.monsterId.includes('cultist')
      );
      const tierMult = 1 + ((this.tier || 1) - 1) * 0.15;
      // Starter-vendor "Coin-Warded Charm" sets _coinDropMult to bump mob drops.
      const luckMult = this._coinDropMult || 1;
      const coinRange = isEliteCoin ? [6, 12] : [1, 4];
      const coins = Math.round(
        (coinRange[0] + Math.random() * (coinRange[1] - coinRange[0])) * tierMult * luckMult
      );
      this.coinsEarned += coins;
      this.coinsUnbanked += coins;
      this._sendToPlayer({
        type: 'dungeon_mob_coin',
        amount: coins,
        totalCoins: this.coinsEarned,
        x: victim.position.x, z: victim.position.z,
      });

      // Drop rates: trash 25%→10%, elite 55%→25%. Previously bumped to
      // confirm the pipeline; now toned down because drops felt spammy.
      // 12% of drops are gems instead of gear so sockets actually fill up
      // over a run (player reported never seeing a gem in 1.5h).
      const isElite = victim.monsterId && (
        victim.monsterId.includes('warlord') ||
        victim.monsterId.includes('brute') ||
        victim.monsterId.includes('cultist')
      );
      const baseChance = isElite ? 0.25 : 0.10;
      const tierBonus = Math.min(0.06, ((this.tier || 1) - 1) * 0.008);
      const dropChance = baseChance + tierBonus;
      if (Math.random() >= dropChance) return;

      const player = this.match.units[0];
      const classId = player?.classId || null;
      const isGem = Math.random() < 0.12;
      if (isGem) {
        const gem = rollGem({ tier: this.tier || 1 });
        this._lootDropped.push(gem);
        console.log(`[Dungeon ${this.code}] GEM DROP: ${gem.rarity} ${gem.name} (${gem.stat}+${gem.value}) from ${victim.monsterId || 'mob'}`);
        this._sendToPlayer({
          type: 'dungeon_mob_loot',
          gear: gem,  // client treats gems and gear the same on this channel
          x: victim.position.x, z: victim.position.z,
        });
        return;
      }
      const slots = ['head', 'chest', 'legs', 'weapon', 'offhand', 'trinket'];
      const slot = slots[Math.floor(Math.random() * slots.length)];
      const gear = rollGear({
        slot,
        tier: this.tier || 1,
        themeId: this.themeId,
        classId,
      });
      this._lootDropped.push(gear);
      console.log(`[Dungeon ${this.code}] LOOT DROP: ${gear.rarity} ${gear.slot} "${gear.name}" from ${victim.monsterId || 'mob'}`);
      this._sendToPlayer({
        type: 'dungeon_mob_loot',
        gear,
        x: victim.position.x, z: victim.position.z,
      });
    });

    // Pack-cleared loot drop — when the last mob in a pack dies, drop a
    // ── LEGENDARY UNIQUE EFFECTS — on-kill triggers ─────────────────────
    // King's Hand: kill = +8% HP back + 15% dmg buff for 6s.
    // Soulharvest Sigil: stacking +3% dmg per kill (room-scoped).
    // Bloodthirst-style trinkets fire here too.
    this.eventBus.on(EVENTS.DAMAGE_DEALT, (data) => {
      if (data.sourceId !== 0) return;
      const player = this.match.units[0];
      const victim = this.match.units.find(u => u.id === data.targetId);
      if (!victim || victim.isAlive) return;
      if (!victim.isMonster) return;
      const effects = player?.legendaryEffects;
      if (!effects?.length) return;
      for (const eff of effects) {
        if (eff.id === 'king_hand') {
          const heal = Math.round(player.maxHp * 0.08);
          player.hp = Math.min(player.maxHp, player.hp + heal);
          // Apply 15% dmg buff (use existing damageDealtMod for 6s).
          // Engine doesn't have a generic timed-buff API here; use a tag
          // the tick loop reads. Simplest: stamp endTick.
          player._legBuffKingHandUntil = (this.match.tick || 0) + 60; // 6s @ 10Hz
        } else if (eff.id === 'soulharvest_sigil') {
          player._soulharvestStacks = (player._soulharvestStacks || 0) + 1;
        }
      }
    });

    // Tick the legendary timed buffs (King's Hand) per server tick — applied
    // in the unit serialization step elsewhere; for now just clean expired.
    // The damageDealtMod modification is read at attack time.

    // chest at the pack centroid. Each pack rolls one chest (sometimes a
    // rare-tier one) so the player has something to walk to between packs
    // and the room feels rewarding piece by piece.
    this.eventBus.on(EVENTS.DAMAGE_DEALT, (data) => {
      if (data.sourceId !== 0) return;
      const victim = this.match.units.find(u => u.id === data.targetId);
      if (!victim || victim.isAlive) return;
      if (!victim.isMonster) return;
      if (!victim.packId) return;
      if (victim._countedForPack) return;
      victim._countedForPack = true;
      // Are any other mobs in this pack still alive?
      const stillAlive = this.match.units.some(u =>
        u !== victim && u.isMonster && u.isAlive && u.packId === victim.packId
      );
      if (stillAlive) return;
      // Pack cleared — drop a chest at the centroid of pack spawn positions.
      const wing = this.currentWing;
      if (!wing) return;
      const packSpawns = (wing.spawns || []).filter(s => s.packId === victim.packId);
      if (!packSpawns.length) return;
      let cx = 0, cz = 0;
      for (const s of packSpawns) { cx += s.x; cz += s.z; }
      cx /= packSpawns.length; cz /= packSpawns.length;
      // Clamp the chest position into the nearest chamber so it never
      // spawns outside the playable polygon (user reported chests landing
      // out-of-bounds when mobs drifted past walls).
      let bestC = null, bestDist = Infinity;
      for (const c of (wing.chambers || [])) {
        if (c.hidden) continue;
        const dx = cx - c.cx, dz = cz - c.cz;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestDist) { bestDist = d2; bestC = c; }
      }
      if (bestC) {
        const margin = 2.5;
        cx = Math.max(bestC.cx - bestC.halfX + margin, Math.min(bestC.cx + bestC.halfX - margin, cx));
        cz = Math.max(bestC.cz - bestC.halfZ + margin, Math.min(bestC.cz + bestC.halfZ - margin, cz));
      }
      // Pack already dropped? (defense — shouldn't happen with _countedForPack)
      const alreadyDropped = (wing.features || []).some(f =>
        f.kind === 'chest' && f.packId === victim.packId
      );
      if (alreadyDropped) return;
      // Rare-tier roll: 20% at low tiers, scales w/ dungeon tier.
      const tier = this.tier || 1;
      const rareChance = 0.15 + Math.min(0.25, tier * 0.025);
      const isRare = Math.random() < rareChance;
      const chest = {
        kind: 'chest',
        id: `chest_${victim.packId}_${Date.now()}`,
        cx, cz,
        tier: isRare ? 'rare' : 'common',
        opened: false,
        packId: victim.packId,
      };
      wing.features = wing.features || [];
      wing.features.push(chest);
      // Tell the client to spawn it.
      this._sendToPlayer({
        type: 'dungeon_loot_drop',
        feature: chest,
      });
    });

    // Vampiric upgrade — heal source for X% of damage dealt. Hooks DAMAGE_DEALT
    // so it covers both ability hits and auto-attacks. Only the player benefits
    // (monster lifesteal isn't a thing in v1).
    this.eventBus.on(EVENTS.DAMAGE_DEALT, (data) => {
      if (data.sourceId !== 0) return; // player only
      const player = this.match.units[0];
      if (!player?.alive || !player.dungeonLifesteal) return;
      const heal = Math.round((data.damage || 0) * player.dungeonLifesteal);
      if (heal > 0) {
        const before = player.hp;
        player.hp = Math.min(player.maxHp, player.hp + heal);
        const actual = player.hp - before;
        if (actual > 0) {
          this.eventBuffer.push({ event: EVENTS.HEALING_DONE, sourceId: 0, targetId: 0, healing: actual, abilityId: 'vampiric' });
        }
      }
    });
  }
}
