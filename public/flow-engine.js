/* Continuous fields and persistent particles: no animation cycle or reset keyframe. */
(function () {
  'use strict';
  const TAU=Math.PI*2, states=new WeakMap();
  const palette={petals:['#c86898','#e6a0b9','#aa7baf','#fff7ef'],stars:['#f2d5ac','#b0a8f3','#85ded7','#e8d6ff'],fireflies:['#e5f5a0','#a6e3b4','#81d9c5'],paint:['#e999a8','#83bebb','#ebcda4','#a18cb6','#d2d6b4']};
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  function random(seed){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
  function glow(c,x,y,r,color){const g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,color);g.addColorStop(1,'transparent');c.fillStyle=g;c.fillRect(x-r,y-r,2*r,2*r);}
  function petal(c,x,y,s,a,color){c.save();c.translate(x,y);c.rotate(a);c.fillStyle=color;c.beginPath();c.moveTo(0,-s);c.bezierCurveTo(s*1.3,-s*.6,s*.6,s*.7,0,s);c.bezierCurveTo(-s*.7,s*.4,-s*1.2,-s*.7,0,-s);c.fill();c.restore();}

  // A migrating collection of vortices bends a changing curl field. Paths are
  // integrated from their previous positions, rather than replayed around a ring.
  function field(x,y,t,flavor){
    const k=flavor==='petals'?1:flavor==='stars'?2.4:1.6;
    let vx=Math.sin(y*6.3+Math.sin(x*3.7+t*.39)+t*.27)*.7;
    let vy=Math.cos(x*5.1+Math.sin(y*4.3-t*.31)-t*.23)*.55;
    for(let i=0;i<3;i++){
      const ax=.5+.34*Math.sin(t*(.073+i*.019)+i*2.3),ay=.5+.3*Math.cos(t*(.061+i*.023)+i*1.7);
      const dx=x-ax,dy=y-ay,r2=dx*dx+dy*dy+.045;
      vx+=-dy/r2*(i%2?-.25:.3);vy+=dx/r2*(i%2?-.25:.3);
    }
    return flavor==='petals'?[vx*.5+.65,vy*.42+.34]:[vx*k,vy*k];
  }
  function makeState(c,w,h,t,kind,bubble){
    const rand=random((kind==='petals'?8219:kind==='stars'?71071:9293)+(bubble?991:0));
    const trail=document.createElement('canvas');trail.width=Math.ceil(w);trail.height=Math.ceil(h);
    const count=bubble?70:Math.round((kind==='stars'?950:kind==='paint'?750:kind==='petals'?260:230)*clamp(w/1000,.55,1.4));
    const s={w,h,kind,bubble,t,trail,ink:trail.getContext('2d'),rand,points:[]};
    for(let i=0;i<count;i++)s.points.push({x:rand()*w,y:rand()*h,vx:0,vy:0,age:rand()*20,life:18+rand()*30,size:.7+rand()*1.7,phase:rand()*TAU,color:palette[kind][i%palette[kind].length]});
    return s;
  }
  function particles(c,w,h,t,kind,bubble=false){
    const key=c.canvas||c;let map=states.get(key);if(!map){map=new Map();states.set(key,map);}
    const id=kind+':'+bubble;let s=map.get(id);
    if(!s||s.w!==w||s.h!==h||t<s.t){s=makeState(c,w,h,t,kind,bubble);map.set(id,s);}
    const delta=t-s.t,dt=delta===0?0:clamp(delta,0,.065);s.t=t;
    const ink=s.ink;
    if(dt>0){ink.save();ink.globalCompositeOperation='destination-out';ink.fillStyle='rgba(0,0,0,'+(kind==='paint'?.025:kind==='stars'?.10:.19)+')';ink.fillRect(0,0,w,h);ink.restore();}
    const scale=Math.min(w,h),speed=bubble?scale*.15:scale*(kind==='petals'?.075:.095);
    for(const p of s.points){
      const oldX=p.x,oldY=p.y,f=field(p.x/w,p.y/h,t,kind),blend=1-Math.exp(-dt*3);
      p.vx+=(f[0]*speed-p.vx)*blend;p.vy+=(f[1]*speed-p.vy)*blend;
      p.x+=p.vx*dt;p.y+=p.vy*dt;p.age+=dt;
      if(p.x<-30||p.x>w+30||p.y<-30||p.y>h+30||p.age>p.life){
        p.age=0;p.life=18+s.rand()*30;p.vx=0;p.vy=0;
        if(kind==='petals'&&!bubble){p.x=w*(.02+s.rand()*.29);p.y=h*(.10+s.rand()*.42);}
        else{p.x=s.rand()*w;p.y=s.rand()*h;}
      }else if(dt>0){
        ink.strokeStyle=p.color+(kind==='paint'?'b0':kind==='stars'?'72':'35');ink.lineWidth=kind==='paint'?p.size*(bubble?1.8:4):kind==='petals'?.65:p.size*.65;
        ink.beginPath();ink.moveTo(oldX,oldY);ink.lineTo(p.x,p.y);ink.stroke();
      }
    }
    c.drawImage(s.trail,0,0);
    for(const p of s.points){
      const edge=Math.min(1,p.age*1.5,(p.life-p.age)*.6),pulse=.55+.45*Math.sin(t*1.3+p.phase)**2;
      c.globalAlpha=clamp(edge,0,1)*(kind==='fireflies'?pulse:.7);
      if(kind==='petals')petal(c,p.x,p.y,(bubble?1.5:2.6)*p.size,t*.8+p.phase+Math.sin(t*.7+p.phase),p.color);
      else if(kind!=='paint'){
        if(kind==='fireflies'||p.size>2.25)glow(c,p.x,p.y,p.size*(bubble?3:5),p.color+'26');
        c.fillStyle=p.color;c.beginPath();c.arc(p.x,p.y,p.size*(bubble?.6:.65),0,TAU);c.fill();
      }
    }
    c.globalAlpha=1;
  }

  // Domain-warped pigment on the GPU. Incommensurate time components evolve the
  // topology and lighting continuously; this is not a scrolling texture/video.
  let gpu, failed=false;
  function fluidSurface(){
    if(gpu)return gpu;if(failed||typeof WebGLRenderingContext==='undefined')return null;
    try{
      const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl',{alpha:false,antialias:false,preserveDrawingBuffer:false});if(!gl){failed=true;return null;}
      const vertex='attribute vec2 p;varying vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}';
      const fragment=`precision highp float;
        varying vec2 uv;uniform float time;uniform vec2 size;uniform float bubble;uniform float nebula;
        float hash(vec3 p){p=fract(p*.3183099+vec3(.11,.27,.39));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
        float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
          return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
        float fbm(vec3 p){float v=0.,a=.52;for(int i=0;i<4;i++){v+=a*noise(p);p=p*2.03+vec3(3.1,1.7,2.3);a*=.49;}return v;}
        void main(){
          vec2 p=(uv-.5)*vec2(size.x/size.y,1.)*2.7;
          float t=time*.19;
          vec2 drift=vec2(sin(t*.37),cos(t*.29))*.6;
          vec2 q=vec2(fbm(vec3(p+drift,t*.27)),fbm(vec3(p+vec2(4.2,1.8)-drift,t*.31)));
          vec2 r=vec2(fbm(vec3(p+3.8*q+vec2(1.7,8.1),t*.41)),fbm(vec3(p+3.6*q+vec2(8.3,2.8),t*.34)));
          float f=fbm(vec3(p+4.8*r,t*.22));
          float veins=.5+.5*sin(f*42.+r.x*13.+q.y*8.+t*.36);
          vec3 plum=vec3(.31,.15,.35),coral=vec3(.91,.39,.49),gold=vec3(.99,.79,.53),teal=vec3(.22,.60,.62),ivory=vec3(.93,.88,.77);
          vec3 color=mix(plum,coral,smoothstep(.22,.61,f));
          color=mix(color,teal,smoothstep(.35,.72,r.x)*.92);
          color=mix(color,gold,smoothstep(.56,.73,q.y)*.9);
          color=mix(color,ivory,pow(veins,16.)*.43);
          color*=.7+.4*smoothstep(.25,.8,r.y);
          vec2 center=(uv-.5)*vec2(size.x/size.y,1.);
          float calm=1.-smoothstep(.10,.50,length(center));
          color=mix(color,vec3(.075,.055,.11),calm*(bubble>.5?.53:.38));
          if(nebula>.5){
            float cloud=fbm(vec3(p*1.12+4.2*r,t*.17));
            float ridge=1.-abs(cloud*2.-1.);
            float smoke=pow(smoothstep(.20,.83,cloud),1.7);
            vec3 gas=mix(vec3(.10,.055,.24),vec3(.69,.25,.52),smoothstep(.30,.72,q.x));
            gas=mix(gas,vec3(.18,.68,.73),smoothstep(.33,.72,r.y));
            gas=mix(gas,vec3(.88,.65,.86),pow(ridge,12.)*.46);
            float dust=fbm(vec3(p*3.8+6.*q,t*.22));
            color=vec3(.025,.035,.095)+gas*smoke*1.6;
            color*=.62+.48*dust;
            color+=vec3(.24,.17,.37)*pow(ridge,9.)*.20;
          }
          gl_FragColor=vec4(color,1.);
        }`;
      function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error('Fluid shader could not compile.');return s;}
      const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('Fluid shader could not link.');
      gl.useProgram(program);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
      const p=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(p);gl.vertexAttribPointer(p,2,gl.FLOAT,false,0,0);
      gpu={canvas,gl,program,time:gl.getUniformLocation(program,'time'),size:gl.getUniformLocation(program,'size'),bubble:gl.getUniformLocation(program,'bubble'),nebula:gl.getUniformLocation(program,'nebula')};
      canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();gpu=null;failed=true;});
      return gpu;
    }catch{failed=true;return null;}
  }
  function paint(c,w,h,t,bubble=false,flavor='paint'){
      const surface=fluidSurface();if(!surface)return false;
    if(c.canvas&&c.canvas.dataset)c.canvas.dataset.renderer=flavor==='nebula'?'nebula-gas':'fluid';
    const {canvas,gl}=surface,scale=Math.min(1,950/w,620/h),rw=Math.max(2,Math.round(w*scale)),rh=Math.max(2,Math.round(h*scale));
    if(canvas.width!==rw||canvas.height!==rh){canvas.width=rw;canvas.height=rh;}
    gl.viewport(0,0,rw,rh);gl.useProgram(surface.program);gl.uniform1f(surface.time,t);gl.uniform2f(surface.size,w,h);gl.uniform1f(surface.bubble,bubble?1:0);gl.uniform1f(surface.nebula,flavor==='nebula'?1:0);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    c.drawImage(canvas,0,0,w,h);return true;
  }
  function ring(c,w,h,frac,color,offset=0){
    c.save();c.translate(w*.5,h*.5);c.rotate(offset);c.strokeStyle=color;c.lineWidth=1.6;c.beginPath();c.arc(0,0,w*.465,-Math.PI*.5,-Math.PI*.5+TAU*frac);c.stroke();c.restore();
  }
  function timer(c,w,h,t,id,fraction){
    if(window.CadenceWorlds && window.CadenceWorlds.timer(c,w,h,t,id,fraction))return;
    const f=clamp(fraction,0,1);c.save();c.clearRect(0,0,w,h);
    const face=c.canvas&&c.canvas.parentElement;
    if(face){
      if(id==='solstice'){
        const a=48+Math.sin(t*.37)*7,b=50+Math.cos(t*.29)*7,d=47+Math.sin(t*.23)*7;
        face.style.borderRadius=a+'% '+(100-a)+'% '+b+'% '+(100-b)+'% / '+d+'% '+a+'% '+(100-d)+'% '+(100-a)+'%';
      }else if(id==='sakura'){
        const a=49+Math.sin(t*.17)*3,b=49+Math.cos(t*.23)*4;face.style.borderRadius=a+'% '+(100-a)+'% '+b+'% '+(100-b)+'% / 54% 47% 53% 46%';
      }else face.style.borderRadius=id==='tidal'?'47% 47% 35% 35% / 49% 49% 35% 35%':'50%';
    }
    if(id==='solstice'){
      if(!paint(c,w,h,t,true)){
        const g=c.createLinearGradient(0,0,w,h);g.addColorStop(0,'#c7799755');g.addColorStop(.5,'#74bebd55');g.addColorStop(1,'#e7bb8a77');c.fillStyle=g;c.fillRect(0,0,w,h);
        for(let j=0;j<22;j++){c.strokeStyle=['#eec4a4','#b8d8cb','#dd93b2'][j%3]+'50';c.lineWidth=4;c.beginPath();for(let x=0;x<=w;x+=5){const y=h*(j/22)+Math.sin(x/w*7+t*.8+j*.4)*h*.08;x?c.lineTo(x,y):c.moveTo(x,y);}c.stroke();}
        particles(c,w,h,t,'paint',true);
      }
      const sheen=c.createLinearGradient(0,0,w,h);sheen.addColorStop(0,'#fff5d72c');sheen.addColorStop(.45,'transparent');sheen.addColorStop(1,'#5ed5ce24');c.fillStyle=sheen;c.fillRect(0,0,w,h);
      ring(c,w,h,f,'#ffdecaaa',t*.035);
    }else if(id==='sakura'){
      const g=c.createRadialGradient(w*.5,h*.48,w*.08,w*.5,h*.5,w*.52);g.addColorStop(0,'#fff8f4ee');g.addColorStop(.58,'#fff2efc7');g.addColorStop(1,'#e7afc577');c.fillStyle=g;c.fillRect(0,0,w,h);
      c.save();c.translate(w*.5,h*.5);c.rotate(t*.045);
      for(let i=0;i<5;i++){c.rotate(TAU/5);c.fillStyle='#d98daa24';c.beginPath();c.ellipse(0,-h*.28,w*.16,h*.25,0,0,TAU);c.fill();}
      c.restore();
      for(let i=0;i<42;i++){const a=i/42*TAU+t*.075,r=w*(.40+.028*Math.sin(t*.73+i));c.globalAlpha=i/42<f?.9:.15;petal(c,w*.5+Math.cos(a)*r,h*.5+Math.sin(a)*r,2.4+(i%3),a+t*.25,['#bd6592','#e0a3ba','#aa86ad'][i%3]);}
      c.globalAlpha=1;ring(c,w,h,f,'#aa5f8b80');
    }else if(id==='aurora'){
      c.fillStyle='#080f20bd';c.fillRect(0,0,w,h);glow(c,w*.5,h*.5,w*.55,'#8061bd30');
      c.save();c.translate(w*.5,h*.5);c.rotate(t*.12);
      for(let i=0;i<3;i++){c.rotate(1.1);c.strokeStyle=['#b0a6ed55','#8fd9d84d','#e8ceac55'][i];c.lineWidth=.8;c.beginPath();c.ellipse(0,0,w*(.42-i*.025),h*(.32+i*.025),0,0,TAU);c.stroke();}
      c.restore();particles(c,w,h,t,'stars',true);ring(c,w,h,f,'#ded0ffba',-.12*t);
    }else if(id==='tidal'){
      const g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,'#082627c7');g.addColorStop(1,'#234c3dcd');c.fillStyle=g;c.fillRect(0,0,w,h);
      for(let j=0;j<14;j++){
        const x=w*(j<7?.04+j*.028:.78+(j-7)*.028),height=h*(.08+(j%7)*.032)*(.5+f*.5),bend=Math.sin(t*.9+j*.6)*7;
        c.strokeStyle='#91c39b65';c.lineWidth=.8;c.beginPath();c.moveTo(x,h);c.quadraticCurveTo(x+bend,h-height*.7,x+bend*2,h-height);c.stroke();
        for(let k=0;k<3;k++){c.fillStyle='#80ad8a3d';c.beginPath();c.ellipse(x+bend*(1+k*.2),h-height*(.4+k*.2),7,2.5,j%2?.5:-.5,0,TAU);c.fill();}
      }
      particles(c,w,h,t,'fireflies',true);ring(c,w,h,f,'#c9e9a884');
    }
    // Keep the numerals readable as the surrounding artwork evolves.
    if(id!=='sakura'){const veil=c.createRadialGradient(w*.5,h*.48,w*.07,w*.5,h*.5,w*.39);veil.addColorStop(0,'#08121b9c');veil.addColorStop(1,'transparent');c.fillStyle=veil;c.fillRect(0,0,w,h);}
    c.restore();
  }
  window.CadenceFlow={particles,paint,timer,field};
})();
