/* Template tests without a browser. This does not verify visual rendering. */
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
let Component;
class Element {
  attachShadow(){this.shadowRoot={innerHTML:'',querySelectorAll:()=>[],querySelector:()=>null};}
}
const context={HTMLElement:Element,customElements:{get:()=>undefined,define:(name,value)=>{Component=value;}},
  structuredClone,Date,Number,String,Object,Math,JSON,Infinity,console,setInterval,clearInterval,setTimeout,clearTimeout,confirm:()=>true};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../custom_components/thermal_pilot/frontend/panel.js'),'utf8'),context);
const panel=new Component();
(async()=>{
 const graphPanel=new Component();graphPanel.tab='history';graphPanel.historyHours=48;graphPanel._hass={states:{}};
 const room={id:'native-room',name:'Study',activity_entity:'switch.floor_valve'};
 graphPanel.settings={rooms:[room]};graphPanel.info={room_entities:{'native-room':{suggested:'binary_sensor.renamed_suggestion',actual:'binary_sensor.observed_demand'}}};
 let createdConfig,mounted;const links=[];
 const host={dataset:{roomHistory:'native-room'},isConnected:true,replaceChildren:card=>mounted=card,append:link=>links.push(link)};
 graphPanel.shadowRoot.querySelectorAll=()=>[host];
 context.loadCardHelpers=async()=>({createCardElement:config=>{createdConfig=config;return {};}});
 context.document={createElement:()=>({})};
 await graphPanel.mountHistoryGraphs();
 assert.equal(createdConfig.type,'history-graph');assert.equal(createdConfig.hours_to_show,48);
 assert.equal(createdConfig.entities[0].entity,'binary_sensor.renamed_suggestion');
 assert.equal(createdConfig.entities[1].entity,'switch.floor_valve');assert.equal(mounted.hass,graphPanel._hass);
 assert.match(links[0].href,/entity_id=binary_sensor.renamed_suggestion%2Cswitch.floor_valve/);
 room.activity_entity='';assert.equal(graphPanel.historyGraphConfig(room).entities[1].entity,'binary_sensor.observed_demand');
 graphPanel.settings.language='fi';graphPanel._hass.locale={language:'en'};graphPanel._hass.localize=()=> 'Off';
 await graphPanel.mountHistoryGraphs();
 assert.equal(createdConfig.entities[0].name,'Suunniteltu lämmitysjakso');
 assert.equal(mounted.hass.locale.language,'fi');assert.equal(mounted.hass.localize('state.off'),'Pois');
 assert.equal(graphPanel._hass.locale.language,'en');
 assert.equal(links.at(-1).textContent,'Avaa Home Assistantin koko historia');
 console.log('Native history tests passed (renamed entity IDs, relay comparison, thermostat fallback, period and full-history link).');
})().catch(error=>{console.error(error);process.exitCode=1;});
const quarterRows=vm.runInContext('quarterHourObservations',context);
const hour=new Date(2026,9,10,0,0,0).getTime()/1000;
const samples=[
 {room_id:'history-room',time:hour+3*60,temperature:20,prediction:20.1,suggested_heat:1,activity:0,suggested_setpoint:21.5},
 {room_id:'history-room',time:hour+12*60,temperature:20.2,prediction:20.3,suggested_heat:0,activity:1,suggested_setpoint:19},
 {room_id:'history-room',time:hour+21*60,temperature:20.4,prediction:null,suggested_heat:null,activity:null,suggested_setpoint:null},
];
const quarters=quarterRows(samples.slice().reverse());
assert.equal(quarters.length,2);assert.equal(quarters[0].time,hour+12*60);assert.equal(quarters[1].interval_start,hour+15*60);
const historyPanel=new Component();historyPanel.settings={rooms:[{id:'history-room',name:'Study'}]};historyPanel.info={data:{}};historyPanel.history=samples;
const readableHistory=historyPanel.historyView();
assert.match(readableHistory,/Measured temperature/);assert.match(readableHistory,/Saved 3-hour forecast/);assert.match(readableHistory,/No completed 3-hour forecasts/);
assert.match(readableHistory,/00:00/);assert.match(readableHistory,/00:15/);assert.match(readableHistory,/00:30/);
assert.doesNotMatch(readableHistory,/<th>15-minute interval<|Each row shows the latest observation|Table shows up to 288 intervals/);
assert.match(readableHistory,/data-room-history="history-room"/);
assert.doesNotMatch(readableHistory,/Suggested thermostat target \(°C\)|not an average/);
assert.doesNotMatch(readableHistory,/>Idle<|>Inactive<|>Heating</);
const chartWithLargePrediction=historyPanel.chart([{time:hour,temperature:20,prediction:25}],'temperature','prediction');
assert.match(chartWithLargePrediction,/25.1 °C/);assert.match(chartWithLargePrediction,/stroke-dasharray/);
console.log('Readable history tests passed (quarter-hour latest observations, legends, compact cards without the raw table, scale includes both lines).');

const accordionPanel=new Component();accordionPanel.settings={rooms:[{id:'room-a',name:'Study'}],heating_enabled:true};
accordionPanel.info={data:{rooms:{'room-a':{name:'Study',learning_progress:{percent:62.5}}}}};accordionPanel.tab='overview';
assert.doesNotMatch(accordionPanel.overview(),/data-room-accordion="room-a" open/);
assert.match(accordionPanel.overview(),/63% initial data/);
accordionPanel.roomDisclosureState.set('overview:room-a',true);
assert.match(accordionPanel.overview(),/data-room-accordion="room-a" open/);
accordionPanel.tab='history';assert.doesNotMatch(accordionPanel.historyView(),/data-room-accordion="room-a" open/);
assert.match(accordionPanel.historyView(),/63% initial data/);
accordionPanel.roomDisclosureState.set('history:room-a',true);
assert.match(accordionPanel.historyView(),/data-room-accordion="room-a" open/);
accordionPanel.roomDisclosureState.set('history:room-a',false);
assert.doesNotMatch(accordionPanel.historyView(),/data-room-accordion="room-a" open/);
const dateLearning=accordionPanel.learningView({model:{heated_hours:6,idle_hours:12},learning_progress:{percent:75,estimated_days_to_initial:2,estimated_initial_completion:'2026-10-13T12:00:00+00:00',rate_history_hours:48}});
assert.match(dateLearning,/Estimated initial-data completion/);assert.match(dateLearning,/2026/);assert.match(dateLearning,/75%/);
console.log('Room accordion tests passed (closed by default, summary learning progress, independently remembered Plan/History states).');

(async()=>{
 let ToastPanel,nextTimer=0;const timers=new Map(),callbacks=[];
 const toastContext={...context,customElements:{get:()=>undefined,define:(_,value)=>ToastPanel=value},
  setTimeout:(callback,delay)=>{assert.equal(delay,5000);callbacks.push(callback);timers.set(++nextTimer,callback);return nextTimer;},clearTimeout:id=>timers.delete(id)};
 vm.createContext(toastContext);vm.runInContext(fs.readFileSync(path.join(__dirname,'../custom_components/thermal_pilot/frontend/panel.js'),'utf8'),toastContext);
 const toastPanel=new ToastPanel();toastPanel._hass={states:{}};toastPanel.settings={rooms:[]};toastPanel.info={source_fields:[],room_fields:[]};toastPanel.tab='settings';
 const handlers={},form={addEventListener:(name,handler)=>handlers[name]=handler,querySelector:()=>null,querySelectorAll:()=>[]};let removed=0;
 toastPanel.shadowRoot.querySelector=selector=>selector==='#settings'?form:selector==='.save-toast'?{remove:()=>removed++}:null;
 toastPanel.call=async()=>{};toastPanel.render();await handlers.submit({preventDefault(){}});
 assert.match(toastPanel.shadowRoot.innerHTML,/<div class="message save-toast notice-info" role="status"/);
 assert.match(toastPanel.shadowRoot.innerHTML,/position:fixed;bottom:/);
 assert.equal(timers.size,1);
 await handlers.submit({preventDefault(){}});assert.equal(timers.size,1);
 const timer=[...timers.values()][0];timer();assert.equal(toastPanel.message,'');assert.equal(removed,1);
 console.log('Save notification tests passed (bottom overlay, five-second dismissal, replacement on repeat save).');
})().catch(error=>{console.error(error);process.exitCode=1;});
// Saving feedback must describe the current attempt, including repeated saves and failure.
(async()=>{
 const savePanel=new Component();savePanel._hass={states:{}};
 savePanel.settings={rooms:[]};savePanel.info={source_fields:[],room_fields:[]};savePanel.tab='settings';
 const handlers={},button={textContent:'Save settings'},control={disabled:false};let removed=0;
 const form={addEventListener:(name,handler)=>handlers[name]=handler,querySelector:()=>button,querySelectorAll:()=>[control,button]};
 savePanel.shadowRoot.querySelector=selector=>selector==='#settings'?form:selector==='.message'?{remove:()=>removed++}:null;
 savePanel.message='Old save confirmation';savePanel.render();handlers.input({});
 assert.equal(savePanel.message,'');assert.equal(removed,1);
 let finish,calls=0;savePanel.call=()=>{calls++;return new Promise(resolve=>finish=resolve);};
 const first=handlers.submit({preventDefault(){}});
 assert.equal(button.textContent,'Saving…');assert.equal(control.disabled,true);assert.equal(savePanel.message,'');
 await handlers.submit({preventDefault(){}});assert.equal(calls,1);
 finish();await first;assert.match(savePanel.message,/^Settings saved at /);assert.equal(savePanel.saving,false);
 handlers.change();assert.equal(savePanel.message,'');
 const second=handlers.submit({preventDefault(){}});assert.equal(calls,2);finish();await second;
 assert.match(savePanel.message,/^Settings saved at /);
 savePanel.call=async()=>{throw new Error('Connection lost');};
 await handlers.submit({preventDefault(){}});assert.equal(savePanel.message,'Settings were not saved: Connection lost');
 console.log('Save feedback tests passed (clear on edit, saving state, duplicate prevention, repeat success and failure).');
})().catch(error=>{console.error(error);process.exitCode=1;});
panel._hass={states:{'sensor.price':{entity_id:'sensor.price',attributes:{friendly_name:'<script>alert(1)</script>'}}}};
panel.settings={heating_enabled:true,apply_season_setpoints:false,rooms:[]};
panel.info={settings:panel.settings,source_fields:[['price_entity','Price sensor','sensor']],room_fields:[],room_defaults:{},data:{warnings:[],rooms:{},history_info:{rows:0,bytes:0},collection:{collecting:false},heating_active:true}};
panel.tab='settings';panel.render();assert.match(panel.shadowRoot.innerHTML,/Save settings/);assert.match(panel.shadowRoot.innerHTML,/data-field="source.price_entity"/);assert.match(panel.shadowRoot.innerHTML,/&lt;script&gt;/);assert.doesNotMatch(panel.shadowRoot.innerHTML,/<script>alert/);
panel.tab='overview';panel.render();assert.match(panel.shadowRoot.innerHTML,/ThermalPilot status/);assert.doesNotMatch(panel.shadowRoot.innerHTML,/Set passive/);assert.match(panel.shadowRoot.innerHTML,/Simulation is active\. ThermalPilot does not control heating\./);
panel.settings.apply_season_setpoints=true;panel.render();assert.match(panel.shadowRoot.innerHTML,/season transitions can change thermostat targets/);
panel.tab='history';panel.history=[];panel.render();assert.match(panel.shadowRoot.innerHTML,/Season archives/);assert.doesNotMatch(panel.shadowRoot.innerHTML,/Download observations|id="export"/);
console.log('Panel template tests passed (settings, status, history, command-mode banner, escaping).');

// Exercise the actual click handler with and without secure-context UUID support.
for(const mode of ['native','http','missing']){
  let serial=0;
  if(mode==='native')context.crypto={randomUUID:()=>`00000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`};
  else if(mode==='http')context.crypto={getRandomValues:bytes=>{require('node:crypto').randomFillSync(bytes);return bytes;}};
  else delete context.crypto;
  const testPanel=new Component();let click;
  testPanel._hass={states:{}};
  testPanel.tab='rooms';
  testPanel.settings={rooms:[],price_entity:'sensor.original'};
  testPanel.info={source_fields:[],room_fields:[],room_defaults:{name:'',baseline:20}};
  testPanel.shadowRoot.querySelector=selector=>selector==='#add'?{addEventListener:(event,handler)=>{assert.equal(event,'click');click=handler;}}:null;
  testPanel.shadowRoot.querySelectorAll=selector=>selector==='[data-field]'?[{dataset:{field:'source.price_entity'},type:'text',value:'sensor.unsaved'}]:[];
  testPanel.render();
  assert.equal(typeof click,'function');click();click();
  assert.equal(testPanel.settings.price_entity,'sensor.unsaved');
  assert.equal(testPanel.settings.rooms.length,2);
  assert.equal(testPanel.settings.rooms[0].baseline,20);
  const ids=testPanel.settings.rooms.map(room=>room.id);
  ids.forEach(id=>assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i));
  assert.notEqual(ids[0],ids[1]);
  assert.match(testPanel.shadowRoot.innerHTML,/New room/);
}
console.log('Add Room click tests passed (native UUID, HTTP-compatible crypto, no crypto, unsaved settings).');

// Shared fixtures also exercise the Python setup-selector rules.
const cases=JSON.parse(fs.readFileSync(path.join(__dirname,'entity_selector_cases.json'),'utf8'));
const matches=vm.runInContext('entityMatches',context);
for(const item of cases){
  for(const kind of ['temperature','power','price','target','activity','relay','water'])assert.equal(matches(item,{kind}),item.matches.includes(kind),`${item.entity_id}: ${kind}`);
}
const filterPanel=new Component();filterPanel._hass={states:Object.fromEntries(cases.map(item=>[item.entity_id,item]))};
for(const [key,domain,kind,expected] of [
  ['temperature_entity','sensor','temperature',['sensor.room','sensor.template','sensor.temperature_state']],
  ['power_entity','sensor','power',['sensor.power','sensor.power_template']],
  ['price_entity','sensor','price',['sensor.price','sensor.price_legacy']],
  ['baseline_entity','input_number,number,sensor','target',['input_number.target','number.target','sensor.room','sensor.template','sensor.temperature_state']],
  ['water_entity','sensor,climate','water',['sensor.room','sensor.template','sensor.temperature_state','climate.panasonic_heat_pump_main_z1_temp']],
  ['activity_entity','sensor,binary_sensor,switch','activity',['sensor.state','sensor.custom_state','sensor.digital','binary_sensor.heat','switch.valve']],
  ['activity_entity','switch','relay',['switch.valve']],
]){
 const html=filterPanel.field([key,key,domain,{kind}],{[key]:''},'source');
 for(const item of cases)assert.equal(html.includes(`value="${item.entity_id}"`),expected.includes(item.entity_id),`${key}: ${item.entity_id}`);
}
const retained=filterPanel.field(['temperature_entity','Temperature','sensor',{kind:'temperature'}],{temperature_entity:'sensor.humidity'},'room0');
assert.match(retained,/selected value="sensor.humidity"/);assert.match(retained,/does not match filter/);
const missing=filterPanel.field(['temperature_entity','Temperature','sensor',{kind:'temperature'}],{temperature_entity:'sensor.missing'},'room0');assert.match(missing,/unavailable/);
assert.equal(matches({entity_id:'sensor.room',state:'20',attributes:{device_class:'temperature',valve:'open'}},{kind:'activity'},{activity_attribute:'valve'}),true);
console.log('Typed selector tests passed (temperature, power, prices, targets, activity, retained selections).');

