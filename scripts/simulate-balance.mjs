#!/usr/bin/env node
/**
 * Headless balance simulation for Ebon Crucible.
 * Runs all 15 matchups (10 unique + 5 mirrors) with N trials each,
 * collects stats, and outputs a formatted balance report.
 *
 * Usage:
 *   node scripts/simulate-balance.mjs                          # all matchups, 200 trials
 *   node scripts/simulate-balance.mjs --trials 500             # more trials
 *   node scripts/simulate-balance.mjs --matchup tyrant,wraith  # single matchup
 *   node scripts/simulate-balance.mjs --verbose                # per-match details
 */

import { MatchState } from '../src/engine/MatchState.js';
import { CombatEngine } from '../src/engine/CombatEngine.js';
import { Unit } from '../src/engine/Unit.js';
import { getClass, CLASS_IDS } from '../src/classes/ClassRegistry.js';
import { AIController } from '../src/ai/AIController.js';
import { EVENTS } from '../src/utils/EventBus.js';
import { CLASS_HP } from '../src/constants.js';

// ── Configuration ──────────────────────────────────────────────────────────
const DEFAULT_TRIALS = 200;
const MAX_TICKS = 6000; // 10 minutes
const AI_DIFFICULTY = 'hard';

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}
const hasFlag = (name) => args.includes(`--${name}`);

const NUM_TRIALS = parseInt(getArg('trials') || DEFAULT_TRIALS, 10);
const FILTER_MATCHUP = getArg('matchup')?.split(',').map(s => s.trim().toLowerCase());
const VERBOSE = hasFlag('verbose');

// ── Matchup Generation ─────────────────────────────────────────────────────
function generateMatchups() {
  const matchups = [];
  for (let i = 0; i < CLASS_IDS.length; i++) {
    for (let j = i; j < CLASS_IDS.length; j++) {
      const pair = [CLASS_IDS[i], CLASS_IDS[j]];
      if (FILTER_MATCHUP) {
        const sorted = [...FILTER_MATCHUP].sort();
        const pairSorted = [...pair].sort();
        if (sorted[0] !== pairSorted[0] || sorted[1] !== pairSorted[1]) continue;
      }
      matchups.push(pair);
    }
  }
  return matchups;
}

