"""Read HA states, learn observed response, persist data, publish plans and reconcile opt-in thermostat control."""
from datetime import datetime, timedelta
from copy import deepcopy
import logging
from zoneinfo import ZoneInfo
from homeassistant.core import callback
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator
from homeassistant.helpers.storage import Store
from homeassistant.helpers.event import async_track_point_in_utc_time, async_track_state_change_event
from homeassistant.util import dt as dt_util
from .const import DOMAIN, DEFAULTS, RESERVE_HOURS, ARCHIVE_KEEP_DAYS, WATER_REFERENCE, HISTORY_DAYS
from .history import HistoryDatabase
from .control import ThermostatControl
from .config import stored_settings
from .model import number, stamp, initial_model, learn, learning_progress, price_slots, plan, collection_state, thermostat_state, fallback_season, price_forecast_reserve, heat_retention, solar_signal, solar_facing, solar_enabled

_LOGGER = logging.getLogger(__name__)


class PilotCoordinator(DataUpdateCoordinator):
    def __init__(self, hass, entry):
        super().__init__(hass, _LOGGER, name=DOMAIN, update_interval=timedelta(minutes=5))
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
        entities.update(room[key] for room in self.settings['rooms'] for key in ('temperature_entity','thermostat','activity_entity') if room[key])
        self._source_unsubscribe = async_track_state_change_event(self.hass,entities,self.source_changed)

    @callback
    def source_changed(self, event):
        """Recover promptly after startup and react to source/relay changes."""
        entity = event.data.get('entity_id')
        old, new = event.data.get('old_state'), event.data.get('new_state')
        if entity == self.settings['weather_entity']:
            self.forecast_updated = None
        thermostats = {room['thermostat'] for room in self.settings['rooms']}
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
        future = [stamp(command['time']) for room in data.get('rooms',{}).values()
                  for command in (room.get('plan') or {}).get('commands',[]) if stamp(command['time']) > now]
        for room in data.get('rooms',{}).values():
            rows = (room.get('plan') or {}).get('slots',[])
            if rows and stamp(rows[-1]['end']) > now:
                future.append(stamp(rows[-1]['end']))
        if future:
            self._command_timer = async_track_point_in_utc_time(self.hass,self.update_command_state,min(future))

    async def update_command_state(self, now):
        """Apply offset transitions without waiting for the regular planning refresh."""
        data = deepcopy(self.data or {})
        for room in data.get('rooms',{}).values():
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
            model['response'] = 0.0  # Slab state cannot be trusted across downtime.
        self.season = saved.get('season', {})
        self.applied_season_targets = saved.get('applied_season_targets', {})
        self.fallback_state = saved.get('fallback_state',{})
        self.managed_rooms = {room['thermostat']:room for room in saved.get('managed_rooms',{}).values()}
        self.sensor_health = saved.get('sensor_health', {'rooms':{},'last_notification_day':None})
        await self.hass.async_add_executor_job(self.history_db.initialize)
        self.config_fingerprint = saved.get('fingerprints', {})

    def collection_evidence(self):
        """Use the least-observed configured room for house-wide coverage."""
        models = [self.models.get(room['id'], {}) for room in self.settings['rooms']]
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
            return 1.0 if value == 'heating' else 0.0 if value in ('idle','off') else None
        value = state.state
        if value is None or str(value) in ('unknown','unavailable'):
            return None
        return 1.0 if value == 'on' else 0.0 if value == 'off' else None

    def storage_data(self):
        return {'models':self.models,'season':self.season,
                'applied_season_targets':self.applied_season_targets,
                'fingerprints':self.config_fingerprint,'sensor_health':self.sensor_health,'managed_rooms':self.managed_rooms,'fallback_state':self.fallback_state}

    async def check_temperature_sensors(self, now, active):
        """Warn once per local day after the configured interval of continuous suspect readings."""
        tracking = self.sensor_health.setdefault('rooms',{})
        if not active:
            tracking.clear()
            return
        timestamp = now.timestamp()
        warning_hours = self.settings['sensor_warning_hours']
        configured = {room['id'] for room in self.settings['rooms']}
        for rid in list(tracking):
            if rid not in configured:
                tracking.pop(rid)
        suspect = []
        for room in self.settings['rooms']:
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

    def committed_session(self, rid, now):
        """Keep a published session once its advance opening time has arrived."""
        previous_plan = ((getattr(self,'data',None) or {}).get('rooms',{}).get(rid,{}) or {}).get('plan') or {}
        for session in previous_plan.get('sessions',[]):
            start, end = stamp(session['start']), stamp(session['end'])
            opening = start-timedelta(minutes=self.settings['start_offset_minutes'])
            if opening <= now < end:
                return deepcopy(session)
        return None

    async def _async_update_data(self):
        self.cancel_command_timer()
        now = dt_util.utcnow()
        plan_settings = deepcopy(self.settings)
        outdoor = self.value(self.settings['outdoor_entity'])
        source = self.hass.states.get(self.settings['price_entity'])
        heating_active = self.settings['heating_enabled']
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
                'collection':self.season,'collection_evidence':self.collection_evidence(),'warnings':['ThermalPilot is passive. Planning, collection and learning are stopped.']+setpoint_errors,
                'rooms':{},'outdoor':outdoor,'water':None,
                'season_summaries':await self.hass.async_add_executor_job(self.history_db.summaries),
                'history_info':await self.hass.async_add_executor_job(self.history_db.size)}
            self._plan_settings = plan_settings
            data['fallback_season'] = self.fallback_summary()
            data['control'] = await self.apply_live_targets(data,now)
            data['warnings'].extend(f'Thermostat control: {w}' for w in data['control']['errors'])
            return data
        warnings = list(setpoint_errors)
        if not self.settings['simulation_enabled'] and not self.settings.get('live_control_confirmed'):
            warnings.append('Live control awaits confirmation. Enable simulation, save, then disable it and confirm to activate thermostat control.')
        if not self.season['collecting']:
            warnings.append('History collection and learning paused because outdoor temperature is unavailable. Existing model parameters are retained.')
        slots = []
        chart_prices = []
        if source is None or source.state in ('unknown','unavailable'):
            warnings.append('Price sensor is missing or unavailable.')
        else:
            try:
                slots = price_slots(source.attributes, self.settings, now, ZoneInfo(self.hass.config.time_zone))
                midnight = local_now.replace(hour=0,minute=0,second=0,microsecond=0)
                chart_prices = [{'start':s.start.isoformat(),'end':s.end.isoformat(),'price':s.price}
                    for s in (price_slots(source.attributes,self.settings,midnight,ZoneInfo(self.hass.config.time_zone)) or slots)]
            except ValueError as error:
                warnings.append(str(error))
        if not slots:
            warnings.append('No continuous prices from now: no heating plan is available.')
        if not forecasts:
            warnings.append('No weather forecast: current outdoor temperature is held constant. '+(self.forecast_error or 'No usable forecast was returned.'))
        price_outlook = {'enabled':bool(self.settings['price_forecast_entity']),'reserve_hours':RESERVE_HOURS,'available':False}
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
        water_state = self.hass.states.get(self.settings['water_entity']) if self.settings['water_entity'] else None
        water = number(water_state.attributes.get('current_temperature') if self.settings['water_entity'].startswith('climate.') else water_state.state) if water_state else None
        fireplace_state = self.hass.states.get(self.settings['fireplace_entity']) if self.settings['fireplace_entity'] else None
        fireplace = bool(fireplace_state and fireplace_state.state == self.settings['fireplace_active_state'])
        readings, room_data = [], {}
        for configured_room in self.settings['rooms']:
            room = {**configured_room, **{key:self.settings[key] for key in ('lag_hours','curve_warm_temp','curve_cold_temp','boost','setback','minimum','maximum')}, 'water_reference':WATER_REFERENCE}
            rid = room['id']
            temperature = self.value(room['temperature_entity'])
            baseline = room['baseline']
            if baseline is not None:
                room['baseline'] = baseline
            model = self.models.setdefault(rid, initial_model(room))
            # Reset only affected model when heat source / room / activity / lag mapping changes.
            fingerprint = [room[k] for k in ('thermostat','temperature_entity','activity_entity','lag_hours','curve_max_hours','curve_min_hours','curve_cold_temp','curve_warm_temp','baseline','water_reference')]+[self.settings['outdoor_entity'], self.settings['water_entity']]
            if rid in self.config_fingerprint and fingerprint != self.config_fingerprint[rid]:
                model = self.models[rid] = initial_model(room)
                self.previous.pop(rid, None)
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
            actual_request = number(thermostat_state.attributes.get('temperature')) if thermostat_state else None
            result = {'name':room['name'], 'temperature':temperature, 'actual_activity':activity,
                      'actual_setpoint':actual_request, 'baseline':baseline, 'model':deepcopy(model), 'plan':None, 'forecast_context':fingerprint+[self.settings['wind_entity']]+solar_context}
            if temperature is None or outdoor is None or baseline is None or water is None:
                result['error'] = 'Room temperature, outdoor temperature, supply water temperature or target temperature is unavailable.'
                self.previous.pop(rid, None)
            elif not room['minimum'] <= baseline <= room['maximum']:
                result['error'] = 'Target temperature is outside the allowed temperature range.'
                self.previous.pop(rid, None)
            else:
                water_factor = max(.25,min(2,(water-temperature)/max(1,room['water_reference']-temperature)))
                current = {'time':now.timestamp(), 'temperature':temperature, 'outdoor':outdoor,
                           'activity':activity, 'water':water, 'water_factor':water_factor, 'wind':wind_status['speed'], 'solar':(current_solar*solar_facing(now,latitude,longitude,room.get('solar_direction','south')) if current_solar is not None else None) if solar_enabled(room) else None, 'excluded':fireplace}
                prediction = None
                if self.season['collecting'] and rid in self.previous:
                    prediction = learn(model, room, self.previous[rid], current)
                if self.season['collecting']:
                    self.previous[rid] = current
                else:
                    self.previous.pop(rid,None)
                if slots and all(t is not None for t in outdoors):
                    run = self.suggested_runs.get(rid,{})
                    settings = {**room, 'terminal_reserve_hours':price_outlook['reserve_hours'],
                        'wind_speed':wind_status['speed'], 'solar_forecast':[value*solar_facing(slot.start+(slot.end-slot.start)/2,latitude,longitude,room.get('solar_direction','south')) if value is not None else None for value,slot in zip(solar_forecast,slots)],
                        'start_offset_minutes':self.settings['start_offset_minutes'], 'stop_offset_minutes':self.settings['stop_offset_minutes'],
                        'boost':self.settings['boost'], 'setback':self.settings['setback'],
                        'minimum_run_minutes':self.settings['minimum_run_minutes'] if self.settings['pricing_mode']=='flexible' else 60 if self.settings['pricing_mode']=='hourly' else 15,
                        'committed_session':self.committed_session(rid,now),
                        'previous_suggested_heat':run.get('heat',False),
                        'previous_control_mode':run.get('mode','boost' if run.get('heat') else 'normal'),
                        'reduction_available':run.get('reduction_available',run.get('heat',False)),
                        'previous_run_hours':max(0,(now.timestamp()-run.get('since',now.timestamp()))/3600)}
                    result['plan'] = await self.hass.async_add_executor_job(plan, settings, deepcopy(model),
                        temperature, outdoors, slots, now, baseline, water_factor, fireplace)
                if result['plan']:
                    heat = result['plan']['scheduled_heat']
                    old = self.suggested_runs.get(rid,{})
                    self.suggested_runs[rid] = {'heat':heat,'mode':result['plan'].get('scheduled_mode','boost' if heat else 'normal'),'reduction_available':result['plan'].get('reduction_available',heat),'since':old.get('since',now.timestamp()) if old.get('heat')==heat else now.timestamp()}
                result['model'] = deepcopy(model)
                result['one_step_prediction'] = prediction
                if self.season['collecting']:
                    readings.append({'room_id':rid, **current, 'forecast_context':fingerprint+[self.settings['wind_entity']]+solar_context, 'actual_setpoint':actual_request,
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
            result['learning_progress'] = learning_progress(model,now)
            result['heat_retention'] = heat_retention(model)
            room_data[rid] = result
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
                'rooms':room_data,'price_chart':chart_prices,'price_outlook':price_outlook,'wind':wind_status,
                'collection_evidence':self.collection_evidence(),
                'source_status':{'prices':bool(slots),'outdoor':outdoor is not None,'water':water is not None},
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
        return not self.settings['simulation_enabled'] and self.settings.get('live_control_confirmed',False)

    async def release_managed_rooms(self, now, force=False):
        """Restore normal comfort targets on relinquishing thermostat ownership."""
        snapshot = deepcopy(self.settings)
        configured = {r['thermostat']:r for r in snapshot['rooms']}
        released = [{**old,'id':entity} for entity,old in self.managed_rooms.items()
                    if force or not self.live_enabled() or entity not in configured]
        targets = {old['id']:self.fallback_target(configured.get(old['thermostat'],old)) for old in released}
        errors = await self.control.apply(released,targets,now.timestamp(),lambda:self.settings==snapshot)
        for room in released:
            if room['id'] in self.control.results:
                self.managed_rooms.pop(room['thermostat'],None)
        if released:
            await self.store.async_save(self.storage_data())
        return errors

    async def apply_live_targets(self, data, now):
        """Reconcile current windows and restore comfort targets when inputs fail."""
        release_errors = await self.release_managed_rooms(now)
        if not self.live_enabled():
            return {'mode':'simulation','errors':release_errors,'fallback_rooms':[]}
        snapshot = deepcopy(self.settings)
        if self._plan_settings != snapshot:
            return {'mode':'waiting','errors':[],'fallback_rooms':[]}
        targets, fallback = {}, []
        sources_ok = self.value(snapshot['outdoor_entity']) is not None
        water_state = self.hass.states.get(snapshot['water_entity'])
        water = number(water_state.attributes.get('current_temperature') if snapshot['water_entity'].startswith('climate.') else water_state.state) if water_state else None
        price_state = self.hass.states.get(snapshot['price_entity'])
        try:
            prices = price_slots(price_state.attributes,snapshot,now,ZoneInfo(self.hass.config.time_zone)) if price_state and price_state.state not in ('unknown','unavailable') else []
        except ValueError:
            prices = []
        sources_ok = sources_ok and water is not None and bool(prices)
        for room in snapshot['rooms']:
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
                        'control_maximum':snapshot['maximum']} for room in snapshot['rooms']]
        errors = release_errors+await self.control.apply(control_rooms,targets,now.timestamp(),permitted)
        for room in snapshot['rooms']:
            if room['id'] in self.control.results:
                self.managed_rooms[room['thermostat']] = deepcopy(room)
        if fallback and snapshot['heating_enabled']:
            errors.append(f"{self.fallback_summary()['season'].capitalize()} fallback targets are being used because required data or a current heating plan is unavailable: "+', '.join(fallback)+'.')
        await self.store.async_save(self.storage_data())
        return {'mode':'live' if snapshot['heating_enabled'] else 'paused','errors':errors,'fallback_rooms':fallback,'targets':dict(self.control.results)}

    async def apply_season_targets(self, heating_active):
        errors = []
        if not self.settings['apply_season_setpoints'] or self.live_enabled():
            self.applied_season_targets.clear()
            return errors
        for room in self.settings['rooms']:
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
