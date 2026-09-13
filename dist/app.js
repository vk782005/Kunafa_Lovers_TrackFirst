import * as THREE from './three.module.js';
import { formatTrackLength, getTrack } from './track-data.js?v=25';

const $ = (id) => document.getElementById(id);
// The race terminal and GPU API are served by the same FastAPI origin. A
// query override remains available for development, but production never
// depends on a localhost bridge or an SSH process.
const API_DEFAULT = new URLSearchParams(location.search).get('api') || location.origin;
const API_KEY_DEFAULT = '5839920c81e1214f49627dd91a26b9861160d68925291dc0eb42cad4667bc206';
const SNAPSHOT_KEY = 'overtiq-gpu-snapshot-v1';
const TRACK_PREF_KEY = 'overtiq-track-id-v2';
const FOCUS_TRACK_IDS = new Set(['MCO', 'ITA']);
const UI_DEFAULT_TRACK_ID = 'MCO';
const savedTrack = sessionStorage.getItem(TRACK_PREF_KEY) || 'MCO';
const SAVED_TRACK_ID = FOCUS_TRACK_IDS.has(savedTrack) ? savedTrack : UI_DEFAULT_TRACK_ID;
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

let trackRenderer, povRenderer, trackScene, povScene, trackCamera, povCamera, carMesh, oppMesh, wheelMesh, povRig, povMotion;
let currentTrack = getTrack(state.controls.track_id), trackCurve;
let trackRoad, trackLine, trackZoneGroup;
const comparisonViews = { before: null, after: null };
function makeTrackCurve(track) {
  return new THREE.CatmullRomCurve3(track.geometry.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
}
function makeTrackRibbon(curve, width = 34, segments = 192, start = 0, end = 1, y = 0) {
  const positions = [], uvs = [], indices = [], half = width / 2;
  for (let i = 0; i <= segments; i++) {
    const progress = start + (end - start) * i / segments;
    const u = ((progress % 1) + 1) % 1;
    const point = curve.getPointAt(u), tangent = curve.getTangentAt(u).normalize();
    const nx = -tangent.z, nz = tangent.x;
    positions.push(point.x + nx * half, y, point.z + nz * half, point.x - nx * half, y, point.z - nz * half);
    uvs.push(0, i / segments, 1, i / segments);
    if (i < segments) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
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
  return { session_key: currentTrack.sessionKey, track_id: currentTrack.id, track_length_m: currentTrack.lengthM, driver_number: 31, driver_code: 'OCO', lap: 35, position: 14, gap_ahead_s: .558, speed_mps: 78.9, decision, horizon_s: 60, n_scenarios: 2048,
    weather: state.controls.weather, tire_compound: state.controls.tire_compound, rain_intensity: state.controls.rain_intensity,
    ers_fraction: state.controls.ers_fraction, fuel_kg: state.controls.fuel_kg, vsc: state.controls.vsc, red_flag: state.controls.red_flag };
}
function scenarioKey(decision = state.decision, controls = state.controls) { return JSON.stringify({ decision, ...controls }); }
function controlsFromInputs() {
  state.controls = { track_id: $('track-select')?.value || state.controls.track_id || UI_DEFAULT_TRACK_ID, weather: $('weather').value, tire_compound: $('tyre-compound').value, rain_intensity: Number($('rain-intensity').value) / 100,
    ers_fraction: Number($('ers-fraction').value) / 100, fuel_kg: Number($('fuel-kg').value), vsc: $('vsc-toggle').dataset.active === 'true', red_flag: $('red-flag-toggle').dataset.active === 'true' };
  $('rain-value').textContent = Math.round(state.controls.rain_intensity * 100) + '%'; $('ers-value').textContent = Math.round(state.controls.ers_fraction * 100) + '%'; $('fuel-value').textContent = Math.round(state.controls.fuel_kg) + ' kg';
}
function syncControlInputs() {
  if ($('track-select')) $('track-select').value = FOCUS_TRACK_IDS.has(state.controls.track_id) ? state.controls.track_id : UI_DEFAULT_TRACK_ID;
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
    sessionStorage.setItem(TRACK_PREF_KEY, state.controls.track_id || UI_DEFAULT_TRACK_ID);
    const restoredTrack = getTrack(FOCUS_TRACK_IDS.has(state.controls.track_id) ? state.controls.track_id : UI_DEFAULT_TRACK_ID);
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
      state.playing = true; $('play').textContent = 'Ⅱ';
      // Rendering is presentation work. Once bootstrap returned 200, a
      // renderer failure must never be reclassified as a GPU connection
      // failure or schedule another POST.
      for (const render of [renderAssessment, renderComparison, renderZones, renderFrame]) {
        try { render(); } catch (error) { console.error('Renderer failed after baseline load', error); }
      }
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
  $('hud-lap').textContent = (race.lap ?? 35) + ' / ' + currentTrack.laps;
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
  const stressHeading = document.querySelector('.sim-heading h2');
  if (stressHeading) stressHeading.textContent = 'Stress the ' + currentTrack.name + ' decision model';
  const trackLabel = $('track-select')?.parentElement?.firstChild;
  if (trackLabel && trackLabel.nodeType === Node.TEXT_NODE) trackLabel.textContent = 'ACTIVE TRACK';
  const info = $('track-zone-count');
  if (info) info.textContent = currentTrack.zones.filter(z => z.type === 'Overtake').length + ' OVERTAKE WINDOWS · ' + currentTrack.zones.length + ' DECISION ZONES';
  const laps = $('lap-count');
  if (laps) laps.textContent = '/ ' + currentTrack.laps + ' LAPS';
  const eyebrow = $('session-eyebrow');
  if (eyebrow) eyebrow.innerHTML = 'ROUND ' + currentTrack.round + ' <span>/</span> ' + currentTrack.country + ' <span>/</span> ' + currentTrack.sessionKey;
  const circuit = $('session-circuit');
  if (circuit) circuit.innerHTML = currentTrack.name + ' Circuit <span>•</span> Ocon 31 · engineer channel';
  const ticks = document.querySelector('.timeline-ticks');
  if (ticks) {
    const windows = currentTrack.zones.filter(zone => zone.type === 'Overtake').slice(0, 3);
    ticks.innerHTML = ['L35', ...windows.map(zone => 'ZONE ' + zone.id), 'L38'].map(label => '<span>' + label + '</span>').join('');
  }
}
function limitTrackSelector() {
  const select = $('track-select');
  if (!select) return;
  Array.from(select.options).forEach(option => { if (!FOCUS_TRACK_IDS.has(option.value)) option.remove(); });
  select.value = FOCUS_TRACK_IDS.has(state.controls.track_id) ? state.controls.track_id : UI_DEFAULT_TRACK_ID;
}
function zoneColor(zone) { return zone.type === 'Overtake' ? '#f479a2' : '#d6b555'; }
function createZoneHighlights(scene, curve) {
  const group = new THREE.Group(); group.name = 'overtaking-zone-highlights';
  currentTrack.zones.forEach(zone => {
    const halfWidth = zone.type === 'Overtake' ? .022 : .014;
    const material = new THREE.MeshBasicMaterial({ color: zoneColor(zone), transparent: true, opacity: zone.type === 'Overtake' ? .72 : .38, side: THREE.DoubleSide, depthTest: true });
    const strip = new THREE.Mesh(makeTrackRibbon(curve, zone.type === 'Overtake' ? 32 : 27, 18, zone.position - halfWidth, zone.position + halfWidth, .7), material);
    strip.userData = { zoneId: zone.id, zoneType: zone.type, baseOpacity: material.opacity };
    group.add(strip);
    const markerMaterial = new THREE.MeshBasicMaterial({ color: zoneColor(zone), transparent: true, opacity: zone.type === 'Overtake' ? .9 : .4, side: THREE.DoubleSide });
    const marker = new THREE.Mesh(new THREE.RingGeometry(zone.type === 'Overtake' ? 8 : 7, zone.type === 'Overtake' ? 12 : 10, 24), markerMaterial);
    marker.position.copy(curve.getPointAt(zone.position)); marker.position.y = 1.2; marker.rotation.x = -Math.PI / 2;
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
  trackRoad?.geometry.dispose(); trackRoad && (trackRoad.geometry = makeTrackRibbon(trackCurve, 34, 256, 0, 1, .1));
  trackLine?.geometry.dispose(); trackLine && (trackLine.geometry = makeTrackRibbon(trackCurve, 42, 256, 0, 1, 0));
  if (trackZoneGroup) { trackScene.remove(trackZoneGroup); trackZoneGroup.traverse(child => child.geometry?.dispose()); }
  trackZoneGroup = createZoneHighlights(trackScene, trackCurve);
  Object.values(comparisonViews).forEach(view => {
    if (!view) return;
    view.road.geometry.dispose(); view.road.geometry = makeTrackRibbon(trackCurve, 32, 224, 0, 1, .1);
    view.edge.geometry.dispose(); view.edge.geometry = makeTrackRibbon(trackCurve, 40, 224, 0, 1, 0);
    if (view.zoneGroup) { view.trackScene.remove(view.zoneGroup); view.zoneGroup.traverse(child => child.geometry?.dispose()); }
    view.zoneGroup = createZoneHighlights(view.trackScene, trackCurve);
  });
  renderTrackInfo(); renderZones(); renderFrame();
}
async function selectTrack(id) {
  const next = getTrack(id);
  if (!next || next.id === currentTrack.id) return;
  currentTrack = next; state.controls.track_id = next.id; sessionStorage.setItem(TRACK_PREF_KEY, next.id); trackCurve = makeTrackCurve(currentTrack); state.frames = []; state.beforeFrames = []; state.assessment = null; state.beforeAssessment = null; state.zones = []; state.frameIndex = 0; state.time = 0; state.scenarioKey = '';
  state.streamWanted = false; state.stream?.close(); state.stream = null;
  state.connected = false; setStatus('LOADING ' + next.id, false);
  $('sim-state').innerHTML = '<i class="live-dot"></i> LOADING PRECOMPUTED ' + next.name.toUpperCase() + ' BASELINE';
  updateTrackGeometry();
  await connectGpu(true);
}

function makeF1Car(primary = '#d8ff7a', secondary = '#15191b', scale = 1) {
  const car = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: primary, roughness: .34, metalness: .42 });
  const carbon = new THREE.MeshStandardMaterial({ color: secondary, roughness: .52, metalness: .55 });
  const tireMat = new THREE.MeshStandardMaterial({ color: '#050607', roughness: .88, metalness: .04 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(10, 3.2, 27), bodyMat); body.position.y = 3.8; car.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(3.1, 19, 8), bodyMat); nose.rotation.x = -Math.PI / 2; nose.position.set(0, 3.1, -19); car.add(nose);
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(4.4, 18, 10, 0, Math.PI * 2, 0, Math.PI * .55), carbon); cockpit.scale.set(1, .7, 1.4); cockpit.position.set(0, 6, 3); car.add(cockpit);
  const rear = new THREE.Mesh(new THREE.BoxGeometry(9, 5.5, 11), bodyMat); rear.position.set(0, 5, 13); car.add(rear);
  const frontWing = new THREE.Mesh(new THREE.BoxGeometry(24, .75, 4.2), carbon); frontWing.position.set(0, 2.2, -27); car.add(frontWing);
  const rearWing = new THREE.Mesh(new THREE.BoxGeometry(19, 1.2, 4), carbon); rearWing.position.set(0, 9.2, 18); car.add(rearWing);
  const rearPillar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 7, 1.2), carbon); rearPillar.position.set(0, 6.2, 18); car.add(rearPillar);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(14, .7, 31), carbon); floor.position.set(0, 1.5, 3); car.add(floor);
  for (const axle of [-15, 13]) for (const side of [-1, 1]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 3.8, 16), tireMat);
    wheel.rotation.z = Math.PI / 2; wheel.position.set(side * 9.2, 4, axle); wheel.name = axle < 0 ? 'front-wheel' : 'rear-wheel'; car.add(wheel);
  }
  const halo = new THREE.Mesh(new THREE.TorusGeometry(4.2, .55, 7, 18, Math.PI), carbon); halo.rotation.set(Math.PI / 2, 0, Math.PI); halo.position.set(0, 8.1, 1.5); car.add(halo);
  car.scale.setScalar(scale); car.userData.frontWheels = car.children.filter(child => child.name === 'front-wheel');
  return car;
}

