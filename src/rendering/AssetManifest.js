/**
 * AssetManifest — Scalable asset registry for characters, weapons, and skins.
 *
 * Adding a new skin or weapon is as simple as adding an entry here.
 * No code changes required in loaders or renderers.
 */

const MODEL_BASE = '/assets/models/';

export const ASSET_MANIFEST = {
  tyrant: {
    name: 'Tyrant',
    character: {
      default: 'char_tyrant.glb',
      // future skins: blood_knight: 'char_tyrant_blood_knight.glb'
    },
    weapons: {
      greatsword: 'wpn_tyrant_greatsword.glb',
    },
    defaultWeapon: 'greatsword',
    weaponHand: 'both', // two-handed
    scale: 1.0,
    rigConfig: {
      headThreshold: 0.82,
      armThreshold: 0.55,
      armX: 0.18,
      legThreshold: 0.38,
      blendMargin: 0.06,
    },
  },

  wraith: {
    name: 'Wraith',
    character: {
      default: 'char_wraith.glb',
    },
    weapons: {
      daggers: 'wpn_wraith_daggers.glb',
    },
    defaultWeapon: 'daggers',
    weaponHand: 'dual', // dual wield
    scale: 0.95,
    rigConfig: {
      headThreshold: 0.84,
      armThreshold: 0.58,
      armX: 0.16,
      legThreshold: 0.40,
      blendMargin: 0.06,
    },
  },

  infernal: {
    name: 'Infernal',
    character: {
      default: 'char_infernal.glb',
    },
    weapons: {
      staff: 'wpn_infernal_staff.glb',
    },
    defaultWeapon: 'staff',
    weaponHand: 'right', // staff in right hand
    scale: 1.0,
    rigConfig: {
      headThreshold: 0.83,
      armThreshold: 0.56,
      armX: 0.17,
      legThreshold: 0.38,
      blendMargin: 0.07,
    },
  },

  harbinger: {
    name: 'Harbinger',
    character: {
      default: 'char_harbinger.glb',
    },
    weapons: {
      staff: 'wpn_harbinger_staff.glb',
    },
    defaultWeapon: 'staff',
    weaponHand: 'right',
    scale: 1.0,
    rigConfig: {
      headThreshold: 0.82,
      armThreshold: 0.55,
      armX: 0.17,
      legThreshold: 0.37,
      blendMargin: 0.07,
    },
  },

  revenant: {
    name: 'Revenant',
    character: {
      default: 'char_revenant.glb',
    },
    weapons: {
      mace_shield: 'wpn_revenant_mace_shield.glb',
    },
    defaultWeapon: 'mace_shield',
    weaponHand: 'dual', // mace right, shield left
    scale: 1.0,
    rigConfig: {
      headThreshold: 0.83,
      armThreshold: 0.56,
      armX: 0.18,
      legThreshold: 0.38,
      blendMargin: 0.06,
    },
  },
};

/**
 * Resolve a model path from the manifest.
 * @param {string} classId - e.g. 'tyrant'
 * @param {'character'|'weapon'} type
 * @param {string} [variant] - skin name or weapon type
 * @returns {string} full path
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
 * @returns {string[]}
 */
export function getAllModelPaths() {
  const paths = [];
  for (const [, entry] of Object.entries(ASSET_MANIFEST)) {
    // Default character
    paths.push(MODEL_BASE + entry.character.default);
    // All weapons
    for (const [, file] of Object.entries(entry.weapons)) {
      paths.push(MODEL_BASE + file);
    }
  }
  return paths;
}

/**
 * Get rig config for a class.
 * @param {string} classId
 * @returns {object}
 */
export function getRigConfig(classId) {
  const entry = ASSET_MANIFEST[classId.toLowerCase()];
  return entry?.rigConfig || ASSET_MANIFEST.tyrant.rigConfig;
}
