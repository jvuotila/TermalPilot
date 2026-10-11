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
from thermal_pilot.model import Slot, price_slots, initial_model, learn, learning_progress, plan
from thermal_pilot.config import validate, stored_settings
UTC=timezone.utc
NOW=datetime(2026,1,2,tzinfo=UTC)


class PriceTests(unittest.TestCase):
    def config(self, **kw):
        return {**DEFAULTS,**kw}
    def test_internal_hourly_average(self):
        prices=[1,2,3,4]*24
        slots=price_slots({'today':prices},self.config(pricing_mode='hourly'),NOW,UTC)
        self.assertEqual(len(slots),24);self.assertEqual(slots[0].price,2.5)
    def test_hourly_lists_detected_without_setting(self):
        for legacy in ('hourly', 'quarterly'):
            slots=price_slots({'today':list(range(24))},self.config(price_format=legacy),NOW,UTC)
            self.assertEqual(len(slots),96)
            self.assertEqual([slot.price for slot in slots[:5]],[0,0,0,0,1])
    def test_resolution_detected_independently_for_each_day(self):
        slots=price_slots({'today':[10]*24,'tomorrow':[20]*96},self.config(),NOW,UTC)
        self.assertEqual(len(slots),192)
        self.assertEqual(slots[95].price,10);self.assertEqual(slots[96].price,20)
    def test_incomplete_or_unsupported_lists_rejected(self):
        for count in (23,25,48,94,95,97):
            with self.subTest(count=count),self.assertRaisesRegex(ValueError,'24 hourly or 96 quarter-hour'):
                price_slots({'today':[10]*count},self.config(),NOW,UTC)
    def test_timestamped_prices_preferred_over_plain_list(self):
        raw=[{'start':NOW.isoformat(),'end':(NOW+timedelta(hours=1)).isoformat(),'value':7}]
        slots=price_slots({'raw_today':raw,'today':[100]*94},self.config(),NOW,UTC)
        self.assertEqual(len(slots),4);self.assertEqual(slots[0].price,7)
    def test_final_quarter_prices_are_not_marked_up(self):
        slots=price_slots({'today':[10]*96},self.config(pricing_mode='flexible',prices_include_transfer=False,margin=.456),NOW,UTC)
        self.assertAlmostEqual(slots[0].price,10)
        self.assertAlmostEqual(slots[7*4].price,10)
        self.assertAlmostEqual(slots[22*4].price,10)
        self.assertEqual(len(slots),96)
    def test_final_euro_conversion_without_added_vat(self):
        slots=price_slots({'today':[.1]*96},self.config(price_unit='€/kWh',prices_include_vat=False,vat_percent=25.5),NOW,UTC)
        self.assertAlmostEqual(slots[0].price,10)
    def test_missing_tomorrow_does_not_invent_prices(self):
        slots=price_slots({'today':[10]*96},self.config(),NOW+timedelta(hours=23),UTC)
        self.assertEqual(len(slots),4)
    def test_all_available_prices_ignore_legacy_horizon(self):
        slots=price_slots({'today':[10]*96,'tomorrow':[20]*96},self.config(horizon_hours=6),NOW,UTC)
        self.assertEqual(len(slots),192)
        self.assertEqual(slots[-1].end,NOW+timedelta(days=2))
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
    def test_started_session_survives_replanning_and_keeps_original_offsets(self):
        start=NOW+timedelta(minutes=15);end=start+timedelta(hours=1)
        r=self.room(committed_session={'start':start.isoformat(),'end':end.isoformat()})
        m=initial_model(r)
        prices=self.slots([100]*12,15)
        # High room temperature and high prices would normally choose no boost.
        for minute in (10,15,20,35,60,65,70):
            current=NOW+timedelta(minutes=minute)
            remaining=[slot for slot in prices if slot.end>current]
            current_room={**r,'previous_suggested_heat':current>=start,'previous_run_hours':max(0,(current-start).total_seconds()/3600)}
            p=plan(current_room,m,22,[5]*len(remaining),remaining,current,20)
            self.assertEqual(p['sessions'][0]['start'],start.isoformat())
            self.assertGreaterEqual(datetime.fromisoformat(p['sessions'][0]['end']),end)
            self.assertEqual(p['commands'][0]['time'],(start-timedelta(minutes=5)).isoformat())
            window=p['thermostat_windows'][0]
            self.assertGreaterEqual((datetime.fromisoformat(window['end'])-datetime.fromisoformat(window['start'])).total_seconds(),55*60)
            for slot in p['slots']:
                if datetime.fromisoformat(slot['start'])<end and datetime.fromisoformat(slot['end'])>start:
                    self.assertTrue(slot['heat'])

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
    def test_negative_idle_adjustment_and_legacy_conversion(self):
        original={'setback':1.5}
        converted=stored_settings(original,{})
        self.assertEqual(converted['setback'],-1.5)
        self.assertEqual(original['setback'],1.5)
        self.assertEqual(stored_settings(converted,{})['setback'],-1.5)
        for value in (-5,-1.5,0):
            self.assertEqual(validate({**DEFAULTS,'price_entity':'sensor.price','outdoor_entity':'sensor.out','water_entity':'sensor.water','setback':value})['setback'],value)
        for value in (-5.1,1):
            with self.assertRaises(ValueError):
                validate({**DEFAULTS,'price_entity':'sensor.price','outdoor_entity':'sensor.out','water_entity':'sensor.water','setback':value})
    def test_fireplace_compensation_range(self):
        room={**ROOM_DEFAULTS,'name':'Test','thermostat':'climate.test','temperature_entity':'sensor.test'}
        for value in (-100,-20,0):
            result=validate({**DEFAULTS,'price_entity':'sensor.price','outdoor_entity':'sensor.out','water_entity':'sensor.water','rooms':[{**room,'fireplace_reduction':value}]})
            self.assertEqual(result['rooms'][0]['fireplace_reduction'],value)
        for value in (-101,1):
            with self.assertRaises(ValueError):
                validate({**DEFAULTS,'price_entity':'sensor.price','outdoor_entity':'sensor.out','water_entity':'sensor.water','rooms':[{**room,'fireplace_reduction':value}]})

    def test_legacy_fireplace_compensation_preserves_effect(self):
        original={'rooms':[{**ROOM_DEFAULTS,'fireplace_reduction':20}]}
        converted=stored_settings(original,{})
        self.assertEqual(converted['rooms'][0]['fireplace_reduction'],-20)
        self.assertEqual(original['rooms'][0]['fireplace_reduction'],20)
        self.assertEqual(stored_settings(converted,{})['rooms'][0]['fireplace_reduction'],-20)

    def test_invalid_bounds(self):
        r={**ROOM_DEFAULTS,'name':'Test','thermostat':'climate.test','temperature_entity':'sensor.test'}
        with self.assertRaises(ValueError):validate({**DEFAULTS,'minimum':22,'price_entity':'sensor.price','outdoor_entity':'sensor.out','water_entity':'sensor.water','rooms':[r]})
    def test_thermostat_duplicate(self):
        r={**ROOM_DEFAULTS,'name':'Test','thermostat':'climate.test','temperature_entity':'sensor.test'}
        with self.assertRaises(ValueError):validate({**DEFAULTS,'price_entity':'sensor.price','outdoor_entity':'sensor.out','water_entity':'sensor.water','rooms':[r,r]})
    def test_unknown_mode_cannot_enable_control(self):
        result=validate({**DEFAULTS,'price_entity':'sensor.price','outdoor_entity':'sensor.out','water_entity':'sensor.water','control_enabled':True})
        self.assertNotIn('control_enabled',result)
    def test_no_actuator_commands(self):
        import ast
        for path in ROOT.glob('*.py'):
            tree=ast.parse(path.read_text())
            for n in ast.walk(tree):
                if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr=='async_call':
                    self.assertIn((n.args[0].value,n.args[1].value),{('weather','get_forecasts'),('climate','set_temperature'),('persistent_notification','create')})
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


