# Dungeon Asset Generation Prompts

Generate these via DALL-E (gpt-image-1) for textures and Meshy.ai for 3D models.
Once generated, drop the files in the indicated paths and the engine picks them up
automatically (no code changes needed — paths already wired in
`src/rendering/AssetManifest.js` and chamber templates in
`server/dungeon/chambers.js`).

## CRITICAL: format & spec for all DALL-E textures
- **Resolution**: 2048×2048 for floors/walls, 1024×1024 for decals
- **Tileable seamless** for floor/wall textures (DALL-E prompt MUST include the
  phrase "seamless tileable repeating texture, edges match perfectly")
- **Top-down orthographic** for floor textures
- **Flat orthographic, no perspective** for wall textures
- **High contrast, dark dungeon palette** — Diablo I/II/Sanctuary feel
- **No characters, no UI**, no scale references

---

## 1. Themed Floor Textures (replace flat single-floor look)

Each chamber template wants its OWN floor with the variation BAKED IN —
so we don't need to spawn separate decal planes that look fake.

### `floor_crypt.png` — for `long_hall_crypt`
> Top-down orthographic view of a seamless tileable repeating texture of an ancient stone burial-hall floor. Large rectangular tomb-slabs arranged in a regular grid, cracked and worn, with thin gold-leaf inscriptions in faded relief. Dark grey-blue stone, dust-filled cracks, scuffed footpath worn into the stone center. Diablo 2 dungeon aesthetic, painted-realistic, dark moody palette, no characters, seamless edges match perfectly.

### `floor_chapel.png` — for `collapsed_chapel`
> Top-down orthographic view of a seamless tileable repeating texture of a ruined cathedral floor. Large polished marble flagstones with hairline cracks, faded gold inlays in cross and rune patterns, scattered ash and rust stains, dried blood pooled near the seams. Stained glass shards scattered. Dark warm beige and grey palette with ember-orange highlights, Diablo cathedral aesthetic, no characters, seamless edges match perfectly.

### `floor_ritual.png` — for `ritual_pit`
> Top-down orthographic view of a seamless tileable repeating texture of a polished obsidian ritual floor. Black volcanic glass etched with luminous red runic spirals and pentagrams baked into the surface, faint embers glowing in the rune-grooves, soot stains and old blood crusts at the edges. Dark with red ember accents, Diablo ritual chamber aesthetic, no characters, seamless edges match perfectly.

### `floor_bone_dust.png` — for `ossuary`
> Top-down orthographic view of a seamless tileable repeating texture of an ossuary floor covered in compacted bone dust and skull fragments. Yellowed bone-ivory base, scattered finger bones and rib fragments embedded in the surface, dried blood smears. Pale cold palette with deep shadow cracks, Diablo bone chamber aesthetic, no characters, seamless edges match perfectly.

### `floor_runic.png` — for `boss_throne`
> Top-down orthographic view of a seamless tileable repeating texture of a massive throne-room floor. Black basalt slabs inlaid with sharp gold and bloodred runic patterns radiating outward from a central focus, the rune grooves glowing faintly with infernal heat. Polished, regal, decay around the edges. Diablo boss-room aesthetic, no characters, seamless edges match perfectly.

### `floor_obsidian_polished.png` — for `ritual_pit` (alt)
> Top-down orthographic view of a seamless tileable repeating texture of polished black obsidian floor tiles. Glassy reflective surface with deep red veins running through, occasional spider-cracks revealing molten orange beneath. Dark with red-orange accents, Diablo demonic aesthetic, no characters, seamless edges match perfectly.

### Existing floor textures (keep, but consider regenerating):
- `floor_stone.png`, `floor_cracked.png`, `floor_ashen.png`, `floor_blood_soaked.png`

**Path**: `public/assets/art/dungeon/floor_*.png`

---

## 2. Themed Wall Textures

### `wall_crypt.png` — for `long_hall_crypt`
> Flat orthographic seamless tileable repeating texture of an ancient crypt wall. Tightly packed cut-stone blocks with carved grave-niches showing partial skulls and dried bones inside, faded runic inscriptions running horizontally, moss in the deepest cracks. Dark grey-blue stone, cold lighting suggested in the bake. Diablo crypt aesthetic, no characters, seamless edges match perfectly.

### `wall_chapel.png` — for `collapsed_chapel`
> Flat orthographic seamless tileable repeating texture of a ruined cathedral wall. Tall arched stone-block masonry, faded cherubic reliefs, broken pieces showing rebar-like iron skeletons inside, ash stains running down from soot-darkened areas above. Warm beige and grey, Diablo cathedral aesthetic, no characters, seamless edges match perfectly.

### `wall_obsidian.png` — for `ritual_pit`
> Flat orthographic seamless tileable repeating texture of an obsidian ritual chamber wall. Glassy black volcanic stone slabs with red rune-grooves running between them glowing faintly, sigils and bound demon symbols carved deep, scorch marks. Dark with red glow accents, Diablo demonic ritual aesthetic, no characters, seamless edges match perfectly.

