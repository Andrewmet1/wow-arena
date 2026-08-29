#!/usr/bin/env node
// Massive dungeon asset batch — 60 props + 20 texture variants + 18 VFX
// textures. Designed to run overnight unattended. Idempotent — skips files
// that already exist.
//
// Categories:
//   ARCHITECTURE (12)  — gate variants, pillars, stairs, doors, keystones
//   BOSS_ROOM    (10)  — throne pieces, dais, banners, kneeling guardians
//   HAZARDS      (6)   — spike trap, fire vent, pressure plate, blade, rubble
//   CLUTTER      (14)  — broken weapons, dummies, barrels, books, web, blood
//   ACCENTS      (10)  — ossuary, chapel, ritual, crypt theme decorations
//   LIGHTING     (6)   — wall torch, hanging lantern, candle pile, crystal
//   LOOT         (5)   — coins, gems, vials, ornate chests, scrolls
//   TEXTURES     (20)  — wall/floor/ceiling variants per theme
//   VFX          (18)  — spell sprite sheets, impact decals, beam textures

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8');
const OPENAI_KEY = env.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const MESHY_KEY  = env.match(/MESHY_API_KEY=(.+)/)?.[1]?.trim();
const MESHY_API  = 'https://api.meshy.ai';

const TEX_DIR     = path.join(ROOT, 'public', 'assets', 'art', 'dungeon');
const VFX_DIR     = path.join(ROOT, 'public', 'assets', 'art', 'vfx');
const PROP_DIR    = path.join(ROOT, 'public', 'assets', 'models', 'props');
const CONCEPT_DIR = path.join(ROOT, 'public', 'assets', 'art', 'concepts');
fs.mkdirSync(TEX_DIR, { recursive: true });
fs.mkdirSync(VFX_DIR, { recursive: true });
fs.mkdirSync(PROP_DIR, { recursive: true });
fs.mkdirSync(CONCEPT_DIR, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── PROPS ──────────────────────────────────────────────────────────────
const PROPS = {
  // Architecture (12)
  iron_gate_closed: 'Single 3D dark fantasy iron gate, heavy black iron portcullis with skull spikes at top, weathered with rust patina, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  iron_gate_open: 'Single 3D dark fantasy iron gate fully raised, heavy black iron portcullis suspended at the top of an arch, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  runic_door_sealed: 'Single 3D dark fantasy runic door, heavy stone slab door covered in glowing red rune script, slight crimson glow at the seams, isolated single object, front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  pillar_intact: 'Single 3D dark fantasy intact gothic stone pillar, fluted classical column with carved capital and base, dark grey weathered stone, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  pillar_crumbling: 'Single 3D dark fantasy crumbling gothic stone pillar mid-collapse, large vertical cracks splitting the column, broken capital tilted to one side, dark weathered stone, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  stairs_descending: 'Single 3D dark fantasy descending stone staircase section, six worn steps going down into darkness, dark grey weathered stone with cracked edges, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  stairs_ascending: 'Single 3D dark fantasy ascending stone staircase section, six worn steps going up, dark grey weathered stone with iron handrails, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  stone_bridge: 'Single 3D dark fantasy stone bridge section, narrow arched stone walkway with carved railings on both sides, dark grey weathered stone, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  buttress: 'Single 3D dark fantasy gothic stone flying buttress section, ornate carved support arch, dark weathered stone with traces of moss, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  arch_keystone: 'Single 3D dark fantasy carved arch keystone, large carved stone block with a glowing red runic sigil at center, isolated single object, front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  iron_door_barred: 'Single 3D dark fantasy iron-barred wooden door, heavy oak with riveted iron strapping and a barred viewing slit at face height, isolated single object, front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  doorway_archway_runic: 'Single 3D dark fantasy runic doorway archway, tall gothic arch with glowing red runes carved into the keystone and posts, dark weathered stone, isolated single object, front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',

  // Boss room specific (10)
  throne_massive: 'Single 3D dark fantasy massive carved throne, towering stone seat with dragon-skull armrests and tall back covered in skull motifs, dark grey weathered stone with traces of red, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  throne_dais: 'Single 3D dark fantasy stepped stone dais, three-tiered platform with carved skull motifs along the front edges, dark grey weathered stone, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  boss_banner_large: 'Single 3D dark fantasy large hanging boss banner, towering crimson velvet banner with a skeletal warrior heraldry stitched in gold thread, frayed edges, hangs from an iron pole at the top, isolated single object, front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  sacrificial_pedestal: 'Single 3D dark fantasy sacrificial stone pedestal, ornately carved waist-high block with blood channels carved into the top surface, dark grey stone with dried bloodstains, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  skull_pyramid: 'Single 3D dark fantasy massive skull pyramid, large pile of stacked humanoid skulls in a pyramid shape about 3 meters tall, weathered yellow-grey bone, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  guardian_statue_kneeling: 'Single 3D dark fantasy kneeling armored guardian statue with massive sword planted point-down, head bowed in eternal vigil, dark grey weathered stone, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  guardian_statue_standing: 'Single 3D dark fantasy standing armored guardian statue holding a tall spear vertically, full plate armor with cape, head looking forward, dark grey weathered stone, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  guardian_statue_warding: 'Single 3D dark fantasy warding armored guardian statue with arms raised holding a glowing rune above the head, full plate armor, dark grey weathered stone with red rune glow, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  brazier_ornate_boss: 'Single 3D dark fantasy ornate boss brazier, oversized iron tripod with skull-decorated bowl filled with bright orange flames, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  ritual_chains_dangling: 'Single 3D dark fantasy massive iron ritual chains hanging from a high point, three thick chains tangled together with manacles at the bottom, weathered black iron, isolated single object, front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',

  // Hazards (6)
  spike_trap: 'Single 3D dark fantasy spike trap, square stone floor section with a cluster of rusted iron spikes protruding upward, dried bloodstains around the base, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  fire_vent: 'Single 3D dark fantasy fire vent, round stone grate set into the floor with bright orange flames erupting straight up, dark grey weathered stone, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  pressure_plate: 'Single 3D dark fantasy pressure plate, square stone floor tile slightly recessed with worn iron edges and faint runic carvings, dark grey weathered stone, isolated single object, top-down view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  swinging_blade: 'Single 3D dark fantasy swinging guillotine blade trap, large rusted iron pendulum blade hanging from a thick chain, ornate stone mounting at top, isolated single object, front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  rubble_pile: 'Single 3D dark fantasy rubble pile, broken stone blocks and dust mound from a partial collapse, dark grey weathered stone with pieces of rebar sticking out, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  destructible_pillar: 'Single 3D dark fantasy destructible stone pillar, cracked thin stone column ready to crumble when hit, dark grey weathered stone with visible structural fractures, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',

  // Atmospheric clutter (14)
  rubble_small: 'Single 3D dark fantasy small rubble pile, scattered broken stone fragments on the floor, dark grey weathered stone, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  weapon_sword_in_stone: 'Single 3D dark fantasy ornate longsword stuck point-down in a stone block, weathered steel blade with worn leather grip, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  weapon_axe_in_dummy: 'Single 3D dark fantasy battle axe lodged in a wooden training dummy, the dummy is wrapped in burlap and decayed, isolated single object, front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  training_dummy_decayed: 'Single 3D dark fantasy decayed training dummy, wooden post wrapped in tattered burlap and rope with deep weapon marks, isolated single object, front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  wooden_barrel_cracked: 'Single 3D dark fantasy cracked wooden barrel, dark stained oak staves with iron banding, large vertical crack splitting it open, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  supply_crate: 'Single 3D dark fantasy supply crate, sturdy oak crate with iron corner brackets and a broken padlock dangling from the latch, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  scattered_books: 'Single 3D dark fantasy scattered books pile, several leather-bound tomes spilled across the floor with loose pages, weathered with dust, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  skeletal_remains_seated: 'Single 3D dark fantasy skeletal remains slumped against a wall, weathered yellow bones still wearing tattered armor scraps, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  skeletal_remains_clutching: 'Single 3D dark fantasy skeletal remains lying on the floor clutching a broken sword to the chest, weathered yellow bones with rust-stained armor pieces, isolated single object, top-down three-quarter view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  web_cocoon: 'Single 3D dark fantasy giant spider web cocoon, oval-shaped silken cocoon wrapped tightly around a humanoid figure suspended from a thread, isolated single object, front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  blood_pool: 'Single 3D dark fantasy small blood pool, dark crimson liquid pooled on stone floor with thin streams trailing outward, isolated single object, top-down view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  hanging_corpse: 'Single 3D dark fantasy hanging corpse on a chain, withered humanoid figure wrapped in rotting cloth dangling from an iron hook, isolated single object, front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  rusted_armor_pile: 'Single 3D dark fantasy rusted armor pile, heap of broken plate armor pieces and a dented helmet with brown rust patina, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  shield_broken: 'Single 3D dark fantasy broken kite shield leaning against a wall, dark wood shield cracked vertically with iron boss dangling, dried blood smear, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',

  // Theme accents (10)
  ossuary_skull_arch: 'Single 3D dark fantasy ossuary skull archway, doorway arch made entirely of stacked human skulls cemented together with dark grout, isolated single object, front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  ossuary_bone_throne: 'Single 3D dark fantasy bone throne, seat constructed from femurs and ribs lashed together with sinew and skulls inset into the back, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  skull_chandelier: 'Single 3D dark fantasy skull chandelier, hanging iron frame with humanoid skulls suspended at varying heights and lit candles in their eye sockets, isolated single object, front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  stained_glass_window: 'Single 3D dark fantasy stained glass cathedral window, tall pointed gothic window with a fragmented saint figure depicted in dark stained glass, lead came framework, isolated single object, front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  prayer_pew: 'Single 3D dark fantasy church prayer pew bench, dark stained oak bench with carved gothic ends and a kneeling rail in front, slightly weathered, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  ritual_demon_statue: 'Single 3D dark fantasy demon idol statue, six-foot-tall horned demon figure with bat wings folded on its back, dark obsidian stone with glowing red rune cracks, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  blood_altar: 'Single 3D dark fantasy blood altar, low stone slab with deep blood channels carved across the surface dripping into a basin below, dried bloodstains everywhere, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  family_banner_red: 'Single 3D dark fantasy noble family banner, deep crimson velvet hanging banner with a black eagle and skull heraldry, hangs from an ornate iron pole, isolated single object, front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  family_banner_purple: 'Single 3D dark fantasy noble family banner, deep purple velvet hanging banner with a silver crescent moon and dagger heraldry, hangs from an ornate iron pole, isolated single object, front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  crypt_door_sealed: 'Single 3D dark fantasy sealed crypt door, heavy stone door with carved ancestral skull face and an iron family crest at the center, dark weathered stone, isolated single object, front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',

  // Lighting fixtures (6)
  wall_torch_iron: 'Single 3D dark fantasy iron wall torch sconce, ornate iron bracket with a burning torch held in it, dark stained iron with bright orange flame, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  hanging_lantern: 'Single 3D dark fantasy hanging iron lantern, ornate cage-style lantern with glass panels and a single lit candle inside, hangs from a chain, isolated single object, front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  brazier_floor_small: 'Single 3D dark fantasy small floor brazier, low-profile iron brazier with glowing coals inside, three short legs, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  candle_pile: 'Single 3D dark fantasy candle pile, mound of dripping melted candles of varying heights all lit with soft yellow flames, wax pooling at the base, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  glowing_crystal: 'Single 3D dark fantasy glowing crystal cluster, jagged purple-blue crystals jutting from a stone base, brightly glowing with internal magical light, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  rune_stone_floor: 'Single 3D dark fantasy floor rune stone, flat circular stone disc carved with a glowing red ritual rune, dark grey weathered stone, isolated single object, top-down view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',

  // Loot variants (5)
  coin_pile: 'Single 3D dark fantasy gold coin pile, small mound of gleaming gold coins spilled across the floor with a few jeweled rings mixed in, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  gem_cluster: 'Single 3D dark fantasy gem cluster, group of large faceted gemstones in red and purple and blue arranged on a velvet cushion, faintly glowing, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  potion_vials: 'Single 3D dark fantasy potion vials, three glass vials with cork stoppers containing glowing red and green and blue liquid arranged on a small wooden tray, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  ornate_chest: 'Single 3D dark fantasy ornate iron-bound treasure chest, dark stained oak with intricate gold filigree and a heavy gothic skull lock, slightly oversized, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
  scroll_bundle: 'Single 3D dark fantasy bundled scrolls, three rolled parchment scrolls tied together with a black ribbon and red wax seals, isolated single object, three-quarter front view, dark moody studio lighting on transparent background, 3D model concept art for image-to-3D generation',
};

// ── TEXTURES (20) ──────────────────────────────────────────────────────
const TEXTURES = {
  wall_torchlit: 'Seamless tileable dark fantasy stone wall texture lit by warm torchlight, dark grey stone blocks with deep mortar lines, the bottom edge slightly brighter as if firelight rakes across, painterly digital art, flat orthographic front view, 1024x1024 seamless tile',
  wall_blackened: 'Seamless tileable dark fantasy charred-black stone wall texture, soot-blackened stone blocks with red embers glowing in the cracks, painterly digital art, flat orthographic front view, 1024x1024 seamless tile',
  wall_iron_clad: 'Seamless tileable dark fantasy iron-clad wall texture, riveted black iron plates with rust streaks at the bolts, painterly digital art, flat orthographic front view, 1024x1024 seamless tile',
  wall_stained_glass: 'Seamless tileable dark fantasy cathedral wall texture with embedded stained glass panels in deep blues and reds, dark stone framework, painterly digital art, flat orthographic front view, 1024x1024 seamless tile',
  wall_overgrown: 'Seamless tileable dark fantasy overgrown stone wall texture, ancient stone blocks with dead vines and dried roots growing through cracks, painterly digital art, flat orthographic front view, 1024x1024 seamless tile',
  floor_marble_inlay: 'Seamless tileable dark fantasy marble floor texture, alternating dark and ivory marble tiles with brass inlay borders forming geometric patterns, painterly digital art, top-down orthographic view, 1024x1024 seamless tile',
  floor_iron_grate: 'Seamless tileable dark fantasy iron grate floor texture, heavy black iron grate panels with red ember light glowing through from below, painterly digital art, top-down orthographic view, 1024x1024 seamless tile',
  floor_blood_soaked: 'Seamless tileable dark fantasy blood-soaked floor texture, dark stone tiles with deep crimson blood pooled in the grout lines and dried splatters, painterly digital art, top-down orthographic view, 1024x1024 seamless tile',
  floor_runic_glowing: 'Seamless tileable dark fantasy floor texture covered in glowing red runic circles, dark obsidian tiles with bright crimson sigils, painterly digital art, top-down orthographic view, 1024x1024 seamless tile',
  floor_obsidian_polished: 'Seamless tileable dark fantasy polished obsidian floor texture, jet black volcanic glass tiles with subtle red veins, painterly digital art, top-down orthographic view, 1024x1024 seamless tile',
  ceiling_dark_vault: 'Seamless tileable dark fantasy gothic vaulted ceiling texture from below, ribbed dark stone with iron struts and chain attachment points, painterly digital art, view from below, 1024x1024 seamless tile',
  ceiling_open_sky: 'Seamless tileable dark fantasy open broken ceiling texture, dark stormy sky visible through a partially collapsed roof showing exposed iron rafters and shafts of moonlight, painterly digital art, view from below, 1024x1024 seamless tile',
  decal_summoning_circle: 'Dark fantasy circular summoning sigil decal on transparent background, large ornate ringed sigil with pentagram-like geometric pattern at center surrounded by demonic script, glowing crimson, painterly digital art, top-down view, 1024x1024 transparent PNG',
  decal_holy_seal: 'Dark fantasy circular holy seal decal on transparent background, ornate ringed sigil with cross at center surrounded by latin script, glowing soft gold, painterly digital art, top-down view, 1024x1024 transparent PNG',
  decal_blood_handprint: 'Dark fantasy bloody handprint decal on transparent background, dripping crimson handprint smeared across stone, painterly digital art, top-down view, 512x512 transparent PNG',
  decal_claw_marks: 'Dark fantasy claw mark decal on transparent background, four parallel deep gouges raked across stone with dark red staining, painterly digital art, top-down view, 512x512 transparent PNG',
  decal_burn_scorch: 'Dark fantasy burn scorch decal on transparent background, charred black scorch mark radiating outward from a center point, painterly digital art, top-down view, 512x512 transparent PNG',
  decal_frost_patch: 'Dark fantasy frost patch decal on transparent background, jagged ice crystal pattern spreading outward in pale blue-white, painterly digital art, top-down view, 512x512 transparent PNG',
  fog_volumetric: 'Tileable dark fantasy ground fog texture, soft greyish-white mist drifting horizontally with darker recesses, transparent edges, painterly digital art, side view, 1024x512 transparent PNG',
  void_skybox: 'Dark fantasy 360 degree skybox texture for a void surrounding a dungeon, deep stormy black-purple clouds with occasional crimson lightning flashes and distant jagged mountain silhouettes barely visible, painterly digital art, equirectangular projection, 2048x1024 PNG',
};

// ── VFX SPRITE TEXTURES (18) ───────────────────────────────────────────
const VFX = {
  vfx_fire_blast: 'Dark fantasy fire blast spell impact VFX sprite, billowing orange and red fireball with bright yellow core and dark smoke trails, painterly digital art, on transparent background, 512x512 transparent PNG',
  vfx_frost_burst: 'Dark fantasy frost burst spell impact VFX sprite, jagged blue-white ice shards exploding outward with crystalline sparkles, painterly digital art, on transparent background, 512x512 transparent PNG',
  vfx_shadow_bolt: 'Dark fantasy shadow bolt projectile VFX sprite, dark purple-black orb with wisps of shadow trailing behind it, painterly digital art, on transparent background, 512x512 transparent PNG',
  vfx_holy_strike: 'Dark fantasy holy strike VFX sprite, brilliant golden cross-shaped flash of light with radiating beams, painterly digital art, on transparent background, 512x512 transparent PNG',
  vfx_blood_splatter: 'Dark fantasy blood splatter VFX sprite, deep crimson droplets and streams radiating outward from a center point, painterly digital art, on transparent background, 512x512 transparent PNG',
  vfx_lightning_strike: 'Dark fantasy lightning strike VFX sprite, jagged white-purple electrical arc with branching forks, painterly digital art, on transparent background, 512x512 transparent PNG',
  vfx_ground_circle_red: 'Dark fantasy red ground targeting circle VFX, glowing crimson runic ring on transparent background, painterly digital art, top-down view, 512x512 transparent PNG',
  vfx_ground_circle_gold: 'Dark fantasy gold ground targeting circle VFX, glowing soft gold runic ring on transparent background, painterly digital art, top-down view, 512x512 transparent PNG',
  vfx_ground_circle_purple: 'Dark fantasy purple ground targeting circle VFX, glowing dark purple runic ring on transparent background, painterly digital art, top-down view, 512x512 transparent PNG',
  vfx_beam_fire: 'Dark fantasy continuous fire beam VFX texture, horizontal orange-red flame stream with bright yellow core, painterly digital art, on transparent background, 1024x256 transparent PNG',
  vfx_beam_frost: 'Dark fantasy continuous frost beam VFX texture, horizontal pale blue-white ice stream with crystalline sparkles, painterly digital art, on transparent background, 1024x256 transparent PNG',
  vfx_beam_shadow: 'Dark fantasy continuous shadow beam VFX texture, horizontal dark purple-black tendril stream with wisps, painterly digital art, on transparent background, 1024x256 transparent PNG',
  vfx_beam_holy: 'Dark fantasy continuous holy beam VFX texture, horizontal bright gold light stream with radiating beams, painterly digital art, on transparent background, 1024x256 transparent PNG',
  vfx_aura_buff_red: 'Dark fantasy red rage aura VFX sprite, swirling crimson energy wrapping a humanoid silhouette with embers floating upward, painterly digital art, on transparent background, 512x1024 transparent PNG',
  vfx_aura_buff_gold: 'Dark fantasy gold blessing aura VFX sprite, swirling warm gold energy wrapping a humanoid silhouette with light feathers floating upward, painterly digital art, on transparent background, 512x1024 transparent PNG',
  vfx_aura_buff_blue: 'Dark fantasy blue arcane aura VFX sprite, swirling pale blue magical energy wrapping a humanoid silhouette with sparkles floating upward, painterly digital art, on transparent background, 512x1024 transparent PNG',
  vfx_impact_physical: 'Dark fantasy physical melee impact VFX sprite, white-yellow flash of force radiating outward with grey debris streaks, painterly digital art, on transparent background, 512x512 transparent PNG',
  vfx_heal_shimmer: 'Dark fantasy heal shimmer VFX sprite, soft green-gold sparkles drifting upward with a faint cross outline, painterly digital art, on transparent background, 512x512 transparent PNG',
};

async function genTexture(id, prompt, dir, isVfx = false) {
  const out = path.join(dir, `${id}.png`);
  if (fs.existsSync(out)) { console.log(`[tex ${id}] skip`); return; }
  console.log(`[tex ${id}] generating...`);
  const useTransparent = id.startsWith('decal_') || id.startsWith('vfx_') || id.startsWith('fog_') || isVfx;
  let size = '1024x1024';
  if (id.startsWith('vfx_beam_')) size = '1536x1024';
  if (id === 'void_skybox') size = '1536x1024';
  if (id === 'fog_volumetric') size = '1536x1024';
  const body = { model: 'gpt-image-1', prompt, n: 1, size, quality: 'medium', output_format: 'png' };
  if (useTransparent) body.background = 'transparent';
  try {
    const r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) { console.error(`[tex ${id}]`, JSON.stringify(d).slice(0, 200)); return; }
    fs.writeFileSync(out, Buffer.from(d.data[0].b64_json, 'base64'));
    console.log(`[tex ${id}] saved`);
  } catch (e) {
    console.error(`[tex ${id}] error:`, e.message);
  }
}

