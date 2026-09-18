"use strict";
// RUNTIME_COMPONENT_TEST: navigation/controller with DOM and HTTP doubles, no paid services.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(__dirname+'/../public/admin.html','utf8');
assert.ok(html.includes('data-admin-tab="ai"'),'AI management must be a first-level tab');
const source=fs.readFileSync(__dirname+'/../public/assets/admin.js','utf8');
const start=source.indexOf('function initializeAdminNavigation()'),end=source.indexOf('\nfunction ',start+1);
const panels=new Map(),buttons=['availability','pricing','bundles','ai','feedback','other'].map(tab=>({dataset:{adminTab:tab},classList:{toggle(){}}}));
const select={value:''};const document={querySelector:key=>{if(!panels.has(key))panels.set(key,{dataset:{}});return panels.get(key);},querySelectorAll:()=>buttons,getElementById:id=>id==='adminTabSelect'?select:document.querySelector('#'+id)};
const events=[];const window={dispatchEvent:event=>{events.push(event);return true;}};
class CustomEvent{constructor(type,options){this.type=type;this.detail=options.detail;}}
vm.runInNewContext(source.slice(start,end)+';initializeAdminNavigation();',{document,$:id=>document.getElementById(id),window,CustomEvent});
for(const button of buttons){button.onclick();const visible=[...panels.values()].filter(p=>!p.hidden);assert.equal(visible.length,1);assert.equal(visible[0].dataset.adminPanel,button.dataset.adminTab);assert.equal(select.value,button.dataset.adminTab);assert.equal(events.at(-1).type,'junzan-admin-tab');assert.equal(events.at(-1).detail,button.dataset.adminTab);}
for(const button of buttons){select.value=button.dataset.adminTab;select.onchange();const visible=[...panels.values()].filter(p=>!p.hidden);assert.equal(visible.length,1);assert.equal(visible[0].dataset.adminPanel,button.dataset.adminTab);assert.equal(events.at(-1).detail,button.dataset.adminTab);}
console.log('PASS all six desktop tabs and mobile navigation isolate the selected panel (RUNTIME_COMPONENT_TEST)');
