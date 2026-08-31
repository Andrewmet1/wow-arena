// Arena layouts as data.
//
// The PvP arena was one hardcoded shape: a 40-unit circle with four pillars at
// the corners of a square. Every 1v1, 2v2 and 3v3 played on it, so positioning
// was solved once and never varied — the same pillar dance every match.
//
// A variant is just the geometry that matters to gameplay: the boundary and the
// cover. Both already flow through LineOfSight, which accepts pillars and can
// take a radius, so the engine needs no structural change to support several.
//
// Cover placement is the whole design. Four pillars in a square gives perfectly
// symmetric line-of-sight, which is fair but characterless; asymmetric and
// off-centre cover creates positions that are genuinely better or worse and
// gives players something to contest.

export const ARENA_VARIANTS = {
  // The original. Kept as the baseline everyone already knows.
  proving_square: {
    id: 'proving_square',
    name: 'The Proving Square',
    radius: 40,
    pillarRadius: 1.5,
    pillars: [
      { x: 20, z: 20 }, { x: -20, z: 20 },
      { x: 20, z: -20 }, { x: -20, z: -20 },
    ],
    description: 'Four pillars at even corners. Symmetric sightlines, no favoured ground.',
  },

  // One dominant centre pillar: fighting happens around a single axis, and
  // whoever holds the inside track controls the fight.
  the_maw: {
    id: 'the_maw',
    name: 'The Maw',
    radius: 38,
    pillarRadius: 4.5,
    pillars: [
      { x: 0, z: 0, radius: 6 },
      { x: 22, z: -14 }, { x: -22, z: 14 },
    ],
    description: 'A single great pillar at the centre with two outliers. Circular kiting, one contested axis.',
  },

  // Dense scattered cover: short sightlines, rewards close-quarters classes and
  // punishes long casts.
  shattered_hall: {
    id: 'shattered_hall',
    name: 'The Shattered Hall',
    radius: 42,
    pillarRadius: 2.0,
    pillars: [
      { x: 14, z: 6 }, { x: -9, z: 17 }, { x: -18, z: -8 },
      { x: 6, z: -20 }, { x: 26, z: -6 }, { x: -26, z: -22 },
      { x: 20, z: 24 },
    ],
    description: 'Seven broken pillars, none symmetric. Short sightlines; melee-favoured.',
  },

  // Almost no cover: a caster's arena, where positioning is about distance
  // rather than breaking line of sight.
  open_crucible: {
    id: 'open_crucible',
    name: 'The Open Crucible',
    radius: 44,
    pillarRadius: 2.5,
    pillars: [
      { x: 0, z: 26 }, { x: 0, z: -26 },
    ],
    description: 'Two pillars, wide floor. Nowhere to hide; ranged-favoured.',
  },
};

export const VARIANT_IDS = Object.keys(ARENA_VARIANTS);

/** A variant by id, falling back to the original rather than throwing. */
export function getArenaVariant(id) {
  return ARENA_VARIANTS[id] || ARENA_VARIANTS.proving_square;
}

/**
 * Choose a variant for a match.
 *
 * Seeded so a match's layout is reproducible from its seed — replays and
 * spectators have to see the same arena the players fought in.
 */
export function pickArenaVariant(rng = Math.random) {
  return ARENA_VARIANTS[VARIANT_IDS[Math.floor(rng() * VARIANT_IDS.length)]];
}

/** Pillars in the shape LineOfSight expects, honouring per-pillar overrides. */
export function variantPillars(variant) {
  const v = getArenaVariant(variant?.id ?? variant);
  return v.pillars.map(p => ({ x: p.x, z: p.z, radius: p.radius ?? v.pillarRadius }));
}
