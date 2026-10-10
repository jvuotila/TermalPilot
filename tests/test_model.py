"""Run with python -m unittest discover -s tests. No HA installation needed."""
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

ROOT=Path(__file__).resolve().parents[1]/'custom_components/thermal_pilot'
pkg=types.ModuleType('thermal_pilot');pkg.__path__=[str(ROOT)];sys.modules.setdefault('thermal_pilot',pkg)
from thermal_pilot.const import DEFAULTS, ROOM_DEFAULTS
from thermal_pilot.model import Slot, price_slots, initial_model, learn, plan
from thermal_pilot.config import validate
UTC=timezone.utc
NOW=datetime(2026,1,2,tzinfo=UTC)


class PriceTests(unittest.TestCase):
    def config(self, **kw):
        return {**DEFAULTS,'prices_include_transfer':True,'margin':0,**kw}
    def test_internal_hourly_average(self):
        prices=[1,2,3,4]*24
        slots=price_slots({'today':prices},self.config(pricing_mode='hourly'),NOW,UTC)
        self.assertEqual(len(slots),24);self.assertEqual(slots[0].price,2.5)
    def test_quarter_prices_and_tariffs(self):
        slots=price_slots({'today':[10]*96},self.config(pricing_mode='flexible',prices_include_transfer=False,margin=.456),NOW,UTC)
        self.assertAlmostEqual(slots[0].price,16.136)
        self.assertAlmostEqual(slots[7*4].price,17.906)
        self.assertAlmostEqual(slots[22*4].price,16.136)
        self.assertEqual(len(slots),96)
    def test_vat_and_euro_conversion(self):
        slots=price_slots({'today':[.1]*96},self.config(price_unit='€/kWh',prices_include_vat=False,vat_percent=25.5),NOW,UTC)
        self.assertAlmostEqual(slots[0].price,12.55)
    def test_missing_tomorrow_does_not_invent_prices(self):
        slots=price_slots({'today':[10]*96},self.config(),NOW+timedelta(hours=23),UTC)
        self.assertEqual(len(slots),4)
    def test_negative_prices(self):
        slots=price_slots({'today':[-10]*96},self.config(),NOW,UTC)
        self.assertEqual(slots[0].price,-10)
    def test_dst_raw_timestamps(self):
        start=datetime(2026,10,24,21,tzinfo=UTC)
        raw=[{'start':(start+timedelta(minutes=i*15)).isoformat(),'end':(start+timedelta(minutes=(i+1)*15)).isoformat(),'value':10} for i in range(100)]
        slots=price_slots({'raw_today':raw},self.config(pricing_mode='hourly'),start,ZoneInfo('Europe/Helsinki'))
        self.assertEqual(len(slots),25)
    def test_dst_list_rejected(self):
        with self.assertRaises(ValueError):
            price_slots({'today':[10]*100},self.config(),datetime(2026,10,24,21,tzinfo=UTC),ZoneInfo('Europe/Helsinki'))
    def test_gap_stops_horizon(self):
        raw=[{'start':NOW.isoformat(),'end':(NOW+timedelta(minutes=15)).isoformat(),'value':10}, {'start':(NOW+timedelta(minutes=30)).isoformat(),'end':(NOW+timedelta(minutes=45)).isoformat(),'value':1}]
        self.assertEqual(len(price_slots({'raw_today':raw},self.config(),NOW,UTC)),1)
    def test_overlap_rejected(self):
        row={'start':NOW.isoformat(),'end':(NOW+timedelta(hours=1)).isoformat(),'value':10}
        with self.assertRaises(ValueError):price_slots({'raw_today':[row,row]},self.config(),NOW,UTC)


