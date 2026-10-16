"""Exercise the isolated read-only websocket handler without HA imports."""
import ast
from pathlib import Path
import types
import unittest

SOURCE=Path(__file__).resolve().parents[1]/'custom_components/thermal_pilot/__init__.py'
class Coordinator:
    def __init__(self,name='Home'):
        self.entry=types.SimpleNamespace(title=name)
        self.settings={'language':'fi','rooms':[{'id':'room','name':'Garage','is_garage':True,'thermostat':'climate.private'}], 'secret':'not public'}
        self.data={'rooms':{'room':{'name':'Old','heat_retention':{'drop_6h':1.49,'hours_per_degree':4},'model':{'private':'details'}}}}
class Connection:
    def send_result(self,identifier,value):self.result=value
    def send_error(self,*args):self.error=args
class EndpointTests(unittest.TestCase):
    def setUp(self):
        tree=ast.parse(SOURCE.read_text());handler=next(item for item in tree.body if isinstance(item,ast.FunctionDef) and item.name=='ws_retention')
        self.assertFalse(any(isinstance(item,ast.Attribute) and item.attr=='require_admin' for item in handler.decorator_list))
        handler.decorator_list=[];module=ast.Module(body=[handler],type_ignores=[]);namespace={'PilotCoordinator':Coordinator,'DOMAIN':'thermal_pilot'}
        exec(compile(module,str(SOURCE),'exec'),namespace);self.handler=namespace['ws_retention'];self.connection=Connection();self.hass=types.SimpleNamespace(data={'thermal_pilot':{'_registered':True,'one':Coordinator()}})
    def test_only_dashboard_data_and_integration_language(self):
        self.handler(self.hass,self.connection,{'id':1})
        data=self.connection.result
        self.assertEqual(data['language'],'fi');self.assertEqual(data['entry_id'],'one')
        self.assertEqual(data['rooms'],[{'id':'room','name':'Garage','is_garage':True,'heat_retention':{'drop_6h':1.49,'hours_per_degree':4}}])
        self.assertNotIn('settings',data);self.assertNotIn('model',data['rooms'][0])
    def test_multiple_integrations_require_selection(self):
        self.hass.data['thermal_pilot']['two']=Coordinator('Garage')
        self.handler(self.hass,self.connection,{'id':1})
        self.assertTrue(self.connection.result['requires_selection']);self.assertEqual(self.connection.result['rooms'],[])
        self.handler(self.hass,self.connection,{'id':1,'entry_id':'two'})
        self.assertEqual(self.connection.result['entry_id'],'two')
    def test_unloaded_entry_and_empty_data(self):
        self.handler(self.hass,self.connection,{'id':1,'entry_id':'missing'})
        self.assertEqual(self.connection.error[1],'not_loaded')
        self.hass.data['thermal_pilot']['one'].data=None
        self.handler(self.hass,self.connection,{'id':1})
        self.assertEqual(self.connection.result['rooms'],[])

class CardRegistrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_automatic_module_loading_once_after_static_path_registration(self):
        tree=ast.parse(SOURCE.read_text())
        setup=next(node for node in tree.body if isinstance(node,ast.AsyncFunctionDef) and node.name=='async_setup_entry')
        # Run the real registration portion, before unrelated coordinator startup.
        setup.body=setup.body[:2]+[ast.Return(value=ast.Constant(value=True))]
        ast.fix_missing_locations(setup)
        events=[]
        async def register_paths(paths):events.append(('paths',paths))
        frontend=types.SimpleNamespace(add_extra_js_url=lambda hass,url:events.append(('module',url)))
        namespace={'DOMAIN':'thermal_pilot','VERSION':'test-version','Path':Path,'__file__':str(SOURCE),
                   'StaticPathConfig':lambda *args:args,'frontend':frontend,
                   'websocket_api':types.SimpleNamespace(async_register_command=lambda hass,handler:None)}
        for name in ('ws_get','ws_retention','ws_plan_chart','ws_save','ws_history','ws_reset'):namespace[name]=object()
        exec(compile(ast.Module(body=[setup],type_ignores=[]),str(SOURCE),'exec'),namespace)
        hass=types.SimpleNamespace(data={},http=types.SimpleNamespace(async_register_static_paths=register_paths))
        await namespace['async_setup_entry'](hass,None)
        await namespace['async_setup_entry'](hass,None)
        self.assertEqual([event[0] for event in events],['paths','module','module'])
        self.assertIn('/thermal_pilot/heat-retention-card.js',[path[0] for path in events[0][1]])
        self.assertIn('/thermal_pilot/localization.js',[path[0] for path in events[0][1]])
        self.assertIn('/thermal_pilot/languages',[path[0] for path in events[0][1]])
        self.assertEqual(events[1][1],'/thermal_pilot/heat-retention-card.js?v=test-version')

        self.assertEqual(events[2][1],'/thermal_pilot/plan-chart-card.js?v=test-version')

class PlanChartEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from datetime import datetime, timezone
        tree=ast.parse(SOURCE.read_text());handler=next(item for item in tree.body if isinstance(item,ast.AsyncFunctionDef) and item.name=='ws_plan_chart')
        self.assertFalse(any(isinstance(item,ast.Attribute) and item.attr=='require_admin' for item in handler.decorator_list))
        handler.decorator_list=[];namespace={'PilotCoordinator':Coordinator,'DOMAIN':'thermal_pilot','dt_util':types.SimpleNamespace(utcnow=lambda:datetime(2026,10,15,tzinfo=timezone.utc))}
        exec(compile(ast.Module(body=[handler],type_ignores=[]),str(SOURCE),'exec'),namespace);self.handler=namespace['ws_plan_chart'];self.connection=Connection();self.coordinator=Coordinator()
        self.coordinator.settings.update(house_heat_source='air_to_water',heating_zones=[{'id':'zone','name':'Zone','thermostat':'climate.secret','heating_strategy':'tariff'}])
        self.coordinator.data['zones']={'zone':{'plan':{'commands':[{'time':'zone-later','action':'raise','setpoint':24}],'slots':[{'end':'zone-end'}]}}}
        self.coordinator.data['price_chart']=[{'start':'start','end':'end','price':10,'internal':'secret'}]
        self.coordinator.data['rooms']['room'].update(air_control=True,plan={'commands':[{'time':'later','action':'raise','setpoint':24}],'slots':[{'end':'end','temperature':20}],'reason':'private'})
        self.rows=[{'room_id':'room','time':1,'pump_mode':'heat','temperature':7,'forecast_context':['secret']},{'room_id':'zone:zone','zone_id':'zone','time':1,'zone_mode':'cool'}]
        self.coordinator.history_db=types.SimpleNamespace(read=lambda cutoff:self.rows)
        async def executor(fn,*args):return fn(*args)
        self.hass=types.SimpleNamespace(data={'thermal_pilot':{'one':self.coordinator}},async_add_executor_job=executor)
    async def test_read_only_snapshot_keeps_chart_fields_and_excludes_internal_data(self):
        await self.handler(self.hass,self.connection,{'id':1})
        result=self.connection.result
        self.assertEqual(result['settings']['language'],'fi')
        self.assertNotIn('secret',result['settings']);self.assertNotIn('thermostat',result['settings']['heating_zones'][0])
        self.assertNotIn('model',result['data']['rooms']['room'])
        self.assertEqual(result['data']['rooms']['room']['plan'],{'commands':[{'time':'later','action':'raise'}],'slots':[{'end':'end'}]})
        self.assertEqual(result['data']['zones']['zone']['plan']['commands'],[{'time':'zone-later','action':'raise'}])
        self.assertEqual(result['history'][0],{'room_id':'room','time':1,'pump_mode':'heat'})
        self.assertEqual(result['history'][1]['zone_mode'],'cool')
        self.assertNotIn('internal',result['data']['price_chart'][0])
    async def test_multiple_integrations_and_unloaded_selection(self):
        self.hass.data['thermal_pilot']['two']=Coordinator('Other')
        await self.handler(self.hass,self.connection,{'id':1})
        self.assertTrue(self.connection.result['requires_selection'])
        await self.handler(self.hass,self.connection,{'id':1,'entry_id':'missing'})
        self.assertEqual(self.connection.error[1],'not_loaded')
