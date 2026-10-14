"""Synthetic causal checks for learned air response, not hardware validation."""
import sys,types,unittest,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]/'custom_components/thermal_pilot'
pkg=types.ModuleType('thermal_pilot');pkg.__path__=[str(ROOT)];sys.modules.setdefault('thermal_pilot',pkg)
from thermal_pilot.const import DEFAULTS,ROOM_DEFAULTS
from thermal_pilot.model import initial_model,learn,response_step,response_lag,garage_cycle_plan,Slot
from thermal_pilot.config import SOURCE_FIELDS
from datetime import datetime,timedelta,timezone

class AirResponseTests(unittest.TestCase):
    def simulate(self,cycles=True,excluded=False,hours=48):
        room={**DEFAULTS,**ROOM_DEFAULTS,'air_control':True};model=initial_model(room);truth=initial_model(room);temperature=20;response=0
        for i in range(12*hours):
            activity=float((i//12)%2==0) if cycles else 0.0
            previous={'time':i*300,'temperature':temperature,'outdoor':-5,'activity':activity,'water_factor':1,'excluded':excluded}
            response,average=response_step(response,activity,1/12,45/60)
            temperature+=(truth['loss']*(-5-temperature)+truth['gain']*average+truth['base_gain'])/12
            current={**previous,'time':(i+1)*300,'temperature':temperature}
            learn(model,room,previous,current)
        return room,model
    def test_initial_ten_minutes_is_internal_and_preserved_without_evidence(self):
        self.assertNotIn('air_lag_hours',DEFAULTS);self.assertNotIn('air_lag_hours',[field[0] for field in SOURCE_FIELDS])
        room,model=self.simulate(hours=12)
        self.assertEqual(response_lag(room,model),10/60);self.assertNotIn('air_lag_updates',model)
        room,model=self.simulate(cycles=False)
        self.assertEqual(response_lag(room,model),10/60)
    def test_recovers_slow_response_from_past_observations_and_persists(self):
        room,model=self.simulate()
        self.assertEqual(response_lag(room,model),45/60);self.assertEqual(model['air_lag_updates'],1)
        restored=json.loads(json.dumps(model));self.assertEqual(response_lag(room,restored),45/60)
        self.assertGreaterEqual(model['air_lag_learning']['starts'],3);self.assertGreaterEqual(model['air_lag_learning']['stops'],3)
    def test_excluded_observations_do_not_teach_lag(self):
        room,model=self.simulate(excluded=True)
        self.assertEqual(response_lag(room,model),10/60);self.assertNotIn('air_lag_learning',model)
    def test_floor_lag_and_floor_learning_are_unchanged(self):
        room={**DEFAULTS,**ROOM_DEFAULTS,'lag_hours':3};model=initial_model(room);model['air_response_lag_hours']=.75
        self.assertEqual(response_lag(room,model),3)
        previous={'time':0,'temperature':20,'outdoor':-5,'activity':1,'water_factor':1};current={**previous,'time':300,'temperature':20.01}
        learn(model,room,previous,current);self.assertNotIn('air_lag_learning',model)
    def test_garage_forecast_uses_learned_response(self):
        room={**DEFAULTS,**ROOM_DEFAULTS,'is_garage':True,'air_control':True,'minimum':5,'maximum':9,'boost':4,'garage_heat_target':16};model=initial_model(room)
        now=datetime(2026,10,14,tzinfo=timezone.utc);slots=[Slot(now,now+timedelta(minutes=15),0)]
        initial=garage_cycle_plan(room,model,4,[-5],slots,now,False)
        model['air_response_lag_hours']=45/60
        learned=garage_cycle_plan(room,model,4,[-5],slots,now,False)
        self.assertLess(learned['slots'][0]['temperature'],initial['slots'][0]['temperature'])
