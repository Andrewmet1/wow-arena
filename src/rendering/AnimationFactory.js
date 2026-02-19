/**
 * AnimationFactory — Per-class AnimationClip generation.
 *
 * These clips target the SkeletonTransfer skeleton, which uses
 * `mixamorigBoneName` naming (NO colon) and identity rest rotations.
 *
 * Zone-based vertex classification means bone weights follow spatial
 * zones (not proximity), so bone rotations produce clean deformation.
 *
 * Models are generated in natural poses with weapons in hand —
 * arm rest values are kept small to preserve the model's original pose.
 */

import {
  AnimationClip,
  QuaternionKeyframeTrack,
  Quaternion,
  Euler,
} from 'three';

// ── Helpers ──────────────────────────────────────────────────────────────────

function euler(xDeg, yDeg, zDeg) {
  const q = new Quaternion().setFromEuler(
    new Euler(xDeg * Math.PI / 180, yDeg * Math.PI / 180, zDeg * Math.PI / 180)
  );
  return [q.x, q.y, q.z, q.w];
}

const ID = [0, 0, 0, 1];

function buildClip(name, duration, times, bonePoses) {
  const tracks = [];
  for (const [bone, poses] of Object.entries(bonePoses)) {
    const values = [];
    for (const q of poses) values.push(...q);
    tracks.push(new QuaternionKeyframeTrack(`${bone}.quaternion`, times, values));
  }
  return new AnimationClip(name, duration, tracks);
}

// ── Arm rest positions ──
// Models are generated in natural combat poses with weapons.
// Small rotations add subtle idle movement without fighting the model's pose.
const L_ARM = euler(0, 0, 3);       // Slight inward relaxation
const R_ARM = euler(0, 0, -3);      // Slight inward relaxation
const L_FORE = euler(-8, 0, 0);     // Left forearm bent slightly inward
const R_FORE = euler(-8, 0, 0);     // Right forearm bent slightly inward


// ═══════════════════════════════════════════════════════════════════════════
// IDLE — Subtle breathing with arms at natural rest
// ═══════════════════════════════════════════════════════════════════════════

function tyrantIdle() {
  return buildClip('idle', 3.0, [0, 0.75, 1.5, 2.25, 3.0], {
    'mixamorigSpine1':       [ID, euler(-1,0,0), ID, euler(1,0,0), ID],
    'mixamorigSpine2':       [ID, euler(-1,0.5,0), ID, euler(1,-0.5,0), ID],
    'mixamorigNeck':         [ID, euler(1,1,0), euler(0,0,0), euler(-1,1,0), ID],
    'mixamorigHead':         [ID, euler(2,2,0), euler(0,-1,0), euler(-1,2,0), ID],
    'mixamorigLeftArm':      [L_ARM, euler(1,0,2), L_ARM, euler(-1,0,4), L_ARM],
    'mixamorigRightArm':     [R_ARM, euler(1,0,-2), R_ARM, euler(-1,0,-4), R_ARM],
    'mixamorigLeftForeArm':  [L_FORE, euler(-9,0,0), L_FORE, euler(-7,0,0), L_FORE],
    'mixamorigRightForeArm': [R_FORE, euler(-9,0,0), R_FORE, euler(-7,0,0), R_FORE],
  });
}

function wraithIdle() {
  // Slightly hunched, alert, arms ready
  return buildClip('idle', 2.5, [0, 0.625, 1.25, 1.875, 2.5], {
    'mixamorigSpine1':       [euler(-2,0,0), euler(-3,0,0), euler(-2,0,0), euler(-1,0,0), euler(-2,0,0)],
    'mixamorigSpine2':       [euler(-3,0,0), euler(-4,1,0), euler(-3,0,0), euler(-2,-1,0), euler(-3,0,0)],
    'mixamorigNeck':         [euler(3,0,0), euler(2,3,0), euler(3,0,0), euler(4,-3,0), euler(3,0,0)],
    'mixamorigHead':         [euler(3,0,0), euler(2,5,0), euler(3,0,0), euler(4,-5,0), euler(3,0,0)],
    'mixamorigLeftArm':      [euler(5,0,2), euler(7,0,0), euler(5,0,2), euler(3,0,4), euler(5,0,2)],
    'mixamorigRightArm':     [euler(5,0,-2), euler(7,0,0), euler(5,0,-2), euler(3,0,-4), euler(5,0,-2)],
    'mixamorigLeftForeArm':  [euler(-12,0,0), euler(-14,0,0), euler(-12,0,0), euler(-10,0,0), euler(-12,0,0)],
    'mixamorigRightForeArm': [euler(-12,0,0), euler(-14,0,0), euler(-12,0,0), euler(-10,0,0), euler(-12,0,0)],
  });
}

