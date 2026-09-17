"use strict";
// RUNTIME_COMPONENT_TEST: browser controller, synthetic DOM/HTTP, no external services.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class Node {constructor(tag,doc){Object.assign(this,{tagName:tag,ownerDocument:doc,children:[],dataset:{},textContent:'',value:'',disabled:false});}append(...n){this.children.push(...n);}replaceChildren(...n){this.children=n;}setAttribute(k,v){this[k]=v;}querySelectorAll(){return this.children.flatMap(n=>[n,...n.querySelectorAll()]);}}
(async()=>{
 const doc={createElement:t=>new Node(t,doc)},host=new Node('section',doc),operator=new Node('section',doc);
 let subscription={propertyId:'a',status:'EXPIRED',configuredStatus:'active',contractStart:'2026-01-01',contractEnd:'2026-09-01',monthlyLimit:1000};
 const quota={propertyId:'a',period:'2026-09',monthlyLimit:1000,used:327,remaining:673,aiEnabled:true};
 const writes=[];
 const fetch=async(url,options={})=>{const u=new URL(url,'https://fixture.invalid');let data;
  if(options.method==='PUT'){writes.push({path:u.pathname,body:JSON.parse(options.body)});subscription={...subscription,...JSON.parse(options.body),status:'ACTIVE'};data=subscription;}
  else if(u.pathname==='/api/admin/platform/properties')data={items:[{propertyId:'a',propertyName:'Fixture A'}]};
  else if(u.pathname.includes('subscription'))data=subscription;
  else if(u.pathname.includes('conversations'))data={items:[]};
  else if(u.pathname.endsWith('/usage'))data={today:1,week:2,day:'2026-09-17',weekStart:'2026-09-14'};
  else data=quota;
  return {ok:true,json:async()=>({ok:true,data})};
 };
 const context=vm.createContext({fetch,URLSearchParams});vm.runInContext(fs.readFileSync(__dirname+'/../public/assets/admin-ai-controls.js','utf8'),context);
 const controls=vm.runInContext('AiControls',context),platform=controls.createPlatform(host),field=(h,n)=>h.querySelectorAll().find(x=>x.dataset.field===n);
 await platform.load();field(host,'property').value='a';await field(host,'property').onchange();
 assert.ok(field(host,'contractStart'),'platform must expose contract controls');
 assert.equal(field(host,'contractEnd').value,'2026-09-01');
 field(host,'contractEnd').value='2027-10-14';field(host,'subscriptionEnabled').checked=true;await field(host,'saveSubscription').onclick();
 assert.deepEqual(writes[0],{path:'/api/platform/ai-subscriptions',body:{propertyId:'a',status:'active',contractStart:'2026-01-01',contractEnd:'2027-10-14',monthlyLimit:1000}});
 const editor=controls.createOperator(operator,{getPropertyId:()=> 'a'});await editor.load();
 assert.match(field(operator,'subscriptionStatus').textContent,/方案有效至 2027\/10\/14/);
 assert.match(field(operator,'quotaStatus').textContent,/673/);
 assert.equal(field(operator,'contractEnd'),undefined,'operator has no contract editor');
 subscription.status='EXPIRED';await editor.load();assert.match(field(operator,'subscriptionStatus').textContent,/方案已到期，AI 自動回覆已暫停/);
 subscription.status='UNCONFIGURED';await editor.load();assert.match(field(operator,'subscriptionStatus').textContent,/尚未設定/);
 subscription.status='LEGACY';await editor.load();assert.doesNotMatch(field(operator,'subscriptionStatus').textContent,/已到期|尚未設定/);
 assert.equal(writes.length,1,'operator load must never write subscription authority');
 console.log('PASS subscription platform edit/operator read-only/renewal/expiry/legacy display (RUNTIME_COMPONENT_TEST)');
})().catch(e=>{console.error(e);process.exitCode=1;});
