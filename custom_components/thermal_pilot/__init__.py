"""ThermalPilot: simulation-first heating planner with opt-in scheduled thermostat control."""
from pathlib import Path
try:
    import probatio as vol
except ImportError:
    import voluptuous as vol
from homeassistant.components import frontend, panel_custom, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import callback
from homeassistant.util import dt as dt_util
from homeassistant.helpers import entity_registry as er
from .const import DOMAIN, VERSION, PLATFORMS, DEFAULTS, ROOM_DEFAULTS
from .config import validate, stored_settings, confirm_control_settings, SOURCE_FIELDS, ROOM_FIELDS
from .coordinator import PilotCoordinator


async def async_setup_entry(hass, entry):
    domain = hass.data.setdefault(DOMAIN, {})
    if not domain.get('_registered'):
        await hass.http.async_register_static_paths([StaticPathConfig(
            '/thermal_pilot/panel.js', str(Path(__file__).parent/'frontend'/'panel.js'), False),
            StaticPathConfig('/thermal_pilot/rooms-floor-plan.png',
                str(Path(__file__).parent/'frontend'/'rooms-floor-plan.png'), False)])
        for handler in (ws_get, ws_save, ws_history, ws_reset):
            websocket_api.async_register_command(hass, handler)
        domain['_registered'] = True
    coordinator = PilotCoordinator(hass, entry)
    entry.async_on_unload(coordinator.stop)
    await coordinator.load()
    coordinator.listen_sources()
    domain[entry.entry_id] = coordinator
    await coordinator.async_config_entry_first_refresh()
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    await panel_custom.async_register_panel(hass, frontend_url_path=DOMAIN,
        webcomponent_name='thermal-pilot-panel', sidebar_title='ThermalPilot',
        sidebar_icon='mdi:radiator', module_url=f'/thermal_pilot/panel.js?v={VERSION}',
        require_admin=True, config={'entry_id':entry.entry_id})
    entry.async_on_unload(entry.add_update_listener(_options_updated))
    return True


async def _options_updated(hass, entry):
    coordinator = hass.data[DOMAIN][entry.entry_id]
    coordinator.cancel_command_timer()
    coordinator.settings = stored_settings(entry.data, entry.options)
    coordinator.listen_sources()
    await coordinator.async_request_refresh()
    # Re-create entities when rooms change; entities derive stable IDs from room UUIDs.
    await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)


async def async_unload_entry(hass, entry):
    if await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        coordinator = hass.data[DOMAIN].pop(entry.entry_id)
        coordinator.stop()
        await coordinator.release_managed_rooms(dt_util.utcnow(),force=True)
        await coordinator.store.async_save(coordinator.storage_data())
        frontend.async_remove_panel(hass, DOMAIN)
        return True
    return False


def get_coordinator(hass, connection, msg):
    coordinator = hass.data.get(DOMAIN, {}).get(msg['entry_id'])
    if not isinstance(coordinator, PilotCoordinator):
        connection.send_error(msg['id'], 'not_loaded', 'Integration is not loaded.')
        return None
    return coordinator


@websocket_api.websocket_command({vol.Required('type'):'thermal_pilot/get', vol.Required('entry_id'):str})
@websocket_api.require_admin
@callback
def ws_get(hass, connection, msg):
    if (c := get_coordinator(hass, connection, msg)) is not None:
        registry = er.async_get(hass)
        room_entities = {room['id']:{
            'suggested':registry.async_get_entity_id('binary_sensor',DOMAIN,f'{c.entry.entry_id}_{room["id"]}_heat'),
            'actual':room['activity_entity'] or registry.async_get_entity_id('binary_sensor',DOMAIN,f'{c.entry.entry_id}_{room["id"]}_activity'),
        } for room in c.settings['rooms']}
        connection.send_result(msg['id'], {'settings':c.settings, 'data':c.data, 'room_entities':room_entities,
            'source_fields':SOURCE_FIELDS, 'room_fields':ROOM_FIELDS, 'room_defaults':ROOM_DEFAULTS})


@websocket_api.websocket_command({vol.Required('type'):'thermal_pilot/save', vol.Required('entry_id'):str, vol.Required('settings'):dict, vol.Optional('enable_live_control',default=False):bool})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_save(hass, connection, msg):
    if (c := get_coordinator(hass, connection, msg)) is None:
        return
    try:
        settings = validate(msg['settings'], hass)
        settings = confirm_control_settings(settings,c.settings,msg.get('enable_live_control',False))
    except ValueError as error:
        connection.send_error(msg['id'], 'invalid_settings', str(error))
        return
    hass.config_entries.async_update_entry(c.entry, options=settings)
    connection.send_result(msg['id'], {'saved':True})


@websocket_api.websocket_command({vol.Required('type'):'thermal_pilot/history', vol.Required('entry_id'):str, vol.Optional('hours',default=48):vol.All(vol.Coerce(int),vol.Range(min=1,max=2160))})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_history(hass, connection, msg):
    if (c := get_coordinator(hass, connection, msg)) is not None:
        from homeassistant.util import dt as dt_util
        cutoff = dt_util.utcnow().timestamp()-msg['hours']*3600
        rows = await hass.async_add_executor_job(c.history_db.read, cutoff)
        connection.send_result(msg['id'], rows)


@websocket_api.websocket_command({vol.Required('type'):'thermal_pilot/reset', vol.Required('entry_id'):str, vol.Required('room_id'):str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_reset(hass, connection, msg):
    if (c := get_coordinator(hass, connection, msg)) is not None:
        c.models.pop(msg['room_id'], None)
        c.previous.pop(msg['room_id'], None)
        await c.async_request_refresh()
        connection.send_result(msg['id'], {'reset':True})
