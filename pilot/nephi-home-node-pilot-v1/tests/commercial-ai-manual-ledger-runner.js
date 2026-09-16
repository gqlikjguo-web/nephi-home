"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { commercialOperation } = require("../lib/providers/commercial-ai-store");

// RUNTIME_COMPONENT_TEST: isolated PGlite and synthetic authenticated manual session.
// Catches permission/scope bypass, customer-quota debit, missing model-cost recording,
// duplicate attempts, and accidental restrictions from commercial guest controls.
(async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  const client = { transaction:fn => db.transaction(fn) };
  const op = (name,...args) => commercialOperation(client,name,args);
  const scope = {propertyId:"manual",channelId:"manual-test",userId:"manual-user"};
  const input = {...scope,turnId:"manual-turn",eventIds:["manual-event"],testSessionId:"f585c9af-e5e5-4880-9fca-45c13c6e7cb7",ownerId:"owner"};
  try {
    for (const file of ["001_initial.sql","002_admin_auth.sql","025_new_core_test_sessions.sql","026_commercial_ai_controls.sql"]) await db.exec(fs.readFileSync(path.resolve(__dirname,"../migrations",file),"utf8"));
    await db.query("INSERT INTO properties(property_id,display_name) VALUES('manual','Synthetic manual test'),('other','Synthetic other')");
    await db.query("INSERT INTO new_core_test_sessions(test_session_id,property_id,owner_id,state_v3,created_at,updated_at) VALUES($1,$2,$3,$4,now(),now())",[input.testSessionId,input.propertyId,input.ownerId,JSON.stringify({scope:{propertyId:scope.propertyId,channel:scope.channelId,userId:scope.userId}})]);
    await op("setAiEnabled","manual",false);
    await op("setHandoff","manual",scope.channelId,scope.userId,true);
    assert.equal((await op("getStatus","manual")).monthlyLimit,null);
    assert.equal((await op("beginAttempt",{...input,attemptNumber:1})).allowed,false,"calling begin alone never grants manual permission");

    let admission;
    try { admission = await op("authorizeManual",input); }
    catch (error) { if (["UNKNOWN_COMMERCIAL_OPERATION","COMMERCIAL_IDENTITY_REQUIRED"].includes(error.message)) admission={allowed:false,reason:"MANUAL_AUTHORIZATION_NOT_IMPLEMENTED"}; else throw error; }
    assert.equal(admission.allowed,true,"authenticated manual test requires persisted cost-only authorization even when customer AI is off and quota unconfigured");
    assert.equal((await op("authorizeManual",{...input,ownerId:"wrong"})).allowed,false);
    assert.equal((await op("authorizeManual",{...input,propertyId:"other"})).allowed,false);
    assert.equal((await op("authorizeManual",{...input,channelId:"wrong"})).allowed,false);
    assert.equal((await op("authorizeManual",{...input,userId:"wrong"})).allowed,false);
    assert.equal((await op("authorizeManual",{...input,testSessionId:"1d92f55c-cbcf-46ae-8db4-c1ce5132ee37"})).allowed,false);
    assert.equal((await op("authorizeManual",{...input,eventIds:["different"]})).allowed,false,"existing admission cannot be rebound to different source events");
    assert.equal((await op("authorizeManual",input)).allowed,true,"identical admission retry is idempotent");
    assert.equal((await op("beginAttempt",{...input,eventIds:["different"],attemptNumber:1})).allowed,false);
    assert.equal((await op("beginAttempt",{...input,attemptNumber:2})).reason,"INITIAL_ATTEMPT_REQUIRED");
    assert.equal((await op("beginAttempt",{...input,attemptNumber:1})).allowed,true);
    assert.equal((await op("beginAttempt",{...input,attemptNumber:1})).reason,"ATTEMPT_ALREADY_STARTED");
    await op("finishAttempt",{...input,attemptNumber:1,usage:{input_tokens:12,output_tokens:3,total_tokens:15},outcome:"success"});
    assert.equal((await op("beginAttempt",{...input,attemptNumber:2})).allowed,true);
    await op("finishAttempt",{...input,attemptNumber:2,usage:null,outcome:"timeout"});
    assert.equal((await op("beginAttempt",{...input,attemptNumber:2})).reason,"ATTEMPT_ALREADY_STARTED");
    assert.equal((await op("beginAttempt",{...input,attemptNumber:3})).reason,"ATTEMPT_LIMIT");
    const attempts=(await db.query("SELECT source,attempt_number,input_tokens,total_tokens FROM commercial_ai_attempt_ledger ORDER BY attempt_number")).rows;
    assert.deepEqual(attempts,[{source:"manual_test",attempt_number:1,input_tokens:12,total_tokens:15},{source:"manual_test",attempt_number:2,input_tokens:null,total_tokens:null}]);
    assert.equal((await op("getStatus","manual")).used,0,"manual calls never consume customer quota");
    assert.equal((await db.query("SELECT count(*) AS n FROM commercial_ai_monthly_usage")).rows[0].n,0);
    assert.equal((await db.query("SELECT count(*) AS n FROM commercial_ai_message_ledger")).rows[0].n,0);
    const extra={...input,turnId:"stale-turn",eventIds:["stale-event"]};
    assert.equal((await op("authorizeManual",extra)).allowed,true);
    await db.query("UPDATE new_core_test_sessions SET owner_id='new-owner' WHERE test_session_id=$1",[input.testSessionId]);
    assert.equal((await op("beginAttempt",{...extra,attemptNumber:1})).allowed,false,"persisted permission must still match live session ownership");
    console.log("RUNTIME_COMPONENT_TEST commercial manual cost ledger: PASS (isolated PGlite; no real model calls; manual attempts2, customer quota0)");
  } finally { await db.close(); }
})().catch(error => {console.error(error.stack || error);process.exitCode=1;});
