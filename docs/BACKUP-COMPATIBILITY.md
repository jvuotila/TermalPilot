# Backup compatibility

Newer ThermalPilot versions must retain support for backups exported by v0.9.33
(the first backup release) and subsequent supported backup schemas. The application
release number is informational; it does not decide whether an archive can restore.
Compatibility with a backup from a newer application in an older application is not
promised.

Restore keeps room and zone UUIDs, membership, main-room references, model keys and
history identities. It never generates replacement IDs or matches rooms by name or
position. Invalid identifiers or broken links stop the restore before replacing data.
Entity IDs remain references to the original Home Assistant installation; users may
need to reselect entities if those have been renamed or are absent on another system.

Missing optional entity selectors stay empty, lists stay empty, and new control
opt-ins stay off. Numeric limits and other required planning settings receive valid
current defaults. Existing legacy conversions run before validation. New model fields
receive initial values without replacing saved learned parameters. Restore always
starts in simulation mode with seasonal device writes disabled.

## Maintenance contract

`backup_migrations.py` owns the stable ZIP envelope (format version 1), component
schema versions and migration registries. Archives from v0.9.33 lack component version
fields; they must continue to be read as settings/learning/history schema 1.

- Additive optional settings can use normalization. Update field metadata and safe
  defaults together, and test a backup that omits the new field.
- Renaming, removing or changing a setting's meaning/type requires a settings schema
  increment and a registered one-step migration. Apply migrations before current
  settings validation; never silently discard a setting that needs conversion.
- Changes to learned-model meaning/types require a learning schema migration that
  preserves convertible parameters and evidence. Keep old fingerprints readable or
  migrate them explicitly; avoid an unintended learning reset after restore.
- Database changes require a new frozen source schema, a registered history migration,
  and matching regular database upgrade support. Rebuild old data using its frozen
  schema, then run trusted migration code on the staging database. Never compare old
  archives against only the current table layout or execute archive-supplied SQL.
- Keep earlier readers and migration steps. Do not simply increase an accepted version
  check or replace the frozen version-1 schema with the current database schema.
- Keep `tests/fixtures/backup-v0.9.33.json` unchanged. It contains an actual ZIP produced
  by the released writer, including linked rooms/zones and records in every history
  table. Add a separate fixture for each later breaking schema. Do not regenerate old
  fixtures with the new writer to make a failing test pass.

CI runs compatibility tests with the frozen archive on every push and pull request.
They check identities, learning evidence, history, missing fields, simulated future
settings, renamed-setting migration, history-column migration, and rejection of
unsupported schemas and broken references. Every breaking schema change must extend
these tests and restore **all earlier fixtures through the complete import path**.
