// Optional Windows integration check. Start the helper first. Does not start music.
const assert=require('node:assert/strict');
(async()=>{
  const base='http://127.0.0.1:17842',origin='http://127.0.0.1:8787';
  const page=await fetch(base+'/').then(r=>r.text());
  const key=page.match(/<code>([A-Za-z0-9_-]{32})<\/code>/)?.[1];assert(key,'helper supplies an ephemeral pairing code');
  const headers={'Content-Type':'application/json','Origin':origin,'X-Cadence-Key':key,'X-Cadence-Client':'b'.repeat(32)};
  assert.equal((await fetch(base+'/status',{headers:{Origin:origin}})).status,401,'status requires pairing code');
  assert.equal((await fetch(base+'/status',{headers:{...headers,Origin:'https://untrusted.example'}})).status,403,'other origins rejected');
  const preflight=await fetch(base+'/timer',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Headers':'x-cadence-key,x-cadence-client,content-type'}});
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
  const pair=await fetch(base+'/pair',{method:'POST',headers,body:'{}'});assert.equal(pair.status,200);const status=await pair.json();
  assert.equal(status.connected,true);assert.equal(typeof status.playing,'boolean');
  const req=(url,body)=>fetch(base+url,{method:'POST',headers,body:JSON.stringify(body)});
  assert.equal((await req('/timer',{allowed:true,deadline:Date.now()-1000})).status,200,'expired focus deadline accepted only as paused');
  const forbiddenPlay=await req('/command',{action:'play'});assert.equal(forbiddenPlay.status,400,'play refused outside focus');
  assert.match((await forbiddenPlay.json()).error,/focus/i);
  const pause=await req('/command',{action:'pause'});assert.equal(pause.status,200,'idempotent pause works');
  const final=await fetch(base+'/status',{headers}).then(r=>r.json());assert.equal(final.playing,false,'Spotify remains paused');
  const wrongClient=await fetch(base+'/status',{headers:{...headers,'X-Cadence-Client':'c'.repeat(32)}});assert.equal(wrongClient.status,409,'unpaired tab rejected');
  await req('/disconnect',{});
  console.log('Desktop helper: pairing, origin/host boundaries, native Spotify detection, expired deadlines, focus-only play guard, pause and disconnect passed. No playback was started.');
})().catch(e=>{console.error(e);process.exitCode=1;});
