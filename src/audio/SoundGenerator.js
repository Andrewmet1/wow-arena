/**
 * SoundGenerator — Procedural dark fantasy audio using Web Audio API.
 * All sounds are synthesized at runtime with layered oscillators,
 * filtered noise, and convolution reverb for spatial depth.
 */

export class SoundGenerator {
  constructor(audioContext) {
    this.ctx = audioContext;
    this._initReverb();
    this._initNoiseBuffer();
  }

  // ── Shared Infrastructure ───────────────────────────────────────────────

  /** Create a 2-second convolution reverb impulse response. */
  _initReverb() {
    const length = this.ctx.sampleRate * 2;
    const impulse = this.ctx.createBuffer(2, length, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
      }
    }
    this._reverb = this.ctx.createConvolver();
    this._reverb.buffer = impulse;
  }

  /** Pre-create a reusable 4-second white noise buffer. */
  _initNoiseBuffer() {
    const length = this.ctx.sampleRate * 4;
    this._noiseBuffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = this._noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  }

  /**
   * Create a noise buffer of a given duration in seconds.
   * For short SFX bursts where the reusable buffer is too long.
   */
  _createNoiseBuffer(durationSeconds) {
    const sampleRate = this.ctx.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * durationSeconds));
    const buffer = this.ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  /**
   * Split a source signal into dry and wet (reverb) paths.
   * @param {AudioNode} source - The source node to route.
   * @param {AudioNode} outputNode - The final output destination.
   * @param {number} dryAmount - Gain for the direct signal (0-1).
   * @param {number} wetAmount - Gain for the reverb signal (0-1).
   * @returns {{ dry: GainNode, wet: GainNode }} The gain nodes for further control.
   */
  _sendToReverb(source, outputNode, dryAmount, wetAmount) {
    const ctx = this.ctx;

    const dryGain = ctx.createGain();
    dryGain.gain.value = dryAmount;
    source.connect(dryGain);
    dryGain.connect(outputNode);

    const wetGain = ctx.createGain();
    wetGain.gain.value = wetAmount;
    source.connect(wetGain);
    // Create a fresh convolver each time to avoid shared-state issues
    const reverb = ctx.createConvolver();
    reverb.buffer = this._reverb.buffer;
    wetGain.connect(reverb);
    reverb.connect(outputNode);

    return { dry: dryGain, wet: wetGain };
  }

  /**
   * Create a detuned sawtooth pair for a single note (rich pad sound).
   * @param {number} freq - Base frequency in Hz.
   * @param {number} detuneCents - Detune amount in cents (applied ± to each osc).
   * @returns {{ osc1: OscillatorNode, osc2: OscillatorNode, output: GainNode }}
   */
  _createDetunedPair(freq, detuneCents = 5) {
    const ctx = this.ctx;
    const mix = ctx.createGain();
    mix.gain.value = 1;

    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = freq;
    osc1.detune.value = -detuneCents;
    osc1.connect(mix);

    const osc2 = ctx.createOscillator();
    osc2.type = 'sawtooth';
    osc2.frequency.value = freq;
    osc2.detune.value = detuneCents;
    osc2.connect(mix);

    return { osc1, osc2, output: mix };
  }

  // ── Music Generators ────────────────────────────────────────────────────

  /**
   * Dark ambient menu theme with pad chords, bass drone, atmosphere, and bells.
   * Returns { node, start(), stop() } controller.
   */
  createMenuTheme() {
    const ctx = this.ctx;
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.3;

    const oscillators = [];
    const intervals = [];
    const timeouts = [];
    let running = false;

    // ── Chord definitions (Am → Dm → Em → Am) ──
    const chords = [
      [110, 131, 165],   // Am: A2, C3, E3
      [73, 175, 220],    // Dm: D2, F3, A3
      [82, 196, 247],    // Em: E2, G3, B3
      [110, 131, 165],   // Am: A2, C3, E3
    ];

    // ── Pad layer ──
    // We create pad oscillator pairs for each voice and crossfade between chords.
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 400;
    padFilter.Q.value = 2;

    const padPreGain = ctx.createGain();
    padPreGain.gain.value = 0.12;
    padFilter.connect(padPreGain);

    // 3 voices, each a detuned pair
    const padVoices = [];
    for (let v = 0; v < 3; v++) {
      const pair = this._createDetunedPair(chords[0][v], 5);
      pair.output.connect(padFilter);
      padVoices.push(pair);
      oscillators.push(pair.osc1, pair.osc2);
    }

    // ── Bass drone ──
    const bassFilter = ctx.createBiquadFilter();
    bassFilter.type = 'lowpass';
    bassFilter.frequency.value = 200;

    const bassSine1 = ctx.createOscillator();
    bassSine1.type = 'sine';
    bassSine1.frequency.value = 55; // A1
    const bassSine1Gain = ctx.createGain();
    bassSine1Gain.gain.value = 0.15;
    bassSine1.connect(bassSine1Gain).connect(bassFilter);

    const bassSine2 = ctx.createOscillator();
    bassSine2.type = 'sine';
    bassSine2.frequency.value = 110; // A2
    const bassSine2Gain = ctx.createGain();
    bassSine2Gain.gain.value = 0.045; // 0.15 * 0.3
    bassSine2.connect(bassSine2Gain).connect(bassFilter);

    const bassPreGain = ctx.createGain();
    bassPreGain.gain.value = 1;
    bassFilter.connect(bassPreGain);

    oscillators.push(bassSine1, bassSine2);

    // ── Atmosphere: pink-ish noise through bandpass with LFO ──
    const atmoNoise = ctx.createBufferSource();
    atmoNoise.buffer = this._noiseBuffer;
    atmoNoise.loop = true;

    const atmoFilter = ctx.createBiquadFilter();
    atmoFilter.type = 'bandpass';
    atmoFilter.frequency.value = 800;
    atmoFilter.Q.value = 0.5;

    const atmoGain = ctx.createGain();
    atmoGain.gain.value = 0.03;

    const atmoLfo = ctx.createOscillator();
    atmoLfo.type = 'sine';
    atmoLfo.frequency.value = 0.05;
    const atmoLfoGain = ctx.createGain();
    atmoLfoGain.gain.value = 400; // sweep ±400Hz around 800Hz
    atmoLfo.connect(atmoLfoGain).connect(atmoFilter.frequency);

    atmoNoise.connect(atmoFilter).connect(atmoGain);

    oscillators.push(atmoLfo);
    // atmoNoise is a BufferSource, tracked separately
    const bufferSources = [atmoNoise];

    // ── Route everything through reverb ──
    // Pad: 50% dry, 50% wet
    this._sendToReverb(padPreGain, masterGain, 0.5, 0.5);
    // Bass: 80% dry, 20% wet
    this._sendToReverb(bassPreGain, masterGain, 0.8, 0.2);
    // Atmosphere: 20% dry, 80% wet
    this._sendToReverb(atmoGain, masterGain, 0.2, 0.8);

    // ── Chord progression logic ──
    let chordIndex = 0;

    const advanceChord = () => {
      if (!running) return;
      const nextIndex = (chordIndex + 1) % chords.length;
      const nextChord = chords[nextIndex];
      const now = ctx.currentTime;

      // Crossfade pad voices to new chord frequencies over 2 seconds
      for (let v = 0; v < 3; v++) {
        padVoices[v].osc1.frequency.exponentialRampToValueAtTime(nextChord[v], now + 2);
        padVoices[v].osc2.frequency.exponentialRampToValueAtTime(nextChord[v], now + 2);
      }

      chordIndex = nextIndex;
    };

    // ── Bell / chime layer ──
    const bellNotes = [440, 523, 587, 659, 784]; // A minor pentatonic: A4, C5, D5, E5, G5

    const playBell = () => {
      if (!running) return;
      const now = ctx.currentTime;
      const freq = bellNotes[Math.floor(Math.random() * bellNotes.length)];

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.04, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 2.0);

      osc.connect(gain);
      this._sendToReverb(gain, masterGain, 0.1, 0.9);

      osc.start(now);
      osc.stop(now + 2.1);

      // Schedule next bell
      const nextDelay = 4000 + Math.random() * 2000; // 4-6 seconds
      const tid = setTimeout(playBell, nextDelay);
      timeouts.push(tid);
    };

    return {
      node: masterGain,
      start: () => {
        running = true;

        // Start all oscillators
        oscillators.forEach(o => o.start());
        bufferSources.forEach(s => s.start());

        // Pad gain envelope: fade in over 2 seconds
        const now = ctx.currentTime;
        padPreGain.gain.setValueAtTime(0.001, now);
        padPreGain.gain.linearRampToValueAtTime(0.12, now + 2);

        // Start chord progression: advance every 8 seconds
        const chordInt = setInterval(advanceChord, 8000);
        intervals.push(chordInt);

        // Start bell tones after initial delay
        const bellTid = setTimeout(playBell, 3000 + Math.random() * 3000);
        timeouts.push(bellTid);
      },
      stop: () => {
        running = false;
        intervals.forEach(id => clearInterval(id));
        timeouts.forEach(id => clearTimeout(id));
        intervals.length = 0;
        timeouts.length = 0;
        oscillators.forEach(o => { try { o.stop(); } catch (e) {} });
        bufferSources.forEach(s => { try { s.stop(); } catch (e) {} });
        masterGain.disconnect();
      }
    };
  }

  /**
   * Tense battle theme with rhythmic percussion, bass, and dark pads.
   * 120 BPM, 16th-note resolution (125ms per tick).
   * Returns { node, start(), stop() } controller.
   */
  createBattleTheme() {
    const ctx = this.ctx;
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.25;

    const oscillators = [];
    const bufferSources = [];
    const intervals = [];
    let running = false;

    // ── Bass line: sawtooth through heavy lowpass ──
    const bassOsc = ctx.createOscillator();
    bassOsc.type = 'sawtooth';
    bassOsc.frequency.value = 55; // A1
    const bassFilter = ctx.createBiquadFilter();
    bassFilter.type = 'lowpass';
    bassFilter.frequency.value = 120;
    bassFilter.Q.value = 4;
    const bassGain = ctx.createGain();
    bassGain.gain.value = 0.18;
    bassOsc.connect(bassFilter).connect(bassGain);
    oscillators.push(bassOsc);

    // Bass progression: A1(55) → F1(44) → G1(49) → A1(55), each 2 bars = 4s
    const bassNotes = [55, 44, 49, 55];
    let bassNoteIndex = 0;

    // ── Dark pad: Am chord (A3, C4, E4) detuned through bandpass ──
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'bandpass';
    padFilter.frequency.value = 600;
    padFilter.Q.value = 1;

    // LFO sweeping pad filter cutoff 400-800Hz
    const padLfo = ctx.createOscillator();
    padLfo.type = 'sine';
    padLfo.frequency.value = 0.15;
    const padLfoGain = ctx.createGain();
    padLfoGain.gain.value = 200; // ±200 around 600
    padLfo.connect(padLfoGain).connect(padFilter.frequency);
    oscillators.push(padLfo);

    const padGain = ctx.createGain();
    padGain.gain.value = 0.06;

    const padFreqs = [220, 262, 330]; // A3, C4, E4
    const padPairs = [];
    for (let i = 0; i < padFreqs.length; i++) {
      const pair = this._createDetunedPair(padFreqs[i], 5);
      pair.output.connect(padFilter);
      padPairs.push(pair);
      oscillators.push(pair.osc1, pair.osc2);
    }
    padFilter.connect(padGain);

    // Route bass: 90% dry, 10% wet
    this._sendToReverb(bassGain, masterGain, 0.9, 0.1);
    // Route pad: 60% dry, 40% wet (moderate reverb)
    this._sendToReverb(padGain, masterGain, 0.6, 0.4);

    // ── Percussion ──
    // 120 BPM = 500ms per beat. 16th note = 125ms.
    // Pattern repeats every 2 bars = 16 beats = 32 sixteenths = 4000ms.
    let tickCount = 0;
    let barCount = 0;

    const playKick = () => {
      const t = ctx.currentTime;
      // Noise burst transient (5ms)
      const clickNoise = ctx.createBufferSource();
      clickNoise.buffer = this._createNoiseBuffer(0.005);
      const clickGain = ctx.createGain();
      clickGain.gain.setValueAtTime(0.15, t);
      clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.005);
      clickNoise.connect(clickGain).connect(masterGain);
      clickNoise.start(t);
      clickNoise.stop(t + 0.01);

      // Sine sweep 150→40Hz (80ms)
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.08);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      osc.connect(gain).connect(masterGain);
      osc.start(t);
      osc.stop(t + 0.15);
    };

    const playSnare = () => {
      const t = ctx.currentTime;
      // Noise burst (40ms) through bandpass 1500Hz
      const noise = ctx.createBufferSource();
      noise.buffer = this._createNoiseBuffer(0.04);
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1500;
      filter.Q.value = 1;
      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(0.12, t);
      nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      noise.connect(filter).connect(nGain).connect(masterGain);
      noise.start(t);
      noise.stop(t + 0.06);

      // Sine body 200Hz (20ms)
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 200;
      const oGain = ctx.createGain();
      oGain.gain.setValueAtTime(0.1, t);
      oGain.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
      osc.connect(oGain).connect(masterGain);
      osc.start(t);
      osc.stop(t + 0.05);
    };

    const playHiHat = () => {
      const t = ctx.currentTime;
      const noise = ctx.createBufferSource();
      noise.buffer = this._createNoiseBuffer(0.003);
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 8000;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.02, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.003);
      noise.connect(filter).connect(gain).connect(masterGain);
      noise.start(t);
      noise.stop(t + 0.01);
    };

    const playTomFill = () => {
      const t = ctx.currentTime;
      const tomFreqs = [120, 80, 60];
      tomFreqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const gain = ctx.createGain();
        const start = t + i * 0.15;
        gain.gain.setValueAtTime(0.15, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
        osc.connect(gain).connect(masterGain);
        osc.start(start);
        osc.stop(start + 0.25);
      });
    };

    const onTick = () => {
      if (!running) return;

      // tickCount is 0-based, 32 ticks per 2-bar loop
      const tickInLoop = tickCount % 32;

      // Hi-hat every 2 ticks (every 250ms = 8th note equivalent at 16th resolution)
      if (tickInLoop % 2 === 0) {
        playHiHat();
      }

      // Kick on beats 1, 3, 5, 7 → ticks 0, 4, 8, 12, 16, 20, 24, 28
      if (tickInLoop % 4 === 0) {
        playKick();
      }

      // Snare on beats 2, 4, 6, 8 → ticks 2, 6, 10, 14, 18, 22, 26, 30
      if (tickInLoop % 4 === 2) {
        playSnare();
      }

      // Tom fill every 4 bars (every 64 ticks, at tick 60)
      if (tickCount > 0 && tickCount % 64 === 60) {
        playTomFill();
      }

      // Advance bass note every 2 bars (32 ticks)
      if (tickCount > 0 && tickCount % 32 === 0) {
        bassNoteIndex = (bassNoteIndex + 1) % bassNotes.length;
        const now = ctx.currentTime;
        bassOsc.frequency.exponentialRampToValueAtTime(bassNotes[bassNoteIndex], now + 0.1);
      }

      tickCount++;
    };

    return {
      node: masterGain,
      start: () => {
        running = true;
        tickCount = 0;
        bassNoteIndex = 0;
        oscillators.forEach(o => o.start());
        bufferSources.forEach(s => s.start());

        // 16th note interval: 125ms at 120 BPM
        const percInt = setInterval(onTick, 125);
        intervals.push(percInt);
      },
      stop: () => {
        running = false;
        intervals.forEach(id => clearInterval(id));
        intervals.length = 0;
        oscillators.forEach(o => { try { o.stop(); } catch (e) {} });
        bufferSources.forEach(s => { try { s.stop(); } catch (e) {} });
        masterGain.disconnect();
      }
    };
  }

  // ── SFX Generators ──────────────────────────────────────────────────────

  /** Sword hit: metallic clang + low thump + noise burst */
  playSwordHit(destination, volume = 0.3) {
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Metallic clang: sine 2000Hz, fast attack, 100ms decay
    const clang = ctx.createOscillator();
    clang.type = 'sine';
    clang.frequency.value = 2000;
    const clangGain = ctx.createGain();
    clangGain.gain.setValueAtTime(volume, t);
    clangGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    clang.connect(clangGain);
    this._sendToReverb(clangGain, destination, 0.6, 0.4);
    clang.start(t);
    clang.stop(t + 0.15);

    // Low thump: sine 80Hz, 50ms
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.value = 80;
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(volume * 0.8, t);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    thump.connect(thumpGain).connect(destination);
    thump.start(t);
    thump.stop(t + 0.08);

    // Noise burst: white noise through highpass 1500Hz, 30ms
    const noise = ctx.createBufferSource();
    noise.buffer = this._createNoiseBuffer(0.03);
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 1500;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(volume * 0.5, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    noise.connect(noiseFilter).connect(noiseGain).connect(destination);
    noise.start(t);
    noise.stop(t + 0.05);
  }

  /** Spell cast: rising sweep + sparkle + sub rumble */
  playSpellCast(destination, volume = 0.2) {
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Rising sweep: sine 200→1200Hz over 300ms
    const sweep = ctx.createOscillator();
    sweep.type = 'sine';
    sweep.frequency.setValueAtTime(200, t);
    sweep.frequency.exponentialRampToValueAtTime(1200, t + 0.3);
    const sweepGain = ctx.createGain();
    sweepGain.gain.setValueAtTime(volume, t);
    sweepGain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    sweep.connect(sweepGain);
    this._sendToReverb(sweepGain, destination, 0.5, 0.5);
    sweep.start(t);
    sweep.stop(t + 0.4);

    // Sparkle: noise through bandpass 4000Hz, Q=10, 100ms
    const sparkle = ctx.createBufferSource();
    sparkle.buffer = this._createNoiseBuffer(0.1);
    const sparkleFilter = ctx.createBiquadFilter();
    sparkleFilter.type = 'bandpass';
    sparkleFilter.frequency.value = 4000;
    sparkleFilter.Q.value = 10;
    const sparkleGain = ctx.createGain();
    sparkleGain.gain.setValueAtTime(volume * 0.3, t);
    sparkleGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    sparkle.connect(sparkleFilter).connect(sparkleGain).connect(destination);
    sparkle.start(t);
    sparkle.stop(t + 0.15);

    // Sub rumble: sine 60Hz, 200ms
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 60;
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(volume * 0.4, t);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    sub.connect(subGain).connect(destination);
    sub.start(t);
    sub.stop(t + 0.25);
  }

  /** Fire impact: snap transient + crackle + whoosh + low boom */
  playFireImpact(destination, volume = 0.3) {
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Snap: very short (2ms) full-spectrum noise burst for initial transient
    const snap = ctx.createBufferSource();
    snap.buffer = this._createNoiseBuffer(0.002);
    const snapGain = ctx.createGain();
    snapGain.gain.setValueAtTime(volume, t);
    snapGain.gain.exponentialRampToValueAtTime(0.001, t + 0.002);
    snap.connect(snapGain).connect(destination);
    snap.start(t);
    snap.stop(t + 0.005);

    // Crackle: noise through highpass 4000Hz, 80ms
    const crackle = ctx.createBufferSource();
    crackle.buffer = this._createNoiseBuffer(0.08);
    const crackleFilter = ctx.createBiquadFilter();
    crackleFilter.type = 'highpass';
    crackleFilter.frequency.value = 4000;
    const crackleGain = ctx.createGain();
    crackleGain.gain.setValueAtTime(volume * 0.5, t);
    crackleGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    crackle.connect(crackleFilter).connect(crackleGain).connect(destination);
    crackle.start(t);
    crackle.stop(t + 0.1);

    // Whoosh: noise through bandpass sweep 300→2000Hz over 200ms
    const whoosh = ctx.createBufferSource();
    whoosh.buffer = this._createNoiseBuffer(0.2);
    const whooshFilter = ctx.createBiquadFilter();
    whooshFilter.type = 'bandpass';
    whooshFilter.frequency.setValueAtTime(300, t);
    whooshFilter.frequency.exponentialRampToValueAtTime(2000, t + 0.2);
    whooshFilter.Q.value = 1;
    const whooshGain = ctx.createGain();
    whooshGain.gain.setValueAtTime(volume * 0.6, t);
    whooshGain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    whoosh.connect(whooshFilter).connect(whooshGain);
    this._sendToReverb(whooshGain, destination, 0.7, 0.3);
    whoosh.start(t);
    whoosh.stop(t + 0.25);

    // Low boom: sine 60Hz, 100ms
    const boom = ctx.createOscillator();
    boom.type = 'sine';
    boom.frequency.value = 60;
    const boomGain = ctx.createGain();
    boomGain.gain.setValueAtTime(volume * 0.8, t);
    boomGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    boom.connect(boomGain).connect(destination);
    boom.start(t);
    boom.stop(t + 0.15);
  }

  /** Shadow impact: deep pulse + dark whisper + sub rumble */
  playShadowImpact(destination, volume = 0.3) {
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Deep pulse: sine 30Hz, 200ms, slow attack (50ms)
    const pulse = ctx.createOscillator();
    pulse.type = 'sine';
    pulse.frequency.value = 30;
    const pulseGain = ctx.createGain();
    pulseGain.gain.setValueAtTime(0.001, t);
    pulseGain.gain.linearRampToValueAtTime(volume, t + 0.05);
    pulseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    pulse.connect(pulseGain);
    this._sendToReverb(pulseGain, destination, 0.4, 0.6);
    pulse.start(t);
    pulse.stop(t + 0.25);

    // Dark whisper: noise through narrow bandpass 1500Hz Q=15, 150ms
    const whisper = ctx.createBufferSource();
    whisper.buffer = this._createNoiseBuffer(0.15);
    const whisperFilter = ctx.createBiquadFilter();
    whisperFilter.type = 'bandpass';
    whisperFilter.frequency.value = 1500;
    whisperFilter.Q.value = 15;
    const whisperGain = ctx.createGain();
    whisperGain.gain.setValueAtTime(volume * 0.4, t);
    whisperGain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    whisper.connect(whisperFilter).connect(whisperGain);
    this._sendToReverb(whisperGain, destination, 0.4, 0.6);
    whisper.start(t);
    whisper.stop(t + 0.2);

    // Sub rumble: triangle 25Hz, 300ms
    const rumble = ctx.createOscillator();
    rumble.type = 'triangle';
    rumble.frequency.value = 25;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.setValueAtTime(volume * 0.6, t);
    rumbleGain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    rumble.connect(rumbleGain);
    this._sendToReverb(rumbleGain, destination, 0.4, 0.6);
    rumble.start(t);
    rumble.stop(t + 0.35);
  }

  /** Holy impact: bell tone + choir shimmer + bright sparkle */
  playHolyImpact(destination, volume = 0.25) {
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Bell tone: sine 880Hz + sine 1320Hz (fifth), 300ms decay
    const bell1 = ctx.createOscillator();
    bell1.type = 'sine';
    bell1.frequency.value = 880;
    const bell1Gain = ctx.createGain();
    bell1Gain.gain.setValueAtTime(volume, t);
    bell1Gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    bell1.connect(bell1Gain);

    const bell2 = ctx.createOscillator();
    bell2.type = 'sine';
    bell2.frequency.value = 1320;
    const bell2Gain = ctx.createGain();
    bell2Gain.gain.setValueAtTime(volume * 0.6, t);
    bell2Gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    bell2.connect(bell2Gain);

    const bellMix = ctx.createGain();
    bellMix.gain.value = 1;
    bell1Gain.connect(bellMix);
    bell2Gain.connect(bellMix);
    this._sendToReverb(bellMix, destination, 0.5, 0.5);

    bell1.start(t);
    bell2.start(t);
    bell1.stop(t + 0.35);
    bell2.stop(t + 0.35);

    // Choir shimmer: 3 sine oscillators at 800, 1000, 1200Hz with vibrato
    const choirFreqs = [800, 1000, 1200];
    choirFreqs.forEach(freq => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;

      // Vibrato: 4Hz LFO ±10Hz
      const vib = ctx.createOscillator();
      vib.type = 'sine';
      vib.frequency.value = 4;
      const vibGain = ctx.createGain();
      vibGain.gain.value = 10;
      vib.connect(vibGain).connect(osc.frequency);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(volume * 0.15, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.connect(gain).connect(destination);

      osc.start(t);
      vib.start(t);
      osc.stop(t + 0.25);
      vib.stop(t + 0.25);
    });

    // Bright sparkle: noise through highpass 6000Hz, 50ms
    const sparkle = ctx.createBufferSource();
    sparkle.buffer = this._createNoiseBuffer(0.05);
    const sparkleFilter = ctx.createBiquadFilter();
    sparkleFilter.type = 'highpass';
    sparkleFilter.frequency.value = 6000;
    const sparkleGain = ctx.createGain();
    sparkleGain.gain.setValueAtTime(volume * 0.3, t);
    sparkleGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    sparkle.connect(sparkleFilter).connect(sparkleGain).connect(destination);
    sparkle.start(t);
    sparkle.stop(t + 0.08);
  }

  /** Heal cast: ascending arpeggio + warm pad + shimmer */
  playHealCast(destination, volume = 0.2) {
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Ascending arpeggio: 4 sine tones at 60ms intervals, each 200ms decay
    const arpNotes = [440, 523, 659, 880];
    arpNotes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      const start = t + i * 0.06;
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(volume, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
      osc.connect(gain);
      this._sendToReverb(gain, destination, 0.4, 0.6);
      osc.start(start);
      osc.stop(start + 0.25);
    });

    // Warm pad: triangle 220Hz, 400ms, through lowpass 600Hz
    const pad = ctx.createOscillator();
    pad.type = 'triangle';
    pad.frequency.value = 220;
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 600;
    const padGain = ctx.createGain();
    padGain.gain.setValueAtTime(volume * 0.4, t);
    padGain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    pad.connect(padFilter).connect(padGain);
    this._sendToReverb(padGain, destination, 0.4, 0.6);
    pad.start(t);
    pad.stop(t + 0.45);

    // Shimmer: noise through highpass 5000Hz, 100ms, very quiet
    const shimmer = ctx.createBufferSource();
    shimmer.buffer = this._createNoiseBuffer(0.1);
    const shimmerFilter = ctx.createBiquadFilter();
    shimmerFilter.type = 'highpass';
    shimmerFilter.frequency.value = 5000;
    const shimmerGain = ctx.createGain();
    shimmerGain.gain.setValueAtTime(volume * 0.15, t);
    shimmerGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    shimmer.connect(shimmerFilter).connect(shimmerGain).connect(destination);
    shimmer.start(t);
    shimmer.stop(t + 0.15);
  }

  /** Stun hit: sharp click + ringing + low thump */
  playStunHit(destination, volume = 0.3) {
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Sharp click: 1ms noise burst at full volume
    const click = ctx.createBufferSource();
    click.buffer = this._createNoiseBuffer(0.001);
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(volume, t);
    clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.002);
    click.connect(clickGain).connect(destination);
    click.start(t);
    click.stop(t + 0.005);

    // Ringing: sine 500Hz with slow decay (400ms)
    const ring = ctx.createOscillator();
    ring.type = 'sine';
    ring.frequency.value = 500;
    const ringGain = ctx.createGain();
    ringGain.gain.setValueAtTime(volume * 0.5, t);
    ringGain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    ring.connect(ringGain);
    this._sendToReverb(ringGain, destination, 0.6, 0.4);
    ring.start(t);
    ring.stop(t + 0.45);

    // Low thump: sine 100Hz, 60ms
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.value = 100;
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(volume * 0.6, t);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    thump.connect(thumpGain).connect(destination);
    thump.start(t);
    thump.stop(t + 0.1);
  }

  /** Death: descending tone + dark rumble + final thud */
  playDeath(destination, volume = 0.3) {
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Descending tone: sine sweep 400→50Hz over 1.2s
    const sweep = ctx.createOscillator();
    sweep.type = 'sine';
    sweep.frequency.setValueAtTime(400, t);
    sweep.frequency.exponentialRampToValueAtTime(50, t + 1.2);
    const sweepGain = ctx.createGain();
    sweepGain.gain.setValueAtTime(volume, t);
    sweepGain.gain.linearRampToValueAtTime(0, t + 1.2);
    sweep.connect(sweepGain);
    this._sendToReverb(sweepGain, destination, 0.5, 0.5);
    sweep.start(t);
    sweep.stop(t + 1.3);

    // Dark rumble: noise through lowpass 200Hz, 1s
    const rumble = ctx.createBufferSource();
    rumble.buffer = this._createNoiseBuffer(1.0);
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 200;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.setValueAtTime(volume * 0.4, t);
    rumbleGain.gain.linearRampToValueAtTime(0, t + 1.0);
    rumble.connect(rumbleFilter).connect(rumbleGain);
    this._sendToReverb(rumbleGain, destination, 0.5, 0.5);
    rumble.start(t);
    rumble.stop(t + 1.1);

    // Final thud: sine 40Hz at 0.8s mark, 200ms
    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.value = 40;
    const thudGain = ctx.createGain();
    thudGain.gain.setValueAtTime(0.001, t);
    thudGain.gain.setValueAtTime(volume * 0.7, t + 0.8);
    thudGain.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
    thud.connect(thudGain);
    this._sendToReverb(thudGain, destination, 0.5, 0.5);
    thud.start(t);
    thud.stop(t + 1.1);
  }

  /** Button hover: very short sine ping */
  playButtonHover(destination, volume = 0.08) {
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 1200;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.05, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.005);
    osc.connect(gain).connect(destination);
    osc.start(t);
    osc.stop(t + 0.01);
  }

  /** Button click: short sine + noise burst */
  playButtonClick(destination, volume = 0.12) {
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Sine 800Hz, 10ms
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 800;
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.08, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.01);
    osc.connect(oscGain).connect(destination);
    osc.start(t);
    osc.stop(t + 0.02);

    // Noise burst 3ms
    const noise = ctx.createBufferSource();
    noise.buffer = this._createNoiseBuffer(0.003);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.06, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.003);
    noise.connect(noiseGain).connect(destination);
    noise.start(t);
    noise.stop(t + 0.01);
  }

  /** Match start: dramatic horn swell + sub impact */
  playMatchStart(destination, volume = 0.3) {
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Dramatic horn: sawtooth 110Hz through lowpass 400Hz, 1s duration
    const horn = ctx.createOscillator();
    horn.type = 'sawtooth';
    horn.frequency.value = 110;
    const hornFilter = ctx.createBiquadFilter();
    hornFilter.type = 'lowpass';
    hornFilter.frequency.value = 400;
    const hornGain = ctx.createGain();
    // Gain swell from 0 to 0.3 over 500ms then fade
    hornGain.gain.setValueAtTime(0.001, t);
    hornGain.gain.linearRampToValueAtTime(volume, t + 0.5);
    hornGain.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
    horn.connect(hornFilter).connect(hornGain);
    this._sendToReverb(hornGain, destination, 0.3, 0.7);
    horn.start(t);
    horn.stop(t + 1.1);

    // Sub impact: sine 40Hz, 200ms
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 40;
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(volume * 0.8, t);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    sub.connect(subGain).connect(destination);
    sub.start(t);
    sub.stop(t + 0.25);
  }

  /** Victory sting: ascending major chord arpeggio + bright shimmer */
  playVictorySting(destination, volume = 0.25) {
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Triumphant fanfare: C4, E4, G4, C5 at 100ms intervals, 500ms decay each
    const notes = [262, 330, 392, 523];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 800;
      const gain = ctx.createGain();
      const start = t + i * 0.1;
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(volume, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.5);
      osc.connect(filter).connect(gain);
      this._sendToReverb(gain, destination, 0.4, 0.6);
      osc.start(start);
      osc.stop(start + 0.55);
    });

    // Bright shimmer: noise highpass 5000Hz, 300ms
    const shimmer = ctx.createBufferSource();
    shimmer.buffer = this._createNoiseBuffer(0.3);
    const shimmerFilter = ctx.createBiquadFilter();
    shimmerFilter.type = 'highpass';
    shimmerFilter.frequency.value = 5000;
    const shimmerGain = ctx.createGain();
    shimmerGain.gain.setValueAtTime(volume * 0.2, t);
    shimmerGain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    shimmer.connect(shimmerFilter).connect(shimmerGain).connect(destination);
    shimmer.start(t);
    shimmer.stop(t + 0.35);
  }

  /** Defeat sting: descending minor arpeggio + dark rumble */
  playDefeatSting(destination, volume = 0.25) {
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Descending minor: A3, F3, D3, A2 at 150ms intervals, 600ms decay
    const notes = [220, 175, 147, 110];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 400;
      const gain = ctx.createGain();
      const start = t + i * 0.15;
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(volume, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.6);
      osc.connect(filter).connect(gain);
      this._sendToReverb(gain, destination, 0.3, 0.7);
      osc.start(start);
      osc.stop(start + 0.65);
    });

    // Dark rumble: noise lowpass 200Hz, 1s
    const rumble = ctx.createBufferSource();
    rumble.buffer = this._createNoiseBuffer(1.0);
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 200;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.setValueAtTime(volume * 0.3, t);
    rumbleGain.gain.linearRampToValueAtTime(0, t + 1.0);
    rumble.connect(rumbleFilter).connect(rumbleGain);
    this._sendToReverb(rumbleGain, destination, 0.3, 0.7);
    rumble.start(t);
    rumble.stop(t + 1.1);
  }

  /** Ability ready: quick bright ping + quiet shimmer */
  playAbilityReady(destination, volume = 0.12) {
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Quick bright ping: sine 1047Hz (C6), 150ms decay
    const ping = ctx.createOscillator();
    ping.type = 'sine';
    ping.frequency.value = 1047;
    const pingGain = ctx.createGain();
    pingGain.gain.setValueAtTime(volume, t);
    pingGain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    ping.connect(pingGain);
    this._sendToReverb(pingGain, destination, 0.7, 0.3);
    ping.start(t);
    ping.stop(t + 0.2);

    // Quiet shimmer: noise highpass 4000Hz, 50ms
    const shimmer = ctx.createBufferSource();
    shimmer.buffer = this._createNoiseBuffer(0.05);
    const shimmerFilter = ctx.createBiquadFilter();
    shimmerFilter.type = 'highpass';
    shimmerFilter.frequency.value = 4000;
    const shimmerGain = ctx.createGain();
    shimmerGain.gain.setValueAtTime(volume * 0.3, t);
    shimmerGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    shimmer.connect(shimmerFilter).connect(shimmerGain).connect(destination);
    shimmer.start(t);
    shimmer.stop(t + 0.08);
  }

  // ── New SFX Methods ─────────────────────────────────────────────────────

  /** Jump land: short thump + scrape */
  playJumpLand(destination, volume = 0.2) {
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Short thump: sine 100Hz, 40ms
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.value = 100;
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(volume, t);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    thump.connect(thumpGain).connect(destination);
    thump.start(t);
    thump.stop(t + 0.06);

    // Scrape: noise through bandpass 2000Hz, 30ms
    const scrape = ctx.createBufferSource();
    scrape.buffer = this._createNoiseBuffer(0.03);
    const scrapeFilter = ctx.createBiquadFilter();
    scrapeFilter.type = 'bandpass';
    scrapeFilter.frequency.value = 2000;
    scrapeFilter.Q.value = 2;
    const scrapeGain = ctx.createGain();
    scrapeGain.gain.setValueAtTime(volume * 0.5, t);
    scrapeGain.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    scrape.connect(scrapeFilter).connect(scrapeGain).connect(destination);
    scrape.start(t);
    scrape.stop(t + 0.05);
  }

  /** Dodge roll: whoosh + cloth rustle */
  playDodgeRoll(destination, volume = 0.2) {
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Whoosh: noise through bandpass sweep 500→3000Hz, 200ms
    const whoosh = ctx.createBufferSource();
    whoosh.buffer = this._createNoiseBuffer(0.2);
    const whooshFilter = ctx.createBiquadFilter();
    whooshFilter.type = 'bandpass';
    whooshFilter.frequency.setValueAtTime(500, t);
    whooshFilter.frequency.exponentialRampToValueAtTime(3000, t + 0.2);
    whooshFilter.Q.value = 1;
    const whooshGain = ctx.createGain();
    whooshGain.gain.setValueAtTime(volume, t);
    whooshGain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    whoosh.connect(whooshFilter).connect(whooshGain).connect(destination);
    whoosh.start(t);
    whoosh.stop(t + 0.25);

    // Cloth rustle: noise through bandpass 3000Hz Q=2, 100ms, quiet
    const rustle = ctx.createBufferSource();
    rustle.buffer = this._createNoiseBuffer(0.1);
    const rustleFilter = ctx.createBiquadFilter();
    rustleFilter.type = 'bandpass';
    rustleFilter.frequency.value = 3000;
    rustleFilter.Q.value = 2;
    const rustleGain = ctx.createGain();
    rustleGain.gain.setValueAtTime(volume * 0.3, t);
    rustleGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    rustle.connect(rustleFilter).connect(rustleGain).connect(destination);
    rustle.start(t);
    rustle.stop(t + 0.15);
  }

}
