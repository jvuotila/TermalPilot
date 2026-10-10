"""HA adapter tests using minimal doubles, not a real Home Assistant runtime."""
import sys,types,tempfile,unittest
from pathlib import Path
from datetime import datetime,timezone
from copy import deepcopy
from unittest.mock import AsyncMock

ROOT=Path(__file__).resolve().parents[1]/'custom_components/thermal_pilot'
pkg=types.ModuleType('thermal_pilot');pkg.__path__=[str(ROOT)];sys.modules.setdefault('thermal_pilot',pkg)
for name in ['homeassistant','homeassistant.helpers','homeassistant.util']:
    sys.modules.setdefault(name,types.ModuleType(name))
coord=types.ModuleType('homeassistant.helpers.update_coordinator')
class DataUpdateCoordinator:
    def __init__(self,hass,*args,**kwargs):self.hass=hass
coord.DataUpdateCoordinator=DataUpdateCoordinator;sys.modules[coord.__name__]=coord
storage=types.ModuleType('homeassistant.helpers.storage')
class Store:
    def __init__(self,*args):self.saved={}
    async def async_load(self):return self.saved
    def async_delay_save(self,callback,delay):self.saved=deepcopy(callback())
storage.Store=Store;sys.modules[storage.__name__]=storage
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
    async def test_read_only_default(self):
        result=await self.c._async_update_data()
        self.assertTrue(result['simulation_only']);self.assertTrue(result['rooms'])
        self.hass.services.async_call.assert_not_awaited()
        self.assertEqual(self.c.history_db.size()['rows'],1)
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
