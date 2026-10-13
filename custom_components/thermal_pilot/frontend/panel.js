/* Native custom panel. All data is escaped; settings are validated server-side. */
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateLabel = value => new Date(value).toLocaleDateString('fi-FI',{day:'2-digit',month:'2-digit',year:'numeric'});
const timeLabel = value => `${dateLabel(value)} ${new Date(value).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',hour12:false})}`;
const entityLabel = state => state?.attributes?.friendly_name || (state?.entity_id?.split('.').slice(1).join('.').replace(/_/g,' ')) || 'Unavailable entity';
const settingHelp = {
  language: 'Choose the interface language. Room and entity names remain unchanged. Save settings to keep the choice. Embedded Home Assistant history cards use Home Assistant’s own language preference.',
  start_offset_minutes: 'Water-based systems only: raise the thermostat target this many minutes before the planned heat-delivery session, allowing slow valves to open. Electric and air distribution ignore this setting and use no advance offset.',
  stop_offset_minutes: 'Water-based systems only: lower the thermostat target this many minutes before the planned heat-delivery session ends, allowing valves to close. Electric and air distribution ignore this setting and use no closing offset.',
  house_heat_source: 'What produces heat for your house. Select air-to-water for your water floor system supplied by an air-source heat pump. Gas, oil, wood and district heating need their own fuel-cost logic; choosing a house detail does not yet enable a different controller or reset learned room data.',
  house_distribution: 'How heat reaches rooms: circulating water in floors or radiators, electric floor/ceiling/panels, or warm air. Mixed means different rooms use different systems. Water distribution can optionally use a heating-water sensor and uses valve timing. Electric and warm-air distribution ignore those inputs and learn response from observed thermostat demand. Mixed and Other retain water requirements until room overrides are supported.',
  house_heated_floor: 'The construction around floor heating, which affects how slowly heat is stored and released. Concrete slab describes your heated floor. Choose Not applicable if there is no floor heating. This does not change your configured response lag or erase learned parameters.',
  house_foundation: 'The structure below your home: slab on ground, crawl space or basement. A heated concrete floor can be above a basement, so this is separate from Heated floor. Choose Unknown if unsure. This descriptive setting does not reset observation history or learned models.',

  solar_direction: 'Sunlight through large windows, especially south-facing windows, can warm a room. No additional physical solar heating system is needed. Select the main direction of those windows to enable solar estimates, or Solar heating off to turn them off. Home Assistant’s location determines seasonal sun elevation and azimuth; cloud conditions come from your weather source. The effect starts at zero and learns gradually. Missing sunlight data assumes no solar warmth; room temperature limits still apply.',
  solar_exposure: 'Clear means the windows receive direct sunlight without major obstructions. Choose Partly shaded for some trees, buildings or overhangs, or Mostly shaded when sunlight is usually blocked. Forecasts use a more cautious solar allowance: partly shaded uses 65% and mostly shaded 30% of the clear allowance. Actual room warming is still learned from observations; no solar heat is assumed before learning. Seasonal leaf cover and changing shading can still affect accuracy.',
  wind_entity: 'Optional local wind sensor, for example sensor.netatmo_tuuli_ms using m/s. Valid readings are averaged over the last 30 minutes. ThermalPilot learns a separate wind effect only after enough varied observations; no fixed wind penalty is assumed. Missing, invalid or unchanged-for-two-hours readings are ignored, and normal temperature-based planning and heating continue. Fresh wind correction gradually returns to typical conditions in forecasts further ahead. A stable calm reading may also be ignored conservatively. Units are detected automatically.',
  minimum: 'Emergency lower temperature limit shared by all rooms. Each room’s own target is the normal comfort goal. ThermalPilot prioritizes avoiding this limit even when electricity is expensive; this value is not the idle thermostat target.',
  maximum: 'Upper temperature limit shared by all rooms. Extra heating and heat storage must stay within this limit.',
  price_forecast_entity: 'Optional sensor with forecast timestamp/value entries, such as Nordpool Predict FI. Only relative expensive/cheap patterns after confirmed prices are used, so no forecast price unit or additional costs are required. The Source price unit setting applies only to the confirmed total-price sensor. An expensive upcoming period can increase the heat reserve at the end of the known-price plan. Forecast prices are not compared directly with your total prices, used as confirmed prices or used to execute future heating commands. Missing forecasts keep normal planning. Confirmed prices always determine the executable schedule.',
  sensor_warning_hours: 'Notify in Home Assistant when a room temperature sensor stays unchanged or unavailable for this many hours. A stable room can also have an unchanged reading, so the warning asks you to check the sensor. ThermalPilot sends at most one sensor notification per calendar day. Monitoring runs while ThermalPilot is active; long monitoring gaps restart the timer.',
  summer_minimum_temperature: 'Summer fallback always applies from 15.5. through 30.9. Outside those dates, it also applies when the day’s lowest forecast temperature is equal to or above this value. For example, a setting of 6°C means the daily minimum must be at least 6°C for ThermalPilot to use summer fallback temperatures. Lower readings already observed that day are included. If a full-day forecast is unavailable outside the summer dates, winter fallback is used.',
  fireplace_reduction: 'Negative values reduce estimated heat loss while the fireplace is active; −20% means a 20% reduction.',
  price_entity: 'The price lists must include VAT, grid charges, electricity tax and retailer margin. ThermalPilot uses these final prices directly. Select a source containing today/tomorrow or timestamped raw_today/raw_tomorrow price lists, and choose the matching source price unit.',
  pricing_mode: 'Hourly average uses fixed hourly averages of the source prices. 15 minutes plans using quarter-hour intervals. Flexible builds heating sessions in 15-minute steps, allowing runs such as 60 or 75 minutes while respecting the minimum flexible heating run.',
  minimum_run_minutes: 'The shortest planned heating session in flexible scheduling mode. Longer sessions can be chosen in 15-minute steps. This setting applies to flexible runs; valve opening and closing offsets are applied separately.',
  lag_hours: 'Initial estimate of how slowly heat input affects room temperature and how long its effect persists. Concrete slabs often need a longer delay, but lightweight floors, radiators, electric heaters and air systems also have a response time. Use a shorter value for faster systems. This remains relevant to every distribution; it is separate from valve opening or closing time.',
  curve_warm_temp: 'The warm outdoor endpoint of the initial heating-hours curve. At this temperature or warmer, the starting model assumes the lower daily heating need. This curve seeds the model before enough real heating and cooling observations are available.',
  curve_cold_temp: 'The cold outdoor endpoint of the initial heating-hours curve. At this temperature or colder, the starting model assumes the higher daily heating need. Set it below the warm endpoint. Actual room response is learned from observations.',
  apply_season_setpoints: 'Allows real thermostat setpoint changes when ThermalPilot changes between Active and Passive. Active applies each room’s target temperature; Passive applies the seasonal fallback: the shared summer setpoint or each room’s normal target in winter. These commands can occur even with simulation enabled. This does not enable live heating schedule control.',
  summer_setpoint: 'The thermostat target used for all configured rooms while ThermalPilot is Passive, if real Active/Passive season setpoint control is enabled. A low summer target normally prevents heating without switching off the thermostats.',
  boost: 'Degrees added to each room’s target temperature during a suggested heating window. For example, a 20 °C target with a 1.5 °C boost suggests a 21.5 °C thermostat setpoint to store heat. Scheduled targets remain simulated in this version.',
  setback: 'Negative values temporarily lower the thermostat target during expensive electricity hours. After a planned heating session, ThermalPilot first restores the room’s normal target. It then chooses reduction only when predicted stored warmth can avoid thermostat heating while supporting room comfort. For example, −1°C allows a 20°C target to be reduced to 19°C during selected costly hours. The reduced target never goes below Minimum allowed temperature. Normal target is restored when reduction is no longer useful; a new planned heating session uses the boosted target. Duration is chosen by the plan, not a fixed number of hours.',
  water_entity: 'Select the measured supply-water temperature. A temperature sensor uses its state; a climate entity uses its current_temperature attribute. This is the measured water temperature, not the thermostat’s target. Optional for water-based systems. A valid reading adjusts the estimated heating output. Without it, planning and learning continue from observed thermostat demand, without a water-temperature adjustment. Missing readings do not force fallback targets.',
  simulation_enabled: 'Simulation calculates heating suggestions without applying scheduled targets. Disable simulation and confirm to enable real thermostat control. Disable your existing heating automation first. Observation and learning continue in both modes.',
};
const sourceSettingGroups = [
  ['Integration settings',['heating_enabled','simulation_enabled','language']],
  ['Electricity price settings',['price_entity','price_forecast_entity','price_unit','pricing_mode']],
  ['Weather and forecast settings',['weather_entity','outdoor_entity','wind_entity','summer_minimum_temperature']],
  ['Heating settings',['minimum_run_minutes','fireplace_entity','fireplace_active_state']],
  ['Miscellaneous',['sensor_warning_hours']],
];
const sharedSettingGroups = [
  ['Thermostat settings',['summer_setpoint','minimum','maximum','boost','setback','apply_season_setpoints']],
];
const houseOptionLabels={air_to_water:'Air-to-water heat pump',ground_source:'Ground-source heat pump',air_to_air:'Air-to-air heat pump',electric_resistance:'Electric resistance',oil_boiler:'Oil boiler',gas_boiler:'Gas boiler',wood_boiler:'Wood boiler',pellet_boiler:'Pellet boiler',district_heating:'District heating',water_floor:'Water floor heating',water_radiators:'Water radiators',electric_floor:'Electric floor heating',electric_ceiling:'Electric ceiling heating',electric_panels:'Electric panels',warm_air:'Warm air',mixed:'Mixed',concrete_slab:'Concrete slab',thin_screed:'Thin screed',lightweight:'Lightweight floor',not_applicable:'Not applicable',slab_on_ground:'Slab on ground',crawl_space:'Crawl space',basement:'Basement',other:'Other',unknown:'Unknown'};
const schedulingLabels = {hourly:'hourly average',quarterly:'15 minutes',flexible:'flexible'};

function electricHeating(settings){return ['air_to_water','ground_source','air_to_air','electric_resistance'].includes(settings?.house_heat_source||'air_to_water');}

function waterDistribution(settings){return !['electric_floor','electric_ceiling','electric_panels','warm_air'].includes(settings?.house_distribution);}

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
  if(rule.kind==='wind')return domain==='sensor'&&['m/s','km/h','mph','kn','knots'].includes(unit);
  if(rule.kind==='power')return deviceClass==='power'||(!deviceClass&&['w','kw'].includes(unit));
  if(rule.kind==='price_forecast')return domain==='sensor'&&Array.isArray(attrs.forecast);
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
const priceThresholds=[[0,'#40ff00'],[15,'#ccff66'],[20,'#ffff00'],[25,'#ffcc00'],[35,'#ff9933'],[50,'#ff0000'],[60,'#cc0000']];
 const priceColor=price=>priceThresholds.findLast(([value])=>price>=value)?.[1]||priceThresholds[0][1];

