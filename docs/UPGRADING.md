# Upgrading

For normal updates, download the update through HACS, restart Home Assistant,
and refresh the browser. Back up your Home Assistant configuration first.

## Original TermalPilot prototype

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
