// Crucible Below — the existing dungeon, expressed as a biome.
//
// Written first because a format proves nothing until it can describe something
// that already exists. Everything the greybox does implicitly (stone floors,
// six-unit walls, torch-lit amber gloom) becomes explicit data here, so the
// same assembler that builds this can build a forest or a derelict station from
// a file that differs only in its contents.
//
// Prompts describe a single tiling piece, not a scene: the generator makes one
// mesh per entry and the assembler repeats it, so anything that reads as
// "a room" in a prompt produces a piece that cannot tile.

import { piece, ROLES } from '../../src/rendering/env/KitSchema.js';

const STYLE = 'dark fantasy dungeon, weathered volcanic basalt and iron, '
            + 'grime in the crevices, PBR game asset, neutral even lighting, '
            + 'no baked shadows, isolated on transparent background';

export default {
  id: 'crucible_below',
  name: 'The Crucible Below',
  prompt: 'A buried forge-temple of black basalt where forgotten kings tested the worthy.',

  // 4 world units per cell. The player is ~2.5 units tall, so a cell is a
  // little wider than a character — fine enough that floor detail reads at the
  // overhead gameplay camera instead of spanning three player-widths.
  grid: { cell: 4, wallHeight: 6 },

  atmosphere: {
    ambientColor: 0x2a1410, ambientIntensity: 0.25,
    fogColor: 0x1a0a08, fogDensity: 0.018,
    keyColor: 0xff7a44, keyIntensity: 1.2,
    groundTint: 0x3a1a14, bloomStrength: 0.9,
  },

  kit: [
    piece({
      id: 'floor_basalt', role: ROLES.FLOOR, footprint: [1, 1],
      variants: ['floor_basalt_b', 'floor_basalt_cracked'],
      prompt: `A single square floor tile of fitted basalt slabs with deep mortar channels, ${STYLE}`,
    }),
    piece({
      id: 'floor_rubble', role: ROLES.FILLER, footprint: [1, 1],
      prompt: `A square floor tile buried under broken stone and grit, raised debris, ${STYLE}`,
    }),
    piece({
      id: 'wall_basalt', role: ROLES.WALL, footprint: [1, 1], height: 1.5,
      variants: ['wall_basalt_damaged'],
      prompt: `A straight wall segment of stacked basalt blocks with a heavy plinth base and chipped upper edge, flat back face, ${STYLE}`,
    }),
    piece({
      id: 'wall_corner_basalt', role: ROLES.CORNER, footprint: [1, 1], height: 1.5,
      prompt: `An L-shaped outer corner wall block of basalt with a plinth base, two finished faces, ${STYLE}`,
    }),
    piece({
      id: 'doorway_arch', role: ROLES.DOORWAY, footprint: [1, 1], height: 1.5,
      prompt: `A wall segment pierced by a tall pointed archway with a carved keystone, opening clear through, ${STYLE}`,
    }),
    piece({
      id: 'pillar_forge', role: ROLES.PILLAR, footprint: [1, 1], height: 2,
      variants: ['pillar_forge_broken'],
      prompt: `A free-standing square pillar of basalt with a moulded base and capital, soot-stained, ${STYLE}`,
    }),
    piece({
      id: 'stair_run', role: ROLES.STAIR, footprint: [1, 2], height: 1,
      prompt: `A short straight flight of worn stone steps rising one storey, open sides, ${STYLE}`,
    }),
    piece({
      id: 'trim_base', role: ROLES.TRIM, footprint: [1, 1],
      prompt: `A low skirting trim strip where wall meets floor, moulded stone with accumulated grit, ${STYLE}`,
    }),
  ],

  // Assembly rules. Rates are per eligible cell, resolved with the wing seed so
  // a given seed always produces the same room.
  rules: {
    fillerRate: 0.10,       // floor cells swapped for rubble
    pillarRate: 0.05,       // interior cells given a free-standing pillar
    trim: true,             // skirting along interior wall faces
    variantJitter: true,    // rotate/mirror tiles to break visible repetition
  },
};
