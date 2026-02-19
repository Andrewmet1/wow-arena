/**
 * AssetManifest — Scalable asset registry for characters, weapons, and skins.
 *
 * WoW-style skin architecture: one pre-rigged base mesh + per-class texture skins.
 * Adding a new skin or weapon is as simple as adding an entry here.
 */

const MODEL_BASE = '/assets/models/';
const TEXTURE_BASE = '/assets/textures/';
const ANIM_BASE = '/assets/animations/shared/';

// ─── Shared animation library ─────────────────────────────────────────────────
// Each entry maps a descriptive animation name to the shared GLB filename.
// All Meshy-rigged models use the same bone hierarchy, so one clip works for all classes.
export const SHARED_ANIMATIONS = {
  idle:                      'idle.glb',                      // action_id: 0
  attack:                    'attack.glb',                    // action_id: 4
  behit_flyup:               'behit_flyup.glb',               // action_id: 7
  dead:                      'dead.glb',                      // action_id: 8
  run:                       'run.glb',                       // action_id: 14
  basic_jump:                'basic_jump.glb',                // action_id: 86
  chest_pound_taunt:         'chest_pound_taunt.glb',         // action_id: 88
  combat_stance:             'combat_stance.glb',             // action_id: 89
  kung_fu_punch:             'kung_fu_punch.glb',             // action_id: 96
  left_slash:                'left_slash.glb',                // action_id: 97
  run_and_shoot:             'run_and_shoot.glb',             // action_id: 98
  reaping_swing:             'reaping_swing.glb',             // action_id: 99
  rightward_spin:            'rightward_spin.glb',            // action_id: 100
  sword_judgment:            'sword_judgment.glb',            // action_id: 102
  charged_spell_cast:        'charged_spell_cast.glb',        // action_id: 125
  mage_spell_cast:           'mage_spell_cast.glb',           // action_id: 126
  charged_ground_slam:       'charged_ground_slam.glb',       // action_id: 127
  heavy_hammer_swing:        'heavy_hammer_swing.glb',        // action_id: 128
  mage_spell_cast_3:         'mage_spell_cast_3.glb',         // action_id: 130
  mage_spell_cast_5:         'mage_spell_cast_5.glb',         // action_id: 132
  mage_spell_cast_8:         'mage_spell_cast_8.glb',         // action_id: 137
  block:                     'block.glb',                     // action_id: 138
  stand_dodge:               'stand_dodge.glb',               // action_id: 156
  roll_dodge:                'roll_dodge.glb',                // action_id: 157
  electrocution_reaction:    'electrocution_reaction.glb',    // action_id: 172
  hit_reaction:              'hit_reaction.glb',              // action_id: 176
  hit_reaction_1:            'hit_reaction_1.glb',            // action_id: 178
  shot_and_fall_forward:     'shot_and_fall_forward.glb',     // action_id: 183
  shot_and_slow_fall_backward: 'shot_and_slow_fall_backward.glb', // action_id: 184
  dying_backwards:           'dying_backwards.glb',           // action_id: 189
  lean_forward_sprint:       'lean_forward_sprint.glb',       // action_id: 509

  // ── Additional melee attacks ──
  counterstrike:             'counterstrike.glb',             // action_id: 90
  double_blade_spin:         'double_blade_spin.glb',         // action_id: 91
  double_combo_attack:       'double_combo_attack.glb',       // action_id: 92
  dodge_and_counter:         'dodge_and_counter.glb',         // action_id: 93
  simple_kick:               'simple_kick.glb',               // action_id: 103
  triple_combo_attack:       'triple_combo_attack.glb',       // action_id: 105
  punch_combo:               'punch_combo.glb',               // action_id: 198
  weapon_combo:              'weapon_combo.glb',              // action_id: 199
  spartan_kick:              'spartan_kick.glb',              // action_id: 206
  roundhouse_kick:           'roundhouse_kick.glb',           // action_id: 207
  elbow_strike:              'elbow_strike.glb',              // action_id: 212
  leg_sweep:                 'leg_sweep.glb',                 // action_id: 213
  right_hand_sword_slash:    'right_hand_sword_slash.glb',    // action_id: 219
  shield_push:               'shield_push.glb',               // action_id: 220
  charged_upward_slash:      'charged_upward_slash.glb',      // action_id: 221
  axe_spin_attack:           'axe_spin_attack.glb',           // action_id: 238
  charged_slash:             'charged_slash.glb',             // action_id: 242

  // ── Generic skill casts ──
  skill_01:                  'skill_01.glb',                  // action_id: 17
  skill_02:                  'skill_02.glb',                  // action_id: 18
  skill_03:                  'skill_03.glb',                  // action_id: 19

  // ── Defense / parry ──
  sword_shout:               'sword_shout.glb',               // action_id: 101
  sword_parry:               'sword_parry.glb',               // action_id: 147
  two_handed_parry:          'two_handed_parry.glb',          // action_id: 149

  // ── Movement / acrobatic ──
  standard_forward_charge:   'standard_forward_charge.glb',   // action_id: 510
  quick_step_spin_dodge:     'quick_step_spin_dodge.glb',     // action_id: 384
  backflip:                  'backflip.glb',                  // action_id: 452

  // ── Death / knockdown / stomp ──
  knock_down:                'knock_down.glb',                // action_id: 187
  electrocuted_fall:         'electrocuted_fall.glb',         // action_id: 181
  angry_ground_stomp:        'angry_ground_stomp.glb',        // action_id: 255

  // ── Idle variants ──
  rest_pose:                 '__procedural__',                // standing upright, no motion
  idle_02:                   'idle_02.glb',                   // action_id: 11
  idle_03:                   'idle_03.glb',                   // action_id: 12
  alert:                     'alert.glb',                     // action_id: 2
  axe_stance:                'axe_stance.glb',                // action_id: 85

  // ── Run / movement variants ──
  run_03:                    'run_03.glb',                    // action_id: 15
  run_fast:                  'run_fast.glb',                  // action_id: 16
  walk_fight_forward:        'walk_fight_forward.glb',        // action_id: 21
  walk_fight_back:           'walk_fight_back.glb',           // action_id: 20
  walk_backward:             'walk_backward.glb',             // action_id: 544
  injured_walk:              'injured_walk.glb',              // action_id: 111
  sneaky_walk:               'sneaky_walk.glb',               // action_id: 559
};

