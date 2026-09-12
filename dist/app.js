import * as THREE from './three.module.js';
import { DEFAULT_TRACK_ID, formatTrackLength, getTrack, trackOptions } from './track-data.js';

const $ = (id) => document.getElementById(id);
// The race terminal and GPU API are served by the same FastAPI origin. A
// query override remains available for development, but production never
// depends on a localhost bridge or an SSH process.
const API_DEFAULT = new URLSearchParams(location.search).get('api') || location.origin;
const API_KEY_DEFAULT = '5839920c81e1214f49627dd91a26b9861160d68925291dc0eb42cad4667bc206';
const SNAPSHOT_KEY = 'overtiq-gpu-snapshot-v1';
const TRACK_PREF_KEY = 'overtiq-track-id-v1';
const SAVED_TRACK_ID = getTrack(sessionStorage.getItem(TRACK_PREF_KEY) || DEFAULT_TRACK_ID).id;
const state = {
  apiBase: API_DEFAULT.replace(/\/$/, ''),
  apiKey: sessionStorage.getItem('overtiq-key') || API_KEY_DEFAULT,
  frames: [],
  zones: [],
  assessment: null,
  frameIndex: 0,
  beforeFrames: [],
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
  httpAbort: null,
  lastNow: 0,
  decision: 'ATTACK',
  controls: { track_id: SAVED_TRACK_ID, weather: 'DRY', tire_compound: 'MEDIUM', rain_intensity: 0, ers_fraction: 0.62, fuel_kg: 42, vsc: false, red_flag: false },
  beforeAssessment: null,
  beforeControls: null,
  scenarioKey: '',
  streamWanted: false,
  streamTimer: null,
  streamAttempt: 0,
  connectTimer: null,
  connectAttempt: 0,
  snapshotRestored: false
};

