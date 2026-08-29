// Dungeon encounter sequence — the rooms a player walks through in a single run.
//
// Each "room" is a multi-chamber wing (entry + main + 2-3 branch chambers).
// Wing has 3 main packs + 2 per branch ≈ 7-9 packs × 2-3 mobs = 14-27 mobs.
// Encounter mob counts below are sized to fill those spawn slots.

function packs(...specs) {
  const out = [];
  for (const spec of specs) {
    const [id, countStr] = spec.split(':');
    const count = parseInt(countStr, 10) || 1;
    for (let i = 0; i < count; i++) out.push({ id });
  }
  return out;
}

export const ENCOUNTER_SEQUENCE = [
  // Room 1 — easy intro: ~16 mobs across all chambers
  {
    roomNumber: 1,
    label: 'The Antechamber',
    monsters: packs('carrion_knight:6', 'carrion_knight:6', 'bone_cultist:4'),
  },
  // Room 2 — caster + melee mixed across branching halls
  {
    roomNumber: 2,
    label: 'Whispering Halls',
    monsters: packs('bone_cultist:5', 'carrion_knight:6', 'bone_cultist:5', 'carrion_knight:4'),
  },
  // Room 3 — speed pressure: hellhound packs in every chamber
  {
    roomNumber: 3,
    label: 'Hollow Kennels',
    monsters: packs('hellhound:5', 'hellhound:5', 'hellhound:5', 'hellhound:5'),
  },
  // Room 4 — heavy hitters + skirmishers across chambers
  {
    roomNumber: 4,
    label: 'The Forge Below',
    monsters: packs('drudgekin_brute:3', 'carrion_knight:5', 'drudgekin_brute:3', 'bone_cultist:4', 'carrion_knight:5'),
  },
  // Boss — single mega encounter, linear approach
  {
    roomNumber: 5,
    label: 'Throne of Ash',
    monsters: [{ id: 'ashen_warlord' }],
    isBoss: true,
  },
];

export const ROOM_COIN_REWARD = {
  1: 40,
  2: 60,
  3: 60,
  4: 80,
  5: 120,
};

export function getEncounter(roomIndex) {
  return ENCOUNTER_SEQUENCE[roomIndex] || null;
}

export function totalRooms() {
  return ENCOUNTER_SEQUENCE.length;
}
