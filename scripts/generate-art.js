#!/usr/bin/env node
/**
 * Generate splash art assets for Ebon Crucible using DALL-E 3.
 * Reads OPENAI_API_KEY from .env file. Outputs to public/assets/art/.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'assets', 'art');

// Load .env
const envPath = path.join(ROOT, '.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const API_KEY = envContent.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
if (!API_KEY) {
  console.error('Missing OPENAI_API_KEY in .env');
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const PROMPTS = [
  {
    name: 'home_bg',
    size: '1792x1024',
    prompt: 'Dark fantasy arena colosseum at night, massive stone pillars with glowing runes, volcanic sky with red lightning, ethereal fog rolling across a bloodstained stone floor, dramatic cinematic lighting, concept art style, League of Legends splash art quality, ultra detailed, 4k, no text no letters no words'
  },
  {
    name: 'tyrant_splash',
    size: '1024x1792',
    prompt: 'Dark fantasy warrior champion portrait, massive male knight in heavy blood-red and steel plate armor, horned great helm with glowing visor slit, wielding an enormous two-handed greatsword wreathed in dark energy, cape billowing, standing in a burning battlefield, dramatic low-angle shot, League of Legends splash art style, cinematic lighting, ultra detailed, 4k, no text no letters no words'
  },
  {
    name: 'wraith_splash',
    size: '1024x1792',
    prompt: 'Dark fantasy rogue assassin portrait, lean hooded figure in deep purple-indigo leather armor, face hidden behind a spectral mask with glowing violet eyes, dual curved daggers dripping with poison, crouching on a rooftop above a moonlit gothic city, shadow tendrils swirling, League of Legends splash art style, cinematic lighting, ultra detailed, 4k, no text no letters no words'
  },
  {
    name: 'infernal_splash',
    size: '1024x1792',
    prompt: 'Dark fantasy fire mage portrait, robed figure with a crown of living flames, wielding an ornate staff topped with a blazing crystal, molten orange eyes glowing beneath a hood, rivers of fire flowing around them, volcanic eruption in background, League of Legends splash art style, cinematic lighting, ultra detailed, 4k, no text no letters no words'
  },
  {
    name: 'harbinger_splash',
    size: '1024x1792',
    prompt: 'Dark fantasy warlock portrait, gaunt figure in tattered dark green and black robes, curved demonic horns protruding from skull, holding a floating grimoire radiating purple runes, a shadowy demon lurking behind them, graveyard with green soul-fire, League of Legends splash art style, cinematic lighting, ultra detailed, 4k, no text no letters no words'
  },
  {
    name: 'revenant_splash',
    size: '1024x1792',
    prompt: 'Dark fantasy holy paladin portrait, noble armored knight in gleaming ivory and gold plate armor, radiant golden halo floating above head, wielding a flanged mace in one hand and an ornate kite shield with holy cross emblem in the other, divine light beams piercing storm clouds, cathedral ruins behind, League of Legends splash art style, cinematic lighting, ultra detailed, 4k, no text no letters no words'
  },
  {
    name: 'victory_bg',
    size: '1792x1024',
    prompt: 'Dark fantasy victory scene, a lone champion standing triumphant atop a defeated enemy in a grand colosseum arena, golden light breaking through dark storm clouds, crowd cheering in silhouette, embers and magical particles floating upward, dramatic God-rays, cinematic wide shot, League of Legends splash art quality, ultra detailed, 4k, no text no letters no words'
  },
  {
    name: 'defeat_bg',
    size: '1792x1024',
    prompt: 'Dark fantasy defeat scene, a fallen warrior kneeling in a destroyed arena, weapon broken on the ground, dark storm clouds overhead with red lightning, embers and ash falling like snow, somber blue-grey lighting with red accents, cinematic wide shot, League of Legends concept art quality, ultra detailed, 4k, no text no letters no words'
  },
  {
    name: 'game_logo',
    size: '1024x1024',
    prompt: 'Dark fantasy game logo crest emblem, ornate metallic shield shape with crossed swords behind it, a crucible or chalice motif in the center emanating dark red magical energy, surrounded by thorned iron vines and runic symbols, gold and dark crimson color palette on pure black background, heraldic fantasy coat of arms style, ultra detailed, no text no letters no words'
  },
  {
    name: 'champion_select_bg',
    size: '1792x1024',
    prompt: 'Dark fantasy champion selection screen background, five ornate stone pedestals with glowing rune circles arranged in a semicircle in a grand gothic arena hall, magical energy beams connecting the pedestals to a massive dark vaulted ceiling with floating arcane symbols, moody purple and gold lighting, torch flames on wall sconces, League of Legends champion select atmosphere, cinematic concept art, ultra detailed, 4k, no text no letters no words'
  },
  {
    name: 'loadout_bg',
    size: '1792x1024',
    prompt: 'Dark fantasy armory loadout screen background, a mystical weapon rack room in a gothic castle with floating magical weapons and armor pieces surrounded by glowing runes, enchantment table in center with swirling purple energy, stone walls lined with weapon racks and spell scrolls, warm orange torch light mixed with cool blue magical glow, cinematic concept art, League of Legends client style atmosphere, ultra detailed, 4k, no text no letters no words'
  },
  {
    name: 'arena_loading_bg',
    size: '1792x1024',
    prompt: 'Dark fantasy arena loading screen, overhead cinematic view of a gladiatorial pit arena with massive stone pillars casting long shadows, blazing torches along weathered stone walls, blood-stained stone floor with glowing arcane runes forming a ritual circle, dark stormy sky above with red lightning and volcanic glow on the horizon, heavy vignette darkening the edges, WoW arena loading screen style, cinematic wide shot, League of Legends concept art quality, ultra detailed, 4k, no text no letters no words'
  }
];

// Full-body standing reference images for Meshy Image-to-3D model generation.
// These must show: full body head-to-toe, neutral standing pose, single character,
// clear silhouette against simple background. NOT used for UI — only for 3D pipeline.
const MODEL_REF_PROMPTS = [
  {
    name: 'tyrant_model_ref',
    size: '1024x1792',
    prompt: 'Full body character concept art of a dark fantasy armored warlord standing upright in a neutral pose, facing forward, massive male knight in heavy blood-red and black plate armor with horned great helm, wielding an enormous two-handed greatsword held at his side, red cape hanging behind, heavy spiked pauldrons and dark steel gauntlets, full body visible from head to boots, standing on flat ground, solid dark background, character turnaround reference sheet style, ultra detailed, 4k, no text no letters no words'
  },
  {
    name: 'wraith_model_ref',
    size: '1024x1792',
    prompt: 'Full body character concept art of a dark fantasy rogue assassin standing upright in a neutral pose, facing forward, lean hooded figure in deep purple-indigo fitted leather armor, spectral bird-like mask with glowing violet eyes, holding two curved daggers at sides, tattered cloak hanging behind, silver buckle bracers, full body visible from hood to boots, standing on flat ground, solid dark background, character turnaround reference sheet style, ultra detailed, 4k, no text no letters no words'
  },
  {
    name: 'infernal_model_ref',
    size: '1024x1792',
    prompt: 'Full body character concept art of a dark fantasy fire mage standing upright in a neutral pose, facing forward, robed skeletal figure with glowing orange eyes under dark hood, skull face, flowing dark robes with molten ember cracks and lava glow, holding an ornate fire staff with crystal top in one hand, full body visible from hood to feet, standing on flat ground, solid dark background, character turnaround reference sheet style, ultra detailed, 4k, no text no letters no words'
  },
  {
    name: 'harbinger_model_ref',
    size: '1024x1792',
    prompt: 'Full body character concept art of a dark fantasy warlock necromancer standing upright in a neutral pose, facing forward, gaunt robed figure with large curved ram horns and skeletal face with green glowing eyes, tattered dark green and black robes, holding a glowing green grimoire book in one hand, bone ornaments and skull belt, full body visible from horns to boots, standing on flat ground, solid dark background, single character only, character turnaround reference sheet style, ultra detailed, 4k, no text no letters no words'
  },
  {
    name: 'revenant_model_ref',
    size: '1024x1792',
    prompt: 'Single full body character concept art of a holy paladin knight standing upright in a neutral A-pose with arms slightly out to the sides, facing forward, noble armored figure in gleaming ivory-white and gold ornate plate armor, golden divine halo above head, white tabard with golden holy cross, empty hands with no weapons and no shield, full body clearly visible from head to boots, symmetrical pose, standing on flat ground, solid dark background, single character only, ultra detailed, 4k, no text no letters no words no multiple views no turnaround'
  },
];

const TEXTURE_PROMPTS = [
  {
    name: 'tex_tyrant_body',
    size: '1024x1024',
    prompt: 'Painted character texture atlas for a dark fantasy heavy plate armor knight, 2x2 grid layout on solid black background: TOP-LEFT quadrant shows a front-facing horned great helm with T-slit visor in dark steel with blood-red trim and glowing rune engravings, TOP-RIGHT quadrant shows two massive spiked pauldrons and armored gauntlets in battle-worn dark steel with red accent rivets, BOTTOM-LEFT quadrant shows a barrel chest breastplate with layered plate armor gorget and red heraldic details etched into dark steel, BOTTOM-RIGHT quadrant shows heavy armored greaves and sabatons with knee guards in matching dark steel and blood-red trim. Painted hand-drawn RPG character sheet style, NOT seamless tileable, each quadrant is a distinct painted armor piece, flat front-facing view, game asset texture, highly detailed, no text no letters no words'
  },
  {
    name: 'tex_wraith_body',
    size: '1024x1024',
    prompt: 'Painted character texture atlas for a dark fantasy leather assassin, 2x2 grid layout on solid black background: TOP-LEFT quadrant shows a deep peaked hood with spectral mask underneath with glowing violet eye slits in deep purple-indigo fabric, TOP-RIGHT quadrant shows lean leather-wrapped upper arms with silver buckle bracers and forearm wraps in dark indigo, BOTTOM-LEFT quadrant shows a lean leather torso with crossed chest straps and silver buckle at center in deep purple-black leather, BOTTOM-RIGHT quadrant shows fitted leather pants with thigh pouches and soft-soled assassin boots in dark purple-black. Painted hand-drawn RPG character sheet style, NOT seamless tileable, each quadrant is a distinct painted armor piece, flat front-facing view, game asset texture, highly detailed, no text no letters no words'
  },
  {
    name: 'tex_infernal_body',
    size: '1024x1024',
    prompt: 'Painted character texture atlas for a dark fantasy fire mage, 2x2 grid layout on solid black background: TOP-LEFT quadrant shows a wide-brimmed pointed hat with a crown of living flames at the base in charcoal fabric with ember-orange rune embroidery, TOP-RIGHT quadrant shows flowing robe sleeves with gold trim at cuffs in deep crimson fabric with glowing orange runic patterns, BOTTOM-LEFT quadrant shows the upper robe torso with an ornate gold sash belt and ember gemstone clasp in deep crimson with gold embroidered runes, BOTTOM-RIGHT quadrant shows flowing robe skirt reaching to the ground with gold trim at the hem and charcoal inner layer visible at front split. Painted hand-drawn RPG character sheet style, NOT seamless tileable, each quadrant is a distinct painted clothing piece, flat front-facing view, game asset texture, highly detailed, no text no letters no words'
  },
  {
    name: 'tex_harbinger_body',
    size: '1024x1024',
    prompt: 'Painted character texture atlas for a dark fantasy warlock necromancer, 2x2 grid layout on solid black background: TOP-LEFT quadrant shows a gaunt skull-like face with curved demonic horns and a dark green cowl hood with glowing green eye sockets and bone-colored horns, TOP-RIGHT quadrant shows tattered dark green robe shoulders with bone spike protrusions and emaciated cloth-wrapped arms, BOTTOM-LEFT quadrant shows a hunched torso in tattered dark green and black robes with purple glowing runic sigils and bone clasps and chains across the chest, BOTTOM-RIGHT quadrant shows ragged robe skirt with tattered hanging strips and decrepit boots in dark green with purple rune accents. Painted hand-drawn RPG character sheet style, NOT seamless tileable, each quadrant is a distinct painted piece, flat front-facing view, game asset texture, highly detailed, no text no letters no words'
  },
  {
    name: 'tex_revenant_body',
    size: '1024x1024',
    prompt: 'Painted character texture atlas for a holy paladin in ornate plate armor, 2x2 grid layout on solid black background: TOP-LEFT quadrant shows an elegant great helm with rounded dome top and horizontal visor slit in gleaming ivory-white and gold plate with gold trim around the face, TOP-RIGHT quadrant shows wide rounded pauldrons with gold trim rings and armored upper arms in ivory-white plate with royal blue cloth underneath, BOTTOM-LEFT quadrant shows a polished breastplate with a royal blue tabard bearing a gold holy cross symbol in ivory-white plate with gold engravings, BOTTOM-RIGHT quadrant shows armored greaves and sabatons with gold knee guards in ivory-white plate with gold trim and chain mail visible at joints. Painted hand-drawn RPG character sheet style, NOT seamless tileable, each quadrant is a distinct painted armor piece, flat front-facing view, game asset texture, highly detailed, no text no letters no words'
  },
  {
    name: 'tex_arena_floor',
    size: '1024x1024',
    prompt: 'Seamless tileable dark stone floor texture, ancient cracked stone tiles with dried blood stains between joints, dark grey and charcoal coloring with subtle brown undertones, visible grout lines between stones, weathered ancient surface, perfectly top-down view, game floor texture, no perspective distortion, highly detailed, no text no letters'
  },
  {
    name: 'tex_arena_wall',
    size: '1024x1024',
    prompt: 'Seamless tileable dark stone brick wall texture, massive hewn dark grey stone blocks with mortar lines, iron brackets embedded in stone, torch scorch marks and soot stains, weathered ancient dungeon surface, perfectly flat front view, game wall texture, no perspective distortion, highly detailed, no text no letters'
  },
  {
    name: 'tex_arena_pillar',
    size: '1024x1024',
    prompt: 'Seamless stone column surface texture, ancient Roman-style fluted pillar surface with carved runic symbols glowing faintly purple, dark grey weathered stone with patches of moss and lichen, flat unwrapped cylindrical surface texture, game pillar texture, no perspective, highly detailed, no text no letters'
  },
  {
    name: 'tex_sky_panorama',
    size: '1792x1024',
    prompt: 'Dark fantasy sky panorama, dramatic stormy thunderclouds with red and purple lightning bolts, volcanic orange glow on distant horizon, dark ominous oppressive atmosphere, faint stars barely visible through billowing smoke and ash, seamless horizontal panorama suitable for sky dome wrapping, no ground visible, no text no letters no words'
  },
  // ── Weapon textures ──
  {
    name: 'tex_weapon_tyrant_sword',
    size: '1024x1024',
    prompt: 'Seamless flat texture map of a dark fantasy greatsword blade surface, blood-red etched runes along a dark steel blade, battle-worn scratches and nicks, dried blood in the engravings, flat unwrapped metal surface texture suitable for 3D model UV mapping, no perspective, solid black background, game asset texture style, highly detailed, no text no letters no words'
  },
  {
    name: 'tex_weapon_wraith_dagger',
    size: '1024x1024',
    prompt: 'Seamless flat texture map of a dark fantasy assassin curved dagger blade, deep purple-tinted steel with poison green drip streaks along the edge, ornate shadow rune engravings, polished obsidian-like surface, flat unwrapped metal texture suitable for 3D model UV mapping, no perspective, solid black background, game asset texture style, highly detailed, no text no letters no words'
  },
  {
    name: 'tex_weapon_infernal_staff',
    size: '1024x1024',
    prompt: 'Seamless flat texture map of a dark fantasy fire mage gnarled wooden staff surface, charred dark wood grain with glowing ember-orange cracks and molten veins running through the wood, burnt bark texture with faintly glowing fire runes, flat unwrapped surface texture suitable for 3D model UV mapping, no perspective, solid black background, game asset texture style, highly detailed, no text no letters no words'
  },
  {
    name: 'tex_weapon_harbinger_staff',
    size: '1024x1024',
    prompt: 'Seamless flat texture map of a dark fantasy warlock bone staff surface, twisted dark wood intertwined with exposed bone fragments, faintly glowing purple runic sigils carved into the surface, decayed and eldritch appearance, flat unwrapped surface texture suitable for 3D model UV mapping, no perspective, solid black background, game asset texture style, highly detailed, no text no letters no words'
  },
  {
    name: 'tex_weapon_revenant_mace',
    size: '1024x1024',
    prompt: 'Seamless flat texture map of a holy paladin ornate mace and shield surface, gleaming gold and ivory white metal with holy cross engravings, divine light reflections in polished ceremonial metal, celestial rune patterns, flat unwrapped metal surface texture suitable for 3D model UV mapping, no perspective, solid black background, game asset texture style, highly detailed, no text no letters no words'
  },
  // ── Spell energy textures ──
  {
    name: 'tex_spell_fire',
    size: '1024x1024',
    prompt: 'Seamless tileable fire energy texture, swirling orange and red flames with bright yellow-white hot core, magical fire vortex pattern, embers and sparks scattered throughout, dark background showing through gaps in flame, suitable for transparent overlay on 3D sphere, game VFX texture, no perspective, highly detailed, no text no letters no words'
  },
  {
    name: 'tex_spell_shadow',
    size: '1024x1024',
    prompt: 'Seamless tileable dark shadow void energy texture, swirling deep purple and black tendrils of darkness, faint violet lightning arcs, ethereal smoke-like wisps, dark void energy pattern suitable for transparent overlay on 3D sphere, game VFX texture, no perspective, highly detailed, no text no letters no words'
  },
  {
    name: 'tex_spell_holy',
    size: '1024x1024',
    prompt: 'Seamless tileable holy divine light energy texture, radiating golden-white light rays with soft warm glow, celestial sparkles and divine rune patterns, heavenly aura suitable for transparent overlay on 3D sphere, game VFX texture, no perspective, highly detailed, no text no letters no words'
  },
  {
    name: 'tex_spell_frost',
    size: '1024x1024',
    prompt: 'Seamless tileable frost ice energy texture, crystalline blue and white ice shards with frozen mist swirls, snowflake patterns and icy cracks, cold blue glow emanating from core, suitable for transparent overlay on 3D sphere, game VFX texture, no perspective, highly detailed, no text no letters no words'
  },
  {
    name: 'tex_spell_arcane',
    size: '1024x1024',
    prompt: 'Seamless tileable arcane magic energy texture, swirling violet and magenta arcane runes in circular patterns, glowing purple energy streams with bright white sparks, mystical geometric sigils, suitable for transparent overlay on 3D sphere, game VFX texture, no perspective, highly detailed, no text no letters no words'
  },
  {
    name: 'tex_spell_nature',
    size: '1024x1024',
    prompt: 'Seamless tileable nature poison energy texture, sickly green and dark emerald swirling vines and toxic mist, glowing green spore particles, decaying organic matter pattern with bioluminescent accents, suitable for transparent overlay on 3D sphere, game VFX texture, no perspective, highly detailed, no text no letters no words'
  }
];

async function generateImage(promptConfig, outDir = OUT_DIR) {
  const { name, prompt, size } = promptConfig;
  const outPath = path.join(outDir, `${name}.png`);

  if (fs.existsSync(outPath)) {
    console.log(`  [skip] ${name}.png already exists`);
    return;
  }

  console.log(`  [gen]  ${name} (${size})...`);

  const resp = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size,
      quality: 'hd',
      response_format: 'b64_json',
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.error(`  [ERR] ${name}: ${resp.status} - ${err}`);
    return;
  }

  const json = await resp.json();
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) {
    console.error(`  [ERR] ${name}: no image data in response`);
    return;
  }

  fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
  console.log(`  [ok]  ${name}.png saved`);
}

async function main() {
  const args = process.argv.slice(2);
  const onlyModelRef = args.includes('--model-ref');
  const onlyTextures = args.includes('--textures');

  console.log('Ebon Crucible Art Generator');
  console.log(`Output: ${OUT_DIR}\n`);

  if (!onlyModelRef && !onlyTextures) {
    // Generate splash art sequentially to avoid rate limits
    for (const p of PROMPTS) {
      await generateImage(p);
    }
  }

  if (!onlyTextures) {
    // Generate model reference images (for Meshy Image-to-3D pipeline)
    console.log('\n  Generating model reference images...\n');
    for (const p of MODEL_REF_PROMPTS) {
      await generateImage(p);
    }
  }

  if (!onlyModelRef) {
    // Generate texture assets
    const textureDir = path.join(OUT_DIR, '..', 'textures');
    if (!fs.existsSync(textureDir)) {
      fs.mkdirSync(textureDir, { recursive: true });
    }

    console.log('\n  Generating texture assets...\n');

    for (const item of TEXTURE_PROMPTS) {
      await generateImage(item, textureDir);
    }
  }

  console.log('\nDone!');
}

main().catch(console.error);
