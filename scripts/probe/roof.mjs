import puppeteer from 'puppeteer';
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--enable-webgl']});
const p=await b.newPage(); await p.setViewport({width:1100,height:700});
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:5173/dungeon-preview.html?seed=4242&roomIndex=3',{waitUntil:'networkidle2',timeout:90000});
await new Promise(r=>setTimeout(r,30000));
// drop to eye level inside the chamber
await p.evaluate(()=>{ document.getElementById('roof').click(); });
await new Promise(r=>setTimeout(r,14000));
console.log('  roof:', await p.evaluate(()=>document.getElementById('roof').textContent));
console.log('  stats:', await p.evaluate(()=>document.getElementById('rstats').textContent));
console.log('  errors:', errs.length); errs.slice(0,3).forEach(e=>console.log('   ',e.slice(0,120)));
await p.screenshot({path:'/tmp/roof.png'});
await b.close();
