"use strict";
// FAKE_INTEGRATION: actual HTTP, admin writers, PostgreSQL providers (local
// PGlite), message persistence/coordinator/production adapter/core/Resolver.
// Only OpenAI HTTP is a deterministic fixture; no State/history is prefilled.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");
const { createProviders } = require("../lib/providers/provider-factory");
const { migratePostgres } = require("../lib/providers/postgres-migrate");
const { openPostgres } = require("../lib/providers/postgres-client");
const { upsertAdminUser } = require("../lib/admin-auth");

const DB_ID = "dpg-da6qo0jbc2fs738f11v0-a";
const SERVICE_ID = "srv-d9bqupbbc2fs73aselig";
const target = new URL("postgresql://localhost");
target.hostname = DB_ID;
target.pathname = "/nephi_home_node_pilot_test_only";
const env = {
  TEST_ONLY_ENVIRONMENT: "true", RENDER_SERVICE_ID: SERVICE_ID,
  DATABASE_URL: target.href, NEW_CORE_MANUAL_TEST_FACTS_DATABASE_URL: target.href,
  OPENAI_API_KEY: crypto.randomBytes(24).toString("hex")
};
const DATE = "2026-10-20", OUT = "2026-10-21";
const text = "2026-10-20入住，2026-10-21退房，2人住Room A，請查空房與價格";
function understanding(c01) {
  const event = c01.sourceEvents[0];
  const ref = { eventId:event.eventId, messageRef:event.messageRef,
    startOffset:0, endOffset:event.messageText.length, quote:event.messageText };
  assert.equal(event.messageText, text);
  assert.deepEqual(c01.recentConversation, [], "each inventory observation starts an empty dedicated conversation");
  return { understandingOutput: { schemaVersion:1, turnId:c01.turnId, units:[{
    unitId:"room-query", evidenceRefs:[ref], purpose:"lodging_question", capability:"availability",
    subject:{kind:"room",catalogIdentity:"room-a"}, stayDependent:true,
    temporalCandidate:{kind:"date_range",rawText:text,checkInCandidate:DATE,checkOutCandidate:OUT,nightsCandidate:1},
    contextLinkCandidateId:"new",safetyCandidate:null,confidenceBand:"high",
    slotCandidates:[{slotCandidateId:"guests",slot:"guest_count",value:2,operation:"SET",evidenceRefs:[ref]}]
  }] }, contextLinkCandidates:[{contextLinkCandidateId:"new",unitId:"room-query",relationKind:"NEW_REQUEST",
    currentSourceEvidenceRefs:[ref],referencedHistoryEventRefs:[]}] };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-fixed-admin-"));
  const connection = {kind:"pglite",dataDir:path.join(dir,"db")};
  await migratePostgres(connection);
  const db = await openPostgres(connection);
  try {
    for (const id of ["nephi_home","other_home"]) {
      await db.query("INSERT INTO properties(property_id,display_name) VALUES($1,$1)",[id]);
      await db.query("INSERT INTO property_settings(property_id,settings) VALUES($1,$2::jsonb)",
        [id,JSON.stringify({currency:"TWD",businessProfile:{publicSlug:id === "nephi_home" ? "fixturehome" : "otherhome"}})]);
      await db.query("INSERT INTO room_types(property_id,room_id,name,capacity,type,position,base_price,monday_thursday_price,friday_price,saturday_holiday_price,sunday_price) VALUES($1,'room-a','Room A',2,'double',0,1200,1200,1200,1200,1200)",[id]);
    }
    await db.query("INSERT INTO commercial_ai_subscriptions(property_id,status) VALUES('nephi_home','legacy')");
  } finally { await db.close(); }
  const password = crypto.randomBytes(24).toString("hex");
  await upsertAdminUser(connection,{propertyId:"nephi_home",username:"fixture-owner",email:"fixture@example.test",password});
  const providers = createProviders({postgresConnection:connection});
  providers.commercial.setLimit("nephi_home",1000);
  const nativeFetch = globalThis.fetch, calls = [], observations = [], cases = [];
  let lineCredentialReads = 0, lineSends = 0;
  const bindingLookup = providers.lineBindings.getLineBindingByWebhookKey.bind(providers.lineBindings);
  providers.lineBindings.getLineBindingByWebhookKey = (...args) => { lineCredentialReads++; return bindingLookup(...args); };
  globalThis.fetch = async (url, options) => {
    if (new URL(url).hostname === "127.0.0.1") return nativeFetch(url, options);
    assert.equal(new URL(url).hostname,"api.openai.com","external LINE and other HTTP forbidden");
    const body = JSON.parse(options.body);
    const c01 = JSON.parse(body.input.find(item => item.role === "developer").content[0].text);
    calls.push(c01);
    return new Response(JSON.stringify({model:"gpt-5.6-luna",status:"completed",
      output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(understanding(c01))}]}],
      usage:{input_tokens:1,output_tokens:1,total_tokens:2}}),{status:200});
  };
  const app = createApp({providers,runtimeEnv:env,testOnlyEnvironment:true,adminAuthRequired:true,
    enableProductionLineEngine:true,newCoreManualTestFactsProviders:providers,
    now:() => new Date("2026-09-25T03:00:00Z"),openAiTestEnv:{},lineBindingEnv:{},
    publicBrandEnv:{PUBLIC_BASE_URL:"https://test.example"},
    lineReplyClientFactory:() => ({replyMessageWithHttpInfo:async () => { lineSends++; throw new Error("LINE forbidden"); }})});
  const running = await app.start(0,"127.0.0.1");
  async function request(route, method = "GET", body, headers = {}) {
    const r = await fetch(running.url + route,{method,headers:{"content-type":"application/json",...headers},
      ...(body === undefined ? {} : {body:JSON.stringify(body)})});
    const raw = await r.text();
    return {status:r.status,headers:r.headers,...(r.headers.get("content-type")?.includes("application/json") ? JSON.parse(raw) : {html:raw})};
  }
  async function check(name, fn) { await fn(); cases.push(name); console.log("PASS " + name); }
  const month = "/api/availability/month?year=2026&month=10";
  const day = {date:DATE,roomTypeId:"room-a",status:"available"};
  async function chat(expectedOutcome = "answered") {
    const created = await request("/api/admin/new-core-test/sessions","POST",{});
    assert.equal(created.status,201,JSON.stringify(created));
    const session = created.data;
    const turn = await request(`/api/admin/new-core-test/sessions/${session.testSessionId}/turns`,"POST",{input:text});
    assert.equal(turn.status,201,JSON.stringify(turn));
    const diagnostic = turn.data.diagnostic;
    assert.equal(diagnostic.earliestFailure,null,JSON.stringify(diagnostic));
    assert.equal(diagnostic.finalDecision.action,"reply");
    assert.equal(diagnostic.resolver.status,expectedOutcome);
    assert.equal(diagnostic.resolver.foundOfficialData,expectedOutcome === "answered");
    assert.equal(diagnostic.transport.executionPath,"production-message-ingress");
    assert.equal(diagnostic.transport.testDbResourceId,DB_ID);
    assert.equal(diagnostic.transport.lineRealSend,"NOT_RUN");
    const message = providers.persistence.findMessageByEventId("nephi_home",turn.data.turnId);
    assert.equal(message.processingStatus,"reply_succeeded");
    assert.equal(providers.persistence.getConversationState("nephi_home",message.channelId,message.lineUserId).revision,1);
    const ui = providers.persistence.getNewCoreTestSession(session.testSessionId,session.ownerId,"nephi_home");
    assert.equal(ui.state.revision,0);
    observations.push({turnId:turn.data.turnId,response:turn.data.predictedResponse,diagnostic});
    return turn.data.predictedResponse;
  }
  try {
    await check("trusted fixed deployment enters existing admin without cookie", async () => {
      const session = await request("/api/admin/session");
      assert.equal(session.status,200,"fixed test admin session must not require login");
      assert.equal(session.data.propertyId,"nephi_home");
      assert.deepEqual(session.data.properties,[{propertyId:"nephi_home"}]);
      assert.equal(session.headers.get("set-cookie"),null);
      assert.equal((await request("/admin")).status,200);
      assert.equal((await request("/admin/new-core-test")).status,200);
      assert.equal((await request("/api/admin/session?slug=otherhome")).status,403);
    });
    await check("existing admin initialization reads the fixed property", async () => {
      for (const route of [month,"/api/bootstrap","/api/room-pricing","/api/bundles",
        "/api/property-profile","/api/property-facts","/api/room-composition","/api/custom-replies"])
        assert.equal((await request(route)).status,200,route);
      const homes = await request("/api/homestays");
      assert.deepEqual(homes.data.homestays.map(item => item.customerId),["nephi_home"]);
    });
    await check("all property aliases and duplicate query values remain isolated", async () => {
      for (const query of ["propertyId=other_home","customerId=other_home",
        "propertyId=nephi_home&customerId=other_home","propertyId=other_home&customerId=nephi_home",
        "propertyId=nephi_home&propertyId=other_home","customerId=nephi_home&customerId=other_home"])
        assert.equal((await request(month + "&" + query)).status,403,query);
      for (const scope of [{propertyId:"other_home"},{customerId:"other_home"},
        {propertyId:"nephi_home",customerId:"other_home"},{propertyId:"other_home",customerId:"nephi_home"}])
        assert.equal((await request("/api/availability/day","POST",{...day,...scope})).status,403);
      assert.deepEqual(providers.availability.getRows("other_home",DATE,OUT),[]);
    });
    await check("platform LINE credentials account and guest administration are not granted", async () => {
      for (const route of ["/api/admin/password","/api/guests","/api/messages","/api/dashboard","/api/reviews"])
        assert.equal((await request(route,route.endsWith("password") ? "POST" : "GET",route.endsWith("password") ? {} : undefined)).status,401,route);
      assert.equal((await request("/api/custom-replies/test","POST",{})).status,401);
    });
    await check("each trusted deployment prerequisite fails closed before message persistence", async () => {
      const invalidDb = [];
      for (const [key,value] of [["hostname","unapproved.invalid"],["pathname","/other_database"],
        ["protocol","https:"],["port","6543"],["search","?host=unapproved.invalid"],["hash","#override"]]) {
        const changed = new URL(key === "protocol" ? target.href.replace("postgresql:",value) : target);
        if (key !== "protocol") changed[key] = value;
        invalidDb.push(changed.href);
      }
      invalidDb.push("", "not-a-url");
      const matrix = [["TEST_ONLY_ENVIRONMENT","false"],["TEST_ONLY_ENVIRONMENT",""],
        ["RENDER_SERVICE_ID","another-service"],["RENDER_SERVICE_ID",""]];
      for (const key of ["DATABASE_URL","NEW_CORE_MANUAL_TEST_FACTS_DATABASE_URL"])
        for (const value of invalidDb) matrix.push([key,value]);
      for (const [key,value] of matrix) {
        const previous = env[key]; env[key] = value;
        try {
          assert.equal((await request("/api/admin/session")).status,401,key);
          assert.equal((await request("/admin/new-core-test")).status,401,key);
          assert.equal((await request(month)).status,401,key);
          assert.equal((await request("/api/availability/day","POST",day)).status,401,key);
          assert.equal((await request("/api/admin/new-core-test/sessions","POST",{})).status,401,key);
        } finally { env[key] = previous; }
      }
      assert.equal(providers.persistence.listMessageLogs("nephi_home").length,0);
      assert.equal(calls.length,0);
    });
    await check("request host query cookie and headers cannot forge deployment identity", async () => {
      env.RENDER_SERVICE_ID = "another-service";
      try {
        const headers = {host:"test.junzanai.com","x-forwarded-host":"test.junzanai.com",
          "x-render-service-id":SERVICE_ID,"render-service-id":SERVICE_ID,"test-only-environment":"true",
          cookie:`TEST_ONLY_ENVIRONMENT=true; RENDER_SERVICE_ID=${SERVICE_ID}; nephi_admin_session=forged`};
        for (const route of ["/api/admin/session","/admin/new-core-test"])
          assert.equal((await request(`${route}?TEST_ONLY_ENVIRONMENT=true&RENDER_SERVICE_ID=${SERVICE_ID}`,"GET",undefined,headers)).status,401);
      } finally { env.RENDER_SERVICE_ID = SERVICE_ID; }
    });
    await check("non-test deployment preserves real cookie authentication and property restriction", async () => {
      env.TEST_ONLY_ENVIRONMENT = "false";
      try {
        assert.equal((await request("/api/admin/session")).status,401);
        assert.equal((await request(month)).status,401);
        assert.equal((await request("/admin/new-core-test")).status,401);
        assert.match((await request("/admin")).html,/id="loginForm"/);
        const login = await request("/api/admin/login","POST",{email:"fixture@example.test",password});
        assert.equal(login.status,200,JSON.stringify(login));
        const cookie = login.headers.get("set-cookie").split(";")[0];
        assert.equal((await request("/api/admin/session","GET",undefined,{cookie})).data.propertyId,"nephi_home");
        assert.equal((await request(month + "&propertyId=nephi_home","GET",undefined,{cookie})).status,200);
        assert.equal((await request(month + "&propertyId=other_home","GET",undefined,{cookie})).status,403);
      } finally { env.TEST_ONLY_ENVIRONMENT = "true"; }
    });
    await check("admin opens inventory; chat production adapter reads the same PostgreSQL facts", async () => {
      assert.equal((await request("/api/availability/day","POST",day)).status,200);
      assert.equal(providers.availability.getRows("nephi_home",DATE,OUT)[0]["room-a"],"available");
      assert.match(await chat(),/1,?200/);
    });
    await check("admin closes inventory; chat no longer offers it", async () => {
      assert.equal((await request("/api/availability/day","POST",{...day,status:"closed"})).status,200);
      assert.equal(providers.availability.getRows("nephi_home",DATE,OUT)[0]["room-a"],"closed");
      const response = await chat("no_availability");
      assert.doesNotMatch(response,/1,?200/);
      assert.equal(app.service.searchAvailability({customerId:"nephi_home",checkIn:DATE,checkOut:OUT}).rooms.length,0);
    });
    await check("admin edits a date price; reopened inventory chat uses the new price", async () => {
      assert.equal((await request("/api/availability/day","POST",day)).status,200);
      assert.equal((await request("/api/inventory-price-overrides","POST",{
        inventoryType:"room",inventoryId:"room-a",date:DATE,price:1500})).status,200);
      assert.match(await chat(),/1,?500/);
      assert.equal(calls.length,3,"one deterministic understanding per observation, no passing resample");
    });
    await check("normal room and bundle editors use existing scoped providers", async () => {
      const room = {roomTypeId:"room-a",roomCode:"A",displayName:"Room A",capacity:2,highlights:[],enabled:true,
        mondayThursdayPrice:1400,fridayPrice:1400,saturdayHolidayPrice:1400,sundayPrice:1400};
      assert.equal((await request("/api/room-pricing","PUT",{rooms:[room]})).status,200);
      assert.equal(providers.customerSettings.getProperty("other_home").rooms[0].mondayThursdayPrice,1200);
      const bundle = {name:"Synthetic whole house",capacity:2,memberRoomIds:["room-a"],enabled:true,
        mondayThursdayPrice:1400,fridayPrice:1400,saturdayHolidayPrice:1400,sundayPrice:1400};
      const created = await request("/api/bundles","POST",bundle);
      assert.equal(created.status,201,JSON.stringify(created));
      const id = created.data.bundle.id;
      assert.equal((await request(`/api/bundles/${id}`,"PUT",{...bundle,name:"Synthetic edited"})).status,200);
      assert.equal((await request(`/api/bundles/${id}`,"DELETE",{})).status,200);
      assert.equal(providers.customerSettings.listBundles("other_home").length,0);
      assert.deepEqual(providers.availability.getRows("other_home",DATE,OUT),[]);
      assert.equal(lineCredentialReads,0); assert.equal(lineSends,0);
    });
    console.log(JSON.stringify({classification:"FAKE_INTEGRATION",caseCount:cases.length,passCount:cases.length,
      realOpenAICalls:0,fakeOpenAICalls:calls.length,lineRealSend:"NOT_RUN",cases,observations}));
  } finally { await app.stop(); globalThis.fetch = nativeFetch; }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
