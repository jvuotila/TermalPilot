"""Bounded local SQLite history. All calls run in HA's executor threads."""
from pathlib import Path
import json
import sqlite3
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

    def read(self, cutoff):
        with self._connect() as con:
            return [json.loads(row[0]) for row in con.execute('SELECT payload FROM observations WHERE time >= ? ORDER BY time,room_id', (int(cutoff),))]

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
