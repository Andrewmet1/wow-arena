import * as THREE from 'three';
import { InputManager } from '../input/InputManager.js';

export class CameraController {
  constructor(camera) {
    this.camera = camera;
    this.target = new THREE.Vector3(0, 1.5, 0);
    this.currentPos = new THREE.Vector3(0, 6, 14);

    const mobile = InputManager.isMobile();

    // Orbital camera arm (pure spherical — no separate height offset)
    this.distance = mobile ? 18 : 14;
    this.rotationAngle = 0;      // Yaw: radians around Y axis
    this.pitchAngle = -0.3;      // Pitch: negative = look down

    // Limits
    this.minDistance = 5;
    this.maxDistance = 30;

    // Saved PvP camera settings — dungeon mode overrides them and we restore
    // when leaving so PvP keeps its tighter, lower-angle camera.
    this._savedDefaults = null;

    // FOV
    this.fovBase = 55;
    this.fovTarget = 55;
    this._fovReturnSpeed = 0.02;

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
    this._leftClickStart = null;

    // Collision
    this.raycaster = new THREE.Raycaster();
    this.collisionObjects = [];
    this._collisionDist = this.distance;

    // Action camera auto-follow
    this.autoFollow = mobile ? true : false;
    this._targetMoving = false;
    this._targetFacing = 0;
    this._rightStickActive = false;

    // Reusable vectors (avoid per-frame allocation)
    this._idealPos = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._shakeVec = new THREE.Vector3();
  }

  setTarget(position) {
    // In dungeon mode we lock the target Y to a constant — this eliminates
    // camera bob caused by tiny per-frame jitter in player.y from server
    // reconciliation, animation root motion, or jump physics. Outside of
    // dungeons we still track player Y so jumps/falls feel right.
    const y = (this._lockTargetY != null) ? this._lockTargetY : (position.y + 1.5);
    this.target.set(position.x, y, position.z);
  }

  setCollisionObjects(objects) {
    this.collisionObjects = objects;
  }

  // Camera shake + FOV punch disabled globally — user prefers a stable
  // camera. No-op stubs kept so existing call sites don't need to change.
  shake() {}
  fovPunch() {}

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