class LearningProgressTests(unittest.TestCase):
    def test_initial_percent_requires_both_states(self):
        p=learning_progress({'heated_hours':24,'idle_hours':0},NOW)
        self.assertEqual(p['percent'],50);self.assertFalse(p['initial_complete'])
        self.assertIsNone(p['estimated_days_to_initial'])
        p=learning_progress({'heated_hours':12,'idle_hours':12},NOW)
        self.assertEqual(p['percent'],100);self.assertTrue(p['initial_complete'])
        self.assertEqual(p['estimated_days_to_initial'],0)
    def test_eta_uses_wall_time_and_requires_full_day(self):
        model={'heated_hours':4,'idle_hours':12,'learning_rate_since':NOW.timestamp()-86400,
               'learning_rates':[{'time':NOW.timestamp()-3600,'heat':4,'idle':12}]}
        self.assertEqual(learning_progress(model,NOW)['estimated_days_to_initial'],2)
        model['learning_rate_since']=NOW.timestamp()-23*3600
        self.assertIsNone(learning_progress(model,NOW)['estimated_days_to_initial'])
    def test_missing_heating_rate_does_not_invent_eta(self):
        model={'heated_hours':0,'idle_hours':24,'learning_rate_since':NOW.timestamp()-86400,
               'learning_rates':[{'time':NOW.timestamp()-3600,'heat':0,'idle':24}]}
        self.assertIsNone(learning_progress(model,NOW)['estimated_days_to_initial'])
    def test_rate_tracking_is_bounded_and_exclusions_do_not_count(self):
        room={**ROOM_DEFAULTS,**DEFAULTS,'baseline':20}
        model=initial_model(room)
        model['learning_rates']=[{'time':NOW.timestamp()-8*86400,'heat':10,'idle':10}]
        old={'time':NOW.timestamp(),'temperature':20,'outdoor':0,'activity':1}
        learn(model,room,old,{**old,'time':NOW.timestamp()+900,'temperature':20.01})
        self.assertEqual(len(model['learning_rates']),1)
        self.assertEqual(model['learning_rates'][0]['heat'],.25)
        learn(model,room,{**old,'excluded':True},{**old,'time':NOW.timestamp()+900})
        self.assertEqual(model['learning_rates'][0]['heat'],.25)
