/**
 * Handles keyboard and mouse input for player-controlled unit.
 * WoW-style: A/D turn character, A/D + right-click = strafe.
 */
export class InputManager {
  constructor() {
    this.keys = new Map(); // key -> isDown
    this.keybindings = new Map(); // key -> abilityId
    this.mousePosition = { x: 0, y: 0 };
    this.mouseButtons = { left: false, right: false, middle: false };

    // Movement keys
    this.moveForward = false;
    this.moveBackward = false;
    this.moveLeft = false;
    this.moveRight = false;

    // Action queue
    this.abilityQueue = [];
    this.moveQueue = null; // { x, z } world position or null
    this.tabPressed = false;

    // Jump
    this.jumpPressed = false;

    // Dodge roll
    this.shiftHeld = false;
    this.dodgeRollQueued = false;
    this.dodgeRollDirection = null;

    // Click-to-target
    this.clickQueue = [];

    // Callbacks
    this.onAbilityPress = null; // (abilityId) => void
    this.onMovementChange = null; // ({ forward, backward, left, right }) => void

    this._boundKeyDown = this._onKeyDown.bind(this);
    this._boundKeyUp = this._onKeyUp.bind(this);
    this._boundMouseDown = this._onMouseDown.bind(this);
    this._boundMouseUp = this._onMouseUp.bind(this);
    this._boundMouseMove = this._onMouseMove.bind(this);
  }

  /**
   * Set default keybindings for a class's ability order
   */
  setKeybindings(abilityOrder) {
    this.keybindings.clear();
    const keys = ['1', '2', '3', '4', '5', '6'];
    for (let i = 0; i < Math.min(abilityOrder.length, keys.length); i++) {
      this.keybindings.set(keys[i], abilityOrder[i]);
    }
  }

  /**
   * Attach event listeners
   */
  attach(element = document) {
    element.addEventListener('keydown', this._boundKeyDown);
    element.addEventListener('keyup', this._boundKeyUp);
    element.addEventListener('mousedown', this._boundMouseDown);
    element.addEventListener('mouseup', this._boundMouseUp);
    element.addEventListener('mousemove', this._boundMouseMove);
  }

  /**
   * Detach event listeners
   */
  detach(element = document) {
    element.removeEventListener('keydown', this._boundKeyDown);
    element.removeEventListener('keyup', this._boundKeyUp);
    element.removeEventListener('mousedown', this._boundMouseDown);
    element.removeEventListener('mouseup', this._boundMouseUp);
    element.removeEventListener('mousemove', this._boundMouseMove);
  }

  _onKeyDown(e) {
    if (e.repeat) return;
    const key = e.key.toLowerCase();
    this.keys.set(key, true);

    // Movement keys (WASD)
    if (key === 'w') this.moveForward = true;
    if (key === 's') this.moveBackward = true;
    if (key === 'a') this.moveLeft = true;
    if (key === 'd') this.moveRight = true;

    // Tab — target cycling
    if (key === 'tab') {
      this.tabPressed = true;
      e.preventDefault();
    }

    // Jump
    if (key === ' ') {
      this.jumpPressed = true;
      e.preventDefault();
    }

    // Shift tracking
    if (key === 'shift') this.shiftHeld = true;

    // Dodge roll — Shift + WASD
    if (e.shiftKey && ['w', 'a', 's', 'd'].includes(key)) {
      this.dodgeRollDirection = key;
      this.dodgeRollQueued = true;
    }

    // Ability keybinds
    const abilityId = this.keybindings.get(e.key);
    if (abilityId) {
      this.abilityQueue.push(abilityId);
      if (this.onAbilityPress) this.onAbilityPress(abilityId);
      e.preventDefault();
    }

    if (this.onMovementChange) {
      this.onMovementChange({
        forward: this.moveForward,
        backward: this.moveBackward,
        left: this.moveLeft,
        right: this.moveRight
      });
    }
  }

