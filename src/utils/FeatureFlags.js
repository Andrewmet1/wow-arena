// Feature flags — gate in-progress features so they ship to prod invisibly,
// then flip a single switch to launch.
//
// Three sources, in priority order (first match wins):
//   1. URL param  e.g. ?dungeon=1 (also accepts =0 to force-off)
//   2. localStorage  (URL params are sticky after first visit)
//   3. default (off)
//
// Usage:
//   import { isFeatureEnabled } from './utils/FeatureFlags.js';
//   if (isFeatureEnabled('dungeon')) { ... }
//
// Manual toggle from devtools:
//   __features.set('dungeon', true)
//   __features.set('dungeon', false)
//   __features.list()

const STORAGE_KEY = 'ec_feature_flags';
const KNOWN_FLAGS = ['dungeon']; // add new flags here as we build them

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveToStorage(flags) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(flags));
  } catch {
    /* private mode / quota — no-op */
  }
}

const flags = loadFromStorage();

// Apply URL params on load, persist to localStorage so they stick across reloads.
// `?dungeon=1` enables; `?dungeon=0` disables.
try {
  const params = new URLSearchParams(window.location.search);
  let touched = false;
  for (const flag of KNOWN_FLAGS) {
    if (params.has(flag)) {
      const v = params.get(flag);
      flags[flag] = v === '1' || v === 'true';
      touched = true;
    }
  }
  if (touched) saveToStorage(flags);
} catch {
  /* SSR / no window — no-op */
}

// Flags that must NEVER activate in a production build, even if a user has
// enabled them via URL or localStorage. Hard-gated to dev mode only.
const DEV_ONLY_FLAGS = new Set(['dungeon']);
const IS_PROD_BUILD = (() => {
  try { return import.meta.env?.PROD === true; } catch { return false; }
})();

export function isFeatureEnabled(name) {
  if (IS_PROD_BUILD && DEV_ONLY_FLAGS.has(name)) return false;
  return flags[name] === true;
}

export function setFeatureFlag(name, enabled) {
  flags[name] = !!enabled;
  saveToStorage(flags);
}

// Devtools helper — exposes a small surface so we can flip flags from the
// browser console on a live build without redeploying.
if (typeof window !== 'undefined') {
  window.__features = {
    set: setFeatureFlag,
    get: isFeatureEnabled,
    list: () => ({ ...flags }),
    clear: () => {
      for (const k of Object.keys(flags)) delete flags[k];
      saveToStorage(flags);
    },
  };
}
