"""Shared settings metadata and server-side validation."""
from copy import deepcopy
from uuid import uuid4
from .const import DEFAULTS, ROOM_DEFAULTS, ZONE_DEFAULTS, AIR_INITIAL_LAG_HOURS, WATER_REFERENCE
from .model import number

# key, label, input type, bounds/domain; used by the dedicated settings panel.
SOURCE_FIELDS = [
 ('air_fan_cool','Cooling fan speed','text'),
 ('air_swing_cool','Cooling swing mode','text'),
 ('air_heat_target','Heat pump heating setpoint (°C)','number',5,35,.5),
 ('air_fan_heat','Heating fan speed','text'),
 ('air_fan_idle','Standby fan speed','text'),
 ('air_swing','Heating swing mode','text'),
 ('air_swing_idle','Standby swing mode','text'),
 ('house_construction','House construction','select:unknown,wooden_detached,masonry_detached,concrete_apartment,heavy_masonry_apartment'),
 ('house_heat_source','Heat source','select:air_to_water,ground_source,air_to_air,electric_resistance,oil_boiler,gas_boiler,wood_boiler,pellet_boiler,district_heating,other'),
 ('house_distribution','Heat distribution','select:water_floor,water_radiators,electric_floor,electric_ceiling,electric_panels,warm_air,mixed,other'),
 ('house_heated_floor','Heated floor','select:concrete_slab,thin_screed,lightweight,not_applicable,unknown'),
 ('house_foundation','Foundation','select:slab_on_ground,crawl_space,basement,other,unknown'),
 ('price_entity','Price sensor','sensor',{'kind':'price'}),
 ('price_forecast_entity','Price forecast (optional)','sensor',{'kind':'price_forecast'}),
 ('price_unit','Source price unit','select:c/kWh,€/kWh'),
 ('pricing_mode','Scheduling mode','select:hourly,quarterly,flexible'),
 ('minimum_run_minutes','Minimum flexible heating run (minutes)','number',15,360,15),
 ('weather_entity','Weather forecast source','weather'),
 ('outdoor_entity','Outdoor temperature','sensor',{'kind':'temperature'}),
 ('wind_entity','Wind speed (optional)','sensor',{'kind':'wind'}),
 ('water_entity','Heating water (optional)','sensor,climate',{'kind':'water'}),
 ('fireplace_entity','Fireplace activity sensor (optional)','sensor,binary_sensor',{'kind':'activity'}),
 ('fireplace_active_state','Fireplace active when','text'),
 ('simulation_enabled','Enable simulation','bool'),
 ('language','Language','select:en,fi,sv,nb,da,de,pt,es,fr,et,lv,lt,pl,it,nl,is,ro,cs,sk,bg,sr,hr,el,sq,hu'),
 ('summer_minimum_temperature','Summer temperature (°C)','number',-20,25,0.1),
 ('summer_setpoint','Shared summer thermostat setpoint (°C)','number',5,25),
 ('minimum','Minimum allowed temperature (°C)','number',5,30,0.1),
 ('maximum','Maximum allowed temperature (°C)','number',5,35,0.1),
 ('boost','Heating setpoint boost (°C)','number',0,5),
 ('setback','Peak-hour reduction (°C)','number',-5,0,0.1),
 ('start_offset_minutes','Raise thermostat before heating starts (minutes)','number',0,30),
 ('stop_offset_minutes','Lower thermostat before heating stops (minutes)','number',0,30),
 ('lag_hours','Estimated thermal response lag (hours)','number',.25,12),
 ('curve_warm_temp','Warm outdoor endpoint (°C)','number',-40,25),
 ('curve_cold_temp','Cold outdoor endpoint (°C)','number',-40,25),
 ('apply_season_setpoints','Apply season setpoints','bool'),
 ('heating_enabled','ThermalPilot active','bool'),
 ('sensor_warning_hours','Sensor warning delay (hours)','number',1,72,1),
]
ROOM_FIELDS = [
 ('name', 'Room name', 'text'),
 ('thermostat', 'Thermostat', 'climate'),
 ('temperature_entity', 'Room temperature sensor', 'sensor', {'kind': 'temperature'}),
 ('activity_entity', 'Thermostat relay (optional)', 'switch', {'kind': 'relay'}),
 ('heating_zone_id', 'Zone (optional)', 'text'),
 ('heat_control', 'Room heating control', 'select:house,air_to_air'),
 ('baseline', 'Target temperature (°C)', 'number', 5, 30, 0.1),
 ('garage_construction','Construction type','select:unknown,timber_frame,masonry,lightweight_metal'),
 ('garage_strategy', 'Heating strategy', 'select:temperature,tariff'),
 ('garage_minimum', 'Lower temperature limit (°C)', 'number', -5, 25, 0.1),
 ('garage_maximum', 'Upper temperature limit (°C)', 'number', -5, 30, 0.1),
 ('garage_heat_target', 'Heat pump heating setpoint (°C)', 'number', 5, 35, 0.5),
 ('garage_fan_heat', 'Heating fan speed', 'text'),
 ('garage_swing', 'Heating swing mode', 'text'),
 ('garage_fan_idle', 'Standby fan speed', 'text'),
 ('garage_swing_idle', 'Standby swing mode', 'text'),
 ('garage_fan_presence', 'Fan mode when occupied', 'text'),
 ('garage_door_delay', 'Pause heating after door opens (seconds)', 'number', 0, 600, 1),
 ('garage_door_entities', 'Door sensors (optional)', 'entities:binary_sensor'),
 ('garage_presence_entities', 'Presence sensors (optional)', 'entities:binary_sensor'),
 ('fireplace_reduction', 'Fireplace heating compensation', 'number', -100, 0, 1),
 ('solar_direction', 'Window direction', 'select:disabled,north,northeast,east,southeast,south,southwest,west,northwest'),
 ('solar_exposure', 'Sun exposure', 'select:clear,partly_shaded,mostly_shaded'),
 ('is_garage', 'Garage', 'bool'),
]