function infernalIdle() {
  // Right hand slightly forward, ready to cast
  return buildClip('idle', 3.2, [0, 0.8, 1.6, 2.4, 3.2], {
    'mixamorigSpine1':       [euler(-1,0,0), euler(-2,0.5,0), euler(-1,0,0), euler(0,-0.5,0), euler(-1,0,0)],
    'mixamorigSpine2':       [euler(-2,0,0), euler(-3,1,0), euler(-2,0,0), euler(-1,-1,0), euler(-2,0,0)],
    'mixamorigNeck':         [euler(2,0,0), euler(3,2,0), euler(2,0,0), euler(1,-2,0), euler(2,0,0)],
    'mixamorigHead':         [euler(2,0,0), euler(3,3,0), euler(2,0,0), euler(1,-3,0), euler(2,0,0)],
    'mixamorigLeftArm':      [euler(-5,0,2), euler(-6,0,1), euler(-5,0,2), euler(-4,0,3), euler(-5,0,2)],
    'mixamorigRightArm':     [euler(-8,0,-1), euler(-10,3,1), euler(-8,0,-1), euler(-6,-3,-3), euler(-8,0,-1)],
    'mixamorigLeftForeArm':  [euler(-6,0,0), euler(-8,0,0), euler(-6,0,0), euler(-4,0,0), euler(-6,0,0)],
    'mixamorigRightForeArm': [euler(-10,-5,0), euler(-12,-6,0), euler(-10,-5,0), euler(-8,-4,0), euler(-10,-5,0)],
  });
}

function harbingerIdle() {
  // Menacing, hands slightly forward
  return buildClip('idle', 3.5, [0, 0.875, 1.75, 2.625, 3.5], {
    'mixamorigSpine1':       [euler(-2,0,0), euler(-3,0,0), euler(-2,0,0), euler(-1,0,0), euler(-2,0,0)],
    'mixamorigSpine2':       [euler(-3,0,0), euler(-4,1,0), euler(-3,0,0), euler(-2,-1,0), euler(-3,0,0)],
    'mixamorigNeck':         [euler(-3,0,0), euler(-2,2,0), euler(-3,0,0), euler(-4,-2,0), euler(-3,0,0)],
    'mixamorigHead':         [euler(-5,0,0), euler(-4,3,0), euler(-5,0,0), euler(-6,-3,0), euler(-5,0,0)],
    'mixamorigLeftArm':      [euler(-5,0,2), euler(-7,-2,0), euler(-5,0,2), euler(-3,2,4), euler(-5,0,2)],
    'mixamorigRightArm':     [euler(-5,0,-2), euler(-7,2,0), euler(-5,0,-2), euler(-3,-2,-4), euler(-5,0,-2)],
    'mixamorigLeftForeArm':  [euler(-10,3,0), euler(-12,4,0), euler(-10,3,0), euler(-8,2,0), euler(-10,3,0)],
    'mixamorigRightForeArm': [euler(-10,-3,0), euler(-12,-4,0), euler(-10,-3,0), euler(-8,-2,0), euler(-10,-3,0)],
  });
}

function revenantIdle() {
  // Noble, upright stance
  return buildClip('idle', 3.0, [0, 0.75, 1.5, 2.25, 3.0], {
    'mixamorigSpine1':       [euler(-1,0,0), euler(-2,0,0), euler(-1,0,0), euler(0,0,0), euler(-1,0,0)],
    'mixamorigSpine2':       [euler(-2,0,0), euler(-3,0,0), euler(-2,0,0), euler(-1,0,0), euler(-2,0,0)],
    'mixamorigNeck':         [euler(1,0,0), euler(2,1,0), euler(1,0,0), euler(0,-1,0), euler(1,0,0)],
    'mixamorigHead':         [euler(1,0,0), euler(2,2,0), euler(1,0,0), euler(0,-2,0), euler(1,0,0)],
    'mixamorigLeftArm':      [euler(3,2,3), euler(4,2,2), euler(3,2,3), euler(2,2,4), euler(3,2,3)],
    'mixamorigRightArm':     [euler(3,-2,-3), euler(4,-2,-2), euler(3,-2,-3), euler(2,-2,-4), euler(3,-2,-3)],
    'mixamorigLeftForeArm':  [euler(-8,2,0), euler(-9,2,0), euler(-8,2,0), euler(-7,2,0), euler(-8,2,0)],
    'mixamorigRightForeArm': [euler(-8,-2,0), euler(-9,-2,0), euler(-8,-2,0), euler(-7,-2,0), euler(-8,-2,0)],
  });
}


// ═══════════════════════════════════════════════════════════════════════════
// WALK — Torso twist with arm counter-swing
// ═══════════════════════════════════════════════════════════════════════════

function sharedWalk() {
  return buildClip('walk', 1.0, [0, 0.25, 0.5, 0.75, 1.0], {
    'mixamorigHips':         [euler(2,0,0), euler(1,3,0), euler(2,0,0), euler(1,-3,0), euler(2,0,0)],
    'mixamorigSpine1':       [euler(-2,0,0), euler(-1,-2,0), euler(-2,0,0), euler(-1,2,0), euler(-2,0,0)],
    'mixamorigSpine2':       [euler(-1,0,0), euler(0,-2,0), euler(-1,0,0), euler(0,2,0), euler(-1,0,0)],
    // Arms swing forward/back from rest position
    'mixamorigLeftArm':      [L_ARM, euler(12,0,2), L_ARM, euler(-12,0,5), L_ARM],
    'mixamorigRightArm':     [R_ARM, euler(-12,0,-5), R_ARM, euler(12,0,-2), R_ARM],
    'mixamorigLeftForeArm':  [L_FORE, euler(-14,0,0), L_FORE, euler(-4,0,0), L_FORE],
    'mixamorigRightForeArm': [R_FORE, euler(-4,0,0), R_FORE, euler(-14,0,0), R_FORE],
    // Legs stride
    'mixamorigLeftUpLeg':    [ID, euler(-18,0,1), ID, euler(15,0,1), ID],
    'mixamorigRightUpLeg':   [ID, euler(15,0,-1), ID, euler(-18,0,-1), ID],
    'mixamorigLeftLeg':      [euler(3,0,0), euler(30,0,0), euler(3,0,0), euler(8,0,0), euler(3,0,0)],
    'mixamorigRightLeg':     [euler(3,0,0), euler(8,0,0), euler(3,0,0), euler(30,0,0), euler(3,0,0)],
  });
}


