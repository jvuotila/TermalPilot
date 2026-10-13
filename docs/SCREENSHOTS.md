# Updating README screenshots

Before publishing a UI change, refresh the screenshots affected by that change.
Use the English interface for the README examples. Capture clean, legible views
with the relevant section visible and no menus, tooltips or browser controls
covering it. Keep the original screenshot pixels; do not fabricate displayed data.

Replace files in `docs/screenshots/` using these stable names:

| File | View |
| --- | --- |
| electricity-and-heating.png | Electricity prices, suggested heating and actual relay history |
| room-plan.png | Expanded room on Plan |
| room-history.png | Expanded room on History, including saved forecast accuracy |
| integration-settings.png | ThermalPilot settings |
| house-heating-settings.png | House heating settings |
| shared-room-settings.png | Shared room settings |
| rooms-settings.png | Rooms container with one room expanded |

Use a configured Home Assistant installation or the local preview with clearly
identified example data. Manually supplied captures are supported when automated
capture is unavailable. Changes to labels, spacing, colors or controls require
refreshing the relevant image; backend-only changes do not.

Check the README in a Markdown preview: the main image should load immediately,
and the two expandable sections should reveal the remaining images. Verify that
labels are readable and the screenshot agrees with the current UI. Include the
updated image files in the same commit as the UI change whenever possible.

Current captures were supplied by Juho Vuotila on 13 October 2026 for version
0.9.2. Settings and room names in the images are examples, not defaults.
