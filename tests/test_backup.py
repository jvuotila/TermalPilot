"""Exercise complete backup round trips and rejection without changing live data."""
import hashlib
from io import BytesIO
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import types
import unittest
from unittest.mock import AsyncMock
import zipfile

ROOT=Path(__file__).resolve().parents[1]/'custom_components/thermal_pilot'
pkg=types.ModuleType('thermal_pilot');pkg.__path__=[str(ROOT)];sys.modules.setdefault('thermal_pilot',pkg)
from thermal_pilot.backup import create_backup, prepare_backup, replace_history, TABLES
from thermal_pilot.history import HistoryDatabase


def state():
    result={key:{} for key in ('models','season','zone_seasons','pump_thermal_modes','pump_reversals','applied_season_targets','fingerprints','sensor_health','managed_rooms','fallback_state')}
    result['models']={'room':{'loss':.003,'gain':.08,'response':.4,'samples':23000}}
    result['season']={'season_id':'2026-2027'}
    return result


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.original=self.root/'original.sqlite3';HistoryDatabase(self.original).initialize()
        with sqlite3.connect(self.original) as db:
            db.execute('INSERT INTO observations VALUES (?,?,?)',('room',12300,'{"temperature":20,"activity":1}'))
            db.execute('INSERT INTO zone_observations VALUES (?,?,?)',('zone',12300,'{"zone_mode":"cool"}'))
            db.execute('INSERT INTO forecasts VALUES (?,?,?,?,?)',('room',12000,3,22800,'{"prediction":20.2}'))
            db.execute('INSERT INTO season_accumulators VALUES (?,?,?)',('2026-2027','room','{"samples":23000}'))
            db.execute('INSERT INTO season_summaries VALUES (?,?,?)',('2025-2026','room','{"season":"2025-2026"}'))
            db.execute('INSERT INTO metadata VALUES (?,?)',('collection_started_at','12300'))
        self.content=create_backup({'rooms':[{'id':'room','name':'Study'}]},state(),str(self.original))
    def tearDown(self):self.temp.cleanup()
    def rewrite(self,mutate):
        with zipfile.ZipFile(BytesIO(self.content)) as archive:
            document=json.loads(archive.read('backup.json'));database=archive.read('history.sqlite3')
        document,database=mutate(document,database)
        output=BytesIO()
        with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('backup.json',json.dumps(document));archive.writestr('history.sqlite3',database)
        return output.getvalue()
    def test_round_trip_preserves_every_table_and_learning_state(self):
        restored=self.root/'restored.sqlite3';document=prepare_backup(self.content,restored)
        self.assertEqual(document['state'],state());self.assertEqual(document['settings']['rooms'][0]['id'],'room')
        with sqlite3.connect(self.original) as original,sqlite3.connect(restored) as target:
            for table in TABLES:self.assertEqual(original.execute(f'SELECT * FROM {table}').fetchall(),target.execute(f'SELECT * FROM {table}').fetchall())
        replace_history(restored,self.original)
    def test_export_includes_committed_wal_rows(self):
        connection=sqlite3.connect(self.original);connection.execute('PRAGMA journal_mode=WAL')
        connection.execute('INSERT INTO observations VALUES (?,?,?)',('room',12600,'{"temperature":21}'));connection.commit()
        content=create_backup({},state(),str(self.original));target=self.root/'wal.sqlite3';prepare_backup(content,target)
        with sqlite3.connect(target) as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM observations').fetchone()[0],2)
        connection.close()
    def test_bad_format_checksum_and_model_are_rejected(self):
        for mutate in [lambda d,b:({**d,'format_version':99},b),lambda d,b:(d,b+b'bad'),lambda d,b:({**d,'state':{}},b),lambda d,b:({**d,'state':{**state(),'models':{'room':{'loss':'invalid'}}}},b)]:
            with self.assertRaises(ValueError):prepare_backup(self.rewrite(mutate),self.root/'invalid.sqlite3')
        with self.assertRaises(ValueError):prepare_backup(b'not a zip',self.root/'invalid.sqlite3')
    def test_unexpected_paths_are_rejected_without_extraction(self):
        output=BytesIO()
        with zipfile.ZipFile(output,'w') as archive:archive.writestr('../escape','bad')
        with self.assertRaises(ValueError):prepare_backup(output.getvalue(),self.root/'invalid.sqlite3')
        self.assertFalse((self.root.parent/'escape').exists())
    def test_triggers_are_rejected_even_with_valid_checksum(self):
        def mutate(document,database):
            path=self.root/'trigger.sqlite3';path.write_bytes(database)
            with sqlite3.connect(path) as db:db.execute('CREATE TRIGGER unsafe AFTER INSERT ON observations BEGIN DELETE FROM forecasts; END')
            db.close()
            database=path.read_bytes();document['history_sha256']=hashlib.sha256(database).hexdigest();return document,database
        with self.assertRaises(ValueError):prepare_backup(self.rewrite(mutate),self.root/'invalid.sqlite3')
    def test_failed_validation_does_not_change_original(self):
        with self.assertRaises(ValueError):prepare_backup(b'bad',self.root/'unused.sqlite3')
        with sqlite3.connect(self.original) as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM observations').fetchone()[0],1)


class RestoreTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from test_coordinator import Hass, PilotCoordinator, DEFAULTS, ROOM_DEFAULTS
        self.temp=tempfile.TemporaryDirectory();self.hass=Hass(self.temp.name)
        room={**ROOM_DEFAULTS,'id':'11111111-1111-4111-8111-111111111111','name':'Study','thermostat':'climate.room','temperature_entity':'sensor.room'}
        entry=types.SimpleNamespace(entry_id='test',data={**DEFAULTS,'price_entity':'sensor.price','outdoor_entity':'sensor.out','rooms':[room]},options={})
        self.c=PilotCoordinator(self.hass,entry);await self.c.load()
        self.c.async_request_refresh=AsyncMock()
        def update(entry,options):entry.options=options
        self.hass.config_entries=types.SimpleNamespace(async_update_entry=update)
    async def asyncTearDown(self):self.temp.cleanup()
    async def test_restore_keeps_room_ids_models_and_forces_simulation(self):
        from thermal_pilot.backup import export_backup,restore_backup
        rid=self.c.settings['rooms'][0]['id'];self.c.models[rid]={'loss':.003,'gain':.08,'samples':123,'response':.7}
        self.c.settings.update(simulation_enabled=False,live_control_confirmed=True,apply_season_setpoints=True)
        content=await export_backup(self.c)
        self.c.models={};self.c.settings['rooms'][0]['name']='Changed'
        result=await restore_backup(self.c,content)
        self.assertTrue(result['restored']);self.assertEqual(self.c.settings['rooms'][0]['name'],'Study')
        self.assertEqual(self.c.models[rid]['samples'],123);self.assertEqual(self.c.models[rid]['response'],0)
        self.assertTrue(self.c.settings['simulation_enabled']);self.assertFalse(self.c.settings['live_control_confirmed']);self.assertFalse(self.c.settings['apply_season_setpoints'])
        self.assertEqual(self.c.managed_rooms,{})
        self.assertEqual(self.c.entry.options,self.c.settings)
    async def test_save_failure_rolls_back_state_and_history(self):
        from thermal_pilot.backup import export_backup,restore_backup
        content=await export_backup(self.c);self.c.models={'current':{'loss':.004,'samples':9}}
        save=self.c.store.async_save;count=0
        async def fail_once(data):
            nonlocal count
            count+=1
            if count==1:raise OSError('disk full')
            await save(data)
        self.c.store.async_save=fail_once
        with self.assertRaises(OSError):await restore_backup(self.c,content)
        self.assertEqual(self.c.models['current']['samples'],9)

class BackupEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        import ast
        source=ROOT/'backup_http.py';tree=ast.parse(source.read_text());view=next(n for n in tree.body if isinstance(n,ast.ClassDef))
        class Forbidden(Exception):pass
        class NotFound(Exception):pass
        fake_web=types.SimpleNamespace(HTTPForbidden=Forbidden,HTTPNotFound=NotFound,json_response=lambda body,**kw:(body,kw))
        namespace={'HomeAssistantView':object,'web':fake_web,'DOMAIN':'thermal_pilot','MAX_ARCHIVE_BYTES':8,'restore_backup':AsyncMock(return_value={'restored':True})}
        exec(compile(ast.Module(body=[view],type_ignores=[]),str(source),'exec'),namespace)
        self.hass=types.SimpleNamespace(data={'thermal_pilot':{'entry':object()}});self.view=namespace['BackupView'](self.hass);self.namespace=namespace;self.Forbidden=Forbidden
    async def test_administrator_required_for_export_and_import(self):
        request={'hass_user':types.SimpleNamespace(is_admin=False)}
        self.assertTrue(self.view.requires_auth)
        for method in (self.view.get,self.view.post):
            with self.assertRaises(self.Forbidden):await method(request,'entry')
        self.namespace['restore_backup'].assert_not_awaited()
    async def test_explicit_confirmation_and_upload_size_limit(self):
        class Request(dict):
            headers={}
        request=Request(hass_user=types.SimpleNamespace(is_admin=True))
        result=await self.view.post(request,'entry');self.assertEqual(result[1]['status'],400)
        request.headers={'X-ThermalPilot-Confirm':'replace'}
        async def chunks(size):yield b'123456789'
        request.content=types.SimpleNamespace(iter_chunked=chunks)
        result=await self.view.post(request,'entry');self.assertEqual(result[1]['status'],413)
        self.namespace['restore_backup'].assert_not_awaited()
