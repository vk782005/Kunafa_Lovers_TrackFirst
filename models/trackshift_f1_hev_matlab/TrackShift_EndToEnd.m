function [results, model] = TrackShift_EndToEnd(varargin)
% TrackShift_EndToEnd
% End-to-end MATLAB implementation of the TrackShift energy and overtake
% intelligence prototype described in the supplied engineering report.
%
% This file is intentionally self-contained. It runs with base MATLAB and
% does not require Simulink, Stateflow, Simscape, Statistics Toolbox, or a
% teammate ML artifact. The rule layer below is the executable MATLAB
% equivalent of the Stateflow layer specified in the report. When real data
% arrives, replace generateSyntheticData with the adapter described in the
% README and keep the standard table interface unchanged.
%
% Usage:
%   results = TrackShift_EndToEnd;
%   results = TrackShift_EndToEnd('makePlots',false);
%   results = TrackShift_EndToEnd('saveResults',true);
%   results = TrackShift_EndToEnd('scenario','blocked');
%
% Name-value options:
%   makePlots       true/false, default true
%   saveResults     true/false, default false
%   outputFile      MAT file path, default TrackShift_demo_results.mat
%   duration_s      synthetic replay duration, default 90 s
%   randomSeed      deterministic synthetic-data seed, default 7
%   scenario        nominal, noOvertake, blocked, harvest, lowEnergy, or safetyCar
%   runScenarioSweep true/false, default true
%   runEfficiencySweep true/false, default true
%
% Important: the regulatory numbers are configuration inputs and
% engineering placeholders taken from the supplied report. This prototype
% is not an FIA compliance-certified model. Load the exact event-specific
% Issue 20 / Issue 08 configuration before making regulatory claims.

opts = parseOptions(varargin{:});
rng(opts.randomSeed, 'twister');

[vehicleParams, ersParams, trackParams, strategyParams, regs2026] = ...
    initTrackShiftParameters(opts);

[telemetryTable, trackTable, trackParams] = generateSyntheticData(...
    vehicleParams, trackParams, strategyParams, opts);

sourceTelemetry = telemetryTable;
sourceErsParams = ersParams;
sourceStrategyParams = strategyParams;
[telemetryTable, ersParams, strategyParams] = configureScenario(...
    telemetryTable, ersParams, strategyParams, opts.scenario);

selectedRun = executeScenario(opts.scenario, telemetryTable, trackTable, ...
    vehicleParams, ersParams, trackParams, strategyParams, regs2026);
baseline = selectedRun.baseline;
trackshift = selectedRun.trackshift;
validation = selectedRun.validation;
comparison = selectedRun.comparison;

results = struct();
results.name = 'TrackShift Energy and Overtake Intelligence';
results.version = 'MATLAB R2025a-compatible pure MATLAB reference implementation with embedded handover AI';
results.scenario = string(opts.scenario);
results.parameters.vehicleParams = vehicleParams;
results.parameters.ersParams = ersParams;
results.parameters.trackParams = trackParams;
results.parameters.strategyParams = strategyParams;
results.parameters.regs2026 = regs2026;
results.inputs.telemetryTable = telemetryTable;
results.inputs.trackTable = trackTable;
results.baseline = baseline;
results.trackshift = trackshift;
results.validation = validation;
results.comparison = comparison;
results.aiModel = strategyParams.aiModel;

if opts.runScenarioSweep
    scenarioNames = scenarioCatalog();
    scenarioRuns = struct();
    for i = 1:numel(scenarioNames)
        scenarioName = char(scenarioNames(i));
        [scenarioTelemetry, scenarioErs, scenarioStrategy] = configureScenario(...
            sourceTelemetry, sourceErsParams, sourceStrategyParams, scenarioName);
        scenarioRuns.(scenarioName) = executeScenario(scenarioName, ...
            scenarioTelemetry, trackTable, vehicleParams, scenarioErs, ...
            trackParams, scenarioStrategy, regs2026);
    end
    results.scenarioNames = scenarioNames;
    results.scenarioRuns = scenarioRuns;
    results.scenarioSummary = summarizeScenarioRuns(scenarioRuns, scenarioNames);
end

if opts.runEfficiencySweep
    results.efficiencySweep = runEfficiencySweep(sourceTelemetry, trackTable, ...
        vehicleParams, sourceErsParams, trackParams, sourceStrategyParams, regs2026);
end

if opts.makePlots
    results.figure = plotDashboard(results);
end

if opts.saveResults
    save(opts.outputFile, 'results', '-v7.3');
    fprintf('Saved results to %s\n', opts.outputFile);
end

printSummary(results);

model = struct();
model.description = 'TrackShift end-to-end executable reference model';
model.blocks = ["Data_Input"; "Feature_Engineering"; "Rule_Eligibility"; ...
    "Decision_Engine"; "Power_Command_Governor"; "Powertrain"; ...
    "Vehicle_Dynamics"; "Results_Dashboard"];
model.stateflowEquivalent = 'evaluateRuleGate';
model.simscapeReplacementPoint = 'simulateStrategy -> physical Battery_ES and MGU-K subsystem';
model.inputContract = telemetryTable.Properties.VariableNames(:);
model.outputContract = baseline.log.Properties.VariableNames(:);
end

function [telemetryTable, trackTable, trackParams] = generateSyntheticData(...
    vehicleParams, trackParams, strategyParams, opts)
% Synthetic data uses the same input contract expected from later telemetry.
% Replace this function with readtable/readtimetable plus a mapping layer.

dt = strategyParams.sampleTime_s;
t = (0:dt:opts.duration_s)';
n = numel(t);

speed_kph = 220 + 34*sin(2*pi*t/38) + 16*sin(2*pi*t/17);
speed_kph = speed_kph - 42*exp(-((t-18)/2.4).^2);
speed_kph = speed_kph - 38*exp(-((t-48)/2.8).^2);
speed_kph = speed_kph - 45*exp(-((t-75)/2.7).^2);
speed_kph = clamp(speed_kph, 80, 330);
speed_mps = speed_kph / 3.6;
acceleration_m_s2 = [0; diff(speed_mps) / dt];
distance_m = cumtrapz(t, speed_mps);

trackParams.lapLength_m = distance_m(end);
trackParams.detectionLine_m = trackParams.detectionLineFractions * ...
    trackParams.lapLength_m;
trackParams.activationLine_m = trackParams.activationLineFractions * ...
    trackParams.lapLength_m;

throttle = 0.58 + 0.18*sin(2*pi*t/31) + 0.12*(acceleration_m_s2 > 0);
throttle = clamp(throttle, 0.10, 0.98);
brake = clamp(-acceleration_m_s2 / 7.5, 0, 1);
brake = max(brake, 0.75*double(isBrakingZone(distance_m, trackParams)));

gear = 1 + floor(clamp((speed_kph - 70) / 34, 0, 7));
gear = clamp(gear, 1, numel(vehicleParams.gearRatios));
gear = round(gear);
gearRatioAtSample = reshape(vehicleParams.gearRatios(gear(:)), [], 1);
engineRpm = speed_mps ./ vehicleParams.wheelRadius_m .* ...
    gearRatioAtSample * vehicleParams.finalDriveRatio * 60/(2*pi);
engineRpm = clamp(engineRpm, vehicleParams.engineMinRpm, vehicleParams.engineMaxRpm);

gap_s = 1.35*ones(n, 1);
for i = 1:numel(trackParams.detectionLine_m)
    % Keep the synthetic rival close from the detection line through the
    % activation line so the imported handover policy sees a real decision
    % opportunity instead of a gap that has already disappeared.
    width = 0.10 * trackParams.lapLength_m;
    closeness = exp(-0.5*((distance_m - trackParams.detectionLine_m(i))/width).^2);
    if i ~= 2
        gap_s = gap_s - 1.05*closeness;
    else
        gap_s = gap_s - 0.70*closeness;
    end
end
gap_s = clamp(gap_s + 0.03*sin(2*pi*t/9), 0.35, 2.0);

relativeSpeedAhead_kph = 3 + 12*double(gap_s < trackParams.detectionGap_s) ...
    - 8*brake + 1.5*sin(2*pi*t/11);
relativeSpeedAhead_kph = clamp(relativeSpeedAhead_kph, -20, 25);

sector = min(trackParams.numberOfSectors, ...
    1 + floor(trackParams.numberOfSectors * distance_m / trackParams.lapLength_m));
straightFlag = speed_kph > 215 & brake < 0.20;
brakingZone = isBrakingZone(distance_m, trackParams) | brake > 0.25;
gradient_rad = trackParams.gradientAmplitude_rad * sin(2*pi*distance_m/trackParams.lapLength_m);
elevation_m = cumtrapz(distance_m, tan(gradient_rad));

