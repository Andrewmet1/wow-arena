import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  TransactWriteCommand,
  DeleteCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';

const TABLE = process.env.DYNAMO_TABLE || 'EbonCrucible';
const _dbOpts = { region: process.env.AWS_REGION || 'us-east-1' };
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  _dbOpts.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
}
const client = DynamoDBDocumentClient.from(new DynamoDBClient(_dbOpts));

// Pad ELO to 5 digits for leaderboard sort key (descending via zero-pad)
function eloSortKey(elo) {
  return `ELO#${String(Math.max(0, elo)).padStart(5, '0')}`;
}

// ── Class Mastery / XP System ───────────────────────────────────────
const MASTERY_MAX_LEVEL = 50;

const MASTERY_MILESTONES = {
  5:  { coins: 50 },
  10: { coins: 100 },
  15: { coins: 100 },
  20: { coins: 150 },
  25: { coins: 200 },
  30: { coins: 200 },
  35: { coins: 250 },
  40: { coins: 300 },
  45: { coins: 350 },
  50: { coins: 500, title: true },
};

export const MASTERY_TITLES = new Set([
  'title_tyrant_sovereign',
  'title_wraith_sovereign',
  'title_infernal_sovereign',
  'title_harbinger_sovereign',
  'title_revenant_sovereign',
]);

const MASTERY_TITLE_MAP = {
  tyrant: 'title_tyrant_sovereign',
  wraith: 'title_wraith_sovereign',
  infernal: 'title_infernal_sovereign',
  harbinger: 'title_harbinger_sovereign',
  revenant: 'title_revenant_sovereign',
};

// Precompute cumulative XP thresholds: LEVEL_THRESHOLDS[i] = total XP to reach level i+1
const LEVEL_THRESHOLDS = [];
{
  let cumulative = 0;
  for (let lvl = 1; lvl <= MASTERY_MAX_LEVEL; lvl++) {
    cumulative += Math.floor(50 * Math.pow(lvl, 1.5) + 50 * lvl);
    LEVEL_THRESHOLDS.push(cumulative);
  }
}

function computeLevel(xp) {
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (xp < LEVEL_THRESHOLDS[i]) return i;
  }
  return MASTERY_MAX_LEVEL;
}

// ── Account Level System ───────────────────────────────────────────
const ACCOUNT_XP_PER_LEVEL = 200;

function computeAccountLevel(xp) {
  if (xp <= 0) return 0;
  return Math.floor(xp / ACCOUNT_XP_PER_LEVEL);
}

const ACCOUNT_MILESTONES = {
  10:  { coins: 100 },
  20:  { coins: 150 },
  25:  { coins: 200, title: 'title_veteran' },
  30:  { coins: 200 },
  40:  { coins: 250 },
  50:  { coins: 500, title: 'title_seasoned' },
  60:  { coins: 300 },
  70:  { coins: 300 },
  80:  { coins: 400 },
  90:  { coins: 400 },
  100: { coins: 1000, title: 'title_legend' },
};

function getAccountMilestone(level) {
  if (ACCOUNT_MILESTONES[level]) return ACCOUNT_MILESTONES[level];
  if (level > 100 && level % 25 === 0) return { coins: 500 };
  return null;
}

export const ACCOUNT_TITLES = new Set([
  'title_veteran',
  'title_seasoned',
  'title_legend',
]);

// ── Battle Pass Tier System ──────────────────────────────────────────
const BP_TIER_COUNT = 50;
const BP_TIER_THRESHOLDS = [];
{
  let cumulative = 0;
  for (let t = 1; t <= BP_TIER_COUNT; t++) {
    cumulative += 100 + (t - 1) * 15;
    BP_TIER_THRESHOLDS.push(cumulative);
  }
}
export { BP_TIER_THRESHOLDS, BP_TIER_COUNT };

function computeBPTier(seasonXp) {
  for (let i = 0; i < BP_TIER_THRESHOLDS.length; i++) {
    if (seasonXp < BP_TIER_THRESHOLDS[i]) return i;
  }
  return BP_TIER_COUNT;
}

let _cachedSeason = null;
let _seasonCacheTime = 0;

export async function getSeasonConfig() {
  if (_cachedSeason && Date.now() - _seasonCacheTime < 60000) return _cachedSeason;
  const item = await getSystemRecord('SEASON_CONFIG');
  if (item?.active) {
    _cachedSeason = item;
    _seasonCacheTime = Date.now();
  }
  return item || null;
}

export function processBattlePassProgression(profile, xpEarned, seasonConfig) {
  if (!seasonConfig?.active) return null;

  const currentSeasonId = seasonConfig.seasonId;
  let seasonXp = profile.seasonXp || 0;
  let seasonRewardsClaimed = [...(profile.seasonRewardsClaimed || [])];
  let seasonHistory = { ...(profile.seasonHistory || {}) };

  // If player's season doesn't match, don't reset — just skip progression
  // New seasons are launched explicitly with a migration script
  if (profile.seasonId && profile.seasonId !== currentSeasonId) {
    return null;
  }

  const oldTier = computeBPTier(seasonXp);
  seasonXp += xpEarned;
  const newTier = computeBPTier(seasonXp);

  let bpCoinsEarned = 0;
  const newInventoryItems = [];
  const newRewards = [];

  for (let t = oldTier + 1; t <= newTier; t++) {
    if (seasonRewardsClaimed.includes(t)) continue;
    const tierRewards = seasonConfig.rewards.filter(r => r.tier === t);
    for (const reward of tierRewards) {
      if (reward.type === 'coins') {
        bpCoinsEarned += reward.amount;
      } else if (reward.type === 'multi') {
        for (const sub of reward.rewards) {
          newInventoryItems.push(sub.itemId);
          newRewards.push({ tier: t, ...sub });
        }
      } else {
        newInventoryItems.push(reward.itemId);
        newRewards.push({ tier: t, type: reward.type, itemId: reward.itemId, name: reward.name, rarity: reward.rarity });
      }
    }
    seasonRewardsClaimed.push(t);
  }

  return {
    seasonId: currentSeasonId,
    seasonXp,
    seasonTier: newTier,
    seasonRewardsClaimed,
    seasonHistory,
    tiersGained: newTier - oldTier,
    bpCoinsEarned,
    newInventoryItems,
    newRewards,
  };
}

export async function getProfile(sub) {
  const { Item } = await client.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `PLAYER#${sub}`, SK: 'PROFILE' },
  }));
  return Item || null;
}

export async function createProfile(sub, username) {
  const now = new Date().toISOString();
  const profile = {
    PK: `PLAYER#${sub}`,
    SK: 'PROFILE',
    GSI1PK: 'LEADERBOARD',
    GSI1SK: `${eloSortKey(1500)}#${sub}`,
    username,
    elo: 1500,
    wins: 0,
    losses: 0,
    classStats: {},
    classElos: {
      tyrant:    { elo: 1500, peakElo: 1500, seasonHighElo: 1500 },
      wraith:    { elo: 1500, peakElo: 1500, seasonHighElo: 1500 },
      infernal:  { elo: 1500, peakElo: 1500, seasonHighElo: 1500 },
      harbinger: { elo: 1500, peakElo: 1500, seasonHighElo: 1500 },
      revenant:  { elo: 1500, peakElo: 1500, seasonHighElo: 1500 },
    },
    classMastery: {},
    masteryMigrated: true,
    avatarClass: null,
    lastUsernameChange: null,
    rating: 0,
    peakRating: 0,
    seasonHighRating: 0,
    peakElo: 1500,
    seasonHighElo: 1500,
    currentStreak: 0,
    bestWinStreak: 0,
    totalPlayTime: 0,
    coins: 0,
    inventory: [],
    activeSkins: {},
    accountXp: 0,
    accountLevel: 0,
    seasonId: null,
    seasonXp: 0,
    seasonTier: 0,
    seasonRewardsClaimed: [],
    seasonHistory: {},
    createdAt: now,
    updatedAt: now,
  };

  await client.send(new PutCommand({
    TableName: TABLE,
    Item: profile,
    ConditionExpression: 'attribute_not_exists(PK)',
  }));

  return profile;
}

export async function reserveUsername(username, sub) {
  await client.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: `USERNAME#${username.toLowerCase()}`,
      SK: 'RESERVATION',
      cognitoSub: sub,
    },
    ConditionExpression: 'attribute_not_exists(PK)',
  }));
}

export async function isUsernameTaken(username) {
  const { Item } = await client.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `USERNAME#${username.toLowerCase()}`, SK: 'RESERVATION' },
  }));
  return !!Item;
}

