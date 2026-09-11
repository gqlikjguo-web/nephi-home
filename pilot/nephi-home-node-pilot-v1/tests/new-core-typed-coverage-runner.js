'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test');
const {finalizeTurnResponse}=require('../lib/new-core/application-service');
const {createTerminalContext}=require('../lib/new-core/terminal-failure');
const {validateClaims}=require('../lib/conversation-engine-v2/claim-validator');
const {composeControlledReply}=require('../lib/conversation-engine-v2/controlled-composer');
function finish(kinds){
 const context=createTerminalContext({propertyId:'p',turnId:'e'});
 const executions=[],tasks=[],evidence=[];
 kinds.forEach((kind,index)=>{const taskId='task-'+index;
 evidence.push({taskId,requestPresence:kind==='ABSENT'?'ABSENT':'PRESENT',activeRequest:kind!=='ABSENT',replyPermission:kind==='SUPPRESSED'?'SUPPRESSED':'ALLOWED',humanActionRequired:kind==='H'});
 if(['ABSENT','SUPPRESSED'].includes(kind))return;
 if(kind==='T'){context.fromException(new Error('actual failure'),taskId);return;}
 const e=kind==='A'?{outcome:'answered',facts:{source:'property_catalog',propertyId:'p',answer:'正式答案 '+index}}:kind==='H'?{outcome:'unknown',reason:'human_help'}:{outcome:'not_ready',readinessStatus:kind==='P'?'past_date':'missing_information',missingFields:['checkIn','checkOut']};
 executions.push({taskId,type:kind==='H'?'human_help':kind==='A'?'policy':'availability',...e});
 tasks.push({taskId,type:kind==='H'?'human_help':kind==='A'?'policy':'availability',status:kind==='A'?'answered':kind==='H'?'needs_human':'needs_clarification',facts:e.facts||{},missingInputs:e.missingFields||[]});
 });
 return finalizeTurnResponse({scope:{propertyId:'p'},turnId:'e',property:{propertyId:'p'},terminalContext:context,requestEvidence:evidence,executionOutcomes:executions,taskResults:tasks});
}
for(const kinds of [['A'],['C'],['P'],['H'],['T'],['A','C'],['A','H'],['A','C','H'],['A','P','H'],['SUPPRESSED'],['ABSENT']])test(kinds.join('+'),()=>{const r=finish(kinds);assert.equal(r.rebuildCount,0);assert.ok(Array.isArray(r.responsePlan.renderObligations),'typed obligations required');assert.equal(r.finalResponse.shouldReply,!['ABSENT','SUPPRESSED'].includes(kinds[0]));if(r.finalResponse.shouldReply)assert.equal(r.claimValidation.ok,true);});
function verify(r,body){return validateClaims(body,r.responsePlan,r.responsePlan.sections.flatMap(s=>s.coveredTaskIds||[s.taskId]),null,{finalDecision:r.finalDecision,validatedReplyText:composeControlledReply(r.responsePlan),claimValidation:{ok:true}});}
test('real omission cannot be hidden by declared task IDs',()=>{const r=finish(['A','C','H']);const changed=r.finalResponse.replyText.split('\n').filter(line=>line!== '請提供入住日期。').join('\n');assert.notEqual(changed,r.finalResponse.replyText);const v=verify(r,changed);assert.equal(v.ok,false);assert.ok(v.errors.includes('final_section_missing'));});
test('duplicated final answer cannot count as coverage',()=>{const r=finish(['A']);const v=verify(r,r.finalResponse.replyText+'\n'+r.finalResponse.replyText);assert.equal(v.ok,false);});
test('duplicate task section rejected even when bytes match',()=>{const r=finish(['A']);const plan={...r.responsePlan,sections:[...r.responsePlan.sections,...r.responsePlan.sections]};const v=validateClaims(r.finalResponse.replyText,plan,['task-0'],null,{finalDecision:r.finalDecision,claimValidation:{ok:true}});assert.equal(v.ok,false);});
