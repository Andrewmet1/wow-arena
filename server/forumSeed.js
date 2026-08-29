import 'dotenv/config';
import OpenAI from 'openai';
import * as forumDb from './forumDb.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_AUTHOR = {
  sub: 'SYSTEM',
  username: 'Ebon Crucible',
  isStaff: true,
};

// ── Complete site content for context ──
const SITE_CONTEXT = `
EBON CRUCIBLE — DARK FANTASY 1v1 ARENA COMBAT

GAME OVERVIEW:
Choose a deadly class. Master 63 abilities. Fight real players in ranked 1v1 arena combat.
Dark fantasy 1v1 arena combat game. Free to play in browser. No pay-to-win. Pure skill determines outcome.
Two players enter the arena, each controlling a champion with unique abilities. The last one standing wins.

FIVE CLASSES:

TYRANT (Warrior) — Resource: Rage — 12 abilities
Relentless melee pressure. Build Rage through auto-attacks, then shatter your enemy's armor and execute them when they're wounded. Two gap-closers keep you on top of kiting classes. Iron Resolve makes you unstoppable during burst windows.
Strengths: Damage (85%), Durability (70%), Mobility (65%), Control (50%), Healing (40%)
Abilities: Ravaging Cleave, Bloodrage Strike, Brutal Slam, Iron Cyclone, Shatter Guard, Warbringer Rush, Crippling Strike, Thunder Spike, Iron Resolve, Warborn Rally, Skull Crack, Crushing Descent
Starter Builds: Iron Tide (relentless aggression), Blood Oath (unyielding resilience), Butcher (savage executioner), Siegebreaker (no one escapes)
Patch 0.2: Execute threshold raised. Armor Break amplifies all physical damage. Reckless Fury resets Execute cooldown on kill. Break their armor, build rage, finish them when wounded.

WRAITH (Assassin) — Resource: Energy + Combo Points — 14 abilities
A shadow assassin who strikes from stealth with devastating openers. Build Combo Points through quick attacks, then spend them on powerful finishers. Evasion cooldowns and Vanish let you reset fights on your terms.
Strengths: Damage (90%), Durability (35%), Mobility (80%), Control (60%), Healing (30%)
Abilities: Viper Lash, Throat Opener, Grim Flurry, Nerve Strike, Serrated Wound, Blackjack, Veil of Night, Shade Shift, Phantasm Dodge, Umbral Shroud, Blood Tincture, Throat Jab, Frenzy Edge, Shadowmeld
Starter Builds: Venom Fang (death by a thousand cuts), Phantom (strike from the shadows), Dervish (frenzied bladework), Nightshade (turn their magic against them)
Patch 0.2: Shadowstrike from stealth generates bonus Combo Points. Eviscerate scaling improved. New Smoke Bomb creates a zone that breaks targeting. The opener-to-finisher pipeline is sharper than ever.

INFERNAL (Mage) — Resource: Mana + Cinder Stacks — 15 abilities
A fire and frost mage who controls the battlefield from range. Stack Cinders through fire spells to empower Cataclysm Flare into a one-shot nuke. Phase Shift and roots keep melee at bay. Pyroclasm turns you into a glass cannon.
Strengths: Damage (95%), Durability (30%), Mobility (45%), Control (55%), Healing (20%)
Abilities: Inferno Bolt, Cataclysm Flare, Searing Pulse, Glacial Lance, Permafrost Burst, Phase Shift, Pyroclasm, Crystalline Ward, Cauterize, Arcane Bulwark, Spell Fracture, Scaldwind, Ember Brand, Scorched Earth, Ring of Frost
Starter Builds: Pyroclast (pure devastation), Frostweaver (frozen dominion), Spellblade (battle-mage discipline), Hellstorm (the arena becomes your weapon)
Patch 0.2: Consuming 4 Cinder stacks grants Ignition — next fire spell becomes instant cast. Skilled Infernals weave spells to build stacks, then unleash devastating instant-cast combos.

HARBINGER (Warlock) — Resource: Mana + Soul Shards — 15 abilities
A warlock who grinds enemies down through relentless DoTs and life drain. Stack multiple afflictions, then detonate them with Hex Rupture. Fear and Nether Slam provide crowd control. Your demon pet interrupts and provides emergency shields.
Strengths: Damage (70%), Durability (55%), Mobility (40%), Control (65%), Healing (60%)
Abilities: Hex Blight, Creeping Torment, Volatile Hex, Siphon Essence, Hex Rupture, Dread Howl, Wraith Bolt, Nether Slam, Blood Tithe, Warded Flesh, Rift Anchor, Hex Silence, Soul Ignite, Shadowfury, Abyssal Ground
Starter Builds: Plague Doctor (layer curses until the body fails), Soul Reaver (feast on their essence), Dread Caller (master of fear), Void Herald (command the void)
Patch 0.2: Soul Shard generation from DoT ticks increased. Haunt amplifies all damage on target. Fear duration reduced but breaks on less damage. The attrition game is stronger with clearer shard generation windows.

REVENANT (Paladin) — Resource: Holy Power + Mana — 13 abilities
A holy warrior who builds Holy Power through strikes and judgments, then spends it on devastating finishers or clutch healing. Aegis of Dawn grants immunity. Ember Wake supercharges your burst window. The ultimate hybrid — can kill or outlast.
Strengths: Damage (60%), Durability (85%), Mobility (35%), Control (45%), Healing (90%)
Abilities: Hallowed Strike, Divine Reckoning, Radiant Verdict, Sanctified Gale, Ember Wake, Gavel of Light, Binding Prayer, Aegis of Dawn, Sovereign Mend, Holy Restoration, Unchained Grace, Sanctified Rebuff, Valiant Charge
Starter Builds: Dawn Knight (righteous fury, holy vengeance), Sanctuary (eternal guardian, the light mends), Zealot (righteous pursuit, chase the wicked), Inquisitor (judgment is absolute)
Patch 0.2: Holy Power spenders buffed. Consecration generates Holy Power passively. Divine Shield cooldown reduced. The hybrid playstyle rewards balancing offense and defense through smart Holy Power management.

COMBAT MECHANICS:
- CC (Crowd Control): Stuns, roots, silences, fears. Chain them to lock down opponents.
- Interrupts: Kick cast-time abilities to prevent healing or burst. Timing is everything.
- Defensives: Shields, damage reduction, immunities, and healing to survive burst.
- Burst: Stack cooldowns, CC the opponent, and unload. Knowing when to commit wins games.
- Positioning: WASD movement. Kite melee, chase ranged, dodge abilities.

GAME MODES:
- Ranked 1v1: Queue up, get matched by skill. Earn rating and climb the ladder from The Broken to The Ascended.
- Custom Game: Create a room with a 4-letter code. Share it with a friend.
- VS AI: Fight AI opponents at three difficulty levels.

RANKED TIERS (Five tiers):
1. The Broken (<1300) — Where all warriors begin. The proving grounds.
2. The Proven (1300+) — Skilled combatants who know their class and can read their opponent.
3. The Exalted (1500+) — Masters of their craft. Feared and respected.
4. The Dread (1800+) — The elite few. Every opponent knows your name before the gates open.
5. The Ascended (2000+) — Legends of the crucible. Only the most dedicated reach this pinnacle.

CRUCIBLE CHAMPION:
The highest-rated player is crowned the Crucible Champion. When the crown changes hands, every player online is notified. At the top, every single match is a battle to hold or claim the throne.

TONE & VOICE:
Ominous but exciting. Competitive and challenging. Empowering. Dark fantasy-inspired. Direct and confident. Dramatic — crown, champion, legend, ascended. No hedging, no softness. The Crucible is a place of blood, fire, and glory.
`;

