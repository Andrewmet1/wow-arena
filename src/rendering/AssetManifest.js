/**
 * AssetManifest — Scalable asset registry for characters, weapons, and skins.
 *
 * WoW-style skin architecture: one pre-rigged base mesh + per-class texture skins.
 * Adding a new skin or weapon is as simple as adding an entry here.
 */

const MODEL_BASE = '/assets/models/';
const TEXTURE_BASE = '/assets/textures/';
const ANIM_BASE = '/assets/animations/shared/';

// Mobile detection for loading optimized assets
const _isMobile = typeof navigator !== 'undefined' &&
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);


// ─── Shared animation library ─────────────────────────────────────────────────
// Each entry maps a descriptive animation name to the shared GLB filename.
// All Meshy-rigged models use the same bone hierarchy, so one clip works for all classes.
export const SHARED_ANIMATIONS = {
  idle:                      'idle.glb',                      // action_id: 0
  attack:                    'attack.glb',                    // action_id: 4
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
  hit_reaction:              'hit_reaction.glb',              // action_id: 176
  hit_reaction_1:            'hit_reaction_1.glb',            // action_id: 178
  dying_backwards:           'dying_backwards.glb',           // action_id: 189
  lean_forward_sprint:       'lean_forward_sprint.glb',       // action_id: 509

  // ── Melee attacks (weapon) ──
  counterstrike:             'counterstrike.glb',             // action_id: 90
  double_blade_spin:         'double_blade_spin.glb',         // action_id: 91
  double_combo_attack:       'double_combo_attack.glb',       // action_id: 92
  dodge_and_counter:         'dodge_and_counter.glb',         // action_id: 93
  triple_combo_attack:       'triple_combo_attack.glb',       // action_id: 105
  weapon_combo:              'weapon_combo.glb',              // action_id: 199
  right_hand_sword_slash:    'right_hand_sword_slash.glb',    // action_id: 219
  shield_push:               'shield_push.glb',               // action_id: 220
  charged_upward_slash:      'charged_upward_slash.glb',      // action_id: 221
  axe_spin_attack:           'axe_spin_attack.glb',           // action_id: 238
  charged_slash:             'charged_slash.glb',             // action_id: 242
  charged_axe_chop:          'charged_axe_chop.glb',          // action_id: 237
  weapon_combo_2:            'weapon_combo_2.glb',            // action_id: 241
  punch_combo:               'punch_combo.glb',               // action_id: 198
  weapon_combo_1:            'weapon_combo_1.glb',            // action_id: 202

  // ── Spell casts (all variants) ──
  skill_01:                  'skill_01.glb',                  // action_id: 17
  skill_02:                  'skill_02.glb',                  // action_id: 18
  skill_03:                  'skill_03.glb',                  // action_id: 19
  mage_spell_cast_0:         'mage_spell_cast_0.glb',         // action_id: 129
  mage_spell_cast_2:         'mage_spell_cast_2.glb',         // action_id: 131
  mage_spell_cast_4:         'mage_spell_cast_4.glb',         // action_id: 133
  mage_spell_cast_6:         'mage_spell_cast_6.glb',         // action_id: 135

  // ── Defense / parry / block variants ──
  sword_shout:               'sword_shout.glb',               // action_id: 101
  sword_parry:               'sword_parry.glb',               // action_id: 147
  two_handed_parry:          'two_handed_parry.glb',          // action_id: 149
  sword_parry_backward:      'sword_parry_backward.glb',      // action_id: 148
  block_2:                   'block_2.glb',                   // action_id: 139
  block_3:                   'block_3.glb',                   // action_id: 140
  block_4:                   'block_4.glb',                   // action_id: 141
  block_5:                   'block_5.glb',                   // action_id: 142

  // ── Roll dodge variants ──
  roll_dodge_1:              'roll_dodge_1.glb',              // action_id: 159
  roll_dodge_2:              'roll_dodge_2.glb',              // action_id: 160

  // ── Movement / acrobatic ──
  standard_forward_charge:   'standard_forward_charge.glb',   // action_id: 510
  quick_step_spin_dodge:     'quick_step_spin_dodge.glb',     // action_id: 384
  backflip:                  'backflip.glb',                  // action_id: 452
  sprint_roll_and_flip:      'sprint_roll_and_flip.glb',      // action_id: 401
  jump_and_slam:             'jump_and_slam.glb',             // action_id: 382


  // ── Idle variants ──
  rest_pose:                 '__procedural__',                // standing upright, no motion
  idle_02:                   'idle_02.glb',                   // action_id: 11
  idle_03:                   'idle_03.glb',                   // action_id: 12
  alert:                     'alert.glb',                     // action_id: 2
  axe_stance:                'axe_stance.glb',                // action_id: 85
  boxing_practice:           'boxing_practice.glb',           // action_id: 87

  // ── Taunts / emotes ──
  angry_stomp:               'angry_stomp.glb',               // action_id: 26
  victory_cheer:             'victory_cheer.glb',             // action_id: 59
  victory_fist_pump:         'victory_fist_pump.glb',         // action_id: 403

  // ── Run / movement variants ──
  run_03:                    'run_03.glb',                    // action_id: 15
  run_fast:                  'run_fast.glb',                  // action_id: 16
  walk_fight_forward:        'walk_fight_forward.glb',        // action_id: 21
  walk_fight_back:           'walk_fight_back.glb',           // action_id: 20
  walk_backward:             'walk_backward.glb',             // action_id: 544
  injured_walk:              'injured_walk.glb',              // action_id: 111
  sneaky_walk:               'sneaky_walk.glb',               // action_id: 559

  // ── Stun / CC reactions ──
  electrocution_reaction:    'electrocution_reaction.glb',
  electrocuted_fall:         'electrocuted_fall.glb',
  knock_down:                'knock_down.glb',

  // ── Hit / death variants (on disk, referenced by CLASS_ANIMATIONS) ──
  behit_flyup:               'behit_flyup.glb',
  shot_and_fall_forward:     'shot_and_fall_forward.glb',
  shot_and_slow_fall_backward: 'shot_and_slow_fall_backward.glb',

  // ── Kick / melee extras ──
  angry_ground_stomp:        'angry_ground_stomp.glb',
  elbow_strike:              'elbow_strike.glb',
  leg_sweep:                 'leg_sweep.glb',
  roundhouse_kick:           'roundhouse_kick.glb',
  simple_kick:               'simple_kick.glb',
  spartan_kick:              'spartan_kick.glb',
};

