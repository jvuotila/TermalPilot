/* Native custom panel. All data is escaped; settings are validated server-side. */
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const timeLabel = value => new Date(value).toLocaleString('en-GB',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'});
const entityLabel = state => state?.attributes?.friendly_name || (state?.entity_id?.split('.').slice(1).join('.').replace(/_/g,' ')) || 'Unavailable entity';
const settingHelp = {
  price_entity: 'The price lists must include VAT, grid charges, electricity tax and retailer margin. ThermalPilot uses these final prices directly. Select a source containing today/tomorrow or timestamped raw_today/raw_tomorrow price lists, and choose the matching source price unit.',
  pricing_mode: 'Hourly average uses fixed hourly averages of the source prices. 15 minutes plans using quarter-hour intervals. Flexible builds heating sessions in 15-minute steps, allowing runs such as 60 or 75 minutes while respecting the minimum flexible heating run.',
  minimum_run_minutes: 'The shortest planned heating session in flexible scheduling mode. Longer sessions can be chosen in 15-minute steps. This setting applies to flexible runs; valve opening and closing offsets are applied separately.',
  lag_hours: 'Initial estimate of how slowly heating affects room temperature. A larger value represents a slower system, such as heating pipes embedded in a concrete slab. The model uses this shared delay when estimating room response; it is not the valve opening time.',
  curve_warm_temp: 'The warm outdoor endpoint of the initial heating-hours curve. At this temperature or warmer, the starting model assumes the lower daily heating need. This curve seeds the model before enough real heating and cooling observations are available.',
  curve_cold_temp: 'The cold outdoor endpoint of the initial heating-hours curve. At this temperature or colder, the starting model assumes the higher daily heating need. Set it below the warm endpoint. Actual room response is learned from observations.',
  apply_season_setpoints: 'Allows real thermostat setpoint changes when ThermalPilot changes between Active and Passive. Active applies each room’s target temperature; Passive applies the shared summer setpoint. These commands can occur even with simulation enabled. This does not enable live heating schedule control.',
  summer_setpoint: 'The thermostat target used for all configured rooms while ThermalPilot is Passive, if real Active/Passive season setpoint control is enabled. A low summer target normally prevents heating without switching off the thermostats.',
  boost: 'Degrees added to each room’s target temperature during a suggested heating window. For example, a 20 °C target with a 1.5 °C boost suggests a 21.5 °C thermostat setpoint to store heat. Scheduled targets remain simulated in this version.',
  setback: 'Negative adjustment added to each room’s target temperature outside suggested heating windows. For example, a 20 °C target with −1 °C reduction suggests a 19 °C thermostat setpoint, allowing stored heat to cover the gap. Scheduled targets remain simulated in this version.',
  water_entity: 'Select the measured supply-water temperature. A temperature sensor uses its state; a climate entity uses its current_temperature attribute. This is the measured water temperature, not the thermostat’s target. A valid reading is required for planning and room learning.',
  simulation_enabled: 'Simulation calculates heating suggestions without applying the scheduled targets to thermostats. Disabling simulation pauses suggestions; observation and learning can continue while ThermalPilot is active. Live heating schedule control is not available in this version.',
};
const sourceSettingGroups = [
  ['Electricity price settings',['price_entity','price_unit','pricing_mode']],
  ['Weather and forecast settings',['weather_entity','outdoor_entity']],
  ['Heating settings',['minimum_run_minutes','fireplace_entity','fireplace_active_state']],
  ['Integration settings',['heating_enabled','simulation_enabled']],
];
const sharedSettingGroups = [
  ['Heating system settings',['water_entity','start_offset_minutes','stop_offset_minutes','lag_hours','curve_warm_temp','curve_cold_temp','apply_season_setpoints']],
  ['Thermostat settings',['summer_setpoint','minimum','maximum','boost','setback']],
];
const schedulingLabels = {hourly:'hourly average',quarterly:'15 minutes',flexible:'flexible'};

function roomId(){
  const crypto=globalThis.crypto;
  if(typeof crypto?.randomUUID==='function')return crypto.randomUUID();
  const bytes=new Uint8Array(16);
  if(typeof crypto?.getRandomValues==='function')crypto.getRandomValues(bytes);
  // Room identifiers are not credentials; support browsers without Web Crypto too.
  else for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256);
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
function entityMatches(state,rule={},settings={}){
  const attrs=state.attributes||{},domain=state.entity_id.split('.')[0];
  const deviceClass=attrs.device_class,unit=String(attrs.unit_of_measurement||'').trim().toLowerCase();
  const temperature=deviceClass==='temperature'||(!deviceClass&&['°c','°f','c','f','k','°k'].includes(unit));
  if(rule.kind==='relay')return domain==='switch';
  if(rule.kind==='water')return domain==='climate'?Object.hasOwn(attrs,'current_temperature'):domain==='sensor'&&temperature;
  if(rule.kind==='temperature')return temperature;
  if(rule.kind==='power')return deviceClass==='power'||(!deviceClass&&['w','kw'].includes(unit));
  if(rule.kind==='price')return ['today','tomorrow','raw_today','raw_tomorrow'].some(key=>Array.isArray(attrs[key]));
  if(rule.kind==='target')return temperature||(['number','input_number'].includes(domain)&&!deviceClass&&!unit);
  if(rule.kind==='activity'){
    if(['binary_sensor','switch'].includes(domain))return true;
    if(domain!=='sensor')return false;
    if(settings.activity_attribute&&Object.hasOwn(attrs,settings.activity_attribute))return true;
    if((deviceClass&&deviceClass!=='enum')||unit)return false;
    const value=String(state.state??'').trim().toLowerCase();
    return deviceClass==='enum'||['0','1'].includes(value)||(!['','unknown','unavailable'].includes(value)&&!Number.isFinite(Number(value)))||Object.hasOwn(attrs,'hvac_action');
  }
  return true;
}
function quarterHourObservations(rows){
  const buckets=new Map();
  for(const row of rows){
    const time=Number(row.time);if(!Number.isFinite(time))continue;
    const bucket=Math.floor(time/900)*900;
    if(!buckets.has(bucket)||time>=Number(buckets.get(bucket).time))buckets.set(bucket,{...row,interval_start:bucket});
  }
  return [...buckets.values()].sort((a,b)=>a.interval_start-b.interval_start);
}
const heatingLabel=value=>value==null?'Unknown':value?'On':'Off';
function compareRoomNames(a,b){
  const first=String(a.name||'').trim(),second=String(b.name||'').trim();
  if(!first||!second)return first?-1:second?1:0;
  return first.localeCompare(second,undefined,{sensitivity:'base',numeric:true});
}
class ThermalPilotPanel extends HTMLElement {
  constructor(){super();this.attachShadow({mode:'open'});this.tab='overview';this.historyHours=48;this.roomDisclosureState=new Map();}
  set hass(value){this._hass=value;for(const card of this.historyCards||[])card.hass=value;if(this.isConnected && !this.loaded && !this.loading)this.load();}
  set panel(value){this._panel=value;if(this.isConnected && this._hass && !this.loaded)this.load();}
  connectedCallback(){if(this._hass)this.load();this.timer=setInterval(()=>{if(this.tab!=='settings')this.load();},60000);}
  disconnectedCallback(){clearInterval(this.timer);clearTimeout(this.saveMessageTimer);}
  get entry(){return this._panel?.config?.entry_id;}
  async call(type,extra={}){return this._hass.callWS({type:`thermal_pilot/${type}`,entry_id:this.entry,...extra});}
  async load(){
    if(!this.entry || this.loading)return;
    this.loading=true;
    try{
      const response=await this.call('get');
      this.info=response;this.settings=structuredClone(response.settings);
      if(this.tab==='history')this.history=await this.call('history',{hours:this.historyHours});
      this.loaded=true;this.message='';this.render();
    }catch(e){this.message=e.message||String(e);this.render();}
    finally{this.loading=false;}
  }
  field(field,obj,prefix){
    const [key,label,type,min,max,step='any']=field;const value=obj[key];const name=`${prefix}.${key}`;
    let input;
    if(type==='bool')input=`<input type="checkbox" class="setting-toggle" role="switch" data-field="${name}" ${value?'checked':''}>`;
    else if(type.startsWith('select:'))input=`<select data-field="${name}">${type.slice(7).split(',').map(v=>`<option ${v===value?'selected':''} value="${escapeHTML(v)}">${escapeHTML(key==='pricing_mode'?schedulingLabels[v]||v:v)}</option>`).join('')}</select>`;
    else if(type==='number')input=`<input type="number" step="${step}" min="${min}" max="${max}" data-field="${name}" value="${escapeHTML(value)}">`;
    else if(type==='text')input=`<input data-field="${name}" value="${escapeHTML(value)}">`;
    else{
      const domains=type.split(','),rule=field[3]||{};const entities=Object.values(this._hass.states).filter(s=>domains.includes(s.entity_id.split('.')[0])&&entityMatches(s,rule,obj)).sort((a,b)=>entityLabel(a).localeCompare(entityLabel(b)));
      const retained=value&&!entities.some(s=>s.entity_id===value)?`<option selected value="${escapeHTML(value)}">${escapeHTML(entityLabel(this._hass.states[value]))} (${this._hass.states[value]?'does not match filter':'unavailable'})</option>`:'';
      input=`<select data-field="${name}"><option value="">— Select / not used —</option>${retained}${entities.map(s=>`<option value="${escapeHTML(s.entity_id)}" ${s.entity_id===value?'selected':''}>${escapeHTML(entityLabel(s))}</option>`).join('')}</select>`;
    }
    if(key==='fireplace_reduction')input=`<span class="number-unit">${input}<span>%</span></span><small>Negative values reduce estimated heat loss while the fireplace is active; −20% means a 20% reduction.</small>`;
    const helpText=settingHelp[key];
    const helpId=`help-${prefix}-${key}`;
    const help=helpText?` <span class="setting-help"><button type="button" class="setting-info" aria-label="About ${escapeHTML(label)}" aria-describedby="${helpId}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle class="info-dot" cx="12" cy="7" r="1"/></svg></button><span id="${helpId}" class="setting-tooltip" role="tooltip">${escapeHTML(helpText)}</span></span>`:'';
    return `<label><span>${escapeHTML(label)}${help}</span>${input}</label>`;
  }
  settingsGroups(groups){
    const fields=new Map(this.info.source_fields.map(field=>[field[0],field]));
    return groups.map(([title,keys])=>{
      const available=keys.map(key=>fields.get(key)).filter(Boolean);
      return available.length?`<div class="settings-group"><h3>${escapeHTML(title)}</h3><div class="grid">${available.map(field=>this.field(field,this.settings,'source')).join('')}</div></div>`:'';
    }).join('');
  }
  settingsView(){
    const i=this.info;
    const rooms=this.settings.rooms.map((room,index)=>({room,index})).sort((a,b)=>compareRoomNames(a.room,b.room));
    return `<form id="settings"><section class="settings-sources"><h2>Data sources and shared settings</h2>${this.settingsGroups(sourceSettingGroups)}</section>
    <section class="settings-shared"><h2>Shared room settings</h2><p>These settings apply to every room.</p>${this.settingsGroups(sharedSettingGroups)}</section>
    <section class="settings-rooms"><h2>Rooms</h2><p>Room response is learned from observed heating and cooling, starting with internal estimates.</p>
    <div class="room-cards">${rooms.map(({room:r,index})=>`<article class="room-card"><div class="room-actions"><button type="button" class="icon-button" data-reset="${escapeHTML(r.id)}" title="Reset learning for this room" aria-label="Reset learning for this room"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/></svg></button><button type="button" class="icon-button delete-room" data-remove="${index}" title="Remove room" aria-label="Remove room"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg></button></div><details><summary>${escapeHTML(r.name||'New room')} <span class="room-target">${escapeHTML(r.baseline??'—')} °C</span></summary><div class="grid room-fields">${i.room_fields.map(f=>this.field(f,r,`room${index}`)).join('')}</div></details></article>`).join('')}</div>
    <button type="button" id="add">Add room</button></section><div class="sticky"><button class="primary" type="submit">Save settings</button><span>${this.settings.apply_season_setpoints?'Season transitions change real thermostat setpoints':'Simulation only · device settings are never changed'}</span></div></form>`;
  }
  chart(rows,key,alternate){
    const timestamp=r=>Number(r.time??Date.parse(r.end)/1000);
    const data=rows.filter(r=>Number.isFinite(timestamp(r))).slice().sort((a,b)=>timestamp(a)-timestamp(b));
    const numeric=value=>value!=null&&Number.isFinite(Number(value));
    const keys=alternate?[key,alternate]:[key];
    const values=data.flatMap(r=>keys.filter(k=>numeric(r[k])).map(k=>Number(r[k])));
    if(!data.length||!values.length)return '<p>No observation history yet.</p>';
    const low=Math.floor((Math.min(...values)-.1)*10)/10,high=Math.ceil((Math.max(...values)+.1)*10)/10;
    const first=Math.floor(timestamp(data[0])/900)*900,last=Math.max(first+900,Math.ceil(timestamp(data.at(-1))/900)*900),span=last-first;
    // Quarter-hour ticks for short periods; longer views use aligned multiples to keep labels readable.
    const tickSeconds=Math.max(900,Math.ceil(span/(12*900))*900);
    const x=time=>70+710*(time-first)/span,y=value=>155-125*(value-low)/Math.max(.1,high-low);
    const points=k=>data.filter(r=>numeric(r[k])).map(r=>`${x(timestamp(r))},${y(Number(r[k]))}`).join(' ');
    const grid=[low,(low+high)/2,high].map(value=>`<line x1="70" y1="${y(value)}" x2="780" y2="${y(value)}" stroke="currentColor" opacity=".15"/><text x="60" y="${y(value)+4}" text-anchor="end">${value.toFixed(1)} °C</text>`).join('');
    const ticks=[];
    for(let time=first;time<=last;time+=tickSeconds){const label=new Date(time*1000).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',hour12:false});ticks.push(`<line x1="${x(time)}" y1="30" x2="${x(time)}" y2="160" stroke="currentColor" opacity=".1"/><text x="${x(time)}" y="180" text-anchor="middle">${escapeHTML(label)}</text>`);}
    const label=alternate?'Measured temperature':'Predicted temperature under the suggested plan';
    return `<div class="chart-legend"><span><i style="background:#1976d2"></i>${label}</span>${alternate?'<span><i style="background:#e49025"></i>Model prediction using actual heating</span>':''}</div><div class="temperature-chart"><svg viewBox="0 0 800 195" role="img" aria-label="${label}${alternate?' and model prediction using actual heating':''}">${grid}${ticks.join('')}<polyline points="${points(key)}" fill="none" stroke="#1976d2" stroke-width="3"/>${alternate?`<polyline points="${points(alternate)}" fill="none" stroke="#e49025" stroke-width="2" stroke-dasharray="6 4"/>`:''}</svg></div><small>${escapeHTML(timeLabel(first*1000))} – ${escapeHTML(timeLabel(last*1000))}</small>`;
  }
  roomDisclosureOpen(id){return this.roomDisclosureState.get(`${this.tab}:${id}`)===true;}
  learningPercent(room){
    const model=room?.model||{},progress=room?.learning_progress||{};
    return Math.max(0,Math.min(100,progress.percent??100*(Math.min(12,model.heated_hours??0)+Math.min(12,model.idle_hours??0))/24));
  }
  learningBadge(room){
    const percent=this.learningPercent(room);
    return `<span class="room-learning" title="Initial observation progress: 12 heating hours and 12 idle hours. This is not a reliability rating." aria-label="Initial data collection ${percent.toFixed(0)} percent">${percent.toFixed(0)}% initial data</span>`;
  }
  learningView(room){
    const model=room.model||{},progress=room.learning_progress||{};
    const heating=progress.heating_hours??model.heated_hours??0,idle=progress.idle_hours??model.idle_hours??0;
    const percent=Math.max(0,Math.min(100,progress.percent??100*(Math.min(12,heating)+Math.min(12,idle))/24));
    const complete=progress.initial_complete??(heating>=12&&idle>=12);
    const days=progress.estimated_days_to_initial;
    const completion=progress.estimated_initial_completion||(days!=null&&!complete?new Date(Date.now()+days*86400000).toISOString():null);
    const completionDate=completion?new Date(completion):null;
    const dateText=completionDate&&!Number.isNaN(completionDate.getTime())?completionDate.toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'}):null;
    const estimate=complete?'Initial observation thresholds reached.':days!=null?`About ${days<1?'less than 1':Math.ceil(days)} more ${days<=1?'day':'days'} to the initial thresholds at recent observation rates.`:(progress.rate_history_hours??0)<24?'Time estimate available after at least 24 hours of rate tracking.':'Waiting for enough heating and idle observations to estimate the remaining time.';
    return `<div class="learning-card"><div class="learning-heading"><strong>Initial data collection</strong><span>${percent.toFixed(0)}%</span></div><progress max="100" value="${percent}" aria-label="Initial learning observation progress">${percent.toFixed(0)}%</progress><div class="learning-counts"><span>Heating <strong>${Number(heating).toFixed(1)} / 12 h</strong></span><span>Idle <strong>${Number(idle).toFixed(1)} / 12 h</strong></span></div><p>${escapeHTML(estimate)}</p>${dateText?`<p class="learning-date">Estimated initial-data completion: <strong>${escapeHTML(dateText)}</strong></p>`:''}<small>${escapeHTML(room.learning_note||'')} · ${model.samples||0} accepted observations. This measures initial data collection, not model trustworthiness. Continue validating forecasts and heating suggestions; live heating schedule control is not available in this version.</small></div>`;
  }
  overview(){
    const data=this.info.data||{};const rooms=Object.entries(data.rooms||{}).sort((a,b)=>compareRoomNames(a[1],b[1]));
    return `<section class="status-card"><div class="status-heading"><h2>Simulation status</h2><button id="toggle-active" class="primary">${this.settings.heating_enabled?'Set passive':'Set active'}</button></div>
    <dl class="status-grid">
      <div class="status-block"><dt>Operation</dt><dd><span class="status-pill ${data.heating_active===false?'paused':'active'}">${data.heating_active===false?'Passive':'Active'}</span></dd><small>${data.heating_active===false?'Observation and learning are stopped.':'Observation and learning are enabled.'}</small></div>
      <div class="status-block"><dt>Data collection</dt><dd><span class="status-pill ${data.collection?.collecting?'active':'paused'}">${data.collection?.collecting?'Active':'Paused'}</span></dd><small>Room observations for learning.</small></div>
      <div class="status-block"><dt>Stored history</dt><dd>${escapeHTML(Number(data.history_info?.rows??0).toLocaleString())}<span class="status-unit"> samples</span></dd><small>Local database: ${((data.history_info?.bytes??0)/1048576).toFixed(1)} MiB</small></div>
      <div class="status-block"><dt>Outdoor temperature</dt><dd>${escapeHTML(data.outdoor??'—')}<span class="status-unit"> °C</span></dd><small>Current outdoor reading.</small></div>
      <div class="status-block"><dt>Supply water temperature</dt><dd>${escapeHTML(data.water??'—')}<span class="status-unit"> °C</span></dd><small>Measured heating-water temperature.</small></div>
      <div class="status-block"><dt>Last update</dt><dd class="status-time">${escapeHTML(data.updated?timeLabel(data.updated):'—')}</dd><small>Latest calculation and observation.</small></div>
    </dl>${(data.warnings||[]).map(w=>`<p class="warning">${escapeHTML(w)}</p>`).join('')}</section>${!rooms.length?'<section>Add rooms on the Settings page.</section>':''}
    <div class="observation-cards">${rooms.map(([id,r])=>{const p=r.plan,m=r.model||{};return `<section class="observation-card"><details class="observation-accordion" data-room-accordion="${escapeHTML(id)}" ${this.roomDisclosureOpen(id)?'open':''}><summary><h2>${escapeHTML(r.name)} ${this.learningBadge(r)} <small>${p?(p.heat?'Boosted thermostat target':'Reduced thermostat target'):'No suggestion'}</small></h2></summary><div class="observation-content"><div class="metrics"><div>Measured<strong>${escapeHTML(r.temperature??'—')} °C</strong></div><div>Suggested thermostat target<strong>${escapeHTML(p?.setpoint??'—')} °C</strong></div><div>Actual heating<strong>${heatingLabel(r.actual_activity)}</strong></div><div>Short-term prediction error<strong>${m.mae==null?'—':m.mae.toFixed(3)+' °C'}</strong></div></div><p>${escapeHTML(r.error||p?.reason||'Waiting for data.')}</p>${this.learningView(r)}
    ${p?`<h3>Thermostat timing</h3><p>Target changes include the shared start/stop offsets. The temperature forecast models the planned heating period; actual valve and heat-pump delays must be checked against observations.</p><div class="scroll timing-table"><table><thead><tr><th>Planned heating starts</th><th>Planned heating ends</th></tr></thead><tbody>${(p.sessions||[]).map(s=>`<tr><td>${escapeHTML(timeLabel(s.start))}</td><td>${escapeHTML(timeLabel(s.end))}</td></tr>`).join('')||'<tr><td class="empty-table" colspan="2">No heating sessions planned.</td></tr>'}</tbody></table></div><div class="scroll timing-table"><table><thead><tr><th>Change target at</th><th>Action</th><th>Target (°C)</th></tr></thead><tbody>${(p.commands||[]).map(c=>`<tr><td>${escapeHTML(timeLabel(c.time))}</td><td>${c.action==='raise'?'Raise':'Lower'}</td><td>${c.setpoint}</td></tr>`).join('')||'<tr><td class="empty-table" colspan="3">No thermostat target changes planned.</td></tr>'}</tbody></table></div>${this.chart(p.slots,'temperature')}<p>Blue: predicted temperature under the proposed plan. This outcome has not been observed.</p><div class="scroll"><table><thead><tr><th>Starts</th><th>Price ct/kWh</th><th>Suggestion</th><th>Setpoint °C</th><th>Prediction °C</th></tr></thead><tbody>${p.slots.map(s=>`<tr class="${s.heat?'heat':''}"><td>${escapeHTML(timeLabel(s.start))}</td><td>${s.price.toFixed(2)}</td><td>${s.heat?'Store heat':'Idle'}</td><td>${s.setpoint}</td><td>${s.temperature.toFixed(2)}</td></tr>`).join('')}</tbody></table></div>`:''}</div></details></section>`;}).join('')}</div>`;
  }
  historyView(){
    return `<div class="history-summary"><section><h2>Observations and suggestions</h2><label>Period<select id="history-hours">${[24,48,168,720].map(h=>`<option value="${h}" ${h===this.historyHours?'selected':''}>${h} hours</option>`).join('')}</select></label><p>Each chart compares measured room temperature with the model’s prediction using observed heating demand. It does not show the simulated outcome of ThermalPilot’s suggested schedule. Suggested On means a boosted thermostat target; actual On means the observed relay or thermostat is requesting heat. These can differ.</p></section>
    <section><h2>Season archives</h2><p>Learned parameters and season aggregates are retained when old observations are compacted.</p>${(this.info.data?.season_summaries||[]).map(a=>`<p>${escapeHTML(a.season)} · ${escapeHTML(this.settings.rooms.find(r=>r.id===a.room_id)?.name||a.room_id)} · ${a.statistics?.samples||0} observations · loss ${(a.model?.loss||0).toFixed(4)} · heating gain ${(a.model?.gain||0).toFixed(3)}</p>`).join('')||'<p>No completed heating season yet.</p>'}</section></div><div class="observation-cards">${[...this.settings.rooms].sort(compareRoomNames).map(room=>{const rows=(this.history||[]).filter(r=>r.room_id===room.id);const recent=quarterHourObservations(rows).slice(-288);return `<section class="observation-card"><details class="observation-accordion" data-room-accordion="${escapeHTML(room.id)}" ${this.roomDisclosureOpen(room.id)?'open':''}><summary><h2>${escapeHTML(room.name)} ${this.learningBadge(this.info.data?.rooms?.[room.id])}</h2></summary><div class="observation-content"><h3>Suggested heating and relay history</h3><div data-room-history="${escapeHTML(room.id)}"><p>Loading Home Assistant history…</p></div><p>Suggested On means the boosted target window, including valve timing offsets. Relay On means observed demand; it does not guarantee heat flow.</p>${this.chart(rows,'temperature','prediction')}<div class="scroll"><table><thead><tr><th>15-minute interval</th><th>Suggested heating window</th><th>Actual thermostat demand</th><th>Measured temperature (°C)</th><th>Suggested thermostat target (°C)</th></tr></thead><tbody>${recent.reverse().map(r=>`<tr><td title="Latest observation: ${escapeHTML(timeLabel(r.time*1000))}">${escapeHTML(timeLabel(r.interval_start*1000))}</td><td>${heatingLabel(r.suggested_heat)}</td><td>${heatingLabel(r.activity)}</td><td>${r.temperature}</td><td>${r.suggested_setpoint??'—'}</td></tr>`).join('')}</tbody></table></div><p>Each row shows the latest observation within its 15-minute interval, not an average. Suggested thermostat target is the setting ThermalPilot would apply, not a room-temperature forecast. Table shows up to 288 intervals. Original observations remain stored internally. Short chart views use 15-minute time labels; longer views use wider intervals.</p></div></details></section>`;}).join('')}</div>`;
  }
  historyGraphConfig(room){
    const mapping=this.info.room_entities?.[room.id]||{};
    const entities=[];
    if(mapping.suggested)entities.push({entity:mapping.suggested,name:'Suggested heating window'});
    const actual=room.activity_entity||mapping.actual;
    if(actual)entities.push({entity:actual,name:room.activity_entity?'Thermostat relay':'Observed thermostat demand'});
    return {type:'history-graph',hours_to_show:this.historyHours,entities};
  }
  async mountHistoryGraphs(){
    const hosts=[...this.shadowRoot.querySelectorAll('[data-room-history]')];
    if(!hosts.length)return;
    this.historyCards=[];
    let helpers;
    try{if(typeof globalThis.loadCardHelpers==='function')helpers=await globalThis.loadCardHelpers();}catch(error){console.warn('ThermalPilot history card loading failed',error);}
    for(const host of hosts){
      if(this.tab!=='history'||host.isConnected===false)continue;
      const room=this.settings.rooms.find(room=>room.id===host.dataset.roomHistory);
      if(!room)continue;
      const config=this.historyGraphConfig(room);
      if(!config.entities.length){host.textContent='History entities are being registered. Refresh this page shortly.';continue;}
      const ids=config.entities.map(entity=>entity.entity).join(',');
      const start=new Date(Date.now()-this.historyHours*3600000).toISOString();
      const url=`/history?entity_id=${encodeURIComponent(ids)}&start_date=${encodeURIComponent(start)}`;
      try{
        let card;
        if(helpers?.createCardElement)card=helpers.createCardElement(config);
        else if(customElements.get('hui-history-graph-card')){card=document.createElement('hui-history-graph-card');card.setConfig(config);}
        if(card){card.hass=this._hass;this.historyCards.push(card);host.replaceChildren(card);}
        else host.innerHTML='<p>Open a Home Assistant dashboard once, then return here to load embedded history cards.</p>';
      }catch(error){host.textContent='Embedded history is unavailable. Open the full Home Assistant history below.';}
      const link=document.createElement('a');link.href=url;link.textContent='Open full Home Assistant history';host.append(link);
    }
  }
  capture(){this.shadowRoot.querySelectorAll('[data-field]').forEach(input=>{const [prefix,key]=input.dataset.field.split('.');const obj=prefix==='source'?this.settings:this.settings.rooms[Number(prefix.slice(4))];obj[key]=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;});}
  render(){
    this.shadowRoot.innerHTML=`<style>:host{display:block;color:var(--primary-text-color,#213547);background:var(--primary-background-color,#f5f7fa);min-height:100vh;font:15px system-ui}*{box-sizing:border-box}header,main{max-width:1250px;margin:auto;padding:24px}h1{margin:0 0 8px}h2{font-size:21px}small{font-size:14px;font-weight:normal}nav{display:flex;gap:8px;margin-top:18px}button{border:1px solid #aac0c8;border-radius:8px;padding:10px 16px;background:var(--card-background-color,white);color:inherit;cursor:pointer;margin:4px}button.active,.primary{background:#087c85;color:white}section{background:var(--card-background-color,white);border:1px solid var(--divider-color,#dce4e8);border-radius:14px;padding:24px;margin:0 0 20px}.settings-group{margin-top:24px}.settings-group+.settings-group{border-top:1px solid var(--divider-color,#dce4e8);padding-top:8px}.settings-group h3{font-size:17px;margin:16px 0}.settings-sources{background:linear-gradient(#2196f312,#2196f312),var(--card-background-color,white)}.settings-shared{background:linear-gradient(#00857712,#00857712),var(--card-background-color,white)}.settings-rooms{background:linear-gradient(#e4902515,#e4902515),var(--card-background-color,white)}.badge{color:#087c85;font-weight:600}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:18px}label{display:flex;flex-direction:column;gap:7px}.number-unit{display:flex;align-items:center;gap:8px}.number-unit input{min-width:0;flex:1}.number-unit span{flex:none}input,select{width:100%;padding:10px;border:1px solid #aabdc5;border-radius:6px;color:inherit;background:var(--card-background-color,white)}input[type=checkbox].setting-toggle{appearance:none;-webkit-appearance:none;width:44px;height:26px;padding:2px;border:0;border-radius:13px;background:var(--disabled-color,#87949b);cursor:pointer;transition:background .15s}input[type=checkbox].setting-toggle::before{content:"";display:block;width:22px;height:22px;border-radius:50%;background:white;box-shadow:0 1px 3px #0003;transition:transform .15s}input[type=checkbox].setting-toggle:checked{background:var(--primary-color,#087c85)}input[type=checkbox].setting-toggle:checked::before{transform:translateX(18px)}input[type=checkbox].setting-toggle:focus-visible{outline:2px solid var(--primary-color,#087c85);outline-offset:3px}details{border-top:1px solid #ddd;padding:18px 0}summary{font-weight:600;cursor:pointer;margin-bottom:20px}.room-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;align-items:start;margin:20px 0}.room-card{position:relative;min-width:0;border:1px solid var(--divider-color,#dce4e8);border-radius:12px;padding:20px;background:var(--card-background-color,white)}.room-card details{border:0;padding:0}.room-card summary{margin:0;min-height:26px;padding-right:78px;overflow-wrap:anywhere}.room-target{font-weight:normal;color:var(--secondary-text-color,#60737b);white-space:nowrap;margin-left:8px}.room-card details[open] summary{margin-bottom:20px}.room-fields{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.room-fields label{min-width:0}.room-fields input,.room-fields select{min-width:0;max-width:100%}.room-actions{position:absolute;top:10px;right:10px;display:flex;gap:4px;margin:0}.room-actions .icon-button{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;padding:7px;margin:0;border:0;background:transparent;border-radius:50%}.room-actions .icon-button:hover{background:var(--secondary-background-color,#eef2f4)}.room-actions .icon-button:focus-visible{outline:2px solid var(--primary-color,#087c85);outline-offset:2px}.room-actions .delete-room{color:var(--error-color,#c62828)}.icon-button svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}@media(max-width:900px){.room-cards{grid-template-columns:minmax(0,1fr)}}@media(max-width:600px){.room-fields{grid-template-columns:minmax(0,1fr)}.room-card{padding:16px}}.sticky{position:sticky;bottom:0;background:var(--card-background-color,white);padding:12px;box-shadow:0 -2px 8px #0001}.metrics{display:flex;gap:24px;flex-wrap:wrap}.metrics strong{display:block;font-size:24px;margin-top:8px}.warning,.message{padding:12px;background:#ffb30022;border-radius:8px}.save-toast{position:fixed;bottom:calc(24px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);z-index:10000;width:max-content;max-width:calc(100% - 32px);margin:0;padding:14px 20px;background:var(--primary-text-color,#213547);color:var(--card-background-color,#fff);box-shadow:0 4px 18px #0004;pointer-events:none}[data-room-history]{margin:12px 0}[data-room-history] a{display:inline-block;color:var(--primary-color,#087c85);margin-top:12px}.chart-legend{display:flex;flex-wrap:wrap;gap:12px 24px;margin:14px 0 6px}.chart-legend span{display:flex;align-items:center;gap:8px}.chart-legend i{display:inline-block;width:24px;height:3px}.temperature-chart{overflow-x:auto;margin:8px 0}.temperature-chart svg{display:block;min-width:800px;width:100%;max-height:none}.scroll{overflow:auto;max-height:420px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #ddd;white-space:nowrap}.heat{background:#00857718}svg{width:100%;max-height:230px}svg text{fill:var(--primary-text-color,#213547);font-size:12px}p{line-height:1.6}@media(max-width:600px){header,main{padding:12px}section{padding:16px}}
/* Compact settings layout; keep the other tabs at their readable content width. */
.settings-layout{max-width:none;padding:16px 24px}
#settings{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;align-items:start}
#settings>section{min-width:0;margin:0;padding:20px}
#settings h2{margin:0 0 12px}
#settings p{margin:0 0 14px;line-height:1.45}
#settings .settings-group{margin-top:16px}
#settings .settings-group+.settings-group{padding-top:12px}
#settings .settings-group h3{margin:0 0 12px}
#settings .grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:12px 16px}
#settings .grid>label{min-width:0}
#settings .grid>label>span:first-child{min-height:2.5em;line-height:1.25}
#settings input,#settings select{min-width:0;max-width:100%;padding:8px 10px}
#settings input.setting-toggle{padding:2px}
#settings .room-fields{grid-template-columns:repeat(2,minmax(0,1fr))}
#settings .room-cards{gap:16px;margin:16px 0}
#settings .room-card{padding:16px}
#settings .room-card details[open] summary{margin-bottom:16px}
#settings>.sticky{grid-column:1/-1;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:8px 12px;z-index:10}
@supports(grid-template-rows:subgrid){
 #settings .grid>label{display:grid;grid-row:span 3;grid-template-rows:subgrid;gap:6px;align-items:start}
 #settings .grid>label>span:first-child{min-height:0}
}
@media(min-width:1400px){
 #settings{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:1000px){#settings .settings-group>.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:600px){
 .settings-layout{padding:12px}
 #settings .settings-group>.grid{grid-template-columns:minmax(0,1fr)}
 #settings>section{padding:16px}
 #settings .room-fields{grid-template-columns:minmax(0,1fr)}
}
/* Keep dropdown arrows inset from the field border. */
select{appearance:none;-webkit-appearance:none;padding-right:36px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='m2 4 4 4 4-4' fill='none' stroke='%23808b93' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;background-size:12px 12px}
#settings select{padding-right:36px}
@media(forced-colors:active){select{appearance:auto;background-image:none}}

/* Use parallel room cards on Plan and History without shrinking mobile layouts. */
.page-layout{max-width:none;padding:16px 24px}
.observation-cards,.history-summary{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;align-items:start}
.observation-cards>section,.history-summary>section{min-width:0;margin:0;padding:20px}
.history-summary{margin-bottom:16px}
.history-summary label{max-width:240px}
.observation-card h2,.history-summary h2,.status-card h2{margin:0 0 12px}
.observation-card h2 small{display:block;margin-top:4px}
.observation-card h3{margin:14px 0 8px;font-size:17px}
.observation-card p,.history-summary p,.status-card p{margin:8px 0;line-height:1.45}
.status-card{padding:20px;margin-bottom:16px}
.observation-card .metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 16px}
.observation-card .metrics strong{font-size:21px;margin-top:4px}
.observation-card .scroll{max-height:250px}
.observation-card th{white-space:normal;vertical-align:bottom;line-height:1.3}
.observation-card th,.observation-card td{padding:8px}
.observation-card .temperature-chart svg{min-width:560px;max-height:220px}
.observation-card .chart-legend{gap:8px 16px;font-size:14px}
@media(min-width:1200px){.observation-cards,.history-summary{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:600px){
 .page-layout{padding:12px}
 .observation-cards>section,.history-summary>section,.status-card{padding:16px}
}

/* History has distinct surfaces for room headings, charts and observations. */
.history-layout .history-summary>section:first-child{background:linear-gradient(#2196f312,#2196f312),var(--card-background-color,white)}
.history-layout .history-summary>section:last-child{background:linear-gradient(#e4902512,#e4902512),var(--card-background-color,white)}
.observation-layout .observation-card{background:linear-gradient(#00857709,#00857709),var(--card-background-color,white);box-shadow:0 2px 8px #00000008}
.observation-layout .observation-card .observation-accordion>summary{padding:12px 14px;border-left:4px solid var(--primary-color,#087c85);border-radius:8px;background:linear-gradient(#00857718,#00857718),var(--card-background-color,white)}
.observation-layout .observation-card>h3{color:var(--secondary-text-color,#526671)}
.history-layout [data-room-history],.observation-layout .temperature-chart{padding:12px;border:1px solid var(--divider-color,#dce4e8);border-radius:10px;background:var(--card-background-color,white)}
.history-layout [data-room-history]{--ha-card-background:var(--card-background-color,white);--ha-card-border-width:0px;--ha-card-box-shadow:none}
.observation-layout .chart-legend{padding:10px 12px;border-radius:8px;background:linear-gradient(#2196f30c,#2196f30c),var(--card-background-color,white)}
.observation-layout .observation-card .observation-content>.scroll{margin-top:12px;border:1px solid var(--divider-color,#dce4e8);border-radius:10px;background:var(--card-background-color,white)}
.observation-layout th{position:sticky;top:0;z-index:1;background:linear-gradient(#00857720,#00857720),var(--card-background-color,white);padding:10px}
.observation-layout tbody tr:nth-child(even){background:#0085770a}
.observation-layout tbody tr:hover{background:#2196f314}
.observation-layout tbody tr:last-child td{border-bottom:0}
.observation-layout .observation-card .observation-content>p{color:var(--secondary-text-color,#526671);font-size:14px}

.plan-layout .status-card{background:linear-gradient(#2196f312,#2196f312),var(--card-background-color,white)}
.plan-layout .metrics>div{padding:12px 14px;border:1px solid var(--divider-color,#dce4e8);border-radius:10px;background:var(--card-background-color,white)}
.plan-layout .metrics>div:nth-child(2){background:linear-gradient(#00857712,#00857712),var(--card-background-color,white)}
.plan-layout .metrics>div:nth-child(4){background:linear-gradient(#e4902512,#e4902512),var(--card-background-color,white)}
.plan-layout .metrics strong{color:var(--primary-text-color,#213547)}
.plan-layout .observation-card tbody tr.heat{background:#00857720}

/* A gentle elevation separates cards and their inset content surfaces. */
section,.room-card,.plan-layout .metrics>div,.observation-layout .temperature-chart,.history-layout [data-room-history],.observation-layout .observation-card .observation-content>.scroll{box-shadow:0 2px 6px #0000000a,0 1px 2px #00000008}

/* Stronger outlines keep container boundaries visible in light and dark themes. */
section,.room-card,.plan-layout .metrics>div,.observation-layout .temperature-chart,.history-layout [data-room-history],.observation-layout .observation-card .observation-content>.scroll{border-color:#91a5ad}
@supports(color:color-mix(in srgb,white,black)){
 section,.room-card,.plan-layout .metrics>div,.observation-layout .temperature-chart,.history-layout [data-room-history],.observation-layout .observation-card .observation-content>.scroll{border-color:color-mix(in srgb,var(--primary-text-color,#213547) 34%,var(--card-background-color,white))}
}

/* Increase spacing between containers without spreading out individual fields. */
section{margin-bottom:30px}
#settings,.observation-cards,.history-summary{gap:24px}
.history-summary,.status-card{margin-bottom:24px}
#settings .room-cards{gap:24px;margin:24px 0}

.observation-accordion{border:0;padding:0}
.observation-accordion>summary{display:flex;align-items:center;gap:10px;list-style:none;margin:0}
.observation-accordion>summary::-webkit-details-marker{display:none}
.observation-accordion>summary::before{content:"▸";font-size:18px;transform:rotate(0);flex:none}
.observation-accordion[open]>summary::before{transform:rotate(90deg)}
.observation-card .observation-accordion>summary h2{flex:1;min-width:0;margin:0;font-size:21px}
.observation-accordion>summary:focus-visible{outline:2px solid var(--primary-color,#087c85);outline-offset:3px}
.observation-content{padding-top:16px;min-width:0}

.status-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:16px}
.status-heading h2{margin:0}
.status-heading button{margin:0}
.status-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin:0}
.status-block{min-width:0;padding:14px;border:1px solid #91a5ad;border-radius:10px;background:var(--card-background-color,white);box-shadow:0 2px 6px #0000000a,0 1px 2px #00000008}
.status-block dt{font-size:14px;color:var(--secondary-text-color,#526671);margin-bottom:10px}
.status-block dd{margin:0 0 8px;font-size:24px;font-weight:650;overflow-wrap:anywhere}
.status-block small{font-size:13px;line-height:1.4;color:var(--secondary-text-color,#526671)}
.status-unit{font-size:14px;font-weight:normal}
.status-block .status-time{font-size:20px}
.status-pill{display:inline-flex;padding:5px 10px;border-radius:7px;font-size:16px;background:var(--secondary-background-color,#eef2f4)}
.status-pill.active{background:#00857720;color:var(--primary-text-color,#213547);border-left:3px solid #087c85}
.status-pill.paused{background:#e4902520;color:var(--primary-text-color,#213547);border-left:3px solid #b77918}
@supports(color:color-mix(in srgb,white,black)){.status-block{border-color:color-mix(in srgb,var(--primary-text-color,#213547) 34%,var(--card-background-color,white))}}
@media(max-width:600px){.status-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.status-block{padding:12px}.status-block dd{font-size:21px}}
@media(max-width:380px){.status-grid{grid-template-columns:minmax(0,1fr)}}

.plan-layout .observation-content>.timing-table{margin-bottom:20px}
.observation-card td.empty-table{padding:16px;color:var(--secondary-text-color,#526671);white-space:normal;text-align:center}

.setting-help{position:relative;display:inline-flex;vertical-align:middle}
.setting-help .setting-info{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;margin:0 0 0 3px;padding:1px;border:0;border-radius:50%;background:transparent;color:var(--primary-color,#087c85);cursor:help}
.setting-info svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round}
.setting-info .info-dot{fill:currentColor;stroke:none}
.setting-info:focus-visible{outline:2px solid var(--primary-color,#087c85);outline-offset:2px}
.setting-tooltip{display:none;position:absolute;left:0;bottom:calc(100% + 8px);z-index:30;width:280px;max-width:calc(100vw - 48px);padding:12px;border-radius:8px;background:var(--primary-text-color,#213547);color:var(--card-background-color,white);font-size:13px;line-height:1.45;font-weight:normal;box-shadow:0 3px 12px #0003}
.setting-help:hover .setting-tooltip,.setting-help:focus-within .setting-tooltip{display:block}

/* Alternating room-row colors follow the responsive one/two-column layout. */
.observation-layout .observation-cards>.observation-card{--room-tint:#00857712;--room-heading-tint:#00857724;background:linear-gradient(var(--room-tint),var(--room-tint)),var(--card-background-color,white)}
.observation-layout .observation-cards>.observation-card:nth-child(even){--room-tint:#2196f312;--room-heading-tint:#2196f324}
.observation-layout .observation-card .observation-accordion>summary{background:linear-gradient(var(--room-heading-tint),var(--room-heading-tint)),var(--card-background-color,white)}
@media(min-width:1200px){
 .observation-layout .observation-cards>.observation-card:nth-child(n){--room-tint:#00857712;--room-heading-tint:#00857724}
 .observation-layout .observation-cards>.observation-card:nth-child(4n+3),.observation-layout .observation-cards>.observation-card:nth-child(4n+4){--room-tint:#2196f312;--room-heading-tint:#2196f324}
}

@media(min-width:1400px){#settings>.settings-sources,#settings>.settings-shared{align-self:stretch}}

@media(min-width:1200px){.history-summary>section{align-self:stretch}}

.learning-card{padding:14px 16px;margin:16px 0;border:1px solid #91a5ad;border-radius:10px;background:linear-gradient(#2196f30c,#2196f30c),var(--card-background-color,white);box-shadow:0 2px 6px #0000000a}
.learning-heading,.learning-counts{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
.learning-heading{margin-bottom:10px}
.learning-counts{margin-top:10px;font-size:14px}
.learning-counts strong{margin-left:5px}
.learning-card progress{display:block;width:100%;height:10px;border:0;border-radius:5px;overflow:hidden;appearance:none;background:var(--divider-color,#dce4e8)}
.learning-card progress::-webkit-progress-bar{background:var(--divider-color,#dce4e8)}
.learning-card progress::-webkit-progress-value{background:#087c85;border-radius:5px}
.learning-card progress::-moz-progress-bar{background:#087c85;border-radius:5px}
.learning-card small{font-size:13px;line-height:1.45;color:var(--secondary-text-color,#526671)}

.room-learning{display:inline-block;margin-left:8px;font-size:14px;font-weight:normal;vertical-align:middle;white-space:nowrap;color:var(--secondary-text-color,#526671)}
</style>
    <header class="page-layout ${this.tab==='settings'?'settings-layout':this.tab==='history'?'history-layout observation-layout':'plan-layout observation-layout'}"><h1>ThermalPilot</h1><div class="badge">${this.settings?.apply_season_setpoints?'SEASON SETPOINT CONTROL ENABLED · heating schedules remain simulated':'SIMULATION · your existing automation remains in control'}</div><nav>${[['overview','Plan'],['history','History'],['settings','Settings']].map(([id,label])=>`<button data-tab="${id}" class="${this.tab===id?'active':''}">${label}</button>`).join('')}</nav>${this.message&&!this.saveConfirmation?`<p class="message">${escapeHTML(this.message)}</p>`:''}</header><main class="page-layout ${this.tab==='settings'?'settings-layout':this.tab==='history'?'history-layout observation-layout':'plan-layout observation-layout'}">${!this.info?'Loading…':this.tab==='settings'?this.settingsView():this.tab==='history'?this.historyView():this.overview()}</main>${this.message&&this.saveConfirmation?`<div class="message save-toast" role="status" aria-live="polite">${escapeHTML(this.message)}</div>`:''}`;
    this.shadowRoot.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{this.tab=b.dataset.tab;this.loaded=false;this.load();});
    this.shadowRoot.querySelector('#toggle-active')?.addEventListener('click',async()=>{try{await this.call('save',{settings:{...this.settings,heating_enabled:!this.settings.heating_enabled}});this.settings.heating_enabled=!this.settings.heating_enabled;this.message='Activity setting saved. Effective status updates shortly.';this.render();}catch(error){this.message=error.message;this.render();}});
    this.shadowRoot.querySelector('#add')?.addEventListener('click',()=>{this.message='';this.capture();this.settings.rooms.push({...this.info.room_defaults,id:roomId()});this.render();});
    this.shadowRoot.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{this.capture();const index=Number(b.dataset.remove),room=this.settings.rooms[index];if(!room||!confirm(`Remove room "${room.name||'New room'}"? Save settings to apply this change.`))return;this.message='';this.settings.rooms.splice(index,1);this.render();});
    this.shadowRoot.querySelectorAll('[data-reset]').forEach(b=>b.onclick=async()=>{if(!confirm('Reset the learned parameters for this room? Observation history will be retained.'))return;try{await this.call('reset',{room_id:b.dataset.reset});this.message='Room learning reset.';}catch(e){this.message=e.message;}this.capture();this.render();});
    const settingsForm=this.shadowRoot.querySelector('#settings');
    const clearSaveMessage=()=>{clearTimeout(this.saveMessageTimer);this.saveConfirmation=false;this.message='';this.shadowRoot.querySelector('.message')?.remove();};
    settingsForm?.addEventListener('input',event=>{
      clearSaveMessage();
      const field=event.target?.dataset?.field;
      if(field?.startsWith('room')&&field.endsWith('.baseline')){
        const target=event.target.closest('.room-card')?.querySelector('.room-target');
        if(target)target.textContent=`${event.target.value||'—'} °C`;
      }
    });
    settingsForm?.addEventListener('change',clearSaveMessage);
    settingsForm?.addEventListener('submit',async e=>{
      e.preventDefault();if(this.saving)return;this.capture();clearSaveMessage();this.saving=true;
      const saveButton=settingsForm.querySelector('button[type=submit]');
      if(saveButton)saveButton.textContent='Saving…';
      settingsForm.querySelectorAll('input,select,button').forEach(control=>control.disabled=true);
      try{await this.call('save',{settings:this.settings});this.message=`Settings saved at ${new Date().toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',second:'2-digit'})}. Suggestions will update shortly.`;this.saveConfirmation=true;
        const confirmation=this.message;
        clearTimeout(this.saveMessageTimer);
        this.saveMessageTimer=setTimeout(()=>{if(this.saveConfirmation&&this.message===confirmation){this.message='';this.saveConfirmation=false;this.shadowRoot.querySelector('.save-toast')?.remove();}},5000);
      }
      catch(error){this.message=`Settings were not saved: ${error.message||String(error)}`;}
      finally{this.saving=false;this.render();}
    });
    const disclosureTab=this.tab;
    this.shadowRoot.querySelectorAll('[data-room-accordion]').forEach(details=>details.addEventListener('toggle',()=>{this.roomDisclosureState.set(`${disclosureTab}:${details.dataset.roomAccordion}`,details.open);}));
    if(this.tab==='history')this.mountHistoryGraphs();
    this.shadowRoot.querySelector('#history-hours')?.addEventListener('change',e=>{this.historyHours=Number(e.target.value);this.load();});
  }
}
if(!customElements.get('thermal-pilot-panel'))customElements.define('thermal-pilot-panel',ThermalPilotPanel);
