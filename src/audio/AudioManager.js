/**
 * AudioManager — Web Audio API-based audio system with music and SFX buses.
 * Uses procedural generation via SoundGenerator (no external audio files).
 */

import { SoundGenerator } from './SoundGenerator.js';

const STORAGE_KEY_MUSIC = 'ebon_music_vol';
const STORAGE_KEY_SFX = 'ebon_sfx_vol';
const STORAGE_KEY_MUTED = 'ebon_muted';
const MAX_CONCURRENT_SFX = 8;

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
    this._pendingTrack = null; // Track waiting for context resume
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

      // Restore saved volumes (but never start muted — user must explicitly mute)
      this._loadSettings();
      this._muted = false;
      this._applyVolumes();

      this._initialized = true;

      // Handle AudioContext suspended state (browser autoplay policy)
      // When user interacts, resume the context and start any pending music
      this._resumeHandler = () => {
        if (this.ctx && this.ctx.state === 'suspended') {
          this.ctx.resume().then(() => {
            // Context is now running — start pending music if any
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

  // ── Music ────────────────────────────────────────────────────────────────

  /**
   * Play a music track. Crossfades from current track if one is playing.
   * @param {'menu'|'battle'} trackId
   */
  playMusic(trackId) {
    if (!this._initialized) return;

    // Don't restart same track
    if (this.currentMusic && this.currentMusic._trackId === trackId) return;

    // If context is suspended, store as pending and wait for user gesture
    if (this.ctx.state === 'suspended') {
      this._pendingTrack = trackId;
      return;
    }

    // Fade out current
    if (this.currentMusic) {
      const old = this.currentMusic;
      const oldNode = old.node;
      const fadeOut = this.ctx.currentTime;
      oldNode.gain.linearRampToValueAtTime(0, fadeOut + 2.0);
      setTimeout(() => { try { old.stop(); } catch(e) {} }, 2200);
      this.currentMusic = null;
    }

    // Create new track
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

    // Fade in
    const now = this.ctx.currentTime;
    track.node.gain.setValueAtTime(0, now);
    track.node.gain.linearRampToValueAtTime(0.3, now + 2.0);
    track.start();

    this.currentMusic = track;
  }

  stopMusic() {
    this._pendingTrack = null;
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
    // Skip SFX if context isn't running yet (SFX are fire-and-forget)
    if (this.ctx.state !== 'running') return;

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
      default:
        this._activeSfxCount--;
        return;
    }

    // Decrement after typical SFX duration
    setTimeout(() => { this._activeSfxCount = Math.max(0, this._activeSfxCount - 1); }, 500);
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

  _applyVolumes() {
    if (!this._initialized) return;
    const mute = this._muted ? 0 : 1;
    if (this.musicGain) this.musicGain.gain.value = this._musicVolume * mute;
    if (this.sfxGain) this.sfxGain.gain.value = this._sfxVolume * mute;
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
