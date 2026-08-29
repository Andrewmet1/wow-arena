#!/usr/bin/env node
/**
 * Generate Steam store capsule images from existing art assets using sharp.
 * Output: /Users/andrewmet1/wow-arena/steam/store_assets/
 */

import sharp from 'sharp';
import path from 'path';
import fs from 'fs';

const ART = '/Users/andrewmet1/wow-arena/public/assets/art';
const OUT = '/Users/andrewmet1/wow-arena/steam/store_assets';

fs.mkdirSync(OUT, { recursive: true });

// Helper: create a dark overlay (semi-transparent black rectangle)
function darkOverlay(w, h, opacity = 0.4) {
  return sharp({
    create: {
      width: w,
      height: h,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: opacity }
    }
  }).png().toBuffer();
}

// Helper: resize and center-crop an image to exact dimensions
async function fitCover(inputPath, w, h) {
  return sharp(inputPath)
    .resize(w, h, { fit: 'cover', position: 'centre' })
    .toBuffer();
}

// Helper: remove black background from logo using raw pixel manipulation
async function makeLogoTransparent() {
  const img = sharp(path.join(ART, 'game_logo.png')).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const buf = Buffer.from(data);

  // For each pixel: if it's very dark, make it transparent
  // Use a threshold and ramp for smooth edges
  for (let i = 0; i < buf.length; i += 4) {
    const r = buf[i], g = buf[i + 1], b = buf[i + 2];
    const brightness = Math.max(r, g, b);
    if (brightness < 25) {
      buf[i + 3] = 0; // fully transparent
    } else if (brightness < 60) {
      // Gradual fade for anti-aliased edges
      buf[i + 3] = Math.round(((brightness - 25) / 35) * 255);
    }
    // else keep full opacity
  }

  return sharp(buf, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
}

let _logoTransparent = null;
async function getTransparentLogo() {
  if (!_logoTransparent) _logoTransparent = await makeLogoTransparent();
  return _logoTransparent;
}

// Helper: resize logo to fit within given bounds, preserving aspect ratio
async function resizeLogo(maxW, maxH) {
  const logo = await getTransparentLogo();
  return sharp(logo)
    .resize(maxW, maxH, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

// Helper: get metadata of a buffer
async function meta(buf) {
  return sharp(buf).metadata();
}

// ============================================================
// 1. Header Capsule — 460x215
// ============================================================
async function headerCapsule() {
  const W = 460, H = 215;
  const bg = await fitCover(path.join(ART, 'arena_action.webp'), W, H);
  const dark = await darkOverlay(W, H, 0.35);
  const logo = await resizeLogo(Math.round(W * 0.55), Math.round(H * 0.70));
  const logoMeta = await meta(logo);

  // Center the logo
  const logoLeft = Math.round((W - logoMeta.width) / 2);
  const logoTop = Math.round((H - logoMeta.height) / 2);

  await sharp(bg)
    .composite([
      { input: dark, blend: 'over' },
      { input: logo, left: logoLeft, top: logoTop, blend: 'over' }
    ])
    .png()
    .toFile(path.join(OUT, 'header_capsule.png'));

  console.log('  [OK] header_capsule.png (460x215)');
}

// ============================================================
// 2. Small Capsule — 231x87
// ============================================================
async function smallCapsule() {
  const W = 231, H = 87;
  const bg = await fitCover(path.join(ART, 'arena_action.webp'), W, H);
  const dark = await darkOverlay(W, H, 0.4);
  const logo = await resizeLogo(Math.round(W * 0.60), Math.round(H * 0.65));
  const logoMeta = await meta(logo);

  const logoLeft = Math.round((W - logoMeta.width) / 2);
  const logoTop = Math.round((H - logoMeta.height) / 2);

  await sharp(bg)
    .composite([
      { input: dark, blend: 'over' },
      { input: logo, left: logoLeft, top: logoTop, blend: 'over' }
    ])
    .png()
    .toFile(path.join(OUT, 'small_capsule.png'));

  console.log('  [OK] small_capsule.png (231x87)');
}

// ============================================================
// 3. Main Capsule — 616x353
// ============================================================
async function mainCapsule() {
  const W = 616, H = 353;
  const bg = await fitCover(path.join(ART, 'arena_action.webp'), W, H);
  const dark = await darkOverlay(W, H, 0.30);
  const logo = await resizeLogo(Math.round(W * 0.50), Math.round(H * 0.55));
  const logoMeta = await meta(logo);

  const logoLeft = Math.round((W - logoMeta.width) / 2);
  const logoTop = Math.round((H - logoMeta.height) / 2);

  await sharp(bg)
    .composite([
      { input: dark, blend: 'over' },
      { input: logo, left: logoLeft, top: logoTop, blend: 'over' }
    ])
    .png()
    .toFile(path.join(OUT, 'main_capsule.png'));

  console.log('  [OK] main_capsule.png (616x353)');
}

// ============================================================
// 4. Library Capsule — 600x900 (vertical)
//    Compose 3 class portraits vertically with logo at top
// ============================================================
async function libraryCapsule() {
  const W = 600, H = 900;

  // Use 3 class portraits stacked vertically behind the logo
  const classes = ['tyrant', 'infernal', 'wraith'];
  const portraitH = Math.round(H / classes.length); // 300 each

  const composites = [];

  for (let i = 0; i < classes.length; i++) {
    const portrait = await fitCover(
      path.join(ART, `${classes[i]}_portrait.webp`), W, portraitH
    );
    composites.push({ input: portrait, left: 0, top: i * portraitH, blend: 'over' });
  }

  // Dark overlay — heavier at top for logo readability
  const darkTop = await darkOverlay(W, Math.round(H * 0.4), 0.55);
  const darkBot = await darkOverlay(W, H, 0.25);

  const logo = await resizeLogo(Math.round(W * 0.70), Math.round(H * 0.25));
  const logoMeta = await meta(logo);
  const logoLeft = Math.round((W - logoMeta.width) / 2);
  const logoTop = Math.round(H * 0.06);

  // Build on a black canvas
  const canvas = sharp({
    create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } }
  }).png();

  await canvas
    .composite([
      ...composites,
      { input: darkBot, blend: 'over' },
      { input: darkTop, left: 0, top: 0, blend: 'over' },
      { input: logo, left: logoLeft, top: logoTop, blend: 'over' }
    ])
    .png()
    .toFile(path.join(OUT, 'library_capsule.png'));

  console.log('  [OK] library_capsule.png (600x900)');
}

// ============================================================
// 5. Library Hero — 3840x1240 (wide panoramic)
//    Arena background with class wide splashes composited
// ============================================================
async function libraryHero() {
  const W = 3840, H = 1240;

  const bg = await fitCover(path.join(ART, 'arena_action.webp'), W, H);
  const dark = await darkOverlay(W, H, 0.3);

  // Place 5 class wide splashes across the bottom, evenly spaced
  const classes = ['tyrant', 'wraith', 'infernal', 'harbinger', 'revenant'];
  const splashH = Math.round(H * 0.85);
  const splashW = Math.round(W / classes.length); // ~768 each

  const composites = [{ input: dark, blend: 'over' }];

  for (let i = 0; i < classes.length; i++) {
    const splash = await sharp(path.join(ART, `${classes[i]}_splash_wide.webp`))
      .resize(splashW, splashH, { fit: 'cover', position: 'top' })
      .ensureAlpha()
      .toBuffer();

    // Create a gradient mask: transparent at edges, opaque in center for blending
    // We'll use a simpler approach: just darken and composite with reduced opacity
    const fadedSplash = await sharp(splash)
      .modulate({ brightness: 0.85 })
      .toBuffer();

    composites.push({
      input: fadedSplash,
      left: i * splashW,
      top: H - splashH,
      blend: 'over'
    });
  }

  // Add a stronger dark gradient at the top for logo area
  const darkGradientTop = await darkOverlay(W, Math.round(H * 0.35), 0.5);
  composites.push({ input: darkGradientTop, left: 0, top: 0, blend: 'over' });

  // Logo centered near the top
  const logo = await resizeLogo(Math.round(W * 0.18), Math.round(H * 0.35));
  const logoMeta = await meta(logo);
  const logoLeft = Math.round((W - logoMeta.width) / 2);
  const logoTop = Math.round(H * 0.05);
  composites.push({ input: logo, left: logoLeft, top: logoTop, blend: 'over' });

  await sharp(bg)
    .composite(composites)
    .png()
    .toFile(path.join(OUT, 'library_hero.png'));

  console.log('  [OK] library_hero.png (3840x1240)');
}

// ============================================================
// 6. Page Background — 1438x810
//    Darkened home_bg
// ============================================================
async function pageBackground() {
  const W = 1438, H = 810;
  const bg = await fitCover(path.join(ART, 'home_bg.webp'), W, H);
  const dark = await darkOverlay(W, H, 0.5);

  await sharp(bg)
    .composite([{ input: dark, blend: 'over' }])
    .png()
    .toFile(path.join(OUT, 'page_background.png'));

  console.log('  [OK] page_background.png (1438x810)');
}

// ============================================================
// Run all
// ============================================================
async function main() {
  console.log('Generating Steam store capsule images...\n');

  await headerCapsule();
  await smallCapsule();
  await mainCapsule();
  await libraryCapsule();
  await libraryHero();
  await pageBackground();

  console.log('\nAll 6 images written to:', OUT);
}

main().catch(err => { console.error(err); process.exit(1); });