// ═══════════════════════════════════════════════════════════════════════════
// TYRANT — Heavy horizontal sword swing (body twist driven)
// ═══════════════════════════════════════════════════════════════════════════

function tyrantAttack() {
  return buildClip('attack', 0.9, [0, 0.2, 0.45, 0.65, 0.9], {
    'mixamorigHips':         [ID, euler(0,20,0), euler(0,5,0), euler(0,-25,0), ID],
    'mixamorigSpine1':       [ID, euler(0,12,0), euler(0,3,0), euler(0,-15,0), ID],
    'mixamorigSpine2':       [ID, euler(-3,15,0), euler(0,5,0), euler(5,-18,0), ID],
    'mixamorigNeck':         [ID, euler(0,-8,0), ID, euler(0,10,0), ID],
    // Right arm: wind back → swing through
    'mixamorigRightArm':     [R_ARM, euler(-20,15,-10), euler(-15,0,-15), euler(10,-20,-5), R_ARM],
    'mixamorigRightForeArm': [R_FORE, euler(-25,0,0), euler(-20,0,0), euler(-30,0,0), R_FORE],
    // Left arm follows body
    'mixamorigLeftArm':      [L_ARM, euler(-5,5,15), L_ARM, euler(10,-10,12), L_ARM],
    'mixamorigLeftForeArm':  [L_FORE, euler(-20,0,0), euler(-15,0,0), euler(-25,0,0), L_FORE],
    // Step into swing
    'mixamorigRightUpLeg':   [ID, euler(5,0,0), ID, euler(-12,0,0), ID],
    'mixamorigLeftUpLeg':    [ID, euler(-5,0,0), ID, euler(8,0,0), ID],
  });
}

function tyrantCast() {
  // War cry: lean back, arms spread wide
  return buildClip('cast', 1.4, [0, 0.3, 0.6, 1.0, 1.4], {
    'mixamorigHips':         [ID, euler(2,0,0), euler(3,0,0), euler(-1,0,0), ID],
    'mixamorigSpine2':       [ID, euler(-8,0,0), euler(-12,0,0), euler(5,0,0), ID],
    'mixamorigSpine1':       [ID, euler(-5,0,0), euler(-8,0,0), euler(3,0,0), ID],
    'mixamorigNeck':         [ID, euler(-8,0,0), euler(-12,0,0), euler(-3,0,0), ID],
    'mixamorigHead':         [ID, euler(-10,0,0), euler(-15,0,0), euler(-3,0,0), ID],
    // Arms spread and rise
    'mixamorigRightArm':     [R_ARM, euler(-10,0,-10), euler(-15,0,-5), euler(-8,0,-12), R_ARM],
    'mixamorigRightForeArm': [R_FORE, euler(-20,0,0), euler(-25,0,0), euler(-28,0,0), R_FORE],
    'mixamorigLeftArm':      [L_ARM, euler(-10,0,10), euler(-15,0,5), euler(-8,0,12), L_ARM],
    'mixamorigLeftForeArm':  [L_FORE, euler(-20,0,0), euler(-25,0,0), euler(-28,0,0), L_FORE],
  });
}

function tyrantDeath() {
  return buildClip('death', 2.0, [0, 0.4, 0.8, 1.4, 2.0], {
    'mixamorigHips':         [ID, euler(3,0,0), euler(10,0,3), euler(25,0,8), euler(40,0,5)],
    'mixamorigSpine2':       [ID, euler(8,0,3), euler(20,0,8), euler(35,0,5), euler(50,0,0)],
    'mixamorigSpine1':       [ID, euler(5,0,0), euler(12,0,3), euler(22,0,0), euler(32,0,0)],
    'mixamorigNeck':         [ID, euler(5,0,0), euler(15,0,-3), euler(25,0,0), euler(35,0,0)],
    'mixamorigHead':         [ID, euler(8,3,0), euler(15,-3,0), euler(25,0,0), euler(35,0,0)],
    'mixamorigRightArm':     [R_ARM, euler(0,0,-10), euler(5,0,0), euler(8,0,10), euler(10,0,15)],
    'mixamorigLeftArm':      [L_ARM, euler(0,0,10), euler(5,0,0), euler(8,0,-10), euler(10,0,-15)],
    'mixamorigRightUpLeg':   [ID, euler(-12,0,0), euler(-35,0,0), euler(-55,0,0), euler(-60,0,0)],
    'mixamorigLeftUpLeg':    [ID, euler(-12,0,0), euler(-35,0,0), euler(-55,0,0), euler(-60,0,0)],
    'mixamorigRightLeg':     [ID, euler(18,0,0), euler(50,0,0), euler(70,0,0), euler(80,0,0)],
    'mixamorigLeftLeg':      [ID, euler(18,0,0), euler(50,0,0), euler(70,0,0), euler(80,0,0)],
  });
}


