"""HA adapter tests using minimal doubles, not a real Home Assistant runtime."""
import sys,types,tempfile,unittest
from pathlib import Path
from datetime import datetime,timedelta,timezone
from copy import deepcopy
from unittest.mock import AsyncMock, patch

ROOT=Path(__file__).resolve().parents[1]/'custom_components/thermal_pilot'
pkg=types.ModuleType('thermal_pilot');pkg.__path__=[str(ROOT)];sys.modules.setdefault('thermal_pilot',pkg)
for name in ['homeassistant','homeassistant.helpers','homeassistant.util']:
    sys.modules.setdefault(name,types.ModuleType(name))
coord=types.ModuleType('homeassistant.helpers.update_coordinator')
class DataUpdateCoordinator:
    def __init__(self,hass,*args,**kwargs):self.hass=hass
    def async_set_updated_data(self,data):self.data=data
coord.DataUpdateCoordinator=DataUpdateCoordinator;sys.modules[coord.__name__]=coord
core=types.ModuleType('homeassistant.core');core.callback=lambda fn:fn
sys.modules[core.__name__]=core
storage=types.ModuleType('homeassistant.helpers.storage')
class Store:
    def __init__(self,*args):self.saved={}
    async def async_load(self):return self.saved
    async def async_save(self,data):self.saved=deepcopy(data)
    def async_delay_save(self,callback,delay):self.saved=deepcopy(callback())
storage.Store=Store;sys.modules[storage.__name__]=storage
event=types.ModuleType('homeassistant.helpers.event')
event.async_track_point_in_utc_time=lambda hass,action,point:lambda:None
event.async_track_state_change_event=lambda hass,entities,action:lambda:None
sys.modules[event.__name__]=event
now=datetime(2026,1,2,0,tzinfo=timezone.utc)
dt=types.ModuleType('homeassistant.util.dt');dt.utcnow=lambda:now
sys.modules[dt.__name__]=dt;sys.modules['homeassistant.util'].dt=dt
from thermal_pilot.coordinator import PilotCoordinator
from thermal_pilot.const import DEFAULTS,ROOM_DEFAULTS

class State:
    def __init__(self,state='20',attributes=None):self.state=state;self.attributes=attributes or {}
class Hass:
    def __init__(self,path):
        self.states={'sensor.out':State('-10'),'sensor.price':State('10',{'today':[10]*96}),
            'sensor.water':State('32'),'sensor.room':State('20'),'climate.room':State('heat',{'temperature':20,'hvac_action':'idle','min_temp':5,'max_temp':35}),
            'input_boolean.heating':State('on')}
        self.config=types.SimpleNamespace(time_zone='UTC',path=lambda *args:str(Path(path).joinpath(*args)))
        self.services=types.SimpleNamespace(async_call=AsyncMock())
    async def async_add_executor_job(self,fn,*args):return fn(*args)

