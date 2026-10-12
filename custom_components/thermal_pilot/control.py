"""Apply thermostat targets; never operate relays or heat-pump modes directly."""
import asyncio
import math
from .model import number


class ThermostatControl:
    def __init__(self, hass, require_initial_write=False):
        self.hass = hass
        self.pending = {}
        self.results = {}
        self.lock = asyncio.Lock()
        self.require_initial_write = require_initial_write
        self.reconciled = set()

    async def apply(self, rooms, targets, now, permitted):
        """Reconcile targets, retry failures and avoid repeating unacknowledged writes."""
        errors = []
        async with self.lock:
            self.results = {}
            for room in rooms:
                if not permitted():
                    break
                entity = room['thermostat']
                requested = number(targets.get(room['id']))
                if requested is None:
                    continue
                state = self.hass.states.get(entity)
                if state is None or state.state in ('unknown','unavailable'):
                    errors.append(f"{room['name']}: thermostat unavailable; target will be retried.")
                    continue
                attrs = state.attributes
                if attrs.get('temperature_unit','°C') != '°C':
                    errors.append(f"{room['name']}: live control requires a thermostat using °C.")
                    continue
                device_low, device_high = number(attrs.get('min_temp',5)), number(attrs.get('max_temp',35))
                floor, ceiling = number(room.get('control_minimum')), number(room.get('control_maximum'))
                low = max(device_low,floor) if device_low is not None and floor is not None else device_low
                high = min(device_high,ceiling) if device_high is not None and ceiling is not None else device_high
                if low is None or high is None or not low <= requested <= high:
                    errors.append(f"{room['name']}: target is outside thermostat limits.")
                    continue
                step = number(attrs.get('target_temp_step'))
                if step and step>0:
                    first = math.ceil((low-device_low)/step-1e-9)
                    last = math.floor((high-device_low)/step+1e-9)
                    if first>last:
                        errors.append(f"{room['name']}: no supported thermostat target fits the temperature limits.")
                        continue
                    target = round(device_low+min(last,max(first,round((requested-device_low)/step)))*step,3)
                else:
                    target = round(requested,3)
                previous = self.pending.get(entity)
                actual = number(attrs.get('temperature'))
                if (not self.require_initial_write or entity in self.reconciled) and actual is not None and abs(actual-target)<0.001 and not (previous and previous['target']!=target):
                    self.pending.pop(entity,None)
                    self.results[room['id']] = target
                    continue
                if previous and previous['target']==target and now-previous['time']<60:
                    self.results[room['id']] = target
                    continue
                try:
                    await asyncio.wait_for(self.hass.services.async_call('climate','set_temperature',
                        {'entity_id':entity,'temperature':target},blocking=True),timeout=15)
                    self.pending[entity]={'target':target,'time':now}
                    self.reconciled.add(entity)
                    self.results[room['id']] = target
                except Exception:
                    errors.append(f"{room['name']}: setting thermostat temperature failed; will retry.")
        return errors
