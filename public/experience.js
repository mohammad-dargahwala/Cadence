(function () {
  'use strict';
  const defaults = { minimalist:false, background:true, motion:true, wave:true, cursor:false, details:true, clickSounds:true, musicMode:'off', songName:true };
  const store = window.CadenceStore;
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let prefs = {...defaults}, timer = { signedIn:false, running:false, mode:'focus', view:'timer' };
  let account = null, token = null, track = null, playing = false, message = '', pollId, deadlineId;
  let wanted = true, lastAllowed = false, receivedTimer = false, queue = Promise.resolve(), retryAt = 0, refreshing;
  const get = (key, fallback) => { try { return JSON.parse(sessionStorage.getItem(key)) || fallback; } catch { return fallback; } };
  const put = (key, value) => { try { value === null ? sessionStorage.removeItem(key) : sessionStorage.setItem(key, JSON.stringify(value)); } catch {} };
  const allowed = () => timer.signedIn && timer.running && timer.mode === 'focus' && !timer.alarm && timer.remaining > 0 && (!timer.deadline || Date.now() < timer.deadline) && prefs.musicMode !== 'off';
  const active = () => !!token && timer.signedIn && prefs.musicMode !== 'off';
  const updateMessage = text => { message = text; document.querySelectorAll('.music-status').forEach(el => { el.textContent = text; }); };
  function save(patch) { store.saveSettings({ experience: { ...prefs, ...patch } }); }
  function apply(st) {
    const wasEnabled=prefs.musicMode!=='off';
    prefs = {...defaults, ...(st.settings.experience || {})};
    if(wasEnabled && prefs.musicMode==='off' && token) enqueue(async()=>{ if(token) await api('/pause','PUT'); playing=false; renderPlayer(); });
    for (const key of ['background','wave','details','clickSounds']) root.dataset[key] = String(prefs[key]);
    root.dataset.cursor = String(prefs.cursor && matchMedia('(pointer:fine)').matches);
    root.dataset.motion = String(prefs.motion && !reduced.matches);
    if (account !== st.workspaceId) {
      if (token && playing) fetch('https://api.spotify.com/v1/me/player/pause',{method:'PUT',headers:{Authorization:'Bearer '+token.access_token},keepalive:true}).catch(()=>{});
      token = null; track = null; playing = false;
      account = st.workspaceId;
      const saved = get('cadence.spotify.tokens', null);
      if (saved && saved.owner === account) token = saved;
      else put('cadence.spotify.tokens', null);
      wanted = true;
    }
    document.querySelectorAll('cadence-settings').forEach(el => el.sync());
    schedulePoll(); renderPlayer(); reconcile(); drawAtmosphere(0);
  }
  async function accessToken() {
    if (!token) throw Error('Connect Spotify in Settings first.');
    if (token.expiresAt > Date.now() + 60000) return token.access_token;
    if (!refreshing) {
      const previous = token;
      refreshing = fetch('https://accounts.spotify.com/api/token', {method:'POST',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:previous.refresh_token,client_id:previous.clientId})})
        .then(async r => { if (!r.ok) throw Error('Spotify connection expired. Reconnect in Settings.'); return r.json(); })
        .then(data => { if (token !== previous) throw Error('Spotify account changed.'); token = {...previous,...data,expiresAt:Date.now()+data.expires_in*1000}; put('cadence.spotify.tokens', token); return token.access_token; })
        .catch(e => { if(token===previous) { token = null; put('cadence.spotify.tokens',null); } throw e; }).finally(() => { refreshing = null; });
    }
    return refreshing;
  }
  async function api(path, method='GET', guard) {
    if (Date.now() < retryAt) throw Error('Spotify is busy. Playback controls will retry shortly.');
    const owner = account, auth = await accessToken();
    if (owner !== account || (guard && !guard())) return null;
    const r = await fetch('https://api.spotify.com/v1/me/player'+path,{method,signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+auth}});
    if (r.status === 204) return null;
    if (r.status === 429) { retryAt = Date.now() + Math.max(1, Number(r.headers.get('Retry-After')) || 30)*1000; throw Error('Spotify is busy. Playback controls will retry shortly.'); }
    if (r.status === 401) { if(token && owner === account) token.expiresAt=0; throw Error('Spotify session expired. Try again to refresh it.'); }
    if (r.status === 403) throw Error('Spotify playback needs Premium and access to this developer app. Check the setup instructions.');
    if (r.status === 404) throw Error('Open Spotify and play a song once to choose an active device, then return to Cadence.');
    if (!r.ok) throw Error('Spotify could not complete that action. Try again.');
    return r.json();
  }
  function enqueue(fn) {
    queue = queue.catch(()=>{}).then(fn).catch(e => updateMessage(e.message));
    return queue;
  }
  function reconcile(force=false) {
    const yes = allowed();
    if (!force && yes === lastAllowed) return;
    lastAllowed = yes;
    if (!active()) return;
    if (!yes) {
      // Pause immediately, even if a preceding resume request is still pending.
      api('/pause','PUT').then(()=>{playing=false;renderPlayer();updateMessage('Music paused · focus periods only.');}).catch(e=>updateMessage(e.message));
      return;
    }
    enqueue(async () => {
      if (!active()) return;
      const play = allowed() && wanted;
      await api(play ? '/play' : '/pause','PUT',()=>active() && (play ? allowed() && wanted : !allowed() || !wanted));
      playing = play && allowed();
      // A focus interval may have ended while a resume request was in flight.
      if (play && !allowed()) { await api('/pause','PUT'); playing=false; }
      updateMessage(allowed() ? (wanted ? 'Music follows your focus timer.' : 'Music paused for this focus block.') : 'Music paused · focus periods only.');
      renderPlayer();
    });
  }
  async function poll() {
    if (!active() || document.hidden || Date.now() < retryAt) return;
    try {
      const owner = account;
      const data = await api('');
      if (owner !== account || !active()) return;
      track = data && data.item || null; playing=!!(data && data.is_playing);
      if (playing && !allowed()) reconcile(true);
      if (!track) updateMessage('Open Spotify and select a song on the device you want to use.');
      renderPlayer();
    } catch(e) { updateMessage(e.message); }
  }
  function schedulePoll() {
    clearInterval(pollId);
    if(active()) pollId=setInterval(poll,5000);
  }
  const random = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,'0')).join('');
  const base64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  function redirectURI() { return location.origin + '/?spotify=callback'; }
  async function connect(clientId) {
    if(!/^[a-f0-9]{32}$/i.test(clientId)) return updateMessage('Paste the 32-character public Client ID from your Spotify app.');
    if (!account) return updateMessage('Sign in to Cadence first.');
    try {
      const verifier=random(), state=random();
      const challenge=base64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
      put('cadence.spotify.auth',{verifier,state,clientId,owner:account,at:Date.now(),redirect:redirectURI()});
      localStorage.setItem('cadence.spotify.clientId',clientId);
      const query=new URLSearchParams({client_id:clientId,response_type:'code',redirect_uri:redirectURI(),state,code_challenge_method:'S256',code_challenge:challenge,scope:'user-read-playback-state user-modify-playback-state'});
      location.assign('https://accounts.spotify.com/authorize?'+query);
    } catch { updateMessage('Spotify setup could not start. Allow session storage and use HTTPS or a loopback address.'); }
  }
  async function callback() {
    const params=new URLSearchParams(location.search);
    if(params.get('spotify')!=='callback') return;
    const pending=get('cadence.spotify.auth',null);
    put('cadence.spotify.auth',null);
    history.replaceState(null,'',location.pathname);
    if(!pending || params.get('state')!==pending.state || pending.owner!==account || Date.now()-pending.at>600000) return updateMessage('Spotify sign-in expired or could not be verified. Connect again in Settings.');
    if(params.get('error') || !params.get('code')) return updateMessage('Spotify connection was cancelled. You can reconnect in Settings.');
    try {
      const r=await fetch('https://accounts.spotify.com/api/token',{method:'POST',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code:params.get('code'),redirect_uri:pending.redirect,client_id:pending.clientId,code_verifier:pending.verifier})});
      if(!r.ok) throw Error('Spotify sign-in failed. Check the Client ID and exact redirect URL, then connect again.');
      const data=await r.json();
      if(account!==pending.owner) return;
      token={...data,owner:account,clientId:pending.clientId,expiresAt:Date.now()+data.expires_in*1000};
      put('cadence.spotify.tokens',token);
      save({musicMode:prefs.musicMode==='off'?'full':prefs.musicMode});
      updateMessage('Connected. Open Spotify and select a song, then start a focus block.');
      await poll(); reconcile(true);
    } catch(e) { updateMessage(e.message); }
  }
  async function disconnect() {
    await enqueue(async()=>{ if(token) await api('/pause','PUT'); });
    token=null; track=null; playing=false; put('cadence.spotify.tokens',null);
    clearInterval(pollId); renderPlayer(); updateMessage('Disconnected from Spotify on this tab.');
    document.querySelectorAll('cadence-settings').forEach(el=>el.sync());
  }
  const icons = {
    previous:'M6 3h2v18H6zm3 9 12-9v18z', next:'M16 3h2v18h-2zM3 3l12 9-12 9z',
    play:'M7 3v18l14-9z', pause:'M6 3h4v18H6zm8 0h4v18h-4z',
    back:'M10 4 2 12l8 8v-6c5 0 8 2 11 6-1-9-5-12-11-12z',forward:'m14 4 8 8-8 8v-6c-5 0-8 2-11 6 1-9 5-12 11-12z'
  };
  function svg(name) { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="'+icons[name]+'"/></svg>'; }
  let player;
  function renderPlayer() {
    if(!player) {
      player=document.createElement('aside'); player.id='cadence-music'; player.setAttribute('aria-label','Focus music player');
      player.innerHTML='<a class="music-art-link" target="_blank" rel="noopener" aria-label="Open album in Spotify"><img class="music-art" alt="Album artwork" hidden><span class="music-placeholder" aria-hidden="true">♫</span></a><div class="music-body"><a class="music-brand" href="https://open.spotify.com" target="_blank" rel="noopener">◉ SPOTIFY</a><a class="music-title" target="_blank" rel="noopener"></a><div class="music-artist"></div><div class="music-controls"></div></div>';
      const controls=player.querySelector('.music-controls');
      for(const [action,label] of [['previous','Previous track'],['back','Rewind 15 seconds'],['play','Play or pause'],['forward','Forward 15 seconds'],['next','Next track']]) {
        const b=document.createElement('button'); b.dataset.action=action; b.title=label; b.setAttribute('aria-label',label); b.innerHTML=svg(action); if(action==='back'||action==='forward') b.className='seek-control';
        b.onclick=()=>control(action); controls.append(b);
      }
      document.body.append(player);
    }
    player.hidden=!timer.signedIn || prefs.musicMode==='off' || timer.view!=='timer';
    player.dataset.mode=prefs.musicMode;
    const image=player.querySelector('img'), title=player.querySelector('.music-title');
    const art=track && track.album && track.album.images && track.album.images[0];
    image.hidden=!art; if(art && /^https:\/\//.test(art.url)) image.src=art.url;
    player.querySelector('.music-placeholder').hidden=!!art;
    player.querySelector('.music-art-link').href=track && track.external_urls && track.external_urls.spotify || 'https://open.spotify.com';
    title.textContent=track ? track.name : token ? 'Choose a song in Spotify' : 'Set up music in Settings';
    title.href=track && track.external_urls && track.external_urls.spotify || 'https://open.spotify.com';
    title.onclick=!token ? e=>{e.preventDefault();const settings=Array.from(document.querySelectorAll('nav button')).find(b=>b.textContent.trim()==='Settings');if(settings)settings.click();}:null;
    title.hidden=!prefs.songName || prefs.musicMode==='hide';
    player.querySelector('.music-artist').textContent=track ? track.artists.map(a=>a.name).join(', ') : 'Plays during focus. Pauses for breaks.';
    player.querySelectorAll('button').forEach(b=>{ b.disabled=!token || (!allowed() && b.dataset.action==='play'); });
    const play=player.querySelector('[data-action=play]'); play.innerHTML=svg(playing?'pause':'play'); play.setAttribute('aria-label',playing?'Pause music':'Play music');
  }
  function control(action) {
    if(!token) return;
    enqueue(async()=>{
      if(action==='play') {
        if(!allowed()) return;
        wanted=!playing;
        await api(wanted?'/play':'/pause','PUT',()=>active() && (!wanted || allowed()));
        playing=wanted && allowed();
        if(wanted && !allowed()) await api('/pause','PUT');
      } else if(action==='next'||action==='previous') {
        await api('/'+action,'POST',active);
        if(!allowed()) await api('/pause','PUT');
      } else {
        const state=await api('');
        if(state && state.item) await api('/seek?position_ms='+Math.max(0,Math.min(state.item.duration_ms-1,state.progress_ms+(action==='back'?-15000:15000))),'PUT',active);
      }
      renderPlayer(); await poll();
    });
  }
  class CadenceSettings extends HTMLElement {
    connectedCallback() {
      this.innerHTML=`<div class="experience-grid"><section class="ex-card"><div class="ex-eyebrow">LESS, AT YOUR OWN PACE</div><h2>Minimalist</h2><p>A quiet canvas, or a little atmosphere. Make space for the way you focus.</p><div class="visual-toggles"></div></section><section class="ex-card"><div class="ex-eyebrow">YOUR FOCUS SOUNDTRACK</div><h2>Spotify</h2><p>Music plays while focus is running. Pausing, resetting, finishing an interval or starting a break pauses it too.</p><label class="ex-row">Player style<select data-pref="musicMode"><option value="off">Off</option><option value="hide">Hide · controls only</option><option value="minimalist">Minimalist</option><option value="full">Full player</option><option value="artwork">Album cover only</option></select></label><label class="ex-row">Show song name<input type="checkbox" data-pref="songName"></label><div class="music-status" role="status"></div><details class="ex-setup"><summary>Connect Spotify · setup</summary><p style="margin-top:12px">Requires Spotify Premium. In development mode, the app owner needs Premium and each listener must be on the app’s user allowlist.</p><ol><li>Open the <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">Spotify Developer Dashboard</a> and create an app with Web API access.</li><li>Add this exact redirect URI:<br><code class="redirect-uri"></code></li><li>Add your Spotify account under User Management, if required.</li><li>Copy the public Client ID below and connect. Keep the client secret private; Cadence does not need it.</li><li>Open Spotify, choose a song and an active playback device, then start your focus timer here.</li></ol><label>Public Client ID<input type="text" class="spotify-client" placeholder="32-character Client ID" autocomplete="off" spellcheck="false"></label><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="ex-button primary connect">Connect Spotify</button><button class="ex-button disconnect">Disconnect</button></div><p style="margin:12px 0 0">The player controls your active Spotify device. Authorization stays in this browser tab and is never synced to your Cadence account. Keep Cadence open for timer automation.</p></details></section></div>`;
      for(const [key,label,help] of [
        ['minimalist','Minimalist mode','Turn off decoration in one step. Individual choices below remain yours.'],
        ['background','Theme background','A living scene made for your selected theme.'],
        ['motion','Flowing motion','Slow movement. Your system’s reduced motion preference takes priority.'],
        ['wave','Timer wave','Show the liquid progress inside the timer.'],
        ['cursor','Cursor effects','A magnetic cursor on devices with a mouse.'],
        ['details','Timer details','Show round markers and the pinned task.'],
        ['clickSounds','Interface sounds','Quiet feedback for clicks. The completion alarm has its own controls.']
      ]) {
        const l=document.createElement('label'); l.className='ex-row';
        const span=document.createElement('span'); span.textContent=label;
        const small=document.createElement('small'); small.textContent=help; span.append(small);
        const input=document.createElement('input'); input.type='checkbox'; input.dataset.pref=key; l.append(span,input); this.querySelector('.visual-toggles').append(l);
      }
      this.querySelector('.redirect-uri').textContent=redirectURI();
      try { this.querySelector('.spotify-client').value=localStorage.getItem('cadence.spotify.clientId')||''; } catch {}
      this.addEventListener('change',e=>{
        const key=e.target.dataset.pref; if(!key) return;
        const value=e.target.type==='checkbox'?e.target.checked:e.target.value;
        if(key==='minimalist') save(value ? {minimalist:true,background:false,motion:false,wave:false,cursor:false,details:false,clickSounds:false} : {minimalist:false,background:true,motion:true,wave:true,details:true,clickSounds:true});
        else {
          save({[key]:value,...(['background','motion','wave','cursor','details','clickSounds'].includes(key)?{minimalist:false}:{})});
        }
      });
      this.querySelector('.connect').onclick=()=>connect(this.querySelector('.spotify-client').value.trim());
      this.querySelector('.disconnect').onclick=disconnect;
      this.sync();
    }
    sync() {
      this.querySelectorAll('[data-pref]').forEach(el=>{ if(el.type==='checkbox') el.checked=!!prefs[el.dataset.pref]; else el.value=prefs[el.dataset.pref]; });
      const status=this.querySelector('.music-status'); if(status) status.textContent=message || (token?'Connected · focus periods only.':'Connect your account below to enable playback.');
      const b=this.querySelector('.disconnect'); if(b) b.disabled=!token;
    }
  }
  customElements.define('cadence-settings',CadenceSettings);

  // Original procedural scenes: light fields, layered dunes, petals, and currents.
  // No remote images or animated video downloads are needed.
    let frame=0, lastFrame=0, lastScene='', canvas, ctx;
  function drawAtmosphere(now) {
    canvas=document.getElementById('atmosphere'); if(!canvas) return;
    ctx=canvas.getContext('2d'); if(!ctx) return;
    const theme=root.dataset.theme||'graphite', motion=root.dataset.motion!=='false';
    const scene=theme+innerWidth+innerHeight+prefs.background+motion;
    if(!prefs.background || document.hidden || (!motion && scene===lastScene) || (motion && now && now-lastFrame<50)) return;
    lastFrame=now; lastScene=scene;
    const w=innerWidth,h=innerHeight,dpr=Math.min(devicePixelRatio||1,1.5);
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    const t=motion?now/1000:0;
    function glow(x,y,r,color) { const g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,color);g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.fillRect(0,0,w,h); }
    function ribbon(base,amp,phase,color) {
      ctx.beginPath();ctx.moveTo(-20,h+20);
      for(let x=-20;x<=w+20;x+=12) ctx.lineTo(x,h*base+Math.sin(x/w*5+phase)*amp+Math.cos(x/w*9+phase*.6)*amp*.25);
      ctx.lineTo(w+20,h+20);ctx.closePath();ctx.fillStyle=color;ctx.fill();
    }
    if(theme==='solstice') {
      glow(w*.75,h*.27,Math.max(w,h)*.62,'#e9867140');glow(w*.18,h*.7,w*.5,'#b64e6230');
      const g=ctx.createLinearGradient(0,h*.08,0,h*.45);g.addColorStop(0,'#ffdfab90');g.addColorStop(1,'#ff9c6b05');
      ctx.fillStyle=g;ctx.beginPath();ctx.arc(w*.73,h*.29,Math.min(w,h)*.17,0,Math.PI*2);ctx.fill();
      for(let i=0;i<7;i++) ribbon(.61+i*.063,35+i*4,t*.025+i*.65,['#ae5f6838','#90435840','#70344960','#53273c70','#3c203280','#301c2d99','#241725bb'][i]);
    } else if(theme==='sakura') {
      glow(w*.2,h*.28,w*.6,'#e7a7cb60');glow(w*.85,h*.68,w*.52,'#b6acd255');
      for(let i=0;i<5;i++) ribbon(.66+i*.09,25,t*.018+i,'#a182af09');
      for(let i=0;i<28;i++) {
        const x=((i*137.5+t*(3+i%4))%(w+80))-40,y=((i*97+t*(2+i%3))%(h+80))-40;
        ctx.save();ctx.translate(x,y);ctx.rotate(i+t*.04);ctx.fillStyle=['#ca83a52a','#f1b2ca40','#a894c52a'][i%3];ctx.beginPath();ctx.ellipse(0,0,4+i%4,2+i%3,.4,0,Math.PI*2);ctx.fill();ctx.restore();
      }
    } else if(theme==='tidal') {
      glow(w*.8,h*.15,w*.6,'#165e8555');glow(w*.12,h*.9,w*.7,'#0e928c38');
      for(let i=0;i<24;i++) {
        ctx.beginPath();for(let x=0;x<=w+12;x+=12) {const y=h*(.38+i*.036)+Math.sin(x/w*7+t*.065+i*.18)*(32+i*2)+Math.sin(x/w*3-t*.035)*35;x?ctx.lineTo(x,y):ctx.moveTo(x,y);}
        ctx.strokeStyle=i%4===0?'#6dcdd42b':'#62a7cc12';ctx.lineWidth=i%4===0?1.4:.7;ctx.stroke();
      }
    } else if(theme==='aurora') {
      glow(w*.2+Math.sin(t*.02)*w*.1,h*.22,w*.65,'#23b79724');glow(w*.85,h*.55,w*.6,'#7450ba28');
      for(let i=0;i<6;i++) {
        const band=(x)=>h*.42+Math.sin(x/w*4+t*.035+i*.12)*h*.22+Math.sin(x/w*8-t*.02)*h*.055;
        ctx.save();ctx.filter='blur(14px)';ctx.beginPath();
        for(let x=-w*.3;x<=w*1.3;x+=20) {const y=band(x)+i*9; x===-w*.3?ctx.moveTo(x,y):ctx.lineTo(x,y);}
        for(let x=w*1.3;x>=-w*.3;x-=20) ctx.lineTo(x,band(x)+i*9+30+i*5);
        ctx.closePath();const g=ctx.createLinearGradient(0,0,w,h*.5);g.addColorStop(0,'#51edb900');g.addColorStop(.25,'#51edb925');g.addColorStop(.65,'#68c9db20');g.addColorStop(.85,'#9d81fb20');g.addColorStop(1,'#9d81fb00');ctx.fillStyle=g;ctx.fill();ctx.restore();
      }
      for(let i=0;i<35;i++){ctx.fillStyle='#d5f7ff'+(i%3===0?'55':'24');ctx.beginPath();ctx.arc((i*211.73)%w,(i*91.17)%(h*.68),i%3===0?1.1:.6,0,Math.PI*2);ctx.fill();}
    } else {
      const colors=theme==='aurora'?['#51edb9','#9d81fb','#3a7cbf']:theme==='ember'?['#d98044','#bd5264','#824d35']:theme==='clay'?['#ba8466','#a7ba8b','#cebda1']:theme==='mist'?['#83a7de','#a1c8cb','#c1b2df']:['#50b99d','#5b88ca','#8364b0'];
      glow(w*.1,h*.1,w*.6,colors[0]+'20');glow(w*.9,h*.7,w*.6,colors[1]+'18');
      for(let i=0;i<8;i++) {
        ctx.save();ctx.translate(w*.5,h*.4);ctx.rotate(-.35+Math.sin(t*.015)*.1);ctx.translate(-w*.5,-h*.4);
        const g=ctx.createLinearGradient(0,0,w,h);g.addColorStop(0,colors[0]+'00');g.addColorStop(.4,colors[i%3]+'20');g.addColorStop(1,colors[1]+'00');
        ribbon(.25+i*.025,70+i*4,t*.05+i*.13,g);ctx.restore();
      }
    }
  }
  function animate(now) { drawAtmosphere(now); frame=requestAnimationFrame(animate); }
  requestAnimationFrame(animate);
  window.addEventListener('resize',()=>{lastScene='';drawAtmosphere(0);});
  reduced.addEventListener('change',()=>apply(store.getState()));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){lastScene='';poll();reconcile(true);}});
  window.addEventListener('online',()=>{poll();reconcile(true);});
  window.addEventListener('pagehide',()=>{ if(token && playing) { fetch('https://api.spotify.com/v1/me/player/pause',{method:'PUT',headers:{Authorization:'Bearer '+token.access_token},keepalive:true}).catch(()=>{}); } });
  window.CadenceExperience={
    timer(next) {
      const wasFocus=timer.mode==='focus' && timer.running;
      timer=next;
      if(!wasFocus && next.mode==='focus' && next.running) wanted=true;
      clearTimeout(deadlineId);
      if(next.running && next.mode==='focus' && next.deadline) deadlineId=setTimeout(()=>reconcile(true),Math.max(0,next.deadline-Date.now()));
      reconcile(!receivedTimer);receivedTimer=true;renderPlayer();
    },
    getPreferences:()=>({...prefs})
  };
  store.subscribe(apply);apply(store.getState());
  if(window.CadenceTimerSnapshot) window.CadenceExperience.timer(window.CadenceTimerSnapshot);
  store.ready.then(callback);
})();
