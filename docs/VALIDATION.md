# Validation status

- 44 Python unit/adapter tests pass in the bundled Python 3.12 environment.
- HA adapter tests use minimal doubles; there is no installed HA runtime here.
- Python modules compile and frontend JavaScript passes Node syntax checking.
- Panel template tests cover Settings, Plan, History, season-control banners and
  HTML escaping. They do not verify the browser DOM or visual rendering.
- Add Room click-handler tests cover native UUIDs, HTTP-compatible random bytes,
  absent Web Crypto, distinct valid UUIDs, defaults and preservation of unsaved settings.
- Shared selector fixtures test temperature/power metadata, unit-only templates,
  price-list availability, discrete activity and numeric target helpers. Native
  setup filters and retention of existing selections are covered.
- Alphabetical room tests cover Settings, Plan, History, stable IDs, editing
  and deletion of the correct room after sorting.
- A synthetic 75-minute scheduling case passes, as does a cross-day bridging case.
- SQLite volume was measured with 86,400 samples, retention and full compaction.
- Live HA installation, HACS validation, hassfest and real-device behavior are
  not verified. A local offline preview is included for inspection.
- The local browser preview could not be rendered through the available browser
  tools; no screenshots or visual-validation claims are included.

Repository documentation, issue tracker and codeowner metadata are configured
for `jvuotila/ThermalPilot`. Before publishing, run HACS/hassfest validation plus
HA integration tests in an actual HA environment.
