'use strict';
// Behavioral tests with a fake clock and mocked Spotify transport. No live account.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'../public/experience.js'),'utf8');
const flush = async () => { for(let i=0;i<12;i++) await new Promise(setImmediate); };
function harness(transport='web',reduceMotion=false) {
  let now=1000000, sequence=0, pendingPlay, nativePlaying=false, helperUp=true;
  let nativeTrack={title:'Native test song',artist:'Artist',album:'Album one',artwork:'',trackKey:'a'.repeat(64)},likeSupported=true;
  const callbacks=new Map(), intervals=new Map(), requests=[], listeners={}, data=new Map();
  const state={workspaceId:'account-a',user:'Tester',settings:{experience:{musicMode:'full',musicSource:transport}}};
  if(transport==='desktop') data.set('cadence.desktop.pair',JSON.stringify({owner:'account-a',key:'q'.repeat(32),clientId:'a'.repeat(32)}));
  data.set('cadence.spotify.tokens',JSON.stringify({owner:'account-a',clientId:'a'.repeat(32),access_token:'test-access',refresh_token:'test-refresh',expiresAt:now+3600000}));
  class Element {
    constructor(){this.dataset={};this.style={};this.children=[];this.nodes={};}
    setAttribute(){}
    append(...els){this.children.push(...els);}
    querySelector(key){
      if(key==='[data-action=play]') return this.querySelector('.music-controls').children.find(b=>b.dataset.action==='play');
      return this.nodes[key] ||= new Element();
    }
    querySelectorAll(key){return key==='button'?this.querySelector('.music-controls').children:[];}
  }
  const body=new Element(), root=new Element();
  const document={documentElement:root,body,hidden:false,querySelectorAll:()=>[],getElementById:()=>null,createElement:()=>new Element(),addEventListener:(k,fn)=>listeners[k]=fn};
  const store={getState:()=>state,subscribe(fn){this.subscriber=fn;},ready:Promise.resolve(),saveSettings(patch){Object.assign(state.settings,patch);this.subscriber(state);}};
  const context={document,HTMLElement:Element,customElements:{define(){}},matchMedia:query=>({matches:query.includes('prefers-reduced-motion')&&reduceMotion,addEventListener(){}}),location:{search:'',origin:'https://cadence.test'},history:{replaceState(){}},crypto:crypto.webcrypto,TextEncoder,URLSearchParams,
    AbortSignal,localStorage:{setItem(){},getItem(){return null;}},sessionStorage:{getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)},
    Date:class extends Date {static now(){return now;}},setTimeout(fn,delay){const id=++sequence;callbacks.set(id,{fn,delay});return id;},clearTimeout:id=>callbacks.delete(id),setInterval(fn){const id=++sequence;intervals.set(id,fn);return id;},clearInterval:id=>intervals.delete(id),requestAnimationFrame(){return 1;},
    fetch:async(url,opts={})=>{
      const body=opts.body?JSON.parse(opts.body):null;
      requests.push({url,method:opts.method||'GET',body});
      if(url.startsWith('http://127.0.0.1:17842')) {
        if(url.endsWith('/health')){if(!helperUp)throw Error('Failed to fetch');return {ok:true,json:async()=>({ok:true,service:'cadence-desktop'})};}
        if(url.endsWith('/timer')) nativePlaying=body.allowed && body.deadline>now;
        if(url.endsWith('/command') && body.action==='pause')nativePlaying=false;
        if(url.endsWith('/command') && body.action==='play')nativePlaying=true;
        if(url.endsWith('/like'))return {status:200,ok:true,json:async()=>({ok:true,message:'Like / unlike shortcut sent to Spotify.'})};
        return {status:200,ok:true,json:async()=>({connected:true,available:true,playing:nativePlaying,...nativeTrack,positionMs:20000,durationMs:180000,controls:{play:true,pause:true,seek:false,next:false,previous:true,like:likeSupported}})};
      }
      if(url.endsWith('/play') && pendingPlay) { const p=pendingPlay; pendingPlay=null; await p; }
      return {status:204,ok:true,headers:{get(){return null;}}};
    },console
  };
  context.window={CadenceStore:store,addEventListener:(k,fn)=>listeners[k]=fn};
  vm.runInNewContext(source,context);
  return {context,root,state,store,requests,body,callbacks,intervals,data,
    timer(next){context.window.CadenceExperience.timer({signedIn:true,running:true,mode:'focus',remaining:60,deadline:now+60000,view:'timer',alarm:false,...next});},
    setNow(v){now=v;},now:()=>now,
    setNativePlaying(v){nativePlaying=v;},
    setNativeTrack(v){nativeTrack={...nativeTrack,...v};},
    setLikeSupported(v){likeSupported=v;},
    runIntervals(){[...intervals.values()].forEach(fn=>fn());},
    setHelperUp(v){helperUp=v;},
    visibility(){listeners.visibilitychange();},
    holdPlay(){return new Promise(resolve=>{let release;pendingPlay=new Promise(r=>release=r);resolve(release);});}
  };
}
(async()=>{
  const h=harness(); await flush();
  h.timer();await flush();assert(h.requests.at(-1).url.endsWith('/play'),'focus resumes playback');
  h.timer({running:false});await flush();assert(h.requests.at(-1).url.endsWith('/pause'),'pausing timer pauses playback');
  h.timer();await flush();h.timer({mode:'short'});await flush();assert(h.requests.at(-1).url.endsWith('/pause'),'short break pauses playback');
  h.timer();await flush();h.timer({mode:'long'});await flush();assert(h.requests.at(-1).url.endsWith('/pause'),'long break pauses playback');
  h.timer();await flush();h.timer({alarm:true});await flush();assert(h.requests.at(-1).url.endsWith('/pause'),'completion alarm pauses playback');
  h.timer({alarm:false});await flush();h.setNow(h.now()+60001);
  for(const item of [...h.callbacks.values()]) item.fn();
  await flush();assert(h.requests.at(-1).url.endsWith('/pause'),'deadline pauses even before timer view updates');

  h.timer();await flush();
  const player=h.body.children[0],playButton=player.querySelector('[data-action=play]');
  const manualStart=h.requests.length;playButton.onclick();await flush();assert(h.requests.slice(manualStart).some(r=>r.url.endsWith('/pause')),'manual pause works');
  const n=h.requests.length;h.timer({remaining:59});await flush();assert.equal(h.requests.length,n,'timer ticks do not undo manual pause');
  h.timer({mode:'short'});await flush();h.timer();await flush();assert(h.requests.at(-1).url.endsWith('/play'),'next focus block resumes');

  h.store.saveSettings({experience:{musicSource:'web',musicMode:'hide',songName:true}});h.timer();
  assert.equal(player.dataset.mode,'hide');assert.equal(player.querySelector('.music-title').hidden,true,'hide mode removes track identity');
  h.store.saveSettings({experience:{musicSource:'web',musicMode:'artwork',songName:false}});h.timer();assert.equal(player.querySelector('.music-title').hidden,true,'song-name toggle hides title');
  h.store.saveSettings({experience:{musicSource:'web',musicMode:'off'}});h.timer();await flush();assert.equal(player.hidden,true,'off hides player');assert(h.requests.at(-1).url.endsWith('/pause'),'off pauses playback even when setting arrives from another tab');
  const before=h.requests.length;h.timer({mode:'long'});await flush();assert.equal(h.requests.length,before,'off makes no playback commands');
  h.store.saveSettings({experience:{musicSource:'web',musicMode:'full',background:false,wave:false,details:false,motion:false}});
  assert.equal(h.root.dataset.background,'false');assert.equal(h.root.dataset.motion,'false');assert.equal(h.root.dataset.wave,'false');
  const motion=harness('web',true);await flush();
  assert.equal(motion.root.dataset.motion,'true','requested Flow mode can run despite a system reduced-motion preference');
  motion.store.saveSettings({experience:{motion:true,followSystemMotion:true}});assert.equal(motion.root.dataset.motion,'false','Follow system honors reduced motion');
  motion.store.saveSettings({experience:{motion:false,followSystemMotion:false}});assert.equal(motion.root.dataset.motion,'false','explicit pause always stops motion');

  const native=harness('desktop');await flush();native.timer();await flush();
  assert(native.requests.some(r=>r.url.endsWith('/command')&&r.body.action==='play'),'desktop focus sends an explicit play command');
  assert(native.requests.some(r=>r.url.endsWith('/timer')&&r.body.allowed&&r.body.deadline>native.now()),'native helper receives the absolute focus deadline');
  native.timer({mode:'long'});await flush();
  assert(native.requests.some(r=>r.url.endsWith('/timer')&&r.body.allowed===false),'break revokes native focus lease');
  assert.equal(native.requests.some(r=>r.url.includes('api.spotify.com')),false,'desktop route never calls the Premium API');
  const nativePlayer=native.body.children[0];
  assert.equal(nativePlayer.querySelector('.music-controls').children.find(b=>b.dataset.action==='next').disabled,true,'Spotify-disabled native controls remain disabled');
  native.store.subscriber(native.state);
  const beforeManual=native.requests.length;native.setNativePlaying(true);
  [...native.intervals.values()][0]();await flush();
  assert.equal(native.requests.slice(beforeManual).some(r=>r.url.endsWith('/command')&&r.body.action==='pause'),false,'idle metadata polling does not fight manual desktop playback');
  const beforeProbe=native.requests.length;assert(await native.context.window.CadenceExperience.checkDesktopHelper());native.setHelperUp(false);assert.equal(await native.context.window.CadenceExperience.checkDesktopHelper(),false);
  assert(native.requests.slice(beforeProbe).every(r=>r.method==='GET'&&r.url.endsWith('/health')),'helper readiness never pairs or controls media');
  const boundary=harness('desktop');await flush();boundary.timer();await flush();assert(boundary.context.window.CadenceExperience.musicWasPlaying());
  boundary.setNow(boundary.now()+60000);boundary.setNativePlaying(false);boundary.visibility();await flush();
  assert(boundary.context.window.CadenceExperience.musicWasPlaying(),'alarm remembers playback before the native deadline pause');
  boundary.timer({mode:'short',running:false,deadline:0});await flush();assert.equal(boundary.context.window.CadenceExperience.musicWasPlaying(),false,'break state does not retain stale focus playback');
  const metadata=harness('desktop');await flush();assert.equal(metadata.intervals.size,0,'pairing can finish before the timer is signed in');
  metadata.timer({running:false});await flush();assert.equal(metadata.intervals.size,2,'sign-in starts metadata polling and heartbeats');
  const pollIds=[...metadata.intervals.keys()].join(',');for(let i=0;i<5;i++)metadata.store.subscriber(metadata.state);
  assert.equal([...metadata.intervals.keys()].join(','),pollIds,'routine store emissions do not restart and starve metadata polling');
  metadata.setNativeTrack({title:'Next song',artist:'Next artist',album:'Album two',artwork:'data:image/png;base64,AA==',trackKey:'b'.repeat(64)});metadata.setNow(metadata.now()+2000);metadata.runIntervals();await flush();
  const metadataPlayer=metadata.body.children[0];assert.equal(metadataPlayer.querySelector('.music-title').textContent,'Next song');assert.equal(metadataPlayer.querySelector('.music-artist').textContent,'Next artist');assert.equal(metadataPlayer.querySelector('img').src,'data:image/png;base64,AA==','art follows the new track');
  metadata.setNativeTrack({title:'Third song',artist:'Third artist',artwork:'data:image/png;base64,AQ==',trackKey:'c'.repeat(64)});metadata.setNow(metadata.now()+2000);metadata.runIntervals();await flush();assert.equal(metadataPlayer.querySelector('.music-title').textContent,'Third song','automatic changes keep refreshing beyond the first transition');
  const likeButton=metadataPlayer.querySelector('.music-controls').children.find(b=>b.dataset.action==='like'),beforeLike=metadata.requests.length;
  assert.equal(likeButton.disabled,false);likeButton.onclick();likeButton.onclick();await flush();
  const likes=metadata.requests.slice(beforeLike).filter(r=>r.url.endsWith('/like'));assert.equal(likes.length,1,'like click is debounced');assert.equal(likes[0].body.trackKey,'c'.repeat(64),'like targets the currently displayed song');
  assert(metadata.requests.slice(beforeLike).every(r=>!r.url.endsWith('/command')&&!r.url.endsWith('/timer')),'liking does not play, pause, skip or change focus ownership');
  metadata.setLikeSupported(false);metadata.setNow(metadata.now()+2000);metadata.runIntervals();await flush();assert.equal(likeButton.disabled,true,'older helpers do not advertise unsupported like controls');
  metadata.timer({signedIn:false,running:false});await flush();assert.equal(metadata.intervals.size,0,'sign-out stops polling');

  const race=harness();await flush();const release=await race.holdPlay();race.timer();await flush();race.timer({mode:'short'});await flush();assert(race.requests.at(-1).url.endsWith('/pause'),'break pause does not wait for an in-flight resume');release();await flush();
  assert(race.requests.at(-1).url.endsWith('/pause'),'late resume response cannot leave a break playing');
  race.timer();await flush();race.state.workspaceId=null;race.state.user=null;race.store.subscriber(race.state);await flush();
  assert.equal(race.data.has('cadence.spotify.tokens'),false,'sign-out removes tab credentials');assert(race.requests.at(-1).url.endsWith('/pause'),'sign-out pauses music');

  const html=fs.readFileSync(path.join(__dirname,'../public/Pomodoro.dc.html'),'utf8');
  const code=html.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
  const saved=new Map(), logged=[], timers=new Map();let clock=5000000,index=0;
  class Logic{constructor(){this.props={};}setState(patch,fn){Object.assign(this.state,typeof patch==='function'?patch(this.state):patch);if(fn)fn();}}
  const worldEnv={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/art-worlds.js'),'utf8'),worldEnv);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/alarm-audio.js'),'utf8'),worldEnv);
  const Component=vm.runInNewContext(code+'; Component',{DCLogic:Logic,crypto:crypto.webcrypto,console,
    Date:class extends Date{static now(){return clock;}},localStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)},
    document:{documentElement:{style:{setProperty(){}},dataset:{}},body:{style:{}},querySelector:()=>null},window:worldEnv.window,
    setInterval:()=>++index,clearInterval(){},setTimeout:(fn)=>{timers.set(++index,fn);return index;},clearTimeout:id=>timers.delete(id)});
  const c=new Component();c.pop=()=>{};c.toast=()=>{};c.startAlarm=()=>{};
  c.store={logSession:e=>logged.push(e),getState:()=>({sessions:[]}),saveSettings(){}};c.state.user='Tester';c.TIMER_KEY='timer-a';
  assert.equal(Object.keys(c.themes).length,12,'twelve worlds available');
  for(const id of ['polar','rain','dunes']){c.setTheme(id)();assert.equal(c.state.theme,id,'new theme can be selected');}
  c.setTheme('clay')();assert.equal(c.state.theme,'valley','retired selection resolves to a painted world');c.setTheme('nebula')();
  c.setRunning(true);clock+=1499700;c.tick();assert.equal(c.state.remaining,1,'timer never finishes half a second early');clock+=300;c.tick();assert.equal(c.state.mode,'short');assert.equal(logged[0].seconds,1500);
  c.setMode('long')();assert.equal(c.renderVals().runLabel,'Start break','break action uses correct label');
  c.setMode('focus')();c.setRunning(true);c.state.durations.focus=40;assert.equal(c.total(),1500,'editing preferences does not change an active interval length');c.setRunning(false);c.reset();assert.equal(c.total(),2400,'reset adopts the new interval preference');
  c.state.alarmActive=true;c.state.alarmSounding=true;let stopped=0;c.alarmVoices=[{stop(){stopped++}}];c.stopAlarm();assert.equal(stopped,1,'dismissal stops active voices');assert.equal(c.state.alarmSounding,false);assert.equal(timers.size,0,'alarm dismissal cancels pending notes');
  c.state.running=true;c.onStoreChange({user:'Other',workspaceId:'other',settings:{durations:{focus:30,short:5,long:15}}});assert.equal(c.state.running,false,'new account never inherits active timer');assert.equal(c.state.remaining,1800);assert.equal(c.TIMER_KEY,'cadence.timer.other');
  console.log('Experience and timer regressions passed: focus/break/pause/alarm/deadline, playback races, manual pause, display modes, sign-out, themes, countdown rounding, account isolation, and alarm cancellation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
