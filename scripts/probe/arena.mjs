import puppeteer from 'puppeteer';
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const p=await b.newPage(); await p.setViewport({width:1200,height:760});
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{if(m.type()==='error'&&!/favicon|MultiplyBlending/.test(m.text()))errs.push(m.text());});
await p.goto('http://localhost:5173/arena-preview.html',{waitUntil:'networkidle2',timeout:90000});
await new Promise(r=>setTimeout(r,18000));
console.log('  hud:', (await p.evaluate(()=>document.getElementById('hud').innerText)).replace(/\n/g,' | '));
console.log('  buttons:', await p.evaluate(()=>document.querySelectorAll('#list button').length));
const meshes = await p.evaluate(()=>{let n=0;window.__s?.traverse?.(o=>{if(o.isMesh)n++});return n;});
console.log('  errors:', errs.length); errs.slice(0,3).forEach(e=>console.log('    '+e.slice(0,140)));
await p.screenshot({path:'/tmp/arena1.png'});
// switch to a different layout
await p.evaluate(()=>document.querySelectorAll('#list button')[2].click());
await new Promise(r=>setTimeout(r,6000));
console.log('  after switch:', (await p.evaluate(()=>document.getElementById('hud').innerText)).split('\n')[0]);
await p.screenshot({path:'/tmp/arena2.png'});
await b.close();