export async function updateEloAndStats(sub, eloChange, classId, won, duration = 0, perfScore = 0) {
  // Get current profile first to calculate new ELO and old sort key
  const profile = await getProfile(sub);
  if (!profile) return;

  // ── Per-Class ELO ──────────────────────────────────────────
  // Lazy migration: if classElos doesn't exist, seed all classes from global elo
  const classElos = profile.classElos ? { ...profile.classElos } : {};
  if (!profile.classElos) {
    const seedElo = profile.elo || 1500;
    for (const cls of ['tyrant', 'wraith', 'infernal', 'harbinger', 'revenant']) {
      classElos[cls] = { elo: seedElo, peakElo: profile.peakElo || seedElo, seasonHighElo: profile.seasonHighElo || seedElo };
    }
  }

  // Update the played class's ELO
  const ce = classElos[classId] || { elo: 1500, peakElo: 1500, seasonHighElo: 1500 };
  const oldClassElo = ce.elo;
  ce.elo = Math.max(0, oldClassElo + eloChange);
  ce.peakElo = Math.max(ce.peakElo || oldClassElo, ce.elo);
  ce.seasonHighElo = Math.max(ce.seasonHighElo || oldClassElo, ce.elo);
  classElos[classId] = ce;

  // Global ELO = highest class ELO
  const oldElo = profile.elo;
  const newElo = Math.max(...Object.values(classElos).map(c => c.elo));
  const now = new Date().toISOString();

  // ── Rating (separate from ELO, converges via gap-based acceleration) ──
  const oldRating = profile.rating || 0;
  const targetRating = Math.max(0, newElo - 1500);
  const ratingGap = targetRating - oldRating;
  let ratingChange;
  if (won) {
    // Close 50% of the gap per win, minimum = eloChange
    ratingChange = Math.max(eloChange, eloChange + ratingGap * 0.5);
  } else {
    ratingChange = eloChange; // negative
  }
  const newRating = Math.max(0, Math.round(oldRating + ratingChange));
  const newPeakRating = Math.max(profile.peakRating || 0, newRating);
  const newSeasonHighRating = Math.max(profile.seasonHighRating || 0, newRating);

  // Build classStats update (with per-class streaks)
  const currentClassStats = profile.classStats || {};
  const cs = currentClassStats[classId] || { wins: 0, losses: 0, gamesPlayed: 0, currentStreak: 0, bestWinStreak: 0 };
  cs.gamesPlayed++;
  if (won) {
    cs.wins++;
    cs.currentStreak = Math.max(1, (cs.currentStreak || 0) > 0 ? cs.currentStreak + 1 : 1);
  } else {
    cs.losses++;
    cs.currentStreak = Math.min(-1, (cs.currentStreak || 0) < 0 ? cs.currentStreak - 1 : -1);
  }
  cs.bestWinStreak = Math.max(cs.bestWinStreak || 0, cs.currentStreak > 0 ? cs.currentStreak : 0);
  currentClassStats[classId] = cs;

  // Overall streak
  const oldStreak = profile.currentStreak || 0;
  const newStreak = won
    ? Math.max(1, oldStreak > 0 ? oldStreak + 1 : 1)
    : Math.min(-1, oldStreak < 0 ? oldStreak - 1 : -1);
  const newBestWinStreak = Math.max(profile.bestWinStreak || 0, newStreak > 0 ? newStreak : 0);

  // Peak ELO tracking
  const newPeakElo = Math.max(profile.peakElo || oldElo, newElo);
  const newSeasonHighElo = Math.max(profile.seasonHighElo || oldElo, newElo);

  // Play time
  const newTotalPlayTime = (profile.totalPlayTime || 0) + (duration || 0);

  // Coin rewards (conservative: casual ~1,000 coins/month)
  let coinsEarned = won ? 30 : 8;
  // Streak bonus: +5 per streak level (after first win), cap at +25
  if (won && newStreak > 1) coinsEarned += Math.min(25, (newStreak - 1) * 5);
  // Tier multiplier
  if (newElo >= 2000) coinsEarned = Math.round(coinsEarned * 2.0);
  else if (newElo >= 1800) coinsEarned = Math.round(coinsEarned * 1.5);
  else if (newElo >= 1500) coinsEarned = Math.round(coinsEarned * 1.25);
  else if (newElo >= 1300) coinsEarned = Math.round(coinsEarned * 1.1);
  // ── Class Mastery XP ─────────────────────────────────────────
  // Wins: 100 XP flat. Losses: 0-25 XP based on individual performance.
  const xpEarned = won ? 100 : Math.round(25 * Math.min(1, Math.max(0, perfScore) / 100));
  const currentMastery = profile.classMastery ? { ...profile.classMastery } : {};
  const cm = currentMastery[classId] ? { ...currentMastery[classId] } : { xp: 0, level: 0 };
  const oldLevel = cm.level || 0;
  cm.xp = (cm.xp || 0) + xpEarned;
  cm.level = computeLevel(cm.xp);
  currentMastery[classId] = cm;

  // Check for milestone rewards between old and new level
  let masteryCoinsEarned = 0;
  const inventory = [...(profile.inventory || [])];
  for (let lvl = oldLevel + 1; lvl <= cm.level; lvl++) {
    const milestone = MASTERY_MILESTONES[lvl];
    if (!milestone) continue;
    if (milestone.coins) masteryCoinsEarned += milestone.coins;
    if (milestone.title) {
      const titleId = MASTERY_TITLE_MAP[classId];
      if (titleId && !inventory.includes(titleId)) {
        inventory.push(titleId);
      }
    }
  }
  const levelUps = cm.level - oldLevel;

  // ── Account XP ─────────────────────────────────────────────
  const oldAccountXp = profile.accountXp || 0;
  const oldAccountLevel = profile.accountLevel || computeAccountLevel(oldAccountXp);
  const newAccountXp = oldAccountXp + xpEarned;
  const newAccountLevel = computeAccountLevel(newAccountXp);

  let accountMilestoneCoins = 0;
  for (let lvl = oldAccountLevel + 1; lvl <= newAccountLevel; lvl++) {
    const milestone = getAccountMilestone(lvl);
    if (!milestone) continue;
    if (milestone.coins) accountMilestoneCoins += milestone.coins;
    if (milestone.title && !inventory.includes(milestone.title)) {
      inventory.push(milestone.title);
    }
  }
  const accountLevelUps = newAccountLevel - oldAccountLevel;

  // ── Battle Pass Season XP ─────────────────────────────────────
  const seasonConfig = await getSeasonConfig();
  const bpResult = processBattlePassProgression(profile, xpEarned, seasonConfig);
  let bpCoinsEarned = 0;
  if (bpResult) {
    bpCoinsEarned = bpResult.bpCoinsEarned;
    for (const itemId of bpResult.newInventoryItems) {
      if (!inventory.includes(itemId)) inventory.push(itemId);
    }
  }

  const totalCoinsEarned = coinsEarned + masteryCoinsEarned + accountMilestoneCoins + bpCoinsEarned;
  const newCoins = (profile.coins || 0) + totalCoinsEarned;

  // Transaction: update profile + update leaderboard GSI sort key
  const inventoryChanged = inventory.length !== (profile.inventory || []).length;
  let updateExpr = 'SET elo = :newElo, rating = :rating, peakRating = :peakRating, seasonHighRating = :seasonHighRating, wins = wins + :winInc, losses = losses + :lossInc, classStats = :cs, classElos = :classElos, classMastery = :mastery, updatedAt = :now, GSI1SK = :gsi1sk, currentStreak = :streak, bestWinStreak = :bestStreak, peakElo = :peak, seasonHighElo = :seasonHigh, totalPlayTime = :playTime, coins = :coins, accountXp = :accXp, accountLevel = :accLvl, seasonXp = :sXp, seasonTier = :sTier, seasonId = :sId, seasonRewardsClaimed = :sRc';
  const exprValues = {
    ':newElo': newElo,
    ':rating': newRating,
    ':peakRating': newPeakRating,
    ':seasonHighRating': newSeasonHighRating,
    ':winInc': won ? 1 : 0,
    ':lossInc': won ? 0 : 1,
    ':cs': currentClassStats,
    ':classElos': classElos,
    ':mastery': currentMastery,
    ':now': now,
    ':gsi1sk': `${eloSortKey(newElo)}#${sub}`,
    ':streak': newStreak,
    ':bestStreak': newBestWinStreak,
    ':peak': newPeakElo,
    ':seasonHigh': newSeasonHighElo,
    ':playTime': newTotalPlayTime,
    ':coins': newCoins,
    ':accXp': newAccountXp,
    ':accLvl': newAccountLevel,
    ':sXp': bpResult?.seasonXp ?? (profile.seasonXp || 0),
    ':sTier': bpResult?.seasonTier ?? (profile.seasonTier || 0),
    ':sId': bpResult?.seasonId ?? profile.seasonId ?? null,
    ':sRc': bpResult?.seasonRewardsClaimed ?? (profile.seasonRewardsClaimed || []),
  };
  if (inventoryChanged) {
    updateExpr += ', inventory = :inv';
    exprValues[':inv'] = inventory;
  }
  if (bpResult?.seasonHistory && Object.keys(bpResult.seasonHistory).length > 0) {
    updateExpr += ', seasonHistory = :sHist';
    exprValues[':sHist'] = bpResult.seasonHistory;
  }

  await client.send(new TransactWriteCommand({
    TransactItems: [
      {
        Update: {
          TableName: TABLE,
          Key: { PK: `PLAYER#${sub}`, SK: 'PROFILE' },
          UpdateExpression: updateExpr,
          ExpressionAttributeValues: exprValues,
        },
      },
    ],
  }));

  return { oldElo, newElo, eloChange, classElo: ce.elo, oldClassElo, rating: newRating, ratingChange: Math.round(ratingChange), oldRating, peakRating: newPeakRating, seasonHighRating: newSeasonHighRating, coinsEarned: totalCoinsEarned, newCoins, xpEarned, classMastery: cm, levelUps, masteryCoinsEarned, accountXp: newAccountXp, accountLevel: newAccountLevel, accountLevelUps, accountMilestoneCoins, seasonXp: bpResult?.seasonXp, seasonTier: bpResult?.seasonTier, bpTiersGained: bpResult?.tiersGained || 0, bpCoinsEarned, bpNewRewards: bpResult?.newRewards || [], classElos };
}

