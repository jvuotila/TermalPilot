# Updating README screenshots

Before publishing a UI change, refresh the screenshots affected by that change.
Use the English interface for the README examples. Capture clean, legible views
with the relevant section visible and no menus, tooltips or browser controls
covering it. Keep the original screenshot pixels; do not fabricate displayed data.

Replace files in `docs/screenshots/` using these stable names:

| File | View |
| --- | --- |
| electricity-and-heating.png | Plan: hourly weather, electricity prices, heating, cooling and striped suggestions |
| electricity-and-heating-history.png | History: recorded and suggested heating, zone activity and garages |
| room-heat-retention.png | Sortable heat-retention estimates with numeric alignment and cooling-speed badges |
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

Check the README and [screenshot gallery](GALLERY.md) in a Markdown preview.
The README shows the main chart; the gallery contains the remaining images. Verify that
labels are readable and the screenshot agrees with the current UI. Include the
updated image files in the same commit as the UI change whenever possible.

Settings, room names and values in screenshots are examples, not defaults.
Keep the gallery links current when adding or replacing captures.
