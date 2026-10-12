"""Independent, dependency-free hourly planner and conservative online model.

No device commands exist in this module. A low-pass heating response approximates
slab delay; it is not a physical measurement of the slab's stored energy.
"""
from dataclasses import dataclass
from datetime import date as date_type, datetime, timedelta, timezone
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
accepted solely on regular 24-hour days, with their interval detected from
    24 or 96 entries per day. Gaps stop the usable horizon.
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
            if not isinstance(values, (list, tuple)) or len(values) not in (24, 96):
                raise ValueError(f'{key}: expected 24 hourly or 96 quarter-hour prices for a complete day.')
            step = 60 if len(values) == 24 else 15
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
    last_available = max((end for _, end, _ in segments), default=first)
    intervals = max(0, math.ceil((last_available-first).total_seconds()/(step*60)))
    for i in range(intervals):
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


def price_forecast_reserve(attributes, confirmed_end, base_hours=6):
    """Use relative price trends only; raw predictions never become payable prices.

An expensive next-six-hour period compared with the following day increases
thermal reserve at the end of confirmed prices. Missing forecasts leave the
ordinary reserve unchanged. Only the next day matters for this bounded signal.
"""
    points={}
    for row in attributes.get('forecast') or []:
        if not isinstance(row,dict):continue
        raw=row.get('timestamp');moment=stamp(raw)
        numeric=number(raw)
        if moment is None and numeric is not None:
            try:moment=datetime.fromtimestamp(numeric/1000 if numeric>1e11 else numeric,timezone.utc)
            except (ValueError,OverflowError,OSError):continue
        value=number(row.get('value'))
        if moment is not None and value is not None:
            points[moment.timestamp()]=value
    start=confirmed_end.timestamp()
    future=sorted((t,v) for t,v in points.items() if start<=t<start+24*3600)
    if len(future)<12 or future[0][0]-start>3600 or future[-1][0]<start+18*3600 or any(b[0]-a[0]>3600 for a,b in zip(future,future[1:])):
        return {'reserve_hours':base_hours,'available':False,'reason':'No continuous next-day price forecast beyond confirmed prices.'}
    near=[v for t,v in future if t<start+6*3600]
    if not near:
        return {'reserve_hours':base_hours,'available':False,'reason':'No near-term forecast prices.'}
    values=sorted(v for _,v in future);spread=values[-1]-values[0]
    percentile=sum(v<=sum(near)/len(near) for v in values)/len(values) if spread>1e-9 else .5
    reserve=max(base_hours,12 if percentile>=.8 else 9 if percentile>=.65 else base_hours)
    return {'reserve_hours':reserve,'available':True,
            'reason':'Expensive period forecast after confirmed prices; extra heat reserve considered.' if reserve>base_hours else 'Forecast does not call for extra heat reserve.'}


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


def heat_retention(model):
    """Comparable modeled cooling with identical reference conditions, not energy efficiency.

Use loss alone: 20°C indoors, -10°C outdoors, no heating, residual response
or background gains. Effective loss includes both heat leakage and thermal mass.
"""
    loss=number(model.get('loss'))
    if loss is None or loss<=0:
        return None
    drop=30*(-math.expm1(-loss*6))
    hours=-math.log(29/30)/loss
    return {'drop_6h':round(drop,3),'hours_per_degree':round(hours,2),
            'indoor':20,'outdoor':-10,'heating_hours':round(model.get('heated_hours',0),1),
            'idle_hours':round(model.get('idle_hours',0),1),
            'updated':model.get('parameter_updates',0)>0 or ('parameter_updates' not in model and abs(loss-.007)>1e-9 and model.get('heated_hours',0)>=12 and model.get('idle_hours',0)>=12)}


