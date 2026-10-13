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
assert.match(readableHistory,/<td>Off<\/td><td>On<\/td>/);assert.match(readableHistory,/<td>Unknown<\/td><td>Unknown<\/td>/);
assert.match(readableHistory,/Suggested thermostat target \(°C\)/);assert.match(readableHistory,/not an average/);
assert.doesNotMatch(readableHistory,/>Idle<|>Inactive<|>Heating</);
const chartWithLargePrediction=historyPanel.chart([{time:hour,temperature:20,prediction:25}],'temperature','prediction');
assert.match(chartWithLargePrediction,/25.1 °C/);assert.match(chartWithLargePrediction,/stroke-dasharray/);
console.log('Readable history tests passed (quarter-hour latest observations, legends, On/Off/Unknown, scale includes both lines).');

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
panel.tab='overview';panel.render();assert.match(panel.shadowRoot.innerHTML,/ThermalPilot status/);assert.doesNotMatch(panel.shadowRoot.innerHTML,/Set passive/);assert.match(panel.shadowRoot.innerHTML,/your existing automation remains in control/);
panel.settings.apply_season_setpoints=true;panel.render();assert.match(panel.shadowRoot.innerHTML,/SEASON SETPOINT CONTROL ENABLED/);
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
  testPanel.tab='settings';
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

