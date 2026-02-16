import { CombatEngine } from './CombatEngine.js';
import { EVENTS } from '../utils/EventBus.js';
import { TICK_RATE } from '../constants.js';

export class GameLoop {
  constructor(matchState) {
    this.match = matchState;
    this.engine = new CombatEngine(matchState);

    // Controllers (AI or player input)
    this.controllers = new Map(); // unitId -> controller

    // Rendering callback
    this.onRender = null;
    this.onTick = null;

    // Loop state
    this.running = false;
    this.lastTickTime = 0;
    this.accumulator = 0;
    this.animationFrameId = null;

    // Performance
    this.ticksThisSecond = 0;
    this.lastFPSUpdate = 0;
    this.tps = 0; // ticks per second

    // Hit stop — brief game freeze on heavy impacts
    this.hitStopRemaining = 0;
  }

  /**
   * Trigger hit stop (brief pause for impact feel)
   * @param {number} durationMs — milliseconds to freeze (30-120)
   */
  hitStop(durationMs = 60) {
    this.hitStopRemaining = Math.max(this.hitStopRemaining, durationMs);
  }

  /**
   * Register a controller (AI or player) for a unit
   */
  setController(unitId, controller) {
    this.controllers.set(unitId, controller);
  }

  /**
   * Start the game loop (visual mode with requestAnimationFrame)
   */
  start() {
    this.match.start();
    this.running = true;
    this.lastTickTime = performance.now();
    this.accumulator = 0;
    this.match.eventBus.emit(EVENTS.MATCH_START, {});
    this.loop(performance.now());
  }

  /**
   * Main loop — fixed timestep with rendering interpolation
   */
  loop(timestamp) {
    if (!this.running) return;

    const deltaTime = timestamp - this.lastTickTime;
    this.lastTickTime = timestamp;
    this.accumulator += deltaTime;

    // Hit stop — skip game ticks during freeze, but still render
    if (this.hitStopRemaining > 0) {
      this.hitStopRemaining -= deltaTime;
      this.accumulator = 0; // Don't accumulate ticks during freeze
      // Still render the frozen frame
      if (this.onRender) this.onRender(0, this.match);
      this.animationFrameId = requestAnimationFrame((t) => this.loop(t));
      return;
    }

    // Fixed timestep game ticks
    while (this.accumulator >= TICK_RATE && this.running) {
      this.gameTick();
      this.accumulator -= TICK_RATE;

      if (!this.match.active) {
        this.stop();
        return;
      }
    }

    // Render at display refresh rate
    const alpha = this.accumulator / TICK_RATE; // Interpolation factor
    if (this.onRender) {
      this.onRender(alpha, this.match);
    }

    this.animationFrameId = requestAnimationFrame((t) => this.loop(t));
  }

  /**
   * Execute one game tick
   */
  gameTick() {
    const currentTick = this.match.tick;

    // Get decisions from controllers
    for (const [unitId, controller] of this.controllers) {
      if (controller.decide) {
        controller.decide(this.match, this.engine, currentTick);
      }
    }

    // Process the tick
    this.engine.tick();

    // Callback
    if (this.onTick) {
      this.onTick(this.match);
    }

    this.match.eventBus.emit(EVENTS.MATCH_TICK, { tick: currentTick });

    // TPS tracking
    this.ticksThisSecond++;
    const now = performance.now();
    if (now - this.lastFPSUpdate >= 1000) {
      this.tps = this.ticksThisSecond;
      this.ticksThisSecond = 0;
      this.lastFPSUpdate = now;
    }
  }

  /**
   * Stop the game loop
   */
  stop() {
    this.running = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.match.eventBus.emit(EVENTS.MATCH_END, {
      winner: this.match.winner?.id,
      loser: this.match.loser?.id,
      duration: this.match.getMatchDuration()
    });
  }

  /**
   * Run the game in headless mode (for simulation)
   * Runs all ticks synchronously as fast as possible
   */
  runHeadless() {
    this.match.start();

    while (this.match.active && this.match.tick < this.match.maxTicks) {
      // Get AI decisions
      for (const [unitId, controller] of this.controllers) {
        if (controller.decide) {
          controller.decide(this.match, this.engine, this.match.tick);
        }
      }

      // Tick
      this.engine.tick();

      if (!this.match.active) break;
    }

    // If still active at max ticks, force end
    if (this.match.active) {
      this.match.checkWinCondition();
    }

    return {
      winner: this.match.winner,
      loser: this.match.loser,
      duration: this.match.getMatchDuration(),
      ticks: this.match.tick
    };
  }

  /**
   * Pause the loop
   */
  pause() {
    this.running = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Resume the loop
   */
  resume() {
    if (!this.match.active) return;
    this.running = true;
    this.lastTickTime = performance.now();
    this.accumulator = 0;
    this.loop(performance.now());
  }
}