// Category-specific prompts for richer, targeted generation
const CATEGORY_PROMPTS = {
  announcements: 'Write the first official post for the Announcements board. This board is for official news — patch notes, balance updates, server maintenance, events. Set the tone that this is the official voice of the development team. Mention that Patch 0.2 and Ranked Season 1 are now live. Keep it authoritative but welcoming.',

  general: 'Write the welcome post for General Discussion. This is the main gathering place for the community. Welcome players — from new fighters to seasoned gladiators. Encourage sharing experiences, celebrating victories, mourning defeats, discussing the meta, and connecting with other arena fighters. Make it feel like the beating heart of the community.',

  class_tyrant: 'Write the welcome post for the Tyrant class discussion board. The Tyrant is a rage-fueled warrior — relentless melee pressure, armor-shattering, executes on wounded enemies, gap-closers. Reference specific abilities (Ravaging Cleave, Iron Cyclone, Warbringer Rush, Iron Resolve, Shatter Guard, Crushing Descent), builds (Iron Tide, Blood Oath, Butcher, Siegebreaker), and the class fantasy of unstoppable aggression. Encourage sharing strategies, matchup tips, and build experimentation.',

  class_wraith: 'Write the welcome post for the Wraith class discussion board. The Wraith is a shadow assassin — stealth openers, combo points into devastating finishers, evasion cooldowns, Vanish resets. Reference specific abilities (Viper Lash, Throat Opener, Grim Flurry, Shadowmeld, Phantasm Dodge, Umbral Shroud, Blackjack), builds (Venom Fang, Phantom, Dervish, Nightshade), and the class fantasy of striking from the shadows. Encourage sharing opener sequences, combo optimization, and evasion timing.',

  class_infernal: 'Write the welcome post for the Infernal class discussion board. The Infernal is a fire/frost mage — stack Cinders to empower Cataclysm Flare into a one-shot nuke, Phase Shift to escape melee, Pyroclasm for glass cannon burst. Reference specific abilities (Inferno Bolt, Cataclysm Flare, Glacial Lance, Phase Shift, Ring of Frost, Pyroclasm, Crystalline Ward), builds (Pyroclast, Frostweaver, Spellblade, Hellstorm), and the Ignition mechanic from Patch 0.2. Encourage sharing stack management, kiting routes, and burst combos.',

  class_harbinger: 'Write the welcome post for the Harbinger class discussion board. The Harbinger is a DoT/drain warlock — grind enemies down with afflictions, detonate with Hex Rupture, fear for CC, demon pet for interrupts/shields. Reference specific abilities (Hex Blight, Creeping Torment, Siphon Essence, Hex Rupture, Dread Howl, Blood Tithe, Shadowfury, Abyssal Ground), builds (Plague Doctor, Soul Reaver, Dread Caller, Void Herald), and Soul Shard mechanics. Encourage sharing DoT rotation optimization, fear timing, and attrition strategies.',

  class_revenant: 'Write the welcome post for the Revenant class discussion board. The Revenant is a holy paladin hybrid — builds Holy Power through strikes/judgments, spends on finishers or clutch heals, Aegis of Dawn for immunity, Ember Wake for burst. Reference specific abilities (Hallowed Strike, Divine Reckoning, Radiant Verdict, Ember Wake, Aegis of Dawn, Sovereign Mend, Holy Restoration, Valiant Charge), builds (Dawn Knight, Sanctuary, Zealot, Inquisitor), and the hybrid offense/defense identity. Encourage sharing Holy Power management, burst combos, and healing timing.',

  strategy: 'Write the welcome post for Strategy & Guides. This is where the community shares builds, matchup analyses, positioning guides, cooldown trade frameworks, and advanced tactics. Encourage players to post class guides, share matchup knowledge, and help each other improve. Reference the depth of the combat system — 63 abilities, CC chains, interrupt timing, defensive rotations, positioning. Make it feel like a war room for serious competitors.',

  bugs: 'Write the welcome post for Bug Reports & Feedback. This is where players report bugs and suggest features. Ask players to include: what happened vs. what they expected, steps to reproduce, their class and opponent class. For suggestions, ask them to describe the idea and why it would improve the game. Emphasize that the dev team reads everything and that player feedback directly shapes the game. Keep it professional but grateful.',

  offtopic: 'Write the welcome post for Off-Topic discussion. This is the casual hangout — other games, memes, general conversation. Keep it lighthearted compared to the rest of the forum. Remind people to be respectful but have fun. The tone should be relaxed while still fitting the dark fantasy vibe.',
};

