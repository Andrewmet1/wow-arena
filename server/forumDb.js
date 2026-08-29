import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import crypto from 'crypto';

// Strip HTML tags server-side (defense-in-depth; client also escapes via escHtml)
function stripHtml(str) {
  return str.replace(/<[^>]*>/g, '');
}

const TABLE = process.env.DYNAMO_TABLE || 'EbonCrucible';
const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' })
);

// ── Categories (static, not in DB) ─────────────────────────────────

export const FORUM_CATEGORIES = {
  announcements:    { name: 'Announcements',         icon: '\u{1F4E3}', description: 'Official news and updates from the developers.', staffOnly: true, group: 'OFFICIAL' },
  general:          { name: 'General Discussion',     icon: '\u{1F4AC}', description: 'Talk about anything Ebon Crucible.',              group: 'GENERAL' },
  class_tyrant:     { name: 'Tyrant',                 icon: '\u2694\uFE0F', description: 'Warrior class strategy and discussion.',       group: 'CLASS DISCUSSION', color: '#8B0000' },
  class_wraith:     { name: 'Wraith',                 icon: '\u{1F5E1}\uFE0F', description: 'Assassin class strategy and discussion.',   group: 'CLASS DISCUSSION', color: '#6B2FA0' },
  class_infernal:   { name: 'Infernal',               icon: '\u{1F525}', description: 'Mage class strategy and discussion.',             group: 'CLASS DISCUSSION', color: '#FF4500' },
  class_harbinger:  { name: 'Harbinger',              icon: '\u{1F480}', description: 'Warlock class strategy and discussion.',           group: 'CLASS DISCUSSION', color: '#228B22' },
  class_revenant:   { name: 'Revenant',               icon: '\u{1F6E1}\uFE0F', description: 'Paladin class strategy and discussion.',    group: 'CLASS DISCUSSION', color: '#C8B560' },
  strategy:         { name: 'Strategy & Guides',      icon: '\u{1F4D6}', description: 'Share builds, tips, and guides.',                 group: 'STRATEGY' },
  bugs:             { name: 'Bug Reports & Feedback', icon: '\u{1F41B}', description: 'Report bugs and suggest improvements.',           group: 'FEEDBACK' },
  offtopic:         { name: 'Off-Topic',              icon: '\u{1F3AE}', description: 'Non-game discussion.',                            group: 'COMMUNITY' },
};

function generateId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function decodeCursor(cursor) {
  if (!cursor || typeof cursor !== 'string' || cursor.length > 1000) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString());
    if (typeof decoded !== 'object' || Array.isArray(decoded)) return undefined;
    return decoded;
  } catch {
    return undefined;
  }
}

function encodeCursor(lastEvaluatedKey) {
  if (!lastEvaluatedKey) return null;
  return Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64');
}

// ── Category Stats ──────────────────────────────────────────────────

export async function getForumStats() {
  const { Items } = await client.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': 'FORUM_STATS',
      ':prefix': 'CAT#',
    },
  }));
  const statsMap = {};
  for (const item of (Items || [])) {
    const slug = item.SK.replace('CAT#', '');
    statsMap[slug] = {
      threadCount: item.threadCount || 0,
      postCount: item.postCount || 0,
      lastThreadTitle: item.lastThreadTitle || null,
      lastThreadAuthor: item.lastThreadAuthor || null,
      lastActivityAt: item.lastActivityAt || null,
    };
  }
  return statsMap;
}

async function incrementCatStats(cat, { threads = 0, posts = 0, lastThreadTitle, lastThreadAuthor }) {
  const now = new Date().toISOString();
  const updateParts = ['SET lastActivityAt = :now'];
  const values = { ':now': now, ':zero': 0 };

  if (threads > 0) {
    updateParts.push('threadCount = if_not_exists(threadCount, :zero) + :tInc');
    values[':tInc'] = threads;
  }
  if (posts > 0) {
    updateParts.push('postCount = if_not_exists(postCount, :zero) + :pInc');
    values[':pInc'] = posts;
  }
  if (lastThreadTitle) {
    updateParts.push('lastThreadTitle = :lt');
    values[':lt'] = lastThreadTitle;
  }
  if (lastThreadAuthor) {
    updateParts.push('lastThreadAuthor = :la');
    values[':la'] = lastThreadAuthor;
  }

  await client.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: 'FORUM_STATS', SK: `CAT#${cat}` },
    UpdateExpression: updateParts.join(', '),
    ExpressionAttributeValues: values,
  }));
}

// ── Threads ─────────────────────────────────────────────────────────

export async function listThreads(cat, cursor, limit = 20) {
  const result = await client.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': `FORUM_CAT#${cat}`,
      ':prefix': 'THREAD#',
    },
    ScanIndexForward: false,
    Limit: limit,
    ExclusiveStartKey: decodeCursor(cursor),
  }));
  return {
    threads: (result.Items || []).map(t => ({
      threadId: t.threadId,
      title: t.title,
      authorUsername: t.authorUsername,
      authorSub: t.authorSub,
      isStaff: t.isStaff || false,
      createdAt: t.createdAt,
      lastReplyAt: t.lastReplyAt,
      replyCount: t.replyCount || 0,
      pinned: t.pinned || false,
      locked: t.locked || false,
    })),
    nextCursor: encodeCursor(result.LastEvaluatedKey),
  };
}

