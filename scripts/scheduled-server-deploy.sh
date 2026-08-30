#!/usr/bin/env bash
# Scheduled server deploy — pushes accumulated server-side changes to prod
# and restarts pm2. Run during low-traffic window (target: 2 AM PST) so the
# WS reconnect blip affects the fewest active players.
#
# Idempotent: scp's all server files (rsync would be ideal but is fine).
# Verifies pm2 came back up before exiting.
#
# Run manually:   ./scripts/scheduled-server-deploy.sh
# Run via cron:   57 1 * * * /Users/andrewmet1/wow-arena/scripts/scheduled-server-deploy.sh > /tmp/ec-deploy-$(date +%Y%m%d).log 2>&1
#
# Logs to /tmp/ec-deploy-*.log so you can see what happened in the morning.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH_KEY="$HOME/.ssh/ebon-crucible-lightsail.pem"
HOST="ubuntu@52.54.205.70"
LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S %Z')]"

echo "$LOG_PREFIX Starting scheduled server deploy"

# ── 1. Sync server files ──────────────────────────────────────────────
echo "$LOG_PREFIX Uploading server/*.js"
scp -i "$SSH_KEY" -q \
  "$ROOT/server/index.js" \
  "$ROOT/server/db.js" \
  "$ROOT/server/GameRoom.js" \
  "$ROOT/server/adminDb.js" \
  "$ROOT/server/auth.js" \
  "$ROOT/server/elo.js" \
  "$ROOT/server/Matchmaker.js" \
  "$ROOT/server/notifier.js" \
  "$ROOT/server/forum.js" \
  "$ROOT/server/challenges.js" \
  "$ROOT/server/admin.js" \
  "$HOST:/opt/ebon-crucible/server/" 2>&1 | sed "s/^/$LOG_PREFIX /"

# NOTE: server/dungeon/*.js is intentionally NOT deployed.
# Dungeon is local-dev only. The server gates all dungeon code paths behind
# EC_DUNGEON_ENABLED=1, which is never set in prod /opt/ebon-crucible/server/.env.
# Even if the env flag were set, the import would fail on prod (no files).
# Two-layer defense: env gate + missing files.
echo "$LOG_PREFIX Skipping server/dungeon/*.js (local-dev only)"

# Shared engine files. The list is derived from the server's actual import
# graph rather than hardcoded — a hardcoded trio here once left src/classes/*
# three weeks stale in production, so cone/AoE abilities resolved as
# single-target server-side while the client rendered them as AoE.
echo "$LOG_PREFIX Uploading shared src/ files the server imports"
SRC_FILES=$(cd "$ROOT" && node scripts/server-src-deps.mjs)
echo "$SRC_FILES" | sed "s/^/$LOG_PREFIX   /"
for f in $SRC_FILES; do
  ssh -i "$SSH_KEY" "$HOST" "mkdir -p /opt/ebon-crucible/$(dirname "$f")"
  scp -i "$SSH_KEY" -q "$ROOT/$f" "$HOST:/opt/ebon-crucible/$f"
done

# ── 2. Restart pm2 ────────────────────────────────────────────────────
echo "$LOG_PREFIX Restarting pm2 ebon-pvp"
ssh -i "$SSH_KEY" "$HOST" "pm2 restart ebon-pvp --update-env" 2>&1 | tail -5 | sed "s/^/$LOG_PREFIX /"

# ── 3. Verify the server came back up ─────────────────────────────────
sleep 3
STATUS=$(ssh -i "$SSH_KEY" "$HOST" "pm2 jlist 2>/dev/null | grep -oE '\"name\":\"ebon-pvp\".*?\"status\":\"[a-z]+\"' | grep -oE 'status\":\"[a-z]+\"' | tail -1")
if [[ "$STATUS" == *online* ]]; then
  echo "$LOG_PREFIX ✅ ebon-pvp online — deploy successful"
  exit 0
else
  echo "$LOG_PREFIX ❌ ebon-pvp NOT online (status: $STATUS) — investigate"
  exit 1
fi
