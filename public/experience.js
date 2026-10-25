(function () {
  'use strict';
  const defaults = { minimalist:false, background:true, motion:true, followSystemMotion:false, flowSpeed:1, wave:true, cursor:false, details:true, clickSounds:true, musicMode:'off', songName:true, musicSource:'desktop' };
  const store = window.CadenceStore;
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let prefs = {...defaults}, timer = { signedIn:false, running:false, mode:'focus', view:'timer' };
  let account = null, token = null, track = null, playing = false, message = '', pollId, deadlineId;
  let wanted = true, lastAllowed = false, receivedTimer = false, queue = Promise.resolve(), retryAt = 0, refreshing;
  const get = (key, fallback) => { try { return JSON.parse(sessionStorage.getItem(key)) || fallback; } catch { return fallback; } };
  const put = (key, value) => { try { value === null ? sessionStorage.removeItem(key) : sessionStorage.setItem(key, JSON.stringify(value)); } catch {} };
  const BRIDGE='http://127.0.0.1:17842';
  let desktop=get('cadence.desktop.pair',null), desktopReady=false, heartbeatId, desktopControls={};
  const connected=()=>prefs.musicSource==='desktop'?desktopReady:!!token;
  const allowed = () => timer.signedIn && timer.running && timer.mode === 'focus' && !timer.alarm && timer.remaining > 0 && (!timer.deadline || Date.now() < timer.deadline) && prefs.musicMode !== 'off';
  const active = () => connected() && timer.signedIn && prefs.musicMode !== 'off';
  const updateMessage = text => { message = text; document.querySelectorAll('.music-status').forEach(el => { el.textContent = text; }); };
  function save(patch) { store.saveSettings({ experience: { ...prefs, ...patch } }); }
  function apply(st) {
    const wasEnabled=prefs.musicMode!=='off', previousSource=prefs.musicSource;
    prefs = {...defaults, ...(st.settings.experience || {})};
    if(wasEnabled && (prefs.musicMode==='off' || previousSource!==prefs.musicSource)) {
      if(previousSource==='desktop' && desktopReady) bridge('/timer',{allowed:false,deadline:0}).catch(()=>{});
      if(previousSource==='web' && token) fetch('https://api.spotify.com/v1/me/player/pause',{method:'PUT',headers:{Authorization:'Bearer '+token.access_token},keepalive:true}).catch(()=>{});
      playing=false;
    }
    for (const key of ['background','wave','details','clickSounds']) root.dataset[key] = String(prefs[key]);
    root.dataset.cursor = String(prefs.cursor && matchMedia('(pointer:fine)').matches);
    root.dataset.motion = String(prefs.motion && (!prefs.followSystemMotion || !reduced.matches));
    root.dataset.flowSpeed = String(Math.max(.35,Math.min(2,Number(prefs.flowSpeed)||1)));
    if (account !== st.workspaceId) {
      if(desktopReady) bridge('/disconnect',{}).catch(()=>{});
      desktopReady=false;
      if (token && playing) fetch('https://api.spotify.com/v1/me/player/pause',{method:'PUT',headers:{Authorization:'Bearer '+token.access_token},keepalive:true}).catch(()=>{});
      token = null; track = null; playing = false;
      account = st.workspaceId;
      if(desktop && desktop.owner!==account){desktop=null;put('cadence.desktop.pair',null);}
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
    if(prefs.musicSource==='desktop') return desktopAPI(path,method,guard);
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
    const yes = allowed(), previouslyAllowed=lastAllowed;
    if (!force && yes === lastAllowed) return;
    lastAllowed = yes;
    if (!active()) return;
    if (!yes) {
      if(prefs.musicSource==='desktop' && !previouslyAllowed) return;
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
      if (playing && !allowed() && prefs.musicSource!=='desktop') reconcile(true);
      if (playing && !allowed() && prefs.musicSource==='desktop') updateMessage('Timer idle · desktop playback is under your control.');
      if (!track) updateMessage('Open Spotify and select a song on the device you want to use.');
      renderPlayer();
    } catch(e) { updateMessage(e.message); }
  }
  function schedulePoll() {
    clearInterval(pollId);
    clearInterval(heartbeatId);
    if(active()) pollId=setInterval(poll,5000);
    if(active() && prefs.musicSource==='desktop') heartbeatId=setInterval(heartbeat,2000);
  }
  async function bridge(path,body,credentials=desktop) {
    if(!credentials) throw Error('Start and connect the desktop helper in Settings.');
    const r=await fetch(BRIDGE+path,{method:body?'POST':'GET',signal:AbortSignal.timeout(4500),headers:{'Content-Type':'application/json','X-Cadence-Key':credentials.key,'X-Cadence-Client':credentials.clientId},...(body?{body:JSON.stringify(body)}:{})});
    const data=await r.json();
    if(!r.ok) throw Error(data.error||'Desktop helper could not complete that action.');
    return data;
  }
  async function heartbeat() {
    if(!desktopReady || prefs.musicSource!=='desktop') return;
    try {await bridge('/timer',{allowed:allowed() && wanted,deadline:timer.deadline||0,background:document.hidden});}
    catch {desktopReady=false;clearInterval(heartbeatId);updateMessage('Desktop helper disconnected. Restart it and connect again in Settings.');renderPlayer();}
  }
  function desktopState(data) {
    desktopControls=data.controls||{};
    return data.available ? {is_playing:data.playing,progress_ms:data.positionMs,item:{name:data.title||'Spotify',duration_ms:data.durationMs,artists:[{name:data.artist||''}],album:{images:data.artwork?[{url:data.artwork}]:[]},external_urls:{spotify:'https://open.spotify.com'}}}:null;
  }
  async function desktopAPI(path,method,guard) {
    if(!desktopReady) throw Error('Connect the Windows desktop helper in Settings first.');
    if(guard && !guard()) return null;
    if(method==='GET') return desktopState(await bridge('/status'));
    const action=path.startsWith('/seek') ? (path.includes('direction=back')?'back':'forward') : path.slice(1);
    if(action==='play') {
      await heartbeat();
      if(!allowed() || !wanted || !desktopReady) return null;
    }
    if(action==='pause') await bridge('/timer',{allowed:false,deadline:0});
    return desktopState(await bridge('/command',{action}));
  }
  async function connectDesktop(key,activate=true) {
    if(!/^[A-Za-z0-9_-]{32}$/.test(key)) return updateMessage('Paste the current pairing code shown on the desktop helper page.');
    const credentials={key,owner:account,clientId:random().slice(0,32)};
    try {
      const data=await bridge('/pair',{},credentials);
      desktop=credentials;desktopReady=true;put('cadence.desktop.pair',desktop);
      save({musicSource:'desktop',musicMode:activate && prefs.musicMode==='off'?'full':prefs.musicMode});
      const state=desktopState(data);track=state&&state.item;playing=!!(state&&state.is_playing);
      updateMessage('Desktop connected · no Premium needed. Music follows your focus timer.');
      schedulePoll();await heartbeat();reconcile(true);renderPlayer();
      document.querySelectorAll('cadence-settings').forEach(el=>{el.sync();const keyInput=el.querySelector('.desktop-key');if(keyInput)keyInput.value='';});
    } catch(e) {updateMessage(e.message==='Failed to fetch'?'Start the helper and allow the browser’s local-network permission, then connect again.':e.message);}
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
      save({musicSource:'web',musicMode:prefs.musicMode==='off'?'full':prefs.musicMode});
      updateMessage('Connected. Open Spotify and select a song, then start a focus block.');
      await poll(); reconcile(true);
    } catch(e) { updateMessage(e.message); }
  }
  async function disconnect() {
    if(prefs.musicSource==='desktop') {
      if(desktopReady) {try{await bridge('/disconnect',{});}catch{}}
      desktop=null;desktopReady=false;put('cadence.desktop.pair',null);clearInterval(heartbeatId);clearInterval(pollId);track=null;playing=false;
      renderPlayer();updateMessage('Desktop disconnected.');document.querySelectorAll('cadence-settings').forEach(el=>el.sync());return;
    }
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
    image.hidden=!art; if(art && (/^https:\/\//.test(art.url) || (prefs.musicSource==='desktop' && /^data:image\/(png|jpeg);base64,/.test(art.url)))) image.src=art.url;
    player.querySelector('.music-placeholder').hidden=!!art;
    player.querySelector('.music-art-link').href=track && track.external_urls && track.external_urls.spotify || 'https://open.spotify.com';
    title.textContent=track ? track.name : connected() ? 'Choose a song in Spotify' : 'Set up music in Settings';
    title.href=track && track.external_urls && track.external_urls.spotify || 'https://open.spotify.com';
    title.onclick=!connected() ? e=>{e.preventDefault();const settings=Array.from(document.querySelectorAll('nav button')).find(b=>b.textContent.trim()==='Settings');if(settings)settings.click();}:null;
    title.hidden=!prefs.songName || prefs.musicMode==='hide';
    player.querySelector('.music-artist').textContent=track ? track.artists.map(a=>a.name).join(', ') : 'Plays during focus. Pauses for breaks.';
    player.querySelectorAll('button').forEach(b=>{
      const action=b.dataset.action;
      const nativeSupported=prefs.musicSource!=='desktop' || !track || (action==='play' ? desktopControls[playing?'pause':'play']!==false : desktopControls[action==='back'||action==='forward'?'seek':action]!==false);
      b.disabled=!connected() || (!allowed() && action==='play') || !nativeSupported;
    });
    const play=player.querySelector('[data-action=play]'); play.innerHTML=svg(playing?'pause':'play'); play.setAttribute('aria-label',playing?'Pause music':'Play music');
  }
  function control(action) {
    if(!connected()) return;
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
        if(prefs.musicSource==='desktop'){await api('/seek?direction='+action,'PUT',active);renderPlayer();await poll();return;}
        const state=await api('');
        if(state && state.item) await api('/seek?position_ms='+Math.max(0,Math.min(state.item.duration_ms-1,state.progress_ms+(action==='back'?-15000:15000))),'PUT',active);
      }
      renderPlayer(); await poll();
    });
  }
  class CadenceSettings extends HTMLElement {
    connectedCallback() {
      this.innerHTML=`<div class="experience-grid"><section class="ex-card"><div class="ex-eyebrow">LESS, AT YOUR OWN PACE</div><h2>Minimalist</h2><p>A quiet canvas, or a little atmosphere. Make space for the way you focus.</p><div class="visual-toggles"></div></section><section class="ex-card"><div class="ex-eyebrow">YOUR FOCUS SOUNDTRACK</div><h2>Spotify</h2><p>Music plays while focus is running. Pausing, resetting, finishing an interval or starting a break pauses it too.</p><label class="ex-row">Player style<select data-pref="musicMode"><option value="off">Off</option><option value="hide">Hide · controls only</option><option value="minimalist">Minimalist</option><option value="full">Full player</option><option value="artwork">Album cover only</option></select></label><label class="ex-row">Show song name<input type="checkbox" data-pref="songName"></label><div class="music-status" role="status"></div><details class="ex-setup"><summary>Connect Spotify · setup</summary><p style="margin-top:12px">Requires Spotify Premium. In development mode, the app owner needs Premium and each listener must be on the app’s user allowlist.</p><ol><li>Open the <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">Spotify Developer Dashboard</a> and create an app with Web API access.</li><li>Add this exact redirect URI:<br><code class="redirect-uri"></code></li><li>Add your Spotify account under User Management, if required.</li><li>Copy the public Client ID below and connect. Keep the client secret private; Cadence does not need it.</li><li>Open Spotify, choose a song and an active playback device, then start your focus timer here.</li></ol><label>Public Client ID<input type="text" class="spotify-client" placeholder="32-character Client ID" autocomplete="off" spellcheck="false"></label><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="ex-button primary connect">Connect Spotify</button><button class="ex-button disconnect">Disconnect</button></div><p style="margin:12px 0 0">The player controls your active Spotify device. Authorization stays in this browser tab and is never synced to your Cadence account. Keep Cadence open for timer automation.</p></details></section></div>`;
      const musicCard=this.querySelectorAll('.ex-card')[1];
      const sourceLabel=document.createElement('label');sourceLabel.className='ex-row';
      sourceLabel.innerHTML='<span>Connect through</span><select data-pref="musicSource"><option value="desktop">Windows desktop · Free</option><option value="web">Spotify Web API · Premium</option></select>';
      musicCard.insertBefore(sourceLabel,musicCard.querySelector('.ex-row'));
      const desktopSetup=document.createElement('div');desktopSetup.className='desktop-setup ex-setup';
      desktopSetup.innerHTML='<h3 style="font-size:13px;margin:0 0 8px">Desktop connection · no Premium needed</h3><p>Use Spotify on this Windows PC. Download and unzip the helper, then double-click Start-Cadence-Desktop.cmd. It runs in the background and opens a page with your pairing code.</p><a class="ex-button" href="/desktop/Cadence-Desktop.zip" download>Download desktop helper</a><ol><li>Start the helper and copy its pairing code.</li><li>Paste it below and connect. Allow local-network access if your browser asks.</li><li>Choose a song in Spotify, then start a focus interval.</li></ol><label>Pairing code<input type="text" class="desktop-key" placeholder="Code from the desktop helper" autocomplete="off" spellcheck="false"></label><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="ex-button primary connect-desktop">Connect desktop</button><a class="ex-button" href="http://127.0.0.1:17842/" target="_blank" rel="noopener">Open helper</a></div><p style="margin-top:12px">Only Spotify is controlled. If the tab closes or loses contact, the helper pauses music on tab close or within 90 seconds of losing contact. Spotify’s ad and playback restrictions still apply; unavailable controls stay disabled.</p>';
      musicCard.insertBefore(desktopSetup,musicCard.querySelector('details'));
      this.querySelector('details').classList.add('web-setup');
      this.querySelector('.connect-desktop').onclick=()=>connectDesktop(this.querySelector('.desktop-key').value.trim());
      const pace=document.createElement('label');pace.className='ex-row';pace.innerHTML='<span>Flow pace<small>Continuous evolution, even while the timer is paused.</small></span><select data-pref="flowSpeed"><option value="0.55">Gentle</option><option value="1">Fluid</option><option value="1.65">Expressive</option></select>';
      this.querySelector('.visual-toggles').after(pace);
      for(const [key,label,help] of [
        ['minimalist','Minimalist mode','Turn off decoration in one step. Individual choices below remain yours.'],
        ['background','Theme background','A living scene made for your selected theme.'],
        ['motion','Flowing motion','Continuous evolution, even while the countdown is paused.'],
        ['followSystemMotion','Follow system reduced motion','Pause the artwork when your device requests reduced motion.'],
        ['wave','Timer artwork','Theme-specific living artwork and countdown progress inside the timer.'],
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
      const status=this.querySelector('.music-status'); if(status) status.textContent=message || (connected()?'Connected · focus periods only.':'Connect your account below to enable playback.');
      const native=this.querySelector('.desktop-setup'),web=this.querySelector('.web-setup');if(native)native.hidden=prefs.musicSource!=='desktop';if(web)web.hidden=prefs.musicSource==='desktop';
      const b=this.querySelector('.disconnect'); if(b) b.disabled=!connected();
    }
  }
  customElements.define('cadence-settings',CadenceSettings);

  let lastFrame=0, lastScene='', lastPreview=0;
  function drawAtmosphere(now) {
    if(!window.CadenceAtmospheres) return;
    const canvas=document.getElementById('atmosphere');if(!canvas)return;
    const theme=root.dataset.theme||'nebula',motion=root.dataset.motion!=='false';
    const scene=theme+innerWidth+innerHeight+prefs.background+motion+prefs.flowSpeed;
    const artTime=motion?now/1000*Number(root.dataset.flowSpeed||1):24;
    if(!document.hidden && now-lastPreview>100) {
      lastPreview=now;
      document.querySelectorAll('.theme-preview[data-scene]').forEach(el=>{
        let preview=el.querySelector('canvas');
        if(!preview){preview=document.createElement('canvas');preview.setAttribute('aria-hidden','true');el.append(preview);}
        const width=Math.round(el.clientWidth),height=Math.round(el.clientHeight);if(!width||!height)return;
        if(preview.width!==width||preview.height!==height){preview.width=width;preview.height=height;}
        window.CadenceAtmospheres.draw(preview.getContext('2d'),width,height,artTime,el.dataset.scene);
      });
    }
    if(!prefs.background||document.hidden||(!motion&&scene===lastScene)||(motion&&now&&now-lastFrame<33))return;
    lastFrame=now;lastScene=scene;
    const w=innerWidth,h=innerHeight,dpr=Math.min(devicePixelRatio||1,1.5),ctx=canvas.getContext('2d');if(!ctx)return;
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
    ctx.setTransform(dpr,0,0,dpr,0,0);window.CadenceAtmospheres.draw(ctx,w,h,artTime,theme);
  }
  function animate(now) { drawAtmosphere(now); requestAnimationFrame(animate); }
  requestAnimationFrame(animate);
  window.addEventListener('resize',()=>{lastScene='';drawAtmosphere(0);});
  window.addEventListener('cadence-art-ready',()=>{lastScene='';drawAtmosphere(0);});
  reduced.addEventListener('change',()=>apply(store.getState()));
  document.addEventListener('visibilitychange',()=>{if(desktopReady)heartbeat();if(!document.hidden){lastScene='';poll();reconcile(true);}});
  window.addEventListener('online',()=>{poll();reconcile(true);});
  window.addEventListener('pagehide',()=>{ if(desktopReady && desktop) fetch(BRIDGE+'/timer',{method:'POST',headers:{'Content-Type':'application/json','X-Cadence-Key':desktop.key,'X-Cadence-Client':desktop.clientId},body:JSON.stringify({allowed:false,deadline:0}),keepalive:true}).catch(()=>{}); if(token && playing) { fetch('https://api.spotify.com/v1/me/player/pause',{method:'PUT',headers:{Authorization:'Bearer '+token.access_token},keepalive:true}).catch(()=>{}); } });
  window.CadenceExperience={
    timer(next) {
      const wasFocus=timer.mode==='focus' && timer.running;
      timer=next;
      if(!wasFocus && next.mode==='focus' && next.running) wanted=true;
      clearTimeout(deadlineId);
      if(next.running && next.mode==='focus' && next.deadline) deadlineId=setTimeout(()=>reconcile(true),Math.max(0,next.deadline-Date.now()));
      if(desktopReady && prefs.musicSource==='desktop') heartbeat();
      reconcile(!receivedTimer);receivedTimer=true;renderPlayer();
    },
    getPreferences:()=>({...prefs})
  };
  store.subscribe(apply);apply(store.getState());
  if(window.CadenceTimerSnapshot) window.CadenceExperience.timer(window.CadenceTimerSnapshot);
  store.ready.then(async()=>{await callback();if(desktop && desktop.owner===account && prefs.musicSource==='desktop' && prefs.musicMode!=='off') await connectDesktop(desktop.key,false);});
})();
