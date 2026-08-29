import 'dotenv/config';
import http from 'http';
import express from 'express';
import { WebSocketServer } from 'ws';
import { GameRoom } from './GameRoom.js';
import { CLASS_REGISTRY } from '../src/classes/ClassRegistry.js';

// Dungeon is local-dev only. Prod must NEVER load dungeon code paths.
// Set EC_DUNGEON_ENABLED=1 in your local server .env to opt in.
const DUNGEON_ENABLED = process.env.EC_DUNGEON_ENABLED === '1';
let DungeonRoom = null;
if (DUNGEON_ENABLED) {
  ({ DungeonRoom } = await import('./dungeon/DungeonRoom.js'));
  console.log('[Dungeon] Enabled (EC_DUNGEON_ENABLED=1) — dev mode only');
}
import { verifyToken } from './auth.js';
import * as db from './db.js';
import { MASTERY_TITLES, ACCOUNT_TITLES } from './db.js';
import { calculateEloChange } from './elo.js';
import { Matchmaker, TeamMatchmaker } from './Matchmaker.js';
import { notifyAdminNewSignup } from './notifier.js';
import { forumRouter } from './forum.js';
import { startChallengeScheduler, getActiveChallenges, forceGenerate } from './challenges.js';
import Stripe from 'stripe';

const PORT = process.env.PORT || 3001;
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

const COIN_PACKAGES = {
  coins_500:  { coins: 500,  priceUsd: 299,  label: '500 Coins', description: 'Starter Pack' },
  coins_1500: { coins: 1500, priceUsd: 799,  label: '1,500 Coins', bonus: '15% Bonus', description: 'Adventurer Pack' },
  coins_3500: { coins: 3500, priceUsd: 1499, label: '3,500 Coins', bonus: '40% Bonus', description: 'Champion Pack' },
  coins_8000: { coins: 8000, priceUsd: 2999, label: '8,000 Coins', bonus: '60% Bonus', description: 'Legend Pack' },
};
const WS_OPEN = 1;
const VALID_CLASSES = ['tyrant', 'wraith', 'infernal', 'harbinger', 'revenant'];

// ── Server-authoritative shop catalog (prices MUST be looked up here, never trust client) ──
const SHOP_PRICES = {
  frame_iron: 150, frame_crimson: 300, frame_frost: 500, frame_arcane: 500, frame_emerald: 500,
  frame_shadow: 1200, frame_inferno: 1200, frame_celestial: 2500, frame_void: 2500, frame_ebon: 5000,
  portrait_battle: 200, portrait_shadow: 400, portrait_frost: 400, portrait_infernal: 400,
  portrait_spectral: 1000, portrait_void: 1800, portrait_golden: 4000,
  title_slayer: 150, title_phantom: 400, title_doomcaller: 1000, title_ebon_lord: 5000,
  // Skins
  skin_tyrant_frost_dragon: 5000,
  skin_tyrant_ashen_overlord: 2500,
  skin_wraith_frozen_reaper: 3500,
  skin_infernal_frost_dragon_skeleton_inspired_ice_wizar: 5000,
  skin_harbinger_frozen_ice_dragon_skeleton_warlock: 5000,
  skin_revenant_frozen_ice_holy_paladin_fallen_dragon: 5000,
  skin_tyrant_forest_inspired_dark_bear_skin: 8000,
};

// ── Rate limiter (per-connection, sliding window) ──
function checkRateLimit(ws, category, maxPerWindow, windowMs = 10000) {
  if (!ws._rateLimits) ws._rateLimits = {};
  const now = Date.now();
  if (!ws._rateLimits[category]) ws._rateLimits[category] = [];
  const bucket = ws._rateLimits[category];
  while (bucket.length > 0 && bucket[0] < now - windowMs) bucket.shift();
  if (bucket.length >= maxPerWindow) return false;
  bucket.push(now);
  return true;
}

// Express app for REST API (forum + payments)
const app = express();

// ── Stripe webhook (raw body needed for signature — must be before express.json) ──
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Payments not configured' });
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[Stripe Webhook] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { sub, packageId } = session.metadata || {};
    const pkg = COIN_PACKAGES[packageId];
    if (!sub || !pkg) {
      console.error('[Stripe Webhook] Missing metadata:', { sub, packageId });
      return res.status(400).json({ error: 'Invalid metadata' });
    }
    const existing = await db.getPaymentRecord(sub, session.id);
    if (existing) {
      console.log(`[Stripe Webhook] Already processed: ${session.id}`);
      return res.json({ received: true, duplicate: true });
    }
    try {
      const result = await db.grantPurchasedCoins(sub, session.id, packageId, pkg.coins, pkg.priceUsd);
      console.log(`[Stripe Webhook] Granted ${pkg.coins} coins to ${sub} (session: ${session.id})`);
      const playerWs = onlineUsers.get(sub);
      if (playerWs?.readyState === WS_OPEN) {
        playerWs.send(JSON.stringify({ type: 'coins_purchased', coins: pkg.coins, packageId, newCoins: result.newCoins }));
        if (playerWs.userProfile) playerWs.userProfile.coins = result.newCoins;
      }
    } catch (err) {
      if (err.name === 'TransactionCanceledException') {
        console.log(`[Stripe Webhook] Idempotent retry caught for ${session.id}`);
        return res.json({ received: true, duplicate: true });
      }
      console.error('[Stripe Webhook] Grant failed:', err.message);
      return res.status(500).json({ error: 'Failed to grant coins' });
    }
  }
  if (event.type === 'charge.refunded') {
    const charge = event.data.object;
    try {
      const sessions = await stripe.checkout.sessions.list({ payment_intent: charge.payment_intent, limit: 1 });
      const session = sessions.data[0];
      if (!session?.metadata?.sub) {
        console.error('[Stripe Webhook] Refund: no session found for PI:', charge.payment_intent);
        return res.json({ received: true });
      }
      const { sub, packageId } = session.metadata;
      const pkg = COIN_PACKAGES[packageId];
      if (!pkg) {
        console.error('[Stripe Webhook] Refund: unknown package:', packageId);
        return res.json({ received: true });
      }
      const paymentRecord = await db.getPaymentRecord(sub, session.id);
      if (!paymentRecord || paymentRecord.status === 'refunded') {
        console.log(`[Stripe Webhook] Refund: already refunded or no record for ${session.id}`);
        return res.json({ received: true, duplicate: true });
      }
      const result = await db.refundPayment(sub, session.id, charge.id, pkg.coins);
      console.log(`[Stripe Webhook] Refunded ${pkg.coins} coins from ${sub} (session: ${session.id}, charge: ${charge.id})`);
      const playerWs = onlineUsers.get(sub);
      if (playerWs?.readyState === WS_OPEN) {
        playerWs.send(JSON.stringify({ type: 'coins_refunded', coins: pkg.coins, newCoins: result.newCoins }));
        if (playerWs.userProfile) playerWs.userProfile.coins = result.newCoins;
      }
    } catch (err) {
      console.error('[Stripe Webhook] Refund failed:', err.message);
      return res.status(500).json({ error: 'Failed to process refund' });
    }
  }
  res.json({ received: true });
});

app.use(express.json({ limit: '1mb' }));
// Security headers
app.use((req, res, next) => {
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'DENY');
  res.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
const ALLOWED_ORIGINS = [
  'https://eboncrucible.com', 'https://www.eboncrucible.com',
  'http://localhost:5173', 'http://localhost:3000',
  'http://127.0.0.1:17381',  // Electron local server
  'capacitor://localhost',    // Capacitor iOS
  'http://localhost',         // Capacitor Android
];
app.use('/api/forum', (req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use('/api/forum', forumRouter);

// ── Stripe Checkout Creation ──
app.use('/api/payments', (req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.post('/api/payments/create-checkout', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Payments not configured' });
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
  let sub;
  try {
    const verified = await verifyToken(header.slice(7));
    sub = verified.sub;
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  const { packageId } = req.body;
  const pkg = COIN_PACKAGES[packageId];
  if (!pkg) return res.status(400).json({ error: 'Invalid package' });
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: pkg.label,
            description: pkg.description + (pkg.bonus ? ` (${pkg.bonus})` : ''),
          },
          unit_amount: pkg.priceUsd,
        },
        quantity: 1,
      }],
      metadata: { sub, packageId },
      success_url: 'https://eboncrucible.com/play/?payment=success',
      cancel_url: 'https://eboncrucible.com/play/?payment=cancel',
    });
    console.log(`[Stripe] Checkout session created: ${session.id} for ${sub} (${packageId})`);
    res.json({ url: session.url });
  } catch (err) {
    console.error('[Stripe] Session creation failed:', err.message);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// ── Contact Form ──
app.use('/api/contact', (req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, subject, message, type } = req.body;
    if (!email || !message || !subject) return res.status(400).json({ error: 'Missing required fields' });
    if (message.length > 5000) return res.status(400).json({ error: 'Message too long' });
    const item = {
      PK: 'CONTACT',
      SK: `MSG#${Date.now()}#${Math.random().toString(36).slice(2, 8)}`,
      name: (name || 'Anonymous').slice(0, 100),
      email: email.slice(0, 200),
      subject: subject.slice(0, 200),
      message: message.slice(0, 5000),
      type: (type || 'general').slice(0, 50),
      createdAt: new Date().toISOString(),
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
    };
    await db.putSystemRecord(item);
    console.log(`[Contact] New message from ${email}: ${subject}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Contact] Error:', err.message);
    res.status(500).json({ error: 'Failed to submit' });
  }
});

// ── Client error beacon ────────────────────────────────────────────────────
// Browser sends unhandled errors and ability-VFX failures here so we can find
// bugs without depending on players to report them. Rate-limited per-IP to
// keep an attacker from flooding our logs. Stored as JSONL to /var/log so we
// can grep them later.
const _clientErrLastSeen = new Map(); // ip -> timestamp
app.use('/api/client-error', (req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.post('/api/client-error', async (req, res) => {
  try {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    // Rate-limit: 1 beacon per IP per 2 seconds. Anything more and we drop
    // silently — the client dedupes per-message, so this is just spam defense.
    const now = Date.now();
    const last = _clientErrLastSeen.get(ip) || 0;
    if (now - last < 2000) return res.json({ ok: true, throttled: true });
    _clientErrLastSeen.set(ip, now);
    // Keep the map bounded
    if (_clientErrLastSeen.size > 5000) {
      const cutoff = now - 60000;
      for (const [k, v] of _clientErrLastSeen) if (v < cutoff) _clientErrLastSeen.delete(k);
    }
    const { msg, message, stack, url, userAgent, ts, build } = req.body || {};
    const record = {
      ts: ts || new Date().toISOString(),
      ip: String(ip).slice(0, 64),
      msg: String(msg || '').slice(0, 200),
      message: String(message || '').slice(0, 500),
      stack: String(stack || '').slice(0, 4000),
      url: String(url || '').slice(0, 300),
      ua: String(userAgent || '').slice(0, 200),
      build: String(build || '').slice(0, 80),
    };
    // Tagged stdout — pm2 logs picks this up so `pm2 logs ebon-pvp | grep CLIENT_ERR`
    // surfaces every reported issue with full context.
    console.log(`[CLIENT_ERR] ${JSON.stringify(record)}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[CLIENT_ERR] handler failed:', err.message);
    res.status(500).json({ error: 'beacon failed' });
  }
});

const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer });

const rooms = new Map(); // roomCode -> GameRoom

// ── Username profanity filter ─────────────────────────────────────────
// Keep the list short and high-signal. Goal: stop slurs and obvious sexual
// usernames at signup; not exhaustive moderation. Operators review flagged
// accounts via the admin dashboard.
//
// `isProhibitedUsername` normalizes leetspeak (`1`→`i`, `0`→`o`, `3`→`e`,
// `4`→`a`, `5`→`s`, `7`→`t`, `@`→`a`, `$`→`s`) and strips underscores so
// trivial obfuscations don't slip through (`N1gger`, `Pen_1s_Master`, etc).
const PROHIBITED_USERNAME_PATTERNS = [
  // Hate speech / slurs
  /\bnigger/, /\bnigga/, /\bn[i1!]gg/, /\bfag(g?o?t?)/, /\bretard/,
  /\bkike/, /\bspic\b/, /\bchink/, /\bgook/, /\btranny/, /\bdyke/,
  /\bcoon\b/, /\bjap\b/, /\bwetback/, /\btowelhead/,
  // Sexual / explicit
  /\bpenis/, /\bcock\b/, /\bdick(head)?/, /\bcum\b/, /\bsemen/,
  /\bfuck/, /\bshit/, /\bcunt/, /\bpussy/, /\btwat/, /\bbitch/,
  /\bwhore/, /\bslut/, /\brape/, /\bsex\b/, /\bporn/, /\banal/,
  // Nazi / extremist
  /\bnazi/, /\bhitler/, /\b1488\b/, /\b88\b.*\bwhite/, /\bswastika/,
  /\bkkk\b/, /\bisis\b/, /\bgenocide/,
];

function normalizeUsername(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[_\-\.]/g, '')
    .replace(/[1!|]/g, 'i')
    .replace(/0/g, 'o')
    .replace(/3/g, 'e')
    .replace(/4|@/g, 'a')
    .replace(/5|\$/g, 's')
    .replace(/7/g, 't');
}

function isProhibitedUsername(username) {
  const normalized = normalizeUsername(username);
  return PROHIBITED_USERNAME_PATTERNS.some(re => re.test(normalized));
}

