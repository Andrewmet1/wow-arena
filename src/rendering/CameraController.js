import * as THREE from 'three';

export class CameraController {
  constructor(camera) {
    this.camera = camera;
    this.target = new THREE.Vector3(0, 1.5, 0);
    this.currentPos = new THREE.Vector3(0, 16, 26);

    // Camera offset from target
    this.distance = 20;
    this.height = 7;
    this.rotationAngle = 0; // Radians around Y axis

    // Settings
    this.minDistance = 6;
    this.maxDistance = 30;
    this.smoothFactor = 0.25;
    this.fovBase = 55;
    this.fovTarget = 55;

    // Screen shake
    this.shakeIntensity = 0;
    this.shakeDuration = 0;
    this.shakeTimer = 0;

    // Mouse control — WoW-style
    // Right-click drag = rotate camera + turn character
    // Left-click = target selection only (no camera rotate)
    // Both buttons = move forward
    this.isLeftMouseDown = false;
    this.isRightMouseDown = false;
    this.isRightDrag = false;
    this.mouseDownX = 0;
    this.mouseDownY = 0;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    this.pitchAngle = -0.35; // Look-down angle

    // For left-click target detection
    this._leftClickStart = null;

    // Raycaster for collision
    this.raycaster = new THREE.Raycaster();
    this.collisionObjects = [];
  }

  setTarget(position) {
    this.target.set(position.x, position.y + 1.5, position.z);
  }

  setCollisionObjects(objects) {
    this.collisionObjects = objects;
  }

  /**
   * Trigger screen shake
   */
  shake(intensity = 0.3, duration = 0.3) {
    this.shakeIntensity = intensity;
    this.shakeDuration = duration;
    this.shakeTimer = duration;
  }

  /**
   * Trigger FOV punch (for burst abilities)
   */
  fovPunch(targetFov = 62, returnSpeed = 0.02) {
    this.fovTarget = targetFov;
    this._fovReturnSpeed = returnSpeed;
  }

  /**
   * Whether both mouse buttons are held (WoW: move forward)
   */
  get bothButtonsHeld() {
    return this.isLeftMouseDown && this.isRightMouseDown;
  }

  /**
   * The camera's forward facing angle (character faces this direction)
   */
  get cameraFacingAngle() {
    return this.rotationAngle + Math.PI;
  }

  /**
   * Handle mouse events — WoW-style:
   * Left click = target only, Right drag = camera rotate + character turn
   */
  onMouseDown(e) {
    if (e.button === 0) {
      this.isLeftMouseDown = true;
      this._leftClickStart = { x: e.clientX, y: e.clientY };
    }
    if (e.button === 2) {
      this.isRightMouseDown = true;
      this.isRightDrag = false;
      this.mouseDownX = e.clientX;
      this.mouseDownY = e.clientY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    }
  }

  onMouseUp(e) {
    if (e.button === 0) {
      this.isLeftMouseDown = false;
      this._leftClickStart = null;
    }
    if (e.button === 2) {
      this.isRightMouseDown = false;
      this.isRightDrag = false;
    }
  }

  onMouseMove(e) {
    // Only rotate camera on RIGHT-click drag (WoW-style)
    if (this.isRightMouseDown) {
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;

      // Drag threshold
      if (!this.isRightDrag) {
        const totalDx = e.clientX - this.mouseDownX;
        const totalDy = e.clientY - this.mouseDownY;
        if (Math.abs(totalDx) > 3 || Math.abs(totalDy) > 3) {
          this.isRightDrag = true;
        }
      }

      if (this.isRightDrag) {
        this.rotationAngle -= dx * 0.008;
        this.pitchAngle = Math.max(-1.4, Math.min(0.1, this.pitchAngle - dy * 0.005));
      }

      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    }
  }

  onWheel(e) {
    this.distance += e.deltaY * 0.02;
    this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance));
  }

  /**
   * Immediately position the camera behind a target (no lerp).
   */
  snapToTarget(position) {
    this.target.set(position.x, (position.y || 0) + 1.5, position.z);

    const offsetX = Math.sin(this.rotationAngle) * this.distance * Math.cos(this.pitchAngle);
    const offsetZ = Math.cos(this.rotationAngle) * this.distance * Math.cos(this.pitchAngle);
    const offsetY = this.height + this.distance * Math.sin(-this.pitchAngle);

    this.currentPos.set(
      this.target.x + offsetX,
      this.target.y + offsetY,
      this.target.z + offsetZ
    );

    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.target);
  }

  /**
   * No-op — camera stays where player puts it via right-click drag.
   */
  setFacing(_facingAngle) {
    // Intentionally empty
  }

  /**
   * Update camera position and look-at
   */
  update(deltaTime) {
    const offsetX = Math.sin(this.rotationAngle) * this.distance * Math.cos(this.pitchAngle);
    const offsetZ = Math.cos(this.rotationAngle) * this.distance * Math.cos(this.pitchAngle);
    const offsetY = this.height + this.distance * Math.sin(-this.pitchAngle);

    const idealPos = new THREE.Vector3(
      this.target.x + offsetX,
      this.target.y + offsetY,
      this.target.z + offsetZ
    );

    // Collision check
    if (this.collisionObjects.length > 0) {
      const dir = idealPos.clone().sub(this.target).normalize();
      this.raycaster.set(this.target, dir);
      this.raycaster.far = this.distance + 2;
      const hits = this.raycaster.intersectObjects(this.collisionObjects, true);
      if (hits.length > 0 && hits[0].distance < this.distance) {
        const clampedDist = Math.max(3, hits[0].distance - 1);
        idealPos.copy(this.target).add(dir.multiplyScalar(clampedDist));
      }
    }

    this.currentPos.lerp(idealPos, this.smoothFactor);

    // Screen shake
    let shakeOffset = new THREE.Vector3();
    if (this.shakeTimer > 0) {
      const t = this.shakeTimer / this.shakeDuration;
      const decay = t * t;
      const intensity = this.shakeIntensity * decay;
      shakeOffset.set(
        (Math.random() - 0.5) * 2 * intensity,
        (Math.random() - 0.5) * 1.5 * intensity,
        (Math.random() - 0.5) * intensity
      );
      this.shakeTimer -= deltaTime;
    }

    this.camera.position.copy(this.currentPos).add(shakeOffset);
    this.camera.lookAt(this.target);

    // FOV animation
    if (Math.abs(this.camera.fov - this.fovTarget) > 0.1) {
      this.camera.fov += (this.fovTarget - this.camera.fov) * 0.05;
      this.camera.updateProjectionMatrix();
    }
    if (this.fovTarget !== this.fovBase) {
      this.fovTarget += (this.fovBase - this.fovTarget) * (this._fovReturnSpeed || 0.02);
      if (Math.abs(this.fovTarget - this.fovBase) < 0.5) this.fovTarget = this.fovBase;
    }
  }

  /**
   * Attach mouse event listeners.
   */
  attachEvents(_element) {
    window.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('wheel', (e) => this.onWheel(e));
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}
