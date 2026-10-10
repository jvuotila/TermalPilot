"""Shared settings metadata and server-side validation."""
from copy import deepcopy
from uuid import uuid4
from .const import DEFAULTS, ROOM_DEFAULTS
from .model import number

# key, label, input type, bounds/domain; used by the dedicated settings panel.
SOURCE_FIELDS = [
 ('price_entity','Price sensor with additional costs','sensor',{'kind':'price'}),
 ('price_unit','Source price unit','select:c/kWh,€/kWh'),
 ('pricing_mode','Scheduling mode','select:hourly,quarterly,flexible'),
 ('minimum_run_minutes','Minimum flexible heating run, minutes','number',15,360,15),
 ('weather_entity','Weather forecast source','weather'),
 ('outdoor_entity','Outdoor temperature','sensor',{'kind':'temperature'}),
 ('water_entity','Supply water temperature source','sensor,climate',{'kind':'water'}),
 ('fireplace_entity','Fireplace activity sensor (optional)','sensor,binary_sensor',{'kind':'activity'}),
 ('fireplace_active_state','Fireplace active value','text'),
 ('simulation_enabled','Enable simulation','bool'),
 ('summer_setpoint','Shared summer thermostat setpoint (°C)','number',5,25),
 ('minimum','Minimum allowed temperature (°C)','number',5,30,0.1),
 ('maximum','Maximum allowed temperature (°C)','number',5,35,0.1),
 ('boost','Heating setpoint boost (°C)','number',0,5),
 ('setback','Idle setpoint reduction (°C)','number',-5,0,0.1),
 ('start_offset_minutes','Raise thermostat before heating starts, minutes','number',0,30),
 ('stop_offset_minutes','Lower thermostat before heating stops, minutes','number',0,30),
 ('lag_hours','Estimated thermal response lag, hours','number',.25,12),
 ('curve_warm_temp','Heating-hours curve warm outdoor temperature (°C)','number',-40,25),
 ('curve_cold_temp','Heating-hours curve cold outdoor temperature (°C)','number',-40,25),
 ('apply_season_setpoints','Apply Active/Passive season setpoints to real thermostats','bool'),
 ('heating_enabled','ThermalPilot active','bool'),
]
ROOM_FIELDS = [
 ('name','Room name','text'), ('thermostat','Thermostat','climate'),
 ('temperature_entity','Room temperature sensor','sensor',{'kind':'temperature'}),
 ('activity_entity','Thermostat relay (optional)','switch',{'kind':'relay'}),
 ('baseline','Target temperature (°C)','number',5,30,0.1),
 ('fireplace_reduction','Fireplace heating compensation','number',-100,0,1),
]


def entity_matches(state, rule, settings=None):
    """Filter choices by semantic metadata, including unit-only template sensors."""
    attrs = state.attributes
    domain = state.entity_id.split('.')[0]
    kind = rule.get('kind')
    device_class = attrs.get('device_class')
    unit = str(attrs.get('unit_of_measurement') or '').strip().lower()
    temperature = device_class == 'temperature' or (not device_class and unit in ('°c', '°f', 'c', 'f', 'k', '°k'))
    if kind == 'relay':
        return domain == 'switch'
    if kind == 'water':
        return (domain == 'climate' and 'current_temperature' in attrs) or (domain == 'sensor' and temperature)
    if kind == 'temperature':
        return temperature
    if kind == 'power':
        return device_class == 'power' or (not device_class and unit in ('w', 'kw'))
    if kind == 'price':
        return any(isinstance(attrs.get(key), (list, tuple)) for key in ('today', 'tomorrow', 'raw_today', 'raw_tomorrow'))
    if kind == 'target':
        return temperature or (domain in ('number', 'input_number') and not device_class and not unit)
    if kind == 'activity':
        if domain in ('binary_sensor', 'switch'):
            return True
        if domain != 'sensor':
            return False
        attribute = (settings or {}).get('activity_attribute')
        if attribute and attribute in attrs:
            return True
        if device_class not in (None, '', 'enum') or unit:
            return False
        # Unitless discrete states are suitable for configurable active-value matching.
        value = str(state.state).strip().lower()
        return device_class == 'enum' or value in ('0', '1') or (number(value) is None and value not in ('unknown', 'unavailable', '')) or 'hvac_action' in attrs
    return True


