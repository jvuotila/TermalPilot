// Share the Plan chart renderer, localization and hover details with the panel.
// Use the same versioned module URL as the sidebar; custom elements register only once.
await import(new URL(`./panel.js${new URL(import.meta.url).search}`, import.meta.url));
(() => {
const Panel=customElements.get('thermal-pilot-panel');
const tpI18n=globalThis.__thermalPilotLocalization;
const cardLanguages=tpI18n.languageNames;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function validate(value){
 for(const key of ['show_weather','show_prices'])if(value[key]!==undefined&&typeof value[key]!=='boolean')throw Error(key+' must be a boolean.');
 if(value.language!==undefined&&value.language!=='auto'&&!Object.hasOwn(cardLanguages,value.language))throw Error('Invalid card language.');if(value.title!==undefined&&typeof value.title!=='string')throw Error('title must be text.');if(value.entry_id!==undefined&&typeof value.entry_id!=='string')throw Error('entry_id must be text.');return {...value};}
const css=`:host{display:block;color:var(--primary-text-color,#213547);font:14px system-ui}*{box-sizing:border-box}ha-card{display:block;overflow:hidden;border-radius:var(--ha-card-border-radius,12px);background:var(--ha-card-background,var(--card-background-color,#edf4fa));border:1px solid var(--ha-card-border-color,var(--divider-color,#bccbd0));box-shadow:var(--ha-card-box-shadow,0 2px 5px #0000000a)}.title{margin:0;padding:20px 20px 4px;font-size:var(--ha-card-header-font-size,20px);line-height:1.4;font-weight:500;overflow-wrap:anywhere}.price-card{padding:8px 12px 12px;margin:0!important;background:transparent!important;border:0}.weather-density{display:flex;align-items:center;gap:8px;font-size:13px;margin:0 0 10px}.weather-density select{font:inherit;padding:6px;max-width:220px}.price-chart-viewport svg text{font-family:system-ui}.chart-tooltip{position:fixed;z-index:10000;pointer-events:none;max-width:min(360px,calc(100vw - 24px));padding:10px 12px;border-radius:8px;background:#213547;color:white;white-space:pre-line;line-height:1.5;box-shadow:0 4px 16px #0004}.chart-tooltip[hidden]{display:none}.message{padding:20px;color:var(--secondary-text-color,#526b75)}`;
class PlanChartCard extends Panel{
 constructor(){super();this._config={};this._request=0;this._connected=false;this.loaded=true;this.settings={language:'en',rooms:[],heating_zones:[]};}
 static getStubConfig(){return {};}
 static getConfigElement(){return document.createElement('thermal-pilot-plan-chart-card-editor');}
 setConfig(value){this._config=validate(value);this._request++;this.info=null;this.render();this.refresh();}
 set hass(value){const changed=this._hass?.connection!==value?.connection;this._hass=value;if(changed||!this.info)this.refresh();}
 connectedCallback(){this._connected=true;this.refresh();clearInterval(this._timer);this._timer=setInterval(()=>this.refresh(),60000);}
 disconnectedCallback(){this._connected=false;this._request++;this._loading=false;clearInterval(this._timer);this.priceResizeObserver?.disconnect();}
 getCardSize(){return Math.max(4,Math.ceil((this._chartHeight||400)/50));}
 getGridOptions(){return {columns:12,min_columns:6};}
 // Also used by the shared resize handler: always render the compact Plan variant.
 chartVisibility(){return {weather:this._config.show_weather!==false,prices:this._config.show_prices!==false};}
 priceChart(){return super.priceChart(false,true);}
 async refresh(){
  if(!this._connected||!this._hass?.callWS||this._loading)return;
  const request=++this._request;this._loading=true;
  try{const result=await this._hass.callWS({type:'thermal_pilot/plan_chart',...(this._config.entry_id?{entry_id:this._config.entry_id}:{})});if(request!==this._request)return;
   this.info=result;this._integrationLanguage=result.settings?.language;this.settings={...(result.settings||{language:this._hass.language||'en',rooms:[],heating_zones:[]})};this.statusHistory=result.history||[];this._error=false;
  }catch(error){if(request!==this._request)return;this._error=true;}
  finally{if(request===this._request){this._loading=false;this.render();}else if(this._connected){this._loading=false;this.refresh();}}
 }
 render(){
  this.priceResizeObserver?.disconnect();
  this.settings.language=this._config.language&&this._config.language!=='auto'?this._config.language:this._integrationLanguage||this.settings.language||'en';
  const language=this.settings?.language||this._hass?.language||'en',t=text=>tpI18n.cardText(text,language);tpI18n.watch(this,language);
  let message=this._error?(t("Unable to load ThermalPilot data.")):!this.info?(t("Loading…")):this.info.requires_selection?(t("Choose a ThermalPilot integration in the card settings.")):!this.info.entries?.length?(t("ThermalPilot is not loaded.")):null;
  this.shadowRoot.innerHTML=`<style>${css}</style><ha-card>${this._config.title?.trim()?`<h2 class="title" data-user-text>${esc(this._config.title)}</h2>`:''}${message?`<div class="message" role="status">${esc(message)}</div>`:this.priceChart()}</ha-card>`;
  if(!message){this.translateRoot(this.shadowRoot);this.mountPriceChartSizing();const svg=this.shadowRoot.querySelector('svg');this._chartHeight=Number(svg?.getAttribute('height'))||svg?.getBoundingClientRect?.().height||400;}
 }
}
class PlanChartEditor extends HTMLElement{
 constructor(){super();this.attachShadow({mode:'open'});this._entries=[];}
 setConfig(value){const next=validate(value),previous=this._config;this._config=next;if(previous&&previous.title===next.title&&previous.entry_id===next.entry_id&&(previous.language||'auto')===(next.language||'auto')&&previous.show_weather===next.show_weather&&previous.show_prices===next.show_prices)return;this.render();}
 set hass(value){this._hass=value;if(!this._asked&&value?.callWS){this._asked=true;value.callWS({type:'thermal_pilot/retention'}).then(result=>{this._entries=result.entries||[];this._integrationLanguage=result.language;this.render();}).catch(()=>{});}}
 update(patch){this._config={...this._config,...patch};this.dispatchEvent(new CustomEvent('config-changed',{detail:{config:this._config},bubbles:true,composed:true}));}
 render(){
  if(!this._config)return;const input=this.shadowRoot.activeElement,focus=input?.matches?.('[data-title]')?{start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection}:null,language=(this._config.language&&this._config.language!=='auto'?this._config.language:this._integrationLanguage||this._hass?.language||'en'),t=text=>tpI18n.cardText(text,language);tpI18n.watch(this,language);
  this.shadowRoot.innerHTML=`<style>:host{display:block;color:var(--primary-text-color);font:14px system-ui}label{display:flex;align-items:center;gap:12px;padding:12px 0}input,select{font:inherit;padding:8px;max-width:100%}</style><label>${t("Title (optional)")}<input data-title type="text" value="${esc(this._config.title||'')}"></label><label>${t("Integration")}<select data-entry><option value="">${t("Automatic (single integration)")}</option>${this._entries.map(entry=>`<option value="${esc(entry.entry_id)}" ${entry.entry_id===this._config.entry_id?'selected':''}>${esc(entry.title)}</option>`).join('')}</select></label><label>${t("Language")} <select data-language><option value="auto" ${!this._config.language||this._config.language==='auto'?'selected':''}>${t("Use integration language")}</option>${Object.entries(cardLanguages).sort((a,b)=>a[1].localeCompare(b[1],'en')).map(([code,name])=>`<option value="${code}" ${this._config.language===code?'selected':''}>${esc(name)}</option>`).join('')}</select></label><label><input type="checkbox" data-show-weather ${this._config.show_weather!==false?'checked':''}>${t('Show weather forecast')}</label><label><input type="checkbox" data-show-prices ${this._config.show_prices!==false?'checked':''}>${t('Show electricity prices')}</label>`;
  this.shadowRoot.querySelector('[data-show-weather]')?.addEventListener('change',event=>this.update({show_weather:event.target.checked}));
  this.shadowRoot.querySelector('[data-show-prices]')?.addEventListener('change',event=>this.update({show_prices:event.target.checked}));
  this.shadowRoot.querySelector('[data-title]')?.addEventListener('input',event=>this.update({title:event.target.value}));
  this.shadowRoot.querySelector('[data-entry]')?.addEventListener('change',event=>this.update({entry_id:event.target.value}));
 this.shadowRoot.querySelector('[data-language]')?.addEventListener('change',event=>this.update({language:event.target.value}));
  if(focus){const title=this.shadowRoot.querySelector('[data-title]');title?.focus({preventScroll:true});title?.setSelectionRange(focus.start,focus.end,focus.direction);}
 }
}
if(!customElements.get('thermal-pilot-plan-chart-card'))customElements.define('thermal-pilot-plan-chart-card',PlanChartCard);
if(!customElements.get('thermal-pilot-plan-chart-card-editor'))customElements.define('thermal-pilot-plan-chart-card-editor',PlanChartEditor);
globalThis.customCards=globalThis.customCards||[];
if(!globalThis.customCards.some(card=>card.type==='thermal-pilot-plan-chart-card'))globalThis.customCards.push({type:'thermal-pilot-plan-chart-card',name:'ThermalPilot heating plan',description:'Electricity prices and heating timelines for rooms, garages and zones.',preview:true});
})();