  _onKeyUp(e) {
    const key = e.key.toLowerCase();
    this.keys.set(key, false);

    if (key === 'w') this.moveForward = false;
    if (key === 's') this.moveBackward = false;
    if (key === 'a') this.moveLeft = false;
    if (key === 'd') this.moveRight = false;

    if (key === 'shift') this.shiftHeld = false;

    if (this.onMovementChange) {
      this.onMovementChange({
        forward: this.moveForward,
        backward: this.moveBackward,
        left: this.moveLeft,
        right: this.moveRight
      });
    }
  }

  _onMouseDown(e) {
    if (e.button === 0) {
      this.mouseButtons.left = true;
      this._leftClickStart = { x: e.clientX, y: e.clientY };
    }
    if (e.button === 1) this.mouseButtons.middle = true;
    if (e.button === 2) this.mouseButtons.right = true;
  }

  _onMouseUp(e) {
    if (e.button === 0) {
      this.mouseButtons.left = false;
      // Click-to-target: only queue if click (not drag)
      if (this._leftClickStart) {
        const dx = Math.abs(e.clientX - this._leftClickStart.x);
        const dy = Math.abs(e.clientY - this._leftClickStart.y);
        if (dx < 5 && dy < 5) {
          this.clickQueue.push({
            x: (e.clientX / window.innerWidth) * 2 - 1,
            y: -(e.clientY / window.innerHeight) * 2 + 1
          });
        }
        this._leftClickStart = null;
      }
    }
    if (e.button === 1) this.mouseButtons.middle = false;
    if (e.button === 2) this.mouseButtons.right = false;
  }

  _onMouseMove(e) {
    this.mousePosition.x = e.clientX;
    this.mousePosition.y = e.clientY;
  }

  /**
   * Check and consume Tab press for target cycling
   */
  consumeTab() {
    if (this.tabPressed) {
      this.tabPressed = false;
      return true;
    }
    return false;
  }

  /**
   * Get and clear the ability queue
   */
  consumeAbilities() {
    const abilities = [...this.abilityQueue];
    this.abilityQueue = [];
    return abilities;
  }

  /**
   * Check if a key is currently held
   */
  isKeyDown(key) {
    return this.keys.get(key.toLowerCase()) || false;
  }

  /**
   * Check and consume jump press
   */
  consumeJump() {
    const j = this.jumpPressed;
    this.jumpPressed = false;
    return j;
  }

  /**
   * Check and consume dodge roll request
   */
  consumeDodgeRoll() {
    if (!this.dodgeRollQueued) return null;
    this.dodgeRollQueued = false;
    const dir = this.dodgeRollDirection;
    this.dodgeRollDirection = null;
    return dir;
  }

  /**
   * Get and clear click queue for targeting
   */
  consumeClicks() {
    const c = [...this.clickQueue];
    this.clickQueue = [];
    return c;
  }

  /**
   * Get movement direction based on WASD — WoW-style:
   * If rightMouseHeld: A/D = strafe (camera-relative side movement)
   * If not rightMouseHeld: A/D = turn character (no lateral movement, handled by PlayerController)
   * W/S always move forward/backward relative to camera
   */
  getMovementDirection(cameraAngle) {
    let dx = 0;
    let dz = 0;

    if (this.moveForward) dz -= 1;
    if (this.moveBackward) dz += 1;
    if (this.moveLeft) dx -= 1;
    if (this.moveRight) dx += 1;

    if (dx === 0 && dz === 0) return null;

    // Rotate by camera angle so WASD is relative to camera view direction
    const cos = Math.cos(cameraAngle);
    const sin = Math.sin(cameraAngle);
    const rx = dx * cos + dz * sin;
    const rz = -dx * sin + dz * cos;

    const len = Math.sqrt(rx * rx + rz * rz);
    return { x: rx / len, z: rz / len };
  }
}