// ── Single Match Simulation ────────────────────────────────────────────────
function runMatch(classId1, classId2, seed) {
  const matchState = new MatchState({ seed, maxTicks: MAX_TICKS, isSimulation: true });
  matchState.los.gatesOpen = true; // Open arena gates for movement

  const unit1 = new Unit('p1', classId1, classId1);
  const unit2 = new Unit('p2', classId2, classId2);

  getClass(classId1).applyToUnit(unit1);
  getClass(classId2).applyToUnit(unit2);

  // Starting positions: 30 yards apart inside arena
  unit1.position.x = -15;
  unit1.position.z = 0;
  unit2.position.x = 15;
  unit2.position.z = 0;

  // Wraith starts stealthed
  if (classId1 === 'wraith') unit1.stealthed = true;
  if (classId2 === 'wraith') unit2.stealthed = true;

  matchState.addUnit(unit1);
  matchState.addUnit(unit2);
  matchState.setTarget('p1', 'p2');
  matchState.setTarget('p2', 'p1');

  const engine = new CombatEngine(matchState);
  const ai1 = new AIController('p1', AI_DIFFICULTY);
  const ai2 = new AIController('p2', AI_DIFFICULTY);

  // Damage log for burst analysis
  const damageLog = [];
  const abilityCounts = { p1: {}, p2: {} };

  matchState.eventBus.on(EVENTS.DAMAGE_DEALT, (data) => {
    damageLog.push({
      tick: matchState.tick,
      sourceId: data.sourceId,
      amount: data.amount,
      isCrit: data.isCrit
    });
  });

  matchState.eventBus.on(EVENTS.ABILITY_CAST_SUCCESS, (data) => {
    const counts = abilityCounts[data.sourceId];
    if (counts) counts[data.abilityId] = (counts[data.abilityId] || 0) + 1;

    // Wire up enemy ability tracking for AI cooldown awareness
    if (data.sourceId === 'p1') {
      const ability = unit1.abilities.get(data.abilityId);
      if (ability) ai2.observeEnemyAbility(data.abilityId, ability.cooldown || 0, matchState.tick);
    } else {
      const ability = unit2.abilities.get(data.abilityId);
      if (ability) ai1.observeEnemyAbility(data.abilityId, ability.cooldown || 0, matchState.tick);
    }
  });

  // Run simulation
  matchState.start();
  while (matchState.active && matchState.tick < matchState.maxTicks) {
    ai1.decide(matchState, engine, matchState.tick);
    ai2.decide(matchState, engine, matchState.tick);
    engine.tick();
  }

  // Force check win condition for timeouts
  if (matchState.active) matchState.checkWinCondition();

  // Compute burst windows (max damage in 3s and 6s sliding windows)
  const burst = { p1: { max3s: 0, max6s: 0 }, p2: { max3s: 0, max6s: 0 } };
  for (const unitId of ['p1', 'p2']) {
    const unitDmg = damageLog.filter(d => d.sourceId === unitId);
    for (let i = 0; i < unitDmg.length; i++) {
      let sum3 = 0, sum6 = 0;
      for (let j = i; j < unitDmg.length; j++) {
        const dt = unitDmg[j].tick - unitDmg[i].tick;
        if (dt <= 30) sum3 += unitDmg[j].amount;
        if (dt <= 60) sum6 += unitDmg[j].amount;
        else break;
      }
      if (sum3 > burst[unitId].max3s) burst[unitId].max3s = sum3;
      if (sum6 > burst[unitId].max6s) burst[unitId].max6s = sum6;
    }
  }

  return {
    winnerId: matchState.winner?.id || null,
    winnerClass: matchState.winner?.classId || null,
    duration: matchState.getMatchDuration(),
    timeout: matchState.tick >= matchState.maxTicks,
    p1: {
      classId: classId1,
      damageDealt: unit1.totalDamageDealt,
      damageTaken: unit1.totalDamageTaken,
      healingDone: unit1.totalHealingDone,
      hpRemaining: unit1.hp,
      maxBurst3s: burst.p1.max3s,
      maxBurst6s: burst.p1.max6s,
      abilityCounts: abilityCounts.p1
    },
    p2: {
      classId: classId2,
      damageDealt: unit2.totalDamageDealt,
      damageTaken: unit2.totalDamageTaken,
      healingDone: unit2.totalHealingDone,
      hpRemaining: unit2.hp,
      maxBurst3s: burst.p2.max3s,
      maxBurst6s: burst.p2.max6s,
      abilityCounts: abilityCounts.p2
    }
  };
}

// ── Run All Trials for a Matchup ───────────────────────────────────────────
function runMatchup(classId1, classId2, numTrials) {
  const results = [];
  const isMirror = classId1 === classId2;

  for (let i = 0; i < numTrials; i++) {
    // Deterministic seed
    const seed = hashSeed(classId1, classId2, i);

    // For non-mirrors, alternate sides to eliminate positional bias
    if (!isMirror && i % 2 === 1) {
      const result = runMatch(classId2, classId1, seed);
      // Swap p1/p2 back so classId1 is always "class A"
      results.push({
        ...result,
        winnerId: result.winnerId === 'p1' ? 'p2' : result.winnerId === 'p2' ? 'p1' : null,
        p1: result.p2,
        p2: result.p1
      });
    } else {
      results.push(runMatch(classId1, classId2, seed));
    }
  }
  return results;
}

function hashSeed(a, b, i) {
  let h = 0;
  const s = `${a}_${b}_${i}`;
  for (let j = 0; j < s.length; j++) {
    h = ((h << 5) - h + s.charCodeAt(j)) >>> 0;
  }
  return h || 1;
}