// ═══════════════════════════════════════════════════════════════════════════
// WRAITH — Fast dual slash: body twists quickly
// ═══════════════════════════════════════════════════════════════════════════

function wraithAttack() {
  const LA = euler(5,0,2);  // wraith's arm rest (pre-deformed)
  const RA = euler(5,0,-2);
  return buildClip('attack', 0.5, [0, 0.1, 0.2, 0.35, 0.5], {
    'mixamorigHips':         [ID, euler(0,18,0), euler(0,-18,0), euler(0,10,0), ID],
    'mixamorigSpine2':       [ID, euler(0,20,0), euler(0,-20,0), euler(3,12,0), ID],
    'mixamorigSpine1':       [ID, euler(0,12,0), euler(0,-12,0), euler(2,6,0), ID],
    'mixamorigRightArm':     [RA, euler(-15,-15,-8), euler(0,8,-14), euler(-20,-8,-5), RA],
    'mixamorigRightForeArm': [euler(-20,0,0), euler(-30,0,0), euler(-15,0,0), euler(-32,0,0), euler(-20,0,0)],
    'mixamorigLeftArm':      [LA, euler(0,8,10), euler(-15,15,5), euler(-5,0,14), LA],
    'mixamorigLeftForeArm':  [euler(-20,0,0), euler(-18,0,0), euler(-32,0,0), euler(-22,0,0), euler(-20,0,0)],
    'mixamorigRightUpLeg':   [ID, euler(-8,3,0), euler(5,-3,0), euler(-10,3,0), ID],
    'mixamorigLeftUpLeg':    [ID, euler(5,-3,0), euler(-8,3,0), euler(3,-3,0), ID],
  });
}

function wraithCast() {
  const LA = euler(5,0,2);
  const RA = euler(5,0,-2);
  return buildClip('cast', 0.9, [0, 0.2, 0.45, 0.7, 0.9], {
    'mixamorigHips':         [ID, euler(5,0,0), euler(8,0,0), euler(3,0,0), ID],
    'mixamorigSpine2':       [ID, euler(10,0,0), euler(15,0,0), euler(8,0,0), ID],
    'mixamorigSpine1':       [ID, euler(6,0,0), euler(10,0,0), euler(5,0,0), ID],
    'mixamorigNeck':         [ID, euler(-5,0,0), euler(-3,0,0), euler(-2,0,0), ID],
    'mixamorigRightArm':     [RA, euler(-10,0,-8), euler(-18,-10,-3), euler(-8,5,-12), RA],
    'mixamorigRightForeArm': [euler(-20,0,0), euler(-28,0,0), euler(-32,0,0), euler(-25,0,0), euler(-20,0,0)],
    'mixamorigLeftArm':      [LA, euler(-10,0,8), euler(-18,10,3), euler(-8,-5,12), LA],
    'mixamorigLeftForeArm':  [euler(-20,0,0), euler(-28,0,0), euler(-32,0,0), euler(-25,0,0), euler(-20,0,0)],
    'mixamorigRightUpLeg':   [ID, euler(-10,0,0), euler(-15,0,0), euler(-8,0,0), ID],
    'mixamorigLeftUpLeg':    [ID, euler(-10,0,0), euler(-15,0,0), euler(-8,0,0), ID],
    'mixamorigRightLeg':     [ID, euler(15,0,0), euler(22,0,0), euler(10,0,0), ID],
    'mixamorigLeftLeg':      [ID, euler(15,0,0), euler(22,0,0), euler(10,0,0), ID],
  });
}

function wraithDeath() {
  return buildClip('death', 1.3, [0, 0.25, 0.5, 0.85, 1.3], {
    'mixamorigHips':         [ID, euler(5,0,3), euler(12,0,15), euler(28,0,25), euler(40,0,35)],
    'mixamorigSpine2':       [ID, euler(5,0,10), euler(15,0,25), euler(35,0,35), euler(50,0,45)],
    'mixamorigSpine1':       [ID, euler(3,0,6), euler(8,0,15), euler(22,0,22), euler(32,0,28)],
    'mixamorigNeck':         [ID, euler(3,5,3), euler(12,10,10), euler(22,5,15), euler(30,0,20)],
    'mixamorigHead':         [ID, euler(0,8,5), euler(10,12,12), euler(20,5,20), euler(28,0,25)],
    'mixamorigRightArm':     [R_ARM, euler(0,0,-10), euler(5,0,0), euler(8,0,10), euler(10,0,15)],
    'mixamorigLeftArm':      [L_ARM, euler(0,0,10), euler(5,0,0), euler(8,0,-10), euler(10,0,-15)],
    'mixamorigRightUpLeg':   [ID, euler(-10,0,0), euler(-25,0,2), euler(-40,0,5), euler(-50,0,3)],
    'mixamorigLeftUpLeg':    [ID, euler(-5,0,0), euler(-12,0,-2), euler(-25,0,-5), euler(-35,0,-3)],
    'mixamorigRightLeg':     [ID, euler(15,0,0), euler(30,0,0), euler(50,0,0), euler(60,0,0)],
    'mixamorigLeftLeg':      [ID, euler(10,0,0), euler(25,0,0), euler(38,0,0), euler(45,0,0)],
  });
}


