"""GPU-only Overtiq race engineer service.

The service deliberately keeps the simulator and model tensors on CUDA.  The
browser receives compact frames and assessments; it never receives telemetry
archives or model weights.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import threading
import time
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any, Literal

import torch
from fastapi import Depends, FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field


DEVICE = torch.device("cuda:0") if torch.cuda.is_available() else None
API_KEY = os.getenv("OVERTIQ_API_KEY", "")
MODEL_PATH = os.getenv("OVERTIQ_MODEL", "/workspace/overtiq/reports/model/forecaster_2026_v1.pt")
SERVICE_VERSION = "overtiq-gpu-0.2.0"

# Simulation results are intentionally cached on the GPU service.  A browser
# refresh or a transport reconnect must not launch a second Monte Carlo job for
# the same race state.  The cache stores only compact response objects and is
# bounded so it cannot grow with every engineer session.
SIM_CACHE_TTL_S = float(os.getenv("OVERTIQ_SIM_CACHE_TTL_S", "900"))
SIM_CACHE_MAX = int(os.getenv("OVERTIQ_SIM_CACHE_MAX", "32"))
_SIM_CACHE: OrderedDict[str, tuple[float, tuple[list[dict[str, Any]], dict[str, Any]]]] = OrderedDict()
_SIM_CACHE_LOCK = threading.RLock()
_SIM_CACHE_HITS = 0
_SIM_CACHE_MISSES = 0


def require_gpu() -> torch.device:
    if DEVICE is None:
        raise RuntimeError("CUDA is required; refusing to run the simulator on CPU")
    torch.cuda.set_device(DEVICE)
    return DEVICE


def auth_value(value: str | None) -> None:
    if API_KEY and value != API_KEY:
        raise HTTPException(status_code=401, detail="invalid GPU service key")


async def authenticated(x_overtiq_key: str | None = Header(default=None)) -> None:
    auth_value(x_overtiq_key)


class SimulationRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    session_key: str = "2026_11361"
    driver_number: int = 31
    driver_code: str = "OCO"
    lap: int = Field(default=35, ge=1)
    position: int = Field(default=14, ge=1)
    gap_ahead_s: float = Field(default=0.558, ge=0)
    speed_mps: float = Field(default=78.9, ge=0)
    decision: Literal["ATTACK", "DEFEND", "CONSERVE", "RECOVER"] = "ATTACK"
    horizon_s: float = Field(default=60.0, gt=0, le=600)
    dt: float = Field(default=0.25, gt=0, le=1)
    n_scenarios: int = Field(default=256, ge=16, le=2048)
    seed: int = 31
    track_length_m: float = Field(default=5278.0, gt=1000)
    tire_compound: str = "MEDIUM"
    tire_age_laps: float = 18.0
    fuel_kg: float = 42.0
    ers_fraction: float = Field(default=0.62, ge=0, le=1)
    weather: str = "DRY"
    rain_intensity: float = Field(default=0.0, ge=0, le=1)
    vsc: bool = False
    red_flag: bool = False
    safety_car: bool = False
    target_driver: str | None = None


class CompareRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    request: SimulationRequest = SimulationRequest()
    decisions: list[Literal["ATTACK", "DEFEND", "CONSERVE", "RECOVER"]] = ["ATTACK", "DEFEND", "CONSERVE"]


class AssessmentRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    request: SimulationRequest = SimulationRequest()
    include_frames: bool = False


class RaceAssessmentRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    request: SimulationRequest = SimulationRequest()
    drivers: list[dict[str, Any]] | None = None


class Forecaster(torch.nn.Module):
    def __init__(self, n_features: int = 26, hidden: int = 256):
        super().__init__()
        self.gru = torch.nn.GRU(n_features, hidden, num_layers=2, batch_first=True)
        self.head = torch.nn.Sequential(torch.nn.Linear(hidden, 192), torch.nn.GELU(), torch.nn.Linear(192, 5))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out, _ = self.gru(x)
        return self.head(out[:, -1])


class GPUForecaster:
    def __init__(self) -> None:
        self.model: Forecaster | None = None
        self.features: list[str] = []
        self.mu: torch.Tensor | None = None
        self.sd: torch.Tensor | None = None
        self.version = "unavailable"
        if DEVICE is None or not os.path.exists(MODEL_PATH):
            return
        try:
            device = require_gpu()
            checkpoint = torch.load(MODEL_PATH, map_location=device, weights_only=False)
            state = checkpoint.get("state_dict", checkpoint.get("state"))
            self.model = Forecaster(len(checkpoint.get("feats", [])) or 26, int(checkpoint.get("hidden", 256))).to(device)
            self.model.load_state_dict(state)
            self.model.eval()
            self.features = list(checkpoint.get("feats", []))
            self.mu = torch.as_tensor(checkpoint.get("mu", [0.0] * len(self.features)), device=device, dtype=torch.float32)
            self.sd = torch.as_tensor(checkpoint.get("sd", [1.0] * len(self.features)), device=device, dtype=torch.float32).clamp_min(1e-6)
            self.version = os.path.basename(MODEL_PATH)
        except Exception:
            self.model = None

    @torch.inference_mode()
    def predict(self, speed: float, curvature: torch.Tensor, throttle: float, brake: float) -> list[float]:
        if self.model is None or self.mu is None or self.sd is None or DEVICE is None:
            return []
        # Construct a short device-resident feature history.  This is the same
        # 26-feature contract as the validated v1 forecaster; the live physics
        # state supplies the changing features.
        t = torch.arange(12, device=DEVICE, dtype=torch.float32)
        v = torch.full((12,), float(speed), device=DEVICE) + (t - 11) * float(throttle - brake) * 0.8
        c = curvature.reshape(-1)[0].expand(12)
        row = torch.zeros((12, 26), device=DEVICE, dtype=torch.float32)
        row[:, 0] = v
        row[:, 1] = throttle - brake
        row[:, 2] = throttle
        row[:, 3] = brake
        row[:, 4] = 6.0
        row[:, 5] = 9000.0
        row[:, 6] = 0.0
        row[:, 7] = 0.0
        row[:, 8] = c
        row[:, 9] = 0.0
        row[:, 10] = c.abs()
        row[:, 11:16] = c[:, None]
        row[:, 16:18] = 0.0
        row[:, 18:22] = c[:, None]
        row[:, 22] = 1.5
        row[:, 23] = c.abs()
        row[:, 24] = 65.0
        row[:, 25] = 65.0
        x = (row - self.mu) / self.sd
        delta = self.model(x.unsqueeze(0)).squeeze(0)
        return (float(speed) + delta).detach().cpu().tolist()


FORECASTER = GPUForecaster()


def _conditions(req: SimulationRequest) -> dict[str, float | str]:
    """Resolve weather and tyre grip once on the request boundary.

    The scalar coefficients are intentionally explicit so a race engineer can
    see why a scenario moved. They are consumed by CUDA tensors in the loop.
    """
    weather = str(req.weather or "DRY").upper()
    rain = float(req.rain_intensity)
    if weather == "INTERMEDIATE":
        water = max(rain, 0.38)
    elif weather == "WET":
        water = max(rain, 0.82)
    else:
        water = rain
    compound = str(req.tire_compound or "MEDIUM").upper()
    preferred = {"SOFT": 0.0, "MEDIUM": 0.04, "HARD": 0.08, "INTERMEDIATE": 0.48, "WET": 0.82}.get(compound, 0.04)
    mismatch = abs(water - preferred)
    # Slicks aquaplane in water; rain tyres lose some performance on a dry line.
    grip = max(0.34, 1.0 - mismatch * (1.35 if water > 0.18 else 0.72))
    if compound in {"INTERMEDIATE", "WET"} and water < 0.18:
        grip *= 0.82
    if compound == "WET" and water < 0.55:
        grip *= 0.88
    return {"weather": weather, "rain": water, "grip": max(0.25, min(1.0, grip))}


def _track(s: torch.Tensor, length: float) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    """Reference-inspired closed circuit centerline, entirely on the GPU."""
    u = (s / length) * (2.0 * math.pi)
    x = 410.0 + 300.0 * torch.cos(u) + 78.0 * torch.cos(2.0 * u + 0.45)
    y = 290.0 + 190.0 * torch.sin(u) + 52.0 * torch.sin(3.0 * u)
    heading = torch.atan2(torch.roll(y, -1) - y, torch.roll(x, -1) - x)
    curvature = 0.0006 + 0.0042 * torch.sin(2.0 * u + 0.5).abs() + 0.0024 * torch.sin(5.0 * u).abs()
    return x, y, heading, curvature


def _zone(s: float, length: float) -> tuple[str, int, str]:
    pct = (s % length) / length
    zones = [(0.02, "T1", 1, "Braking") , (0.18, "T3", 1, "Overtake"), (0.35, "T6", 2, "Braking"),
             (0.52, "T9", 2, "Overtake"), (0.68, "T11", 3, "Overtake"), (0.84, "T13", 3, "Braking")]
    best = min(zones, key=lambda z: abs(pct - z[0]))
    return best[1], best[2], best[3]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _frame(t: float, s: torch.Tensor, v: torch.Tensor, gap: torch.Tensor, battery: torch.Tensor, fuel: torch.Tensor,
           req: SimulationRequest, index: int) -> dict[str, Any]:
    # One frame is serialized after the GPU has finished its vectorized update.
    conditions = _conditions(req)
    s0 = float(s.item()); v0 = float(v.item()); g0 = float(gap.item())
    track_s = torch.linspace(s0, s0 + 0.01, 2, device=DEVICE)
    x, y, heading, curv = _track(track_s, req.track_length_m)
    zone, sector, zone_type = _zone(s0, req.track_length_m)
    steer = float(torch.tanh(curv[0] * 120.0).item())
    speed_kmh = v0 * 3.6
    lap = req.lap + int(s0 // req.track_length_m)
    return {
        "schema": "OVERTIQ.PhysicsFrame.v1",
        "t": round(t, 3), "track": {"session_key": req.session_key, "s_m": round(s0, 3), "length_m": req.track_length_m,
        "x_m": round(float(x[0].item()), 3), "y_m": round(float(y[0].item()), 3), "heading_rad": round(float(heading[0].item()), 5),
        "curvature_1_m": round(float(curv[0].item()), 6), "sector": sector, "zone": zone, "zone_type": zone_type},
        "pose": {"x_m": round(float(x[0].item()), 3), "y_m": round(float(y[0].item()), 3), "z_m": 0.0,
                 "yaw_rad": round(float(heading[0].item()), 5), "pitch_rad": round(float((v0 - 70.0) * 0.001), 5),
                 "roll_rad": round(float(steer * 0.035), 5)},
        "kinematics": {"speed_mps": round(v0, 4), "speed_kph": round(speed_kmh, 2), "accel_mps2": round((v0 - req.speed_mps) * 0.08, 4),
                       "yaw_rate_radps": round(steer * 0.12, 5), "steering_rad": round(steer, 5)},
        "controls": {"throttle": round(float((0.88 if req.decision == "ATTACK" else 0.72) * (1.0 - curv[0].item() * 16.0)), 4),
                     "brake": round(float(max(0.0, curv[0].item() * 18.0 - 0.04)), 4), "gear": int(max(3, min(8, round(speed_kmh / 42)))), "drs": bool(zone_type == "Overtake" and g0 < 1.0)},
        "wheels": {"fl": {"slip_ratio": round(abs(steer) * 0.04, 4), "load_n": 1820.0}, "fr": {"slip_ratio": round(abs(steer) * 0.04, 4), "load_n": 1800.0},
                   "rl": {"slip_ratio": 0.012, "load_n": 1700.0}, "rr": {"slip_ratio": 0.012, "load_n": 1690.0}},
        "tires": {"compound": req.tire_compound, "age_laps": round(req.tire_age_laps + t / 92.0, 2), "surface_temp_c": round(89.0 + abs(steer) * 8.0, 2), "wear": round(min(1.0, 0.34 + t / 700.0), 4), "grip_factor": round(float(conditions["grip"]), 3), "rain_intensity": round(float(conditions["rain"]), 3)},
        "forces": {"aero_downforce_n": round(2600.0 + v0 * v0 * 0.08, 2), "drag_n": round(v0 * v0 * 0.55, 2), "longitudinal_n": round((v0 - req.speed_mps) * 190.0, 2)},
        "energy": {"ers_fraction": round(float(battery.item()), 4), "fuel_kg": round(float(fuel.item()), 3), "fuel_lap_delta_kg": -1.72},
        "flags": {"safety_car": req.safety_car, "vsc": bool(req.vsc or req.safety_car), "red_flag": req.red_flag, "track_limits_warning": bool(abs(steer) > 0.8), "data_quality": "simulated_gpu"},
        "race": {"driver_number": req.driver_number, "driver_code": req.driver_code, "lap": lap, "position": req.position, "gap_ahead_s": round(g0, 4), "decision": req.decision, "weather": conditions["weather"], "rain_intensity": round(float(conditions["rain"]), 3)},
    }


@torch.inference_mode()
def _simulate_gpu_uncached(req: SimulationRequest, include_frames: bool = True) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    device = require_gpu()
    torch.manual_seed(req.seed)
    conditions = _conditions(req)
    grip = float(conditions["grip"])
    rain = float(conditions["rain"])
    dt = float(req.dt)
    # The state update and all scenario branches remain on CUDA.
    n = 1 if include_frames else min(req.n_scenarios, 1024)
    # A durable-pass answer needs to observe three laps after the pass. We
    # still return only the requested replay horizon as frames, but run the
    # hidden continuation on CUDA so durability is based on simulated state.
    sim_horizon_s = max(float(req.horizon_s), 92.0 * 3.0 + 5.0)
    loop_dt = dt if include_frames else max(dt, 0.5)
    steps = max(1, min(int(sim_horizon_s / loop_dt), 2400))
    speed = torch.full((n,), float(req.speed_mps), device=device)
    s = torch.zeros((n,), device=device)
    gap = torch.full((n,), float(req.gap_ahead_s), device=device)
    battery = torch.full((n,), float(req.ers_fraction), device=device)
    fuel = torch.full((n,), float(req.fuel_kg), device=device)
    opp_speed = torch.full((n,), float(req.speed_mps - 0.3), device=device)
    pass_event = torch.zeros((n,), dtype=torch.bool, device=device)
    pass_time = torch.full((n,), float("inf"), device=device)
    durable = torch.zeros((n,), dtype=torch.bool, device=device)
    frames: list[dict[str, Any]] = []
    action_bias = {"ATTACK": 0.34, "DEFEND": -0.16, "CONSERVE": -0.32, "RECOVER": -0.48}[req.decision]
    # Fuel mass and ERS deployment are scenario inputs, so they alter the
    # vehicle state instead of being display-only controls.
    mass_factor = max(0.82, min(1.0, 1.0 - (float(req.fuel_kg) - 42.0) * 0.002))
    pace_factor = max(0.58, min(1.0, 0.78 + 0.22 * grip))
    speed_cap = 94.0 * pace_factor
    opp_speed_cap = 92.0 * pace_factor
    start = torch.cuda.Event(enable_timing=True); end = torch.cuda.Event(enable_timing=True)
    start.record()
    for i in range(steps):
        t = i * loop_dt
        phase = (s / req.track_length_m) * (2.0 * math.pi)
        curvature = 0.0006 + 0.0042 * torch.sin(2.0 * phase + 0.5).abs() + 0.0024 * torch.sin(5.0 * phase).abs()
        noise = torch.randn((n,), device=device) * 0.065
        throttle = torch.clamp((0.84 + action_bias - curvature * 17.0 + noise * 0.1) * (0.78 + 0.22 * grip), 0.08, 1.0)
        brake = torch.clamp(curvature * 15.0 - 0.02, 0.0, 0.9)
        drag = 0.0019 * speed * speed
        accel = (4.0 * throttle - 7.8 * brake - drag + noise) * mass_factor + 0.75 * battery
        if req.vsc or req.safety_car:
            accel = torch.minimum(accel, torch.full_like(accel, 0.75))
        if req.red_flag:
            # A red flag freezes racing and brings both cars to pit-lane pace.
            accel = -speed * 0.75
        speed = torch.clamp(speed + accel * loop_dt, 0.0 if req.red_flag else 34.0, min(speed_cap, 55.0) if (req.vsc or req.safety_car) else speed_cap)
        opp_accel = (3.55 - 0.0019 * opp_speed * opp_speed) * mass_factor
        if req.red_flag:
            opp_accel = -opp_speed * 0.75
        opp_speed = torch.clamp(opp_speed + opp_accel * loop_dt, 0.0 if req.red_flag else 34.0, min(opp_speed_cap, 53.0) if (req.vsc or req.safety_car) else opp_speed_cap)
        closing = (speed - opp_speed) * loop_dt * 0.065
        gap = torch.clamp(gap - closing - action_bias * loop_dt * 0.012 + torch.randn((n,), device=device) * 0.004, 0.04, 12.0)
        s = s + speed * loop_dt
        battery = torch.clamp(battery - (0.0005 + throttle * 0.0007) * loop_dt + (brake * 0.0004) * loop_dt, 0.05, 1.0)
        fuel = torch.clamp(fuel - (0.00037 * speed + throttle * 0.012) * loop_dt * (0.12 if req.red_flag else 1.0), 0.0, 110.0)
        p_pass = torch.sigmoid(2.2 - 1.45 * gap + 0.022 * (speed - opp_speed) + action_bias * 2.4 - curvature * 85.0) * (loop_dt / 60.0) * grip * (1.0 - rain * 0.35)
        if req.vsc or req.safety_car:
            p_pass = p_pass * 0.05
        if req.red_flag:
            p_pass = torch.zeros_like(p_pass)
        fresh_pass = (~pass_event) & (torch.rand((n,), device=device) < p_pass)
        pass_event |= fresh_pass
        pass_time = torch.where(fresh_pass, torch.full_like(pass_time, t), pass_time)
        if t >= 92.0 * 3.0:
            durable |= pass_event & (gap < 1.8)
        if include_frames and t <= req.horizon_s and (i % max(1, int(0.25 / loop_dt)) == 0):
            frames.append(_frame(t, s[0], speed[0], gap[0], battery[0], fuel[0], req, i))
    end.record(); end.synchronize()
    gpu_ms = float(start.elapsed_time(end))
    three_lap_s = 92.0 * 3.0
    within_3 = pass_event & (pass_time <= three_lap_s)
    within_60 = pass_event & (pass_time <= 60.0)
    durable = durable & within_60
    gain = torch.where(within_3, torch.ones_like(s), torch.zeros_like(s))
    finish = torch.clamp(torch.as_tensor(float(req.position), device=device) - gain - durable.float() * 0.35 + torch.randn((n,), device=device) * 0.7, 1, 20)
    probs = {"gain3": float(within_3.float().mean().item()), "pass60": float(within_60.float().mean().item()), "durable": float(durable.float().mean().item())}
    quantiles = torch.quantile(finish, torch.as_tensor([0.1, 0.25, 0.5, 0.75, 0.9], device=device)).detach().cpu().tolist()
    return frames, {"probs": probs, "finish": {"expected": float(finish.mean().item()), "quantiles": quantiles}, "gpu_ms": gpu_ms, "scenarios": n,
                    "final_speed_mps": float(speed.mean().item()), "final_gap_s": float(gap.mean().item()), "final_ers": float(battery.mean().item()),
                    "final_fuel_kg": float(fuel.mean().item()), "conditions": {"weather": conditions["weather"], "rain_intensity": rain, "grip_factor": grip, "vsc": bool(req.vsc or req.safety_car), "red_flag": req.red_flag}}


def _simulation_cache_key(req: SimulationRequest, include_frames: bool) -> str:
    payload = {"include_frames": include_frames, "request": req.model_dump(mode="json")}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def simulate_gpu(req: SimulationRequest, include_frames: bool = True) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Run or reuse one deterministic remote GPU simulation.

    This wrapper is synchronous because the regular FastAPI routes are sync
    handlers.  The lock also protects torch.manual_seed and CUDA allocator
    state when an async stream offloads work to a worker thread.  It is held
    through a cache miss so two simultaneous refreshes collapse into one CUDA
    job instead of doubling the load on the 3060.
    """
    global _SIM_CACHE_HITS, _SIM_CACHE_MISSES
    key = _simulation_cache_key(req, include_frames)
    now = time.monotonic()
    with _SIM_CACHE_LOCK:
        cached = _SIM_CACHE.get(key)
        if cached is not None:
            created, result = cached
            if now - created <= SIM_CACHE_TTL_S:
                _SIM_CACHE.move_to_end(key)
                _SIM_CACHE_HITS += 1
                return result
            _SIM_CACHE.pop(key, None)

        _SIM_CACHE_MISSES += 1
        result = _simulate_gpu_uncached(req, include_frames=include_frames)
        _SIM_CACHE[key] = (time.monotonic(), result)
        _SIM_CACHE.move_to_end(key)
        while len(_SIM_CACHE) > max(1, SIM_CACHE_MAX):
            _SIM_CACHE.popitem(last=False)
        return result


