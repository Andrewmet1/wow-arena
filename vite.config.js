import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import { spawn, exec } from 'child_process';

// Dev-only plugin: save viewer settings back to AssetManifest.js

// Simple multipart form parser for file uploads
function parseMultipart(buffer, boundary) {
  const sep = Buffer.from('--' + boundary);
  const parts = [];
  let start = 0;
  while (true) {
    const idx = buffer.indexOf(sep, start);
    if (idx === -1) break;
    if (start > 0) {
      // Parse the part between previous sep and this sep
      const partBuf = buffer.slice(start, idx - 2); // -2 for \r\n before boundary
      const headerEnd = partBuf.indexOf('\r\n\r\n');
      if (headerEnd !== -1) {
        const headers = partBuf.slice(0, headerEnd).toString('utf-8');
        const body = partBuf.slice(headerEnd + 4);
        const nameMatch = headers.match(/name="([^"]+)"/);
        const filenameMatch = headers.match(/filename="([^"]+)"/);
        if (nameMatch) {
          parts.push({
            name: nameMatch[1],
            filename: filenameMatch?.[1] || null,
            data: body,
            value: filenameMatch ? null : body.toString('utf-8'),
          });
        }
      }
    }
    start = idx + sep.length + 2; // +2 for \r\n after boundary
    // Check for terminator --
    if (buffer[idx + sep.length] === 0x2d && buffer[idx + sep.length + 1] === 0x2d) break;
  }
  return parts;
}

// Debounced auto build + deploy to live site
let _deployTimer = null;
let _deployStatus = { state: 'idle', message: '', timestamp: 0 }; // idle | building | deploying | success | failed
let _deploying = false;

const SSH_KEY = '~/.ssh/ebon-crucible-lightsail.pem';
const SSH_HOST = 'ubuntu@52.54.205.70';
const CLIENT_DIR = '/var/www/eboncrucible.com';
const SERVER_DIR = '/opt/ebon-crucible';

// Build using Vite JS API (doesn't conflict with running dev server)
async function _viteBuild() {
  const { build } = await import('vite');
  await build({ logLevel: 'silent' });
}

// Deploy files via SCP (returns promise)
function _execAsync(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: process.cwd(), timeout: 120000 }, (err, stdout, stderr) => {
      if (err) reject(err); else resolve(stdout);
    });
  });
}

// Client + skin model deploy (for animation/weapon saves and baked GLB exports)
function _autoDeploy() {
  if (_deployTimer) clearTimeout(_deployTimer);
  if (_deploying) return;
  _deployStatus = { state: 'building', message: 'Building...', timestamp: Date.now() };
  _deployTimer = setTimeout(async () => {
    _deploying = true;
    console.log('[auto-deploy] Starting client build + deploy...');
    try {
      _deployStatus = { state: 'building', message: 'Building client...', timestamp: Date.now() };
      await _viteBuild();
      _deployStatus = { state: 'deploying', message: 'Uploading...', timestamp: Date.now() };
      await _execAsync(
        `scp -i ${SSH_KEY} dist/assets/*.js dist/assets/*.css ${SSH_HOST}:${CLIENT_DIR}/assets/ && ` +
        `scp -i ${SSH_KEY} dist/play/index.html ${SSH_HOST}:${CLIENT_DIR}/play/index.html && ` +
        `scp -i ${SSH_KEY} public/assets/models/skins/*.glb ${SSH_HOST}:${CLIENT_DIR}/assets/models/skins/ 2>/dev/null; ` +
        `scp -i ${SSH_KEY} public/assets/models/wpn_*.glb ${SSH_HOST}:${CLIENT_DIR}/assets/models/ 2>/dev/null; ` +
        `ssh -i ${SSH_KEY} ${SSH_HOST} 'cd ${CLIENT_DIR}/assets && for f in *.js *.css; do grep -q "$f" ${CLIENT_DIR}/play/index.html 2>/dev/null || grep -q "$f" ${CLIENT_DIR}/index.html 2>/dev/null || rm -f "$f"; done'`
      );
      console.log('[auto-deploy] SUCCESS — client updated');
      _deployStatus = { state: 'success', message: 'Live site updated', timestamp: Date.now() };
    } catch (err) {
      console.error('[auto-deploy] FAILED:', err.message);
      _deployStatus = { state: 'failed', message: err.message.slice(0, 100), timestamp: Date.now() };
    }
    _deploying = false;
  }, 2000);
}

