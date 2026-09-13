# Overtiq datasets and provenance

This document describes the data used by the frozen Overtiq race-engineer service. The canonical machine-readable inventory is [`datasets/MANIFEST.json`](../datasets/MANIFEST.json). The package was built at `2026-09-12T12:17:25Z` for the 2026 Formula 1 season.

## Source data

The measured timing and telemetry feed is the free, open [OpenF1 REST API](https://api.openf1.org/v1). The extraction used the `sessions`, `drivers`, `car_data`, `location`, `laps`, `stints`, `intervals`, `position`, `pit`, `race_control`, `weather`, and `overtakes` endpoints. The feed is nominally about 4 Hz per driver, but it is irregular: sample intervals vary and gaps are retained rather than being silently filled. The 2026 feed has no ERS state-of-charge, deployment, or usable DRS channel; the empty DRS field is recorded as missing data.

The regulatory constants come from the FIA 2026 Formula 1 Technical Regulations and are encoded in the remote service's `pilot/rules_2026.py`. The relevant constraints include fuel-energy flow, the 350 kW ERS-K ceiling, speed-dependent Overtake/non-Overtake power curves, a 4 MJ usable SOC swing, an 8.5 MJ per-lap recharge limit, minimum mass, and nominal tyre mass.

Track geometry is derived from OpenF1 location samples. The pipeline fits a centreline and arc length, then derives curvature, gradient, lateral offset, and overtaking-zone geometry. Vehicle drag-area and rolling terms are estimated per session from coast-down segments; confidence intervals and fallback notes are in `params/vehicle_identification.json`.

The remote GPU workspace also retains the raw FastF1 cache, Assetto Corsa Gym assets, and the TUM race-simulation repository. They are deliberately not copied into this handoff because they are large, remain on the GPU host, and are not required to run the serving package. Their remote locations are documented in `datasets/MANIFEST.json`.

## Exported artifacts

The export is organized as follows:

| Path | Contents | Grain or role |
| --- | --- | --- |
| `telemetry/*.parquet` | 13 2026 race sessions from Melbourne through Monza | One driver, one measured telemetry sample |
| `labels/lap_trials.parquet` | 60-second trial rows | Driver/lap/decision opportunity |
| `labels/zone_events.parquet` | Overtake-zone passages and outcomes | One car passing through one >290 km/h zone |
| `params/constants.json` | Simulation constants and defaults | Physics/configuration inputs |
| `params/vehicle_identification.json` | Session CdA and rolling estimates | Estimated vehicle parameters with CI |
| `params/zones_by_circuit.json` | Zone entry/exit arc lengths | Derived track geometry |
| `models/*.json` and `models/*.pt` | Logistic decision models and the speed forecaster | Serving and experiment artifacts |
| `baselines/*.json` | Zone measurements, policies, and honest realtime backtest | Baseline evidence |

The 13 exported telemetry sessions are:

`Melbourne`, `Shanghai`, `Suzuka`, `Miami`, `Montreal`, `Monte_Carlo`, `Catalunya`, `Spielberg`, `Silverstone`, `Spa-Francorchamps`, `Hungaroring`, `Zandvoort`, and `Monza`.

The complete filenames, row counts, timestamps, sample interval statistics, and byte sizes are in `datasets/MANIFEST.json`. The local freeze includes the manifest and model artifacts; the large telemetry and label Parquet files remain in `/workspace/overtiq/export` on the GPU host.

## Labels

The decision row contains only information available at its decision timestamp. The four engineer outcomes are:

* `gain_position_within_3_laps`: at least one net position gained by the end of lap `t+3`.
* `pass_within_60s`: the target is passed within 60 seconds of the decision timestamp.
* `durable_pass`: a pass occurs within 60 seconds and the driver remains ahead three laps after the pass.
* `finish_position`: final classification, including retirement and neutralized-race states.

The zone label is the measured `passed` outcome: the car passed the car ahead between zone entry and zone exit plus eight seconds according to the overtakes feed. Missing telemetry, pits, safety-car/VSC transitions, and red flags are explicit states and are scored as conditional slices, not discarded.

## Provenance legend

* **MEASURED** — present in the source timing or telemetry feed.
* **DERIVED** — calculated from measured values by a documented transformation.
* **ESTIMATED** — fitted model output, such as CdA or rolling resistance.
* **ASSUMED** — a chosen constant without a directly measured value.
* **REGULATORY** — read from the FIA 2026 technical regulations.

## Validation and known limits

Evaluation uses time-forward and race-grouped splits. A session never appears in both train and test, and future laps cannot contribute features to an earlier decision. Results are sliced by driver, dry/wet state, tyre compound, race phase, neutralization state, and overtaking zone.

The inventory records several limits that must stay visible to users of the model:

* Monaco contributes only about 7% of telemetry trials; Monaco and the Hungaroring have no >290 km/h zones in this extraction.
* Shanghai's fitted CdA (0.49) was not credible, so the calendar median was substituted.
* Zone passes are 624 of 2,916 total passes, so the zone model addresses roughly one fifth of all passes.
* ERS/SOC/deployment are estimated or simulated because the 2026 OpenF1 feed does not expose those channels.
* The simulator is a physics-informed counterfactual engine; its generated replay is not a claim that a historical car followed every simulated state.

## Reproducing the data view

Use `datasets/MANIFEST.json` as the integrity and provenance index. For the full export, work on the GPU host at `/workspace/overtiq/export`. The serving API reads the remote model and cache there; the browser receives only compact frames and assessment results.
