/**
 * SkinManager — WoW-style skin system using a pre-rigged base mesh.
 *
 * Loads a single base humanoid GLB (with skeleton + bone weights + animations),
 * then clones it per character and applies class-specific textures.
 * All characters share the same proven rig — no auto-rigging needed.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

const BASE_MESH_PATH = '/assets/models/base_humanoid.glb';
const TEXTURE_BASE = '/assets/textures/';

// Singleton loader
const gltfLoader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
dracoLoader.setDecoderConfig({ type: 'js' });
gltfLoader.setDRACOLoader(dracoLoader);

const textureLoader = new THREE.TextureLoader();

/** @type {import('three').GLTF|null} */
let cachedBaseGltf = null;

/** @type {Promise<import('three').GLTF>|null} */
let loadingPromise = null;

/** @type {Map<string, THREE.Texture>} path → cached texture */
const textureCache = new Map();

/**
 * Load the base humanoid mesh. Returns cached GLTF if already loaded.
 * The GLTF contains .scene (with SkinnedMesh + Skeleton) and .animations (AnimationClip[]).
 * @returns {Promise<import('three').GLTF>}
 */
export async function loadBaseMesh() {
  if (cachedBaseGltf) return cachedBaseGltf;
  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise((resolve, reject) => {
    gltfLoader.load(
      BASE_MESH_PATH,
      (gltf) => {
        // Post-process: set shadows, color space
        gltf.scene.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            if (child.material.map) {
              child.material.map.colorSpace = THREE.SRGBColorSpace;
            }
          }
        });
        cachedBaseGltf = gltf;
        loadingPromise = null;
        resolve(gltf);
      },
      undefined,
      (error) => {
        loadingPromise = null;
        console.warn('SkinManager: failed to load base mesh', error);
        reject(error);
      }
    );
  });

  return loadingPromise;
}

/**
 * Load a texture with caching.
 * @param {string} path
 * @returns {Promise<THREE.Texture>}
 */
function loadTexture(path) {
  if (textureCache.has(path)) {
    return Promise.resolve(textureCache.get(path));
  }
  return new Promise((resolve, reject) => {
    textureLoader.load(
      path,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = false;
        textureCache.set(path, tex);
        resolve(tex);
      },
      undefined,
      (err) => {
        console.warn(`SkinManager: texture not found: ${path}`);
        reject(err);
      }
    );
  });
}

/**
 * Create a character instance from the base mesh with class-specific textures.
 *
 * @param {string} classId - e.g. 'tyrant', 'wraith'
 * @param {object} [skinConfig] - optional texture config from AssetManifest
 * @param {string} [skinConfig.diffuse] - path to diffuse texture
 * @param {string} [skinConfig.normal] - path to normal map
 * @param {string} [skinConfig.roughness] - path to roughness map
 * @param {string} [skinConfig.metallic] - path to metalness map
 * @returns {Promise<{scene: THREE.Group, animations: THREE.AnimationClip[]}>}
 */
export async function createSkinnedCharacter(classId, skinConfig) {
  const gltf = await loadBaseMesh();

  // Deep clone with proper SkinnedMesh/Skeleton handling
  const clonedScene = skeletonClone(gltf.scene);

  // Apply class-specific textures if available
  if (skinConfig) {
    await applySkinTextures(clonedScene, classId, skinConfig);
  }

  // Ensure shadows on all meshes
  clonedScene.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      // Clone material so each instance is independent
      child.material = child.material.clone();
    }
  });

  return {
    scene: clonedScene,
    animations: gltf.animations, // AnimationClip[] shared across all instances
  };
}

/**
 * Apply class-specific textures to a cloned scene.
 * @param {THREE.Group} scene
 * @param {string} classId
 * @param {object} skinConfig
 */