// Full deploy (for skin publish — deploys client + server + skin art assets)
function _autoDeployFull(onDone) {
  if (_deployTimer) clearTimeout(_deployTimer);
  if (_deploying) { if (onDone) onDone(new Error('Deploy already in progress')); return; }
  _deploying = true;
  console.log('[auto-deploy-full] Starting client + server + art deploy...');
  _deployStatus = { state: 'building', message: 'Building client...', timestamp: Date.now() };
  (async () => {
    try {
      await _viteBuild();
      _deployStatus = { state: 'deploying', message: 'Uploading...', timestamp: Date.now() };
      await _execAsync(
        `scp -i ${SSH_KEY} dist/assets/*.js dist/assets/*.css ${SSH_HOST}:${CLIENT_DIR}/assets/ && ` +
        `scp -i ${SSH_KEY} dist/play/index.html ${SSH_HOST}:${CLIENT_DIR}/play/index.html && ` +
        `ssh -i ${SSH_KEY} ${SSH_HOST} 'cd ${CLIENT_DIR}/assets && for f in *.js *.css; do grep -q "$f" ${CLIENT_DIR}/play/index.html 2>/dev/null || grep -q "$f" ${CLIENT_DIR}/index.html 2>/dev/null || rm -f "$f"; done' && ` +
        `scp -i ${SSH_KEY} public/assets/art/skins/*.webp ${SSH_HOST}:${CLIENT_DIR}/assets/art/skins/ 2>/dev/null; ` +
        `scp -i ${SSH_KEY} public/assets/models/skins/*.glb ${SSH_HOST}:${CLIENT_DIR}/assets/models/skins/ 2>/dev/null; ` +
        `tar czf /tmp/_ebon_pages.tar.gz classes/ news/ index.html && ` +
        `scp -i ${SSH_KEY} /tmp/_ebon_pages.tar.gz ${SSH_HOST}:/tmp/ && ` +
        `ssh -i ${SSH_KEY} ${SSH_HOST} "cd ${CLIENT_DIR} && tar xzf /tmp/_ebon_pages.tar.gz" && ` +
        `scp -i ${SSH_KEY} public/news/feed.json ${SSH_HOST}:${CLIENT_DIR}/news/feed.json 2>/dev/null; ` +
        `tar czf /tmp/_ebon_srv.tar.gz server/ src/engine/ src/classes/ src/utils/ src/constants.js src/ai/ src/arena/ src/abilities/ && ` +
        `scp -i ${SSH_KEY} /tmp/_ebon_srv.tar.gz ${SSH_HOST}:/tmp/ && ` +
        `ssh -i ${SSH_KEY} ${SSH_HOST} "cd ${SERVER_DIR} && tar xzf /tmp/_ebon_srv.tar.gz && pm2 restart ebon-pvp --update-env"`
      );
      console.log('[auto-deploy-full] SUCCESS — client + server + art deployed');
      _deployStatus = { state: 'success', message: 'Full deploy complete', timestamp: Date.now() };
      if (onDone) onDone(null);
    } catch (err) {
      console.error('[auto-deploy-full] FAILED:', err.message);
      _deployStatus = { state: 'failed', message: err.message.slice(0, 100), timestamp: Date.now() };
      if (onDone) onDone(err);
    }
    _deploying = false;
  })();
}

