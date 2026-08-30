import puppeteer from 'puppeteer';
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--enable-webgl']});
const p=await b.newPage(); await p.setViewport({width:1280,height:800});
await p.goto('http://localhost:5173/dungeon-preview.html?seed=4242&roomIndex=3',{waitUntil:'networkidle2',timeout:90000});
await new Promise(r=>setTimeout(r,32000));
console.log('  ', await p.evaluate(()=>document.getElementById('rstats').textContent));
await p.screenshot({path:'/tmp/gamecam.png'});
await b.close();
