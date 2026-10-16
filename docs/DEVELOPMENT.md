# Development

Run checks from the repository root:

```sh
python -m unittest discover -s tests -v
python -m compileall -q custom_components
node tests/test_localization.cjs
node tests/test_panel.cjs
node tests/test_live_panel.cjs
node tests/test_retention_card.cjs
node tests/test_plan_card.cjs
```

CI also checks frontend JavaScript syntax. Python tests cover planning, prices,
learning, storage and Home Assistant adapters. Frontend checks cover templates,
interactions, dashboard cards and language loading. Adapter tests use doubles;
passing them does not establish real Home Assistant installation or device behavior.
Validate HACS packaging, hassfest and actual operation before a release.

`PREVIEW.html` is an offline UI with illustrative data and mock storage. It sends
no Home Assistant commands. Its embedded language catalogs come from the same
JSON files used by the installed frontend. See [Translations](TRANSLATING.md) for
catalog structure and [Screenshot maintenance](SCREENSHOTS.md) for capture guidance.

Avoid adding implementation history to the README. Keep it focused on what the
integration does, installation, first use and essential operating distinctions.
Use Git history/releases for changes and the focused documents here for detail.

Changes to settings, learning state or history storage must follow the [backup compatibility contract](BACKUP-COMPATIBILITY.md). Keep released backup fixtures and restore tests passing.
