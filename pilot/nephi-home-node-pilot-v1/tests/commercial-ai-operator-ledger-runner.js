"use strict";

const assert = require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {createHash}=require("node:crypto");
const {commercialOperation}=require("../lib/providers/commercial-ai-store");
const hash=name=>createHash("sha256").update(`synthetic-session:${name}`).digest("hex");

// RUNTIME_COMPONENT_TEST: isolated PGlite, persisted synthetic administrator sessions.
// Detects self-reported authority, expired/revoked session use, property-selection bypass,
// identity membership fallback, and unaccounted or customer-billed operator model calls.
(async()=>{
  const {PGlite}=await import("@electric-sql/pglite"),db=new PGlite();
  const op=(name,...args)=>commercialOperation({transaction:fn=>db.transaction(fn)},name,args);
  const input={propertyId:"operator",channelId:"admin-test",userId:"synthetic-operator",turnId:"operator-turn",eventIds:["operator-event"],adminSessionHash:hash("legacy")};
  try{
    const directory=path.resolve(__dirname,"../migrations");
    for(const file of fs.readdirSync(directory).filter(file=>file.endsWith(".sql")).sort())await db.exec(fs.readFileSync(path.join(directory,file),"utf8"));
    await db.query("INSERT INTO properties(property_id,display_name) VALUES('operator','Synthetic operator'),('other','Synthetic other')");
    await db.query("INSERT INTO commercial_ai_subscriptions(property_id,status) SELECT property_id,'legacy' FROM properties ON CONFLICT DO NOTHING");
    await db.query("INSERT INTO admin_users(property_id,username,password_hash) VALUES('operator','legacy','synthetic'),('operator','identity','synthetic'),('other','identity','synthetic')");
    await db.query("INSERT INTO admin_identities(user_id,email,normalized_email,password_hash) VALUES('identity-id','synthetic@example.test','synthetic@example.test','synthetic')");
    await db.query("INSERT INTO admin_user_properties(user_id,property_id,username) VALUES('identity-id','operator','identity'),('identity-id','other','identity')");
    for(const [name,userId,username,expired] of [["legacy",null,"legacy",false],["identity","identity-id","identity",false],["expired",null,"legacy",true]])await db.query("INSERT INTO admin_sessions(token_hash,user_id,property_id,username,expires_at) VALUES($1,$2,'operator',$3,now()+$4::interval)",[hash(name),userId,username,expired?"-1 hour":"1 hour"]);
    await op("setAiEnabled","operator",false);
    let admission;
    try{admission=await op("authorizeOperatorTest",input);}catch(error){if(["UNKNOWN_COMMERCIAL_OPERATION","COMMERCIAL_IDENTITY_REQUIRED"].includes(error.message))admission={allowed:false};else throw error;}
    assert.equal(admission.allowed,true,"operator test needs persisted session-backed internal-cost admission when guest AI is disabled and quota unconfigured");
    assert.equal((await op("authorizeOperatorTest",{...input,adminSessionHash:hash("missing"),ownerId:"legacy"})).allowed,false,"self-reported owner cannot replace persisted session");
    assert.equal((await op("authorizeOperatorTest",{...input,adminSessionHash:hash("expired")})).allowed,false);
    assert.equal((await op("authorizeOperatorTest",{...input,propertyId:"other"})).allowed,false);
    assert.equal((await op("authorizeOperatorTest",{...input,adminSessionHash:hash("identity"),propertyId:"other"})).allowed,false,"membership alone cannot bypass selected property");
    assert.equal((await op("authorizeOperatorTest",{...input,eventIds:["changed"]})).allowed,false);
    assert.equal((await op("authorizeOperatorTest",input)).allowed,true);
    assert.equal((await op("beginAttempt",{...input,attemptNumber:2})).reason,"INITIAL_ATTEMPT_REQUIRED");
    assert.equal((await op("beginAttempt",{...input,attemptNumber:1})).allowed,true);
    assert.equal((await op("beginAttempt",{...input,attemptNumber:1})).reason,"ATTEMPT_ALREADY_STARTED");
    await op("finishAttempt",{...input,attemptNumber:1,usage:{input_tokens:8,output_tokens:2,total_tokens:10},outcome:"success"});
    assert.equal((await op("beginAttempt",{...input,attemptNumber:2})).allowed,true);
    await op("finishAttempt",{...input,attemptNumber:2,usage:null,outcome:"timeout"});
    assert.equal((await op("getStatus","operator")).used,0);
    const cost=(await db.query("SELECT source,attempt_number,total_tokens FROM commercial_ai_attempt_ledger ORDER BY attempt_number")).rows;
    assert.deepEqual(cost,[{source:"manual_test",attempt_number:1,total_tokens:10},{source:"manual_test",attempt_number:2,total_tokens:null}]);
    const admissionRow=(await db.query("SELECT owner_id,test_session_id,admin_session_hash FROM commercial_ai_manual_authorizations WHERE turn_id='operator-turn'")).rows[0];
    assert.equal(admissionRow.owner_id,"operator:legacy");assert.equal(admissionRow.test_session_id,null);assert.equal(admissionRow.admin_session_hash,hash("legacy"));

    const identity={...input,turnId:"identity-turn",eventIds:["identity-event"],adminSessionHash:hash("identity"),ownerId:"forged-owner"};
    assert.equal((await op("authorizeOperatorTest",identity)).allowed,true);
    assert.equal((await db.query("SELECT owner_id FROM commercial_ai_manual_authorizations WHERE turn_id='identity-turn'")).rows[0].owner_id,"identity-id");
    await db.query("DELETE FROM admin_user_properties WHERE user_id='identity-id' AND property_id='operator'");
    assert.equal((await op("beginAttempt",{...identity,attemptNumber:1})).allowed,false,"identity session cannot fall back to legacy user when membership revoked");
    assert.equal((await op("authorizeOperatorTest",{...identity,turnId:"revoked-membership"})).allowed,false);
    const expiring={...input,turnId:"expiring-turn",eventIds:["expiring-event"]};
    assert.equal((await op("authorizeOperatorTest",expiring)).allowed,true);
    await db.query("UPDATE admin_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[hash("legacy")]);
    assert.equal((await op("beginAttempt",{...expiring,attemptNumber:1})).allowed,false,"expiry must be rechecked before actual model attempt");
    assert.equal((await db.query("SELECT count(*) AS n FROM commercial_ai_message_ledger")).rows[0].n,0);
    await assert.rejects(db.query("INSERT INTO commercial_ai_manual_authorizations(property_id,channel_id,line_user_id,turn_id,owner_id,event_ids) VALUES('operator','c','u','no-authority','owner',ARRAY['e'])"),/check constraint/);
    await db.query("DELETE FROM admin_sessions WHERE token_hash=$1",[hash("legacy")]);
    assert.equal((await db.query("SELECT count(*) AS n FROM commercial_ai_manual_authorizations WHERE admin_session_hash=$1",[hash("legacy")])).rows[0].n,0,"revocation removes session admission");
    assert.equal((await db.query("SELECT count(*) AS n FROM commercial_ai_attempt_ledger")).rows[0].n,2,"session deletion preserves recorded costs");
    console.log("RUNTIME_COMPONENT_TEST commercial operator cost ledger: PASS (isolated PGlite; database session authority; no real calls; attempts2 customer usage0)");
  }finally{await db.close();}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
