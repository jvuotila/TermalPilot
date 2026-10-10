# ThermalPilot

Version **0.1.16 — experimental simulation-first Home Assistant custom integration**.

The panel uses a compact responsive layout: shared settings sit side by side on
wide screens, with Rooms matching the width of either shared-settings container.
Plan and History show two room cards per row. Wrapped setting
labels share aligned input rows, and dropdown arrows are inset from the border.
Shared settings use four equal columns and wrap additional fields onto the next
row; narrower screens use fewer columns. Plan and History have tinted headings,
chart surfaces and shaded tables, with subtle shadows and stronger borders.
Room rows alternate teal and blue backgrounds. Failed forecast requests show their
underlying errors and retry after five minutes; successful forecasts are cached
for an hour.
Room accordions start open and remember their state during the panel session.
Simulation status is split into labeled blocks. Empty timing tables show a clear
message and are separated from each other. Smaller screens retain a single-column
room-card layout.

ThermalPilot is developed for my own home, using a **Panasonic Aquarea T-CAP heat pump**
with hydronic underfloor heating and a concrete slab. I am sharing it for anyone
interested, but I cannot promise that it will be useful or suitable for other users
or heating systems.

ThermalPilot proposes room-by-room heating schedules using electricity prices,
weather forecasts and observed thermal response. It is designed initially for
slow hydronic underfloor heating with a concrete slab. It is not yet a production
controller for arbitrary heating systems.

