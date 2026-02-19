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

    // Custom control bindings (action -> key)
    this._controls = {
      moveForward: 'w',
      moveBackward: 's',
      moveLeft: 'a',
      moveRight: 'd',
      jump: ' ',
      dodge: 'shift',
      tabTarget: 'tab',
    };
    // Reverse lookup (key -> action) built from _controls
    this._controlKeyMap = new Map();
    this._buildControlKeyMap();

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

    // Gamepad state
    this.gamepadConnected = false;
    this.gamepadIndex = -1;
    this._gpPrevButtons = new Array(17).fill(false);
    this._gpRightStick = { x: 0, y: 0 };
    this._inputMode = 'keyboard'; // 'keyboard' | 'gamepad'

    this._boundKeyDown = this._onKeyDown.bind(this);
    this._boundKeyUp = this._onKeyUp.bind(this);
    this._boundMouseDown = this._onMouseDown.bind(this);
    this._boundMouseUp = this._onMouseUp.bind(this);
    this._boundMouseMove = this._onMouseMove.bind(this);

    // Gamepad connection events
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadConnected = true;
      this.gamepadIndex = e.gamepad.index;
      this._inputMode = 'gamepad';
      console.log(`Gamepad connected: ${e.gamepad.id}`);
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (e.gamepad.index === this.gamepadIndex) {
        this.gamepadConnected = false;
        this.gamepadIndex = -1;
        this._inputMode = 'keyboard';
        this._gpRightStick = { x: 0, y: 0 };
        console.log('Gamepad disconnected');
      }
    });

    // Polling fallback — gamepadconnected event is unreliable on some systems
    this._gamepadPollInterval = setInterval(() => {
      if (this.gamepadConnected) return;
      const gamepads = navigator.getGamepads();
      for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i] && gamepads[i].connected) {
          this.gamepadConnected = true;
          this.gamepadIndex = gamepads[i].index;
          this._inputMode = 'gamepad';
          console.log(`Gamepad detected (poll): ${gamepads[i].id}`);
          break;
        }
      }
    }, 1000);
  }

  /**
   * Update control bindings from a settings object.
   * @param {object} controls - { moveForward, moveBackward, moveLeft, moveRight, jump, dodge, tabTarget }
   */
  setControls(controls) {
    if (!controls) return;
    Object.assign(this._controls, controls);
    this._buildControlKeyMap();
  }

  _buildControlKeyMap() {
    this._controlKeyMap.clear();
    for (const [action, key] of Object.entries(this._controls)) {
      this._controlKeyMap.set(key.toLowerCase(), action);
    }
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
    this._inputMode = 'keyboard';
    const key = e.key.toLowerCase();
    this.keys.set(key, true);

    // Resolve action from custom control bindings
    const action = this._controlKeyMap.get(key);

    // Movement
    if (action === 'moveForward') this.moveForward = true;
    if (action === 'moveBackward') this.moveBackward = true;
    if (action === 'moveLeft') this.moveLeft = true;
    if (action === 'moveRight') this.moveRight = true;

    // Tab — target cycling
    if (action === 'tabTarget') {
      this.tabPressed = true;
      e.preventDefault();
    }

    // Jump
    if (action === 'jump') {
      this.jumpPressed = true;
      e.preventDefault();
    }

    // Dodge key tracking
    if (action === 'dodge') this.shiftHeld = true;

    // Dodge roll — dodge key + movement key
    const dodgeKey = this._controls.dodge.toLowerCase();
    if (this.keys.get(dodgeKey) && ['moveForward', 'moveBackward', 'moveLeft', 'moveRight'].includes(action)) {
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

    const action = this._controlKeyMap.get(key);

    if (action === 'moveForward') this.moveForward = false;
    if (action === 'moveBackward') this.moveBackward = false;
    if (action === 'moveLeft') this.moveLeft = false;
    if (action === 'moveRight') this.moveRight = false;

    if (action === 'dodge') this.shiftHeld = false;

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

  /**
   * Poll gamepad state each frame. Call before camera update.
   * @param {object} gamepadMapping - Button index -> action name mapping from SettingsManager
   * @param {number} deadzone - Stick deadzone (0-0.4)
   * @returns {{ rightStickX: number, rightStickY: number }} Right stick deltas for camera
   */
  pollGamepad(gamepadMapping, deadzone = 0.15) {
    this._gpRightStick = { x: 0, y: 0 };
    if (!this.gamepadConnected) return this._gpRightStick;

    const gamepads = navigator.getGamepads();
    const gp = gamepads[this.gamepadIndex];
    if (!gp) return this._gpRightStick;

    this._inputMode = 'gamepad';

    // Left stick -> movement (axes 0, 1)
    const lx = Math.abs(gp.axes[0]) > deadzone ? gp.axes[0] : 0;
    const ly = Math.abs(gp.axes[1]) > deadzone ? gp.axes[1] : 0;

    this.moveLeft = lx < -0.3;
    this.moveRight = lx > 0.3;
    this.moveForward = ly < -0.3;
    this.moveBackward = ly > 0.3;

    if (this.onMovementChange) {
      this.onMovementChange({
        forward: this.moveForward,
        backward: this.moveBackward,
        left: this.moveLeft,
        right: this.moveRight
      });
    }

    // Right stick -> camera (axes 2, 3)
    const rx = Math.abs(gp.axes[2]) > deadzone ? gp.axes[2] : 0;
    const ry = Math.abs(gp.axes[3]) > deadzone ? gp.axes[3] : 0;
    this._gpRightStick = { x: rx, y: ry };

    // Button edge detection (trigger on press, not hold)
    for (let i = 0; i < gp.buttons.length && i < 17; i++) {
      const pressed = gp.buttons[i].pressed;
      const wasPressed = this._gpPrevButtons[i];

      if (pressed && !wasPressed) {
        const action = gamepadMapping?.[i];
        if (action) {
          if (action.startsWith('ability_')) {
            const slotIdx = parseInt(action.split('_')[1]) - 1;
            const abilityId = this.keybindings.get(['1','2','3','4','5','6'][slotIdx]);
            if (abilityId) {
              this.abilityQueue.push(abilityId);
              if (this.onAbilityPress) this.onAbilityPress(abilityId);
            }
          } else if (action === 'target' || action === 'tab_target') {
            this.tabPressed = true;
          } else if (action === 'dodge') {
            // Dodge in the direction of left stick, default forward
            if (ly < -0.3) this.dodgeRollDirection = 'w';
            else if (ly > 0.3) this.dodgeRollDirection = 's';
            else if (lx < -0.3) this.dodgeRollDirection = 'a';
            else if (lx > 0.3) this.dodgeRollDirection = 'd';
            else this.dodgeRollDirection = 'w';
            this.dodgeRollQueued = true;
          } else if (action === 'settings') {
            // Emit a custom event for settings toggle
            window.dispatchEvent(new CustomEvent('gamepad-settings'));
          }
        }
      }

      this._gpPrevButtons[i] = pressed;
    }

    return this._gpRightStick;
  }

  /**
   * Get current input mode: 'keyboard' or 'gamepad'
   */
  get inputMode() {
    return this._inputMode;
  }
}