// ─── Per-class animation maps ─────────────────────────────────────────────────
// Maps game state/ability names → shared animation clip keys.
// "idle", "run", "death", "hit", "dodge", "stun", "jump" are base state clips
// loaded eagerly; ability clips are loaded lazily on first use.
export const CLASS_ANIMATIONS = {
  tyrant: {
    idle: 'rest_pose', run: 'rigs/tyrant_frost_dragon/lean_forward_sprint.glb', death: 'rigs/tyrant_frost_dragon/dead.glb', hit: 'rigs/tyrant_frost_dragon/hit_reaction.glb', dodge: 'rigs/tyrant_frost_dragon/quick_step_spin_dodge.glb', stun: 'rigs/tyrant_frost_dragon/alert.glb', jump: 'rigs/tyrant_frost_dragon/basic_jump.glb', auto_attack: 'rigs/tyrant_frost_dragon/left_slash.glb',
    ravaging_cleave: 'rigs/tyrant_frost_dragon/double_combo_attack.glb', bloodrage_strike: 'rigs/tyrant_frost_dragon/right_hand_sword_slash.glb',
    brutal_slam: 'rigs/tyrant_frost_dragon/heavy_hammer_swing.glb', iron_cyclone: 'rigs/tyrant_frost_dragon/axe_spin_attack.glb',
    shatter_guard: 'rigs/tyrant_frost_dragon/sword_judgment.glb', warbringer_rush: 'rigs/tyrant_frost_dragon/run_and_shoot.glb',
    crippling_strike: 'rigs/tyrant_frost_dragon/left_slash.glb', crushing_descent: 'rigs/tyrant_frost_dragon/basic_jump.glb',
    iron_resolve: 'rigs/tyrant_frost_dragon/block.glb', warborn_rally: 'rigs/tyrant_frost_dragon/sword_shout.glb',
    skull_crack: 'rigs/tyrant_frost_dragon/punch_combo.glb', thunder_spike: 'rigs/tyrant_frost_dragon/charged_ground_slam.glb',
  },
  wraith: {
    idle: 'rigs/tyrant_frost_dragon/combat_stance.glb', run: 'rigs/tyrant_frost_dragon/lean_forward_sprint.glb', death: 'rigs/tyrant_frost_dragon/dying_backwards.glb', hit: 'rigs/tyrant_frost_dragon/hit_reaction_1.glb', dodge: 'rigs/tyrant_frost_dragon/quick_step_spin_dodge.glb', stun: 'rigs/tyrant_frost_dragon/alert.glb', jump: 'rigs/tyrant_frost_dragon/basic_jump.glb', auto_attack: 'rigs/tyrant_frost_dragon/attack.glb',
    viper_lash: 'rigs/tyrant_frost_dragon/left_slash.glb', throat_opener: 'rigs/tyrant_frost_dragon/sword_judgment.glb',
    grim_flurry: 'rigs/tyrant_frost_dragon/rightward_spin.glb', nerve_strike: 'rigs/tyrant_frost_dragon/punch_combo.glb',
    serrated_wound: 'rigs/tyrant_frost_dragon/reaping_swing.glb', blackjack: 'rigs/tyrant_frost_dragon/heavy_hammer_swing.glb',
    veil_of_night: 'rigs/tyrant_frost_dragon/mage_spell_cast_4.glb', shade_shift: 'rigs/tyrant_frost_dragon/stand_dodge.glb',
    phantasm_dodge: 'rigs/tyrant_frost_dragon/block.glb', umbral_shroud: 'rigs/tyrant_frost_dragon/charged_spell_cast.glb',
    blood_tincture: 'rigs/tyrant_frost_dragon/mage_spell_cast.glb', throat_jab: 'rigs/tyrant_frost_dragon/attack.glb',
    frenzy_edge: 'rigs/tyrant_frost_dragon/sword_shout.glb', shadowmeld: 'rigs/tyrant_frost_dragon/mage_spell_cast_8.glb',
  },
  infernal: {
    idle: 'rest_pose', run: 'rigs/tyrant_frost_dragon/lean_forward_sprint.glb', death: 'rigs/tyrant_frost_dragon/dead.glb', hit: 'rigs/tyrant_frost_dragon/hit_reaction_1.glb', dodge: 'rigs/tyrant_frost_dragon/stand_dodge.glb', stun: 'rigs/tyrant_frost_dragon/alert.glb', jump: 'rigs/tyrant_frost_dragon/basic_jump.glb', auto_attack: 'rigs/tyrant_frost_dragon/attack.glb',
    inferno_bolt: 'rigs/tyrant_frost_dragon/mage_spell_cast_3.glb', cataclysm_flare: 'rigs/tyrant_frost_dragon/mage_spell_cast_8.glb',
    searing_pulse: 'rigs/tyrant_frost_dragon/punch_combo.glb', glacial_lance: 'rigs/tyrant_frost_dragon/charged_spell_cast.glb',
    permafrost_burst: 'rigs/tyrant_frost_dragon/charged_ground_slam.glb', phase_shift: 'rigs/tyrant_frost_dragon/roll_dodge.glb',
    pyroclasm: 'rigs/tyrant_frost_dragon/sword_shout.glb', crystalline_ward: 'rigs/tyrant_frost_dragon/block.glb',
    cauterize: 'rigs/tyrant_frost_dragon/mage_spell_cast_4.glb', arcane_bulwark: 'rigs/tyrant_frost_dragon/mage_spell_cast.glb',
    spell_fracture: 'rigs/tyrant_frost_dragon/attack.glb', scaldwind: 'rigs/tyrant_frost_dragon/reaping_swing.glb',
    ember_brand: 'rigs/tyrant_frost_dragon/sword_judgment.glb', scorched_earth: 'rigs/tyrant_frost_dragon/heavy_hammer_swing.glb',
    ring_of_frost: 'rigs/tyrant_frost_dragon/rightward_spin.glb',
  },
  harbinger: {
    idle: 'rest_pose', run: 'rigs/tyrant_frost_dragon/lean_forward_sprint.glb', death: 'rigs/tyrant_frost_dragon/dead.glb', hit: 'rigs/tyrant_frost_dragon/hit_reaction.glb', dodge: 'rigs/tyrant_frost_dragon/stand_dodge.glb', stun: 'rigs/tyrant_frost_dragon/alert.glb', jump: 'rigs/tyrant_frost_dragon/basic_jump.glb', auto_attack: 'rigs/tyrant_frost_dragon/attack.glb',
    hex_blight: 'rigs/tyrant_frost_dragon/mage_spell_cast.glb', creeping_torment: 'rigs/tyrant_frost_dragon/mage_spell_cast_3.glb',
    volatile_hex: 'rigs/tyrant_frost_dragon/sword_judgment.glb', siphon_essence: 'rigs/tyrant_frost_dragon/mage_spell_cast_4.glb',
    hex_rupture: 'rigs/tyrant_frost_dragon/charged_ground_slam.glb', dread_howl: 'rigs/tyrant_frost_dragon/sword_shout.glb',
    wraith_bolt: 'rigs/tyrant_frost_dragon/charged_spell_cast.glb', nether_slam: 'rigs/tyrant_frost_dragon/heavy_hammer_swing.glb',
    blood_tithe: 'rigs/tyrant_frost_dragon/block.glb', warded_flesh: 'rigs/tyrant_frost_dragon/charged_spell_cast.glb',
    rift_anchor: 'rigs/tyrant_frost_dragon/roll_dodge.glb', hex_silence: 'rigs/tyrant_frost_dragon/counterstrike.glb',
    soul_ignite: 'rigs/tyrant_frost_dragon/reaping_swing.glb', shadowfury: 'rigs/tyrant_frost_dragon/reaping_swing.glb',
    abyssal_ground: 'rigs/tyrant_frost_dragon/mage_spell_cast_4.glb',
  },
  revenant: {
    idle: 'rigs/tyrant_frost_dragon/combat_stance.glb', run: 'rigs/tyrant_frost_dragon/lean_forward_sprint.glb', death: 'rigs/tyrant_frost_dragon/dying_backwards.glb', hit: 'rigs/tyrant_frost_dragon/hit_reaction_1.glb', dodge: 'rigs/tyrant_frost_dragon/roll_dodge.glb', stun: 'rigs/tyrant_frost_dragon/alert.glb', jump: 'rigs/tyrant_frost_dragon/basic_jump.glb', auto_attack: 'rigs/tyrant_frost_dragon/attack.glb',
    hallowed_strike: 'rigs/tyrant_frost_dragon/left_slash.glb', divine_reckoning: 'rigs/tyrant_frost_dragon/mage_spell_cast_3.glb',
    radiant_verdict: 'rigs/tyrant_frost_dragon/sword_judgment.glb', sanctified_gale: 'rigs/tyrant_frost_dragon/reaping_swing.glb',
    ember_wake: 'rigs/tyrant_frost_dragon/rightward_spin.glb', gavel_of_light: 'rigs/tyrant_frost_dragon/charged_ground_slam.glb',
    binding_prayer: 'rigs/tyrant_frost_dragon/mage_spell_cast.glb', aegis_of_dawn: 'rigs/tyrant_frost_dragon/block.glb',
    sovereign_mend: 'rigs/tyrant_frost_dragon/mage_spell_cast_4.glb', holy_restoration: 'rigs/tyrant_frost_dragon/mage_spell_cast_8.glb',
    unchained_grace: 'rigs/tyrant_frost_dragon/sword_shout.glb', sanctified_rebuff: 'rigs/tyrant_frost_dragon/punch_combo.glb',
    valiant_charge: 'rigs/tyrant_frost_dragon/run_and_shoot.glb',
  },
};

