// Content work queue.
//
// This is the whole interface for adding dungeon content: append an entry,
// run `npm run content:generate`. No new script, no copy-pasted Meshy polling,
// no hand-editing a prop pool inside DungeonEnvironment.js.
//
// `placements` is required and is what makes the asset reachable — see
// DungeonManifest.js for the vocabulary (wall, corner, center, scatter,
// cluster, ring, pillar, rubble, arch, hanging). Use `blocked:<system>` only
// for an asset that is deliberately ahead of the feature that will place it.
//
// Entries are idempotent: anything already on disk is skipped, and anything on
// disk but undeclared gets declared. Re-running is always safe.

export const PROPS = [
  // Example — this is the shape. Nothing here is generated until you pass
  // --commit, and never beyond the run's budget cap.
  // {
  //   id: 'ossuary_candle_rack',
  //   prompt: 'A weathered iron candle rack holding melted wax stubs, dark '
  //         + 'fantasy dungeon prop, PBR game asset, neutral lighting, '
  //         + 'isolated on transparent background',
  //   placements: ['wall'],
  // },
];

export const TEXTURES = [
  // { id: 'floor_obsidian_tile', prompt: '...', role: 'floor' },
];
