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
  const single=audioContext();audio.play(single,single.destination,id,{volume:.7});
  const cycle=audio.chimeDuration(id);
  assert(Math.abs(Math.max(...single.oscillators.map(o=>o.stopAt))-10-cycle)<1e-9,'natural duration includes the complete tail: '+id);
  const sequence=audioContext(),voices=[];
  for(let i=0;i<3;i++)voices.push(audio.play(sequence,sequence.destination,id,{volume:.7,delay:i*cycle}));
  assert.equal(sequence.oscillators.length,single.oscillators.length*3,'exactly three complete phrases: '+id);
  for(let i=0;i<3;i++){
    const group=sequence.oscillators.slice(i*single.oscillators.length,(i+1)*single.oscillators.length);
    assert(Math.abs(Math.min(...group.map(o=>o.startAt))-(10+.006+i*cycle))<1e-9,'instrument-specific spacing: '+id);
    assert(Math.abs(Math.max(...group.map(o=>o.stopAt))-(10+(i+1)*cycle))<1e-9,'full decay on every chime: '+id);
  }
  voices.forEach(v=>v.stop());assert(sequence.oscillators.every(o=>o.stopAt<=10.02),'dismissal cancels all future chimes: '+id);
}
assert.equal(new Set(audio.sounds.filter(([id])=>id!=='none').map(([id])=>audio.chimeDuration(id))).size,6,'each sound has its own natural interval');
assert.equal(audio.chimeCount({}),3);assert.equal(audio.duration({},false),0);
assert.equal(audio.chimeCount({musicAlarmDuration:17}),3,'old seconds are not migrated as chime counts');
assert.equal(audio.chimeCount({musicAlarmChimes:2.7}),3);assert.equal(audio.chimeCount({musicAlarmChimes:99}),30);
assert.equal(audio.duration({alarmDuration:2,musicAlarmChimes:3},true),3*audio.chimeDuration('chime'),'normal seconds cannot truncate music chimes');
const code=fs.readFileSync(path.join(__dirname,'../public/Pomodoro.dc.html'),'utf8').match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
let now=100000,index=0;const pending=new Map();window.CadenceWorlds={themes:{nebula:{name:'Nebula'}}};let playing=true;window.CadenceExperience={musicWasPlaying:()=>playing};
class Logic{setState(patch,done){Object.assign(this.state,typeof patch==='function'?patch(this.state):patch);if(done)done();}}
const Component=vm.runInNewContext(code+';Component',{DCLogic:Logic,window,crypto:{randomUUID:()=> 'test-id'},clearInterval(){},Date:class extends Date{static now(){return now;}},setTimeout(fn,delay){const id=++index;pending.set(id,{fn,at:now+delay});return id;},clearTimeout:id=>pending.delete(id),document:{documentElement:{dataset:{}}}});
function advance(ms){const target=now+ms;while(true){const due=[...pending].filter(([,v])=>v.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;pending.delete(due[0]);due[1].fn();}now=target;}
const c=new Component();let phrases=[];c.playAlarmOnce=(limit,delay=0)=>{phrases.push({limit,delay});};
for(const [id]of audio.sounds.filter(([id])=>id!=='none')){
  phrases=[];c.state.alarmSound=id;c.state.alarmDuration=1;c.state.alarmRepeat=15;
  const cycle=audio.chimeDuration(id),length=cycle*3000;
  c.startAlarm(true);assert.equal(c.state.alarmChimesLeft,3);assert.equal(phrases.length,3,'schedule all music chimes immediately: '+id);
  phrases.forEach((p,i)=>{assert.equal(p.limit,Infinity);assert(Math.abs(p.delay-i*cycle)<1e-9);});
  advance(3000);assert(c.state.alarmSounding,'three seconds does not cut off complete chimes: '+id);
  advance(length-3001);assert(c.state.alarmSounding,'final tail remains audible: '+id);advance(2);
  assert.equal(c.state.alarmSounding,false,'stops after third full chime: '+id);assert(c.state.alarmActive,'notice stays available');assert.equal(pending.size,0,'no repeats after third chime');
  c.stopAlarm();assert.equal(c.state.alarmActive,false);
}
c.state.alarmSound='chime';c.state.musicAlarmChimes=5;phrases=[];c.startAlarm(true);assert.equal(phrases.length,5,'custom count is used');
advance(3000);assert.equal(c.state.alarmChimesLeft,4,'notice counts chimes rather than seconds');c.stopAlarm();assert.equal(pending.size,0);
playing=false;c.state.alarmRepeat=4;c.state.alarmDuration=5;phrases=[];c.startAlarm(false);advance(4000);assert.equal(phrases.length,2,'normal repeat interval is preserved');assert(phrases.at(-1).limit<=1);advance(1000);assert.equal(c.state.alarmSounding,false);
c.state.musicAlarmChimes=3;c.state.alarmDuration=0;phrases=[];c.startAlarm(false);advance(1000);playing=true;advance(100);
assert.equal(phrases.length,3,'late music counts the first existing chime and schedules only two more');advance(audio.chimeDuration('chime')*3000);assert.equal(c.state.alarmSounding,false,'late music still stops after three chimes');
const integrated=new Component(),integratedAudio=audioContext();integrated.ac=integratedAudio;integrated.limiter={};
integrated.startAlarm(true);
const singleAudio=audioContext();audio.play(singleAudio,singleAudio.destination,'chime',{volume:.7});
assert.equal(integratedAudio.oscillators.length,3*singleAudio.oscillators.length,'component schedules three actual instrument phrases');
assert(Math.abs(Math.max(...integratedAudio.oscillators.map(o=>o.stopAt))-10-3*audio.chimeDuration('chime'))<1e-9,'actual component keeps final decay');
integrated.stopAlarm();assert(integratedAudio.oscillators.every(o=>o.stopAt<=10.02),'component dismissal cancels every scheduled voice');assert.equal(pending.size,0);
let saved;c.store={saveSettings:settings=>saved=settings};c.setAlarmNumber('musicAlarmChimes',1,30,3)({target:{value:'4.4'}});
assert.equal(c.state.musicAlarmChimes,4);assert.equal(saved.musicAlarmChimes,4,'chime preference persists');assert.equal(saved.musicAlarmDuration,undefined,'old seconds preference is not written');
c.state.alarmSound='none';c.startAlarm(false);assert.equal(c.state.alarmSounding,false);assert(c.state.alarmActive);c.stopAlarm();
const boundary=new Component();boundary.state.autoStart=false;boundary.state.remaining=0;boundary.logInterval=()=>{};boundary.saveTimer=()=>{};boundary.toast=()=>{};
boundary.setState=(patch,done)=>{Object.assign(boundary.state,patch);if(patch.mode)playing=false;if(done)done();};
playing=true;let captured;boundary.startAlarm=music=>captured=music;boundary.complete(false);assert.equal(captured,true,'capture playback before switching to break and pausing it');
console.log('Six instruments, three complete chimes with natural spacing, full tails, custom counts, persistence, normal repeats, late music, silent notices and cancellation passed without audio output.');
