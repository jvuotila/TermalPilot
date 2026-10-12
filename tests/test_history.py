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
    def test_collection_start_survives_retention_and_migrates(self):
        self.assertIsNone(self.db.size()['started_at'])
        self.db.append([self.row(900),self.row(1200)],0,'2026-2027')
        self.db.append([],2000,'2026-2027')
        self.assertEqual(self.db.size()['started_at'],900)
        with self.db._connect() as con:
            con.execute("DELETE FROM metadata WHERE key='collection_started_at'")
        self.db.initialize()
        self.assertEqual(self.db.size()['started_at'],900)
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

    def forecast_room(self, temperature=20, demand=True):
        from datetime import datetime,timezone
        slots=[{'start':datetime.fromtimestamp(i*900,timezone.utc).isoformat(),
                'end':datetime.fromtimestamp((i+1)*900,timezone.utc).isoformat(),
                'temperature':temperature+(i+1)/24,'predicted_demand':demand} for i in range(24)]
        return {'test':{'temperature':temperature,'forecast_context':['sensor.room'], 'plan':{'slots':slots}}}

    def observed_forecast_rows(self, end=21600, activity=1):
        return [{**self.row(t),'forecast_context':['sensor.room'],'temperature':22,'activity':activity} for t in range(0,end+1,300)]

    def test_hourly_forecasts_freeze_original_values_and_survive_restart(self):
        self.db.record_forecasts(self.forecast_room(),0,-1)
        self.db.record_forecasts(self.forecast_room(99),100,-1)
        # Forecasts must survive restarting the integration/database object.
        restarted=HistoryDatabase(self.db.path);restarted.initialize()
        restarted.append(self.observed_forecast_rows(),-1)
        rows=restarted.read(0)
        due={r['time']:r for r in rows}
        for h in (1,3,6):
            self.assertAlmostEqual(due[h*3600][f'forecast_{h}h'],20+h/6)
            detail=due[h*3600][f'forecast_{h}h_details']
            self.assertEqual(detail['issued'],0)
            self.assertEqual(detail['persistence_error'],2)
            self.assertEqual(detail['heating_match'],1)
        stat=restarted.forecast_accuracy(0)['test']['3']
        self.assertEqual(stat['count'],1);self.assertAlmostEqual(stat['mae'],1.5)
        self.assertEqual(stat['persistence_mae'],2)

    def test_forecasts_do_not_fill_missing_future_measurements(self):
        self.db.record_forecasts(self.forecast_room(),0,-1)
        self.db.append(self.observed_forecast_rows(end=1800),-1)
        self.assertFalse(any('forecast_1h' in r for r in self.db.read(0)))
        self.db.append(self.observed_forecast_rows(end=21600)[-1:],-1)
        matched=self.db.read(0)[-1]
        self.assertIn('forecast_6h',matched)
        self.assertIsNone(matched['forecast_6h_details']['heating_match'])

    def test_different_actual_heating_is_reported_and_context_changes_are_excluded(self):
        self.db.record_forecasts(self.forecast_room(demand=True),0,-1)
        self.db.append(self.observed_forecast_rows(activity=0),-1)
        matched=next(r for r in self.db.read(0) if r['time']==10800)
        self.assertEqual(matched['forecast_3h_details']['heating_match'],0)
        self.assertEqual(self.db.forecast_accuracy(0)['test']['3']['similar_heating_count'],0)
        self.db.append([{**matched,'forecast_context':['sensor.other']}],-1)
        # Stored observations never contain evaluated fields; real append payloads use raw readings.
        with self.db._connect() as con:
            import json
            raw={**self.row(10800),'forecast_context':['sensor.other']}
            con.execute('UPDATE observations SET payload=? WHERE time=10800',(json.dumps(raw),))
        self.assertNotIn('forecast_3h',next(r for r in self.db.read(0) if r['time']==10800))

    def test_short_price_horizon_does_not_invent_three_or_six_hour_forecasts(self):
        rooms=self.forecast_room();rooms['test']['plan']['slots']=rooms['test']['plan']['slots'][:4]
        self.db.record_forecasts(rooms,0,-1)
        with self.db._connect() as con:
            self.assertEqual([r[0] for r in con.execute('SELECT horizon FROM forecasts')],[1])


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
