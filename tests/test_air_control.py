"""Capability-aware garage and zone control; services are test doubles."""
import sys,types,unittest
from pathlib import Path
from copy import deepcopy
from unittest.mock import AsyncMock
ROOT=Path(__file__).resolve().parents[1]/'custom_components/thermal_pilot'
pkg=types.ModuleType('thermal_pilot');pkg.__path__=[str(ROOT)];sys.modules.setdefault('thermal_pilot',pkg)
from thermal_pilot.const import DEFAULTS,ROOM_DEFAULTS,ZONE_DEFAULTS
from thermal_pilot.config import validate,room_settings,resolved_rooms,zone_rooms
from thermal_pilot.air_control import AirHeatPumpControl,zone_temperature

def state(value,attrs=None):return types.SimpleNamespace(state=value,attributes=attrs or {})
class AirTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.room={**ROOM_DEFAULTS,'id':'00000000-0000-4000-8000-000000000001','name':'Garage','is_garage':True,'thermostat':'climate.garage','temperature_entity':'sensor.garage','garage_fan_heat':'high','garage_fan_idle':'low','garage_fan_presence':'medium','garage_swing':'both'}
        self.settings={**deepcopy(DEFAULTS),'outdoor_entity':'sensor.out','rooms':[self.room]}
        self.pump=state('fan_only',{'hvac_modes':['heat','fan_only','off'],'fan_modes':['low','medium','high'],'swing_modes':['off','both'],'temperature':16,'min_temp':16,'max_temp':30,'fan_mode':'low','swing_mode':'off'})
        self.hass=types.SimpleNamespace(states={'climate.garage':self.pump,'sensor.garage':state('6'),'sensor.out':state('-2')},services=types.SimpleNamespace(async_call=AsyncMock()))
        self.control=AirHeatPumpControl(self.hass)
    def intent(self,now=0,**kw):return self.control.intent(self.room,self.settings,now,**kw)
    async def test_hysteresis_and_warm_off(self):
        self.assertEqual(self.intent()['mode'],'fan_only')
        for value,expected in [('4.9','heat'),('8.9','heat'),('9','fan_only'),('6','fan_only')]:
            self.hass.states['sensor.garage'].state=value;self.assertEqual(self.intent()['mode'],expected)
        self.hass.states['sensor.out'].state='5';self.assertEqual(self.intent()['mode'],'fan_only')
        self.hass.states['sensor.out'].state='5.1';self.assertEqual(self.intent()['mode'],'off')
        self.hass.states['sensor.out'].state='unknown';self.assertEqual(self.intent()['mode'],'fan_only');self.assertTrue(self.intent()['errors'])
    async def test_tariff_preheating_upper_guard_and_no_price_fallback(self):
        self.room['garage_strategy']='tariff'
        self.assertEqual(self.intent(planned={'heat':True})['mode'],'heat')
        self.assertEqual(self.intent(planned=None)['mode'],'heat')
        self.hass.states['sensor.garage'].state='9';self.assertEqual(self.intent(planned={'heat':True})['mode'],'fan_only')
        self.room['garage_strategy']='temperature';self.hass.states['sensor.garage'].state='7'
        self.assertEqual(self.intent(planned={'heat':True})['mode'],'fan_only')
    async def test_presence_fan_and_door_pause(self):
        self.room.update(garage_door_entities=['binary_sensor.door'],garage_presence_entities=['binary_sensor.presence'])
        self.hass.states.update({'binary_sensor.door':state('off'),'binary_sensor.presence':state('on')})
        self.hass.states['sensor.garage'].state='4'
        intent=self.intent();self.assertEqual((intent['mode'],intent['target'],intent['fan']),('heat',16,'medium'))
        self.hass.states['binary_sensor.door'].state='on'
        self.assertEqual(self.intent(10)['mode'],'heat');self.assertEqual(self.intent(69)['mode'],'heat');self.assertEqual(self.intent(70)['mode'],'fan_only')
        self.hass.states['binary_sensor.door'].state='off';self.assertEqual(self.intent(71)['mode'],'heat')
    async def test_stage_and_countermand(self):
        self.hass.states['sensor.garage'].state='4';intent=self.intent()
        await self.control.apply([self.room],{self.room['id']:intent},0,lambda:True)
        self.assertEqual([c.args[1] for c in self.hass.services.async_call.call_args_list],['set_hvac_mode'])
        self.pump.state='heat'
        await self.control.apply([self.room],{self.room['id']:intent},5,lambda:True);self.assertEqual(self.hass.services.async_call.await_count,1)
        await self.control.apply([self.room],{self.room['id']:intent},10,lambda:True)
        self.assertEqual([c.args[1] for c in self.hass.services.async_call.call_args_list],['set_hvac_mode','set_temperature'])
        await self.control.apply([self.room],{self.room['id']:intent},20,lambda:True)
        self.assertEqual(self.hass.services.async_call.call_args.args[1],'set_fan_mode')
        await self.control.apply([self.room],{self.room['id']:intent},30,lambda:True)
        self.assertEqual(self.hass.services.async_call.await_count,3) # fan still not acknowledged
        self.pump.attributes['fan_mode']='high'
        await self.control.apply([self.room],{self.room['id']:intent},40,lambda:True)
        self.assertEqual(self.hass.services.async_call.call_args.args[1],'set_swing_mode')
        self.hass.states['sensor.garage'].state='9'
        await self.control.apply([self.room],{self.room['id']:self.intent(41)},41,lambda:True)
        self.assertEqual(self.hass.services.async_call.call_args.args[2]['hvac_mode'],'fan_only')
        self.assertNotIn(self.room['thermostat'],self.control.ready)
    async def test_unsupported_and_disabled_never_write(self):
        self.hass.states['sensor.garage'].state='4';intent=self.intent()
        await self.control.apply([self.room],{self.room['id']:intent},0,lambda:False);self.hass.services.async_call.assert_not_awaited()
        self.pump.attributes['swing_modes']=['off']
        self.assertTrue(await self.control.apply([self.room],{self.room['id']:intent},1,lambda:True));self.hass.services.async_call.assert_not_awaited()
    async def test_permission_rechecked_between_writes(self):
        self.pump.state='heat';self.pump.attributes['temperature']=20;self.hass.states['sensor.garage'].state='4';allowed=[True]
        async def write(*args,**kwargs):allowed[0]=False
        self.hass.services.async_call.side_effect=write
        await self.control.apply([self.room],{self.room['id']:self.intent()},0,lambda:allowed[0])
        self.assertEqual(self.hass.services.async_call.await_count,1)
    def test_garage_5_to_9_with_16_device_target_and_no_required_prices(self):
        result=validate(self.settings,self.hass);effective=room_settings(result['rooms'][0],result)
        self.assertEqual((effective['minimum'],effective['maximum'],effective['lag_hours']),(5,9,10/60));self.assertEqual(result['rooms'][0]['baseline'],20)
        self.assertEqual((result['minimum'],result['maximum']),(19,23));self.assertEqual(result['price_entity'],'')
        self.room['garage_minimum']=9
        with self.assertRaises(ValueError):validate(self.settings,self.hass)
    def test_zone_policies_guard_and_missing_member(self):
        main={**self.room,'is_garage':False,'heat_control':'air_to_air'};member={**ROOM_DEFAULTS,'id':'two','name':'Second','thermostat':'climate.garage','temperature_entity':'sensor.second','heat_control':'zone_member'}
        settings={**self.settings,'rooms':[main,member]};self.hass.states['sensor.garage'].state='20';self.hass.states['sensor.second']=state('18')
        for policy,expected in [('main',20),('average',19),('coldest',18)]:
            settings['air_zone_temperature']=policy;self.assertEqual(zone_temperature(self.hass,main,settings),(expected,False))
        self.hass.states['sensor.second'].state='23';self.assertTrue(zone_temperature(self.hass,main,settings)[1])
        self.hass.states['sensor.second'].state='unknown';self.assertEqual(zone_temperature(self.hass,main,settings),(None,False))
    def test_zones_have_one_secondary_controller_and_preserve_primary_thermostats(self):
        main={**self.room,'is_garage':False,'heat_control':'house','heating_zone_id':'00000000-0000-4000-8000-000000000003','thermostat':'climate.floor1'}
        second={**main,'id':'00000000-0000-4000-8000-000000000002','name':'Second','temperature_entity':'sensor.second','thermostat':'climate.floor2'}
        self.hass.states['sensor.second']=state('20')
        self.hass.states['climate.floor1']=state('heat',{'min_temp':5,'max_temp':35})
        self.hass.states['climate.floor2']=state('heat',{'min_temp':5,'max_temp':35})
        zone={**ZONE_DEFAULTS,'id':main['heating_zone_id'],'name':'House pump','thermostat':'climate.garage','main_room_id':main['id']}
        settings={**self.settings,'price_entity':'sensor.price','rooms':[main,second],'heating_zones':[zone]};self.hass.states['sensor.price']=state('10',{'today':[10]*96})
        validated=validate(settings,self.hass)
        self.assertEqual([r['thermostat'] for r in resolved_rooms(validated)],['climate.floor1','climate.floor2'])
        self.assertEqual([r['heat_control'] for r in zone_rooms(validated)],['air_to_air','zone_member'])
        self.assertEqual(zone_rooms(validated)[0]['id'],'zone:'+zone['id'])
        zone['main_room_id']='bad'
        with self.assertRaises(ValueError):validate(settings,self.hass)
    async def test_open_door_does_not_start_new_heating_before_pause_timer(self):
        self.room['garage_door_entity']='binary_sensor.door';self.hass.states['binary_sensor.door']=state('on');self.hass.states['sensor.garage'].state='4'
        self.assertEqual(self.intent(0)['mode'],'fan_only')
        self.hass.states['binary_sensor.door'].state='off';self.assertEqual(self.intent(1)['mode'],'heat')
    def test_fireplace_zone_preserves_room_controllers_and_validates_contact_value(self):
        room={**self.room,'is_garage':False,'heating_zone_id':'00000000-0000-4000-8000-000000000003'}
        zone={**ZONE_DEFAULTS,'id':room['heating_zone_id'],'name':'Fireplace','source_type':'fireplace','fireplace_entity':'binary_sensor.damper'}
        self.hass.states['binary_sensor.damper']=state('on')
        self.hass.states['sensor.price']=state('10',{'today':[10]*96})
        settings={**self.settings,'rooms':[room],'heating_zones':[zone],'price_entity':'sensor.price'}
        resolved=resolved_rooms(validate(settings,self.hass))[0]
        self.assertEqual(resolved['thermostat'],self.room['thermostat']);self.assertEqual(resolved['heat_control'],'house');self.assertEqual(resolved['zone_fireplace_entity'],'binary_sensor.damper')
        zone['fireplace_active_state']='Open'
        with self.assertRaises(ValueError):validate(settings,self.hass)
    async def test_shared_lower_guard_works_even_with_main_room_temperature_policy(self):
        self.room.update(is_garage=False,heat_control='air_to_air');self.hass.states['sensor.garage'].state='21'
        member={**ROOM_DEFAULTS,'id':'member','temperature_entity':'sensor.member','thermostat':self.room['thermostat'],'heat_control':'zone_member'}
        self.hass.states['sensor.member']=state('18');self.settings['rooms'].append(member)
        self.assertEqual(self.intent(planned={'heat':False,'setpoint':20})['mode'],'heat')
        self.hass.states['sensor.member'].state='23';self.assertEqual(self.intent(planned={'heat':True,'setpoint':21})['mode'],'fan_only')

    async def test_five_doors_share_timer_and_only_all_closed_reset_it(self):
        doors=[f'binary_sensor.door_{i}' for i in range(5)]
        self.room['garage_door_entities']=doors
        for entity in doors:self.hass.states[entity]=state('off')
        self.hass.states['sensor.garage'].state='4';self.assertEqual(self.intent(0)['mode'],'heat')
        self.hass.states[doors[0]].state='on';self.assertEqual(self.intent(10)['mode'],'heat')
        self.hass.states[doors[4]].state='on';self.assertEqual(self.intent(40)['mode'],'heat')
        self.hass.states[doors[0]].state='off';self.assertEqual(self.intent(69)['mode'],'heat')
        self.assertEqual(self.intent(70)['mode'],'fan_only');self.assertEqual(self.control.doors[self.room['id']],10)
        self.hass.states[doors[4]].state='off';self.assertEqual(self.intent(71)['mode'],'heat');self.assertNotIn(self.room['id'],self.control.doors)
        self.hass.states[doors[2]].state='on';self.assertEqual(self.intent(80)['mode'],'heat');self.assertEqual(self.intent(139)['mode'],'heat');self.assertEqual(self.intent(140)['mode'],'fan_only')
    async def test_many_presence_sensors_any_one_lowers_fan(self):
        sensors=[f'binary_sensor.presence_{i}' for i in range(5)];self.room['garage_presence_entities']=sensors
        for entity in sensors:self.hass.states[entity]=state('off')
        self.hass.states['sensor.garage'].state='4';self.assertEqual(self.intent()['fan'],'high')
        self.hass.states[sensors[-1]].state='on';self.assertEqual(self.intent()['fan'],'medium')
        self.hass.states[sensors[0]].state='on';self.hass.states[sensors[-1]].state='off';self.assertEqual(self.intent()['fan'],'medium')
        self.hass.states[sensors[0]].state='off';self.assertEqual(self.intent()['fan'],'high')
    def test_sensor_list_migration_and_validation(self):
        from thermal_pilot.config import stored_settings
        self.room.update(garage_door_entity='binary_sensor.door',garage_door_entity_2='binary_sensor.second',garage_presence_entity='binary_sensor.presence',garage_manual_entity='input_boolean.old',garage_guard_entity='sensor.old')
        migrated=stored_settings(self.settings,{})['rooms'][0]
        self.assertEqual(migrated['garage_door_entities'],['binary_sensor.door','binary_sensor.second']);self.assertEqual(migrated['garage_presence_entities'],['binary_sensor.presence'])
        self.assertNotIn('garage_manual_entity',migrated);self.assertNotIn('garage_guard_entity',migrated)
        for entity in migrated['garage_door_entities']+migrated['garage_presence_entities']:self.hass.states[entity]=state('off')
        valid=validate(self.settings,self.hass);self.assertEqual(valid['rooms'][0]['garage_door_entities'],migrated['garage_door_entities'])
        self.room['garage_door_entities']=['sensor.garage']
        with self.assertRaises(ValueError):validate(self.settings,self.hass)

    async def test_off_pump_starts_then_waits_for_each_stage_and_retries(self):
        self.pump.state='off';self.pump.attributes.update(supported_features=256,temperature=20)
        self.hass.states['sensor.garage'].state='4';intent=self.intent()
        async def apply(t):return await self.control.apply([self.room],{self.room['id']:intent},t,lambda:True)
        await apply(0);self.assertEqual(self.hass.services.async_call.call_args.args[1],'turn_on')
        await apply(10);await apply(59);self.assertEqual(self.hass.services.async_call.await_count,1)
        self.assertTrue(await apply(60));self.assertEqual(self.hass.services.async_call.call_args.args[1],'turn_on')
        self.pump.state='fan_only';await apply(70);self.assertEqual(self.hass.services.async_call.call_args.args[1],'set_hvac_mode')
        await apply(80);self.assertEqual(self.hass.services.async_call.await_count,3)
        self.pump.state='heat';await apply(90);self.assertEqual(self.hass.services.async_call.call_args.args[1],'set_temperature')
        await apply(100);self.assertEqual(self.hass.services.async_call.await_count,4)
        self.assertTrue(await apply(150));self.assertEqual(self.hass.services.async_call.call_args.args[1],'set_temperature')
        self.pump.attributes['temperature']=16;await apply(160);self.assertEqual(self.hass.services.async_call.call_args.args[1],'set_fan_mode')
        self.assertTrue(await apply(220));self.assertEqual(self.hass.services.async_call.call_args.args[1],'set_fan_mode')
        self.pump.attributes['fan_mode']='high';await apply(230);self.assertEqual(self.hass.services.async_call.call_args.args[1],'set_swing_mode')
        self.assertTrue(await apply(290));self.assertEqual(self.hass.services.async_call.call_args.args[1],'set_swing_mode')
        self.assertFalse(self.control.results[self.room['id']]['confirmed'])
        self.pump.attributes['swing_mode']='both';await apply(300);self.assertTrue(self.control.results[self.room['id']]['confirmed'])
    async def test_failed_stage_does_not_advance_and_is_retried(self):
        self.pump.state='off';self.pump.attributes['supported_features']=256
        self.hass.states['sensor.garage'].state='4';intent=self.intent()
        self.hass.services.async_call.side_effect=RuntimeError('offline')
        self.assertTrue(await self.control.apply([self.room],{self.room['id']:intent},0,lambda:True))
        await self.control.apply([self.room],{self.room['id']:intent},10,lambda:True);self.assertEqual(self.hass.services.async_call.await_count,1)
        await self.control.apply([self.room],{self.room['id']:intent},60,lambda:True);self.assertEqual(self.hass.services.async_call.await_count,2)
        self.assertEqual([c.args[1] for c in self.hass.services.async_call.call_args_list],['turn_on','turn_on'])
    async def test_off_countermand_cancels_inflight_power_on_even_if_cached_state_is_off(self):
        self.pump.state='off';self.pump.attributes['supported_features']=256
        self.hass.states['sensor.garage'].state='4';intent=self.intent()
        self.control.reconciled.add((self.room['thermostat'],'hvac_mode'))
        await self.control.apply([self.room],{self.room['id']:intent},0,lambda:True)
        self.assertEqual(self.hass.services.async_call.call_args.args[1],'turn_on')
        self.hass.states['sensor.out'].state='6';intent=self.intent(1)
        await self.control.apply([self.room],{self.room['id']:intent},1,lambda:True)
        self.assertEqual(self.hass.services.async_call.call_args.args[2]['hvac_mode'],'off')
    def test_empty_zone_is_valid_but_has_no_controller_rooms(self):
        zone={**ZONE_DEFAULTS,'id':'00000000-0000-4000-8000-000000000003','name':'Empty zone','thermostat':'climate.garage'}
        self.hass.states['sensor.price']=state('10',{'today':[10]*96})
        settings={**self.settings,'rooms':[],'heating_zones':[zone],'price_entity':'sensor.price'}
        result=validate(settings,self.hass)
        self.assertEqual(resolved_rooms(result),[])
        zone['main_room_id']=self.room['id']
        with self.assertRaises(ValueError):validate(settings,self.hass)
    async def test_standby_swing_is_applied_after_mode_and_fan_acknowledgements(self):
        self.room['garage_swing_idle']='both';self.pump.state='heat';self.hass.states['sensor.garage'].state='9'
        intent=self.intent();self.assertEqual((intent['mode'],intent['swing']),('fan_only','both'))
        await self.control.apply([self.room],{self.room['id']:intent},0,lambda:True)
        self.assertEqual(self.hass.services.async_call.call_args.args[1],'set_hvac_mode')
        self.pump.state='fan_only'
        await self.control.apply([self.room],{self.room['id']:intent},10,lambda:True)
        self.assertEqual(self.hass.services.async_call.call_args.args[1],'set_swing_mode')
        self.pump.attributes['swing_mode']='both'
        await self.control.apply([self.room],{self.room['id']:intent},20,lambda:True)
        self.assertTrue(self.control.results[self.room['id']]['confirmed'])

    def test_save_ignores_fan_only_temperature_range_but_checks_heat_range(self):
        self.pump.attributes.update(min_temp=0,max_temp=1)
        self.assertEqual(validate(self.settings,self.hass)['rooms'][0]['garage_heat_target'],16)
        self.pump.state='heat';self.pump.attributes.update(min_temp=17,max_temp=30)
        with self.assertRaisesRegex(ValueError,'16 °C.*17–30 °C'):
            validate(self.settings,self.hass)
        self.room['garage_heat_target']=18
        self.assertEqual(validate(self.settings,self.hass)['rooms'][0]['garage_heat_target'],18)

    async def test_mode_specific_bounds_wait_for_heat_and_reject_safely(self):
        self.pump.attributes.update(min_temp=0,max_temp=1)
        self.hass.states['sensor.garage'].state='4';intent=self.intent()
        await self.control.apply([self.room],{self.room['id']:intent},0,lambda:True)
        self.assertEqual(self.hass.services.async_call.call_args.args[1],'set_hvac_mode')
        self.pump.state='heat'
        await self.control.apply([self.room],{self.room['id']:intent},5,lambda:True)
        self.assertEqual(self.hass.services.async_call.await_count,1)
        self.pump.attributes.update(min_temp=16,max_temp=30)
        await self.control.apply([self.room],{self.room['id']:intent},10,lambda:True)
        self.assertEqual(self.hass.services.async_call.call_args.args[1],'set_temperature')
        self.assertEqual(self.hass.services.async_call.call_args.args[2]['temperature'],16)
        intent['target']=15
        errors=await self.control.apply([self.room],{self.room['id']:intent},20,lambda:True)
        self.assertTrue(errors)
        self.assertEqual(self.hass.services.async_call.call_args.args[2]['hvac_mode'],'fan_only')
        self.pump.state='fan_only';self.pump.attributes.update(min_temp=0,max_temp=1)
        count=self.hass.services.async_call.await_count
        await self.control.apply([self.room],{self.room['id']:intent},30,lambda:True)
        self.assertEqual(self.hass.services.async_call.await_count,count)
        intent['target']=18
        await self.control.apply([self.room],{self.room['id']:intent},40,lambda:True)
        self.assertEqual(self.hass.services.async_call.call_args.args[2]['hvac_mode'],'heat')

    def cooling_zone(self,mode='cool'):
        self.room.update(is_garage=False,heat_control='air_to_air',heating_zone_id='zone',zone_climate_mode=mode,zone_cooling_target=24,zone_policy='main')
        self.pump.attributes['hvac_modes']=['heat','cool','fan_only','off']
        self.hass.states['sensor.garage'].state='25'
        return self.room

    def test_cooling_only_never_heats_and_both_has_exclusive_seasons(self):
        self.cooling_zone()
        self.assertEqual(self.control.intent(self.room,self.settings,0,summer=False)['mode'],'fan_only')
        # A new stable season is adopted after a full day, not each forecast update.
        self.assertEqual(self.control.intent(self.room,self.settings,1,summer=True)['mode'],'fan_only')
        self.assertEqual(self.control.intent(self.room,self.settings,86401,summer=True)['mode'],'cool')
        self.room['zone_climate_mode']='heat'
        self.assertEqual(self.control.intent(self.room,self.settings,86402,summer=True)['mode'],'fan_only')
        self.room['zone_climate_mode']='both'
        self.assertEqual(self.control.intent(self.room,self.settings,86403,summer=True)['mode'],'cool')
        self.assertEqual(self.control.intent(self.room,self.settings,86404,summer=False)['mode'],'cool')
        self.hass.states['sensor.garage'].state='18'
        self.assertEqual(self.control.intent(self.room,self.settings,172804,summer=False)['mode'],'heat')

    def test_cooling_hysteresis_and_missing_reading_stop(self):
        self.cooling_zone()
        for value,expected in [('24.4','fan_only'),('24.5','cool'),('24.2','cool'),('24','fan_only'),('24.4','fan_only'),('unknown','fan_only')]:
            self.hass.states['sensor.garage'].state=value
            self.assertEqual(self.control.intent(self.room,self.settings,0,summer=True)['mode'],expected)
        self.assertEqual(self.control.intent(self.room,self.settings,0,summer=True,enabled=False)['mode'],'fan_only')

    async def test_cooling_stages_and_ten_minute_reversal_pause(self):
        self.cooling_zone();self.pump.state='heat'
        intent=self.control.intent(self.room,self.settings,0,summer=True)
        await self.control.apply([self.room],{self.room['id']:intent},0,lambda:True)
        self.assertEqual(self.hass.services.async_call.call_args.args[2]['hvac_mode'],'fan_only')
        self.pump.state='fan_only';self.pump.attributes.update(min_temp=0,max_temp=1)
        await self.control.apply([self.room],{self.room['id']:intent},10,lambda:True)
        await self.control.apply([self.room],{self.room['id']:intent},609,lambda:True)
        self.assertEqual(self.hass.services.async_call.await_count,1)
        await self.control.apply([self.room],{self.room['id']:intent},610,lambda:True)
        self.assertEqual(self.hass.services.async_call.call_args.args[2]['hvac_mode'],'cool')
        self.pump.state='cool';self.pump.attributes.update(min_temp=16,max_temp=30)
        await self.control.apply([self.room],{self.room['id']:intent},620,lambda:True)
        self.assertEqual(self.hass.services.async_call.call_args.args[2]['temperature'],24)
        self.assertNotIn('heat_cool',[c.args[2].get('hvac_mode') for c in self.hass.services.async_call.call_args_list])
        self.hass.services.async_call.reset_mock()
        await self.control.apply([self.room],{self.room['id']:intent},630,lambda:False)
        self.hass.services.async_call.assert_not_awaited()

    async def test_reversal_pause_survives_an_intermediate_standby_request(self):
        self.cooling_zone();self.pump.state='heat'
        standby={'mode':'fan_only','target':None,'fan':'','swing':'','errors':[]}
        await self.control.apply([self.room],{self.room['id']:standby},0,lambda:True)
        self.pump.state='fan_only';self.hass.services.async_call.reset_mock()
        cooling={'mode':'cool','target':24,'fan':'','swing':'','errors':[]}
        await self.control.apply([self.room],{self.room['id']:cooling},10,lambda:True)
        self.hass.services.async_call.assert_not_awaited()
        self.assertIn('climate.garage',self.control.reversals)
        await self.control.apply([self.room],{self.room['id']:cooling},610,lambda:True)
        self.assertEqual(self.hass.services.async_call.call_args.args[2]['hvac_mode'],'cool')

    def test_zone_temperature_strategy_ignores_tariff_plan(self):
        self.room.update(is_garage=False,heat_control='air_to_air',heating_zone_id='zone',zone_heating_strategy='temperature',baseline=20)
        self.hass.states['sensor.garage'].state='19.7'
        self.assertEqual(self.intent(planned={'heat':False,'setpoint':18})['mode'],'heat')
        self.hass.states['sensor.garage'].state='20.3'
        self.assertEqual(self.intent(planned={'heat':True,'setpoint':22})['mode'],'fan_only')