// ── Retroactive Mastery Migration ────────────────────────────────────
export async function migrateClassMastery(sub) {
  const profile = await getProfile(sub);
  if (!profile || profile.masteryMigrated) return profile;

  const classStats = profile.classStats || {};
  const classMastery = {};
  let totalMilestoneCoins = 0;
  const inventory = [...(profile.inventory || [])];

  for (const [classId, cs] of Object.entries(classStats)) {
    const wins = cs.wins || 0;
    const losses = cs.losses || 0;
    const xp = (wins * 100);
    const level = computeLevel(xp);
    classMastery[classId] = { xp, level };

    // Tally all passed milestone rewards
    for (let lvl = 1; lvl <= level; lvl++) {
      const milestone = MASTERY_MILESTONES[lvl];
      if (!milestone) continue;
      if (milestone.coins) totalMilestoneCoins += milestone.coins;
      if (milestone.title) {
        const titleId = MASTERY_TITLE_MAP[classId];
        if (titleId && !inventory.includes(titleId)) {
          inventory.push(titleId);
        }
      }
    }
  }

  const newCoins = (profile.coins || 0) + totalMilestoneCoins;

  try {
    await client.send(new TransactWriteCommand({
      TransactItems: [{
        Update: {
          TableName: TABLE,
          Key: { PK: `PLAYER#${sub}`, SK: 'PROFILE' },
          UpdateExpression: 'SET classMastery = :mastery, masteryMigrated = :migrated, coins = :coins, inventory = :inv',
          ConditionExpression: 'attribute_not_exists(masteryMigrated) OR masteryMigrated <> :migrated',
          ExpressionAttributeValues: {
            ':mastery': classMastery,
            ':migrated': true,
            ':coins': newCoins,
            ':inv': inventory,
          },
        },
      }],
    }));

    if (totalMilestoneCoins > 0) {
      console.log(`[Mastery] Migrated ${sub}: ${Object.keys(classMastery).length} classes, +${totalMilestoneCoins} milestone coins`);
    }

    // Return updated profile
    return { ...profile, classMastery, masteryMigrated: true, coins: newCoins, inventory };
  } catch (err) {
    if (err.name === 'TransactionCanceledException') {
      // Already migrated by another request — just return current profile
      return await getProfile(sub);
    }
    throw err;
  }
}

export async function recordMatch(sub, matchData) {
  const matchId = matchData.matchId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const timestamp = new Date().toISOString();

  await client.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: `PLAYER#${sub}`,
      SK: `MATCH#${timestamp}#${matchId}`,
      matchId,
      opponentUsername: matchData.opponentUsername,
      opponentElo: matchData.opponentElo,
      opponentSub: matchData.opponentSub,
      playerClass: matchData.playerClass,
      opponentClass: matchData.opponentClass,
      playerElo: matchData.playerElo,
      result: matchData.result,
      eloChange: matchData.eloChange,
      duration: matchData.duration,
      mode: matchData.mode || '1v1',
      timestamp,
    },
  }));
}

// ── Balance Aggregate ───────────────────────────────────────────

function matchupKey(classA, classB) {
  return [classA, classB].sort().join('_vs_');
}

function eloBracket(elo) {
  if (elo < 1200) return '<1200';
  if (elo < 1500) return '1200-1500';
  if (elo < 1800) return '1500-1800';
  return '1800+';
}

export async function updateBalanceAggregate(winnerClass, loserClass, winnerElo, loserElo, duration) {
  // Optimistic locking: retry on version conflict to prevent lost updates
  for (let attempt = 0; attempt < 3; attempt++) {
    let agg;
    try {
      const { Item } = await client.send(new GetCommand({
        TableName: TABLE,
        Key: { PK: 'SYSTEM', SK: 'BALANCE_AGGREGATE' },
      }));
      agg = Item || { PK: 'SYSTEM', SK: 'BALANCE_AGGREGATE', totalMatches: 0, matchups: {}, brackets: {}, version: 0 };
    } catch {
      agg = { PK: 'SYSTEM', SK: 'BALANCE_AGGREGATE', totalMatches: 0, matchups: {}, brackets: {}, version: 0 };
    }

    const oldVersion = agg.version || 0;
    const key = matchupKey(winnerClass, loserClass);
    const sorted = [winnerClass, loserClass].sort();
    const winnerIsA = sorted[0] === winnerClass;

    if (!agg.matchups[key]) agg.matchups[key] = { wins_a: 0, wins_b: 0, totalDuration: 0, count: 0 };
    const mu = agg.matchups[key];
    if (winnerIsA) mu.wins_a++; else mu.wins_b++;
    mu.totalDuration += duration || 0;
    mu.count++;
    agg.totalMatches++;

    const avgElo = Math.round((winnerElo + loserElo) / 2);
    const bracket = eloBracket(avgElo);
    if (!agg.brackets[bracket]) agg.brackets[bracket] = { matchups: {}, totalMatches: 0 };
    const br = agg.brackets[bracket];
    if (!br.matchups[key]) br.matchups[key] = { wins_a: 0, wins_b: 0, totalDuration: 0, count: 0 };
    const brMu = br.matchups[key];
    if (winnerIsA) brMu.wins_a++; else brMu.wins_b++;
    brMu.totalDuration += duration || 0;
    brMu.count++;
    br.totalMatches++;

    agg.lastUpdated = new Date().toISOString();
    agg.version = oldVersion + 1;

    try {
      await client.send(new PutCommand({
        TableName: TABLE,
        Item: agg,
        ConditionExpression: oldVersion === 0
          ? 'attribute_not_exists(version) OR version = :v'
          : 'version = :v',
        ExpressionAttributeValues: { ':v': oldVersion },
      }));
      return; // success
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException' && attempt < 2) {
        continue; // retry with fresh data
      }
      throw err;
    }
  }
}

export async function getMatchHistory(sub, limit = 10) {
  const { Items } = await client.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': `PLAYER#${sub}`,
      ':prefix': 'MATCH#',
    },
    ScanIndexForward: false,
    Limit: limit,
  }));
  return Items || [];
}

export async function getLeaderboard(limit = 20) {
  const { Items } = await client.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: {
      ':pk': 'LEADERBOARD',
    },
    ScanIndexForward: false,
    Limit: limit,
  }));
  return (Items || []).map(item => ({
    username: item.username,
    elo: item.elo,
    wins: item.wins,
    losses: item.losses,
    avatarClass: item.avatarClass || null,
    rating: item.rating != null ? item.rating : Math.max(0, Math.round((item.elo || 1500) - 1500)),
    activeTitle: item.activeTitle || null,
    classStats: item.classStats || {},
    classElos: item.classElos || {},
    sub: item.PK?.replace('PLAYER#', ''),
  }));
}

// ── King of the Hill ─────────────────────────────────────────────

export async function getKingOfHill() {
  const { Item } = await client.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: 'SYSTEM', SK: 'KING_OF_HILL' },
  }));
  return Item || null;
}

export async function setKingOfHill(sub, username, elo) {
  const now = new Date().toISOString();
  await client.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: 'SYSTEM',
      SK: 'KING_OF_HILL',
      playerSub: sub,
      username,
      elo,
      reignStarted: now,
      defenses: 0,
      updatedAt: now,
    },
  }));
}

export async function updateKingAfterMatch(sub, elo, defenses) {
  const now = new Date().toISOString();
  // Fetch existing king to preserve username + reignStarted
  const existing = await getKingOfHill();
  await client.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: 'SYSTEM',
      SK: 'KING_OF_HILL',
      playerSub: sub,
      username: existing?.username || '',
      elo,
      reignStarted: existing?.reignStarted || now,
      defenses,
      updatedAt: now,
    },
  }));
}

// ── Username Change ─────────────────────────────────────────────

export async function changeUsername(sub, newUsername, oldUsername) {
  const now = new Date().toISOString();
  await client.send(new TransactWriteCommand({
    TransactItems: [
      { Put: { TableName: TABLE, Item: { PK: `USERNAME#${newUsername.toLowerCase()}`, SK: 'RESERVATION', cognitoSub: sub }, ConditionExpression: 'attribute_not_exists(PK)' } },
      { Delete: { TableName: TABLE, Key: { PK: `USERNAME#${oldUsername.toLowerCase()}`, SK: 'RESERVATION' } } },
      { Update: { TableName: TABLE, Key: { PK: `PLAYER#${sub}`, SK: 'PROFILE' },
        UpdateExpression: 'SET username = :name, lastUsernameChange = :now, updatedAt = :now',
        ExpressionAttributeValues: { ':name': newUsername, ':now': now } } },
    ],
  }));
}

// ── Avatar Class ────────────────────────────────────────────────

export async function setAvatarClass(sub, classId) {
  const now = new Date().toISOString();
  await client.send(new TransactWriteCommand({
    TransactItems: [{ Update: {
      TableName: TABLE, Key: { PK: `PLAYER#${sub}`, SK: 'PROFILE' },
      UpdateExpression: 'SET avatarClass = :cls, updatedAt = :now',
      ExpressionAttributeValues: { ':cls': classId, ':now': now },
    }}],
  }));
}

// ── Per-Class Champions ─────────────────────────────────────────

export async function getClassChampion(classId) {
  const { Item } = await client.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: 'SYSTEM', SK: `CLASS_KING#${classId}` },
  }));
  return Item || null;
}