const outdoorThresholds=[[-30,'#154360'],[-25,'#1B4F72'],[-20,'#2874A6'],[-10,'#3498DB'],[-5,'#85C1E9'],[0,'#82E0AA'],[5,'#2ECC71'],[10,'#239B56'],[20,'#186A3B'],[25,'#B7950B'],[30,'#CB4335'],[35,'#E74C3C']];
const outdoorColor=value=>{
  if(value<=outdoorThresholds[0][0])return outdoorThresholds[0][1];
  for(let i=1;i<outdoorThresholds.length;i++){
    const [upper,b]=outdoorThresholds[i],[lower,a]=outdoorThresholds[i-1];
    if(value<=upper){
      const fraction=(value-lower)/(upper-lower);
      const channel=offset=>Math.round(parseInt(a.slice(offset,offset+2),16)*(1-fraction)+parseInt(b.slice(offset,offset+2),16)*fraction).toString(16).padStart(2,'0');
      return '#'+channel(1)+channel(3)+channel(5);
    }
  }
  return outdoorThresholds.at(-1)[1];
};
function durationLabel(milliseconds){
  const minutes=Math.max(0,Math.round(milliseconds/60000));
  if(!minutes&&milliseconds>0)return 'Less than 1 min';
  const hours=Math.floor(minutes/60),remaining=minutes%60;
  return hours?`${hours} h${remaining?` ${remaining} min`:''}`:`${remaining} min`;
}
function statusMessageLevel(text){
  if(text.startsWith('Observation only:')||text.startsWith('ThermalPilot is passive.')||text.startsWith('Heating water temperature is not available;'))return 'info';
  if(text.startsWith('Thermostat control:'))return text.includes('fallback targets are being used')?'warning':'error';
  if(/season setpoint.*(failed|could not|outside)/i.test(text))return 'error';
  return 'warning';
}
function statusIcon(level){
  const shape=level==='warning'?'<path d="M12 3 22 21H2Z"/><path d="M12 9v5m0 3h.01"/>':level==='error'?'<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/>':'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>';
  return `<svg class="notice-icon" viewBox="0 0 24 24" aria-hidden="true">${shape}</svg><span class="notice-level">${level[0].toUpperCase()+level.slice(1)}: </span>`;
}
function statusNotice(text,level='info',extra=''){
  const safeLevel=['error','warning','info'].includes(level)?level:'info';
  return `<p class="notice notice-${safeLevel} ${extra}" role="${safeLevel==='error'?'alert':'status'}">${statusIcon(safeLevel)}<span class="notice-text">${escapeHTML(text)}</span></p>`;
}
const finnishText={"Plan": "Suunnitelma", "History": "Historia", "Settings": "Asetukset", "Language": "Kieli", "ThermalPilot settings": "ThermalPilot-asetukset", "House heating settings": "Talon lämmitysasetukset", "Shared room settings": "Huoneiden yhteiset asetukset", "Rooms": "Huoneet", "Integration settings": "Integraation asetukset", "ThermalPilot active": "ThermalPilot käytössä", "Enable simulation": "Simulointi käytössä", "Electricity price settings": "Sähkön hinta-asetukset", "Price sensor with additional costs": "Sähkön kokonaishinta", "Price forecast (optional)": "Hintaennuste (valinnainen)", "Source price unit": "Hintatiedon yksikkö", "Scheduling mode": "Suunnittelutapa", "Weather and forecast settings": "Sää ja ennusteet", "Weather forecast source": "Sääennusteen lähde", "Outdoor temperature": "Ulkolämpötila", "Wind speed (optional)": "Tuulen nopeus (valinnainen)", "Summer temperature (°C)": "Kesälämpötila (°C)", "Heating settings": "Lämmityksen asetukset", "Minimum flexible heating run (minutes)": "Lämmitysjakson vähimmäiskesto (min)", "Fireplace activity sensor (optional)": "Takan tilatieto (valinnainen)", "Fireplace active value": "Takan aktiivinen tila", "Miscellaneous": "Muut asetukset", "Sensor warning delay (hours)": "Anturivaroituksen viive (h)", "House and heating": "Talo ja lämmitys", "Heat source": "Lämmönlähde", "Heat distribution": "Lämmönjako", "Heated floor": "Lämmitetty lattia", "Foundation": "Perustus", "Water heating": "Vesikiertoinen lämmitys", "Heating water (optional)": "Lämmitysvesi (valinnainen)", "Raise thermostat before heating starts (minutes)": "Venttiilin avausennakko (min)", "Lower thermostat before heating stops (minutes)": "Venttiilin sulkuennakko (min)", "Heating response": "Lämmityksen vaste", "Estimated thermal response lag (hours)": "Lämmityksen vasteviive (h)", "Warm outdoor endpoint (°C)": "Lämmin ulkolämpötilapiste (°C)", "Cold outdoor endpoint (°C)": "Kylmä ulkolämpötilapiste (°C)", "Thermostat settings": "Termostaattiasetukset", "Shared summer thermostat setpoint (°C)": "Kesän asetuslämpötila (°C)", "Minimum allowed temperature (°C)": "Alin sallittu lämpötila (°C)", "Maximum allowed temperature (°C)": "Ylin sallittu lämpötila (°C)", "Heating setpoint boost (°C)": "Lämmityksen korotus (°C)", "Peak-hour reduction (°C)": "Kalliiden tuntien alennus (°C)", "Apply season setpoints": "Kausiasetukset käyttöön", "Room name": "Huoneen nimi", "Thermostat": "Termostaatti", "Room temperature sensor": "Huoneen lämpötila-anturi", "Thermostat relay (optional)": "Termostaatin rele (valinnainen)", "Target temperature (°C)": "Tavoitelämpötila (°C)", "Fireplace heating compensation": "Takan lämpövaikutus", "Window direction": "Ikkunoiden suunta", "Sun exposure": "Auringonvalo", "Solar heating off": "Aurinkolämpö pois käytöstä", "North": "Pohjoinen", "Northeast": "Koillinen", "East": "Itä", "Southeast": "Kaakko", "South": "Etelä", "Southwest": "Lounas", "West": "Länsi", "Northwest": "Luode", "Clear": "Esteetön", "Partly shaded": "Osittain varjossa", "Mostly shaded": "Enimmäkseen varjossa", "Air-to-water heat pump": "Ilma-vesilämpöpumppu", "Ground-source heat pump": "Maalämpöpumppu", "Air-to-air heat pump": "Ilmalämpöpumppu", "Electric resistance": "Sähkövastus", "Oil boiler": "Öljykattila", "Gas boiler": "Kaasukattila", "Wood boiler": "Puukattila", "Pellet boiler": "Pellettikattila", "District heating": "Kaukolämpö", "Water floor heating": "Vesikiertoinen lattialämmitys", "Water radiators": "Vesikiertoiset patterit", "Electric floor heating": "Sähköinen lattialämmitys", "Electric ceiling heating": "Sähköinen kattolämmitys", "Electric panels": "Sähköpatterit", "Warm air": "Ilmalämmitys", "Mixed": "Useita lämmönjakotapoja", "Concrete slab": "Betonilaatta", "Thin screed": "Ohut pintavalu", "Lightweight floor": "Kevytrakenteinen lattia", "Not applicable": "Ei sovellu", "Slab on ground": "Maanvarainen laatta", "Crawl space": "Ryömintätila", "Basement": "Kellari", "Other": "Muu", "Unknown": "Tuntematon", "hourly average": "Tuntikeskiarvo", "15 minutes": "15 minuuttia", "flexible": "Joustava", "Add room": "Lisää huone", "Save settings": "Tallenna asetukset", "Unsaved changes": "Tallentamattomia muutoksia", "ThermalPilot status": "ThermalPilotin tila", "Operation": "Toiminta", "Active": "Aktiivinen", "Passive": "Passiivinen", "Paused": "Keskeytetty", "Simulation": "Simulointi", "Live control": "Lämmityksen ohjaus", "Live control paused": "Lämmityksen ohjaus keskeytetty", "Confirmation required": "Vahvistus tarvitaan", "Season setpoint control": "Kausilämpötilojen ohjaus", "Sources ready": "Tietolähteet kunnossa", "Sources missing": "Tietolähteitä puuttuu", "Sources not checked": "Tietolähteitä ei tarkistettu", "Data collection": "Tietojen keruu", "Data coverage:": "Tietojen kattavuus:", "Low": "Vähäinen", "Limited": "Rajallinen", "Developing": "Kehittyvä", "Good": "Hyvä", "High": "Laaja", "Stored history": "Tallennettu historia", "samples": "havaintoa", "Collection started:": "Keruu alkoi:", "No observations yet": "Ei vielä havaintoja", "Local database:": "Paikallinen tietokanta:", "Last update": "Viimeisin päivitys", "Latest calculation and observation.": "Viimeisin laskenta ja havainto.", "Heating water temperature": "Lämmitysveden lämpötila", "Observation and learning are enabled.": "Havainnointi ja oppiminen ovat käytössä.", "Observation and learning are stopped.": "Havainnointi ja oppiminen on pysäytetty.", "Summer fallback": "Kesän varalämpötila", "Winter fallback": "Talven varalämpötila", "Electricity prices and heating": "Sähkön hinnat ja lämmitys", "Total electricity price (c/kWh)": "Sähkön kokonaishinta (c/kWh)", "Suggested heating window": "Suunniteltu lämmitysjakso", "Actual thermostat relay": "Termostaatin todellinen reletila", "Now": "Nyt", "Suggested": "Suunniteltu", "Relay": "Rele", "Actual relay": "Todellinen reletila", "Suggested heating": "Suunniteltu lämmitys", "On": "Päällä", "Off": "Pois", "Start:": "Alku:", "Stop:": "Loppu:", "End:": "Loppu:", "First observed On": "Ensimmäinen päällä-havainto", "Observed until": "Havaittu tähän asti", "Observed duration": "Havaittu kesto", "Duration": "Kesto", "Electricity price:": "Sähkön hinta:", "Less than 1 min": "Alle 1 min", "Times are based on recorded observations; gaps are not filled.": "Ajat perustuvat tallennettuihin havaintoihin. Puuttuvia tietoja ei täytetä.", "Price forecast available · No extra heat storage needed.": "Hintaennuste saatavilla · Lisälämmön varastointia ei tarvita.", "Price forecast available · Extra heat storage considered ahead of expensive hours.": "Hintaennuste saatavilla · Lisälämmön varastointia harkitaan ennen kalliita tunteja.", "Price forecast:": "Hintaennuste:", "Waiting for confirmed prices.": "Odotetaan vahvistettuja hintoja.", "Room heat retention": "Huoneiden lämmön säilyminen", "Room": "Huone", "6-hour loss": "Lämpötilan lasku 6 tunnissa", "1°C drop": "Yhden asteen lasku", "Model": "Malli", "Initial estimate": "Alkuarvio", "Adapting": "Mukautuva", "Measured": "Mitattu", "Suggested thermostat target": "Suunniteltu asetuslämpötila", "Actual heating": "Todellinen lämmitys", "3-hour forecast error": "3 tunnin ennusteen virhe", "Boosted thermostat target": "Korotettu asetuslämpötila", "Normal thermostat target temperature": "Normaali asetuslämpötila", "Reduced thermostat target temperature": "Alennettu asetuslämpötila", "No suggestion": "Ei ehdotusta", "Waiting for data.": "Odotetaan tietoja.", "Initial data collection": "Alkutietojen keruu", "Heating": "Lämmitys", "Idle": "Lepotila", "Initial observation thresholds reached.": "Alkuhavaintojen vähimmäismäärät saavutettu.", "Estimated initial-data completion:": "Alkutietojen arvioitu valmistuminen:", "Thermostat timing": "Termostaatin ajoitus", "Planned heating starts": "Suunniteltu lämmitys alkaa", "Planned heating ends": "Suunniteltu lämmitys päättyy", "No heating sessions planned.": "Lämmitysjaksoja ei ole suunniteltu.", "Change target at": "Asetuslämpötilan muutos", "Action": "Toiminto", "Target (°C)": "Asetuslämpötila (°C)", "No thermostat target changes planned.": "Asetuslämpötilan muutoksia ei ole suunniteltu.", "Starts": "Alkaa", "Price (c/kWh)": "Hinta (c/kWh)", "Suggestion": "Ehdotus", "Setpoint °C": "Asetuslämpötila °C", "Prediction °C": "Ennuste °C", "Store heat": "Varastoi lämpöä", "Normal": "Normaali", "Reduced": "Alennettu", "Boost": "Korota", "Restore normal": "Palauta normaali", "Reduce": "Alenna", "Observations and suggestions": "Havainnot ja ehdotukset", "Period": "Ajanjakso", "Season archives": "Kausiarkisto", "No completed heating season yet.": "Yhtään lämmityskautta ei ole vielä päättynyt.", "No observation history yet.": "Havaintohistoriaa ei vielä ole.", "Suggested heating and relay history": "Suunniteltu lämmitys ja relehistoria", "Open full Home Assistant history": "Avaa Home Assistantin koko historia", "Loading Home Assistant history…": "Ladataan Home Assistantin historiaa…", "Forecast accuracy": "Ennusteiden tarkkuus", "Chart forecast": "Kaavion ennuste", "Mean error:": "Keskimääräinen virhe:", "Measured temperature": "Mitattu lämpötila", "Measured temperature (°C)": "Mitattu lämpötila (°C)", "Suggested thermostat target (°C)": "Suunniteltu asetuslämpötila (°C)", "15-minute interval": "15 minuutin jakso", "Actual thermostat demand": "Termostaatin todellinen lämmityspyyntö", "No change": "Ei muutosta", "Similar heating": "Vastaava lämmitys", "Error:": "Virhe:", "Warning:": "Varoitus:", "Info:": "Tieto:", "Saving…": "Tallennetaan…", "Room learning reset.": "Huoneen oppimistiedot nollattu.", "Loading…": "Ladataan…", "— Select / not used —": "— Valitse / ei käytössä —", "Warn when room temperature readings stay unchanged or unavailable.": "Varoita, kun huonelämpötilan lukemat eivät muutu tai niitä ei saada.", "These settings apply to every room.": "Nämä asetukset koskevat kaikkia huoneita.", "Room response is learned from observed heating and cooling, starting with internal estimates.": "Huoneen vaste opitaan havaitusta lämmityksestä ja jäähtymisestä. Aluksi käytetään lähtöarvioita.", "Choose your heating system and building details. Heat distribution determines which sensor inputs are needed.": "Valitse lämmitysjärjestelmä ja rakennuksen tiedot. Lämmönjako määrittää tarvittavat anturit.", "Electric heating benefits mainly from changing electricity tariffs. Other heat sources use observation only: no schedules, no thermostat control and no required price sensor. Heat-pump efficiency and fuel costs are not modeled.": "Sähkölämmitys hyötyy ennen kaikkea muuttuvista sähkön hinnoista. Muilla lämmönlähteillä käytetään mukavuuden seurantaa: ei lämmitysaikatauluja, termostaattiohjausta tai pakollista hinta-anturia. Lämpöpumpun hyötysuhdetta ja polttoainekustannuksia ei mallinneta.", "Today and tomorrow · past thermostat activity and future heating suggestions": "Tänään ja huomenna · aiempi termostaattitoiminta ja tulevat lämmitysehdotukset", "No usable electricity price list is available.": "Käyttökelpoista sähkön hintalistaa ei ole saatavilla.", "No electricity prices are available for this period. Recorded thermostat activity is shown below.": "Tälle ajanjaksolle ei ole sähkön hintoja. Tallennettu termostaattitoiminta näkyy alla.", "ThermalPilot is passive. Planning, collection and learning are stopped.": "ThermalPilot on passiivinen. Suunnittelu, keruu ja oppiminen on pysäytetty.", "Price sensor is missing or unavailable.": "Hinta-anturi puuttuu tai ei ole saatavilla.", "No continuous prices from now: no heating plan is available.": "Nykyhetkestä alkavaa yhtenäistä hintatietoa ei ole. Lämmityssuunnitelmaa ei ole saatavilla.", "Optional wind sensor unavailable or stale; heating and temperature-based planning continue.": "Valinnainen tuulianturi ei ole saatavilla tai tieto on vanhentunut. Lämmitys ja lämpötilaan perustuva suunnittelu jatkuvat.", "Heating water temperature is not available; planning and learning use observed thermostat demand without water-temperature adjustment.": "Lämmitysveden lämpötilaa ei ole saatavilla. Suunnittelu ja oppiminen käyttävät havaittua lämmityspyyntöä ilman veden lämpötilakorjausta.", "Optional price forecast unavailable; planning uses confirmed prices and the normal heat reserve.": "Valinnainen hintaennuste ei ole saatavilla. Suunnittelu käyttää vahvistettuja hintoja ja tavallista lämpövaraa.", "Room temperature, outdoor temperature or target temperature is unavailable.": "Huonelämpötila, ulkolämpötila tai tavoitelämpötila ei ole saatavilla.", "Target temperature is outside the allowed temperature range.": "Tavoitelämpötila on sallitun alueen ulkopuolella.", "Temperature limit risk: review model assumptions and heating capacity.": "Lämpötilarajan ylittymisen tai alittumisen riski: tarkista mallin oletukset ja lämmitysteho.", "No boost planned: normal thermostat demand is sufficient to support the room target.": "Korotusta ei suunniteltu: normaali termostaatin lämmityspyyntö riittää tavoitelämpötilan ylläpitoon.", "Heat storage or a bridging run ahead of predicted cooling.": "Lämmön varastointi tai lämmitysjakso ennen ennustettua jäähtymistä.", "You have unsaved settings. Discard these changes and switch tabs?": "Asetuksia on tallentamatta. Hylätäänkö muutokset ja vaihdetaanko välilehteä?", "Changing heat distribution restarts room-response learning because the heating input changes. Recorded history is retained. Continue?": "Lämmönjaon muuttaminen aloittaa huonevasteen oppimisen uudelleen, koska lämmityksen tulkinta muuttuu. Tallennettu historia säilyy. Jatketaanko?", "Reset the learned parameters for this room? Observation history will be retained.": "Nollataanko tämän huoneen opitut parametrit? Havaintohistoria säilyy.", "Enable real thermostat control? Disable your existing heating automation first. ThermalPilot will apply its scheduled targets, even while the model is still learning. Missing essential data returns affected rooms to their seasonal fallback temperature.": "Otetaanko termostaattien todellinen ohjaus käyttöön? Poista ensin nykyinen lämmitysautomaatiosi käytöstä. ThermalPilot käyttää suunniteltuja asetuslämpötiloja myös oppimisen aikana. Jos tarvittavia tietoja puuttuu, huoneissa käytetään kauden varalämpötilaa.", "Open Home Assistant menu": "Avaa Home Assistantin valikko", "ThermalPilot pages": "ThermalPilotin välilehdet", "Summer is 15.5.–30.9.": "Kesä on 15.5.–30.9.", "Learning paused while collection is inactive.": "Oppiminen on keskeytetty, koska tietojen keruu ei ole käytössä.", "No observed heating activity: learning is waiting.": "Lämmitystoimintaa ei ole havaittu: oppiminen odottaa.", "No near-term forecast prices.": "Lähiajan hintaennustetta ei ole.", "No continuous next-day price forecast beyond confirmed prices.": "Vahvistettujen hintojen jälkeen ei ole yhtenäistä seuraavan päivän hintaennustetta.", "Simulation only · scheduled targets are not applied": "Vain simulointi · suunniteltuja asetuslämpötiloja ei käytetä", "Live control · disable your existing automation before saving": "Lämmityksen ohjaus · poista nykyinen automaatio käytöstä ennen tallennusta", "SIMULATION · your existing automation remains in control": "SIMULOINTI · nykyinen automaatiosi ohjaa edelleen lämmitystä", "LIVE CONTROL · ThermalPilot controls thermostat targets": "LÄMMITYKSEN OHJAUS · ThermalPilot ohjaa termostaattien asetuslämpötiloja", "LIVE CONTROL PAUSED · seasonal fallback targets": "LÄMMITYKSEN OHJAUS KESKEYTETTY · kauden varalämpötilat", "Blue: predicted temperature under the proposed plan. This outcome has not been observed.": "Sininen: ehdotetun suunnitelman ennustama lämpötila. Tätä tulosta ei ole vielä havaittu.", "Target changes include the shared start/stop offsets. The temperature forecast models the planned heating period; actual valve and heat-pump delays must be checked against observations.": "Asetuslämpötilan muutoksissa huomioidaan yhteiset aloitus- ja lopetusennakot. Ennuste mallintaa suunnitellun lämmityksen. Venttiilien ja lämpöpumpun todelliset viiveet on tarkistettava havainnoista.", "These forecasts were saved 1, 3 or 6 hours before the measurements. Later readings do not change them. Lower error is better; compare it with simply predicting no temperature change. Different heating, computers and other heat sources can affect the result.": "Nämä ennusteet tallennettiin 1, 3 tai 6 tuntia ennen mittauksia. Myöhemmät lukemat eivät muuta niitä. Pienempi virhe on parempi. Vertaa ennustetta siihen, että lämpötilan oletetaan pysyvän samana. Lämmityksen muutokset, tietokoneet ja muut lämmönlähteet voivat vaikuttaa tulokseen.", "Compare recorded temperatures with forecasts saved hours earlier. The accuracy cards also compare against predicting no temperature change. Forecasts assume the proposed heating plan; actual heating may differ, especially during simulation.": "Vertaa mitattuja lämpötiloja tunteja aiemmin tallennettuihin ennusteisiin. Tarkkuuskortit vertaavat tulosta myös muuttumattoman lämpötilan oletukseen. Ennuste perustuu ehdotettuun lämmityssuunnitelmaan; todellinen lämmitys voi poiketa siitä etenkin simuloinnin aikana.", "Forecasts are compared with measurements within five minutes of their due time. “Similar heating” means observed demand matched the forecast for at least 90% of observations, with no large recording gaps. These counts give context, not a guarantee of accuracy.": "Ennusteita verrataan mittauksiin enintään viiden minuutin aikaerolla. ”Vastaava lämmitys” tarkoittaa, että havaittu lämmityspyyntö vastasi ennustetta vähintään 90 %:ssa havainnoista eikä tallennuksessa ollut suuria aukkoja. Määrät auttavat tulkinnassa, mutta eivät takaa tarkkuutta.", "Each row shows the latest observation within its 15-minute interval, not an average. Suggested thermostat target is the setting ThermalPilot would apply, not a room-temperature forecast. Table shows up to 288 intervals. Original observations remain stored internally. Short chart views use 15-minute time labels; longer views use wider intervals.": "Jokainen rivi näyttää 15 minuutin jakson viimeisimmän havainnon, ei keskiarvoa. Suunniteltu asetuslämpötila on ThermalPilotin käyttämä termostaattiasetus, ei huonelämpötilan ennuste. Taulukossa on enintään 288 jaksoa. Alkuperäiset havainnot säilyvät tallennettuina. Lyhyissä näkymissä aikamerkinnät ovat 15 minuutin välein, pidemmissä harvemmin.", "Suggested On means the boosted target window, including valve timing offsets. Relay On means observed demand; it does not guarantee heat flow.": "Suunniteltu Päällä tarkoittaa korotetun asetuslämpötilan jaksoa venttiilien ennakot huomioiden. Releen Päällä tarkoittaa havaittua lämmityspyyntöä, eikä takaa lämmön virtausta.", "Compare rooms under the same conditions:": "Vertaa huoneita samoissa olosuhteissa:", "20°C indoors, −10°C outdoors": "sisällä 20°C, ulkona −10°C", ", without heating, remaining slab warmth or appliance heat. Lower temperature loss means slower modeled cooling. This is a model estimate, not measured energy efficiency or an insulation rating.": ", ilman lämmitystä, laatan jälkilämpöä tai laitteiden lämpöä. Pienempi lämpötilan lasku tarkoittaa hitaampaa mallinnettua jäähtymistä. Tämä on mallin arvio, ei mitattu energiatehokkuus tai eristyksen luokitus.", "Initial rooms share starting estimates. Comparisons become more useful as their heat-loss parameters adapt to observations. Wind, ventilation, sensor placement and unmeasured heat sources can affect the estimates. The listed time describes this reference test, not how long heating can safely remain off in your home.": "Aluksi huoneissa käytetään samoja lähtöarvioita. Vertailu tarkentuu lämpöhäviöparametrien mukautuessa havaintoihin. Tuuli, ilmanvaihto, anturin sijainti ja mittaamattomat lämmönlähteet voivat vaikuttaa arvioon. Aika kuvaa tätä vertailukoetta, ei turvallista lämmityksen poiskytkentäaikaa kotonasi.", "Learned parameters and season aggregates are retained when old observations are compacted.": "Opitut parametrit ja kausiyhteenvedot säilyvät, kun vanhoja havaintoja tiivistetään.", "Open a Home Assistant dashboard once, then return here to load embedded history cards.": "Avaa ensin Home Assistantin kojelauta ja palaa sitten tänne ladataksesi historiakortit.", "Water-based systems only: raise the thermostat target this many minutes before the planned heat-delivery session, allowing slow valves to open. Electric and air distribution ignore this setting and use no advance offset.": "Vain vesikiertoisille järjestelmille: korota asetuslämpötilaa näin monta minuuttia ennen suunniteltua lämmitystä, jotta hitaat venttiilit ehtivät avautua. Sähkö- ja ilmalämmitys eivät käytä tätä ennakkoa.", "Water-based systems only: lower the thermostat target this many minutes before the planned heat-delivery session ends, allowing valves to close. Electric and air distribution ignore this setting and use no closing offset.": "Vain vesikiertoisille järjestelmille: alenna asetuslämpötilaa näin monta minuuttia ennen suunnitellun lämmityksen loppua, jotta venttiilit ehtivät sulkeutua. Sähkö- ja ilmalämmitys eivät käytä tätä ennakkoa.", "What produces heat for your house. Select air-to-water for your water floor system supplied by an air-source heat pump. Gas, oil, wood and district heating need their own fuel-cost logic; choosing a house detail does not yet enable a different controller or reset learned room data.": "Talon lämmön tuottava laite. Ilma-vesilämpöpumppu tuottaa lämpöä esimerkiksi vesikiertoiseen lattiaan. Kaasun, öljyn, puun ja kaukolämmön kustannuslaskentaa ei vielä ole. Pelkkä lämmönlähteen valinta ei nollaa huoneiden oppimistietoja.", "How heat reaches rooms: circulating water in floors or radiators, electric floor/ceiling/panels, or warm air. Mixed means different rooms use different systems. Water distribution can optionally use a heating-water sensor and uses valve timing. Electric and warm-air distribution ignore those inputs and learn response from observed thermostat demand. Mixed and Other retain water requirements until room overrides are supported.": "Miten lämpö jaetaan huoneisiin: vesikierto, sähkölämmitys tai lämmin ilma. Vesikierto voi käyttää valinnaista veden lämpötila-anturia ja venttiilien ennakoita. Sähkö- ja ilmalämmitys oppivat termostaatin havaitusta lämmityspyynnöstä. Usean tai muun lämmönjakotavan asetuksissa vesikierron kentät säilyvät näkyvissä.", "The construction around floor heating, which affects how slowly heat is stored and released. Concrete slab describes your heated floor. Choose Not applicable if there is no floor heating. This does not change your configured response lag or erase learned parameters.": "Lattialämmityksen ympärillä oleva rakenne vaikuttaa lämmön varastointiin ja vapautumiseen. Betonilaatta kuvaa lämmitettyä lattiaa. Jos lattialämmitystä ei ole, valitse Ei sovellu. Valinta ei muuta vasteviivettä eikä poista opittuja parametreja.", "The structure below your home: slab on ground, crawl space or basement. A heated concrete floor can be above a basement, so this is separate from Heated floor. Choose Unknown if unsure. This descriptive setting does not reset observation history or learned models.": "Talon alapuolinen rakenne: maanvarainen laatta, ryömintätila tai kellari. Betonilattia voi olla myös kellarin yläpuolella, joten tämä on eri tieto kuin lämmitetty lattia. Valitse Tuntematon, jos et tiedä. Tieto ei nollaa historiaa tai oppimista.", "Sunlight through large windows, especially south-facing windows, can warm a room. No additional physical solar heating system is needed. Select the main direction of those windows to enable solar estimates, or Solar heating off to turn them off. Home Assistant’s location determines seasonal sun elevation and azimuth; cloud conditions come from your weather source. The effect starts at zero and learns gradually. Missing sunlight data assumes no solar warmth; room temperature limits still apply.": "Aurinko voi lämmittää huonetta suurten ikkunoiden läpi, etenkin etelään suuntautuvista ikkunoista. Erillistä aurinkolämmityslaitteistoa ei tarvita. Valitse ikkunoiden pääsuunta tai Aurinkolämpö pois käytöstä. Home Assistantin sijainti määrittää auringon suunnan ja korkeuden eri vuodenaikoina. Vaikutus opitaan vähitellen. Puuttuva aurinkotieto ei anna lämpöhyvitystä; lämpötilarajat ovat aina voimassa.", "Clear means the windows receive direct sunlight without major obstructions. Choose Partly shaded for some trees, buildings or overhangs, or Mostly shaded when sunlight is usually blocked. Forecasts use a more cautious solar allowance: partly shaded uses 65% and mostly shaded 30% of the clear allowance. Actual room warming is still learned from observations; no solar heat is assumed before learning. Seasonal leaf cover and changing shading can still affect accuracy.": "Esteetön: ikkunat saavat suoraa aurinkoa ilman merkittäviä esteitä. Osittain varjossa: puita, rakennuksia tai räystäitä peittää osan valosta. Enimmäkseen varjossa: valo on yleensä estynyt. Ennuste käyttää osittain varjossa 65 % ja enimmäkseen varjossa 30 % esteettömän arvion lämpöhyvityksestä. Lämpöä ei oleteta ennen oppimista. Lehtipeite ja varjostus voivat muuttua vuoden aikana.", "Optional local wind sensor, for example sensor.netatmo_tuuli_ms using m/s. Valid readings are averaged over the last 30 minutes. ThermalPilot learns a separate wind effect only after enough varied observations; no fixed wind penalty is assumed. Missing, invalid or unchanged-for-two-hours readings are ignored, and normal temperature-based planning and heating continue. Fresh wind correction gradually returns to typical conditions in forecasts further ahead. A stable calm reading may also be ignored conservatively. Units are detected automatically.": "Valinnainen tuulianturi, esimerkiksi sensor.netatmo_tuuli_ms (m/s). Lukemat tasataan 30 minuutin ajalta. Tuulen vaikutus opitaan vasta riittävistä ja vaihtelevista havainnoista. Puuttuva, virheellinen tai kaksi tuntia muuttumaton tieto ohitetaan. Tavallinen suunnittelu ja lämmitys jatkuvat. Myös vakaa tyyni lukema voidaan varmuuden vuoksi ohittaa. Yksikkö tunnistetaan automaattisesti.", "Emergency lower temperature limit shared by all rooms. Each room’s own target is the normal comfort goal. ThermalPilot prioritizes avoiding this limit even when electricity is expensive; this value is not the idle thermostat target.": "Ehdoton huonelämpötilan alaraja. Kalliiden tuntien alennus ei laske termostaatin asetusta tämän alle. Jos lämpötila uhkaa alittaa rajan, lämmitys saa etusijan hinnasta riippumatta.", "Upper temperature limit shared by all rooms. Extra heating and heat storage must stay within this limit.": "Huonelämpötilan yläraja. Mallin ennuste huomioi sen lämpöä varastoitaessa. Asetuslämpötilan korotus ei saa ylittää tätä arvoa.", "Optional sensor with forecast timestamp/value entries, such as Nordpool Predict FI. Only relative expensive/cheap patterns after confirmed prices are used, so no forecast price unit or additional costs are required. The Source price unit setting applies only to the confirmed total-price sensor. An expensive upcoming period can increase the heat reserve at the end of the known-price plan. Forecast prices are not compared directly with your total prices, used as confirmed prices or used to execute future heating commands. Missing forecasts keep normal planning. Confirmed prices always determine the executable schedule.": "Valinnainen hintasensori, jonka forecast-listassa on timestamp- ja value-kentät. Käytetään vain tulevien hintojen suhteelliseen vertailuun vahvistettujen hintojen jälkeen. Ennuste ei korvaa vahvistettuja kokonaishintoja eikä oikeuta lämpötilarajojen ylitystä.", "Notify in Home Assistant when a room temperature sensor stays unchanged or unavailable for this many hours. A stable room can also have an unchanged reading, so the warning asks you to check the sensor. ThermalPilot sends at most one sensor notification per calendar day. Monitoring runs while ThermalPilot is active; long monitoring gaps restart the timer.": "Home Assistant ilmoittaa, jos huoneen lämpötila-anturin lukema ei muutu tai anturi ei ole saatavilla näin pitkään. Vakaa lämpötila voi myös pysyä samana. Enintään yksi ilmoitus päivässä. Pitkä katkos käynnistää seuranta-ajan uudelleen.", "Summer fallback always applies from 15.5. through 30.9. Outside those dates, it also applies when the day’s lowest forecast temperature is equal to or above this value. For example, a setting of 6°C means the daily minimum must be at least 6°C for ThermalPilot to use summer fallback temperatures. Lower readings already observed that day are included. If a full-day forecast is unavailable outside the summer dates, winter fallback is used.": "Kesän varalämpötila on aina käytössä 15.5.–30.9. Muulloin sitä käytetään, jos koko päivän alin ennustettu lämpötila on vähintään tämä arvo. Jo havaitut alemmat lukemat huomioidaan. Jos koko päivän ennuste puuttuu kesäkauden ulkopuolella, käytetään talven varalämpötilaa.", "Negative values reduce estimated heat loss while the fireplace is active; −20% means a 20% reduction.": "Negatiivinen arvo pienentää arvioitua lämpöhäviötä takan ollessa käytössä. −20 % tarkoittaa 20 %:n pienennystä.", "The price lists must include VAT, grid charges, electricity tax and retailer margin. ThermalPilot uses these final prices directly. Select a source containing today/tomorrow or timestamped raw_today/raw_tomorrow price lists, and choose the matching source price unit.": "Hintalistan on sisällettävä arvonlisävero, siirto, sähkövero ja myyjän marginaali. ThermalPilot käyttää näitä kokonaishintoja suoraan. Valitse tänään/huomenna-listat tai aikaleimatut raw_today/raw_tomorrow-listat ja niiden oikea yksikkö.", "Hourly average uses fixed hourly averages of the source prices. 15 minutes plans using quarter-hour intervals. Flexible builds heating sessions in 15-minute steps, allowing runs such as 60 or 75 minutes while respecting the minimum flexible heating run.": "Tuntikeskiarvo käyttää tuntikohtaisia keskihintoja. 15 minuuttia suunnittelee varttijaksoissa. Joustava rakentaa lämmitysjaksoja 15 minuutin askelin ja noudattaa lämmitysjakson vähimmäiskestoa.", "The shortest planned heating session in flexible scheduling mode. Longer sessions can be chosen in 15-minute steps. This setting applies to flexible runs; valve opening and closing offsets are applied separately.": "Joustavan suunnittelun lyhin lämmitysjakso. Pidemmät jaksot valitaan 15 minuutin askelin. Venttiilien avaus- ja sulkuennakot huomioidaan erikseen.", "Initial estimate of how slowly heat input affects room temperature and how long its effect persists. Concrete slabs often need a longer delay, but lightweight floors, radiators, electric heaters and air systems also have a response time. Use a shorter value for faster systems. This remains relevant to every distribution; it is separate from valve opening or closing time.": "Alkuarvio lämmityksen vaikutuksen viiveestä ja jälkivaikutuksesta. Betonilaatta tarvitsee usein pidemmän viiveen; myös pattereilla, sähkö- ja ilmalämmityksellä on vasteaika. Nopeammissa järjestelmissä käytä lyhyempää arvoa. Tämä ei ole venttiilin avautumisaika.", "The warm outdoor endpoint of the initial heating-hours curve. At this temperature or warmer, the starting model assumes the lower daily heating need. This curve seeds the model before enough real heating and cooling observations are available.": "Lämmitystarpeen alkukäyrän lämmin ulkolämpötilapiste. Tässä lämpötilassa tai sen yläpuolella käytetään vähäisempää lähtölämmitystarvetta. Huoneen todellinen vaste opitaan havainnoista.", "The cold outdoor endpoint of the initial heating-hours curve. At this temperature or colder, the starting model assumes the higher daily heating need. Set it below the warm endpoint. Actual room response is learned from observations.": "Lämmitystarpeen alkukäyrän kylmä ulkolämpötilapiste. Tässä lämpötilassa tai sen alapuolella käytetään suurempaa lähtölämmitystarvetta. Arvon on oltava lämpimän pisteen alapuolella.", "Allows real thermostat setpoint changes when ThermalPilot changes between Active and Passive. Active applies each room’s target temperature; Passive applies the seasonal fallback: the shared summer setpoint or each room’s normal target in winter. These commands can occur even with simulation enabled. This does not enable live heating schedule control.": "Sallii todelliset termostaatin asetuslämpötilan muutokset aktiivisen ja passiivisen tilan välillä myös simuloinnin aikana. Passiivinen tila käyttää kesä- tai talvivaralämpötilaa. Tämä ei yksin ota suunnitellun lämmityksen ohjausta käyttöön.", "The thermostat target used for all configured rooms while ThermalPilot is Passive, if real Active/Passive season setpoint control is enabled. A low summer target normally prevents heating without switching off the thermostats.": "Yhteinen kesän termostaattiasetus passiivisessa tilassa, kun todellinen kausiohjaus on käytössä. Matala arvo tavallisesti estää lämmityksen ilman termostaatin sammuttamista.", "Degrees added to each room’s target temperature during a suggested heating window. For example, a 20 °C target with a 1.5 °C boost suggests a 21.5 °C thermostat setpoint to store heat. Scheduled targets remain simulated in this version.": "Huoneen tavoitelämpötilaan lisättävä korotus suunnitellun lämmitysjakson aikana. Esimerkiksi tavoite 20°C ja korotus 1,5°C tuottaa asetuksen 21,5°C lämmön varastointia varten.", "Negative values temporarily lower the thermostat target during expensive electricity hours. After a planned heating session, ThermalPilot first restores the room’s normal target. It then chooses reduction only when predicted stored warmth can avoid thermostat heating while supporting room comfort. For example, −1°C allows a 20°C target to be reduced to 19°C during selected costly hours. The reduced target never goes below Minimum allowed temperature. Normal target is restored when reduction is no longer useful; a new planned heating session uses the boosted target. Duration is chosen by the plan, not a fixed number of hours.": "Negatiivinen säätö kalliiden sähkötuntien ajaksi. Lämmitysjakson jälkeen palautetaan ensin normaali tavoite. Alennus valitaan vain, jos varastoitu lämpö tukee huoneen tavoitetta. Alennettu asetus ei alita sallittua vähimmäislämpötilaa. Kesto perustuu suunnitelmaan, ei kiinteään tuntimäärään.", "Select the measured supply-water temperature. A temperature sensor uses its state; a climate entity uses its current_temperature attribute. This is the measured water temperature, not the thermostat’s target. Optional for water-based systems. A valid reading adjusts the estimated heating output. Without it, planning and learning continue from observed thermostat demand, without a water-temperature adjustment. Missing readings do not force fallback targets.": "Valinnainen veden mitattu lämpötila. Lämpötila-anturi käyttää tilaansa, climate-entity current_temperature-arvoa. Mitattu lämpötila korjaa lämmitystehon arviota. Puuttuva tieto ei keskeytä suunnittelua, oppimista tai lämmityksen ohjausta.", "Simulation calculates heating suggestions without applying scheduled targets. Disable simulation and confirm to enable real thermostat control. Disable your existing heating automation first. Observation and learning continue in both modes.": "Simulointi laskee ehdotuksia muuttamatta suunniteltuja termostaattiasetuksia. Poista simulointi ja vahvista, kun haluat todellisen ohjauksen. Poista ensin nykyinen lämmitysautomaatio käytöstä. Havainnointi ja oppiminen jatkuvat molemmissa tiloissa.", "Choose the interface language. Room and entity names remain unchanged. Save settings to keep the choice. Embedded Home Assistant history cards use Home Assistant’s own language preference.": "Valitse käyttöliittymän kieli. Huoneiden ja anturien nimet säilyvät ennallaan. Muutos tallentuu Tallenna asetukset -painikkeella. Home Assistantin omat historiakortit käyttävät Home Assistantin kieliasetusta.", "All room timelines share the price chart’s time axis. Teal shows the suggested thermostat boost window; amber shows observed heating demand. ": "Kaikkien huoneiden aikajanat käyttävät hintakaavion aika-akselia. Turkoosi näyttää suunnitellun korotusjakson ja oranssi havaitun lämmityspyynnön. ", "The selected period controls past history. Today and tomorrow are included when prices are published. Recorded activity is shown before now; future suggestions follow the current plan. Price gaps stay empty. ": "Valittu ajanjakso määrittää historian pituuden. Tänään ja huomenna sisältyvät näkymään, kun hinnat on julkaistu. Ennen nykyhetkeä näkyy tallennettu toiminta ja sen jälkeen nykyinen suunnitelma. Puuttuvia hintoja ei täytetä. ", "Times align to 15-minute boundaries; wider views show fewer labels. Hover, focus or tap a price bar or heating period for details.": "Ajat kohdistetaan 15 minuutin rajoihin. Laajoissa näkymissä aikamerkintöjä on vähemmän. Näet tiedot viemällä osoittimen, kohdistamalla tai napauttamalla hintapalkkia tai lämmitysjaksoa.", "Initial model: needs at least 12 heating hours and 12 idle hours.": "Alkumalli tarvitsee vähintään 12 tuntia lämmitystä ja 12 tuntia lepoa.", "This measures initial data collection, not model trustworthiness. Continue validating forecasts and heating suggestions before enabling live control. Learning continues after initial data collection.": "Tämä mittaa alkutietojen keruuta, ei mallin luotettavuutta. Tarkista ennusteet ja lämmitysehdotukset ennen todellisen ohjauksen käyttöönottoa. Oppiminen jatkuu alkutietojen keruun jälkeen.", "Time estimate available after at least 24 hours of rate tracking.": "Aika-arvio on saatavilla vähintään 24 tunnin seurannan jälkeen.", "Model adapting to observations; assess reliability from prediction error.": "Malli mukautuu havaintoihin. Arvioi luotettavuutta ennustevirheestä.", "Predicted temperature under the suggested plan": "Suunnitelman ennustama lämpötila", "No-change baseline": "Muuttumattoman lämpötilan vertailu", "Completed comparisons": "Valmiit vertailut", "Forecast error": "Ennustevirhe", "Accepted observations": "Hyväksytyt havainnot", "accepted observations": "hyväksyttyä havaintoa", "Learning continues after initial collection.": "Oppiminen jatkuu alkutietojen keruun jälkeen.", "History collection and learning paused because outdoor temperature is unavailable. Existing model parameters are retained.": "Historian keruu ja oppiminen on keskeytetty, koska ulkolämpötilaa ei ole saatavilla. Mallin nykyiset parametrit säilyvät.", "No weather forecast: current outdoor temperature is held constant.": "Sääennustetta ei ole: nykyistä ulkolämpötilaa pidetään vakiona.", "Live control awaits confirmation. Enable simulation, save, then disable it and confirm to activate thermostat control.": "Lämmityksen ohjaus odottaa vahvistusta. Ota simulointi käyttöön ja tallenna. Poista sitten simulointi ja vahvista ohjauksen käyttöönotto.", "No heating planned: lowest forecast": "Lämmitystä ei suunniteltu: alin ennuste", "room target": "huoneen tavoite", "minimum limit": "alaraja", "Thermostat control:": "Termostaatin ohjaus:", "Missing or unusable:": "Puuttuva tai käyttökelvoton:", "Time estimate": "Aika-arvio", "New room": "Uusi huone", "About ": "Tietoa asetuksesta: ", "Remove room": "Poista huone", "Reset learning for this room": "Nollaa huoneen oppimistiedot", "Initial data": "Alkutiedot", "initial data": "alkutiedot", "Saved ": "Tallennettu ", "-hour forecast": " tunnin ennuste", "No completed ": "Ei vielä valmiita ", "-hour forecasts in this period yet. New forecasts start being recorded after updating; previous short-term predictions cannot be converted into these comparisons.": " tunnin ennusteita tällä ajanjaksolla. Uusien ennusteiden tallennus alkaa päivityksen jälkeen; aiempia lyhyen aikavälin ennusteita ei voi muuntaa näiksi vertailuiksi.", "hours ahead": "tuntia eteenpäin", "hour ahead": "tunti eteenpäin", "Selected period:": "Valittu ajanjakso:", "recorded activity, plus today and tomorrow when prices are published": "tallennettu toiminta sekä tänään ja huomenna, kun hinnat on julkaistu", "Settings saved at ": "Asetukset tallennettu klo ", ". Suggestions will update shortly.": ". Ehdotukset päivittyvät pian.", "Settings were not saved: ": "Asetuksia ei tallennettu: ", "No current heating suggestion.": "Nykyistä lämmitysehdotusta ei ole.", "Normal thermostat target is maintained.": "Normaalia asetuslämpötilaa ylläpidetään.", "Before enabling live control": "Ennen todellisen ohjauksen käyttöönottoa", "LIVE CONTROL PAUSED": "LÄMMITYKSEN OHJAUS KESKEYTETTY", "SEASON SETPOINT CONTROL ENABLED · heating schedules remain simulated": "KAUSILÄMPÖTILOJEN OHJAUS KÄYTÖSSÄ · lämmityssuunnitelmat ovat edelleen simuloituja", "Season transitions change real thermostat setpoints": "Kausivaihdot muuttavat todellisia termostaattiasetuksia", "Sources are available": "Tietolähteet ovat saatavilla", "Electricity prices from now and outdoor temperature": "Nykyhetkestä alkavat sähkön hinnat ja ulkolämpötila", " and heating water temperature": " ja lämmitysveden lämpötila", " are available. Weather forecast details are reported separately below.": " ovat saatavilla. Sääennusteen tiedot näytetään erikseen alla.", "Comfort planning": "Mukavuuden seuranta", "Electricity optimization": "Sähkökustannusten optimointi", "COMFORT PLANNING · observation and learning, no thermostat control": "MUKAVUUDEN SEURANTA · havainnointi ja oppiminen, ei termostaattiohjausta", "Observation only: this heat source does not use electricity-price scheduling or thermostat control.": "Mukavuuden seuranta: tämä lämmönlähde ei käytä sähkön hintaan perustuvaa suunnittelua tai termostaattiohjausta."};
const finnishReplacements=Object.entries(finnishText).filter(([key])=>key.length>=5).sort((a,b)=>b[0].length-a[0].length);
function translateText(value,language){
  const text=String(value??'');if(language!=='fi')return text;
  const stripped=text.trim();if(finnishText[stripped])return text.replace(stripped,finnishText[stripped]);
  const remove=text.match(/^Remove room "(.*)"\? Save settings to apply this change\.$/);if(remove)return `Poistetaanko huone "${remove[1]}"? Muutos tulee voimaan tallentamalla asetukset.`;
  let translated=text;
  for(const [english,finnish] of finnishReplacements){
    if(translated.includes(english))translated=translated.split(english).join(finnish);
  }
  return translated.replace(/\b(\d+) hours\b/g,'$1 tuntia').replace(/\b(\d+) hour\b/g,'$1 tunti').replace(/\b(\d+) days\b/g,'$1 päivää').replace(/\bOn\b/g,'Päällä').replace(/\bOff\b/g,'Pois');
}
class ThermalPilotPanel extends HTMLElement {
  constructor(){super();this.attachShadow({mode:'open'});this.tab='overview';this.historyHours=48;this.roomDisclosureState=new Map();}
  t(value){return translateText(value,this.settings?.language||'en');}
  tDetails(value){const lines=String(value).split('\n');const first=lines[0].indexOf(' · ');if(first>=0){const name=lines[0].slice(0,first+3);lines[0]=name+this.t(lines[0].slice(first+3));return [lines[0],...lines.slice(1).map(line=>this.t(line))].join('\n');}return this.t(value);}
  translateRoot(root){
    if(this.settings?.language!=='fi'||typeof document==='undefined'||!document.createTreeWalker)return;
    const walker=document.createTreeWalker(root,4);let node;
    while((node=walker.nextNode())){
      if(node.parentElement?.closest('style,script,[data-user-text],input,textarea'))continue;
      node.nodeValue=this.t(node.nodeValue);
    }
    root.querySelectorAll('[title],[aria-label],[data-chart-detail]').forEach(element=>{
      if(element.closest('[data-user-text]'))return;
      for(const attr of ['title','aria-label'])if(element.hasAttribute(attr))element.setAttribute(attr,element.hasAttribute('data-chart-detail')?this.tDetails(element.getAttribute(attr)):this.t(element.getAttribute(attr)));
    });
  }
  openSidebar(){this.dispatchEvent(new CustomEvent('hass-toggle-menu',{bubbles:true,composed:true}));}
  set hass(value){this._hass=value;for(const card of this.historyCards||[])card.hass=value;if(this.isConnected && !this.loaded && !this.loading)this.load();}
  set panel(value){this._panel=value;if(this.isConnected && this._hass && !this.loaded)this.load();}
  connectedCallback(){if(this._hass)this.load();this.timer=setInterval(()=>{if(this.tab!=='settings')this.load();},60000);}
  disconnectedCallback(){this.priceResizeObserver?.disconnect();clearInterval(this.timer);clearTimeout(this.saveMessageTimer);}
  get entry(){return this._panel?.config?.entry_id;}
  async call(type,extra={}){return this._hass.callWS({type:`thermal_pilot/${type}`,entry_id:this.entry,...extra});}
  async load(){
    if(!this.entry || this.loading)return;
    this.loading=true;
    try{
      const response=await this.call('get');
      this.info=response;this.settings=structuredClone(response.settings);
      if(this.tab==='history')this.history=await this.call('history',{hours:this.historyHours});
      else if(this.tab==='overview'){try{this.statusHistory=await this.call('history',{hours:48});}catch(error){this.statusHistory=[];}}
      this.loaded=true;this.message='';this.render();
    }catch(e){this.message=e.message||String(e);this.messageLevel='error';this.saveConfirmation=false;this.render();}
    finally{this.loading=false;}
  }
  field(field,obj,prefix){
    const [key,label,type,min,max,step='any']=field;const value=obj[key];const name=`${prefix}.${key}`;
    let input;
    if(type==='bool')input=`<input type="checkbox" class="setting-toggle" role="switch" data-field="${name}" ${value?'checked':''}>`;
    else if(type.startsWith('select:'))input=`<select data-field="${name}">${type.slice(7).split(',').map(v=>`<option ${v===value?'selected':''} value="${escapeHTML(v)}">${escapeHTML(key==='language'?({'en':'🇬🇧 English','fi':'🇫🇮 Finnish'}[v]||v):key==='pricing_mode'?schedulingLabels[v]||v:key.startsWith('house_')?houseOptionLabels[v]||v:key==='solar_direction'&&v==='disabled'?'Solar heating off':['solar_direction','solar_exposure'].includes(key)?v.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase()):v)}</option>`).join('')}</select>`;
    else if(type==='number')input=`<input type="number" step="${step}" min="${min}" max="${max}" data-field="${name}" value="${escapeHTML(value)}">`;
    else if(type==='text')input=`<input data-field="${name}" value="${escapeHTML(value)}">`;
    else{
      const domains=type.split(','),rule=field[3]||{};const entities=Object.values(this._hass.states).filter(s=>domains.includes(s.entity_id.split('.')[0])&&entityMatches(s,rule,obj)).sort((a,b)=>entityLabel(a).localeCompare(entityLabel(b)));
      const retained=value&&!entities.some(s=>s.entity_id===value)?`<option selected value="${escapeHTML(value)}">${escapeHTML(entityLabel(this._hass.states[value]))} (${this._hass.states[value]?'does not match filter':'unavailable'})</option>`:'';
      input=`<select data-field="${name}"><option value="">— Select / not used —</option>${retained}${entities.map(s=>`<option data-user-text value="${escapeHTML(s.entity_id)}" ${s.entity_id===value?'selected':''}>${escapeHTML(entityLabel(s))}</option>`).join('')}</select>`;
    }
    if(key==='fireplace_reduction')input=`<span class="number-unit">${input}<span>%</span></span>`;
    const helpText=settingHelp[key];
    const helpId=`help-${prefix}-${key}`;
    const help=helpText?` <span class="setting-help"><button type="button" class="setting-info" aria-label="About ${escapeHTML(label)}" aria-describedby="${helpId}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle class="info-dot" cx="12" cy="7" r="1"/></svg></button><span id="${helpId}" class="setting-tooltip" role="tooltip">${escapeHTML(helpText)}</span></span>`:'';
    return `<label ${['simulation_enabled','apply_season_setpoints'].includes(key)?`data-electric-control ${electricHeating(this.settings)?'':'hidden'}`:key==='solar_exposure'?`data-solar-exposure ${(!obj.solar_direction||obj.solar_direction==='disabled')?'hidden':''}`:''}><span>${escapeHTML(label)}${help}</span>${input}</label>`;
  }
  settingsGroups(groups){
    const fields=new Map(this.info.source_fields.map(field=>[field[0],field]));
    return groups.map(([title,keys])=>{
      const available=keys.map(key=>fields.get(key)).filter(Boolean);
      return available.length?`<div class="settings-group" ${title==='Electricity price settings'?`data-electric-group ${electricHeating(this.settings)?'':'hidden'}`:title==='Water heating'?`data-water-group ${waterDistribution(this.settings)?'':'hidden'}`:''}><h3>${escapeHTML(title)}</h3>${title==='Miscellaneous'?'<p>Warn when room temperature readings stay unchanged or unavailable.</p>':''}<div class="grid">${available.map(field=>this.field(field,this.settings,'source')).join('')}</div></div>`:'';
    }).join('');
  }
  settingsView(){
    const i=this.info;
    const rooms=this.settings.rooms.map((room,index)=>({room,index})).sort((a,b)=>compareRoomNames(a.room,b.room));
    return `<form id="settings"><section class="settings-sources"><h2>ThermalPilot settings</h2>${this.settingsGroups(sourceSettingGroups)}</section>
    <section class="settings-house"><h2>House heating settings</h2><p>Choose your heating system and building details. Heat distribution determines which sensor inputs are needed.</p>${this.settingsGroups([['House and heating',['house_heat_source','house_distribution','house_heated_floor','house_foundation']],['Water heating',['water_entity','start_offset_minutes','stop_offset_minutes']],['Heating response',['lag_hours','curve_warm_temp','curve_cold_temp']]])}${statusNotice('Electric heating benefits mainly from changing electricity tariffs. Other heat sources use observation only: no schedules, no thermostat control and no required price sensor. Heat-pump efficiency and fuel costs are not modeled.','info')}</section>
    <section class="settings-shared"><h2>Shared room settings</h2><p>These settings apply to every room.</p>${this.settingsGroups(sharedSettingGroups)}</section>
    <section class="settings-rooms"><h2>Rooms</h2><p>Room response is learned from observed heating and cooling, starting with internal estimates.</p>
    <div class="room-cards">${rooms.map(({room:r,index})=>`<article class="room-card"><div class="room-actions"><button type="button" class="icon-button" data-reset="${escapeHTML(r.id)}" title="Reset learning for this room" aria-label="Reset learning for this room"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/></svg></button><button type="button" class="icon-button delete-room" data-remove="${index}" title="Remove room" aria-label="Remove room"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg></button></div><details><summary><span data-user-text>${escapeHTML(r.name||'New room')}</span> <span class="room-target">${escapeHTML(r.baseline??'—')} °C</span></summary><div class="grid room-fields">${i.room_fields.map(f=>this.field(f,r,`room${index}`)).join('')}</div></details></article>`).join('')}</div>
    <button type="button" id="add">Add room</button></section><div class="sticky"><button class="primary" type="submit">Save settings</button><span id="settings-unsaved" class="unsaved-notice" role="status" ${this.hasUnsavedSettings()?'':'hidden'}>Unsaved changes</span><span>${this.settings.simulation_enabled===false?'Live control · disable your existing automation before saving':this.settings.apply_season_setpoints?'Season transitions change real thermostat setpoints':'Simulation only · scheduled targets are not applied'}</span></div></form>`;
  }
  chart(rows,key,alternate,alternateLabel='Saved forecast'){
    const timestamp=r=>Number(r.time??Date.parse(r.end)/1000);
    const data=rows.filter(r=>Number.isFinite(timestamp(r))).slice().sort((a,b)=>timestamp(a)-timestamp(b));
    const numeric=value=>value!=null&&Number.isFinite(Number(value));
    const keys=alternate?[key,alternate]:[key];
    const values=data.flatMap(r=>keys.filter(k=>numeric(r[k])).map(k=>Number(r[k])));
    if(!data.length||!values.length)return '<p>No observation history yet.</p>';
    const low=Math.floor((Math.min(...values)-.1)*10)/10,high=Math.ceil((Math.max(...values)+.1)*10)/10;
    const first=Math.floor(timestamp(data[0])/900)*900,last=Math.max(first+900,Math.ceil(timestamp(data.at(-1))/900)*900),span=last-first;
    // Quarter-hour ticks for short periods; longer views use aligned multiples to keep labels readable.
    const chartWidth=(this.clientWidth||0)>0&&this.clientWidth<700?Math.max(240,this.clientWidth-128):800;
    const left=chartWidth<600?56:70,right=chartWidth-20;
    const tickCount=chartWidth<600?Math.max(2,Math.floor((right-left)/70)):12;
    const tickSeconds=Math.max(900,Math.ceil(span/(tickCount*900))*900);
    const x=time=>left+(right-left)*(time-first)/span,y=value=>155-125*(value-low)/Math.max(.1,high-low);
    const points=k=>data.filter(r=>numeric(r[k])).map(r=>`${x(timestamp(r))},${y(Number(r[k]))}`).join(' ');
    const grid=[low,(low+high)/2,high].map(value=>`<line x1="${left}" y1="${y(value)}" x2="${right}" y2="${y(value)}" stroke="currentColor" opacity=".15"/><text x="${left-8}" y="${y(value)+4}" text-anchor="end">${value.toFixed(1)} °C</text>`).join('');
    const ticks=[];
    for(let time=first;time<=last;time+=tickSeconds){const label=new Date(time*1000).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',hour12:false});ticks.push(`<line x1="${x(time)}" y1="30" x2="${x(time)}" y2="160" stroke="currentColor" opacity=".1"/><text x="${x(time)}" y="180" text-anchor="middle">${escapeHTML(label)}</text>`);}
    const label=alternate?'Measured temperature':'Predicted temperature under the suggested plan';
    return `<div class="chart-legend"><span><i style="background:#1976d2"></i>${label}</span>${alternate?`<span><i style="background:#e49025"></i>${escapeHTML(alternateLabel)}</span>`:''}</div><div class="temperature-chart"><svg viewBox="0 0 ${chartWidth} 195" role="img" aria-label="${label}${alternate?' and '+escapeHTML(alternateLabel):''}">${grid}${ticks.join('')}<polyline points="${points(key)}" fill="none" stroke="#1976d2" stroke-width="3"/>${alternate?`<polyline points="${points(alternate)}" fill="none" stroke="#e49025" stroke-width="2" stroke-dasharray="6 4"/>`:''}</svg></div><small>${escapeHTML(timeLabel(first*1000))} – ${escapeHTML(timeLabel(last*1000))}</small>`;
  }
  forecastHistoryView(rows){
    const hours=this.forecastHours||3;
    const cards=[1,3,6].map(h=>{
      const details=rows.map(r=>r[`forecast_${h}h_details`]).filter(Boolean);
      const count=details.length,mean=key=>count?(details.reduce((sum,d)=>sum+d[key],0)/count).toFixed(2)+' °C':'—';
      const matched=details.filter(d=>d.heating_match!=null&&d.heating_match>=.9),similar=matched.length;
      const matchedError=similar?(matched.reduce((sum,d)=>sum+d.error,0)/similar).toFixed(2)+' °C':'—';
      return `<div class="forecast-metric"><strong>${h}-hour forecast</strong><p>Mean error: <b>${mean('error')}</b></p><small>Similar heating error: ${matchedError}<br>No-change error: ${mean('persistence_error')}<br>${count} comparisons · ${similar} with similar heating</small></div>`;
    }).join('');
    const count=rows.filter(r=>r[`forecast_${hours}h_details`]).length;
    return `<h3>Forecast accuracy</h3><p>These forecasts were saved 1, 3 or 6 hours before the measurements. Later readings do not change them. Lower error is better; compare it with simply predicting no temperature change. Different heating, computers and other heat sources can affect the result.</p><div class="forecast-metrics">${cards}</div><label class="forecast-selection">Chart forecast<select data-forecast-hours>${[1,3,6].map(h=>`<option value="${h}" ${hours===h?'selected':''}>${h} ${h===1?'hour':'hours'} ahead</option>`).join('')}</select></label>${!count?`<p class="notice notice-info" role="status">${statusIcon('info')}<span class="notice-text">No completed ${hours}-hour forecasts in this period yet. New forecasts start being recorded after updating; previous short-term predictions cannot be converted into these comparisons.</span></p>`:''}${this.chart(rows,'temperature',`forecast_${hours}h`,`Saved ${hours}-hour forecast`)}<p>Forecasts are compared with measurements within five minutes of their due time. “Similar heating” means observed demand matched the forecast for at least 90% of observations, with no large recording gaps. These counts give context, not a guarantee of accuracy.</p>`;
  }
  roomDisclosureOpen(id){return this.roomDisclosureState.get(`${this.tab}:${id}`)===true;}
  learningPercent(room){
    const model=room?.model||{},progress=room?.learning_progress||{};
    return Math.max(0,Math.min(100,progress.percent??100*(Math.min(12,model.heated_hours??0)+Math.min(12,model.idle_hours??0))/24));
  }
  roomHeatingBadge(room,id){
    const configured=this.settings?.rooms?.find(r=>r.id===id);
    const state=this._hass?.states?.[configured?.activity_entity||configured?.thermostat];
    let actual=room?.actual_activity;
    if(state){
      if(['unknown','unavailable'].includes(state.state))actual=null;
      else if(configured.activity_entity)actual=state.state==='on'?1:state.state==='off'?0:null;
      else if(state.attributes?.hvac_action!=null)actual=state.attributes.hvac_action==='heating'?1:['idle','off'].includes(state.attributes.hvac_action)?0:null;
    }
    const status=actual===1?'actual':actual===0?'idle':'unknown';
    const label=actual===1?'Actual heating: On':actual===0?'Actual heating: Off':'Actual heating: Unknown';
    const detail=`${label}. Current relay or thermostat demand; On does not guarantee water flow.`;
    const icon=status==='unknown'?'<span aria-hidden="true">?</span>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2c1 5-3 6-3 10-2-1-3-3-3-5-3 3-5 6-5 9a10 10 0 0 0 20 0c0-6-5-9-9-14Z"/></svg>';
    return `<span class="room-heating ${status}" role="img" aria-label="${escapeHTML(label)}" title="${escapeHTML(detail)}" tabindex="0">${icon}</span>`;
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
    const dateText=completionDate&&!Number.isNaN(completionDate.getTime())?dateLabel(completionDate):null;
    const estimate=complete?'Initial observation thresholds reached.':days!=null?`About ${days<1?'less than 1':Math.ceil(days)} more ${days<=1?'day':'days'} to the initial thresholds at recent observation rates.`:(progress.rate_history_hours??0)<24?'Time estimate available after at least 24 hours of rate tracking.':'Waiting for enough heating and idle observations to estimate the remaining time.';
    return `<div class="learning-card"><div class="learning-heading"><strong>Initial data collection</strong><span>${percent.toFixed(0)}%</span></div><progress max="100" value="${percent}" aria-label="Initial learning observation progress">${percent.toFixed(0)}%</progress><div class="learning-counts"><span>Heating <strong>${Number(heating).toFixed(1)} / 12 h</strong></span><span>Idle <strong>${Number(idle).toFixed(1)} / 12 h</strong></span></div><p>${escapeHTML(estimate)}</p>${dateText?`<p class="learning-date">Estimated initial-data completion: <strong>${escapeHTML(dateText)}</strong></p>`:''}<small>${escapeHTML(room.learning_note||'')} · ${model.samples||0} accepted observations. This measures initial data collection, not model trustworthiness. Continue validating forecasts and heating suggestions before enabling live control. Learning continues after initial data collection.</small></div>`;
  }
  priceChart(history=false){
  const rooms=[...(this.settings?.rooms||[])].sort(compareRoomNames);
  const published=(this.info.data?.price_chart||[]).map(s=>({time:new Date(s.start).getTime(),end:new Date(s.end).getTime(),price:Number(s.price)})).filter(s=>s.price!=null&&Number.isFinite(s.time)&&Number.isFinite(s.end)&&Number.isFinite(s.price)&&s.end>s.time).sort((a,b)=>a.time-b.time);
  const now=Date.now();
  const midnight=new Date(now);midnight.setHours(0,0,0,0);
  const historyStart=Math.floor(Math.min(now-this.historyHours*3600000,published.length?midnight.getTime():now)/900000)*900000;
  const historyEnd=Math.ceil(Math.max(now,...published.map(slot=>slot.end))/900000)*900000;
  let values=published;
  if(history){
   const unique=new Map();
   const rangeStart=historyStart,rangeEnd=historyEnd;
   for(const slot of published){
    for(let time=Math.max(slot.time,rangeStart);time<Math.min(slot.end,rangeEnd);time+=900000)unique.set(time/1000,{time,end:Math.min(time+900000,slot.end,rangeEnd),price:slot.price});
   }
   for(const row of this.history||[]){
    const time=Math.floor(row.time/900)*900000;
    if(time>=rangeStart&&time<rangeEnd&&row.time*1000<=now&&row.price!=null&&Number.isFinite(Number(row.price)))unique.set(time/1000,{time,end:Math.min(time+900000,rangeEnd),price:Number(row.price)});
   }
   values=[...unique.values()].sort((a,b)=>a.time-b.time);
  }
  const open=this.priceAccordionState?.[history?'history':'overview']!==false;
  const heading=`<details class="observation-accordion" id="price-accordion" ${open?'open':''}><summary><h2 style="margin:0">Electricity prices and heating</h2></summary><div style="padding-top:16px">`;
  if(!history&&!values.length)return `<section class="price-card">${heading}<p>${history?'No past electricity prices are available yet. History uses recorded prices and known past intervals from the published price list.':'No usable electricity price list is available.'}</p></div></details></section>`;
  const start=history?historyStart:Math.floor((published[0]?.time??values[0].time)/900000)*900000;
  const end=history?historyEnd:Math.ceil((published.at(-1)?.end??Math.max(values.at(-1).end,now))/900000)*900000;
  const span=end-start;
  const viewWidth=Math.max(240,this.priceChartWidth||((this.clientWidth||0)>0?this.clientWidth-104:900));
  const compact=viewWidth<600;
  const left=compact?(history?88:48):history?310:210,roomNameWidth=compact?viewWidth-40:history?190:180,width=viewWidth-left-20,top=15,height=120,max=Math.max(25,Math.ceil(Math.max(0,...values.map(v=>v.price))/5)*5),min=Math.min(0,Math.floor(Math.min(0,...values.map(v=>v.price))/5)*5);
  const ticks=Array.from({length:6},(_,i)=>min+(max-min)*i/5).map(v=>{const y=top+height-(v-min)/(max-min)*height;return `<line x1="${left}" x2="${left+width}" y1="${y}" y2="${y}" stroke="#829aa32c"/><text x="${left-10}" y="${y+4}" text-anchor="end" fill="#526b75" font-size="12">${v.toFixed(0)}</text>`;}).join('');
  const x=time=>left+(time-start)/span*width;
  const y=price=>top+height-(price-min)/(max-min)*height;
  const detailAttributes=text=>`data-chart-detail="${escapeHTML(text)}" tabindex="0" role="img" aria-label="${escapeHTML(text)}"`;
  const bars=values.map(v=>`<rect ${detailAttributes(`Electricity price: ${v.price.toFixed(2)} c/kWh\nStart: ${timeLabel(v.time)}\nEnd: ${timeLabel(v.end)}`)} x="${x(v.time)}" y="${Math.min(y(v.price),y(0))}" width="${Math.max(1,(v.end-v.time)/span*width-.5)}" height="${Math.max(1,Math.abs(y(0)-y(v.price)))}" rx="1" fill="${priceColor(v.price)}"></rect>`).join('');
  const maximumLabels=Math.max(2,Math.floor(width/120));
  const tickSteps=[15,30,60,120,180,360,720,1440,2880,5760,11520];
  const tickStep=(tickSteps.find(minutes=>span/(minutes*60000)<=maximumLabels)||11520)*60000;
  const axisTimes=[];
  for(let time=Math.ceil(start/tickStep)*tickStep;time<=end;time+=tickStep)axisTimes.push(time);
  const axisLabel=time=>compact?`${new Date(time).getDate()}.${new Date(time).getMonth()+1}. ${new Date(time).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',hour12:false})}`:timeLabel(time);
  const labelRow=y=>axisTimes.map(time=>`<text x="${x(time)}" y="${y}" text-anchor="${time===start?'start':time===end?'end':'middle'}" fill="#526b75" font-size="11">${escapeHTML(axisLabel(time))}</text>`).join('');
  const roomGap=10,rowHeight=compact?(history?80:60):history?54:36,roomTop=180,chartHeight=roomTop+rooms.length*rowHeight+26;
  const lanes=rooms.map((room,roomIndex)=>{
   const rows=((history?this.history:this.statusHistory)||[]).filter(r=>r.room_id===room.id).sort((a,b)=>a.time-b.time),y=roomTop+roomIndex*rowHeight;
   const plan=this.info.data?.rooms?.[room.id]?.plan;
   const commands=[...(plan?.commands||[])].sort((a,b)=>new Date(a.time)-new Date(b.time));
   const recorded=rows.map((r,i)=>({start:r.time*1000,end:Math.min((rows[i+1]?.time??(r.time+300))*1000,r.time*1000+1800000,now),suggested_heat:r.suggested_heat,activity:r.activity,recorded:true,next:rows[i+1],previous:rows[i-1]}));
   const planned=commands.map((c,i)=>({start:Math.max(now,new Date(c.time).getTime()),originalStart:new Date(c.time).getTime(),end:commands[i+1]?new Date(commands[i+1].time).getTime():end,suggested_heat:c.action==='raise',activity:null}));
   const pastRelays=recorded.map(v=>({...v,suggested_heat:v.activity,next:v.next?{...v.next,suggested_heat:v.next.activity}:undefined,previous:v.previous?{...v.previous,suggested_heat:v.previous.activity}:undefined}));
   const intervals=history?[...recorded,...planned]:[...pastRelays,...planned];
   const laneTop=compact?24:0;
   const lane=(key,offset,color)=>{
    // Adjacent On observations form one period; never join gaps or unknown states.
    const periods=[];
    for(const v of intervals){
     if(!v[key]||v.end<=v.start)continue;
     const previous=periods.at(-1);
     const stopped=v.recorded&&v.next&&v.next[key]===0&&(v.next.time*1000-v.start)<=1800000;
     const started=v.recorded&&v.previous&&v.previous[key]===0&&(v.start-v.previous.time*1000)<=1800000;
     if(previous&&previous.end===v.start&&previous.recorded===v.recorded){previous.end=v.end;previous.stopped=stopped;}
     else periods.push({...v,started,stopped});
    }
    return `<rect x="${left}" y="${y+laneTop+offset}" width="${width}" height="14" rx="3" fill="#dbe5ea"/>`+periods.map(v=>{
     const a=Math.max(start,v.start),b=Math.min(end,v.end);
     const label=key==='activity'||(!history&&v.recorded)?'Actual relay':'Suggested heating';
     const tooltipStart=v.originalStart??v.start;
     const detail=`${room.name} · ${label} On\n${v.recorded&&!v.started?'First observed On':'Start'}: ${timeLabel(tooltipStart)}\n${v.recorded&&!v.stopped?'Observed until':'Stop'}: ${timeLabel(v.end)}\n${v.recorded?'Observed duration':'Duration'}: ${durationLabel(v.end-tooltipStart)}${v.recorded?'\nTimes are based on recorded observations; gaps are not filled.':''}`;
     return b>a?`<rect ${detailAttributes(detail)} x="${x(a)}" y="${y+laneTop+offset}" width="${(b-a)/span*width}" height="14" fill="${!history&&v.recorded?'#e49025':color}"></rect>`:'';
    }).join('');
   };
   return `<rect x="8" y="${y-5}" width="${viewWidth-20}" height="${rowHeight-roomGap}" rx="6" fill="${roomIndex%2?'#e6eef7':'#e5f0ee'}"/><foreignObject x="20" y="${y+(compact?-1:history?7:-1)}" width="${roomNameWidth}" height="22"><div xmlns="http://www.w3.org/1999/xhtml" data-user-text title="${escapeHTML(room.name)}" style="font:600 13px system-ui;color:#253f49;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:22px">${escapeHTML(room.name)}</div></foreignObject>${history?`<text x="${left-12}" y="${y+laneTop+12}" text-anchor="end" fill="#526b75" font-size="10">Suggested</text><text x="${left-12}" y="${y+laneTop+30}" text-anchor="end" fill="#526b75" font-size="10">Relay</text>`:''}${lane('suggested_heat',0,'#087c85')}${history?lane('activity',18,'#e49025'):''}`;
  }).join('');
  return `<section class="price-card" style="background:#edf4fa;margin-bottom:24px">${heading}<p style="margin:0;color:#526b75">${history?`Selected period: ${this.historyHours} hours · recorded activity, plus today and tomorrow when prices are published`:'Today and tomorrow · past thermostat activity and future heating suggestions'}</p><div style="display:flex;flex-wrap:wrap;gap:18px;margin:16px 0;font-size:13px"><span><b style="display:inline-block;width:24px;height:10px;border-radius:3px;background:linear-gradient(to right,#40ff00,#ffff00,#ff9933,#ff0000,#cc0000)"></b> Total electricity price (c/kWh)</span><span><b style="color:#087c85">■</b> Suggested heating window</span><span><b style="color:#e49025">■</b> Actual thermostat relay</span></div>${history&&!values.length?'<p>No electricity prices are available for this period. Recorded thermostat activity is shown below.</p>':''}<div class="price-chart-viewport" style="overflow-x:auto;background:#ffffffb3;border-radius:10px;padding:12px"><svg data-range-start="${start}" data-range-end="${end}" viewBox="0 0 ${viewWidth} ${chartHeight}" role="img" aria-label="Electricity prices with heating timelines for every room" style="width:100%;min-width:0;height:${chartHeight}px;max-height:none;display:block"><text x="20" y="30" fill="#526b75" font-size="12">c/kWh</text>${ticks}${bars}${labelRow(157)}${lanes}${now>start&&now<end?`<line x1="${x(now)}" x2="${x(now)}" y1="${top}" y2="${chartHeight-26}" stroke="#526b75" stroke-dasharray="4 4" stroke-width="1"/><text x="${x(now)+5}" y="12" fill="#526b75" font-size="11">Now</text>`:''}${labelRow(chartHeight-8)}</svg><div class="chart-tooltip" role="tooltip" hidden></div></div><small style="display:block;margin-top:10px;color:#526b75">All room timelines share the price chart’s time axis. Teal shows the suggested thermostat boost window; amber shows observed heating demand. ${history?'The selected period controls past history. Today and tomorrow are included when prices are published. Recorded activity is shown before now; future suggestions follow the current plan. Price gaps stay empty. ':''}Times align to 15-minute boundaries; wider views show fewer labels. Hover, focus or tap a price bar or heating period for details.</small></div></details></section>`;
  }
  mountPriceChartSizing(){
    this.priceResizeObserver?.disconnect();
    const viewport=this.shadowRoot.querySelector('.price-chart-viewport');
    if(!viewport)return;
    this.bindChartDetails(viewport);
    const history=this.tab==='history';
    const resize=width=>{
      if(width<=0)return;
      const measured=Math.max(240,Math.round(width));
      if(this.priceChartWidth===measured)return;
      this.priceChartWidth=measured;
      const template=document.createElement('template');
      template.innerHTML=this.priceChart(history);
      const svg=template.content.querySelector('svg');
      const current=viewport.querySelector('svg');
      if(svg&&current){current.replaceWith(svg);this.translateRoot(viewport);}
    };
    // Read the rendered content box, not the custom element's pre-layout width.
    resize(viewport.clientWidth-24);
    if(typeof ResizeObserver!=='undefined'){
      this.priceResizeObserver=new ResizeObserver(entries=>resize(entries[0].contentRect.width));
      this.priceResizeObserver.observe(viewport);
    }
  }
  bindChartDetails(viewport){
    if(viewport.chartDetailsBound||!viewport.addEventListener)return;
    viewport.chartDetailsBound=true;
    const tooltip=()=>viewport.querySelector('.chart-tooltip');
    const hide=()=>{const box=tooltip();if(box)box.hidden=true;};
    const show=event=>{
      const mark=event.target.closest?.('[data-chart-detail]');
      if(!mark){hide();return;}
      const box=tooltip();if(!box)return;
      box.textContent=this.tDetails(mark.dataset.chartDetail);box.hidden=false;
      const rect=mark.getBoundingClientRect();
      const x=event.clientX??rect.left+rect.width/2,y=event.clientY??rect.top;
      const bounds=box.getBoundingClientRect();
      box.style.left=Math.max(8,Math.min(x+12,window.innerWidth-bounds.width-8))+'px';
      box.style.top=Math.max(8,Math.min(y+16,window.innerHeight-bounds.height-8))+'px';
    };
    viewport.addEventListener('pointermove',event=>{if(event.pointerType!=='touch')show(event);});
    viewport.addEventListener('pointerleave',hide);
    viewport.addEventListener('focusin',show);
    viewport.addEventListener('focusout',hide);
    viewport.addEventListener('click',event=>{const box=tooltip(),mark=event.target.closest?.('[data-chart-detail]');if(box&&!box.hidden&&mark&&box.textContent===mark.dataset.chartDetail)hide();else show(event);});
    viewport.addEventListener('scroll',hide);
    viewport.addEventListener('keydown',event=>{if(event.key==='Escape')hide();});
  }
  statusSparkline(key,color){
    const values=new Map();
    for(const row of this.statusHistory||[]){
      if(row[key]!=null&&Number.isFinite(Number(row[key])))values.set(row.time,Number(row[key]));
    }
    const prices=this.info?.data?.price_chart||[];
    const end=prices.length?new Date(prices.at(-1).end).getTime()/1000:Date.now()/1000;
    const start=prices.length?new Date(prices[0].start).getTime()/1000:end-86400;
    const points=[...values].filter(([time])=>time>=start&&time<=end).sort((a,b)=>a[0]-b[0]);
    if(points.length<2||!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return '';
    const trendStart=points[0][0],span=Math.max(1,points.at(-1)[0]-trendStart);
    const low=Math.min(...points.map(p=>p[1])),high=Math.max(...points.map(p=>p[1]));
    const y=value=>high===low?25:42-(value-low)/(high-low)*34;
    let definitions='';
    if(key==='outdoor'){
      if(high===low)color=outdoorColor(low);
      else{
        const stops=[[low,outdoorColor(low)],...outdoorThresholds.filter(([value])=>value>low&&value<high),[high,outdoorColor(high)]];
        definitions=`<defs><linearGradient id="outdoor-trend-color" gradientUnits="userSpaceOnUse" x1="0" y1="42" x2="0" y2="8">${stops.map(([value,color])=>`<stop offset="${(value-low)/(high-low)}" stop-color="${color}"/>`).join('')}</linearGradient></defs>`;
        color='url(#outdoor-trend-color)';
      }
    }
    const segments=[];
    for(const p of points){
      if(!segments.length||p[0]-segments.at(-1).at(-1)[0]>1800)segments.push([]);
      segments.at(-1).push(p);
    }
    const paths=segments.filter(segment=>segment.length>1).map(segment=>{
      const coordinates=segment.map(([time,value])=>[(time-trendStart)/span*300,y(value)]);
      const line=coordinates.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
      return `<path d="${line} L${coordinates.at(-1)[0]},50 L${coordinates[0][0]},50 Z" fill="${color}" fill-opacity=".12"/><path d="${line}" fill="none" stroke="${color}" stroke-width="1.8" vector-effect="non-scaling-stroke"/>`;
    }).join('');
    return `<svg class="status-sparkline" viewBox="0 0 300 50" preserveAspectRatio="none" aria-hidden="true">${definitions}${paths}</svg>`;
  }
  collectionQuality(){
    const data=this.info?.data||{};
    const models=(this.settings?.rooms||[]).map(room=>data.rooms?.[room.id]?.model||{});
    const evidence=data.collection_evidence||{rooms:models.length,
      heating_hours:models.length?Math.min(...models.map(m=>m.heated_hours||0)):0,
      idle_hours:models.length?Math.min(...models.map(m=>m.idle_hours||0)):0};
    const heating=Math.max(0,Number(evidence.heating_hours)||0),idle=Math.max(0,Number(evidence.idle_hours)||0);
    const start=data.history_info?.started_at;
    const now=data.updated?new Date(data.updated).getTime()/1000:Date.now()/1000;
    const days=start!=null?Math.max(0,(now-start)/86400):0;
    const levels=[['Low',0,0],['Limited',3,1],['Developing',12,3],['Good',48,14],['High',120,42]];
    let level=0;
    if(evidence.rooms)levels.forEach(([,hours,age],i)=>{if(heating>=hours&&idle>=hours&&days>=age)level=i;});
    return {label:levels[level][0],level,
      detail:`Collected-data coverage, not model reliability. Least-observed room: ${heating.toFixed(1)} heating hours and ${idle.toFixed(1)} idle hours. Collection began ${Math.floor(days)} days ago. Limited: 3 hours each / 1 day; Developing: 12 hours each / 3 days; Good: 48 hours each / 14 days; High: 120 hours each / 42 days. All criteria must be met. Learning continues at every level.`};
  }
  controlBadges(){
    const data=this.info?.data||{},settings=this.settings||{};
    const live=settings.simulation_enabled===false&&settings.live_control_confirmed;
    const mode=!electricHeating(settings)?'Comfort planning':live?(settings.heating_enabled===false?'Live control paused':'Live control'):settings.simulation_enabled===false?'Confirmation required':settings.apply_season_setpoints?'Season setpoint control':'Simulation';
    const modeHelp=live?'ThermalPilot applies scheduled thermostat targets while active. Essential data loss returns affected rooms to their seasonal fallback temperature.':settings.simulation_enabled===false?'Live control has not been confirmed. Save and confirm to enable real thermostat control.':settings.apply_season_setpoints?'Active/Passive season setpoints can change real thermostats. Heating schedules remain simulated.':'Heating schedules are simulated; your existing automation remains in control.';
    const status=data.source_status;
    const missing=status?Object.entries({prices:'Electricity prices from now',outdoor:'Outdoor temperature',water:'Heating water temperature'}).filter(([key])=>(key!=='water'||status.water_required!==false)&&(key!=='prices'||status.prices_required!==false)&&!status[key]).map(([,name])=>name):[];
    const sourceLabel=!status?'Sources not checked':missing.length?'Sources missing':'Sources ready';
    const sourceHelp=!electricHeating(settings)?'Comfort planning uses room temperature, outdoor temperature and observed heating demand. Electricity prices are not required; no heating schedules or thermostat commands are generated.':!status?'Source checks are available while ThermalPilot is active.':missing.length?`Missing or unusable: ${missing.join(', ')}.`:`Electricity prices from now and outdoor temperature${status.water_required===false?'':' and heating water temperature'} are available. Weather forecast details are reported separately below.`;
    const season=data.fallback_season?.season;
    return `<div class="status-badges"><span class="status-pill mode" tabindex="0" title="${escapeHTML(modeHelp)}">${mode}</span><span class="status-pill ${!status?'neutral':missing.length?'missing':'active'}" tabindex="0" title="${escapeHTML(sourceHelp)}">${sourceLabel}</span>${season?`<span class="status-pill ${season==='summer'?'summer':'winter'}" tabindex="0" title="Summer is 15.5.–30.9., or a complete day’s minimum forecast temperature at or above ${escapeHTML(settings.summer_minimum_temperature??6)}°C. Summer fallback uses the shared summer setpoint; winter fallback uses each room’s normal target.">${season==='summer'?'Summer fallback':'Winter fallback'}</span>`:''}</div>`;
  }
  heatRetentionView(){
    const rooms=Object.entries(this.info?.data?.rooms||{}).filter(([,room])=>room.heat_retention);
    if(!rooms.length)return '';
    rooms.sort((a,b)=>a[1].heat_retention.drop_6h-b[1].heat_retention.drop_6h||compareRoomNames(a[1],b[1]));
    const max=Math.max(...rooms.map(([,r])=>r.heat_retention.drop_6h),.01);
    return `<section class="retention-card"><details class="observation-accordion" id="retention-accordion" ${this.retentionOpen!==false?'open':''}><summary><h2>Room heat retention</h2></summary><div class="observation-content"><p>Compare rooms under the same conditions: <b>20°C indoors, −10°C outdoors</b>, without heating, remaining slab warmth or appliance heat. Lower temperature loss means slower modeled cooling. This is a model estimate, not measured energy efficiency or an insulation rating.</p><div class="scroll"><table><thead><tr><th>Room</th><th>6-hour loss</th><th>1°C drop</th><th>Model</th></tr></thead><tbody>${rooms.map(([id,r])=>{const v=r.heat_retention;return `<tr><td><span data-user-text>${escapeHTML(r.name)}</span></td><td><span class="retention-value">${v.drop_6h.toFixed(2)} °C</span><span class="retention-bar" aria-hidden="true"><i style="width:${100*v.drop_6h/max}%"></i></span></td><td>${v.hours_per_degree.toFixed(1)} hours</td><td><span class="status-pill ${v.updated?'mode':'neutral'}" title="${v.heating_hours} observed heating hours; ${v.idle_hours} idle hours. Enough observations do not by themselves prove accuracy.">${v.updated?'Adapting':'Initial estimate'}</span></td></tr>`;}).join('')}</tbody></table></div><p>Initial rooms share starting estimates. Comparisons become more useful as their heat-loss parameters adapt to observations. Wind, ventilation, sensor placement and unmeasured heat sources can affect the estimates. The listed time describes this reference test, not how long heating can safely remain off in your home.</p></div></details></section>`;
  }
  overview(){
    const quality=this.collectionQuality();const data=this.info.data||{};const rooms=Object.entries(data.rooms||{}).sort((a,b)=>compareRoomNames(a[1],b[1]));
    return `<section class="status-card"><div class="status-heading"><h2>ThermalPilot status</h2></div>
    <dl class="status-grid">
      <div class="status-block"><dt>Operation</dt><dd><span class="status-pill ${data.heating_active===false?'paused':'active'}">${data.heating_active===false?'Passive':'Active'}</span></dd>${this.controlBadges()}<small>${data.heating_active===false?'Observation and learning are stopped.':'Observation and learning are enabled.'}</small></div>
      <div class="status-block status-temperature" title="Recorded temperatures within the electricity price chart period, fitted across the card width"><dt>Outdoor temperature</dt><dd>${escapeHTML(data.outdoor??'—')}<span class="status-unit"> °C</span></dd>${this.statusSparkline('outdoor','#2196f3')}</div>
${waterDistribution(this.settings)?`      <div class="status-block status-temperature" title="Recorded temperatures within the electricity price chart period, fitted across the card width"><dt>Heating water temperature</dt><dd>${escapeHTML(data.water??'—')}<span class="status-unit"> °C</span></dd>${this.statusSparkline('water','#16b957')}</div>`:''}
      <div class="status-block"><dt>Data collection</dt><dd><span class="status-pill ${data.collection?.collecting?'active':'paused'}">${data.collection?.collecting?'Active':'Paused'}</span><span class="status-pill quality quality-${quality.level}" tabindex="0" title="${escapeHTML(quality.detail)}">Data coverage: ${quality.label}</span></dd></div>
      <div class="status-block"><dt>Stored history</dt><dd>${escapeHTML(Number(data.history_info?.rows??0).toLocaleString())}<span class="status-unit"> samples</span></dd><small class="collection-date">Collection started: ${data.history_info?.started_at!=null?escapeHTML(dateLabel(data.history_info.started_at*1000)):'No observations yet'}</small><small>Local database: ${((data.history_info?.bytes??0)/1048576).toFixed(1)} MiB</small></div>
      <div class="status-block"><dt>Last update</dt><dd class="status-time">${escapeHTML(data.updated?timeLabel(data.updated):'—')}</dd><small>Latest calculation and observation.</small></div>
    </dl>${(data.warnings||[]).map(w=>statusNotice(w,statusMessageLevel(w))).join('')}</section>${!rooms.length?'<section>Add rooms on the Settings page.</section>':''}
    ${data.price_outlook?.enabled?`<p class="notice notice-${data.price_outlook.available?'info':'warning'}" role="status">${statusIcon(data.price_outlook.available?'info':'warning')}<span class="notice-text">${data.price_outlook.available?`Price forecast available · ${data.price_outlook.reserve_hours>6?'Extra heat storage considered ahead of expensive hours.':'No extra heat storage needed.'}`:`Price forecast: ${escapeHTML(data.price_outlook.reason||'Waiting for confirmed prices.')}`}</span></p>`:''}<div class="plan-comparison-grid">${electricHeating(this.settings)?this.priceChart(false):''}${this.heatRetentionView()}</div><div class="observation-cards">${rooms.map(([id,r])=>{const p=r.plan,m=r.model||{};return `<section class="observation-card"><details class="observation-accordion" data-room-accordion="${escapeHTML(id)}" ${this.roomDisclosureOpen(id)?'open':''}><summary><h2><span data-user-text>${escapeHTML(r.name)}</span> ${this.roomHeatingBadge(r,id)} ${this.learningBadge(r)} <small>${p?(p.heat?'Boosted thermostat target':p.mode==='normal'?'Normal thermostat target temperature':'Reduced thermostat target temperature'):'No suggestion'}</small></h2></summary><div class="observation-content"><div class="metrics"><div>Measured<strong>${escapeHTML(r.temperature??'—')} °C</strong></div><div>Suggested thermostat target<strong>${escapeHTML(p?.setpoint??'—')} °C</strong></div><div>Actual heating<strong>${heatingLabel(r.actual_activity)}</strong></div><div title="Mean error of saved 3-hour forecasts over the last seven days; actual heating may differ from the proposed plan.">3-hour forecast error<strong>${r.forecast_accuracy?.['3']?.count?r.forecast_accuracy['3'].mae.toFixed(2)+' °C':'—'}</strong></div></div>${r.error?statusNotice(r.error,'error'):p?.reason?.startsWith('Temperature limit risk:')?statusNotice(p.reason,'warning'):`<p>${escapeHTML(p?.reason||'Waiting for data.')}</p>`}${this.learningView(r)}
    ${p?`<h3>Thermostat timing</h3><p>Target changes include the shared start/stop offsets. The temperature forecast models the planned heating period; actual valve and heat-pump delays must be checked against observations.</p><div class="scroll timing-table"><table><thead><tr><th>Planned heating starts</th><th>Planned heating ends</th></tr></thead><tbody>${(p.sessions||[]).map(s=>`<tr><td>${escapeHTML(timeLabel(s.start))}</td><td>${escapeHTML(timeLabel(s.end))}</td></tr>`).join('')||'<tr><td class="empty-table" colspan="2">No heating sessions planned.</td></tr>'}</tbody></table></div><div class="scroll timing-table"><table><thead><tr><th>Change target at</th><th>Action</th><th>Target (°C)</th></tr></thead><tbody>${(p.commands||[]).map(c=>`<tr><td>${escapeHTML(timeLabel(c.time))}</td><td>${c.action==='raise'?'Boost':c.action==='restore'?'Restore normal':'Reduce'}</td><td>${c.setpoint}</td></tr>`).join('')||'<tr><td class="empty-table" colspan="3">No thermostat target changes planned.</td></tr>'}</tbody></table></div>${this.chart(p.slots,'temperature')}<p>Blue: predicted temperature under the proposed plan. This outcome has not been observed.</p><div class="scroll"><table><thead><tr><th>Starts</th><th>Price (c/kWh)</th><th>Suggestion</th><th>Setpoint °C</th><th>Prediction °C</th></tr></thead><tbody>${p.slots.map(s=>`<tr class="${s.heat?'heat':''}"><td>${escapeHTML(timeLabel(s.start))}</td><td>${s.price.toFixed(2)}</td><td>${s.heat?'Store heat':s.mode==='normal'?'Normal':'Reduced'}</td><td>${s.setpoint}</td><td>${s.temperature.toFixed(2)}</td></tr>`).join('')}</tbody></table></div>`:''}</div></details></section>`;}).join('')}</div>`;
  }
  historyView(){
    return `<div class="history-summary"><section><h2>Observations and suggestions</h2><label>Period<select id="history-hours">${[24,48,168].map(h=>`<option value="${h}" ${h===this.historyHours?'selected':''}>${h} hours</option>`).join('')}</select></label><p>Compare recorded temperatures with forecasts saved hours earlier. The accuracy cards also compare against predicting no temperature change. Forecasts assume the proposed heating plan; actual heating may differ, especially during simulation.</p></section>
    <section><h2>Season archives</h2><p>Learned parameters and season aggregates are retained when old observations are compacted.</p>${(this.info.data?.season_summaries||[]).map(a=>`<p>${escapeHTML(a.season)} · ${escapeHTML(this.settings.rooms.find(r=>r.id===a.room_id)?.name||a.room_id)} · ${a.statistics?.samples||0} observations · loss ${(a.model?.loss||0).toFixed(4)} · heating gain ${(a.model?.gain||0).toFixed(3)}</p>`).join('')||'<p>No completed heating season yet.</p>'}</section></div>${electricHeating(this.settings)?this.priceChart(true):''}<div class="observation-cards">${[...this.settings.rooms].sort(compareRoomNames).map(room=>{const rows=(this.history||[]).filter(r=>r.room_id===room.id);const recent=quarterHourObservations(rows).slice(-288);return `<section class="observation-card"><details class="observation-accordion" data-room-accordion="${escapeHTML(room.id)}" ${this.roomDisclosureOpen(room.id)?'open':''}><summary><h2><span data-user-text>${escapeHTML(room.name)}</span> ${this.roomHeatingBadge(this.info.data?.rooms?.[room.id],room.id)} ${this.learningBadge(this.info.data?.rooms?.[room.id])}</h2></summary><div class="observation-content"><h3>Suggested heating and relay history</h3><div data-room-history="${escapeHTML(room.id)}"><p>Loading Home Assistant history…</p></div><p>Suggested On means the boosted target window, including valve timing offsets. Relay On means observed demand; it does not guarantee heat flow.</p>${this.forecastHistoryView(rows)}<div class="scroll"><table><thead><tr><th>15-minute interval</th><th>Suggested heating window</th><th>Actual thermostat demand</th><th>Measured temperature (°C)</th><th>Suggested thermostat target (°C)</th></tr></thead><tbody>${recent.reverse().map(r=>`<tr><td title="Latest observation: ${escapeHTML(timeLabel(r.time*1000))}">${escapeHTML(timeLabel(r.interval_start*1000))}</td><td>${heatingLabel(r.suggested_heat)}</td><td>${heatingLabel(r.activity)}</td><td>${r.temperature}</td><td>${r.suggested_setpoint??'—'}</td></tr>`).join('')}</tbody></table></div><p>Each row shows the latest observation within its 15-minute interval, not an average. Suggested thermostat target is the setting ThermalPilot would apply, not a room-temperature forecast. Table shows up to 288 intervals. Original observations remain stored internally. Short chart views use 15-minute time labels; longer views use wider intervals.</p></div></details></section>`;}).join('')}</div>`;
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
  hasUnsavedSettings(){
    if(!this.info?.settings||!this.settings)return false;
    const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
    return JSON.stringify(canonical(this.settings))!==JSON.stringify(canonical(this.info.settings));
  }
  updateUnsavedNotice(){
    this.capture();
    const notice=this.shadowRoot.querySelector('#settings-unsaved');
    if(notice)notice.hidden=!this.hasUnsavedSettings();
  }
  switchTab(tab){
    if(tab===this.tab)return;
    if(this.tab==='settings'){
      this.capture();
      if(this.hasUnsavedSettings()&&!confirm(this.t('You have unsaved settings. Discard these changes and switch tabs?')))return;
    }
    this.tab=tab;this.loaded=false;this.load();
  }
  capture(){this.shadowRoot.querySelectorAll('[data-field]').forEach(input=>{const [prefix,key]=input.dataset.field.split('.');const obj=prefix==='source'?this.settings:this.settings.rooms[Number(prefix.slice(4))];obj[key]=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;});}
  render(){
    this.shadowRoot.innerHTML=`<style>:host{display:block;color:var(--primary-text-color,#213547);background:var(--primary-background-color,#f5f7fa);min-height:100vh;font:15px system-ui}*{box-sizing:border-box}header,main{max-width:1250px;margin:auto;padding:24px}h1{margin:0 0 8px}h2{font-size:21px}small{font-size:14px;font-weight:normal}nav{display:flex;gap:8px;margin-top:18px}button{border:1px solid #aac0c8;border-radius:8px;padding:10px 16px;background:var(--card-background-color,white);color:inherit;cursor:pointer;margin:4px}button.active,.primary{background:#087c85;color:white}section{background:var(--card-background-color,white);border:1px solid var(--divider-color,#dce4e8);border-radius:14px;padding:24px;margin:0 0 20px}.settings-group{margin-top:24px}.settings-group+.settings-group{border-top:1px solid var(--divider-color,#dce4e8);padding-top:8px}.settings-group h3{font-size:17px;margin:16px 0}.settings-sources{background:linear-gradient(#2196f312,#2196f312),var(--card-background-color,white)}.settings-house{background:linear-gradient(#2196f312,#2196f312),var(--card-background-color,white)}.settings-shared{background:linear-gradient(#00857712,#00857712),var(--card-background-color,white)}.settings-rooms{background:linear-gradient(#e4902515,#e4902515),var(--card-background-color,white)}.badge{color:#087c85;font-weight:600}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:18px}label[hidden],[data-water-group][hidden],[data-electric-group][hidden],label[data-electric-control][hidden]{display:none}label{display:flex;flex-direction:column;gap:7px}.number-unit{display:flex;align-items:center;gap:8px}.number-unit input{min-width:0;flex:1}.number-unit span{flex:none}input,select{width:100%;padding:10px;border:1px solid #aabdc5;border-radius:6px;color:inherit;background:var(--card-background-color,white)}input[type=checkbox].setting-toggle{appearance:none;-webkit-appearance:none;width:44px;height:26px;padding:2px;border:0;border-radius:13px;background:var(--disabled-color,#87949b);cursor:pointer;transition:background .15s}input[type=checkbox].setting-toggle::before{content:"";display:block;width:22px;height:22px;border-radius:50%;background:white;box-shadow:0 1px 3px #0003;transition:transform .15s}input[type=checkbox].setting-toggle:checked{background:var(--primary-color,#087c85)}input[type=checkbox].setting-toggle:checked::before{transform:translateX(18px)}input[type=checkbox].setting-toggle:focus-visible{outline:2px solid var(--primary-color,#087c85);outline-offset:3px}details{border-top:1px solid #ddd;padding:18px 0}summary{font-weight:600;cursor:pointer;margin-bottom:20px}.room-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;align-items:start;margin:20px 0}.room-card{position:relative;min-width:0;border:1px solid var(--divider-color,#dce4e8);border-radius:12px;padding:20px;background:var(--card-background-color,white)}.room-card details{border:0;padding:0}.room-card summary{margin:0;min-height:26px;padding-right:78px;overflow-wrap:anywhere}.room-target{font-weight:normal;color:var(--secondary-text-color,#60737b);white-space:nowrap;margin-left:8px}.room-card details[open] summary{margin-bottom:20px}.room-fields{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.room-fields label{min-width:0}.room-fields input,.room-fields select{min-width:0;max-width:100%}.room-actions{position:absolute;top:10px;right:10px;display:flex;gap:4px;margin:0}.room-actions .icon-button{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;padding:7px;margin:0;border:0;background:transparent;border-radius:50%}.room-actions .icon-button:hover{background:var(--secondary-background-color,#eef2f4)}.room-actions .icon-button:focus-visible{outline:2px solid var(--primary-color,#087c85);outline-offset:2px}.room-actions .delete-room{color:var(--error-color,#c62828)}.icon-button svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}@media(max-width:900px){.room-cards{grid-template-columns:minmax(0,1fr)}}@media(max-width:600px){.room-fields{grid-template-columns:minmax(0,1fr)}.room-card{padding:16px}}.sticky{position:sticky;bottom:0;background:var(--card-background-color,white);padding:12px;box-shadow:0 -2px 8px #0001}.metrics{display:flex;gap:24px;flex-wrap:wrap}.metrics strong{display:block;font-size:24px;margin-top:8px}.notice-icon{width:20px;height:20px;max-height:none;flex:0 0 20px;fill:none;stroke:var(--notice-accent,#3498db);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;margin-top:2px}.notice-text{min-width:0;overflow-wrap:anywhere}.notice-level{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.notice,.message{display:flex;align-items:flex-start;gap:10px;padding:12px 16px;border-radius:8px;color:var(--primary-text-color,#213547);border-left:3px solid var(--notice-accent,#3498db);background:linear-gradient(var(--notice-tint,#3498db18),var(--notice-tint,#3498db18)),var(--card-background-color,white)}.notice-info{--notice-accent:#3498db;--notice-tint:#3498db18}.notice-warning{--notice-accent:#d9a400;--notice-tint:#f5c51820}.notice-error{--notice-accent:#d64545;--notice-tint:#d6454518}.save-toast{position:fixed;bottom:calc(24px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);z-index:10000;width:max-content;max-width:calc(100% - 32px);margin:0;padding:14px 20px;box-shadow:0 4px 18px #0002;pointer-events:none}[data-room-history]{margin:12px 0}[data-room-history] a{display:inline-block;color:var(--primary-color,#087c85);margin-top:12px}.chart-legend{display:flex;flex-wrap:wrap;gap:12px 24px;margin:14px 0 6px}.chart-legend span{display:flex;align-items:center;gap:8px}.chart-legend i{display:inline-block;width:24px;height:3px}.temperature-chart{overflow-x:auto;margin:8px 0}.temperature-chart svg{display:block;min-width:800px;width:100%;max-height:none}.scroll{overflow:auto;max-height:420px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #ddd;white-space:nowrap}.heat{background:#00857718}svg{width:100%;max-height:230px}svg text{fill:var(--primary-text-color,#213547);font-size:12px}p{line-height:1.6}@media(max-width:600px){header,main{padding:12px}section{padding:16px}}
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
 #settings .grid>label>span:first-child{min-height:0}#settings label:has([data-field="source.heating_enabled"]){grid-column:1/-1}
}
@media(min-width:1400px){
 #settings{grid-template-columns:repeat(2,minmax(0,1fr))}#settings>.settings-sources{grid-column:1;grid-row:1}#settings>.settings-house{grid-column:2;grid-row:1}#settings>.settings-shared{grid-column:1;grid-row:2}#settings>.settings-rooms{grid-column:2;grid-row:2}#settings .settings-group>.grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(min-width:1800px){#settings .settings-group>.grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
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
header.page-layout{padding-bottom:0}
.tab-list{gap:5px;margin-top:22px;padding:0;align-items:flex-end}
.tab-list button{margin:0 0 -1px;border:1px solid #91a5ad;border-radius:9px 9px 0 0;padding:12px 28px;background:var(--secondary-background-color,#eaf0f4);color:var(--secondary-text-color,#526671);font-weight:500;min-width:105px}
.tab-list button:hover{color:var(--primary-text-color,#213547);background:var(--card-background-color,#fff)}
.tab-list button.active{border-top:3px solid #087c85;border-bottom-color:var(--card-background-color,#fff);padding-top:10px;background:var(--card-background-color,#fff);color:var(--primary-color,#087c85);font-weight:700;position:relative;z-index:1}
.tab-list button:focus-visible{outline:2px solid #087c85;outline-offset:-5px}
.tab-panel.page-layout{margin:0 24px 24px;border:1px solid #91a5ad;border-radius:0 12px 12px 12px;padding:24px;background:var(--card-background-color,#fff);min-height:320px;box-shadow:0 2px 6px #00000008}
.collection-date{display:block;margin-bottom:6px}
@media(max-width:600px){.tab-panel.page-layout{margin:0 12px 12px;padding:12px}.tab-list{padding:0;gap:3px}.tab-list button{min-width:0;padding-left:18px;padding-right:18px}}
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
.status-temperature{position:relative;overflow:hidden;padding-bottom:54px}
.status-temperature>dt,.status-temperature>dd,.status-temperature>small{position:relative;z-index:1}
.status-temperature .status-sparkline{position:absolute;bottom:0;left:0;width:100%;height:46px;max-height:none;pointer-events:none}
.status-block dt{font-size:14px;color:var(--secondary-text-color,#526671);margin-bottom:10px}
.status-block dd{margin:0 0 8px;font-size:24px;font-weight:650;overflow-wrap:anywhere}
.status-block small{font-size:13px;line-height:1.4;color:var(--secondary-text-color,#526671)}
.status-unit{font-size:14px;font-weight:normal}
.status-block .status-time{font-size:20px}
.status-pill{display:inline-flex;padding:5px 10px;border-radius:7px;font-size:16px;background:var(--secondary-background-color,#eef2f4)}
.status-pill.winter{background:#3498db24;color:#1b4f72;border-left:3px solid #3498db}
.status-pill.summer{background:#82e0aa33;color:#186a3b;border-left:3px solid #2ecc71}
.status-pill.active{background:#2ecc7126;color:var(--primary-text-color,#166534);border-left:3px solid #229954}
.status-badges{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
.status-block dd{display:flex;align-items:baseline;flex-wrap:wrap;gap:7px}
.status-pill.mode{background:#087c8518;border-left:3px solid #087c85}
.status-pill.missing,.quality-0{background:#e74c3c20;border-left:3px solid #c0392b}
.status-pill.quality-1{background:#e67e2220;border-left:3px solid #d35400}
.status-pill.quality-2{background:#f1c40f26;border-left:3px solid #b7950b}
.status-pill.quality-3{background:#82e0aa30;border-left:3px solid #52a56d}
.status-pill.quality-4{background:#2ecc7126;border-left:3px solid #229954}
.status-pill:focus-visible{outline:2px solid #087c85;outline-offset:2px}
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

@media(min-width:1400px){#settings>.settings-sources,#settings>.settings-house,#settings>.settings-shared,#settings>.settings-rooms{align-self:stretch}}

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

.room-heating{display:inline-flex;vertical-align:middle;align-items:center;justify-content:center;width:30px;height:30px;margin-left:6px;border-radius:50%;color:#d32f2f;background:#e5393518}
.room-heating svg{width:19px;height:19px;fill:currentColor;stroke:currentColor;stroke-width:1.2;stroke-linejoin:round}
.room-heating.idle,.room-heating.unknown{color:var(--secondary-text-color,#6b7280);background:#7a879218}
.room-heating.idle svg{fill:none}
.room-heating.unknown{font-size:20px;font-weight:700}
.room-heating:focus-visible{outline:2px solid currentColor;outline-offset:2px}
.room-learning{display:inline-block;margin-left:8px;font-size:14px;font-weight:normal;vertical-align:middle;white-space:nowrap;color:var(--secondary-text-color,#526671)}

/* Keep navigation reachable and card content inside the phone viewport. */
:host{min-width:0;max-width:100%}
.page-title{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.page-title h1{margin:0;min-width:0}
.menu-button{display:inline-flex;align-items:center;justify-content:center;flex:none;width:44px;height:44px;margin:0;padding:10px;border:0;background:transparent}
.menu-button svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.menu-button:focus-visible{outline:2px solid var(--primary-color,#087c85);outline-offset:2px}
.page-layout,section,.scroll,.price-chart-viewport,.temperature-chart{min-width:0;max-width:100%}
@media(max-width:600px){
 header.page-layout{padding:12px 10px 0}
 .page-title h1{font-size:25px}
 .badge{font-size:13px;line-height:1.45;overflow-wrap:anywhere}
 .tab-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin-top:16px}
 .tab-list button{min-height:44px;padding:12px 6px}
 .tab-panel.page-layout{margin:0 10px 12px;padding:10px;border-radius:0 0 12px 12px}
 #settings>section,.observation-cards>section,.history-summary>section,.status-card,.price-card{padding:12px}
 #settings,.observation-cards,.history-summary{gap:16px}
 .grid{grid-template-columns:minmax(0,1fr)}
 .status-grid{grid-template-columns:minmax(0,1fr);gap:10px}
 .observation-card .metrics{grid-template-columns:minmax(0,1fr);gap:10px}
 .observation-card .observation-accordion>summary{padding:10px;gap:6px}
 .observation-card .observation-accordion>summary h2{font-size:18px;overflow-wrap:anywhere}
 .room-learning{display:block;margin:5px 0 0;white-space:normal;font-size:13px}
 .observation-card .temperature-chart svg{min-width:0;width:100%;height:195px;max-height:none}
 .temperature-chart,.history-layout [data-room-history]{padding:6px}
 .scroll{overflow-x:auto;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch}
 th,td{font-size:13px}
 .sticky{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:10px 6px calc(10px + env(safe-area-inset-bottom));font-size:13px}
 input:not([type=checkbox]),select,#settings input:not([type=checkbox]),#settings select{font-size:16px;min-height:44px}
 input[type=checkbox].setting-toggle,#settings input.setting-toggle{width:44px;height:26px;min-height:26px;max-height:26px;padding:2px;align-self:start}
 .setting-help .setting-info{width:32px;height:32px}
 .setting-tooltip{position:fixed;left:16px;right:16px;bottom:calc(84px + env(safe-area-inset-bottom));width:auto;max-width:none;max-height:55vh;overflow:auto}
 .room-card summary{min-height:36px}
 .room-actions .icon-button{width:40px;height:40px}
 .room-card summary{padding-right:88px}
 .chart-legend span{min-width:0;align-items:flex-start}
 .chart-legend i{flex:none;margin-top:7px}
 .learning-card{padding:12px}
}

.chart-tooltip{position:fixed;z-index:10000;max-width:min(340px,calc(100vw - 16px));padding:12px 14px;border-radius:8px;background:var(--primary-text-color,#213547);color:var(--card-background-color,#fff);box-shadow:0 4px 16px #0003;font-size:14px;line-height:1.5;white-space:pre-line;pointer-events:none}
.chart-tooltip[hidden]{display:none}
[data-chart-detail]{cursor:pointer}
[data-chart-detail]:focus-visible{outline:2px solid #213547;outline-offset:2px}
.forecast-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:16px 0}.forecast-metric{padding:12px;border:1px solid #91a5ad;border-radius:10px;background:var(--card-background-color,white)}.forecast-selection{max-width:240px;margin:14px 0}
.unsaved-notice{padding:6px 10px;border-radius:8px;background:#ffb30026;color:var(--primary-text-color,#7a4b00);border-left:3px solid #e49025;font-weight:600}.unsaved-notice[hidden]{display:none}
.plan-comparison-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:20px;margin-bottom:20px;align-items:start}.plan-comparison-grid>section{min-width:0;margin-bottom:0!important}@media(min-width:1800px){.plan-comparison-grid{grid-template-columns:minmax(0,1.7fr) minmax(600px,1fr);align-items:stretch}.plan-comparison-grid>section{height:100%}.plan-comparison-grid .retention-bar{width:70px;margin-left:6px}.plan-comparison-grid .retention-value{min-width:65px}}
.retention-card{background:linear-gradient(#0085770c,#0085770c),var(--card-background-color,white)}.retention-value{display:inline-block;min-width:80px}.retention-bar{display:inline-block;width:110px;height:7px;margin-left:10px;border-radius:4px;background:#819aa324}.retention-bar i{display:block;height:100%;border-radius:4px;background:#418ba4}.retention-card .scroll{max-height:none}.retention-card h2{margin:0}.retention-card td{padding:8px}
</style>
    <header class="page-layout ${this.tab==='settings'?'settings-layout':this.tab==='history'?'history-layout observation-layout':'plan-layout observation-layout'}"><div class="page-title"><button type="button" class="menu-button" id="ha-menu" aria-label="Open Home Assistant menu" title="Open Home Assistant menu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg></button><h1>ThermalPilot</h1></div><div class="badge">${!electricHeating(this.settings)?'COMFORT PLANNING · observation and learning, no thermostat control':!this.settings?.simulation_enabled&&this.settings?.live_control_confirmed?(this.settings?.heating_enabled===false?'LIVE CONTROL PAUSED · seasonal fallback targets':'LIVE CONTROL · ThermalPilot controls thermostat targets'):this.settings?.apply_season_setpoints?'SEASON SETPOINT CONTROL ENABLED · heating schedules remain simulated':'SIMULATION · your existing automation remains in control'}</div><nav class="tab-list" role="tablist" aria-label="ThermalPilot pages">${[['overview','Plan'],['history','History'],['settings','Settings']].map(([id,label])=>`<button id="tab-${id}" role="tab" aria-selected="${this.tab===id}" aria-controls="thermal-pilot-tab-panel" tabindex="${this.tab===id?0:-1}" data-tab="${id}" class="${this.tab===id?'active':''}">${label}</button>`).join('')}</nav>${this.message&&!this.saveConfirmation?`${statusNotice(this.message,this.messageLevel||'info','message')}`:''}</header><main id="thermal-pilot-tab-panel" role="tabpanel" aria-labelledby="tab-${this.tab}" class="tab-panel page-layout ${this.tab==='settings'?'settings-layout':this.tab==='history'?'history-layout observation-layout':'plan-layout observation-layout'}">${!this.info?'Loading…':this.tab==='settings'?this.settingsView():this.tab==='history'?this.historyView():this.overview()}</main>${this.message&&this.saveConfirmation?`<div class="message save-toast notice-info" role="status" aria-live="polite">${statusIcon('info')}<span class="notice-text">${escapeHTML(this.message)}</span></div>`:''}`;
    this.shadowRoot.querySelector('#ha-menu')?.addEventListener('click',()=>this.openSidebar());
    const retention=this.shadowRoot.querySelector('#retention-accordion');if(retention)retention.addEventListener('toggle',()=>{this.retentionOpen=retention.open;});
    const priceAccordion=this.shadowRoot.querySelector('#price-accordion');if(priceAccordion){const tab=this.tab;priceAccordion.addEventListener('toggle',()=>{this.priceAccordionState??={};this.priceAccordionState[tab]=priceAccordion.open;});}
    this.shadowRoot.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>this.switchTab(b.dataset.tab));
    this.shadowRoot.querySelector('.tab-list')?.addEventListener('keydown',event=>{
      const tabs=['overview','history','settings'],index=tabs.indexOf(event.target.dataset.tab);
      let next;
      if(event.key==='ArrowRight')next=(index+1)%tabs.length;
      else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;
      else if(event.key==='Home')next=0;
      else if(event.key==='End')next=tabs.length-1;
      else return;
      event.preventDefault();this.focusTabRequested=true;this.switchTab(tabs[next]);
    });
    if(this.focusTabRequested){this.shadowRoot.querySelector(`[data-tab="${this.tab}"]`)?.focus();this.focusTabRequested=false;}

    this.translateRoot(this.shadowRoot);
    this.shadowRoot.querySelector('#add')?.addEventListener('click',()=>{this.message='';this.capture();this.settings.rooms.push({...this.info.room_defaults,id:roomId()});this.render();});
    this.shadowRoot.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{this.capture();const index=Number(b.dataset.remove),room=this.settings.rooms[index];if(!room||!confirm(this.t(`Remove room "${room.name||'New room'}"? Save settings to apply this change.`)))return;this.message='';this.settings.rooms.splice(index,1);this.render();});
    this.shadowRoot.querySelectorAll('[data-reset]').forEach(b=>b.onclick=async()=>{if(!confirm(this.t('Reset the learned parameters for this room? Observation history will be retained.')))return;try{await this.call('reset',{room_id:b.dataset.reset});this.message='Room learning reset.';this.messageLevel='info';this.saveConfirmation=false;}catch(e){this.message=e.message;this.messageLevel='error';this.saveConfirmation=false;}this.capture();this.render();});
    const settingsForm=this.shadowRoot.querySelector('#settings');
    const clearSaveMessage=()=>{clearTimeout(this.saveMessageTimer);this.saveConfirmation=false;this.message='';this.shadowRoot.querySelector('.message')?.remove();};
    settingsForm?.addEventListener('input',event=>{
      clearSaveMessage();this.updateUnsavedNotice();
      const field=event.target?.dataset?.field;
      if(field?.startsWith('room')&&field.endsWith('.baseline')){
        const target=event.target.closest('.room-card')?.querySelector('.room-target');
        if(target)target.textContent=`${event.target.value||'—'} °C`;
      }
    });
    settingsForm?.addEventListener('change',event=>{if(event?.target?.dataset?.field==='source.house_heat_source'){this.capture();this.render();return;}if(event?.target?.dataset?.field==='source.language'){this.capture();this.render();return;}if(event?.target?.dataset?.field==='source.house_distribution'){this.shadowRoot.querySelectorAll('[data-water-group]').forEach(group=>group.hidden=!waterDistribution({house_distribution:event.target.value}));}clearSaveMessage();this.updateUnsavedNotice();if(event?.target?.dataset?.field?.endsWith('.solar_direction')){const exposure=event.target.closest('.room-card')?.querySelector('[data-solar-exposure]');if(exposure)exposure.hidden=event.target.value==='disabled';}});
    settingsForm?.addEventListener('submit',async e=>{
      e.preventDefault();if(this.saving)return;this.capture();
      const savedDistribution=this.info.settings?.house_distribution||'water_floor';
      if((this.settings.house_distribution||'water_floor')!==savedDistribution&&!confirm(this.t('Changing heat distribution restarts room-response learning because the heating input changes. Recorded history is retained. Continue?')))return;
      const enableLive=electricHeating(this.settings)&&this.settings.simulation_enabled===false&&!this.info.settings?.live_control_confirmed;
      if(enableLive&&!confirm(this.t('Enable real thermostat control? Disable your existing heating automation first. ThermalPilot will apply its scheduled targets, even while the model is still learning. Missing essential data returns affected rooms to their seasonal fallback temperature.')))return;
      clearSaveMessage();this.saving=true;
      const saveButton=settingsForm.querySelector('button[type=submit]');
      if(saveButton)saveButton.textContent=this.t('Saving…');
      settingsForm.querySelectorAll('input,select,button').forEach(control=>control.disabled=true);
      try{await this.call('save',{settings:this.settings,enable_live_control:enableLive});this.settings.live_control_confirmed=!this.settings.simulation_enabled;this.info.settings=structuredClone(this.settings);this.message=`Settings saved at ${new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})}. Suggestions will update shortly.`;this.saveConfirmation=true;this.messageLevel='info';
        const confirmation=this.message;
        clearTimeout(this.saveMessageTimer);
        this.saveMessageTimer=setTimeout(()=>{if(this.saveConfirmation&&this.message===confirmation){this.message='';this.saveConfirmation=false;this.shadowRoot.querySelector('.save-toast')?.remove();}},5000);
      }
      catch(error){this.message=`Settings were not saved: ${error.message||String(error)}`;this.messageLevel='error';this.saveConfirmation=false;}
      finally{this.saving=false;this.render();}
    });
    const disclosureTab=this.tab;
    this.shadowRoot.querySelectorAll('[data-room-accordion]').forEach(details=>details.addEventListener('toggle',()=>{this.roomDisclosureState.set(`${disclosureTab}:${details.dataset.roomAccordion}`,details.open);}));
    this.shadowRoot.querySelectorAll('[data-forecast-hours]').forEach(select=>select.addEventListener('change',event=>{this.forecastHours=Number(event.target.value);this.render();}));
    this.mountPriceChartSizing();
    if(this.tab==='history')this.mountHistoryGraphs();
    this.shadowRoot.querySelector('#history-hours')?.addEventListener('change',e=>{this.historyHours=Number(e.target.value);this.load();});
  }
}
if(!customElements.get('thermal-pilot-panel'))customElements.define('thermal-pilot-panel',ThermalPilotPanel);
