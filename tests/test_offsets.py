"""Thermostat advance timings are separate from planned heat-delivery periods."""
from pathlib import Path
import sys,types,unittest
from datetime import datetime,timedelta,timezone
ROOT=Path(__file__).resolve().parents[1]/'custom_components/thermal_pilot'
pkg=types.ModuleType('thermal_pilot');pkg.__path__=[str(ROOT)];sys.modules.setdefault('thermal_pilot',pkg)
from thermal_pilot.const import DEFAULTS
from thermal_pilot.model import thermostat_timing,thermostat_state
T=datetime(2026,1,2,22,tzinfo=timezone.utc)
class OffsetTests(unittest.TestCase):
    def timing(self,start=T,**settings):
        rows=[{'start':start.isoformat(),'end':(start+timedelta(minutes=15)).isoformat(),'heat':True},
              {'start':(start+timedelta(minutes=15)).isoformat(),'end':(start+timedelta(hours=1)).isoformat(),'heat':True}]
        return thermostat_timing(rows,{**DEFAULTS,'maximum':23,**settings},20,start-timedelta(minutes=5))
    def test_default_offsets_merge_contiguous_heat_slots(self):
        timing=self.timing()
        self.assertEqual(len(timing['sessions']),1)
        self.assertEqual([c['time'] for c in timing['commands']],[(T-timedelta(minutes=5)).isoformat(),(T+timedelta(minutes=50)).isoformat()])
        self.assertEqual(timing['setpoint'],21.5)
        self.assertEqual(thermostat_state(timing,T+timedelta(minutes=50))['setpoint'],19)
    def test_cross_midnight_offsets(self):
        midnight=T+timedelta(hours=2)
        self.assertEqual(self.timing(midnight)['commands'][0]['time'],(midnight-timedelta(minutes=5)).isoformat())
    def test_zero_and_non_quarter_hour_offsets(self):
        self.assertEqual(self.timing(start_offset_minutes=0,stop_offset_minutes=0)['commands'][0]['time'],T.isoformat())
        timing=self.timing(start_offset_minutes=7,stop_offset_minutes=9)
        self.assertEqual(timing['commands'][0]['time'],(T-timedelta(minutes=7)).isoformat())
        self.assertEqual(timing['commands'][1]['time'],(T+timedelta(minutes=51)).isoformat())
    def test_no_heat_has_no_commands(self):
        timing=thermostat_timing([{'start':T.isoformat(),'end':(T+timedelta(hours=1)).isoformat(),'heat':False}],{**DEFAULTS,'maximum':23},20,T)
        self.assertEqual(timing['commands'],[]);self.assertEqual(timing['setpoint'],19)