async def _stream_frames(req: SimulationRequest) -> list[dict[str, Any]]:
    """Obtain a frame window without blocking Uvicorn's event loop."""
    frames, _ = await asyncio.to_thread(simulate_gpu, req, True)
    return frames


def evidence(req: SimulationRequest, stats: dict[str, Any], label: str) -> dict[str, Any]:
    zone, sector, zone_type = _zone(req.gap_ahead_s * 130.0, req.track_length_m)
    return {"label": label, "lap": req.lap, "sector": sector, "zone": zone, "zone_type": zone_type, "gap_s": round(req.gap_ahead_s, 3),
            "speed_kph": round(req.speed_mps * 3.6, 1), "tire": req.tire_compound, "tire_age_laps": req.tire_age_laps,
            "ers_fraction": req.ers_fraction, "fuel_kg": req.fuel_kg, "weather": req.weather, "rain_intensity": req.rain_intensity,
            "vsc": bool(req.vsc or req.safety_car), "red_flag": req.red_flag, "simulator": "GPU deterministic + Monte Carlo", "uncertainty": "scenario spread"}


def assess(req: SimulationRequest, include_frames: bool = False) -> dict[str, Any]:
    frames, stats = simulate_gpu(req, include_frames=include_frames)
    p = stats["probs"]
    recommendation = "ATTACK" if p["pass60"] >= 0.55 else "DEFEND" if p["pass60"] <= 0.22 and req.gap_ahead_s < 1.0 else "HOLD"
    if req.red_flag:
        recommendation = "HOLD"
    elif req.vsc or req.safety_car:
        recommendation = "CONSERVE"
    if req.decision == "RECOVER": recommendation = "RECOVER"
    if req.decision == "CONSERVE": recommendation = "CONSERVE"
    conf = max(0.51, min(0.98, 0.55 + abs(p["pass60"] - 0.5) * 0.8))
    forecast = FORECASTER.predict(req.speed_mps, torch.as_tensor([0.003], device=DEVICE), 0.86, 0.0) if DEVICE is not None else []
    return {"schema": "EngineerAssessment.v1", "timestamp": _now(), "driver": {"number": req.driver_number, "code": req.driver_code, "position": req.position},
            "decision": req.decision, "answers": {"can_gain_position_within_3_laps": {"probability": p["gain3"], "confidence": conf, "cutoff_lap": req.lap + 3, "evidence": evidence(req, stats, "3-lap position gain")},
                       "can_pass_within_60s": {"probability": p["pass60"], "confidence": conf, "window_s": 60, "evidence": evidence(req, stats, "60-second pass")},
                       "durable_pass": {"probability": p["durable"], "confidence": conf, "laps_ahead": 3, "evidence": evidence(req, stats, "durable pass")},
                       "finish_position": {"expected": stats["finish"]["expected"], "distribution": stats["finish"]["quantiles"], "quantiles": [0.1, 0.25, 0.5, 0.75, 0.9], "evidence": evidence(req, stats, "race finish")}},
            "recommendation": {"action": recommendation, "confidence": conf, "rationale": f"{p['pass60']:.0%} modeled pass chance in the active zone; {p['durable']:.0%} remains ahead three laps later." if not req.red_flag else "Red flag active: racing is neutralized and the model holds position.", "override_allowed": True},
            "model": {"decision_baseline": "v4-logistic", "forecaster": FORECASTER.version, "forecaster_output": {"horizons_s": [1, 2, 3, 4, 5], "predicted_speed_mps": forecast}, "simulator": SERVICE_VERSION, "device": torch.cuda.get_device_name(0), "gpu_ms": stats["gpu_ms"], "scenarios": stats["scenarios"]},
            "state": {"gap_ahead_s": req.gap_ahead_s, "speed_kph": req.speed_mps * 3.6, "ers_fraction": req.ers_fraction, "fuel_kg": req.fuel_kg, "weather": req.weather, "rain_intensity": req.rain_intensity, "tire_compound": req.tire_compound, "vsc": bool(req.vsc or req.safety_car), "red_flag": req.red_flag, "conditions": stats.get("conditions"), "data_quality": "simulated_gpu"},
            "frames": frames if include_frames else None}


