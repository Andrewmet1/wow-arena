import puppeteer from 'puppeteer';
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const p=await b.newPage(); await p.setViewport({width:1400,height:880});
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:5173/content-studio.html',{waitUntil:'networkidle2',timeout:60000});
await new Promise(r=>setTimeout(r,6000));
console.log('  header pills:', await p.evaluate(()=>document.getElementById('pills').innerText.replace(/\n/g,' | ')));
console.log('  tabs:', await p.evaluate(()=>[...document.querySelectorAll('.tab')].map(t=>t.textContent).join(', ')));
await p.screenshot({path:'/tmp/shell-chars.png'});
// switch to dungeon tab
await p.evaluate(()=>[...document.querySelectorAll('.tab')].find(t=>t.textContent==='Dungeon').click());
await new Promise(r=>setTimeout(r,7000));
console.log('  frames loaded:', await p.evaluate(()=>document.querySelectorAll('iframe').length));
await p.screenshot({path:'/tmp/shell-dungeon.png'});
console.log('  errors:', errs.length); errs.slice(0,4).forEach(e=>console.log('    '+e.slice(0,130)));
await b.close();
