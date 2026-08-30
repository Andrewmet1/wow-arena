// Find the active window of each clip: where real motion happens, versus
// dead time at head and tail that a mocap/generated clip carries.
import fs from 'fs'; import path from 'path';
const RIGS = path.resolve('public/assets/animations/rigs/tyrant_frost_dragon');

function readClip(file){
  const buf=fs.readFileSync(file);
  const dv=new DataView(buf.buffer,buf.byteOffset,buf.byteLength);
  const jl=dv.getUint32(12,true);
  const js=JSON.parse(new TextDecoder().decode(buf.slice(20,20+jl)));
  const binOff=20+jl+8;
  const acc=(i)=>{
    const a=js.accessors[i], bv=js.bufferViews[a.bufferView];
    const start=binOff+(bv.byteOffset||0)+(a.byteOffset||0);
    const comp={5126:4}[a.componentType]; if(!comp) return null;
    const n={SCALAR:1,VEC3:3,VEC4:4}[a.type];
    const out=[];
    for(let i=0;i<a.count;i++){const row=[];for(let c=0;c<n;c++)row.push(dv.getFloat32(start+(i*n+c)*4,true));out.push(n===1?row[0]:row);}
    return out;
  };
  const anim=js.animations?.[0]; if(!anim) return null;
  // Sample rotation channels; motion = angular change between keyframes.
  let times=null; const series=[];
  for(const ch of anim.channels){
    if(ch.target.path!=='rotation') continue;
    const smp=anim.samplers[ch.sampler];
    const t=acc(smp.input), v=acc(smp.output);
    if(!t||!v) continue;
    if(!times) times=t;
    if(t.length===times.length) series.push(v);
  }
  if(!times||!series.length) return null;
  const motion=new Array(times.length).fill(0);
  for(const v of series){
    for(let i=1;i<v.length;i++){
      let d=0; for(let c=0;c<4;c++) d+=Math.abs(v[i][c]-v[i-1][c]);
      motion[i]+=d;
    }
  }
  return {times,motion,duration:times[times.length-1]};
}

const clips=['attack','left_slash','heavy_hammer_swing','sword_judgment','mage_spell_cast_3','hit_reaction','charged_ground_slam'];
console.log(`\n  ${'clip'.padEnd(22)} ${'total'.padStart(6)} ${'impact'.padStart(7)} ${'imp%'.padStart(6)} ${'useful'.padStart(7)} ${'scale'.padStart(6)}`);
console.log('  useful = start..impact+recovery(0.25s). scale = useful / 1.5s GCD');
console.log('  '+'─'.repeat(62));
for(const name of clips){
  const f=path.join(RIGS,`${name}.glb`); if(!fs.existsSync(f)) continue;
  const c=readClip(f); if(!c){console.log(`  ${name} — no rotation data`);continue;}
  const peak=Math.max(...c.motion);
  const thresh=peak*0.06;              // 6% of peak = "moving"
  let first=c.motion.findIndex(m=>m>thresh);
  let last=c.motion.length-1-[...c.motion].reverse().findIndex(m=>m>thresh);
  if(first<0){console.log(`  ${name} — flat`);continue;}
  // Impact = the single frame of greatest angular change: the moment the
  // weapon connects, which is the frame that must land on time.
  const peakIdx=c.motion.indexOf(peak);
  const impact=c.times[peakIdx];
  const RECOVERY=0.25;              // enough to read follow-through before blending out
  const useful=Math.min(c.duration, impact+RECOVERY)-c.times[first];
  const scale=useful/1.5;
  console.log(`  ${name.padEnd(22)} ${c.duration.toFixed(2).padStart(6)} ${impact.toFixed(2).padStart(7)} ${((impact/c.duration*100).toFixed(0)+'%').padStart(6)} ${useful.toFixed(2).padStart(7)} ${scale.toFixed(2).padStart(6)}`);
}