export async function getAllClassChampions() {
  const classIds = ['tyrant', 'wraith', 'infernal', 'harbinger', 'revenant'];
  const results = {};
  await Promise.all(classIds.map(async (cid) => {
    results[cid] = await getClassChampion(cid);
  }));
  return results;
}

export async function setClassChampion(classId, sub, username, wins, winRate) {
  const now = new Date().toISOString();
  await client.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: 'SYSTEM', SK: `CLASS_KING#${classId}`,
      playerSub: sub, username, wins, winRate,
      claimedAt: now, updatedAt: now,
    },
  }));
}

// ── Ban System ──────────────────────────────────────────────────

export async function banPlayer(sub, banned = true) {
  const now = new Date().toISOString();
  await client.send(new TransactWriteCommand({
    TransactItems: [{ Update: {
      TableName: TABLE, Key: { PK: `PLAYER#${sub}`, SK: 'PROFILE' },
      UpdateExpression: 'SET banned = :b, updatedAt = :now',
      ExpressionAttributeValues: { ':b': banned, ':now': now },
    }}],
  }));
}

// ── Friends System ───────────────────────────────────────────────

export async function sendFriendRequest(fromSub, toSub, fromUsername) {
  const now = new Date().toISOString();
  await client.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: `PLAYER#${toSub}`,
      SK: `FRIEND_REQ#${fromSub}`,
      fromSub,
      fromUsername,
      status: 'pending',
      createdAt: now,
    },
    ConditionExpression: 'attribute_not_exists(PK)',
  }));
}

export async function getPendingRequests(sub) {
  const { Items } = await client.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': `PLAYER#${sub}`,
      ':prefix': 'FRIEND_REQ#',
    },
  }));
  return (Items || []).filter(i => i.status === 'pending');
}

export async function acceptFriendRequest(fromSub, toSub, fromUsername, toUsername) {
  const now = new Date().toISOString();
  await client.send(new TransactWriteCommand({
    TransactItems: [
      // Delete the request
      { Delete: { TableName: TABLE, Key: { PK: `PLAYER#${toSub}`, SK: `FRIEND_REQ#${fromSub}` } } },
      // Create bidirectional friendship
      { Put: { TableName: TABLE, Item: { PK: `PLAYER#${toSub}`, SK: `FRIEND#${fromSub}`, friendUsername: fromUsername, friendSub: fromSub, since: now } } },
      { Put: { TableName: TABLE, Item: { PK: `PLAYER#${fromSub}`, SK: `FRIEND#${toSub}`, friendUsername: toUsername, friendSub: toSub, since: now } } },
    ],
  }));
}

export async function declineFriendRequest(fromSub, toSub) {
  await client.send(new DeleteCommand({
    TableName: TABLE,
    Key: { PK: `PLAYER#${toSub}`, SK: `FRIEND_REQ#${fromSub}` },
  }));
}

export async function removeFriend(sub, friendSub) {
  await client.send(new TransactWriteCommand({
    TransactItems: [
      { Delete: { TableName: TABLE, Key: { PK: `PLAYER#${sub}`, SK: `FRIEND#${friendSub}` } } },
      { Delete: { TableName: TABLE, Key: { PK: `PLAYER#${friendSub}`, SK: `FRIEND#${sub}` } } },
    ],
  }));
}

export async function getFriendsList(sub) {
  const { Items } = await client.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': `PLAYER#${sub}`,
      ':prefix': 'FRIEND#',
    },
  }));
  return Items || [];
}

export async function findPlayerByUsername(username) {
  const { Item } = await client.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `USERNAME#${username.toLowerCase()}`, SK: 'RESERVATION' },
  }));
  return Item || null;
}

// ── Chat System ──────────────────────────────────────────────────

function chatPK(sub1, sub2) {
  return `CHAT#${[sub1, sub2].sort().join('#')}`;
}

export async function sendChatMessage(fromSub, toSub, fromUsername, text) {
  const now = new Date().toISOString();
  await client.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: chatPK(fromSub, toSub),
      SK: `MSG#${now}`,
      fromSub,
      fromUsername,
      text: text.slice(0, 500),
      timestamp: now,
    },
  }));
  return now;
}

export async function getChatHistory(sub1, sub2, limit = 30) {
  const { Items } = await client.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': chatPK(sub1, sub2),
      ':prefix': 'MSG#',
    },
    ScanIndexForward: false,
    Limit: limit,
  }));
  return (Items || []).reverse();
}

// ── Channel Chat System ──────────────────────────────────────────

export function dmChannelId(sub1, sub2) {
  return `dm:${[sub1, sub2].sort().join(':')}`;
}

export async function sendChannelMessage(channelId, fromSub, fromUsername, text) {
  const now = new Date().toISOString();
  const suffix = Math.random().toString(36).slice(2, 6);
  const item = {
    PK: `CHAN#${channelId}`,
    SK: `MSG#${now}#${suffix}`,
    fromSub,
    fromUsername,
    text: text.slice(0, 500),
    timestamp: now,
  };
  // TTL for duel channels (1 hour)
  if (channelId.startsWith('duel:')) {
    item.ttl = Math.floor(Date.now() / 1000) + 3600;
  }
  await client.send(new PutCommand({ TableName: TABLE, Item: item }));
  return now;
}

export async function getChannelHistory(channelId, limit = 50) {
  const { Items } = await client.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': `CHAN#${channelId}`,
      ':prefix': 'MSG#',
    },
    ScanIndexForward: false,
    Limit: limit,
  }));
  return (Items || []).reverse();
}

// ── Shop / Inventory ─────────────────────────────────────────────

export async function purchaseItem(sub, itemId, cost) {
  // cost comes from server-side SHOP_PRICES — never from client
  const profile = await getProfile(sub);
  if (!profile) throw new Error('Profile not found');
  if ((profile.coins || 0) < cost) throw new Error('Insufficient coins');
  const inventory = profile.inventory || [];
  if (inventory.includes(itemId)) throw new Error('Already owned');

  const now = new Date().toISOString();
  await client.send(new TransactWriteCommand({
    TransactItems: [{
      Update: {
        TableName: TABLE,
        Key: { PK: `PLAYER#${sub}`, SK: 'PROFILE' },
        UpdateExpression: 'SET coins = coins - :cost, inventory = list_append(if_not_exists(inventory, :empty), :item), updatedAt = :now',
        ExpressionAttributeValues: {
          ':cost': cost,
          ':item': [itemId],
          ':itemId': itemId,
          ':empty': [],
          ':now': now,
        },
        // Atomic: check balance AND that item is not already in inventory
        ConditionExpression: 'coins >= :cost AND NOT contains(inventory, :itemId)',
      },
    }],
  }));

  return { newCoins: (profile.coins || 0) - cost, inventory: [...inventory, itemId] };
}

export async function getInventory(sub) {
  const profile = await getProfile(sub);
  return {
    coins: profile?.coins || 0,
    inventory: profile?.inventory || [],
  };
}

// ── Champion Betting ─────────────────────────────────────────────

export async function placeBet(sub, classId, side, amount) {
  const profile = await getProfile(sub);
  if (!profile) throw new Error('Profile not found');
  if ((profile.coins || 0) < amount) throw new Error('Insufficient coins');

  const betId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  // Get current champion to snapshot odds
  const champion = await getClassChampion(classId);
  const winRate = champion?.winRate || 50;
  const holdsOdds = winRate >= 80 ? 1.15 : winRate >= 60 ? 1.3 : 1.5;
  const fallsOdds = winRate >= 80 ? 4.5 : winRate >= 60 ? 2.5 : 1.8;
  const odds = side === 'holds' ? holdsOdds : fallsOdds;

  await client.send(new TransactWriteCommand({
    TransactItems: [
      // Deduct coins
      {
        Update: {
          TableName: TABLE,
          Key: { PK: `PLAYER#${sub}`, SK: 'PROFILE' },
          UpdateExpression: 'SET coins = coins - :amt, updatedAt = :now',
          ExpressionAttributeValues: { ':amt': amount, ':now': now },
          ConditionExpression: 'coins >= :amt',
        },
      },
      // Create bet record
      {
        Put: {
          TableName: TABLE,
          Item: {
            PK: `PLAYER#${sub}`,
            SK: `BET#${betId}`,
            betId,
            classId,
            side,
            amount,
            odds,
            championUsername: champion?.username || 'Unknown',
            championWins: champion?.wins || 0,
            status: 'active',
            matchesRemaining: 5,
            createdAt: now,
          },
        },
      },
    ],
  }));

  return { betId, odds, newCoins: (profile.coins || 0) - amount };
}

export async function getPlayerBets(sub) {
  const { Items } = await client.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': `PLAYER#${sub}`,
      ':prefix': 'BET#',
    },
    ScanIndexForward: false,
    Limit: 20,
  }));
  return Items || [];
}

export async function setCosmetic(sub, slot, itemId) {
  const now = new Date().toISOString();
  await client.send(new TransactWriteCommand({
    TransactItems: [{
      Update: {
        TableName: TABLE,
        Key: { PK: `PLAYER#${sub}`, SK: 'PROFILE' },
        UpdateExpression: `SET #slot = :val, updatedAt = :now`,
        ExpressionAttributeNames: { '#slot': slot },
        ExpressionAttributeValues: { ':val': itemId, ':now': now },
      },
    }],
  }));
}

