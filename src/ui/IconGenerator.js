// =============================================================================
// IconGenerator.js — Procedural canvas-based ability icons, class emblems,
// and class portraits for a dark-fantasy arena game.
// =============================================================================

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const _cache = new Map();

function getCached(key, generator) {
  if (!_cache.has(key)) _cache.set(key, generator());
  return _cache.get(key);
}

// ---------------------------------------------------------------------------
// School color palettes
// ---------------------------------------------------------------------------

const SCHOOL_COLORS = {
  physical: {
    bgOuter: '#5a5a6a',
    bgInner: '#2a2a3a',
    symbol:  '#ccccdd',
    border:  '#555566',
    glow:    '#8888aa'
  },
  holy: {
    bgOuter: '#c8a020',
    bgInner: '#7a5a10',
    symbol:  '#fff8e0',
    border:  '#d4a800',
    glow:    '#ffe066'
  },
  fire: {
    bgOuter: '#cc3300',
    bgInner: '#661800',
    symbol:  '#ffcc44',
    border:  '#ff4400',
    glow:    '#ff6622'
  },
  shadow: {
    bgOuter: '#5522aa',
    bgInner: '#2a1155',
    symbol:  '#cc88ff',
    border:  '#7733cc',
    glow:    '#9944ee'
  },
  frost: {
    bgOuter: '#2266bb',
    bgInner: '#0a2244',
    symbol:  '#aaddff',
    border:  '#3388dd',
    glow:    '#55aaee'
  },
  nature: {
    bgOuter: '#228833',
    bgInner: '#0a3318',
    symbol:  '#88ff88',
    border:  '#33aa44',
    glow:    '#44cc55'
  },
  arcane: {
    bgOuter: '#8833bb',
    bgInner: '#440a66',
    symbol:  '#dd99ff',
    border:  '#aa44dd',
    glow:    '#bb66ee'
  }
};

// ---------------------------------------------------------------------------
// Class color palettes
// ---------------------------------------------------------------------------

const CLASS_COLORS = {
  tyrant: {
    primary:   '#8B0000',
    secondary: '#708090',
    accent:    '#cc2222',
    bg:        '#1a1a2a',
    glow:      '#ff3333'
  },
  wraith: {
    primary:   '#2D1B69',
    secondary: '#1a1a2e',
    accent:    '#9955dd',
    bg:        '#0e0e1a',
    glow:      '#bb77ff'
  },
  infernal: {
    primary:   '#FF4500',
    secondary: '#FFD700',
    accent:    '#ff6622',
    bg:        '#1a0e0a',
    glow:      '#ff8844'
  },
  harbinger: {
    primary:   '#006400',
    secondary: '#9400D3',
    accent:    '#33aa44',
    bg:        '#0a1a0e',
    glow:      '#55cc66'
  },
  revenant: {
    primary:   '#F5F5DC',
    secondary: '#FFD700',
    accent:    '#d4a800',
    bg:        '#1a1a12',
    glow:      '#ffe066'
  }
};

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------

function createCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Symbol drawing functions
// Each takes (ctx, cx, cy, size, color) where size is the drawable area radius
// ---------------------------------------------------------------------------

function drawSword(ctx, cx, cy, size, color) {
  const s = size * 0.9;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.5, size * 0.06);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Blade
  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 0.85);
  ctx.lineTo(cx + s * 0.08, cy - s * 0.75);
  ctx.lineTo(cx + s * 0.06, cy + s * 0.25);
  ctx.lineTo(cx, cy + s * 0.35);
  ctx.lineTo(cx - s * 0.06, cy + s * 0.25);
  ctx.lineTo(cx - s * 0.08, cy - s * 0.75);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Crossguard
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.35, cy + s * 0.25);
  ctx.lineTo(cx + s * 0.35, cy + s * 0.25);
  ctx.lineTo(cx + s * 0.30, cy + s * 0.32);
  ctx.lineTo(cx - s * 0.30, cy + s * 0.32);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Grip
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.04, cy + s * 0.32);
  ctx.lineTo(cx + s * 0.04, cy + s * 0.32);
  ctx.lineTo(cx + s * 0.04, cy + s * 0.65);
  ctx.lineTo(cx - s * 0.04, cy + s * 0.65);
  ctx.closePath();
  ctx.fill();

  // Pommel
  ctx.beginPath();
  ctx.arc(cx, cy + s * 0.72, s * 0.07, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawDualDaggers(ctx, cx, cy, size, color) {
  const s = size * 0.85;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, size * 0.04);
  ctx.lineCap = 'round';

  for (let side = -1; side <= 1; side += 2) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(side * 0.45);

    // Blade
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.75);
    ctx.lineTo(s * 0.06, -s * 0.6);
    ctx.lineTo(s * 0.04, s * 0.1);
    ctx.lineTo(0, s * 0.18);
    ctx.lineTo(-s * 0.04, s * 0.1);
    ctx.lineTo(-s * 0.06, -s * 0.6);
    ctx.closePath();
    ctx.fill();

    // Guard
    ctx.beginPath();
    ctx.moveTo(-s * 0.18, s * 0.15);
    ctx.lineTo(s * 0.18, s * 0.15);
    ctx.lineTo(s * 0.14, s * 0.2);
    ctx.lineTo(-s * 0.14, s * 0.2);
    ctx.closePath();
    ctx.fill();

    // Handle
    ctx.fillRect(-s * 0.03, s * 0.2, s * 0.06, s * 0.25);

    ctx.restore();
  }
  ctx.restore();
}

function drawShield(ctx, cx, cy, size, color) {
  const s = size * 0.85;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, size * 0.05);
  ctx.lineJoin = 'round';

  // Kite shield
  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 0.7);
  ctx.quadraticCurveTo(cx + s * 0.55, cy - s * 0.65, cx + s * 0.55, cy - s * 0.1);
  ctx.quadraticCurveTo(cx + s * 0.45, cy + s * 0.35, cx, cy + s * 0.75);
  ctx.quadraticCurveTo(cx - s * 0.45, cy + s * 0.35, cx - s * 0.55, cy - s * 0.1);
  ctx.quadraticCurveTo(cx - s * 0.55, cy - s * 0.65, cx, cy - s * 0.7);
  ctx.closePath();
  ctx.globalAlpha = 0.3;
  ctx.fill();
  ctx.globalAlpha = 1.0;
  ctx.stroke();

  // Inner cross on shield
  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 0.45);
  ctx.lineTo(cx, cy + s * 0.45);
  ctx.moveTo(cx - s * 0.28, cy - s * 0.1);
  ctx.lineTo(cx + s * 0.28, cy - s * 0.1);
  ctx.stroke();

  ctx.restore();
}

