# TrackShift F1 HEV MATLAB model

This folder contains the connected native Simulink HEV model and the detailed pure-MATLAB reference implementation used for the TrackShift F1-style 2026 powertrain demonstrator.

## Quick start

Open MATLAB R2025a or MATLAB Online, set the current folder to this directory, then run:

```matlab
addpath(pwd)
open_system('TrackShift_F1_HEV.slx')
```

Click Run in Simulink. The top level compares `OVERTAKE MODE - AI DEPLOY` with `NO OVERTAKE MODE - HOLD + REGEN`. The model includes the ICE, turbocharger/intercooler, fuel system, MGU-K, inverter/DC link, BMS/HV safety, battery, regenerative braking, brake-by-wire, gearbox, aerodynamics, tyres and longitudinal vehicle dynamics. Displays show the key engine, MGU-K and battery signals; Scopes compare battery energy and MGU-K power.

To rebuild the graphical model from source:

```matlab
[modelFile, modelInfo] = Build_TrackShift_F1_HEV_Model('openAfterBuild', true);
```

To run the detailed MATLAB analysis, including the six scenarios, validation tests and efficiency sweep:

```matlab
[results, modelInfo] = TrackShift_EndToEnd( ...
    'makePlots', true, ...
    'saveResults', true, ...
    'outputFile', fullfile(pwd, 'TrackShift_all_results.mat'));
```

Useful outputs:

```matlab
disp(results.comparison)
disp(results.scenarioSummary)
disp(results.efficiencySweep)
disp(results.validation.unitTests)
disp(results.trackshift.engineStats)
disp(results.trackshift.mguKStats)
disp(results.trackshift.batteryStats)
disp(results.trackshift.vehicleStats)
```

The AI coefficients used by the MATLAB/Simulink implementation come from the handover production models. For provenance, the corresponding JSON model files are already stored in the repository's parent `models/` directory. The large `handover.rar` archive is not required to run this folder because the coefficients are embedded in the MATLAB Function block and pure-MATLAB implementation.

## Files

- `Build_TrackShift_F1_HEV_Model.m` - builder for the native `.slx` model.
- `TrackShift_F1_HEV.slx` - connected graphical Simulink model.
- `TrackShift_EndToEnd.m` - detailed base-MATLAB implementation and analysis.
- `TrackShift_Model_Postulates_and_Graph_Insights_Report.docx` - four-page interpretation report.
- `TrackShift_*_after_sim.png` and related PNG files - model previews.
- `TrackShift_all_results.mat` and `TrackShift_demo_results.mat` - saved simulation results.
- `trackshift_dashboard.html` - lightweight browser dashboard fallback.

## Scope

This is a signal-level engineering demonstrator, not an official F1 team calibration, detailed combustion CFD model, electrochemical battery model, hardware-in-the-loop implementation or regulatory certification. Replace the synthetic telemetry and placeholder maps with verified vehicle, battery and circuit data before physical-use claims.
