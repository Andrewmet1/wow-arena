import { Vec3 } from '../utils/Vec3.js';
import {
  MOVE_SPEED_PER_TICK, BASE_MOVE_SPEED, TICKS_PER_SECOND,
  DODGE_ROLL_DISTANCE, DODGE_ROLL_DURATION, DODGE_ROLL_COOLDOWN, DODGE_ROLL_IMMUNITY
} from '../constants.js';

export class MovementSystem {
  constructor(lineOfSight) {
    this.los = lineOfSight;
  }

  /**
   * Process movement for a unit during one tick
   */
  moveUnit(unit) {
    if (!unit.canMove) return false;
    if (!unit.moveTarget) return false;

    // Cancel cast if moving (unless ability allows it)
    if (unit.isCasting) {
      const ability = unit.castState?.ability;
      if (!ability?.flags?.includes('usable_while_moving')) {
        unit.cancelCast();
      }
    }

    const speed = this.getEffectiveSpeed(unit);
    const direction = unit.position.directionTo(unit.moveTarget);
    const distToTarget = unit.position.distanceXZ(unit.moveTarget);

    if (distToTarget < speed) {
      // Arrived
      unit.position.x = unit.moveTarget.x;
      unit.position.z = unit.moveTarget.z;
      unit.moveTarget = null;
    } else {
      // Move toward target
      unit.position.x += direction.x * speed;
      unit.position.z += direction.z * speed;
    }

    // Resolve collisions with pillars
    const resolved = this.los.resolveCollision(unit.position);
    unit.position.x = resolved.x;
    unit.position.z = resolved.z;

    // Clamp to arena bounds
    const clamped = this.los.clampToBounds(unit.position);
    unit.position.x = clamped.x;
    unit.position.z = clamped.z;

    // Update facing toward move direction
    if (direction.length() > 0) {
      unit.facing = Math.atan2(direction.x, direction.z);
    }

    return true;
  }

  /**
   * Move a unit toward a target unit (for melee chasing)
   */
  moveToward(unit, targetUnit, desiredRange = 3) {
    const dist = unit.distanceTo(targetUnit);
    if (dist <= desiredRange) {
      unit.moveTarget = null;
      return;
    }

    const direction = unit.position.directionTo(targetUnit.position);
    const targetPos = targetUnit.position.sub(direction.scale(desiredRange));
    unit.moveTarget = targetPos;
  }

  /**
   * Move a unit away from a target (for kiting)
   */
  moveAway(unit, targetUnit, desiredRange = 28) {
    const direction = targetUnit.position.directionTo(unit.position);
    const targetPos = unit.position.add(direction.scale(5));

    // Clamp to arena
    const clamped = this.los.clampToBounds(targetPos);
    unit.moveTarget = new Vec3(clamped.x, 0, clamped.z);
  }

  /**
   * Move to a specific world position
   */
  moveTo(unit, position) {
    unit.moveTarget = position.clone ? position.clone() : new Vec3(position.x, 0, position.z);
  }

  /**
   * Stop movement
   */
  stop(unit) {
    unit.moveTarget = null;
  }

  /**
   * Get effective movement speed in yards per tick
   */
  getEffectiveSpeed(unit) {
    return (BASE_MOVE_SPEED * unit.getEffectiveMoveSpeed()) / TICKS_PER_SECOND;
  }

  /**
   * Calculate how many ticks to reach a position
   */
  ticksToReach(unit, targetPos) {
    const dist = unit.position.distanceXZ(targetPos);
    const speed = this.getEffectiveSpeed(unit);
    if (speed <= 0) return Infinity;
    return Math.ceil(dist / speed);
  }

  /**
   * Start a dodge roll in the specified direction
   * @param {Unit} unit
   * @param {string} directionKey - 'w', 'a', 's', or 'd'
   * @param {number} currentTick
   * @param {number} cameraAngle - camera rotation angle in radians
   * @returns {boolean} true if dodge roll was started
   */
  startDodgeRoll(unit, directionKey, currentTick, cameraAngle) {
    if (currentTick < unit.dodgeRollCooldownEndTick) return false;
    if (!unit.canMove) return false;
    if (unit.dodgeRollState) return false;

    // Convert WASD key to direction vector relative to camera
    let dx = 0, dz = 0;
    if (directionKey === 'w') dz = -1;
    if (directionKey === 's') dz = 1;
    if (directionKey === 'a') dx = -1;
    if (directionKey === 'd') dx = 1;

    // Rotate by camera angle
    const cos = Math.cos(cameraAngle || 0);
    const sin = Math.sin(cameraAngle || 0);
    const rx = dx * cos + dz * sin;
    const rz = -dx * sin + dz * cos;
    const len = Math.sqrt(rx * rx + rz * rz) || 1;

    const direction = { x: rx / len, z: rz / len };

    unit.dodgeRollState = {
      startTick: currentTick,
      endTick: currentTick + DODGE_ROLL_DURATION,
      immunityEndTick: currentTick + DODGE_ROLL_IMMUNITY,
      direction
    };
    unit.dodgeRollCooldownEndTick = currentTick + DODGE_ROLL_COOLDOWN;
    unit.dodgeImmune = true;

    // Set move target for the roll
    const rollDist = DODGE_ROLL_DISTANCE;
    const targetX = unit.position.x + direction.x * rollDist;
    const targetZ = unit.position.z + direction.z * rollDist;

    // Clamp to arena bounds (slightly inside wall)
    const dist = Math.sqrt(targetX * targetX + targetZ * targetZ);
    const ARENA_RADIUS = 38;
    if (dist > ARENA_RADIUS) {
      const scale = ARENA_RADIUS / dist;
      unit.moveTarget = new Vec3(targetX * scale, 0, targetZ * scale);
    } else {
      unit.moveTarget = new Vec3(targetX, 0, targetZ);
    }

    return true;
  }

  /**
   * Strafe around a target (perpendicular movement)
   */
  strafe(unit, targetUnit, clockwise = true) {
    const direction = unit.position.directionTo(targetUnit.position);
    const perpAngle = clockwise ? -Math.PI / 2 : Math.PI / 2;
    const strafeDir = direction.rotateY(perpAngle);
    const targetPos = unit.position.add(strafeDir.scale(3));
    const clamped = this.los.clampToBounds(targetPos);
    unit.moveTarget = new Vec3(clamped.x, 0, clamped.z);
  }
}
