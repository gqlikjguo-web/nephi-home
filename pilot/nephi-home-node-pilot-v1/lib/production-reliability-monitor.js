"use strict";
// External observer only. No customer runtime, provider, decision or state imports.
const { createHash } = require("node:crypto");
const GRACE_MS = 5 * 60000;
const WINDOW_MS = 30 * 60000;
const hash = value => createHash("sha256").update(String(value)).digest("hex").slice(0, 20);
const label = (log, name) => (log.labels || []).find(x => x.name === name)?.value;
const failure = code => Object.assign(new Error(code), { monitorCode: code });

function analyze({ logs = [], rows = [], now = Date.now(), windowStart = now - WINDOW_MS, resourceId, graceMs = GRACE_MS }) {
  const turns = new Map(), alerts = new Map();
  function turn(key, timestamp) {
    if (!turns.has(key)) turns.set(key, { key, first: timestamp, last: timestamp, inbound: false, finals: [], delivered: false, properties: new Set(), failed: false });
    const t = turns.get(key); t.first = Math.min(t.first, timestamp); t.last = Math.max(t.last, timestamp); return t;
  }
  function alert(code, t) {
    const ref = t ? hash(t.key) : "service";
    alerts.set(code + ":" + ref, { code, ref });
    if (t) t.failed = true;
  }
  function inspect(data, t) {
    const stage = data.stage;
    if (data.propertyId) t.properties.add(String(data.propertyId));
    if (["line_inbound", "new_core_c01", "line_transport"].includes(stage) && !data.propertyId && data.reasonCode !== "merged_into_turn") alert("PROPERTY_SCOPE_MISSING", t);
    if (stage === "line_inbound") t.inbound = true;
    if (stage === "new_core_final") {
      t.finals.push(data);
      if (!data.finalResponse) alert("FINAL_RESPONSE_MISSING", t);
      else if (data.finalResponse.shouldReply === true && (!(data.finalResponse.replyLength > 0) || typeof data.finalResponse.replyText === "string" && !data.finalResponse.replyText.trim())) alert("FINAL_RESPONSE_EMPTY", t);
      if (!data.finalDecision) alert("TRACE_CHAIN_BROKEN", t);
      if (data.earliestFailure) alert("CORE_TERMINAL_FAILURE", t);
    }
    if (stage === "new_core_failure") alert("CORE_EXCEPTION", t);
    if (data.scope === "new-core-production-trace" && stage === "persistence_failed") alert("TRACE_PERSISTENCE_FAILED", t);
    if (stage === "new_core_resolver") {
      for (const item of data.requests || []) {
        for (const property of [item?.propertyId, item?.resolverTask?.propertyId]) if (property) t.properties.add(String(property));
      }
      for (const item of data.results || []) {
        for (const property of [item?.propertyId, item?.facts?.propertyId]) if (property) t.properties.add(String(property));
        if (item?.outcome === "technical_error" || item?.reason === "resolver_exception") alert("RESOLVER_FAILURE", t);
      }
    }
    if (stage === "line_transport") {
      if (data.delivered === true) t.delivered = true;
      if (data.reasonCode === "reply_failed" || data.deliveryErrorCode) alert("LINE_DELIVERY_FAILED", t);
      if (data.reasonCode === "final_response_empty_reply") alert("FINAL_RESPONSE_EMPTY", t);
      if (data.reasonCode === "final_response_validation_mismatch") alert("FINAL_RESPONSE_CONTRACT_FAILED", t);
      if (data.reasonCode === "merged_into_turn") t.merged = true;
    }
  }
  for (const log of logs) {
    const timestamp = Date.parse(log.timestamp);
    if (!Number.isFinite(timestamp) || timestamp < windowStart || timestamp > now) continue;
    if (resourceId && label(log, "resource") !== resourceId) { alert("MONITOR_RESOURCE_MISMATCH"); continue; }
    if (["error", "critical", "alert", "emergency"].includes(label(log, "level"))) alert("SERVICE_EXCEPTION_LOG");
    let data; try { data = JSON.parse(log.message); } catch { continue; }
    if (!data || !["new-core-production", "new-core-production-trace"].includes(data.scope)) continue;
    if (!data.traceId) { alert("TRACE_CHAIN_BROKEN"); continue; }
    inspect(data, turn(data.traceId, timestamp));
  }
  for (const row of rows) {
    const timestamp = Date.parse(row.created_at);
    if (!Number.isFinite(timestamp)) { alert("MONITOR_DATABASE_SIGNAL_INVALID"); continue; }
    const t = turn(row.trace_id || "db:" + row.ref, timestamp);
    if (row.property_id) t.properties.add(String(row.property_id)); else alert("PROPERTY_SCOPE_MISSING", t);
    if (row.payload_property_id) t.properties.add(String(row.payload_property_id));
    const age = now - timestamp;
    if (row.processing_status === "processing" && age > graceMs) alert("PROCESSING_STALLED", t);
    if (row.processing_status === "processing_failed") alert("CORE_EXCEPTION", t);
    if (row.processing_status === "reply_failed") alert("LINE_DELIVERY_FAILED", t);
    if (row.processing_status === "final_response_contract_failed") alert("FINAL_RESPONSE_CONTRACT_FAILED", t);
    if (row.processing_status === "reply_succeeded") t.delivered = true;
    if (row.should_reply === true && row.processing_status !== "processing" && age > graceMs && row.delivered !== true) alert("REPLY_NOT_DELIVERED", t);
    if (row.should_reply === true && row.processing_status !== "processing" && !(row.reply_length > 0)) alert("FINAL_RESPONSE_EMPTY", t);
    for (const item of row.trace || []) inspect(item, t);
  }
  let matureTurns = 0, failedTurns = 0;
  for (const t of turns.values()) {
    if (t.properties.size > 1) alert("PROPERTY_SCOPE_MISMATCH", t);
    const mature = now - t.last > graceMs;
    if (mature && t.inbound && !t.finals.length && !t.merged) { alert("PROCESSING_STALLED", t); alert("FINAL_RESPONSE_MISSING", t); }
    if (mature && t.finals.some(x => x.finalResponse?.shouldReply === true) && !t.delivered) alert("REPLY_NOT_DELIVERED", t);
    // A window may begin in the middle of a valid trace. Do not infer a broken
    // inbound from that left-boundary fragment, or from DB-only status records.
    if (mature && t.finals.length && !t.inbound && !t.merged && t.first >= windowStart + graceMs) alert("TRACE_CHAIN_BROKEN", t);
    if (t.inbound && mature) { matureTurns++; if (t.failed) failedTurns++; }
  }
  if (matureTurns >= 5 && failedTurns >= 3 && failedTurns / matureTurns >= 0.2) alert("ERROR_RATE_SPIKE");
  return { alerts: [...alerts.values()].sort((a, b) => a.code.localeCompare(b.code) || a.ref.localeCompare(b.ref)), observedTurns: turns.size, matureTurns, failedTurns, openaiCalls: 0 };
}

