// Live WS probe — connects to local server, starts a dungeon as a fake user
// (we directly invoke the start_dungeon message, bypassing real Cognito auth
// by using a hardcoded user we'll fake-authenticate via DB lookup).
// Then sends moveDir inputs and prints actual position over time.
//
// This is the definitive bubble test: if server moves the player, the bubble
// is client-side. If server keeps the player at -40, the bubble is server-side.
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3001');

// Spoof: server's auth token check. We'll bypass by directly using ws.userId
// = 'test'. The server's `case 'start_dungeon'` requires ws.userId, but ws.userId
// is set during `case 'auth'` after a real Cognito verify. Without auth, the
// dungeon won't start. So we use the existing test session approach... actually
// we'll simulate by using the admin endpoint to seed a fake user.
//
// Alternative: send a message with a known username -> sub mapping.
// For now this script will require an existing logged-in user. Edit USER_SUB
// to match the latest auth in the server log.

const USER_SUB = process.argv[2];
if (!USER_SUB) {
  console.log('Usage: node dungeon-ws-probe.mjs <user-sub>');
  console.log('Find sub from server log line "Auth ... authenticated"');
  process.exit(1);
}

ws.on('open', () => {
  console.log('WS open');
  // Skipping auth — server requires ws.userId from real verifyToken().
  // This probe approach won't work without modifying the server temporarily.
  console.log('NOTE: server requires real Cognito auth. Aborting.');
  process.exit(1);
});

ws.on('error', err => console.error('WS error:', err.message));