function makeCockpit(scene, camera, compact = false) {
  const rig = new THREE.Group(); scene.add(rig);
  const carbon = new THREE.MeshStandardMaterial({ color: '#090d0f', roughness: .42, metalness: .52 });
  const haas = new THREE.MeshStandardMaterial({ color: '#e5e8e3', roughness: .36, metalness: .32 });
  const red = new THREE.MeshStandardMaterial({ color: '#c7273b', roughness: .34, metalness: .28 });
  const asphalt = new THREE.MeshStandardMaterial({ color: '#171b1c', roughness: .97, metalness: .01 });
  const width = compact ? 120 : 170, depth = compact ? 1000 : 1500, roadHalf = compact ? 16 : 20;
  const road = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), asphalt); road.rotation.x = -Math.PI / 2; road.position.z = -depth * .47; rig.add(road);
  const verge = new THREE.Mesh(new THREE.PlaneGeometry(width * 2.8, depth), new THREE.MeshStandardMaterial({ color: '#17251d', roughness: 1 })); verge.rotation.x = -Math.PI / 2; verge.position.set(0, -.07, -depth * .47); rig.add(verge); road.renderOrder = 1;
  const roadFlow = new THREE.Group(), kerbFlow = new THREE.Group(), postFlow = new THREE.Group(); rig.add(roadFlow, kerbFlow, postFlow);
  const segmentSpan = compact ? 720 : 1080;
  for (let i = 0; i < 34; i++) {
    const mark = new THREE.Mesh(new THREE.BoxGeometry(.36, .04, compact ? 7 : 9), new THREE.MeshBasicMaterial({ color: '#d6ddd7' }));
    mark.userData.baseZ = -i * (compact ? 25 : 34) - 24; mark.position.set(0, .06, mark.userData.baseZ); roadFlow.add(mark);
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 52; i++) {
      const kerb = new THREE.Mesh(new THREE.BoxGeometry(compact ? 3.2 : 4.2, .25, compact ? 8 : 11), new THREE.MeshStandardMaterial({ color: i % 2 ? '#d52f45' : '#eceee8', roughness: .82 }));
      kerb.userData.baseZ = -i * (compact ? 15 : 21) - 18; kerb.position.set(side * roadHalf, .14, kerb.userData.baseZ); kerbFlow.add(kerb);
    }
    for (let i = 0; i < 30; i++) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(.45, compact ? 5 : 7, .45), new THREE.MeshStandardMaterial({ color: '#7f8b87', roughness: .7, metalness: .45 }));
      post.userData.baseZ = -i * (compact ? 26 : 36) - 20; post.position.set(side * (roadHalf + 5), post.geometry.parameters.height / 2, post.userData.baseZ); postFlow.add(post);
    }
  }
  const nose = new THREE.Mesh(new THREE.ConeGeometry(compact ? 3.7 : 4.8, compact ? 36 : 44, 8), haas); nose.rotation.x = -Math.PI / 2; nose.position.set(0, compact ? -3.5 : -2.5, compact ? -7 : -10); rig.add(nose);
  const noseStripe = new THREE.Mesh(new THREE.BoxGeometry(compact ? 2.4 : 3.1, .35, compact ? 25 : 32), red); noseStripe.position.set(0, compact ? -.3 : .3, compact ? -5 : -9); rig.add(noseStripe);
  for (const side of [-1, 1]) {
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(compact ? 5 : 6.2, compact ? 5 : 6.2, compact ? 3.8 : 4.6, 18), new THREE.MeshStandardMaterial({ color: '#050607', roughness: .92 }));
    tire.rotation.z = Math.PI / 2; tire.position.set(side * (compact ? 15.5 : 18.5), compact ? 1.8 : 2.5, compact ? -12 : -16); tire.name = 'cockpit-front-wheel'; rig.add(tire);
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(compact ? 4.4 : 5.4, compact ? 1.8 : 2.2, compact ? 2.1 : 2.6), carbon); mirror.position.set(side * (compact ? 10 : 12), compact ? 7.5 : 9.5, compact ? 8 : 7); rig.add(mirror);
    const stay = new THREE.Mesh(new THREE.BoxGeometry(.45, compact ? 5 : 6, .45), carbon); stay.position.set(side * (compact ? 8 : 10), compact ? 5.5 : 7, compact ? 8 : 7); stay.rotation.z = side * -.35; rig.add(stay);
  }
  const halo = new THREE.Mesh(new THREE.TorusGeometry(compact ? 11.2 : 13.8, compact ? 1.25 : 1.55, 9, 38, Math.PI), carbon); halo.rotation.z = Math.PI; halo.position.set(0, compact ? 12 : 15, compact ? 4 : 3); rig.add(halo);
  const haloStem = new THREE.Mesh(new THREE.BoxGeometry(compact ? .85 : 1.05, compact ? 12 : 15, compact ? .85 : 1.05), carbon); haloStem.position.set(0, compact ? 9 : 11, compact ? -4 : -6); haloStem.rotation.x = -.15; rig.add(haloStem);
  const wheel = new THREE.Group(); wheel.position.set(0, compact ? .5 : 1, compact ? 13.5 : 16); rig.add(wheel);
  const wheelBody = new THREE.Mesh(new THREE.BoxGeometry(compact ? 9.5 : 12, compact ? 4.8 : 6, compact ? 1.8 : 2.2), carbon); wheel.add(wheelBody);
  for (const side of [-1, 1]) { const grip = new THREE.Mesh(new THREE.CylinderGeometry(compact ? 1.7 : 2.1, compact ? 1.7 : 2.1, compact ? 5.8 : 7, 12), carbon); grip.rotation.x = Math.PI / 2; grip.position.x = side * (compact ? 5.2 : 6.5); wheel.add(grip); }
  const display = new THREE.Mesh(new THREE.BoxGeometry(compact ? 6.2 : 7.6, compact ? 2.1 : 2.6, .3), new THREE.MeshBasicMaterial({ color: '#b7f578' })); display.position.z = compact ? -1 : -1.25; wheel.add(display);
  const brakeGlow = new THREE.Mesh(new THREE.BoxGeometry(compact ? 5 : 6, .4, .4), new THREE.MeshBasicMaterial({ color: '#ff4058' })); brakeGlow.position.set(-4, compact ? -4.5 : -5.3, 1); wheel.add(brakeGlow);
  const throttleGlow = new THREE.Mesh(new THREE.BoxGeometry(compact ? 5 : 6, .4, .4), new THREE.MeshBasicMaterial({ color: '#b7f578' })); throttleGlow.position.set(4, compact ? -4.5 : -5.3, 1); wheel.add(throttleGlow);
  const opponent = makeF1Car('#e96a86', '#16191b', compact ? .17 : .22); opponent.position.set(0, .5, compact ? -70 : -90); rig.add(opponent);
  const rainFlow = new THREE.Group(); rig.add(rainFlow);
  for (let i = 0; i < (compact ? 28 : 40); i++) { const drop = new THREE.Mesh(new THREE.BoxGeometry(.035, compact ? 2.6 : 3.4, .035), new THREE.MeshBasicMaterial({ color: '#9ed9ff', transparent: true, opacity: .62 })); drop.userData.baseY = 5 + (i % 8) * 4; drop.userData.baseZ = -18 - i * (compact ? 4 : 5); drop.position.set(((i * 17) % 39) - 19, drop.userData.baseY, drop.userData.baseZ); rainFlow.add(drop); }
  scene.add(new THREE.HemisphereLight('#bcd8e4', '#0c1214', 1.45), new THREE.DirectionalLight('#ffffff', 1.8));
  camera.position.set(0, compact ? 14 : 18, compact ? 27 : 31); camera.rotation.x = -.09;
  return { rig, wheel, roadFlow, kerbFlow, postFlow, rainFlow, opponent, segmentSpan, brakeGlow, throttleGlow, frontWheels: rig.children.filter(child => child.name === 'cockpit-front-wheel') };
}

