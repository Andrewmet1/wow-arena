import { PILLAR_POSITIONS, PILLAR_RADIUS, ARENA_RADIUS } from '../constants.js';

// Staging cell bounds (rectangular areas outside arena gates)
const STAGING_CELLS = [
  { minX: -54, maxX: -41, minZ: -5, maxZ: 5 },  // West cell (player)
  { minX: 41, maxX: 54, minZ: -5, maxZ: 5 },     // East cell (enemy)
];

export class LineOfSight {
  constructor(pillars = null) {
    // Pillars as circles: { x, z, radius }
    this.pillars = pillars || PILLAR_POSITIONS.map(p => ({
      x: p.x,
      z: p.z,
      radius: PILLAR_RADIUS
    }));

    /** When false, units are confined to their staging cell. Set true when gates open. */
    this.gatesOpen = false;
  }

  /**
   * Check if there's line of sight between two positions (XZ plane)
   * Returns true if LoS is clear, false if blocked by a pillar
   */
  hasLineOfSight(posA, posB) {
    for (const pillar of this.pillars) {
      if (this.lineIntersectsCircle(
        posA.x, posA.z,
        posB.x, posB.z,
        pillar.x, pillar.z,
        pillar.radius
      )) {
        return false;
      }
    }
    return true;
  }

  /**
   * Check if a line segment intersects a circle (2D)
   * Uses closest point on line segment to circle center
   */
  lineIntersectsCircle(x1, z1, x2, z2, cx, cz, r) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const fx = x1 - cx;
    const fz = z1 - cz;

    const a = dx * dx + dz * dz;
    const b = 2 * (fx * dx + fz * dz);
    const c = fx * fx + fz * fz - r * r;

    if (a === 0) {
      // Points are the same
      return c <= 0;
    }

    let discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return false;

    discriminant = Math.sqrt(discriminant);
    const t1 = (-b - discriminant) / (2 * a);
    const t2 = (-b + discriminant) / (2 * a);

    // Check if intersection is within the line segment [0, 1]
    if (t1 >= 0 && t1 <= 1) return true;
    if (t2 >= 0 && t2 <= 1) return true;

    // Check if both intersections are outside on the same side
    if (t1 < 0 && t2 < 0) return false;
    if (t1 > 1 && t2 > 1) return false;

    // Segment is inside the circle
    return true;
  }

  /**
   * Find the nearest pillar to a position
   */
  getNearestPillar(pos) {
    let nearest = null;
    let nearestDist = Infinity;

    for (const pillar of this.pillars) {
      const dx = pos.x - pillar.x;
      const dz = pos.z - pillar.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = pillar;
      }
    }

    return { pillar: nearest, distance: nearestDist };
  }

  /**
   * Get a position behind a pillar relative to an enemy position
   * Used by AI for pillar play
   */
  getPillarCoverPosition(pillarPos, enemyPos, standoffDistance = 2) {
    const dx = pillarPos.x - enemyPos.x;
    const dz = pillarPos.z - enemyPos.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len === 0) return { x: pillarPos.x, z: pillarPos.z + standoffDistance };

    // Position on the far side of pillar from enemy
    const nx = dx / len;
    const nz = dz / len;

    return {
      x: pillarPos.x + nx * (PILLAR_RADIUS + standoffDistance),
      z: pillarPos.z + nz * (PILLAR_RADIUS + standoffDistance)
    };
  }

  /**
   * Check if a position is inside the arena bounds
   */
  isInBounds(pos) {
    if (!this.gatesOpen) {
      // During staging, check if in any cell
      for (const cell of STAGING_CELLS) {
        if (pos.x >= cell.minX && pos.x <= cell.maxX && pos.z >= cell.minZ && pos.z <= cell.maxZ) {
          return true;
        }
      }
      return false;
    }
    return (pos.x * pos.x + pos.z * pos.z) <= ARENA_RADIUS * ARENA_RADIUS;
  }

  /**
   * Clamp position to arena bounds (or staging cell if gates closed)
   */
  clampToBounds(pos) {
    if (!this.gatesOpen) {
      // Find which staging cell this unit is closest to and clamp to it
      let bestCell = STAGING_CELLS[0];
      let bestDist = Infinity;
      for (const cell of STAGING_CELLS) {
        const cx = (cell.minX + cell.maxX) / 2;
        const cz = (cell.minZ + cell.maxZ) / 2;
        const d = (pos.x - cx) ** 2 + (pos.z - cz) ** 2;
        if (d < bestDist) { bestDist = d; bestCell = cell; }
      }
      return {
        x: Math.max(bestCell.minX, Math.min(bestCell.maxX, pos.x)),
        y: pos.y || 0,
        z: Math.max(bestCell.minZ, Math.min(bestCell.maxZ, pos.z)),
      };
    }

    // Normal arena circular bounds
    const distSq = pos.x * pos.x + pos.z * pos.z;
    if (distSq <= ARENA_RADIUS * ARENA_RADIUS) return pos;

    const dist = Math.sqrt(distSq);
    const scale = (ARENA_RADIUS - 0.5) / dist;
    return { x: pos.x * scale, y: pos.y || 0, z: pos.z * scale };
  }

  /**
   * Check if position collides with any pillar and push out if so
   */
  resolveCollision(pos, radius = 0.5) {
    for (const pillar of this.pillars) {
      const dx = pos.x - pillar.x;
      const dz = pos.z - pillar.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const minDist = pillar.radius + radius;

      if (dist < minDist && dist > 0) {
        const pushX = (dx / dist) * minDist;
        const pushZ = (dz / dist) * minDist;
        return { x: pillar.x + pushX, y: pos.y || 0, z: pillar.z + pushZ, collided: true };
      }
    }
    return { ...pos, collided: false };
  }
}
