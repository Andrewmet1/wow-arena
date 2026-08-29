import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import * as db from './db.js';
import * as adminDb from './adminDb.js';
import { getActiveChallenges, forceGenerate, collectWeeklyMetrics } from './challenges.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_PORT = process.env.ADMIN_PORT || 3002;

let serverRefs = null;
let playerCountCache = { count: 0, fetchedAt: 0 };

export function startAdminServer({ wss, rooms, matchmaker, onlineUsers }) {
  serverRefs = { wss, rooms, matchmaker, onlineUsers };

  const app = express();
  app.use(express.json());

  // CORS — allow local file:// access
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Serve admin dashboard static files
  app.use(express.static(path.join(__dirname, '..', 'admin')));

  // ── Overview ────────────────────────────────────────────────────
  app.get('/api/overview', async (req, res) => {
    try {
      // Refresh player count every 5 minutes
      if (Date.now() - playerCountCache.fetchedAt > 300000) {
        playerCountCache.count = await adminDb.countPlayers();
        playerCountCache.fetchedAt = Date.now();
      }

      const activeRooms = [...rooms.values()].filter(r => r.match?.active).length;

      res.json({
        onlinePlayers: wss.clients.size,
        activeMatches: activeRooms,
        totalRooms: rooms.size,
        queueSize: matchmaker.getQueueSize(),
        totalAccounts: playerCountCache.count,
        uptime: Math.round(process.uptime()),
        memory: {
          rss: Math.round(process.memoryUsage().rss / 1048576),
          heap: Math.round(process.memoryUsage().heapUsed / 1048576),
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Player Search ───────────────────────────────────────────────
  app.get('/api/players', async (req, res) => {
    try {
      const query = req.query.search || '';
      const players = await adminDb.searchPlayers(query, 20);
      res.json({ players });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Player Detail ───────────────────────────────────────────────
  app.get('/api/player/:sub', async (req, res) => {
    try {
      const player = await adminDb.getPlayerFull(req.params.sub);
      if (!player) return res.status(404).json({ error: 'Player not found' });
      res.json({ player });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Ban / Unban ─────────────────────────────────────────────────
  app.post('/api/player/:sub/ban', async (req, res) => {
    try {
      const banned = req.body.banned !== false;
      await db.banPlayer(req.params.sub, banned);

      // Kick if online
      if (banned) {
        const ws = onlineUsers.get(req.params.sub);
        if (ws) {
          ws.send(JSON.stringify({ type: 'auth_error', message: 'Account suspended' }));
          ws.close();
        }
      }

      res.json({ success: true, banned });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Admin Username Reset ────────────────────────────────────────
  app.post('/api/player/:sub/reset-username', async (req, res) => {
    try {
      const newUsername = req.body.username?.trim();
      if (!/^[a-zA-Z0-9_]{3,16}$/.test(newUsername)) {
        return res.status(400).json({ error: 'Invalid username' });
      }
      const profile = await db.getProfile(req.params.sub);
      if (!profile) return res.status(404).json({ error: 'Player not found' });
      await db.changeUsername(req.params.sub, newUsername, profile.username);
      res.json({ success: true, newUsername });
    } catch (err) {
      if (err.name === 'TransactionCanceledException') {
        res.status(409).json({ error: 'Username already taken' });
      } else {
        res.status(500).json({ error: err.message });
      }
    }
  });

  // ── Class Balance (legacy) ──────────────────────────────────────
  app.get('/api/balance', async (req, res) => {
    try {
      const stats = await adminDb.getAggregateStats();
      const champions = await db.getAllClassChampions();
      res.json({ ...stats, champions });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Balance Matrix (enhanced analytics) ────────────────────────
  app.get('/api/balance/matrix', async (req, res) => {
    try {
      const period = req.query.period;   // '24h', '7d', '30d', 'all' or absent
      const bracket = req.query.bracket; // '<1200', '1200-1500', '1500-1800', '1800+', 'all'
      const mode = req.query.mode || '1v1';

      if (!period || period === 'all') {
        // Fast path: use pre-computed aggregate
        const agg = await adminDb.getBalanceAggregate();
        if (agg) {
          const result = adminDb.computeBalanceFromAggregate(agg, bracket);
          return res.json({ ...result, cached: true, lastUpdated: agg.lastUpdated });
        }
      }

      // Slow path: scan with time filter
      let fromDate = null;
      if (period === '24h') fromDate = new Date(Date.now() - 86400000).toISOString();
      else if (period === '7d') fromDate = new Date(Date.now() - 7 * 86400000).toISOString();
      else if (period === '30d') fromDate = new Date(Date.now() - 30 * 86400000).toISOString();

      const matches = await adminDb.scanMatchRecords({ fromDate, mode });
      const result = adminDb.computeBalanceFromMatches(matches);
      res.json({ ...result, cached: false });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Rebuild Balance Aggregate ──────────────────────────────────
  app.post('/api/balance/rebuild', async (req, res) => {
    try {
      const result = await adminDb.rebuildBalanceAggregate();
      res.json({ success: true, totalMatches: result.totalMatches });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Jackpot ────────────────────────────────────────────────────
  app.get('/api/jackpot', async (req, res) => {
    try {
      const jackpot = await db.getJackpot();
      res.json({ total: jackpot.total || 0, lastUpdated: jackpot.lastUpdated || null });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Challenges ────────────────────────────────────────────────
  app.get('/api/challenges', async (req, res) => {
    try {
      const active = await getActiveChallenges();
      res.json({ challenges: active || null });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/challenges/metrics', async (req, res) => {
    try {
      const metrics = await collectWeeklyMetrics();
      res.json({ metrics });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/challenges/force-generate', async (req, res) => {
    try {
      const result = await forceGenerate();
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Admin: Edit Player ─────────────────────────────────────────
  app.post('/api/player/:sub/edit', async (req, res) => {
    try {
      const updates = {};
      if (req.body.elo !== undefined) updates.elo = Math.max(0, Math.min(9999, parseInt(req.body.elo) || 0));
      if (req.body.coins !== undefined) updates.coins = Math.max(0, parseInt(req.body.coins) || 0);
      if (req.body.wins !== undefined) updates.wins = Math.max(0, parseInt(req.body.wins) || 0);
      if (req.body.losses !== undefined) updates.losses = Math.max(0, parseInt(req.body.losses) || 0);

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      await adminDb.adminUpdatePlayer(req.params.sub, updates);
      res.json({ success: true, updates });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Admin: Adjust Coins ───────────────────────────────────────
  app.post('/api/player/:sub/adjust-coins', async (req, res) => {
    try {
      const amount = parseInt(req.body.amount);
      if (!amount || isNaN(amount)) {
        return res.status(400).json({ error: 'Invalid amount' });
      }
      await adminDb.adminAdjustCoins(req.params.sub, amount);
      res.json({ success: true, adjustment: amount });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Admin: Grant Item ────────────────────────────────────────
  app.post('/api/player/:sub/grant-item', async (req, res) => {
    try {
      const { itemId } = req.body;
      if (!itemId || typeof itemId !== 'string') {
        return res.status(400).json({ error: 'Missing itemId' });
      }
      await adminDb.adminGrantItem(req.params.sub, itemId);
      res.json({ success: true, itemId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Admin: Revoke Item ──────────────────────────────────────
  app.post('/api/player/:sub/revoke-item', async (req, res) => {
    try {
      const { itemId } = req.body;
      if (!itemId || typeof itemId !== 'string') {
        return res.status(400).json({ error: 'Missing itemId' });
      }
      await adminDb.adminRevokeItem(req.params.sub, itemId);
      res.json({ success: true, itemId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Admin: Delete Account ─────────────────────────────────────
  app.delete('/api/player/:sub', async (req, res) => {
    try {
      const result = await adminDb.adminDeletePlayer(req.params.sub);

      // Kick if online
      const ws = onlineUsers.get(req.params.sub);
      if (ws) {
        ws.send(JSON.stringify({ type: 'auth_error', message: 'Account deleted' }));
        ws.close();
      }

      // Invalidate player count cache
      playerCountCache.fetchedAt = 0;

      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Admin: Clear Match History ─────────────────────────────────
  app.post('/api/player/:sub/clear-matches', async (req, res) => {
    try {
      const count = await adminDb.adminClearMatches(req.params.sub);
      res.json({ success: true, deleted: count });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Player Payments ────────────────────────────────────────────
  app.get('/api/player/:sub/payments', async (req, res) => {
    try {
      const payments = await adminDb.getPlayerPayments(req.params.sub);
      res.json({ payments });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Recent Matches ──────────────────────────────────────────────
  app.get('/api/matches', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 50, 100);
      const matches = await adminDb.getRecentMatches(limit);
      res.json({ matches });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Leaderboard ─────────────────────────────────────────────────
  app.get('/api/leaderboard', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const entries = await db.getLeaderboard(limit);
      res.json({ entries });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  const server = http.createServer(app);
  server.listen(ADMIN_PORT, '0.0.0.0', () => {
    console.log(`Admin dashboard listening on http://0.0.0.0:${ADMIN_PORT}`);
  });
}