const sortedPanel=new Component();sortedPanel._hass={states:{}};sortedPanel.tab='rooms';sortedPanel.history=[];
sortedPanel.settings={rooms:[{id:'z',name:'Zulu'},{id:'b',name:'beta'},{id:'a',name:'Alpha'},{id:'new',name:''}]};
sortedPanel.info={source_fields:[],room_fields:[['name','Room name','text']],room_defaults:{},data:{rooms:{z:{name:'Zulu'},b:{name:'beta'},a:{name:'Alpha'}}}};
const settingsHTML=sortedPanel.settingsView();
assert.doesNotMatch(settingsHTML,/<details[^>]*\bopen\b/);
assert.equal((settingsHTML.match(/<details(?:\s[^>]*)?>/g)||[]).length,4);
assert.ok(settingsHTML.indexOf('<summary><span data-user-text>Alpha')<settingsHTML.indexOf('<summary><span data-user-text>beta'));
assert.ok(settingsHTML.indexOf('<summary><span data-user-text>beta')<settingsHTML.indexOf('<summary><span data-user-text>Zulu'));
assert.ok(settingsHTML.indexOf('<summary><span data-user-text>Zulu')<settingsHTML.indexOf('<summary><span data-user-text>New room'));
assert.match(settingsHTML,/<summary><span data-user-text>Alpha[\s\S]*?<\/summary>[\s\S]*?data-field="room2.name"/);
assert.deepEqual(sortedPanel.settings.rooms.map(r=>r.id),['z','b','a','new']);
const overviewHTML=sortedPanel.overview(),historyHTML=sortedPanel.historyView();
for(const html of [overviewHTML,historyHTML])assert.ok(html.indexOf('<h2><span data-user-text>Alpha')<html.indexOf('<h2><span data-user-text>beta')&&html.indexOf('<h2><span data-user-text>beta')<html.indexOf('<h2><span data-user-text>Zulu'));
let removalButtons=[];
sortedPanel.shadowRoot.querySelectorAll=selector=>{
 if(selector==='[data-field]')return [{dataset:{field:'room0.name'},type:'text',value:'Zulu edited'}];
 if(selector==='[data-remove]')return removalButtons=[...sortedPanel.shadowRoot.innerHTML.matchAll(/data-remove="(\d+)"/g)].map(m=>({dataset:{remove:m[1]}}));
 return [];
};
sortedPanel.render();context.confirm=()=>false;removalButtons.find(b=>b.dataset.remove==='2').onclick();
assert.equal(sortedPanel.settings.rooms.length,4);
context.confirm=()=>true;removalButtons.find(b=>b.dataset.remove==='2').onclick();
assert.deepEqual(sortedPanel.settings.rooms.map(r=>r.id),['z','b','new']);
assert.equal(sortedPanel.settings.rooms[0].name,'Zulu edited');
console.log('Alphabetical room tests passed (Settings, Plan, History, stable IDs, editing and removal).');

// Cancelling a learning reset must never contact the integration.
(async()=>{
 const resetPanel=new Component();resetPanel._hass={states:{}};
 resetPanel.settings={rooms:[{id:'reset-room',name:'Study'}]};
 resetPanel.info={source_fields:[],room_fields:[]};resetPanel.tab='rooms';
 let resetButton,calls=0;
 resetPanel.shadowRoot.querySelectorAll=selector=>selector==='[data-reset]'?[resetButton={dataset:{reset:'reset-room'}}]:[];
 resetPanel.call=async(type,args)=>{assert.equal(type,'reset');assert.equal(args.room_id,'reset-room');calls++;};
 resetPanel.render();
 assert.match(resetPanel.shadowRoot.innerHTML,/title="Reset learning for this room"/);
 assert.match(resetPanel.shadowRoot.innerHTML,/title="Remove room"/);
 assert.doesNotMatch(resetPanel.shadowRoot.innerHTML,/>Remove room<|>Reset learning for this room</);
 context.confirm=()=>false;await resetButton.onclick();assert.equal(calls,0);
 context.confirm=()=>true;await resetButton.onclick();assert.equal(calls,1);
 console.log('Room action tests passed (icon tooltips, cancelled deletion, confirmed/cancelled learning reset).');
})().catch(error=>{console.error(error);process.exitCode=1;});

