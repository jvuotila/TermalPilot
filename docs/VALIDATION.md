# Validation status

- 141 Python unit/adapter tests pass in the bundled Python 3.12 environment.
- Sensor-health tests cover eight-hour unchanged/unavailable readings, resets after
  changes, passive operation and monitoring gaps, and persisted daily notification
  limits using Home Assistant local dates.
- Price tests cover automatic interval detection, independent daily resolutions,
  legacy setting independence, incomplete lists and timestamped-source preference.
- Forecast tests cover automatic hourly/twice-daily/daily selection and caching,
  detailed failure reasons, five-minute retries and recovery.
- Native history-card tests cover registered entity names, selected relays, selected
  periods and the full History link. Embedded cards require Home Assistant dashboard
  components; real Home Assistant rendering has not been verified here.
- Settings tests cover negative idle reductions and migration, required supply-water
  sources, internal retention and automatic season-end compaction.
- HA adapter tests use minimal doubles; there is no installed HA runtime here.
- Python modules compile and frontend JavaScript passes Node syntax checking.
- History tests cover quarter-hour selection, legends, On/Off/Unknown states,
  and temperature-axis bounds including both measured and predicted values.
- Panel tests cover closed-by-default room accordions and independently remembered
  Plan/History disclosure states.
- Panel tests cover save feedback, five-second notifications, repeated saves,
  cancelled/confirmed room actions, and global simulation controls.
- Python tests cover Active/Passive collection and negative fireplace compensation
  validation, including conversion of older positive settings.
- Panel template tests cover Settings, Plan, History, season-control banners and
  HTML escaping. They do not verify the browser DOM or visual rendering.
- Add Room click-handler tests cover native UUIDs, HTTP-compatible random bytes,
  absent Web Crypto, distinct valid UUIDs, defaults and preservation of unsaved settings.
- Shared selector fixtures test temperature/power metadata, unit-only templates,
  price-list availability, discrete activity and numeric target helpers. Native
  setup filters and retention of existing selections are covered.
- Alphabetical room tests cover Settings, Plan, History, stable IDs, editing
  and deletion of the correct room after sorting.
- Shared boost/setback adapter coverage verifies all rooms receive the same
  global adjustments even when old room-specific settings are still stored.
- Adapter tests cover relay on/off states, thermostat fallback, climate-based
  supply-water measurement and shared thermal parameters overriding legacy fields.
- Replanning tests preserve a started session from its valve-opening window,
  retain original advance commands, and enforce the remaining heating period.
- Offset tests cover contiguous sessions, midnight, zero and non-quarter-hour
  offsets, exact command transitions, timer cancellation and no device writes.
- A synthetic 75-minute scheduling case passes, as does a cross-day bridging case.
- SQLite volume was measured with 86,400 samples, retention and full compaction.
- Live HA installation, HACS validation, hassfest and real-device behavior are
  not verified. A local offline preview is included for inspection.
- The local browser preview could not be rendered through the available browser
  tools; no screenshots or visual-validation claims are included.

Repository documentation, issue tracker and codeowner metadata are configured
for `jvuotila/ThermalPilot`. Before publishing, run HACS/hassfest validation plus
HA integration tests in an actual HA environment.

Learning-progress tests cover heating/idle thresholds, wall-time rate estimates,
missing heating evidence, bounded rate history and excluded observations.

Frontend checks also cover price color boundaries, responsive container sizing,
full-width status temperature trends, and every outdoor temperature color threshold.

History chart label checks verify separate room-name and activity columns,
with ellipsis and full-name tooltips for long room names.

History price chart checks cover known past intervals from the published list,
missing older observations, and time labels aligned to quarter-hour boundaries.

Shared-chart checks verify the Plan published-price horizon and all three selected
History periods, including retained thermostat activity without prices, exclusion
of out-of-range activity and inclusion of published today/tomorrow prices even
with 24 hours selected, and removal of the numeric color key.


Status badge checks cover source availability, weakest-room data coverage,
all five coverage levels, elapsed-time criteria, explicit simulation/season modes,
placement inside the Operation card, Finnish dates and preserved Active/Paused
badges. Collection-start storage survives retention and migrates existing season
records. Preview scripts pass syntax checks; browser visual rendering has not
been verified by these template tests.


Live control tests use Home Assistant service doubles, not actual thermostat
hardware. Coverage includes scheduled offset execution, simulation consent,
legacy-off protection, missing inputs, expired plans, failed writes, duplicate
suppression, cancelling an unacknowledged boost, thermostat limits/steps, releasing removed rooms, mode changes,
restart ownership, source-recovery debouncing and summer/winter fallbacks.
Restart tests create a fresh coordinator after a one-hour outage and verify
both heating-to-idle and idle-to-heating target changes, a forced initial write
despite matching restored attributes, missing-source fallback and recovery,
unavailable-thermostat recovery, and seasonal fallback changes. These use
Home Assistant service doubles; physical restart behavior remains to be verified.
Calendar and forecast tests cover the always-summer date span, inclusive threshold,
user-configured threshold, incomplete/gapped forecasts and retained daily lows.
Physical valve and pump response still require observation on the user's system.

Mobile panel checks verify the Home Assistant sidebar event crosses the shadow
root, shared charts reflow ten room lanes at 320/390/600-pixel panel widths, and
charts return to their desktop layout after resizing. These are template and
event checks, not a phone browser or installed Home Assistant visual test.

Chart detail checks cover price interval values/times, contiguous recorded heating
periods, known versus incomplete start/stop observations, delegated hover/focus/tap
handling, Escape/tap dismissal and tooltip positioning within phone viewports.

