/* Small, layered instruments. All notes use the audio clock, including their hard stop. */
(function () {
  'use strict';
  const sounds=[['chime','Glass chimes'],['bell','Warm piano'],['bowl','Singing bowl'],['harp','Harp cascade'],['ripple','Water droplets'],['digital','Soft pulse'],['none','Silent']];
  const scores={
    chime:{notes:[[0,783.99],[.35,1174.66],[.75,1567.98]],partials:[[1,1],[2.01,.25],[3.98,.08]],decay:1.8,attack:.012},
    bell:{notes:[[0,261.63],[.24,329.63],[.5,392],[.86,523.25]],partials:[[1,1],[2,.28],[3,.12],[4,.04]],decay:1.7,attack:.01},
    bowl:{notes:[[0,220],[.04,220.8],[.62,330]],partials:[[1,1],[2.72,.2],[5.4,.07]],decay:2.6,attack:.09},
    harp:{notes:[[0,392],[.17,493.88],[.34,587.33],[.51,783.99],[.78,987.77]],partials:[[1,1],[2,.2],[3,.07]],decay:1.4,attack:.006},
    ripple:{notes:[[0,880],[.38,1318.51],[.85,1046.5]],partials:[[1,1],[2.001,.16]],decay:1,attack:.025,slide:true},
    digital:{notes:[[0,523.25],[.22,659.25],[.55,783.99]],partials:[[1,1],[2,.10]],decay:.42,attack:.025}
  };
  function play(ac,destination,id,options={}){
    const score=scores[id];if(!score)return null;
    const now=ac.currentTime,start=now+.006,limit=Number.isFinite(options.limit)?Math.max(0,options.limit):Infinity;
    const deadline=now+limit,voices=[],master=ac.createGain();let naturalEnd=now,stopped=false,remaining=0;
    master.gain.setValueAtTime(1,now);master.connect(destination);
    const volume=Math.max(0,Math.min(1,Number(options.volume)||0));
    for(const [offset,freq] of score.notes){
      // Quiet secondary taps give the instruments space without an unbounded reverb tail.
      for(const [echo,level]of [[0,1],[.19,.12],[.37,.045]]){
        const at=start+offset+echo,end=Math.min(at+score.decay,deadline);if(end-at<.035)continue;
        for(const [ratio,strength]of score.partials){
          const oscillator=ac.createOscillator(),gain=ac.createGain(),attack=Math.min(score.attack,(end-at)*.2);
          oscillator.type='sine';oscillator.frequency.setValueAtTime(freq*ratio,at);
          if(score.slide)oscillator.frequency.exponentialRampToValueAtTime(freq*ratio*.93,end);
          const peak=.15*volume*strength*level/Math.sqrt(score.partials.length);
          gain.gain.setValueAtTime(.00001,at);gain.gain.linearRampToValueAtTime(Math.max(.00002,peak),at+attack);
          gain.gain.exponentialRampToValueAtTime(.00001,end-.012);gain.gain.linearRampToValueAtTime(0,end);
          oscillator.connect(gain);gain.connect(master);oscillator.start(at);oscillator.stop(end);remaining++;
          oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();if(--remaining===0)master.disconnect();};voices.push({node:oscillator,end});naturalEnd=Math.max(naturalEnd,end);
        }
      }
    }
    if(!remaining)master.disconnect();
    return {end:naturalEnd,cutOff(seconds){const at=ac.currentTime+Math.max(0,seconds),fade=Math.max(ac.currentTime,at-.012);
      master.gain.cancelScheduledValues(fade);master.gain.setValueAtTime(1,fade);master.gain.linearRampToValueAtTime(0,at);
      voices.forEach(v=>{try{v.node.stop(Math.min(v.end,at));}catch{}});
    },stop(){if(stopped)return;stopped=true;const at=ac.currentTime;
      master.gain.cancelScheduledValues(at);master.gain.setTargetAtTime(0,at,.004);
      voices.forEach(v=>{try{v.node.stop(Math.min(v.end,at+.02));}catch{}});
    }};
  }
  function duration(settings,musicPlaying){
    const normal=Number(settings.alarmDuration),music=Number(settings.musicAlarmDuration);
    const base=Number.isFinite(normal)?Math.max(0,Math.min(120,normal)):0;
    return musicPlaying?Math.min(base||Infinity,Number.isFinite(music)?Math.max(1,Math.min(30,music)):3):base;
  }
  window.CadenceAlarm={sounds,play,duration};
})();
