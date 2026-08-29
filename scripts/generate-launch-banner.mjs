#!/usr/bin/env node
// Generate the multi-platform launch announcement banner via gpt-image-1
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const envText = readFileSync(resolve(ROOT, '.env'), 'utf-8');
const apiKey = envText.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
if (!apiKey) { console.error('No OPENAI_API_KEY in .env'); process.exit(1); }

const OUTPUT_DIR = resolve(ROOT, 'public/assets/art');
const ART_DIR = resolve(ROOT, 'public/assets/art');

function loadPortrait(name) {
  const path = resolve(ART_DIR, `${name}_portrait.webp`);
  if (!existsSync(path)) { console.warn(`Portrait not found: ${path}`); return null; }
  return readFileSync(path).toString('base64');
}

const portraits = [
  loadPortrait('tyrant'),
  loadPortrait('wraith'),
  loadPortrait('infernal'),
  loadPortrait('harbinger'),
  loadPortrait('revenant'),
].filter(Boolean);

const prompt = `Using the five characters shown in the reference images as the exact visual designs, create an epic dark fantasy multi-platform launch hero banner. All five champions stand together as a heroic lineup on a massive obsidian arena platform: the horned armored warrior (image 1), the hooded masked assassin (image 2), the flaming skull mage (image 3), the horned undead warlock (image 4), and the golden holy knight (image 5). Behind them, an ancient cathedral coliseum rises into a stormy sky lit by crimson lightning and ember sparks. Crimson and golden ambient light wraps every figure, giving them a powerful cinematic silhouette. Wide cinematic composition, ultra-detailed digital painting, League of Legends key art style. No text, no letters, no words, no writing, no logos, no platform icons.`;

const outName = 'launch_early_access_banner';
console.log(`Generating ${outName}...`);

const form = new FormData();
form.append('model', 'gpt-image-1');
form.append('prompt', prompt);
form.append('n', '1');
form.append('size', '1536x1024');
form.append('quality', 'high');
for (let i = 0; i < portraits.length; i++) {
  const buf = Buffer.from(portraits[i], 'base64');
  form.append('image[]', new Blob([buf], { type: 'image/webp' }), `portrait_${i}.webp`);
}

const resp = await fetch('https://api.openai.com/v1/images/edits', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${apiKey}` },
  body: form
});
const data = await resp.json();
if (!data.data?.[0]) {
  console.error('Failed:', JSON.stringify(data).slice(0, 500));
  process.exit(1);
}
const imgData = data.data[0];
const buf = imgData.b64_json
  ? Buffer.from(imgData.b64_json, 'base64')
  : Buffer.from(await (await fetch(imgData.url)).arrayBuffer());
const outPath = resolve(OUTPUT_DIR, `${outName}.webp`);
writeFileSync(outPath, buf);
console.log(`Saved ${outName} (${(buf.length / 1024).toFixed(0)} KB)`);
