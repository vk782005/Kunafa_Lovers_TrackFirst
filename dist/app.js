import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.166.1/build/three.module.js';

const $ = (id) => document.getElementById(id);
const LOCAL_GPU_ENDPOINT = 'http://127.0.0.1:10200';
const API_DEFAULT = new URLSearchParams(location.search).get('api') || sessionStorage.getItem('overtiq-endpoint') || LOCAL_GPU_ENDPOINT;
const API_KEY_DEFAULT = '5839920c81e1214f49627dd91a26b9861160d68925291dc0eb42cad4667bc206';
const state = {
  apiBase: API_DEFAULT.replace(/\/$/, ''),
  apiKey: sessionStorage.getItem('overtiq-key') || API_KEY_DEFAULT,
  frames: [],
  zones: [],
  assessment: null,
  frameIndex: 0,
  time: 0,
  playing: false,
  rate: 1,
  view: 'circuit',
  connected: false,
  connectPromise: null,
  requestCount: 0,
  zoneLoaded: false,
  assessmentCache: new Map(),
  assessmentPromise: null,
  stream: null,
  lastNow: 0,
  decision: 'ATTACK',
  controls: { weather: 'DRY', tire_compound: 'MEDIUM', rain_intensity: 0, ers_fraction: 0.62, fuel_kg: 42, vsc: false, red_flag: false },
  beforeAssessment: null,
  beforeControls: null,
  scenarioKey: ''
};

let trackRenderer, povRenderer, trackScene, povScene, trackCamera, povCamera, carMesh, oppMesh, wheelMesh, povRig;
const trackCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(300, 0, -15), new THREE.Vector3(210, 0, 70), new THREE.Vector3(120, 0, 180), new THREE.Vector3(40, 0, 245),
  new THREE.Vector3(-100, 0, 220), new THREE.Vector3(-220, 0, 120), new THREE.Vector3(-250, 0, -10),
  new THREE.Vector3(-180, 0, -150), new THREE.Vector3(-40, 0, -205), new THREE.Vector3(115, 0, -190),
  new THREE.Vector3(245, 0, -120), new THREE.Vector3(300, 0, -15)
], true, 'centripetal');

