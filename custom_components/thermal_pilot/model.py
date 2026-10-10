"""Independent, dependency-free hourly planner and conservative online model.

No device commands exist in this module. A low-pass heating response approximates
slab delay; it is not a physical measurement of the slab's stored energy.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import math
from .const import DEFAULTS


def number(value, default=None):
    try:
        result = float(value)
        return result if math.isfinite(result) else default
    except (ValueError, TypeError):
        return default


def stamp(value):
    try:
        d = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return d if d.tzinfo else None
    except (ValueError, TypeError):
        return None


@dataclass(frozen=True)
class Slot:
    start: datetime
    end: datetime
    price: float


def price_slots(attributes, config, now, tz):
    """Normalize timestamped prices to elapsed UTC hours; reject ambiguous lists.

Raw arrays are preferred and handle 23/25-hour days. List-only sources are
accepted solely on regular 24-hour days. Gaps stop the usable horizon.
"""
    factor = 100.0 if config['price_unit'] == '€/kWh' else 1.0
    raw = []
    for key in ('raw_today', 'raw_tomorrow'):
        raw.extend(attributes.get(key) or [])
    segments = []
    if raw:
        for item in raw:
            if not isinstance(item, dict):
                raise ValueError('Each raw price row must be an object.')
            start, end = stamp(item.get('start')), stamp(item.get('end'))
            value = number(item.get('value'))
            if start is None or end is None or value is None or end <= start:
                raise ValueError('Invalid price or timestamp in source list.')
            segments.append((start.astimezone(timezone.utc), end.astimezone(timezone.utc), value * factor))
    else:
        step = 15 if config['price_format'] == 'quarterly' else 60
        for offset, key in enumerate(('today', 'tomorrow')):
            values = attributes.get(key) or []
            if not values:
                continue
            day = now.astimezone(tz).date() + timedelta(days=offset)
            local_start = datetime.combine(day, datetime.min.time(), tzinfo=tz)
            local_end = datetime.combine(day + timedelta(days=1), datetime.min.time(), tzinfo=tz)
            start, end = local_start.astimezone(timezone.utc), local_end.astimezone(timezone.utc)
            if (end-start).total_seconds() != 86400:
                raise ValueError('DST transition days require timestamped raw_today/raw_tomorrow data.')
            if len(values) != 24 * 60 // step:
                raise ValueError(f'{key}: price count does not match the selected source resolution.')
            for i, value in enumerate(values):
                value = number(value)
                if value is None:
                    raise ValueError('Price list contains a missing or invalid price.')
                a = start + timedelta(minutes=i*step)
                segments.append((a, a+timedelta(minutes=step), value*factor))
    segments.sort(key=lambda s: s[0])
    for a, b in zip(segments, segments[1:]):
        if a[1] > b[0]:
            raise ValueError('Price intervals contain overlapping timestamps.')
    step = 60 if config['pricing_mode'] == 'hourly' else 15
    first = now.astimezone(timezone.utc).replace(minute=(now.minute//step)*step, second=0, microsecond=0)
    output = []
    for i in range(config['horizon_hours']*60//step):
        a = first + timedelta(minutes=i*step)
        b = a + timedelta(minutes=step)
        total = duration = 0.0
        for s, e, value in segments:
            seconds = max(0.0, (min(b, e)-max(a, s)).total_seconds())
            total += seconds*value
            duration += seconds
        if duration < step*60-1:
            break
        price = total / duration
        output.append(Slot(a, b, price))
    return output


def curve_hours(room, outdoor):
    room = {**DEFAULTS, **room}
    fraction = (room['curve_warm_temp']-outdoor)/(room['curve_warm_temp']-room['curve_cold_temp'])
    return room['curve_min_hours'] + max(0, min(1, fraction))*(room['curve_max_hours']-room['curve_min_hours'])


def initial_model(room):
    room = {**DEFAULTS, **room}
    # At the cold design point, full heating balances daily losses at curve_max_hours.
    loss = 0.007
    span = room['curve_max_hours']-room['curve_min_hours']
    if span > .1:
        gain = loss*24*(room['curve_warm_temp']-room['curve_cold_temp'])/span
        base_gain = loss*(room['baseline']-room['curve_warm_temp'])-gain*room['curve_min_hours']/24
    else:
        gain = loss*(room['baseline']-room['curve_cold_temp'])*24/room['curve_max_hours']
        base_gain = 0.0
    base_gain = max(0.0,base_gain)
    return {'loss': loss, 'gain': gain, 'base_gain':base_gain, 'samples': 0, 'heated_hours': 0.0,
            'idle_hours': 0.0, 'xx': 0.0, 'xy': 0.0, 'yy': 0.0,
            'xz': 0.0, 'yz': 0.0, 'response': 0.0, 'mae': None}


def response_step(response, heating, hours, lag):
    decay = math.exp(-hours/lag)
    end = heating + (response-heating)*decay
    average = heating + (response-heating)*lag*(1-decay)/hours
    return end, average


def learn(model, room, previous, current, enabled=True):
    """Learn only with observed activity and uninterrupted short intervals.

