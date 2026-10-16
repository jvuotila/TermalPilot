"""Backward-compatible backup contract, independent of application release numbers.

Keep version-1 readers and fixtures when adding a new schema. Register each
one-version migration; never infer compatibility from the integration version.
"""
from copy import deepcopy
from .config import SOURCE_FIELDS, ROOM_FIELDS, ZONE_FIELDS, stored_settings, validate
from .model import initial_model
from .config import resolved_rooms, zone_rooms, learning_fingerprint

FORMAT_VERSION = 1
SETTINGS_VERSION = 1
LEARNING_VERSION = 1
HISTORY_VERSION = 1

# Frozen source schemas. Adding a current database column must not change these.
HISTORY_SCHEMAS = {1: {
    'metadata': ('key','value'),
    'observations': ('room_id','time','payload'),
    'zone_observations': ('zone_id','time','payload'),
    'forecasts': ('room_id','issued_bucket','horizon','due','payload'),
    'season_accumulators': ('season','room_id','payload'),
    'season_summaries': ('season','room_id','payload'),
}}
STATE_DEFAULTS = {key:{} for key in ('season','zone_seasons','pump_thermal_modes',
    'pump_reversals','applied_season_targets','fingerprints','sensor_health','managed_rooms','fallback_state')}

# A breaking change adds e.g. SETTINGS_MIGRATIONS[1] = migrate_settings_1_to_2
# and increments SETTINGS_VERSION. Old readers remain supported.
SETTINGS_MIGRATIONS = {}
LEARNING_MIGRATIONS = {}
HISTORY_MIGRATIONS = {}


def migrate_steps(value, source, target, migrations, label):
    if type(source) is not int or not 1 <= source <= target:
        raise ValueError(f'Unsupported {label} backup version.')
    result=deepcopy(value)
    for version in range(source,target):
        migrate=migrations.get(version)
        if migrate is None:
            raise ValueError(f'Missing {label} backup migration.')
        result=migrate(result)
    return result


def safe_missing_fields(raw, fields):
    """A new device selector or control opt-in must never become active on restore."""
    result=deepcopy(raw)
    for key,_,kind,*_ in fields:
        if key in result:
            continue
        if kind=='bool':
            result[key]=key=='simulation_enabled'
        elif kind.startswith('entities:'):
            result[key]=[]
        elif kind.split(',')[0] in ('sensor','binary_sensor','switch','climate','weather'):
            result[key]=''
    return result


def normalize_settings(raw):
    if not isinstance(raw,dict) or not isinstance(raw.get('rooms'),list):
        raise ValueError('Invalid backup settings.')
    zones=raw.get('heating_zones',[])
    if not isinstance(zones,list):
        raise ValueError('Invalid heating zone settings.')
    value=safe_missing_fields(raw,SOURCE_FIELDS)
    for key,items,fields in (('rooms',raw['rooms'],ROOM_FIELDS),('heating_zones',zones,ZONE_FIELDS)):
        if any(not isinstance(item,dict) or not item.get('id') for item in items):
            # Normal settings creation may generate IDs. A restore must never do that.
            raise ValueError('Backup rooms and zones must retain their original identifiers.')
        value[key]=[safe_missing_fields(item,fields) for item in items]
    # Keep existing legacy conversions (solar settings, door sensors, old reductions).
    value=stored_settings({},value)
    value.update(simulation_enabled=True,live_control_confirmed=False,apply_season_setpoints=False)
    return validate(value)


def normalize_learning(raw, settings):
    if not isinstance(raw,dict) or not isinstance(raw.get('models'),dict):
        raise ValueError('Invalid learning state.')
    state=deepcopy(raw)
    for key,default in STATE_DEFAULTS.items():
        state.setdefault(key,deepcopy(default))
        if not isinstance(state[key],dict):
            raise ValueError('Invalid learning state.')
    for model in state['models'].values():
        if not isinstance(model,dict):
            raise ValueError('Invalid room model.')
        for key in ('loss','gain','samples','heated_hours','idle_hours','response'):
            if key in model and (isinstance(model[key],bool) or not isinstance(model[key],(int,float))):
                raise ValueError('Invalid model parameter.')
    for room in resolved_rooms(settings)+zone_rooms(settings):
        model=state['models'].get(room['id'])
        if model is None:
            continue
        # Add new model fields; never overwrite learned parameters/evidence.
        defaults=initial_model(room)
        defaults.update(model)
        state['models'][room['id']]=defaults
        if 'fingerprints' not in raw:
            state['fingerprints'][room['id']]=learning_fingerprint(room,settings)
    return state


def migrate_document(raw):
    if not isinstance(raw,dict) or type(raw.get('format_version')) is not int or raw['format_version']!=FORMAT_VERSION:
        raise ValueError('Unsupported backup format.')
    document=deepcopy(raw)
    # Released v0.9.33 archives have no component versions; they are schema 1.
    source_settings=raw.get('settings_version',1)
    source_learning=raw.get('learning_version',1)
    source_history=raw.get('history_version',1)
    document['settings']=normalize_settings(migrate_steps(raw.get('settings'),source_settings,SETTINGS_VERSION,SETTINGS_MIGRATIONS,'settings'))
    document['state']=normalize_learning(migrate_steps(raw.get('state'),source_learning,LEARNING_VERSION,LEARNING_MIGRATIONS,'learning'),document['settings'])
    if type(source_history) is not int or source_history not in HISTORY_SCHEMAS or source_history>HISTORY_VERSION:
        raise ValueError('Unsupported history backup version.')
    document.update(settings_version=SETTINGS_VERSION,learning_version=LEARNING_VERSION,history_version=source_history)
    return document


def migrate_history(connection, source_version):
    """Run only integration-owned SQL on the sanitized staging database."""
    for version in range(source_version,HISTORY_VERSION):
        migration=HISTORY_MIGRATIONS.get(version)
        if migration is None:
            raise ValueError('Missing history backup migration.')
        migration(connection)
        connection.execute("UPDATE metadata SET value=? WHERE key='schema_version'",(str(version+1),))
