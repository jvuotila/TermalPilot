"""Master activity switch controls the simulator, never physical heating."""
from homeassistant.components.switch import SwitchEntity
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from .const import DOMAIN


async def async_setup_entry(hass, entry, async_add_entities):
    async_add_entities([PilotActive(hass.data[DOMAIN][entry.entry_id])])


class PilotActive(CoordinatorEntity, SwitchEntity):
    _attr_has_entity_name = True
    _attr_name = 'Heating simulation active'
    _attr_icon = 'mdi:radiator'
    def __init__(self, coordinator):
        super().__init__(coordinator)
        self._attr_unique_id = f'{coordinator.entry.entry_id}_active'
        self._attr_device_info = {'identifiers':{(DOMAIN,coordinator.entry.entry_id)}}

    @property
    def is_on(self):
        return self.coordinator.settings['heating_enabled']

    async def async_turn_on(self, **kwargs):
        self._set(True)

    async def async_turn_off(self, **kwargs):
        self._set(False)

    def _set(self, active):
        settings = {**self.coordinator.settings, 'heating_enabled':active}
        self.hass.config_entries.async_update_entry(self.coordinator.entry, options=settings)