async function genConcept(id, prompt) {
  const out = path.join(CONCEPT_DIR, `prop_${id}.png`);
  if (fs.existsSync(out)) return fs.readFileSync(out);
  console.log(`[prop ${id}] concept...`);
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: 'gpt-image-1', prompt, n: 1, size: '1024x1024', quality: 'medium', background: 'transparent', output_format: 'png' }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(d).slice(0, 200));
  const buf = Buffer.from(d.data[0].b64_json, 'base64');
  fs.writeFileSync(out, buf);
  return buf;
}

async function meshyImg23d(buf, id) {
  const create = await fetch(`${MESHY_API}/openapi/v1/image-to-3d`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${MESHY_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: `data:image/png;base64,${buf.toString('base64')}`,
      ai_model: 'meshy-5', topology: 'triangle', target_polycount: 15000,
      should_remesh: true, should_texture: true, enable_pbr: true,
    }),
  });
  const cd = await create.json();
  if (!create.ok) throw new Error(`create: ${JSON.stringify(cd).slice(0, 200)}`);
  const taskId = cd.result;
  console.log(`[prop ${id}] meshy ${taskId}`);
  for (let i = 0; i < 360; i++) {
    await sleep(5000);
    const r = await fetch(`${MESHY_API}/openapi/v1/image-to-3d/${taskId}`, { headers: { 'Authorization': `Bearer ${MESHY_KEY}` } });
    const d = await r.json().catch(() => ({}));
    if (d.status === 'SUCCEEDED') return d;
    if (d.status === 'FAILED') throw new Error(`meshy failed: ${d.task_error?.message}`);
    if (i % 6 === 0) console.log(`  [${id}] ${d.status} ${d.progress || 0}%`);
  }
  throw new Error('timeout');
}

