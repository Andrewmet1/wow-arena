import { EVENT_FACTORIES } from './DynamicEvents.js';
import { EVENTS } from '../utils/EventBus.js';

export class EventScheduler {
  constructor(matchState) {
    this.matchState = matchState;
    this.rng = matchState.rng;

    // First event at 30-45s (300-450 ticks)
    this.nextEventTick = Math.floor(this.rng.range(300, 450));
    this.activeEvent = null;
  }

  tick(currentTick) {
    // Spawn new event if timer elapsed and no active event
    if (currentTick >= this.nextEventTick && !this.activeEvent) {
      this.spawnEvent(currentTick);
    }

    // Active event is managed in matchState.dynamicEvents via CombatEngine
  }

  spawnEvent(currentTick) {
    const factory = this.rng.pick(EVENT_FACTORIES);
    const event = factory(this.matchState, this.rng);

    this.matchState.dynamicEvents.push(event);
    this.activeEvent = event;

    // Schedule next event in 45-60s (450-600 ticks)
    this.nextEventTick = currentTick + Math.floor(this.rng.range(450, 600));

    // Clear active event reference when it expires
    const checkExpiry = () => {
      if (event.expired) {
        this.activeEvent = null;
      }
    };

    // We'll check this in tick
    this._checkExpiry = checkExpiry;

    this.matchState.eventBus.emit(EVENTS.EVENT_SPAWNED, {
      type: event.type,
      position: event.position?.toArray()
    });
  }
}
