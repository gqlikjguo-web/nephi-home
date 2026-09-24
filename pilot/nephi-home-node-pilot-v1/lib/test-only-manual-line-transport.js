"use strict";

const crypto = require("node:crypto");
const { AppError } = require("./mvp-service");
const TEST_SERVICE_ID = "srv-d9bqupbbc2fs73aselig";
const TEST_DB_ID = "dpg-da6qo0jbc2fs738f11v0-a";

function unavailable(code) {
  return new AppError(503, code, "人工驗收入口未通過測試環境或訊息處理驗證");
}

// Only an outer transport: no core import, State/history construction, binding
// credential lookup, LINE client, or alternative message-processing implementation.
function createTestOnlyManualLineTransport({ enabled, engineAvailable, env, persistence, handleMessage, now }) {
  const active = new WeakSet();
  function assertIsolation() {
    if (!enabled || !engineAvailable) throw unavailable("MANUAL_PRODUCTION_ENTRY_UNAVAILABLE");
    if (env.RENDER_SERVICE_ID !== TEST_SERVICE_ID) throw unavailable("MANUAL_TEST_SERVICE_MISMATCH");
    for (const key of ["DATABASE_URL", "NEW_CORE_MANUAL_TEST_FACTS_DATABASE_URL"]) {
      let target;
      try { target = new URL(env[key]); } catch { throw unavailable("MANUAL_TEST_DB_MISMATCH"); }
      if (!["postgres:", "postgresql:"].includes(target.protocol)
        || target.hostname !== TEST_DB_ID || target.pathname !== "/nephi_home_node_pilot_test_only"
        || target.search || target.hash) throw unavailable("MANUAL_TEST_DB_MISMATCH");
    }
  }
  return {
    recognizes: value => Boolean(enabled && value && active.has(value)),
    async dispatch({ session, turnId, message }) {
      assertIsolation();
      const identity = crypto.createHash("sha256")
        .update(JSON.stringify([session.propertyId, session.ownerId, session.testSessionId, session.generation]))
        .digest("hex");
      const binding = { propertyId: session.propertyId, webhookKey: `manual-browser:${identity}` };
      const channelId = `line-binding:${crypto.createHash("sha256").update(binding.webhookKey).digest("hex").slice(0,24)}`;
      const userId = `manual-browser:${identity}`;
      const messages = [];
      const transport = { binding, result: null,
        replyClient: { async replyMessageWithHttpInfo(body) {
          if (body.replyToken !== turnId) throw unavailable("MANUAL_REPLY_EVENT_MISMATCH");
          messages.push(...body.messages);
          return { httpResponse: { status: 200 } };
        } }
      };
      const rawBody = Buffer.from(JSON.stringify({ events: [{ type: "message", webhookEventId: turnId,
        replyToken: turnId, timestamp: now().getTime(), source: { type: "user", userId },
        message: { type: "text", id: turnId, text: message } }] }));
      active.add(transport);
      try {
        await handleMessage({ rawBody, manualTransport: transport });
        const record = persistence.findMessageByEventId(session.propertyId, turnId, channelId);
        if (!transport.result || !record || !["reply_succeeded", "no_reply"].includes(record.processingStatus))
          throw unavailable("MANUAL_MESSAGE_PROCESSING_INCOMPLETE");
        const response = transport.result.finalResponse;
        const displayedText = messages.filter(item => item.type === "text").map(item => item.text).join("\n");
        if (response.shouldReply && displayedText !== response.replyText)
          throw unavailable("MANUAL_REPLY_RESPONSE_MISMATCH");
        return { result: transport.result, transport: {
          kind: "browser", executionPath: "production-message-ingress", eventId: turnId,
          messageStatus: record.processingStatus, stateAuthority: "conversation_states",
          historyAuthority: "message_logs", testDbResourceId: TEST_DB_ID, lineRealSend: "NOT_RUN"
        } };
      } finally { active.delete(transport); }
    }
  };
}

module.exports = { createTestOnlyManualLineTransport };
