# ThermalPilot

Version **0.1.38 — experimental simulation-first Home Assistant custom integration**.

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
Room accordions start closed and remember their state during the panel session.
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

A shared **Enable simulation** toggle selects simulated or real scheduled control
for every room. Disabling it and confirming activates thermostat target control.
Disable your existing heating automation manually first. Observation and learning
continue in both modes while ThermalPilot is Active. Initial-data percentages
do not prove model reliability and do not automatically activate control.

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
changed. After the configured unchanged temperature interval (default six hours) of unchanged or unavailable readings, one persistent
Home Assistant notification lists the suspect rooms. Stable room temperatures
can produce this warning too; it identifies a possible issue rather than a
confirmed sensor failure. A changed reading resets the timer.

Notifications are limited to once per local calendar day, including across
restarts. Passive mode resets observation timers; monitoring resumes on activation.
A monitoring gap longer than 30 minutes also restarts the sensor-warning observation
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
is the selected saved 1-, 3- or 6-hour forecast under the proposed heating plan.
Actual heating differences are reported separately in the accuracy cards. Both lines are
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
15-minute price boundaries. Consecutive heating slots form one session. Once a
published session reaches its advance valve-opening time, subsequent calculations
retain that session through its planned delivery end. Its original start time is
preserved so valve offsets are not reapplied to the clipped remaining period.
This continuity applies while the integration runs with valid inputs; disabling
operation, changing settings, missing required inputs, or restarting can interrupt it.
A restart recomputes the current plan from available inputs rather than replaying old commands.
While Home Assistant is offline, ThermalPilot cannot send commands; thermostats
normally retain their last target and continue their own local regulation.
On startup, confirmed live control sends each available thermostat its newly
calculated current target once, even if Home Assistant's restored target attribute
already matches. Missed commands are not replayed. If essential sources have not
returned, seasonal comfort fallback targets are used instead. Source recovery
triggers a new calculation, normally after a five-second debounce; unavailable
thermostats are retried when they return and on regular updates. Downtime is not
counted as observed heating or cooling, and estimated slab response is reset.

The Plan page shows intended heating periods and the offset-adjusted thermostat
commands separately. Suggested-state entities update at command boundaries
without waiting for the next five-minute planning/learning cycle. In simulation
mode these outputs do not operate thermostats. In confirmed live mode the same
boundaries apply the thermostat targets, including the shared valve timing offsets.
The temperature forecast assumes intended heat-delivery periods; advance timing
is not a measured model of valve travel or pump shutdown and cannot guarantee
that all energy use stops before a higher tariff.

## Important operating distinction

**Default: simulation only.** No physical thermostat or heat-pump commands are sent.
Your existing heating automation continues controlling the building.

**Live control is opt-in.** Turn off Enable simulation, save and confirm after
manually disabling the old heating automation. Existing installations with a
legacy simulation-off preference do not silently activate control: explicit
confirmation is required. Returning to simulation releases controlled thermostats
at their seasonal fallback temperatures. Physical commands use [Home Assistant’s thermostat target action](https://www.home-assistant.io/actions/climate.set_temperature/); thermostat HVAC modes, relays and the heat pump are not
operated directly. Thermostats must already be able to heat in their current mode.

Missing essential inputs or an expired plan returns affected rooms to seasonal
fallback temperatures. Turning ThermalPilot active off cancels the scheduled
commands and applies the same fallback, without collecting new room observations:

- Summer: the shared summer thermostat setpoint.
- Winter: each room's normal target temperature.
- 15 May through 30 September is always summer. Outside those dates, a complete
  day's minimum forecast temperature equal to or above Summer temperature (default
  6°C) also selects summer. Lower readings already observed that day are retained.
  Unknown/incomplete daily coverage outside the summer dates selects winter.

The threshold is configurable under Weather and forecast settings. Hourly
forecasts need coverage across the full local day; complete daily forecasts can
also establish the minimum. Daily evidence survives restarts. Calendar summer
requires no forecast. Failed thermostat writes are reported and retried; duplicate
writes awaiting state acknowledgement are suppressed briefly. Device temperature
limits and target steps are respected. Source changes trigger a debounced refresh
instead of always waiting for the five-minute poll.

