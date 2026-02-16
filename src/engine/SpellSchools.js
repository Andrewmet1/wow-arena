import { SCHOOL } from '../constants.js';

export class SpellSchoolTracker {
  constructor() {
    // Map of school -> tick when lockout expires
    this.lockouts = new Map();
  }

  applyLockout(school, currentTick, durationTicks) {
    if (school === SCHOOL.PHYSICAL) return; // Physical school cannot be locked
    const expiresAt = currentTick + durationTicks;
    const existing = this.lockouts.get(school) || 0;
    if (expiresAt > existing) {
      this.lockouts.set(school, expiresAt);
    }
  }

  isLocked(school, currentTick) {
    if (school === SCHOOL.PHYSICAL) return false;
    const expiresAt = this.lockouts.get(school);
    if (!expiresAt) return false;
    return currentTick < expiresAt;
  }

  getLockoutRemaining(school, currentTick) {
    const expiresAt = this.lockouts.get(school);
    if (!expiresAt || currentTick >= expiresAt) return 0;
    return expiresAt - currentTick;
  }

  tick(currentTick) {
    for (const [school, expiresAt] of this.lockouts) {
      if (currentTick >= expiresAt) {
        this.lockouts.delete(school);
      }
    }
  }

  reset() {
    this.lockouts.clear();
  }
}
