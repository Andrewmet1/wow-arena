/**
 * Sync news articles from feed.json to forum Announcements.
 *
 * Reads public/news/feed.json and creates a forum thread in the
 * "announcements" category for each article that hasn't been posted yet.
 * Safe to re-run — skips already-synced articles via DynamoDB tracking.
 *
 * Usage:  node scripts/sync-news-to-forum.mjs
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as forumDb from '../server/forumDb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FEED_PATH = path.resolve(__dirname, '../public/news/feed.json');

const SYSTEM_AUTHOR = {
  sub: 'SYSTEM',
  username: 'Ebon Crucible',
  isStaff: true,
};

async function sync() {
  const feed = JSON.parse(fs.readFileSync(FEED_PATH, 'utf-8'));
  console.log(`Found ${feed.length} news articles in feed.json\n`);

  let synced = 0;
  let skipped = 0;

  for (const article of feed) {
    const { id, title, excerpt } = article;

    // Check if already synced
    const existing = await forumDb.getNewsSyncStatus(id);
    if (existing) {
      console.log(`  SKIP: "${title}" (already synced as thread ${existing.threadId})`);
      skipped++;
      continue;
    }

    // Build forum post body: excerpt + link to full article
    const articleUrl = `https://eboncrucible.com/news/${id}/`;
    const body = `${excerpt}\n\nRead the full article: ${articleUrl}`;

    console.log(`  POSTING: "${title}"...`);
    try {
      const result = await forumDb.createThread('announcements', title, body, SYSTEM_AUTHOR);
      await forumDb.markNewsSynced(id, result.threadId);
      console.log(`  DONE: thread ${result.threadId}`);
      synced++;
    } catch (err) {
      console.error(`  ERROR: "${title}" — ${err.message}`);
    }
  }

  console.log(`\nSync complete: ${synced} posted, ${skipped} skipped.`);
}

sync().catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});
