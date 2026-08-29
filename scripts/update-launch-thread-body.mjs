// One-off: rewrite the body of the now-synced launch announcement thread
// to use the new press-release excerpt. Original body still had the old
// "year of solo development" copy from before the rewrite.
import 'dotenv/config';
import * as forumDb from '../server/forumDb.js';

const ARTICLE_ID = 'now-in-early-access';
const NEW_EXCERPT = 'Ebon Crucible is now in Early Access on Steam, the App Store, Google Play, and the web. One account, every device. Five classes, 63 abilities, real-time arena combat — pick the way you fight.';
const ARTICLE_URL = `https://eboncrucible.com/news/${ARTICLE_ID}/`;
const NEW_BODY = `${NEW_EXCERPT}\n\nRead the full article: ${ARTICLE_URL}`;

const sync = await forumDb.getNewsSyncStatus(ARTICLE_ID);
if (!sync) { console.error(`No sync record for ${ARTICLE_ID}`); process.exit(1); }
console.log(`Found thread id: ${sync.threadId}`);

// Find the OP — first POST# in the thread
const result = await forumDb.listPosts(sync.threadId, null, 1);
const op = result.posts?.[0];
if (!op) { console.error('No OP found'); process.exit(1); }
console.log(`Found OP postId=${op.postId}, SK=${op.SK}`);

// updatePost requires authorSub match. The OP author is 'SYSTEM' (see sync-news-to-forum.mjs).
await forumDb.updatePost(sync.threadId, op.SK, NEW_BODY, 'SYSTEM');
console.log(`Updated thread body to:\n${NEW_BODY}`);
