#!/usr/bin/env node
// Generate 2D portrait images for each dungeon monster.
// Used by the HUD enemy frame so the user sees a Carrion Knight portrait
// when targeting a Carrion Knight (instead of the generic Tyrant portrait).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OPENAI_KEY = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8').match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const OUT_DIR = path.join(ROOT, 'public', 'assets', 'art', 'monsters');
fs.mkdirSync(OUT_DIR, { recursive: true });

const PORTRAITS = {
  carrion_knight: 'Dark fantasy portrait headshot of an undead knight, rusted iron horned helm with hollow glowing red eyes beneath the visor, decay and bone visible at the joints of the gorget, ash-grey tabard, brooding evil presence, painterly digital art, dark moody lighting, square composition, dark stone background',
  bone_cultist: 'Dark fantasy portrait headshot of a hooded skeletal cultist, deep black hood casting shadow over the skull face, glowing purple eye sockets, bone fragments and ritual chains around the neck, gaunt corpse-like skin, painterly digital art, dark moody lighting, square composition',
  hellhound: 'Dark fantasy portrait headshot of a bipedal demon hound-warrior, wolf-jackal head with bared fangs, hollow burning red eyes, charred black fur with glowing ember cracks, exposed bone spikes, painterly digital art, dark moody lighting, square composition, dark stone background',
  drudgekin_brute: 'Dark fantasy portrait headshot of a hulking warbeast brute, broken tusks jutting from a brutalized jaw, patchwork stitching across the face, iron rings pierced through ears and brow, mountain of muscle, intimidating, painterly digital art, dark moody lighting, square composition',
  wraith_specter: 'Dark fantasy portrait headshot of a ghostly hooded specter, half-formed translucent face beneath a tattered shadowy cowl, hollow sunken eyes glowing faint blue-white, ethereal mist dissolving at the edges, painterly digital art, dark moody lighting, square composition, dark stone background',
  ashen_warlord: 'Dark fantasy portrait headshot of an ancient warlord king, towering crowned helm with curved horns and a face-covering visor, soot-blackened ornate plate armor with embered cracks running through the metal, ash and sparks rising from his shoulders, BOSS-tier intimidating presence, painterly digital art, dark moody lighting, square composition',
};

async function gen(id, prompt) {
  const out = path.join(OUT_DIR, `${id}.png`);
  if (fs.existsSync(out)) { console.log(`[${id}] exists, skip`); return; }
  console.log(`[${id}] generating...`);
  const resp = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: 'gpt-image-1', prompt, n: 1, size: '1024x1024', quality: 'medium', output_format: 'png',
    }),
  });
  const data = await resp.json();
  if (!resp.ok) { console.error(`[${id}]`, JSON.stringify(data).slice(0, 200)); return; }
  const buf = Buffer.from(data.data[0].b64_json, 'base64');
  fs.writeFileSync(out, buf);
  console.log(`[${id}] saved ${(buf.length / 1024).toFixed(0)} KB`);
}

await Promise.all(Object.entries(PORTRAITS).map(([id, p]) => gen(id, p).catch(e => console.error(id, e.message))));
console.log('Portraits done.');