async function getJson(fetchImpl, url, headers = {}) {
  const response = await fetchImpl(url, { method: "GET", headers, redirect: "error", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw failure("MONITOR_SOURCE_HTTP_FAILURE");
  const text = await response.text();
  if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw failure("MONITOR_RESPONSE_LIMIT");
  try { return JSON.parse(text); } catch { throw failure("MONITOR_SOURCE_INVALID_JSON"); }
}

async function collectRenderLogs({ apiKey, ownerId, resourceId, startTime, endTime, fetchImpl = globalThis.fetch, maxPages = 20 }) {
  if (!apiKey || !/^tea-[a-zA-Z0-9-]+$/.test(ownerId || "") || !/^srv-[a-zA-Z0-9-]+$/.test(resourceId || "")) throw failure("MONITOR_NOT_CONFIGURED");
  const lower = Date.parse(startTime), upper = Date.parse(endTime);
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower >= upper) throw failure("MONITOR_WINDOW_INVALID");
  const logs = new Map(), cursors = new Set();
  for (let page = 0; page < Math.min(20, maxPages); page++) {
    const cursor = startTime + "|" + endTime;
    if (cursors.has(cursor)) throw failure("MONITOR_CURSOR_INVALID"); cursors.add(cursor);
    const url = new URL("https://api.render.com/v1/logs");
    for (const [key, value] of Object.entries({ ownerId, resource: resourceId, startTime, endTime, direction: "forward", type: "app", limit: "100" })) url.searchParams.set(key, value);
    const data = await getJson(fetchImpl, url, { authorization: "Bearer " + apiKey });
    if (!Array.isArray(data.logs) || typeof data.hasMore !== "boolean") throw failure("MONITOR_SOURCE_INVALID_SHAPE");
    for (const log of data.logs) {
      if (label(log, "resource") !== resourceId) throw failure("MONITOR_RESOURCE_MISMATCH");
      if (typeof log.id !== "string" || !Number.isFinite(Date.parse(log.timestamp))) throw failure("MONITOR_SOURCE_INVALID_SHAPE");
      logs.set(log.id, log);
    }
    if (!data.hasMore) return [...logs.values()];
    const nextStart = Date.parse(data.nextStartTime), nextEnd = Date.parse(data.nextEndTime);
    if (!Number.isFinite(nextStart) || !Number.isFinite(nextEnd) || nextStart < lower || nextEnd > upper || nextStart > nextEnd || cursors.has(data.nextStartTime + "|" + data.nextEndTime)) throw failure("MONITOR_CURSOR_INVALID");
    startTime = data.nextStartTime; endTime = data.nextEndTime;
  }
  throw failure("MONITOR_LOG_WINDOW_INCOMPLETE");
}

async function readMessageSignals({ client, since }) {
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '5s'");
    const result = await client.query(
      "SELECT md5(property_id || ':' || channel_id || ':' || event_id) AS ref, property_id, processing_status, created_at, payload->>'propertyId' AS payload_property_id, payload->'safeTrace'->0->>'traceId' AS trace_id, payload->>'shouldReply'='true' AS should_reply, payload->>'replyDelivered'='true' AS delivered, length(btrim(coalesce(payload->>'replyText',''))) AS reply_length FROM message_logs WHERE created_at >= $1::timestamptz ORDER BY created_at DESC LIMIT 1001",
      [since]
    );
    if (result.rows.length > 1000) throw failure("MONITOR_DATABASE_WINDOW_INCOMPLETE");
    return result.rows;
  } catch (error) { throw failure(error.monitorCode || "MONITOR_POSTGRES_UNAVAILABLE"); }
  finally { try { await client.query("ROLLBACK"); } catch {} try { await client.end(); } catch {} }
}

