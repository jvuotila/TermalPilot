# Validation status

- 77 Python unit/adapter tests pass in the bundled Python 3.12 environment.
- Sensor-health tests cover six-hour unchanged/unavailable readings, resets after
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
