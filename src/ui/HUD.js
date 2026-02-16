/**
 * HUD.js — Dark Fantasy Ebon Crucible Game HUD
 *
 * Creates and manages all HTML/CSS UI overlay elements rendered on top of the
 * Three.js canvas. Attach to a #hud DOM element that sits above the <canvas>.
 */

import * as THREE from 'three';
import { getAbilityIcon } from './IconGenerator.js';

// Class colors shared across HUD — used by unit frames and nameplates
const CLASS_COLORS = {
  tyrant: '#8B0000', wraith: '#2D1B69',
  infernal: '#FF4500', harbinger: '#006400', revenant: '#F5F5DC'
};

export class HUD {
  // ───────────────────────────────────────────────
  //  Construction
  // ───────────────────────────────────────────────

  constructor(hudElement) {
    /** @type {HTMLElement} */
    this.root = hudElement;
    this.root.classList.add('hud-root');

    // Inject all CSS first
    this.createStyles();

    // Build DOM skeleton
    this._buildMatchTimer();
    this._buildModifierBar();
    this._buildEnemyFrame();
    this._buildEnemyCastBar();
    this._buildPlayerCastBar();
    this._buildPlayerFrame();

    // CC status indicator
    this.ccIndicator = this._el('div', 'cc-indicator');
    this.ccIndicator.style.display = 'none';
    this.root.appendChild(this.ccIndicator);

    this._buildAbilityBar();
    this._buildCombatTextContainer();

    // Ghost-bar bookkeeping (delayed drain)
    this._playerGhostTimeout = null;
    this._enemyGhostTimeout = null;
    this._prevPlayerHpPct = 1;
    this._prevEnemyHpPct = 1;

    // Nameplate bookkeeping
    /** @type {Map<number, HTMLElement>} */
    this._nameplates = new Map();
  }

  // ───────────────────────────────────────────────
  //  CSS Injection
  // ───────────────────────────────────────────────

