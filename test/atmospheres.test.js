'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function context(){
  const ops=[];let depth=0;
  const c=new Proxy({ops,canvas:{dataset:{},parentElement:{style:{}}},save(){depth++},restore(){depth--;assert(depth>=0)},get depth(){return depth},createLinearGradient(){return{addColorStop(){}}},createRadialGradient(){return{addColorStop(){}}}}, {
    get(obj,key){if(key in obj)return obj[key];return(...args)=>{for(const n of args)if(typeof n==='number')assert(Number.isFinite(n),'finite canvas coordinates');ops.push([key,...args.filter(x=>typeof x==='number'||typeof x==='string')]);};},
    set(obj,key,value){obj[key]=value;return true;}
  });return c;
}
const env={window:{},document:{createElement:()=>({width:0,height:0,getContext:()=>context()})}};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../public/flow-engine.js'),'utf8'),env);
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../public/atmospheres.js'),'utf8'),env);
const signatures=[];
for(const id of ['sakura','solstice','aurora','tidal']){
  for(const [w,h] of [[390,844],[1440,900]]){
    const first=context(),next=context();env.window.CadenceAtmospheres.draw(first,w,h,24,id);env.window.CadenceAtmospheres.draw(next,w,h,34,id);
    assert.equal(first.depth,0,'scene restores canvas state');assert(first.ops.length>150,'scene renders complete artwork');
    assert.notEqual(JSON.stringify(first.ops),JSON.stringify(next.ops),'time moves the scene');
    if(w===1440)signatures.push(JSON.stringify(first.ops.slice(-80)));
  }
}
assert.equal(new Set(signatures).size,4,'four scenes have distinct drawing geometry');
const timers=[];
for(const id of ['sakura','solstice','aurora','tidal']){
  const c=context();env.window.CadenceAtmospheres.drawTimer(c,340,340,24,id,.8);
  const first=JSON.stringify(c.ops),shape=c.canvas.parentElement.style.borderRadius;
  c.ops.length=0;env.window.CadenceAtmospheres.drawTimer(c,340,340,24,id,.2);
  assert.notEqual(JSON.stringify(c.ops),first,'timer artwork responds to countdown progress');
  assert.equal(c.depth,0,'timer restores canvas state');assert(shape,'each custom timer has a defined silhouette');
  timers.push(JSON.stringify(c.ops.slice(-100)));
}
assert.equal(new Set(timers).size,4,'timer worlds have distinct compositions');
const moving=context();env.window.CadenceAtmospheres.draw(moving,900,600,0,'aurora');
const start=JSON.stringify(moving.ops);moving.ops.length=0;
for(let i=1;i<=60;i++)env.window.CadenceAtmospheres.draw(moving,900,600,i/30,'aurora');
assert.notEqual(JSON.stringify(moving.ops.slice(-100)),start,'persistent particles evolve across successive frames');
console.log('Four evolving fields and four themed timer dials render at phone/desktop sizes with finite geometry, persistent motion and countdown-dependent artwork.');
