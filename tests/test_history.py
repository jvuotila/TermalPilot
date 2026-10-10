import sys, types, tempfile, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]/'custom_components/thermal_pilot'
pkg=types.ModuleType('thermal_pilot');pkg.__path__=[str(ROOT)];sys.modules.setdefault('thermal_pilot',pkg)
from thermal_pilot.history import HistoryDatabase
from thermal_pilot.model import collection_state, initial_model
from thermal_pilot.const import DEFAULTS as BASE_DEFAULTS,ROOM_DEFAULTS
DEFAULTS=BASE_DEFAULTS


class HistoryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.db=HistoryDatabase(Path(self.temp.name)/'history.sqlite3');self.db.initialize()
    def tearDown(self):self.temp.cleanup()
    def row(self,time=900):
        return {'room_id':'test','time':time,'temperature':20,'outdoor':-10,'activity':1,'prediction':20.1}
    def test_five_minute_deduplication(self):
        self.db.append([self.row(),self.row(901)],0,'2026-2027')
        self.assertEqual(self.db.size()['rows'],1)
        self.assertEqual(self.db.read(0)[0]['time'],901)
    def test_retention(self):
        self.db.append([self.row(0),self.row(3600)],3000,'2026-2027')
        self.assertEqual(self.db.size()['rows'],1)
    def test_compaction_preserves_full_season_and_model(self):
        self.db.append([self.row(0),self.row(900)],-1,'2026-2027')
        self.db.append([self.row(3600)],3000,'2026-2027')
        model=initial_model(ROOM_DEFAULTS)
        self.db.compact_season('2026-2027',{'test':model},{'test':['sensor.room']},4000)
        self.assertEqual(self.db.size()['rows'],0)
        archive=self.db.summaries()[0]
        self.assertEqual(archive['statistics']['samples'],3)
        self.assertEqual(archive['model']['gain'],model['gain'])
        self.assertEqual(archive['mapping_fingerprint'],['sensor.room'])
    def test_compaction_is_idempotent(self):
        self.db.append([self.row()],0,'2026-2027')
        for _ in range(2):self.db.compact_season('2026-2027',{'test':initial_model(ROOM_DEFAULTS)},{},0)
        self.assertEqual(len(self.db.summaries()),1)


class SeasonTests(unittest.TestCase):
    def test_active_collects_in_warm_weather(self):
        self.assertTrue(collection_state({},25,0,DEFAULTS)['collecting'])
    def test_passive_does_not_collect_in_cold_weather(self):
        self.assertFalse(collection_state({},-20,0,{**DEFAULTS,'heating_enabled':False})['collecting'])
    def test_weather_does_not_change_manual_activity(self):
        s=collection_state({},-10,0,DEFAULTS)
        s=collection_state(s,25,300,DEFAULTS)
        self.assertTrue(s['collecting'])
    def test_legacy_pause_mode_is_ignored(self):
        self.assertTrue(collection_state({},10,0,{**DEFAULTS,'collection_mode':'paused'})['collecting'])
    def test_missing_outdoor_pauses(self):
        self.assertFalse(collection_state({},None,0,DEFAULTS)['collecting'])
    def test_legacy_average_is_removed(self):
        self.assertNotIn('average',collection_state({'average':10},5,0,DEFAULTS))
