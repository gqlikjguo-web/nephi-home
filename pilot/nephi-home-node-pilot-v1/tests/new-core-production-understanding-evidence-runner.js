"use strict";

// FAKE_INTEGRATION: actual signed HTTP ingress, persistence, coordinator,
// production adapter and OpenAI admission/correction; fixed HTTP model outputs
// and captured LINE transport. No live OpenAI, production DB or LINE calls.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const crypto = require("node:crypto");
const { setup } = require("./helpers/burst-production-fixture");

async function scenario(mode, check) {
  const outputs = [];
  const secret = crypto.randomBytes(30).toString("hex");
  const x = await setup("production-schema-evidence", { pg: true, providerResponse(payload, attempt) {
    const output = JSON.parse(payload.output[0].content[0].text);
    if (mode !== "success" && (mode !== "corrected" || attempt === 1))
      output.understandingOutput.turnId = `invalid-turn-${attempt}`;
    if (mode === "sensitive") output.extra = { authorization: `Bearer ${secret}`, secret,
      password: secret, cookie: secret, apiKey: secret, note: `Bearer ${secret}` };
    outputs.push(output);
    return { ...payload, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }] };
  } });
  try {
    await x.post([x.event("diagnostic-event")]);
    await x.done("diagnostic-event");
    await check(x, outputs, secret);
  } finally { await x.app.stop(); }
}

async function assertPrivateHttpAndBulkRead(x, record) {
  const url = `${x.server.url}/api/reviews?customerId=audit_a&status=all`;
  assert.equal((await fetch(url)).status, 401);
  // Synthetic session lookup only; exercise the unchanged real HTTP auth and
  // property guards. Production credentials/session data are never loaded.
  const token = crypto.randomBytes(24).toString("hex");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  x.providers.persistence.getAdminSession = actual => actual === hash ? { propertyId: "audit_a", username: "diagnostic-fixture" } : null;
  const headers = { cookie: `nephi_admin_session=${token}`, "content-type": "application/json" };
  const reviews = await fetch(url, { headers });
  assert.equal(reviews.status, 200);
  const reviewBody = await reviews.text();
  assert.equal(reviewBody.includes("understandingFailureDiagnostic"), false);
  assert.equal(reviewBody.includes("invalid-turn-"), false);
  assert.equal((await fetch(`${x.server.url}/api/reviews?customerId=audit_b`, { headers })).status, 403);
  for (const [route, body, status] of [
    [`/api/reviews/${record.reviewId}/resolve`, { customerId: "audit_a", ownerAction: "correct", reviewNote: "Synthetic diagnostic fixture" }, 200],
    ["/api/messages", { customerId: "audit_a", eventId: record.eventId, channelId: record.channelId, guestMessage: "Synthetic fixture message" }, 201]
  ]) {
    const response = await fetch(x.server.url + route, { method: "POST", headers, body: JSON.stringify(body) });
    assert.equal(response.status, status);
    const value = await response.json();
    assert.equal(value.ok, true);
    assert.equal(Object.hasOwn(value.data.item, "understandingFailureDiagnostic"), false);
    assert.deepEqual(x.record(record.eventId).understandingFailureDiagnostic, record.understandingFailureDiagnostic,
      "HTTP redaction cannot mutate stored diagnostic evidence");
  }
  // Nine individually bounded records would exceed the existing 4MiB RPC
  // response limit if bulk dashboard/history reads loaded private evidence.
  const diagnostic = { schemaVersion: 1, attempts: [{ structuredOutput: { padding: "x".repeat(480 * 1024) } }] };
  for (let i = 0; i < 9; i++) x.providers.persistence.appendMessageLog("audit_a", {
    eventId: `bulk-${i}`, channelId: "bulk-channel", lineUserId: "bulk-user", processingStatus: "no_reply",
    guestMessage: "Synthetic fixture message", understandingFailureDiagnostic: diagnostic
  });
  const all = x.providers.persistence.listMessageLogs("audit_a");
  assert.equal(all.length, 10);
  assert.ok(all.every(item => !Object.hasOwn(item, "understandingFailureDiagnostic")));
  const history = x.providers.persistence.listRecentMessages("audit_a", "bulk-channel", "bulk-user", { limit: 10 });
  assert.equal(history.length, 9);
  assert.ok(history.every(item => item.guestMessage === "Synthetic fixture message" && !Object.hasOwn(item, "understandingFailureDiagnostic")));
  assert.deepEqual(x.record("bulk-0").understandingFailureDiagnostic, diagnostic);
}

