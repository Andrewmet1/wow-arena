import { PILLAR_POSITIONS, PILLAR_RADIUS, ARENA_RADIUS } from '../constants.js';

// Staging cell bounds (rectangular areas outside arena gates)
const STAGING_CELLS = [
  { minX: -54, maxX: -41, minZ: -5, maxZ: 5 },  // West cell (player)
  { minX: 41, maxX: 54, minZ: -5, maxZ: 5 },     // East cell (enemy)
];

export class LineOfSight {
  constructor(pillars = null, radius = null) {
    // Pillars as circles: { x, z, radius }
    this.pillars = pillars || PILLAR_POSITIONS.map(p => ({
      x: p.x,
      z: p.z,
      radius: PILLAR_RADIUS
    }));

    // Boundary radius. Variable so arena layouts can differ in size as well as
    // in cover — a tight arena and a wide one play differently even with the
    // same pillars. Falls back to the original constant.
    this.arenaRadius = radius ?? ARENA_RADIUS;

    /** When false, units are confined to their staging cell. Set true when gates open. */
    this.gatesOpen = false;

    /**
     * Optional rectangular bounds override. When set, isInBounds and
     * clampToBounds use this rectangle instead of the default circular arena.
     * Used by dungeon mode where the chamber is rectangular and bigger than
     * the PvP arena's 40-radius circle.
     * Shape: { halfX, halfZ }
     */
    this.dungeonBounds = null;

    /**
     * When set, movement is constrained to the union of these axis-aligned
     * tiles (chambers + corridors). Without this, the rectangular bounds let
     * players + mobs walk into the negative space *between* chambers — out
     * of any actual room.
     * Shape: [{ cx, cz, halfX, halfZ }]
     */
    this.dungeonTiles = null;
  }

  /** Is `pos` inside any dungeonTile? */
  /**
   * Floor height at a point, or null outside every tile.
   *
   * Chambers can sit on different levels, so a unit's Y has to follow whatever
   * it is standing over rather than being pinned at zero. Returns the highest
   * matching tile, which resolves the overlap where a corridor mouth sits
   * inside a chamber's footprint.
   */
  groundHeightAt(x, z) {
    if (!this.dungeonTiles) return 0;
    let best = null;
    for (const t of this.dungeonTiles) {
      if (Math.abs(x - t.cx) <= t.halfX && Math.abs(z - t.cz) <= t.halfZ) {
        const e = t.elevation || 0;
        if (best === null || e > best) best = e;
      }
    }
    return best;
  }

  _isInsideAnyTile(pos, margin = 0) {
    if (!this.dungeonTiles) return true;
    for (const t of this.dungeonTiles) {
      if (Math.abs(pos.x - t.cx) <= t.halfX - margin &&
          Math.abs(pos.z - t.cz) <= t.halfZ - margin) {
        return true;
      }
    }
    return false;
  }

  /** Clamp `pos` to the nearest tile interior. Returns the tile-clamped pos. */
  _clampToNearestTile(pos, margin = 1.0) {
    if (!this.dungeonTiles?.length) return pos;
    let best = null, bestDist = Infinity;
    for (const t of this.dungeonTiles) {
      // Closest point inside the tile (with inset margin so we don't sit on the wall)
      const ix = Math.max(t.cx - t.halfX + margin, Math.min(t.cx + t.halfX - margin, pos.x));
      const iz = Math.max(t.cz - t.halfZ + margin, Math.min(t.cz + t.halfZ - margin, pos.z));
      const dx = ix - pos.x, dz = iz - pos.z;
      const d = dx * dx + dz * dz;
      if (d < bestDist) { bestDist = d; best = { x: ix, z: iz }; }
    }
    return best || pos;
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
      for (const cell of STAGING_CELLS) {
        if (pos.x >= cell.minX && pos.x <= cell.maxX && pos.z >= cell.minZ && pos.z <= cell.maxZ) {
          return true;
        }
      }
      return false;
    }
    // Dungeon: rectangular chamber bounds
    if (this.dungeonBounds) {
      return Math.abs(pos.x) <= this.dungeonBounds.halfX
          && Math.abs(pos.z) <= this.dungeonBounds.halfZ;
    }
    return (pos.x * pos.x + pos.z * pos.z) <= this.arenaRadius * this.arenaRadius;
  }

  /**
   * Clamp position to arena bounds (or staging cell if gates closed)
   */
  clampToBounds(pos) {
    if (!this.gatesOpen) {
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

    // Dungeon: prefer per-tile polygon clamp (keeps the player + mobs inside
    // chambers/corridors instead of letting them roam the negative space
    // between rectangles). Fall back to rectangular bounds if no tile data.
    if (this.dungeonTiles?.length) {
      if (this._isInsideAnyTile(pos, 1.0)) {
        return { x: pos.x, y: pos.y || 0, z: pos.z };
      }
      const clamped = this._clampToNearestTile(pos, 1.0);
      return { x: clamped.x, y: pos.y || 0, z: clamped.z };
    }
    if (this.dungeonBounds) {
      const margin = 1.5;
      return {
        x: Math.max(-this.dungeonBounds.halfX + margin, Math.min(this.dungeonBounds.halfX - margin, pos.x)),
        y: pos.y || 0,
        z: Math.max(-this.dungeonBounds.halfZ + margin, Math.min(this.dungeonBounds.halfZ - margin, pos.z)),
      };
    }

    // Normal PvP arena circular bounds
    const distSq = pos.x * pos.x + pos.z * pos.z;
    if (distSq <= this.arenaRadius * this.arenaRadius) return pos;

    const dist = Math.sqrt(distSq);
    const scale = (this.arenaRadius - 0.5) / dist;
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