async function runMonitor({ apiKey, ownerId, resourceId, healthUrl, databaseClient, now = Date.now(), fetchImpl = globalThis.fetch }) {
  const windowStart = now - WINDOW_MS, problems = [], gaps = ["PRE_TRACE_RECEIPT_NOT_PROVEN", "BOUNDED_OBSERVATION_WINDOW", "NOTIFICATION_DELIVERY_NOT_PROVEN"];
  const sources = { health: "UNAVAILABLE", logs: "UNAVAILABLE", postgres: "NOT_CONNECTED" };
  let logs = [], rows = [];
  try {
    const u = new URL(healthUrl);
    if (u.protocol !== "https:" || u.username || u.password) throw failure("MONITOR_HEALTH_URL_INVALID");
    const h = await getJson(fetchImpl, u);
    if (h.ok !== true || h.data?.status !== "ready") throw failure("SERVICE_UNHEALTHY");
    if (h.data?.testOnly !== false || h.data?.deployment?.serviceId !== resourceId || h.data?.deployment?.repoSlug !== "gqlikjguo-web/nephi-home" || h.data?.deployment?.branch !== "production") throw failure("HEALTH_IDENTITY_MISMATCH");
    sources.health = "READY";
  } catch (error) { problems.push({ code: error.monitorCode || "MONITOR_HEALTH_UNAVAILABLE", ref: "service" }); }
  try {
    logs = await collectRenderLogs({ apiKey, ownerId, resourceId, startTime: new Date(windowStart).toISOString(), endTime: new Date(now).toISOString(), fetchImpl });
    sources.logs = "COMPLETE";
  } catch (error) { problems.push({ code: error.monitorCode || "MONITOR_RENDER_UNAVAILABLE", ref: "service" }); }
  if (databaseClient) {
    try { rows = await readMessageSignals({ client: databaseClient, since: new Date(windowStart).toISOString() }); sources.postgres = "COMPLETE"; }
    catch (error) { sources.postgres = "UNAVAILABLE"; problems.push({ code: error.monitorCode || "MONITOR_POSTGRES_UNAVAILABLE", ref: "service" }); }
  } else gaps.push("POSTGRES_NOT_CONNECTED");
  const result = analyze({ logs, rows, now, windowStart, resourceId });
  result.alerts.push(...problems);
  return { ...result, status: result.alerts.length ? "ALERT" : "NO_ALERT_WITH_GAPS", windowStart: new Date(windowStart).toISOString(), windowEnd: new Date(now).toISOString(), sources, gaps };
}

module.exports = { analyze, collectRenderLogs, readMessageSignals, runMonitor };
