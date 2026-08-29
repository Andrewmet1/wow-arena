/**
 * AudioManager — Web Audio API + file-based audio system.
 * Loads real MP3 SFX files and streams music via HTML5 Audio.
 * Falls back to procedural SoundGenerator if files fail to load.
 */

import { SoundGenerator } from './SoundGenerator.js';

let STORAGE_KEY_MUSIC = 'ebon_music_vol';
let STORAGE_KEY_SFX = 'ebon_sfx_vol';
let STORAGE_KEY_MUTED = 'ebon_muted';
const MAX_CONCURRENT_SFX = 12;

// All SFX keys and their volume multipliers
const SFX_CONFIG = {
  sword_hit:     { vol: 0.35 },
  sword_swing:   { vol: 0.3 },
  melee_hit:     { vol: 0.35 },
  spell_cast:    { vol: 0.25 },
  fire_impact:   { vol: 0.35 },
  shadow_impact: { vol: 0.35 },
  holy_impact:   { vol: 0.3 },
  frost_impact:  { vol: 0.35 },
  heal_cast:     { vol: 0.25 },
  stun_hit:      { vol: 0.35 },
  death:         { vol: 0.35 },
  dodge_roll:    { vol: 0.3 },
  jump_land:     { vol: 0.25 },
  shield_block:  { vol: 0.35 },
  ability_ready: { vol: 0.15 },
  match_start:   { vol: 0.15 },
  victory_sting: { vol: 0.3 },
  defeat_sting:  { vol: 0.3 },
  button_click:  { vol: 0.15 },
  button_hover:  { vol: 0.1 },
  beam_loop:     { vol: 0.2 },
  crowd_ambient: { vol: 0.1 },
  low_health:    { vol: 0.25 },
  cc_break:      { vol: 0.35 },
  charge_rush:   { vol: 0.3 },
  poison_splash: { vol: 0.3 },
  arcane_blast:  { vol: 0.3 },
  dark_curse:    { vol: 0.3 },
  holy_smite:    { vol: 0.3 },
  warrior_rage:  { vol: 0.3 },
};