Returns a one-step validation prediction even when learning is paused. No
multi-day counterfactual cost savings are asserted from these observations.
"""
    room = {**DEFAULTS, **room}
    dt = (current['time']-previous['time'])/3600
    if not 0.05 <= dt <= 0.5 or previous.get('activity') is None:
        return None
    response, average = response_step(model['response'], previous['activity'], dt, room['lag_hours'])
    x = previous['outdoor']-previous['temperature']
    y = average * previous.get('water_factor', 1.0)
    prediction = previous['temperature'] + dt*(model['loss']*x+model['gain']*y+model.get('base_gain',0))
    model['response'] = response
    error = abs(prediction-current['temperature'])
    model['mae'] = error if model['mae'] is None else .95*model['mae']+.05*error
    if not enabled or previous.get('excluded') or current.get('excluded'):
        return prediction
    z = (current['temperature']-previous['temperature'])/dt-model.get('base_gain',0)
    if abs(z) > 2:
        return prediction
    decay = .999
    for key, value in (('xx', x*x), ('xy', x*y), ('yy', y*y), ('xz', x*z), ('yz', y*z)):
        model[key] = decay*model[key]+value*dt
    model['samples'] += 1
    model['heated_hours'] += dt*previous['activity']
    model['idle_hours'] += dt*(1-previous['activity'])
    # Ridge regularization toward design estimates, plus evidence from both states.
    prior = initial_model(room)
    xx, yy, xy = model['xx']+200, model['yy']+20, model['xy']
    xz, yz = model['xz']+200*prior['loss'], model['yz']+20*prior['gain']
    det = xx*yy-xy*xy
    if model['heated_hours'] >= 12 and model['idle_hours'] >= 12 and det > 1:
        loss, gain = (xz*yy-yz*xy)/det, (yz*xx-xz*xy)/det
        if 0.001 <= loss <= 0.05 and .03 <= gain <= 3:
            model['loss'] = .98*model['loss']+.02*loss
            model['gain'] = .98*model['gain']+.02*gain
    return prediction


def thermostat_timing(rows, settings, baseline, now):
    """Separate intended heat-delivery sessions from advance thermostat commands."""
    sessions = []
    for row in rows:
        if not row['heat']:
            continue
        if sessions and sessions[-1]['end'] == row['start']:
            sessions[-1]['end'] = row['end']
        else:
            sessions.append({'start':row['start'], 'end':row['end']})
    windows = []
    for session in sessions:
        start = stamp(session['start']) - timedelta(minutes=settings['start_offset_minutes'])
        end = stamp(session['end']) - timedelta(minutes=settings['stop_offset_minutes'])
        if end <= start:
            continue  # A clipped session may already be past its closing command.
        if windows and start <= stamp(windows[-1]['end']):
            windows[-1]['end'] = max(stamp(windows[-1]['end']),end).isoformat()
        else:
            windows.append({'start':start.isoformat(), 'end':end.isoformat()})
    boosted = min(settings['maximum'],baseline+settings['boost'])
    reduced = baseline-settings['setback']
    commands = [command for window in windows for command in (
        {'time':window['start'],'setpoint':boosted,'action':'raise'},
        {'time':window['end'],'setpoint':reduced,'action':'lower'})]
    timing = {'sessions':sessions,'thermostat_windows':windows,'commands':commands,
              'boosted_setpoint':boosted,'reduced_setpoint':reduced}
    return {**timing, **thermostat_state(timing,now)}


def thermostat_state(timing, now):
    active = any(stamp(window['start']) <= now < stamp(window['end']) for window in timing['thermostat_windows'])
    return {'heat':active, 'setpoint':round(timing['boosted_setpoint'] if active else timing['reduced_setpoint'],2)}


def plan(room, model, temperature, outdoor, slots, now, baseline, water_factor=1.0, fireplace=False):
    """Beam-search rolling horizon. Comfort violations dominate monetary ranking.

