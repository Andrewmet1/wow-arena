import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const TABLE = process.env.DYNAMO_TABLE || 'EbonCrucible';
const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' })
);

// Search players by username prefix (case-insensitive via USERNAME# keys)
// If no query, return all players (up to limit)
export async function searchPlayers(query, limit = 20) {
  if (!query || query.length < 2) {
    // Return all profiles
    const { Items } = await client.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'SK = :sk',
      ExpressionAttributeValues: { ':sk': 'PROFILE' },
      Limit: 200,
    }));
    return (Items || []).slice(0, limit).map(p => ({
      sub: p.PK.replace('PLAYER#', ''),
      username: p.username,
      elo: p.elo,
      coins: p.coins || 0,
      wins: p.wins,
      losses: p.losses,
      avatarClass: p.avatarClass || null,
      banned: p.banned || false,
      createdAt: p.createdAt,
    }));
  }
  const lower = query.toLowerCase();

  // Scan USERNAME# reservation keys matching prefix
  const { Items } = await client.send(new ScanCommand({
    TableName: TABLE,
    FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
    ExpressionAttributeValues: {
      ':prefix': `USERNAME#${lower}`,
      ':sk': 'RESERVATION',
    },
    Limit: 100,
  }));

  if (!Items || Items.length === 0) return [];

  // Fetch full profiles for matched usernames
  const profiles = await Promise.all(
    Items.slice(0, limit).map(async (item) => {
      const { Item } = await client.send(new GetCommand({
        TableName: TABLE,
        Key: { PK: `PLAYER#${item.cognitoSub}`, SK: 'PROFILE' },
      }));
      return Item || null;
    })
  );

  return profiles.filter(Boolean).map(p => ({
    sub: p.PK.replace('PLAYER#', ''),
    username: p.username,
    elo: p.elo,
    coins: p.coins || 0,
    wins: p.wins,
    losses: p.losses,
    avatarClass: p.avatarClass || null,
    banned: p.banned || false,
    createdAt: p.createdAt,
  }));
}

// Get full player details for admin view
export async function getPlayerFull(sub) {
  const { Item } = await client.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `PLAYER#${sub}`, SK: 'PROFILE' },
  }));
  if (!Item) return null;

  // Also fetch recent match history
  const { Items: matches } = await client.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': `PLAYER#${sub}`,
      ':prefix': 'MATCH#',
    },
    ScanIndexForward: false,
    Limit: 20,
  }));

  return {
    sub: Item.PK.replace('PLAYER#', ''),
    username: Item.username,
    elo: Item.elo,
    wins: Item.wins,
    losses: Item.losses,
    classStats: Item.classStats || {},
    classMastery: Item.classMastery || {},
    avatarClass: Item.avatarClass || null,
    peakElo: Item.peakElo || Item.elo,
    seasonHighElo: Item.seasonHighElo || Item.elo,
    currentStreak: Item.currentStreak || 0,
    bestWinStreak: Item.bestWinStreak || 0,
    totalPlayTime: Item.totalPlayTime || 0,
    coins: Item.coins || 0,
    inventory: Item.inventory || [],
    banned: Item.banned || false,
    lastUsernameChange: Item.lastUsernameChange || null,
    createdAt: Item.createdAt,
    updatedAt: Item.updatedAt,
    recentMatches: matches || [],
  };
}

