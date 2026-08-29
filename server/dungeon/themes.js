// Dungeon themes — each theme is a self-contained dungeon "biome" with its
// own monster pool, room labels, lighting, lore, environment, weather, and
// procedural generation params.
//
// ── Framework design ───────────────────────────────────────────────────
// Every theme overlays new visuals on the SAME wing-generation framework
// (WingLayout.js). Adding a new dungeon is just adding a theme entry —
// the chamber templates, cover system, pack distribution, loot rolls, and
// minimap all work the same way across themes.
//
// ── Design rule: one dungeon per class ─────────────────────────────────
// Every dungeon's BOSS is a corrupted echo of one of the 5 player classes,
// and that dungeon is "their domain":
//
//   crucible_below   →  TYRANT      (Ashen Warlord — first king of the Crucible)
//   bloodspire_keep  →  REVENANT    (Hollow Saint — fallen paladin)
//   frostbite_caverns →  INFERNAL   (Frostfire Magus — mage who turned to ice)
//   verdant_ruins    →  HARBINGER   (Rotbringer — necromancer who became the rot)
//   ashfall_dunes    →  WRAITH      (Dune Stalker — assassin lost to sand)
//
// The boss fight is class-flavored. Each dungeon also recruits mobs that
// thematically match.
//
// Connecting story: the Crucible was the first king's testing ground. After
// his death, his lieutenants — one per class — broke off and made domains of
// their own. To take the throne, the player must descend through all five.

import { MONSTERS } from './monsters.js';

// ─────────────────────────────────────────────────────────────────────
// Theme schema
//
// {
//   id, name, lore,
//   trashPool[], elitePool[], bossId,
//   floor: { combatRoomsMin, combatRoomsMax, eliteRoomChance, ... },
//   packSizeMin, packSizeMax,
//   rooms[], bossRoom, treasureRoom, shrineRoom, hiddenRoom,
//
//   // ── NEW framework fields ──────────────────────────────────────
//   chamberPool: { combat[], boss },     // which chamber templates to use
//   atmosphere: {                          // legacy single-fog/torch atmos
//     ambientColor, ambientIntensity, fogColor, fogDensity,
//     torchColor, torchIntensity, groundTint, bloomStrength,
//   },
//   lighting: {                            // NEW richer lighting profile
//     ambient, hemi, hemiGround, hemiIntensity,
//     fillColor, fillIntensity, rimColor, vignette,
//   },
//   weather: { type, density, lightning }, // rain/snow/ash/embers/none
//   vegetation: { density, variants[], color },
//   floor: { primary, patchTextures[], wetSheen, heightmap },
//   wall: { primary, accentTextures[], tint },
//   outerEnvironment: { cliffColor, cliffTexture, fogColor, fogVariant, propVariants[] },
//   lightCone: { color, intensity, texture },
//   propBias: { [propTag]: weight },
// }
// ─────────────────────────────────────────────────────────────────────

