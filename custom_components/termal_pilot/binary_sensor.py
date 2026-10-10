"""Suggested heating windows, suitable for HA history graphs."""
from homeassistant.components.binary_sensor import BinarySensorEntity
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from .const import DOMAIN


async def async_setup_entry(hass, entry, async_add_entities):
    c = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([PilotHeating(c, room) for room in c.settings['rooms']])


class PilotHeating(CoordinatorEntity, BinarySensorEntity):
    _attr_has_entity_name = True
    _attr_icon = 'mdi:radiator'
    def __init__(self, coordinator, room):
        super().__init__(coordinator)
        self.room_id = room['id']
        self._attr_unique_id = f'{coordinator.entry.entry_id}_{room["id"]}_heat'
        self._attr_name = f'{room["name"]} Suggested heating run'
        self._attr_device_info = {'identifiers':{(DOMAIN,coordinator.entry.entry_id)}}

    @property
    def available(self):
        return super().available and self._plan is not None

    @property
    def _plan(self):
        return (self.coordinator.data or {}).get('rooms',{}).get(self.room_id,{}).get('plan')

    @property
    def is_on(self):
        return self._plan['heat'] if self._plan else None

    @property
    def extra_state_attributes(self):
        p = self._plan or {}
        return {'simulation_only':True, 'reason':p.get('reason'), 'comfort_risk':p.get('comfort_risk')}