def setup_selector_config(hass, key):
    """Use the same source rules in Home Assistant's native initial setup form."""
    field = next(field for field in SOURCE_FIELDS if field[0] == key)
    rule = field[3]
    domains = field[2].split(',')
    return {'filter': {'domain': domains[0] if len(domains)==1 else domains}, 'exclude_entities': [
        state.entity_id for domain in domains for state in hass.states.async_all(domain)
        if not entity_matches(state, rule)]}


def stored_settings(data, options):
    """Convert legacy positive reductions when loading stored entries."""
    merged = {**DEFAULTS, **data, **options}
    settings = deepcopy({key:merged[key] for key in DEFAULTS})
    setback = number(settings['setback'])
    if setback is not None and setback > 0:
        settings['setback'] = -setback
    for room in settings['rooms']:
        value = number(room.get('fireplace_reduction'))
        if value is not None and value > 0:
            room['fireplace_reduction'] = -min(100, value)
    return settings


def validate(payload, hass=None):
    if not isinstance(payload, dict):
        raise ValueError('Settings must be an object.')
    result = deepcopy(DEFAULTS)
    result.update({k:v for k,v in payload.items() if k in DEFAULTS})
    def check(obj, fields):
        for field in fields:
            key, label, kind = field[:3]
            value = obj[key]
            if kind == 'number':
                n = number(value)
                if n is None or not field[3] <= n <= field[4]:
                    raise ValueError(f'{label}: value is outside the allowed range.')
                obj[key] = n
            elif kind == 'bool':
                if not isinstance(value, bool):
                    raise ValueError(f'{label}: expected a boolean value.')
            elif kind.startswith('select:'):
                if value not in kind[7:].split(','):
                    raise ValueError(f'{label}: unknown option.')
            else:
                if not isinstance(value, str) or len(value) > 200:
                    raise ValueError(f'{label}: invalid text.')
                obj[key] = value.strip()
                if kind != 'text' and value:
                    if value.split('.')[0] not in kind.split(','):
                        raise ValueError(f'{label}: incorrect entity domain.')
                    if hass is not None and hass.states.get(value) is None:
                        raise ValueError(f'{label}: entity {value} was not found.')
    check(result, SOURCE_FIELDS)
    if result['minimum'] > result['maximum']:
        raise ValueError('Minimum allowed temperature must not exceed maximum allowed temperature.')
    for key in ('minimum_run_minutes','start_offset_minutes','stop_offset_minutes'):
        if result[key] != int(result[key]):
            raise ValueError(f'{key}: use an integer.')
        result[key] = int(result[key])
    if result['curve_cold_temp'] >= result['curve_warm_temp']:
        raise ValueError('Cold curve temperature must be below warm curve temperature.')
    if result['minimum_run_minutes'] % 15:
        raise ValueError('Minimum heating run must be a multiple of 15 minutes.')
    if not result['price_entity'] or not result['outdoor_entity'] or not result['water_entity']:
        raise ValueError('Select price, outdoor temperature and supply water temperature sources.')
    if not isinstance(result['rooms'], list) or len(result['rooms']) > 30:
        raise ValueError('A maximum of 30 rooms is supported.')
    rooms, ids, thermostats = [], set(), set()
    for raw in result['rooms']:
        if not isinstance(raw, dict):
            raise ValueError('Invalid room settings.')
        room = deepcopy(ROOM_DEFAULTS)
        room.update({k:v for k,v in raw.items() if k in ROOM_DEFAULTS and k not in ('curve_min_hours','curve_max_hours')})
        room['id'] = raw.get('id') or str(uuid4())
        try:
            from uuid import UUID
            UUID(room['id'])
        except (ValueError, TypeError, AttributeError):
            raise ValueError('Invalid room identifier.') from None
        check(room, ROOM_FIELDS)
        if not room['name'] or not room['thermostat'] or not room['temperature_entity']:
            raise ValueError('Each room needs a name, thermostat and temperature sensor.')
        if room['id'] in ids or room['thermostat'] in thermostats:
            raise ValueError('Room identifier or thermostat is already in use.')
        ids.add(room['id']); thermostats.add(room['thermostat'])
        if not result['minimum'] <= room['baseline'] <= result['maximum']:
            raise ValueError(f"{room['name']}: normal temperature must be within the allowed temperature range.")
        rooms.append(room)
    result['rooms'] = rooms
    if hass is not None and result['apply_season_setpoints']:
        for room in rooms:
            state = hass.states.get(room['thermostat'])
            low, high = state.attributes.get('min_temp',5), state.attributes.get('max_temp',35)
            if not low <= result['summer_setpoint'] <= high:
                raise ValueError(f"{room['name']}: summer setpoint is outside thermostat limits.")
    return result
