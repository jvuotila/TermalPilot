"""Apply thermostat targets; never operate relays or heat-pump modes directly."""
import asyncio
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
                low, high = number(attrs.get('min_temp',5)), number(attrs.get('max_temp',35))
                if low is None or high is None or not low <= requested <= high:
                    errors.append(f"{room['name']}: target is outside thermostat limits.")
                    continue
                step = number(attrs.get('target_temp_step'))
                target = round(min(high,max(low,low+round((requested-low)/step)*step)) if step and step>0 else requested,3)
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