function drawFlame(ctx, cx, cy, size, color) {
  const s = size * 0.9;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, size * 0.03);

  // Three flame tongues
  const flames = [
    { ox: 0, h: 1.0, w: 0.3 },
    { ox: -0.22, h: 0.7, w: 0.22 },
    { ox: 0.22, h: 0.65, w: 0.2 }
  ];

  for (const f of flames) {
    const bx = cx + f.ox * s;
    const by = cy + s * 0.4;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(bx - f.w * s, by - f.h * s * 0.5, bx, by - f.h * s);
    ctx.quadraticCurveTo(bx + f.w * s, by - f.h * s * 0.5, bx, by);
    ctx.closePath();
    ctx.globalAlpha = 0.7;
    ctx.fill();
    ctx.globalAlpha = 1.0;
    ctx.stroke();
  }

  ctx.restore();
}

function drawLightning(ctx, cx, cy, size, color) {
  const s = size * 0.9;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, size * 0.07);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(cx + s * 0.1, cy - s * 0.8);
  ctx.lineTo(cx - s * 0.15, cy - s * 0.1);
  ctx.lineTo(cx + s * 0.1, cy - s * 0.1);
  ctx.lineTo(cx - s * 0.1, cy + s * 0.8);
  ctx.stroke();

  // Glow dot at top
  ctx.beginPath();
  ctx.arc(cx + s * 0.1, cy - s * 0.8, s * 0.06, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawSkull(ctx, cx, cy, size, color) {
  const s = size * 0.8;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.5, size * 0.05);

  // Cranium
  ctx.beginPath();
  ctx.ellipse(cx, cy - s * 0.15, s * 0.4, s * 0.45, 0, 0, Math.PI * 2);
  ctx.globalAlpha = 0.25;
  ctx.fill();
  ctx.globalAlpha = 1.0;
  ctx.stroke();

  // Jaw
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.28, cy + s * 0.2);
  ctx.quadraticCurveTo(cx - s * 0.2, cy + s * 0.55, cx, cy + s * 0.5);
  ctx.quadraticCurveTo(cx + s * 0.2, cy + s * 0.55, cx + s * 0.28, cy + s * 0.2);
  ctx.stroke();

  // Eye sockets
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + side * s * 0.16, cy - s * 0.2, s * 0.1, s * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Nose
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.0);
  ctx.lineTo(cx - s * 0.05, cy + s * 0.12);
  ctx.lineTo(cx + s * 0.05, cy + s * 0.12);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawCross(ctx, cx, cy, size, color) {
  const s = size * 0.8;
  const arm = s * 0.18;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, size * 0.03);

  ctx.beginPath();
  // Vertical bar
  ctx.moveTo(cx - arm, cy - s * 0.65);
  ctx.lineTo(cx + arm, cy - s * 0.65);
  ctx.lineTo(cx + arm, cy - arm);
  // Right arm
  ctx.lineTo(cx + s * 0.5, cy - arm);
  ctx.lineTo(cx + s * 0.5, cy + arm);
  ctx.lineTo(cx + arm, cy + arm);
  // Lower bar
  ctx.lineTo(cx + arm, cy + s * 0.65);
  ctx.lineTo(cx - arm, cy + s * 0.65);
  ctx.lineTo(cx - arm, cy + arm);
  // Left arm
  ctx.lineTo(cx - s * 0.5, cy + arm);
  ctx.lineTo(cx - s * 0.5, cy - arm);
  ctx.lineTo(cx - arm, cy - arm);
  ctx.closePath();
  ctx.globalAlpha = 0.5;
  ctx.fill();
  ctx.globalAlpha = 1.0;
  ctx.stroke();

  ctx.restore();
}

function drawStar(ctx, cx, cy, size, color) {
  const s = size * 0.8;
  const points = 6;
  const outerR = s * 0.65;
  const innerR = s * 0.3;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, size * 0.04);

  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const angle = (Math.PI * 2 * i) / (points * 2) - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.globalAlpha = 0.5;
  ctx.fill();
  ctx.globalAlpha = 1.0;
  ctx.stroke();

  ctx.restore();
}

function drawChain(ctx, cx, cy, size, color) {
  const s = size * 0.8;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, size * 0.05);
  ctx.lineCap = 'round';

  // Three chain links
  const linkH = s * 0.32;
  const linkW = s * 0.18;
  const gap = linkH * 0.7;

  for (let i = -1; i <= 1; i++) {
    const ly = cy + i * gap;
    const rot = i % 2 === 0 ? 0 : Math.PI * 0.15;
    ctx.save();
    ctx.translate(cx, ly);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.ellipse(0, 0, linkW, linkH * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

function drawArrow(ctx, cx, cy, size, color) {
  const s = size * 0.9;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, size * 0.05);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Arrow pointing right-upward
  ctx.beginPath();
  ctx.moveTo(cx + s * 0.55, cy - s * 0.55);
  ctx.lineTo(cx + s * 0.15, cy - s * 0.55);
  ctx.moveTo(cx + s * 0.55, cy - s * 0.55);
  ctx.lineTo(cx + s * 0.55, cy - s * 0.15);
  ctx.stroke();

  // Shaft
  ctx.beginPath();
  ctx.moveTo(cx + s * 0.55, cy - s * 0.55);
  ctx.lineTo(cx - s * 0.45, cy + s * 0.45);
  ctx.stroke();

  // Fletching
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.45, cy + s * 0.45);
  ctx.lineTo(cx - s * 0.55, cy + s * 0.25);
  ctx.moveTo(cx - s * 0.45, cy + s * 0.45);
  ctx.lineTo(cx - s * 0.25, cy + s * 0.55);
  ctx.stroke();

  ctx.restore();
}

function drawEye(ctx, cx, cy, size, color) {
  const s = size * 0.85;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.5, size * 0.05);

  // Outer eye shape
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.55, cy);
  ctx.quadraticCurveTo(cx, cy - s * 0.45, cx + s * 0.55, cy);
  ctx.quadraticCurveTo(cx, cy + s * 0.45, cx - s * 0.55, cy);
  ctx.closePath();
  ctx.globalAlpha = 0.2;
  ctx.fill();
  ctx.globalAlpha = 1.0;
  ctx.stroke();

  // Iris
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.18, 0, Math.PI * 2);
  ctx.globalAlpha = 0.6;
  ctx.fill();
  ctx.globalAlpha = 1.0;
  ctx.stroke();

  // Pupil
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.08, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawSpiral(ctx, cx, cy, size, color) {
  const s = size * 0.8;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, size * 0.05);
  ctx.lineCap = 'round';

  ctx.beginPath();
  const turns = 2.5;
  const steps = 80;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = t * Math.PI * 2 * turns;
    const r = t * s * 0.6;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  ctx.restore();
}

