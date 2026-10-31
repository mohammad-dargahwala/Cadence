/* Signature moments use accumulated art time, never wall timers or frame counts.
 * Hashed arrival slots keep memory bounded and all render surfaces in sync. */
(function(){
  'use strict';
  const TAU=Math.PI*2,previews=new Map();
  const definition=(type,label,period,jitter,duration,seed)=>({type,label,period,jitter,duration,seed});
  const catalog={
    horizon:[definition('comet','Comet capture',30,10,9,31),definition('supernova','Supernova',120,30,16,61)],
    nebula:[definition('birth','Star birth',47,15,13,72),definition('dust','Luminous dust wave',85,25,18,79)],
    valley:[definition('birds','Passing flock',48,16,16,83),definition('sunbeam','Sunbreak',91,25,21,97)],
    abyss:[definition('fish','Luminous shoal',54,18,17,102),definition('pulse','Bioluminescent pulse',86,23,15,109)],
    lantern:[definition('release','Lantern release',52,16,22,117),definition('breeze','Lake breeze',88,24,16,127)],
    sakura:[definition('petals','Blossom gust',42,14,15,137)],
    solstice:[definition('pigment','Pigment bloom',45,14,18,149),definition('fold','Color fold',81,22,20,157)],
    aurora:[definition('meteors','Meteor shower',53,17,12,163),definition('constellation','Constellation',92,25,18,173)],
    tidal:[definition('fireflies','Firefly wave',46,15,14,181),definition('leaf','Drifting leaf',77,22,17,193)],
    polar:[definition('crown','Auroral crown',64,20,22,211)],
    rain:[definition('merge','Gathering raindrop',43,13,14,223),definition('headlights','Passing headlights',69,20,14,229)],
    dunes:[definition('devil','Distant dust devil',73,22,23,239),definition('sandgust','Ridge gust',49,15,16,251)]
  };
  const clamp=x=>Math.max(0,Math.min(1,x));
  const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
  function hash(n,seed){let v=Math.imul(n^seed,0x45d9f3b);v=Math.imul(v^(v>>>16),0x45d9f3b);return((v^(v>>>16))>>>0)/4294967296;}
  function event(def,start,t,seed){
    const u=(t-start)/def.duration;
    return {...def,start,u,seed,alpha:smooth(u/.12)*smooth((1-u)/.22)};
  }
  function sample(id,t){
    if(!Number.isFinite(t)||!catalog[id])return [];
    const preview=previews.get(id);
    if(preview&&t>=preview.start&&t<preview.start+preview.def.duration)return [event(preview.def,preview.start,t,preview.seed)];
    const active=[];
    for(const def of catalog[id]){
      const slot=Math.floor(t/def.period);
      for(let n=Math.max(0,slot-1);n<=slot;n++){
        const start=n*def.period+hash(n,def.seed)*def.jitter;
        if(t>=start&&t<start+def.duration)active.push(event(def,start,t,Math.floor(hash(n,def.seed+11)*1000000)));
      }
    }return active;
  }
  function cue(id,t){
    if(!catalog[id]||!Number.isFinite(t))return;
    const previous=previews.get(id),index=previous?previous.index+1:0,def=catalog[id][index%catalog[id].length];
    previews.set(id,{index,def,start:t,seed:Math.floor(hash(index,def.seed+47)*1000000)});
    return def.label;
  }
  function glow(c,x,y,r,color){const g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,color);g.addColorStop(1,color.slice(0,7)+'00');c.fillStyle=g;c.fillRect(x-r,y-r,2*r,2*r);}
  function ring(c,x,y,r,color,scaleY=1){c.save();c.translate(x,y);c.scale(1,scaleY);c.strokeStyle=color;c.lineWidth=1.3;c.beginPath();c.arc(0,0,r,0,TAU);c.stroke();c.restore();}
  function petal(c,x,y,s,a,color){
    c.save();c.translate(x,y);c.rotate(a);c.fillStyle=color;c.beginPath();c.moveTo(0,-s);c.bezierCurveTo(s,-s,s,s,0,s*.7);c.bezierCurveTo(-s,s,-s,-s,0,-s);c.fill();c.restore();
  }
  function nova(c,w,h,e,bubble){
    const x=w*(.15+hash(1,e.seed)*.7),y=h*(.12+hash(2,e.seed)*.34),s=Math.min(w,h);
    glow(c,x,y,s*(.03+Math.sin(e.u*Math.PI)*.14),'#b9d9ff9c');
    const radius=e.u*Math.hypot(w,h)*1.15;
    c.save();c.globalAlpha*=1-e.u;
    for(let i=0;i<5;i++)ring(c,x,y,Math.max(.1,radius-i*s*.008),'#c1d9fb'+(i?'16':'70'));
    c.restore();glow(c,x,y,s*.025,'#fff6dcce');
    if(!bubble){c.strokeStyle='#e6f2ff99';c.lineWidth=.9;c.beginPath();c.moveTo(x-s*.04*(1-e.u),y);c.lineTo(x+s*.04*(1-e.u),y);c.moveTo(x,y-s*.04*(1-e.u));c.lineTo(x,y+s*.04*(1-e.u));c.stroke();}
  }
  function infall(c,r,t,bubble){
    for(const e of sample('horizon',t)){
      if(e.type!=='comet')continue;
      const angle=hash(1,e.seed)*TAU;
      const point=u=>{const a=angle+u*2.5,radius=r*(.66+8.2*(1-u)**1.85);return [Math.cos(a)*radius,Math.sin(a)*radius*.73];};
      c.save();c.globalCompositeOperation='screen';c.globalAlpha=e.alpha;
      const pieces=7;
      for(let part=pieces-1;part>=0;part--){
        const u=Math.max(0,e.u-part*.012),a=point(u),fragment=part?smooth((e.u-.40-part*.012)/.16):1;
        for(let j=26;j>0;j--){
          const tail=point(Math.max(0,u-j*.004)),next=point(Math.max(0,u-(j-1)*.004));
          c.strokeStyle=j<8?'#ffe8bd':'#da9d70';c.globalAlpha=e.alpha*(1-j/27)*(.85-part*.075)*fragment;
          c.lineWidth=r*(bubble?.012:.009)*(1-j/30)/(1+part*.3);
          c.beginPath();c.moveTo(tail[0],tail[1]+part*r*.014);c.lineTo(next[0],next[1]+part*r*.014);c.stroke();
        }
        glow(c,a[0],a[1]+part*r*.014,r*(part?.025:.06),'#ffe7bdbb');
      }c.restore();
    }
  }
  function birds(c,w,h,t,e,bubble){
    c.strokeStyle='#39464dbf';c.lineWidth=bubble?.8:1.2;
    for(let i=0;i<(bubble?4:11);i++){
      const x=w*(-.2+e.u*1.4-i*.022),y=h*(.23+Math.abs(i-5)*.012+Math.sin(e.u*3)*.035),s=Math.min(w,h)*(.006+hash(i,e.seed)*.005),flap=Math.sin(t*4+i)*s*.7;
      c.beginPath();c.moveTo(x-s,y-flap);c.quadraticCurveTo(x-s*.4,y-s*.3,x,y);c.quadraticCurveTo(x+s*.4,y-s*.3,x+s,y-flap);c.stroke();
    }
  }
  function fish(c,w,h,t,e,bubble){
    for(let i=0;i<(bubble?9:35);i++){
      const x=w*(-.3+e.u*1.6+hash(i,e.seed)*.26),y=h*(.38+hash(i+51,e.seed)*.25+Math.sin(t*.7+i)*.018),s=Math.min(w,h)*(.004+hash(i+81,e.seed)*.006);
      glow(c,x,y,s*4,'#89e3d838');c.fillStyle='#b6f0dfa6';c.beginPath();c.ellipse(x,y,s*1.5,s*.55,Math.sin(t*2+i)*.10,0,TAU);c.fill();
      c.beginPath();c.moveTo(x-s,y);c.lineTo(x-s*2.2,y-s*.65);c.lineTo(x-s*2.2,y+s*.65);c.fill();
    }
  }
  function lanternRelease(c,w,h,t,e,bubble){
    for(let i=0;i<(bubble?3:8);i++){
      const u=clamp((e.u-i*.025)/.82),x=w*(.25+hash(i,e.seed)*.46+Math.sin(u*4+i)*.035),y=h*(1.1-u*1.25),s=Math.min(w,h)*(.012+hash(i+11,e.seed)*.012);
      glow(c,x,y,s*3,'#ffc27b45');c.save();c.translate(x,y);c.rotate(Math.sin(t*.4+i)*.12);
      const g=c.createLinearGradient(-s,0,s,0);g.addColorStop(0,'#bb6a5f');g.addColorStop(.5,'#ffdc9f');g.addColorStop(1,'#cb876c');c.fillStyle=g;
      c.beginPath();c.ellipse(0,0,s*.7,s,0,0,TAU);c.fill();c.strokeStyle='#754b4c55';c.lineWidth=.7;
      for(let j=-1;j<=1;j++){c.beginPath();c.ellipse(j*s*.17,0,s*.25,s*.98,0,-Math.PI*.5,Math.PI*.5);c.stroke();}c.restore();
      if(!bubble&&y>h*.25&&y<h*.8){c.save();c.globalAlpha*=.25;c.fillStyle='#eeb57a';c.fillRect(x-s,h*.86,s*2,h*.003);c.restore();}
    }
  }
  function blossoms(c,w,h,t,e,bubble){
    for(let i=0;i<(bubble?24:85);i++){
      const q=hash(i,e.seed),u=clamp((e.u-q*.12)/.88),a=q*TAU+u*7;
      const x=w*(-.12+u*1.3)+Math.cos(a)*w*.13*Math.sin(u*Math.PI),y=h*(.25+q*.45)+Math.sin(a)*h*.13*Math.sin(u*Math.PI);
      petal(c,x,y,Math.min(w,h)*(.005+hash(i+94,e.seed)*.008),t*.7+i+u*5,['#d582a5b0','#e9abc3c9','#fff3e8d9'][i%3]);
    }
  }
  function pigment(c,w,h,t,e){
    const x=w*(.25+hash(1,e.seed)*.5),y=h*(.3+hash(2,e.seed)*.4),s=Math.min(w,h);
    c.save();c.globalCompositeOperation='screen';
    for(let i=0;i<35;i++){
      const a=i/35*TAU,r=s*(.015+e.u*.58)*(1+.16*Math.sin(i*3+e.u*8));
      c.strokeStyle=['#f8a9b970','#b1ddd77a','#f6ce9a66'][i%3];c.lineWidth=s*.0035*(1-e.u*.65);c.beginPath();c.moveTo(x,y);
      c.bezierCurveTo(x+Math.cos(a+.6)*r*.3,y+Math.sin(a+.6)*r*.3,x+Math.cos(a-.4)*r*.8,y+Math.sin(a-.4)*r*.8,x+Math.cos(a)*r,y+Math.sin(a)*r);c.stroke();
    }c.restore();
  }
  function meteors(c,w,h,e,bubble){
    for(let i=0;i<(bubble?3:9);i++){
      const u=clamp((e.u-i*.048)/.52),x=w*(hash(i,e.seed)*.8+u*.4),y=h*(-.12+hash(i+15,e.seed)*.4+u*.68);
      c.save();c.globalAlpha*=Math.sin(u*Math.PI);const g=c.createLinearGradient(x-w*.10,y-h*.13,x,y);g.addColorStop(0,'transparent');g.addColorStop(1,'#e4ebffda');c.strokeStyle=g;c.lineWidth=1.2;c.beginPath();c.moveTo(x-w*.10,y-h*.13);c.lineTo(x,y);c.stroke();glow(c,x,y,Math.min(w,h)*.009,'#d7e3ff99');c.restore();
    }
  }
  function constellation(c,w,h,e){
    c.strokeStyle='#c2b4f37a';c.lineWidth=.8;c.beginPath();
    for(let i=0;i<8;i++){const x=w*(.12+hash(i,e.seed)*.76),y=h*(.15+hash(i+14,e.seed)*.65);if(i)c.lineTo(x,y);else c.moveTo(x,y);}c.stroke();
    for(let i=0;i<8;i++){const x=w*(.12+hash(i,e.seed)*.76),y=h*(.15+hash(i+14,e.seed)*.65);glow(c,x,y,Math.min(w,h)*.025,'#d9ceff70');c.fillStyle='#f1e6ff';c.beginPath();c.arc(x,y,1.5,0,TAU);c.fill();}
  }
  function fireflies(c,w,h,t,e,bubble){
    for(let i=0;i<(bubble?24:90);i++){
      const x=w*(.04+hash(i,e.seed)*.92),y=h*(.18+hash(i+100,e.seed)*.75),wave=Math.exp(-Math.pow((x/w-e.u*1.5+.25)/.15,2));
      c.save();c.globalAlpha*=wave;glow(c,x,y,Math.min(w,h)*(.015+hash(i+88,e.seed)*.012),'#d4f7a985');
      c.fillStyle='#f1ffc4';c.beginPath();c.arc(x,y,1+hash(i+17,e.seed),0,TAU);c.fill();c.restore();
    }
  }
  function crown(c,w,h,t,e){
    const s=Math.min(w,h),x=w*.5,y=h*.28;
    c.save();c.globalCompositeOperation='screen';glow(c,x,y,s*.42,'#85e9c326');
    for(let i=0;i<95;i++){
      const a=i/95*TAU,r=s*(.08+.16*hash(i,e.seed))*(.7+e.u*.5),g=c.createLinearGradient(x,y,x+Math.cos(a)*r,y+Math.sin(a)*r);
      g.addColorStop(0,'#9aeed080');g.addColorStop(.5,'#aa9bda38');g.addColorStop(1,'transparent');c.strokeStyle=g;c.lineWidth=s*.004;c.beginPath();c.moveTo(x+Math.cos(a)*s*.015,y+Math.sin(a)*s*.015);c.quadraticCurveTo(x+Math.cos(a+.2)*r*.6,y+Math.sin(a+.2)*r*.6,x+Math.cos(a)*r,y+Math.sin(a)*r);c.stroke();
    }c.restore();
  }
  function mergePath(e,w,h){return {x:w*(.25+hash(1,e.seed)*.5+Math.sin(e.u*5)*.025),y:h*(-.05+e.u*1.2),r:Math.min(w,h)*.022};}
  function raindrop(c,w,h,e){
    const {x,y,r}=mergePath(e,w,h);c.strokeStyle='#c1deed29';c.lineWidth=r*1.5;c.beginPath();
    for(let j=0;j<=35;j++){const u=e.u*j/35,p=mergePath({...e,u},w,h);if(j)c.lineTo(p.x,p.y);else c.moveTo(p.x,p.y);}c.stroke();
    glow(c,x,y,r*1.6,'#b7d6ed2f');c.fillStyle='#131f325c';c.beginPath();c.ellipse(x,y,r,r*1.6,-.09,0,TAU);c.fill();
    c.strokeStyle='#d7edf3b0';c.lineWidth=1.3;c.beginPath();c.ellipse(x,y,r,r*1.6,-.09,Math.PI*.9,Math.PI*1.7);c.stroke();
    for(let i=0;i<7;i++){const a=i/7*TAU,d=r*(1+3*(1-e.u));c.fillStyle='#c6e2ed66';c.beginPath();c.arc(x+Math.cos(a)*d,y+Math.sin(a)*d,r*.13,0,TAU);c.fill();}
  }
  function sandDevil(c,w,h,t,e){
    const x=w*(.15+e.u*.65),base=h*.62,s=Math.min(w,h);
    c.save();
    for(let i=0;i<85;i++){
      const u=i/84,a=t*2.7+u*24,r=s*(.006+u*u*.038),xx=x+Math.cos(a)*r+Math.sin(u*4+e.u*2)*s*.012,yy=base-u*s*.20;
      c.strokeStyle=i%3?'#9b78623b':'#f8ddb473';c.lineWidth=.7+u*1.7;c.beginPath();c.ellipse(xx,yy,r,s*.003,0,0,Math.PI*1.6);c.stroke();
    }c.restore();
  }
  function gust(c,w,h,t,e,bubble){
    for(let i=0;i<(bubble?35:115);i++){
      const q=hash(i,e.seed),u=clamp((e.u-q*.2)/.8),x=w*(-.2+u*1.5),y=h*(.49+hash(i+55,e.seed)*.42)-Math.sin(u*Math.PI)*h*.06;
      c.strokeStyle=i%3?'#ffe2b295':'#8e6b4845';c.lineWidth=.5;c.beginPath();c.moveTo(x,y);c.quadraticCurveTo(x-w*.025,y+h*.003,x-w*.07,y+h*.006);c.stroke();
    }
  }
  function draw(c,w,h,t,id,bubble=false){
    const events=sample(id,t);
    if(c.canvas&&c.canvas.dataset)c.canvas.dataset.events=events.map(e=>e.type).join(',');
    for(const e of events){
      if(e.type==='comet')continue;
      c.save();c.globalAlpha=e.alpha*(bubble?.6:1);
      switch(e.type){
        case 'supernova':nova(c,w,h,e,bubble);break;
        case 'birth':{
          const x=w*(.15+hash(1,e.seed)*.7),y=h*(.15+hash(2,e.seed)*.6),s=Math.min(w,h);
          glow(c,x,y,s*(.03+.12*Math.sin(e.u*Math.PI)),'#f3d8ff83');glow(c,x,y,s*.012,'#fff7f5');
          ring(c,x,y,s*e.u*.35,'#c7c5ee38');break;
        }
        case 'dust':for(let j=0;j<5;j++)ring(c,w*.5,h*.43,Math.min(w,h)*(.06+e.u*.95+j*.018),'#9ed3e51b',.65);break;
        case 'birds':birds(c,w,h,t,e,bubble);break;
        case 'sunbeam':{
          c.globalCompositeOperation='screen';const x=w*(.2+e.u*.5),g=c.createLinearGradient(x,0,x,h);g.addColorStop(0,'#ffe4a24d');g.addColorStop(1,'transparent');c.fillStyle=g;
          c.beginPath();c.moveTo(x-w*.02,0);c.lineTo(x+w*.04,0);c.lineTo(x+w*.28,h);c.lineTo(x-w*.22,h);c.fill();break;
        }
        case 'fish':fish(c,w,h,t,e,bubble);break;
        case 'pulse':glow(c,w*.5,h*(.8-e.u*.6),Math.min(w,h)*.65,'#76e7d52a');for(let j=0;j<3;j++)ring(c,w*.5,h*.60,Math.min(w,h)*(e.u*.7+j*.03),'#b1f4e32c',.55);break;
        case 'release':lanternRelease(c,w,h,t,e,bubble);break;
        case 'breeze':for(let j=0;j<14;j++)ring(c,w*(.2+e.u*.6),h*.88,w*(.01+e.u*.15+j*.004),'#efb39434',.10);break;
        case 'petals':blossoms(c,w,h,t,e,bubble);break;
        case 'pigment':pigment(c,w,h,t,e);break;
        case 'fold':{
          c.globalCompositeOperation='screen';c.strokeStyle='#e9b5b956';c.lineWidth=Math.min(w,h)*.018;c.beginPath();
          c.moveTo(-w*.1,h*(.2+e.u*.5));c.bezierCurveTo(w*.3,h*(1-e.u),w*.6,h*e.u,w*1.1,h*(.8-e.u*.5));c.stroke();break;
        }
        case 'meteors':meteors(c,w,h,e,bubble);break;
        case 'constellation':constellation(c,w,h,e);break;
        case 'fireflies':fireflies(c,w,h,t,e,bubble);break;
        case 'leaf':{
          const x=w*(.15+e.u*.8+Math.sin(e.u*9)*.07),y=h*(-.1+e.u*1.2);petal(c,x,y,Math.min(w,h)*.019,t*.6+Math.sin(e.u*7),'#c2cf817d');glow(c,x,y,Math.min(w,h)*.044,'#d6ef7933');break;
        }
        case 'crown':crown(c,w,h,t,e);break;
        case 'merge':raindrop(c,w,h,e);break;
        case 'headlights':{
          const x=w*(-.3+e.u*1.6),y=h*.76;for(let j=0;j<2;j++)glow(c,x+j*w*.055,y,Math.min(w,h)*.15,'#ffe2b789');break;
        }
        case 'devil':sandDevil(c,w,h,t,e);break;
        case 'sandgust':gust(c,w,h,t,e,bubble);break;
      }c.restore();
    }
  }
  function timer(c,w,h,t,id){
    if(id==='horizon'||id==='rain')return; // Already painted beneath their foreground.
    c.save();c.beginPath();c.rect(0,0,w,h);c.moveTo(w*.5+Math.min(w,h)*.34,h*.5);c.arc(w*.5,h*.5,Math.min(w,h)*.34,0,TAU,true);c.clip('evenodd');
    draw(c,w,h,t,id,true);c.restore();
  }
  window.CadenceSceneEvents={catalog,sample,cue,draw,timer,infall,mergePath};
})();
