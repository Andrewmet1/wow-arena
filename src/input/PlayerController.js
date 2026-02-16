import { Vec3 } from '../utils/Vec3.js';
import { BASE_MOVE_SPEED, TICKS_PER_SECOND } from '../constants.js';

/**
 * Player controller — bridges InputManager to the game engine.
 * Implements the same decide() interface as AIController.
 *
 * WoW-style controls:
 *   Right-click drag  = rotate camera + character faces camera direction
 *   Left click         = target selection
 *   Both buttons held  = move forward in camera direction
 *   A/D (no rmb)       = turn character left/right
 *   A/D (rmb held)     = strafe left/right
 *   W/S                = move forward/backward (camera-relative)
 */
export class PlayerController {
  constructor(unitId, inputManager, cameraController) {
    this.unitId = unitId;
    this.input = inputManager;
    this.camera = cameraController;
    this.currentTarget = null;

  }

  /**
   * Called every game tick by the GameLoop
   */
  decide(matchState, engine, currentTick) {
    const unit = matchState.getUnit(this.unitId);
    if (!unit || !unit.isAlive) return;

    // Tab target cycling
    if (this.input.consumeTab()) {
      this.cycleTarget(matchState);
    }

    // Ensure we have a valid target
    if (!this.currentTarget || !matchState.getUnit(this.currentTarget)?.isAlive) {
      const enemies = matchState.getEnemies(this.unitId);
      this.currentTarget = enemies.length > 0 ? enemies[0].id : null;
      if (this.currentTarget) {
        matchState.setTarget(this.unitId, this.currentTarget);
      }
    }

    const enemy = this.currentTarget ? matchState.getUnit(this.currentTarget) : matchState.getOpponent(this.unitId);

    // Process ability inputs
    const abilities = this.input.consumeAbilities();
    for (const abilityId of abilities) {
      engine.queueAbility(this.unitId, abilityId, enemy?.id);
    }

    // Process movement
    if (unit.canMove) {
      const cameraAngle = this.camera?.rotationAngle || 0;

      // WASD movement (A/D always strafe, camera-relative)
      let dir = this.input.getMovementDirection(cameraAngle);

      // WoW-style: both mouse buttons held = move forward in camera direction
      if (!dir && this.camera?.bothButtonsHeld) {
        const forwardAngle = cameraAngle + Math.PI;
        dir = { x: Math.sin(forwardAngle), z: Math.cos(forwardAngle) };
      }

      if (dir) {
        // Movement cancels channels (like WoW drain life)
        if (unit.isChanneling) {
          unit.cancelChannel();
        }
        // Don't move while hard-casting (non-instant abilities)
        if (!unit.isCasting) {
          const speed = (BASE_MOVE_SPEED * unit.getEffectiveMoveSpeed()) / TICKS_PER_SECOND;
          const targetPos = new Vec3(
            unit.position.x + dir.x * speed * 5,
            0,
            unit.position.z + dir.z * speed * 5
          );
          engine.movement.moveTo(unit, targetPos);
        }
      } else if (!unit.isCasting && !unit.isChanneling) {
        engine.movement.stop(unit);
      }

      // Right-click drag: character faces camera direction
      if (this.camera?.isRightDrag) {
        unit.facing = this.camera.cameraFacingAngle;
      }
    }

    // Face enemy when not moving and not right-click steering
    if (enemy && !unit.isMoving && !(this.camera?.isRightDrag)) {
      unit.faceTarget(enemy);
    }
  }

  /**
   * Cycle to next alive enemy target
   */
  cycleTarget(matchState) {
    const enemies = matchState.getEnemies(this.unitId);
    if (enemies.length === 0) return;

    if (!this.currentTarget) {
      this.currentTarget = enemies[0].id;
    } else {
      const currentIdx = enemies.findIndex(e => e.id === this.currentTarget);
      const nextIdx = (currentIdx + 1) % enemies.length;
      this.currentTarget = enemies[nextIdx].id;
    }

    matchState.setTarget(this.unitId, this.currentTarget);
  }
}
