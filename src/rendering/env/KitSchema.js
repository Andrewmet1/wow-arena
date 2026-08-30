// Environment kit — the contract a level is built from.
//
// The dungeon is currently a greybox: PlaneGeometry for floors, BoxGeometry for
// walls, props scattered on top. Detail painted onto primitives cannot reach
// what a modular-kit game looks like, because in those the detail lives in the
// geometry — floor sections with cast relief, wall segments with bases and
// broken edges, arches, stairs.
//
// A biome declares a KIT of such pieces plus the palette, atmosphere and rules
// for combining them. That declaration is the single source of truth: the
// generator reads it to know what to produce, and the assembler reads the same
// file to know what to place. Neither side can drift from the other, which is
// the property that stopped dungeon props going orphan.
//
// Because it is data, a prompt ("a rotted forest shrine", "a derelict orbital
// station") can be turned into a biome by writing one of these — no engine
// change per level, which is what makes new settings cheap.

/** Structural roles the assembler knows how to place. */
export const ROLES = {
  FLOOR:    'floor',     // interior ground tile
  WALL:     'wall',      // perimeter segment, faces inward
  CORNER:   'corner',    // perimeter corner
  DOORWAY:  'doorway',   // wall segment with an opening
  PILLAR:   'pillar',    // free-standing vertical support
  STAIR:    'stair',     // connects height levels
  TRIM:     'trim',      // floor/wall junction detail
  CEILING:  'ceiling',   // overhead (optional per biome)
  FILLER:   'filler',    // rubble/debris that reads as geometry, not a prop
};

/** Every role the assembler requires before a biome can build. */
export const REQUIRED_ROLES = [ROLES.FLOOR, ROLES.WALL, ROLES.CORNER];

/**
 * One kit piece.
 *
 * `footprint` is in grid cells, not world units, so a biome can change cell
 * size without every piece needing new numbers. `variants` exist because
 * repetition is what makes tiled geometry read as tiled — the assembler picks
 * among them deterministically per cell.
 */
/**
 * Edge connectors, in grid-neighbour order: north, east, south, west.
 *
 * Adjacency is what separates a level generator from a shuffle. Picking a
 * random piece per cell — which is what the first assembler did — cannot know
 * that a wall must not open onto solid rock, or that an arch needs floor on
 * both sides. Two pieces may sit next to each other only when their facing
 * sockets match, and the solver enforces that everywhere at once.
 *
 * Socket ids are arbitrary strings; equal ids mate. Reserved conventions:
 *   'open'  — walkable continuation (floor to floor)
 *   'solid' — impassable backing (wall to wall, or wall to nothing)
 *   'void'  — outside the room; only the outward faces of perimeter pieces
 */
export const DIRS = ['n', 'e', 's', 'w'];
export const OPPOSITE = { n: 's', s: 'n', e: 'w', w: 'e' };

export function piece({
  id, role, footprint = [1, 1], height = 1, variants = [], prompt, tags = [],
  sockets = null, rotatable = true, weight = null,
}) {
  if (!id) throw new Error('kit piece needs an id');
  if (!Object.values(ROLES).includes(role)) throw new Error(`unknown role "${role}" on ${id}`);
  // Sensible defaults per role so a biome need not spell out every socket:
  // floors open on all sides, walls back onto solid and open inward.
  const defaults = {
    [ROLES.FLOOR]:   { n: 'open', e: 'open', s: 'open', w: 'open' },
    [ROLES.FILLER]:  { n: 'open', e: 'open', s: 'open', w: 'open' },
    [ROLES.PILLAR]:  { n: 'open', e: 'open', s: 'open', w: 'open' },
    [ROLES.STAIR]:   { n: 'open', e: 'solid', s: 'open', w: 'solid' },
    [ROLES.WALL]:    { n: 'void', e: 'solid', s: 'open', w: 'solid' },
    [ROLES.DOORWAY]: { n: 'void', e: 'solid', s: 'open', w: 'solid' },
    // A corner's two inward faces butt against the wall runs leaving it, so
    // they carry the wall-to-wall connector. Giving them 'open' (as if they
    // faced the room) makes every corner unsatisfiable: the adjacent wall
    // presents 'solid' and nothing can mate.
    [ROLES.CORNER]:  { n: 'void', e: 'void', s: 'solid', w: 'solid' },
    [ROLES.TRIM]:    { n: 'solid', e: 'open', s: 'open', w: 'open' },   // hugs a wall on one side
    [ROLES.CEILING]: { n: 'open', e: 'open', s: 'open', w: 'open' },
  };
  // Selection weight. WFC picks uniformly among whatever remains legal, so
  // without weighting a pillar is as likely as a floor tile and a third of the
  // room fills with pillars. These defaults make plain surfaces the norm and
  // punctuation rare; a biome can override any of them.
  const defaultWeight = {
    [ROLES.FLOOR]: 10, [ROLES.WALL]: 10, [ROLES.CORNER]: 10, [ROLES.CEILING]: 10,
    [ROLES.FILLER]: 2, [ROLES.TRIM]: 4,
    [ROLES.PILLAR]: 0.6, [ROLES.DOORWAY]: 0.5, [ROLES.STAIR]: 0.3,
  };
  return {
    id, role, footprint, height, variants, prompt, tags, rotatable,
    weight: weight ?? defaultWeight[role] ?? 1,
    sockets: sockets ?? defaults[role] ?? { n: 'open', e: 'open', s: 'open', w: 'open' },
  };
}

/** Sockets after rotating a piece by `turns` quarter-turns clockwise. */
export function rotateSockets(sockets, turns) {
  const t = ((turns % 4) + 4) % 4;
  const order = ['n', 'e', 's', 'w'];
  const out = {};
  for (let i = 0; i < 4; i++) out[order[(i + t) % 4]] = sockets[order[i]];
  return out;
}

/** May `a` (rotated) sit with its `dir` side against `b` (rotated)? */
export function canMate(a, aTurns, b, bTurns, dir) {
  const sa = rotateSockets(a.sockets, aTurns)[dir];
  const sb = rotateSockets(b.sockets, bTurns)[OPPOSITE[dir]];
  return sa === sb;
}

/**
 * Validate a biome before anything tries to build or generate it.
 * Returns a list of problems; empty means usable.
 */
export function validateBiome(b) {
  const errs = [];
  if (!b?.id) errs.push('biome has no id');
  if (!b?.grid?.cell) errs.push('biome.grid.cell (world units per cell) is required');
  if (!Array.isArray(b?.kit) || !b.kit.length) errs.push('biome.kit is empty');

  const roles = new Set((b.kit || []).map(p => p.role));
  for (const r of REQUIRED_ROLES) {
    if (!roles.has(r)) errs.push(`kit is missing a "${r}" piece — the assembler cannot build without one`);
  }
  for (const p of (b.kit || [])) {
    if (!p.prompt) errs.push(`${p.id}: no prompt, so it can never be generated`);
    if (!Array.isArray(p.footprint) || p.footprint.length !== 2) errs.push(`${p.id}: footprint must be [w, d] in cells`);
  }
  if (!b?.atmosphere) errs.push('biome.atmosphere is required (drives lighting + fog)');
  return errs;
}

/** All pieces for a role, including variants, as flat ids. */
export function piecesFor(biome, role) {
  return (biome.kit || [])
    .filter(p => p.role === role)
    .flatMap(p => [p.id, ...(p.variants || [])]);
}

/** Where a kit piece's GLB lives. One rule, so generator and loader agree. */
export function kitPath(biomeId, pieceId) {
  return `/assets/models/kits/${biomeId}/${pieceId}.glb`;
}
