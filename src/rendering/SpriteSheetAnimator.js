// SpriteSheetAnimator — Frame-cycling utility for Three.js texture atlases
// Drives animation by modifying texture.offset and texture.repeat each frame.
// Works with SpriteMaterial.map, MeshBasicMaterial.map, or any mapped material.

import * as THREE from 'three';

export class SpriteSheetAnimator {
  /**
   * @param {THREE.Texture} texture - The loaded sprite sheet atlas texture
   * @param {number} cols - Grid columns (e.g. 4)
   * @param {number} rows - Grid rows (e.g. 4)
   * @param {number} totalFrames - Frames to use (may be < cols*rows)
   * @param {number} fps - Playback speed
   * @param {boolean} loop - Loop or play once
   */
  constructor(texture, cols, rows, totalFrames, fps = 15, loop = true) {
    this.texture = texture;
    this.cols = cols;
    this.rows = rows;
    this.totalFrames = Math.min(totalFrames, cols * rows);
    this.fps = fps;
    this.loop = loop;
    this._elapsed = 0;
    this._currentFrame = -1;
    this._finished = false;
    this._gpuReady = false; // Set true once texture image is uploaded to GPU

    // ClampToEdge prevents neighboring frame bleed
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    // Show one cell of the grid
    texture.repeat.set(1 / cols, 1 / rows);
    this._setFrame(0);
  }

  /** Advance animation by dt seconds. Returns true if still playing. */
  update(dt) {
    if (this._finished) return false;

    // Cloned textures may not have their image data when first created.
    // Once the source image loads (shared reference), mark for GPU upload.
    if (!this._gpuReady && this.texture.image?.complete) {
      this.texture.needsUpdate = true;
      this._gpuReady = true;
    }

    this._elapsed += dt;
    const frameIndex = Math.floor(this._elapsed * this.fps);

    if (frameIndex >= this.totalFrames) {
      if (this.loop) {
        this._elapsed -= this.totalFrames / this.fps;
        this._setFrame(0);
      } else {
        this._setFrame(this.totalFrames - 1);
        this._finished = true;
        return false;
      }
    } else {
      this._setFrame(frameIndex);
    }
    return true;
  }

  _setFrame(index) {
    if (index === this._currentFrame) return;
    this._currentFrame = index;
    const col = index % this.cols;
    const row = Math.floor(index / this.cols);
    this.texture.offset.set(
      col / this.cols,
      1 - (row + 1) / this.rows // Y-flip: UV origin is bottom-left
    );
  }

  reset() {
    this._elapsed = 0;
    this._finished = false;
    this._setFrame(0);
  }

  get finished() { return this._finished; }
}
