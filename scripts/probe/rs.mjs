import puppeteer from 'puppeteer';
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']});
const p=await b.newPage();
await p.goto('http://localhost:5173/dungeon-preview.html?seed=4242&roomIndex=3',{waitUntil:'networkidle2',timeout:90000});
await new Promise(r=>setTimeout(r,40000));
console.log('  scene cost:', await p.evaluate(()=>document.getElementById('rstats').textContent));
await p.screenshot({path:'/tmp/opt.png'});
await b.close();