// Chat moderation — stricter on slurs/hate speech, lenient on regular cursing.
// People swear normally ("damn", "shit", "fuck"); blocking those produces
// a sterile, sanitized vibe that doesn't fit a dark-fantasy game. The line:
// hate speech, explicit harassment, sexual content directed at others.
const PROHIBITED_CHAT_PATTERNS = [
  // Hate speech / slurs (same normalization as username)
  /\bnigger/, /\bnigga/, /\bn[i1!]gg/, /\bfag(g?o?t?)/, /\bretard/,
  /\bkike/, /\bspic\b/, /\bchink/, /\bgook/, /\btranny/, /\bdyke\b/,
  /\bcoon\b/, /\bjap\b/, /\bwetback/, /\btowelhead/, /\bsandni/,
  // Nazi / extremist
  /\bnazi/, /\bhitler/, /\bheil\b/, /\b1488\b/, /\bswastika/,
  /\bkkk\b/, /\bgenocide/, /\bgas.*jews/,
  // Explicit sexual / harassment (sexual harassment, not casual cursing)
  /\bcum.{0,3}slut/, /\brape/, /\bpedo/, /\bchild.*porn/, /\bchildp/,
  /\bkill.{0,5}yourself/, /\bkys\b/,
];

function isProhibitedChat(text) {
  // Use same normalization as usernames so leetspeak doesn't bypass
  const normalized = normalizeUsername(text);
  return PROHIBITED_CHAT_PATTERNS.some(re => re.test(normalized));
}

const matchmaker = new Matchmaker();
const teamMatchmaker = new TeamMatchmaker();
const onlineUsers = new Map(); // sub -> ws (for presence + social features)
const pendingGameInvites = new Map(); // inviterSub -> { inviterWs, targetSub, classId, timestamp }

// ── Async Wager Duel Config ──
const WAGER_TIERS = { 50: 1.5, 100: 2.0, 250: 2.5, 500: 3.0 };
const MAX_OUTGOING_DUELS = 3;
const DUEL_PENDING_EXPIRY_MS = 48 * 60 * 60 * 1000;  // 48h
const DUEL_MATCH_WINDOW_MS = 24 * 60 * 60 * 1000;    // 24h
const DUEL_SWEEP_INTERVAL_MS = 5 * 60 * 1000;         // 5min sweep

// ── Global Chat ──
const globalChatSubscribers = new Set(); // Set<WebSocket>
const globalChatBuffer = [];             // Ring buffer (last 100 messages)
const GLOBAL_CHAT_BUFFER_SIZE = 100;

