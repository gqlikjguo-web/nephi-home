"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createApp } = require("../server");
const { createLineBindingService } = require("../lib/line-binding-service");
const { migratePostgres } = require("../lib/providers/postgres-migrate");
const { createProviders } = require("../lib/providers/provider-factory");
const { openPostgres } = require("../lib/providers/postgres-client");

const secretA = "postgres-webhook-secret-a";
const secretB = "postgres-webhook-secret-b";
const tokenA = "postgres-webhook-token-a";
const tokenB = "postgres-webhook-token-b";

function planParking(sourceEvent = {}) {
  const sourceText = String(sourceEvent.messageText || "Parking?");
  return {
    schemaVersion: 2,
    discourse: { relation: "new_request", confidence: 0.99 },
    stateOperations: [],
    stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null },
    tasks: [{ candidateIndex: 0, taskId: "parking", type: "amenity", sourceText, detailIntent: "general", requestedOutputs: ["answer"], eligibilityEvidence: { kind: "none", sourceText: "" }, dependsOnStayContext: false, entity: { category: "amenity", rawText: "parking", canonicalCandidate: "parking", confidence: 0.99 }, stayCandidate: null, confidence: 0.99 }],
    contextRelationCandidates: [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: String(sourceEvent.eventId || ""), startOffset: 0, endOffset: sourceText.length, quote: sourceText }] }],
    ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "postgres_webhook_e2e"
  };
}

function signed(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64");
}

function payload(eventId, text = "Parking?") {
  return JSON.stringify({ propertyId: "forged-property", customerId: "forged-property", events: [{ type: "message", webhookEventId: eventId, replyToken: `reply-${eventId}`, timestamp: 1, source: { userId: "postgres-user" }, message: { type: "text", id: `message-${eventId}`, text } }] });
}

async function post(url, webhookKey, body, signature) {
  return fetch(`${url}/api/line/webhooks/${webhookKey}`, { method: "POST", headers: { "content-type": "application/json", "x-line-signature": signature }, body });
}

async function waitFor(predicate, timeoutMs = 1500) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for PostgreSQL LINE reply");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

(async () => {
  const runtime = path.join(__dirname, "../.runtime");
  fs.mkdirSync(runtime, { recursive: true });
  const temp = fs.mkdtempSync(path.join(runtime, "line-binding-webhook-pg-"));
  const connection = { kind: "pglite", dataDir: path.join(temp, "db") };
  const env = { JUNZAN_LINE_CREDENTIAL_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64") };
  const plannerProperties = [];
  const replies = [];
  let app;
  try {
    const migration = await migratePostgres(connection);
    assert.ok(migration.files.includes("015_property_line_bindings.sql"), "the production binding migration must be applied");
    const setup = await openPostgres(connection);
    await setup.query("INSERT INTO properties(property_id,display_name) VALUES($1,$2),($3,$4)", ["pg_property_a", "Postgres Property A", "pg_property_b", "Postgres Property B"]);
    await setup.query("INSERT INTO property_settings(property_id,settings) VALUES($1,$2::jsonb),($3,$4::jsonb)", ["pg_property_a", JSON.stringify({ commonAnswers: { parkingRule: "Postgres Parking A" } }), "pg_property_b", JSON.stringify({ commonAnswers: { parkingRule: "Postgres Parking B" } })]);
    await setup.close();

    const providers = createProviders({ databaseUrl: "pglite:test", postgresConnection: connection });
    const bindings = createLineBindingService({ provider: providers.lineBindings, env });
    const bindingA = bindings.upsert("pg_property_a", { channelSecret: secretA, channelAccessToken: tokenA, enabled: true });
    const bindingB = bindings.upsert("pg_property_b", { channelSecret: secretB, channelAccessToken: tokenB, enabled: true });
    assert.notEqual(bindingA.webhookKey, bindingB.webhookKey);

    app = createApp({
      providers,
      lineBindingEnv: env,
      conversationDebounceMs: 1,
      conversationPlannerV2: { classify: async ({ catalog, sourceEvents }) => { plannerProperties.push(catalog.propertyId); return planParking(sourceEvents[0]); } },
      lineReplyClientFactory: ({ channelAccessToken }) => ({ replyMessageWithHttpInfo: async (body) => { replies.push({ channelAccessToken, body }); return { httpResponse: { status: 200 } }; } })
    });
    const running = await app.start(0, "127.0.0.1");
    const bodyA = payload("pg-a");
    const bodyB = payload("pg-b");
    assert.equal((await post(running.url, bindingA.webhookKey, bodyA, signed(secretA, bodyA))).status, 200);
    assert.equal((await post(running.url, bindingB.webhookKey, bodyB, signed(secretB, bodyB))).status, 200);
    await waitFor(() => replies.length === 2);
    assert.deepEqual(plannerProperties.sort(), ["pg_property_a", "pg_property_b"], "each production route must resolve only its bound property");
    assert.deepEqual(replies.map((reply) => reply.channelAccessToken).sort(), [tokenA, tokenB].sort(), "each bound property must reply with its own stored token");
    assert.match(replies.find((reply) => reply.channelAccessToken === tokenA).body.messages[0].text, /Postgres Parking A/);
    assert.match(replies.find((reply) => reply.channelAccessToken === tokenB).body.messages[0].text, /Postgres Parking B/);
    assert.ok(bindings.status("pg_property_a").lastWebhookObservedAt, "PostgreSQL must persist the admitted webhook receipt time");
    assert.ok(bindings.status("pg_property_a").lastValidWebhookAt, "PostgreSQL must persist the valid webhook receipt time");

    const invocationsBeforeRejectedRequests = plannerProperties.length;
    const bindingBValidWebhookBeforeRejectedRequests = bindings.status("pg_property_b").lastValidWebhookAt;
    assert.equal((await post(running.url, bindingB.webhookKey, bodyA, signed(secretA, bodyA))).status, 401, "Secret A must not validate Binding B");
    bindings.setEnabled("pg_property_b", false);
    const disabledBody = payload("pg-b-disabled");
    assert.equal((await post(running.url, bindingB.webhookKey, disabledBody, signed(secretB, disabledBody))).status, 404, "disabled bindings must not run the production handler");
    assert.equal(plannerProperties.length, invocationsBeforeRejectedRequests, "signature failures and disabled bindings must not execute AI");
    assert.equal(bindings.status("pg_property_b").lastValidWebhookAt, bindingBValidWebhookBeforeRejectedRequests, "rejected PostgreSQL webhook requests must not advance the valid receipt time");

    await app.stop();
    app = null;
    const inspection = await openPostgres(connection);
    const stored = await inspection.query("SELECT property_id,channel_secret_encrypted::text AS secret,channel_access_token_encrypted::text AS token,last_webhook_observed_at,last_valid_webhook_at FROM property_line_bindings ORDER BY property_id");
    await inspection.close();
    assert.equal(stored.rows.length, 2);
    assert.doesNotMatch(JSON.stringify(stored.rows), new RegExp([secretA, secretB, tokenA, tokenB].join("|")), "the database must not contain plaintext channel credentials");
    assert.ok(stored.rows.every((row) => /aes-256-gcm/.test(row.secret) && /aes-256-gcm/.test(row.token)), "credentials must use AES-256-GCM envelopes");
    assert.ok(stored.rows.every((row) => row.last_webhook_observed_at && row.last_valid_webhook_at), "observed and valid webhook timestamps must survive PostgreSQL provider restart");
    console.log("property-scoped LINE binding PostgreSQL production webhook: PASS");
  } finally {
    if (app) await app.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
