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
export function piece({ id, role, footprint = [1, 1], height = 1, variants = [], prompt, tags = [] }) {
  if (!id) throw new Error('kit piece needs an id');
  if (!Object.values(ROLES).includes(role)) throw new Error(`unknown role "${role}" on ${id}`);
  return { id, role, footprint, height, variants, prompt, tags };
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