function animSavePlugin() {
  return {
    name: 'viewer-save',
    configureServer(server) {
      // ── Deploy status polling endpoint ──
      server.middlewares.use('/api/deploy-status', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(_deployStatus));
      });
      // ── Save weapon offsets + weaponsBakedIn ──
      server.middlewares.use('/api/dungeon-theme', async (req, res) => {
        try {
          const url = new URL(req.url, 'http://x');
          const id = url.searchParams.get('themeId') || 'crucible_below';
          const mod = await server.ssrLoadModule('/server/dungeon/themes.js');
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(mod.THEMES?.[id] ?? { error: `unknown theme ${id}` }));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      // Same verdict content-check prints, as JSON, so the studio header and
      // the CLI gate read from one implementation rather than two.
      server.middlewares.use('/api/content-audit', async (req, res) => {
        try {
          const idx = await server.ssrLoadModule('/scripts/lib/content-index.mjs');
          const disk = idx.scanDisk();
          const eng = idx.scanEngine();
          const themes = idx.scanThemeTextures();
          const chars = idx.scanCharacters();
          const pooled = new Set(Object.values(eng.pools).flat());
          const themeLive = new Set(Object.values(themes).flatMap(i => i.live || []));
          const texOk = disk.textures.filter(t => eng.engineReferenced.has(t) || themeLive.has(t));
          // Must mirror content-check's `reachable()` exactly — pooled OR an
          // alias target OR referenced. Using only `referenced` counted the
          // blocked-but-pooled props as orphans and made the header disagree
          // with the CLI, which is the one thing this endpoint exists to avoid.
          const aliasTargets = new Set(Object.values(eng.aliases));
          const propOk = disk.props.filter(id =>
            pooled.has(id) || aliasTargets.has(id) || eng.referenced.has(id));
          const brokenRefs = [...pooled].filter(id => !disk.props.includes(id) && !eng.aliases[id]);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            props: { onDisk: disk.props.length, reachable: propOk.length, orphans: disk.props.length - propOk.length },
            textures: { onDisk: disk.textures.length, reachable: texOk.length, orphans: disk.textures.length - texOk.length },
            characters: { issues: chars.issues.length, detail: chars.issues },
            brokenRefs: brokenRefs.length,
          }));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      // ── Dungeon Studio ────────────────────────────────────────────────
      // Characters have had an authoring UI (viewer.html) for a long time;
      // the dungeon had an 81-line hardcoded probe. These back
      // dungeon-studio.html so prop placement can be inspected and reassigned
      // visually instead of by hand-editing DungeonManifest.js.

      server.middlewares.use('/api/dungeon-content', (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end('Method not allowed'); return; }
        try {
          const manifestPath = path.resolve('src/rendering/DungeonManifest.js');
          const src = fs.readFileSync(manifestPath, 'utf-8');
          const props = [];
          for (const m of src.matchAll(/\{ id: '([a-z0-9_]+)', placements: \[([^\]]*)\]([^}]*)\}/g)) {
            props.push({
              id: m[1],
              placements: [...m[2].matchAll(/'([a-z0-9_:]+)'/g)].map(x => x[1]),
              destructible: /destructible: true/.test(m[3]),
              cloth: /cloth: true/.test(m[3]),
            });
          }
          const textures = [];
          for (const m of src.matchAll(/\{ id: '([a-z0-9_]+)', role: '([a-z]+)', themes: \[([^\]]*)\] \}/g)) {
            textures.push({
              id: m[1], role: m[2],
              themes: [...m[3].matchAll(/'([a-z0-9_]+)'/g)].map(x => x[1]),
            });
          }
          const propDir = path.resolve('public/assets/models/props');
          const onDisk = fs.existsSync(propDir)
            ? fs.readdirSync(propDir).filter(f => f.endsWith('.glb')).map(f => f.slice(0, -4))
            : [];
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ props, textures, onDisk }));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      server.middlewares.use('/api/save-placement', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return; }
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
          try {
            const { id, placements, destructible, cloth } = JSON.parse(body);
            if (!id || !Array.isArray(placements) || !placements.length) {
              throw new Error('id and a non-empty placements array are required');
            }
            const filePath = path.resolve('src/rendering/DungeonManifest.js');
            let source = fs.readFileSync(filePath, 'utf-8');
            const line = `  { id: '${id}', placements: [${placements.map(x => `'${x}'`).join(', ')}]`
              + `${destructible ? ', destructible: true' : ''}${cloth ? ', cloth: true' : ''} },`;
            const re = new RegExp(`^  \\{ id: '${id}', placements: \\[[^\\]]*\\][^}]*\\},$`, 'm');
            if (!re.test(source)) throw new Error(`prop ${id} not found in manifest`);
            source = source.replace(re, line);
            fs.writeFileSync(filePath, source);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, id, placements }));
          } catch (err) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });

      // Generates a wing through the real server-side layout code, so what the
      // studio draws is what a run would actually produce — not a mock.
      server.middlewares.use('/api/preview-wing', async (req, res) => {
        try {
          const url = new URL(req.url, 'http://x');
          const roomType = url.searchParams.get('roomType') || 'combat';
          const roomIndex = parseInt(url.searchParams.get('roomIndex') || '2', 10);
          const themeId = url.searchParams.get('themeId') || 'crucible_below';
          const mod = await server.ssrLoadModule('/server/dungeon/WingLayout.js');
          let seed = parseInt(url.searchParams.get('seed') || '12345', 10);
          const rng = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
          const wing = mod.buildWing({ themeId, roomType, rng, isFirstWing: roomIndex === 0, roomIndex });
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(wing));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message, stack: err.stack?.split('\n').slice(0, 3) }));
        }
      });

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
            const { classId, skinId, weaponType, offset, weaponsBakedIn } = JSON.parse(body);
            if (!classId || !weaponType) throw new Error('Missing classId or weaponType');

            const filePath = path.resolve('src/rendering/AssetManifest.js');
            let source = fs.readFileSync(filePath, 'utf-8');

            const fmt = (v) => Number(Number(v).toFixed(4));
            const pos = (offset.position || [0, 0, 0]).map(fmt);
            const rot = (offset.rotation || [0, 0, 0]).map(fmt);
            const sc = (offset.scale || [1, 1, 1]).map(fmt);

            // Replace just this weapon type's sub-block within weaponOffset (always class-level)
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

            // Update weaponsBakedIn — skin-level (SKIN_ANIMATIONS) or class-level (ASSET_MANIFEST)
            if (skinId) {
              // Write to SKIN_ANIMATIONS entry for this skin
              const skinKey = `${classId}_${skinId}`;
              const skinBlockRegex = new RegExp(
                `(  ${skinKey}: \\{\\n)    weaponsBakedIn: (?:true|false)`,
                'm'
              );
              if (skinBlockRegex.test(source)) {
                source = source.replace(skinBlockRegex, `$1    weaponsBakedIn: ${!!weaponsBakedIn}`);
              } else {
                // Try inserting weaponsBakedIn as first property in existing skin block
                const skinOpenRegex = new RegExp(`(  ${skinKey}: \\{\\n)`, 'm');
                if (skinOpenRegex.test(source)) {
                  source = source.replace(skinOpenRegex, `$1    weaponsBakedIn: ${!!weaponsBakedIn},\n`);
                }
              }
            } else {
              // Write to class-level ASSET_MANIFEST entry
              const bakedRegex = new RegExp(
                `(  ${classId}: \\{[\\s\\S]*?)weaponsBakedIn: (?:true|false)`,
                'm'
              );
              if (bakedRegex.test(source)) {
                source = source.replace(bakedRegex, `$1weaponsBakedIn: ${!!weaponsBakedIn}`);
              }
            }

            fs.writeFileSync(filePath, source, 'utf-8');

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, deploying: true }));
            _autoDeploy();
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });

      // ── Save baked model GLB (model + weapons combined) ──
      server.middlewares.use('/api/save-baked-model', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }
        // Parse multipart form data manually (file + fields)
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
          try {
            const raw = Buffer.concat(chunks);
            const contentType = req.headers['content-type'] || '';
            const boundaryMatch = contentType.match(/boundary=(.+)/);
            if (!boundaryMatch) throw new Error('Missing multipart boundary');
            const boundary = boundaryMatch[1];
            const parts = parseMultipart(raw, boundary);

            const filePart = parts.find(p => p.filename);
            const classId = parts.find(p => p.name === 'classId')?.value;
            const skinId = parts.find(p => p.name === 'skinId')?.value;

            if (!filePart || !classId || !skinId) throw new Error('Missing file, classId, or skinId');

            // Save the GLB to the skins model directory
            const skinsDir = path.resolve('public/assets/models/skins');
            if (!fs.existsSync(skinsDir)) fs.mkdirSync(skinsDir, { recursive: true });
            const outPath = path.join(skinsDir, `${classId}_${skinId}.glb`);
            fs.writeFileSync(outPath, filePart.data);
            console.log(`[bake-model] Saved ${outPath} (${(filePart.data.length / 1024 / 1024).toFixed(1)} MB)`);

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, deploying: true, path: outPath }));
            _autoDeploy();
          } catch (err) {
            console.error('[bake-model] Error:', err);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });

      // ── List skins per class ──
      server.middlewares.use('/api/list-skins', (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }
        try {
          const modelsDir = path.resolve('public/assets/models');
          const skinsDir = path.resolve('public/assets/models/skins');
          const conceptsDir = path.resolve('public/assets/art/concepts');
          const classes = ['tyrant', 'wraith', 'infernal', 'harbinger', 'revenant'];
          const result = {};

          for (const cls of classes) {
            result[cls] = [];
            // Check for default model
            if (fs.existsSync(path.join(modelsDir, `char_${cls}.glb`))) {
              result[cls].push({ id: 'default', name: 'Default', file: `char_${cls}.glb`, path: `/assets/models/char_${cls}.glb` });
            }
            // Check for skins
            if (fs.existsSync(skinsDir)) {
              const skinFiles = fs.readdirSync(skinsDir)
                .filter(f => f.startsWith(`${cls}_`) && f.endsWith('.glb') && !f.includes('_backup_'));
              for (const sf of skinFiles) {
                const skinId = sf.replace(`${cls}_`, '').replace('.glb', '');
                const conceptFile = `${cls}_${skinId}.png`;
                const hasConceptArt = fs.existsSync(path.join(conceptsDir, conceptFile));
                result[cls].push({
                  id: skinId,
                  name: skinId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                  file: sf,
                  path: `/assets/models/skins/${sf}`,
                  conceptArt: hasConceptArt ? `/assets/art/concepts/${conceptFile}` : null,
                });
              }
            }
          }

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      // ── Generate concept art only (async child process) ──
      const conceptTasks = {};

      server.middlewares.use('/api/generate-concept', (req, res) => {
        const url = new URL(req.url, 'http://localhost');

        if (req.method === 'GET') {
          const taskId = url.searchParams.get('task');
          if (!taskId || !conceptTasks[taskId]) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Task not found' }));
            return;
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(conceptTasks[taskId]));
          return;
        }

        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }

        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const { classId, skinName, prompt } = JSON.parse(body);
            if (!classId || !skinName) throw new Error('Missing classId or skinName');

            const taskId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            const task = { status: 'running', step: 'Generating concept art...', log: [], result: null, error: null };
            conceptTasks[taskId] = task;

            const args = ['scripts/generate-skin.mjs', '--class', classId, '--name', skinName, '--concept-only'];
            if (prompt) args.push('--prompt', prompt);

            const child = spawn('node', args, { cwd: path.resolve('.') });

            child.stdout.on('data', (data) => {
              const lines = data.toString().split('\n').filter(l => l.trim());
              for (const line of lines) {
                task.log.push(line);
                if (line.includes('Step 1:')) task.step = 'Generating concept art...';
                else if (line.includes('No base reference')) task.step = 'Generating base reference first...';
                else if (line.includes('CONCEPT ART READY')) task.step = 'Concept art ready!';
              }
              if (task.log.length > 200) task.log = task.log.slice(-100);
            });

            child.stderr.on('data', (data) => {
              task.log.push('[ERR] ' + data.toString().trim());
            });

            child.on('close', (code) => {
              if (code === 0) {
                task.status = 'done';
                task.step = 'Concept art ready!';
                // Construct URL directly — more reliable than parsing stdout
                const conceptUrl = `/assets/art/concepts/${classId}_${skinName}.png`;
                const conceptPath = path.resolve(`public${conceptUrl}`);
                if (fs.existsSync(conceptPath)) {
                  task.result = { conceptUrl };
                } else {
                  // Fallback: try parsing from log output
                  const urlLine = task.log.find(l => l.includes('URL:'));
                  if (urlLine) {
                    const match = urlLine.match(/URL:\s+(\S+)/);
                    if (match) task.result = { conceptUrl: match[1] };
                  }
                }
              } else {
                task.status = 'error';
                task.step = 'Failed';
                task.error = task.log.slice(-5).join('\n');
              }
            });

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ taskId }));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });

      // ── Generate skin (async child process) ──
      const skinTasks = {}; // taskId → { status, log, result }

      server.middlewares.use('/api/generate-skin', (req, res) => {
        const url = new URL(req.url, 'http://localhost');

        // GET: poll task status
        if (req.method === 'GET') {
          const taskId = url.searchParams.get('task');
          if (!taskId || !skinTasks[taskId]) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Task not found' }));
            return;
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(skinTasks[taskId]));
          return;
        }

        // POST: start generation
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }

        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const { classId, skinName, prompt, skipConcept } = JSON.parse(body);
            if (!classId || !skinName) throw new Error('Missing classId or skinName');

            const taskId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            const task = { status: 'running', step: 'Starting...', log: [], result: null, error: null };
            skinTasks[taskId] = task;

            // Build args for generate-skin.mjs
            const args = ['scripts/generate-skin.mjs', '--class', classId, '--name', skinName];
            if (prompt) args.push('--prompt', prompt);
            if (skipConcept) args.push('--skip-concept');

            const child = spawn('node', args, { cwd: path.resolve('.') });

            child.stdout.on('data', (data) => {
              const lines = data.toString().split('\n').filter(l => l.trim());
              for (const line of lines) {
                task.log.push(line);
                // Parse step from output
                if (line.includes('Step 1:')) task.step = 'Generating concept art...';
                else if (line.includes('Step 2:')) task.step = 'Creating 3D model (Meshy)...';
                else if (line.includes('Step 3:')) task.step = 'Auto-rigging model...';
                else if (line.includes('Step 4:')) task.step = 'Downloading rigged model...';
                else if (line.includes('DONE!')) task.step = 'Complete!';
                else if (line.includes('Status:')) {
                  const match = line.match(/(\d+)%/);
                  if (match) task.step = task.step.replace(/\.\.\.$/, '') + ` (${match[1]}%)...`;
                }
              }
              // Keep log from growing too large
              if (task.log.length > 200) task.log = task.log.slice(-100);
            });

            child.stderr.on('data', (data) => {
              task.log.push('[ERR] ' + data.toString().trim());
            });

            child.on('close', (code) => {
              if (code === 0) {
                task.status = 'done';
                task.step = 'Complete!';
                // Extract rig task ID from log
                const rigLine = task.log.find(l => l.includes('Rig Task:'));
                if (rigLine) {
                  const match = rigLine.match(/Rig Task:\s+(\S+)/);
                  if (match) task.result = { rigTaskId: match[1] };
                }
              } else {
                task.status = 'error';
                task.step = 'Failed';
                task.error = task.log.slice(-5).join('\n');
              }
            });

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ taskId }));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });

      // ── List available animation sets (with clip filenames) ──
      server.middlewares.use('/api/list-anim-sets', (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }
        try {
          const animDir = path.resolve('public/assets/animations');
          const sets = [];

          // Default shared set
          const sharedDir = path.join(animDir, 'shared');
          if (fs.existsSync(sharedDir)) {
            const clips = fs.readdirSync(sharedDir).filter(f => f.endsWith('.glb'));
            sets.push({ id: 'shared', name: 'Shared (default)', clipCount: clips.length, path: 'shared', clips });
          }

          // Rig-specific sets
          const rigsDir = path.join(animDir, 'rigs');
          if (fs.existsSync(rigsDir)) {
            const rigDirs = fs.readdirSync(rigsDir, { withFileTypes: true }).filter(d => d.isDirectory());
            for (const dir of rigDirs) {
              const clips = fs.readdirSync(path.join(rigsDir, dir.name)).filter(f => f.endsWith('.glb'));
              sets.push({
                id: dir.name,
                name: dir.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                clipCount: clips.length,
                path: `rigs/${dir.name}`,
                clips,
              });
            }
          }

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(sets));
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      // ── Generate animations (async child process) ──
      const animTasks = {};

      server.middlewares.use('/api/generate-animations', (req, res) => {
        const url = new URL(req.url, 'http://localhost');

        // GET: poll task status
        if (req.method === 'GET') {
          const taskId = url.searchParams.get('task');
          if (!taskId || !animTasks[taskId]) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Task not found' }));
            return;
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(animTasks[taskId]));
          return;
        }

        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }

        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const { rigTaskId, filter, force, rigName } = JSON.parse(body);
            if (!rigTaskId) throw new Error('Missing rigTaskId');

            const taskId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            const task = { status: 'running', step: 'Starting...', log: [], result: null, error: null };
            animTasks[taskId] = task;

            const args = ['scripts/generate-animations.mjs', '--rig-task', rigTaskId];
            if (filter) args.push('--only', filter);
            if (force) args.push('--force');
            if (rigName) args.push('--rig-name', rigName);

            const child = spawn('node', args, { cwd: path.resolve('.') });

            child.stdout.on('data', (data) => {
              const lines = data.toString().split('\n').filter(l => l.trim());
              for (const line of lines) {
                task.log.push(line);
                if (line.includes('GENERATING')) task.step = 'Generating animations...';
                else if (line.includes('──') && line.includes('action_id')) {
                  const clipMatch = line.match(/── (\S+)/);
                  if (clipMatch) task.step = `Generating: ${clipMatch[1]}...`;
                }
                else if (line.includes('complete!')) task.step = line.trim();
                else if (line.includes('Status:')) {
                  const match = line.match(/(\d+)%/);
                  if (match) task.step = `Progress: ${match[1]}%`;
                }
                else if (line.includes('SUMMARY')) task.step = 'Complete!';
              }
              if (task.log.length > 200) task.log = task.log.slice(-100);
            });

            child.stderr.on('data', (data) => {
              task.log.push('[ERR] ' + data.toString().trim());
            });

            child.on('close', (code) => {
              if (code === 0) {
                task.status = 'done';
                task.step = 'Complete!';
              } else {
                task.status = 'error';
                task.step = 'Failed';
                task.error = task.log.slice(-5).join('\n');
              }
            });

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ taskId }));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });

      // ── Generate weapon concept art (async child process) ──
      const weaponConceptTasks = {};

      server.middlewares.use('/api/generate-weapon-concept', (req, res) => {
        const url = new URL(req.url, 'http://localhost');

        if (req.method === 'GET') {
          const taskId = url.searchParams.get('task');
          if (!taskId || !weaponConceptTasks[taskId]) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Task not found' }));
            return;
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(weaponConceptTasks[taskId]));
          return;
        }

        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }

        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const { classId, weaponType, prompt, skinId } = JSON.parse(body);
            if (!classId || !weaponType) throw new Error('Missing classId or weaponType');

            const taskId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            const task = { status: 'running', step: 'Generating weapon concept art...', log: [], result: null, error: null };
            weaponConceptTasks[taskId] = task;

            const args = ['scripts/generate-weapons.mjs', classId, '--weapon', weaponType, '--concept-only'];
            if (prompt) args.push('--prompt', prompt);
            if (skinId && skinId !== 'default') args.push('--skin', skinId);

            const child = spawn('node', args, { cwd: path.resolve('.') });

            child.stdout.on('data', (data) => {
              const lines = data.toString().split('\n').filter(l => l.trim());
              for (const line of lines) {
                task.log.push(line);
                if (line.includes('Step 1:')) task.step = 'Generating weapon concept art...';
                else if (line.includes('CONCEPT ART READY')) task.step = 'Concept art ready!';
              }
              if (task.log.length > 200) task.log = task.log.slice(-100);
            });

            child.stderr.on('data', (data) => {
              task.log.push('[ERR] ' + data.toString().trim());
            });

            child.on('close', (code) => {
              if (code === 0) {
                task.status = 'done';
                task.step = 'Concept art ready!';
                // Construct URL directly — more reliable than parsing stdout
                const conceptUrl = `/assets/art/concepts/wpn_${classId}_${weaponType}.png`;
                const conceptPath = path.resolve(`public${conceptUrl}`);
                if (fs.existsSync(conceptPath)) {
                  task.result = { conceptUrl };
                } else {
                  // Fallback: try parsing from log output
                  const urlLine = task.log.find(l => l.includes('URL:'));
                  if (urlLine) {
                    const match = urlLine.match(/URL:\s+(\S+)/);
                    if (match) task.result = { conceptUrl: match[1] };
                  }
                }
              } else {
                task.status = 'error';
                task.step = 'Failed';
                task.error = task.log.slice(-5).join('\n');
              }
            });

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ taskId }));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });

      // ── Generate weapon 3D model (async child process) ──
      const weaponTasks = {};

      server.middlewares.use('/api/generate-weapon', (req, res) => {
        const url = new URL(req.url, 'http://localhost');

        // GET: poll task status
        if (req.method === 'GET') {
          const taskId = url.searchParams.get('task');
          if (!taskId || !weaponTasks[taskId]) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Task not found' }));
            return;
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(weaponTasks[taskId]));
          return;
        }

        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }

        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const { classId, weaponType, prompt, skipConcept, skinId } = JSON.parse(body);
            if (!classId || !weaponType) throw new Error('Missing classId or weaponType');

            const taskId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            const task = { status: 'running', step: 'Starting...', log: [], result: null, error: null };
            weaponTasks[taskId] = task;

            const args = ['scripts/generate-weapons.mjs', classId, '--weapon', weaponType];
            if (prompt) args.push('--prompt', prompt);
            if (skipConcept) args.push('--skip-concept');
            if (skinId && skinId !== 'default') args.push('--skin', skinId);

            const child = spawn('node', args, { cwd: path.resolve('.') });

            child.stdout.on('data', (data) => {
              const lines = data.toString().split('\n').filter(l => l.trim());
              for (const line of lines) {
                task.log.push(line);
                if (line.includes('Step 1:')) task.step = 'Generating concept art...';
                else if (line.includes('Step 2:') || line.includes('Image-to-3D')) task.step = 'Creating 3D model (Meshy)...';
                else if (line.includes('Step 3:') || line.includes('Downloading')) task.step = 'Downloading model...';
                else if (line.includes('DONE!')) task.step = 'Complete!';
                else if (line.includes('Status:')) {
                  const match = line.match(/(\d+)%/);
                  if (match) task.step = task.step.replace(/\.\.\.$/, '') + ` (${match[1]}%)...`;
                }
              }
              if (task.log.length > 200) task.log = task.log.slice(-100);
            });

            child.stderr.on('data', (data) => {
              task.log.push('[ERR] ' + data.toString().trim());
            });

            child.on('close', (code) => {
              if (code === 0) {
                task.status = 'done';
                task.step = 'Complete!';
              } else {
                task.status = 'error';
                task.step = 'Failed';
                task.error = task.log.slice(-5).join('\n');
              }
            });

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ taskId }));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });

      // ── Generate skin description via GPT-4 ──
      server.middlewares.use('/api/generate-description', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return; }
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
          try {
            const { classId, skinName } = JSON.parse(body);
            if (!classId || !skinName) throw new Error('Missing classId or skinName');

            const envPath = path.resolve('.env');
            const envText = fs.readFileSync(envPath, 'utf-8');
            const apiKey = envText.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
            if (!apiKey) throw new Error('No OPENAI_API_KEY in .env');

            const classNames = { tyrant: 'Tyrant (armored warlord warrior)', wraith: 'Wraith (shadow assassin rogue)', infernal: 'Infernal (fire/ice battle mage)', harbinger: 'Harbinger (death warlock necromancer)', revenant: 'Revenant (holy crusader paladin)' };
            const className = classNames[classId] || classId;

            const resp = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
              body: JSON.stringify({
                model: 'gpt-4o-mini',
                max_tokens: 150,
                messages: [{
                  role: 'system',
                  content: 'You write short, evocative dark fantasy lore descriptions for cosmetic skins in an arena combat game called Ebon Crucible. Keep it to 1-2 sentences. Be dramatic and atmospheric. Focus on the skin\'s theme and how it transforms the character\'s appearance or origin story. Do NOT use generic phrases like "a force to be reckoned with".',
                }, {
                  role: 'user',
                  content: `Write a shop description for the "${skinName}" skin for the ${className} class. This is a cosmetic alternate appearance.`,
                }],
              }),
            });

            const data = await resp.json();
            const description = data.choices?.[0]?.message?.content?.trim() || '';
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ description }));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });

      // ── Publish skin (generate art + register in AssetManifest) ──
      const publishTasks = {};

      server.middlewares.use('/api/publish-skin', (req, res) => {
        const url = new URL(req.url, 'http://localhost');

        // GET: poll task status
        if (req.method === 'GET') {
          const taskId = url.searchParams.get('task');
          if (!taskId || !publishTasks[taskId]) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Task not found' }));
            return;
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(publishTasks[taskId]));
          return;
        }

        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }

        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const { classId, skinId, newSkinId, name, rarity, price, description } = JSON.parse(body);
            if (!classId || !skinId) throw new Error('Missing classId or skinId');

            // Rename skin files if newSkinId is provided
            const effectiveSkinId = newSkinId || skinId;
            if (newSkinId && newSkinId !== skinId) {
              const skinsDir = path.resolve('public/assets/models/skins');
              const conceptsDir = path.resolve('public/assets/art/concepts');
              const rigsDir = path.resolve('public/assets/animations/rigs');

              // Rename GLB
              const oldGlb = path.join(skinsDir, `${classId}_${skinId}.glb`);
              const newGlb = path.join(skinsDir, `${classId}_${newSkinId}.glb`);
              if (fs.existsSync(oldGlb)) {
                fs.renameSync(oldGlb, newGlb);
                console.log(`[Publish] Renamed GLB: ${skinId} → ${newSkinId}`);
              }

              // Rename concept art
              const oldConcept = path.join(conceptsDir, `${classId}_${skinId}.png`);
              const newConcept = path.join(conceptsDir, `${classId}_${newSkinId}.png`);
              if (fs.existsSync(oldConcept)) fs.renameSync(oldConcept, newConcept);

              // Rename animation rig directory
              const oldRigDir = path.join(rigsDir, `${classId}_${skinId}`);
              const newRigDir = path.join(rigsDir, `${classId}_${newSkinId}`);
              if (fs.existsSync(oldRigDir)) {
                fs.renameSync(oldRigDir, newRigDir);
                console.log(`[Publish] Renamed rig dir: ${classId}_${skinId} → ${classId}_${newSkinId}`);
              }

              // Update SKIN_ANIMATIONS in AssetManifest.js if it references the old name
              const manifestPath = path.resolve('src/rendering/AssetManifest.js');
              let manifest = fs.readFileSync(manifestPath, 'utf-8');
              const oldKey = `${classId}_${skinId}`;
              const newKey = `${classId}_${newSkinId}`;
              if (manifest.includes(oldKey)) {
                manifest = manifest.replaceAll(oldKey, newKey);
                fs.writeFileSync(manifestPath, manifest);
                console.log(`[Publish] Updated AssetManifest.js references: ${oldKey} → ${newKey}`);
              }
            }

            const taskId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            const task = { status: 'running', step: 'Starting...', log: [], result: null, error: null };
            publishTasks[taskId] = task;

            const args = ['scripts/generate-skin-art.mjs', '--class', classId, '--skin', effectiveSkinId];
            if (name) args.push('--name', name);
            if (rarity) args.push('--rarity', rarity);
            if (price) args.push('--price', String(price));
            if (description) args.push('--description', description);

            const child = spawn('node', args, { cwd: path.resolve('.') });

            child.stdout.on('data', (data) => {
              const lines = data.toString().split('\n').filter(l => l.trim());
              for (const line of lines) {
                task.log.push(line);
                if (line.includes('GENERATING SKIN ART')) task.step = 'Generating art assets...';
                else if (line.includes('Generating') && line.includes('...')) {
                  const match = line.match(/Generating (\S+)/);
                  if (match) task.step = `Generating: ${match[1]}...`;
                }
                else if (line.includes('ART COMPLETE')) task.step = 'Art generation complete';
                else if (line.includes('REGISTERING')) task.step = 'Registering in AssetManifest...';
                else if (line.includes('SHOP_PRICES')) task.step = 'Registering server price...';
                else if (line.includes('SKIN PUBLISHED')) task.step = 'Deploying to live site...';
              }
              if (task.log.length > 200) task.log = task.log.slice(-100);
            });

            child.stderr.on('data', (data) => {
              task.log.push('[ERR] ' + data.toString().trim());
            });

            child.on('close', (code) => {
              if (code === 0) {
                task.step = 'Deploying to live site...';
                _autoDeployFull((err) => {
                  task.status = 'done';
                  task.step = err ? 'Published (deploy failed — redeploy manually)' : 'Published & Deployed!';
                });
              } else {
                task.status = 'error';
                task.step = 'Failed';
                task.error = task.log.slice(-5).join('\n');
              }
            });

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ taskId }));
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
            const { classId, skinId, mapping, modelScale, skinWeapon } = JSON.parse(body);
            if (!classId || !mapping) throw new Error('Missing classId or mapping');

            const filePath = path.resolve('src/rendering/AssetManifest.js');
            let source = fs.readFileSync(filePath, 'utf-8');

            // Base state keys (first line of block)
            const baseKeys = ['idle', 'run', 'death', 'hit', 'dodge', 'stun', 'jump', 'auto_attack'];

            // Build a formatted block from entries
            function buildBlock(blockKey, entries) {
              const lines = [`  ${blockKey}: {`];
              const base = entries.filter(([k]) => baseKeys.includes(k));
              const abilities = entries.filter(([k]) => !baseKeys.includes(k));
              if (base.length) {
                lines.push(`    ${base.map(([k, v]) => `${k}: '${v}'`).join(', ')},`);
              }
              for (let i = 0; i < abilities.length; i += 2) {
                const parts = abilities.slice(i, i + 2).map(([k, v]) => `${k}: '${v}'`);
                lines.push(`    ${parts.join(', ')},`);
              }
              lines.push('  },');
              return lines.join('\n');
            }

            if (skinId && skinId !== 'default') {
              // --- Skin-specific save → SKIN_ANIMATIONS ---
              const skinKey = `${classId}_${skinId}`;

              // Preserve weaponsBakedIn from existing block (viewer doesn't send it)
              const existingBlockRegex = new RegExp(
                `  ${skinKey}: \\{[\\s\\S]*?\\n  \\},`,
                'm'
              );
              const existingMatch = source.match(existingBlockRegex);
              let preservedMeta = {};
              if (existingMatch) {
                const wbiMatch = existingMatch[0].match(/weaponsBakedIn:\s*(true|false)/);
                if (wbiMatch) preservedMeta.weaponsBakedIn = wbiMatch[1] === 'true';
                const msMatch = existingMatch[0].match(/modelScale:\s*([\d.]+)/);
                if (msMatch) preservedMeta.modelScale = parseFloat(msMatch[1]);
              }
              // Incoming modelScale from viewer overrides preserved value
              if (modelScale !== undefined && modelScale !== null) {
                preservedMeta.modelScale = parseFloat(modelScale);
              }

              // Build block with preserved metadata first
              // Filter out non-animation keys that leak from getClassAnimationMap()
              const metaKeys = new Set(['weaponsBakedIn', 'modelScale']);
              const entries = Object.entries(mapping).filter(([k]) => !metaKeys.has(k));
              const lines = [`  ${skinKey}: {`];
              if (preservedMeta.weaponsBakedIn !== undefined) {
                lines.push(`    weaponsBakedIn: ${preservedMeta.weaponsBakedIn},`);
              }
              if (preservedMeta.modelScale !== undefined) {
                lines.push(`    modelScale: ${preservedMeta.modelScale},`);
              }
              const base = entries.filter(([k]) => baseKeys.includes(k));
              const abilities = entries.filter(([k]) => !baseKeys.includes(k));
              if (base.length) {
                lines.push(`    ${base.map(([k, v]) => `${k}: '${v}'`).join(', ')},`);
              }
              for (let i = 0; i < abilities.length; i += 2) {
                const parts = abilities.slice(i, i + 2).map(([k, v]) => `${k}: '${v}'`);
                lines.push(`    ${parts.join(', ')},`);
              }
              lines.push('  },');
              const newBlock = lines.join('\n');

              // Try to replace existing skin block
              if (existingMatch) {
                source = source.replace(existingBlockRegex, newBlock);
              } else {
                // Insert new skin block into SKIN_ANIMATIONS
                const insertPoint = source.indexOf('export const SKIN_ANIMATIONS = {');
                if (insertPoint === -1) {
                  throw new Error('Could not find SKIN_ANIMATIONS in AssetManifest.js');
                }
                const bracePos = source.indexOf('{', insertPoint);
                source = source.slice(0, bracePos + 1) + '\n' + newBlock + source.slice(bracePos + 1);
              }
            } else {
              // --- Class-level save → CLASS_ANIMATIONS ---
              const newBlock = buildBlock(classId, Object.entries(mapping));
              const classRegex = new RegExp(
                `  ${classId}: \\{[\\s\\S]*?\\n  \\},`,
                'm'
              );
              if (!classRegex.test(source)) {
                throw new Error(`Could not find ${classId} block in CLASS_ANIMATIONS`);
              }
              source = source.replace(classRegex, newBlock);
            }

            // Update skinWeapons mapping if a skin weapon was specified
            if (skinId && skinWeapon) {
              const classLower = classId.toLowerCase();
              const swBlockRegex = new RegExp(`(${classLower}[\\s\\S]*?)(skinWeapons:\\s*\\{[^}]*\\})`, 'm');
              const swMatch = source.match(swBlockRegex);
              if (swMatch) {
                const swBlock = swMatch[2];
                const entryRegex = new RegExp(`${skinId}:\\s*'[^']*'`);
                if (entryRegex.test(swBlock)) {
                  source = source.replace(entryRegex, `${skinId}: '${skinWeapon}'`);
                } else {
                  source = source.replace(swBlock, swBlock.replace('}', `  ${skinId}: '${skinWeapon}',\n    }`));
                }
              } else {
                const dwRegex = new RegExp(`(${classLower}[\\s\\S]*?defaultWeapon:\\s*'[^']*',)`, 'm');
                const dwMatch = source.match(dwRegex);
                if (dwMatch) {
                  source = source.replace(dwMatch[0], dwMatch[0] + `\n    skinWeapons: {\n      ${skinId}: '${skinWeapon}',\n    },`);
                }
              }
            }

            fs.writeFileSync(filePath, source, 'utf-8');

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, deploying: true }));
            _autoDeploy();
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

