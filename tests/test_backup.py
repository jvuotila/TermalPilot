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
        from thermal_pilot.const import DEFAULTS, ROOM_DEFAULTS
        self.settings={**DEFAULTS,'price_entity':'sensor.price','outdoor_entity':'sensor.out','rooms':[{**ROOM_DEFAULTS,'id':'11111111-1111-4111-8111-111111111111','name':'Study','thermostat':'climate.room','temperature_entity':'sensor.room'}]}
        self.content=create_backup(self.settings,state(),str(self.original))
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
        self.assertEqual(document['state'],state());self.assertEqual(document['settings']['rooms'][0]['id'],self.settings['rooms'][0]['id'])
        with sqlite3.connect(self.original) as original,sqlite3.connect(restored) as target:
            for table in TABLES:self.assertEqual(original.execute(f'SELECT * FROM {table}').fetchall(),target.execute(f'SELECT * FROM {table}').fetchall())
        replace_history(restored,self.original)
    def test_export_includes_committed_wal_rows(self):
        connection=sqlite3.connect(self.original);connection.execute('PRAGMA journal_mode=WAL')
        connection.execute('INSERT INTO observations VALUES (?,?,?)',('room',12600,'{"temperature":21}'));connection.commit()
        content=create_backup(self.settings,state(),str(self.original));target=self.root/'wal.sqlite3';prepare_backup(content,target)
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

    async def test_complete_restore_of_frozen_released_archive_preserves_room_zone_learning(self):
        import base64
        from thermal_pilot.backup import restore_backup
        fixture=json.loads((Path(__file__).parent/'fixtures/backup-v0.9.33.json').read_text())
        await restore_backup(self.c,base64.b64decode(fixture['archive_base64']))
        self.assertEqual([room['id'] for room in self.c.settings['rooms']],fixture['room_ids'])
        self.assertEqual(self.c.settings['rooms'][0]['heating_zone_id'],fixture['zone_id'])
        self.assertEqual(self.c.settings['heating_zones'][0]['main_room_id'],fixture['room_ids'][0])
        self.assertEqual(self.c.models[fixture['room_ids'][0]]['samples'],23000)
        self.assertEqual(self.c.learning_changes(self.c.settings),[])
        with sqlite3.connect(self.c.history_db.path) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM observations').fetchone()[0],2)
            self.assertEqual(db.execute('SELECT zone_id FROM zone_observations').fetchone()[0],fixture['zone_id'])


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