function fmtPct(v) { return v == null ? '—' : Math.round(v * 100) + '%'; }
function setStatus(label, connected) {
  $('gpu-state').textContent = label;
  $('gpu-state').classList.toggle('muted', !connected);
  $('data-badge').textContent = connected ? 'GPU LINK ACTIVE' : 'GPU LINK PENDING';
  $('data-badge').classList.toggle('connected', connected);
  $('frame-status').innerHTML = '<span class="live-dot"></span> ' + (connected ? 'GPU PHYSICS FRAME STREAM' : 'GPU LINK DEGRADED · NO LIVE FRAME');
  $('footer-status').textContent = connected ? 'RTX 3060 · CUDA · physics + inference remote' : 'REMOTE GPU DATA UNAVAILABLE';
  ['compute-sim','compute-physics','compute-model','compute-telemetry','compute-latency','compute-requests'].forEach(id => $(id).classList.toggle('offline', !connected));
}
async function api(path, options = {}) {
  if (!state.apiBase) throw new Error('No GPU endpoint configured');
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.apiKey) headers['x-overtiq-key'] = state.apiKey;
  const response = await fetch(state.apiBase + path, { ...options, headers });
  if (!response.ok) throw new Error('GPU service returned ' + response.status);
  return response.json();
}
function requestPayload(decision = state.decision) {
  return { session_key: '2026_11361', driver_number: 31, driver_code: 'OCO', lap: 35, position: 14, gap_ahead_s: .558, speed_mps: 78.9, decision, horizon_s: 60, n_scenarios: 256,
    weather: state.controls.weather, tire_compound: state.controls.tire_compound, rain_intensity: state.controls.rain_intensity,
    ers_fraction: state.controls.ers_fraction, fuel_kg: state.controls.fuel_kg, vsc: state.controls.vsc, red_flag: state.controls.red_flag };
}
function scenarioKey(decision = state.decision, controls = state.controls) { return JSON.stringify({ decision, ...controls }); }
function controlsFromInputs() {
  state.controls = { weather: $('weather').value, tire_compound: $('tyre-compound').value, rain_intensity: Number($('rain-intensity').value) / 100,
    ers_fraction: Number($('ers-fraction').value) / 100, fuel_kg: Number($('fuel-kg').value), vsc: $('vsc-toggle').dataset.active === 'true', red_flag: $('red-flag-toggle').dataset.active === 'true' };
  $('rain-value').textContent = Math.round(state.controls.rain_intensity * 100) + '%'; $('ers-value').textContent = Math.round(state.controls.ers_fraction * 100) + '%'; $('fuel-value').textContent = Math.round(state.controls.fuel_kg) + ' kg';
}
function syncControlInputs() {
  $('weather').value = state.controls.weather; $('tyre-compound').value = state.controls.tire_compound;
  $('rain-intensity').value = Math.round(state.controls.rain_intensity * 100); $('ers-fraction').value = Math.round(state.controls.ers_fraction * 100); $('fuel-kg').value = Math.round(state.controls.fuel_kg);
  $('rain-value').textContent = Math.round(state.controls.rain_intensity * 100) + '%'; $('ers-value').textContent = Math.round(state.controls.ers_fraction * 100) + '%'; $('fuel-value').textContent = Math.round(state.controls.fuel_kg) + ' kg';
  [['vsc-toggle', state.controls.vsc], ['red-flag-toggle', state.controls.red_flag]].forEach(([id, active]) => { const b = $(id); b.dataset.active = String(active); b.classList.toggle('on', active); b.querySelector('span').textContent = active ? 'ON' : 'OFF'; });
}
function renderComparison() {
  const before = state.beforeAssessment || null, after = state.assessment || null;
  const summary = (a) => { const x = a?.answers || {}; return { pass: x.can_pass_within_60s?.probability ?? null, durable: x.durable_pass?.probability ?? null, gain: x.can_gain_position_within_3_laps?.probability ?? null, finish: x.finish_position?.expected ?? null, action: a?.recommendation?.action || '—' }; };
  const b = summary(before), n = summary(after), delta = (x, y) => Math.round((y - x) * 100);
  $('before-action').textContent = b.action; $('before-pass').textContent = fmtPct(b.pass); $('before-durable').textContent = fmtPct(b.durable); $('before-finish').textContent = b.finish == null ? '—' : 'P' + Number(b.finish).toFixed(1);
  $('after-action').textContent = n.action; $('after-pass').textContent = fmtPct(n.pass); $('after-durable').textContent = fmtPct(n.durable); $('after-finish').textContent = n.finish == null ? '—' : 'P' + Number(n.finish).toFixed(1);
  $('scenario-delta').textContent = b.pass == null || n.pass == null ? 'WAITING FOR GPU BASELINE' : 'MODEL ADJUSTMENT · PASS ' + (delta(b.pass, n.pass) >= 0 ? '+' : '') + delta(b.pass, n.pass) + ' pts · DURABLE ' + (delta(b.durable, n.durable) >= 0 ? '+' : '') + delta(b.durable, n.durable) + ' pts · FINISH ' + (b.finish != null && n.finish != null ? (n.finish - b.finish >= 0 ? '+' : '') + (n.finish - b.finish).toFixed(1) + ' places' : '—');
}
function clearLiveState() {
  state.frames = []; state.zones = []; state.assessment = null; state.beforeAssessment = null; state.beforeControls = null; state.connected = false; state.time = 0; state.frameIndex = 0;
  setStatus('CONNECTING', false);
  $('compute-sim').textContent = 'CONNECTING'; $('compute-physics').textContent = 'CONNECTING'; $('compute-model').textContent = 'WAITING'; $('compute-telemetry').textContent = 'NO FRAME'; $('compute-latency').textContent = '—'; $('compute-requests').textContent = '0'; $('sim-state').innerHTML = '<i class="live-dot"></i> GPU LINK CONNECTING';
  renderAssessment(); renderComparison(); renderZones(); renderFrame();
}
async function connectGpu() {
  if (state.connectPromise || state.connected) return state.connectPromise;
  $('gpu-state').textContent = 'COMPUTING'; $('data-badge').textContent = 'GPU COMPUTING';
  state.connectPromise = (async () => {
    try {
      const bootstrap = await api('/engineer/bootstrap', { method: 'POST', body: JSON.stringify({ request: requestPayload(), include_frames: true }) });
      state.frames = bootstrap.frames || []; state.assessment = bootstrap.assessment; state.zones = bootstrap.zones || []; state.zoneLoaded = true; state.connected = true; state.requestCount = bootstrap.request_count || 1;
      state.beforeAssessment = bootstrap.assessment; state.beforeControls = { ...state.controls }; state.scenarioKey = scenarioKey();
      state.assessmentCache.set(state.scenarioKey, { assessment: bootstrap.assessment, frames: bootstrap.frames || [] });
      sessionStorage.setItem('overtiq-endpoint', state.apiBase); sessionStorage.setItem('overtiq-key', state.apiKey);
      setStatus(bootstrap.gpu?.device || 'RTX 3060', true);
      $('compute-sim').textContent = 'RTX 3060 · CUDA';
      $('data-note').textContent = 'Race engineer decision workspace · ' + (bootstrap.gpu?.model || 'model loaded');
      $('compute-requests').textContent = state.requestCount + ' BOOTSTRAP'; $('sim-state').innerHTML = '<i class="live-dot"></i> GPU STREAM LIVE'; renderAssessment(); renderComparison(); renderZones(); renderFrame(); startStream(true);
    } catch (error) {
      clearLiveState(); setStatus('GPU LINK ERROR', false);
      $('data-note').textContent = 'GPU service unavailable · no synthetic data loaded'; $('sim-state').innerHTML = '<i class="live-dot"></i> GPU LINK UNAVAILABLE';
    } finally { state.connectPromise = null; }
  })();
  return state.connectPromise;
}
function renderFrame() {
  const frame = frameAtTime(state.time);
  if (!frame) {
    ['hud-speed','hud-gear','hud-lap','speed','position','tyre-age','tyre-badge','lap'].forEach(id => { const node = $(id); if (node) node.textContent = '—'; });
    $('race-state').textContent = 'WAITING FOR GPU'; $('race-state').classList.remove('vsc','red'); $('map-status').textContent = 'NO PHYSICS FRAME'; $('compute-telemetry').textContent = 'NO FRAME'; renderThree(null); return;
  }
  const k = frame.kinematics || {}, race = frame.race || {}, track = frame.track || {};
  const vsc = Boolean(frame.flags?.vsc || frame.flags?.safety_car), red = Boolean(frame.flags?.red_flag);
  $('hud-driver').textContent = (race.driver_code || 'OCO') + ' · ' + (race.driver_number || 31);
  $('hud-speed').textContent = Math.round((k.speed_kph ?? k.speed_mps * 3.6)) + ' KM/H';
  $('hud-gear').textContent = String(frame.controls?.gear ?? 7);
  $('hud-lap').textContent = (race.lap ?? 35) + ' / 58';
  $('lap').textContent = race.lap ?? 35;
  $('speed').innerHTML = Math.round((k.speed_kph ?? k.speed_mps * 3.6)) + ' <small>km/h</small>';
  $('position').textContent = 'P' + (race.position ?? 14);
  $('tyre-badge').textContent = String(frame.tires?.compound || state.controls.tire_compound || 'MEDIUM').slice(0, 1);
  $('tyre-age').textContent = Math.round(frame.tires?.age_laps ?? 18) + ' laps';
  $('race-state').textContent = red ? 'RED FLAG' : vsc ? 'VIRTUAL SAFETY CAR' : 'GREEN FLAG';
  $('race-state').classList.toggle('vsc', vsc && !red); $('race-state').classList.toggle('red', red);
  $('map-status').textContent = red ? 'RED FLAG · RACE NEUTRALIZED' : vsc ? 'VSC IN PROGRESS' : 'TRACK CLEAR · GPU FRAME ' + (state.frameIndex + 1);
  $('compute-telemetry').textContent = (state.frameIndex + 1) + ' FRAMES · ' + (track.zone || 'SECTOR') + ' · S' + (track.sector || 1);
  $('time-label').innerHTML = new Date((state.time || 0) * 1000).toISOString().slice(14, 19) + ' <span>/ 01:00</span>';
  $('timeline').value = state.time;
  $('timeline').style.background = 'linear-gradient(to right,#b7f578 ' + (state.time / 60 * 100) + '%,#303b3d ' + (state.time / 60 * 100) + '%)';
  renderThree(frame);
}
function frameAtTime(seconds) {
  if (!state.frames.length) return null;
  const position = Math.max(0, Math.min(state.frames.length - 1, seconds / .25));
  const index = Math.floor(position), amount = position - index;
  const a = state.frames[index] || state.frames[state.frames.length - 1], b = state.frames[index + 1] || a;
  const lerp = (x, y) => Number.isFinite(x) && Number.isFinite(y) ? x + (y - x) * amount : x;
  return { ...a,
    t: lerp(a.t, b.t),
    track: { ...a.track, s_m: lerp(a.track?.s_m, b.track?.s_m), x_m: lerp(a.track?.x_m, b.track?.x_m), y_m: lerp(a.track?.y_m, b.track?.y_m), heading_rad: lerp(a.track?.heading_rad, b.track?.heading_rad) },
    pose: { ...a.pose, x_m: lerp(a.pose?.x_m, b.pose?.x_m), y_m: lerp(a.pose?.y_m, b.pose?.y_m), yaw_rad: lerp(a.pose?.yaw_rad, b.pose?.yaw_rad), pitch_rad: lerp(a.pose?.pitch_rad, b.pose?.pitch_rad), roll_rad: lerp(a.pose?.roll_rad, b.pose?.roll_rad) },
    kinematics: { ...a.kinematics, speed_mps: lerp(a.kinematics?.speed_mps, b.kinematics?.speed_mps), speed_kph: lerp(a.kinematics?.speed_kph, b.kinematics?.speed_kph), yaw_rate_radps: lerp(a.kinematics?.yaw_rate_radps, b.kinematics?.yaw_rate_radps), steering_rad: lerp(a.kinematics?.steering_rad, b.kinematics?.steering_rad) },
    race: { ...a.race, gap_ahead_s: lerp(a.race?.gap_ahead_s, b.race?.gap_ahead_s) }
  };
}
function renderAssessment() {
  const a = state.assessment, answers = a?.answers || {};
  [['gain','can_gain_position_within_3_laps'],['pass','can_pass_within_60s'],['durable','durable_pass']].forEach(([id, key]) => {
    const item = answers[key] || {}; const pct = fmtPct(item.probability);
    $('answer-' + id).textContent = pct; $('bar-' + id).style.width = (item.probability || 0) * 100 + '%';
    const e = item.evidence || {}; $('evidence-' + id).textContent = [e.zone || 'active zone', e.gap_s != null ? e.gap_s.toFixed(2) + 's gap' : '', e.speed_kph ? Math.round(e.speed_kph) + ' km/h' : '', e.simulator || ''].filter(Boolean).join(' · ');
  });
  const finish = answers.finish_position || {}; $('finish-expected').textContent = finish.expected == null ? '—' : 'P' + Number(finish.expected).toFixed(1);
  $('finish-note').textContent = a?.recommendation ? a.recommendation.action + ' · ' + a.recommendation.rationale : 'Waiting for the remote GPU assessment.';
  const vals = finish.distribution || [];
  $('finish-bars').innerHTML = vals.map((value, i) => '<div class="finish-bar"><span>P' + Number(value).toFixed(0) + '</span><i style="width:' + Math.max(12, 100 - i * 15) + '%"></i></div>').join('');
  $('assessment-time').textContent = a.model?.gpu_ms != null ? Math.round(a.model.gpu_ms) + ' ms GPU' : 'REMOTE COMPUTE';
  $('compute-model').textContent = (a.model?.decision_baseline || 'V4 BASELINE').toUpperCase();
  $('compute-physics').textContent = (a.model?.simulator || 'OVERTIQ GPU').toUpperCase();
  $('compute-latency').textContent = a.model?.gpu_ms != null ? Math.round(a.model.gpu_ms) + ' MS' : '—';
  renderComparison();
}
function renderZones() {
  const rows = state.zones || [];
  $('zone-rows').innerHTML = rows.length ? rows.map(z => {
    const a = z.assessment || {}; const pass = a.can_pass_within_60s?.probability ?? 0; const durable = a.durable_pass?.probability ?? 0;
    const action = z.recommendation?.action || 'HOLD';
    return '<tr><td><b>' + z.zone + '</b></td><td>S' + z.sector + '</td><td><span class="zone-type ' + String(z.type || '').toLowerCase() + '">' + (z.type || 'ZONE') + '</span></td><td class="probability">' + fmtPct(pass) + '</td><td class="probability">' + fmtPct(durable) + '</td><td><strong class="action-' + action.toLowerCase() + '">' + action + '</strong></td></tr>';
  }).join('') : '<tr><td colspan="6" class="empty-row">Waiting for live GPU zone assessment.</td></tr>';
}
function initThree() {
  const trackCanvas = $('track-canvas'), povCanvas = $('pov-canvas');
  trackRenderer = new THREE.WebGLRenderer({ canvas: trackCanvas, antialias: true, alpha: true });
  povRenderer = new THREE.WebGLRenderer({ canvas: povCanvas, antialias: true, alpha: false });
  [trackRenderer, povRenderer].forEach(r => { r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25)); r.outputColorSpace = THREE.SRGBColorSpace; });
  trackScene = new THREE.Scene(); trackScene.background = new THREE.Color('#0d1518');
  trackCamera = new THREE.OrthographicCamera(-420, 420, 300, -300, .1, 2000); trackCamera.position.set(0, 650, 0); trackCamera.up.set(0, 0, -1); trackCamera.lookAt(0, 0, 0);
  const road = new THREE.Mesh(new THREE.TubeGeometry(trackCurve, 160, 17, 8, true), new THREE.MeshBasicMaterial({ color: '#202b30' }));
  const line = new THREE.Mesh(new THREE.TubeGeometry(trackCurve, 160, 1.5, 5, true), new THREE.MeshBasicMaterial({ color: '#667879' }));
  trackScene.add(road, line, new THREE.AmbientLight('#ffffff', 1));
  carMesh = new THREE.Mesh(new THREE.SphereGeometry(10, 16, 12), new THREE.MeshBasicMaterial({ color: '#b7f578' }));
  oppMesh = new THREE.Mesh(new THREE.SphereGeometry(8, 16, 12), new THREE.MeshBasicMaterial({ color: '#f479a2' }));
  trackScene.add(carMesh, oppMesh);
  povScene = new THREE.Scene(); povScene.background = new THREE.Color('#111e26');
  povCamera = new THREE.PerspectiveCamera(70, 1, .1, 2000); povCamera.position.set(0, 18, 28); povCamera.rotation.x = -.08;
  povRig = new THREE.Group(); povScene.add(povRig);
  const roadPlane = new THREE.Mesh(new THREE.PlaneGeometry(300, 1800), new THREE.MeshStandardMaterial({ color: '#141a1d', roughness: .96, metalness: .02 })); roadPlane.rotation.x = -Math.PI / 2; roadPlane.position.z = -700; povRig.add(roadPlane);
  for (let i = 0; i < 34; i++) { const dash = new THREE.Mesh(new THREE.BoxGeometry(.42, .035, 10), new THREE.MeshBasicMaterial({ color: '#7a8580' })); dash.position.set(0, .05, -i * 48 - 32); povRig.add(dash); }
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(2, 8, 1500), new THREE.MeshStandardMaterial({ color: '#667471', roughness: .7, metalness: .35 })); rail.position.set(side * 21, 4, -700); povRig.add(rail);
    for (let i = 0; i < 28; i++) { const kerb = new THREE.Mesh(new THREE.BoxGeometry(4, .28, 18), new THREE.MeshStandardMaterial({ color: i % 2 ? '#cf6170' : '#eef0dc', roughness: .82 })); kerb.position.set(side * 19, .3, -i * 47 - 35); povRig.add(kerb); }
  }
  const halo = new THREE.Mesh(new THREE.TorusGeometry(14, 1.7, 8, 40, Math.PI), new THREE.MeshBasicMaterial({ color: '#080b0d' })); halo.rotation.z = Math.PI; halo.position.set(0, 14, 2); povRig.add(halo);
  wheelMesh = new THREE.Group(); wheelMesh.position.set(0, -1, 18); povRig.add(wheelMesh);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(9, 2, 8, 24), new THREE.MeshBasicMaterial({ color: '#060809' })); wheel.scale.set(1.2, .75, .6); wheelMesh.add(wheel);
  for (let i = 0; i < 3; i++) { const spoke = new THREE.Mesh(new THREE.BoxGeometry(1.2, 11, 1), new THREE.MeshBasicMaterial({ color: '#788486' })); spoke.rotation.z = i * Math.PI / 3; wheelMesh.add(spoke); }
  const dash = new THREE.Mesh(new THREE.BoxGeometry(38, 4, 11), new THREE.MeshBasicMaterial({ color: '#0a0e10' })); dash.position.set(0, 5, 13); povRig.add(dash);
  const dashScreen = new THREE.Mesh(new THREE.BoxGeometry(12, 3, .35), new THREE.MeshBasicMaterial({ color: '#b7f578' })); dashScreen.position.set(0, 7.1, 8); povRig.add(dashScreen);
  const sidePod = new THREE.Mesh(new THREE.BoxGeometry(9, 5, 23), new THREE.MeshStandardMaterial({ color: '#20282b', roughness: .58, metalness: .3 })); sidePod.position.set(-20, 1, 13); povRig.add(sidePod); povRig.add(sidePod.clone().translateX(40));
  povScene.add(new THREE.HemisphereLight('#bfd7e6', '#101719', 1.2), new THREE.DirectionalLight('#dbe9e5', 1.35));
  resizeThree(); window.addEventListener('resize', resizeThree);
}
function resizeThree() {
  const box = $('visual-wrap').getBoundingClientRect(), w = Math.max(320, box.width), h = Math.max(280, box.height - 2);
  trackRenderer?.setSize(w, h, false); povRenderer?.setSize(w, h, false);
  if (povCamera) { povCamera.aspect = w / h; povCamera.updateProjectionMatrix(); }
}
function renderThree(frame) {
  if (!trackRenderer || !frame) return;
  const s = (frame.track?.s_m || 0) / (frame.track?.length_m || 5278), gap = frame.race?.gap_ahead_s || .5;
  const p = trackCurve.getPointAt((s % 1 + 1) % 1), op = trackCurve.getPointAt((s + Math.min(.08, gap / 80)) % 1);
  carMesh.position.copy(p); carMesh.position.y = 12; oppMesh.position.copy(op); oppMesh.position.y = 10;
  const steer = frame.kinematics?.steering_rad || 0, speed = frame.kinematics?.speed_mps || 78;
  wheelMesh.rotation.z = -steer * .7; povRig.rotation.z = (frame.pose?.roll_rad || 0) * .65; povRig.rotation.x = (frame.pose?.pitch_rad || 0) * .5;
  povCamera.position.y = 18 + Math.min(.8, Math.abs(frame.kinematics?.yaw_rate_radps || 0) * 3);
  povCamera.position.z = 28 - Math.min(1.4, Math.abs(speed - 78) * .025);
  povCamera.rotation.y = steer * .035;
  povRig.position.z = -((frame.track?.s_m || 0) % 42) * .018;
  if (state.view === 'pov') povRenderer.render(povScene, povCamera); else trackRenderer.render(trackScene, trackCamera);
}
function setView(view) {
  state.view = view; $('visual-wrap').classList.toggle('pov-mode', view === 'pov'); $('view-label').textContent = view === 'pov' ? 'DRIVER POV' : 'CIRCUIT VIEW';
  $('circuit-view').classList.toggle('active', view === 'circuit'); $('pov-view-button').classList.toggle('active', view === 'pov'); resizeThree(); renderFrame();
}
function seek(seconds) { state.time = Math.max(0, Math.min(60, seconds)); state.frameIndex = state.frames.length ? Math.min(state.frames.length - 1, Math.round(state.time / .25)) : 0; renderFrame(); }
function playToggle() { state.playing = !state.playing; $('play').textContent = state.playing ? 'Ⅱ' : '▶'; }
function startStream(force = false) {
  if (!state.connected || !state.apiBase) { $('data-note').textContent = 'Remote GPU link is not ready.'; return; }
  if (state.stream && !force) { state.stream.close(); state.stream = null; $('live-stream').classList.remove('active'); $('sim-state').innerHTML = '<i class="live-dot"></i> GPU STREAM READY'; return; }
  if (state.stream) { state.stream.close(); state.stream = null; }
  const params = new URLSearchParams({ key: state.apiKey || '', weather: state.controls.weather, tire_compound: state.controls.tire_compound, rain_intensity: String(state.controls.rain_intensity), ers_fraction: String(state.controls.ers_fraction), fuel_kg: String(state.controls.fuel_kg), vsc: String(state.controls.vsc), red_flag: String(state.controls.red_flag), decision: state.decision });
  const wsUrl = state.apiBase.replace(/^http/, 'ws') + '/streams/2026_11361?' + params.toString();
  const socket = new WebSocket(wsUrl); state.stream = socket; $('live-stream').classList.add('active'); $('live-stream').textContent = 'STOP STREAM'; $('sim-state').innerHTML = '<i class="live-dot"></i> GPU STREAM CONNECTING';
  socket.onopen = () => { if (state.stream === socket) $('sim-state').innerHTML = '<i class="live-dot"></i> GPU STREAM LIVE'; };
  socket.onmessage = event => { const frame = JSON.parse(event.data); if (state.frames.length > 260 || (state.frames.length && frame.t === 0)) state.frames = []; state.frames.push(frame); state.frameIndex = state.frames.length - 1; state.time = frame.t || state.time; renderFrame(); };
  socket.onclose = () => { if (state.stream !== socket) return; state.stream = null; $('live-stream').classList.remove('active'); $('live-stream').innerHTML = 'GPU STREAM <span>●</span>'; $('sim-state').innerHTML = '<i class="live-dot"></i> GPU STREAM READY'; };
}
async function applyScenario() {
  controlsFromInputs();
  const key = scenarioKey();
  if (!state.connected) { $('scenario-result').textContent = 'GPU link pending · scenario will run when the remote simulator is available.'; return; }
  if (state.assessmentCache.has(key)) {
    const cached = state.assessmentCache.get(key); state.assessment = cached.assessment || cached; if (cached.frames) state.frames = cached.frames;
    state.scenarioKey = key; renderAssessment(); renderComparison(); $('scenario-result').textContent = 'CACHED GPU SCENARIO · ' + (state.assessment.recommendation?.action || 'HOLD') + ' · ' + fmtPct(state.assessment.answers?.can_pass_within_60s?.probability) + ' pass ≤60s'; startStream(true); return;
  }
  if (state.assessmentPromise) return state.assessmentPromise;
  $('apply-scenario').disabled = true; $('apply-scenario').textContent = 'RUNNING CUDA SCENARIO…'; $('sim-state').innerHTML = '<i class="live-dot"></i> GPU RECALCULATING';
  const payload = requestPayload();
  state.assessmentPromise = api('/engineer/assess', { method: 'POST', body: JSON.stringify({ request: payload, include_frames: true }) }).then(result => {
    state.assessmentCache.set(key, result); state.assessment = result; state.scenarioKey = key; state.frames = result.frames || state.frames; state.requestCount += 1;
    $('compute-requests').textContent = state.requestCount + ' UNIQUE SCENARIOS'; renderAssessment(); renderComparison(); renderZones();
    const ans = result.answers || {}; const cond = [state.controls.weather, state.controls.tire_compound, state.controls.vsc ? 'VSC' : '', state.controls.red_flag ? 'RED FLAG' : ''].filter(Boolean).join(' · ');
    $('scenario-result').textContent = (result.recommendation?.action || 'HOLD') + ' · pass ' + fmtPct(ans.can_pass_within_60s?.probability) + ' · durable ' + fmtPct(ans.durable_pass?.probability) + ' · expected ' + (ans.finish_position?.expected == null ? '—' : 'P' + Number(ans.finish_position.expected).toFixed(1)) + (cond ? ' · ' + cond : '');
    startStream(true);
  }).catch(error => { $('scenario-result').textContent = 'GPU scenario failed · ' + error.message; $('sim-state').innerHTML = '<i class="live-dot"></i> GPU STREAM READY'; }).finally(() => { state.assessmentPromise = null; $('apply-scenario').disabled = false; $('apply-scenario').textContent = 'APPLY TO GPU SIMULATOR'; });
  return state.assessmentPromise;
}
function tick(now) {
  const dt = state.lastNow ? Math.min(.1, (now - state.lastNow) / 1000) : 0; state.lastNow = now;
  if (state.playing) { seek(state.time + dt * state.rate); if (state.time >= 60) { state.playing = false; $('play').textContent = '▶'; } }
  requestAnimationFrame(tick);
}

