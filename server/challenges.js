import OpenAI from 'openai';
import * as db from './db.js';

// Lazy-init OpenAI client (avoids crash if key not yet set)
let _openai = null;
function getOpenAI() {
  if (!_openai) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

const CHALLENGE_TEMPLATES = ['class_wins', 'total_wins', 'win_streak', 'class_variety', 'underdog'];
const MIN_JACKPOT = 500;
const MAX_JACKPOT_SPEND_RATE = 0.10; // 10% of jackpot per week
const CLASS_IDS = ['tyrant', 'wraith', 'infernal', 'harbinger', 'revenant'];

// ── Weekly Metrics ──────────────────────────────────────────────

export async function collectWeeklyMetrics() {
  const oneWeekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  // Scan recent match records
  const matches = await db.scanRecentMatches(oneWeekAgo);

  const activePlayers = new Set();
  const classPicks = { tyrant: 0, wraith: 0, infernal: 0, harbinger: 0, revenant: 0 };

  for (const m of matches) {
    if (m.playerSub) activePlayers.add(m.playerSub);
    if (m.winnerClass && classPicks[m.winnerClass] !== undefined) classPicks[m.winnerClass]++;
    if (m.loserClass && classPicks[m.loserClass] !== undefined) classPicks[m.loserClass]++;
  }

  const totalMatches = matches.length;
  const activeCount = activePlayers.size || 1;
  const avgMatchesPerPlayer = Math.round((totalMatches / activeCount) * 10) / 10;

  // Total class appearances for percentages
  const totalPicks = Object.values(classPicks).reduce((a, b) => a + b, 0) || 1;
  const classPickRates = {};
  for (const [cls, count] of Object.entries(classPicks)) {
    classPickRates[cls] = Math.round((count / totalPicks) * 100);
  }

  // Jackpot
  const jackpot = await db.getJackpot();
  const jackpotSize = jackpot.total || 0;

  // Champion tenure
  const champions = await db.getAllClassChampions();
  const championTenure = {};
  for (const [classId, champ] of Object.entries(champions || {})) {
    if (champ?.reignStarted) {
      const days = Math.round((Date.now() - new Date(champ.reignStarted).getTime()) / 86400000);
      championTenure[classId] = `${days}d`;
    }
  }

  // Previous week completion rates
  const prevWeek = await getPreviousWeekArchive();
  const prevCompletionRate = prevWeek?.completionRate || null;

  return {
    activePlayers: activeCount,
    totalMatches,
    avgMatchesPerPlayer,
    classPicks: classPickRates,
    jackpotSize,
    budget: Math.floor(jackpotSize * MAX_JACKPOT_SPEND_RATE),
    championTenure,
    previousCompletionRate: prevCompletionRate,
  };
}

// ── OpenAI Challenge Generation ─────────────────────────────────

const SYSTEM_PROMPT = `You are the Crucible Game Director for Ebon Crucible, a dark fantasy 1v1 arena game with 5 classes: Tyrant, Wraith, Infernal, Harbinger, and Revenant.

Your job: create 2-4 weekly challenges that keep the game healthy.

RULES:
- Total rewards across ALL challenges MUST NOT exceed the budget provided
- Rewards per challenge: 50-200 coins (most should be 50-100)
- Pick challenge types from the provided template list ONLY
- Prioritize: underplayed classes, low activity periods, variety
- If activity is already high and balanced, create FUN challenges not desperate ones
- Never create challenges that are impossible or trivially easy
- Win thresholds: 3-10 for class-specific, 10-20 for general
- Streak thresholds: 3-5 (never higher)
- Variety thresholds: 2-4 different classes
- Underdog ELO gap: 100-200

Challenge templates:
- class_wins: Win N matches with a specific class. Params: { classId, winsRequired }
- total_wins: Win N matches (any class). Params: { winsRequired }
- win_streak: Achieve a win streak of N. Params: { streakRequired }
- class_variety: Win with N different classes. Params: { classesRequired }
- underdog: Beat someone N+ ELO above you. Params: { eloGap }

Respond with ONLY valid JSON, no markdown.`;

export async function generateChallenges(metrics) {
  if (metrics.jackpotSize < MIN_JACKPOT || metrics.budget < 50) {
    console.log(`[Challenges] Jackpot too small (${metrics.jackpotSize}), using fallback challenges`);
    return getFallbackChallenges();
  }

  try {
    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.7,
      max_tokens: 1000,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            weeklyMetrics: metrics,
            challengeTemplates: CHALLENGE_TEMPLATES,
          }),
        },
      ],
    });

    const text = response.choices[0]?.message?.content?.trim();
    const parsed = JSON.parse(text);

    if (!parsed.challenges || !Array.isArray(parsed.challenges) || parsed.challenges.length < 2) {
      throw new Error('Invalid challenge response structure');
    }

    // Validate and cap rewards
    let totalReward = 0;
    const validated = [];
    for (const c of parsed.challenges.slice(0, 4)) {
      if (!CHALLENGE_TEMPLATES.includes(c.type)) continue;
      if (!c.title || !c.description || !c.params) continue;

      c.reward = Math.max(25, Math.min(200, Math.round(c.reward || 50)));
      if (totalReward + c.reward > metrics.budget) break;

      totalReward += c.reward;
      validated.push(c);
    }

    if (validated.length < 2) {
      console.log('[Challenges] OpenAI response had too few valid challenges, using fallback');
      return getFallbackChallenges();
    }

    console.log(`[Challenges] OpenAI generated ${validated.length} challenges, total reward: ${totalReward}`);
    return { challenges: validated, totalAllocated: totalReward, analysis: parsed.analysis || '' };
  } catch (err) {
    console.error('[Challenges] OpenAI generation failed:', err.message);
    return getFallbackChallenges();
  }
}