def zone_rows_from_assessment(base: dict[str, Any]) -> list[dict[str, Any]]:
    """Build the compact zone table from one shared GPU assessment.

    The browser gets every zone in the bootstrap response without firing one
    Monte Carlo request per row. Detailed frames remain available through the
    replay route when a row is selected later.
    """
    names = [("T1", 1, "Braking"), ("T3", 1, "Overtake"), ("T6", 2, "Braking"),
             ("T9", 2, "Overtake"), ("T11", 3, "Overtake"), ("T13", 3, "Braking")]
    rows = []
    for i, (name, sector, kind) in enumerate(names):
        answers = {}
        for key, value in base["answers"].items():
            if not isinstance(value, dict):
                answers[key] = value
                continue
            item = dict(value)
            if "probability" in item:
                factor = 1.0 + (0.06 if kind == "Overtake" else -0.035) - i * 0.008
                item["probability"] = max(0.0, min(1.0, item["probability"] * factor))
            item["evidence"] = dict(item.get("evidence") or {})
            item["evidence"].update({"zone": name, "sector": sector, "zone_type": kind})
            answers[key] = item
        rows.append({"zone": name, "sector": sector, "type": kind, "assessment": answers,
                     "recommendation": dict(base["recommendation"])})
    return rows


app = FastAPI(title="Overtiq GPU Race Engineer API", version=SERVICE_VERSION)
app.add_middleware(CORSMiddleware, allow_origins=[x.strip() for x in os.getenv("OVERTIQ_ORIGINS", "*").split(",")], allow_credentials=False, allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health() -> dict[str, Any]:
    if DEVICE is None:
        return {"status": "degraded", "gpu": {"available": False}, "service": SERVICE_VERSION}
    with _SIM_CACHE_LOCK:
        cache = {"entries": len(_SIM_CACHE), "hits": _SIM_CACHE_HITS, "misses": _SIM_CACHE_MISSES,
                 "ttl_s": SIM_CACHE_TTL_S, "max_entries": SIM_CACHE_MAX}
    return {"status": "ok", "gpu": {"available": True, "device": torch.cuda.get_device_name(0), "memory_allocated_mb": round(torch.cuda.memory_allocated(0) / 1e6, 1), "memory_reserved_mb": round(torch.cuda.memory_reserved(0) / 1e6, 1)}, "model": FORECASTER.version, "simulation_cache": cache, "service": SERVICE_VERSION}


@app.get("/physics/schema", dependencies=[Depends(authenticated)])
def physics_schema() -> dict[str, Any]:
    return {"schema": "OVERTIQ.PhysicsFrame.v1", "units": {"s_m": "m", "speed_mps": "m/s", "heading_rad": "rad", "gap_ahead_s": "s", "rain_intensity": "0..1", "ers_fraction": "0..1", "fuel_kg": "kg"}, "controls": ["weather", "tire_compound", "rain_intensity", "ers_fraction", "fuel_kg", "vsc", "red_flag"], "gpu_required": True}


@app.post("/physics/simulate", dependencies=[Depends(authenticated)])
def physics_simulate(req: SimulationRequest) -> dict[str, Any]:
    frames, stats = simulate_gpu(req, include_frames=True)
    return {"schema": "SimulationResult.v1", "request": req.model_dump(), "frames": frames, "outcome": stats, "device": torch.cuda.get_device_name(0)}


@app.post("/physics/compare", dependencies=[Depends(authenticated)])
def physics_compare(body: CompareRequest) -> dict[str, Any]:
    result = []
    for action in body.decisions:
        req = body.request.model_copy(update={"decision": action})
        _, stats = simulate_gpu(req, include_frames=False)
        result.append({"decision": action, "outcome": stats})
    return {"schema": "ScenarioComparison.v1", "results": result, "device": torch.cuda.get_device_name(0)}


@app.get("/engineer/schema", dependencies=[Depends(authenticated)])
def engineer_schema() -> dict[str, Any]:
    return {"schema": "EngineerAssessment.v1", "answers": ["can_gain_position_within_3_laps", "can_pass_within_60s", "durable_pass", "finish_position"], "recommendations": ["HOLD", "ATTACK", "DEFEND", "CONSERVE", "RECOVER"], "scenario_controls": ["weather", "tire_compound", "rain_intensity", "ers_fraction", "fuel_kg", "vsc", "red_flag"], "gpu_required": True}


@app.post("/engineer/assess", dependencies=[Depends(authenticated)])
def engineer_assess(body: AssessmentRequest) -> dict[str, Any]:
    return assess(body.request, include_frames=body.include_frames)


@app.post("/engineer/bootstrap", dependencies=[Depends(authenticated)])
def engineer_bootstrap(body: AssessmentRequest) -> dict[str, Any]:
    """Single-request initial payload for the terminal.

    This prevents page load fan-out: one GPU assessment, one frame window, and
    the compact zone table arrive together. The browser caches this payload
    for the session and does not poll on a timer.
    """
    request = body.request
    assessment = assess(request, include_frames=False)
    frames, _ = simulate_gpu(request, include_frames=True)
    return {"schema": "EngineerBootstrap.v1", "gpu": {"available": True, "device": torch.cuda.get_device_name(0),
            "model": FORECASTER.version}, "assessment": assessment, "frames": frames,
            "zones": zone_rows_from_assessment(assessment), "request_count": 1}


@app.post("/engineer/race-assessment", dependencies=[Depends(authenticated)])
def engineer_race_assess(body: RaceAssessmentRequest) -> dict[str, Any]:
    drivers = body.drivers or [{"driver_number": 31, "driver_code": "OCO", "position": 14, "gap_ahead_s": body.request.gap_ahead_s}, {"driver_number": 87, "driver_code": "BEA", "position": 15, "gap_ahead_s": 0.91}]
    assessments = []
    for d in drivers:
        req = body.request.model_copy(update={k: v for k, v in d.items() if k in SimulationRequest.model_fields})
        assessments.append(assess(req, include_frames=False))
    return {"schema": "RaceEngineerAssessment.v1", "timestamp": _now(), "drivers": assessments, "device": torch.cuda.get_device_name(0)}


def replay_request(replay_id: str) -> SimulationRequest:
    digest = int(hashlib.sha256(replay_id.encode()).hexdigest()[:8], 16)
    return SimulationRequest(session_key=replay_id, seed=digest % 100000, lap=35, gap_ahead_s=0.558, speed_mps=78.9, decision="ATTACK")


@app.get("/replays/{replay_id}/frames", dependencies=[Depends(authenticated)])
def replay_frames(replay_id: str, offset: float = Query(default=0.0, ge=0), limit: int = Query(default=240, ge=1, le=480)) -> dict[str, Any]:
    req = replay_request(replay_id).model_copy(update={"horizon_s": min(120.0, max(1.0, offset + limit * 0.25))})
    frames, _ = simulate_gpu(req, include_frames=True)
    start = min(len(frames), int(offset / req.dt))
    return {"schema": "ReplayFrames.v1", "replay_id": replay_id, "frames": frames[start:start + limit], "device": torch.cuda.get_device_name(0)}


@app.get("/replays/{replay_id}/zones", dependencies=[Depends(authenticated)])
def replay_zones(replay_id: str) -> dict[str, Any]:
    req = replay_request(replay_id)
    zones = zone_rows_from_assessment(assess(req, include_frames=False))
    return {"schema": "ReplayZones.v1", "replay_id": replay_id, "zones": zones}


@app.websocket("/streams/{replay_id}")
async def stream(websocket: WebSocket, replay_id: str, key: str | None = None, weather: str | None = None,
                 tire_compound: str | None = None, rain_intensity: float | None = None,
                 ers_fraction: float | None = None, fuel_kg: float | None = None,
                 vsc: bool | None = None, red_flag: bool | None = None, decision: str | None = None) -> None:
    if API_KEY and websocket.headers.get("x-overtiq-key") != API_KEY and key != API_KEY:
        await websocket.close(code=4401); return
    await websocket.accept()
    updates: dict[str, Any] = {"horizon_s": 60.0, "dt": 0.25}
    if weather is not None: updates["weather"] = weather.upper()
    if tire_compound is not None: updates["tire_compound"] = tire_compound.upper()
    if rain_intensity is not None: updates["rain_intensity"] = max(0.0, min(1.0, rain_intensity))
    if ers_fraction is not None: updates["ers_fraction"] = max(0.0, min(1.0, ers_fraction))
    if fuel_kg is not None: updates["fuel_kg"] = max(0.0, min(110.0, fuel_kg))
    if vsc is not None: updates["vsc"] = vsc
    if red_flag is not None: updates["red_flag"] = red_flag
    if decision in {"ATTACK", "DEFEND", "CONSERVE", "RECOVER"}: updates["decision"] = decision
    req = replay_request(replay_id).model_copy(update=updates)
    try:
        frames = await _stream_frames(req)
        # Compute one device-resident scenario for this connection, then keep
        # the live view alive by replaying the frame window. This avoids a
        # second GPU request every time the one-minute window ends.
        while True:
            for frame in frames:
                await websocket.send_json(frame)
                await asyncio.sleep(0.05)
    except WebSocketDisconnect:
        return


@app.get("/streams/{replay_id}/events")
async def stream_events(replay_id: str, key: str | None = None, weather: str | None = None,
                        tire_compound: str | None = None, rain_intensity: float | None = None,
                        ers_fraction: float | None = None, fuel_kg: float | None = None,
                        vsc: bool | None = None, red_flag: bool | None = None,
                        decision: str | None = None) -> StreamingResponse:
    """Long-lived newline-delimited frame stream for browser/proxy compatibility.

    A single GPU scenario is computed when the stream opens, then the compact
    frame window is replayed indefinitely. The browser can consume this with
    fetch() without a WebSocket upgrade, which is more reliable through local
    proxies and browser privacy layers.
    """
    auth_value(key)
    updates: dict[str, Any] = {"horizon_s": 60.0, "dt": 0.25}
    if weather is not None: updates["weather"] = weather.upper()
    if tire_compound is not None: updates["tire_compound"] = tire_compound.upper()
    if rain_intensity is not None: updates["rain_intensity"] = max(0.0, min(1.0, rain_intensity))
    if ers_fraction is not None: updates["ers_fraction"] = max(0.0, min(1.0, ers_fraction))
    if fuel_kg is not None: updates["fuel_kg"] = max(0.0, min(110.0, fuel_kg))
    if vsc is not None: updates["vsc"] = vsc
    if red_flag is not None: updates["red_flag"] = red_flag
    if decision in {"ATTACK", "DEFEND", "CONSERVE", "RECOVER"}: updates["decision"] = decision
    req = replay_request(replay_id).model_copy(update=updates)

    async def events():
        # Flush a transport heartbeat immediately so the browser can mark the
        # link alive while the first CUDA scenario is being compiled.
        yield "\n"
        try:
            frames = await _stream_frames(req)
            while True:
                for frame in frames:
                    yield json.dumps(frame, separators=(",", ":")) + "\n"
                    await asyncio.sleep(0.05)
        except asyncio.CancelledError:
            return

    return StreamingResponse(events(), media_type="application/x-ndjson", headers={
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "X-Accel-Buffering": "no",
    })


if __name__ == "__main__":
    require_gpu()
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("OVERTIQ_PORT", "10200")), log_level="info")
