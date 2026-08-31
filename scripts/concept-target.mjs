import { generateImage, Budget } from './lib/genkit.mjs';

// End-state targets. These describe the structures the generators actually
// build — arena radius and pillar layout from ArenaVariants, dungeon chamber
// count and scale from WingLayout — so they are references to check work
// against rather than unrelated mood art.
//
// Style targets the existing character models: measured at 37-53% saturation
// with high local detail across ~19 hues. A painterly target would leave those
// characters reading as stickers on a flat backdrop.
const budget = new Budget(0.60);

const STYLE =
  'Grounded dark fantasy 3D game art in the manner of Diablo IV — physically based materials, '
  + 'sculpted geometry, not painterly or cartoon. Weathered basalt and iron with visible chipping, '
  + 'soot and grime in the crevices, rust streaks, bone and dried blood. Rich but desaturated palette '
  + 'with real hue separation between stone, metal and bone. Dramatic contrast: most of the space in '
  + 'shadow with warm brazier pools and cold rim light. Game screenshot, no characters, no UI, no text.';

const shots = [
  {
    id: 'GOAL_arena',
    prompt:
      'Overhead three-quarter view of a complete circular gladiatorial arena for a dark fantasy PvP game, '
      + 'about eighty feet across, enclosed by a high ring of stacked basalt blocks with iron banding. '
      + 'Four heavy stone pillars stand evenly inside the ring as cover. Two opposing portcullis gates set '
      + 'into the wall at either end where fighters enter. The floor is fitted flagstone worn smooth at the '
      + 'centre, cracked and blood-stained, with a faint carved sigil at the middle. Iron braziers burn along '
      + 'the wall throwing warm pools of light; the ring above falls into darkness. ' + STYLE,
  },
  {
    id: 'GOAL_dungeon',
    prompt:
      'Overhead three-quarter cutaway view of a complete dark fantasy dungeon wing with five connected rooms, '
      + 'each roughly fifty feet across. A small entry hall leads through a short corridor into a large '
      + 'octagonal chamber with broken pillars, which branches into an ossuary of bone-stacked walls and burial '
      + 'urns, a hall of toppled statues and rubble, and a ritual chamber raised four feet and reached by worn '
      + 'stone steps. Arched basalt doorways connect them. Each room is dressed differently so none repeats. '
      + 'Braziers light the rooms; the corridors between fall into near darkness. ' + STYLE,
  },
];

for (const s of shots) {
  const out = `public/assets/art/concepts/${s.id}.png`;
  await generateImage({ prompt: s.prompt, out, size: '1536x1024', transparent: false, budget, commit: true });
  console.log('  ->', out);
}
console.log(' ', budget.report());
