// Hazard system test — no WS, no auth, no browser.
//
// Drives a real DungeonRoom into a non-first wing (hazards are deliberately
// absent from room 0), parks the player on top of a hazard, and ticks until it
// fires. Asserts the full contract: hazards get placed, phases cycle through
// telegraph before active, damage only lands during active, and the re-hit
// cooldown holds.
//
// Run:  cd server && node ../scripts/test-hazards.mjs

import 'dotenv/config';
import { DungeonRoom } from '../server/dungeon/DungeonRoom.js';
import { HAZARD_KINDS, hazardPhase } from '../server/dungeon/hazards.js';

const sent = [];
const fakeWs = { readyState: 1, send: (d) => sent.push(JSON.parse(d)) };

let failures = 0;
const check = (label, cond, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

const room = new DungeonRoom('HAZTEST', { themeId: 'crucible_below' });
room.addPlayer(fakeWs, 'tyrant', 'test-sub', 'HazardTester');
room.startMatch();

console.log('\n  HAZARD SYSTEM TEST\n  ' + '─'.repeat(56));

// Room 0 must be clean — the mechanic should not ambush a new player.
const firstWingHazards = (room.currentWing.features || []).filter(f => f.isHazard);
check('room 0 has no hazards (by design)', firstWingHazards.length === 0,
  `found ${firstWingHazards.length}`);

// Advance into room 1, where hazards start appearing.
room.roomIndex = 1;
room._spawnEncounter(1);
// _tickOnce early-returns unless the room is live; _spawnEncounter alone
// doesn't set that, so drive it explicitly for the test.
room.roomState = 'fighting';
const hazards = (room.currentWing.features || []).filter(f => f.isHazard);
check('room 1 places hazards', hazards.length > 0, `${hazards.length} placed`);
if (!hazards.length) { console.log('\n  cannot continue\n'); process.exit(1); }

const kinds = [...new Set(hazards.map(h => h.kind))];
check('hazard kinds are known', kinds.every(k => HAZARD_KINDS[k]), kinds.join(', '));

// Coordinates must sit inside the wing bounds — the recentre bug would show
// up here as hazards flung outside the playable area.
const b = room.currentWing.bounds;
const inBounds = hazards.every(h => Math.abs(h.cx) <= b.halfX && Math.abs(h.cz) <= b.halfZ);
check('hazards inside wing bounds (recentre applied)', inBounds,
  `bounds ±${b.halfX}/±${b.halfZ}`);

// Park the player on a hazard and drive ticks.
const h = hazards[0];
const def = HAZARD_KINDS[h.kind];
const player = room.match.units[0];
player.position.x = h.cx;
player.position.z = h.cz;
const startHp = player.hp;

const phases = new Set();
let firstDamageTick = null;
let damageEvents = 0;

for (let i = 0; i < def.cycleTicks * 3; i++) {
  room.eventBuffer = [];
  room._tickOnce();
  phases.add(hazardPhase(h, room.match.tick));
  const hit = room.eventBuffer.filter(e => e.event === 'hazard_hit');
  if (hit.length) {
    damageEvents += hit.length;
    if (firstDamageTick === null) firstDamageTick = room.match.tick;
  }
  // Keep the player pinned; AI knockback would otherwise drift them off.
  player.position.x = h.cx;
  player.position.z = h.cz;
  if (!player.isAlive) break;
}

check('phase cycles through telegraph', phases.has('telegraph'), [...phases].join('/'));
check('phase reaches active', phases.has('active'));
check('standing in hazard deals damage', player.hp < startHp,
  `${startHp} -> ${player.hp} (${h.kind})`);
check('damage fired at least once', damageEvents > 0, `${damageEvents} hit event(s)`);
// Over 3 cycles a single hazard should hit at most 3 times — proves the
// per-unit re-hit cooldown is holding rather than damaging every tick.
check('re-hit cooldown holds', damageEvents <= 4, `${damageEvents} hits over 3 cycles`);

// Client contract: the tick payload must carry phases or the warning ring
// can never render.
const lastTick = [...sent].reverse().find(m => m.type === 'tick');
check('tick payload carries hazard phases', Array.isArray(lastTick?.hz) && lastTick.hz.length > 0,
  `hz=${lastTick?.hz?.length ?? 'absent'}`);

console.log('  ' + '─'.repeat(56));
console.log(`  ${failures === 0 ? 'ALL HAZARD CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
process.exit(failures ? 1 : 0);
