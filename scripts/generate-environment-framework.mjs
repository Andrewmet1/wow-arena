#!/usr/bin/env node
// Generate the asset library that backs the theme/environment framework:
//   - Vegetation tufts (grass/weed/dead-branch variants per theme)
//   - Weather VFX (rain, snow, ash, ember-fall droplets)
//   - Wet floor sheen overlay
//   - Light cone gradient
//   - Heightmap noise (for floor vertex displacement)
//   - Detailed wall variant textures (ornate panel, broken-stone, runic-relief)
//   - Theme-specific floor variants (frostbite snow, verdant moss, ashfall sand)
//
// All transparent PNGs where appropriate so they overlay cleanly on the
// underlying material.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OPENAI_KEY = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8').match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const VFX_DIR = path.join(ROOT, 'public', 'assets', 'art', 'vfx');
const DUNGEON_DIR = path.join(ROOT, 'public', 'assets', 'art', 'dungeon');
fs.mkdirSync(VFX_DIR, { recursive: true });
fs.mkdirSync(DUNGEON_DIR, { recursive: true });

const ASSETS = [
  // ── Vegetation tufts (billboard sprites) ────────────────────────────
  { id: 'vfx_grass_tuft_green', dir: VFX_DIR, size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy single tuft of dark green grass on transparent background, painterly billboard sprite, individual blades visible, fading slightly to transparent at base, top-down 3/4 view, 1024x1024 transparent PNG' },
  { id: 'vfx_grass_tuft_dry', dir: VFX_DIR, size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy single tuft of dry yellow-brown dead grass on transparent background, painterly billboard sprite, sparse withered blades, top-down 3/4 view, 1024x1024 transparent PNG' },
  { id: 'vfx_weed_cluster', dir: VFX_DIR, size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy small cluster of dark thorny weeds on transparent background, painterly billboard sprite, twisted black-green stalks with small thorns, top-down 3/4 view, 1024x1024 transparent PNG' },
  { id: 'vfx_vine_hanging', dir: VFX_DIR, size: '1024x1536', transparent: true,
    prompt: 'Dark fantasy hanging dead vine on transparent background, painterly tall vertical billboard sprite, twisted dark vine with sparse withered leaves, fades to transparent at top and bottom, designed to hang from walls, 1024x1536 transparent PNG' },
  { id: 'vfx_dead_branch', dir: VFX_DIR, size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy small dead twisted branch on transparent background, painterly billboard sprite, gnarled bare branch with no leaves, lying on the ground, top-down 3/4 view, 1024x1024 transparent PNG' },
  { id: 'vfx_moss_clump', dir: VFX_DIR, size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy clump of dark green moss on transparent background, painterly billboard sprite, fuzzy organic mass for sticking on walls and floor, fades to transparent at edges, top-down 3/4 view, 1024x1024 transparent PNG' },

  // ── Weather VFX ────────────────────────────────────────────────────
  { id: 'vfx_rain_streak', dir: VFX_DIR, size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy single rain streak on transparent background, vertical thin pale blue water line with subtle glow trail, painterly billboard sprite for instanced rain particles, fades to transparent at top and bottom, 1024x1024 transparent PNG' },
  { id: 'vfx_snow_flake', dir: VFX_DIR, size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy single irregular snowflake on transparent background, soft white pale-blue snowflake with feathery edges, slight inner glow, painterly billboard sprite for instanced snowfall, 1024x1024 transparent PNG' },
  { id: 'vfx_ash_fall', dir: VFX_DIR, size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy single falling ash flake on transparent background, irregular gray-black ash flake with subtle ember glow, painterly billboard sprite for instanced ashfall particles, 1024x1024 transparent PNG' },
  { id: 'vfx_lightning_flash', dir: VFX_DIR, size: '1024x1536', transparent: true,
    prompt: 'Dark fantasy lightning bolt on transparent background, jagged white-blue branching lightning streak from top to bottom of frame, painterly billboard sprite for lightning flash effect, fades to transparent at edges, 1024x1536 transparent PNG' },
  { id: 'vfx_wet_floor_sheen', dir: VFX_DIR, size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy wet floor sheen overlay on transparent background, soft semi-transparent pale gray reflection-blur pattern across the surface with brighter specular hot-spots, designed to overlay on a stone floor to make it look freshly wet, top-down view, 1024x1024 transparent PNG seamless tileable' },

  // ── Light volumetrics ──────────────────────────────────────────────
  { id: 'vfx_light_cone_warm', dir: VFX_DIR, size: '1024x1536', transparent: true,
    prompt: 'Dark fantasy volumetric warm orange light cone on transparent background, vertical narrowing cone of soft warm orange light from top to bottom (wide at top narrow at bottom), semi-transparent additive look, designed as a billboard sprite for visible torchlight cones through fog, fades to transparent at all edges, 1024x1536 transparent PNG' },
  { id: 'vfx_light_cone_cold', dir: VFX_DIR, size: '1024x1536', transparent: true,
    prompt: 'Dark fantasy volumetric cold pale-blue light cone on transparent background, vertical narrowing cone of soft pale blue light from top to bottom, semi-transparent additive look, billboard sprite for moonlight or magical cold light through fog, 1024x1536 transparent PNG' },
  { id: 'vfx_torch_halo', dir: VFX_DIR, size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy torch halo glow on transparent background, soft round orange-yellow halo of light with feathered edges fading to transparent, billboard sprite to be placed at torch flame positions for visible bloom, 1024x1024 transparent PNG' },

  // ── Heightmap / detail noise (NOT transparent — used as displacement map) ─
  { id: 'tex_heightmap_stone', dir: DUNGEON_DIR, size: '1024x1024', transparent: false,
    prompt: 'Seamless tileable grayscale heightmap of a cracked stone floor surface, smooth gentle bumps and ripples in dark gray to white where white is highest and black is lowest, no harsh edges, suitable as a vertex displacement map for a subdivided floor plane, 1024x1024 PNG' },
  { id: 'tex_heightmap_rubble', dir: DUNGEON_DIR, size: '1024x1024', transparent: false,
    prompt: 'Seamless tileable grayscale heightmap of rubble and debris on a floor, scattered raised bumps where each bump represents a piece of rubble, white is highest black is lowest, gentle smooth gradient, suitable as a vertex displacement map for a subdivided floor plane, 1024x1024 PNG' },

  // ── Wall variants (for richer wall rendering) ──────────────────────
  { id: 'wall_ornate_panel', dir: DUNGEON_DIR, size: '1024x1024', transparent: false,
    prompt: 'Seamless tileable dark fantasy ornate carved stone wall panel texture, deep relief carvings of demonic motifs, gothic flourishes, crack patterns, dark grayish stone with subtle red rune highlights, suitable as a wall section material, painterly digital art, 1024x1024 PNG' },
  { id: 'wall_broken_relief', dir: DUNGEON_DIR, size: '1024x1024', transparent: false,
    prompt: 'Seamless tileable dark fantasy broken relief wall texture, gothic carved relief that is partially smashed open showing rough stone beneath, dust and weathering, suitable as an alternate wall section material, painterly digital art, 1024x1024 PNG' },
  { id: 'wall_runic_glow', dir: DUNGEON_DIR, size: '1024x1024', transparent: false,
    prompt: 'Seamless tileable dark fantasy runic wall texture with glowing crimson runes carved into dark stone, intricate eldritch runes radiating subtle red glow, suitable as an accent wall section material, painterly digital art, 1024x1024 PNG' },

  // ── Theme floor variants (for future dungeon themes) ───────────────
  { id: 'floor_snow_packed', dir: DUNGEON_DIR, size: '1024x1024', transparent: false,
    prompt: 'Seamless tileable packed snow floor texture with footprints and ice cracks, white-blue gradient with patches of dirt and stone showing through, suitable as a dungeon floor material for a frostbite cavern theme, painterly digital art, 1024x1024 PNG' },
  { id: 'floor_moss_overgrown', dir: DUNGEON_DIR, size: '1024x1024', transparent: false,
    prompt: 'Seamless tileable overgrown moss floor texture, dark green moss covering cracked stone with small mushrooms and weeds growing through, suitable as a dungeon floor material for a verdant ruins theme, painterly digital art, 1024x1024 PNG' },
  { id: 'floor_sand_dune', dir: DUNGEON_DIR, size: '1024x1024', transparent: false,
    prompt: 'Seamless tileable wind-rippled sand floor texture, golden tan sand with subtle wave patterns from wind and scattered small stones, suitable as a dungeon floor material for an ashfall dunes theme, painterly digital art, 1024x1024 PNG' },
  { id: 'floor_blood_marsh', dir: DUNGEON_DIR, size: '1024x1024', transparent: false,
    prompt: 'Seamless tileable bloody marsh floor texture, dark red wet ground with patches of black soil and visible blood pools, suitable as a dungeon floor material for a bloodspire keep theme, painterly digital art, 1024x1024 PNG' },

  // ── Theme wall variants ─────────────────────────────────────────────
  { id: 'wall_ice_glacial', dir: DUNGEON_DIR, size: '1024x1024', transparent: false,
    prompt: 'Seamless tileable glacial ice wall texture, translucent pale blue ice with cracks and embedded debris, frost crystals on surface, suitable as a dungeon wall material for a frostbite cavern theme, painterly digital art, 1024x1024 PNG' },
  { id: 'wall_vine_overgrown', dir: DUNGEON_DIR, size: '1024x1024', transparent: false,
    prompt: 'Seamless tileable overgrown stone wall texture covered in dark green creeping vines and small white flowers, weathered gray stone showing through gaps in the vegetation, suitable as a dungeon wall material for a verdant ruins theme, painterly digital art, 1024x1024 PNG' },
  { id: 'wall_sandstone_carved', dir: DUNGEON_DIR, size: '1024x1024', transparent: false,
    prompt: 'Seamless tileable carved sandstone wall texture with ancient hieroglyph reliefs in tan and umber, weathered by sand, suitable as a dungeon wall material for an ashfall dunes theme, painterly digital art, 1024x1024 PNG' },
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

console.log(`=== Environment framework assets: ${ASSETS.length} pieces ===`);
await Promise.all(ASSETS.map(gen));
console.log('=== Done ===');
