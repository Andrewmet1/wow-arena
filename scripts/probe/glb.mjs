import puppeteer from 'puppeteer';
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']});
const p=await b.newPage();
p.on('pageerror',e=>console.log('  pageerror:',e.message.slice(0,140)));
await p.goto('http://localhost:5173/__glbtest.html',{waitUntil:'networkidle2',timeout:60000});
await new Promise(r=>setTimeout(r,6000));
for(const l of await p.evaluate(()=>window.__t||['no output'])) console.log('  '+l);
await b.close();