sessionType = repmat("TTCS", n, 1);
overtakeEnabledInput = true(n, 1);
raceDirectorDisable = false(n, 1);
safetyCar = false(n, 1);
lowGrip = false(n, 1);
yellowSector = false(n, 1);
trackPowerLimited = false(n, 1);

telemetryTable = table(t, distance_m, speed_kph, speed_mps, acceleration_m_s2, ...
    throttle, brake, engineRpm, gear, gap_s, relativeSpeedAhead_kph, sector, ...
    distance_m, straightFlag, brakingZone, sessionType, overtakeEnabledInput, ...
    raceDirectorDisable, safetyCar, lowGrip, yellowSector, trackPowerLimited, ...
    'VariableNames', {'time_s','distance_m','speed_kph','speed_mps', ...
    'acceleration_m_s2','throttle_0to1','brake_0to1','engine_rpm','gear', ...
    'gap_to_car_ahead_s','relative_speed_ahead_kph','sector', ...
    'track_position_m','straight_flag','braking_zone','session_type', ...
    'overtake_enabled_input','race_director_disable','safety_car', ...
    'low_grip','yellow_sector','track_power_limited'});

trackTable = table(distance_m, elevation_m, rad2deg(gradient_rad), ...
    gradient_rad, sector, straightFlag, brakingZone, ...
    'VariableNames', {'track_distance_m','elevation_m','gradient_deg', ...
    'gradient_rad','sector','straight_flag','braking_zone'});
end

function names = scenarioCatalog()
names = ["nominal"; "noOvertake"; "blocked"; "harvest"; ...
    "lowEnergy"; "safetyCar"];
end

function [telemetry, ersParams, strategyParams] = configureScenario(...
    sourceTelemetry, baseErsParams, baseStrategyParams, scenarioName)
% Apply deterministic scenario changes without changing the model equations.
% This makes the same pipeline demonstrable for both normal and exceptional
% race conditions.
telemetry = sourceTelemetry;
ersParams = baseErsParams;
strategyParams = baseStrategyParams;
scenarioKey = lower(char(string(scenarioName)));

switch scenarioKey
    case 'nominal'
        % Keep the synthetic TTCS replay unchanged.
    case 'noovertake'
        telemetry.overtake_enabled_input(:) = false;
    case 'blocked'
        telemetry.race_director_disable(:) = true;
    case 'harvest'
        % Keep the vehicle in a recovery-focused replay: the gap remains
        % above the detection threshold while braking zones are retained.
        telemetry.gap_to_car_ahead_s(:) = 1.80;
        telemetry.relative_speed_ahead_kph(:) = -4.0;
    case 'lowenergy'
        ersParams.initialSOC = 0.28;
        ersParams.initialEnergy_MJ = ersParams.initialSOC * ...
            ersParams.totalCapacity_MJ;
    case 'safetycar'
        telemetry.safety_car(:) = true;
    otherwise
        error('Unknown TrackShift scenario "%s".', scenarioName);
end
end

function run = executeScenario(scenarioName, telemetry, track, ...
    vehicleParams, ersParams, trackParams, strategyParams, regs2026)
baseline = simulateStrategy('baseline', telemetry, track, vehicleParams, ...
    ersParams, trackParams, strategyParams, regs2026);
trackshift = simulateStrategy('trackshift', telemetry, track, ...
    vehicleParams, ersParams, trackParams, strategyParams, regs2026);
validation = runValidation(telemetry, baseline, trackshift, ...
    vehicleParams, ersParams, trackParams, strategyParams, regs2026);
comparison = compareStrategies(baseline, trackshift, validation);

run = struct();
run.name = string(scenarioName);
run.baseline = baseline;
run.trackshift = trackshift;
run.validation = validation;
run.comparison = comparison;
end

function summary = summarizeScenarioRuns(scenarioRuns, scenarioNames)
n = numel(scenarioNames);
baselineLapTime_s = zeros(n, 1);
trackshiftLapTime_s = zeros(n, 1);
timeGain_s = zeros(n, 1);
energyDelta_MJ = zeros(n, 1);
baselineSuccessfulOvertakes = zeros(n, 1);
trackshiftSuccessfulOvertakes = zeros(n, 1);
deploymentEvents = zeros(n, 1);
harvestEvents = zeros(n, 1);
maxMGUKPower_kW = zeros(n, 1);
validationPassed = false(n, 1);

for i = 1:n
    run = scenarioRuns.(char(scenarioNames(i)));
    c = run.comparison;
    baselineLapTime_s(i) = c.baselineLapTime_s;
    trackshiftLapTime_s(i) = c.trackshiftLapTime_s;
    timeGain_s(i) = c.timeGain_s;
    energyDelta_MJ(i) = c.energyDelta_MJ;
    baselineSuccessfulOvertakes(i) = c.baselineSuccessfulOvertakes;
    trackshiftSuccessfulOvertakes(i) = c.trackshiftSuccessfulOvertakes;
    deploymentEvents(i) = run.trackshift.deploymentEvents;
    harvestEvents(i) = run.trackshift.harvestEvents;
    maxMGUKPower_kW(i) = run.trackshift.maxMGUKPower_kW;
    validationPassed(i) = c.validationPass;
end

summary = table(string(scenarioNames(:)), baselineLapTime_s, ...
    trackshiftLapTime_s, timeGain_s, energyDelta_MJ, ...
    baselineSuccessfulOvertakes, trackshiftSuccessfulOvertakes, ...
    deploymentEvents, harvestEvents, maxMGUKPower_kW, validationPassed, ...
    'VariableNames', {'scenario','baselineLapTime_s','trackshiftLapTime_s', ...
    'timeGain_s','energyDelta_MJ','baselineSuccessfulOvertakes', ...
    'trackshiftSuccessfulOvertakes','deploymentEvents','harvestEvents', ...
    'maxMGUKPower_kW','validationPassed'});
end

function sweep = runEfficiencySweep(telemetry, track, vehicleParams, ...
    baseErsParams, trackParams, strategyParams, regs2026)
efficiency = [0.90; 0.93; 0.96; 0.99];
n = numel(efficiency);
baselineEnergyUsed_MJ = zeros(n, 1);
trackshiftEnergyUsed_MJ = zeros(n, 1);
trackshiftEnergyRemaining_MJ = zeros(n, 1);
trackshiftHarvested_MJ = zeros(n, 1);

for i = 1:n
    ersParams = baseErsParams;
    ersParams.inverterEfficiency = efficiency(i);
    ersParams.electricalMechanicalEfficiency = efficiency(i);
    baseline = simulateStrategy('baseline', telemetry, track, vehicleParams, ...
        ersParams, trackParams, strategyParams, regs2026);
    trackshift = simulateStrategy('trackshift', telemetry, track, ...
        vehicleParams, ersParams, trackParams, strategyParams, regs2026);
    baselineEnergyUsed_MJ(i) = baseline.energyUsed_MJ;
    trackshiftEnergyUsed_MJ(i) = trackshift.energyUsed_MJ;
    trackshiftEnergyRemaining_MJ(i) = trackshift.energyRemaining_MJ;
    trackshiftHarvested_MJ(i) = trackshift.energyHarvested_MJ;
end

sweep = table(efficiency, baselineEnergyUsed_MJ, trackshiftEnergyUsed_MJ, ...
    trackshiftEnergyRemaining_MJ, trackshiftHarvested_MJ, ...
    'VariableNames', {'efficiency','baselineEnergyUsed_MJ', ...
    'trackshiftEnergyUsed_MJ','trackshiftEnergyRemaining_MJ', ...
    'trackshiftHarvested_MJ'});
end

function brakingZone = isBrakingZone(distance_m, trackParams)
brakingZone = false(size(distance_m));
for i = 1:numel(trackParams.detectionLine_m)
    d0 = trackParams.activationLine_m(i) - 0.08*trackParams.lapLength_m;
    d1 = trackParams.activationLine_m(i) + 0.04*trackParams.lapLength_m;
    brakingZone = brakingZone | (distance_m >= d0 & distance_m <= d1);
end
end

function sim = simulateStrategy(strategyName, telemetry, track, vehicleParams, ...
    ersParams, trackParams, strategyParams, regs2026)
n = height(telemetry);
dt = strategyParams.sampleTime_s;

v = telemetry.speed_mps(1);
s = 0;
eState = ersParams.initialEnergy_MJ;
eHigh = eState;
eLow = eState;
harvested = 0;
gateState = initRuleState();

