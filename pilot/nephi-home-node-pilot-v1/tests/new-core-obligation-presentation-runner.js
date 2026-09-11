'use strict';
// RUNTIME_COMPONENT_TEST: real planner/render/validator, synthetic formal outcomes.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildResponsePlan}=require('../lib/conversation-engine-v2/response-planner');
const {assembleFinalResponse}=require('../lib/conversation-engine-v2/final-response-renderer');
const {validateClaims}=require('../lib/conversation-engine-v2/claim-validator');
const {coverageLayout}=require('../lib/conversation-engine-v2/render-obligation');
function plan(answers=['十一點退房','十一點退房']){
 const shared={propertyId:'p',source:'property_catalog',subject:'退房',answer:answers[0]};
 const taskResults=answers.map((answer,i)=>({taskId:'q'+i,type:'policy',status:'answered',outcomeStatus:'answered',facts:answer===answers[0]?shared:{...shared,answer}}));
 const canonicalRequests=taskResults.map((t,i)=>({taskId:t.taskId,capability:'policy',resolverId:'property_catalog',riskLevel:'low',responseMode:'answer',canonicalEntity:{status:'resolved',category:'policy',canonicalId:answers[i]===answers[0]?'check_out':'another_policy'}}));
 return buildResponsePlan({propertyId:'p',turnId:'e',taskResults,inputTaskIds:taskResults.map(t=>t.taskId),canonicalRequests});
}
const options={finalDecision:{action:'reply'}};
function render(p){return assembleFinalResponse({...options,responsePlan:p}).replyText;}
function validate(p,text=render(p)){return validateClaims(text,p,p.sections.flatMap(s=>s.coveredTaskIds||[s.taskId]),null,options);}
test('shared answer retains two unique obligations with no duplicate output',()=>{const p=plan();assert.deepEqual(p.renderObligations.map(r=>r.taskId),['q0','q1']);assert.equal(p.sections.length,1);assert.equal(render(p),'十一點退房');assert.equal(validate(p).ok,true);});
test('different facts remain independently visible',()=>{const p=plan(['十一點退房','可寄放行李']);assert.equal(p.sections.length,2);assert.equal(render(p),'十一點退房\n可寄放行李');assert.equal(validate(p).ok,true);});
test('duplicate section is rejected without issuing another obligation',()=>{const p=plan(['十一點退房']);const changed={...p,sections:[...p.sections,...p.sections]};assert.equal(changed.renderObligations.length,1);assert.equal(validate(changed).ok,false);});
test('one byte range proves both tasks independently',()=>{const p=plan();const l=coverageLayout(p,options);assert.equal(l.segments.length,1);assert.deepEqual(l.segments[0].taskIds,['q0','q1']);assert.equal(validate(p).ok,true);});
test('missing distinct answer is rejected despite all declared task IDs',()=>{const p=plan(['十一點退房','可寄放行李']);assert.equal(validate(p,'十一點退房').ok,false);assert.ok(validate(p,'十一點退房').errors.includes('final_section_missing'));});
test('repeated answer bytes are rejected',()=>{const p=plan();assert.equal(validate(p,'十一點退房\n十一點退房').ok,false);});
test('presentation order does not rewrite task ownership',()=>{const p=plan(['十一點退房','可寄放行李']);const changed={...p,sections:[...p.sections].reverse()};assert.equal(validate(changed,render(p)).ok,true);assert.deepEqual(changed.renderObligations,p.renderObligations);});
test('split shared presentation retains one output and both obligations',()=>{const p=plan();const sections=p.renderObligations.map(r=>({...r.payload,coveredTaskIds:[r.taskId],factOrigins:undefined}));const changed={...p,sections};assert.equal(render(changed),'十一點退房');assert.equal(validate(changed).ok,true);assert.equal(changed.renderObligations.length,2);});
test('conflicting facts cannot be merged by declaring group membership',()=>{const p=plan(['十一點退房','可寄放行李']);const merged={...p.sections[0],coveredTaskIds:['q0','q1'],factOrigins:p.sections.map(s=>({taskId:s.taskId,facts:s.facts}))};assert.equal(validate({...p,sections:[merged]}).ok,false);});
test('fake section membership cannot create an obligation',()=>{const p=plan(['十一點退房']);const changed={...p,sections:[{...p.sections[0],coveredTaskIds:['q0','invented']}]};assert.equal(changed.renderObligations.length,1);assert.equal(validate(changed).ok,false);});
test('task result membership cannot mint another task obligation',()=>{
 const p=buildResponsePlan({propertyId:'p',turnId:'e',taskResults:[{taskId:'real-task',coveredTaskIds:['real-task','invented'],type:'policy',status:'answered',facts:{source:'property_catalog',propertyId:'p',answer:'正式回覆'}}]});
 assert.deepEqual(p.renderObligations.map(r=>r.taskId),['real-task']);
});
test('duplicate outcome input cannot issue a second obligation',()=>{
 const item={taskId:'real-task',type:'policy',status:'answered',facts:{source:'property_catalog',propertyId:'p',answer:'正式回覆'}};
 const p=buildResponsePlan({propertyId:'p',turnId:'e',taskResults:[item,item]});
 assert.deepEqual(p.renderObligations.map(r=>r.taskId),['real-task']);
 assert.equal(validate(p).ok,false);
});
