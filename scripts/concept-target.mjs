import { generateImage, Budget } from './lib/genkit.mjs';

// The environment has to sit with the characters that already exist, not the
// other way round: five rigged PBR models are the expensive asset and are not
// getting redone. Measured against their diffuse maps they run ~37-53%
// saturation, high local detail and a ~19-hue palette — grounded dark fantasy,
// not painterly. An earlier painterly target measured 10-24% saturation and
// 3 hues, which would have made the characters read as stickers on a backdrop.
const budget = new Budget(0.40);
const STYLE = 'rendered in a grounded dark fantasy 3D game art style with physically based '
  + 'materials, in the manner of Diablo IV rather than a painterly or cartoon style. '
  + 'Detailed stone and metal surfaces with visible wear, grime in the crevices, rust and soot. '
  + 'Rich but desaturated palette of weathered basalt, iron, bone, dried blood and ember orange, '
  + 'with enough hue variation that surfaces read as different materials rather than one tint. '
  + 'Dramatic contrast: most of the space in shadow with warm brazier pools and cold rim light. '
  + 'Game screenshot framing, no characters, no UI, no text.';

const shots = [
  { id: 'target_wing_v2',
    prompt: `Overhead three-quarter view of a complete dark fantasy dungeon wing showing five connected chambers: `
      + `a small entry hall, a large octagonal arena about fifty feet across, an ossuary of bone-stacked walls, `
      + `a hall of broken pillars, and a ritual chamber raised four feet and reached by worn stone steps. `
      + `Short corridors link them and fall into darkness between the lit rooms. Each chamber is dressed differently — `
      + `rubble and broken statuary in one, bone piles and burial urns in another, a cracked glowing ritual circle in the third — `
      + `so no two rooms repeat. ${STYLE}` },
  { id: 'target_arena_v2',
    prompt: `Overhead three-quarter view of a single dark fantasy dungeon chamber about fifty feet across, `
      + `walls of stacked weathered basalt with heavy plinth bases, iron sconces and hanging chains. `
      + `A raised stone platform along one side reached by three worn steps. Floor of fitted flagstones with deep mortar lines, `
      + `scattered rubble, a toppled statue, an iron brazier throwing warm light and long shadows. ${STYLE}` },
];

for (const s of shots) {
  const out = `public/assets/art/concepts/${s.id}.png`;
  await generateImage({ prompt: s.prompt, out, size: '1536x1024', transparent: false, budget, commit: true });
  console.log('  ->', out);
}
console.log(' ', budget.report());
