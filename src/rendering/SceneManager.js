import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.composer = null;
    this.useComposer = false;
  }

  async init(options = {}) {
    this._createScene();
    this._createCamera();
    this._createRenderer();
    if (options.lowMemory) {
      // Mobile: disable shadows and skip post-processing entirely to save GPU memory
      this.renderer.shadowMap.enabled = false;
      this._createLighting();
      this.useComposer = false;
    } else {
      this._createLighting();
      await this._createPostProcessing();
    }
    this._bindEvents();
  }

  _createScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2a);
    this.scene.fog = new THREE.FogExp2(0x1a1a2a, 0.008);
  }

  _createCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 500);
    this.camera.position.set(0, 12, 20);
    this.camera.lookAt(0, 0, 0);
  }

  _createRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });

    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // Characters were ~1.4M triangles each, which forced a hard 1x cap here.
    // They are now decimated to a 150K budget (see generate-mobile-models.mjs
    // --target-tris), so the pixel ratio is left to setQuality() rather than
    // being clamped before the quality tier is ever applied.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 2.5;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  _createLighting() {
    // Strong ambient so nothing is pure black
    const ambient = new THREE.AmbientLight(0x99aacc, 3.0);
    this.scene.add(ambient);
    this._ambientLight = ambient;

    // Main directional — bright cool moonlight
    const moonlight = new THREE.DirectionalLight(0xeeeeff, 4.0);
    moonlight.position.set(20, 40, 10);
    moonlight.castShadow = true;
    moonlight.shadow.mapSize.width = 1024;
    moonlight.shadow.mapSize.height = 1024;
    moonlight.shadow.camera.near = 0.5;
    moonlight.shadow.camera.far = 80;
    moonlight.shadow.camera.left = -40;
    moonlight.shadow.camera.right = 40;
    moonlight.shadow.camera.top = 40;
    moonlight.shadow.camera.bottom = -40;
    moonlight.shadow.bias = -0.002;
    this.scene.add(moonlight);
    this._moonLight = moonlight;

    // Strong fill from the opposite side
    const fillLight = new THREE.DirectionalLight(0xaabbcc, 2.5);
    fillLight.position.set(-15, 25, -10);
    this.scene.add(fillLight);
    this._fillLight = fillLight;

    // Back fill for rim lighting
    const backLight = new THREE.DirectionalLight(0x8899aa, 2.0);
    backLight.position.set(0, 10, -30);
    this.scene.add(backLight);
    this._backLight = backLight;

    // Hemisphere — bright sky, warm ground bounce
    const hemiLight = new THREE.HemisphereLight(0xaabbdd, 0x665544, 2.0);
    this.scene.add(hemiLight);
    this._hemiLight = hemiLight;

    // Snapshot defaults so applyDungeonAtmosphere can restore them later.
    this._defaultLighting = {
      ambient:    { color: ambient.color.getHex(), intensity: ambient.intensity },
      moon:       { color: moonlight.color.getHex(), intensity: moonlight.intensity },
      fill:       { color: fillLight.color.getHex(), intensity: fillLight.intensity },
      back:       { color: backLight.color.getHex(), intensity: backLight.intensity },
      hemi:       { skyColor: hemiLight.color.getHex(), groundColor: hemiLight.groundColor.getHex(), intensity: hemiLight.intensity },
      sceneBg:    this.scene.background?.getHex?.() ?? 0x1a1a2a,
      fogColor:   this.scene.fog?.color?.getHex?.() ?? 0x1a1a2a,
      fogDensity: this.scene.fog?.density ?? 0.008,
      bloom:      0.35,
    };
    this._dungeonTorches = [];
  }

  /**
   * Apply a dungeon theme's atmosphere — recolors lighting, fog, ambient,
   * and adds dim torch point lights at fixed positions around the arena.
   * Call when a dungeon match starts. Reversed by restoreDefaultAtmosphere().
   *
   * @param {object} atmo — see themes.js: ambientColor, ambientIntensity,
   *   fogColor, fogDensity, torchColor, torchIntensity, groundTint, bloomStrength
   */
  applyDungeonAtmosphere(atmo) {
    if (!atmo || !this._ambientLight) return;
    // Drop ambient way down — dungeons are dark, only torches pierce
    this._ambientLight.color.setHex(atmo.ambientColor ?? 0x2a1410);
    this._ambientLight.intensity = atmo.ambientIntensity ?? 0.25;

    // Moon → faint cold moon barely visible from above
    this._moonLight.color.setHex(0x223344);
    this._moonLight.intensity = 0.4;
    this._fillLight.color.setHex(0x1a1a2a);
    this._fillLight.intensity = 0.3;
    this._backLight.color.setHex(0x110a0a);
    this._backLight.intensity = 0.2;
    // Warm ground bounce from torches
    this._hemiLight.color.setHex(0x1a0a08);
    this._hemiLight.groundColor.setHex(atmo.groundTint ?? 0x3a1a14);
    this._hemiLight.intensity = 0.4;

    // Painted DALL-E skybox as scene.background. Three.js renders an
    // equirectangular texture as a full 360° skybox backdrop — the player
    // sees the painted "void" art whenever the camera points past the
    // chamber walls. No more flat black + no more outer-ground clutter.
    if (!this._skyboxTex) {
      this._skyboxTex = new THREE.TextureLoader().load(
        '/assets/art/dungeon/void_skybox.png',
        (tex) => { tex.colorSpace = THREE.SRGBColorSpace; },
      );
      this._skyboxTex.mapping = THREE.EquirectangularReflectionMapping;
    }
    this.scene.background = this._skyboxTex;
    this.renderer.setClearColor(0x000000, 1.0);
    // Fog uses the theme color so the atmospheric haze still feels warm/cold
    // appropriately — it only affects geometry the camera hits, not the
    // background, so the void itself remains pure black.
    // Light fog — was 0.035 which made characters hazy at camera distance.
    // 0.018 keeps the moody atmosphere while letting the player see their
    // character clearly. Ruins past ~50u still fade into darkness.
    const fogColor = atmo.fogColor ?? 0x0a0604;
    if (this.scene.fog) {
      this.scene.fog.color.setHex(fogColor);
      this.scene.fog.density = atmo.fogDensity ?? 0.018;
    } else {
      this.scene.fog = new THREE.FogExp2(fogColor, atmo.fogDensity ?? 0.018);
    }
    // Tone-mapping exposure 2.0 in dungeon — bloom is OFF for perf, so we
    // rely on high exposure to make additive-blended ability VFX (cyclone,
    // spell glows, runic circles) visibly bright. Tested w/ pure-black
    // skybox background to confirm the void doesn't lift into gray.
    this._savedToneExposure ??= this.renderer.toneMappingExposure;
    this.renderer.toneMappingExposure = 2.0;

    // Spawn 6 torch point-lights around the arena perimeter
    this._removeDungeonTorches();
    const torchPositions = [
      { x: -25, z: -15 }, { x: -25, z: 15 },
      { x:   0, z: -22 }, { x:   0, z: 22 },
      { x:  25, z: -15 }, { x:  25, z: 15 },
    ];
    const torchColor = atmo.torchColor ?? 0xff7a44;
    const torchIntensity = atmo.torchIntensity ?? 1.2;
    for (const p of torchPositions) {
      const torch = new THREE.PointLight(torchColor, torchIntensity, 18, 2);
      torch.position.set(p.x, 4, p.z);
      torch.userData.isDungeonTorch = true;
      torch.userData.baseIntensity = torchIntensity;
      torch.userData.flickerOffset = Math.random() * Math.PI * 2;
      this.scene.add(torch);
      this._dungeonTorches.push(torch);
    }

    // Bloom OFF in dungeon — at 10fps reports it's a big-spend pass we
    // can't afford. Ability VFX is still visible thanks to tone-mapping
    // exposure 1.6 + emissive materials. We can re-enable bloom once we
    // hit 60fps with everything else stable.
    if (this._bloomPass) {
      this._bloomPass.enabled = false;
    }
    // SSAO + shadow maps disabled in dungeon — both were tanking framerate.
    // Visual depth comes from bumpMap + per-chamber lighting instead.
    if (this._ssaoPass) {
      this._ssaoPass.enabled = false;
    }
    if (this.renderer?.shadowMap) {
      this._savedShadowEnabled = this.renderer.shadowMap.enabled;
      this.renderer.shadowMap.enabled = false;
    }
    this._dungeonAtmosphereActive = true;
  }

  /** Revert to PvP arena lighting. Called when leaving a dungeon match. */
  restoreDefaultAtmosphere() {
    if (!this._defaultLighting) return;
    const d = this._defaultLighting;
    this._ambientLight.color.setHex(d.ambient.color);
    this._ambientLight.intensity = d.ambient.intensity;
    this._moonLight.color.setHex(d.moon.color);
    this._moonLight.intensity = d.moon.intensity;
    this._fillLight.color.setHex(d.fill.color);
    this._fillLight.intensity = d.fill.intensity;
    this._backLight.color.setHex(d.back.color);
    this._backLight.intensity = d.back.intensity;
    this._hemiLight.color.setHex(d.hemi.skyColor);
    this._hemiLight.groundColor.setHex(d.hemi.groundColor);
    this._hemiLight.intensity = d.hemi.intensity;
    this.scene.background = new THREE.Color(d.sceneBg);
    if (this.scene.fog) {
      this.scene.fog.color.setHex(d.fogColor);
      this.scene.fog.density = d.fogDensity;
    }
    this._removeDungeonTorches();
    if (this._bloomPass) {
      this._bloomPass.enabled = true;
      this._bloomPass.strength = d.bloom;
      this._bloomPass.radius = 0.3;
      this._bloomPass.threshold = 0.9;
    }
    // Restore the arena tone-mapping exposure.
    if (this._savedToneExposure != null) {
      this.renderer.toneMappingExposure = this._savedToneExposure;
    }
    if (this._ssaoPass) this._ssaoPass.enabled = false;
    // Restore shadow map when leaving dungeon (it was disabled for perf)
    if (this.renderer?.shadowMap && this._savedShadowEnabled != null) {
      this.renderer.shadowMap.enabled = this._savedShadowEnabled;
    }
    this._dungeonAtmosphereActive = false;
  }

  _removeDungeonTorches() {
    for (const t of this._dungeonTorches) this.scene.remove(t);
    this._dungeonTorches = [];
  }

  /** Per-frame torch flicker. Call from main render loop after applyDungeonAtmosphere. */
  tickDungeonAtmosphere(time) {
    if (!this._dungeonAtmosphereActive) return;
    for (const t of this._dungeonTorches) {
      const f = 0.85 + Math.sin(time * 6 + t.userData.flickerOffset) * 0.08
                     + Math.sin(time * 17 + t.userData.flickerOffset) * 0.05;
      t.intensity = t.userData.baseIntensity * f;
    }
  }

  async _createPostProcessing() {
    // Environment map for PBR metallic reflections on Meshy models
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    pmremGenerator.compileEquirectangularShader();
    const envScene = new RoomEnvironment();
    const envTexture = pmremGenerator.fromScene(envScene, 0.04).texture;
    this.scene.environment = envTexture;
    pmremGenerator.dispose();

    // Post-processing pipeline. SSAO is still dungeon-only: the cost that
    // originally disabled it scaled with skinned-mesh density, which is now
    // ~6-9x lower, but re-enabling it for arena should follow an actual frame
    // -time measurement rather than an assumption.
    const renderPass = new RenderPass(this.scene, this.camera);

    // Bloom at half resolution for performance
    const halfRes = new THREE.Vector2(
      Math.floor(window.innerWidth / 2),
      Math.floor(window.innerHeight / 2)
    );
    const bloomPass = new UnrealBloomPass(
      halfRes,
      0.35,   // strength (subtle)
      0.3,    // radius
      0.9     // threshold (high = only bright emissive things bloom)
    );
    // SSAO post-process — contact shadows + corner darkening + ambient
    // occlusion. Single biggest visual delta for "Diablo-feel" — props now
    // look grounded, wall corners read as real corners, recessed areas darken.
    // Only enabled in dungeon mode (toggled by applyDungeonAtmosphere).
    const ssaoPass = new SSAOPass(
      this.scene, this.camera,
      window.innerWidth, window.innerHeight,
    );
    ssaoPass.kernelRadius = 8;
    ssaoPass.minDistance = 0.001;
    ssaoPass.maxDistance = 0.06;
    ssaoPass.enabled = false; // off by default; dungeon enables it
    const outputPass = new OutputPass();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderPass);
    this.composer.addPass(ssaoPass);
    this.composer.addPass(bloomPass);
    this.composer.addPass(outputPass);
    this.useComposer = true;
    this._bloomPass = bloomPass;
    this._ssaoPass = ssaoPass;
  }

  _bindEvents() {
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
    if (this.useComposer && this.composer) {
      this.composer.setSize(width, height);
    }
  }

  render() {
    if (this.useComposer && this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  setQuality(level) {
    const renderer = this.renderer;
    if (!renderer) return;

    if (level === 'low') {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
      renderer.shadowMap.enabled = false;
      this.useComposer = false;
    } else if (level === 'high') {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      // Upgrade shadow resolution
      this.scene.traverse(obj => {
        if (obj.isDirectionalLight && obj.shadow) {
          obj.shadow.mapSize.width = 2048;
          obj.shadow.mapSize.height = 2048;
          if (obj.shadow.map) { obj.shadow.map.dispose(); obj.shadow.map = null; }
        }
      });
      this.useComposer = true;
    } else {
      // medium (default) — 1.5x is affordable now that characters are 150K
      // tris rather than 1.4M. Drop to 'low' for a hard 1x.
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.useComposer = true;
    }

    // Refresh sizes
    this.resize();
    renderer.shadowMap.needsUpdate = true;
  }

  getCamera() { return this.camera; }
  getScene() { return this.scene; }
  getRenderer() { return this.renderer; }
}
