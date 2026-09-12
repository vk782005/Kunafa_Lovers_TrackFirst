# TrackFirst · Overtiq race engineer terminal

The Site in `dist/` is a static React-style terminal shell (served as a browser module) with a Three.js circuit map and a true single-seater cockpit POV. It renders the remote Overtiq physics stream and exposes four engineer answers per decision point. The terminal includes track metadata and selectable geometry for eight circuits (Albert Park, Sakhir, Suzuka, Monza, Silverstone, Monaco, Spa-Francorchamps, and Marina Bay), with each circuit’s braking and overtaking windows highlighted directly on the map and listed with engineer notes.

- position gain within three laps
- pass within 60 seconds
- durable pass, still ahead three laps later
- expected finish position plus distribution

All heavy work is remote. The browser performs presentation rendering, camera interpolation, and transport only. Telemetry feature construction, the speed forecaster, the CUDA physics update, opponent response, and Monte Carlo scenarios run in `backend/overtiq_api.py` on the Vast RTX 3060.

## GPU service

The service is installed at `/workspace/overtiq/services/overtiq_api.py` and managed by supervisor as `overtiq_gpu`. It fails closed when CUDA is unavailable, loads `reports/model/forecaster_2026_v1.pt` directly onto CUDA, and binds to the reserved remote service port.

Routes:

- `GET /health`
- `GET /physics/schema`
- `POST /physics/simulate`
- `POST /physics/compare`
- `GET /engineer/schema`
- `POST /engineer/assess`
- `POST /engineer/bootstrap` (one request returns the initial assessment, frames, and zones)
- `POST /engineer/race-assessment`
- `GET /replays/{replay_id}/frames`
- `GET /replays/{replay_id}/zones`
- `GET /tracks` (track catalog, lap counts, lengths, and stable IDs)
- `WS /streams/{replay_id}`

POST and WebSocket requests use the remote `x-overtiq-key`. The terminal auto-connects, sends one cached bootstrap request, and opens one live stream. Scenario controls (weather, rain, compound, ERS, fuel, VSC, and red flag) are forwarded to CUDA; the before/after panel shows how the four engineer outputs move. The browser receives compact frames only and never receives model weights or raw telemetry.

The decision baseline is the calibrated `v4-logistic` model. The GPU forecaster artifact (`forecaster_2026_v1.pt`) consumes 26 telemetry features and returns 1–5 second speed forecasts. The CUDA simulator uses those inputs with vehicle state, grip, energy, fuel, opponent response, and Monte Carlo branches to return probabilities, finish-position quantiles, evidence, and a recommendation.

The accuracy and value scorecard is documented in [docs/model-evaluation.md](docs/model-evaluation.md). It defines grouped time-forward splits, pass and durable-pass labels, calibration and ranking metrics, physics fidelity checks, promotion gates, and the retrospective, shadow-mode, and prospective tests needed to prove race value.

The current workflow is localhost-only. The browser talks to `http://127.0.0.1:10200`, which is an SSH forward to the GPU service; no Site deployment or public tunnel is required.

## Local preview

Serve the static directory with any HTTP server (module imports require HTTP):

```powershell
python -m http.server 4173 --directory dist
```

Open `http://localhost:4173`. The terminal auto-connects to the remote GPU service and shows an explicit unavailable state when the link is down; it does not fabricate replay frames.

For the localhost workflow, forward the GPU API over SSH and keep the terminal on loopback:

```powershell
ssh -i "C:\Users\Windows 10\.ssh\id_ed25519_vast" -p 41103 -L 10200:127.0.0.1:10200 root@122.59.250.166
```

The local build uses `http://127.0.0.1:10200` automatically and does not load synthetic demo values while connecting.
