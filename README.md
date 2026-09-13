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
- `GET /streams/{replay_id}/events` (long-lived NDJSON frame stream)
- `WS /streams/{replay_id}` (compatibility route)

POST requests use the remote `x-overtiq-key`; the browser stream authenticates when it opens. The terminal auto-connects, sends one cached bootstrap request, and opens one long-lived HTTP stream. Scenario controls (weather, rain, compound, ERS, fuel, VSC, and red flag) are forwarded to CUDA; the before/after panel shows how the four engineer outputs move. The browser receives compact frames only and never receives model weights or raw telemetry.

The decision baseline is the calibrated `v4-logistic` model. The GPU forecaster artifact (`forecaster_2026_v1.pt`) consumes 26 telemetry features and returns 1–5 second speed forecasts. The CUDA simulator uses those inputs with vehicle state, grip, energy, fuel, opponent response, and Monte Carlo branches to return probabilities, finish-position quantiles, evidence, and a recommendation.

The accuracy and value scorecard is documented in [docs/model-evaluation.md](docs/model-evaluation.md). It defines grouped time-forward splits, pass and durable-pass labels, calibration and ranking metrics, physics fidelity checks, promotion gates, and the retrospective, shadow-mode, and prospective tests needed to prove race value.

The reproducibility handoff is documented in [docs/FREEZE.md](docs/FREEZE.md). Read [docs/datasets.md](docs/datasets.md) for source provenance, labels, exported sessions, and known data limits, and [docs/model-handoff.md](docs/model-handoff.md) for the frozen model bundle, tensor interface, serving routes, and promotion policy. The model files are kept in `models/` and the canonical export inventory is `datasets/MANIFEST.json`.

FastAPI serves both the frontend and GPU API through Vast's direct container `10200` to host `41138` mapping. The browser therefore uses relative same-origin URLs, with no CORS hop, localhost bridge, or SSH tunnel.

## Open the terminal

Open the supervisor-managed terminal directly:

`http://122.59.250.166:41138/`

`start_local.ps1` checks the remote GPU health and opens this URL. It does not start a tunnel or local server. The app shows an explicit unavailable state if the GPU process is down; it does not fabricate replay frames.
