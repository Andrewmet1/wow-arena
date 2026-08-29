import { Router } from 'express';
import { verifyToken } from './auth.js';
import * as forumDb from './forumDb.js';

const router = Router();

const STAFF_SUBS = new Set((process.env.FORUM_STAFF_SUBS || '').split(',').filter(Boolean));

// ── Auth middleware ──────────────────────────────────────────────────

async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const { sub, email } = await verifyToken(header.slice(7));
    req.user = { sub, email, isStaff: STAFF_SUBS.has(sub) };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

async function getUserUsername(sub) {
  const db = await import('./db.js');
  const profile = await db.getProfile(sub);
  return profile?.username || 'Unknown';
}

// ── GET /categories ─────────────────────────────────────────────────

router.get('/categories', async (req, res) => {
  try {
    const stats = await forumDb.getForumStats();
    const categories = Object.entries(forumDb.FORUM_CATEGORIES).map(([slug, cat]) => ({
      slug,
      ...cat,
      threadCount: stats[slug]?.threadCount || 0,
      postCount: stats[slug]?.postCount || 0,
      lastThreadTitle: stats[slug]?.lastThreadTitle || null,
      lastThreadAuthor: stats[slug]?.lastThreadAuthor || null,
      lastActivityAt: stats[slug]?.lastActivityAt || null,
    }));
    res.json({ categories });
  } catch (err) {
    console.error('[Forum] categories error:', err.message);
    res.status(500).json({ error: 'Failed to load categories' });
  }
});

// ── GET /threads?cat=xxx&cursor=xxx ─────────────────────────────────

router.get('/threads', async (req, res) => {
  try {
    const cat = req.query.cat;
    if (!cat || !forumDb.FORUM_CATEGORIES[cat]) {
      return res.status(400).json({ error: 'Invalid category' });
    }
    const data = await forumDb.listThreads(cat, req.query.cursor, 20);
    data.threads.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return 0;
    });
    res.json(data);
  } catch (err) {
    console.error('[Forum] threads error:', err.message);
    res.status(500).json({ error: 'Failed to load threads' });
  }
});

// ── GET /thread/:threadId ───────────────────────────────────────────

router.get('/thread/:threadId', async (req, res) => {
  try {
    const meta = await forumDb.getThreadMeta(req.params.threadId);
    if (!meta) return res.status(404).json({ error: 'Thread not found' });
    const posts = await forumDb.listPosts(req.params.threadId, null, 20);
    res.json({ thread: meta, ...posts });
  } catch (err) {
    console.error('[Forum] thread error:', err.message);
    res.status(500).json({ error: 'Failed to load thread' });
  }
});

// ── GET /posts?thread=xxx&cursor=xxx ────────────────────────────────

router.get('/posts', async (req, res) => {
  try {
    const threadId = req.query.thread;
    if (!threadId) return res.status(400).json({ error: 'Missing thread ID' });
    const data = await forumDb.listPosts(threadId, req.query.cursor, 20);
    res.json(data);
  } catch (err) {
    console.error('[Forum] posts error:', err.message);
    res.status(500).json({ error: 'Failed to load posts' });
  }
});

// ── POST /threads ───────────────────────────────────────────────────

router.post('/threads', requireAuth, async (req, res) => {
  try {
    const { cat, title, body } = req.body;
    if (!cat || !forumDb.FORUM_CATEGORIES[cat]) {
      return res.status(400).json({ error: 'Invalid category' });
    }
    if (!title?.trim() || title.trim().length < 3) {
      return res.status(400).json({ error: 'Title must be at least 3 characters' });
    }
    if (!body?.trim() || body.trim().length < 3) {
      return res.status(400).json({ error: 'Post body must be at least 3 characters' });
    }
    if (forumDb.FORUM_CATEGORIES[cat].staffOnly && !req.user.isStaff) {
      return res.status(403).json({ error: 'Only staff can post in this category' });
    }
    const username = await getUserUsername(req.user.sub);
    const result = await forumDb.createThread(cat, title.trim(), body.trim(), {
      sub: req.user.sub,
      username,
      isStaff: req.user.isStaff,
    });
    res.status(201).json(result);
  } catch (err) {
    console.error('[Forum] create thread error:', err.message);
    res.status(500).json({ error: 'Failed to create thread' });
  }
});

// ── POST /posts ─────────────────────────────────────────────────────

router.post('/posts', requireAuth, async (req, res) => {
  try {
    const { threadId, body } = req.body;
    if (!threadId) return res.status(400).json({ error: 'Missing thread ID' });
    if (!body?.trim() || body.trim().length < 1) {
      return res.status(400).json({ error: 'Post body cannot be empty' });
    }
    const username = await getUserUsername(req.user.sub);
    const result = await forumDb.createPost(threadId, body.trim(), {
      sub: req.user.sub,
      username,
      isStaff: req.user.isStaff,
    });
    res.status(201).json(result);
  } catch (err) {
    if (err.message === 'Thread not found') return res.status(404).json({ error: err.message });
    if (err.message === 'Thread is locked') return res.status(403).json({ error: err.message });
    console.error('[Forum] create post error:', err.message);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

// ── PUT /posts/:postId ──────────────────────────────────────────────

router.put('/posts/:postId', requireAuth, async (req, res) => {
  try {
    const { threadId, body, postSK } = req.body;
    if (!threadId || !postSK) return res.status(400).json({ error: 'Missing threadId or postSK' });
    if (!body?.trim()) return res.status(400).json({ error: 'Post body cannot be empty' });
    await forumDb.updatePost(threadId, postSK, body.trim(), req.user.sub);
    res.json({ ok: true });
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      return res.status(403).json({ error: 'You can only edit your own posts' });
    }
    console.error('[Forum] edit post error:', err.message);
    res.status(500).json({ error: 'Failed to edit post' });
  }
});

// ── DELETE /posts/:postId ───────────────────────────────────────────

router.delete('/posts/:postId', requireAuth, async (req, res) => {
  try {
    const { thread: threadId, sk: postSK } = req.query;
    if (!threadId || !postSK) return res.status(400).json({ error: 'Missing thread or sk query param' });
    await forumDb.deletePost(threadId, postSK, req.user.sub);
    res.json({ ok: true });
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      return res.status(403).json({ error: 'You can only delete your own posts' });
    }
    console.error('[Forum] delete post error:', err.message);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

export { router as forumRouter };
