"use strict";

const http = require("node:http");
const path = require("node:path");
const { createRequire } = require("node:module");

function lineSdk() {
  try { return require("@line/bot-sdk"); }
  catch { return createRequire(path.join(__dirname, "..", "nephi-home-node-pilot-v1", "package.json"))("@line/bot-sdk"); }
}

function required(env) {
  return Boolean(String(env.LINE_CHANNEL_SECRET || "").trim() && String(env.LINE_CHANNEL_ACCESS_TOKEN || "").trim() && String(env.PROPERTY_ID || "").trim());
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function readRaw(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function createGateway({ env = process.env, createCore = createV2Core, clientFactory, validate } = {}) {
  let core;
  const getCore = () => { if (!core) core = createCore({ env }); return core; };
  const sdk = lineSdk();
  const validateSignature = validate || sdk.validateSignature;
  const makeClient = clientFactory || ((token) => new sdk.messagingApi.MessagingApiClient({ channelAccessToken: token }));
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://gateway.local");
    if (request.method === "GET" && url.pathname === "/health") return sendJson(response, 200, { ok: true, data: { status: "ready", testOnly: true } });
    if (request.method !== "POST" || url.pathname !== "/webhook") return sendJson(response, 404, { ok: false, error: { code: "NOT_FOUND" } });
    if (!required(env)) return sendJson(response, 503, { ok: false, error: { code: "LINE_GATEWAY_NOT_CONFIGURED" } });
    const propertyId = String(url.searchParams.get("propertyId") || env.PROPERTY_ID || "").trim();
    if (!propertyId || propertyId !== String(env.PROPERTY_ID).trim()) return sendJson(response, 400, { ok: false, error: { code: "INVALID_PROPERTY" } });
    const raw = await readRaw(request);
    const signature = String(request.headers["x-line-signature"] || "");
    if (!validateSignature(raw, String(env.LINE_CHANNEL_SECRET), signature)) return sendJson(response, 401, { ok: false, error: { code: "INVALID_LINE_SIGNATURE" } });
    let payload;
    try { payload = JSON.parse(raw.toString("utf8")); } catch { return sendJson(response, 400, { ok: false, error: { code: "INVALID_JSON" } }); }
    sendJson(response, 200, { ok: true });
    for (const event of payload.events || []) {
      if (event.type !== "message" || !event.message || event.message.type !== "text" || !event.replyToken) continue;
      void processEvent({ event, propertyId, core: getCore(), client: makeClient(String(env.LINE_CHANNEL_ACCESS_TOKEN)) });
    }
  });
}

async function processEvent({ event, propertyId, core, client }) {
  const eventId = String(event.webhookEventId || "").trim();
  if (!eventId) return;
  const channelId = String(event.destination || "line-gateway");
  const claimed = await core.claimEvent({ customerId: propertyId, channelId, eventId, lineUserId: String(event.source && event.source.userId || ""), eventTimestamp: event.timestamp, messageText: event.message.text });
  if (!claimed || !claimed.claimed) return;
  try {
    const result = await core.processMessage({ customerId: propertyId, channelId, eventId, lineUserId: String(event.source && event.source.userId || ""), eventTimestamp: event.timestamp, messageText: event.message.text });
    if (result && result.shouldReply && result.replyText) await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: "text", text: result.replyText }] });
  } catch (error) {
    const status = Number(error && (error.status || error.statusCode));
    console.error(JSON.stringify({ scope: "junzan-line-gateway", event: Number.isInteger(status) && status > 0 ? `line_reply_http_error_${status}` : "line_reply_exception" }));
  }
}

function createV2Core({ env }) {
  const coreRoot = path.join(__dirname, "..", "nephi-home-node-pilot-v1");
  const { createProviders } = require(path.join(coreRoot, "lib/providers/provider-factory"));
  const { createMvpService } = require(path.join(coreRoot, "lib/mvp-service"));
  const { ConversationEngineV2 } = require(path.join(coreRoot, "lib/conversation-engine-v2/engine"));
  const { ConversationEngineV2Coordinator } = require(path.join(coreRoot, "lib/conversation-engine-v2/coordinator"));
  const { createTestOnlyOpenAiConversationPlannerFromEnv } = require(path.join(coreRoot, "lib/providers/test-only-openai-conversation-planner"));
  const { createTestOnlyOpenAiControlledComposerFromEnv } = require(path.join(coreRoot, "lib/providers/test-only-openai-controlled-composer"));
  const providers = createProviders({ databaseUrl: env.DATABASE_URL });
  const service = createMvpService(providers);
  const engine = new ConversationEngineV2({ planner: createTestOnlyOpenAiConversationPlannerFromEnv({ env }), composer: createTestOnlyOpenAiControlledComposerFromEnv({ env }), persistence: providers.persistence, getProperty: (id) => providers.customerSettings.getProperty(id), availabilityResolver: (query) => service.searchAvailability(query), availableDatesResolver: (query) => service.searchAvailableDates(query), listPriceOverrides: (id) => providers.customerSettings.listRoomPriceOverrides(id) });
  const coordinator = new ConversationEngineV2Coordinator({ engine, debounceMs: Number(env.JUNZAN_GATEWAY_DEBOUNCE_MS || 2000) });
  return {
    claimEvent: (input) => providers.persistence.claimMessageEvent(input.customerId, input.channelId, input.eventId, { lineUserId: input.lineUserId, eventTimestamp: input.eventTimestamp, guestMessage: input.messageText, replyType: "processing", replyText: "", route: "", decisionReason: "", humanHandoff: false, silentIgnore: false }),
    processMessage: (input) => coordinator.enqueue(input)
  };
}

module.exports = { createGateway, createV2Core };
