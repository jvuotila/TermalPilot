"""HA adapter tests using minimal doubles, not a real Home Assistant runtime."""
import sys,types,tempfile,unittest
from pathlib import Path
from datetime import datetime,timezone
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
            'sensor.room':State('20'),'climate.room':State('heat',{'temperature':20,'hvac_action':'idle','min_temp':5,'max_temp':35}),
            'input_boolean.heating':State('on')}
        self.config=types.SimpleNamespace(time_zone='UTC',path=lambda *args:str(Path(path).joinpath(*args)))
        self.services=types.SimpleNamespace(async_call=AsyncMock())
    async def async_add_executor_job(self,fn,*args):return fn(*args)

class CoordinatorTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp=tempfile.TemporaryDirectory();self.hass=Hass(self.temp.name)
        room={**ROOM_DEFAULTS,'id':'11111111-1111-4111-8111-111111111111','name':'Study','thermostat':'climate.room','temperature_entity':'sensor.room'}
        entry=types.SimpleNamespace(entry_id='test',data={**DEFAULTS,'price_entity':'sensor.price','outdoor_entity':'sensor.out','rooms':[room]},options={})
        self.c=PilotCoordinator(self.hass,entry);await self.c.load()
    async def asyncTearDown(self):self.temp.cleanup()
    async def test_shared_setpoint_adjustments_override_legacy_room_values(self):
        first=self.c.settings['rooms'][0]
        first.update(boost=4,setback=3)
        second={**first,'id':'22222222-2222-4222-8222-222222222222','name':'Second','thermostat':'climate.second','temperature_entity':'sensor.second','boost':.2,'setback':.1}
        self.c.settings['rooms'].append(second)
        self.hass.states['climate.second']=State('heat',{'temperature':20,'hvac_action':'idle'})
        self.hass.states['sensor.second']=State('20')
        self.c.settings.update(boost=1.8,setback=.7)
        with patch('thermal_pilot.coordinator.plan',return_value=None) as planner:
            await self.c._async_update_data()
        self.assertEqual(planner.call_count,2)
        for call in planner.call_args_list:
            self.assertEqual(call.args[0]['boost'],1.8)
            self.assertEqual(call.args[0]['setback'],.7)
        self.hass.services.async_call.assert_not_awaited()

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
    async def test_helper_blocks_operation(self):
        self.c.settings['activation_entity']='input_boolean.heating';self.hass.states['input_boolean.heating'].state='off'
        result=await self.c._async_update_data()
        self.assertFalse(result['heating_active']);self.assertEqual(self.c.history_db.size()['rows'],0)
    async def test_missing_room_sensor_suppresses_plan(self):
        self.hass.states.pop('sensor.room')
        result=await self.c._async_update_data()
        self.assertIsNone(next(iter(result['rooms'].values()))['plan'])
    async def test_passive_transition_compacts(self):
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
