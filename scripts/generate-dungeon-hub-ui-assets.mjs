#!/usr/bin/env node
// Generate themed UI assets for the Dungeon Hub via DALL-E. Every button,
// panel, tier emblem, gear slot, and socket frame becomes a real piece of
// concept art instead of CSS gradients on black.
//
// Output: /assets/art/ui/dungeon/*.png

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OPENAI_KEY = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8').match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();

const OUT_DIR = path.join(ROOT, 'public', 'assets', 'art', 'ui', 'dungeon');
fs.mkdirSync(OUT_DIR, { recursive: true });

const ASSETS = {
  // ── Backdrop + frames ─────────────────────────────────────────────────
  hub_background: { size: '1536x1024',
    prompt: 'Dark fantasy dungeon hub backdrop, view through a massive carved stone archway down a long torch-lit hall toward a distant crowned skeleton on an ash throne, smoke and crimson light, atmospheric haze, painterly cinematic dark fantasy concept art, suitable as a UI background that text panels will overlay on top of, dark muted edges so UI panels read clearly' },
  panel_frame_ornate: { size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy ornate UI panel frame on transparent background, gothic carved stone border with skull-and-thorn corner motifs glowing crimson runes inset, hollow center for content, top-down orthographic view, painterly digital art, 1024x1024 transparent PNG, suitable as a 9-slice UI border' },
  scroll_parchment_frame: { size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy aged parchment scroll panel UI frame on transparent background, slightly torn weathered tan parchment with iron rivets in the corners and a single deep crimson wax seal at the top center, hollow center for text content, painterly digital art, 1024x1024 transparent PNG' },

  // ── ENTER button frame ────────────────────────────────────────────────
  button_enter_crucible: { size: '1536x1024', transparent: true,
    prompt: 'Dark fantasy ornate button background on transparent background, oblong horizontal button frame with carved stone gothic ornament edges and glowing red runic script faintly visible across the surface, central panel hollow for text overlay, painterly digital art, transparent PNG' },
  button_secondary_frame: { size: '1536x1024', transparent: true,
    prompt: 'Dark fantasy secondary UI button frame on transparent background, slim horizontal carved iron rectangle with subtle skull motifs at each end, hollow center for text, painterly digital art, transparent PNG' },

  // ── Tier emblems T1–T10 (each a unique icon) ─────────────────────────
  tier_1_emblem: { size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy tier 1 ranking emblem on transparent background, simple iron broken sword icon inside a worn bronze ring, weathered and humble, painterly digital art top-down icon view, 1024x1024 transparent PNG' },
  tier_2_emblem: { size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy tier 2 ranking emblem on transparent background, iron axe head icon inside a tarnished copper ring, painterly digital art top-down icon view, 1024x1024 transparent PNG' },
  tier_3_emblem: { size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy tier 3 ranking emblem on transparent background, twin daggers crossed icon inside a tarnished silver ring, painterly digital art top-down icon view, 1024x1024 transparent PNG' },
  tier_4_emblem: { size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy tier 4 ranking emblem on transparent background, iron warhammer icon with thin red rune trim inside a copper-iron ring, painterly digital art top-down icon view, 1024x1024 transparent PNG' },
  tier_5_emblem: { size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy tier 5 ranking emblem on transparent background, mythic horned skull icon inside a blood-red iron ring with subtle ember glow, painterly digital art top-down icon view, 1024x1024 transparent PNG' },
  tier_6_emblem: { size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy tier 6 ranking emblem on transparent background, demon-horned skull icon inside a glowing crimson ring with ember sparks, painterly digital art top-down icon view, 1024x1024 transparent PNG' },
  tier_7_emblem: { size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy tier 7 ranking emblem on transparent background, flaming demonic skull icon inside a ring of dark fire, painterly digital art top-down icon view, 1024x1024 transparent PNG' },
  tier_8_emblem: { size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy tier 8 ranking emblem on transparent background, sword-impaled crowned skull icon inside a runic obsidian ring with red glyphs, painterly digital art top-down icon view, 1024x1024 transparent PNG' },
  tier_9_emblem: { size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy tier 9 ranking emblem on transparent background, shadow-wreathed crowned demon skull icon inside a ring of glowing red lava cracks, painterly digital art top-down icon view, 1024x1024 transparent PNG' },
  tier_10_emblem: { size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy tier 10 apex ranking emblem on transparent background, towering crowned ash king skull with crossed greatswords behind it inside a ring of pure crimson firelight, the most prestigious rank, painterly digital art top-down icon view, 1024x1024 transparent PNG' },

  // ── Gear slot empty frames (6 slots) ─────────────────────────────────
  slot_head: { size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy empty gear slot icon for HEAD on transparent background, ornate carved stone niche-frame with a faintly etched horned helm silhouette in the center as a placeholder, painterly digital art top-down icon view, 512x512 transparent PNG' },
  slot_chest: { size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy empty gear slot icon for CHEST on transparent background, ornate carved stone niche-frame with a faintly etched plate cuirass silhouette in the center as a placeholder, painterly digital art top-down icon view, 512x512 transparent PNG' },
  slot_legs: { size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy empty gear slot icon for LEGS on transparent background, ornate carved stone niche-frame with a faintly etched greaves silhouette in the center as a placeholder, painterly digital art top-down icon view, 512x512 transparent PNG' },
  slot_weapon: { size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy empty gear slot icon for WEAPON on transparent background, ornate carved stone niche-frame with a faintly etched longsword silhouette point-down in the center as a placeholder, painterly digital art top-down icon view, 512x512 transparent PNG' },
  slot_offhand: { size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy empty gear slot icon for OFF-HAND on transparent background, ornate carved stone niche-frame with a faintly etched runic sigil silhouette in the center as a placeholder, painterly digital art top-down icon view, 512x512 transparent PNG' },
  slot_trinket: { size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy empty gear slot icon for TRINKET on transparent background, ornate carved stone niche-frame with a faintly etched skull medallion silhouette in the center as a placeholder, painterly digital art top-down icon view, 512x512 transparent PNG' },

  // ── Socket gem frames (empty + filled placeholders) ──────────────────
  socket_empty: { size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy empty gem socket on transparent background, hexagonal carved obsidian socket bezel with no gem inside, dark and recessed, top-down icon view painterly digital art, 512x512 transparent PNG' },
  socket_filled_common: { size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy gem socket holding a common grey gemstone on transparent background, hexagonal obsidian socket with a faceted dull silver-grey gem set in the center, painterly digital art top-down icon view, 512x512 transparent PNG' },
  socket_filled_rare: { size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy gem socket holding a rare blue gemstone on transparent background, hexagonal obsidian socket with a brightly faceted glowing sapphire-blue gem set in the center, painterly digital art top-down icon view, 512x512 transparent PNG' },
  socket_filled_mythic: { size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy gem socket holding a mythic orange-gold gemstone on transparent background, hexagonal obsidian socket with a brightly glowing faceted amber-gold gem set in the center radiating sparkles, painterly digital art top-down icon view, 512x512 transparent PNG' },

  // ── Leaderboard art ──────────────────────────────────────────────────
  leaderboard_header: { size: '1536x1024', transparent: true,
    prompt: 'Dark fantasy leaderboard banner header on transparent background, horizontal gothic banner with skull-and-greatswords heraldry stitched into a deep crimson velvet drape, hangs from an ornate iron rod, painterly digital art front view, 1024x256 transparent PNG' },
  rank_badge_gold: { size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy rank 1 badge on transparent background, ornate gold laurel-wreath medallion with a number 1 stylized as crossed swords at center, painterly digital art top-down icon view, 256x256 transparent PNG' },
  rank_badge_silver: { size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy rank 2 badge on transparent background, ornate silver laurel-wreath medallion with a number 2 stylized as a sigil at center, painterly digital art top-down icon view, 256x256 transparent PNG' },
  rank_badge_bronze: { size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy rank 3 badge on transparent background, ornate bronze laurel-wreath medallion with a number 3 stylized as a sigil at center, painterly digital art top-down icon view, 256x256 transparent PNG' },

  // ── Class crests for header ─────────────────────────────────────────
  crest_tyrant:    { size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy heraldic class crest for TYRANT warrior on transparent background, crimson shield with crossed greatswords and a horned helm at the center, painterly digital art front view, 512x512 transparent PNG' },
  crest_wraith:    { size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy heraldic class crest for WRAITH assassin on transparent background, dark purple shield with crossed daggers under a hooded mask icon, painterly digital art front view, 512x512 transparent PNG' },
  crest_infernal:  { size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy heraldic class crest for INFERNAL mage on transparent background, orange shield with a flame-skull icon and crossed wand staves, painterly digital art front view, 512x512 transparent PNG' },
  crest_harbinger: { size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy heraldic class crest for HARBINGER warlock on transparent background, dark green shield with a horned demon skull and twin chained sigils, painterly digital art front view, 512x512 transparent PNG' },
  crest_revenant:  { size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy heraldic class crest for REVENANT paladin on transparent background, golden shield with a sun-and-cross icon and a tall mace at center, painterly digital art front view, 512x512 transparent PNG' },

  // ── Loot drop pop-up frame ──────────────────────────────────────────
  loot_drop_glow: { size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy loot drop visual on transparent background, radiant golden vertical light beam with rotating motes of light spiraling around it, used as background glow behind a dropped item icon, painterly digital art front view, 1024x1024 transparent PNG' },

  // ── Tier card frame (themed wrapper for tier picker buttons) ────────
  tier_card_frame: { size: '1024x1024', transparent: true,
    prompt: 'Dark fantasy tier card UI frame on transparent background, square carved stone tablet with iron corner studs and a faint runic glow at the edges, hollow center for content overlay, painterly digital art top-down view, 512x512 transparent PNG' },
};

async function gen(id, opts) {
  const out = path.join(OUT_DIR, `${id}.png`);
  if (fs.existsSync(out)) { console.log(`[${id}] skip`); return; }
  console.log(`[${id}] generating...`);
  const body = {
    model: 'gpt-image-1',
    prompt: opts.prompt,
    n: 1,
    size: opts.size || '1024x1024',
    quality: 'medium',
    output_format: 'png',
  };
  if (opts.transparent) body.background = 'transparent';
  try {
    const r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) { console.error(`[${id}]`, JSON.stringify(d).slice(0, 200)); return; }
    fs.writeFileSync(out, Buffer.from(d.data[0].b64_json, 'base64'));
    console.log(`[${id}] saved`);
  } catch (e) {
    console.error(`[${id}] error`, e.message);
  }
}

console.log(`=== Dungeon Hub UI assets — ${Object.keys(ASSETS).length} images ===`);
// Fire all in parallel — DALL-E handles concurrent requests fine
await Promise.all(Object.entries(ASSETS).map(([id, opts]) => gen(id, opts)));
console.log('=== Done ===');