export const THEMES = {
  crucible_below: {
    id: 'crucible_below',
    name: 'The Crucible Below',
    lore: 'Where forgotten kings test the worthy. Each descent reshapes the halls — no two runs walk the same path.',

    trashPool: ['carrion_knight', 'bone_cultist', 'hellhound'],
    elitePool: ['drudgekin_brute', 'wraith_specter'],
    bossId: 'ashen_warlord',

    floor: {
      combatRoomsMin: 4,
      combatRoomsMax: 6,
      eliteRoomChance: 0.45,
      treasureRoomChance: 0.35,
      shrineRoomChance: 0.30,
      hiddenRoomChance: 0.20,

      // Visual floor params (NEW)
      primary: 'floor_stone',
      patchTextures: ['floor_cracked', 'floor_ashen', 'floor_blood_soaked', 'floor_bone_dust', 'floor_runic'],
      wetSheen: false,
      heightmap: 'tex_heightmap_stone',
      heightAmplitude: 0.25,
    },

    packSizeMin: 2,
    packSizeMax: 4,

    rooms: [
      { label: 'The Antechamber',        lore: 'Where the king once received his oath-bound. The benches are still polished by knees.' },
      { label: 'Whispering Halls',       lore: 'Voices in the masonry. None speaking your name yet.' },
      { label: 'Hollow Kennels',         lore: 'They were starved for a reason. They have not forgotten it.' },
      { label: 'The Forge Below',        lore: 'The smiths made weapons for a war that never came. Now they make weapons for the dead.' },
      { label: 'Bone Choir',             lore: 'Sing for them; they remember the words.' },
      { label: 'The Pit of Whispers',    lore: 'Every challenger\'s last sound, fed back to the next.' },
      { label: 'Crooked Chapel',         lore: 'The icons turned, then snapped, then watched.' },
      { label: 'Ash-Strewn Vault',       lore: 'A century of fallen kings, swept neatly into corners.' },
      { label: 'Pillar of Lament',       lore: 'Touch it and it tells you who you are about to lose.' },
      { label: 'Sundered Reliquary',     lore: 'The relics fled the cases. They are watching from the rafters.' },
      { label: 'The Last Watch',         lore: 'The captain\'s post. The candle is still burning.' },
      { label: 'Cathedral of Embers',    lore: 'Where the king crowned himself, by his own light.' },
    ],
    bossRoom:     { label: 'Throne of Ash',     lore: 'Take the crown if you can lift it. The last who tried is lifting it still.' },
    treasureRoom: { label: 'Forgotten Cache',   lore: 'Gold for the dead. They prefer it kept here.' },
    shrineRoom:   { label: 'Shrine of Old Kings', lore: 'Kneel and ask. They remember favours.' },
    hiddenRoom:   { label: 'The Sealed Chamber', lore: 'Sealed for a reason. Open for another.' },

    // Chamber pool for WingLayout
    chamberPool: {
      combat: ['octagonal_arena', 'pillar_gauntlet', 'ossuary', 'ritual_pit', 'collapsed_chapel', 'long_hall_crypt'],
      boss: 'boss_throne',
    },

    // Legacy atmosphere block (kept for arena renderer)
    atmosphere: {
      ambientColor: 0x2a1410,
      ambientIntensity: 0.25,
      fogColor: 0x1a0a08,
      fogDensity: 0.018,
      torchColor: 0xff7a44,
      torchIntensity: 1.2,
      groundTint: 0x3a1a14,
      bloomStrength: 0.9,
    },

    // Richer lighting profile (NEW)
    lighting: {
      ambient: 0x4a2818,
      hemi: 0xffd0a0,
      hemiGround: 0x080404,
      hemiIntensity: 0.28,
      fillColor: 0xffa860,
      fillIntensity: 1.6,
      rimColor: 0x4a3050,
      vignette: 0x000000,
    },

    weather: { type: 'ember', density: 1.0, lightning: false },
    vegetation: {
      density: 0.15,
      variants: ['vfx_dead_branch', 'vfx_weed_cluster', 'vfx_moss_clump'],
      color: 0x4a3a30,
    },
    wall: {
      primary: 'wall_stone',
      accentTextures: ['wall_runic_glow', 'wall_ornate_panel', 'wall_broken_relief'],
      tint: 0x988878,
    },
    outerEnvironment: {
      cliffColor: 0x1a120e,
      cliffTexture: 'wall_stone',
      fogColor: 0x4a3828,
      fogVariant: 'dense',
      propVariants: ['broken_pillar', 'rubble_pile', 'collapsed_archway'],
    },
    lightCone: { color: 0xff8844, intensity: 0.35, texture: 'vfx_light_cone_warm' },
    propBias: {
      'broken_pillar': 1.5,
      'iron_brazier_tall': 1.5,
      'skull_idol': 1.3,
      'bone_pile': 1.3,
    },
  },

  // ── Frostbite Caverns (INFERNAL boss domain) ─────────────────────
  frostbite_caverns: {
    id: 'frostbite_caverns',
    name: 'Frostbite Caverns',
    lore: 'A glacial labyrinth where ancient horrors sleep frozen — for now.',
    trashPool: ['carrion_knight', 'bone_cultist', 'wraith_specter'],
    elitePool: ['drudgekin_brute'],
    bossId: 'ashen_warlord',
    floor: {
      combatRoomsMin: 4, combatRoomsMax: 6,
      eliteRoomChance: 0.40, treasureRoomChance: 0.35,
      shrineRoomChance: 0.30, hiddenRoomChance: 0.20,
      primary: 'floor_snow_packed',
      patchTextures: ['floor_cracked', 'floor_bone_dust'],
      wetSheen: false,
      heightmap: 'tex_heightmap_stone',
      heightAmplitude: 0.20,
    },
    packSizeMin: 2, packSizeMax: 4,
    rooms: [
      { label: 'Frozen Antechamber',  lore: 'The first frost. Your breath plumes against the dark.' },
      { label: 'Icebound Stairs',     lore: 'Each step rings — and the rings echo deeper than they should.' },
      { label: 'Glacial Cathedral',   lore: 'A vault carved by water and patience.' },
      { label: 'Hall of Still Wings', lore: 'The corpses of moths the size of children.' },
      { label: 'The Last Hearth',     lore: 'Cold ash. A name carved into the bricks.' },
      { label: 'Crystal Reliquary',   lore: 'The relics are inside the ice. They watch you slowly.' },
    ],
    bossRoom:     { label: 'Throne of Black Ice', lore: 'The Frostfire Magus turned to ice when his fire ran out. He is still warm.' },
    treasureRoom: { label: 'Buried Caravan',      lore: 'A wagon, perfectly preserved. The horses, too.' },
    shrineRoom:   { label: 'Cairn of the Lost',   lore: 'Climbers who never came home. Their prayers are still here.' },
    hiddenRoom:   { label: 'The Sunken Lake',     lore: 'Don\'t look down.' },
    chamberPool: {
      combat: ['octagonal_arena', 'pillar_gauntlet', 'ossuary', 'long_hall_crypt'],
      boss: 'boss_throne',
    },
    atmosphere: {
      ambientColor: 0x182838, ambientIntensity: 0.40,
      fogColor: 0x405068, fogDensity: 0.022,
      torchColor: 0x8aaaff, torchIntensity: 1.0,
      groundTint: 0x405068, bloomStrength: 0.7,
    },
    lighting: {
      ambient: 0x2a3a4a, hemi: 0xaaccff, hemiGround: 0x040810, hemiIntensity: 0.45,
      fillColor: 0x8aaaff, fillIntensity: 1.2, rimColor: 0x305060, vignette: 0x000010,
    },
    weather: { type: 'snow', density: 1.5, lightning: false },
    vegetation: { density: 0.05, variants: ['vfx_dead_branch'], color: 0xa8b0c0 },
    wall: {
      primary: 'wall_ice_glacial',
      accentTextures: ['wall_stone', 'wall_runic_glow'],
      tint: 0x8aaacc,
    },
    outerEnvironment: {
      cliffColor: 0x202830, cliffTexture: 'wall_ice_glacial',
      fogColor: 0xaaccff, fogVariant: 'mist',
      propVariants: ['broken_pillar', 'rubble_pile'],
    },
    lightCone: { color: 0x8aaaff, intensity: 0.4, texture: 'vfx_light_cone_cold' },
    propBias: { 'broken_pillar': 1.2, 'sarcophagus': 1.5 },
  },

  // ── Verdant Ruins (HARBINGER boss domain) ─────────────────────────
  verdant_ruins: {
    id: 'verdant_ruins',
    name: 'Verdant Ruins',
    lore: 'The forest reclaims what the gods abandoned — and what hides within.',
    trashPool: ['carrion_knight', 'hellhound', 'drudgekin_brute'],
    elitePool: ['wraith_specter'],
    bossId: 'ashen_warlord',
    floor: {
      combatRoomsMin: 4, combatRoomsMax: 6,
      eliteRoomChance: 0.40, treasureRoomChance: 0.40,
      shrineRoomChance: 0.30, hiddenRoomChance: 0.25,
      primary: 'floor_moss_overgrown',
      patchTextures: ['floor_cracked', 'floor_stone'],
      wetSheen: true,
      heightmap: 'tex_heightmap_rubble',
      heightAmplitude: 0.35,
    },
    packSizeMin: 2, packSizeMax: 4,
    rooms: [
      { label: 'The Overgrown Gate', lore: 'Wood remembers. So does what grows over wood.' },
      { label: 'Rotsoaked Aisle',    lore: 'The damp here has weight. It listens.' },
      { label: 'Mire of Lost Hymns', lore: 'A choir, drowned in mid-verse.' },
      { label: 'Vine-Choked Pillars',lore: 'They were holding up a roof. Then they let go.' },
      { label: 'Sunken Altar',       lore: 'Whatever was worshipped here outgrew its name.' },
      { label: 'The Mossbound Tree', lore: 'Older than the keep. It planted itself.' },
    ],
    bossRoom:     { label: 'Heart of Rot', lore: 'The Rotbringer kept his promises. Look at all his hosts.' },
    treasureRoom: { label: 'Briar Vault',  lore: 'Reach in. The thorns guide you.' },
    shrineRoom:   { label: 'Grove Cairn',  lore: 'Bones laid in a circle. The wind plays them like reeds.' },
    hiddenRoom:   { label: 'The Witch\'s Hollow', lore: 'She is long gone. Her teapot still warm.' },
    chamberPool: {
      combat: ['octagonal_arena', 'pillar_gauntlet', 'collapsed_chapel'],
      boss: 'boss_throne',
    },
    atmosphere: {
      ambientColor: 0x1a2810, ambientIntensity: 0.35,
      fogColor: 0x405838, fogDensity: 0.020,
      torchColor: 0xaaff80, torchIntensity: 0.9,
      groundTint: 0x405838, bloomStrength: 0.8,
    },
    lighting: {
      ambient: 0x2a4a2a, hemi: 0xaaffaa, hemiGround: 0x080804, hemiIntensity: 0.40,
      fillColor: 0x80c860, fillIntensity: 1.3, rimColor: 0x305030, vignette: 0x041008,
    },
    weather: { type: 'rain', density: 0.8, lightning: true },
    vegetation: {
      density: 0.8,
      variants: ['vfx_grass_tuft_green', 'vfx_weed_cluster', 'vfx_moss_clump', 'vfx_vine_hanging'],
      color: 0x4a8830,
    },
    wall: {
      primary: 'wall_vine_overgrown',
      accentTextures: ['wall_stone', 'wall_mossy'],
      tint: 0x88a880,
    },
    outerEnvironment: {
      cliffColor: 0x2a3a20, cliffTexture: 'wall_mossy',
      fogColor: 0x88a880, fogVariant: 'mist',
      propVariants: ['broken_pillar', 'rubble_pile', 'fallen_banner'],
    },
    lightCone: { color: 0xaaff80, intensity: 0.3, texture: 'vfx_light_cone_cold' },
    propBias: { 'broken_pillar': 1.5, 'sarcophagus': 0.5 },
  },

  // ── Bloodspire Keep (REVENANT boss domain) ─────────────────────────
  bloodspire_keep: {
    id: 'bloodspire_keep',
    name: 'Bloodspire Keep',
    lore: 'A fortress dedicated to the rituals of crimson sacrifice.',
    trashPool: ['carrion_knight', 'bone_cultist', 'drudgekin_brute'],
    elitePool: ['wraith_specter'],
    bossId: 'ashen_warlord',
    floor: {
      combatRoomsMin: 4, combatRoomsMax: 6,
      eliteRoomChance: 0.50, treasureRoomChance: 0.30,
      shrineRoomChance: 0.35, hiddenRoomChance: 0.20,
      primary: 'floor_blood_marsh',
      patchTextures: ['floor_blood', 'floor_blood_soaked', 'floor_ritual'],
      wetSheen: true,
      heightmap: 'tex_heightmap_stone',
      heightAmplitude: 0.25,
    },
    packSizeMin: 2, packSizeMax: 4,
    rooms: [
      { label: 'Crimson Gatehouse', lore: 'The hinges were oiled with the wrong oil.' },
      { label: 'Bleeding Walls',    lore: 'The mortar contains more than mortar.' },
      { label: 'Choir of Veins',    lore: 'They sang their patron a year of throats.' },
      { label: 'Sacrifice Atrium',  lore: 'Eighty-eight stone tables, twenty-two used.' },
      { label: 'Vault of Censers',  lore: 'A century of incense pressed into the floor.' },
      { label: 'The Red Cloister',  lore: 'The brothers took vows of silence. Then they took vows of blood.' },
    ],
    bossRoom:     { label: 'Hollow Saint\'s Vigil', lore: 'He still tries to heal. The instinct outlives the faith.' },
    treasureRoom: { label: 'Blooded Hoard',         lore: 'Polished by gloved hands. Glove still attached.' },
    shrineRoom:   { label: 'Font of Slaughter',     lore: 'Drink, if you accept what it knows about you.' },
    hiddenRoom:   { label: 'The Whisper Cell',      lore: 'A confession that lasted six lifetimes.' },
    chamberPool: {
      combat: ['ritual_pit', 'octagonal_arena', 'ossuary', 'collapsed_chapel'],
      boss: 'boss_throne',
    },
    atmosphere: {
      ambientColor: 0x4a0808, ambientIntensity: 0.30,
      fogColor: 0x501010, fogDensity: 0.025,
      torchColor: 0xff4030, torchIntensity: 1.4,
      groundTint: 0x501010, bloomStrength: 1.0,
    },
    lighting: {
      ambient: 0x6a1818, hemi: 0xff5040, hemiGround: 0x100408, hemiIntensity: 0.32,
      fillColor: 0xff4030, fillIntensity: 1.7, rimColor: 0x301010, vignette: 0x100000,
    },
    weather: { type: 'ash', density: 1.2, lightning: false },
    vegetation: { density: 0.05, variants: ['vfx_weed_cluster', 'vfx_dead_branch'], color: 0x301818 },
    wall: {
      primary: 'wall_bloodied',
      accentTextures: ['wall_runic_glow', 'wall_carved', 'wall_charred'],
      tint: 0xa07060,
    },
    outerEnvironment: {
      cliffColor: 0x300808, cliffTexture: 'wall_bloodied',
      fogColor: 0x803030, fogVariant: 'dense',
      propVariants: ['broken_pillar', 'rubble_pile', 'skull_stack'],
    },
    lightCone: { color: 0xff5040, intensity: 0.45, texture: 'vfx_light_cone_warm' },
    propBias: { 'skull_idol': 1.8, 'skull_stack': 1.5, 'altar_runic': 1.5 },
  },

  // ── Ashfall Dunes (WRAITH boss domain) ─────────────────────────────
  ashfall_dunes: {
    id: 'ashfall_dunes',
    name: 'Ashfall Dunes',
    lore: 'A sunken desert temple where the sands swallow even gods.',
    trashPool: ['carrion_knight', 'wraith_specter', 'drudgekin_brute'],
    elitePool: ['bone_cultist'],
    bossId: 'ashen_warlord',
    floor: {
      combatRoomsMin: 4, combatRoomsMax: 6,
      eliteRoomChance: 0.40, treasureRoomChance: 0.40,
      shrineRoomChance: 0.30, hiddenRoomChance: 0.25,
      primary: 'floor_sand_dune',
      patchTextures: ['floor_ashen', 'floor_cracked', 'floor_stone'],
      wetSheen: false,
      heightmap: 'tex_heightmap_rubble',
      heightAmplitude: 0.40,
    },
    packSizeMin: 2, packSizeMax: 4,
    rooms: [
      { label: 'Buried Antechamber', lore: 'The doors were locked from outside. Then forgotten.' },
      { label: 'Halls of Lost Time', lore: 'The sand here is one hour deep, give or take a century.' },
      { label: 'The Wind\'s Echo',   lore: 'Even the sand listens.' },
      { label: 'Sandblasted Shrine', lore: 'The names eroded. The threats remain.' },
      { label: 'The Caravan Pit',    lore: 'They unloaded their carts here. They never reloaded them.' },
      { label: 'Drowned Library',    lore: 'Scrolls and sand. The scrolls lost.' },
    ],
    bossRoom:     { label: 'Throne of the Dune Stalker', lore: 'He hunts in mirage. He sees through your eyes already.' },
    treasureRoom: { label: 'Pharaoh\'s Cache',          lore: 'Buried in the wrong tomb. He misses it.' },
    shrineRoom:   { label: 'Sandstone Idol',            lore: 'Worshippers became drifters became sand.' },
    hiddenRoom:   { label: 'The Glass Chamber',         lore: 'Lightning struck here, once. The floor remembers.' },
    chamberPool: {
      combat: ['octagonal_arena', 'long_hall_crypt', 'pillar_gauntlet'],
      boss: 'boss_throne',
    },
    atmosphere: {
      ambientColor: 0x5a3818, ambientIntensity: 0.45,
      fogColor: 0x806038, fogDensity: 0.014,
      torchColor: 0xffd080, torchIntensity: 1.3,
      groundTint: 0x806038, bloomStrength: 0.95,
    },
    lighting: {
      ambient: 0xc88040, hemi: 0xffe8a0, hemiGround: 0x080404, hemiIntensity: 0.55,
      fillColor: 0xffc060, fillIntensity: 1.4, rimColor: 0x603010, vignette: 0x100804,
    },
    weather: { type: 'ash', density: 0.6, lightning: false },
    vegetation: { density: 0.10, variants: ['vfx_dead_branch', 'vfx_weed_cluster'], color: 0x886030 },
    wall: {
      primary: 'wall_sandstone_carved',
      accentTextures: ['wall_stone', 'wall_runic'],
      tint: 0xc89860,
    },
    outerEnvironment: {
      cliffColor: 0x886030, cliffTexture: 'wall_sandstone_carved',
      fogColor: 0xc89860, fogVariant: 'dust',
      propVariants: ['broken_pillar', 'rubble_pile'],
    },
    lightCone: { color: 0xffd080, intensity: 0.4, texture: 'vfx_light_cone_warm' },
    propBias: { 'broken_pillar': 1.6, 'sarcophagus': 1.3 },
  },
};

export function getTheme(id) {
  return THEMES[id] || THEMES.crucible_below;
}

export function listThemes() {
  return Object.values(THEMES);
}

/** Validate that all monster IDs referenced by a theme exist in MONSTERS. */
export function validateTheme(theme) {
  const pool = [...(theme.trashPool || []), ...(theme.elitePool || []), theme.bossId].filter(Boolean);
  const missing = pool.filter(id => !MONSTERS[id]);
  if (missing.length) {
    console.warn(`[Theme ${theme.id}] missing monster definitions: ${missing.join(', ')}`);
  }
  return missing.length === 0;
}
