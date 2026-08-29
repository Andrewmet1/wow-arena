const { contextBridge, ipcRenderer } = require('electron');

// Expose minimal platform detection bridge.
// The game is entirely web-based — we only expose platform identity and
// a small set of safe window-control IPCs (fullscreen toggle from settings).
contextBridge.exposeInMainWorld('electronBridge', {
  platform: 'electron',
  isElectron: true,
  toggleFullscreen: () => ipcRenderer.invoke('window:toggle-fullscreen'),
  setFullscreen: (value) => ipcRenderer.invoke('window:set-fullscreen', value),
  isFullscreen: () => ipcRenderer.invoke('window:is-fullscreen'),
  // Exit-to-desktop — used by the in-game pause menu's "Exit Game" button.
  quitApp: () => ipcRenderer.invoke('app:quit'),
});
