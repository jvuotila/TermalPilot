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
                        self.assertIn((path.name,method.name),{('coordinator.py','apply_season_targets'),('control.py','apply')})

if __name__=='__main__':unittest.main()

class FlexibleRunExampleTests(unittest.TestCase):
    def test_can_choose_75_minute_run(self):
        room={**ROOM_DEFAULTS,'boost':DEFAULTS['boost'],'setback':DEFAULTS['setback'],'lag_hours':.5,'minimum_run_minutes':60,'terminal_reserve_hours':3}
        model={**initial_model(room),'gain':1.0,'loss':.02,'base_gain':0}
        slots=[Slot(NOW+timedelta(minutes=i*15),NOW+timedelta(minutes=(i+1)*15),1 if i<5 else 40) for i in range(32)]
        result=plan(room,model,20.2,[-10]*32,slots,NOW,20)
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
        self.assertEqual(learning_progress(model,NOW)['estimated_initial_completion'],(NOW+timedelta(days=2)).isoformat())
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

class PriceForecastTests(unittest.TestCase):
    def forecast(self, values):
        return {'forecast':[{'timestamp':(NOW+timedelta(hours=i)).timestamp()*1000,'value':v} for i,v in enumerate(values)]}
    def test_expensive_outlook_increases_reserve_without_mixing_price_units(self):
        from thermal_pilot.model import price_forecast_reserve
        for values in ([40]*6+[5]*18,[140]*6+[105]*18,[.4]*6+[.05]*18):
            result=price_forecast_reserve(self.forecast(values),NOW)
            self.assertTrue(result['available']);self.assertEqual(result['reserve_hours'],12)
    def test_cheap_or_flat_outlook_preserves_normal_comfort_reserve(self):
        from thermal_pilot.model import price_forecast_reserve
        for values in ([5]*6+[40]*18,[5]*24):
            self.assertEqual(price_forecast_reserve(self.forecast(values),NOW)['reserve_hours'],6)
    def test_stale_gapped_invalid_and_short_forecasts_do_not_replace_confirmed_prices(self):
        from thermal_pilot.model import price_forecast_reserve
        invalid=self.forecast([10]*24);invalid['forecast'][10]['timestamp']='invalid'
        stale=self.forecast([10]*24)
        for attrs,end in [({},NOW),(self.forecast([10]*5),NOW),(invalid,NOW),(stale,NOW+timedelta(days=2))]:
            result=price_forecast_reserve(attrs,end)
            self.assertFalse(result['available']);self.assertEqual(result['reserve_hours'],6)

class PlannerExplanationTests(unittest.TestCase):
    def test_idle_plan_reports_forecast_floor_and_later_sessions_are_not_hidden(self):
        room={**DEFAULTS,**ROOM_DEFAULTS,'baseline':20,'minimum':19}
        slots=[Slot(NOW+timedelta(minutes=i*15),NOW+timedelta(minutes=(i+1)*15),20) for i in range(128)]
        result=plan(room,initial_model(room),21.4,[4]*128,slots,NOW,20)
        self.assertEqual(result['suggested_heating_hours'],0)
        self.assertEqual(result['comfort_floor'],19)
        self.assertEqual(result['forecast_minimum'],min(row['temperature'] for row in result['slots']))
        self.assertIn('lowest forecast',result['reason'])
        self.assertNotIn('stored heat is sufficient',result['reason'])
        result=plan({**room,'minimum':19.5},initial_model(room),20.2,[4]*128,slots,NOW,20)
        self.assertGreater(result['suggested_heating_hours'],0)
        if not result['scheduled_heat']:self.assertIn('planned later',result['reason'])


class RoomComfortGoalTests(unittest.TestCase):
    def prices(self, price=20):
        return [Slot(NOW+timedelta(minutes=i*15),NOW+timedelta(minutes=(i+1)*15),price) for i in range(128)]
    def test_room_target_requires_heating_before_the_global_minimum(self):
        room={**DEFAULTS,**ROOM_DEFAULTS,'baseline':20,'minimum':19}
        result=plan(room,initial_model(room),20.2,[4]*128,self.prices(),NOW,20)
        self.assertGreater(result['suggested_heating_hours'],0)
        self.assertGreaterEqual(result['forecast_minimum'],19.99)
        self.assertEqual(result['comfort_target'],20)
        self.assertEqual(result['comfort_floor'],19)
        lower={**room,'baseline':19}
        result=plan(lower,initial_model(lower),20.2,[4]*128,self.prices(),NOW,19)
        self.assertLess(result['suggested_heating_hours'],2.75)
    def test_expensive_prices_do_not_turn_idle_setpoint_into_comfort_goal(self):
        room={**DEFAULTS,**ROOM_DEFAULTS,'baseline':20,'minimum':19,'setback':-2}
        result=plan(room,initial_model(room),20.2,[4]*128,self.prices(1000),NOW,20)
        self.assertGreater(result['suggested_heating_hours'],0)
        self.assertGreaterEqual(result['forecast_minimum'],19.99)
        self.assertEqual(result['reduced_setpoint'],19)
    def test_minimum_limit_overrides_price_when_room_is_already_cold(self):
        room={**DEFAULTS,**ROOM_DEFAULTS,'baseline':20,'minimum':19}
        result=plan(room,initial_model(room),18.8,[-10]*128,self.prices(1000),NOW,20)
        self.assertTrue(result['scheduled_heat'])
        self.assertEqual(result['setpoint'],21.5)

