# Settings and operating guide

Use the info buttons beside settings for explanations and supported choices.
This guide covers the decisions that affect installation and operation.

## Sources and room setup

Choose entities from your own Home Assistant installation; none are preselected.

| Input | Use |
| --- | --- |
| Electricity prices | Required for tariff scheduling; use a source with complete price lists and the correct unit |
| Outdoor temperature | Current outdoor measurement for planning and learning |
| Room temperature | One measured temperature source for each room |
| Thermostat | Each room’s primary controller, including rooms linked to secondary zones |
| Actual heating activity | Thermostat `hvac_action`, or an optional relay sensor if that better represents heating demand |
| Weather forecast | Optional; missing forecasts hold outdoor temperature constant and show a warning |
| Heating water | Optional for water distribution; reads measured temperature, not the thermostat target |
| Wind speed | Optional local sensor; unavailable readings do not stop heating |

A thermostat target alone does not establish actual heating. A relay indicates
heating demand, not guaranteed heat flow. Check that activity readings reflect
how your installation works before judging learned behavior.

Price lists should already include VAT, retailer margin, grid charges and taxes
that vary with consumption. ThermalPilot does not add these costs. Timestamped
`raw_today`/`raw_tomorrow` lists are preferred; regular-day numeric
`today`/`tomorrow` lists also work. List-only sources cannot safely represent
23- or 25-hour daylight-saving days.

## House and comfort settings

Select the heat source, distribution and construction under **Rooms and zones**.
Water floor/radiator systems support valve timing and optional water-temperature
adjustment. Electric and warm-air distribution use observed demand without water
adjustment or valve offsets. Mixed systems currently retain water requirements;
per-room distribution overrides are not supported.

Set each room’s normal target and the shared minimum/maximum allowed temperatures.
Boost, temporary reduction and response-lag settings affect the plan. Their
starting values are estimates, not measurements of your building. Construction
choices provide an approximate comparison and starting prior; they do not erase
learned parameters.

Electric heat sources can use tariff optimization. Gas, oil, wood/pellet and
district heating currently provide observation and learning without fuel-cost
scheduling or primary thermostat control. Independent electric garages and zones
can still use their own controllers.

## Control and fallback

**Simulation** leaves existing heating controls in charge. To keep it entirely
observational, leave **Apply season setpoints** disabled too. That optional setting
can send real targets when switching Active/Passive even while simulation is on.

**Live control** requires turning off simulation, saving and explicitly confirming.
Stop conflicting automations first. Ordinary rooms receive thermostat temperature
targets; ThermalPilot does not operate their relay switches directly.

**Active** enables planning, collection and learning. **Passive** stops them and
preserves learned state. Leaving live control, becoming Passive, losing essential
inputs or reaching an expired plan releases affected thermostats to seasonal
fallback targets:

- Summer: the shared summer setpoint, initially 10°C.
- Winter: each room’s normal target.

15 May–30 September is summer. Outside those dates, a complete day’s minimum
forecast temperature at or above the configured summer threshold also selects
summer. The initial threshold is 6°C. Incomplete daily evidence selects winter
outside the calendar summer period.

Pump rooms, garages and zones have additional mode-specific standby behavior;
check their settings before enabling control. Failed writes are reported and
retried. State confirmation relies on what Home Assistant reports and does not
prove that hardware delivered heat.

## Secondary heating zones

A heating zone links configured rooms to an additional air-to-air heat pump or
observed fireplace. It does not replace their primary heating system. Each room
keeps its own thermostat, relay, plan and learned primary model.

New pump zones start with **Control zone heat pump** off. Enable that switch and
global live control to permit commands. Choose heating-only, cooling-only or
seasonal use, the room-temperature policy and the heating strategy. A cooling-only
zone with its pump off does not disable winter floor heating.

The zone has a separate controller and plan. Adding/removing membership preserves
primary learning. Samples affected by active secondary heating/cooling are excluded
from primary model fitting so that floor heating is not credited with pump output.
The former zone-override behavior is migrated using retained models; already
lost learning cannot be reconstructed.

## Garages

Enable **Garage** on a room to configure independent pump control. Initial values
are a 5°C lower limit, 9°C upper limit and 16°C pump device setpoint. The room sensor
controls the lower-to-upper cycle; the device setpoint is a separate command.
House floor-heating limits, water adjustment and summer targets do not apply.

**Temperature limits only** needs no price source. Optional tariff optimization
can schedule earlier heating inside the garage band; missing prices fall back to
temperature cycling. Cold standby uses fan-only; outdoor temperatures above the
lower limit allow the pump to turn off.

Optional door sensors pause heating after the shared open-door delay; presence
sensors select a quieter fan mode. Fan and swing choices must be supported by the
pump. **Leave unchanged** sends no command for that setting. Garage control
requires Heat, Fan-only and Off support.

## Learning and interpreting charts

Initial collection needs at least 12 accepted heating hours and 12 idle hours.
Reaching 100% does not establish accuracy or enable control. Coverage badges also
consider time and observations; they are not readiness ratings.

Saved one-, three- and six-hour forecasts are compared with later measurements.
Compare them with simply predicting no temperature change, and inspect the
comparisons where actual heating matched the forecast. Stable indoor temperatures
alone do not validate heating capacity or timing. Useful validation can take
weeks or months, particularly in mild weather.

Plan shows hourly weather above electricity prices on the same time axis when
your selected weather source supports hourly forecasts. The default view fits
the available width; choose **Every hour (scroll)** for all hourly details.
Missing forecast periods stay empty.

Plan/History chart explanations are under **About this chart**. Click or tap bars
for timing and price details. Missing observation/price periods stay empty.

Heat retention compares modeled cooling at 20°C indoors and −10°C outdoors,
without heating or background gains. Lower six-hour loss and longer time per
1°C drop mean slower modeled cooling. These combine heat leakage and thermal
mass; they are not energy-efficiency grades or safe heating-off durations.

Wind and window-direction settings allow additional learned corrections. They
start without assumed benefits and require relevant observations. Missing optional
inputs do not become essential control requirements. Wind, sunlight, ventilation,
sensor location and unmeasured heat sources can still affect predictions.

## Sensor warnings and stored data

An unchanged/unavailable room temperature can produce a warning after the selected
interval, initially eight hours. Stable temperatures may also trigger it; this is
a possible problem, not proof of sensor failure.

Observations are stored locally in
`.storage/thermal_pilot.<config_entry_id>.sqlite3`; no external database is needed.
Raw observations are retained for up to 30 days. Season compaction preserves
models and aggregate statistics, with a shorter recent raw-history window.
Expired raw timelines cannot be reconstructed from season summaries. Home
Assistant Recorder has its own separate retention policy.

Changing a room’s sensor/controller mapping or response assumptions can require
learning to restart. Review the named-room warning before confirming such changes.
Keep Home Assistant backups, including its storage files.

For equations and planner limitations, see [Model assumptions](MODEL.md).