export async function setSkinForClass(sub, classId, skinId) {
  const now = new Date().toISOString();
  await client.send(new TransactWriteCommand({
    TransactItems: [{
      Update: {
        TableName: TABLE,
        Key: { PK: `PLAYER#${sub}`, SK: 'PROFILE' },
        UpdateExpression: 'SET activeSkins.#cls = :skin, updatedAt = :now',
        ExpressionAttributeNames: { '#cls': classId },
        ExpressionAttributeValues: { ':skin': skinId, ':now': now },
      },
    }],
  }));
}

// ── Bet Resolution (Pool-Based) ─────────────────────────────────
//
// Losing bets fund winning payouts. From the loser pool:
//   1. Winner payouts (amount * odds) are paid first
//   2. 15% of remainder → champion's cut (if champion held)
//   3. Rest → Crucible Jackpot (for community events, challenges, etc.)
// If the loser pool can't cover winners, the system subsidizes the difference.

const CHAMPION_CUT_RATE = 0.15;

export async function getActiveBetsForClass(classId) {
  const { Items } = await client.send(new ScanCommand({
    TableName: TABLE,
    FilterExpression: 'begins_with(SK, :betPrefix) AND classId = :cls AND #s = :active',
    ExpressionAttributeValues: {
      ':betPrefix': 'BET#',
      ':cls': classId,
      ':active': 'active',
    },
    ExpressionAttributeNames: { '#s': 'status' },
  }));
  return Items || [];
}

// Get or initialize the Crucible Jackpot
export async function getJackpot() {
  const { Item } = await client.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: 'SYSTEM', SK: 'JACKPOT' },
  }));
  return Item || { PK: 'SYSTEM', SK: 'JACKPOT', total: 0 };
}

async function addToJackpot(amount) {
  if (amount <= 0) return;
  const now = new Date().toISOString();
  try {
    await client.send(new TransactWriteCommand({
      TransactItems: [{
        Update: {
          TableName: TABLE,
          Key: { PK: 'SYSTEM', SK: 'JACKPOT' },
          UpdateExpression: 'SET total = if_not_exists(total, :zero) + :amt, lastUpdated = :now',
          ExpressionAttributeValues: { ':amt': amount, ':zero': 0, ':now': now },
        },
      }],
    }));
  } catch {
    // Initialize if doesn't exist
    await client.send(new PutCommand({
      TableName: TABLE,
      Item: { PK: 'SYSTEM', SK: 'JACKPOT', total: amount, lastUpdated: now },
    }));
  }
}

// Resolve a batch of bets, distributing the loser pool properly
async function resolveBetBatch(bets, winningSide, championSub) {
  if (bets.length === 0) return { resolved: [], championCut: 0, jackpotContribution: 0 };

  const now = new Date().toISOString();
  const resolved = [];

  // Separate winners and losers
  let loserPool = 0;
  let totalWinnerPayouts = 0;
  const winners = [];
  const losers = [];

  for (const bet of bets) {
    const won = bet.side === winningSide;
    if (won) {
      const payout = Math.round(bet.amount * bet.odds);
      winners.push({ bet, payout });
      totalWinnerPayouts += payout;
    } else {
      losers.push(bet);
      loserPool += bet.amount;
    }
  }

  // Pay winners (from loser pool; system subsidizes any deficit)
  for (const { bet, payout } of winners) {
    const playerSub = bet.PK.replace('PLAYER#', '');
    await client.send(new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: TABLE,
            Key: { PK: bet.PK, SK: bet.SK },
            UpdateExpression: 'SET #s = :status, resolvedAt = :now, payout = :payout',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ':status': 'won', ':now': now, ':payout': payout },
          },
        },
        {
          Update: {
            TableName: TABLE,
            Key: { PK: bet.PK, SK: 'PROFILE' },
            UpdateExpression: 'SET coins = coins + :payout',
            ExpressionAttributeValues: { ':payout': payout },
          },
        },
      ],
    }));
    resolved.push({ playerSub, side: bet.side, amount: bet.amount, won: true, payout });
  }

  // Mark losers
  for (const bet of losers) {
    const playerSub = bet.PK.replace('PLAYER#', '');
    await client.send(new TransactWriteCommand({
      TransactItems: [{
        Update: {
          TableName: TABLE,
          Key: { PK: bet.PK, SK: bet.SK },
          UpdateExpression: 'SET #s = :status, resolvedAt = :now, payout = :zero',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':status': 'lost', ':now': now, ':zero': 0 },
        },
      }],
    }));
    resolved.push({ playerSub, side: bet.side, amount: bet.amount, won: false, payout: 0 });
  }

  // Distribute the loser pool surplus
  const surplus = Math.max(0, loserPool - totalWinnerPayouts);
  let championCut = 0;
  let jackpotContribution = 0;

  if (surplus > 0) {
    // Champion's cut: 15% of surplus (only if champion held and we have a champion)
    if (championSub && winningSide === 'holds') {
      championCut = Math.round(surplus * CHAMPION_CUT_RATE);
      if (championCut > 0) {
        await client.send(new TransactWriteCommand({
          TransactItems: [{
            Update: {
              TableName: TABLE,
              Key: { PK: `PLAYER#${championSub}`, SK: 'PROFILE' },
              UpdateExpression: 'SET coins = coins + :cut',
              ExpressionAttributeValues: { ':cut': championCut },
            },
          }],
        }));
      }
    }

    // Remainder → Crucible Jackpot
    jackpotContribution = surplus - championCut;
    if (jackpotContribution > 0) {
      await addToJackpot(jackpotContribution);
    }
  }

  return { resolved, championCut, jackpotContribution, loserPool, totalWinnerPayouts };
}

// Called after every ranked match involving this class (when champion holds)
export async function tickClassBets(classId, championSub) {
  const bets = await getActiveBetsForClass(classId);
  if (bets.length === 0) return { resolved: [], championCut: 0, jackpotContribution: 0 };

  const now = new Date().toISOString();

  // Separate expired vs still active
  const expired = [];
  const stillActive = [];
  for (const bet of bets) {
    const newRemaining = (bet.matchesRemaining || 1) - 1;
    if (newRemaining <= 0) {
      expired.push(bet);
    } else {
      stillActive.push({ bet, newRemaining });
    }
  }

  // Decrement matchesRemaining for still-active bets
  for (const { bet, newRemaining } of stillActive) {
    await client.send(new TransactWriteCommand({
      TransactItems: [{
        Update: {
          TableName: TABLE,
          Key: { PK: bet.PK, SK: bet.SK },
          UpdateExpression: 'SET matchesRemaining = :mr',
          ExpressionAttributeValues: { ':mr': newRemaining },
        },
      }],
    }));
  }

  // Resolve expired bets — champion held, so "holds" wins
  if (expired.length === 0) return { resolved: [], championCut: 0, jackpotContribution: 0 };
  return resolveBetBatch(expired, 'holds', championSub);
}

// Called when a champion is dethroned — all "falls" bets win immediately
export async function resolveChampionFall(classId) {
  const bets = await getActiveBetsForClass(classId);
  if (bets.length === 0) return { resolved: [], championCut: 0, jackpotContribution: 0 };

  // Champion fell — "falls" wins, no champion's cut (champion lost)
  return resolveBetBatch(bets, 'falls', null);
}

// ── Challenge System Helpers ────────────────────────────────────

export async function subtractFromJackpot(amount) {
  if (amount <= 0) return;
  const now = new Date().toISOString();
  await client.send(new TransactWriteCommand({
    TransactItems: [{
      Update: {
        TableName: TABLE,
        Key: { PK: 'SYSTEM', SK: 'JACKPOT' },
        UpdateExpression: 'SET #t = if_not_exists(#t, :zero) - :amt, lastUpdated = :now',
        ExpressionAttributeNames: { '#t': 'total' },
        ExpressionAttributeValues: { ':amt': amount, ':zero': 0, ':now': now },
      },
    }],
  }));
}

export async function getSystemRecord(sk) {
  const { Item } = await client.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: 'SYSTEM', SK: sk },
  }));
  return Item || null;
}

export async function putSystemRecord(item) {
  await client.send(new PutCommand({
    TableName: TABLE,
    Item: item,
  }));
}

export async function deleteItem(key) {
  await client.send(new DeleteCommand({
    TableName: TABLE,
    Key: key,
  }));
}

export async function scanRecentMatches(sinceISO) {
  const items = [];
  let lastKey = undefined;
  do {
    const { Items, LastEvaluatedKey } = await client.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'begins_with(SK, :matchPrefix) AND createdAt >= :since',
      ExpressionAttributeValues: {
        ':matchPrefix': 'MATCH#',
        ':since': sinceISO,
      },
      ExclusiveStartKey: lastKey,
    }));
    if (Items) items.push(...Items);
    lastKey = LastEvaluatedKey;
  } while (lastKey);
  return items;
}

export async function getPlayerChallengeProgress(sub, weekId) {
  const { Item } = await client.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `PLAYER#${sub}`, SK: `CHALLENGE#${weekId}` },
  }));
  return Item || null;
}

export async function savePlayerChallengeProgress(sub, weekId, progress) {
  const now = new Date().toISOString();
  await client.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: `PLAYER#${sub}`,
      SK: `CHALLENGE#${weekId}`,
      progress,
      updatedAt: now,
    },
  }));
}

export async function awardCoins(sub, amount) {
  if (amount <= 0) return;
  await client.send(new TransactWriteCommand({
    TransactItems: [{
      Update: {
        TableName: TABLE,
        Key: { PK: `PLAYER#${sub}`, SK: 'PROFILE' },
        UpdateExpression: 'SET coins = if_not_exists(coins, :zero) + :amt',
        ExpressionAttributeValues: { ':amt': amount, ':zero': 0 },
      },
    }],
  }));
}

