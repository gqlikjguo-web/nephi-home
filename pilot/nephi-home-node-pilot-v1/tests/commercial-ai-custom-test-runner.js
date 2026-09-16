"use strict";
// FAKE_INTEGRATION: real HTTP route, custom-test handler, production adapter and commercial context;
// isolated JSON storage, fake authenticated session/store and injected model execution. No external calls.
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { createApp } = require("../server");
const { createJsonProviders } = require("../lib/providers/json-providers");
const { sessionTokenHash } = require("../lib/admin-auth");
const { beforeCommercialAttempt, finishCommercialAttempt } = require("../lib/commercial-ai-gate");
const NOW = "2026-09-16T02:00:00.000Z", TOKEN = "isolated-custom-test-session", KEY = "isolated-custom-test-key";
async function run() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "commercial-custom-test-"));
  const seedFile = path.join(temporary, "seed.json");
  fs.writeFileSync(seedFile, JSON.stringify({ seedDays: 1, homestays: [{ customerId: "property-a", name: "A", rooms: [{ id: "room-a", name: "A", capacity: 2 }], safeFacts: {} }] }));
  let activeApp;
  try {
    for (const commercial of [true, false]) {
      const providers = createJsonProviders({ seedFile, dataFile: path.join(temporary, commercial ? "commercial.json" : "plain.json"), now: () => new Date(NOW) });
      const authorizations = [], attempts = [], finished = [], cleanups = [];
      let reserves = 0, executed = 0, permit = true, accountingFailure = false;
      providers.persistence.getAdminSession = async hash => hash === sessionTokenHash(TOKEN) ? { propertyId: "property-a", userId: "operator-a", expiresAt: "2026-09-17T02:00:00.000Z" } : null;
      const deleteState = providers.persistence.deleteConversationState.bind(providers.persistence);
      providers.persistence.deleteConversationState = (...args) => { cleanups.push(args); return deleteState(...args); };
      providers.customReplies.create({ propertyId: "property-a", ruleId: "rule-a", name: "Rule", topic: "booking_open", scope: "all", approvedReply: "可直接與業者確認訂房。", enabled: true, effectiveStartDate: "2026-01-01", effectiveEndDate: "2026-12-31", createdAt: NOW, updatedAt: NOW });
      if (commercial) providers.commercial = {
        async reserve() { reserves++; return { allowed: false, reason: "GUEST_QUOTA_EXHAUSTED" }; },
        async authorizeOperatorTest(scope) {
          authorizations.push(scope);
          return { allowed: permit && scope.adminSessionHash === sessionTokenHash(TOKEN) && scope.propertyId === "property-a", reason: "OPERATOR_AUTHORIZATION_REQUIRED" };
        },
        async beginAttempt(scope) { if (accountingFailure) throw new Error("isolated ledger failure"); attempts.push(scope); return { allowed: true }; },
        async finishAttempt(scope) { finished.push(scope); }
      };
      activeApp = createApp({ providers, adminAuthRequired: true, enableProductionLineEngine: true, runtimeEnv: { OPENAI_API_KEY: KEY }, now: () => new Date(NOW),
        newCoreProductionExecuteTurn: async args => {
          executed++;
          const ticket = await beforeCommercialAttempt({ propertyScope: args.scope, sourceEvents: args.input.sourceEvents, turnId: args.input.turnId }, 1, KEY);
          if (commercial) assert.ok(ticket, "custom test must establish paid-attempt accounting context"); else assert.equal(ticket, null);
          await finishCommercialAttempt(ticket, { inputTokens: 7, outputTokens: 3 }, "success");
          return { state: args.state, finalDecision: { action: "reply", taskIds: [], missingFields: [], reviewRequired: false }, finalResponse: { shouldReply: true, replyText: "fixture model result" }, artifacts: { executionOutcomes: [{ taskId: "rule", type: "availability", outcome: "answered", facts: { customReplyRuleId: "rule-a" } }] } };
        }
      });
      const running = await activeApp.start(0, "127.0.0.1");
      const request = async (overrides = {}, token = TOKEN) => {
        const response = await fetch(running.url + "/api/custom-replies/test", { method: "POST", headers: { "content-type": "application/json", ...(token ? { cookie: "nephi_admin_session=" + token } : {}) }, body: JSON.stringify({ propertyId: "property-a", ruleId: "rule-a", messageText: "請問可以訂房嗎？", adminSessionHash: "attacker-body-value", ...overrides }) });
        return { status: response.status, body: await response.json() };
      };
      const result = await request();
      assert.equal(reserves, 0, "operator custom-reply test must never consume or reserve guest quota");
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.data.matched, true); assert.equal(result.body.data.reply, "可直接與業者確認訂房。"); assert.equal(result.body.data.rule.ruleId, "rule-a"); assert.equal(result.body.data.reason, null);
      assert.equal(executed, 1); assert.equal(cleanups.length, 1);
      assert.equal(providers.persistence.getConversationState(...cleanups[0]), null, "temporary conversation state must be cleaned after successful test");
      if (commercial) {
        assert.equal(authorizations.length, 1); const scope = authorizations[0];
        assert.equal(scope.adminSessionHash, sessionTokenHash(TOKEN)); assert.notEqual(scope.adminSessionHash, "attacker-body-value"); assert.notEqual(scope.adminSessionHash, TOKEN);
        assert.equal(scope.propertyId, "property-a"); assert.match(scope.channelId, /^custom-reply-test:/); assert.equal(scope.channelId, scope.userId); assert.equal(scope.turnId, scope.eventIds[0]);
        assert.equal(attempts.length, 1); assert.equal(finished.length, 1); assert.deepEqual(finished[0].usage, { inputTokens: 7, outputTokens: 3 });
        assert.equal((await request({}, "")).status, 401); assert.equal((await request({ propertyId: "property-b" })).status, 403); assert.equal(authorizations.length, 1);
        permit = false; const denied = await request(); assert.equal(denied.status, 409); assert.equal(executed, 1); assert.equal(cleanups.length, 2);
        permit = true; accountingFailure = true; const failed = await request(); assert.equal(failed.status, 409); assert.equal(cleanups.length, 3); assert.equal(reserves, 0);
      } else assert.equal(authorizations.length, 0);
      await activeApp.stop(); activeApp = null;
    }
    console.log("PASS custom-reply test uses cookie-hash operator admission and cost context, never guest quota; result/cleanup and plain JSON behavior retained (FAKE_INTEGRATION)");
  } finally { if (activeApp) await activeApp.stop(); fs.rmSync(temporary, { recursive: true, force: true }); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
