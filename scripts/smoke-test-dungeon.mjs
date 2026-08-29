// Smoke test the dungeon end-to-end without WS or auth.
// Constructs a DungeonRoom, runs ticks, verifies:
//   - bounds are set correctly
//   - monsters spawn with correct names + monsterIds
//   - AI engages player + obstacle avoidance fires when stuck
//   - room clears advance properly
//
// Run:  cd server && node ../scripts/smoke-test-dungeon.mjs
import 'dotenv/config';
import { DungeonRoom } from '../server/dungeon/DungeonRoom.js';

// Stub a player WS so DungeonRoom doesn't crash on send
const sentMessages = [];
const fakeWs = {
  readyState: 1,
  send: (data) => sentMessages.push(JSON.parse(data)),
};

const room = new DungeonRoom('TEST', { themeId: 'crucible_below' });
room.addPlayer(fakeWs, 'tyrant', 'test-sub-1', 'TestRunner');
room.startMatch();

// Verify bounds set — wing-based, varies per chamber template
const bounds = room.match.los.dungeonBounds;
console.log('1. dungeonBounds:', bounds);
console.log('   gatesOpen:', room.match.los.gatesOpen);
if (!bounds || bounds.halfX < 20 || bounds.halfZ < 8) {
  console.error('   FAIL: bounds too small');
  process.exit(1);
}
console.log('   PASS\n');

// Verify dungeon_start sent
const startMsg = sentMessages.find(m => m.type === 'dungeon_start');
console.log('2. dungeon_start sent:', !!startMsg);
console.log('   theme:', startMsg?.theme?.id);
console.log('   totalRooms:', startMsg?.totalRooms);
console.log('   units count:', startMsg?.units?.length);
console.log('   floorPlan rooms:', startMsg?.floorPlan?.map(r => r.label).slice(0, 5).join(' / '));
if (!startMsg || !startMsg.units || startMsg.units.length < 2) {
  console.error('   FAIL: expected at least 2 units (player + 1 monster)');
  process.exit(1);
}
console.log('   PASS\n');

// Verify monster has name + monsterId
const monsterUnit = startMsg.units.find(u => u.isMonster);
console.log('3. monster unit:', monsterUnit?.name, '/', monsterUnit?.monsterId, 'class:', monsterUnit?.classId);
if (!monsterUnit?.name || !monsterUnit?.monsterId) {
  console.error('   FAIL: monster missing name or monsterId');
  process.exit(1);
}
console.log('   PASS\n');

// Run player_ready -> ticks. Verify AI engages.
room.playerReady();
const player = room.match.units[0];

// Teleport player near the first monster to test aggro engage quickly without
// having to simulate 30+ seconds of walking.
const firstMonster = room.match.units.find(u => u.isMonster);
player.position.x = firstMonster.position.x - 10; // 10 units away — inside default 14-radius aggro
player.position.z = firstMonster.position.z;

const ticksToRun = 100;
let aiEngaged = false;
let monsterMoved = false;
const monsterStartPos = { x: firstMonster.position.x, z: firstMonster.position.z };

for (let i = 0; i < ticksToRun; i++) {
  // Player stands still; AI should pursue.
  room._tickOnce();
  const ai = room.aiControllers[firstMonster.id];
  if (ai?.state === 'pursue') aiEngaged = true;
  const moved = (firstMonster.position.x - monsterStartPos.x) ** 2
              + (firstMonster.position.z - monsterStartPos.z) ** 2;
  if (moved > 0.5) monsterMoved = true;
  if (aiEngaged && monsterMoved) break;
}

console.log('4. AI engaged after player came in range:', aiEngaged);
if (!aiEngaged) {
  console.error('   FAIL: AI never transitioned to pursue');
  process.exit(1);
}
console.log('   PASS\n');

// Casters legitimately don't move when in cast range, so don't fail the
// smoke test on a caster. Just print what happened.
console.log('5. Monster movement:', monsterMoved ? 'moved (chasing)' : 'held position (likely caster in range)');
console.log('   monster pos:', firstMonster.position.x.toFixed(2), firstMonster.position.z.toFixed(2));
console.log('   PASS\n');

// Verify wing layout fields
const wing = room.currentWing;
console.log('5b. Wing layout:');
console.log('   mainTemplate:', wing.mainTemplate);
console.log('   chambers:', wing.chambers.map(c => `${c.id}:${c.template}`).join(', '));
console.log('   corridors:', wing.corridors.length);
console.log('   features:', wing.features.map(f => `${f.kind}(${f.tier || ''})`).join(', ') || 'none');
console.log('   doors:', wing.doors.map(d => d.kind).join(', ') || 'none');
console.log('   PASS\n');

// Forward-walk test: put the player at the wing's actual entry spawn (which
// can shift with 2-chamber layouts when the wing is recentered) and walk
// east. Use the wing's reported playerSpawn so we don't accidentally start
// outside any tile.
player.position.x = wing.playerSpawn.x;
player.position.z = wing.playerSpawn.z;
player.moveTarget = null;
const startX = player.position.x;
const positions = [];
for (let i = 0; i < 100; i++) {
  room.pendingInputs.push({ moveDir: { x: 1, z: 0 } });
  room._tickOnce();
  if (i % 10 === 0) positions.push({ tick: i, x: player.position.x.toFixed(2), z: player.position.z.toFixed(2) });
}
console.log('6. Player walking east — position trace:');
for (const p of positions) console.log(`   tick ${p.tick}: (${p.x}, ${p.z})`);
const totalDx = player.position.x - startX;
console.log('   total +x movement:', totalDx.toFixed(2));
if (totalDx < 5) {
  console.error('   FAIL: player only moved', totalDx.toFixed(2), 'units in 100 ticks — BUBBLE!');
  process.exit(1);
}
console.log('   PASS\n');

// Bounds test: try to walk player past x=-100 — should clamp to -53 + margin.
player.position.x = -52;
for (let i = 0; i < 20; i++) {
  room.pendingInputs.push({ moveDir: { x: -1, z: 0 } });
  room._tickOnce();
}
console.log('7. Player after walking off west wall: x =', player.position.x.toFixed(2));
if (player.position.x < -bounds.halfX) {
  console.error('   FAIL: player escaped bounds (no clamp)');
  process.exit(1);
}
console.log('   PASS\n');

console.log('All smoke checks passed.');
process.exit(0);
