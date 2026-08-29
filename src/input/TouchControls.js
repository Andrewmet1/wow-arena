/**
 * Mobile touch input system — virtual joystick, camera drag, pinch zoom.
 * Only instantiated when InputManager.isMobile() is true.
 * On desktop this file is imported but never constructed.
 */
export class TouchControls {
  /**
   * @param {import('./InputManager').InputManager} inputManager
   * @param {import('../rendering/CameraController').CameraController} cameraController
   */
  constructor(inputManager, cameraController) {
    this._input = inputManager;
    this._camera = cameraController;

    // Joystick state
    this._joystickTouchId = null;
    this._joystickOrigin = null;   // { x, y } screen coords where touch started
    const smallScreen = window.innerHeight < 400;
    this._joystickSize = smallScreen ? 90 : 110;
    this._joystickRadius = this._joystickSize / 2;
    this._deadZone = 0.15;         // 15% of radius

    // Camera drag state
    this._cameraTouchId = null;
    this._cameraLastPos = null;    // { x, y }
    this._cameraSensitivity = 1.0;

    // Pinch zoom state
    this._pinchTouchIds = [];      // [id1, id2]
    this._pinchStartDist = 0;
    this._pinchStartCamDist = 0;

    // Target tap detection
    this._tapStart = null;         // { x, y, time }
    this._tapTimeout = null;

    // Swipe detection on joystick area
    this._joystickTouchStart = null; // { x, y, time }

    // DOM elements
    this._overlay = null;          // Container for all touch UI
    this._joystickRing = null;
    this._joystickNub = null;

    // Bound handlers
    this._onTouchStart = this._handleTouchStart.bind(this);
    this._onTouchMove = this._handleTouchMove.bind(this);
    this._onTouchEnd = this._handleTouchEnd.bind(this);

    this._enabled = false;
    this._lastFrameTime = performance.now();
  }

  /** Set camera drag sensitivity (from settings) */
  setSensitivity(val) {
    this._cameraSensitivity = val;
  }

  /** Attach listeners and show joystick overlay */
  enable() {
    if (this._enabled) return;
    this._enabled = true;

    this._createOverlay();

    document.addEventListener('touchstart', this._onTouchStart, { passive: false });
    document.addEventListener('touchmove', this._onTouchMove, { passive: false });
    document.addEventListener('touchend', this._onTouchEnd, { passive: false });
    document.addEventListener('touchcancel', this._onTouchEnd, { passive: false });
  }

  /** Remove listeners and hide overlay */
  disable() {
    if (!this._enabled) return;
    this._enabled = false;

    document.removeEventListener('touchstart', this._onTouchStart);
    document.removeEventListener('touchmove', this._onTouchMove);
    document.removeEventListener('touchend', this._onTouchEnd);
    document.removeEventListener('touchcancel', this._onTouchEnd);

    this._resetJoystick();
    this._cameraTouchId = null;
    this._cameraLastPos = null;
    this._pinchTouchIds = [];

    if (this._overlay) {
      this._overlay.style.display = 'none';
    }
  }

  /** Full cleanup */
  destroy() {
    this.disable();
    if (this._overlay && this._overlay.parentNode) {
      this._overlay.parentNode.removeChild(this._overlay);
    }
    this._overlay = null;
    this._joystickRing = null;
    this._joystickNub = null;
  }

  // ─── DOM ───────────────────────────────────────────────