function drawFist(ctx, cx, cy, size, color) {
  const s = size * 0.85;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, size * 0.04);
  ctx.lineJoin = 'round';

  // Main fist body
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.3, cy - s * 0.35);
  ctx.quadraticCurveTo(cx - s * 0.35, cy - s * 0.55, cx, cy - s * 0.55);
  ctx.quadraticCurveTo(cx + s * 0.35, cy - s * 0.55, cx + s * 0.35, cy - s * 0.2);
  ctx.lineTo(cx + s * 0.35, cy + s * 0.1);
  ctx.quadraticCurveTo(cx + s * 0.35, cy + s * 0.25, cx + s * 0.2, cy + s * 0.25);
  ctx.lineTo(cx - s * 0.2, cy + s * 0.25);
  ctx.quadraticCurveTo(cx - s * 0.35, cy + s * 0.25, cx - s * 0.35, cy + s * 0.1);
  ctx.closePath();
  ctx.globalAlpha = 0.4;
  ctx.fill();
  ctx.globalAlpha = 1.0;
  ctx.stroke();

  // Finger lines
  for (let i = 0; i < 3; i++) {
    const fx = cx - s * 0.12 + i * s * 0.14;
    ctx.beginPath();
    ctx.moveTo(fx, cy - s * 0.55);
    ctx.lineTo(fx, cy - s * 0.35);
    ctx.stroke();
  }

  // Thumb
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.3, cy - s * 0.1);
  ctx.quadraticCurveTo(cx - s * 0.45, cy + s * 0.15, cx - s * 0.25, cy + s * 0.45);
  ctx.lineTo(cx - s * 0.15, cy + s * 0.4);
  ctx.quadraticCurveTo(cx - s * 0.3, cy + s * 0.1, cx - s * 0.2, cy);
  ctx.stroke();

  ctx.restore();
}

function drawWave(ctx, cx, cy, size, color) {
  const s = size * 0.85;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, size * 0.05);
  ctx.lineCap = 'round';

  // Three horizontal wave crescents
  for (let i = -1; i <= 1; i++) {
    const oy = cy + i * s * 0.28;
    const alpha = 1.0 - Math.abs(i) * 0.25;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.55, oy);
    ctx.quadraticCurveTo(cx - s * 0.25, oy - s * 0.2, cx, oy);
    ctx.quadraticCurveTo(cx + s * 0.25, oy + s * 0.2, cx + s * 0.55, oy);
    ctx.stroke();
  }

  ctx.globalAlpha = 1.0;
  ctx.restore();
}

function drawCircle(ctx, cx, cy, size, color) {
  const s = size * 0.8;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, size * 0.05);

  // Outer ring
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.55, 0, Math.PI * 2);
  ctx.stroke();

  // Inner ring
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.3, 0, Math.PI * 2);
  ctx.stroke();

  // Cross-hatch runes inside
  const runeCount = 8;
  for (let i = 0; i < runeCount; i++) {
    const angle = (Math.PI * 2 * i) / runeCount;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * s * 0.3, cy + Math.sin(angle) * s * 0.3);
    ctx.lineTo(cx + Math.cos(angle) * s * 0.55, cy + Math.sin(angle) * s * 0.55);
    ctx.stroke();
  }

  // Center dot
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.06, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawHorn(ctx, cx, cy, size, color) {
  const s = size * 0.85;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.5, size * 0.05);
  ctx.lineCap = 'round';

  // Curved horn shape
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.1, cy + s * 0.5);
  ctx.quadraticCurveTo(cx - s * 0.45, cy, cx - s * 0.15, cy - s * 0.55);
  ctx.quadraticCurveTo(cx + s * 0.15, cy - s * 0.75, cx + s * 0.35, cy - s * 0.55);
  ctx.stroke();

  // Horn base (wider)
  ctx.beginPath();
  ctx.ellipse(cx - s * 0.05, cy + s * 0.5, s * 0.15, s * 0.08, 0, 0, Math.PI * 2);
  ctx.globalAlpha = 0.4;
  ctx.fill();
  ctx.globalAlpha = 1.0;
  ctx.stroke();

  // Ridges on the horn
  for (let i = 1; i <= 3; i++) {
    const t = i * 0.22;
    const rx = cx - s * 0.1 + (cx - s * 0.15 - (cx - s * 0.1)) * t * 2;
    const ry = cy + s * 0.5 + (cy - s * 0.55 - (cy + s * 0.5)) * t;
    ctx.beginPath();
    ctx.arc(rx, ry, s * 0.04, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

function drawBook(ctx, cx, cy, size, color) {
  const s = size * 0.8;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1, size * 0.04);
  ctx.lineJoin = 'round';

  // Left page
  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 0.5);
  ctx.lineTo(cx - s * 0.45, cy - s * 0.4);
  ctx.lineTo(cx - s * 0.45, cy + s * 0.4);
  ctx.lineTo(cx, cy + s * 0.5);
  ctx.closePath();
  ctx.globalAlpha = 0.2;
  ctx.fill();
  ctx.globalAlpha = 1.0;
  ctx.stroke();

  // Right page
  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 0.5);
  ctx.lineTo(cx + s * 0.45, cy - s * 0.4);
  ctx.lineTo(cx + s * 0.45, cy + s * 0.4);
  ctx.lineTo(cx, cy + s * 0.5);
  ctx.closePath();
  ctx.globalAlpha = 0.2;
  ctx.fill();
  ctx.globalAlpha = 1.0;
  ctx.stroke();

  // Spine
  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 0.5);
  ctx.lineTo(cx, cy + s * 0.5);
  ctx.stroke();

  // Text lines on left page
  for (let i = 0; i < 3; i++) {
    const ly = cy - s * 0.15 + i * s * 0.18;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.35, ly);
    ctx.lineTo(cx - s * 0.08, ly);
    ctx.stroke();
  }

  ctx.restore();
}

function drawFeather(ctx, cx, cy, size, color) {
  const s = size * 0.9;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1, size * 0.04);
  ctx.lineCap = 'round';

  // Quill shaft
  ctx.beginPath();
  ctx.moveTo(cx + s * 0.15, cy + s * 0.7);
  ctx.quadraticCurveTo(cx, cy, cx - s * 0.1, cy - s * 0.7);
  ctx.stroke();

  // Left vane
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.1, cy - s * 0.7);
  ctx.quadraticCurveTo(cx - s * 0.4, cy - s * 0.25, cx - s * 0.05, cy + s * 0.2);
  ctx.quadraticCurveTo(cx + s * 0.02, cy - s * 0.1, cx - s * 0.1, cy - s * 0.7);
  ctx.closePath();
  ctx.globalAlpha = 0.3;
  ctx.fill();
  ctx.globalAlpha = 1.0;
  ctx.stroke();

  // Right vane
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.1, cy - s * 0.7);
  ctx.quadraticCurveTo(cx + s * 0.25, cy - s * 0.35, cx + s * 0.1, cy + s * 0.15);
  ctx.quadraticCurveTo(cx - s * 0.02, cy - s * 0.15, cx - s * 0.1, cy - s * 0.7);
  ctx.closePath();
  ctx.globalAlpha = 0.3;
  ctx.fill();
  ctx.globalAlpha = 1.0;
  ctx.stroke();

  ctx.restore();
}

