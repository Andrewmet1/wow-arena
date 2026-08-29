#!/usr/bin/env node
// Runtime verification gate.
//
// content-check.mjs answers "is the content wired up"; this answers "does it
// actually load in a browser". Together they are the pass/fail signal an agent
// needs before it can safely commit or deploy a content change.
//
// Boots a real WebGL context (software-rasterised) and drives the true
// ModelLoader — not a reimplementation — so material and texture wiring is
// exercised the way the game exercises it.
//
//   node scripts/verify-runtime.mjs [--url http://localhost:5173]
// Exits non-zero if any check fails.

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'http://localhost:5173';

// Vite only rewrites bare imports for HTML it serves from the project root, so
// the harness is copied in for the run and removed afterwards.
const HARNESS_SRC = path.join(__dirname, 'probe', 'harness.html');
const HARNESS_DST = path.join(ROOT, '__verify.html');
fs.copyFileSync(HARNESS_SRC, HARNESS_DST);

let failed = 0;
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle',
         '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage();
  const bad = [];
  // favicon.ico is requested by the browser itself, not the game.
  const noise = (u) => /favicon\.ico/.test(u);
  page.on('requestfailed', r => { if (!noise(r.url())) bad.push(`${r.failure()?.errorText} ${r.url()}`); });
  page.on('response', r => { if (r.status() >= 400 && !noise(r.url())) bad.push(`HTTP ${r.status()} ${r.url()}`); });
  page.on('pageerror', e => bad.push(`pageerror: ${e.message}`));

  await page.goto(`${BASE}/__verify.html`, { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForFunction('window.__probeDone === true', { timeout: 120000 });
  const results = await page.evaluate(() => window.__probe || []);

  console.log('\n  RUNTIME VERIFICATION\n  ' + '─'.repeat(58));
  for (const r of results) {
    if (r.level === 'fail') failed++;
    console.log(`  ${r.level === 'pass' ? '✓' : '✗'} ${r.msg}`);
  }
  if (bad.length) {
    failed += bad.length;
    console.log(`\n  NETWORK / PAGE ERRORS (${bad.length})`);
    for (const b of bad.slice(0, 12)) console.log('     · ' + b);
  }
  console.log('\n  ' + '─'.repeat(58));
  console.log(`  ${failed === 0 ? 'ALL CHECKS PASSED' : failed + ' CHECK(S) FAILED'}\n`);
} finally {
  await browser.close();
  fs.rmSync(HARNESS_DST, { force: true });
}
process.exit(failed ? 1 : 0);