const SFX_BASE_PATH = '/assets/audio/sfx/';
const MUSIC_BASE_PATH = '/assets/audio/music/';

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.generator = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.masterGain = null;
    this.currentMusic = null;
    this._activeSfxCount = 0;
    this._musicVolume = 0.5;
    this._sfxVolume = 0.7;
    this._muted = false;
    this._initialized = false;
    this._resumeHandler = null;
    this._pendingTrack = null;

    // File-based audio buffers (SFX)
    this._sfxBuffers = {};    // key -> AudioBuffer
    this._sfxLoaded = false;

    // HTML5 Audio elements (Music)
    this._musicElements = {};  // trackId -> HTMLAudioElement
    this._currentMusicEl = null;
    this._currentMusicId = null;
    this._currentTrackScale = 1.0; // Per-track volume multiplier (battle is quieter)
    this._fadeInActive = false; // True while HTML5 music is fading in — blocks _applyVolumes override

    // Active looping sources (beam, crowd, low_health)
    this._loopingSources = {}; // key -> { source, gain }
  }

  init() {
    if (this._initialized) return;

    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.generator = new SoundGenerator(this.ctx);

      // Master → speakers
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);

      // Music bus
      this.musicGain = this.ctx.createGain();
      this.musicGain.connect(this.masterGain);

      // SFX bus
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.connect(this.masterGain);

      // Restore saved volumes (but never start muted)
      this._loadSettings();
      this._muted = false;
      this._applyVolumes();

      this._initialized = true;

      // Preload SFX files
      this._preloadSFX();

      // Prepare music elements
      this._prepareMusicElements();

      // Handle AudioContext suspended state (browser autoplay policy)
      this._resumeHandler = () => {
        if (this.ctx && this.ctx.state === 'suspended') {
          this.ctx.resume().then(() => {
            if (this._pendingTrack) {
              const trackId = this._pendingTrack;
              this._pendingTrack = null;
              this.playMusic(trackId);
            }
          }).catch(() => {});
        }
      };
      document.addEventListener('click', this._resumeHandler);
      document.addEventListener('keydown', this._resumeHandler);
      document.addEventListener('touchstart', this._resumeHandler);
    } catch (e) {
      console.warn('[AudioManager] Web Audio API not available:', e);
    }
  }

  // ── SFX Preloading ──────────────────────────────────────────────────────

  async _preloadSFX() {
    const keys = Object.keys(SFX_CONFIG);
    let loaded = 0;

    // Load in parallel batches of 6
    for (let i = 0; i < keys.length; i += 6) {
      const batch = keys.slice(i, i + 6);
      await Promise.all(batch.map(async (key) => {
        try {
          const resp = await fetch(`${SFX_BASE_PATH}${key}.mp3`);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const arrayBuffer = await resp.arrayBuffer();
          this._sfxBuffers[key] = await this.ctx.decodeAudioData(arrayBuffer);
          loaded++;
        } catch (e) {
          console.warn(`[AudioManager] Failed to load SFX: ${key}`, e.message);
        }
      }));
    }

    this._sfxLoaded = loaded > 0;
    console.log(`[AudioManager] Loaded ${loaded}/${keys.length} SFX files`);
  }

  // ── Music Elements ──────────────────────────────────────────────────────

  _prepareMusicElements() {
    const tracks = {
      menu: 'menu_theme.mp3',
      battle: 'battle_theme.mp3',
    };

    for (const [id, file] of Object.entries(tracks)) {
      const el = new Audio(`${MUSIC_BASE_PATH}${file}`);
      el.loop = true;
      el.preload = 'auto';
      el.volume = 0;
      this._musicElements[id] = el;
    }
  }

  // ── Music ────────────────────────────────────────────────────────────────

  playMusic(trackId) {
    if (!this._initialized) return;

    // Don't restart same track
    if (this._currentMusicId === trackId) return;

    // If context is suspended, store as pending
    if (this.ctx.state === 'suspended') {
      this._pendingTrack = trackId;
      return;
    }

    const newEl = this._musicElements[trackId];
    if (!newEl) {
      // Fallback to procedural if no file
      this._playProceduralMusic(trackId);
      return;
    }

    // Fade out current music
    if (this._currentMusicEl) {
      const oldEl = this._currentMusicEl;
      const fadeOutStart = oldEl.volume;
      const fadeSteps = 20;
      const fadeInterval = 100; // 2s total
      let step = 0;
      const fadeOut = setInterval(() => {
        step++;
        oldEl.volume = Math.max(0, fadeOutStart * (1 - step / fadeSteps));
        if (step >= fadeSteps) {
          clearInterval(fadeOut);
          oldEl.pause();
          oldEl.currentTime = 0;
        }
      }, fadeInterval);
    }

    // Also stop any procedural music
    if (this.currentMusic) {
      try { this.currentMusic.stop(); } catch (e) {}
      this.currentMusic = null;
    }

    // Start new track with fade-in
    // Per-track volume scaling (battle music mastered louder than menu)
    this._currentTrackScale = trackId === 'battle' ? 0.35 : 1.0;
    const targetVol = this._musicVolume * this._currentTrackScale * (this._muted ? 0 : 1);
    newEl.volume = 0;
    newEl.currentTime = 0;
    newEl.play().catch(() => {
      // Autoplay blocked — store as pending
      this._pendingTrack = trackId;
      return;
    });

    // Fade in over 3s (longer crossfade for smoother transition)
    this._fadeInActive = true;
    let fadeStep = 0;
    const fadeSteps = 30;
    const fadeIn = setInterval(() => {
      fadeStep++;
      newEl.volume = Math.min(targetVol, targetVol * (fadeStep / fadeSteps));
      if (fadeStep >= fadeSteps) {
        clearInterval(fadeIn);
        this._fadeInActive = false;
      }
    }, 100);

    this._currentMusicEl = newEl;
    this._currentMusicId = trackId;
  }

  _playProceduralMusic(trackId) {
    // Fade out current procedural
    if (this.currentMusic) {
      const old = this.currentMusic;
      const oldNode = old.node;
      const fadeOut = this.ctx.currentTime;
      oldNode.gain.linearRampToValueAtTime(0, fadeOut + 2.0);
      setTimeout(() => { try { old.stop(); } catch(e) {} }, 2200);
      this.currentMusic = null;
    }

    let track;
    if (trackId === 'menu') {
      track = this.generator.createMenuTheme();
    } else if (trackId === 'battle') {
      track = this.generator.createBattleTheme();
    } else {
      return;
    }

    track._trackId = trackId;
    track.node.connect(this.musicGain);

    // Per-track volume scaling (battle is louder than menu in generated audio)
    this._currentTrackScale = trackId === 'battle' ? 0.35 : 1.0;
    const trackVol = trackId === 'battle' ? 0.1 : 0.3;

    const now = this.ctx.currentTime;
    track.node.gain.setValueAtTime(0, now);
    track.node.gain.linearRampToValueAtTime(trackVol, now + 2.0);
    track.start();

    this.currentMusic = track;
    this._currentMusicId = trackId;
    this._currentMusicEl = null;
  }

  stopMusic() {
    this._pendingTrack = null;
    this._currentMusicId = null;

    // Stop HTML5 music
    if (this._currentMusicEl) {
      this._currentMusicEl.pause();
      this._currentMusicEl.currentTime = 0;
      this._currentMusicEl.volume = 0;
      this._currentMusicEl = null;
    }

    // Stop procedural music
    if (this.currentMusic) {
      try { this.currentMusic.stop(); } catch(e) {}
      this.currentMusic = null;
    }
  }

  // ── SFX ──────────────────────────────────────────────────────────────────

  /**
   * Play a sound effect by ID.
   * @param {string} sfxId
   * @param {number} [volume=1] Relative volume multiplier
   */
  playSFX(sfxId, volume = 1) {
    if (!this._initialized || this._muted) return;
    if (this._activeSfxCount >= MAX_CONCURRENT_SFX) return;
    if (this.ctx.state !== 'running') return;

    const config = SFX_CONFIG[sfxId];
    if (!config) return;

    const buffer = this._sfxBuffers[sfxId];
    if (buffer) {
      this._playBufferSFX(buffer, config.vol * volume);
    } else {
      // Fallback to procedural
      this._playProceduralSFX(sfxId, volume);
    }
  }

  _playBufferSFX(buffer, vol) {
    this._activeSfxCount++;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    const gain = this.ctx.createGain();
    gain.gain.value = vol;
    source.connect(gain);
    gain.connect(this.sfxGain);

    source.onended = () => {
      this._activeSfxCount = Math.max(0, this._activeSfxCount - 1);
    };

    source.start();
  }

  _playProceduralSFX(sfxId, volume) {
    this._activeSfxCount++;
    const dest = this.sfxGain;
    const v = volume;

    switch (sfxId) {
      case 'sword_hit':
        this.generator.playSwordHit(dest, v * 0.3);
        break;
      case 'spell_cast':
        this.generator.playSpellCast(dest, v * 0.2);
        break;
      case 'fire_impact':
        this.generator.playFireImpact(dest, v * 0.3);
        break;
      case 'shadow_impact':
        this.generator.playShadowImpact(dest, v * 0.3);
        break;
      case 'holy_impact':
        this.generator.playHolyImpact(dest, v * 0.25);
        break;
      case 'heal_cast':
        this.generator.playHealCast(dest, v * 0.2);
        break;
      case 'stun_hit':
        this.generator.playStunHit(dest, v * 0.3);
        break;
      case 'death':
        this.generator.playDeath(dest, v * 0.3);
        break;
      case 'ability_ready':
        this.generator.playAbilityReady(dest, v * 0.12);
        break;
      case 'button_hover':
        this.generator.playButtonHover(dest, v * 0.08);
        break;
      case 'button_click':
        this.generator.playButtonClick(dest, v * 0.12);
        break;
      case 'match_start':
        this.generator.playMatchStart(dest, v * 0.3);
        break;
      case 'victory_sting':
        this.generator.playVictorySting(dest, v * 0.25);
        break;
      case 'defeat_sting':
        this.generator.playDefeatSting(dest, v * 0.25);
        break;
      case 'jump_land':
        this.generator.playJumpLand(dest, v * 0.2);
        break;
      case 'dodge_roll':
        this.generator.playDodgeRoll(dest, v * 0.25);
        break;
      case 'frost_impact':
        this.generator.playFrostImpact(dest, v * 0.3);
        break;
      case 'melee_hit':
        this.generator.playMeleeHit(dest, v * 0.3);
        break;
      case 'sword_swing':
        this.generator.playSwordSwing(dest, v * 0.25);
        break;
      case 'shield_block':
        this.generator.playShieldBlock(dest, v * 0.3);
        break;
      case 'cc_break':
        this.generator.playCCBreak(dest, v * 0.3);
        break;
      case 'charge_rush':
        this.generator.playChargeRush(dest, v * 0.3);
        break;
      case 'poison_splash':
        this.generator.playPoisonSplash(dest, v * 0.25);
        break;
      case 'arcane_blast':
        this.generator.playArcaneBlast(dest, v * 0.25);
        break;
      case 'dark_curse':
        this.generator.playDarkCurse(dest, v * 0.25);
        break;
      case 'holy_smite':
        this.generator.playHolySmite(dest, v * 0.3);
        break;
      case 'warrior_rage':
        this.generator.playWarriorRage(dest, v * 0.3);
        break;
      default:
        this._activeSfxCount--;
        return;
    }

    setTimeout(() => { this._activeSfxCount = Math.max(0, this._activeSfxCount - 1); }, 500);
  }

  // ── Looping SFX (beam, crowd ambient, low health) ────────────────────

  /**
   * Start a looping SFX. Returns immediately if already playing.
   * Crowd ambient uses realtime procedural generation (no loop point).
   */
  startLoopSFX(sfxId, volume = 1) {
    if (!this._initialized || this._muted) return;
    if (this.ctx.state !== 'running') return;
    if (this._loopingSources[sfxId]) return;

    // Crowd ambient: fully procedural — layered filtered noise, never loops
    if (sfxId === 'crowd_ambient') {
      this._startProceduralCrowd(volume);
      return;
    }

    const buffer = this._sfxBuffers[sfxId];
    if (!buffer) return;

    const config = SFX_CONFIG[sfxId];
    const targetVol = (config?.vol || 0.2) * volume;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const gain = this.ctx.createGain();
    gain.gain.value = targetVol;
    source.connect(gain);
    gain.connect(this.sfxGain);
    source.start();

    this._loopingSources[sfxId] = { source, gain };
  }

  /**
   * Procedural crowd ambient — continuous filtered noise, no loop point ever.
   * 3 bandpass-filtered noise layers at vocal frequency bands, each modulated
   * by slow LFOs for natural ebb and flow. Reverb for arena spaciousness.
   */
  _startProceduralCrowd(volume = 1) {
    const ctx = this.ctx;
    const masterGain = ctx.createGain();
    const targetVol = (SFX_CONFIG.crowd_ambient?.vol || 0.1) * volume;
    // Fade in over 2s
    masterGain.gain.setValueAtTime(0, ctx.currentTime);
    masterGain.gain.linearRampToValueAtTime(targetVol, ctx.currentTime + 2.0);
    masterGain.connect(this.sfxGain);

    const nodes = [];

    // 10s stereo noise buffer — looped internally by BufferSource (no MP3 gap)
    const noiseDur = 10;
    const noiseLen = ctx.sampleRate * noiseDur;
    const noiseBuf = ctx.createBuffer(2, noiseLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = noiseBuf.getChannelData(ch);
      for (let i = 0; i < noiseLen; i++) d[i] = Math.random() * 2 - 1;
    }

    // Layer 1: Low rumble (200-500Hz) — crowd body
    const noise1 = ctx.createBufferSource();
    noise1.buffer = noiseBuf; noise1.loop = true;
    const bp1 = ctx.createBiquadFilter();
    bp1.type = 'bandpass'; bp1.frequency.value = 350; bp1.Q.value = 0.8;
    const g1 = ctx.createGain(); g1.gain.value = 0.35;
    const lfo1 = ctx.createOscillator();
    lfo1.type = 'sine'; lfo1.frequency.value = 0.08;
    const lfoG1 = ctx.createGain(); lfoG1.gain.value = 0.1;
    lfo1.connect(lfoG1).connect(g1.gain);
    noise1.connect(bp1).connect(g1).connect(masterGain);
    noise1.start(); lfo1.start();
    nodes.push(noise1, lfo1);

    // Layer 2: Mid vocal (600-1200Hz) — murmur
    const noise2 = ctx.createBufferSource();
    noise2.buffer = noiseBuf; noise2.loop = true;
    noise2.playbackRate.value = 1.1;
    const bp2 = ctx.createBiquadFilter();
    bp2.type = 'bandpass'; bp2.frequency.value = 800; bp2.Q.value = 0.6;
    const g2 = ctx.createGain(); g2.gain.value = 0.2;
    const lfo2 = ctx.createOscillator();
    lfo2.type = 'sine'; lfo2.frequency.value = 0.12;
    const lfoG2 = ctx.createGain(); lfoG2.gain.value = 0.08;
    lfo2.connect(lfoG2).connect(g2.gain);
    noise2.connect(bp2).connect(g2).connect(masterGain);
    noise2.start(); lfo2.start();
    nodes.push(noise2, lfo2);

    // Layer 3: High sibilance (2-4kHz) — excitement
    const noise3 = ctx.createBufferSource();
    noise3.buffer = noiseBuf; noise3.loop = true;
    noise3.playbackRate.value = 0.9;
    const bp3 = ctx.createBiquadFilter();
    bp3.type = 'bandpass'; bp3.frequency.value = 2800; bp3.Q.value = 0.5;
    const g3 = ctx.createGain(); g3.gain.value = 0.08;
    const lfo3 = ctx.createOscillator();
    lfo3.type = 'sine'; lfo3.frequency.value = 0.17;
    const lfoG3 = ctx.createGain(); lfoG3.gain.value = 0.03;
    lfo3.connect(lfoG3).connect(g3.gain);
    noise3.connect(bp3).connect(g3).connect(masterGain);
    noise3.start(); lfo3.start();
    nodes.push(noise3, lfo3);

    // Reverb for arena spaciousness
    const reverbSend = ctx.createGain();
    reverbSend.gain.value = 0.25;
    masterGain.connect(reverbSend);
    const reverb = ctx.createConvolver();
    const iLen = ctx.sampleRate * 2;
    const impulse = ctx.createBuffer(2, iLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = impulse.getChannelData(ch);
      for (let i = 0; i < iLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / iLen, 2);
    }
    reverb.buffer = impulse;
    reverbSend.connect(reverb);
    reverb.connect(this.sfxGain);

    this._loopingSources['crowd_ambient'] = {
      source: null, gain: masterGain,
      _stop: () => { for (const n of nodes) try { n.stop(); } catch(e) {} }
    };
  }

  /**
   * Stop a looping SFX with optional fade-out.
   */
  stopLoopSFX(sfxId, fadeMs = 300) {
    const loop = this._loopingSources[sfxId];
    if (!loop) return;

    // Crossfade-scheduled loops (crowd, beam) use _stop callback
    if (loop._stop) loop._stop();

    if (fadeMs > 0 && this.ctx) {
      const now = this.ctx.currentTime;
      loop.gain.gain.linearRampToValueAtTime(0, now + fadeMs / 1000);
      if (loop.source) {
        setTimeout(() => {
          try { loop.source.stop(); } catch (e) {}
        }, fadeMs + 50);
      }
    } else {
      if (loop.source) {
        try { loop.source.stop(); } catch (e) {}
      }
    }
    delete this._loopingSources[sfxId];
  }

  /**
   * Stop all looping SFX.
   */
  stopAllLoops() {
    for (const key of Object.keys(this._loopingSources)) {
      this.stopLoopSFX(key, 0);
    }
  }

  // ── Volume Controls ──────────────────────────────────────────────────────

  setMusicVolume(v) {
    this._musicVolume = Math.max(0, Math.min(1, v));
    this._applyVolumes();
    this._saveSettings();
  }

  setSFXVolume(v) {
    this._sfxVolume = Math.max(0, Math.min(1, v));
    this._applyVolumes();
    this._saveSettings();
  }

  getMusicVolume() { return this._musicVolume; }
  getSFXVolume() { return this._sfxVolume; }
  isMuted() { return this._muted; }

  mute() {
    this._muted = true;
    this._applyVolumes();
    this._saveSettings();
  }

  unmute() {
    this._muted = false;
    this._applyVolumes();
    this._saveSettings();
  }

  toggleMute() {
    if (this._muted) this.unmute();
    else this.mute();
  }

  setUserKey(sub) {
    if (!sub) return;
    const suffix = `_${sub}`;
    const newMusic = `ebon_music_vol${suffix}`;
    if (newMusic === STORAGE_KEY_MUSIC) return;
    STORAGE_KEY_MUSIC = newMusic;
    STORAGE_KEY_SFX = `ebon_sfx_vol${suffix}`;
    STORAGE_KEY_MUTED = `ebon_muted${suffix}`;
    try {
      if (localStorage.getItem(STORAGE_KEY_MUSIC) !== null) {
        this._loadSettings();
        this._applyVolumes();
      } else {
        this._saveSettings();
      }
    } catch (e) {}
  }

  _applyVolumes() {
    if (!this._initialized) return;
    const mute = this._muted ? 0 : 1;
    if (this.musicGain) this.musicGain.gain.value = this._musicVolume * mute;
    if (this.sfxGain) this.sfxGain.gain.value = this._sfxVolume * mute;

    // Also update HTML5 music element volume (with per-track scaling)
    // Skip if a fade-in is active — the fade interval controls volume during transitions
    if (this._currentMusicEl && !this._fadeInActive) {
      this._currentMusicEl.volume = this._musicVolume * (this._currentTrackScale || 1.0) * mute;
    }
  }

  _saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY_MUSIC, String(this._musicVolume));
      localStorage.setItem(STORAGE_KEY_SFX, String(this._sfxVolume));
      localStorage.setItem(STORAGE_KEY_MUTED, this._muted ? '1' : '0');
    } catch(e) {}
  }

  _loadSettings() {
    try {
      const m = localStorage.getItem(STORAGE_KEY_MUSIC);
      if (m !== null) this._musicVolume = parseFloat(m) || 0.5;
      const s = localStorage.getItem(STORAGE_KEY_SFX);
      if (s !== null) this._sfxVolume = parseFloat(s) || 0.7;
      const mut = localStorage.getItem(STORAGE_KEY_MUTED);
      if (mut !== null) this._muted = mut === '1';
    } catch(e) {}
  }

  destroy() {
    this.stopMusic();
    this.stopAllLoops();
    if (this._resumeHandler) {
      document.removeEventListener('click', this._resumeHandler);
      document.removeEventListener('keydown', this._resumeHandler);
      document.removeEventListener('touchstart', this._resumeHandler);
    }
    if (this.ctx) {
      this.ctx.close().catch(() => {});
    }
    this._initialized = false;
  }
}