// ── Aggregate Results ──────────────────────────────────────────────────────
function aggregate(classId1, classId2, results) {
  const total = results.length;
  const wins1 = results.filter(r => r.winnerId === 'p1').length;
  const wins2 = results.filter(r => r.winnerId === 'p2').length;
  const timeouts = results.filter(r => r.timeout).length;

  const avg = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

  return {
    classId1,
    classId2,
    isMirror: classId1 === classId2,
    total,
    wins1,
    wins2,
    winRate1: wins1 / total,
    winRate2: wins2 / total,
    timeouts,
    timeoutRate: timeouts / total,
    avgDuration: avg(results.map(r => r.duration)),
    avgDmg1: avg(results.map(r => r.p1.damageDealt)),
    avgDmg2: avg(results.map(r => r.p2.damageDealt)),
    avgHeal1: avg(results.map(r => r.p1.healingDone)),
    avgHeal2: avg(results.map(r => r.p2.healingDone)),
    avgBurst3s_1: avg(results.map(r => r.p1.maxBurst3s)),
    avgBurst3s_2: avg(results.map(r => r.p2.maxBurst3s)),
    avgBurst6s_1: avg(results.map(r => r.p1.maxBurst6s)),
    avgBurst6s_2: avg(results.map(r => r.p2.maxBurst6s))
  };
}