% Preallocate every logged signal required by Appendix C plus useful debug
% signals for validation and a future Simulink Dataset mapping.
log = struct();
fields = {'time_s','distance_m','speed_mps','speed_kph','acceleration_m_s2', ...
    'P_ICE_kW','fuel_flow_MJph','P_ICE_fuel_kW','T_ICE_Nm','engine_rpm', ...
    'gear','throttle_0to1','brake_0to1','gradient_rad', ...
    'P_MGUK_electrical_kW','P_MGUK_mechanical_kW','T_MGUK_Nm', ...
    'omega_MGUK_rad_s','battery_voltage_V','battery_current_A', ...
    'battery_power_kW','E_ES_MJ','SOC_percent','harvested_energy_lap_MJ', ...
    'OvertakeEnabled','OvertakeActivated','DeploymentAllowed', ...
    'RegulatoryPowerLimit_kW','AI_score','P_success','P_no_deploy', ...
    'P_rival_cover','expected_gain','AI_deploy_recommendation', ...
    'risk','time_gain_s', ...
    'decision_mode','P_AI_request_kW','P_final_kW','P_physical_limit_kW', ...
    'P_energy_limit_kW','constraint_violation_flag','governor_clip_flag', ...
    'regulatory_violation_flag','energy_swing_MJ','F_traction_N','F_drag_N', ...
    'F_roll_N','F_grade_N','F_brake_N','P_wheel_kW','track_position_m', ...
    'gap_s','relative_speed_ahead_kph','reason_code','active_event'};
for i = 1:numel(fields)
    log.(fields{i}) = zeros(n, 1);
end
log.decision_mode = zeros(n, 1); % +1 DEPLOY, 0 HOLD, -1 HARVEST
log.reason_label = strings(n, 1);
log.state_label = strings(n, 1);

for k = 1:n
    obs = observationAt(telemetry, track, k, v, s);
    [gate, gateState] = evaluateRuleGate(gateState, obs, trackParams, regs2026);

    features = computeFeatures(obs, eState, ersParams, strategyParams, gate, trackParams);
    ai = decisionEngine(features, strategyParams);

    decision = chooseDecision(strategyName, obs, gate, ai, eState, ...
        ersParams, strategyParams);
    requestedPower_kW = decision * requestedMagnitude(decision, strategyParams);

    governor = powerCommandGovernor(requestedPower_kW, obs, gate, eState, ...
        eHigh, eLow, harvested, v, dt, ersParams, regs2026);

    ice = iceModel(obs, vehicleParams);
    mgu = mguKModel(governor.P_final_kW, v, obs.gear, vehicleParams, ersParams);
    forces = vehicleDynamics(ice.P_ICE_wheel_kW, mgu.P_mechanical_wheel_kW, ...
        v, obs.gradient_rad, obs.brake, vehicleParams);

    P_ES_kW = batterySidePower(governor.P_final_kW, ersParams);
    [batteryVoltage_V, batteryCurrent_A] = batteryElectricalState(...
        P_ES_kW, eState, ersParams);
    eNext = clamp(eState - P_ES_kW*dt/1000, ...
        ersParams.totalCapacity_MJ*ersParams.socMin, ...
        ersParams.totalCapacity_MJ*ersParams.socMax);
    harvestedNext = harvested + max(-P_ES_kW, 0)*dt/1000;
    eHighNext = max(eHigh, eNext);
    eLowNext = min(eLow, eNext);

    log.time_s(k,1) = double(obs.time_s);
    log.distance_m(k,1) = double(s);
    log.speed_mps(k,1) = double(v);
    log.speed_kph(k,1) = double(3.6*v);
    log.acceleration_m_s2(k,1) = double(forces.acceleration_m_s2(1));
    log.P_ICE_kW(k,1) = double(ice.P_ICE_wheel_kW(1));
    log.fuel_flow_MJph(k,1) = double(ice.fuelFlow_MJph(1));
    log.P_ICE_fuel_kW(k,1) = double(ice.P_ICE_fuel_kW(1));
    log.T_ICE_Nm(k,1) = double(ice.engineTorque_Nm(1));
    log.engine_rpm(k,1) = double(obs.engine_rpm(1));
    log.gear(k,1) = double(obs.gear(1));
    log.throttle_0to1(k,1) = double(obs.throttle(1));
    log.brake_0to1(k,1) = double(obs.brake(1));
    log.gradient_rad(k,1) = double(obs.gradient_rad(1));
    log.P_MGUK_electrical_kW(k,1) = double(governor.P_final_kW(1));
    log.P_MGUK_mechanical_kW(k,1) = double(mgu.P_mechanical_wheel_kW(1));
    log.T_MGUK_Nm(k,1) = double(mgu.T_MGUK_Nm(1));
    log.omega_MGUK_rad_s(k,1) = double(mgu.omega_MGUK_rad_s(1));
    log.battery_voltage_V(k,1) = double(batteryVoltage_V(1));
    log.battery_current_A(k,1) = double(batteryCurrent_A(1));
    log.battery_power_kW(k,1) = double(P_ES_kW(1));
    log.E_ES_MJ(k,1) = double(eNext(1));
    log.SOC_percent(k,1) = double(100*eNext(1)/ersParams.totalCapacity_MJ);
    log.harvested_energy_lap_MJ(k,1) = double(harvestedNext(1));
    log.OvertakeEnabled(k,1) = double(gate.OvertakeEnabled(1));
    log.OvertakeActivated(k,1) = double(gate.OvertakeActivated(1));
    log.DeploymentAllowed(k,1) = double(gate.DeploymentAllowed(1));
    log.RegulatoryPowerLimit_kW(k,1) = double(gate.RegulatoryPowerLimit_kW(1));
    log.AI_score(k,1) = double(ai.score(1));
    log.P_success(k,1) = double(ai.P_success(1));
    log.P_no_deploy(k,1) = double(ai.P_no_deploy(1));
    log.P_rival_cover(k,1) = double(ai.P_rival_cover(1));
    log.expected_gain(k,1) = double(ai.expected_gain(1));
    log.AI_deploy_recommendation(k,1) = double(ai.deploy_recommendation(1));
    log.risk(k,1) = double(ai.risk(1));
    log.time_gain_s(k,1) = double(ai.time_gain_s(1));
    log.decision_mode(k,1) = double(decision(1));
    log.P_AI_request_kW(k,1) = double(requestedPower_kW(1));
    log.P_final_kW(k,1) = double(governor.P_final_kW(1));
    log.P_physical_limit_kW(k,1) = double(governor.P_physical_limit_kW(1));
    log.P_energy_limit_kW(k,1) = double(governor.P_energy_limit_kW(1));
    log.constraint_violation_flag(k,1) = double(governor.constraintViolationFlag(1));
    log.governor_clip_flag(k,1) = double(governor.clipFlag(1));
    log.regulatory_violation_flag(k,1) = double(governor.regulatoryViolationFlag(1));
    log.energy_swing_MJ(k,1) = double(eHighNext(1) - eLowNext(1));
    log.F_traction_N(k,1) = double(forces.F_traction_N(1));
    log.F_drag_N(k,1) = double(forces.F_drag_N(1));
    log.F_roll_N(k,1) = double(forces.F_roll_N(1));
    log.F_grade_N(k,1) = double(forces.F_grade_N(1));
    log.F_brake_N(k,1) = double(forces.F_brake_N(1));
    log.P_wheel_kW(k,1) = double(forces.P_wheel_kW(1));
    log.track_position_m(k,1) = double(obs.track_position_m(1));
    log.gap_s(k,1) = double(obs.gap_s(1));
    log.relative_speed_ahead_kph(k,1) = double(obs.relative_speed_ahead_kph(1));
    log.reason_code(k,1) = double(gate.reason_code(1));
    log.active_event(k,1) = double(gate.active_event(1));
    log.reason_label(k,1) = gate.reason_label;
    log.state_label(k,1) = gate.state_label;

    v = max(0, v + forces.acceleration_m_s2*dt);
    s = s + max(0, v)*dt;
    eState = eNext;
    eHigh = eHighNext;
    eLow = eLowNext;
    harvested = min(ersParams.rechargeLimit_MJ, harvestedNext);
end

logTable = struct2table(log);
sim = struct();
sim.strategy = string(strategyName);
sim.log = logTable;
sim.lapTime_s = lapTimeFromDistance(log.distance_m, telemetry.distance_m(end), telemetry.time_s);
sim.energyUsed_MJ = sum(max(log.battery_power_kW, 0))*dt/1000;
sim.energyHarvested_MJ = sum(max(-log.battery_power_kW, 0))*dt/1000;
sim.energyRemaining_MJ = log.E_ES_MJ(end);
sim.successfulOvertakes = countSuccessfulOvertakes(log, strategyParams);
sim.deploymentEvents = countTransitions(log.decision_mode > 0);
sim.harvestEvents = countTransitions(log.decision_mode < 0);
sim.maxMGUKPower_kW = max(abs(log.P_MGUK_electrical_kW));
sim.maxMGUKTorque_Nm = max(abs(log.T_MGUK_Nm));
sim.constraintViolationCount = sum(log.constraint_violation_flag > 0);
sim.regulatoryViolationCount = sum(log.regulatory_violation_flag > 0);
sim.energyBalanceResidual_MJ = ...
    ersParams.initialEnergy_MJ - sim.energyUsed_MJ + sim.energyHarvested_MJ ...
    - sim.energyRemaining_MJ;
