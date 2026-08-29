/**
 * GamepadUI — Gamepad/keyboard navigation for menu/UI screens.
 * Manages a visual focus ring and lets controller users navigate
 * clickable elements with D-pad/stick + A/B or arrow keys + Enter/Escape.
 *
 * Focus ring hides when mouse is used, re-appears on keyboard/gamepad input.
 */

const DPAD_UP = 12;
const DPAD_DOWN = 13;
const DPAD_LEFT = 14;
const DPAD_RIGHT = 15;
const BTN_A = 0;
const BTN_B = 1;
const STICK_DEADZONE = 0.5;
const NAV_REPEAT_DELAY = 200;

let _active = false;
let _container = null;
let _focusIndex = 0;
let _focusables = [];
let _focusRing = null;
let _pollId = null;
let _prevButtons = new Array(17).fill(false);
let _prevStickNav = { x: 0, y: 0 };
let _lastNavTime = 0;
let _onBack = null;
let _keyHandler = null;
let _mouseHandler = null;
let _inputMode = 'controller';

function _createFocusRing() {
  if (_focusRing) return;
  _focusRing = document.createElement('div');
  _focusRing.id = 'gamepad-focus-ring';
  _focusRing.style.cssText = `
    position: fixed; pointer-events: none; z-index: 99998;
    border: 2px solid #c8a860; border-radius: 6px;
    box-shadow: 0 0 12px rgba(200,168,96,0.4), inset 0 0 12px rgba(200,168,96,0.1);
    transition: top 0.15s ease-out, left 0.15s ease-out, width 0.15s ease-out, height 0.15s ease-out;
    display: none;
  `;
  document.body.appendChild(_focusRing);
}

function _removeFocusRing() {
  if (_focusRing) { _focusRing.remove(); _focusRing = null; }
}

function _setInputMode(mode) {
  _inputMode = mode;
  if (mode === 'mouse') {
    if (_focusRing) _focusRing.style.display = 'none';
  } else {
    _refreshFocusables();
    _updateFocusRing();
  }
}

function _isInViewport(el) {
  const r = el.getBoundingClientRect();
  return r.top < window.innerHeight && r.bottom > 0 && r.left < window.innerWidth && r.right > 0;
}

function _isVisible(el) {
  if (el.disabled) return false;
  if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
  if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
  const s = getComputedStyle(el);
  if (s.display === 'none' || s.visibility === 'hidden') return false;
  if (parseFloat(s.opacity) < 0.1) return false;
  // Must be in viewport
  if (!_isInViewport(el)) return false;
  return true;
}

function _isClickable(el) {
  if (!_isVisible(el)) return false;
  if (el.offsetWidth < 24 || el.offsetHeight < 16) return false;
  const s = getComputedStyle(el);
  return s.cursor === 'pointer';
}

function _refreshFocusables() {
  if (!_container) { _focusables = []; return; }

  const candidates = new Set();

  // 1. Buttons, links, inputs, and explicitly marked elements
  for (const el of _container.querySelectorAll('button, a, input, [role="button"], [data-gamepad-focusable]')) {
    if (el.hasAttribute('data-gamepad-skip')) continue;
    if (_isVisible(el)) candidates.add(el);
  }

  // 2. Clickable divs that don't contain buttons/inputs
  for (const el of _container.querySelectorAll('div')) {
    if (candidates.has(el)) continue;
    if (!_isClickable(el)) continue;
    let isChild = false;
    for (const p of candidates) { if (p.contains(el)) { isChild = true; break; } }
    if (isChild) continue;
    if (el.querySelector('button, a, input, [role="button"]')) continue;
    candidates.add(el);
  }

  _focusables = Array.from(candidates);

  // Remove ancestors — prefer the more specific child
  _focusables = _focusables.filter(el => {
    for (const other of _focusables) {
      if (other !== el && el.contains(other)) return false;
    }
    return true;
  });

  // Sort by visual position
  _focusables.sort((a, b) => {
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    if (Math.abs(ar.top - br.top) > 20) return ar.top - br.top;
    return ar.left - br.left;
  });

  if (_focusIndex >= _focusables.length) _focusIndex = Math.max(0, _focusables.length - 1);
}

function _updateFocusRing() {
  if (!_focusRing || _focusables.length === 0 || _inputMode === 'mouse') {
    if (_focusRing) _focusRing.style.display = 'none';
    return;
  }
  const el = _focusables[_focusIndex];
  if (!el) { _focusRing.style.display = 'none'; return; }
  const rect = el.getBoundingClientRect();
  const pad = 3;
  _focusRing.style.display = 'block';
  _focusRing.style.top = `${rect.top - pad}px`;
  _focusRing.style.left = `${rect.left - pad}px`;
  _focusRing.style.width = `${rect.width + pad * 2}px`;
  _focusRing.style.height = `${rect.height + pad * 2}px`;
  el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
}