The optional **Apply season setpoints** setting also allows real thermostat writes
in simulation: Active sets normal room targets, while Passive applies seasonal
fallback. Keep it disabled for a completely read-only trial. In live mode the
scheduled controller handles targets, so the two paths do not compete.

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
  issued. Saved forecasts show outcomes under the proposed plan; heating-match
  counts help separate forecasts with similar demand from those with different heating.

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

Initial data collection progress is shown per room on Plan and History. The bar measures collection
of 12 accepted heating hours and 12 accepted idle hours. After at least 24 hours
of rate tracking, an approximate days-remaining estimate uses up to seven days
of observed rates. An estimated initial-data completion date is shown alongside
the percentage and days remaining when enough rate data is available. It predicts
when those initial thresholds may be reached,
not when predictions become trustworthy. Live control requires your explicit activation.


Plan and History include a shared electricity-price chart above all room timelines.
Its accordion opens by default; timeline heights remain compact on wide screens.
Price colors use thresholds at 0, 15, 20, 25, 35, 50 and 60 c/kWh, from green
to dark red. Prices are normalized using the selected source unit. Plan displays
published prices and suggested thermostat boost windows, including timing offsets.
History shows recorded prices, suggested boost windows and actual heating demand.
Price history starts with this version's new observations while collection is active;
Known past intervals from the currently published list are also displayed in History.
Older days without recorded or published prices remain blank. Time labels align to
15-minute boundaries; wider periods use fewer labels to keep the axis readable.

The outdoor and supply-water status cards show subtle temperature trends from
collected observations within the published price period. Available readings
fill the card width; these decorative trends do not represent future forecasts.
Outdoor colors follow temperature thresholds from -30 to 35 °C; supply water
uses a green line. New observations include supply-water readings; older rows
without them remain usable but do not contribute to that trend. The price chart
measures its rendered container immediately and responds to width changes.

The Plan electricity chart shows today and tomorrow's published prices and
future heating suggestions. The shared History chart follows the selected
past period (24, 48 or 168 hours), and extends through today and tomorrow
when their prices are published. Future heating suggestions come from the current plan.
It shows recorded suggested heating and observed thermostat activity even
when no prices are available. Known prices are shown only where available;
gaps are left empty. Winter fallback badges use cold blue and summer fallback
badges use warm green.


The Plan, History and Settings pages use a tabbed frame. Dates use Finnish numeric
format (DD.MM.YYYY), with 24-hour times. The Operation card groups Active/Passive,
simulation/season-setpoint mode and required-source readiness. These mode badges
distinguish simulation, confirmed live control and optional season-only control.

Data collection keeps its Active/Paused badge and adds Data coverage: Low,
Limited, Developing, Good or High. Coverage uses the least-observed configured
room's accepted heating and idle hours plus time since collection started.
Limited requires 3 hours of each and 1 day; Developing requires 12 hours of each
and 3 days; Good requires 48 hours of each and 14 days; High requires 120 hours
of each and 42 days. These are descriptive coverage thresholds, not an accuracy
rating or permission to replace an existing heating automation. The tooltip
explains the criteria. Learning continues at every level.

Stored history displays the original collection start date, retained after raw
history cleanup and recovered from older season records when available.

### Phone layout

The header includes a Home Assistant menu button. On narrow screens cards and
settings stack, room names appear above the shared chart timelines, temperature
charts use fewer labels, and wide data tables scroll inside their cards.

Price bars and heating periods show immediate details on hover, keyboard focus,
or tap. Heating observations are grouped into continuous On periods. Times reflect
recorded observations; when the start or stop is unknown, the tooltip says
First observed On or Observed until instead. Tap again or press Escape to dismiss.

Under **ThermalPilot settings → Miscellaneous**, **Sensor warning delay (hours)** sets the warning delay from 1 to 72 whole hours. The default is 6 hours;
the once-per-day notification limit remains unchanged.

### Forecast accuracy

History compares measured room temperatures with forecasts saved 1, 3 and 6 hours
beforehand. The first forecast for each horizon in each hour is kept unchanged
in SQLite; later readings and model updates do not rewrite it. Only horizons
covered by the known-price plan are stored. Predictions are compared against an
observation within five minutes of their due time; missing endpoints are skipped.
The chart horizon can be selected, and average errors are shown alongside the
error from assuming no temperature change. Observed heating may differ from the
proposed plan, particularly in simulation. Similar heating counts require at
least 90% matching demand observations with no gaps longer than 15 minutes.
A good result requires considering both prediction error and heating differences.
The Plan card's 3-hour forecast error summarizes the last seven days. Initial
comparisons appear after updating and waiting for the relevant horizon; previous
next-reading predictions cannot be reconstructed as saved long-range forecasts.

