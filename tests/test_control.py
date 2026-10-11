"""Thermostat reconciliation tests with service doubles."""
import unittest,types,sys
from pathlib import Path
from unittest.mock import AsyncMock
ROOT=Path(__file__).resolve().parents[1]/'custom_components/thermal_pilot'
pkg=types.ModuleType('thermal_pilot');pkg.__path__=[str(ROOT)];sys.modules.setdefault('thermal_pilot',pkg)
from thermal_pilot.control import ThermostatControl

class ControlTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.room={'id':'r','name':'Room','thermostat':'climate.r'}
        self.state=types.SimpleNamespace(state='heat',attributes={'temperature':20,'min_temp':5,'max_temp':30,'target_temp_step':0.5})
        self.hass=types.SimpleNamespace(states={'climate.r':self.state},services=types.SimpleNamespace(async_call=AsyncMock()))
        self.control=ThermostatControl(self.hass)

    async def test_write_rounding_acknowledgement_and_retry(self):
        await self.control.apply([self.room],{'r':21.2},0,lambda:True)
        self.assertEqual(self.hass.services.async_call.call_args.args[2]['temperature'],21)
        await self.control.apply([self.room],{'r':21.2},30,lambda:True)
        self.assertEqual(self.hass.services.async_call.await_count,1)
        await self.control.apply([self.room],{'r':21.2},60,lambda:True)
        self.assertEqual(self.hass.services.async_call.await_count,2)
        self.state.attributes['temperature']=21
        await self.control.apply([self.room],{'r':21.2},120,lambda:True)
        self.assertEqual(self.hass.services.async_call.await_count,2)

    async def test_cancel_pending_boost_even_when_state_still_matches_fallback(self):
        await self.control.apply([self.room],{'r':22},0,lambda:True)
        # Hardware has not acknowledged the boost: reported target is still 20.
        await self.control.apply([self.room],{'r':20},1,lambda:True)
        self.assertEqual(self.hass.services.async_call.await_count,2)
        self.assertEqual(self.hass.services.async_call.call_args.args[2]['temperature'],20)

    async def test_disabled_unavailable_bounds_and_failures(self):
        await self.control.apply([self.room],{'r':22},0,lambda:False)
        self.hass.services.async_call.assert_not_awaited()
        self.state.state='unavailable'
        self.assertTrue(await self.control.apply([self.room],{'r':22},0,lambda:True))
        self.state.state='heat'
        self.assertTrue(await self.control.apply([self.room],{'r':40},0,lambda:True))
        self.hass.services.async_call.side_effect=RuntimeError('offline')
        self.assertTrue(await self.control.apply([self.room],{'r':22},0,lambda:True))
        self.assertTrue(await self.control.apply([self.room],{'r':22},1,lambda:True))
        self.assertEqual(self.hass.services.async_call.await_count,2)


class ActivationTests(unittest.TestCase):
    def test_explicit_consent_and_legacy_preference(self):
        from thermal_pilot.config import confirm_control_settings
        with self.assertRaises(ValueError):
            confirm_control_settings({'simulation_enabled':False,'live_control_confirmed':True},{'simulation_enabled':False})
        accepted=confirm_control_settings({'simulation_enabled':False},{'simulation_enabled':True},True)
        self.assertTrue(accepted['live_control_confirmed'])
        self.assertTrue(confirm_control_settings({'simulation_enabled':False},accepted)['live_control_confirmed'])
        self.assertFalse(confirm_control_settings({'simulation_enabled':True},accepted)['live_control_confirmed'])


class FallbackSeasonTests(unittest.TestCase):
    def test_calendar_is_always_summer_and_temperature_is_an_alternative(self):
        from thermal_pilot.model import fallback_season
        from datetime import datetime,timezone
        from zoneinfo import ZoneInfo
        zone=ZoneInfo('Europe/Helsinki')
        for month,day in [(5,15),(7,1),(9,30)]:
            result=fallback_season({},[],None,-10,datetime(2026,month,day,12,tzinfo=zone),zone)
            self.assertTrue(result['summer'])
        for month,day in [(5,14),(10,1),(1,2)]:
            now=datetime(2026,month,day,12,tzinfo=zone)
            forecast=[{'datetime':now.isoformat(),'temperature':12,'templow':7}]
            self.assertTrue(fallback_season({},forecast,'daily',8,now,zone)['summer'])
            self.assertFalse(fallback_season({},forecast,'daily',8,now,zone,8)['summer'])
            forecast[0]['templow']=6
            self.assertTrue(fallback_season({},forecast,'daily',8,now,zone)['summer'])
            forecast[0]['templow']=7
            self.assertFalse(fallback_season({},forecast,'daily',5,now,zone)['summer'])
            self.assertFalse(fallback_season({},[],None,None,now,zone)['summer'])

    def test_full_hourly_day_is_retained_but_partial_or_gapped_day_is_not_enough(self):
        from thermal_pilot.model import fallback_season
        from datetime import datetime,timedelta
        from zoneinfo import ZoneInfo
        zone=ZoneInfo('Europe/Helsinki');now=datetime(2026,10,11,12,tzinfo=zone)
        midnight=now.replace(hour=0)
        rows=[{'datetime':(midnight+timedelta(hours=h)).isoformat(),'temperature':8} for h in range(24)]
        self.assertFalse(fallback_season({},rows[12:],'hourly',8,now,zone)['summer'])
        self.assertFalse(fallback_season({},[rows[0],rows[-1]],'hourly',8,now,zone)['summer'])
        full=fallback_season({},rows,'hourly',8,now,zone)
        self.assertTrue(full['summer'])
        self.assertTrue(fallback_season(full,rows[12:],'hourly',8,now,zone)['summer'])
        self.assertFalse(fallback_season(full,rows[12:],'hourly',4,now,zone)['summer'])