function broadcastToAll(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach((ws) => {
    if (ws.readyState === WS_OPEN && ws.authenticated) {
      ws.send(data);
    }
  });
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Matchmaker creates ranked rooms when two players are matched
matchmaker.onMatch = (playerA, subA, playerB, subB) => {
  let code = generateRoomCode();
  while (rooms.has(code)) code = generateRoomCode();

  const room = new GameRoom(code, {
    ranked: true,
    playerMeta: {
      0: { sub: subA, elo: playerA.elo, rating: playerA.ws?.userProfile?.rating || 0, username: playerA.username, classId: playerA.classId, currentStreak: playerA.currentStreak || 0, activeFrame: playerA.activeFrame || null, activeTitle: playerA.ws?.userProfile?.activeTitle || null, avatarClass: playerA.ws?.userProfile?.avatarClass || null, activeSkin: playerA.activeSkin || null },
      1: { sub: subB, elo: playerB.elo, rating: playerB.ws?.userProfile?.rating || 0, username: playerB.username, classId: playerB.classId, currentStreak: playerB.currentStreak || 0, activeFrame: playerB.activeFrame || null, activeTitle: playerB.ws?.userProfile?.activeTitle || null, avatarClass: playerB.ws?.userProfile?.avatarClass || null, activeSkin: playerB.activeSkin || null },
    },
  });
  room.onChampionUpdate = (updates) => broadcastToAll({ type: 'champion_update', updates });
  rooms.set(code, room);

  room.addPlayer(playerA.ws, playerA.classId, 0);
  playerA.ws.roomCode = code;
  playerA.ws.slot = 0;
  playerA.ws.playerSlot = 0;

  room.addPlayer(playerB.ws, playerB.classId, 1);
  playerB.ws.roomCode = code;
  playerB.ws.slot = 1;
  playerB.ws.playerSlot = 1;

  // Notify both that they've been matched
  if (playerA.ws.readyState === WS_OPEN) {
    playerA.ws.send(JSON.stringify({ type: 'match_found', opponent: playerB.username, opponentElo: playerB.elo }));
  }
  if (playerB.ws.readyState === WS_OPEN) {
    playerB.ws.send(JSON.stringify({ type: 'match_found', opponent: playerA.username, opponentElo: playerA.elo }));
  }

  room.startMatch();
  console.log(`[Room ${code}] Ranked match: ${playerA.username} (${playerA.classId}) vs ${playerB.username} (${playerB.classId})`);

  // ── Champion match detection — notify bettors ──
  (async () => {
    try {
      const classIds = [playerA.classId, playerB.classId];
      for (const classId of classIds) {
        const champ = await db.getClassChampion(classId);
        if (!champ?.playerSub) continue;
        // Check if either player IS the champion
        const isChampMatch = champ.playerSub === subA || champ.playerSub === subB;
        if (!isChampMatch) continue;

        room.isChampionMatch = true;
        room.championClassId = classId;

        const champPlayer = champ.playerSub === subA
          ? { username: playerA.username, classId: playerA.classId }
          : { username: playerB.username, classId: playerB.classId };
        const oppPlayer = champ.playerSub === subA
          ? { username: playerB.username, classId: playerB.classId }
          : { username: playerA.username, classId: playerA.classId };

        // Notify all bettors who bet on this class
        const bets = await db.getActiveBetsForClass(classId);
        const notification = {
          type: 'champion_match_starting',
          roomCode: code,
          championClass: classId,
          championUsername: champPlayer.username,
          opponentClass: oppPlayer.classId,
          opponentUsername: oppPlayer.username,
        };
        for (const bet of bets) {
          const bettorSub = bet.PK.replace('PLAYER#', '');
          const bettorWs = onlineUsers.get(bettorSub);
          if (bettorWs?.readyState === WS_OPEN) {
            bettorWs.send(JSON.stringify(notification));
          }
        }

        // Broadcast to global chat
        const sysMsg = `[CHAMPION] ${champPlayer.username}'s ${classId} throne is being challenged by ${oppPlayer.username}!`;
        const globalMsg = { channelId: 'global', fromSub: 'system', fromUsername: 'SYSTEM', text: sysMsg, timestamp: Date.now() };
        globalChatBuffer.push(globalMsg);
        if (globalChatBuffer.length > GLOBAL_CHAT_BUFFER_SIZE) globalChatBuffer.shift();
        const data = JSON.stringify({ type: 'channel_message', ...globalMsg });
        for (const sub of globalChatSubscribers) {
          if (sub.readyState === WS_OPEN) sub.send(data);
        }

        console.log(`[Champion Match] ${champPlayer.username} (${classId}) vs ${oppPlayer.username} — ${bets.length} bettors notified`);
        break; // Only notify for the first champion found
      }
    } catch (err) {
      console.error('[Champion Match Detection] Error:', err.message);
    }
  })();
};

// TeamMatchmaker creates 2v2 ranked rooms when two teams are matched
teamMatchmaker.onMatch = (team0, team1) => {
  let code = generateRoomCode();
  while (rooms.has(code)) code = generateRoomCode();

  const playerMeta = {};
  const allPlayers = [...team0, ...team1]; // slots 0,1 = team0, slots 2,3 = team1
  for (let i = 0; i < allPlayers.length; i++) {
    const p = allPlayers[i];
    playerMeta[i] = {
      sub: p.sub, elo: p.elo, rating: p.ws?.userProfile?.rating || 0, username: p.username, classId: p.classId,
      currentStreak: p.currentStreak || 0, activeFrame: p.activeFrame || null,
      activeTitle: p.activeTitle || p.ws?.userProfile?.activeTitle || null,
      avatarClass: p.ws?.userProfile?.avatarClass || null,
    };
  }

  const room = new GameRoom(code, { ranked: true, mode: '2v2', playerMeta });
  room.onChampionUpdate = (updates) => broadcastToAll({ type: 'champion_update', updates });
  rooms.set(code, room);

  for (let i = 0; i < allPlayers.length; i++) {
    const p = allPlayers[i];
    room.addPlayer(p.ws, p.classId, i);
    p.ws.roomCode = code;
    p.ws.playerSlot = i;
    p.ws.slot = i;
  }

  // Notify all players
  for (let i = 0; i < allPlayers.length; i++) {
    const p = allPlayers[i];
    const team = Math.floor(i / 2);
    const allies = allPlayers.filter((_, j) => Math.floor(j / 2) === team && j !== i);
    const enemies = allPlayers.filter((_, j) => Math.floor(j / 2) !== team);
    if (p.ws.readyState === WS_OPEN) {
      p.ws.send(JSON.stringify({
        type: 'match_found',
        mode: '2v2',
        ally: allies[0]?.username || null,
        opponents: enemies.map(e => ({ username: e.username, elo: e.elo })),
      }));
    }
  }

  room.startMatch();
  console.log(`[Room ${code}] 2v2 Ranked: ${team0.map(p => p.username).join('+')} vs ${team1.map(p => p.username).join('+')}`);
};

matchmaker.start();
teamMatchmaker.start();
startChallengeScheduler();

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.authenticated = false;
  ws.userId = null;
  ws.userProfile = null;

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      // ── Authentication ──────────────────────────────────────────────
      case 'authenticate': {
        try {
          const { sub, email } = await verifyToken(msg.token);
          ws.authenticated = true;
          ws.userId = sub;
          ws.userEmail = email;
          // Close any existing connection for this user (single-session enforcement)
          const existingWs = onlineUsers.get(sub);
          if (existingWs && existingWs !== ws && existingWs.readyState === WS_OPEN) {
            existingWs.send(JSON.stringify({ type: 'session_replaced', message: 'Logged in from another session' }));
            existingWs.close(4000, 'Session replaced');
          }
          const profile = await db.getProfile(sub);
          if (profile?.banned) {
            // Stash auth state so the appeal handler can clear the ban
            ws.userId = sub;
            ws.userEmail = email;
            ws.authenticated = true;
            ws.send(JSON.stringify({
              type: 'auth_banned',
              reason: profile.banReason || 'Violation of terms',
              canAppeal: true, // Allow self-service rename for first offense
            }));
            break;
          }
          ws.userProfile = profile;
          onlineUsers.set(sub, ws);
          // Attach cognitoSub so client can identify itself
          const profilePayload = profile ? {
            ...profile,
            cognitoSub: sub,
            rating: profile.rating != null ? profile.rating : Math.max(0, Math.round((profile.elo || 1500) - 1500)),
            peakRating: profile.peakRating != null ? profile.peakRating : Math.max(0, Math.round((profile.peakElo || profile.elo || 1500) - 1500)),
            seasonHighRating: profile.seasonHighRating != null ? profile.seasonHighRating : Math.max(0, Math.round((profile.seasonHighElo || profile.elo || 1500) - 1500)),
          } : null;
          ws.send(JSON.stringify({
            type: 'auth_success',
            profile: profilePayload,
          }));
          // Hydrate duel inbox on login
          if (profile) {
            db.getPlayerDuelInbox(sub).then(inbox => {
              if (inbox.incoming.length || inbox.outgoing.length || inbox.activeDuel) {
                ws.send(JSON.stringify({ type: 'duel_inbox', ...inbox }));
              }
            }).catch(err => console.error('[Duel] inbox hydration error:', err.message));
          }
          // Auto-join global chat
          globalChatSubscribers.add(ws);
          ws.send(JSON.stringify({ type: 'channel_history', channelId: 'global', messages: [...globalChatBuffer] }));
          console.log(`[Auth] ${email} authenticated (${profile ? profile.username : 'new user'})`);
        } catch (err) {
          ws.send(JSON.stringify({ type: 'auth_error', message: 'Invalid token' }));
          console.log(`[Auth] Failed: ${err.message}`);
        }
        break;
      }

      case 'appeal_ban': {
        // Banned user requesting a fresh start. Clear ban + username so the
        // next set_username runs through the filter as a brand-new account.
        if (!ws.userId) break;
        try {
          await db.adminClearBan(ws.userId);
          ws.send(JSON.stringify({ type: 'appeal_accepted', message: 'Your account is reinstated. Choose a new username — offensive names will permanently ban this account.' }));
          console.log(`[Appeal] ${ws.userEmail} cleared ban; awaiting new username`);
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', message: 'Could not process appeal. Try again later.' }));
          console.error(`[Appeal] failed for ${ws.userEmail}:`, err.message);
        }
        break;
      }

      case 'set_username': {
        if (!ws.authenticated) break;
        const username = msg.username?.trim();
        if (!/^[a-zA-Z0-9_]{3,16}$/.test(username)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid username (3-16 chars, letters/numbers/underscore)' }));
          break;
        }
        // Profanity / hate-speech filter — reject and flag the account.
        // Normalizes leetspeak and underscores so trivial obfuscations don't
        // pass (`N1gger`, `Pen1s_Master`, etc).
        if (isProhibitedUsername(username)) {
          ws.send(JSON.stringify({ type: 'error', message: 'That username is not allowed. Please choose another.' }));
          console.log(`[Auth] BLOCKED offensive username "${username}" from ${ws.userEmail}`);
          // Notify admin so they can review the account
          try {
            notifyAdminNewSignup({
              email: ws.userEmail,
              username: `[BLOCKED] ${username}`,
              sub: ws.userId,
            });
          } catch {}
          break;
        }
        try {
          await db.reserveUsername(username, ws.userId);
          const profile = await db.createProfile(ws.userId, username);
          ws.userProfile = profile;
          ws.send(JSON.stringify({ type: 'username_set', profile: { ...profile, cognitoSub: ws.userId } }));
          console.log(`[Auth] ${ws.userEmail} chose username: ${username}`);
          // Fire-and-forget admin email notification
          notifyAdminNewSignup({ email: ws.userEmail, username, sub: ws.userId });
        } catch (err) {
          if (err.name === 'ConditionalCheckFailedException') {
            ws.send(JSON.stringify({ type: 'error', message: 'Username already taken' }));
          } else {
            ws.send(JSON.stringify({ type: 'error', message: 'Failed to set username' }));
            console.error(`[Auth] Username error:`, err);
          }
        }
        break;
      }

      // ── Matchmaking ─────────────────────────────────────────────────
      case 'queue_join': {
        if (!ws.authenticated || !ws.userProfile) {
          ws.send(JSON.stringify({ type: 'error', message: 'Must be logged in to queue' }));
          break;
        }
        if (!VALID_CLASSES.includes(msg.classId)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid class' }));
          break;
        }
        // Use per-class ELO for matchmaking (fall back to global if no classElos yet)
        const classElo = ws.userProfile.classElos?.[msg.classId]?.elo ?? ws.userProfile.elo;
        // Skin: prefer what client selected, fall back to profile equipped skin
        const activeSkin = msg.skinId || ws.userProfile.activeSkins?.[msg.classId] || null;
        matchmaker.addToQueue(ws.userId, ws, msg.classId, classElo, ws.userProfile.username, ws.userProfile.currentStreak || 0, ws.userProfile.activeFrame || null, ws.userProfile.activeTitle || null, activeSkin);
        break;
      }

      case 'queue_cancel': {
        if (!ws.authenticated) break;
        matchmaker.removeFromQueue(ws.userId);
        ws.send(JSON.stringify({ type: 'queue_cancelled' }));
        break;
      }

      // ── 2v2 Matchmaking ──────────────────────────────────────────────
      case 'queue_join_2v2': {
        if (!ws.authenticated || !ws.userProfile) {
          ws.send(JSON.stringify({ type: 'error', message: 'Must be logged in to queue' }));
          break;
        }
        if (!VALID_CLASSES.includes(msg.classId)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid class' }));
          break;
        }
        const classElo2v2 = ws.userProfile.classElos?.[msg.classId]?.elo ?? ws.userProfile.elo;
        teamMatchmaker.addSoloToQueue(ws.userId, ws, msg.classId, classElo2v2, ws.userProfile.username, ws.userProfile.currentStreak || 0, ws.userProfile.activeFrame || null, ws.userProfile.activeTitle || null);
        break;
      }

      case 'queue_join_2v2_duo': {
        if (!ws.authenticated || !ws.userProfile) {
          ws.send(JSON.stringify({ type: 'error', message: 'Must be logged in to queue' }));
          break;
        }
        if (!VALID_CLASSES.includes(msg.classId)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid class' }));
          break;
        }
        const partnerSub = msg.partnerSub;
        if (!partnerSub) {
          ws.send(JSON.stringify({ type: 'error', message: 'Partner required for duo queue' }));
          break;
        }
        const partnerWs = onlineUsers.get(partnerSub);
        if (!partnerWs || partnerWs.readyState !== WS_OPEN) {
          ws.send(JSON.stringify({ type: 'error', message: 'Partner is not online' }));
          break;
        }
        // Partner must have also sent a duo queue with this player as partner
        // For simplicity, the leader queues with both class selections
        const partnerClassId = msg.partnerClassId || 'tyrant';
        if (!VALID_CLASSES.includes(partnerClassId)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid partner class' }));
          break;
        }
        const leaderElo = ws.userProfile.classElos?.[msg.classId]?.elo ?? ws.userProfile.elo;
        const partnerProfile = partnerWs.userProfile;
        const partnerElo = partnerProfile?.classElos?.[partnerClassId]?.elo ?? partnerProfile?.elo ?? 1500;
        teamMatchmaker.addDuoToQueue(ws.userId, [
          { sub: ws.userId, ws, classId: msg.classId, elo: leaderElo, username: ws.userProfile.username, currentStreak: ws.userProfile.currentStreak || 0, activeFrame: ws.userProfile.activeFrame || null, activeTitle: ws.userProfile.activeTitle || null },
          { sub: partnerSub, ws: partnerWs, classId: partnerClassId, elo: partnerElo, username: partnerProfile?.username || 'Partner', currentStreak: partnerProfile?.currentStreak || 0, activeFrame: partnerProfile?.activeFrame || null, activeTitle: partnerProfile?.activeTitle || null },
        ]);
        break;
      }

      case 'queue_leave_2v2': {
        if (!ws.authenticated) break;
        teamMatchmaker.removeFromQueue(ws.userId);
        ws.send(JSON.stringify({ type: 'queue_cancelled' }));
        break;
      }

      // ── 2v2 Party Invites ────────────────────────────────────────────
      case 'send_party_invite_2v2': {
        if (!ws.authenticated) break;
        const target = onlineUsers.get(msg.toSub);
        if (target && target.readyState === 1) {
          target.send(JSON.stringify({
            type: 'party_invite_2v2',
            fromSub: ws.userId,
            fromUsername: ws.userProfile?.username || 'Unknown',
            mode: msg.mode || 'ranked'
          }));
        } else {
          ws.send(JSON.stringify({ type: 'error', message: 'Player is not online' }));
        }
        break;
      }
      case 'accept_party_invite_2v2': {
        if (!ws.authenticated) break;
        const leader = onlineUsers.get(msg.fromSub);
        if (leader && leader.readyState === 1) {
          leader.send(JSON.stringify({
            type: 'party_accepted_2v2',
            fromSub: ws.userId,
            fromUsername: ws.userProfile?.username || 'Unknown',
            classId: msg.classId || 'tyrant'
          }));
        }
        break;
      }
      case 'decline_party_invite_2v2': {
        if (!ws.authenticated) break;
        const declineTarget = onlineUsers.get(msg.fromSub);
        if (declineTarget && declineTarget.readyState === 1) {
          declineTarget.send(JSON.stringify({
            type: 'party_declined_2v2',
            fromSub: ws.userId,
            fromUsername: ws.userProfile?.username || 'Unknown'
          }));
        }
        break;
      }
      case 'party_ready': {
        if (!ws.authenticated) break;
        const readyTarget = onlineUsers.get(msg.partnerSub);
        if (readyTarget && readyTarget.readyState === 1) {
          readyTarget.send(JSON.stringify({
            type: 'party_ready',
            fromSub: ws.userId,
            ready: msg.ready
          }));
        }
        break;
      }
      case 'update_party_class': {
        if (!ws.authenticated) break;
        const classTarget = onlineUsers.get(msg.partnerSub);
        if (classTarget && classTarget.readyState === 1) {
          classTarget.send(JSON.stringify({
            type: 'party_class_update',
            fromSub: ws.userId,
            classId: msg.classId
          }));
        }
        break;
      }
      case 'leave_party_2v2': {
        if (!ws.authenticated) break;
        if (msg.partnerSub) {
          const partner = onlineUsers.get(msg.partnerSub);
          if (partner && partner.readyState === 1) {
            partner.send(JSON.stringify({ type: 'party_left_2v2', fromSub: ws.userId }));
          }
        }
        break;
      }

      // ── Co-op 2v2 Practice ─────────────────────────────────────────
      case 'start_coop_practice': {
        if (!ws.authenticated) break;
        const { classId, partnerSub, partnerClassId, enemy1ClassId, enemy2ClassId } = msg;
        if (!VALID_CLASSES.includes(classId) || !VALID_CLASSES.includes(partnerClassId) ||
            !VALID_CLASSES.includes(enemy1ClassId) || !VALID_CLASSES.includes(enemy2ClassId)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid class selection' }));
          break;
        }
        const partnerWs = onlineUsers.get(partnerSub);
        if (!partnerWs || partnerWs.readyState !== WS_OPEN) {
          ws.send(JSON.stringify({ type: 'error', message: 'Partner is not online' }));
          break;
        }
        let code = generateRoomCode();
        while (rooms.has(code)) code = generateRoomCode();
        const room = new GameRoom(code, {
          mode: '2v2',
          practice: true,
          ranked: false,
          playerMeta: {
            0: { sub: ws.userId, username: ws.userProfile?.username || 'Player 1', classId, elo: ws.userProfile?.elo || 1500, rating: ws.userProfile?.rating || 0, activeFrame: ws.userProfile?.activeFrame || null, activeTitle: ws.userProfile?.activeTitle || null },
            1: { sub: partnerSub, username: partnerWs.userProfile?.username || 'Player 2', classId: partnerClassId, elo: partnerWs.userProfile?.elo || 1500, rating: partnerWs.userProfile?.rating || 0, activeFrame: partnerWs.userProfile?.activeFrame || null, activeTitle: partnerWs.userProfile?.activeTitle || null },
            2: { username: 'AI Enemy', classId: enemy1ClassId },
            3: { username: 'AI Enemy', classId: enemy2ClassId },
          },
        });
        rooms.set(code, room);
        room.addPlayer(ws, classId, 0);
        ws.roomCode = code;
        ws.slot = 0;
        room.addPlayer(partnerWs, partnerClassId, 1);
        partnerWs.roomCode = code;
        partnerWs.slot = 1;
        room.addAIPlayer(enemy1ClassId, 2);
        room.addAIPlayer(enemy2ClassId, 3);
        console.log(`[Room ${code}] Co-op 2v2 Practice: ${ws.userProfile?.username} (${classId}) + ${partnerWs.userProfile?.username} (${partnerClassId}) vs AI (${enemy1ClassId}, ${enemy2ClassId})`);
        room.startMatch();
        break;
      }

      // ── Profile / Stats ─────────────────────────────────────────────
      case 'get_profile': {
        if (!ws.authenticated) break;
        let profile = await db.getProfile(ws.userId);
        if (profile && !profile.masteryMigrated) {
          profile = await db.migrateClassMastery(ws.userId);
        }
        ws.userProfile = profile;
        ws.send(JSON.stringify({ type: 'profile', profile: profile ? { ...profile, cognitoSub: ws.userId } : null }));
        break;
      }

      case 'get_match_history': {
        if (!ws.authenticated) break;
        const history = await db.getMatchHistory(ws.userId, 10);
        ws.send(JSON.stringify({ type: 'match_history', matches: history }));
        break;
      }

      case 'get_leaderboard': {
        if (!checkRateLimit(ws, 'leaderboard', 5, 60000)) break;
        const leaderboard = await db.getLeaderboard(20);
        // Strip internal sub IDs — only mark which entry is the requesting user
        const sanitized = leaderboard.map(entry => {
          const { sub, ...safe } = entry;
          if (ws.authenticated && sub === ws.userId) safe.isYou = true;
          return safe;
        });
        ws.send(JSON.stringify({ type: 'leaderboard', entries: sanitized }));
        break;
      }

      // ── Custom Room (unchanged, no auth required) ───────────────────
      case 'create_room': {
        if (!VALID_CLASSES.includes(msg.classId)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid class' }));
          break;
        }
        let code = generateRoomCode();
        while (rooms.has(code)) code = generateRoomCode();
        const room = new GameRoom(code);
        rooms.set(code, room);
        room.addPlayer(ws, msg.classId, 0);
        ws.roomCode = code;
        ws.playerSlot = 0;
        ws.slot = 0;
        ws.send(JSON.stringify({ type: 'room_created', roomCode: code, slot: 0 }));
        console.log(`[Room ${code}] Created by player (${msg.classId})`);
        break;
      }

      case 'join_room': {
        if (!VALID_CLASSES.includes(msg.classId)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid class' }));
          break;
        }
        const code = msg.roomCode?.toUpperCase();
        const room = rooms.get(code);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
          break;
        }
        if (room.isFull()) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room is full' }));
          break;
        }
        room.addPlayer(ws, msg.classId, 1);
        ws.roomCode = code;
        ws.playerSlot = 1;
        ws.slot = 1;
        ws.send(JSON.stringify({ type: 'room_joined', roomCode: code, slot: 1 }));
        console.log(`[Room ${code}] Player 2 joined (${msg.classId})`);

        if (room.isFull()) {
          room.startMatch();
        }
        break;
      }

      case 'player_loaded': {
        const loadRoom = rooms.get(ws.roomCode);
        if (loadRoom && ws.slot != null) {
          loadRoom.playerLoaded(ws.slot);
        }
        break;
      }

      case 'input': {
        const room = rooms.get(ws.roomCode);
        if (room) {
          room.handleInput(ws, msg);
        }
        break;
      }

      // ── Dungeon (PvE) ─────────────────────────────────────────────
      // All dungeon handlers are gated on DUNGEON_ENABLED (set via env).
      // In production this is always false, so these messages are no-ops.
      case 'start_dungeon': {
        if (!DUNGEON_ENABLED) break;
        if (!ws.userId) {
          ws.send(JSON.stringify({ type: 'error', message: 'Must be logged in to start a dungeon' }));
          break;
        }
        if (!msg.classId || !CLASS_REGISTRY[msg.classId]) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid class for dungeon' }));
          break;
        }
        // If already in a room, kick them out of it first
        if (ws.roomCode && rooms.has(ws.roomCode)) {
          const oldRoom = rooms.get(ws.roomCode);
          oldRoom.handleDisconnect?.(ws);
          if (oldRoom.isEmpty?.()) {
            oldRoom.cleanup?.();
            rooms.delete(ws.roomCode);
          }
        }
        let code = generateRoomCode();
        while (rooms.has(code)) code = generateRoomCode();
        const tier = Math.max(1, Math.min(10, parseInt(msg.tier || 1) | 0));
        const dungeonRoom = new DungeonRoom(code, { tier });
        dungeonRoom.addPlayer(ws, msg.classId, ws.userId, ws.userProfile?.username || 'Adventurer');
        rooms.set(code, dungeonRoom);
        ws.roomCode = code;
        ws.slot = 0;
        dungeonRoom.startMatch();
        console.log(`[Dungeon] ${ws.userProfile?.username || ws.userEmail} started dungeon T${tier} as ${msg.classId} (room ${code})`);
        break;
      }

      case 'dungeon_pick_upgrade': {
        if (!DUNGEON_ENABLED) break;
        const dRoom = rooms.get(ws.roomCode);
        if (dRoom?.pickUpgrade) {
          dRoom.pickUpgrade(msg.upgradeId);
        }
        break;
      }

      case 'dungeon_ready': {
        if (!DUNGEON_ENABLED) break;
        const dRoom = rooms.get(ws.roomCode);
        if (dRoom?.playerReady) dRoom.playerReady();
        break;
      }

      case 'dungeon_exit': {
        if (!DUNGEON_ENABLED) break;
        const dRoom = rooms.get(ws.roomCode);
        if (dRoom?.cleanup) {
          dRoom.cleanup();
          rooms.delete(ws.roomCode);
          ws.roomCode = null;
          ws.slot = null;
        }
        break;
      }

      case 'dungeon_pause': {
        if (!DUNGEON_ENABLED) break;
        const dRoom = rooms.get(ws.roomCode);
        if (dRoom?.pauseRun) dRoom.pauseRun();
        break;
      }

      case 'dungeon_resume': {
        if (!DUNGEON_ENABLED) break;
        const dRoom = rooms.get(ws.roomCode);
        if (dRoom?.resumeRun) dRoom.resumeRun();
        break;
      }

      case 'dungeon_extract': {
        // Player chose EXTRACT at the exit portal. Bank pending gear + gems
        // to inventory and end the run safely.
        if (!DUNGEON_ENABLED) break;
        const dRoom = rooms.get(ws.roomCode);
        if (dRoom?.extractRun) dRoom.extractRun();
        break;
      }

      case 'dungeon_abandon': {
        // Player hit "Abandon Dungeon" from the pause menu. End the run as a
        // defeat (banks unbanked coins, persists progress) and let the
        // client's onDungeonComplete handler tear down the HUD.
        if (!DUNGEON_ENABLED) break;
        const dRoom = rooms.get(ws.roomCode);
        if (dRoom?._endDungeonDeath && dRoom.roomState !== 'finished') {
          console.log(`[Dungeon ${dRoom.code}] ABANDONED by ${dRoom.player?.username || '?'}`);
          dRoom._endDungeonDeath();
        }
        break;
      }

      case 'dungeon_interact': {
        if (!DUNGEON_ENABLED) break;
        const dRoom = rooms.get(ws.roomCode);
        if (dRoom?.handleInteract) dRoom.handleInteract(ws, msg.featureId);
        break;
      }

      case 'dungeon_puzzle_solve': {
        if (!DUNGEON_ENABLED) break;
        const dRoom = rooms.get(ws.roomCode);
        if (dRoom?.handlePuzzleSolve) {
          dRoom.handlePuzzleSolve(ws, msg.featureId, msg.solution);
        }
        break;
      }

      case 'dungeon_vendor_buy': {
        if (!DUNGEON_ENABLED) break;
        const dRoom = rooms.get(ws.roomCode);
        if (dRoom?.handleVendorBuy) {
          dRoom.handleVendorBuy(ws, msg.featureId, msg.itemId);
        }
        break;
      }

      case 'dungeon_inventory_get': {
        if (!DUNGEON_ENABLED || !ws.userId) break;
        try {
          const compMod = await import('./dungeon/competition.js');
          const all = await compMod.getInventory(ws.userId);
          const classId = msg.classId || 'tyrant';
          const equippedRefs = (all.equipped && all.equipped[classId]) || {};
          const gearById = Object.fromEntries((all.gear || []).map(g => [g.itemId, g]));
          const gemById  = Object.fromEntries((all.gems || []).map(g => [g.gemId, g]));
          const equipped = Object.fromEntries(
            Object.entries(equippedRefs).map(([slot, id]) => [slot, gearById[id] || null]).filter(([, v]) => v)
          );
          const socketedIds = (all.socketed && all.socketed[classId]) || [];
          const sockets = socketedIds.map(id => gemById[id] || null);
          // Include SETS catalog so client tooltips can render full bonus
          // descriptions for set-piece items (2/4/6 piece bonuses, names, colors).
          ws.send(JSON.stringify({
            type: 'dungeon_inventory', classId,
            equipped, sockets,
            allGear: all.gear || [], allGems: all.gems || [],
            sets: compMod.SETS || {},
          }));
        } catch (err) {
          console.warn('[Dungeon Inventory]', err.message);
        }
        break;
      }

      case 'dungeon_equip': {
        if (!DUNGEON_ENABLED || !ws.userId) break;
        try {
          const compMod = await import('./dungeon/competition.js');
          await compMod.equipGear(ws.userId, msg.classId, msg.slot, msg.itemId ?? null);
          ws.send(JSON.stringify({ type: 'dungeon_equip_ok', classId: msg.classId, slot: msg.slot, itemId: msg.itemId }));
        } catch (err) {
          console.warn('[Dungeon Equip]', err.message);
        }
        break;
      }

      case 'dungeon_sell_gear': {
        if (!DUNGEON_ENABLED || !ws.userId) break;
        try {
          const compMod = await import('./dungeon/competition.js');
          const result = await compMod.sellGear(ws.userId, msg.itemId);
          if (result.error) {
            ws.send(JSON.stringify({ type: 'dungeon_sell_result', success: false, reason: result.error }));
          } else {
            ws.send(JSON.stringify({
              type: 'dungeon_sell_result',
              success: true,
              itemId: msg.itemId,
              itemName: result.itemName,
              soldPrice: result.soldPrice,
              newBalance: result.newBalance,
            }));
          }
        } catch (err) {
          console.warn('[Dungeon Sell]', err.message);
          ws.send(JSON.stringify({ type: 'dungeon_sell_result', success: false, reason: 'Server error.' }));
        }
        break;
      }

      case 'dungeon_socket_gem': {
        if (!DUNGEON_ENABLED || !ws.userId) break;
        try {
          const compMod = await import('./dungeon/competition.js');
          await compMod.socketGem(ws.userId, msg.classId, msg.slotIndex, msg.gemId ?? null);
          ws.send(JSON.stringify({ type: 'dungeon_socket_ok', classId: msg.classId, slotIndex: msg.slotIndex, gemId: msg.gemId }));
        } catch (err) {
          console.warn('[Dungeon Socket]', err.message);
        }
        break;
      }

      case 'dungeon_ladder_get': {
        if (!DUNGEON_ENABLED) break;
        try {
          const compMod = await import('./dungeon/competition.js');
          const entries = await compMod.getLadder({
            classId: msg.classId || 'tyrant',
            tier: msg.tier || 1,
            partySize: msg.partySize || 1,
            limit: msg.limit || 20,
          });
          ws.send(JSON.stringify({
            type: 'dungeon_ladder',
            classId: msg.classId, tier: msg.tier, partySize: msg.partySize,
            entries,
          }));
        } catch (err) {
          console.warn('[Dungeon Ladder] error:', err.message);
        }
        break;
      }

      case 'dungeon_progression_get': {
        if (!DUNGEON_ENABLED || !ws.userId) break;
        try {
          const compMod = await import('./dungeon/competition.js');
          const progression = await compMod.getPlayerProgression(ws.userId);
          ws.send(JSON.stringify({ type: 'dungeon_progression', progression }));
        } catch (err) {
          console.warn('[Dungeon Progression] error:', err.message);
        }
        break;
      }

      // ── King of the Hill (legacy, kept for backward compat) ──────
      case 'get_king': {
        try {
          const king = await db.getKingOfHill();
          ws.send(JSON.stringify({ type: 'king', king: king ? { username: king.username, elo: king.elo, defenses: king.defenses || 0, reignStarted: king.reignStarted } : null }));
        } catch (err) {
          console.error('[King] get_king error:', err.message);
        }
        break;
      }

      // ── Per-Class Champions ───────────────────────────────────────
      case 'get_class_champions': {
        if (!checkRateLimit(ws, 'champions', 5, 60000)) break;
        try {
          const champions = await db.getAllClassChampions();
          ws.send(JSON.stringify({ type: 'class_champions', champions }));
        } catch (err) {
          console.error('[Champions] get_class_champions error:', err.message);
        }
        break;
      }

      // ── Username Change ───────────────────────────────────────────
      case 'change_username': {
        if (!ws.authenticated || !ws.userProfile) break;
        const newUsername = msg.username?.trim();
        if (!/^[a-zA-Z0-9_]{3,16}$/.test(newUsername)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid username (3-16 chars, letters/numbers/underscore)' }));
          break;
        }
        const lastChange = ws.userProfile.lastUsernameChange;
        if (lastChange) {
          const daysSince = (Date.now() - new Date(lastChange).getTime()) / 86400000;
          if (daysSince < 30) {
            const daysLeft = Math.ceil(30 - daysSince);
            ws.send(JSON.stringify({ type: 'error', message: `Username change available in ${daysLeft} day(s)` }));
            break;
          }
        }
        try {
          await db.changeUsername(ws.userId, newUsername, ws.userProfile.username);
          ws.userProfile.username = newUsername;
          ws.userProfile.lastUsernameChange = new Date().toISOString();
          ws.send(JSON.stringify({ type: 'username_changed', profile: ws.userProfile }));
          console.log(`[Auth] ${ws.userEmail} changed username to: ${newUsername}`);
        } catch (err) {
          if (err.name === 'TransactionCanceledException') {
            ws.send(JSON.stringify({ type: 'error', message: 'Username already taken' }));
          } else {
            ws.send(JSON.stringify({ type: 'error', message: 'Failed to change username' }));
            console.error('[Auth] Username change error:', err.message);
          }
        }
        break;
      }

      // ── Account Deletion ──────────────────────────────────────────
      case 'delete_account': {
        if (!ws.authenticated || !ws.userProfile) break;
        const delSub = ws.userId;
        const delUsername = ws.userProfile.username;
        try {
          // Delete profile
          await db.deleteItem({ PK: `USER#${delSub}`, SK: 'PROFILE' });
          // Delete username reservation
          await db.deleteItem({ PK: `USERNAME#${delUsername}`, SK: 'RESERVED' });
          // Delete from leaderboard (GSI1)
          try { await db.deleteItem({ PK: `USER#${delSub}`, SK: 'LEADERBOARD' }); } catch (_) {}
          console.log(`[Account] Deleted account: ${delUsername} (${delSub})`);
          ws.send(JSON.stringify({ type: 'account_deleted' }));
          ws.close();
        } catch (err) {
          console.error('[Account] Delete error:', err.message);
          ws.send(JSON.stringify({ type: 'error', message: 'Failed to delete account' }));
        }
        break;
      }

      // ── Avatar Class ──────────────────────────────────────────────
      case 'set_avatar_class': {
        if (!ws.authenticated || !ws.userProfile) break;
        const avatarClassId = msg.classId;
        const validClasses = ['tyrant', 'wraith', 'infernal', 'harbinger', 'revenant'];
        if (!validClasses.includes(avatarClassId)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid class' }));
          break;
        }
        try {
          await db.setAvatarClass(ws.userId, avatarClassId);
          ws.userProfile.avatarClass = avatarClassId;
          ws.send(JSON.stringify({ type: 'avatar_class_set', classId: avatarClassId }));
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', message: 'Failed to set avatar class' }));
          console.error('[Avatar] set error:', err.message);
        }
        break;
      }

      // ── Friends System ────────────────────────────────────────────
      case 'send_friend_request': {
        if (!ws.authenticated || !ws.userProfile) break;
        if (!checkRateLimit(ws, 'social', 10)) break; // 10 social actions per 10s
        const targetUsername = msg.username?.trim();
        if (!targetUsername) break;
        try {
          const target = await db.findPlayerByUsername(targetUsername);
          if (!target) { ws.send(JSON.stringify({ type: 'error', message: 'Player not found' })); break; }
          if (target.cognitoSub === ws.userId) { ws.send(JSON.stringify({ type: 'error', message: 'Cannot add yourself' })); break; }
          await db.sendFriendRequest(ws.userId, target.cognitoSub, ws.userProfile.username);
          ws.send(JSON.stringify({ type: 'friend_request_sent', to: targetUsername }));
          // Notify target if online
          const targetWs = onlineUsers.get(target.cognitoSub);
          if (targetWs?.readyState === WS_OPEN) {
            targetWs.send(JSON.stringify({ type: 'friend_request_received', from: ws.userProfile.username, fromSub: ws.userId }));
          }
        } catch (err) {
          if (err.name === 'ConditionalCheckFailedException') {
            ws.send(JSON.stringify({ type: 'error', message: 'Friend request already sent' }));
          } else {
            ws.send(JSON.stringify({ type: 'error', message: 'Failed to send request' }));
            console.error('[Friends] send_friend_request error:', err.message);
          }
        }
        break;
      }

      case 'accept_friend_request': {
        if (!ws.authenticated || !ws.userProfile) break;
        const fromSub = msg.fromSub;
        if (!fromSub) break;
        try {
          // Verify the friend request actually exists before accepting
          const pendingReqs = await db.getPendingRequests(ws.userId);
          const reqExists = pendingReqs.some(r => r.fromSub === fromSub);
          if (!reqExists) {
            ws.send(JSON.stringify({ type: 'error', message: 'No pending request from this player' }));
            break;
          }
          const fromProfile = await db.getProfile(fromSub);
          if (!fromProfile) break;
          await db.acceptFriendRequest(fromSub, ws.userId, fromProfile.username, ws.userProfile.username);
          ws.send(JSON.stringify({ type: 'friend_request_accepted', friendSub: fromSub, friendUsername: fromProfile.username }));
          // Notify the requester if online
          const fromWs = onlineUsers.get(fromSub);
          if (fromWs?.readyState === WS_OPEN) {
            fromWs.send(JSON.stringify({ type: 'friend_added', friendSub: ws.userId, friendUsername: ws.userProfile.username }));
          }
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', message: 'Failed to accept request' }));
          console.error('[Friends] accept error:', err.message);
        }
        break;
      }

      case 'decline_friend_request': {
        if (!ws.authenticated) break;
        const declineFrom = msg.fromSub;
        if (!declineFrom) break;
        try {
          await db.declineFriendRequest(declineFrom, ws.userId);
          ws.send(JSON.stringify({ type: 'friend_request_declined', fromSub: declineFrom }));
        } catch (err) {
          console.error('[Friends] decline error:', err.message);
        }
        break;
      }

      case 'remove_friend': {
        if (!ws.authenticated) break;
        const removeSub = msg.friendSub;
        if (!removeSub) break;
        try {
          await db.removeFriend(ws.userId, removeSub);
          ws.send(JSON.stringify({ type: 'friend_removed', friendSub: removeSub }));
        } catch (err) {
          console.error('[Friends] remove error:', err.message);
        }
        break;
      }

      case 'get_friends': {
        if (!ws.authenticated) { console.warn('[Friends] get_friends rejected: not authenticated'); break; }
        try {
          const friends = await db.getFriendsList(ws.userId);
          const friendList = friends.map(f => ({
            sub: f.friendSub,
            username: f.friendUsername,
            online: onlineUsers.has(f.friendSub),
            since: f.since,
          }));
          console.log(`[Friends] ${ws.userProfile?.username || ws.userId} → ${friendList.length} friends`);
          ws.send(JSON.stringify({ type: 'friends_list', friends: friendList }));
        } catch (err) {
          console.error('[Friends] get_friends error:', err.message);
          ws.send(JSON.stringify({ type: 'friends_list', friends: [] }));
        }
        break;
      }

      case 'get_friend_requests': {
        if (!ws.authenticated) { console.warn('[Friends] get_friend_requests rejected: not authenticated'); break; }
        try {
          const requests = await db.getPendingRequests(ws.userId);
          console.log(`[Friends] ${ws.userProfile?.username || ws.userId} → ${requests.length} pending requests`);
          ws.send(JSON.stringify({ type: 'friend_requests', requests: requests.map(r => ({ fromSub: r.fromSub, fromUsername: r.fromUsername, createdAt: r.createdAt })) }));
        } catch (err) {
          console.error('[Friends] get_friend_requests error:', err.message);
          ws.send(JSON.stringify({ type: 'friend_requests', requests: [] }));
        }
        break;
      }

      // ── Channel Chat System ──────────────────────────────────────

      case 'join_global_chat': {
        if (!ws.authenticated) break;
        globalChatSubscribers.add(ws);
        // Send recent buffer as history
        ws.send(JSON.stringify({ type: 'channel_history', channelId: 'global', messages: [...globalChatBuffer] }));
        break;
      }

      case 'leave_global_chat': {
        globalChatSubscribers.delete(ws);
        break;
      }

      case 'send_channel_message': {
        if (!ws.authenticated || !ws.userProfile) break;
        const chanId = msg.channelId;
        const chanText = msg.text?.trim();
        if (!chanId || !chanText) break;

        // Profanity filter — same normalization rules as the username filter
        // (catches obvious slurs + leetspeak obfuscation). Server-side block:
        // message is rejected, sender sees "message contains prohibited
        // language", admin gets a log entry for review.
        if (isProhibitedChat(chanText)) {
          ws.send(JSON.stringify({
            type: 'chat_blocked',
            channelId: chanId,
            reason: 'Your message contains prohibited language and was not sent.',
          }));
          console.log(`[Chat] BLOCKED from ${ws.userProfile.username} (${chanId}): ${chanText.slice(0, 100)}`);
          break;
        }

        try {
          const outMsg = {
            type: 'channel_message', channelId: chanId,
            fromSub: ws.userId, fromUsername: ws.userProfile.username,
            text: chanText.slice(0, 500),
          };

          if (chanId === 'global') {
            if (!checkRateLimit(ws, 'chat_global', 5)) break;
            // No DB write — push to ring buffer + broadcast
            outMsg.timestamp = new Date().toISOString();
            globalChatBuffer.push(outMsg);
            if (globalChatBuffer.length > GLOBAL_CHAT_BUFFER_SIZE) globalChatBuffer.shift();
            for (const sub of globalChatSubscribers) {
              if (sub !== ws && sub.readyState === WS_OPEN) sub.send(JSON.stringify(outMsg));
            }
          } else if (chanId.startsWith('duel:')) {
            if (!checkRateLimit(ws, 'chat_duel', 10)) break;
            const roomCode = chanId.slice(5);
            const room = rooms.get(roomCode);
            if (!room) break;
            const inRoom = room.players.some(p => p?.ws === ws);
            if (!inRoom) break;
            outMsg.timestamp = await db.sendChannelMessage(chanId, ws.userId, ws.userProfile.username, chanText);
            for (const p of room.players) {
              if (p?.ws && p.ws !== ws && p.ws.readyState === WS_OPEN) p.ws.send(JSON.stringify(outMsg));
            }
          } else if (chanId.startsWith('dm:')) {
            if (!checkRateLimit(ws, 'chat_dm', 10)) break;
            const parts = chanId.slice(3).split(':');
            if (!parts.includes(ws.userId)) break;
            outMsg.timestamp = await db.sendChannelMessage(chanId, ws.userId, ws.userProfile.username, chanText);
            const otherSub = parts.find(s => s !== ws.userId);
            if (otherSub) {
              const recipientWs = onlineUsers.get(otherSub);
              if (recipientWs?.readyState === WS_OPEN) recipientWs.send(JSON.stringify(outMsg));
            }
          } else {
            break; // unknown channel type
          }

          ws.send(JSON.stringify({ type: 'channel_message_sent', channelId: chanId, text: chanText.slice(0, 500), timestamp: outMsg.timestamp }));
        } catch (err) {
          console.error('[Chat] channel send error:', err.message);
        }
        break;
      }

      case 'get_channel_history': {
        if (!ws.authenticated) break;
        const histChanId = msg.channelId;
        if (!histChanId) break;
        try {
          let messages;
          if (histChanId === 'global') {
            messages = [...globalChatBuffer];
          } else if (histChanId.startsWith('dm:')) {
            const parts = histChanId.slice(3).split(':');
            if (!parts.includes(ws.userId)) break;
            messages = await db.getChannelHistory(histChanId, 50);
          } else if (histChanId.startsWith('duel:')) {
            messages = await db.getChannelHistory(histChanId, 50);
          } else {
            break;
          }
          ws.send(JSON.stringify({ type: 'channel_history', channelId: histChanId, messages }));
        } catch (err) {
          console.error('[Chat] channel history error:', err.message);
        }
        break;
      }

      // Legacy DM handlers (backward compat)
      case 'send_chat_message': {
        if (!ws.authenticated || !ws.userProfile) break;
        if (!checkRateLimit(ws, 'chat_dm', 10)) break;
        const chatTo = msg.toSub;
        const chatText = msg.text?.trim();
        if (!chatTo || !chatText) break;
        try {
          const chanId = db.dmChannelId(ws.userId, chatTo);
          const timestamp = await db.sendChannelMessage(chanId, ws.userId, ws.userProfile.username, chatText);
          const recipientWs = onlineUsers.get(chatTo);
          if (recipientWs?.readyState === WS_OPEN) {
            recipientWs.send(JSON.stringify({ type: 'chat_message', fromSub: ws.userId, fromUsername: ws.userProfile.username, text: chatText.slice(0, 500), timestamp }));
          }
          ws.send(JSON.stringify({ type: 'chat_message_sent', toSub: chatTo, text: chatText.slice(0, 500), timestamp }));
        } catch (err) {
          console.error('[Chat] legacy send error:', err.message);
        }
        break;
      }

      case 'get_chat_history': {
        if (!ws.authenticated) break;
        const historyWith = msg.withSub;
        if (!historyWith) break;
        try {
          const chanId = db.dmChannelId(ws.userId, historyWith);
          const messages = await db.getChannelHistory(chanId, 30);
          ws.send(JSON.stringify({ type: 'chat_history', withSub: historyWith, messages }));
        } catch (err) {
          console.error('[Chat] legacy history error:', err.message);
        }
        break;
      }

      // ── Game Invites ──────────────────────────────────────────────
      case 'send_game_invite': {
        if (!ws.authenticated || !ws.userProfile) break;
        if (!checkRateLimit(ws, 'social', 10)) break;
        const inviteTo = msg.toSub;
        if (!inviteTo || !VALID_CLASSES.includes(msg.classId)) break;
        const targetWs = onlineUsers.get(inviteTo);
        if (targetWs?.readyState === WS_OPEN) {
          targetWs.send(JSON.stringify({ type: 'game_invite', fromSub: ws.userId, fromUsername: ws.userProfile.username, classId: msg.classId }));
          ws.send(JSON.stringify({ type: 'game_invite_sent', toSub: inviteTo }));
          pendingGameInvites.set(ws.userId, { inviterWs: ws, targetSub: inviteTo, classId: msg.classId, timestamp: Date.now() });
        } else {
          ws.send(JSON.stringify({ type: 'error', message: 'Player is offline' }));
        }
        break;
      }

      case 'accept_game_invite': {
        if (!ws.authenticated || !ws.userProfile) break;
        const inviterSub = msg.inviterSub;
        const acceptClassId = msg.classId;
        if (!inviterSub || !VALID_CLASSES.includes(acceptClassId)) break;

        const invite = pendingGameInvites.get(inviterSub);
        if (!invite || invite.targetSub !== ws.userId) {
          ws.send(JSON.stringify({ type: 'game_invite_error', message: 'Invite not found or expired' }));
          break;
        }
        if (Date.now() - invite.timestamp > 60000) {
          pendingGameInvites.delete(inviterSub);
          ws.send(JSON.stringify({ type: 'game_invite_error', message: 'Invite has expired' }));
          break;
        }
        const inviterWs = invite.inviterWs;
        if (!inviterWs || inviterWs.readyState !== WS_OPEN) {
          pendingGameInvites.delete(inviterSub);
          ws.send(JSON.stringify({ type: 'game_invite_error', message: 'Inviter is no longer online' }));
          break;
        }
        if (inviterWs.roomCode) {
          pendingGameInvites.delete(inviterSub);
          ws.send(JSON.stringify({ type: 'game_invite_error', message: 'Inviter is already in a match' }));
          break;
        }
        if (ws.roomCode) {
          pendingGameInvites.delete(inviterSub);
          ws.send(JSON.stringify({ type: 'game_invite_error', message: 'You are already in a match' }));
          break;
        }

        pendingGameInvites.delete(inviterSub);

        // Create a non-ranked custom room and start immediately
        let invCode = generateRoomCode();
        while (rooms.has(invCode)) invCode = generateRoomCode();
        const invRoom = new GameRoom(invCode, {
          ranked: false,
          playerMeta: {
            0: { sub: inviterSub, elo: inviterWs.userProfile?.elo || 1500, username: inviterWs.userProfile?.username || '?', classId: invite.classId, activeFrame: inviterWs.userProfile?.activeFrame || null, activeTitle: inviterWs.userProfile?.activeTitle || null },
            1: { sub: ws.userId, elo: ws.userProfile?.elo || 1500, username: ws.userProfile?.username || '?', classId: acceptClassId, activeFrame: ws.userProfile?.activeFrame || null, activeTitle: ws.userProfile?.activeTitle || null },
          },
        });
        invRoom.onChampionUpdate = (updates) => broadcastToAll({ type: 'champion_update', updates });
        rooms.set(invCode, invRoom);

        invRoom.addPlayer(inviterWs, invite.classId, 0);
        inviterWs.roomCode = invCode;
        inviterWs.playerSlot = 0;
        inviterWs.slot = 0;

        invRoom.addPlayer(ws, acceptClassId, 1);
        ws.roomCode = invCode;
        ws.playerSlot = 1;
        ws.slot = 1;

        invRoom.startMatch();

        const inviterSkin = inviterWs.userProfile?.activeSkins?.[invite.classId] || null;
        const acceptorSkin = ws.userProfile?.activeSkins?.[acceptClassId] || null;

        inviterWs.send(JSON.stringify({
          type: 'match_start', roomCode: invCode, slot: 0, ranked: false,
          playerClass: invite.classId, enemyClass: acceptClassId,
          playerSkin: inviterSkin, enemySkin: acceptorSkin,
          playerMeta: invRoom.options.playerMeta,
        }));
        ws.send(JSON.stringify({
          type: 'match_start', roomCode: invCode, slot: 1, ranked: false,
          playerClass: acceptClassId, enemyClass: invite.classId,
          playerSkin: acceptorSkin, enemySkin: inviterSkin,
          playerMeta: invRoom.options.playerMeta,
        }));

        console.log(`[Invite] Match started: ${inviterWs.userProfile?.username} (${invite.classId}) vs ${ws.userProfile?.username} (${acceptClassId}) in room ${invCode}`);
        break;
      }

      case 'decline_game_invite': {
        if (!ws.authenticated) break;
        const decInviterSub = msg.inviterSub;
        if (!decInviterSub) break;
        const decInvite = pendingGameInvites.get(decInviterSub);
        if (decInvite && decInvite.targetSub === ws.userId) {
          pendingGameInvites.delete(decInviterSub);
          const decInviterWs = decInvite.inviterWs;
          if (decInviterWs?.readyState === WS_OPEN) {
            decInviterWs.send(JSON.stringify({ type: 'game_invite_declined', fromUsername: ws.userProfile?.username || '?' }));
          }
        }
        break;
      }

      // ── Shop / Inventory ────────────────────────────────────────────
      case 'get_shop': {
        if (!ws.authenticated) break;
        try {
          const inv = await db.getInventory(ws.userId);
          ws.send(JSON.stringify({ type: 'shop_data', coins: inv.coins, inventory: inv.inventory }));
        } catch (err) {
          console.error('[Shop] get_shop error:', err.message);
        }
        break;
      }

      case 'purchase_item': {
        if (!ws.authenticated) break;
        if (!checkRateLimit(ws, 'purchase', 5)) {
          ws.send(JSON.stringify({ type: 'purchase_error', message: 'Too many requests' }));
          break;
        }
        const serverPrice = SHOP_PRICES[msg.itemId];
        if (serverPrice === undefined) {
          ws.send(JSON.stringify({ type: 'purchase_error', message: 'Invalid item' }));
          break;
        }
        try {
          const result = await db.purchaseItem(ws.userId, msg.itemId, serverPrice);
          ws.userProfile.coins = result.newCoins;
          ws.userProfile.inventory = result.inventory;
          ws.send(JSON.stringify({ type: 'purchase_success', itemId: msg.itemId, newCoins: result.newCoins, inventory: result.inventory }));
          console.log(`[Shop] ${ws.userProfile.username} purchased ${msg.itemId} for ${serverPrice} coins`);
        } catch (err) {
          ws.send(JSON.stringify({ type: 'purchase_error', message: err.message }));
          console.error('[Shop] purchase error:', err.message);
        }
        break;
      }

      // ── Practice Match Reward ────────────────────────────────────────
      case 'practice_complete': {
        if (!ws.authenticated) break;
        // Rate limit: max 1 practice reward per 45 seconds (matches take longer)
        if (!checkRateLimit(ws, 'practice', 1, 45000)) break;
        const won = msg.won === true;
        const classId = typeof msg.classId === 'string' ? msg.classId : null;
        const difficulty = typeof msg.difficulty === 'string' ? msg.difficulty : 'hard';
        const validClasses = ['tyrant', 'wraith', 'infernal', 'harbinger', 'revenant'];
        if (classId && validClasses.includes(classId)) {
          // Auto-set avatar to first class played if not set
          if (!ws.userProfile.avatarClass) {
            try {
              await db.setAvatarClass(ws.userId, classId);
              ws.userProfile.avatarClass = classId;
              ws.send(JSON.stringify({ type: 'avatar_class_set', classId }));
            } catch (_) {}
          }
          try {
            // Solo practice runs client-side — no server stats available.
            // Give a flat consolation perfScore of 50 for losses (~5 XP).
            const soloPerfScore = won ? 100 : 50;
            const result = await db.awardPracticeReward(ws.userId, classId, won, difficulty, soloPerfScore);
            // Record AI match for admin analytics — fire-and-forget so a DB
            // hiccup doesn't block the reward payout the player just earned.
            db.recordAIMatch({
              sub: ws.userId, classId,
              opponentClass: typeof msg.opponentClass === 'string' ? msg.opponentClass : null,
              won, difficulty,
              durationSec: typeof msg.durationSec === 'number' ? msg.durationSec : 0,
            }).catch(err => console.warn('[AI Match] record failed:', err.message));
            if (result) {
              if (!result.gated) ws.userProfile.coins = result.newCoins;
              if (result.accountLevel !== undefined) {
                ws.userProfile.accountXp = result.accountXp;
                ws.userProfile.accountLevel = result.accountLevel;
              }
              ws.send(JSON.stringify({
                type: 'practice_reward',
                coins: result.gated ? 0 : result.coinsEarned,
                newCoins: result.gated ? (ws.userProfile.coins || 0) : result.newCoins,
                xpEarned: result.xpEarned,
                classMastery: result.classMastery,
                levelUps: result.levelUps,
                masteryCoinsEarned: result.masteryCoinsEarned,
                gated: result.gated || false,
                accountXp: result.accountXp,
                accountLevel: result.accountLevel,
                accountLevelUps: result.accountLevelUps,
                accountMilestoneCoins: result.accountMilestoneCoins,
                seasonXp: result.seasonXp,
                seasonTier: result.seasonTier,
                bpTiersGained: result.bpTiersGained || 0,
                bpCoinsEarned: result.bpCoinsEarned || 0,
                bpNewRewards: result.bpNewRewards || [],
              }));
            }
          } catch (err) {
            console.error('[Practice] reward error:', err.message);
          }
        } else {
          // Fallback: coins only if no classId provided
          const practiceCoins = won ? 5 : 0;
          if (practiceCoins > 0) {
            try {
              await db.awardCoins(ws.userId, practiceCoins);
              ws.userProfile.coins = (ws.userProfile.coins || 0) + practiceCoins;
              ws.send(JSON.stringify({ type: 'practice_reward', coins: practiceCoins, newCoins: ws.userProfile.coins }));
            } catch (err) {
              console.error('[Practice] coin award error:', err.message);
            }
          }
        }
        break;
      }

      // ── Battle Pass ─────────────────────────────────────────────────
      case 'get_battle_pass': {
        if (!ws.authenticated) break;
        try {
          const [profile, seasonConfig] = await Promise.all([
            db.getProfile(ws.userId),
            db.getSeasonConfig(),
          ]);
          if (!seasonConfig?.active) {
            ws.send(JSON.stringify({ type: 'battle_pass', active: false }));
            break;
          }
          const seasonXp = profile?.seasonXp || 0;
          const seasonTier = profile?.seasonTier || 0;
          const seasonRewardsClaimed = profile?.seasonRewardsClaimed || [];
          ws.send(JSON.stringify({
            type: 'battle_pass',
            active: true,
            seasonId: seasonConfig.seasonId,
            seasonName: seasonConfig.seasonName,
            tierCount: seasonConfig.tierCount,
            rewards: seasonConfig.rewards,
            playerSeasonXp: seasonXp,
            playerTier: seasonTier,
            claimedTiers: seasonRewardsClaimed,
            thresholds: db.BP_TIER_THRESHOLDS,
          }));
        } catch (err) {
          console.error('[BattlePass] get error:', err.message);
          ws.send(JSON.stringify({ type: 'battle_pass', active: false, error: err.message }));
        }
        break;
      }

      // ── Spectator Mode ──────────────────────────────────────────────
      case 'spectate_match': {
        if (!ws.authenticated) break;
        const room = rooms.get(msg.roomCode);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: 'Match not found or already ended' }));
          break;
        }
        if (!room.match?.active) {
          ws.send(JSON.stringify({ type: 'error', message: 'Match has already ended' }));
          break;
        }
        const added = room.addSpectator(ws, ws.userId, ws.userProfile?.username || 'Spectator');
        if (!added) {
          ws.send(JSON.stringify({ type: 'error', message: 'Spectator slots full' }));
        }
        ws.spectatingRoom = msg.roomCode;
        break;
      }

      case 'leave_spectate': {
        if (!ws.authenticated) break;
        const specRoom = ws.spectatingRoom ? rooms.get(ws.spectatingRoom) : null;
        if (specRoom) {
          specRoom.removeSpectator(ws);
        }
        ws.spectatingRoom = null;
        break;
      }

      case 'get_live_champion_matches': {
        if (!ws.authenticated) break;
        const liveMatches = [];
        for (const [roomCode, room] of rooms) {
          if (room.isChampionMatch && room.match?.active) {
            const p0 = room.playerMeta?.[0] || {};
            const p1 = room.playerMeta?.[1] || {};
            const champIsSlot0 = p0.classId === room.championClassId;
            const champ = champIsSlot0 ? p0 : p1;
            const opp = champIsSlot0 ? p1 : p0;
            liveMatches.push({
              roomCode,
              championClass: room.championClassId,
              championUsername: champ.username || '???',
              opponentClass: opp.classId || 'unknown',
              opponentUsername: opp.username || '???',
              spectatorCount: room.getSpectatorCount(),
            });
          }
        }
        ws.send(JSON.stringify({ type: 'live_champion_matches', matches: liveMatches }));
        break;
      }

      // ── Champion Betting ────────────────────────────────────────────
      case 'place_bet': {
        if (!ws.authenticated) break;
        if (!checkRateLimit(ws, 'bet', 5)) {
          ws.send(JSON.stringify({ type: 'bet_error', message: 'Too many requests' }));
          break;
        }
        // Validate classId
        if (!VALID_CLASSES.includes(msg.classId)) {
          ws.send(JSON.stringify({ type: 'bet_error', message: 'Invalid class' }));
          break;
        }
        // Validate side
        if (msg.side !== 'holds' && msg.side !== 'falls') {
          ws.send(JSON.stringify({ type: 'bet_error', message: 'Invalid bet side' }));
          break;
        }
        // Validate amount: must be a positive integer, max 500
        const betAmount = msg.amount;
        if (!Number.isInteger(betAmount) || betAmount < 50 || betAmount > 500) {
          ws.send(JSON.stringify({ type: 'bet_error', message: 'Bet must be 50-500 coins' }));
          break;
        }
        try {
          // Block bets on classes with no champion (vacant throne)
          const champion = await db.getClassChampion(msg.classId);
          if (!champion || !champion.playerSub) {
            ws.send(JSON.stringify({ type: 'bet_error', message: 'No champion for this class yet' }));
            break;
          }
          // Cap active bets per player (max 3)
          const existingBets = await db.getPlayerBets(ws.userId);
          const activeBetCount = existingBets.filter(b => b.status === 'active').length;
          if (activeBetCount >= 3) {
            ws.send(JSON.stringify({ type: 'bet_error', message: 'Maximum 3 active bets allowed' }));
            break;
          }
          const result = await db.placeBet(ws.userId, msg.classId, msg.side, betAmount);
          ws.userProfile.coins = result.newCoins;
          ws.send(JSON.stringify({ type: 'bet_placed', betId: result.betId, odds: result.odds, newCoins: result.newCoins }));
          console.log(`[Bets] ${ws.userProfile.username} bet ${betAmount} on ${msg.classId} ${msg.side} (odds: ${result.odds}x)`);
        } catch (err) {
          ws.send(JSON.stringify({ type: 'bet_error', message: err.message }));
          console.error('[Bets] place_bet error:', err.message);
        }
        break;
      }

      case 'get_my_bets': {
        if (!ws.authenticated) break;
        try {
          const bets = await db.getPlayerBets(ws.userId);
          ws.send(JSON.stringify({ type: 'my_bets', bets }));
        } catch (err) {
          console.error('[Bets] get_my_bets error:', err.message);
        }
        break;
      }

      case 'get_champions': {
        try {
          const champions = await db.getAllClassChampions();
          ws.send(JSON.stringify({ type: 'class_champions', champions }));
        } catch (err) {
          console.error('[Champions] get_champions error:', err.message);
        }
        break;
      }

      case 'get_jackpot': {
        try {
          const jackpot = await db.getJackpot();
          ws.send(JSON.stringify({ type: 'jackpot', total: jackpot.total || 0 }));
        } catch (err) {
          console.error('[Jackpot] get_jackpot error:', err.message);
        }
        break;
      }

      // ── Weekly Challenges ─────────────────────────────────────────
      case 'get_challenges': {
        if (!checkRateLimit(ws, 'challenges', 5, 60000)) break;
        try {
          const active = await getActiveChallenges();
          let progress = null;
          if (ws.authenticated && active?.weekId) {
            const pr = await db.getPlayerChallengeProgress(ws.userId, active.weekId);
            progress = pr?.progress || {};
          }
          const jackpot = await db.getJackpot();
          ws.send(JSON.stringify({
            type: 'challenges',
            challenges: active?.challenges || [],
            progress: progress || {},
            jackpot: jackpot.total || 0,
            expiresAt: active?.expiresAt || null,
            weekId: active?.weekId || null,
          }));
        } catch (err) {
          console.error('[Challenges] get_challenges error:', err.message);
          ws.send(JSON.stringify({ type: 'challenges', challenges: [], progress: {}, error: err.message }));
        }
        break;
      }

      // ── Equip Cosmetics ──────────────────────────────────────────
      case 'equip_cosmetic': {
        if (!ws.authenticated || !ws.userProfile) break;
        const { slot, itemId } = msg;
        const validSlots = ['activeFrame', 'activePortrait', 'activeTitle', 'activeSkins'];
        if (!validSlots.includes(slot)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid cosmetic slot' }));
          break;
        }

        // ── Skin equip (per-class) ──
        if (slot === 'activeSkins') {
          const { classId: skinClassId } = msg;
          if (!VALID_CLASSES.includes(skinClassId)) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid class' }));
            break;
          }
          // Allow clearing (null = revert to default)
          if (itemId) {
            const skinItemId = `skin_${skinClassId}_${itemId}`;
            const inv = ws.userProfile.inventory || [];
            if (!inv.includes(skinItemId)) {
              ws.send(JSON.stringify({ type: 'error', message: 'You do not own this skin' }));
              break;
            }
          }
          try {
            await db.setSkinForClass(ws.userId, skinClassId, itemId || null);
            if (!ws.userProfile.activeSkins) ws.userProfile.activeSkins = {};
            ws.userProfile.activeSkins[skinClassId] = itemId || null;
            ws.send(JSON.stringify({ type: 'cosmetic_equipped', slot, classId: skinClassId, itemId: itemId || null }));
          } catch (err) {
            ws.send(JSON.stringify({ type: 'error', message: 'Failed to equip skin' }));
            console.error('[Shop] equip_skin error:', err.message);
          }
          break;
        }

        // Allow clearing (null), 'none' sentinel (no frame), or verify the player owns the item
        if (itemId && itemId !== 'none') {
          const isBPItem = itemId.startsWith('bp_');
          if (!SHOP_PRICES[itemId] && !MASTERY_TITLES.has(itemId) && !ACCOUNT_TITLES.has(itemId) && !isBPItem) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid item' }));
            break;
          }
          const inv = ws.userProfile.inventory || [];
          if (!inv.includes(itemId)) {
            ws.send(JSON.stringify({ type: 'error', message: 'You do not own this item' }));
            break;
          }
        }
        try {
          await db.setCosmetic(ws.userId, slot, itemId || null);
          ws.userProfile[slot] = itemId || null;
          ws.send(JSON.stringify({ type: 'cosmetic_equipped', slot, itemId: itemId || null }));
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', message: 'Failed to equip cosmetic' }));
          console.error('[Shop] equip_cosmetic error:', err.message);
        }
        break;
      }

      // ── Async Wager Duel Handlers ─────────────────────────────────────

      case 'send_duel': {
        if (!ws.authenticated || !ws.userProfile) break;
        if (!checkRateLimit(ws, 'duel', 5)) {
          ws.send(JSON.stringify({ type: 'duel_error', message: 'Too many requests' }));
          break;
        }
        const { targetUsername: duelTarget, wager: duelWager, classId: duelClassId } = msg;
        if (!duelTarget || !WAGER_TIERS[duelWager] || !VALID_CLASSES.includes(duelClassId)) {
          ws.send(JSON.stringify({ type: 'duel_error', message: 'Invalid duel parameters' }));
          break;
        }
        // Find target by username (works whether online or offline)
        let targetProfile;
        try {
          targetProfile = await db.findPlayerByUsername(duelTarget);
        } catch (err) {
          ws.send(JSON.stringify({ type: 'duel_error', message: 'Player lookup failed' }));
          break;
        }
        if (!targetProfile || targetProfile.cognitoSub === ws.userId) {
          ws.send(JSON.stringify({ type: 'duel_error', message: 'Player not found' }));
          break;
        }
        // ELO values for amplifier calculation
        const senderElo = ws.userProfile.elo || 1500;
        const targetElo = targetProfile.elo || 1500;
        // Max 3 outgoing pending
        try {
          const outgoing = await db.getPlayerDuelsOutgoing(ws.userId);
          const pendingCount = outgoing.filter(d => d.status === 'pending').length;
          if (pendingCount >= MAX_OUTGOING_DUELS) {
            ws.send(JSON.stringify({ type: 'duel_error', message: `Maximum ${MAX_OUTGOING_DUELS} pending duels allowed` }));
            break;
          }
        } catch (err) {
          ws.send(JSON.stringify({ type: 'duel_error', message: 'Failed to check pending duels' }));
          break;
        }
        // Check funds
        if ((ws.userProfile.coins || 0) < duelWager) {
          ws.send(JSON.stringify({ type: 'duel_error', message: 'Insufficient coins' }));
          break;
        }
        // Atomic create: escrow + duel record + inbox pointers
        const amplifier = WAGER_TIERS[duelWager];
        const duelId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        try {
          await db.createDuelWithEscrow(ws.userId, targetProfile.cognitoSub, {
            duelId,
            challengerUsername: ws.userProfile.username,
            defenderUsername: targetProfile.username,
            challengerClassId: duelClassId,
            challengerEloAtSend: senderElo,
            defenderEloAtSend: targetElo,
            wager: duelWager,
            amplifier,
            createdAt: new Date().toISOString(),
          });
          ws.userProfile.coins -= duelWager;
          ws.send(JSON.stringify({
            type: 'duel_sent', duelId, targetUsername: duelTarget,
            wager: duelWager, amplifier, newCoins: ws.userProfile.coins,
          }));
          // Push to defender if online
          const defenderWs = onlineUsers.get(targetProfile.cognitoSub);
          if (defenderWs?.readyState === WS_OPEN) {
            defenderWs.send(JSON.stringify({
              type: 'duel_received', duelId, wager: duelWager, amplifier,
              challengerUsername: ws.userProfile.username, challengerElo: senderElo,
              challengerClassId: duelClassId, createdAt: new Date().toISOString(),
            }));
          }
          db.recordDuelMetric('duel_sent', { duelId, wager: duelWager, amplifier, challengerSub: ws.userId, defenderSub: targetProfile.cognitoSub })
            .catch(err => console.error('[Duel Metric] error:', err.message));
          console.log(`[Duel] ${ws.userProfile.username} (${senderElo}) challenged ${duelTarget} (${targetElo}) for ${duelWager} coins (${amplifier}x)`);
        } catch (err) {
          ws.send(JSON.stringify({ type: 'duel_error', message: 'Failed to create duel' }));
          console.error('[Duel] create error:', err.message);
        }
        break;
      }

      case 'cancel_duel': {
        if (!ws.authenticated) break;
        const { duelId: cancelDuelId } = msg;
        if (!cancelDuelId) break;
        try {
          const duel = await db.getDuel(cancelDuelId);
          if (!duel || duel.challengerSub !== ws.userId || duel.status !== 'pending') {
            ws.send(JSON.stringify({ type: 'duel_error', message: 'Cannot cancel this duel' }));
            break;
          }
          await db.cancelDuel(cancelDuelId, duel.challengerSub, duel.defenderSub);
          await db.refundEscrow(cancelDuelId);
          ws.userProfile.coins += duel.wager;
          ws.send(JSON.stringify({ type: 'duel_cancelled', duelId: cancelDuelId, newCoins: ws.userProfile.coins }));
          // Notify defender if online
          const defWs = onlineUsers.get(duel.defenderSub);
          if (defWs?.readyState === WS_OPEN) {
            defWs.send(JSON.stringify({ type: 'duel_cancelled', duelId: cancelDuelId }));
          }
          db.recordDuelMetric('duel_cancelled', { duelId: cancelDuelId }).catch(() => {});
          console.log(`[Duel] ${ws.userProfile?.username} cancelled duel ${cancelDuelId}`);
        } catch (err) {
          ws.send(JSON.stringify({ type: 'duel_error', message: 'Failed to cancel duel' }));
          console.error('[Duel] cancel error:', err.message);
        }
        break;
      }

      case 'accept_duel': {
        if (!ws.authenticated || !ws.userProfile) break;
        const { duelId: acceptDuelId, classId: acceptClassId } = msg;
        if (!acceptDuelId || !VALID_CLASSES.includes(acceptClassId)) {
          ws.send(JSON.stringify({ type: 'duel_error', message: 'Invalid accept parameters' }));
          break;
        }
        try {
          const duel = await db.getDuel(acceptDuelId);
          if (!duel || duel.defenderSub !== ws.userId || duel.status !== 'pending') {
            ws.send(JSON.stringify({ type: 'duel_error', message: 'Duel not found or already handled' }));
            break;
          }
          // Check if pending duel has expired (48h)
          const ageMs = Date.now() - new Date(duel.createdAt).getTime();
          if (ageMs > DUEL_PENDING_EXPIRY_MS) {
            ws.send(JSON.stringify({ type: 'duel_error', message: 'This duel has expired' }));
            break;
          }
          const matchWindowExpires = new Date(Date.now() + DUEL_MATCH_WINDOW_MS).toISOString();
          await db.acceptDuel(acceptDuelId, acceptClassId, duel.defenderSub, duel.challengerSub, matchWindowExpires);

          // Check if challenger is online — if so, start match immediately
          const chalWs = onlineUsers.get(duel.challengerSub);
          if (chalWs?.readyState === WS_OPEN) {
            // Both online — create game room and start the match like ranked
            let code = generateRoomCode();
            while (rooms.has(code)) code = generateRoomCode();

            const challengerElo = chalWs.userProfile?.classElos?.[duel.challengerClassId]?.elo ?? chalWs.userProfile?.elo ?? 1500;
            const defenderElo = ws.userProfile?.classElos?.[acceptClassId]?.elo ?? ws.userProfile?.elo ?? 1500;

            const duelRoom = new GameRoom(code, {
              ranked: false,
              challenge: true,
              challengeData: { duelId: acceptDuelId, wager: duel.wager, amplifier: duel.amplifier, challengerSlot: 0 },
              playerMeta: {
                0: { sub: duel.challengerSub, elo: challengerElo, username: duel.challengerUsername, classId: duel.challengerClassId, activeFrame: chalWs.userProfile?.activeFrame || null, activeTitle: chalWs.userProfile?.activeTitle || null, activeSkin: chalWs.userProfile?.activeSkins?.[duel.challengerClassId] || null },
                1: { sub: duel.defenderSub, elo: defenderElo, username: ws.userProfile.username, classId: acceptClassId, activeFrame: ws.userProfile?.activeFrame || null, activeTitle: ws.userProfile?.activeTitle || null, activeSkin: ws.userProfile?.activeSkins?.[acceptClassId] || null },
              },
            });
            rooms.set(code, duelRoom);

            duelRoom.addPlayer(chalWs, duel.challengerClassId, 0);
            chalWs.roomCode = code;
            chalWs.slot = 0;
            chalWs.playerSlot = 0;

            duelRoom.addPlayer(ws, acceptClassId, 1);
            ws.roomCode = code;
            ws.slot = 1;
            ws.playerSlot = 1;

            duelRoom.startMatch();

            // Broadcast to global chat for spectators
            const duelAnnouncement = {
              type: 'channel_message',
              channelId: 'global',
              fromSub: 'SYSTEM',
              fromUsername: 'SYSTEM',
              text: `⚔️ WAGER DUEL: ${duel.challengerUsername} (${duel.challengerClassId}) vs ${ws.userProfile.username} (${acceptClassId}) for ${duel.wager} coins! /spectate ${code}`,
              timestamp: new Date().toISOString(),
            };
            for (const sub of globalChatSubscribers) {
              if (sub.readyState === WS_OPEN) sub.send(JSON.stringify(duelAnnouncement));
            }

            console.log(`[Duel] Match started: ${duel.challengerUsername} vs ${ws.userProfile.username} in room ${code} (${duel.wager} coins)`);
          } else {
            // Challenger offline — notify defender to wait
            ws.send(JSON.stringify({
              type: 'duel_accepted', duelId: acceptDuelId,
              challengerUsername: duel.challengerUsername, challengerClassId: duel.challengerClassId,
              wager: duel.wager, amplifier: duel.amplifier,
              matchWindowExpiresAt: matchWindowExpires,
            }));
            this._showToast?.('Duel accepted! Match will start when opponent comes online.');
            console.log(`[Duel] ${ws.userProfile.username} accepted but challenger offline`);
          }
          db.recordDuelMetric('duel_accepted', { duelId: acceptDuelId, wager: duel.wager }).catch(() => {});
          console.log(`[Duel] ${ws.userProfile.username} accepted duel ${acceptDuelId} as ${acceptClassId}`);
        } catch (err) {
          if (err.name === 'TransactionCanceledException') {
            ws.send(JSON.stringify({ type: 'duel_error', message: 'You already have an active duel' }));
          } else {
            ws.send(JSON.stringify({ type: 'duel_error', message: 'Failed to accept duel' }));
          }
          console.error('[Duel] accept error:', err.message);
        }
        break;
      }

      case 'decline_duel': {
        if (!ws.authenticated) break;
        const { duelId: decDuelId } = msg;
        if (!decDuelId) break;
        try {
          const duel = await db.getDuel(decDuelId);
          if (!duel || duel.defenderSub !== ws.userId || duel.status !== 'pending') {
            ws.send(JSON.stringify({ type: 'duel_error', message: 'Cannot decline this duel' }));
            break;
          }
          await db.declineDuel(decDuelId, duel.challengerSub, duel.defenderSub);
          await db.refundEscrow(decDuelId);
          ws.send(JSON.stringify({ type: 'duel_declined', duelId: decDuelId }));
          // Notify challenger if online + update their coins
          const chalWs2 = onlineUsers.get(duel.challengerSub);
          if (chalWs2?.readyState === WS_OPEN) {
            chalWs2.userProfile.coins += duel.wager;
            chalWs2.send(JSON.stringify({ type: 'duel_declined', duelId: decDuelId, refundedCoins: duel.wager, newCoins: chalWs2.userProfile.coins }));
          }
          db.recordDuelMetric('duel_declined', { duelId: decDuelId }).catch(() => {});
          console.log(`[Duel] ${ws.userProfile?.username} declined duel ${decDuelId}`);
        } catch (err) {
          ws.send(JSON.stringify({ type: 'duel_error', message: 'Failed to decline duel' }));
          console.error('[Duel] decline error:', err.message);
        }
        break;
      }

      case 'get_duel_inbox': {
        if (!ws.authenticated) break;
        try {
          const inbox = await db.getPlayerDuelInbox(ws.userId);
          ws.send(JSON.stringify({ type: 'duel_inbox', ...inbox }));
        } catch (err) {
          console.error('[Duel] get_duel_inbox error:', err.message);
        }
        break;
      }

      case 'ready_duel': {
        if (!ws.authenticated) break;
        const { duelId: readyDuelId } = msg;
        if (!readyDuelId) break;
        try {
          const duel = await db.getDuel(readyDuelId);
          if (!duel || duel.status !== 'accepted') {
            ws.send(JSON.stringify({ type: 'duel_error', message: 'Duel not in accepted state' }));
            break;
          }
          // Verify this player is in the duel
          const isChallenger = duel.challengerSub === ws.userId;
          const isDefender = duel.defenderSub === ws.userId;
          if (!isChallenger && !isDefender) {
            ws.send(JSON.stringify({ type: 'duel_error', message: 'Not your duel' }));
            break;
          }
          // Check match window hasn't expired
          if (duel.matchWindowExpiresAt && new Date(duel.matchWindowExpiresAt).getTime() < Date.now()) {
            ws.send(JSON.stringify({ type: 'duel_error', message: 'Match window has expired' }));
            break;
          }
          const readyField = isChallenger ? 'challengerReadyAt' : 'defenderReadyAt';
          const now = new Date().toISOString();
          await db.markDuelReady(readyDuelId, readyField, now);

          // Check if both ready
          const otherReadyField = isChallenger ? 'defenderReadyAt' : 'challengerReadyAt';
          const opponentSub = isChallenger ? duel.defenderSub : duel.challengerSub;
          const opponentReady = !!duel[otherReadyField];
          const opponentWs = onlineUsers.get(opponentSub);
          const opponentOnline = opponentWs?.readyState === WS_OPEN;

          // Notify both of ready update
          ws.send(JSON.stringify({ type: 'duel_ready_update', duelId: readyDuelId, [readyField]: now }));
          if (opponentOnline) {
            opponentWs.send(JSON.stringify({ type: 'duel_ready_update', duelId: readyDuelId, [readyField]: now }));
          }

          // If both ready AND both online → start match
          if (opponentReady && opponentOnline) {
            await db.transitionDuelToInProgress(readyDuelId);

            // Get fresh ELO for both players (use match-time ELO, not send-time)
            const [chalProfile, defProfile] = await Promise.all([
              db.getProfile(duel.challengerSub),
              db.getProfile(duel.defenderSub),
            ]);
            const chalElo = chalProfile?.elo || 1500;
            const defElo = defProfile?.elo || 1500;

            let roomCode = generateRoomCode();
            while (rooms.has(roomCode)) roomCode = generateRoomCode();
            const duelRoom = new GameRoom(roomCode, {
              ranked: false,
              challenge: true,
              challengeData: {
                duelId: readyDuelId,
                wager: duel.wager,
                amplifier: duel.amplifier,
                challengerSlot: 0,
              },
              playerMeta: {
                0: { sub: duel.challengerSub, elo: chalElo, rating: chalProfile?.rating ?? Math.max(0, Math.round(chalElo - 1500)), username: duel.challengerUsername, classId: duel.challengerClassId, currentStreak: chalProfile?.currentStreak || 0, activeFrame: chalProfile?.activeFrame || null, activeTitle: chalProfile?.activeTitle || null },
                1: { sub: duel.defenderSub, elo: defElo, rating: defProfile?.rating ?? Math.max(0, Math.round(defElo - 1500)), username: duel.defenderUsername, classId: duel.defenderClassId, currentStreak: defProfile?.currentStreak || 0, activeFrame: defProfile?.activeFrame || null, activeTitle: defProfile?.activeTitle || null },
              },
            });
            duelRoom.onChallengeEnd = (dId, winnerSub, loserSub) => {
              // Clear ready state (locks already cleared in GameRoom._endMatch)
            };
            duelRoom.onChampionUpdate = (updates) => broadcastToAll({ type: 'champion_update', updates });
            rooms.set(roomCode, duelRoom);

            const chalWsReady = onlineUsers.get(duel.challengerSub);
            const defWsReady = isChallenger ? opponentWs : ws;
            const chalWsFinal = isChallenger ? ws : chalWsReady;

            if (chalWsFinal?.readyState === WS_OPEN) {
              duelRoom.addPlayer(chalWsFinal, duel.challengerClassId, 0);
              chalWsFinal.roomCode = roomCode;
              chalWsFinal.slot = 0;
            }
            if (defWsReady?.readyState === WS_OPEN) {
              duelRoom.addPlayer(defWsReady, duel.defenderClassId, 1);
              defWsReady.roomCode = roomCode;
              defWsReady.slot = 1;
            }

            duelRoom.startMatch();

            const matchMsg = { type: 'duel_match_start', roomCode, duelId: readyDuelId, wager: duel.wager, amplifier: duel.amplifier };
            if (chalWsFinal?.readyState === WS_OPEN) {
              chalWsFinal.send(JSON.stringify({ ...matchMsg, slot: 0, playerClass: duel.challengerClassId, enemyClass: duel.defenderClassId }));
            }
            if (defWsReady?.readyState === WS_OPEN) {
              defWsReady.send(JSON.stringify({ ...matchMsg, slot: 1, playerClass: duel.defenderClassId, enemyClass: duel.challengerClassId }));
            }
            db.recordDuelMetric('duel_match_started', { duelId: readyDuelId, wager: duel.wager }).catch(() => {});
            console.log(`[Duel] Match started: ${duel.challengerUsername} vs ${duel.defenderUsername} in room ${roomCode}`);
          }
        } catch (err) {
          ws.send(JSON.stringify({ type: 'duel_error', message: 'Failed to ready up' }));
          console.error('[Duel] ready error:', err.message);
        }
        break;
      }

      case 'unready_duel': {
        if (!ws.authenticated) break;
        const { duelId: unreadyDuelId } = msg;
        if (!unreadyDuelId) break;
        try {
          const duel = await db.getDuel(unreadyDuelId);
          if (!duel || duel.status !== 'accepted') break;
          const isChallenger = duel.challengerSub === ws.userId;
          const isDefender = duel.defenderSub === ws.userId;
          if (!isChallenger && !isDefender) break;
          const readyField = isChallenger ? 'challengerReadyAt' : 'defenderReadyAt';
          await db.clearDuelReady(unreadyDuelId, readyField);
          const opponentSub = isChallenger ? duel.defenderSub : duel.challengerSub;
          ws.send(JSON.stringify({ type: 'duel_ready_update', duelId: unreadyDuelId, [readyField]: null }));
          const oppWs = onlineUsers.get(opponentSub);
          if (oppWs?.readyState === WS_OPEN) {
            oppWs.send(JSON.stringify({ type: 'duel_ready_update', duelId: unreadyDuelId, [readyField]: null }));
          }
        } catch (err) {
          console.error('[Duel] unready error:', err.message);
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    // Remove from presence tracking
    globalChatSubscribers.delete(ws);
    if (ws.userId) {
      onlineUsers.delete(ws.userId);
      matchmaker.removeFromQueue(ws.userId);
      teamMatchmaker.removeFromQueue(ws.userId);
      pendingGameInvites.delete(ws.userId); // Clean up any pending invites from this player
      // Note: async duels are fully persistent in DynamoDB — no cleanup needed on disconnect
    }

    // Clean up spectator connection
    if (ws.spectatingRoom) {
      const specRoom = rooms.get(ws.spectatingRoom);
      if (specRoom) specRoom.removeSpectator(ws);
    }

    const room = rooms.get(ws.roomCode);
    if (room) {
      room.handleDisconnect(ws);
      if (room.isEmpty()) {
        room.cleanup();
        rooms.delete(ws.roomCode);
        console.log(`[Room ${ws.roomCode}] Cleaned up`);
      }
    }
  });
});

