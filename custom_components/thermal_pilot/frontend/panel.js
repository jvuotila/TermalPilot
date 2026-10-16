await import(new URL(`./localization.js${new URL(import.meta.url).search}`, import.meta.url));
/* Native custom panel. All data is escaped; settings are validated server-side. */
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tooltipInfoIcon='<svg class="status-info" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="8"/><path d="M10 9v5"/><circle class="status-info-dot" cx="10" cy="6" r="1"/></svg>';
const roomFloorPlanAsset=typeof location!=='undefined'&&/\/PREVIEW\.html$/.test(location.pathname)?'./custom_components/thermal_pilot/frontend/rooms-floor-plan.png':'/thermal_pilot/rooms-floor-plan.png';
const dateLabel = value => new Date(value).toLocaleDateString('fi-FI',{day:'2-digit',month:'2-digit',year:'numeric'});
const timeLabel = value => `${dateLabel(value)} ${new Date(value).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',hour12:false})}`;
const entityLabel = state => state?.attributes?.friendly_name || (state?.entity_id?.split('.').slice(1).join('.').replace(/_/g,' ')) || 'Unavailable entity';
const pumpStageLabels={power:'Power on',hvac_mode:'Operating mode',temperature:'Heating setpoint',fan_mode:'Fan speed',swing_mode:'Swing mode',confirmed:'Confirmed',checking:'Checking'};
const pumpOptionKeys={air_fan_cool:'fan_modes',air_swing_cool:'swing_modes',air_fan_heat:'fan_modes',air_fan_idle:'fan_modes',air_swing:'swing_modes',air_swing_idle:'swing_modes',garage_fan_heat:'fan_modes',garage_fan_idle:'fan_modes',garage_fan_presence:'fan_modes',garage_swing:'swing_modes',garage_swing_idle:'swing_modes'};
const airRoom=room=>room.is_garage||room.heat_control==='air_to_air';
// Provisional descriptive bands for the fixed 20°C / -10°C reference test.
// Keep cut-offs together so later calibration changes only this scale.
const retentionBands=[
 {below:1,label:'Very fast cooling',level:'very-fast'},
 {below:2,label:'Fast cooling',level:'fast'},
 {below:4,label:'Moderate cooling',level:'moderate'},
 {below:8,label:'Slow cooling',level:'slow'},
 {below:Infinity,label:'Very slow cooling',level:'very-slow'},
];
const relativeRetentionBands=[{below:.5,level:'very-fast',label:'Very fast cooling'},{below:.8,level:'fast',label:'Fast cooling'},{below:1.25,level:'moderate',label:'Moderate cooling'},{below:2,level:'slow',label:'Slow cooling'},{below:Infinity,level:'very-slow',label:'Very slow cooling'}];
function retentionRating(value){
 if(!value?.updated||!Number.isFinite(value.hours_per_degree)||value.hours_per_degree<=0)return {label:'Learning',level:'learning'};
 if(Number.isFinite(value.reference_hours)&&value.reference_hours>0){const ratio=value.hours_per_degree/value.reference_hours;return {...relativeRetentionBands.find(band=>ratio<band.below),relative:true,ratio};}
 return retentionBands.find(band=>value.hours_per_degree<band.below);
}
const controlOptionLabels={house:'House heating system',air_to_air:'Air-to-air heat pump',temperature:'Temperature limits only',tariff:'Electricity tariff optimization',heat:'Heating only',cool:'Cooling only',both:'Heating in winter / cooling in summer',main:'Main room sensor',average:'Average of room sensors',coldest:'Coldest room sensor',fireplace:'Fireplace'};
const settingHelp = {
  climate_mode:'Heating only operates in winter. Cooling only operates in summer. Both heats in winter and cools in summer. Automatic season changes must persist for 24 hours. Reversing between heating and cooling requires confirmed fan-only standby for ten minutes; automatic Heat/Cool mode is never used.',
  cooling_target:'The cooling target for this zone. Cooling starts 0.5 °C above this value and stops when any linked room reaches it. This keeps the pump from repeatedly starting and protects colder rooms.',
  zone_heating_enabled:'Allows ThermalPilot to control the selected zone heat pump for the selected use when global live control is enabled. Off observes the pump without controlling it. If ThermalPilot was already controlling it, it first returns the pump to fan-only standby.',
  air_swing_idle:'The swing mode used in fan-only standby. Options must be supported by every selected ordinary air-to-air heat pump. Leave unchanged sends no standby swing command.',
  garage_swing_idle:'The swing mode used while the garage pump is in fan-only standby. Choose from the selected pump’s supported swing modes. Leave unchanged sends no standby swing command.',
  zone_rooms:'Add the configured rooms affected by this heat source. Select each room once. Rooms already assigned to another zone must first be removed from that zone. Main room choices are limited to the rooms added here. Zone membership does not replace a room’s primary thermostat or heating system. Garage rooms use their own controller and are not linked to shared zones.',
  garage_fan_presence:'The quieter fan speed used when any selected presence sensor detects someone in the garage. When no selected sensor detects presence, the normal heating or standby fan speed returns. This changes only fan speed; temperature limits still control heating. Leave unchanged applies no separate occupied fan setting.',
  is_garage:'Use this room’s own garage limits and air-to-air heat pump controls. House floor-heating limits, heating-water inputs and valve timing do not apply.',
  garage_minimum:'Automatic heating starts when the garage sensor drops below this limit. Outdoors above this value turns the pump off; at or below it, idle operation uses fan-only.',
  garage_maximum:'Temperature-only control keeps heating until this limit is reached, then uses fan-only. Tariff optimization can heat earlier within these limits. ',
  garage_heat_target:'The heat pump’s internal setpoint while heating, separate from the garage sensor’s lower and upper limits. For example, a pump requiring at least 16°C can heat a garage cycling between 5°C and 9°C.',
  garage_strategy:'Temperature limits only preserves the lower-to-upper cycle and works without electricity prices. Tariff optimization uses the learned room response and prices to consider earlier heating; the lower limit still takes priority. Missing prices fall back to temperature cycling.',
  garage_swing:'Options come from the selected heat pump’s swing_modes. Leave unchanged sends no swing command.',
  air_swing:'Options are those supported by every selected ordinary air-to-air heat pump. Leave unchanged sends no swing command.',
  air_heat_target:'Device setpoint used in Heat mode. External room sensors and the heating plan decide when to switch between Heat and Fan only. This is separate from each room’s comfort target.',
  heat_control:'Use the house heating system, or choose a separate air-to-air heat pump. Rooms linked to a heating zone share that zone’s pump; only the zone’s main room issues commands.',
  heating_zone_id:'Link rooms heated by one air-to-air pump. The zone has one controller and a choice of main-room, average or coldest-room temperature. Any linked room at the shared upper limit pauses zone heating.',
  temperature_policy:'Choose the main room sensor, the average of all linked sensors, or the coldest room. All linked sensors must be available. Heating pauses if any linked room reaches the shared upper limit.',
  garage_door_entities:'Door contact sensors pause garage heating when any selected door stays open longer than Pause heating after door opens. The pump switches to fan-only. One shared timer starts when the first selected door opens and keeps running while any selected door remains open. It resets when all selected doors are closed.',
  garage_door_delay:'One shared delay starts when the first selected door opens. Heating switches to fan-only after this many seconds while any selected door remains open. The timer resets when all selected doors are closed.',
  garage_presence_entities:'Presence sensors lower the fan speed to the selected occupied fan mode for more comfortable use of the garage. Any selected sensor detecting someone activates this mode. Normal heating or standby fan speed resumes when no selected sensor detects presence.',

  fireplace_active_state: 'A door/window contact sensor can monitor the fireplace damper position. Select the sensor state that means the fireplace is in use. For a damper contact sensor, Open normally means active and Closed means inactive. Door/window labels are converted to Home Assistant’s underlying on/off values. Other sensors show their declared options, current valid state and any saved value. A contact state indicates the damper position; it does not prove that a fire is burning.',
  language: 'Choose the interface language. Room and entity names remain unchanged. Save settings to keep the choice. Embedded history cards follow this choice where supported by Home Assistant.',
  start_offset_minutes: 'Water-based systems only: raise the thermostat target this many minutes before the planned heat-delivery session, allowing slow valves to open. Electric and air distribution ignore this setting and use no advance offset.',
  stop_offset_minutes: 'Water-based systems only: lower the thermostat target this many minutes before the planned heat-delivery session ends, allowing valves to close. Electric and air distribution ignore this setting and use no closing offset.',
  house_heat_source: 'What produces heat for your house. Select air-to-water for your water floor system supplied by an air-source heat pump. Gas, oil, wood and district heating need their own fuel-cost logic; choosing a house detail does not yet enable a different controller or reset learned room data.',
  house_distribution: 'How heat reaches rooms: circulating water in floors or radiators, electric floor/ceiling/panels, or warm air. Mixed means different rooms use different systems. Water distribution can optionally use a heating-water sensor and uses valve timing. Electric and warm-air distribution ignore those inputs and learn response from observed thermostat demand. Mixed and Other retain water requirements until room overrides are supported.',
  house_heated_floor: 'The construction around floor heating, which affects how slowly heat is stored and released. Concrete slab describes your heated floor. Choose Not applicable if there is no floor heating. This does not change your configured response lag or erase learned parameters.',
  garage_construction:'Construction of this garage only. It does not inherit the house type or reset learning. Garage-specific construction benchmarks are not yet available, so all garage types keep the general cooling-speed bands and the four-hour starting estimate until observations teach the actual response.',
  house_construction:'Approximate comparison for room cooling-speed badges and a starting prior for new room models. Learned values are never overwritten and this selection does not reset learning. References are older whole-building examples, not insulation grades. Unknown keeps the general cooling-speed bands. Garages use their own starting estimate and the general bands.',
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
  price_entity: 'Prefer a sensor that includes electricity prices and additional costs, such as VAT, transfer tariffs, electricity tax and retailer margin. A variable electricity-price sensor without these costs also works. If transfer tariffs differ between day and night, including them helps ThermalPilot choose the cheapest heating hours; omitting them can shift heating to hours that are less economical overall. Select a source containing today/tomorrow or timestamped raw_today/raw_tomorrow price lists, and choose the matching source price unit.',
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
  simulation_enabled: 'Simulation calculates heating suggestions without applying scheduled targets. Disable simulation and confirm to enable real thermostat control. If another automation controls these thermostats, disable it first. Observation and learning continue in both modes.',
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
 ['Air-to-air heat pump settings',['air_heat_target','air_fan_heat','air_swing','air_fan_idle','air_swing_idle','air_fan_cool','air_swing_cool']],
];
const houseOptionLabels={timber_frame:'Timber frame',masonry:'Masonry',lightweight_metal:'Lightweight metal',wooden_detached:'Wooden detached house',masonry_detached:'Masonry detached house',concrete_apartment:'Concrete-element apartment building',heavy_masonry_apartment:'Heavy masonry apartment building',air_to_water:'Air-to-water heat pump',ground_source:'Ground-source heat pump',air_to_air:'Air-to-air heat pump',electric_resistance:'Electric resistance',oil_boiler:'Oil boiler',gas_boiler:'Gas boiler',wood_boiler:'Wood boiler',pellet_boiler:'Pellet boiler',district_heating:'District heating',water_floor:'Water floor heating',water_radiators:'Water radiators',electric_floor:'Electric floor heating',electric_ceiling:'Electric ceiling heating',electric_panels:'Electric panels',warm_air:'Warm air',mixed:'Mixed',concrete_slab:'Concrete slab',thin_screed:'Thin screed',lightweight:'Lightweight floor',not_applicable:'Not applicable',slab_on_ground:'Slab on ground',crawl_space:'Crawl space',basement:'Basement',other:'Other',unknown:'Unknown'};
const schedulingLabels = {hourly:'hourly average',quarterly:'15 minutes',flexible:'flexible'};