// ═══════════════════════════════════════════════════════════════════════════
// INFERNAL — Fire bolt thrust, grand cast channeling
// ═══════════════════════════════════════════════════════════════════════════

function infernalAttack() {
  const LA = euler(-5,0,2);
  const RA = euler(-8,0,-1);
  return buildClip('attack', 0.65, [0, 0.15, 0.32, 0.5, 0.65], {
    'mixamorigHips':         [ID, euler(0,10,0), euler(0,-5,0), euler(0,-2,0), ID],
    'mixamorigSpine2':       [ID, euler(-3,12,0), euler(5,-8,0), euler(2,-2,0), ID],
    'mixamorigSpine1':       [ID, euler(-2,8,0), euler(3,-5,0), euler(1,0,0), ID],
    // Right hand thrusts forward
    'mixamorigRightArm':     [RA, euler(-25,10,-8), euler(-30,-8,-5), euler(-20,0,-12), RA],
    'mixamorigRightForeArm': [euler(-18,-5,0), euler(-28,0,0), euler(-12,0,0), euler(-20,0,0), euler(-18,-5,0)],
    // Left hand guards
    'mixamorigLeftArm':      [LA, euler(-10,0,14), euler(-18,5,10), euler(-10,0,16), LA],
    'mixamorigLeftForeArm':  [euler(-12,0,0), euler(-20,0,0), euler(-25,0,0), euler(-15,0,0), euler(-12,0,0)],
  });
}

function infernalCast() {
  const LA = euler(-5,0,2);
  const RA = euler(-8,0,-1);
  return buildClip('cast', 1.8, [0, 0.4, 0.8, 1.3, 1.8], {
    'mixamorigHips':         [ID, euler(2,0,0), euler(3,0,0), euler(2,0,0), ID],
    'mixamorigSpine2':       [ID, euler(-6,0,0), euler(-10,0,0), euler(-6,0,0), ID],
    'mixamorigSpine1':       [ID, euler(-4,0,0), euler(-6,0,0), euler(-4,0,0), ID],
    'mixamorigNeck':         [ID, euler(-6,0,0), euler(-10,0,0), euler(-4,0,0), ID],
    'mixamorigHead':         [ID, euler(-8,0,0), euler(-12,0,0), euler(-5,0,0), ID],
    // Both arms forward channeling
    'mixamorigRightArm':     [RA, euler(-25,0,-6), euler(-32,0,-3), euler(-25,0,-6), RA],
    'mixamorigRightForeArm': [euler(-18,-5,0), euler(-22,-12,0), euler(-18,-18,0), euler(-22,-12,0), euler(-18,-5,0)],
    'mixamorigLeftArm':      [LA, euler(-25,0,6), euler(-32,0,3), euler(-25,0,6), LA],
    'mixamorigLeftForeArm':  [euler(-12,0,0), euler(-22,12,0), euler(-18,18,0), euler(-22,12,0), euler(-12,0,0)],
  });
}

function infernalDeath() {
  return buildClip('death', 2.0, [0, 0.4, 0.8, 1.4, 2.0], {
    'mixamorigHips':         [ID, euler(-3,0,0), euler(-8,0,2), euler(-18,0,0), euler(-28,0,0)],
    'mixamorigSpine2':       [ID, euler(-8,0,0), euler(-18,0,3), euler(-30,0,0), euler(-40,0,0)],
    'mixamorigSpine1':       [ID, euler(-5,0,0), euler(-12,0,0), euler(-22,0,0), euler(-28,0,0)],
    'mixamorigNeck':         [ID, euler(-10,0,3), euler(-20,0,0), euler(-30,5,0), euler(-35,0,0)],
    'mixamorigHead':         [ID, euler(-8,5,0), euler(-15,0,5), euler(-25,0,0), euler(-30,0,0)],
    'mixamorigRightArm':     [R_ARM, euler(-5,0,-10), euler(0,0,0), euler(5,0,10), euler(10,0,15)],
    'mixamorigLeftArm':      [L_ARM, euler(-5,0,10), euler(0,0,0), euler(5,0,-10), euler(10,0,-15)],
    'mixamorigRightUpLeg':   [ID, euler(5,0,-2), euler(12,0,-3), euler(-5,0,-2), euler(-12,0,0)],
    'mixamorigLeftUpLeg':    [ID, euler(5,0,2), euler(12,0,3), euler(-5,0,2), euler(-12,0,0)],
    'mixamorigRightLeg':     [ID, euler(8,0,0), euler(18,0,0), euler(40,0,0), euler(55,0,0)],
    'mixamorigLeftLeg':      [ID, euler(8,0,0), euler(18,0,0), euler(40,0,0), euler(55,0,0)],
  });
}


// ═══════════════════════════════════════════════════════════════════════════
// HARBINGER — Shadow bolt: channel then fire
// ═══════════════════════════════════════════════════════════════════════════

