# TrackFirst · Overtiq race engineer terminal

The Site in `dist/` is a static React-style terminal shell (served as a browser module) with a Three.js circuit map and a true single-seater cockpit POV. It renders the remote Overtiq physics stream and exposes four engineer answers per decision point:

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
- `WS /streams/{replay_id}`

POST and WebSocket requests use the remote `x-overtiq-key`. The terminal auto-connects, sends one cached bootstrap request, and opens one live stream. Scenario controls (weather, rain, compound, ERS, fuel, VSC, and red flag) are forwarded to CUDA; the before/after panel shows how the four engineer outputs move. The browser receives compact frames only and never receives model weights or raw telemetry.

The decision baseline is the calibrated `v4-logistic` model. The GPU forecaster artifact (`forecaster_2026_v1.pt`) consumes 26 telemetry features and returns 1–5 second speed forecasts. The CUDA simulator uses those inputs with vehicle state, grip, energy, fuel, opponent response, and Monte Carlo branches to return probabilities, finish-position quantiles, evidence, and a recommendation.

The current instance exposes the API through a supervised HTTPS quick tunnel. Quick tunnels are ephemeral; replace the endpoint in `dist/app.js` with a named HTTPS tunnel for production uptime.

## Local preview

Serve the static directory with any HTTP server (module imports require HTTP):

```powershell
python -m http.server 4173 --directory dist
```

Open `http://localhost:4173`. The terminal auto-connects to the remote GPU service and uses the read-only fixture only when the remote link is unavailable.

