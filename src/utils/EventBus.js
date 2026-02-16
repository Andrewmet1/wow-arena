export class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    const cbs = this.listeners.get(event);
    if (cbs) {
      const idx = cbs.indexOf(callback);
      if (idx !== -1) cbs.splice(idx, 1);
    }
  }

  emit(event, data) {
    const cbs = this.listeners.get(event);
    if (cbs) {
      for (let i = 0; i < cbs.length; i++) {
        cbs[i](data);
      }
    }
  }

  clear() {
    this.listeners.clear();
  }
}

// Event names used throughout the game
export const EVENTS = {
  // Combat
  DAMAGE_DEALT: 'damage_dealt',
  HEALING_DONE: 'healing_done',
  ABSORB_APPLIED: 'absorb_applied',
  ABSORB_CONSUMED: 'absorb_consumed',
  UNIT_DIED: 'unit_died',

  // Abilities
  ABILITY_CAST_START: 'ability_cast_start',
  ABILITY_CAST_SUCCESS: 'ability_cast_success',
  ABILITY_CAST_FAILED: 'ability_cast_failed',
  ABILITY_INTERRUPTED: 'ability_interrupted',
  CHANNEL_START: 'channel_start',
  CHANNEL_TICK: 'channel_tick',
  CHANNEL_END: 'channel_end',

  // CC
  CC_APPLIED: 'cc_applied',
  CC_REMOVED: 'cc_removed',
  CC_IMMUNE: 'cc_immune',

  // Auras
  AURA_APPLIED: 'aura_applied',
  AURA_REFRESHED: 'aura_refreshed',
  AURA_REMOVED: 'aura_removed',
  AURA_TICK: 'aura_tick',

  // Resources
  RESOURCE_CHANGED: 'resource_changed',

  // Movement
  UNIT_MOVED: 'unit_moved',

  // Auto-attack
  AUTO_ATTACK: 'auto_attack',

  // Match
  MATCH_START: 'match_start',
  MATCH_END: 'match_end',
  MATCH_TICK: 'match_tick',

  // Arena events
  MODIFIER_APPLIED: 'modifier_applied',
  EVENT_SPAWNED: 'event_spawned',
  EVENT_COLLECTED: 'event_collected',
  EVENT_EXPIRED: 'event_expired',

  // Stealth
  STEALTH_ENTER: 'stealth_enter',
  STEALTH_BREAK: 'stealth_break',

  // GCD
  GCD_START: 'gcd_start',
  GCD_END: 'gcd_end',

  // Ground zones
  GROUND_ZONE_PLACED: 'ground_zone_placed',
  GROUND_ZONE_EXPIRED: 'ground_zone_expired'
};
