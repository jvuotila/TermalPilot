"""Bounded local SQLite history. All calls run in HA's executor threads."""
from pathlib import Path
import json
import sqlite3
from bisect import bisect_left
from contextlib import contextmanager


class HistoryDatabase:
    def __init__(self, path):
        self.path = str(path)

    @contextmanager
    def _connect(self):
        con = sqlite3.connect(self.path, timeout=20)
        con.execute('PRAGMA journal_mode=WAL')
        try:
            with con:
                yield con
        finally:
            con.close()

    def initialize(self):
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as con:
            con.execute('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
            con.execute("INSERT OR IGNORE INTO metadata VALUES ('schema_version','1')")
            version = con.execute("SELECT value FROM metadata WHERE key='schema_version'").fetchone()[0]
            if version != '1':
                raise ValueError('Unsupported history database schema version')
            con.execute('CREATE TABLE IF NOT EXISTS observations (room_id TEXT NOT NULL, time INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(room_id,time))')
            con.execute('CREATE INDEX IF NOT EXISTS observations_time ON observations(time)')
            con.execute('CREATE TABLE IF NOT EXISTS zone_observations (zone_id TEXT NOT NULL, time INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(zone_id,time))')
            con.execute('CREATE INDEX IF NOT EXISTS zone_observations_time ON zone_observations(time)')
            con.execute('CREATE TABLE IF NOT EXISTS forecasts (room_id TEXT NOT NULL, issued_bucket INTEGER NOT NULL, horizon INTEGER NOT NULL, due REAL NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(room_id,issued_bucket,horizon))')
            con.execute('CREATE INDEX IF NOT EXISTS forecasts_due ON forecasts(due)')
            con.execute('CREATE TABLE IF NOT EXISTS season_accumulators (season TEXT NOT NULL, room_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(season,room_id))')
            con.execute('CREATE TABLE IF NOT EXISTS season_summaries (season TEXT NOT NULL, room_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(season,room_id))')
            # Recover the original collection date from retained season aggregates.
            if not con.execute("SELECT 1 FROM metadata WHERE key='collection_started_at'").fetchone():
                times=[]
                first=con.execute('SELECT MIN(time) FROM observations').fetchone()[0]
                if first is not None:times.append(first)
                for payload, in con.execute('SELECT payload FROM season_accumulators'):
                    value=json.loads(payload).get('first_time')
                    if value is not None:times.append(value)
                for payload, in con.execute('SELECT payload FROM season_summaries'):
                    value=json.loads(payload).get('statistics',{}).get('first_time')
                    if value is not None:times.append(value)
                if times:con.execute("INSERT INTO metadata VALUES ('collection_started_at',?)",(str(min(times)),))

    def append(self, rows, cutoff, season='unknown'):
        with self._connect() as con:
            if rows:
                first=min(r['time'] for r in rows)
                con.execute("INSERT OR IGNORE INTO metadata VALUES ('collection_started_at',?)",(str(first),))
            # Five-minute buckets prevent unbounded growth from manual refreshes.
            for r in rows:
                bucket = int(r['time'])//300*300
                exists = con.execute('SELECT 1 FROM observations WHERE room_id=? AND time=?',(r['room_id'],bucket)).fetchone()
                con.execute('INSERT OR REPLACE INTO observations VALUES (?,?,?)',(r['room_id'],bucket,json.dumps(r,separators=(',',':'),allow_nan=False)))
                if exists:
                    continue
                old = con.execute('SELECT payload FROM season_accumulators WHERE season=? AND room_id=?',(season,r['room_id'])).fetchone()
                stat = json.loads(old[0]) if old else {'samples':0,'temperature_sum':0.0,'temperature_squared_sum':0.0,'heating_samples':0,'idle_samples':0,'unknown_activity_samples':0,'prediction_error_sum':0.0,'prediction_samples':0,'first_time':r['time'],'last_time':r['time'],'outdoor_min':r['outdoor'],'outdoor_max':r['outdoor']}
                stat['samples'] += 1
                stat['temperature_sum'] += r['temperature']
                stat['temperature_squared_sum'] += r['temperature']**2
                stat['last_time'] = r['time']
                stat['outdoor_min'] = min(stat['outdoor_min'],r['outdoor'])
                stat['outdoor_max'] = max(stat['outdoor_max'],r['outdoor'])
                stat['heating_samples' if r['activity']==1 else 'idle_samples' if r['activity']==0 else 'unknown_activity_samples'] += 1
                if r.get('prediction') is not None:
                    stat['prediction_error_sum'] += abs(r['prediction']-r['temperature'])
                    stat['prediction_samples'] += 1
                con.execute('INSERT OR REPLACE INTO season_accumulators VALUES (?,?,?)',(season,r['room_id'],json.dumps(stat,separators=(',',':'))))
            con.execute('DELETE FROM observations WHERE time < ?', (int(cutoff),))

    def append_zones(self, rows, cutoff):
        """Keep zone identity separate from changing room membership and main room."""
        with self._connect() as con:
            for row in rows:
                con.execute('INSERT OR REPLACE INTO zone_observations VALUES (?,?,?)',
                            (row['zone_id'],int(row['time'])//300*300,json.dumps(row,separators=(',',':'),allow_nan=False)))
            con.execute('DELETE FROM zone_observations WHERE time < ?',(int(cutoff),))

    def record_forecasts(self, rooms, issued, cutoff):
        """Freeze the first forecast each hour. Later measurements never rewrite it."""
        from .model import stamp
        with self._connect() as con:
            for rid, room in rooms.items():
                plan=room.get('plan') or {}
                slots=plan.get('slots',[])
                if not slots or room.get('temperature') is None:
                    continue
                for hours in (1,3,6):
                    due=issued+hours*3600
                    left_time,left_temp=issued,room['temperature']
                    predicted=None
                    for slot in slots:
                        end=stamp(slot['end']).timestamp()
                        if left_time < due <= end:
                            predicted=left_temp+(slot['temperature']-left_temp)*(due-left_time)/(end-left_time)
                            break
                        left_time,left_temp=end,slot['temperature']
                    if predicted is None:
                        continue  # Never extrapolate beyond known forecast coverage.
                    payload={'issued':issued,'due':due,'horizon':hours,'temperature':predicted,
                             'initial_temperature':room['temperature'],'context':room.get('forecast_context'),
                             'demand':[{'start':max(issued,stamp(v['start']).timestamp()),
                                        'end':min(due,stamp(v['end']).timestamp()),
                                        'on':bool(v['predicted_demand'])} for v in slots
                                       if stamp(v['start']).timestamp()<due]}
                    con.execute('INSERT OR IGNORE INTO forecasts VALUES (?,?,?,?,?)',
                                (rid,int(issued)//3600*3600,hours,due,json.dumps(payload,allow_nan=False)))
            con.execute('DELETE FROM forecasts WHERE due < ?',(cutoff,))

    def read(self, cutoff):
        """Join frozen forecasts to later observations, allowing five-minute timing tolerance."""
        with self._connect() as con:
            all_rows=[json.loads(row[0]) for row in con.execute('SELECT payload FROM observations WHERE time >= ? ORDER BY time,room_id',(int(cutoff-6*3600-300),))]
            zone_rows=[json.loads(row[0]) for row in con.execute('SELECT payload FROM zone_observations WHERE time >= ? ORDER BY time,zone_id',(int(cutoff),))]
            forecasts=[(rid,json.loads(payload)) for rid,payload in con.execute('SELECT room_id,payload FROM forecasts WHERE due >= ? ORDER BY due',(cutoff,))]
        grouped={}
        for row in all_rows:
            grouped.setdefault(row['room_id'],[]).append(row)
        times={rid:[r['time'] for r in rows] for rid,rows in grouped.items()}
        for rid,f in forecasts:
            rows=grouped.get(rid,[])
            if not rows:continue
            index=bisect_left(times[rid],f['due'])
            candidates=[i for i in (index-1,index) if 0<=i<len(rows)]
            index=min(candidates,key=lambda i:abs(rows[i]['time']-f['due']))
            actual=rows[index]
            if abs(actual['time']-f['due'])>300 or actual['time']<f['issued'] or actual.get('forecast_context')!=f.get('context'):
                continue
            history=rows[bisect_left(times[rid],f['issued']):index+1]
            complete=bool(history) and history[0]['time']-f['issued']<=900 and all(b['time']-a['time']<=900 for a,b in zip(history,history[1:]))
            comparisons=[]
            for observed in history:
                expected=next((v['on'] for v in f['demand'] if v['start']<=observed['time']<v['end']),None)
                if expected is not None:
                    if observed.get('activity') is None or observed.get('forecast_context')!=f.get('context'):complete=False
                    else:comparisons.append(bool(observed['activity'])==expected)
            match=sum(comparisons)/len(comparisons) if complete and comparisons else None
            key=f"forecast_{f['horizon']}h"
            actual[key]=f['temperature']
            actual[key+'_details']={'issued':f['issued'],'due':f['due'],
                                    'error':abs(actual['temperature']-f['temperature']),
                                    'persistence_error':abs(actual['temperature']-f['initial_temperature']),
                                    'heating_match':match}
        return sorted([r for r in all_rows if r['time']>=cutoff]+zone_rows,key=lambda r:(r['time'],r['room_id']))

    def forecast_accuracy(self, cutoff):
        results={}
        for row in self.read(cutoff):
            for hours in (1,3,6):
                detail=row.get(f'forecast_{hours}h_details')
                if not detail:continue
                stat=results.setdefault(row['room_id'],{}).setdefault(str(hours),{'count':0,'error_sum':0,'persistence_sum':0,'similar_heating_count':0,'similar_error_sum':0})
                stat['count']+=1;stat['error_sum']+=detail['error'];stat['persistence_sum']+=detail['persistence_error']
                if detail['heating_match'] is not None and detail['heating_match']>=.9:
                    stat['similar_heating_count']+=1;stat['similar_error_sum']+=detail['error']
        for room in results.values():
            for stat in room.values():
                stat['mae']=stat.pop('error_sum')/stat['count']
                stat['persistence_mae']=stat.pop('persistence_sum')/stat['count']
                stat['similar_heating_mae']=stat.pop('similar_error_sum')/stat['similar_heating_count'] if stat['similar_heating_count'] else None
        return results

    def size(self):
        with self._connect() as con:
            count = con.execute('SELECT COUNT(*) FROM observations').fetchone()[0]
            first=con.execute("SELECT value FROM metadata WHERE key='collection_started_at'").fetchone()
            started_at=float(first[0]) if first else None
        files = [Path(self.path), Path(self.path+'-wal'), Path(self.path+'-shm')]
        return {'rows':count,'started_at':started_at, 'bytes':sum(p.stat().st_size for p in files if p.exists())}

    def compact_season(self, season, models, fingerprints, keep_since):
        """Keep sufficient learning statistics and full-season aggregates, not raw rows.

VACUUM runs only on season transition, off HA's event loop. Model state in
HA Store remains the active warm-start source; archive snapshots are auditable.
"""
        with self._connect() as con:
            stats = {rid:json.loads(payload) for rid,payload in con.execute('SELECT room_id,payload FROM season_accumulators WHERE season=?',(season,))}
            for rid, model in models.items():
                snapshot = {'season':season,'room_id':rid,'model':model,'mapping_fingerprint':fingerprints.get(rid),'statistics':stats.get(rid,{})}
                con.execute('INSERT OR REPLACE INTO season_summaries VALUES (?,?,?)',(season,rid,json.dumps(snapshot,separators=(',',':'),allow_nan=False)))
            con.execute('DELETE FROM observations WHERE time < ?',(int(keep_since),))
        with self._connect() as con:
            con.execute('VACUUM')

    def summaries(self):
        with self._connect() as con:
            return [json.loads(r[0]) for r in con.execute('SELECT payload FROM season_summaries ORDER BY season DESC,room_id')]
