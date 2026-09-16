"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Client } = require("pg");

// REAL_POSTGRESQL_PROVIDER, explicitly isolated localhost PostgreSQL only.
// This runner creates its own schema and never connects to deployed databases.
// --mutation-no-control-lock compiles a test-only copy with the property lock removed.
// Its expected nonzero exit proves the race assertion detects missing serialization.
function loadOperation(mutate) {
  const filename = path.resolve(__dirname, "../lib/providers/commercial-ai-store.js");
  if (!mutate) return require(filename).commercialOperation;
  const Module = require("node:module");
  const source = fs.readFileSync(filename, "utf8");
  const lock = "SELECT monthly_limit, ai_enabled FROM commercial_ai_controls WHERE property_id=$1 FOR UPDATE";
  assert.ok(source.includes(lock), "mutation target must be the existing property control row lock");
  const copy = new Module(filename, module);
  copy.filename = filename;
  copy.paths = module.paths;
  copy._compile(source.replace(lock, lock.replace(" FOR UPDATE", "")), filename);
  return copy.exports.commercialOperation;
}

(async () => {
  assert.ok(process.argv[2], "explicit isolated localhost PostgreSQL URL required");
  const url = new URL(process.argv[2]);
  assert.ok(["postgres:","postgresql:"].includes(url.protocol), "PostgreSQL URL required");
  assert.ok(["127.0.0.1","[::1]"].includes(url.hostname), "only literal loopback hosts allowed");
  assert.equal(url.pathname, "/junzan_commercial_atomicity", "dedicated isolated database required");
  assert.equal(url.search, "", "connection parameter overrides are forbidden");
  assert.equal(url.hash, "", "URL fragments are forbidden");
  const mutate = process.argv.includes("--mutation-no-control-lock");
  const commercialOperation = loadOperation(mutate);
  const connections = [0,1,2].map(() => new Client({ connectionString:url.href, ssl:false }));
  const schema = `commercial_atomicity_${randomUUID().replaceAll("-", "")}`;
  let created = false;
  let widenRace = false;
  const september = "2026-09-30T15:59:59Z", october = "2026-09-30T16:00:00Z";
  const wrap = connection => ({ transaction:async work => {
    await connection.query("BEGIN");
    try {
      const result = await work({ query:async (sql, params) => {
        const answer = await connection.query(sql, params);
        // Both clients read usage before mutating it when the lock is missing.
        // With the real lock, the second reader waits for the first commit.
        if (widenRace && sql.startsWith("SELECT used FROM commercial_ai_monthly_usage")) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        return answer;
      }});
      await connection.query("COMMIT");
      return result;
    } catch (error) { await connection.query("ROLLBACK"); throw error; }
  }});
  const op = (index, name, ...args) => commercialOperation(wrap(connections[index]), name, args);
  const input = (propertyId,eventIds,now=september) => ({propertyId,channelId:"synthetic-channel",userId:"synthetic-user",eventIds,now});
  try {
    await Promise.all(connections.map(connection => connection.connect()));
    const pids = await Promise.all(connections.map(async connection => (await connection.query("SELECT pg_backend_pid() AS pid")).rows[0].pid));
    assert.equal(new Set(pids).size, 3, "three independently connected PostgreSQL backends required");
    const version = (await connections[0].query("SELECT version() AS version")).rows[0].version;
    console.log(JSON.stringify({classification:"REAL_POSTGRESQL_PROVIDER",environment:"isolated localhost, synthetic messages",version,backendPids:pids,mutation:mutate}));
    await connections[0].query(`CREATE SCHEMA ${schema}`);
    created = true;
    await Promise.all(connections.map(connection => connection.query(`SET search_path TO ${schema}`)));
    for (const file of ["001_initial.sql","002_admin_auth.sql","025_new_core_test_sessions.sql","026_commercial_ai_controls.sql"]) {
      await connections[0].query(fs.readFileSync(path.resolve(__dirname,"../migrations",file),"utf8"));
    }
    await connections[0].query("INSERT INTO properties(property_id,display_name) VALUES('distinct','Synthetic distinct race'),('duplicate','Synthetic duplicate race')");
    for (const [propertyId,ids] of [["distinct",["one","two","next"]],["duplicate",["same"]]]) {
      for (const id of ids) await connections[0].query("INSERT INTO message_logs(property_id,channel_id,line_user_id,event_id,review_id,payload) VALUES($1,'synthetic-channel','synthetic-user',$2,$2,'{}')",[propertyId,id]);
      await op(0,"setLimit",propertyId,1);
    }
    widenRace = true;
    const distinct = await Promise.all([op(1,"reserve",input("distinct",["one"])),op(2,"reserve",input("distinct",["two"]))]);
    widenRace = false;
    console.log(JSON.stringify({case:"distinct events, remaining one",results:distinct}));
    assert.equal(distinct.filter(result => result.allowed).length, 1, "remaining one must admit exactly one concurrent distinct event");
    assert.equal((await op(0,"getStatus","distinct",september)).used,1);
    assert.equal(Number((await connections[0].query("SELECT count(*) AS n FROM commercial_ai_message_ledger WHERE property_id='distinct'")).rows[0].n),1);

    widenRace = true;
    const duplicate = await Promise.all([op(1,"reserve",input("duplicate",["same"])),op(2,"reserve",input("duplicate",["same"]))]);
    widenRace = false;
    assert.ok(duplicate.every(result => result.allowed), "concurrent duplicate is idempotently allowed");
    assert.equal((await op(0,"getStatus","duplicate",september)).used,1);
    assert.equal(Number((await connections[0].query("SELECT count(*) AS n FROM commercial_ai_message_ledger WHERE property_id='duplicate'")).rows[0].n),1);
    console.log(JSON.stringify({case:"same event concurrent duplicate",results:duplicate,used:1}));

    const octoberRepeat = await op(1,"reserve",input("duplicate",["same"],october));
    assert.equal(octoberRepeat.period,"2026-09");
    assert.equal((await op(2,"getStatus","duplicate",october)).used,0);
    assert.equal((await op(1,"reserve",input("distinct",["next"],october))).allowed,true);
    assert.equal((await op(2,"getStatus","distinct",october)).used,1);
    assert.equal((await op(2,"getStatus","distinct",september)).used,1);
    console.log(JSON.stringify({case:"Taipei month boundary",duplicateOriginalPeriod:octoberRepeat.period,septemberUsed:1,octoberUsed:1}));

    const makeAttempt = () => ({...input("duplicate",["same"]),turnId:"same-turn",attemptNumber:1});
    const attempts = await Promise.all([op(1,"beginAttempt",makeAttempt()),op(2,"beginAttempt",makeAttempt())]);
    assert.equal(attempts.filter(result => result.allowed).length,1,"duplicate model attempt must be admitted once across connections");
    assert.equal(Number((await connections[0].query("SELECT count(*) AS n FROM commercial_ai_attempt_ledger")).rows[0].n),1);
    console.log(JSON.stringify({case:"same initial attempt concurrent admission",results:attempts}));
    console.log("REAL_POSTGRESQL_PROVIDER commercial AI atomicity: PASS (isolated localhost PostgreSQL; independent connections; no deployed database/OpenAI/LINE)");
  } finally {
    if (created) await connections[0].query(`DROP SCHEMA ${schema} CASCADE`);
    await Promise.all(connections.map(connection => connection.end()));
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
