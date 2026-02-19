import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

// Dev-only plugin: save viewer settings back to AssetManifest.js
function animSavePlugin() {
  return {
    name: 'viewer-save',
    configureServer(server) {
      // ── Save weapon offsets + weaponsBakedIn ──
      server.middlewares.use('/api/save-weapon-offset', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const { classId, weaponType, offset, weaponsBakedIn } = JSON.parse(body);
            if (!classId || !weaponType) throw new Error('Missing classId or weaponType');

            const filePath = path.resolve('src/rendering/AssetManifest.js');
            let source = fs.readFileSync(filePath, 'utf-8');

            const fmt = (v) => Number(Number(v).toFixed(4));
            const pos = (offset.position || [0, 0, 0]).map(fmt);
            const rot = (offset.rotation || [0, 0, 0]).map(fmt);
            const sc = (offset.scale || [1, 1, 1]).map(fmt);

            // Replace just this weapon type's sub-block within weaponOffset
            // Match: "      weaponType: {\n        ...\n      },"
            const subBlockRegex = new RegExp(
              `(  ${classId}: \\{[\\s\\S]*?weaponOffset: \\{[\\s\\S]*?)      ${weaponType}: \\{[\\s\\S]*?\\n      \\},`,
              'm'
            );
            const newSubBlock = [
              `      ${weaponType}: {`,
              `        position: [${pos.join(', ')}],`,
              `        rotation: [${rot.join(', ')}],`,
              `        scale: [${sc.join(', ')}],`,
              `      },`,
            ].join('\n');

            if (subBlockRegex.test(source)) {
              source = source.replace(subBlockRegex, `$1${newSubBlock}`);
            } else {
              // Weapon type not yet in weaponOffset — add it before the closing },
              const insertRegex = new RegExp(
                `(  ${classId}: \\{[\\s\\S]*?weaponOffset: \\{[\\s\\S]*?)(\\n    \\},)`,
                'm'
              );
              if (insertRegex.test(source)) {
                source = source.replace(insertRegex, `$1\n${newSubBlock}$2`);
              }
            }

            // Update weaponsBakedIn if present
            const bakedRegex = new RegExp(
              `(  ${classId}: \\{[\\s\\S]*?)weaponsBakedIn: (?:true|false)`,
              'm'
            );
            if (bakedRegex.test(source)) {
              source = source.replace(bakedRegex, `$1weaponsBakedIn: ${!!weaponsBakedIn}`);
            }

            fs.writeFileSync(filePath, source, 'utf-8');

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });

      // ── Save animation mappings ──
      server.middlewares.use('/api/save-anim-mappings', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const { classId, mapping } = JSON.parse(body);
            if (!classId || !mapping) throw new Error('Missing classId or mapping');

            const filePath = path.resolve('src/rendering/AssetManifest.js');
            let source = fs.readFileSync(filePath, 'utf-8');

            // Build the replacement block for this class
            const entries = Object.entries(mapping);
            const lines = [`  ${classId}: {`];
            // Base states on first line
            const baseKeys = ['idle', 'run', 'death', 'hit', 'dodge', 'stun', 'jump'];
            const baseEntries = entries.filter(([k]) => baseKeys.includes(k));
            const abilityEntries = entries.filter(([k]) => !baseKeys.includes(k));
            if (baseEntries.length) {
              lines.push(`    ${baseEntries.map(([k, v]) => `${k}: '${v}'`).join(', ')},`);
            }
            for (let i = 0; i < abilityEntries.length; i += 2) {
              const parts = abilityEntries.slice(i, i + 2).map(([k, v]) => `${k}: '${v}'`);
              lines.push(`    ${parts.join(', ')},`);
            }
            lines.push('  },');
            const newBlock = lines.join('\n');

            // Replace the class block in CLASS_ANIMATIONS using regex
            // Match: "  classId: {\n    ...\n  },"
            const classRegex = new RegExp(
              `  ${classId}: \\{[\\s\\S]*?\\n  \\},`,
              'm'
            );
            if (!classRegex.test(source)) {
              throw new Error(`Could not find ${classId} block in CLASS_ANIMATIONS`);
            }
            source = source.replace(classRegex, newBlock);
            fs.writeFileSync(filePath, source, 'utf-8');

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    sourcemap: true
  },
  server: {
    open: true
  },
  plugins: [animSavePlugin()],
});