/** Deduct coins from the player's wallet. Used for in-dungeon vendor
 *  purchases. Returns true if the deduction succeeded, false if the player
 *  didn't have enough (server-side authoritative check). */
export async function deductCoins(sub, amount) {
  if (amount <= 0) return true;
  try {
    await client.send(new TransactWriteCommand({
      TransactItems: [{
        Update: {
          TableName: TABLE,
          Key: { PK: `PLAYER#${sub}`, SK: 'PROFILE' },
          UpdateExpression: 'SET coins = coins - :amt',
          ConditionExpression: 'attribute_exists(coins) AND coins >= :amt',
          ExpressionAttributeValues: { ':amt': amount },
        },
      }],
    }));
    return true;
  } catch (err) {
    if (err.name === 'TransactionCanceledException' ||
        err.message?.includes('ConditionalCheckFailed')) {
      return false;
    }
    throw err;
  }
}

// ── Stripe Payment Records ───────────────────────────────────────

export async function grantPurchasedCoins(sub, sessionId, packageId, coins, amountUsd) {
  const now = new Date().toISOString();
  await client.send(new TransactWriteCommand({
    TransactItems: [
      {
        Put: {
          TableName: TABLE,
          Item: {
            PK: `PLAYER#${sub}`,
            SK: `PAYMENT#${sessionId}`,
            coins,
            packageId,
            amountUsd,
            status: 'completed',
            createdAt: now,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
      {
        Update: {
          TableName: TABLE,
          Key: { PK: `PLAYER#${sub}`, SK: 'PROFILE' },
          UpdateExpression: 'SET coins = if_not_exists(coins, :zero) + :amt, updatedAt = :now',
          ExpressionAttributeValues: { ':amt': coins, ':zero': 0, ':now': now },
        },
      },
    ],
  }));
  const profile = await getProfile(sub);
  return { newCoins: profile?.coins || 0 };
}

export async function getPaymentRecord(sub, sessionId) {
  const { Item } = await client.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `PLAYER#${sub}`, SK: `PAYMENT#${sessionId}` },
  }));
  return Item || null;
}

export async function getPaymentHistory(sub, limit = 50) {
  const { Items = [] } = await client.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `PLAYER#${sub}`, ':prefix': 'PAYMENT#' },
    Limit: limit,
    ScanIndexForward: false,
  }));
  return Items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export async function refundPayment(sub, sessionId, refundId, coinsToDeduct) {
  const now = new Date().toISOString();
  // First try to deduct the full amount
  try {
    await client.send(new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: TABLE,
            Key: { PK: `PLAYER#${sub}`, SK: 'PROFILE' },
            UpdateExpression: 'SET coins = coins - :amt, updatedAt = :now',
            ConditionExpression: 'coins >= :amt',
            ExpressionAttributeValues: { ':amt': coinsToDeduct, ':now': now },
          },
        },
        {
          Update: {
            TableName: TABLE,
            Key: { PK: `PLAYER#${sub}`, SK: `PAYMENT#${sessionId}` },
            UpdateExpression: 'SET #s = :refunded, refundId = :rid, refundedAt = :now',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ':refunded': 'refunded', ':rid': refundId, ':now': now },
          },
        },
      ],
    }));
  } catch (err) {
    if (err.name === 'TransactionCanceledException') {
      // Player doesn't have enough coins — set to 0 and still mark refunded
      await client.send(new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: TABLE,
              Key: { PK: `PLAYER#${sub}`, SK: 'PROFILE' },
              UpdateExpression: 'SET coins = :zero, updatedAt = :now',
              ExpressionAttributeValues: { ':zero': 0, ':now': now },
            },
          },
          {
            Update: {
              TableName: TABLE,
              Key: { PK: `PLAYER#${sub}`, SK: `PAYMENT#${sessionId}` },
              UpdateExpression: 'SET #s = :refunded, refundId = :rid, refundedAt = :now',
              ExpressionAttributeNames: { '#s': 'status' },
              ExpressionAttributeValues: { ':refunded': 'refunded', ':rid': refundId, ':now': now },
            },
          },
        ],
      }));
    } else {
      throw err;
    }
  }
  const profile = await getProfile(sub);
  return { newCoins: profile?.coins || 0 };
}

// ── Wager Duel Escrow ────────────────────────────────────────────
export async function escrowCoins(sub, amount, challengeId) {
  await client.send(new TransactWriteCommand({
    TransactItems: [
      {
        Update: {
          TableName: TABLE,
          Key: { PK: `PLAYER#${sub}`, SK: 'PROFILE' },
          UpdateExpression: 'SET coins = coins - :amt, updatedAt = :now',
          ConditionExpression: 'coins >= :amt',
          ExpressionAttributeValues: { ':amt': amount, ':now': new Date().toISOString() },
        },
      },
      {
        Put: {
          TableName: TABLE,
          Item: {
            PK: 'SYSTEM',
            SK: `ESCROW#${challengeId}`,
            challengerSub: sub,
            amount,
            createdAt: new Date().toISOString(),
          },
        },
      },
    ],
  }));
}

export async function releaseEscrow(challengeId, recipientSub) {
  const escrow = await getSystemRecord(`ESCROW#${challengeId}`);
  if (!escrow) return;
  await client.send(new TransactWriteCommand({
    TransactItems: [
      {
        Update: {
          TableName: TABLE,
          Key: { PK: `PLAYER#${recipientSub}`, SK: 'PROFILE' },
          UpdateExpression: 'SET coins = if_not_exists(coins, :zero) + :amt, updatedAt = :now',
          ExpressionAttributeValues: { ':amt': escrow.amount, ':zero': 0, ':now': new Date().toISOString() },
        },
      },
      {
        Delete: {
          TableName: TABLE,
          Key: { PK: 'SYSTEM', SK: `ESCROW#${challengeId}` },
        },
      },
    ],
  }));
}

export async function refundEscrow(challengeId) {
  const escrow = await getSystemRecord(`ESCROW#${challengeId}`);
  if (!escrow) return;
  await releaseEscrow(challengeId, escrow.challengerSub);
}

// ── Async Wager Duel System ──────────────────────────────────────
const DUEL_PENDING_TTL_MS = 48 * 3600 * 1000;  // 48h
const DUEL_MATCH_WINDOW_MS = 24 * 3600 * 1000;  // 24h
const DUEL_HISTORY_TTL_MS = 7 * 24 * 3600 * 1000; // 7d for resolved duels

export async function createDuelWithEscrow(challengerSub, defenderSub, opts) {
  const { duelId, wager, amplifier, challengerClassId, challengerUsername, defenderUsername,
          challengerEloAtSend, defenderEloAtSend, createdAt } = opts;
  const ttl = Math.floor((Date.now() + DUEL_PENDING_TTL_MS + DUEL_HISTORY_TTL_MS) / 1000);

  await client.send(new TransactWriteCommand({
    TransactItems: [
      // 1. Escrow coins from challenger
      {
        Update: {
          TableName: TABLE,
          Key: { PK: `PLAYER#${challengerSub}`, SK: 'PROFILE' },
          UpdateExpression: 'SET coins = coins - :amt, updatedAt = :now',
          ConditionExpression: 'coins >= :amt',
          ExpressionAttributeValues: { ':amt': wager, ':now': createdAt },
        },
      },
      // 2. Create escrow record
      {
        Put: {
          TableName: TABLE,
          Item: { PK: 'SYSTEM', SK: `ESCROW#${duelId}`, challengerSub, amount: wager, createdAt },
        },
      },
      // 3. Create main duel record
      {
        Put: {
          TableName: TABLE,
          Item: {
            PK: 'SYSTEM', SK: `DUEL#${duelId}`,
            duelId, challengerSub, defenderSub, challengerUsername, defenderUsername,
            challengerClassId, defenderClassId: null,
            challengerEloAtSend, defenderEloAtSend, wager, amplifier,
            status: 'pending', createdAt,
            acceptedAt: null, matchWindowExpiresAt: null,
            challengerReadyAt: null, defenderReadyAt: null,
            resolvedAt: null, winnerSub: null, matchId: null,
            TTL: ttl,
          },
        },
      },
      // 4. Outgoing pointer for challenger
      {
        Put: {
          TableName: TABLE,
          Item: {
            PK: `PLAYER#${challengerSub}`, SK: `DUEL_OUT#${duelId}`,
            duelId, opponentSub: defenderSub, opponentUsername: defenderUsername,
            wager, amplifier, status: 'pending', challengerClassId, createdAt, TTL: ttl,
          },
        },
      },
      // 5. Incoming pointer for defender
      {
        Put: {
          TableName: TABLE,
          Item: {
            PK: `PLAYER#${defenderSub}`, SK: `DUEL_IN#${duelId}`,
            duelId, opponentSub: challengerSub, opponentUsername: challengerUsername,
            opponentClassId: challengerClassId, opponentEloAtSend: challengerEloAtSend,
            wager, amplifier, status: 'pending', createdAt, TTL: ttl,
          },
        },
      },
    ],
  }));
}

export async function getDuel(duelId) {
  const { Item } = await client.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: 'SYSTEM', SK: `DUEL#${duelId}` },
  }));
  return Item || null;
}