// Heartbeat — drop dead connections
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// ── Async Duel Expiry Sweep ──────────────────────────────────────────
async function sweepExpiredDuels() {
  try {
    // 1. Expire pending duels past 48h → refund
    let expiredPending, expiredAccepted;
    try { expiredPending = await db.getExpiredPendingDuels(); }
    catch (e) { console.error('[Duel Sweep] getExpiredPendingDuels failed:', e.name, e.message); expiredPending = []; }
    try { expiredAccepted = await db.getExpiredAcceptedDuels(); }
    catch (e) { console.error('[Duel Sweep] getExpiredAcceptedDuels failed:', e.name, e.message); expiredAccepted = []; }
    for (const duel of expiredPending) {
      try {
        await db.cancelDuel(duel.duelId, duel.challengerSub, duel.defenderSub);
        await db.refundEscrow(duel.duelId);
        db.recordDuelMetric('duel_expired', { duelId: duel.duelId, wager: duel.wager }).catch(() => {});
        // Notify players if online
        for (const sub of [duel.challengerSub, duel.defenderSub]) {
          const playerWs = onlineUsers.get(sub);
          if (playerWs?.readyState === WS_OPEN) {
            if (sub === duel.challengerSub) playerWs.userProfile.coins += duel.wager;
            playerWs.send(JSON.stringify({ type: 'duel_expired', duelId: duel.duelId }));
          }
        }
        console.log(`[Duel Sweep] Expired pending duel ${duel.duelId} (${duel.wager} coins refunded)`);
      } catch (err) {
        console.error(`[Duel Sweep] Error expiring ${duel.duelId}:`, err.message);
      }
    }

    // 2. Handle accepted duels past 24h match window → always refund both players
    //    No forfeit winners — people get busy, duels just expire and coins return.
    for (const duel of expiredAccepted) {
      try {
        await db.refundEscrow(duel.duelId);
        await db.resolveDuel(duel.duelId, null, 'expired_no_show');
        db.recordDuelMetric('duel_expired_no_show', { duelId: duel.duelId, wager: duel.wager }).catch(() => {});
        console.log(`[Duel Sweep] Duel ${duel.duelId} expired — ${duel.wager} coins refunded to both players`);
        for (const sub of [duel.challengerSub, duel.defenderSub]) {
          const playerWs = onlineUsers.get(sub);
          if (playerWs?.readyState === WS_OPEN) {
            if (sub === duel.challengerSub) playerWs.userProfile.coins += duel.wager;
            playerWs.send(JSON.stringify({ type: 'duel_expired', duelId: duel.duelId }));
          }
        }
        // Clear active duel locks
        await Promise.all([
          db.clearActiveDuelLock(duel.challengerSub),
          db.clearActiveDuelLock(duel.defenderSub),
        ]);
      } catch (err) {
        console.error(`[Duel Sweep] Error handling expired accepted duel ${duel.duelId}:`, err.message);
      }
    }

    if (expiredPending.length || expiredAccepted.length) {
      console.log(`[Duel Sweep] Processed ${expiredPending.length} expired pending, ${expiredAccepted.length} expired accepted`);
    }
  } catch (err) {
    console.error('[Duel Sweep] Fatal error:', err.message);
  }
}

