import { Vec3 } from '../utils/Vec3.js';
import { ResourceSystem } from './ResourceSystem.js';
import { CooldownTracker } from './Cooldown.js';
import { SpellSchoolTracker } from './SpellSchools.js';
import { AuraManager } from './AuraManager.js';
import {
  BASE_HP, CLASS_HP, UNIT_STATE, CC_TYPE, DEFAULT_SWING_TIMER,
  MELEE_RANGE, TICKS_PER_SECOND,
  DODGE_ROLL_DURATION, DODGE_ROLL_COOLDOWN, DODGE_ROLL_IMMUNITY
} from '../constants.js';

export class Unit {
  constructor(id, classId, name) {
    this.id = id;
    this.classId = classId;
    this.name = name;

    // Health — per-class HP differentiation
    const classHp = CLASS_HP[classId] || BASE_HP;
    this.maxHp = classHp;
    this.hp = classHp;

    // Position and movement
    this.position = new Vec3();
    this.facing = 0; // radians, 0 = +Z direction
    this.moveSpeed = 1.0; // multiplier
    this.moveTarget = null; // Vec3 or null

    // State
    this.state = UNIT_STATE.IDLE;
    this.alive = true;
    this.inCombat = false;
    this.stealthed = false;

    // Systems
    this.resources = new ResourceSystem();
    this.cooldowns = new CooldownTracker();
    this.spellSchools = new SpellSchoolTracker();
    this.auras = new AuraManager(this);

    // GCD
    this.gcdEndTick = 0;

    // Cast state
    this.castState = null; // { abilityId, startTick, endTick, targetId }
    this.channelState = null; // { abilityId, startTick, endTick, targetId, nextTickAt, tickInterval }
    this.pushbackCount = 0;

    // Auto-attack
    this.autoAttackEnabled = true;
    this.swingTimer = DEFAULT_SWING_TIMER;
    this.nextSwingTick = 0;
    this.autoAttackDamage = 0;

    // CC state
    this.ccEffects = []; // Array of { type, endTick, breakOnDamage, damageThreshold, damageTaken, sourceId }

    // Stats (modifiable by auras/modifiers)
    this.stats = {
      physicalArmor: 0,
      magicDR: 0,
      damageDealtMod: 1.0,
      damageTakenMod: 1.0,
      healingDoneMod: 1.0,
      healingReceivedMod: 1.0,
      critChance: 0.10,
      hasteMultiplier: 1.0,
      moveSpeedMultiplier: 1.0
    };

    // Absorb shields: array of { amount, maxAmount, endTick, sourceAbilityId }
    this.absorbs = [];

    // DR tracking
    this.drTracker = new Map(); // category -> { count, lastAppliedTick }

    // Combat log
    this.totalDamageDealt = 0;
    this.totalDamageTaken = 0;
    this.totalHealingDone = 0;
    this.totalCCTimeInflicted = 0;

    // Abilities registered by class
    this.abilities = new Map(); // abilityId -> ability definition

    // Immunities
    this.immuneToPhysical = false;
    this.immuneToMagic = false;
    this.immuneToCC = false;
    this.immuneToAll = false;
    this.canActWhileImmune = false; // true for Divine Shield, false for Ice Block

    // Dodge roll
    this.dodgeRollState = null; // { startTick, endTick, immunityEndTick, direction }
    this.dodgeRollCooldownEndTick = 0;
    this.dodgeImmune = false;

    // Class-specific data (set by class implementations)
    this.classData = {};
  }

  get isAlive() {
    return this.alive && this.hp > 0;
  }

  get isCasting() {
    return this.castState !== null;
  }

  get isChanneling() {
    return this.channelState !== null;
  }

  get isMoving() {
    return this.moveTarget !== null;
  }

  get isStunned() {
    return this.ccEffects.some(cc => cc.type === CC_TYPE.STUN);
  }

  get isSilenced() {
    return this.ccEffects.some(cc => cc.type === CC_TYPE.SILENCE);
  }

