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
        for name in ('ws_get','ws_retention','ws_save','ws_history','ws_reset'):namespace[name]=object()
        exec(compile(ast.Module(body=[setup],type_ignores=[]),str(SOURCE),'exec'),namespace)
        hass=types.SimpleNamespace(data={},http=types.SimpleNamespace(async_register_static_paths=register_paths))
        await namespace['async_setup_entry'](hass,None)
        await namespace['async_setup_entry'](hass,None)
        self.assertEqual([event[0] for event in events],['paths','module'])
        self.assertIn('/thermal_pilot/heat-retention-card.js',[path[0] for path in events[0][1]])
        self.assertEqual(events[1][1],'/thermal_pilot/heat-retention-card.js?v=test-version')