function getFallbackChallenges() {
  return {
    challenges: [
      {
        type: 'total_wins',
        title: 'Arena Regular',
        description: 'Win 10 ranked matches this week',
        params: { winsRequired: 10 },
        reward: 75,
      },
      {
        type: 'class_variety',
        title: 'Versatile Fighter',
        description: 'Win with 2 different classes this week',
        params: { classesRequired: 2 },
        reward: 50,
      },
    ],
    totalAllocated: 125,
    analysis: 'Fallback challenges (OpenAI unavailable)',
  };
}

// ── Week ID Helper ──────────────────────────────────────────────

function getWeekId(date = new Date()) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  // ISO week number
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function getNextSundayMidnightUTC() {
  const now = new Date();
  const day = now.getUTCDay();
  const daysUntilSunday = day === 0 ? 7 : 7 - day;
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + daysUntilSunday);
  next.setUTCHours(0, 0, 0, 0);
  return next.toISOString();
}

// ── DynamoDB: Challenges CRUD ───────────────────────────────────

export async function getActiveChallenges() {
  return db.getSystemRecord('WEEKLY_CHALLENGES');
}

async function getPreviousWeekArchive() {
  // Get the previous week's archive
  const now = new Date();
  const prevWeek = new Date(now.getTime() - 7 * 86400000);
  const weekId = getWeekId(prevWeek);
  return db.getSystemRecord(`WEEKLY_CHALLENGE_ARCHIVE#${weekId}`);
}

export async function activateChallenges(generated) {
  const weekId = getWeekId();
  const now = new Date().toISOString();
  const expiresAt = getNextSundayMidnightUTC();

  const challenges = generated.challenges.map((c, i) => ({
    id: `${weekId}-${String(i + 1).padStart(2, '0')}`,
    type: c.type,
    title: c.title,
    description: c.description,
    params: c.params,
    reward: c.reward,
    completions: 0,
  }));

  const record = {
    PK: 'SYSTEM',
    SK: 'WEEKLY_CHALLENGES',
    weekId,
    challenges,
    totalBudget: generated.totalAllocated,
    totalDistributed: 0,
    createdAt: now,
    expiresAt,
    aiAnalysis: generated.analysis || '',
  };

  await db.putSystemRecord(record);

  // Earmark from jackpot
  if (generated.totalAllocated > 0) {
    await db.subtractFromJackpot(generated.totalAllocated);
  }

  console.log(`[Challenges] Week ${weekId} activated: ${challenges.length} challenges, ${generated.totalAllocated} coins earmarked`);
  return record;
}

async function archiveWeek(current) {
  if (!current || !current.weekId) return;

  const archive = {
    PK: 'SYSTEM',
    SK: `WEEKLY_CHALLENGE_ARCHIVE#${current.weekId}`,
    weekId: current.weekId,
    challenges: current.challenges,
    totalDistributed: current.totalDistributed || 0,
    totalBudget: current.totalBudget || 0,
    createdAt: current.createdAt,
    archivedAt: new Date().toISOString(),
  };

  await db.putSystemRecord(archive);
  console.log(`[Challenges] Week ${current.weekId} archived (distributed: ${archive.totalDistributed})`);
}

// ── Challenge Progress Tracking ─────────────────────────────────

