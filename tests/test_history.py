import sys, types, tempfile, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]/'custom_components/thermal_pilot'
pkg=types.ModuleType('thermal_pilot');pkg.__path__=[str(ROOT)];sys.modules.setdefault('thermal_pilot',pkg)
from thermal_pilot.history import HistoryDatabase
from thermal_pilot.model import collection_state, initial_model
from thermal_pilot.const import DEFAULTS as BASE_DEFAULTS,ROOM_DEFAULTS
DEFAULTS={**BASE_DEFAULTS,"collection_mode":"automatic"}


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
    def test_warm_start_does_not_collect(self):
        self.assertFalse(collection_state({},18,0,DEFAULTS)['collecting'])
    def test_hysteresis(self):
        s=collection_state({},7,0,DEFAULTS)
        self.assertTrue(s['collecting'])
        s=collection_state(s,10,13*3600,DEFAULTS)
        self.assertTrue(s['collecting'])
        s=collection_state(s,13,26*3600,DEFAULTS)
        self.assertFalse(s['collecting'])
        s=collection_state(s,10,39*3600,DEFAULTS)
        self.assertFalse(s['collecting'])
    def test_brief_warm_spell_does_not_stop(self):
        s=collection_state({},7,0,DEFAULTS)
        s=collection_state(s,18,300,DEFAULTS)
        self.assertTrue(s['collecting'])
    def test_force_and_pause(self):
        self.assertTrue(collection_state({},25,0,{**DEFAULTS,'collection_mode':'always'})['collecting'])
        self.assertFalse(collection_state({},-15,0,{**DEFAULTS,'collection_mode':'paused'})['collecting'])
    def test_manual_mode_collects_in_warm_weather(self):
        self.assertTrue(collection_state({},25,0,{**DEFAULTS,'collection_mode':'manual'})['collecting'])
    def test_missing_outdoor_pauses(self):
        s=collection_state({},-10,0,DEFAULTS)
        self.assertFalse(collection_state(s,None,300,DEFAULTS)['collecting'])