/**
 * Per-skin animation overrides.
 * Keys are `{classId}_{skinId}` (e.g. 'tyrant_frost_dragon').
 * Only entries that differ from CLASS_ANIMATIONS need to be listed here.
 * Values can be shared keys ('run') or rig-specific paths ('rigs/tyrant_frost_dragon/run.glb').
 */
export const SKIN_ANIMATIONS = {
  revenant_frozen_ice_holy_paladin_fallen_dragon: {
    weaponsBakedIn: false,
    modelScale: 1.9,
    idle: 'rest_pose', run: 'rigs/tyrant_frost_dragon/lean_forward_sprint.glb', death: 'rigs/tyrant_frost_dragon/dying_backwards.glb', hit: 'rigs/tyrant_frost_dragon/hit_reaction.glb', dodge: 'rigs/tyrant_frost_dragon/roll_dodge_2.glb', stun: 'rigs/tyrant_frost_dragon/alert.glb', jump: 'basic_jump', auto_attack: 'rigs/tyrant_frost_dragon/attack.glb',
    hallowed_strike: 'rigs/tyrant_frost_dragon/left_slash.glb', divine_reckoning: 'rigs/tyrant_frost_dragon/mage_spell_cast_3.glb',
    radiant_verdict: 'rigs/tyrant_frost_dragon/sword_judgment.glb', sanctified_gale: 'rigs/tyrant_frost_dragon/reaping_swing.glb',
    ember_wake: 'rigs/tyrant_frost_dragon/shield_push.glb', gavel_of_light: 'rigs/tyrant_frost_dragon/charged_ground_slam.glb',
    binding_prayer: 'rigs/tyrant_frost_dragon/mage_spell_cast.glb', aegis_of_dawn: 'rigs/tyrant_frost_dragon/block.glb',
    sovereign_mend: 'rigs/tyrant_frost_dragon/skill_01.glb', holy_restoration: 'rigs/tyrant_frost_dragon/mage_spell_cast_3.glb',
    unchained_grace: 'rigs/tyrant_frost_dragon/sword_shout.glb', sanctified_rebuff: 'rigs/tyrant_frost_dragon/double_blade_spin.glb',
    valiant_charge: 'rigs/tyrant_frost_dragon/run_fast.glb',
  },
  harbinger_frozen_ice_dragon_skeleton_warlock: {
    weaponsBakedIn: false,
    modelScale: 1.9,
    idle: 'rest_pose', run: 'rigs/tyrant_frost_dragon/lean_forward_sprint.glb', death: 'rigs/tyrant_frost_dragon/dead.glb', hit: 'rigs/tyrant_frost_dragon/hit_reaction.glb', dodge: 'rigs/tyrant_frost_dragon/stand_dodge.glb', stun: 'rigs/tyrant_frost_dragon/alert.glb', jump: 'basic_jump', auto_attack: 'rigs/tyrant_frost_dragon/attack.glb',
    hex_blight: 'rigs/tyrant_frost_dragon/mage_spell_cast.glb', creeping_torment: 'rigs/tyrant_frost_dragon/mage_spell_cast_3.glb',
    volatile_hex: 'rigs/tyrant_frost_dragon/sword_judgment.glb', siphon_essence: 'rigs/tyrant_frost_dragon/mage_spell_cast_8.glb',
    hex_rupture: 'rigs/tyrant_frost_dragon/mage_spell_cast_6.glb', dread_howl: 'rigs/tyrant_frost_dragon/charged_spell_cast.glb',
    wraith_bolt: 'charged_spell_cast', nether_slam: 'rigs/tyrant_frost_dragon/charged_ground_slam.glb',
    blood_tithe: 'rigs/tyrant_frost_dragon/block.glb', warded_flesh: 'rigs/tyrant_frost_dragon/charged_spell_cast.glb',
    rift_anchor: 'rigs/tyrant_frost_dragon/roll_dodge_2.glb', hex_silence: 'rigs/tyrant_frost_dragon/left_slash.glb',
    soul_ignite: 'rigs/tyrant_frost_dragon/attack.glb', shadowfury: 'rigs/tyrant_frost_dragon/double_blade_spin.glb',
    abyssal_ground: 'rigs/tyrant_frost_dragon/mage_spell_cast_4.glb',
  },
  infernal_frost_dragon_skeleton_inspired_ice_wizar: {
    weaponsBakedIn: true,
    modelScale: 1.9,
    idle: 'rest_pose', run: 'rigs/tyrant_frost_dragon/lean_forward_sprint.glb', death: 'shot_and_fall_forward', hit: 'rigs/tyrant_frost_dragon/hit_reaction_1.glb', dodge: 'rigs/tyrant_frost_dragon/stand_dodge.glb', stun: 'electrocution_reaction', jump: 'rigs/tyrant_frost_dragon/basic_jump.glb', auto_attack: 'rigs/tyrant_frost_dragon/attack.glb',
    inferno_bolt: 'rigs/tyrant_frost_dragon/mage_spell_cast_3.glb', cataclysm_flare: 'rigs/tyrant_frost_dragon/mage_spell_cast_8.glb',
    searing_pulse: 'rigs/tyrant_frost_dragon/left_slash.glb', glacial_lance: 'rigs/tyrant_frost_dragon/charged_spell_cast.glb',
    permafrost_burst: 'rigs/tyrant_frost_dragon/charged_ground_slam.glb', phase_shift: 'rigs/tyrant_frost_dragon/victory_fist_pump.glb',
    pyroclasm: 'rigs/tyrant_frost_dragon/sword_parry.glb', crystalline_ward: 'rigs/tyrant_frost_dragon/block.glb',
    cauterize: 'mage_spell_cast_5', arcane_bulwark: 'rigs/tyrant_frost_dragon/mage_spell_cast.glb',
    spell_fracture: 'rigs/tyrant_frost_dragon/attack.glb', scaldwind: 'rigs/tyrant_frost_dragon/reaping_swing.glb',
    ember_brand: 'rigs/tyrant_frost_dragon/sword_judgment.glb', scorched_earth: 'rigs/tyrant_frost_dragon/heavy_hammer_swing.glb',
    ring_of_frost: 'rigs/tyrant_frost_dragon/skill_03.glb',
  },
  tyrant_ashen_overlord: {
    weaponsBakedIn: false,
    modelScale: 1.9,
    idle: 'rest_pose', run: 'rigs/tyrant_frost_dragon/lean_forward_sprint.glb', death: 'rigs/tyrant_frost_dragon/dead.glb', hit: 'rigs/tyrant_frost_dragon/hit_reaction.glb', dodge: 'rigs/tyrant_frost_dragon/roll_dodge_2.glb', stun: 'rigs/tyrant_frost_dragon/block_3.glb', jump: 'basic_jump', auto_attack: 'rigs/tyrant_frost_dragon/left_slash.glb',
    ravaging_cleave: 'rigs/tyrant_frost_dragon/double_combo_attack.glb', bloodrage_strike: 'rigs/tyrant_frost_dragon/right_hand_sword_slash.glb',
    brutal_slam: 'rigs/tyrant_frost_dragon/heavy_hammer_swing.glb', iron_cyclone: 'rigs/tyrant_frost_dragon/axe_spin_attack.glb',
    shatter_guard: 'rigs/tyrant_frost_dragon/sword_judgment.glb', warbringer_rush: 'rigs/tyrant_frost_dragon/standard_forward_charge.glb',
    crippling_strike: 'rigs/tyrant_frost_dragon/attack.glb', crushing_descent: 'rigs/tyrant_frost_dragon/basic_jump.glb',
    iron_resolve: 'rigs/tyrant_frost_dragon/sword_shout.glb', warborn_rally: 'rigs/tyrant_frost_dragon/shield_push.glb',
    skull_crack: 'rigs/tyrant_frost_dragon/weapon_combo_2.glb', thunder_spike: 'rigs/tyrant_frost_dragon/charged_ground_slam.glb',
  },
  tyrant_frost_dragon: {
    weaponsBakedIn: false,
    run: 'rigs/tyrant_frost_dragon/lean_forward_sprint.glb', death: 'rigs/tyrant_frost_dragon/dead.glb',
    hit: 'rigs/tyrant_frost_dragon/hit_reaction.glb',
    ravaging_cleave: 'rigs/tyrant_frost_dragon/left_slash.glb',
    auto_attack: 'rigs/tyrant_frost_dragon/left_slash.glb',
  },
  wraith_frozen_reaper: {
    weaponsBakedIn: false,
    modelScale: 1.9,
    idle: 'rigs/tyrant_frost_dragon/idle.glb', run: 'rigs/tyrant_frost_dragon/lean_forward_sprint.glb', death: 'rigs/tyrant_frost_dragon/dying_backwards.glb', hit: 'rigs/tyrant_frost_dragon/hit_reaction_1.glb', dodge: 'rigs/tyrant_frost_dragon/roll_dodge_1.glb', stun: 'rigs/tyrant_frost_dragon/block_2.glb', jump: 'basic_jump', auto_attack: 'rigs/tyrant_frost_dragon/attack.glb',
    viper_lash: 'rigs/tyrant_frost_dragon/left_slash.glb', throat_opener: 'rigs/tyrant_frost_dragon/sword_judgment.glb',
    grim_flurry: 'rigs/tyrant_frost_dragon/double_blade_spin.glb', nerve_strike: 'rigs/tyrant_frost_dragon/double_combo_attack.glb',
    serrated_wound: 'rigs/tyrant_frost_dragon/reaping_swing.glb', blackjack: 'rigs/tyrant_frost_dragon/heavy_hammer_swing.glb',
    veil_of_night: 'rigs/tyrant_frost_dragon/mage_spell_cast_3.glb', shade_shift: 'rigs/tyrant_frost_dragon/stand_dodge.glb',
    phantasm_dodge: 'rigs/tyrant_frost_dragon/block.glb', umbral_shroud: 'rigs/tyrant_frost_dragon/charged_spell_cast.glb',
    blood_tincture: 'rigs/tyrant_frost_dragon/mage_spell_cast.glb', throat_jab: 'rigs/tyrant_frost_dragon/attack.glb',
    frenzy_edge: 'rigs/tyrant_frost_dragon/shield_push.glb', shadowmeld: 'rigs/tyrant_frost_dragon/mage_spell_cast_8.glb',
  },
  tyrant_forest_inspired_dark_bear_skin: {
    weaponsBakedIn: false,
    modelScale: 1.9,
    idle: 'rest_pose', run: 'rigs/tyrant_frost_dragon/lean_forward_sprint.glb', death: 'rigs/tyrant_frost_dragon/dead.glb', hit: 'rigs/tyrant_frost_dragon/hit_reaction.glb', dodge: 'rigs/tyrant_frost_dragon/quick_step_spin_dodge.glb', stun: 'rigs/tyrant_frost_dragon/alert.glb', jump: 'rigs/tyrant_frost_dragon/basic_jump.glb', auto_attack: 'rigs/tyrant_frost_dragon/left_slash.glb',
    ravaging_cleave: 'rigs/tyrant_frost_dragon/double_combo_attack.glb', bloodrage_strike: 'rigs/tyrant_frost_dragon/right_hand_sword_slash.glb',
    brutal_slam: 'rigs/tyrant_frost_dragon/heavy_hammer_swing.glb', iron_cyclone: 'rigs/tyrant_frost_dragon/axe_spin_attack.glb',
    shatter_guard: 'rigs/tyrant_frost_dragon/sword_judgment.glb', warbringer_rush: 'rigs/tyrant_frost_dragon/run_and_shoot.glb',
    crippling_strike: 'rigs/tyrant_frost_dragon/left_slash.glb', crushing_descent: 'rigs/tyrant_frost_dragon/basic_jump.glb',
    iron_resolve: 'rigs/tyrant_frost_dragon/block.glb', warborn_rally: 'rigs/tyrant_frost_dragon/sword_shout.glb',
    skull_crack: 'rigs/tyrant_frost_dragon/punch_combo.glb', thunder_spike: 'rigs/tyrant_frost_dragon/charged_ground_slam.glb',
  },
};

