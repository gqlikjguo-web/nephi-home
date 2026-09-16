'use strict';
// RUNTIME_COMPONENT_TEST: actual controller, DOM/HTTP doubles; no external calls.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class Node{constructor(tag,ownerDocument){Object.assign(this,{tagName:tag,ownerDocument,children:[],dataset:{},textContent:'',hidden:false,checked:false});}append(...n){this.children.push(...n)}replaceChildren(...n){this.children=n}setAttribute(k,v){this[k]=v}querySelectorAll(){return this.children.flatMap(n=>[n,...n.querySelectorAll()])}}
(async()=>{const doc={createElement:t=>new Node(t,doc)},host=new Node('section',doc);let remaining=7,human=false;const writes=[];
const history=Object.freeze([{guestMessage:'客人原文 [AI]',replyText:'[AI] 正式保存原文',replyDelivered:true,processingStatus:'reply_succeeded',createdAt:'2026-09-17T01:00:00Z'},{guestMessage:'不回覆',replyText:'',replyDelivered:false,processingStatus:'no_reply'},{guestMessage:'資料不足',replyText:'',replyDelivered:true,processingStatus:'reply_succeeded'}].map(Object.freeze));const saved=JSON.stringify(history);
const ctx=vm.createContext({URLSearchParams,fetch:async(url,opts={})=>{const u=new URL(url,'https://fixture.invalid');let data;
if(opts.method==='PUT'){const body=JSON.parse(opts.body);writes.push(body);human=body.humanControlled;data={humanControlled:human};}
else if(u.pathname.endsWith('/history'))data={items:history,nextCursor:null};
else if(u.pathname.endsWith('/usage'))data={today:2,week:5,day:'2026-09-17',weekStart:'2026-09-14'};
else if(u.pathname.endsWith('/conversations'))data=u.searchParams.has('userId')?{humanControlled:human}:{items:[{channelId:'c',userId:'guest1',humanControlled:human},{channelId:'c',userId:'guest2',humanControlled:false}]};
else data={propertyId:'p',aiEnabled:true,used:80,monthlyLimit:100,remaining,period:'2026-09'};
return{ok:true,json:async()=>({ok:true,data})};}});
vm.runInContext(fs.readFileSync(__dirname+'/../public/assets/admin-ai-controls.js','utf8'),ctx);const ui=vm.runInContext('AiControls',ctx).createOperator(host,{getPropertyId:()=> 'p'});const field=n=>host.querySelectorAll().find(x=>x.dataset.field===n),text=n=>[n.textContent,...n.querySelectorAll().map(x=>x.textContent)].join(' ');
await ui.load();assert.match(text(host),/只計算實際使用的 AI 回覆額度。/);assert.doesNotMatch(text(host),/Luna|token|ledger|call|authority/);assert.match(field('quotaStatus').textContent,/本月剩餘 7 則，可正常使用/,'use server remaining, not limit-used');
await field('guestOpen').onclick();assert.equal(field('conversation').children[0].dataset.selected,'true');assert.equal(field('conversation').children[1].dataset.selected,'false');assert.match(text(field('history')),/\[AI\] 正式保存原文/);assert.match(text(field('history')),/AI 未回覆/);assert.match(text(field('history')),/尚無回覆內容/);assert.equal(JSON.stringify(history),saved);
await field('handoff').onclick();assert.deepEqual(writes[0],{channelId:'c',userId:'guest1',humanControlled:true});assert.equal(field('guestState').textContent,'人工接管中');assert.equal(field('handoffNote').textContent,'AI 已暫停回覆這位客人');assert.equal(field('handoff').textContent,'恢復 AI 回覆');
await field('handoff').onclick();assert.equal(writes[1].humanControlled,false);assert.equal(field('handoffNote').textContent,'');assert.equal(field('handoff').textContent,'轉人工');
remaining=0;await ui.load();assert.equal(field('quotaStatus').textContent,'本月額度已用完，AI 自動回覆已暫停');
console.log('PASS operator copy, official remaining, selected guest, unchanged message text and handoff payloads (RUNTIME_COMPONENT_TEST)');
})().catch(e=>{console.error(e);process.exitCode=1});
