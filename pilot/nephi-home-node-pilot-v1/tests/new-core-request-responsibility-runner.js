"use strict";
// FAKE_INTEGRATION: real validators, lifecycle, Resolver, decision; fixture OpenAI.
const test = require("node:test"), assert = require("node:assert/strict");
const {run} = require("./new-core-request-responsibility-fixture");
for (const purpose of ["conversational_statement", "supplement"]) test(purpose+" with slots and no target is not human responsibility", async()=>{
 const {result:r}=await run(["NO_REPLY"],{purpose,withSlot:true});
 assert.equal(r.artifacts.understanding.validatedUnits.length,1,"VALIDATED_NON_REQUEST_REQUIRED");
 assert.equal(r.finalDecision.action,"no_reply","NON_REQUEST_FAILURE_PROMOTED_TO_HANDOFF");
 assert.equal(r.finalResponse.shouldReply,false);
});
test("explicit operator request retains handoff",async()=>{const {result:r}=await run(["HANDOFF"]);assert.equal(r.finalDecision.action,"handoff");assert.equal(r.finalDecision.reviewRequired,true)});
test("answer and operator responsibility both survive",async()=>{const {result:r}=await run(["ANSWER","HANDOFF"]);assert.equal(r.finalDecision.reviewRequired,true);assert.equal(r.finalDecision.executionSummary.answeredTaskIds.length,1)});
for(const purpose of ["acknowledgement","conversational_statement","social"]) test(purpose+" no request control",async()=>{const {result:r}=await run(["NO_REPLY"],{purpose});assert.equal(r.finalDecision.action,"no_reply")});
test("Resolver unknown alone is not human responsibility",async()=>{const {result:r}=await run(["ANSWER"],{unknownFacts:true});assert.equal(r.artifacts.executionOutcomes[0].outcome,"unknown");assert.notEqual(r.finalDecision.action,"handoff","UNKNOWN_WITHOUT_RESPONSIBILITY_PROMOTED_TO_HANDOFF")});
