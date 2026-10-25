'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../public/flow-engine.js'),'utf8');
let allocations=0;
function context(){
  const ops=[];
  return new Proxy({canvas:{dataset:{}},ops,createRadialGradient:()=>({addColorStop(){}})}, {
    get(c,key){return key in c?c[key]:(...args)=>{for(const n of args)if(typeof n==='number')assert(Number.isFinite(n));ops.push([key,...args]);};},
    set(c,key,value){c[key]=value;ops.push([key,value]);return true;}
  });
}
const env={window:{},document:{documentElement:{dataset:{}},hidden:false,createElement(){allocations++;return {width:0,height:0,getContext:()=>context()};}}};
vm.runInNewContext(code,env);const flow=env.window.CadenceFlow;
const clock=flow.createClock();
assert.equal(clock.sample(1000),24);assert.equal(clock.sample(1016),24.016);
assert.equal(clock.sample(1016),24.016,'timer and background share one timestamp');
const before=clock.sample(1032,true,1.65),changed=clock.sample(1048,true,1.65);
assert(Math.abs(changed-before-.016*1.65)<1e-10,'pace changes integrate forward without jumping');
assert.equal(clock.sample(0),changed,'redraw with an older timestamp cannot rewind');
assert.equal(clock.sample(1064,false),changed);assert.equal(clock.sample(50000,false),changed,'pause keeps the current artwork');
assert.equal(clock.sample(50016,true),changed,'resume preserves the paused frame');
assert(clock.sample(50032)>changed,'motion resumes from that frame');
const beforeSleep=clock.sample(50048);assert(clock.sample(950000)-beforeSleep<=.100001,'inactive time cannot jump the field');
for(let n=1;n<12;n++){
  const epsilon=.00001,value=flow.noise(n,719),left=flow.noise(n-epsilon,719),right=flow.noise(n+epsilon,719);
  assert(Math.abs(value-left)<1e-8&&Math.abs(right-value)<1e-8,'noise is smooth across interpolation boundaries');
}
assert.notEqual(flow.noise(42,719),flow.noise(42+2*Math.PI,719),'variation does not replay a sine cycle');
const c=context();let group=flow.travel(c,0,'lanterns',8,.01,.02);const first=group[0],seed=first.seed,route=first.x;
first.u=.999999;flow.travel(c,1/60,'lanterns',8,.01,.02);
assert.equal(group[0],first,'individual travelers persist across frames');
assert.notEqual(first.seed,seed,'new arrival has a fresh route');assert.notEqual(first.x,route);assert(first.alpha<.001,'re-entry is invisible');
const still=JSON.stringify(group);flow.travel(c,1/60,'lanterns',8,.01,.02);assert.equal(JSON.stringify(group),still,'paused travelers do not change');
let births=0,lastSeed=first.seed;for(let frame=2;frame<18000;frame++){
  flow.travel(c,frame/60,'lanterns',8,.01,.02);
  if(first.seed!==lastSeed){assert(first.alpha<.001);lastSeed=first.seed;births++;}
}
assert(births>=2,'travelers renew independently across several minutes');assert.equal(group.length,8,'traveler population stays bounded');
const trail=context();flow.particles(trail,900,600,24,'stars');const created=allocations;
for(let frame=1;frame<=120;frame++)flow.particles(trail,900,600,24+frame/60,'stars');
assert.equal(allocations,created,'continuous animation retains its particle state');
flow.particles(trail,900,600,0,'stars');assert.equal(allocations,created,'a stale redraw does not restart the particle field');
trail.ops.length=0;flow.particles(trail,900,600,26,'stars');const paused=JSON.stringify(trail.ops);
trail.ops.length=0;flow.particles(trail,900,600,26,'stars');assert.equal(JSON.stringify(trail.ops),paused,'paused particle frame remains stable');
flow.particles(trail,1200,800,26,'stars');assert.equal(allocations,created+1,'resize scales the existing trail once');

// Verify the GPU keeps its drawing buffer between alternating render surfaces.
const sizes=[],viewports=[],gpuCanvas={addEventListener(){},getContext:()=>gl};
Object.defineProperties(gpuCanvas,{width:{get(){return this.w},set(v){this.w=v;sizes.push(['width',v]);}},height:{get(){return this.h},set(v){this.h=v;sizes.push(['height',v]);}}});
const gl=new Proxy({viewport(...v){viewports.push(v);},getShaderParameter:()=>true,getProgramParameter:()=>true,getAttribLocation:()=>0,getUniformLocation:()=>({}),createShader:()=>({}),createProgram:()=>({}),createBuffer:()=>({})},{get(c,k){return k in c?c[k]:()=>{};}});
const gpuEnv={window:{},WebGLRenderingContext:function(){},document:{createElement:()=>gpuCanvas}};vm.runInNewContext(code,gpuEnv);
const target=context();for(let frame=0;frame<30;frame++)for(const [w,h]of [[1440,900],[340,340],[170,65]])assert(gpuEnv.window.CadenceFlow.paint(target,w,h,frame/60));
assert.equal(sizes.length,2,'GPU dimensions are allocated once across backgrounds, timers and previews');
assert(viewports.every(([x,y,w,h])=>x===0&&y>=0&&w<=950&&y+h<=620),'all render regions fit the fixed drawing buffer');
assert(target.ops.filter(op=>op[0]==='drawImage').every(op=>op.length===10),'only the rendered GPU region is copied');
console.log('Animation continuity passed: monotonic shared clock, smooth pace/pause, nonperiodic motion, fresh faded arrivals, persistent trails and stable GPU allocation.');
