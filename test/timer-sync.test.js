'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '../public/timer-sync.js'), 'utf8');
const tick = async () => { for (let i=0; i<20; i++) await new Promise(setImmediate); };
const copy = value => JSON.parse(JSON.stringify(value));
let server = null, online = true, serverNow = 1000000, failReply = false;
const history = new Map();
function client(data = new Map(), skew = 0) {
  const changes = [], sessions = [], intervals = new Map(); let seq = 0;
  const store = { workspaceId: 'test-account', setLiveTimer(){}, forceSync: async()=>{}, logSession:s=>sessions.push(s) };
  const context = { window:{}, crypto:crypto.webcrypto, AbortSignal,
    Date:class extends Date { static now(){ return serverNow + skew; } },
    localStorage:{getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)},
    document:{hidden:false,addEventListener(){},removeEventListener(){}},
    setInterval:fn=>{intervals.set(++seq,fn);return seq;},clearInterval:id=>intervals.delete(id),
    fetch:async(_,options)=>{
      if (!online) throw Error('offline');
      let accepted = true;
      if(options.method==='PUT') {
        const operation=JSON.parse(options.body);
        accepted = (server?.changeId || null) === operation.baseChangeId || server?.changeId === operation.timer.changeId;
        if(accepted) {
          server=copy(operation.timer);
          if(operation.session)history.set(operation.session.id,operation.session);
        }
        if(failReply){failReply=false;throw Error('lost response');}
      }
      const result=copy({timer:server,accepted,serverTime:serverNow});
      return {ok:accepted,status:accepted?200:409,json:async()=>result};
    }
  };
  context.window.addEventListener=()=>{};context.window.removeEventListener=()=>{};
  vm.runInNewContext(source,context);
  const controller = new context.window.CadenceTimerSync(store,t=>changes.push(t));
  return {controller,data,changes,sessions,intervals};
}
const snapshot = () => ({id:crypto.randomUUID(),mode:'focus',round:3,running:true,planned:1500,
  remaining:900,deadline:1900000,startedAt:400000,localDate:'2026-10-31',category:'DESIGN'});
(async()=>{
  const a=client(),b=client(new Map(),120000);await Promise.all([a.controller.ready,b.controller.ready]);
  a.controller.save(snapshot());await tick();await b.controller.sync();
  assert.equal(b.controller.timer.round,3);assert.equal(b.controller.timer.deadline,a.controller.timer.deadline);
  assert.equal(b.controller.now(),a.controller.now(),'server time corrects a two-minute device clock difference');
  const paused={...a.controller.timer,running:false,deadline:0};a.controller.save(paused);await tick();await b.controller.sync();
  assert.equal(b.controller.timer.running,false);assert.equal(b.controller.timer.remaining,900);
  // Two clients complete the same interval. Only one successor and history row win.
  const session={id:server.id,seconds:600,mode:'focus',completed:false};
  a.controller.save({...snapshot(),mode:'short',running:false,deadline:0},session);
  b.controller.save({...snapshot(),mode:'short',running:false,deadline:0},session);
  await tick();await a.controller.sync();await b.controller.sync();
  assert.equal(history.size,1);assert.equal(a.controller.timer.id,b.controller.timer.id);
  // A lost acknowledgement must replay the same operation, not add another round.
  failReply=true;a.controller.save({...server,remaining:800});await tick();
  const acceptedId=server.changeId;a.controller.retryAt=0;await a.controller.sync();
  assert.equal(server.changeId,acceptedId);assert.equal(a.controller.queue.length,0);
  // Rapid local changes stay ordered and survive an offline reload.
  online=false;a.controller.save({...server,round:4});a.controller.save({...a.controller.timer,round:1});await tick();
  a.controller.close();const restored=client(a.data);await restored.controller.ready;
  assert.equal(restored.controller.timer.round,1);assert.equal(restored.controller.queue.length,2);
  online=true;restored.controller.retryAt=0;await restored.controller.sync();
  assert.equal(server.round,1);assert.equal(restored.controller.queue.length,0);
  // An old offline device cannot overwrite newer server progress on reconnect.
  await b.controller.sync();online=false;b.controller.save({...b.controller.timer,round:2});await tick();
  online=true;restored.controller.save({...restored.controller.timer,round:4});await tick();
  b.controller.retryAt=0;await b.controller.sync();assert.equal(b.controller.timer.round,4);assert.equal(server.round,4);
  restored.controller.close();b.controller.close();assert.equal(restored.intervals.size,0);
  console.log('Timer sync passed: shared rounds/deadlines, clock skew, pause, simultaneous completion, lost replies, ordered offline recovery, stale-device rejection and cleanup.');
})().catch(error=>{console.error(error);process.exitCode=1;});