// Get aggregate stats for balance dashboard
export async function getAggregateStats() {
  // Get all leaderboard entries (up to 200 for small-scale)
  const { Items } = await client.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': 'LEADERBOARD' },
    ScanIndexForward: false,
    Limit: 200,
  }));

  const players = Items || [];
  const classIds = ['tyrant', 'wraith', 'infernal', 'harbinger', 'revenant'];

  // ELO distribution buckets
  const eloBuckets = { '<1200': 0, '1200-1399': 0, '1400-1599': 0, '1600-1799': 0, '1800-1999': 0, '2000+': 0 };

  // Per-class aggregates
  const classAgg = {};
  for (const cid of classIds) {
    classAgg[cid] = { totalGames: 0, totalWins: 0, playerCount: 0 };
  }

  for (const p of players) {
    // ELO distribution
    const elo = p.elo || 1500;
    if (elo >= 2000) eloBuckets['2000+']++;
    else if (elo >= 1800) eloBuckets['1800-1999']++;
    else if (elo >= 1600) eloBuckets['1600-1799']++;
    else if (elo >= 1400) eloBuckets['1400-1599']++;
    else if (elo >= 1200) eloBuckets['1200-1399']++;
    else eloBuckets['<1200']++;

    // Per-class stats
    const cs = p.classStats || {};
    for (const cid of classIds) {
      if (cs[cid]) {
        classAgg[cid].totalGames += cs[cid].gamesPlayed || 0;
        classAgg[cid].totalWins += cs[cid].wins || 0;
        if (cs[cid].gamesPlayed > 0) classAgg[cid].playerCount++;
      }
    }
  }

  // Compute win rates and pick rates
  const totalGamesAll = Object.values(classAgg).reduce((s, c) => s + c.totalGames, 0);
  const classBalance = {};
  for (const cid of classIds) {
    const c = classAgg[cid];
    classBalance[cid] = {
      totalGames: c.totalGames,
      winRate: c.totalGames > 0 ? Math.round((c.totalWins / c.totalGames) * 100) : 0,
      pickRate: totalGamesAll > 0 ? Math.round((c.totalGames / totalGamesAll) * 100) : 0,
      playerCount: c.playerCount,
    };
  }

  return {
    totalPlayers: players.length,
    eloBuckets,
    classBalance,
    averageElo: players.length > 0 ? Math.round(players.reduce((s, p) => s + (p.elo || 1500), 0) / players.length) : 1500,
  };
}

// Get recent matches across all players for admin match feed
export async function getRecentMatches(limit = 50) {
  // Paginated scan — DynamoDB's Limit is items EVALUATED not returned, so a
  // single scan with Limit=N usually misses recent matches when the table has
  // thousands of non-match rows. Iterate until we've seen the full table or
  // collected enough winner records.
  const items = [];
  let ExclusiveStartKey;
  do {
    const resp = await client.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'begins_with(SK, :prefix) AND #r = :win',
      ExpressionAttributeNames: { '#r': 'result' },
      ExpressionAttributeValues: {
        ':prefix': 'MATCH#',
        ':win': 'win',
      },
      ExclusiveStartKey,
    }));
    if (resp.Items) items.push(...resp.Items);
    ExclusiveStartKey = resp.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  const top = items
    .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
    .slice(0, limit);

  // Resolve winner sub → username. Use the per-match playerUsername if it's
  // there (AI matches save it), otherwise batch-fetch profiles for the rest.
  const subsToFetch = new Set();
  for (const m of top) {
    if (!m.playerUsername) {
      const sub = m.PK?.replace('PLAYER#', '');
      if (sub) subsToFetch.add(sub);
    }
  }
  const usernameBySub = new Map();
  await Promise.all([...subsToFetch].map(async sub => {
    try {
      const { Item } = await client.send(new GetCommand({
        TableName: TABLE,
        Key: { PK: `PLAYER#${sub}`, SK: 'PROFILE' },
        ProjectionExpression: 'username',
      }));
      if (Item?.username) usernameBySub.set(sub, Item.username);
    } catch {}
  }));

  return top.map(m => {
    const sub = m.PK?.replace('PLAYER#', '');
    return {
      matchId: m.matchId,
      winner: sub,
      winnerUsername: m.playerUsername || usernameBySub.get(sub) || null,
      playerClass: m.playerClass,
      opponentUsername: m.opponentUsername,
      opponentClass: m.opponentClass,
      eloChange: m.eloChange,
      duration: m.duration,
      mode: m.mode || null,
      difficulty: m.difficulty || null,
      timestamp: m.timestamp,
    };
  });
}

// Count total accounts (cached externally)
export async function countPlayers() {
  const { Count } = await client.send(new ScanCommand({
    TableName: TABLE,
    FilterExpression: 'SK = :sk',
    ExpressionAttributeValues: { ':sk': 'PROFILE' },
    Select: 'COUNT',
  }));
  return Count || 0;
}

