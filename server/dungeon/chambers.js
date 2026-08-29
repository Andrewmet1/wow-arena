// Chamber templates — each "room" in a dungeon run is now built from one or
// more chamber tiles connected by short corridors, instead of a single box.
// Templates define the chamber's footprint, monster spawn points, prop hints,
// and which sides have doorways for corridor connection.
//
// The generator picks 2-3 chambers per wing from this pool, randomizes which
// templates are picked, where they sit relative to each other, and where the
// hidden chamber attaches. So no two runs walk through the same layout even
// inside the same theme.
//
// Coordinates inside a template are local — the wing layouter offsets them
// onto the world grid when assembling the wing.

export const CHAMBER_TEMPLATES = {
  // ── Entry / corridor pieces ───────────────────────────────────────────────
  entry_hall: {
    id: 'entry_hall',
    label: 'Entry Hall',
    halfX: 16,
    halfZ: 12,
    monsterCapacity: 0,
    spawnPoints: [],
    propTags: ['banners', 'torches'],
    doorways: { north: true, east: false, south: true, west: false },
    description: 'Short opening hall just past the doorway',
  },

  corridor: {
    id: 'corridor',
    label: 'Corridor',
    halfX: 22,
    halfZ: 6,
    monsterCapacity: 1,
    spawnPoints: [{ x: 0, z: 0 }],
    propTags: ['chains', 'iron_brazier_tall'],
    doorways: { north: false, east: true, south: false, west: true },
    description: 'Narrow stone passage',
  },

  // ── Combat chambers (sized for an overhead Diablo-style camera) ──────────
  // All combat chambers bumped ~1.5× for breathing room: with 2-3 packs of 2-3
  // mobs each, you need real distance between packs so they read as separate
  // encounters rather than a giant clump. Each chamber also declares a list
  // of `coverZones` that WingLayout uses to procedurally place pillar
  // clusters, rubble piles, and ritual circles per-run, so two runs of the
  // same chamber feel different.
  octagonal_arena: {
    id: 'octagonal_arena',
    label: 'Octagonal Arena',
    halfX: 54,
    halfZ: 54,
    octagonal: true,
    monsterCapacity: 5,
    spawnPoints: [
      { x: -22, z: -22 }, { x:  22, z: -22 },
      { x: -22, z:  22 }, { x:  22, z:  22 },
      { x:   0, z:   0 },
    ],
    // Diablo-style cover hints: zones where the wing layouter can drop
    // pillar clusters / rubble / ritual circles. Random selection + jitter
    // ensures no two runs land them in the same spots.
    coverZones: [
      { kind: 'pillar_cluster', x: -28, z: -10, radius: 8 },
      { kind: 'pillar_cluster', x:  28, z:  10, radius: 8 },
      { kind: 'rubble_pile',    x:   0, z: -32, radius: 6 },
      { kind: 'rubble_pile',    x:   0, z:  32, radius: 6 },
      { kind: 'ritual_circle',  x: -12, z:  12, radius: 5 },
      { kind: 'broken_arch',    x:  18, z: -20, radius: 6 },
    ],
    propTags: ['broken_pillar', 'rune_pillar', 'bone_pile', 'brazier'],
    doorways: { north: true, east: true, south: true, west: true },
    description: 'Eight-sided pit ringed by pillars and rubble',
  },

  pillar_gauntlet: {
    id: 'pillar_gauntlet',
    label: 'Pillar Gauntlet',
    halfX: 64,
    halfZ: 30,
    monsterCapacity: 5,
    spawnPoints: [
      { x: -32, z: -10 }, { x: -32, z:  10 },
      { x:   0, z: -10 }, { x:   0, z:  10 },
      { x:  26, z:   0 },
    ],
    pillarRows: [
      { x: -38, zs: [-16, 16] },
      { x: -14, zs: [-16, 16] },
      { x:  12, zs: [-16, 16] },
      { x:  36, zs: [-16, 16] },
    ],
    coverZones: [
      { kind: 'pillar_cluster', x: -26, z:  0, radius: 6 },
      { kind: 'pillar_cluster', x:  24, z:  0, radius: 6 },
      { kind: 'rubble_pile',    x:   0, z: -22, radius: 5 },
      { kind: 'rubble_pile',    x:   0, z:  22, radius: 5 },
      { kind: 'broken_arch',    x: -42, z:  0,  radius: 5 },
      { kind: 'broken_arch',    x:  42, z:  0,  radius: 5 },
    ],
    propTags: ['rune_pillar', 'iron_chains', 'fallen_banner'],
    doorways: { north: false, east: true, south: false, west: true },
    description: 'Long hall, rows of pillars carving cover lanes',
  },

  ossuary: {
    id: 'ossuary',
    label: 'Ossuary',
    halfX: 48,
    halfZ: 42,
    monsterCapacity: 4,
    spawnPoints: [
      { x:   0, z: -16 },
      { x: -18, z:  10 },
      { x:  18, z:  10 },
      { x:   0, z:  20 },
    ],
    coverZones: [
      { kind: 'pillar_cluster', x: -22, z: -18, radius: 7 },
      { kind: 'pillar_cluster', x:  22, z: -18, radius: 7 },
      { kind: 'rubble_pile',    x:   0, z:  -2, radius: 6 },
      { kind: 'rubble_pile',    x: -24, z:  20, radius: 5 },
      { kind: 'rubble_pile',    x:  24, z:  20, radius: 5 },
      { kind: 'broken_arch',    x:   0, z:  32, radius: 6 },
    ],
    propTags: ['skull_stack', 'skull_idol', 'bone_pile', 'burial_urn'],
    wallTexture: 'wall_bone',
    floorTexture: 'floor_bone_dust',
    doorways: { north: true, east: false, south: true, west: true },
    description: 'Walls stacked floor-to-ceiling with skulls',
  },

  ritual_pit: {
    id: 'ritual_pit',
    label: 'Ritual Pit',
    halfX: 52,
    halfZ: 52,
    pitDepth: 1.5,
    pitRadius: 20,
    monsterCapacity: 4,
    spawnPoints: [
      { x: -22, z: -22 }, { x:  22, z:  22 },
      { x:  22, z: -22 }, { x: -22, z:  22 },
    ],
    coverZones: [
      { kind: 'pillar_cluster', x: -32, z:   0, radius: 6 },
      { kind: 'pillar_cluster', x:  32, z:   0, radius: 6 },
      { kind: 'pillar_cluster', x:   0, z: -32, radius: 6 },
      { kind: 'pillar_cluster', x:   0, z:  32, radius: 6 },
      { kind: 'ritual_circle',  x:   0, z:   0, radius: 12 },
    ],
    propTags: ['ritual_circle_large', 'rune_pillar', 'ember_pool'],
    wallTexture: 'wall_obsidian',
    floorTexture: 'floor_ritual',
    doorways: { north: true, east: true, south: false, west: true },
    description: 'Sunken obsidian floor with a glowing sigil',
  },

  collapsed_chapel: {
    id: 'collapsed_chapel',
    label: 'Collapsed Chapel',
    halfX: 60,
    halfZ: 36,
    monsterCapacity: 5,
    spawnPoints: [
      { x: -24, z: -10 }, { x: -24, z:  10 },
      { x:  24, z: -10 }, { x:  24, z:  10 },
      { x:   0, z:   0 },
    ],
    coverZones: [
      { kind: 'pillar_cluster', x: -38, z: -16, radius: 7 },
      { kind: 'pillar_cluster', x:  38, z:  16, radius: 7 },
      { kind: 'rubble_pile',    x: -38, z:  16, radius: 6 },
      { kind: 'rubble_pile',    x:  38, z: -16, radius: 6 },
      { kind: 'broken_arch',    x:   0, z: -24, radius: 7 },
      { kind: 'broken_arch',    x:   0, z:  24, radius: 7 },
      { kind: 'ritual_circle',  x:   0, z:   0, radius: 6 },
    ],
    propTags: ['stone_altar', 'broken_pillar', 'pew_broken', 'collapsed_archway'],
    wallTexture: 'wall_chapel',
    floorTexture: 'floor_chapel',
    doorways: { north: false, east: true, south: false, west: true },
    description: 'A toppled cathedral with a half-buried altar',
  },

  long_hall_crypt: {
    id: 'long_hall_crypt',
    label: 'Crypt Hall',
    halfX: 70,
    halfZ: 24,
    monsterCapacity: 5,
    spawnPoints: [
      { x: -36, z: 0 }, { x: -12, z: 0 }, { x: 12, z: 0 }, { x: 36, z: 0 },
      { x: 0, z: 8 },
    ],
    sideAlcoves: [
      { x: -28, z:  10, halfX: 4, halfZ: 3 }, { x: -28, z: -10, halfX: 4, halfZ: 3 },
      { x:  -8, z:  10, halfX: 4, halfZ: 3 }, { x:  -8, z: -10, halfX: 4, halfZ: 3 },
      { x:   8, z:  10, halfX: 4, halfZ: 3 }, { x:   8, z: -10, halfX: 4, halfZ: 3 },
      { x:  28, z:  10, halfX: 4, halfZ: 3 }, { x:  28, z: -10, halfX: 4, halfZ: 3 },
    ],
    coverZones: [
      { kind: 'pillar_cluster', x: -50, z:  0, radius: 5 },
      { kind: 'pillar_cluster', x: -22, z:  0, radius: 5 },
      { kind: 'pillar_cluster', x:  22, z:  0, radius: 5 },
      { kind: 'pillar_cluster', x:  50, z:  0, radius: 5 },
      { kind: 'rubble_pile',    x:   0, z:  16, radius: 4 },
      { kind: 'rubble_pile',    x:   0, z: -16, radius: 4 },
      { kind: 'broken_arch',    x: -60, z:  0, radius: 5 },
      { kind: 'broken_arch',    x:  60, z:  0, radius: 5 },
    ],
    propTags: ['sarcophagus', 'hanging_cage', 'iron_brazier_tall', 'iron_chains'],
    wallTexture: 'wall_crypt',
    floorTexture: 'floor_crypt',
    doorways: { north: false, east: true, south: false, west: true },
    description: 'A long burial hall with grave-niche alcoves',
  },

  // ── Reward / interactive chambers ────────────────────────────────────────
  reliquary: {
    id: 'reliquary',
    label: 'Hidden Reliquary',
    halfX: 14,
    halfZ: 12,
    monsterCapacity: 0,
    spawnPoints: [],
    chestSpawn: { x: 0, z: 0, type: 'rare' },
    propTags: ['treasure_chest_open', 'skull_idol', 'rune_pillar'],
    wallTexture: 'wall_chapel',
    floorTexture: 'floor_chapel',
    doorways: { north: false, east: false, south: true, west: false },
    description: 'Hidden chamber with a glowing chest',
    hidden: true,
  },

  alcove_small: {
    id: 'alcove_small',
    label: 'Side Alcove',
    halfX: 8,
    halfZ: 7,
    monsterCapacity: 0,
    spawnPoints: [],
    propTags: ['sarcophagus', 'burial_urn', 'iron_chains'],
    doorways: { north: false, east: false, south: false, west: false },
    description: 'Small side pod off the main chamber',
  },

  treasure_alcove: {
    id: 'treasure_alcove',
    label: 'Treasure Alcove',
    halfX: 12,
    halfZ: 10,
    monsterCapacity: 0,
    spawnPoints: [],
    chestSpawn: { x: 0, z: 0, type: 'common' },
    propTags: ['treasure_chest_locked', 'burial_urn'],
    doorways: { north: false, east: false, south: true, west: false },
    description: 'Side chamber with a chest',
  },

  // ── Boss chamber — much larger + visually distinct ───────────────────────
  boss_throne: {
    id: 'boss_throne',
    label: 'Throne of Ash',
    halfX: 70,
    halfZ: 56,
    monsterCapacity: 1,
    spawnPoints: [{ x: 22, z: 0 }],
    propTags: ['ritual_circle_large', 'fallen_banner', 'broken_pillar', 'iron_chains', 'skull_idol', 'iron_brazier_tall', 'stone_altar'],
    wallTexture: 'wall_runic',
    floorTexture: 'floor_runic',
    doorways: { north: false, east: false, south: true, west: true },
    isBoss: true,
    description: 'Massive cathedral-throne room — much bigger than any other chamber, lit only by the throne shaft and a corridor of red braziers.',
  },
};

// Legal chamber pools per theme (currently only crucible_below; future themes
// will reference different sets). Combat = trash/elite encounters, accent =
// non-combat flavor inserted between, hidden = optional reward chamber.
export const THEME_CHAMBER_POOLS = {
  crucible_below: {
    combat: ['octagonal_arena', 'pillar_gauntlet', 'ossuary', 'ritual_pit', 'collapsed_chapel', 'long_hall_crypt'],
    accent: ['treasure_alcove'],
    hidden: ['reliquary'],
    boss: 'boss_throne',
  },
};

export function getChamber(id) {
  return CHAMBER_TEMPLATES[id] || null;
}