  _createOverlay() {
    if (this._overlay) {
      this._overlay.style.display = '';
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'touch-controls-overlay';
    Object.assign(overlay.style, {
      position: 'fixed',
      top: '0', left: '0', right: '0', bottom: '0',
      pointerEvents: 'none',
      zIndex: '900',
    });

    // Joystick ring (visible at rest as a subtle hint)
    const sz = this._joystickSize;
    const ring = document.createElement('div');
    Object.assign(ring.style, {
      position: 'absolute',
      bottom: (sz < 100 ? 50 : 80) + 'px', left: '20px',
      width: sz + 'px', height: sz + 'px',
      borderRadius: '50%',
      border: '2px solid rgba(200,180,140,0.25)',
      background: 'rgba(0,0,0,0.15)',
      display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none',
      transition: 'opacity 0.2s',
    });

    // Joystick nub (inner circle)
    const nubSz = sz < 100 ? 36 : 44;
    const nub = document.createElement('div');
    Object.assign(nub.style, {
      width: nubSz + 'px', height: nubSz + 'px',
      borderRadius: '50%',
      background: 'rgba(200,180,140,0.4)',
      border: '1px solid rgba(200,180,140,0.5)',
      pointerEvents: 'none',
      transition: 'transform 0.05s',
    });

    ring.appendChild(nub);
    overlay.appendChild(ring);

    // Dodge-roll button — sits flush to the left of the mobile ability bar
    // so the right thumb can roll without leaving the ability cluster.
    // Styled to read as a 7th ability slot: same bg art, same conic-gradient
    // cooldown sweep, same gold timer text the abilities use.
    //
    // The mobile ability bar is anchored bottom-right (right:12, bottom:12)
    // and is 3 cols × 62px + 2×4px gap + 2×6px padding = ~206px wide. We sit
    // just to the left of that footprint, vertically aligned with its bottom.
    const dodgeBtn = document.createElement('div');
    dodgeBtn.id = 'touch-dodge-btn';
    Object.assign(dodgeBtn.style, {
      position: 'absolute',
      right: 'calc(218px + env(safe-area-inset-right, 0px))',
      bottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
      width: '62px', height: '66px',
      background: "url('/assets/art/hud/ability_slot_bg.png') center/100% 100% no-repeat",
      borderRadius: '5px',
      pointerEvents: 'auto',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      WebkitTapHighlightColor: 'transparent',
      touchAction: 'manipulation',
      transition: 'transform 0.08s',
      overflow: 'hidden',
    });

    // Icon glyph (idle state) — minimal swirl ↻ + small "ROLL" caption beneath
    const dodgeIcon = document.createElement('div');
    Object.assign(dodgeIcon.style, {
      position: 'absolute', inset: '0',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none',
      color: 'rgba(230,210,170,0.95)',
      fontFamily: '"Cinzel", serif',
      textShadow: '0 1px 2px rgba(0,0,0,0.9)',
    });
    const dodgeGlyph = document.createElement('div');
    Object.assign(dodgeGlyph.style, {
      fontSize: '26px',
      lineHeight: '1',
      fontWeight: '700',
      transform: 'rotate(-15deg)',
    });
    dodgeGlyph.textContent = '↻';
    const dodgeCaption = document.createElement('div');
    Object.assign(dodgeCaption.style, {
      fontSize: '9px',
      letterSpacing: '1.5px',
      fontWeight: '700',
      marginTop: '2px',
    });
    dodgeCaption.textContent = 'ROLL';
    dodgeIcon.appendChild(dodgeGlyph);
    dodgeIcon.appendChild(dodgeCaption);

    // Conic-gradient cooldown sweep — same visual as the real ability slots
    const dodgeCdSweep = document.createElement('div');
    Object.assign(dodgeCdSweep.style, {
      position: 'absolute', inset: '0',
      pointerEvents: 'none',
      opacity: '0',
      zIndex: '2',
    });
    // Gold seconds text overlay
    const dodgeCdText = document.createElement('div');
    Object.assign(dodgeCdText.style, {
      position: 'absolute', inset: '0',
      display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: '"Cinzel", serif',
      fontSize: '14px',
      fontWeight: '800',
      color: '#ffd700',
      textShadow: '0 0 4px rgba(0,0,0,1)',
      zIndex: '3',
      opacity: '0',
      pointerEvents: 'none',
    });

    dodgeBtn.appendChild(dodgeIcon);
    dodgeBtn.appendChild(dodgeCdSweep);
    dodgeBtn.appendChild(dodgeCdText);

    const onDodgePress = (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Skip if currently on cooldown (visual feedback only — engine validates too)
      if (this._dodgeOnCd) {
        dodgeBtn.style.transform = 'scale(0.96)';
        setTimeout(() => { dodgeBtn.style.transform = ''; }, 80);
        return;
      }
      const im = this._input;
      let dir = 'w';
      if (im.moveLeft)            dir = 'a';
      else if (im.moveRight)      dir = 'd';
      else if (im.moveBackward)   dir = 's';
      else if (im.moveForward)    dir = 'w';
      im.dodgeRollDirection = dir;
      im.dodgeRollQueued = true;
      dodgeBtn.style.transform = 'scale(0.92)';
      setTimeout(() => { dodgeBtn.style.transform = ''; }, 120);
    };
    dodgeBtn.addEventListener('touchstart', onDodgePress, { passive: false });
    dodgeBtn.addEventListener('mousedown', onDodgePress);
    overlay.appendChild(dodgeBtn);

    this._dodgeBtn = dodgeBtn;
    this._dodgeIcon = dodgeIcon;
    this._dodgeCdSweep = dodgeCdSweep;
    this._dodgeCdText = dodgeCdText;
    this._dodgeOnCd = false;

    document.body.appendChild(overlay);

    this._overlay = overlay;
    this._joystickRing = ring;
    this._joystickNub = nub;
  }

  /**
   * Update the dodge button's cooldown overlay.
   * Called every frame from main.js render loop.
   * @param {number} remainingTicks — ticks left on cd (0 = ready)
   * @param {number} totalTicks — total cd duration for the fill calculation
   * @param {boolean} isDodging — true while the roll is actually playing
   */
  setDodgeCooldown(remainingTicks, totalTicks, isDodging) {
    if (!this._dodgeBtn) return;
    if (isDodging || remainingTicks > 0) {
      this._dodgeOnCd = true;
      const pct = isDodging
        ? 1
        : Math.min(1, remainingTicks / Math.max(1, totalTicks));
      const degrees = Math.round(pct * 360);
      // Conic sweep matching ability-cooldown-sweep visual
      this._dodgeCdSweep.style.background =
        `conic-gradient(rgba(0,0,0,0.7) ${degrees}deg, transparent ${degrees}deg)`;
      this._dodgeCdSweep.style.opacity = '0.6';
      // Hide idle icon, show seconds (only if not the brief dodge-active state)
      this._dodgeIcon.style.opacity = '0';
      if (!isDodging) {
        this._dodgeCdText.textContent = Math.ceil(remainingTicks / 10);
        this._dodgeCdText.style.opacity = '1';
      } else {
        this._dodgeCdText.style.opacity = '0';
      }
    } else {
      this._dodgeOnCd = false;
      this._dodgeCdSweep.style.opacity = '0';
      this._dodgeCdText.style.opacity = '0';
      this._dodgeIcon.style.opacity = '1';
    }
  }

  // ─── Touch handlers ────────────────────────────────────

  _handleTouchStart(e) {
    // Don't intercept touches on HUD ability slots or UI overlay buttons
    if (e.target.closest && e.target.closest('.ability-slot, .mobile-ability-slot, button, a, input, #touch-dodge-btn')) return;

    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const x = t.clientX;
      const y = t.clientY;
      const screenW = window.innerWidth;
      const screenH = window.innerHeight;

      // Left 35% of screen → joystick zone
      if (x < screenW * 0.35 && y > screenH * 0.35 && this._joystickTouchId === null) {
        this._joystickTouchId = t.identifier;
        this._joystickOrigin = { x, y };
        this._joystickTouchStart = { x, y, time: performance.now() };

        // Move joystick ring to touch position
        const half = this._joystickRadius;
        this._joystickRing.style.left = (x - half) + 'px';
        this._joystickRing.style.bottom = 'auto';
        this._joystickRing.style.top = (y - half) + 'px';
        this._joystickRing.style.border = '2px solid rgba(200,180,140,0.5)';
        this._joystickNub.style.transform = 'translate(0px, 0px)';

        e.preventDefault();
      }
      // Right portion → camera drag zone (if not already tracking camera)
      else if (this._cameraTouchId === null && this._pinchTouchIds.length === 0) {
        // Check if a second finger in camera zone → start pinch
        if (this._cameraTouchId !== null) {
          // Upgrade to pinch
          this._startPinch(this._cameraTouchId, t.identifier, e.touches);
          e.preventDefault();
          continue;
        }

        this._cameraTouchId = t.identifier;
        this._cameraLastPos = { x, y };
        this._tapStart = { x, y, time: performance.now() };
        e.preventDefault();
      }
      // Second touch in camera area → pinch zoom
      else if (this._cameraTouchId !== null && this._pinchTouchIds.length === 0) {
        this._startPinch(this._cameraTouchId, t.identifier, e.touches);
        e.preventDefault();
      }
    }
  }