ZONE_FIELDS = [
 ('name', 'Zone name', 'text'),
 ('source_type', 'Zone source', 'select:air_to_air,fireplace'),
 ('thermostat', 'Zone heat pump', 'climate'),
 ('temperature_policy', 'Zone temperature', 'select:main,average,coldest'),
 ('fireplace_entity', 'Zone fireplace sensor (optional)', 'sensor,binary_sensor', {'kind': 'activity'}),
 ('fireplace_active_state', 'Fireplace active when', 'text'),
 ('main_room_id', 'Main room', 'text'),
 ('heating_enabled', 'Control zone heat pump', 'bool'),
 ('climate_mode', 'Heat pump use', 'select:heat,cool,both'),
 ('heating_strategy','Zone heating strategy','select:temperature,tariff'),
 ('cooling_target', 'Cooling target temperature (°C)', 'number', 16, 30, 0.1),
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
    if kind == 'wind':
        return domain == 'sensor' and unit in ('m/s','km/h','mph','kn','knots')
    if kind == 'power':
        return device_class == 'power' or (not device_class and unit in ('w', 'kw'))
    if kind == 'price_forecast':
        return domain == 'sensor' and isinstance(attrs.get('forecast'),(list,tuple))
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


def electric_heating(settings):
    return settings.get('house_heat_source','air_to_water') in ('air_to_water','ground_source','air_to_air','electric_resistance') or any(z.get('source_type','air_to_air')=='air_to_air' for z in (settings.get('heating_zones') if isinstance(settings.get('heating_zones'),list) else []) if isinstance(z,dict)) or any(r.get('is_garage') or r.get('heat_control')=='air_to_air' for r in (settings.get('rooms') if isinstance(settings.get('rooms'),list) else []) if isinstance(r,dict))


def room_electric(room,settings):
    return air_room(room,settings) or room.get('heat_control')=='zone_member' or settings.get('house_heat_source','air_to_water') in ('air_to_water','ground_source','air_to_air','electric_resistance')


def price_required(settings):
    return any(room_electric(r,settings) and r.get('heat_control')!='zone_member' and r.get('zone_climate_mode')!='cool' and r.get('zone_heating_strategy','tariff')=='tariff' and (not r.get('is_garage') or r.get('garage_strategy','temperature')=='tariff') for r in resolved_rooms(settings)+zone_rooms(settings)) or (not settings.get('rooms') and settings.get('house_heat_source','air_to_water') in ('air_to_water','ground_source','air_to_air','electric_resistance'))


def garage_sensor_lists(room):
    """Migrate the original single/two-sensor fields without losing selections."""
    result=deepcopy(room)
    for plural,legacy in [('garage_door_entities',('garage_door_entity','garage_door_entity_2')),('garage_presence_entities',('garage_presence_entity','garage_presence_entity_2'))]:
        values=result.get(plural,[])
        if isinstance(values,list):
            values=list(values)
            for key in legacy:
                value=result.pop(key,None)
                if value and value not in values:values.append(value)
            result[plural]=values
    result.pop('garage_guard_entity',None)
    result.pop('garage_manual_entity',None);result.pop('garage_manual_target_entity',None)
    return result


def resolved_rooms(settings):
    """Zone membership never replaces the room's primary heating controller."""
    zones={z['id']:z for z in settings.get('heating_zones',[]) if isinstance(z,dict) and 'id' in z}
    rooms=[]
    for original in settings.get('rooms',[]):
        if not isinstance(original,dict):continue
        room=garage_sensor_lists(original)
        zone=zones.get(room.get('heating_zone_id'))
        if zone:
            room.update(zone_fireplace_entity=zone.get('fireplace_entity',''),zone_fireplace_active_state=zone.get('fireplace_active_state','on'))
            if zone.get('source_type','air_to_air')=='air_to_air':room['secondary_pump_entity']=zone.get('thermostat','')
        rooms.append(room)
    return rooms


def zone_rooms(settings):
    """Independent virtual controllers for secondary zone pumps and their sensors."""
    result=[]
    for zone in settings.get('heating_zones',[]):
        if zone.get('source_type','air_to_air')!='air_to_air':continue
        members=[r for r in settings.get('rooms',[]) if r.get('heating_zone_id')==zone['id'] and not r.get('is_garage')]
        main=next((room for room in members if room['id']==zone.get('main_room_id')),None)
        if main is None:continue
        for original in [main]+[r for r in members if r is not main]:
            room=garage_sensor_lists(original)
            room.update(id='zone:'+zone['id'] if original is main else 'zone:'+zone['id']+':'+original['id'],
                        source_room_id=original['id'],name=zone.get('name',''),thermostat=zone.get('thermostat',''),activity_entity='',
                        heat_control='air_to_air' if original is main else 'zone_member',secondary_zone=True,
                        zone_policy=zone.get('temperature_policy','main'),zone_control_enabled=zone.get('heating_enabled',True),
                        zone_climate_mode=zone.get('climate_mode','heat'),zone_cooling_target=zone.get('cooling_target',24),
                        zone_heating_strategy=zone.get('heating_strategy','tariff'))
            result.append(room)
    return result


def air_room(room,settings):
    return room.get('heat_control')!='zone_member' and (room.get('is_garage',False) or room.get('heat_control')=='air_to_air' or (room.get('heat_control','house')=='house' and settings.get('house_heat_source')=='air_to_air'))


def room_settings(room,settings):
    effective={**room,'house_construction':settings.get('house_construction','unknown'),**{key:settings[key] for key in ('lag_hours','curve_warm_temp','curve_cold_temp','boost','setback','minimum','maximum')}}
    if air_room(room,settings) or room.get('heat_control')=='zone_member':
        effective['lag_hours']=AIR_INITIAL_LAG_HOURS
        effective['air_control']=True
    if room.get('is_garage'):
        effective.update(minimum=room['garage_minimum'],maximum=room['garage_maximum'],baseline=room['garage_minimum'],boost=room['garage_maximum']-room['garage_minimum'],setback=0)
    return effective



def learning_fingerprint(room,settings):
    effective=room_settings(room,settings)
    effective['water_reference']=WATER_REFERENCE
    room_water=water_distribution(settings) and not effective.get('air_control')
    fingerprint=[effective[k] for k in ('thermostat','temperature_entity','activity_entity','lag_hours','curve_max_hours','curve_min_hours','curve_cold_temp','curve_warm_temp','baseline','water_reference')]+[settings['outdoor_entity'],settings['water_entity'] if room_water else '']
    if effective.get('air_control'):fingerprint+=['air_to_air',room.get('heating_zone_id','') if room.get('secondary_zone') else '']
    elif settings['house_distribution']!='water_floor':fingerprint+=[settings['house_distribution']]
    return fingerprint


def learning_reset_scope(room,old,new):
    if old is None or old==new:return None
    if not room.get('secondary_zone') and len(old)>12 and len(new)>12 and old[12]==new[12]=='air_to_air' and old[:-1]==new[:-1]:return None
    if room.get('heating_zone_id') and len(old)>12 and old[12]=='air_to_air' and not room.get('secondary_zone') and len(new)<=12 and old[1]==new[1]:return None
    # Migration from the former air-response seed changes no learned parameters.
    if len(new)>12 and new[12]=='air_to_air' and old[:3]+old[4:]==new[:3]+new[4:]:return None
    stable_indices=(1,4,5,6,7,8,9,10)
    if room.get('zone_climate_mode')=='cool' and all(len(old)>i and old[i]==new[i] for i in stable_indices):return 'heating_response'
    return 'full'


def water_distribution(settings):
    return settings.get('house_distribution','water_floor') not in ('electric_floor','electric_ceiling','electric_panels','warm_air')


def stored_settings(data, options):
    """Convert legacy positive reductions when loading stored entries."""
    merged = {**DEFAULTS, **data, **options}
    settings = deepcopy({key:merged[key] for key in DEFAULTS})
    setback = number(settings['setback'])
    if setback is not None and setback > 0:
        settings['setback'] = -setback
    settings['rooms']=[garage_sensor_lists(room) for room in settings['rooms']]
    for room in settings['rooms']:
        room.pop('garage_manual_entity',None)
        room.pop('garage_manual_target_entity',None)
        room['solar_direction']=room.get('solar_direction','south' if room.get('solar_heating',False) else 'disabled') if room.get('solar_heating',True) else 'disabled'
        for key,value in ROOM_DEFAULTS.items():
            room.setdefault(key,deepcopy(value))
        room.pop('solar_heating',None)
        value = number(room.get('fireplace_reduction'))
        if value is not None and value > 0:
            room['fireplace_reduction'] = -min(100, value)
    # Preserve the control behavior of zones created before the opt-in switch.
    for zone in settings.get('heating_zones',[]):
        for key,value in ZONE_DEFAULTS.items():
            zone.setdefault(key,True if key=='heating_enabled' else 'tariff' if key=='heating_strategy' else deepcopy(value))
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
            if kind.startswith('entities:'):
                if not isinstance(value,list) or len(value)>100 or any(not isinstance(entity,str) for entity in value):
                    raise ValueError(f'{label}: expected a list of sensor entities.')
                if len(value)!=len(set(value)):raise ValueError(f'{label}: a sensor is selected more than once.')
                for entity in value:
                    if entity.split('.')[0] not in kind[9:].split(',') or len(entity)>200:
                        raise ValueError(f'{label}: incorrect entity domain.')
                    if hass is not None and hass.states.get(entity) is None:raise ValueError(f'{label}: entity {entity} was not found.')
            elif kind == 'number':
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
    fields=[(field[0],field[1],'text') if (field[0]=='water_entity' and not water_distribution(result)) or (field[0] in ('price_entity','price_forecast_entity') and not electric_heating(result)) else field for field in SOURCE_FIELDS]
    check(result,fields)
    if hass is not None and result['fireplace_entity']:
        state=hass.states.get(result['fireplace_entity'])
        if state is not None:
            options=state.attributes.get('options')
            allowed=['on','off'] if result['fireplace_entity'].startswith('binary_sensor.') else options if isinstance(options,list) else None
            if allowed and result['fireplace_active_state'] not in allowed:
                raise ValueError('Fireplace active when: choose a valid state of the selected sensor.')
    if result['minimum'] > result['maximum']:
        raise ValueError('Minimum allowed temperature must not exceed maximum allowed temperature.')
    for key in ('minimum_run_minutes','start_offset_minutes','stop_offset_minutes','sensor_warning_hours'):
        if result[key] != int(result[key]):
            raise ValueError(f'{key}: use an integer.')
        result[key] = int(result[key])
    if result['curve_cold_temp'] >= result['curve_warm_temp']:
        raise ValueError('Cold curve temperature must be below warm curve temperature.')
    if result['minimum_run_minutes'] % 15:
        raise ValueError('Minimum heating run must be a multiple of 15 minutes.')
    if not isinstance(result['rooms'], list) or len(result['rooms']) > 30:
        raise ValueError('A maximum of 30 rooms is supported.')
    zones=[];zone_ids=set()
    if not isinstance(result['heating_zones'],list) or len(result['heating_zones'])>30:raise ValueError('A maximum of 30 zones is supported.')
    for raw in result['heating_zones']:
        if not isinstance(raw,dict):raise ValueError('Invalid zone.')
        zone={**ZONE_DEFAULTS,**{k:v for k,v in raw.items() if k in ZONE_DEFAULTS},'id':raw.get('id') or str(uuid4())}
        try:
            from uuid import UUID
            UUID(zone['id'])
        except (ValueError,TypeError,AttributeError):raise ValueError('Invalid zone identifier.') from None
        check(zone,ZONE_FIELDS)
        if not zone['name'] or (zone['source_type']=='air_to_air' and not zone['thermostat']) or (zone['source_type']=='fireplace' and not zone['fireplace_entity']) or zone['id'] in zone_ids:raise ValueError('Each zone needs a unique identifier, name and selected heat source.')
        if hass is not None and zone['fireplace_entity']:
            state=hass.states.get(zone['fireplace_entity']);options=state.attributes.get('options')
            allowed=['on','off'] if zone['fireplace_entity'].startswith('binary_sensor.') else options if isinstance(options,list) else None
            if allowed and zone['fireplace_active_state'] not in allowed:raise ValueError('Zone fireplace: choose a supported active state.')
        zone_ids.add(zone['id']);zones.append(zone)
    result['heating_zones']=zones
    rooms, ids, thermostats = [], set(), set()
    for raw in result['rooms']:
        if not isinstance(raw, dict):
            raise ValueError('Invalid room settings.')
        raw=garage_sensor_lists(raw)
        room = deepcopy(ROOM_DEFAULTS)
        if 'solar_heating' in raw:
            raw={**raw,'solar_direction':raw.get('solar_direction','south') if raw['solar_heating'] else 'disabled'}
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
        ids.add(room['id'])
        thermostats.add(room['thermostat'])
        if room['is_garage'] and room['heating_zone_id']:
            raise ValueError('A garage must have its own heat pump controller.')
        if room['garage_minimum'] >= room['garage_maximum']:
            raise ValueError('Garage lower limit must be below its upper limit.')
        if room['garage_door_delay'] != int(room['garage_door_delay']):
            raise ValueError('Door pause delay must be an integer.')
        if not room['is_garage'] and not result['minimum'] <= room['baseline'] <= result['maximum']:
            raise ValueError(f"{room['name']}: normal temperature must be within the allowed temperature range.")
        if hass is not None and air_room(room,result):
            state=hass.states.get(room['thermostat'])
            attrs=state.attributes
            if not {'heat','fan_only'}.issubset(attrs.get('hvac_modes',[])) or (room['is_garage'] and 'off' not in attrs.get('hvac_modes',[])):
                raise ValueError(f"{room['name']}: select a heat pump supporting heat and fan-only (and off for a garage).")
            target=room['garage_heat_target'] if room['is_garage'] else result['air_heat_target']
            # Climate limits can describe the current mode (fan-only may report 0–1).
            if state.state=='heat' and not attrs.get('min_temp',5)<=target<=attrs.get('max_temp',35):
                raise ValueError(f"{room['name']}: heat pump heating setpoint {target:g} °C is outside device limits ({attrs.get('min_temp',5):g}–{attrs.get('max_temp',35):g} °C).")
            prefix='garage_' if room['is_garage'] else 'air_'
            values=room if room['is_garage'] else result
            for suffix,attribute in [('fan_heat','fan_modes'),('fan_idle','fan_modes'),('fan_presence','fan_modes'),('swing','swing_modes'),('swing_idle','swing_modes')]:
                selected=values.get(prefix+suffix,'')
                if selected and selected not in attrs.get(attribute,[]):
                    raise ValueError(f"{room['name']}: selected {suffix.replace('_',' ')} is not supported by this heat pump.")
        rooms.append(room)
    for zone in zones:
        if zone['source_type']=='fireplace':continue
        members=[r for r in rooms if r['heating_zone_id']==zone['id']]
        if (members and zone['main_room_id'] not in {r['id'] for r in members}) or (not members and zone['main_room_id']):
            raise ValueError('Each zone needs linked rooms and a main room selected from them.')
        if zone['thermostat'] in thermostats:raise ValueError('A heat pump can have only one controller or zone.')
        thermostats.add(zone['thermostat'])
        if hass is not None and zone['heating_enabled']:
            state=hass.states.get(zone['thermostat']);attrs=state.attributes
            required={'fan_only'}|({'heat'} if zone['climate_mode']=='heat' else {'cool'} if zone['climate_mode']=='cool' else {'heat','cool'})
            if not required.issubset(attrs.get('hvac_modes',[])):raise ValueError('The zone heat pump must support the selected heating/cooling modes and fan-only.')
            if zone['climate_mode'] in ('heat','both') and state.state=='heat' and not attrs.get('min_temp',5)<=result['air_heat_target']<=attrs.get('max_temp',35):raise ValueError(f"{zone['name']}: heat pump heating setpoint {result['air_heat_target']:g} °C is outside device limits ({attrs.get('min_temp',5):g}–{attrs.get('max_temp',35):g} °C).")
            for key,attribute in [('air_fan_heat','fan_modes'),('air_fan_idle','fan_modes'),('air_swing','swing_modes'),('air_swing_idle','swing_modes'),('air_fan_cool','fan_modes'),('air_swing_cool','swing_modes')]:
                if result[key] and result[key] not in attrs.get(attribute,[]):raise ValueError('Shared air-to-air mode is not supported by every selected heat pump.')
    for room in rooms:
        if room['heating_zone_id'] and room['heating_zone_id'] not in zone_ids:raise ValueError('Selected zone was not found.')
        zone=next((z for z in zones if z['id']==room['heating_zone_id']),None)
    result['rooms'] = rooms
    if (price_required(result) and not result['price_entity']) or not result['outdoor_entity']:
        raise ValueError('Select required price and outdoor temperature sources.')
    if hass is not None and (result['apply_season_setpoints'] or not result['simulation_enabled']):
        for room in resolved_rooms(result):
            if air_room(room,result) or room['heat_control']=='zone_member':continue
            state = hass.states.get(room['thermostat'])
            low, high = state.attributes.get('min_temp',5), state.attributes.get('max_temp',35)
            if not low <= result['summer_setpoint'] <= high:
                raise ValueError(f"{room['name']}: summer setpoint is outside thermostat limits.")
    return result


def confirm_control_settings(settings, previous, confirmed=False):
    """A legacy simulation-off preference must never silently enable device writes."""
    settings['live_control_confirmed'] = False
    if not electric_heating(settings):
        settings['simulation_enabled']=True
        return settings
    if not settings['simulation_enabled']:
        already_live = not previous.get('simulation_enabled',True) and previous.get('live_control_confirmed',False)
        if not already_live and confirmed is not True:
            raise ValueError('Confirm live control before turning simulation off. If another automation controls these thermostats, disable it first.')
        settings['live_control_confirmed'] = True
    return settings
