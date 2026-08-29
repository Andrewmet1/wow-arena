// DungeonGenerator — procedural floor builder.
//
// Takes a theme and produces a unique sequence of rooms per run:
//   - Picks N combat rooms from the theme's monster pool (mob packs of 2-4)
//   - Sprinkles in treasure / shrine / hidden bonus rooms
//   - Adds the boss room at the end
//
// Same theme, different layout each run. The user's "never truly the same"
// requirement is satisfied at the room-sequence + encounter-composition layer
// even though the underlying arena geometry is currently shared.
//
// Future: per-theme tile sets so room shapes vary too.

import { MONSTERS } from './monsters.js';

const ROOM_TYPES = {
  COMBAT: 'combat',
  ELITE: 'elite',
  TREASURE: 'treasure',
  SHRINE: 'shrine',
  HIDDEN: 'hidden',
  BOSS: 'boss',
};

function rollInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickOne(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build a procedural floor from a theme.
 * Returns an array of room descriptors:
 *   { roomNumber, type, label, monsters?, spawnPositions?, isBoss? }
 */
export function generateFloor(theme) {
  const rooms = [];
  // Theme.rooms is the new format: array of {label, lore}. Fall back to the
  // older string-only roomLabels for backward-compat with existing themes.
  const roomPool = theme.rooms
    || (theme.roomLabels || []).map(label => ({ label, lore: '' }));
  const labelPool = shuffle(roomPool);
  let labelIdx = 0;
  const nextRoomMeta = () => labelPool[labelIdx++ % labelPool.length] || { label: `Room ${rooms.length + 1}`, lore: '' };

  const combatCount = rollInt(theme.floor.combatRoomsMin, theme.floor.combatRoomsMax);

  for (let i = 0; i < combatCount; i++) {
    const tier = i / Math.max(1, combatCount - 1);
    const isElite = i > 0 && Math.random() < theme.floor.eliteRoomChance;
    const room = isElite
      ? buildEliteEncounter(theme, tier)
      : buildCombatEncounter(theme, tier);

    const meta = nextRoomMeta();
    room.label = meta.label;
    room.lore = meta.lore || '';
    rooms.push(room);

    // Treasure / shrine / hidden no longer get standalone rooms — the wing
    // builder already attaches treasure alcoves and lever-gated reliquaries
    // off the side of combat chambers, so a separate empty room with nothing
    // but an exit portal is just dead space. Their coin/upgrade rewards are
    // already earned via the in-wing chest / hidden chest features.
  }

  if (theme.bossId && MONSTERS[theme.bossId]) {
    rooms.push({
      type: ROOM_TYPES.BOSS,
      label: theme.bossRoom?.label || 'Boss',
      lore: theme.bossRoom?.lore || '',
      monsters: [{ id: theme.bossId }],
      spawnPositions: [{ x: 42, y: 0, z: 0 }],  // far end of the big chamber
      isBoss: true,
    });
  }

  rooms.forEach((r, i) => { r.roomNumber = i + 1; });
  return rooms;
}

function buildCombatEncounter(theme, tier) {
  const trashPool = theme.trashPool.filter(id => MONSTERS[id]);
  if (!trashPool.length) return { type: ROOM_TYPES.COMBAT, monsters: [], spawnPositions: [] };

  const packSize = rollInt(theme.packSizeMin, theme.packSizeMax);
  const monsters = [];
  for (let i = 0; i < packSize; i++) {
    monsters.push({ id: pickOne(trashPool) });
  }
  return {
    type: ROOM_TYPES.COMBAT,
    monsters,
    spawnPositions: layoutSpawnPositions(packSize),
  };
}

function buildEliteEncounter(theme, tier) {
  const elitePool = theme.elitePool.filter(id => MONSTERS[id]);
  const trashPool = theme.trashPool.filter(id => MONSTERS[id]);
  const monsters = [];

  if (elitePool.length) {
    monsters.push({ id: pickOne(elitePool) });
  }
  // Pair the elite with 1-2 trash adds
  const adds = rollInt(1, 2);
  for (let i = 0; i < adds && trashPool.length; i++) {
    monsters.push({ id: pickOne(trashPool) });
  }

  return {
    type: ROOM_TYPES.ELITE,
    monsters,
    spawnPositions: layoutSpawnPositions(monsters.length),
  };
}

/**
 * Spread N monsters across the far half of the room — generously, so the
 * player has to actually navigate between them instead of zerging one pile.
 * Player spawns at (-40, 0, 0); we scatter monsters across x=20..45, z=-25..25.
 */
function layoutSpawnPositions(count) {
  const out = [];
  if (count <= 0) return out;
  if (count === 1) {
    out.push({ x: 32, y: 0, z: 0 });
    return out;
  }
  // Spread across a wide arc covering most of the far half of the chamber
  const minX = 18;
  const maxX = 42;
  const zSpread = Math.min(40, count * 12);
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    // Stagger zig-zag so they don't form a perfect line
    const z = -zSpread / 2 + zSpread * t + (i % 2 === 0 ? -3 : 3);
    const x = minX + (maxX - minX) * (0.3 + Math.random() * 0.7);
    out.push({ x, y: 0, z });
  }
  return out;
}

export { ROOM_TYPES };