function harbingerAttack() {
  const LA = euler(-5,0,2);
  const RA = euler(-5,0,-2);
  return buildClip('attack', 0.8, [0, 0.18, 0.4, 0.6, 0.8], {
    'mixamorigHips':         [ID, euler(0,8,0), euler(0,-3,0), euler(0,-1,0), ID],
    'mixamorigSpine2':       [ID, euler(-2,12,0), euler(5,-6,0), euler(2,-2,0), ID],
    'mixamorigSpine1':       [ID, euler(-1,8,0), euler(3,-4,0), euler(1,0,0), ID],
    // Right hand channels then fires
    'mixamorigRightArm':     [RA, euler(-22,10,-8), euler(-28,-5,-5), euler(-18,0,-12), RA],
    'mixamorigRightForeArm': [euler(-18,-3,0), euler(-28,-8,0), euler(-12,0,0), euler(-18,-3,0), euler(-18,-3,0)],
    // Left hand supports
    'mixamorigLeftArm':      [LA, euler(-15,0,12), euler(-22,8,6), euler(-12,0,14), LA],
    'mixamorigLeftForeArm':  [euler(-18,3,0), euler(-25,0,0), euler(-30,0,0), euler(-22,0,0), euler(-18,3,0)],
  });
}

function harbingerCast() {
  const LA = euler(-5,0,2);
  const RA = euler(-5,0,-2);
  return buildClip('cast', 2.0, [0, 0.5, 1.0, 1.5, 2.0], {
    'mixamorigHips':         [ID, euler(3,0,0), euler(2,3,0), euler(3,-3,0), ID],
    'mixamorigSpine2':       [ID, euler(5,0,0), euler(3,6,0), euler(5,-6,0), ID],
    'mixamorigSpine1':       [ID, euler(3,0,0), euler(2,3,0), euler(3,-3,0), ID],
    'mixamorigNeck':         [ID, euler(-8,0,0), euler(-6,5,0), euler(-8,-5,0), ID],
    'mixamorigHead':         [ID, euler(-10,0,0), euler(-8,8,0), euler(-10,-8,0), ID],
    // Both arms forward channeling
    'mixamorigRightArm':     [RA, euler(-22,0,-8), euler(-25,6,-8), euler(-22,-6,-8), RA],
    'mixamorigRightForeArm': [euler(-18,-3,0), euler(-12,-8,0), euler(-18,-3,0), euler(-12,-8,0), euler(-18,-3,0)],
    'mixamorigLeftArm':      [LA, euler(-22,0,8), euler(-25,-6,8), euler(-22,6,8), LA],
    'mixamorigLeftForeArm':  [euler(-18,3,0), euler(-12,8,0), euler(-18,3,0), euler(-12,8,0), euler(-18,3,0)],
  });
}

function harbingerDeath() {
  return buildClip('death', 2.0, [0, 0.5, 1.0, 1.5, 2.0], {
    'mixamorigHips':         [ID, euler(-3,0,0), euler(0,0,3), euler(15,0,2), euler(32,0,0)],
    'mixamorigSpine2':       [ID, euler(-8,0,0), euler(-3,0,6), euler(20,0,3), euler(42,0,0)],
    'mixamorigSpine1':       [ID, euler(-5,0,0), euler(-1,0,3), euler(12,0,0), euler(28,0,0)],
    'mixamorigNeck':         [ID, euler(-15,0,0), euler(-8,0,5), euler(12,5,3), euler(25,0,0)],
    'mixamorigHead':         [ID, euler(-18,0,0), euler(-10,5,0), euler(8,0,5), euler(22,0,0)],
    'mixamorigRightArm':     [R_ARM, euler(-8,0,-10), euler(-3,0,0), euler(3,0,8), euler(8,0,12)],
    'mixamorigLeftArm':      [L_ARM, euler(-8,0,10), euler(-3,0,0), euler(3,0,-8), euler(8,0,-12)],
    'mixamorigRightUpLeg':   [ID, euler(-8,0,0), euler(-20,0,2), euler(-40,0,2), euler(-55,0,0)],
    'mixamorigLeftUpLeg':    [ID, euler(-8,0,0), euler(-20,0,-2), euler(-40,0,-2), euler(-55,0,0)],
    'mixamorigRightLeg':     [ID, euler(12,0,0), euler(30,0,0), euler(55,0,0), euler(75,0,0)],
    'mixamorigLeftLeg':      [ID, euler(12,0,0), euler(30,0,0), euler(55,0,0), euler(75,0,0)],
  });
}


// ═══════════════════════════════════════════════════════════════════════════
// REVENANT — Shield bash + mace swing
// ═══════════════════════════════════════════════════════════════════════════

function revenantAttack() {
  const LA = euler(3,2,3);
  const RA = euler(3,-2,-3);
  return buildClip('attack', 0.85, [0, 0.2, 0.42, 0.62, 0.85], {
    'mixamorigHips':         [ID, euler(0,15,0), ID, euler(0,-18,0), ID],
    'mixamorigSpine2':       [ID, euler(3,18,0), ID, euler(-3,-20,0), ID],
    'mixamorigSpine1':       [ID, euler(2,10,0), ID, euler(-2,-12,0), ID],
    // Left arm: shield bash forward
    'mixamorigLeftArm':      [LA, euler(-15,10,10), euler(-3,0,16), euler(-3,0,16), LA],
    'mixamorigLeftForeArm':  [euler(-14,2,0), euler(-25,0,0), euler(-18,0,0), euler(-20,0,0), euler(-14,2,0)],
    // Right arm: mace swings across
    'mixamorigRightArm':     [RA, euler(-8,5,-14), euler(-10,0,-14), euler(-18,-12,-5), RA],
    'mixamorigRightForeArm': [euler(-14,-2,0), euler(-20,0,0), euler(-22,0,0), euler(-30,0,0), euler(-14,-2,0)],
    'mixamorigRightUpLeg':   [ID, euler(-8,0,0), ID, euler(5,0,0), ID],
    'mixamorigLeftUpLeg':    [ID, euler(5,0,0), ID, euler(-5,0,0), ID],
  });
}

