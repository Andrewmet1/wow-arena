import puppeteer from 'puppeteer';
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const p=await b.newPage(); await p.setViewport({width:1400,height:850,deviceScaleFactor:1});
p.on('pageerror',e=>console.log('  err:',e.message.slice(0,120)));
await p.goto('http://localhost:5173/dungeon-preview.html?seed=4242&roomIndex=3',{waitUntil:'networkidle2',timeout:90000});
await new Promise(r=>setTimeout(r,26000));
// kit on, then pull back to an overview so the whole wing is visible
await p.evaluate(()=>document.getElementById('kit').click());
await new Promise(r=>setTimeout(r,15000));
await p.evaluate(()=>document.getElementById('mOrbit').click());
await new Promise(r=>setTimeout(r,7000));
const lights = await p.evaluate(()=>{let n=0;window.__scene.traverse(o=>{if(o.isPointLight)n++});return n;});
console.log('  point lights in scene:', lights);
console.log('  stats:', await p.evaluate(()=>document.getElementById('rstats').textContent));
console.log('  status:', await p.evaluate(()=>document.getElementById('status').textContent));
await p.screenshot({path:'/tmp/kit-overview.png'});
await b.close();