async function genProp(id, prompt) {
  const out = path.join(PROP_DIR, `${id}.glb`);
  if (fs.existsSync(out)) { console.log(`[prop ${id}] skip`); return; }
  try {
    const buf = await genConcept(id, prompt);
    const result = await meshyImg23d(buf, id);
    const url = result.model_urls?.glb;
    if (!url) throw new Error('no glb url');
    const glbBuf = Buffer.from(await (await fetch(url)).arrayBuffer());
    fs.writeFileSync(out, glbBuf);
    console.log(`[prop ${id}] saved ${(glbBuf.length / 1024).toFixed(0)} KB`);
  } catch (err) {
    console.error(`[prop ${id}] failed:`, err.message);
  }
}

console.log('=== MASSIVE dungeon asset batch ===');
console.log(`Props: ${Object.keys(PROPS).length}, Textures: ${Object.keys(TEXTURES).length}, VFX: ${Object.keys(VFX).length}`);
console.log('--- Textures (parallel) ---');
await Promise.all([
  ...Object.entries(TEXTURES).map(([id, p]) => genTexture(id, p, TEX_DIR)),
  ...Object.entries(VFX).map(([id, p]) => genTexture(id, p, VFX_DIR, true)),
]);
console.log('--- Props (sequential, ~5 min each) ---');
for (const [id, p] of Object.entries(PROPS)) {
  await genProp(id, p);
}
console.log('=== Done ===');