  createStyles() {
    if (document.getElementById('hud-injected-styles')) return;

    const style = document.createElement('style');
    style.id = 'hud-injected-styles';
    style.textContent = `
/* ========== Root ========== */
.hud-root {
  position: absolute;
  inset: 0;
  pointer-events: none;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: #e0d8c8;
  z-index: 10;
  overflow: hidden;
  user-select: none;
}
.hud-root * {
  box-sizing: border-box;
}

/* Allow pointer events on interactive elements */
.hud-root .ability-bar,
.hud-root .ability-slot {
  pointer-events: auto;
}

/* ========== Match Timer ========== */
.match-timer {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0,0,0,0.7);
  border: 1px solid #5a4a32;
  border-radius: 4px;
  padding: 4px 18px;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 2px;
  color: #e0d8c8;
  text-shadow: 0 0 6px rgba(0,0,0,0.9);
  min-width: 90px;
  text-align: center;
}

/* ========== Modifier Bar ========== */
.modifier-bar {
  position: absolute;
  top: 12px;
  right: 16px;
  display: flex;
  gap: 6px;
  flex-direction: row;
}
.modifier-icon {
  width: 36px;
  height: 36px;
  background: rgba(0,0,0,0.65);
  border: 1px solid #5a4a32;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  color: #e0d8c8;
  text-align: center;
  line-height: 1.1;
}

/* ========== Unit Frames (shared) ========== */
.unit-frame {
  position: absolute;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  background: rgba(0,0,0,0.75);
  border: 1px solid #5a4a32;
  border-radius: 4px;
  padding: 8px 10px;
}
.unit-frame.player {
  top: 20px;
  left: 20px;
}
.unit-frame.enemy {
  top: 20px;
  right: 20px;
}
.uf-portrait {
  width: 48px;
  height: 48px;
  border-radius: 4px;
  border: 2px solid #5a4a32;
  object-fit: cover;
  object-position: center 15%;
  flex-shrink: 0;
  background: #111;
}
.uf-content {
  flex: 1;
  min-width: 0;
  width: 220px;
}

/* Header row */
.uf-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.uf-name {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  text-shadow: 0 1px 3px rgba(0,0,0,0.8);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}
.uf-class-icon {
  width: 18px;
  height: 18px;
  border-radius: 3px;
  border: 1px solid #5a4a32;
  flex-shrink: 0;
}

/* Secondary resource bar (combo points, holy power, etc.) */
.uf-secondary-resource {
  display: flex;
  gap: 4px;
  align-items: center;
  justify-content: center;
  height: 16px;
  margin-bottom: 3px;
}
.uf-secondary-resource .resource-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #333;
  border: 1px solid #555;
  transition: background 0.15s, box-shadow 0.15s;
}
.uf-secondary-resource .resource-dot.active {
  border-color: #aa9;
  box-shadow: 0 0 4px currentColor;
}

/* HP Bar */
.uf-hp-bar {
  position: relative;
  height: 22px;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 3px;
}
.uf-hp-ghost {
  position: absolute;
  top: 0; left: 0;
  height: 100%;
  width: 100%;
  background: #aa4444;
  transition: width 0.5s ease-out;
  z-index: 1;
}
.uf-hp-fill {
  position: absolute;
  top: 0; left: 0;
  height: 100%;
  width: 100%;
  background: #44aa44;
  transition: width 0.25s ease-out, background-color 0.3s;
  z-index: 2;
}
.uf-hp-absorb {
  position: absolute;
  top: 0;
  height: 100%;
  width: 0%;
  background: rgba(255,255,255,0.25);
  border-left: 2px solid rgba(255,255,255,0.5);
  z-index: 3;
  transition: width 0.25s ease-out, left 0.25s ease-out;
}
.uf-hp-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0,0,0,0.9);
  z-index: 4;
}

/* Resource Bar */
.uf-resource-bar {
  position: relative;
  height: 14px;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 4px;
}
.uf-resource-fill {
  position: absolute;
  top: 0; left: 0;
  height: 100%;
  width: 0%;
  transition: width 0.2s ease-out, background-color 0.3s;
}
.uf-resource-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 600;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0,0,0,0.9);
  z-index: 2;
}

/* Resource bar — combo/holy power dots variant */
.uf-resource-bar.dots-mode {
  background: transparent;
  border: none;
  display: flex;
  gap: 4px;
  align-items: center;
  justify-content: center;
  overflow: visible;
}
.uf-resource-bar.dots-mode .uf-resource-fill,
.uf-resource-bar.dots-mode .uf-resource-text {
  display: none;
}
.resource-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #333;
  border: 1px solid #555;
  transition: background 0.15s;
}
.resource-dot.active {
  border-color: #aa9;
}

/* Auras (buffs / debuffs) */
.uf-auras {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  min-height: 24px;
}
.aura-icon {
  width: 24px;
  height: 24px;
  border-radius: 3px;
  border: 1px solid #5a4a32;
  background: rgba(0,0,0,0.5);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-size: 8px;
  font-weight: 600;
  line-height: 1;
  position: relative;
}
.aura-icon .aura-abbr {
  font-size: 9px;
}
.aura-icon .aura-dur {
  font-size: 7px;
  color: #ccc;
}
.aura-icon.debuff {
  border-color: #8b0000;
}
.aura-icon.buff {
  border-color: #2e7d32;
}

/* ========== Cast Bars ========== */
.cast-bar {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  width: 280px;
  height: 22px;
  background: rgba(0,0,0,0.7);
  border: 1px solid #5a4a32;
  border-radius: 3px;
  overflow: hidden;
  opacity: 0;
  transition: opacity 0.15s;
}
.cast-bar.active {
  opacity: 1;
}
.cast-bar.enemy-cast {
  top: 185px;
}
.cast-bar.player-cast {
  bottom: 260px;
}
.cast-fill {
  position: absolute;
  top: 0; left: 0;
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, #b8860b, #daa520);
  transition: width 0.08s linear;
  z-index: 1;
}
.cast-bar.interruptible .cast-fill {
  background: linear-gradient(90deg, #b8860b, #daa520);
}
.cast-bar.uninterruptible .cast-fill {
  background: linear-gradient(90deg, #666, #888);
}
.cast-name {
  position: absolute;
  left: 8px;
  top: 0;
  height: 100%;
  display: flex;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0,0,0,0.9);
  z-index: 2;
}
.cast-time {
  position: absolute;
  right: 8px;
  top: 0;
  height: 100%;
  display: flex;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0,0,0,0.9);
  z-index: 2;
}

/* ========== Ability Bar ========== */
.ability-bar {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 6px;
}
.ability-slot {
  position: relative;
  width: 52px;
  height: 56px;
  background: rgba(10,10,10,0.85);
  border: 2px solid #5a4a32;
  border-radius: 6px;
  overflow: hidden;
  cursor: default;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.ability-slot.unusable {
  opacity: 0.45;
}
.ability-slot.out-of-range {
  border-color: #8b0000;
  box-shadow: inset 0 0 8px rgba(139,0,0,0.5);
}
.ability-slot.active-highlight {
  border-color: #daa520;
  box-shadow: 0 0 6px rgba(218,165,32,0.6);
}
.ability-icon {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  color: #e0d8c8;
  text-shadow: 0 1px 3px rgba(0,0,0,0.9);
  z-index: 1;
  padding: 3px;
  text-align: center;
  line-height: 1.2;
}
.ability-icon-img {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  display: block;
  margin: 0 auto 2px;
  pointer-events: none;
  transition: opacity 0.15s;
}
.ability-cooldown-sweep {
  position: absolute;
  inset: 0;
  z-index: 2;
  opacity: 0.6;
  pointer-events: none;
}
.ability-cooldown-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 800;
  color: #ffd700;
  text-shadow: 0 0 4px rgba(0,0,0,1);
  z-index: 3;
  opacity: 0;
}
.ability-slot.on-cooldown .ability-cooldown-text {
  opacity: 1;
}
.ability-keybind {
  position: absolute;
  bottom: 1px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 9px;
  font-weight: 600;
  color: #ccc;
  text-shadow: 0 1px 2px rgba(0,0,0,0.9);
  z-index: 4;
}

/* GCD sweep overlay */
.ability-gcd-overlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  opacity: 0;
  pointer-events: none;
  border-radius: 4px;
}
.ability-slot.on-gcd {
  border-color: #666 !important;
}
.ability-slot.on-gcd .ability-icon {
  filter: brightness(0.6);
}

/* Ability press flash */
.ability-slot.ability-flash {
  animation: abilityFlash 0.15s ease-out;
}
@keyframes abilityFlash {
  0% { filter: brightness(1.8); }
  100% { filter: brightness(1); }
}

/* Ability failed flash (GCD, cooldown, etc.) */
.ability-slot.ability-failed-flash {
  animation: abilityFailedFlash 0.3s ease-out;
}
@keyframes abilityFailedFlash {
  0% { border-color: #ff3333; box-shadow: inset 0 0 12px rgba(255,50,50,0.6); }
  100% { border-color: #444; box-shadow: none; }
}
.ability-slot .ability-fail-text {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
  font-size: 9px; font-weight: bold; color: #ff4444; text-shadow: 0 0 4px #000;
  pointer-events: none; opacity: 0; transition: opacity 0.2s;
}
.ability-slot.ability-failed-flash .ability-fail-text {
  opacity: 1;
}

/* ========== Swing Timer ========== */
.swing-timer-bar {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  width: 340px;
  height: 6px;
  background: rgba(0,0,0,0.6);
  border: 1px solid #333;
  border-radius: 3px;
  overflow: hidden;
}
.swing-timer-fill {
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, #c08030, #e0a040);
  transition: width 0.08s linear;
  border-radius: 2px;
}

/* ========== Ability Tooltip ========== */
.ability-tooltip {
  position: fixed;
  bottom: 100px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(10,10,15,0.95);
  border: 1px solid #5a4a32;
  border-radius: 6px;
  padding: 10px 14px;
  color: #e0d8c8;
  font-size: 12px;
  line-height: 1.5;
  pointer-events: none;
  z-index: 200;
  max-width: 280px;
  display: none;
}
.ability-tooltip .tt-name {
  font-weight: 700;
  font-size: 14px;
  color: #ffd700;
  margin-bottom: 4px;
}
.ability-tooltip .tt-cost {
  color: #4488ff;
  font-size: 11px;
}
.ability-tooltip .tt-cd {
  color: #aaa;
  font-size: 11px;
}
.ability-tooltip .tt-desc {
  color: #ccc;
  margin-top: 4px;
  font-size: 11px;
}

/* ========== CC Status Indicator ========== */
.cc-indicator {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 18px;
  font-weight: 900;
  letter-spacing: 3px;
  text-transform: uppercase;
  z-index: 100;
  text-shadow: 0 0 10px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.8);
  animation: ccPulse 0.8s ease-in-out infinite;
  pointer-events: none;
  white-space: nowrap;
}
@keyframes ccPulse {
  0%, 100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  50% { opacity: 0.7; transform: translate(-50%, -50%) scale(1.1); }
}

/* ========== Combat Text ========== */
.combat-text-container {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 20;
}
.combat-text {
  position: absolute;
  font-weight: 700;
  white-space: nowrap;
  pointer-events: none;
  animation: float-up 1.5s ease-out forwards;
  text-shadow: 0 0 4px rgba(0,0,0,1), 0 0 8px rgba(0,0,0,0.6);
  z-index: 21;
}
.combat-text.damage {
  color: #e04040;
  font-size: 18px;
}
.combat-text.heal {
  color: #40c040;
  font-size: 18px;
}
.combat-text.crit {
  color: #ff3030;
  font-size: 26px;
  font-weight: 900;
}
.combat-text.cc {
  color: #ffd700;
  font-size: 16px;
  font-style: italic;
}
.combat-text.immune {
  color: #ffffff;
  font-size: 15px;
  font-style: italic;
}

@keyframes float-up {
  0% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  20% {
    opacity: 1;
    transform: translateY(-18px) scale(1.05);
  }
  100% {
    opacity: 0;
    transform: translateY(-70px) scale(0.85);
  }
}

/* ========== HUD visibility ========== */
.hud-root.hidden {
  display: none;
}

/* ========== World-Space Nameplates ========== */
.nameplate {
  position: fixed;
  z-index: 1000;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  transform: translate(-50%, -100%);
  white-space: nowrap;
}
.nameplate-name {
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 0 4px rgba(0,0,0,1), 0 1px 2px rgba(0,0,0,0.9);
  margin-bottom: 2px;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}
.nameplate-hp-bar {
  width: 80px;
  height: 6px;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 3px;
  overflow: hidden;
}
.nameplate-hp-fill {
  height: 100%;
  width: 100%;
  transition: width 0.2s ease-out;
  border-radius: 2px;
}
`;
    document.head.appendChild(style);
  }

