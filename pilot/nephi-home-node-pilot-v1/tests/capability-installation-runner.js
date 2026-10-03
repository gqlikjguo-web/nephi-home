"use strict";
// STRUCTURED_CONTRACT_TEST. Isolated Git and transport doubles, zero external calls.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os"), cp = require("node:child_process");
const approval = require("../scripts/core-contract-approval"), budget = require("../scripts/capability-guard-budget");
const T = ".github/core-reliability-task.json", G = ".github/capability-baseline.json";
function fixture(runtime = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "capability-install-"));
  const git = (...args) => cp.execFileSync("git", args, {cwd:root, encoding:"utf8", stdio:["ignore","pipe","pipe"]}).trim();
  fs.mkdirSync(path.join(root,".github")); fs.writeFileSync(path.join(root,G),"original\n"); fs.writeFileSync(path.join(root,"runtime.js"),"unchanged\n");
  git("init","-q"); git("config","user.name","Isolated governance test"); git("config","user.email","test@example.invalid"); git("add","."); git("commit","-qm","baseline");
  const baseline = git("rev-parse","HEAD");
  const task = {baseline,objective:"reviewed governance",gateChangeAllowed:true,contractChangeAllowed:true,allowedPaths:[T,G,...(runtime?["runtime.js"]:[])]};
  fs.writeFileSync(path.join(root,T),JSON.stringify(task)); fs.writeFileSync(path.join(root,G),"reviewed update\n");
  if(runtime)fs.writeFileSync(path.join(root,"runtime.js"),"must reject\n");
  git("add",".");git("commit","-qm","candidate");
  const policy = {protectedPaths:[],governancePaths:[G],capabilities:[{paths:["runtime.js"]}],capabilityProtection:{required:true},
    contractReview:{repository:"owner/repo",reviewerId:34,environmentId:12,environment:"core-scope-approval",workflow:".github/workflows/core-reliability.yml"}};
  return {root,baseline,candidate:git("rev-parse","HEAD"),task,policy,context:{repository:"owner/repo",pullRequest:5,runId:6,runAttempt:1}};
}
function realFunctions() { return require("../scripts/capability-real-session"); }
function realFixture(overrides={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"budget-session-"));
  return {dir,plan:{candidateDigest:"a".repeat(64),ids:["first"],planDigest:"b".repeat(64)},
    budget:{mode:"AFFECTED_REAL",candidateDigest:"a".repeat(64),cases:["first"],maxCalls:2,maxTokens:10000,maxOutputTokensPerCall:1000,...overrides}};
}
const request = {method:"POST",headers:{authorization:"Bearer sensitive-fixture-value"},body:JSON.stringify({model:"fixture",input:"not persisted",max_output_tokens:64})};
const response = usage => new Response(JSON.stringify({usage,output:[]}),{status:200});
async function run() {
  let passed=0; const failures=[];
  async function check(name,fn){try{await fn();passed++;console.log("PASS "+name);}catch(e){failures.push({name,error:e.message});console.error("FAIL "+name+": "+e.message);}}
  await check("governance descriptor binds exact registered paths and rejects mixed runtime",()=>{
    const f=fixture(),d=approval.describe(f);assert.equal(d?.kind,"GOVERNANCE_CHANGE");
    assert.deepEqual(d.changedPaths.sort(),[T,G].sort());assert.equal(d.baselineSha,f.baseline);assert.equal(d.candidateSha,f.candidate);
    assert.throws(()=>approval.describe(fixture(true)),/GOVERNANCE_ONLY/);
    assert.throws(()=>approval.describe({...f,task:{...f.task,gateChangeAllowed:false}}),/GOVERNANCE_REQUEST/);
  });
  await check("only independently verified private governance receipt permits manifest transition",async()=>{
    const f=fixture(),d=approval.describe(f);assert.equal(d?.kind,"GOVERNANCE_CHANGE");
    const original=global.fetch;let comment=`GOVERNANCE_CHANGE_APPROVED ${approval.digest(d)} REVIEW_SHA256=${"c".repeat(64)}`;
    global.fetch=async url=>{const suffix=String(url).slice("https://api.github.com/repos/owner/repo".length);const responses={
      "/actions/runs/6":{id:6,run_attempt:1,event:"pull_request_target",path:f.policy.contractReview.workflow,head_sha:f.candidate,repository:{full_name:"owner/repo"}},
      "/pulls/5":{state:"open",head:{sha:f.candidate,repo:{full_name:"owner/repo"}},base:{sha:f.baseline,ref:"production"}},
      "/branches/production":{commit:{sha:f.baseline}},
      "/actions/runs/6/approvals":[{state:"approved",user:{id:34},environments:[{id:12,name:"core-scope-approval"}],comment}]};
      assert.ok(Object.hasOwn(responses,suffix));return{ok:true,json:async()=>responses[suffix]};};
    try{
      const receipt=await approval.authorize(d,f.policy,"read-only-fixture");
      assert.equal(approval.matchesGovernance(receipt,d.changedPaths,f.task,f.policy),true);
      for(const fake of [{reviewedScope:true},JSON.parse(JSON.stringify(receipt)),{}])assert.equal(approval.matchesGovernance(fake,d.changedPaths,f.task,f.policy),false);
      assert.equal(approval.matchesGovernance(receipt,d.changedPaths,{...f.task,objective:"drift"},f.policy),false);
      comment="approved";await assert.rejects(()=>approval.authorize(d,f.policy,"fixture"),/APPROVAL_REQUIRED/);
    }finally{global.fetch=original;}
  });
  await check("affected REAL selection adds only formal prerequisites and rejects unmapped capability",()=>{
    const oracle={turns:[{id:"seed"},{id:"follow",previous:"seed"},{id:"policy"}]};
    const verification={realCases:[{id:"seed",capabilities:["stay"]},{id:"follow",capabilities:["context"]},{id:"policy",capabilities:["policy"]}]};
    const p={DIRECTLY_AFFECTED_CAPABILITIES:["context"],TRANSITIVE_AFFECTED_CAPABILITIES:[],modelPathChanged:true};
    assert.deepEqual(budget.selectRealCases(p,verification,oracle).ids,["seed","follow"]);
    assert.throws(()=>budget.selectRealCases({...p,DIRECTLY_AFFECTED_CAPABILITIES:["unknown"]},verification,oracle),/UNCOVERED/);
    assert.throws(()=>budget.selectRealCases({...p,modelPathChanged:false},verification,oracle),/NOT_ELIGIBLE/);
  });
  await check("REAL request usage is durable scoped evidence with no secret/raw body",async()=>{
    const f=realFixture(),s=realFunctions().createRealSession(f);s.beginCase("first");
    await s.fetch("https://api.openai.com/v1/responses",request,async()=>response({input_tokens:7,output_tokens:3,total_tokens:10}));
    await s.fetch("https://api.openai.com/v1/responses",request,async()=>response({input_tokens:9,output_tokens:2,total_tokens:11}));
    s.completeCase("first");const r=s.summary();assert.equal(r.calls,2);assert.equal(r.tokens,21);assert.equal(r.candidateDigest,f.plan.candidateDigest);
    const evidence=fs.readFileSync(path.join(f.dir,"usage.jsonl"),"utf8");
    assert.ok(!evidence.includes("sensitive-fixture-value")&&!evidence.includes("not persisted"));
    assert.throws(()=>s.beginCase("first"),/REPLAY/);
  });
  await check("max2 calls and finite token reserve prevent a transport request",async()=>{
    const f=realFixture({maxTokens:3}),s=realFunctions().createRealSession(f);s.beginCase("first");let calls=0;
    await assert.rejects(()=>s.fetch("https://api.openai.com/v1/responses",request,async()=>{calls++;return response({total_tokens:1});}),/BUDGET/);assert.equal(calls,0);
    const other=realFixture(),t=realFunctions().createRealSession(other);t.beginCase("first");
    for(let i=0;i<2;i++)await t.fetch("https://api.openai.com/v1/responses",request,async()=>response({input_tokens:1,output_tokens:1,total_tokens:2}));
    await assert.rejects(()=>t.fetch("https://api.openai.com/v1/responses",request,async()=>{throw Error("must not call");}),/CALL_LIMIT/);
  });
  await check("missing usage or interrupted transport blocks further billing and preserves evidence",async()=>{
    const f=realFixture(),s=realFunctions().createRealSession(f);s.beginCase("first");
    await assert.rejects(()=>s.fetch("https://api.openai.com/v1/responses",request,async()=>response(undefined)),/MISSING_USAGE/);
    await assert.rejects(()=>s.fetch("https://api.openai.com/v1/responses",request,async()=>{throw Error("must not retry");}),/SESSION_BLOCKED/);
    assert.equal(s.summary().calls,1);assert.equal(s.summary().tokens,null);
    assert.throws(()=>realFunctions().createRealSession(f),/EVIDENCE_ALREADY_EXISTS/);
  });
  await check("candidate binding and exact completed cases are required in REAL qualification",()=>{
    const gate=require("../scripts/core-reliability-gate"),plan={ids:["first"],candidateDigest:"d",planDigest:"p",budget:{maxCalls:2,maxTokens:100}};
    const real={candidateSha:"c",candidateDigest:"d",planDigest:"p",provider:"REAL_OPENAI_AND_POSTGRESQL",status:"PASS",turns:1,realCalls:1,totalTokens:10,lineDelivery:"NOT_RUN",quotaWrites:0,results:[{id:"first",status:"PASS",calls:1}],usage:{calls:1,tokens:10,completedCases:["first"],candidateDigest:"d",planDigest:"p",status:"PASS"}};
    assert.equal(gate.validRealEvidence(real,"c",plan),true);
    for(const mutation of [r=>r.totalTokens=101,r=>r.results[0].id="other",r=>r.candidateDigest="other",r=>r.usage.tokens=null,r=>r.results[0].calls=3]){const r=structuredClone(real);mutation(r);assert.equal(gate.validRealEvidence(r,"c",plan),false);}
  });
  await check("new impact classification cannot waive an existing trusted REAL requirement",()=>{
    const gate=require("../scripts/core-reliability-gate");
    assert.equal(gate.realRequirement({installation:{requireReal:false},capabilityProtection:{plan:{modelPathChanged:false}},realClassification:{required:true}}),true);
    assert.equal(gate.realRequirement({installation:{requireReal:false},capabilityProtection:{plan:{modelPathChanged:true}},realClassification:{required:false}}),true);
    assert.equal(gate.realRequirement({installation:{requireReal:false,semanticImpact:"OBSERVABILITY_ONLY"},capabilityProtection:{plan:{modelPathChanged:true}},realClassification:{required:true}}),true,
      "candidate-created observability labels must not waive REAL");
  });
  await check("non-core product assets still require accepted content parity",()=>{
    const gate=require("../scripts/core-reliability-gate"),policy={governancePaths:[G]},protection={plan:{CHANGED_COMPONENTS:[]},product:{metadata:[T],mustMatch:[G,"public/admin.js","gateway.js","render.yaml"],testOnly:{}}};
    for(const file of ["public/admin.js","gateway.js","render.yaml"])assert.equal(gate.productParityRequired([file,T],policy,protection),true,file);
    assert.equal(gate.productParityRequired([G,T],policy,protection),false);
  });
  await check("source mutation stops qualification and retains command logs and exit evidence",()=>{
    const gate=require("../scripts/core-reliability-gate"),content=require("../scripts/capability-guard-content"),f=fixture();
    const evidence=fs.mkdtempSync(path.join(os.tmpdir(),"immutable-run-"));
    const protection={digest:content.contentDigest(content.workspaceTree(f.root)),ignored:[],scratch:os.tmpdir()};
    const result=gate.runCommands({root:f.root,cwd:f.root,candidate:f.candidate,baseline:f.baseline,evidenceDir:evidence,protection,
      commands:[{id:"mutation",argv:[process.execPath,"-e",'require("fs").appendFileSync("runtime.js","changed\\n");console.log("preserve-this-output")']},{id:"must-not-run",argv:[process.execPath,"-e",'throw Error("must not run")']}]});
    assert.equal(result.status,"STOP");assert.equal(result.reason,"CANDIDATE_CONTENT_DRIFT");assert.equal(result.results.length,1);assert.equal(result.results[0].exitCode,0);
    assert.ok(fs.readFileSync(path.join(evidence,result.results[0].logFile),"utf8").includes("preserve-this-output"));
    assert.equal(JSON.parse(fs.readFileSync(path.join(evidence,"report.json"))).status,"STOP");
  });
  await check("offline guard rejects Node normalized TCP arguments before transport",()=>{
    const guard=path.resolve(__dirname,"../scripts/capability-guard-offline.cjs"),dir=fs.mkdtempSync(path.join(os.tmpdir(),"tcp-boundary-"));
    const script=`const assert=require("node:assert/strict"),net=require("node:net");let transports=0;
      net.Socket.prototype.connect=function(){transports++;return this};
      require(${JSON.stringify(guard)});
      assert.throws(()=>net.createConnection({host:"denied.example.invalid",port:443}),/EXTERNAL_NETWORK_FORBIDDEN/);
      assert.equal(transports,0);net.createConnection({host:"127.0.0.1",port:1234});assert.equal(transports,1);`;
    const child=cp.spawnSync(process.execPath,["-e",script],{encoding:"utf8",env:{...process.env,NODE_OPTIONS:"",CAPABILITY_NETWORK_AUDIT:path.join(dir,"denials.jsonl")}});
    assert.equal(child.status,0,child.stderr);
  });
  await check("installed capability protection cannot be bypassed by legacy UI fast route",()=>{
    const fast=require("../scripts/core-ui-fast-path"),css="pilot/nephi-home-node-pilot-v1/public/assets/guest.css";
    for(const policyText of [JSON.stringify({capabilityProtection:{required:true}}),"invalid JSON"]){
      const f=fixture(),git=(...args)=>cp.execFileSync("git",args,{cwd:f.root,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
      fs.mkdirSync(path.dirname(path.join(f.root,css)),{recursive:true});fs.writeFileSync(path.join(f.root,css),"body{color:red}\n");
      fs.writeFileSync(path.join(f.root,".github/core-reliability-policy.json"),policyText);git("add",".");git("commit","-qm","trusted capability baseline");const baseline=git("rev-parse","HEAD");
      fs.writeFileSync(path.join(f.root,css),"body{color:blue}\n");fs.writeFileSync(path.join(f.root,T),JSON.stringify({schemaVersion:1,baseline,objective:"display only",allowedPaths:[T,css],contractChangeAllowed:false,gateChangeAllowed:false,affectedCapabilities:[]}));
      git("add",".");git("commit","-qm","display candidate");const input={root:f.root,baseline,candidate:git("rev-parse","HEAD")};
      assert.equal(fast.classify(input).fast,false);assert.throws(()=>fast.verifyFast({...input,evidenceDir:path.join(f.root,"evidence")}),/FAST_PATH_NOT_ELIGIBLE/);
    }
  });
  console.log(JSON.stringify({classification:"STRUCTURED_CONTRACT_TEST",passed,failed:failures.length,failures,openAiCalls:0}));
  if(failures.length)throw Error("CAPABILITY_INSTALLATION_TEST_FAILED");
  return {passed};
}
if(require.main===module)run().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={run};