// ── Balance Analytics ────────────────────────────────────────────

const CLASS_IDS = ['tyrant', 'wraith', 'infernal', 'harbinger', 'revenant'];

function matchupKey(a, b) { return [a, b].sort().join('_vs_'); }

function eloBracket(elo) {
  if (!elo || elo < 1200) return '<1200';
  if (elo < 1500) return '1200-1500';
  if (elo < 1800) return '1500-1800';
  return '1800+';
}

// Fast path: get pre-computed aggregate
export async function getBalanceAggregate() {
  const { Item } = await client.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: 'SYSTEM', SK: 'BALANCE_AGGREGATE' },
  }));
  return Item || null;
}

// Slow path: scan all win records with optional filters
export async function scanMatchRecords({ fromDate, toDate, mode } = {}) {
  const allMatches = [];
  let lastKey = undefined;

  do {
    const params = {
      TableName: TABLE,
      FilterExpression: 'begins_with(SK, :prefix) AND #r = :win',
      ExpressionAttributeNames: { '#r': 'result' },
      ExpressionAttributeValues: {
        ':prefix': 'MATCH#',
        ':win': 'win',
      },
    };

    if (fromDate) {
      params.FilterExpression += ' AND #ts >= :from';
      params.ExpressionAttributeNames['#ts'] = 'timestamp';
      params.ExpressionAttributeValues[':from'] = fromDate;
    }
    if (toDate) {
      params.FilterExpression += ' AND #ts <= :to';
      if (!params.ExpressionAttributeNames['#ts']) params.ExpressionAttributeNames['#ts'] = 'timestamp';
      params.ExpressionAttributeValues[':to'] = toDate;
    }
    if (mode) {
      params.FilterExpression += ' AND (#mode = :mode OR attribute_not_exists(#mode))';
      params.ExpressionAttributeNames['#mode'] = 'mode';
      params.ExpressionAttributeValues[':mode'] = mode;
    }

    if (lastKey) params.ExclusiveStartKey = lastKey;

    const result = await client.send(new ScanCommand(params));
    allMatches.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return allMatches;
}

// Transform raw win records into 5x5 matrix + bracket breakdowns
export function computeBalanceFromMatches(matches) {
  const BRACKETS = ['<1200', '1200-1500', '1500-1800', '1800+'];
  const matchups = {};
  const brackets = {};
  for (const b of BRACKETS) brackets[b] = { matchups: {}, totalMatches: 0 };

  for (const m of matches) {
    const winnerClass = m.playerClass;
    const loserClass = m.opponentClass;
    if (!winnerClass || !loserClass) continue;

    const key = matchupKey(winnerClass, loserClass);
    const sorted = [winnerClass, loserClass].sort();
    const winnerIsA = sorted[0] === winnerClass;

    if (!matchups[key]) matchups[key] = { wins_a: 0, wins_b: 0, totalDuration: 0, count: 0 };
    const mu = matchups[key];
    if (winnerIsA) mu.wins_a++; else mu.wins_b++;
    mu.totalDuration += m.duration || 0;
    mu.count++;

    // ELO bracket
    const playerElo = m.playerElo || (m.opponentElo ? m.opponentElo + (m.eloChange || 0) : null);
    const opponentElo = m.opponentElo;
    if (playerElo && opponentElo) {
      const bracket = eloBracket(Math.round((playerElo + opponentElo) / 2));
      if (!brackets[bracket].matchups[key]) {
        brackets[bracket].matchups[key] = { wins_a: 0, wins_b: 0, totalDuration: 0, count: 0 };
      }
      const brMu = brackets[bracket].matchups[key];
      if (winnerIsA) brMu.wins_a++; else brMu.wins_b++;
      brMu.totalDuration += m.duration || 0;
      brMu.count++;
      brackets[bracket].totalMatches++;
    }
  }

  // Build readable 5x5 matrix
  const matrix = buildMatrix(matchups);

  // Per-bracket matrices
  const bracketMatrices = {};
  for (const bName of BRACKETS) {
    bracketMatrices[bName] = {
      matrix: buildMatrix(brackets[bName].matchups),
      totalMatches: brackets[bName].totalMatches,
    };
  }

  // Class popularity per bracket
  const classByBracket = {};
  for (const bName of BRACKETS) {
    classByBracket[bName] = {};
    for (const c of CLASS_IDS) classByBracket[bName][c] = 0;
  }
  for (const m of matches) {
    const elo = m.playerElo || m.opponentElo;
    if (elo && classByBracket[eloBracket(elo)]?.[m.playerClass] !== undefined) {
      classByBracket[eloBracket(elo)][m.playerClass]++;
    }
  }

  return { matrix, totalMatches: matches.length, bracketMatrices, classByBracket };
}

function buildMatrix(matchups) {
  const matrix = {};
  for (const a of CLASS_IDS) {
    matrix[a] = {};
    for (const b of CLASS_IDS) {
      if (a === b) { matrix[a][b] = { winRate: 50, games: 0, avgDuration: 0 }; continue; }
      const key = matchupKey(a, b);
      const mu = matchups[key];
      if (!mu || mu.count === 0) { matrix[a][b] = { winRate: 50, games: 0, avgDuration: 0 }; continue; }
      const sorted = [a, b].sort();
      const aIsFirst = sorted[0] === a;
      const winsForA = aIsFirst ? mu.wins_a : mu.wins_b;
      matrix[a][b] = {
        winRate: Math.round((winsForA / mu.count) * 1000) / 10,
        games: mu.count,
        avgDuration: Math.round(mu.totalDuration / mu.count),
      };
    }
  }
  return matrix;
}

// Build matrix from raw aggregate record for a specific bracket
export function computeBalanceFromAggregate(agg, bracket) {
  if (!agg) return { matrix: buildMatrix({}), totalMatches: 0, bracketMatrices: {}, classByBracket: {} };

  if (bracket && bracket !== 'all' && agg.brackets?.[bracket]) {
    return {
      matrix: buildMatrix(agg.brackets[bracket].matchups || {}),
      totalMatches: agg.brackets[bracket].totalMatches || 0,
    };
  }

  return {
    matrix: buildMatrix(agg.matchups || {}),
    totalMatches: agg.totalMatches || 0,
    brackets: Object.fromEntries(
      Object.entries(agg.brackets || {}).map(([k, v]) => [k, {
        matrix: buildMatrix(v.matchups || {}),
        totalMatches: v.totalMatches || 0,
      }])
    ),
  };
}

// Rescan all matches and rebuild the aggregate from scratch
export async function rebuildBalanceAggregate() {
  const matches = await scanMatchRecords();
  const computed = computeBalanceFromMatches(matches);

  // Rebuild raw matchup/bracket data for the aggregate
  const BRACKETS = ['<1200', '1200-1500', '1500-1800', '1800+'];
  const rawMatchups = {};
  const rawBrackets = {};
  for (const b of BRACKETS) rawBrackets[b] = { matchups: {}, totalMatches: 0 };

  for (const m of matches) {
    const winnerClass = m.playerClass;
    const loserClass = m.opponentClass;
    if (!winnerClass || !loserClass) continue;

    const key = matchupKey(winnerClass, loserClass);
    const sorted = [winnerClass, loserClass].sort();
    const winnerIsA = sorted[0] === winnerClass;

    if (!rawMatchups[key]) rawMatchups[key] = { wins_a: 0, wins_b: 0, totalDuration: 0, count: 0 };
    const mu = rawMatchups[key];
    if (winnerIsA) mu.wins_a++; else mu.wins_b++;
    mu.totalDuration += m.duration || 0;
    mu.count++;

    const playerElo = m.playerElo || (m.opponentElo ? m.opponentElo + (m.eloChange || 0) : null);
    const opponentElo = m.opponentElo;
    if (playerElo && opponentElo) {
      const bracket = eloBracket(Math.round((playerElo + opponentElo) / 2));
      if (!rawBrackets[bracket].matchups[key]) {
        rawBrackets[bracket].matchups[key] = { wins_a: 0, wins_b: 0, totalDuration: 0, count: 0 };
      }
      const brMu = rawBrackets[bracket].matchups[key];
      if (winnerIsA) brMu.wins_a++; else brMu.wins_b++;
      brMu.totalDuration += m.duration || 0;
      brMu.count++;
      rawBrackets[bracket].totalMatches++;
    }
  }

  const now = new Date().toISOString();
  const agg = {
    PK: 'SYSTEM',
    SK: 'BALANCE_AGGREGATE',
    totalMatches: matches.length,
    matchups: rawMatchups,
    brackets: rawBrackets,
    lastUpdated: now,
    lastRebuilt: now,
  };

  await client.send(new PutCommand({ TableName: TABLE, Item: agg }));
  return computed;
}

// ── Admin Player Management ──────────────────────────────────────

// Update specific fields on a player profile
export async function adminUpdatePlayer(sub, updates) {
  const allowed = ['elo', 'coins', 'wins', 'losses', 'banned', 'peakElo', 'seasonHighElo', 'currentStreak', 'bestWinStreak'];
  const setParts = ['updatedAt = :now'];
  const exprValues = { ':now': new Date().toISOString() };

  for (const [key, value] of Object.entries(updates)) {
    if (!allowed.includes(key)) continue;
    setParts.push(`${key} = :${key}`);
    exprValues[`:${key}`] = value;
  }

  // Keep GSI1SK in sync if ELO changed
  if (updates.elo !== undefined) {
    setParts.push('GSI1SK = :gsi1sk');
    exprValues[':gsi1sk'] = `ELO#${String(updates.elo).padStart(6, '0')}`;
  }

  await client.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `PLAYER#${sub}`, SK: 'PROFILE' },
    UpdateExpression: 'SET ' + setParts.join(', '),
    ExpressionAttributeValues: exprValues,
    ConditionExpression: 'attribute_exists(PK)',
  }));
}

