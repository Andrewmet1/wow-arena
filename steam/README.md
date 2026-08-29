# Steam Distribution

## Setup

1. Register at https://partner.steamgames.com
2. Create your app → get your **App ID**
3. Create one depot → get your **Depot ID**
4. Replace all `XXXXXXX` in `scripts/app_build.vdf` and `scripts/depot_build_win.vdf` with real IDs
5. Set the launch executable in Steamworks to `Ebon Crucible.exe`

## Build + Upload

```bash
# 1. Build the game client
cd /path/to/wow-arena
npm run build:electron

# 2. Package for Windows
cd electron
ELECTRON_RUN_AS_NODE= npx electron-builder --dir --win --x64

# 3. Upload to Steam
steamcmd +login YOUR_STEAM_USERNAME +run_app_build /full/path/to/wow-arena/steam/scripts/app_build.vdf +quit
```

## steam_appid.txt

Place `steam_appid.txt` containing your App ID in `electron/release/win-unpacked/` for local testing (Steam API dev mode). SteamPipe ignores this file during upload — Steam injects the real App ID at runtime.

## Updating

Re-run steps 1-3. SteamPipe diffs automatically — only changed files upload.