  // ───────────────────────────────────────────────
  //  DOM Builders
  // ───────────────────────────────────────────────

  _buildMatchTimer() {
    this.matchTimer = this._el('div', 'match-timer', '0:00');
    this.root.appendChild(this.matchTimer);
  }

  _buildModifierBar() {
    this.modifierBar = this._el('div', 'modifier-bar');
    this.root.appendChild(this.modifierBar);
  }

  // --- Enemy Unit Frame ---
  _buildEnemyFrame() {
    const frame = this._buildUnitFrame('enemy');
    this.enemyFrame = frame;
    this.root.appendChild(frame.root);
  }

  // --- Player Unit Frame ---
  _buildPlayerFrame() {
    const frame = this._buildUnitFrame('player');
    this.playerFrame = frame;
    this.root.appendChild(frame.root);
  }

  /**
   * Shared builder for unit frames. Returns an object with DOM refs.
   */
  _buildUnitFrame(type) {
    const root = this._el('div', `unit-frame ${type}`);

    // Portrait
    const portrait = document.createElement('img');
    portrait.className = 'uf-portrait';
    portrait.src = '';
    portrait.alt = '';
    root.appendChild(portrait);

    // Content wrapper (everything to right of portrait)
    const content = this._el('div', 'uf-content');

    // Header
    const header = this._el('div', 'uf-header');
    const name = this._el('span', 'uf-name', '---');
    const classIcon = this._el('span', 'uf-class-icon');
    header.appendChild(name);
    header.appendChild(classIcon);
    content.appendChild(header);

    // HP bar
    const hpBar = this._el('div', 'uf-hp-bar');
    const hpGhost = this._el('div', 'uf-hp-ghost');
    const hpFill = this._el('div', 'uf-hp-fill');
    const hpAbsorb = this._el('div', 'uf-hp-absorb');
    const hpText = this._el('span', 'uf-hp-text', '--- / ---');
    hpBar.appendChild(hpGhost);
    hpBar.appendChild(hpFill);
    hpBar.appendChild(hpAbsorb);
    hpBar.appendChild(hpText);
    content.appendChild(hpBar);

    // Resource bar
    const resourceBar = this._el('div', 'uf-resource-bar');
    const resourceFill = this._el('div', 'uf-resource-fill');
    const resourceText = this._el('span', 'uf-resource-text', '');
    resourceBar.appendChild(resourceFill);
    resourceBar.appendChild(resourceText);
    content.appendChild(resourceBar);

    // Secondary resource (combo points, holy power, etc.)
    const secondaryResource = this._el('div', 'uf-secondary-resource');
    secondaryResource.style.display = 'none';
    content.appendChild(secondaryResource);

    // Auras
    const auras = this._el('div', 'uf-auras');
    content.appendChild(auras);

    root.appendChild(content);

    return {
      root,
      portrait,
      name,
      classIcon,
      hpBar,
      hpFill,
      hpGhost,
      hpAbsorb,
      hpText,
      resourceBar,
      resourceFill,
      resourceText,
      secondaryResource,
      auras,
      _dots: [], // for primary resource dots
      _secondaryDots: [], // for secondary resource dots
      _currentClassId: null
    };
  }

  // --- Cast Bars ---
  _buildEnemyCastBar() {
    this.enemyCast = this._buildCastBar('enemy-cast');
    this.root.appendChild(this.enemyCast.root);
  }

  _buildPlayerCastBar() {
    this.playerCast = this._buildCastBar('player-cast');
    this.root.appendChild(this.playerCast.root);
  }

  _buildCastBar(extraClass) {
    const root = this._el('div', `cast-bar ${extraClass}`);
    const fill = this._el('div', 'cast-fill');
    const nameSpan = this._el('span', 'cast-name', '');
    const timeSpan = this._el('span', 'cast-time', '');
    root.appendChild(fill);
    root.appendChild(nameSpan);
    root.appendChild(timeSpan);
    return { root, fill, name: nameSpan, time: timeSpan };
  }

  // --- Ability Bar ---
  _buildAbilityBar() {
    this.abilityBar = this._el('div', 'ability-bar');
    this.abilitySlots = [];

    for (let i = 0; i < 6; i++) {
      const slot = this._el('div', 'ability-slot');
      slot.dataset.key = String(i + 1);

      const icon = this._el('div', 'ability-icon', '');
      const iconImg = document.createElement('img');
      iconImg.className = 'ability-icon-img';
      iconImg.style.display = 'none'; // hidden until setupAbilityBar sets the src
      icon.appendChild(iconImg);

      const sweep = this._el('div', 'ability-cooldown-sweep');
      const cdText = this._el('div', 'ability-cooldown-text', '');
      const keybind = this._el('div', 'ability-keybind', this._keybindLabel(i));
      const gcdOverlay = this._el('div', 'ability-gcd-overlay');

      const failText = this._el('div', 'ability-fail-text', '');

      slot.appendChild(icon);
      slot.appendChild(sweep);
      slot.appendChild(cdText);
      slot.appendChild(keybind);
      slot.appendChild(gcdOverlay);
      slot.appendChild(failText);

      this.abilityBar.appendChild(slot);
      this.abilitySlots.push({ root: slot, icon, iconImg, sweep, cdText, keybind, gcdOverlay, failText });

      slot.style.pointerEvents = 'auto';
      const slotIndex = i;
      slot.addEventListener('mouseenter', () => this._showTooltip(slotIndex));
      slot.addEventListener('mouseleave', () => this._hideTooltip());
    }

    // Tooltip element
    this.tooltip = this._el('div', 'ability-tooltip');
    this.tooltip.innerHTML = '<div class="tt-name"></div><div class="tt-cost"></div><div class="tt-cd"></div><div class="tt-desc"></div>';
    this.root.appendChild(this.tooltip);

    this.root.appendChild(this.abilityBar);

    // Swing timer bar (melee auto-attacks)
    this.swingTimerBar = this._el('div', 'swing-timer-bar');
    this.swingTimerFill = this._el('div', 'swing-timer-fill');
    this.swingTimerBar.appendChild(this.swingTimerFill);
    this.swingTimerBar.style.display = 'none';
    this.root.appendChild(this.swingTimerBar);

    // Dodge roll cooldown indicator
    this._dodgeRollIndicator = this._el('div', 'dodge-roll-indicator');
    this._dodgeRollIndicator.style.cssText = `
      position: absolute; bottom: 80px; left: 50%; transform: translateX(-50%);
      width: 36px; height: 36px; border-radius: 50%;
      background: rgba(0,0,0,0.7); border: 2px solid #888;
      display: flex; align-items: center; justify-content: center;
      font-size: 10px; color: #fff; font-family: monospace;
      pointer-events: none; z-index: 200;
    `;
    this._dodgeRollIndicator.title = 'Dodge Roll (Shift+WASD)';
    this._dodgeRollInner = this._el('div');
    this._dodgeRollInner.style.cssText = `
      width: 100%; height: 100%; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 9px; color: #ccc;
    `;
    this._dodgeRollInner.textContent = 'ROLL';
    this._dodgeRollIndicator.appendChild(this._dodgeRollInner);
    this.root.appendChild(this._dodgeRollIndicator);
  }