Not an exact optimizer; price cost is normalized to one kW of heating input.
The first slot uses only its remaining duration. Terminal reserve penalizes
ending the known-price horizon with insufficient estimated thermal reserve.
"""
    room = {**DEFAULTS, **room}
    if not slots:
        return None
    loss, gain = model['loss'], model['gain']
    if fireplace:
        loss *= 1 - room['fireplace_reduction']/100
    # violation-degree-hours, objective, temperature, response, last_on, path
    minimum_run = room.get('minimum_run_minutes',60)/60
    last_on = room.get('previous_suggested_heat',False)
    run_hours = room.get('previous_run_hours',0.0) if last_on else 0.0
    beam = [(0.0, 0.0, temperature, model['response'], int(last_on), run_hours, [])]
    for i, slot in enumerate(slots):
        hours = (slot.end-max(now, slot.start)).total_seconds()/3600
        if hours <= 0:
            continue
        candidates = []
        for violation, cost, temp, response, last, run, path in beam:
            for on in (0, 1):
                if not on and last and run < minimum_run-1e-6:
                    continue
                if on and not last and (slots[-1].end-max(now,slot.start)).total_seconds()/3600 < minimum_run:
                    continue
                # Demand proxy: real thermostats may call for heat in setback too.
                request = min(room['maximum'], baseline+room['boost']) if on else baseline-room['setback']
                heating = 1.0 if temp < request else 0.0
                r, average = response_step(response, heating, hours, room['lag_hours'])
                predicted = temp+hours*(loss*(outdoor[i]-temp)+gain*water_factor*average+model.get('base_gain',0))
                below, above = max(0, room['minimum']-predicted), max(0, predicted-room['maximum'])
                v = violation+hours*(below+above)
                c = cost+slot.price*heating*hours + .3*abs(on-last) + .15*hours*(predicted-baseline)**2
                row = {'start': max(slot.start, now).isoformat(), 'end': slot.end.isoformat(),
                       'price': round(slot.price, 3), 'outdoor': round(outdoor[i], 2),
                       'heat': bool(on), 'predicted_demand': bool(heating),
                       'temperature': round(predicted, 3), 'setpoint': round(request, 2)}
                candidates.append((v, c, predicted, r, on, min(minimum_run,(run if last else 0)+hours) if on else 0.0, path+[row]))
        # Preserve different thermal states; only retain the best per bucket.
        unique = {}
        for candidate in sorted(candidates, key=lambda c: (c[0], c[1])):
            key = (round(candidate[2]*20), round(candidate[3]*20), candidate[4], round(candidate[5]*4))
            if key not in unique:
                unique[key] = candidate
        beam = list(unique.values())[:80]
    def terminal(candidate):
        v, c, temp, response, last, run, path = candidate
        reserve = min(12, room.get('terminal_reserve_hours', 6))
        _, average = response_step(response, 0, max(.1, reserve), room['lag_hours'])
        final = temp+reserve*(loss*(outdoor[-1]-temp)+gain*water_factor*average+model.get('base_gain',0))
        return (v+max(0, room['minimum']-final)*reserve, c)
    best = min(beam, key=terminal)
    rows = best[-1]
    if not rows:
        return None
    risk = best[0] > .01 or terminal(best)[0] > .01
    timing = thermostat_timing(rows,room,baseline,now)
    return {'slots': rows, 'scheduled_heat':rows[0]['heat'], **timing,
            'reason': ('Temperature limit risk: review model assumptions and heating capacity.' if risk else
                       'Heat storage or a bridging run ahead of predicted cooling.' if rows[0]['heat'] else
                       'Estimated stored heat is sufficient; no setpoint boost is suggested now.'),
            'comfort_risk': risk, 'violation_degree_hours': round(best[0], 3),
            'known_price_hours': round(sum((stamp(r['end'])-stamp(r['start'])).total_seconds()/3600 for r in rows),2), 'curve_hours': round(curve_hours(room, min(outdoor)), 1)}


def collection_state(previous, outdoor, timestamp, config):
    """Seasonal collection gate with exponential smoothing and hysteresis."""
    state = dict(previous or {})
    old_time, average = state.get('time'), state.get('average')
    if outdoor is not None:
        if average is None or old_time is None or timestamp-old_time > 12*3600:
            average = outdoor
        else:
            alpha = 1-math.exp(-max(0,timestamp-old_time)/(3600*config['season_smoothing_hours']))
            average += alpha*(outdoor-average)
        active = state.get('active', average <= config['season_start_temperature'])
        if average <= config['season_start_temperature']:
            active = True
        elif average >= config['season_stop_temperature']:
            active = False
        state.update(time=timestamp,average=average,active=active)
    mode = config['collection_mode']
    state['collecting'] = bool(outdoor is not None and (mode in ('manual','always') or mode=='automatic' and state.get('active',False)))
    return state