export async function acceptDuel(duelId, defenderClassId, defenderSub, challengerSub, matchWindowExpiresAt) {
  const now = new Date().toISOString();
  const ttl = Math.floor((Date.now() + DUEL_MATCH_WINDOW_MS + DUEL_HISTORY_TTL_MS) / 1000);

  await client.send(new TransactWriteCommand({
    TransactItems: [
      // 1. Update main duel record
      {
        Update: {
          TableName: TABLE,
          Key: { PK: 'SYSTEM', SK: `DUEL#${duelId}` },
          UpdateExpression: 'SET #s = :accepted, defenderClassId = :cls, acceptedAt = :now, matchWindowExpiresAt = :mwe, #ttl = :ttl',
          ConditionExpression: '#s = :pending',
          ExpressionAttributeNames: { '#s': 'status', '#ttl': 'TTL' },
          ExpressionAttributeValues: { ':accepted': 'accepted', ':pending': 'pending', ':cls': defenderClassId, ':now': now, ':mwe': matchWindowExpiresAt, ':ttl': ttl },
        },
      },
      // 2. Update outgoing pointer
      {
        Update: {
          TableName: TABLE,
          Key: { PK: `PLAYER#${challengerSub}`, SK: `DUEL_OUT#${duelId}` },
          UpdateExpression: 'SET #s = :accepted, #ttl = :ttl',
          ExpressionAttributeNames: { '#s': 'status', '#ttl': 'TTL' },
          ExpressionAttributeValues: { ':accepted': 'accepted', ':ttl': ttl },
        },
      },
      // 3. Update incoming pointer
      {
        Update: {
          TableName: TABLE,
          Key: { PK: `PLAYER#${defenderSub}`, SK: `DUEL_IN#${duelId}` },
          UpdateExpression: 'SET #s = :accepted, #ttl = :ttl',
          ExpressionAttributeNames: { '#s': 'status', '#ttl': 'TTL' },
          ExpressionAttributeValues: { ':accepted': 'accepted', ':ttl': ttl },
        },
      },
      // 4. Create ACTIVE_DUEL lock for defender (atomic guard)
      {
        Put: {
          TableName: TABLE,
          Item: { PK: `PLAYER#${defenderSub}`, SK: 'ACTIVE_DUEL', duelId, role: 'defender', opponentSub: challengerSub, acceptedAt: now },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
      // 5. Create ACTIVE_DUEL lock for challenger (atomic guard)
      {
        Put: {
          TableName: TABLE,
          Item: { PK: `PLAYER#${challengerSub}`, SK: 'ACTIVE_DUEL', duelId, role: 'challenger', opponentSub: defenderSub, acceptedAt: now },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
    ],
  }));
}

export async function cancelDuel(duelId, challengerSub, defenderSub) {
  const now = new Date().toISOString();
  await client.send(new TransactWriteCommand({
    TransactItems: [
      {
        Update: {
          TableName: TABLE,
          Key: { PK: 'SYSTEM', SK: `DUEL#${duelId}` },
          UpdateExpression: 'SET #s = :cancelled, resolvedAt = :now',
          ConditionExpression: '#s = :pending',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':cancelled': 'cancelled', ':pending': 'pending', ':now': now },
        },
      },
      { Delete: { TableName: TABLE, Key: { PK: `PLAYER#${challengerSub}`, SK: `DUEL_OUT#${duelId}` } } },
      { Delete: { TableName: TABLE, Key: { PK: `PLAYER#${defenderSub}`, SK: `DUEL_IN#${duelId}` } } },
    ],
  }));
}

export async function declineDuel(duelId, challengerSub, defenderSub) {
  const now = new Date().toISOString();
  await client.send(new TransactWriteCommand({
    TransactItems: [
      {
        Update: {
          TableName: TABLE,
          Key: { PK: 'SYSTEM', SK: `DUEL#${duelId}` },
          UpdateExpression: 'SET #s = :declined, resolvedAt = :now',
          ConditionExpression: '#s = :pending',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':declined': 'declined', ':pending': 'pending', ':now': now },
        },
      },
      { Delete: { TableName: TABLE, Key: { PK: `PLAYER#${challengerSub}`, SK: `DUEL_OUT#${duelId}` } } },
      { Delete: { TableName: TABLE, Key: { PK: `PLAYER#${defenderSub}`, SK: `DUEL_IN#${duelId}` } } },
    ],
  }));
}

export async function markDuelReady(duelId, readyField, timestamp) {
  await client.send(new TransactWriteCommand({
    TransactItems: [{
      Update: {
        TableName: TABLE,
        Key: { PK: 'SYSTEM', SK: `DUEL#${duelId}` },
        UpdateExpression: `SET ${readyField} = :ts`,
        ConditionExpression: '#s = :accepted',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':ts': timestamp, ':accepted': 'accepted' },
      },
    }],
  }));
}

export async function clearDuelReady(duelId, readyField) {
  await client.send(new TransactWriteCommand({
    TransactItems: [{
      Update: {
        TableName: TABLE,
        Key: { PK: 'SYSTEM', SK: `DUEL#${duelId}` },
        UpdateExpression: `SET ${readyField} = :n`,
        ExpressionAttributeValues: { ':n': null },
      },
    }],
  }));
}

export async function transitionDuelToInProgress(duelId) {
  await client.send(new TransactWriteCommand({
    TransactItems: [{
      Update: {
        TableName: TABLE,
        Key: { PK: 'SYSTEM', SK: `DUEL#${duelId}` },
        UpdateExpression: 'SET #s = :ip',
        ConditionExpression: '#s = :accepted',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':ip': 'in_progress', ':accepted': 'accepted' },
      },
    }],
  }));
}

export async function resolveDuel(duelId, winnerSub, status = 'resolved') {
  const now = new Date().toISOString();
  await client.send(new TransactWriteCommand({
    TransactItems: [{
      Update: {
        TableName: TABLE,
        Key: { PK: 'SYSTEM', SK: `DUEL#${duelId}` },
        UpdateExpression: 'SET #s = :st, winnerSub = :w, resolvedAt = :now',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':st': status, ':w': winnerSub, ':now': now },
      },
    }],
  }));
}

export async function clearActiveDuelLock(sub) {
  try {
    await client.send(new DeleteCommand({
      TableName: TABLE,
      Key: { PK: `PLAYER#${sub}`, SK: 'ACTIVE_DUEL' },
    }));
  } catch (_) { /* ignore if not exists */ }
}

export async function getPlayerDuelInbox(sub) {
  // Query all DUEL_IN# and DUEL_OUT# for this player
  const [inResult, outResult, activeLock] = await Promise.all([
    client.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `PLAYER#${sub}`, ':prefix': 'DUEL_IN#' },
    })),
    client.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `PLAYER#${sub}`, ':prefix': 'DUEL_OUT#' },
    })),
    client.send(new GetCommand({
      TableName: TABLE,
      Key: { PK: `PLAYER#${sub}`, SK: 'ACTIVE_DUEL' },
    })),
  ]);

  const incoming = (inResult.Items || []).filter(d => d.status === 'pending');
  const outgoing = (outResult.Items || []).filter(d => d.status === 'pending');
  const active = activeLock.Item || null;

  // If there's an active duel, load the full duel record
  let activeDuel = null;
  if (active) {
    activeDuel = await getDuel(active.duelId);
  }

  return { incoming, outgoing, active: activeDuel };
}

export async function getPlayerDuelsOutgoing(sub) {
  const result = await client.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `PLAYER#${sub}`, ':prefix': 'DUEL_OUT#' },
  }));
  return result.Items || [];
}

export async function getExpiredPendingDuels() {
  const cutoff = new Date(Date.now() - DUEL_PENDING_TTL_MS).toISOString();
  const result = await client.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    FilterExpression: '#s = :pending AND createdAt < :cutoff',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':pk': 'SYSTEM', ':prefix': 'DUEL#', ':pending': 'pending', ':cutoff': cutoff },
  }));
  return result.Items || [];
}

export async function getExpiredAcceptedDuels() {
  const now = new Date().toISOString();
  const result = await client.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    FilterExpression: '#s = :accepted AND matchWindowExpiresAt < :now',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':pk': 'SYSTEM', ':prefix': 'DUEL#', ':accepted': 'accepted', ':now': now },
  }));
  return result.Items || [];
}

