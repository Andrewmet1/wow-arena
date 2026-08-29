import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'steam', 'store_assets');
const URL = 'http://localhost:5173/play/';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--window-size=1920,1080', '--no-sandbox'],
    defaultViewport: { width: 1920, height: 1080 },
  });

  const page = await browser.newPage();

  // Go to the game
  console.log('Loading game...');
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(3000);

  // Screenshot 1: Login/landing screen
  console.log('Taking screenshot 1: Landing screen');
  await page.screenshot({ path: path.join(OUT, 'screenshot_01_landing.png'), type: 'png' });

  // Try to get past login - click sign in if visible, or look for play buttons
  // First let's see what's on screen
  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log('Page content:', bodyText.substring(0, 200));

  // Check if there's a guest/practice option we can click
  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button, .btn, [role=button], a')).map(el => ({
      text: el.textContent.trim().substring(0, 50),
      tag: el.tagName,
      class: el.className.substring(0, 50),
    }));
  });
  console.log('Buttons found:', JSON.stringify(buttons.slice(0, 15), null, 2));

  // Try clicking practice/AI mode if available
  for (const text of ['PRACTICE', 'VS AI', 'PLAY', 'START', 'Practice', 'Guest']) {
    const clicked = await page.evaluate((t) => {
      const els = Array.from(document.querySelectorAll('button, a, div'));
      for (const el of els) {
        if (el.textContent.trim().includes(t)) {
          el.click();
          return el.textContent.trim().substring(0, 50);
        }
      }
      return null;
    }, text);
    if (clicked) {
      console.log('Clicked:', clicked);
      await sleep(2000);
      break;
    }
  }

  await page.screenshot({ path: path.join(OUT, 'screenshot_02_menu.png'), type: 'png' });

  // Try to start a practice match
  // Look for class selection
  for (const cls of ['TYRANT', 'Tyrant', 'tyrant']) {
    const clicked = await page.evaluate((t) => {
      const els = Array.from(document.querySelectorAll('*'));
      for (const el of els) {
        if (el.textContent.trim() === t || el.textContent.trim().includes(t)) {
          el.click();
          return true;
        }
      }
      return false;
    }, cls);
    if (clicked) {
      console.log('Selected class:', cls);
      await sleep(1000);
      break;
    }
  }

  await page.screenshot({ path: path.join(OUT, 'screenshot_03_class_select.png'), type: 'png' });

  // Try to start match
  for (const text of ['START', 'Start', 'FIND MATCH', 'BEGIN']) {
    const clicked = await page.evaluate((t) => {
      const els = Array.from(document.querySelectorAll('button, div'));
      for (const el of els) {
        if (el.textContent.trim() === t) {
          el.click();
          return true;
        }
      }
      return false;
    }, text);
    if (clicked) {
      console.log('Clicked start:', text);
      await sleep(5000);
      break;
    }
  }

  await page.screenshot({ path: path.join(OUT, 'screenshot_04_gameplay.png'), type: 'png' });

  // Wait for combat
  await sleep(5000);
  await page.screenshot({ path: path.join(OUT, 'screenshot_05_combat.png'), type: 'png' });

  await sleep(3000);
  await page.screenshot({ path: path.join(OUT, 'screenshot_06_combat2.png'), type: 'png' });

  console.log('Done! Screenshots saved to', OUT);
  await browser.close();
}

run().catch(e => { console.error(e); process.exit(1); });
