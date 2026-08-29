/**
 * ModelLoader — GLTFLoader wrapper with caching, cloning, and preload support.
 *
 * Loads GLB/GLTF models, caches originals, returns clones for instancing.
 * Supports PBR materials from Meshy.ai exports.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { resolveModelPath, getAllModelPaths, ASSET_MANIFEST } from './AssetManifest.js';

// Singleton loader instances
const gltfLoader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
dracoLoader.setDecoderConfig({ type: 'js' });
gltfLoader.setDRACOLoader(dracoLoader);

/** @type {Map<string, THREE.Group>} path → cached original model */
const modelCache = new Map();

/** @type {Map<string, Promise<THREE.Group>>} path → in-flight load promise */
const loadingPromises = new Map();

/** Enhance a Meshy-loaded material with procedural PBR. Meshy outputs
 *  diffuse-only on characters/monsters and partial PBR on some props. We
 *  add three things:
 *    1. bumpMap = diffuse (gives surfaces visible relief without authored normals)
 *    2. Tuned metallic/roughness based on material name heuristics
 *    3. Slight envMap intensity bump if metallic
 *  Result: characters look like they have armor sheen and skin softness,
 *  not "100% metallic 100% rough" (Meshy's default factors). */
/**
 * Meshy generates a full PBR set (normal / metallic / roughness) alongside the
 * base colour, and the generation pipeline already downloads them to
 * public/assets/textures/skin_<class>/. They were never applied: the rigged GLB
 * that Meshy returns carries only baseColor + emissive, so every character
 * rendered flat-lit with a diffuse-as-bump approximation standing in for real
 * surface detail.
 *
 * These are authored maps, so they must be sampled linearly (NoColorSpace) —
 * treating them as sRGB would gamma-shift the normals and roughness. flipY is
 * false to match the glTF UV convention the geometry was authored against.
 */
const _pbrCache = new Map(); // classId → {normalMap, metalnessMap, roughnessMap}
const _pbrTexLoader = new THREE.TextureLoader();

function loadClassPbrMaps(classId) {
  if (_pbrCache.has(classId)) return _pbrCache.get(classId);
  const base = `/assets/textures/skin_${classId}`;
  const linear = (file) => {
    const t = _pbrTexLoader.load(`${base}/${file}`, undefined, undefined, () => {
      // Missing map is non-fatal — the heuristic path below still applies.
    });
    t.colorSpace = THREE.NoColorSpace;
    t.flipY = false;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  const maps = {
    normalMap: linear('normal.png'),
    metalnessMap: linear('metallic.png'),
    roughnessMap: linear('roughness.png'),
  };
  _pbrCache.set(classId, maps);
  return maps;
}

/** Extract `tyrant` from `/assets/models/char_tyrant_mobile.glb`. */
function classIdFromPath(path) {
  const m = /char_([a-z]+?)(?:_mobile)?\.glb/.exec(path || '');
  return m ? m[1] : null;
}

function enhanceMeshyMaterial(material, path) {
  if (!material || !material.isMeshStandardMaterial) return;
  // Skip if already enhanced (cached materials get one pass)
  if (material.userData._meshyEnhanced) return;
  material.userData._meshyEnhanced = true;

  // 1) Real PBR maps when we have them, procedural bump only as fallback.
  const pbrClassId = classIdFromPath(path);
  if (pbrClassId && !material.normalMap) {
    const maps = loadClassPbrMaps(pbrClassId);
    material.normalMap = maps.normalMap;
    material.metalnessMap = maps.metalnessMap;
    material.roughnessMap = maps.roughnessMap;
    // glTF semantics: the scalar factor multiplies the map, so both must be 1
    // for the authored maps to drive the surface. The name-based heuristics
    // below are skipped entirely — real data beats guessing from a string.
    material.metalness = 1.0;
    material.roughness = 1.0;
    material.bumpMap = null;
    material.needsUpdate = true;
    return;
  }
  if (material.map && !material.normalMap && !material.bumpMap) {
    material.bumpMap = material.map;
    // Characters get less bump (faces, cloth flow); props get more (stone, rust)
    const isCharacter = path.includes('char_');
    const isMonster = path.includes('monsters/');
    material.bumpScale = isCharacter ? 0.025 : isMonster ? 0.04 : 0.08;
  }

  // 2) Tune metallic/roughness — Meshy defaults are 1.0/1.0 which means
  //    "100% metallic, fully rough chalky surface." That's wrong for almost
  //    every material type. Heuristic from material name + path.
  const name = (material.name || '').toLowerCase();
  const isCharacter = path.includes('char_');
  const isMonster = path.includes('monsters/');
  // Default: stone/cloth — low metalness, medium roughness
  let metallic = 0.05;
  let roughness = 0.7;
  if (isCharacter || isMonster) {
    // Hero meshes: most surfaces are mixed armor + cloth + skin. Pull metallic
    // back to ~0.25 (some armor sheen) and roughness to ~0.55 so light
    // direction reads on the mesh.
    metallic = 0.25;
    roughness = 0.55;
  }
  // Name-based overrides (Meshy sometimes names materials descriptively)
  if (name.includes('metal') || name.includes('iron') || name.includes('steel') || name.includes('gold') || name.includes('blade')) {
    metallic = 0.7;
    roughness = 0.35;
  } else if (name.includes('cloth') || name.includes('fabric') || name.includes('leather') || name.includes('robe')) {
    metallic = 0.02;
    roughness = 0.85;
  } else if (name.includes('skin') || name.includes('flesh') || name.includes('bone')) {
    metallic = 0.0;
    roughness = 0.65;
  } else if (name.includes('wood')) {
    metallic = 0.05;
    roughness = 0.80;
  }
  // Only override if Meshy left them at the lazy 1.0/1.0 defaults
  if (material.metalness === 1) material.metalness = metallic;
  if (material.roughness === 1) material.roughness = roughness;

  // 3) Ensure the material updates
  material.needsUpdate = true;
}

/**
 * Load a GLB/GLTF model. Returns cached version if already loaded.
 * @param {string} path - URL/path to model file
 * @returns {Promise<THREE.Group>} the loaded model (original, do not modify)
 */
export async function loadModel(path) {
  // Return cached
  if (modelCache.has(path)) {
    return modelCache.get(path);
  }

  // Return in-flight promise if already loading
  if (loadingPromises.has(path)) {
    return loadingPromises.get(path);
  }

  const promise = new Promise((resolve, reject) => {
    gltfLoader.load(
      path,
      (gltf) => {
        const model = gltf.scene;
        // Ensure all meshes use correct color space, receive shadows, and
        // get procedurally-enhanced PBR material from their diffuse map.
        // Meshy outputs diffuse-only on characters/monsters; we add bumpMap
        // (procedural normals from diffuse) + tuned metallic/roughness so
        // surfaces actually have depth instead of looking flat and chalky.
        model.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            if (child.material.map) {
              child.material.map.colorSpace = THREE.SRGBColorSpace;
            }
            enhanceMeshyMaterial(child.material, path);
          }
        });
        modelCache.set(path, model);
        loadingPromises.delete(path);
        resolve(model);
      },
      undefined, // progress
      (error) => {
        loadingPromises.delete(path);
        console.warn(`ModelLoader: failed to load ${path}`, error);
        reject(error);
      }
    );
  });

  loadingPromises.set(path, promise);
  return promise;
}

