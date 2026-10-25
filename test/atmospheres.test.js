'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function context(){
  const ops=[];let depth=0;
  const c=new Proxy({ops,save(){depth++},restore(){depth--;assert(depth>=0)},get depth(){return depth},createLinearGradient(){return{addColorStop(){}}},createRadialGradient(){return{addColorStop(){}}}}, {
    get(obj,key){if(key in obj)return obj[key];return(...args)=>{for(const n of args)if(typeof n==='number')assert(Number.isFinite(n),'finite canvas coordinates');ops.push([key,...args.filter(x=>typeof x==='number'||typeof x==='string')]);};},
    set(obj,key,value){obj[key]=value;return true;}
  });return c;
}
const env={window:{},document:{createElement:()=>({width:0,height:0,getContext:()=>context()})}};
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
console.log('Four art scenes render with finite geometry at phone and desktop sizes, distinct composition, and time-dependent motion.');
