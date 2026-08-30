// Environmental hazards — the dungeon's read-and-react layer.
//
// Four props (spike_trap, pressure_plate, swinging_blade, fire_vent) were
// generated months ago and sat unreachable because nothing could place them:
// they need trigger and damage logic, not a decoration slot. This is that
// system.
//
// Every hazard runs a fixed cycle: IDLE -> TELEGRAPH -> ACTIVE -> IDLE. Damage
// only lands during ACTIVE, and TELEGRAPH is always non-zero, so a hazard can
// be read and dodged rather than being a random tax. That mirrors how casts
// already telegraph in CombatEngine — the player should always have a window.
//
// Ticks are 10/sec (TICK_RATE = 100ms).

export const HAZARD_KINDS = {
  spike_trap: {
    prop: 'spike_trap',
    radius: 3.0,
    damagePct: 0.08,      // fraction of max HP — scales with player power
    telegraphTicks: 8,    // 0.8s of warning
    activeTicks: 4,       // 0.4s of danger
    cycleTicks: 45,       // fires every 4.5s
    triggered: true,      // only cycles once a player has come near
  },
  swinging_blade: {
    prop: 'swinging_blade',
    radius: 4.0,
    damagePct: 0.12,
    telegraphTicks: 6,
    activeTicks: 5,
    cycleTicks: 30,       // relentless metronome — 3s
    triggered: false,     // always swinging
  },
  fire_vent: {
    prop: 'fire_vent',
    radius: 3.5,
    damagePct: 0.10,
    telegraphTicks: 10,   // vents hiss before they blow
    activeTicks: 6,
    cycleTicks: 60,
    triggered: false,
  },
  pressure_plate: {
    prop: 'pressure_plate',
    radius: 1.8,
    damagePct: 0.06,
    telegraphTicks: 5,
    activeTicks: 3,
    cycleTicks: 40,
    triggered: true,
  },
};

/** Phase of a hazard at `tick`, given the tick it armed on. */
export function hazardPhase(hazard, tick) {
  const def = HAZARD_KINDS[hazard.kind];
  if (!def) return 'idle';
  if (def.triggered && !hazard.armed) return 'idle';
  const base = hazard.armedTick ?? 0;
  const t = (tick - base) % def.cycleTicks;
  if (t < def.telegraphTicks) return 'telegraph';
  if (t < def.telegraphTicks + def.activeTicks) return 'active';
  return 'idle';
}

/**
 * Scatter hazards through a wing. Density scales with depth so early rooms
 * teach the mechanic before later ones lean on it.
 */
export function placeHazards(layout, rng, roomIndex = 0) {
  const kinds = Object.keys(HAZARD_KINDS);
  // 1 hazard in the first room, up to 4 deeper in. Enough to matter, not so
  // many that the floor becomes a minefield the player can't route through.
  const count = Math.min(4, 1 + Math.floor(roomIndex / 2));
  const chambers = (layout.chambers || []).filter(c => c.template !== 'entry_hall');
  if (!chambers.length) return;

  for (let i = 0; i < count; i++) {
    const c = chambers[Math.floor(rng() * chambers.length)];
    const kind = kinds[Math.floor(rng() * kinds.length)];
    // Keep off the exact centre so hazards don't sit on top of centrepiece
    // props, and inset from walls so they're dodgeable from both sides.
    const ox = (rng() - 0.5) * (c.halfX - 6) * 1.4;
    const oz = (rng() - 0.5) * (c.halfZ - 6) * 1.4;
    layout.features.push({
      kind,
      id: `hazard_${kind}_${Math.floor(rng() * 1000000)}`,
      isHazard: true,
      cx: c.cx + ox,
      cz: c.cz + oz,
      armed: !HAZARD_KINDS[kind].triggered,
      armedTick: 0,
      lastHitTick: -999,
    });
  }
}

/**
 * Advance hazards and damage anyone standing in an active one.
 *
 * Damage is percentage-based so a hazard stays relevant as gear scales, and
 * each hazard has a per-unit re-hit cooldown so standing in fire is a heavy
 * drain rather than an instant delete.
 */
export function tickHazards(wing, units, tick, onDamage) {
  if (!wing?.features?.length) return;
  for (const h of wing.features) {
    if (!h.isHazard) continue;
    const def = HAZARD_KINDS[h.kind];
    if (!def) continue;

    for (const u of units) {
      if (!u?.isAlive) continue;
      const dx = u.position.x - h.cx;
      const dz = u.position.z - h.cz;
      const distSq = dx * dx + dz * dz;

      // Arming: a triggered hazard starts its cycle the moment someone comes
      // within range, so the player's own approach is what sets it off.
      if (def.triggered && !h.armed && distSq <= (def.radius * 1.5) ** 2) {
        h.armed = true;
        h.armedTick = tick;
      }

      if (hazardPhase(h, tick) !== 'active') continue;
      if (distSq > def.radius * def.radius) continue;
      if (tick - h.lastHitTick < def.cycleTicks) continue;

      h.lastHitTick = tick;
      const dmg = Math.max(1, Math.round(u.maxHp * def.damagePct));
      onDamage(u, dmg, h);
    }
  }
}

/** Serialisable hazard state for the client (phase drives the visuals). */
export function hazardStates(wing, tick) {
  if (!wing?.features?.length) return [];
  return wing.features
    .filter(f => f.isHazard)
    .map(h => ({ id: h.id, kind: h.kind, phase: hazardPhase(h, tick) }));
}
