import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.166.1/build/three.module.js';

const $ = (id) => document.getElementById(id);
const API_DEFAULT = new URLSearchParams(location.search).get('api') || sessionStorage.getItem('overtiq-endpoint') || 'https://computing-forestry-extraordinary-collapse.trycloudflare.com';
const state = {
  apiBase: API_DEFAULT.replace(/\/$/, ''),
  apiKey: sessionStorage.getItem('overtiq-key') || '',
  frames: [],
  zones: [],
  assessment: null,
  frameIndex: 0,
  time: 0,
  playing: false,
  rate: 1,
  view: 'circuit',
  connected: false,
  stream: null,
  lastNow: 0,
  decision: 'ATTACK'
};

const demoFrame = {
  schema: 'OVERTIQ.PhysicsFrame.v1', t: 0,
  track: { session_key: '2026_11361', s_m: 0, length_m: 5278, x_m: 710, y_m: 290, heading_rad: 1.57, curvature_1_m: 0.0012, sector: 1, zone: 'T1', zone_type: 'Braking' },
  pose: { x_m: 710, y_m: 290, z_m: 0, yaw_rad: 1.57, pitch_rad: 0, roll_rad: 0 },
  kinematics: { speed_mps: 78.9, speed_kph: 284, accel_mps2: 0, yaw_rate_radps: 0, steering_rad: 0 },
  controls: { throttle: .86, brake: .04, gear: 7, drs: false },
  tires: { compound: 'MEDIUM', age_laps: 18, surface_temp_c: 89, wear: .34 },
  energy: { ers_fraction: .62, fuel_kg: 42, fuel_lap_delta_kg: -1.72 },
  flags: { safety_car: false, vsc: false, data_quality: 'demo_fixture' },
  race: { driver_number: 31, driver_code: 'OCO', lap: 35, position: 14, gap_ahead_s: .558, decision: 'ATTACK' }
};
const demoAssessment = {
  schema: 'EngineerAssessment.v1', driver: { number: 31, code: 'OCO', position: 14 }, decision: 'ATTACK',
  answers: {
    can_gain_position_within_3_laps: { probability: .61, confidence: .69, cutoff_lap: 38, evidence: { zone: 'T1', sector: 1, gap_s: .558, speed_kph: 284, tire: 'MEDIUM', tire_age_laps: 18, ers_fraction: .62, simulator: 'demo fixture' } },
    can_pass_within_60s: { probability: .54, confidence: .67, window_s: 60, evidence: { zone: 'T1', sector: 1, gap_s: .558, speed_kph: 284, tire: 'MEDIUM', tire_age_laps: 18, ers_fraction: .62, simulator: 'demo fixture' } },
    durable_pass: { probability: .39, confidence: .62, laps_ahead: 3, evidence: { zone: 'T1', sector: 1, gap_s: .558, speed_kph: 284, tire: 'MEDIUM', tire_age_laps: 18, ers_fraction: .62, simulator: 'demo fixture' } },
    finish_position: { expected: 13.4, distribution: [12, 12.8, 13.5, 14.2, 15], quantiles: [.1, .25, .5, .75, .9], evidence: { zone: 'T1', sector: 1, simulator: 'demo fixture' } }
  },
  recommendation: { action: 'ATTACK', confidence: .69, rationale: 'Demo fixture only — connect the GPU service for live scenario evidence.', override_allowed: true },
  model: { decision_baseline: 'v4-logistic', forecaster: 'forecaster_2026_v1.pt', simulator: 'demo fixture', device: 'not connected', gpu_ms: null, scenarios: 0 }
};
const demoZones = ['T1','T3','T6','T9','T11','T13'].map((zone, i) => ({ zone, sector: Math.floor(i / 2) + 1, type: i % 2 ? 'Overtake' : 'Braking', assessment: demoAssessment.answers, recommendation: demoAssessment.recommendation }));

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
  $('frame-status').innerHTML = '<span class="live-dot"></span> ' + (connected ? 'GPU PHYSICS FRAME STREAM' : 'DEMO FIXTURE · CONNECT GPU FOR LIVE DATA');
  $('footer-status').textContent = connected ? 'RTX 3060 · CUDA · physics + inference remote' : 'Demo fixture · no local physics or inference';
}
async function api(path, options = {}) {
  if (!state.apiBase) throw new Error('No GPU endpoint configured');
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.apiKey) headers['x-overtiq-key'] = state.apiKey;
  const response = await fetch(state.apiBase + path, { ...options, headers });
  if (!response.ok) throw new Error('GPU service returned ' + response.status);
  return response.json();
}
function useDemo() {
  state.frames = Array.from({ length: 241 }, (_, i) => ({ ...demoFrame, t: i * .25, track: { ...demoFrame.track, s_m: (i * 78.9 * .25) % 5278 }, race: { ...demoFrame.race, gap_ahead_s: .558 } }));
  state.zones = demoZones;
  state.assessment = demoAssessment;
  state.connected = false;
  setStatus('DEMO FIXTURE', false);
  renderAssessment();
  renderZones();
  renderFrame();
}
async function connectGpu() {
  const endpoint = $('api-endpoint').value.trim().replace(/\/$/, '');
  const key = $('api-key').value.trim();
  if (!endpoint) { $('data-note').textContent = 'Add the remote HTTPS endpoint to connect.'; return; }
  state.apiBase = endpoint; state.apiKey = key;
  $('connect-submit').textContent = 'CONNECTING…';
  try {
    const health = await api('/health');
    if (!health.gpu?.available) throw new Error('Remote service has no CUDA device');
    const [frames, assessment, zones] = await Promise.all([
      api('/replays/2026_11361/frames?limit=240'),
      api('/engineer/assess', { method: 'POST', body: JSON.stringify({ request: { session_key: '2026_11361', driver_number: 31, driver_code: 'OCO', lap: 35, position: 14, gap_ahead_s: .558, speed_mps: 78.9, decision: state.decision, horizon_s: 60, n_scenarios: 256 }, include_frames: false }) }),
      api('/replays/2026_11361/zones')
    ]);
    state.frames = frames.frames || []; state.assessment = assessment; state.zones = zones.zones || []; state.connected = true;
    sessionStorage.setItem('overtiq-endpoint', state.apiBase); sessionStorage.setItem('overtiq-key', state.apiKey);
    setStatus(health.gpu.device || 'RTX 3060', true);
    $('data-note').textContent = 'GPU physics + calibrated inference · ' + (health.model || 'model loaded');
    $('connection-panel').hidden = true; renderAssessment(); renderZones(); renderFrame();
  } catch (error) {
    state.connected = false; setStatus('LINK ERROR', false);
    $('data-note').textContent = error.message + ' · demo fixture remains active';
    useDemo();
  } finally { $('connect-submit').textContent = 'TEST & CONNECT'; }
}
function renderFrame() {
  const frame = state.frames[state.frameIndex] || demoFrame;
  const k = frame.kinematics || demoFrame.kinematics, race = frame.race || demoFrame.race, track = frame.track || demoFrame.track;
  const vsc = Boolean(frame.flags?.vsc || frame.flags?.safety_car);
  $('hud-driver').textContent = (race.driver_code || 'OCO') + ' · ' + (race.driver_number || 31);
  $('hud-speed').textContent = Math.round((k.speed_kph ?? k.speed_mps * 3.6)) + ' KM/H';
  $('hud-gear').textContent = String(frame.controls?.gear ?? 7);
  $('hud-lap').textContent = (race.lap ?? 35) + ' / 58';
  $('lap').textContent = race.lap ?? 35;
  $('speed').innerHTML = Math.round((k.speed_kph ?? k.speed_mps * 3.6)) + ' <small>km/h</small>';
  $('position').textContent = 'P' + (race.position ?? 14);
  $('tyre-age').textContent = Math.round(frame.tires?.age_laps ?? 18) + ' laps';
  $('race-state').textContent = vsc ? 'VIRTUAL SAFETY CAR' : 'GREEN FLAG';
  $('race-state').classList.toggle('vsc', vsc);
  $('map-status').textContent = vsc ? 'VSC IN PROGRESS' : 'TRACK CLEAR · GPU FRAME ' + (state.frameIndex + 1);
  $('time-label').innerHTML = new Date((state.time || 0) * 1000).toISOString().slice(14, 19) + ' <span>/ 01:00</span>';
  $('timeline').value = state.time;
  $('timeline').style.background = 'linear-gradient(to right,#b7f578 ' + (state.time / 60 * 100) + '%,#303b3d ' + (state.time / 60 * 100) + '%)';
  renderThree(frame);
}
function renderAssessment() {
  const a = state.assessment || demoAssessment, answers = a.answers || demoAssessment.answers;
  [['gain','can_gain_position_within_3_laps'],['pass','can_pass_within_60s'],['durable','durable_pass']].forEach(([id, key]) => {
    const item = answers[key] || {}; const pct = fmtPct(item.probability);
    $('answer-' + id).textContent = pct; $('bar-' + id).style.width = (item.probability || 0) * 100 + '%';
    const e = item.evidence || {}; $('evidence-' + id).textContent = [e.zone || 'active zone', e.gap_s != null ? e.gap_s.toFixed(2) + 's gap' : '', e.speed_kph ? Math.round(e.speed_kph) + ' km/h' : '', e.simulator || ''].filter(Boolean).join(' · ');
  });
  const finish = answers.finish_position || {}; $('finish-expected').textContent = finish.expected == null ? '—' : 'P' + Number(finish.expected).toFixed(1);
  $('finish-note').textContent = a.recommendation ? a.recommendation.action + ' · ' + a.recommendation.rationale : 'GPU scenario distribution';
  const vals = finish.distribution || [];
  $('finish-bars').innerHTML = vals.map((value, i) => '<div class="finish-bar"><span>P' + Number(value).toFixed(0) + '</span><i style="width:' + Math.max(12, 100 - i * 15) + '%"></i></div>').join('');
  $('assessment-time').textContent = a.model?.gpu_ms != null ? Math.round(a.model.gpu_ms) + ' ms GPU' : 'DEMO FIXTURE';
}
function renderZones() {
  const rows = state.zones || [];
  $('zone-rows').innerHTML = rows.length ? rows.map(z => {
    const a = z.assessment || {}; const pass = a.can_pass_within_60s?.probability ?? 0; const durable = a.durable_pass?.probability ?? 0;
    const action = z.recommendation?.action || 'HOLD';
    return '<tr><td><b>' + z.zone + '</b></td><td>S' + z.sector + '</td><td><span class="zone-type ' + String(z.type || '').toLowerCase() + '">' + (z.type || 'ZONE') + '</span></td><td class="probability">' + fmtPct(pass) + '</td><td class="probability">' + fmtPct(durable) + '</td><td><strong class="action-' + action.toLowerCase() + '">' + action + '</strong></td></tr>';
  }).join('') : '<tr><td colspan="6" class="empty-row">No zones returned by the GPU service.</td></tr>';
}
function initThree() {
  const trackCanvas = $('track-canvas'), povCanvas = $('pov-canvas');
  trackRenderer = new THREE.WebGLRenderer({ canvas: trackCanvas, antialias: true, alpha: true });
  povRenderer = new THREE.WebGLRenderer({ canvas: povCanvas, antialias: true, alpha: false });
  [trackRenderer, povRenderer].forEach(r => { r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6)); r.outputColorSpace = THREE.SRGBColorSpace; });
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
  const roadPlane = new THREE.Mesh(new THREE.PlaneGeometry(300, 1800), new THREE.MeshBasicMaterial({ color: '#141a1d' })); roadPlane.rotation.x = -Math.PI / 2; roadPlane.position.z = -700; povRig.add(roadPlane);
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(2, 8, 1500), new THREE.MeshBasicMaterial({ color: '#76817e' })); rail.position.set(side * 21, 4, -700); povRig.add(rail);
    for (let i = 0; i < 28; i++) { const kerb = new THREE.Mesh(new THREE.BoxGeometry(4, .28, 18), new THREE.MeshBasicMaterial({ color: i % 2 ? '#cf6170' : '#eef0dc' })); kerb.position.set(side * 19, .3, -i * 47 - 35); povRig.add(kerb); }
  }
  const halo = new THREE.Mesh(new THREE.TorusGeometry(14, 1.7, 8, 40, Math.PI), new THREE.MeshBasicMaterial({ color: '#080b0d' })); halo.rotation.z = Math.PI; halo.position.set(0, 14, 2); povRig.add(halo);
  wheelMesh = new THREE.Group(); wheelMesh.position.set(0, -1, 18); povRig.add(wheelMesh);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(9, 2, 8, 24), new THREE.MeshBasicMaterial({ color: '#060809' })); wheel.scale.set(1.2, .75, .6); wheelMesh.add(wheel);
  for (let i = 0; i < 3; i++) { const spoke = new THREE.Mesh(new THREE.BoxGeometry(1.2, 11, 1), new THREE.MeshBasicMaterial({ color: '#788486' })); spoke.rotation.z = i * Math.PI / 3; wheelMesh.add(spoke); }
  const dash = new THREE.Mesh(new THREE.BoxGeometry(38, 4, 11), new THREE.MeshBasicMaterial({ color: '#0a0e10' })); dash.position.set(0, 5, 13); povRig.add(dash);
  povScene.add(new THREE.HemisphereLight('#bfd7e6', '#101719', 1.2));
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
  trackRenderer.render(trackScene, trackCamera); povRenderer.render(povScene, povCamera);
}
function setView(view) {
  state.view = view; $('visual-wrap').classList.toggle('pov-mode', view === 'pov'); $('view-label').textContent = view === 'pov' ? 'DRIVER POV' : 'CIRCUIT VIEW';
  $('circuit-view').classList.toggle('active', view === 'circuit'); $('pov-view-button').classList.toggle('active', view === 'pov'); resizeThree(); renderFrame();
}
function seek(seconds) { state.time = Math.max(0, Math.min(60, seconds)); state.frameIndex = state.frames.length ? Math.min(state.frames.length - 1, Math.round(state.time / .25)) : 0; renderFrame(); }
function playToggle() { state.playing = !state.playing; $('play').textContent = state.playing ? 'Ⅱ' : '▶'; }
function startStream() {
  if (!state.connected || !state.apiBase) { $('data-note').textContent = 'Connect the authenticated GPU endpoint before starting live stream.'; return; }
  if (state.stream) { state.stream.close(); state.stream = null; $('live-stream').classList.remove('active'); return; }
  const wsUrl = state.apiBase.replace(/^http/, 'ws') + '/streams/2026_11361' + (state.apiKey ? '?key=' + encodeURIComponent(state.apiKey) : '');
  state.stream = new WebSocket(wsUrl); $('live-stream').classList.add('active'); $('live-stream').textContent = 'STOP STREAM';
  state.stream.onmessage = event => { const frame = JSON.parse(event.data); state.frames.push(frame); state.frameIndex = state.frames.length - 1; state.time = frame.t || state.time; renderFrame(); };
  state.stream.onclose = () => { state.stream = null; $('live-stream').classList.remove('active'); $('live-stream').innerHTML = 'LIVE STREAM <span>↗</span>'; };
}
function tick(now) {
  const dt = state.lastNow ? Math.min(.1, (now - state.lastNow) / 1000) : 0; state.lastNow = now;
  if (state.playing) { seek(state.time + dt * state.rate); if (state.time >= 60) { state.playing = false; $('play').textContent = '▶'; } }
  requestAnimationFrame(tick);
}