async function generatePost(category, prompt) {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.8,
    messages: [
      {
        role: 'system',
        content: `You are the official voice of Ebon Crucible, a dark fantasy 1v1 arena combat game. You are writing forum welcome posts as the "Ebon Crucible" staff account.

Your writing style:
- Dark fantasy tone — ominous, dramatic, but welcoming
- Direct and confident. No hedging or corporate-speak.
- Use short, punchy sentences mixed with longer atmospheric ones
- Reference specific game mechanics, abilities, and builds naturally — not as a list
- End with a thematic sign-off line (1 sentence, evocative)
- Posts should be 150-300 words — substantial but not walls of text
- Use line breaks between paragraphs for readability
- Do NOT use markdown formatting (no #, **, etc.) — this is plain text
- Do NOT use emojis

Here is the complete game content for reference:
${SITE_CONTEXT}`,
      },
      {
        role: 'user',
        content: `${prompt}\n\nReturn ONLY a JSON object with "title" (string) and "body" (string, using \\n for line breaks). No markdown code blocks, just raw JSON.`,
      },
    ],
  });

  const raw = completion.choices[0].message.content.trim();
  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(cleaned);
}

async function seed() {
  console.log('Generating forum welcome posts via OpenAI...\n');

  for (const [cat, prompt] of Object.entries(CATEGORY_PROMPTS)) {
    const catDef = forumDb.FORUM_CATEGORIES[cat];
    if (!catDef) {
      console.log(`  SKIP: Unknown category "${cat}"`);
      continue;
    }

    // Check if category already has threads
    const existing = await forumDb.listThreads(cat, null, 1);
    if (existing.threads.length > 0) {
      console.log(`  SKIP: ${catDef.name} — already has threads`);
      continue;
    }

    console.log(`  GENERATING: ${catDef.name}...`);
    try {
      const post = await generatePost(cat, prompt);
      await forumDb.createThread(cat, post.title, post.body, SYSTEM_AUTHOR);
      console.log(`  SEED: ${catDef.name} — "${post.title}"`);
    } catch (err) {
      console.error(`  ERROR: ${catDef.name} — ${err.message}`);
    }
  }

  console.log('\nDone.');
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
