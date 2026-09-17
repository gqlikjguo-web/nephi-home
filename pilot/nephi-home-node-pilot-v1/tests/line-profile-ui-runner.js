"use strict";
// RUNTIME_COMPONENT_TEST: existing browser controller, DOM and HTTP doubles only.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class Node{constructor(tag,ownerDocument){Object.assign(this,{tagName:tag,ownerDocument,children:[],dataset:{},textContent:'',hidden:false});}append(...n){this.children.push(...n)}replaceChildren(...n){this.children=n}setAttribute(k,v){this[k]=v}querySelectorAll(){return this.children.flatMap(n=>[n,...n.querySelectorAll()])}}
(async()=>{
  const doc={createElement:t=>new Node(t,doc)},host=new Node('section',doc);let property='a',profileCalls=[],pending=[];
  const ctx=vm.createContext({URLSearchParams,fetch:async(url,options={})=>{
    const path=new URL(url,'https://fixture.invalid').pathname;
    if(path.endsWith('/profile')){profileCalls.push(JSON.parse(options.body));return new Promise(resolve=>pending.push(name=>resolve({ok:true,json:async()=>({data:{displayName:name}})})));}
    let data={propertyId:property,aiEnabled:true,used:1,monthlyLimit:3,remaining:2,period:'2026-09'};
    if(path.endsWith('/conversations'))data=url.includes('userId')?{humanControlled:false}:{items:[{channelId:'c',userId:'user-a'},{channelId:'c',userId:'user-b'}]};
    if(path.endsWith('/history'))data={items:[{guestMessage:'Original message',replyText:'Original reply',replyDelivered:true}],nextCursor:null};
    if(path.endsWith('/usage'))data={today:1,week:1,day:'today',weekStart:'week'};
    return {ok:true,json:async()=>({data})};
  }});
  vm.runInContext(fs.readFileSync(__dirname+'/../public/assets/admin-ai-controls.js','utf8'),ctx);
  const ui=vm.runInContext('AiControls',ctx).createOperator(host,{getPropertyId:()=>property}),field=n=>host.querySelectorAll().find(x=>x.dataset.field===n);
  const flush=()=>new Promise(r=>setImmediate(r));
  await ui.load();assert.equal(profileCalls.length,0,'never fetch every historical profile on page load');
  await field('conversation').children[0].children[0].onclick();await flush();
  assert.equal(profileCalls.length,1,'selecting a guest requests an optional name');
  assert.equal(field('handoff').disabled,false,'LINE lookup must not block controls/history');
  assert.equal(field('history').children.length,1);
  await field('conversation').children[1].children[0].onclick();await flush();
  pending[0]('Name A');await flush();assert.ok(!field('guestTitle').textContent.includes('Name A'),'late A cannot replace B title');
  pending[1]('<script>Name B</script>');await flush();assert.ok(field('guestTitle').textContent.includes('<script>Name B</script>'),'name is literal text');
  assert.ok(field('conversation').children[1].children[0].textContent.includes('Name B'));
  await field('conversation').children[0].children[0].onclick();await flush();property='b';await ui.load();pending[2]('Private A');await flush();
  assert.equal(field('guestTitle').textContent,'請選擇客人對話');assert.ok(!JSON.stringify(host.children,(k,v)=>k==='ownerDocument'?undefined:v).includes('Private A'));
  console.log('PASS selected-only names, guest/property stale response isolation, literal text, independent controls/history (RUNTIME_COMPONENT_TEST)');
})().catch(e=>{console.error(e);process.exitCode=1;});