### Optional price forecast

Under Electricity price settings, Price forecast (optional) accepts a sensor with
forecast timestamp/value entries, such as sensor.nordpool_predict_fi_price.
The source remains optional and disabled by default. ThermalPilot compares only
relative prices within the forecast's next day beyond the confirmed-price horizon.
An expensive first six hours can increase the terminal heat reserve from 6 to
9 or 12 hours; a cheap/flat outlook never lowers the normal comfort reserve.
Forecast values are not mixed with confirmed total prices and do not require a
separate unit or additional-cost setting. Plans and charts still use confirmed
prices. Missing confirmed prices still trigger the existing comfort fallback.
Forecast changes trigger a refresh, and confirmed tomorrow prices take precedence.
This is a bounded planning hint, not a seven-day executable heating schedule.

### Comfort and idle targets

Each room's target is the normal comfort goal. Planning first minimizes predicted
violations of the shared minimum/maximum limits, then shortfall below the room's
target, then price cost and switching. Cheaper hours can be used to store warmth
above target within the maximum; expensive prices do not make the shared minimum
the normal operating goal. Idle reduction is temporary between heating windows:
its thermostat target is max(minimum allowed temperature, room target + reduction).
Forecast demand, lowered commands and live control use this same clamped value.
At or below the minimum, heating is requested regardless of price. A cold start
or inadequate heating capacity can still cause a predicted violation; the panel
reports that risk. Future accuracy still depends on the learned thermal model.

### Temporary reduction and normal restoration

The planner now chooses Boost, Reduced or Normal for every slot. Normal uses the
room target; Boost stores warmth ahead of predicted need. Reduced is available
only after a planned boost while predicted residual warmth supports room comfort
and prices are above the known horizon's median. A boost always returns to Normal
first; reduction is a separate subsequent decision. The thermal prediction and comfort ranking
choose whether reduction is useful; it ends when warmth or the price condition
no longer supports it. There is no fixed seven-hour setting. A small preference
for reduced mode during qualifying expensive slots breaks otherwise equivalent
choices, with a switching penalty to discourage unnecessary transitions.
The setting is named Peak-hour reduction (°C). Normal restoration is an explicit timed thermostat command. A new boosted window
overrides reduction, and minimum/maximum guards still apply. After a restart,
prior reduction eligibility is not assumed: a fresh plan starts from Normal unless
it schedules a new boost. All modes retain thermostat local temperature regulation.

Settings shows an Unsaved changes notice beside Save settings when edits differ
from saved values. Reverting edits clears it. Switching tabs asks before discarding
unsaved edits; a successful save establishes the new saved baseline.

### Room heat retention

The Plan page compares rooms using one reference experiment: 20°C indoors and
−10°C outdoors, with heating, stored slab response and background heat omitted.
The modeled 6-hour temperature drop is 30 × (1 − exp(−loss × 6)); the time for a
1°C drop is −ln(29/30) / loss. Lower drop and longer time imply slower modeled
cooling. This measures the effective combination of heat leakage and thermal
mass, not measured energy efficiency or an insulation grade. Initial estimates
are marked; adapting models can still be affected by wind, ventilation, sensor
placement and unmeasured gains. Reference times are not safe heating-off durations.

### Optional local wind sensor

Under Weather and forecast settings, select **Wind speed (optional)**, such as
`sensor.netatmo_tuuli_ms`. Units are detected automatically; m/s, km/h, mph and
knots are supported. Readings are averaged over 30 minutes. A separate wind
effect is learned only after sufficient heating, idle and varied wind observations;
selecting a sensor does not apply an assumed wind penalty.

Missing, invalid or unchanged-for-two-hours readings are ignored. Heating,
ordinary temperature-based planning and room learning continue. Stable calm
readings can also be ignored conservatively. Wind is optional and never becomes
an essential input for live control. Near-term forecasts use fresh wind data;
the correction gradually returns to typical conditions further ahead.
