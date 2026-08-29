#!/usr/bin/env node
// Generate the missing UI + VFX assets for the dungeon overhaul:
//   - minimap_frame: top-right framed mask
//   - interactable_glow_vfx: pulsing glow ring for idol/brazier/bell/well
//   - interactable_prompt_frame: small "PRESS F" banner
//   - absorb_shield_overlay: semi-transparent shield bar texture
//   - pack_indicator: floating skull marker for not-yet-engaged mob packs
//   - loot_chest_open_concept + loot_gem_floor_concept (PNG concepts for Meshy 3D pass later)
//   - unit_frame_compact: smaller painted unit frame
//   - nameplate_bg: subtle nameplate backdrop strip
//   - pickup_glow: small upward beam glow for ground loot
//
// Output: /assets/art/ui/dungeon/ + /assets/art/vfx/

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OPENAI_KEY = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8').match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const UI_DIR  = path.join(ROOT, 'public', 'assets', 'art', 'ui', 'dungeon');
const VFX_DIR = path.join(ROOT, 'public', 'assets', 'art', 'vfx');
const CONCEPT_DIR = path.join(ROOT, 'public', 'assets', 'art', 'concepts');
fs.mkdirSync(UI_DIR, { recursive: true });
fs.mkdirSync(VFX_DIR, { recursive: true });
fs.mkdirSync(CONCEPT_DIR, { recursive: true });

const ASSETS = [
  // ── UI ──────────────────────────────────────────────────────────────
  { id: 'minimap_frame', dir: UI_DIR, size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy minimap UI frame on transparent background, ornate square gothic carved stone border with skull motifs in the four corners, crimson rune corner accents, the entire center is hollow and transparent so a square map render fits inside, top-down orthographic view, painterly digital art, transparent PNG, suitable as a 9-slice border for a minimap widget' },
  { id: 'unit_frame_compact', dir: UI_DIR, size: '1536x1024', transparent: true,
    prompt: 'Dark fantasy compact horizontal unit frame UI on transparent background, slim painted gothic border with a circular portrait socket on the left and two horizontal bar slots on the right (top bar for health, bottom bar for resource), carved stone with crimson rune trim and small skull motif corners, painterly digital art, transparent PNG, designed to be small and unobtrusive in a corner of an HD screen' },
  { id: 'nameplate_bg', dir: UI_DIR, size: '1536x1024', transparent: true,
    prompt: 'Dark fantasy semi-transparent enemy nameplate background strip on transparent background, very wide skinny horizontal panel that fades to transparent on left and right edges, deep crimson stained iron with subtle rune trim along the top edge, painterly digital art, transparent PNG, will sit behind a name and small health bar' },
  { id: 'interactable_prompt_frame', dir: UI_DIR, size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy small UI prompt banner on transparent background, horizontal pill-shaped carved iron banner with a glowing rune key icon on the left and empty room for text on the right, suitable for showing "press F" when near an interactable, painterly digital art, transparent PNG' },
  { id: 'absorb_shield_overlay', dir: UI_DIR, size: '1536x1024', transparent: true,
    prompt: 'Dark fantasy absorb shield bar overlay texture on transparent background, very wide skinny horizontal bar of glowing pale gold holy plate scales with subtle inner light, edges fade slightly transparent, no border, designed to overlay on top of an existing red health bar to show absorb shield amount, painterly digital art, transparent PNG' },

  // ── VFX ─────────────────────────────────────────────────────────────
  { id: 'vfx_interactable_glow', dir: VFX_DIR, size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy interactable glow VFX ring on transparent background, single radial gradient ring of warm pulsing golden-amber light fading to fully transparent at the edges and at the center, suitable as a ground decal under an interactive object like a ritual brazier or ancient idol, painterly digital art, transparent PNG' },
  { id: 'vfx_pickup_beam', dir: VFX_DIR, size: '1024x1536', transparent: true,
    prompt: 'Dark fantasy loot pickup beam VFX on transparent background, vertical column of warm golden particle light rising upward from a glowing point at the bottom, soft ember sparks within the beam, fades to fully transparent at the top, painterly digital art, transparent PNG, suitable as a billboard sprite to mark loot on the ground' },
  { id: 'vfx_pack_marker', dir: VFX_DIR, size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy mob pack marker VFX on transparent background, single floating red horned skull glyph with subtle ember glow halo around it, top-down orthographic view, painterly digital art, transparent PNG, suitable as a minimap or world marker showing where an unengaged mob pack is located' },

  // ── 3D loot concepts (PNG concepts; Meshy pass later turns into GLB) ──
  { id: 'prop_loot_chest_open', dir: CONCEPT_DIR, size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy open loot chest 3D-game prop on transparent background, ornate iron-bound oak chest with the lid open and warm golden glow spilling from inside, gold coins and a single glowing gem visible inside, slight top-down 3/4 view, painterly digital art suitable as input for an image-to-3D pipeline, transparent PNG' },
  { id: 'prop_loot_gem_floor', dir: CONCEPT_DIR, size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy single glowing gem on the floor 3D-game prop on transparent background, a single faceted crimson gem resting on dark stone with soft inner glow, slight top-down 3/4 view, painterly digital art suitable as input for an image-to-3D pipeline, transparent PNG' },
  { id: 'prop_loot_gear_pile', dir: CONCEPT_DIR, size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy small pile of dropped gear on the floor 3D-game prop on transparent background, a single dropped shoulder pauldron with a glowing rune resting on dark stone, slight top-down 3/4 view, painterly digital art suitable as input for an image-to-3D pipeline, transparent PNG' },
];

async function gen(asset) {
  const out = path.join(asset.dir, `${asset.id}.png`);
  if (fs.existsSync(out)) { console.log(`[skip] ${asset.id}`); return; }
  console.log(`[gen] ${asset.id} ${asset.size}...`);
  const body = {
    model: 'gpt-image-1',
    prompt: asset.prompt,
    n: 1,
    size: asset.size,
    quality: 'medium',
    output_format: 'png',
  };
  if (asset.transparent) body.background = 'transparent';
  try {
    const r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) {
      console.error(`[ERR ${asset.id}]`, JSON.stringify(d).slice(0, 300));
      return;
    }
    fs.writeFileSync(out, Buffer.from(d.data[0].b64_json, 'base64'));
    console.log(`[ok] ${asset.id}`);
  } catch (e) {
    console.error(`[ERR ${asset.id}]`, e.message);
  }
}

console.log(`=== Overhaul asset batch: ${ASSETS.length} pieces ===`);
// Run in parallel — DALL-E concurrency is fine here.
await Promise.all(ASSETS.map(gen));
console.log('=== Done ===');