def learning_progress(model, now):
    """Initial evidence coverage and ETA, never a readiness-to-control claim."""
    heating=max(0,model.get('heated_hours',0));idle=max(0,model.get('idle_hours',0))
    remaining_heat=max(0,12-heating);remaining_idle=max(0,12-idle)
    percent=100*(min(12,heating)+min(12,idle))/24
    rates=[row for row in model.get('learning_rates',[]) if row['time']>=now.timestamp()-7*86400]
    since=model.get('learning_rate_since')
    elapsed=now.timestamp()-max(since,now.timestamp()-7*86400) if since is not None else 0
    eta=None
    if remaining_heat==0 and remaining_idle==0:
        eta=0
    elif elapsed>=86400:
        heat_rate=sum(row['heat'] for row in rates)/(elapsed/86400)
        idle_rate=sum(row['idle'] for row in rates)/(elapsed/86400)
        if (not remaining_heat or heat_rate>0) and (not remaining_idle or idle_rate>0):
            eta=round(max(remaining_heat/heat_rate if remaining_heat else 0,
                          remaining_idle/idle_rate if remaining_idle else 0),1)
    return {'percent':round(percent,1),'heating_hours':round(heating,1),
            'idle_hours':round(idle,1),'required_hours_each':12,
            'initial_complete':remaining_heat==0 and remaining_idle==0,
            'estimated_days_to_initial':eta,
            'estimated_initial_completion':(now+timedelta(days=eta)).isoformat() if eta is not None and (remaining_heat or remaining_idle) else None,
            'rate_history_hours':round(elapsed/3600,1)}


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
    model.setdefault('learning_rate_since',previous['time'])
    bucket=math.floor(previous['time']/3600)*3600
    rates=[row for row in model.get('learning_rates',[]) if row['time']>=current['time']-7*86400]
    row=next((row for row in rates if row['time']==bucket),None)
    if row is None:
        row={'time':bucket,'heat':0.0,'idle':0.0};rates.append(row)
    row['heat']+=dt*previous['activity'];row['idle']+=dt*(1-previous['activity'])
    model['learning_rates']=rates
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
            model['parameter_updates']=model.get('parameter_updates',0)+1
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
    committed = settings.get('committed_session')
    if committed:
        start, end = stamp(committed['start']), stamp(committed['end'])
        # Rows are clipped to now; retain the original start for advance commands.
        for session in sessions:
            if stamp(session['start']) < end and stamp(session['end']) > start:
                session['start'] = min(start,stamp(session['start'])).isoformat()
                break
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
    reduced = max(settings['minimum'],baseline+settings['setback'])
    explicit_modes=any('mode' in row for row in rows)
    default_mode='normal' if explicit_modes else 'reduced'
    targets={'boost':boosted,'reduced':reduced,'normal':baseline}
    events={}
    for row in rows:
        if not row['heat']:
            events[stamp(row['start'])]=row.get('mode','reduced')
    for window in windows:
        end=stamp(window['end'])
        following=next((row for row in rows if not row['heat'] and stamp(row['start'])>=end),None)
        events[end]='normal' if explicit_modes else following.get('mode','reduced') if following else default_mode
        events[stamp(window['start'])]='boost'
    if explicit_modes and rows:
        events[stamp(rows[-1]['end'])]='normal'
    commands=[];previous=default_mode
    for moment,mode in sorted(events.items()):
        if any(stamp(window['start'])<=moment<stamp(window['end']) for window in windows):
            mode='boost'
        if mode==previous:continue
        commands.append({'time':moment.isoformat(),'setpoint':round(targets[mode],2),
                         'action':{'boost':'raise','reduced':'lower','normal':'restore'}[mode],'mode':mode})
        previous=mode
    timing = {'sessions':sessions,'thermostat_windows':windows,'commands':commands,
              'boosted_setpoint':boosted,'reduced_setpoint':reduced,'normal_setpoint':baseline,
              'default_mode':default_mode}
    return {**timing, **thermostat_state(timing,now)}


def thermostat_state(timing, now):
    active = any(stamp(window['start']) <= now < stamp(window['end']) for window in timing['thermostat_windows'])
    if 'default_mode' not in timing:
        return {'heat':active,'mode':'boost' if active else 'reduced',
                'setpoint':round(timing['boosted_setpoint'] if active else timing['reduced_setpoint'],2)}
    mode=timing['default_mode']
    for command in timing['commands']:
        if stamp(command['time'])<=now:mode=command['mode']
    target={'boost':timing['boosted_setpoint'],'reduced':timing['reduced_setpoint'],'normal':timing['normal_setpoint']}[mode]
    return {'heat':mode=='boost','mode':mode,'setpoint':round(target,2)}


