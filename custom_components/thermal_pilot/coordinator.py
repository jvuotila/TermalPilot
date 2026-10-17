"""Read HA states, learn observed response, persist data, publish plans and reconcile opt-in thermostat control."""
from datetime import datetime, timedelta
from copy import deepcopy
import logging
import asyncio
from zoneinfo import ZoneInfo
from homeassistant.core import callback
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator
from homeassistant.helpers.storage import Store
from homeassistant.helpers.event import async_track_point_in_utc_time, async_track_state_change_event
from homeassistant.util import dt as dt_util
from .const import DOMAIN, DEFAULTS, RESERVE_HOURS, ARCHIVE_KEEP_DAYS, WATER_REFERENCE, HISTORY_DAYS
from .history import HistoryDatabase
from .control import ThermostatControl
from .air_control import AirHeatPumpControl, zone_temperature, binary
from .config import stored_settings, water_distribution, electric_heating, air_room, room_settings, resolved_rooms, zone_rooms, room_electric, price_required, learning_fingerprint, learning_reset_scope
from .model import Slot, garage_cycle_plan, number, stamp, initial_model, learn, learning_progress, price_slots, plan, collection_state, thermostat_state, fallback_season, price_forecast_reserve, heat_retention, solar_signal, solar_facing, solar_enabled

_LOGGER = logging.getLogger(__name__)


