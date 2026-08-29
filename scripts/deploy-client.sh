#!/usr/bin/env bash
# Deploy the built client to production with chunk-completeness verification.
#
# Why this exists: vite emits content-hashed JS chunks whose filenames change on
# every build. Twice already we've shipped only `play-*.js` and missed sibling
# chunks (`game-engine-*`, `game-classes-*`, etc.), leaving production with
# 404s on the referenced imports — symptom: "stuck on loading screen".
#
# This script ships everything dist/ produced and verifies the new HTML's
# referenced chunks all return 200 before declaring success.
set -euo pipefail

SSH_KEY="${SSH_KEY:-$HOME/.ssh/ebon-crucible-lightsail.pem}"
HOST="${HOST:-ubuntu@52.54.205.70}"
WEB_ROOT="${WEB_ROOT:-/var/www/eboncrucible.com}"
DIST_DIR="$(cd "$(dirname "$0")/.." && pwd)/dist"

if [ ! -d "$DIST_DIR/assets" ] || [ ! -f "$DIST_DIR/play/index.html" ]; then
  echo "[deploy] dist/ not built — run 'npm run build' first" >&2
  exit 1
fi

echo "[deploy] uploading play/index.html"
scp -i "$SSH_KEY" -q "$DIST_DIR/play/index.html" "$HOST:$WEB_ROOT/play/index.html"

echo "[deploy] uploading all assets (js/css/map)"
# rsync would be ideal but isn't always installed on the build machine.
# scp -r is fine and idempotent; nginx serves whatever's there.
scp -i "$SSH_KEY" -q "$DIST_DIR"/assets/*.js "$DIST_DIR"/assets/*.css "$HOST:$WEB_ROOT/assets/"

# Top-level static files that ship from public/ via vite (sw.js, robots, etc.)
for f in sw.js robots.txt favicon-32.png apple-touch-icon.png manifest.webmanifest; do
  if [ -f "$DIST_DIR/$f" ]; then
    scp -i "$SSH_KEY" -q "$DIST_DIR/$f" "$HOST:$WEB_ROOT/$f"
  fi
done

echo "[deploy] verifying chunks referenced by /play/ return 200"
HTML=$(curl -s https://eboncrucible.com/play/)
FAIL=0
for path in $(echo "$HTML" | grep -oE '/assets/[A-Za-z0-9_./-]+\.(js|css)' | sort -u); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://eboncrucible.com$path")
  if [ "$CODE" != "200" ]; then
    echo "[deploy]   $CODE $path" >&2
    FAIL=1
  else
    echo "[deploy]   $CODE $path"
  fi
done

if [ "$FAIL" -ne 0 ]; then
  echo "[deploy] FAILED — one or more chunks are missing on the server" >&2
  exit 2
fi

echo "[deploy] OK — all chunks reachable"