// ── Report Formatting ──────────────────────────────────────────────────────
function printReport(aggregated) {
  const pad = (s, n) => String(s).padStart(n);
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  const fmtK = (v) => `${(v / 1000).toFixed(1)}K`;

  console.log('\n' + '='.repeat(70));
  console.log('  EBON CRUCIBLE BALANCE REPORT');
  console.log('='.repeat(70));
  console.log(`  Trials per matchup: ${NUM_TRIALS} | AI: ${AI_DIFFICULTY} | Max ticks: ${MAX_TICKS}`);
  console.log();

  // ── Win Rate Matrix ──
  console.log('--- WIN RATE MATRIX (row = class A win rate vs column) ---');
  const header = '              ' + CLASS_IDS.map(c => pad(c.slice(0, 8), 10)).join('');
  console.log(header);

  // Build lookup: classA -> classB -> winRate of classA
  const winRateMap = {};
  for (const agg of aggregated) {
    if (!winRateMap[agg.classId1]) winRateMap[agg.classId1] = {};
    if (!winRateMap[agg.classId2]) winRateMap[agg.classId2] = {};
    winRateMap[agg.classId1][agg.classId2] = agg.winRate1;
    if (!agg.isMirror) {
      winRateMap[agg.classId2][agg.classId1] = agg.winRate2;
    }
  }

  for (const rowClass of CLASS_IDS) {
    let row = '  ' + pad(rowClass, 12);
    for (const colClass of CLASS_IDS) {
      if (rowClass === colClass) {
        row += pad('--', 10);
      } else if (winRateMap[rowClass]?.[colClass] !== undefined) {
        const wr = winRateMap[rowClass][colClass];
        const flag = wr > 0.60 ? '*' : wr < 0.40 ? '!' : ' ';
        row += pad(pct(wr) + flag, 10);
      } else {
        row += pad('?', 10);
      }
    }
    console.log(row);
  }
  console.log('  (* = dominant >60%  ! = weak <40%)');
  console.log();

  // ── Overall Power Ranking ──
  console.log('--- OVERALL POWER RANKING (avg win rate across non-mirror matchups) ---');
  const classWinRates = {};
  for (const cls of CLASS_IDS) {
    const rates = [];
    for (const opp of CLASS_IDS) {
      if (cls === opp) continue;
      if (winRateMap[cls]?.[opp] !== undefined) rates.push(winRateMap[cls][opp]);
    }
    classWinRates[cls] = rates.length ? rates.reduce((s, v) => s + v, 0) / rates.length : 0.5;
  }

  const ranked = CLASS_IDS.slice().sort((a, b) => classWinRates[b] - classWinRates[a]);
  for (let i = 0; i < ranked.length; i++) {
    const cls = ranked[i];
    const wr = classWinRates[cls];
    let tag = '';
    if (wr > 0.55) tag = ' << OVERPOWERED';
    else if (wr < 0.45) tag = ' << UNDERPOWERED';
    console.log(`  ${i + 1}. ${pad(cls, 12)} ${pct(wr)} avg win rate${tag}`);
  }
  console.log();

  // ── Burst Analysis ──
  console.log('--- BURST ANALYSIS (avg max damage in 3s / 6s windows) ---');
  const classBurst = {};
  for (const cls of CLASS_IDS) {
    classBurst[cls] = { burst3s: [], burst6s: [] };
  }
  for (const agg of aggregated) {
    classBurst[agg.classId1].burst3s.push(agg.avgBurst3s_1);
    classBurst[agg.classId1].burst6s.push(agg.avgBurst6s_1);
    if (!agg.isMirror) {
      classBurst[agg.classId2].burst3s.push(agg.avgBurst3s_2);
      classBurst[agg.classId2].burst6s.push(agg.avgBurst6s_2);
    }
  }

  const avgEnemyHp = Object.values(CLASS_HP).reduce((s, v) => s + v, 0) / Object.values(CLASS_HP).length;
  for (const cls of CLASS_IDS) {
    const b3 = classBurst[cls].burst3s.reduce((s, v) => s + v, 0) / classBurst[cls].burst3s.length;
    const b6 = classBurst[cls].burst6s.reduce((s, v) => s + v, 0) / classBurst[cls].burst6s.length;
    const p3 = (b3 / avgEnemyHp * 100).toFixed(0);
    const p6 = (b6 / avgEnemyHp * 100).toFixed(0);
    const weak = b3 < avgEnemyHp * 0.20 ? '  << WEAK BURST' : '';
    console.log(`  ${pad(cls, 12)}  3s: ${pad(fmtK(b3), 7)}  6s: ${pad(fmtK(b6), 7)}  (${p3}% / ${p6}% of avg HP)${weak}`);
  }
  console.log();

  // ── Healing/Sustain Analysis ──
  console.log('--- SUSTAIN ANALYSIS (avg healing done per match) ---');
  const classHealing = {};
  const classDmgTaken = {};
  for (const cls of CLASS_IDS) {
    classHealing[cls] = [];
    classDmgTaken[cls] = [];
  }
  for (const agg of aggregated) {
    classHealing[agg.classId1].push(agg.avgHeal1);
    if (!agg.isMirror) classHealing[agg.classId2].push(agg.avgHeal2);
    // Approximate damage taken from opponent's damage dealt
    classDmgTaken[agg.classId1].push(agg.avgDmg2);
    if (!agg.isMirror) classDmgTaken[agg.classId2].push(agg.avgDmg1);
  }
  for (const cls of CLASS_IDS) {
    const heal = classHealing[cls].reduce((s, v) => s + v, 0) / classHealing[cls].length;
    const dmgIn = classDmgTaken[cls].reduce((s, v) => s + v, 0) / classDmgTaken[cls].length;
    const ratio = dmgIn > 0 ? (heal / dmgIn * 100).toFixed(0) : 0;
    console.log(`  ${pad(cls, 12)}  ${pad(fmtK(heal), 8)} healed  (${ratio}% of damage taken)`);
  }
  console.log();

  // ── Timeout Rates ──
  const timeoutMatchups = aggregated.filter(a => !a.isMirror && a.timeoutRate > 0.05);
  if (timeoutMatchups.length > 0) {
    console.log('--- TIMEOUT RATES (>5%) ---');
    for (const a of timeoutMatchups.sort((x, y) => y.timeoutRate - x.timeoutRate)) {
      console.log(`  ${a.classId1} vs ${a.classId2}: ${pct(a.timeoutRate)} timeout (avg duration: ${a.avgDuration.toFixed(1)}s)`);
    }
    console.log();
  }

  // ── Match Duration ──
  console.log('--- AVERAGE MATCH DURATION ---');
  const classDurations = {};
  for (const cls of CLASS_IDS) classDurations[cls] = [];
  for (const agg of aggregated) {
    if (!agg.isMirror) {
      classDurations[agg.classId1].push(agg.avgDuration);
      classDurations[agg.classId2].push(agg.avgDuration);
    }
  }
  for (const cls of CLASS_IDS) {
    const avg = classDurations[cls].reduce((s, v) => s + v, 0) / classDurations[cls].length;
    console.log(`  ${pad(cls, 12)}  ${avg.toFixed(1)}s avg`);
  }
  console.log();

  // ── Flagged Imbalances ──
  console.log('--- FLAGGED IMBALANCES ---');
  const flags = [];
  for (const agg of aggregated) {
    if (agg.isMirror) continue;
    const skew = Math.max(agg.winRate1, agg.winRate2);
    const dominant = agg.winRate1 > agg.winRate2 ? agg.classId1 : agg.classId2;
    const weak = agg.winRate1 > agg.winRate2 ? agg.classId2 : agg.classId1;
    if (skew >= 0.70) {
      flags.push({ severity: 'CRITICAL', dominant, weak, skew, matchup: `${agg.classId1} vs ${agg.classId2}` });
    } else if (skew >= 0.65) {
      flags.push({ severity: 'SEVERE', dominant, weak, skew, matchup: `${agg.classId1} vs ${agg.classId2}` });
    } else if (skew >= 0.60) {
      flags.push({ severity: 'MODERATE', dominant, weak, skew, matchup: `${agg.classId1} vs ${agg.classId2}` });
    }
  }
  flags.sort((a, b) => b.skew - a.skew);
  if (flags.length === 0) {
    console.log('  No imbalances detected (all matchups within 40-60%)');
  }
  for (const f of flags) {
    console.log(`  [${f.severity}] ${f.matchup}: ${pct(f.skew)} -> ${f.dominant} dominates ${f.weak}`);
  }
  console.log();
  console.log('='.repeat(70));
}

