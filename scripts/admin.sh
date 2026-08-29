#!/bin/bash
# Opens the Ebon Crucible admin dashboard via SSH tunnel.
# Usage: ./scripts/admin.sh
#
# This creates an SSH tunnel so localhost:3002 maps to the server's
# admin dashboard (which only listens on 127.0.0.1 — not exposed to internet).
# Then opens the dashboard in your browser.

SSH_KEY="$HOME/.ssh/ebon-crucible-lightsail.pem"
SERVER="ubuntu@52.54.205.70"
LOCAL_PORT=3002
REMOTE_PORT=3002

echo "Opening SSH tunnel to admin dashboard..."
echo "Dashboard will be at: http://localhost:$LOCAL_PORT"
echo "Press Ctrl+C to close the tunnel."
echo ""

# -L forwards local port to remote localhost port
# -N means no remote command (just tunnel)
# -f runs in background... but we want to keep it in foreground so Ctrl+C closes it
open "http://localhost:$LOCAL_PORT" &
ssh -L "$LOCAL_PORT:localhost:$REMOTE_PORT" -N -i "$SSH_KEY" "$SERVER"
