const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

// Local HTTP server port — serves the built game from dist-app/.
// Required because Three.js GLTFLoader uses fetch() which fails with file:// CORS,
// and root-relative asset paths (/assets/...) need a proper HTTP origin.
const SERVE_PORT = 17381;
let server;

const MIME_TYPES = {
  '.html': 'text/html', '.js': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml',
};

function createLocalServer() {
  // In packaged app, assets are in resources/app/. In dev, use ../dist-app/.
  const appDir = app.isPackaged
    ? path.join(process.resourcesPath, 'app')
    : path.join(__dirname, '..', 'dist-app');

  server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/' || urlPath === '/play/' || urlPath === '/play') {
      urlPath = '/play/index.html';
    }

    const filePath = path.join(appDir, urlPath);

    // Prevent directory traversal
    if (!filePath.startsWith(appDir)) {
      res.writeHead(403);
      res.end();
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.access(filePath, fs.constants.R_OK, (err) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(filePath).pipe(res);
    });
  });

  return new Promise((resolve) => {
    server.listen(SERVE_PORT, '127.0.0.1', () => resolve());
  });
}

async function createWindow() {
  await createLocalServer();

  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1280,
    minHeight: 720,
    title: 'Ebon Crucible',
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
    show: false,
    fullscreen: true,           // launch in fullscreen by default
    fullscreenable: true,       // allow runtime toggle
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  // Show window once content is ready (avoids white flash)
  win.once('ready-to-show', () => win.show());

  win.loadURL(`http://127.0.0.1:${SERVE_PORT}/play/`);

  // Remove menu bar in production
  if (app.isPackaged) {
    win.setMenuBarVisibility(false);
  }

  // F11 toggles fullscreen; Escape exits fullscreen (idiomatic on PC).
  // before-input-event fires before the page sees the key, so this works
  // whether or not focus is in a text input.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    } else if (input.key === 'Escape' && win.isFullScreen() && !input.alt && !input.control && !input.meta) {
      // Don't intercept Escape inside the game (it's used for menus). Only exit
      // fullscreen if no modifier — gives players an out without breaking gameplay.
      // Actually leave Escape alone entirely; fullscreen exit via F11 is enough.
    }
  });

  // Renderer-driven fullscreen toggle (used by in-game settings menu).
  // The preload bridge calls into ipcMain to flip this — see preload.js.
  const { ipcMain } = require('electron');
  ipcMain.handle('window:toggle-fullscreen', () => {
    win.setFullScreen(!win.isFullScreen());
    return win.isFullScreen();
  });
  ipcMain.handle('window:set-fullscreen', (_e, value) => {
    win.setFullScreen(!!value);
    return win.isFullScreen();
  });
  ipcMain.handle('window:is-fullscreen', () => win.isFullScreen());
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (server) server.close();
  app.quit();
});

// macOS: re-create window when dock icon is clicked
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