sim.sourceSpeedRMSE_kph = sqrt(mean((log.speed_kph - telemetry.speed_kph).^2));
sim.sourceSpeedMaxError_kph = max(abs(log.speed_kph - telemetry.speed_kph));
sim.engineStats = struct();
sim.engineStats.peakPower_kW = max(log.P_ICE_kW);
sim.engineStats.peakTorque_Nm = max(log.T_ICE_Nm);
sim.engineStats.meanRpm = mean(log.engine_rpm);
sim.engineStats.maxRpm = max(log.engine_rpm);
sim.engineStats.fuelEnergy_MJ = sum(log.P_ICE_fuel_kW)*dt/1000;
sim.mguKStats = struct();
sim.mguKStats.peakElectricalPower_kW = max(log.P_MGUK_electrical_kW);
sim.mguKStats.peakHarvestPower_kW = min(log.P_MGUK_electrical_kW);
sim.mguKStats.peakTorque_Nm = max(abs(log.T_MGUK_Nm));
sim.batteryStats = struct();
sim.batteryStats.initialEnergy_MJ = ersParams.initialEnergy_MJ;
sim.batteryStats.finalEnergy_MJ = log.E_ES_MJ(end);
sim.batteryStats.minEnergy_MJ = min(log.E_ES_MJ);
sim.batteryStats.maxEnergy_MJ = max(log.E_ES_MJ);
sim.batteryStats.minSOC_percent = min(log.SOC_percent);
sim.batteryStats.maxSOC_percent = max(log.SOC_percent);
sim.batteryStats.peakDischargePower_kW = max(log.battery_power_kW);
sim.batteryStats.peakChargePower_kW = min(log.battery_power_kW);
sim.batteryStats.peakCurrent_A = max(abs(log.battery_current_A));
sim.batteryStats.minVoltage_V = min(log.battery_voltage_V);
sim.batteryStats.maxVoltage_V = max(log.battery_voltage_V);
sim.vehicleStats = struct();
sim.vehicleStats.maxSpeed_kph = max(log.speed_kph);
sim.vehicleStats.distance_m = log.distance_m(end);
sim.vehicleStats.maxAcceleration_m_s2 = max(log.acceleration_m_s2);
sim.vehicleStats.minAcceleration_m_s2 = min(log.acceleration_m_s2);
end

function state = initRuleState()
state.lastTrackPosition_m = 0;
state.currentEvent = 1;
state.detectionLatched = false;
state.activationActive = false;
end

function opts = parseOptions(varargin)
p = inputParser;
addParameter(p, 'makePlots', true, @(x) islogical(x) || (isnumeric(x) && isscalar(x)));
addParameter(p, 'saveResults', false, @(x) islogical(x) || (isnumeric(x) && isscalar(x)));
addParameter(p, 'outputFile', fullfile(pwd, 'TrackShift_demo_results.mat'), @(x) ischar(x) || isstring(x));
addParameter(p, 'duration_s', 90, @(x) isnumeric(x) && isscalar(x) && x > 1);
addParameter(p, 'randomSeed', 7, @(x) isnumeric(x) && isscalar(x));
addParameter(p, 'scenario', 'nominal', @(x) ischar(x) || (isstring(x) && isscalar(x)));
addParameter(p, 'runScenarioSweep', true, @(x) islogical(x) || (isnumeric(x) && isscalar(x)));
addParameter(p, 'runEfficiencySweep', true, @(x) islogical(x) || (isnumeric(x) && isscalar(x)));
parse(p, varargin{:});
opts = p.Results;
opts.makePlots = logical(opts.makePlots);
opts.saveResults = logical(opts.saveResults);
opts.runScenarioSweep = logical(opts.runScenarioSweep);
opts.runEfficiencySweep = logical(opts.runEfficiencySweep);
opts.outputFile = char(opts.outputFile);
opts.scenario = char(opts.scenario);
end

function [vehicleParams, ersParams, trackParams, strategyParams, regs2026] = ...
    initTrackShiftParameters(~)
% All values in this function are assumptions/configuration inputs. The
% supplied report explicitly requires placeholders to be replaceable.

vehicleParams = struct();
vehicleParams.mass_kg = 803;
vehicleParams.frontalArea_m2 = 1.00;
vehicleParams.Cd = 0.925;
vehicleParams.CdA_m2 = vehicleParams.frontalArea_m2 * vehicleParams.Cd;
vehicleParams.Crr = 0.015;
vehicleParams.rollingEquivalentDecel_m_s2 = 0.30;
vehicleParams.wheelRadius_m = 0.330;
vehicleParams.gearRatios = [3.20 2.40 1.90 1.60 1.35 1.15 1.00 0.90];
vehicleParams.finalDriveRatio = 3.50;
vehicleParams.drivetrainEfficiency = 0.95;
vehicleParams.airDensity_kg_m3 = 1.225;
vehicleParams.gravity_m_s2 = 9.81;
vehicleParams.maxBrakeForce_N = 18000;
vehicleParams.engineRpmBreakpoints = [4000 6000 8000 10000 10500];
vehicleParams.engineTorqueCurve_Nm = [700 720 680 600 450];
vehicleParams.eta_ice = 0.55;
vehicleParams.fuelFlowMax_MJph = 3000;
vehicleParams.fuelFlowSlope_MJph_per_rpm = 0.27;
vehicleParams.fuelFlowIntercept_MJph = 165;
vehicleParams.engineMinRpm = 4000;
vehicleParams.engineMaxRpm = 10500;

ersParams = struct();
ersParams.nominalVoltage_V = 400;
ersParams.capacity_Ah = 10;
ersParams.totalCapacity_MJ = ersParams.nominalVoltage_V * ...
    ersParams.capacity_Ah * 3600 / 1e6;
ersParams.initialSOC = 0.80;
ersParams.socMin = 0.20;
ersParams.socMax = 0.95;
ersParams.initialEnergy_MJ = ersParams.initialSOC * ersParams.totalCapacity_MJ;
ersParams.internalResistance_Ohm = 0.08;
ersParams.maxElectricalPower_kW = 350;
ersParams.maxHarvestElectricalPower_kW = 180;
ersParams.maxTorque_Nm = 500;
ersParams.dischargePowerLimit_kW = 350;
ersParams.chargePowerLimit_kW = 180;
ersParams.inverterEfficiency = 0.97;
ersParams.electricalMechanicalEfficiency = 0.96;
ersParams.esSwingLimit_MJ = 4.0;
ersParams.rechargeLimit_MJ = 8.5;
ersParams.testVoltage_V = 400;
ersParams.testLoad_Ohm = 1.6;
ersParams.testPower_kW = ersParams.testVoltage_V^2 / ersParams.testLoad_Ohm / 1000;

trackParams = struct();
trackParams.lapLength_m = NaN;
trackParams.detectionGap_s = 0.90;
trackParams.detectionLineFractions = [0.19 0.50 0.78];
trackParams.activationLineFractions = [0.23 0.54 0.82];
trackParams.activationZoneLength_m = 450;
trackParams.gradientAmplitude_rad = deg2rad(0.7);
trackParams.numberOfSectors = 3;

strategyParams = struct();
strategyParams.sampleTime_s = 0.25;
strategyParams.deployPower_kW = 275;
strategyParams.harvestPower_kW = 120;
strategyParams.deployThreshold = 0.58;
strategyParams.minimumEnergyMargin_MJ = 0.15;
strategyParams.brakingHarvestThreshold = 0.22;
strategyParams.w_success = 1.00;
strategyParams.w_risk = 0.60;
strategyParams.w_energyCost = 0.25;
strategyParams.w_strategicValue = 0.50;
strategyParams.aiModel = handoverAIModel();

regs2026 = struct();
regs2026.absoluteElectricalPowerCap_kW = 350;
regs2026.esSwingLimit_MJ = 4.0;
regs2026.rechargeLimit_MJ = 8.5;
regs2026.maxMechanicalTorque_Nm = 500;
regs2026.standingStartMinSpeed_kph = 50;
regs2026.standardECUEfficiency = 0.97;
regs2026.technicalIssue = 'Section C Technical Issue 20, 05 Aug 2026';
regs2026.sportingIssue = 'Section B Sporting Issue 08, 05 Aug 2026';
regs2026.note = ['Configuration placeholder from supplied report. Verify exact ' ...
    'competition-specific curves before regulatory use.'];
% Power-curve constants from handover/export/params/constants.json. The
% 350 kW absolute ceiling is applied in both modes.
regs2026.nondeploySlope_kW_per_kph = -5;
regs2026.nondeployIntercept_kW = 1800;
regs2026.nondeploySegmentStart_kph = 340;
regs2026.nondeploySegmentEnd_kph = 345;
regs2026.overtakeSlope_kW_per_kph = -20;
regs2026.overtakeIntercept_kW = 7100;
regs2026.overtakeZeroSpeed_kph = 355;
regs2026.overtakeActivePowerLimit_kW = 350;
end

