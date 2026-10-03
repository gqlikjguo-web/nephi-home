"use strict";
// Release-harness metering only; never imported by product runtime.
const fs=require("node:fs"),path=require("node:path");
const {insist,hash}=require("./capability-guard-content");
function requestBudget(request,budget) {
  const body=JSON.parse(request.body);
  const limit=body.max_output_tokens===undefined?budget.maxOutputTokensPerCall:body.max_output_tokens;
  insist(Number.isInteger(limit)&&limit>0&&limit<=budget.maxOutputTokensPerCall,"REAL_OUTPUT_BUDGET");
  const bounded={...body,max_output_tokens:limit};
  // Conservative byte reservation, not claimed provider token accounting.
  // Actual billed input/output/total tokens are required from each response.
  return {request:{...request,body:JSON.stringify(bounded)},reserved:Buffer.byteLength(JSON.stringify(bounded),"utf8")+limit+1024};
}
function createRealSession({dir,plan,budget}) {
  insist(plan.candidateDigest===budget.candidateDigest && JSON.stringify(plan.ids)===JSON.stringify(budget.cases),"REAL_PLAN_BINDING");
  insist(Number.isInteger(budget.maxOutputTokensPerCall)&&budget.maxOutputTokensPerCall>0,"REAL_OUTPUT_BUDGET_REQUIRED");
  insist(Number.isInteger(budget.maxCalls)&&budget.maxCalls>0&&budget.maxCalls<=plan.ids.length*2 && Number.isInteger(budget.maxTokens)&&budget.maxTokens>0,"REAL_BUDGET_REQUIRED");
  fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,"usage.jsonl");
  insist(!fs.existsSync(file),"REAL_EVIDENCE_ALREADY_EXISTS");fs.writeFileSync(file,"",{flag:"wx"});
  let active=null,calls=0,tokens=0,unknownUsage=false,blocked=false;const completed=new Set(),perCase=new Map();
  function write(row) {
    const fd=fs.openSync(file,"a");
    try{fs.writeSync(fd,JSON.stringify({candidateDigest:plan.candidateDigest,planDigest:plan.planDigest,...row})+"\n");fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  }
  write({event:"SESSION",cases:plan.ids,maxCalls:budget.maxCalls,maxTokens:budget.maxTokens,reason:budget.reason});
  function beginCase(id) {
    insist(!completed.has(id)&&!perCase.has(id),"REAL_COMPLETED_CASE_REPLAY");
    insist(!blocked&&!active&&id===plan.ids[completed.size],"REAL_CASE_ORDER_OR_SESSION_BLOCKED");
    active=id;perCase.set(id,0);write({event:"CASE_BEGIN",caseId:id});
  }
  async function meteredFetch(url,request,transport=globalThis.fetch) {
    insist(!blocked,"REAL_SESSION_BLOCKED");insist(active&&String(url)==="https://api.openai.com/v1/responses","REAL_TRANSPORT_SCOPE");
    insist(perCase.get(active)<2 && calls<budget.maxCalls,"REAL_CALL_LIMIT");
    const reservation=requestBudget(request,budget);
    insist(tokens+reservation.reserved<=budget.maxTokens,"REAL_TOKEN_BUDGET_BEFORE_CALL");
    const id=active,attempt=perCase.get(id)+1;perCase.set(id,attempt);calls++;
    write({event:"REQUEST_STARTED",caseId:id,attempt,calls:1,reservedTokens:reservation.reserved});
    try {
      const response=await transport(url,reservation.request);
      const payload=await response.clone().json(),u=payload?.usage;
      insist(u&&[u.input_tokens,u.output_tokens,u.total_tokens].every(n=>Number.isSafeInteger(n)&&n>=0)&&u.input_tokens+u.output_tokens===u.total_tokens,"REAL_MISSING_USAGE");
      tokens+=u.total_tokens;write({event:"USAGE",caseId:id,attempt,inputTokens:u.input_tokens,outputTokens:u.output_tokens,tokens:u.total_tokens});
      insist(tokens<=budget.maxTokens,"REAL_TOKEN_BUDGET_EXCEEDED");return response;
    } catch(error) {
      blocked=true;unknownUsage=true;
      // No error message/raw payload/header is persisted: provider errors can contain secrets.
      write({event:"REQUEST_UNPROVEN",caseId:id,attempt,tokens:null});throw error;
    }
  }
  function completeCase(id) {
    insist(!blocked&&active===id&&(perCase.get(id)||0)>=1,"REAL_CASE_NOT_PROVEN");
    completed.add(id);active=null;write({event:"CASE_PASS",caseId:id,calls:perCase.get(id)});
  }
  function summary() {return {candidateDigest:plan.candidateDigest,planDigest:plan.planDigest,status:!blocked&&completed.size===plan.ids.length?"PASS":"BLOCKED",calls,tokens:unknownUsage?null:tokens,
    completedCases:[...completed],caseCalls:Object.fromEntries(perCase),usageSha256:hash(fs.readFileSync(file))};}
  return {beginCase,fetch:meteredFetch,completeCase,summary};
}
module.exports={createRealSession,requestBudget};