  /**
   * Returns a keybind label for slot index 0-11.
   * Slots 0-9 => "1"-"0", 10 => "-", 11 => "="
   */
  _keybindLabel(index) {
    if (index < 9) return String(index + 1);
    if (index === 9) return '0';
    if (index === 10) return '-';
    return '=';
  }

  // --- Combat Text Container ---
  _buildCombatTextContainer() {
    this.combatTextContainer = this._el('div', 'combat-text-container');
    this.root.appendChild(this.combatTextContainer);
  }

  // ───────────────────────────────────────────────
  //  Update Methods
  // ───────────────────────────────────────────────

  /**
   * Update the match timer display.
   * @param {number} tick — current game tick (assumes 60 ticks/sec or similar; caller provides seconds)
   * If you pass raw ticks, divide by your tick-rate first.
   * This method expects **seconds** (float or int).
   */
  updateTimer(seconds) {
    const totalSec = Math.max(0, Math.floor(seconds));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    this.matchTimer.textContent = `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  /**
   * Update dodge roll cooldown indicator.
   * @param {number} remainingTicks - ticks remaining on cooldown (0 = ready)
   * @param {boolean} isDodging - currently in a dodge roll
   */
  /**
   * Update swing timer bar for melee auto-attacks.
   * @param {number} currentTick
   * @param {number} nextSwingTick - tick when next auto-attack fires
   * @param {number} swingTimer - total ticks between swings
   * @param {boolean} hasMelee - whether unit has melee auto-attacks
   */
  updateSwingTimer(currentTick, nextSwingTick, swingTimer, hasMelee) {
    if (!this.swingTimerBar) return;
    if (!hasMelee) {
      this.swingTimerBar.style.display = 'none';
      return;
    }
    this.swingTimerBar.style.display = '';
    const remaining = Math.max(0, nextSwingTick - currentTick);
    const progress = swingTimer > 0 ? 1 - (remaining / swingTimer) : 1;
    this.swingTimerFill.style.width = `${(Math.min(1, progress) * 100).toFixed(1)}%`;
  }

  flashAbilityFailed(abilityId, reason) {
    if (!this._abilityOrder) return;
    const idx = this._abilityOrder.indexOf(abilityId);
    if (idx === -1 || idx >= this.abilitySlots.length) return;

    const slot = this.abilitySlots[idx];
    const reasonLabels = {
      gcd: 'NOT READY', cooldown: 'ON CD', resource: 'NO MANA',
      out_of_range: 'RANGE', no_los: 'NO LOS', casting: 'CASTING',
      silenced: 'SILENCED', cc: 'STUNNED', school_locked: 'LOCKED'
    };
    slot.failText.textContent = reasonLabels[reason] || 'FAILED';
    slot.root.classList.remove('ability-failed-flash');
    // Force reflow to restart animation
    void slot.root.offsetWidth;
    slot.root.classList.add('ability-failed-flash');
    setTimeout(() => slot.root.classList.remove('ability-failed-flash'), 300);
  }

  showErrorMessage(text) {
    // Throttle — don't spam the same message
    if (this._lastErrorMsg === text && Date.now() - (this._lastErrorTime || 0) < 800) return;
    this._lastErrorMsg = text;
    this._lastErrorTime = Date.now();

    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = `
      position: absolute; top: 35%; left: 50%; transform: translate(-50%, -50%);
      font-size: 22px; font-weight: 900; letter-spacing: 3px; color: #ff4444;
      text-shadow: 0 0 8px rgba(255,0,0,0.6), 0 2px 4px rgba(0,0,0,0.8);
      pointer-events: none; z-index: 100; white-space: nowrap;
      animation: errorMsgAnim 1.2s ease-out forwards;
    `;
    this.root.appendChild(el);
    setTimeout(() => el.remove(), 1300);

    // Inject keyframes once
    if (!document.getElementById('error-msg-keyframes')) {
      const style = document.createElement('style');
      style.id = 'error-msg-keyframes';
      style.textContent = `
        @keyframes errorMsgAnim {
          0% { opacity: 1; transform: translate(-50%, -50%) scale(1.1); }
          30% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -70%) scale(0.95); }
        }
      `;
      document.head.appendChild(style);
    }
  }

  updateDodgeRollIndicator(remainingTicks, isDodging) {
    if (!this._dodgeRollIndicator) return;

    if (isDodging) {
      this._dodgeRollIndicator.style.borderColor = '#00ffff';
      this._dodgeRollInner.textContent = '...';
      this._dodgeRollInner.style.color = '#00ffff';
    } else if (remainingTicks > 0) {
      const seconds = Math.ceil(remainingTicks / 10);
      this._dodgeRollIndicator.style.borderColor = '#555';
      this._dodgeRollInner.textContent = `${seconds}s`;
      this._dodgeRollInner.style.color = '#888';
    } else {
      this._dodgeRollIndicator.style.borderColor = '#4CAF50';
      this._dodgeRollInner.textContent = 'ROLL';
      this._dodgeRollInner.style.color = '#4CAF50';
    }
  }

  /**
   * Show active modifier icons.
   * @param {Array<{name: string, abbr: string}>} modifiers
   */
  updateModifiers(modifiers) {
    this.modifierBar.innerHTML = '';
    if (!modifiers || modifiers.length === 0) return;

    for (const mod of modifiers) {
      const icon = this._el('div', 'modifier-icon', mod.abbr || mod.name?.slice(0, 4) || '?');
      icon.title = mod.name || '';
      this.modifierBar.appendChild(icon);
    }
  }

  /**
   * Update the player unit frame.
   * @param {object} unit — expects { name, hp, maxHp, absorb?, resource, maxResource, resourceType, classColor?, auras? }
   *   auras: [{ name, abbr, duration?, type: 'buff'|'debuff' }]
   */
  updatePlayerFrame(unit) {
    if (!unit) return;
    this._updateUnitFrame(this.playerFrame, unit, 'player');
  }

  /**
   * Update the enemy unit frame.
   * @param {object} unit — same shape as player
   */
  updateEnemyFrame(unit) {
    if (!unit) return;
    this._updateUnitFrame(this.enemyFrame, unit, 'enemy');
  }

  /**
   * Internal unit-frame updater.
   */
  _updateUnitFrame(frame, unit, who) {
    // Name
    frame.name.textContent = unit.name || '---';

    // Portrait
    if (unit.classId && frame._currentClassId !== unit.classId) {
      frame.portrait.src = `assets/art/${unit.classId}_splash.webp`;
      frame.portrait.alt = unit.name || '';
      frame._currentClassId = unit.classId;
    }

    // Class icon colour
    if (unit.classColor) {
      frame.classIcon.style.background = unit.classColor;
    }

    // HP
    const hp = Math.max(0, unit.hp ?? 0);
    const maxHp = Math.max(1, unit.maxHp ?? 1);
    const hpPct = Math.min(1, hp / maxHp);

    // Fill colour based on %
    let hpColor;
    if (hpPct > 0.5) hpColor = '#44aa44';
    else if (hpPct > 0.25) hpColor = '#aaaa44';
    else hpColor = '#aa4444';

    frame.hpFill.style.width = `${(hpPct * 100).toFixed(1)}%`;
    frame.hpFill.style.backgroundColor = hpColor;

    // Ghost bar logic — delayed drain
    const prevPctKey = who === 'player' ? '_prevPlayerHpPct' : '_prevEnemyHpPct';
    const ghostTimeoutKey = who === 'player' ? '_playerGhostTimeout' : '_enemyGhostTimeout';

    if (hpPct < this[prevPctKey]) {
      // HP went down — keep ghost at old width, then after delay shrink
      // Ghost is already at previous width due to CSS transition delay
      if (this[ghostTimeoutKey]) clearTimeout(this[ghostTimeoutKey]);
      this[ghostTimeoutKey] = setTimeout(() => {
        frame.hpGhost.style.width = `${(hpPct * 100).toFixed(1)}%`;
      }, 500);
    } else {
      // HP went up or stayed same — snap ghost
      if (this[ghostTimeoutKey]) clearTimeout(this[ghostTimeoutKey]);
      frame.hpGhost.style.width = `${(hpPct * 100).toFixed(1)}%`;
    }
    this[prevPctKey] = hpPct;

    // Absorb overlay
    const absorb = Math.max(0, unit.absorb ?? 0);
    if (absorb > 0 && maxHp > 0) {
      const absorbPct = Math.min(1 - hpPct, absorb / maxHp);
      frame.hpAbsorb.style.left = `${(hpPct * 100).toFixed(1)}%`;
      frame.hpAbsorb.style.width = `${(absorbPct * 100).toFixed(1)}%`;
    } else {
      frame.hpAbsorb.style.width = '0%';
    }

    // HP text
    frame.hpText.textContent = `${this._formatNum(hp)} / ${this._formatNum(maxHp)}`;

    // Resource
    const resourceType = (unit.resourceType || 'mana').toLowerCase();
    const isDotResource = resourceType === 'combo_points' || resourceType === 'holy_power';

    if (isDotResource) {
      this._renderDotResource(frame, unit);
    } else {
      this._renderBarResource(frame, unit, resourceType);
    }

    // Secondary resource (combo points, holy power, soul shards, cinder stacks)
    if (unit.secondaryResourceType) {
      frame.secondaryResource.style.display = 'flex';
      this._renderSecondaryDots(frame, unit);
    } else {
      frame.secondaryResource.style.display = 'none';
    }

    // Auras
    this._renderAuras(frame, unit.auras, who);
  }

  /**
   * Render bar-style resource (mana, rage, energy).
   */
  _renderBarResource(frame, unit, resourceType) {
    // Ensure bar mode
    frame.resourceBar.classList.remove('dots-mode');
    frame.resourceFill.style.display = '';
    frame.resourceText.style.display = '';

    // Remove any lingering dots
    for (const d of frame._dots) d.remove();
    frame._dots = [];

    const res = Math.max(0, unit.resource ?? 0);
    const maxRes = Math.max(1, unit.maxResource ?? 1);
    const pct = Math.min(1, res / maxRes);

    const colorMap = {
      rage: '#c03030',
      energy: '#d4c438',
      mana: '#3070cc',
      focus: '#d4884a',
      runic_power: '#5090c0'
    };

    frame.resourceFill.style.width = `${(pct * 100).toFixed(1)}%`;
    frame.resourceFill.style.backgroundColor = colorMap[resourceType] || '#3070cc';

    const label = resourceType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    frame.resourceText.textContent = `${label}: ${Math.floor(res)}/${Math.floor(maxRes)}`;
  }

  /**
   * Render dot-style resource (combo points, holy power).
   */
  _renderDotResource(frame, unit) {
    frame.resourceBar.classList.add('dots-mode');
    frame.resourceFill.style.display = 'none';
    frame.resourceText.style.display = 'none';

    const maxRes = Math.max(1, unit.maxResource ?? 5);
    const current = Math.max(0, Math.floor(unit.resource ?? 0));

    const dotColor = unit.resourceType === 'holy_power' ? '#daa520' : '#d4c438';

    // Rebuild dots if count changed
    if (frame._dots.length !== maxRes) {
      for (const d of frame._dots) d.remove();
      frame._dots = [];
      for (let i = 0; i < maxRes; i++) {
        const dot = this._el('div', 'resource-dot');
        frame.resourceBar.appendChild(dot);
        frame._dots.push(dot);
      }
    }

    for (let i = 0; i < frame._dots.length; i++) {
      const active = i < current;
      frame._dots[i].classList.toggle('active', active);
      frame._dots[i].style.backgroundColor = active ? dotColor : '#333';
    }
  }

  /**
   * Render secondary resource as dots (combo points, holy power, etc.)
   */
  _renderSecondaryDots(frame, unit) {
    const maxRes = Math.max(1, unit.secondaryMaxResource ?? 5);
    const current = Math.max(0, Math.floor(unit.secondaryResource ?? 0));
    const type = unit.secondaryResourceType;

    const colorMap = {
      combo_points: '#d4c438',
      holy_power: '#daa520',
      soul_shards: '#9b59b6',
      cinder_stacks: '#e67e22'
    };
    const dotColor = colorMap[type] || '#d4c438';

    // Rebuild dots if count changed
    if (frame._secondaryDots.length !== maxRes) {
      for (const d of frame._secondaryDots) d.remove();
      frame._secondaryDots = [];
      for (let i = 0; i < maxRes; i++) {
        const dot = this._el('div', 'resource-dot');
        frame.secondaryResource.appendChild(dot);
        frame._secondaryDots.push(dot);
      }
    }

    for (let i = 0; i < frame._secondaryDots.length; i++) {
      const active = i < current;
      frame._secondaryDots[i].classList.toggle('active', active);
      frame._secondaryDots[i].style.backgroundColor = active ? dotColor : '#333';
      frame._secondaryDots[i].style.color = active ? dotColor : '#333';
    }
  }

  /**
   * Render aura icons in the unit frame.
   */
  _renderAuras(frame, auras, who) {
    frame.auras.innerHTML = '';
    if (!auras || auras.length === 0) return;

    for (const aura of auras) {
      const type = aura.type || (who === 'enemy' ? 'debuff' : 'buff');
      const icon = this._el('div', `aura-icon ${type}`);

      const abbr = this._el('span', 'aura-abbr', aura.abbr || (aura.name || '?').slice(0, 3).toUpperCase());
      icon.appendChild(abbr);

      if (aura.duration != null && aura.duration > 0) {
        const dur = this._el('span', 'aura-dur', `${Math.ceil(aura.duration)}s`);
        icon.appendChild(dur);
      }

      icon.title = aura.name || '';
      frame.auras.appendChild(icon);
    }
  }

  /**
   * Update the ability bar.
   * @param {object} unit — expects unit.abilities: Array<{ id, name, abbr?, cooldownRemaining?, cooldownTotal?, gcd?, usable?, inRange? }>
   * @param {number} currentTick — current game tick for cooldown calculation
   */
  updateAbilityBar(unit, currentTick) {
    if (!unit || !unit.abilities) return;
    const abilities = unit.abilities;

    for (let i = 0; i < this.abilitySlots.length; i++) {
      const slot = this.abilitySlots[i];
      const ability = abilities[i];

      if (!ability) {
        // Empty slot — clear text without destroying the <img> child
        this._clearIconText(slot.icon, slot.iconImg);
        slot.iconImg.style.opacity = '1';
        slot.cdText.textContent = '';
        slot.sweep.style.background = 'none';
        slot.root.classList.remove('on-cooldown', 'unusable', 'out-of-range', 'on-gcd', 'active-highlight');
        continue;
      }

      // Icon label — only set text fallback if no image is loaded
      if (!slot.iconImg.src || slot.iconImg.style.display === 'none') {
        this._setIconText(slot.icon, slot.iconImg, ability.abbr || ability.name?.slice(0, 4) || '');
      }

      // Cooldown state
      const cdRemain = ability.cooldownRemaining ?? 0;
      const cdTotal = ability.cooldownTotal ?? 0;
      const onCooldown = cdRemain > 0 && cdTotal > 0;

      slot.root.classList.toggle('on-cooldown', onCooldown);

      if (onCooldown) {
        // Sweep overlay — conic gradient clockwise
        const fraction = Math.min(1, cdRemain / cdTotal);
        const degrees = fraction * 360;
        slot.sweep.style.background =
          `conic-gradient(rgba(0,0,0,0.7) ${degrees}deg, transparent ${degrees}deg)`;

        // Cooldown text (show seconds remaining)
        const secs = Math.ceil(cdRemain);
        slot.cdText.textContent = secs > 0 ? `${secs}s` : '';

        // Dim the icon image while on cooldown
        slot.iconImg.style.opacity = '0.4';
      } else {
        slot.sweep.style.background = 'none';
        slot.cdText.textContent = '';

        // Restore icon image opacity
        slot.iconImg.style.opacity = '1';
      }

      // GCD sweep overlay (conic-gradient like cooldown sweep)
      const onGCD = !!(ability.gcd && ability.gcd > 0);
      const wasOnGCD = slot.root.classList.contains('on-gcd');
      if (onGCD && !onCooldown) {
        const gcdFraction = Math.min(1, ability.gcd / 1.5);
        const gcdDegrees = gcdFraction * 360;
        slot.gcdOverlay.style.background =
          `conic-gradient(rgba(255,255,255,0.35) ${gcdDegrees}deg, transparent ${gcdDegrees}deg)`;
        slot.gcdOverlay.style.opacity = '1';
        // Flash on GCD start
        if (!wasOnGCD) {
          slot.root.classList.add('ability-flash');
          setTimeout(() => slot.root.classList.remove('ability-flash'), 150);
        }
        slot.root.classList.add('on-gcd');
      } else {
        slot.gcdOverlay.style.background = 'none';
        slot.gcdOverlay.style.opacity = '0';
        slot.root.classList.remove('on-gcd');
      }

      // Usability
      const usable = ability.usable !== false && !onCooldown;
      slot.root.classList.toggle('unusable', !usable);

      // Range
      const inRange = ability.inRange !== false;
      slot.root.classList.toggle('out-of-range', !inRange && usable);

      // Active highlight (e.g., proc)
      slot.root.classList.toggle('active-highlight', !!(ability.highlight));
    }
  }

  /**
   * Update a cast bar.
   * @param {object} unit — expects unit.casting: { name, progress (0-1), castTime (sec), interruptible? } or null
   * @param {number} currentTick
   * @param {'player'|'enemy'} who
   */
  updateCastBar(unit, currentTick, who) {
    const bar = who === 'player' ? this.playerCast : this.enemyCast;
    const casting = unit?.casting;

    if (!casting) {
      bar.root.classList.remove('active', 'interruptible', 'uninterruptible');
      return;
    }

    bar.root.classList.add('active');
    bar.root.classList.toggle('interruptible', casting.interruptible !== false);
    bar.root.classList.toggle('uninterruptible', casting.interruptible === false);

    const progress = Math.max(0, Math.min(1, casting.progress ?? 0));
    bar.fill.style.width = `${(progress * 100).toFixed(1)}%`;

    bar.name.textContent = casting.name || 'Casting...';

    const remaining = Math.max(0, (casting.castTime ?? 0) * (1 - progress));
    bar.time.textContent = `${remaining.toFixed(1)}s`;
  }

  // ───────────────────────────────────────────────
  //  World-Space Nameplates
  // ───────────────────────────────────────────────

  /**
   * Create or update world-space nameplates projected above each unit.
   * Call every frame from the render loop.
   * @param {Array<{id: number, classId: string, hp: number, maxHp: number, position: {x: number, y: number, z: number}, alive: boolean}>} units
   * @param {THREE.PerspectiveCamera} camera
   * @param {THREE.WebGLRenderer} renderer
   */
  updateNameplates(units, camera, renderer) {
    if (!units || !camera || !renderer) return;

    // Ensure the camera's matrixWorldInverse is current before projecting.
    // CameraController.update() calls camera.lookAt() which updates matrixWorld
    // but NOT matrixWorldInverse; we must sync it here so project() works.
    camera.updateMatrixWorld();

    const canvas = renderer.domElement;
    const canvasW = canvas.clientWidth;
    const canvasH = canvas.clientHeight;

    const seen = new Set();

    for (const unit of units) {
      seen.add(unit.id);

      // Hide nameplates for dead units
      if (!unit.alive) {
        const existing = this._nameplates.get(unit.id);
        if (existing) existing.style.display = 'none';
        continue;
      }

      // Project world position (x, y+4, z) to screen
      const worldPos = new THREE.Vector3(unit.position.x, (unit.position.y || 0) + 8, unit.position.z);
      worldPos.project(camera);

      // Behind camera — hide
      if (worldPos.z > 1) {
        const existing = this._nameplates.get(unit.id);
        if (existing) existing.style.display = 'none';
        continue;
      }

      const screenX = (worldPos.x * 0.5 + 0.5) * canvasW;
      const screenY = (-worldPos.y * 0.5 + 0.5) * canvasH;

      // Get or create nameplate element
      let plate = this._nameplates.get(unit.id);
      if (!plate) {
        plate = this._createNameplate(unit);
        this._nameplates.set(unit.id, plate);
        document.body.appendChild(plate);
      }

      // Update position
      plate.style.left = `${screenX}px`;
      plate.style.top = `${screenY}px`;
      plate.style.display = 'flex';

      // Update HP fill
      const hpPct = Math.max(0, Math.min(1, unit.hp / Math.max(1, unit.maxHp)));
      const fill = plate.querySelector('.nameplate-hp-fill');
      if (fill) {
        fill.style.width = `${(hpPct * 100).toFixed(1)}%`;
      }
    }

    // Remove nameplates for units that no longer exist
    for (const [id, plate] of this._nameplates) {
      if (!seen.has(id)) {
        plate.remove();
        this._nameplates.delete(id);
      }
    }
  }

  /**
   * Create a nameplate DOM element for a unit.
   */
  _createNameplate(unit) {
    const plate = document.createElement('div');
    plate.className = 'nameplate';

    const nameEl = document.createElement('div');
    nameEl.className = 'nameplate-name';
    nameEl.textContent = unit.classId ? unit.classId.charAt(0).toUpperCase() + unit.classId.slice(1) : 'Unknown';
    plate.appendChild(nameEl);

    const barOuter = document.createElement('div');
    barOuter.className = 'nameplate-hp-bar';

    const barFill = document.createElement('div');
    barFill.className = 'nameplate-hp-fill';
    barFill.style.backgroundColor = CLASS_COLORS[unit.classId] || '#44aa44';
    barOuter.appendChild(barFill);

    plate.appendChild(barOuter);
    return plate;
  }

  /**
   * Remove all nameplate elements from the DOM.
   */
  cleanupNameplates() {
    for (const [, plate] of this._nameplates) {
      plate.remove();
    }
    this._nameplates.clear();
  }

  /**
   * Spawn a floating combat text element.
   * @param {number} screenX — pixel X on screen
   * @param {number} screenY — pixel Y on screen
   * @param {string} text — e.g. "-12,450" or "+8,200" or "Stunned"
   * @param {'damage'|'heal'|'crit'|'cc'|'immune'} type
   */
  spawnCombatText(screenX, screenY, text, type) {
    const el = document.createElement('div');
    el.className = `combat-text ${type || 'damage'}`;
    el.textContent = text;

    // Small random horizontal jitter to avoid stacking
    const jitterX = (Math.random() - 0.5) * 40;
    el.style.left = `${screenX + jitterX}px`;
    el.style.top = `${screenY}px`;

    this.combatTextContainer.appendChild(el);

    // Remove after animation finishes
    el.addEventListener('animationend', () => el.remove());

    // Safety cleanup in case animationend doesn't fire
    setTimeout(() => {
      if (el.parentNode) el.remove();
    }, 2000);
  }

  // ───────────────────────────────────────────────
  //  Tooltip Methods
  // ───────────────────────────────────────────────

  _showTooltip(slotIndex) {
    if (!this._tooltipData || !this._tooltipData[slotIndex]) return;
    const data = this._tooltipData[slotIndex];
    const tt = this.tooltip;
    tt.querySelector('.tt-name').textContent = data.name || '';
    tt.querySelector('.tt-cost').textContent = data.cost || '';
    tt.querySelector('.tt-cd').textContent = data.cooldown || '';
    tt.querySelector('.tt-desc').textContent = data.description || '';
    tt.style.display = 'block';
  }

  _hideTooltip() {
    if (this.tooltip) this.tooltip.style.display = 'none';
  }

  // ───────────────────────────────────────────────
  //  CC Status
  // ───────────────────────────────────────────────

  updateCCStatus(unitData) {
    if (!this.ccIndicator) return;

    // Check for CC effects
    const ccTypes = [];
    if (unitData.isStunned) ccTypes.push({ text: 'STUNNED', color: '#ffcc00' });
    if (unitData.isSilenced) ccTypes.push({ text: 'SILENCED', color: '#aa44ff' });
    if (unitData.isRooted) ccTypes.push({ text: 'ROOTED', color: '#44cc44' });
    if (unitData.isFeared) ccTypes.push({ text: 'FEARED', color: '#8800aa' });
    if (unitData.isIncapacitated) ccTypes.push({ text: 'INCAPACITATED', color: '#4488ff' });

    if (ccTypes.length > 0) {
      const cc = ccTypes[0]; // Show most important
      this.ccIndicator.textContent = cc.text;
      this.ccIndicator.style.color = cc.color;
      this.ccIndicator.style.display = 'block';
    } else {
      this.ccIndicator.style.display = 'none';
    }
  }

  // ───────────────────────────────────────────────
  //  Visibility
  // ───────────────────────────────────────────────

  show() {
    this.root.classList.remove('hidden');
  }

  hide() {
    this.root.classList.add('hidden');
  }

  // ───────────────────────────────────────────────
  //  Helpers
  // ───────────────────────────────────────────────

  /**
   * Create an element with className(s) and optional text content.
   */
  _el(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  /**
   * Remove only text-node children from an icon container, preserving the
   * <img> element. Using `textContent = ''` would destroy child elements.
   */
  _clearIconText(iconDiv, iconImg) {
    // Remove all children, then re-append the <img> so it is not lost.
    while (iconDiv.firstChild) iconDiv.removeChild(iconDiv.firstChild);
    iconDiv.appendChild(iconImg);
  }

  /**
   * Set fallback text in an icon container while keeping the <img> child.
   */
  _setIconText(iconDiv, iconImg, text) {
    while (iconDiv.firstChild) iconDiv.removeChild(iconDiv.firstChild);
    iconDiv.appendChild(iconImg);
    if (text) {
      iconDiv.appendChild(document.createTextNode(text));
    }
  }

  /**
   * Format large numbers with commas: 82400 -> "82,400"
   */
  _formatNum(n) {
    return Math.floor(n).toLocaleString('en-US');
  }

  /**
   * Setup ability bar with class abilities.
   * @param {object} classDef — class definition with abilities array
   * @param {string[]} abilityOrder — ordered ability IDs
   */
  setupAbilityBar(classDef, abilityOrder) {
    this._abilityOrder = abilityOrder;
    this._tooltipData = [];
    const schoolColors = {
      physical: '#aaa', fire: '#ff4400', frost: '#4488ff', arcane: '#aa44ff',
      shadow: '#6600aa', holy: '#ffd700', nature: '#44cc44'
    };

    for (let i = 0; i < this.abilitySlots.length; i++) {
      const slot = this.abilitySlots[i];
      if (i < abilityOrder.length) {
        const abilityId = abilityOrder[i];
        const ability = classDef.abilities.find(a => a.id === abilityId);
        if (ability) {
          // Generate procedural icon image
          const school = ability.school || 'physical';
          const iconDataUrl = getAbilityIcon(ability.id, school);
          // Clear text nodes without removing the <img> child element.
          // Using textContent = '' would destroy all children including iconImg.
          this._clearIconText(slot.icon, slot.iconImg);
          slot.iconImg.src = iconDataUrl;
          slot.iconImg.style.display = 'block';

          // Set ability name as tooltip on the slot
          slot.root.title = ability.name;

          // Color the slot border based on spell school
          const schoolColor = schoolColors[school] || '#888';
          slot.root.style.borderColor = schoolColor;

          // Build cost string
          let costStr = '';
          if (ability.cost) {
            const entries = Object.entries(ability.cost);
            costStr = entries.map(([type, amount]) => `${amount} ${type}`).join(', ');
          }

          // Store tooltip data
          this._tooltipData.push({
            name: ability.name,
            cost: costStr ? `Cost: ${costStr}` : 'No cost',
            cooldown: ability.cooldown > 0 ? `Cooldown: ${(ability.cooldown / 10).toFixed(1)}s` : 'No cooldown',
            description: ability.description || ''
          });
        } else {
          this._clearIconText(slot.icon, slot.iconImg);
          slot.iconImg.style.display = 'none';
          this._tooltipData.push(null);
        }
      } else {
        this._clearIconText(slot.icon, slot.iconImg);
        slot.iconImg.style.display = 'none';
        this._tooltipData.push(null);
      }
    }
  }

  /**
   * Adapt engine Unit to HUD data format for unit frames.
   */
  static adaptUnit(unit) {
    if (!unit) return null;

    // Determine primary resource
    let resourceType = 'mana';
    let resource = 0;
    let maxResource = 100;
    const classColors = CLASS_COLORS;

    // Secondary resources shown as dots
    const SECONDARY_RESOURCE_TYPES = new Set(['combo_points', 'holy_power', 'cinder_stacks', 'soul_shards']);
    let secondaryResourceType = null;
    let secondaryResource = 0;
    let secondaryMaxResource = 0;

    // Find main resource pool and secondary (dot) resource
    let foundPrimary = false;
    for (const [type, pool] of unit.resources.pools) {
      if (SECONDARY_RESOURCE_TYPES.has(type)) {
        secondaryResourceType = type;
        secondaryResource = pool.current;
        secondaryMaxResource = pool.max;
        continue;
      }
      if (!foundPrimary) {
        resourceType = type;
        resource = pool.current;
        maxResource = pool.max;
        foundPrimary = true;
      }
    }

    // Calculate total absorb
    let absorb = 0;
    for (const shield of unit.absorbs) {
      absorb += shield.amount;
    }

    // Build aura list
    const auras = [];
    for (const aura of unit.auras.auras.values()) {
      if (aura.isHidden) continue;
      auras.push({
        name: aura.name,
        abbr: aura.name?.split(' ').map(w => w[0]).join('').slice(0, 3),
        type: aura.type === 'dot' || aura.type === 'debuff' ? 'debuff' : 'buff',
        duration: aura.getRemainingSeconds ? aura.getRemainingSeconds(0) : 0
      });
    }

    return {
      name: unit.name,
      hp: unit.hp,
      maxHp: unit.maxHp,
      absorb,
      resource,
      maxResource,
      resourceType,
      secondaryResource,
      secondaryMaxResource,
      secondaryResourceType,
      classId: unit.classId,
      classColor: classColors[unit.classId] || '#888',
      auras,
      isStunned: unit.isStunned,
      isSilenced: unit.isSilenced,
      isRooted: unit.isRooted,
      isFeared: unit.isFeared,
      isIncapacitated: unit.ccEffects?.some(cc => cc.type === 'incapacitate') || false,
    };
  }

  /**
   * Adapt ability bar data from engine Unit.
   */
  static adaptAbilities(unit, abilityOrder, currentTick) {
    if (!unit || !abilityOrder) return [];
    const enemy = null; // We don't have enemy ref here; range checks done elsewhere

    return abilityOrder.map(abilityId => {
      const ability = unit.abilities.get(abilityId);
      if (!ability) return null;

      const cdRemaining = unit.cooldowns.getRemaining(abilityId, currentTick) / 10; // ticks to seconds
      const cdTotal = ability.cooldown / 10;
      const gcdRemaining = Math.max(0, unit.gcdEndTick - currentTick) / 10;

      // Check resource
      let canAfford = true;
      if (ability.cost) {
        for (const [type, amount] of Object.entries(ability.cost)) {
          if (!unit.resources.canAfford(type, amount)) {
            canAfford = false;
            break;
          }
        }
      }

      return {
        id: abilityId,
        name: ability.name,
        abbr: ability.name?.split(' ').map(w => w[0]).join('').slice(0, 4),
        cooldownRemaining: cdRemaining,
        cooldownTotal: cdTotal,
        gcd: gcdRemaining,
        usable: canAfford && cdRemaining <= 0 && unit.canAct,
        inRange: true, // Simplified
        highlight: false
      };
    }).filter(Boolean);
  }

  /**
   * Adapt cast bar data from engine Unit.
   */
  static adaptCastBar(unit, currentTick) {
    if (!unit) return null;

    if (unit.castState) {
      const total = unit.castState.endTick - unit.castState.startTick;
      const elapsed = currentTick - unit.castState.startTick;
      const progress = total > 0 ? Math.min(1, elapsed / total) : 1;
      return {
        name: unit.castState.ability?.name || 'Casting',
        progress,
        castTime: total / 10,
        interruptible: !unit.castState.ability?.flags?.includes('cannot_be_interrupted')
      };
    }

    if (unit.channelState) {
      const total = unit.channelState.endTick - unit.channelState.startTick;
      const remaining = unit.channelState.endTick - currentTick;
      const progress = total > 0 ? Math.max(0, remaining / total) : 0;
      return {
        name: unit.channelState.ability?.name || 'Channeling',
        progress,
        castTime: total / 10,
        interruptible: true
      };
    }

    return null;
  }
}
