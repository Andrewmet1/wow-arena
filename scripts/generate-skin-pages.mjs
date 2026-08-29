#!/usr/bin/env node
// Update marketing pages when a skin is published:
// 1. Add/update SKINS section on the class page
// 2. Create a news article page
// 3. Prepend entry to feed.json
// 4. Insert card into news/index.html
// 5. Fire-and-forget forum sync

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { spawn } from 'child_process';

const ROOT = resolve(import.meta.dirname, '..');

// ── Class metadata ──
const CLASS_META = {
  tyrant:    { name: 'Tyrant',    role: 'WARRIOR',  color: '#8B0000' },
  wraith:    { name: 'Wraith',    role: 'ASSASSIN',  color: '#6B2FA0' },
  infernal:  { name: 'Infernal',  role: 'MAGE',      color: '#FF4500' },
  harbinger: { name: 'Harbinger', role: 'WARLOCK',   color: '#228B22' },
  revenant:  { name: 'Revenant',  role: 'PALADIN',   color: '#C8B560' },
};

const RARITY_COLORS = {
  common: '#888888',
  rare: '#4a9eff',
  epic: '#a855f7',
  legendary: '#c8a860',
};

// ── Parse CLI args ──
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : null;
}

const classId = getArg('class');
const skinId = getArg('skin');
const skinName = getArg('name') || skinId?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const rarity = getArg('rarity') || 'epic';
const price = parseInt(getArg('price') || '5000', 10);
const description = getArg('description') || `A new skin for ${CLASS_META[classId]?.name || classId}.`;

if (!classId || !skinId) {
  console.error('Usage: node generate-skin-pages.mjs --class <id> --skin <id> --name "Name" --rarity epic --price 5000 --description "..."');
  process.exit(1);
}

const classMeta = CLASS_META[classId];
if (!classMeta) {
  console.error(`Unknown class: ${classId}`);
  process.exit(1);
}

const skinKey = `${classId}_${skinId}`;
const slug = `skin-${classId}-${skinName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
const rarityColor = RARITY_COLORS[rarity] || RARITY_COLORS.epic;

// Format current date
const now = new Date();
const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
const dateUpper = dateStr.toUpperCase();

// HTML-escape helper
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Parse SKIN_CATALOG from AssetManifest.js ──
function parseSkinCatalog(forClassId) {
  const source = readFileSync(resolve(ROOT, 'src/rendering/AssetManifest.js'), 'utf-8');
  const catalogMatch = source.match(/export const SKIN_CATALOG\s*=\s*\{([\s\S]*?)\n\};/);
  if (!catalogMatch) return [];

  const skins = [];
  // Match each entry block: key: { ... },
  const entryRegex = /(\w+):\s*\{([^}]+)\}/g;
  let m;
  while ((m = entryRegex.exec(catalogMatch[1])) !== null) {
    const key = m[1];
    const body = m[2];
    const get = (field) => {
      const fm = body.match(new RegExp(`${field}:\\s*['"]([^'"]*)['"']`));
      return fm ? fm[1] : null;
    };
    const getNum = (field) => {
      const fm = body.match(new RegExp(`${field}:\\s*(\\d+)`));
      return fm ? parseInt(fm[1], 10) : null;
    };
    const cid = get('classId');
    if (cid !== forClassId) continue;
    skins.push({
      key,
      classId: cid,
      skinId: get('skinId'),
      name: get('name'),
      rarity: get('rarity'),
      price: getNum('price'),
      description: get('description'),
      portraitArt: get('portraitArt'),
      splashArt: get('splashArt'),
      bannerArt: get('bannerArt'),
      loadingArt: get('loadingArt'),
      iconArt: get('iconArt'),
    });
  }
  return skins;
}


// ══════════════════════════════════════════
// Part A: Update class page — Skins Showcase
// ══════════════════════════════════════════
console.log(`  [Pages] Updating ${classMeta.name} class page...`);

