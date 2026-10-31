/* Cadence's curated worlds. Local canvas art plus a bundled oil-painted valley. */
(function () {
  'use strict';
  const TAU = Math.PI * 2, cache = new Map();
  const added = new Set(['nebula','horizon','valley','abyss','lantern','polar','rain','dunes']);
  const aliases = {graphite:'nebula', ember:'lantern', mist:'valley', clay:'valley'};
  function theme(name,bg,bg2,accent,accent2,description,status,light=false) {
    return {name,bg,bg2,accent,accent2,description,status,art:true,
      fg:light?'#302e38':'#f5f1ee',fg2:light?'#53505c':'#e7e4efc4',fg3:light?'#696571':'#c6c4d8ad',
      card:light?'#fffaf0cf':'#111423c7',cardB:light?'#51465a2b':'#ffffff24',pill:light?'#66577616':'#ffffff14',
      btnFg:light?'#fffaf4':bg,glow:accent+'45',ring:accent,wave1:accent+'50',wave2:accent2+'38'};
  }
  const themes = {
    nebula:theme('Nebula Bloom','#0c0b20','#17132f','#d7b5f6','#83d9e5','Violet gas unfurls through turquoise dust. New stars emerge between the folds.','between the stars'),
    horizon:theme('Event Horizon','#07080c','#141219','#f5cb91','#e78553','Stardust falls into a dark heart. Comets unravel, and distant supernovae send light across the void.','a little time dilation'),
    valley:theme('Painted Valley','#e5ddcd','#f4ede0','#68674d','#8c7290','Oil-brushed mountain slopes, soft Gaussian mist, and a river finding its way home.','a softer kind of time',true),
    abyss:theme('Abyssal Ballet','#031925','#092d39','#9de5e7','#cdafee','Translucent jellyfish rise through an inky sea, their ribbons carried by unseen currents.','below the noise'),
    lantern:theme('Lantern Drift','#201421','#332033','#f6c089','#e793a1','Warm paper lights float into a plum-colored night above a quiet lake.','let the moment rise'),
    sakura:theme('Cherry Blossom','#f6eef3','#fff8fb','#a34b73','#8070b0','Wind changes its mind. Petals gather, spiral, and drift into new paths.','in bloom',true),
    solstice:theme('Rivers of Color','#15131e','#211d2c','#ffc59b','#f38e9a','Pigments fold through one another. The marbling keeps finding a new form.','a moment in motion'),
    aurora:theme('Stardust','#080f20','#10192c','#dbc1f2','#9ecbdc','Particles trace an evolving field. Orbits precess around a luminous dial.','a little space to focus'),
    tidal:theme('Firefly Grove','#061c22','#0c292b','#b3d987','#82c8a7','A moving woodland current. Ferns and fireflies live inside the glass.','room to grow'),
    polar:theme('Aurora Veil','#061725','#102b38','#9aeccf','#bd9bea','Silken curtains fold over a frozen lake, gathering into a luminous crown.','under the northern lights'),
    rain:theme('Rainlit Window','#101a29','#1d2939','#b6d8e7','#e5bb9b','Raindrops gather on glass. Beyond them, city lights and passing headlights melt into color.','a quiet place inside'),
    dunes:theme('Dune Reverie','#e4c6a3','#f5e1c5','#805b43','#a27063','Wind combs warm sand into ripples. A distant dust devil wanders beneath the evening sun.','where time settles',true)
  };
  themes.sakura.fg='#302336';themes.sakura.fg2='#514656';themes.sakura.fg3='#716575';
  function resolve(id){return themes[id]?id:aliases[id]||'nebula';}
  function rng(seed){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
  const drift=(t,seed)=>window.CadenceFlow.noise(t,seed);
  function coursePoint(points,u){
    const at=u*(points.length-1),i=Math.min(points.length-2,Math.floor(at)),v=at-i;
    const a=points[Math.max(0,i-1)],b=points[i],c=points[i+1],d=points[Math.min(points.length-1,i+2)];
    return b.map((n,axis)=>.5*((2*n)+(-a[axis]+c[axis])*v+(2*a[axis]-5*n+4*c[axis]-d[axis])*v*v+(-a[axis]+3*n-3*c[axis]+d[axis])*v*v*v));
  }
  function glow(c,x,y,r,color){const g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,color);g.addColorStop(1,color.slice(0,7)+'00');c.fillStyle=g;c.fillRect(x-r,y-r,r*2,r*2);}
  function gradient(c,w,h,colors){const g=c.createLinearGradient(0,0,0,h);colors.forEach((v,i)=>g.addColorStop(i/(colors.length-1),v));c.fillStyle=g;c.fillRect(0,0,w,h);}
  function cached(id,w,h,draw){
    const key=id+':'+Math.round(w)+':'+Math.round(h);if(cache.has(key))return cache.get(key);
    const a=document.createElement('canvas');a.width=Math.ceil(w);a.height=Math.ceil(h);draw(a.getContext('2d'));cache.set(key,a);
    if(cache.size>18)cache.delete(cache.keys().next().value);return a;
  }
  function starfield(c,w,h,t,seed=19,count=240){
    const random=rng(seed);for(let i=0;i<count;i++){
      const x=random()*w,y=random()*h,s=.25+random()*1.1,p=.30+.6*(.5+.5*drift(t*(.26+random()*.4),seed+i));
      c.globalAlpha=p;c.fillStyle=i%5?'#d4dcff':'#fff3d1';c.beginPath();c.arc(x,y,s,0,TAU);c.fill();
      if(i%61===0){glow(c,x,y,7,'#c2bdff55');c.fillRect(x-3,y-.3,6,.6);c.fillRect(x-.3,y-3,.6,6);}
    }c.globalAlpha=1;
  }
  function nebula(c,w,h,t,bubble){
    if(!window.CadenceFlow || !window.CadenceFlow.paint(c,w,h,t,bubble,'nebula')){
      gradient(c,w,h,['#080d25','#241435','#0c2034']);
      c.save();c.globalCompositeOperation='screen';
      for(let i=0;i<42;i++){
        const x=w*(.5+.40*Math.sin(i*2.1+t*.027+i*.03)),y=h*(.5+.32*Math.cos(i*1.6-t*.033));
        glow(c,x,y,Math.min(w,h)*(.13+(i%4)*.045),['#b768a92a','#5485c52c','#69c8c329'][i%3]);
      }c.restore();
    }
    starfield(c,w,h,t,941,bubble?50:230);
    if(!bubble){c.save();c.globalCompositeOperation='screen';glow(c,w*(.3+.1*Math.sin(t*.071)),h*.39,Math.min(w,h)*.18,'#b6a3fa19');c.restore();}
  }
  function blackHole(c,w,h,t,bubble){
    gradient(c,w,h,['#05070e','#110e16','#08080d']);starfield(c,w,h,t,231,bubble?25:230);
    if(window.CadenceSceneEvents)window.CadenceSceneEvents.draw(c,w,h,t,'horizon',bubble);
    const r=Math.min(w*(bubble?.37:.19),h*(bubble?.37:.225)),cx=w*.5,cy=h*(bubble?.5:.51);
    c.save();c.translate(cx,cy);c.rotate(-.085+Math.sin(t*.029)*.025);
    glow(c,0,0,r*3.4,'#d16b2d16');glow(c,0,0,r*1.5,'#ffc37c3a');
    // The far side of the disk is bent up over the shadow, like a luminous crown.
    for(let j=63;j>=0;j--){
      const u=j/63,rr=r*(1.045+u*.49),sh=.45+.55*Math.sin(j*.81+t*.62)**2;
      c.strokeStyle=j<10?'rgba(255,232,185,'+(.20+sh*.35)+')':'rgba(233,151,78,'+((1-u)*.16*sh)+')';
      c.lineWidth=r*.022;c.beginPath();c.ellipse(0,-r*.015,rr,rr*(.91+u*.07),0,Math.PI*.91,TAU+.08);c.stroke();
    }
    // A broad thin disk; migrating hot filaments move at different angular speeds.
    for(let j=65;j>=0;j--){
      const u=j/65,rx=r*(1.04+u*2.15)*(1+.012*drift(t*.13,j+721)),ry=r*(.10+u*.22)*(1+.03*drift(t*.11,j+411)),alpha=(1-u)**1.2;
      c.strokeStyle='rgba(242,171,92,'+(alpha*.17)+')';c.lineWidth=r*.030;c.beginPath();c.ellipse(0,0,rx,ry,0,0,TAU);c.stroke();
      const a=t*(.6/(.6+u))+j*2.3999+drift(t*.09,j+631)*.24;c.strokeStyle='rgba(255,233,187,'+(alpha*.65)+')';c.lineWidth=r*.012;
      c.beginPath();c.ellipse(0,0,rx,ry,0,a,a+.13+u*.12);c.stroke();
    }
    // Matter travels from the outer disk to the shadow, which occludes every
    // arrival. Per-particle births fade in; nothing teleports across the hole.
    for(const p of window.CadenceFlow.travel(c,t,'infall:'+bubble,bubble?55:190,.045,.095)){
      const point=u=>{const radius=r*(.70+5.2*(1-u)**1.8),a=p.phase+u*4.7;return [Math.cos(a)*radius,Math.sin(a)*radius*(.24+.22*(1-u))];};
      const [x,y]=point(p.u),[px,py]=point(Math.max(0,p.u-.012));
      c.globalAlpha=p.alpha*(.32+p.size*.65);c.strokeStyle=p.size>.7?'#ffedc6':'#e6a16a';c.lineWidth=bubble?.7:.6+p.size;
      c.beginPath();c.moveTo(px,py);c.lineTo(x,y);c.stroke();
    }c.globalAlpha=1;
    if(window.CadenceSceneEvents)window.CadenceSceneEvents.infall(c,r,t,bubble);
    c.fillStyle='#030407';c.beginPath();c.arc(0,0,r*.99,0,TAU);c.fill();
    c.strokeStyle='#ffe1a3bb';c.lineWidth=r*.016;c.beginPath();c.arc(0,0,r*1.006,0,TAU);c.stroke();
    // Near-side light skims the lower rim, leaving the central shadow legible.
    for(let j=0;j<42;j++){
      const u=j/42,rx=r*(1.03+u*2.1),ry=r*(.11+u*.22);
      c.strokeStyle='rgba(255,206,135,'+((1-u)*.36)+')';c.lineWidth=r*.024;
      c.beginPath();c.ellipse(0,r*.10,rx,ry,0,0,Math.PI);c.stroke();
    }
    c.restore();
  }
  function ridge(c,w,h,points,color){c.fillStyle=color;c.beginPath();c.moveTo(0,h);for(const [x,y] of points)c.lineTo(x*w,y*h);c.lineTo(w,h);c.closePath();c.fill();}
  function oilLandscape(c,w,h){
    const random=rng(4928);c.save();c.scale(w/1200,h/800);const W=1200,H=800;
    gradient(c,W,H,['#d2cbdb','#eed6c1','#dccda7']);glow(c,800,160,290,'#fff5cb8c');
    // Broad translucent scumbles remain visible beneath the softened edges.
    for(let i=0;i<1400;i++){
      const x=random()*W,y=random()*H*.45;c.strokeStyle=['#f4d6bd28','#c6bed02e','#f9e6cd32'][i%3];c.lineWidth=3+random()*13;c.lineCap='round';
      c.beginPath();c.moveTo(x,y);c.lineTo(x+15+random()*70,y+(random()-.5)*6);c.stroke();
    }
    const planes=[
      {color:'#9993ab',p:[[0,.43],[.10,.26],[.17,.33],[.24,.19],[.35,.37],[.44,.29],[.54,.39],[.66,.23],[.78,.35],[.86,.20],[1,.40]]},
      {color:'#787f95',p:[[0,.56],[.06,.37],[.16,.45],[.24,.32],[.36,.48],[.48,.42],[.56,.50],[.70,.38],[.82,.31],[.94,.43],[1,.34]]},
      {color:'#6f887d',p:[[0,.48],[.12,.51],[.22,.60],[.36,.62],[.52,.58],[.68,.61],[.78,.49],[.87,.46],[1,.55]]},
      {color:'#738263',p:[[0,.60],[.13,.61],[.26,.70],[.44,.69],[.57,.63],[.70,.69],[.86,.63],[1,.58]]},
      {color:'#4c6a59',p:[[0,.69],[.12,.73],[.30,.83],[.41,.94],[.5,1.02],[.72,.88],[.9,.77],[1,.75]]}
    ];
    planes.forEach((plane,index)=>{
      c.save();c.beginPath();c.moveTo(0,H);for(const [x,y]of plane.p)c.lineTo(x*W,y*H);c.lineTo(W,H);c.closePath();c.clip();
      c.fillStyle=plane.color;c.fillRect(0,0,W,H);
      const tones=index<2?['#dbc7b333','#c3b8c338','#414b662b','#ede0c735']:['#cfba793d','#abc5932e','#374f4833','#cbd4a332'];
      for(let i=0;i<1700;i++){
        const x=random()*W,y=random()*H;c.strokeStyle=tones[i%4];c.lineWidth=2+random()*6;c.lineCap='round';c.beginPath();
        c.moveTo(x,y);c.lineTo(x+(random()-.34)*(index<2?40:24),y+(random()-.1)*(index<2?22:8));c.stroke();
      }c.restore();
    });
    // A river cuts a luminous S through the valley, widening toward the viewer.
    c.strokeStyle='#abc4b4';c.lineWidth=2;c.beginPath();c.moveTo(670,436);c.bezierCurveTo(605,510,780,551,650,601);c.bezierCurveTo(470,650,650,735,435,840);c.stroke();
    for(let i=0;i<190;i++){
      const u=i/189,x=670-190*u+Math.sin(u*10)*70*u,y=436+u*405,width=2+u*u*150;
      c.strokeStyle=['#bdd0bd','#d8d3ae','#8eb1a9','#bdc8a5'][i%4]+'c0';c.lineWidth=2.8;c.beginPath();c.moveTo(x-width*.5,y);c.quadraticCurveTo(x,y-2,x+width*.5,y);c.stroke();
    }
    // Small palette-knife highlights and meadow flowers catch the late light.
    for(let i=0;i<630;i++){
      const x=random()*W,y=H*(.75+random()*.25);if(Math.abs(x-(480+Math.sin(y*.02)*80))<45)continue;
      c.strokeStyle=['#e4d69d70','#c39d7e59','#b5c29670','#e8c2b85c'][i%4];c.lineWidth=1+random()*3;c.beginPath();c.moveTo(x,y);c.lineTo(x+3+random()*7,y-2-random()*4);c.stroke();
    }
    c.restore();
  }
  let valleyImage;
  function valley(c,w,h,t,bubble){
    if(!valleyImage && typeof Image!=='undefined'){
      valleyImage=new Image();valleyImage.decoding='async';valleyImage.onload=()=>window.dispatchEvent(new Event('cadence-art-ready'));valleyImage.src='/art/painted-valley.png';
    }
    const painted=valleyImage && valleyImage.complete && valleyImage.naturalWidth;
    let dx=0,dy=0,dw=w,dh=h;
    c.save();c.filter='blur('+Math.max(.45,Math.min(w,h)*.0018)+'px)';
    if(painted){
      const scale=Math.max(w/valleyImage.naturalWidth,h/valleyImage.naturalHeight)*1.025;
      dw=valleyImage.naturalWidth*scale;dh=valleyImage.naturalHeight*scale;
      dx=(w-dw)*.5+drift(t*.021,237)*w*.004;dy=(h-dh)*.5+drift(t*.017,983)*h*.003;
      c.drawImage(valleyImage,dx,dy,dw,dh);
      if(c.canvas&&c.canvas.dataset)c.canvas.dataset.renderer='oil-painting';
    }else c.drawImage(cached('oil',w,h,ctx=>oilLandscape(ctx,w,h)),-1,-1,w+2,h+2);c.restore();
    // Gaussian veils and light move over the painting instead of moving mountains.
    c.save();c.globalCompositeOperation='screen';
    for(let j=0;j<4;j++){
      c.save();c.translate(w*(.5+.15*drift(t*(.041+j*.007),j+53)),h*(.43+j*.052));c.scale(1,.09+j*.013);
      glow(c,0,0,w*(.40+j*.03),['#f5ead228','#e8e0df35','#c8d4c12b','#f6debc24'][j]);c.restore();
    }
    glow(c,w*(.62+.16*Math.sin(t*.031)),h*.22,w*.4,'#ffe2ac19');c.restore();
    for(const p of window.CadenceFlow.travel(c,t,'river:'+bubble,26,.010,.020)){
      const u=p.u;c.globalAlpha=p.alpha;
      let x=w*(.558-.158*u+Math.sin(u*10)*.058*u),y=h*(.545+u*.51),width=w*(.003+u*u*.105);
      if(painted){
        const course=[[.60,.51],[.62,.56],[.55,.61],[.47,.66],[.57,.72],[.78,.79],[.87,.84]],point=coursePoint(course,u);
        x=dx+point[0]*dw;y=dy+point[1]*dh;width=dw*(.0015+u*u*.012)*(.75+p.size*.5);
      }
      c.strokeStyle=painted?'#fff8d425':'#e8ecd359';c.lineWidth=.7;c.beginPath();c.moveTo(x-width*.5,y);c.quadraticCurveTo(x,y-1.5,x+width*.5,y);c.stroke();
    }
    c.globalAlpha=1;
    if(bubble){const g=c.createRadialGradient(w*.5,h*.47,0,w*.5,h*.5,w*.6);g.addColorStop(0,'#f7eddbce');g.addColorStop(.6,'#f1e5d493');g.addColorStop(1,'#e4d6c600');c.fillStyle=g;c.fillRect(0,0,w,h);}
  }
  function jelly(c,x,y,s,t,phase){
    c.save();c.translate(x,y);c.rotate(drift(t*.27,phase*100|0)*.10);const pulse=1+.055*Math.sin(t*1.4+phase+drift(t*.17,phase*77|0)*.8);c.scale(pulse,1/pulse);
    glow(c,0,0,s*2.1,'#81d7dd12');
    // Long independently bending ribbons, rather than a rigid moving sprite.
    for(let j=0;j<11;j++){
      const start=(j/10-.5)*s*1.42,len=s*(1.5+(j%4)*.23);c.lineWidth=j%3===0?1.3:.65;c.strokeStyle=['#9cdce47c','#c9b5f089','#87d7d755'][j%3];c.beginPath();c.moveTo(start,0);
      for(let k=1;k<28;k++){const u=k/27,xx=start+Math.sin(u*8-t*(.85+j*.017)+phase+j*.3)*s*.21*u+Math.sin(u*5+t*.31+phase)*s*.2*u;c.lineTo(xx,u*len);}c.stroke();
    }
    const g=c.createRadialGradient(-s*.25,-s*.45,0,0,-s*.1,s*1.15);g.addColorStop(0,'#daf6f486');g.addColorStop(.5,'#82c8e53d');g.addColorStop(1,'#7e81c80a');c.fillStyle=g;
    c.beginPath();c.moveTo(-s,0);c.bezierCurveTo(-s,-s*1.18,s,-s*1.18,s,0);c.bezierCurveTo(s*.5,s*.16,-s*.5,s*.16,-s,0);c.fill();
    for(let j=0;j<7;j++){const u=j/6;c.strokeStyle='#c0ebed38';c.lineWidth=.65;c.beginPath();c.moveTo((u-.5)*s*1.8,0);c.quadraticCurveTo((u-.5)*s,-s*.95,0,-s*.87);c.stroke();}
    c.strokeStyle='#c8f6e1b0';c.lineWidth=1.2;c.beginPath();c.ellipse(0,0,s,s*.10,0,0,TAU);c.stroke();c.restore();
  }
  function abyss(c,w,h,t,bubble){
    gradient(c,w,h,['#092c42','#062332','#02141f']);glow(c,w*.5,-h*.15,w*.7,'#2776923b');
    if(window.CadenceSceneEvents)window.CadenceSceneEvents.draw(c,w,h,t,'abyss',bubble);
    c.save();c.globalCompositeOperation='screen';
    for(let j=0;j<6;j++){
      const x=w*(.12+j*.17+Math.sin(t*.07+j)*.035),g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,'#72cfdd0b');g.addColorStop(1,'transparent');c.fillStyle=g;c.beginPath();c.moveTo(x,0);c.lineTo(x+w*.08,h);c.lineTo(x+w*.20,h);c.lineTo(x+w*.026,0);c.fill();
    }c.restore();
    for(const p of window.CadenceFlow.travel(c,t,'jellies:'+bubble,bubble?1:10,.010,.024)){
      c.globalAlpha=p.alpha;
      jelly(c,w*(.06+p.x*.88+drift(t*.12,p.seed)*.05),h*(1.28-p.u*1.6),(.027+p.size*.055)*Math.min(w*1.25,h),t,p.phase);
    }
    for(const p of window.CadenceFlow.travel(c,t,'sea-dust:'+bubble,bubble?16:80,.004,.010)){
      c.globalAlpha=p.alpha;const x=(p.x+drift(t*.11,p.seed)*.012)*w,y=(1.05-p.u*1.1)*h;c.fillStyle='#9fe4d92a';c.beginPath();c.arc(x,y,.4+p.size*.7,0,TAU);c.fill();
    }c.globalAlpha=1;
  }
  function paperLantern(c,x,y,s,t,phase){
    c.save();c.translate(x,y);c.rotate(drift(t*.35,phase*100|0)*.11);glow(c,0,s*.1,s*2.8,'#f4a4511d');
    const g=c.createLinearGradient(-s,0,s,0);g.addColorStop(0,'#a5534cc9');g.addColorStop(.35,'#f9ca8e');g.addColorStop(.6,'#ffe0a1');g.addColorStop(1,'#bc755ac7');c.fillStyle=g;
    c.beginPath();c.moveTo(-s*.65,-s);c.bezierCurveTo(-s,-s*.2,-s*.77,s*.6,-s*.58,s*.8);c.quadraticCurveTo(0,s, s*.58,s*.8);c.bezierCurveTo(s*.77,s*.6,s,-s*.2,s*.65,-s);c.quadraticCurveTo(0,-s*1.17,-s*.65,-s);c.fill();
    c.strokeStyle='#75444459';c.lineWidth=.7;for(let j=0;j<5;j++){const u=(j/4-.5)*1.2;c.beginPath();c.moveTo(u*s,-s);c.quadraticCurveTo(u*s*1.35,0,u*s*.85,s*.78);c.stroke();}
    c.strokeStyle='#f7b675a1';c.lineWidth=1;c.beginPath();c.ellipse(0,s*.81,s*.58,s*.12,0,0,TAU);c.stroke();glow(c,0,s*.54,s*.45,'#fff4b465');
    c.restore();
  }
  function lanterns(c,w,h,t,bubble){
    gradient(c,w,h,['#19152b','#493047','#a65c5b']);glow(c,w*.72,h*.52,w*.5,'#ed9c6926');
    const breeze=window.CadenceSceneEvents&&window.CadenceSceneEvents.sample('lantern',t).find(e=>e.type==='breeze'),wind=breeze?Math.sin(breeze.u*Math.PI)*breeze.alpha*.055:0;
    if(!bubble){
      ridge(c,w,h,[[0,.72],[.16,.54],[.30,.65],[.48,.58],[.63,.70],[.8,.56],[1,.69]],'#31283b');
      ridge(c,w,h,[[0,.8],[.12,.73],[.29,.82],[.44,.75],[.6,.82],[.78,.72],[1,.78]],'#241e32');
      const water=c.createLinearGradient(0,h*.8,0,h);water.addColorStop(0,'#37263b');water.addColorStop(1,'#211d31');c.fillStyle=water;c.fillRect(0,h*.81,w,h*.2);
      for(let j=0;j<44;j++){const y=h*(.82+j*.0044),x=w*(.62+Math.sin(j*1.8+t*.21)*.06);c.strokeStyle='#dfa178'+(j%3?'25':'3a');c.lineWidth=.6;c.beginPath();c.moveTo(x-w*.07,y);c.lineTo(x+w*.07,y);c.stroke();}
    }
    for(const p of window.CadenceFlow.travel(c,t,'lanterns:'+bubble,bubble?3:27,.008,.017)){
      c.globalAlpha=p.alpha;paperLantern(c,w*(.03+p.x*.94+drift(t*.12,p.seed)*.04+wind*(.5+p.size)),h*(1.18-p.u*1.48),(.010+p.size*.023)*Math.min(w*1.3,h),t,p.phase);
    }c.globalAlpha=1;
  }
  const extra=id=>(c,w,h,t,bubble)=>window.CadenceExtraWorlds.draw(c,w,h,t,id,bubble);
  const renderers={nebula,horizon:blackHole,valley,abyss,lantern:lanterns,polar:extra('polar'),rain:extra('rain'),dunes:extra('dunes')};
  function draw(c,w,h,t,id,bubble=false){if(!added.has(id))return false;c.save();renderers[id](c,w,h,t,bubble);c.restore();return true;}
  function timer(c,w,h,t,id,fraction){
    if(!added.has(id))return false;const f=Math.max(0,Math.min(1,fraction)),s=Math.min(w,h),face=c.canvas&&c.canvas.parentElement;
    c.save();c.clearRect(0,0,w,h);
    if(face)face.style.borderRadius=id==='lantern'?'24% 24% 29% 29% / 20% 20% 32% 32%':id==='valley'||id==='dunes'?'44% 56% 51% 49% / 49% 47% 53% 51%':id==='rain'?'35% 35% 40% 40%':id==='abyss'?'48% 48% 44% 44% / 37% 37% 63% 63%':'50%';
    if(id==='lantern'){
      gradient(c,w,h,['#f8dab0','#f0bf8e','#c78870']);
      for(let j=0;j<9;j++){const u=j/8,x=w*(.08+u*.84);c.strokeStyle='#854e4a30';c.lineWidth=1;c.beginPath();c.moveTo(x,0);c.bezierCurveTo(x+(u-.5)*22,h*.3,x+(u-.5)*20,h*.7,x,h);c.stroke();}
      for(let j=0;j<40;j++){c.strokeStyle=j/40<f?'#743d4c94':'#8f5c5125';c.lineWidth=1.7;c.beginPath();c.moveTo(w*.09,h*(.13+j*.019));c.lineTo(w*.12,h*(.13+j*.019));c.stroke();}
      glow(c,w*(.5+drift(t*.19,773)*.03),h*.9,w*(.6+drift(t*.37,531)*.025),'#ffe3ac66');
    }else if(id==='abyss'){
      gradient(c,w,h,['#154e60','#0a303f','#11293c']);jelly(c,w*.5,h*.40,w*.42,t,1.6);
      for(let i=0;i<38;i++){const a=i/38*TAU;c.fillStyle=i/38<f?'#beeee3':'#bceee329';c.beginPath();c.arc(w*.5+Math.cos(a)*w*.43,h*.52+Math.sin(a)*h*.40,1.3,0,TAU);c.fill();}
    }else if(['polar','rain','dunes'].includes(id))window.CadenceExtraWorlds.timer(c,w,h,t,id,f);
    else draw(c,w,h,t,id,true);
    if(id!=='lantern'&&id!=='valley'&&id!=='dunes'){
      const g=c.createRadialGradient(w*.5,h*.5,0,w*.5,h*.5,w*(id==='horizon'?.45:.39));g.addColorStop(0,id==='horizon'?'#030407fc':'#071220c7');if(id==='horizon')g.addColorStop(.80,'#030407f5');g.addColorStop(1,id==='horizon'?'#03040700':'#07122000');c.fillStyle=g;c.fillRect(0,0,w,h);
    }
    if(id!=='lantern'&&id!=='abyss'){
      c.strokeStyle=id==='valley'?'#776c569e':id==='horizon'?'#ffe1a4dd':themes[id].accent;c.lineWidth=id==='horizon'?2:1.4;c.beginPath();c.arc(w*.5,h*.5,s*.455,-Math.PI*.5,-Math.PI*.5+TAU*f);c.stroke();
      if(id==='nebula'){c.save();c.translate(w*.5,h*.5);c.rotate(t*.07);c.strokeStyle='#d6c7ff40';c.lineWidth=.6;c.beginPath();c.ellipse(0,0,w*.48,h*.37,0,0,TAU);c.stroke();c.restore();}
    }
    c.restore();return true;
  }
  window.CadenceWorlds={themes,aliases,resolve,draw,timer};
})();