$('connect').addEventListener('click', () => { $('connection-panel').hidden = !$('connection-panel').hidden; $('api-endpoint').value = state.apiBase; $('api-key').value = state.apiKey; });
$('connect-submit').addEventListener('click', connectGpu);
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
document.querySelectorAll('[data-decision]').forEach(button => button.addEventListener('click', async () => {
  state.decision = button.dataset.decision; document.querySelectorAll('[data-decision]').forEach(b => b.classList.toggle('active', b === button));
  if (!state.connected) { demoAssessment.recommendation = { ...demoAssessment.recommendation, action: state.decision, rationale: 'Connect the GPU service for live scenario evidence.' }; state.assessment = demoAssessment; renderAssessment(); return; }
  button.textContent = '…';
  try { state.assessment = await api('/engineer/assess', { method: 'POST', body: JSON.stringify({ request: { session_key: '2026_11361', driver_number: 31, driver_code: 'OCO', lap: 35, position: 14, gap_ahead_s: .558, speed_mps: 78.9, decision: state.decision, horizon_s: 60, n_scenarios: 256 }, include_frames: false }) }); renderAssessment(); }
  catch (error) { $('data-note').textContent = error.message; }
  finally { button.textContent = state.decision; }
}));
document.addEventListener('keydown', e => { if (/INPUT|SELECT|BUTTON|TEXTAREA/.test(e.target.tagName) || e.altKey || e.ctrlKey || e.metaKey) return; if (e.code === 'Space') { e.preventDefault(); playToggle(); } if (e.code === 'ArrowLeft') seek(state.time - 5); if (e.code === 'ArrowRight') seek(state.time + 5); });
const context = document.modelContext;
if (context?.registerTool) { try { context.registerTool({ name: 'configure_race_replay', title: 'Configure GPU race replay', description: 'Seek the remote GPU Overtiq replay and set playback state.', inputSchema: { type: 'object', properties: { seconds: { type: 'number', minimum: 0, maximum: 60 }, playing: { type: 'boolean' } }, required: ['seconds', 'playing'], additionalProperties: false }, execute(input) { seek(input.seconds); state.playing = input.playing; return { seconds: state.time, driver: 'OCO', playing: state.playing, gpuBacked: state.connected }; } }); } catch {} }

initThree(); useDemo(); requestAnimationFrame(tick);
if (state.apiBase) { $('api-endpoint').value = state.apiBase; connectGpu(); }