const classPagePath = resolve(ROOT, `classes/${classId}/index.html`);
if (existsSync(classPagePath)) {
  const skins = parseSkinCatalog(classId);
  const skinCount = skins.length;

  // Build slides — default + each catalog skin
  const allSkins = [
    {
      name: classMeta.name,
      rarity: null,
      description: 'The original look. Free for all players.',
      price: null,
      banner: `/assets/art/${classId}_banner.webp`,
      splash: `/assets/art/${classId}_splash_wide.webp`,
      portrait: `/assets/art/${classId}_portrait.webp`,
      color: '#888',
      isDefault: true,
    },
    ...skins.map(s => ({
      name: s.name,
      rarity: s.rarity,
      description: s.description || '',
      price: s.price,
      banner: s.bannerArt || `/assets/art/skins/${s.key}_banner.webp`,
      splash: s.splashArt || `/assets/art/skins/${s.key}_splash_wide.webp`,
      portrait: s.portraitArt || `/assets/art/skins/${s.key}_portrait.webp`,
      color: RARITY_COLORS[s.rarity] || RARITY_COLORS.epic,
      isDefault: false,
    })),
  ];

  let slidesHtml = '';
  let thumbsHtml = '';

  allSkins.forEach((s, i) => {
    const activeClass = i === 0 ? ' active' : '';
    slidesHtml += `
      <div class="skin-slide${activeClass}" data-skin-idx="${i}">
        <img class="skin-slide-img" src="${s.banner}" alt="${esc(s.name)}">
        <div class="skin-slide-overlay">
          <div class="skin-slide-rarity" style="color:${s.color};">${s.isDefault ? 'DEFAULT' : (s.rarity || 'EPIC').toUpperCase()}</div>
          <div class="skin-slide-name">${esc(s.name).toUpperCase()}</div>
          <div class="skin-slide-desc">${esc(s.description)}</div>${s.price ? `
          <div class="skin-slide-price">&#x1FA99; ${s.price}</div>` : ''}
          <a href="/play/" class="skin-slide-cta">${s.isDefault ? 'PLAY NOW' : 'GET IN SHOP'}</a>
        </div>
      </div>`;

    thumbsHtml += `
      <div class="skin-thumb${activeClass}" data-skin-idx="${i}" style="--thumb-color:${s.color};--thumb-glow:${s.color}40;">
        <img src="${s.portrait}" alt="${esc(s.name)}">
        <div class="skin-thumb-label">${esc(s.isDefault ? 'DEFAULT' : s.name)}</div>
      </div>`;
  });

  const showcaseScript = `
  <script>
  (function(){
    var thumbs=document.querySelectorAll('.skin-thumb');
    var slides=document.querySelectorAll('.skin-slide');
    thumbs.forEach(function(t){
      t.addEventListener('click',function(){
        var idx=parseInt(t.dataset.skinIdx,10);
        thumbs.forEach(function(th){th.classList.remove('active')});
        slides.forEach(function(sl){sl.classList.remove('active')});
        t.classList.add('active');
        slides[idx].classList.add('active');
      });
    });
  })();
  </script>`;

  const skinsSection = `<!-- BEGIN SKINS -->
  <div class="glow-divider"></div>
  <div class="skins-section ambient-wash section-glow-top">
    <div class="skins-header">
      <div class="skins-header-title">SKINS</div>
      <div class="skins-header-count">${skinCount} SKIN${skinCount !== 1 ? 'S' : ''} AVAILABLE</div>
      <div class="skins-header-line" style="background:linear-gradient(90deg,transparent,${classMeta.color}80,transparent);"></div>
    </div>
    <div class="skin-showcase">${slidesHtml}
    </div>
    <div class="skin-thumbs">${thumbsHtml}
    </div>
  </div>${showcaseScript}
  <!-- END SKINS -->`;

  let page = readFileSync(classPagePath, 'utf-8');

  // Check for existing sentinel markers
  const sentinelRegex = /<!-- BEGIN SKINS -->[\s\S]*?<!-- END SKINS -->/;
  if (sentinelRegex.test(page)) {
    page = page.replace(sentinelRegex, skinsSection);
    console.log(`    Replaced existing SKINS section`);
  } else {
    // First time — inject before the glow-divider + class-nav-strip block
    const injectRegex = /(\n\s*<div class="glow-divider"><\/div>\s*\n\s*<div class="class-nav-strip">)/;
    if (injectRegex.test(page)) {
      page = page.replace(injectRegex, '\n\n  ' + skinsSection + '\n$1');
      console.log(`    Injected new SKINS section`);
    } else {
      console.warn(`    Could not find injection point in ${classPagePath}`);
    }
  }

  writeFileSync(classPagePath, page, 'utf-8');
} else {
  console.warn(`    Class page not found: ${classPagePath}`);
}


// ══════════════════════════════════════════
// Part B: Generate news article page
// ══════════════════════════════════════════
console.log(`  [Pages] Creating news article: ${slug}`);

const newsDir = resolve(ROOT, `news/${slug}`);
mkdirSync(newsDir, { recursive: true });

const bannerArt = `/assets/art/skins/${skinKey}_banner.webp`;
const splashArt = `/assets/art/skins/${skinKey}_splash_wide.webp`;
const portraitArt = `/assets/art/skins/${skinKey}_portrait.webp`;
const loadingArt = `/assets/art/skins/${skinKey}_loading.webp`;

// Color components for rgba
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const articleHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
  <title>New Skin: ${esc(skinName)} &mdash; Ebon Crucible</title>
  <meta name="description" content="${esc(description)}">
  <meta property="og:title" content="New Skin: ${esc(skinName)} — Ebon Crucible">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:image" content="${bannerArt}">
  <meta property="og:type" content="article">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="canonical" href="https://eboncrucible.com/news/${slug}/">
  <meta name="theme-color" content="#08080f">
  <link rel="stylesheet" href="/src/styles/ebon-pages.css">
</head>
<body class="ambient-lines">
  <div class="page-bg" style="background-image:url('${bannerArt}');"></div>
  <nav class="nav">
    <a href="/" class="nav-brand">EBON CRUCIBLE <span class="alpha-badge">ALPHA</span></a>
    <div class="nav-links">
      <a href="/">HOME</a>
      <a href="/classes/">CLASSES</a>
      <a href="/gameplay/">GAME</a>
      <a href="/rankings/">RANKINGS</a>
      <a href="/news/" class="active">NEWS</a>
      <a href="/community/">COMMUNITY</a>
      <a href="/play/" class="nav-signin" id="nav-auth">SIGN IN</a>
      <a href="/play/" class="nav-play">PLAY FREE</a>
    </div>
  </nav>

  <div class="hero" style="min-height: 40vh;">
    <div class="hero-bg" style="background-image: url('${bannerArt}');"></div>
    <div class="hero-overlay"></div>
    <div class="hero-content">
      <div class="article-badge" style="color:${rarityColor};background:${hexToRgba(rarityColor, 0.12)};border:1px solid ${hexToRgba(rarityColor, 0.25)};">NEW SKIN</div>
      <h1 style="font-size: 28px; letter-spacing: 6px;">${esc(skinName).toUpperCase()}</h1>
      <div class="hero-line"></div>
      <p>A new ${rarity} skin for the ${esc(classMeta.name)}.</p>
    </div>
    <div class="hero-scroll-arrow">&#9660;</div>
  </div>

  <div class="glow-divider"></div>
  <a href="/news/" class="back-link">&larr; BACK TO NEWS</a>
  <div class="content section-panel" style="padding:40px;">
    <div class="article-date" style="margin-bottom:20px;">${dateUpper}</div>

    <!-- Skin Showcase -->
    <div style="margin-bottom:32px;border-radius:10px;overflow:hidden;border:1px solid #1a1a2a;">
      <img src="${splashArt}" alt="${esc(skinName)}" style="width:100%;display:block;">
    </div>

    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
      <div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:${hexToRgba(rarityColor, 0.1)};border:1px solid ${hexToRgba(rarityColor, 0.25)};font-size:18px;">&#x2694;</div>
      <h2 style="font-size:18px;letter-spacing:4px;color:${rarityColor};margin:0;">${esc(skinName).toUpperCase()}</h2>
    </div>

    <p style="color:#999;line-height:1.8;margin-bottom:24px;font-size:14px;">
      ${esc(description)}
    </p>

    <!-- Skin Details -->
    <div style="background:rgba(12,12,22,0.6);border:1px solid rgba(200,168,96,0.12);border-radius:10px;padding:24px;margin-bottom:32px;">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;text-align:center;">
        <div>
          <div style="font-size:9px;letter-spacing:2px;color:#555;font-weight:700;margin-bottom:6px;">CLASS</div>
          <div style="font-size:14px;color:${classMeta.color};font-weight:700;letter-spacing:1px;">${classMeta.name.toUpperCase()}</div>
        </div>
        <div>
          <div style="font-size:9px;letter-spacing:2px;color:#555;font-weight:700;margin-bottom:6px;">RARITY</div>
          <div style="font-size:14px;color:${rarityColor};font-weight:700;letter-spacing:1px;">${rarity.toUpperCase()}</div>
        </div>
        <div>
          <div style="font-size:9px;letter-spacing:2px;color:#555;font-weight:700;margin-bottom:6px;">PRICE</div>
          <div style="font-size:14px;color:#c8a860;font-weight:700;">&#x1FA99; ${price}</div>
        </div>
      </div>
    </div>

    <!-- Art Gallery -->
    <div style="font-size:10px;letter-spacing:3px;color:#c8a860;font-weight:900;margin-bottom:16px;text-align:center;">ART GALLERY</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:32px;">
      <div style="border-radius:8px;overflow:hidden;border:1px solid #1a1a2a;">
        <img src="${portraitArt}" alt="Portrait" style="width:100%;display:block;">
        <div style="padding:6px;text-align:center;font-size:9px;letter-spacing:2px;color:#555;background:rgba(12,12,22,0.8);">PORTRAIT</div>
      </div>
      <div style="border-radius:8px;overflow:hidden;border:1px solid #1a1a2a;">
        <img src="${bannerArt}" alt="Banner" style="width:100%;display:block;">
        <div style="padding:6px;text-align:center;font-size:9px;letter-spacing:2px;color:#555;background:rgba(12,12,22,0.8);">BANNER</div>
      </div>
      <div style="border-radius:8px;overflow:hidden;border:1px solid #1a1a2a;">
        <img src="${loadingArt}" alt="Loading Screen" style="width:100%;display:block;">
        <div style="padding:6px;text-align:center;font-size:9px;letter-spacing:2px;color:#555;background:rgba(12,12,22,0.8);">LOADING SCREEN</div>
      </div>
    </div>

    <div style="width:100%;height:1px;background:linear-gradient(90deg,transparent,rgba(200,168,96,0.15),transparent);margin:32px 0;"></div>

    <div style="text-align:center;">
      <p style="color:#888;font-size:11px;letter-spacing:2px;margin-bottom:16px;">AVAILABLE NOW IN THE SHOP</p>
      <a href="/play/" style="display:inline-block;padding:12px 36px;font-size:12px;letter-spacing:4px;font-weight:700;background:linear-gradient(180deg,${classMeta.color},${classMeta.color}88);border:2px solid #c8a860;color:#c8a860;border-radius:4px;text-decoration:none;">GET IT NOW</a>
    </div>
  </div>

  <div class="footer">&copy; 2026 Ebon Crucible. All rights reserved.<div class="footer-alpha">Currently in Alpha &mdash; features and balance are actively evolving.</div></div>

  <script>
    (function() {
      var c = document.querySelector('.hero');
      for (var i = 0; i < 15; i++) {
        var p = document.createElement('div');
        var s = 2 + Math.random() * 4;
        p.style.cssText = 'position:absolute;bottom:-10px;left:' + (Math.random()*100) + '%;width:' + s + 'px;height:' + s + 'px;border-radius:50%;background:rgba(200,168,96,0.6);opacity:0;pointer-events:none;animation:particleFloat ' + (6+Math.random()*6) + 's ' + (Math.random()*8) + 's ease-out infinite;';
        c.appendChild(p);
      }
    })();
  </script>
<script>
(function(){try{
  var n=localStorage.getItem('ec_username');
  if(n){
    var el=document.getElementById('nav-auth');
    if(el){
      el.textContent=n+' \\u25BE';
      el.href='javascript:void(0)';
      el.style.position='relative';
      el.style.cursor='pointer';
      var dd=document.createElement('div');
      dd.style.cssText='display:none;position:absolute;top:100%;right:0;margin-top:8px;min-width:120px;background:rgba(12,12,22,0.98);border:1px solid #2a2a3a;border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,0.5);overflow:hidden;z-index:9999;';
      var profile=document.createElement('a');profile.href='/play/';profile.textContent='\\u26E8 PROFILE';
      profile.style.cssText='display:block;padding:10px 16px;font-size:9px;letter-spacing:2px;font-weight:700;color:#888;text-decoration:none;transition:background 0.2s;';
      profile.onmouseenter=function(){this.style.background='rgba(255,255,255,0.04)'};profile.onmouseleave=function(){this.style.background='none'};
      dd.appendChild(profile);
      var logout=document.createElement('a');logout.href='javascript:void(0)';logout.textContent='\\u23FB LOG OUT';
      logout.style.cssText='display:block;padding:10px 16px;font-size:9px;letter-spacing:2px;font-weight:700;color:#cc6666;text-decoration:none;transition:background 0.2s;';
      logout.onmouseenter=function(){this.style.background='rgba(255,255,255,0.04)'};logout.onmouseleave=function(){this.style.background='none'};
      logout.onclick=function(e){e.stopPropagation();localStorage.removeItem('ec_username');localStorage.removeItem('CognitoIdentityServiceProvider.sn01blkd57e7oi7e7vq80mipv.LastAuthUser');var keys=Object.keys(localStorage);for(var i=0;i<keys.length;i++){if(keys[i].indexOf('CognitoIdentityServiceProvider')===0)localStorage.removeItem(keys[i]);}window.location.reload();};
      dd.appendChild(logout);
      el.appendChild(dd);
      var open=false;
      el.onclick=function(e){e.preventDefault();e.stopPropagation();open=!open;dd.style.display=open?'block':'none';};
      document.addEventListener('click',function(){dd.style.display='none';open=false;});var pb=document.querySelector('.nav-play');if(pb)pb.textContent='PLAY NOW';
    }
  }
}catch(e){}})();
</script>
</body>
</html>`;

writeFileSync(resolve(newsDir, 'index.html'), articleHtml, 'utf-8');
console.log(`    Created news/${slug}/index.html`);


// ══════════════════════════════════════════
// Part C: Update feed.json
// ══════════════════════════════════════════
console.log(`  [Pages] Updating feed.json...`);

const feedPath = resolve(ROOT, 'public/news/feed.json');
let feed = [];
if (existsSync(feedPath)) {
  try { feed = JSON.parse(readFileSync(feedPath, 'utf-8')); } catch (e) { feed = []; }
}

// Don't add duplicate
if (!feed.some(item => item.id === slug)) {
  feed.unshift({
    id: slug,
    badge: 'NEW SKIN',
    badgeColor: rarityColor,
    date: dateStr,
    title: `New Skin: ${skinName}`,
    excerpt: description.length > 200 ? description.slice(0, 197) + '...' : description,
    bgImage: bannerArt,
  });
  writeFileSync(feedPath, JSON.stringify(feed, null, 2) + '\n', 'utf-8');
  console.log(`    Prepended entry to feed.json`);
} else {
  console.log(`    feed.json already has ${slug}`);
}


// ══════════════════════════════════════════
// Part D: Update news/index.html
// ══════════════════════════════════════════
console.log(`  [Pages] Updating news index page...`);

const newsIndexPath = resolve(ROOT, 'news/index.html');
if (existsSync(newsIndexPath)) {
  let newsIndex = readFileSync(newsIndexPath, 'utf-8');

  // Check if this article card already exists
  if (!newsIndex.includes(`href="/news/${slug}/"`)) {
    const newCard = `    <a href="/news/${slug}/" class="article-card" style="animation-delay: 0.05s;">
      <div class="article-badge" style="color:${rarityColor};background:${hexToRgba(rarityColor, 0.12)};border:1px solid ${hexToRgba(rarityColor, 0.25)};">NEW SKIN</div>
      <div class="article-date">${dateUpper}</div>
      <div class="article-title">New Skin: ${esc(skinName)}</div>
      <div class="article-excerpt">${esc(description.length > 200 ? description.slice(0, 197) + '...' : description)}</div>
    </a>\n\n`;

    // Insert after the <!-- BEGIN NEWS CARDS --> sentinel + opening div
    const sentinel = '<!-- BEGIN NEWS CARDS -->';
    const sentinelIdx = newsIndex.indexOf(sentinel);
    // Find the end of the <div> that follows the sentinel
    const divAfter = newsIndex.indexOf('>', sentinelIdx + sentinel.length);
    if (sentinelIdx !== -1 && divAfter !== -1) {
      const insertIdx = divAfter + 1;
      newsIndex = newsIndex.slice(0, insertIdx) + '\n' + newCard + newsIndex.slice(insertIdx);

      // Re-stagger animation delays on all cards
      let delayIdx = 0;
      newsIndex = newsIndex.replace(/(<a href="\/news\/[^"]*"[^>]*style="animation-delay:\s*)[\d.]+s/g, (match, prefix) => {
        const delay = (0.05 + delayIdx * 0.05).toFixed(2);
        delayIdx++;
        return `${prefix}${delay}s`;
      });

      writeFileSync(newsIndexPath, newsIndex, 'utf-8');
      console.log(`    Inserted card into news/index.html`);
    } else {
      console.warn(`    Could not find insertion point in news/index.html`);
    }
  } else {
    console.log(`    news/index.html already has ${slug}`);
  }
} else {
  console.warn(`    news/index.html not found`);
}


// ══════════════════════════════════════════
// Part E: Forum sync (fire-and-forget)
// ══════════════════════════════════════════
const syncScript = resolve(ROOT, 'scripts/sync-news-to-forum.mjs');
if (existsSync(syncScript)) {
  const child = spawn('node', [syncScript], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
  console.log(`  [Pages] Forum sync started (background)`);
}

console.log(`  [Pages] Marketing pages updated!`);
