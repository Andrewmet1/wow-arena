// Dynamic ELO with gap-scaled upset bonuses and streak-based loss penalties.
// Wins: K scales linearly from 32 (even match) to 120 (500+ gap upset).
// Losses: K starts at 24 (cushioned first loss) and ramps to 80 (5th+ consecutive loss).

export function calculateEloChange(playerElo, opponentElo, won, opts = {}) {
  const expected = 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
  const actual = won ? 1 : 0;
  const gap = opponentElo - playerElo; // positive = opponent is higher rated

  let K = 32;
  if (won) {
    // Gap-scaled K: ramps linearly with ELO gap for upset rewards
    // 0 gap → K=32, 200 gap → K=72, 400 gap → K=112, 500+ → K=120 (capped)
    K = Math.min(120, 32 + Math.max(0, gap) * 0.2);
  } else {
    // Loss streak penalty: gentle first loss, aggressively ramping
    const lossStreak = Math.abs(Math.min(0, opts.streak || 0));
    if (lossStreak === 0) K = 24;       // 1st loss — cushioned
    else if (lossStreak <= 1) K = 32;   // 2nd loss — normal
    else if (lossStreak <= 2) K = 48;   // 3rd loss — ramping fast
    else if (lossStreak <= 3) K = 64;   // 4th loss — serious
    else K = 80;                         // 5th+ — you don't belong here
  }

  return Math.round(K * (actual - expected));
}

// Challenge (wager duel) match: amplified ELO change, capped at ±150
export function calculateChallengeEloChange(playerElo, opponentElo, won, amplifier, opts = {}) {
  const base = calculateEloChange(playerElo, opponentElo, won, opts);
  return Math.max(-150, Math.min(150, Math.round(base * amplifier)));
}

// 2v2 contribution score: measures individual performance within a team
export function calculateContributionScore(playerStats, teamStats, matchDurationTicks) {
  const damagePct = teamStats.totalDamage > 0 ? playerStats.damage / teamStats.totalDamage : 0.5;
  const ccTimePct = teamStats.totalCCTime > 0 ? playerStats.ccTime / teamStats.totalCCTime : 0.5;
  const survivalPct = matchDurationTicks > 0 ? playerStats.timeAlive / matchDurationTicks : 1;
  const killPart = teamStats.totalKills > 0 ? playerStats.killParticipation / teamStats.totalKills : 0.5;
  return (damagePct * 0.40) + (ccTimePct * 0.20) + (survivalPct * 0.20) + (killPart * 0.20);
}

// 2v2 ELO change with performance-based modifiers
export function calculateTeamEloChange(playerElo, teamAvgElo, enemyAvgElo, won, contributionScore, opts = {}) {
  const expected = 1 / (1 + Math.pow(10, (enemyAvgElo - teamAvgElo) / 400));
  const actual = won ? 1 : 0;
  const gap = enemyAvgElo - teamAvgElo;

  let K = 32;
  if (won) {
    K = Math.min(120, 32 + Math.max(0, gap) * 0.2);
    // MVP bonus: contribution > 0.6 gets 10-15% bonus
    if (contributionScore > 0.6) {
      K *= 1 + (contributionScore - 0.6) * 0.375; // max ~15% at 1.0
    }
  } else {
    // Performance-based loss mitigation
    if (contributionScore > 0.6) {
      K = 20; // Carried hard — cushioned loss (~63% of normal)
    } else if (contributionScore >= 0.4) {
      K = 28; // Even performance — near-normal loss
    } else {
      K = 38; // Weak link — amplified loss (~119% of normal)
    }
    // Streak penalty stacks
    const lossStreak = Math.abs(Math.min(0, opts.streak || 0));
    if (lossStreak >= 4) K *= 1.3;
    else if (lossStreak >= 2) K *= 1.15;
  }

  return Math.round(K * (actual - expected));
}
