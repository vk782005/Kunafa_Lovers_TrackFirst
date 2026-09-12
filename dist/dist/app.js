(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const povStyle = document.createElement('style');
  povStyle.textContent = `.panel-top{position:relative}.view-controls{display:flex;gap:4px;margin-left:auto;margin-right:18px}.view-button{border:1px solid #303b3e;background:#151d20;color:#899698;border-radius:2px;padding:7px 9px;font:10px var(--mono);letter-spacing:.8px}.view-button.active{background:var(--lime);border-color:var(--lime);color:#101710}.view-button:hover{color:var(--lime)}.view-button.active:hover{color:#101710}.pov-view{display:none;position:absolute;inset:0;overflow:hidden;background:#0b1013}.map-wrap.pov-mode #map,.map-wrap.pov-mode .map-legend,.map-wrap.pov-mode .lap-overlay{opacity:0;pointer-events:none}.map-wrap.pov-mode .pov-view{display:block}.pov-sky{height:45%;padding:28px 30px;display:flex;justify-content:space-between;color:#94a1a4;font:11px var(--mono);letter-spacing:1px;background:linear-gradient(180deg,#101b22 0%,#192831 65%,#4b5552 100%)}.pov-sky span:last-child{color:var(--lime)}.pov-track{position:absolute;inset:23% 0 0;background:linear-gradient(180deg,#3d4748 0%,#1e292c 24%,#111719 100%);clip-path:polygon(40% 0,60% 0,100% 100%,0 100%);perspective:500px}.pov-track:before,.pov-track:after{content:"";position:absolute;top:1%;height:99%;width:5px;background:repeating-linear-gradient(180deg,#eef0dc 0 16px,#cf6170 16px 30px);opacity:.9}.pov-track:before{left:39%}.pov-track:after{right:39%}.pov-horizon{position:absolute;top:4%;left:32%;right:32%;height:2px;background:#a1afa9;opacity:.35}.pov-apex{position:absolute;top:29%;left:50%;width:20px;height:20px;transform:translateX(-50%) rotate(45deg);border-top:2px solid var(--lime);border-right:2px solid var(--lime);opacity:.7}.pov-hud{position:absolute;left:30px;right:30px;bottom:70px;display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:13px 15px;border:1px solid #667271;background:#0b1013c7;color:#b8c3c2}.pov-hud small{display:block;color:#7f8c8d;font:10px var(--mono);letter-spacing:1px;margin-bottom:4px}.pov-hud strong{font:24px 'Barlow Condensed',sans-serif;color:var(--lime);letter-spacing:.3px}.pov-hud em{font:10px var(--mono);font-style:normal;color:#9babaa;margin-left:4px}.pov-wheel{position:absolute;left:50%;bottom:-68px;width:230px;height:130px;transform:translateX(-50%);border:13px solid #101619;border-radius:50% 50% 0 0;color:#708082;text-align:center;padding-top:17px;font:11px var(--mono);letter-spacing:2px;box-shadow:0 -3px 0 #556063}.pov-wheel:before,.pov-wheel:after{content:"";position:absolute;top:38px;width:9px;height:50px;background:#161f22}.pov-wheel:before{left:52px;transform:rotate(27deg)}.pov-wheel:after{right:52px;transform:rotate(-27deg)}.pov-wheel i{display:block;width:9px;height:9px;background:var(--lime);border-radius:50%;margin:8px auto}.pov-note{position:absolute;left:30px;bottom:25px;color:#859394;font:10px var(--mono);letter-spacing:1px}.pov-note .live-dot{margin-right:7px}.driver-lock{margin:0 18px 4px;border:1px solid #303b3e;background:#131a1d;padding:11px 12px;display:flex;align-items:center;justify-content:space-between;gap:12px}.driver-lock span{font:10px var(--mono);letter-spacing:1px;color:var(--muted)}.driver-lock strong{font:11px var(--mono);color:var(--lime);font-weight:500}.select-label{display:none}@media(max-width:800px){.view-controls{margin-right:10px}.view-button{padding:6px 7px;font-size:9px}.pov-sky{padding:20px 18px;font-size:9px}.pov-hud{left:18px;right:18px;bottom:62px}.pov-note{left:18px;bottom:18px}.driver-lock{margin-bottom:2px}}@media(max-width:480px){.panel-top{gap:5px}.panel-top>span:first-child{font-size:10px}.view-controls{margin-right:0}.view-button{padding:6px 5px;font-size:8px}.pov-sky{height:42%;padding:18px 15px;flex-direction:column;gap:6px}.pov-hud{left:12px;right:12px;bottom:54px;padding:10px;gap:4px}.pov-hud strong{font-size:21px}.pov-note{left:12px;bottom:14px}.pov-wheel{width:190px}.driver-lock strong{font-size:10px}}`;
  document.head.appendChild(povStyle);
  const duration = 76;
  let time = 38, playing = false, rate = 1, view = 'circuit', lastFrame = 0;
  const path = $('circuit'), length = path.getTotalLength();
  const ns = 'http://www.w3.org/2000/svg';
  const cars = ['OCO','GAS','ALO'].map(code => {
    const group = document.createElementNS(ns,'g');
    group.innerHTML = '<circle class="halo" r="15" fill="none" stroke-width="1.5" opacity=".65"/><circle r="9" fill="#101518"/><circle class="dot" r="5"/><text y="-23" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-size="12" font-weight="600">'+code+'</text>';
    $('markers').append(group); return {code,group};
  });
  const clamp = n => Math.max(0,Math.min(duration,n));
  const gapAt = t => Math.max(.12, .77 + .35*Math.sin((t-38)*.19) -.212*Math.cos((t-38)*.075));
  function setTime(t) {time=clamp(t);render();}
  function playToggle(){if(time>=duration)time=0;playing=!playing;render();}
  function render(){
    const vsc=time>=15.2 && time<30.4;
    const gap=gapAt(time);
    $('lap').textContent=Math.min(40,30+Math.floor(time/duration*10));
    $('race-state').textContent=vsc?'VIRTUAL SAFETY CAR':'GREEN FLAG';
    $('race-state').classList.toggle('vsc',vsc);
    $('map-status').textContent=vsc?'VSC IN PROGRESS':'TRACK CLEAR';
    $('driver-number').textContent='31';
    $('driver-name').innerHTML='Esteban<br>Ocon';
    $('position').textContent='P14';
    $('ahead-name').textContent='10 · GASLY';
    const speed=Math.round((vsc?115:205)+(vsc?28:83)*Math.sin(time*.79)**2);
    $('speed').innerHTML=speed+' <small>km/h</small>';
    $('pov-speed').innerHTML=speed+' <em>KM/H</em>';
    $('pov-gear').textContent=speed>250?'7':speed>205?'6':speed>160?'5':'4';
    $('pov-lap').innerHTML=`${Math.min(40,30+Math.floor(time/duration*10))} <em>/ 58</em>`;
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
    const offsets={OCO:0,GAS:gapAt(time)/80,ALO:-gapAt(time)/80};
    for(const car of cars){
      const p=path.getPointAtLength(((base+offsets[car.code])%1+1)%1*length);
      const selected=car.code==='OCO';
      const ahead=car.code==='GAS';
      const color=selected?'#b7f578':ahead?'#f479a2':'#e3e8ea';
      car.group.setAttribute('transform',`translate(${p.x} ${p.y})`);
      car.group.querySelector('.dot').setAttribute('fill',color);
      car.group.querySelector('.halo').setAttribute('stroke',color);
      car.group.querySelector('.halo').setAttribute('r',selected?'17':'12');
      const label=car.group.querySelector('text');label.setAttribute('fill',color);
      label.textContent=car.code==='ALO'?'AL0':car.code;
      label.setAttribute('y',car.code==='OCO'?'-25':car.code==='GAS'?'30':'-42');
    }
    document.querySelector('.map-wrap').classList.toggle('pov-mode',view==='pov');
    $('map').setAttribute('aria-hidden',view==='pov'?'true':'false');
    $('pov-view').setAttribute('aria-hidden',view==='pov'?'false':'true');
    $('view-label').textContent=view==='pov'?'DRIVER POV':'CIRCUIT VIEW';
    $('circuit-view').classList.toggle('active',view==='circuit');
    $('pov-view-button').classList.toggle('active',view==='pov');
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
  $('circuit-view').addEventListener('click',()=>{view='circuit';render();});
  $('pov-view-button').addEventListener('click',()=>{view='pov';render();});
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
      description:'Seek the simulated Esteban Ocon race replay and set playback state.',
      inputSchema:{type:'object',properties:{seconds:{type:'number',minimum:0,maximum:76},playing:{type:'boolean'}},required:['seconds','playing'],additionalProperties:false},
      annotations:{readOnlyHint:false,untrustedContentHint:false},
      execute(input){
        if(!input||typeof input.seconds!=='number'||!Number.isFinite(input.seconds)||input.seconds<0||input.seconds>76||typeof input.playing!=='boolean'||Object.keys(input).some(k=>!['seconds','playing'].includes(k)))throw new Error('Expected seconds from 0 to 76 and a boolean playing.');
        playing=input.playing;time=input.seconds;updateSpark();render();
        return {seconds:time,driver:'OCO',playing,gap:gapAt(time),simulated:true};
      }
    },{signal:lifecycle.signal})).catch(()=>{});}catch{}
  }
})();