  _handleTouchMove(e) {
    const now = performance.now();
    const dt = Math.min((now - this._lastFrameTime) / 1000, 0.05);
    this._lastFrameTime = now;

    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];

      // Joystick
      if (t.identifier === this._joystickTouchId && this._joystickOrigin) {
        const dx = t.clientX - this._joystickOrigin.x;
        const dy = t.clientY - this._joystickOrigin.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxDist = this._joystickRadius;

        // Clamp to radius
        const clampedDist = Math.min(dist, maxDist);
        const angle = Math.atan2(dy, dx);
        const cx = Math.cos(angle) * clampedDist;
        const cy = Math.sin(angle) * clampedDist;

        // Update nub visual position
        this._joystickNub.style.transform = `translate(${cx}px, ${cy}px)`;

        // Normalize to -1..1
        const nx = clampedDist > 0 ? cx / maxDist : 0;
        const ny = clampedDist > 0 ? cy / maxDist : 0;

        // Apply dead zone
        const magnitude = Math.sqrt(nx * nx + ny * ny);
        if (magnitude < this._deadZone) {
          this._input.setMobileMovement(0, 0);
        } else {
          // Map joystick: +x = right, +y = down → forward is -y
          this._input.setMobileMovement(nx, ny);
        }

        e.preventDefault();
      }

