"""Read HA states, learn observed response, persist data, publish shadow plans."""
from datetime import timedelta
from copy import deepcopy
import logging
from zoneinfo import ZoneInfo
from homeassistant.core import callback
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator
from homeassistant.helpers.storage import Store
from homeassistant.helpers.event import async_track_point_in_utc_time
from homeassistant.util import dt as dt_util
from .const import DOMAIN, DEFAULTS
from .history import HistoryDatabase
from .model import number, stamp, initial_model, learn, price_slots, plan, collection_state, thermostat_state

_LOGGER = logging.getLogger(__name__)


class PilotCoordinator(DataUpdateCoordinator):
    def __init__(self, hass, entry):
        super().__init__(hass, _LOGGER, name=DOMAIN, update_interval=timedelta(minutes=5))
        self.entry = entry
        self.settings = {**deepcopy(DEFAULTS), **entry.data, **entry.options}
        self.store = Store(hass, 1, f'{DOMAIN}.{entry.entry_id}')
        self.models = {}
        self.history_db = HistoryDatabase(hass.config.path('.storage', f'{DOMAIN}.{entry.entry_id}.sqlite3'))
        self.previous = {}
        self.forecast = []
        self.forecast_updated = None
        self.config_fingerprint = {}
        self.suggested_runs = {}
        self.season = {}
        self.applied_season_targets = {}
        self._command_timer = None

    def cancel_command_timer(self):
        if self._command_timer is not None:
            self._command_timer()
            self._command_timer = None

    def arm_command_timer(self, data, now):
        self.cancel_command_timer()
        future = [stamp(command['time']) for room in data.get('rooms',{}).values()
                  for command in (room.get('plan') or {}).get('commands',[]) if stamp(command['time']) > now]
        if future:
            self._command_timer = async_track_point_in_utc_time(self.hass,self.update_command_state,min(future))

    @callback
    def update_command_state(self, now):
        """Publish offset transitions without replanning, learning or device writes."""
        data = deepcopy(self.data or {})
        for room in data.get('rooms',{}).values():
            if room.get('plan'):
                room['plan'].update(thermostat_state(room['plan'],now))
        data['updated'] = now.isoformat()
        self.async_set_updated_data(data)
        self.arm_command_timer(data,now)

    async def load(self):
        saved = await self.store.async_load() or {}
        self.models = saved.get('models', {})
        for model in self.models.values():
            model['response'] = 0.0  # Slab state cannot be trusted across downtime.
        self.season = saved.get('season', {})
        self.applied_season_targets = saved.get('applied_season_targets', {})
        await self.hass.async_add_executor_job(self.history_db.initialize)
        self.config_fingerprint = saved.get('fingerprints', {})

    def value(self, entity):
        state = self.hass.states.get(entity) if entity else None
        return number(state.state) if state else None

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

    async def get_forecast(self, now):
        entity = self.settings['weather_entity']
        if not entity:
            return []
        if self.forecast_updated is not None and (now-self.forecast_updated).total_seconds() < 3600:
            return self.forecast
        try:
            result = await self.hass.services.async_call('weather', 'get_forecasts',
                {'entity_id':entity, 'type':self.settings['forecast_type']},
                blocking=True, return_response=True)
            self.forecast = (result or {}).get(entity, {}).get('forecast', [])
            self.forecast_updated = now
        except Exception:  # Source failure must leave the simulator operational.
            state = self.hass.states.get(entity)
            self.forecast = state.attributes.get('forecast', []) if state else []
            self.forecast_updated = now
            _LOGGER.debug('Forecast unavailable; using attribute fallback', exc_info=True)
        return self.forecast

    async def _async_update_data(self):
        self.cancel_command_timer()
        now = dt_util.utcnow()
        outdoor = self.value(self.settings['outdoor_entity'])
        source = self.hass.states.get(self.settings['price_entity'])
        activation_state = self.hass.states.get(self.settings['activation_entity']) if self.settings['activation_entity'] else None
        heating_active = self.settings['heating_enabled'] and (not self.settings['activation_entity'] or activation_state is not None and activation_state.state == self.settings['activation_active_state'])
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
        if self.settings['season_archive_enabled'] and (previous_season.get('heating_active') and not heating_active or self.settings['collection_mode']=='automatic' and previous_season.get('active') and not self.season.get('active')):
            keep_since = now.timestamp()-self.settings['archive_keep_days']*86400
            await self.hass.async_add_executor_job(self.history_db.compact_season,
                previous_season.get('season_id',self.season['season_id']), deepcopy(self.models),deepcopy(self.config_fingerprint),keep_since)
            self.season['last_compaction'] = now.isoformat()
        if not heating_active:
            self.previous.clear()
            self.suggested_runs.clear()
            for model in self.models.values():
                model['response'] = 0.0
            cutoff = now.timestamp()-self.settings['history_days']*86400
            await self.hass.async_add_executor_job(self.history_db.append, [], cutoff, self.season['season_id'])
            self.store.async_delay_save(lambda:{'models':self.models,'season':self.season,'applied_season_targets':self.applied_season_targets,'fingerprints':self.config_fingerprint},20)
            return {'updated':now.isoformat(),'simulation_only':not self.settings['apply_season_setpoints'],'heating_active':False,
                'collection':self.season,'warnings':['ThermalPilot is passive. Planning, collection and learning are stopped.']+setpoint_errors,
                'rooms':{},'outdoor':outdoor,'water':None,'power':None,
                'season_summaries':await self.hass.async_add_executor_job(self.history_db.summaries),
                'history_info':await self.hass.async_add_executor_job(self.history_db.size)}
        warnings = list(setpoint_errors)
        if not self.season['collecting']:
            warnings.append('History collection and learning paused by seasonal settings. Existing model parameters are retained.')
        slots = []
        if source is None or source.state in ('unknown','unavailable'):
            warnings.append('Price sensor is missing or unavailable.')
        else:
            try:
                slots = price_slots(source.attributes, self.settings, now, ZoneInfo(self.hass.config.time_zone))
            except ValueError as error:
                warnings.append(str(error))
        if not slots:
            warnings.append('No continuous prices from now: no heating plan is available.')
        elif (slots[-1].end-now).total_seconds()/3600 < self.settings['horizon_hours']:
            warnings.append(f'Known prices cover {(slots[-1].end-now).total_seconds()/3600:.1f} hours. Unpublished prices are not invented.')
        forecasts = await self.get_forecast(now)
        if not forecasts:
            warnings.append('No weather forecast: current outdoor temperature is held constant.')
        outdoors = []
        for slot in slots:
            points = []
            for f in forecasts:
                date = stamp(f.get('datetime'))
                temp = number(f.get('templow') if self.settings['forecast_type']=='daily' else f.get('temperature'))
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
            room = {**configured_room, **{key:self.settings[key] for key in ('lag_hours','curve_warm_temp','curve_cold_temp','water_reference','boost','setback')}}
            if not room['enabled']:
                continue
            rid = room['id']
            temperature = self.value(room['temperature_entity'])
            baseline = self.value(room['baseline_entity']) if room['baseline_entity'] else room['baseline']
            if baseline is not None:
                room['baseline'] = baseline
            model = self.models.setdefault(rid, initial_model(room))
            # Reset only affected model when heat source / room / activity / lag mapping changes.
            fingerprint = [room[k] for k in ('thermostat','temperature_entity','activity_entity','lag_hours','curve_max_hours','curve_min_hours','curve_cold_temp','curve_warm_temp','baseline','water_reference')]+[self.settings['outdoor_entity'], self.settings['water_entity']]
            if rid in self.config_fingerprint and fingerprint != self.config_fingerprint[rid]:
                model = self.models[rid] = initial_model(room)
                self.previous.pop(rid, None)
            self.config_fingerprint[rid] = fingerprint
            if not self.season['collecting']:
                model['response'] = 0.0
            activity = self.activity(room)
            thermostat_state = self.hass.states.get(room['thermostat'])
            actual_request = number(thermostat_state.attributes.get('temperature')) if thermostat_state else None
            result = {'name':room['name'], 'temperature':temperature, 'actual_activity':activity,
                      'actual_setpoint':actual_request, 'baseline':baseline, 'model':deepcopy(model), 'plan':None}
            if temperature is None or outdoor is None or baseline is None:
                result['error'] = 'Room temperature, outdoor temperature or normal setpoint is unavailable.'
                self.previous.pop(rid, None)
            elif not room['minimum'] <= baseline <= room['maximum']:
                result['error'] = 'Normal setpoint helper is outside the allowed temperature range.'
                self.previous.pop(rid, None)
            else:
                water_factor = max(.25,min(2,(water-temperature)/max(1,room['water_reference']-temperature))) if water is not None else 1.0
                current = {'time':now.timestamp(), 'temperature':temperature, 'outdoor':outdoor,
                           'activity':activity, 'water_factor':water_factor, 'excluded':fireplace}
                prediction = None
                if self.season['collecting'] and rid in self.previous:
                    prediction = learn(model, room, self.previous[rid], current, self.settings['learning_enabled'])
                if self.season['collecting']:
                    self.previous[rid] = current
                else:
                    self.previous.pop(rid,None)
                if slots and all(t is not None for t in outdoors):
                    run = self.suggested_runs.get(rid,{})
                    settings = {**room, 'terminal_reserve_hours':self.settings['terminal_reserve_hours'],
                        'start_offset_minutes':self.settings['start_offset_minutes'], 'stop_offset_minutes':self.settings['stop_offset_minutes'],
                        'boost':self.settings['boost'], 'setback':self.settings['setback'],
                        'minimum_run_minutes':self.settings['minimum_run_minutes'] if self.settings['pricing_mode']=='flexible' else 60 if self.settings['pricing_mode']=='hourly' else 15,
                        'previous_suggested_heat':run.get('heat',False),
                        'previous_run_hours':max(0,(now.timestamp()-run.get('since',now.timestamp()))/3600)}
                    result['plan'] = await self.hass.async_add_executor_job(plan, settings, deepcopy(model),
                        temperature, outdoors, slots, now, baseline, water_factor, fireplace)
                if result['plan']:
                    heat = result['plan']['scheduled_heat']
                    old = self.suggested_runs.get(rid,{})
                    self.suggested_runs[rid] = {'heat':heat,'since':old.get('since',now.timestamp()) if old.get('heat')==heat else now.timestamp()}
                result['model'] = deepcopy(model)
                result['one_step_prediction'] = prediction
                if self.season['collecting']:
                    readings.append({'room_id':rid, **current, 'actual_setpoint':actual_request,
                                 'prediction':prediction, 'suggested_heat':result['plan']['heat'] if result['plan'] else None,
                                 'suggested_setpoint':result['plan']['setpoint'] if result['plan'] else None})
            if not self.season['collecting']:
                result['learning_note'] = 'Learning paused outside the collection season.'
            elif not self.settings['learning_enabled']:
                result['learning_note'] = 'Learning disabled; observations are still collected in season.'
            elif activity is None:
                result['learning_note'] = 'No observed heating activity: learning is waiting.'
            elif model['heated_hours'] < 12 or model['idle_hours'] < 12:
                result['learning_note'] = 'Initial model: needs at least 12 heating hours and 12 idle hours.'
            else:
                result['learning_note'] = 'Model adapting to observations; assess reliability from prediction error.'
            room_data[rid] = result
        cutoff = now.timestamp()-self.settings['history_days']*86400
        await self.hass.async_add_executor_job(self.history_db.append, readings, cutoff, self.season['season_id'])
        # Model parameters are small; sample history lives in SQLite.
        self.store.async_delay_save(lambda:{'models':self.models, 'season':self.season,
                                           'applied_season_targets':self.applied_season_targets,'fingerprints':self.config_fingerprint}, 20)
        archives = await self.hass.async_add_executor_job(self.history_db.summaries)
        history_info = await self.hass.async_add_executor_job(self.history_db.size)
        data = {'season_summaries':archives,'history_info':history_info, 'updated':now.isoformat(), 'simulation_only':not self.settings['apply_season_setpoints'], 'warnings':warnings,
                'heating_active':True, 'collection':self.season, 'outdoor':outdoor, 'water':water, 'power':self.value(self.settings['power_entity']),
                'rooms':room_data}
        self.arm_command_timer(data,now)
        return data

    async def apply_season_targets(self, heating_active):
        errors = []
        if not self.settings['apply_season_setpoints']:
            self.applied_season_targets.clear()
            return errors
        for room in self.settings['rooms']:
            if not room['enabled']:
                continue
            target = (self.value(room['baseline_entity']) if room['baseline_entity'] else room['baseline']) if heating_active else self.settings['summer_setpoint']
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