function revenantCast() {
  const LA = euler(3,2,3);
  const RA = euler(3,-2,-3);
  return buildClip('cast', 1.6, [0, 0.35, 0.8, 1.2, 1.6], {
    'mixamorigHips':         [ID, euler(2,0,0), euler(3,0,0), euler(2,0,0), ID],
    'mixamorigSpine2':       [ID, euler(-8,0,0), euler(-12,0,0), euler(-8,0,0), ID],
    'mixamorigSpine1':       [ID, euler(-5,0,0), euler(-8,0,0), euler(-5,0,0), ID],
    'mixamorigNeck':         [ID, euler(-8,0,0), euler(-14,0,0), euler(-6,0,0), ID],
    'mixamorigHead':         [ID, euler(-10,0,0), euler(-16,0,0), euler(-8,0,0), ID],
    // Arms raised in prayer
    'mixamorigRightArm':     [RA, euler(-22,0,-10), euler(-28,0,-5), euler(-22,0,-10), RA],
    'mixamorigRightForeArm': [euler(-14,-2,0), euler(-22,-12,0), euler(-18,-18,0), euler(-22,-12,0), euler(-14,-2,0)],
    'mixamorigLeftArm':      [LA, euler(-22,0,10), euler(-28,0,5), euler(-22,0,10), LA],
    'mixamorigLeftForeArm':  [euler(-14,2,0), euler(-22,12,0), euler(-18,18,0), euler(-22,12,0), euler(-14,2,0)],
  });
}

function revenantDeath() {
  return buildClip('death', 2.0, [0, 0.5, 1.0, 1.5, 2.0], {
    'mixamorigHips':         [ID, euler(2,0,0), euler(6,0,4), euler(18,0,10), euler(28,0,15)],
    'mixamorigSpine2':       [ID, euler(3,0,0), euler(8,0,8), euler(25,0,18), euler(38,0,25)],
    'mixamorigSpine1':       [ID, euler(2,0,0), euler(5,0,4), euler(16,0,10), euler(25,0,15)],
    'mixamorigNeck':         [ID, euler(-5,0,3), euler(5,5,5), euler(18,0,12), euler(25,0,15)],
    'mixamorigHead':         [ID, euler(-8,0,0), euler(3,8,3), euler(15,0,8), euler(22,0,12)],
    'mixamorigRightArm':     [R_ARM, euler(-3,0,-12), euler(0,0,-5), euler(5,0,2), euler(8,0,8)],
    'mixamorigLeftArm':      [L_ARM, euler(-8,0,12), euler(-5,0,5), euler(-3,0,-2), euler(3,0,-5)],
    'mixamorigRightUpLeg':   [ID, euler(-25,0,-2), euler(-45,0,-3), euler(-52,0,-3), euler(-55,0,-2)],
    'mixamorigLeftUpLeg':    [ID, euler(-25,0,2), euler(-45,0,2), euler(-38,0,3), euler(-35,0,3)],
    'mixamorigRightLeg':     [ID, euler(30,0,0), euler(55,0,0), euler(65,0,0), euler(70,0,0)],
    'mixamorigLeftLeg':      [ID, euler(30,0,0), euler(50,0,0), euler(45,0,0), euler(42,0,0)],
  });
}


// ═══════════════════════════════════════════════════════════════════════════
// SHARED — stun, roll, hit, fear
// ═══════════════════════════════════════════════════════════════════════════

function sharedRoll() {
  return buildClip('roll', 0.6, [0, 0.08, 0.16, 0.28, 0.42, 0.52, 0.6], {
    'mixamorigHips':         [ID, euler(35,0,0), euler(70,0,0), euler(110,0,0), euler(70,0,0), euler(25,0,0), ID],
    'mixamorigSpine1':       [ID, euler(20,0,0), euler(40,0,0), euler(50,0,0), euler(35,0,0), euler(12,0,0), ID],
    'mixamorigSpine2':       [ID, euler(25,0,0), euler(45,0,0), euler(55,0,0), euler(38,0,0), euler(15,0,0), ID],
    'mixamorigNeck':         [ID, euler(15,0,0), euler(22,0,0), euler(15,0,0), euler(5,0,0), euler(-3,0,0), ID],
    'mixamorigHead':         [ID, euler(12,0,0), euler(18,0,0), euler(12,0,0), euler(3,0,0), euler(-3,0,0), ID],
    'mixamorigRightUpLeg':   [ID, euler(-50,0,0), euler(-80,0,0), euler(-65,0,0), euler(-30,0,0), euler(-10,0,0), ID],
    'mixamorigLeftUpLeg':    [ID, euler(-50,0,0), euler(-80,0,0), euler(-65,0,0), euler(-30,0,0), euler(-10,0,0), ID],
    'mixamorigRightLeg':     [ID, euler(60,0,0), euler(90,0,0), euler(80,0,0), euler(40,0,0), euler(12,0,0), ID],
    'mixamorigLeftLeg':      [ID, euler(60,0,0), euler(90,0,0), euler(80,0,0), euler(40,0,0), euler(12,0,0), ID],
    // Arms tuck in during roll
    'mixamorigRightArm':     [R_ARM, euler(-5,0,-10), euler(0,0,-5), euler(2,0,0), euler(0,0,-8), euler(2,0,-15), R_ARM],
    'mixamorigLeftArm':      [L_ARM, euler(-5,0,10), euler(0,0,5), euler(2,0,0), euler(0,0,8), euler(2,0,15), L_ARM],
  });
}