class PilotCoordinator(DataUpdateCoordinator):
    def __init__(self, hass, entry):
        super().__init__(hass, _LOGGER, name=DOMAIN, update_interval=timedelta(minutes=5))
        self.backup_lock = asyncio.Lock()
        self.entry = entry
        self.settings = stored_settings(entry.data, entry.options)
        self.store = Store(hass, 1, f'{DOMAIN}.{entry.entry_id}')
        self.models = {}
        self.history_db = HistoryDatabase(hass.config.path('.storage', f'{DOMAIN}.{entry.entry_id}.sqlite3'))
        self.previous = {}
        self.forecast = []
        self.forecast_updated = None
        self.forecast_entity = None
        self.forecast_type = None
        self.forecast_error = None
        self.config_fingerprint = {}
        self.suggested_runs = {}
        self.season = {}
        self.applied_season_targets = {}
        self.sensor_health = {'rooms':{},'last_notification_day':None}
        self._command_timer = None
        # Restored HA attributes may not reflect the device after an outage.
        self.control = ThermostatControl(hass, require_initial_write=True)
        self.air_control = AirHeatPumpControl(hass)
        self._air_was_live=False
        self.managed_rooms = {}
        self.fallback_state = {}
        self._plan_settings = None
        self._source_timer = None
        self._source_unsubscribe = None
        self.wind_samples = []
        self.wind_source = None

    def stop(self):
        self.cancel_command_timer()
        if self._source_timer:
            self._source_timer()
            self._source_timer = None
        if self._source_unsubscribe:
            self._source_unsubscribe()
            self._source_unsubscribe = None

    def listen_sources(self):
        if self._source_unsubscribe:
            self._source_unsubscribe()
        entities = {self.settings[key] for key in ('price_entity','price_forecast_entity','outdoor_entity','water_entity','weather_entity','wind_entity','fireplace_entity') if self.settings[key]}
        entities.update(room[key] for room in resolved_rooms(self.settings)+zone_rooms(self.settings) for key in ('temperature_entity','thermostat','activity_entity','zone_fireplace_entity') if room.get(key))
        entities.update(entity for room in resolved_rooms(self.settings) for key in ('garage_door_entities','garage_presence_entities') for entity in room.get(key,[]))
        self._source_unsubscribe = async_track_state_change_event(self.hass,entities,self.source_changed)

    @callback
    def source_changed(self, event):
        """Recover promptly after startup and react to source/relay changes."""
        entity = event.data.get('entity_id')
        old, new = event.data.get('old_state'), event.data.get('new_state')
        if entity == self.settings['weather_entity']:
            self.forecast_updated = None
        thermostats = {room['thermostat'] for room in resolved_rooms(self.settings)+zone_rooms(self.settings)}
        if entity in thermostats and old and new and old.state == new.state and old.attributes.get('hvac_action') == new.attributes.get('hvac_action'):
            return  # Own target acknowledgements do not require replanning.
        if self._source_timer:
            return
        urgent = not old or not new or old.state in ('unknown','unavailable') or new.state in ('unknown','unavailable') or entity in (self.settings['price_entity'],self.settings['price_forecast_entity'])
        async def refresh(_now):
            self._source_timer = None
            await self.async_request_refresh()
        self._source_timer = async_track_point_in_utc_time(self.hass,refresh,dt_util.utcnow()+timedelta(seconds=5 if urgent else 30))

    def cancel_command_timer(self):
        if self._command_timer is not None:
            self._command_timer()
            self._command_timer = None

    def arm_command_timer(self, data, now):
        self.cancel_command_timer()
        future = [stamp(command['time']) for room in [*data.get('rooms',{}).values(),*data.get('zones',{}).values()]
                  for command in (room.get('plan') or {}).get('commands',[]) if stamp(command['time']) > now]
        for room in [*data.get('rooms',{}).values(),*data.get('zones',{}).values()]:
            rows = (room.get('plan') or {}).get('slots',[])
            if rows and stamp(rows[-1]['end']) > now:
                future.append(stamp(rows[-1]['end']))
        future.extend(datetime.fromtimestamp(t,now.tzinfo) for t in self.air_control.deadlines if t>now.timestamp())
        if future:
            self._command_timer = async_track_point_in_utc_time(self.hass,self.update_command_state,min(future))

    async def update_command_state(self, now):
        async with self.backup_lock:
            await self._update_command_state(now)

    async def _update_command_state(self, now):
        """Apply offset transitions without waiting for the regular planning refresh."""
        data = deepcopy(self.data or {})
        for room in [*data.get('rooms',{}).values(),*data.get('zones',{}).values()]:
            if room.get('plan'):
                room['plan'].update(thermostat_state(room['plan'],now))
        data['updated'] = now.isoformat()
        data['control'] = await self.apply_live_targets(data,now)
        data['warnings'] = [w for w in data.get('warnings',[]) if not w.startswith('Thermostat control:')]+[f'Thermostat control: {w}' for w in data['control']['errors']]
        self.async_set_updated_data(data)
        self.arm_command_timer(data,now)

    async def load(self):
        saved = await self.store.async_load() or {}
        self.models = saved.get('models', {})
        for model in self.models.values():
            model['response'] = 0.0  # Thermal response cannot be trusted across downtime.
            bank=model.get('air_lag_learning',{})
            bank.pop('last_time',None)
            for profile in bank.get('profiles',{}).values():profile['response']=0.0
        self.season = saved.get('season', {})
        self.air_control.zone_seasons=saved.get('zone_seasons',{})
        self.air_control.thermal_modes=saved.get('pump_thermal_modes',{})
        self.air_control.reversals=saved.get('pump_reversals',{})
        self.applied_season_targets = saved.get('applied_season_targets', {})
        self.fallback_state = saved.get('fallback_state',{})
        self.managed_rooms = {room['thermostat']:room for room in saved.get('managed_rooms',{}).values()}
        self.sensor_health = saved.get('sensor_health', {'rooms':{},'last_notification_day':None})
        await self.hass.async_add_executor_job(self.history_db.initialize)
        self.config_fingerprint = saved.get('fingerprints', {})

    def chart_temperatures(self):
        """Current sensor values even when planning is passive; zone policy matches control."""
        rooms={room['id']:self.value(room['temperature_entity']) for room in self.settings['rooms']}
        zones={zone['id']:None for zone in self.settings.get('heating_zones',[])}
        for room in zone_rooms(self.settings):
            if room['id']=='zone:'+room['heating_zone_id']:
                zones[room['heating_zone_id']]=zone_temperature(self.hass,room,self.settings)[0]
        def target(entity):
            state=self.hass.states.get(entity) if entity else None
            return number(state.attributes.get('temperature')) if state and state.state not in ('unknown','unavailable') else None
        targets={'rooms':{room['id']:target(room.get('thermostat')) for room in self.settings['rooms']},
                 'zones':{zone['id']:target(zone.get('thermostat')) for zone in self.settings.get('heating_zones',[])}}
        return {'rooms':rooms,'zones':zones,'targets':targets}

    def collection_evidence(self):
        """Use the least-observed configured room for house-wide coverage."""
        models = [self.models.get(room['id'], {}) for room in resolved_rooms(self.settings)]
        return {'rooms':len(models),
                'heating_hours':min((m.get('heated_hours',0) for m in models),default=0),
                'idle_hours':min((m.get('idle_hours',0) for m in models),default=0)}

    def value(self, entity):
        state = self.hass.states.get(entity) if entity else None
        return number(state.state) if state else None

    def wind_reading(self, now):
        """Optional, bounded, smoothed input; frozen readings expire after two hours."""
        entity=self.settings['wind_entity']
        if entity!=self.wind_source:self.wind_samples=[];self.wind_source=entity
        status={'enabled':bool(entity),'available':False,'speed':None}
        if not entity:return status
        state=self.hass.states.get(entity)
        value=number(state.state) if state else None
        factors={'m/s':1,'km/h':1/3.6,'mph':.44704,'kn':.514444,'knots':.514444}
        unit=str(state.attributes.get('unit_of_measurement','')).strip().lower() if state else ''
        times=[getattr(state,key,None) for key in ('last_updated','last_reported')] if state else []
        fresh=[t for t in times if hasattr(t,'timestamp')]
        valid=state and state.state not in ('unknown','unavailable') and value is not None and unit in factors and fresh
        if valid:
            value*=factors[unit]
            valid=0<=value<=60 and all(0<=now.timestamp()-t.timestamp()<=7200 for t in fresh)
        if not valid:
            self.wind_samples=[]
            status['reason']='Missing, stale or invalid wind reading; normal temperature-based planning continues.'
            return status
        bucket=int(now.timestamp())//300*300
        self.wind_samples=[(t,v) for t,v in self.wind_samples if t>=now.timestamp()-1800 and t!=bucket]
        self.wind_samples.append((bucket,value))
        status.update(available=True,speed=sum(v for _,v in self.wind_samples)/len(self.wind_samples))
        return status

    def activity(self, room):
        entity = room['activity_entity'] or room['thermostat']
        state = self.hass.states.get(entity)
        if state is None or state.state in ('unknown','unavailable'):
            return None
        if not room['activity_entity']:
            value = state.attributes.get('hvac_action')
            if value=='heating':return 1.0
            if value in ('idle','off','fan') or ((air_room(room,self.settings) or room.get('heat_control')=='zone_member') and state.state in ('fan_only','off')):return 0.0
            if value is None and (air_room(room,self.settings) or room.get('heat_control')=='zone_member') and state.state=='heat':return 1.0  # Observed operating mode proxy, not measured heat output.
            return None
        value = state.state
        if value is None or str(value) in ('unknown','unavailable'):
            return None
        return 1.0 if value == 'on' else 0.0 if value == 'off' else None

    def storage_data(self):
        return {'models':self.models,'season':self.season,'zone_seasons':self.air_control.zone_seasons,'pump_thermal_modes':self.air_control.thermal_modes,'pump_reversals':self.air_control.reversals,
                'applied_season_targets':self.applied_season_targets,
                'fingerprints':self.config_fingerprint,'sensor_health':self.sensor_health,'managed_rooms':self.managed_rooms,'fallback_state':self.fallback_state}

    def zone_observations(self,now):
        rows=[]
        for zone in self.settings.get('heating_zones',[]):
            fireplace=zone.get('source_type')=='fireplace'
            entity=zone.get('fireplace_entity','') if fireplace else zone.get('thermostat','')
            state=self.hass.states.get(entity) if entity else None
            mode=None;basis='activity'
            if state and state.state not in ('unknown','unavailable'):
                if fireplace:
                    mode='heat' if state.state==zone.get('fireplace_active_state','on') else None
                    basis='fireplace'
                else:
                    action=state.attributes.get('hvac_action')
                    if action in ('heating','cooling'):mode='heat' if action=='heating' else 'cool'
                    elif action is None:
                        mode=state.state if state.state in ('heat','cool') else None
                        basis='operating_mode'
            rows.append({'zone_id':zone['id'],'room_id':'zone:'+zone['id'],'time':now.timestamp(),
                         'zone_mode':mode,'zone_basis':basis,'zone_entity':entity})
        return rows

    def learning_changes(self,settings):
        changes=[]
        for room in resolved_rooms(settings):
            old=self.config_fingerprint.get(room['id'])
            scope=learning_reset_scope(room,old,learning_fingerprint(room,settings))
            model=self.models.get(room['id'],{})
            evidence=any(model.get(key,0)>0 for key in ('samples','heated_hours','idle_hours','parameter_updates')) or model.get('retention_learned')
            if scope and evidence:changes.append({'room_id':room['id'],'name':room['name'],'scope':scope})
        return changes

    async def check_temperature_sensors(self, now, active):
        """Warn once per local day after the configured interval of continuous suspect readings."""
        tracking = self.sensor_health.setdefault('rooms',{})
        if not active:
            tracking.clear()
            return
        timestamp = now.timestamp()
        warning_hours = self.settings['sensor_warning_hours']
        configured = {room['id'] for room in resolved_rooms(self.settings)}
        for rid in list(tracking):
            if rid not in configured:
                tracking.pop(rid)
        suspect = []
        for room in resolved_rooms(self.settings):
            rid, entity = room['id'], room['temperature_entity']
            value = self.value(entity)
            previous = tracking.get(rid,{})
            # Do not count time across a long outage or a changed sensor mapping.
            if (previous.get('entity') != entity or previous.get('value') != value or
                    timestamp-previous.get('last_seen',timestamp) > 1800 or
                    timestamp < previous.get('last_seen',timestamp)):
                previous = {'entity':entity,'value':value,'since':timestamp}
            previous['last_seen'] = timestamp
            previous.setdefault('since',timestamp)
            tracking[rid] = previous
            if timestamp-previous['since'] >= warning_hours*3600:
                reason = 'unavailable' if value is None else f'unchanged at {value:g} °C'
                suspect.append(f"- {room['name']}: {reason} for at least {warning_hours:g} hours ({entity}).")
        day = now.astimezone(ZoneInfo(self.hass.config.time_zone)).date().isoformat()
        if not suspect or self.sensor_health.get('last_notification_day') == day:
            return
        message = ('These room temperature sensors may need checking:\n\n'+
                   '\n'.join(suspect)+
                   '\n\nAn unchanged reading can also mean the room temperature is stable. Check batteries, connectivity and sensor readings. ThermalPilot issues at most one sensor notification per day.')
        try:
            await self.hass.services.async_call('persistent_notification','create',{
                'title':'ThermalPilot: check room temperature sensors',
                'message':message,
                'notification_id':f'{DOMAIN}_{self.entry.entry_id}_temperature_sensors',
            },blocking=True)
        except Exception:
            _LOGGER.warning('Room sensor notification could not be created',exc_info=True)
            return
        self.sensor_health['last_notification_day'] = day
        # Persist the daily limit immediately so a restart does not repeat the alert.
        await self.store.async_save(self.storage_data())

    async def get_forecast(self, now):
        entity = self.settings['weather_entity']
        if not entity:
            self.forecast = []
            self.forecast_type = None
            self.forecast_error = 'No weather forecast source is selected.'
            return []
        if entity == self.forecast_entity and self.forecast_updated is not None and (now-self.forecast_updated).total_seconds() < (3600 if self.forecast else 300):
            return self.forecast
        def usable(rows, kind):
            if not isinstance(rows, list):
                return []
            return [row for row in rows if isinstance(row,dict) and stamp(row.get('datetime')) is not None and
                    number(row.get('templow',row.get('temperature')) if kind=='daily' else row.get('temperature')) is not None]
        self.forecast = []
        self.forecast_type = None
        errors = []
        previous_error = self.forecast_error
        for kind in ('hourly','twice_daily','daily'):
            try:
                result = await self.hass.services.async_call('weather', 'get_forecasts',
                    {'entity_id':entity, 'type':kind}, blocking=True, return_response=True)
                raw_rows = (result or {}).get(entity, {}).get('forecast', [])
                rows = usable(raw_rows,kind)
                if rows:
                    self.forecast, self.forecast_type = rows, kind
                    break
                errors.append(f'{kind}: no usable timestamped temperature rows returned')
            except Exception as error:
                errors.append(f'{kind}: {type(error).__name__}: {error}')
                _LOGGER.debug('Forecast type %s unavailable for %s',kind,entity,exc_info=True)
        if not self.forecast:
            state = self.hass.states.get(entity)
            rows = state.attributes.get('forecast', []) if state else []
            kind = 'daily' if isinstance(rows,list) and any(isinstance(row,dict) and 'templow' in row for row in rows) else 'hourly'
            self.forecast = usable(rows,kind)
            self.forecast_type = kind if self.forecast else None
        self.forecast_error = None if self.forecast else f'{entity}: '+ '; '.join(errors)
        if self.forecast_error and self.forecast_error != previous_error:
            _LOGGER.warning('Weather forecast unavailable: %s', self.forecast_error)
        self.forecast_updated = now
        self.forecast_entity = entity
        return self.forecast

    def weather_chart_forecast(self, now):
        """Expose real hourly forecast rows for display, independently of planning."""
        if self.forecast_type != 'hourly':
            return []
        state = self.hass.states.get(self.settings.get('weather_entity'))
        unit = str(state.attributes.get('temperature_unit','°C') if state else '°C').lower()
        if unit not in ('°c','c','celsius','°f','f','fahrenheit','k','kelvin'):
            return []
        conditions = {'clear-night','cloudy','exceptional','fog','hail','lightning',
                      'lightning-rainy','partlycloudy','pouring','rainy','snowy',
                      'snowy-rainy','sunny','windy','windy-variant'}
        rows = {}
        for row in self.forecast:
            date = stamp(row.get('datetime'))
            temperature = number(row.get('temperature'))
            if date is None or temperature is None or not now-timedelta(hours=1) < date <= now+timedelta(days=7):
                continue
            if unit in ('°f','f','fahrenheit'):
                temperature = (temperature-32)*5/9
            elif unit in ('k','kelvin'):
                temperature -= 273.15
            condition = row.get('condition')
            rows[date] = {'datetime':date.isoformat(),'temperature':round(temperature,2),
                          'condition':condition if isinstance(condition,str) and condition in conditions else ''}
        return [rows[date] for date in sorted(rows)][:168]

    def committed_session(self, rid, now):
        """Keep a published session once its advance opening time has arrived."""
        previous_data=getattr(self,'data',None) or {}
        previous_plan = (previous_data.get('zones',{}).get(rid[5:],{}) if rid.startswith('zone:') else previous_data.get('rooms',{}).get(rid,{})).get('plan') or {}
        for session in previous_plan.get('sessions',[]):
            start, end = stamp(session['start']), stamp(session['end'])
            configured=next((r for r in resolved_rooms(self.settings)+zone_rooms(self.settings) if r['id']==rid),{})
            opening = start-timedelta(minutes=self.settings['start_offset_minutes'] if water_distribution(self.settings) and not air_room(configured,self.settings) and configured.get('heat_control')!='zone_member' else 0)
            if opening <= now < end:
                return deepcopy(session)
        return None

    async def _async_update_data(self):
        async with self.backup_lock:
            return await self._update_data()

    async def _update_data(self):
        self.cancel_command_timer()
        now = dt_util.utcnow()
        plan_settings = deepcopy(self.settings)
        outdoor = self.value(self.settings['outdoor_entity'])
        source = self.hass.states.get(self.settings['price_entity'])
        heating_active = self.settings['heating_enabled']
        await self.hass.async_add_executor_job(self.history_db.append_zones,self.zone_observations(now),now.timestamp()-HISTORY_DAYS*86400)
        forecasts = await self.get_forecast(now)
        self.fallback_state = fallback_season(self.fallback_state,forecasts,self.forecast_type,outdoor,now,ZoneInfo(self.hass.config.time_zone),self.settings['summer_minimum_temperature'])
        await self.check_temperature_sensors(now,heating_active)
        setpoint_errors = await self.apply_season_targets(heating_active)
        previous_season = dict(self.season)
        self.season = collection_state(self.season,outdoor,now.timestamp(),self.settings)
        self.season['collecting'] = self.season['collecting'] and heating_active
        self.season['heating_active'] = heating_active
        local_now = now.astimezone(ZoneInfo(self.hass.config.time_zone))
        year = local_now.year if local_now.month>=7 else local_now.year-1
        season_id = self.season.get('season_id')
        if self.season['collecting'] and not previous_season.get('collecting'):
            season_id = f'{year}-{year+1}'
        self.season['season_id'] = season_id or f'{year}-{year+1}'
        if previous_season.get('heating_active') and not heating_active:
            keep_since = now.timestamp()-ARCHIVE_KEEP_DAYS*86400
            await self.hass.async_add_executor_job(self.history_db.compact_season,
                previous_season.get('season_id',self.season['season_id']), deepcopy(self.models),deepcopy(self.config_fingerprint),keep_since)
            self.season['last_compaction'] = now.isoformat()
        if not heating_active:
            self.previous.clear()
            self.suggested_runs.clear()
            for model in self.models.values():
                model['response'] = 0.0
            cutoff = now.timestamp()-HISTORY_DAYS*86400
            await self.hass.async_add_executor_job(self.history_db.append, [], cutoff, self.season['season_id'])
            self.store.async_delay_save(self.storage_data,20)
            data = {'updated':now.isoformat(),'simulation_only':not self.live_enabled() and not self.settings['apply_season_setpoints'],'heating_active':False,
                'collection':self.season,'zones':{},'collection_evidence':self.collection_evidence(),'warnings':['ThermalPilot is passive. Planning, collection and learning are stopped.']+setpoint_errors,
                'rooms':{},'outdoor':outdoor,'water':None,'weather_forecast':self.weather_chart_forecast(now),
                'season_summaries':await self.hass.async_add_executor_job(self.history_db.summaries),
                'history_info':await self.hass.async_add_executor_job(self.history_db.size)}
            self._plan_settings = plan_settings
            data['fallback_season'] = self.fallback_summary()
            data['control'] = await self.apply_live_targets(data,now)
            data['warnings'].extend(f'Thermostat control: {w}' for w in data['control']['errors'])
            return data
        scheduling=price_required(self.settings)
        warnings = list(setpoint_errors)
        if not electric_heating(self.settings):warnings.append('Observation only: this heat source does not use electricity-price scheduling or thermostat control.')
        if scheduling and not self.settings['simulation_enabled'] and not self.settings.get('live_control_confirmed'):
            warnings.append('Live control awaits confirmation. Enable simulation, save, then disable it and confirm to activate thermostat control.')
        if not self.season['collecting']:
            warnings.append('History collection and learning paused because outdoor temperature is unavailable. Existing model parameters are retained.')
        slots = []
        chart_prices = []
        if not scheduling:
            pass
        elif source is None or source.state in ('unknown','unavailable'):
            warnings.append('Price sensor is missing or unavailable.')
        else:
            try:
                slots = price_slots(source.attributes, self.settings, now, ZoneInfo(self.hass.config.time_zone))
                midnight = local_now.replace(hour=0,minute=0,second=0,microsecond=0)
                chart_prices = [{'start':s.start.isoformat(),'end':s.end.isoformat(),'price':s.price}
                    for s in (price_slots(source.attributes,self.settings,midnight,ZoneInfo(self.hass.config.time_zone)) or slots)]
            except ValueError as error:
                warnings.append(str(error))
        if scheduling and not slots:
            warnings.append('No continuous prices from now: no heating plan is available.')
        if not forecasts:
            warnings.append('No weather forecast: current outdoor temperature is held constant. '+(self.forecast_error or 'No usable forecast was returned.'))
        price_outlook = {'enabled':scheduling and bool(self.settings['price_forecast_entity']),'reserve_hours':RESERVE_HOURS,'available':False}
        if price_outlook['enabled'] and slots:
            predicted_source=self.hass.states.get(self.settings['price_forecast_entity'])
            attrs=predicted_source.attributes if predicted_source and predicted_source.state not in ('unknown','unavailable') else {}
            price_outlook.update(price_forecast_reserve(attrs,slots[-1].end,RESERVE_HOURS))
            if not price_outlook['available']:
                warnings.append('Optional price forecast unavailable; planning uses confirmed prices and the normal heat reserve.')
        wind_status=self.wind_reading(now)
        if wind_status['enabled'] and not wind_status['available']:
            warnings.append('Optional wind sensor unavailable or stale; heating and temperature-based planning continue.')
        latitude=getattr(self.hass.config,'latitude',None)
        longitude=getattr(self.hass.config,'longitude',None)
        weather_state=self.hass.states.get(self.settings['weather_entity']) if self.settings['weather_entity'] else None
        weather_values=None
        if weather_state and weather_state.state not in ('unknown','unavailable'):
            updated=getattr(weather_state,'last_updated',None)
            if isinstance(updated,datetime) and 0<=(now-updated).total_seconds()<=7200:
                weather_values={**weather_state.attributes,'condition':weather_state.state}
        current_solar=solar_signal(now,latitude,longitude,weather_values)
        solar_forecast=[]
        for slot in slots:
            midpoint=slot.start+(slot.end-slot.start)/2
            matches=[]
            for row in forecasts:
                date=stamp(row.get('datetime'))
                if not date:continue
                if self.forecast_type=='daily':
                    valid=date.astimezone(ZoneInfo(self.hass.config.time_zone)).date()==midpoint.astimezone(ZoneInfo(self.hass.config.time_zone)).date()
                else:valid=0<=(midpoint-date).total_seconds()<= (7200 if self.forecast_type=='hourly' else 43200)
                if valid:matches.append((date,row))
            values=max(matches,key=lambda item:item[0])[1] if matches else None
            solar_forecast.append(solar_signal(midpoint,latitude,longitude,values))
        outdoors = []
        for slot in slots:
            points = []
            for f in forecasts:
                date = stamp(f.get('datetime'))
                temp = number(f.get('templow',f.get('temperature')) if self.forecast_type=='daily' else f.get('temperature'))
                if date and temp is not None:
                    points.append((date, temp))
            earlier = [p for p in points if p[0] <= slot.start]
            outdoors.append(max(earlier, key=lambda p:p[0])[1] if earlier else outdoor)
        uses_water=water_distribution(self.settings) and any(not air_room(r,self.settings) and r.get('heat_control')!='zone_member' for r in resolved_rooms(self.settings))
        water_state = self.hass.states.get(self.settings['water_entity']) if uses_water and self.settings['water_entity'] else None
        water = number(water_state.attributes.get('current_temperature') if self.settings['water_entity'].startswith('climate.') else water_state.state) if water_state else None
        if uses_water and water is None:
            warnings.append('Heating water temperature is not available; planning and learning use observed thermostat demand without water-temperature adjustment.')
        fireplace_state = self.hass.states.get(self.settings['fireplace_entity']) if self.settings['fireplace_entity'] else None
        fireplace = bool(fireplace_state and fireplace_state.state == self.settings['fireplace_active_state'])
        readings, room_data = [], {}
        for configured_room in resolved_rooms(self.settings)+[r for r in zone_rooms(self.settings) if r['heat_control']!='zone_member']:
            room = {**room_settings(configured_room,self.settings), 'water_reference':WATER_REFERENCE}
            room_water=uses_water and not room.get('air_control')
            zone_fire=self.hass.states.get(room.get('zone_fireplace_entity','')) if room.get('zone_fireplace_entity') else None
            room_fireplace=False if room.get('is_garage') else bool(zone_fire and zone_fire.state==room.get('zone_fireplace_active_state','on')) if room.get('zone_fireplace_entity') else fireplace
            rid = room['id']
            temperature = zone_temperature(self.hass,room,self.settings)[0] if room.get('secondary_zone') else self.value(room['temperature_entity'])
            baseline = room['baseline']
            if baseline is not None:
                room['baseline'] = baseline
            model = self.models.setdefault(rid, initial_model(room))
            # Reset only affected model when heat source / room / activity / lag mapping changes.
            fingerprint=learning_fingerprint(configured_room,self.settings)
            old_fingerprint=self.config_fingerprint.get(rid)
            reset_scope=learning_reset_scope(configured_room,old_fingerprint,fingerprint)
            if reset_scope:
                previous_model=model
                model = self.models[rid] = initial_model(room)
                # A cooling-only zone changes the controller and response timing,
                # not the room's observed passive heat loss. Keep that coefficient
                # when the temperature sensors and thermal inputs are unchanged.
                old_loss=number(previous_model.get('loss'))
                if reset_scope=='heating_response' and old_loss is not None and old_loss>0:
                    model['loss']=old_loss
                    model['retention_learned']=bool((heat_retention(previous_model) or {}).get('updated'))
                self.previous.pop(rid, None)
            # Upgrade only the unchanged default garage prior; never replace a fit
            # or retained room loss, and keep its accepted observations intact.
            if room.get('is_garage') and not model.get('parameter_updates',0) and not model.get('retention_learned') and model.get('loss')==.007:
                model['loss']=initial_model(room)['loss']
                model['parameter_updates']=0
            self.config_fingerprint[rid] = fingerprint
            if model.get('wind_source','')!=self.settings['wind_entity']:
                for key in ('wind_loss','wind_statistics','wind_updates'):model.pop(key,None)
                model['wind_source']=self.settings['wind_entity']
                self.previous.pop(rid,None)
            solar_context=[room.get('solar_direction','disabled'),room.get('solar_exposure','clear'),self.settings['weather_entity'],latitude,longitude]
            if model.get('solar_context',['disabled',room.get('solar_exposure','clear'),self.settings['weather_entity'],latitude,longitude])!=solar_context:
                for key in ('solar_gain','solar_statistics','solar_updates'):model.pop(key,None)
                self.previous.pop(rid,None)
            model['solar_context']=solar_context
            if not self.season['collecting']:
                model['response'] = 0.0
            activity = self.activity(room)
            thermostat_state = self.hass.states.get(room['thermostat'])
            pump_mode=None;pump_basis='activity'
            if room.get('air_control') and thermostat_state and thermostat_state.state not in ('unknown','unavailable'):
                action=thermostat_state.attributes.get('hvac_action')
                if action in ('heating','cooling'):pump_mode='heat' if action=='heating' else 'cool'
                elif action is None:
                    pump_mode=thermostat_state.state if thermostat_state.state in ('heat','cool') else None
                    pump_basis='operating_mode'
            actual_request = number(thermostat_state.attributes.get('temperature')) if thermostat_state else None
            result = {'name':room['name'], 'temperature':temperature, 'actual_activity':activity,
                      'actual_setpoint':actual_request, 'baseline':baseline, 'model':deepcopy(model), 'plan':None, 'forecast_context':fingerprint+[self.settings['wind_entity']]+solar_context}
            if temperature is None or outdoor is None or baseline is None :
                result['error'] = 'Room temperature, outdoor temperature or target temperature is unavailable.'
                self.previous.pop(rid, None)
            elif not room['minimum'] <= baseline <= room['maximum']:
                result['error'] = 'Target temperature is outside the allowed temperature range.'
                self.previous.pop(rid, None)
            else:
                water_factor = max(.25,min(2,(water-temperature)/max(1,room['water_reference']-temperature))) if room_water and water is not None else 1.0
                current = {'time':now.timestamp(), 'temperature':temperature, 'outdoor':outdoor,
                           'activity':activity, 'water':water if room_water else None, 'water_factor':water_factor, 'wind':wind_status['speed'], 'solar':(current_solar*solar_facing(now,latitude,longitude,room.get('solar_direction','south')) if current_solar is not None else None) if solar_enabled(room) else None, 'excluded':bool(thermostat_state and (thermostat_state.state=='cool' or thermostat_state.attributes.get('hvac_action')=='cooling')) or room_fireplace or (room.get('is_garage') and any(binary(self.hass,entity) is not False for entity in room.get('garage_door_entities',[])))}
                if room.get('secondary_zone'):
                    members=[r for r in resolved_rooms(self.settings) if r.get('heating_zone_id')==room['heating_zone_id']]
                    current['excluded']=current['excluded'] or any(self.activity(member)==1 for member in members)
                else:
                    secondary=self.hass.states.get(room.get('secondary_pump_entity',''))
                    current['excluded']=current['excluded'] or bool(secondary and (secondary.state=='cool' or secondary.attributes.get('hvac_action') in ('heating','cooling') or (secondary.attributes.get('hvac_action') is None and secondary.state in ('heat','cool'))))
                prediction = None
                if self.season['collecting'] and rid in self.previous:
                    prediction = learn(model, room, self.previous[rid], current)
                if self.season['collecting']:
                    self.previous[rid] = current
                else:
                    self.previous.pop(rid,None)
                if room_electric(room,self.settings) and room.get('heat_control')!='zone_member' and not (room.get('secondary_zone') and (room.get('zone_heating_strategy')=='temperature' or room.get('zone_climate_mode')=='cool' or self.air_control.zone_season(room['heating_zone_id'],self.fallback_state.get('summer',False),now.timestamp()))) and slots and all(t is not None for t in outdoors):
                    run = self.suggested_runs.get(rid,{})
                    settings = {**room, 'terminal_reserve_hours':price_outlook['reserve_hours'],
                        'wind_speed':wind_status['speed'], 'solar_forecast':[value*solar_facing(slot.start+(slot.end-slot.start)/2,latitude,longitude,room.get('solar_direction','south')) if value is not None else None for value,slot in zip(solar_forecast,slots)],
                        'start_offset_minutes':self.settings['start_offset_minutes'] if room_water else 0, 'stop_offset_minutes':self.settings['stop_offset_minutes'] if room_water else 0,
                        'boost':room['boost'], 'setback':room['setback'],
                        'minimum_run_minutes':self.settings['minimum_run_minutes'] if self.settings['pricing_mode']=='flexible' else 60 if self.settings['pricing_mode']=='hourly' else 15,
                        'committed_session':self.committed_session(rid,now),
                        'previous_suggested_heat':run.get('heat',False),
                        'previous_control_mode':run.get('mode','boost' if run.get('heat') else 'normal'),
                        'reduction_available':run.get('reduction_available',run.get('heat',False)),
                        'previous_run_hours':max(0,(now.timestamp()-run.get('since',now.timestamp()))/3600)}
                    if room.get('is_garage') and room['garage_strategy']=='temperature':
                        result['plan']=garage_cycle_plan(settings,model,temperature,outdoors,slots,now,self.air_control.cycles.get(rid,{}).get('heating',bool(thermostat_state and thermostat_state.state=='heat')))
                    else:
                        planning_temperature=temperature
                        if planning_temperature is not None:
                            result['plan'] = await self.hass.async_add_executor_job(plan, settings, deepcopy(model),
                                planning_temperature, outdoors, slots, now, baseline, water_factor, room_fireplace)
                if room.get('is_garage') and room['garage_strategy']=='temperature' and not slots:
                    cycle_slots=[Slot(now+timedelta(minutes=15*i),now+timedelta(minutes=15*(i+1)),0) for i in range(96)]
                    result['plan']=garage_cycle_plan(room,model,temperature,[outdoor]*96,cycle_slots,now,self.air_control.cycles.get(rid,{}).get('heating',bool(thermostat_state and thermostat_state.state=='heat')))
                    result['plan']['prices_used']=False
                if result['plan'] and room.get('air_control'):
                    result['plan']['air_control']=True
                    result['plan']['device_target']=room['garage_heat_target'] if room.get('is_garage') else self.settings['air_heat_target']
                if result['plan']:
                    heat = result['plan']['scheduled_heat']
                    old = self.suggested_runs.get(rid,{})
                    self.suggested_runs[rid] = {'heat':heat,'mode':result['plan'].get('scheduled_mode','boost' if heat else 'normal'),'reduction_available':result['plan'].get('reduction_available',heat),'since':old.get('since',now.timestamp()) if old.get('heat')==heat else now.timestamp()}
                result['model'] = deepcopy(model)
                result['one_step_prediction'] = prediction
                if self.season['collecting'] and not room.get('secondary_zone'):
                    readings.append({'room_id':rid, **current, **({'pump_mode':pump_mode,'pump_basis':pump_basis,'pump_entity':room['thermostat']} if room.get('air_control') else {}), 'forecast_context':fingerprint+[self.settings['wind_entity']]+solar_context, 'actual_setpoint':actual_request,
                                 'prediction':prediction, 'suggested_heat':result['plan']['heat'] if result['plan'] else None,
                                 'suggested_setpoint':result['plan']['setpoint'] if result['plan'] else None,
                                 'price':slots[0].price if slots else None})
            if not self.season['collecting']:
                result['learning_note'] = 'Learning paused while collection is inactive.'
            elif activity is None:
                result['learning_note'] = 'No observed heating activity: learning is waiting.'
            elif model['heated_hours'] < 12 or model['idle_hours'] < 12:
                result['learning_note'] = 'Initial model: needs at least 12 heating hours and 12 idle hours.'
            else:
                result['learning_note'] = 'Model adapting to observations; assess reliability from prediction error.'
            result['air_control']=bool(room.get('air_control'))
            result['activity_basis']='heat_mode' if room.get('air_control') and not room['activity_entity'] and thermostat_state and thermostat_state.attributes.get('hvac_action') is None else 'demand'
            result['is_garage']=room.get('is_garage',False)
            result['heating_zone_id']=room.get('heating_zone_id','')
            if room.get('heat_control')=='zone_member':result['zone_monitor']=True
            result['learning_progress'] = learning_progress(model,now)
            result['heat_retention'] = heat_retention(model,room)
            room_data[rid] = result
        zone_data={rid[5:]:room_data.pop(rid) for rid in list(room_data) if rid.startswith('zone:')}
        cutoff = now.timestamp()-HISTORY_DAYS*86400
        await self.hass.async_add_executor_job(self.history_db.append, readings, cutoff, self.season['season_id'])
        await self.hass.async_add_executor_job(self.history_db.record_forecasts,room_data,now.timestamp(),cutoff)
        accuracy = await self.hass.async_add_executor_job(self.history_db.forecast_accuracy,now.timestamp()-7*86400)
        for rid, room in room_data.items():
            room['forecast_accuracy']=accuracy.get(rid,{})
        # Model parameters are small; sample history lives in SQLite.
        self.store.async_delay_save(self.storage_data,20)
        archives = await self.hass.async_add_executor_job(self.history_db.summaries)
        history_info = await self.hass.async_add_executor_job(self.history_db.size)
        data = {'season_summaries':archives,'history_info':history_info, 'updated':now.isoformat(), 'simulation_only':not self.live_enabled() and not self.settings['apply_season_setpoints'], 'warnings':warnings,
                'heating_active':True, 'collection':self.season, 'outdoor':outdoor, 'water':water, 
                'rooms':room_data,'price_chart':chart_prices,'weather_forecast':self.weather_chart_forecast(now),'price_outlook':price_outlook,'wind':wind_status,
                'zones':zone_data,'collection_evidence':self.collection_evidence(),
                'source_status':{'prices':bool(slots),'prices_required':scheduling,'outdoor':outdoor is not None,'water':water is not None or not uses_water,'water_required':False},
                'fallback_season':self.fallback_summary()}
        self._plan_settings = plan_settings
        data['control'] = await self.apply_live_targets(data,now)
        data['warnings'].extend(f'Thermostat control: {w}' for w in data['control']['errors'])
        self.arm_command_timer(data,now)
        return data

    def fallback_summary(self):
        return {'season':'summer' if self.fallback_state.get('summer') else 'winter',
                'daily_minimum':self.fallback_state.get('daily_minimum'),
                'forecast_complete':self.fallback_state.get('complete',False),'threshold':self.settings['summer_minimum_temperature']}

    def fallback_target(self, room):
        return self.settings['summer_setpoint'] if self.fallback_state.get('summer') else room['baseline']

    def live_enabled(self):
        return electric_heating(self.settings) and not self.settings['simulation_enabled'] and self.settings.get('live_control_confirmed',False)

    async def release_managed_rooms(self, now, force=False):
        """Restore normal comfort targets on relinquishing thermostat ownership."""
        snapshot = deepcopy(self.settings)
        configured = {r['thermostat']:r for r in resolved_rooms(snapshot)+[r for r in zone_rooms(snapshot) if r['heat_control']!='zone_member'] if r.get('zone_control_enabled',True)}
        released = [{**old,'id':entity} for entity,old in self.managed_rooms.items()
                    if force or not self.live_enabled() or entity not in configured]
        air_released=[room for room in released if air_room(room,snapshot)]
        released=[room for room in released if room not in air_released]
        targets = {old['id']:self.fallback_target(configured.get(old['thermostat'],old)) for old in released}
        errors = await self.control.apply(released,targets,now.timestamp(),lambda:self.settings==snapshot)
        intents={r['id']:self.air_control.intent(r,snapshot,now.timestamp(),release=True) for r in air_released}
        errors+=await self.air_control.apply(air_released,intents,now.timestamp(),lambda:self.settings==snapshot)
        for room in released+air_released:
            if (self.air_control.results.get(room['id'],{}).get('confirmed',False) if room in air_released else room['id'] in self.control.results):
                self.managed_rooms.pop(room['thermostat'],None)
        if released or air_released:
            await self.store.async_save(self.storage_data())
        return errors

    async def apply_live_targets(self, data, now):
        """Reconcile current windows and restore comfort targets when inputs fail."""
        self.air_control.deadlines=[]
        live=self.live_enabled()
        if live and not self._air_was_live:self.air_control.cycles.clear()
        self._air_was_live=live
        release_errors = await self.release_managed_rooms(now)
        air_rooms=[r for r in resolved_rooms(self.settings)+zone_rooms(self.settings) if air_room(r,self.settings)]
        intents={}
        for room in air_rooms:
            bucket=data.get('zones',{}) if room.get('secondary_zone') else data.get('rooms',{})
            key=room['heating_zone_id'] if room.get('secondary_zone') else room['id']
            planned=bucket.get(key,{}).get('plan')
            current=thermostat_state(planned,now) if planned and planned.get('slots') and stamp(planned['slots'][0]['start'])<=now<stamp(planned['slots'][-1]['end']) else None
            intent=self.air_control.intent(room,self.settings,now.timestamp(),current,enabled=self.settings['heating_enabled'] and room.get('zone_control_enabled',True),summer=self.fallback_state.get('summer',False))
            intents[room['id']]=intent
            if key in bucket:bucket[key]['pump_suggestion']=intent
        if not self.live_enabled():
            for room in air_rooms:
                status=self.air_control.results.get(room['id'])
                bucket=data.get('zones',{}) if room.get('secondary_zone') else data.get('rooms',{})
                key=room['heating_zone_id'] if room.get('secondary_zone') else room['id']
                if status and key in bucket:bucket[key]['pump_control']=status
            return {'mode':'simulation' if electric_heating(self.settings) else 'observation','errors':release_errors,'fallback_rooms':[]}
        snapshot = deepcopy(self.settings)
        if self._plan_settings != snapshot:
            return {'mode':'waiting','errors':[],'fallback_rooms':[]}
        targets, fallback = {}, []
        sources_ok = self.value(snapshot['outdoor_entity']) is not None
        uses_water=water_distribution(snapshot)
        water_state = self.hass.states.get(snapshot['water_entity']) if uses_water else None
        water = number(water_state.attributes.get('current_temperature') if snapshot['water_entity'].startswith('climate.') else water_state.state) if water_state else None
        price_state = self.hass.states.get(snapshot['price_entity'])
        try:
            prices = price_slots(price_state.attributes,snapshot,now,ZoneInfo(self.hass.config.time_zone)) if price_state and price_state.state not in ('unknown','unavailable') else []
        except ValueError:
            prices = []
        sources_ok = sources_ok and bool(prices)
        for room in resolved_rooms(snapshot):
            if not room_electric(room,snapshot) or air_room(room,snapshot) or room.get('heat_control')=='zone_member':continue
            planned = data.get('rooms',{}).get(room['id'],{}).get('plan')
            rows = (planned or {}).get('slots',[])
            current_plan = rows and stamp(rows[0]['start']) <= now < stamp(rows[-1]['end'])
            if snapshot['heating_enabled'] and sources_ok and self.value(room['temperature_entity']) is not None and current_plan:
                target = thermostat_state(planned,now)['setpoint']
            else:
                target = self.fallback_target(room)
                fallback.append(room['name'])
            targets[room['id']] = target
        permitted = lambda: self.settings == snapshot and self.live_enabled()
        control_rooms=[{**room,'control_minimum':snapshot['minimum'] if targets[room['id']]>=snapshot['minimum'] else None,
                        'control_maximum':snapshot['maximum']} for room in resolved_rooms(snapshot) if room['id'] in targets]
        errors = release_errors+await self.control.apply(control_rooms,targets,now.timestamp(),permitted)
        errors+=await self.air_control.apply([r for r in air_rooms if r.get('zone_control_enabled',True)],intents,now.timestamp(),permitted)
        for rid,status in self.air_control.results.items():
            if rid.startswith('zone:') and rid[5:] in data.get('zones',{}):data['zones'][rid[5:]]['pump_control']=status
            elif rid in data.get('rooms',{}):data['rooms'][rid]['pump_control']=status
        errors.extend(error for intent in intents.values() for error in intent['errors'])
        for room in resolved_rooms(snapshot)+[r for r in zone_rooms(snapshot) if r['heat_control']!='zone_member']:
            if room['id'] in self.control.results or room['id'] in self.air_control.results:
                self.managed_rooms[room['thermostat']] = deepcopy(room)
        if fallback and snapshot['heating_enabled']:
            errors.append(f"{self.fallback_summary()['season'].capitalize()} fallback targets are being used because required data or a current heating plan is unavailable: "+', '.join(fallback)+'.')
        await self.store.async_save(self.storage_data())
        return {'mode':'live' if snapshot['heating_enabled'] else 'paused','errors':errors,'fallback_rooms':fallback,'targets':dict(self.control.results),'heat_pumps':dict(self.air_control.results)}

    async def apply_season_targets(self, heating_active):
        errors = []
        if not electric_heating(self.settings) or not self.settings['apply_season_setpoints'] or self.live_enabled():
            self.applied_season_targets.clear()
            return errors
        for room in resolved_rooms(self.settings):
            if not room_electric(room,self.settings) or air_room(room,self.settings) or room.get('heat_control')=='zone_member':continue
            target = room['baseline'] if heating_active else self.fallback_target(room)
            state = self.hass.states.get(room['thermostat'])
            if target is None or state is None or state.state in ('unknown','unavailable'):
                errors.append(f"{room['name']}: season setpoint could not be applied; source or thermostat unavailable.")
                continue
            if not state.attributes.get('min_temp',5) <= target <= state.attributes.get('max_temp',35):
                errors.append(f"{room['name']}: season setpoint is outside thermostat limits.")
                continue
            signature = [heating_active,target,room['thermostat']]
            if self.applied_season_targets.get(room['id']) == signature:
                continue
            try:
                await self.hass.services.async_call('climate','set_temperature',
                    {'entity_id':room['thermostat'],'temperature':target},blocking=True)
                self.applied_season_targets[room['id']] = signature
            except Exception:
                errors.append(f"{room['name']}: applying the season setpoint failed; will retry.")
                _LOGGER.warning('Season setpoint failed for %s',room['thermostat'],exc_info=True)
        return errors