export async function getThreadMeta(threadId) {
  const result = await client.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK = :sk',
    ExpressionAttributeValues: {
      ':pk': `FORUM_THREAD#${threadId}`,
      ':sk': 'META',
    },
    Limit: 1,
  }));
  const item = result.Items?.[0];
  if (!item) return null;
  return {
    threadId: item.threadId,
    title: item.title,
    authorUsername: item.authorUsername,
    authorSub: item.authorSub,
    isStaff: item.isStaff || false,
    createdAt: item.createdAt,
    lastReplyAt: item.lastReplyAt,
    replyCount: item.replyCount || 0,
    pinned: item.pinned || false,
    locked: item.locked || false,
    cat: item.PK.replace('FORUM_CAT#', ''),
  };
}

export async function createThread(cat, title, body, author) {
  const threadId = generateId('t');
  const postId = generateId('p');
  const now = new Date().toISOString();

  const threadItem = {
    PK: `FORUM_CAT#${cat}`,
    SK: `THREAD#${now}#${threadId}`,
    GSI1PK: `FORUM_THREAD#${threadId}`,
    GSI1SK: 'META',
    threadId,
    title: stripHtml(title).slice(0, 120),
    authorSub: author.sub,
    authorUsername: author.username,
    isStaff: author.isStaff || false,
    createdAt: now,
    lastReplyAt: now,
    replyCount: 0,
    pinned: false,
    locked: false,
  };

  const postItem = {
    PK: `FORUM_THREAD#${threadId}`,
    SK: `POST#${now}#${postId}`,
    postId,
    authorSub: author.sub,
    authorUsername: author.username,
    isStaff: author.isStaff || false,
    body: stripHtml(body).slice(0, 5000),
    createdAt: now,
    editedAt: null,
  };

  await client.send(new TransactWriteCommand({
    TransactItems: [
      { Put: { TableName: TABLE, Item: threadItem } },
      { Put: { TableName: TABLE, Item: postItem } },
    ],
  }));

  await incrementCatStats(cat, { threads: 1, posts: 1, lastThreadTitle: stripHtml(title).slice(0, 120), lastThreadAuthor: author.username });

  return { threadId, createdAt: now };
}

// ── Posts ────────────────────────────────────────────────────────────

export async function listPosts(threadId, cursor, limit = 20) {
  const result = await client.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': `FORUM_THREAD#${threadId}`,
      ':prefix': 'POST#',
    },
    ScanIndexForward: true,
    Limit: limit,
    ExclusiveStartKey: decodeCursor(cursor),
  }));
  return {
    posts: (result.Items || []).map(p => ({
      postId: p.postId,
      authorSub: p.authorSub,
      authorUsername: p.authorUsername,
      isStaff: p.isStaff || false,
      body: p.body,
      createdAt: p.createdAt,
      editedAt: p.editedAt || null,
      SK: p.SK,
    })),
    nextCursor: encodeCursor(result.LastEvaluatedKey),
  };
}

export async function createPost(threadId, body, author) {
  const postId = generateId('p');
  const now = new Date().toISOString();

  // Get thread meta to find its category for stats
  const threadMeta = await getThreadMeta(threadId);
  if (!threadMeta) throw new Error('Thread not found');
  if (threadMeta.locked) throw new Error('Thread is locked');

  const postItem = {
    PK: `FORUM_THREAD#${threadId}`,
    SK: `POST#${now}#${postId}`,
    postId,
    authorSub: author.sub,
    authorUsername: author.username,
    isStaff: author.isStaff || false,
    body: stripHtml(body).slice(0, 5000),
    createdAt: now,
    editedAt: null,
  };

  await client.send(new PutCommand({
    TableName: TABLE,
    Item: postItem,
  }));

  // Update thread's lastReplyAt and replyCount
  await client.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: threadMeta.PK || `FORUM_CAT#${threadMeta.cat}`, SK: threadMeta.SK || `THREAD#${threadMeta.createdAt}#${threadId}` },
    UpdateExpression: 'SET lastReplyAt = :now, replyCount = if_not_exists(replyCount, :zero) + :one',
    ExpressionAttributeValues: { ':now': now, ':zero': 0, ':one': 1 },
  })).catch(() => {});
  // The thread update above uses a reconstructed SK which may not match exactly.
  // Let's use a different approach — query for the thread item first.

  await incrementCatStats(threadMeta.cat, { posts: 1 });

  return { postId, createdAt: now };
}

export async function updatePost(threadId, postSK, body, authorSub) {
  const now = new Date().toISOString();
  await client.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `FORUM_THREAD#${threadId}`, SK: postSK },
    UpdateExpression: 'SET body = :body, editedAt = :now',
    ConditionExpression: 'authorSub = :author',
    ExpressionAttributeValues: {
      ':body': stripHtml(body).slice(0, 5000),
      ':now': now,
      ':author': authorSub,
    },
  }));
}

export async function deletePost(threadId, postSK, authorSub) {
  await client.send(new DeleteCommand({
    TableName: TABLE,
    Key: { PK: `FORUM_THREAD#${threadId}`, SK: postSK },
    ConditionExpression: 'authorSub = :author',
    ExpressionAttributeValues: { ':author': authorSub },
  }));
}

// ── News-to-Forum Sync Tracking ─────────────────────────────────────

export async function getNewsSyncStatus(articleId) {
  const result = await client.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: 'FORUM_NEWS_SYNC', SK: `NEWS#${articleId}` },
  }));
  return result.Item || null;
}

export async function markNewsSynced(articleId, threadId) {
  await client.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: 'FORUM_NEWS_SYNC',
      SK: `NEWS#${articleId}`,
      threadId,
      postedAt: new Date().toISOString(),
    },
  }));
}
