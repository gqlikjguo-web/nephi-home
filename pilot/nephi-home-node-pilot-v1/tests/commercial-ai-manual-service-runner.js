"use strict";
// RUNTIME_COMPONENT_TEST: authenticated manual service boundary, no external transport.
const assert=require('node:assert/strict');
const {createNewCoreManualTestService}=require('../lib/new-core/manual-test-service');
const seen=[],owner={userId:'owner',propertyId:'nephi_home'};
const providers={customerSettings:{getProperty:()=>({propertyId:'nephi_home'})}};
const service=createNewCoreManualTestService({providers,service:{},apiKey:'local-manual-fixture',
 commercialController:{runManual:async(scope,work)=>{seen.push(scope);return work();}},
 executeTurn:async args=>{seen.push('execute');return {state:args.state,understanding:{units:[]},lifecycle:[],routing:[],resolver:{},finalDecision:{action:'no_reply'},finalResponse:{shouldReply:false,replyText:''}};}});
(async()=>{
 const session=await service.createSession(owner,'nephi_home');
 const turn=await service.runTurn(session.testSessionId,owner,{input:'測試'});
 assert.equal(seen.length,2,'manual entry must authorize cost-only ledger before executeTurn');
 assert.equal(seen[0].ownerId,'owner');assert.equal(seen[0].testSessionId,session.testSessionId);
 assert.equal(seen[0].propertyId,'nephi_home');assert.equal(seen[0].turnId,turn.turnId);
 assert.deepEqual(seen[0].eventIds,[turn.turnId]);assert.equal(seen[1],'execute');
 await assert.rejects(()=>service.runTurn(session.testSessionId,{...owner,userId:'stranger'},{input:'test'}));assert.equal(seen.length,2);
 console.log('PASS manual cost admission after ownership validation, before execution; original result retained');
})().catch(error=>{console.error(error);process.exitCode=1;});