function aiModel = handoverAIModel()
% Embedded copy of the compact production models in handover.rar. Keeping
% the coefficients here makes the MATLAB file portable to MATLAB Online;
% the original archive remains the provenance record.
aiModel.source = 'handover.rar / handover/export/models';
aiModel.provenance = 'ESTIMATED; trained from the attached handover package';

aiModel.zonePass.name = 'P(pass in this zone passage)';
aiModel.zonePass.family = 'logistic regression, L2 1e-2, Newton';
aiModel.zonePass.nTrain = 10726;
aiModel.zonePass.featureOrder = ["intercept"; "gap"; "tyre_delta"; ...
    "own_dep"; "rival_dep"; "own_x_norival"; "len_km"; "next_km"; ...
    "is_last"; "gap_x_owndep"];
aiModel.zonePass.coefficients = [-0.7075777832923592; ...
    -6.026485573777835; -0.04895038433595806; ...
    -0.13455035383372793; -0.11816067407748346; ...
    1.055251955308986; 1.5560826217886794; ...
    0.1588318525718114; 0.4247931092675822; ...
    0.21790016690200298];

aiModel.rivalCover.name = 'P(the car ahead deploys in this zone)';
aiModel.rivalCover.family = 'logistic regression, L2 1e-2, Newton';
aiModel.rivalCover.nTrain = 10726;
aiModel.rivalCover.featureOrder = ["intercept"; "rival_soc"; ...
    "rival_deploys_earlier"; "rival_prev_zone"; ...
    "rival_gap_ahead_of_them"; "gap"; "tyre_delta"; "len_km"; ...
    "is_last"; "lap_phase"; "zone_idx"];
aiModel.rivalCover.coefficients = [-1.940559726452234; ...
    -0.27364141130466757; 0.6096490191848467; ...
    0.05772237959270659; -0.00991799169367214; ...
    -0.2114018519558647; -0.01166365647510053; ...
    4.432492080111768; 1.679664114999441; ...
    -0.3868757212959778; -0.4455625799447156];

aiModel.deploymentPolicy.name = 'per-zone deploy decision';
aiModel.deploymentPolicy.tauRecommended = 0.04;
aiModel.deploymentPolicy.rule = ...
    '(1-cover)*gain_unmatched + cover*gain_matched >= tau';

aiModel.lapTrialPass60.name = 'P(pass within 60 s)';
aiModel.lapTrialPass60.nTrain = 10716;
aiModel.lapTrialPass60.featureOrder = ["intercept"; "gap_s"; ...
    "tyre_age_delta_laps"];
aiModel.lapTrialPass60.coefficients = [-0.8405861024010692; ...
    -1.9463537472006074; -0.08489712734227542];
end

function obs = observationAt(telemetry, track, k, v, s)
obs.time_s = telemetry.time_s(k);
obs.track_position_m = telemetry.track_position_m(k);
obs.speed_mps = v;
obs.speed_kph = 3.6*v;
obs.source_speed_kph = telemetry.speed_kph(k);
obs.gap_s = telemetry.gap_to_car_ahead_s(k);
obs.relative_speed_ahead_kph = telemetry.relative_speed_ahead_kph(k);
obs.throttle = telemetry.throttle_0to1(k);
obs.brake = telemetry.brake_0to1(k);
obs.engine_rpm = telemetry.engine_rpm(k);
obs.gear = telemetry.gear(k);
obs.sector = telemetry.sector(k);
obs.straight_flag = telemetry.straight_flag(k);
obs.braking_zone = telemetry.braking_zone(k);
obs.session_type = telemetry.session_type(k);
obs.overtake_enabled_input = telemetry.overtake_enabled_input(k);
obs.race_director_disable = telemetry.race_director_disable(k);
obs.safety_car = telemetry.safety_car(k);
obs.low_grip = telemetry.low_grip(k);
obs.yellow_sector = telemetry.yellow_sector(k);
obs.track_power_limited = telemetry.track_power_limited(k);
obs.gradient_rad = track.gradient_rad(k);
obs.distance_state_m = s;
end

function [gate, state] = evaluateRuleGate(state, obs, trackParams, regs2026)
% MATLAB equivalent of the Stateflow eligibility layer.
% TTCS: Detection Line gap result is latched until Activation Line.
% LTCS: this prototype treats the base gate as immediately deployable.

if state.currentEvent > numel(trackParams.detectionLine_m)
    state.currentEvent = numel(trackParams.detectionLine_m);
end

systemAllowed = ~obs.race_director_disable && ~obs.safety_car ...
    && ~obs.low_grip && ~obs.yellow_sector && ~obs.track_power_limited;
baseAllowed = obs.overtake_enabled_input && systemAllowed;
standingStartBlocked = obs.time_s < 5 && ...
    obs.speed_kph < regs2026.standingStartMinSpeed_kph;

if ~baseAllowed
    state.detectionLatched = false;
    state.activationActive = false;
    stateLabel = "DISABLED";
    reasonLabel = "EXTERNAL_DISABLE";
    reasonCode = 1;
else
    event = state.currentEvent;
    detectLine = trackParams.detectionLine_m(event);
    activateLine = trackParams.activationLine_m(event);
    detectCrossed = state.lastTrackPosition_m <= detectLine ...
        && obs.track_position_m >= detectLine;
    activateCrossed = state.lastTrackPosition_m <= activateLine ...
        && obs.track_position_m >= activateLine;

    if strcmp(obs.session_type, "TTCS") && detectCrossed
        state.detectionLatched = obs.gap_s < trackParams.detectionGap_s;
    end

    if strcmp(obs.session_type, "TTCS") && state.detectionLatched && activateCrossed
        state.activationActive = true;
    elseif strcmp(obs.session_type, "LTCS")
        state.activationActive = true;
    end

    if state.activationActive && obs.track_position_m > ...
            activateLine + trackParams.activationZoneLength_m
        state.currentEvent = min(state.currentEvent + 1, ...
            numel(trackParams.detectionLine_m));
        state.detectionLatched = false;
        state.activationActive = false;
    end

    if strcmp(obs.session_type, "TTCS")
        if state.activationActive
            stateLabel = "ACTIVATED";
            reasonLabel = "ACTIVATED";
            reasonCode = 3;
        elseif state.detectionLatched
            stateLabel = "ENABLED";
            reasonLabel = "WAITING_FOR_ACTIVATION_LINE";
            reasonCode = 2;
        else
            stateLabel = "ENABLED";
            reasonLabel = "DETECTION_NOT_LATCHED";
            reasonCode = 4;
        end
    else
        stateLabel = "ACTIVATED";
        reasonLabel = "LTCS_BASE_GATE";
        reasonCode = 3;
    end
end

overtakeEnabled = baseAllowed && ~standingStartBlocked;
overtakeActivated = overtakeEnabled && state.activationActive;
deploymentAllowed = overtakeActivated && ~standingStartBlocked;
harvestAllowed = systemAllowed && ~standingStartBlocked;

gate = struct();
gate.OvertakeEnabled = double(overtakeEnabled);
gate.OvertakeActivated = double(overtakeActivated);
gate.DeploymentAllowed = double(deploymentAllowed);
gate.HarvestAllowed = double(harvestAllowed);
gate.RegulatoryPowerLimit_kW = regulatoryPowerLimit(obs.speed_kph, ...
    overtakeActivated, regs2026);
gate.RegulatoryViolationFlag = 0;
gate.reason_code = reasonCode;
gate.reason_label = reasonLabel;
gate.state_label = stateLabel;
gate.active_event = state.currentEvent;
gate.detection_latched = double(state.detectionLatched);
state.lastTrackPosition_m = obs.track_position_m;
end

function limit_kW = regulatoryPowerLimit(speed_kph, overtakeActive, regs2026)
if overtakeActive
    if speed_kph < regs2026.overtakeZeroSpeed_kph
        raw_kW = regs2026.overtakeIntercept_kW + ...
            regs2026.overtakeSlope_kW_per_kph*speed_kph;
    else
        raw_kW = 0;
    end
    limit_kW = clamp(raw_kW, 0, min(...
        regs2026.absoluteElectricalPowerCap_kW, ...
        regs2026.overtakeActivePowerLimit_kW));
    return;
end

if speed_kph < regs2026.nondeploySegmentStart_kph
    raw_kW = regs2026.nondeployIntercept_kW + ...
        regs2026.nondeploySlope_kW_per_kph*speed_kph;
elseif speed_kph < regs2026.nondeploySegmentEnd_kph
    % 100 kW at 340 kph linearly falling to zero at 345 kph.
    raw_kW = 100 * (regs2026.nondeploySegmentEnd_kph - speed_kph) / ...
        (regs2026.nondeploySegmentEnd_kph - regs2026.nondeploySegmentStart_kph);
else
    raw_kW = 0;