def plan(room, model, temperature, outdoor, slots, now, baseline, water_factor=1.0, fireplace=False):
    """Beam-search rolling horizon. Safety limits, room comfort, then price savings.

Not an exact optimizer; price cost is normalized to one kW of heating input.
The first slot uses only its remaining duration. Terminal reserve penalizes
ending the known-price horizon with insufficient estimated thermal reserve.
"""
    room = {**DEFAULTS, **room}
    if not slots:
        return None
    committed = room.get('committed_session')
    committed_start = stamp(committed['start']) if committed else None
    committed_end = stamp(committed['end']) if committed else None
    loss, gain = model['loss'], model['gain']
    if fireplace:
        loss *= 1 + room['fireplace_reduction']/100
    # safety violation, target shortfall, objective, temperature, response, last_on, run, path
    minimum_run = room.get('minimum_run_minutes',60)/60
    last_on = room.get('previous_suggested_heat',False)
    run_hours = room.get('previous_run_hours',0.0) if last_on else 0.0
    previous_mode=room.get('previous_control_mode','boost' if last_on else 'normal')
    initial_mode={'normal':0,'reduced':1,'boost':2}.get(previous_mode,0)
    known_prices=sorted(slot.price for slot in slots)
    high_price=(known_prices[(len(known_prices)-1)//2]+known_prices[len(known_prices)//2])/2
    reduction_available=bool(room.get('reduction_available',previous_mode in ('boost','reduced')))
    beam = [(0.0, 0.0, 0.0, temperature, model['response'], initial_mode, run_hours, reduction_available, [])]
    for i, slot in enumerate(slots):
        hours = (slot.end-max(now, slot.start)).total_seconds()/3600
        if hours <= 0:
            continue
        candidates = []
        for violation, shortfall, cost, temp, response, last, run, credit, path in beam:
            for mode in (0,1,2):
                on=mode==2
                if mode==1 and (not credit or last==2 or response<=.05 or slot.price<=high_price):
                    continue  # Reduction is temporary after boost, with warmth and expensive prices.
                if committed_start is not None and slot.end > committed_start and max(now,slot.start) < committed_end and not on:
                    continue  # A published session has already begun its valve-opening window.
                if not on and last==2 and run < minimum_run-1e-6:
                    continue
                if on and last!=2 and temp > room['minimum'] and (slots[-1].end-max(now,slot.start)).total_seconds()/3600 < minimum_run:
                    continue
                if not on and temp <= room['minimum']:
                    continue  # Restore heat at the absolute lower limit, regardless of price.
                # Demand proxy: real thermostats may call for heat in setback too.
                request = min(room['maximum'],baseline+room['boost']) if on else max(room['minimum'],baseline+room['setback']) if mode==1 else baseline
                heating = 1.0 if temp < request else 0.0
                r, average = response_step(response, heating, hours, room['lag_hours'])
                predicted = temp+hours*(loss*(outdoor[i]-temp)+gain*water_factor*average+model.get('base_gain',0))
                if mode==1 and predicted<baseline:
                    continue  # Stored warmth must carry the room toward its comfort target.
                below, above = max(0, room['minimum']-predicted), max(0, predicted-room['maximum'])
                v = violation+hours*(below+above)
                deficit = shortfall+hours*max(0,baseline-predicted)
                c = cost+slot.price*heating*hours + .3*abs(on-(last==2)) + .02*(mode!=last) + .15*hours*(predicted-baseline)**2 - (.03*hours if mode==1 else 0)
                row = {'start': max(slot.start, now).isoformat(), 'end': slot.end.isoformat(),
                       'price': round(slot.price, 3), 'outdoor': round(outdoor[i], 2),
                       'heat': bool(on), 'mode':('normal','reduced','boost')[mode],
                       'reduction_available':bool(on or (credit and predicted>=baseline and r>.05)), 'predicted_demand': bool(heating),
                       'temperature': round(predicted, 3), 'setpoint': round(request, 2)}
                candidates.append((v, deficit, c, predicted, r, mode, min(minimum_run,(run if last==2 else 0)+hours) if on else 0.0, row['reduction_available'], path+[row]))
        # Preserve different thermal states; only retain the best per bucket.
        unique = {}
        for candidate in sorted(candidates, key=lambda c: (round(c[0],6),round(c[1],6),c[2])):
            key = (round(candidate[3]*20), round(candidate[4]*20), candidate[5], round(candidate[6]*4),candidate[7])
            if key not in unique:
                unique[key] = candidate
        beam = list(unique.values())[:80]
    def terminal(candidate):
        v, deficit, c, temp, response, last, run, credit, path = candidate
        reserve = min(12, room.get('terminal_reserve_hours', 6))
        _, average = response_step(response, 0, max(.1, reserve), room['lag_hours'])
        final = temp+reserve*(loss*(outdoor[-1]-temp)+gain*water_factor*average+model.get('base_gain',0))
        return (round(v+max(0, room['minimum']-final)*reserve,6),round(deficit+max(0,baseline-final)*reserve,6),c)
    best = min(beam, key=terminal)
    rows = best[-1]
    if not rows:
        return None
    risk = best[0] > .01 or terminal(best)[0] > .01
    timing = thermostat_timing(rows,room,baseline,now)
    forecast_minimum=min(row['temperature'] for row in rows)
    forecast_maximum=max(row['temperature'] for row in rows)
    suggested_hours=sum((stamp(row['end'])-stamp(row['start'])).total_seconds()/3600 for row in rows if row['heat'])
    demand_hours=sum((stamp(row['end'])-stamp(row['start'])).total_seconds()/3600 for row in rows if row['predicted_demand'])
    explanation=('No boost planned: normal thermostat demand is sufficient to support the room target.' if demand_hours else
                 f"No heating planned: lowest forecast {forecast_minimum:.1f}°C; room target {baseline:.1f}°C; minimum limit {room['minimum']:.1f}°C.")
    return {'slots': rows, 'scheduled_heat':rows[0]['heat'],'scheduled_mode':rows[0]['mode'],'reduction_available':rows[0]['reduction_available'], **timing,
            'forecast_minimum':forecast_minimum,'forecast_maximum':forecast_maximum,
            'comfort_floor':room['minimum'],'comfort_target':baseline,'target_shortfall_degree_hours':round(best[1],3),'suggested_heating_hours':round(suggested_hours,2),
            'predicted_demand_hours':round(demand_hours,2),
            'reason': ('Temperature limit risk: review model assumptions and heating capacity.' if risk else
                       'Heat storage or a bridging run ahead of predicted cooling.' if rows[0]['heat'] else
                       'Heating is planned later; no boost is suggested now.' if suggested_hours else explanation),
            'comfort_risk': risk, 'violation_degree_hours': round(best[0], 3),
            'known_price_hours': round(sum((stamp(r['end'])-stamp(r['start'])).total_seconds()/3600 for r in rows),2), 'curve_hours': round(curve_hours(room, min(outdoor)), 1)}


def collection_state(previous, outdoor, timestamp, config):
    """Collection follows the master switch and requires a valid outdoor reading."""
    state = dict(previous or {})
    state.pop('average', None)
    state.update(time=timestamp, active=bool(config['heating_enabled']),
                 collecting=bool(config['heating_enabled'] and outdoor is not None))
    return state


def fallback_season(previous, forecasts, forecast_type, outdoor, now, zone, threshold=6.0):
    """Summer: May 15–September 30, or a complete day's minimum at or above the configured threshold."""
    local = now.astimezone(zone)
    date = local.date().isoformat()
    days = {key:dict(value) for key,value in (previous or {}).get('days',{}).items()
            if abs((local.date()-date_type.fromisoformat(key)).days)<=3}
    for item in forecasts:
        moment = stamp(item.get('datetime'))
        value = number(item.get('templow',item.get('temperature')) if forecast_type in ('daily','twice_daily') else item.get('temperature'))
        if moment is None or value is None:
            continue
        point = moment.astimezone(zone)
        key = point.date().isoformat()
        day = days.setdefault(key,{})
        day['low'] = min(day.get('low',value),value)
        hour = point.hour+point.minute/60
        day['first_hour'] = min(day.get('first_hour',hour),hour)
        day['last_hour'] = max(day.get('last_hour',hour),hour)
        if forecast_type == 'daily':
            day['complete'] = True
        elif forecast_type == 'twice_daily':
            day['complete'] = day['first_hour'] <= 6 and day['last_hour'] >= 18
        else:
            points = day.setdefault('points',[])
            if moment.timestamp() not in points:
                points.append(moment.timestamp())
                points.sort()
            if day['first_hour'] <= 0 and day['last_hour'] >= 23 and all(b-a<=5400 for a,b in zip(points,points[1:])):
                day['complete'] = True
    today = days.setdefault(date,{})
    if outdoor is not None:
        today['low'] = min(today.get('low',outdoor),outdoor)
    in_dates = (5,15) <= (local.month,local.day) <= (9,30)
    summer = bool(in_dates or (today.get('complete') and today.get('low',-100)>=threshold))
    return {'summer':summer,'date':date,'daily_minimum':today.get('low'),
            'complete':bool(today.get('complete')),'days':days}
