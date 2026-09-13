# Overtiq model handoff

## What is frozen

The frozen decision baseline is the calibrated `v4-logistic` model used by the GPU service. The primary neural artifact is `models/forecaster_2026_v1.pt`, a CUDA-capable speed forecaster trained on the remote GPU and loaded by `/workspace/overtiq/services/overtiq_api.py`. Model files are accompanied by JSON metadata and a smoke-test report so a consumer can verify feature order, normalization, horizons, and training scope.

## Artifacts

| Local path | Remote provenance | Status | Purpose |
| --- | --- | --- | --- |
| `models/forecaster_2026_v1.pt` | `reports/model/forecaster_2026_v1.pt` | **Serving** | Sequence speed forecast for 1–5 seconds ahead |
| `models/forecaster_2026_v1.json` | `export/models/forecaster_2026_v1.json` | Serving metadata | Feature order, normalization, horizons, split notes |
| `models/FORECASTER_V1.txt` | `export/models/FORECASTER_V1.txt` | Validation report | Baselines, MAE, reload and CUDA smoke tests |
| `models/zone_pass_model.json` | `export/models/zone_pass_model.json` | **Serving decision model** | Calibrated probability of a pass in the active zone |
| `models/rival_cover_model.json` | `export/models/rival_cover_model.json` | Serving support model | Probability that the car ahead deploys/defends |
| `models/lap_trial_models.json` | `export/models/lap_trial_models.json` | Serving support model | 60-second pass and durable-pass trial models |
| `models/deployment_policy.json` | `export/models/deployment_policy.json` | Serving policy | Zone deployment threshold and response policy |
| `models/mlp_zone_pass.pt` | `export/models/mlp_zone_pass.pt` | **Experimental** | In-sample interface artifact; not promoted |
| `models/ocon_forecast_melbourne.json` | remote forecast output | Fixture/output | A recorded forecast output for the Ocon Melbourne case |

The logistic models use raw feature units and no scaler. The MLP is retained for auditability, but its in-sample interface result does not beat the logistic model on leave-one-circuit-out evaluation; it is not the production decision path.

## Forecaster interface

`forecaster_2026_v1.pt` consumes a standardized tensor with shape `(N, 12, 26)`: twelve recent telemetry steps and 26 features. The feature order is:

`v`, `a`, `throttle`, `brake`, `n_gear`, `rpm`, `drs`, `a_resist`, `curv_here`, `grade_here`, `max_abs_curv_next_200m`, `curv_ahead_25m`, `curv_ahead_50m`, `curv_ahead_100m`, `curv_ahead_200m`, `curv_ahead_400m`, `grade_ahead_50m`, `grade_ahead_200m`, `curv_in_0.5s`, `curv_in_1.0s`, `curv_in_2.0s`, `curv_in_3.0s`, `grade_in_1.0s`, `time_to_corner_s`, `max_abs_curv_next_400m`, `dist_to_next_corner_m`.

The tensor is standardized with the stored `mu` and `sd` arrays in `forecaster_2026_v1.json`. The output is a speed delta in m/s for each horizon `1, 2, 3, 4, 5` seconds. It is a speed forecast, not a complete pass classifier and not a replacement for the physics state update.

The model was trained on 11 races and 1,644,436 windows, with Montreal and Spa held out for validation. The recorded MAE is 0.944, 2.014, 2.937, 3.908, and 5.348 m/s at the five horizons. Constant-speed and constant-acceleration baselines are included in `FORECASTER_V1.txt`. Reload error was at most `1.91e-6`; the recorded CUDA-versus-CPU output gap was `1.39e-2 m/s`.

## Serving and output path

The FastAPI service in `backend/overtiq_api.py` is the local mirror of the deployed GPU service. In production the supervisor-managed process is `/workspace/overtiq/services/overtiq_api.py` (`overtiq_gpu`, remote service version `overtiq-gpu-0.4.2`). CUDA is required; the service fails closed instead of silently executing physics or inference on a CPU.

The browser calls the remote same-origin API and never receives model weights or credentials. The API accepts `SimulationRequest` controls such as track/session, driver, lap, weather, rain intensity, tyre compound, ERS deployment, fuel load, VSC, red flag, and seed. GPU-resident feature construction, forecaster inference, vehicle/tyre/energy integration, opponent response, and Monte Carlo branches produce the result.

The main contracts are:

* `GET /physics/schema` and `POST /physics/simulate` — deterministic physics frames (`PhysicsFrame.v1`).
* `POST /physics/compare` — before/after scenario comparison.
* `GET /engineer/schema`, `POST /engineer/assess`, and `POST /engineer/race-assessment` — `EngineerAssessment.v1` with the four probabilities, finish-position expectation/distribution, evidence, recommendation, model/simulator versions, timestamp, and data-quality flags.
* `POST /engineer/bootstrap` — one initial assessment, track zones, and a bounded frame window.
* `GET /streams/{replay_id}/events` or `WS /streams/{replay_id}` — compact replay frames for the terminal.

The decision probabilities are derived from shared scenario branches, so `gain_position_within_3_laps`, `pass_within_60s`, `durable_pass`, and finish-position distribution stay internally consistent. The side evidence identifies lap, sector, zone, gap, delta, tyre, ERS/fuel state, traffic, and uncertainty.

## Baseline, GPU model, and promotion

The calibrated v4 logistic model is the audit baseline because it is interpretable, fast, and probability-calibrated. The GPU forecaster supplies short-horizon vehicle response to the simulator; it does not automatically replace the decision baseline. A candidate can only be promoted after identical race-grouped splits show no calibration regression and acceptable decision/physics/latency metrics. The complete scorecard and value protocol are in [`docs/model-evaluation.md`](model-evaluation.md).

## Limitations

OpenF1 does not expose 2026 ERS/SOC/deployment channels, so these are estimated or simulated. The forecaster was validated on held-out races, not every circuit. Counterfactual rain, neutralization, tyre, fuel, or deployment outcomes are stress-test results, not historical facts. This package is an engineering research handoff and is not a safety-critical or race-control system.