### `wall_bone.png` — for `ossuary`
> Flat orthographic seamless tileable repeating texture of an ossuary wall constructed entirely of human skulls and femurs stacked tightly together in geometric patterns. Yellow-ivory bone tones, mortar gaps, occasional missing skulls revealing dark recesses. Pale cold palette, Diablo bone-dungeon aesthetic, no characters, seamless edges match perfectly.

### `wall_runic.png` — for `boss_throne`
> Flat orthographic seamless tileable repeating texture of a massive boss-arena wall. Black basalt slabs alternating with bronze panels engraved with infernal runes that glow red-orange, gold trim, ornate scrollwork. Imposing, decay around the edges suggesting age. Diablo boss-throne aesthetic, no characters, seamless edges match perfectly.

### Existing wall textures (keep, but consider regenerating):
- `wall_stone.png`, `wall_mossy.png`, `wall_runic_glow.png`,
  `wall_ornate_panel.png`, `wall_broken_relief.png`

**Path**: `public/assets/art/dungeon/wall_*.png`

---

## 3. Meshy GLBs for visually-distinct interactive features

These are interactive — the player MUST be able to tell them apart from
decorative idols/altars. So their look needs to be unique.

### `merchant_crucible.glb` — Starter / Boss Vendor NPC
> A 3D sculpted dark fantasy MERCHANT FIGURE for a Diablo-style dungeon game. Hooded skeletal figure in tattered robes standing behind a heavy iron-bound stone counter. Skull face with twin glowing gold pinpoint eyes, bony fingers tipped with gold rings, robe is deep blood-red with gold trim. On the counter: a glowing pile of gold coins, an open spellbook, a small skull. Behind the figure on a wall mount: shelves of vials and trinkets. Pose: hands resting on counter, slight lean forward as if waiting for a customer. Tone: ominous but stationary, recognizable as a SHOPKEEPER not a worship idol. 4096 polys, PBR materials, single GLB file, scale ~3m tall.

**Path**: `public/assets/models/props/merchant_crucible.glb`
**Code change needed**: Update `_spawnMeshyVendor` in `DungeonEnvironment.js`
to load this GLB instead of using procedural stone obelisk.

### `puzzle_obelisk.glb` — Puzzle Shrine
> A 3D sculpted dark fantasy PUZZLE OBELISK for a Diablo-style dungeon game. Tall standing obelisk of polished black volcanic glass, ~4m tall, square cross-section. Each of the four faces carries a different glowing teal-cyan runic glyph (a flame, a snowflake, a skull, a star) — these glyphs should clearly read as "magical puzzle symbols" not "religious idol." A floating teal-cyan crystal orb hovers 0.5m above the obelisk's top. Faint particle wisps drifting upward. Base: 1m square stone plinth with cracks. Tone: arcane puzzle, NOT a worship idol. 3000 polys, PBR materials, single GLB file.

**Path**: `public/assets/models/props/puzzle_obelisk.glb`
**Code change needed**: Update `_spawnMeshyShrine` in `DungeonEnvironment.js`
to load this GLB instead of using procedural stone-box obelisk.

### `treasure_chest_dungeon.glb` — Loot Chest (replacing procedural)
> A 3D sculpted dark fantasy LOOT CHEST for a Diablo-style dungeon. Heavy aged wood chest with iron bands and rivets, gold-plated lock plate with a skull motif, 4 ornate gold corner posts. Lid slightly ajar with golden inner glow leaking out, hint of gold coins and a sword hilt visible inside. Decay: chipped wood, tarnished gold, dripping wax. Square base, 1m × 0.7m × 0.7m. Tone: classic Diablo loot chest. 2000 polys, PBR materials, single GLB file.

**Path**: `public/assets/models/props/treasure_chest_dungeon.glb`
**Code change needed**: Update `_preloadChestAssets` in
`DungeonEnvironment.js` to load this instead of procedural box.

---

## 4. Additional Castle Furniture (if asset library has gaps)

These are referenced by `CHAMBER_LAYOUTS` but verify they exist. Generate
any missing ones via Meshy with the prompt: "Diablo 2 dark fantasy dungeon
[NAME], [shape description], PBR materials, single GLB, ~1500-3000 polys."

Existing (confirmed present): sarcophagus, candelabrum_tall,
pew_broken, hanging_cage_skeleton, fallen_banner, family_banner_purple,
family_banner_red, ossuary_bone_throne, skull_pyramid, throne_dais,
throne_massive, guardian_statue_standing, guardian_statue_kneeling,
brazier_ornate_boss, rune_pillar, broken_pillar, pillar_intact,
pillar_crumbling, iron_brazier_tall, iron_chains, collapsed_archway,
bone_pile, skull_stack, burial_urn, ash_pile, rubble_pile,
skeletal_remains_clutching, boss_banner_large, skull_idol, ember_pool.

---

## 5. Implementation order suggestion

1. **Floor textures first** (biggest visual impact, biggest "Diablo feel" win)
2. **Wall textures second** (combined with #1, transforms the dungeon look)
3. **Merchant + Puzzle Meshy GLBs** (kills the procedural-stone-obelisk look)
4. **Chest Meshy GLB** (replaces the procedural wooden box)

Each batch can ship independently — drop files in `public/assets/...`,
no code changes needed unless explicitly noted above.
