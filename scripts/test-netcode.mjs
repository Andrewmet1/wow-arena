// Netcode contract test — no browser, no auth.
//
// Constructs a real GameRoom, feeds it inputs carrying sequence numbers, and
// asserts the acknowledgement contract client prediction depends on:
//   · the server acks the highest sequence it applied
//   · out-of-order arrivals never walk the ack backwards
//   · unsequenced input (older client) does not corrupt the ack
// Then exercises the client's replay arithmetic and spell-queue window against
// the same rules the client implements.
//
// Run:  cd server && node ../scripts/test-netcode.mjs

import 'dotenv/config';
import { GameRoom } from '../server/GameRoom.js';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

const sent = [];
const mkWs = () => ({ readyState: 1, send: (d) => sent.push(JSON.parse(d)) });

console.log('\n  NETCODE CONTRACT\n  ' + '─'.repeat(56));

const room = new GameRoom('NETTEST', { mode: '1v1' });
const ws = mkWs();
room.addPlayer(ws, 'tyrant', 0);           // (ws, classId, slot)
room.addAIPlayer('wraith', 1);             // opponent, so the match can start
room.startMatch();

const lastTick = () => [...sent].reverse().find(m => m.type === 'tick');

// ── ack tracks the highest applied sequence ──────────────────────────────
room.handleInput(ws, { seq: 1, moveDir: { x: 1, z: 0 } });
room.handleInput(ws, { seq: 2, moveDir: { x: 1, z: 0 } });
room.tick();
check('acks highest applied sequence', room.lastAckedSeq[0] === 2, `ack=${room.lastAckedSeq[0]}`);

// ── out-of-order must not rewind the ack ─────────────────────────────────
room.handleInput(ws, { seq: 5, moveDir: { x: 0, z: 1 } });
room.handleInput(ws, { seq: 3, moveDir: { x: 0, z: 1 } });   // late arrival
room.tick();
check('out-of-order does not rewind ack', room.lastAckedSeq[0] === 5, `ack=${room.lastAckedSeq[0]}`);

// ── unsequenced input is tolerated ───────────────────────────────────────
room.handleInput(ws, { moveDir: { x: 1, z: 0 } });           // no seq
room.tick();
check('unsequenced input leaves ack intact', room.lastAckedSeq[0] === 5, `ack=${room.lastAckedSeq[0]}`);

// ── non-numeric seq is rejected at the door ──────────────────────────────
room.handleInput(ws, { seq: 'abc', moveDir: { x: 1, z: 0 } });
room.tick();
check('non-numeric seq rejected', room.lastAckedSeq[0] === 5, `ack=${room.lastAckedSeq[0]}`);

// ── ack reaches the client in the tick payload ───────────────────────────
const t = lastTick();
check('tick payload carries per-slot ack', Array.isArray(t?.ack) && t.ack[0] === 5,
  `ack=${JSON.stringify(t?.ack)}`);

// ── client replay arithmetic ─────────────────────────────────────────────
// Mirrors the client: authoritative position, plus every unacked input.
{
  const unacked = [{ seq: 4, dx: 1, dz: 0 }, { seq: 5, dx: 2, dz: 0 }, { seq: 6, dx: 0.5, dz: 1 }];
  const serverPos = { x: 10, z: 10 };
  const ack = 4;
  const remaining = unacked.filter(i => i.seq > ack);
  let rx = serverPos.x, rz = serverPos.z;
  for (const i of remaining) { rx += i.dx; rz += i.dz; }
  check('replay drops acked inputs', remaining.length === 2, `${remaining.length} still in flight`);
  check('replay reproduces predicted position', rx === 12.5 && rz === 11, `(${rx}, ${rz}) expected (12.5, 11)`);
}

// ── spell queue window ───────────────────────────────────────────────────
{
  const WINDOW = 400;
  const decide = (pressed, busy, queued, now) => {
    let abilities = pressed ? [pressed] : [];
    let q = queued;
    if (abilities.length && busy) { q = { id: abilities[0], at: now }; abilities = []; }
    else if (q) {
      if (now - q.at > WINDOW) q = null;
      else if (!busy) { abilities = [q.id]; q = null; }
    }
    return { abilities, q };
  };
  let r = decide('fireball', true, null, 1000);
  check('press while busy is queued, not dropped', r.abilities.length === 0 && r.q?.id === 'fireball');
  r = decide(null, false, r.q, 1200);
  check('queued ability fires when free', r.abilities[0] === 'fireball' && r.q === null, 'within 400ms');
  let r2 = decide('frostbolt', true, null, 1000);
  r2 = decide(null, false, r2.q, 1500);
  check('stale intent expires past the window', r2.abilities.length === 0 && r2.q === null, '500ms > 400ms');
  let r3 = decide('a', true, null, 1000);
  r3 = decide('b', true, r3.q, 1050);
  check('only the latest press is held', r3.q?.id === 'b');
}

console.log('  ' + '─'.repeat(56));
console.log(`  ${failures === 0 ? 'ALL NETCODE CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
process.exit(failures ? 1 : 0);
