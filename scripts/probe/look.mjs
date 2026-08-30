// Measure what the scene actually looks like from the gameplay camera.
//
// Earlier attempts framed the whole wing in overview, where most of the frame
// is empty background — the histogram was dominated by void and did not move
// when lighting changed. The gameplay camera is both the view that matters and
// the one where geometry fills the frame.
import puppeteer from 'puppeteer';
import sharp from 'sharp';

const b = await puppeteer.launch({ headless:'new', args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist'] });
const p = await b.newPage();
await p.setViewport({ width: 1200, height: 760 });
await p.goto('http://localhost:5173/dungeon-preview.html?seed=4242&roomIndex=3', { waitUntil:'networkidle2', timeout:90000 });
await new Promise(r => setTimeout(r, 26000));
await p.evaluate(() => document.getElementById('kit').click());
await new Promise(r => setTimeout(r, 16000));
// Lift the camera a little so tall walls do not fill the lens.
await p.evaluate(() => { if (window.__camera) window.__camera.position.y += 10; });
await new Promise(r => setTimeout(r, 3000));
await p.screenshot({ path: '/tmp/look.png' });
console.log('  lights:', await p.evaluate(() => { let n=0; window.__scene.traverse(o=>{ if(o.isPointLight) n++; }); return n; }));
console.log('  ', await p.evaluate(() => document.getElementById('rstats').textContent));
await b.close();

// Crop away the UI panel (left 300px) and measure only the render.
const meta = await sharp('/tmp/look.png').metadata();
const { data, info } = await sharp('/tmp/look.png')
  .extract({ left: 310, top: 0, width: meta.width - 310, height: meta.height })
  .removeAlpha().raw().toBuffer({ resolveWithObject: true });
const px = info.width * info.height;
const lum = []; let warm = 0, sat = 0;
for (let i = 0; i < data.length; i += 3) {
  const r = data[i], g = data[i+1], bl = data[i+2];
  lum.push(0.2126*r + 0.7152*g + 0.0722*bl);
  if (r > g + 12 && r > bl + 18) warm++;
  const mx = Math.max(r,g,bl), mn = Math.min(r,g,bl);
  if (mx > 30 && (mx-mn)/mx > 0.25) sat++;
}
lum.sort((a,b)=>a-b);
const q = f => lum[Math.floor(f*(lum.length-1))];
const pct = n => (n/px*100).toFixed(0);
console.log(`\n  render region ${info.width}x${info.height}`);
console.log(`  median=${q(0.5).toFixed(1)}  p75=${q(0.75).toFixed(1)}  p95=${q(0.95).toFixed(1)}  max=${q(1).toFixed(0)}`);
console.log(`  shadow(<25)=${pct(lum.filter(v=>v<25).length)}%  mid=${pct(lum.filter(v=>v>=25&&v<110).length)}%  lit(>=110)=${pct(lum.filter(v=>v>=110).length)}%`);
console.log(`  warm-tinted=${(warm/px*100).toFixed(1)}%   saturated=${(sat/px*100).toFixed(1)}%`);
