"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// RUNTIME_COMPONENT_TEST: isolated PGlite, synthetic persisted messages, no external providers.
// Catches double billing, missing transaction serialization, cross-scope reuse, switch bypass,
// untrusted source events, duplicate network admission, and lost/fictional usage accounting.
(async () => {
  const modulePath = path.resolve(__dirname, "../lib/providers/commercial-ai-store.js");
  assert.ok(fs.existsSync(modulePath), "commercial AI persistent ledger is required");
  const { commercialOperation } = require(modulePath);
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  const client = { transaction: fn => db.transaction(fn) };
  const op = (name, ...args) => commercialOperation(client, name, args);
  const september = "2026-09-30T15:59:59Z", october = "2026-09-30T16:00:00Z";
  const scope = { propertyId: "p1", channelId: "c1", userId: "u1" };
  const source = (eventIds, now = september, other = {}) => ({ ...scope, eventIds, now, ...other });
  const attempt = (turnId, attemptNumber, eventIds = ["e1"], other = {}) => ({ ...source(eventIds), turnId, attemptNumber, ...other });
  const message = async (eventId, other = {}) => {
    const row = { ...scope, ...other };
    await db.query("INSERT INTO message_logs(property_id,channel_id,line_user_id,event_id,review_id,payload) VALUES($1,$2,$3,$4,$5,'{}')", [row.propertyId,row.channelId,row.userId,eventId,`${row.channelId}:${row.userId}:${eventId}`]);
  };
  try {
    for (const file of fs.readdirSync(path.resolve(__dirname, "../migrations")).filter(file => file.endsWith(".sql")).sort()) {
      await db.exec(fs.readFileSync(path.resolve(__dirname, "../migrations", file), "utf8"));
    }
    await db.query("INSERT INTO properties(property_id,display_name) VALUES('p1','Synthetic one'),('p2','Synthetic two'),('race','Synthetic race')");
    assert.deepEqual(await op("getStatus", "p1", september), { propertyId:"p1", monthlyLimit:null, used:0, remaining:null, period:"2026-09", aiEnabled:true, status:"UNCONFIGURED" });
    await message("e1");
    assert.equal((await op("reserve", source(["e1"]))).reason, "UNCONFIGURED");
    await assert.rejects(op("setLimit", "p1", -1), /INVALID_MONTHLY_LIMIT/);
    await assert.rejects(op("setLimit", "p1", 1.5), /INVALID_MONTHLY_LIMIT/);
    await assert.rejects(op("setAiEnabled", "p1", "false"), /INVALID_BOOLEAN/);
    await op("setLimit", "p1", 2);
    assert.equal((await op("reserve", source(["e1", "e1"]))).allowed, true);
    assert.equal((await op("reserve", source(["e1"]))).allowed, true);
    assert.equal((await op("getStatus", "p1", september)).used, 1);
    assert.equal((await op("reserve", source(["e1"], october))).period, "2026-09");
    assert.equal((await op("getStatus", "p1", october)).used, 0);
    assert.equal((await op("reserve", source(["e1"], september, { userId:"other" }))).reason, "EVENT_SCOPE_MISMATCH");
    assert.equal((await op("reserve", source(["e1"], september, { channelId:"other" }))).reason, "EVENT_SCOPE_MISMATCH");
    assert.equal((await op("reserve", source(["missing"]))).reason, "UNTRUSTED_EVENT");
    assert.equal((await op("reserve", source([]))).reason, "UNTRUSTED_EVENT");
    await message("e2"); await message("e3");
    assert.equal((await op("reserve", source(["e2","e3"]))).reason, "QUOTA_EXHAUSTED");
    assert.equal((await op("getStatus", "p1", september)).used, 1, "multi-source reservation must roll back as a unit");

    assert.equal((await op("beginAttempt", attempt("turn", 2))).reason, "INITIAL_ATTEMPT_REQUIRED");
    assert.equal((await op("beginAttempt", attempt("unreserved", 1, ["e2"]))).reason, "RESERVATION_REQUIRED");
    assert.equal((await op("beginAttempt", attempt("turn", 1))).allowed, true);
    const started = (await db.query("SELECT * FROM commercial_ai_attempt_ledger WHERE property_id='p1' AND turn_id='turn' AND attempt_number=1")).rows[0];
    assert.ok(started.started_at, "admission must commit an attempt row before the caller can invoke the network");
    assert.equal(started.input_tokens, null);
    assert.equal(started.finished_at, null);
    assert.equal((await op("beginAttempt", attempt("turn", 1))).reason, "ATTEMPT_ALREADY_STARTED");
    assert.equal((await op("beginAttempt", attempt("different-turn", 1))).reason, "EVENT_ALREADY_ASSIGNED");
    await op("finishAttempt", { ...attempt("turn",1), usage: { input_tokens:10,input_tokens_details:{cached_tokens:3},output_tokens:4,total_tokens:14 }, outcome:"success" });
    assert.equal((await op("beginAttempt", attempt("turn", 2))).allowed, true);
    await op("finishAttempt", { ...attempt("turn",2), usage:null, outcome:"timeout" });
    assert.equal((await op("beginAttempt", attempt("turn", 3))).reason, "ATTEMPT_LIMIT");
    const rows = (await db.query("SELECT attempt_number,input_tokens,cached_input_tokens,output_tokens,total_tokens,outcome FROM commercial_ai_attempt_ledger WHERE property_id='p1' ORDER BY attempt_number")).rows;
    assert.deepEqual(rows, [
      { attempt_number:1,input_tokens:10,cached_input_tokens:3,output_tokens:4,total_tokens:14,outcome:"success" },
      { attempt_number:2,input_tokens:null,cached_input_tokens:null,output_tokens:null,total_tokens:null,outcome:"timeout" }
    ]);
    assert.equal((await op("getStatus", "p1", september)).used, 1, "two model attempts charge one trusted message");
    await assert.rejects(op("finishAttempt", { ...attempt("turn",1), userId:"other", usage:null,outcome:"success" }), /ATTEMPT_NOT_FOUND/);
    await op("finishAttempt", { ...attempt("turn",1), usage:null,outcome:"timeout" });
    assert.equal((await db.query("SELECT input_tokens FROM commercial_ai_attempt_ledger WHERE property_id='p1' AND attempt_number=1")).rows[0].input_tokens, 10, "finish retries preserve first accounting");

    await op("setAiEnabled", "p1", false);
    assert.equal((await op("getStatus", "p1", september)).status, "AI_DISABLED");
    assert.equal((await op("reserve", source(["e2"]))).reason, "AI_DISABLED");
    await op("setAiEnabled", "p1", true);
    assert.equal((await op("reserve", source(["e2"]))).allowed, true);
    await op("setHandoff", "p1", "c1", "u1", true);
    assert.deepEqual(await op("getHandoff", "p1", "c1", "u1"), { humanControlled:true });
    assert.equal((await op("beginAttempt", attempt("blocked",1,["e2"]))).reason, "HUMAN_CONTROLLED");
    assert.equal((await op("reserve", source(["e2"]))).reason, "HUMAN_CONTROLLED");
    assert.deepEqual(await op("getHandoff", "p1", "other", "u1"), { humanControlled:false });
    assert.deepEqual(await op("getHandoff", "p2", "c1", "u1"), { humanControlled:false });
    await op("setHandoff", "p1", "c1", "u1", false);
    await op("setAiEnabled", "p1", false);
    assert.equal((await op("beginAttempt", attempt("blocked",1,["e2"]))).reason, "AI_DISABLED");
    await op("setAiEnabled", "p1", true);
    assert.equal((await op("beginAttempt", attempt("blocked",1,["e2"]))).allowed, true, "already reserved final quota can start");
    await op("setHandoff", "p1", "c1", "u1", true);
    assert.equal((await op("beginAttempt", attempt("blocked",2,["e2"]))).reason, "HUMAN_CONTROLLED", "correction rechecks handoff");
    await op("setHandoff", "p1", "c1", "u1", false);
    assert.equal((await op("getStatus", "p1", september)).status, "QUOTA_EXHAUSTED");
    await op("setLimit", "p1", null);
    assert.equal((await op("beginAttempt", attempt("blocked",2,["e2"]))).reason, "UNCONFIGURED");
    await op("setLimit", "p2", 0);
    await message("e1", { propertyId:"p2" });
    assert.equal((await op("reserve", source(["e1"],september,{propertyId:"p2"}))).reason, "QUOTA_EXHAUSTED");
    await op("setLimit", "p2", 1);
    assert.equal((await op("reserve", source(["e1"],september,{propertyId:"p2"}))).allowed, true);
    assert.equal((await op("getStatus", "p1", september)).used, 2);

    await op("setLimit", "race", 1);
    await message("r1",{propertyId:"race"}); await message("r2",{propertyId:"race"});
    const racing = await Promise.all(["r1","r2"].map(id => op("reserve",source([id],september,{propertyId:"race"}))));
    assert.equal(racing.filter(result => result.allowed).length, 1);
    assert.equal((await op("getStatus", "race", september)).used, 1);
    const newMonth = await op("reserve", source(["r3"],october,{propertyId:"race"}));
    assert.equal(newMonth.reason,"UNTRUSTED_EVENT");
    await message("r3",{propertyId:"race"});
    assert.equal((await op("reserve", source(["r3"],october,{propertyId:"race"}))).allowed,true);
    assert.equal((await op("getStatus", "race", october)).used,1);

    await assert.rejects(commercialOperation({ transaction:async () => { throw new Error("DB_DOWN"); } },"reserve",[source(["e1"])]), /DB_DOWN/);
    await assert.rejects(commercialOperation({ query:() => { throw new Error("must not use pool query"); } },"reserve",[source(["e1"])]), /TRANSACTION_REQUIRED/);
    console.log("RUNTIME_COMPONENT_TEST commercial AI ledger: PASS (isolated PGlite; no real PostgreSQL/OpenAI/LINE; concurrency uses PGlite transaction queue)");
  } finally { await db.close(); }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
