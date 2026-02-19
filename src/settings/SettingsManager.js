/**
 * SettingsManager — localStorage-backed settings with defaults.
 * Stores keybindings, gamepad config, and other user preferences.
 */

const STORAGE_KEY = 'ebon_crucible_settings';

const DEFAULT_GAMEPAD_MAPPING = {
  0: 'ability_1',   // A
  1: 'ability_2',   // B
  2: 'ability_3',   // X
  3: 'ability_4',   // Y
  4: 'ability_5',   // LB
  5: 'ability_6',   // RB
  6: 'target',      // LT
  7: 'dodge',       // RT
  9: 'settings',    // Start
  12: 'tab_target', // D-pad up
};

const DEFAULTS = {
  keybindings: {
    0: '1',
    1: '2',
    2: '3',
    3: '4',
    4: '5',
    5: '6',
  },
  controls: {
    moveForward: 'w',
    moveBackward: 's',
    moveLeft: 'a',
    moveRight: 'd',
    jump: ' ',
    dodge: 'shift',
    tabTarget: 'tab',
  },
  gamepad: {
    enabled: true,
    cameraSensitivity: 1.0,
    deadzone: 0.15,
    mapping: { ...DEFAULT_GAMEPAD_MAPPING },
  },
  camera: {
    keyboardMode: 'classic',   // 'classic' (WoW-style) or 'action' (auto-follow)
    controllerMode: 'action',  // 'classic' or 'action'
  },
};

export class SettingsManager {
  constructor() {
    this._settings = this._load();
    this._listeners = [];
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Merge with defaults so new fields are always present
        return this._deepMerge(structuredClone(DEFAULTS), parsed);
      }
    } catch (e) {
      console.warn('SettingsManager: failed to load settings', e);
    }
    return structuredClone(DEFAULTS);
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._settings));
    } catch (e) {
      console.warn('SettingsManager: failed to save settings', e);
    }
  }

  _deepMerge(target, source) {
    for (const key of Object.keys(source)) {
      if (
        source[key] !== null &&
        typeof source[key] === 'object' &&
        !Array.isArray(source[key]) &&
        typeof target[key] === 'object' &&
        target[key] !== null
      ) {
        this._deepMerge(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
    return target;
  }

  /**
   * Get a setting by dot-path (e.g., 'gamepad.deadzone').
   */
  get(path) {
    const parts = path.split('.');
    let obj = this._settings;
    for (const p of parts) {
      if (obj == null) return undefined;
      obj = obj[p];
    }
    return obj;
  }

  /**
   * Set a setting by dot-path and auto-save.
   */
  set(path, value) {
    const parts = path.split('.');
    let obj = this._settings;
    for (let i = 0; i < parts.length - 1; i++) {
      if (obj[parts[i]] == null) obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;
    this._save();
    this._notify(path, value);
  }

  /**
   * Get the key assigned to an ability slot (0-5). Returns the key string.
   */
  getKeybinding(slot) {
    return this._settings.keybindings[slot] ?? DEFAULTS.keybindings[slot];
  }

  /**
   * Set a custom keybinding for a slot (0-5).
   */
  setKeybinding(slot, key) {
    // Remove this key from any other slot to prevent duplicates
    for (const s of Object.keys(this._settings.keybindings)) {
      if (this._settings.keybindings[s] === key && String(s) !== String(slot)) {
        this._settings.keybindings[s] = null;
      }
    }
    this._settings.keybindings[slot] = key;
    this._save();
    this._notify('keybindings', this._settings.keybindings);
  }

  /**
   * Get a control binding by action name (e.g. 'moveForward').
   */
  getControl(action) {
    return this._settings.controls?.[action] ?? DEFAULTS.controls[action];
  }

  /**
   * Set a control binding by action name.
   */
  setControl(action, key) {
    if (!this._settings.controls) this._settings.controls = {};
    // Prevent duplicate bindings across controls
    for (const a of Object.keys(this._settings.controls)) {
      if (this._settings.controls[a] === key && a !== action) {
        this._settings.controls[a] = null;
      }
    }
    this._settings.controls[action] = key;
    this._save();
    this._notify('controls', this._settings.controls);
  }

  /**
   * Get all control bindings.
   */
  getAllControls() {
    return { ...DEFAULTS.controls, ...this._settings.controls };
  }

  /**
   * Reset all keybindings to defaults.
   */
  resetKeybindings() {
    this._settings.keybindings = structuredClone(DEFAULTS.keybindings);
    this._settings.controls = structuredClone(DEFAULTS.controls);
    this._save();
    this._notify('keybindings', this._settings.keybindings);
    this._notify('controls', this._settings.controls);
  }

  /**
   * Reset gamepad settings to defaults.
   */
  resetGamepad() {
    this._settings.gamepad = structuredClone(DEFAULTS.gamepad);
    this._save();
    this._notify('gamepad', this._settings.gamepad);
  }

  /**
   * Reset everything to defaults.
   */
  resetAll() {
    this._settings = structuredClone(DEFAULTS);
    this._save();
    this._notify('all', this._settings);
  }

  /**
   * Subscribe to setting changes.
   * @param {function} fn - Called with (path, value) on changes.
   * @returns {function} Unsubscribe function.
   */
  onChange(fn) {
    this._listeners.push(fn);
    return () => {
      this._listeners = this._listeners.filter(l => l !== fn);
    };
  }

  _notify(path, value) {
    for (const fn of this._listeners) {
      try { fn(path, value); } catch (e) { console.warn('SettingsManager listener error', e); }
    }
  }

  /**
   * Get the gamepad button mapping.
   */
  getGamepadMapping() {
    return this._settings.gamepad.mapping;
  }

  /**
   * Set a single gamepad button mapping.
   * @param {number} buttonIndex - Gamepad button index (0-16)
   * @param {string|null} action - Action name or null to unbind
   */
  setGamepadButton(buttonIndex, action) {
    if (!this._settings.gamepad.mapping) {
      this._settings.gamepad.mapping = { ...DEFAULT_GAMEPAD_MAPPING };
    }
    if (action === null || action === '') {
      delete this._settings.gamepad.mapping[buttonIndex];
    } else {
      this._settings.gamepad.mapping[buttonIndex] = action;
    }
    this._save();
    this._notify('gamepad.mapping', this._settings.gamepad.mapping);
  }

  /**
   * Get all keybindings as a slot->key map.
   */
  getAllKeybindings() {
    return { ...this._settings.keybindings };
  }
}

export { DEFAULT_GAMEPAD_MAPPING, DEFAULTS };