class PlannerTests(unittest.TestCase):
    def room(self, **kw):
        return {**ROOM_DEFAULTS,'boost':DEFAULTS['boost'],'setback':DEFAULTS['setback'],'minimum':19,'maximum':23,'minimum_run_minutes':60,'terminal_reserve_hours':2,**kw}
    def slots(self, prices, minutes=60):
        return [Slot(NOW+timedelta(minutes=i*minutes),NOW+timedelta(minutes=(i+1)*minutes),p) for i,p in enumerate(prices)]
    def test_cross_day_gap_requires_bridge_heating(self):
        r=self.room();m=initial_model(r)
        p=plan(r,m,20,[-15]*48,self.slots([1]*4+[9]*15+[50]*4+[9]*21+[1]*4),NOW,20)
        self.assertTrue(any(s['heat'] for s in p['slots'][4:44]))
        self.assertTrue(any(s['heat'] for s in p['slots'][4:19]))
    def test_flexible_minimum_run(self):
        r=self.room(terminal_reserve_hours=0)
        p=plan(r,initial_model(r),20,[-10]*48,self.slots([1,1,1,1,1,50,50,50]*6,15),NOW,20)
        run=0
        for s in p['slots']:
            if s['heat']:run+=1
            elif run:self.assertGreaterEqual(run,4);run=0
        if run:self.assertGreaterEqual(run,4)
    def test_remaining_current_slot(self):
        r=self.room(terminal_reserve_hours=0)
        p=plan(r,initial_model(r),20,[-10]*8,self.slots([2]*8),NOW+timedelta(minutes=45),20)
        self.assertEqual(p['slots'][0]['start'],(NOW+timedelta(minutes=45)).isoformat())
        self.assertEqual(p['known_price_hours'],7.25)
    def test_no_prices_no_plan(self):
        r=self.room();self.assertIsNone(plan(r,initial_model(r),20,[],[],NOW,20))
    def test_learning_requires_real_activity(self):
        r=self.room();m=initial_model(r)
        old={'time':0,'temperature':20,'outdoor':0,'activity':None}
        self.assertIsNone(learn(m,r,old,{**old,'time':900}));self.assertEqual(m['samples'],0)
    def test_gap_excluded_from_learning(self):
        r=self.room();m=initial_model(r)
        old={'time':0,'temperature':20,'outdoor':0,'activity':1}
        self.assertIsNone(learn(m,r,old,{**old,'time':3600}));self.assertEqual(m['samples'],0)
    def test_fireplace_excluded_from_learning(self):
        r=self.room();m=initial_model(r)
        old={'time':0,'temperature':20,'outdoor':0,'activity':1,'excluded':True}
        self.assertIsNotNone(learn(m,r,old,{**old,'time':900}));self.assertEqual(m['samples'],0)
    def test_initial_model_unchanged_without_excitation(self):
        r=self.room();m=initial_model(r);original=m['gain']
        for i in range(20):
            old={'time':i*900,'temperature':20,'outdoor':0,'activity':0}
            learn(m,r,old,{**old,'time':(i+1)*900,'temperature':19.95})
        self.assertEqual(m['gain'],original)


class SettingsTests(unittest.TestCase):
    def test_invalid_bounds(self):
        r={**ROOM_DEFAULTS,'name':'Test','thermostat':'climate.test','temperature_entity':'sensor.test','minimum':22}
        with self.assertRaises(ValueError):validate({**DEFAULTS,'price_entity':'sensor.price','outdoor_entity':'sensor.out','rooms':[r]})
    def test_thermostat_duplicate(self):
        r={**ROOM_DEFAULTS,'name':'Test','thermostat':'climate.test','temperature_entity':'sensor.test'}
        with self.assertRaises(ValueError):validate({**DEFAULTS,'price_entity':'sensor.price','outdoor_entity':'sensor.out','rooms':[r,r]})
    def test_unknown_mode_cannot_enable_control(self):
        result=validate({**DEFAULTS,'price_entity':'sensor.price','outdoor_entity':'sensor.out','control_enabled':True})
        self.assertNotIn('control_enabled',result)
    def test_no_actuator_commands(self):
        import ast
        for path in ROOT.glob('*.py'):
            tree=ast.parse(path.read_text())
            for n in ast.walk(tree):
                if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr=='async_call':
                    self.assertIn((n.args[0].value,n.args[1].value),{('weather','get_forecasts'),('climate','set_temperature')})
                    if n.args[0].value=='climate':
                        method=next(f for f in ast.walk(tree) if isinstance(f,ast.AsyncFunctionDef) and n in list(ast.walk(f)))
                        self.assertEqual(method.name,'apply_season_targets')

if __name__=='__main__':unittest.main()

class FlexibleRunExampleTests(unittest.TestCase):
    def test_can_choose_75_minute_run(self):
        room={**ROOM_DEFAULTS,'boost':DEFAULTS['boost'],'setback':DEFAULTS['setback'],'lag_hours':.5,'minimum_run_minutes':60,'terminal_reserve_hours':3}
        model={**initial_model(room),'gain':1.0,'loss':.02,'base_gain':0}
        slots=[Slot(NOW+timedelta(minutes=i*15),NOW+timedelta(minutes=(i+1)*15),1 if i<5 else 40) for i in range(32)]
        result=plan(room,model,19.1,[-10]*32,slots,NOW,20)
        lengths=[];run=0
        for row in result['slots']:
            if row['heat']:run+=15
            elif run:lengths.append(run);run=0
        if run:lengths.append(run)
        self.assertIn(75,lengths)