function _navigate(dx, dy) {
  const now = Date.now();
  if (now - _lastNavTime < NAV_REPEAT_DELAY) return;
  _lastNavTime = now;

  _setInputMode('controller');
  _refreshFocusables();
  if (_focusables.length === 0) return;

  const current = _focusables[_focusIndex]?.getBoundingClientRect();
  if (!current) { _focusIndex = 0; _updateFocusRing(); return; }

  const cx = current.left + current.width / 2;
  const cy = current.top + current.height / 2;

  if (dy !== 0) {
    // Vertical: find nearest element above/below, heavily penalize horizontal distance
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < _focusables.length; i++) {
      if (i === _focusIndex) continue;
      const r = _focusables[i].getBoundingClientRect();
      const ry = r.top + r.height / 2;
      const rx = r.left + r.width / 2;
      if (dy > 0 && ry <= cy + 5) continue;
      if (dy < 0 && ry >= cy - 5) continue;
      const vertDist = Math.abs(ry - cy);
      const horizDist = Math.abs(rx - cx);
      // Strongly prefer elements in the same column (penalize horizontal offset 3x)
      const score = vertDist + horizDist * 3;
      if (score < bestScore) { bestScore = score; best = i; }
    }
    if (best >= 0) _focusIndex = best;
  } else if (dx !== 0) {
    // Horizontal: find nearest in direction, penalize vertical distance
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < _focusables.length; i++) {
      if (i === _focusIndex) continue;
      const r = _focusables[i].getBoundingClientRect();
      const rx = r.left + r.width / 2;
      const ry = r.top + r.height / 2;
      if (dx > 0 && rx <= cx + 5) continue;
      if (dx < 0 && rx >= cx - 5) continue;
      const horizDist = Math.abs(rx - cx);
      const vertDist = Math.abs(ry - cy);
      const score = horizDist + vertDist * 2;
      if (score < bestScore) { bestScore = score; best = i; }
    }
    if (best >= 0) _focusIndex = best;
  }

  _updateFocusRing();
}

function _select() {
  _setInputMode('controller');
  const el = _focusables[_focusIndex];
  if (!el) return;
  // If it's an input, focus it for typing
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    el.focus();
    return;
  }
  el.click();
  setTimeout(() => { _refreshFocusables(); _updateFocusRing(); }, 150);
}

function _poll() {
  if (!_active) return;
  const gp = navigator.getGamepads?.()?.[0] || navigator.getGamepads?.()?.[1];
  if (!gp) { _pollId = requestAnimationFrame(_poll); return; }

  for (let i = 0; i < Math.min(gp.buttons.length, 17); i++) {
    const pressed = gp.buttons[i]?.pressed || false;
    const wasPressed = _prevButtons[i];
    if (pressed && !wasPressed) {
      if (i === BTN_A) _select();
      else if (i === BTN_B && _onBack) _onBack();
      else if (i === DPAD_UP) _navigate(0, -1);
      else if (i === DPAD_DOWN) _navigate(0, 1);
      else if (i === DPAD_LEFT) _navigate(-1, 0);
      else if (i === DPAD_RIGHT) _navigate(1, 0);
    }
    _prevButtons[i] = pressed;
  }

  const sx = gp.axes[0] || 0;
  const sy = gp.axes[1] || 0;
  const stickX = Math.abs(sx) > STICK_DEADZONE ? Math.sign(sx) : 0;
  const stickY = Math.abs(sy) > STICK_DEADZONE ? Math.sign(sy) : 0;
  if (stickX !== _prevStickNav.x || stickY !== _prevStickNav.y) {
    if (stickY !== 0) _navigate(0, stickY);
    else if (stickX !== 0) _navigate(stickX, 0);
  }
  _prevStickNav = { x: stickX, y: stickY };

  _pollId = requestAnimationFrame(_poll);
}

function _attachKeyboard() {
  if (_keyHandler) return;
  _keyHandler = (e) => {
    if (!_active) return;
    const inInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
    switch (e.key) {
      case 'ArrowUp': e.preventDefault(); e.target.blur(); _navigate(0, -1); break;
      case 'ArrowDown': e.preventDefault(); e.target.blur(); _navigate(0, 1); break;
      case 'ArrowLeft': if (!inInput) { e.preventDefault(); _navigate(-1, 0); } break;
      case 'ArrowRight': if (!inInput) { e.preventDefault(); _navigate(1, 0); } break;
      case 'Enter': if (!inInput) { e.preventDefault(); _select(); } break;
      case 'Escape': e.preventDefault(); if (inInput) { e.target.blur(); } else if (_onBack) _onBack(); break;
    }
  };
  window.addEventListener('keydown', _keyHandler);
}

function _detachKeyboard() {
  if (_keyHandler) { window.removeEventListener('keydown', _keyHandler); _keyHandler = null; }
}

function _attachMouse() {
  if (_mouseHandler) return;
  _mouseHandler = () => { if (_active) _setInputMode('mouse'); };
  window.addEventListener('mousemove', _mouseHandler);
}

function _detachMouse() {
  if (_mouseHandler) { window.removeEventListener('mousemove', _mouseHandler); _mouseHandler = null; }
}

export const GamepadUI = {
  activate(container, opts = {}) {
    // Skip on mobile/touch devices — GamepadUI is for desktop controllers only
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) return;
    _container = container;
    _onBack = opts.onBack || null;
    _focusIndex = 0;
    _active = true;
    _inputMode = 'controller';
    _prevButtons = new Array(17).fill(false);
    _prevStickNav = { x: 0, y: 0 };
    _createFocusRing();
    _refreshFocusables();
    _updateFocusRing();
    _attachKeyboard();
    _attachMouse();
    if (!_pollId) _pollId = requestAnimationFrame(_poll);
  },

  deactivate() {
    _active = false;
    _container = null;
    _focusables = [];
    _onBack = null;
    if (_pollId) { cancelAnimationFrame(_pollId); _pollId = null; }
    _detachKeyboard();
    _detachMouse();
    _removeFocusRing();
  },

  refresh() {
    if (!_active) return;
    _refreshFocusables();
    _updateFocusRing();
  },

  get isActive() { return _active; },
};