setInterval(sweepExpiredDuels, DUEL_SWEEP_INTERVAL_MS);
// Run initial sweep 30s after startup
setTimeout(sweepExpiredDuels, 30000);

// Sweep stale game invites every 60s
setInterval(() => {
  const now = Date.now();
  for (const [sub, inv] of pendingGameInvites) {
    if (now - inv.timestamp > 60000) pendingGameInvites.delete(sub);
  }
}, 60000);

httpServer.listen(PORT, () => {
  console.log(`Ebon Crucible PvP + Forum server listening on port ${PORT}`);
});
console.log(`Cognito pool: ${process.env.COGNITO_USER_POOL_ID}`);
console.log(`DynamoDB table: ${process.env.DYNAMO_TABLE || 'EbonCrucible'}`);

// Periodic stats
setInterval(() => {
  const activeRooms = [...rooms.values()].filter(r => r.match?.active).length;
  console.log(`[Stats] Rooms: ${rooms.size} total, ${activeRooms} active, ${wss.clients.size} connections, 1v1 queue: ${matchmaker.getQueueSize()}, 2v2 queue: ${teamMatchmaker.getQueueSize()}`);
}, 60000);

// ── Admin Dashboard Server (127.0.0.1 only — SSH tunnel required) ──
import { startAdminServer } from './admin.js';
startAdminServer({ wss, rooms, matchmaker, onlineUsers });