// Dev-only files to exclude from production builds
const DEV_ONLY_FILES = ['viewer.html'];

// Plugin to strip dev-only files from the public/ copy during build
function excludeDevFiles() {
  return {
    name: 'exclude-dev-files',
    closeBundle() {
      for (const fileName of DEV_ONLY_FILES) {
        const filePath = path.resolve('dist', fileName);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`[exclude-dev-files] Removed ${fileName} from build output`);
        }
      }
    },
  };
}

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: 'index.html',
        play: 'play/index.html',
        news: 'news/index.html',
        // News article pages — discovered dynamically so new articles are auto-included
        ...(() => {
          const entries = {};
          try {
            const dirs = fs.readdirSync('news', { withFileTypes: true });
            for (const d of dirs) {
              if (d.isDirectory() && fs.existsSync(`news/${d.name}/index.html`)) {
                entries[`news-${d.name}`] = `news/${d.name}/index.html`;
              }
            }
          } catch (e) { /* news dir might not exist */ }
          return entries;
        })(),
        gameplay: 'gameplay/index.html',
        classes: 'classes/index.html',
        'classes-tyrant': 'classes/tyrant/index.html',
        'classes-wraith': 'classes/wraith/index.html',
        'classes-infernal': 'classes/infernal/index.html',
        'classes-harbinger': 'classes/harbinger/index.html',
        'classes-revenant': 'classes/revenant/index.html',
        rankings: 'rankings/index.html',
        community: 'community/index.html',
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
    }
  },
  server: {
    open: true,
    proxy: {
      '/api/forum': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/api/payments': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    }
  },
  plugins: [animSavePlugin(), excludeDevFiles()],
});
