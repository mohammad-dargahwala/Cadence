'use strict';
// No speakers or music transport: scheduling and boundary behavior use fake clocks.
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const window={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/alarm-audio.js'),'utf8'),{window});
const audio=window.CadenceAlarm;
function parameter(){return {value:0,events:[],setValueAtTime(v,t){this.events.push(['set',v,t]);},linearRampToValueAtTime(v,t){this.events.push(['linear',v,t]);},exponentialRampToValueAtTime(v,t){this.events.push(['exponential',v,t]);},setTargetAtTime(v,t,k){this.events.push(['target',v,t,k]);},cancelScheduledValues(t){this.events.push(['cancel',t]);}};}
function audioContext(){return {currentTime:10,state:'running',destination:{},oscillators:[],gains:[],resume:async()=>{},createGain(){const g={gain:parameter(),connect(){},disconnect(){}};this.gains.push(g);return g;},createOscillator(){const o={frequency:parameter(),connect(){},disconnect(){},start(t){this.startAt=t;},stop(t){this.stopAt=t;}};this.oscillators.push(o);return o;}};}
for(const [id]of audio.sounds){
  const ac=audioContext(),voice=audio.play(ac,ac.destination,id,{volume:.7,limit:3});if(id==='none'){assert.equal(voice,null);continue;}
  assert(ac.oscillators.length>10,'layered instrument: '+id);
  for(const o of ac.oscillators){assert(o.startAt>=10);assert(o.stopAt<=13,'no note or echo exceeds 3 seconds');assert(o.stopAt>o.startAt);}
  voice.cutOff(.2);assert(ac.oscillators.every(o=>o.stopAt<=10.2),'new playback shortens already scheduled notes');
  voice.stop();assert(ac.oscillators.every(o=>o.stopAt<=10.02),'dismissal cancels future voices too');
}
assert.equal(audio.duration({},true),3);assert.equal(audio.duration({},false),0);
assert.equal(audio.duration({alarmDuration:10,musicAlarmDuration:3},true),3);
assert.equal(audio.duration({alarmDuration:2,musicAlarmDuration:3},true),2,'a shorter normal duration still wins');
const code=fs.readFileSync(path.join(__dirname,'../public/Pomodoro.dc.html'),'utf8').match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
let now=100000,index=0;const pending=new Map();window.CadenceWorlds={themes:{nebula:{name:'Nebula'}}};let playing=true;window.CadenceExperience={musicWasPlaying:()=>playing};
class Logic{setState(patch,done){Object.assign(this.state,typeof patch==='function'?patch(this.state):patch);if(done)done();}}
const Component=vm.runInNewContext(code+';Component',{DCLogic:Logic,window,crypto:{randomUUID:()=> 'test-id'},clearInterval(){},Date:class extends Date{static now(){return now;}},setTimeout(fn,delay){const id=++index;pending.set(id,{fn,at:now+delay});return id;},clearTimeout:id=>pending.delete(id),document:{documentElement:{dataset:{}}}});
function advance(ms){const target=now+ms;while(true){const due=[...pending].filter(([,v])=>v.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;pending.delete(due[0]);due[1].fn();}now=target;}
const c=new Component();let phrases=[];c.playAlarmOnce=limit=>phrases.push(limit);
c.startAlarm(true);assert.equal(c.state.alarmLeft,3);advance(2999);assert(c.state.alarmSounding);advance(1);
assert.equal(c.state.alarmSounding,false,'music alarm stops at exactly 3 seconds');assert(c.state.alarmActive,'completion notice stays available');assert.equal(pending.size,0,'no repeats survive the cap');assert.equal(phrases.length,1);
c.stopAlarm();assert.equal(c.state.alarmActive,false);
playing=false;c.state.alarmDuration=5;c.startAlarm(false);advance(4000);assert.equal(phrases.length,3,'repeat interval controls the next phrase');assert(phrases.at(-1)<=1);advance(1000);assert.equal(c.state.alarmSounding,false);
c.state.alarmDuration=0;c.startAlarm(false);advance(1000);playing=true;advance(2000);assert.equal(c.state.alarmSounding,false,'music starting during an alarm applies the cap');
c.state.alarmSound='none';c.startAlarm(false);assert.equal(c.state.alarmSounding,false);assert(c.state.alarmActive);c.stopAlarm();
const boundary=new Component();boundary.state.autoStart=false;boundary.state.remaining=0;boundary.logInterval=()=>{};boundary.saveTimer=()=>{};boundary.toast=()=>{};
boundary.setState=(patch,done)=>{Object.assign(boundary.state,patch);if(patch.mode)playing=false;if(done)done();};
playing=true;let captured;boundary.startAlarm=music=>captured=music;boundary.complete(false);assert.equal(captured,true,'capture playback before switching to break and pausing it');
console.log('Six instruments, bounded tails/echoes, exact music duration, repeats, late playback, silent notices and cancellation passed without audio output.');
