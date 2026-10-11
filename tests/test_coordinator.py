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
    async def test_chart_prices_are_exposed_and_recorded(self):
        data=await self.c._async_update_data()
        self.assertEqual(data['price_chart'][0]['price'],10)
        self.assertEqual(len(data['price_chart']),96)
        self.assertEqual(self.c.history_db.read(0)[0]['price'],10)

    async def test_sensor_warning_after_six_hours_aggregates_and_limits_daily(self):
        second={**self.c.settings['rooms'][0],'id':'second','name':'Bedroom','temperature_entity':'sensor.second'}
        self.c.settings['rooms'].append(second)
        self.hass.states['sensor.second']=State('unknown')
        for step in range(12):
            await self.c.check_temperature_sensors(now+timedelta(minutes=30*step),True)
        self.hass.services.async_call.assert_not_awaited()
        await self.c.check_temperature_sensors(now+timedelta(hours=6),True)
        self.hass.services.async_call.assert_awaited_once()
        notification=self.hass.services.async_call.await_args.args[2]
        self.assertIn('Study',notification['message']);self.assertIn('Bedroom',notification['message'])
        self.assertIn('unavailable',notification['message'])
        self.assertEqual(self.c.store.saved['sensor_health']['last_notification_day'],'2026-01-02')
        # Loading saved state does not permit a repeated notification on the same day.
        self.c.sensor_health=deepcopy(self.c.store.saved['sensor_health'])
        for step in range(13,48):
            await self.c.check_temperature_sensors(now+timedelta(minutes=30*step),True)
        self.assertEqual(self.hass.services.async_call.await_count,1)
        await self.c.check_temperature_sensors(now+timedelta(days=1),True)
        self.assertEqual(self.hass.services.async_call.await_count,2)
        self.assertEqual(self.hass.services.async_call.await_args.args[2]['notification_id'],notification['notification_id'])

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

    async def test_global_simulation_pause_keeps_observations_without_planning(self):
        self.c.settings['simulation_enabled']=False
        with patch('thermal_pilot.coordinator.plan') as planner:
            result=await self.c._async_update_data()
        planner.assert_not_called()
        self.assertTrue(result['rooms'])
        self.assertTrue(all(room['plan'] is None for room in result['rooms'].values()))
        self.assertEqual(self.c.history_db.size()['rows'],1)
        self.assertFalse(self.c.suggested_runs)
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
            self.c.update_command_state(now+timedelta(minutes=55))
            self.assertEqual(self.c.data['rooms']['test']['plan']['setpoint'],21.5)
            self.assertEqual(track.call_args.args[2],now+timedelta(hours=1,minutes=50))
            self.c.update_command_state(now+timedelta(hours=1,minutes=50))
            self.assertEqual(self.c.data['rooms']['test']['plan']['setpoint'],19)
            self.assertIsNone(self.c._command_timer)
        self.hass.services.async_call.assert_not_awaited()

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
        await self.c._async_update_data()
        self.hass.services.async_call.assert_awaited_once_with('climate','set_temperature',{'entity_id':'climate.room','temperature':10},blocking=True)
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
    async def test_missing_water_suppresses_plan_and_learning(self):
        await self.c._async_update_data()
        self.hass.states.pop('sensor.water')
        result=await self.c._async_update_data()
        self.assertTrue(all(room['plan'] is None for room in result['rooms'].values()))
        self.assertFalse(self.c.previous)
        self.assertEqual(self.c.history_db.size()['rows'],1)
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