Saved-forecast checks cover immutable hourly issuance, restart persistence, 1/3/6-hour
comparison, a no-change benchmark, missing measurements and recording gaps,
different observed heating, sensor mapping changes and limited price horizons.
Preview forecast comparisons are synthetic examples, not saved home measurements.

Optional price forecast tests cover relative trend signals, invariance to price
unit scaling and fixed fees, missing/stale/gapped forecasts, increased terminal
reserve, confirmed-price chart preservation and live fallback when confirmed
prices are unavailable.

Comfort regression tests cover per-room target planning over 32 hours, heating
during expensive prices, distinct emergency limits, reduced-target clamping in
forecast/timing commands and cold-room recovery. The flexible-run example now
starts above the room target so price shifting can be tested without conflicting
with immediate comfort recovery.

Thermostat step rounding also respects configured minimum/maximum bounds;
unsupported narrow ranges report an error instead of sending an out-of-range target.

Three-state checks cover default Normal, post-boost expensive-period reduction,
restoration during cheap hours or below-target recovery, advance valve offsets,
new-boost precedence and live timer commands through Boost → Normal → Reduced → Normal.

A residual-heat regression verifies that reduction avoids a predicted thermostat
call during expensive hours while stored response raises the room back to target;
the same starting state with reduction disabled requests heat.

Unsaved-setting checks cover typed values, toggle edits, reverting changes, room
additions, a refreshed saved baseline and cancellation/confirmation of tab changes.

Heat-retention comparisons are checked for a fixed reference, analytical cooling,
monotonic room ranking, invalid parameters, initial/adapting labels and independence
from current heating/background/slab-response inputs.

Optional wind tests cover missing, invalid, unavailable and frozen readings while
live planning continues, unit conversion, smoothing/recovery and source changes
without resetting baseline learning. Model tests cover bounded correction, missing
wind fallback and refusal to learn a wind effect without varied observations.

Message template checks cover information, warning and error levels, distinct prefix icons, accessible level labels and escaped content. Wide Plan layouts use two columns with equal card heights; smaller layouts stack them. Visual rendering still needs user review.

Heating tooltip checks cover duration formatting and grouped observed/planned periods on Plan and History. Room lane spacing is 10 px; template checks verify updated desktop/mobile chart dimensions.

Solar tests cover seasonal daylight, cloud attenuation, window azimuth, night/missing location/cloud inputs, idle-only evidence gating, no assumed initial gain, daylight exclusion from ordinary loss fitting, half-gain forecast cap and opt-out/missing-data behavior.

Adapter solar checks verify Home Assistant location/current weather reach room observations and missing optional weather keeps live planning and collection running.

Solar exposure checks cover forecast attenuation without mutating learned gain, all eight bearings, legacy toggle migration and conditional UI visibility.

House-profile tests cover legacy defaults, conditional validation, electric/air planning and live control without water, water-based operation with optional missing water, preserved existing water-model identity/fingerprints and retained history rows. Frontend checks cover grouping, card ordering and conditional water controls.

Optional water tests cover empty sensor selection, continued planning/collection when a selected sensor is missing, neutral heating factor and water-based live control without water readings. Sensor-warning tests verify the new 8-hour default and preservation of explicit 6-hour settings.

Language checks cover English default, Finnish persistence/validation, flag labels, translated messages, protected user names, ignored styles and language-neutral heating data. Native HA cards receive a local Finnish locale/state-label adapter without changing HA’s global language.

Non-electric regression checks cover price-free configuration, continued collection, no plans or thermostat/season commands for all non-electric sources, forced read-only activation and hidden price UI.

SVG language-picker checks cover Finland/UK artwork, hidden canonical language field, selection and change notification, arrow navigation and Escape dismissal. No Windows browser rendering was exercised by these template checks.

Finnish room regressions cover dynamic ETA sentences, less-than-one-day estimates, comparison counts, forecast error labels, asynchronously added history links, localized native-card entity labels and isolated locale/state translation.

Completed collection badge checks cover seven-day 3-hour forecast error, missing evidence, no-change/similar-heating context, Finnish numeric format and suppression in non-electric observation mode. The badge makes no live-readiness assertion.

Forecast-rating tests cover five practical deviation bands, a 20-comparison minimum, no-change benchmark restriction on green ratings, invalid/missing data and Finnish labels. Numerical thresholds are display guidance, not validated safety limits.

Fireplace-state checks cover contact Open/Closed labels mapped to on/off, enum options, selector-only entry and backend rejection of display labels as binary states.

## Garage and air-to-air control validation

Service-double tests cover external 5–9°C hysteresis with a separate 16°C device
target; tariff preheating and upper-limit priority; cold fan-only standby and warm
off; dynamic door/presence lists; legacy sensor migration; any-sensor presence fan selection; shared open-door delay and all-closed reset; missing inputs;
advertised fan/swing capabilities; staged mode transitions and countercommands;
permission checks between writes; simulation and live-control release; mixed
floor/air learning inputs; unchanged floor-room fingerprints; and one controller
per shared heating zone. Zone temperature policies include main, mean and coldest
readings, with any-room upper-limit guards. These are not hardware tests.

Delayed-acknowledgement service doubles now cover power-on, mode, temperature,
fan and swing stages independently; ten-second polling; sixty-second retries;
failed stages blocking later commands; countercommands during an unfinished heat
sequence; and retaining release ownership until standby is reported. This checks
Home Assistant state feedback, not physical acknowledgements from a real pump.

Air-response learning tests use synthetic heating/cooling observations to recover
a slower 45-minute response from the internal 10-minute seed, require heating/idle
and transition evidence, retain the seed without cycles or with excluded data,
persist learned response, keep floor lag behavior unchanged, and use learned lag
in garage forecasts. Standby swing follows the same staged acknowledgement checks.
Synthetic response identification is not validation on real equipment.