async function applySkinTextures(scene, classId, skinConfig) {
  const textureTasks = [];

  if (skinConfig.diffuse) {
    textureTasks.push(
      loadTexture(skinConfig.diffuse).then(tex => ({ type: 'map', tex }))
    );
  }
  if (skinConfig.normal) {
    textureTasks.push(
      loadTexture(skinConfig.normal).then(tex => ({ type: 'normalMap', tex }))
    );
  }
  if (skinConfig.roughness) {
    textureTasks.push(
      loadTexture(skinConfig.roughness).then(tex => ({ type: 'roughnessMap', tex }))
    );
  }
  if (skinConfig.metallic) {
    textureTasks.push(
      loadTexture(skinConfig.metallic).then(tex => ({ type: 'metalnessMap', tex }))
    );
  }

  const textures = await Promise.allSettled(textureTasks);

  scene.traverse((child) => {
    if (child.isMesh) {
      // Clone material for independent textures
      child.material = child.material.clone();

      for (const result of textures) {
        if (result.status === 'fulfilled') {
          const { type, tex } = result.value;
          child.material[type] = tex.clone();
          child.material.needsUpdate = true;
        }
      }
    }
  });
}

/**
 * Get bone name mapping from Mixamo to our game's bone names.
 * Allows code that accesses bones by our names to still work.
 */
export const MIXAMO_BONE_MAP = {
  // Our name → Mixamo name
  'hips':           'mixamorigHips',
  'spine':          'mixamorigSpine',
  'body':           'mixamorigSpine2',     // chest/upper spine
  'neck':           'mixamorigNeck',
  'head':           'mixamorigHead',
  'leftShoulder':   'mixamorigLeftShoulder',
  'leftArm':        'mixamorigLeftArm',
  'leftForearm':    'mixamorigLeftForeArm',
  'leftHand':       'mixamorigLeftHand',
  'rightShoulder':  'mixamorigRightShoulder',
  'rightArm':       'mixamorigRightArm',
  'rightForearm':   'mixamorigRightForeArm',
  'rightHand':      'mixamorigRightHand',
  'leftLeg':        'mixamorigLeftUpLeg',
  'leftLowerLeg':   'mixamorigLeftLeg',
  'leftFoot':       'mixamorigLeftFoot',
  'leftToe':        'mixamorigLeftToeBase',
  'rightLeg':       'mixamorigRightUpLeg',
  'rightLowerLeg':  'mixamorigRightLeg',
  'rightFoot':      'mixamorigRightFoot',
  'rightToe':       'mixamorigRightToeBase',
};

// Reverse map: Mixamo name → our name
export const REVERSE_BONE_MAP = Object.fromEntries(
  Object.entries(MIXAMO_BONE_MAP).map(([k, v]) => [v, k])
);

/**
 * Find a bone by our game's bone name, checking both our name and the Mixamo name.
 * Works with both old auto-rigged models and new base mesh models.
 * @param {THREE.Object3D} root - the scene/model root
 * @param {string} boneName - our bone name (e.g. 'leftArm')
 * @returns {THREE.Bone|null}
 */
export function findBone(root, boneName) {
  // Try our name first
  let bone = root.getObjectByName(boneName);
  if (bone) return bone;

  // Try Mixamo name
  const mixamoName = MIXAMO_BONE_MAP[boneName];
  if (mixamoName) {
    bone = root.getObjectByName(mixamoName);
    if (bone) return bone;
  }

  return null;
}

/**
 * Check if the base mesh is loaded and ready.
 * @returns {boolean}
 */
export function isBaseMeshReady() {
  return cachedBaseGltf !== null;
}

/**
 * Dispose all cached textures and the base mesh.
 */
export function dispose() {
  for (const [, tex] of textureCache) {
    tex.dispose();
  }
  textureCache.clear();

  if (cachedBaseGltf) {
    cachedBaseGltf.scene.traverse((child) => {
      if (child.isMesh) {
        child.geometry.dispose();
        if (child.material.map) child.material.map.dispose();
        child.material.dispose();
      }
    });
    cachedBaseGltf = null;
  }
}
