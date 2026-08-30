import puppeteer from 'puppeteer';
const b = await puppeteer.launch({headless:'new',args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const p = await b.newPage();
await p.setViewport({width:1400,height:860});
const errs=[];
p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
await p.goto('http://localhost:5173/dungeon-studio.html',{waitUntil:'networkidle2',timeout:60000});
await new Promise(r=>setTimeout(r,4000));
// click the first prop so the 3D pane has something in it
await p.evaluate(()=>document.querySelector('#list .row')?.click());
await new Promise(r=>setTimeout(r,6000));
const info = await p.evaluate(()=>({
  counts: document.getElementById('counts').textContent,
  stats: document.getElementById('stats').textContent,
  wing: document.getElementById('winginfo').innerText,
  rows: document.querySelectorAll('#list .row').length,
  boxes: document.querySelectorAll('#placements input').length,
}));
console.log('  counts :', info.counts);
console.log('  rows   :', info.rows);
console.log('  stats  :', info.stats);
console.log('  boxes  :', info.boxes);
console.log('  wing   :', info.wing.replace(/\n/g,' | '));
console.log('  errors :', errs.length); errs.slice(0,5).forEach(e=>console.log('    '+e.slice(0,140)));
await p.screenshot({path:'/tmp/studio.png'});
await b.close();
