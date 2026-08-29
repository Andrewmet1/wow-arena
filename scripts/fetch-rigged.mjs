#!/usr/bin/env node
/**
 * Fetch already-completed Meshy rigging tasks. The previous rig-monsters.mjs
 * had a wrong URL path (`model_urls.glb` instead of `result.rigged_character_glb_url`),
 * so the rigging actually succeeded but we never downloaded the GLBs.
 *
 * This script polls the existing rig task IDs, extracts the rigged GLB URLs,
 * and downloads them.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const envContent = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8');
const MESHY_KEY = envContent.match(/MESHY_API_KEY=(.+)/)?.[1]?.trim();
const MESHY_API = 'https://api.meshy.ai';
const MONSTERS_DIR = path.join(ROOT, 'public', 'assets', 'models', 'monsters');

const RIG_TASKS = {
  wraith_specter:  '019df600-e17d-793f-b4ea-8ec4cc9f75fe',
  drudgekin_brute: '019df600-e194-78c9-89e5-b7b262db1ccf',
  ashen_warlord:   '019df600-e199-7880-90bf-306933e09650',
  carrion_knight:  '019df600-f5a3-7941-bcb5-066f20495e7a',
};

async function fetchRigged(monsterId, rigTaskId) {
  const res = await fetch(`${MESHY_API}/openapi/v1/rigging/${rigTaskId}`, {
    headers: { 'Authorization': `Bearer ${MESHY_KEY}` },
  });
  const data = await res.json();
  if (data.status !== 'SUCCEEDED') {
    console.error(`[${monsterId}] task ${rigTaskId} status: ${data.status}`);
    return false;
  }
  // Try multiple field locations — the API doc varies by version
  const glbUrl = data.result?.rigged_character_glb_url
              || data.rigged_character_glb_url
              || data.model_urls?.glb
              || data.result?.model_urls?.glb;
  if (!glbUrl) {
    console.error(`[${monsterId}] no GLB URL — full response:`, JSON.stringify(data).slice(0, 500));
    return false;
  }
  console.log(`[${monsterId}] downloading ${glbUrl.slice(0, 80)}...`);
  const glbRes = await fetch(glbUrl);
  if (!glbRes.ok) {
    console.error(`[${monsterId}] download failed: ${glbRes.status}`);
    return false;
  }
  const buf = Buffer.from(await glbRes.arrayBuffer());
  const outPath = path.join(MONSTERS_DIR, `${monsterId}.glb`);
  fs.writeFileSync(outPath, buf);
  console.log(`[${monsterId}] saved (${(buf.length / 1024 / 1024).toFixed(1)} MB rigged)`);
  return true;
}

const results = await Promise.all(
  Object.entries(RIG_TASKS).map(([id, taskId]) => fetchRigged(id, taskId).catch(err => {
    console.error(`[${id}] error: ${err.message}`);
    return false;
  }))
);
const ok = results.filter(Boolean).length;
console.log(`\nDownloaded ${ok}/${results.length} rigged monsters`);
process.exit(ok === results.length ? 0 : 1);
