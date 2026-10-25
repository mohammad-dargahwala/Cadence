/* Original generative scenes. Time is explicit so reduced motion keeps a finished artwork. */
(function () {
  'use strict';
  const TAU=Math.PI*2, cache=new Map();
  function rng(seed) { return () => { seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296; }; }
  const fract=x=>x-Math.floor(x);
  function glow(c,x,y,r,color) {const g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,color);g.addColorStop(1,'transparent');c.fillStyle=g;c.fillRect(x-r,y-r,r*2,r*2);}
  function petal(c,x,y,size,angle,color) {
    c.save();c.translate(x,y);c.rotate(angle);c.fillStyle=color;c.beginPath();
    c.moveTo(0,-size);c.bezierCurveTo(size*1.3,-size*.7,size*.8,size*.6,0,size);
    c.bezierCurveTo(-size*.8,size*.6,-size*1.3,-size*.7,0,-size);c.fill();c.restore();
  }
  function layer(id,w,h,draw) {
    const key=id+':'+Math.round(w)+':'+Math.round(h);
    if(!cache.has(key)) {
      const canvas=document.createElement('canvas');canvas.width=Math.ceil(w);canvas.height=Math.ceil(h);
      draw(canvas.getContext('2d'));cache.set(key,canvas);
      if(cache.size>12) cache.delete(cache.keys().next().value);
    }
    return cache.get(key);
  }
  function blossomTree(c,w,h) {
    const random=rng(76429), scale=Math.min(w*.00082,h*.00112), tips=[];
    c.save();c.translate(w<700?w*.02:w*.13,h*.99);c.scale(scale,scale);
    glow(c,60,-610,510,'#e69db247');glow(c,-170,-480,260,'#cf83a73a');
    function branch(x,y,len,angle,width,depth) {
      const ex=x+Math.cos(angle)*len,ey=y+Math.sin(angle)*len;
      c.lineWidth=width;c.lineCap='round';c.strokeStyle=depth>4?'#583746':'#76505a';
      c.beginPath();c.moveTo(x,y);c.bezierCurveTo(x+Math.cos(angle+.22)*len*.4,y+Math.sin(angle+.22)*len*.4,ex-Math.cos(angle-.2)*len*.23,ey-Math.sin(angle-.2)*len*.23,ex,ey);c.stroke();
      c.lineWidth=Math.max(.6,width*.1);c.strokeStyle='#bc8b943d';c.stroke();
      if(depth<=0){tips.push([ex,ey]);return;}
      branch(ex,ey,len*(.69+random()*.08),angle-.26-random()*.44,width*.65,depth-1);
      branch(ex,ey,len*(.67+random()*.12),angle+.22+random()*.45,width*.62,depth-1);
      if(depth>3) branch(ex,ey,len*.61,angle+(random()-.5)*.25,width*.5,depth-2);
    }
    branch(0,0,244,-1.44,43,7);
    // Broad, weathered roots anchor the canopy.
    for(let i=0;i<7;i++){c.strokeStyle='#68454f';c.lineWidth=11-i;c.beginPath();c.moveTo(0,-13);c.quadraticCurveTo((i-3)*24,5,(i-3)*49,13+random()*15);c.stroke();}
    const colors=['#eab5c6','#f9d3dd','#d992b0','#f3bed0','#fff0ed','#c97e9f'];
    for(const [x,y] of tips) {
      for(let i=0;i<9;i++){
        const a=random()*TAU,r=Math.sqrt(random())*30,px=x+Math.cos(a)*r,py=y+Math.sin(a)*r*.65;
        c.globalAlpha=.52+random()*.42;petal(c,px,py,3+random()*5,random()*TAU,colors[Math.floor(random()*colors.length)]);
      }
    }
    c.globalAlpha=1;c.restore();
    // Ground drifts echo the direction of the falling blossoms.
    for(let i=0;i<240;i++){const x=random()*w*.57,y=h*(.95+random()*.05);petal(c,x,y,1+random()*2,random()*TAU,'#cd8ca755');}
  }
  function cherry(c,w,h,t) {
    const sky=c.createLinearGradient(0,0,w,h);sky.addColorStop(0,'#f5e4e9');sky.addColorStop(.56,'#f4ebec');sky.addColorStop(1,'#e4dfeb');c.fillStyle=sky;c.fillRect(0,0,w,h);
    glow(c,w*.84,h*.23,w*.39,'#fff9ef9c');
    c.drawImage(layer('tree',w,h,ctx=>blossomTree(ctx,w,h)),0,0);
    const count=w<700?100:190;
    // Petals start near the canopy and follow several continuous wind streamlines.
    for(let i=0;i<count;i++) {
      const lane=i%5, p=fract(i*.61803398875+t*(.010+(i%7)*.0007));
      const x=w*(.035+p*1.16)+Math.sin(p*TAU*1.7+t*.11+lane)*w*.035;
      const y=h*(.20+lane*.065+p*.51)+Math.sin(p*TAU*1.2-lane*.56+t*.075)*h*.13;
      const fade=Math.min(1,p*10,(1-p)*10),size=(2.3+(i%5)*.65)*(w<700?.75:1);
      c.globalAlpha=fade*(.42+(i%3)*.15);
      petal(c,x,y,size,t*.36+i+Math.sin(p*12),['#c96d98','#e5a3be','#b980af','#fff7f4'][i%4]);
    }
    c.globalAlpha=1;
    // A few long curved eddies make the wind's shape visible between the petals.
    for(let j=0;j<4;j++){
      c.strokeStyle='#c18fa413';c.lineWidth=.7;c.beginPath();
      for(let k=0;k<=100;k++){const p=k/100,x=w*(.1+p*.95),y=h*(.46+j*.047+p*.25)+Math.sin(p*TAU*1.1+t*.075-j*.15)*h*.11;k?c.lineTo(x,y):c.moveTo(x,y);}c.stroke();
    }
  }
  function paintRiver(c,w,h,t) {
    c.fillStyle='#15131e';c.fillRect(0,0,w,h);glow(c,w*.16,h*.7,w*.6,'#925b8725');glow(c,w*.86,h*.24,w*.45,'#316c7330');
    const colors=['#ad587c','#ec8a9b','#ffbd9d','#f8dba9','#d8ddbb','#8ec6bd','#6b9eaf','#8f87b0','#ba8bb1'];
    function point(u,v,river) {
      let x=w*(-.18+u*1.37)+Math.sin(u*TAU+t*.09+river)*w*.038;
      const base=river===0?.80:.15;
      const y=h*(base-.16*u)+Math.sin(u*TAU*.92-t*.065+river*.9)*h*.12;
      const fold=Math.exp(-Math.pow((u-.34-river*.18)/.22,2));
      x+=Math.sin(v*9+u*8+t*.075)*w*.028*fold;
      const curl=Math.sin(u*TAU*2.15+t*.10+v*.8)*h*.022+Math.cos(v*7+u*9-t*.08)*h*.05*fold;
      return [x,y+v*h*(river===0?.26:.19)+curl+Math.sin(u*34+v*11+t*.15)*h*.0015];
    }
    for(let river=1;river>=0;river--) {
      // Close neighboring strokes behave like pigmented streams, with moving veins.
      for(let j=0;j<108;j++) {
        const v=j/107-.5,shade=colors[Math.floor(j/12)%colors.length];
        const gradient=c.createLinearGradient(0,h,w,0);gradient.addColorStop(0,shade+'4d');gradient.addColorStop(.3,shade+'c7');gradient.addColorStop(.76,shade+'d4');gradient.addColorStop(1,shade+'50');
        c.strokeStyle=gradient;c.lineWidth=h*(river===0?.0035:.0026);c.lineCap='round';c.beginPath();
        for(let k=0;k<=100;k++){const p=point(k/100,v,river);k?c.lineTo(...p):c.moveTo(...p);}c.stroke();
        if(j%4===0){c.lineWidth=.55;c.strokeStyle='#fff7eb28';c.stroke();}
      }
      // Pearlescent droplets ride the pigment flow rather than floating at random.
      for(let i=0;i<32;i++) {
        const u=fract(i*.618+t*.018),v=Math.sin(i*19.3)*.45,p=point(u,v,river);
        c.fillStyle=colors[i%colors.length]+'bf';c.beginPath();c.ellipse(p[0],p[1],1.5+(i%3),.65+(i%2),-.12,0,TAU);c.fill();
      }
    }
    const hush=c.createRadialGradient(w*.5,h*.42,20,w*.5,h*.42,w*.4);hush.addColorStop(0,'#15131e5c');hush.addColorStop(1,'transparent');c.fillStyle=hush;c.fillRect(0,0,w,h);
  }
  function stars(c,w,h,t) {
    c.fillStyle='#0b0e1c';c.fillRect(0,0,w,h);glow(c,w*.22,h*.58,w*.52,'#51478b28');glow(c,w*.83,h*.29,w*.47,'#1d668c27');
    const random=rng(9742);
    for(let i=0;i<90;i++){const x=random()*w,y=random()*h;c.fillStyle='#c7d0f8'+(i%4===0?'63':'27');c.beginPath();c.arc(x,y,random()*.9+.2,0,TAU);c.fill();}
    // Several braided particle streams circle a broad vortex to the right.
    const cx=w*.79,cy=h*.53,s=Math.min(w,h);
    c.save();c.globalCompositeOperation='screen';
    for(let i=0;i<(w<700?360:780);i++) {
      const lane=i%7,u=fract(i*.6180339+t*(.007+lane*.00055));
      const a=u*TAU*1.55+t*.045+lane*.055,r=s*(.13+u*.46);
      const x=cx+Math.cos(a)*r*1.45,y=cy+Math.sin(a)*r*.69+Math.sin(a*3+lane*.1)*s*.03;
      const fade=Math.min(1,u*9,(1-u)*9),size=.6+(i%5)*.27;
      c.globalAlpha=fade*(.22+(i%7)*.10);c.fillStyle=['#e9c9a2','#a7b5ff','#86dcdb','#f2dff1'][lane%4];
      c.beginPath();c.arc(x,y,size,0,TAU);c.fill();
      if(i%17===0){glow(c,x,y,8+(i%4)*2,'#c5b4ff22');c.fillStyle='#fff4dc';c.fillRect(x-.5,y-3,.8,6);c.fillRect(x-3,y-.5,6,.8);}
    }
    c.restore();c.globalAlpha=1;
    glow(c,cx,cy,s*.16,'#807cdb12');
  }
  function forestLayer(c,w,h) {
    const random=rng(973);
    for(let plane=0;plane<3;plane++) {
      c.strokeStyle=['#163c3c','#102b2d','#091e24'][plane];c.fillStyle=c.strokeStyle;
      const n=12-plane*3;
      for(let i=0;i<n;i++) {
        const x=(i/(n-1))*w+(random()-.5)*w*.07,base=h*1.04,top=h*(.05+random()*.33),width=(6+random()*18)*(1+plane*.5);
        c.lineCap='round';c.lineWidth=width;c.beginPath();c.moveTo(x,base);c.bezierCurveTo(x-width*1.5,h*.7,x+width,top+h*.2,x+width*2,top);c.stroke();
        for(let j=0;j<4;j++) {const y=top+(base-top)*(.14+j*.13),dir=j%2?1:-1;c.lineWidth=width*.22;c.beginPath();c.moveTo(x,y+h*.12);c.quadraticCurveTo(x+dir*w*.05,y-h*.04,x+dir*w*(.06+random()*.04),y-h*.08);c.stroke();}
      }
    }
    // Ferns frame the floor without crowding the timer.
    for(let i=0;i<16;i++){
      const x=random()*w,y=h*(.9+random()*.12),s=30+random()*70;c.strokeStyle='#1a484140';c.lineWidth=1;
      for(let j=0;j<8;j++){const yy=y-j*s*.1;c.beginPath();c.moveTo(x,yy);c.quadraticCurveTo(x-s*.2,yy-s*.15,x-s*(.4-j*.04),yy-s*.2);c.moveTo(x,yy);c.quadraticCurveTo(x+s*.2,yy-s*.15,x+s*(.4-j*.04),yy-s*.2);c.stroke();}
    }
  }
  function fireflies(c,w,h,t) {
    c.fillStyle='#061c22';c.fillRect(0,0,w,h);glow(c,w*.8,h*.16,w*.58,'#326a6542');glow(c,w*.18,h*.88,w*.42,'#32695724');
    c.globalAlpha=.62;c.drawImage(layer('forest',w,h,ctx=>forestLayer(ctx,w,h)),0,0);c.globalAlpha=1;
    for(let i=0;i<(w<700?95:190);i++) {
      const lane=i%4,u=fract(i*.618+t*(.006+lane*.0009));
      const x=w*(-.06+u*1.12)+Math.sin(u*TAU*2+t*.13+lane)*w*.035;
      const y=h*(.72-lane*.095)+Math.sin(u*TAU*1.6-lane*.8+t*.095)*h*.16;
      const pulse=.4+.6*Math.pow(Math.sin(t*.55+i*1.87),2),fade=Math.min(1,u*10,(1-u)*10);
      c.globalAlpha=pulse*fade;glow(c,x,y,8+i%5*2,i%3===0?'#bbdf6733':'#6fd2ae30');
      c.fillStyle=i%3===0?'#e7f5ab':'#a0e5cc';c.beginPath();c.arc(x,y,.8+i%3*.38,0,TAU);c.fill();
      if(i%4===0){c.strokeStyle='#a1d58e18';c.lineWidth=.7;c.beginPath();c.moveTo(x,y);c.quadraticCurveTo(x-13,y+4,x-22,y+1);c.stroke();}
    }
    c.globalAlpha=1;
    const mist=c.createLinearGradient(0,h*.68,0,h);mist.addColorStop(0,'transparent');mist.addColorStop(1,'#466c5b25');c.fillStyle=mist;c.fillRect(0,0,w,h);
  }
  function classic(c,w,h,t,id) {
    const colors=id==='ember'?['#d98044','#bd5264']:id==='clay'?['#ba8466','#a7ba8b']:id==='mist'?['#83a7de','#a1c8cb']:['#50b99d','#5b88ca'];
    glow(c,w*(.18+Math.sin(t*.02)*.05),h*.2,w*.6,colors[0]+'28');glow(c,w*.85,h*.75,w*.5,colors[1]+'24');
  }
  window.CadenceAtmospheres={draw(c,w,h,t,id){
    c.save();c.clearRect(0,0,w,h);
    if(id==='sakura')cherry(c,w,h,t);else if(id==='solstice')paintRiver(c,w,h,t);else if(id==='aurora')stars(c,w,h,t);else if(id==='tidal')fireflies(c,w,h,t);else classic(c,w,h,t,id);
    c.restore();
  }};
})();
