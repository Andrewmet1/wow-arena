// genkit — the shared content-generation toolkit.
//
// Before this existed there were 42 generate-*.mjs scripts, 12 of which each
// reimplemented Meshy task polling, drifting apart as they went (meshy-5 vs
// meshy-6, a stale dall-e-3 among 76 gpt-image-1 call sites). Adding content
// meant copy-pasting ~250 lines, and the copy had no idea whether what it
// produced was ever wired into the game — which is how 27 props, 32 textures
// and 9 monsters ended up generated, paid for, and unreachable.
//
// Three properties make this safe to hand to an agent:
//   1. IDEMPOTENT   — existing files are skipped, so a rerun is free
//   2. BUDGETED     — every call has a price; a run refuses to exceed its cap
//   3. SELF-WIRING  — generated props are declared in DungeonManifest, so an
//                     asset cannot be produced without also being consumable
//
// Nothing here spends money without an explicit `commit: true`. The default is
// a dry run that reports what it *would* generate and what it would cost.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveProvider } from './providers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');

const MESHY_API = 'https://api.meshy.ai';

// One place to change the model. Drift between scripts is what produced the
// meshy-5/meshy-6/dall-e-3 mix.
export const MODELS = {
  image: 'gpt-image-1',
  mesh: 'meshy-6',
};

// Rough USD, for the budget guard. Meant to be conservative, not exact —
// its job is to stop a runaway loop, not to bill anyone.
export const COST = {
  image: 0.04,
  mesh: 0.40,
};

function loadKeys() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) throw new Error('.env not found at repo root');
  const env = fs.readFileSync(envPath, 'utf-8');
  const pick = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim();
  return { openai: pick('OPENAI_API_KEY'), meshy: pick('MESHY_API_KEY') };
}

/** Raw env map for providers, which each read their own key. */
export function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  const src = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
  const out = {};
  for (const m of src.matchAll(/^([A-Z0-9_]+)=(.*)$/gm)) out[m[1]] = m[2].trim();
  return out;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Tracks spend for one run and refuses to cross the cap. Without this an
 * unattended loop can burn real money on a bad prompt.
 */
export class Budget {
  constructor(usd) { this.cap = usd; this.spent = 0; this.items = []; }
  charge(kind, label) {
    const c = COST[kind] ?? 0;
    if (this.spent + c > this.cap) {
      throw new Error(`budget exceeded: ${this.spent.toFixed(2)} + ${c.toFixed(2)} > ${this.cap.toFixed(2)} cap (at "${label}")`);
    }
    this.spent += c;
    this.items.push({ kind, label, usd: c });
  }
  report() {
    return `$${this.spent.toFixed(2)} of $${this.cap.toFixed(2)} across ${this.items.length} calls`;
  }
}

async function withRetry(label, fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      if (i < tries - 1) await sleep(2000 * (i + 1));
    }
  }
  throw new Error(`${label}: ${last?.message}`);
}