function placeCarOnTrack(car, progress, y = 3) {
  const u = (progress % 1 + 1) % 1, point = trackCurve.getPointAt(u), tangent = trackCurve.getTangentAt(u);
  car.position.copy(point); car.position.y = y; car.rotation.y = Math.atan2(tangent.x, tangent.z);
}

function animateCockpit(motion, camera, frame, compact = false) {
  if (!motion || !frame) return;
  const k = frame.kinematics || {}, controls = frame.controls || {}, track = frame.track || {}, flags = frame.flags || {};
  const steer = k.steering_rad || 0, speed = k.speed_mps || 0, yaw = k.yaw_rate_radps || 0, t = frame.t || 0;
  const slip = Math.max(...Object.values(frame.wheels || {}).map(w => Math.abs(w.slip_ratio || 0)), 0);
  const vibration = Math.min(compact ? .13 : .2, speed * .0012 + slip * .24);
  motion.wheel.rotation.z = -steer * .78;
  motion.frontWheels.forEach(wheel => { wheel.rotation.x = -(track.s_m || 0) / 4.1; wheel.rotation.y = steer * .72; });
  motion.rig.rotation.z = (frame.pose?.roll_rad || 0) * .65 + Math.sin(t * 48) * vibration * .055;
  motion.rig.rotation.x = (frame.pose?.pitch_rad || 0) * .45 - (k.accel_mps2 || 0) * .006;
  motion.rig.position.x = -steer * (compact ? .55 : .8);
  camera.position.x = steer * (compact ? .3 : .45) + Math.sin(t * 37) * vibration;
  camera.position.y = (compact ? 14 : 18) + Math.abs(yaw) * 1.6 + Math.sin(t * 43) * vibration;
  if (motion.lastGear != null && motion.lastGear !== controls.gear) motion.shiftKick = compact ? .22 : .32;
  motion.lastGear = controls.gear; motion.shiftKick = (motion.shiftKick || 0) * .82;
  camera.position.z = (compact ? 27 : 31) - motion.shiftKick;
  camera.rotation.y = steer * .085; camera.rotation.z = -yaw * .045;
  const phase = (track.s_m || 0) % motion.segmentSpan;
  for (const group of [motion.roadFlow, motion.kerbFlow, motion.postFlow]) for (const item of group.children) item.position.z = ((item.userData.baseZ + phase + motion.segmentSpan) % motion.segmentSpan) - motion.segmentSpan;
  motion.brakeGlow.scale.x = .15 + (controls.brake || 0) * .85; motion.throttleGlow.scale.x = .15 + (controls.throttle || 0) * .85;
  motion.brakeGlow.visible = (controls.brake || 0) > .02; motion.throttleGlow.visible = (controls.throttle || 0) > .02;
  motion.opponent.position.z = -(32 + Math.min(160, Math.max(.08, frame.race?.gap_ahead_s || .5) * 52));
  motion.opponent.position.x = Math.sin(t * .45) * 1.2 - steer * 2;
  const rain = Math.max(frame.tires?.rain_intensity || 0, frame.race?.rain_intensity || 0); motion.rainFlow.visible = rain > .03;
  motion.rainFlow.children.forEach((drop, i) => { drop.position.y = 3 + ((drop.userData.baseY - t * (28 + speed * .12) + i * .7) % 34 + 34) % 34; drop.material.opacity = .25 + rain * .65; });
  sceneBackgroundForFlags(motion.rig.parent, flags, frame.race?.weather);
}

