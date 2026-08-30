#!/usr/bin/env node
// Prompt -> biome -> kit.
//
//   node scripts/generate-biome.mjs "a rotted forest shrine swallowed by roots"
//   node scripts/generate-biome.mjs "derelict orbital station" --generate --budget 20
//
// Authoring a level is normally an engine change: new geometry code, new
// materials, new lighting. A biome spec makes it a data change instead, which
// is the only way a prompt can produce a whole setting. This writes the spec,
// validates it against the same schema the assembler reads, and can then
// generate the kit meshes from the prompts inside it.
//
// Spec authoring is separated from asset generation on purpose: the spec is
// cheap and worth iterating on, the kit is slow and costs real money.

import fs from 'fs';
import path from 'path';
import { validateBiome } from '../src/rendering/env/KitSchema.js';
import { Budget, generateImage, imageTo3D, download, COST, loadEnv } from './lib/genkit.mjs';
import { resolveProvider, preflight } from './lib/providers.mjs';

/**
 * Confirm the provider can create tasks before anything is generated.
 * A previous run produced eight concept images, paid for them, then failed on
 * every mesh because the account's plan forbade task creation — the check that
 * would have caught it costs one request.
 */
async function assertProviderReady(name) {
  const env = loadEnv();
  const p = resolveProvider(name, env);
  const r = await preflight(p, env);
  if (!r.ok) {
    console.error(`\n  ${p.name} cannot generate: ${r.reason}`);
    console.error('  nothing was spent. resolve the provider, or pass --provider <other>\n');
    process.exit(2);
  }
  console.log(`  provider: ${p.name} (${r.note})`);
  return p.name;
}

const args = process.argv.slice(2);
const PROMPT = args.filter(a => !a.startsWith('--'))[0];
const GENERATE = args.includes('--generate');
const CAP = args.includes('--budget') ? parseFloat(args[args.indexOf('--budget') + 1]) : 15;
// Vendor per run. Kit pieces want clean mating geometry, which is not the same
// requirement as the character pipeline's (where Meshy's rigging is the point).
const PROVIDER = args.includes('--provider') ? args[args.indexOf('--provider') + 1] : null;
const BIOME_FILE = args.includes('--biome') ? args[args.indexOf('--biome') + 1] : null;

if (BIOME_FILE) {
  // Generate the kit for a biome that already exists, without paying for a new
  // spec — iterating on assets is separate from iterating on the design.
  const mod = await import(path.resolve('content/biomes', `${BIOME_FILE}.mjs`));
  const b = mod.default;
  const errs = validateBiome(b);
  if (errs.length) { console.error('  biome invalid:', errs); process.exit(1); }
  await assertProviderReady(PROVIDER);
  const dir = path.resolve('public/assets/models/kits', b.id);
  fs.mkdirSync(dir, { recursive: true });
  const budget = new Budget(CAP);
  console.log(`\n  generating kit for ${b.id} via ${PROVIDER || 'default provider'} — $${CAP.toFixed(2)} cap\n`);
  for (const p of b.kit) {
    const glb = path.join(dir, `${p.id}.glb`);
    if (fs.existsSync(glb)) { console.log(`  · ${p.id} exists`); continue; }
    try {
      const concept = path.resolve('public/assets/art/concepts', `kit_${b.id}_${p.id}.png`);
      const img = await generateImage({ prompt: p.prompt, out: concept, budget, commit: true });
      const r = await imageTo3D({ image: img, id: p.id, polycount: 2500, budget, commit: true,
        provider: PROVIDER, onProgress: (s, pc) => console.log(`      [${p.id}] ${s} ${pc}%`) });
      await download(r.model_urls.glb, glb);
      console.log(`  ✓ ${p.id}`);
    } catch (e) {
      console.log(`  ✗ ${p.id}: ${e.message}`);
      if (/budget exceeded/.test(e.message)) break;
    }
  }
  console.log(`\n  ${budget.report()}\n`);
  process.exit(0);
}

if (!PROMPT) {
  console.log('\n  usage: node scripts/generate-biome.mjs "<describe the place>" [--generate] [--budget N]\n');
  process.exit(1);
}

const env = fs.readFileSync(path.resolve('.env'), 'utf-8');
const OPENAI = env.match(/^OPENAI_API_KEY=(.+)$/m)?.[1]?.trim();

