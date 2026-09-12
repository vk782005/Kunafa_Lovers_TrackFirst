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
- `POST /engineer/race-assessment`
- `GET /replays/{replay_id}/frames`
- `GET /replays/{replay_id}/zones`
- `WS /streams/{replay_id}`

POST and WebSocket requests use the remote `x-overtiq-key`. The terminal's Connect GPU panel keeps the key in session storage and never ships model weights or raw telemetry to the laptop.

The current instance exposes the API through a supervised HTTPS quick tunnel. Quick tunnels are ephemeral; replace the endpoint with a named HTTPS tunnel for production uptime.

## Local preview

Serve the static directory with any HTTP server (module imports require HTTP):

```powershell
python -m http.server 4173 --directory dist
```

Open `http://localhost:4173`. The terminal starts with a read-only demo fixture; use **Connect GPU** to switch to the remote service.