/**
 * Skin catalog — metadata for all published skins.
 * Used by shop, profile, and loadout UI.
 */
export const SKIN_CATALOG = {
  tyrant_ashen_overlord: {
    classId: 'tyrant', skinId: 'ashen_overlord',
    name: 'Ashen Overlord', rarity: 'rare', price: 2500,
    description: 'Forged in the heart of a dying star, the Ashen Overlord commands the battlefield clad in molten-runed armor.',
    portraitArt: '/assets/art/skins/tyrant_ashen_overlord_portrait.webp',
    splashArt: '/assets/art/skins/tyrant_ashen_overlord_splash_wide.webp',
    bannerArt: '/assets/art/skins/tyrant_ashen_overlord_banner.webp',
    loadingArt: '/assets/art/skins/tyrant_ashen_overlord_loading.webp',
    iconArt: '/assets/art/skins/tyrant_ashen_overlord_icon.webp',
  },
  wraith_frozen_reaper: {
    classId: 'wraith', skinId: 'frozen_reaper',
    name: 'Frozen Reaper', rarity: 'epic', price: 3500,
    description: 'Once a Wraith who stalked the living, now entombed in cursed permafrost. The Frozen Reaper moves through the arena trailing shards of black ice, each dagger strike leaving frostbitten wounds that never heal.',
    portraitArt: '/assets/art/skins/wraith_frozen_reaper_portrait.webp',
    splashArt: '/assets/art/skins/wraith_frozen_reaper_splash_wide.webp',
    bannerArt: '/assets/art/skins/wraith_frozen_reaper_banner.webp',
    loadingArt: '/assets/art/skins/wraith_frozen_reaper_loading.webp',
    iconArt: '/assets/art/skins/wraith_frozen_reaper_icon.webp',
  },
  infernal_frost_dragon_skeleton_inspired_ice_wizar: {
    classId: 'infernal', skinId: 'frost_dragon_skeleton_inspired_ice_wizar',
    name: 'Ebon Frost Mage', rarity: 'epic', price: 5000,
    description: 'Donning the "Ebon Frost Mage" skin, the Infernal is cloaked in shimmering shards of black ice that breathe with an otherworldly chill, reflecting a wicked beauty forged from the darkest depths of the tundra. With frostbitten fingertips and ethereal tendrils of shadowy frost swirling around, this mage commands a chilling dominion where flames and frost intertwine in a deadly ballet of deception and despair.',
    portraitArt: '/assets/art/skins/infernal_frost_dragon_skeleton_inspired_ice_wizar_portrait.webp',
    splashArt: '/assets/art/skins/infernal_frost_dragon_skeleton_inspired_ice_wizar_splash_wide.webp',
    bannerArt: '/assets/art/skins/infernal_frost_dragon_skeleton_inspired_ice_wizar_banner.webp',
    loadingArt: '/assets/art/skins/infernal_frost_dragon_skeleton_inspired_ice_wizar_loading.webp',
    iconArt: '/assets/art/skins/infernal_frost_dragon_skeleton_inspired_ice_wizar_icon.webp',
  },
  harbinger_frozen_ice_dragon_skeleton_warlock: {
    classId: 'harbinger', skinId: 'frozen_ice_dragon_skeleton_warlock',
    name: 'Icebane Warlock', rarity: 'epic', price: 5000,
    description: 'Cloaked in the icy remnants of a long-fallen dragon, the Icebane Warlock emerges as a chilling specter of forgotten legends. Adorned with jagged bone and ethereal frost, this necromancer channels the frozen whispers of the abyss, bending death itself into a symphony of ice and shadows.',
    portraitArt: '/assets/art/skins/harbinger_frozen_ice_dragon_skeleton_warlock_portrait.webp',
    splashArt: '/assets/art/skins/harbinger_frozen_ice_dragon_skeleton_warlock_splash_wide.webp',
    bannerArt: '/assets/art/skins/harbinger_frozen_ice_dragon_skeleton_warlock_banner.webp',
    loadingArt: '/assets/art/skins/harbinger_frozen_ice_dragon_skeleton_warlock_loading.webp',
    iconArt: '/assets/art/skins/harbinger_frozen_ice_dragon_skeleton_warlock_icon.webp',
  },
  revenant_frozen_ice_holy_paladin_fallen_dragon: {
    classId: 'revenant', skinId: 'frozen_ice_holy_paladin_fallen_dragon',
    name: 'Frostfire Holy Paladin', rarity: 'epic', price: 5000,
    description: 'Wreathed in a blizzard of celestial flames, the Frostfire Holy Paladin embodies a chilling paradox, melding sacred light with the relentless bite of frost. His armor, forged from radiant ice, gleams with an ethereal glow, each swing of his blade leaving trails of both flickering embers and shivering gales, a harbinger of judgment for both sinner and saint alike.',
    portraitArt: '/assets/art/skins/revenant_frozen_ice_holy_paladin_fallen_dragon_portrait.webp',
    splashArt: '/assets/art/skins/revenant_frozen_ice_holy_paladin_fallen_dragon_splash_wide.webp',
    bannerArt: '/assets/art/skins/revenant_frozen_ice_holy_paladin_fallen_dragon_banner.webp',
    loadingArt: '/assets/art/skins/revenant_frozen_ice_holy_paladin_fallen_dragon_loading.webp',
    iconArt: '/assets/art/skins/revenant_frozen_ice_holy_paladin_fallen_dragon_icon.webp',
  },
  tyrant_forest_inspired_dark_bear_skin: {
    classId: 'tyrant', skinId: 'forest_inspired_dark_bear_skin',
    name: 'Grizzled Warden', rarity: 'legendary', price: 8000,
    description: 'The Grizzled Warden emerges from the shadows of forgotten battlefields, his once-gleaming armor now a patchwork of scars and soot, each mark telling a tale of grim victories and untold sacrifices. Adorned with relics of fallen foes, his presence embodies the haunting burden of a lifetime spent defending the realm against darkness, turning him into a living monument of resilience clad in ash and steel.',
    portraitArt: '/assets/art/skins/tyrant_forest_inspired_dark_bear_skin_portrait.webp',
    splashArt: '/assets/art/skins/tyrant_forest_inspired_dark_bear_skin_splash_wide.webp',
    bannerArt: '/assets/art/skins/tyrant_forest_inspired_dark_bear_skin_banner.webp',
    loadingArt: '/assets/art/skins/tyrant_forest_inspired_dark_bear_skin_loading.webp',
    iconArt: '/assets/art/skins/tyrant_forest_inspired_dark_bear_skin_icon.webp',
  },
};

