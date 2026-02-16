import * as THREE from 'three';
import { MatchState } from './engine/MatchState.js';
import { GameLoop } from './engine/GameLoop.js';
import { Unit } from './engine/Unit.js';
import { AIController } from './ai/AIController.js';
import { PlayerController } from './input/PlayerController.js';
import { InputManager } from './input/InputManager.js';
import { SceneManager } from './rendering/SceneManager.js';
import { ArenaRenderer } from './rendering/ArenaRenderer.js';
import CharacterRenderer from './rendering/CharacterRenderer.js';
import { CameraController } from './rendering/CameraController.js';
import { SpellEffects, VFX_TEXTURES } from './rendering/SpellEffects.js';
import { HUD } from './ui/HUD.js';
import { EventScheduler } from './arena/EventScheduler.js';
import { selectModifiers } from './arena/ArenaModifiers.js';
import { CLASS_REGISTRY, ALL_CLASSES } from './classes/ClassRegistry.js';
import { Vec3 } from './utils/Vec3.js';
import { SeededRandom } from './utils/Random.js';
import { EventBus, EVENTS } from './utils/EventBus.js';
import { getAbilityIcon, getClassEmblem, getClassPortrait } from './ui/IconGenerator.js';
import { AudioManager } from './audio/AudioManager.js';
import { DODGE_ROLL_DURATION, DODGE_ROLL_COOLDOWN, DODGE_ROLL_SNARE, DODGE_ROLL_SNARE_RANGE, DODGE_ROLL_SNARE_DURATION } from './constants.js';
import { Aura } from './engine/Aura.js';

// ---------------------------------------------------------------------------
// Error overlay — shows runtime errors visually
// ---------------------------------------------------------------------------
function showError(msg, err) {
  console.error(msg, err);
  let overlay = document.getElementById('error-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'error-overlay';
    overlay.style.cssText = `
      position:fixed;top:0;left:0;width:100%;height:100%;
      background:rgba(0,0,0,0.92);color:#ff4444;z-index:9999;
      padding:40px;font-family:monospace;font-size:14px;overflow:auto;
    `;
    document.body.appendChild(overlay);
  }
  overlay.innerHTML += `<div style="margin-bottom:16px"><b>${msg}</b><br><pre style="color:#aaa;font-size:12px;white-space:pre-wrap">${err?.stack || err || ''}</pre></div>`;
}

class Game {
  constructor() {
    this.sceneManager = null;
    this.arenaRenderer = null;
    this.characterRenderer = null;
    this.cameraController = null;
    this.spellEffects = null;
    this.hud = null;
    this.inputManager = null;
    this.gameLoop = null;
    this.matchState = null;
    this.eventScheduler = null;

    this.playerClassId = null;
    this.enemyClassId = null;
    this.difficulty = 'medium';
    this._abilityOrder = [];

    // FPS counter state
    this._fpsFrameCount = 0;
    this._fpsLastTime = performance.now();
    this._fpsDisplay = null;

    // Match stats tracking
    this._matchStats = { playerDamage: 0, playerHealing: 0, playerDamageTaken: 0, enemyDamage: 0, enemyHealing: 0, enemyDamageTaken: 0 };

    // Audio
    this.audio = new AudioManager();

    // Jump states map: unitId -> { startTime, duration, done }
    this._jumpStates = new Map();

    // Raycaster for click-to-target
    this._raycaster = new THREE.Raycaster();

    // Store playerController reference for click targeting
    this.playerController = null;

    // Pending match-end timeout (must be clearable for Play Again)
    this._matchEndTimeout = null;
  }