// ─── Per-class animation maps ─────────────────────────────────────────────────
// Maps game state/ability names → shared animation clip keys.
// "idle", "run", "death", "hit", "dodge", "stun", "jump" are base state clips
// loaded eagerly; ability clips are loaded lazily on first use.
export const CLASS_ANIMATIONS = {
  tyrant: {
    idle: 'rest_pose', run: 'run', death: 'dead', hit: 'hit_reaction_1', dodge: 'quick_step_spin_dodge', stun: 'electrocution_reaction', jump: 'basic_jump',
    ravaging_cleave: 'double_combo_attack', bloodrage_strike: 'right_hand_sword_slash',
    brutal_slam: 'heavy_hammer_swing', iron_cyclone: 'axe_spin_attack',
    shatter_guard: 'sword_judgment', warbringer_rush: 'run_and_shoot',
    crippling_strike: 'left_slash', crushing_descent: 'basic_jump',
    iron_resolve: 'block', warborn_rally: 'chest_pound_taunt',
    skull_crack: 'kung_fu_punch', thunder_spike: 'charged_ground_slam',
  },
  wraith: {
    idle: 'combat_stance', run: 'run', death: 'dying_backwards', hit: 'behit_flyup', dodge: 'quick_step_spin_dodge', stun: 'electrocution_reaction', jump: 'basic_jump',
    viper_lash: 'left_slash', throat_opener: 'sword_judgment',
    grim_flurry: 'rightward_spin', nerve_strike: 'kung_fu_punch',
    serrated_wound: 'reaping_swing', blackjack: 'heavy_hammer_swing',
    veil_of_night: 'mage_spell_cast_5', shade_shift: 'stand_dodge',
    phantasm_dodge: 'block', umbral_shroud: 'charged_spell_cast',
    blood_tincture: 'mage_spell_cast', throat_jab: 'attack',
    frenzy_edge: 'chest_pound_taunt', shadowmeld: 'mage_spell_cast_8',
  },
  infernal: {
    idle: 'rest_pose', run: 'run', death: 'shot_and_fall_forward', hit: 'hit_reaction_1', dodge: 'stand_dodge', stun: 'electrocution_reaction', jump: 'basic_jump',
    inferno_bolt: 'mage_spell_cast_3', cataclysm_flare: 'mage_spell_cast_8',
    searing_pulse: 'kung_fu_punch', glacial_lance: 'charged_spell_cast',
    permafrost_burst: 'charged_ground_slam', phase_shift: 'roll_dodge',
    pyroclasm: 'chest_pound_taunt', crystalline_ward: 'block',
    cauterize: 'mage_spell_cast_5', arcane_bulwark: 'mage_spell_cast',
    spell_fracture: 'attack', scaldwind: 'reaping_swing',
    ember_brand: 'sword_judgment', scorched_earth: 'heavy_hammer_swing',
    ring_of_frost: 'rightward_spin',
  },
  harbinger: {
    idle: 'rest_pose', run: 'run', death: 'dead', hit: 'hit_reaction', dodge: 'stand_dodge', stun: 'electrocution_reaction', jump: 'basic_jump',
    hex_blight: 'mage_spell_cast', creeping_torment: 'mage_spell_cast_3',
    volatile_hex: 'sword_judgment', siphon_essence: 'mage_spell_cast_5',
    hex_rupture: 'charged_ground_slam', dread_howl: 'chest_pound_taunt',
    wraith_bolt: 'charged_spell_cast', nether_slam: 'heavy_hammer_swing',
    blood_tithe: 'block', warded_flesh: 'charged_spell_cast',
    rift_anchor: 'roll_dodge', hex_silence: 'elbow_strike',
    soul_ignite: 'reaping_swing', shadowfury: 'reaping_swing',
    abyssal_ground: 'mage_spell_cast_5',
  },
  revenant: {
    idle: 'combat_stance', run: 'run', death: 'shot_and_slow_fall_backward', hit: 'behit_flyup', dodge: 'roll_dodge', stun: 'electrocution_reaction', jump: 'basic_jump',
    hallowed_strike: 'left_slash', divine_reckoning: 'mage_spell_cast_3',
    radiant_verdict: 'sword_judgment', sanctified_gale: 'reaping_swing',
    ember_wake: 'rightward_spin', gavel_of_light: 'charged_ground_slam',
    binding_prayer: 'mage_spell_cast', aegis_of_dawn: 'block',
    sovereign_mend: 'mage_spell_cast_5', holy_restoration: 'mage_spell_cast_8',
    unchained_grace: 'chest_pound_taunt', sanctified_rebuff: 'kung_fu_punch',
    valiant_charge: 'run_and_shoot',
  },
};

