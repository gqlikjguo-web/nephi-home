'use strict';
// FAKE_INTEGRATION: formal Understanding admission through State across turns; no provider network.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const filename=path.join(__dirname,'new-core-durable-identity-runner.js'),m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(__dirname);
let source=fs.readFileSync(filename,'utf8').split('(async()=>{')[0];
source=source.replace("slotCandidates:(s.slots||[])","...(s.quantity?{quantityCandidate:{...s.quantity,evidenceRefs:[ref]}}:{}),slotCandidates:(s.slots||[])");
source=source.replace("availability:()=>{throw Error('UNEXPECTED_DYNAMIC_PROVIDER');}","availability:q=>({customerId:turnScope.propertyId,availabilityReliable:true,rooms:[{id:'room-a',name:'Room A',capacity:4}],checkIn:q.checkIn,checkOut:q.checkOut})");
m._compile(source+'\nmodule.exports={runTurn,question,h,ref,scope,NOW};',filename);
const {runTurn,question,h,ref,scope,NOW}=m.exports;
const {readConversationStateV3}=require('../lib/conversation-contracts/conversation-state-v3');
for(const quantity of [{requestedQuantity:1,distinctRequirement:'none'},{requestedQuantity:3,distinctRequirement:'none'},{requestedQuantity:2,distinctRequirement:'distinct_entities'}])test('quantity State write/reload/next-turn '+JSON.stringify(quantity),async()=>{
 const first=await runTurn([{...question('q','room-a','availability','room'),quantity,slots:[['guest_count',4]]}]);
 const stored=readConversationStateV3(JSON.parse(JSON.stringify(first.result.state)),scope,NOW),task=stored.tasks[0];assert.ok(task,'first admitted request creates pending State');
 assert.equal(task.requestedQuantity,quantity.requestedQuantity);assert.equal(task.guestCount,4);assert.equal(task.distinctRequirement,quantity.distinctRequirement);assert.equal(task.quantityEvidenceRefs[0].eventId,first.events[0].eventId);
 const second=await runTurn([{...question('next','room-a','availability','room'),relation:'MODIFICATION',refs:[ref()],text:'2026/10/09-10/10',temporal:{kind:'date_range',rawText:'2026/10/09-10/10',checkInCandidate:'2026-10-09',checkOutCandidate:'2026-10-10',nightsCandidate:1}}],stored,[h([task.taskId])]);
 assert.equal(second.result.artifacts.formalRequests?.length,1,JSON.stringify({earliest:second.result.earliestFailure,artifacts:second.result.artifacts,diagnostics:second.diagnostics}));
 const formal=second.result.artifacts.formalRequests[0];assert.equal(formal.resolverTask.requestedQuantity,quantity.requestedQuantity);assert.equal(formal.resolverTask.guestCount,4);assert.deepEqual(formal.evidence.quantityEvidenceRefs,task.quantityEvidenceRefs);
 const final=second.result.state.tasks.find(t=>t.taskId===task.taskId);assert.equal(final.requestedQuantity,quantity.requestedQuantity);assert.deepEqual(final.quantityEvidenceRefs,task.quantityEvidenceRefs);
 assert.notEqual(first.events[0].eventId,second.events[0].eventId);assert.equal(final.quantityEvidenceRefs.some(e=>e.eventId===second.events[0].eventId),false);
 const cross=readConversationStateV3(stored,{...scope,propertyId:'different'},NOW);assert.equal(cross.tasks.length,0);
});
test('bound quantity modification updates value and original source together',async()=>{
 const first=await runTurn([{...question('q','room-a','availability','room'),quantity:{requestedQuantity:2,distinctRequirement:'none'},slots:[['guest_count',4]]}]);
 const task=first.result.state.tasks[0];
 const second=await runTurn([{...question('changed','room-a','availability','room'),relation:'MODIFICATION',refs:[ref()],quantity:{requestedQuantity:3,distinctRequirement:'distinct_entities'}}],first.result.state,[h([task.taskId])]);
 const changed=second.result.state.tasks.find(t=>t.taskId===task.taskId);assert.equal(changed.requestedQuantity,3);assert.equal(changed.distinctRequirement,'distinct_entities');assert.equal(changed.guestCount,4);assert.equal(changed.quantityEvidenceRefs[0].eventId,second.events[0].eventId);
});