// ── Main ───────────────────────────────────────────────────────────────────
function main() {
  const matchups = generateMatchups();
  if (matchups.length === 0) {
    console.error('No matchups found. Check --matchup argument.');
    process.exit(1);
  }

  console.log(`Running ${matchups.length} matchups x ${NUM_TRIALS} trials = ${matchups.length * NUM_TRIALS} total matches...`);
  console.log();

  const allAggregated = [];
  const startTime = Date.now();

  for (const [classId1, classId2] of matchups) {
    const label = classId1 === classId2 ? `${classId1} mirror` : `${classId1} vs ${classId2}`;
    process.stdout.write(`  ${label}...`);

    const matchStart = Date.now();
    const results = runMatchup(classId1, classId2, NUM_TRIALS);
    const agg = aggregate(classId1, classId2, results);
    allAggregated.push(agg);

    const elapsed = ((Date.now() - matchStart) / 1000).toFixed(1);
    const wr = classId1 === classId2 ? '--' : `${(agg.winRate1 * 100).toFixed(0)}/${(agg.winRate2 * 100).toFixed(0)}`;
    console.log(` ${wr}  (${elapsed}s)`);

    if (VERBOSE && !agg.isMirror) {
      console.log(`    Avg duration: ${agg.avgDuration.toFixed(1)}s | Dmg: ${(agg.avgDmg1 / 1000).toFixed(0)}K / ${(agg.avgDmg2 / 1000).toFixed(0)}K | Heal: ${(agg.avgHeal1 / 1000).toFixed(0)}K / ${(agg.avgHeal2 / 1000).toFixed(0)}K`);
      console.log(`    Burst 3s: ${(agg.avgBurst3s_1 / 1000).toFixed(0)}K / ${(agg.avgBurst3s_2 / 1000).toFixed(0)}K | 6s: ${(agg.avgBurst6s_1 / 1000).toFixed(0)}K / ${(agg.avgBurst6s_2 / 1000).toFixed(0)}K`);
    }
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nCompleted in ${totalElapsed}s`);

  printReport(allAggregated);
}

main();
