"""ThermalPilot constants; scheduled heating remains simulated in this release."""
DOMAIN = 'thermal_pilot'
VERSION = '0.1.4'
PLATFORMS = ['sensor', 'binary_sensor', 'switch']
DEFAULTS = {
    'price_entity': '', 'price_format': 'quarterly', 'price_unit': 'c/kWh',
    'pricing_mode': 'flexible', 'minimum_run_minutes': 60,
    'prices_include_vat': True, 'vat_percent': 25.5,
    'prices_include_transfer': False, 'transfer_day': 7.45, 'transfer_night': 5.68,
    'day_start': 7, 'day_end': 22, 'margin': 0.456,
    'weather_entity': '', 'forecast_type': 'hourly', 'outdoor_entity': '',
    'water_entity': '', 'power_entity': '', 'fireplace_entity': '',
    'fireplace_active_state': 'on', 'learning_enabled': True,
    'horizon_hours': 48, 'terminal_reserve_hours': 6.0,
    'history_days': 30, 'heating_enabled': True,
    'activation_entity': '', 'activation_active_state': 'on',
    'summer_setpoint': 10.0, 'apply_season_setpoints': False,
    'boost': 1.5, 'setback': 1.0,
    'start_offset_minutes': 5, 'stop_offset_minutes': 10,
    'lag_hours': 3.0, 'curve_warm_temp': 0.0, 'curve_cold_temp': -18.0,
    'water_reference': 32.0,
    'collection_mode': 'manual',
    'season_start_temperature': 8.0, 'season_stop_temperature': 12.0,
    'season_smoothing_hours': 24.0, 'season_archive_enabled': True,
    'archive_keep_days': 7, 'rooms': [],
}
ROOM_DEFAULTS = {
    'name': '', 'thermostat': '', 'temperature_entity': '',
    'activity_entity': '',
    'baseline_entity': '', 'baseline': 20.0, 'minimum': 19.0, 'maximum': 23.0,
    'curve_min_hours': 4.0, 'curve_max_hours': 13.0,
    'fireplace_reduction': 0.0, 'enabled': True,
}