end
limit_kW = clamp(raw_kW, 0, regs2026.absoluteElectricalPowerCap_kW);
end

function features = computeFeatures(obs, eState, ersParams, strategyParams, gate, trackParams)
features = struct();
features.speed_kph = obs.speed_kph;
features.gap_s = obs.gap_s;
features.relative_speed_kph = obs.relative_speed_ahead_kph;
features.SOC = clamp(eState / ersParams.totalCapacity_MJ, 0, 1);
features.usableEnergy_MJ = eState;
features.track_position_m = obs.track_position_m;
features.braking_distance_m = max(20, obs.speed_mps.^2/(2*7.5));
features.availablePower_kW = min(ersParams.maxElectricalPower_kW, ...
    gate.RegulatoryPowerLimit_kW);
features.requestedDeployPower_kW = strategyParams.deployPower_kW;
features.sector = obs.sector;
features.straight_flag = obs.straight_flag;
features.braking_zone = obs.braking_zone;
% Handover production-model features. The public timing feed has no
% tyre-age or rival-ERS channels, so these are explicit defaults until a
% richer telemetry adapter supplies them.
features.tyre_delta_laps = 0;
features.own_deploys_earlier = 0;
features.rival_deploys_earlier = 0;
features.rival_prev_zone = 0.5;
features.rival_gap_ahead_of_them_s = 5.0;
features.rival_soc_MJ = 2.5;
features.zone_length_km = trackParams.activationZoneLength_m/1000;
event = min(max(round(gate.active_event), 1), ...
    numel(trackParams.activationLine_m));
if event < numel(trackParams.activationLine_m)
    features.next_zone_km = max(0, ...
        (trackParams.detectionLine_m(event+1) - ...
        trackParams.activationLine_m(event))/1000);
else
    features.next_zone_km = 6.0;
end
features.is_last_zone = double(event >= numel(trackParams.activationLine_m));
features.lap_phase = clamp(obs.track_position_m / ...
    max(trackParams.lapLength_m, eps), 0, 1);
features.zone_idx = event - 1;
end

function ai = decisionEngine(features, strategyParams)
% Evaluate the production models exported in handover.rar. The policy
% compares the expected pass-probability lift from deployment against the
% handover threshold, while the lap-trial model supplies the longer-horizon
% context used by the score.
model = strategyParams.aiModel;
p00 = zonePassProbability(model.zonePass, features, 0, 0);
p10 = zonePassProbability(model.zonePass, features, 1, 0);
p01 = zonePassProbability(model.zonePass, features, 0, 1);
p11 = zonePassProbability(model.zonePass, features, 1, 1);
cover = rivalCoverProbability(model.rivalCover, features);

pDeploy = (1-cover)*p10 + cover*p11;
pHold = (1-cover)*p00 + cover*p01;
gainUnmatched = p10 - p00;
gainMatched = p11 - p01;
expectedGain = (1-cover)*gainUnmatched + cover*gainMatched;
trialLogit = model.lapTrialPass60.coefficients(:)' * ...
    [1, features.gap_s, features.tyre_delta_laps]';
trialP = clamp(1/(1+exp(-trialLogit)), 0, 1);

ai = struct();
ai.P_success = clamp(pDeploy, 0, 1);
ai.P_no_deploy = clamp(pHold, 0, 1);
ai.P_rival_cover = clamp(cover, 0, 1);
ai.expected_gain = expectedGain;
ai.gain_unmatched = gainUnmatched;
ai.gain_matched = gainMatched;
ai.lap_trial_P_pass60 = trialP;
ai.deploy_recommendation = expectedGain >= ...
    model.deploymentPolicy.tauRecommended;
ai.time_gain_s = max(0, 0.10 + 0.010*max(features.relative_speed_kph, 0) ...
    + 0.35*ai.P_success + 0.08*double(features.straight_flag));
ai.risk = clamp(0.25 + 0.20*double(features.speed_kph > 290) ...
    + 0.18*double(features.braking_zone) ...
    + 0.10*max(features.gap_s - 0.8, 0), 0, 1);
ai.energy_cost_MJ = features.requestedDeployPower_kW * ...
    strategyParams.sampleTime_s/1000;
ai.strategic_value = clamp(0.15 + 0.60*double(features.straight_flag) ...
    + 0.50*ai.P_success - 0.20*double(features.braking_zone), -1, 1);
rawScore = 5.0*(expectedGain - model.deploymentPolicy.tauRecommended) ...
    + 0.25*(ai.lap_trial_P_pass60 - 0.05) ...
    - strategyParams.w_risk*0.15*ai.risk ...
    - strategyParams.w_energyCost*ai.energy_cost_MJ ...
    + strategyParams.w_strategicValue*0.10*ai.strategic_value;
ai.score = clamp(0.50 + rawScore, 0, 1);
end

function probability = zonePassProbability(model, features, ownDeploy, rivalDeploy)
x = [1; features.gap_s; features.tyre_delta_laps; ownDeploy; rivalDeploy; ...
    ownDeploy*(1-rivalDeploy); features.zone_length_km; ...
    min(features.next_zone_km, 6.0); features.is_last_zone; ...
    features.gap_s*ownDeploy];
