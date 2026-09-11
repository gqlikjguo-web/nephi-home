'use strict';
// STRUCTURED_CONTRACT_TEST; actual C03/C05/C08 and State boundaries, no network.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const filename=path.join(__dirname,'new-core-canonical-adapter-runner.js');
const m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(__dirname);
const source=fs.readFileSync(filename,'utf8');m._compile(source.slice(0,source.indexOf('// AC-CAN-001'))+'\nmodule.exports={pipeline,createC08,execute,evidence,catalog,NOW};',filename);
const {pipeline,createC08,execute,evidence,catalog,NOW}=m.exports;
const {createConversationStateV3,readConversationStateV3}=require('../lib/conversation-contracts/conversation-state-v3');
const {reduceConversationStateV3,executionConditionsV3,buildContextSnapshotV3}=require('../lib/conversation-engine-v2/conversation-state-v3-reducer');
const {buildCanonicalFormalRequest}=require('../lib/conversation-engine-v2/formal-request');
const {turnStateSnapshot}=require('../lib/new-core/application-service');
const scope={propertyId:catalog.propertyId,channel:'isolated',userId:'guest'};
function first(quantity){
 const message='Products 2026/10/09-10/10',q={...quantity,evidenceRefs:[evidence(message)]};
 const p=pipeline({messageText:message,unitOverrides:{quantityCandidate:q}}),c=createC08(p);assert.equal(c.ok,true);
 const item=execute(c.value).value,request=item.canonicalRequest;
 const formal=buildCanonicalFormalRequest({property:{propertyId:catalog.propertyId},canonicalRequest:request,requestCycleId:item.requestCycleId});
 const state=reduceConversationStateV3({previous:createConversationStateV3({...scope,tasks:[],createdAt:NOW,updatedAt:NOW,expiresAt:NOW}),canonicalItems:[item],formalRequests:[formal],scope:{...scope,now:NOW}});
 return {state,item};
}
for(const q of [{requestedQuantity:1,distinctRequirement:'none'},{requestedQuantity:3,distinctRequirement:'none'},{requestedQuantity:2,distinctRequirement:'distinct_entities'}])test('durable quantity '+JSON.stringify(q),()=>{
 const {state,item}=first(q),stored=readConversationStateV3(JSON.parse(JSON.stringify(state)),scope,NOW),task=stored.tasks[0];
 assert.equal(task.requestedQuantity,q.requestedQuantity);assert.equal(task.distinctRequirement,q.distinctRequirement);
 const snapshot=turnStateSnapshot(stored,scope,NOW);assert.equal(snapshot.referenceableCycles[0].confirmedValues.requestedQuantity,q.requestedQuantity);
 const next={...item,requestCycleId:task.taskId,canonicalRequest:{...item.canonicalRequest,quantityCandidate:undefined}};
 const confirmed=executionConditionsV3(stored,next),formal=buildCanonicalFormalRequest({property:{propertyId:catalog.propertyId},canonicalRequest:item.canonicalRequest,confirmedInputs:confirmed});
 assert.equal(confirmed.requestedQuantity,q.requestedQuantity);assert.equal(formal.resolverTask.requestedQuantity,q.requestedQuantity);
 assert.equal(buildContextSnapshotV3(stored,{...scope,propertyId:'other',now:NOW}).cycles.length,0);
});
