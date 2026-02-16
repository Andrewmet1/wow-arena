import { runMatch } from './Simulator.js';
import { SeededRandom } from '../utils/Random.js';
import {
  BALANCE_MATCHES_PER_MATCHUP,
  BALANCE_WIN_RATE_TOLERANCE,
  BALANCE_MAX_ITERATIONS,
  BALANCE_ADJUSTMENT_RATE,
  BALANCE_MAX_STAT_DEVIATION
} from '../constants.js';

/**
 * Run balance simulations across all class matchups.
 * Runs synchronously (for use in Web Worker or headless Node.js).
 */
export class BalanceRunner {
  constructor(classDefs) {
    this.classDefs = classDefs; // Array of ClassBase instances
    this.classIds = classDefs.map(c => c.id);
    this.matchesPerMatchup = BALANCE_MATCHES_PER_MATCHUP;
    this.results = [];
  }

  /**
   * Run full matchup matrix
   */
  runFullMatrix(matchesPerMatchup = null, config = {}) {
    const perMatchup = matchesPerMatchup || this.matchesPerMatchup;
    const rng = new SeededRandom(config.seed || 42);
    const matrix = {};

    for (let i = 0; i < this.classDefs.length; i++) {
      for (let j = i; j < this.classDefs.length; j++) {
        const classA = this.classDefs[i];
        const classB = this.classDefs[j];
        const key = `${classA.id}_vs_${classB.id}`;

        let winsA = 0;
        let winsB = 0;
        let totalDuration = 0;
        const matchResults = [];

        for (let m = 0; m < perMatchup; m++) {
          const seed = rng.intRange(0, 2147483647);
          try {
            const result = runMatch(classA, classB, seed, config);
            if (result.winner === classA.id) winsA++;
            else if (result.winner === classB.id) winsB++;
            totalDuration += result.duration;
            matchResults.push(result);
          } catch (e) {
            // Skip errored matches
            console.warn(`Match error (${classA.id} vs ${classB.id}): ${e.message}`);
          }
        }

        const total = winsA + winsB;
        matrix[key] = {
          classA: classA.id,
          classB: classB.id,
          winsA,
          winsB,
          total,
          winRateA: total > 0 ? winsA / total : 0.5,
          winRateB: total > 0 ? winsB / total : 0.5,
          avgDuration: total > 0 ? totalDuration / total : 0,
          isMirror: classA.id === classB.id
        };
      }
    }

    return matrix;
  }

  /**
   * Calculate overall win rates per class
   */
  getOverallWinRates(matrix) {
    const winRates = {};

    for (const classId of this.classIds) {
      let totalWins = 0;
      let totalMatches = 0;

      for (const result of Object.values(matrix)) {
        if (result.isMirror) continue;

        if (result.classA === classId) {
          totalWins += result.winsA;
          totalMatches += result.total;
        } else if (result.classB === classId) {
          totalWins += result.winsB;
          totalMatches += result.total;
        }
      }

      winRates[classId] = totalMatches > 0 ? totalWins / totalMatches : 0.5;
    }

    return winRates;
  }

  /**
   * Check if all matchups are within tolerance
   */
  isBalanced(matrix) {
    for (const result of Object.values(matrix)) {
      if (result.isMirror) continue;
      if (Math.abs(result.winRateA - 0.5) > BALANCE_WIN_RATE_TOLERANCE) {
        return false;
      }
    }
    return true;
  }

  /**
   * Generate a balance report
   */
  generateReport(matrix) {
    const overallWR = this.getOverallWinRates(matrix);
    const report = {
      overallWinRates: overallWR,
      matchupDetails: [],
      imbalances: [],
      isBalanced: this.isBalanced(matrix)
    };

    for (const result of Object.values(matrix)) {
      if (result.isMirror) continue;

      report.matchupDetails.push({
        matchup: `${result.classA} vs ${result.classB}`,
        winRateA: (result.winRateA * 100).toFixed(1) + '%',
        winRateB: (result.winRateB * 100).toFixed(1) + '%',
        avgDuration: result.avgDuration.toFixed(1) + 's',
        total: result.total
      });

      if (Math.abs(result.winRateA - 0.5) > BALANCE_WIN_RATE_TOLERANCE) {
        const favored = result.winRateA > 0.5 ? result.classA : result.classB;
        const rate = Math.max(result.winRateA, result.winRateB);
        report.imbalances.push({
          matchup: `${result.classA} vs ${result.classB}`,
          favored,
          winRate: (rate * 100).toFixed(1) + '%'
        });
      }
    }

    return report;
  }

  /**
   * Print a formatted balance report to console
   */
  printReport(matrix) {
    const report = this.generateReport(matrix);

    console.log('\n=== BALANCE REPORT ===\n');

    console.log('Overall Win Rates:');
    for (const [classId, wr] of Object.entries(report.overallWinRates)) {
      const bar = '='.repeat(Math.round(wr * 50));
      console.log(`  ${classId.padEnd(12)} ${(wr * 100).toFixed(1)}% ${bar}`);
    }

    console.log('\nMatchup Details:');
    for (const detail of report.matchupDetails) {
      console.log(`  ${detail.matchup.padEnd(30)} ${detail.winRateA} / ${detail.winRateB}  (avg ${detail.avgDuration})`);
    }

    if (report.imbalances.length > 0) {
      console.log('\nImbalances (>53% win rate):');
      for (const imb of report.imbalances) {
        console.log(`  ${imb.matchup}: ${imb.favored} at ${imb.winRate}`);
      }
    } else {
      console.log('\nAll matchups within balance tolerance!');
    }

    console.log(`\nBalanced: ${report.isBalanced ? 'YES' : 'NO'}`);
    return report;
  }
}
