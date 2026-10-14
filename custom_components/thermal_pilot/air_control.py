"""Explicit air-to-air mode control, independent of water heating and valve timing."""
import asyncio
from .model import number
from .config import resolved_rooms, garage_sensor_lists


def binary(hass, entity):
    if not entity:return False
    state=hass.states.get(entity)
    return state.state=='on' if state and state.state in ('on','off') else None


def zone_temperature(hass, room, settings):
    members=[room]+[r for r in resolved_rooms(settings) if r.get('heat_control')=='zone_member' and r['thermostat']==room['thermostat']]
    values=[]
    for member in members:
        state=hass.states.get(member['temperature_entity'])
        value=number(state.state) if state else None
        if value is None:return None,False
        values.append(value)
    high=room['garage_maximum'] if room.get('is_garage') else settings['maximum']
    too_warm=any(v>=high for v in values)
    policy='main' if room.get('is_garage') else room.get('zone_policy',settings.get('air_zone_temperature','main'))
    return (min(values) if policy=='coldest' else sum(values)/len(values) if policy=='average' else values[0]),too_warm


class AirHeatPumpControl:
    def __init__(self,hass):
        self.hass=hass
        self.cycles={}
        self.doors={}
        self.pending={}
        self.ready={}
        self.rejected_targets={}
        self.results={}
        self.reconciled=set()
        self.lock=asyncio.Lock()
        self.deadlines=[]

    def intent(self,room,settings,now,planned=None,enabled=True,release=False):
        """Hysteresis uses the external sensor; device target is a separate value."""
        room=garage_sensor_lists(room)
        rid=room['id'];garage=room.get('is_garage',False)
        state=self.hass.states.get(room['thermostat'])
        temperature,too_warm=zone_temperature(self.hass,room,settings)
        outdoor_state=self.hass.states.get(settings['outdoor_entity'])
        outdoor=number(outdoor_state.state) if outdoor_state else None
        prefix='garage_' if garage else 'air_';values=room if garage else settings
        target=values[prefix+'heat_target']
        mode='fan_only';reason='Standby';errors=[]
        low=room['garage_minimum'] if garage else settings['minimum']
        zone_members=[room]+[r for r in resolved_rooms(settings) if r.get('heat_control')=='zone_member' and r['thermostat']==room['thermostat']]
        too_cold=any(number(self.hass.states.get(r['temperature_entity']).state)<low for r in zone_members) if temperature is not None else False
        signature=(room['thermostat'],room['temperature_entity'],garage,low,room.get('garage_maximum'),room.get('garage_strategy'))
        old=self.cycles.get(rid,{})
        heating=old.get('heating',state is not None and state.state=='heat') if old.get('signature')==signature else bool(state and state.state=='heat')
        door_entities=room.get('garage_door_entities',[]) if garage else []
        door_states={entity:binary(self.hass,entity) for entity in door_entities}
        door=any(value is True for value in door_states.values())
        doors_valid=all(value is not None for value in door_states.values())
        paused=False
        if door:
            observed=[]
            for entity,value in door_states.items():
                if value is not True:continue
                changed=getattr(self.hass.states.get(entity),'last_changed',None)
                observed.append(min(now,changed.timestamp()) if hasattr(changed,'timestamp') else now)
            since=self.doors.setdefault(rid,min(observed))
            deadline=since+room['garage_door_delay']
            paused=now>=deadline
            if not paused:self.deadlines.append(deadline)
        elif doors_valid:
            self.doors.pop(rid,None)
        valid=temperature is not None and outdoor is not None and doors_valid
        if not enabled or release:
            heating=False;reason='Heating paused'
        elif not valid:
            heating=False;reason='Required heat pump input unavailable'
            errors.append(f"{room['name']}: required temperature or configured control input unavailable; using fan-only standby.")
        elif paused or (door and not heating):
            heating=False;reason='Garage door open: heating paused'
        elif garage:
            if outdoor>low:
                heating=False;reason='Warm weather'
            elif too_warm:
                heating=False;reason='Garage upper limit reached'
            elif temperature<low:
                heating=True;reason='Garage below lower limit'
            elif room['garage_strategy']=='tariff' and planned is not None:
                heating=bool(planned.get('heat'));reason='Tariff heating plan' if heating else 'Tariff standby'
            else:
                reason='Garage temperature cycle' if heating else 'Standby'
        else:
            if too_warm:
                heating=False;reason='Heating zone upper limit reached'
            elif too_cold:
                heating=True;reason='Heating zone below lower limit'
            elif planned is None:
                # Missing price data falls back to room comfort, independently of tariffs.
                heating=temperature<room['baseline'];reason='Room comfort fallback'
            else:
                heating=bool(planned.get('heat')) or temperature<planned.get('setpoint',room['baseline'])
                reason='Room heating plan' if heating else 'Standby'
        if heating:mode='heat'
        elif garage and outdoor is not None and outdoor>low and not paused and valid:mode='off'
        self.cycles[rid]={'signature':signature,'heating':heating}
        fan=values.get(prefix+('fan_heat' if heating else 'fan_idle'),'')
        if garage and mode!='off':
            presence=[binary(self.hass,entity) for entity in room.get('garage_presence_entities',[])]
            if any(v is True for v in presence):fan=room.get('garage_fan_presence') or fan
        return {'mode':mode,'target':target if heating else None,'fan':fan if mode!='off' else '',
                'swing':values.get(prefix+('swing' if heating else 'swing_idle'),'') if mode!='off' else '', 'reason':reason,'errors':errors}

    async def apply(self,rooms,intents,now,permitted):
        """One command per pump per pass; later stages require reported acknowledgement.

Poll at ten seconds, retry the unacknowledged stage at sixty seconds. A changed
mode countercommands pending work immediately. HA state is feedback, not proof
of physical compressor operation, especially with optimistic integrations.
"""
        errors=[];self.results={}
        async with self.lock:
            for room in rooms:
                if not permitted():break
                intent=intents[room['id']];entity=room['thermostat'];rid=room['id']
                state=self.hass.states.get(entity)
                if not state or state.state in ('unknown','unavailable'):
                    errors.append(f"{room['name']}: heat pump unavailable.");continue
                attrs=state.attributes;mode=intent['mode']
                if mode not in attrs.get('hvac_modes',[]):
                    errors.append(f"{room['name']}: heat pump does not support {mode}.");continue
                if attrs.get('temperature_unit','°C') not in ('°C','C'):
                    errors.append(f"{room['name']}: heat pump must use Celsius.");continue
                commands=[]
                cancel_start=mode=='off' and (entity,'power') in self.pending
                # Home Assistant ClimateEntityFeature.TURN_ON is 256. For devices
                # without it, selecting Heat/Fan only is the supported startup action.
                if mode!='off' and int(number(attrs.get('supported_features'),0)) & 256:
                    commands.append(('turn_on','power',True,state.state!='off'))
                elif mode=='off':self.pending.pop((entity,'power'),None)
                commands.append(('set_hvac_mode','hvac_mode',mode,state.state))
                target=number(intent['target']) if mode=='heat' else None
                rejected=self.rejected_targets.get(entity)
                if rejected and rejected['target']!=target:
                    self.rejected_targets.pop(entity,None);rejected=None
                # Bounds are mode-specific. Wait for Heat and its settling period
                # before reading them; never send a temperature in fan-only mode.
                checking_heat=mode=='heat' and state.state=='heat' and now>=self.ready.get(entity,now)
                if checking_heat:
                    low=number(attrs.get('min_temp'),5);high=number(attrs.get('max_temp'),35)
                    step=number(attrs.get('target_temp_step'),.5)
                    if target is None or not low<=target<=high or step<=0:
                        rejected={'target':target,'low':low,'high':high}
                        self.rejected_targets[entity]=rejected
                    else:
                        rejected=None;self.rejected_targets.pop(entity,None)
                        target=round(max(low,min(high,low+round((target-low)/step)*step)),6)
                        commands.append(('set_temperature','temperature',target,number(attrs.get('temperature'))))
                if rejected:
                    errors.append(f"{room['name']}: heating setpoint outside device limits ({rejected['low']:g}–{rejected['high']:g} °C); using fan-only standby.")
                    # Keep the rejection while in standby, avoiding repeated starts
                    # with an invalid setpoint. A changed target permits a new check.
                    mode='fan_only'
                    commands=[('set_hvac_mode','hvac_mode',mode,state.state)]
                if intent['fan'] and not rejected:
                    if intent['fan'] not in attrs.get('fan_modes',[]):
                        errors.append(f"{room['name']}: selected fan mode is unsupported.");continue
                    commands.append(('set_fan_mode','fan_mode',intent['fan'],attrs.get('fan_mode')))
                if intent['swing'] and not rejected:
                    if intent['swing'] not in attrs.get('swing_modes',[]):
                        errors.append(f"{room['name']}: selected swing mode is unsupported.");continue
                    commands.append(('set_swing_mode','swing_mode',intent['swing'],attrs.get('swing_mode')))
                if mode!='heat':self.ready.pop(entity,None)
                self.results[rid]={**intent,'confirmed':False,'stage':'checking'}
                for service,key,value,reported in commands:
                    if not permitted():break
                    if key not in ('power','hvac_mode') and mode=='heat' and now<self.ready.get(entity,now):
                        self.results[rid]['stage']=key
                        self.deadlines.append(self.ready[entity]);break
                    pending=self.pending.get((entity,key))
                    opposing=(pending is not None and pending['value']!=value) or (key=='hvac_mode' and cancel_start)
                    matches=(reported is not None and abs(reported-value)<.001) if key=='temperature' else reported==value
                    needs_initial=key in ('hvac_mode','temperature') and (entity,key) not in self.reconciled
                    if matches and not opposing and (not needs_initial or pending is not None):
                        self.pending.pop((entity,key),None);self.reconciled.add((entity,key));continue
                    self.results[rid]['stage']=key
                    if pending and pending['value']==value:
                        elapsed=now-pending['time']
                        if pending.get('failed'):
                            errors.append(f"{room['name']}: {service} failed; waiting to retry.")
                        if elapsed<60:
                            self.deadlines.append(min(now+10,pending['time']+60));break
                        errors.append(f"{room['name']}: heat pump has not confirmed {key}; retrying this stage.")
                    if not permitted():break
                    self.pending[(entity,key)]={'value':value,'time':now}
                    payload={'entity_id':entity}
                    if key!='power':payload[key]=value
                    try:
                        await asyncio.wait_for(self.hass.services.async_call('climate',service,payload,blocking=True),15)
                        if key=='hvac_mode' and value=='heat':self.ready[entity]=now+10
                    except Exception:
                        self.pending[(entity,key)]['failed']=True
                        errors.append(f"{room['name']}: {service} failed; will retry.")
                    self.deadlines.append(now+10)
                    break  # Wait for reported acknowledgement before the next stage.
                else:
                    if intent['mode']=='heat' and not checking_heat and not rejected:
                        self.results[rid]['stage']='temperature'
                        self.deadlines.append(max(now+10,self.ready.get(entity,now)))
                    elif not rejected:
                        self.results[rid].update(confirmed=True,stage='confirmed')
        return errors
