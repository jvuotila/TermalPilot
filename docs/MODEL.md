# Model and scheduling notes

## Initial conditions

The two curve endpoints represent daily required heating hours under a room design
temperature (taken from the room target). The outdoor endpoints, response lag
and reference water temperature are shared across rooms. They seed a loss coefficient `k = 0.007 per hour`, a full-heating gain
`g`, and a non-negative constant background gain `b`:

```
g = 24 * k * (outdoor_warm - outdoor_cold) / (hours_max - hours_min)
b = k * (design_room_temperature - outdoor_warm) - g * hours_min / 24
```

Negative `b` is clipped. Equal endpoint hours use a cold-point fallback. These are
initial assumptions, not observed thermal parameters. With consistent curve points,
the equilibrium heating duty matches both endpoints. The configured minimum curve
hours are an initial model anchor, not a hard daily schedule quota after learning.

## Delayed heating response

Actual heating activity is filtered with an exponential lag `tau`:

```
r_next = u + (r - u) * exp(-dt/tau)
r_mean = u + (r - u) * tau * (1-exp(-dt/tau)) / dt
T_next = T + dt * (k * (T_out - T) + g * water_factor * r_mean + b)
```

`u` is observed heating demand during learning and estimated demand under the
proposed setpoint during planning. When simulated temperature falls below a reduced
setpoint, the planner includes estimated baseline demand too: lowering a setpoint
is not equivalent to forcibly disabling a heating circuit.

The optional water factor scales gain relative to the difference between supply
water and room temperature, bounded 0.25–2. Fireplace compensation temporarily
reduces effective losses in planning: compensation ranges from -100% to 0%,
where -20% multiplies estimated loss by 0.8. Fireplace observations do not train the model.

The lag is configured, not identified. The delayed response is a proxy for stored
heat and cannot identify slab energy uniquely from room temperature alone.

## Learning

New rooms use internal starting estimates corresponding to 4 heating hours per day
at the configured warm outdoor point and 13 hours at the cold point. These are
model seeds, not daily limits, and are not exposed as room settings. Valid heating
and cooling observations begin accumulating immediately while learning and
collection are enabled.

Finite temperature changes over 3–30 minute intervals are regressed against the
outdoor/indoor temperature difference and delayed observed activity. Recursive
sums retain a forgetting factor and ridge regularization toward initial estimates.
After at least 12 hours of observed heating and 12 hours of idle evidence, physically
bounded gain/loss estimates are blended slowly into the current coefficients.

Abrupt changes exceeding 2 C/hour are excluded. Missing activity, large sampling
gaps and fireplace periods do not update coefficients. Short-term MAE is tracked
separately from parameter updates. Initial samples do not establish a calibrated
confidence interval; there is no claim of statistically validated predictive accuracy.

## Planner

The rolling horizon searches two setpoint choices: winter target plus boost, or
winter target plus the negative idle adjustment. Boost and setback are shared settings applied to
every room. Boost is capped by the user maximum. Every candidate
propagates temperature and delayed heating response.

Ranking first minimizes temperature-bound violations in degree-hours, then a
normalized price objective plus small switching/deviation penalties. A bounded
beam retains up to 80 different thermal/runtime states per slot. Minimum run
constraints prevent a new flexible heating run ending before its configured
length. Previously suggested runtime is carried across replanning within a session.
The last known price horizon includes an estimated no-heating reserve penalty.

This heuristic can miss the globally optimal schedule and does not coordinate
shared hydraulic capacity between rooms. Monetary terms assume normalized one-kW
input; they are for relative scheduling, not billing or savings measurement.

## Pricing

Source lists must already contain final electricity prices including VAT, grid
charges, electricity tax and retailer margin. Values are converted to cents/kWh
without adding any further charges.

Hourly mode averages input prices internally to hourly intervals. Quarter-hour
and flexible modes both use 15-minute intervals; only flexible mode applies the
configurable minimum run length. No raw quarter-hour information can be recovered
from an already averaged hourly source.

UTC timestamps are used internally; the source is responsible for applying local tariffs.
Monthly fixed charges are omitted because they do not change with heating schedules.

## Thermostat command timing

Shared offsets advance the raise/lower target commands relative to intended
heat-delivery sessions. Adjacent heating slots are merged, and overlapping
boosted-target intervals are combined to avoid contradictory commands.
Thermostat-state publications at command boundaries do not rerun learning or
operate devices. Price/temperature trajectories still model intended heat
delivery, rather than a measured hydraulic/pump response to each command.

## Room comfort priority

Candidate schedules rank safety-limit violations first, integrated temperature
shortfall below the individual room target second, and price/deviation/switching
cost third. Terminal reserve protects both the minimum and room target. Idle
setpoints are clamped to the minimum in demand calculations and thermostat timing.
At or below the minimum, a boosted session is required even during expensive
prices; emergency recovery can override minimum run length near horizon expiry.
The target is not a hard feasibility constraint: below-target recovery can occur
when the room starts cold or capacity is insufficient. Reported safety risk still
refers to the shared absolute minimum/maximum limits.

## Three control states

Beam states carry Normal/Reduced/Boost modes. Only Boost is a planned heat-storage
session and is subject to the flexible minimum run. Reduced is eligible after a
planned Boost with remaining model response, a next-slot prediction at or above
room target, and above-median confirmed price. A boost must return to Normal
first. Eligibility can continue across Normal while residual warmth remains; it
ends when the model response dissipates or the comfort forecast no longer supports it. Demand is calculated from
the selected mode's setpoint. Comfort shortfall remains ahead of the price objective.
Thermostat timing applies advance boost windows, their chosen post-window state,
and explicit normal restoration commands; an overlapping boost takes precedence.
No fixed post-heating duration or calibrated physical slab-capacity claim is made.

## Optional wind correction

Valid local wind observations are smoothed over 30 minutes and normalized to m/s.
The learned loss coefficient is `loss + wind_loss * (min(wind, 20) - 3)`,
bounded to 0.001–0.05 per hour. The shared reference is 3 m/s; missing wind
uses ordinary `loss`, rather than assuming calm weather. Room heat-retention
comparisons use this same ordinary reference coefficient.

A regularized three-feature fit separates outdoor temperature difference,
heating response and the wind interaction. Wind fitting requires at least 24
hours of valid observations, 12 heating hours, 12 idle hours and wind variance
of at least 1 (m/s)². The nonnegative wind coefficient is limited to `loss / 6`
and accepted fits are blended slowly. This is an empirical room-response
estimate; appliances, ventilation and other unmeasured gains can confound it.

Both update/report timestamps, when present, must be within two hours. Invalid
values, unsupported units and speeds outside 0–60 m/s clear smoothing and are
ignored. Unchanged calm readings may therefore also be ignored. Missing wind
never blocks essential-source readiness, planning, base learning or thermostat
control. Changing the wind entity resets only the wind fit and observation
continuity, preserving accumulated heating/idle data and the baseline model.

Forecast wind gradually returns to 3 m/s with a three-hour exponential time
constant; local gusts are not projected unchanged through the entire horizon.
Archived forecast comparisons distinguish changes in the configured wind source.
