"""Recorder-visible suggested setpoints and model diagnostics."""
from homeassistant.components.sensor import SensorEntity, SensorDeviceClass, SensorStateClass
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from .const import DOMAIN


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([PilotSensor(coordinator, room, metric) for room in coordinator.settings['rooms']
                        for metric in ('setpoint', 'temperature', 'error', 'hours')])


class PilotSensor(CoordinatorEntity, SensorEntity):
    _attr_has_entity_name = True
    def __init__(self, coordinator, room, metric):
        super().__init__(coordinator)
        self.room_id, self.metric = room['id'], metric
        self._attr_unique_id = f'{coordinator.entry.entry_id}_{room["id"]}_{metric}'
        labels = {'setpoint':'Suggested setpoint', 'temperature':'Predicted temperature at slot end',
                  'error':'Short-term prediction MAE', 'hours':'Curve heating-hours estimate'}
        self._attr_name = f'{room["name"]} {labels[metric]}'
        self._attr_native_unit_of_measurement = 'h' if metric == 'hours' else '°C'
        self._attr_state_class = SensorStateClass.MEASUREMENT
        if metric in ('temperature','setpoint'):
            self._attr_device_class = SensorDeviceClass.TEMPERATURE
        self._attr_device_info = {'identifiers':{(DOMAIN,coordinator.entry.entry_id)},
                                  'name':'ThermalPilot', 'manufacturer':'ThermalPilot',
                                  'model':'Simulation only'}

    @property
    def available(self):
        return super().available and self.native_value is not None

    @property
    def native_value(self):
        row = (self.coordinator.data or {}).get('rooms',{}).get(self.room_id,{})
        p = row.get('plan')
        if self.metric == 'error':
            v = row.get('model',{}).get('mae')
            return round(v,3) if v is not None else None
        if p is None:
            return None
        return p['slots'][0]['temperature'] if self.metric=='temperature' else p['curve_hours'] if self.metric=='hours' else p['setpoint']

    @property
    def extra_state_attributes(self):
        row = (self.coordinator.data or {}).get('rooms',{}).get(self.room_id,{})
        return {'simulation_only':True, 'reason':(row.get('plan') or {}).get('reason',row.get('error')),
                'learning':row.get('learning_note')}
