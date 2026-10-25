'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../public/desktop/helper.html'),'utf8'),code=html.match(/<script nonce="%NONCE%">([\s\S]*?)<\/script>/)[1];
let current={available:true,title:'First song',artist:'First artist',trackKey:'a'.repeat(64),controls:{like:true}},interval,likes=0,reads=0;
const elements=new Map();const el=id=>{if(!elements.has(id))elements.set(id,{textContent:'',disabled:false,hidden:false});return elements.get(id);};
const env={document:{getElementById:el,addEventListener(){}},Date,setInterval(fn){interval=fn;},fetch:async(url,opts={})=>{
  if(url==='/like'){likes++;assert.equal(JSON.parse(opts.body).trackKey,current.trackKey);return {ok:true,json:async()=>({message:'Shortcut sent'})};}
  assert.equal(url,'/now-playing');reads++;return {ok:true,json:async()=>({...current})};
}};
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(setImmediate);};
(async()=>{vm.runInNewContext(code,env);await flush();assert.equal(el('title').textContent,'First song');assert.equal(el('like').disabled,false);
current={...current,title:'Next song',artist:'Next artist',trackKey:'b'.repeat(64)};interval();await flush();assert.equal(el('title').textContent,'Next song');assert.equal(el('artist').textContent,'Next artist');assert.equal(likes,0,'polling never likes songs');
await el('like').onclick();await flush();assert.equal(likes,1);await el('like').onclick();assert.equal(likes,1,'double click is debounced');assert(reads>=3);
current={available:false};interval();await flush();assert(el('like').disabled);assert.equal(el('title').textContent,'Open Spotify and select a song');
console.log('Helper page: ongoing metadata changes, explicit fresh-track like request, debounce, no automatic likes and unavailable items passed.');})();
