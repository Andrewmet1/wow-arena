/**
 * Arena modifiers — match-wide rule changes applied at match start.
 * 1-2 selected randomly per match.
 */

export const MODIFIERS = {
  dampening: {
    id: 'dampening',
    name: 'Dampening',
    description: 'Healing received reduced by 1% per 15 seconds.',
    icon: 'dampening',
    apply(matchState) {
      matchState._dampeningActive = true;
    },
    tick(matchState, currentTick) {
      // Every 150 ticks (15s), increase dampening
      const dampeningPercent = Math.floor(currentTick / 150) * 0.01;
      for (const unit of matchState.units) {
        unit.stats.healingReceivedMod = Math.max(0, 1 - dampeningPercent);
      }
    }
  },

  mana_tide: {
    id: 'mana_tide',
    name: 'Mana Tide',
    description: 'Mana regeneration doubled for all.',
    icon: 'mana_tide',
    apply(matchState) {
      for (const unit of matchState.units) {
        const manaPool = unit.resources.get('mana');
        if (manaPool) manaPool.regenModifier = 2.0;
      }
    }
  },

  mana_drought: {
    id: 'mana_drought',
    name: 'Mana Drought',
    description: 'Mana regeneration halved.',
    icon: 'mana_drought',
    apply(matchState) {
      for (const unit of matchState.units) {
        const manaPool = unit.resources.get('mana');
        if (manaPool) manaPool.regenModifier = 0.5;
      }
    }
  },

  blood_fury: {
    id: 'blood_fury',
    name: 'Blood Fury',
    description: 'All damage +15%. All healing -15%.',
    icon: 'blood_fury',
    apply(matchState) {
      for (const unit of matchState.units) {
        unit.stats.damageDealtMod *= 1.15;
        unit.stats.healingDoneMod *= 0.85;
      }
    }
  },

  ironclad: {
    id: 'ironclad',
    name: 'Ironclad',
    description: 'All armor and magic DR increased by 10%.',
    icon: 'ironclad',
    apply(matchState) {
      for (const unit of matchState.units) {
        unit.stats.physicalArmor = Math.min(0.70, unit.stats.physicalArmor + 0.10);
        unit.stats.magicDR = Math.min(0.50, unit.stats.magicDR + 0.10);
      }
    }
  },

  shifting_pillars: {
    id: 'shifting_pillars',
    name: 'Shifting Pillars',
    description: 'Arena pillars slowly rotate around the center.',
    icon: 'shifting_pillars',
    apply(matchState) {
      matchState._shiftingPillars = true;
      matchState._pillarAngle = 0;
    },
    tick(matchState, currentTick) {
      // Rotate pillars: full rotation in 900 ticks (90s)
      matchState._pillarAngle = (currentTick / 900) * Math.PI * 2;
      const basePillars = [
        { x: 10, z: 10 }, { x: -10, z: 10 },
        { x: 10, z: -10 }, { x: -10, z: -10 }
      ];
      const cos = Math.cos(matchState._pillarAngle);
      const sin = Math.sin(matchState._pillarAngle);
      matchState.los.pillars.forEach((p, i) => {
        p.x = basePillars[i].x * cos - basePillars[i].z * sin;
        p.z = basePillars[i].x * sin + basePillars[i].z * cos;
      });
    }
  },

  narrow_arena: {
    id: 'narrow_arena',
    name: 'Narrow Arena',
    description: 'Arena radius reduced by 30%.',
    icon: 'narrow_arena',
    apply(matchState) {
      // We can't easily change the constant, so we'll track it on matchState
      matchState._arenaRadiusOverride = 28; // 40 * 0.7
    }
  },

  fog_of_war: {
    id: 'fog_of_war',
    name: 'Fog of War',
    description: 'Stealth detection range halved. Stealth +10% speed.',
    icon: 'fog_of_war',
    apply(matchState) {
      matchState._fogOfWar = true;
    }
  },

  arcane_instability: {
    id: 'arcane_instability',
    name: 'Arcane Instability',
    description: 'All spell crit chance increased by 20%.',
    icon: 'arcane_instability',
    apply(matchState) {
      for (const unit of matchState.units) {
        unit.stats.critChance += 0.20;
      }
    }
  },

  exhaustion: {
    id: 'exhaustion',
    name: 'Exhaustion',
    description: 'Movement speed bonuses disabled (capped at 100%).',
    icon: 'exhaustion',
    apply(matchState) {
      matchState._exhaustion = true;
    },
    tick(matchState) {
      for (const unit of matchState.units) {
        if (unit.stats.moveSpeedMultiplier > 1.0) {
          unit.stats.moveSpeedMultiplier = 1.0;
        }
        if (unit.moveSpeed > 1.0) {
          // Allow natural move speed only for the base (Wraith 1.10 gets capped)
        }
      }
    }
  }
};

/**
 * Select random modifiers for a match
 */
export function selectModifiers(rng, count = 1) {
  const all = Object.values(MODIFIERS);
  const selected = [];
  const pool = [...all];

  // Don't pair conflicting modifiers
  const conflicts = [['mana_tide', 'mana_drought']];

  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(rng.next() * pool.length);
    const mod = pool.splice(idx, 1)[0];
    selected.push(mod);

    // Remove conflicting modifiers from pool
    for (const pair of conflicts) {
      if (pair.includes(mod.id)) {
        const conflictId = pair.find(id => id !== mod.id);
        const conflictIdx = pool.findIndex(m => m.id === conflictId);
        if (conflictIdx !== -1) pool.splice(conflictIdx, 1);
      }
    }
  }

  return selected;
}
