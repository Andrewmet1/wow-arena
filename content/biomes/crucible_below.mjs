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

// Piece prompts feed image-to-3D directly, the same loop the characters came
// out of: generate concept art, approve it, let the mesher build from it.
//
// The style line targets the existing character models rather than an
// independent art direction. Measured against their diffuse maps they run
// 37-53% saturation with high local detail across a ~19-hue palette — grounded
// dark fantasy with real material variation. An earlier painterly target
// measured 24% and 3 hues, which would have left the characters reading as
// stickers on a flat backdrop.
const STYLE = 'grounded dark fantasy game asset in the manner of Diablo IV, physically based '
            + 'materials, weathered volcanic basalt with iron fittings, visible wear and chipping, '
            + 'grime and soot in the crevices, rust streaks, subtle colour variation between stone, '
            + 'metal and bone so the surfaces read as different materials. Detailed sculpted relief, '
            + 'not painterly or cartoon. Neutral even studio lighting, no baked shadows, '
            + 'isolated on transparent background';

export default {
  id: 'crucible_below',
  name: 'The Crucible Below',
  prompt: 'A buried forge-temple of black basalt where forgotten kings tested the worthy.',

  // 8 world units per cell. 4 made every piece a small square and the grid
  // read as a grid; modular kits generally snap on a coarser pitch and lean on
  // fewer, larger, more detailed pieces. The player is ~2.5 units tall, so a
  // cell is about three characters wide — enough to hold composition rather
  // than a single tile of texture.
  // Walls at 14 units — about five and a half character heights. At 6 they
  // read as a lip around a floor plate rather than as enclosure; a top-down
  // camera still sees over them, but they now occlude enough to feel like a
  // room. The overhead camera is why they cannot simply be taller still.
  grid: { cell: 8, wallHeight: 14 },

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
    // Wide wall runs. A wall built only from 1x1 panels reads as a row of
    // identical panels no matter how good each one is; the assembler collapses
    // runs of the same module into these, so the rhythm varies.
    piece({
      id: 'wall_basalt_long', role: ROLES.WALL, footprint: [2, 1], height: 1.5,
      prompt: `A double-width straight wall run of stacked basalt blocks with a continuous plinth base, flat back face, ${STYLE}`,
    }),
    piece({
      id: 'wall_basalt_bay', role: ROLES.WALL, footprint: [4, 1], height: 1.5,
      prompt: `A long wall bay of basalt with a recessed centre panel and continuous plinth, flat back face, ${STYLE}`,
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
    fillerRate: 0.22,       // floor cells swapped for rubble
    pillarRate: 0.05,       // interior cells given a free-standing pillar
    trim: true,             // skirting along interior wall faces
    variantJitter: true,    // rotate/mirror tiles to break visible repetition

    // Scatter: small debris strewn across otherwise clear floor. Density alone
    // is not what reads as "dressed" — Diablo floors carry debris at several
    // sizes at once, so a single scale of prop on a clean plane still looks
    // sparse however many you add.
    scatter: { rate: 0.55, scaleRange: [0.25, 0.7], perCell: 3 },

    // Light pools. Strong local sources with real falloff and darkness between
    // them, rather than flat ambient — contrast is what gives a top-down scene
    // depth. Deliberately few: each is a real light, and the render features
    // were switched off once already to buy back frames.
    lights: {
      spacingCells: 3,        // roughly one per 24 units of wall
      color: 0xff8a4c,
      intensity: 120,
      distance: 34,           // falloff radius — darkness between pools
      height: 9,
      flicker: 0.12,
    },
  },
};
