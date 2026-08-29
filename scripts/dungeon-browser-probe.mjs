// Headless browser probe — visits the running dungeon page,
// captures console messages and reports any errors related to
// monster/animation loading.
import puppeteer from 'puppeteer';

const URL = 'http://localhost:5175/play/?dungeon=1';
const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();

const logs = [];
page.on('console', msg => {
  logs.push(`[${msg.type()}] ${msg.text()}`);
});
page.on('pageerror', err => logs.push(`[pageerror] ${err.message}`));
page.on('requestfailed', req => {
  if (/monster|\.glb|animation/i.test(req.url())) {
    logs.push(`[404] ${req.url()}`);
  }
});

try {
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 15000 });
  await new Promise(r => setTimeout(r, 4000));

  // Programmatically force a dungeon load with a faked unitId — bypassing auth.
  // We simulate a fake "dungeon_start" message by directly invoking the
  // network handler if the game instance has booted.
  const result = await page.evaluate(async () => {
    const game = window.__game;
    if (!game) return { error: 'game not booted yet — window.__game missing' };
    if (!game.characterRenderer) return { error: 'characterRenderer missing' };
    // Build a monster placeholder directly to test the load path
    const renderer = game.characterRenderer;
    renderer.createCharacter(99, 'tyrant', null, 'carrion_knight');
    await new Promise(r => setTimeout(r, 5000));
    const ph = renderer.characters.get(99);
    return {
      hasPlaceholder: !!ph,
      hasMixer: !!ph?.userData.mixer,
      actions: ph?.userData.actions ? Object.keys(ph.userData.actions) : null,
      childCount: ph?.children?.length || 0,
      currentClip: ph?.userData._currentClip || null,
      isMeshyAnim: ph?.userData.usesMeshyAnimations,
    };
  });
  logs.push('--- Monster load probe result ---');
  logs.push(JSON.stringify(result, null, 2));
} catch (e) {
  logs.push(`[goto error] ${e.message}`);
}

console.log('--- Console logs from dungeon page ---');
console.log(logs.length ? logs.join('\n') : '(no relevant logs captured)');
await browser.close();