      // Pinch zoom
      if (this._pinchTouchIds.length === 2) {
        if (t.identifier === this._pinchTouchIds[0] || t.identifier === this._pinchTouchIds[1]) {
          this._updatePinch(e.touches, dt);
          e.preventDefault();
        }
        continue;
      }

      // Camera drag
      if (t.identifier === this._cameraTouchId && this._cameraLastPos) {
        const dx = t.clientX - this._cameraLastPos.x;
        const dy = t.clientY - this._cameraLastPos.y;

        // If moved enough, cancel tap
        if (this._tapStart) {
          const tapDx = t.clientX - this._tapStart.x;
          const tapDy = t.clientY - this._tapStart.y;
          if (Math.abs(tapDx) > 10 || Math.abs(tapDy) > 10) {
            this._tapStart = null;
          }
        }

        this._camera.applyGamepadRotation(
          dx * 0.15,
          dy * 0.15,
          this._cameraSensitivity,
          dt
        );

        this._cameraLastPos = { x: t.clientX, y: t.clientY };
        e.preventDefault();
      }
    }
  }

  _handleTouchEnd(e) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];

      // Joystick release
      if (t.identifier === this._joystickTouchId) {
        // Swipe detection before resetting
        if (this._joystickTouchStart) {
          const elapsed = performance.now() - this._joystickTouchStart.time;
          const dx = t.clientX - this._joystickTouchStart.x;
          const dy = t.clientY - this._joystickTouchStart.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          // Quick flick (< 200ms, > 40px) → dodge roll
          if (elapsed < 200 && dist > 40) {
            const absDx = Math.abs(dx);
            const absDy = Math.abs(dy);
            if (absDy > absDx && dy < 0) {
              // Swipe up → jump
              this._input.jumpPressed = true;
            } else {
              // Directional flick → dodge roll
              if (absDx > absDy) {
                this._input.dodgeRollDirection = dx > 0 ? 'd' : 'a';
              } else {
                this._input.dodgeRollDirection = dy > 0 ? 's' : 'w';
              }
              this._input.dodgeRollQueued = true;
            }
          }
          this._joystickTouchStart = null;
        }

        this._resetJoystick();
      }

      // Camera release
      if (t.identifier === this._cameraTouchId) {
        // Check for tap → target
        if (this._tapStart) {
          const elapsed = performance.now() - this._tapStart.time;
          if (elapsed < 300) {
            // Queue as click for ray-cast targeting
            this._input.clickQueue.push({
              x: (this._tapStart.x / window.innerWidth) * 2 - 1,
              y: -(this._tapStart.y / window.innerHeight) * 2 + 1,
            });
          }
          this._tapStart = null;
        }

        this._cameraTouchId = null;
        this._cameraLastPos = null;
      }

      // Pinch release
      const pinchIdx = this._pinchTouchIds.indexOf(t.identifier);
      if (pinchIdx !== -1) {
        this._pinchTouchIds = [];
        // Downgrade: remaining touch becomes camera drag
        for (let j = 0; j < e.touches.length; j++) {
          const remaining = e.touches[j];
          if (remaining.identifier !== t.identifier) {
            this._cameraTouchId = remaining.identifier;
            this._cameraLastPos = { x: remaining.clientX, y: remaining.clientY };
            break;
          }
        }
      }
    }
  }

  // ─── Joystick helpers ──────────────────────────────────

  _resetJoystick() {
    this._joystickTouchId = null;
    this._joystickOrigin = null;
    this._input.setMobileMovement(0, 0);

    // Reset visual
    if (this._joystickRing) {
      this._joystickRing.style.left = '20px';
      this._joystickRing.style.top = 'auto';
      this._joystickRing.style.bottom = (this._joystickSize < 100 ? 50 : 80) + 'px';
      this._joystickRing.style.border = '2px solid rgba(200,180,140,0.25)';
    }
    if (this._joystickNub) {
      this._joystickNub.style.transform = 'translate(0px, 0px)';
    }
  }

  // ─── Pinch helpers ─────────────────────────────────────

  _startPinch(id1, id2, touchList) {
    this._pinchTouchIds = [id1, id2];
    this._cameraTouchId = null;
    this._cameraLastPos = null;

    const t1 = this._findTouch(touchList, id1);
    const t2 = this._findTouch(touchList, id2);
    if (t1 && t2) {
      const dx = t2.clientX - t1.clientX;
      const dy = t2.clientY - t1.clientY;
      this._pinchStartDist = Math.sqrt(dx * dx + dy * dy);
      this._pinchStartCamDist = this._camera.distance;
    }
  }

  _updatePinch(touchList, dt) {
    const t1 = this._findTouch(touchList, this._pinchTouchIds[0]);
    const t2 = this._findTouch(touchList, this._pinchTouchIds[1]);
    if (!t1 || !t2 || this._pinchStartDist === 0) return;

    const dx = t2.clientX - t1.clientX;
    const dy = t2.clientY - t1.clientY;
    const currentDist = Math.sqrt(dx * dx + dy * dy);

    const scale = this._pinchStartDist / currentDist; // >1 = pinch in = zoom out
    this._camera.distance = Math.max(
      this._camera.minDistance,
      Math.min(this._camera.maxDistance, this._pinchStartCamDist * scale)
    );
  }

  _findTouch(touchList, id) {
    for (let i = 0; i < touchList.length; i++) {
      if (touchList[i].identifier === id) return touchList[i];
    }
    return null;
  }
}
