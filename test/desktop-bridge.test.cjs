// Read-only Windows smoke check. Never pairs or sends a media/timer command.
const assert=require('node:assert/strict');
(async()=>{
  const base='http://127.0.0.1:17842',origin='http://127.0.0.1:8787';
  const health=await fetch(base+'/health').then(r=>r.json());assert.equal(health.ok,true);assert.equal(health.service,'cadence-desktop');
  const page=await fetch(base+'/').then(r=>r.text());
  const key=page.match(/<code>([A-Za-z0-9_-]{32})<\/code>/)?.[1];assert(key,'helper supplies an ephemeral pairing code');
  const headers={'Content-Type':'application/json','Origin':origin,'X-Cadence-Key':key,'X-Cadence-Client':'b'.repeat(32)};
  assert.equal((await fetch(base+'/status',{headers:{Origin:origin}})).status,401,'status requires pairing code');
  assert.equal((await fetch(base+'/status',{headers:{...headers,Origin:'https://untrusted.example'}})).status,403,'other origins rejected');
  const preflight=await fetch(base+'/timer',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Headers':'x-cadence-key,x-cadence-client,content-type'}});
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
  console.log('Desktop helper readiness, pairing page, origin restrictions and preflight passed. No pairing, timers or playback commands were sent.');
})().catch(e=>{console.error(e);process.exitCode=1;});