  // --- Mouse events (WoW-style) ---

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
        this.pitchAngle = Math.max(-1.2, Math.min(0.05, this.pitchAngle - dy * 0.005));
      }

      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    }
  }

  onWheel(e) {
    this.distance += e.deltaY * 0.02;
    this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance));
  }

  // --- Camera positioning ---

  /**
   * Compute ideal camera position using pure spherical coordinates.
   * Distance controls ONLY how far away — the viewing angle stays constant.
   */
  _computeIdealPos(dist) {
    const cosPitch = Math.cos(this.pitchAngle);
    this._idealPos.set(
      this.target.x + Math.sin(this.rotationAngle) * dist * cosPitch,
      this.target.y + dist * Math.sin(-this.pitchAngle),
      this.target.z + Math.cos(this.rotationAngle) * dist * cosPitch
    );
    return this._idealPos;
  }

  /**
   * Immediately position the camera behind a target (no lerp).
   */
  snapToTarget(position) {
    this.target.set(position.x, (position.y || 0) + 1.5, position.z);
    this._collisionDist = this.distance;
    this._computeIdealPos(this.distance);
    this.currentPos.copy(this._idealPos);
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.target);
  }

  /** Diablo-style overhead camera for dungeon mode — much higher pitch + */
  /*  longer arm so the player can see the chamber layout from above and */
  /*  walls don't crowd the view. PvP camera is restored on leaveDungeon().*/
  enterDungeonCamera() {
    if (this._savedDefaults) return; // already in dungeon
    this._savedDefaults = {
      distance: this.distance,
      pitchAngle: this.pitchAngle,
      maxDistance: this.maxDistance,
      minDistance: this.minDistance,
      collisionObjects: this.collisionObjects,
    };
    this.distance = 28;
    this.pitchAngle = -0.95;
    this.maxDistance = 40;
    this.minDistance = 14;
    this._collisionDist = this.distance;
    this.collisionObjects = [];
    this._dungeonMode = true;
    this._lockTargetY = 1.0; // lock camera target Y to constant (kills bob)
  }

  /** Cinematic camera zoom for boss room entry — slowly orbits closer for a
   *  dramatic reveal, then settles into normal dungeon camera. Auto-clears
   *  after ~3.5s. */
  cinematicBossZoom() {
    if (!this._savedDefaults) return; // only valid in dungeon mode
    this._cinematicState = {
      startTime: performance.now(),
      duration: 3500,
      startDist: this.distance,
      midDist: 18, // closer for drama
      endDist: this._savedDefaults ? 28 : this.distance,
      startPitch: this.pitchAngle,
      midPitch: -0.65, // more cinematic side-on
      endPitch: -0.95,
    };
  }

  leaveDungeonCamera() {
    if (!this._savedDefaults) return;
    this.distance = this._savedDefaults.distance;
    this.pitchAngle = this._savedDefaults.pitchAngle;
    this.maxDistance = this._savedDefaults.maxDistance;
    this.minDistance = this._savedDefaults.minDistance;
    this.collisionObjects = this._savedDefaults.collisionObjects;
    this._collisionDist = this.distance;
    this._dungeonMode = false;
    this._lockTargetY = null;
    this._savedDefaults = null;
  }

  /**
   * Update the character's facing angle for action camera auto-follow.
   */
  setFacing(facingAngle) {
    this._targetFacing = facingAngle;
  }

  /**
   * Inform camera of character movement state for auto-follow.
   */
  setTargetMoving(isMoving, facing) {
    this._targetMoving = isMoving;
    this._targetFacing = facing;
  }

  /**
   * Lerp between two angles, handling wraparound.
   */
  _lerpAngle(a, b, t) {
    let diff = b - a;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
  }

  /**
   * Frame-rate independent damping factor.
   * Returns alpha for lerp such that convergence speed is constant
   * regardless of frame rate.
   */
  _damp(speed, dt) {
    return 1 - Math.exp(-speed * dt);
  }

  /**
   * Update camera position and look-at
   */
  update(deltaTime) {
    // Clamp deltaTime to prevent huge jumps on tab-switch / lag spikes
    const dt = Math.min(deltaTime, 0.1);

    // --- Camera shake on heavy combat hits ---
    if (this._shakeIntensity && this._shakeIntensity > 0.001) {
      const elapsed = performance.now() - (this._shakeStartTime || 0);
      const duration = this._shakeDuration || 180;
      if (elapsed >= duration) {
        this._shakeIntensity = 0;
        this._shakeOffsetX = 0;
        this._shakeOffsetY = 0;
        this._shakeOffsetZ = 0;
      } else {
        // Decaying random offset
        const decay = 1 - elapsed / duration;
        const mag = this._shakeIntensity * decay;
        this._shakeOffsetX = (Math.random() - 0.5) * mag;
        this._shakeOffsetY = (Math.random() - 0.5) * mag * 0.4;
        this._shakeOffsetZ = (Math.random() - 0.5) * mag;
      }
    } else {
      this._shakeOffsetX = 0;
      this._shakeOffsetY = 0;
      this._shakeOffsetZ = 0;
    }

    // --- Cinematic zoom (boss room) ---
    if (this._cinematicState) {
      const t = (performance.now() - this._cinematicState.startTime) / this._cinematicState.duration;
      if (t >= 1) {
        this.distance = this._cinematicState.endDist;
        this.pitchAngle = this._cinematicState.endPitch;
        this._cinematicState = null;
      } else {
        // Ease in-out: 0..0.4 zoom in, 0.4..0.8 hold, 0.8..1 ease back out
        let progress;
        if (t < 0.4) {
          progress = t / 0.4;
        } else if (t < 0.8) {
          progress = 1;
        } else {
          progress = 1 - (t - 0.8) / 0.2;
        }
        const ease = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        const startDist = this._cinematicState.startDist;
        const midDist = this._cinematicState.midDist;
        const startPitch = this._cinematicState.startPitch;
        const midPitch = this._cinematicState.midPitch;
        this.distance = startDist + (midDist - startDist) * ease;
        this.pitchAngle = startPitch + (midPitch - startPitch) * ease;
      }
    }

    // --- Action camera: auto-rotate behind character ---
    if (this.autoFollow && !this._rightStickActive && !this.isRightDrag) {
      const behindAngle = this._targetFacing + Math.PI;
      // Faster when moving, gentler when standing (keeps camera stable in combat)
      const speed = this._targetMoving ? 6 : 3;
      this.rotationAngle = this._lerpAngle(this.rotationAngle, behindAngle, this._damp(speed, dt));
    }

    // --- Collision-aware distance (cached — only raycast every 30ms) ---
    // SKIPPED in dungeon mode — user reported "random camera zoom-in" which
    // was this collision raycast snapping the camera close when any prop
    // (wall, pillar, statue) sat between the camera and player. In dungeon
    // overhead view the camera is high enough that wall clipping isn't an
    // issue, so the collision check causes more grief than it solves.
    let useDist = this.distance;
    const now = performance.now();
    if (!this._dungeonMode && this.collisionObjects.length > 0 && (now - (this._lastCollisionCheck || 0) > 30 || this._collisionDist < this.distance * 0.9)) {
      this._lastCollisionCheck = now;
      this._computeIdealPos(this.distance);
      this._dir.copy(this._idealPos).sub(this.target).normalize();
      this.raycaster.set(this.target, this._dir);
      this.raycaster.far = this.distance + 1;
      const hits = this.raycaster.intersectObjects(this.collisionObjects, true);
      if (hits.length > 0 && hits[0].distance < this.distance) {
        const hitDist = Math.max(2, hits[0].distance - 0.5);
        // Snap inward fast to avoid clipping
        if (hitDist < this._collisionDist) {
          this._collisionDist = hitDist;
        }
        useDist = Math.min(this.distance, this._collisionDist);
      } else {
        // Smoothly recover to full distance when clear
        this._collisionDist += (this.distance - this._collisionDist) * this._damp(4, dt);
        useDist = this._collisionDist;
      }
    } else if (this.collisionObjects.length > 0) {
      // Between raycast checks, use cached collision distance
      useDist = Math.min(this.distance, this._collisionDist);
    }

    // --- Compute ideal position (pure spherical) ---
    this._computeIdealPos(useDist);

    // --- Smooth position follow (frame-rate independent) ---
    this.currentPos.lerp(this._idealPos, this._damp(12, dt));

    // --- Screen shake ---
    this._shakeVec.set(0, 0, 0);
    if (this.shakeTimer > 0) {
      const t = this.shakeTimer / this.shakeDuration;
      const decay = t * t;
      const intensity = this.shakeIntensity * decay;
      this._shakeVec.set(
        (Math.random() - 0.5) * 2 * intensity,
        (Math.random() - 0.5) * 1.5 * intensity,
        (Math.random() - 0.5) * intensity
      );
      this.shakeTimer -= dt;
    }

    // --- Apply to camera (combine ability-shake vec + combat-juice shake) ---
    this.camera.position.copy(this.currentPos).add(this._shakeVec);
    if (this._shakeOffsetX || this._shakeOffsetY || this._shakeOffsetZ) {
      this.camera.position.x += this._shakeOffsetX || 0;
      this.camera.position.y += this._shakeOffsetY || 0;
      this.camera.position.z += this._shakeOffsetZ || 0;
    }
    this.camera.lookAt(this.target);

    // --- FOV animation ---
    if (Math.abs(this.camera.fov - this.fovTarget) > 0.1) {
      this.camera.fov += (this.fovTarget - this.camera.fov) * this._damp(5, dt);
      this.camera.updateProjectionMatrix();
    }
    if (this.fovTarget !== this.fovBase) {
      this.fovTarget += (this.fovBase - this.fovTarget) * (this._fovReturnSpeed || 0.02);
      if (Math.abs(this.fovTarget - this.fovBase) < 0.5) this.fovTarget = this.fovBase;
    }
  }

  /**
   * Apply right-stick gamepad rotation to camera.
   */
  applyGamepadRotation(rx, ry, sensitivity = 1.0, deltaTime) {
    this._rightStickActive = (rx !== 0 || ry !== 0);
    this.rotationAngle -= rx * 0.04 * sensitivity;
    this.pitchAngle = Math.max(-1.2, Math.min(0.05, this.pitchAngle - ry * 0.03 * sensitivity));
  }

  /**
   * Apply D-pad zoom to camera distance.
   */
  applyGamepadZoom(zoom, deltaTime) {
    this.distance += zoom * 15 * deltaTime;
    this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance));
  }

  /**
   * Attach mouse event listeners.
   */
  attachEvents(_element) {
    if (InputManager.isMobile()) return; // Touch controls handle camera on mobile
    window.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('wheel', (e) => this.onWheel(e));
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}
