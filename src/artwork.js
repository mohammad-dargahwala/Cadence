'use strict';
const {normalized,sameArtist,matchingAlbums,resolveCover,limitedJSON}=require('../public/artwork-catalog');

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