/** Concept art. Returns a PNG buffer and writes it to `out`. */
export async function generateImage({ prompt, out, size = '1024x1024', transparent = true, budget, commit }) {
  if (fs.existsSync(out)) return fs.readFileSync(out);
  if (!commit) { budget?.charge('image', path.basename(out)); return null; }
  const { openai } = loadKeys();
  budget?.charge('image', path.basename(out));
  return withRetry(`image ${path.basename(out)}`, async () => {
    const r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openai}` },
      body: JSON.stringify({
        model: MODELS.image, prompt, n: 1, size, quality: 'medium',
        ...(transparent ? { background: 'transparent' } : {}),
        output_format: 'png',
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(d).slice(0, 200));
    const buf = Buffer.from(d.data[0].b64_json, 'base64');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buf);
    return buf;
  });
}

/**
 * Image -> textured 3D. Polls to completion.
 *
 * enable_pbr is on so Meshy returns normal/metallic/roughness alongside the
 * base colour; `texture_urls` in the result carries them. Characters lost their
 * PBR maps for months because the rigged GLB drops everything but baseColor —
 * if you rig, download texture_urls separately and reapply.
 */
export async function imageTo3D({ image, id, polycount = 15000, budget, commit, onProgress, provider }) {
  if (!commit) { budget?.charge('mesh', id); return null; }
  const env = loadEnv();
  // Vendor is chosen per call: characters want Meshy (it rigs), kit pieces want
  // whichever provider gives the cleanest mating geometry.
  const p = resolveProvider(provider, env);
  budget?.charge('mesh', id);
  const res = await p.imageTo3D({ image, id, polycount, env, onProgress });
  if (!res?.glbUrl) throw new Error(`${p.name} ${id}: no glb url in result`);
  return { model_urls: { glb: res.glbUrl }, provider: p.name, raw: res.raw };
}

/** Legacy Meshy-only path, kept for the character pipeline which relies on
 *  Meshy's texture_urls + rigging response shape. */
async function _imageTo3DMeshyDirect({ image, id, polycount = 15000, budget, commit, onProgress }) {
  if (!commit) { budget?.charge('mesh', id); return null; }
  const { meshy } = loadKeys();
  budget?.charge('mesh', id);
  const create = await fetch(`${MESHY_API}/openapi/v1/image-to-3d`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${meshy}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: `data:image/png;base64,${image.toString('base64')}`,
      ai_model: MODELS.mesh, topology: 'triangle', target_polycount: polycount,
      should_remesh: true, should_texture: true, enable_pbr: true,
    }),
  });
  const cd = await create.json();
  if (!create.ok) throw new Error(`meshy create ${id}: ${JSON.stringify(cd).slice(0, 200)}`);
  const taskId = cd.result;

  for (let i = 0; i < 360; i++) {
    await sleep(5000);
    const r = await fetch(`${MESHY_API}/openapi/v1/image-to-3d/${taskId}`, {
      headers: { Authorization: `Bearer ${meshy}` },
    });
    const d = await r.json().catch(() => ({}));
    if (d.status === 'SUCCEEDED') return d;
    if (d.status === 'FAILED') throw new Error(`meshy ${id} failed: ${d.task_error?.message}`);
    if (i % 6 === 0) onProgress?.(d.status, d.progress || 0);
  }
  throw new Error(`meshy ${id}: timed out`);
}

export async function download(url, out) {
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buf);
  return buf;
}

/**
 * Declare a prop in DungeonManifest.js.
 *
 * This is the step whose absence caused every orphan: generation wrote a file
 * and nothing ever told the engine it existed. Generating without declaring is
 * how you pay for an asset twice — once to make it, once to find it later.
 */
export function declareProp({ id, placements, destructible = false, cloth = false }) {
  const p = path.join(ROOT, 'src', 'rendering', 'DungeonManifest.js');
  const src = fs.readFileSync(p, 'utf-8');
  if (new RegExp(`id: '${id}'`).test(src)) return false;
  const entry = `  { id: '${id}', placements: [${placements.map(x => `'${x}'`).join(', ')}]`
    + `${destructible ? ', destructible: true' : ''}${cloth ? ', cloth: true' : ''} },\n`;
  const out = src.replace(/(export const PROPS = \[\n)/, `$1${entry}`);
  if (out === src) throw new Error('could not locate PROPS array in DungeonManifest.js');
  fs.writeFileSync(p, out);
  return true;
}

/** Prop pipeline: concept art -> 3D -> save -> declare. */
export async function generateProp({ id, prompt, placements = ['scatter'], destructible, cloth, budget, commit }) {
  const glb = path.join(ROOT, 'public', 'assets', 'models', 'props', `${id}.glb`);
  const concept = path.join(ROOT, 'public', 'assets', 'art', 'concepts', `prop_${id}.png`);
  if (fs.existsSync(glb)) {
    const declared = declareProp({ id, placements, destructible, cloth });
    return { id, status: declared ? 'existed-now-declared' : 'skipped' };
  }
  const img = await generateImage({ prompt, out: concept, budget, commit });
  if (!commit) return { id, status: 'would-generate' };
  const res = await imageTo3D({ image: img, id, budget, commit,
    onProgress: (s, p) => console.log(`    [${id}] ${s} ${p}%`) });
  const url = res.model_urls?.glb;
  if (!url) throw new Error(`${id}: no glb url in result`);
  await download(url, glb);
  declareProp({ id, placements, destructible, cloth });
  return { id, status: 'generated' };
}
