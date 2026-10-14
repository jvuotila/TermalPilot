"""ThermalPilot constants; scheduled control is opt-in; simulation is enabled by default."""
DOMAIN = 'thermal_pilot'
VERSION = '0.9.6'
PLATFORMS = ['sensor', 'binary_sensor', 'switch']
RESERVE_HOURS = 6.0
ARCHIVE_KEEP_DAYS = 7
HISTORY_DAYS = 30
WATER_REFERENCE = 32.0
AIR_INITIAL_LAG_HOURS = 10/60
DEFAULTS = {
    'price_entity': '', 'price_forecast_entity': '', 'price_unit': 'c/kWh',
    'pricing_mode': 'flexible', 'minimum_run_minutes': 60,
    'weather_entity': '', 'outdoor_entity': '', 'wind_entity': '',
    'water_entity': '', 'fireplace_entity': '',
    'fireplace_active_state': 'on',
    'heating_enabled': True, 'simulation_enabled': True, 'language': 'en',
    'live_control_confirmed': False,
    'sensor_warning_hours': 8,
    'summer_minimum_temperature': 6.0, 'summer_setpoint': 10.0, 'apply_season_setpoints': False,
    'boost': 1.5, 'setback': -1.0, 'minimum': 19.0, 'maximum': 23.0,
    'start_offset_minutes': 5, 'stop_offset_minutes': 10,
    'lag_hours': 3.0, 'curve_warm_temp': 0.0, 'curve_cold_temp': -18.0,
    'house_heat_source': 'air_to_water', 'house_distribution': 'water_floor',
    'house_heated_floor': 'concrete_slab', 'house_foundation': 'unknown',
    'air_fan_cool':'', 'air_swing_cool':'', 'air_heat_target': 24.0,
    'air_fan_heat': '', 'air_fan_idle': '', 'air_swing': '', 'air_swing_idle': '',
    'heating_zones': [], 'rooms': [],
}
ROOM_DEFAULTS = {
    'name': '', 'thermostat': '', 'temperature_entity': '',
    'activity_entity': '',
    'baseline': 20.0,
    'is_garage': False, 'heat_control': 'house', 'heating_zone_id': '',
    'garage_minimum': 5.0, 'garage_maximum': 9.0,
    'garage_strategy': 'temperature', 'garage_heat_target': 16.0,
    'garage_fan_heat': '', 'garage_fan_idle': '', 'garage_fan_presence': '', 'garage_swing': '', 'garage_swing_idle': '',
    'garage_door_entities': [], 'garage_door_delay': 60,
    'garage_presence_entities': [],
    'curve_min_hours': 4.0, 'curve_max_hours': 13.0,
    'fireplace_reduction': 0.0, 'solar_direction': 'disabled', 'solar_exposure': 'clear',
}

ZONE_DEFAULTS = {'heating_enabled':False, 'climate_mode':'heat', 'cooling_target':24.0, 'source_type':'air_to_air', 'name':'', 'thermostat':'', 'main_room_id':'', 'temperature_policy':'main', 'fireplace_entity':'', 'fireplace_active_state':'on'}