/**
 * Resolve an animation clip path.
 * If clipKey contains '/' it's treated as a direct path relative to /assets/animations/.
 * Otherwise it's looked up in SHARED_ANIMATIONS (e.g. 'idle' → 'idle.glb' → shared path).
 * @param {string} clipKey — key from SHARED_ANIMATIONS or a direct rig path (e.g. 'rigs/tyrant_frost_dragon/run.glb')
 * @returns {string|null} URL path to the GLB file
 */
export function resolveAnimationPath(clipKey) {
  if (!clipKey) return null;
  // Direct rig-specific path (e.g. 'rigs/tyrant_frost_dragon/run.glb')
  if (clipKey.includes('/')) {
    return '/assets/animations/' + clipKey;
  }
  const file = SHARED_ANIMATIONS[clipKey];
  if (!file || file === '__procedural__') return null;
  return ANIM_BASE + file;
}

/**
 * Get the animation map for a class, optionally merged with skin-specific overrides.
 * @param {string} classId
 * @param {string} [skinId] — skin identifier (e.g. 'frost_dragon'). Omit or 'default' for base class.
 * @returns {object} map of ability/state name → shared clip key or rig path
 */
export function getClassAnimationMap(classId, skinId) {
  const base = CLASS_ANIMATIONS[classId.toLowerCase()] || {};
  if (skinId && skinId !== 'default') {
    const skinKey = `${classId.toLowerCase()}_${skinId}`;
    const raw = SKIN_ANIMATIONS[skinKey] || {};
    // Strip metadata keys — only return animation mappings
    const { weaponsBakedIn, modelScale, ...overrides } = raw;
    return { ...base, ...overrides };
  }
  return base;
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
      default: 'char_tyrant.glb',
      frost_dragon: 'skins/tyrant_frost_dragon.glb',
      ashen_overlord: 'skins/tyrant_ashen_overlord.glb',
      forest_inspired_dark_bear_skin: 'skins/tyrant_forest_inspired_dark_bear_skin.glb',
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
      bear_axe: 'wpn_tyrant_bear_axe.glb',
    },
    defaultWeapon: 'greatsword',
    skinWeapons: {
      forest_inspired_dark_bear_skin: 'bear_axe',
      ashen_overlord: 'greatsword',
    },
    weaponHand: 'both',
    weaponOffset: {
      mace: {
        position: [0, 0.15, 0.025],
        rotation: [-1.5916, 1.6584, 0.0084],
        scale: [0.7, 0.7, 0.7],
      },
      greatsword: {
        position: [0.095, 0.185, -0.475],
        rotation: [-2.5916, 0.4584, 0.5584],
        scale: [0.65, 0.65, 0.65],
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
      frozen_reaper: 'skins/wraith_frozen_reaper.glb',
    },
    skin: {
      diffuse:   TEXTURE_BASE + 'skin_wraith/diffuse.png',
      normal:    TEXTURE_BASE + 'skin_wraith/normal.png',
      roughness: TEXTURE_BASE + 'skin_wraith/roughness.png',
      metallic:  TEXTURE_BASE + 'skin_wraith/metallic.png',
    },
    weapons: {
      daggers: 'wpn_wraith_daggers.glb',
      dark_murder_crow_forest_inspired_skulls_daggers: 'wpn_wraith_dark_murder_crow_forest_inspired_skulls_daggers.glb',
    },
    defaultWeapon: 'daggers',
    skinWeapons: {
      dark_murder_crow_forest_inspired_skulls: 'dark_murder_crow_forest_inspired_skulls_daggers',
    },
    weaponHand: 'dual',
    weaponOffset: {
      daggers: {
        position: [-0.005, 0.16, -0.195],
        rotation: [1.7084, 1.7584, -3.0416],
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
      frost_dragon_skeleton_inspired_ice_wizar: 'skins/infernal_frost_dragon_skeleton_inspired_ice_wizar.glb',
    },
    skin: {
      diffuse:   TEXTURE_BASE + 'skin_infernal/diffuse.png',
      normal:    TEXTURE_BASE + 'skin_infernal/normal.png',
      roughness: TEXTURE_BASE + 'skin_infernal/roughness.png',
      metallic:  TEXTURE_BASE + 'skin_infernal/metallic.png',
    },
    weapons: {
      staff: 'wpn_infernal_staff.glb',
      staff_classic: 'wpn_infernal_staff_classic.glb',
    },
    defaultWeapon: 'staff',
    weaponHand: 'right',
    weaponOffset: {
      staff: {
        position: [0.055, 0.115, -0.075],
        rotation: [-1.3916, -1.7916, 0.0084],
        scale: [0.7, 0.7, 0.7],
      },
      staff_classic: {
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
      frozen_ice_dragon_skeleton_warlock: 'skins/harbinger_frozen_ice_dragon_skeleton_warlock.glb',
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
      frozen_ice_holy_paladin_fallen_dragon: 'skins/revenant_frozen_ice_holy_paladin_fallen_dragon.glb',
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
    // On mobile, use decimated model if it's the default (non-skin) model
    if (_isMobile && skin === 'default') {
      const mobileFile = file.replace('.glb', '_mobile.glb');
      return MODEL_BASE + mobileFile;
    }
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
    const charFile = entry.character.default;
    paths.push(MODEL_BASE + (_isMobile ? charFile.replace('.glb', '_mobile.glb') : charFile));
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
