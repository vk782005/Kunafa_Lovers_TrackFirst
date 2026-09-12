# Overtiq model accuracy and value protocol

A model is useful to a race engineer when its probabilities are calibrated, its forecasts arrive before the decision window closes, and the recommended action improves race outcomes against the existing decision baseline. A single “accuracy” percentage cannot prove that: most laps do not contain a pass, so a model that always says HOLD can look accurate while providing no racing value.

## Labels and evaluation unit

Evaluate one row per driver, lap, sector, and overtaking zone. The row must contain only information available at the decision timestamp. Freeze the label definitions:

| Output | Positive label |
| --- | --- |
| `gain_position_within_3_laps` | The driver gains at least one net position by the end of lap `t+3`. |
| `pass_within_60s` | The target is passed within 60 seconds of the decision timestamp. |
| `durable_pass` | A pass happens within 60 seconds and the driver remains ahead three laps after that pass. |
| `finish_position` | Final classification position, including retirement and neutralised race states. |

A durable pass is evaluated only when a target exists and the car remains classified. Missing telemetry, red flags, pit stops, and safety-car transitions are retained as explicit state labels so they can be scored as conditional slices rather than silently removed.

## Split protocol

Use race or session grouped splits. Never put rows from the same session in both train and test, and never let a future lap provide a feature for an earlier decision. Report three views together:

- **Time-forward holdout:** train on earlier races and test on later races.
- **Race holdout:** leave one complete race out at a time to measure generalisation to a new weekend.
- **Driver and zone slices:** report Haas drivers separately, then dry/wet, VSC/red flag, tyre compound, lap phase, and overtaking zone.

The calibrated `v4-logistic` model is the locked baseline. Every candidate uses exactly the same rows, labels, splits, and probability post-processing. A model is not promoted because it wins on a convenient split.

## Scorecard

| Area | Primary metrics | What it proves |
| --- | --- | --- |
| Discrimination | PR-AUC and ROC-AUC for each binary output | Whether high-risk opportunities rank above low-risk opportunities. PR-AUC is the main metric because passes are rare. |
| Probability quality | Brier score, log loss, expected calibration error (ECE), reliability curve, calibration slope/intercept | Whether “70%” events occur about 70% of the time. This is essential for risk-aware engineer calls. |
| Decision quality | Precision and recall at the operating thresholds, false-attack rate, missed-opportunity rate, confusion matrix by action | Whether the recommendation is safe and useful at the actual ATTACK/HOLD/DEFEND cutoffs. |
| Race projection | Finish-position MAE, median absolute error, top-3/top-10 hit rate, pinball loss at P10/P50/P90, CRPS for the finish distribution | Whether the race projection is accurate and whether its uncertainty is honest. |
| Physics fidelity | Position and gap MAE, speed MAE, pass-time MAE, event timing error, invariant violation count | Whether the simulator reproduces observable race behaviour and state transitions. |
| Operations | GPU compute p50/p95, end-to-end p50/p95, frames per second, GPU memory, dropped frames, reconnect rate | Whether an engineer can rely on the result during a live window. |

For each metric report the candidate, v4 baseline, a bootstrap 95% confidence interval, sample count, and the paired difference. Include calibration plots and a per-zone table; aggregate scores hide failure in the very situations the tool is meant to stress.

## Promotion gates

Set the exact thresholds after the first frozen benchmark, but use these guardrails for the initial gate:

- No regression in Brier score, log loss, or ECE beyond the confidence interval. Prefer at least a 10% relative Brier improvement before replacing v4.
- PR-AUC must improve on the time-forward holdout, with no more than a 5% relative drop in any safety-critical slice.
- At the selected ATTACK threshold, precision and false-attack rate must meet the engineer’s agreed risk limit. Publish the threshold with the model version.
- Finish-position MAE and CRPS must match or beat v4, and 80% prediction intervals must cover close to 80% of held-out outcomes.
- Physics invariant violations must be zero in deterministic replay. Live decision p95 and stream freshness must remain within the terminal’s operational SLO.

If a candidate improves ranking but worsens calibration, calibrate it on a separate calibration split and re-score the untouched test set. Keep v4 as the fallback until all gates pass.

## How to prove value

1. **Retrospective replay:** Run v4, the candidate, and a simple HOLD/ATTACK heuristic over the same historical decision points. Reconstruct the action each system would have recommended, then score actual pass, durable pass, net positions, and avoided losses. Use paired bootstrap intervals by race, not independent row intervals.
2. **Counterfactual stress test:** Replay the same state with rain, tyre changes, ERS limits, VSC, red flag, traffic, and pit states. Verify that the outputs move in the physically expected direction and that the four engineer answers remain internally consistent. This proves sensitivity and robustness; it does not claim that a counterfactual happened historically.
3. **Shadow mode:** During live sessions, generate recommendations without sending them to the team. Log the timestamp, data snapshot hash, model version, recommendation, confidence, and eventual outcome. Measure calibration drift and latency before anyone relies on it.
4. **Prospective controlled comparison:** Once shadow mode passes, compare engineer calls supported by Overtiq with the existing workflow across matched sessions. The primary business outcome is net positions gained or retained per race, with secondary outcomes for durable passes, failed attacks, and decision lead time. Report confidence intervals and the cost of incidents or missed opportunities.

Value should be expressed in race terms: expected net positions per 100 comparable opportunities, durable passes per 100 opportunities, prevented failed attacks, and time-to-decision. Probability quality and race value are reported together so an attractive average cannot hide unsafe overconfidence.
