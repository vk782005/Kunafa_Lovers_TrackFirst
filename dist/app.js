(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const duration = 76;
  let time = 38, playing = false, rate = 1, focus = 'OCO', lastFrame = 0;
  const path = $('circuit'), length = path.getTotalLength();
  const ns = 'http://www.w3.org/2000/svg';
  const cars = ['OCO','GAS','BEA'].map(code => {
    const group = document.createElementNS(ns,'g');
    group.innerHTML = '<circle class="halo" r="15" fill="none" stroke-width="1.5" opacity=".65"/><circle r="9" fill="#101518"/><circle class="dot" r="5"/><text y="-23" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-size="12" font-weight="600">'+code+'</text>';
    $('markers').append(group); return {code,group};
  });
  const clamp = n => Math.max(0,Math.min(duration,n));
  const gapAt = (t,driver=focus) => Math.max(.12, .77 + .35*Math.sin((t-38)*.19) -.212*Math.cos((t-38)*.075)+(driver==='BEA'?.27:0));
  function setTime(t) {time=clamp(t);render();}
  function playToggle(){if(time>=duration)time=0;playing=!playing;render();}
  function render(){
    const vsc=time>=15.2 && time<30.4;
    const gap=gapAt(time);
    $('lap').textContent=Math.min(40,30+Math.floor(time/duration*10));
    $('race-state').textContent=vsc?'VIRTUAL SAFETY CAR':'GREEN FLAG';
    $('race-state').classList.toggle('vsc',vsc);
    $('map-status').textContent=vsc?'VSC IN PROGRESS':'TRACK CLEAR';
    $('driver-number').textContent=focus==='OCO'?'31':'87';
    $('driver-name').innerHTML=focus==='OCO'?'Esteban<br>Ocon':'Oliver<br>Bearman';
    $('position').textContent=focus==='OCO'?'P14':'P15';
    $('ahead-name').textContent=focus==='OCO'?'10 · GASLY':'31 · OCON';
    const speed=Math.round((vsc?115:205)+(vsc?28:83)*Math.sin(time*.79)**2);
    $('speed').innerHTML=speed+' <small>km/h</small>';
    $('gap').textContent=gap.toFixed(3);
    $('gap-fill').style.width=Math.min(100,gap/2*100)+'%';
    const active=gap<1&&!vsc;
    $('gap-fill').style.background=active?'var(--lime)':'#f1c75e';
    $('gate-state').textContent=vsc?'DETECTION SUSPENDED':active?'WITHIN DETECTION':'OUTSIDE DETECTION';
    $('gate-detail').textContent=vsc?'Virtual safety car is active':active?'Gap under the 1.0 s threshold':'Gap above the 1.0 s threshold';
    $('gate-icon').textContent=active?'◎':'◌';
    $('timeline').value=time;
    $('timeline').style.background=`linear-gradient(to right,#b7f578 ${time/duration*100}%,#303b3d ${time/duration*100}%)`;
    $('time-label').innerHTML=`${String(Math.floor(time/60)).padStart(2,'0')}:${String(Math.floor(time%60)).padStart(2,'0')} <span>/ 01:16</span>`;
    $('play').textContent=playing?'Ⅱ':'▶';
    $('play').setAttribute('aria-label',playing?'Pause replay':'Play replay');
    const base=.02+(time-38)*.132;
    const offsets={OCO:0,GAS:gapAt(time,'OCO')/80,BEA:-gapAt(time,'BEA')/80};
    for(const car of cars){
      const p=path.getPointAtLength(((base+offsets[car.code])%1+1)%1*length);
      const selected=car.code===focus;
      const ahead=car.code===(focus==='OCO'?'GAS':'OCO');
      const color=selected?'#b7f578':ahead?'#f479a2':'#e3e8ea';
      car.group.setAttribute('transform',`translate(${p.x} ${p.y})`);
      car.group.querySelector('.dot').setAttribute('fill',color);
      car.group.querySelector('.halo').setAttribute('stroke',color);
      car.group.querySelector('.halo').setAttribute('r',selected?'17':'12');
      const label=car.group.querySelector('text');label.setAttribute('fill',color);
      label.setAttribute('y',car.code==='OCO'?'-25':car.code==='GAS'?'30':'-42');
    }
    $('spark-cursor').setAttribute('x1',time/duration*300);$('spark-cursor').setAttribute('x2',time/duration*300);
  }
  function updateSpark(){let d='';for(let i=0;i<=152;i++){const x=i/152*300,y=64-gapAt(i/2)/2*64;d+=(i?'L':'M')+x.toFixed(2)+' '+y.toFixed(2);} $('spark-path').setAttribute('d',d);}
  $('play').addEventListener('click',playToggle);
  $('reset').addEventListener('click',()=>{playing=false;setTime(0);});
  $('back').addEventListener('click',()=>setTime(time-5));
  $('forward').addEventListener('click',()=>setTime(time+5));
  $('jump').addEventListener('click',()=>setTime(15.2));
  $('timeline').addEventListener('input',e=>setTime(Number(e.target.value)));
  $('rate').addEventListener('change',e=>{rate=Number(e.target.value);});
  $('driver').addEventListener('change',e=>{focus=e.target.value;updateSpark();render();});
  $('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{$('fullscreen').title='Full screen is unavailable in this browser';}});
  document.addEventListener('keydown',e=>{if(/INPUT|SELECT|BUTTON|TEXTAREA/.test(e.target.tagName)||e.altKey||e.ctrlKey||e.metaKey)return;if(e.code==='Space'){e.preventDefault();playToggle();}if(e.code==='ArrowLeft'){e.preventDefault();setTime(time-5);}if(e.code==='ArrowRight'){e.preventDefault();setTime(time+5);}});
  function frame(now){const delta=lastFrame?Math.min((now-lastFrame)/1000,.1):0;lastFrame=now;if(playing){time=clamp(time+delta*rate);if(time>=duration)playing=false;render();}requestAnimationFrame(frame);}
  updateSpark();render();requestAnimationFrame(frame);
  const context=document.modelContext;
  if(context?.registerTool){
    const lifecycle=new AbortController();
    window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
    try{Promise.resolve(context.registerTool({
      name:'configure_race_replay',title:'Configure race replay',
      description:'Seek the simulated race replay, select a Haas driver, and set playback state.',
      inputSchema:{type:'object',properties:{seconds:{type:'number',minimum:0,maximum:76},driver:{type:'string',enum:['OCO','BEA']},playing:{type:'boolean'}},required:['seconds','driver','playing'],additionalProperties:false},
      annotations:{readOnlyHint:false,untrustedContentHint:false},
      execute(input){
        if(!input||typeof input.seconds!=='number'||!Number.isFinite(input.seconds)||input.seconds<0||input.seconds>76||!['OCO','BEA'].includes(input.driver)||typeof input.playing!=='boolean'||Object.keys(input).some(k=>!['seconds','driver','playing'].includes(k)))throw new Error('Expected seconds from 0 to 76, driver OCO or BEA, and a boolean playing.');
        focus=input.driver;playing=input.playing;time=input.seconds;$('driver').value=focus;updateSpark();render();
        return {seconds:time,driver:focus,playing,gap:gapAt(time),simulated:true};
      }
    },{signal:lifecycle.signal})).catch(()=>{});}catch{}
  }
})();
