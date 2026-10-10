# Model and scheduling notes

## Initial conditions

The two curve endpoints represent daily required heating hours under a room design
temperature. They seed a loss coefficient `k = 0.007 per hour`, a full-heating gain
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
reduces effective losses in planning; fireplace observations do not train the model.

The lag is configured, not identified. The delayed response is a proxy for stored
heat and cannot identify slab energy uniquely from room temperature alone.

## Learning

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
winter target minus setback. Boost is capped by the user maximum. Every candidate
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

Source values are converted to cents/kWh. If required, VAT is added to the source
energy price. Configured grid charges and retail margin are then added. Grid
charges are user-entered gross values; VAT is not added to them again.

Hourly mode averages input prices internally to hourly intervals. Quarter-hour
and flexible modes both use 15-minute intervals; only flexible mode applies the
configurable minimum run length. No raw quarter-hour information can be recovered
from an already averaged hourly source.

UTC timestamps are used internally, with HA local time selecting the tariff.
Monthly fixed charges are informational and excluded from scheduling objectives.
