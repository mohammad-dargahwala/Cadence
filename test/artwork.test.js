'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {normalized,sameArtist,matchingAlbums,resolveCover,handleArtwork}=require('../src/artwork');
const id='12345678-1234-1234-1234-123456789abc';
const group={id,title:'Discovery','artist-credit':[{name:'Daft Punk',artist:{name:'Daft Punk'}}]};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
function transport(replies){
  const calls=[];
  const fetcher=async(url,options)=>{calls.push(url);assert(options.headers['User-Agent'].startsWith('Cadence/'));assert(['musicbrainz.org','coverartarchive.org'].includes(new URL(url).hostname));if(!replies.length)throw Error('Unexpected lookup');const next=replies.shift();return typeof next==='function'?next(url):json(next);};
  return {fetcher,calls,pause:async()=>{}};
}
function cache(){
  const data=new Map();return {async match(req){return data.get(req.url)?.clone();},async put(req,r){data.set(req.url,r.clone());}};
}
const request=(album='Discovery',artist='Daft Punk')=>new Request('https://cadence.test/api/artwork',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({album,artist})});
(async()=>{
  assert.equal(normalized('بعدا عالبال'),normalized('بعداعالبال'));
  assert(sameArtist('Fadel Chaker','Fadl Shaker'),'verified transliteration variants agree');
  assert.equal(matchingAlbums([{title:'Baada Al Bal',id}], 'بعداعالبال')[0].id,id,'unique cross-script match within a verified artist');
  assert.equal(matchingAlbums([{title:'Baada Al Bal',id},{title:'Baada Al Bal',id:'other'}], 'بعداعالبال').length,0,'ambiguous phonetic matches are rejected');
  const hit=transport([{'release-groups':[group]},{images:[{front:true,approved:true,image:'https://untrusted.example/ignored'}]}]);
  const art=await resolveCover({album:'Discovery',artist:'Daft Punk'},hit);
  assert.equal(art.url,'https://coverartarchive.org/release-group/'+id+'/front-250');
  assert.equal(art.sourceUrl,'https://musicbrainz.org/release-group/'+id);assert.equal(hit.calls.length,2);
  const direct=transport([{'release-groups':[group]}]);
  assert((await resolveCover({album:'Discovery',artist:'Daft Punk'},{...direct,verifyImages:false})).url);
  assert.equal(direct.calls.length,1,'browser image loading does not depend on a second cover-metadata request');
  const browser={window:{},TextDecoder,Uint8Array,URLSearchParams,AbortSignal};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/artwork-catalog.js'),'utf8'),browser);
  const browserArt=await browser.CadenceArtworkCatalog.resolveCover({album:'Discovery',artist:'Daft Punk'},{verifyImages:false,fetcher:async(url,options)=>{assert.equal(options.headers['User-Agent'],undefined,'browser lookup uses normal browser headers');return json({'release-groups':[group]});}});
  assert.equal(browserArt.url,art.url,'browser and server share the same matching rules');
  const unrelated=transport([{'release-groups':[{...group,'artist-credit':[{name:'Wrong artist'}]}]},{artists:[]}]);
  assert.equal((await resolveCover({album:'Discovery',artist:'Daft Punk'},unrelated)).url,null,'same album title from another artist is not used');
  const alias=transport([{'release-groups':[]},{artists:[{id,name:'Alternate credit',aliases:[{name:'Daft Punk'}]}]},{'release-groups':[group]},{images:[{front:true}]}]);
  assert((await resolveCover({album:'Discovery',artist:'Daft Punk'},alias)).url,'artist aliases can lead to the correct album');
  const options={...transport([{'release-groups':[group]},{images:[{front:true}]}]),cache:cache()};
  assert((await (await handleArtwork(request(),options)).json()).url);
  const count=options.calls.length;assert((await (await handleArtwork(request(),options)).json()).url);assert.equal(options.calls.length,count,'successful lookups are cached');
  const absent={...transport([{'release-groups':[]},{artists:[]}]),cache:cache()};
  assert.equal((await (await handleArtwork(request(),absent)).json()).url,null);
  await handleArtwork(request(),absent);assert.equal(absent.calls.length,2,'missing covers are negatively cached');
  const down={...transport([()=>json({error:'busy'},503)]),cache:cache()};
  const unavailable=await handleArtwork(request(),down);assert.equal(unavailable.status,200);
  assert.equal((await unavailable.json()).retryAfter,60);assert.equal(unavailable.headers.get('cache-control'),'no-store','provider outages are retried, not cached as missing albums');
  const invalid=transport([]);
  assert.equal((await handleArtwork(request('','Artist'),invalid)).status,400);
  assert.equal((await handleArtwork(request('x'.repeat(201),'Artist'),invalid)).status,400);assert.equal(invalid.calls.length,0);
  const huge={...transport([()=>new Response('x'.repeat(524289))]),cache:cache()};
  assert.equal((await (await handleArtwork(request(),huge)).json()).retryAfter,60,'oversized upstream responses are bounded');
  console.log('Artwork lookup passed: album/artist matching, Unicode/transliteration, safe URLs, positive/negative caches, bounded responses and graceful outages.');
})().catch(e=>{console.error(e);process.exitCode=1;});
