"""Authenticated file transfers, separate from websocket message-size limits."""
import logging
from datetime import datetime, timezone
from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from .const import DOMAIN
from .backup import MAX_ARCHIVE_BYTES, export_backup, restore_backup

_LOGGER=logging.getLogger(__name__)


class BackupView(HomeAssistantView):
    url='/api/thermal_pilot/backup/{entry_id}'
    name='api:thermal_pilot:backup'
    requires_auth=True

    def __init__(self,hass):
        self.hass=hass

    def coordinator(self,request,entry_id):
        if not request['hass_user'].is_admin:
            raise web.HTTPForbidden()
        coordinator=self.hass.data.get(DOMAIN,{}).get(entry_id)
        if coordinator is None:
            raise web.HTTPNotFound()
        return coordinator

    async def get(self,request,entry_id):
        coordinator=self.coordinator(request,entry_id)
        try:
            content=await export_backup(coordinator)
        except ValueError as error:
            return web.json_response({'error':str(error)},status=400)
        except Exception:
            _LOGGER.exception('ThermalPilot backup export failed')
            return web.json_response({'error':'Backup export failed.'},status=500)
        filename='ThermalPilot-backup-'+datetime.now(timezone.utc).strftime('%Y-%m-%d-%H%M%S')+'.zip'
        return web.Response(body=content,content_type='application/zip',headers={
            'Content-Disposition':f'attachment; filename="{filename}"','Cache-Control':'no-store'})

    async def post(self,request,entry_id):
        coordinator=self.coordinator(request,entry_id)
        if request.headers.get('X-ThermalPilot-Confirm')!='replace':
            return web.json_response({'error':'Confirm replacement before importing.'},status=400)
        content=bytearray()
        async for chunk in request.content.iter_chunked(65536):
            content.extend(chunk)
            if len(content)>MAX_ARCHIVE_BYTES:
                return web.json_response({'error':'Backup exceeds the 256 MiB limit.'},status=413)
        try:
            result=await restore_backup(coordinator,bytes(content))
        except ValueError as error:
            return web.json_response({'error':str(error)},status=400)
        except Exception:
            _LOGGER.exception('ThermalPilot backup import failed')
            return web.json_response({'error':'Backup import failed. Check the Home Assistant log.'},status=500)
        return web.json_response(result,headers={'Cache-Control':'no-store'})
