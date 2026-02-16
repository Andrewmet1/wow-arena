import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.composer = null;
    this.useComposer = false;
  }

  async init() {
    this._createScene();
    this._createCamera();
    this._createRenderer();
    this._createLighting();
    await this._createPostProcessing();
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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

    // Main directional — bright cool moonlight
    const moonlight = new THREE.DirectionalLight(0xeeeeff, 4.0);
    moonlight.position.set(20, 40, 10);
    moonlight.castShadow = true;
    moonlight.shadow.mapSize.width = 2048;
    moonlight.shadow.mapSize.height = 2048;
    moonlight.shadow.camera.near = 0.5;
    moonlight.shadow.camera.far = 80;
    moonlight.shadow.camera.left = -40;
    moonlight.shadow.camera.right = 40;
    moonlight.shadow.camera.top = 40;
    moonlight.shadow.camera.bottom = -40;
    moonlight.shadow.bias = -0.002;
    this.scene.add(moonlight);

    // Strong fill from the opposite side
    const fillLight = new THREE.DirectionalLight(0xaabbcc, 2.5);
    fillLight.position.set(-15, 25, -10);
    this.scene.add(fillLight);

    // Back fill for rim lighting
    const backLight = new THREE.DirectionalLight(0x8899aa, 2.0);
    backLight.position.set(0, 10, -30);
    this.scene.add(backLight);

    // Hemisphere — bright sky, warm ground bounce
    const hemiLight = new THREE.HemisphereLight(0xaabbdd, 0x665544, 2.0);
    this.scene.add(hemiLight);

  }

  async _createPostProcessing() {
    // Selective bloom — only emissive elements above threshold glow
    const renderPass = new RenderPass(this.scene, this.camera);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.4,    // strength (subtle)
      0.3,    // radius
      0.85    // threshold (high = only bright emissive things bloom)
    );
    const outputPass = new OutputPass();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderPass);
    this.composer.addPass(bloomPass);
    this.composer.addPass(outputPass);
    this.useComposer = true;
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

  getCamera() { return this.camera; }
  getScene() { return this.scene; }
  getRenderer() { return this.renderer; }
}