const namePanel=new Component();namePanel._hass={states:{
 'sensor.bedroom_temperature':{entity_id:'sensor.bedroom_temperature',attributes:{device_class:'temperature',friendly_name:'Bedroom temperature'}},
 'sensor.other':{entity_id:'sensor.other',attributes:{device_class:'temperature',friendly_name:'Bedroom temperature'}},
 'sensor.humidity':{entity_id:'sensor.humidity',attributes:{device_class:'humidity',friendly_name:'Bedroom humidity'}},
}};
const friendlyHTML=namePanel.field(['temperature_entity','Temperature','sensor',{kind:'temperature'}],{temperature_entity:'sensor.bedroom_temperature'},'room0');
assert.match(friendlyHTML,/<option data-user-text value="sensor.bedroom_temperature" selected>Bedroom temperature<\/option>/);
assert.match(friendlyHTML,/<option data-user-text value="sensor.other" >Bedroom temperature<\/option>/);
const visibleLabels=[...friendlyHTML.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map(m=>m[1]);
assert.ok(visibleLabels.every(label=>!label.includes('sensor.')&&!label.includes(' · ')));
const retainedName=namePanel.field(['temperature_entity','Temperature','sensor',{kind:'temperature'}],{temperature_entity:'sensor.humidity'},'room0');
assert.match(retainedName,/>Bedroom humidity \(does not match filter\)<\/option>/);
console.log('Friendly-name selector tests passed (selected names, distinct IDs for duplicate names, retained names).');

const groupedPanel=new Component();groupedPanel._hass={states:{}};
groupedPanel.settings={boost:1.5,setback:1,lag_hours:3,water_reference:32,price_entity:'',rooms:[]};
groupedPanel.info={source_fields:[['price_entity','Price','sensor',{kind:'price'}],['boost','Boost','number',0,5],['setback','Reduction','number',0,5],['lag_hours','Lag','number',.25,12]],room_fields:[]};
const groupedHTML=groupedPanel.settingsView();
const sharedSection=groupedHTML.match(/<section class="settings-shared"><h2>Shared room and zone settings<\/h2>[\s\S]*?<\/section>/)[0];
for(const key of ['boost','setback']){
 assert.match(sharedSection,new RegExp(`data-field="source.${key}"`));
 assert.equal(groupedHTML.split(`data-field="source.${key}"`).length-1,1);
}
assert.ok(!sharedSection.includes('source.price_entity'));assert.ok(!sharedSection.includes('source.lag_hours'));assert.match(groupedHTML.match(/<section class="settings-house">[\s\S]*?<\/section>/)[0],/source.lag_hours/);
console.log('Shared-room section tests passed (global controls grouped once, source fields separate).');

const preview=fs.readFileSync(path.join(__dirname,'../PREVIEW.html'),'utf8');
const previewInfo=JSON.parse(preview.match(/const demo=([\s\S]*?);const states=/)[1]);
const previewPanel=new Component();previewPanel._hass={states:{}};previewPanel.settings=previewInfo.settings;previewPanel.info=previewInfo;
const previewSettings=previewPanel.settingsView();
for(const field of previewInfo.source_fields){
 assert.equal(previewSettings.split(`data-field="source.${field[0]}"`).length-1,1,`${field[0]} must remain editable exactly once`);
}
assert.match(previewSettings,/<h3>Electricity price settings<\/h3>/);
assert.match(previewSettings,/<h3>Integration settings<\/h3>/);
assert.match(previewSettings,/<h3>Thermostat settings<\/h3>/);
assert.match(previewSettings,/value="hourly">hourly average<\/option>/);
assert.match(previewSettings,/value="quarterly">15 minutes<\/option>/);
assert.match(previewSettings,/value="flexible">flexible<\/option>/);
const sourcesSection=previewSettings.match(/<section class="settings-sources">[\s\S]*?<\/section>/)[0];
assert.match(sourcesSection,/source.simulation_enabled/);
assert.match(previewSettings,/Shared room and zone settings/);
assert.match(previewSettings,/source.start_offset_minutes/);assert.match(previewSettings,/source.stop_offset_minutes/);
assert.doesNotMatch(previewSettings,/standing charge|room\d+\.activity_attribute|room\d+\.active_value|room\d+\.design_room_temp/i);
for(const field of [...previewInfo.source_fields,...previewInfo.room_fields])assert.ok(!/, C$/.test(field[1]),field[1]);
assert.match(previewSettings,/Target temperature \(°C\)/);
const planHTML=previewPanel.overview();assert.match(planHTML,/Thermostat timing/);assert.match(planHTML,/Change target at/);
console.log('Version 0.9.21 preview tests passed (offset controls, simplified rooms, Celsius labels, timing table).');
for(const [value,color] of [[-5,'#40ff00'],[0,'#40ff00'],[14.99,'#40ff00'],[15,'#ccff66'],[20,'#ffff00'],[25,'#ffcc00'],[35,'#ff9933'],[50,'#ff0000'],[60,'#cc0000'],[90,'#cc0000']])assert.equal(vm.runInContext(`priceColor(${value})`,context),color);
const pricePanel=new Component();pricePanel.settings={rooms:Array.from({length:10},(_,i)=>({id:'r'+i,name:'Room '+i}))};pricePanel.clientWidth=3300;pricePanel.historyHours=48;
const priceTime=Date.now()-300000;
pricePanel.info={data:{price_chart:[{start:new Date(priceTime).toISOString(),end:new Date(priceTime+900000).toISOString(),price:-5}],rooms:{r0:{plan:{commands:[{time:new Date(priceTime).toISOString(),action:'raise'},{time:new Date(priceTime+600000).toISOString(),action:'lower'}]}}}}};
let priceHTML=pricePanel.priceChart();assert.match(priceHTML,/height:596px/);assert.match(priceHTML,/id="price-accordion" open/);assert.match(priceHTML,/Suggested heating On/);assert.doesNotMatch(priceHTML,/NaN/);pricePanel.clientWidth=1200;assert.match(pricePanel.priceChart(),/height:596px/);
pricePanel.history=[{room_id:'r0',time:priceTime/1000,price:60,suggested_heat:1,activity:1}];priceHTML=pricePanel.priceChart(true);assert.match(priceHTML,/height:776px/);assert.match(priceHTML,/Actual relay On/);assert.match(priceHTML,/#cc0000/);pricePanel.history=[{room_id:'r0',time:priceTime/1000}];assert.match(pricePanel.priceChart(true),/Total electricity price/);const savedPublished=pricePanel.info.data.price_chart;pricePanel.info.data.price_chart=[];assert.match(pricePanel.priceChart(true),/No electricity prices are available for this period/);pricePanel.info.data.price_chart=savedPublished;
console.log('Electricity chart checks passed: thresholds, negative prices, real windows, missing history, ten rooms, fixed height.');
// Size the SVG from its rendered viewport immediately and on resize.
let sizingComponent,resizeCallback,replacedHTML,disconnects=0;
const sizingContext={...context,document:{createElement:()=>{const template={innerHTML:''};template.content={querySelector:()=>({html:template.innerHTML})};return template;}},customElements:{get:()=>undefined,define:(name,value)=>sizingComponent=value},ResizeObserver:class{constructor(callback){resizeCallback=callback;}observe(){}disconnect(){disconnects++;}}};
vm.createContext(sizingContext);vm.runInContext(fs.readFileSync(path.join(__dirname,'../custom_components/thermal_pilot/frontend/panel.js'),'utf8'),sizingContext);
const sized=new sizingComponent();sized.settings=pricePanel.settings;sized.info=pricePanel.info;sized.tab='overview';
const viewport={clientWidth:3024,querySelector:()=>({replaceWith:svg=>replacedHTML=svg.html})};sized.shadowRoot.querySelector=()=>viewport;sized.mountPriceChartSizing();
assert.equal(sized.priceChartWidth,3000);assert.match(replacedHTML,/viewBox="0 0 3000 596"/);resizeCallback([{contentRect:{width:1800}}]);assert.match(replacedHTML,/viewBox="0 0 1800 596"/);resizeCallback([{contentRect:{width:0}}]);assert.equal(sized.priceChartWidth,1800);sized.mountPriceChartSizing();assert.equal(disconnects,1);
console.log('Price chart layout checks passed (immediate container measurement, resize, collapsed container, observer cleanup).');

const trend=new Component();trend.info={data:{price_chart:[{start:'2026-10-10T00:00:00Z',end:'2026-10-12T00:00:00Z'}]}};
const trendStart=Date.parse('2026-10-10T00:00:00Z')/1000;
trend.statusHistory=[{time:trendStart,outdoor:4,water:31},{time:trendStart+300,outdoor:4.5,water:32}];
const spark=trend.statusSparkline('outdoor','#2196f3');assert.match(spark,/status-sparkline/);assert.match(spark,/L300.00,/);assert.doesNotMatch(spark,/NaN/);assert.equal(trend.statusSparkline('missing','#16b957'),'');
console.log('Status temperature trends use observations within the price chart period and fill the card width.');

for(const [temperature,color] of [[-40,'#154360'],[-30,'#154360'],[-25,'#1B4F72'],[-20,'#2874A6'],[-10,'#3498DB'],[-5,'#85C1E9'],[0,'#82E0AA'],[5,'#2ECC71'],[10,'#239B56'],[20,'#186A3B'],[25,'#B7950B'],[30,'#CB4335'],[35,'#E74C3C'],[40,'#E74C3C']])assert.equal(vm.runInContext(`outdoorColor(${temperature})`,context).toLowerCase(),color.toLowerCase());
assert.match(trend.statusSparkline('outdoor','#2196f3'),/linearGradient/);assert.doesNotMatch(trend.statusSparkline('water','#16b957'),/linearGradient/);
console.log('Outdoor temperature gradient checks passed for every threshold and out-of-range readings.');

pricePanel.history=[{room_id:'r0',time:priceTime/1000,price:20,suggested_heat:1,activity:1}];
const spacedLabels=pricePanel.priceChart(true);assert.match(spacedLabels,/<foreignObject x="20"[^>]*width="190"/);assert.match(spacedLabels,/<text x="298"[^>]*>Suggested/);assert.match(spacedLabels,/text-overflow:ellipsis/);
console.log('History room names and activity labels occupy separate columns; long names retain a tooltip.');

const axisHTML=pricePanel.priceChart(true);
for(const match of axisHTML.matchAll(/>(\d+\/\d+, \d{2}:(\d{2}))<\/text>/g))assert([0,15,30,45].includes(Number(match[2])));
pricePanel.history=[];assert.match(pricePanel.priceChart(true),/Total electricity price/);
console.log('History chart uses known past source prices without old observation prices, and labels quarter-hour boundaries.');

pricePanel.history=[{room_id:'r0',time:priceTime/1000-86400,price:99,activity:1,suggested_heat:1}];
const focusedHistory=pricePanel.priceChart(true);assert.match(focusedHistory,/Selected period: 48 hours/);assert.match(focusedHistory,/99.00 c\/kWh/);assert.doesNotMatch(focusedHistory,/Price color thresholds/);assert.match(focusedHistory,/Now<\/text>/);assert.match(focusedHistory,/Total electricity price/);
console.log('History chart includes selected past days and omits the numeric color key.');

const statusPanel=new Component();statusPanel.settings={rooms:[],heating_enabled:true,water_entity:'sensor.heating_water'};statusPanel.info={data:{rooms:{},history_info:{started_at:1791590400}}};const statusOrder=statusPanel.overview();const order=['Operation','Outdoor temperature','Heating water temperature','Data collection','Stored history','Last update'];for(let i=1;i<order.length;i++)assert(statusOrder.indexOf('<dt>'+order[i-1])<statusOrder.indexOf('<dt>'+order[i]));assert.doesNotMatch(statusOrder,/toggle-active/);assert.match(statusOrder,/Collection started:/);
statusPanel.render();assert.match(statusPanel.shadowRoot.innerHTML,/role="tablist"/);assert.match(statusPanel.shadowRoot.innerHTML,/role="tabpanel"/);assert.match(statusPanel.shadowRoot.innerHTML,/aria-selected="true"/);assert.match(statusPanel.shadowRoot.innerHTML,/status-pill.active\{background:#2ecc7126/);
console.log('Tabs and status cards checks passed (accessible roles, green active badges, order, collection date, no duplicate passive button).');

assert.doesNotMatch(statusOrder,/Current outdoor reading\.|Measured heating-water temperature\.|Room observations for learning\./);
const badgePanel=new Component();badgePanel.settings={rooms:[{id:'a'},{id:'b'}],simulation_enabled:true};
badgePanel.info={data:{updated:'2026-10-11T12:00:00Z',history_info:{started_at:new Date('2026-08-01T12:00:00Z').getTime()/1000},collection_evidence:{rooms:2,heating_hours:120,idle_hours:120},source_status:{prices:true,outdoor:true,water:true}}};
assert.equal(badgePanel.collectionQuality().label,'High');
for(const [hours,label] of [[0,'Low'],[3,'Limited'],[12,'Developing'],[48,'Good'],[120,'High']]){badgePanel.info.data.collection_evidence.heating_hours=hours;assert.equal(badgePanel.collectionQuality().label,label);}
badgePanel.info.data.history_info.started_at=new Date('2026-10-11T00:00:00Z').getTime()/1000;assert.equal(badgePanel.collectionQuality().label,'Low');
assert.match(badgePanel.controlBadges(),/Sources ready/);
badgePanel.info.data.source_status.water=false;assert.match(badgePanel.controlBadges(),/Sources missing/);assert.match(badgePanel.controlBadges(),/Missing or unusable: Heating water temperature/);
badgePanel.settings.simulation_enabled=false;assert.match(badgePanel.controlBadges(),/Confirmation required/);assert.doesNotMatch(badgePanel.controlBadges(),/>Live control</);
badgePanel.settings.simulation_enabled=true;badgePanel.settings.apply_season_setpoints=true;assert.match(badgePanel.controlBadges(),/Season setpoint control/);
assert.equal(vm.runInContext("dateLabel(new Date(2026,9,11,12))",context),'11.10.2026');
assert.equal(vm.runInContext("timeLabel(new Date(2026,9,11,12,15))",context),'11.10.2026 12:15');
console.log('Collection coverage levels, source readiness, honest control modes and Finnish dates passed.');

assert.match(statusPanel.overview(),/Data coverage: Low/);

const operationBadgeView=statusPanel.overview();
assert.doesNotMatch(operationBadgeView,/<div class="status-heading">[^]*?status-badges[^]*?<dl/);
assert.match(operationBadgeView,/<dt>Operation<\/dt>[^]*?status-badges[^]*?Sources not checked[^]*?<dt>Outdoor temperature/);

const flamePanel=new Component();flamePanel.settings={rooms:[{id:'flame',name:'Room',activity_entity:'switch.relay',thermostat:'climate.room'}]};
assert.match(flamePanel.roomHeatingBadge({actual_activity:1,plan:{heat:false}},'flame'),/room-heating actual/);
assert.match(flamePanel.roomHeatingBadge({actual_activity:0,plan:{heat:true}},'flame'),/room-heating idle/);
assert.match(flamePanel.roomHeatingBadge({actual_activity:0,plan:{heat:false}},'flame'),/room-heating idle/);
assert.match(flamePanel.roomHeatingBadge({actual_activity:null},'flame'),/room-heating unknown/);
flamePanel._hass={states:{'switch.relay':{state:'off'}}};assert.match(flamePanel.roomHeatingBadge({actual_activity:1,plan:{heat:false}},'flame'),/room-heating idle/);
flamePanel._hass.states['switch.relay'].state='on';assert.match(flamePanel.roomHeatingBadge({actual_activity:0},'flame'),/Actual heating: On/);
flamePanel._hass.states['switch.relay'].state='unavailable';assert.match(flamePanel.roomHeatingBadge({actual_activity:1},'flame'),/room-heating unknown/);
flamePanel.settings.rooms[0].activity_entity='';flamePanel._hass.states['climate.room']={state:'heat',attributes:{hvac_action:'heating'}};assert.match(flamePanel.roomHeatingBadge({},'flame'),/room-heating actual/);
flamePanel.info={data:{rooms:{flame:{name:'Room',actual_activity:1}}}};flamePanel.history=[];
assert.match(flamePanel.overview(),/<summary><h2><span data-user-text>Room<\/span> [^]*?room-heating actual/);
assert.match(flamePanel.historyView(),/<summary><h2><span data-user-text>Room<\/span> [^]*?room-heating actual/);
console.log('Room-header flame checks passed: Plan/History, current demand, Off/Unknown, unavailable relay and climate fallback.');

assert.doesNotMatch(flamePanel.roomHeatingBadge({actual_activity:0,plan:{heat:true}},'flame'),/Suggested heating|suggested/);

// The menu event must escape the panel's shadow root to reach Home Assistant.
context.CustomEvent=class{constructor(type,options){this.type=type;Object.assign(this,options);}};
const mobile=new Component();let menuEvent;
mobile.dispatchEvent=event=>{menuEvent=event;};mobile.openSidebar();
assert.equal(menuEvent.type,'hass-toggle-menu');assert.equal(menuEvent.bubbles,true);assert.equal(menuEvent.composed,true);
mobile.settings=pricePanel.settings;mobile.info=pricePanel.info;mobile.history=pricePanel.history;
for(const screen of [320,390,600]){
 mobile.clientWidth=screen;mobile.priceChartWidth=Math.max(240,screen-100);
 for(const history of [false,true]){
  const html=mobile.priceChart(history),width=Number(html.match(/viewBox="0 0 (\d+)/)[1]);
  assert.equal(width,mobile.priceChartWidth);assert.doesNotMatch(html,/min-width:900px|NaN/);
  assert.equal((html.match(/<foreignObject/g)||[]).length,10);
  // Mobile names sit above their own lanes; no left column eats the chart width.
  assert.match(html,/foreignObject x="20" y="209"/);
  const firstLane=html.match(/<rect x="(\d+)" y="234" width="([\d.]+)" height="14"/);
  assert.ok(firstLane);assert.ok(Number(firstLane[1])+Number(firstLane[2])<=width);
 }
 const temperature=mobile.chart(samples,'temperature','prediction');
 const width=Number(temperature.match(/viewBox="0 0 (\d+)/)[1]);
 assert.ok(width<=screen);assert.doesNotMatch(temperature,/NaN/);
}
resizeCallback([{contentRect:{width:280}}]);assert.match(replacedHTML,/viewBox="0 0 280 836"/);
resizeCallback([{contentRect:{width:1800}}]);assert.match(replacedHTML,/viewBox="0 0 1800 596"/);
console.log('Mobile checks passed: bubbling Home Assistant menu event, ten readable room lanes, narrow temperature charts and desktop/mobile resizing.');

// History retains activity when all price data is missing, for every selected period.
const periodPanel=new Component();periodPanel.settings={rooms:[{id:'period-room',name:'Room'}]};
periodPanel.info={data:{price_chart:[],rooms:{}}};
const periodNow=Date.now();
for(const hours of [24,48,168]){
 periodPanel.historyHours=hours;
 periodPanel.history=[{room_id:'period-room',time:(periodNow-3600000)/1000,activity:1,suggested_heat:1}];
 const html=periodPanel.priceChart(true);
 assert.match(html,/No electricity prices are available for this period/);assert.match(html,/Actual relay On/);assert.match(html,/Suggested heating On/);assert.doesNotMatch(html,/NaN|Infinity/);
 const start=Number(html.match(/data-range-start="(\d+)"/)[1]),end=Number(html.match(/data-range-end="(\d+)"/)[1]);
 assert.ok(Math.abs(start-(periodNow-hours*3600000))<900000);assert.ok(Math.abs(end-periodNow)<900000);
}
periodPanel.historyHours=24;periodPanel.history=[{room_id:'period-room',time:(periodNow-48*3600000)/1000,activity:1}];
assert.doesNotMatch(periodPanel.priceChart(true),/Actual relay On/);
periodPanel.info.data.price_chart=[{start:new Date(periodNow+3600000).toISOString(),end:new Date(periodNow+7200000).toISOString(),price:77}];
assert.match(periodPanel.priceChart(true),/77.00 c\/kWh/);assert.match(periodPanel.priceChart(false),/77.00 c\/kWh/);
console.log('History period checks passed: all periods, no prices, retained activity, omitted out-of-range activity and included published future prices.');

const tomorrowEnd=new Date(periodNow);tomorrowEnd.setHours(0,0,0,0);tomorrowEnd.setDate(tomorrowEnd.getDate()+2);
periodPanel.info.data.price_chart=[{start:new Date(periodNow).toISOString(),end:tomorrowEnd.toISOString(),price:15}];
periodPanel.historyHours=24;
const todayTomorrow=periodPanel.priceChart(true);
assert.ok(Number(todayTomorrow.match(/data-range-end="(\d+)"/)[1])>=tomorrowEnd.getTime());
assert.ok(Number(todayTomorrow.match(/data-range-start="(\d+)"/)[1])<=periodNow-24*3600000);
assert.match(todayTomorrow,/today and tomorrow when prices are published/);
periodPanel.historyHours=168;
const extended=periodPanel.priceChart(true);
assert.ok(Number(extended.match(/data-range-start="(\d+)"/)[1])<=periodNow-168*3600000);
assert.ok(Number(extended.match(/data-range-end="(\d+)"/)[1])>=tomorrowEnd.getTime());
console.log('History includes the selected past period plus published today/tomorrow prices, even with 24 hours selected.');

const detailsPanel=new Component();detailsPanel.settings={rooms:[{id:'detail',name:'Study'}]};detailsPanel.historyHours=24;
detailsPanel.info={data:{price_chart:[{start:new Date(periodNow-3600000).toISOString(),end:new Date(periodNow).toISOString(),price:12.34}],rooms:{}}};
const d=periodNow/1000-1800;
detailsPanel.history=[{room_id:'detail',time:d,activity:0},{room_id:'detail',time:d+300,activity:1},{room_id:'detail',time:d+600,activity:1},{room_id:'detail',time:d+900,activity:0},{room_id:'detail',time:d+1200,activity:1}];
const detailed=detailsPanel.priceChart(true);
assert.match(detailed,/data-chart-detail="Electricity price: 12.34 c\/kWh\nStart:/);
assert.equal((detailed.match(/data-chart-detail="Study · Actual relay On/g)||[]).length,2);
assert.match(detailed,/Actual relay On\nStart: [^\n]+\nStop:/);assert.match(detailed,/Observed until:/);
const handlers={},box={hidden:true,style:{},getBoundingClientRect:()=>({width:180,height:80})};
const tooltipHost={addEventListener:(type,handler)=>handlers[type]=handler,querySelector:()=>box};
context.window={innerWidth:320,innerHeight:600};detailsPanel.bindChartDetails(tooltipHost);
const mark={dataset:{chartDetail:'Study · Actual relay On\nStart: 12.10.2026 10:00\nStop: 12.10.2026 11:00'},getBoundingClientRect:()=>({left:20,top:30,width:60})};
const ev={target:{closest:()=>mark},clientX:310,clientY:590};
handlers.pointermove(ev);assert.equal(box.hidden,false);assert.equal(box.textContent,mark.dataset.chartDetail);assert.equal(box.style.left,'132px');assert.equal(box.style.top,'512px');
handlers.keydown({key:'Escape'});assert.equal(box.hidden,true);
handlers.click(ev);assert.equal(box.hidden,false);handlers.click(ev);assert.equal(box.hidden,true);
handlers.focusin({target:ev.target});assert.equal(box.hidden,false);handlers.focusout({});assert.equal(box.hidden,true);
console.log('Chart detail checks passed: price intervals, grouped heating periods, observed boundaries, hover/focus/tap, dismissal and phone-safe positioning.');

const accuracyPanel=new Component();
const accuracyRows=[{time:10000,temperature:21,forecast_3h:20.5,forecast_3h_details:{issued:-800,due:10000,error:.5,persistence_error:1,heating_match:1}}];
let accuracyHTML=accuracyPanel.forecastHistoryView(accuracyRows);
assert.match(accuracyHTML,/Saved 3-hour forecast/);assert.match(accuracyHTML,/Mean error: <b>0.50 °C/);assert.match(accuracyHTML,/No-change error: 1.00 °C/);assert.match(accuracyHTML,/1 comparisons · 1 with similar heating/);
assert.doesNotMatch(accuracyHTML,/Model prediction using actual heating|No completed 3-hour forecasts/);
accuracyPanel.forecastHours=6;accuracyHTML=accuracyPanel.forecastHistoryView(accuracyRows);assert.match(accuracyHTML,/No completed 6-hour forecasts/);
console.log('Saved forecast UI checks passed: fixed horizons, completed comparisons, no-change benchmark and honest missing-data state.');

const dirtyPanel=new Component();dirtyPanel.tab='settings';dirtyPanel.settings={heating_enabled:true,rooms:[{id:'a',baseline:20}]};dirtyPanel.info={settings:structuredClone(dirtyPanel.settings)};
assert.equal(dirtyPanel.hasUnsavedSettings(),false);
dirtyPanel.settings.heating_enabled=false;assert.equal(dirtyPanel.hasUnsavedSettings(),true);
dirtyPanel.settings.heating_enabled=true;assert.equal(dirtyPanel.hasUnsavedSettings(),false);
dirtyPanel.settings.rooms[0].baseline=20.5;assert.equal(dirtyPanel.hasUnsavedSettings(),true);
let switched=0;dirtyPanel.capture=()=>{};dirtyPanel.load=()=>switched++;context.confirm=()=>false;
dirtyPanel.switchTab('history');assert.equal(dirtyPanel.tab,'settings');assert.equal(switched,0);assert.equal(dirtyPanel.settings.rooms[0].baseline,20.5);
context.confirm=()=>true;dirtyPanel.switchTab('history');assert.equal(switched,1);
dirtyPanel.info.settings=structuredClone(dirtyPanel.settings);assert.equal(dirtyPanel.hasUnsavedSettings(),false);
dirtyPanel.settings.rooms.push({id:'b',baseline:19.5});assert.equal(dirtyPanel.hasUnsavedSettings(),true);
console.log('Unsaved settings checks passed: edits, toggles, undo, saved baseline, room additions and cancel/confirm tab navigation.');

const retentionPanel=new Component();retentionPanel.info={data:{rooms:{fast:{name:'Fast cooling',heat_retention:{drop_6h:2,hours_per_degree:3,heating_hours:20,idle_hours:30,updated:true}},slow:{name:'Slow <cooling>',heat_retention:{drop_6h:.7,hours_per_degree:8,heating_hours:0,idle_hours:3,updated:false}}}}};
let retentionHTML=retentionPanel.heatRetentionView();
assert.ok(retentionHTML.indexOf('Slow &lt;cooling&gt;')<retentionHTML.indexOf('Fast cooling'));
assert.match(retentionHTML,/0.70 °C/);assert.match(retentionHTML,/8.0 hours/);assert.match(retentionHTML,/Initial estimate/);assert.match(retentionHTML,/Adapting/);assert.match(retentionHTML,/not measured energy efficiency/);
assert.match(retentionHTML,/id="retention-accordion" open/);retentionPanel.retentionOpen=false;assert.doesNotMatch(retentionPanel.heatRetentionView(),/id="retention-accordion" open/);
retentionPanel.info.data.rooms.garageZ={name:'Garage Z',is_garage:true,heat_retention:{drop_6h:.1,hours_per_degree:10,updated:false}};
retentionPanel.info.data.rooms.garageA={name:'Garage A',heat_retention:{drop_6h:4,hours_per_degree:1,updated:false}};
retentionPanel.settings={rooms:[{id:'garageA',is_garage:true}]};
retentionHTML=retentionPanel.heatRetentionView();
assert.ok(retentionHTML.indexOf('Fast cooling')<retentionHTML.indexOf('Garage A'));
assert.ok(retentionHTML.indexOf('Garage A')<retentionHTML.indexOf('Garage Z'));
assert.equal((retentionHTML.match(/class="garage-retention-row"/g)||[]).length,2);
console.log('Room retention UI checks passed: common reference, slower-first sorting, escaped names, data labels and accordion state.');

const windMatches=vm.runInContext('entityMatches',context);
assert.equal(windMatches({entity_id:'sensor.netatmo_tuuli_ms',attributes:{unit_of_measurement:'m/s'}},{kind:'wind'}),true);
assert.equal(windMatches({entity_id:'sensor.temperature',attributes:{unit_of_measurement:'°C'}},{kind:'wind'}),false);
const weatherFields=vm.runInContext('sourceSettingGroups',context).find(group=>group[0]==='Weather and forecast settings')[1];
assert.ok(weatherFields.includes('wind_entity'));
assert.match(vm.runInContext('settingHelp.wind_entity',context),/planning and heating continue/);
console.log('Optional wind settings checks passed: m\/s selector, weather group and fallback help.');

const messageLevel=vm.runInContext('statusMessageLevel',context),notice=vm.runInContext('statusNotice',context);
assert.equal(messageLevel('ThermalPilot is passive. Planning, collection and learning are stopped.'),'info');
assert.equal(messageLevel('Optional wind sensor unavailable or stale; heating continues.'),'warning');
assert.equal(messageLevel('Thermostat control: Winter fallback targets are being used because required data is unavailable.'),'warning');
assert.equal(messageLevel('Thermostat control: Study: applying target failed; will retry.'),'error');
assert.match(notice('Save failed <retry>','error','message'),/notice-error message" role="alert"/);
assert.match(notice('Save failed <retry>','error'),/&lt;retry&gt;/);
console.log('Status-level checks passed: passive information, optional-source and fallback warnings, command errors and escaped alerts.');

const messageIcon=vm.runInContext('statusIcon',context);
for(const level of ['error','warning','info']){
 assert.match(notice('Example',level),/class="notice-icon"/);
 assert.match(messageIcon(level),/aria-hidden="true"/);
 assert.ok(messageIcon(level).includes(level[0].toUpperCase()+level.slice(1)+': '));
}
assert.notEqual(messageIcon('error'),messageIcon('info'));
assert.notEqual(messageIcon('warning'),messageIcon('error'));
console.log('Message icons passed: distinct error/warning/info shapes, decorative SVG and accessible level labels.');

const duration=vm.runInContext('durationLabel',context);
assert.equal(duration(10*3600000+60000),'10 h 1 min');
assert.equal(duration(3600000),'1 h');assert.equal(duration(15*60000),'15 min');
assert.equal(duration(10000),'Less than 1 min');
assert.match(detailed,/Observed duration: 10 min/);
detailsPanel.info.data.rooms.detail={plan:{commands:[{time:new Date(periodNow-300000).toISOString(),action:'raise'},{time:new Date(periodNow+3600000).toISOString(),action:'restore'}]}};
assert.match(detailsPanel.priceChart(false),/Duration: 1 h 5 min/);
assert.match(detailsPanel.priceChart(true),/Suggested heating On[^"]*Duration:/);
console.log('Heating duration checks passed: grouped observed periods and planned windows on both charts, hours/minutes and short intervals.');

const solarField=panel.field(['solar_direction','Window direction','select:disabled,north,northeast,east,southeast,south,southwest,west,northwest'],{solar_direction:'south'},'room0');
assert.doesNotMatch(solarField,/setting-toggle/);assert.match(solarField,/value="south"/);
assert.match(solarField,/No additional physical solar heating system is needed/);
assert.match(solarField,/south-facing windows/);
const exposureField=['solar_exposure','Sun exposure','select:clear,partly_shaded,mostly_shaded'];
assert.match(panel.field(exposureField,{solar_direction:'disabled',solar_exposure:'clear'},'room0'),/data-solar-exposure hidden/);
assert.doesNotMatch(panel.field(exposureField,{solar_direction:'south',solar_exposure:'clear'},'room0'),/data-solar-exposure hidden/);
assert.match(panel.field(exposureField,{solar_direction:'south'},'room0'),/Partly shaded/);
console.log('Solar settings checks passed: Disabled and eight directions, conditional exposure, readable options and ordinary-sunlight tooltip.');

detailsPanel.statusHistory=detailsPanel.history;
const planWithActual=detailsPanel.priceChart(false);
assert.match(planWithActual,/data-chart-detail="Study · Actual relay On/);
assert.match(planWithActual,/Observed duration: 10 min/);
assert.match(planWithActual,/fill="#e49025"/);
assert.match(planWithActual,/Actual thermostat relay/);
assert.match(planWithActual,/Suggested heating On/);
detailsPanel.statusHistory=[{room_id:'detail',time:periodNow/1000+3600,activity:1}];
assert.doesNotMatch(detailsPanel.priceChart(false),/data-chart-detail="Study · Actual relay On/);
console.log('Plan relay history checks passed: observed amber periods, duration tooltips, future teal suggestions and no future relay history.');

const isWater=vm.runInContext('waterDistribution',context);
for(const distribution of ['electric_floor','electric_ceiling','electric_panels','warm_air'])assert.equal(isWater({house_distribution:distribution}),false);
for(const distribution of ['water_floor','water_radiators','mixed','other'])assert.equal(isWater({house_distribution:distribution}),true);
const houseSettings=previewPanel.settingsView();
assert.ok(houseSettings.indexOf('settings-sources')<houseSettings.indexOf('settings-house'));
assert.ok(houseSettings.indexOf('settings-house')<houseSettings.indexOf('settings-shared'));
previewPanel.settings.house_distribution='electric_floor';
assert.match(previewPanel.settingsView(),/data-water-group hidden/);
previewPanel.settings.house_distribution='water_floor';
assert.doesNotMatch(previewPanel.settingsView(),/data-water-group hidden/);
console.log('House settings checks passed: card order, moved controls, conditional water groups and distribution classification.');

const translate=vm.runInContext('translateText',context);
assert.equal(translate('Settings','fi'),'Asetukset');assert.equal(translate('Settings','en'),'Settings');
assert.equal(translate('Price forecast available · No extra heat storage needed.','fi'),'Hintaennuste saatavilla · Lisälämmön varastointia ei tarvita.');
assert.equal(translate('Remove room "South"? Save settings to apply this change.','fi'),'Poistetaanko huone "South"? Muutos tulee voimaan tallentamalla asetukset.');
const fiPanel=new Component();fiPanel.settings={language:'fi'};
assert.ok(fiPanel.tDetails('South · Actual relay On\nObserved duration: 2 h').startsWith('South · Todellinen reletila Päällä'));
const languageHTML=fiPanel.field(['language','Language','select:en,fi'],{language:'en'},'source');
assert.match(languageHTML,/class="language-flag"/);assert.match(languageHTML,/data-language="en"/);assert.match(languageHTML,/data-language="fi"/);assert.match(languageHTML,/type="hidden" data-field="source.language" value="en"/);assert.doesNotMatch(languageHTML,/🇬🇧|🇫🇮/);
const savedDocument=context.document;
const nodes=[{nodeValue:'Save settings',parentElement:{closest:()=>null}},{nodeValue:'South',parentElement:{closest:()=>true}},{nodeValue:'body{}',parentElement:{closest:()=>true}}];let nodeIndex=0;
context.document={createTreeWalker:()=>({nextNode:()=>nodes[nodeIndex++]||null})};
fiPanel.translateRoot({querySelectorAll:()=>[]});context.document=savedDocument;
assert.equal(nodes[0].nodeValue,'Tallenna asetukset');assert.equal(nodes[1].nodeValue,'South');assert.equal(nodes[2].nodeValue,'body{}');
console.log('Finnish language checks passed: default labels/flags, translation, preserved user names, CSS exclusion and unchanged English.');

const electricityMode=vm.runInContext('electricHeating',context);
assert.equal(electricityMode({house_heat_source:'gas_boiler'}),false);
assert.equal(electricityMode({house_heat_source:'air_to_water'}),true);
const originalPreviewRooms=previewPanel.settings.rooms,originalPreviewZones=previewPanel.settings.heating_zones;
previewPanel.settings.heating_zones=[];
previewPanel.settings.rooms=originalPreviewRooms.filter(room=>!room.is_garage&&room.heat_control!=='air_to_air');
previewPanel.settings.house_heat_source='gas_boiler';
assert.match(previewPanel.settingsView(),/data-electric-group hidden/);
assert.doesNotMatch(previewPanel.overview(),/class="price-card"/);
assert.match(previewPanel.controlBadges(),/Comfort planning/);
previewPanel.settings.rooms=originalPreviewRooms;previewPanel.settings.heating_zones=originalPreviewZones;
assert.equal(electricityMode(previewPanel.settings),true,'An electric garage remains supported beside a non-electric house');
previewPanel.settings.house_heat_source='air_to_water';
console.log('Non-electric UI checks passed: optional hidden prices, comfort-mode label and no scheduling chart.');

const flagSVG=vm.runInContext('languageFlag',context);
assert.match(flagSVG('fi'),/viewBox="0 0 18 11"/);assert.match(flagSVG('fi'),/#003580/);
assert.match(flagSVG('en'),/viewBox="0 0 60 30"/);assert.match(flagSVG('en'),/#012169/);
const pickerPanel=new Component();const pickerHandlers={},triggerHandlers={},optionHandlers=[{},{}];let focused='',changed=false;
const trigger={setAttribute:(key,value)=>trigger[key]=value,addEventListener:(key,fn)=>triggerHandlers[key]=fn,focus:()=>focused='trigger'};
const options=['en','fi'].map((code,index)=>({dataset:{language:code},addEventListener:(key,fn)=>optionHandlers[index][key]=fn,focus:()=>focused=code}));
const field={value:'en',dispatchEvent:()=>changed=true};
const list={hidden:true,querySelectorAll:()=>options};
const picker={querySelector:key=>key==='.language-trigger'?trigger:key==='.language-options'?list:field,addEventListener:(key,fn)=>pickerHandlers[key]=fn,contains:()=>false};
pickerPanel.shadowRoot.querySelector=key=>key==='.language-picker'?picker:key==='.language-trigger'?trigger:null;
context.Event=class{constructor(type,options){this.type=type;this.bubbles=options.bubbles;}};
pickerPanel.mountLanguagePicker();const prevented={preventDefault:()=>{}};
triggerHandlers.click(prevented);assert.equal(list.hidden,false);assert.equal(trigger['aria-expanded'],'true');assert.equal(focused,'en');
optionHandlers[0].keydown({key:'ArrowDown',preventDefault:()=>{}});assert.equal(focused,'fi');
optionHandlers[1].click(prevented);assert.equal(field.value,'fi');assert.equal(changed,true);assert.equal(list.hidden,true);assert.equal(focused,'trigger');
triggerHandlers.click(prevented);optionHandlers[1].keydown({key:'Escape',preventDefault:()=>{}});assert.equal(list.hidden,true);
console.log('SVG language picker checks passed: flag artwork, no emoji dependency, selection, change event, keyboard arrows and Escape.');

assert.equal(translate('About 116 more days to the initial thresholds at recent observation rates.','fi'),'Alkutietojen vähimmäismäärät saavutetaan arviolta 116 päivän kuluttua nykyisellä havaintotahdilla.');
assert.equal(translate('About less than 1 more day to the initial thresholds at recent observation rates.','fi'),'Alkutietojen vähimmäismäärät saavutetaan arviolta alle päivässä nykyisellä havaintotahdilla.');
assert.equal(translate('26 comparisons · 25 with similar heating','fi'),'26 vertailua · 25 vastaavalla lämmityksellä');
assert.equal(translate('Similar heating error: 0.05 °C','fi'),'Vastaavan lämmityksen virhe: 0.05 °C');
assert.equal(translate('No-change error: 0.03 °C','fi'),'Muuttumattoman lämpötilan virhe: 0.03 °C');
console.log('Room Finnish regression checks passed: dynamic learning ETA, comparison counts and accuracy descriptions.');

const initialBadgePanel=new Component();
assert.match(initialBadgePanel.learningBadge({model:{heated_hours:12,idle_hours:12}}),/Forecast data pending/);
assert.match(initialBadgePanel.learningBadge({model:{heated_hours:0,idle_hours:12}}),/50% initial data/);
assert.match(initialBadgePanel.learningBadge({learning_progress:{percent:100}}),/Forecast data pending/);
console.log('Initial collection badge checks passed: progress shown before completion and removed at 100 percent.');

const forecastBadgeRoom={learning_progress:{percent:100},forecast_accuracy:{'3':{count:30,mae:.1,persistence_mae:.03,similar_heating_mae:.12,similar_heating_count:20}}};
assert.match(initialBadgePanel.learningBadge(forecastBadgeRoom),/Forecast: Okay · 0.10 °C/);
assert.match(initialBadgePanel.learningBadge(forecastBadgeRoom),/30 comparisons/);
assert.match(initialBadgePanel.learningBadge(forecastBadgeRoom),/No-change benchmark: 0.03 °C/);
assert.match(initialBadgePanel.learningBadge(forecastBadgeRoom),/not a live-control readiness guarantee/);
assert.doesNotMatch(initialBadgePanel.learningBadge(forecastBadgeRoom),/100% initial data/);
initialBadgePanel.settings={language:'fi'};
assert.match(initialBadgePanel.learningBadge(forecastBadgeRoom),/Ennuste: Kohtalainen · 0,10 °C/);
initialBadgePanel.settings.house_heat_source='gas_boiler';assert.equal(initialBadgePanel.learningBadge(forecastBadgeRoom),'');
console.log('Completed collection forecast badges passed: measured MAE, evidence context, benchmark, Finnish and no readiness claim.');

const rateForecast=vm.runInContext('forecastRating',context);
for(const [mae,level] of [[.19,4],[.3,3],[.5,2],[.8,1],[1.2,0]])assert.equal(rateForecast({mae,count:30,persistence_mae:2}).level,level);
assert.equal(rateForecast({mae:.19,count:10,persistence_mae:1}).level,null);
assert.equal(rateForecast({mae:.19,count:30,persistence_mae:.03}).level,2);
assert.equal(rateForecast({mae:.19,count:30}).level,2);
assert.equal(rateForecast({mae:-1,count:30}).level,null);
initialBadgePanel.settings={language:'en'};
assert.match(initialBadgePanel.learningBadge(forecastBadgeRoom),/quality-2/);
assert.match(initialBadgePanel.learningBadge(forecastBadgeRoom),/not an integration fault/);
console.log('Forecast rating checks passed: five deviation levels, evidence minimum, benchmark guard and honest missing data.');

const fireplaceOptions=vm.runInContext('fireplaceStateOptions',context);
const damper={entity_id:'binary_sensor.damper',state:'on',attributes:{device_class:'opening'}};
assert.equal(JSON.stringify(fireplaceOptions(damper,'on')),JSON.stringify([{value:'on',label:'Open'},{value:'off',label:'Closed'}]));
const enumStates=fireplaceOptions({entity_id:'sensor.fire',state:'burning',attributes:{options:['idle','burning']}},'burning');
assert.equal(JSON.stringify(enumStates.map(option=>option.value)),JSON.stringify(['idle','burning']));
const damperPanel=new Component();damperPanel._hass={states:{'binary_sensor.damper':damper}};
const stateField=damperPanel.field(['fireplace_active_state','Fireplace active when','text'],{fireplace_entity:'binary_sensor.damper',fireplace_active_state:'on'},'source');
assert.match(stateField,/<select data-field="source.fireplace_active_state">/);assert.match(stateField,/value="on" selected>Open/);assert.match(stateField,/value="off" >Closed/);
assert.doesNotMatch(stateField,/<input data-field="source.fireplace_active_state"/);
console.log('Fireplace state selector checks passed: Open/Closed map to on/off, enum sensor options and no free-text entry.');

const currentFireplace=vm.runInContext('fireplaceCurrentState',context);
assert.equal(currentFireplace(damper),'Open');
assert.equal(currentFireplace({...damper,state:'off'}),'Closed');
assert.equal(currentFireplace({...damper,state:'unknown'}),'Unknown');assert.equal(currentFireplace(null),'Unavailable');
assert.match(damperPanel.field(['fireplace_active_state','Fireplace active when','text'],{fireplace_entity:'binary_sensor.damper',fireplace_active_state:'off'},'source'),/Current state: Open/);
const hint={textContent:''};damperPanel.settings={language:'fi',fireplace_entity:'binary_sensor.damper'};
damperPanel.shadowRoot.querySelector=selector=>selector==='[data-current-fireplace]'?hint:selector==='[data-field="source.fireplace_entity"]'?{value:'binary_sensor.damper'}:null;
damperPanel.updateFireplaceReading();assert.equal(hint.textContent,'Nykyinen tila: Auki');
damperPanel._hass.states['binary_sensor.damper'].state='off';damperPanel.updateFireplaceReading();assert.equal(hint.textContent,'Nykyinen tila: Kiinni');
assert.equal(damperPanel.settings.fireplace_active_state,undefined);
console.log('Current fireplace state checks passed: contact labels, unknown/missing data, Finnish and updates without changing settings.');

const reading=vm.runInContext('sourceReading',context);
assert.equal(reading('price_entity','sensor.price',{state:'0',attributes:{unit_of_measurement:'c/kWh'}}),'0 c/kWh');
assert.equal(reading('wind_entity','sensor.wind',{state:'4.2',attributes:{unit_of_measurement:'m/s'}}),'4.2 m/s');
assert.equal(reading('water_entity','climate.water',{state:'heat',attributes:{temperature:40,current_temperature:31}}),'31 °C');
assert.equal(reading('water_entity','climate.water',{state:'heat',attributes:{temperature:40}}),'No temperature reading');
assert.equal(reading('weather_entity','weather.home',{state:'cloudy',attributes:{temperature:5,temperature_unit:'°C'}}),'Cloudy · 5 °C');
assert.equal(reading('outdoor_entity','sensor.out',null),'Unavailable');assert.equal(reading('outdoor_entity','',null),'Not selected');
const readingPanel=new Component();readingPanel.settings={language:'fi'};readingPanel._hass={states:{'sensor.unsaved':{state:'7',attributes:{unit_of_measurement:'°C'}}}};
const readingHint={dataset:{sourceReading:'outdoor_entity'},textContent:''};
readingPanel.shadowRoot.querySelectorAll=()=>[readingHint];readingPanel.shadowRoot.querySelector=()=>({value:'sensor.unsaved'});
readingPanel.updateSourceReadings();assert.equal(readingHint.textContent,'Nykyinen tila: 7 °C');
assert.equal(readingPanel.settings.outdoor_entity,undefined);
assert.match(previewPanel.field(['outdoor_entity','Outdoor temperature','sensor',{kind:'temperature'}],{outdoor_entity:''},'source'),/data-source-reading="outdoor_entity"/);
console.log('Selected-source reading checks passed: units, zero values, measured climate water, weather, missing data and unsaved selection updates.');

const headerPanel=new Component();headerPanel.settings={simulation_enabled:true,heating_enabled:true};
assert.match(headerPanel.headerStatus(),/header-simulation/);assert.match(headerPanel.headerStatus(),/>Simulation</);
headerPanel.settings.simulation_enabled=false;assert.match(headerPanel.headerStatus(),/header-paused/);
headerPanel.settings.live_control_confirmed=true;assert.match(headerPanel.headerStatus(),/header-live/);
headerPanel.settings.heating_enabled=false;assert.match(headerPanel.headerStatus(),/Live control paused/);assert.doesNotMatch(headerPanel.headerStatus(),/header-live/);
headerPanel.settings={language:'fi',simulation_enabled:true};assert.match(headerPanel.headerStatus(),/>Simulointi</);assert.doesNotMatch(headerPanel.headerStatus(),/SIMULOINTI/);
console.log('Header control badge checks passed: simulation red, confirmed live green, paused/unconfirmed distinct and Finnish normal case.');

// Each selectable language must cover the same interface catalog and preserve dynamic values.
const allLanguages=vm.runInContext('languageNames',context),catalogs=vm.runInContext('languageText',context),fiKeys=vm.runInContext('Object.keys(finnishText)',context);
assert.equal(Object.keys(allLanguages).length,25);
for(const [code,catalog] of Object.entries(catalogs)){
 for(const key of fiKeys)assert.ok(catalog[key],`${code}: missing ${key}`);
 const translated=translate('Settings',code);assert.notEqual(translated,'Settings');
 const langPanel=new Component();langPanel.settings={language:code,simulation_enabled:true,rooms:[]};
 assert.match(langPanel.headerStatus(),new RegExp(catalog['Simulation']));
 assert.ok(langPanel.headerStatus().includes(catalog['Simulation is active. ThermalPilot does not control heating.']));
 const selector=langPanel.field(['language','Language','select:en,fi'],{language:code},'source');
 assert.ok(selector.includes(`value="${code}"`));
 for(const candidate of Object.keys(allLanguages))assert.ok(selector.includes(`data-language="${candidate}"`));
 assert.match(flagSVG(code),/viewBox="0 0 24 16"/);assert.doesNotMatch(flagSVG(code),/#012169/);
 const eta=translate('About 116 more days to the initial thresholds at recent observation rates.',code);
 assert.ok(eta.includes('116'));assert.doesNotMatch(eta,/more days|initial thresholds/);
 const counts=translate('26 comparisons · 25 with similar heating',code);
 assert.ok(counts.includes('26'));assert.ok(counts.includes('25'));assert.doesNotMatch(counts,/comparisons|with similar heating/);
 const removal=translate('Remove room "South <test>"? Save settings to apply this change.',code);
 assert.ok(removal.includes('South <test>'));assert.doesNotMatch(removal,/Save settings/);
 // Parentheses in source text must be literal, and replacements must be single-pass.
 assert.ok(translate('Target (°C): 20',code).includes(catalog['Target (°C)']));
 langPanel._hass={locale:{language:'en'},localize:()=> 'Off'};
 assert.equal(langPanel.historyCardHass().locale.language,code);
 assert.equal(langPanel.historyCardHass().localize('off'),catalog.Off);assert.equal(langPanel._hass.locale.language,'en');
}
console.log('All 25 language options passed: catalog coverage, SVG flags, selection, parameterized room messages and isolated HA history locale.');

const planImage=fs.readFileSync(path.join(__dirname,'../custom_components/thermal_pilot/frontend/rooms-floor-plan.png'));
assert.equal(planImage.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
assert.equal(vm.runInContext('roomFloorPlanAsset',context),'/thermal_pilot/rooms-floor-plan.png');
const assetDeclaration=fs.readFileSync(path.join(__dirname,'../custom_components/thermal_pilot/frontend/panel.js'),'utf8').match(/const roomFloorPlanAsset=.*?;/)[0];
assert.equal(vm.runInNewContext(assetDeclaration+'roomFloorPlanAsset',{location:{pathname:'/preview/PREVIEW.html'}}),'./custom_components/thermal_pilot/frontend/rooms-floor-plan.png');
console.log('Bundled floor-plan image passed: PNG asset, Home Assistant URL and local-preview URL.');

const languageOrderPanel=new Component();languageOrderPanel.settings={language:'en'};
const languageOrderHTML=languageOrderPanel.field(['language','Language','select:en,fi'],{language:'en'},'source');
const shownLanguages=[...languageOrderHTML.matchAll(/data-language="([^"]+)"/g)].map(match=>match[1]);
const alphabeticalLanguages=Object.keys(allLanguages).sort((a,b)=>allLanguages[a].localeCompare(allLanguages[b],'en',{sensitivity:'base'}));
assert.deepEqual(shownLanguages,alphabeticalLanguages);
console.log('Language picker alphabetical ordering passed for all displayed names.');

const scrollPanel=new Component();let accordionClick,frames=[],scrollCalls=[];
const scrollSummary={addEventListener:(name,handler)=>{if(name==='click')accordionClick=handler;}};
let accordionBounds={bottom:1000,height:900};
const scrollDetails={open:false,isConnected:true,querySelector:()=>scrollSummary,getBoundingClientRect:()=>accordionBounds,scrollIntoView:options=>scrollCalls.push(options)};
scrollPanel.shadowRoot.querySelectorAll=()=>[scrollDetails];
context.innerHeight=700;context.requestAnimationFrame=callback=>frames.push(callback);context.matchMedia=()=>({matches:false});
scrollPanel.mountAccordionScrolling();assert.equal(scrollCalls.length,0);
accordionClick({defaultPrevented:false});scrollDetails.open=true;frames.shift()();
assert.equal(scrollCalls.length,1);assert.equal(scrollCalls[0].behavior,'smooth');assert.equal(scrollCalls[0].block,'start');
accordionBounds={bottom:800,height:200};accordionClick({defaultPrevented:false});frames.shift()();assert.equal(scrollCalls[1].block,'nearest');
accordionBounds={bottom:500,height:200};accordionClick({defaultPrevented:false});frames.shift()();assert.equal(scrollCalls.length,2);
scrollDetails.open=false;accordionClick({defaultPrevented:false});frames.shift()();assert.equal(scrollCalls.length,2);
scrollDetails.open=true;accordionBounds={bottom:800,height:200};context.matchMedia=()=>({matches:true});accordionClick({defaultPrevented:false});frames.shift()();assert.equal(scrollCalls[2].behavior,'instant');
accordionClick({defaultPrevented:true});assert.equal(frames.length,0);
console.log('Accordion scrolling passed: opening below viewport, visible content unchanged, closing/restoration unchanged and reduced motion respected.');

const zonePanel=new Component();zonePanel._hass={states:{'climate.pump':{entity_id:'climate.pump',state:'fan_only',attributes:{fan_modes:['low','medium','high'],swing_modes:['off','vertical','both']}},'climate.other':{entity_id:'climate.other',state:'heat',attributes:{fan_modes:['low','high'],swing_modes:['off']}}}};
zonePanel.settings={rooms:[{id:'g',name:'Garage',thermostat:'climate.pump',is_garage:true,garage_minimum:5,garage_maximum:9,garage_swing:'both'},{id:'room',name:'Room',thermostat:'climate.pump',heat_control:'air_to_air',heating_zone_id:'zone'}],heating_zones:[{id:'zone',name:'House pump',thermostat:'climate.pump',source_type:'air_to_air',main_room_id:'room',temperature_policy:'average'}],air_swing:''};
zonePanel.info={source_fields:[['air_swing','Heating swing mode','text']],room_fields:[['name','Room name','text'],['is_garage','Garage','bool'],['heating_zone_id','Heating zone (optional)','text'],['thermostat','Thermostat','climate'],['baseline','Target temperature (°C)','number',5,30],['garage_minimum','Garage lower temperature limit (°C)','number',-5,25],['garage_maximum','Garage upper temperature limit (°C)','number',-5,30],['garage_swing','Garage heating swing mode','text']],zone_fields:[['name','Zone name','text'],['thermostat','Zone heat pump','climate'],['main_room_id','Main room','text'],['temperature_policy','Heating zone temperature','select:main,average,coldest']],data:{rooms:{}}};
const zoneHTML=zonePanel.settingsView();
assert.match(zoneHTML,/<h2>Heating zones<\/h2>/);assert.match(zoneHTML,/data-field="zone0.main_room_id"/);assert.match(zoneHTML,/data-field="room0.garage_minimum"/);assert.doesNotMatch(zoneHTML,/data-field="room0.baseline"/);assert.doesNotMatch(zoneHTML,/data-field="room1.garage_minimum"/);assert.match(zoneHTML,/data-field="room1.thermostat"/);
assert.match(zoneHTML,/5–9 °C/);
const swingHTML=zonePanel.field(['garage_swing','Garage heating swing mode','text'],zonePanel.settings.rooms[0],'room0');
assert.match(swingHTML,/<select/);assert.match(swingHTML,/value="vertical"/);assert.match(swingHTML,/value="both" selected/);assert.match(swingHTML,/Leave unchanged/);assert.doesNotMatch(swingHTML,/<input/);
zonePanel.settings.rooms.push({id:'other',thermostat:'climate.other',heat_control:'air_to_air'});
const commonSwing=zonePanel.field(['air_swing','Heating swing mode','text'],zonePanel.settings,'source');assert.match(commonSwing,/value="off"/);assert.doesNotMatch(commonSwing,/value="vertical"/);
const policyHTML=zonePanel.field(['temperature_policy','Heating zone temperature','select:main,average,coldest'],zonePanel.settings.heating_zones[0],'zone0');
for(const label of ['Main room sensor','Average of room sensors','Coldest room sensor'])assert.ok(policyHTML.includes(label));
zonePanel.settings.language='fi';assert.equal(zonePanel.t('Heating zones'),'Lämmitysvyöhykkeet');assert.equal(zonePanel.t('Garage heating strategy'),'Autotallin lämmitystapa');assert.equal(zonePanel.t('Fan only'),'Vain puhallus');
console.log('Garage/zone UI passed: conditional limits, linked room controllers, capability-derived swing selections, shared capability intersection, three temperature policies and Finnish labels.');

zonePanel.settings.rooms[0].garage_door_entities=Array.from({length:5},(_,i)=>`binary_sensor.door_${i}`);
for(const id of zonePanel.settings.rooms[0].garage_door_entities)zonePanel._hass.states[id]={entity_id:id,state:'off',attributes:{friendly_name:id}};
const listHTML=zonePanel.field(['garage_door_entities','Garage door sensors (optional)','entities:binary_sensor'],zonePanel.settings.rooms[0],'room0');
assert.equal((listHTML.match(/data-entity-item/g)||[]).length,5);assert.equal((listHTML.match(/data-remove-sensor=/g)||[]).length,5);assert.match(listHTML,/data-add-sensor/);assert.match(listHTML,/One shared timer/);
const originalQuery=zonePanel.shadowRoot.querySelectorAll;
const fakeList={dataset:{entityList:'room0.garage_door_entities'},querySelectorAll:()=>[{value:'binary_sensor.door_0'},{value:''},{value:'binary_sensor.door_4'}]};
zonePanel.shadowRoot.querySelectorAll=selector=>selector==='[data-entity-list]'?[fakeList]:[];
zonePanel.capture(true);assert.equal(zonePanel.settings.rooms[0].garage_door_entities.length,3);
zonePanel.capture();assert.deepEqual([...zonePanel.settings.rooms[0].garage_door_entities],['binary_sensor.door_0','binary_sensor.door_4']);
zonePanel.shadowRoot.querySelectorAll=originalQuery;
zonePanel.info.room_fields.push(['fireplace_reduction','Fireplace heating compensation','number',-100,0]);
assert.doesNotMatch(zonePanel.settingsView(),/data-field="room0.fireplace_reduction"/);
assert.match(zonePanel.settingsView(),/data-field="room1.fireplace_reduction"/);
const sharedGroups=vm.runInContext('sharedSettingGroups.map(group=>group[0])',context);assert.equal(sharedGroups[0],'Thermostat settings');assert.equal(sharedGroups[1],'Air-to-air heat pump settings');
console.log('Dynamic garage sensor lists passed: five choices, add/remove controls, capture, shared-timer tooltip, hidden fireplace compensation and shared settings order.');
zonePanel.settings.language='en';zonePanel.info.data.rooms={g:{name:'Garage',air_control:true,pump_control:{confirmed:false,stage:'fan_mode'},pump_suggestion:{mode:'heat',target:16,reason:'Garage below lower limit'},model:{}}};
assert.match(zonePanel.overview(),/Waiting for pump confirmation: <span>Fan speed<\/span>/);
zonePanel.info.data.rooms.g.pump_control.confirmed=true;assert.doesNotMatch(zonePanel.overview(),/Waiting for pump confirmation:/);
console.log('Pump stage feedback passed: unconfirmed fan stage shown and cleared after confirmation.');
const newZonePanel=new Component();let addZoneClick;const newZoneDetails={open:false};
newZonePanel.tab='rooms';newZonePanel.settings={rooms:[],heating_zones:[]};newZonePanel.info={source_fields:[],room_fields:[],zone_fields:[],zone_defaults:{name:'',thermostat:''}};newZonePanel._hass={states:{}};
newZonePanel.shadowRoot.querySelector=selector=>selector==='#add-zone'?{addEventListener:(_,fn)=>addZoneClick=fn}:selector.startsWith('[data-settings-disclosure=')?newZoneDetails:null;
newZonePanel.render();addZoneClick();assert.equal(newZonePanel.settings.heating_zones.length,1);assert.equal(newZoneDetails.open,true);
console.log('Adding a heating zone opens the new accordion immediately.');

const memberPanel=new Component();memberPanel.tab='rooms';memberPanel._hass={states:{}};
memberPanel.settings={rooms:[{id:'a',name:'Living room',temperature_entity:'sensor.a',heating_zone_id:''},{id:'b',name:'Study',temperature_entity:'sensor.b',heating_zone_id:'other'},{id:'g',name:'Garage',temperature_entity:'sensor.g',is_garage:true}],heating_zones:[{id:'z',name:'Main zone',main_room_id:''},{id:'other',name:'Other zone',main_room_id:'b'}]};
memberPanel.info={source_fields:[],room_fields:[],zone_fields:[],settings:structuredClone(memberPanel.settings)};
memberPanel.zoneRoomDrafts={z:['']};const memberHTML=memberPanel.field(['zone_rooms','Rooms','rooms'],memberPanel.settings.heating_zones[0],'zone0');
assert.match(memberHTML,/>Add room<\/button>/);assert.match(memberHTML,/value="a"/);assert.match(memberHTML,/value="b"[^>]*disabled/);assert.doesNotMatch(memberHTML,/value="g"/);
let chosenRoom='a';const memberList={dataset:{entityList:'zone0.zone_rooms'},querySelectorAll:()=>[{value:chosenRoom}]};
memberPanel.shadowRoot.querySelectorAll=selector=>selector==='[data-entity-list]'?[memberList]:[];
memberPanel.capture();assert.equal(memberPanel.settings.rooms[0].heating_zone_id,'z');assert.equal(memberPanel.settings.heating_zones[0].main_room_id,'a');assert.equal(memberPanel.settings.rooms[1].heating_zone_id,'other');
chosenRoom='';memberPanel.capture();assert.equal(memberPanel.settings.rooms[0].heating_zone_id,'');assert.equal(memberPanel.settings.heating_zones[0].main_room_id,'');

const removeMemberPanel=new Component();removeMemberPanel.tab='rooms';removeMemberPanel._hass={states:{}};
removeMemberPanel.settings={rooms:[{id:'a',name:'Living room',temperature_entity:'sensor.a',heating_zone_id:'z'},{id:'b',name:'Study',temperature_entity:'sensor.b',heating_zone_id:'z'}],heating_zones:[{id:'z',name:'House pump',main_room_id:'a'}]};removeMemberPanel.zoneRoomDrafts={z:['a','b']};removeMemberPanel.info={source_fields:[],room_fields:[],zone_fields:[]};
const removeMemberButton={dataset:{remove:'0'}};removeMemberPanel.shadowRoot.querySelectorAll=selector=>selector==='[data-remove]'?[removeMemberButton]:[];
const previousConfirm=context.confirm;let removalPrompt;context.confirm=prompt=>{removalPrompt=prompt;return false;};removeMemberPanel.render();removeMemberButton.onclick();assert.equal(removeMemberPanel.settings.rooms.length,2);assert.match(removalPrompt,/also removes its zone membership/);assert.match(removalPrompt,/House pump/);
context.confirm=()=>true;removeMemberButton.onclick();assert.equal(removeMemberPanel.settings.rooms.length,1);assert.deepEqual([...removeMemberPanel.zoneRoomDrafts.z],['b']);assert.equal(removeMemberPanel.settings.heating_zones[0].main_room_id,'b');context.confirm=previousConfirm;
console.log('Zone room membership passed: configured-room choices, occupied-zone exclusion, linking/removing rooms, main-room updates, and cancel/confirm deletion warning with membership cleanup.');

const garageRetention=previewPanel.heatRetentionView();assert.match(garageRetention,/<tr[^>]* class="garage-retention-row"><td><span data-user-text>Garage \(example\)/);console.log('Preview includes an example garage with a distinct retention row.');
// Save failures stay visible near the save controls until dismissed or edited.
const errorPanel=new Component();errorPanel._hass={states:{}};errorPanel.settings={rooms:[],language:'fi'};
errorPanel.info={source_fields:[],room_fields:[]};errorPanel.tab='settings';errorPanel.messageLevel='error';
errorPanel.message='Settings were not saved: Autotalli: heat pump heating setpoint 16 °C is outside device limits (17–30 °C).';
let dismissError,focusedError=false,removedError=false;
errorPanel.shadowRoot.querySelector=selector=>selector==='#dismiss-save-error'?{addEventListener:(_,fn)=>dismissError=fn}:selector==='.save-error'?{focus:options=>{assert.equal(options.preventScroll,true);focusedError=true;},remove:()=>removedError=true}:null;
errorPanel.render();
assert.match(errorPanel.shadowRoot.innerHTML,/save-toast notice-error save-error/);
assert.match(errorPanel.shadowRoot.innerHTML,/role="alert" aria-live="assertive"/);
assert.match(errorPanel.shadowRoot.innerHTML,/Asetuksia ei tallennettu: Autotalli: Pumpun lämmityksen asetuslämpötila 16 °C/);
assert.doesNotMatch(errorPanel.shadowRoot.innerHTML,/heat pump heating setpoint/);
assert.equal(errorPanel.saveMessageTimer,undefined);assert.equal(focusedError,true);
dismissError();assert.equal(errorPanel.message,'');assert.equal(removedError,true);
const translatedError=vm.runInContext('translateText',context);
assert.match(translatedError('Settings were not saved: Autotalli: heat pump heating setpoint is outside device limits.','fi'),/Pumpun lämmityksen asetuslämpötila/);
console.log('Save errors passed: persistent fixed alert, Finnish device limits, focus without scrolling and explicit dismissal.');
const emptyAirPanel=new Component();emptyAirPanel._hass={states:{}};
emptyAirPanel.settings={house_heat_source:'air_to_water',rooms:[{id:'garage',is_garage:true,thermostat:'climate.garage'}],heating_zones:[],air_fan_heat:''};
emptyAirPanel.info={source_fields:[['air_fan_heat','Heating fan speed','text']],room_fields:[],zone_fields:[],data:{rooms:{}}};
assert.match(emptyAirPanel.settingsView(),/data-air-group hidden/);
assert.doesNotMatch(emptyAirPanel.settingsView(),/Heating response is learned automatically/);
let emptyFan=emptyAirPanel.field(emptyAirPanel.info.source_fields[0],emptyAirPanel.settings,'source');
assert.match(emptyFan,/data-field="source.air_fan_heat" disabled/);assert.match(emptyFan,/Select a heat pump in a room or heating zone first/);
emptyAirPanel.settings.rooms.push({id:'house',is_garage:false,heat_control:'air_to_air',thermostat:'climate.house'});
assert.doesNotMatch(emptyAirPanel.settingsView(),/data-air-group hidden/);
emptyFan=emptyAirPanel.field(emptyAirPanel.info.source_fields[0],emptyAirPanel.settings,'source');assert.match(emptyFan,/does not report options/);
emptyAirPanel._hass.states['climate.house']={attributes:{fan_modes:['quiet','high']}};
emptyFan=emptyAirPanel.field(emptyAirPanel.info.source_fields[0],emptyAirPanel.settings,'source');assert.match(emptyFan,/value="quiet"/);assert.doesNotMatch(emptyFan,/disabled|does not report options/);
emptyAirPanel.settings.rooms.push({id:'second',heat_control:'air_to_air',thermostat:'climate.second'});
emptyAirPanel._hass.states['climate.second']={attributes:{fan_modes:['auto']}};
assert.match(emptyAirPanel.field(emptyAirPanel.info.source_fields[0],emptyAirPanel.settings,'source'),/no common options/);
console.log('Shared air settings passed: garage-only section hidden, automatic-learning text removed, empty capability explanations and reported options.');
zonePanel.info.zone_fields.push(['heating_enabled','Control zone heat pump','bool']);
zonePanel.settings.heating_zones[0].heating_enabled=false;
let zoneOptInHTML=zonePanel.settingsView();
assert.match(zoneOptInHTML,/Control zone heat pump/);
assert.match(zoneOptInHTML,/role="switch" data-field="zone0.heating_enabled" >/);
zonePanel.settings.heating_zones[0].heating_enabled=true;
assert.match(zonePanel.settingsView(),/data-field="zone0.heating_enabled" checked/);
assert.match(zoneOptInHTML,/<h2>Shared room and zone settings<\/h2>/);
console.log('Zone heating opt-in switch and shared room/zone heading passed.');
zonePanel.info.zone_fields.push(['climate_mode','Heat pump use','select:heat,cool,both'],['cooling_target','Cooling target temperature (°C)','number',16,30,.5]);
zonePanel.settings.heating_zones[0].climate_mode='cool';zonePanel.settings.heating_zones[0].cooling_target=24;
const coolingZoneHTML=zonePanel.settingsView();
assert.match(coolingZoneHTML,/value="cool">Cooling only/);assert.match(coolingZoneHTML,/data-field="zone0.cooling_target" value="24"/);
zonePanel.settings.heating_zones[0].climate_mode='heat';assert.doesNotMatch(zonePanel.settingsView(),/data-field="zone0.cooling_target"/);
console.log('Zone heating/cooling selection and conditional cooling target passed.');
const settingsPage=previewPanel.settingsView('settings'),roomsPage=previewPanel.settingsView('rooms');
assert.match(settingsPage,/<section class="settings-sources">/);assert.doesNotMatch(settingsPage,/<section class="settings-(?:house|shared|rooms|zones)">/);
assert.doesNotMatch(roomsPage,/<section class="settings-sources">/);
for(const section of ['house','shared','rooms','zones'])assert.match(roomsPage,new RegExp('<section class="settings-'+section+'">'));
for(const html of [settingsPage,roomsPage])assert.match(html,/type="submit">Save settings/);
const splitPanel=new Component();splitPanel._hass={states:{}};splitPanel.info={settings:{rooms:[],heating_zones:[]},source_fields:[],room_fields:[]};
splitPanel.settings={rooms:[{id:'unsaved',name:'New room',baseline:20}],heating_zones:[]};splitPanel.tab='rooms';let splitLoads=0;
splitPanel.load=()=>splitLoads++;context.confirm=()=>{throw new Error('Editing-tab navigation must preserve changes without asking to discard');};
splitPanel.switchTab('settings');assert.equal(splitPanel.settings.rooms[0].name,'New room');assert.equal(splitLoads,0);
splitPanel.switchTab('rooms');assert.equal(splitLoads,0);
const splitHTML=splitPanel.shadowRoot.innerHTML;
assert.ok(splitHTML.indexOf('id="tab-history"')<splitHTML.indexOf('id="tab-rooms"'));
assert.ok(splitHTML.indexOf('id="tab-rooms"')<splitHTML.indexOf('id="tab-settings"'));
context.confirm=()=>false;splitPanel.switchTab('history');assert.equal(splitPanel.tab,'rooms');
context.confirm=()=>true;
console.log('Rooms and zones tab passed: ordered navigation, split sections, save controls, draft preservation and unsaved exit protection.');
(async()=>{
 let WarningPanel,allow=false;const prompts=[],calls=[];
 const warningContext={...context,confirm:text=>{prompts.push(text);return allow;},setTimeout:()=>1,clearTimeout:()=>{},customElements:{get:()=>undefined,define:(_,value)=>WarningPanel=value}};
 vm.createContext(warningContext);vm.runInContext(fs.readFileSync(path.join(__dirname,'../custom_components/thermal_pilot/frontend/panel.js'),'utf8'),warningContext);
 const warningPanel=new WarningPanel();warningPanel.tab='rooms';warningPanel._hass={states:{}};warningPanel.settings={rooms:[],heating_zones:[],simulation_enabled:true};
 warningPanel.info={settings:structuredClone(warningPanel.settings),source_fields:[],room_fields:[],zone_fields:[]};
 const handlers={},form={addEventListener:(key,handler)=>handlers[key]=handler,querySelector:()=>null,querySelectorAll:()=>[]};
 warningPanel.shadowRoot.querySelector=selector=>selector==='#settings'?form:null;
 warningPanel.call=async(type,args)=>{calls.push(args);return args.confirm_learning_reset?{saved:true}:{saved:false,requires_learning_confirmation:true,learning_changes:[{name:'Sadun huone',scope:'heating_response'},{name:'Study',scope:'full'}]};};
 warningPanel.render();await handlers.submit({preventDefault(){}});
 assert.equal(calls.length,1);assert.equal(warningPanel.saveConfirmation,false);assert.equal(warningPanel.saving,false);
 assert.match(prompts[0],/Sadun huone: heating response will restart; learned heat retention will be kept/);assert.match(prompts[0],/Study: all learned room parameters will reset/);
 allow=true;await handlers.submit({preventDefault(){}});
 assert.equal(calls.length,3);assert.equal(calls[2].confirm_learning_reset,true);assert.equal(warningPanel.saveConfirmation,true);
 console.log('Learning reset warning passed: named full/partial resets, cancellation without saving and explicit confirmed retry.');
})().catch(error=>{console.error(error);process.exitCode=1;});
const zoneChartPanel=new Component(),zoneChartNow=Date.now();
zoneChartPanel.historyHours=24;zoneChartPanel.priceChartWidth=1000;
zoneChartPanel.settings={rooms:[{id:'room-z',name:'Room Z'}],heating_zones:[{id:'z-last',name:'Zulu zone',heating_strategy:'tariff',climate_mode:'heat',main_room_id:'room-z'},{id:'z-first',name:'Alpha zone',heating_strategy:'temperature',climate_mode:'heat'},{id:'z-cool',name:'Cooling zone',heating_strategy:'tariff',climate_mode:'cool'}]};
zoneChartPanel.info={data:{price_chart:[{start:new Date(zoneChartNow-86400000).toISOString(),end:new Date(zoneChartNow+86400000).toISOString(),price:10}],rooms:{'room-z':{plan:{commands:[{time:new Date(zoneChartNow+3600000).toISOString(),action:'raise'},{time:new Date(zoneChartNow+7200000).toISOString(),action:'restore'}]}}}}};
zoneChartPanel.info.data.zones={'z-last':{plan:structuredClone(zoneChartPanel.info.data.rooms['room-z'].plan)}};
zoneChartPanel.history=[];
for(const zone of zoneChartPanel.settings.heating_zones)for(const [minutes,mode] of [[-30,'heat'],[-25,'heat'],[-20,null],[-15,'cool'],[-10,'cool'],[-5,null]])zoneChartPanel.history.push({room_id:'zone:'+zone.id,zone_id:zone.id,time:zoneChartNow/1000+minutes*60,zone_mode:mode,zone_basis:'activity',zone_entity:'climate.'+zone.id});
zoneChartPanel.statusHistory=zoneChartPanel.history;
const zoneHistorySVG=zoneChartPanel.priceChart(true),zonePlanSVG=zoneChartPanel.priceChart(false);
assert.ok(zoneHistorySVG.indexOf('data-zone-timeline="z-first"')<zoneHistorySVG.indexOf('data-zone-timeline="z-cool"'));assert.ok(zoneHistorySVG.indexOf('data-zone-timeline="z-cool"')<zoneHistorySVG.indexOf('data-zone-timeline="z-last"'));
assert.match(zoneHistorySVG,/fill="#f7ead8"/);assert.match(zoneHistorySVG,/data-zone-period="heat"/);assert.match(zoneHistorySVG,/data-zone-period="cool"/);assert.doesNotMatch(zoneHistorySVG,/data-zone-period="plan"/);
const zoneGroup=(html,id)=>html.match(new RegExp('<g data-zone-timeline="'+id+'">[\\s\\S]*?<\\/g>'))[0];
assert.doesNotMatch(zoneGroup(zonePlanSVG,'z-first'),/data-zone-period="plan"/);assert.doesNotMatch(zoneGroup(zonePlanSVG,'z-cool'),/data-zone-period="plan"/);assert.match(zoneGroup(zonePlanSVG,'z-last'),/data-zone-period="plan"/);
assert.doesNotMatch(zoneGroup(zoneHistorySVG,'z-first'),/>Off<|mode Off|data-zone-period="off"/);
zoneChartPanel.info.data.price_chart=[];assert.match(zoneChartPanel.priceChart(false),/data-zone-timeline="z-first"/);
zoneChartPanel.priceChartWidth=320;assert.match(zoneChartPanel.priceChart(true),/data-zone-period="cool"/);
console.log('Zone chart passed: alphabetic rows at bottom, distinct tint, heat/cool only, tariff-only Plan windows, History without plans, no-price and mobile layouts.');
zoneChartPanel.priceChartWidth=1000;
const combinedZoneChart=zoneChartPanel.priceChart(true),combinedZone=zoneGroup(combinedZoneChart,'z-first');
const zoneHeatY=combinedZone.match(/data-zone-period="heat"[^>]* y="([^"]+)"/)[1],zoneCoolY=combinedZone.match(/data-zone-period="cool"[^>]* y="([^"]+)"/)[1];
assert.equal(zoneHeatY,zoneCoolY);
assert.match(combinedZoneChart,/style="font-size:18px;font-weight:600">Rooms<\/text>/);
assert.match(combinedZoneChart,/style="font-size:18px;font-weight:600">Heating zones<\/text>/);
console.log('Chart section headings and shared heating/cooling zone lane passed.');
const unifiedZone=zoneGroup(zoneChartPanel.priceChart(false),'z-last');
const unifiedHeatY=unifiedZone.match(/data-zone-period="heat"[^>]* y="([^"]+)"/)[1],unifiedPlanY=unifiedZone.match(/data-zone-period="plan"[^>]* y="([^"]+)"/)[1];
assert.equal(unifiedHeatY,unifiedPlanY);
assert.match(unifiedZone,/data-zone-period="plan"[^>]*fill="#087c85"/);
console.log('Recorded heating, cooling and future plans share one zone timeline with distinct colors.');
const coolingRating=vm.runInContext('retentionRating',context);
for(const [hours,expected]of [[.5,'very-fast'],[1,'fast'],[1.99,'fast'],[2,'moderate'],[3.99,'moderate'],[4,'slow'],[7.99,'slow'],[8,'very-slow'],[20,'very-slow']])assert.equal(coolingRating({updated:true,hours_per_degree:hours}).level,expected);
for(const hours of [0,-1,NaN,Infinity])assert.equal(coolingRating({updated:true,hours_per_degree:hours}).level,'learning');
assert.equal(coolingRating({updated:false,hours_per_degree:4.8}).level,'learning');
assert.match(retentionPanel.heatRetentionView(),/data-retention-sort="speed"/);
assert.match(retentionPanel.heatRetentionView(),/data-retention-rating="moderate"/);
assert.match(retentionPanel.heatRetentionView(),/data-retention-rating="learning"/);
console.log('Cooling-speed badges passed: all threshold boundaries, invalid values, neutral initial models and retained numerical values.');
assert.equal(coolingRating({updated:true,hours_per_degree:4.8,reference_hours:2.12}).level,'very-slow');
assert.equal(coolingRating({updated:true,hours_per_degree:4.8,reference_hours:11.31}).level,'very-fast');
for(const [ratio,level]of [[.49,'very-fast'],[.5,'fast'],[.8,'moderate'],[1.25,'slow'],[2,'very-slow']])assert.equal(coolingRating({updated:true,hours_per_degree:ratio*10,reference_hours:10}).level,level);
assert.equal(coolingRating({updated:false,hours_per_degree:4.8,reference_hours:2.12}).level,'learning');
assert.match(previewPanel.settingsView('rooms'),/data-field="source.house_construction"/);
const constructionField=zonePanel.field(['garage_construction','Construction type','select:unknown,timber_frame,masonry,lightweight_metal'],{garage_construction:'timber_frame'},'room0');
assert.match(constructionField,/value="timber_frame">Timber frame/);assert.match(constructionField,/Construction of this garage only/);
console.log('Construction comparisons passed: type-relative bands, unchanged initial Learning, house selector and separate garage selector.');
const garageChartPanel=new Component();garageChartPanel.historyHours=24;garageChartPanel.priceChartWidth=1000;
garageChartPanel.settings={rooms:[{id:'gz',name:'Z garage',is_garage:true},{id:'home',name:'House room'},{id:'ga',name:'A garage',is_garage:true}],heating_zones:[]};
garageChartPanel.info={data:{price_chart:zoneChartPanel.info.data.price_chart,rooms:{}}};garageChartPanel.history=[];
for(const history of [true,false]){
 const html=garageChartPanel.priceChart(history);
 assert.match(html,/font-size:18px;font-weight:600">Garages<\/text>/);
 assert.match(html,/fill="#e2d7cb"/);assert.match(html,/fill="#d7c9ba"/);
 const names=[...html.matchAll(/data-user-text title="([^"]+)"/g)].map(match=>match[1]);assert.deepEqual(names,['House room','A garage','Z garage']);
}
garageChartPanel.settings.rooms=garageChartPanel.settings.rooms.filter(room=>room.is_garage);
const onlyGarageChart=garageChartPanel.priceChart(true);assert.doesNotMatch(onlyGarageChart,/font-weight:600">Rooms<\/text>/);assert.match(onlyGarageChart,/font-weight:600">Garages<\/text>/);
console.log('Garage chart section passed: separate heading, distinctive alternating tint, alphabetic garage rows, Plan/History and garage-only layouts.');

const garageCardsPanel=new Component();garageCardsPanel.history=[];
garageCardsPanel.settings={rooms:[{id:'gz',name:'Garage Z',is_garage:true},{id:'r',name:'Regular room'},{id:'ga',name:'Garage A'}]};
garageCardsPanel.info={data:{rooms:{gz:{name:'Garage Z'},r:{name:'Regular room'},ga:{name:'Garage A',is_garage:true}}}};
for(const html of [garageCardsPanel.overview(),garageCardsPanel.historyView()]){
 const cards=html.slice(html.indexOf('<div class="observation-cards">'));
 assert.ok(cards.indexOf('Regular room')<cards.indexOf('Garage A'));
 assert.ok(cards.indexOf('Garage A')<cards.indexOf('Garage Z'));
 assert.equal((cards.match(/class="observation-card garage-observation-card"/g)||[]).length,2);
}
console.log('Plan and History room cards put garages last, alphabetically, with distinct styling.');

const pumpChartPanel=new Component(),pumpNow=Date.now();pumpChartPanel.priceChartWidth=1000;pumpChartPanel.historyHours=24;
pumpChartPanel.settings={rooms:[{id:'garage',name:'Garage',is_garage:true,garage_strategy:'temperature'}],heating_zones:[]};
pumpChartPanel.info={data:{rooms:{garage:{air_control:true,plan:{commands:[{time:new Date(pumpNow+3600000).toISOString(),action:'raise'},{time:new Date(pumpNow+7200000).toISOString(),action:'restore'}]}}}}};
pumpChartPanel.history=[[-30,'heat'],[-25,'heat'],[-20,null],[-15,'cool'],[-10,null]].map(([minutes,mode])=>({room_id:'garage',time:pumpNow/1000+minutes*60,pump_mode:mode,activity:mode===null?1:0}));pumpChartPanel.statusHistory=pumpChartPanel.history;
for(const history of [true,false]){
 const svg=pumpChartPanel.priceChart(history),lane=svg.match(/<g data-pump-timeline="garage">[\s\S]*?<\/g>/)[0];
 assert.match(lane,/data-pump-period="heat"/);assert.match(lane,/data-pump-period="cool"/);
 assert.doesNotMatch(lane,/>Suggested<|>Relay<|data-pump-period="plan"/);
 assert.equal((lane.match(/data-pump-period=/g)||[]).length,2);
}
pumpChartPanel.settings.rooms[0].garage_strategy='tariff';
assert.match(pumpChartPanel.priceChart(false),/data-pump-period="plan"/);
assert.doesNotMatch(pumpChartPanel.priceChart(true),/data-pump-period="plan"/);
pumpChartPanel.history=[{room_id:'garage',time:pumpNow/1000-600,activity:1}];
assert.match(pumpChartPanel.priceChart(true),/data-pump-period="heat"/);
console.log('Air pump room timelines share heat/cool/plan lane, omit standby and gate future plans on tariff strategy.');

const sortPanel=new Component();sortPanel.settings={rooms:[]};
const retentionRoom=(name,hours,updated=true)=>({name,heat_retention:{drop_6h:6/hours,hours_per_degree:hours,updated,heating_hours:0,idle_hours:0}});
sortPanel.info={data:{rooms:{slow:retentionRoom('Slow',9),fast:retentionRoom('Fast',.5),learning:retentionRoom('Learning',4,false),garage:{...retentionRoom('Garage',12),is_garage:true}}}};
sortPanel.render=()=>{};const roomOrder=()=>Array.from(sortPanel.heatRetentionView().matchAll(/<span data-user-text>([^<]+)<\/span>/g),m=>m[1]);
assert.deepEqual(roomOrder(),['Slow','Learning','Fast','Garage']);
sortPanel.sortRetention('drop');assert.deepEqual(roomOrder(),['Fast','Learning','Slow','Garage']);
assert.match(sortPanel.heatRetentionView(),/aria-sort="descending"/);
sortPanel.sortRetention('hours');assert.deepEqual(roomOrder(),['Fast','Learning','Slow','Garage']);
sortPanel.sortRetention('hours');assert.deepEqual(roomOrder(),['Slow','Learning','Fast','Garage']);
sortPanel.sortRetention('speed');assert.deepEqual(roomOrder(),['Fast','Slow','Learning','Garage']);
sortPanel.sortRetention('speed');assert.deepEqual(roomOrder(),['Slow','Fast','Learning','Garage']);
assert.deepEqual(Object.keys(sortPanel.info.data.rooms),['slow','fast','learning','garage']);
console.log('Retention sorting passed: numeric directions, speed bands, Learning last, garage group retained and source data unchanged.');
const nameWidthPanel=new Component();nameWidthPanel.priceChartWidth=1000;nameWidthPanel.historyHours=24;nameWidthPanel.history=[];nameWidthPanel.statusHistory=[];
nameWidthPanel.settings={rooms:[{id:'g',name:'Garage',is_garage:true}],heating_zones:[{id:'zone',name:'Zone'}]};nameWidthPanel.info={data:{rooms:{}}};
const nameWidth=html=>Number(html.match(/<foreignObject[^>]*width="([\d.]+)"/)[1]);
const shortNameWidth=nameWidth(nameWidthPanel.priceChart(false));
nameWidthPanel.settings.heating_zones[0].name='Downstairs heat pump (example)';
const longerNames=nameWidthPanel.priceChart(false),longNameWidth=nameWidth(longerNames);
assert.ok(longNameWidth>shortNameWidth);
const allNameWidths=Array.from(longerNames.matchAll(/<foreignObject[^>]*width="([\d.]+)"/g),m=>Number(m[1]));
assert.ok(allNameWidths.every(width=>width===longNameWidth));
nameWidthPanel.settings.heating_zones[0].name='Very long zone name '.repeat(30);
assert.ok(nameWidth(nameWidthPanel.priceChart(false))<=400);
nameWidthPanel.priceChartWidth=400;assert.equal(nameWidth(nameWidthPanel.priceChart(false)),360);
console.log('Chart name column adapts to longest room or zone name, stays aligned, caps width and preserves compact layout.');
const compactPlanPanel=new Component();compactPlanPanel.settings=structuredClone(previewPanel.settings);compactPlanPanel.info=structuredClone(previewPanel.info);
for(const room of Object.values(compactPlanPanel.info.data.rooms))room.learning_progress={initial_complete:true,percent:100};
const compactRoomCards=compactPlanPanel.overview().split('<div class="observation-cards">')[1];
assert.doesNotMatch(compactRoomCards,/>Actual heating<|>Observed heat mode<|>3-hour forecast error<|class="learning-card"|<th>Planned heating starts<|<th>Planned heating ends<|<th>Starts<|<th>Price \(c\/kWh\)<|<th>Prediction °C</);
assert.match(compactRoomCards,/>Measured<strong>/);assert.match(compactRoomCards,/Suggested thermostat target/);
assert.match(compactRoomCards,/<th>Change target at<\/th>/);assert.match(compactRoomCards,/class="temperature-chart"/);
assert.equal(compactPlanPanel.learningView({model:{heated_hours:12,idle_hours:13}}),'');
assert.match(compactPlanPanel.learningView({model:{heated_hours:6,idle_hours:12},learning_progress:{initial_complete:false,percent:75}}),/class="learning-card"/);
console.log('Compact Plan cards preserve temperatures, commands and forecast chart; hide completed collection and remove duplicate metrics and tables.');

const finnishNotesPanel=new Component();finnishNotesPanel.settings={...structuredClone(zoneChartPanel.settings),language:'fi'};finnishNotesPanel.info=structuredClone(zoneChartPanel.info);finnishNotesPanel.history=zoneChartPanel.history;finnishNotesPanel.statusHistory=zoneChartPanel.statusHistory;
for(const history of [true,false]){
 const notes=finnishNotesPanel.priceChart(history).match(/<small data-chart-notes[^>]*>([\s\S]*?)<\/small>/)[1];
 assert.match(notes,/Kaikkien huoneiden aikajanat/);assert.match(notes,/Vyöhykkeiden riveillä/);assert.match(notes,/Turkoosi näyttää/);assert.match(notes,/Ajat kohdistetaan/);
 assert.doesNotMatch(notes,/All room|Zone rows|Teal shows|Recorded activity|Times align|Hover/);
 if(history)assert.match(notes,/Valittu ajanjakso/);
}
console.log('Plan and History chart explanations are fully Finnish when integration language is Finnish.');

const retentionHelpHTML=retentionPanel.heatRetentionView();
assert.match(retentionHelpHTML,/class="retention-summary"/);
assert.match(retentionHelpHTML,/<details class="retention-help" id="retention-help" ><summary>About these estimates<\/summary>/);
const collapsedHelp=retentionHelpHTML.match(/<details class="retention-help"[\s\S]*?<\/details>/)[0];
assert.match(collapsedHelp,/not measured energy efficiency/);assert.match(collapsedHelp,/Cooling-speed bands are provisional/);
assert.ok(retentionHelpHTML.indexOf('retention-help')>retentionHelpHTML.indexOf('</table>'));
retentionPanel.retentionHelpOpen=true;assert.match(retentionPanel.heatRetentionView(),/id="retention-help" open/);
console.log('Retention explanation is compact by default, with detailed context in expandable help.');

const waterStatusPanel=new Component();waterStatusPanel.info={data:{rooms:{},water:32}};
for(const settings of [
 {house_heat_source:'air_to_water',house_distribution:'water_floor',water_entity:''},
 {house_heat_source:'electric_resistance',house_distribution:'electric_floor',water_entity:'sensor.old_water'},
 {house_heat_source:'air_to_air',house_distribution:'warm_air',water_entity:'sensor.old_water'},
]){waterStatusPanel.settings={rooms:[],...settings};assert.doesNotMatch(waterStatusPanel.overview(),/<dt>Heating water temperature<\/dt>/);}
waterStatusPanel.settings={rooms:[],house_distribution:'water_floor',water_entity:'sensor.heating_water'};
assert.match(waterStatusPanel.overview(),/<dt>Heating water temperature<\/dt>/);
waterStatusPanel.info.data.water=null;assert.match(waterStatusPanel.overview(),/<dt>Heating water temperature<\/dt>/);
console.log('Water status card requires a configured sensor and water circulation; temporary unavailable readings retain the configured card.');

const secondaryRemoval=new Component();secondaryRemoval._hass={states:{}};secondaryRemoval.tab='rooms';
secondaryRemoval.settings={rooms:[{id:'primary',name:'Floor room',thermostat:'climate.floor',activity_entity:'switch.floor',heat_control:'house',heating_zone_id:'zone'}],heating_zones:[{id:'zone',name:'Cooling pump',thermostat:'climate.secondary'}]};
secondaryRemoval.info={room_fields:[['thermostat','Thermostat','climate'],['activity_entity','Thermostat relay (optional)','switch'],['heat_control','Room heating control','select:house,air_to_air']],source_fields:[],zone_fields:[],data:{rooms:{}}};
secondaryRemoval.capture=()=>{};const removeZoneButton={dataset:{removeZone:'0'},addEventListener(type,handler){this.click=handler;}};
secondaryRemoval.shadowRoot.querySelectorAll=selector=>selector==='[data-remove-zone]'?[removeZoneButton]:[];
secondaryRemoval.render();assert.match(secondaryRemoval.shadowRoot.innerHTML,/data-field="room0.thermostat"/);assert.match(secondaryRemoval.shadowRoot.innerHTML,/data-field="room0.activity_entity"/);
context.confirm=()=>true;removeZoneButton.click();
assert.equal(secondaryRemoval.settings.rooms[0].thermostat,'climate.floor');assert.equal(secondaryRemoval.settings.rooms[0].activity_entity,'switch.floor');assert.equal(secondaryRemoval.settings.rooms[0].heat_control,'house');assert.equal(secondaryRemoval.settings.rooms[0].heating_zone_id,'');
zoneChartPanel.info.data.rooms['room-z'].plan.commands=[];
assert.match(zoneGroup(zoneChartPanel.priceChart(false),'z-last'),/data-zone-period="plan"/);
zoneChartPanel.info.data.zones['z-last'].plan.commands=[];
assert.doesNotMatch(zoneGroup(zoneChartPanel.priceChart(false),'z-last'),/data-zone-period="plan"/);
console.log('Secondary zone UI preserves primary thermostat controls and removal settings; chart uses the separate zone plan.');

const localizedBadges=new Component();
localizedBadges.settings={language:'fi',simulation_enabled:true,summer_minimum_temperature:8.5};
localizedBadges.info={data:{source_status:{prices:true,outdoor:true,water:true},fallback_season:{season:'summer'}}};
let localizedBadgeHtml=localizedBadges.controlBadges();
assert.match(localizedBadgeHtml,/Kesäkausi on 15\.5\.–30\.9\./);
assert.match(localizedBadgeHtml,/vähintään 8,5 °C/);
assert.match(localizedBadgeHtml,/Talven varalämpötilana käytetään/);
assert.match(localizedBadgeHtml,/Simulointi on käytössä/);
assert.match(localizedBadgeHtml,/Sääennusteen tiedot näytetään/);
assert.doesNotMatch(localizedBadgeHtml,/Summer|winter fallback|available|Simulation is|forecast temperature/);
assert.equal((localizedBadgeHtml.match(/class="status-info"/g)||[]).length,3);
assert.equal((localizedBadgeHtml.match(/aria-describedby="status-help-/g)||[]).length,3);
assert.match(localizedBadgeHtml,/<details class="status-help"><summary/);
localizedBadges.info.data.source_status.water=false;
assert.match(localizedBadges.controlBadges(),/Puuttuu tai ei ole käytettävissä:/);
assert.doesNotMatch(localizedBadges.controlBadges(),/Missing or unusable|Heating water temperature/);
for(const settings of [{simulation_enabled:false},{simulation_enabled:false,live_control_confirmed:true},{simulation_enabled:true,apply_season_setpoints:true}]){
 Object.assign(localizedBadges.settings,{live_control_confirmed:false,apply_season_setpoints:false},settings);
 assert.doesNotMatch(localizedBadges.controlBadges(),/ThermalPilot applies|has not been confirmed|remain simulated/);
}
console.log('Status badge help is fully Finnish, with visible info indicators and native tap/keyboard disclosures.');

const reorderedChart=new Component();reorderedChart.historyHours=24;
reorderedChart.settings={rooms:[{id:'g2',name:'Z garage',is_garage:true},{id:'r',name:'Regular room'},{id:'g1',name:'A garage',is_garage:true}],heating_zones:[{id:'z',name:'Secondary zone',source_type:'air_to_air'}]};
reorderedChart.info={data:{price_chart:zoneChartPanel.info.data.price_chart,rooms:{}}};reorderedChart.history=[];
for(const width of [390,1000])for(const history of [false,true]){
 reorderedChart.priceChartWidth=width;
 const html=reorderedChart.priceChart(history);
 const positions=[...html.matchAll(/<foreignObject x="20" y="([\d.]+)"[^>]*><div[^>]*data-user-text title="([^"]+)"/g)].map(match=>({y:Number(match[1]),name:match[2]}));
 assert.deepEqual(positions.map(row=>row.name),['Regular room','Secondary zone','A garage','Z garage']);
 for(let index=1;index<positions.length;index++)assert.ok(positions[index].y>positions[index-1].y+20,'Chart groups must not overlap');
 const chartHeight=Number(html.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/)[1]);
 assert.ok(chartHeight>positions.at(-1).y+22,'Final garage must fit within chart');
 assert.ok(html.indexOf('>Heating zones</text>')<html.indexOf('>Garages</text>'));
}
statusPanel.render();
const settingsStyles=statusPanel.shadowRoot.innerHTML;
assert.equal((settingsStyles.match(/#settings\[data-settings-page="settings"\] \.settings-group>\.grid\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)\}/g)||[]).length,1,'A late desktop rule must not override mobile settings');
assert.match(settingsStyles,/@media\(max-width:600px\)\{[^}]*\}[^]*?#settings \.grid,#settings \.settings-group>\.grid,#settings\[data-settings-page="settings"\] \.settings-group>\.grid\{grid-template-columns:minmax\(0,1fr\)\}/);
console.log('Plan/History charts place garages after zones at phone and desktop widths; mobile settings keep a single column.');

statusPanel.render();
assert.match(statusPanel.shadowRoot.innerHTML,/\.status-help\{[^}]*border:0;padding:0;margin:0\}/,'Tooltip disclosures must reset generic details spacing and dividers');
assert.match(statusPanel.shadowRoot.innerHTML,/\.status-help>summary\{[^}]*margin:0;font-weight:normal\}/,'Tooltip badges must reset generic summary spacing and weight');
console.log('Status tooltip badges reset generic disclosure styles to preserve compact layout.');

const platformIndependentBadges=localizedBadges.controlBadges();
assert.equal((platformIndependentBadges.match(/<svg class="status-info" viewBox="0 0 20 20" aria-hidden="true" focusable="false">/g)||[]).length,3);
assert.doesNotMatch(platformIndependentBadges,/ⓘ/);
console.log('Status info icons use fixed SVG geometry instead of platform-dependent font glyphs.');