let trackRenderer, povRenderer, trackScene, povScene, trackCamera, povCamera, carMesh, oppMesh, wheelMesh, povRig;
let currentTrack = getTrack(state.controls.track_id), trackCurve;
let trackRoad, trackLine, trackZoneGroup;
const comparisonViews = { before: null, after: null };
function makeTrackCurve(track) {
  return new THREE.CatmullRomCurve3(track.geometry.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
}
trackCurve = makeTrackCurve(currentTrack);

function fmtPct(v) { return v == null ? '—' : Math.round(v * 100) + '%'; }
function setStatus(label, connected) {
  $('gpu-state').textContent = label;
  $('gpu-state').classList.toggle('muted', !connected);
  const text = String(label || '').toUpperCase();
  $('data-badge').textContent = connected ? 'GPU READY' : (text.includes('ERROR') ? 'GPU ERROR' : text.includes('RECONNECT') ? 'GPU RECONNECTING' : 'GPU PENDING');
  $('data-badge').classList.toggle('connected', connected);
  $('frame-status').innerHTML = '<span class="live-dot"></span> ' + (connected ? 'GPU PHYSICS FRAME STREAM' : 'GPU LINK DEGRADED · NO LIVE FRAME');
  $('footer-status').textContent = connected ? 'RTX 3060 · CUDA · physics + inference remote' : 'REMOTE GPU DATA UNAVAILABLE';
  ['compute-sim','compute-physics','compute-model','compute-telemetry','compute-latency','compute-requests'].forEach(id => $(id).classList.toggle('offline', !connected));
}
function setReconnecting(message = 'Reconnecting to the remote GPU…') {
  $('gpu-state').textContent = 'RECONNECTING'; $('gpu-state').classList.add('muted');
  $('data-badge').textContent = 'GPU LINK RECONNECTING'; $('data-badge').classList.remove('connected');
  $('frame-status').innerHTML = '<span class="live-dot"></span> GPU LINK RECONNECTING · LAST VERIFIED FRAME RETAINED';
  $('data-note').textContent = message;
  $('footer-status').textContent = state.frames.length ? 'RTX 3060 · reconnecting · retained GPU data' : 'REMOTE GPU DATA UNAVAILABLE';
}
async function api(path, options = {}) {
  if (!state.apiBase) throw new Error('No GPU endpoint configured');
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.apiKey) headers['x-overtiq-key'] = state.apiKey;
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(state.apiBase + path, { ...options, headers, signal: controller.signal, mode: 'cors', cache: 'no-store' });
    if (!response.ok) throw new Error('GPU service returned ' + response.status);
    return response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('GPU request timed out at ' + state.apiBase);
    throw error;
  } finally { clearTimeout(timeout); }
}
function requestPayload(decision = state.decision) {
  return { session_key: currentTrack.sessionKey, track_id: currentTrack.id, track_length_m: currentTrack.lengthM, driver_number: 31, driver_code: 'OCO', lap: 35, position: 14, gap_ahead_s: .558, speed_mps: 78.9, decision, horizon_s: 60, n_scenarios: 256,
    weather: state.controls.weather, tire_compound: state.controls.tire_compound, rain_intensity: state.controls.rain_intensity,
    ers_fraction: state.controls.ers_fraction, fuel_kg: state.controls.fuel_kg, vsc: state.controls.vsc, red_flag: state.controls.red_flag };
}
function scenarioKey(decision = state.decision, controls = state.controls) { return JSON.stringify({ decision, ...controls }); }
function controlsFromInputs() {
  state.controls = { track_id: $('track-select')?.value || state.controls.track_id || DEFAULT_TRACK_ID, weather: $('weather').value, tire_compound: $('tyre-compound').value, rain_intensity: Number($('rain-intensity').value) / 100,
    ers_fraction: Number($('ers-fraction').value) / 100, fuel_kg: Number($('fuel-kg').value), vsc: $('vsc-toggle').dataset.active === 'true', red_flag: $('red-flag-toggle').dataset.active === 'true' };
  $('rain-value').textContent = Math.round(state.controls.rain_intensity * 100) + '%'; $('ers-value').textContent = Math.round(state.controls.ers_fraction * 100) + '%'; $('fuel-value').textContent = Math.round(state.controls.fuel_kg) + ' kg';
}
function syncControlInputs() {
  if ($('track-select')) $('track-select').value = state.controls.track_id || DEFAULT_TRACK_ID;
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
  $('before-condition').textContent = conditionLabel(state.beforeControls);
  $('after-condition').textContent = conditionLabel(state.controls);
  renderComparisonViews();
}
function conditionLabel(controls) {
  if (!controls) return 'WAITING FOR GPU';
  const flags = controls.red_flag ? 'RED FLAG' : controls.vsc ? 'VSC' : 'GREEN';
  return [controls.weather || 'DRY', controls.tire_compound || 'MEDIUM', flags].join(' · ');
}
function clearLiveState() {
  state.frames = []; state.beforeFrames = []; state.zones = []; state.assessment = null; state.beforeAssessment = null; state.beforeControls = null; state.connected = false; state.time = 0; state.frameIndex = 0;
  setStatus('CONNECTING', false);
  $('compute-sim').textContent = 'CONNECTING'; $('compute-physics').textContent = 'CONNECTING'; $('compute-model').textContent = 'WAITING'; $('compute-telemetry').textContent = 'NO FRAME'; $('compute-latency').textContent = '—'; $('compute-requests').textContent = '0'; $('sim-state').innerHTML = '<i class="live-dot"></i> GPU LINK CONNECTING';
  renderAssessment(); renderComparison(); renderZones(); renderFrame();
}
function saveSnapshot() {
  try {
    sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ apiBase: state.apiBase, frames: state.frames, beforeFrames: state.beforeFrames, assessment: state.assessment, beforeAssessment: state.beforeAssessment, zones: state.zones, beforeControls: state.beforeControls, controls: state.controls, scenarioKey: state.scenarioKey, requestCount: state.requestCount, savedAt: Date.now() }));
  } catch {}
}
function restoreSnapshot() {
  try {
    const snapshot = JSON.parse(sessionStorage.getItem(SNAPSHOT_KEY) || 'null');
    if (!snapshot || snapshot.apiBase !== state.apiBase || !snapshot.frames?.length || !snapshot.assessment) return false;
    state.frames = snapshot.frames; state.beforeFrames = snapshot.beforeFrames?.length ? snapshot.beforeFrames : snapshot.frames.slice();
    state.assessment = snapshot.assessment; state.beforeAssessment = snapshot.beforeAssessment || snapshot.assessment;
    state.zones = snapshot.zones || []; state.beforeControls = snapshot.beforeControls || snapshot.controls || null; state.requestCount = snapshot.requestCount || 1;
    state.controls = snapshot.controls || state.controls;
    sessionStorage.setItem(TRACK_PREF_KEY, state.controls.track_id || DEFAULT_TRACK_ID);
    const restoredTrack = getTrack(state.controls.track_id || DEFAULT_TRACK_ID);
    if (restoredTrack.id !== currentTrack.id) { currentTrack = restoredTrack; trackCurve = makeTrackCurve(currentTrack); updateTrackGeometry(); }
    state.scenarioKey = snapshot.scenarioKey || scenarioKey();
    state.assessmentCache.set(state.scenarioKey, { assessment: state.assessment, frames: state.frames });
    state.snapshotRestored = true;
    syncControlInputs(); renderAssessment(); renderComparison(); renderZones(); renderFrame(); setReconnecting('Restored last verified GPU snapshot · validating the live link…');
    $('sim-state').innerHTML = '<i class="live-dot"></i> GPU SNAPSHOT RESTORED · RECONNECTING';
    return true;
  } catch { return false; }
}
function scheduleConnect() {
  if (state.connectTimer || state.connected) return;
  const delay = Math.min(15000, 1000 * Math.pow(2, Math.min(state.connectAttempt, 4)));
  state.connectAttempt += 1; setReconnecting('GPU link retry ' + state.connectAttempt + ' in ' + Math.ceil(delay / 1000) + 's…');
  state.connectTimer = setTimeout(() => { state.connectTimer = null; connectGpu(true); }, delay);
}
async function connectGpu(force = false) {
  if (state.connectPromise || (state.connected && !force)) return state.connectPromise;
  $('gpu-state').textContent = 'LOADING'; $('data-badge').textContent = 'LOADING BASELINE';
  state.connectPromise = (async () => {
    try {
      const bootstrap = await api('/engineer/bootstrap', { method: 'POST', body: JSON.stringify({ request: requestPayload(), include_frames: true }) });
      state.frames = bootstrap.frames || []; state.beforeFrames = (bootstrap.frames || []).slice(); state.assessment = bootstrap.assessment; state.zones = bootstrap.zones || []; state.zoneLoaded = true; state.connected = true; state.requestCount = bootstrap.request_count ?? 0;
      state.beforeAssessment = bootstrap.assessment; state.beforeControls = { ...state.controls }; state.scenarioKey = scenarioKey();
      state.assessmentCache.set(state.scenarioKey, { assessment: bootstrap.assessment, frames: bootstrap.frames || [] });
      state.connectAttempt = 0; state.snapshotRestored = false; saveSnapshot();
      sessionStorage.setItem('overtiq-endpoint', state.apiBase); sessionStorage.setItem('overtiq-key', state.apiKey);
      setStatus('READY', true);
      $('compute-sim').textContent = 'RTX 3060 · READY'; $('compute-physics').textContent = 'BASELINE LOADED'; $('compute-model').textContent = bootstrap.gpu?.model || 'MODEL READY';
      $('compute-latency').textContent = 'PRECOMPUTED'; $('compute-telemetry').textContent = state.frames.length + ' BASELINE FRAMES';
      $('data-note').textContent = 'Precomputed race baseline loaded · GPU ready for an adjusted scenario';
      $('compute-requests').textContent = '0 LIVE RUNS'; $('sim-state').innerHTML = '<i class="live-dot"></i> BASELINE READY · GPU IDLE';
      $('live-stream').textContent = 'BASELINE LOADED'; $('live-stream').disabled = true;
      renderAssessment(); renderComparison(); renderZones(); renderFrame();
    } catch (error) {
      const retained = Boolean(state.assessment && state.frames.length);
      state.connected = false;
      if (retained) { setReconnecting('GPU bootstrap retry: ' + error.message); $('sim-state').innerHTML = '<i class="live-dot"></i> GPU DATA RETAINED · RECONNECTING'; }
      else { setStatus('GPU LINK ERROR', false); $('data-note').textContent = 'GPU bootstrap failed: ' + error.message; $('sim-state').innerHTML = '<i class="live-dot"></i> GPU LINK RETRYING'; }
      scheduleConnect();
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
  renderThree(frame); renderComparisonViews();
}
function frameAtTime(seconds) {
  return frameAtTimeFrom(state.frames, seconds);
}
function frameAtTimeFrom(frames, seconds) {
  if (!frames?.length) return null;
  const position = Math.max(0, Math.min(frames.length - 1, seconds / .25));
  const index = Math.floor(position), amount = position - index;
  const a = frames[index] || frames[frames.length - 1], b = frames[index + 1] || a;
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
  // The first render happens before bootstrap returns. Guard the assessment
  // object itself so a refresh cannot abort startup before connectGpu runs.
  $('assessment-time').textContent = a?.model?.gpu_ms != null ? Math.round(a.model.gpu_ms) + ' ms GPU' : 'REMOTE COMPUTE';
  $('compute-model').textContent = (a?.model?.decision_baseline || 'V4 BASELINE').toUpperCase();
  $('compute-physics').textContent = (a?.model?.simulator || 'OVERTIQ GPU').toUpperCase();
  $('compute-latency').textContent = a?.model?.gpu_ms != null ? Math.round(a.model.gpu_ms) + ' MS' : '—';
  renderComparison();
}
function renderZones() {
  const backendRows = state.zones || [];
  const rows = currentTrack.zones.map((zone, index) => {
    const remote = backendRows.find(row => row.zone === zone.id);
    const base = remote || backendRows[index] || {};
    return { ...base, ...zone, assessment: base.assessment || {}, recommendation: base.recommendation || {} };
  });
  $('zone-rows').innerHTML = rows.length ? rows.map(z => {
    const a = z.assessment || {}; const pass = a.can_pass_within_60s?.probability ?? 0; const durable = a.durable_pass?.probability ?? 0;
    const action = z.recommendation?.action || 'HOLD';
    return '<tr data-zone="' + z.id + '"><td><b>' + z.id + '</b><small class="zone-row-note">' + (z.approach || '') + '</small></td><td>S' + z.sector + '</td><td><span class="zone-type ' + String(z.type || '').toLowerCase() + '">' + (z.type || 'ZONE') + '</span></td><td class="probability">' + fmtPct(pass) + '</td><td class="probability">' + fmtPct(durable) + '</td><td><strong class="action-' + action.toLowerCase() + '">' + action + '</strong><small class="zone-row-note">' + (z.note || '') + '</small></td></tr>';
  }).join('') : '<tr><td colspan="6" class="empty-row">Waiting for live GPU zone assessment.</td></tr>';
  const list = $('map-zone-list');
  if (list) list.innerHTML = currentTrack.zones.map(z => '<button type="button" class="map-zone-chip ' + (z.type === 'Overtake' ? 'overtake' : 'braking') + '" data-zone="' + z.id + '" data-position="' + z.position + '"><b>' + z.id + '</b><span>' + z.approach + '</span></button>').join('');
  list?.querySelectorAll('[data-zone]').forEach(button => button.addEventListener('click', () => { const position = Number(button.dataset.position); seek(position * 60); }));
  list?.querySelectorAll('[data-zone]').forEach(button => button.title = currentTrack.zones.find(z => z.id === button.dataset.zone)?.note || '');
  renderTrackInfo();
}
function renderTrackInfo() {
  const meta = $('track-meta');
  if (meta) meta.textContent = currentTrack.country + ' · ' + currentTrack.name + ' · ' + formatTrackLength(currentTrack.lengthM) + ' · ' + currentTrack.laps + ' LAPS';
  const profile = $('track-profile');
  if (profile) profile.textContent = currentTrack.profile;
  const info = $('track-zone-count');
  if (info) info.textContent = currentTrack.zones.filter(z => z.type === 'Overtake').length + ' OVERTAKE WINDOWS · ' + currentTrack.zones.length + ' DECISION ZONES';
  const laps = lap-count;
  if (laps) laps.textContent = '/ ' + currentTrack.laps + ' LAPS';
}
function zoneColor(zone) { return zone.type === 'Overtake' ? '#f479a2' : '#d6b555'; }
function createZoneHighlights(scene, curve) {
  const group = new THREE.Group(); group.name = 'overtaking-zone-highlights';
  currentTrack.zones.forEach(zone => {
    const halfWidth = zone.type === 'Overtake' ? .022 : .014;
    const points = [];
    for (let i = 0; i <= 10; i++) points.push(curve.getPointAt((zone.position - halfWidth + (halfWidth * 2 * i / 10) + 1) % 1));
    const path = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    const material = new THREE.MeshBasicMaterial({ color: zoneColor(zone), transparent: true, opacity: zone.type === 'Overtake' ? .6 : .28 });
    const strip = new THREE.Mesh(new THREE.TubeGeometry(path, 16, zone.type === 'Overtake' ? 21 : 18, 8, false), material);
    strip.userData = { zoneId: zone.id, zoneType: zone.type, baseOpacity: material.opacity };
    group.add(strip);
    const markerMaterial = new THREE.MeshBasicMaterial({ color: zoneColor(zone), transparent: true, opacity: zone.type === 'Overtake' ? .9 : .4, side: THREE.DoubleSide });
    const marker = new THREE.Mesh(new THREE.RingGeometry(zone.type === 'Overtake' ? 24 : 20, zone.type === 'Overtake' ? 29 : 24, 24), markerMaterial);
    marker.position.copy(curve.getPointAt(zone.position)); marker.position.y = 25; marker.rotation.x = -Math.PI / 2;
    marker.userData = { zoneId: zone.id, zoneType: zone.type, baseOpacity: markerMaterial.opacity };
    group.add(marker);
  });
  scene.add(group); return group;
}
function setActiveZone(group, activeId) {
  if (!group) return;
  group.children.forEach(child => {
    const active = Boolean(activeId && child.userData.zoneId === activeId);
    const material = child.material;
    material.opacity = active ? 1 : child.userData.baseOpacity;
    material.color.set(active ? '#b7f578' : zoneColor({ type: child.userData.zoneType }));
  });
  document.querySelectorAll('.map-zone-chip').forEach(chip => chip.classList.toggle('active', chip.dataset.zone === activeId));
  document.querySelectorAll('tr[data-zone]').forEach(row => row.classList.toggle('active', row.dataset.zone === activeId));
}
function updateTrackGeometry() {
  trackRoad?.geometry.dispose(); trackRoad && (trackRoad.geometry = new THREE.TubeGeometry(trackCurve, 160, 17, 8, true));
  trackLine?.geometry.dispose(); trackLine && (trackLine.geometry = new THREE.TubeGeometry(trackCurve, 160, 1.5, 5, true));
  if (trackZoneGroup) { trackScene.remove(trackZoneGroup); trackZoneGroup.traverse(child => child.geometry?.dispose()); }
  trackZoneGroup = createZoneHighlights(trackScene, trackCurve);
  Object.values(comparisonViews).forEach(view => {
    if (!view) return;
    view.road.geometry.dispose(); view.road.geometry = new THREE.TubeGeometry(trackCurve, 128, 15, 7, true);
    view.edge.geometry.dispose(); view.edge.geometry = new THREE.TubeGeometry(trackCurve, 128, 1.4, 5, true);
    if (view.zoneGroup) { view.trackScene.remove(view.zoneGroup); view.zoneGroup.traverse(child => child.geometry?.dispose()); }
    view.zoneGroup = createZoneHighlights(view.trackScene, trackCurve);
  });
  renderTrackInfo(); renderZones(); renderFrame();
}
function selectTrack(id) {
  const next = getTrack(id);
  if (!next || next.id === currentTrack.id) return;
  currentTrack = next; state.controls.track_id = next.id; sessionStorage.setItem(TRACK_PREF_KEY, next.id); trackCurve = makeTrackCurve(currentTrack); state.frames = []; state.frameIndex = 0; state.time = 0; state.scenarioKey = '';
  state.streamWanted = false; state.stream?.close(); state.stream = null;
  $('sim-state').innerHTML = '<i class="live-dot"></i> TRACK CHANGED · APPLY TO GPU';
  updateTrackGeometry(); saveSnapshot();
}
function initThree() {
  const trackCanvas = $('track-canvas'), povCanvas = $('pov-canvas');
  trackRenderer = new THREE.WebGLRenderer({ canvas: trackCanvas, antialias: true, alpha: true });
  povRenderer = new THREE.WebGLRenderer({ canvas: povCanvas, antialias: true, alpha: false });
  [trackRenderer, povRenderer].forEach(r => { r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25)); r.outputColorSpace = THREE.SRGBColorSpace; });
  trackScene = new THREE.Scene(); trackScene.background = new THREE.Color('#0d1518');
  trackCamera = new THREE.OrthographicCamera(-420, 420, 300, -300, .1, 2000); trackCamera.position.set(0, 650, 0); trackCamera.up.set(0, 0, -1); trackCamera.lookAt(0, 0, 0);
  trackRoad = new THREE.Mesh(new THREE.TubeGeometry(trackCurve, 160, 17, 8, true), new THREE.MeshBasicMaterial({ color: '#202b30' }));
  trackLine = new THREE.Mesh(new THREE.TubeGeometry(trackCurve, 160, 1.5, 5, true), new THREE.MeshBasicMaterial({ color: '#667879' }));
  trackScene.add(trackRoad, trackLine, new THREE.AmbientLight('#ffffff', 1));
  trackZoneGroup = createZoneHighlights(trackScene, trackCurve);
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
  initComparisonViews();
  resizeThree(); window.addEventListener('resize', resizeThree);
}
function initComparisonViews() {
  comparisonViews.before = makeComparisonView('before-race-canvas');
  comparisonViews.after = makeComparisonView('after-race-canvas');
}
function makeComparisonView(canvasId) {
  const canvas = $(canvasId);
  if (!canvas) return null;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = false;
  const trackScene = new THREE.Scene(); trackScene.background = new THREE.Color('#0d1518');
  const trackCamera = new THREE.OrthographicCamera(-340, 340, 245, -245, .1, 2000);
  trackCamera.position.set(0, 620, 0); trackCamera.up.set(0, 0, -1); trackCamera.lookAt(0, 0, 0);
  const road = new THREE.Mesh(new THREE.TubeGeometry(trackCurve, 128, 15, 7, true), new THREE.MeshBasicMaterial({ color: '#202c30' }));
  const edge = new THREE.Mesh(new THREE.TubeGeometry(trackCurve, 128, 1.4, 5, true), new THREE.MeshBasicMaterial({ color: '#728383' }));
  trackScene.add(road, edge, new THREE.AmbientLight('#dce8e4', 1));
  const zoneGroup = createZoneHighlights(trackScene, trackCurve);
  const trackCar = new THREE.Mesh(new THREE.SphereGeometry(9, 14, 10), new THREE.MeshBasicMaterial({ color: '#b7f578' }));
  const trackOpp = new THREE.Mesh(new THREE.SphereGeometry(7, 14, 10), new THREE.MeshBasicMaterial({ color: '#f479a2' }));
  trackScene.add(trackCar, trackOpp);
  const povScene = new THREE.Scene(); povScene.background = new THREE.Color('#111e26');
  const povCamera = new THREE.PerspectiveCamera(67, 1, .1, 2000); povCamera.position.set(0, 14, 26); povCamera.rotation.x = -.08;
  const povRig = new THREE.Group(); povScene.add(povRig);
  const roadPlane = new THREE.Mesh(new THREE.PlaneGeometry(150, 1100), new THREE.MeshStandardMaterial({ color: '#141a1d', roughness: .97, metalness: .02 }));
  roadPlane.rotation.x = -Math.PI / 2; roadPlane.position.z = -500; povRig.add(roadPlane);
  for (let i = 0; i < 24; i++) { const dash = new THREE.Mesh(new THREE.BoxGeometry(.3, .035, 7), new THREE.MeshBasicMaterial({ color: '#89948e' })); dash.position.set(0, .05, -i * 40 - 26); povRig.add(dash); }
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1.4, 6, 1100), new THREE.MeshStandardMaterial({ color: '#5e706d', roughness: .75, metalness: .25 })); rail.position.set(side * 17, 3, -500); povRig.add(rail);
    for (let i = 0; i < 24; i++) { const kerb = new THREE.Mesh(new THREE.BoxGeometry(3.2, .25, 14), new THREE.MeshStandardMaterial({ color: i % 2 ? '#cf6170' : '#eef0dc', roughness: .82 })); kerb.position.set(side * 15, .28, -i * 40 - 28); povRig.add(kerb); }
  }
  const halo = new THREE.Mesh(new THREE.TorusGeometry(11.5, 1.35, 8, 32, Math.PI), new THREE.MeshBasicMaterial({ color: '#080b0d' })); halo.rotation.z = Math.PI; halo.position.set(0, 12, 2); povRig.add(halo);
  const wheel = new THREE.Group(); wheel.position.set(0, -1.5, 18); povRig.add(wheel);
  const wheelRing = new THREE.Mesh(new THREE.TorusGeometry(7.2, 1.5, 8, 22), new THREE.MeshBasicMaterial({ color: '#07090a' })); wheelRing.scale.set(1.18, .72, .56); wheel.add(wheelRing);
  for (let i = 0; i < 3; i++) { const spoke = new THREE.Mesh(new THREE.BoxGeometry(.9, 8.5, .8), new THREE.MeshBasicMaterial({ color: '#778485' })); spoke.rotation.z = i * Math.PI / 3; wheel.add(spoke); }
  const dash = new THREE.Mesh(new THREE.BoxGeometry(31, 3.2, 9), new THREE.MeshBasicMaterial({ color: '#0a0e10' })); dash.position.set(0, 4.7, 12); povRig.add(dash);
  const screen = new THREE.Mesh(new THREE.BoxGeometry(9, 2.2, .3), new THREE.MeshBasicMaterial({ color: '#b7f578' })); screen.position.set(0, 6.2, 8); povRig.add(screen);
  for (const side of [-1, 1]) { const pod = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 18), new THREE.MeshStandardMaterial({ color: '#20282b', roughness: .6, metalness: .25 })); pod.position.set(side * 16, 1, 13); povRig.add(pod); }
  povScene.add(new THREE.HemisphereLight('#bfd7e6', '#101719', 1.15), new THREE.DirectionalLight('#dbe9e5', 1.2));
  return { canvas, renderer, trackScene, trackCamera, trackCar, trackOpp, povScene, povCamera, povRig, wheel, road, edge, zoneGroup };
}
function resizeThree() {
  const box = $('visual-wrap').getBoundingClientRect(), w = Math.max(320, box.width), h = Math.max(280, box.height - 2);
  trackRenderer?.setSize(w, h, false); povRenderer?.setSize(w, h, false);
  if (povCamera) { povCamera.aspect = w / h; povCamera.updateProjectionMatrix(); }
  Object.values(comparisonViews).forEach(view => {
    if (!view) return;
    const box = view.canvas.getBoundingClientRect(), w = Math.max(260, box.width), h = Math.max(190, box.height);
    view.renderer.setSize(w, h, false);
    view.povCamera.aspect = Math.max(1, (w / 2) / h); view.povCamera.updateProjectionMatrix();
  });
  renderComparisonViews();
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
  setActiveZone(trackZoneGroup, frame.track?.zone);
  if (state.view === 'pov') povRenderer.render(povScene, povCamera); else trackRenderer.render(trackScene, trackCamera);
}
function renderComparisonViews() {
  const before = frameAtTimeFrom(state.beforeFrames, state.time);
  const after = frameAtTimeFrom(state.frames, state.time);
  renderComparisonView(comparisonViews.before, before, 'before');
  renderComparisonView(comparisonViews.after, after, 'after');
  const clock = new Date(Math.max(0, state.time || 0) * 1000).toISOString().slice(14, 19);
  $('before-race-time').textContent = clock; $('after-race-time').textContent = clock;
  $('before-race-lap').textContent = before?.race?.lap != null ? 'L' + before.race.lap : 'WAITING';
  $('after-race-lap').textContent = after?.race?.lap != null ? 'L' + after.race.lap : 'WAITING';
  setComparisonTelemetry('before', before); setComparisonTelemetry('after', after);
}
function setComparisonTelemetry(prefix, frame) {
  const k = frame?.kinematics || {}, race = frame?.race || {}, flags = frame?.flags || {};
  const stateLabel = flags.red_flag ? 'RED' : (flags.vsc || flags.safety_car ? 'VSC' : (frame ? 'GREEN' : 'WAIT'));
  $(prefix + '-race-speed').textContent = frame ? Math.round(k.speed_kph ?? ((k.speed_mps || 0) * 3.6)) + ' KPH' : '—';
  $(prefix + '-race-gear').textContent = frame ? String(frame.controls?.gear ?? 7) : '—';
  $(prefix + '-race-gap').textContent = frame && race.gap_ahead_s != null ? Number(race.gap_ahead_s).toFixed(2) + ' S' : '—';
  $(prefix + '-race-state').textContent = stateLabel;
  $(prefix + '-race-state').classList.toggle('alert', stateLabel === 'RED' || stateLabel === 'VSC');
}
function renderComparisonView(view, frame, side) {
  if (!view) return;
  const renderer = view.renderer, canvas = view.canvas;
  const width = canvas.width || 520, height = canvas.height || 240, half = Math.floor(width / 2);
  renderer.setScissorTest(false); renderer.clear(true, true, true); renderer.setScissorTest(true);
  renderer.setViewport(0, 0, half, height); renderer.setScissor(0, 0, half, height);
  const s = (frame?.track?.s_m || 0) / (frame?.track?.length_m || 5278), gap = frame?.race?.gap_ahead_s || .5;
  const p = trackCurve.getPointAt((s % 1 + 1) % 1), op = trackCurve.getPointAt((s + Math.min(.08, gap / 80)) % 1);
  view.trackCar.position.copy(p); view.trackCar.position.y = 11; view.trackOpp.position.copy(op); view.trackOpp.position.y = 9;
  setActiveZone(view.zoneGroup, frame?.track?.zone);
  renderer.render(view.trackScene, view.trackCamera);
  renderer.setViewport(half, 0, width - half, height); renderer.setScissor(half, 0, width - half, height);
  const steer = frame?.kinematics?.steering_rad || 0, speed = frame?.kinematics?.speed_mps || 78, yaw = frame?.kinematics?.yaw_rate_radps || 0;
  view.wheel.rotation.z = -steer * .7; view.povRig.rotation.z = (frame?.pose?.roll_rad || 0) * .65; view.povRig.rotation.x = (frame?.pose?.pitch_rad || 0) * .5;
  view.povCamera.position.y = 14 + Math.min(.6, Math.abs(yaw) * 2); view.povCamera.position.z = 26 - Math.min(1.1, Math.abs(speed - 78) * .02); view.povCamera.rotation.y = steer * .035;
  view.povRig.position.z = -((frame?.track?.s_m || 0) % 42) * .02;
  renderer.render(view.povScene, view.povCamera);
  renderer.setScissorTest(false);
}
function setView(view) {
  state.view = view; $('visual-wrap').classList.toggle('pov-mode', view === 'pov'); $('view-label').textContent = view === 'pov' ? 'DRIVER POV' : 'CIRCUIT VIEW';
  $('circuit-view').classList.toggle('active', view === 'circuit'); $('pov-view-button').classList.toggle('active', view === 'pov'); resizeThree(); renderFrame();
}
function seek(seconds) { state.time = Math.max(0, Math.min(60, seconds)); state.frameIndex = state.frames.length ? Math.min(state.frames.length - 1, Math.round(state.time / .25)) : 0; renderFrame(); }
function playToggle() { state.playing = !state.playing; $('play').textContent = state.playing ? 'Ⅱ' : '▶'; }
function scheduleStreamReconnect() {
  if (state.streamTimer || state.httpAbort || state.stream || !state.connected || !state.streamWanted) return;
  const delay = Math.min(12000, 1000 * Math.pow(2, Math.min(state.streamAttempt, 4)));
  state.streamAttempt += 1; setReconnecting('GPU frame stream retry ' + state.streamAttempt + ' in ' + Math.ceil(delay / 1000) + 's…');
  $('sim-state').innerHTML = '<i class="live-dot"></i> GPU STREAM RECONNECTING';
  state.streamTimer = setTimeout(() => { state.streamTimer = null; startStream(true); }, delay);
}
function consumeStreamFrame(frame) {
  if (state.frames.length > 260 || (state.frames.length && frame.t === 0)) state.frames = [];
  state.frames.push(frame); state.frameIndex = state.frames.length - 1; state.time = frame.t || state.time;
  state.connected = true; state.snapshotRestored = false; setStatus('RTX 3060', true); saveSnapshot(); renderFrame();
}
function startStream(force = false) {
  if (!state.connected || !state.apiBase) { $('data-note').textContent = 'Remote GPU link is not ready.'; return; }
  if ((state.httpAbort || state.stream) && !force) {
    state.streamWanted = false; state.httpAbort?.abort(); state.httpAbort = null; state.stream?.close(); state.stream = null;
    $('live-stream').classList.remove('active'); $('live-stream').innerHTML = 'GPU STREAM <span>●</span>'; $('sim-state').innerHTML = '<i class="live-dot"></i> GPU STREAM PAUSED'; return;
  }
  state.streamWanted = true; state.httpAbort?.abort(); state.httpAbort = null; state.stream?.close(); state.stream = null;
  const params = new URLSearchParams({ key: state.apiKey || '', track_id: currentTrack.id, track_length_m: String(currentTrack.lengthM), weather: state.controls.weather, tire_compound: state.controls.tire_compound, rain_intensity: String(state.controls.rain_intensity), ers_fraction: String(state.controls.ers_fraction), fuel_kg: String(state.controls.fuel_kg), vsc: String(state.controls.vsc), red_flag: String(state.controls.red_flag), decision: state.decision });
  // Use the newline-delimited HTTP stream for the live channel. It works
  // through local proxies and browser privacy layers that leave WebSocket
  // handshakes stuck in CONNECTING, while keeping one GPU scenario per stream.
  const controller = new AbortController(); state.httpAbort = controller;
  $('live-stream').classList.add('active'); $('live-stream').textContent = 'STOP STREAM'; $('sim-state').innerHTML = '<i class="live-dot"></i> GPU STREAM CONNECTING';
  let received = false, buffer = '', watchdog = setTimeout(() => { if (!received) controller.abort(); }, 30000);
  (async () => {
    try {
      const response = await fetch(state.apiBase + '/streams/2026_11361/events?' + params.toString(), { signal: controller.signal, mode: 'cors', cache: 'no-store' });
      if (!response.ok || !response.body) throw new Error('GPU stream returned ' + response.status);
      state.streamAttempt = 0; setStatus('RTX 3060', true); $('data-note').textContent = 'Race engineer decision workspace · live GPU stream verified'; $('sim-state').innerHTML = '<i class="live-dot"></i> GPU STREAM LIVE';
      const reader = response.body.getReader(), decoder = new TextDecoder();
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        if (!received) { received = true; clearTimeout(watchdog); }
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split('\n'); buffer = lines.pop() || '';
        for (const line of lines) if (line.trim()) consumeStreamFrame(JSON.parse(line));
      }
      if (buffer.trim()) consumeStreamFrame(JSON.parse(buffer));
      throw new Error('GPU stream closed');
    } catch (error) {
      clearTimeout(watchdog); if (controller.signal.aborted && !state.streamWanted) return;
      if (state.httpAbort === controller) { state.httpAbort = null; $('data-note').textContent = 'GPU stream interrupted: ' + error.message; scheduleStreamReconnect(); }
    }
  })();
}
async function applyScenario() {
  controlsFromInputs();
  const key = scenarioKey();
  if (!state.connected) { $('scenario-result').textContent = 'FAILED · GPU baseline is not ready.'; return; }
  if (state.assessmentCache.has(key)) {
    const cached = state.assessmentCache.get(key); state.assessment = cached.assessment || cached; if (cached.frames) state.frames = cached.frames;
    state.scenarioKey = key; renderAssessment(); renderComparison(); $('scenario-result').textContent = 'NO CUDA RUN NEEDED · this exact scenario is already loaded'; $('sim-state').innerHTML = '<i class="live-dot"></i> SCENARIO READY · CACHED'; return;
  }
  if (state.assessmentPromise) return state.assessmentPromise;
  const started = performance.now();
  $('apply-scenario').disabled = true; $('apply-scenario').textContent = 'CUDA RUNNING…'; $('scenario-result').className = 'scenario-result running'; $('scenario-result').textContent = 'SUBMITTED · adjusted scenario is running on the RTX 3060'; $('sim-state').innerHTML = '<i class="live-dot"></i> CUDA RUNNING · AFTER SCENARIO'; $('data-badge').textContent = 'GPU COMPUTING';
  const payload = requestPayload();
  state.assessmentPromise = api('/engineer/assess', { method: 'POST', body: JSON.stringify({ request: payload, include_frames: true }) }).then(result => {
    state.assessmentCache.set(key, result); state.assessment = result; state.scenarioKey = key; state.frames = result.frames || state.frames; state.requestCount += 1; saveSnapshot();
    const elapsed = Math.round(performance.now() - started); setStatus('READY', true); $('compute-latency').textContent = elapsed + ' MS';
    $('compute-requests').textContent = state.requestCount + ' AFTER RUN' + (state.requestCount === 1 ? '' : 'S'); renderAssessment(); renderComparison(); renderZones(); renderFrame();
    const ans = result.answers || {}; const cond = [state.controls.weather, state.controls.tire_compound, state.controls.vsc ? 'VSC' : '', state.controls.red_flag ? 'RED FLAG' : ''].filter(Boolean).join(' · ');
    $('scenario-result').className = 'scenario-result success'; $('scenario-result').textContent = 'COMPLETE · ' + elapsed + ' ms · ' + (result.recommendation?.action || 'HOLD') + ' · pass ' + fmtPct(ans.can_pass_within_60s?.probability) + ' · durable ' + fmtPct(ans.durable_pass?.probability) + ' · expected ' + (ans.finish_position?.expected == null ? '—' : 'P' + Number(ans.finish_position.expected).toFixed(1)) + (cond ? ' · ' + cond : '');
    $('sim-state').innerHTML = '<i class="live-dot"></i> COMPLETE · ADJUSTED SCENARIO LOADED';
  }).catch(error => { setStatus('GPU ERROR', false); $('scenario-result').className = 'scenario-result failed'; $('scenario-result').textContent = 'FAILED · ' + error.message; $('sim-state').innerHTML = '<i class="live-dot"></i> SCENARIO FAILED'; }).finally(() => { state.assessmentPromise = null; $('apply-scenario').disabled = false; $('apply-scenario').textContent = 'APPLY TO GPU SIMULATOR'; });
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
$('live-stream').disabled = true;
$('fullscreen').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch {} });
$('weather').addEventListener('change', controlsFromInputs); $('tyre-compound').addEventListener('change', controlsFromInputs);
$('track-select')?.addEventListener('change', e => selectTrack(e.target.value));
['rain-intensity','ers-fraction','fuel-kg'].forEach(id => $(id).addEventListener('input', controlsFromInputs));
['vsc-toggle','red-flag-toggle'].forEach(id => $(id).addEventListener('click', () => { const b = $(id); b.dataset.active = b.dataset.active === 'true' ? 'false' : 'true'; b.classList.toggle('on', b.dataset.active === 'true'); b.querySelector('span').textContent = b.dataset.active === 'true' ? 'ON' : 'OFF'; controlsFromInputs(); }));
$('apply-scenario').addEventListener('click', applyScenario);
document.querySelectorAll('[data-decision]').forEach(button => button.addEventListener('click', () => { state.decision = button.dataset.decision; document.querySelectorAll('[data-decision]').forEach(b => b.classList.toggle('active', b === button)); applyScenario(); }));
document.addEventListener('keydown', e => { if (/INPUT|SELECT|BUTTON|TEXTAREA/.test(e.target.tagName) || e.altKey || e.ctrlKey || e.metaKey) return; if (e.code === 'Space') { e.preventDefault(); playToggle(); } if (e.code === 'ArrowLeft') seek(state.time - 5); if (e.code === 'ArrowRight') seek(state.time + 5); });
const context = document.modelContext;
if (context?.registerTool) { try { context.registerTool({ name: 'configure_race_replay', title: 'Configure GPU race replay', description: 'Seek the remote GPU Overtiq replay and set playback state.', inputSchema: { type: 'object', properties: { seconds: { type: 'number', minimum: 0, maximum: 60 }, playing: { type: 'boolean' } }, required: ['seconds', 'playing'], additionalProperties: false }, execute(input) { seek(input.seconds); state.playing = input.playing; return { seconds: state.time, driver: 'OCO', playing: state.playing, gpuBacked: state.connected }; } }); } catch {} }

try {
  initThree(); syncControlInputs(); clearLiveState(); renderTrackInfo(); requestAnimationFrame(tick);
  if (!state.apiBase) state.apiBase = location.origin;
  window.__overtiqBoot = { apiBase: state.apiBase, sameOrigin: state.apiBase === location.origin };
  connectGpu(true);
} catch (error) {
  window.__overtiqBoot = { error: error?.message || String(error), apiBase: state.apiBase };
  $('data-note').textContent = 'Terminal startup failed: ' + (error?.message || String(error));
  $('sim-state').innerHTML = '<i class="live-dot"></i> TERMINAL RETRYING';
  setTimeout(() => connectGpu(true), 1000);
}
window.addEventListener('online', () => { if (!state.connected) connectGpu(true); });