ThermalPilot is installed through HACS as a custom integration. Its Home Assistant
manifest uses `integration_type: service`, representing one heating-planning
service per configuration entry. This classification follows the
[Home Assistant manifest documentation](https://developers.home-assistant.io/docs/creating_integration_manifest/#integration-type).

## What this version includes

- A dedicated **ThermalPilot** sidebar panel with **Plan**, **History**
  and **Settings** pages, in English.
- Room names, thermostats, temperature sensors and actual heating-activity sources.
- Automatic detection of source price intervals: timestamped rows are preferred;
  plain lists use 24 hourly or 96 quarter-hour prices per regular day.
- Internal hourly averaging of quarter-hour prices.
- Hourly, quarter-hour and flexible-run planning. Flexible runs start/end on
  quarter-hour boundaries and have a configurable minimum length, default 60 minutes.
  Runs can last 75, 90, 105 minutes, etc.; they are not rounded to whole hours.
- Final-price sensor input including all variable electricity costs.
  Grid charges may include electricity tax.
- Rolling planning across midnight, including bridging heating before predicted
  cooling and a terminal reserve beyond the end of published prices.
- Per-room target and comfort limits, with a separate **Shared room settings**
  section for boost/reduction, thermal lag, curve endpoints and supply water.
- Conservative online adaptation using actual heating activity and temperature changes.
- Five-minute SQLite observation history and native HA suggested-heating
  binary sensors and suggested-setpoint/forecast/error sensors.
- One Active/Passive master switch for planning, collection and learning.
- Active/Passive collection, full-season accumulators, compact
  season archives and retained learned parameters for the following season.
- A **shared summer setpoint**, default 10 C, and optional actual season setpoint
  application. Scheduled heating decisions always remain simulated in version 0.1.

Rooms are displayed alphabetically by name in Settings, Plan and History.
Unnamed new rooms appear last; sorting preserves each room's identity and data.

A supply-water source is required. If its reading is missing, planning and room
learning pause until it recovers. The source accepts temperature sensors or climate entities with a
`current_temperature` attribute, including `climate.panasonic_heat_pump_main_z1_temp`.
This reads measured water temperature, not the climate target. A fixed internal
32 °C reference calibrates the model and never commands the heat pump. Starting heating-hour
estimates are internal model seeds. Each room has a target temperature; minimum
and maximum allowed temperatures are shared across the house. Learning collects
valid observations automatically while active collection is enabled.

A shared **Enable simulation for all rooms** toggle controls suggested plans for
every room. Disabling it does not enable live heating schedules. Observation and
learning continue while ThermalPilot is Active.

Room settings use two columns of collapsible cards, with two columns of fields
inside each card on wider screens. Boolean settings use keyboard-accessible toggles.
Trash and learning-reset icons require confirmation. Editing clears the preceding
save message; successful saves show a fresh timestamp in a bottom notification that disappears
after five seconds. Settings sections use distinct subtle background colors.
Fireplace heating compensation uses -100% to 0%; -20% reduces estimated heat
loss by 20% while the fireplace is active. Existing positive compensation
values are converted when loading settings to preserve their effect.

Planning automatically covers all continuously available price intervals from
now until the published prices end. There is no configurable planning horizon,
and missing future prices are not invented.

Weather forecasts are selected automatically: hourly first, then twice daily,
then daily, depending on usable data from the selected weather source.
Forecasts refresh hourly; changing the source refreshes immediately.

## Room sensor checks

While Active, ThermalPilot checks whether each room's temperature reading has
changed. After six hours of unchanged or unavailable readings, one persistent
Home Assistant notification lists the suspect rooms. Stable room temperatures
can produce this warning too; it identifies a possible issue rather than a
confirmed sensor failure. A changed reading resets the timer.

Notifications are limited to once per local calendar day, including across
restarts. Passive mode resets observation timers; monitoring resumes on activation.
A monitoring gap longer than 30 minutes also restarts the six-hour observation
period. The notification ID is reused so unresolved alerts do not accumulate.

## Native Home Assistant heating timelines

Each room on History has a native Home Assistant history-graph card comparing
its recorded suggested-heating window with the selected thermostat relay.
Without a relay selection, a ThermalPilot binary sensor publishes observed
thermostat demand at the observation interval. The relay's own entity provides
its directly recorded state transitions. Entity registry lookup supports renamed
suggestion entities without guessing their IDs.

These graphs use Home Assistant Recorder history rather than ThermalPilot's
SQLite retention. Both entities must be recorded; excluded entities and periods
before installation have no recorded history. If dashboard card helpers have not
loaded, open a Home Assistant dashboard once and return, or use the provided full
History link. Future suggested sessions remain on Plan; these timelines show
previously published suggestions and observed demand.

## Reading room history

Room charts have a legend: blue is measured temperature; the dashed orange line
is the model prediction using actual heating demand. This checks short-term model
accuracy, not the simulated outcome of the suggested schedule. Both lines are
included in the temperature-axis scale. Short views use quarter-hour time labels.

History tables show the latest observation in each 15-minute interval. Suggested
heating-window On/Off describes the proposed boosted-target window; actual
thermostat-demand On/Off describes the observed relay or thermostat request. These
can differ, and neither proves heat flow. Missing observations show Unknown.
The suggested thermostat target is the proposed setpoint, not a room-temperature
forecast. Original observations retain their resolution in the local database.

## Entity selection

Temperature fields show temperature sensors, including template sensors with
temperature units and no device class. Electrical power fields show power sensors
in W/kW rather than energy counters. Price sources must expose `today`, `tomorrow`,
`raw_today` or `raw_tomorrow` list attributes. Thermostat relay selectors accept only switch entities with on/off states.
An empty relay source falls back to the thermostat hvac_action attribute.
Weather and thermostat fields are restricted to their respective entity domains.

Already configured sources remain visible if unavailable or no longer matching
the filter, with an explanatory label. They are never silently cleared.

## Thermostat timing offsets

Under **Shared room settings**, configure how many minutes before a heating
session the thermostat target should rise and how many minutes before its end
it should fall. Defaults are 5 minutes before start and 10 minutes before stop.
For a 22:00–23:00 session, the suggested target rises at 21:55 and falls at 22:50.
Both offsets accept whole minutes from 0 to 30, including values outside the
15-minute price boundaries. Consecutive heating slots form one session.

The Plan page shows intended heating periods and the offset-adjusted thermostat
commands separately. Suggested-state entities update at command boundaries
without waiting for the next five-minute planning/learning cycle. These are
simulation outputs: scheduled thermostat commands are not physically executed.
The temperature forecast assumes intended heat-delivery periods; advance timing
is not a measured model of valve travel or pump shutdown and cannot guarantee
that all energy use stops before a higher tariff.

## Important operating distinction

**Default: simulation only.** No physical thermostat or heat-pump commands are sent.
Your existing heating automation continues controlling the building.

The optional **Apply Active/Passive season setpoints to real thermostats** setting
has a narrow physical effect:

- Effective Passive: set configured rooms' thermostats to the shared summer setpoint.
- Effective Active: set each room's thermostat to its configured target temperature.
- Commands are issued on a target/mode change, not repeatedly to overwrite an
  existing automation's heating boost. Failed commands are retried and reported.
- Thermostat on/off mode is not changed. The pump is never commanded.
- Planning output is never used to operate the thermostats in this release.

Keep this setting disabled while conducting a completely read-only shadow trial.
The panel visibly identifies when physical season-setpoint application is enabled.

## Installation through HACS

1. Open HACS and its **Custom repositories** dialog.
2. Add `https://github.com/jvuotila/ThermalPilot` with category **Integration**.
3. Find **ThermalPilot** in HACS and download it.
4. Restart Home Assistant.
5. Go to **Settings > Devices & services > Add integration > ThermalPilot**.
6. Select the price and outdoor-temperature sources, then configure rooms and
   all other settings in the **ThermalPilot** sidebar panel.

This is a Home Assistant custom integration distributed through HACS.
It does not require creating a Home Assistant helper to install it.

## Alternative: local package

1. Unzip the distribution.
2. Copy `custom_components/thermal_pilot` into your Home Assistant configuration
   directory's `custom_components` directory.
3. Restart Home Assistant.
4. Go to **Settings > Devices & services > Add integration > ThermalPilot**.
5. Select the price sensor and outdoor-temperature sensor.
6. Open **ThermalPilot** in the sidebar, then **Settings**.
7. Configure all sources, price handling and rooms, and save.

If the integration does not appear after a restart, inspect Home Assistant's logs
and reload the browser. This package has not been run against your HA installation.
The local test environment does not contain the full Home Assistant runtime.

## Publication and validation

The repository layout and `hacs.json` are included. HACS custom integrations are
installed from a GitHub repository, not directly from this local ZIP file.

Before publication:

1. Run HACS validation and Home Assistant hassfest against
   [jvuotila/ThermalPilot](https://github.com/jvuotila/ThermalPilot).
2. Complete integration tests in an actual Home Assistant environment.
3. Publish a GitHub release after these checks pass.

The repository metadata is configured for `jvuotila/ThermalPilot`.
Listing in the HACS default catalog requires a separate submission.

## Upgrading from the original TermalPilot prototype

Version 0.1.1 corrects the integration name and domain to `thermal_pilot`.
If you already installed the prototype using the `termal_pilot` domain, this
is a replacement installation, not an automatic domain migration:

1. Back up your Home Assistant configuration and record your room/settings values.
   Export observation history from the old panel if you want to retain it.
2. Remove the old TermalPilot integration under **Settings > Devices & services**.
3. Remove `custom_components/termal_pilot` and install
   `custom_components/thermal_pilot` through HACS or the local package.
4. Restart Home Assistant, add **ThermalPilot**, and configure the sources and rooms.
5. Update dashboards/automations that referenced the old simulation entities.

The old learned models and SQLite history are not automatically imported into
the new configuration entry. The new installation starts in simulation mode
with physical season setpoint application disabled. Existing heating automations
continue to run independently. No migration is needed for a fresh installation.

## Suggested settings for the supplied system

Use `sensor.nordpool` directly, rather than your already averaged sensor, to allow
flexible quarter-hour planning. Source prices must be numeric lists or timestamped
`raw_today` / `raw_tomorrow` records with `start`, `end`, `value`.

| Setting | Starting value |
| --- | --- |
| Source format | quarterly |
| Source unit | c/kWh (verify the source) |
| Scheduling mode | flexible |
| Minimum flexible run | 60 minutes |
| Outdoor sensor | `sensor.outdoor_lowest_temperature` |
| Forecast source | `weather.forecast_koti` |
| Shared summer setpoint | 10 C |
| Actual season setpoint application | disabled for the first shadow trial |

Select a price source whose lists already include VAT, day/night grid charges,
electricity tax and retailer margin. ThermalPilot adds no further costs; both the
current and future price lists must contain final prices.

Set each room's target temperature and shared comfort bounds. All rooms use internal
starting estimates; actual heating and cooling observations refine their models.
Boost and idle adjustment can initially remain +1.5 °C and -1 °C. A three-hour thermal response lag
is an initial estimate; it is configurable and is not automatically learned in v0.1.

Actual heating activity defaults to the selected thermostat's `hvac_action`.
If that attribute is unavailable or does not indicate actual valve demand, choose
a thermostat relay switch instead (on means active). No learning is inferred from a
setpoint alone. Separate valve activity indicates demand, not guaranteed heat flow.

Names and room UUIDs are independent of entity IDs. Removing a room leaves its
historical archive intact. Changes to temperature/activity mapping, lag, curve or
water-reference assumptions reset that room's live learned coefficients.

## Active/Passive and collection

The integration exposes a native HA switch, **ThermalPilot active**.
The same setting can be changed from Plan or Settings.

Use ThermalPilot's own Active/Passive switch to start or end the heating season.

Passive mode stops planning, collection and learning. It preserves learned models
and automatically archives the ending season. On reactivation, existing learned
coefficients remain the starting point; transient slab response is reinitialized.

Collection and learning automatically follow Active/Passive. Missing outdoor
temperature prevents valid observations; there are no automatic season thresholds
or external activation helpers. The planning reserve is an internal six-hour
default, and compaction retains seven days of recent raw observations.

## Data and season compaction

Observations are stored locally at:

`.storage/thermal_pilot.<config_entry_id>.sqlite3`

Model state is stored with HA Store under the same integration/entry namespace.
No external database or cloud service is required.

- At most one stored observation per room per five-minute bucket.
- Raw observation retention: a fixed internal 30-day limit.
- Seasonal accumulators cover all collected samples, including samples whose raw
  rows have already expired. They retain sums, counts, temperature variation,
  observed activity counts, outdoor range and short-term forecast-error statistics.
- On effective Active-to-Passive transition, or optional outdoor-season end,
  compaction archives per-room parameters, recursive-regression sufficient
  statistics, mapping fingerprints and full-season aggregates.
- After compaction, default raw retention is seven recent days; configurable 0–30.
- SQLite `VACUUM` reclaims unused file space at compaction. Routine retention deletes
  reuse pages and do not force expensive daily compaction.
- The archived history is summarized, not a reversible compression of raw samples.
  Full five-minute timelines cannot be reconstructed once expired/compacted.
- Normal next-season startup uses the retained live model state. Archive snapshots
  are also retained for inspection; there is no archive rollback/import UI yet.

A synthetic 10-room, 30-day run stored **86,400 samples in 33,378,304 bytes
(31.83 MiB)**. Keeping only ten model/season archives reduced the test database to
**49,152 bytes (48 KiB)**. Actual size depends on room count and field lengths.
That is roughly 1.06 MiB/day for ten rooms while collecting. The Settings and Plan
pages expose current collection state and Plan shows database size/sample count.
HA Recorder separately stores the integration's entities according to your Recorder
retention policy; these figures cover the integration's SQLite history only.

## Model and planner limitations

See [MODEL.md](docs/MODEL.md) for the equations and assumptions.

- This is an approximate beam-search planner, not a proof of a globally least-cost
  schedule. Each room is planned independently; shared pump capacity, minimum flow,
  compressor cycling, DHW priority and detailed hydraulic coupling are not optimized.
- The model starts from your curve endpoints plus a conservative default heat-loss
  coefficient. A first-order delayed heating response approximates the slab; it is
  not a measured slab temperature or an exact physical energy balance.
- Gain/loss adaptation requires actual activity, bounded time intervals and both
  heating/idle evidence. Fireplace periods are excluded from parameter learning.
- There is no learned lag, automatic heating-system identification or reinforcement
  learning. New heating types need model validation and appropriate assumptions.
- Future water temperature is held at the currently measured/reference value.
  Missing forecast holds outdoor temperature constant and displays a warning.
- Published prices are used only within a continuous known horizon. The model
  estimates a terminal reserve; it does not invent tomorrow's unknown prices.
- Timestamped raw prices support DST. List-only input is rejected on 23/25-hour days
  instead of silently using the wrong tariff or hour.
- Planning cost is normalized to one kW per room. Standing charges do not affect
  scheduling. There is no validated euro savings estimate or room energy metering.
- A shadow simulation cannot measure what would have happened under commands never
  issued. Short-term prediction error uses the actual observed heating activity.

## Development and validation

```sh
python -m unittest discover -s tests -v
python -m compileall -q custom_components
node --check custom_components/thermal_pilot/frontend/panel.js
node tests/test_panel.cjs
```

Tests cover pricing/VAT/tariffs, negative prices, DST, gaps, flexible-run minimums,
a long cross-day gap, learning evidence, retention, seasonal compaction, passive
mode, optional season commands and failed-command retries. HA adapter tests use
minimal doubles; they do **not** replace full HA integration tests.

`PREVIEW.html` is an offline sample interface with invented data and mock storage.
It is not connected to Home Assistant. Open it locally to inspect the UI. The panel
JavaScript has been syntax checked and template tested, but visual rendering and
installation in a full HA runtime have not been verified in this environment.

Background references:

- [HA config flows](https://developers.home-assistant.io/docs/core/integration/config_flow/)
- [HA custom panel source](https://github.com/home-assistant/core/blob/2026.10.0/homeassistant/components/panel_custom/__init__.py)
- [HACS integration packaging](https://www.hacs.dev/docs/publish/integration/)
- [HeishaMon topics](https://github.com/heishamon/HeishaMon/blob/main/MQTT-Topics.md)

MIT licensed.
