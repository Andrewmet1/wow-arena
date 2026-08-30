// Wing layout — every "room" the player walks into is a multi-chamber wing
// shaped like a smaller-scale Diablo dungeon level. A typical non-boss wing
// has 4-5 connected chambers branching off each other:
//
//   entry → corridor → A (main) ─corridor─ B (branch)
//                       │
//                     corridor
//                       │
//                       C (secondary) ─ corridor ─ D (alcove/shrine)
//
// Each chamber is placed in one of four cardinal directions from its parent
// (entry/N/S/E/W) with collision-checked positioning so chambers never overlap.
// Result: every run has a different L/T/cross/star shape.
//
// Boss wings stay linear for drama: entry → long approach → throne chamber.
//
// Output is consumed by:
//   - DungeonRoom.js to position monsters + chest + lever, set bounds
//   - DungeonEnvironment.js (client) to render the geometry
//
// Layout coords are in world space, chamber `cx, cz` is the center, with
// `halfX, halfZ` as the chamber's half-extents.

import { CHAMBER_TEMPLATES, THEME_CHAMBER_POOLS } from './chambers.js';
import { getTheme } from './themes.js';
import { placeHazards } from './hazards.js';

const CORRIDOR_LEN = 14;
const CORRIDOR_HALF_Z = 4;