const sortedPanel=new Component();sortedPanel._hass={states:{}};sortedPanel.tab='settings';sortedPanel.history=[];
sortedPanel.settings={rooms:[{id:'z',name:'Zulu'},{id:'b',name:'beta'},{id:'a',name:'Alpha'},{id:'new',name:''}]};
sortedPanel.info={source_fields:[],room_fields:[['name','Room name','text']],room_defaults:{},data:{rooms:{z:{name:'Zulu'},b:{name:'beta'},a:{name:'Alpha'}}}};
const settingsHTML=sortedPanel.settingsView();
assert.doesNotMatch(settingsHTML,/<details[^>]*\bopen\b/);
assert.equal((settingsHTML.match(/<details>/g)||[]).length,4);
assert.ok(settingsHTML.indexOf('<summary>Alpha')<settingsHTML.indexOf('<summary>beta'));
assert.ok(settingsHTML.indexOf('<summary>beta')<settingsHTML.indexOf('<summary>Zulu'));
assert.ok(settingsHTML.indexOf('<summary>Zulu')<settingsHTML.indexOf('<summary>New room'));
assert.match(settingsHTML,/<summary>Alpha[\s\S]*?<\/summary>[\s\S]*?data-field="room2.name"/);
assert.deepEqual(sortedPanel.settings.rooms.map(r=>r.id),['z','b','a','new']);
const overviewHTML=sortedPanel.overview(),historyHTML=sortedPanel.historyView();
for(const html of [overviewHTML,historyHTML])assert.ok(html.indexOf('<h2>Alpha')<html.indexOf('<h2>beta')&&html.indexOf('<h2>beta')<html.indexOf('<h2>Zulu'));
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
 resetPanel.info={source_fields:[],room_fields:[]};resetPanel.tab='settings';
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
assert.match(friendlyHTML,/<option value="sensor.bedroom_temperature" selected>Bedroom temperature<\/option>/);
assert.match(friendlyHTML,/<option value="sensor.other" >Bedroom temperature<\/option>/);
const visibleLabels=[...friendlyHTML.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map(m=>m[1]);
assert.ok(visibleLabels.every(label=>!label.includes('sensor.')&&!label.includes(' · ')));
const retainedName=namePanel.field(['temperature_entity','Temperature','sensor',{kind:'temperature'}],{temperature_entity:'sensor.humidity'},'room0');
assert.match(retainedName,/>Bedroom humidity \(does not match filter\)<\/option>/);
console.log('Friendly-name selector tests passed (selected names, distinct IDs for duplicate names, retained names).');

const groupedPanel=new Component();groupedPanel._hass={states:{}};
groupedPanel.settings={boost:1.5,setback:1,lag_hours:3,water_reference:32,price_entity:'',rooms:[]};
groupedPanel.info={source_fields:[['price_entity','Price','sensor',{kind:'price'}],['boost','Boost','number',0,5],['setback','Reduction','number',0,5],['lag_hours','Lag','number',.25,12]],room_fields:[]};
const groupedHTML=groupedPanel.settingsView();
const sharedSection=groupedHTML.match(/<section class="settings-shared"><h2>Shared room settings<\/h2>[\s\S]*?<\/section>/)[0];
for(const key of ['boost','setback','lag_hours']){
 assert.match(sharedSection,new RegExp(`data-field="source.${key}"`));
 assert.equal(groupedHTML.split(`data-field="source.${key}"`).length-1,1);
}
assert.ok(!sharedSection.includes('source.price_entity'));
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
assert.match(previewSettings,/Shared room settings/);
assert.match(previewSettings,/source.start_offset_minutes/);assert.match(previewSettings,/source.stop_offset_minutes/);
assert.doesNotMatch(previewSettings,/standing charge|room\d+\.activity_attribute|room\d+\.active_value|room\d+\.design_room_temp/i);
for(const field of [...previewInfo.source_fields,...previewInfo.room_fields])assert.ok(!/, C$/.test(field[1]),field[1]);
assert.match(previewSettings,/Target temperature \(°C\)/);
const planHTML=previewPanel.overview();assert.match(planHTML,/Thermostat timing/);assert.match(planHTML,/Change target at/);
console.log('Version 0.1.39 preview tests passed (offset controls, simplified rooms, Celsius labels, timing table).');
for(const [value,color] of [[-5,'#40ff00'],[0,'#40ff00'],[14.99,'#40ff00'],[15,'#ccff66'],[20,'#ffff00'],[25,'#ffcc00'],[35,'#ff9933'],[50,'#ff0000'],[60,'#cc0000'],[90,'#cc0000']])assert.equal(vm.runInContext(`priceColor(${value})`,context),color);
const pricePanel=new Component();pricePanel.settings={rooms:Array.from({length:10},(_,i)=>({id:'r'+i,name:'Room '+i}))};pricePanel.clientWidth=3300;pricePanel.historyHours=48;
const priceTime=Date.now()-300000;
pricePanel.info={data:{price_chart:[{start:new Date(priceTime).toISOString(),end:new Date(priceTime+900000).toISOString(),price:-5}],rooms:{r0:{plan:{commands:[{time:new Date(priceTime).toISOString(),action:'raise'},{time:new Date(priceTime+600000).toISOString(),action:'lower'}]}}}}};
let priceHTML=pricePanel.priceChart();assert.match(priceHTML,/height:566px/);assert.match(priceHTML,/id="price-accordion" open/);assert.match(priceHTML,/Suggested heating On/);assert.doesNotMatch(priceHTML,/NaN/);pricePanel.clientWidth=1200;assert.match(pricePanel.priceChart(),/height:566px/);
pricePanel.history=[{room_id:'r0',time:priceTime/1000,price:60,suggested_heat:1,activity:1}];priceHTML=pricePanel.priceChart(true);assert.match(priceHTML,/height:746px/);assert.match(priceHTML,/Actual relay On/);assert.match(priceHTML,/#cc0000/);pricePanel.history=[{room_id:'r0',time:priceTime/1000}];assert.match(pricePanel.priceChart(true),/Total electricity price/);const savedPublished=pricePanel.info.data.price_chart;pricePanel.info.data.price_chart=[];assert.match(pricePanel.priceChart(true),/No electricity prices are available for this period/);pricePanel.info.data.price_chart=savedPublished;
console.log('Electricity chart checks passed: thresholds, negative prices, real windows, missing history, ten rooms, fixed height.');
// Size the SVG from its rendered viewport immediately and on resize.
let sizingComponent,resizeCallback,replacedHTML,disconnects=0;
const sizingContext={...context,document:{createElement:()=>{const template={innerHTML:''};template.content={querySelector:()=>({html:template.innerHTML})};return template;}},customElements:{get:()=>undefined,define:(name,value)=>sizingComponent=value},ResizeObserver:class{constructor(callback){resizeCallback=callback;}observe(){}disconnect(){disconnects++;}}};
vm.createContext(sizingContext);vm.runInContext(fs.readFileSync(path.join(__dirname,'../custom_components/thermal_pilot/frontend/panel.js'),'utf8'),sizingContext);
const sized=new sizingComponent();sized.settings=pricePanel.settings;sized.info=pricePanel.info;sized.tab='overview';
const viewport={clientWidth:3024,querySelector:()=>({replaceWith:svg=>replacedHTML=svg.html})};sized.shadowRoot.querySelector=()=>viewport;sized.mountPriceChartSizing();
assert.equal(sized.priceChartWidth,3000);assert.match(replacedHTML,/viewBox="0 0 3000 566"/);resizeCallback([{contentRect:{width:1800}}]);assert.match(replacedHTML,/viewBox="0 0 1800 566"/);resizeCallback([{contentRect:{width:0}}]);assert.equal(sized.priceChartWidth,1800);sized.mountPriceChartSizing();assert.equal(disconnects,1);
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

const statusPanel=new Component();statusPanel.settings={rooms:[],heating_enabled:true};statusPanel.info={data:{rooms:{},history_info:{started_at:1791590400}}};const statusOrder=statusPanel.overview();const order=['Operation','Outdoor temperature','Heating water temperature','Data collection','Stored history','Last update'];for(let i=1;i<order.length;i++)assert(statusOrder.indexOf('<dt>'+order[i-1])<statusOrder.indexOf('<dt>'+order[i]));assert.doesNotMatch(statusOrder,/toggle-active/);assert.match(statusOrder,/Collection started:/);
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
assert.match(flamePanel.overview(),/<summary><h2>Room [^]*?room-heating actual/);
assert.match(flamePanel.historyView(),/<summary><h2>Room [^]*?room-heating actual/);
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
  assert.match(html,/foreignObject x="20" y="179"/);
  const firstLane=html.match(/<rect x="(\d+)" y="204" width="([\d.]+)" height="14"/);
  assert.ok(firstLane);assert.ok(Number(firstLane[1])+Number(firstLane[2])<=width);
 }
 const temperature=mobile.chart(samples,'temperature','prediction');
 const width=Number(temperature.match(/viewBox="0 0 (\d+)/)[1]);
 assert.ok(width<=screen);assert.doesNotMatch(temperature,/NaN/);
}
resizeCallback([{contentRect:{width:280}}]);assert.match(replacedHTML,/viewBox="0 0 280 806"/);
resizeCallback([{contentRect:{width:1800}}]);assert.match(replacedHTML,/viewBox="0 0 1800 566"/);
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