function sceneBackgroundForFlags(scene, flags = {}, weather = 'DRY') {
  if (!scene) return;
  scene.background = new THREE.Color(flags.red_flag ? '#351117' : flags.vsc ? '#292510' : weather === 'WET' ? '#16232b' : '#14242c');
}
function initThree() {
  const trackCanvas = $('track-canvas'), povCanvas = $('pov-canvas');
  trackRenderer = new THREE.WebGLRenderer({ canvas: trackCanvas, antialias: true, alpha: true });
  povRenderer = new THREE.WebGLRenderer({ canvas: povCanvas, antialias: true, alpha: false });
  [trackRenderer, povRenderer].forEach(r => { r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25)); r.outputColorSpace = THREE.SRGBColorSpace; });
  trackScene = new THREE.Scene(); trackScene.background = new THREE.Color('#0d1518');
  trackCamera = new THREE.OrthographicCamera(-420, 420, 300, -300, .1, 2000); trackCamera.position.set(0, 650, 0); trackCamera.up.set(0, 0, -1); trackCamera.lookAt(0, 0, 0);
  trackRoad = new THREE.Mesh(makeTrackRibbon(trackCurve, 34, 256, 0, 1, .1), new THREE.MeshBasicMaterial({ color: '#26363b', side: THREE.DoubleSide }));
  trackLine = new THREE.Mesh(makeTrackRibbon(trackCurve, 42, 256, 0, 1, 0), new THREE.MeshBasicMaterial({ color: '#829092', side: THREE.DoubleSide }));
  trackScene.add(trackLine, trackRoad, new THREE.AmbientLight('#ffffff', 1));
  trackZoneGroup = createZoneHighlights(trackScene, trackCurve);
  carMesh = makeF1Car('#e8ece7', '#c62439', .78);
  oppMesh = makeF1Car('#f479a2', '#171a1c', .72);
  trackScene.add(carMesh, oppMesh);
  povScene = new THREE.Scene(); povScene.background = new THREE.Color('#111e26');
  povCamera = new THREE.PerspectiveCamera(72, 1, .1, 2000);
  povMotion = makeCockpit(povScene, povCamera, false); povRig = povMotion.rig; wheelMesh = povMotion.wheel;
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
  const road = new THREE.Mesh(makeTrackRibbon(trackCurve, 32, 224, 0, 1, .1), new THREE.MeshBasicMaterial({ color: '#26363b', side: THREE.DoubleSide }));
  const edge = new THREE.Mesh(makeTrackRibbon(trackCurve, 40, 224, 0, 1, 0), new THREE.MeshBasicMaterial({ color: '#829092', side: THREE.DoubleSide }));
  trackScene.add(edge, road, new THREE.AmbientLight('#dce8e4', 1));
  const zoneGroup = createZoneHighlights(trackScene, trackCurve);
  const trackCar = makeF1Car('#e8ece7', '#c62439', .62);
  const trackOpp = makeF1Car('#f479a2', '#171a1c', .56);
  trackScene.add(trackCar, trackOpp);
  const povScene = new THREE.Scene(); povScene.background = new THREE.Color('#111e26');
  const povCamera = new THREE.PerspectiveCamera(69, 1, .1, 2000);
  const motion = makeCockpit(povScene, povCamera, true);
  return { canvas, renderer, trackScene, trackCamera, trackCar, trackOpp, povScene, povCamera, povRig: motion.rig, wheel: motion.wheel, motion, road, edge, zoneGroup };
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
  placeCarOnTrack(carMesh, s, 4); placeCarOnTrack(oppMesh, s + Math.min(.08, gap / 80), 4);
  const wheelSpin = -(frame.track?.s_m || 0) / 4.1;
  carMesh.userData.frontWheels?.forEach(w => { w.rotation.x = wheelSpin; w.rotation.y = (frame.kinematics?.steering_rad || 0) * .7; });
  oppMesh.userData.frontWheels?.forEach(w => { w.rotation.x = wheelSpin - gap; });
  animateCockpit(povMotion, povCamera, frame, false);
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
  placeCarOnTrack(view.trackCar, s, 4); placeCarOnTrack(view.trackOpp, s + Math.min(.08, gap / 80), 4);
  const wheelSpin = -(frame?.track?.s_m || 0) / 4.1;
  view.trackCar.userData.frontWheels?.forEach(w => { w.rotation.x = wheelSpin; w.rotation.y = (frame?.kinematics?.steering_rad || 0) * .7; });
  view.trackOpp.userData.frontWheels?.forEach(w => { w.rotation.x = wheelSpin - gap; });
  setActiveZone(view.zoneGroup, frame?.track?.zone);
  renderer.render(view.trackScene, view.trackCamera);
  renderer.setViewport(half, 0, width - half, height); renderer.setScissor(half, 0, width - half, height);
  animateCockpit(view.motion, view.povCamera, frame, true);
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
    state.playing = true; $('play').textContent = 'Ⅱ';
  }).catch(error => { setStatus('GPU ERROR', false); $('scenario-result').className = 'scenario-result failed'; $('scenario-result').textContent = 'FAILED · ' + error.message; $('sim-state').innerHTML = '<i class="live-dot"></i> SCENARIO FAILED'; }).finally(() => { state.assessmentPromise = null; $('apply-scenario').disabled = false; $('apply-scenario').textContent = 'APPLY TO GPU SIMULATOR'; });
  return state.assessmentPromise;
}
function tick(now) {
  const dt = state.lastNow ? Math.min(.1, (now - state.lastNow) / 1000) : 0; state.lastNow = now;
  if (state.playing) { const next = state.time + dt * state.rate; seek(next >= 60 ? next % 60 : next); }
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
  initThree(); limitTrackSelector(); syncControlInputs(); clearLiveState(); renderTrackInfo(); requestAnimationFrame(tick);
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