// The model authors the spec, but the schema decides what is valid. Describing
// the required shape here rather than trusting freeform output is what keeps a
// generated biome loadable by the assembler.
const SYSTEM = `You design environment kits for a top-down action RPG rendered in three.js.
Return ONLY minified JSON, no markdown fence, matching:
{
 "id": "snake_case_id",
 "name": "Display Name",
 "grid": { "cell": 4, "wallHeight": 6 },
 "atmosphere": { "ambientColor": 2761744, "ambientIntensity": 0.25, "fogColor": 1706504,
                 "fogDensity": 0.018, "keyColor": 16743492, "keyIntensity": 1.2,
                 "groundTint": 3807252, "bloomStrength": 0.9 },
 "kit": [ { "id":"snake_case", "role":"floor|wall|corner|doorway|pillar|stair|trim|ceiling|filler",
            "footprint":[1,1], "height":1, "variants":["..."], "prompt":"..." } ],
 "rules": { "fillerRate":0.1, "pillarRate":0.05, "trim":true, "variantJitter":true }
}
Rules:
- Colours are DECIMAL integers, not hex strings.
- MUST include at least one piece with role "floor", one "wall", one "corner".
- Include 7-9 pieces total covering floor, filler, wall, corner, doorway, pillar, stair, trim.
- Each prompt describes ONE tiling piece in isolation — never a scene, never
  multiple objects, never "a room". Pieces must repeat seamlessly on a grid.
- End every prompt with: "PBR game asset, neutral even lighting, no baked shadows, isolated on transparent background".
- Walls need a flat back face; corners need two finished faces.
- Atmosphere colours should suit the setting, not default to dungeon amber.`;

console.log(`\n  authoring biome from: "${PROMPT}"`);
const res = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI}` },
  body: JSON.stringify({
    model: 'gpt-4o',
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: PROMPT }],
    temperature: 0.8,
    response_format: { type: 'json_object' },
  }),
});
const j = await res.json();
if (!res.ok) { console.error('  spec generation failed:', JSON.stringify(j).slice(0, 300)); process.exit(1); }

let spec;
try { spec = JSON.parse(j.choices[0].message.content); }
catch (e) { console.error('  model returned unparseable JSON'); process.exit(1); }

// Validate against the real schema before writing, so a bad spec never reaches
// the assembler or burns generation spend.
const shaped = { ...spec, kit: (spec.kit || []).map(p => ({ variants: [], footprint: [1, 1], height: 1, tags: [], ...p })) };
const errs = validateBiome(shaped);
if (errs.length) {
  console.error('  spec invalid:');
  for (const e of errs) console.error('    · ' + e);
  process.exit(1);
}

const outPath = path.resolve('content/biomes', `${shaped.id}.mjs`);
const body = `// GENERATED from prompt: ${JSON.stringify(PROMPT)}
// Edit freely — this is the source of truth for the biome, not a cache.
import { piece } from '../../src/rendering/env/KitSchema.js';

export default {
  id: ${JSON.stringify(shaped.id)},
  name: ${JSON.stringify(shaped.name)},
  prompt: ${JSON.stringify(PROMPT)},
  grid: ${JSON.stringify(shaped.grid)},
  atmosphere: ${JSON.stringify(shaped.atmosphere, null, 2).replace(/\n/g, '\n  ')},
  kit: [
${shaped.kit.map(p => `    piece(${JSON.stringify(p, null, 2).replace(/\n/g, '\n    ')}),`).join('\n')}
  ],
  rules: ${JSON.stringify(shaped.rules ?? {}, null, 2).replace(/\n/g, '\n  ')},
};
`;
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, body);

console.log(`  ✓ ${shaped.id} — ${shaped.kit.length} kit pieces`);
for (const p of shaped.kit) console.log(`      ${p.role.padEnd(9)} ${p.id}`);
console.log(`  written to content/biomes/${shaped.id}.mjs`);

if (!GENERATE) {
  const est = shaped.kit.length * (COST.image + COST.mesh);
  console.log(`\n  kit not generated. estimated ~$${est.toFixed(2)} for ${shaped.kit.length} pieces`);
  console.log(`  run again with --generate to build the meshes\n`);
  process.exit(0);
}

await assertProviderReady(PROVIDER);
const dir = path.resolve('public/assets/models/kits', shaped.id);
fs.mkdirSync(dir, { recursive: true });
const budget = new Budget(CAP);
console.log(`\n  generating kit — $${CAP.toFixed(2)} cap\n`);

for (const p of shaped.kit) {
  const glb = path.join(dir, `${p.id}.glb`);
  if (fs.existsSync(glb)) { console.log(`  · ${p.id} exists`); continue; }
  try {
    const concept = path.resolve('public/assets/art/concepts', `kit_${shaped.id}_${p.id}.png`);
    const img = await generateImage({ prompt: p.prompt, out: concept, budget, commit: true });
    const r = await imageTo3D({ image: img, id: p.id, polycount: 2500, budget, commit: true,
      provider: PROVIDER,
      onProgress: (s, pc) => console.log(`      [${p.id}] ${s} ${pc}%`) });
    await download(r.model_urls.glb, glb);
    console.log(`  ✓ ${p.id}`);
  } catch (e) {
    console.log(`  ✗ ${p.id}: ${e.message}`);
    if (/budget exceeded/.test(e.message)) break;
  }
}
console.log(`\n  ${budget.report()}`);
console.log(`  preview: /dungeon-preview.html  (Kit toggle)\n`);
