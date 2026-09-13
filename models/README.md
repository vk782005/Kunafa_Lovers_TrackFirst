# Frozen model bundle

This directory is the model portion of the Overtiq handoff. JSON files carry feature order, coefficients, policy thresholds, provenance, and validation metadata. The `.pt` files are PyTorch weights.

`forecaster_2026_v1.pt` is the GPU-serving speed forecaster. It takes `(N, 12, 26)` standardized telemetry windows and returns speed deltas at 1–5 second horizons. `zone_pass_model.json` is the calibrated v4-style logistic pass model used for the engineer decision. `rival_cover_model.json`, `lap_trial_models.json`, and `deployment_policy.json` support the action policy. `mlp_zone_pass.pt` is retained as an experiment for comparison; it is not promoted because leave-one-circuit-out results do not beat logistic calibration.

See [`docs/model-handoff.md`](../docs/model-handoff.md) for the interface, training scope, metrics, deployment path, and limitations.