// Grant or deduct coins (additive)
export async function adminAdjustCoins(sub, amount) {
  await client.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `PLAYER#${sub}`, SK: 'PROFILE' },
    UpdateExpression: 'SET coins = if_not_exists(coins, :zero) + :amt, updatedAt = :now',
    ExpressionAttributeValues: { ':amt': amount, ':zero': 0, ':now': new Date().toISOString() },
    ConditionExpression: 'attribute_exists(PK)',
  }));
}

// Grant an item to a player's inventory
export async function adminGrantItem(sub, itemId) {
  await client.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `PLAYER#${sub}`, SK: 'PROFILE' },
    UpdateExpression: 'SET inventory = list_append(if_not_exists(inventory, :empty), :item), updatedAt = :now',
    ConditionExpression: 'attribute_exists(PK) AND (attribute_not_exists(inventory) OR NOT contains(inventory, :itemId))',
    ExpressionAttributeValues: {
      ':item': [itemId],
      ':empty': [],
      ':itemId': itemId,
      ':now': new Date().toISOString(),
    },
  }));
}

// Revoke an item from a player's inventory
export async function adminRevokeItem(sub, itemId) {
  // First fetch the profile to find the item index
  const { Item } = await client.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `PLAYER#${sub}`, SK: 'PROFILE' },
  }));
  if (!Item) throw new Error('Player not found');
  const inventory = Item.inventory || [];
  const idx = inventory.indexOf(itemId);
  if (idx === -1) throw new Error('Item not in inventory');

  await client.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `PLAYER#${sub}`, SK: 'PROFILE' },
    UpdateExpression: `REMOVE inventory[${idx}]`,
    ConditionExpression: `inventory[${idx}] = :itemId`,
    ExpressionAttributeValues: { ':itemId': itemId },
  }));

  // Also clear activeSkins if the revoked item is a skin that's equipped
  if (itemId.startsWith('skin_')) {
    const parts = itemId.replace('skin_', '').split('_');
    const classId = parts[0];
    const skinId = parts.slice(1).join('_');
    if (Item.activeSkins?.[classId] === skinId) {
      await client.send(new UpdateCommand({
        TableName: TABLE,
        Key: { PK: `PLAYER#${sub}`, SK: 'PROFILE' },
        UpdateExpression: 'REMOVE activeSkins.#cls',
        ExpressionAttributeNames: { '#cls': classId },
      }));
    }
  }
}

