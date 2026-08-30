// Image-to-3D providers behind one interface.
//
// genkit hardcoded Meshy, which was right for characters — it rigs, and the
// character pipeline depends on that. It is the wrong default for environment
// kit pieces: a wall segment needs manifold geometry and flat mating faces, and
// 2026 comparisons put Tripo ahead of Meshy specifically on game-ready quad
// topology, with Rodin ahead on fidelity and Hunyuan3D self-hostable.
//
// Vendor choice belongs at the call site, not baked into the toolkit. It also
// matters for scale: a 30-piece kit per biome across a dozen biomes is hundreds
// of paid generations, and "regenerate until it tiles" is only affordable when
// generation is free. A self-hosted provider makes that a config change rather
// than a rewrite.
//
// Each provider implements:
//   name, requiresKey, available(env), imageTo3D({ image, id, polycount, onProgress }) -> { glbUrl }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export const meshy = {
  name: 'meshy',
  requiresKey: 'MESHY_API_KEY',
  // Rigs characters, broad plugin support, weaker guarantees on topology.
  best: 'characters, props, fast iteration',
  available: (env) => !!env.MESHY_API_KEY,
  /**
   * Can this account actually create tasks right now?
   *
   * A valid key and a positive balance are not sufficient: Meshy stopped
   * allowing task creation on free plans regardless of credits, so a batch
   * would generate every concept image, pay for them, and then fail on every
   * mesh. Checking once up front costs one request.
   */
  async preflight(env) {
    const key = env.MESHY_API_KEY;
    try {
      const r = await fetch('https://api.meshy.ai/openapi/v1/balance', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (r.status === 401 || r.status === 403) return { ok: false, reason: 'API key rejected' };
      const d = await r.json().catch(() => ({}));
      // Balance alone does not prove task creation is permitted; probe it.
      const probe = await fetch('https://api.meshy.ai/openapi/v1/image-to-3d', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),   // deliberately invalid — we want the gate, not a task
      });
      const pd = await probe.json().catch(() => ({}));
      const msg = String(pd.message || '');
      if (/free plan|upgrade your plan|NoMorePendingTasks/i.test(msg)) {
        return { ok: false, reason: `plan does not permit task creation (balance ${d.balance ?? '?'} credits stranded)` };
      }
      return { ok: true, note: `balance ${d.balance ?? '?'} credits` };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  },
  async imageTo3D({ image, id, polycount = 2500, env, onProgress }) {
    const key = env.MESHY_API_KEY;
    const create = await fetch('https://api.meshy.ai/openapi/v1/image-to-3d', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: `data:image/png;base64,${image.toString('base64')}`,
        ai_model: 'meshy-6', topology: 'triangle', target_polycount: polycount,
        should_remesh: true, should_texture: true, enable_pbr: true,
      }),
    });
    const cd = await create.json();
    if (!create.ok) throw new Error(`meshy create ${id}: ${JSON.stringify(cd).slice(0, 200)}`);
    const taskId = cd.result;
    for (let i = 0; i < 360; i++) {
      await sleep(5000);
      const r = await fetch(`https://api.meshy.ai/openapi/v1/image-to-3d/${taskId}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      const d = await r.json().catch(() => ({}));
      if (d.status === 'SUCCEEDED') return { glbUrl: d.model_urls?.glb, raw: d };
      if (d.status === 'FAILED') throw new Error(`meshy ${id}: ${d.task_error?.message}`);
      if (i % 6 === 0) onProgress?.(d.status, d.progress || 0);
    }
    throw new Error(`meshy ${id}: timed out`);
  },
};

export const tripo = {
  name: 'tripo',
  requiresKey: 'TRIPO_API_KEY',
  async preflight(env) {
    try {
      const r = await fetch('https://api.tripo3d.ai/v2/openapi/user/balance', {
        headers: { Authorization: `Bearer ${env.TRIPO_API_KEY}` },
      });
      if (!r.ok) return { ok: false, reason: `balance check returned ${r.status}` };
      const d = await r.json().catch(() => ({}));
      return { ok: true, note: `balance ${d.data?.balance ?? '?'}` };
    } catch (e) { return { ok: false, reason: e.message }; }
  },
  // Rated best for game-ready quad topology — the property kit pieces need to
  // mate cleanly at their edges.
  best: 'modular kit pieces, clean topology',
  available: (env) => !!env.TRIPO_API_KEY,
  async imageTo3D({ image, id, polycount = 2500, env, onProgress }) {
    const key = env.TRIPO_API_KEY;
    const create = await fetch('https://api.tripo3d.ai/v2/openapi/task', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'image_to_model',
        file: { type: 'png', data: image.toString('base64') },
        face_limit: polycount, texture: true, pbr: true, quad: true,
      }),
    });
    const cd = await create.json();
    if (!create.ok) throw new Error(`tripo create ${id}: ${JSON.stringify(cd).slice(0, 200)}`);
    const taskId = cd.data?.task_id;
    for (let i = 0; i < 240; i++) {
      await sleep(5000);
      const r = await fetch(`https://api.tripo3d.ai/v2/openapi/task/${taskId}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      const d = (await r.json().catch(() => ({}))).data || {};
      if (d.status === 'success') return { glbUrl: d.output?.pbr_model || d.output?.model, raw: d };
      if (d.status === 'failed' || d.status === 'banned') throw new Error(`tripo ${id}: ${d.status}`);
      if (i % 6 === 0) onProgress?.(d.status, d.progress || 0);
    }
    throw new Error(`tripo ${id}: timed out`);
  },
};

export const PROVIDERS = { meshy, tripo };

/**
 * Verify a provider can actually do work before a batch starts.
 * Returns { ok, reason?, note? }. Providers without a preflight pass by default.
 */
export async function preflight(provider, env) {
  if (!provider.preflight) return { ok: true, note: 'no preflight implemented' };
  return provider.preflight(env);
}

/**
 * Resolve a provider by name, falling back to whatever is configured.
 * Named explicitly so a missing key fails loudly at startup rather than
 * silently generating through the wrong vendor.
 */
export function resolveProvider(name, env) {
  if (name) {
    const p = PROVIDERS[name];
    if (!p) throw new Error(`unknown provider "${name}" — have: ${Object.keys(PROVIDERS).join(', ')}`);
    if (!p.available(env)) throw new Error(`provider "${name}" needs ${p.requiresKey} in .env`);
    return p;
  }
  const found = Object.values(PROVIDERS).find(p => p.available(env));
  if (!found) throw new Error(`no provider configured — set one of: ${Object.values(PROVIDERS).map(p => p.requiresKey).join(', ')}`);
  return found;
}