export async function updateChallengeProgress(sub, classId, won, playerElo, opponentElo) {
  if (!sub) return;

  const active = await getActiveChallenges();
  if (!active || !active.challenges?.length) return;
  if (new Date() > new Date(active.expiresAt)) return;

  // Get or create player progress for this week
  const progressRecord = await db.getPlayerChallengeProgress(sub, active.weekId);
  const progress = progressRecord?.progress || {};
  let changed = false;
  const completedNow = [];

  for (const challenge of active.challenges) {
    const cp = progress[challenge.id] || { current: 0, target: getTarget(challenge), completed: false, classesUsed: [] };

    if (cp.completed) continue;

    // Check if this match counts toward this challenge
    let counts = false;
    switch (challenge.type) {
      case 'class_wins':
        counts = won && classId === challenge.params.classId;
        break;
      case 'total_wins':
        counts = won;
        break;
      case 'win_streak':
        // Streaks are handled differently — we track current streak
        if (won) {
          cp.currentStreak = (cp.currentStreak || 0) + 1;
          counts = cp.currentStreak >= challenge.params.streakRequired;
        } else {
          cp.currentStreak = 0;
        }
        changed = true; // always save streak state
        break;
      case 'class_variety':
        if (won) {
          const used = new Set(cp.classesUsed || []);
          used.add(classId);
          cp.classesUsed = [...used];
          counts = cp.classesUsed.length >= challenge.params.classesRequired;
        }
        changed = true;
        break;
      case 'underdog':
        counts = won && opponentElo && playerElo && (opponentElo - playerElo >= (challenge.params.eloGap || 150));
        break;
    }

    if (counts && challenge.type !== 'win_streak' && challenge.type !== 'class_variety') {
      cp.current++;
    }

    // Check completion
    if (!cp.completed) {
      let isComplete = false;
      switch (challenge.type) {
        case 'class_wins':
        case 'total_wins':
          isComplete = cp.current >= cp.target;
          break;
        case 'win_streak':
          isComplete = counts; // achieved the streak requirement
          break;
        case 'class_variety':
          isComplete = counts; // reached class count
          break;
        case 'underdog':
          isComplete = cp.current >= 1; // just need 1
          break;
      }

      if (isComplete) {
        cp.completed = true;
        cp.completedAt = new Date().toISOString();
        cp.reward = challenge.reward;
        completedNow.push({ challengeId: challenge.id, reward: challenge.reward, title: challenge.title });
        changed = true;
      } else {
        changed = true;
      }
    }

    progress[challenge.id] = cp;
  }

  if (!changed && completedNow.length === 0) return;

  // Save progress
  await db.savePlayerChallengeProgress(sub, active.weekId, progress);

  // Award coins for completed challenges
  for (const completed of completedNow) {
    await db.awardCoins(sub, completed.reward);

    // Increment completion count on the active challenges record
    await db.incrementChallengeCompletions(active.weekId, completed.challengeId, completed.reward);

    console.log(`[Challenges] ${sub} completed "${completed.title}" — +${completed.reward} coins`);
  }

  return completedNow;
}

function getTarget(challenge) {
  switch (challenge.type) {
    case 'class_wins': return challenge.params.winsRequired || 5;
    case 'total_wins': return challenge.params.winsRequired || 10;
    case 'win_streak': return challenge.params.streakRequired || 3;
    case 'class_variety': return challenge.params.classesRequired || 3;
    case 'underdog': return 1;
    default: return 1;
  }
}

// ── Scheduler ───────────────────────────────────────────────────

export function startChallengeScheduler() {
  // Check immediately on boot
  checkAndRotate().catch(err => console.error('[Challenges] Boot check failed:', err.message));

  // Then check every hour
  setInterval(() => {
    checkAndRotate().catch(err => console.error('[Challenges] Hourly check failed:', err.message));
  }, 3600000);
}

async function checkAndRotate() {
  const current = await getActiveChallenges();

  if (!current || new Date() > new Date(current.expiresAt)) {
    // Archive old week
    if (current) await archiveWeek(current);

    // Generate new challenges
    const metrics = await collectWeeklyMetrics();
    console.log('[Challenges] Weekly metrics:', JSON.stringify(metrics, null, 2));

    const generated = await generateChallenges(metrics);
    await activateChallenges(generated);
  } else {
    const remaining = new Date(current.expiresAt) - new Date();
    const hours = Math.round(remaining / 3600000);
    console.log(`[Challenges] Current week ${current.weekId} still active (${hours}h remaining)`);
  }
}

// ── Force Generation (admin/testing) ────────────────────────────

export async function forceGenerate() {
  const current = await getActiveChallenges();
  if (current) await archiveWeek(current);

  const metrics = await collectWeeklyMetrics();
  const generated = await generateChallenges(metrics);
  const record = await activateChallenges(generated);
  return { metrics, generated, record };
}
