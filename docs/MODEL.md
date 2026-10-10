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
winter target minus setback. Boost and setback are shared settings applied to
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
