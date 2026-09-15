"use strict";
// RUNTIME_COMPONENT_TEST: production editor with DOM/HTTP doubles. No production writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class Node {
 constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.dataset={};this.value='';this.checked=false;this.disabled=false;this.textContent='';}
 append(...nodes){this.children.push(...nodes);} replaceChildren(...nodes){this.children=nodes;}
 setAttribute(key,value){this[key]=value;} reportValidity(){return true;}
 querySelectorAll(selector){const all=this.children.flatMap(n=>n instanceof Node?[n,...n.querySelectorAll('*')]:[]);return selector==='*'?all:all.filter(n=>n.dataset.field===selector.slice(13,-2));}
}
const plain=x=>JSON.parse(JSON.stringify(x));
async function run(){
 const file=__dirname+'/../public/assets/admin-room-composition.js';
 assert.ok(fs.existsSync(file),'operator composition editor is missing');
 const doc={createElement:tag=>new Node(tag,doc)},host=new Node('section',doc);
 let id='owner-alpha',counter=0,stored=null,revision=0,conflict=false,writes=[],pending=null;
 const response=(data,status=200,code='')=>({ok:status===200,status,json:async()=>status===200?{data:plain(data)}:{error:{code,message:code}}});
 const fetch=async(url,options={})=>{
  if(options.method==='PUT'){
   const body=JSON.parse(options.body);assert.equal(body.propertyId,id);writes.push(body);
   if(conflict)return response(null,409,'ROOM_COMPOSITION_REVISION_CONFLICT');
   stored={...body.composition,revision:++revision};return response({propertyId:id,composition:stored});
  }
  assert.ok(url.includes(encodeURIComponent(id)));
  if(url.startsWith('/api/room-composition')){
   if(pending)return pending;
   return response({propertyId:id,composition:stored});
  }
  if(url.startsWith('/api/room-pricing'))return response({rooms:[{id:'type-a',name:'正式房型 A'},{id:'type-b',name:'正式房型 B'}]});
  if(url.startsWith('/api/bundles'))return response({bundles:[{id:'bundle',name:'正式包套',memberRoomIds:['type-a','type-b']}]});
  throw Error('unexpected API '+url);
 };
 const context=vm.createContext({fetch,crypto:{randomUUID:()=>`physical-${++counter}`},globalThis:null});context.globalThis=context;
 vm.runInContext(fs.readFileSync(file,'utf8'),context);
 const editor=vm.runInContext("RoomCompositionEditor",context).create(host,{getPropertyId:()=>id});
 const nodes=()=>host.querySelectorAll('*');const fields=key=>nodes().filter(n=>n.dataset.field===key);
 const action=key=>nodes().find(n=>n.dataset.action===key);
 const change=(node,value)=>{node.value=value;return(node.oninput||node.onchange)?.();};
 await editor.load();assert.equal(writes.length,0);assert.equal(fields('publicName').length,0);
 await action('add').onclick();await change(fields('publicName')[0],'實體 East <b>');await change(fields('roomTypeId')[0],'type-a');
 await action('add').onclick();await change(fields('publicName')[1],'實體 West');await change(fields('roomTypeId')[1],'type-b');
 fields('inventoryComplete')[0].checked=true;fields('inventoryComplete')[0].onchange();
 for(const node of fields('member')){node.checked=true;node.onchange();}
 fields('bundleComplete')[0].checked=true;fields('bundleComplete')[0].onchange();
 await action('save').onclick();assert.equal(writes.length,1);
 assert.deepEqual(writes[0].composition.physicalRooms,[{physicalRoomId:'physical-1',roomTypeId:'type-a',publicName:'實體 East <b>'},{physicalRoomId:'physical-2',roomTypeId:'type-b',publicName:'實體 West'}]);
 assert.deepEqual(writes[0].composition.bundleCompositions,[{bundleId:'bundle',complete:true,memberPhysicalRoomIds:['physical-1','physical-2']}]);
 assert.equal(writes[0].composition.inventoryComplete,true);
 await editor.load();assert.equal(fields('publicName')[0].value,'實體 East <b>');
 await change(fields('publicName')[0],'Edited');conflict=true;await action('save').onclick();
 assert.equal(fields('publicName')[0].value,'Edited');assert.equal(action('save').disabled,true);
 assert.ok(nodes().some(n=>n.textContent.includes('重新載入')));
 conflict=false;await editor.load();assert.equal(fields('publicName')[0].value,'實體 East <b>');assert.equal(action('save').disabled,false);
 await action('remove').onclick();await action('save').onclick();
 assert.equal(writes.at(-1).composition.revision,1);assert.equal(writes.at(-1).composition.physicalRooms.length,1);
 assert.deepEqual(writes.at(-1).composition.bundleCompositions[0].memberPhysicalRoomIds,['physical-2']);
 assert.equal(writes.at(-1).composition.bundleCompositions[0].complete,false);
 // Old in-flight response cannot populate a different property; no automatic writes.
 let release;pending=new Promise(r=>release=r);const loading=editor.load();id='owner-beta';editor.clear();pending=null;stored=null;
 await editor.load();release(response({propertyId:'owner-alpha',composition:writes[0].composition}));await loading;
 assert.equal(fields('publicName').length,0);assert.equal(writes.length,3);
 id=null;editor.clear();assert.equal(action('save').disabled,true);
 console.log('admin room composition: load/edit/save/delete, revision conflict, property switch PASS (RUNTIME_COMPONENT_TEST)');
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={run};