/**
 * Resolve a shared animation clip path.
 * @param {string} clipKey — key from SHARED_ANIMATIONS (e.g. 'idle', 'attack')
 * @returns {string} URL path to the GLB file
 */
export function resolveAnimationPath(clipKey) {
  const file = SHARED_ANIMATIONS[clipKey];
  if (!file || file === '__procedural__') return null;
  return ANIM_BASE + file;
}

/**
 * Get the animation map for a class.
 * @param {string} classId
 * @returns {object} map of ability/state name → shared clip key
 */
export function getClassAnimationMap(classId) {
  return CLASS_ANIMATIONS[classId.toLowerCase()] || {};
}

// ─── Legacy rig config (kept for viewer.html backward compatibility) ──────────
const DEFAULT_RIG_CONFIG = {
  toeY:       0.02,
  footY:      0.06,
  kneeY:      0.20,
  thighY:     0.35,
  hipY:       0.42,
  waistY:     0.50,
  chestY:     0.58,
  shoulderY:  0.62,
  neckY:      0.82,
  headY:      0.88,
  armStartX:  0.13,
  shoulderX:  0.20,
  elbowX:     0.30,
  wristX:     0.40,
  blendMargin: 0.04,
};

export const ASSET_MANIFEST = {
  tyrant: {
    name: 'Tyrant',
    character: {
      default: 'char_tyrant.glb',   // legacy Meshy model (fallback)
    },
    // Per-class texture skin applied to the shared base mesh
    skin: {
      diffuse:   TEXTURE_BASE + 'skin_tyrant/diffuse.png',
      normal:    TEXTURE_BASE + 'skin_tyrant/normal.png',
      roughness: TEXTURE_BASE + 'skin_tyrant/roughness.png',
      metallic:  TEXTURE_BASE + 'skin_tyrant/metallic.png',
    },
    weapons: {
      greatsword: 'wpn_tyrant_greatsword.glb',
    },
    defaultWeapon: 'greatsword',
    weaponHand: 'both',
    weaponOffset: {
      mace: {
        position: [0.04, 0.19, 0.075],
        rotation: [-2.5916, 1.6584, 0.0084],
        scale: [0.7, 0.7, 0.7],
      },
    },
    scale: 1.0,
    weaponsBakedIn: true, // Meshy model includes weapon geometry
    rigConfig: { ...DEFAULT_RIG_CONFIG, shoulderY: 0.60, neckY: 0.80, armStartX: 0.15, shoulderX: 0.22 },
  },

  wraith: {
    name: 'Wraith',
    character: {
      default: 'char_wraith.glb',
    },
    skin: {
      diffuse:   TEXTURE_BASE + 'skin_wraith/diffuse.png',
      normal:    TEXTURE_BASE + 'skin_wraith/normal.png',
      roughness: TEXTURE_BASE + 'skin_wraith/roughness.png',
      metallic:  TEXTURE_BASE + 'skin_wraith/metallic.png',
    },
    weapons: {
      daggers: 'wpn_wraith_daggers.glb',
    },
    defaultWeapon: 'daggers',
    weaponHand: 'dual',
    weaponOffset: {
      daggers: {
        position: [-0.05, 0.07, -0.28],
        rotation: [2.6084, 1.3084, -0.0916],
        scale: [0.4, 0.4, 0.4],
      },
    },
    scale: 0.95,
    weaponsBakedIn: true,
    rigConfig: { ...DEFAULT_RIG_CONFIG, shoulderY: 0.63, armStartX: 0.12, shoulderX: 0.18 },
  },

  infernal: {
    name: 'Infernal',
    character: {
      default: 'char_infernal.glb',
    },
    skin: {
      diffuse:   TEXTURE_BASE + 'skin_infernal/diffuse.png',
      normal:    TEXTURE_BASE + 'skin_infernal/normal.png',
      roughness: TEXTURE_BASE + 'skin_infernal/roughness.png',
      metallic:  TEXTURE_BASE + 'skin_infernal/metallic.png',
    },
    weapons: {
      staff: 'wpn_infernal_staff.glb',
    },
    defaultWeapon: 'staff',
    weaponHand: 'right',
    weaponOffset: {
      staff: {
        position: [0, -0.03, 0],
        rotation: [-Math.PI / 2, 0, 0],
        scale: [0.7, 0.7, 0.7],
      },
    },
    scale: 1.0,
    weaponsBakedIn: true,
    rigConfig: { ...DEFAULT_RIG_CONFIG, kneeY: 0.18, thighY: 0.33, hipY: 0.40 },
  },

  harbinger: {
    name: 'Harbinger',
    character: {
      default: 'char_harbinger.glb',
    },
    skin: {
      diffuse:   TEXTURE_BASE + 'skin_harbinger/diffuse.png',
      normal:    TEXTURE_BASE + 'skin_harbinger/normal.png',
      roughness: TEXTURE_BASE + 'skin_harbinger/roughness.png',
      metallic:  TEXTURE_BASE + 'skin_harbinger/metallic.png',
    },
    weapons: {
      staff: 'wpn_harbinger_staff.glb',
    },
    defaultWeapon: 'staff',
    weaponHand: 'right',
    weaponOffset: {
      staff: {
        position: [0, -0.03, 0],
        rotation: [-Math.PI / 2, 0, 0],
        scale: [0.7, 0.7, 0.7],
      },
    },
    scale: 1.0,
    weaponsBakedIn: true,
    rigConfig: { ...DEFAULT_RIG_CONFIG, headY: 0.86, neckY: 0.80, shoulderY: 0.61 },
  },

  revenant: {
    name: 'Revenant',
    character: {
      default: 'char_revenant.glb',
    },
    skin: {
      diffuse:   TEXTURE_BASE + 'skin_revenant/diffuse.png',
      normal:    TEXTURE_BASE + 'skin_revenant/normal.png',
      roughness: TEXTURE_BASE + 'skin_revenant/roughness.png',
      metallic:  TEXTURE_BASE + 'skin_revenant/metallic.png',
    },
    weapons: {
      mace: 'wpn_revenant_mace.glb',
      shield: 'wpn_revenant_shield.glb',
    },
    defaultWeapon: 'mace',
    weaponHand: 'right',
    offHandType: 'shield',
    weaponOffset: {
      mace: {
        position: [0, -0.03, 0.01],
        rotation: [-Math.PI / 2, 0, 0],
        scale: [0.7, 0.7, 0.7],
      },
      shield: {
        position: [0.06, 0.22, 0],
        rotation: [0.4084, 2.3584, 3.1084],
        scale: [1.05, 1.05, 1.05],
      },
    },
    scale: 1.0,
    weaponsBakedIn: true,
    rigConfig: { ...DEFAULT_RIG_CONFIG, shoulderY: 0.61, armStartX: 0.14, shoulderX: 0.21 },
  },
};

