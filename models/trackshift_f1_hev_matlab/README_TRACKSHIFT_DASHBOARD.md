# TrackShift Scenario Demonstrator

This is the fallback demonstration layer for the TrackShift hardware-simulation concept. It is a standalone browser file and does not require MATLAB, Simulink, Simscape, Python, Node.js, or internet access.

## Run it

Double-click `trackshift_dashboard.html`, or open it in Chrome/Edge.

Choose a scenario:

- No overtake
- Eligible and activated
- AI request blocked by rules
- Braking harvest
- Low-energy governor
- Safety-car disable

Press Play and move the timeline slider. The dashboard shows the same decision path at each 0.25 s step:

`telemetry -> rule gate -> AI score -> power governor -> ICE/MGU-K/energy store response`

## What to show

For a presentation, use this sequence:

1. Select "AI request blocked by rules". Show requested power above zero, actual power at zero, and the waiting/blocked reason.
2. Select "Eligible and activated". Show the Detection/Activation markers, positive MGU-K power, battery discharge, and increased wheel power.
3. Select "Braking harvest". Show negative MGU-K power and battery energy recovery.
4. Select "Low-energy governor". Show the requested command clipped by the energy limit.
5. Use the baseline comparison values to explain the difference between naive deployment and TrackShift selection.

## Important scope

This is a physically constrained demonstrator, not a compliance-certified 2026 F1 powertrain model. The 350 kW cap, 4 MJ swing, 8.5 MJ recharge, 500 Nm torque, battery capacity, and efficiency values are configurable placeholders. Replace them with verified event-specific values before making regulatory claims.

## Replacing scenarios with real telemetry

Keep the same output fields and replace the `baseTelemetry` function in the HTML with data loaded from a prepared JSON file. The dashboard expects:

`t, sourceSpeed, distance, throttle, brake, gap, rel, straight, braking, lapLength`

The next upgrade should be a separate Python or MATLAB preprocessing step that maps FastF1/OpenF1 data into those fields.
