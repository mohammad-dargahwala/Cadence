'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const env={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/scene-events.js'),'utf8'),env);
const events=env.window.CadenceSceneEvents;
assert.equal(Object.keys(events.catalog).length,12);
for(const [id,defs]of Object.entries(events.catalog)){
  const arrivals=new Map(defs.map(d=>[d.type,new Map()]));
  for(let t=0;t<7200;t+=.5){
    const active=events.sample(id,t);assert(active.length<=defs.length,'event population remains bounded');
    assert.equal(JSON.stringify(events.sample(id,t)),JSON.stringify(active),'pause and alternate surfaces preserve the exact event frame');
    for(const e of active){assert(e.alpha>=0&&e.alpha<=1);assert(e.u>=0&&e.u<1);arrivals.get(e.type).set(e.start,e.seed);}
  }
  for(const def of defs){
    const starts=[...arrivals.get(def.type).keys()].sort((a,b)=>a-b);
    assert(starts.length>20,'events keep arriving over a long session');
    const gaps=starts.slice(1).map((x,i)=>x-starts[i]);
    assert(gaps.every(x=>x>=def.period-def.jitter&&x<=def.period+def.jitter),'arrival intervals stay within the intended range');
    assert(new Set(gaps.map(x=>x.toFixed(2))).size>10,'arrivals do not replay a fixed interval');
    assert(new Set(arrivals.get(def.type).values()).size>20,'new arrivals get different paths');
  }
  const before=JSON.stringify(events.sample('horizon',35));
  for(const def of defs){
    assert.equal(events.cue(id,10000),def.label,'gallery previews cycle through every event');
    const peak=events.sample(id,10000+def.duration*.5);
    assert.equal(peak.length,1);assert.equal(peak[0].type,def.type);assert.equal(peak[0].alpha,1);
  }
  if(id!=='horizon')assert.equal(JSON.stringify(events.sample('horizon',35)),before,'previewing another world never changes the horizon timeline');
}
assert.equal(events.sample('unknown',10).length,0);assert.equal(events.sample('horizon',NaN).length,0);
console.log('Signature events pass: bounded scheduling, varied intervals/routes, shared paused frames, and isolated gallery previews across twelve worlds.');
