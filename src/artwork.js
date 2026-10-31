'use strict';
// Optional, metadata-only cover lookup. No Spotify credentials or timer data.
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const AGENT='Cadence/1.0 (https://cadence.mdargahwala.tech)';
// Verified public alias, needed when the search index misses the Latin credit.
// https://musicbrainz.org/artist/b3f5bc93-c962-458f-961e-d861e6e0c828/aliases
const ARTIST_HINTS=[{name:'Fadel Chaker',id:'b3f5bc93-c962-458f-961e-d861e6e0c828'}];
function normalized(value){
  return String(value||'').normalize('NFKD').toLowerCase().replace(/\p{M}/gu,'')
    .replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/ـ/g,'').replace(/[^\p{L}\p{N}]/gu,'');
}
function phonetic(value){return normalized(value).replace(/ch/g,'sh').replace(/[aeiou]/g,'');}
function names(entity){
  return [entity.name,...(entity.aliases||[]).map(a=>a.name)].filter(Boolean);
}
function sameArtist(a,b){
  return normalized(a)===normalized(b)||(/^[a-z\s.'-]+$/i.test(a)&&/^[a-z\s.'-]+$/i.test(b)&&phonetic(a).length>=5&&phonetic(a)===phonetic(b));
}
function creditsMatch(entity,artist){
  return (entity['artist-credit']||[]).some(c=>[c.name,...names(c.artist||{})].some(n=>n&&sameArtist(n,artist)));
}
function albumMatch(entity,album){return [entity.title,...(entity.aliases||[]).map(a=>a.name)].some(n=>normalized(n)===normalized(album));}
function albumSound(value){
  const arabic={'ا':'a','ب':'b','ت':'t','ث':'th','ج':'j','ح':'h','خ':'kh','د':'d','ذ':'dh','ر':'r','ز':'z','س':'s','ش':'sh','ص':'s','ض':'d','ط':'t','ظ':'z','ع':'','غ':'gh','ف':'f','ق':'q','ك':'k','ل':'l','م':'m','ن':'n','ه':'h','و':'w','ي':'y','ء':''};
  return normalized(value).replace(/[\u0600-\u06ff]/g,c=>arabic[c]??c).replace(/[aeiou]/g,'');
}
function matchingAlbums(groups,album){
  const exact=groups.filter(g=>albumMatch(g,album));if(exact.length)return exact;
  // A conservative cross-script match is accepted only for one album within
  // an already verified artist, never across unrelated artists.
  const sound=albumSound(album);
  if(sound.length<5)return [];
  const matches=groups.filter(g=>/[\u0600-\u06ff]/.test(album)!==/[\u0600-\u06ff]/.test(g.title)&&albumSound(g.title)===sound);
  return matches.length===1?matches:[];
}
function quoted(s){return '"'+s.replace(/([\\"])/g,'\\$1')+'"';}
function catalogURL(kind,params){return 'https://musicbrainz.org/ws/2/'+kind+'?'+new URLSearchParams({...params,fmt:'json'});}
async function limitedJSON(response,limit=524288){
  if(response.ok===false)throw Error('artwork_upstream_'+response.status);
  if(Number(response.headers.get('content-length'))>limit)throw Error('artwork_response_too_large');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw Error('artwork_response_too_large');}chunks.push(value);}
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function resolveCover({album,artist},{fetcher=fetch,pause=ms=>new Promise(r=>setTimeout(r,ms))}={}){
  let lastMusicBrainz=0;
  async function read(url){
    if(url.startsWith('https://musicbrainz.org/')){
      const wait=1100-(Date.now()-lastMusicBrainz);if(wait>0)await pause(wait);
      lastMusicBrainz=Date.now();
    }
    return limitedJSON(await fetcher(url,{headers:{Accept:'application/json','User-Agent':AGENT},signal:AbortSignal.timeout(6500),cf:{cacheEverything:true,cacheTtl:86400}}));
  }
  const hint=ARTIST_HINTS.find(a=>sameArtist(a.name,artist));
  let candidates=[];
  if(!hint){
    const first=await read(catalogURL('release-group',{query:'releasegroup:'+quoted(album)+' AND artist:'+quoted(artist),limit:'5'}));
    candidates=(first['release-groups']||[]).filter(g=>albumMatch(g,album)&&creditsMatch(g,artist));
  }
  if(!candidates.length){
    // Spotify and MusicBrainz often use different transliterations. Resolve
    // artist aliases first, then compare compact Unicode album names/aliases.
    const found=hint?null:await read(catalogURL('artist',{query:'artist:'+quoted(artist)+' OR alias:'+quoted(artist),limit:'5'}));
    const match=hint||(found.artists||[]).find(a=>UUID.test(a.id)&&names(a).some(n=>sameArtist(n,artist)));
    if(match){
      const albums=await read(catalogURL('release-group',{artist:match.id,inc:'aliases',limit:'100'}));
      candidates=matchingAlbums(albums['release-groups']||[],album);
    }
  }
  for(const group of candidates.slice(0,2)){
    if(!UUID.test(group.id))continue;
    let art;
    try{art=await read('https://coverartarchive.org/release-group/'+group.id);}
    catch(e){if(e.message==='artwork_upstream_404')continue;throw e;}
    if((art.images||[]).some(i=>i.front&&i.approved!==false)){
      return {url:'https://coverartarchive.org/release-group/'+group.id+'/front-250',source:'Cover Art Archive',sourceUrl:'https://musicbrainz.org/release-group/'+group.id};
    }
  }
  return {url:null};
}
async function handleArtwork(request,{cache=globalThis.caches?.default,fetcher=fetch,pause}={}){
  const url=new URL(request.url);
  const response=(body,status=200,ttl=0)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':ttl?'public, max-age='+ttl:'no-store','X-Content-Type-Options':'nosniff'}});
  let input;
  try{input=request.method==='POST'?await limitedJSON(request,2048):Object.fromEntries(url.searchParams);}
  catch{return response({error:'bad_artwork_query'},400);}
  const album=typeof input?.album==='string'?input.album.trim():'',artist=typeof input?.artist==='string'?input.artist.trim():'';
  if(!normalized(album)||!normalized(artist)||album.length>200||artist.length>200)return response({error:'bad_artwork_query'},400);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalized(artist)+'\n'+normalized(album)));
  const key=new Request(url.origin+'/__artwork-cache/'+Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join(''));
  try{
    if(cache){const hit=await cache.match(key);if(hit)return hit;}
    const art=await resolveCover({album,artist},{fetcher,pause}),result=response(art,200,art.url?86400:900);
    if(cache)await cache.put(key,result.clone());
    return result;
  }catch(error){
    // A busy catalog must not interrupt song metadata, controls, or playback.
    const reason=/^artwork_[a-z_0-9]+$/.test(error?.message||'')?error.message:error?.name==='TimeoutError'?'timeout':'network_error';
    console.warn('[artwork] lookup_unavailable',reason);
    return response({url:null,retryAfter:60});
  }
}
module.exports={normalized,sameArtist,matchingAlbums,resolveCover,handleArtwork};
