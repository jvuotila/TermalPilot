"""Portable administrator backups. Never execute SQL supplied by an archive."""
from copy import deepcopy
from contextlib import closing
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
import hashlib
import json
import sqlite3
import tempfile
import zipfile

from .const import VERSION
from .history import HistoryDatabase

FORMAT = 'thermal_pilot_backup'
MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
MAX_EXPANDED_BYTES = 1024 * 1024 * 1024
TABLES = {
    'metadata': ('key','value'),
    'observations': ('room_id','time','payload'),
    'zone_observations': ('zone_id','time','payload'),
    'forecasts': ('room_id','issued_bucket','horizon','due','payload'),
    'season_accumulators': ('season','room_id','payload'),
    'season_summaries': ('season','room_id','payload'),
}


def strict_json(raw):
    def reject(value):
        raise ValueError('Non-finite numbers are not allowed.')
    return json.loads(raw, parse_constant=reject)


def create_backup(settings, state, history_path):
    """SQLite's backup API includes committed WAL data in a consistent snapshot."""
    with tempfile.TemporaryDirectory(prefix='thermal-pilot-export-') as directory:
        snapshot = Path(directory)/'history.sqlite3'
        with closing(sqlite3.connect(history_path)) as source, closing(sqlite3.connect(snapshot)) as target:
            source.backup(target)
        database = snapshot.read_bytes()
    if len(database)>MAX_EXPANDED_BYTES-16*1024*1024:
        raise ValueError('Expanded backup is too large.')
    document = {'format':FORMAT,'format_version':1,'integration_version':VERSION,
                'created_at':datetime.now(timezone.utc).isoformat(),
                'settings':settings,'state':state,'history_sha256':hashlib.sha256(database).hexdigest()}
    output = BytesIO()
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('backup.json',json.dumps(document,allow_nan=False,ensure_ascii=False))
        archive.writestr('history.sqlite3',database)
    if output.tell()>MAX_ARCHIVE_BYTES:
        raise ValueError('Backup exceeds the 256 MiB limit.')
    return output.getvalue()


def validate_state(state):
    keys = ('models','season','zone_seasons','pump_thermal_modes','pump_reversals',
            'applied_season_targets','fingerprints','sensor_health','managed_rooms','fallback_state')
    if not isinstance(state,dict) or any(not isinstance(state.get(key),dict) for key in keys):
        raise ValueError('Invalid learning state.')
    for model in state['models'].values():
        if not isinstance(model,dict):
            raise ValueError('Invalid room model.')
        for key in ('loss','gain','samples','heated_hours','idle_hours','response'):
            if key in model and (isinstance(model[key],bool) or not isinstance(model[key],(int,float))):
                raise ValueError('Invalid model parameter.')


def prepare_backup(content, target_path):
    """Validate before touching live data; rebuild a trusted database without triggers/views."""
    if len(content)>MAX_ARCHIVE_BYTES:
        raise ValueError('Backup exceeds the 256 MiB limit.')
    try:
        with zipfile.ZipFile(BytesIO(content)) as archive:
            members=archive.infolist()
            if len(members)!=2 or {item.filename for item in members}!={'backup.json','history.sqlite3'}:
                raise ValueError('Not a ThermalPilot backup.')
            if sum(item.file_size for item in members)>MAX_EXPANDED_BYTES or archive.getinfo('backup.json').file_size>16*1024*1024:
                raise ValueError('Expanded backup is too large.')
            document=strict_json(archive.read('backup.json'))
            database=archive.read('history.sqlite3')
        if not isinstance(document,dict) or document.get('format')!=FORMAT or document.get('format_version')!=1:
            raise ValueError('Unsupported backup format.')
        if hashlib.sha256(database).hexdigest()!=document.get('history_sha256'):
            raise ValueError('History checksum does not match.')
        if not isinstance(document.get('settings'),dict):
            raise ValueError('Invalid backup settings.')
        validate_state(document.get('state'))
        # No scripts, attached databases, custom schema, views or triggers are imported.
        with tempfile.TemporaryDirectory(prefix='thermal-pilot-validate-') as directory:
            source_path=Path(directory)/'source.sqlite3';source_path.write_bytes(database)
            source=sqlite3.connect(f'{source_path.as_uri()}?mode=ro',uri=True)
            try:
                source.execute('PRAGMA trusted_schema=OFF')
                if source.execute('PRAGMA quick_check').fetchone()!=('ok',):
                    raise ValueError('History database is damaged.')
                objects=source.execute("SELECT name,type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").fetchall()
                if any(kind not in ('table','index') for _,kind in objects) or {name for name,kind in objects if kind=='table'}!=set(TABLES):
                    raise ValueError('Unsupported history schema.')
                if source.execute("SELECT value FROM metadata WHERE key='schema_version'").fetchone()!=('1',):
                    raise ValueError('Unsupported history version.')
                HistoryDatabase(target_path).initialize()
                with closing(sqlite3.connect(target_path)) as target, target:
                    for name,columns in TABLES.items():
                        if tuple(row[1] for row in source.execute(f'PRAGMA table_info({name})'))!=columns:
                            raise ValueError('Invalid history columns.')
                        target.execute(f'DELETE FROM {name}')
                        cursor=source.execute(f'SELECT {",".join(columns)} FROM {name}')
                        while rows:=cursor.fetchmany(1000):
                            if 'payload' in columns:
                                for row in rows:
                                    if not isinstance(strict_json(row[-1]),dict):raise ValueError('Invalid history record.')
                            target.executemany(f'INSERT INTO {name} VALUES ({",".join("?" for _ in columns)})',rows)
            finally:
                source.close()
        return document
    except (zipfile.BadZipFile,KeyError,TypeError,UnicodeError,sqlite3.Error,json.JSONDecodeError) as error:
        raise ValueError('Invalid or damaged ThermalPilot backup.') from error