/**
 * Clone a cached model for instancing.
 * Uses SkeletonUtils.clone() for models with SkinnedMesh (preserves bone refs),
 * falls back to naive .clone(true) for simple models.
 * @param {THREE.Group} original
 * @returns {THREE.Group}
 */
export function cloneModel(original) {
  // Check if model has SkinnedMesh — must use SkeletonUtils.clone()
  let hasSkinned = false;
  original.traverse(node => {
    if (node.isSkinnedMesh) hasSkinned = true;
  });

  const clone = hasSkinned ? SkeletonUtils.clone(original) : original.clone(true);

  // Deep-clone materials so instances can be tinted independently
  clone.traverse((child) => {
    if (child.isMesh) {
      child.material = child.material.clone();
    }
  });
  return clone;
}

/**
 * Load and return a clone of a character model.
 * @param {string} classId - e.g. 'tyrant'
 * @param {string} [skinId] - optional skin variant
 * @returns {Promise<THREE.Group>}
 */
export async function loadCharacter(classId, skinId) {
  const path = resolveModelPath(classId, 'character', skinId);
  const original = await loadModel(path);
  return cloneModel(original);
}

/**
 * Load and return a clone of a weapon model.
 * @param {string} classId - e.g. 'tyrant'
 * @param {string} [weaponType] - e.g. 'greatsword', defaults to class default
 * @returns {Promise<THREE.Group>}
 */
export async function loadWeapon(classId, weaponType, skinId) {
  // Check for per-skin weapon override
  if (!weaponType && skinId) {
    const manifest = ASSET_MANIFEST[classId.toLowerCase()];
    if (manifest?.skinWeapons?.[skinId]) {
      weaponType = manifest.skinWeapons[skinId];
    }
  }
  const path = resolveModelPath(classId, 'weapon', weaponType);
  const original = await loadModel(path);
  return cloneModel(original);
}

/**
 * Check if a model exists at a path (non-blocking).
 * @param {string} path
 * @returns {boolean}
 */
export function isModelCached(path) {
  return modelCache.has(path);
}

/**
 * Check if any Meshy models are available.
 * @returns {boolean}
 */
export function hasMeshyModels() {
  const paths = getAllModelPaths();
  return paths.some(p => modelCache.has(p));
}

/**
 * Preload all models from the asset manifest.
 * Returns a progress callback-compatible promise.
 * @param {function} [onProgress] - called with (loaded, total)
 * @returns {Promise<number>} number of successfully loaded models
 */
export async function preloadAll(onProgress) {
  const paths = getAllModelPaths();
  const total = paths.length;
  let loaded = 0;
  let succeeded = 0;

  const results = await Promise.allSettled(
    paths.map(async (path) => {
      try {
        await loadModel(path);
        succeeded++;
      } catch {
        // Model not available yet — that's OK, fallback to procedural
      }
      loaded++;
      if (onProgress) onProgress(loaded, total);
    })
  );

  console.log(`ModelLoader: preloaded ${succeeded}/${total} models`);
  return succeeded;
}

/**
 * Get the scale factor for a class from the manifest.
 * @param {string} classId
 * @returns {number}
 */
export function getClassScale(classId) {
  const entry = ASSET_MANIFEST[classId.toLowerCase()];
  return entry?.scale || 1.0;
}

/**
 * Dispose all cached models and free GPU memory.
 */
export function disposeAll() {
  for (const [, model] of modelCache) {
    model.traverse((child) => {
      if (child.isMesh) {
        child.geometry.dispose();
        if (child.material.map) child.material.map.dispose();
        if (child.material.normalMap) child.material.normalMap.dispose();
        if (child.material.roughnessMap) child.material.roughnessMap.dispose();
        if (child.material.metalnessMap) child.material.metalnessMap.dispose();
        child.material.dispose();
      }
    });
  }
  modelCache.clear();
  loadingPromises.clear();
}
