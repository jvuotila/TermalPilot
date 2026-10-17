# Dashboard cards

## Heat retention

The integration loads the card automatically; no dashboard resource setup is
needed. Restart Home Assistant after updating, then refresh your browser.
Add the **ThermalPilot heat retention** card from the dashboard card picker.
If you previously added `/thermal_pilot/heat-retention-card.js` manually under
**Settings → Dashboards → Resources**, you can remove that resource entry;
existing cards keep the same configuration.
Its visual editor lets you set an optional title and choose columns; Room is
always included. Leave the title blank to show only the table. The card follows the integration's language setting unless you choose a card language. It refreshes
every minute and supports sorting by clicking the column headers. Garages stay
in their own group at the bottom. Dashboard viewers can read the table without
access to ThermalPilot's admin settings or heating controls.

Example manual card configuration:

```yaml
type: custom:thermal-pilot-heat-retention-card
title: Room heat retention  # Optional
columns:
  - loss_6h
  - drop_1c
  - cooling_speed
  - model
```

Omit `columns` to show all columns, or use `columns: []` for Room only.
If more than one ThermalPilot integration is loaded, select the integration in
the card editor. Optional YAML keys are `entry_id`, `language` (`auto` or an integration language
code such as `fi`), `sort_by` (`room`, `loss_6h`,
`drop_1c`, or `cooling_speed`) and `sort_direction` (`asc` or `desc`).
The cooling-speed badges remain approximate model comparisons, not certified
energy-efficiency ratings.

## Heating plan

Add **ThermalPilot heating plan** from the dashboard card picker. The integration
loads it automatically. The card shows the Plan chart's legend, electricity
prices, hourly weather, room timelines, garages and zones. Explanatory text above and
below the chart is omitted. Its optional title is blank by default, and it uses
the integration's language unless a card language is selected. Hover, focus or tap a chart bar to see details.
The chart refreshes every minute and adapts to the card width.

```yaml
type: custom:thermal-pilot-plan-chart-card
title: Heating plan  # Optional
show_weather: true
show_prices: true
```

If multiple ThermalPilot integrations are loaded, choose one in the visual
editor, or specify its `entry_id` in YAML. This card only displays information;
it does not change heating settings or control devices. The optional `language`
setting accepts `auto` (use the integration language) or a supported language
code such as `en` or `fi`.

Use the editor’s **Show weather forecast** and **Show electricity prices** switches
to show either chart, both, or just heating timelines. Both default to enabled.
Weather appears only when the configured weather source provides an hourly
forecast; daily forecasts are not expanded into invented hourly readings.
The weather timeline always fits the card width and reduces weather-label density
on narrow cards.