function sharedStun() {
  return buildClip('stun', 2.0, [0, 0.5, 1.0, 1.5, 2.0], {
    'mixamorigHips':         [ID, euler(2,3,2), euler(-2,-3,-2), euler(2,3,2), ID],
    'mixamorigSpine2':       [ID, euler(8,5,3), euler(5,-6,-3), euler(8,3,5), ID],
    'mixamorigSpine1':       [ID, euler(5,3,2), euler(3,-3,-2), euler(5,2,3), ID],
    'mixamorigNeck':         [ID, euler(6,-6,5), euler(3,8,-5), euler(6,-3,6), ID],
    'mixamorigHead':         [ID, euler(10,-10,6), euler(6,12,-6), euler(10,-6,8), ID],
    'mixamorigRightArm':     [R_ARM, euler(3,0,-15), euler(0,0,-18), euler(3,0,-15), R_ARM],
    'mixamorigLeftArm':      [L_ARM, euler(0,0,18), euler(3,0,15), euler(0,0,18), L_ARM],
  });
}

function sharedHit() {
  return buildClip('hit', 0.4, [0, 0.07, 0.18, 0.3, 0.4], {
    'mixamorigHips':         [ID, euler(-5,0,0), euler(-3,0,0), euler(-1,0,0), ID],
    'mixamorigSpine2':       [ID, euler(-10,0,3), euler(-6,0,1), euler(-2,0,0), ID],
    'mixamorigSpine1':       [ID, euler(-6,0,2), euler(-4,0,0), euler(-1,0,0), ID],
    'mixamorigNeck':         [ID, euler(10,3,0), euler(6,0,0), euler(2,0,0), ID],
    'mixamorigHead':         [ID, euler(12,5,0), euler(8,0,0), euler(3,0,0), ID],
    'mixamorigRightArm':     [R_ARM, euler(3,0,-15), euler(5,0,-17), euler(5,0,-18), R_ARM],
    'mixamorigLeftArm':      [L_ARM, euler(3,0,15), euler(5,0,17), euler(5,0,18), L_ARM],
  });
}

function sharedFear() {
  return buildClip('fear', 1.5, [0, 0.3, 0.6, 1.0, 1.5], {
    'mixamorigHips':         [ID, euler(4,2,1), euler(3,-2,-1), euler(4,1,2), ID],
    'mixamorigSpine2':       [ID, euler(10,3,2), euler(8,-3,-2), euler(10,2,3), ID],
    'mixamorigSpine1':       [ID, euler(7,2,1), euler(5,-2,-1), euler(7,1,2), ID],
    'mixamorigNeck':         [ID, euler(-5,5,3), euler(-3,-5,-3), euler(-5,3,5), ID],
    'mixamorigHead':         [ID, euler(-8,8,3), euler(-5,-8,-3), euler(-8,5,5), ID],
    // Arms guard face
    'mixamorigRightArm':     [R_ARM, euler(-15,0,-10), euler(-13,-3,-12), euler(-15,3,-10), R_ARM],
    'mixamorigRightForeArm': [R_FORE, euler(-25,0,0), euler(-28,3,0), euler(-25,-3,0), R_FORE],
    'mixamorigLeftArm':      [L_ARM, euler(-15,0,10), euler(-13,3,12), euler(-15,-3,10), L_ARM],
    'mixamorigLeftForeArm':  [L_FORE, euler(-25,0,0), euler(-28,-3,0), euler(-25,3,0), L_FORE],
    'mixamorigRightUpLeg':   [ID, euler(-6,2,0), euler(-5,-2,0), euler(-6,1,0), ID],
    'mixamorigLeftUpLeg':    [ID, euler(-6,-2,0), euler(-5,2,0), euler(-6,-1,0), ID],
  });
}


// ─── Public API ──────────────────────────────────────────────────────────

export function getClassAnimations(classId) {
  const id = classId.toLowerCase();
  const shared = [sharedWalk(), sharedStun(), sharedRoll(), sharedHit(), sharedFear()];

  switch (id) {
    case 'tyrant':
      return [tyrantIdle(), tyrantAttack(), tyrantCast(), tyrantDeath(), ...shared];
    case 'wraith':
      return [wraithIdle(), wraithAttack(), wraithCast(), wraithDeath(), ...shared];
    case 'infernal':
      return [infernalIdle(), infernalAttack(), infernalCast(), infernalDeath(), ...shared];
    case 'harbinger':
      return [harbingerIdle(), harbingerAttack(), harbingerCast(), harbingerDeath(), ...shared];
    case 'revenant':
      return [revenantIdle(), revenantAttack(), revenantCast(), revenantDeath(), ...shared];
    default:
      return [tyrantIdle(), tyrantAttack(), tyrantCast(), tyrantDeath(), ...shared];
  }
}
