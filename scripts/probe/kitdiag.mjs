import puppeteer from 'puppeteer';
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--enable-webgl']});
const p=await b.newPage(); await p.setViewport({width:1000,height:700});
p.on('pageerror',e=>console.log('  pageerror:',e.message.slice(0,160)));
await p.goto('http://localhost:5173/dungeon-preview.html?seed=4242&roomIndex=3',{waitUntil:'networkidle2',timeout:90000});
await new Promise(r=>setTimeout(r,26000));
await p.evaluate(()=>document.getElementById('kit').click());
await new Promise(r=>setTimeout(r,14000));
const d = await p.evaluate(() => {
  const scene = window.__scene;
  if (!scene) return { err: 'no window.__scene' };
  let insts = [], total = 0;
  scene.traverse(o => {
    if (o.isInstancedMesh) {
      total += o.count;
      if (insts.length < 5) {
        const m = new (window.__THREE.Matrix4)();
        o.getMatrixAt(0, m);
        const pos = new (window.__THREE.Vector3)().setFromMatrixPosition(m);
        insts.push({ piece: o.userData.kitPiece, count: o.count, visible: o.visible,
          culled: o.frustumCulled, radius: o.boundingSphere?.radius ?? null,
          first: [pos.x.toFixed(1), pos.y.toFixed(1), pos.z.toFixed(1)],
          tris: o.geometry?.index ? o.geometry.index.count/3 : (o.geometry?.attributes?.position?.count/3 || 0) });
      }
    }
  });
  const cam = window.__camera;
  return { instancedMeshes: scene.children.filter(c=>c.isInstancedMesh).length, totalInstances: total,
           samples: insts, cam: cam ? [cam.position.x.toFixed(0),cam.position.y.toFixed(0),cam.position.z.toFixed(0)] : null };
});
console.log(JSON.stringify(d, null, 2).slice(0, 1600));
await b.close();
