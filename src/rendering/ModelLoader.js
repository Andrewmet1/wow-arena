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
        // Ensure all meshes use correct color space and receive shadows
        model.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            if (child.material.map) {
              child.material.map.colorSpace = THREE.SRGBColorSpace;
            }
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
export async function loadWeapon(classId, weaponType) {
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