class ThreeStatePlanningTests(unittest.TestCase):
    def run_plan(self, temperature, previous='normal', prices=None):
        room={**DEFAULTS,**ROOM_DEFAULTS,'baseline':20,'previous_control_mode':previous,'previous_suggested_heat':previous=='boost','previous_run_hours':1,'terminal_reserve_hours':0}
        prices=prices or [40]*8+[5]*8
        slots=[Slot(NOW+timedelta(minutes=i*15),NOW+timedelta(minutes=(i+1)*15),p) for i,p in enumerate(prices)]
        model=initial_model(room)
        if previous in ('boost','reduced'):model['response']=.3
        return plan(room,model,temperature,[4]*len(slots),slots,NOW,20)
    def test_no_previous_session_defaults_to_normal_instead_of_indefinite_reduction(self):
        result=self.run_plan(22)
        self.assertTrue(all(row['mode']=='normal' for row in result['slots']))
        self.assertEqual(result['mode'],'normal');self.assertEqual(result['setpoint'],20)
    def test_stored_warmth_bridges_expensive_hours_then_restores_normal(self):
        result=self.run_plan(21,previous='boost')
        self.assertEqual(result['slots'][0]['mode'],'normal')
        self.assertTrue(any(row['mode']=='reduced' for row in result['slots'][1:8]))
        self.assertEqual(result['slots'][-1]['mode'],'normal')
        self.assertTrue(any(c['action']=='restore' for c in result['commands']))
    def test_reduction_ends_if_room_is_below_target_despite_high_price(self):
        result=self.run_plan(19.8,previous='reduced',prices=[100]*8+[5]*8)
        self.assertNotEqual(result['slots'][0]['mode'],'reduced')
        self.assertTrue(all(row['setpoint']>=19 for row in result['slots']))

    def test_reduction_avoids_demand_when_residual_slab_heat_can_restore_comfort(self):
        room={**DEFAULTS,**ROOM_DEFAULTS,'baseline':20,'terminal_reserve_hours':0,
              'previous_control_mode':'reduced','reduction_available':True}
        model={**initial_model(room),'response':.8}
        slots=[Slot(NOW+timedelta(minutes=i*15),NOW+timedelta(minutes=(i+1)*15),40 if i<8 else 5) for i in range(16)]
        reduced=plan(room,model,19.98,[4]*16,slots,NOW,20)
        normal=plan({**room,'reduction_available':False},model,19.98,[4]*16,slots,NOW,20)
        self.assertEqual(reduced['slots'][0]['mode'],'reduced')
        self.assertFalse(reduced['slots'][0]['predicted_demand'])
        self.assertGreaterEqual(reduced['slots'][0]['temperature'],20)
        self.assertTrue(normal['slots'][0]['predicted_demand'])
        self.assertEqual(reduced['slots'][-1]['mode'],'normal')


class HeatRetentionTests(unittest.TestCase):
    def test_same_reference_conditions_allow_room_comparison(self):
        from thermal_pilot.model import heat_retention
        slower=heat_retention({'loss':.005,'gain':3,'response':1,'base_gain':5})
        faster=heat_retention({'loss':.02,'gain':0,'response':0,'base_gain':0})
        self.assertLess(slower['drop_6h'],faster['drop_6h'])
        self.assertGreater(slower['hours_per_degree'],faster['hours_per_degree'])
        self.assertEqual(heat_retention({'loss':.005}),slower)
        self.assertEqual(slower['indoor'],20);self.assertEqual(slower['outdoor'],-10)
    def test_invalid_parameters_and_honest_initial_or_adapting_state(self):
        from thermal_pilot.model import heat_retention
        for loss in [None,0,-1,float('nan')]:self.assertIsNone(heat_retention({'loss':loss}))
        self.assertFalse(heat_retention({'loss':.007,'heated_hours':20,'idle_hours':20})['updated'])
        self.assertTrue(heat_retention({'loss':.008,'heated_hours':20,'idle_hours':20})['updated'])
        self.assertTrue(heat_retention({'loss':.007,'parameter_updates':1})['updated'])
    def test_reference_cooling_follows_loss_equation(self):
        from thermal_pilot.model import heat_retention
        import math
        result=heat_retention({'loss':.007})
        self.assertAlmostEqual(result['drop_6h'],30*(1-math.exp(-.007*6)),places=3)
        self.assertAlmostEqual(30*(1-math.exp(-.007*result['hours_per_degree'])),1,places=2)


class WindModelTests(unittest.TestCase):
    def test_missing_wind_is_normal_loss_and_correction_is_bounded(self):
        from thermal_pilot.model import effective_loss
        model={'loss':.007,'wind_loss':.001}
        self.assertEqual(effective_loss(model,None),.007)
        self.assertEqual(effective_loss(model,-1),.007)
        self.assertEqual(effective_loss(model,3),.007)
        self.assertGreater(effective_loss(model,10),effective_loss(model,0))
        self.assertLessEqual(effective_loss({'loss':.04,'wind_loss':10},60),.05)
    def test_learning_requires_varied_wind_and_sufficient_observations(self):
        from thermal_pilot.model import learn_wind
        model={**initial_model(ROOM_DEFAULTS),'heated_hours':20,'idle_hours':20}
        for _ in range(200):learn_wind(model,ROOM_DEFAULTS,-30,.5,-.05,4,.25)
        self.assertNotIn('wind_loss',model)
        model={**initial_model(ROOM_DEFAULTS),'heated_hours':20,'idle_hours':20}
        for i in range(240):
            wind=1 if i%4<2 else 5;y=i%2;x=-30
            z=.007*x+.3*y+.0005*x*(wind-3)
            learn_wind(model,ROOM_DEFAULTS,x,y,z,wind,.25)
        self.assertGreater(model.get('wind_updates',0),0)
        self.assertGreater(model['wind_loss'],0)
        self.assertLessEqual(model['wind_loss'],model['loss']/6)
