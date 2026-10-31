'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function context(){
  const ops=[];let depth=0;
  const c=new Proxy({ops,canvas:{dataset:{},parentElement:{style:{}}},save(){depth++},restore(){depth--;assert(depth>=0)},get depth(){return depth},createLinearGradient(){return{addColorStop(){}}},createRadialGradient(){return{addColorStop(){}}}}, {
    get(obj,key){if(key in obj)return obj[key];return(...args)=>{for(const n of args)if(typeof n==='number')assert(Number.isFinite(n),'finite canvas coordinates');ops.push([key,...args.filter(x=>typeof x==='number'||typeof x==='string')]);};},
    set(obj,key,value){obj[key]=value;if(typeof value==='string'||typeof value==='number')ops.push(['set',key,value]);return true;}
  });return c;
}
const env={window:{},document:{createElement:()=>({width:0,height:0,getContext:()=>context()})}};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../public/art-worlds.js'),'utf8'),env);
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../public/flow-engine.js'),'utf8'),env);
for(const file of ['extra-worlds.js','scene-events.js'])vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../public/'+file),'utf8'),env);
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../public/atmospheres.js'),'utf8'),env);
const signatures=[];
const ids=Object.keys(env.window.CadenceWorlds.themes);
assert.equal(ids.length,12,'curated catalog contains twelve worlds');
for(const id of ids){
  for(const [w,h] of [[390,844],[1440,900]]){
    const first=context(),next=context();env.window.CadenceAtmospheres.draw(first,w,h,24,id);env.window.CadenceAtmospheres.draw(next,w,h,34,id);
    assert.equal(first.depth,0,'scene restores canvas state');assert(first.ops.some(op=>op[0]==='fillRect'||op[0]==='drawImage'),'scene paints its background: '+id);
    assert.notEqual(JSON.stringify(first.ops),JSON.stringify(next.ops),'time moves the scene');
    first.ops.length=0;env.window.CadenceAtmospheres.draw(first,w,h,24+1/60,id);const adjacent=JSON.stringify(first.ops);
    first.ops.length=0;env.window.CadenceAtmospheres.draw(first,w,h,24+2/60,id);
    assert.notEqual(JSON.stringify(first.ops),adjacent,'adjacent display frames evolve: '+id);
    if(w===1440)signatures.push(JSON.stringify(first.ops.slice(-80)));
  }
}
assert.equal(new Set(signatures).size,12,'twelve scenes have distinct drawing geometry');
const timers=[];
for(const id of ids){
  const c=context();env.window.CadenceAtmospheres.drawTimer(c,340,340,24,id,.8);
  const first=JSON.stringify(c.ops),shape=c.canvas.parentElement.style.borderRadius;
  c.ops.length=0;env.window.CadenceAtmospheres.drawTimer(c,340,340,24,id,.2);
  assert(JSON.stringify(c.ops)!==first,'timer artwork responds to countdown progress: '+id);
  assert.equal(c.depth,0,'timer restores canvas state');assert(shape,'each custom timer has a defined silhouette');
  timers.push(JSON.stringify(c.ops.slice(-100)));
}
assert.equal(new Set(timers).size,12,'timer worlds have distinct compositions');
const moving=context();env.window.CadenceAtmospheres.draw(moving,900,600,0,'aurora');
const start=JSON.stringify(moving.ops);moving.ops.length=0;
for(let i=1;i<=60;i++)env.window.CadenceAtmospheres.draw(moving,900,600,i/30,'aurora');
assert.notEqual(JSON.stringify(moving.ops.slice(-100)),start,'persistent particles evolve across successive frames');
for(const [retired,replacement]of Object.entries({graphite:'nebula',ember:'lantern',mist:'valley',clay:'valley'})){
  assert.equal(env.window.CadenceWorlds.resolve(retired),replacement,'retired preferences migrate');assert(!ids.includes(retired),'retired theme removed from picker');
}
assert.equal(env.window.CadenceWorlds.resolve('unknown'),'nebula','unknown preferences use a valid world');
// Exercise every signature moment at entrance, peak and exit in both surfaces.
// This catches invalid paths and canvas-state leaks hidden by long natural gaps.
const events=env.window.CadenceSceneEvents;
for(const id of ids){
  let startTime=1000;
  for(const def of events.catalog[id]){
    assert.equal(events.cue(id,startTime),def.label);
    for(const phase of [0,.03,.5,.97,1]){
      const c=context(),t=startTime+phase*def.duration;
      env.window.CadenceAtmospheres.draw(c,390,844,t,id);
      env.window.CadenceAtmospheres.drawTimer(c,230,230,t,id,.5);
      assert.equal(c.depth,0,'event restores canvas state: '+id+'/'+def.type);
    }
    startTime+=100;
  }
}
console.log('Twelve distinct evolving scenes, dials and every signature event render at phone/desktop sizes; retired preferences migrate safely.');
