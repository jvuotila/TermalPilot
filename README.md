# ThermalPilot

Shift electric heating toward cheaper electricity periods while keeping rooms
within their comfort limits. ThermalPilot learns each room’s heating and cooling
response and shows proposed schedules before you enable real control.

Version **0.9.37 — experimental simulation-first Home Assistant custom integration**.

![Electricity prices and room heating timelines](docs/screenshots/electricity-and-heating.png)

## Why I built this

I’ve wanted to build an integration like this for some time. Home Assistant
automations can handle basic heating control well, but more complex decisions
become difficult to manage with fixed rules. Heating during the cheapest spot-price
periods usually works—until those periods are 24–36 hours apart. If rooms cool too
much in between, heating may be needed during the most expensive hours instead.

I wanted a system that learns how the house responds and plans ahead, rather than
following a static chain of rules. ThermalPilot is my attempt to meet that need,
with charts available both in its own panel and as dashboard cards.

Development is ongoing. I can test real-world behavior only with my own heating
system, so I can’t cover every installation or scenario myself. If you try
ThermalPilot, I’d welcome your feedback through
[GitHub issues](https://github.com/jvuotila/ThermalPilot/issues).

The integration starts in simulation mode and does not control your heating by
default. Give it an extended observation period to learn your system, then assess
its forecasts and plans before considering live control. Learning alone does not
guarantee reliability. You can also use ThermalPilot purely to monitor your
heating system, without ever letting it control anything.

## What it does

- Plans heating using electricity prices, room temperatures and weather.
- Shows room plans, recorded heating and saved temperature forecasts.
- Supports primary room thermostats, secondary air-to-air heat-pump zones and
  independent garage control.
- Includes sortable heat-retention estimates and two dashboard cards.
- Works on phones and supports 25 interface languages.

Tariff optimization is intended for heat pumps and electric resistance heating
with variable electricity prices. Gas, oil, wood and district heating support
observation and learning; their fuel costs and equipment control are not modeled.

## Install

1. In **HACS → Custom repositories**, add
   `https://github.com/jvuotila/ThermalPilot` as an **Integration**.
2. Download **ThermalPilot** and restart Home Assistant.
3. Open **Settings → Devices & services → Add integration → ThermalPilot**.
4. Select your sources, then open **ThermalPilot** in the sidebar.

For manual installation, copy `custom_components/thermal_pilot` into your Home
Assistant configuration’s `custom_components` directory and restart.

## Get started

1. In **Settings**, select your electricity-price and outdoor-temperature sources.
   Match the price unit to your source; prices must include the variable charges
   you want scheduling to consider.
2. In **Rooms and zones**, choose the house heating system and add each room’s
   thermostat and temperature sensor. Set targets and comfort limits.
3. Keep **Enable simulation** on and **Apply season setpoints** off for a trial
   that does not change thermostats. Keep your existing heating controls running.
4. Review **Plan** and **History** as observations accumulate. Use field info
   buttons for setting-specific help.

Zones are secondary sources: adding a heat-pump zone preserves each room’s
primary thermostat and heating plan. New zones are observation-only until their
own control switch is enabled.

## Before enabling control

Initial collection reaches 100% after at least 12 heating hours and 12 idle hours.
That measures collected data, **not reliability**. Learning continues; there is no
automatic activation or guaranteed completion date.

Compare saved forecasts with measurements and the no-temperature-change benchmark
across heating, idle and cold-weather periods. Heat-retention badges are model
estimates, not certified efficiency or insulation ratings.

To enable scheduled control, turn off **Enable simulation**, save and confirm.
Disable other automations controlling the same thermostats first. **Apply season
setpoints** can also change real thermostats during simulation; leave it off for
observation only. See [control and fallback behavior](docs/GUIDE.md#control-and-fallback).

## Dashboard cards

Both cards load automatically with the integration. Add them from your dashboard’s
card picker:

- **ThermalPilot heat retention** — sortable table with selectable columns.
- **ThermalPilot heating plan** — electricity prices and heating timelines.

Both support an optional title and language override.
[Card configuration and YAML examples](docs/DASHBOARD-CARDS.md).

## More information

- [Settings and operating guide](docs/GUIDE.md)
- [Screenshot gallery](docs/GALLERY.md)
- [Updating and prototype migration](docs/UPGRADING.md)
- [Model assumptions](docs/MODEL.md)
- [Development and tests](docs/DEVELOPMENT.md) · [Translations](docs/TRANSLATING.md)

## License

[PolyForm Noncommercial 1.0.0](LICENSE). Commercial use is not licensed; versions
through v0.1.40 retain their original MIT terms.

ThermalPilot is experimental software, provided without warranty. Energy savings
are not guaranteed.
