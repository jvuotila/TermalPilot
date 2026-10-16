/* Bundle JSON catalogs into VM fixtures and offline previews; production loads JSON on demand. */
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'../custom_components/thermal_pilot/frontend');
function localizationSource(){
 const catalogs=fs.readdirSync(path.join(root,'languages')).filter(file=>file.endsWith('.json')).map(file=>JSON.parse(fs.readFileSync(path.join(root,'languages',file),'utf8')));
 const runtime=fs.readFileSync(path.join(root,'localization.js'),'utf8').replace(/^const catalogBaseURL=.*$/m,"const catalogBaseURL='https://preview.invalid/languages/';").replace(/^export .*$/m,'');
 return `if(!globalThis.__thermalPilotLocalization){(()=>{${runtime}\n${JSON.stringify(catalogs).replace(/</g,'\\u003c')}.forEach(catalog=>localization.install(catalog));})();}\n`;
}
function readFrontendSource(file){
 return localizationSource()+fs.readFileSync(file,'utf8').replace(/^await import\(.*$/gm,'');
}
module.exports={readFrontendSource,localizationSource};
if(require.main===module)process.stdout.write(readFrontendSource(path.join(root,process.argv[2]||'panel.js')));