def replace_history(source_path, target_path):
    """Transactional SQLite copy also works when the destination uses WAL."""
    with closing(sqlite3.connect(source_path)) as source, closing(sqlite3.connect(target_path)) as target:
        source.backup(target)


async def export_backup(coordinator):
    async with coordinator.backup_lock:
        return await coordinator.hass.async_add_executor_job(create_backup,
            deepcopy(coordinator.settings),deepcopy(coordinator.storage_data()),coordinator.history_db.path)


async def restore_backup(coordinator, content):
    from .config import validate
    hass=coordinator.hass
    temporary=await hass.async_add_executor_job(tempfile.TemporaryDirectory,'','thermal-pilot-import-')
    try:
        directory=temporary.name
        staged=str(Path(directory)/'restored.sqlite3')
        document=await hass.async_add_executor_job(prepare_backup,content,staged)
        settings=deepcopy(document['settings'])
        settings.update(simulation_enabled=True,live_control_confirmed=False,apply_season_setpoints=False)
        # Retain entity references on another HA installation; review them before enabling control.
        settings=validate(settings)
        async with coordinator.backup_lock:
            old_settings=deepcopy(coordinator.settings)
            old_state=deepcopy(coordinator.storage_data())
            rollback=str(Path(directory)/'rollback.sqlite3')
            await hass.async_add_executor_job(replace_history,coordinator.history_db.path,rollback)
            state=deepcopy(document['state'])
            # Old device ownership and applied targets are not current control commands.
            state['managed_rooms']={};state['applied_season_targets']={}
            coordinator.stop()
            try:
                from homeassistant.util import dt as dt_util
                await coordinator.release_managed_rooms(dt_util.utcnow(),force=True)
                await hass.async_add_executor_job(replace_history,staged,coordinator.history_db.path)
                await coordinator.store.async_save(state)
                coordinator.settings=settings
                from .air_control import AirHeatPumpControl
                coordinator.air_control=AirHeatPumpControl(hass)
                await coordinator.load()
                coordinator.previous={};coordinator.forecast=[];coordinator.forecast_updated=None
                coordinator.control.pending.clear();coordinator.control.results.clear();coordinator.control.reconciled.clear()
                coordinator.async_set_updated_data({})
                coordinator.suggested_runs={};coordinator._plan_settings=None
                hass.config_entries.async_update_entry(coordinator.entry,options=settings)
            except Exception:
                await hass.async_add_executor_job(replace_history,rollback,coordinator.history_db.path)
                await coordinator.store.async_save(old_state)
                coordinator.settings=old_settings
                await coordinator.load()
                raise
            finally:
                coordinator.listen_sources()
        await coordinator.async_request_refresh()
    finally:
        await hass.async_add_executor_job(temporary.cleanup)
    return {'restored':True,'simulation_enabled':True}