function drawDrop(ctx, cx, cy, size, color) {
  const s = size * 0.85;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, size * 0.05);

  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 0.65);
  ctx.quadraticCurveTo(cx + s * 0.5, cy + s * 0.05, cx + s * 0.35, cy + s * 0.35);
  ctx.quadraticCurveTo(cx + s * 0.2, cy + s * 0.65, cx, cy + s * 0.6);
  ctx.quadraticCurveTo(cx - s * 0.2, cy + s * 0.65, cx - s * 0.35, cy + s * 0.35);
  ctx.quadraticCurveTo(cx - s * 0.5, cy + s * 0.05, cx, cy - s * 0.65);
  ctx.closePath();
  ctx.globalAlpha = 0.4;
  ctx.fill();
  ctx.globalAlpha = 1.0;
  ctx.stroke();

  // Highlight
  ctx.beginPath();
  ctx.ellipse(cx - s * 0.1, cy + s * 0.05, s * 0.06, s * 0.12, -0.3, 0, Math.PI * 2);
  ctx.globalAlpha = 0.6;
  ctx.fill();
  ctx.globalAlpha = 1.0;

  ctx.restore();
}

function drawCrown(ctx, cx, cy, size, color) {
  const s = size * 0.85;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, size * 0.05);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Crown base band
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.45, cy + s * 0.25);
  ctx.lineTo(cx + s * 0.45, cy + s * 0.25);
  ctx.lineTo(cx + s * 0.45, cy + s * 0.1);
  ctx.lineTo(cx - s * 0.45, cy + s * 0.1);
  ctx.closePath();
  ctx.globalAlpha = 0.4;
  ctx.fill();
  ctx.globalAlpha = 1.0;
  ctx.stroke();

  // Crown points
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.45, cy + s * 0.1);
  ctx.lineTo(cx - s * 0.4, cy - s * 0.35);
  ctx.lineTo(cx - s * 0.2, cy - s * 0.05);
  ctx.lineTo(cx, cy - s * 0.45);
  ctx.lineTo(cx + s * 0.2, cy - s * 0.05);
  ctx.lineTo(cx + s * 0.4, cy - s * 0.35);
  ctx.lineTo(cx + s * 0.45, cy + s * 0.1);
  ctx.closePath();
  ctx.globalAlpha = 0.3;
  ctx.fill();
  ctx.globalAlpha = 1.0;
  ctx.stroke();

  // Jewels on tips
  const tips = [
    { x: cx - s * 0.4, y: cy - s * 0.35 },
    { x: cx, y: cy - s * 0.45 },
    { x: cx + s * 0.4, y: cy - s * 0.35 }
  ];
  for (const t of tips) {
    ctx.beginPath();
    ctx.arc(t.x, t.y, s * 0.05, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Ability-to-symbol mapping
// ---------------------------------------------------------------------------

const ABILITY_ICONS = {
  // ---- Tyrant (PHYSICAL) ----
  ravaging_cleave:   { draw: drawSword,       school: 'physical' },
  bloodrage_strike:  { draw: drawSword,       school: 'physical' },
  brutal_slam:       { draw: drawFist,        school: 'physical' },
  iron_cyclone:      { draw: drawSpiral,      school: 'physical' },
  shatter_guard:     { draw: drawShield,      school: 'physical' },
  warbringer_rush:   { draw: drawArrow,       school: 'physical' },
  crippling_strike:  { draw: drawChain,       school: 'physical' },
  thunder_spike:     { draw: drawLightning,   school: 'physical' },
  iron_resolve:      { draw: drawShield,      school: 'physical' },
  warborn_rally:     { draw: drawCross,       school: 'physical' },
  skull_crack:       { draw: drawSkull,       school: 'physical' },
  crushing_descent:  { draw: drawArrow,       school: 'physical' },

  // ---- Wraith (PHYSICAL) ----
  viper_lash:        { draw: drawDualDaggers, school: 'physical' },
  throat_opener:     { draw: drawDualDaggers, school: 'physical' },
  grim_flurry:       { draw: drawStar,        school: 'physical' },
  nerve_strike:      { draw: drawStar,        school: 'physical' },
  serrated_wound:    { draw: drawDrop,        school: 'physical' },
  blackjack:         { draw: drawSkull,       school: 'physical' },
  veil_of_night:     { draw: drawEye,         school: 'physical' },
  shade_shift:       { draw: drawArrow,       school: 'physical' },
  phantasm_dodge:    { draw: drawFeather,     school: 'physical' },
  umbral_shroud:     { draw: drawEye,         school: 'physical' },
  blood_tincture:    { draw: drawDrop,        school: 'physical' },
  throat_jab:        { draw: drawFist,        school: 'physical' },
  frenzy_edge:       { draw: drawDualDaggers, school: 'physical' },
  shadowmeld:        { draw: drawEye,         school: 'shadow'   },

  // ---- Infernal (FIRE / FROST / ARCANE) ----
  inferno_bolt:      { draw: drawFlame,       school: 'fire'     },
  cataclysm_flare:   { draw: drawFlame,       school: 'fire'     },
  searing_pulse:     { draw: drawStar,        school: 'fire'     },
  glacial_lance:     { draw: drawLightning,   school: 'frost'    },
  permafrost_burst:  { draw: drawStar,        school: 'frost'    },
  phase_shift:       { draw: drawSpiral,      school: 'arcane'   },
  pyroclasm:         { draw: drawFlame,       school: 'fire'     },
  crystalline_ward:  { draw: drawShield,      school: 'frost'    },
  arcane_bulwark:    { draw: drawCircle,      school: 'arcane'   },
  spell_fracture:    { draw: drawLightning,   school: 'arcane'   },
  scaldwind:         { draw: drawWave,        school: 'fire'     },
  ember_brand:       { draw: drawFlame,       school: 'fire'     },

  // ---- Harbinger (SHADOW) ----
  hex_blight:        { draw: drawEye,         school: 'shadow'   },
  creeping_torment:  { draw: drawSpiral,      school: 'shadow'   },
  volatile_hex:      { draw: drawSkull,       school: 'shadow'   },
  siphon_essence:    { draw: drawSpiral,      school: 'shadow'   },
  hex_rupture:       { draw: drawStar,        school: 'shadow'   },
  dread_howl:        { draw: drawWave,        school: 'shadow'   },
  wraith_bolt:       { draw: drawSkull,       school: 'shadow'   },
  nether_slam:       { draw: drawFist,        school: 'shadow'   },
  blood_tithe:       { draw: drawDrop,        school: 'shadow'   },
  warded_flesh:      { draw: drawShield,      school: 'shadow'   },
  rift_anchor:       { draw: drawCircle,      school: 'shadow'   },
  hex_silence:       { draw: drawChain,       school: 'shadow'   },
  soul_ignite:       { draw: drawFlame,       school: 'shadow'   },

  // ---- Revenant (PHYSICAL / HOLY) ----
  hallowed_strike:   { draw: drawSword,       school: 'physical' },
  divine_reckoning:  { draw: drawLightning,   school: 'holy'     },
  radiant_verdict:   { draw: drawStar,        school: 'holy'     },
  sanctified_gale:   { draw: drawWave,        school: 'holy'     },
  ember_wake:        { draw: drawFlame,       school: 'holy'     },
  gavel_of_light:    { draw: drawFist,        school: 'holy'     },
  binding_prayer:    { draw: drawChain,       school: 'holy'     },
  aegis_of_dawn:     { draw: drawShield,      school: 'holy'     },
  sovereign_mend:    { draw: drawCross,       school: 'holy'     },
  holy_restoration:  { draw: drawCross,       school: 'holy'     },
  unchained_grace:   { draw: drawFeather,     school: 'holy'     },
  sanctified_rebuff: { draw: drawFist,        school: 'physical' },
  valiant_charge:    { draw: drawArrow,       school: 'holy'     }
};

// ---------------------------------------------------------------------------
// Ability icon generation
// ---------------------------------------------------------------------------

/**
 * Returns a data URL string for a procedurally generated ability icon.
 * @param {string} abilityId  - Ability identifier (e.g. 'ravaging_cleave')
 * @param {string} school     - Spell school key (e.g. 'physical', 'fire')
 * @param {number} [size=64]  - Width and height of the icon in pixels
 * @returns {string} data URL (image/png)
 */
export function getAbilityIcon(abilityId, school, size = 64) {
  const key = `ability:${abilityId}:${school}:${size}`;
  return getCached(key, () => _generateAbilityIcon(abilityId, school, size));
}

function _generateAbilityIcon(abilityId, school, size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const pad = 2;
  const r = size * 0.12; // corner radius

  // Resolve school palette
  const schoolKey = school || 'physical';
  const palette = SCHOOL_COLORS[schoolKey] || SCHOOL_COLORS.physical;

  // --- Background: rounded rect with radial gradient ---
  const grad = ctx.createRadialGradient(
    size * 0.35, size * 0.35, size * 0.05,
    size * 0.5, size * 0.5, size * 0.75
  );
  grad.addColorStop(0, palette.bgOuter);
  grad.addColorStop(1, palette.bgInner);

  ctx.save();
  roundedRect(ctx, pad, pad, size - pad * 2, size - pad * 2, r);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();

  // --- Inner shadow / vignette ---
  ctx.save();
  roundedRect(ctx, pad, pad, size - pad * 2, size - pad * 2, r);
  ctx.clip();
  const vignetteGrad = ctx.createRadialGradient(
    size * 0.5, size * 0.5, size * 0.15,
    size * 0.5, size * 0.5, size * 0.65
  );
  vignetteGrad.addColorStop(0, 'rgba(0,0,0,0)');
  vignetteGrad.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = vignetteGrad;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  // --- Symbol ---
  const mapping = ABILITY_ICONS[abilityId];
  const drawSymbol = mapping ? mapping.draw : null;
  const cx = size / 2;
  const cy = size / 2;
  const symbolSize = size * 0.38;

  ctx.save();
  roundedRect(ctx, pad, pad, size - pad * 2, size - pad * 2, r);
  ctx.clip();

  // Glow behind symbol
  ctx.shadowColor = palette.glow;
  ctx.shadowBlur = size * 0.2;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  if (drawSymbol) {
    drawSymbol(ctx, cx, cy, symbolSize, palette.symbol);
  } else {
    // Fallback: draw first letter of ability name
    _drawFallbackLetter(ctx, cx, cy, symbolSize, palette.symbol, abilityId);
  }

  ctx.restore();

  // --- Border ---
  ctx.save();
  roundedRect(ctx, pad, pad, size - pad * 2, size - pad * 2, r);
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = Math.max(2, size * 0.03);
  ctx.stroke();
  ctx.restore();

  // --- Subtle highlight at top ---
  ctx.save();
  roundedRect(ctx, pad, pad, size - pad * 2, size - pad * 2, r);
  ctx.clip();
  const highlightGrad = ctx.createLinearGradient(0, pad, 0, size * 0.35);
  highlightGrad.addColorStop(0, 'rgba(255,255,255,0.12)');
  highlightGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = highlightGrad;
  ctx.fillRect(pad, pad, size - pad * 2, size * 0.35);
  ctx.restore();

  return canvas.toDataURL();
}

function _drawFallbackLetter(ctx, cx, cy, symbolSize, color, abilityId) {
  const name = abilityId.replace(/_/g, ' ');
  const letter = name.charAt(0).toUpperCase();
  ctx.fillStyle = color;
  ctx.font = `bold ${Math.round(symbolSize * 1.4)}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, cx, cy + symbolSize * 0.05);
}

// ---------------------------------------------------------------------------
// Class emblem generation
// ---------------------------------------------------------------------------

/**
 * Returns a data URL string for a procedurally generated class emblem.
 * @param {string} classId    - Class identifier ('tyrant', 'wraith', etc.)
 * @param {number} [size=128] - Width and height in pixels
 * @returns {string} data URL (image/png)
 */
export function getClassEmblem(classId, size = 128) {
  const key = `emblem:${classId}:${size}`;
  return getCached(key, () => _generateClassEmblem(classId, size));
}

function _generateClassEmblem(classId, size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const palette = CLASS_COLORS[classId] || CLASS_COLORS.tyrant;
  const cx = size / 2;
  const cy = size / 2;
  const s = size * 0.4;

  // Dark background
  ctx.fillStyle = '#1a1a2a';
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.48, 0, Math.PI * 2);
  ctx.fill();

  // Outer ring
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = Math.max(2, size * 0.02);
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.46, 0, Math.PI * 2);
  ctx.stroke();

  // Inner ring
  ctx.globalAlpha = 0.4;
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = Math.max(1, size * 0.01);
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.38, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1.0;

  // Class-specific emblem drawing
  ctx.save();
  ctx.shadowColor = palette.glow;
  ctx.shadowBlur = size * 0.08;

  switch (classId) {
    case 'tyrant':
      _drawTyrantEmblem(ctx, cx, cy, s, palette);
      break;
    case 'wraith':
      _drawWraithEmblem(ctx, cx, cy, s, palette);
      break;
    case 'infernal':
      _drawInfernalEmblem(ctx, cx, cy, s, palette);
      break;
    case 'harbinger':
      _drawHarbingerEmblem(ctx, cx, cy, s, palette);
      break;
    case 'revenant':
      _drawRevenantEmblem(ctx, cx, cy, s, palette);
      break;
    default:
      _drawFallbackEmblem(ctx, cx, cy, s, palette, classId);
      break;
  }

  ctx.restore();

  return canvas.toDataURL();
}

// --- Tyrant: Horned helmet with crossed swords ---

function _drawTyrantEmblem(ctx, cx, cy, s, palette) {
  const color = palette.accent;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, s * 0.05);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Crossed swords behind helmet
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(side * 0.5);

    // Blade
    ctx.beginPath();
    ctx.moveTo(0, -s * 1.0);
    ctx.lineTo(s * 0.04, -s * 0.9);
    ctx.lineTo(s * 0.03, s * 0.3);
    ctx.lineTo(0, s * 0.4);
    ctx.lineTo(-s * 0.03, s * 0.3);
    ctx.lineTo(-s * 0.04, -s * 0.9);
    ctx.closePath();
    ctx.globalAlpha = 0.3;
    ctx.fill();
    ctx.globalAlpha = 0.7;
    ctx.stroke();
    ctx.globalAlpha = 1.0;

    ctx.restore();
  }

  // Helmet body
  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 0.55);
  ctx.quadraticCurveTo(cx + s * 0.4, cy - s * 0.5, cx + s * 0.38, cy - s * 0.1);
  ctx.lineTo(cx + s * 0.32, cy + s * 0.15);
  ctx.lineTo(cx + s * 0.25, cy + s * 0.3);
  ctx.lineTo(cx - s * 0.25, cy + s * 0.3);
  ctx.lineTo(cx - s * 0.32, cy + s * 0.15);
  ctx.lineTo(cx - s * 0.38, cy - s * 0.1);
  ctx.quadraticCurveTo(cx - s * 0.4, cy - s * 0.5, cx, cy - s * 0.55);
  ctx.closePath();
  ctx.globalAlpha = 0.35;
  ctx.fill();
  ctx.globalAlpha = 1.0;
  ctx.stroke();

  // Eye slit
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.22, cy - s * 0.05);
  ctx.lineTo(cx + s * 0.22, cy - s * 0.05);
  ctx.stroke();

  // Horns
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + side * s * 0.3, cy - s * 0.35);
    ctx.quadraticCurveTo(
      cx + side * s * 0.7, cy - s * 0.75,
      cx + side * s * 0.5, cy - s * 0.9
    );
    ctx.lineWidth = Math.max(3, s * 0.08);
    ctx.stroke();
    ctx.lineWidth = Math.max(2, s * 0.05);
  }
}

// --- Wraith: Hooded figure with glowing eyes and daggers ---

function _drawWraithEmblem(ctx, cx, cy, s, palette) {
  const color = palette.accent;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, s * 0.05);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Hood outline
  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 0.75);
  ctx.quadraticCurveTo(cx - s * 0.65, cy - s * 0.55, cx - s * 0.5, cy + s * 0.1);
  ctx.lineTo(cx - s * 0.35, cy + s * 0.3);
  ctx.lineTo(cx + s * 0.35, cy + s * 0.3);
  ctx.lineTo(cx + s * 0.5, cy + s * 0.1);
  ctx.quadraticCurveTo(cx + s * 0.65, cy - s * 0.55, cx, cy - s * 0.75);
  ctx.closePath();
  ctx.globalAlpha = 0.25;
  ctx.fill();
  ctx.globalAlpha = 1.0;
  ctx.stroke();

  // Glowing eyes
  ctx.shadowColor = palette.glow;
  ctx.shadowBlur = s * 0.35;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + side * s * 0.15, cy - s * 0.15, s * 0.08, s * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  // Crossed daggers below
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(cx, cy + s * 0.55);
    ctx.rotate(side * 0.5);

    ctx.beginPath();
    ctx.moveTo(0, -s * 0.35);
    ctx.lineTo(s * 0.03, -s * 0.28);
    ctx.lineTo(s * 0.02, s * 0.05);
    ctx.lineTo(0, s * 0.1);
    ctx.lineTo(-s * 0.02, s * 0.05);
    ctx.lineTo(-s * 0.03, -s * 0.28);
    ctx.closePath();
    ctx.globalAlpha = 0.5;
    ctx.fill();
    ctx.globalAlpha = 1.0;
    ctx.stroke();

    // Guard
    ctx.beginPath();
    ctx.moveTo(-s * 0.1, s * 0.05);
    ctx.lineTo(s * 0.1, s * 0.05);
    ctx.stroke();

    ctx.restore();
  }
}

// --- Infernal: Skull wreathed in flames ---

function _drawInfernalEmblem(ctx, cx, cy, s, palette) {
  const color = palette.accent;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, s * 0.05);

  // Flames behind skull
  ctx.save();
  ctx.shadowColor = '#ff4400';
  ctx.shadowBlur = s * 0.3;

  const flamePositions = [
    { ox: 0, h: 1.1, w: 0.3 },
    { ox: -0.3, h: 0.8, w: 0.22 },
    { ox: 0.3, h: 0.75, w: 0.2 },
    { ox: -0.5, h: 0.55, w: 0.18 },
    { ox: 0.5, h: 0.5, w: 0.16 }
  ];

  for (const f of flamePositions) {
    const bx = cx + f.ox * s;
    const by = cy + s * 0.25;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(bx - f.w * s, by - f.h * s * 0.5, bx, by - f.h * s);
    ctx.quadraticCurveTo(bx + f.w * s, by - f.h * s * 0.5, bx, by);
    ctx.closePath();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#ff6622';
    ctx.fill();
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = '#ff8844';
    ctx.stroke();
  }
  ctx.restore();

  // Skull
  ctx.strokeStyle = color;
  ctx.fillStyle = color;

  // Cranium
  ctx.beginPath();
  ctx.ellipse(cx, cy - s * 0.1, s * 0.35, s * 0.38, 0, 0, Math.PI * 2);
  ctx.globalAlpha = 0.3;
  ctx.fill();
  ctx.globalAlpha = 1.0;
  ctx.stroke();

  // Jaw
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.22, cy + s * 0.2);
  ctx.quadraticCurveTo(cx - s * 0.18, cy + s * 0.48, cx, cy + s * 0.44);
  ctx.quadraticCurveTo(cx + s * 0.18, cy + s * 0.48, cx + s * 0.22, cy + s * 0.2);
  ctx.stroke();

  // Eyes (glowing)
  ctx.save();
  ctx.shadowColor = '#ffcc00';
  ctx.shadowBlur = s * 0.25;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + side * s * 0.13, cy - s * 0.15, s * 0.08, s * 0.1, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#ffcc44';
    ctx.fill();
  }
  ctx.restore();

  // Nose
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.02);
  ctx.lineTo(cx - s * 0.04, cy + s * 0.12);
  ctx.lineTo(cx + s * 0.04, cy + s * 0.12);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

// --- Harbinger: Horned skull with arcane circle and book ---

function _drawHarbingerEmblem(ctx, cx, cy, s, palette) {
  const color = palette.accent;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.5, s * 0.04);

  // Arcane circle behind skull
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  ctx.arc(cx, cy - s * 0.15, s * 0.6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.15;
  ctx.beginPath();
  ctx.arc(cx, cy - s * 0.15, s * 0.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1.0;

  // Rune marks on circle
  const runeCount = 6;
  for (let i = 0; i < runeCount; i++) {
    const angle = (Math.PI * 2 * i) / runeCount - Math.PI / 2;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.moveTo(
      cx + Math.cos(angle) * s * 0.5,
      cy - s * 0.15 + Math.sin(angle) * s * 0.5
    );
    ctx.lineTo(
      cx + Math.cos(angle) * s * 0.6,
      cy - s * 0.15 + Math.sin(angle) * s * 0.6
    );
    ctx.stroke();
  }
  ctx.globalAlpha = 1.0;

  // Skull (smaller)
  ctx.lineWidth = Math.max(2, s * 0.05);
  ctx.beginPath();
  ctx.ellipse(cx, cy - s * 0.2, s * 0.28, s * 0.3, 0, 0, Math.PI * 2);
  ctx.globalAlpha = 0.25;
  ctx.fill();
  ctx.globalAlpha = 1.0;
  ctx.stroke();

  // Jaw
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.18, cy + s * 0.02);
  ctx.quadraticCurveTo(cx, cy + s * 0.28, cx + s * 0.18, cy + s * 0.02);
  ctx.stroke();

  // Eyes (green glow)
  ctx.save();
  ctx.shadowColor = palette.glow;
  ctx.shadowBlur = s * 0.2;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + side * s * 0.1, cy - s * 0.25, s * 0.06, s * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Horns
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + side * s * 0.22, cy - s * 0.4);
    ctx.quadraticCurveTo(
      cx + side * s * 0.55, cy - s * 0.65,
      cx + side * s * 0.4, cy - s * 0.8
    );
    ctx.lineWidth = Math.max(2, s * 0.06);
    ctx.stroke();
    ctx.lineWidth = Math.max(2, s * 0.05);
  }

  // Small book below
  const bookY = cy + s * 0.55;
  const bookW = s * 0.25;
  const bookH = s * 0.18;

  // Left page
  ctx.beginPath();
  ctx.moveTo(cx, bookY - bookH);
  ctx.lineTo(cx - bookW, bookY - bookH * 0.8);
  ctx.lineTo(cx - bookW, bookY + bookH * 0.8);
  ctx.lineTo(cx, bookY + bookH);
  ctx.closePath();
  ctx.globalAlpha = 0.3;
  ctx.fill();
  ctx.globalAlpha = 1.0;
  ctx.stroke();

  // Right page
  ctx.beginPath();
  ctx.moveTo(cx, bookY - bookH);
  ctx.lineTo(cx + bookW, bookY - bookH * 0.8);
  ctx.lineTo(cx + bookW, bookY + bookH * 0.8);
  ctx.lineTo(cx, bookY + bookH);
  ctx.closePath();
  ctx.globalAlpha = 0.3;
  ctx.fill();
  ctx.globalAlpha = 1.0;
  ctx.stroke();
}

// --- Revenant: Radiant halo above kite shield with golden cross ---

function _drawRevenantEmblem(ctx, cx, cy, s, palette) {
  const color = palette.accent;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, s * 0.05);

  // Halo (rays of light)
  ctx.save();
  ctx.shadowColor = palette.glow;
  ctx.shadowBlur = s * 0.3;
  ctx.globalAlpha = 0.6;

  const rayCount = 12;
  for (let i = 0; i < rayCount; i++) {
    const angle = (Math.PI * 2 * i) / rayCount;
    const innerR = s * 0.2;
    const outerR = s * 0.35;
    ctx.beginPath();
    ctx.moveTo(
      cx + Math.cos(angle) * innerR,
      cy - s * 0.55 + Math.sin(angle) * innerR
    );
    ctx.lineTo(
      cx + Math.cos(angle) * outerR,
      cy - s * 0.55 + Math.sin(angle) * outerR
    );
    ctx.lineWidth = Math.max(1, s * 0.02);
    ctx.stroke();
  }

  // Halo ring
  ctx.lineWidth = Math.max(2, s * 0.04);
  ctx.beginPath();
  ctx.arc(cx, cy - s * 0.55, s * 0.22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1.0;
  ctx.restore();

  // Kite shield
  ctx.lineWidth = Math.max(2, s * 0.05);
  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 0.3);
  ctx.quadraticCurveTo(cx + s * 0.4, cy - s * 0.25, cx + s * 0.38, cy + s * 0.05);
  ctx.quadraticCurveTo(cx + s * 0.3, cy + s * 0.35, cx, cy + s * 0.55);
  ctx.quadraticCurveTo(cx - s * 0.3, cy + s * 0.35, cx - s * 0.38, cy + s * 0.05);
  ctx.quadraticCurveTo(cx - s * 0.4, cy - s * 0.25, cx, cy - s * 0.3);
  ctx.closePath();
  ctx.globalAlpha = 0.3;
  ctx.fill();
  ctx.globalAlpha = 1.0;
  ctx.stroke();

  // Golden cross on shield
  ctx.save();
  ctx.shadowColor = palette.glow;
  ctx.shadowBlur = s * 0.15;
  const crossArm = s * 0.08;

  ctx.beginPath();
  // Vertical
  ctx.moveTo(cx - crossArm, cy - s * 0.2);
  ctx.lineTo(cx + crossArm, cy - s * 0.2);
  ctx.lineTo(cx + crossArm, cy - crossArm);
  ctx.lineTo(cx + s * 0.2, cy - crossArm);
  ctx.lineTo(cx + s * 0.2, cy + crossArm);
  ctx.lineTo(cx + crossArm, cy + crossArm);
  ctx.lineTo(cx + crossArm, cy + s * 0.32);
  ctx.lineTo(cx - crossArm, cy + s * 0.32);
  ctx.lineTo(cx - crossArm, cy + crossArm);
  ctx.lineTo(cx - s * 0.2, cy + crossArm);
  ctx.lineTo(cx - s * 0.2, cy - crossArm);
  ctx.lineTo(cx - crossArm, cy - crossArm);
  ctx.closePath();
  ctx.fillStyle = palette.accent;
  ctx.fill();
  ctx.restore();
}

function _drawFallbackEmblem(ctx, cx, cy, s, palette, classId) {
  ctx.fillStyle = palette.accent;
  ctx.font = `bold ${Math.round(s * 1.2)}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(classId.charAt(0).toUpperCase(), cx, cy);
}

// ---------------------------------------------------------------------------
// Class portrait generation
// ---------------------------------------------------------------------------

/**
 * Returns a data URL string for a procedurally generated class portrait.
 * @param {string} classId       - Class identifier ('tyrant', 'wraith', etc.)
 * @param {number} [width=200]   - Width in pixels
 * @param {number} [height=280]  - Height in pixels
 * @returns {string} data URL (image/png)
 */
export function getClassPortrait(classId, width = 200, height = 280) {
  const key = `portrait:${classId}:${width}:${height}`;
  return getCached(key, () => _generateClassPortrait(classId, width, height));
}

function _generateClassPortrait(classId, width, height) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const palette = CLASS_COLORS[classId] || CLASS_COLORS.tyrant;

  // --- Dark background gradient ---
  const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
  bgGrad.addColorStop(0, '#0e0e1a');
  bgGrad.addColorStop(0.5, palette.bg);
  bgGrad.addColorStop(1, '#0a0a14');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // --- Atmospheric particle dots ---
  ctx.save();
  const particleCount = 40;
  for (let i = 0; i < particleCount; i++) {
    // Deterministic pseudo-random based on index and classId hash
    const hash = _simpleHash(classId + i);
    const px = (hash % width);
    const py = ((hash * 7 + 13) % height);
    const pr = 0.5 + (hash % 30) / 20;
    const alpha = 0.1 + (hash % 40) / 100;

    ctx.globalAlpha = alpha;
    ctx.fillStyle = palette.accent;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1.0;
  ctx.restore();

  // --- Accent lines (top and bottom borders) ---
  ctx.save();
  const lineGrad = ctx.createLinearGradient(0, 0, width, 0);
  lineGrad.addColorStop(0, 'rgba(0,0,0,0)');
  lineGrad.addColorStop(0.3, palette.accent);
  lineGrad.addColorStop(0.7, palette.accent);
  lineGrad.addColorStop(1, 'rgba(0,0,0,0)');

  ctx.strokeStyle = lineGrad;
  ctx.lineWidth = 2;

  // Top accent line
  ctx.beginPath();
  ctx.moveTo(0, 6);
  ctx.lineTo(width, 6);
  ctx.stroke();

  // Bottom accent line
  ctx.beginPath();
  ctx.moveTo(0, height - 6);
  ctx.lineTo(width, height - 6);
  ctx.stroke();

  // Side accents
  const sideGrad = ctx.createLinearGradient(0, 0, 0, height);
  sideGrad.addColorStop(0, 'rgba(0,0,0,0)');
  sideGrad.addColorStop(0.2, palette.accent);
  sideGrad.addColorStop(0.8, palette.accent);
  sideGrad.addColorStop(1, 'rgba(0,0,0,0)');

  ctx.strokeStyle = sideGrad;
  ctx.lineWidth = 1.5;

  ctx.beginPath();
  ctx.moveTo(3, 0);
  ctx.lineTo(3, height);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(width - 3, 0);
  ctx.lineTo(width - 3, height);
  ctx.stroke();

  ctx.restore();

  // --- Corner accents ---
  ctx.save();
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';

  const cornerLen = 18;
  const corners = [
    { x: 8, y: 12, dx: 1, dy: 1 },
    { x: width - 8, y: 12, dx: -1, dy: 1 },
    { x: 8, y: height - 12, dx: 1, dy: -1 },
    { x: width - 8, y: height - 12, dx: -1, dy: -1 }
  ];

  for (const c of corners) {
    ctx.beginPath();
    ctx.moveTo(c.x + c.dx * cornerLen, c.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(c.x, c.y + c.dy * cornerLen);
    ctx.stroke();
  }
  ctx.restore();

  // --- Large class emblem centered ---
  const emblemSize = Math.min(width, height) * 0.6;
  const ecx = width / 2;
  const ecy = height * 0.44;
  const es = emblemSize * 0.4;

  // Background glow for emblem
  ctx.save();
  const glowGrad = ctx.createRadialGradient(ecx, ecy, 0, ecx, ecy, emblemSize * 0.5);
  glowGrad.addColorStop(0, palette.glow + '33');
  glowGrad.addColorStop(0.5, palette.glow + '11');
  glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  // Draw the emblem
  ctx.save();
  ctx.shadowColor = palette.glow;
  ctx.shadowBlur = emblemSize * 0.1;

  switch (classId) {
    case 'tyrant':
      _drawTyrantEmblem(ctx, ecx, ecy, es, palette);
      break;
    case 'wraith':
      _drawWraithEmblem(ctx, ecx, ecy, es, palette);
      break;
    case 'infernal':
      _drawInfernalEmblem(ctx, ecx, ecy, es, palette);
      break;
    case 'harbinger':
      _drawHarbingerEmblem(ctx, ecx, ecy, es, palette);
      break;
    case 'revenant':
      _drawRevenantEmblem(ctx, ecx, ecy, es, palette);
      break;
    default:
      _drawFallbackEmblem(ctx, ecx, ecy, es, palette, classId);
      break;
  }

  ctx.restore();

  // --- Class name text at the bottom ---
  ctx.save();
  const className = classId.charAt(0).toUpperCase() + classId.slice(1);
  ctx.shadowColor = palette.glow;
  ctx.shadowBlur = 8;
  ctx.fillStyle = palette.accent;
  ctx.font = `bold ${Math.round(width * 0.1)}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = '3px';
  ctx.fillText(className.toUpperCase(), width / 2, height * 0.82);

  // Decorative line under name
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const textW = ctx.measureText(className.toUpperCase()).width;
  ctx.moveTo(width / 2 - textW * 0.6, height * 0.87);
  ctx.lineTo(width / 2 + textW * 0.6, height * 0.87);
  ctx.stroke();
  ctx.globalAlpha = 1.0;
  ctx.restore();

  // --- Vignette overlay ---
  ctx.save();
  const vignetteGrad = ctx.createRadialGradient(
    width / 2, height / 2, Math.min(width, height) * 0.25,
    width / 2, height / 2, Math.max(width, height) * 0.7
  );
  vignetteGrad.addColorStop(0, 'rgba(0,0,0,0)');
  vignetteGrad.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vignetteGrad;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  return canvas.toDataURL();
}

// Simple hash function for deterministic particle placement
function _simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  return Math.abs(hash);
}
