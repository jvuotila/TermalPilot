/* Native custom panel. All data is escaped; settings are validated server-side. */
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const timeLabel = value => new Date(value).toLocaleString('en-GB',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'});
const entityLabel = state => state?.attributes?.friendly_name || (state?.entity_id?.split('.').slice(1).join('.').replace(/_/g,' ')) || 'Unavailable entity';
const sharedRoomKeys = new Set(['summer_setpoint','boost','setback','start_offset_minutes','stop_offset_minutes','lag_hours','curve_warm_temp','curve_cold_temp','water_entity','water_reference','apply_season_setpoints']);
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
  if(rule.kind==='relay')return ['binary_sensor','switch'].includes(domain);
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
function compareRoomNames(a,b){
  const first=String(a.name||'').trim(),second=String(b.name||'').trim();
  if(!first||!second)return first?-1:second?1:0;
  return first.localeCompare(second,undefined,{sensitivity:'base',numeric:true});
}
class ThermalPilotPanel extends HTMLElement {
  constructor(){super();this.attachShadow({mode:'open'});this.tab='overview';this.historyHours=48;}
  set hass(value){this._hass=value;if(this.isConnected && !this.loaded && !this.loading)this.load();}
  set panel(value){this._panel=value;if(this.isConnected && this._hass && !this.loaded)this.load();}
  connectedCallback(){if(this._hass)this.load();this.timer=setInterval(()=>{if(this.tab!=='settings')this.load();},60000);}
  disconnectedCallback(){clearInterval(this.timer);}
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
    const [key,label,type,min,max]=field;const value=obj[key];const name=`${prefix}.${key}`;
    let input;
    if(type==='bool')input=`<input type="checkbox" data-field="${name}" ${value?'checked':''}>`;
    else if(type.startsWith('select:'))input=`<select data-field="${name}">${type.slice(7).split(',').map(v=>`<option ${v===value?'selected':''} value="${escapeHTML(v)}">${escapeHTML(v)}</option>`).join('')}</select>`;
    else if(type==='number')input=`<input type="number" step="any" min="${min}" max="${max}" data-field="${name}" value="${escapeHTML(value)}">`;
    else if(type==='text')input=`<input data-field="${name}" value="${escapeHTML(value)}">`;
    else{
      const domains=type.split(','),rule=field[3]||{};const entities=Object.values(this._hass.states).filter(s=>domains.includes(s.entity_id.split('.')[0])&&entityMatches(s,rule,obj)).sort((a,b)=>entityLabel(a).localeCompare(entityLabel(b)));
      const retained=value&&!entities.some(s=>s.entity_id===value)?`<option selected value="${escapeHTML(value)}">${escapeHTML(entityLabel(this._hass.states[value]))} (${this._hass.states[value]?'does not match filter':'unavailable'})</option>`:'';
      input=`<select data-field="${name}"><option value="">— Select / not used —</option>${retained}${entities.map(s=>`<option value="${escapeHTML(s.entity_id)}" ${s.entity_id===value?'selected':''}>${escapeHTML(entityLabel(s))}</option>`).join('')}</select>`;
    }
    return `<label><span>${escapeHTML(label)}</span>${input}</label>`;
  }
  settingsView(){
    const i=this.info;
    const rooms=this.settings.rooms.map((room,index)=>({room,index})).sort((a,b)=>compareRoomNames(a.room,b.room));
    return `<form id="settings"><section><h2>Data sources and shared settings</h2><p>The price source needs today/tomorrow lists or timestamped raw_today/raw_tomorrow lists. Select the correct unit and avoid adding grid charges or margin twice.</p><div class="grid">${i.source_fields.filter(f=>!sharedRoomKeys.has(f[0])).map(f=>this.field(f,this.settings,'source')).join('')}</div></section>
    <section><h2>Shared room settings</h2><p>These settings apply to every room. A supply-water sensor uses its state; a climate source uses its current_temperature attribute. The reference water temperature is a fixed calibration value.</p><div class="grid">${i.source_fields.filter(f=>sharedRoomKeys.has(f[0])).map(f=>this.field(f,this.settings,'source')).join('')}</div></section>
    <section><h2>Rooms</h2><p>Set the target temperature explicitly or use a helper. Thermostat relays use on/off states. Without a relay, the thermostat hvac_action attribute is used. Initial heating hours provide a starting estimate until room response is learned.</p>
    ${rooms.map(({room:r,index})=>`<details><summary>${escapeHTML(r.name||'New room')}</summary><div class="grid">${i.room_fields.map(f=>this.field(f,r,`room${index}`)).join('')}</div><button type="button" data-remove="${index}">Remove room</button><button type="button" data-reset="${escapeHTML(r.id)}">Reset learning for this room</button></details>`).join('')}
    <button type="button" id="add">Add room</button></section><div class="sticky"><button class="primary" type="submit">Save settings</button><span>${this.settings.apply_season_setpoints?'Season transitions change real thermostat setpoints':'Simulation only · device settings are never changed'}</span></div></form>`;
  }
  chart(rows,key,alternate){
    const values=rows.filter(r=>r[key]!==null&&r[key]!==undefined).map(r=>Number(r[key])).filter(Number.isFinite);if(!rows.length||!values.length)return '<p>No observation history yet.</p>';
    const low=values.reduce((a,b)=>Math.min(a,b),Infinity)-.5,high=values.reduce((a,b)=>Math.max(a,b),-Infinity)+.5;
    const first=Number(rows[0].time||Date.parse(rows[0].end)/1000),last=Number(rows.at(-1).time||Date.parse(rows.at(-1).end)/1000);
    const points=k=>rows.filter(r=>r[k]!==null&&r[k]!==undefined).map(r=>`${20+760*(Number(r.time||Date.parse(r.end)/1000)-first)/Math.max(1,last-first)},${150-120*(Number(r[k])-low)/(high-low)}`).join(' ');
    return `<svg viewBox="0 0 800 180" role="img" aria-label="Temperature development"><text x="2" y="18">${high.toFixed(1)} °C</text><line x1="20" y1="150" x2="780" y2="150" stroke="#aaa"/><polyline points="${points(key)}" fill="none" stroke="#1976d2" stroke-width="3"/>${alternate?`<polyline points="${points(alternate)}" fill="none" stroke="#e49025" stroke-width="2"/>`:''}<text x="20" y="175">${escapeHTML(timeLabel(first*1000))}</text><text x="600" y="175">${escapeHTML(timeLabel(last*1000))}</text></svg>`;
  }
  overview(){
    const data=this.info.data||{};const rooms=Object.entries(data.rooms||{}).sort((a,b)=>compareRoomNames(a[1],b[1]));
    return `<section><h2>Simulation status</h2><button id="toggle-active" class="primary">${this.settings.heating_enabled?'Set passive':'Set active'}</button><p>Effective operation: <strong>${data.heating_active===false?'Passive':'Active'}</strong>. An optional activation helper must also permit operation.</p><p>Stored samples: ${data.history_info?.rows??0} · local database ${((data.history_info?.bytes??0)/1048576).toFixed(1)} MiB</p><p>Collection: <strong>${data.collection?.collecting?'Active':'Paused'}</strong> · smoothed outdoor temperature ${data.collection?.average?.toFixed(1)??'—'} °C</p><p>Updated ${escapeHTML(data.updated?timeLabel(data.updated):'—')} · outdoors ${escapeHTML(data.outdoor)} °C · supply water ${escapeHTML(data.water??'—')} °C</p>${(data.warnings||[]).map(w=>`<p class="warning">${escapeHTML(w)}</p>`).join('')}</section>${!rooms.length?'<section>Add rooms on the Settings page.</section>':''}
    ${rooms.map(([id,r])=>{const p=r.plan,m=r.model||{};return `<section><h2>${escapeHTML(r.name)} <small>${p?(p.heat?'Boosted thermostat target':'Reduced thermostat target'):'No suggestion'}</small></h2><div class="metrics"><div>Measured<strong>${escapeHTML(r.temperature??'—')} °C</strong></div><div>Suggested setpoint<strong>${escapeHTML(p?.setpoint??'—')} °C</strong></div><div>Actual heating<strong>${r.actual_activity==null?'Unknown':r.actual_activity?'Active':'Inactive'}</strong></div><div>Short-term prediction error<strong>${m.mae==null?'—':m.mae.toFixed(3)+' °C'}</strong></div></div><p>${escapeHTML(r.error||p?.reason||'Waiting for data.')}</p><p>${escapeHTML(r.learning_note)} · samples ${m.samples||0} · heating ${(m.heated_hours||0).toFixed(1)} h / idle ${(m.idle_hours||0).toFixed(1)} h</p>
    ${p?`<h3>Thermostat timing</h3><p>Target changes include the shared start/stop offsets. The temperature forecast models the planned heating period; actual valve and heat-pump delays must be checked against observations.</p><div class="scroll"><table><thead><tr><th>Planned heating starts</th><th>Planned heating ends</th></tr></thead><tbody>${(p.sessions||[]).map(s=>`<tr><td>${escapeHTML(timeLabel(s.start))}</td><td>${escapeHTML(timeLabel(s.end))}</td></tr>`).join('')}</tbody></table><table><thead><tr><th>Change target at</th><th>Action</th><th>Target (°C)</th></tr></thead><tbody>${(p.commands||[]).map(c=>`<tr><td>${escapeHTML(timeLabel(c.time))}</td><td>${c.action==='raise'?'Raise':'Lower'}</td><td>${c.setpoint}</td></tr>`).join('')}</tbody></table></div>${this.chart(p.slots,'temperature')}<p>Blue: predicted temperature under the proposed plan. This outcome has not been observed.</p><div class="scroll"><table><thead><tr><th>Starts</th><th>Price ct/kWh</th><th>Suggestion</th><th>Setpoint °C</th><th>Prediction °C</th></tr></thead><tbody>${p.slots.map(s=>`<tr class="${s.heat?'heat':''}"><td>${escapeHTML(timeLabel(s.start))}</td><td>${s.price.toFixed(2)}</td><td>${s.heat?'Store heat':'Idle'}</td><td>${s.setpoint}</td><td>${s.temperature.toFixed(2)}</td></tr>`).join('')}</tbody></table></div>`:''}</section>`;}).join('')}`;
  }
  historyView(){
    return `<section><h2>Observations and suggestions</h2><label>Period<select id="history-hours">${[24,48,168,720].map(h=>`<option value="${h}" ${h===this.historyHours?'selected':''}>${h} hours</option>`).join('')}</select></label><button id="export">Download observations as CSV</button><p>Blue: measured temperature. Orange: short-term prediction from the preceding observation and actual heating. This validates the model, not counterfactual savings.</p></section>
    <section><h2>Season archives</h2><p>Learned parameters and season aggregates are retained when old observations are compacted.</p>${(this.info.data?.season_summaries||[]).map(a=>`<p>${escapeHTML(a.season)} · ${escapeHTML(this.settings.rooms.find(r=>r.id===a.room_id)?.name||a.room_id)} · ${a.statistics?.samples||0} observations · loss ${(a.model?.loss||0).toFixed(4)} · heating gain ${(a.model?.gain||0).toFixed(3)}</p>`).join('')||'<p>No completed heating season yet.</p>'}</section>${[...this.settings.rooms].sort(compareRoomNames).map(room=>{const rows=(this.history||[]).filter(r=>r.room_id===room.id);const recent=rows.slice(-288);return `<section><h2>${escapeHTML(room.name)}</h2>${this.chart(rows,'temperature','prediction')}<div class="scroll"><table><thead><tr><th>Time</th><th>Suggested run</th><th>Actual heating</th><th>Measured °C</th><th>Suggested setpoint °C</th></tr></thead><tbody>${recent.reverse().map(r=>`<tr><td>${escapeHTML(timeLabel(r.time*1000))}</td><td>${r.suggested_heat===null?'—':r.suggested_heat?'Heating':'Idle'}</td><td>${r.activity===null?'—':r.activity?'Active':'Inactive'}</td><td>${r.temperature}</td><td>${r.suggested_setpoint??'—'}</td></tr>`).join('')}</tbody></table></div><p>Table shows up to 288 latest samples. CSV includes the selected period.</p></section>`;}).join('')}`;
  }
  capture(){this.shadowRoot.querySelectorAll('[data-field]').forEach(input=>{const [prefix,key]=input.dataset.field.split('.');const obj=prefix==='source'?this.settings:this.settings.rooms[Number(prefix.slice(4))];obj[key]=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;});}
  render(){
    this.shadowRoot.innerHTML=`<style>:host{display:block;color:var(--primary-text-color,#213547);background:var(--primary-background-color,#f5f7fa);min-height:100vh;font:15px system-ui}*{box-sizing:border-box}header,main{max-width:1250px;margin:auto;padding:24px}h1{margin:0 0 8px}h2{font-size:21px}small{font-size:14px;font-weight:normal}nav{display:flex;gap:8px;margin-top:18px}button{border:1px solid #aac0c8;border-radius:8px;padding:10px 16px;background:var(--card-background-color,white);color:inherit;cursor:pointer;margin:4px}button.active,.primary{background:#087c85;color:white}section{background:var(--card-background-color,white);border:1px solid var(--divider-color,#dce4e8);border-radius:14px;padding:24px;margin:0 0 20px}.badge{color:#087c85;font-weight:600}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:18px}label{display:flex;flex-direction:column;gap:7px}input,select{width:100%;padding:10px;border:1px solid #aabdc5;border-radius:6px;color:inherit;background:var(--card-background-color,white)}input[type=checkbox]{width:22px;height:22px}details{border-top:1px solid #ddd;padding:18px 0}summary{font-weight:600;cursor:pointer;margin-bottom:20px}.sticky{position:sticky;bottom:0;background:var(--card-background-color,white);padding:12px;box-shadow:0 -2px 8px #0001}.metrics{display:flex;gap:24px;flex-wrap:wrap}.metrics strong{display:block;font-size:24px;margin-top:8px}.warning,.message{padding:12px;background:#ffb30022;border-radius:8px}.scroll{overflow:auto;max-height:420px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #ddd;white-space:nowrap}.heat{background:#00857718}svg{width:100%;max-height:230px}svg text{fill:var(--primary-text-color,#213547);font-size:12px}p{line-height:1.6}@media(max-width:600px){header,main{padding:12px}section{padding:16px}}</style>
    <header><h1>ThermalPilot</h1><div class="badge">${this.settings?.apply_season_setpoints?'SEASON SETPOINT CONTROL ENABLED · heating schedules remain simulated':'SIMULATION · your existing automation remains in control'}</div><nav>${[['overview','Plan'],['history','History'],['settings','Settings']].map(([id,label])=>`<button data-tab="${id}" class="${this.tab===id?'active':''}">${label}</button>`).join('')}</nav>${this.message?`<p class="message">${escapeHTML(this.message)}</p>`:''}</header><main>${!this.info?'Loading…':this.tab==='settings'?this.settingsView():this.tab==='history'?this.historyView():this.overview()}</main>`;
    this.shadowRoot.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{this.tab=b.dataset.tab;this.loaded=false;this.load();});
    this.shadowRoot.querySelector('#toggle-active')?.addEventListener('click',async()=>{try{await this.call('save',{settings:{...this.settings,heating_enabled:!this.settings.heating_enabled}});this.settings.heating_enabled=!this.settings.heating_enabled;this.message='Activity setting saved. Effective status updates shortly.';this.render();}catch(error){this.message=error.message;this.render();}});
    this.shadowRoot.querySelector('#add')?.addEventListener('click',()=>{this.capture();this.settings.rooms.push({...this.info.room_defaults,id:roomId()});this.render();});
    this.shadowRoot.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{this.capture();this.settings.rooms.splice(Number(b.dataset.remove),1);this.render();});
    this.shadowRoot.querySelectorAll('[data-reset]').forEach(b=>b.onclick=async()=>{if(!confirm('Reset the learned parameters for this room? Observation history will be retained.'))return;try{await this.call('reset',{room_id:b.dataset.reset});this.message='Room learning reset.';}catch(e){this.message=e.message;}this.capture();this.render();});
    this.shadowRoot.querySelector('#settings')?.addEventListener('submit',async e=>{e.preventDefault();this.capture();try{await this.call('save',{settings:this.settings});this.message='Settings saved. Suggestions will update shortly.';}catch(error){this.message=error.message||String(error);}this.render();});
    this.shadowRoot.querySelector('#history-hours')?.addEventListener('change',e=>{this.historyHours=Number(e.target.value);this.load();});
    this.shadowRoot.querySelector('#export')?.addEventListener('click',()=>{const keys=['room_id','time','temperature','outdoor','activity','actual_setpoint','prediction','suggested_heat','suggested_setpoint'];const csv=[keys.join(','),...(this.history||[]).map(r=>keys.map(k=>r[k]??'').join(','))].join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='thermal-pilot-history.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);});
  }
}
if(!customElements.get('thermal-pilot-panel'))customElements.define('thermal-pilot-panel',ThermalPilotPanel);