  async init() {
    try {
      this.updateLoadingBar(10);

      const canvas = document.getElementById('game-canvas');
      if (!canvas) throw new Error('Canvas element #game-canvas not found');

      // CSS vignette overlay (replaces shader-based vignette for performance)
      const vignette = document.createElement('div');
      vignette.id = 'vignette-overlay';
      vignette.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        pointer-events: none; z-index: 100;
        box-shadow: inset 0 0 150px rgba(0,0,0,0.7);
      `;
      document.body.appendChild(vignette);

      // FPS counter
      this._fpsDisplay = document.createElement('div');
      this._fpsDisplay.id = 'fps-counter';
      this._fpsDisplay.style.cssText = `
        position: fixed; top: 8px; right: 8px;
        color: #fff; font-size: 12px; font-family: monospace;
        background: rgba(0,0,0,0.5); padding: 4px 8px;
        border-radius: 4px; z-index: 9999; pointer-events: none;
      `;
      this._fpsDisplay.textContent = 'FPS: --';
      document.body.appendChild(this._fpsDisplay);

      this.sceneManager = new SceneManager(canvas);
      await this.sceneManager.init();
      this.updateLoadingBar(30);

      this.arenaRenderer = new ArenaRenderer(this.sceneManager.getScene());
      this.arenaRenderer.build();
      this.updateLoadingBar(50);

      this.characterRenderer = new CharacterRenderer(this.sceneManager.getScene());

      this.cameraController = new CameraController(this.sceneManager.getCamera());
      this.cameraController.attachEvents(canvas);
      this.updateLoadingBar(60);

      this.spellEffects = new SpellEffects(this.sceneManager.getScene());

      const hudElement = document.getElementById('hud');
      this.hud = new HUD(hudElement);
      this.updateLoadingBar(70);

      this.inputManager = new InputManager();
      this.inputManager.attach();
      this.updateLoadingBar(80);

      // Test render to verify Three.js pipeline works
      this.sceneManager.render();
      this.updateLoadingBar(100);

      // Initialize audio system
      this.audio.init();
      this._createSettingsButton();

      console.log('[Game] Init complete');
      this._injectScreenAnimations();
      setTimeout(() => this.showHomeScreen(), 300);
    } catch (err) {
      showError('Failed to initialize game', err);
    }
  }

  _injectScreenAnimations() {
    if (document.getElementById('ebon-screen-animations')) return;
    const style = document.createElement('style');
    style.id = 'ebon-screen-animations';
    style.textContent = `
      @keyframes titleGlow {
        0% { text-shadow: 0 0 40px rgba(139,0,0,0.6), 0 0 80px rgba(139,0,0,0.3), 0 4px 12px rgba(0,0,0,0.8); }
        100% { text-shadow: 0 0 60px rgba(200,168,96,0.8), 0 0 120px rgba(139,0,0,0.5), 0 4px 12px rgba(0,0,0,0.8); }
      }
      @keyframes playBtnPulse {
        0%, 100% { box-shadow: 0 0 30px rgba(139,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1); }
        50% { box-shadow: 0 0 50px rgba(139,0,0,0.8), 0 0 80px rgba(200,168,96,0.3), inset 0 1px 0 rgba(255,255,255,0.15); }
      }
      @keyframes homeBgPan {
        0% { transform: scale(1.05) translate(0, 0); }
        100% { transform: scale(1.1) translate(-1%, -1%); }
      }
      @keyframes fadeInUp {
        from { opacity: 0; transform: translateY(30px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes victoryTitleGlow {
        0% { text-shadow: 0 0 40px rgba(255,215,0,0.6), 0 0 80px rgba(255,215,0,0.3), 0 4px 16px rgba(0,0,0,0.9); }
        100% { text-shadow: 0 0 80px rgba(255,215,0,0.9), 0 0 150px rgba(255,215,0,0.5), 0 4px 16px rgba(0,0,0,0.9); }
      }
      @keyframes defeatTitleGlow {
        0% { text-shadow: 0 0 40px rgba(139,0,0,0.6), 0 0 80px rgba(139,0,0,0.3), 0 4px 16px rgba(0,0,0,0.9); }
        100% { text-shadow: 0 0 80px rgba(139,0,0,0.9), 0 0 150px rgba(80,0,0,0.5), 0 4px 16px rgba(0,0,0,0.9); }
      }
      @keyframes particleFloat {
        0% { transform: translateY(0) translateX(0); opacity: 0; }
        10% { opacity: 1; }
        90% { opacity: 1; }
        100% { transform: translateY(-100vh) translateX(50px); opacity: 0; }
      }
      @keyframes slideInLeft {
        from { opacity: 0; transform: translateX(-40px); }
        to { opacity: 1; transform: translateX(0); }
      }
      @keyframes slideInRight {
        from { opacity: 0; transform: translateX(40px); }
        to { opacity: 1; transform: translateX(0); }
      }
      @keyframes cardReveal {
        from { opacity: 0; transform: translateY(20px) scale(0.95); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes panelSlideIn {
        from { opacity: 0; transform: translateX(60px); }
        to { opacity: 1; transform: translateX(0); }
      }
      @keyframes panelSlideDown {
        from { opacity: 0; transform: translateY(-20px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes abilityRowReveal {
        from { opacity: 0; transform: translateX(20px); }
        to { opacity: 1; transform: translateX(0); }
      }
      @keyframes sectionReveal {
        from { opacity: 0; transform: translateY(40px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes logoShine {
        0%, 100% { filter: brightness(1) drop-shadow(0 0 20px rgba(200,168,96,0.4)); }
        50% { filter: brightness(1.3) drop-shadow(0 0 40px rgba(200,168,96,0.7)); }
      }
      @keyframes scrollBounce {
        0%, 100% { transform: translateX(-50%) translateY(0); }
        50% { transform: translateX(-50%) translateY(10px); }
      }
    `;
    document.head.appendChild(style);
  }

  _spawnScreenParticles(container, count, color) {
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      const size = 2 + Math.random() * 4;
      const left = Math.random() * 100;
      const delay = Math.random() * 8;
      const dur = 6 + Math.random() * 6;
      p.style.cssText = `
        position: absolute; bottom: -10px; left: ${left}%;
        width: ${size}px; height: ${size}px; border-radius: 50%;
        background: ${color}; opacity: 0; pointer-events: none;
        animation: particleFloat ${dur}s ${delay}s ease-out infinite;
      `;
      container.appendChild(p);
    }
  }

  _createSettingsButton() {
    // Gear button — always visible (top-right, below FPS)
    const btn = document.createElement('button');
    btn.id = 'settings-btn';
    btn.innerHTML = '&#9881;'; // ⚙
    btn.style.cssText = `
      position: fixed; top: 32px; right: 8px; z-index: 10000;
      background: rgba(0,0,0,0.6); border: 1px solid #2a2a3a; color: #888;
      font-size: 18px; width: 32px; height: 32px; border-radius: 4px;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: all 0.2s; pointer-events: auto;
    `;
    btn.addEventListener('mouseenter', () => {
      btn.style.borderColor = '#555'; btn.style.color = '#ccc';
      this.audio.playSFX('button_hover');
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.borderColor = '#2a2a3a'; btn.style.color = '#888';
    });
    btn.addEventListener('click', () => {
      this.audio.playSFX('button_click');
      this._toggleSettingsPanel();
    });
    document.body.appendChild(btn);
  }

  _toggleSettingsPanel() {
    let panel = document.getElementById('settings-panel');
    if (panel) { panel.remove(); return; }

    panel = document.createElement('div');
    panel.id = 'settings-panel';
    panel.style.cssText = `
      position: fixed; top: 70px; right: 8px; z-index: 10000;
      background: rgba(10,10,20,0.95); border: 1px solid #2a2a3a;
      border-radius: 6px; padding: 16px 20px; width: 220px;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #e0d8c8;
      pointer-events: auto;
    `;

    const title = document.createElement('div');
    title.textContent = 'SETTINGS';
    title.style.cssText = 'font-size: 11px; letter-spacing: 3px; color: #c8a860; margin-bottom: 14px; font-weight: bold;';
    panel.appendChild(title);

    // Music volume slider
    panel.appendChild(this._createVolumeSlider('Music', this.audio.getMusicVolume(), (v) => {
      this.audio.setMusicVolume(v);
    }));

    // SFX volume slider
    panel.appendChild(this._createVolumeSlider('Sound FX', this.audio.getSFXVolume(), (v) => {
      this.audio.setSFXVolume(v);
    }));

    // Mute checkbox
    const muteRow = document.createElement('div');
    muteRow.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-top: 10px; cursor: pointer;';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = this.audio.isMuted();
    checkbox.style.cssText = 'cursor: pointer; accent-color: #8b0000;';
    checkbox.addEventListener('change', () => {
      this.audio.toggleMute();
    });
    const muteLabel = document.createElement('span');
    muteLabel.textContent = 'Mute All';
    muteLabel.style.cssText = 'font-size: 11px; color: #888; letter-spacing: 1px;';
    muteRow.appendChild(checkbox);
    muteRow.appendChild(muteLabel);
    panel.appendChild(muteRow);

    document.body.appendChild(panel);

    // Close if clicking outside
    const closeHandler = (e) => {
      if (!panel.contains(e.target) && e.target.id !== 'settings-btn') {
        panel.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 10);
  }

  _createVolumeSlider(label, value, onChange) {
    const row = document.createElement('div');
    row.style.cssText = 'margin-bottom: 12px;';
    const labelDiv = document.createElement('div');
    labelDiv.style.cssText = 'display: flex; justify-content: space-between; margin-bottom: 4px;';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = label;
    nameSpan.style.cssText = 'font-size: 11px; color: #888; letter-spacing: 1px;';
    const valSpan = document.createElement('span');
    valSpan.textContent = Math.round(value * 100);
    valSpan.style.cssText = 'font-size: 11px; color: #c8a860;';
    labelDiv.appendChild(nameSpan);
    labelDiv.appendChild(valSpan);
    row.appendChild(labelDiv);
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0'; slider.max = '100'; slider.value = Math.round(value * 100);
    slider.style.cssText = 'width: 100%; accent-color: #8b0000; cursor: pointer;';
    slider.addEventListener('input', () => {
      const v = parseInt(slider.value) / 100;
      valSpan.textContent = slider.value;
      onChange(v);
    });
    row.appendChild(slider);
    return row;
  }

  /** Add hover/click SFX to a button element */
  _addButtonSFX(btn) {
    btn.addEventListener('mouseenter', () => this.audio.playSFX('button_hover'));
    btn.addEventListener('click', () => this.audio.playSFX('button_click'));
  }

  showHomeScreen() { this.showLandingPage(); }

  showLandingPage() {
    this.audio.playMusic('menu');
    const screen = document.getElementById('loading-screen');
    screen.innerHTML = '';
    screen.style.cssText = `
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      display: flex; flex-direction: column; align-items: stretch;
      justify-content: flex-start;
      z-index: 1000; overflow-y: auto; overflow-x: hidden;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      color: #e0d8c8; background: #08080f;
    `;

    // ── Section 1: Hero Banner (full viewport) ───────────────────────────
    const hero = document.createElement('div');
    hero.style.cssText = `
      position: relative; min-height: 100vh; display: flex; flex-direction: column;
      align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0;
    `;
    screen.appendChild(hero);

    // Background image with slow pan
    const bg = document.createElement('div');
    bg.style.cssText = `
      position: absolute; top: -5%; left: -5%; width: 110%; height: 110%;
      background: url('/assets/art/home_bg.webp') center/cover no-repeat;
      filter: brightness(0.35) saturate(1.2);
      animation: homeBgPan 30s ease-in-out infinite alternate;
    `;
    hero.appendChild(bg);

    // Dark gradient overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      background: linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.3) 50%, rgba(8,8,15,1) 100%);
    `;
    hero.appendChild(overlay);

    // Floating particles
    this._spawnScreenParticles(hero, 25, 'rgba(200,168,96,0.6)');

    // Hero content wrapper
    const heroContent = document.createElement('div');
    heroContent.style.cssText = `
      position: relative; z-index: 2; text-align: center;
      animation: fadeIn 1.5s ease-out;
    `;
    hero.appendChild(heroContent);

    // Game logo/crest — strip black background via canvas
    const logoCanvas = document.createElement('canvas');
    logoCanvas.width = 512; logoCanvas.height = 512;
    logoCanvas.style.cssText = `
      width: 180px; height: 180px; margin-bottom: 20px;
      animation: logoShine 4s ease-in-out infinite;
    `;
    heroContent.appendChild(logoCanvas);
    const logoImg = new Image();
    logoImg.crossOrigin = 'anonymous';
    logoImg.onload = () => {
      const ctx = logoCanvas.getContext('2d');
      ctx.drawImage(logoImg, 0, 0, 512, 512);
      const imgData = ctx.getImageData(0, 0, 512, 512);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        const brightness = (d[i] + d[i+1] + d[i+2]) / 3;
        if (brightness < 30) {
          d[i+3] = 0;
        } else if (brightness < 60) {
          d[i+3] = Math.floor((brightness - 30) / 30 * 255);
        }
      }
      ctx.putImageData(imgData, 0, 0);
    };
    logoImg.src = '/assets/art/game_logo.webp';

    // Game title
    const title = document.createElement('h1');
    title.textContent = 'EBON CRUCIBLE';
    title.style.cssText = `
      font-size: 72px; letter-spacing: 16px; color: #c8a860; margin: 0 0 8px 0;
      text-shadow: 0 0 40px rgba(139,0,0,0.8), 0 0 80px rgba(139,0,0,0.4), 0 4px 12px rgba(0,0,0,0.8);
      font-weight: 900; animation: titleGlow 3s ease-in-out infinite alternate;
    `;
    heroContent.appendChild(title);

    // Decorative line
    const line = document.createElement('div');
    line.style.cssText = `
      width: 200px; height: 1px; margin: 0 auto 16px;
      background: linear-gradient(90deg, transparent, #c8a860, transparent);
    `;
    heroContent.appendChild(line);

    // Tagline
    const tagline = document.createElement('div');
    tagline.textContent = 'BLOOD  \u00B7  STEEL  \u00B7  MAGIC';
    tagline.style.cssText = `
      font-size: 15px; letter-spacing: 8px; color: #777;
      margin-bottom: 24px; text-transform: uppercase;
    `;
    heroContent.appendChild(tagline);

    // Pitch text
    const pitch = document.createElement('p');
    pitch.textContent = 'Enter the Ebon Crucible \u2014 a dark fantasy arena where champions clash in brutal 1v1 combat. Choose from five deadly classes, master their abilities, and prove your worth in blood, steel, and magic.';
    pitch.style.cssText = `
      max-width: 560px; font-size: 14px; line-height: 1.8; color: #666;
      letter-spacing: 1px; margin: 0 auto 50px; padding: 0 20px;
    `;
    heroContent.appendChild(pitch);

    // Quick PLAY button in hero
    const heroPlayBtn = this._createCTAButton('ENTER THE CRUCIBLE');
    heroPlayBtn.addEventListener('click', () => { this.showClassSelect(); });
    this._addButtonSFX(heroPlayBtn);
    heroContent.appendChild(heroPlayBtn);

    // Scroll indicator
    const scrollHint = document.createElement('div');
    scrollHint.innerHTML = '\u25BC';
    scrollHint.style.cssText = `
      position: absolute; bottom: 30px; left: 50%; transform: translateX(-50%);
      color: #444; font-size: 18px; z-index: 2; cursor: pointer;
      animation: scrollBounce 2s ease-in-out infinite;
    `;
    hero.appendChild(scrollHint);

    // ── Lower content wrapper with arena background ─────────────────────
    const lowerContent = document.createElement('div');
    lowerContent.style.cssText = `
      position: relative; flex-shrink: 0; overflow: hidden;
    `;
    screen.appendChild(lowerContent);

    // Background image for lower sections
    const lowerBg = document.createElement('div');
    lowerBg.style.cssText = `
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      background: url('/assets/art/champion_select_bg.webp') center top / cover no-repeat;
      filter: brightness(0.18) saturate(0.7);
      z-index: 0; pointer-events: none;
    `;
    lowerContent.appendChild(lowerBg);

    // ── Section 2: Champions Preview ─────────────────────────────────────
    const champSection = document.createElement('div');
    champSection.style.cssText = `
      position: relative; z-index: 1;
      padding: 80px 40px; text-align: center;
      background: linear-gradient(180deg, rgba(8,8,15,0.85) 0%, rgba(14,14,26,0.6) 50%, rgba(8,8,15,0.85) 100%);
      animation: sectionReveal 0.8s ease-out;
    `;
    lowerContent.appendChild(champSection);

    scrollHint.addEventListener('click', () => champSection.scrollIntoView({ behavior: 'smooth' }));

    const champTitle = document.createElement('h2');
    champTitle.textContent = 'CHAMPIONS';
    champTitle.style.cssText = `
      font-size: 28px; letter-spacing: 10px; color: #c8a860; margin: 0 0 8px 0;
      text-shadow: 0 0 20px rgba(200,168,96,0.3); font-weight: 700;
    `;
    champSection.appendChild(champTitle);

    const champLine = document.createElement('div');
    champLine.style.cssText = 'width: 80px; height: 1px; margin: 0 auto 40px; background: linear-gradient(90deg, transparent, #c8a86060, transparent);';
    champSection.appendChild(champLine);

    const classColors = {
      tyrant: '#8B0000', wraith: '#6B2FA0', infernal: '#FF4500',
      harbinger: '#228B22', revenant: '#C8B560'
    };
    const classRoles = {
      tyrant: 'WARRIOR', wraith: 'ASSASSIN', infernal: 'MAGE',
      harbinger: 'WARLOCK', revenant: 'PALADIN'
    };
    const classDescs = {
      tyrant: 'Devastating melee pressure and unstoppable rage',
      wraith: 'Deadly combos from the shadows',
      infernal: 'Ranged burst damage and fire mastery',
      harbinger: 'Dark DoTs, drains, and fear',
      revenant: 'Holy strikes, healing, and divine shields'
    };

    const champRow = document.createElement('div');
    champRow.style.cssText = `
      display: flex; gap: 16px; justify-content: center; flex-wrap: wrap;
    `;
    champSection.appendChild(champRow);

    ALL_CLASSES.forEach((classDef, idx) => {
      const card = document.createElement('div');
      const cc = classColors[classDef.id] || '#888';
      card.style.cssText = `
        width: 170px; border-radius: 8px; overflow: hidden;
        border: 1px solid #1a1a2a; background: #0c0c16;
        transition: all 0.3s; cursor: default;
        animation: cardReveal 0.5s ${0.3 + idx * 0.1}s ease-out both;
      `;
      card.addEventListener('mouseenter', () => {
        card.style.border = '1px solid ' + cc;
        card.style.boxShadow = '0 0 20px ' + cc + '40';
        card.style.transform = 'translateY(-4px)';
      });
      card.addEventListener('mouseleave', () => {
        card.style.border = '1px solid #1a1a2a';
        card.style.boxShadow = 'none';
        card.style.transform = 'translateY(0)';
      });

      // Splash thumbnail
      const img = document.createElement('img');
      img.src = `/assets/art/${classDef.id}_splash.webp`;
      img.style.cssText = `
        width: 100%; height: 200px; object-fit: cover; display: block;
        filter: brightness(0.6) saturate(0.8);
        transition: filter 0.3s;
      `;
      card.appendChild(img);
      card.addEventListener('mouseenter', () => { img.style.filter = 'brightness(0.8) saturate(1)'; });
      card.addEventListener('mouseleave', () => { img.style.filter = 'brightness(0.6) saturate(0.8)'; });

      // Card info
      const info = document.createElement('div');
      info.style.cssText = 'padding: 12px;';

      // Role badge
      const role = document.createElement('div');
      role.textContent = classRoles[classDef.id] || '';
      role.style.cssText = `
        font-size: 9px; letter-spacing: 3px; color: ${cc}; margin-bottom: 4px;
        text-transform: uppercase; font-weight: 700;
      `;
      info.appendChild(role);

      // Class name
      const name = document.createElement('div');
      name.textContent = classDef.name || classDef.id.charAt(0).toUpperCase() + classDef.id.slice(1);
      name.style.cssText = `
        font-size: 16px; font-weight: 700; color: #e0d8c8; margin-bottom: 6px;
        letter-spacing: 2px;
      `;
      info.appendChild(name);

      // Description
      const desc = document.createElement('div');
      desc.textContent = classDescs[classDef.id] || '';
      desc.style.cssText = 'font-size: 11px; color: #555; line-height: 1.4;';
      info.appendChild(desc);

      card.appendChild(info);
      champRow.appendChild(card);
    });

    // ── Section 3: Controls / How to Play ────────────────────────────────
    const controlsSection = document.createElement('div');
    controlsSection.style.cssText = `
      position: relative; z-index: 1;
      padding: 60px 40px 80px; text-align: center;
      background: rgba(8,8,15,0.75);
      animation: sectionReveal 0.8s 0.2s ease-out both;
    `;
    lowerContent.appendChild(controlsSection);

    const ctrlTitle = document.createElement('h2');
    ctrlTitle.textContent = 'ARENA CONTROLS';
    ctrlTitle.style.cssText = `
      font-size: 28px; letter-spacing: 10px; color: #c8a860; margin: 0 0 8px 0;
      text-shadow: 0 0 20px rgba(200,168,96,0.3); font-weight: 700;
    `;
    controlsSection.appendChild(ctrlTitle);

    const ctrlLine = document.createElement('div');
    ctrlLine.style.cssText = 'width: 80px; height: 1px; margin: 0 auto 40px; background: linear-gradient(90deg, transparent, #c8a86060, transparent);';
    controlsSection.appendChild(ctrlLine);

    const controls = [
      ['WASD', 'Movement'],
      ['1-6', 'Abilities'],
      ['Mouse', 'Camera & Target'],
      ['Space', 'Jump'],
      ['Shift+WASD', 'Dodge Roll'],
      ['Tab / Click', 'Switch Target']
    ];

    const ctrlGrid = document.createElement('div');
    ctrlGrid.style.cssText = `
      display: grid; grid-template-columns: repeat(3, 180px); gap: 16px;
      justify-content: center; max-width: 600px; margin: 0 auto;
    `;
    controlsSection.appendChild(ctrlGrid);

    controls.forEach(([key, label], idx) => {
      const cell = document.createElement('div');
      cell.style.cssText = `
        background: #0e0e1a; border: 1px solid #1a1a2a; border-radius: 6px;
        padding: 16px 12px; text-align: center;
        animation: cardReveal 0.4s ${0.5 + idx * 0.08}s ease-out both;
      `;

      const keyEl = document.createElement('div');
      keyEl.textContent = key;
      keyEl.style.cssText = `
        font-size: 16px; font-weight: 700; color: #c8a860; margin-bottom: 6px;
        letter-spacing: 2px; font-family: monospace;
      `;
      cell.appendChild(keyEl);

      const labelEl = document.createElement('div');
      labelEl.textContent = label;
      labelEl.style.cssText = 'font-size: 11px; color: #555; letter-spacing: 1px;';
      cell.appendChild(labelEl);

      ctrlGrid.appendChild(cell);
    });

    // ── Section 4: Call to Action ────────────────────────────────────────
    const ctaSection = document.createElement('div');
    ctaSection.style.cssText = `
      position: relative; z-index: 1;
      padding: 40px 40px 60px; text-align: center;
      background: linear-gradient(180deg, rgba(8,8,15,0.7) 0%, rgba(10,10,20,0.9) 100%);
    `;
    lowerContent.appendChild(ctaSection);

    const ctaBtn = this._createCTAButton('ENTER THE CRUCIBLE');
    ctaBtn.addEventListener('click', () => { this.showClassSelect(); });
    this._addButtonSFX(ctaBtn);
    ctaSection.appendChild(ctaBtn);

    // Version text
    const ver = document.createElement('div');
    ver.style.cssText = `
      margin-top: 24px; font-size: 11px; letter-spacing: 3px; color: #333;
    `;
    ver.textContent = 'v0.1.0 ALPHA';
    ctaSection.appendChild(ver);

    // Force scroll to top — must happen after layout settles
    screen.scrollTop = 0;
    requestAnimationFrame(() => {
      screen.scrollTop = 0;
      // Enable smooth scrolling only after we're at the top
      setTimeout(() => { screen.style.scrollBehavior = 'smooth'; }, 100);
    });
  }

  _createCTAButton(text) {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.style.cssText = `
      padding: 18px 60px; font-size: 20px; letter-spacing: 6px;
      background: linear-gradient(180deg, #8b0000 0%, #5a0000 100%);
      border: 2px solid #c8a860; color: #c8a860;
      cursor: pointer; font-weight: bold; text-transform: uppercase;
      border-radius: 4px; font-family: inherit;
      box-shadow: 0 0 30px rgba(139,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1);
      transition: all 0.3s; animation: playBtnPulse 2s ease-in-out infinite;
    `;
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'linear-gradient(180deg, #a00000 0%, #700000 100%)';
      btn.style.boxShadow = '0 0 50px rgba(139,0,0,0.8), 0 0 80px rgba(200,168,96,0.3), inset 0 1px 0 rgba(255,255,255,0.15)';
      btn.style.transform = 'scale(1.05)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'linear-gradient(180deg, #8b0000 0%, #5a0000 100%)';
      btn.style.boxShadow = '0 0 30px rgba(139,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1)';
      btn.style.transform = 'scale(1)';
    });
    return btn;
  }

  showClassSelect() {
    const screen = document.getElementById('loading-screen');
    screen.innerHTML = '';
    screen.style.cssText = `
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      display: block; z-index: 1000; overflow: hidden;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      color: #e0d8c8;
      background: linear-gradient(180deg, rgba(8,8,15,0.85) 0%, rgba(18,18,30,0.8) 50%, rgba(8,8,15,0.9) 100%),
                  url('assets/art/champion_select_bg.webp') center/cover no-repeat;
    `;

    // Inner scrollable wrapper — this is what actually scrolls
    const scrollWrap = document.createElement('div');
    scrollWrap.style.cssText = `
      width: 100%; height: 100%; overflow-y: auto; overflow-x: hidden;
      display: flex; flex-direction: column; align-items: center;
      padding: 40px 0 60px;
      scrollbar-width: thin; scrollbar-color: #2a2a3a #08080f;
    `;
    screen.appendChild(scrollWrap);

    const classDescriptions = {
      tyrant: 'Heavy warrior — sustained pressure and devastating burst damage',
      wraith: 'Stealth assassin — deadly combo finishers and evasion',
      infernal: 'Fire mage — ranged burst damage and kiting',
      harbinger: 'Dark warlock — DoTs, drain, and fear',
      revenant: 'Holy paladin — melee, heals, and immunities'
    };

    const classRoles = {
      tyrant: 'WARRIOR', wraith: 'ASSASSIN', infernal: 'MAGE',
      harbinger: 'WARLOCK', revenant: 'PALADIN'
    };

    const classLore = {
      tyrant: 'Once a warlord who bathed in the blood of fallen kings, the Tyrant is sustained by an insatiable rage that burns hotter than dragonfire. Each kill feeds the fury within — each wound only sharpens it.',
      wraith: 'An assassin who struck a bargain with Death itself, the Wraith exists between the living and the shadow realm. They move unseen, strike without mercy, and vanish before the blood hits the ground.',
      infernal: 'A sorcerer who consumed the heart of a dying star, the Infernal channels pure cosmic destruction through mortal flesh. Their flames answer to no god — only to the hunger for annihilation.',
      harbinger: 'A forbidden scholar who decoded the Black Texts of the Void, the Harbinger binds tortured souls to their will. Every whisper they speak unravels the fabric of life itself.',
      revenant: 'A fallen holy knight resurrected by ancient blood rites, the Revenant wields a corrupted faith that both heals and destroys. Neither fully alive nor truly dead, they serve a cause beyond mortal understanding.'
    };

    const schoolColors = {
      physical: '#aaaaaa', fire: '#ff4400', frost: '#4488ff',
      arcane: '#aa44ff', shadow: '#9944ee', holy: '#ffd700'
    };

    // Track which class detail panel is currently shown
    let activePreviewClassId = null;
    const cardElements = new Map(); // classId -> { card, img, role, desc, lore }

    // Title area
    const titleArea = document.createElement('div');
    titleArea.style.cssText = `
      text-align: center; margin-bottom: 32px; z-index: 2;
      animation: fadeInUp 0.6s ease-out;
    `;
    const title = document.createElement('h1');
    title.textContent = 'CHOOSE YOUR CHAMPION';
    title.style.cssText = `
      font-size: 32px; letter-spacing: 10px; color: #c8a860; margin: 0 0 8px 0;
      text-shadow: 0 0 20px rgba(200,168,96,0.3); font-weight: 700;
    `;
    titleArea.appendChild(title);
    const titleLine = document.createElement('div');
    titleLine.style.cssText = 'width: 120px; height: 1px; margin: 0 auto; background: linear-gradient(90deg, transparent, #c8a86060, transparent);';
    titleArea.appendChild(titleLine);
    scrollWrap.appendChild(titleArea);

    // Class cards row
    const row = document.createElement('div');
    row.style.cssText = `
      display: flex; gap: 14px; justify-content: center; z-index: 2;
      padding: 0 20px; flex-wrap: nowrap; flex-shrink: 0;
    `;
    scrollWrap.appendChild(row);

    // --- Detail panel container (below cards) ---
    const detailPanel = document.createElement('div');
    detailPanel.style.cssText = `
      width: 100%; max-width: 1100px; margin: 0 auto;
      background: linear-gradient(180deg, #0a0a14 0%, #10101c 40%, #0a0a14 100%);
      border-top: 2px solid #2a2a3a; border-radius: 0 0 12px 12px;
      display: none; flex-shrink: 0;
      box-shadow: 0 8px 40px rgba(0,0,0,0.6);
    `;
    scrollWrap.appendChild(detailPanel);

    // Helper: format cooldown from ticks to seconds display
    const formatCooldown = (ticks) => {
      if (!ticks || ticks === 0) return 'No CD';
      const secs = ticks / 10;
      if (secs >= 60) return `${Math.round(secs / 60)}m`;
      return `${secs}s`;
    };

    // Helper: build the detail panel content for a class
    const showDetailPanel = (classDef) => {
      detailPanel.innerHTML = '';
      detailPanel.style.display = 'block';
      // Reset animation so it re-triggers on every click
      detailPanel.style.animation = 'none';
      detailPanel.offsetHeight; // force reflow
      detailPanel.style.animation = 'panelSlideDown 0.35s ease-out';

      const color = classDef.color;

      // --- Horizontal layout: portrait left, info+abilities right ---
      const panelLayout = document.createElement('div');
      panelLayout.style.cssText = `
        display: flex; width: 100%;
      `;

      // --- Left: Full character portrait ---
      const portraitWrap = document.createElement('div');
      portraitWrap.style.cssText = `
        width: 320px; min-width: 320px; min-height: 480px;
        position: relative; overflow: hidden; flex-shrink: 0;
      `;
      const splashImg = document.createElement('img');
      splashImg.src = `/assets/art/${classDef.id}_splash.webp`;
      splashImg.style.cssText = `
        width: 100%; height: 100%; object-fit: cover; display: block;
        filter: brightness(0.8) saturate(1.2);
      `;
      portraitWrap.appendChild(splashImg);

      // Right-edge gradient fade into panel
      const portraitGrad = document.createElement('div');
      portraitGrad.style.cssText = `
        position: absolute; top: 0; right: 0; width: 60px; height: 100%;
        background: linear-gradient(90deg, transparent, #0a0a14);
        pointer-events: none;
      `;
      portraitWrap.appendChild(portraitGrad);

      // Bottom gradient
      const portraitBottomGrad = document.createElement('div');
      portraitBottomGrad.style.cssText = `
        position: absolute; bottom: 0; left: 0; width: 100%; height: 80px;
        background: linear-gradient(transparent, #0a0a14);
        pointer-events: none;
      `;
      portraitWrap.appendChild(portraitBottomGrad);

      // Class name overlay on portrait
      const portraitName = document.createElement('div');
      portraitName.textContent = classDef.name.toUpperCase();
      portraitName.style.cssText = `
        position: absolute; bottom: 20px; left: 16px;
        color: ${color}; font-size: 22px; font-weight: 700;
        letter-spacing: 6px;
        text-shadow: 0 0 20px ${color}60, 0 2px 8px rgba(0,0,0,0.8);
      `;
      portraitWrap.appendChild(portraitName);

      panelLayout.appendChild(portraitWrap);

      // --- Right: info + abilities ---
      const rightCol = document.createElement('div');
      rightCol.style.cssText = `
        flex: 1; overflow-x: hidden; padding: 24px 24px 0;
      `;

      // Close button
      const closeRow = document.createElement('div');
      closeRow.style.cssText = 'display: flex; justify-content: flex-end; margin-bottom: 8px;';
      const closeBtn = document.createElement('button');
      closeBtn.textContent = 'X';
      closeBtn.style.cssText = `
        width: 28px; height: 28px; border-radius: 50%;
        background: rgba(0,0,0,0.6); border: 1px solid #3a3a4a;
        color: #888; font-size: 12px; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        font-family: inherit; transition: all 0.2s;
      `;
      closeBtn.addEventListener('mouseenter', () => { closeBtn.style.borderColor = '#888'; closeBtn.style.color = '#ccc'; });
      closeBtn.addEventListener('mouseleave', () => { closeBtn.style.borderColor = '#3a3a4a'; closeBtn.style.color = '#888'; });
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hideDetailPanel();
      });
      closeRow.appendChild(closeBtn);
      rightCol.appendChild(closeRow);

      // --- Class info section ---
      const infoSection = document.createElement('div');
      infoSection.style.cssText = 'padding: 0 0 16px;';

      // Role badge
      const roleBadge = document.createElement('div');
      roleBadge.textContent = classRoles[classDef.id] || '';
      roleBadge.style.cssText = `
        display: inline-block; padding: 3px 12px; border-radius: 3px;
        background: ${color}18; border: 1px solid ${color}40;
        color: ${color}; font-size: 9px; font-weight: 600;
        letter-spacing: 3px; margin-bottom: 8px;
      `;
      infoSection.appendChild(roleBadge);

      // Description
      const classDesc = document.createElement('div');
      classDesc.textContent = classDescriptions[classDef.id] || '';
      classDesc.style.cssText = `
        color: #999; font-size: 11px; line-height: 1.5;
        letter-spacing: 0.5px; margin-bottom: 10px;
      `;
      infoSection.appendChild(classDesc);

      // Lore
      const lorePara = document.createElement('div');
      lorePara.textContent = classLore[classDef.id] || '';
      lorePara.style.cssText = `
        color: #665; font-size: 10px; line-height: 1.5;
        font-style: italic; letter-spacing: 0.3px;
      `;
      infoSection.appendChild(lorePara);
      rightCol.appendChild(infoSection);

      // --- Separator ---
      const separator = document.createElement('div');
      separator.style.cssText = `
        width: 100%; height: 1px; margin: 4px 0 16px;
        background: linear-gradient(90deg, ${color}40, transparent);
      `;
      rightCol.appendChild(separator);

      // --- Abilities header ---
      const abilitiesHeader = document.createElement('div');
      abilitiesHeader.style.cssText = 'padding: 0 0 12px;';
      const abilitiesTitle = document.createElement('div');
      abilitiesTitle.textContent = 'ABILITIES';
      abilitiesTitle.style.cssText = `
        color: #c8a860; font-size: 11px; font-weight: 600;
        letter-spacing: 4px;
      `;
      abilitiesHeader.appendChild(abilitiesTitle);

      // Loadout hint
      const loadoutHint = document.createElement('div');
      loadoutHint.textContent = 'Default loadout keybinds shown (1-6)';
      loadoutHint.style.cssText = `
        color: #444; font-size: 9px; letter-spacing: 0.5px; margin-top: 4px;
      `;
      abilitiesHeader.appendChild(loadoutHint);
      rightCol.appendChild(abilitiesHeader);

      // --- Ability rows ---
      const abilitiesList = document.createElement('div');
      abilitiesList.style.cssText = 'padding: 0 0 20px;';

      // Show abilities in default loadout order first (keybinds 1-6), then remaining
      const loadout = classDef.defaultLoadout;
      const loadoutAbilities = loadout.map(id => classDef.abilities.find(a => a.id === id)).filter(Boolean);
      const remainingAbilities = classDef.abilities.filter(a => !loadout.includes(a.id));

      const renderAbilityRow = (ability, keybindNum, animDelay) => {
        const row = document.createElement('div');
        row.style.cssText = `
          display: flex; align-items: flex-start; gap: 10px;
          padding: 10px; margin-bottom: 6px;
          background: #0e0e1a; border: 1px solid #1a1a2a; border-radius: 6px;
          transition: border-color 0.2s, background 0.2s;
          animation: abilityRowReveal 0.3s ${animDelay}s ease-out both;
        `;
        row.addEventListener('mouseenter', () => {
          row.style.borderColor = '#2a2a3a';
          row.style.background = '#12121e';
        });
        row.addEventListener('mouseleave', () => {
          row.style.borderColor = '#1a1a2a';
          row.style.background = '#0e0e1a';
        });

        // Keybind badge
        const keybind = document.createElement('div');
        keybind.style.cssText = `
          width: 26px; height: 26px; min-width: 26px; border-radius: 4px;
          display: flex; align-items: center; justify-content: center;
          font-size: 12px; font-weight: 700; flex-shrink: 0; margin-top: 1px;
        `;
        if (keybindNum !== null) {
          keybind.textContent = keybindNum;
          keybind.style.background = `linear-gradient(180deg, ${color}30, ${color}10)`;
          keybind.style.border = `1px solid ${color}50`;
          keybind.style.color = color;
        } else {
          keybind.textContent = '-';
          keybind.style.background = '#1a1a24';
          keybind.style.border = '1px solid #2a2a3a';
          keybind.style.color = '#444';
        }
        row.appendChild(keybind);

        // Ability info column
        const infoCol = document.createElement('div');
        infoCol.style.cssText = 'flex: 1; min-width: 0;';

        // Name + school badge row
        const nameRow = document.createElement('div');
        nameRow.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 3px;';

        const abilityName = document.createElement('div');
        abilityName.textContent = ability.name;
        abilityName.style.cssText = `
          color: #e0d8c8; font-size: 12px; font-weight: 600;
          letter-spacing: 0.5px;
        `;
        nameRow.appendChild(abilityName);

        // School badge
        const schoolBadge = document.createElement('span');
        const schoolName = ability.school || 'physical';
        schoolBadge.textContent = schoolName.toUpperCase();
        const sColor = schoolColors[schoolName] || '#888';
        schoolBadge.style.cssText = `
          font-size: 7px; font-weight: 600; letter-spacing: 1.5px;
          padding: 2px 6px; border-radius: 2px;
          background: ${sColor}18; border: 1px solid ${sColor}30;
          color: ${sColor};
        `;
        nameRow.appendChild(schoolBadge);
        infoCol.appendChild(nameRow);

        // Description
        const abilityDesc = document.createElement('div');
        abilityDesc.textContent = ability.description || '';
        abilityDesc.style.cssText = `
          color: #777; font-size: 10px; line-height: 1.4;
          margin-bottom: 4px;
        `;
        infoCol.appendChild(abilityDesc);

        // Stats row: cooldown, cast time, range
        const statsRow = document.createElement('div');
        statsRow.style.cssText = `
          display: flex; gap: 12px; flex-wrap: wrap;
        `;

        const addStat = (label, value, statColor) => {
          const stat = document.createElement('span');
          stat.style.cssText = `font-size: 9px; color: #555; letter-spacing: 0.3px;`;
          stat.innerHTML = `<span style="color:${statColor || '#666'}">${label}:</span> <span style="color:#888">${value}</span>`;
          statsRow.appendChild(stat);
        };

        addStat('CD', formatCooldown(ability.cooldown), '#c8a860');
        if (ability.castTime && ability.castTime > 0) {
          addStat('Cast', `${(ability.castTime / 10).toFixed(1)}s`, '#6a8ccc');
        } else {
          addStat('Cast', 'Instant', '#6a8ccc');
        }
        if (ability.range && ability.range > 0) {
          addStat('Range', `${ability.range}yd`, '#7a7');
        }
        if (ability.cost) {
          const costEntries = Object.entries(ability.cost);
          if (costEntries.length > 0) {
            const [resType, amount] = costEntries[0];
            const resName = resType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            addStat('Cost', `${amount} ${resName}`, '#c77');
          }
        }
        if (ability.charges) {
          addStat('Charges', `${ability.charges.max}`, '#9a6cc8');
        }

        infoCol.appendChild(statsRow);
        row.appendChild(infoCol);

        return row;
      };

      // Render loadout abilities (keybinds 1-6)
      loadoutAbilities.forEach((ability, i) => {
        abilitiesList.appendChild(renderAbilityRow(ability, i + 1, 0.05 + i * 0.04));
      });

      // Separator before remaining abilities
      if (remainingAbilities.length > 0) {
        const otherLabel = document.createElement('div');
        otherLabel.textContent = 'OTHER ABILITIES';
        otherLabel.style.cssText = `
          color: #555; font-size: 9px; font-weight: 600;
          letter-spacing: 3px; margin: 12px 0 8px;
        `;
        abilitiesList.appendChild(otherLabel);

        remainingAbilities.forEach((ability, i) => {
          abilitiesList.appendChild(renderAbilityRow(ability, null, 0.3 + i * 0.04));
        });
      }

      rightCol.appendChild(abilitiesList);

      // --- Bottom area: SELECT CHAMPION button ---
      const bottomBar = document.createElement('div');
      bottomBar.style.cssText = `
        flex-shrink: 0; padding: 16px 24px 24px;
        background: linear-gradient(transparent, #0a0a14 30%);
        border-top: 1px solid #1a1a2a;
      `;

      const selectBtn = document.createElement('button');
      selectBtn.textContent = 'SELECT CHAMPION';
      selectBtn.style.cssText = `
        width: 100%; padding: 14px; font-family: inherit;
        background: linear-gradient(180deg, ${color}, ${color}88);
        border: 2px solid ${color}; border-radius: 6px;
        color: #fff; font-size: 13px; font-weight: 700;
        letter-spacing: 4px; cursor: pointer;
        text-shadow: 0 1px 4px rgba(0,0,0,0.5);
        box-shadow: 0 0 20px ${color}30;
        transition: all 0.25s ease;
      `;
      selectBtn.addEventListener('mouseenter', () => {
        selectBtn.style.boxShadow = `0 0 40px ${color}50, 0 4px 20px rgba(0,0,0,0.4)`;
        selectBtn.style.transform = 'translateY(-1px)';
      });
      selectBtn.addEventListener('mouseleave', () => {
        selectBtn.style.boxShadow = `0 0 20px ${color}30`;
        selectBtn.style.transform = 'translateY(0)';
      });
      selectBtn.addEventListener('click', () => {
        this.audio.playSFX('button_click');
        this.onClassSelected(classDef.id);
      });
      bottomBar.appendChild(selectBtn);

      rightCol.appendChild(bottomBar);
      panelLayout.appendChild(rightCol);
      detailPanel.appendChild(panelLayout);
    };

    // Helper: hide the detail panel and reset card states
    const hideDetailPanel = () => {
      detailPanel.style.display = 'none';
      detailPanel.style.animation = 'none';
      detailPanel.innerHTML = '';
      // Un-highlight active card
      if (activePreviewClassId) {
        const prev = cardElements.get(activePreviewClassId);
        if (prev) {
          prev.card.style.borderColor = '#2a2a3a';
          prev.card.style.boxShadow = 'none';
          prev.img.style.filter = 'brightness(0.5) saturate(0.7)';
        }
      }
      activePreviewClassId = null;
    };

    ALL_CLASSES.forEach((classDef, idx) => {
      const card = document.createElement('div');
      card.style.cssText = `
        width: 180px; height: 320px; position: relative; overflow: hidden;
        border: 2px solid #2a2a3a; border-radius: 8px; cursor: pointer;
        transition: all 0.35s ease; flex-shrink: 0;
        animation: cardReveal 0.5s ${idx * 0.1}s ease-out both;
      `;

      // Splash art
      const img = document.createElement('img');
      img.src = `/assets/art/${classDef.id}_splash.webp`;
      img.style.cssText = `
        width: 100%; height: 100%; object-fit: cover; display: block;
        filter: brightness(0.5) saturate(0.7);
        transition: all 0.4s ease;
      `;
      card.appendChild(img);

      // Top gradient (subtle)
      const topGrad = document.createElement('div');
      topGrad.style.cssText = `
        position: absolute; top: 0; left: 0; width: 100%; height: 40%;
        background: linear-gradient(180deg, rgba(0,0,0,0.5), transparent);
        pointer-events: none;
      `;
      card.appendChild(topGrad);

      // Bottom overlay with role, name, desc, lore
      const bottom = document.createElement('div');
      bottom.style.cssText = `
        position: absolute; bottom: 0; left: 0; width: 100%;
        padding: 40px 12px 14px;
        background: linear-gradient(transparent, rgba(0,0,0,0.95) 40%);
        text-align: center; pointer-events: none;
      `;

      const role = document.createElement('div');
      role.textContent = classRoles[classDef.id] || '';
      role.style.cssText = `
        color: #666; font-size: 8px; font-weight: 600;
        letter-spacing: 4px; margin-bottom: 3px;
        opacity: 0; transition: opacity 0.3s;
      `;
      bottom.appendChild(role);

      const name = document.createElement('div');
      name.textContent = classDef.name.toUpperCase();
      name.style.cssText = `
        color: ${classDef.color}; font-size: 16px; font-weight: bold;
        letter-spacing: 4px; margin-bottom: 5px;
        text-shadow: 0 0 10px ${classDef.color}40;
      `;
      bottom.appendChild(name);

      const desc = document.createElement('div');
      desc.textContent = classDescriptions[classDef.id] || '';
      desc.style.cssText = `
        color: #999; font-size: 10px; line-height: 1.4;
        letter-spacing: 0.5px; opacity: 0; transition: opacity 0.3s;
        margin-bottom: 6px;
      `;
      bottom.appendChild(desc);

      const lore = document.createElement('div');
      lore.textContent = classLore[classDef.id] || '';
      lore.style.cssText = `
        color: #665; font-size: 9px; line-height: 1.4;
        letter-spacing: 0.3px; opacity: 0; transition: opacity 0.4s 0.1s;
        font-style: italic; max-height: 60px; overflow: hidden;
      `;
      bottom.appendChild(lore);
      card.appendChild(bottom);

      // Store references for managing active states
      cardElements.set(classDef.id, { card, img, role, desc, lore });

      // Glow border on hover
      card.addEventListener('mouseenter', () => {
        if (activePreviewClassId === classDef.id) return; // Already selected, keep active style
        img.style.filter = 'brightness(0.9) saturate(1.2)';
        card.style.borderColor = classDef.color;
        card.style.transform = 'translateY(-10px) scale(1.03)';
        card.style.boxShadow = `0 10px 40px ${classDef.color}30, 0 0 1px ${classDef.color}`;
        role.style.opacity = '1';
        desc.style.opacity = '1';
        lore.style.opacity = '1';
      });
      card.addEventListener('mouseleave', () => {
        if (activePreviewClassId === classDef.id) return; // Keep active style
        img.style.filter = 'brightness(0.5) saturate(0.7)';
        card.style.borderColor = '#2a2a3a';
        card.style.transform = 'translateY(0) scale(1)';
        card.style.boxShadow = 'none';
        role.style.opacity = '0';
        desc.style.opacity = '0';
        lore.style.opacity = '0';
      });

      // Click: toggle detail panel preview (NOT select)
      card.addEventListener('click', () => {
        this.audio.playSFX('button_click');

        // If clicking same card, close the panel
        if (activePreviewClassId === classDef.id) {
          hideDetailPanel();
          return;
        }

        // Un-highlight previously active card
        if (activePreviewClassId) {
          const prev = cardElements.get(activePreviewClassId);
          if (prev) {
            prev.card.style.borderColor = '#2a2a3a';
            prev.card.style.transform = 'translateY(0) scale(1)';
            prev.card.style.boxShadow = 'none';
            prev.img.style.filter = 'brightness(0.5) saturate(0.7)';
            prev.role.style.opacity = '0';
            prev.desc.style.opacity = '0';
            prev.lore.style.opacity = '0';
          }
        }

        // Set active state on clicked card
        activePreviewClassId = classDef.id;
        img.style.filter = 'brightness(1.0) saturate(1.3)';
        card.style.borderColor = classDef.color;
        card.style.transform = 'translateY(-10px) scale(1.03)';
        card.style.boxShadow = `0 10px 40px ${classDef.color}40, 0 0 2px ${classDef.color}`;
        role.style.opacity = '1';
        desc.style.opacity = '1';
        lore.style.opacity = '1';

        // Build and show the detail panel
        showDetailPanel(classDef);
        // Scroll detail panel into view
        setTimeout(() => detailPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
      });

      row.appendChild(card);
    });

    // Difficulty selector
    const diffRow = document.createElement('div');
    diffRow.style.cssText = `
      margin-top: 32px; display: flex; gap: 12px; z-index: 2;
      animation: fadeInUp 0.6s 0.4s ease-out both;
    `;
    for (const diff of ['easy', 'medium', 'hard']) {
      const btn = document.createElement('button');
      btn.textContent = diff.toUpperCase();
      const isActive = this.difficulty === diff;
      btn.style.cssText = `
        padding: 8px 24px; font-family: inherit;
        background: ${isActive ? 'linear-gradient(180deg, #8b0000, #5a0000)' : '#1a1a24'};
        border: 1px solid ${isActive ? '#c8a860' : '#2a2a3a'};
        color: ${isActive ? '#c8a860' : '#666'}; cursor: pointer;
        font-size: 11px; letter-spacing: 3px;
        border-radius: 4px; transition: all 0.2s;
      `;
      btn.addEventListener('click', () => {
        this.difficulty = diff;
        diffRow.querySelectorAll('button').forEach(b => {
          b.style.background = '#1a1a24';
          b.style.borderColor = '#2a2a3a';
          b.style.color = '#666';
        });
        btn.style.background = 'linear-gradient(180deg, #8b0000, #5a0000)';
        btn.style.borderColor = '#c8a860';
        btn.style.color = '#c8a860';
      });
      diffRow.appendChild(btn);
    }
    scrollWrap.appendChild(diffRow);

    // Controls hint
    const controls = document.createElement('div');
    controls.style.cssText = `
      margin-top: 24px; color: #444; font-size: 10px; text-align: center;
      line-height: 1.8; z-index: 2; letter-spacing: 1px;
      animation: fadeInUp 0.6s 0.5s ease-out both;
    `;
    controls.innerHTML = '<span style="color:#666">WASD</span> Move &bull; <span style="color:#666">1-6</span> Abilities &bull; <span style="color:#666">Right-Click Drag</span> Camera &bull; <span style="color:#666">Scroll</span> Zoom';
    scrollWrap.appendChild(controls);

    // Back to home button (stays fixed on screen, not inside scroll wrapper)
    const backBtn = document.createElement('button');
    backBtn.textContent = 'BACK';
    backBtn.style.cssText = `
      position: absolute; top: 20px; left: 20px; z-index: 3;
      padding: 8px 20px; background: transparent; border: 1px solid #2a2a3a;
      color: #555; cursor: pointer; font-size: 10px; letter-spacing: 2px;
      border-radius: 4px; font-family: inherit; transition: all 0.2s;
    `;
    backBtn.addEventListener('mouseenter', () => { backBtn.style.borderColor = '#555'; backBtn.style.color = '#888'; });
    backBtn.addEventListener('mouseleave', () => { backBtn.style.borderColor = '#2a2a3a'; backBtn.style.color = '#555'; });
    backBtn.addEventListener('click', () => this.showHomeScreen());
    screen.appendChild(backBtn);
  }

  onClassSelected(classId) {
    try {
      this.playerClassId = classId;
      const otherClasses = ALL_CLASSES.filter(c => c.id !== classId);
      const rng = new SeededRandom(Date.now());
      this.enemyClassId = rng.pick(otherClasses).id;

      this.showLoadoutSelect();
    } catch (err) {
      showError('Failed to start match', err);
    }
  }

  showLoadoutSelect() {
    const classDef = CLASS_REGISTRY[this.playerClassId];
    if (!classDef) return;

    const enemyDef = CLASS_REGISTRY[this.enemyClassId];

    const loadingScreen = document.getElementById('loading-screen');
    loadingScreen.innerHTML = '';
    loadingScreen.style.display = 'flex';
    loadingScreen.style.flexDirection = 'column';
    loadingScreen.style.alignItems = 'center';
    loadingScreen.style.justifyContent = 'flex-start';
    loadingScreen.style.paddingTop = '20px';
    loadingScreen.style.overflow = 'auto';
    loadingScreen.style.background = "linear-gradient(180deg, rgba(8,8,15,0.85) 0%, rgba(18,18,30,0.8) 50%, rgba(8,8,15,0.9) 100%), url('assets/art/loadout_bg.webp') center/cover no-repeat";
    loadingScreen.style.fontFamily = "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif";

    // Class color map for card accents
    const classColors = {
      tyrant: '#8B0000',
      wraith: '#2D1B69',
      infernal: '#FF4500',
      harbinger: '#006400',
      revenant: '#C8B560'
    };

    const classDescriptions = {
      tyrant: 'Heavy warrior -- sustained pressure and devastating burst damage. Fueled by rage, the Tyrant overwhelms opponents with relentless melee strikes.',
      wraith: 'Stealth assassin -- combo finishers and evasion. The Wraith strikes from the shadows, chaining deadly combos before vanishing again.',
      infernal: 'Fire mage -- ranged burst and kiting. The Infernal commands devastating fire magic, incinerating foes from a distance.',
      harbinger: 'Dark warlock -- DoTs, drain, and fear. The Harbinger curses enemies with shadow afflictions while draining their life force.',
      revenant: 'Holy paladin -- melee, heals, and immunities. The Revenant channels divine power to smite enemies and sustain themselves.'
    };

    const getClassColor = (classId) => classColors[classId] || '#888';

    // Selected loadout slots
    const selectedLoadout = [...classDef.defaultLoadout];
    const coreIds = classDef.coreAbilityIds;
    const allAbilities = classDef.abilities;

    const schoolColors = {
      physical: '#aaaaaa', fire: '#ff4400', frost: '#4488ff',
      arcane: '#aa44ff', shadow: '#6600aa', holy: '#ffd700'
    };
    const getSchoolColor = (ability) => schoolColors[ability.school] || '#888';

    // --- Three-column flex layout ---
    const columnsWrapper = document.createElement('div');
    columnsWrapper.style.cssText = `
      display: flex; gap: 24px; width: 100%; max-width: 1200px;
      padding: 0 24px; box-sizing: border-box; justify-content: center;
      align-items: flex-start; flex: 1; min-height: 0;
    `;
    loadingScreen.appendChild(columnsWrapper);

    // =========================================================================
    // Helper: Build a class card (used for both player left and enemy right)
    // =========================================================================
    const buildClassCard = (cDef, isEnemy) => {
      const color = getClassColor(cDef.id);
      const card = document.createElement('div');
      card.style.cssText = `
        width: 240px; min-width: 240px; background: #2a2a3a; border-radius: 8px;
        overflow: hidden; border: 1px solid #3a3a4a; flex-shrink: 0;
      `;

      // -- Header bar --
      const header = document.createElement('div');
      header.style.cssText = `
        background: ${color}; padding: 12px 16px; text-align: center;
      `;
      const headerText = document.createElement('div');
      headerText.textContent = cDef.name.toUpperCase();
      headerText.style.cssText = `
        font-size: 18px; font-weight: bold; letter-spacing: 4px; color: #fff;
        text-shadow: 0 2px 8px rgba(0,0,0,0.5);
      `;
      header.appendChild(headerText);

      const headerRole = document.createElement('div');
      headerRole.textContent = isEnemy ? 'OPPONENT' : 'YOUR CHAMPION';
      headerRole.style.cssText = 'font-size: 9px; letter-spacing: 3px; color: rgba(255,255,255,0.7); margin-top: 2px;';
      header.appendChild(headerRole);
      card.appendChild(header);

      // -- Portrait area --
      const portrait = document.createElement('div');
      portrait.style.cssText = `
        width: 200px; height: 250px; margin: 16px auto;
        border-radius: 6px; overflow: hidden;
        border: 1px solid ${color}30; position: relative;
      `;
      const portraitImg = document.createElement('img');
      portraitImg.src = `/assets/art/${cDef.id}_splash.webp`;
      portraitImg.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
      portraitImg.onerror = () => { portraitImg.src = getClassPortrait(cDef.id); };
      portrait.appendChild(portraitImg);
      card.appendChild(portrait);

      // -- Ability slots area (below portrait) --
      const abilityArea = document.createElement('div');
      abilityArea.style.cssText = 'padding: 0 16px 16px;';
      card.appendChild(abilityArea);

      if (!isEnemy) {
        // Player: 3x2 grid showing equipped abilities
        const slotLabel = document.createElement('div');
        slotLabel.textContent = 'EQUIPPED ABILITIES';
        slotLabel.style.cssText = 'font-size: 9px; letter-spacing: 2px; color: #888; text-align: center; margin-bottom: 8px;';
        abilityArea.appendChild(slotLabel);

        const slotsGrid = document.createElement('div');
        slotsGrid.className = 'player-loadout-slots';
        slotsGrid.style.cssText = `
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;
        `;
        abilityArea.appendChild(slotsGrid);

        // Store reference so we can update it
        card._slotsGrid = slotsGrid;
      } else {
        // Enemy: "ABILITIES UNKNOWN" text
        const unknownLabel = document.createElement('div');
        unknownLabel.textContent = 'ABILITIES UNKNOWN';
        unknownLabel.style.cssText = `
          font-size: 13px; letter-spacing: 3px; color: ${color}; text-align: center;
          margin-bottom: 12px; font-weight: bold;
        `;
        abilityArea.appendChild(unknownLabel);

        const unknownDesc = document.createElement('div');
        unknownDesc.textContent = 'Your opponent\'s build is hidden. Prepare for anything.';
        unknownDesc.style.cssText = 'font-size: 10px; color: #666; text-align: center; line-height: 1.5; margin-bottom: 12px;';
        abilityArea.appendChild(unknownDesc);

        // Class description
        const classDesc = document.createElement('div');
        classDesc.textContent = classDescriptions[cDef.id] || cDef.description || '';
        classDesc.style.cssText = `
          font-size: 10px; color: #999; text-align: center; line-height: 1.6;
          padding: 10px; background: #1e1e2e; border-radius: 4px;
          border-left: 3px solid ${color}60;
        `;
        abilityArea.appendChild(classDesc);
      }

      return card;
    };

    // =========================================================================
    // LEFT COLUMN: Player class card
    // =========================================================================
    const leftCol = buildClassCard(classDef, false);
    columnsWrapper.appendChild(leftCol);

    // =========================================================================
    // CENTER COLUMN: Ability selection
    // =========================================================================
    const centerCol = document.createElement('div');
    centerCol.style.cssText = `
      flex: 1; min-width: 360px; max-width: 560px; display: flex;
      flex-direction: column; gap: 0;
    `;
    columnsWrapper.appendChild(centerCol);

    // Center header
    const centerHeader = document.createElement('div');
    centerHeader.style.cssText = 'text-align: center; margin-bottom: 16px;';
    const centerTitle = document.createElement('h2');
    centerTitle.textContent = 'CHOOSE YOUR LOADOUT';
    centerTitle.style.cssText = `
      font-size: 22px; letter-spacing: 6px; color: #c8a860; margin: 0 0 4px 0;
      text-transform: uppercase; font-weight: 700;
      text-shadow: 0 0 15px rgba(200,168,96,0.2);
    `;
    centerHeader.appendChild(centerTitle);
    const centerSub = document.createElement('div');
    centerSub.textContent = `Select 6 abilities for ${classDef.name}`;
    centerSub.style.cssText = `font-size: 11px; color: ${getClassColor(classDef.id)}; letter-spacing: 2px;`;
    centerHeader.appendChild(centerSub);
    centerCol.appendChild(centerHeader);

    // Slot count indicator
    const countIndicator = document.createElement('div');
    countIndicator.style.cssText = 'text-align: center; margin-bottom: 12px;';
    centerCol.appendChild(countIndicator);

    const updateCountIndicator = () => {
      const count = selectedLoadout.length;
      countIndicator.innerHTML = `<span style="font-size: 28px; font-weight: bold; color: ${count === 6 ? '#4CAF50' : '#ff6b6b'};">${count}</span><span style="font-size: 14px; color: #888;"> / 6 SELECTED</span>`;
    };

    // Flex ability grid (scrollable)
    const gridScroller = document.createElement('div');
    gridScroller.style.cssText = `
      flex: 1; overflow-y: auto; padding-right: 4px; min-height: 0;
      max-height: 420px;
    `;
    centerCol.appendChild(gridScroller);

    const grid = document.createElement('div');
    grid.style.cssText = `
      display: flex; flex-direction: column; gap: 8px;
    `;
    gridScroller.appendChild(grid);

    // Bottom buttons
    const btnRow = document.createElement('div');
    btnRow.style.cssText = `
      display: flex; gap: 10px; margin-top: 16px; justify-content: center;
      flex-wrap: wrap;
    `;
    centerCol.appendChild(btnRow);

    const backBtn = document.createElement('button');
    backBtn.textContent = 'BACK';
    backBtn.style.cssText = `
      padding: 10px 20px; background: rgba(20,20,30,0.8); border: 1px solid #2a2a3a;
      color: #666; cursor: pointer; font-size: 11px; letter-spacing: 2px;
      border-radius: 4px; transition: all 0.2s; font-family: inherit;
    `;
    backBtn.addEventListener('mouseenter', () => { backBtn.style.borderColor = '#555'; backBtn.style.color = '#aaa'; });
    backBtn.addEventListener('mouseleave', () => { backBtn.style.borderColor = '#2a2a3a'; backBtn.style.color = '#666'; });
    backBtn.addEventListener('click', () => { this.showClassSelect(); });
    btnRow.appendChild(backBtn);

    const defaultBtn = document.createElement('button');
    defaultBtn.textContent = 'DEFAULT LOADOUT';
    defaultBtn.style.cssText = `
      padding: 10px 20px; background: rgba(20,20,30,0.8); border: 1px solid #2a2a3a;
      color: #888; cursor: pointer; font-size: 11px; letter-spacing: 2px;
      border-radius: 4px; transition: all 0.2s; font-family: inherit;
    `;
    defaultBtn.addEventListener('mouseenter', () => { defaultBtn.style.borderColor = '#555'; });
    defaultBtn.addEventListener('mouseleave', () => { defaultBtn.style.borderColor = '#2a2a3a'; });
    defaultBtn.addEventListener('click', () => {
      selectedLoadout.length = 0;
      selectedLoadout.push(...classDef.defaultLoadout);
      renderSlots();
      renderGrid();
      updateStartBtn();
      updateCountIndicator();
    });
    btnRow.appendChild(defaultBtn);

    const startBtn = document.createElement('button');
    startBtn.textContent = 'START MATCH';
    startBtn.style.cssText = `
      padding: 12px 32px; font-family: inherit;
      background: linear-gradient(180deg, #8b0000, #5a0000);
      border: 2px solid #c8a860; color: #c8a860;
      cursor: pointer; font-size: 12px; letter-spacing: 3px;
      border-radius: 4px; font-weight: bold; transition: all 0.2s;
      box-shadow: 0 0 15px rgba(139,0,0,0.3);
    `;
    startBtn.addEventListener('mouseenter', () => {
      if (selectedLoadout.length === 6) {
        startBtn.style.boxShadow = '0 0 25px rgba(139,0,0,0.5)';
        startBtn.style.transform = 'scale(1.03)';
      }
    });
    startBtn.addEventListener('mouseleave', () => {
      startBtn.style.boxShadow = '0 0 15px rgba(139,0,0,0.3)';
      startBtn.style.transform = 'scale(1)';
    });
    startBtn.addEventListener('click', () => {
      if (selectedLoadout.length === 6) {
        this._selectedLoadout = [...selectedLoadout];
        document.getElementById('loading-screen').style.display = 'none';
        this.startMatch();
      }
    });
    btnRow.appendChild(startBtn);

    const updateStartBtn = () => {
      if (selectedLoadout.length === 6) {
        startBtn.style.opacity = '1';
        startBtn.style.pointerEvents = 'auto';
      } else {
        startBtn.style.opacity = '0.4';
        startBtn.style.pointerEvents = 'none';
      }
    };

    // =========================================================================
    // RIGHT COLUMN: Enemy class card
    // =========================================================================
    if (enemyDef) {
      const rightCol = buildClassCard(enemyDef, true);
      columnsWrapper.appendChild(rightCol);
    }

    // =========================================================================
    // Render functions
    // =========================================================================

    const renderSlots = () => {
      const slotsGrid = leftCol._slotsGrid;
      if (!slotsGrid) return;
      slotsGrid.innerHTML = '';

      for (let i = 0; i < 6; i++) {
        const slot = document.createElement('div');
        const abilityId = selectedLoadout[i];
        const ability = abilityId ? allAbilities.find(a => a.id === abilityId) : null;
        const isCore = abilityId && coreIds.includes(abilityId);
        const borderColor = ability ? getSchoolColor(ability) : '#3a3a4a';

        slot.style.cssText = `
          background: #1e1e2e; border: 2px solid ${borderColor}; border-radius: 4px;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          padding: 6px 4px; position: relative; min-height: 56px;
        `;

        if (ability) {
          const slotIcon = document.createElement('img');
          slotIcon.src = getAbilityIcon(ability.id, ability.school?.toLowerCase() || 'physical', 64);
          slotIcon.style.cssText = 'width: 28px; height: 28px; border-radius: 3px; margin-bottom: 3px;';
          slot.appendChild(slotIcon);

          const name = document.createElement('div');
          name.textContent = ability.name;
          name.style.cssText = `
            color: ${borderColor}; font-size: 8px; font-weight: bold; text-align: center;
            letter-spacing: 0.5px; text-transform: uppercase; line-height: 1.2;
          `;
          slot.appendChild(name);

          const keyLabel = document.createElement('div');
          keyLabel.textContent = `[${i + 1}]`;
          keyLabel.style.cssText = 'color: #555; font-size: 9px; margin-top: 3px;';
          slot.appendChild(keyLabel);

          if (isCore) {
            const lock = document.createElement('div');
            lock.textContent = 'CORE';
            lock.style.cssText = `
              position: absolute; top: 1px; right: 2px; font-size: 7px;
              color: #ffd700; letter-spacing: 1px; font-weight: bold;
            `;
            slot.appendChild(lock);
          }

          // Tooltip on hover for ALL loadout slots (core + flex)
          slot.title = `${ability.name}\n${ability.description || ''}`;
          slot.style.cursor = 'pointer';
        } else {
          const empty = document.createElement('div');
          empty.textContent = '--';
          empty.style.cssText = 'color: #444; font-size: 16px;';
          slot.appendChild(empty);
        }

        slotsGrid.appendChild(slot);
      }
    };

    const renderGrid = () => {
      grid.innerHTML = '';

      // Show core abilities first (non-clickable, with CORE label)
      const coreAbilities = allAbilities.filter(a => coreIds.includes(a.id));
      if (coreAbilities.length > 0) {
        const coreHeader = document.createElement('div');
        coreHeader.textContent = 'CORE ABILITIES';
        coreHeader.style.cssText = 'color: #ffd700; font-size: 10px; font-weight: bold; letter-spacing: 2px; margin-bottom: 6px; padding-left: 4px;';
        grid.appendChild(coreHeader);

        for (const ability of coreAbilities) {
          const card = document.createElement('div');
          const schoolColor = getSchoolColor(ability);
          card.style.cssText = `
            display: flex; align-items: stretch; background: #1a1a2a;
            border: 1px solid #ffd70040; border-left: 4px solid #ffd700;
            border-radius: 4px; overflow: hidden; margin-bottom: 4px; opacity: 0.85;
          `;

          const iconArea = document.createElement('div');
          iconArea.style.cssText = `width: 44px; min-width: 44px; display: flex; align-items: center; justify-content: center; background: #ffd70010;`;
          const abilityIconImg = document.createElement('img');
          abilityIconImg.src = getAbilityIcon(ability.id, ability.school?.toLowerCase() || 'physical', 64);
          abilityIconImg.style.cssText = 'width: 36px; height: 36px; border-radius: 4px;';
          iconArea.appendChild(abilityIconImg);
          card.appendChild(iconArea);

          const textArea = document.createElement('div');
          textArea.style.cssText = 'flex: 1; padding: 8px 10px; min-width: 0;';
          const topRow = document.createElement('div');
          topRow.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 3px;';
          const name = document.createElement('div');
          name.textContent = ability.name;
          name.style.cssText = 'color: #ffd700; font-size: 12px; font-weight: bold; letter-spacing: 1px; text-transform: uppercase;';
          topRow.appendChild(name);
          const lockTag = document.createElement('span');
          lockTag.textContent = 'LOCKED';
          lockTag.style.cssText = 'font-size: 7px; letter-spacing: 1px; color: #ffd700; background: #ffd70018; padding: 2px 5px; border-radius: 2px;';
          topRow.appendChild(lockTag);
          textArea.appendChild(topRow);
          const desc = document.createElement('div');
          desc.textContent = ability.description || '';
          desc.style.cssText = 'color: #888; font-size: 10px; line-height: 1.4; max-height: 28px; overflow: hidden; text-overflow: ellipsis;';
          textArea.appendChild(desc);
          card.appendChild(textArea);

          const statusArea = document.createElement('div');
          statusArea.style.cssText = 'width: 70px; min-width: 70px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 4px; border-left: 1px solid #ffd70020;';
          const cdText = ability.cooldown ? `${(ability.cooldown / 10).toFixed(1)}s` : 'No CD';
          const cdDiv = document.createElement('div');
          cdDiv.textContent = cdText;
          cdDiv.style.cssText = 'font-size: 9px; color: #666; letter-spacing: 0.5px;';
          statusArea.appendChild(cdDiv);
          const costText = ability.cost ? Object.entries(ability.cost).map(([k, v]) => `${v} ${k}`).join(', ') : 'Free';
          const costDiv = document.createElement('div');
          costDiv.textContent = costText;
          costDiv.style.cssText = 'font-size: 8px; color: #555; letter-spacing: 0.5px; margin-top: 1px;';
          statusArea.appendChild(costDiv);
          card.appendChild(statusArea);

          grid.appendChild(card);
        }

        const divider = document.createElement('div');
        divider.style.cssText = 'border-top: 1px solid #3a3a4a; margin: 8px 0;';
        grid.appendChild(divider);

        const flexHeader = document.createElement('div');
        flexHeader.textContent = 'CHOOSE 3 ABILITIES';
        flexHeader.style.cssText = 'color: #aaa; font-size: 10px; font-weight: bold; letter-spacing: 2px; margin-bottom: 6px; padding-left: 4px;';
        grid.appendChild(flexHeader);
      }

      const flexAbilities = allAbilities.filter(a => !coreIds.includes(a.id));

      for (const ability of flexAbilities) {
        const isSelected = selectedLoadout.includes(ability.id);
        const card = document.createElement('div');
        const schoolColor = getSchoolColor(ability);

        card.style.cssText = `
          display: flex; align-items: stretch; background: ${isSelected ? '#2e2e1e' : '#2a2a3a'};
          border: 1px solid ${isSelected ? schoolColor + '80' : '#3a3a4a'};
          border-left: 4px solid ${schoolColor};
          border-radius: 4px; cursor: pointer; transition: all 0.15s;
          ${isSelected ? `box-shadow: 0 0 12px ${schoolColor}20;` : ''}
          overflow: hidden;
        `;

        card.addEventListener('mouseenter', () => {
          if (!isSelected) {
            card.style.borderColor = schoolColor + '60';
            card.style.background = '#32323e';
          }
        });
        card.addEventListener('mouseleave', () => {
          if (!isSelected) {
            card.style.borderColor = '#3a3a4a';
            card.style.borderLeftColor = schoolColor;
            card.style.background = '#2a2a3a';
          }
        });

        card.addEventListener('click', () => {
          if (isSelected) {
            const idx = selectedLoadout.indexOf(ability.id);
            if (idx >= 0) selectedLoadout.splice(idx, 1);
          } else {
            if (selectedLoadout.length < 6) {
              selectedLoadout.push(ability.id);
            }
          }
          renderSlots();
          renderGrid();
          updateStartBtn();
          updateCountIndicator();
        });

        // Left icon area
        const iconArea = document.createElement('div');
        iconArea.style.cssText = `
          width: 44px; min-width: 44px; display: flex; align-items: center;
          justify-content: center; background: ${schoolColor}15;
        `;
        const abilityIconImg = document.createElement('img');
        abilityIconImg.src = getAbilityIcon(ability.id, ability.school?.toLowerCase() || 'physical', 64);
        abilityIconImg.style.cssText = 'width: 36px; height: 36px; border-radius: 4px;';
        iconArea.appendChild(abilityIconImg);
        card.appendChild(iconArea);

        // Text content area
        const textArea = document.createElement('div');
        textArea.style.cssText = 'flex: 1; padding: 8px 10px; min-width: 0;';

        const topRow = document.createElement('div');
        topRow.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 3px;';

        const name = document.createElement('div');
        name.textContent = ability.name;
        name.style.cssText = `
          color: #ddd; font-size: 12px; font-weight: bold; letter-spacing: 1px;
          text-transform: uppercase; white-space: nowrap; overflow: hidden;
          text-overflow: ellipsis;
        `;
        topRow.appendChild(name);

        const schoolTag = document.createElement('span');
        schoolTag.textContent = (ability.school || 'physical').toUpperCase();
        schoolTag.style.cssText = `
          font-size: 8px; letter-spacing: 1px; color: ${schoolColor};
          background: ${schoolColor}18; padding: 2px 5px; border-radius: 2px;
          white-space: nowrap; flex-shrink: 0;
        `;
        topRow.appendChild(schoolTag);
        textArea.appendChild(topRow);

        const desc = document.createElement('div');
        desc.textContent = ability.description || '';
        desc.style.cssText = `
          color: #888; font-size: 10px; line-height: 1.4;
          max-height: 28px; overflow: hidden; text-overflow: ellipsis;
        `;
        textArea.appendChild(desc);

        card.appendChild(textArea);

        // Right status area
        const statusArea = document.createElement('div');
        statusArea.style.cssText = `
          width: 70px; min-width: 70px; display: flex; flex-direction: column;
          align-items: center; justify-content: center; padding: 4px;
          border-left: 1px solid ${isSelected ? schoolColor + '30' : '#3a3a4a'};
        `;

        if (isSelected) {
          const equip = document.createElement('div');
          equip.textContent = 'EQUIPPED';
          equip.style.cssText = `font-size: 8px; letter-spacing: 1px; color: ${schoolColor}; font-weight: bold; margin-bottom: 2px;`;
          statusArea.appendChild(equip);
        }

        const cdText = ability.cooldown ? `${(ability.cooldown / 10).toFixed(1)}s` : 'No CD';
        const cdDiv = document.createElement('div');
        cdDiv.textContent = cdText;
        cdDiv.style.cssText = 'font-size: 9px; color: #666; letter-spacing: 0.5px;';
        statusArea.appendChild(cdDiv);

        const costText = ability.cost ? Object.entries(ability.cost).map(([k, v]) => `${v} ${k}`).join(', ') : 'Free';
        const costDiv = document.createElement('div');
        costDiv.textContent = costText;
        costDiv.style.cssText = 'font-size: 8px; color: #555; letter-spacing: 0.5px; margin-top: 1px;';
        statusArea.appendChild(costDiv);

        card.appendChild(statusArea);

        grid.appendChild(card);
      }
    };

    // Initial render
    renderSlots();
    renderGrid();
    updateStartBtn();
    updateCountIndicator();
  }

  startMatch() {
    this.audio.playMusic('battle');
    this.audio.playSFX('match_start');
    const rng = new SeededRandom(Date.now());
    const eventBus = new EventBus();

    this.matchState = new MatchState({ eventBus, rng, seed: Date.now() });

    // Create units
    const playerClass = CLASS_REGISTRY[this.playerClassId];
    if (!playerClass) throw new Error(`Unknown class: ${this.playerClassId}`);
    const playerUnit = new Unit(0, this.playerClassId, playerClass.name);
    playerClass.applyToUnit(playerUnit, this._selectedLoadout || null);
    playerUnit.position = new Vec3(-48, 0, 0); // Inside west staging cell
    playerUnit.facing = Math.PI / 2; // Face toward gate/arena

    const enemyClass = CLASS_REGISTRY[this.enemyClassId];
    if (!enemyClass) throw new Error(`Unknown class: ${this.enemyClassId}`);
    const enemyUnit = new Unit(1, this.enemyClassId, enemyClass.name);
    enemyClass.applyToUnit(enemyUnit);
    enemyUnit.position = new Vec3(48, 0, 0); // Inside east staging cell
    enemyUnit.facing = -Math.PI / 2; // Face toward gate/arena

    this.matchState.addUnit(playerUnit);
    this.matchState.addUnit(enemyUnit);

    // Position interpolation for smooth rendering
    this._prevPositions = new Map();
    for (const unit of this.matchState.units) {
      this._prevPositions.set(unit.id, { x: unit.position.x, y: unit.position.y, z: unit.position.z });
    }

    // Arena modifiers
    const modCount = rng.chance(0.3) ? 2 : 1;
    const mods = selectModifiers(rng, modCount);
    for (const mod of mods) {
      mod.apply(this.matchState);
      this.matchState.arenaModifiers.push(mod);
    }

    // 3D characters
    this.characterRenderer.createCharacter(0, this.playerClassId);
    this.characterRenderer.createCharacter(1, this.enemyClassId);

    // Target indicator ring
    this._createTargetRing();

    // Set initial target for player
    this.matchState.setTarget(0, 1);

    // Input
    const abilityOrder = playerClass.getAbilityOrder(this._selectedLoadout || null);
    this._abilityOrder = abilityOrder;
    this.inputManager.setKeybindings(abilityOrder);

    // Controllers
    const playerController = new PlayerController(0, this.inputManager, this.cameraController);
    playerController.currentTarget = 1; // Start targeting enemy
    this.playerController = playerController;
    const aiController = new AIController(1, this.difficulty);

    // Game loop
    this.gameLoop = new GameLoop(this.matchState);
    this.gameLoop.setController(0, playerController);
    this.gameLoop.setController(1, aiController);

    // Event scheduler
    this.eventScheduler = new EventScheduler(this.matchState);

    // Patch engine tick for modifiers + events
    const engine = this.gameLoop.engine;
    const originalTick = engine.tick.bind(engine);
    const matchState = this.matchState;
    const eventScheduler = this.eventScheduler;
    engine.tick = function() {
      for (const mod of matchState.arenaModifiers) {
        if (mod.tick) mod.tick(matchState, matchState.tick);
      }
      eventScheduler.tick(matchState.tick);
      if (eventScheduler.activeEvent?.expired) eventScheduler.activeEvent = null;
      originalTick();
    };

    // Wire events to visuals
    this.wireEvents(eventBus);

    // HUD
    this.hud.show();
    this.hud.updateModifiers(this.matchState.arenaModifiers);
    this.hud.setupAbilityBar(playerClass, abilityOrder);

    // Camera — position behind the player facing the enemy
    const collisionMeshes = this.arenaRenderer.getCollisionMeshes?.() || [];
    this.cameraController.setCollisionObjects(collisionMeshes);
    this.cameraController.rotationAngle = playerUnit.facing + Math.PI;
    this.cameraController.snapToTarget(playerUnit.position);

    // Render callback with error handling
    this.gameLoop.onRender = (alpha, match) => {
      try {
        this.render(alpha, match);
      } catch (err) {
        showError('Render error', err);
        this.gameLoop.pause();
      }
    };

    // Store previous positions BEFORE each tick for interpolation
    const originalGameTick = this.gameLoop.gameTick.bind(this.gameLoop);
    this.gameLoop.gameTick = () => {
      for (const unit of this.matchState.units) {
        this._prevPositions.set(unit.id, { x: unit.position.x, y: unit.position.y, z: unit.position.z });
      }
      originalGameTick();
    };

    console.log(`[Game] Match: ${this.playerClassId} vs ${this.enemyClassId}`);

    // --- 10-second countdown before match begins ---
    this._startCountdown(10);
  }

  _startCountdown(seconds) {
    // Create countdown overlay
    const overlay = document.createElement('div');
    overlay.id = 'countdown-overlay';
    Object.assign(overlay.style, {
      position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: '9999', pointerEvents: 'none'
    });
    const numEl = document.createElement('div');
    Object.assign(numEl.style, {
      fontSize: '120px', fontWeight: '900', fontFamily: '"Cinzel", serif',
      color: '#ffd700', textShadow: '0 0 40px rgba(255,215,0,0.6), 0 0 80px rgba(255,100,0,0.3)',
      transition: 'transform 0.3s ease-out, opacity 0.3s ease-out'
    });
    overlay.appendChild(numEl);
    document.body.appendChild(overlay);

    let remaining = seconds;
    const tick = () => {
      if (remaining <= 0) {
        // Open gates when countdown finishes
        if (this.arenaRenderer) this.arenaRenderer.openGates();
        // Allow movement into the arena
        if (this.matchState?.los) this.matchState.los.gatesOpen = true;

        // Show "FIGHT!" then remove
        numEl.textContent = 'FIGHT!';
        numEl.style.color = '#ff4400';
        numEl.style.textShadow = '0 0 40px rgba(255,68,0,0.8), 0 0 80px rgba(255,0,0,0.4)';
        numEl.style.transform = 'scale(1.5)';
        setTimeout(() => {
          numEl.style.opacity = '0';
          setTimeout(() => overlay.remove(), 400);
        }, 800);
        this.gameLoop.start();
        return;
      }
      numEl.textContent = remaining;
      numEl.style.transform = 'scale(1.3)';
      setTimeout(() => { numEl.style.transform = 'scale(1)'; }, 150);
      remaining--;
      setTimeout(tick, 1000);
    };

    // Start rendering immediately (so player sees the arena) but don't tick game logic
    this.gameLoop.onRender(0, this.matchState);
    const renderOnly = () => {
      if (remaining > 0) {
        this.gameLoop.onRender(0, this.matchState);
        requestAnimationFrame(renderOnly);
      }
    };
    requestAnimationFrame(renderOnly);
    tick();
  }

  wireEvents(eventBus) {
    const match = this.matchState;
    const effects = this.spellEffects;
    const camera = this.cameraController;

    // Reset match stats
    this._matchStats = { playerDamage: 0, playerHealing: 0, playerDamageTaken: 0, enemyDamage: 0, enemyHealing: 0, enemyDamageTaken: 0 };

    // Flash ability slot red when an ability fails (GCD, cooldown, etc.)
    eventBus.on(EVENTS.ABILITY_CAST_FAILED, (data) => {
      if (data.sourceId === 0) {
        this.hud.flashAbilityFailed(data.abilityId, data.reason);
        // Show prominent center-screen error for important failures
        const bigReasons = {
          out_of_range: 'OUT OF RANGE',
          no_los: 'NO LINE OF SIGHT',
          resource: 'NOT ENOUGH RESOURCES',
          silenced: 'SILENCED',
          school_locked: 'SPELL LOCKED',
          requires_stealth: 'MUST BE IN STEALTH',
          too_close: 'TOO CLOSE'
        };
        const msg = bigReasons[data.reason];
        if (msg) this.hud.showErrorMessage(msg);
      }
    });

    // Play spell_cast SFX when a spell begins casting (cast-time abilities)
    eventBus.on(EVENTS.ABILITY_CAST_START, () => {
      this.audio.playSFX('spell_cast');
    });

    // Track ability use for per-ability animations
    this._lastAbilityAnim = new Map(); // unitId -> { tick, abilityId }

    // Play SFX for instant-cast abilities + spawn visuals
    eventBus.on(EVENTS.ABILITY_CAST_SUCCESS, (data) => {
      if (data.abilityId !== 'auto_attack') {
        const source = match.getUnit(data.sourceId);
        const ability = source?.abilities.get(data.abilityId);

        if (source && !source.isCasting) {
          // Track ALL instant ability use for per-ability animation
          if (ability && ability.castTime === 0) {
            this._lastAbilityAnim.set(data.sourceId, { tick: match.tick, abilityId: data.abilityId });
          }
          // SFX: melee → melee_hit, ranged/self → spell_cast
          if (ability && ability.castTime === 0 && ability.range > 0 && ability.range <= 8) {
            this.audio.playSFX('melee_hit');
          } else {
            this.audio.playSFX('spell_cast');
          }
        }

        // (Removed generic self-cast aura — ability-specific VFX handle each ability individually)

        // --- Ability-specific VFX (all 65 abilities — enhanced) ---
        if (source) {
          const pos = source.position;
          const aid = data.abilityId;
          const target = match.getUnit(data.targetId);
          const tpos = target ? target.position : pos;

          // ═══ TYRANT (Warrior) — heavy steel & blood VFX ═══
          const _tClv = VFX_TEXTURES.tyrantCleave;
          const _tSlm = VFX_TEXTURES.tyrantSlam;
          const _tCyc = VFX_TEXTURES.tyrantCyclone;
          if (aid === 'ravaging_cleave') {
            effects.spawnWeaponSwing(pos, { color: 0xcc2222, size: 5, tex: _tClv });
            effects.spawnDaggerFlurry(pos, { color: 0xcc3333, slashCount: 2, size: 3.5, duration: 0.4 });
            if (target) effects.spawnImpact(tpos, { color: 0xcc2222, school: 'physical', size: 3, weaponTrail: true, tex: _tClv });
            if (target) effects.spawnBlood(tpos, 1.0);
          }
          else if (aid === 'bloodrage_strike') {
            effects.spawnWeaponSwing(pos, { color: 0xaa3333, size: 3.5, tex: _tClv });
            if (target) effects.spawnBlood(tpos, 1.2);
            effects.spawnImpact(pos, { color: 0x880000, school: 'fire', size: 2, particleCount: 6, tex: VFX_TEXTURES.blood });
          }
          else if (aid === 'brutal_slam') {
            effects.spawnWeaponSwing(pos, { color: 0x999999, size: 4, tex: VFX_TEXTURES.steelSlash });
            if (target) effects.spawnGroundSlam(tpos, { color: 0x888888, size: 4, school: 'physical', debrisCount: 12, tex: _tSlm });
            if (target) effects.spawnImpact(tpos, { color: 0xaaaaaa, school: 'physical', size: 3, weaponTrail: true, tex: _tSlm });
            this.audio.playSFX('melee_hit');
          }
          else if (aid === 'iron_cyclone') {
            effects.spawnVortex(pos, { color: 0xcccccc, radius: 4, height: 5, duration: 6.0, school: 'physical' });
            effects.spawnGroundSlam(pos, { color: 0xaaaaaa, size: 5, school: 'physical', debrisCount: 10, tex: _tCyc });
            this.audio.playSFX('sword_hit');
          }
          else if (aid === 'shatter_guard') {
            effects.spawnWeaponSwing(pos, { color: 0xdd6622, size: 5, tex: _tClv });
            effects.spawnDaggerFlurry(pos, { color: 0xff8833, slashCount: 3, size: 3, duration: 0.5 });
            if (target) effects.spawnImpact(tpos, { color: 0xdd6622, school: 'fire', size: 4, weaponTrail: true, tex: _tClv });
            this.audio.playSFX('sword_hit');
          }
          else if (aid === 'warbringer_rush') {
            if (target) effects.spawnChargeTrail(pos, tpos, { color: 0xcc4444, duration: 0.8 });
            effects.spawnGroundSlam(pos, { color: 0xcc4444, size: 3, school: 'physical', debrisCount: 6 });
            if (target) effects.spawnImpact(tpos, { color: 0xcc4444, school: 'physical', size: 4 });
            this.audio.playSFX('melee_hit');
          }
          else if (aid === 'crippling_strike') {
            effects.spawnWeaponSwing(pos, { color: 0x4488ff, size: 3.5 });
            if (target) effects.spawnIceShards(tpos, { color: 0x88bbff, count: 4, size: 0.8, duration: 1.0 });
            if (target) effects.spawnImpact(tpos, { color: 0x4488ff, school: 'frost', size: 2 });
          }
          else if (aid === 'thunder_spike') {
            if (target) {
              effects.spawnLightningStrike(tpos, { color: 0xffff66, duration: 0.5, segments: 10 });
              effects.spawnImpact(tpos, { color: 0xffff44, school: 'arcane', size: 3, particleCount: 12 });
            }
            this.audio.playSFX('holy_impact');
          }
          else if (aid === 'iron_resolve') {
            effects.spawnShieldBubble(pos, { color: 0xaaaaaa, radius: 2.5, duration: 4.0, school: 'physical' });
            effects.spawnImpact(pos, { color: 0xcccccc, school: 'physical', size: 3, particleCount: 10 });
            this.audio.playSFX('holy_impact');
          }
          else if (aid === 'warborn_rally') {
            effects.spawnHealBurst(pos, { color: 0xcc4444, size: 4, school: 'fire', particleCount: 16 });
            effects.spawnShieldBubble(pos, { color: 0xcc8844, radius: 2.5, duration: 3.0, school: 'fire' });
            effects.spawnFireColumn(pos, { color: 0xcc6633, height: 5, radius: 0.8, duration: 0.8 });
            this.audio.playSFX('heal_cast');
          }
          else if (aid === 'skull_crack') {
            effects.spawnWeaponSwing(pos, { color: 0xccaa44, size: 3 });
            if (target) effects.spawnImpact(tpos, { color: 0xffcc44, school: 'physical', size: 3, weaponTrail: true });
            if (target) effects.spawnBlood(tpos, 0.8);
            this.audio.playSFX('melee_hit');
          }
          else if (aid === 'crushing_descent') {
            if (target) {
              effects.spawnGroundSlam(tpos, { color: 0x887766, size: 5, school: 'physical', debrisCount: 14 });
              effects.spawnChargeTrail(pos, tpos, { color: 0x887766, duration: 0.5 });
            }
            effects.spawnGroundSlam(pos, { color: 0x887766, size: 3, school: 'physical', debrisCount: 6 });
            this.audio.playSFX('melee_hit');
          }

          // ═══ WRAITH (Rogue) — shadow & poison VFX ═══
          else if (aid === 'viper_lash') {
            effects.spawnDaggerFlurry(pos, { color: 0x66cc44, slashCount: 2, size: 2.5, duration: 0.35 });
            effects.spawnWeaponSwing(pos, { color: 0x66aa44, size: 2.5, tex: VFX_TEXTURES.wraithPoison });
            if (target) effects.spawnImpact(tpos, { color: 0x66cc44, school: 'nature', size: 1.5, particleCount: 6, tex: VFX_TEXTURES.poison });
          }
          else if (aid === 'throat_opener') {
            effects.spawnDaggerFlurry(pos, { color: 0xaa44ff, slashCount: 3, size: 3, duration: 0.4 });
            if (target) effects.spawnBlood(tpos, 1.5);
            if (target) effects.spawnImpact(tpos, { color: 0x8844ff, school: 'shadow', size: 3, weaponTrail: true, tex: VFX_TEXTURES.wraithSlash });
            this.audio.playSFX('melee_hit');
          }
          else if (aid === 'grim_flurry') {
            effects.spawnDaggerFlurry(pos, { color: 0xcc3333, slashCount: 5, size: 3, duration: 0.7 });
            effects.spawnWeaponSwing(pos, { color: 0xaa2222, size: 4, tex: VFX_TEXTURES.wraithSlash });
            if (target) effects.spawnBlood(tpos, 2.0);
            if (target) effects.spawnImpact(tpos, { color: 0xaa2222, school: 'physical', size: 3, weaponTrail: true, tex: VFX_TEXTURES.blood });
            this.audio.playSFX('sword_hit');
          }
          else if (aid === 'nerve_strike') {
            effects.spawnDaggerFlurry(pos, { color: 0x8844ff, slashCount: 2, size: 2.5, duration: 0.3 });
            if (target) effects.spawnLightningStrike(tpos, { color: 0xaa88ff, duration: 0.3, segments: 6 });
            if (target) effects.spawnImpact(tpos, { color: 0xffff44, school: 'arcane', size: 2 });
            this.audio.playSFX('stun_hit');
          }
          else if (aid === 'serrated_wound') {
            effects.spawnDaggerFlurry(pos, { color: 0xcc2222, slashCount: 3, size: 2.5, duration: 0.4 });
            if (target) effects.spawnBlood(tpos, 2.0);
            if (target) effects.spawnImpact(tpos, { color: 0xcc2222, school: 'physical', size: 2, weaponTrail: true });
          }
          else if (aid === 'blackjack') {
            effects.spawnShadowNova(pos, { color: 0x6622aa, radius: 3, duration: 0.5 });
            if (target) effects.spawnImpact(tpos, { color: 0xffff44, school: 'arcane', size: 3, particleCount: 14 });
            this.audio.playSFX('stun_hit');
          }
          else if (aid === 'veil_of_night') {
            effects.spawnShadowNova(pos, { color: 0x6622aa, radius: 4, duration: 0.8 });
            effects.spawnRuneCircle(pos, { color: 0x6622aa, radius: 2.5, duration: 2.0, school: 'shadow' });
            this.audio.playSFX('shadow_impact');
          }
          else if (aid === 'shade_shift') {
            effects.spawnTeleportFlash(pos, { color: 0x6622aa, duration: 0.6, school: 'shadow' });
            effects.spawnImpact(pos, { color: 0x442266, school: 'shadow', size: 3, tex: VFX_TEXTURES.wraithShadow });
            this.audio.playSFX('shadow_impact');
          }
          else if (aid === 'phantasm_dodge') {
            effects.spawnShieldBubble(pos, { color: 0x8888cc, radius: 2.0, duration: 3.0, school: 'arcane' });
            effects.spawnImpact(pos, { color: 0xaaaaee, school: 'arcane', size: 2, particleCount: 8 });
          }
          else if (aid === 'umbral_shroud') {
            effects.spawnShieldBubble(pos, { color: 0x6622aa, radius: 2.5, duration: 3.0, school: 'shadow' });
            effects.spawnShadowNova(pos, { color: 0x440088, radius: 3, duration: 0.6 });
            this.audio.playSFX('shadow_impact');
          }
          else if (aid === 'blood_tincture') {
            effects.spawnHealBurst(pos, { color: 0x44cc44, size: 3, school: 'nature', particleCount: 14 });
            effects.spawnRuneCircle(pos, { color: 0x33aa33, radius: 1.5, duration: 1.5, school: 'nature' });
            this.audio.playSFX('heal_cast');
          }
          else if (aid === 'throat_jab') {
            effects.spawnWeaponSwing(pos, { color: 0xaa8844, size: 2.5 });
            if (target) effects.spawnImpact(tpos, { color: 0xaa8844, school: 'physical', size: 2, weaponTrail: true });
            if (target) effects.spawnBlood(tpos, 0.5);
          }
          else if (aid === 'frenzy_edge') {
            effects.spawnShadowNova(pos, { color: 0x8844ff, radius: 3, duration: 0.6 });
            effects.spawnAuraEffect(pos, { color: 0x8844ff, radius: 2.5, duration: 3.0 });
            effects.spawnDaggerFlurry(pos, { color: 0xaa66ff, slashCount: 3, size: 2.5, duration: 0.5 });
          }
          else if (aid === 'shadowmeld') {
            effects.spawnTeleportFlash(pos, { color: 0x442266, duration: 1.0, school: 'shadow' });
            effects.spawnShadowNova(pos, { color: 0x331155, radius: 2, duration: 0.5 });
          }

          // ═══ INFERNAL (Mage) — fire, frost & arcane VFX ═══
          else if (aid === 'inferno_bolt') {
            effects.spawnFireColumn(pos, { color: 0xff4400, height: 4, radius: 0.6, duration: 0.6 });
            effects.spawnImpact(pos, { color: 0xff4400, school: 'fire', size: 2, particleCount: 8, tex: VFX_TEXTURES.infernalFireball });
          }
          else if (aid === 'cataclysm_flare') {
            effects.spawnFireColumn(pos, { color: 0xff6600, height: 10, radius: 2.0, duration: 1.5 });
            effects.spawnGroundSlam(pos, { color: 0xff4400, size: 5, school: 'fire', debrisCount: 12, tex: VFX_TEXTURES.infernalEruption });
            effects.spawnRuneCircle(pos, { color: 0xff6600, radius: 3.5, duration: 2.0, school: 'fire' });
            this.audio.playSFX('fire_impact');
          }
          else if (aid === 'searing_pulse') {
            effects.spawnFireColumn(pos, { color: 0xff4400, height: 5, radius: 1.0, duration: 0.8 });
            if (target) effects.spawnFireColumn(tpos, { color: 0xff6600, height: 4, radius: 0.8, duration: 0.6 });
            if (target) effects.spawnImpact(tpos, { color: 0xff6600, school: 'fire', size: 3, particleCount: 12 });
            this.audio.playSFX('fire_impact');
          }
          else if (aid === 'glacial_lance') {
            effects.spawnIceShards(pos, { color: 0x88ccff, count: 6, size: 1.2, duration: 1.2 });
            effects.spawnImpact(pos, { color: 0x4488ff, school: 'frost', size: 2, tex: VFX_TEXTURES.infernalFrost });
          }
          else if (aid === 'permafrost_burst') {
            effects.spawnIceShards(pos, { color: 0x88ccff, count: 12, size: 2.0, duration: 2.0 });
            effects.spawnGroundSlam(pos, { color: 0x4488ff, size: 6, school: 'frost', debrisCount: 12, tex: VFX_TEXTURES.infernalFrost });
            this.audio.playSFX('shadow_impact');
          }
          else if (aid === 'phase_shift') {
            effects.spawnTeleportFlash(pos, { color: 0x6644ff, duration: 0.8, school: 'arcane' });
            effects.spawnRuneCircle(pos, { color: 0x6644ff, radius: 2.0, duration: 1.0, school: 'arcane' });
            effects.spawnImpact(pos, { color: 0x8844ff, school: 'arcane', size: 3, tex: VFX_TEXTURES.infernalArcane });
            this.audio.playSFX('shadow_impact');
          }
          else if (aid === 'pyroclasm') {
            effects.spawnFireColumn(pos, { color: 0xff4400, height: 14, radius: 2.5, duration: 2.0 });
            effects.spawnGroundSlam(pos, { color: 0xff4400, size: 7, school: 'fire', debrisCount: 16, tex: VFX_TEXTURES.infernalEruption });
            effects.spawnRuneCircle(pos, { color: 0xff6600, radius: 4.5, duration: 3.0, school: 'fire' });
            this.audio.playSFX('fire_impact');
          }
          else if (aid === 'crystalline_ward') {
            effects.spawnIceShards(pos, { color: 0x88ddff, count: 10, size: 1.8, duration: 4.0 });
            effects.spawnShieldBubble(pos, { color: 0x66ccff, radius: 2.5, duration: 4.0, school: 'frost' });
            this.audio.playSFX('shadow_impact');
          }
          else if (aid === 'cauterize') {
            effects.spawnHealBurst(pos, { color: 0xff6644, size: 4, school: 'fire', particleCount: 16 });
            effects.spawnFireColumn(pos, { color: 0xff8844, height: 6, radius: 0.8, duration: 0.8 });
            this.audio.playSFX('heal_cast');
          }
          else if (aid === 'arcane_bulwark') {
            effects.spawnShieldBubble(pos, { color: 0xaa44ff, radius: 2.5, duration: 4.0, school: 'arcane' });
            effects.spawnRuneCircle(pos, { color: 0xaa44ff, radius: 2.5, duration: 2.0, school: 'arcane' });
            this.audio.playSFX('spell_cast');
          }
          else if (aid === 'spell_fracture') {
            if (target) {
              effects.spawnLightningStrike(tpos, { color: 0xaa88ff, duration: 0.4, segments: 8 });
              effects.spawnImpact(tpos, { color: 0xaa44ff, school: 'arcane', size: 3, particleCount: 12 });
            }
            this.audio.playSFX('shadow_impact');
          }
          else if (aid === 'scaldwind') {
            effects.spawnFireColumn(pos, { color: 0xff4400, height: 6, radius: 1.5, duration: 1.0 });
            effects.spawnVortex(pos, { color: 0xff6633, radius: 3, height: 5, duration: 1.5, school: 'fire' });
            if (target) effects.spawnFireColumn(tpos, { color: 0xff4400, height: 4, radius: 0.8, duration: 0.8 });
            this.audio.playSFX('fire_impact');
          }
          else if (aid === 'ember_brand') {
            effects.spawnFireColumn(pos, { color: 0xff6600, height: 3, radius: 0.5, duration: 0.5 });
            effects.spawnImpact(pos, { color: 0xff6600, school: 'fire', size: 1.5, particleCount: 6 });
          }

          // ═══ HARBINGER (Warlock) — shadow & dark magic VFX ═══
          else if (aid === 'hex_blight') {
            if (target) {
              effects.spawnRuneCircle(tpos, { color: 0x6600aa, radius: 2.0, duration: 2.0, school: 'shadow' });
              effects.spawnShadowNova(tpos, { color: 0x6600aa, radius: 2, duration: 0.5 });
              effects.spawnImpact(tpos, { color: 0x6600aa, school: 'shadow', size: 2.5, tex: VFX_TEXTURES.harbingerCurse });
            }
          }
          else if (aid === 'creeping_torment') {
            if (target) {
              effects.spawnRuneCircle(tpos, { color: 0x440088, radius: 1.5, duration: 2.0, school: 'shadow' });
              effects.spawnImpact(tpos, { color: 0x440088, school: 'shadow', size: 2, particleCount: 10, tex: VFX_TEXTURES.harbingerCurse });
            }
          }
          else if (aid === 'volatile_hex') {
            if (target) effects.spawnShadowNova(tpos, { color: 0x8800ff, radius: 4, duration: 0.7 });
            effects.spawnRuneCircle(pos, { color: 0x8800ff, radius: 2.0, duration: 1.5, school: 'shadow' });
            effects.spawnImpact(pos, { color: 0x8800ff, school: 'shadow', size: 2 });
          }
          else if (aid === 'hex_rupture') {
            if (target) {
              effects.spawnShadowNova(tpos, { color: 0x6600aa, radius: 5, duration: 0.8 });
              effects.spawnGroundSlam(tpos, { color: 0x6600aa, size: 5, school: 'shadow', debrisCount: 12 });
              effects.spawnRuneCircle(tpos, { color: 0x8800ff, radius: 3.0, duration: 2.0, school: 'shadow' });
            }
            this.audio.playSFX('shadow_impact');
          }
          else if (aid === 'dread_howl') {
            effects.spawnShadowNova(pos, { color: 0x440066, radius: 6, duration: 1.0 });
            effects.spawnRuneCircle(pos, { color: 0x440066, radius: 4.0, duration: 2.5, school: 'shadow' });
            effects.spawnImpact(pos, { color: 0x440066, school: 'shadow', size: 4, particleCount: 14 });
            this.audio.playSFX('shadow_impact');
          }
          else if (aid === 'wraith_bolt') {
            if (target) effects.spawnProjectile(pos, tpos, { color: 0x8800ff, school: 'shadow', size: 1.0, speed: 50 });
            effects.spawnHealBurst(pos, { color: 0x44aa44, size: 2, school: 'nature' });
            effects.spawnRuneCircle(pos, { color: 0x44aa44, radius: 1.5, duration: 1.0, school: 'nature' });
          }
          else if (aid === 'nether_slam') {
            if (target) {
              effects.spawnGroundSlam(tpos, { color: 0x6600aa, size: 5, school: 'shadow', debrisCount: 12 });
              effects.spawnShadowNova(tpos, { color: 0x6600aa, radius: 4, duration: 0.6 });
              effects.spawnRuneCircle(tpos, { color: 0x8800ff, radius: 3.0, duration: 1.5, school: 'shadow' });
            }
            this.audio.playSFX('shadow_impact');
          }
          else if (aid === 'blood_tithe') {
            effects.spawnRuneCircle(pos, { color: 0x880000, radius: 2.5, duration: 2.0, school: 'shadow' });
            effects.spawnShieldBubble(pos, { color: 0x880044, radius: 2.0, duration: 3.0, school: 'shadow' });
            effects.spawnImpact(pos, { color: 0x880000, school: 'shadow', size: 3 });
          }
          else if (aid === 'warded_flesh') {
            effects.spawnShieldBubble(pos, { color: 0x6600aa, radius: 2.5, duration: 3.0, school: 'shadow' });
            effects.spawnRuneCircle(pos, { color: 0x6600aa, radius: 2.0, duration: 2.0, school: 'shadow' });
            this.audio.playSFX('shadow_impact');
          }
          else if (aid === 'rift_anchor') {
            effects.spawnTeleportFlash(pos, { color: 0x8800ff, duration: 0.8, school: 'shadow' });
            effects.spawnRuneCircle(pos, { color: 0x8800ff, radius: 2.5, duration: 3.0, school: 'shadow' });
            effects.spawnImpact(pos, { color: 0x8800ff, school: 'shadow', size: 2, tex: VFX_TEXTURES.harbingerPortal });
          }
          else if (aid === 'hex_silence') {
            if (target) {
              effects.spawnLightningStrike(tpos, { color: 0x8866ff, duration: 0.3, segments: 6 });
              effects.spawnImpact(tpos, { color: 0x6600aa, school: 'shadow', size: 3, particleCount: 12 });
            }
          }
          else if (aid === 'soul_ignite') {
            effects.spawnFireColumn(pos, { color: 0xff4400, height: 8, radius: 1.5, duration: 1.2 });
            effects.spawnRuneCircle(pos, { color: 0x8800ff, radius: 3.0, duration: 2.0, school: 'shadow' });
            effects.spawnShadowNova(pos, { color: 0xff6600, radius: 4, duration: 0.8 });
            this.audio.playSFX('fire_impact');
          }

          // ═══ REVENANT (Paladin) — diverse holy VFX ═══

          // Hallowed Strike — melee physical hit: weapon swing + sparking impact (NO pillar)
          else if (aid === 'hallowed_strike') {
            effects.spawnWeaponSwing(pos, { color: 0xf0e68c, size: 4, school: 'holy', tex: VFX_TEXTURES.revenantSmite });
            if (target) effects.spawnImpact(tpos, { color: 0xffe4b5, school: 'holy', size: 2.5, particleCount: 10, tex: VFX_TEXTURES.revenantSmite });
          }

          // Divine Reckoning — ranged judgment bolt: golden projectile + ground slam on impact
          else if (aid === 'divine_reckoning') {
            if (target) {
              effects.spawnProjectile(pos, tpos, { color: 0xffd700, school: 'holy', size: 1.0, speed: 55, tex: VFX_TEXTURES.energyOrb });
              effects.spawnGroundSlam(tpos, { color: 0xffa500, size: 3, school: 'holy', debrisCount: 6, tex: VFX_TEXTURES.revenantSmite });
              effects.spawnImpact(tpos, { color: 0xffd700, school: 'holy', size: 3, particleCount: 14, tex: VFX_TEXTURES.revenantSmite });
            }
            this.audio.playSFX('holy_impact');
          }

          // Radiant Verdict — big HP spender finisher: massive sword arc + explosive radiant burst
          else if (aid === 'radiant_verdict') {
            effects.spawnWeaponSwing(pos, { color: 0xfffacd, size: 7, school: 'holy', tex: VFX_TEXTURES.revenantSmite });
            effects.spawnDaggerFlurry(pos, { color: 0xffd700, slashCount: 3, size: 5, duration: 0.6, tex: VFX_TEXTURES.steelSlash });
            if (target) {
              effects.spawnImpact(tpos, { color: 0xffffff, school: 'holy', size: 6, particleCount: 24, tex: VFX_TEXTURES.revenantSmite });
              effects.spawnGroundSlam(tpos, { color: 0xffd700, size: 5, school: 'holy', debrisCount: 8, tex: VFX_TEXTURES.impactRing });
            }
            this.audio.playSFX('holy_impact');
          }

          // Sanctified Gale — AoE divine tempest: holy vortex + ground slam shockwave
          else if (aid === 'sanctified_gale') {
            effects.spawnVortex(pos, { color: 0xdaa520, radius: 4, height: 7, duration: 2.5, school: 'holy' });
            effects.spawnGroundSlam(pos, { color: 0xffd700, size: 6, school: 'holy', debrisCount: 12, tex: VFX_TEXTURES.impactRing });
            effects.spawnRuneCircle(pos, { color: 0xffd700, radius: 4, duration: 2.0, school: 'holy' });
            this.audio.playSFX('holy_impact');
          }

          // Ember Wake — holy lash with slow: fire-tinted holy burst + ember sparks
          else if (aid === 'ember_wake') {
            effects.spawnFireColumn(pos, { color: 0xffaa33, height: 6, radius: 1.2, duration: 0.8 });
            if (target) {
              effects.spawnImpact(tpos, { color: 0xff8c00, school: 'fire', size: 4, particleCount: 16, tex: VFX_TEXTURES.fire });
              effects.spawnGroundSlam(tpos, { color: 0xffa500, size: 3, school: 'holy', debrisCount: 6 });
            }
            this.audio.playSFX('holy_impact');
          }

          // Gavel of Light — 5s stun: hammer strike from sky + shockwave ring + stun impact
          else if (aid === 'gavel_of_light') {
            if (target) {
              effects.spawnLightningStrike(tpos, { color: 0xffd700, duration: 0.6, segments: 8 });
              effects.spawnGroundSlam(tpos, { color: 0xffd700, size: 5, school: 'holy', debrisCount: 10, tex: VFX_TEXTURES.stunImpact });
              effects.spawnImpact(tpos, { color: 0xffffff, school: 'holy', size: 4, particleCount: 18, tex: VFX_TEXTURES.stunImpact });
              effects.spawnRuneCircle(tpos, { color: 0xdaa520, radius: 2.0, duration: 1.5, school: 'holy' });
            }
            this.audio.playSFX('holy_impact');
          }

          // Binding Prayer — incapacitate: holy chains rune prison (no pillar)
          else if (aid === 'binding_prayer') {
            if (target) {
              effects.spawnRuneCircle(tpos, { color: 0xffd700, radius: 2.5, duration: 3.0, school: 'holy' });
              effects.spawnShieldBubble(tpos, { color: 0xffd70044, radius: 2.0, duration: 2.5, school: 'holy' });
              effects.spawnImpact(tpos, { color: 0xffd700, school: 'holy', size: 2, particleCount: 8, tex: VFX_TEXTURES.revenantShield });
            }
          }

          // Aegis of Dawn — divine shield immunity: golden bubble + radiant rune circle
          else if (aid === 'aegis_of_dawn') {
            effects.spawnShieldBubble(pos, { color: 0xffd700, radius: 3.5, duration: 6.0, school: 'holy' });
            effects.spawnRuneCircle(pos, { color: 0xdaa520, radius: 3.5, duration: 4.0, school: 'holy' });
            effects.spawnImpact(pos, { color: 0xffffff, school: 'holy', size: 5, particleCount: 20, tex: VFX_TEXTURES.revenantShield });
            this.audio.playSFX('holy_impact');
          }

          // Sovereign Mend — full heal: cascading green-gold heal burst + warm glow aura
          else if (aid === 'sovereign_mend') {
            effects.spawnHealBurst(pos, { color: 0x90ee90, size: 7, school: 'holy', particleCount: 28 });
            effects.spawnHolyPillar(pos, { color: 0xffd700, height: 12, radius: 1.5, duration: 1.2, tex: VFX_TEXTURES.revenantHeal });
            effects.spawnAuraEffect(pos, { color: 0x98fb98, radius: 4.0, duration: 2.5 });
            this.audio.playSFX('heal_cast');
          }

          // Holy Restoration — HP spender heal: warm golden heal motes rising
          else if (aid === 'holy_restoration') {
            effects.spawnHealBurst(pos, { color: 0xffd700, size: 5, school: 'holy', particleCount: 18 });
            effects.spawnAuraEffect(pos, { color: 0xffe4b5, radius: 3.0, duration: 2.0 });
            this.audio.playSFX('heal_cast');
          }

          // Unchained Grace — freedom: breaking chains burst + speed aura
          else if (aid === 'unchained_grace') {
            effects.spawnShadowNova(pos, { color: 0xffd700, radius: 3, duration: 0.5 });
            effects.spawnImpact(pos, { color: 0xffffff, school: 'holy', size: 3, particleCount: 12, tex: VFX_TEXTURES.revenantShield });
            effects.spawnAuraEffect(pos, { color: 0xffd700, radius: 3.5, duration: 2.5 });
          }

          // Sanctified Rebuff — interrupt: shield bash spark (no pillar)
          else if (aid === 'sanctified_rebuff') {
            effects.spawnWeaponSwing(pos, { color: 0xc0c0c0, size: 3, school: 'physical', tex: VFX_TEXTURES.steelSlash });
            if (target) effects.spawnImpact(tpos, { color: 0xffffff, school: 'holy', size: 2.5, particleCount: 8, tex: VFX_TEXTURES.stunImpact });
          }

          // Valiant Charge — speed buff: golden charge trail + wind burst
          else if (aid === 'valiant_charge') {
            effects.spawnChargeTrail(pos, { x: pos.x + 5, z: pos.z + 5 }, { color: 0xffd700, duration: 1.0 });
            effects.spawnShadowNova(pos, { color: 0xffd700, radius: 2, duration: 0.4 });
            effects.spawnImpact(pos, { color: 0xffd700, school: 'holy', size: 3, particleCount: 10, tex: VFX_TEXTURES.energyOrb });
          }
        }
      }
    });

    // --- Channel beam VFX (for drain abilities like Siphon Essence) ---
    this._activeBeams = new Map();
    eventBus.on(EVENTS.CHANNEL_START, (data) => {
      const source = match.getUnit(data.sourceId);
      const target = data.targetId != null ? match.getUnit(data.targetId) : null;
      if (source && target && target.id !== source.id) {
        const ability = source.abilities.get(data.abilityId);
        const school = ability?.school || 'shadow';
        const color = effects.getSchoolColor(school);
        // Spawn textured beam that lasts the full channel duration
        const channelDuration = ability?.channelDuration ? ability.channelDuration / 10 : 5.0;
        const beamTex = school === 'shadow' ? VFX_TEXTURES.harbingerDrain
          : school === 'fire' ? VFX_TEXTURES.fire
          : school === 'holy' ? VFX_TEXTURES.holy
          : VFX_TEXTURES[school] || null;
        effects.spawnBeam(source.position, target.position, { color, duration: channelDuration + 0.5, school, tex: beamTex });
        this._activeBeams.set(data.sourceId, { targetId: data.targetId, school });
      }
    });
    eventBus.on(EVENTS.CHANNEL_TICK, (data) => {
      const source = match.getUnit(data.sourceId);
      const target = data.targetId != null ? match.getUnit(data.targetId) : null;
      if (source && target) {
        const ability = source.abilities.get(data.abilityId);
        const school = ability?.school || 'shadow';
        const color = effects.getSchoolColor(school);
        // Only spawn tick impact — do NOT spawn another beam
        effects.spawnImpact(target.position, { color, school, size: 2.0 });
      }
    });
    eventBus.on(EVENTS.CHANNEL_END, (data) => {
      this._activeBeams.delete(data.sourceId);
    });

    // --- Auto-attack swing SFX ---
    eventBus.on(EVENTS.AUTO_ATTACK, (data) => {
      const source = match.getUnit(data.sourceId);
      if (source && source.autoAttackDamage > 0) {
        this.audio.playSFX('melee_hit');
      }
    });

    eventBus.on(EVENTS.DAMAGE_DEALT, (data) => {
      // Track stats
      if (data.sourceId === 0) this._matchStats.playerDamage += data.amount;
      if (data.sourceId === 1) this._matchStats.enemyDamage += data.amount;
      if (data.targetId === 0) this._matchStats.playerDamageTaken += data.amount;
      if (data.targetId === 1) this._matchStats.enemyDamageTaken += data.amount;

      const target = match.getUnit(data.targetId);
      if (!target) return;

      const dmgRatio = data.amount / 10000; // 0-1+ scale
      const school = data.school || 'physical';

      // --- Blood / spark particles (scaled by damage) ---
      effects.spawnBlood(target.position, Math.min(3, dmgRatio * 2));

      // --- Impact SFX ---
      if (school === 'physical') this.audio.playSFX('sword_hit');
      else if (school === 'fire') this.audio.playSFX('fire_impact');
      else if (school === 'shadow' || school === 'dark') this.audio.playSFX('shadow_impact');
      else if (school === 'holy') this.audio.playSFX('holy_impact');
      else if (school === 'frost' || school === 'arcane') this.audio.playSFX('shadow_impact');
      else if (school === 'nature') this.audio.playSFX('holy_impact');
      else this.audio.playSFX('spell_cast');

      // --- Screen shake on ALL hits (scaled by damage) ---
      const shakeIntensity = Math.min(0.5, dmgRatio * 0.25 + 0.05);
      const shakeDuration = Math.min(0.35, dmgRatio * 0.15 + 0.1);
      camera.shake(shakeIntensity, shakeDuration);

      // --- Hit stop for heavy hits (60-120ms freeze) ---
      if (data.amount > 5000) {
        const hitStopMs = Math.min(120, 40 + dmgRatio * 50);
        this.gameLoop.hitStop(hitStopMs);
      }

      // --- FOV punch on crits and big hits ---
      if (data.isCrit) camera.fovPunch(60, 0.04);
      else if (data.amount > 8000) camera.fovPunch(58, 0.03);

      // --- Combat text ---
      const type = data.isCrit ? 'crit' : 'damage';
      const text = data.isCrit ? `${data.amount}!` : `${data.amount}`;
      this.spawnWorldCombatText(target.position, text, type);

      // --- Projectile or impact VFX ---
      const source = match.getUnit(data.sourceId);
      if (source && data.abilityId !== 'auto_attack') {
        const dist = source.position.distanceXZ(target.position);
        if (dist > 8) {
          effects.spawnProjectile(source.position, target.position, { color: effects.getSchoolColor(school), school });
        } else {
          effects.spawnImpact(target.position, { color: effects.getSchoolColor(school), school, scale: 1.0 + dmgRatio });
        }
      }

      // --- Always spawn impact flash for melee hits ---
      if (data.abilityId === 'auto_attack' || (source && source.position.distanceXZ(target.position) < 8)) {
        effects.spawnImpact(target.position, { color: effects.getSchoolColor(school), school, scale: 0.8 + dmgRatio });
      }

      // --- Hit flash + squash on target model ---
      const targetModel = this.characterRenderer.getCharacter(data.targetId);
      if (targetModel) {
        this.characterRenderer.animateHit(targetModel);
        // Squash on the body group, NOT the root model (root is scaled 2.5x)
        const bodyGroup = targetModel.getObjectByName('body');
        if (bodyGroup) {
          const squashAmount = Math.min(0.15, dmgRatio * 0.08);
          bodyGroup.scale.set(1 + squashAmount, 1 - squashAmount, 1 + squashAmount);
          if (targetModel.userData._squashTimeout) clearTimeout(targetModel.userData._squashTimeout);
          targetModel.userData._squashTimeout = setTimeout(() => {
            bodyGroup.scale.set(1, 1, 1);
            targetModel.userData._squashTimeout = null;
          }, 150);
        }
      }
    });

    eventBus.on(EVENTS.HEALING_DONE, (data) => {
      if (data.targetId === 0) this._matchStats.playerHealing += data.amount;
      if (data.targetId === 1) this._matchStats.enemyHealing += data.amount;
      this.audio.playSFX('heal_cast');
      const target = match.getUnit(data.targetId);
      if (target) this.spawnWorldCombatText(target.position, `+${data.amount}`, 'heal');
    });

    eventBus.on(EVENTS.CC_APPLIED, (data) => {
      if (data.ccType === 'stun') this.audio.playSFX('stun_hit');
      else if (data.ccType === 'fear') this.audio.playSFX('shadow_impact');
      else if (data.ccType === 'root') this.audio.playSFX('holy_impact');
      else if (data.ccType === 'silence') this.audio.playSFX('spell_cast');
      const target = match.getUnit(data.targetId);
      if (target) {
        this.spawnWorldCombatText(target.position, data.ccType.toUpperCase(), 'cc');
        // Spawn CC visual effects
        if (data.ccType === 'stun' || data.ccType === 'incapacitate') {
          effects.spawnStunStars(target.position);
        } else if (data.ccType === 'fear' || data.ccType === 'disorient') {
          effects.spawnFearEffect(target.position);
        } else if (data.ccType === 'root') {
          effects.spawnRootEffect(target.position);
        }
        // Impact flash at target
        effects.spawnImpact(target.position, { color: 0xffd700, school: 'holy' });
      }
    });

    eventBus.on(EVENTS.CC_IMMUNE, (data) => {
      const target = match.getUnit(data.targetId);
      if (target) this.spawnWorldCombatText(target.position, 'IMMUNE', 'immune');
    });

    eventBus.on(EVENTS.AURA_TICK, (data) => {
      if (data.damage > 0) {
        // Trigger a subtle damage flash on the affected unit for DoT ticks
        const model = this.characterRenderer.getCharacter(data.unitId);
        if (model) {
          this.characterRenderer.animateHit(model);
        }
      }
    });

    eventBus.on(EVENTS.MATCH_END, (data) => {
      if (this._cleaningUp) return;
      this.audio.playSFX('death');
      this._matchEndTimeout = setTimeout(() => {
        if (this._cleaningUp) return;
        this.showMatchEnd(data);
      }, 500);
    });

    // --- Ground zone VFX ---
    const ZONE_COLORS = {
      scorched_earth: 0xff4400,
      ring_of_frost: 0x88ccff,
      shadowfury: 0x6600aa,
      abyssal_ground: 0x440088
    };
    eventBus.on(EVENTS.GROUND_ZONE_PLACED, (data) => {
      if (!this.spellEffects) return;
      const color = ZONE_COLORS[data.type] || 0xff4400;
      this.spellEffects.spawnGroundZone(data.position, {
        id: data.id,
        color,
        radius: data.radius,
        duration: data.duration / 10, // ticks to seconds
        school: data.school,
        type: data.type
      });
    });
    eventBus.on(EVENTS.GROUND_ZONE_EXPIRED, (data) => {
      if (!this.spellEffects) return;
      this.spellEffects.removeGroundZone(data.id);
    });
  }

  _setModelTint(model, color, intensity) {
    if (model.userData._tintColor === color) return; // already tinted
    model.userData._tintColor = color;
    model.traverse((child) => {
      if (child.isMesh && child.material) {
        const mat = child.material;
        if (!mat._origEmissive) {
          mat._origEmissive = mat.emissive ? mat.emissive.getHex() : 0x000000;
          mat._origEmissiveIntensity = mat.emissiveIntensity || 0;
          mat._origOpacity = mat.opacity;
        }
        if (mat.emissive) {
          mat.emissive.setHex(color);
          mat.emissiveIntensity = intensity;
        }
      }
    });
  }

  _clearModelTint(model) {
    if (!model.userData._tintColor) return; // already clear
    model.userData._tintColor = null;
    model.traverse((child) => {
      if (child.isMesh && child.material) {
        const mat = child.material;
        if (mat._origEmissive !== undefined) {
          if (mat.emissive) {
            mat.emissive.setHex(mat._origEmissive);
            mat.emissiveIntensity = mat._origEmissiveIntensity;
          }
          mat.opacity = mat._origOpacity;
          delete mat._origEmissive;
          delete mat._origEmissiveIntensity;
          delete mat._origOpacity;
        }
      }
    });
  }

  spawnWorldCombatText(worldPos, text, type) {
    const camera = this.sceneManager.getCamera();
    const vec = new THREE.Vector3(worldPos.x, (worldPos.y || 0) + 2.5, worldPos.z);
    vec.project(camera);
    const screenX = (vec.x * 0.5 + 0.5) * window.innerWidth;
    const screenY = (-(vec.y * 0.5) + 0.5) * window.innerHeight;
    this.hud.spawnCombatText(screenX, screenY, text, type);
  }

  getUnitRenderState(unit, currentTick) {
    let state = 'idle';
    let castProgress = 0;
    let attackProgress = 0;
    let castAbilityId = null;
    let attackAbilityId = null;

    if (!unit.isAlive) {
      state = 'dead';
    } else if (unit.isStunned) {
      state = 'stunned';
    } else if (unit.isFeared) {
      state = 'feared';
    } else if (unit.isCasting) {
      state = 'casting';
      castAbilityId = unit.castState.abilityId || null;
      const total = unit.castState.endTick - unit.castState.startTick;
      castProgress = total > 0 ? (currentTick - unit.castState.startTick) / total : 0;
    } else if (unit.isChanneling) {
      state = 'casting';
      castAbilityId = unit.channelState.abilityId || null;
      const total = unit.channelState.endTick - unit.channelState.startTick;
      castProgress = total > 0 ? (currentTick - unit.channelState.startTick) / total : 0;
    } else if (unit.isRooted && unit.moveTarget) {
      state = 'rooted';
    } else if (unit.isSilenced && unit.isCasting) {
      state = 'silenced';
    } else if (unit.moveTarget) {
      state = 'moving';
    }

    // Whirlwind spin (Iron Cyclone active)
    const whirlwind = unit.auras.has('iron_cyclone_active');

    // Dodge roll animation overrides most states
    let rollProgress = 0;
    if (unit.dodgeRollState && state !== 'dead') {
      rollProgress = Math.min(1, (currentTick - unit.dodgeRollState.startTick) / DODGE_ROLL_DURATION);
      state = 'rolling';
    }

    // Attack animation: detect auto-attacks OR melee ability use
    if (state !== 'dead' && state !== 'stunned' && state !== 'feared' && state !== 'casting' && state !== 'rolling') {
      let bestProgress = -1;

      // Auto-attack swing
      if (unit.autoAttackEnabled && unit.swingTimer > 0) {
        const ticksSinceSwing = currentTick - (unit.nextSwingTick - unit.swingTimer);
        const swingAnimDuration = Math.min(unit.swingTimer, 9);
        if (ticksSinceSwing >= 0 && ticksSinceSwing < swingAnimDuration) {
          bestProgress = ticksSinceSwing / swingAnimDuration;
        }
      }

      // Instant ability use animation (melee strikes, instant casts, buffs)
      const lastAnim = this._lastAbilityAnim?.get(unit.id);
      if (lastAnim != null) {
        const ticksSinceAbility = currentTick - lastAnim.tick;
        const abilityAnimDuration = 8; // 0.8s — ability use window
        if (ticksSinceAbility >= 0 && ticksSinceAbility < abilityAnimDuration) {
          const p = ticksSinceAbility / abilityAnimDuration;
          if (p < bestProgress || bestProgress < 0) {
            bestProgress = p;
            attackAbilityId = lastAnim.abilityId;
          }
        }
      }

      if (bestProgress >= 0) {
        state = 'attacking';
        attackProgress = bestProgress;
      }
    }

    const result = { position: { x: unit.position.x, y: unit.position.y || 0, z: unit.position.z }, rotation: unit.facing, stealthed: unit.stealthed, state, speed: unit.getEffectiveMoveSpeed(), castProgress, attackProgress, rollProgress, whirlwind, castAbilityId, attackAbilityId };

    // Jump Y offset
    const jumpState = this._jumpStates?.get(unit.id);
    if (jumpState && !jumpState.done) {
      const elapsed = (performance.now() / 1000) - jumpState.startTime;
      if (elapsed >= jumpState.duration) {
        jumpState.done = true;
      } else {
        const t = elapsed / jumpState.duration;
        result.position.y = (result.position.y || 0) + 4 * 2.5 * t * (1 - t);
      }
    }

    return result;
  }

  render(alpha, match) {
    if (!match) return;

    const time = performance.now() / 1000;
    const deltaTime = 1 / 60;

    // --- Click-to-target ---
    this._processClickTargeting();

    // --- Jump ---
    if (this.inputManager.consumeJump() && this.matchState) {
      const existing = this._jumpStates.get(0);
      if (!existing || existing.done) {
        this._jumpStates.set(0, { startTime: performance.now() / 1000, duration: 0.5, done: false });
        if (this.audio) setTimeout(() => this.audio.playSFX('jump_land'), 500);
      }
    }

    // --- Dodge roll ---
    const dodgeDir = this.inputManager.consumeDodgeRoll();
    if (dodgeDir && this.matchState) {
      const cameraAngle = this.cameraController?.rotationAngle || 0;
      const player = this.matchState.getUnit(0);
      if (player && player.isAlive) {
        const started = this.gameLoop.engine.movement.startDodgeRoll(player, dodgeDir, this.matchState.tick, cameraAngle);
        if (started) {
          if (this.audio) this.audio.playSFX('dodge_roll');
          // Apply snare to nearby enemies on dodge roll
          const currentTick = this.matchState.tick;
          for (const unit of this.matchState.units) {
            if (unit.id === player.id || !unit.isAlive) continue;
            const dist = player.distanceTo(unit);
            if (dist <= DODGE_ROLL_SNARE_RANGE) {
              unit.auras.apply(new Aura({
                id: 'dodge_roll_snare',
                name: 'Tumble Snare',
                type: 'debuff',
                sourceId: player.id,
                targetId: unit.id,
                school: 'physical',
                duration: DODGE_ROLL_SNARE_DURATION,
                appliedTick: currentTick,
                isMagic: false,
                isDispellable: false,
                statMods: { moveSpeedMultiplier: DODGE_ROLL_SNARE }
              }));
            }
          }
        }
      }
    }

    this.arenaRenderer.animate(deltaTime);

    for (const unit of match.units) {
      const renderState = this.getUnitRenderState(unit, match.tick);

      // Interpolate position between previous and current tick for smooth movement
      if (this._prevPositions && unit.isAlive) {
        const prev = this._prevPositions.get(unit.id);
        if (prev) {
          const jumpY = renderState.position.y || 0;
          renderState.position = {
            x: prev.x + (unit.position.x - prev.x) * alpha,
            y: (prev.y || 0) + ((unit.position.y || 0) - (prev.y || 0)) * alpha,
            z: prev.z + (unit.position.z - prev.z) * alpha,
          };
          // Preserve jump Y offset (additive on top of interpolated position)
          if (jumpY > 0) {
            renderState.position.y = jumpY;
          }
        }
      }

      this.characterRenderer.updateCharacter(unit.id, renderState, time);

      // --- Persistent buff visual overlays ---
      const model = this.characterRenderer.getCharacter(unit.id);
      if (model && unit.isAlive) {
        // Ice Block (immune to all, can't act) — blue tint
        if (unit.immuneToAll && !unit.canActWhileImmune) {
          this._setModelTint(model, 0x66ccff, 0.55);
        }
        // Divine Shield (immune to all, can act) — golden tint
        else if (unit.immuneToAll && unit.canActWhileImmune) {
          this._setModelTint(model, 0xffd700, 0.4);
        }
        // Physical immunity — faded silver
        else if (unit.immuneToPhysical) {
          this._setModelTint(model, 0x8888cc, 0.3);
        }
        // Magic immunity — dark purple tint
        else if (unit.immuneToMagic) {
          this._setModelTint(model, 0x6622aa, 0.3);
        }
        // Normal — clear tint
        else {
          this._clearModelTint(model);
        }
      }
    }

    const player = match.getUnit(0);
    if (player && this._prevPositions) {
      const prev = this._prevPositions.get(0);
      if (prev) {
        const interpPos = {
          x: prev.x + (player.position.x - prev.x) * alpha,
          y: prev.y + (player.position.y - prev.y) * alpha,
          z: prev.z + (player.position.z - prev.z) * alpha,
        };
        this.cameraController.setTarget(interpPos);
      } else {
        this.cameraController.setTarget(player.position);
      }
      this.cameraController.setFacing(player.facing);
      this.cameraController.update(deltaTime);
    }

    this.spellEffects.update(deltaTime);
    this._updateTargetRing(match, time);

    const playerUnit = match.getUnit(0);
    const enemyUnit = match.getUnit(1);
    if (playerUnit) {
      const playerData = HUD.adaptUnit(playerUnit, match.tick);
      this.hud.updatePlayerFrame(playerData);
      this.hud.updateCCStatus(playerData);
      const adaptedAbilities = HUD.adaptAbilities(playerUnit, this._abilityOrder, match.tick);
      this.hud.updateAbilityBar({ abilities: adaptedAbilities }, match.tick);
      const playerCast = HUD.adaptCastBar(playerUnit, match.tick);
      this.hud.updateCastBar({ casting: playerCast }, match.tick, 'player');
      // Dodge roll cooldown indicator
      const dodgeCdRemaining = Math.max(0, playerUnit.dodgeRollCooldownEndTick - match.tick);
      this.hud.updateDodgeRollIndicator(dodgeCdRemaining, playerUnit.isDodging);
      // Swing timer
      this.hud.updateSwingTimer(match.tick, playerUnit.nextSwingTick, playerUnit.swingTimer, playerUnit.autoAttackDamage > 0);
    }
    if (enemyUnit) {
      this.hud.updateEnemyFrame(HUD.adaptUnit(enemyUnit, match.tick));
      const enemyCast = HUD.adaptCastBar(enemyUnit, match.tick);
      this.hud.updateCastBar({ casting: enemyCast }, match.tick, 'enemy');
    }
    this.hud.updateTimer(match.tick / 10);

    // World-space nameplates
    const nameplateUnits = [];
    for (const unit of match.units) {
      // Use interpolated position if available
      let pos = unit.position;
      if (this._prevPositions && unit.isAlive) {
        const prev = this._prevPositions.get(unit.id);
        if (prev) {
          pos = {
            x: prev.x + (unit.position.x - prev.x) * alpha,
            y: prev.y + (unit.position.y - prev.y) * alpha,
            z: prev.z + (unit.position.z - prev.z) * alpha,
          };
        }
      }
      nameplateUnits.push({
        id: unit.id,
        classId: unit.classId,
        hp: unit.hp,
        maxHp: unit.maxHp,
        position: pos,
        alive: unit.isAlive,
      });
    }
    this.hud.updateNameplates(
      nameplateUnits,
      this.sceneManager.getCamera(),
      this.sceneManager.getRenderer()
    );

    // FPS counter
    this._fpsFrameCount++;
    const now = performance.now();
    if (now - this._fpsLastTime >= 500) {
      const fps = Math.round(this._fpsFrameCount / ((now - this._fpsLastTime) / 1000));
      if (this._fpsDisplay) this._fpsDisplay.textContent = `FPS: ${fps}`;
      this._fpsFrameCount = 0;
      this._fpsLastTime = now;
    }

    this.sceneManager.render();
  }

  showMatchEnd(data) {
    this._matchEndTimeout = null;
    if (this.gameLoop) this.gameLoop.pause();
    this.audio.stopMusic();
    const isWinner = data.winner === 0;
    this.audio.playSFX(isWinner ? 'victory_sting' : 'defeat_sting');
    const winnerClassId = isWinner ? this.playerClassId : this.enemyClassId;
    const loserClassId = isWinner ? this.enemyClassId : this.playerClassId;
    const winnerClass = CLASS_REGISTRY[winnerClassId];
    const loserClass = CLASS_REGISTRY[loserClassId];
    const stats = this._matchStats;
    const duration = data.duration || 0;
    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60).toString().padStart(2, '0');

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      z-index: 500; overflow: hidden; pointer-events: auto;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    `;

    // Background image
    const bgImg = isWinner ? '/assets/art/victory_bg.webp' : '/assets/art/defeat_bg.webp';
    const bg = document.createElement('div');
    bg.style.cssText = `
      position: absolute; top: -5%; left: -5%; width: 110%; height: 110%;
      background: url('${bgImg}') center/cover no-repeat;
      filter: brightness(${isWinner ? 0.3 : 0.2}) saturate(1.2);
      animation: homeBgPan 20s ease-in-out infinite alternate;
    `;
    overlay.appendChild(bg);

    // Dark overlay gradient
    const grad = document.createElement('div');
    grad.style.cssText = `
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      background: linear-gradient(180deg,
        rgba(0,0,0,0.4) 0%,
        rgba(0,0,0,0.3) 30%,
        rgba(0,0,0,0.6) 70%,
        rgba(0,0,0,0.9) 100%);
    `;
    overlay.appendChild(grad);

    // Particles
    const particleColor = isWinner ? 'rgba(255,215,0,0.5)' : 'rgba(139,0,0,0.4)';
    this._spawnScreenParticles(overlay, 20, particleColor);

    // Content wrapper
    const content = document.createElement('div');
    content.style.cssText = `
      position: relative; z-index: 2; display: flex; flex-direction: column;
      align-items: center; width: 100%; max-width: 900px; padding: 0 20px;
      overflow-y: auto; max-height: 100vh;
    `;
    overlay.appendChild(content);

    // Victory/Defeat title
    const titleText = isWinner ? 'VICTORY' : 'DEFEAT';
    const titleColor = isWinner ? '#ffd700' : '#8b0000';
    const titleAnim = isWinner ? 'victoryTitleGlow' : 'defeatTitleGlow';
    const title = document.createElement('h1');
    title.textContent = titleText;
    title.style.cssText = `
      font-size: 60px; letter-spacing: 14px; color: ${titleColor};
      margin: 0 0 2px 0; font-weight: 900;
      animation: ${titleAnim} 2s ease-in-out infinite alternate, fadeInUp 0.8s ease-out;
    `;
    content.appendChild(title);

    // Decorative line
    const line = document.createElement('div');
    line.style.cssText = `
      width: 150px; height: 2px; margin: 0 auto 12px;
      background: linear-gradient(90deg, transparent, ${titleColor}, transparent);
      animation: fadeIn 1s 0.3s ease-out both;
    `;
    content.appendChild(line);

    // Match info row
    const matchInfo = document.createElement('div');
    matchInfo.style.cssText = `
      display: flex; align-items: center; gap: 24px; margin-bottom: 20px;
      animation: fadeInUp 0.6s 0.2s ease-out both;
    `;

    // Winner portrait
    const portraitWrap = document.createElement('div');
    portraitWrap.style.cssText = `
      width: 90px; height: 120px; border-radius: 6px; overflow: hidden; flex-shrink: 0;
      border: 2px solid ${winnerClass?.color || titleColor};
      box-shadow: 0 0 20px ${(winnerClass?.color || titleColor)}30;
    `;
    const portraitImg = document.createElement('img');
    portraitImg.src = `/assets/art/${winnerClassId}_splash.webp`;
    portraitImg.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
    portraitWrap.appendChild(portraitImg);
    matchInfo.appendChild(portraitWrap);

    // Match details
    const details = document.createElement('div');
    details.style.cssText = 'text-align: left;';

    const winnerName = document.createElement('div');
    winnerName.textContent = `${winnerClass?.name || 'Unknown'} wins`;
    winnerName.style.cssText = `
      font-size: 20px; color: #ddd; font-weight: bold; letter-spacing: 3px;
      text-transform: uppercase; margin-bottom: 4px;
    `;
    details.appendChild(winnerName);

    const matchup = document.createElement('div');
    matchup.innerHTML = `${CLASS_REGISTRY[this.playerClassId]?.name || '?'} <span style="color:#555">vs</span> ${CLASS_REGISTRY[this.enemyClassId]?.name || '?'} <span style="color:#c8a860;margin-left:12px;font-weight:bold">${minutes}:${seconds}</span>`;
    matchup.style.cssText = 'font-size: 13px; color: #888; letter-spacing: 2px;';
    details.appendChild(matchup);

    matchInfo.appendChild(details);
    content.appendChild(matchInfo);

    // Stats panel
    const statsPanel = document.createElement('div');
    statsPanel.style.cssText = `
      width: 100%; max-width: 600px;
      background: rgba(10,10,20,0.8); border: 1px solid #2a2a3a;
      border-radius: 8px; overflow: hidden;
      animation: fadeInUp 0.6s 0.4s ease-out both;
    `;

    // Stats header
    const statsHeader = document.createElement('div');
    statsHeader.style.cssText = `
      display: grid; grid-template-columns: 1fr auto 1fr; padding: 10px 20px;
      background: rgba(20,20,30,0.5); border-bottom: 1px solid #2a2a3a;
    `;
    const playerClassDef = CLASS_REGISTRY[this.playerClassId];
    const enemyClassDef = CLASS_REGISTRY[this.enemyClassId];
    statsHeader.innerHTML = `
      <div style="color:${playerClassDef?.color || '#888'};font-size:12px;letter-spacing:2px;font-weight:bold;text-transform:uppercase">YOU</div>
      <div style="color:#444;font-size:10px;letter-spacing:3px">STATS</div>
      <div style="color:${enemyClassDef?.color || '#888'};font-size:12px;letter-spacing:2px;font-weight:bold;text-align:right;text-transform:uppercase">ENEMY</div>
    `;
    statsPanel.appendChild(statsHeader);

    // Stats rows
    const statRows = [
      ['Damage Dealt', stats.playerDamage, stats.enemyDamage],
      ['Damage Taken', stats.playerDamageTaken, stats.enemyDamageTaken],
      ['Healing Done', stats.playerHealing, stats.enemyHealing],
    ];

    const formatNum = (n) => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);

    statRows.forEach(([label, playerVal, enemyVal], i) => {
      const row = document.createElement('div');
      const maxVal = Math.max(playerVal, enemyVal, 1);
      const playerPct = (playerVal / maxVal) * 100;
      const enemyPct = (enemyVal / maxVal) * 100;

      row.style.cssText = `
        display: grid; grid-template-columns: 1fr auto 1fr; padding: 8px 20px;
        align-items: center;
        ${i < statRows.length - 1 ? 'border-bottom: 1px solid #1a1a2a;' : ''}
      `;

      // Player stat (left-aligned bar growing right)
      const playerCell = document.createElement('div');
      playerCell.style.cssText = 'position: relative; height: 24px; display: flex; align-items: center;';
      const playerBar = document.createElement('div');
      playerBar.style.cssText = `
        position: absolute; left: 0; top: 0; height: 100%;
        width: ${playerPct}%; background: ${playerClassDef?.color || '#444'}25;
        border-radius: 3px; transition: width 1s ease-out;
      `;
      const playerText = document.createElement('span');
      playerText.textContent = formatNum(playerVal);
      playerText.style.cssText = 'position: relative; z-index: 1; font-size: 14px; color: #ddd; font-weight: bold;';
      playerCell.appendChild(playerBar);
      playerCell.appendChild(playerText);
      row.appendChild(playerCell);

      // Label (center)
      const labelDiv = document.createElement('div');
      labelDiv.textContent = label;
      labelDiv.style.cssText = 'font-size: 9px; color: #555; letter-spacing: 2px; text-transform: uppercase; padding: 0 16px; white-space: nowrap;';
      row.appendChild(labelDiv);

      // Enemy stat (right-aligned bar growing left)
      const enemyCell = document.createElement('div');
      enemyCell.style.cssText = 'position: relative; height: 24px; display: flex; align-items: center; justify-content: flex-end;';
      const enemyBar = document.createElement('div');
      enemyBar.style.cssText = `
        position: absolute; right: 0; top: 0; height: 100%;
        width: ${enemyPct}%; background: ${enemyClassDef?.color || '#444'}25;
        border-radius: 3px; transition: width 1s ease-out;
      `;
      const enemyText = document.createElement('span');
      enemyText.textContent = formatNum(enemyVal);
      enemyText.style.cssText = 'position: relative; z-index: 1; font-size: 14px; color: #ddd; font-weight: bold;';
      enemyCell.appendChild(enemyBar);
      enemyCell.appendChild(enemyText);
      row.appendChild(enemyCell);

      statsPanel.appendChild(row);
    });

    content.appendChild(statsPanel);

    // Buttons
    const btnRow = document.createElement('div');
    btnRow.style.cssText = `
      display: flex; gap: 16px; margin-top: 28px;
      animation: fadeInUp 0.6s 0.6s ease-out both;
    `;

    const makeBtn = (text, isPrimary, onClick) => {
      const btn = document.createElement('button');
      btn.textContent = text;
      btn.style.cssText = `
        padding: 14px 36px; font-size: 13px; letter-spacing: 3px;
        font-family: inherit; font-weight: bold; cursor: pointer;
        border-radius: 4px; transition: all 0.2s; pointer-events: auto;
        ${isPrimary
          ? `background: linear-gradient(180deg, #8b0000, #5a0000); border: 2px solid #c8a860; color: #c8a860;
             box-shadow: 0 0 20px rgba(139,0,0,0.4);`
          : `background: rgba(20,20,30,0.8); border: 1px solid #2a2a3a; color: #888;`
        }
      `;
      btn.addEventListener('mouseenter', () => {
        btn.style.transform = 'scale(1.05)';
        if (isPrimary) btn.style.boxShadow = '0 0 30px rgba(139,0,0,0.6)';
        else btn.style.borderColor = '#555';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.transform = 'scale(1)';
        if (isPrimary) btn.style.boxShadow = '0 0 20px rgba(139,0,0,0.4)';
        else btn.style.borderColor = '#2a2a3a';
      });
      btn.addEventListener('click', onClick);
      return btn;
    };

    const playAgainBtn = makeBtn('PLAY AGAIN', true, () => {
      overlay.remove();
      this.cleanup();
      this.startMatch();
    });
    this._addButtonSFX(playAgainBtn);
    btnRow.appendChild(playAgainBtn);

    const changeClassBtn = makeBtn('CHANGE CLASS', false, () => {
      overlay.remove();
      this.cleanup();
      const screen = document.getElementById('loading-screen');
      screen.style.display = 'flex';
      this.showClassSelect();
    });
    this._addButtonSFX(changeClassBtn);
    btnRow.appendChild(changeClassBtn);

    const homeBtn = makeBtn('HOME', false, () => {
      overlay.remove();
      this.cleanup();
      const screen = document.getElementById('loading-screen');
      screen.style.display = 'flex';
      this.showHomeScreen();
    });
    this._addButtonSFX(homeBtn);
    btnRow.appendChild(homeBtn);

    content.appendChild(btnRow);
    document.getElementById('hud').appendChild(overlay);
  }

  _processClickTargeting() {
    const clicks = this.inputManager.consumeClicks();
    if (clicks.length === 0) return;

    const click = clicks[clicks.length - 1]; // Use most recent click
    const mouse = new THREE.Vector2(click.x, click.y);
    const camera = this.sceneManager.getCamera();

    this._raycaster.setFromCamera(mouse, camera);

    const characterMeshes = [];
    for (const [unitId, model] of this.characterRenderer.characters) {
      if (unitId === 0) continue; // Don't target self
      model.traverse((child) => {
        if (child.isMesh) characterMeshes.push(child);
      });
    }

    const intersects = this._raycaster.intersectObjects(characterMeshes, false);
    if (intersects.length > 0) {
      let obj = intersects[0].object;
      while (obj && !obj.name?.startsWith('character_')) {
        obj = obj.parent;
      }
      if (obj && obj.userData.unitId != null && obj.userData.unitId !== 0) {
        if (this.playerController) {
          this.playerController.currentTarget = obj.userData.unitId;
        }
        if (this.matchState) {
          this.matchState.setTarget(0, obj.userData.unitId);
        }
      }
    }
  }

  _createTargetRing() {
    const ringGeo = new THREE.RingGeometry(3.0, 3.5, 48);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff2222,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this._targetRing = new THREE.Mesh(ringGeo, ringMat);
    this._targetRing.name = 'targetIndicator';
    this._targetRing.position.y = 0.1;
    this._targetRing.renderOrder = 1;
    this._targetRing.visible = false;
    this.sceneManager.getScene().add(this._targetRing);
  }

  _updateTargetRing(match, time) {
    if (!this._targetRing || !match) return;

    const targetId = match.getTarget(0);
    if (targetId == null) {
      this._targetRing.visible = false;
      return;
    }

    const target = match.getUnit(targetId);
    if (!target || !target.isAlive) {
      this._targetRing.visible = false;
      return;
    }

    this._targetRing.visible = true;

    // Class-specific target ring color
    const classColors = {
      tyrant: 0x8B0000,
      wraith: 0x6B2FA0,
      infernal: 0xFF4500,
      harbinger: 0x228B22,
      revenant: 0xFFD700,
    };
    const classKey = target.classId?.toLowerCase();
    const ringColor = classColors[classKey] || 0xff2222;
    this._targetRing.material.color.setHex(ringColor);

    // Position under target (use interpolated position if available)
    let pos = target.position;
    if (this._prevPositions) {
      const prev = this._prevPositions.get(target.id);
      if (prev) {
        pos = {
          x: prev.x + (target.position.x - prev.x) * 0.5,
          y: 0,
          z: prev.z + (target.position.z - prev.z) * 0.5,
        };
      }
    }
    this._targetRing.position.x = pos.x;
    this._targetRing.position.z = pos.z;

    // Slow rotation
    this._targetRing.rotation.y = time * 1.5;

    // Gentle scale pulse
    const pulse = 1.0 + 0.08 * Math.sin(time * 3.0);
    this._targetRing.scale.set(pulse, 1, pulse);

    // Gentle opacity pulse
    this._targetRing.material.opacity = 0.45 + 0.15 * Math.sin(time * 2.5);
  }

  cleanup() {
    this._cleaningUp = true;
    if (this._matchEndTimeout) { clearTimeout(this._matchEndTimeout); this._matchEndTimeout = null; }
    // Clear eventBus listeners BEFORE stopping gameLoop — gameLoop.stop() emits MATCH_END
    if (this.matchState) { this.matchState.eventBus.clear(); }
    if (this.gameLoop) { this.gameLoop.stop(); this.gameLoop = null; }
    if (this.matchState) { this.matchState = null; }
    this._prevPositions = null;
    this._jumpStates.clear();
    this.playerController = null;
    if (this.characterRenderer) this.characterRenderer.clear();
    if (this.spellEffects) this.spellEffects.dispose();
    if (this._targetRing) {
      this.sceneManager.getScene().remove(this._targetRing);
      this._targetRing.geometry.dispose();
      this._targetRing.material.dispose();
      this._targetRing = null;
    }
    this.hud.cleanupNameplates();
    this.hud.hide();
    this._cleaningUp = false;
  }

  updateLoadingBar(percent) {
    const bar = document.getElementById('loading-bar');
    if (bar) bar.style.width = percent + '%';
  }
}

// Global error handlers
window.addEventListener('error', (e) => showError('Uncaught error', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => showError('Unhandled rejection', e.reason));

const game = new Game();
game.init().catch(err => showError('Init failed', err));
