const {readFrontendSource}=require('./frontend_source.cjs');
/* Activation confirmation test with a fake form; no browser or device control. */
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
let Component,allow=false,submit,calls=[];
const form={addEventListener:(name,fn)=>{if(name==='submit')submit=fn;},querySelector:()=>({textContent:''}),querySelectorAll:()=>[]};
class Element{attachShadow(){this.shadowRoot={innerHTML:'',querySelectorAll:()=>[],querySelector:id=>id==='#settings'?form:null};}}
const context={HTMLElement:Element,customElements:{get:()=>undefined,define:(_,value)=>Component=value},structuredClone,Date,Number,String,Object,Math,JSON,Infinity,console,setInterval,clearInterval,setTimeout:()=>0,clearTimeout,confirm:()=>allow};
vm.createContext(context);vm.runInContext(readFrontendSource(path.join(__dirname,'../custom_components/thermal_pilot/frontend/panel.js')),context);
(async()=>{
 const panel=new Component();panel.tab='settings';panel.settings={rooms:[],simulation_enabled:false};panel.info={settings:{rooms:[],simulation_enabled:true,live_control_confirmed:false},source_fields:[],room_fields:[]};
 panel.capture=()=>{};panel.call=async(type,payload)=>{calls.push({type,payload});return {saved:true};};panel.render();
 await submit({preventDefault(){}});assert.equal(calls.length,0);assert.equal(panel.saving,undefined);
 allow=true;await submit({preventDefault(){}});assert.equal(calls.length,1);assert.equal(calls[0].payload.enable_live_control,true);assert.equal(panel.settings.live_control_confirmed,true);
 const badges=panel.controlBadges();assert.match(badges,/>Active: Live control</);assert.doesNotMatch(badges,/Confirmation required/);
 panel.settings.simulation_enabled=true;panel.render();await submit({preventDefault(){}});assert.equal(calls[1].payload.enable_live_control,false);assert.equal(panel.settings.live_control_confirmed,false);
 console.log('Live activation confirmation, cancellation and return-to-simulation tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
