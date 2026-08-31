#!/usr/bin/env node
// Side-by-side: the concept target against what the engine actually renders.
//
// Judging "does it look right" from memory does not work — earlier in this
// project a render was tuned against a screenshot pipeline that was silently
// sampling background, and every conclusion drawn from it was wrong. Putting
// both images in one frame, with the same measurements under each, makes the
// comparison checkable rather than remembered.
//
//   node scripts/compare-to-goal.mjs [goalImage] [--out file.png]

import puppeteer from 'puppeteer';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';

const GOAL = process.argv.find(a => a.endsWith('.png') && !a.startsWith('--'))
  || 'public/assets/art/concepts/GOAL_dungeon.png';
const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : '/tmp/compare.png';
const W = 900, H = 620;

// ── capture the engine ───────────────────────────────────────────────────
const browser = await puppeteer.launch({ headless: 'new',
  args: ['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.goto('http://localhost:5173/dungeon-preview.html?seed=4242&roomIndex=3',
  { waitUntil: 'networkidle2', timeout: 90000 });
await new Promise(r => setTimeout(r, 26000));
await page.evaluate(() => document.getElementById('kit').click());
await new Promise(r => setTimeout(r, 18000));
// hide the control panel so it does not pollute the comparison or the stats
await page.evaluate(() => { for (const el of document.querySelectorAll('.panel')) el.style.display = 'none'; });
await new Promise(r => setTimeout(r, 1500));
const stats = await page.evaluate(() => {
  let insts = 0, boxes = 0;
  window.__scene?.traverse(o => {
    if (!o.isInstancedMesh) return;
    insts++;
    // a fallback block is a BoxGeometry; a real piece is not
    if (o.geometry?.type === 'BoxGeometry') boxes++;
  });
  return { insts, boxes };
});
await page.screenshot({ path: '/tmp/_engine.png' });
await browser.close();

// ── measure both ─────────────────────────────────────────────────────────
async function measure(file) {
  const { data, info } = await sharp(file).resize(500, 500, { fit: 'inside' })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = info.width * info.height;
  const lum = []; let warm = 0, sat = 0;
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i], g = data[i+1], b = data[i+2];
    lum.push(0.2126*r + 0.7152*g + 0.0722*b);
    if (r > g + 12 && r > b + 18) warm++;
    const mx = Math.max(r,g,b), mn = Math.min(r,g,b);
    if (mx > 28 && (mx-mn)/mx > 0.30) sat++;
  }
  lum.sort((a,b)=>a-b);
  return {
    median: lum[Math.floor(lum.length/2)],
    shadow: lum.filter(v=>v<25).length/px*100,
    lit: lum.filter(v=>v>=110).length/px*100,
    warm: warm/px*100,
    sat: sat/px*100,
  };
}
const g = await measure(GOAL);
const e = await measure('/tmp/_engine.png');

// ── composite ────────────────────────────────────────────────────────────
const label = (text, sub) => Buffer.from(
  `<svg width="${W}" height="54"><rect width="100%" height="100%" fill="#14110f"/>` +
  `<text x="14" y="22" fill="#c9a227" font-family="monospace" font-size="15">${text}</text>` +
  `<text x="14" y="42" fill="#8b7d72" font-family="monospace" font-size="12">${sub}</text></svg>`);
const fmt = (m) => `median ${Math.round(m.median)} · shadow ${m.shadow.toFixed(0)}% · lit ${m.lit.toFixed(0)}% · warm ${m.warm.toFixed(0)}% · sat ${m.sat.toFixed(0)}%`;

const goalImg = await sharp(GOAL).resize(W, H, { fit: 'cover' }).png().toBuffer();
const engImg  = await sharp('/tmp/_engine.png').resize(W, H, { fit: 'cover' }).png().toBuffer();

await sharp({ create: { width: W*2, height: H+54, channels: 3, background: { r:20,g:18,b:16 } } })
  .composite([
    { input: label(`TARGET — ${path.basename(GOAL)}`, fmt(g)), left: 0, top: 0 },
    { input: label(`ENGINE — ${stats.insts} instanced, ${stats.boxes} still fallback boxes`, fmt(e)), left: W, top: 0 },
    { input: goalImg, left: 0, top: 54 },
    { input: engImg,  left: W, top: 54 },
  ]).png().toFile(OUT);

const dst = 'public/assets/art/concepts/compare_latest.png';
fs.copyFileSync(OUT, dst);
console.log(`\n  ${OUT}  (also ${dst})`);
console.log(`  target : ${fmt(g)}`);
console.log(`  engine : ${fmt(e)}`);
console.log(`  pieces : ${stats.insts} instanced, ${stats.boxes} still fallback boxes\n`);