probability = clamp(1/(1+exp(-(model.coefficients(:)'*x))), 0, 1);
end

function probability = rivalCoverProbability(model, features)
x = [1; features.rival_soc_MJ; features.rival_deploys_earlier; ...
    features.rival_prev_zone; min(features.rival_gap_ahead_of_them_s, 5); ...
    features.gap_s; features.tyre_delta_laps; features.zone_length_km; ...
    features.is_last_zone; features.lap_phase; features.zone_idx];
probability = clamp(1/(1+exp(-(model.coefficients(:)'*x))), 0, 1);
end
function decision = chooseDecision(strategyName, obs, gate, ai, eState, ...
    ersParams, strategyParams)
energyAvailable = eState - ersParams.totalCapacity_MJ*ersParams.socMin ...
    > strategyParams.minimumEnergyMargin_MJ;

switch lower(char(strategyName))
    case 'baseline'
        if gate.DeploymentAllowed && obs.straight_flag && energyAvailable
            decision = 1;
        elseif gate.HarvestAllowed && obs.braking_zone ...
                && obs.brake >= strategyParams.brakingHarvestThreshold
            decision = -1;
        else
            decision = 0;
        end
    case 'trackshift'
        if gate.DeploymentAllowed && ai.deploy_recommendation ...
                && energyAvailable
            decision = 1;
        elseif gate.HarvestAllowed && obs.braking_zone ...
                && obs.brake >= strategyParams.brakingHarvestThreshold
            decision = -1;
        else
            decision = 0;
        end
    case 'hold'
        decision = 0;
    case 'harvest'
        if gate.HarvestAllowed && obs.braking_zone
            decision = -1;
        else
            decision = 0;
        end
    otherwise
        error('Unknown strategy %s.', strategyName);
end
end

function magnitude_kW = requestedMagnitude(decision, strategyParams)
if decision > 0
    magnitude_kW = strategyParams.deployPower_kW;
elseif decision < 0
    magnitude_kW = strategyParams.harvestPower_kW;
else
    magnitude_kW = 0;
end
end

function governor = powerCommandGovernor(requested_kW, ~, gate, eState, ...
    eHigh, eLow, harvested, speed_mps, dt, ersParams, regs2026)
omega = max(1, speed_mps/0.330*3.5);
torquePowerLimit_kW = ersParams.maxTorque_Nm*omega/1000;

governor = struct();
governor.P_physical_limit_kW = max(0, min([ersParams.maxElectricalPower_kW, ...
    torquePowerLimit_kW]));
governor.P_energy_limit_kW = 0;
governor.clipFlag = 0;
governor.constraintViolationFlag = 0;
governor.regulatoryViolationFlag = 0;

if requested_kW > 0
    if ~gate.DeploymentAllowed
        final_kW = 0;
        governor.clipFlag = requested_kW ~= 0;
    else
        lowerEnergy_MJ = max(ersParams.totalCapacity_MJ*ersParams.socMin, ...
            eHigh - regs2026.esSwingLimit_MJ);
        availableEnergy_MJ = max(0, eState - lowerEnergy_MJ);
        energyLimit_kW = availableEnergy_MJ*1000/dt* ...
            ersParams.inverterEfficiency*ersParams.electricalMechanicalEfficiency;
        governor.P_energy_limit_kW = max(0, energyLimit_kW);
        final_kW = min([requested_kW, gate.RegulatoryPowerLimit_kW, ...
            governor.P_physical_limit_kW, ersParams.dischargePowerLimit_kW, ...
            governor.P_energy_limit_kW]);
        governor.clipFlag = final_kW < requested_kW;
    end
elseif requested_kW < 0
    if ~gate.HarvestAllowed
        final_kW = 0;
        governor.clipFlag = true;
    else
        upperEnergy_MJ = min(ersParams.totalCapacity_MJ*ersParams.socMax, ...
            eLow + regs2026.esSwingLimit_MJ);
        availableCharge_MJ = max(0, upperEnergy_MJ - eState);
        energyLimit_kW = availableCharge_MJ*1000/dt / ...
            max(ersParams.inverterEfficiency*ersParams.electricalMechanicalEfficiency, eps);
        rechargeRemaining_MJ = max(0, regs2026.rechargeLimit_MJ - harvested);
        rechargeLimit_kW = rechargeRemaining_MJ*1000/dt / ...
            max(ersParams.inverterEfficiency, eps);
        governor.P_energy_limit_kW = max(0, min(energyLimit_kW, rechargeLimit_kW));
        magnitude_kW = min([abs(requested_kW), ...
            ersParams.maxHarvestElectricalPower_kW, ...
            ersParams.chargePowerLimit_kW, governor.P_physical_limit_kW, ...
            governor.P_energy_limit_kW]);
        final_kW = -magnitude_kW;
        governor.clipFlag = abs(final_kW) < abs(requested_kW);
    end
else
    final_kW = 0;
end

if requested_kW > 0
    governor.regulatoryViolationFlag = requested_kW > gate.RegulatoryPowerLimit_kW;
end
governor.P_final_kW = final_kW;
governor.constraintViolationFlag = abs(final_kW) > ...
    regs2026.absoluteElectricalPowerCap_kW + 1e-9;
end

function ice = iceModel(obs, vehicleParams)
rpm = clamp(obs.engine_rpm, vehicleParams.engineMinRpm, vehicleParams.engineMaxRpm);
baseTorque_Nm = interp1(vehicleParams.engineRpmBreakpoints, ...
    vehicleParams.engineTorqueCurve_Nm, rpm, 'linear', 'extrap');
effectiveThrottle = obs.throttle*(1 - obs.brake);
omegaEngine = rpm*2*pi/60;
fuelFlow_MJph = min(vehicleParams.fuelFlowMax_MJph, ...
    vehicleParams.fuelFlowIntercept_MJph + ...
    vehicleParams.fuelFlowSlope_MJph_per_rpm*rpm);
P_ICE_fuel_kW = fuelFlow_MJph*1000/3600;
P_fuel_limited_shaft_kW = P_ICE_fuel_kW*vehicleParams.eta_ice* ...
    effectiveThrottle;
P_torque_limited_shaft_kW = baseTorque_Nm*effectiveThrottle* ...
    omegaEngine/1000;
ice = struct();
ice.fuelFlow_MJph = fuelFlow_MJph;
ice.P_ICE_fuel_kW = P_ICE_fuel_kW;
ice.P_ICE_shaft_kW = max(0, min(P_fuel_limited_shaft_kW, ...
    P_torque_limited_shaft_kW));
ice.engineTorque_Nm = ice.P_ICE_shaft_kW*1000/max(omegaEngine, 1);
ice.P_ICE_wheel_kW = ice.P_ICE_shaft_kW*vehicleParams.drivetrainEfficiency;
end

function mgu = mguKModel(P_electrical_kW, speed_mps, gear, vehicleParams, ersParams)
omega = max(1, speed_mps/vehicleParams.wheelRadius_m* ...
    vehicleParams.gearRatios(gear)*vehicleParams.finalDriveRatio);
eta = ersParams.electricalMechanicalEfficiency;
if P_electrical_kW >= 0
    P_mechanical_kW = P_electrical_kW*eta;
else
    P_mechanical_kW = P_electrical_kW/max(eta, eps);
end
torque_Nm = clamp(P_mechanical_kW*1000/omega, -ersParams.maxTorque_Nm, ...
    ersParams.maxTorque_Nm);
mgu = struct();
mgu.omega_MGUK_rad_s = omega;
mgu.P_mechanical_wheel_kW = torque_Nm*omega/1000;
mgu.T_MGUK_Nm = torque_Nm;
end

function forces = vehicleDynamics(P_ICE_wheel_kW, P_MGUK_wheel_kW, ...
    speed_mps, gradient_rad, brake, vehicleParams)
v = max(speed_mps, 1.0);
P_wheel_kW = P_ICE_wheel_kW + P_MGUK_wheel_kW;
F_traction_N = P_wheel_kW*1000/v;
F_drag_N = 0.5*vehicleParams.airDensity_kg_m3*vehicleParams.CdA_m2*speed_mps.^2;
F_roll_N = vehicleParams.rollingEquivalentDecel_m_s2*vehicleParams.mass_kg;
F_grade_N = vehicleParams.mass_kg*vehicleParams.gravity_m_s2*sin(gradient_rad);
F_brake_N = clamp(brake, 0, 1)*vehicleParams.maxBrakeForce_N;
F_net_N = F_traction_N - F_drag_N - F_roll_N - F_grade_N - F_brake_N;
acceleration_m_s2 = clamp(F_net_N/vehicleParams.mass_kg, -12, 12);
forces = struct();
forces.P_wheel_kW = P_wheel_kW;
forces.F_traction_N = F_traction_N;
forces.F_drag_N = F_drag_N;
forces.F_roll_N = F_roll_N;
forces.F_grade_N = F_grade_N;
forces.F_brake_N = F_brake_N;
forces.acceleration_m_s2 = acceleration_m_s2;
end

function P_ES_kW = batterySidePower(P_MGUK_electrical_kW, ersParams)
if P_MGUK_electrical_kW >= 0
    P_ES_kW = P_MGUK_electrical_kW/max(ersParams.inverterEfficiency, eps);
else
    P_ES_kW = P_MGUK_electrical_kW*ersParams.inverterEfficiency;
end
end

function [voltage_V, current_A] = batteryElectricalState(P_ES_kW, eState, ersParams)
soc = clamp(eState/ersParams.totalCapacity_MJ, 0, 1);
voc_V = ersParams.nominalVoltage_V*(0.95 + 0.10*soc);
P_W = P_ES_kW*1000;
r = ersParams.internalResistance_Ohm;
discriminant = max(voc_V^2 - 4*r*P_W, 0);
current_A = (voc_V - sqrt(discriminant))/(2*r);
voltage_V = max(50, voc_V - r*current_A);
% Keep the logged power convention exactly consistent with V*I.
current_A = P_W/voltage_V;
end
function lapTime_s = lapTimeFromDistance(distance_m, targetDistance_m, time_s)
idx = find(distance_m >= targetDistance_m, 1, 'first');
if isempty(idx)
    lapTime_s = time_s(end);
elseif idx == 1
    lapTime_s = time_s(1);
else
    d0 = distance_m(idx-1);
    d1 = distance_m(idx);
    alpha = (targetDistance_m-d0)/max(d1-d0, eps);
    lapTime_s = time_s(idx-1) + alpha*(time_s(idx)-time_s(idx-1));
end
end

function count = countSuccessfulOvertakes(log, ~)
active = log.OvertakeActivated > 0;
starts = active & [true; ~active(1:end-1)];
successful = starts & log.AI_deploy_recommendation > 0 ...
    & log.P_success > log.P_no_deploy ...
    & log.relative_speed_ahead_kph > 0;
count = sum(successful);
end

function count = countTransitions(mask)
count = sum(mask & [true; ~mask(1:end-1)]);
end

function validation = runValidation(telemetry, baseline, trackshift, ...
    vehicleParams, ersParams, trackParams, strategyParams, regs2026)
trackForTest = makeSyntheticTrackForValidation(telemetry, trackParams);
holdSim = simulateStrategy('hold', telemetry, trackForTest, vehicleParams, ...
    ersParams, trackParams, strategyParams, regs2026);
harvestSim = simulateStrategy('harvest', telemetry, trackForTest, vehicleParams, ...
    ersParams, trackParams, strategyParams, regs2026);

validation = struct();
validation.baselineSpeedRMSE_kph = baseline.sourceSpeedRMSE_kph;
validation.trackshiftSpeedRMSE_kph = trackshift.sourceSpeedRMSE_kph;
validation.baselineDistanceEndError_m = abs(baseline.log.distance_m(end) - telemetry.distance_m(end));
validation.trackshiftDistanceEndError_m = abs(trackshift.log.distance_m(end) - telemetry.distance_m(end));
validation.trackshiftEnergySwing_MJ = max(trackshift.log.E_ES_MJ) - min(trackshift.log.E_ES_MJ);
validation.trackshiftMaxPower_kW = trackshift.maxMGUKPower_kW;
validation.trackshiftMaxTorque_Nm = trackshift.maxMGUKTorque_Nm;
validation.trackshiftRecharge_MJ = trackshift.energyHarvested_MJ;
validation.trackshiftConstraintViolations = trackshift.constraintViolationCount;
validation.testDecisionZeroPower_kW = max(abs(holdSim.log.P_final_kW));
validation.testDecisionZeroEnergyChange_MJ = abs(holdSim.energyRemaining_MJ - ersParams.initialEnergy_MJ);
harvestGateAvailable = any(~telemetry.race_director_disable & ...
    ~telemetry.safety_car & ~telemetry.low_grip & ...
    ~telemetry.yellow_sector & ~telemetry.track_power_limited & ...
    telemetry.braking_zone & telemetry.brake_0to1 >= ...
    strategyParams.brakingHarvestThreshold);
validation.testHarvestEnergyIncrease_MJ = harvestSim.energyRemaining_MJ - ...
    ersParams.initialEnergy_MJ;
if harvestGateAvailable
    harvestTestPassed = validation.testHarvestEnergyIncrease_MJ >= -1e-9;
else
    harvestTestPassed = validation.testHarvestEnergyIncrease_MJ <= 1e-9;
end
validation.testRegulatoryLimit = all(trackshift.log.P_final_kW <= ...
    trackshift.log.RegulatoryPowerLimit_kW + 1e-9 | trackshift.log.P_final_kW <= 0);
validation.testTorqueLimit = trackshift.maxMGUKTorque_Nm <= ...
    regs2026.maxMechanicalTorque_Nm + 1e-9;
validation.testSwingLimit = validation.trackshiftEnergySwing_MJ <= ...
    regs2026.esSwingLimit_MJ + 1e-9;
validation.testRechargeLimit = trackshift.energyHarvested_MJ <= ...
    regs2026.rechargeLimit_MJ + 1e-9;
validation.testEligibilitySeparation = any(trackshift.log.OvertakeEnabled > ...
    trackshift.log.OvertakeActivated) || all(trackshift.log.OvertakeEnabled == 0);
validation.unitTests = table( ...
    ["Decision equals zero"; "Harvest raises ES energy"; ...
    "Regulatory power is governed"; "MGU-K torque limit"; ...
    "ES swing limit"; "Recharge limit"; "Eligibility waits for activation"], ...
    [validation.testDecisionZeroPower_kW <= 1e-9; ...
    harvestTestPassed; ...
    validation.testRegulatoryLimit; validation.testTorqueLimit; ...
    validation.testSwingLimit; validation.testRechargeLimit; ...
    validation.testEligibilitySeparation], ...
    'VariableNames', {'test','passed'});
end

function track = makeSyntheticTrackForValidation(telemetry, trackParams)
% Recreate the needed gradient channel for unit-test replays.
track = table(telemetry.track_position_m, zeros(height(telemetry), 1), ...
    'VariableNames', {'track_distance_m','gradient_rad'});
track.gradient_rad(:) = trackParams.gradientAmplitude_rad * ...
    sin(2*pi*telemetry.track_position_m/trackParams.lapLength_m);
end

function comparison = compareStrategies(baseline, trackshift, validation)
comparison = struct();
comparison.baselineLapTime_s = baseline.lapTime_s;
comparison.trackshiftLapTime_s = trackshift.lapTime_s;
comparison.lapTimeDelta_s = trackshift.lapTime_s - baseline.lapTime_s;
comparison.timeGain_s = baseline.lapTime_s - trackshift.lapTime_s;
comparison.baselineEnergyUsed_MJ = baseline.energyUsed_MJ;
comparison.trackshiftEnergyUsed_MJ = trackshift.energyUsed_MJ;
comparison.energyDelta_MJ = trackshift.energyUsed_MJ - baseline.energyUsed_MJ;
comparison.baselineEnergyHarvested_MJ = baseline.energyHarvested_MJ;
comparison.trackshiftEnergyHarvested_MJ = trackshift.energyHarvested_MJ;
comparison.baselineSuccessfulOvertakes = baseline.successfulOvertakes;
comparison.trackshiftSuccessfulOvertakes = trackshift.successfulOvertakes;
comparison.successfulOvertakeDelta = trackshift.successfulOvertakes - ...
    baseline.successfulOvertakes;
comparison.baselineViolations = baseline.constraintViolationCount;
comparison.trackshiftViolations = trackshift.constraintViolationCount;
comparison.validationPass = all(validation.unitTests.passed);
end
function fig = plotDashboard(results)
base = results.baseline.log;
ts = results.trackshift.log;
t = ts.time_s;
fig = figure('Name', 'TrackShift Energy Intelligence', 'Color', 'w');
tiledlayout(3, 2, 'TileSpacing', 'compact', 'Padding', 'compact');

nexttile;
plot(t, base.speed_kph, 'Color', [0.50 0.50 0.50], 'LineWidth', 1.0); hold on;
plot(t, ts.speed_kph, 'Color', [0.00 0.35 0.75], 'LineWidth', 1.3);
plot(t, results.inputs.telemetryTable.speed_kph, '--', 'Color', [0.10 0.10 0.10]);
grid on; xlabel('Time (s)'); ylabel('Speed (km/h)');
legend('Baseline', 'TrackShift', 'Source', 'Location', 'best');
title('Speed response');

nexttile;
plot(t, ts.P_final_kW, 'Color', [0.85 0.20 0.10], 'LineWidth', 1.1); hold on;
plot(t, ts.RegulatoryPowerLimit_kW, '--', 'Color', [0.15 0.15 0.15]);
yline(results.parameters.regs2026.absoluteElectricalPowerCap_kW, ':');
grid on; xlabel('Time (s)'); ylabel('MGU-K power (kW)');
legend('Final command', 'Regulatory limit', 'Absolute cap', 'Location', 'best');
title('Governed power');

nexttile;
plot(t, base.E_ES_MJ, 'Color', [0.50 0.50 0.50], 'LineWidth', 1.0); hold on;
plot(t, ts.E_ES_MJ, 'Color', [0.00 0.55 0.25], 'LineWidth', 1.3);
yline(results.parameters.ersParams.initialEnergy_MJ, ':');
grid on; xlabel('Time (s)'); ylabel('ES energy (MJ)');
legend('Baseline', 'TrackShift', 'Initial', 'Location', 'best');
title('Energy Store state');

nexttile;
plot(t, ts.gap_s, 'Color', [0.25 0.25 0.65], 'LineWidth', 1.0); hold on;
yline(results.parameters.trackParams.detectionGap_s, '--');
stairs(t, 0.25 + 0.5*ts.OvertakeActivated, 'Color', [0.85 0.25 0.10]);
grid on; xlabel('Time (s)'); ylabel('Gap / state');
legend('Gap (s)', 'Detection gap', 'Activated', 'Location', 'best');
title('Eligibility context');

nexttile;
plot(t, ts.AI_score, 'Color', [0.60 0.20 0.70], 'LineWidth', 1.1); hold on;
plot(t, ts.P_success, 'Color', [0.10 0.55 0.30], 'LineWidth', 1.1);
yline(results.parameters.strategyParams.deployThreshold, '--');
grid on; xlabel('Time (s)'); ylabel('Score / probability');
legend('AI score', 'P(success)', 'Deploy threshold', 'Location', 'best');
title('Decision engine');

nexttile;
stairs(t, ts.decision_mode, 'Color', [0.05 0.05 0.05], 'LineWidth', 1.2); hold on;
stairs(t, ts.governor_clip_flag, 'Color', [0.90 0.20 0.10]);
ylim([-1.3 1.3]); yticks([-1 0 1]); yticklabels({'HARVEST','HOLD','DEPLOY'});
grid on; xlabel('Time (s)'); ylabel('Mode');
legend('Decision mode', 'Governor clipped', 'Location', 'best');
title('Controller action');

sgtitle(sprintf(['TrackShift: Delta lap time %.3f s | energy delta %.3f MJ | ' ...
    'violations %d'], results.comparison.lapTimeDelta_s, ...
    results.comparison.energyDelta_MJ, results.comparison.trackshiftViolations));
end

function printSummary(results)
c = results.comparison;
v = results.validation;
fprintf('\nTrackShift end-to-end run complete\n');
fprintf('  Baseline lap time:   %.3f s\n', c.baselineLapTime_s);
fprintf('  TrackShift lap time: %.3f s\n', c.trackshiftLapTime_s);
fprintf('  Lap-time delta:      %.3f s\n', c.lapTimeDelta_s);
fprintf('  Energy delta:        %.3f MJ\n', c.energyDelta_MJ);
fprintf('  Successful overtakes baseline/TrackShift: %d / %d\n', ...
    c.baselineSuccessfulOvertakes, c.trackshiftSuccessfulOvertakes);
fprintf('  Peak MGU-K power:     %.3f kW\n', v.trackshiftMaxPower_kW);
fprintf('  Peak MGU-K torque:    %.3f Nm\n', v.trackshiftMaxTorque_Nm);
fprintf('  Constraint violations: %d\n', c.trackshiftViolations);
fprintf('  Validation tests:     %d/%d passed\n', ...
    sum(results.validation.unitTests.passed), height(results.validation.unitTests));
end

function y = clamp(x, lo, hi)
y = min(max(x, lo), hi);
end
