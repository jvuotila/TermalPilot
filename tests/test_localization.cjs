/* Exercise the production catalog loader with mocked HTTP, without inline fixture catalogs. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'../custom_components/thermal_pilot/frontend');
const catalogs=Object.fromEntries(fs.readdirSync(path.join(root,'languages')).filter(name=>name.endsWith('.json')).map(name=>[name.slice(0,-5),JSON.parse(fs.readFileSync(path.join(root,'languages',name),'utf8'))]));
function runtime(fetch){
 const context={URL,fetch,console:{warn:()=>{}}};vm.createContext(context);
 const source=fs.readFileSync(path.join(root,'localization.js'),'utf8').replace(/^const catalogBaseURL=.*$/m,"const catalogBaseURL=new URL('https://ha.example/thermal_pilot/languages/?v=test-version');").replace(/^export .*$/m,'');
 vm.runInContext(source,context);return context.__thermalPilotLocalization;
}
(async()=>{
 const requests=[];
 const i18n=runtime(async url=>{requests.push(String(url));const code=new URL(url).pathname.split('/').at(-1).replace('.json','');return {ok:true,json:async()=>catalogs[code]};});
 assert.equal(Object.keys(i18n.languageNames).length,25);
 assert.equal(i18n.translateText('History','fi'),'History','Unloaded languages use intact English fallback');
 await Promise.all([i18n.load('fi'),i18n.load('fi')]);
 assert.deepEqual(requests,['https://ha.example/thermal_pilot/languages/fi.json?v=test-version']);
 assert.equal(i18n.translateText('History','fi'),'Historia');
 assert.equal(i18n.cardText('Room','fi'),'Huone');
 assert.equal(i18n.cardText('Use integration language','fi'),'Käytä integraation kieltä');
 assert.equal(i18n.message('Forecast: {assessment} · {error}',{assessment:'Hyvä',error:'0,21 °C'},'fi'),'Ennuste: Hyvä · 0,21 °C');
 assert.equal(i18n.message('About {setting}',{setting:'My room: History'},'fi'),'Tietoa asetuksesta: My room: History','Inserted user text is preserved');
 assert.equal(i18n.translateText('Unlisted complete sentence.','fi'),'Unlisted complete sentence.');
 await i18n.load('fi');assert.equal(requests.length,1,'Loaded JSON is cached across the panel and cards');
 await i18n.load('de');assert.equal(i18n.translateText('Settings','de'),'Einstellungen');
 assert.equal(requests.length,2,'Only requested languages are fetched');
 for(const [code,catalog] of Object.entries(catalogs)){
  assert.equal(catalog.language,code);assert.ok(i18n.languageNames[code]);
  for(const section of ['messages','legacy','cardMessages']){
   assert.ok(catalog[section]);assert.ok(Object.values(catalog[section]).every(value=>typeof value==='string'));
  }
 }
 const broken=runtime(async()=>({ok:false,status:404}));
 await broken.load('fi');assert.equal(broken.ready('fi'),true);assert.equal(broken.translateText('History','fi'),'History');
 assert.equal(broken.cardText('Room','fi'),'Room','Missing catalog falls back without blocking the card');
 await broken.load('de');assert.equal(broken.translateText('About a setting','de'),'About a setting');
 const invalid=runtime(async()=>({ok:true,json:async()=>({...catalogs.fi,language:'de'})}));
 await invalid.load('fi');assert.equal(invalid.translateText('History','fi'),'History','Mismatched catalog cannot replace another language');
 let rerenders=0;const delayed=runtime(async()=>({ok:true,json:async()=>catalogs.fi})),owner={render(){rerenders++;}};
 delayed.watch(owner,'fi');delayed.watch(owner,'fi');await delayed.load('fi');await Promise.resolve();
 assert.equal(rerenders,1,'Catalog completion rerenders a waiting view once');
 for(const name of ['panel.js','heat-retention-card.js']){
  const source=fs.readFileSync(path.join(root,name),'utf8');
  assert.match(source,/await import\(new URL\(`\.\/localization\.js\$\{new URL\(import\.meta\.url\)\.search\}`/);
  assert.doesNotMatch(source,/const (?:finnishText|heatingFinnishText|translations)=\{/,'Translations belong in JSON catalogs');
 }
 console.log('Localization passed: 25 JSON catalogs, lazy versioned requests, shared cache, placeholders, language switching and English fallback.');
})().catch(error=>{console.error(error);process.exitCode=1;});
