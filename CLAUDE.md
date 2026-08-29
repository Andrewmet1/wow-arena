# Ebon Crucible - Project Instructions

## CRITICAL: AWS IAM Keys — DO NOT ROTATE
- The server uses IAM user `ebon-crucible-server` with a static access key
- **NEVER** run `aws iam create-access-key` or `aws iam delete-access-key` for this user
- **NEVER** rotate, regenerate, or replace the server's AWS credentials
- If you encounter DynamoDB errors (security token invalid, resource not found), the fix is to check that `/opt/ebon-crucible/server/.env` has the correct values — NOT to create new keys
- Past outages were caused by Claude sessions rotating keys without updating the server

## Server Deployment
- **Server host**: `52.54.205.70` (Lightsail, us-east-1)
- **SSH**: `ssh -i ~/.ssh/ebon-crucible-lightsail.pem ubuntu@52.54.205.70`
- **PM2 process**: `ebon-pvp` — restart with `pm2 restart ebon-pvp --update-env`
- **Server .env**: `/opt/ebon-crucible/server/.env` (dotenv loads from cwd)
- **Server code**: `/opt/ebon-crucible/server/` (index.js, GameRoom.js, db.js, etc.)
- **Deploy client**: `npm run build` → scp `dist/play/index.html` + `dist/assets/*.js` + `dist/assets/*.css` to `/var/www/eboncrucible.com/`
- **Deploy server**: scp individual files to `/opt/ebon-crucible/server/` then `pm2 restart ebon-pvp --update-env`
- **Admin dashboard**: `http://localhost:3002` via SSH tunnel: `ssh -i ~/.ssh/ebon-crucible-lightsail.pem -L 3002:127.0.0.1:3002 -N ubuntu@52.54.205.70`

## Tech Stack
- Three.js v0.182.0 + Vite (client)
- Capacitor 8.3.0 (iOS/Android native wrapper)
- Node.js + ws (server, server-authoritative 10Hz tick)
- AWS Cognito (auth), DynamoDB (database), Lightsail (hosting)
- Meshy.ai (3D character models + animations)

## Key Architecture
- `src/main.js` — Main SPA (~12k lines), dashboard, hub, match UI
- `src/ui/HUD.js` — In-game HUD (unit frames, ability bars, buffs)
- `src/rendering/CharacterRenderer.js` — Meshy model loader + shared animations
- `src/input/TouchControls.js` — Mobile virtual joystick, camera, dodge
- `src/utils/Platform.js` — Runtime platform detection (Capacitor/Electron/iOS/Web)
- `server/index.js` — WebSocket server, matchmaking, all message handlers
- `server/GameRoom.js` — Headless CombatEngine, state broadcast, loading gate
- `server/admin.js` — Admin dashboard (port 3002, localhost only)
- Character models: `public/assets/models/char_{class}.glb` (Meshy pipeline)
- Shared animations: `public/assets/animations/shared/` (31 clips)
- `capacitor.config.ts` — Mobile app config, loads from production URL

## Mobile Image Positioning
- **Splash images** (`_splash.webp`, 1024x1792 portrait): Use `object-position: top center`
- **Banner images** (`_banner.webp`, 1792x1024 landscape): Use `object-position: center top`
- **Portrait images** (`_portrait.webp`, square headshots): Do NOT add object-position — already properly composed
- **`_renderPortraitWithFrame()`** uses portrait images — no object-position needed