test("terminal schema failure persists both existing attempts without changing the result", async () => {
  await scenario("failure", async (x, outputs) => {
    const record = x.record("diagnostic-event");
    assert.equal(x.calls[0].mockCalls, 2);
    assert.equal(record.processingStatus, "no_reply");
    assert.equal(record.replyText, "");
    assert.equal(record.decisionReason, "terminal_processing_status");
    assert.equal(x.sent.length, 0);
    assert.deepEqual(record.requestCycleRefs, []);
    assert.equal(record.understandingFailureDiagnostic?.schemaVersion, 1,
      "production persistence lost existing per-attempt schema diagnostics");
    const [a, b] = record.understandingFailureDiagnostic.attempts;
    assert.deepEqual([a.attemptNumber, a.attemptType, b.attemptNumber, b.attemptType], [1, "initial", 2, "correction"]);
    for (const [entry, index] of [[a, 0], [b, 1]]) {
      assert.deepEqual(entry.structuredOutput, outputs[index]);
      assert.equal(entry.schemaError.fieldPath, "understandingOutput.turnId");
      assert.equal(entry.schemaError.expected, "enum:C01.turnId");
      assert.equal(entry.schemaError.actual, `invalid-turn-${index + 1}`);
      assert.equal(entry.admissionFailureCode, "UNDERSTANDING_SCHEMA_INVALID");
      assert.equal(entry.accepted, false);
    }
    assert.ok(b.correctionInput);
    assert.ok(JSON.stringify(b.correctionInput).includes("UNDERSTANDING_SCHEMA_INVALID"));
    assert.equal(b.adoption.candidateAdmitted, false);
    assert.equal(b.adoption.rejectionStage, "admission");
    assert.equal(b.adoption.reportedFailure, "CORRECTION_SIBLING_NOT_PRESERVED");
    assert.equal(x.record("diagnostic-event", "audit_b"), null);
    const safe = JSON.stringify(record.safeTrace);
    for (const name of ["structuredOutput", "correctionInput", "invalid-turn-"])
      assert.equal(safe.includes(name), false, "existing public safe trace stays bounded");
    await assertPrivateHttpAndBulkRead(x, record);
  });
});

for (const mode of ["success", "corrected"]) test(`${mode} messages do not persist raw outputs`, async () => {
  await scenario(mode, async x => {
    const record = x.record("diagnostic-event");
    assert.equal(x.calls[0].mockCalls, mode === "success" ? 1 : 2);
    assert.equal(record.processingStatus, "reply_succeeded");
    assert.equal(x.sent.length, 1);
    assert.equal(Object.hasOwn(record, "understandingFailureDiagnostic"), false);
    assert.equal(JSON.stringify(record).includes("structuredOutput"), false);
  });
});

test("persisted failure evidence redacts sensitive fields and values", async () => {
  await scenario("sensitive", async (x, _outputs, secret) => {
    const record = x.record("diagnostic-event");
    assert.ok(record.understandingFailureDiagnostic);
    assert.equal(JSON.stringify(record).includes(secret), false);
    assert.equal(JSON.stringify(record).includes("Bearer "), false);
    assert.ok(JSON.stringify(record.understandingFailureDiagnostic).includes("[REDACTED]"));
    assert.equal(record.processingStatus, "no_reply");
    assert.equal(x.calls[0].mockCalls, 2);
  });
});
