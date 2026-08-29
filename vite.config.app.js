// vite.config.app.js — Play-only build for Electron and Capacitor.
// Strips marketing pages, outputs to dist-app/.
// Usage: npx vite build --config vite.config.app.js --mode electron

import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist-app',
    sourcemap: false,
    rollupOptions: {
      input: {
        play: 'play/index.html',
      },
      output: {
        manualChunks: {
          'three': ['three'],
          'game-engine': [
            '/src/engine/CombatEngine.js',
            '/src/engine/CastSystem.js',
            '/src/engine/CrowdControl.js',
            '/src/engine/GameLoop.js',
            '/src/engine/MatchState.js',
            '/src/engine/Unit.js',
          ],
          'game-classes': [
            '/src/classes/Tyrant.js',
            '/src/classes/Wraith.js',
            '/src/classes/Infernal.js',
            '/src/classes/Harbinger.js',
            '/src/classes/Revenant.js',
            '/src/classes/ClassBase.js',
          ],
          'rendering': [
            '/src/rendering/CharacterRenderer.js',
            '/src/rendering/SpellEffects.js',
            '/src/rendering/SceneManager.js',
            '/src/rendering/CameraController.js',
          ],
          'network': [
            '/src/network/NetworkManager.js',
            '/src/network/AuthManager.js',
          ],
        },
      },
    },
  },
});