// ── Duel Metrics ──
export async function recordDuelMetric(event, data) {
  await client.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: 'SYSTEM',
      SK: `DUEL_METRIC#${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      event, // 'sent', 'accepted', 'declined', 'cancelled', 'expired', 'resolved', 'forfeit'
      ...data,
      createdAt: new Date().toISOString(),
      TTL: Math.floor(Date.now() / 1000) + 90 * 86400, // 90-day retention
    },
  }));
}

export async function getDuelMetrics(sinceISO) {
  const result = await client.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    FilterExpression: 'createdAt >= :since',
    ExpressionAttributeValues: { ':pk': 'SYSTEM', ':prefix': 'DUEL_METRIC#', ':since': sinceISO },
  }));
  return result.Items || [];
}

// Award practice XP + coins for AI matches (reduced rates)
// After account level 5, only Hard difficulty grants rewards
export async function awardPracticeReward(sub, classId, won, difficulty = 'hard', perfScore = 0) {
  const profile = await getProfile(sub);
  if (!profile) return null;

  const accountLevel = profile.accountLevel || 0;

  // AI XP gating: after level 5, only Hard AI grants rewards
  if (accountLevel >= 6 && difficulty !== 'hard') {
    return { xpEarned: 0, coinsEarned: 0, gated: true, classMastery: null, levelUps: 0, masteryCoinsEarned: 0, accountXp: profile.accountXp || 0, accountLevel, accountLevelUps: 0, accountMilestoneCoins: 0, seasonXp: profile.seasonXp || 0, seasonTier: profile.seasonTier || 0, bpTiersGained: 0, bpCoinsEarned: 0, bpNewRewards: [] };
  }

  // Wins: 25 XP flat. Losses: 0-10 XP based on individual performance.
  const xpEarned = won ? 25 : Math.round(10 * Math.min(1, Math.max(0, perfScore) / 100));
  const coinsEarned = won ? 5 : 0;

  // ── Class mastery XP ──
  const currentMastery = profile.classMastery ? { ...profile.classMastery } : {};
  const cm = currentMastery[classId] ? { ...currentMastery[classId] } : { xp: 0, level: 0 };
  const oldLevel = cm.level || 0;
  cm.xp = (cm.xp || 0) + xpEarned;
  cm.level = computeLevel(cm.xp);
  currentMastery[classId] = cm;

  // Check mastery milestone rewards
  let masteryCoinsEarned = 0;
  const inventory = [...(profile.inventory || [])];
  for (let lvl = oldLevel + 1; lvl <= cm.level; lvl++) {
    const milestone = MASTERY_MILESTONES[lvl];
    if (!milestone) continue;
    if (milestone.coins) masteryCoinsEarned += milestone.coins;
    if (milestone.title) {
      const titleId = MASTERY_TITLE_MAP[classId];
      if (titleId && !inventory.includes(titleId)) inventory.push(titleId);
    }
  }

  // ── Account XP ──
  const oldAccountXp = profile.accountXp || 0;
  const oldAccountLevel = profile.accountLevel || 0;
  const newAccountXp = oldAccountXp + xpEarned;
  const newAccountLevel = computeAccountLevel(newAccountXp);
  const accountLevelUps = newAccountLevel - oldAccountLevel;

  let accountMilestoneCoins = 0;
  for (let lvl = oldAccountLevel + 1; lvl <= newAccountLevel; lvl++) {
    const milestone = getAccountMilestone(lvl);
    if (!milestone) continue;
    if (milestone.coins) accountMilestoneCoins += milestone.coins;
    if (milestone.title && !inventory.includes(milestone.title)) {
      inventory.push(milestone.title);
    }
  }

  // ── Battle Pass Season XP ──
  const seasonConfig = await getSeasonConfig();
  const bpResult = processBattlePassProgression(profile, xpEarned, seasonConfig);
  let bpCoinsEarned = 0;
  if (bpResult) {
    bpCoinsEarned = bpResult.bpCoinsEarned;
    for (const itemId of bpResult.newInventoryItems) {
      if (!inventory.includes(itemId)) inventory.push(itemId);
    }
  }

  const totalCoins = coinsEarned + masteryCoinsEarned + accountMilestoneCoins + bpCoinsEarned;
  const newCoins = (profile.coins || 0) + totalCoins;
  const levelUps = cm.level - oldLevel;
  const inventoryChanged = inventory.length !== (profile.inventory || []).length;

  let updateExpr = 'SET classMastery = :mastery, coins = :coins, updatedAt = :now, accountXp = :accXp, accountLevel = :accLvl, seasonXp = :sXp, seasonTier = :sTier, seasonId = :sId, seasonRewardsClaimed = :sRc';
  const exprValues = {
    ':mastery': currentMastery,
    ':coins': newCoins,
    ':now': new Date().toISOString(),
    ':accXp': newAccountXp,
    ':accLvl': newAccountLevel,
    ':sXp': bpResult?.seasonXp ?? (profile.seasonXp || 0),
    ':sTier': bpResult?.seasonTier ?? (profile.seasonTier || 0),
    ':sId': bpResult?.seasonId ?? profile.seasonId ?? null,
    ':sRc': bpResult?.seasonRewardsClaimed ?? (profile.seasonRewardsClaimed || []),
  };
  if (inventoryChanged) {
    updateExpr += ', inventory = :inv';
    exprValues[':inv'] = inventory;
  }
  if (bpResult?.seasonHistory && Object.keys(bpResult.seasonHistory).length > 0) {
    updateExpr += ', seasonHistory = :sHist';
    exprValues[':sHist'] = bpResult.seasonHistory;
  }

  await client.send(new TransactWriteCommand({
    TransactItems: [{
      Update: {
        TableName: TABLE,
        Key: { PK: `PLAYER#${sub}`, SK: 'PROFILE' },
        UpdateExpression: updateExpr,
        ExpressionAttributeValues: exprValues,
      },
    }],
  }));

  return { coinsEarned: totalCoins, newCoins, xpEarned, classMastery: cm, levelUps, masteryCoinsEarned, accountXp: newAccountXp, accountLevel: newAccountLevel, accountLevelUps, accountMilestoneCoins, seasonXp: bpResult?.seasonXp, seasonTier: bpResult?.seasonTier, bpTiersGained: bpResult?.tiersGained || 0, bpCoinsEarned, bpNewRewards: bpResult?.newRewards || [] };
}

/**
 * Record an AI/practice match for admin analytics. Writes a MATCH# record
 * with mode='ai' so the existing admin scan picks them up; admin UI can
 * filter to ranked-only or include AI matches as needed.
 *
 * Schema mirrors the ranked match record so the same display works for both:
 *   PK: PLAYER#<sub>, SK: MATCH#<iso>#<matchId>
 *   result: 'win' | 'loss', mode: 'ai',
 *   playerClass, opponentClass, opponentUsername (always 'AI'),
 *   eloChange (always 0 for AI), duration, difficulty, timestamp
 */
export async function recordAIMatch({ sub, classId, opponentClass, won, difficulty, durationSec }) {
  const ts = new Date().toISOString();
  const matchId = Math.random().toString(36).slice(2, 12);
  const profile = await getProfile(sub);
  await client.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: `PLAYER#${sub}`,
      SK: `MATCH#${ts}#${matchId}`,
      matchId,
      mode: 'ai',
      result: won ? 'win' : 'loss',
      playerClass: classId,
      opponentClass: opponentClass || 'unknown',
      opponentUsername: 'AI',
      eloChange: 0,
      duration: Math.round(durationSec || 0),
      difficulty: difficulty || 'medium',
      timestamp: ts,
      playerUsername: profile?.username || null,
    },
  }));
}

/**
 * Record a complete dungeon run for analytics — used to track clear rates,
 * average run time, deaths-per-room, popular upgrades, etc. so we can
 * actually balance the dungeon based on real data.
 *
 * Schema:
 *   PK: PLAYER#<sub>, SK: DUNGEON#<iso>#<runId>
 *   themeId, classId, result ('victory'|'defeat'),
 *   roomsCleared, totalRooms, durationSec,
 *   coinsEarned, upgradesPicked[], diedInRoom?, diedToMonsterId?
 *
 * Plus a per-theme aggregate at SYSTEM/DUNGEON_STATS#<themeId> for fast
 * "average clear time" / "completion rate" queries without scanning.
 */
export async function recordDungeonRun({ sub, themeId, classId, result, roomsCleared, totalRooms, durationSec, coinsEarned, upgradesPicked, diedInRoom, diedToMonsterId }) {
  const ts = new Date().toISOString();
  const runId = Math.random().toString(36).slice(2, 12);
  await client.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: `PLAYER#${sub}`,
      SK: `DUNGEON#${ts}#${runId}`,
      runId,
      themeId,
      classId,
      result,
      roomsCleared: Math.round(roomsCleared || 0),
      totalRooms: Math.round(totalRooms || 0),
      durationSec: Math.round(durationSec || 0),
      coinsEarned: Math.round(coinsEarned || 0),
      upgradesPicked: upgradesPicked || [],
      diedInRoom: diedInRoom ?? null,
      diedToMonsterId: diedToMonsterId || null,
      timestamp: ts,
    },
  }));
}

/**
 * Clear an account's ban + force a fresh username on next login.
 * Used by the appeal flow — banned user agrees to pick a new name.
 * Releases the username back to the pool so it can't be re-claimed.
 */
export async function adminClearBan(sub) {
  // First read the current profile so we know the old username to release
  const { Item: profile } = await client.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `PLAYER#${sub}`, SK: 'PROFILE' },
  }));
  const oldUsername = profile?.username;

  // Clear the ban + username so the next login takes the user back through
  // the username-pick flow with the profanity filter active.
  await client.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `PLAYER#${sub}`, SK: 'PROFILE' },
    UpdateExpression: 'REMOVE banned, banReason, username',
  }));

  // Release the old username reservation if there was one
  if (oldUsername) {
    try {
      await client.send(new DeleteCommand({
        TableName: TABLE,
        Key: { PK: `USERNAME#${oldUsername.toLowerCase()}`, SK: 'RESERVATION' },
      }));
    } catch (err) {
      console.warn(`[adminClearBan] could not release username ${oldUsername}:`, err.message);
    }
  }
}

export async function incrementChallengeCompletions(weekId, challengeId, reward) {
  // Update the active challenges record
  const record = await getSystemRecord('WEEKLY_CHALLENGES');
  if (!record || record.weekId !== weekId) return;

  for (const c of record.challenges) {
    if (c.id === challengeId) {
      c.completions = (c.completions || 0) + 1;
      break;
    }
  }
  record.totalDistributed = (record.totalDistributed || 0) + reward;

  await putSystemRecord(record);
}