function pickOne(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

/** Pick a random direction the new chamber will branch off the parent.
 *  Excludes any direction already used. Returns null if no direction available. */
function pickDir(usedDirs, rng) {
  const all = ['N', 'S', 'E', 'W'];
  const free = all.filter(d => !usedDirs.has(d));
  if (!free.length) return null;
  return free[Math.floor(rng() * free.length)];
}

/** Check if a new chamber rectangle would overlap any existing chamber/corridor. */
function wouldOverlap(newCx, newCz, newHalfX, newHalfZ, existing) {
  for (const e of existing) {
    const dx = Math.abs(newCx - e.cx);
    const dz = Math.abs(newCz - e.cz);
    // 1u padding so chambers don't touch awkwardly
    if (dx < (newHalfX + e.halfX) - 0.5 && dz < (newHalfZ + e.halfZ) - 0.5) {
      return true;
    }
  }
  return false;
}

/** Add procedural cover pieces for a chamber from its template's coverZones. */
function addCoverForChamber(layout, chamber, tpl, rng) {
  if (!Array.isArray(tpl.coverZones) || !tpl.coverZones.length) return;
  const zones = [...tpl.coverZones];
  const keepCount = Math.max(2, Math.floor(zones.length * (0.45 + rng() * 0.3)));
  for (let i = zones.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [zones[i], zones[j]] = [zones[j], zones[i]];
  }
  for (const z of zones.slice(0, keepCount)) {
    const jx = (rng() - 0.5) * 6;
    const jz = (rng() - 0.5) * 6;
    const rot = rng() * Math.PI * 2;
    const pieceCount = z.kind === 'pillar_cluster'
      ? 2 + Math.floor(rng() * 3)
      : z.kind === 'rubble_pile'
      ? 3 + Math.floor(rng() * 3)
      : 1;
    layout.cover.push({
      id: `cover_${layout.cover.length}`,
      kind: z.kind,
      cx: chamber.cx + z.x + jx,
      cz: chamber.cz + z.z + jz,
      radius: z.radius,
      rot,
      pieceCount,
      chamberId: chamber.id,
    });
  }
}

/** Distribute mob packs across a chamber, smart-placed away from cover. */
function addPacksForChamber(layout, chamber, packCount, packIdPrefix, rng) {
  if (packCount <= 0) return;
  const packCenters = [];
  for (let p = 0; p < packCount; p++) {
    let best = null, bestScore = -Infinity;
    for (let attempt = 0; attempt < 8; attempt++) {
      // Spread packs around the chamber in a 360° sweep with jitter
      const baseAngle = (p / packCount) * Math.PI * 2 + rng() * 0.3;
      const radius = (chamber.halfX + chamber.halfZ) * (0.25 + rng() * 0.18);
      const cx = chamber.cx + Math.cos(baseAngle) * radius;
      const cz = chamber.cz + Math.sin(baseAngle) * radius;
      // Score: far from other pack centers + far from cover
      let score = 0;
      for (const c of packCenters) {
        const d = Math.hypot(cx - c.x, cz - c.z);
        score += Math.min(d, 30);
      }
      for (const cv of layout.cover) {
        if (cv.chamberId !== chamber.id) continue;
        const d = Math.hypot(cx - cv.cx, cz - cv.cz);
        score += Math.min(d - cv.radius, 20);
      }
      if (score > bestScore) { bestScore = score; best = { x: cx, z: cz }; }
    }
    packCenters.push(best);
    const packSize = 2 + Math.floor(rng() * 2); // 2 or 3
    for (let i = 0; i < packSize; i++) {
      const jx = (rng() - 0.5) * 4;
      const jz = (rng() - 0.5) * 4;
      layout.spawns.push({
        x: best.x + jx,
        z: best.z + jz,
        packId: `${packIdPrefix}_${p}`,
      });
    }
  }
}

/** Try to place a new chamber branching off a parent in direction dir.
 *  Returns the placed chamber (with cx/cz) or null if it couldn't fit. */
function tryBranchChamber(parent, dir, newTpl, existingTiles, rng) {
  // Corridor length for the connection. Larger corridors for visual breathing.
  const corLen = CORRIDOR_LEN + Math.floor(rng() * 6); // 14..19
  let newCx, newCz, corCx, corCz, corHalfX, corHalfZ;
  // Optional perpendicular offset so the corridor doesn't always exit dead-center
  const offset = (rng() - 0.5) * Math.min(parent.halfX, parent.halfZ) * 0.4;
  if (dir === 'N') {
    corHalfX = CORRIDOR_HALF_Z;
    corHalfZ = corLen / 2;
    corCx = parent.cx + offset;
    corCz = parent.cz - parent.halfZ - corHalfZ;
    newCx = corCx;
    newCz = corCz - corHalfZ - newTpl.halfZ;
  } else if (dir === 'S') {
    corHalfX = CORRIDOR_HALF_Z;
    corHalfZ = corLen / 2;
    corCx = parent.cx + offset;
    corCz = parent.cz + parent.halfZ + corHalfZ;
    newCx = corCx;
    newCz = corCz + corHalfZ + newTpl.halfZ;
  } else if (dir === 'E') {
    corHalfX = corLen / 2;
    corHalfZ = CORRIDOR_HALF_Z;
    corCx = parent.cx + parent.halfX + corHalfX;
    corCz = parent.cz + offset;
    newCx = corCx + corHalfX + newTpl.halfX;
    newCz = corCz;
  } else { // W
    corHalfX = corLen / 2;
    corHalfZ = CORRIDOR_HALF_Z;
    corCx = parent.cx - parent.halfX - corHalfX;
    corCz = parent.cz + offset;
    newCx = corCx - corHalfX - newTpl.halfX;
    newCz = corCz;
  }
  if (wouldOverlap(newCx, newCz, newTpl.halfX, newTpl.halfZ, existingTiles)) {
    return null;
  }
  if (wouldOverlap(corCx, corCz, corHalfX, corHalfZ, existingTiles)) {
    return null;
  }
  return {
    chamber: { cx: newCx, cz: newCz, halfX: newTpl.halfX, halfZ: newTpl.halfZ },
    corridor: { cx: corCx, cz: corCz, halfX: corHalfX, halfZ: corHalfZ },
    dir,
  };
}

/**
 * Build a wing layout for one room of a dungeon run.
 *
 * Boss: linear (entry → long corridor → throne).
 * Non-boss: branching graph of 4-5 chambers with random direction picks.
 */
export function buildWing({ themeId, roomType, rng = Math.random, forceMainTemplate = null, isFirstWing = false, roomIndex = 0 }) {
  // Theme-driven chamber pool — themes.js declares which chamber templates
  // a dungeon can use. Falls back to chambers.js's THEME_CHAMBER_POOLS for
  // backward compat if the theme doesn't declare its own.
  const theme = getTheme(themeId);
  const pool = theme.chamberPool || THEME_CHAMBER_POOLS[themeId] || THEME_CHAMBER_POOLS.crucible_below;

  const layout = { chambers: [], monsters: [], spawns: [], corridors: [], doors: [], features: [], cover: [] };
  // Tracker of every solid tile placed so far — used for overlap-checking.
  const placedTiles = [];

  // ── Entry hall (always, at the west) ──────────────────────────────────
  const entryTpl = CHAMBER_TEMPLATES.entry_hall;
  const entryX = -60;
  const entry = {
    id: 'entry', template: 'entry_hall',
    cx: entryX, cz: 0,
    halfX: entryTpl.halfX, halfZ: entryTpl.halfZ,
  };
  layout.chambers.push(entry);
  placedTiles.push(entry);
  layout.playerSpawn = { x: entryX - entryTpl.halfX + 4, z: 0 };

  // ── Pick main chamber template ────────────────────────────────────────
  let mainId;
  if (roomType === 'boss') mainId = pool.boss;
  else if (forceMainTemplate) mainId = forceMainTemplate;
  else mainId = pickOne(pool.combat, rng);
  const mainTpl = CHAMBER_TEMPLATES[mainId];
  if (!mainTpl) throw new Error(`unknown chamber: ${mainId}`);

  // ── Vendor placement happens later (after main chamber bounds known)
  //    so all wings — combat, treasure, shrine, boss — get a vendor placed
  //    in the entry hall right next to the player spawn.
  if (roomType === 'boss') {
    const approachLen = CORRIDOR_LEN * 2;
    const corridor = {
      cx: entryX + entryTpl.halfX + approachLen / 2, cz: 0,
      halfX: approachLen / 2, halfZ: CORRIDOR_HALF_Z,
      isApproach: true,
    };
    layout.corridors.push(corridor);
    placedTiles.push(corridor);
    const mainX = corridor.cx + corridor.halfX + mainTpl.halfX;
    const main = {
      id: 'main', template: mainId,
      cx: mainX, cz: 0,
      halfX: mainTpl.halfX, halfZ: mainTpl.halfZ,
    };
    layout.chambers.push(main);
    placedTiles.push(main);
    layout.spawns.push({ x: mainX, z: 0, packId: 'boss' });
    return finalizeLayout(layout, mainId, themeId);
  }

  // ── Non-boss: multi-chamber branching graph ───────────────────────────
  // 1. Main chamber connected east of entry by short corridor.
  const entryCorridor = {
    cx: entryX + entryTpl.halfX + CORRIDOR_LEN / 2, cz: 0,
    halfX: CORRIDOR_LEN / 2, halfZ: CORRIDOR_HALF_Z,
  };
  layout.corridors.push(entryCorridor);
  placedTiles.push(entryCorridor);
  const mainX = entryCorridor.cx + entryCorridor.halfX + mainTpl.halfX;
  const main = {
    id: 'main', template: mainId,
    cx: mainX, cz: 0,
    halfX: mainTpl.halfX, halfZ: mainTpl.halfZ,
    _usedDirs: new Set(['W']), // entry corridor uses west
  };
  layout.chambers.push(main);
  placedTiles.push(main);
  addCoverForChamber(layout, main, mainTpl, rng);

  // 2-3 branching chambers off the main + their own sub-branches
  // Target: 4-5 chambers total (entry + main + 2-3 branches) plus their corridors.
  const branchChamberIds = ['B', 'C', 'D'];
  const targetBranchCount = 2 + Math.floor(rng() * 2); // 2 or 3
  const allChambersForBranching = [main];
  const branchChambers = [];

  for (let b = 0; b < targetBranchCount; b++) {
    // Pick a parent to branch from — prefer the main, but later branches can hang off earlier branches for an L/T/star feel.
    const parentPool = b < 2 ? [main] : allChambersForBranching;
    let placed = null;
    let parent = null;
    let chosenTpl = null;
    // Try up to 6 (parent, direction) combinations
    for (let attempt = 0; attempt < 6 && !placed; attempt++) {
      parent = parentPool[Math.floor(rng() * parentPool.length)];
      const dir = pickDir(parent._usedDirs, rng);
      if (!dir) continue;
      // Pick a template — combat pool, prefer something different than already used
      const usedTplIds = new Set(branchChambers.map(c => c.template));
      const candidates = pool.combat.filter(id => !usedTplIds.has(id));
      const tplId = (candidates.length ? pickOne(candidates, rng) : pickOne(pool.combat, rng));
      chosenTpl = CHAMBER_TEMPLATES[tplId];
      const tryResult = tryBranchChamber(parent, dir, chosenTpl, placedTiles, rng);
      if (tryResult) {
        // Mark used direction on parent + mirror on child
        parent._usedDirs.add(dir);
        const opp = { N: 'S', S: 'N', E: 'W', W: 'E' }[dir];
        const branchChamber = {
          id: branchChamberIds[b] || `branch_${b}`,
          template: tplId,
          cx: tryResult.chamber.cx,
          cz: tryResult.chamber.cz,
          halfX: tryResult.chamber.halfX,
          halfZ: tryResult.chamber.halfZ,
          _usedDirs: new Set([opp]),
        };
        const branchCorridor = {
          cx: tryResult.corridor.cx, cz: tryResult.corridor.cz,
          halfX: tryResult.corridor.halfX, halfZ: tryResult.corridor.halfZ,
        };
        layout.chambers.push(branchChamber);
        layout.corridors.push(branchCorridor);
        placedTiles.push(branchChamber, branchCorridor);
        branchChambers.push(branchChamber);
        allChambersForBranching.push(branchChamber);
        addCoverForChamber(layout, branchChamber, chosenTpl, rng);
        placed = branchChamber;
      }
    }
    // If 6 attempts all failed, we simply skip this branch — wing still playable
  }

  // ── Distribute mob packs across all combat chambers ───────────────────
  // Main chamber gets 2-3 packs; each branch chamber gets 1-2 packs.
  // Total non-boss packs: 4-9 depending on branch count.
  // Guaranteed pack counts so every chamber feels populated:
  //   main: always 3 packs (was 2-3 random)
  //   branches: always 2 packs each (was 1-2 random)
  // With 4-5 chambers and a guarantee, total mob count = 3 + 2*N branches.
  // For 3 branches → 9 packs × 2-3 mobs = 18-27 mobs per wing.
  const mainPacks = 3;
  addPacksForChamber(layout, main, mainPacks, 'pack_main', rng);
  for (let i = 0; i < branchChambers.length; i++) {
    const branchPacks = 2;
    addPacksForChamber(layout, branchChambers[i], branchPacks, `pack_${branchChambers[i].id}`, rng);
  }

  // ── Reward chests in branch chambers ──────────────────────────────────
  // Each branch chamber has a 60% chance to host a common chest at its center.
  for (const bc of branchChambers) {
    if (rng() < 0.6) {
      layout.features.push({
        kind: 'chest',
        id: `branch_chest_${bc.id}_${Math.floor(rng() * 1000000)}`,
        cx: bc.cx + (rng() - 0.5) * bc.halfX * 0.5,
        cz: bc.cz + (rng() - 0.5) * bc.halfZ * 0.5,
        tier: rng() < 0.20 ? 'rare' : 'common',
        opened: false,
        branchId: bc.id,
      });
    }
  }

  // ── Interactive props per wing ─────────────────────────────────────────
  // GUARANTEED: 1 blood well in the main chamber (used to be 40% RNG; players
  // complained they never saw wells). Plus an additional randomly-rolled prop
  // (brazier / idol / bell) in the main chamber, AND a puzzle/shrine in any
  // branch chamber that doesn't have packs.
  const propPos = (chamber, t = 0.55) => {
    const a = rng() * Math.PI * 2;
    return {
      cx: chamber.cx + Math.cos(a) * chamber.halfX * t,
      cz: chamber.cz + Math.sin(a) * chamber.halfZ * t,
    };
  };
  // Always a blood well in main
  {
    const p = propPos(main, 0.5);
    layout.features.push({
      kind: 'blood_well',
      id: `well_${Math.floor(rng() * 1000000)}`,
      cx: p.cx, cz: p.cz,
      fill: 0, capacity: Math.max(4, layout.spawns.length), consumed: false,
    });
  }
  // Vendor placement: right next to the player spawn point so they can't
  // miss it. Player spawns at (entry.cx - halfX + 4, 0). Place the vendor
  // 6u east of spawn + 3u to the side so it's the first thing they see.
  // First wing uses starter catalog (rites); later wings use consumables.
  layout.features.push({
    kind: 'vendor',
    id: `vendor_${Math.floor(rng() * 1000000)}`,
    cx: entry.cx - entry.halfX + 10,
    cz: 3,
    consumed: false,
    isStarter: isFirstWing,
  });
  // Additional random prop in main (brazier / idol / bell)
  const extraRoll = rng();
  {
    const p = propPos(main, 0.7);
    if (extraRoll < 0.4) {
      layout.features.push({
        kind: 'ritual_brazier',
        id: `brazier_${Math.floor(rng() * 1000000)}`,
        cx: p.cx, cz: p.cz, consumed: false,
      });
    } else if (extraRoll < 0.7) {
      layout.features.push({
        kind: 'ancient_idol',
        id: `idol_${Math.floor(rng() * 1000000)}`,
        cx: p.cx, cz: p.cz, consumed: false,
      });
    } else {
      layout.features.push({
        kind: 'cursed_bell',
        id: `bell_${Math.floor(rng() * 1000000)}`,
        cx: p.cx, cz: p.cz, consumed: false,
      });
    }
  }
  // Puzzle shrine: only in chambers WITHOUT mob packs (pack-free = safe
  // exploration room). Pick from branchChambers without packs first; if
  // none qualify, check main; if main has packs, no puzzle this wing.
  const PUZZLE_TYPES = ['glyph_sequence', 'pressure_plates', 'sacrifice_choice', 'brazier_order'];
  const pickPuzzleType = () => PUZZLE_TYPES[Math.floor(rng() * PUZZLE_TYPES.length)];
  const hasPacks = (c) => layout.spawns.some(s => s.packId?.startsWith(`pack_${c.id}`));
  const packFreeBranches = branchChambers.filter(bc => !hasPacks(bc));
  // Place a puzzle every wing — prefer pack-free branches, fall back to
  // pack-free main, fall back to main with packs (player just has to clear
  // before interacting). Without the last fallback, wings with mobs in every
  // chamber had no puzzle and the player went whole runs without seeing one.
  const puzzleChamber = packFreeBranches.length
    ? packFreeBranches[Math.floor(rng() * packFreeBranches.length)]
    : (!hasPacks(main) ? main : (branchChambers[0] || main));
  if (puzzleChamber && roomType !== 'boss') {
    layout.features.push({
      kind: 'puzzle_shrine',
      id: `shrine_${puzzleChamber.id}_${Math.floor(rng() * 1000000)}`,
      cx: puzzleChamber.cx, cz: puzzleChamber.cz,
      consumed: false,
      puzzleType: pickPuzzleType(),
      puzzleSeed: Math.floor(rng() * 1000000000),
    });
  }

  // ── Optional hidden reliquary (20% chance, hangs off main south wall) ──
  if (rng() < 0.20) {
    // Only attempt if the south side of main isn't already used by a branch.
    if (!main._usedDirs.has('S')) {
      const relTpl = CHAMBER_TEMPLATES.reliquary;
      const connectorHalfZ = 3;
      const connectorZ = main.cz + main.halfZ + connectorHalfZ;
      const relCz = connectorZ + connectorHalfZ + relTpl.halfZ;
      const overlapTest = { cx: main.cx, cz: relCz, halfX: relTpl.halfX, halfZ: relTpl.halfZ };
      if (!wouldOverlap(main.cx, relCz, relTpl.halfX, relTpl.halfZ, placedTiles)) {
        layout.chambers.push({
          id: 'hidden', template: 'reliquary',
          cx: main.cx, cz: relCz,
          halfX: relTpl.halfX, halfZ: relTpl.halfZ,
          hidden: true,
        });
        layout.corridors.push({
          cx: main.cx, cz: connectorZ,
          halfX: 4, halfZ: connectorHalfZ,
          hidden: true,
        });
        layout.doors.push({
          kind: 'breakable', id: 'hidden_wall',
          cx: main.cx, cz: main.cz + main.halfZ - 0.5,
          halfX: 4, halfZ: 1, broken: false,
        });
        layout.features.push({
          kind: 'lever', id: 'hidden_lever',
          cx: main.cx + (rng() < 0.5 ? -main.halfX + 4 : main.halfX - 4),
          cz: main.cz + (rng() < 0.5 ? -main.halfZ + 4 : main.halfZ - 4),
          activated: false, target: 'hidden_wall',
        });
        layout.features.push({
          kind: 'chest', id: `hidden_chest_${Date.now()}`,
          tier: 'rare',
          cx: main.cx + relTpl.chestSpawn.x,
          cz: relCz + relTpl.chestSpawn.z,
          opened: false, reward: 'random_upgrade_x2',
        });
      }
    }
  }

  // Environmental hazards. Skipped in the first wing so the player meets the
  // mechanic after they have their footing, and never in boss rooms where the
  // fight already owns the floor.
  //
  // Must run before finalizeLayout: that recenters layout.features along with
  // the chambers, so placing afterwards would leave hazard coordinates in the
  // pre-recentre frame and the damage check would fire in the wrong spot.
  if (!isFirstWing && roomType !== 'boss') {
    placeHazards(layout, rng, roomIndex);
  }

  // Strip the internal _usedDirs tracker from outgoing chamber data
  for (const c of layout.chambers) delete c._usedDirs;

  return finalizeLayout(layout, mainId, themeId);
}

/** Recenter wing around origin and compute bounds. */
function finalizeLayout(layout, mainId, themeId) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const c of [...layout.chambers, ...layout.corridors]) {
    minX = Math.min(minX, c.cx - c.halfX);
    maxX = Math.max(maxX, c.cx + c.halfX);
    minZ = Math.min(minZ, c.cz - c.halfZ);
    maxZ = Math.max(maxZ, c.cz + c.halfZ);
  }
  const offsetX = -(minX + maxX) / 2;
  const offsetZ = -(minZ + maxZ) / 2;
  const recenterPoint = (p) => ({ ...p, x: p.x + offsetX, z: p.z + offsetZ });
  layout.chambers = layout.chambers.map(c => ({ ...c, cx: c.cx + offsetX, cz: c.cz + offsetZ }));
  layout.corridors = layout.corridors.map(c => ({ ...c, cx: c.cx + offsetX, cz: c.cz + offsetZ }));
  layout.doors = layout.doors.map(d => ({ ...d, cx: d.cx + offsetX, cz: d.cz + offsetZ }));
  layout.features = layout.features.map(f => ({ ...f, cx: f.cx + offsetX, cz: f.cz + offsetZ }));
  layout.cover = layout.cover.map(c => ({ ...c, cx: c.cx + offsetX, cz: c.cz + offsetZ }));
  layout.spawns = layout.spawns.map(recenterPoint);
  layout.playerSpawn = recenterPoint(layout.playerSpawn);
  layout.bounds = {
    halfX: Math.ceil((maxX - minX) / 2 + 4),
    halfZ: Math.ceil((maxZ - minZ) / 2 + 4),
  };
  layout.themeId = themeId;
  layout.mainTemplate = mainId;
  return layout;
}
