/**
 * Base class definition.
 * Each class configures a Unit with stats, resources, abilities, and auto-attacks.
 */
export class ClassBase {
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.description = config.description || '';
    this.color = config.color || '#ffffff'; // Primary class color
    this.accentColor = config.accentColor || '#888888';
    this.isRanged = config.isRanged || false;

    // Base stats
    this.physicalArmor = config.physicalArmor || 0;
    this.magicDR = config.magicDR || 0;
    this.moveSpeed = config.moveSpeed || 1.0;

    // Auto-attack
    this.autoAttackDamage = config.autoAttackDamage || 0;
    this.swingTimer = config.swingTimer || 20; // 2.0s

    // Resource pools: [{ type, max, start, regenPerSecond }]
    this.resourcePools = config.resourcePools || [];

    // Abilities: array of ability definitions
    this.abilities = config.abilities || [];

    // Charged abilities: [{ abilityId, maxCharges, rechargeTicks }]
    this.chargedAbilities = config.chargedAbilities || [];

    // Loadout system
    this.coreAbilityIds = config.coreAbilityIds || [];
    this.defaultLoadout = config.defaultLoadout || [];

    // Class-specific data set on unit.classData
    this.classData = config.classData || {};
  }

  /**
   * Configure a Unit with this class's stats and abilities
   */
  applyToUnit(unit, loadout = null) {
    // Stats
    unit.stats.physicalArmor = this.physicalArmor;
    unit.stats.magicDR = this.magicDR;
    unit.moveSpeed = this.moveSpeed;

    // Auto-attack
    unit.autoAttackDamage = this.autoAttackDamage;
    unit.swingTimer = this.swingTimer;

    // Resources
    for (const pool of this.resourcePools) {
      unit.resources.addPool(pool.type, pool.max, pool.start, pool.regenPerSecond);
    }

    // Abilities
    for (const ability of this.abilities) {
      unit.abilities.set(ability.id, ability);
    }

    // Charged abilities
    for (const charged of this.chargedAbilities) {
      unit.cooldowns.registerChargedAbility(charged.abilityId, charged.maxCharges, charged.rechargeTicks);
    }

    // Store the active loadout (6 abilities for keybinding)
    unit.activeLoadout = loadout || this.defaultLoadout;

    // Class-specific data
    unit.classData = { ...this.classData };

    return unit;
  }

  /**
   * Get ability IDs in keybind order
   */
  getAbilityOrder(loadout = null) {
    const activeLoadout = loadout || this.defaultLoadout;
    if (activeLoadout.length > 0) {
      return activeLoadout;
    }
    // Fallback to slot-based ordering
    return this.abilities
      .filter(a => a.slot > 0)
      .sort((a, b) => a.slot - b.slot)
      .map(a => a.id);
  }

  getFlexAbilities() {
    return this.abilities.filter(a => !this.coreAbilityIds.includes(a.id));
  }
}