class BackupCompatibilityTests(unittest.TestCase):
    """A released archive is immutable evidence, not generated by today's writer."""
    def setUp(self):
        import base64
        self.fixture=json.loads((Path(__file__).parent/'fixtures/backup-v0.9.33.json').read_text())
        self.archive=base64.b64decode(self.fixture['archive_base64'])
        self.assertEqual(hashlib.sha256(self.archive).hexdigest(),self.fixture['sha256'])
        with zipfile.ZipFile(BytesIO(self.archive)) as archive:self.legacy=json.loads(archive.read('backup.json'))
        self.assertNotIn('settings_version',self.legacy)
    def test_frozen_0933_backup_keeps_settings_room_zone_links_and_all_history(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'restored.sqlite3';document=prepare_backup(self.archive,path)
            settings=document['settings'];room_ids=self.fixture['room_ids'];zone_id=self.fixture['zone_id']
            self.assertEqual([room['id'] for room in settings['rooms']],room_ids)
            self.assertEqual(settings['rooms'][0]['heating_zone_id'],zone_id)
            self.assertEqual(settings['heating_zones'][0]['main_room_id'],room_ids[0])
            self.assertEqual(settings['heating_zones'][0]['id'],zone_id)
            self.assertEqual(settings['house_heat_source'],self.legacy['settings']['house_heat_source'])
            self.assertEqual(document['state']['models'][room_ids[0]]['samples'],23000)
            self.assertEqual(document['state']['models'][room_ids[0]]['loss'],.0031)
            self.assertEqual(document['state']['fingerprints'],self.legacy['state']['fingerprints'])
            with sqlite3.connect(path) as db:
                for table,count in [('observations',2),('zone_observations',1),('forecasts',1),('season_accumulators',1),('season_summaries',1)]:
                    self.assertEqual(db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0],count)
                self.assertEqual(db.execute('SELECT zone_id FROM zone_observations').fetchone()[0],zone_id)
    def test_missing_optional_fields_and_learning_sections_get_safe_defaults(self):
        from thermal_pilot.backup_migrations import migrate_document
        old=json.loads(json.dumps(self.legacy))
        for key in ('wind_entity','water_entity','apply_season_setpoints'):old['settings'].pop(key,None)
        for room in old['settings']['rooms']:room.pop('garage_door_entities',None)
        old['state'].pop('pump_reversals');old['state'].pop('sensor_health')
        document=migrate_document(old)
        self.assertEqual(document['settings']['wind_entity'],'');self.assertEqual(document['settings']['water_entity'],'')
        self.assertFalse(document['settings']['apply_season_setpoints'])
        self.assertEqual(document['state']['pump_reversals'],{});self.assertEqual(document['state']['sensor_health'],{})
        rid=self.fixture['room_ids'][0]
        self.assertEqual(document['state']['models'][rid]['loss'],self.legacy['state']['models'][rid]['loss'])
    def test_future_added_device_control_and_numeric_setting_defaults(self):
        from unittest.mock import patch
        from thermal_pilot import backup_migrations as migrations,config
        fields=[('future_sensor','Future sensor','sensor'),('future_control','Future control','bool'),('future_limit','Future limit','number',1,20)]
        original=len(config.SOURCE_FIELDS)
        try:
            config.SOURCE_FIELDS.extend(fields)
            with patch.dict(config.DEFAULTS,{'future_sensor':'sensor.unexpected','future_control':True,'future_limit':7}):
                result=migrations.migrate_document(self.legacy)['settings']
                self.assertEqual(result['future_sensor'],'');self.assertFalse(result['future_control']);self.assertEqual(result['future_limit'],7)
        finally:del config.SOURCE_FIELDS[original:]
    def test_migration_chain_handles_renamed_setting_without_losing_identity(self):
        from unittest.mock import patch
        from thermal_pilot import backup_migrations as migrations
        old=json.loads(json.dumps(self.legacy));old['settings']['old_wind_sensor']=old['settings'].pop('wind_entity')
        def rename(value):value['wind_entity']=value.pop('old_wind_sensor');return value
        with patch.object(migrations,'SETTINGS_VERSION',2),patch.dict(migrations.SETTINGS_MIGRATIONS,{1:rename}):
            document=migrations.migrate_document(old)
        self.assertEqual(document['settings_version'],2);self.assertNotIn('old_wind_sensor',document['settings'])
        self.assertEqual(document['settings']['rooms'][0]['id'],self.fixture['room_ids'][0])
    def test_missing_room_ids_and_broken_links_never_create_replacement_ids(self):
        from thermal_pilot.backup_migrations import migrate_document
        for change in ('room_id','zone_id','main_room','membership'):
            old=json.loads(json.dumps(self.legacy))
            if change=='room_id':old['settings']['rooms'][0].pop('id')
            elif change=='zone_id':old['settings']['heating_zones'][0].pop('id')
            elif change=='main_room':old['settings']['heating_zones'][0]['main_room_id']=self.fixture['room_ids'][1]
            else:old['settings']['rooms'][0]['heating_zone_id']='44444444-4444-4444-8444-444444444444'
            with self.assertRaises(ValueError):migrate_document(old)
    def test_release_number_is_not_schema_version_and_unknown_newer_schema_is_rejected(self):
        from thermal_pilot.backup_migrations import migrate_document
        old=json.loads(json.dumps(self.legacy));old['integration_version']='99.0.0'
        self.assertEqual(migrate_document(old)['settings_version'],1)
        for key in ('settings_version','learning_version','history_version'):
            with self.assertRaises(ValueError):migrate_document({**old,key:999})
    def test_history_migration_adds_schema_data_and_keeps_old_rows(self):
        from unittest.mock import patch
        from thermal_pilot import backup_migrations as migrations
        with sqlite3.connect(':memory:') as db:
            db.execute('CREATE TABLE metadata (key TEXT PRIMARY KEY,value TEXT)');db.execute("INSERT INTO metadata VALUES ('schema_version','1')")
            db.execute('CREATE TABLE observations (room_id TEXT,time INTEGER,payload TEXT)');db.execute("INSERT INTO observations VALUES ('preserved',1,'{}')")
            def upgrade(connection):connection.execute('ALTER TABLE observations ADD COLUMN new_metric REAL DEFAULT NULL')
            with patch.object(migrations,'HISTORY_VERSION',2),patch.dict(migrations.HISTORY_MIGRATIONS,{1:upgrade}):migrations.migrate_history(db,1)
            self.assertEqual(db.execute('SELECT room_id,new_metric FROM observations').fetchone(),('preserved',None))
            self.assertEqual(db.execute("SELECT value FROM metadata WHERE key='schema_version'").fetchone()[0],'2')
