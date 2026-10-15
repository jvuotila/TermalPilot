const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path');
const definitions=new Map(),timers=new Set();let timer=0;
class Element{attachShadow(){this.shadowRoot={innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[]};}dispatchEvent(event){this.event=event;}}
const context={HTMLElement:Element,customElements:{get:name=>definitions.get(name),define:(name,value)=>definitions.set(name,value)},setInterval:()=>{timers.add(++timer);return timer;},clearInterval:id=>timers.delete(id),console,CustomEvent:class{constructor(type,options){this.type=type;Object.assign(this,options);}},Date,structuredClone};vm.createContext(context);
const base=path.join(__dirname,'../custom_components/thermal_pilot/frontend/');vm.runInContext(fs.readFileSync(base+'panel.js','utf8'),context);vm.runInContext(fs.readFileSync(base+'plan-chart-card.js','utf8').replace("import './panel.js';",''),context);
const Card=definitions.get('thermal-pilot-plan-chart-card'),Editor=definitions.get('thermal-pilot-plan-chart-card-editor'),now=Date.now();
const response={entries:[{entry_id:'home',title:'Home'}],settings:{language:'en',rooms:[{id:'room',name:'Kitchen'},{id:'garage',name:'Garage',is_garage:true,garage_strategy:'temperature'}],heating_zones:[{id:'zone',name:'Zone',heating_strategy:'tariff',main_room_id:'room'}]},data:{price_chart:[{start:new Date(now-3600000).toISOString(),end:new Date(now+86400000).toISOString(),price:10}],rooms:{room:{plan:{commands:[{action:'raise',time:new Date(now+3600000).toISOString()},{action:'restore',time:new Date(now+7200000).toISOString()}]}}}},history:[{room_id:'garage',time:now/1000-600,pump_mode:'heat'},{room_id:'zone:zone',zone_id:'zone',time:now/1000-600,zone_mode:'cool',zone_basis:'activity'}]};
(async()=>{
 const card=new Card(),calls=[];card.setConfig({});card.hass={language:'fi',connection:{},callWS:async request=>{calls.push(request);return structuredClone(response);}};
 card.connectedCallback();await new Promise(setImmediate);
 assert.equal(calls[0].type,'thermal_pilot/plan_chart');assert.equal(calls.length,1);
 let html=card.shadowRoot.innerHTML;
 assert.match(html,/Total electricity price/);assert.match(html,/data-pump-timeline="garage"/);assert.match(html,/data-zone-period="cool"/);assert.match(html,/data-zone-period="plan"/);
 assert.doesNotMatch(html,/<summary|<details|data-chart-notes|Today and tomorrow|All room timelines|<h2/);
 card.setConfig({title:'My <heating> & cooling',entry_id:'home'});await new Promise(setImmediate);html=card.shadowRoot.innerHTML;assert.match(html,/My &lt;heating&gt; &amp; cooling/);assert.equal(calls.at(-1).entry_id,'home');
 assert.match(card.priceChart(),/data-zone-period="plan"/); // Resize renderer keeps the dashboard variant.
 assert.doesNotMatch(card.priceChart(),/data-chart-notes|<summary/);
 card.priceChartWidth=400;assert.match(card.priceChart(),/viewBox="0 0 400 /);
 card.priceChartWidth=1200;assert.match(card.priceChart(),/viewBox="0 0 1200 /);
 assert.throws(()=>card.setConfig({title:123}),/title must be text/);
 card._hass.callWS=async()=>{throw Error('secret');};await card.refresh();assert.match(card.shadowRoot.innerHTML,/Unable to load/);assert.doesNotMatch(card.shadowRoot.innerHTML,/secret/);
 let disconnected=false;card.priceResizeObserver={disconnect(){disconnected=true;}};card.disconnectedCallback();assert.equal(disconnected,true);assert.equal(timers.size,0);
 const editor=new Editor();let renders=0;const render=editor.render.bind(editor);editor.render=()=>{renders++;render();};editor.setConfig({});editor.dispatchEvent=event=>editor.setConfig(event.detail.config);for(const title of ['H','He','Heat'])editor.update({title});assert.equal(renders,1);
 // Use the exact same integration language renderer, never the viewer's HA language.
 assert.equal(card.t('Rooms'),'Rooms');card.settings.language='fi';assert.equal(card.t('Rooms'),'Huoneet');
 const languageCard=new Card();languageCard._integrationLanguage='fi';languageCard.info=structuredClone(response);languageCard.settings=structuredClone(response.settings);languageCard._config={language:'en'};languageCard.render();assert.equal(languageCard.t('Rooms'),'Rooms');
 languageCard._config.language='auto';languageCard.render();assert.equal(languageCard.t('Rooms'),'Huoneet');
 languageCard._config.language='de';languageCard.render();assert.notEqual(languageCard.t('Rooms'),'Rooms');
 assert.equal(response.settings.language,'en');assert.throws(()=>languageCard.setConfig({language:'invalid'}),/Invalid card language/);
 const languageEditor=new Editor();languageEditor.setConfig({language:'fi'});assert.match(languageEditor.shadowRoot.innerHTML,/data-language/);assert.match(languageEditor.shadowRoot.innerHTML,/value="fi" selected/);assert.match(languageEditor.shadowRoot.innerHTML,/value="auto"/);assert.match(languageEditor.shadowRoot.innerHTML,/value="hu"/);
 console.log('Plan dashboard card passed: shared renderer, compact content, title, timelines and plans, resizing, language, read-only refresh, cleanup and stable editor.');
})().catch(error=>{console.error(error);process.exitCode=1;});