function fireplaceStateOptions(sensor,saved){
  const usable=value=>typeof value==='string'&&value!==''&&!['unknown','unavailable'].includes(value);
  const binary=sensor?.entity_id?.startsWith('binary_sensor.');
  const contact=['door','window','opening','garage_door'].includes(sensor?.attributes?.device_class);
  const values=binary?['on','off']:Array.isArray(sensor?.attributes?.options)?sensor.attributes.options.filter(usable):[];
  if(!binary&&usable(sensor?.state)&&!values.includes(sensor.state))values.push(sensor.state);
  if(usable(saved)&&!values.includes(saved))values.push(saved);
  return [...new Set(values)].map(value=>({value,label:binary?(value==='on'?(contact?'Open':'On'):value==='off'?(contact?'Closed':'Off'):value):value}));
}
const sourceReadingKeys=['price_entity','weather_entity','outdoor_entity','wind_entity','water_entity'];
function sourceReading(key,entity,sensor){
  if(!entity)return 'Not selected';
  if(!sensor||sensor.state==='unavailable')return 'Unavailable';
  if(sensor.state==='unknown')return 'Unknown';
  const attrs=sensor.attributes||{};
  if(key==='water_entity'&&entity.startsWith('climate.')){
    const temperature=attrs.current_temperature;
    return temperature!=null&&Number.isFinite(Number(temperature))?`${temperature} ${attrs.temperature_unit||'°C'}`:'No temperature reading';
  }
  if(key==='weather_entity'){
    const condition={sunny:'Sunny',cloudy:'Cloudy',partlycloudy:'Partly cloudy','clear-night':'Clear night',rainy:'Rainy',pouring:'Heavy rain',snowy:'Snowy','snowy-rainy':'Sleet',fog:'Fog',windy:'Windy','windy-variant':'Windy and cloudy',lightning:'Thunderstorms','lightning-rainy':'Thunderstorms and rain',exceptional:'Exceptional weather'}[sensor.state]||sensor.state;
    const temperature=attrs.temperature;
    return condition+(temperature!=null&&Number.isFinite(Number(temperature))?` · ${temperature} ${attrs.temperature_unit||'°C'}`:'');
  }
  return `${sensor.state}${attrs.unit_of_measurement?' '+attrs.unit_of_measurement:''}`;
}
function fireplaceCurrentState(sensor){
  if(!sensor||sensor.state==='unavailable')return 'Unavailable';
  if(sensor.state==='unknown')return 'Unknown';
  return fireplaceStateOptions(sensor,sensor.state).find(option=>option.value===sensor.state)?.label||sensor.state;
}
function forecastRating(stat){
  if(!stat||!Number.isFinite(stat.mae)||stat.mae<0||!(stat.count>0))return {level:null,reason:'pending'};
  if(stat.count<20)return {level:null,reason:'limited'};
  let level=stat.mae<=.2?4:stat.mae<=.4?3:stat.mae<=.6?2:stat.mae<=1?1:0;
  const benchmark=Number.isFinite(stat.persistence_mae)&&stat.persistence_mae>=0;
  const improved=benchmark&&stat.mae<stat.persistence_mae;
  if(!improved)level=Math.min(level,2);
  return {level,reason:!benchmark?'missing_benchmark':!improved?'benchmark':'measured'};
}
function languageFlag(language){
  const rect=(x,y,width,height,fill)=>`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}"/>`;
  const stripes=(colors,vertical=false)=>colors.map((color,index)=>rect(vertical?index*8:0,vertical?0:index*16/3,vertical?8:24,vertical?16:16/3,color)).join('');
  const cross=(background,outer,inner)=>rect(0,0,24,16,background)+rect(7,0,inner?4:3,16,outer)+rect(0,6,24,inner?4:3,outer)+(inner?rect(8,0,2,16,inner)+rect(0,7,24,2,inner):'');
  const shield='<path d="M8 5h5v5q-2.5 3-5 0z" fill="#fff" stroke="#c8102e" stroke-width=".8"/><path d="M9 7h1v1H9zm2 0h1v1h-1zm-1 2h1v1h-1z" fill="#003580"/>';
  const flags={
    sv:cross('#006aa7','#fecc00'),nb:cross('#ba0c2f','#fff','#00205b'),da:cross('#c8102e','#fff'),
    de:stripes(['#000','#dd0000','#ffce00']),fr:stripes(['#002395','#fff','#ed2939'],true),it:stripes(['#009246','#fff','#ce2b37'],true),
    et:stripes(['#4891d9','#000','#fff']),lt:stripes(['#fdb913','#006a44','#c1272d']),
    lv:rect(0,0,24,16,'#9e1b34')+rect(0,6.4,24,3.2,'#fff'),pl:rect(0,0,24,16,'#fff')+rect(0,8,24,8,'#dc143c'),
    es:rect(0,0,24,16,'#aa151b')+rect(0,4,24,8,'#f1bf00')+'<g transform="translate(-2 0)">'+shield+'<path d="M7 6v4m7-4v4" stroke="#fff" stroke-width=".7"/></g>',
    pt:rect(0,0,24,16,'#f00')+rect(0,0,9.6,16,'#006600')+'<g transform="translate(-.9 0)"><circle cx="10.5" cy="8" r="4" fill="none" stroke="#ff0" stroke-width=".7"/><ellipse cx="10.5" cy="8" rx="4" ry="1.5" fill="none" stroke="#ff0" stroke-width=".5"/>'+shield+'</g>'
  };
  const easternShield='<path d="M7 4h6v6q-3 4-6 0z" fill="#d7141a" stroke="#fff" stroke-width=".7"/><path d="M9.6 5h.8v5h-.8zM8.5 6h3v.7h-3zM8 8h4v.7H8z" fill="#fff"/><path d="M7 11q1-3 3-1 2-2 3 1v1q-3 3-6 0z" fill="#0b4ea2"/>';
  const eagle='<path d="M10 5 8 3 6 4 8 5 9 7 5 5 3 3 4 7 7 9 3 8 4 10 8 11 7 13 10 12 12 14 14 12 17 13 16 11 20 10 21 8 17 9 20 7 21 3 19 5 15 7 16 5 18 4 16 3 14 5 13 7 12 6 11 7z" fill="#000"/>';
  const croatianChecks=Array.from({length:25},(_,i)=>rect(9+i%5,5+Math.floor(i/5),1,1,(i+Math.floor(i/5))%2?'#fff':'#ff0000')).join('');
  Object.assign(flags,{
    nl:stripes(['#ae1c28','#fff','#21468b']),is:cross('#02529c','#fff','#dc1e35'),
    ro:stripes(['#002b7f','#fcd116','#ce1126'],true),bg:stripes(['#fff','#00966e','#d62612']),hu:stripes(['#ce2939','#fff','#477050']),
    cs:rect(0,0,24,16,'#fff')+rect(0,8,24,8,'#d7141a')+'<path d="M0 0 12 8 0 16z" fill="#11457e"/>',
    sk:stripes(['#fff','#0b4ea2','#ee1c25'])+easternShield,
    hr:stripes(['#ff0000','#fff','#171796'])+croatianChecks+'<path d="M9 10q2.5 3 5 0" fill="none" stroke="#ff0000" stroke-width=".8"/><path d="M9 4l1-1 1 1 1-1 1 1 1-1v2H9z" fill="#0093dd"/>',
    sr:stripes(['#c6363c','#0c4076','#fff'])+'<g transform="translate(-3 0)"><path d="M9 4h6v7q-3 3-6 0z" fill="#fff"/>'+eagle.replace('fill="#000"','fill="#fff"')+'<path d="M10 6h4v4q-2 2-4 0z" fill="#c6363c"/><path d="M11.5 6h1v4h-1zM10 7.5h4v1h-4z" fill="#fff"/><path d="M9 4l1-2 1 1 1-2 1 2 1-1 1 2z" fill="#edb92e"/></g>',
    el:Array.from({length:9},(_,i)=>rect(0,i*16/9,24,16/9,i%2?'#fff':'#0d5eaf')).join('')+rect(0,0,9,16*5/9,'#0d5eaf')+rect(3.6,0,1.8,16*5/9,'#fff')+rect(0,16*2/9,9,16/9,'#fff'),
    sq:rect(0,0,24,16,'#e41e20')+eagle
  });
  if(flags[language])return `<svg class="language-flag" viewBox="0 0 24 16" aria-hidden="true" focusable="false">${flags[language]}</svg>`;
  const finnish=language==='fi';
  const design=finnish?'<rect width="18" height="11" fill="#fff"/><path d="M5 0h3v11H5zM0 4h18v3H0z" fill="#003580"/>':'<rect width="60" height="30" fill="#012169"/><path d="M0 0 60 30M60 0 0 30" stroke="#fff" stroke-width="6"/><path d="M0 0l20 10h-4L0 2zm60 0L40 10h-4L56 0zM0 30l20-10h4L4 30zm60 0L40 20h4l16 8z" fill="#c8102e"/><path d="M25 0h10v30H25zM0 10h60v10H0z" fill="#fff"/><path d="M27 0h6v30h-6zM0 12h60v6H0z" fill="#c8102e"/>';
  return `<svg class="language-flag" viewBox="${finnish?'0 0 18 11':'0 0 60 30'}" aria-hidden="true" focusable="false">${design}</svg>`;
}
function electricHeating(settings){return ['air_to_water','ground_source','air_to_air','electric_resistance'].includes(settings?.house_heat_source||'air_to_water')||Boolean(settings?.heating_zones?.some(z=>(z.source_type||'air_to_air')==='air_to_air'))||Boolean(settings?.rooms?.some(r=>r.is_garage||r.heat_control==='air_to_air'));}

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
const tpI18n=globalThis.__thermalPilotLocalization;
const {languageNames,languageText,finnishText,heatingFinnishText,translateText}=tpI18n;
function weatherIcon(condition){
  const cloud='<path d="M5 20h21a6 6 0 0 0 0-12 8 8 0 0 0-15-1A6.5 6.5 0 0 0 5 20" fill="#aebfc9" stroke="#94aab7" stroke-width=".8"/>';
  const sun='<circle cx="11" cy="9" r="6" fill="#f4c15a"/><path d="M11 0v2M11 16v2M2 9H0M20 9h2M4 2l2 2M16 14l2 2M4 16l2-2M16 4l2-2" stroke="#e3b04b" stroke-width="1.8" stroke-linecap="round"/>';
  const rain='<path d="m10 24-2 4m10-4-2 4m10-4-2 4" stroke="#6e9db9" stroke-width="2" stroke-linecap="round"/>';
  const snow='<path d="M10 24v7m-3-5 6 3m0-3-6 3m15-5v7m-3-5 6 3m0-3-6 3" stroke="#84aabb" stroke-width="1.4"/>';
  const wind='<path d="M2 12h23q7 0 4-5M0 18h25q7 0 4 5M4 24h11" fill="none" stroke="#92aab6" stroke-width="2.2" stroke-linecap="round"/>';
  if(condition==='sunny')return sun;
  if(condition==='clear-night')return '<path d="M23 2A13 13 0 1 0 29 24 12 12 0 0 1 23 2" fill="#94a9c7"/>';
  if(condition==='partlycloudy')return sun+cloud;
  if(condition==='windy')return wind;
  if(condition==='windy-variant')return cloud+wind;
  if(condition==='fog')return cloud+'<path d="M0 24h29M5 29h23" stroke="#a3b6bf" stroke-width="2"/>';
  if(condition==='snowy')return cloud+snow;
  if(condition==='snowy-rainy')return cloud+snow+rain;
  if(condition==='hail')return cloud+'<g fill="#87a7bd"><circle cx="9" cy="26" r="2"/><circle cx="19" cy="29" r="2"/><circle cx="27" cy="25" r="2"/></g>';
  if(condition==='lightning'||condition==='lightning-rainy')return cloud+'<path d="m17 17-6 10h6l-3 8 12-13h-7l4-5" fill="#edba4e"/>'+(condition==='lightning-rainy'?rain:'');
  if(condition==='rainy'||condition==='pouring')return cloud+rain;
  if(condition==='cloudy')return cloud;
  return '<circle cx="16" cy="15" r="11" fill="none" stroke="#a3b6bf" stroke-width="2"/><path d="M12 11q0-5 5-3t-1 7v3m0 4v1" fill="none" stroke="#a3b6bf" stroke-width="2" stroke-linecap="round"/>';
}
class ThermalPilotPanel extends HTMLElement {
  constructor(){super();this.attachShadow({mode:'open'});this.tab='overview';this.historyHours=48;this.roomDisclosureState=new Map();}
  updateSourceReadings(){
    this.shadowRoot?.querySelectorAll('[data-source-reading]').forEach(hint=>{
      const key=hint.dataset.sourceReading;if(!sourceReadingKeys.includes(key))return;
      const entity=this.shadowRoot.querySelector(`[data-field="source.${key}"]`)?.value??this.settings?.[key];
      hint.textContent=`${this.t('Current state:')} ${this.t(sourceReading(key,entity,this._hass?.states?.[entity]))}`;
    });
  }
  updateFireplaceReading(){
    const hint=this.shadowRoot?.querySelector('[data-current-fireplace]');if(!hint)return;
    const selected=this.shadowRoot.querySelector('[data-field="source.fireplace_entity"]')?.value??this.settings?.fireplace_entity;
    hint.textContent=`${this.t('Current state:')} ${this.t(fireplaceCurrentState(this._hass?.states?.[selected]))}`;
  }
  mountAccordionScrolling(){
    this.shadowRoot.querySelectorAll('details').forEach(details=>{
      const summary=details.querySelector(':scope > summary');if(!summary)return;
      summary.addEventListener('click',event=>{
        if(event.defaultPrevented)return;
        // Wait for the native details action and layout; restored open states do not scroll.
        const afterLayout=()=>{
          if(!details.open||!details.isConnected)return;
          const height=globalThis.innerHeight||globalThis.document?.documentElement?.clientHeight;
          if(!height)return;
          const bounds=details.getBoundingClientRect();
          if(bounds.bottom<=height-16)return;
          const reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
          details.scrollIntoView({behavior:reduced?'instant':'smooth',block:bounds.height>height-32?'start':'nearest',inline:'nearest'});
        };
        if(typeof requestAnimationFrame==='function')requestAnimationFrame(afterLayout);
        else setTimeout(afterLayout,0);
      });
    });
  }
  mountLanguagePicker(){
    const picker=this.shadowRoot.querySelector('.language-picker');if(!picker)return;
    const trigger=picker.querySelector('.language-trigger'),list=picker.querySelector('.language-options'),field=picker.querySelector('[data-field]');
    const options=[...list.querySelectorAll('[data-language]')];
    const close=()=>{list.hidden=true;trigger.setAttribute('aria-expanded','false');};
    const open=()=>{list.hidden=false;trigger.setAttribute('aria-expanded','true');(options.find(option=>option.dataset.language===field.value)||options[0])?.focus();};
    trigger.addEventListener('click',event=>{event.preventDefault();list.hidden?open():close();});
    trigger.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();open();}});
    options.forEach((option,index)=>{
      option.addEventListener('click',event=>{event.preventDefault();field.value=option.dataset.language;close();field.dispatchEvent(new Event('change',{bubbles:true}));this.shadowRoot.querySelector('.language-trigger')?.focus();});
      option.addEventListener('keydown',event=>{
        if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;options[next].focus();}
        else if(event.key==='Escape'){event.preventDefault();close();trigger.focus();}
        else if(event.key==='Tab')close();
      });
    });
    picker.addEventListener('focusout',event=>{if(!picker.contains(event.relatedTarget))close();});
    this.shadowRoot.onpointerdown=event=>{if(!event.target.closest?.('.language-picker'))close();};
  }
  t(value){return translateText(value,this.settings?.language||'en');}
  tDetails(value){const lines=String(value).split('\n');const first=lines[0].indexOf(' · ');if(first>=0){const name=lines[0].slice(0,first+3);lines[0]=name+this.t(lines[0].slice(first+3));return [lines[0],...lines.slice(1).map(line=>this.t(line))].join('\n');}return this.t(value);}
  translateRoot(root){
    if(!['fi',...Object.keys(languageText)].includes(this.settings?.language)||typeof document==='undefined'||!document.createTreeWalker)return;
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
  set hass(value){this._hass=value;this.updateFireplaceReading();this.updateSourceReadings();for(const card of this.historyCards||[])card.hass=this.historyCardHass();if(this.isConnected && !this.loaded && !this.loading)this.load();}
  set panel(value){this._panel=value;if(this.isConnected && this._hass && !this.loaded)this.load();}
  connectedCallback(){if(this._hass)this.load();this.timer=setInterval(()=>{if(!['settings','rooms'].includes(this.tab))this.load();},60000);}
  disconnectedCallback(){this.priceResizeObserver?.disconnect();clearInterval(this.timer);clearTimeout(this.saveMessageTimer);}
  get entry(){return this._panel?.config?.entry_id;}
  async call(type,extra={}){return this._hass.callWS({type:`thermal_pilot/${type}`,entry_id:this.entry,...extra});}
  async load(){
    if(!this.entry || this.loading)return;
    this.loading=true;
    try{
      const response=await this.call('get');
      this.info=response;this.settings=structuredClone(response.settings);this.zoneRoomDrafts={};
      await tpI18n.load(this.settings.language||'en');
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
    else if(key==='fireplace_active_state'){
      const sensor=this._hass?.states?.[obj.fireplace_entity];
      const options=fireplaceStateOptions(sensor,value);
      input=`<select data-field="${name}">${options.map(option=>`<option value="${escapeHTML(option.value)}" ${option.value===value?'selected':''}>${escapeHTML(option.label)}</option>`).join('')}</select><small class="fireplace-current-state" data-current-fireplace role="status">${escapeHTML(this.t('Current state:'))} ${escapeHTML(this.t(fireplaceCurrentState(sensor)))}</small>`;
    }
    else if(type==='rooms'){
      this.zoneRoomDrafts??={};
      const selected=this.zoneRoomDrafts[obj.id]??this.settings.rooms.filter(room=>room.heating_zone_id===obj.id).map(room=>room.id);
      const rooms=this.settings.rooms.filter(room=>!room.is_garage&&room.name&&room.temperature_entity).slice().sort(compareRoomNames);
      input=`<span class="sensor-list" data-entity-list="${name}">${selected.map((id,index)=>`<span class="sensor-list-row"><select data-entity-item data-zone-member aria-label="${escapeHTML(this.t('Room'))} ${index+1}" aria-describedby="help-${prefix}-${key}"><option value="">— Select / not used —</option>${id&&!rooms.some(room=>room.id===id)?`<option selected value="${escapeHTML(id)}">Room unavailable</option>`:''}${rooms.map(room=>`<option data-user-text value="${escapeHTML(room.id)}" ${room.id===id?'selected':''} ${(selected.some((other,i)=>i!==index&&other===room.id)||(room.heating_zone_id&&room.heating_zone_id!==obj.id))?'disabled':''}>${escapeHTML(room.name)}</option>`).join('')}</select><button type="button" data-remove-sensor="${index}" aria-label="Remove room from zone">×</button></span>`).join('')}<button type="button" class="add-sensor" data-add-sensor>Add room</button></span>`;
    }
    else if(type.startsWith('entities:')){
      const domains=type.slice(9).split(',');
      const entities=Object.values(this._hass.states).filter(sensor=>domains.includes(sensor.entity_id.split('.')[0])).sort((a,b)=>entityLabel(a).localeCompare(entityLabel(b)));
      const selected=Array.isArray(value)?value:[];
      input=`<span class="sensor-list" data-entity-list="${name}">${selected.map((entity,index)=>`<span class="sensor-list-row"><select data-entity-item aria-label="${escapeHTML(label)} ${index+1}" aria-describedby="help-${prefix}-${key}"><option value="">— Select / not used —</option>${entity&&!entities.some(sensor=>sensor.entity_id===entity)?`<option data-user-text selected value="${escapeHTML(entity)}">${escapeHTML(entity)} (unavailable)</option>`:''}${entities.map(sensor=>`<option data-user-text value="${escapeHTML(sensor.entity_id)}" ${entity===sensor.entity_id?'selected':''} ${selected.some((other,i)=>i!==index&&other===sensor.entity_id)?'disabled':''}>${escapeHTML(entityLabel(sensor))}</option>`).join('')}</select><button type="button" data-remove-sensor="${index}" aria-label="Remove sensor">×</button></span>`).join('')}<button type="button" class="add-sensor" data-add-sensor>Add sensor</button></span>`;
    }
    else if(key==='language'){
      const language=Object.hasOwn(languageNames,value)?value:'en';
      input=`<span class="language-picker"><input type="hidden" data-field="${name}" value="${language}"><button type="button" class="language-trigger" aria-haspopup="listbox" aria-expanded="false" aria-controls="language-options"><span>${languageFlag(language)}<span data-user-text>${languageNames[language]}</span></span><span aria-hidden="true">▾</span></button><span class="language-options" id="language-options" role="listbox" aria-label="Language" hidden>${Object.keys(languageNames).sort((a,b)=>languageNames[a].localeCompare(languageNames[b],'en',{sensitivity:'base'})).map(code=>`<button type="button" role="option" aria-selected="${code===language}" data-language="${code}" tabindex="-1">${languageFlag(code)}<span data-user-text>${languageNames[code]}</span></button>`).join('')}</span></span>`;
    }
    else if(pumpOptionKeys[key]){
      const devices=prefix==='source'?[...this.settings.rooms.filter(r=>!r.is_garage&&(r.heat_control==='air_to_air'||(r.heat_control==='house'&&this.settings.house_heat_source==='air_to_air'))).map(r=>r.thermostat),...(this.settings.heating_zones||[]).filter(z=>z.source_type!=='fireplace').map(z=>z.thermostat)]:[obj.thermostat];
      const lists=devices.filter(Boolean).map(id=>this._hass.states[id]?.attributes?.[pumpOptionKeys[key]]||[]);
      const options=lists.length?[...new Set(lists[0])].filter(v=>lists.every(list=>list.includes(v))):[];
      const emptyReason=!devices.some(Boolean)?'Select a heat pump in a room or heating zone first.':lists.some(list=>!list.length)?'The selected heat pump does not report options for this setting.':'The selected heat pumps have no common options for this setting.';
      input=`<select data-field="${name}" ${!options.length&&!value?'disabled':''}><option value="">Leave unchanged</option>${value&&!options.includes(value)?`<option selected value="${escapeHTML(value)}">${escapeHTML(value)} (unavailable)</option>`:''}${options.map(v=>`<option data-user-text value="${escapeHTML(v)}" ${v===value?'selected':''}>${escapeHTML(v)}</option>`).join('')}</select>${!options.length?`<small>${escapeHTML(this.t(emptyReason))}</small>`:''}`;
    }
    else if(key==='heating_zone_id'||key==='main_room_id'){
      const options=key==='heating_zone_id'?(this.settings.heating_zones||[]):this.settings.rooms.filter(r=>r.heating_zone_id===obj.id);
      input=`<select data-field="${name}"><option value="">— Select / not used —</option>${options.map(v=>`<option data-user-text value="${escapeHTML(v.id)}" ${v.id===value?'selected':''}>${escapeHTML(v.name||'New room')}</option>`).join('')}</select>`;
    }
    else if(type.startsWith('select:'))input=`<select data-field="${name}">${type.slice(7).split(',').map(v=>`<option ${v===value?'selected':''} value="${escapeHTML(v)}">${escapeHTML(key==='language'?({'en':'🇬🇧 English','fi':'🇫🇮 Finnish'}[v]||v):['heat_control','garage_strategy','temperature_policy','air_zone_temperature','source_type','climate_mode','heating_strategy'].includes(key)?controlOptionLabels[v]||v:key==='pricing_mode'?schedulingLabels[v]||v:(key.startsWith('house_')||key==='garage_construction')?houseOptionLabels[v]||v:key==='solar_direction'&&v==='disabled'?'Solar heating off':['solar_direction','solar_exposure'].includes(key)?v.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase()):v)}</option>`).join('')}</select>`;
    else if(type==='number')input=`<input type="number" step="${step}" min="${min}" max="${max}" data-field="${name}" value="${escapeHTML(value)}">`;
    else if(type==='text')input=`<input data-field="${name}" value="${escapeHTML(value)}">`;
    else{
      const domains=type.split(','),rule=field[3]||{};const entities=Object.values(this._hass.states).filter(s=>domains.includes(s.entity_id.split('.')[0])&&entityMatches(s,rule,obj)).sort((a,b)=>entityLabel(a).localeCompare(entityLabel(b)));
      const retained=value&&!entities.some(s=>s.entity_id===value)?`<option selected value="${escapeHTML(value)}">${escapeHTML(entityLabel(this._hass.states[value]))} (${this._hass.states[value]?'does not match filter':'unavailable'})</option>`:'';
      input=`<select data-field="${name}"><option value="">— Select / not used —</option>${retained}${entities.map(s=>`<option data-user-text value="${escapeHTML(s.entity_id)}" ${s.entity_id===value?'selected':''}>${escapeHTML(entityLabel(s))}</option>`).join('')}</select>`;
    }
    if(sourceReadingKeys.includes(key))input+=`<small class="source-current-state" data-source-reading="${key}" role="status">${escapeHTML(this.t('Current state:'))} ${escapeHTML(this.t(sourceReading(key,value,this._hass?.states?.[value])))}</small>`;
    if(key==='fireplace_reduction')input=`<span class="number-unit">${input}<span>%</span></span>`;
    const helpText=settingHelp[prefix.startsWith('zone')&&key==='heating_enabled'?'zone_heating_enabled':key];
    const helpId=`help-${prefix}-${key}`;
    const help=helpText?` <span class="setting-help"><button type="button" class="setting-info" aria-label="About ${escapeHTML(label)}" aria-describedby="${helpId}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle class="info-dot" cx="12" cy="7" r="1"/></svg></button><span id="${helpId}" class="setting-tooltip" role="tooltip">${escapeHTML(helpText)}</span></span>`:'';
    const tag=(type.startsWith('entities:')||type==='rooms')?'div':'label';
    return `<${tag} ${tag==='div'?'class="sensor-list-field"':''} ${key==='fireplace_active_state'?`data-fireplace-state ${obj.fireplace_entity?'':'hidden'}`:['simulation_enabled','apply_season_setpoints'].includes(key)?`data-electric-control ${electricHeating(this.settings)?'':'hidden'}`:key==='solar_exposure'?`data-solar-exposure ${(!obj.solar_direction||obj.solar_direction==='disabled')?'hidden':''}`:''}><span>${escapeHTML(label)}${help}</span>${input}</${tag}>`;
  }
  settingsGroups(groups){
    const fields=new Map(this.info.source_fields.map(field=>[field[0],field]));
    return groups.map(([title,keys])=>{
      const available=keys.map(key=>fields.get(key)).filter(Boolean);
      return available.length?`<div class="settings-group" ${title==='Integration settings'?'data-integration-group':''} ${title==='Electricity price settings'?`data-electric-group ${electricHeating(this.settings)?'':'hidden'}`:title==='Air-to-air heat pump settings'?`data-air-group ${this.settings.rooms.some(r=>!r.is_garage&&r.heat_control==='air_to_air')||(this.settings.heating_zones||[]).some(z=>z.source_type!=='fireplace')||this.settings.house_heat_source==='air_to_air'?'':'hidden'}`:title==='Water heating'?`data-water-group ${waterDistribution(this.settings)?'':'hidden'}`:''}><h3>${escapeHTML(title)}</h3>${title==='Miscellaneous'?'<p>Warn when room temperature readings stay unchanged or unavailable.</p>':''}<div class="grid">${available.map(field=>this.field(field,this.settings,'source')).join('')}</div></div>`:'';
    }).join('');
  }
  roomSettingsFields(r,index){
    const visible=this.info.room_fields.filter(f=>f[0].startsWith('garage_')?r.is_garage:f[0]==='baseline'?!r.is_garage:f[0]==='fireplace_reduction'?!r.is_garage:['heat_control','thermostat','activity_entity'].includes(f[0])?(!r.is_garage||f[0]==='thermostat'):f[0]==='heating_zone_id'?false:true);
    const render=fields=>fields.map(field=>this.field(field,r,`room${index}`)).join('');
    const general=visible.filter(field=>!field[0].startsWith('garage_'));
    const garage=visible.filter(field=>field[0].startsWith('garage_'));
    return render(general)+(r.is_garage?`<div class="garage-settings-divider" role="separator" aria-label="${escapeHTML(this.t('Garage'))}"></div><h3 class="garage-settings-heading">Garage heating settings</h3>`+render(garage):'');
  }
  settingsView(page='all'){
    const i=this.info;
    const rooms=this.settings.rooms.map((room,index)=>({room,index})).sort((a,b)=>Number(Boolean(a.room.is_garage))-Number(Boolean(b.room.is_garage))||compareRoomNames(a.room,b.room));
    const html=`<form id="settings" data-settings-page="${page}"><section class="settings-sources"><h2>ThermalPilot settings</h2>${this.settingsGroups(sourceSettingGroups)}</section>
    <section class="settings-house"><h2>House heating settings</h2><p>Choose your heating system and house details. Heat distribution determines which sensor inputs are needed.</p>${this.settingsGroups([['House and heating',['house_construction','house_heat_source','house_distribution','house_heated_floor','house_foundation']],['Water heating',['water_entity','start_offset_minutes','stop_offset_minutes']],['Heating response',['lag_hours','curve_warm_temp','curve_cold_temp']]])}${statusNotice('Electric heating benefits mainly from changing electricity tariffs. Other heat sources use observation only: no schedules, no thermostat control and no required price sensor. Heat-pump efficiency and fuel costs are not modeled.','info')}</section>
    <section class="settings-shared"><h2>Shared room and zone settings</h2><p>Shared settings apply to ordinary rooms and heating zones. Garages use their own room settings.</p>${this.settingsGroups(sharedSettingGroups)}</section>
    <section class="settings-zones"><h2>Heating zones</h2><p>${escapeHTML(this.t("Zones are secondary heating or cooling sources. Each room keeps its primary heating system and thermostat."))}</p>${(this.settings.heating_zones||[]).map((z,index)=>`<article class="room-card"><details data-settings-disclosure="${escapeHTML(z.id)}"><summary><span data-user-text>${escapeHTML(z.name||'New heating zone')}</span></summary><div class="grid room-fields">${(i.zone_fields||[]).filter(f=>!['main_room_id','heating_enabled','climate_mode','heating_strategy','cooling_target'].includes(f[0])&&(!['thermostat','temperature_policy'].includes(f[0])||z.source_type!=='fireplace')).map(f=>this.field(f,z,`zone${index}`)).join('')}${this.field(['zone_rooms','Rooms','rooms'],z,`zone${index}`)}${z.source_type!=='fireplace'?(i.zone_fields||[]).filter(f=>f[0]==='main_room_id').map(f=>this.field(f,z,`zone${index}`)).join(''):''}${z.source_type!=='fireplace'?(i.zone_fields||[]).filter(f=>['heating_enabled','climate_mode','heating_strategy','cooling_target'].includes(f[0])&&(f[0]!=='heating_strategy'||z.climate_mode!=='cool')&&(f[0]!=='cooling_target'||['cool','both'].includes(z.climate_mode))).map(f=>this.field(f,z,`zone${index}`)).join(''):''}${this.settings.rooms.some(room=>room.heating_zone_id===z.id)?'':'<p class="zone-empty-note">No rooms linked. This zone does not control heating.</p>'}</div></details><div class="room-actions"><button type="button" class="icon-button delete-room" data-remove-zone="${index}" title="Remove heating zone" aria-label="Remove heating zone"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg></button></div></article>`).join('')}<button type="button" id="add-zone">Add heating zone</button></section>
    <section class="settings-rooms"><h2>Rooms</h2><p>Room response is learned from observed heating and cooling, starting with internal estimates.</p>
    <div class="room-cards">${rooms.map(({room:r,index})=>`<article class="room-card${r.is_garage?' garage-room-card':''}"><div class="room-actions"><button type="button" class="icon-button" data-reset="${escapeHTML(r.id)}" title="Reset learning for this room" aria-label="Reset learning for this room"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/></svg></button><button type="button" class="icon-button delete-room" data-remove="${index}" title="Remove room" aria-label="Remove room"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg></button></div><details data-settings-disclosure="${escapeHTML(r.id)}"><summary><span data-user-text>${escapeHTML(r.name||'New room')}</span> <span class="room-target">${escapeHTML(r.is_garage?`${r.garage_minimum}–${r.garage_maximum}`:r.baseline??'—')} °C</span></summary><div class="grid room-fields">${this.roomSettingsFields(r,index)}</div></details></article>`).join('')}</div>
    <button type="button" id="add">Add room</button></section><div class="sticky"><button class="primary" type="submit">Save settings</button><span id="settings-unsaved" class="unsaved-notice" role="status" ${this.hasUnsavedSettings()?'':'hidden'}>Unsaved changes</span><span>${this.settings.simulation_enabled===false?'Live control · check for conflicting thermostat automations':this.settings.apply_season_setpoints?'Season transitions change real thermostat setpoints':'Simulation only · scheduled targets are not applied'}</span></div></form>`;
    if(page==='settings')return html.replace(/<section class="settings-(?:house|shared|zones|rooms)">[\s\S]*?<\/section>/g,'');
    if(page==='rooms')return html.replace(/<section class="settings-sources">[\s\S]*?<\/section>/g,'');
    return html;
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
    if(percent>=100){
      if(!electricHeating(this.settings))return '';
      const stat=room?.forecast_accuracy?.['3'],fi=this.settings?.language==='fi';
      const value=number=>Number.isFinite(number)?number.toLocaleString(fi?'fi-FI':'en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})+' °C':'—';
      const valid=stat?.count>0&&Number.isFinite(stat.mae);
      const rating=forecastRating(stat);
      const names=['Bad','Poor','Okay','Good','Very good'];
      const assessment=rating.level!=null?this.t(names[rating.level]):this.t('Forecast learning');
      const label=valid?this.helpText('Forecast: {assessment} · {error}',{assessment,error:value(stat.mae)}):this.t('Forecast data pending');
      const detail=valid?this.helpText("Average absolute difference of saved 3-hour forecasts from measurements over the last 7 days: {error}; {count} comparisons. No-change benchmark: {benchmark}. Similar heating: {similar} ({similarCount} comparisons). Actual heating can differ from the plan. This is not a live-control readiness guarantee.",{error:value(stat.mae),count:stat.count,benchmark:value(stat.persistence_mae),similar:value(stat.similar_heating_mae),similarCount:stat.similar_heating_count||0}):this.t("Initial collection is complete. Waiting for saved 3-hour forecasts that can be compared with actual measurements. Learning continues.");
      const explanation=this.t("The number is average forecast deviation from measured temperature, not an integration fault. Ratings are practical guidance. Color requires at least 20 comparisons. Green also requires beating the no-change benchmark.");
      const caveat=rating.reason==='benchmark'?this.t(" Assuming no temperature change performed equally well or better, so the rating is not green."):rating.reason==='missing_benchmark'?this.t(" The benchmark is unavailable, so the rating is not green."):'';
      return `<span class="status-pill ${rating.level!=null?'quality-'+rating.level:valid?'mode':'neutral'} room-forecast-badge" tabindex="0" title="${escapeHTML(this.t(detail)+' '+this.t(explanation)+this.t(caveat))}">${escapeHTML(this.t(label))}${tooltipInfoIcon}</span>`;
    }
    return `<span class="room-learning" tabindex="0" title="Initial observation progress: 12 heating hours and 12 idle hours. This is not a reliability rating." aria-label="Initial data collection ${percent.toFixed(0)} percent">${percent.toFixed(0)}% initial data${tooltipInfoIcon}</span>`;
  }
  learningView(room){
    const model=room.model||{},progress=room.learning_progress||{};
    const heating=progress.heating_hours??model.heated_hours??0,idle=progress.idle_hours??model.idle_hours??0;
    const percent=Math.max(0,Math.min(100,progress.percent??100*(Math.min(12,heating)+Math.min(12,idle))/24));
    const complete=progress.initial_complete??(heating>=12&&idle>=12);
    if(complete)return '';
    const days=progress.estimated_days_to_initial;
    const completion=progress.estimated_initial_completion||(days!=null&&!complete?new Date(Date.now()+days*86400000).toISOString():null);
    const completionDate=completion?new Date(completion):null;
    const dateText=completionDate&&!Number.isNaN(completionDate.getTime())?dateLabel(completionDate):null;
    const estimate=complete?'Initial observation thresholds reached.':days!=null?`About ${days<1?'less than 1':Math.ceil(days)} more ${days<=1?'day':'days'} to the initial thresholds at recent observation rates.`:(progress.rate_history_hours??0)<24?'Time estimate available after at least 24 hours of rate tracking.':'Waiting for enough heating and idle observations to estimate the remaining time.';
    return `<div class="learning-card"><div class="learning-heading"><strong>Initial data collection</strong><span>${percent.toFixed(0)}%</span></div><progress max="100" value="${percent}" aria-label="Initial learning observation progress">${percent.toFixed(0)}%</progress><div class="learning-counts"><span>Heating <strong>${Number(heating).toFixed(1)} / 12 h</strong></span><span>Idle <strong>${Number(idle).toFixed(1)} / 12 h</strong></span></div><p>${escapeHTML(estimate)}</p>${dateText?`<p class="learning-date">Estimated initial-data completion: <strong>${escapeHTML(dateText)}</strong></p>`:''}<small>${escapeHTML(room.learning_note||'')} · ${model.samples||0} accepted observations. This measures initial data collection, not model trustworthiness. Continue validating forecasts and heating suggestions before enabling live control. Learning continues after initial data collection.</small></div>`;
  }
  weatherTimeline({rows,start,end,left,width,now,detailAttributes}){
    if(!rows.length)return {height:0,svg:''};
    const x=time=>left+(time-start)/(end-start)*width;
    const minimumSpacing=56,compact=left<100,rowOffset=compact?20:0;
    let lastX=-Infinity,items='';
    const labels={'clear-night':'Clear night',cloudy:'Cloudy',exceptional:'Exceptional weather',fog:'Fog',hail:'Hail',lightning:'Lightning','lightning-rainy':'Lightning and rain',partlycloudy:'Partly cloudy',pouring:'Heavy rain',rainy:'Rainy',snowy:'Snowy','snowy-rainy':'Snow and rain',sunny:'Sunny',windy:'Windy','windy-variant':'Windy and cloudy'};
    for(const row of rows){
      const position=x(row.time);
      if(!this.weatherHourly&&position-lastX<minimumSpacing)continue;
      lastX=position;
      const label=this.t(labels[row.condition]||'Weather condition unavailable');
      const temperature=row.temperature.toLocaleString(this.settings?.language==='fi'?'fi-FI':this.settings?.language||'en',{minimumFractionDigits:1,maximumFractionDigits:1});
      const time=new Date(row.time).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',hour12:false});
      const detail=`${timeLabel(row.time)} · ${label} · ${temperature} °C`;
      items+=`<g data-weather-hour="${row.time}" ${detailAttributes(detail)}><rect x="${position-23}" y="${4+rowOffset}" width="46" height="76" rx="8" fill="transparent"/><text x="${position}" y="${20+rowOffset}" text-anchor="middle" fill="#526b75" style="font-size:11px">${time}</text><g transform="translate(${position-16} ${29+rowOffset}) scale(.9)">${weatherIcon(row.condition)}</g><text x="${position}" y="${75+rowOffset}" text-anchor="middle" fill="#253f49" style="font-size:12px">${temperature}°</text></g>`;
    }
    const labelX=compact?8:20;
    const label=this.t('Weather forecast');
    const caption=compact?'°C':this.t('Hourly')+' · °C';
    return {height:102+rowOffset,svg:`<g data-weather-timeline="true"><text x="${labelX}" y="${compact?12:22}" fill="#253f49" style="font-size:${compact?11:13}px;font-weight:600">${escapeHTML(label)}</text><text x="${labelX}" y="${compact?26:43}" fill="#526b75" style="font-size:11px">${escapeHTML(caption)}</text>${items}<line x1="${left}" x2="${left+width}" y1="${87+rowOffset}" y2="${87+rowOffset}" stroke="#829aa330"/>${now>start&&now<end?`<line x1="${x(now)}" x2="${x(now)}" y1="4" y2="${87+rowOffset}" stroke="#526b75" stroke-dasharray="4 4"/>`:''}</g>`};
  }
  chartVisibility(){return {weather:true,prices:true};}
  priceChart(history=false,dashboard=false){
  const visibility=this.chartVisibility();
  const isGarage=room=>room.is_garage||this.info.data?.rooms?.[room.id]?.is_garage;
  const ordinaryRooms=[...(this.settings?.rooms||[])].filter(room=>!isGarage(room)).sort(compareRoomNames);
  const garageRooms=[...(this.settings?.rooms||[])].filter(isGarage).sort(compareRoomNames);
  const rooms=[...ordinaryRooms,...garageRooms];
  const zones=[...(this.settings?.heating_zones||[])].sort(compareRoomNames);
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
  const heading=dashboard?'':`<details class="observation-accordion" id="price-accordion" ${open?'open':''}><summary><h2 style="margin:0">Electricity prices and heating</h2></summary><div style="padding-top:16px">`;
  if(!history&&visibility.prices&&!values.length&&!zones.length&&!garageRooms.length&&!(this.info.data?.weather_forecast||[]).length)return `<section class="price-card">${heading}<p>${history?'No past electricity prices are available yet. History uses recorded prices and known past intervals from the published price list.':'No usable electricity price list is available.'}</p>${dashboard?'':'</div></details>'}</section>`;
  const start=history?historyStart:Math.floor((published[0]?.time??values[0]?.time??(now-86400000))/900000)*900000;
  const end=history?historyEnd:Math.ceil((published.at(-1)?.end??Math.max(values.at(-1)?.end??(now+86400000),now))/900000)*900000;
  const span=end-start;
  const weatherRows=history||!visibility.weather?[]:[...new Map((this.info.data?.weather_forecast||[]).filter(row=>row.temperature!==null&&row.temperature!==undefined&&Number.isFinite(Number(row.temperature))).map(row=>{const time=new Date(row.datetime).getTime();return [time,{...row,time,temperature:Number(row.temperature)}];})).values()].filter(row=>Number.isFinite(row.time)&&row.time>=start&&row.time<end&&row.time+3600000>now).sort((a,b)=>a.time-b.time);
  let viewWidth=Math.max(240,this.priceChartWidth||((this.clientWidth||0)>0?this.clientWidth-104:900));
  if(weatherRows.length&&this.weatherHourly)viewWidth=Math.max(viewWidth,Math.ceil(span/3600000)*58+420);
  const compact=viewWidth<600;
  let nameContext;
  try{nameContext=typeof document!=='undefined'?document.createElement('canvas').getContext?.('2d'):null;if(nameContext)nameContext.font='600 13px system-ui';}catch(error){nameContext=null;}
  const longestName=Math.max(0,...[...rooms,...zones].map(item=>nameContext?nameContext.measureText(String(item.name||'')).width:Array.from(String(item.name||'')).length*8));
  const roomNameWidth=compact?viewWidth-40:Math.max(history?190:180,Math.min(viewWidth*.4,Math.ceil(longestName)+12));
  const left=compact?(history?88:48):roomNameWidth+(history?120:100),width=viewWidth-left-20,top=15,height=120,max=Math.max(25,Math.ceil(Math.max(0,...values.map(v=>v.price))/5)*5),min=Math.min(0,Math.floor(Math.min(0,...values.map(v=>v.price))/5)*5);
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
  const roomGap=10,roomTop=visibility.prices?210:40;
  const isAirRoom=room=>Boolean(isGarage(room)||room.heat_control==='air_to_air'||this.info.data?.rooms?.[room.id]?.air_control||(room.heat_control!=='zone_member'&&this.settings.house_heat_source==='air_to_air'));
  const roomHeights=rooms.map(room=>isAirRoom(room)?(compact?60:36):(compact?(history?80:60):history?54:36));
  const roomsHeight=roomHeights.reduce((sum,height)=>sum+height,0);
  const ordinaryHeight=roomHeights.slice(0,ordinaryRooms.length).reduce((sum,height)=>sum+height,0);
  const zoneStart=roomTop+ordinaryHeight+30;
  const zonesEnd=zoneStart+(zones.length?14+zones.length*((compact?50:26)+roomGap):0);
  const garageStart=zones.length?zonesEnd+48:roomTop+ordinaryHeight+(ordinaryRooms.length?48:0);
  const garageGap=garageStart-roomTop-ordinaryHeight;
  const garageHeading=garageRooms.length?`<text x="20" y="${garageStart-20}" fill="#6d5848" style="font-size:18px;font-weight:600">${escapeHTML(this.t('Garages'))}</text>`:'';
  let chartHeight=roomTop+roomsHeight+garageGap+26;
  const lanes=rooms.map((room,roomIndex)=>{
   const rowHeight=roomHeights[roomIndex];
   const rows=((history?this.history:this.statusHistory)||[]).filter(r=>r.room_id===room.id).sort((a,b)=>a.time-b.time),y=roomTop+roomHeights.slice(0,roomIndex).reduce((sum,height)=>sum+height,0)+(isGarage(room)?garageGap:0);
   const plan=this.info.data?.rooms?.[room.id]?.plan;
   const commands=[...(plan?.commands||[])].sort((a,b)=>new Date(a.time)-new Date(b.time));
   const recorded=rows.map((r,i)=>({start:r.time*1000,end:Math.min((rows[i+1]?.time??(r.time+300))*1000,r.time*1000+1800000,now),suggested_heat:r.suggested_heat,activity:r.activity,recorded:true,next:rows[i+1],previous:rows[i-1]}));
   const planned=commands.map((c,i)=>({start:Math.max(now,new Date(c.time).getTime()),originalStart:new Date(c.time).getTime(),end:commands[i+1]?new Date(commands[i+1].time).getTime():end,suggested_heat:c.action==='raise',activity:null}));
   const pastRelays=recorded.map(v=>({...v,suggested_heat:v.activity,next:v.next?{...v.next,suggested_heat:v.next.activity}:undefined,previous:v.previous?{...v.previous,suggested_heat:v.previous.activity}:undefined}));
   const intervals=history?[...recorded,...planned]:[...pastRelays,...planned];
   const air=isAirRoom(room);
   const laneTop=compact?24:0;
   if(air){
    const periods=[];
    rows.forEach((row,index)=>{
     const mode=Object.hasOwn(row,'pump_mode')?row.pump_mode:row.activity===1?'heat':null;
     if(!['heat','cool'].includes(mode)||row.time*1000>=now)return;
     const next=rows[index+1],until=next&&next.time-row.time<=600?next.time:row.time+300;
     const period={start:row.time*1000,end:Math.min(until*1000,now),mode,basis:row.pump_basis||'activity',entity:row.pump_entity};
     const previous=periods.at(-1);
     if(previous&&previous.end===period.start&&previous.mode===mode&&previous.basis===period.basis&&previous.entity===period.entity)previous.end=period.end;
     else periods.push(period);
    });
    const tariff=isGarage(room)?room.garage_strategy==='tariff':!room.heating_zone_id||(this.settings.heating_zones||[]).find(zone=>zone.id===room.heating_zone_id)?.heating_strategy==='tariff';
    if(!history&&tariff)periods.push(...planned.filter(period=>period.suggested_heat).map(period=>({...period,mode:'heat',basis:'plan'})));
    const activity=periods.map(period=>{
     const a=Math.max(start,period.start),b=Math.min(end,period.end);if(b<=a)return '';
     const kind=period.basis==='plan'?'Suggested heating':period.basis==='operating_mode'?(period.mode==='cool'?'Observed cool mode':'Observed heat mode'):period.mode==='cool'?'Recorded cooling':'Recorded heating';
     const detail=`${room.name} · ${this.t(kind)}\n${this.t('Start:')} ${timeLabel(period.start)}\n${this.t('End:')} ${timeLabel(period.end)}\n${this.t('Duration')}: ${durationLabel(period.end-period.start)}`;
     return `<rect ${detailAttributes(detail)} data-pump-period="${period.basis==='plan'?'plan':period.mode}" x="${x(a)}" y="${y+laneTop}" width="${(b-a)/span*width}" height="13" rx="2" fill="${period.basis==='plan'?'#087c85':period.mode==='cool'?'#438bd4':'#e49025'}"/>`;
    }).join('');
    return `<g data-pump-timeline="${escapeHTML(room.id)}"><rect x="8" y="${y-5}" width="${viewWidth-20}" height="${rowHeight-roomGap}" rx="6" fill="${isGarage(room)?((roomIndex-ordinaryRooms.length)%2?'#d7c9ba':'#e2d7cb'):(roomIndex%2?'#e6eef7':'#e5f0ee')}"/><foreignObject x="20" y="${compact?y-2:y-5+(rowHeight-roomGap-22)/2}" width="${roomNameWidth}" height="22"><div xmlns="http://www.w3.org/1999/xhtml" data-user-text title="${escapeHTML(room.name)}" style="font:600 13px system-ui;color:#6d5848;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:22px">${escapeHTML(room.name)}</div></foreignObject>${compact?'':`<text x="${left-12}" y="${y+11}" text-anchor="end" fill="#526b75" font-size="10">${escapeHTML(this.t('Activity'))}</text>`}<rect x="${left}" y="${y+laneTop}" width="${width}" height="13" rx="3" fill="#dbe5ea"/>${activity}</g>`;
   }
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
   return `<rect x="8" y="${y-5}" width="${viewWidth-20}" height="${rowHeight-roomGap}" rx="6" fill="${isGarage(room)?((roomIndex-ordinaryRooms.length)%2?'#d7c9ba':'#e2d7cb'):(roomIndex%2?'#e6eef7':'#e5f0ee')}"/><foreignObject x="20" y="${y+(compact?-1:history?7:-1)}" width="${roomNameWidth}" height="22"><div xmlns="http://www.w3.org/1999/xhtml" data-user-text title="${escapeHTML(room.name)}" style="font:600 13px system-ui;color:#253f49;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:22px">${escapeHTML(room.name)}</div></foreignObject>${history?`<text x="${left-12}" y="${y+laneTop+12}" text-anchor="end" fill="#526b75" font-size="10">Suggested</text><text x="${left-12}" y="${y+laneTop+30}" text-anchor="end" fill="#526b75" font-size="10">Relay</text>`:''}${lane('suggested_heat',0,'#087c85')}${history?lane('activity',18,'#e49025'):''}`;
  });
  let zoneY=zoneStart;
  const zoneHeading=zones.length?`<text x="20" y="${zoneY-9}" fill="#76532b" style="font-size:18px;font-weight:600">${escapeHTML(this.t('Heating zones'))}</text>`:'';
  if(zones.length)zoneY+=14;
  const zoneLanes=zones.map(zone=>{
   const y=zoneY,tariff=zone.source_type!=='fireplace'&&(zone.heating_strategy||'tariff')==='tariff'&&zone.climate_mode!=='cool';
   const showPlan=!history&&tariff;
   const laneTop=compact?26:0,zoneHeight=compact?50:26;
   zoneY+=zoneHeight+roomGap;
   const rows=((history?this.history:this.statusHistory)||[]).filter(row=>row.zone_id===zone.id).sort((a,b)=>a.time-b.time);
   const observed=mode=>{
    const periods=[];
    rows.forEach((row,index)=>{
     if(row.zone_mode!==mode||row.time*1000>=now)return;
     const next=rows[index+1],until=next&&next.time-row.time<=600?next.time:row.time+300;
     const period={mode,start:row.time*1000,end:Math.min(until*1000,now),basis:row.zone_basis,entity:row.zone_entity};
     const previous=periods.at(-1);
     if(previous&&previous.end===period.start&&previous.basis===period.basis&&previous.entity===period.entity)previous.end=period.end;
     else periods.push(period);
    });return periods;
   };
   const planned=[];
   if(showPlan){
    const plan=this.info.data?.zones?.[zone.id]?.plan;
    const commands=[...(plan?.commands||[])].sort((a,b)=>new Date(a.time)-new Date(b.time));
    commands.forEach((command,index)=>{
     if(command.action!=='raise')return;
     planned.push({start:Math.max(now,new Date(command.time).getTime()),end:Math.min(end,commands[index+1]?new Date(commands[index+1].time).getTime():new Date(plan?.slots?.at(-1)?.end||end).getTime()),basis:'plan'});
    });
   }
   const track=(label,offset,color,periods)=>`<text x="${left-12}" y="${y+laneTop+offset+11}" text-anchor="end" fill="#76532b" font-size="10">${compact&&['Recorded','Activity'].includes(label)?'':escapeHTML(this.t(label))}</text><rect x="${left}" y="${y+laneTop+offset}" width="${width}" height="13" rx="3" fill="#e8dfd3"/>`+periods.map(period=>{
    const a=Math.max(start,period.start),b=Math.min(end,period.end);
    if(b<=a)return '';
    const kind=period.basis==='plan'?'Suggested heating':period.basis==='operating_mode'?(period.mode==='cool'?'Observed cool mode':'Observed heat mode'):period.mode==='cool'?'Recorded cooling':'Recorded heating';
    const detail=`${zone.name} · ${this.t(kind)}\n${this.t('Start:')} ${timeLabel(period.start)}\n${this.t('End:')} ${timeLabel(period.end)}\n${this.t('Duration')}: ${durationLabel(period.end-period.start)}`;
    return `<rect ${detailAttributes(detail)} data-zone-period="${period.basis==='plan'?'plan':period.mode==='cool'?'cool':'heat'}" x="${x(a)}" y="${y+laneTop+offset}" width="${(b-a)/span*width}" height="13" rx="2" fill="${period.basis==='plan'?'#087c85':period.mode==='cool'?'#438bd4':color}"/>`;
   }).join('');
   return `<g data-zone-timeline="${escapeHTML(zone.id)}"><rect x="8" y="${y-5}" width="${viewWidth-20}" height="${zoneHeight}" rx="6" fill="#f7ead8"/><foreignObject x="20" y="${compact?y-2:y-5+(zoneHeight-22)/2}" width="${roomNameWidth}" height="22"><div xmlns="http://www.w3.org/1999/xhtml" data-user-text title="${escapeHTML(zone.name)}" style="font:600 13px system-ui;color:#76532b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:22px">${escapeHTML(zone.name)}</div></foreignObject>${track('Activity',0,'#e49025',[...observed('heat'),...observed('cool'),...planned].sort((a,b)=>a.start-b.start))}</g>`;
  }).join('');
  const weather=this.weatherTimeline({rows:weatherRows,start,end,left,width,now,detailAttributes});
  const weatherControls=weather.height?`<label class="weather-density">${escapeHTML(this.t('Weather detail'))}<select data-weather-density><option value="fit" ${!this.weatherHourly?'selected':''}>${escapeHTML(this.t('Fit width'))}</option><option value="hourly" ${this.weatherHourly?'selected':''}>${escapeHTML(this.t('Every hour (scroll)'))}</option></select></label>`:'';
  chartHeight=garageRooms.length?garageStart+roomHeights.slice(ordinaryRooms.length).reduce((sum,height)=>sum+height,0)+26:zones.length?zoneY+18:roomTop+ordinaryHeight+26;
  return `<section class="price-card" style="background:#edf4fa;margin-bottom:24px">${heading}${dashboard?'':`<p style="margin:0;color:#526b75">${history?`Selected period: ${this.historyHours} hours · recorded activity, plus today and tomorrow when prices are published`:'Today and tomorrow · past thermostat activity and future heating suggestions'}</p>`}<div style="display:flex;flex-wrap:wrap;gap:18px;margin:16px 0;font-size:13px">${visibility.prices?`<span><b style="display:inline-block;width:24px;height:10px;border-radius:3px;background:linear-gradient(to right,#40ff00,#ffff00,#ff9933,#ff0000,#cc0000)"></b> Total electricity price (c/kWh)</span>`:''}<span><b style="color:#087c85">■</b> Suggested heating window</span><span><b style="color:#e49025">■</b> Actual thermostat relay</span>${zones.length||rooms.some(room=>isGarage(room)||room.heat_control==='air_to_air'||this.info.data?.rooms?.[room.id]?.air_control||this.settings.house_heat_source==='air_to_air')?`<span><b style="color:#e49025">■</b> ${escapeHTML(this.t("Recorded heating"))}</span><span><b style="color:#438bd4">■</b> ${escapeHTML(this.t("Recorded cooling"))}</span>`:''}</div>${history&&!values.length?'<p>No electricity prices are available for this period. Recorded thermostat activity is shown below.</p>':''}${weatherControls}<div class="price-chart-viewport" style="overflow-x:auto;background:#ffffffb3;border-radius:10px;padding:12px"><svg data-range-start="${start}" data-range-end="${end}" viewBox="0 0 ${viewWidth} ${chartHeight+weather.height}" role="img" aria-label="Electricity prices with heating timelines for rooms and zones" style="width:${weather.height&&this.weatherHourly?viewWidth+'px':'100%'};min-width:${weather.height&&this.weatherHourly?viewWidth+'px':'0'};height:${chartHeight+weather.height}px;max-height:none;display:block">${weather.svg}<g transform="translate(0 ${weather.height})">${visibility.prices?`<text x="20" y="30" fill="#526b75" font-size="12">c/kWh</text>${ticks}${bars}${labelRow(157)}`:labelRow(25)}${ordinaryRooms.length?`<text x="20" y="${roomTop-20}" fill="#253f49" style="font-size:18px;font-weight:600">${escapeHTML(this.t('Rooms'))}</text>`:''}${lanes.slice(0,ordinaryRooms.length).join('')}${zoneHeading}${zoneLanes}${garageHeading}${lanes.slice(ordinaryRooms.length).join('')}${now>start&&now<end?`<line x1="${x(now)}" x2="${x(now)}" y1="${top}" y2="${chartHeight-26}" stroke="#526b75" stroke-dasharray="4 4" stroke-width="1"/><text x="${x(now)+5}" y="12" fill="#526b75" font-size="11">Now</text>`:''}${labelRow(chartHeight-8)}</g></svg><div class="chart-tooltip" role="tooltip" hidden></div></div>${dashboard?'':`<details class="retention-help chart-help"><summary>${escapeHTML(this.t('About this chart'))}</summary><small data-chart-notes style="display:block;margin-top:10px;color:#526b75">${["All room timelines share the price chart’s time axis.",...(zones.length?["Zone rows show recorded heating and cooling only; off and standby periods stay empty. Plan adds suggested heating only for tariff-optimized zones."]:[]),"Teal shows the suggested thermostat boost window; amber shows observed heating demand.",...(history?["The selected period controls past history. Today and tomorrow are included when prices are published. Recorded activity is shown before now; future suggestions follow the current plan. Price gaps stay empty."]:[]),"Times align to 15-minute boundaries; wider views show fewer labels. Hover, focus or tap a price bar or heating period for details."].map(note=>escapeHTML(this.t(note))).join(' ')}</small></details>`}${dashboard?'':'</div></details>'}</section>`;
  }
  mountPriceChartSizing(){
    const density=this.shadowRoot.querySelector('[data-weather-density]');
    if(density)density.onchange=event=>{this.weatherHourly=event.target.value==='hourly';this.render();};
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
  helpText(template,values={}){
    const locale=this.settings?.language==='fi'?'fi-FI':'en-GB';
    return this.t(template).replace(/\{(\w+)\}/g,(token,key)=>Object.hasOwn(values,key)?(typeof values[key]==='number'?values[key].toLocaleString(locale,{maximumFractionDigits:2}):String(values[key])):token);
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
      detail:this.helpText('Collected-data coverage, not model reliability. Least-observed room: {heating} heating hours and {idle} idle hours. Collection began {days} days ago. Limited: 3 hours each / 1 day; Developing: 12 hours each / 3 days; Good: 48 hours each / 14 days; High: 120 hours each / 42 days. All criteria must be met. Learning continues at every level.',{heating:heating.toFixed(1).replace('.',this.settings?.language==='fi'?',':'.'),idle:idle.toFixed(1).replace('.',this.settings?.language==='fi'?',':'.'),days:Math.floor(days)})};
  }
  headerStatus(){
    const settings=this.settings||{};
    let label='Simulation',style='header-simulation',description='Simulation is active. ThermalPilot does not control heating.';
    if(!electricHeating(settings)){label='Comfort planning';style='header-observation';description='Observation and learning only; no thermostat control.';}
    else if(!settings.simulation_enabled&&settings.live_control_confirmed){
      const active=settings.heating_enabled!==false;
      label=active?'Live control':'Live control paused';style=active?'header-live':'header-paused';
      description=active?'ThermalPilot controls thermostat targets.':'Seasonal fallback temperatures are used.';
    }else if(settings.apply_season_setpoints){description='Scheduled targets remain simulated; season transitions can change thermostat targets.';}
    else if(settings.simulation_enabled===false){label='Confirmation required';style='header-paused';description='Live thermostat control is not enabled.';}
    return `<div class="header-status"><span class="status-pill ${style}" role="status">${escapeHTML(this.t(label))}</span><span class="header-status-description">${escapeHTML(this.t(description))}</span></div>`;
  }
  compactStatusView(){
    if(!this.info?.data)return '';
    const data=this.info.data,quality=this.collectionQuality(),language=this.settings?.language||'en';
    const temp=value=>value!==null&&value!==undefined&&Number.isFinite(Number(value))?Number(value).toLocaleString(language,{maximumFractionDigits:1}):'—';
    const water=waterDistribution(this.settings)&&this.settings.water_entity;
    const metric=(label,value)=>`<div class="compact-metric"><span>${escapeHTML(this.t(label))}</span><strong>${temp(value)}<small> °C</small></strong></div>`;
    const started=data.history_info?.started_at;
    return `<aside class="compact-status${water?'':' compact-no-water'}" aria-label="${escapeHTML(this.t('ThermalPilot status'))}"><div class="compact-badges"><span class="compact-label">${escapeHTML(this.t('Operation'))}</span>${this.controlBadges('header-status-help')}</div>${metric('Outdoor temperature',data.outdoor)}${water?metric('Heating water temperature',data.water):''}<div class="compact-secondary"><span class="compact-label">${escapeHTML(this.t('Data collection'))}</span><span class="status-pill quality quality-${quality.level}" tabindex="0" title="${escapeHTML(quality.detail)}">${escapeHTML(this.t('Data coverage: '+quality.label))}${tooltipInfoIcon}</span><details class="compact-extra" id="status-details" ${this.statusDetailsOpen?'open':''}><summary>${escapeHTML(this.t('Details'))} <span>· ${escapeHTML(data.updated?new Date(data.updated).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}):'—')}</span></summary><div class="compact-extra-body"><h3>${escapeHTML(this.t('ThermalPilot status'))}</h3><dl><dt>${escapeHTML(this.t('Stored history'))}</dt><dd>${Number(data.history_info?.rows||0).toLocaleString(language)} ${escapeHTML(this.t('samples'))} · ${((data.history_info?.bytes||0)/1048576).toFixed(1)} MiB</dd><dt>${escapeHTML(this.t('Last update'))}</dt><dd>${escapeHTML(data.updated?timeLabel(data.updated):'—')}</dd><dt>${escapeHTML(this.t('Collection started:'))}</dt><dd>${escapeHTML(started!=null?dateLabel(started*1000):this.t('No observations yet'))}</dd></dl><p>${escapeHTML(this.t(data.heating_active===false?'Observation and learning are stopped.':'Observation and learning are enabled.'))}</p></div></details></div></aside>`;
  }
  controlBadges(prefix='status-help'){
    const data=this.info?.data||{},settings=this.settings||{};
    const live=settings.simulation_enabled===false&&settings.live_control_confirmed;
    const mode=!electricHeating(settings)?'Comfort planning':live?(settings.heating_enabled===false?'Live control paused':'Live control'):settings.simulation_enabled===false?'Confirmation required':settings.apply_season_setpoints?'Season setpoint control':'Simulation';
    const operationLabel=`${this.t(data.heating_active===false?'Passive':'Active')}: ${this.t(mode)}`;
    const modeHelp=live?'ThermalPilot applies scheduled thermostat targets while active. Essential data loss returns affected rooms to their seasonal fallback temperature.':settings.simulation_enabled===false?'Live control has not been confirmed. Save and confirm to enable real thermostat control.':settings.apply_season_setpoints?'Active/Passive season setpoints can change real thermostats. Heating schedules remain simulated.':'Simulation is active. ThermalPilot does not control heating.';
    const status=data.source_status;
    const missing=status?Object.entries({prices:'Electricity prices from now',outdoor:'Outdoor temperature',water:'Heating water temperature'}).filter(([key])=>(key!=='water'||status.water_required!==false)&&(key!=='prices'||status.prices_required!==false)&&!status[key]).map(([,name])=>name):[];
    const sourceLabel=!status?'Sources not checked':missing.length?'Sources missing':'Sources ready';
    const sourceHelp=!electricHeating(settings)?'Comfort planning uses room temperature, outdoor temperature and observed heating demand. Electricity prices are not required; no heating schedules or thermostat commands are generated.':!status?'Source checks are available while ThermalPilot is active.':missing.length?`${this.t('Missing or unusable:')} ${missing.map(name=>this.t(name)).join(', ')}.`:`Electricity prices from now and outdoor temperature${status.water_required===false?'':' and heating water temperature'} are available. Weather forecast details are reported separately below.`;
    const season=data.fallback_season?.season;
    const seasonHelp=this.t('Summer is 15.5.–30.9., or a complete day’s minimum forecast temperature at or above {temperature}°C. Summer fallback uses the shared summer setpoint; winter fallback uses each room’s normal target.').replace('{temperature}',String(settings.summer_minimum_temperature??6).replace('.',settings.language==='fi'?',':'.'));
    const badge=(style,label,help,id)=>`<details class="status-help"><summary class="status-pill ${style}" aria-describedby="${prefix}-${id}"><span data-user-text>${escapeHTML(this.t(label))}</span>${tooltipInfoIcon}</summary><span class="status-tooltip" id="${prefix}-${id}" data-user-text>${escapeHTML(this.t(help))}</span></details>`;
    return `<div class="status-badges">${badge(data.heating_active===false?'paused':'active',operationLabel,modeHelp,'mode')}${badge(!status?'neutral':missing.length?'missing':'active',sourceLabel,sourceHelp,'sources')}${season?badge(season==='summer'?'summer':'winter',season==='summer'?'Summer fallback':'Winter fallback',seasonHelp,'season'):''}</div>`;
  }
  sortRetention(key){
    if(!['drop','hours','speed'].includes(key))return;
    const current=this.retentionSort||{key:'drop',direction:1};
    this.retentionSort={key,direction:current.key===key?-current.direction:1};
    this.render();
    this.shadowRoot.querySelector(`[data-retention-sort="${key}"]`)?.focus({preventScroll:true});
  }
  heatRetentionView(){
    const rooms=Object.entries(this.info?.data?.rooms||{}).filter(([,room])=>room.heat_retention);
    if(!rooms.length)return '';
    const isGarage=([id,room])=>Boolean(room.is_garage||this.settings?.rooms?.find(item=>item.id===id)?.is_garage);
    const sort=this.retentionSort||{key:'drop',direction:1};
    const sortValue=room=>{const value=room.heat_retention;if(sort.key==='drop')return value.drop_6h;if(sort.key==='hours')return value.hours_per_degree;const rating=retentionRating(value);return ['very-fast','fast','moderate','slow','very-slow'].indexOf(rating.level);};
    rooms.sort((a,b)=>{const group=Number(isGarage(a))-Number(isGarage(b));if(group)return group;if(!this.retentionSort&&isGarage(a))return compareRoomNames(a[1],b[1]);const av=sortValue(a[1]),bv=sortValue(b[1]);const valid=value=>Number.isFinite(value)&&!(sort.key==='speed'&&value<0);return Number(!valid(av))-Number(!valid(bv))||(valid(av)&&valid(bv)?sort.direction*(av-bv):0)||compareRoomNames(a[1],b[1]);});
    const sortHeader=(key,label)=>`<th class="${key==='drop'||key==='hours'?'retention-numeric':''}" aria-sort="${sort.key===key?(sort.direction===1?'ascending':'descending'):'none'}"><button type="button" class="retention-sort" data-retention-sort="${key}"><span>${escapeHTML(this.t(label))}</span> <span aria-hidden="true">${sort.key===key?(sort.direction===1?'↑':'↓'):'↕'}</span></button></th>`;
    const max=Math.max(...rooms.map(([,r])=>r.heat_retention.drop_6h),.01);
    const reference=rooms.map(([,room])=>room.heat_retention).find(value=>value.reference_hours>0);
    const comparison=reference?`<p class="retention-reference">${escapeHTML(this.t('Construction reference:'))} <strong>${escapeHTML(this.t(houseOptionLabels[reference.reference_type]||reference.reference_type))}</strong> · ${reference.reference_hours.toFixed(1)} ${escapeHTML(this.t('hours per 1°C drop'))}. ${escapeHTML(this.t('House badges compare cooling speed with this approximate reference. Garage badges use the general bands.'))}</p>`:'';
    return `<section class="retention-card"><details class="observation-accordion" id="retention-accordion" ${this.retentionOpen!==false?'open':''}><summary><h2>Room heat retention</h2></summary><div class="observation-content"><p class="retention-summary">${escapeHTML(this.t('Modelled cooling: 20°C indoors · −10°C outdoors · heating off'))}</p><div class="scroll"><table><thead><tr><th>Room</th>${sortHeader('drop','6-hour loss')}${sortHeader('hours','1°C drop')}${sortHeader('speed','Cooling speed')}<th>Model</th></tr></thead><tbody>${rooms.map(([id,r])=>{const v=r.heat_retention,rating=retentionRating(v);return `<tr data-retention-drop="${v.drop_6h}" data-retention-hours="${v.hours_per_degree}" data-retention-speed="${['very-fast','fast','moderate','slow','very-slow'].indexOf(rating.level)}" class="${isGarage([id,r])?'garage-retention-row':''}"><td><span data-user-text>${escapeHTML(r.name)}</span></td><td class="retention-numeric"><span class="retention-bar" aria-hidden="true"><i style="width:${100*v.drop_6h/max}%"></i></span><span class="retention-value">${v.drop_6h.toFixed(2)} °C</span></td><td class="retention-numeric">${v.hours_per_degree.toFixed(1)} hours</td><td><span class="retention-rating retention-rating-${rating.level}" data-retention-rating="${rating.level}" tabindex="0" title="${escapeHTML(rating.level==='learning'?this.t('Waiting for learned heat-loss parameters.'):rating.relative?this.t('Relative to construction reference:')+' '+this.t(houseOptionLabels[v.reference_type]||v.reference_type)+' · '+v.reference_hours.toFixed(1)+' h · '+rating.ratio.toFixed(2)+'× '+this.t('reference cooling time')+'. '+this.t('Not an energy-efficiency or insulation class.'):this.t('Provisional cooling-speed band for the reference test; not an energy-efficiency or insulation class.'))}">${escapeHTML(this.t(rating.label))}${tooltipInfoIcon}</span></td><td><span class="status-pill ${v.updated?'mode':'neutral'}" tabindex="0" title="${escapeHTML(this.helpText('{heating} observed heating hours; {idle} idle hours. Enough observations do not by themselves prove accuracy.',{heating:v.heating_hours,idle:v.idle_hours}))}">${v.updated?'Adapting':'Initial estimate'}${tooltipInfoIcon}</span></td></tr>`;}).join('')}</tbody></table></div><details class="retention-help" id="retention-help" ${this.retentionHelpOpen?'open':''}><summary>${escapeHTML(this.t('About these estimates'))}</summary><p>Compare rooms under the same conditions: <b>20°C indoors, −10°C outdoors</b>, without heating, remaining slab warmth or appliance heat. Lower temperature loss means slower modeled cooling. This is a model estimate, not measured energy efficiency or an insulation rating.</p>${comparison}<p>Cooling-speed bands are provisional: under 1 h, 1–2 h, 2–4 h, 4–8 h, and 8 h or longer per 1°C drop. For a selected house type, badges instead compare with that type: under 0.5×, 0.5–0.8×, 0.8–1.25×, 1.25–2×, and at least 2× its reference cooling time. Initial rooms share starting estimates and remain unrated. Comparisons become more useful as their heat-loss parameters adapt to observations. Wind, ventilation, sensor placement and unmeasured heat sources can affect the estimates. The listed time describes this reference test, not how long heating can safely remain off in your home.</p></details></div></details></section>`;
  }
  isGarageRoom(id,room){return Boolean(room?.is_garage||this.settings?.rooms?.find(item=>item.id===id)?.is_garage||this.info?.data?.rooms?.[id]?.is_garage);}
  overview(){
    const quality=this.collectionQuality();const data=this.info.data||{};const rooms=Object.entries(data.rooms||{}).sort((a,b)=>Number(this.isGarageRoom(a[0],a[1]))-Number(this.isGarageRoom(b[0],b[1]))||compareRoomNames(a[1],b[1]));
    return `<section class="status-card"><div class="status-heading"><h2>ThermalPilot status</h2></div>
    <dl class="status-grid">
      <div class="status-block"><dt>Operation</dt><dd>${this.controlBadges()}</dd><small>${data.heating_active===false?'Observation and learning are stopped.':'Observation and learning are enabled.'}</small></div>
      <div class="status-block status-temperature" tabindex="0" title="${escapeHTML(this.t('Recorded temperatures within the electricity price chart period, fitted across the card width'))}"><dt>Outdoor temperature ${tooltipInfoIcon}</dt><dd>${escapeHTML(data.outdoor??'—')}<span class="status-unit"> °C</span></dd>${this.statusSparkline('outdoor','#2196f3')}</div>
${waterDistribution(this.settings)&&this.settings?.water_entity?`      <div class="status-block status-temperature" tabindex="0" title="${escapeHTML(this.t('Recorded temperatures within the electricity price chart period, fitted across the card width'))}"><dt>Heating water temperature ${tooltipInfoIcon}</dt><dd>${escapeHTML(data.water??'—')}<span class="status-unit"> °C</span></dd>${this.statusSparkline('water','#16b957')}</div>`:''}
      <div class="status-block"><dt>Data collection</dt><dd><span class="status-pill ${data.collection?.collecting?'active':'paused'}">${data.collection?.collecting?'Active':'Paused'}</span><span class="status-pill quality quality-${quality.level}" tabindex="0" title="${escapeHTML(quality.detail)}">${escapeHTML(this.t('Data coverage: '+quality.label))}${tooltipInfoIcon}</span></dd></div>
      <div class="status-block"><dt>Stored history</dt><dd>${escapeHTML(Number(data.history_info?.rows??0).toLocaleString())}<span class="status-unit"> samples</span></dd><small class="collection-date">Collection started: ${data.history_info?.started_at!=null?escapeHTML(dateLabel(data.history_info.started_at*1000)):'No observations yet'}</small><small>Local database: ${((data.history_info?.bytes??0)/1048576).toFixed(1)} MiB</small></div>
      <div class="status-block"><dt>Last update</dt><dd class="status-time">${escapeHTML(data.updated?timeLabel(data.updated):'—')}</dd><small>Latest calculation and observation.</small></div>
    </dl></section>${(data.warnings||[]).map(w=>statusNotice(w,statusMessageLevel(w))).join('')}${!rooms.length?'<section>Add rooms on the Settings page.</section>':''}
    ${data.price_outlook?.enabled?`<p class="notice notice-${data.price_outlook.available?'info':'warning'}" role="status">${statusIcon(data.price_outlook.available?'info':'warning')}<span class="notice-text">${data.price_outlook.available?`Price forecast available · ${data.price_outlook.reserve_hours>6?'Extra heat storage considered ahead of expensive hours.':'No extra heat storage needed.'}`:`Price forecast: ${escapeHTML(data.price_outlook.reason||'Waiting for confirmed prices.')}`}</span></p>`:''}<div class="plan-comparison-grid">${(electricHeating(this.settings)||(this.settings.heating_zones||[]).length)?this.priceChart(false):''}${this.heatRetentionView()}</div><div class="observation-cards">${rooms.map(([id,r])=>{const p=r.plan,m=r.model||{};return `<section class="observation-card${this.isGarageRoom(id,r)?' garage-observation-card':''}"><details class="observation-accordion" data-room-accordion="${escapeHTML(id)}" ${this.roomDisclosureOpen(id)?'open':''}><summary><h2><span data-user-text>${escapeHTML(r.name)}</span> ${this.roomHeatingBadge(r,id)} ${this.learningBadge(r)} <small>${r.pump_suggestion?escapeHTML(r.pump_suggestion.mode==='heat'?'Heat pump: Heating':r.pump_suggestion.mode==='off'?'Heat pump: Off':'Heat pump: Fan only'):r.zone_monitor?'Shared heating zone':p?(p.heat?'Boosted thermostat target':p.mode==='normal'?'Normal thermostat target temperature':'Reduced thermostat target temperature'):'No suggestion'}</small></h2></summary><div class="observation-content"><div class="metrics"><div>Measured<strong>${escapeHTML(r.temperature??'—')} °C</strong></div><div>${r.air_control?'Heat pump heating setpoint':'Suggested thermostat target'}<strong>${escapeHTML(r.air_control?(r.pump_suggestion?.target??'—'):(p?.setpoint??'—'))} °C</strong></div></div>${r.error?statusNotice(r.error,'error'):p?.reason?.startsWith('Temperature limit risk:')?statusNotice(p.reason,'warning'):`<p>${escapeHTML(p?.reason||'Waiting for data.')}</p>`}${r.pump_suggestion?`<p>${escapeHTML(r.pump_suggestion.reason)}${r.is_garage?' · '+this.t('Garage limits')+': '+escapeHTML(this.settings.rooms.find(room=>room.id===id)?.garage_minimum)+'–'+escapeHTML(this.settings.rooms.find(room=>room.id===id)?.garage_maximum)+' °C':''}</p>`:''}${r.pump_control&&!r.pump_control.confirmed?`<p class="notice notice-info">Waiting for pump confirmation: <span>${escapeHTML(this.t(pumpStageLabels[r.pump_control.stage]||r.pump_control.stage))}</span></p>`:''}${r.zone_monitor?'<p>This room is monitored as part of a shared heating zone. The zone issues one set of commands to its pump.</p>':''}${this.learningView(r)}
    ${p?`<h3>${r.air_control?'Heat pump timing':'Thermostat timing'}</h3><p>${r.air_control?'Heat means heating mode; pauses use fan-only. Room sensors govern temperature limits. The device setpoint is separate from those limits.':'Target changes include the shared start/stop offsets. The temperature forecast models the planned heating period; actual valve and heat-pump delays must be checked against observations.'}</p><div class="scroll timing-table"><table><thead><tr><th>Change target at</th><th>Action</th><th>Target (°C)</th></tr></thead><tbody>${(p.commands||[]).map(c=>`<tr><td>${escapeHTML(timeLabel(c.time))}</td><td>${p.air_control?(c.mode==='boost'?'Heat':'Fan only'):c.action==='raise'?'Boost':c.action==='restore'?'Restore normal':'Reduce'}</td><td>${p.air_control?(c.mode==='boost'?p.device_target:'—'):c.setpoint}</td></tr>`).join('')||'<tr><td class="empty-table" colspan="3">No thermostat target changes planned.</td></tr>'}</tbody></table></div>${this.chart(p.slots,'temperature')}<p>Blue: predicted temperature under the proposed plan. This outcome has not been observed.</p>`:''}</div></details></section>`;}).join('')}</div>`;
  }
  historyView(){
    return `<div class="history-summary"><section><h2>Observations and suggestions</h2><label>Period<select id="history-hours">${[24,48,168].map(h=>`<option value="${h}" ${h===this.historyHours?'selected':''}>${h} hours</option>`).join('')}</select></label><p>Compare recorded temperatures with forecasts saved hours earlier. The accuracy cards also compare against predicting no temperature change. Forecasts assume the proposed heating plan; actual heating may differ, especially during simulation.</p></section>
    <section><h2>Season archives</h2><p>Learned parameters and season aggregates are retained when old observations are compacted.</p>${(this.info.data?.season_summaries||[]).map(a=>`<p>${escapeHTML(a.season)} · ${escapeHTML(this.settings.rooms.find(r=>r.id===a.room_id)?.name||a.room_id)} · ${a.statistics?.samples||0} observations · loss ${(a.model?.loss||0).toFixed(4)} · heating gain ${(a.model?.gain||0).toFixed(3)}</p>`).join('')||'<p>No completed heating season yet.</p>'}</section></div>${(electricHeating(this.settings)||(this.settings.heating_zones||[]).length)?this.priceChart(true):''}<div class="observation-cards">${[...this.settings.rooms].sort((a,b)=>Number(this.isGarageRoom(a.id,a))-Number(this.isGarageRoom(b.id,b))||compareRoomNames(a,b)).map(room=>{const rows=(this.history||[]).filter(r=>r.room_id===room.id);return `<section class="observation-card${this.isGarageRoom(room.id,room)?' garage-observation-card':''}"><details class="observation-accordion" data-room-accordion="${escapeHTML(room.id)}" ${this.roomDisclosureOpen(room.id)?'open':''}><summary><h2><span data-user-text>${escapeHTML(room.name)}</span> ${this.roomHeatingBadge(this.info.data?.rooms?.[room.id],room.id)} ${this.learningBadge(this.info.data?.rooms?.[room.id])}</h2></summary><div class="observation-content"><h3>Suggested heating and relay history</h3><div data-room-history="${escapeHTML(room.id)}"><p>Loading Home Assistant history…</p></div><p>Suggested On means the boosted target window, including valve timing offsets. Relay On means observed demand; it does not guarantee heat flow.</p>${this.forecastHistoryView(rows)}</div></details></section>`;}).join('')}</div>`;
  }
  historyCardHass(){
    if(!['fi',...Object.keys(languageText)].includes(this.settings?.language))return this._hass;
    const original=this._hass,language=this.settings.language;
    return {...original,locale:{...original.locale,language},localize:(...args)=>translateText(original.localize?.(...args)||args[0],language)};
  }
  historyGraphConfig(room){
    const mapping=this.info.room_entities?.[room.id]||{};
    const entities=[];
    if(mapping.suggested)entities.push({entity:mapping.suggested,name:this.t('Suggested heating window')});
    const actual=room.activity_entity||mapping.actual;
    if(actual)entities.push({entity:actual,name:this.t(room.activity_entity?'Thermostat relay':'Observed thermostat demand')});
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
      if(!config.entities.length){host.textContent=this.t('History entities are being registered. Refresh this page shortly.');continue;}
      const ids=config.entities.map(entity=>entity.entity).join(',');
      const start=new Date(Date.now()-this.historyHours*3600000).toISOString();
      const url=`/history?entity_id=${encodeURIComponent(ids)}&start_date=${encodeURIComponent(start)}`;
      try{
        let card;
        if(helpers?.createCardElement)card=helpers.createCardElement(config);
        else if(customElements.get('hui-history-graph-card')){card=document.createElement('hui-history-graph-card');card.setConfig(config);}
        if(card){card.hass=this.historyCardHass();this.historyCards.push(card);host.replaceChildren(card);}
        else host.innerHTML=`<p>${escapeHTML(this.t('Open a Home Assistant dashboard once, then return here to load embedded history cards.'))}</p>`;
      }catch(error){host.textContent=this.t('Embedded history is unavailable. Open the full Home Assistant history below.');}
      const link=document.createElement('a');link.href=url;link.textContent=this.t('Open full Home Assistant history');host.append(link);
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
    if(['settings','rooms'].includes(this.tab)){
      this.capture();
      if(['settings','rooms'].includes(tab)){this.tab=tab;this.render();return;}
      if(this.hasUnsavedSettings()&&!confirm(this.t('You have unsaved settings. Discard these changes and switch tabs?')))return;
    }
    this.tab=tab;this.loaded=false;this.load();
  }
  capture(preserveEmptyLists=false){
    const target=name=>{const [prefix,key]=name.split('.');return [prefix==='source'?this.settings:prefix.startsWith('zone')?this.settings.heating_zones[Number(prefix.slice(4))]:this.settings.rooms[Number(prefix.slice(4))],key];};
    this.shadowRoot.querySelectorAll('[data-field]').forEach(input=>{const [obj,key]=target(input.dataset.field);obj[key]=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;});
    const assignments=new Map(),editedZones=new Set();
    this.shadowRoot.querySelectorAll('[data-entity-list]').forEach(list=>{
      const [obj,key]=target(list.dataset.entityList);const selected=[...list.querySelectorAll('[data-entity-item]')].map(select=>select.value);
      if(key==='zone_rooms'){
        this.zoneRoomDrafts??={};this.zoneRoomDrafts[obj.id]=preserveEmptyLists?selected:selected.filter(Boolean);editedZones.add(obj.id);
        for(const id of selected.filter(Boolean))assignments.set(id,obj.id);
      }else obj[key]=preserveEmptyLists?selected:selected.filter(Boolean);
    });
    this.settings.rooms.forEach(room=>{if(editedZones.has(room.heating_zone_id))room.heating_zone_id='';if(assignments.has(room.id))room.heating_zone_id=assignments.get(room.id);});
    for(const zone of this.settings.heating_zones||[]){
      if(!editedZones.has(zone.id))continue;
      const members=this.settings.rooms.filter(room=>room.heating_zone_id===zone.id);
      if(!members.some(room=>room.id===zone.main_room_id))zone.main_room_id=members[0]?.id||'';
    }

  }

  render(){
    tpI18n.watch(this,this.settings?.language||'en');
    const settingsOpen=new Set([...this.shadowRoot.querySelectorAll('[data-settings-disclosure]')].filter(d=>d.open).map(d=>d.dataset.settingsDisclosure));
    this.shadowRoot.innerHTML=`<style>.header-status{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:8px 0 0}.header-status .status-pill{font-size:21px;font-weight:600;padding:8px 15px;border-radius:10px}.header-status-description{font-size:14px;color:var(--secondary-text-color,#60737b)}.status-pill.header-simulation{background:#e74c3c20;border-left:3px solid #c0392b}.status-pill.header-live{background:#2ecc7126;border-left:3px solid #229954}.status-pill.header-paused{background:#f1c40f26;border-left:3px solid #b7950b}.status-pill.header-observation{background:#3498db20;border-left:3px solid #3498db}
.settings-rooms .room-card.garage-room-card{background:linear-gradient(#91785e38,#91785e38),var(--card-background-color,white);border-color:#a18a75}
.sensor-list-field{display:flex;flex-direction:column;gap:7px;min-width:0}.sensor-list{display:flex;flex-direction:column;gap:8px;min-width:0}.sensor-list-row{display:flex;align-items:center;gap:6px;min-width:0}.sensor-list-row select{flex:1;min-width:0}.sensor-list-row button{flex:none;margin:0;padding:6px 10px;font-size:20px}.sensor-list .add-sensor{align-self:flex-start;margin:0;padding:6px 10px}
.fireplace-current-state,.source-current-state{font-size:13px;color:var(--secondary-text-color,#60737b);line-height:1.4}.language-picker{position:relative;display:block;min-width:0}.language-trigger{width:100%;margin:0;padding:8px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px;border-radius:6px;font:inherit;background:var(--card-background-color,white);text-align:left}.language-trigger>span:first-child{display:flex;align-items:center;gap:8px}.language-flag{display:inline-block;width:24px;height:15px;max-height:none;flex:0 0 24px;overflow:hidden;border:1px solid #819aa34d;border-radius:2px}.language-options{max-height:320px;overflow-y:auto;overscroll-behavior:contain;position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:50;padding:4px;background:var(--card-background-color,white);border:1px solid var(--divider-color,#aabdc5);border-radius:6px;box-shadow:0 4px 12px #0002}.language-options[hidden]{display:none}.language-options button{display:flex;align-items:center;gap:8px;width:100%;margin:0;padding:9px 8px;border:0;text-align:left;background:transparent;font:inherit}.language-options button:hover,.language-options button:focus-visible,.language-options button[aria-selected=true]{background:var(--secondary-background-color,#edf4fa)}.language-trigger:focus-visible,.language-options button:focus-visible{outline:2px solid var(--primary-color,#087c85);outline-offset:2px}
:host{display:block;color:var(--primary-text-color,#213547);background:var(--primary-background-color,#f5f7fa);min-height:100vh;font:15px system-ui}*{box-sizing:border-box}header,main{max-width:1250px;margin:auto;padding:24px}h1{margin:0 0 8px}h2{font-size:21px}small{font-size:14px;font-weight:normal}nav{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px}button{border:1px solid #aac0c8;border-radius:8px;padding:10px 16px;background:var(--card-background-color,white);color:inherit;cursor:pointer;margin:4px}button.active,.primary{background:#087c85;color:white}section{background:var(--card-background-color,white);border:1px solid var(--divider-color,#dce4e8);border-radius:14px;padding:24px;margin:0 0 20px}.settings-group{margin-top:24px}.settings-group+.settings-group{border-top:1px solid var(--divider-color,#dce4e8);padding-top:8px}.settings-group h3{font-size:17px;margin:16px 0}.settings-sources{background:linear-gradient(#2196f312,#2196f312),var(--card-background-color,white)}#settings .settings-house>p.notice.notice-info{margin-top:36px;--notice-tint:#3498db30;box-shadow:inset 0 0 0 1px #3498db45}.settings-house{background:linear-gradient(#2196f312,#2196f312),var(--card-background-color,white)}.settings-shared{background:linear-gradient(#00857712,#00857712),var(--card-background-color,white)}.settings-zones{background:linear-gradient(#e4902512,#e4902512),var(--card-background-color,white)}.settings-rooms{position:relative;isolation:isolate;background:var(--card-background-color,white);overflow:hidden}.settings-rooms::before{content:"";position:absolute;inset:0;z-index:-1;background:url("${roomFloorPlanAsset}") center/cover no-repeat;opacity:.2;pointer-events:none}.settings-rooms .room-card{background:#ffffffbf}@supports(background:color-mix(in srgb,white,transparent)){.settings-rooms .room-card{background:color-mix(in srgb,var(--card-background-color,white) 75%,transparent)}}.badge{color:#087c85;font-weight:600}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:18px}label[hidden],[data-fireplace-state][hidden],[data-water-group][hidden],[data-air-group][hidden],[data-electric-group][hidden],label[data-electric-control][hidden]{display:none}label{display:flex;flex-direction:column;gap:7px}.number-unit{display:flex;align-items:center;gap:8px}.number-unit input{min-width:0;flex:1}.number-unit span{flex:none}input,select{width:100%;padding:10px;border:1px solid #aabdc5;border-radius:6px;color:inherit;background:var(--card-background-color,white)}input[type=checkbox].setting-toggle{appearance:none;-webkit-appearance:none;width:44px;height:26px;padding:2px;border:0;border-radius:13px;background:var(--disabled-color,#87949b);cursor:pointer;transition:background .15s}input[type=checkbox].setting-toggle::before{content:"";display:block;width:22px;height:22px;border-radius:50%;background:white;box-shadow:0 1px 3px #0003;transition:transform .15s}input[type=checkbox].setting-toggle:checked{background:var(--primary-color,#087c85)}input[type=checkbox].setting-toggle:checked::before{transform:translateX(18px)}input[type=checkbox].setting-toggle:focus-visible{outline:2px solid var(--primary-color,#087c85);outline-offset:3px}details{border-top:1px solid #ddd;padding:18px 0}summary{font-weight:600;cursor:pointer;margin-bottom:20px}.room-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;align-items:start;margin:20px 0}.room-card{position:relative;min-width:0;border:1px solid var(--divider-color,#dce4e8);border-radius:12px;padding:20px;background:var(--card-background-color,white)}.room-card details{border:0;padding:0}.room-card summary{margin:0;min-height:26px;padding-right:78px;overflow-wrap:anywhere}.room-target{font-weight:normal;color:var(--secondary-text-color,#60737b);white-space:nowrap;margin-left:8px}.room-card details[open] summary{margin-bottom:20px}.room-fields{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.room-fields label{min-width:0}.room-fields input,.room-fields select{min-width:0;max-width:100%}.room-actions{position:absolute;top:10px;right:10px;display:flex;gap:4px;margin:0}.room-actions .icon-button{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;padding:7px;margin:0;border:0;background:transparent;border-radius:50%}.room-actions .icon-button:hover{background:var(--secondary-background-color,#eef2f4)}.room-actions .icon-button:focus-visible{outline:2px solid var(--primary-color,#087c85);outline-offset:2px}.room-actions .delete-room{color:var(--error-color,#c62828)}.icon-button svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}@media(max-width:900px){.room-cards{grid-template-columns:minmax(0,1fr)}}@media(max-width:600px){.room-fields{grid-template-columns:minmax(0,1fr)}.room-card{padding:16px}}.sticky{position:sticky;bottom:0;background:var(--card-background-color,white);padding:12px;box-shadow:0 -2px 8px #0001}.metrics{display:flex;gap:24px;flex-wrap:wrap}.metrics strong{display:block;font-size:24px;margin-top:8px}.notice-icon{width:20px;height:20px;max-height:none;flex:0 0 20px;fill:none;stroke:var(--notice-accent,#3498db);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;margin-top:2px}.notice-text{min-width:0;overflow-wrap:anywhere}.notice-level{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.notice,.message{display:flex;align-items:flex-start;gap:10px;padding:12px 16px;border-radius:8px;color:var(--primary-text-color,#213547);border-left:3px solid var(--notice-accent,#3498db);background:linear-gradient(var(--notice-tint,#3498db18),var(--notice-tint,#3498db18)),var(--card-background-color,white)}.notice-info{--notice-accent:#3498db;--notice-tint:#3498db18}.notice-warning{--notice-accent:#d9a400;--notice-tint:#f5c51820}.notice-error{--notice-accent:#d64545;--notice-tint:#d6454518}.save-toast{position:fixed;bottom:calc(24px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);z-index:10000;width:max-content;max-width:calc(100% - 32px);margin:0;padding:14px 20px;box-shadow:0 4px 18px #0002;pointer-events:none}
.save-error{pointer-events:auto;width:min(680px,calc(100% - 32px));max-height:45vh;overflow:auto;display:flex;align-items:flex-start;gap:12px;border:1px solid #c0392b66;border-left:4px solid #c0392b;background:linear-gradient(#e74c3c18,#e74c3c18),var(--card-background-color,white)}.save-error .notice-text{flex:1;min-width:0;overflow-wrap:anywhere}.save-error button{flex:none;margin:0;padding:0 3px;border:0;background:transparent;font-size:24px;line-height:1;align-self:flex-start}.save-error button:focus-visible{outline:2px solid var(--primary-color,#087c85)}
[data-room-history]{margin:12px 0}[data-room-history] a{display:inline-block;color:var(--primary-color,#087c85);margin-top:12px}.chart-legend{display:flex;flex-wrap:wrap;gap:12px 24px;margin:14px 0 6px}.chart-legend span{display:flex;align-items:center;gap:8px}.chart-legend i{display:inline-block;width:24px;height:3px}.temperature-chart{overflow-x:auto;margin:8px 0}.temperature-chart svg{display:block;min-width:800px;width:100%;max-height:none}.scroll{overflow:auto;max-height:420px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #ddd;white-space:nowrap}.heat{background:#00857718}svg{width:100%;max-height:230px}svg text{fill:var(--primary-text-color,#213547);font-size:12px}p{line-height:1.6}@media(max-width:600px){header,main{padding:12px}section{padding:16px}}
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
#settings .grid>[hidden]{display:none}
#settings .grid>label>span:first-child,#settings .grid>.sensor-list-field>span:first-child{min-height:2.5em;line-height:1.25}
#settings input,#settings select{min-width:0;max-width:100%;padding:8px 10px}
#settings input.setting-toggle{padding:2px}
#settings .room-fields{grid-template-columns:repeat(2,minmax(0,1fr))}
#settings .settings-zones>.room-card+.room-card{margin-top:16px}
#settings #add-zone{margin-top:16px}
#settings .zone-empty-note{grid-column:1/-1;font-size:13px;color:var(--secondary-text-color,#60737b)}
.retention-summary{font-size:14px;color:var(--secondary-text-color,#526b75)}.retention-help{border:0;padding:0;margin:12px 0 0;font-size:14px;line-height:1.5}.retention-help>summary{margin:0;cursor:pointer;color:var(--primary-color,#087c85);padding:4px 0}.retention-help p{margin:10px 0}
.retention-sort{margin:0;font:inherit;font-weight:inherit;color:inherit;border:0;background:transparent;padding:0;display:inline-flex;align-items:center;gap:6px;text-align:left;cursor:pointer}.retention-sort:focus-visible{outline:2px solid var(--primary-color,#087c85);outline-offset:4px}
.retention-card table tbody tr.garage-retention-row{background:linear-gradient(#91785e38,#91785e38),var(--card-background-color,white)}
#settings .garage-settings-heading{grid-column:1/-1;font-size:17px;margin:0 0 4px}
#settings .garage-settings-divider{grid-column:1/-1;border-top:1px solid var(--divider-color,#91a5ad);margin:10px 0 2px}
#settings .room-cards{gap:16px;margin:16px 0}
#settings .room-card{padding:16px}
#settings .room-card details[open] summary{margin-bottom:16px}
#settings>.sticky{grid-column:1/-1;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:8px 12px;z-index:10}
@supports(grid-template-rows:subgrid){
 #settings .grid>label,#settings .grid>.sensor-list-field{display:grid;grid-row:span 3;grid-template-rows:subgrid;gap:6px;align-items:start}
 #settings .grid>label>span:first-child,#settings .grid>.sensor-list-field>span:first-child{min-height:0}
}
@media(min-width:1400px){
 #settings{grid-template-columns:repeat(2,minmax(0,1fr))}#settings>.settings-sources{grid-column:1/-1}#settings>.settings-house{grid-column:1;grid-row:1}#settings>.settings-shared{grid-column:2;grid-row:1}#settings>.settings-rooms{grid-column:1;grid-row:2}#settings>.settings-zones{grid-column:2;grid-row:2}#settings .settings-group>.grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
#settings[data-settings-page="settings"] .settings-group>.grid{grid-template-columns:repeat(4,minmax(0,1fr))}
@media(min-width:1800px){#settings .settings-group>.grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media(max-width:1000px){#settings .settings-group>.grid,#settings[data-settings-page="settings"] .settings-group>.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:600px){
 .settings-layout{padding:12px}
 #settings .grid,#settings .settings-group>.grid,#settings[data-settings-page="settings"] .settings-group>.grid{grid-template-columns:minmax(0,1fr)}
 #settings>section{padding:16px}
 #settings .room-fields{grid-template-columns:minmax(0,1fr)}
 #settings .grid>label,#settings .grid>.sensor-list-field{display:flex;flex-direction:column;grid-row:auto;gap:6px}
 #settings .grid>label>span:first-child,#settings .grid>.sensor-list-field>span:first-child{min-height:0}
 #settings .grid>label>input:not([type=checkbox]),#settings .grid>label>select{width:100%;box-sizing:border-box}
}
/* Keep dropdown arrows inset from the field border. */
select{appearance:none;-webkit-appearance:none;padding-right:36px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='m2 4 4 4 4-4' fill='none' stroke='%23808b93' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;background-size:12px 12px}
#settings select{padding-right:36px}
@media(forced-colors:active){select{appearance:auto;background-image:none}}

/* Compact numeric controls remain bounded by their grid cell on phones. */
#settings input[type=number]{width:120px;max-width:100%;font-variant-numeric:tabular-nums}
#settings .number-unit{width:155px;max-width:100%}
#settings .number-unit input[type=number]{flex:0 1 120px}

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
@media(max-width:600px){.tab-panel.page-layout{margin:0 12px 12px;padding:12px}.tab-list{padding:0;gap:3px;flex-wrap:wrap}.tab-list button{min-width:0;padding-left:18px;padding-right:18px}}
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
details{scroll-margin-block:16px}
.observation-accordion>summary{display:flex;align-items:center;gap:10px;list-style:none;margin:0}
.observation-accordion>summary::-webkit-details-marker{display:none}
.observation-accordion>summary::before{content:"▸";font-size:18px;transform:rotate(0);flex:none}
.observation-accordion[open]>summary::before{transform:rotate(90deg)}
.observation-card .observation-accordion>summary h2{display:flex;flex-wrap:wrap;align-items:center;column-gap:12px;row-gap:8px;flex:1;min-width:0;margin:0;font-size:21px}
.observation-card .observation-accordion>summary h2>.room-heating{flex:0 0 30px;margin:0}
.observation-card .observation-accordion>summary h2>.room-learning,.observation-card .observation-accordion>summary h2>.room-forecast-badge{margin:0;max-width:100%;white-space:normal}
.observation-card .observation-accordion>summary h2>small{flex-basis:100%}
.observation-accordion>summary:focus-visible{outline:2px solid var(--primary-color,#087c85);outline-offset:3px}
.observation-content{padding-top:16px;min-width:0}

.status-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:16px}
.status-heading h2{margin:0}
.status-heading button{margin:0}
.weather-density{display:flex;flex-direction:row;align-items:center;gap:8px;font-size:13px;color:var(--secondary-text-color,#526b75);margin:0 0 10px}.weather-density select{width:auto;max-width:220px;font:inherit;padding:6px 32px 6px 8px}
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
.status-pill{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:7px;font-size:16px;background:var(--secondary-background-color,#eef2f4)}
.status-pill.winter{background:#3498db24;color:#1b4f72;border-left:3px solid #3498db}
.status-pill.summer{background:#82e0aa33;color:#186a3b;border-left:3px solid #2ecc71}
.status-pill.active{background:#2ecc7126;color:var(--primary-text-color,#166534);border-left:3px solid #229954}
.status-help{position:relative;display:block;align-self:flex-start;border:0;padding:0;margin:0}
.status-help::details-content{content-visibility:visible}
.status-help>summary{align-items:center;gap:6px;list-style:none;cursor:pointer;margin:0;font-weight:normal}
.status-help>summary::-webkit-details-marker{display:none}
.status-help>summary:focus-visible{outline:2px solid var(--primary-color,#087c85);outline-offset:2px}
.status-info{display:inline-block;vertical-align:middle;width:14px;height:14px;flex:0 0 14px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;opacity:.8}
.status-info-dot{fill:currentColor;stroke:none}
.retention-rating .status-info{margin-left:6px}
.room-learning:focus-visible,.room-forecast-badge:focus-visible,.retention-rating:focus-visible,.status-temperature:focus-visible{outline:2px solid var(--primary-color,#087c85);outline-offset:2px}
.status-tooltip{display:none;position:absolute;left:0;top:calc(100% + 6px);z-index:40;width:280px;max-width:calc(100vw - 48px);padding:12px;border-radius:8px;background:var(--primary-text-color,#213547);color:var(--card-background-color,white);font-size:13px;line-height:1.45;box-shadow:0 3px 12px #0003}
.status-help[open]>.status-tooltip,.status-help:hover>.status-tooltip,.status-help:focus-within>.status-tooltip{display:block}
@media(max-width:600px){.status-tooltip{position:fixed;left:16px;right:16px;top:auto;bottom:calc(24px + env(safe-area-inset-bottom));width:auto;max-width:none;max-height:45vh;overflow:auto}}
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
@media(max-width:600px){.status-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.status-block{padding:12px}.status-block dd{font-size:21px}.status-block.status-temperature{min-height:150px;padding-bottom:70px}.status-temperature .status-sparkline{height:56px}}
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

.observation-layout .observation-cards>.observation-card.garage-observation-card:nth-child(n){--room-tint:#91785e38;--room-heading-tint:#91785e50;border-color:#a18a75}

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
.room-learning{display:inline-flex;align-items:center;gap:6px;margin-left:8px;font-size:14px;font-weight:normal;vertical-align:middle;white-space:nowrap;color:var(--secondary-text-color,#526671)}

/* Keep navigation reachable and card content inside the phone viewport. */
:host{min-width:0;max-width:100%}
.page-title{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.page-title h1{margin:0;min-width:0}
.menu-button{display:none;align-items:center;justify-content:center;flex:none;width:44px;height:44px;margin:0;padding:10px;border:0;background:transparent}
.menu-button svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.menu-button:focus-visible{outline:2px solid var(--primary-color,#087c85);outline-offset:2px}
.page-layout,section,.scroll,.price-chart-viewport,.temperature-chart{min-width:0;max-width:100%}
@media(max-width:600px){
 .menu-button{display:inline-flex}
 header.page-layout{padding:12px 10px 0}
 .page-title h1{font-size:25px}
 .badge{font-size:13px;line-height:1.45;overflow-wrap:anywhere}
 .tab-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:minmax(48px,auto);align-items:stretch;gap:6px;margin:16px 0 12px;padding:6px;border-radius:12px;background:var(--secondary-background-color,#eaf0f4)}
 .tab-list button,.tab-list button.active{min-width:0;min-height:48px;height:100%;margin:0;padding:10px 12px;border:2px solid transparent;border-radius:8px;font-size:14px;line-height:1.35;white-space:normal;overflow-wrap:anywhere}
 .tab-list button{background:transparent;color:var(--secondary-text-color,#526671)}
 .tab-list button.active{background:var(--primary-color,#087c85);border-color:var(--primary-color,#087c85);color:var(--text-primary-color,#fff);font-weight:700;box-shadow:0 1px 4px #0002}
 .tab-list button:focus-visible{outline:2px solid var(--primary-text-color,#213547);outline-offset:1px}
 .tab-panel.page-layout{margin:0 10px 12px;padding:10px;border-radius:12px}
 #settings>section,.observation-cards>section,.history-summary>section,.status-card,.price-card{padding:12px}
 #settings,.observation-cards,.history-summary{gap:16px}
 .grid{grid-template-columns:minmax(0,1fr)}
 .status-grid{grid-template-columns:minmax(0,1fr);gap:10px}
 .observation-card .metrics{grid-template-columns:minmax(0,1fr);gap:10px}
 .observation-card .observation-accordion>summary{padding:10px;gap:6px}
 .observation-card .observation-accordion>summary h2{font-size:18px;overflow-wrap:anywhere}
 .room-learning{display:inline-flex;margin:5px 0 0;white-space:normal;font-size:13px}
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
.plan-comparison-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:20px;margin-bottom:20px;align-items:start}.plan-comparison-grid>section{min-width:0;margin-bottom:0!important}
@media(min-width:1800px){.plan-comparison-grid{grid-template-columns:minmax(0,1.7fr) minmax(600px,1fr);align-items:stretch}.plan-comparison-grid>section{height:100%}.plan-comparison-grid .retention-bar{width:70px;margin-left:6px}.plan-comparison-grid .retention-value{min-width:65px}}
.plan-comparison-grid>section:has(>details:not([open])){height:auto;align-self:start}
.retention-rating{display:inline-block;padding:5px 18px 5px 9px;font-size:13px;font-weight:600;white-space:nowrap;line-height:1.3;clip-path:polygon(0 0,calc(100% - 9px) 0,100% 50%,calc(100% - 9px) 100%,0 100%)}.retention-rating-very-fast{background:#f8d7da;color:#86242e}.retention-rating-fast{background:#ffe0b2;color:#743b08}.retention-rating-moderate{background:#fff1ad;color:#665111}.retention-rating-slow{background:#dcedc8;color:#36571e}.retention-rating-very-slow{background:#bce7c9;color:#175b31}.retention-rating-learning{clip-path:none;border-radius:5px;padding-right:9px;background:var(--secondary-background-color,#e7ebed);color:var(--secondary-text-color,#526b75)}
.retention-card{background:linear-gradient(#0085770c,#0085770c),var(--card-background-color,white)}.retention-value{display:inline-block;min-width:80px}.retention-bar{display:inline-block;width:110px;height:7px;margin-left:10px;border-radius:4px;background:#819aa324}.retention-bar i{display:block;height:100%;border-radius:4px;background:#418ba4}.retention-card .scroll{max-height:none}.retention-card h2{margin:0}.retention-card th,.retention-card td{padding:8px;vertical-align:middle}
.retention-card .retention-numeric{text-align:right;font-variant-numeric:tabular-nums}
.retention-numeric .retention-sort{justify-content:flex-end;text-align:right;width:100%}
.retention-card .retention-value{min-width:0;text-align:right}
.retention-card .retention-bar{margin-left:0;margin-right:10px;vertical-align:middle}
.compact-status{display:none}

 @media(min-width:1200px){
 header.page-layout{display:grid;grid-template-columns:minmax(180px,1fr) minmax(0,1279px);align-items:center;gap:0 32px;padding-top:20px;grid-template-rows:minmax(100px,auto) auto}
 header.page-layout .page-title{grid-column:1;grid-row:1;margin:0;padding-top:0}
 header.page-layout .page-title h1{font-size:30px}
 header.page-layout .header-status{display:none}
 .plan-layout .status-card{display:none}
 header.page-layout .tab-list{grid-column:1/-1;grid-row:2;margin-top:8px}
 header.page-layout .tab-list button{font-size:16px}
 .compact-status{grid-column:2;grid-row:1;display:grid;grid-template-columns:minmax(250px,600px) 110px 125px minmax(235px,300px);align-items:start;gap:48px;min-width:0;padding:0;justify-self:end;align-self:center;transform:translateY(7px);width:100%}
 .compact-badges{min-width:0;margin:0;display:grid;grid-template-rows:44px auto;align-content:start}
 .compact-badges .status-badges{gap:8px;margin:0}
 .compact-status .status-pill{font-size:14px;line-height:1.2;padding:5px 8px;white-space:nowrap}
 .compact-status .status-info{width:15px;height:15px;flex-basis:15px}
 .compact-metric{display:grid;grid-template-rows:44px auto;gap:0;align-content:start;min-width:0}
 .compact-label,.compact-metric>span{font-size:14px;font-weight:600;line-height:1.3;margin-bottom:12px;color:var(--secondary-text-color,#526671)}
 .compact-metric>strong{padding-top:3px;font-size:20px;font-weight:600;line-height:1.2;font-variant-numeric:tabular-nums}
 .compact-metric small{font-size:12px;font-weight:400}
 .compact-secondary{display:grid;grid-template-rows:44px auto auto;justify-items:start;align-content:start;gap:0}.compact-secondary>.status-pill{margin:0 0 6px}
 .compact-status.compact-no-water{grid-template-columns:minmax(250px,600px) 110px minmax(235px,300px);max-width:1106px}
 .compact-extra{position:relative;padding:0;margin:0;border:0;font-size:12px}
 .compact-extra>summary{list-style:revert;display:list-item;cursor:pointer;font-size:12px;font-weight:normal;margin:0;color:var(--secondary-text-color,#526671)}
 .compact-extra>summary span{font-variant-numeric:tabular-nums}
 .compact-extra-body{position:absolute;right:0;top:calc(100% + 10px);z-index:80;width:320px;border:1px solid var(--divider-color,#c4d0d6);border-radius:10px;padding:16px;background:var(--card-background-color,white);box-shadow:0 5px 20px #0002}
 .compact-extra-body h3{margin:0 0 14px;font-size:16px}
 .compact-extra-body dl{margin:0;display:grid;gap:4px}
 .compact-extra-body dt{color:var(--secondary-text-color,#526671);font-size:12px}
 .compact-extra-body dd{margin:0 0 8px;font-size:14px}
 .compact-extra-body p{margin:4px 0 0;font-size:13px}
 }

 @media(min-width:1200px) and (max-width:1599px){
 .compact-status{grid-template-columns:minmax(280px,1fr) 110px 125px minmax(190px,220px);gap:24px;transform:translateY(4px)}
 .compact-status .status-pill{font-size:14px;padding:5px 8px}
 .compact-status .status-info{width:15px;height:15px;flex-basis:15px}
 .compact-badges .status-badges{gap:6px}
 .compact-status.compact-no-water{grid-template-columns:minmax(280px,1fr) 110px minmax(190px,220px)}
 }
 
</style>
    <header class="page-layout ${['settings','rooms'].includes(this.tab)?'settings-layout':this.tab==='history'?'history-layout observation-layout':'plan-layout observation-layout'}"><div class="page-title"><button type="button" class="menu-button" id="ha-menu" aria-label="Open Home Assistant menu" title="Open Home Assistant menu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg></button><h1>ThermalPilot</h1></div>${this.headerStatus()}${this.compactStatusView()}<nav class="tab-list" role="tablist" aria-label="ThermalPilot pages">${[['overview','Plan'],['history','History'],['rooms','Rooms and zones'],['settings','Settings']].map(([id,label])=>`<button id="tab-${id}" role="tab" aria-selected="${this.tab===id}" aria-controls="thermal-pilot-tab-panel" tabindex="${this.tab===id?0:-1}" data-tab="${id}" class="${this.tab===id?'active':''}">${label}</button>`).join('')}</nav>${this.message&&!this.saveConfirmation&&!(['settings','rooms'].includes(this.tab)&&this.messageLevel==='error')?`${statusNotice(this.message,this.messageLevel||'info','message')}`:''}</header><main id="thermal-pilot-tab-panel" role="tabpanel" aria-labelledby="tab-${this.tab}" class="tab-panel page-layout ${['settings','rooms'].includes(this.tab)?'settings-layout':this.tab==='history'?'history-layout observation-layout':'plan-layout observation-layout'}">${!this.info?'Loading…':['settings','rooms'].includes(this.tab)?this.settingsView(this.tab):this.tab==='history'?this.historyView():this.overview()}</main>${this.message&&this.saveConfirmation?`<div class="message save-toast notice-info" role="status" aria-live="polite">${statusIcon('info')}<span class="notice-text">${escapeHTML(this.t(this.message))}</span></div>`:''}${this.message&&!this.saveConfirmation&&['settings','rooms'].includes(this.tab)&&this.messageLevel==='error'?`<div class="message save-toast notice-error save-error" role="alert" aria-live="assertive" tabindex="-1">${statusIcon('error')}<span class="notice-text">${escapeHTML(this.t(this.message))}</span><button type="button" id="dismiss-save-error" aria-label="Dismiss error notification" title="Dismiss error notification">×</button></div>`:''}`;
    this.shadowRoot.querySelector('#dismiss-save-error')?.addEventListener('click',()=>{this.message='';this.saveConfirmation=false;this.shadowRoot.querySelector('.save-error')?.remove();});
    this.shadowRoot.querySelector('.save-error')?.focus?.({preventScroll:true});
    this.shadowRoot.querySelector('#ha-menu')?.addEventListener('click',()=>this.openSidebar());
    const statusDetails=this.shadowRoot.querySelector('#status-details');statusDetails?.addEventListener('toggle',()=>{this.statusDetailsOpen=statusDetails.open;});
    const retention=this.shadowRoot.querySelector('#retention-accordion');if(retention)retention.addEventListener('toggle',()=>{this.retentionOpen=retention.open;});
    const retentionHelp=this.shadowRoot.querySelector('#retention-help');retentionHelp?.addEventListener('toggle',()=>{this.retentionHelpOpen=retentionHelp.open;});
    const priceAccordion=this.shadowRoot.querySelector('#price-accordion');if(priceAccordion){const tab=this.tab;priceAccordion.addEventListener('toggle',()=>{this.priceAccordionState??={};this.priceAccordionState[tab]=priceAccordion.open;});}
    this.shadowRoot.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>this.switchTab(b.dataset.tab));
    this.shadowRoot.querySelector('.tab-list')?.addEventListener('keydown',event=>{
      const tabs=['overview','history','rooms','settings'],index=tabs.indexOf(event.target.dataset.tab);
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
    this.shadowRoot.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{
      this.capture();const index=Number(b.dataset.remove),room=this.settings.rooms[index];if(!room)return;
      const zones=(this.settings.heating_zones||[]).filter(zone=>zone.id===room.heating_zone_id||(this.zoneRoomDrafts?.[zone.id]||[]).includes(room.id));
      const warning=zones.length?'\n\n'+this.t('This room belongs to a heating zone. Removing it also removes its zone membership.')+'\n'+zones.map(zone=>zone.name||this.t('New heating zone')).join(', '):'';
      if(!confirm(this.t(`Remove room "${room.name||'New room'}"? Save settings to apply this change.`)+warning))return;
      this.message='';this.settings.rooms.splice(index,1);
      for(const zone of this.settings.heating_zones||[]){
        if(this.zoneRoomDrafts?.[zone.id])this.zoneRoomDrafts[zone.id]=this.zoneRoomDrafts[zone.id].filter(id=>id!==room.id);
        if(zone.main_room_id===room.id)zone.main_room_id=this.settings.rooms.find(member=>member.heating_zone_id===zone.id)?.id||'';
      }
      this.render();
    });
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
    this.shadowRoot.querySelectorAll('[data-settings-disclosure]').forEach(d=>{d.open=settingsOpen.has(d.dataset.settingsDisclosure);});
    settingsForm?.addEventListener('click',event=>{
      const button=event.target.closest?.('[data-add-sensor],[data-remove-sensor]');if(!button)return;
      event.preventDefault();this.capture(true);const list=button.closest('[data-entity-list]');const [prefix,key]=list.dataset.entityList.split('.');const obj=prefix.startsWith('zone')?this.settings.heating_zones[Number(prefix.slice(4))]:this.settings.rooms[Number(prefix.slice(4))];
      const values=key==='zone_rooms'?this.zoneRoomDrafts[obj.id]:obj[key];
      if(button.hasAttribute('data-add-sensor'))values.push('');else values.splice(Number(button.dataset.removeSensor),1);
      if(key==='zone_rooms'){const selected=new Set(values.filter(Boolean));this.settings.rooms.forEach(room=>{if(room.heating_zone_id===obj.id&&!selected.has(room.id))room.heating_zone_id='';});if(!selected.has(obj.main_room_id))obj.main_room_id=this.settings.rooms.find(room=>selected.has(room.id))?.id||'';}
      clearSaveMessage();this.render();
    });
    settingsForm?.addEventListener('change',event=>{this.updateSourceReadings();if(event?.target?.hasAttribute?.('data-zone-member')){this.capture(true);clearSaveMessage();this.render();return;}if(['is_garage','heat_control','thermostat','heating_zone_id','fireplace_entity','source_type','climate_mode'].some(key=>event?.target?.dataset?.field?.endsWith('.'+key))){this.capture();const field=event.target.dataset.field;const room=field.startsWith('room')?this.settings.rooms[Number(field.split('.')[0].slice(4))]:null;if(room?.is_garage&&['is_garage','thermostat'].some(key=>field.endsWith('.'+key))){const modes=this._hass.states[room.thermostat]?.attributes?.fan_modes||[];for(const [key,mode] of [['garage_fan_heat','high'],['garage_fan_idle','low'],['garage_fan_presence','medium']])if(!room[key]&&modes.includes(mode))room[key]=mode;}this.render();return;}if(event?.target?.dataset?.field==='source.fireplace_entity'){this.capture();this.render();return;}if(event?.target?.dataset?.field==='source.house_heat_source'){this.capture();this.render();return;}if(event?.target?.dataset?.field==='source.language'){this.capture();this.render();return;}if(event?.target?.dataset?.field==='source.house_distribution'){this.shadowRoot.querySelectorAll('[data-water-group]').forEach(group=>group.hidden=!waterDistribution({house_distribution:event.target.value}));}clearSaveMessage();this.updateUnsavedNotice();if(event?.target?.dataset?.field?.endsWith('.solar_direction')){const exposure=event.target.closest('.room-card')?.querySelector('[data-solar-exposure]');if(exposure)exposure.hidden=event.target.value==='disabled';}});
    settingsForm?.addEventListener('submit',async e=>{
      e.preventDefault();if(this.saving)return;this.capture();
      const enableLive=electricHeating(this.settings)&&this.settings.simulation_enabled===false&&!this.info.settings?.live_control_confirmed;
      if(enableLive&&this.settings.rooms.some(r=>r.is_garage||r.heat_control==='air_to_air'||r.heating_zone_id)&&!confirm(this.t('Air-to-air heat pump control changes HVAC modes, fan modes and any selected swing mode. Simulation sends no heat pump commands. Enable live control?')))return;
      if(enableLive&&!confirm(this.t('Enable real thermostat control? If another automation controls these thermostats, disable it first. ThermalPilot will apply its scheduled targets, even while the model is still learning. Missing essential data returns affected rooms to their seasonal fallback temperature.')))return;
      clearSaveMessage();this.saving=true;
      const saveButton=settingsForm.querySelector('button[type=submit]');
      if(saveButton)saveButton.textContent=this.t('Saving…');
      settingsForm.querySelectorAll('input,select,button').forEach(control=>control.disabled=true);
      try{
        let saved=await this.call('save',{settings:this.settings,enable_live_control:enableLive});
        if(saved?.requires_learning_confirmation){
          const details=(saved.learning_changes||[]).map(change=>change.name+': '+this.t(change.scope==='heating_response'?'heating response will restart; learned heat retention will be kept':'all learned room parameters will reset')).join('\n');
          if(!confirm(this.t('Saving these changes will reset learning for:')+'\n\n'+details+'\n\n'+this.t('Recorded history will be kept. Save and reset learning?')))return;
          saved=await this.call('save',{settings:this.settings,enable_live_control:enableLive,confirm_learning_reset:true});
          if(saved?.requires_learning_confirmation)throw new Error('Learning reset was not confirmed.');
        }
        this.settings.live_control_confirmed=!this.settings.simulation_enabled;this.info.settings=structuredClone(this.settings);this.message=`Settings saved at ${new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})}. Suggestions will update shortly.`;this.saveConfirmation=true;this.messageLevel='info';
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
    this.shadowRoot.querySelectorAll('[data-retention-sort]').forEach(button=>button.addEventListener('click',()=>this.sortRetention(button.dataset.retentionSort)));
    this.mountAccordionScrolling();
    this.mountLanguagePicker();
    this.mountPriceChartSizing();
    if(this.tab==='history')this.mountHistoryGraphs();
    this.shadowRoot.querySelector('#add-zone')?.addEventListener('click',()=>{this.capture();this.settings.heating_zones??=[];const zone={...this.info.zone_defaults,id:roomId()};this.settings.heating_zones.push(zone);this.render();const accordion=this.shadowRoot.querySelector(`[data-settings-disclosure="${zone.id}"]`);if(accordion)accordion.open=true;});
    this.shadowRoot.querySelectorAll('[data-remove-zone]').forEach(button=>button.addEventListener('click',()=>{this.capture();const zone=this.settings.heating_zones[Number(button.dataset.removeZone)];if(!confirm(this.t('Remove heating zone')+' '+zone.name+'?'))return;this.settings.heating_zones.splice(Number(button.dataset.removeZone),1);this.settings.rooms.forEach(room=>{if(room.heating_zone_id===zone.id){room.heating_zone_id='';}});this.render();}));
    this.shadowRoot.querySelector('#history-hours')?.addEventListener('change',e=>{this.historyHours=Number(e.target.value);this.load();});
  }
}
if(!customElements.get('thermal-pilot-panel'))customElements.define('thermal-pilot-panel',ThermalPilotPanel);
