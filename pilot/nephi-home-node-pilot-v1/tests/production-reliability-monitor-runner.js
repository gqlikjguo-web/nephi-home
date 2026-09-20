"use strict";
// STRUCTURED_CONTRACT_TEST: passive telemetry; never invoke the customer runtime.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const modulePath = path.join(__dirname, "../lib/production-reliability-monitor.js");
assert.ok(fs.existsSync(modulePath), "RED: external zero-Luna monitor is missing");
const { analyze, collectRenderLogs, readMessageSignals, runMonitor } = require(modulePath);
const now = Date.parse("2026-09-20T15:00:00Z"), start = now - 30 * 60000;
let id = 0;
function record(stage, data = {}, age = 600000, traceId = "turn-a") {
  return { id: String(++id), timestamp: new Date(now - age).toISOString(), labels: [{ name: "resource", value: "srv-test" }, { name: "level", value: "info" }], message: JSON.stringify({ scope: "new-core-production", traceId, stage, ...data }) };
}
function healthy({ reply = true, action = "reply", traceId = "turn-a" } = {}) {
  return [record("line_inbound", { propertyId: "property-a" }, 600000, traceId), record("new_core_c01", { propertyId: "property-a" }, 599000, traceId), record("new_core_final", { finalDecision: { action }, finalResponse: { action, shouldReply: reply, replyLength: reply ? 12 : 0 } }, 590000, traceId), record("line_transport", { propertyId: "property-a", attempted: reply, delivered: reply, reasonCode: reply ? "reply_succeeded" : "final_response_should_reply_false" }, 589000, traceId)];
}
function check(logs, rows = []) { return analyze({ logs, rows, now, windowStart: start, resourceId: "srv-test" }); }
function codes(result) { return result.alerts.map(x => x.code); }
test("normal replies, clarification, handoff and explicit NO_REPLY remain healthy", () => {
  for (const args of [{}, { action: "clarification" }, { action: "handoff" }, { action: "no_reply", reply: false }, { action: "handoff", reply: false }]) assert.deepEqual(codes(check(healthy(args))), []);
});
test("no traffic is not a guessed service failure", () => assert.deepEqual(codes(check([])), []));
test("explicit reply without delivery becomes an alert after grace", () => assert.ok(codes(check(healthy().slice(0, 3))).includes("REPLY_NOT_DELIVERED")));
test("active processing inside grace is not reported as stuck", () => assert.deepEqual(codes(check([record("line_inbound", { propertyId: "property-a" }, 10000)])), []));
test("mature inbound without final reports stalled processing and missing final", () => {
  const r = codes(check([record("line_inbound", { propertyId: "property-a" })])); assert.ok(r.includes("PROCESSING_STALLED")); assert.ok(r.includes("FINAL_RESPONSE_MISSING"));
});
test("empty, whitespace and missing declared reply are detected", () => {
  for (const response of [null, { shouldReply: true, replyLength: 0 }, { shouldReply: true, replyLength: 3, replyText: "   " }]) {
    const logs = healthy(); logs[2] = record("new_core_final", { finalDecision: { action: "reply" }, finalResponse: response });
    assert.ok(codes(check(logs)).includes(response ? "FINAL_RESPONSE_EMPTY" : "FINAL_RESPONSE_MISSING"));
  }
});
test("resolver technical errors alert; valid Unknown and no_availability do not", () => {
  for (const outcome of ["answered", "unknown", "no_availability", "not_ready"]) assert.deepEqual(codes(check([...healthy(), record("new_core_resolver", { results: [{ outcome, reason: "missing_inventory_records" }] })])), []);
  assert.ok(codes(check([...healthy(), record("new_core_resolver", { results: [{ outcome: "technical_error", reason: "resolver_exception" }] })])).includes("RESOLVER_FAILURE"));
});
test("terminal exception and trace persistence failure alert", () => {
  assert.ok(codes(check([...healthy(), record("new_core_failure", { failureCode: "RUNTIME_EXCEPTION" })])).includes("CORE_EXCEPTION"));
  assert.ok(codes(check([record("persistence_failed", { scope: "new-core-production-trace" })])).includes("TRACE_PERSISTENCE_FAILED"));
});
test("LINE failure alerts and duplicate transport logs count one failed turn", () => {
  const logs = healthy().slice(0, 3), failed = record("line_transport", { attempted: true, delivered: false, reasonCode: "reply_failed" });
  const r = check([...logs, failed, { ...failed, id: "duplicate" }]);
  assert.equal(r.failedTurns, 1); assert.equal(r.alerts.filter(x => x.code === "LINE_DELIVERY_FAILED").length, 1);
});
test("missing inbound away from window boundary is a broken trace", () => assert.ok(codes(check(healthy().slice(1))).includes("TRACE_CHAIN_BROKEN")));
test("left-window partial trace does not manufacture a missing inbound", () => {
  const logs = healthy().slice(1).map(l => ({ ...l, timestamp: new Date(start + 1000).toISOString() })); assert.deepEqual(codes(check(logs)), []);
});
test("property mismatch and missing required property identity alert", () => {
  assert.ok(codes(check([...healthy(), record("new_core_c01", { propertyId: "property-b" })])).includes("PROPERTY_SCOPE_MISMATCH"));
  assert.ok(codes(check([...healthy(), record("new_core_c01", {})])).includes("PROPERTY_SCOPE_MISSING"));
});
test("resolver request/fact property mismatch is detected without changing facts", () => {
  assert.ok(codes(check([...healthy(), record("new_core_resolver", { results: [{ outcome: "answered", facts: { propertyId: "property-b" } }] })])).includes("PROPERTY_SCOPE_MISMATCH"));
});
test("formal resolver request and nested resolverTask property paths are both observed", () => {
  // production-safe-trace.js resolverRequest emits these two explicit paths.
  for (const request of [{ propertyId: "property-b" }, { propertyId: "property-a", resolverTask: { propertyId: "property-b" } }]) {
    assert.ok(codes(check([...healthy(), record("new_core_resolver", { requests: [request] })])).includes("PROPERTY_SCOPE_MISMATCH"));
  }
  assert.deepEqual(codes(check([...healthy(), record("new_core_resolver", { requests: [{ propertyId: "property-a", resolverTask: { propertyId: "property-a" } }] })])), []);
});
test("short-window error rate is based on unique mature turns", () => {
  const logs = []; for (let i = 0; i < 5; i++) { logs.push(...healthy({ traceId: "turn-" + i })); if (i < 3) logs.push(record("new_core_failure", {}, 589000, "turn-" + i)); }
  assert.ok(codes(check(logs)).includes("ERROR_RATE_SPIKE"));
});
test("raw error severity is monitored without keyword parsing or text disclosure", () => {
  const r = check([{ id: "err", timestamp: new Date(now).toISOString(), labels: [{ name: "resource", value: "srv-test" }, { name: "level", value: "error" }], message: "sensitive guest text" }]);
  assert.ok(codes(r).includes("SERVICE_EXCEPTION_LOG")); assert.ok(!JSON.stringify(r).includes("sensitive guest text"));
});
test("database processing and delivery signals are passive and property-scoped", () => {
  const rows = [{ ref: "row-a", property_id: "property-a", processing_status: "processing", created_at: new Date(now - 600000).toISOString(), trace: [] }];
  const before = JSON.stringify(rows); assert.ok(codes(check([], rows)).includes("PROCESSING_STALLED")); assert.equal(JSON.stringify(rows), before);
  assert.ok(codes(check([], [{ ...rows[0], processing_status: "reply_failed" }])).includes("LINE_DELIVERY_FAILED"));
  assert.deepEqual(codes(check([], [{ ...rows[0], processing_status: "no_reply" }])), []);
});
test("report never includes customer content, raw identities or credentials", () => {
  const logs = [record("line_inbound", { propertyId: "private-property", guestMessage: "private guest message" }, 600000, "private-trace")];
  const text = JSON.stringify(check(logs)); for (const secret of ["private-property", "private guest message", "private-trace"]) assert.ok(!text.includes(secret));
});
function response(body, status = 200) { return { ok: status < 400, status, text: async () => JSON.stringify(body) }; }
const config = { apiKey: "test-only", ownerId: "tea-test", resourceId: "srv-test", healthUrl: "https://monitor.invalid/api/health" };
test("Render collector follows exact timestamp cursor and scoped resource", async () => {
  const calls = []; const a = new Date(start).toISOString(), b = new Date(now).toISOString(), next = new Date(start + 1000).toISOString();
  const logs = await collectRenderLogs({ ...config, startTime: a, endTime: b, fetchImpl: async (url, options) => {
    const u = new URL(url); calls.push(u); assert.equal(u.origin, "https://api.render.com"); assert.equal(u.searchParams.get("resource"), "srv-test"); assert.equal(options.method, "GET");
    return response(calls.length === 1 ? { logs: [healthy()[0]], hasMore: true, nextStartTime: next, nextEndTime: b } : { logs: [], hasMore: false });
  } }); assert.equal(calls.length, 2); assert.equal(calls[1].searchParams.get("startTime"), next); assert.equal(logs.length, 1);
});
test("incomplete pagination, repeated cursor and foreign resource fail closed", async () => {
  const opts = { ...config, startTime: new Date(start).toISOString(), endTime: new Date(now).toISOString(), maxPages: 1 };
  await assert.rejects(() => collectRenderLogs({ ...opts, fetchImpl: async () => response({ logs: [], hasMore: true, nextStartTime: new Date(start + 1000).toISOString(), nextEndTime: opts.endTime }) }), /MONITOR_LOG_WINDOW_INCOMPLETE/);
  await assert.rejects(() => collectRenderLogs({ ...opts, fetchImpl: async () => response({ logs: [], hasMore: true, nextStartTime: opts.startTime, nextEndTime: opts.endTime }) }), /MONITOR_CURSOR_INVALID/);
  await assert.rejects(() => collectRenderLogs({ ...opts, fetchImpl: async () => response({ logs: [{ ...healthy()[0], labels: [{ name: "resource", value: "srv-other" }] }], hasMore: false }) }), /MONITOR_RESOURCE_MISMATCH/);
});
test("database collector uses a bounded READ ONLY transaction and closes on failure", async () => {
  const queries = []; let closed = false;
  const client = { connect: async () => {}, query: async (sql) => { queries.push(sql); if (sql.startsWith("SELECT")) throw Error("private error"); return { rows: [] }; }, end: async () => { closed = true; } };
  await assert.rejects(() => readMessageSignals({ client, since: new Date(start).toISOString() }), /MONITOR_POSTGRES_UNAVAILABLE/);
  assert.ok(queries.includes("BEGIN READ ONLY")); assert.ok(queries.includes("ROLLBACK")); assert.equal(closed, true);
  assert.ok(!queries.some(q => /^(INSERT|UPDATE|DELETE|CREATE|ALTER)/.test(q)));
});
test("health identity mismatch alerts; collector errors never claim healthy", async () => {
  const report = await runMonitor({ ...config, now, fetchImpl: async url => new URL(url).hostname === "monitor.invalid" ? response({ ok: true, data: { status: "ready", testOnly: false, deployment: { serviceId: "srv-other" } } }) : response({ logs: [], hasMore: false }) });
  assert.ok(codes(report).includes("HEALTH_IDENTITY_MISMATCH"));
  const failed = await runMonitor({ ...config, now, fetchImpl: async () => { throw Error("private credential"); } }); assert.equal(failed.status, "ALERT"); assert.ok(!JSON.stringify(failed).includes("private credential"));
});
test("monitor uses only health and Render GETs, with missing database coverage explicit", async () => {
  const calls = []; const report = await runMonitor({ ...config, now, fetchImpl: async (url, options) => { calls.push([String(url), options.method]); return new URL(url).hostname === "monitor.invalid" ? response({ ok: true, data: { status: "ready", testOnly: false, deployment: { serviceId: "srv-test", repoSlug: "gqlikjguo-web/nephi-home", branch: "production" } } }) : response({ logs: [], hasMore: false }); } });
  assert.equal(report.openaiCalls, 0); assert.equal(report.status, "NO_ALERT_WITH_GAPS"); assert.ok(report.gaps.includes("POSTGRES_NOT_CONNECTED"));
  assert.equal(calls.length, 2); assert.ok(calls.every(([, method]) => method === "GET"));
});