// Delete a player account and all associated records
export async function adminDeletePlayer(sub) {
  const pk = `PLAYER#${sub}`;

  // Query all items with this PK (profile, matches, bets, etc.)
  const allItems = [];
  let lastKey;
  do {
    const result = await client.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': pk },
      ExclusiveStartKey: lastKey,
    }));
    allItems.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  // Also find username reservation
  const profile = allItems.find(i => i.SK === 'PROFILE');
  if (profile?.username) {
    allItems.push({ PK: `USERNAME#${profile.username.toLowerCase()}`, SK: 'RESERVATION' });
  }

  // Batch delete in groups of 25
  for (let i = 0; i < allItems.length; i += 25) {
    const batch = allItems.slice(i, i + 25).map(item => ({
      DeleteRequest: { Key: { PK: item.PK, SK: item.SK } },
    }));
    await client.send(new BatchWriteCommand({
      RequestItems: { [TABLE]: batch },
    }));
  }

  return { deletedItems: allItems.length, username: profile?.username };
}

// Clear all match history for a specific player + opponent copies, reset stats
export async function adminClearMatches(sub) {
  const pk = `PLAYER#${sub}`;

  // Query all MATCH# items for this player
  const matchItems = [];
  let lastKey;
  do {
    const result = await client.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': pk, ':prefix': 'MATCH#' },
      ExclusiveStartKey: lastKey,
    }));
    matchItems.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  // Collect items to delete: player's matches + opponent copies of same matchId
  const toDelete = matchItems.map(m => ({ PK: m.PK, SK: m.SK }));

  // For each match, find and delete the opponent's copy too
  for (const m of matchItems) {
    const matchId = m.matchId || m.SK?.replace('MATCH#', '');
    const oppSub = m.opponentSub;
    if (oppSub && matchId) {
      // Try both win/loss SK variants
      for (const sk of [`MATCH#${matchId}`, `MATCH#${matchId}`]) {
        try {
          const oppRes = await client.send(new QueryCommand({
            TableName: TABLE,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
            ExpressionAttributeValues: { ':pk': `PLAYER#${oppSub}`, ':prefix': `MATCH#${matchId}` },
          }));
          for (const item of oppRes.Items || []) {
            toDelete.push({ PK: item.PK, SK: item.SK });
          }
        } catch { /* skip */ }
        break; // only need one query since begins_with covers it
      }
    }
  }

  // Deduplicate
  const seen = new Set();
  const uniqueDeletes = toDelete.filter(d => {
    const key = d.PK + '|' + d.SK;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Batch delete in groups of 25
  for (let i = 0; i < uniqueDeletes.length; i += 25) {
    const batch = uniqueDeletes.slice(i, i + 25).map(item => ({
      DeleteRequest: { Key: { PK: item.PK, SK: item.SK } },
    }));
    await client.send(new BatchWriteCommand({
      RequestItems: { [TABLE]: batch },
    }));
  }

  // Reset the player's stats
  await client.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: pk, SK: 'PROFILE' },
    UpdateExpression: 'SET wins = :z, losses = :z, currentStreak = :z, bestWinStreak = :z, classStats = :empty, totalPlayTime = :z, updatedAt = :now',
    ExpressionAttributeValues: { ':z': 0, ':empty': {}, ':now': new Date().toISOString() },
  }));

  return uniqueDeletes.length;
}

// ── Payment History ─────────────────────────────────────────────
export async function getPlayerPayments(sub) {
  const { Items = [] } = await client.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `PLAYER#${sub}`, ':prefix': 'PAYMENT#' },
  }));
  return Items.map(item => ({
    sessionId: item.SK.replace('PAYMENT#', ''),
    packageId: item.packageId,
    coins: item.coins,
    amountUsd: item.amountUsd,
    status: item.status || 'completed',
    createdAt: item.createdAt,
    refundedAt: item.refundedAt || null,
    refundId: item.refundId || null,
  })).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}