class CoordinatorTests(unittest.IsolatedAsyncioTestCase):
    async def test_non_electric_sources_observe_without_prices_plans_or_control(self):
        self.c.settings.update(price_entity='',price_forecast_entity='',simulation_enabled=False,live_control_confirmed=True,apply_season_setpoints=True)
        self.hass.states.pop('sensor.price')
        for source in ['gas_boiler','oil_boiler','wood_boiler','pellet_boiler','district_heating','other']:
            self.c.settings['house_heat_source']=source
            data=await self.c._async_update_data()
            self.assertTrue(data['collection']['collecting'])
            self.assertTrue(all(room['plan'] is None for room in data['rooms'].values()))
            self.assertFalse(data['source_status']['prices_required'])
            self.assertEqual(data['control']['mode'],'observation')
            self.assertFalse(any('Price sensor' in w or 'No continuous prices' in w for w in data['warnings']))
            self.hass.services.async_call.assert_not_awaited()

    async def test_nonwater_distributions_plan_learn_and_control_without_water(self):
        rid=self.c.settings['rooms'][0]['id']
        self.hass.states.pop('sensor.water')
        self.c.settings.update(water_entity='',simulation_enabled=False,live_control_confirmed=True)
        for distribution in ['electric_floor','electric_ceiling','electric_panels','warm_air']:
            self.c.settings['house_distribution']=distribution
            data=await self.c._async_update_data()
            self.assertFalse(data['source_status']['water_required'])
            self.assertTrue(data['rooms'][rid]['plan'])
            self.assertEqual(data['control']['fallback_rooms'],[])
            self.assertEqual(self.c.previous[rid]['water_factor'],1)
            for session,window in zip(data['rooms'][rid]['plan']['sessions'],data['rooms'][rid]['plan']['thermostat_windows']):
                self.assertEqual(session,window)
        self.c.settings['house_distribution']='water_floor'
        data=await self.c._async_update_data()
        self.assertTrue(data['rooms'][rid]['plan'])
        self.assertEqual(data['control']['fallback_rooms'],[])
    async def test_house_metadata_preserves_existing_water_model_and_history(self):
        data=await self.c._async_update_data();rid=self.c.settings['rooms'][0]['id']
        model=self.c.models[rid];model['loss']=.012;model['heated_hours']=40;model['idle_hours']=60
        fingerprint=deepcopy(self.c.config_fingerprint[rid])
        count=data['history_info']['rows']
        self.c.settings.update(house_heat_source='air_to_water',house_distribution='water_floor',house_heated_floor='concrete_slab',house_foundation='slab_on_ground')
        data=await self.c._async_update_data()
        self.assertIs(self.c.models[rid],model)
        self.assertEqual(self.c.models[rid]['loss'],.012)
        self.assertEqual(self.c.config_fingerprint[rid],fingerprint)
        self.assertGreaterEqual(data['history_info']['rows'],count)

    async def test_optional_solar_uses_location_and_missing_weather_keeps_control(self):
        moment=datetime(2026,6,21,10,tzinfo=timezone.utc)
        self.hass.config.latitude=60;self.hass.config.longitude=25
        self.c.settings['rooms'][0].update(solar_direction='south')
        self.c.settings.update(weather_entity='weather.home',simulation_enabled=False,live_control_confirmed=True)
        weather=State('sunny',{'cloud_coverage':0});weather.last_updated=moment
        self.hass.states['weather.home']=weather
        forecast=[{'datetime':(moment+timedelta(hours=i)).isoformat(),'temperature':10,'condition':'sunny'} for i in range(24)]
        self.hass.services.async_call=AsyncMock(return_value={'weather.home':{'forecast':forecast}})
        with patch('thermal_pilot.coordinator.dt_util.utcnow',return_value=moment):
            data=await self.c._async_update_data()
            rid=self.c.settings['rooms'][0]['id']
            self.assertGreater(self.c.previous[rid]['solar'],0)
            self.assertTrue(data['rooms'][rid]['plan'])
            self.hass.states['weather.home']=State('unavailable')
            data=await self.c._async_update_data()
            self.assertIsNone(self.c.previous[rid]['solar'])
            self.assertTrue(data['collection']['collecting'])
            self.assertEqual(data['control']['fallback_rooms'],[])
            self.assertTrue(data['rooms'][rid]['plan'])

    async def test_status_badges_use_usable_sources_and_least_observed_room(self):
        data = await self.c._async_update_data()
        self.assertEqual(data['source_status'], {'prices':True,'prices_required':True,'outdoor':True,'water':True,'water_required':False})
        self.c.models[self.c.settings['rooms'][0]['id']].update(heated_hours=150,idle_hours=160)
        self.c.settings['rooms'].append({**self.c.settings['rooms'][0],'id':'new-room'})
        self.assertEqual(self.c.collection_evidence()['heating_hours'],0)
        self.c.models['new-room']=deepcopy(self.c.models[self.c.settings['rooms'][0]['id']]);self.c.models['new-room'].update(heated_hours=4,idle_hours=8)
        self.assertEqual(self.c.collection_evidence(),{'rooms':2,'heating_hours':4,'idle_hours':8})
        self.hass.states.pop('sensor.water')
        data = await self.c._async_update_data()
        self.assertFalse(data['source_status']['water'])

    async def test_optional_price_forecast_guides_reserve_but_never_replaces_confirmed_prices(self):
        self.c.settings['price_forecast_entity']='sensor.forecast'
        self.hass.states['sensor.forecast']=State('10',{'forecast':[
            {'timestamp':(now+timedelta(hours=24+i)).timestamp()*1000,'value':40 if i<6 else 5} for i in range(24)]})
        from thermal_pilot.model import plan as real_plan
        with patch('thermal_pilot.coordinator.plan',side_effect=real_plan) as planner:
            data=await self.c._async_update_data()
        self.assertEqual(planner.call_args.args[0]['terminal_reserve_hours'],12)
        self.assertTrue(data['price_outlook']['available'])
        self.assertTrue(all(row['price']==10 for row in data['price_chart']))
        self.assertEqual(len(data['price_chart']),96)
        self.c.settings.update(simulation_enabled=False,live_control_confirmed=True)
        self.hass.states['sensor.price'].state='unavailable'
        data=await self.c._async_update_data()
        self.assertEqual(data['control']['fallback_rooms'],['Study'])
        self.assertEqual(data['control']['targets'][self.c.settings['rooms'][0]['id']],20)

    async def test_optional_wind_missing_stale_and_invalid_never_block_live_control(self):
        self.c.settings.update(wind_entity='sensor.netatmo_tuuli_ms',simulation_enabled=False,live_control_confirmed=True)
        for state in [None,State('unavailable'),State('nan',{'unit_of_measurement':'m/s'}),State('10',{'unit_of_measurement':'m/s'})]:
            if state is None:self.hass.states.pop('sensor.netatmo_tuuli_ms',None)
            else:
                state.last_updated=now-timedelta(hours=3);state.last_reported=now
                self.hass.states['sensor.netatmo_tuuli_ms']=state
            data=await self.c._async_update_data()
            self.assertFalse(data['wind']['available'])
            self.assertTrue(data['collection']['collecting'])
            self.assertFalse(data['control']['fallback_rooms'])
            self.assertIsNotNone(next(iter(data['rooms'].values()))['plan'])

    async def test_wind_units_smoothing_recovery_and_sensor_change(self):
        self.c.settings['wind_entity']='sensor.netatmo_tuuli_ms'
        state=State('10',{'unit_of_measurement':'m/s'});state.last_updated=now;state.last_reported=now
        self.hass.states['sensor.netatmo_tuuli_ms']=state
        self.assertEqual(self.c.wind_reading(now)['speed'],10)
        state.state='18';state.attributes['unit_of_measurement']='km/h';state.last_updated=now+timedelta(minutes=5);state.last_reported=state.last_updated
        self.assertEqual(self.c.wind_reading(state.last_updated)['speed'],7.5)
        state.state='unavailable';self.assertFalse(self.c.wind_reading(state.last_updated)['available'])
        state.state='18';self.assertEqual(self.c.wind_reading(state.last_updated)['speed'],5)
        data=await self.c._async_update_data()
        rid=self.c.settings['rooms'][0]['id'];self.c.models[rid].update(wind_loss=.001,wind_updates=5,wind_statistics={'old':True})
        self.c.settings['wind_entity']=''
        await self.c._async_update_data()
        self.assertNotIn('wind_statistics',self.c.models[rid]);self.assertNotIn('wind_loss',self.c.models[rid])
        self.assertGreaterEqual(self.c.models[rid]['samples'],data['rooms'][rid]['model']['samples'])

    async def test_chart_prices_are_exposed_and_recorded(self):
        data=await self.c._async_update_data()
        self.assertEqual(data['price_chart'][0]['price'],10)
        self.assertEqual(len(data['price_chart']),96)
        self.assertEqual(self.c.history_db.read(0)[0]['price'],10)

    async def test_sensor_warning_after_eight_hours_aggregates_and_limits_daily(self):
        second={**self.c.settings['rooms'][0],'id':'second','name':'Bedroom','temperature_entity':'sensor.second'}
        self.c.settings['rooms'].append(second)
        self.hass.states['sensor.second']=State('unknown')
        for step in range(16):
            await self.c.check_temperature_sensors(now+timedelta(minutes=30*step),True)
        self.hass.services.async_call.assert_not_awaited()
        await self.c.check_temperature_sensors(now+timedelta(hours=8),True)
        self.hass.services.async_call.assert_awaited_once()
        notification=self.hass.services.async_call.await_args.args[2]
        self.assertIn('Study',notification['message']);self.assertIn('Bedroom',notification['message'])
        self.assertIn('unavailable',notification['message'])
        self.assertEqual(self.c.store.saved['sensor_health']['last_notification_day'],'2026-01-02')
        # Loading saved state does not permit a repeated notification on the same day.
        self.c.sensor_health=deepcopy(self.c.store.saved['sensor_health'])
        for step in range(17,48):
            await self.c.check_temperature_sensors(now+timedelta(minutes=30*step),True)
        self.assertEqual(self.hass.services.async_call.await_count,1)
        await self.c.check_temperature_sensors(now+timedelta(days=1),True)
        self.assertEqual(self.hass.services.async_call.await_count,2)
        self.assertEqual(self.hass.services.async_call.await_args.args[2]['notification_id'],notification['notification_id'])

    async def test_configured_sensor_warning_interval_and_daily_limit(self):
        self.c.settings['sensor_warning_hours']=2
        for minute in range(0,120,30):
            await self.c.check_temperature_sensors(now+timedelta(minutes=minute),True)
        self.hass.services.async_call.assert_not_awaited()
        await self.c.check_temperature_sensors(now+timedelta(hours=2),True)
        self.hass.services.async_call.assert_awaited_once()
        self.assertIn('at least 2 hours',self.hass.services.async_call.call_args.args[2]['message'])
        await self.c.check_temperature_sensors(now+timedelta(hours=2,minutes=30),True)
        self.assertEqual(self.hass.services.async_call.await_count,1)

    async def test_sensor_warning_interval_validation_and_legacy_default(self):
        from thermal_pilot.config import validate
        legacy=deepcopy(self.c.settings);legacy.pop('sensor_warning_hours')
        self.assertEqual(validate(legacy)['sensor_warning_hours'],8)
        self.assertEqual(validate({**legacy,'sensor_warning_hours':6})['sensor_warning_hours'],6)
        self.assertEqual(validate({**legacy,'sensor_warning_hours':12})['sensor_warning_hours'],12)
        for value in [0,73,1.5,'invalid']:
            with self.subTest(value=value),self.assertRaises(ValueError):
                validate({**legacy,'sensor_warning_hours':value})

    async def test_sensor_changes_passive_and_monitoring_gaps_reset_timer(self):
        for step in range(12):
            await self.c.check_temperature_sensors(now+timedelta(minutes=30*step),True)
        self.hass.states['sensor.room'].state='20.1'
        await self.c.check_temperature_sensors(now+timedelta(hours=6),True)
        self.hass.services.async_call.assert_not_awaited()
        await self.c.check_temperature_sensors(now+timedelta(hours=12),True)
        self.hass.services.async_call.assert_not_awaited()
        await self.c.check_temperature_sensors(now+timedelta(hours=12,minutes=5),False)
        self.assertFalse(self.c.sensor_health['rooms'])

    async def test_sensor_daily_limit_uses_home_assistant_timezone(self):
        self.hass.config.time_zone='Europe/Helsinki'
        self.c.sensor_health['rooms'][self.c.settings['rooms'][0]['id']]={
            'entity':'sensor.room','value':20,'since':now.timestamp(),
            'last_seen':(now+timedelta(hours=21,minutes=30)).timestamp()}
        await self.c.check_temperature_sensors(now+timedelta(hours=22),True)
        self.assertEqual(self.c.sensor_health['last_notification_day'],'2026-01-03')

    async def test_failed_forecast_reports_reason_and_retries_after_five_minutes(self):
        self.c.settings['weather_entity']='weather.forecast_koti'
        self.hass.services.async_call.side_effect=RuntimeError('Forecast service unavailable')
        self.assertEqual(await self.c.get_forecast(now),[])
        self.assertIn('weather.forecast_koti',self.c.forecast_error)
        self.assertIn('RuntimeError: Forecast service unavailable',self.c.forecast_error)
        self.assertEqual(self.hass.services.async_call.await_count,3)
        await self.c.get_forecast(now+timedelta(minutes=4))
        self.assertEqual(self.hass.services.async_call.await_count,3)
        self.hass.services.async_call.side_effect=None
        self.hass.services.async_call.return_value={'weather.forecast_koti':{'forecast':[{'datetime':now.isoformat(),'temperature':3.7}]}}
        rows=await self.c.get_forecast(now+timedelta(minutes=5))
        self.assertEqual(len(rows),1);self.assertIsNone(self.c.forecast_error)

    async def test_forecast_prefers_hourly_and_caches_by_source(self):
        self.c.settings['weather_entity']='weather.home'
        row={'datetime':now.isoformat(),'temperature':-10}
        self.hass.services.async_call.return_value={'weather.home':{'forecast':[row]}}
        self.assertEqual(await self.c.get_forecast(now),[row])
        self.assertEqual(self.c.forecast_type,'hourly')
        await self.c.get_forecast(now)
        self.assertEqual(self.hass.services.async_call.await_count,1)
        self.c.settings['weather_entity']='weather.other'
        self.hass.services.async_call.return_value={'weather.other':{'forecast':[row]}}
        await self.c.get_forecast(now)
        self.assertEqual(self.hass.services.async_call.await_count,2)

    async def test_forecast_falls_back_to_daily_after_unusable_hourly(self):
        self.c.settings['weather_entity']='weather.home'
        row={'datetime':now.isoformat(),'temperature':2,'templow':-5}
        self.hass.services.async_call.side_effect=[
            {'weather.home':{'forecast':[{'datetime':'invalid','temperature':0}]}},
            RuntimeError('Twice daily not supported'),
            {'weather.home':{'forecast':[row]}},
        ]
        self.assertEqual(await self.c.get_forecast(now),[row])
        self.assertEqual(self.c.forecast_type,'daily')
        self.assertEqual([call.args[2]['type'] for call in self.hass.services.async_call.await_args_list],['hourly','twice_daily','daily'])

    async def asyncSetUp(self):
        self.temp=tempfile.TemporaryDirectory();self.hass=Hass(self.temp.name)
        room={**ROOM_DEFAULTS,'id':'11111111-1111-4111-8111-111111111111','name':'Study','thermostat':'climate.room','temperature_entity':'sensor.room'}
        entry=types.SimpleNamespace(entry_id='test',data={**DEFAULTS,'price_entity':'sensor.price','outdoor_entity':'sensor.out','water_entity':'sensor.water','rooms':[room]},options={})
        self.c=PilotCoordinator(self.hass,entry);await self.c.load()
    async def asyncTearDown(self):self.temp.cleanup()
    async def test_shared_setpoint_adjustments_override_legacy_room_values(self):
        first=self.c.settings['rooms'][0]
        first.update(boost=4,setback=3)
        second={**first,'id':'22222222-2222-4222-8222-222222222222','name':'Second','thermostat':'climate.second','temperature_entity':'sensor.second','boost':.2,'setback':.1}
        self.c.settings['rooms'].append(second)
        self.hass.states['climate.second']=State('heat',{'temperature':20,'hvac_action':'idle'})
        self.hass.states['sensor.second']=State('20')
        self.c.settings.update(boost=1.8,setback=-.7)
        with patch('thermal_pilot.coordinator.plan',return_value=None) as planner:
            await self.c._async_update_data()
        self.assertEqual(planner.call_count,2)
        for call in planner.call_args_list:
            self.assertEqual(call.args[0]['boost'],1.8)
            self.assertEqual(call.args[0]['setback'],-.7)
        self.hass.services.async_call.assert_not_awaited()

    async def test_legacy_simulation_off_requires_confirmation_but_still_plans(self):
        self.c.settings['simulation_enabled']=False
        result=await self.c._async_update_data()
        self.assertIsNotNone(result['rooms']['11111111-1111-4111-8111-111111111111']['plan'])
        self.assertEqual(result['control']['mode'],'simulation')
        self.hass.services.async_call.assert_not_awaited()

    async def test_session_commits_at_opening_and_expires_after_delivery_end(self):
        start=now+timedelta(minutes=15);end=start+timedelta(hours=1)
        session={'start':start.isoformat(),'end':end.isoformat()}
        self.c.data={'rooms':{'test':{'plan':{'sessions':[session]}}}}
        self.assertIsNone(self.c.committed_session('test',now+timedelta(minutes=9)))
        self.assertEqual(self.c.committed_session('test',now+timedelta(minutes=10)),session)
        # Keep the closing offset stable even during the final delivery minutes.
        self.assertEqual(self.c.committed_session('test',end-timedelta(minutes=5)),session)
        self.assertIsNone(self.c.committed_session('test',end))

    async def test_read_only_default(self):
        result=await self.c._async_update_data()
        self.assertTrue(result['simulation_only']);self.assertTrue(result['rooms'])
        self.hass.services.async_call.assert_not_awaited()
        self.assertEqual(self.c.history_db.size()['rows'],1)

    async def test_offset_timer_updates_suggestions_without_device_commands(self):
        from thermal_pilot.model import thermostat_timing
        from datetime import timedelta
        rows=[{'start':(now+timedelta(hours=1)).isoformat(),'end':(now+timedelta(hours=2)).isoformat(),'heat':True}]
        timing=thermostat_timing(rows,{**DEFAULTS,'maximum':23},20,now)
        self.c.data={'rooms':{'test':{'plan':timing}}}
        with patch('thermal_pilot.coordinator.async_track_point_in_utc_time',return_value=lambda:None) as track:
            self.c.arm_command_timer(self.c.data,now)
            self.assertEqual(track.call_args.args[2],now+timedelta(minutes=55))
            await self.c.update_command_state(now+timedelta(minutes=55))
            self.assertEqual(self.c.data['rooms']['test']['plan']['setpoint'],21.5)
            self.assertEqual(track.call_args.args[2],now+timedelta(hours=1,minutes=50))
            await self.c.update_command_state(now+timedelta(hours=1,minutes=50))
            self.assertEqual(self.c.data['rooms']['test']['plan']['setpoint'],19)
            self.assertIsNone(self.c._command_timer)
        self.hass.services.async_call.assert_not_awaited()

    async def test_live_control_applies_offsets_and_releases_on_simulation(self):
        from thermal_pilot.model import thermostat_timing
        self.c.settings.update(simulation_enabled=False,live_control_confirmed=True)
        rows=[{'start':(now+timedelta(hours=1)).isoformat(),'end':(now+timedelta(hours=2)).isoformat(),'heat':True}]
        timing=thermostat_timing(rows,{**DEFAULTS,'maximum':23},20,now)
        timing['slots']=[{**rows[0],'start':now.isoformat()}]
        self.c._plan_settings=deepcopy(self.c.settings)
        self.c.data={'rooms':{'11111111-1111-4111-8111-111111111111':{'plan':timing}}}
        await self.c.update_command_state(now+timedelta(minutes=55))
        self.assertEqual(self.hass.services.async_call.call_args.args[2]['temperature'],21.5)
        self.hass.states['climate.room'].attributes['temperature']=21.5
        await self.c.update_command_state(now+timedelta(hours=1,minutes=50))
        self.assertEqual(self.hass.services.async_call.call_args.args[2]['temperature'],19)
        self.hass.states['climate.room'].attributes['temperature']=19
        self.c.settings.update(simulation_enabled=True,live_control_confirmed=False)
        await self.c._async_update_data()
        self.assertEqual(self.hass.services.async_call.call_args.args[2]['temperature'],20)
        self.assertFalse(self.c.managed_rooms)

    async def test_live_timer_restores_normal_after_temporary_reduction(self):
        from thermal_pilot.model import thermostat_timing
        self.c.settings.update(simulation_enabled=False,live_control_confirmed=True)
        rid=self.c.settings['rooms'][0]['id']
        rows=[{'start':now.isoformat(),'end':(now+timedelta(hours=1)).isoformat(),'heat':True,'mode':'boost'},
              {'start':(now+timedelta(hours=1)).isoformat(),'end':(now+timedelta(hours=2)).isoformat(),'heat':False,'mode':'reduced'},
              {'start':(now+timedelta(hours=2)).isoformat(),'end':(now+timedelta(hours=3)).isoformat(),'heat':False,'mode':'normal'}]
        timing={**thermostat_timing(rows,self.c.settings,20,now),'slots':rows}
        self.c._plan_settings=deepcopy(self.c.settings)
        self.c.data={'rooms':{rid:{'plan':timing}}}
        with patch('thermal_pilot.coordinator.async_track_point_in_utc_time',return_value=lambda:None) as timer:
            await self.c.update_command_state(now)
            self.assertEqual(self.hass.services.async_call.call_args.args[2]['temperature'],21.5)
            self.assertEqual(timer.call_args.args[2],now+timedelta(minutes=50))
            self.hass.states['climate.room'].attributes['temperature']=21.5
            await self.c.update_command_state(now+timedelta(minutes=50))
            self.assertEqual(self.hass.services.async_call.call_args.args[2]['temperature'],20)
            self.assertEqual(timer.call_args.args[2],now+timedelta(hours=1))
            self.hass.states['climate.room'].attributes['temperature']=20
            await self.c.update_command_state(now+timedelta(hours=1))
            self.assertEqual(self.hass.services.async_call.call_args.args[2]['temperature'],19)
            self.assertEqual(timer.call_args.args[2],now+timedelta(hours=2))
            self.hass.states['climate.room'].attributes['temperature']=19
            await self.c.update_command_state(now+timedelta(hours=2))
            self.assertEqual(self.hass.services.async_call.call_args.args[2]['temperature'],20)
            self.assertEqual(self.c.data['rooms'][rid]['plan']['mode'],'normal')

    async def test_live_missing_inputs_and_expired_plan_use_normal_target(self):
        self.c.settings.update(simulation_enabled=False,live_control_confirmed=True)
        self.hass.states['climate.room'].attributes['temperature']=22
        self.hass.states['sensor.room'].state='unavailable'
        data=await self.c._async_update_data()
        self.assertEqual(data['control']['fallback_rooms'],['Study'])
        self.assertEqual(self.hass.services.async_call.call_args.args[2]['temperature'],20)
        self.hass.states['sensor.room'].state='20'
        self.hass.states['sensor.price'].state='unavailable'
        data=await self.c._async_update_data()
        self.assertEqual(data['control']['targets']['11111111-1111-4111-8111-111111111111'],20)
        self.hass.states['sensor.price'].state='10'
        data=await self.c._async_update_data()
        self.c.data=data
        self.hass.states['climate.room'].attributes['temperature']=22
        await self.c.update_command_state(now+timedelta(days=2))
        self.assertEqual(self.c.data['control']['fallback_rooms'],['Study'])
        self.assertEqual(self.hass.services.async_call.call_args.args[2]['temperature'],20)

    async def test_changed_settings_block_stale_timer_and_removed_room_restores_target(self):
        self.c.settings.update(simulation_enabled=False,live_control_confirmed=True)
        data=await self.c._async_update_data()
        self.c.data=data
        self.c.settings['boost']=2
        self.hass.services.async_call.reset_mock()
        await self.c.update_command_state(now+timedelta(minutes=1))
        self.hass.services.async_call.assert_not_awaited()
        self.hass.states['climate.room'].attributes['temperature']=22
        self.c.settings['rooms']=[]
        await self.c._async_update_data()
        self.assertEqual(self.hass.services.async_call.call_args.args[2]['temperature'],20)
        self.assertFalse(self.c.managed_rooms)

    async def test_source_recovery_is_debounced_and_listener_cleanup(self):
        from unittest.mock import Mock
        self.c.listen_sources()
        with patch('thermal_pilot.coordinator.async_track_point_in_utc_time',return_value=Mock()) as track:
            self.c.source_changed(types.SimpleNamespace(data={'entity_id':'sensor.price','old_state':State('unavailable'),'new_state':State('10')}))
            self.assertEqual(track.call_args.args[2],now+timedelta(seconds=5))
            self.c.source_changed(types.SimpleNamespace(data={'entity_id':'sensor.room','old_state':State('20'),'new_state':State('21')}))
            self.assertEqual(track.call_count,1)
            self.c.async_request_refresh=AsyncMock()
            await track.call_args.args[1](now+timedelta(seconds=5))
            self.c.async_request_refresh.assert_awaited_once()
        self.c.stop()
        self.assertIsNone(self.c._source_unsubscribe)

    async def test_live_passive_uses_winter_and_summer_fallbacks(self):
        self.c.settings.update(simulation_enabled=False,live_control_confirmed=True,heating_enabled=False)
        self.hass.states['climate.room'].attributes['temperature']=22
        winter=await self.c._async_update_data()
        self.assertEqual(winter['control']['mode'],'paused')
        self.assertEqual(self.hass.services.async_call.call_args.args[2]['temperature'],20)
        with patch('thermal_pilot.coordinator.dt_util.utcnow',return_value=now.replace(month=5,day=15)):
            summer=await self.c._async_update_data()
        self.assertEqual(summer['fallback_season']['season'],'summer')
        self.assertEqual(self.hass.services.async_call.call_args.args[2]['temperature'],10)
        self.assertEqual(self.c.history_db.size()['rows'],0)

    async def test_live_restart_restores_ownership_and_keeps_activation(self):
        self.c.settings.update(simulation_enabled=False,live_control_confirmed=True)
        await self.c._async_update_data()
        saved=self.c.storage_data()
        self.c.managed_rooms={}
        self.c.store.saved=deepcopy(saved)
        await self.c.load()
        self.assertIn('climate.room',self.c.managed_rooms)
        self.hass.states['climate.room'].attributes['temperature']=22
        self.c.settings.update(simulation_enabled=True,live_control_confirmed=False)
        await self.c._async_update_data()
        self.assertEqual(self.hass.services.async_call.call_args.args[2]['temperature'],20)

    async def restarted_live_coordinator(self, reported_target):
        """New process: only settings/model ownership survive, never old commands."""
        self.c.settings.update(simulation_enabled=False,live_control_confirmed=True)
        saved=deepcopy(self.c.storage_data())
        entry=types.SimpleNamespace(entry_id='test',data=deepcopy(self.c.settings),options={})
        restarted=PilotCoordinator(self.hass,entry)
        restarted.store.saved=saved
        await restarted.load()
        self.hass.states['climate.room'].attributes['temperature']=reported_target
        self.hass.services.async_call.reset_mock()
        return restarted

    async def test_one_hour_outage_replans_and_applies_current_target_both_directions(self):
        from thermal_pilot.model import thermostat_timing
        restarted_at=now+timedelta(hours=1)
        for was_heating,heat_now in [(True,False),(False,True)]:
            with self.subTest(was_heating=was_heating,heat_now=heat_now):
                from thermal_pilot.model import initial_model
                rid=self.c.settings['rooms'][0]['id']
                self.c.models[rid]={**initial_model(self.c.settings['rooms'][0]),'response':0.8}
                self.c.previous[rid]={'time':now.timestamp(),'temperature':20}
                restarted=await self.restarted_live_coordinator(21.5 if was_heating else 19)
                self.assertFalse(restarted.previous)
                # Simulate the fresh planner; the pre-crash plan must not be reused.
                def fresh_plan(settings,model,temperature,outdoors,slots,current,*args):
                    self.assertEqual(current,restarted_at)
                    self.assertIsNone(settings['committed_session'])
                    self.assertEqual(model['response'],0)
                    rows=[{'start':current.isoformat(),'end':(current+timedelta(hours=2)).isoformat(),'heat':heat_now,'predicted_demand':heat_now,'temperature':20.5}]
                    return {**thermostat_timing(rows,settings,20,current),'slots':rows,'scheduled_heat':heat_now}
                with patch('thermal_pilot.coordinator.dt_util.utcnow',return_value=restarted_at), patch('thermal_pilot.coordinator.plan',side_effect=fresh_plan) as planner, patch('thermal_pilot.coordinator.async_track_point_in_utc_time',return_value=lambda:None) as timer:
                    data=await restarted._async_update_data()
                planner.assert_called_once()
                self.assertEqual(self.hass.services.async_call.await_count,1)
                self.assertEqual(self.hass.services.async_call.call_args.args[2]['temperature'],21.5 if heat_now else 19)
                self.assertEqual(data['control']['mode'],'live')
                self.assertGreater(timer.call_args.args[2],restarted_at)
                restarted.stop()

    async def test_restart_writes_current_target_even_when_restored_attribute_matches(self):
        restarted=await self.restarted_live_coordinator(20)
        self.hass.states['sensor.price'].state='unavailable'
        data=await restarted._async_update_data()
        self.assertEqual(data['control']['fallback_rooms'],['Study'])
        self.hass.services.async_call.assert_awaited_once_with('climate','set_temperature',{'entity_id':'climate.room','temperature':20},blocking=True)
        await restarted._async_update_data()
        self.assertEqual(self.hass.services.async_call.await_count,1)
        restarted.stop()

    async def test_restart_missing_sources_uses_fallback_then_replans_on_recovery(self):
        restarted=await self.restarted_live_coordinator(21.5)
        self.hass.states['sensor.price'].state='unavailable'
        restart_time=now+timedelta(hours=1)
        with patch('thermal_pilot.coordinator.dt_util.utcnow',return_value=restart_time):
            data=await restarted._async_update_data()
        self.assertEqual(data['control']['targets'][self.c.settings['rooms'][0]['id']],20)
        self.hass.states['climate.room'].attributes['temperature']=20
        self.hass.states['sensor.price'].state='10'
        with patch('thermal_pilot.coordinator.dt_util.utcnow',return_value=restart_time+timedelta(seconds=5)):
            recovered=await restarted._async_update_data()
        self.assertFalse(recovered['control']['fallback_rooms'])
        self.assertIsNotNone(next(iter(recovered['rooms'].values()))['plan'])
        self.assertEqual(self.hass.services.async_call.call_args.args[2]['temperature'],next(iter(recovered['rooms'].values()))['plan']['setpoint'])
        restarted.stop()

    async def test_restart_unavailable_thermostat_retries_when_device_returns(self):
        restarted=await self.restarted_live_coordinator(10)
        restarted.settings['heating_enabled']=False
        self.hass.states['climate.room'].state='unavailable'
        data=await restarted._async_update_data()
        self.assertTrue(data['control']['errors'])
        self.hass.services.async_call.assert_not_awaited()
        self.hass.states['climate.room'].state='heat'
        self.hass.states['climate.room'].attributes['temperature']=20
        await restarted._async_update_data()
        self.assertEqual(self.hass.services.async_call.call_args.args[2]['temperature'],20)
        restarted.stop()

    async def test_restart_sources_and_thermostat_take_ten_minutes_to_recover(self):
        restarted=await self.restarted_live_coordinator(21.5)
        entities=['sensor.out','sensor.water','sensor.price','sensor.room']
        for entity in entities:
            self.hass.states[entity].state='unavailable'
        self.hass.states['climate.room'].state='unavailable'
        restart_time=now+timedelta(hours=1)
        for minutes in (0,5,10):
            with patch('thermal_pilot.coordinator.dt_util.utcnow',return_value=restart_time+timedelta(minutes=minutes)):
                data=await restarted._async_update_data()
            self.assertEqual(data['control']['fallback_rooms'],['Study'])
            self.assertIsNone(next(iter(data['rooms'].values()))['plan'])
            self.assertFalse(restarted.previous)
        self.hass.services.async_call.assert_not_awaited()
        # Device recovers first: comfort fallback can be sent without source data.
        self.hass.states['climate.room'].state='heat'
        with patch('thermal_pilot.coordinator.dt_util.utcnow',return_value=restart_time+timedelta(minutes=10,seconds=5)):
            data=await restarted._async_update_data()
        self.assertEqual(self.hass.services.async_call.call_args.args[2]['temperature'],20)
        self.assertEqual(data['control']['fallback_rooms'],['Study'])
        for entity,value in zip(entities,['-10','32','10','20']):
            self.hass.states[entity].state=value
        self.hass.states['climate.room'].attributes['temperature']=20
        # Existing event listener requests recovery after five seconds.
        with patch('thermal_pilot.coordinator.dt_util.utcnow',return_value=restart_time+timedelta(minutes=11)), patch('thermal_pilot.coordinator.async_track_point_in_utc_time',return_value=lambda:None) as timer:
            restarted.source_changed(types.SimpleNamespace(data={'entity_id':'sensor.room','old_state':State('unavailable'),'new_state':State('20')}))
            self.assertEqual(timer.call_args.args[2],restart_time+timedelta(minutes=11,seconds=5))
            async def refresh():
                restarted.data=await restarted._async_update_data()
            restarted.async_request_refresh=refresh
            recovery=timer.call_args.args[1]
            with patch('thermal_pilot.coordinator.dt_util.utcnow',return_value=restart_time+timedelta(minutes=11,seconds=5)):
                await recovery(restart_time+timedelta(minutes=11,seconds=5))
        self.assertFalse(restarted.data['control']['fallback_rooms'])
        self.assertIsNotNone(next(iter(restarted.data['rooms'].values()))['plan'])
        self.assertTrue(restarted.data['source_status']['prices'])
        restarted.stop()

    async def test_restart_passive_recomputes_season_after_calendar_boundary(self):
        restarted=await self.restarted_live_coordinator(20)
        restarted.settings['heating_enabled']=False
        with patch('thermal_pilot.coordinator.dt_util.utcnow',return_value=now.replace(month=5,day=15)):
            data=await restarted._async_update_data()
        self.assertEqual(data['fallback_season']['season'],'summer')
        self.assertEqual(self.hass.services.async_call.call_args.args[2]['temperature'],10)
        restarted.stop()

    async def test_passive_cancels_offset_timer(self):
        from unittest.mock import Mock
        cancel=Mock();self.c._command_timer=cancel
        self.c.settings['heating_enabled']=False
        await self.c._async_update_data()
        cancel.assert_called_once()
        self.assertIsNone(self.c._command_timer)

    async def test_thermostat_relay_uses_on_off_states(self):
        room=self.c.settings['rooms'][0]
        for entity in ('switch.relay','binary_sensor.relay'):
            room['activity_entity']=entity
            self.hass.states[entity]=State('on')
            self.assertEqual(self.c.activity(room),1.0)
            self.hass.states[entity]=State('off')
            self.assertEqual(self.c.activity(room),0.0)
            self.hass.states[entity]=State('unknown')
            self.assertIsNone(self.c.activity(room))
        room['activity_entity']=''
        self.hass.states['climate.room'].attributes['hvac_action']='heating'
        self.assertEqual(self.c.activity(room),1.0)

    async def test_climate_supply_water_uses_measured_attribute(self):
        self.c.settings['water_entity']='climate.panasonic_heat_pump_main_z1_temp'
        self.c.settings['water_reference']=32
        self.hass.states[self.c.settings['water_entity']]=State('heat',{'temperature':35,'current_temperature':28})
        with patch('thermal_pilot.coordinator.plan',return_value=None) as planner:
            await self.c._async_update_data()
        self.assertAlmostEqual(planner.call_args.args[7],(28-20)/(32-20))

    async def test_global_thermal_parameters_override_legacy_room_values(self):
        room=self.c.settings['rooms'][0]
        room.update(lag_hours=10,curve_warm_temp=10,curve_cold_temp=-30,water_reference=45,design_room_temp=25)
        self.c.settings.update(lag_hours=2,curve_warm_temp=0,curve_cold_temp=-18,water_reference=32)
        with patch('thermal_pilot.coordinator.plan',return_value=None) as planner:
            await self.c._async_update_data()
        effective=planner.call_args.args[0]
        for key in ('lag_hours','curve_warm_temp','curve_cold_temp','water_reference'):
            self.assertEqual(effective[key],self.c.settings[key])
        expected_room={**effective,'baseline':20}
        from thermal_pilot.model import initial_model
        self.assertEqual(self.c.models[room['id']]['base_gain'],initial_model(expected_room)['base_gain'])
    async def test_passive_stops_plans_and_history(self):
        self.c.settings['heating_enabled']=False
        result=await self.c._async_update_data()
        self.assertFalse(result['heating_active']);self.assertEqual(result['rooms'],{})
        self.assertEqual(self.c.history_db.size()['rows'],0)
    async def test_summer_target_opt_in(self):
        self.c.settings.update(heating_enabled=False,apply_season_setpoints=True,summer_setpoint=10)
        with patch('thermal_pilot.coordinator.dt_util.utcnow',return_value=now.replace(month=5,day=15)):
            await self.c._async_update_data()
        self.hass.services.async_call.assert_awaited_once_with('climate','set_temperature',{'entity_id':'climate.room','temperature':10},blocking=True)
        with patch('thermal_pilot.coordinator.dt_util.utcnow',return_value=now.replace(month=5,day=15)):
            await self.c._async_update_data()
        self.assertEqual(self.hass.services.async_call.await_count,1)
    async def test_active_restores_room_target(self):
        self.c.settings.update(heating_enabled=False,apply_season_setpoints=True)
        await self.c._async_update_data()
        self.c.settings['heating_enabled']=True
        await self.c._async_update_data()
        self.assertEqual(self.hass.services.async_call.await_args.args[2]['temperature'],20)
    async def test_legacy_helper_no_longer_blocks_operation(self):
        self.c.settings['activation_entity']='input_boolean.heating';self.hass.states['input_boolean.heating'].state='off'
        result=await self.c._async_update_data()
        self.assertTrue(result['heating_active']);self.assertEqual(self.c.history_db.size()['rows'],1)
    async def test_missing_room_sensor_suppresses_plan(self):
        self.hass.states.pop('sensor.room')
        result=await self.c._async_update_data()
        self.assertIsNone(next(iter(result['rooms'].values()))['plan'])
    async def test_missing_optional_water_preserves_plan_and_learning(self):
        await self.c._async_update_data()
        self.hass.states.pop('sensor.water')
        with patch('thermal_pilot.coordinator.dt_util.utcnow',return_value=now+timedelta(minutes=5)):
            result=await self.c._async_update_data()
        self.assertTrue(all(room['plan'] is not None for room in result['rooms'].values()))
        self.assertTrue(self.c.previous)
        self.assertTrue(all(row['water_factor']==1 for row in self.c.previous.values()))
        self.assertEqual(self.c.history_db.size()['rows'],2)
        self.hass.services.async_call.assert_not_awaited()
    async def test_passive_transition_compacts(self):
        self.c.settings['season_archive_enabled']=False  # Removed legacy preference is ignored.
        await self.c._async_update_data()
        self.c.settings['heating_enabled']=False
        await self.c._async_update_data()
        self.assertEqual(len(self.c.history_db.summaries()),1)
    async def test_failed_season_write_is_retried(self):
        self.c.settings.update(heating_enabled=False,apply_season_setpoints=True)
        self.hass.services.async_call.side_effect=RuntimeError('offline')
        result=await self.c._async_update_data()
        self.assertTrue(any('failed' in w for w in result['warnings']))
        self.hass.services.async_call.side_effect=None
        await self.c._async_update_data()
        self.assertEqual(self.hass.services.async_call.await_count,2)

class GarageCoordinatorTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp=tempfile.TemporaryDirectory();self.hass=Hass(self.temp.name)
        self.floor={**ROOM_DEFAULTS,'id':'11111111-1111-4111-8111-111111111111','name':'Floor room','thermostat':'climate.room','temperature_entity':'sensor.room'}
        self.garage={**ROOM_DEFAULTS,'id':'22222222-2222-4222-8222-222222222222','name':'Garage','thermostat':'climate.garage','temperature_entity':'sensor.garage','is_garage':True}
        self.hass.states.update({'sensor.garage':State('4'),'climate.garage':State('fan_only',{'hvac_modes':['heat','fan_only','off'],'fan_modes':['low','high'],'swing_modes':['off','both'],'temperature':20,'min_temp':16,'max_temp':30,'hvac_action':'fan'})})
        entry=types.SimpleNamespace(entry_id='garage',data={**DEFAULTS,'price_entity':'sensor.price','outdoor_entity':'sensor.out','water_entity':'sensor.water','rooms':[self.floor]},options={})
        self.c=PilotCoordinator(self.hass,entry);await self.c.load()
    async def asyncTearDown(self):self.temp.cleanup()
    async def test_adding_garage_preserves_floor_model_and_uses_no_water_offsets(self):
        await self.c._async_update_data();fingerprint=deepcopy(self.c.config_fingerprint[self.floor['id']]);model=self.c.models[self.floor['id']];model['samples']=123
        self.c.settings['rooms'].append(self.garage)
        self.c.settings['apply_season_setpoints']=True
        data=await self.c._async_update_data()
        self.assertEqual(fingerprint,self.c.config_fingerprint[self.floor['id']]);self.assertIs(model,self.c.models[self.floor['id']]);self.assertEqual(model['samples'],123)
        garage=data['rooms'][self.garage['id']]
        self.assertEqual(garage['plan']['comfort_floor'],5);self.assertEqual(garage['pump_suggestion']['target'],16)
        self.assertEqual(self.c.previous[self.garage['id']]['water_factor'],1);self.assertIsNone(self.c.previous[self.garage['id']]['water'])
        self.assertFalse(any(call.args[2].get('entity_id')=='climate.garage' for call in self.hass.services.async_call.call_args_list))
    async def test_live_garage_ignores_missing_prices_and_has_separate_device_target(self):
        self.c.settings.update(rooms=[self.garage],price_entity='',simulation_enabled=False,live_control_confirmed=True)
        self.hass.states.pop('sensor.price')
        data=await self.c._async_update_data()
        self.assertFalse(data['source_status']['prices_required']);self.assertEqual(data['control']['mode'],'live')
        self.assertFalse(any('price' in w.lower() for w in data['warnings']))
        self.assertEqual(self.hass.services.async_call.call_args.args[1:3],('set_hvac_mode',{'entity_id':'climate.garage','hvac_mode':'heat'}))
        self.hass.states['climate.garage'].state='heat';self.c.data=data
        await self.c.update_command_state(now+timedelta(seconds=10))
        writes=[call for call in self.hass.services.async_call.call_args_list if call.args[1]=='set_temperature']
        self.assertEqual([call.args[2]['temperature'] for call in writes],[16])
    async def test_simulation_and_relinquish_are_separate_from_floor_targets(self):
        self.c.settings.update(rooms=[self.garage],price_entity='')
        await self.c._async_update_data();self.hass.services.async_call.assert_not_awaited()
        self.c.settings.update(simulation_enabled=False,live_control_confirmed=True)
        await self.c._async_update_data()
        self.hass.states['climate.garage'].state='heat';self.hass.services.async_call.reset_mock()
        self.c.settings['simulation_enabled']=True
        await self.c._async_update_data()
        self.assertEqual([call.args[1] for call in self.hass.services.async_call.call_args_list],['set_hvac_mode'])
        self.assertEqual(self.hass.services.async_call.call_args.args[2]['hvac_mode'],'fan_only')
        self.hass.services.async_call.reset_mock();await self.c._async_update_data();self.hass.services.async_call.assert_not_awaited()
    async def test_shared_zone_commands_only_one_climate_entity(self):
        from thermal_pilot.const import ZONE_DEFAULTS
        main={**self.garage,'is_garage':False,'baseline':20,'thermostat':'','heating_zone_id':'zone'}
        member={**self.floor,'thermostat':'','heating_zone_id':'zone'}
        zone={**ZONE_DEFAULTS,'id':'zone','name':'House pump','thermostat':'climate.garage','main_room_id':main['id'],'temperature_policy':'coldest','heating_enabled':True}
        self.hass.states['sensor.garage'].state='18'
        self.c.settings.update(rooms=[main,member],heating_zones=[zone],simulation_enabled=False,live_control_confirmed=True)
        data=await self.c._async_update_data()
        self.assertTrue(data['rooms'][member['id']]['zone_monitor'])
        writes=[call for call in self.hass.services.async_call.call_args_list if call.args[0]=='climate']
        self.assertEqual(len(writes),1);self.assertEqual(writes[0].args[2]['entity_id'],'climate.garage')
    async def test_release_retries_until_fan_only_is_reported(self):
        self.c.settings.update(rooms=[self.garage],price_entity='',simulation_enabled=False,live_control_confirmed=True)
        await self.c._async_update_data()
        self.hass.states['climate.garage'].state='heat';self.c.settings['simulation_enabled']=True
        self.hass.services.async_call.reset_mock()
        data=await self.c._async_update_data()
        self.assertIn('climate.garage',self.c.managed_rooms)
        self.assertEqual(self.hass.services.async_call.call_args.args[2]['hvac_mode'],'fan_only')
        self.c.data=data
        await self.c.update_command_state(now+timedelta(seconds=60))
        self.assertEqual(self.hass.services.async_call.await_count,2)
        self.assertIn('climate.garage',self.c.managed_rooms)
        self.hass.states['climate.garage'].state='fan_only'
        await self.c.update_command_state(now+timedelta(seconds=70))
        self.assertNotIn('climate.garage',self.c.managed_rooms)

    async def test_zone_control_opt_in_and_release(self):
        from thermal_pilot.const import ZONE_DEFAULTS
        main={**self.garage,'is_garage':False,'baseline':20,'thermostat':'','heating_zone_id':'zone'}
        zone={**ZONE_DEFAULTS,'id':'zone','name':'House pump','thermostat':'climate.garage','main_room_id':main['id']}
        self.hass.states['sensor.garage'].state='18'
        self.c.settings.update(rooms=[main],heating_zones=[zone],simulation_enabled=False,live_control_confirmed=True)
        await self.c._async_update_data();self.hass.services.async_call.assert_not_awaited()
        zone['heating_enabled']=True
        await self.c._async_update_data();self.assertEqual(self.hass.services.async_call.call_args.args[2]['hvac_mode'],'heat')
        self.hass.states['climate.garage'].state='heat';zone['heating_enabled']=False
        self.hass.services.async_call.reset_mock();await self.c._async_update_data()
        self.assertEqual(self.hass.services.async_call.call_args.args[2]['hvac_mode'],'fan_only')
        self.hass.states['climate.garage'].state='fan_only'
        self.hass.services.async_call.reset_mock();await self.c._async_update_data()
        self.hass.services.async_call.assert_not_awaited()

    async def test_cooling_zone_has_no_heating_plan_and_excludes_cooling_learning(self):
        from thermal_pilot.const import ZONE_DEFAULTS
        from unittest.mock import patch
        main={**self.garage,'is_garage':False,'baseline':20,'thermostat':'','heating_zone_id':'zone'}
        zone={**ZONE_DEFAULTS,'id':'zone','name':'Summer pump','thermostat':'climate.garage','main_room_id':main['id'],'climate_mode':'cool','heating_enabled':True}
        self.hass.states['climate.garage'].attributes['hvac_modes']=['heat','cool','fan_only','off']
        self.hass.states['sensor.garage'].state='26'
        self.c.settings.update(rooms=[main],heating_zones=[zone],simulation_enabled=False,live_control_confirmed=True)
        with patch('thermal_pilot.coordinator.fallback_season',return_value={'summer':True,'days':{}}):
            data=await self.c._async_update_data()
            self.assertIsNone(data['rooms'][main['id']]['plan'])
            self.assertEqual(self.hass.services.async_call.call_args.args[2]['hvac_mode'],'cool')
            self.hass.states['climate.garage'].state='cool'
            await self.c._async_update_data()
            self.assertTrue(self.c.previous[main['id']]['excluded'])

    async def test_cooling_zone_keeps_learned_loss_but_not_old_heating_fit(self):
        from thermal_pilot.const import ZONE_DEFAULTS
        from thermal_pilot.model import heat_retention
        self.c.settings.update(rooms=[self.floor])
        await self.c._async_update_data()
        rid=self.floor['id'];model=self.c.models[rid]
        model.update(loss=.008,heated_hours=30,idle_hours=40,parameter_updates=12,xx=100,xy=20,gain=2)
        before=heat_retention(model)
        self.floor['heating_zone_id']='cool-zone'
        self.c.settings['heating_zones']=[{**ZONE_DEFAULTS,'id':'cool-zone','name':'Summer','thermostat':'climate.garage','main_room_id':rid,'climate_mode':'cool'}]
        await self.c._async_update_data()
        after=heat_retention(self.c.models[rid])
        self.assertEqual(after['drop_6h'],before['drop_6h'])
        self.assertEqual(after['hours_per_degree'],before['hours_per_degree'])
        self.assertTrue(after['updated'])
        self.assertEqual(self.c.models[rid]['xx'],0)
        self.assertEqual(self.c.models[rid]['heated_hours'],0)
        # A different room temperature sensor still requires a fresh model.
        self.hass.states['sensor.new_room']=State('20')
        self.floor['temperature_entity']='sensor.new_room'
        await self.c._async_update_data()
        self.assertEqual(self.c.models[rid]['loss'],.007)
        self.assertFalse(heat_retention(self.c.models[rid])['updated'])

    async def test_reset_warning_uses_actual_learning_fingerprints_without_mutation(self):
        from thermal_pilot.const import ZONE_DEFAULTS
        self.c.settings.update(rooms=[self.floor])
        await self.c._async_update_data()
        rid=self.floor['id'];self.c.models[rid].update(loss=.008,samples=100,parameter_updates=3)
        original=deepcopy(self.c.models)
        proposed=deepcopy(self.c.settings);proposed['rooms'][0]['name']='Renamed'
        self.assertEqual(self.c.learning_changes(proposed),[])
        proposed['rooms'][0]['heating_zone_id']='summer'
        proposed['heating_zones']=[{**ZONE_DEFAULTS,'id':'summer','name':'Summer','thermostat':'climate.garage','main_room_id':rid,'climate_mode':'cool'}]
        self.assertEqual(self.c.learning_changes(proposed),[{'room_id':rid,'name':'Renamed','scope':'heating_response'}])
        proposed['rooms'][0]['temperature_entity']='sensor.changed'
        self.assertEqual(self.c.learning_changes(proposed)[0]['scope'],'full')
        self.assertEqual(self.c.models,original)

    async def test_zone_history_uses_activity_and_records_even_when_control_disabled(self):
        from thermal_pilot.const import ZONE_DEFAULTS
        self.c.settings['heating_zones']=[{**ZONE_DEFAULTS,'id':'observed','name':'Observed pump','thermostat':'climate.garage','heating_enabled':False}]
        pump=self.hass.states['climate.garage'];pump.state='cool';pump.attributes['hvac_action']='idle'
        self.assertIsNone(self.c.zone_observations(now)[0]['zone_mode'])
        pump.attributes['hvac_action']='cooling'
        self.assertEqual(self.c.zone_observations(now)[0]['zone_mode'],'cool')
        pump.attributes.pop('hvac_action');pump.state='heat'
        row=self.c.zone_observations(now)[0]
        self.assertEqual((row['zone_mode'],row['zone_basis']),('heat','operating_mode'))
        pump.state='unavailable';self.assertIsNone(self.c.zone_observations(now)[0]['zone_mode'])
        await self.c._async_update_data()
        rows=self.c.history_db.read(now.timestamp()-300)
        self.assertTrue(any(row.get('zone_id')=='observed' for row in rows))

    async def test_initial_garage_prior_is_four_hours_and_fitted_loss_is_preserved(self):
        from thermal_pilot.model import initial_model,heat_retention
        fresh=initial_model(self.garage)
        self.assertEqual(heat_retention(fresh)['hours_per_degree'],4)
        self.assertFalse(heat_retention(fresh)['updated'])
        self.c.settings['rooms']=[self.garage]
        await self.c._async_update_data()
        rid=self.garage['id'];model=self.c.models[rid]
        model.update(loss=.007,samples=200,heated_hours=20,idle_hours=30,parameter_updates=0)
        await self.c._async_update_data()
        self.assertEqual(heat_retention(self.c.models[rid])['hours_per_degree'],4)
        self.assertFalse(heat_retention(self.c.models[rid])['updated'])
        self.assertEqual(self.c.models[rid]['samples'],200)
        model.update(loss=.012,parameter_updates=3)
        await self.c._async_update_data()
        self.assertEqual(self.c.models[rid]['loss'],.012)

    async def test_construction_reference_changes_badge_context_without_resetting_room_model(self):
        from thermal_pilot.const import HOUSE_COOLING_REFERENCES
        from thermal_pilot.model import heat_retention,initial_model,cooling_reference
        self.c.settings['rooms']=[self.floor]
        await self.c._async_update_data()
        rid=self.floor['id'];model=self.c.models[rid]
        model.update(loss=.008,parameter_updates=3,heated_hours=30,idle_hours=40)
        original=heat_retention(model)
        proposed=deepcopy(self.c.settings);proposed['house_construction']='wooden_detached'
        self.assertEqual(self.c.learning_changes(proposed),[])
        self.c.settings=proposed
        data=await self.c._async_update_data()
        self.assertIs(self.c.models[rid],model)
        self.assertEqual(data['rooms'][rid]['heat_retention']['drop_6h'],original['drop_6h'])
        self.assertAlmostEqual(data['rooms'][rid]['heat_retention']['reference_hours'],2.12,places=2)
        self.assertEqual(data['rooms'][rid]['heat_retention']['reference_type'],'wooden_detached')
        for kind in HOUSE_COOLING_REFERENCES:
            room={**self.floor,'house_construction':kind}
            self.assertAlmostEqual(heat_retention(initial_model(room))['hours_per_degree'],round(cooling_reference(room)['reference_hours'],2))
            self.assertFalse(heat_retention(initial_model(room))['updated'])
        # Garage metadata is separate and never borrows an occupied-house reference.
        for kind in ['unknown','timber_frame','masonry','lightweight_metal']:
            garage={**self.garage,'garage_construction':kind,'house_construction':'heavy_masonry_apartment'}
            self.assertIsNone(cooling_reference(garage))
            self.assertEqual(heat_retention(initial_model(garage))['hours_per_degree'],4)