  get isRooted() {
    return this.ccEffects.some(cc => cc.type === CC_TYPE.ROOT);
  }

  get isFeared() {
    return this.ccEffects.some(cc => cc.type === CC_TYPE.FEAR);
  }

  get isIncapacitated() {
    return this.ccEffects.some(cc => cc.type === CC_TYPE.INCAPACITATE);
  }

  get isDodging() {
    return this.dodgeRollState !== null;
  }

  get canAct() {
    if (!this.alive) return false;
    if (this.isStunned || this.isFeared || this.isIncapacitated) return false;
    if (this.immuneToAll && !this.canActWhileImmune) return false; // Ice Block (not Divine Shield)
    return true;
  }

  get canCast() {
    if (!this.canAct) return false;
    if (this.isSilenced) return false;
    return true;
  }

  get canMove() {
    if (!this.alive) return false;
    if (this.isStunned || this.isRooted || this.isFeared || this.isIncapacitated) return false;
    return true;
  }

  get onGCD() {
    return false; // Will be checked against currentTick externally
  }

  isOnGCD(currentTick) {
    return currentTick < this.gcdEndTick;
  }

  startGCD(currentTick, durationTicks) {
    this.gcdEndTick = currentTick + durationTicks;
  }

  getEffectiveMoveSpeed() {
    return this.moveSpeed * this.stats.moveSpeedMultiplier;
  }

  distanceTo(other) {
    return this.position.distanceXZ(other.position);
  }

  isInRange(other, range) {
    return this.distanceTo(other) <= range;
  }

  isInMeleeRange(other) {
    return this.isInRange(other, MELEE_RANGE);
  }

  faceTarget(target) {
    this.facing = this.position.angleTo(target.position);
  }

  applyDamage(amount, school, sourceId, abilityId) {
    if (!this.alive) return 0;
    // Dodge roll immunity
    if (this.dodgeImmune) return 0;
    if (this.immuneToAll) return 0;
    if (this.immuneToPhysical && school === 'physical') return 0;
    if (this.immuneToMagic && school !== 'physical') return 0;

    let remaining = amount;

    // Consume absorb shields first
    for (let i = 0; i < this.absorbs.length && remaining > 0; i++) {
      const absorb = this.absorbs[i];
      const absorbed = Math.min(remaining, absorb.amount);
      absorb.amount -= absorbed;
      remaining -= absorbed;
      if (absorb.amount <= 0) {
        this.absorbs.splice(i, 1);
        i--;
      }
    }

    // Apply remaining to HP
    this.hp = Math.max(0, this.hp - remaining);
    this.totalDamageTaken += amount;

    // Check break-on-damage CC
    this.checkCCBreakOnDamage(remaining);

    if (this.hp <= 0) {
      this.alive = false;
      this.state = UNIT_STATE.DEAD;
    }

    return amount;
  }

  applyHealing(amount) {
    if (!this.alive) return 0;
    const effective = Math.min(amount, this.maxHp - this.hp);
    this.hp += effective;
    this.totalHealingDone += effective;
    return effective;
  }

  addAbsorb(amount, endTick, sourceAbilityId) {
    this.absorbs.push({
      amount,
      maxAmount: amount,
      endTick,
      sourceAbilityId
    });
  }

  checkCCBreakOnDamage(damage) {
    for (let i = this.ccEffects.length - 1; i >= 0; i--) {
      const cc = this.ccEffects[i];
      if (cc.breakOnDamage) {
        cc.damageTaken = (cc.damageTaken || 0) + damage;
        if (cc.damageTaken >= (cc.damageThreshold || 0)) {
          this.ccEffects.splice(i, 1);
        }
      }
    }
  }

  addCC(type, durationTicks, currentTick, sourceId, breakOnDamage = false, damageThreshold = 0) {
    // Remove existing CC of same type
    this.ccEffects = this.ccEffects.filter(cc => cc.type !== type);

    this.ccEffects.push({
      type,
      endTick: currentTick + durationTicks,
      breakOnDamage,
      damageThreshold,
      damageTaken: 0,
      sourceId
    });

    // Cancel casting if stunned/feared/incapacitated
    if (type === CC_TYPE.STUN || type === CC_TYPE.FEAR || type === CC_TYPE.INCAPACITATE) {
      this.cancelCast();
      this.cancelChannel();
    }
  }

