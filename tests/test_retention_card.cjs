const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path');
const definitions=new Map(),timers=new Map();let nextTimer=0;
class Element{
 attachShadow(){const root={innerHTML:'',handlers:[],querySelector:()=>null,querySelectorAll(selector){if(selector!=='[data-sort]')return [];this.handlers=Array.from(this.innerHTML.matchAll(/data-sort="([^"]+)"/g),match=>({dataset:{sort:match[1]},addEventListener(type,handler){this.click=handler;}}));return this.handlers;}};this.shadowRoot=root;}
 dispatchEvent(event){this.event=event;}
}
const context={HTMLElement:Element,customElements:{get:key=>definitions.get(key),define:(key,value)=>definitions.set(key,value)},setInterval:fn=>{timers.set(++nextTimer,fn);return nextTimer;},clearInterval:id=>timers.delete(id),CustomEvent:class{constructor(type,options){this.type=type;Object.assign(this,options);}},console};
vm.createContext(context);const src=fs.readFileSync(path.join(__dirname,'../custom_components/thermal_pilot/frontend/heat-retention-card.js'),'utf8');vm.runInContext(src,context);
const Card=definitions.get('thermal-pilot-heat-retention-card'),Editor=definitions.get('thermal-pilot-heat-retention-card-editor');
const room=(id,hours,updated=true,is_garage=false)=>({id,name:id,is_garage,heat_retention:{drop_6h:6/hours,hours_per_degree:hours,updated}});
const sample={language:'fi',entries:[{entry_id:'one',title:'Home'}],rooms:[room('Garage',12,true,true),room('Fast',.5),room('Slow',9),room('Learning',4,false)]};
(async()=>{
 const card=new Card(),calls=[];card.setConfig({});card.hass={language:'en',connection:{},callWS:async request=>{calls.push(request);return structuredClone(sample);}};
 assert.equal(calls.length,0);card.connectedCallback();await new Promise(setImmediate);
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{type:'thermal_pilot/retention'}]);
 assert.match(card.shadowRoot.innerHTML,/Huone/);assert.match(card.shadowRoot.innerHTML,/Mukautuva/);assert.doesNotMatch(card.shadowRoot.innerHTML,/<h2|<p>|<summary/);
 assert.deepEqual(Array.from(card.sortedRooms(),r=>r.id),['Slow','Learning','Fast','Garage']);
 const headers=card.shadowRoot.handlers;headers.find(button=>button.dataset.sort==='drop_1c').click();
 assert.deepEqual(Array.from(card.sortedRooms(),r=>r.id),['Fast','Learning','Slow','Garage']);
 card.shadowRoot.handlers.find(button=>button.dataset.sort==='drop_1c').click();assert.equal(card.sortedRooms()[0].id,'Slow');
 card.shadowRoot.handlers.find(button=>button.dataset.sort==='cooling_speed').click();assert.deepEqual(Array.from(card.sortedRooms(),r=>r.id),['Fast','Slow','Learning','Garage']);
 card.setConfig({columns:[]});await new Promise(setImmediate);assert.equal((card.shadowRoot.innerHTML.match(/<th scope=/g)||[]).length,1);assert.match(card.shadowRoot.innerHTML,/Huone/);
 card.setConfig({columns:['cooling_speed','room','cooling_speed']});await new Promise(setImmediate);assert.equal((card.shadowRoot.innerHTML.match(/<th scope=/g)||[]).length,2);
 assert.throws(()=>card.setConfig({columns:['wrong']}),/Invalid columns/);
 sample.language='de';await card.refresh();assert.match(card.shadowRoot.innerHTML,/Raum/); // Integration language overrides HA English.
 card.setConfig({entry_id:'two'});await new Promise(setImmediate);assert.equal(calls.at(-1).entry_id,'two');
 sample.rooms[0].name='<img src=x onerror=alert(1)>';await card.refresh();assert.doesNotMatch(card.shadowRoot.innerHTML,/<img/);assert.match(card.shadowRoot.innerHTML,/&lt;img/);
 card._hass.callWS=async()=>{throw Error('private server detail');};await card.refresh();assert.doesNotMatch(card.shadowRoot.innerHTML,/private server detail|<td>Slow/);assert.match(card.shadowRoot.innerHTML,/colspan=/);
 assert.ok(timers.size);card.disconnectedCallback();assert.equal(timers.size,0);
 const titled=new Card();titled.setConfig({title:'My <garage> & rooms'});assert.match(titled.shadowRoot.innerHTML,/<h2 class="title">My &lt;garage&gt; &amp; rooms<\/h2>/);
 titled.setConfig({title:'   '});assert.doesNotMatch(titled.shadowRoot.innerHTML,/<h2/);
 assert.throws(()=>titled.setConfig({title:123}),/title must be text/);
 // An old integration response must not overwrite a newly selected integration.
 let finishOld;const raced=new Card();raced.connectedCallback();let count=0;raced.hass={connection:{},callWS:()=>++count===1?new Promise(resolve=>finishOld=resolve):Promise.resolve({...sample,entry_id:'new'})};
 raced.setConfig({entry_id:'new'});finishOld({...sample,entry_id:'old'});await new Promise(setImmediate);assert.equal(raced._data.entry_id,'new');raced.disconnectedCallback();
 const editor=new Editor();editor.setConfig({columns:[]});editor.update({columns:['room','model']});assert.equal(editor.event.type,'config-changed');assert.deepEqual(Array.from(editor.event.detail.config.columns),['model']);assert.match(editor.shadowRoot.innerHTML,/checked disabled/);
 // Simulate HA echoing every typed title back through setConfig.
 const typing=new Editor();let renders=0;const renderEditor=typing.render.bind(typing);typing.render=()=>{renders++;renderEditor();};typing.setConfig({});
 typing.dispatchEvent=event=>{typing.event=event;typing.setConfig(event.detail.config);};
 for(const text of ['M','My','My room','My room title'])typing.update({title:text});
 assert.equal(renders,1);assert.equal(typing._config.title,'My room title');
 typing.setConfig({...typing.event.detail.config,title:'Externally changed'});assert.equal(renders,2);
 // A late integration-list refresh also preserves focus and the selection/caret.
 let focused=false,selection;
 typing.shadowRoot.activeElement={matches:selector=>selector==='[data-title]',selectionStart:3,selectionEnd:7,selectionDirection:'forward'};
 typing.shadowRoot.querySelector=selector=>selector==='[data-title]'?{addEventListener(){},focus(){focused=true;},setSelectionRange(...args){selection=args;}}:null;
 typing.render();assert.equal(focused,true);assert.deepEqual(selection,[3,7,'forward']);
 const languagesCard=new Card();languagesCard._data=structuredClone(sample);languagesCard._data.language='fi';
 assert.equal(languagesCard.t('Room'),'Huone');languagesCard._config={...languagesCard._config,language:'en'};assert.equal(languagesCard.t('Room'),'Room');
 languagesCard._config.language='de';assert.equal(languagesCard.t('Room'),'Raum');languagesCard._config.language='auto';assert.equal(languagesCard.t('Room'),'Huone');
 assert.throws(()=>languagesCard.setConfig({language:'invalid'}),/Invalid card language/);
 const languageEditor=new Editor();languageEditor.setConfig({language:'fi'});assert.match(languageEditor.shadowRoot.innerHTML,/data-language/);assert.match(languageEditor.shadowRoot.innerHTML,/value="fi" selected/);
 assert.match(languageEditor.shadowRoot.innerHTML,/value="auto"/);assert.match(languageEditor.shadowRoot.innerHTML,/value="hu"/);
 // Card badges use exactly the panel's bands, including typed construction references.
 const panelContext={HTMLElement:class{},customElements:{get:()=>true},location:{pathname:''}};vm.createContext(panelContext);vm.runInContext(fs.readFileSync(path.join(__dirname,'../custom_components/thermal_pilot/frontend/panel.js'),'utf8'),panelContext);
 for(const reference of [null,2.12])for(const hours of [.5,1,2,4,8,12])for(const updated of [true,false]){
  const value={hours_per_degree:hours,reference_hours:reference,updated};const expected=vm.runInContext('retentionRating('+JSON.stringify(value)+').level',panelContext);
  const html=card.cell('cooling_speed',{heat_retention:value},1);assert.match(html,new RegExp('rating '+expected+'"'));
 }
 assert.equal(context.customCards.length,1);vm.runInContext(src,context);assert.equal(context.customCards.length,1);
 console.log('Dashboard card passed: columns, sorting, garage grouping, integration language, escaping, read-only polling, cleanup, response races, editor and badge parity.');
})().catch(error=>{console.error(error);process.exitCode=1;});
