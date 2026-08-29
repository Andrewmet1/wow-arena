/**
 * ChamberLayouts.js — hand-authored per-chamber-template furniture + lighting.
 *
 * Each chamber template (octagonal_arena, pillar_gauntlet, ossuary, etc.)
 * gets a specific scene layout: known prop positions, known light setup.
 * The dungeon renderer prefers these over random scatter when a template
 * has an authored layout.
 *
 * Coordinates are RELATIVE to chamber center (cx, cz). Add chamber.cx/cz
 * to get world coords at render time. rotY in radians.
 *
 * Each piece:
 *   { tag: 'meshy_glb_name', x, z, rotY, scale, y? }
 *
 * Lighting recipe:
 *   {
 *     ambient: { color, intensity },
 *     accents: [{ color, intensity, x, y, z, range, kind: 'point' | 'spot' }],
 *   }
 */

export const CHAMBER_LAYOUTS = {

  // ── octagonal_arena ──────────────────────────────────────────────────
  // "Eight-sided pit ringed by pillars and rubble." Centered ritual circle
  // with 8 ringing pillars + 4 corner braziers + sarcophagi at N/S/E/W
  // pointing inward.
  octagonal_arena: {
    pieces: [
      // 8 ringing pillars
      { tag: 'pillar_intact',    x: -32, z: -32, rotY: 0,     scale: 2.0 },
      { tag: 'pillar_intact',    x:  32, z: -32, rotY: 0,     scale: 2.0 },
      { tag: 'pillar_intact',    x:  32, z:  32, rotY: 0,     scale: 2.0 },
      { tag: 'pillar_intact',    x: -32, z:  32, rotY: 0,     scale: 2.0 },
      { tag: 'pillar_crumbling', x: -38, z:   0, rotY: 0,     scale: 2.0 },
      { tag: 'pillar_crumbling', x:  38, z:   0, rotY: 0,     scale: 2.0 },
      { tag: 'pillar_crumbling', x:   0, z: -38, rotY: 0,     scale: 2.0 },
      { tag: 'pillar_crumbling', x:   0, z:  38, rotY: 0,     scale: 2.0 },
      // Center ritual circle (on the floor)
      { tag: 'ritual_circle_large', x: 0, z: 0, rotY: 0, scale: 1.6 },
      // 4 corner braziers, INSIDE the pillar ring
      { tag: 'iron_brazier_tall', x: -22, z: -22, rotY: 0, scale: 1.4 },
      { tag: 'iron_brazier_tall', x:  22, z: -22, rotY: 0, scale: 1.4 },
      { tag: 'iron_brazier_tall', x:  22, z:  22, rotY: 0, scale: 1.4 },
      { tag: 'iron_brazier_tall', x: -22, z:  22, rotY: 0, scale: 1.4 },
      // Sarcophagi against the cardinal walls
      { tag: 'sarcophagus', x: -48, z:   0, rotY: Math.PI / 2,  scale: 1.4 },
      { tag: 'sarcophagus', x:  48, z:   0, rotY: -Math.PI / 2, scale: 1.4 },
      { tag: 'sarcophagus', x:   0, z: -48, rotY: 0,            scale: 1.4 },
      { tag: 'sarcophagus', x:   0, z:  48, rotY: Math.PI,      scale: 1.4 },
      // Bone piles + ash piles for clutter
      { tag: 'bone_pile',  x: -14, z: -30, rotY: 0.7, scale: 1.0 },
      { tag: 'skull_stack', x:  14, z:  30, rotY: 1.2, scale: 1.0 },
      { tag: 'ash_pile',   x:  30, z: -14, rotY: 2.1, scale: 0.9 },
    ],
    lighting: {
      ambient: { color: 0xd0c0a0, intensity: 0.45 },
      accents: [
        // 4 warm pool-of-light lights at the brazier positions
        { kind: 'point', color: 0xff8844, intensity: 2.0, x: -22, y: 4, z: -22, range: 16 },
        { kind: 'point', color: 0xff8844, intensity: 2.0, x:  22, y: 4, z: -22, range: 16 },
        { kind: 'point', color: 0xff8844, intensity: 2.0, x:  22, y: 4, z:  22, range: 16 },
        { kind: 'point', color: 0xff8844, intensity: 2.0, x: -22, y: 4, z:  22, range: 16 },
        // Center red sigil glow
        { kind: 'point', color: 0xff3322, intensity: 1.6, x: 0, y: 0.5, z: 0, range: 12 },
      ],
    },
  },

  // ── pillar_gauntlet ──────────────────────────────────────────────────
  // "Long hall, rows of pillars carving cover lanes." 4 rows of paired
  // pillars + iron chains between them + braziers at the ends.
  pillar_gauntlet: {
    pieces: [
      // 4 rows × 2 pillars (mirroring pillarRows in chambers.js)
      { tag: 'rune_pillar',     x: -38, z: -16, rotY: 0, scale: 2.0 },
      { tag: 'rune_pillar',     x: -38, z:  16, rotY: 0, scale: 2.0 },
      { tag: 'rune_pillar',     x: -14, z: -16, rotY: 0, scale: 2.0 },
      { tag: 'rune_pillar',     x: -14, z:  16, rotY: 0, scale: 2.0 },
      { tag: 'rune_pillar',     x:  12, z: -16, rotY: 0, scale: 2.0 },
      { tag: 'rune_pillar',     x:  12, z:  16, rotY: 0, scale: 2.0 },
      { tag: 'rune_pillar',     x:  36, z: -16, rotY: 0, scale: 2.0 },
      { tag: 'rune_pillar',     x:  36, z:  16, rotY: 0, scale: 2.0 },
      // Braziers at the long ends
      { tag: 'iron_brazier_tall', x: -56, z: -12, rotY: 0, scale: 1.3 },
      { tag: 'iron_brazier_tall', x: -56, z:  12, rotY: 0, scale: 1.3 },
      { tag: 'iron_brazier_tall', x:  56, z: -12, rotY: 0, scale: 1.3 },
      { tag: 'iron_brazier_tall', x:  56, z:  12, rotY: 0, scale: 1.3 },
      // Fallen banners on the long walls
      { tag: 'fallen_banner', x: -50, z: -28, rotY: 0,       scale: 1.2 },
      { tag: 'fallen_banner', x:   0, z: -28, rotY: 0,       scale: 1.2 },
      { tag: 'fallen_banner', x:  50, z: -28, rotY: 0,       scale: 1.2 },
      { tag: 'fallen_banner', x: -50, z:  28, rotY: Math.PI, scale: 1.2 },
      { tag: 'fallen_banner', x:   0, z:  28, rotY: Math.PI, scale: 1.2 },
      { tag: 'fallen_banner', x:  50, z:  28, rotY: Math.PI, scale: 1.2 },
      // Iron chains hanging between pillars
      { tag: 'iron_chains', x: -26, z: 0, rotY: 0, scale: 1.0 },
      { tag: 'iron_chains', x:  -2, z: 0, rotY: 0, scale: 1.0 },
      { tag: 'iron_chains', x:  24, z: 0, rotY: 0, scale: 1.0 },
      // Rubble clutter
      { tag: 'rubble_pile', x: -50, z:   0, rotY: 0.3, scale: 1.1 },
      { tag: 'rubble_pile', x:  50, z:   0, rotY: 1.8, scale: 1.1 },
    ],
    lighting: {
      ambient: { color: 0xc8c8d0, intensity: 0.4 },
      accents: [
        { kind: 'point', color: 0xff7044, intensity: 2.4, x: -56, y: 4, z: 0, range: 22 },
        { kind: 'point', color: 0xff7044, intensity: 2.4, x:  56, y: 4, z: 0, range: 22 },
        { kind: 'point', color: 0xffae50, intensity: 1.1, x: -26, y: 5, z: 0, range: 12 },
        { kind: 'point', color: 0xffae50, intensity: 1.1, x:  -2, y: 5, z: 0, range: 12 },
        { kind: 'point', color: 0xffae50, intensity: 1.1, x:  24, y: 5, z: 0, range: 12 },
      ],
    },
  },

  // ── ossuary ──────────────────────────────────────────────────────────
  // "Walls stacked floor-to-ceiling with skulls." Bone throne in center,
  // skull stacks lining the walls, bone piles + burial urns scattered.
  ossuary: {
    pieces: [
      // Center: bone throne
      { tag: 'ossuary_bone_throne', x: 0, z: 8, rotY: 0, scale: 1.6 },
      // 8 skull stacks lining the walls
      { tag: 'skull_stack', x: -42, z: -30, rotY: Math.PI / 2,  scale: 1.3 },
      { tag: 'skull_stack', x: -42, z:   0, rotY: Math.PI / 2,  scale: 1.3 },
      { tag: 'skull_stack', x: -42, z:  30, rotY: Math.PI / 2,  scale: 1.3 },
      { tag: 'skull_stack', x:  42, z: -30, rotY: -Math.PI / 2, scale: 1.3 },
      { tag: 'skull_stack', x:  42, z:   0, rotY: -Math.PI / 2, scale: 1.3 },
      { tag: 'skull_stack', x:  42, z:  30, rotY: -Math.PI / 2, scale: 1.3 },
      { tag: 'skull_stack', x: -20, z: -36, rotY: 0,            scale: 1.3 },
      { tag: 'skull_stack', x:  20, z: -36, rotY: 0,            scale: 1.3 },
      // Skull pyramid as a secondary landmark
      { tag: 'skull_pyramid', x: -16, z: -10, rotY: 0.5, scale: 1.4 },
      { tag: 'skull_pyramid', x:  16, z: -10, rotY: -0.5, scale: 1.4 },
      // Bone piles scattered
      { tag: 'bone_pile', x: -10, z: 14, rotY: 0.4, scale: 1.0 },
      { tag: 'bone_pile', x:  10, z: 14, rotY: 1.2, scale: 1.0 },
      { tag: 'bone_pile', x:   0, z: 28, rotY: 0,   scale: 1.1 },
      // Burial urns
      { tag: 'burial_urn', x: -24, z:  24, rotY: 0,  scale: 1.0 },
      { tag: 'burial_urn', x:  24, z:  24, rotY: 0,  scale: 1.0 },
      // Hanging cages
      { tag: 'hanging_cage_skeleton', x: -36, z:  14, rotY: 0, scale: 1.3, y: 4 },
      { tag: 'hanging_cage_skeleton', x:  36, z:  14, rotY: 0, scale: 1.3, y: 4 },
      // Candelabra flanking the throne
      { tag: 'candelabrum_tall', x: -6, z: 10, rotY: 0, scale: 1.4 },
      { tag: 'candelabrum_tall', x:  6, z: 10, rotY: 0, scale: 1.4 },
    ],
    lighting: {
      ambient: { color: 0xa8b0c0, intensity: 0.55 }, // cold pale blue
      accents: [
        // Cold blue uplight on the throne
        { kind: 'point', color: 0x6688cc, intensity: 1.5, x: 0, y: 1, z: 8, range: 18 },
        // Pale wall lights
        { kind: 'point', color: 0xa8b0c0, intensity: 0.9, x: -40, y: 4, z: 0, range: 14 },
        { kind: 'point', color: 0xa8b0c0, intensity: 0.9, x:  40, y: 4, z: 0, range: 14 },
        // Warm candelabra accent (small range)
        { kind: 'point', color: 0xffd070, intensity: 1.3, x: -6, y: 4, z: 10, range: 8 },
        { kind: 'point', color: 0xffd070, intensity: 1.3, x:  6, y: 4, z: 10, range: 8 },
      ],
    },
  },

  // ── ritual_pit ───────────────────────────────────────────────────────
  // "Sunken obsidian floor with a glowing sigil." Center ember pool +
  // 4 cardinal rune pillars + minimal clutter (it's a clean ritual space).
  ritual_pit: {
    pieces: [
      // Center: ember pool sigil
      { tag: 'ember_pool', x: 0, z: 0, rotY: 0, scale: 2.2 },
      // 4 cardinal rune pillars
      { tag: 'rune_pillar', x:   0, z: -36, rotY: 0,            scale: 2.4 },
      { tag: 'rune_pillar', x:   0, z:  36, rotY: 0,            scale: 2.4 },
      { tag: 'rune_pillar', x: -36, z:   0, rotY: 0,            scale: 2.4 },
      { tag: 'rune_pillar', x:  36, z:   0, rotY: 0,            scale: 2.4 },
      // 4 diagonal broken pillars (the ritual collapsed in the past)
      { tag: 'broken_pillar', x: -28, z: -28, rotY: 0.4, scale: 1.4 },
      { tag: 'broken_pillar', x:  28, z: -28, rotY: 1.1, scale: 1.4 },
      { tag: 'broken_pillar', x:  28, z:  28, rotY: 2.0, scale: 1.4 },
      { tag: 'broken_pillar', x: -28, z:  28, rotY: 2.9, scale: 1.4 },
      // Iron braziers between pillars
      { tag: 'iron_brazier_tall', x: -18, z: -18, rotY: 0, scale: 1.3 },
      { tag: 'iron_brazier_tall', x:  18, z: -18, rotY: 0, scale: 1.3 },
      { tag: 'iron_brazier_tall', x:  18, z:  18, rotY: 0, scale: 1.3 },
      { tag: 'iron_brazier_tall', x: -18, z:  18, rotY: 0, scale: 1.3 },
      // Skeletal remains (the ritual claimed someone)
      { tag: 'skeletal_remains_clutching', x: -10, z: -8, rotY: 1.2, scale: 1.0 },
    ],
    lighting: {
      ambient: { color: 0x402030, intensity: 0.3 }, // deep red ambient
      accents: [
        // Pulsing red center sigil
        { kind: 'point', color: 0xff2010, intensity: 4.0, x: 0, y: 1, z: 0, range: 22 },
        // 4 rune pillar accent lights
        { kind: 'point', color: 0xff6622, intensity: 1.5, x:   0, y: 4, z: -36, range: 12 },
        { kind: 'point', color: 0xff6622, intensity: 1.5, x:   0, y: 4, z:  36, range: 12 },
        { kind: 'point', color: 0xff6622, intensity: 1.5, x: -36, y: 4, z:   0, range: 12 },
        { kind: 'point', color: 0xff6622, intensity: 1.5, x:  36, y: 4, z:   0, range: 12 },
      ],
    },
  },

  // ── collapsed_chapel ──────────────────────────────────────────────────
  // "A toppled cathedral with a half-buried altar." Altar at back wall,
  // pew rows facing it, collapsed archways, candelabra flanking.
  collapsed_chapel: {
    pieces: [
      // Stone altar — back wall (north side)
      { tag: 'stone_altar', x: 0, z: 28, rotY: 0, scale: 1.8 },
      // Candelabra flanking the altar
      { tag: 'candelabrum_tall', x: -8, z: 28, rotY: 0, scale: 1.5 },
      { tag: 'candelabrum_tall', x:  8, z: 28, rotY: 0, scale: 1.5 },
      // 3 rows of broken pews facing the altar (i.e., facing +Z)
      { tag: 'pew_broken', x: -18, z: 14, rotY: 0, scale: 1.3 },
      { tag: 'pew_broken', x:  -6, z: 14, rotY: 0, scale: 1.3 },
      { tag: 'pew_broken', x:   6, z: 14, rotY: 0, scale: 1.3 },
      { tag: 'pew_broken', x:  18, z: 14, rotY: 0, scale: 1.3 },
      { tag: 'pew_broken', x: -18, z:  0, rotY: 0, scale: 1.3 },
      { tag: 'pew_broken', x:  -6, z:  0, rotY: 0, scale: 1.3 },
      { tag: 'pew_broken', x:   6, z:  0, rotY: 0, scale: 1.3 },
      { tag: 'pew_broken', x:  18, z:  0, rotY: 0, scale: 1.3 },
      { tag: 'pew_broken', x: -18, z: -14, rotY: 0, scale: 1.3 },
      { tag: 'pew_broken', x:  -6, z: -14, rotY: 0, scale: 1.3 },
      { tag: 'pew_broken', x:   6, z: -14, rotY: 0, scale: 1.3 },
      { tag: 'pew_broken', x:  18, z: -14, rotY: 0, scale: 1.3 },
      // Collapsed archways at the side walls
      { tag: 'collapsed_archway', x: -50, z:  10, rotY: Math.PI / 2,  scale: 1.6 },
      { tag: 'collapsed_archway', x:  50, z: -10, rotY: -Math.PI / 2, scale: 1.6 },
      // Family banners on the back wall flanking the altar
      { tag: 'family_banner_purple', x: -16, z: 32, rotY: 0, scale: 1.3 },
      { tag: 'family_banner_red',    x:  16, z: 32, rotY: 0, scale: 1.3 },
      // Guardian statues kneeling toward altar
      { tag: 'guardian_statue_kneeling', x: -12, z: 22, rotY: 0,      scale: 1.5 },
      { tag: 'guardian_statue_kneeling', x:  12, z: 22, rotY: 0,      scale: 1.5 },
      // Rubble at corners (chapel is collapsed)
      { tag: 'rubble_pile', x: -50, z: -28, rotY: 0.6, scale: 1.4 },
      { tag: 'rubble_pile', x:  50, z:  28, rotY: 1.8, scale: 1.4 },
      // Hanging lantern (replaced — no ceiling, use floor-mounted iron brazier instead)
      { tag: 'iron_brazier_tall', x: 0, z: -28, rotY: 0, scale: 1.2 },
    ],
    lighting: {
      ambient: { color: 0xc0b090, intensity: 0.5 },
      accents: [
        // Warm gold over the altar — the worship pool of light
        { kind: 'point', color: 0xffd070, intensity: 3.5, x: 0, y: 6, z: 26, range: 24 },
        // Cold rim from the back (the collapsed roof)
        { kind: 'point', color: 0x6688aa, intensity: 0.8, x: 0, y: 8, z: -30, range: 30 },
        // Candelabra flanking
        { kind: 'point', color: 0xffae50, intensity: 1.2, x: -8, y: 4, z: 28, range: 8 },
        { kind: 'point', color: 0xffae50, intensity: 1.2, x:  8, y: 4, z: 28, range: 8 },
      ],
    },
  },

  // ── long_hall_crypt ──────────────────────────────────────────────────
  // "A long burial hall with grave-niche alcoves." Sarcophagi in each
  // alcove + iron braziers at corners + hanging cages.
  long_hall_crypt: {
    pieces: [
      // 8 sarcophagi (matching the sideAlcoves in chambers.js)
      { tag: 'sarcophagus', x: -28, z:  10, rotY: 0,       scale: 1.4 },
      { tag: 'sarcophagus', x: -28, z: -10, rotY: Math.PI, scale: 1.4 },
      { tag: 'sarcophagus', x:  -8, z:  10, rotY: 0,       scale: 1.4 },
      { tag: 'sarcophagus', x:  -8, z: -10, rotY: Math.PI, scale: 1.4 },
      { tag: 'sarcophagus', x:   8, z:  10, rotY: 0,       scale: 1.4 },
      { tag: 'sarcophagus', x:   8, z: -10, rotY: Math.PI, scale: 1.4 },
      { tag: 'sarcophagus', x:  28, z:  10, rotY: 0,       scale: 1.4 },
      { tag: 'sarcophagus', x:  28, z: -10, rotY: Math.PI, scale: 1.4 },
      // Iron braziers at the 4 corners
      { tag: 'iron_brazier_tall', x: -60, z: -18, rotY: 0, scale: 1.3 },
      { tag: 'iron_brazier_tall', x:  60, z: -18, rotY: 0, scale: 1.3 },
      { tag: 'iron_brazier_tall', x: -60, z:  18, rotY: 0, scale: 1.3 },
      { tag: 'iron_brazier_tall', x:  60, z:  18, rotY: 0, scale: 1.3 },
      // Hanging cages at 1/3 spans
      { tag: 'hanging_cage_skeleton', x: -42, z: 0, rotY: 0, scale: 1.3, y: 4 },
      { tag: 'hanging_cage',          x:  42, z: 0, rotY: 0, scale: 1.3, y: 4 },
      // Iron chains hanging from various points
      { tag: 'iron_chains', x: -50, z:  16, rotY: 0, scale: 1.0 },
      { tag: 'iron_chains', x:  50, z: -16, rotY: 0, scale: 1.0 },
      // Bone piles in some alcoves
      { tag: 'bone_pile', x: -28, z:  16, rotY: 0, scale: 0.9 },
      { tag: 'bone_pile', x:  28, z: -16, rotY: 0, scale: 0.9 },
    ],
    lighting: {
      ambient: { color: 0x9098a8, intensity: 0.4 },
      accents: [
        // Warm corner braziers
        { kind: 'point', color: 0xff8844, intensity: 1.8, x: -60, y: 4, z: -18, range: 18 },
        { kind: 'point', color: 0xff8844, intensity: 1.8, x:  60, y: 4, z: -18, range: 18 },
        { kind: 'point', color: 0xff8844, intensity: 1.8, x: -60, y: 4, z:  18, range: 18 },
        { kind: 'point', color: 0xff8844, intensity: 1.8, x:  60, y: 4, z:  18, range: 18 },
        // Cold rim from above the central hall
        { kind: 'point', color: 0x6677aa, intensity: 0.7, x: 0, y: 10, z: 0, range: 40 },
      ],
    },
  },

  // ── boss_throne ──────────────────────────────────────────────────────
  // "Massive cathedral-throne room." Throne at the back, statues flanking,
  // banner runner, ornate boss braziers.
  boss_throne: {
    pieces: [
      // Throne on a dais at the back wall
      { tag: 'throne_dais',    x: 0, z: 38, rotY: 0, scale: 2.0 },
      { tag: 'throne_massive', x: 0, z: 38, rotY: 0, scale: 1.8, y: 1.6 },
      // Flanking standing guardian statues
      { tag: 'guardian_statue_standing', x: -10, z: 38, rotY: -Math.PI / 2, scale: 1.8 },
      { tag: 'guardian_statue_standing', x:  10, z: 38, rotY:  Math.PI / 2, scale: 1.8 },
      // Boss-tier ornate braziers flanking the dais
      { tag: 'brazier_ornate_boss', x: -16, z: 28, rotY: 0, scale: 1.6 },
      { tag: 'brazier_ornate_boss', x:  16, z: 28, rotY: 0, scale: 1.6 },
      // Two more brazier pairs down the approach
      { tag: 'brazier_ornate_boss', x: -16, z:   0, rotY: 0, scale: 1.6 },
      { tag: 'brazier_ornate_boss', x:  16, z:   0, rotY: 0, scale: 1.6 },
      { tag: 'brazier_ornate_boss', x: -16, z: -28, rotY: 0, scale: 1.6 },
      { tag: 'brazier_ornate_boss', x:  16, z: -28, rotY: 0, scale: 1.6 },
      // Massive runic pillars at the back corners
      { tag: 'rune_pillar', x: -32, z:  36, rotY: 0, scale: 2.6 },
      { tag: 'rune_pillar', x:  32, z:  36, rotY: 0, scale: 2.6 },
      // Boss banner above the throne (mounted to back wall)
      { tag: 'boss_banner_large', x: 0, z: 46, rotY: 0, scale: 1.8 },
      // Skull idol pile flanking — boss imagery
      { tag: 'skull_idol', x: -22, z: 22, rotY: 0.5,  scale: 1.4 },
      { tag: 'skull_idol', x:  22, z: 22, rotY: -0.5, scale: 1.4 },
      // Iron chains hanging at the side walls
      { tag: 'iron_chains', x: -60, z: 0, rotY: 0, scale: 1.0 },
      { tag: 'iron_chains', x:  60, z: 0, rotY: 0, scale: 1.0 },
    ],
    lighting: {
      ambient: { color: 0x402020, intensity: 0.4 }, // deep red ambient
      accents: [
        // Dramatic red shaft on the throne
        { kind: 'point', color: 0xff2010, intensity: 5.0, x: 0, y: 6, z: 38, range: 28 },
        // 6 brazier ornate boss accent lights
        { kind: 'point', color: 0xff6622, intensity: 2.0, x: -16, y: 4, z: 28,  range: 14 },
        { kind: 'point', color: 0xff6622, intensity: 2.0, x:  16, y: 4, z: 28,  range: 14 },
        { kind: 'point', color: 0xff6622, intensity: 2.0, x: -16, y: 4, z:  0,  range: 14 },
        { kind: 'point', color: 0xff6622, intensity: 2.0, x:  16, y: 4, z:  0,  range: 14 },
        { kind: 'point', color: 0xff6622, intensity: 2.0, x: -16, y: 4, z: -28, range: 14 },
        { kind: 'point', color: 0xff6622, intensity: 2.0, x:  16, y: 4, z: -28, range: 14 },
        // Cold blue rim from the approach corridor
        { kind: 'point', color: 0x4466aa, intensity: 0.8, x: 0, y: 10, z: -50, range: 40 },
      ],
    },
  },

  // ── entry_hall ───────────────────────────────────────────────────────
  // Small opening room. Just a couple banners + a brazier.
  entry_hall: {
    pieces: [
      { tag: 'fallen_banner', x: -10, z: -8, rotY: 0, scale: 1.2 },
      { tag: 'fallen_banner', x:  10, z: -8, rotY: 0, scale: 1.2 },
      { tag: 'iron_brazier_tall', x: 0, z: 6, rotY: 0, scale: 1.3 },
    ],
    lighting: {
      ambient: { color: 0xc0a880, intensity: 0.6 },
      accents: [
        { kind: 'point', color: 0xff8844, intensity: 2.0, x: 0, y: 4, z: 6, range: 14 },
      ],
    },
  },
};
