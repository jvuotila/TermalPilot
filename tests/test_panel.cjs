/* Template tests without a browser. This does not verify visual rendering. */
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
let Component;
class Element {
  attachShadow(){this.shadowRoot={innerHTML:'',querySelectorAll:()=>[],querySelector:()=>null};}
}
const context={HTMLElement:Element,customElements:{get:()=>undefined,define:(name,value)=>{Component=value;}},
  structuredClone,Date,Number,String,Object,Math,JSON,Infinity,console,setInterval,clearInterval,setTimeout};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../custom_components/termal_pilot/frontend/panel.js'),'utf8'),context);
const panel=new Component();
panel._hass={states:{'sensor.price':{entity_id:'sensor.price',attributes:{friendly_name:'<script>alert(1)</script>'}}}};
panel.settings={heating_enabled:true,apply_season_setpoints:false,rooms:[]};
panel.info={settings:panel.settings,source_fields:[['price_entity','Price sensor','sensor']],room_fields:[],room_defaults:{},data:{warnings:[],rooms:{},history_info:{rows:0,bytes:0},collection:{collecting:false},heating_active:true}};
panel.tab='settings';panel.render();assert.match(panel.shadowRoot.innerHTML,/Save settings/);assert.match(panel.shadowRoot.innerHTML,/data-field="source.price_entity"/);assert.match(panel.shadowRoot.innerHTML,/&lt;script&gt;/);assert.doesNotMatch(panel.shadowRoot.innerHTML,/<script>alert/);
panel.tab='overview';panel.render();assert.match(panel.shadowRoot.innerHTML,/Simulation status/);assert.match(panel.shadowRoot.innerHTML,/Set passive/);assert.match(panel.shadowRoot.innerHTML,/your existing automation remains in control/);
panel.settings.apply_season_setpoints=true;panel.render();assert.match(panel.shadowRoot.innerHTML,/SEASON SETPOINT CONTROL ENABLED/);
panel.tab='history';panel.history=[];panel.render();assert.match(panel.shadowRoot.innerHTML,/Season archives/);assert.match(panel.shadowRoot.innerHTML,/Download observations as CSV/);
console.log('Panel template tests passed (settings, status, history, command-mode banner, escaping).');