/**
 * Resolve a model path from the manifest.
 */
export function resolveModelPath(classId, type, variant) {
  const entry = ASSET_MANIFEST[classId.toLowerCase()];
  if (!entry) throw new Error(`Unknown class: ${classId}`);

  if (type === 'character') {
    const skin = variant || 'default';
    const file = entry.character[skin];
    if (!file) throw new Error(`Unknown skin "${skin}" for ${classId}`);
    return MODEL_BASE + file;
  }

  if (type === 'weapon') {
    const weaponType = variant || entry.defaultWeapon;
    const file = entry.weapons[weaponType];
    if (!file) throw new Error(`Unknown weapon "${weaponType}" for ${classId}`);
    return MODEL_BASE + file;
  }

  throw new Error(`Unknown asset type: ${type}`);
}

/**
 * Get all model paths that should be preloaded.
 */
export function getAllModelPaths() {
  const paths = [MODEL_BASE + 'base_humanoid.glb'];
  for (const [, entry] of Object.entries(ASSET_MANIFEST)) {
    // Legacy character models (for fallback)
    paths.push(MODEL_BASE + entry.character.default);
    for (const [, file] of Object.entries(entry.weapons)) {
      paths.push(MODEL_BASE + file);
    }
  }
  return paths;
}

/**
 * Get rig config for a class (legacy, used by viewer.html).
 */
export function getRigConfig(classId) {
  const entry = ASSET_MANIFEST[classId.toLowerCase()];
  return entry?.rigConfig || DEFAULT_RIG_CONFIG;
}

/**
 * Get the skin texture config for a class.
 * @param {string} classId
 * @returns {object|null} skin config with texture paths
 */
export function getSkinConfig(classId) {
  const entry = ASSET_MANIFEST[classId.toLowerCase()];
  return entry?.skin || null;
}

/**
 * Get weapon offset config for a class.
 * @param {string} classId
 * @param {string} [weaponType]
 * @returns {object} offset config with position, rotation, scale
 */
export function getWeaponOffset(classId, weaponType) {
  const entry = ASSET_MANIFEST[classId.toLowerCase()];
  if (!entry) return {};
  const wType = weaponType || entry.defaultWeapon;
  return entry.weaponOffset?.[wType] || {};
}
