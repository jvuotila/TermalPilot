# ThermalPilot

Version **0.1.3 — experimental simulation-first Home Assistant custom integration**.

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
- Internal hourly averaging of quarter-hour prices.
- Hourly, quarter-hour and flexible-run planning. Flexible runs start/end on
  quarter-hour boundaries and have a configurable minimum length, default 60 minutes.
  Runs can last 75, 90, 105 minutes, etc.; they are not rounded to whole hours.
- Day/night grid tariffs, source VAT handling, missing retail margin and informational
  monthly standing charges. Grid charges may include electricity tax.
- Rolling planning across midnight, including bridging heating before predicted
  cooling and a terminal reserve beyond the end of published prices.
- Per-room heating-season target, comfort limits, boost/setback and thermal lag.
- Conservative online adaptation using actual heating activity and temperature changes.
- Five-minute SQLite observation history, CSV export, native HA suggested-heating
  binary sensors and suggested-setpoint/forecast/error sensors.
- An Active/Passive master switch and optional existing activation helper.
- Optional outdoor-season collection gating, full-season accumulators, compact
  season archives and retained learned parameters for the following season.
- A **shared summer setpoint**, default 10 C, and optional actual season setpoint
  application. Scheduled heating decisions always remain simulated in version 0.1.

Rooms are displayed alphabetically by name in Settings, Plan and History.
Unnamed new rooms appear last; sorting preserves each room's identity and data.

## Entity selection

Temperature fields show temperature sensors, including template sensors with
temperature units and no device class. Electrical power fields show power sensors
in W/kW rather than energy counters. Price sources must expose `today`, `tomorrow`,
`raw_today` or `raw_tomorrow` list attributes. Target helpers accept temperature
entities or unitless number helpers. Activity selectors accept binary sensors,
switches and discrete state sensors; custom room activity attributes remain usable.
Weather and thermostat fields are restricted to their respective entity domains.

Already configured sources remain visible if unavailable or no longer matching
the filter, with an explanatory label. They are never silently cleared.

## Important operating distinction

**Default: simulation only.** No physical thermostat or heat-pump commands are sent.
Your existing heating automation continues controlling the building.

The optional **Apply Active/Passive season setpoints to real thermostats** setting
has a narrow physical effect:

- Effective Passive: set enabled rooms' thermostats to the shared summer setpoint.
- Effective Active: set each enabled room's thermostat to its heating-season target
  (or its target helper's value).
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
| Source includes VAT | enabled, if your configured Nordpool source adds VAT |
| Source includes grid charges | disabled for the supplied Nordpool source |
| Day grid tariff | 7.45 ct/kWh |
| Night grid tariff | 5.68 ct/kWh |
| Day interval | 07:00–22:00, HA local timezone |
| Margin missing from source | 0.456 ct/kWh |
| Grid standing charge | 39.58 EUR/month, informational |
| Electricity standing charge | 4.56 EUR/month, informational |
| Outdoor sensor | `sensor.outdoor_lowest_temperature` |
| Forecast source | `weather.forecast_koti` |
| Forecast type | hourly if supported; otherwise daily |
| Activation helper | `input_boolean.heating_nordpool_control`, active value `on` |
| Collection mode | manual (follows effective Active/Passive) |
| Shared summer setpoint | 10 C |
| Actual season setpoint application | disabled for the first shadow trial |

**Do not double-add VAT, grid charges or margin.** Select the source inclusion flags
according to the source's price lists, not its displayed current state. The configured
VAT percentage is a user setting, not automatically maintained tax information.

For rooms previously on curve 1, start with 4–13 heating hours at 0 to -18 C.
For the two higher-demand rooms, use 5–16 hours at 0 to -16 C. Enter each room's
normal winter target (19.5 or 20 C as appropriate) and suitable comfort bounds.
Boost/setback can initially remain 1.5 C and 1 C. A three-hour thermal response lag
is an initial estimate; it is configurable and is not automatically learned in v0.1.

Actual heating activity defaults to the selected thermostat's `hvac_action`.
If that attribute is unavailable or does not indicate actual valve demand, choose
an activity sensor and its active value instead. No learning is inferred from a
setpoint alone. Separate valve activity indicates demand, not guaranteed heat flow.

Names and room UUIDs are independent of entity IDs. Removing a room leaves its
historical archive intact. Changes to temperature/activity mapping, lag, curve or
water-reference assumptions reset that room's live learned coefficients.

## Active/Passive and collection

The integration exposes a native HA switch, **ThermalPilot active**.
The same setting can be changed from Plan or Settings.

If an activation helper is configured, both the master switch and helper must
permit operation. This fits an existing winter/summer automation: setting
`input_boolean.heating_nordpool_control` off makes ThermalPilot passive.
Changing thermostat temperatures to 10 C alone is not used as an implicit mode
signal; connect the existing explicit helper instead.

Passive mode stops planning, collection and learning. It preserves learned models
and, when enabled, archives the ending season. On reactivation, existing learned
coefficients remain the starting point; transient slab response is reinitialized.

Optional `automatic` collection uses an exponentially smoothed outdoor temperature
with start/stop hysteresis, initially 8/12 C and 24 hours. It only gates collection
and learning; the master Active/Passive setting gates the entire function.
`always` collects whenever the master/helper permits; `paused` stops collection
but allows a shadow plan. Unknown outdoor temperature prevents usable learning.

## Data and season compaction

Observations are stored locally at:

`.storage/thermal_pilot.<config_entry_id>.sqlite3`

Model state is stored with HA Store under the same integration/entry namespace.
No external database or cloud service is required.

- At most one stored observation per room per five-minute bucket.
- Default raw retention: 30 days; configurable 1–90 days.
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
