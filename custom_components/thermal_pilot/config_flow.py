"""Small native setup flow; full settings live in the sidebar panel."""
try:
    import probatio as vol
except ImportError:
    import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.helpers import selector
from .const import DOMAIN, DEFAULTS
from .config import setup_selector_config


class ThermalPilotFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        if user_input is not None:
            return self.async_create_entry(title='ThermalPilot', data={**DEFAULTS, **user_input})
        return self.async_show_form(step_id='user', data_schema=vol.Schema({
            vol.Required('price_entity'): selector.EntitySelector(setup_selector_config(self.hass, 'price_entity')),
            vol.Required('outdoor_entity'): selector.EntitySelector(setup_selector_config(self.hass, 'outdoor_entity')),
        }))

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return PilotOptions()


class PilotOptions(config_entries.OptionsFlow):
    async def async_step_init(self, user_input=None):
        if user_input is not None:
            # Preserve settings from the dedicated panel.
            return self.async_create_entry(title='', data=dict(self.config_entry.options))
        return self.async_show_form(step_id='init', data_schema=vol.Schema({}))