$('circuit-view').addEventListener('click', () => setView('circuit'));
$('pov-view-button').addEventListener('click', () => setView('pov'));
$('play').addEventListener('click', playToggle);
$('reset').addEventListener('click', () => { state.playing = false; seek(0); });
$('back').addEventListener('click', () => seek(state.time - 5));
$('forward').addEventListener('click', () => seek(state.time + 5));
$('timeline').addEventListener('input', e => seek(Number(e.target.value)));
$('rate').addEventListener('change', e => { state.rate = Number(e.target.value); });
$('live-stream').addEventListener('click', startStream);
$('fullscreen').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch {} });
$('weather').addEventListener('change', controlsFromInputs); $('tyre-compound').addEventListener('change', controlsFromInputs);
['rain-intensity','ers-fraction','fuel-kg'].forEach(id => $(id).addEventListener('input', controlsFromInputs));
['vsc-toggle','red-flag-toggle'].forEach(id => $(id).addEventListener('click', () => { const b = $(id); b.dataset.active = b.dataset.active === 'true' ? 'false' : 'true'; b.classList.toggle('on', b.dataset.active === 'true'); b.querySelector('span').textContent = b.dataset.active === 'true' ? 'ON' : 'OFF'; controlsFromInputs(); }));
$('apply-scenario').addEventListener('click', applyScenario);
document.querySelectorAll('[data-decision]').forEach(button => button.addEventListener('click', () => { state.decision = button.dataset.decision; document.querySelectorAll('[data-decision]').forEach(b => b.classList.toggle('active', b === button)); applyScenario(); }));
document.addEventListener('keydown', e => { if (/INPUT|SELECT|BUTTON|TEXTAREA/.test(e.target.tagName) || e.altKey || e.ctrlKey || e.metaKey) return; if (e.code === 'Space') { e.preventDefault(); playToggle(); } if (e.code === 'ArrowLeft') seek(state.time - 5); if (e.code === 'ArrowRight') seek(state.time + 5); });
const context = document.modelContext;
if (context?.registerTool) { try { context.registerTool({ name: 'configure_race_replay', title: 'Configure GPU race replay', description: 'Seek the remote GPU Overtiq replay and set playback state.', inputSchema: { type: 'object', properties: { seconds: { type: 'number', minimum: 0, maximum: 60 }, playing: { type: 'boolean' } }, required: ['seconds', 'playing'], additionalProperties: false }, execute(input) { seek(input.seconds); state.playing = input.playing; return { seconds: state.time, driver: 'OCO', playing: state.playing, gpuBacked: state.connected }; } }); } catch {} }

initThree(); syncControlInputs(); clearLiveState(); requestAnimationFrame(tick);
if (state.apiBase) connectGpu();

