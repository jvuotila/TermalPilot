/* Template tests without a browser. This does not verify visual rendering. */
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
let Component;
class Element {
  attachShadow(){this.shadowRoot={innerHTML:'',querySelectorAll:()=>[],querySelector:()=>null};}
}
const context={HTMLElement:Element,customElements:{get:()=>undefined,define:(name,value)=>{Component=value;}},
  structuredClone,Date,Number,String,Object,Math,JSON,Infinity,console,setInterval,clearInterval,setTimeout};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../custom_components/thermal_pilot/frontend/panel.js'),'utf8'),context);
const panel=new Component();
panel._hass={states:{'sensor.price':{entity_id:'sensor.price',attributes:{friendly_name:'<script>alert(1)</script>'}}}};
panel.settings={heating_enabled:true,apply_season_setpoints:false,rooms:[]};
panel.info={settings:panel.settings,source_fields:[['price_entity','Price sensor','sensor']],room_fields:[],room_defaults:{},data:{warnings:[],rooms:{},history_info:{rows:0,bytes:0},collection:{collecting:false},heating_active:true}};
panel.tab='settings';panel.render();assert.match(panel.shadowRoot.innerHTML,/Save settings/);assert.match(panel.shadowRoot.innerHTML,/data-field="source.price_entity"/);assert.match(panel.shadowRoot.innerHTML,/&lt;script&gt;/);assert.doesNotMatch(panel.shadowRoot.innerHTML,/<script>alert/);
panel.tab='overview';panel.render();assert.match(panel.shadowRoot.innerHTML,/Simulation status/);assert.match(panel.shadowRoot.innerHTML,/Set passive/);assert.match(panel.shadowRoot.innerHTML,/your existing automation remains in control/);
panel.settings.apply_season_setpoints=true;panel.render();assert.match(panel.shadowRoot.innerHTML,/SEASON SETPOINT CONTROL ENABLED/);
panel.tab='history';panel.history=[];panel.render();assert.match(panel.shadowRoot.innerHTML,/Season archives/);assert.match(panel.shadowRoot.innerHTML,/Download observations as CSV/);
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
assert.match(settingsHTML,/<summary>Alpha<\/summary>[\s\S]*?data-field="room2.name"/);
assert.deepEqual(sortedPanel.settings.rooms.map(r=>r.id),['z','b','a','new']);
const overviewHTML=sortedPanel.overview(),historyHTML=sortedPanel.historyView();
for(const html of [overviewHTML,historyHTML])assert.ok(html.indexOf('<h2>Alpha')<html.indexOf('<h2>beta')&&html.indexOf('<h2>beta')<html.indexOf('<h2>Zulu'));
let removalButtons=[];
sortedPanel.shadowRoot.querySelectorAll=selector=>{
 if(selector==='[data-field]')return [{dataset:{field:'room0.name'},type:'text',value:'Zulu edited'}];
 if(selector==='[data-remove]')return removalButtons=[...sortedPanel.shadowRoot.innerHTML.matchAll(/data-remove="(\d+)"/g)].map(m=>({dataset:{remove:m[1]}}));
 return [];
};
sortedPanel.render();removalButtons.find(b=>b.dataset.remove==='2').onclick();
assert.deepEqual(sortedPanel.settings.rooms.map(r=>r.id),['z','b','new']);
assert.equal(sortedPanel.settings.rooms[0].name,'Zulu edited');
console.log('Alphabetical room tests passed (Settings, Plan, History, stable IDs, editing and removal).');

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
groupedPanel.info={source_fields:[['price_entity','Price','sensor',{kind:'price'}],['boost','Boost','number',0,5],['setback','Reduction','number',0,5],['lag_hours','Lag','number',.25,12],['water_reference','Reference','number',20,55]],room_fields:[]};
const groupedHTML=groupedPanel.settingsView();
const sharedSection=groupedHTML.match(/<section><h2>Shared room settings<\/h2>[\s\S]*?<\/section>/)[0];
for(const key of ['boost','setback','lag_hours','water_reference']){
 assert.match(sharedSection,new RegExp(`data-field="source.${key}"`));
 assert.equal(groupedHTML.split(`data-field="source.${key}"`).length-1,1);
}
assert.ok(!sharedSection.includes('source.price_entity'));
console.log('Shared-room section tests passed (global controls grouped once, source fields separate).');

const preview=fs.readFileSync(path.join(__dirname,'../PREVIEW.html'),'utf8');
const previewInfo=JSON.parse(preview.match(/const demo=([\s\S]*?);const states=/)[1]);
const previewPanel=new Component();previewPanel._hass={states:{}};previewPanel.settings=previewInfo.settings;previewPanel.info=previewInfo;
const previewSettings=previewPanel.settingsView();
assert.match(previewSettings,/Shared room settings/);
assert.match(previewSettings,/source.start_offset_minutes/);assert.match(previewSettings,/source.stop_offset_minutes/);
assert.doesNotMatch(previewSettings,/standing charge|room\d+\.activity_attribute|room\d+\.active_value|room\d+\.design_room_temp/i);
for(const field of [...previewInfo.source_fields,...previewInfo.room_fields])assert.ok(!/, C$/.test(field[1]),field[1]);
assert.match(previewSettings,/Target temperature \(°C\)/);
const planHTML=previewPanel.overview();assert.match(planHTML,/Thermostat timing/);assert.match(planHTML,/Change target at/);
console.log('Version 0.1.4 preview tests passed (offset controls, simplified rooms, Celsius labels, timing table).');
