"use strict";
// RUNTIME_COMPONENT_TEST: navigation/controller with DOM and HTTP doubles, no paid services.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(__dirname+'/../public/admin.html','utf8');
assert.ok(html.includes('data-admin-tab="ai"'),'AI management must be a first-level tab');
const source=fs.readFileSync(__dirname+'/../public/assets/admin.js','utf8');
const start=source.indexOf('function initializeAdminNavigation()'),end=source.indexOf('\nfunction ',start+1);
const panels=new Map(),buttons=['availability','pricing','bundles','ai','other'].map(tab=>({dataset:{adminTab:tab},classList:{toggle(){}}}));
const select={value:''};const document={querySelector:key=>{if(!panels.has(key))panels.set(key,{dataset:{}});return panels.get(key);},querySelectorAll:()=>buttons,getElementById:()=>select};
vm.runInNewContext(source.slice(start,end)+';initializeAdminNavigation();',{document,$:()=>select});
for(const button of buttons){button.onclick();const visible=[...panels.values()].filter(p=>!p.hidden);assert.equal(visible.length,1);assert.equal(visible[0].dataset.adminPanel,button.dataset.adminTab);assert.equal(select.value,button.dataset.adminTab);}
select.value='ai';select.onchange();assert.equal([...panels.values()].find(p=>p.dataset.adminPanel==='ai').hidden,false);
console.log('PASS all five desktop tabs and mobile navigation isolate the selected panel (RUNTIME_COMPONENT_TEST)');
