/* Original procedural scenes: polar light, refracting rain, and wind-sculpted sand.
 * References and credits are in README.md. No remote artwork is required. */
(function(){
  'use strict';
  const TAU=Math.PI*2,cache=new Map();
  const noise=(t,seed)=>window.CadenceFlow.noise(t,seed);
  function rand(seed){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
  function glow(c,x,y,r,color){const g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,color);g.addColorStop(1,color.slice(0,7)+'00');c.fillStyle=g;c.fillRect(x-r,y-r,2*r,2*r);}
  function gradient(c,w,h,colors){const g=c.createLinearGradient(0,0,0,h);colors.forEach((v,i)=>g.addColorStop(i/(colors.length-1),v));c.fillStyle=g;c.fillRect(0,0,w,h);}
  function layer(key,w,h,paint){
    const id=key+':'+w+':'+h;if(cache.has(id))return cache.get(id);
    const canvas=document.createElement('canvas');canvas.width=Math.ceil(w);canvas.height=Math.ceil(h);paint(canvas.getContext('2d'));
    cache.set(id,canvas);if(cache.size>10)cache.delete(cache.keys().next().value);return canvas;
  }
  function curtains(c,w,h,t,bubble){
    c.save();c.globalCompositeOperation='screen';
    for(let band=0;band<4;band++){
      const n=bubble?72:150;
      for(let i=0;i<n;i++){
        const u=i/(n-1),x=u*w;
        const fold=Math.sin(u*5.3+t*.12+band*.9)*.11+Math.sin(u*12.5-t*.17+band)*.033;
        const y=h*(.28+band*.065+fold+noise(t*.06+u*2,76+band)*.045);
        const len=h*(.15+.15*(.5+.5*Math.sin(u*7+t*.19+band)));
        const g=c.createLinearGradient(x,y-len,x,y+len*.14);
        const a=(.16+.18*Math.sin(u*9+band+t*.11)**2)/(band*.3+1);
        g.addColorStop(0,'transparent');g.addColorStop(.45,'rgba(96,174,199,'+(a*.4)+')');
        g.addColorStop(.88,'rgba(101,238,178,'+a+')');g.addColorStop(.96,'rgba(181,148,236,'+(a*.9)+')');g.addColorStop(1,'transparent');
        c.strokeStyle=g;c.lineWidth=w/n*1.35;c.beginPath();c.moveTo(x,y-len);c.quadraticCurveTo(x-w*.026,y-len*.3,x,y+len*.14);c.stroke();
      }
    }c.restore();
  }
  function polar(c,w,h,t,bubble){
    gradient(c,w,h,['#040e21','#102f3e','#25494c']);
    const random=rand(711);for(let i=0;i<(bubble?35:180);i++){
      c.fillStyle='rgba(212,235,241,'+(.25+.45*(.5+.5*noise(t*.22,i)))+')';c.beginPath();c.arc(random()*w,random()*h*.65,.3+random()*.8,0,TAU);c.fill();
    }
    glow(c,w*.76,h*.16,Math.min(w,h)*.13,'#a9d9e11c');curtains(c,w,h,t,bubble);
    if(bubble)return;
    const mountain=(base,color,seed)=>{
      c.fillStyle=color;c.beginPath();c.moveTo(0,h);
      for(let j=0;j<=90;j++){const u=j/90;c.lineTo(u*w,h*(base+noise(u*12,seed)*.06+Math.sin(u*17+seed)*.017));}
      c.lineTo(w,h);c.fill();
    };
    mountain(.64,'#142d3b',91);mountain(.72,'#0a2330',81);
  }
  function polarScene(c,w,h,t,bubble){
    // Paint lake reflections in their own clipped pass.
    polar(c,w,h,t,bubble);
    if(!bubble){
      c.save();c.beginPath();c.rect(0,h*.78,w,h*.22);c.clip();
      const g=c.createLinearGradient(0,h*.78,0,h);g.addColorStop(0,'#183d48');g.addColorStop(1,'#071723');c.fillStyle=g;c.fillRect(0,h*.78,w,h*.22);
      c.translate(0,h*1.57);c.scale(1,-.30);c.globalAlpha=.28;curtains(c,w,h,t,false);c.restore();
      for(let i=0;i<27;i++){const y=h*(.79+i*.008);c.strokeStyle=i%3?'#a7d6d20d':'#a7d6d21a';c.lineWidth=.6;c.beginPath();c.moveTo(0,y);c.lineTo(w,y+h*.002*Math.sin(t*.09+i));c.stroke();}
    }
  }
  function city(c,w,h){
    gradient(c,w,h,['#101c30','#28374b','#584b50']);
    const random=rand(331);
    c.save();c.filter='blur('+Math.max(3,w*.010)+'px)';
    for(let j=0;j<24;j++){
      const x=j/23*w,bh=h*(.18+random()*.39),bw=w*(.026+random()*.054);c.fillStyle=j%3?'#142237':'#1c2b3d';c.fillRect(x,h-bh,bw,bh);
      for(let k=0;k<9;k++){const color=k%3?'#dec2a2':'#a2d4e3';glow(c,x+bw*.55,h-bh+random()*bh,w*(.008+random()*.012),color+'65');}
    }
    for(let i=0;i<48;i++)glow(c,random()*w,h*(.28+random()*.72),w*(.008+random()*.038),['#e0b29570','#8bbfda65','#c69bad45'][i%3]);
    c.restore();
    const vignette=c.createRadialGradient(w*.5,h*.5,0,w*.5,h*.5,w*.8);vignette.addColorStop(0,'transparent');vignette.addColorStop(1,'#060f22c0');c.fillStyle=vignette;c.fillRect(0,0,w,h);
  }
  function rain(c,w,h,t,bubble){
    const bg=layer('city',w,h,ctx=>city(ctx,w,h));c.drawImage(bg,0,0,w,h);
    const events=window.CadenceSceneEvents,merge=events&&events.sample('rain',t).find(e=>e.type==='merge');
    if(events)events.draw(c,w,h,t,'rain',bubble);
    for(const p of window.CadenceFlow.travel(c,t,'glass:'+bubble,bubble?30:100,.009,.035)){
      const x=w*(p.x+noise(t*.09,p.seed)*.002),y=h*(p.u*1.16-.08),r=Math.min(w,h)*(.0025+p.size*.008);
      if(merge){
        const head=events.mergePath(merge,w,h),u=(y/h+.05)/1.2,trail=events.mergePath({...merge,u},w,h);
        if(y>=0&&y<head.y&&Math.abs(x-trail.x)<head.r*.85)continue;
      }
      c.save();c.globalAlpha=p.alpha;
      c.strokeStyle='#c6e0ee1a';c.lineWidth=r*.7;c.beginPath();c.moveTo(x,y-r*1.8);c.lineTo(x-r*.15,y-r*7*(p.speed/.035));c.stroke();
      c.beginPath();c.ellipse(x,y,r,r*(1.2+p.speed*12),0,0,TAU);c.clip();
      // A magnified, vertically inverted patch supplies the droplet refraction.
      c.translate(x,y);c.scale(1,-1);c.drawImage(bg,Math.max(0,Math.min(w-1,x-r*3)),Math.max(0,Math.min(h-1,y-r*3)),Math.max(1,Math.min(w,r*6)),Math.max(1,Math.min(h,r*6)),-r,-r*1.6,r*2,r*3.2);
      c.restore();c.save();c.globalAlpha=p.alpha;c.strokeStyle='#cce7f56b';c.lineWidth=.65;c.beginPath();c.ellipse(x,y,r,r*1.35,-.08,Math.PI*.99,Math.PI*1.65);c.stroke();
      c.fillStyle='#e0f4f57a';c.beginPath();c.ellipse(x-r*.28,y-r*.6,r*.19,r*.13,-.6,0,TAU);c.fill();c.restore();
    }
  }
  function duneHeight(u,band){return .43+band*.105+Math.sin(u*3.7+band*1.5)*(.08+band*.013)+Math.sin(u*7.2-band*.7)*.025;}
  function sand(c,w,h){
    gradient(c,w,h,['#b8afbf','#e6c5af','#f5d9af']);glow(c,w*.73,h*.25,Math.min(w,h)*.24,'#fff1c4c9');
    for(let band=0;band<6;band++){
      const g=c.createLinearGradient(0,h*(.35+band*.08),w,h);g.addColorStop(0,['#cbaa9d','#cfaa8d','#d5b18e','#bb9478','#d1a77c','#ae805f'][band]);g.addColorStop(1,['#e2c5a8','#ebcba6','#efd0a6','#d2af86','#e7bd89','#ce9e70'][band]);
      c.fillStyle=g;c.beginPath();c.moveTo(0,h);for(let i=0;i<=120;i++)c.lineTo(i/120*w,h*duneHeight(i/120,band));c.lineTo(w,h);c.fill();
      c.save();c.beginPath();c.moveTo(0,h);for(let i=0;i<=120;i++)c.lineTo(i/120*w,h*duneHeight(i/120,band));c.lineTo(w,h);c.clip();
      for(let j=0;j<22;j++){
        c.strokeStyle=j%3?'#805a3f13':'#ffebbd33';c.lineWidth=.6;c.beginPath();
        for(let i=0;i<=100;i++){const u=i/100,y=h*(duneHeight(u,band)+j*j*.00034);if(i)c.lineTo(u*w,y);else c.moveTo(0,y);}c.stroke();
      }c.restore();
    }
  }
  function dunes(c,w,h,t,bubble){
    const landscape=layer('sand',w,h,ctx=>sand(ctx,w,h));
    if(bubble)c.drawImage(landscape,0,h*.38,w,h*.62,0,0,w,h);
    else c.drawImage(landscape,0,0,w,h);
    glow(c,w*(.6+noise(t*.014,931)*.17),h*.54,w*.48,'#fff2ca20');
    for(const p of window.CadenceFlow.travel(c,t,'sand:'+bubble,bubble?26:95,.015,.042)){
      const x=w*(p.u*1.3-.15),y=h*(.46+p.x*.53)+Math.sin(p.u*8+p.phase)*h*.011;
      c.globalAlpha=p.alpha*(.20+p.size*.35);c.strokeStyle='#ffe4af';c.lineWidth=.4+p.size*.5;c.beginPath();c.moveTo(x,y);c.lineTo(x-w*(.004+p.size*.009),y+h*.001);c.stroke();
    }c.globalAlpha=1;
    if(bubble){const g=c.createRadialGradient(w*.5,h*.48,0,w*.5,h*.5,w*.6);g.addColorStop(0,'#f9e4c7dd');g.addColorStop(1,'#f9e4c700');c.fillStyle=g;c.fillRect(0,0,w,h);}
  }
  const renderers={polar:polarScene,rain,dunes};
  function draw(c,w,h,t,id,bubble){renderers[id](c,w,h,t,bubble);}
  function timer(c,w,h,t,id,f){
    draw(c,w,h,t,id,true);
    if(id==='polar'){
      c.save();c.translate(w*.5,h*.5);c.rotate(t*.04);c.strokeStyle='#a1e8d766';c.lineWidth=w*.018;
      c.beginPath();c.ellipse(0,0,w*.43,h*.35,.3,0,TAU*f);c.stroke();c.restore();
    }else if(id==='rain'){
      const g=c.createRadialGradient(w*.5,h*.5,0,w*.5,h*.5,w*.54);g.addColorStop(0,'#182c40ec');g.addColorStop(.64,'#233b4bbc');g.addColorStop(1,'transparent');c.fillStyle=g;c.fillRect(0,0,w,h);
      c.strokeStyle='#d9edf056';c.lineWidth=1;c.beginPath();c.ellipse(w*.5,h*.5,w*.41,h*.4,0,-Math.PI*.5,-Math.PI*.5+TAU*f);c.stroke();
    }
  }
  window.CadenceExtraWorlds={draw,timer};
})();