  removeCC(type) {
    this.ccEffects = this.ccEffects.filter(cc => cc.type !== type);
  }

  removeAllCC() {
    this.ccEffects = [];
  }

  cancelCast() {
    this.castState = null;
    this.pushbackCount = 0;
  }

  cancelChannel() {
    this.channelState = null;
  }

  tick(currentTick) {
    if (!this.alive) return [];

    // Expire dodge roll
    if (this.dodgeRollState && currentTick >= this.dodgeRollState.endTick) {
      this.dodgeRollState = null;
    }
    // Clear dodge immunity when window ends
    if (this.dodgeImmune && this.dodgeRollState && currentTick >= this.dodgeRollState.immunityEndTick) {
      this.dodgeImmune = false;
    }
    // Also clear immunity if dodge roll state already expired
    if (this.dodgeImmune && !this.dodgeRollState) {
      this.dodgeImmune = false;
    }

    // Tick resources
    this.resources.tick();

    // Tick cooldowns
    this.cooldowns.tick(currentTick);

    // Tick spell school lockouts
    this.spellSchools.tick(currentTick);

    // Tick auras — returns array of auras that ticked (for DoT/HoT processing)
    const tickedAuras = this.auras.tick(currentTick);

    // Expire CC effects
    for (let i = this.ccEffects.length - 1; i >= 0; i--) {
      if (currentTick >= this.ccEffects[i].endTick) {
        this.ccEffects.splice(i, 1);
      }
    }

    // Expire absorb shields
    for (let i = this.absorbs.length - 1; i >= 0; i--) {
      if (this.absorbs[i].endTick && currentTick >= this.absorbs[i].endTick) {
        this.absorbs.splice(i, 1);
      }
    }

    return tickedAuras;
  }

  reset() {
    this.hp = this.maxHp;
    this.alive = true;
    this.state = UNIT_STATE.IDLE;
    this.inCombat = false;
    this.stealthed = false;
    this.position = new Vec3();
    this.facing = 0;
    this.moveTarget = null;
    this.castState = null;
    this.channelState = null;
    this.pushbackCount = 0;
    this.gcdEndTick = 0;
    this.nextSwingTick = 0;
    this.ccEffects = [];
    this.absorbs = [];
    this.drTracker.clear();
    this.resources.reset();
    this.cooldowns.resetAll();
    this.spellSchools.reset();
    this.auras.removeAll();
    this.immuneToPhysical = false;
    this.immuneToMagic = false;
    this.immuneToCC = false;
    this.immuneToAll = false;
    this.dodgeRollState = null;
    this.dodgeRollCooldownEndTick = 0;
    this.dodgeImmune = false;
    this.totalDamageDealt = 0;
    this.totalDamageTaken = 0;
    this.totalHealingDone = 0;
    this.totalCCTimeInflicted = 0;
    this.stats.damageDealtMod = 1.0;
    this.stats.damageTakenMod = 1.0;
    this.stats.healingDoneMod = 1.0;
    this.stats.healingReceivedMod = 1.0;
    this.stats.moveSpeedMultiplier = 1.0;
  }

  serialize() {
    return {
      id: this.id,
      classId: this.classId,
      hp: Math.round(this.hp),
      maxHp: this.maxHp,
      position: this.position.toArray(),
      alive: this.alive,
      state: this.state,
      stealthed: this.stealthed,
      ccEffects: this.ccEffects.map(cc => ({ type: cc.type, endTick: cc.endTick })),
      castState: this.castState ? { abilityId: this.castState.abilityId, progress: 0 } : null,
      channelState: this.channelState ? { abilityId: this.channelState.abilityId } : null,
      resources: {},
      auras: this.auras.serialize()
    };
  }
}
